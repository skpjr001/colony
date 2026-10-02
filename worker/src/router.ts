import type { ClaimInput } from "./claim-board";
import { CLAIM_TTL_MS } from "./decay";
import type { Env } from "./env";
import { DEMO_REPO, KNOWN_SHARDS, SHARD_MAP_VERSION, shardsForPaths } from "./shards";

export const MAX_FANOUT = 8;

export type LiveClaim = ClaimInput & { strength: number; alive: boolean };

export class ContendedError extends Error {
  constructor(
    readonly shard: string,
    readonly withId: string,
    readonly holderStrength: number,
  ) {
    super(`contended on ${shard} with ${withId}`);
    this.name = "ContendedError";
  }
}

function stub(env: Env, repo: string, shard: string) {
  return env.CLAIM_BOARD.getByName(`${repo}::${shard}`);
}

function inputOf(row: {
  id: string;
  agent_id: string;
  task_id: string;
  paths: string;
  shards: string;
  shard_map_version: number;
  intent: string;
  strength0: number;
  last_heartbeat_ms: number;
  ttl_ms: number;
}): ClaimInput {
  return {
    id: row.id,
    agentId: row.agent_id,
    taskId: row.task_id,
    paths: JSON.parse(row.paths) as string[],
    shards: JSON.parse(row.shards) as string[],
    shardMapVersion: row.shard_map_version,
    intent: row.intent,
    strength0: row.strength0,
    lastHeartbeatMs: row.last_heartbeat_ms,
    ttlMs: row.ttl_ms,
  };
}

export async function ensureHydrated(env: Env, repo = DEMO_REPO): Promise<void> {
  const flag = await env.DB.prepare("SELECT value FROM flags WHERE id = ?")
    .bind("claims_hydrated")
    .first<{ value: number }>();
  if (flag?.value === 1) return;
  const rows = await env.DB.prepare(
    "SELECT id, agent_id, task_id, paths, shards, shard_map_version, intent, strength0, last_heartbeat_ms, ttl_ms FROM claims WHERE released = 0",
  ).all<{
    id: string;
    agent_id: string;
    task_id: string;
    paths: string;
    shards: string;
    shard_map_version: number;
    intent: string;
    strength0: number;
    last_heartbeat_ms: number;
    ttl_ms: number;
  }>();
  for (const row of rows.results) {
    const claim = inputOf(row);
    for (const shard of claim.shards) {
      await stub(env, repo, shard).putLive(claim);
    }
  }
  await env.DB.prepare(
    "INSERT INTO flags (id, value) VALUES ('claims_hydrated', 1) ON CONFLICT(id) DO UPDATE SET value = 1",
  ).run();
}

export async function createClaim(
  env: Env,
  repo: string,
  claim: Omit<ClaimInput, "shards" | "shardMapVersion" | "ttlMs" | "lastHeartbeatMs"> & {
    lastHeartbeatMs?: number;
  },
): Promise<{ id: string; shards: string[] }> {
  const shards = shardsForPaths(claim.paths).sort();
  if (shards.length > MAX_FANOUT) {
    throw new Error("broad claim exceeds max fanout");
  }
  const input: ClaimInput = {
    ...claim,
    shards,
    shardMapVersion: SHARD_MAP_VERSION,
    ttlMs: CLAIM_TTL_MS,
    lastHeartbeatMs: claim.lastHeartbeatMs ?? Date.now(),
  };
  const reserved: string[] = [];
  for (const shard of shards) {
    const result = await stub(env, repo, shard).reserve(input);
    if (result.status === "Contended") {
      for (const held of reserved) await stub(env, repo, held).abort(input.id);
      throw new ContendedError(shard, result.with, result.holderStrength);
    }
    reserved.push(shard);
  }
  for (const shard of reserved) await stub(env, repo, shard).commit(input.id);
  return { id: input.id, shards };
}

export async function listBoard(env: Env, repo: string, shard?: string): Promise<LiveClaim[]> {
  await ensureHydrated(env, repo);
  const keys = shard ? [shard] : [...KNOWN_SHARDS];
  const groups = await Promise.all(keys.map((key) => stub(env, repo, key).list()));
  const seen = new Set<string>();
  const claims: LiveClaim[] = [];
  for (const group of groups) {
    for (const claim of group) {
      if (seen.has(claim.id)) continue;
      seen.add(claim.id);
      claims.push(claim);
    }
  }
  return claims;
}

export async function heartbeatClaims(
  env: Env,
  repo: string,
  agentId: string,
  claimIds: string[] | null,
): Promise<number> {
  const now = Date.now();
  const results = await Promise.all(
    KNOWN_SHARDS.map((shard) => stub(env, repo, shard).heartbeat(agentId, claimIds, now)),
  );
  return results.reduce((sum, item) => sum + item.refreshed, 0);
}

export async function releaseClaim(env: Env, repo: string, id: string): Promise<boolean> {
  const results = await Promise.all(KNOWN_SHARDS.map((shard) => stub(env, repo, shard).release(id)));
  return results.some((item) => item.found);
}
