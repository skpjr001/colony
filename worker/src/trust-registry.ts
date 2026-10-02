import { DurableObject } from "cloudflare:workers";
import { tierFor, trustScore } from "./core";
import type { Env } from "./env";

type Profile = {
  id: string;
  roles: string;
  specialties: string;
  trust: number;
  tier: string;
  model_family: string;
  status: string;
  merges: number;
};

export class TrustRegistry extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS profiles (
          id TEXT PRIMARY KEY,
          roles TEXT NOT NULL,
          specialties TEXT NOT NULL,
          trust REAL NOT NULL,
          tier TEXT NOT NULL,
          model_family TEXT NOT NULL,
          status TEXT NOT NULL,
          merges INTEGER NOT NULL DEFAULT 0
        )
      `);
    });
  }

  async syncFromD1(): Promise<number> {
    const rows = await this.env.DB.prepare(
      "SELECT id, roles, specialties, trust, tier, model_family, status FROM agents",
    ).all<Omit<Profile, "merges">>();
    for (const row of rows.results) {
      this.ctx.storage.sql.exec(
        `INSERT INTO profiles (id, roles, specialties, trust, tier, model_family, status, merges)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET
           roles = excluded.roles,
           specialties = excluded.specialties,
           trust = excluded.trust,
           tier = excluded.tier,
           model_family = excluded.model_family,
           status = excluded.status`,
        row.id,
        row.roles,
        row.specialties,
        row.trust,
        row.tier,
        row.model_family,
        row.status,
      );
    }
    return rows.results.length;
  }

  async recordMerge(agentId: string, merged: number, rejected: number, reverted: number) {
    const trust = trustScore(merged, rejected, reverted);
    const tier = tierFor(trust, merged);
    this.ctx.storage.sql.exec(
      "UPDATE profiles SET trust = ?, tier = ?, merges = ? WHERE id = ?",
      trust,
      tier,
      merged,
      agentId,
    );
    await this.env.DB.prepare("UPDATE agents SET trust = ?, tier = ? WHERE id = ?")
      .bind(trust, tier, agentId)
      .run();
    return { trust, tier, merges: merged };
  }

  async list() {
    await this.syncFromD1();
    return this.ctx.storage.sql
      .exec<Profile>("SELECT * FROM profiles ORDER BY id")
      .toArray()
      .map((row) => ({
        id: row.id,
        roles: JSON.parse(row.roles) as string[],
        specialties: JSON.parse(row.specialties) as string[],
        trust: row.trust,
        tier: row.tier,
        modelFamily: row.model_family,
        status: row.status,
        merges: row.merges,
      }));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ agentId: new URL(request.url).searchParams.get("agent") });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);
    let body: { type?: string; claimIds?: string[] } = {};
    try {
      body = JSON.parse(text) as { type?: string; claimIds?: string[] };
    } catch {
      body = {};
    }
    if (body.type === "heartbeat" || body.type === "offers") {
      const attached = ws.deserializeAttachment() as { agentId?: string } | null;
      const open = await this.env.DB.prepare(
        "SELECT id, title, intent, urgency, uncertainty, tags, created_at FROM tasks WHERE state = 'Open' ORDER BY urgency DESC LIMIT 8",
      ).all<{
        id: string;
        title: string;
        intent: string;
        urgency: number;
        uncertainty: string;
        tags: string;
        created_at: number;
      }>();
      ws.send(
        JSON.stringify({
          type: "offers",
          agentId: attached?.agentId,
          tasks: open.results.map((task) => ({
            id: task.id,
            title: task.title,
            intent: task.intent,
            urgency: task.urgency,
            uncertainty: task.uncertainty,
            tags: JSON.parse(task.tags),
            createdAt: task.created_at,
          })),
        }),
      );
    }
  }
}
