import { churnFrozen, pingPong } from "./core";
import type { Env } from "./env";

const WINDOW_MS = 30 * 60 * 1000;
const CHURN_LIMIT = 4;
const ADMISSION_WINDOW_MS = 10_000;
const ADMISSION_LIMIT = 40;

export async function recordLandings(env: Env, repo: string, shards: string[], now = Date.now()) {
  if (shards.length === 0) return;
  await env.DB.batch(
    shards.map((shard) =>
      env.DB.prepare(
        "INSERT INTO shard_landings (id, repo, shard, created_at) VALUES (?, ?, ?, ?)",
      ).bind(`land_${crypto.randomUUID()}`, repo, shard, now),
    ),
  );
}

export async function frozenShards(env: Env, repo: string, now = Date.now()): Promise<string[]> {
  const rows = await env.DB.prepare(
    `SELECT shard, COUNT(*) AS n FROM shard_landings
     WHERE repo = ? AND created_at >= ?
     GROUP BY shard`,
  )
    .bind(repo, now - WINDOW_MS)
    .all<{ shard: string; n: number }>();
  return rows.results.filter((row) => churnFrozen(row.n)).map((row) => row.shard);
}

export async function admissionLimited(env: Env, now = Date.now()): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM agent_events WHERE kind = 'claim' AND created_at >= ?",
  )
    .bind(now - ADMISSION_WINDOW_MS)
    .first<{ n: number }>();
  return (row?.n ?? 0) >= ADMISSION_LIMIT;
}

export async function noteFlip(env: Env, repo: string, path: string, kind: "apply" | "revert") {
  await env.DB.prepare(
    "INSERT INTO path_flips (id, repo, path, kind, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(`flip_${crypto.randomUUID()}`, repo, path, kind, Date.now())
    .run();
  const rows = await env.DB.prepare(
    "SELECT kind FROM path_flips WHERE repo = ? AND path = ? ORDER BY created_at DESC LIMIT 4",
  )
    .bind(repo, path)
    .all<{ kind: string }>();
  const kinds = rows.results.map((row) => row.kind);
  const flips = Math.min(
    kinds.filter((kind) => kind === "revert").length,
    kinds.filter((kind) => kind === "apply").length,
  );
  return { pingPong: pingPong(flips) };
}

export async function breakerStatus(env: Env, repo: string) {
  const frozen = await frozenShards(env, repo);
  const limited = await admissionLimited(env);
  return {
    frozen,
    admission: limited ? "limited" : "open",
    churnLimit: CHURN_LIMIT,
    windowMin: 30,
  };
}
