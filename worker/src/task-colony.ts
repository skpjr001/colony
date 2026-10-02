import { DurableObject } from "cloudflare:workers";
import { slotsFor as coreSlotsFor } from "./core";
import type { Env } from "./env";

export function slotsFor(uncertainty: string): number {
  return coreSlotsFor(uncertainty);
}

export type SlotOk = {
  ok: true;
  attemptId: string;
  n: number;
  forkRepo: string;
  remote: string | null;
  forked: boolean;
  token?: string;
};

export type SlotFail = { ok: false; reason: string };

export class TaskColony extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS attempts (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          fork_repo TEXT NOT NULL,
          head_commit TEXT,
          status TEXT NOT NULL,
          n INTEGER NOT NULL
        )
      `);
    });
  }

  async takeSlot(taskId: string, agentId: string): Promise<SlotOk | SlotFail> {
    const task = await this.env.DB.prepare(
      "SELECT id, state, uncertainty, repo FROM tasks WHERE id = ?",
    )
      .bind(taskId)
      .first<{ id: string; state: string; uncertainty: string; repo: string }>();
    if (!task) return { ok: false, reason: "not found" };
    if (task.state !== "Open" && task.state !== "Exploring") {
      return { ok: false, reason: `state ${task.state}` };
    }
    const count = await this.env.DB.prepare("SELECT COUNT(*) AS n FROM attempts WHERE task_id = ?")
      .bind(taskId)
      .first<{ n: number }>();
    const n = (count?.n ?? 0) + 1;
    if (n > slotsFor(task.uncertainty)) return { ok: false, reason: "full" };

    const attemptId = `att_${crypto.randomUUID()}`;
    const forkRepo = `${task.repo}--t${taskId}--a${n}`;
    const now = Date.now();
    await this.env.DB.batch([
      this.env.DB.prepare(
        `INSERT INTO attempts (id, task_id, agent_id, fork_repo, head_commit, evidence_json, score, status, created_at)
         VALUES (?, ?, ?, ?, NULL, NULL, NULL, 'exploring', ?)`,
      ).bind(attemptId, taskId, agentId, forkRepo, now),
      this.env.DB.prepare(
        "UPDATE tasks SET state = 'Exploring', updated_at = ? WHERE id = ? AND state = 'Open'",
      ).bind(now, taskId),
    ]);
    this.ctx.storage.sql.exec(
      "INSERT INTO attempts (id, agent_id, fork_repo, head_commit, status, n) VALUES (?, ?, ?, NULL, 'exploring', ?)",
      attemptId,
      agentId,
      forkRepo,
      n,
    );
    if (n === 1) await this.ctx.storage.setAlarm(now + 30 * 60_000);

    const forked = await forkRepoHandle(this.env, task.repo, forkRepo);
    return {
      ok: true,
      attemptId,
      n,
      forkRepo,
      remote: forked.remote,
      forked: forked.ok,
      token: forked.token,
    };
  }

  async recordEvidence(attemptId: string, taskId: string): Promise<{ state: string }> {
    this.ctx.storage.sql.exec("UPDATE attempts SET status = 'evaluated' WHERE id = ?", attemptId);
    const task = await this.env.DB.prepare("SELECT uncertainty, state FROM tasks WHERE id = ?")
      .bind(taskId)
      .first<{ uncertainty: string; state: string }>();
    if (!task) return { state: "missing" };
    const done = await this.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM attempts WHERE task_id = ? AND evidence_json IS NOT NULL",
    )
      .bind(taskId)
      .first<{ n: number }>();
    if ((done?.n ?? 0) >= slotsFor(task.uncertainty) && task.state === "Exploring") {
      const now = Date.now();
      await this.env.DB.prepare("UPDATE tasks SET state = 'Evaluating', updated_at = ? WHERE id = ?")
        .bind(now, taskId)
        .run();
      return { state: "Evaluating" };
    }
    return { state: task.state };
  }

  async notePush(forkRepo: string, commit: string): Promise<{ updated: boolean }> {
    const result = await this.env.DB.prepare(
      "UPDATE attempts SET head_commit = ? WHERE fork_repo = ?",
    )
      .bind(commit, forkRepo)
      .run();
    this.ctx.storage.sql.exec("UPDATE attempts SET head_commit = ? WHERE fork_repo = ?", commit, forkRepo);
    return { updated: (result.meta.changes ?? 0) > 0 };
  }

  async alarm(): Promise<void> {
    const rows = this.ctx.storage.sql
      .exec<{ id: string; status: string }>("SELECT id, status FROM attempts")
      .toArray();
    if (rows.length === 0) return;
    if (rows.every((row) => row.status === "exploring")) {
      const name = this.ctx.id.name;
      if (!name) return;
      await this.env.DB.prepare(
        "UPDATE tasks SET state = 'Escalated', state_detail = ?, updated_at = ? WHERE id = ? AND state = 'Exploring'",
      )
        .bind("exploration deadline", Date.now(), name)
        .run();
    }
  }
}

async function forkRepoHandle(
  env: Env,
  base: string,
  name: string,
): Promise<{ ok: boolean; remote: string | null; token?: string }> {
  if (!env.ARTIFACTS) return { ok: false, remote: null };
  try {
    const repo = await env.ARTIFACTS.get(base);
    if (!repo) return { ok: false, remote: null };
    const forked = await repo.fork(name, { defaultBranchOnly: true });
    return { ok: true, remote: forked.remote ?? null, token: forked.token };
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "fork failed",
        name,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return { ok: false, remote: null };
  }
}
