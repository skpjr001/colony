import { Hono } from "hono";
import { openAttempt, submitEvidence } from "./attempts";
import { admissionLimited, breakerStatus, frozenShards, noteFlip } from "./breakers";
import { negotiate } from "./ladder";
import { applyReview } from "./selection";
import { ClaimBoard } from "./claim-board";
import { ColonyRpc } from "./colony-rpc";
import { loadColonyToml } from "./colony-toml";
import { coreVersion } from "./core";
import { repoFiles, runConflict, runParallelDemo, runSwarm, seedScale } from "./demo-run";
import { CLAIM_TTL_MS } from "./decay";
import type { Env } from "./env";
import { ContendedError, createClaim, heartbeatClaims, listBoard, releaseClaim } from "./router";
import { seedColony } from "./seed";
import { DEMO_REPO, KNOWN_SHARDS, SHARD_MAP_VERSION, SHARD_PATTERNS, shardsForPaths } from "./shards";

const VERSION = "0.6.0";
const PHASE = 6;

class HttpError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 413 | 423 | 429 | 500,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

type AppEnv = { Bindings: Env };

const app = new Hono<AppEnv>();
const api = new Hono<AppEnv>();

api.use("*", async (c, next) => {
  console.log(JSON.stringify({ message: "request", method: c.req.method, path: c.req.path }));
  await next();
});

api.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  console.error(
    JSON.stringify({
      message: "unhandled error",
      error: err instanceof Error ? err.message : String(err),
      path: c.req.path,
    }),
  );
  return c.json({ error: "internal error" }, 500);
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBody(c: { req: { header: (name: string) => string | undefined; text: () => Promise<string> } }): Promise<unknown> {
  const len = c.req.header("content-length");
  if (len && Number(len) > 1_000_000) throw new HttpError(413, "body too large");
  const text = await c.req.text();
  if (text.length > 1_000_000) throw new HttpError(413, "body too large");
  if (!text.trim()) return {};
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    throw new HttpError(400, "invalid json");
  }
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new HttpError(400, "json object required");
  return value;
}

function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, `${key} required`);
  return value;
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new HttpError(400, `${key} must be a string`);
  return value;
}

function requireStringArray(body: Record<string, unknown>, key: string): string[] {
  const value = body[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new HttpError(400, `${key} must be string[]`);
  }
  return value;
}

function optionalStringArray(body: Record<string, unknown>, key: string): string[] | undefined {
  if (body[key] === undefined) return undefined;
  return requireStringArray(body, key);
}

function requireNumber(body: Record<string, unknown>, key: string): number {
  const value = body[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new HttpError(400, `${key} must be a number`);
  return value;
}

function optionalNumber(body: Record<string, unknown>, key: string): number | undefined {
  if (body[key] === undefined) return undefined;
  return requireNumber(body, key);
}

function requireBoolean(body: Record<string, unknown>, key: string): boolean {
  const value = body[key];
  if (typeof value !== "boolean") throw new HttpError(400, `${key} must be a boolean`);
  return value;
}

function parseJsonValue(raw: string | null): unknown {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value;
  } catch {
    return null;
  }
}

function parseStringArray(raw: string | null): string[] {
  const value = parseJsonValue(raw);
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  return [];
}

function repoNames(page: unknown): string[] {
  const list = Array.isArray(page)
    ? page
    : isRecord(page) && Array.isArray(page.repos)
      ? page.repos
      : isRecord(page) && Array.isArray(page.results)
        ? page.results
        : [];
  return list
    .map((item) => (isRecord(item) && typeof item.name === "string" ? item.name : null))
    .filter((name): name is string => name !== null);
}

function evidenceSummary(raw: string | null): string {
  if (!raw) return "";
  const value = parseJsonValue(raw);
  if (typeof value === "string") return value;
  if (isRecord(value)) {
    if (typeof value.summary === "string") return value.summary;
    if (typeof value.agentRationale === "string") return value.agentRationale;
    if (typeof value.agent_rationale === "string") return value.agent_rationale;
  }
  return "";
}

