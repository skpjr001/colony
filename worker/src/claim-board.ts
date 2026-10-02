import { DurableObject } from "cloudflare:workers";
import { isAlive, roundedStrength } from "./decay";
import type { Env } from "./env";

export type ClaimInput = {
  id: string;
  agentId: string;
  taskId: string;
  paths: string[];
  shards: string[];
  shardMapVersion: number;
  intent: string;
  strength0: number;
  lastHeartbeatMs: number;
  ttlMs: number;
};

export type ReserveResult =
  | { status: "Granted" | "Shared" }
  | { status: "Contended"; with: string; holderStrength: number };

type Stored = {
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
  released: number;
  kind: string;
};

const RESERVE_MS = 10_000;

function literalPrefix(glob: string): string {
  const parts: string[] = [];
  for (const part of glob.split("/")) {
    if (/[*?[]/.test(part)) break;
    parts.push(part);
  }
  return parts.join("/");
}

function globsOverlap(a: string, b: string): boolean {
  const left = literalPrefix(a);
  const right = literalPrefix(b);
  if (!left || !right) return true;
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function pathsOverlap(a: string[], b: string[]): boolean {
  for (const left of a) {
    for (const right of b) {
      if (globsOverlap(left, right)) return true;
    }
  }
  return false;
}

function parsePaths(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  } catch {
    return [];
  }
  return [];
}

export class ClaimBoard extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS claims (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          paths TEXT NOT NULL,
          shards TEXT NOT NULL,
          shard_map_version INTEGER NOT NULL,
          intent TEXT NOT NULL,
          strength0 REAL NOT NULL,
          last_heartbeat_ms INTEGER NOT NULL,
          ttl_ms INTEGER NOT NULL,
          released INTEGER NOT NULL DEFAULT 0,
          kind TEXT NOT NULL
        )
      `);
    });
  }

  private rows(): Stored[] {
    return this.ctx.storage.sql.exec<Stored>("SELECT * FROM claims").toArray();
  }

  private sweep(now: number): void {
    for (const row of this.rows()) {
      if (row.kind === "reserve" && now >= row.last_heartbeat_ms + RESERVE_MS) {
        this.ctx.storage.sql.exec("DELETE FROM claims WHERE id = ? AND kind = 'reserve'", row.id);
        continue;
      }
      if (
        row.kind === "live" &&
        !isAlive(row.strength0, row.last_heartbeat_ms, row.ttl_ms, row.released, now)
      ) {
        this.ctx.storage.sql.exec("DELETE FROM claims WHERE id = ?", row.id);
      }
    }
  }

  private arm(now: number): void {
    const left = this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM claims").one();
    if (left.n > 0) this.ctx.storage.setAlarm(now + 30_000);
  }

  private write(input: ClaimInput, kind: "live" | "reserve"): void {
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO claims
        (id, agent_id, task_id, paths, shards, shard_map_version, intent, strength0, last_heartbeat_ms, ttl_ms, released, kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      input.id,
      input.agentId,
      input.taskId,
      JSON.stringify(input.paths),
      JSON.stringify(input.shards),
      input.shardMapVersion,
      input.intent,
      input.strength0,
      input.lastHeartbeatMs,
      input.ttlMs,
      kind,
    );
  }

  reserve(input: ClaimInput): ReserveResult {
    const now = Date.now();
    this.sweep(now);
    const existing = this.ctx.storage.sql
      .exec<Pick<Stored, "kind">>("SELECT kind FROM claims WHERE id = ?", input.id)
      .toArray()[0];
    if (existing?.kind === "live") return { status: "Granted" };
    let shared = false;
    for (const row of this.rows()) {
      if (row.kind !== "live" || row.released === 1) continue;
      if (!isAlive(row.strength0, row.last_heartbeat_ms, row.ttl_ms, row.released, now)) continue;
      if (!pathsOverlap(input.paths, parsePaths(row.paths))) continue;
      if (row.task_id === input.taskId) {
        shared = true;
        continue;
      }
      return {
        status: "Contended",
        with: row.id,
        holderStrength: roundedStrength(row.strength0, row.last_heartbeat_ms, now),
      };
    }
    this.write({ ...input, lastHeartbeatMs: now }, "reserve");
    this.arm(now);
    return { status: shared ? "Shared" : "Granted" };
  }

  commit(id: string): { ok: boolean } {
    const now = Date.now();
    this.ctx.storage.sql.exec(
      "UPDATE claims SET kind = 'live', last_heartbeat_ms = ? WHERE id = ? AND kind = 'reserve'",
      now,
      id,
    );
    this.arm(now);
    return { ok: true };
  }

  abort(id: string): { ok: boolean } {
    this.ctx.storage.sql.exec("DELETE FROM claims WHERE id = ? AND kind = 'reserve'", id);
    return { ok: true };
  }

  putLive(input: ClaimInput): { ok: boolean } {
    const now = Date.now();
    this.write(input, "live");
    this.arm(now);
    return { ok: true };
  }

  heartbeat(agentId: string, claimIds: string[] | null, now: number): { refreshed: number } {
    const rows = this.rows().filter(
      (row) =>
        row.kind === "live" &&
        row.released === 0 &&
        row.agent_id === agentId &&
        (claimIds === null || claimIds.includes(row.id)),
    );
    for (const row of rows) {
      this.ctx.storage.sql.exec("UPDATE claims SET last_heartbeat_ms = ? WHERE id = ?", now, row.id);
    }
    if (rows.length) this.arm(now);
    return { refreshed: rows.length };
  }

  release(id: string): { found: boolean } {
    const row = this.ctx.storage.sql
      .exec<Pick<Stored, "id">>("SELECT id FROM claims WHERE id = ?", id)
      .toArray()[0];
    if (!row) return { found: false };
    this.ctx.storage.sql.exec("UPDATE claims SET released = 1 WHERE id = ?", id);
    return { found: true };
  }

  list(): Array<ClaimInput & { strength: number; alive: boolean }> {
    const now = Date.now();
    this.sweep(now);
    return this.rows()
      .filter((row) => row.kind === "live" && row.released === 0)
      .map((row) => ({
        id: row.id,
        agentId: row.agent_id,
        taskId: row.task_id,
        paths: parsePaths(row.paths),
        shards: parsePaths(row.shards),
        shardMapVersion: row.shard_map_version,
        intent: row.intent,
        strength0: row.strength0,
        lastHeartbeatMs: row.last_heartbeat_ms,
        ttlMs: row.ttl_ms,
        strength: roundedStrength(row.strength0, row.last_heartbeat_ms, now),
        alive: isAlive(row.strength0, row.last_heartbeat_ms, row.ttl_ms, row.released, now),
      }))
      .filter((claim) => claim.alive);
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    this.sweep(now);
    this.arm(now);
  }
}
