import type { Env } from "./env";
import { releaseClaim } from "./router";
import { DEMO_REPO } from "./shards";

type ClaimRow = {
  id: string;
  agent_id: string;
  strength0: number;
  last_heartbeat_ms: number;
  released: number;
};

export async function negotiate(env: Env, holderId: string, challengerId: string) {
  const rows = await env.DB.prepare(
    "SELECT id, agent_id, strength0, last_heartbeat_ms, released FROM claims WHERE id IN (?, ?)",
  )
    .bind(holderId, challengerId)
    .all<ClaimRow>();
  const holder = rows.results.find((row) => row.id === holderId);
  const challenger = rows.results.find((row) => row.id === challengerId);
  if (!holder || !challenger) return { ok: false as const, reason: "claim not found", step: "detect" };
  if (holder.strength0 === challenger.strength0) {
    return {
      ok: true as const,
      step: "escalate" as const,
      yielded: null,
      reason: "equal strength",
    };
  }
  const yielded = holder.strength0 < challenger.strength0 ? holder : challenger;
  await releaseClaim(env, DEMO_REPO, yielded.id);
  await env.DB.prepare("UPDATE claims SET released = 1 WHERE id = ?").bind(yielded.id).run();
  return {
    ok: true as const,
    step: "negotiate" as const,
    yielded: yielded.id,
    kept: yielded.id === holder.id ? challenger.id : holder.id,
  };
}