interface TaskRow {
  id: string;
  repo: string;
  title: string;
  intent: string;
  tags: string;
  urgency: number;
  uncertainty: string;
  state: string;
  state_detail: string | null;
  paths_hint: string;
  created_at: number;
  updated_at: number;
}

interface AttemptRow {
  id: string;
  task_id: string;
  agent_id: string;
  fork_repo: string;
  head_commit: string | null;
  evidence_json: string | null;
  score: number | null;
  status: string;
  created_at: number;
}

interface ReviewRow {
  id: string;
  attempt_id: string;
  reviewer_id: string;
  model_family: string;
  verdict: string;
  score: number;
  notes: string | null;
  created_at: number;
}

interface AgentRow {
  id: string;
  roles: string;
  specialties: string;
  trust: number;
  tier: string;
  model_family: string;
  status: string;
  budget_remaining: number;
}

interface LedgerRow {
  id: string;
  task_id: string;
  merged_commit: string;
  intent: string;
  winner_attempt: string;
  alternatives_json: string;
  evidence_json: string;
  reviewers_json: string;
  shards_json: string;
  train_id: string | null;
  revisit_when: string | null;
  created_at: number;
}

function taskView(row: TaskRow) {
  return {
    id: row.id,
    repo: row.repo,
    title: row.title,
    intent: row.intent,
    tags: parseStringArray(row.tags),
    urgency: row.urgency,
    uncertainty: row.uncertainty,
    pathsHint: parseStringArray(row.paths_hint),
    state: row.state,
    stateDetail: row.state_detail,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function attemptView(row: AttemptRow) {
  return {
    id: row.id,
    taskId: row.task_id,
    agentId: row.agent_id,
    forkRepo: row.fork_repo,
    headCommit: row.head_commit,
    evidence: parseJsonValue(row.evidence_json),
    score: row.score,
    status: row.status,
    createdAt: row.created_at,
  };
}

function reviewView(row: ReviewRow) {
  return {
    id: row.id,
    attemptId: row.attempt_id,
    reviewerId: row.reviewer_id,
    modelFamily: row.model_family,
    verdict: row.verdict,
    score: row.score,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

async function pausedFlag(db: D1Database): Promise<boolean> {
  const row = await db.prepare("SELECT paused FROM control WHERE id = ?").bind("global").first<{ paused: number }>();
  return row?.paused === 1;
}

async function loadAttempts(db: D1Database, taskId?: string): Promise<AttemptRow[]> {
  if (taskId) {
    const result = await db
      .prepare("SELECT * FROM attempts WHERE task_id = ? ORDER BY created_at ASC")
      .bind(taskId)
      .all<AttemptRow>();
    return result.results;
  }
  const result = await db.prepare("SELECT * FROM attempts ORDER BY created_at ASC").all<AttemptRow>();
  return result.results;
}

api.get("/health", async (c) => {
  const paused = await pausedFlag(c.env.DB);
  return c.json({ ok: true, phase: PHASE, version: VERSION, paused, repo: DEMO_REPO, core: coreVersion() });
});

api.get("/scale", async (c) => {
  const now = Date.now();
  const db = c.env.DB;
  const [agentCount, liveClaims, eventCount, mergeCount, paused] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS n FROM agents").first<{ n: number }>(),
    listBoard(c.env, DEMO_REPO),
    db
      .prepare("SELECT COUNT(*) AS n FROM agent_events WHERE created_at >= ?")
      .bind(now - 60_000)
      .first<{ n: number }>(),
    db
      .prepare("SELECT COUNT(*) AS n FROM ledger WHERE created_at >= ?")
      .bind(now - 3_600_000)
      .first<{ n: number }>(),
    pausedFlag(db),
  ]);

  const shards = KNOWN_SHARDS.map((key) => {
    const claims = liveClaims.filter((claim) => claim.shards.includes(key)).length;
    const load = Math.min(1, Math.max(0, claims / 8));
    return { key, claims, churn: 0, load };
  });
  const ops = eventCount?.n ?? 0;
  return c.json({
    agents: agentCount?.n ?? 0,
    aliveClaims: liveClaims.length,
    shards,
    claimOpsPerSec: Math.round((ops / 60) * 1000) / 1000,
    mergesPerHour: mergeCount?.n ?? 0,
    tokenSpendPerHour: 0,
    paused,
  });
});

api.get("/repos/:repo/shards", (c) => {
  return c.json({
    repo: c.req.param("repo"),
    shardMapVersion: SHARD_MAP_VERSION,
    patterns: SHARD_PATTERNS,
    knownShards: KNOWN_SHARDS,
    source: "claim-board",
  });
});

api.get("/repos/:repo/board", async (c) => {
  const shard = c.req.query("shard");
  const claims = await listBoard(c.env, c.req.param("repo"), shard || undefined);
  return c.json({ claims, source: "claim-board" });
});

api.post("/claims", async (c) => {
  const body = requireRecord(await readBody(c));
  const agentId = requireString(body, "agentId");
  const taskId = requireString(body, "taskId");
  const paths = requireStringArray(body, "paths");
  if (paths.length === 0) throw new HttpError(400, "paths required");
  const intent = requireString(body, "intent");
  let strength0 = optionalNumber(body, "strength0");
  if (strength0 === undefined) {
    const agent = await c.env.DB
      .prepare("SELECT trust FROM agents WHERE id = ?")
      .bind(agentId)
      .first<{ trust: number }>();
    strength0 = agent?.trust ?? 1;
  }
  const now = Date.now();
  if (await admissionLimited(c.env, now)) {
    return c.json({ error: "shard busy", step: "admission" }, 429, { "retry-after": "2" });
  }
  const frozen = await frozenShards(c.env, DEMO_REPO, now);
  const wanted = shardsForPaths(paths);
  const blocked = wanted.filter((shard) => frozen.includes(shard));
  if (blocked.length) {
    throw new HttpError(423, `churn freeze on ${blocked.join(", ")}`);
  }
  const id = `claim_${crypto.randomUUID()}`;
  let granted: { id: string; shards: string[] };
  try {
    granted = await createClaim(c.env, DEMO_REPO, {
      id,
      agentId,
      taskId,
      paths,
      intent,
      strength0,
      lastHeartbeatMs: now,
    });
  } catch (error) {
    if (error instanceof ContendedError) {
      return c.json(
        { error: error.message, step: "detect", next: "negotiate", shard: error.shard, with: error.withId },
        409,
      );
    }
    if (error instanceof Error && error.message.includes("broad claim")) {
      throw new HttpError(400, error.message);
    }
    throw error;
  }
  await c.env.DB
    .prepare(
      `INSERT INTO claims (id, agent_id, task_id, paths, shards, shard_map_version, intent, strength0, last_heartbeat_ms, ttl_ms, released)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    )
    .bind(
      granted.id,
      agentId,
      taskId,
      JSON.stringify(paths),
      JSON.stringify(granted.shards),
      SHARD_MAP_VERSION,
      intent,
      strength0,
      now,
      CLAIM_TTL_MS,
    )
    .run();
  await c.env.DB.prepare(
    "INSERT INTO agent_events (id, agent_id, kind, task_id, delta_trust, created_at) VALUES (?, ?, 'claim', ?, NULL, ?)",
  )
    .bind(`evt_${crypto.randomUUID()}`, agentId, taskId, now)
    .run();
  return c.json({ ids: [granted.id], shards: granted.shards });
});

api.post("/conflicts/negotiate", async (c) => {
  const body = requireRecord(await readBody(c));
  const result = await negotiate(c.env, requireString(body, "holderId"), requireString(body, "challengerId"));
  if (!result.ok) throw new HttpError(404, result.reason);
  return c.json(result);
});

api.post("/tasks/:id/flip", async (c) => {
  const body = requireRecord(await readBody(c));
  const kind = requireString(body, "kind");
  if (kind !== "apply" && kind !== "revert") throw new HttpError(400, "kind must be apply or revert");
  const path = requireString(body, "path");
  const flip = await noteFlip(c.env, DEMO_REPO, path, kind);
  if (flip.pingPong) {
    await c.env.DB.prepare(
      "UPDATE tasks SET state = 'Escalated', state_detail = ?, updated_at = ? WHERE id = ?",
    )
      .bind(`ping-pong on ${path}`, Date.now(), c.req.param("id"))
      .run();
  }
  return c.json({ ok: true, pingPong: flip.pingPong, step: flip.pingPong ? "escalate" : kind });
});

api.get("/breakers", async (c) => {
  return c.json(await breakerStatus(c.env, DEMO_REPO));
});

api.delete("/claims/:id", async (c) => {
  const id = c.req.param("id");
  const found = await releaseClaim(c.env, DEMO_REPO, id);
  const existing = await c.env.DB.prepare("SELECT id FROM claims WHERE id = ?").bind(id).first<{ id: string }>();
  if (!found && !existing) throw new HttpError(404, "claim not found");
  await c.env.DB.prepare("UPDATE claims SET released = 1 WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

api.post("/agents/:id/heartbeat", async (c) => {
  const agentId = c.req.param("id");
  const body = requireRecord(await readBody(c));
  const listed = optionalStringArray(body, "claimIds");
  const now = Date.now();
  const refreshed =
    listed && listed.length === 0 ? 0 : await heartbeatClaims(c.env, DEMO_REPO, agentId, listed ?? null);
  await c.env.DB
    .prepare(
      "INSERT INTO agent_events (id, agent_id, kind, task_id, delta_trust, created_at) VALUES (?, ?, 'heartbeat', NULL, NULL, ?)",
    )
    .bind(`evt_${crypto.randomUUID()}`, agentId, now)
    .run();
  return c.json({ ok: true, refreshed });
});

api.post("/tasks", async (c) => {
  const body = requireRecord(await readBody(c));
  const title = requireString(body, "title");
  const intent = requireString(body, "intent");
  const tags = optionalStringArray(body, "tags") ?? [];
  const urgency = optionalNumber(body, "urgency") ?? 0.5;
  const uncertainty = optionalString(body, "uncertainty") ?? "Medium";
  if (uncertainty !== "Low" && uncertainty !== "Medium" && uncertainty !== "High") {
    throw new HttpError(400, "uncertainty must be Low, Medium, or High");
  }
  const pathsHint = optionalStringArray(body, "pathsHint") ?? [];
  const now = Date.now();
  const id = `task_${crypto.randomUUID()}`;
  await c.env.DB
    .prepare(
      `INSERT INTO tasks (id, repo, title, intent, tags, urgency, uncertainty, state, state_detail, paths_hint, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Open', NULL, ?, ?, ?)`,
    )
    .bind(id, DEMO_REPO, title, intent, JSON.stringify(tags), urgency, uncertainty, JSON.stringify(pathsHint), now, now)
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first<TaskRow>();
  if (!row) throw new HttpError(500, "task insert failed");
  return c.json(taskView(row));
});

api.get("/tasks", async (c) => {
  const db = c.env.DB;
  const [taskResult, attempts] = await Promise.all([
    db.prepare("SELECT * FROM tasks ORDER BY created_at DESC").all<TaskRow>(),
    loadAttempts(db),
  ]);
  const tasks = taskResult.results.map((row) => ({
    ...taskView(row),
    attempts: attempts.filter((attempt) => attempt.task_id === row.id).map(attemptView),
  }));
  return c.json({ tasks });
});

api.get("/tasks/:id", async (c) => {
  const id = c.req.param("id");
  const task = await c.env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first<TaskRow>();
  if (!task) throw new HttpError(404, "task not found");
  const attempts = await loadAttempts(c.env.DB, id);
  let reviews: ReviewRow[] = [];
  if (attempts.length > 0) {
    const placeholders = attempts.map(() => "?").join(", ");
    const result = await c.env.DB
      .prepare(`SELECT * FROM reviews WHERE attempt_id IN (${placeholders}) ORDER BY created_at ASC`)
      .bind(...attempts.map((attempt) => attempt.id))
      .all<ReviewRow>();
    reviews = result.results;
  }
  return c.json({
    task: taskView(task),
    attempts: attempts.map(attemptView),
    reviews: reviews.map(reviewView),
  });
});

api.post("/tasks/:id/attempts", async (c) => {
  const taskId = c.req.param("id");
  const body = requireRecord(await readBody(c));
  const agentId = optionalString(body, "agentId") ?? "operator";
  const slot = await openAttempt(c.env, taskId, agentId);
  if (!slot.ok) {
    if (slot.reason === "paused") throw new HttpError(423, "colony paused");
    if (slot.reason === "not found") throw new HttpError(404, "task not found");
    throw new HttpError(409, slot.reason);
  }
  return c.json({
    attemptId: slot.attemptId,
    remote: slot.remote,
    forkRepo: slot.forkRepo,
    forked: slot.forked,
  });
});

api.post("/attempts/:id/evidence", async (c) => {
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare("SELECT id FROM attempts WHERE id = ?").bind(id).first<{ id: string }>();
  if (!existing) throw new HttpError(404, "attempt not found");
  const body = requireRecord(await readBody(c));
  const requiredTestsPassed = requireBoolean(body, "requiredTestsPassed");
  const testsPassed = requireNumber(body, "testsPassed");
  const testsTotal = requireNumber(body, "testsTotal");
  const linesChanged = requireNumber(body, "linesChanged");
  const filesChanged = body.filesChanged;
  if (
    filesChanged !== undefined &&
    typeof filesChanged !== "number" &&
    !(Array.isArray(filesChanged) && filesChanged.every((item) => typeof item === "string"))
  ) {
    throw new HttpError(400, "filesChanged must be a number or string[]");
  }
  if (filesChanged === undefined) throw new HttpError(400, "filesChanged required");
  const agentRationale = requireString(body, "agentRationale");
  const benchDeltaPct = optionalNumber(body, "benchDeltaPct");
  const evidence: Record<string, unknown> = {
    requiredTestsPassed,
    testsPassed,
    testsTotal,
    linesChanged,
    filesChanged,
    agentRationale,
  };
  if (benchDeltaPct !== undefined) evidence.benchDeltaPct = benchDeltaPct;
  const saved = await submitEvidence(c.env, id, {
    requiredTestsPassed,
    testsPassed,
    testsTotal,
    linesChanged,
    filesChanged: Array.isArray(filesChanged) ? filesChanged : [],
    agentRationale,
  });
  return c.json(saved);
});

api.post("/reviews", async (c) => {
  const body = requireRecord(await readBody(c));
  const applied = await applyReview(c.env, {
    attemptId: requireString(body, "attemptId"),
    reviewerId: requireString(body, "reviewerId"),
    modelFamily: requireString(body, "modelFamily"),
    verdict: requireString(body, "verdict"),
    score: requireNumber(body, "score"),
    notes: optionalString(body, "notes"),
  });
  if (!applied.ok) throw new HttpError(404, applied.reason);
  return c.json(applied);
});

api.get("/repos/:repo/merge-queue", async (c) => {
  return c.json(await c.env.MERGE_QUEUE.getByName(c.req.param("repo")).status(c.req.param("repo")));
});

api.get("/ledger", async (c) => {
  const result = await c.env.DB.prepare("SELECT * FROM ledger ORDER BY created_at DESC").all<LedgerRow>();
  const entries = result.results.map((row) => ({
    id: row.id,
    taskId: row.task_id,
    mergedCommit: row.merged_commit,
    intent: row.intent,
    winnerAttempt: row.winner_attempt,
    alternatives: parseStringArray(row.alternatives_json),
    evidenceSummary: evidenceSummary(row.evidence_json),
    reviewers: parseStringArray(row.reviewers_json),
    shards: parseStringArray(row.shards_json),
    trainId: row.train_id,
    revisitWhen: row.revisit_when,
    createdAt: row.created_at,
  }));
  return c.json({ entries });
});

api.get("/escalations", async (c) => {
  const result = await c.env.DB
    .prepare("SELECT id, title, state_detail, created_at FROM tasks WHERE state = 'Escalated' ORDER BY created_at DESC")
    .all<{ id: string; title: string; state_detail: string | null; created_at: number }>();
  return c.json({
    escalations: result.results.map((row) => ({
      taskId: row.id,
      title: row.title,
      reason: row.state_detail ?? "",
      createdAt: row.created_at,
    })),
  });
});

api.post("/tasks/:id/decide", async (c) => {
  const taskId = c.req.param("id");
  const task = await c.env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first<TaskRow>();
  if (!task) throw new HttpError(404, "task not found");
  const body = requireRecord(await readBody(c));
  const decision = requireString(body, "decision");
  const note = optionalString(body, "note");
  const now = Date.now();
  if (decision === "approve") {
    const existing = await c.env.DB
      .prepare("SELECT id FROM ledger WHERE task_id = ?")
      .bind(taskId)
      .first<{ id: string }>();
    const statements: D1PreparedStatement[] = [
      c.env.DB
        .prepare("UPDATE tasks SET state = 'Merged', state_detail = ?, updated_at = ? WHERE id = ?")
        .bind(note ?? task.state_detail, now, taskId),
    ];
    if (!existing) {
      const attempts = await loadAttempts(c.env.DB, taskId);
      const winner = attempts[attempts.length - 1];
      const reviews = winner
        ? (
            await c.env.DB
              .prepare("SELECT reviewer_id FROM reviews WHERE attempt_id = ?")
              .bind(winner.id)
              .all<{ reviewer_id: string }>()
          ).results.map((row) => row.reviewer_id)
        : [];
      statements.push(
        c.env.DB
          .prepare(
            `INSERT INTO ledger (id, task_id, merged_commit, intent, winner_attempt, alternatives_json, evidence_json, reviewers_json, shards_json, train_id, revisit_when, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
          )
          .bind(
            `led_${crypto.randomUUID()}`,
            taskId,
            winner?.head_commit ?? `human-${taskId}`,
            task.intent,
            winner?.id ?? "none",
            JSON.stringify(attempts.filter((attempt) => attempt.id !== winner?.id).map((attempt) => attempt.id)),
            winner?.evidence_json ?? "{}",
            JSON.stringify(reviews),
            JSON.stringify(shardsForPaths(parseStringArray(task.paths_hint))),
            now,
          ),
      );
    }
    statements.push(
      c.env.DB
        .prepare(
          "INSERT INTO agent_events (id, agent_id, kind, task_id, delta_trust, created_at) VALUES (?, 'human', 'human_approve', ?, NULL, ?)",
        )
        .bind(`evt_${crypto.randomUUID()}`, taskId, now),
    );
    await c.env.DB.batch(statements);
    return c.json({ ok: true, state: "Merged" });
  }
  if (decision === "reject") {
    await c.env.DB
      .prepare("UPDATE tasks SET state = 'Abandoned', state_detail = ?, updated_at = ? WHERE id = ?")
      .bind(note ?? "rejected by human", now, taskId)
      .run();
    return c.json({ ok: true, state: "Abandoned" });
  }
  throw new HttpError(400, "decision must be approve or reject");
});

api.post("/agents/:id/tick", async (c) => {
  const agentId = c.req.param("id");
  const res = await c.env.AGENT_WORKER.fetch(
    new Request(`https://colony-agent/tick?agent=${encodeURIComponent(agentId)}`, { method: "POST" }),
  );
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
});

api.get("/agents", async (c) => {
  const result = await c.env.DB.prepare("SELECT * FROM agents ORDER BY id ASC").all<AgentRow>();
  return c.json({
    agents: result.results.map((row) => ({
      id: row.id,
      roles: parseStringArray(row.roles),
      specialties: parseStringArray(row.specialties),
      trust: row.trust,
      tier: row.tier,
      modelFamily: row.model_family,
      status: row.status,
      budgetRemaining: row.budget_remaining,
    })),
  });
});

api.post("/admin/pause", async (c) => {
  const now = Date.now();
  await c.env.DB
    .prepare(
      `INSERT INTO control (id, paused, updated_at) VALUES ('global', 1, ?)
       ON CONFLICT(id) DO UPDATE SET paused = 1, updated_at = excluded.updated_at`,
    )
    .bind(now)
    .run();
  return c.json({ ok: true, paused: true });
});

api.post("/admin/resume", async (c) => {
  const now = Date.now();
  await c.env.DB
    .prepare(
      `INSERT INTO control (id, paused, updated_at) VALUES ('global', 0, ?)
       ON CONFLICT(id) DO UPDATE SET paused = 0, updated_at = excluded.updated_at`,
    )
    .bind(now)
    .run();
  return c.json({ ok: true, paused: false });
});

api.post("/admin/seed", async (c) => {
  const seeded = await seedColony(c.env.DB);
  return c.json({ ok: true, seeded });
});

api.post("/admin/seed-scale", async (c) => c.json(await seedScale(c.env, 50)));

api.post("/admin/demo/parallel", async (c) => c.json(await runParallelDemo(c.env)));
api.post("/admin/demo/swarm", async (c) => c.json(await runSwarm(c.env)));
api.post("/admin/demo/conflict", async (c) => c.json(await runConflict(c.env)));
api.post("/admin/repo-files", async (c) => {
  const packed = await repoFiles(c.env);
  let remote: string | null = null;
  let token: string | undefined;
  if (c.env.ARTIFACTS) {
    try {
      const repo = await c.env.ARTIFACTS.get(DEMO_REPO);
      if (repo) {
        const info = await repo.info();
        remote = info.remote ?? null;
        const minted = await repo.createToken?.("write", 3600);
        token = minted?.plaintext ?? minted?.token;
      }
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : "token failed" }, 502);
    }
  }
  const res = await c.env.AGENT_WORKER.fetch("https://colony-agent/git", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...packed, remote, token }),
  });
  const text = await res.text();
  return new Response(text.replaceAll(token ?? "__none__", "[redacted]"), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
});

api.get("/repos/:repo/colony-toml", async (c) => c.json(await loadColonyToml(c.env, c.req.param("repo"))));

api.get("/ledger/:taskId/file", async (c) => {
  const row = await c.env.DB.prepare("SELECT path, markdown FROM ledger_files WHERE task_id = ?")
    .bind(c.req.param("taskId"))
    .first<{ path: string; markdown: string }>();
  if (!row) throw new HttpError(404, "ledger file not found");
  return c.json(row);
});

api.post("/tasks/:id/arbitrate", async (c) => {
  const now = Date.now();
  await c.env.DB.prepare(
    "UPDATE tasks SET state = 'Escalated', state_detail = ?, updated_at = ? WHERE id = ?",
  )
    .bind("arbiter requested a human decision", now, c.req.param("id"))
    .run();
  return c.json({ ok: true, step: "arbiter", state: "Escalated" });
});

api.get("/artifacts", async (c) => {
  if (!c.env.ARTIFACTS) return c.json({ bound: false, repos: [] });
  try {
    const page = await c.env.ARTIFACTS.list({ limit: 20 });
    const repos = repoNames(page);
    return c.json({ bound: true, namespace: "colony-demo", repos });
  } catch (error) {
    return c.json({
      bound: true,
      ok: false,
      error: error instanceof Error ? error.message : "artifacts list failed",
    });
  }
});

api.post("/admin/artifacts/ensure", async (c) => {
  if (!c.env.ARTIFACTS) throw new HttpError(500, "artifacts binding missing");
  try {
    let remote: string | null = null;
    let created = false;
    try {
      const existing = await c.env.ARTIFACTS.get(DEMO_REPO);
      if (existing) {
        const info = await existing.info();
        remote = info.remote ?? null;
      }
    } catch {
      remote = null;
    }
    if (!remote) {
      const made = await c.env.ARTIFACTS.create(DEMO_REPO, { description: "Colony demo main repo" });
      remote = made.remote;
      created = true;
    }
    await c.env.EVENTS.send({
      type: created ? "cf.artifacts.repo.created" : "cf.artifacts.repo.ensured",
      repo: DEMO_REPO,
      at: Date.now(),
    });
    return c.json({ ok: true, created, name: DEMO_REPO, remote });
  } catch (error) {
    const message = error instanceof Error ? error.message : "artifacts ensure failed";
    console.error(JSON.stringify({ message: "artifacts ensure failed", error: message }));
    return c.json({ ok: false, error: message }, 502);
  }
});

api.get("/events", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, kind, repo_name, payload, created_at FROM artifact_events ORDER BY created_at DESC LIMIT 20",
  ).all<{ id: string; kind: string; repo_name: string | null; payload: string; created_at: number }>();
  return c.json({
    events: rows.results.map((row) => ({
      id: row.id,
      kind: row.kind,
      repo: row.repo_name,
      payload: parseJsonValue(row.payload),
      createdAt: row.created_at,
    })),
  });
});

