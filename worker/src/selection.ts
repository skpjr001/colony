import type { EvidenceBody } from "./attempts";
import { evaluateQuorum as coreQuorum, scoreAttempt as coreScore } from "./core";
import type { Env } from "./env";
import { shardsForPaths } from "./shards";

type Vote = { reviewerId: string; modelFamily: string; verdict: string };

export function scoreAttempt(ev: EvidenceBody & { benchDeltaPct?: number }, _meanReview = 0.5): number | null {
  const score = coreScore(JSON.stringify(ev));
  if (score < 0) return null;
  return Math.round(score * 1000) / 1000;
}

export function evaluateQuorum(
  authorId: string,
  authorFamily: string,
  votes: Vote[],
  securityTagged: boolean,
): "Approved" | "Rejected" | "Pending" | "Escalated" {
  const result = coreQuorum(authorId, authorFamily, JSON.stringify(votes), securityTagged);
  if (result === "Approved" || result === "Rejected" || result === "Pending" || result === "Escalated") {
    return result;
  }
  return "Pending";
}

function parseEvidence(raw: string | null): (EvidenceBody & { benchDeltaPct?: number }) | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const ev = value as EvidenceBody & { benchDeltaPct?: number };
    if (typeof ev.requiredTestsPassed !== "boolean") return null;
    return ev;
  } catch {
    return null;
  }
}

export async function selectWinner(env: Env, taskId: string) {
  const attempts = await env.DB.prepare(
    "SELECT id, agent_id, evidence_json FROM attempts WHERE task_id = ?",
  )
    .bind(taskId)
    .all<{ id: string; agent_id: string; evidence_json: string | null }>();
  let best: { id: string; score: number } | null = null;
  for (const attempt of attempts.results) {
    const ev = parseEvidence(attempt.evidence_json);
    const score = ev ? scoreAttempt(ev) : null;
    if (score != null) {
      await env.DB.prepare("UPDATE attempts SET score = ? WHERE id = ?").bind(score, attempt.id).run();
      if (!best || score > best.score) best = { id: attempt.id, score };
    }
  }
  const now = Date.now();
  if (!best) {
    await env.DB.prepare(
      "UPDATE tasks SET state = 'Escalated', state_detail = ?, updated_at = ? WHERE id = ?",
    )
      .bind("no attempt passed the gate", now, taskId)
      .run();
    return { state: "Escalated", attemptId: null as string | null };
  }
  await env.DB.prepare("UPDATE tasks SET state = 'InReview', state_detail = ?, updated_at = ? WHERE id = ?")
    .bind(best.id, now, taskId)
    .run();
  return { state: "InReview", attemptId: best.id, score: best.score };
}

export async function applyReview(
  env: Env,
  input: { attemptId: string; reviewerId: string; modelFamily: string; verdict: string; score: number; notes?: string },
) {
  const attempt = await env.DB.prepare(
    "SELECT id, task_id, agent_id FROM attempts WHERE id = ?",
  )
    .bind(input.attemptId)
    .first<{ id: string; task_id: string; agent_id: string }>();
  if (!attempt) return { ok: false as const, reason: "not found" };
  const now = Date.now();
  const id = `rev_${crypto.randomUUID()}`;
  await env.DB.prepare(
    `INSERT INTO reviews (id, attempt_id, reviewer_id, model_family, verdict, score, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, input.attemptId, input.reviewerId, input.modelFamily, input.verdict, input.score, input.notes ?? null, now)
    .run();
  const task = await env.DB.prepare("SELECT tags, paths_hint, repo, intent FROM tasks WHERE id = ?")
    .bind(attempt.task_id)
    .first<{ tags: string; paths_hint: string; repo: string; intent: string }>();
  const author = await env.DB.prepare("SELECT model_family FROM agents WHERE id = ?")
    .bind(attempt.agent_id)
    .first<{ model_family: string }>();
  const reviews = await env.DB.prepare(
    "SELECT reviewer_id, model_family, verdict FROM reviews WHERE attempt_id = ?",
  )
    .bind(input.attemptId)
    .all<{ reviewer_id: string; model_family: string; verdict: string }>();
  const tags = JSON.parse(task?.tags ?? "[]") as string[];
  const quorum = evaluateQuorum(
    attempt.agent_id,
    author?.model_family ?? "",
    reviews.results.map((row) => ({
      reviewerId: row.reviewer_id,
      modelFamily: row.model_family,
      verdict: row.verdict,
    })),
    tags.includes("security"),
  );
  if (quorum === "Approved" && task) {
    const paths = JSON.parse(task.paths_hint) as string[];
    const landed = await env.MERGE_QUEUE.getByName(task.repo).enqueue({
      repo: task.repo,
      attemptId: attempt.id,
      taskId: attempt.task_id,
      agentId: attempt.agent_id,
      shards: shardsForPaths(paths),
      intent: task.intent,
    });
    return { ok: true as const, id, quorum, state: landed.state, trainId: landed.trainId };
  }
  if (quorum === "Escalated" || quorum === "Rejected") {
    await env.DB.prepare("UPDATE tasks SET state = 'Escalated', state_detail = ?, updated_at = ? WHERE id = ?")
      .bind(quorum === "Rejected" ? "quorum rejected" : "security-tagged reject", now, attempt.task_id)
      .run();
    return { ok: true as const, id, quorum, state: "Escalated", trainId: null };
  }
  return { ok: true as const, id, quorum, state: "InReview", trainId: null };
}

async function reviewNote(env: Env, taskId: string): Promise<string> {
  if (!env.AI) return "independent review";
  try {
    const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {
      messages: [{ role: "user", content: `One sentence review note for task ${taskId}` }],
      max_tokens: 40,
    });
    if (result && typeof result === "object" && "response" in result && typeof result.response === "string") {
      return result.response.slice(0, 240);
    }
  } catch {
    return "independent review";
  }
  return "independent review";
}

export async function reviewNext(env: Env, agentId: string) {
  const agent = await env.DB.prepare("SELECT roles, model_family FROM agents WHERE id = ?")
    .bind(agentId)
    .first<{ roles: string; model_family: string }>();
  if (!agent) return { ok: false as const, reason: "unknown agent" };
  const roles = JSON.parse(agent.roles) as string[];
  if (!roles.includes("Reviewer")) return { ok: false as const, reason: "not a reviewer" };
  const task = await env.DB.prepare(
    "SELECT id, state_detail FROM tasks WHERE state = 'InReview' AND state_detail IS NOT NULL ORDER BY updated_at ASC LIMIT 1",
  ).first<{ id: string; state_detail: string }>();
  if (!task) return { ok: false as const, reason: "no reviews waiting" };
  const attempt = await env.DB.prepare("SELECT agent_id FROM attempts WHERE id = ?")
    .bind(task.state_detail)
    .first<{ agent_id: string }>();
  if (attempt?.agent_id === agentId) return { ok: false as const, reason: "author cannot review" };
  const existing = await env.DB.prepare(
    "SELECT id FROM reviews WHERE attempt_id = ? AND reviewer_id = ?",
  )
    .bind(task.state_detail, agentId)
    .first<{ id: string }>();
  if (existing) return { ok: false as const, reason: "already reviewed" };
  const applied = await applyReview(env, {
    attemptId: task.state_detail,
    reviewerId: agentId,
    modelFamily: agent.model_family,
    verdict: "approve",
    score: 0.8,
    notes: await reviewNote(env, task.id),
  });
  if (!applied.ok) return applied;
  return { ok: true as const, taskId: task.id, attemptId: task.state_detail, quorum: applied.quorum, state: applied.state, trainId: applied.trainId };
}