api.post("/repos", async (c) => {
  const body = requireRecord(await readBody(c));
  const name = optionalString(body, "name");
  return c.json({
    repo: name || DEMO_REPO,
    shardMapVersion: SHARD_MAP_VERSION,
    patterns: SHARD_PATTERNS,
  });
});

api.notFound((c) => c.json({ error: "not found" }, 404));

app.route("/api", api);

app.get("/ws/agents/:id", (c) => {
  const url = new URL(c.req.url);
  url.searchParams.set("agent", c.req.param("id"));
  return c.env.TRUST_REGISTRY.getByName("colony").fetch(new Request(url, c.req.raw));
});

app.notFound(async (c) => {
  try {
    return await c.env.ASSETS.fetch(c.req.raw);
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "assets fetch failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return c.json({ error: "not found" }, 404);
  }
});

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  console.error(
    JSON.stringify({
      message: "unhandled error",
      error: err instanceof Error ? err.message : String(err),
      path: c.req.path,
    }),
  );
  return c.json({ error: "internal error" }, 500);
});

export { ClaimBoard, ColonyRpc };
export { MergeQueue } from "./merge-queue";
export { TrustRegistry } from "./trust-registry";
export { TaskColony } from "./task-colony";

function eventRepo(body: unknown): string | null {
  if (!isRecord(body)) return null;
  if (typeof body.repo === "string") return body.repo;
  if (isRecord(body.source) && typeof body.source.repoName === "string") return body.source.repoName;
  return null;
}

function eventCommit(body: unknown): string | null {
  if (!isRecord(body) || !isRecord(body.payload)) return null;
  return typeof body.payload.after === "string" ? body.payload.after : null;
}

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<unknown>, env: Env) {
    for (const msg of batch.messages) {
      const body = msg.body;
      const kind = isRecord(body) && typeof body.type === "string" ? body.type : "unknown";
      const repo = eventRepo(body);
      await env.DB.prepare(
        "INSERT OR IGNORE INTO artifact_events (id, kind, repo_name, payload, created_at) VALUES (?, ?, ?, ?, ?)",
      )
        .bind(msg.id, kind, repo, JSON.stringify(body ?? {}), Date.now())
        .run();
      if (kind === "cf.artifacts.repo.pushed" && repo) {
        const match = repo.match(/--t(.+)--a\d+$/);
        const commit = eventCommit(body);
        if (match && commit) {
          await env.TASK_COLONY.getByName(match[1]).notePush(repo, commit);
        }
      }
      msg.ack();
    }
  },
};
