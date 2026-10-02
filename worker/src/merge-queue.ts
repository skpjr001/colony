import { DurableObject } from "cloudflare:workers";
import { recordLandings } from "./breakers";
import { tierFor, trustScore } from "./core";
import type { Env } from "./env";
import { ledgerMarkdown } from "./ledger-file";

type Item = {
  id: string;
  attempt_id: string;
  task_id: string;
  shards: string;
  train_id: string | null;
  status: string;
};

export class MergeQueue extends DurableObject<Env> {
  async enqueue(
    input: {
      repo: string;
      attemptId: string;
      taskId: string;
      agentId: string;
      shards: string[];
      intent: string;
    },
    opts?: { land?: boolean },
  ): Promise<{ state: string; trainId: string | null; bisect?: string | null }> {
    const existing = await this.env.DB.prepare(
      "SELECT id, train_id, status FROM merge_items WHERE attempt_id = ?",
    )
      .bind(input.attemptId)
      .first<{ id: string; train_id: string | null; status: string }>();
    if (existing?.status === "landed") return { state: "Merged", trainId: existing.train_id };
    const now = Date.now();
    if (!existing) {
      await this.env.DB.prepare(
        `INSERT INTO merge_items (id, repo, attempt_id, task_id, shards, train_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, 'queued', ?)`,
      )
        .bind(`mq_${crypto.randomUUID()}`, input.repo, input.attemptId, input.taskId, JSON.stringify(input.shards), now)
        .run();
      await this.env.DB.prepare("UPDATE tasks SET state = 'Queued', state_detail = ?, updated_at = ? WHERE id = ?")
        .bind(input.attemptId, now, input.taskId)
        .run();
    }
    if (opts?.land === false) return { state: "Queued", trainId: null, bisect: null };
    return this.landReady(input.repo);
  }

  async landNow(repo: string) {
    return this.landReady(repo);
  }

  async status(repo: string) {
    const rows = await this.env.DB.prepare(
      "SELECT id, attempt_id, task_id, shards, train_id, status FROM merge_items WHERE repo = ? ORDER BY created_at ASC",
    )
      .bind(repo)
      .all<Item>();
    const items = rows.results.map((row) => ({
      attemptId: row.attempt_id,
      taskId: row.task_id,
      shards: JSON.parse(row.shards) as string[],
      trainId: row.train_id,
      status: row.status,
    }));
    const activeId =
      rows.results.find((row) => row.status === "training")?.train_id ??
      [...rows.results].reverse().find((row) => row.train_id)?.train_id ??
      null;
    const members = activeId
      ? rows.results.filter((row) => row.train_id === activeId).map((row) => row.attempt_id)
      : [];
    const status = rows.results.find((row) => row.train_id === activeId)?.status ?? "idle";
    return {
      items,
      train: activeId ? { id: activeId, status, members } : null,
      bisect: rows.results.some((row) => row.status === "bisect") ? "train bisect in progress" : null,
    };
  }

  private async landReady(repo: string): Promise<{ state: string; trainId: string | null; bisect: string | null }> {
    const queued = await this.env.DB.prepare(
      `SELECT m.id, m.attempt_id, m.task_id, m.shards, m.train_id, m.status
       FROM merge_items m
       JOIN tasks t ON t.id = m.task_id
       WHERE m.repo = ? AND m.status = 'queued' AND t.state = 'Queued'`,
    )
      .bind(repo)
      .all<Item>();
    const train: Item[] = [];
    const used = new Set<string>();
    for (const item of queued.results) {
      const shards = JSON.parse(item.shards) as string[];
      if (shards.some((shard) => used.has(shard))) continue;
      for (const shard of shards) used.add(shard);
      train.push(item);
      if (train.length === 5) break;
    }
    if (train.length === 0) return { state: "Queued", trainId: null, bisect: null };
    const green: Item[] = [];
    const red: Item[] = [];
    for (const item of train) {
      const attempt = await this.env.DB.prepare("SELECT evidence_json FROM attempts WHERE id = ?")
        .bind(item.attempt_id)
        .first<{ evidence_json: string | null }>();
      let passed = true;
      if (attempt?.evidence_json) {
        try {
          const ev = JSON.parse(attempt.evidence_json) as { requiredTestsPassed?: boolean };
          passed = ev.requiredTestsPassed !== false;
        } catch {
          passed = true;
        }
      }
      if (passed) green.push(item);
      else red.push(item);
    }
    let bisect: string | null = null;
    if (red.length) {
      bisect = `bisect dropped ${red.map((item) => item.attempt_id).join(", ")}`;
      for (const item of red) {
        await this.env.DB.batch([
          this.env.DB.prepare("UPDATE merge_items SET status = 'bisect' WHERE id = ?").bind(item.id),
          this.env.DB.prepare(
            "UPDATE tasks SET state = 'InReview', state_detail = ?, updated_at = ? WHERE id = ?",
          ).bind(item.attempt_id, Date.now(), item.task_id),
        ]);
      }
    }
    if (green.length === 0) return { state: "InReview", trainId: null, bisect };
    const trainId = `train_${crypto.randomUUID().slice(0, 8)}`;
    const now = Date.now();
    for (const item of green) {
      const commit = `${trainId}-${item.attempt_id.slice(0, 8)}`;
      const task = await this.env.DB.prepare("SELECT intent FROM tasks WHERE id = ?")
        .bind(item.task_id)
        .first<{ intent: string }>();
      const attempt = await this.env.DB.prepare(
        "SELECT agent_id, evidence_json FROM attempts WHERE id = ?",
      )
        .bind(item.attempt_id)
        .first<{ agent_id: string; evidence_json: string | null }>();
      const others = await this.env.DB.prepare(
        "SELECT id FROM attempts WHERE task_id = ? AND id != ?",
      )
        .bind(item.task_id, item.attempt_id)
        .all<{ id: string }>();
      const reviewers = await this.env.DB.prepare(
        "SELECT reviewer_id FROM reviews WHERE attempt_id = ?",
      )
        .bind(item.attempt_id)
        .all<{ reviewer_id: string }>();
      await this.env.DB.batch([
        this.env.DB.prepare(
          "UPDATE merge_items SET status = 'landed', train_id = ? WHERE id = ?",
        ).bind(trainId, item.id),
        this.env.DB.prepare(
          "UPDATE tasks SET state = 'Merged', state_detail = ?, updated_at = ? WHERE id = ?",
        ).bind(commit, now, item.task_id),
        this.env.DB.prepare("UPDATE attempts SET status = 'merged', head_commit = ? WHERE id = ?").bind(
          commit,
          item.attempt_id,
        ),
        this.env.DB.prepare(
          `INSERT INTO ledger (id, task_id, merged_commit, intent, winner_attempt, alternatives_json, evidence_json, reviewers_json, shards_json, train_id, revisit_when, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
        ).bind(
          `led_${crypto.randomUUID()}`,
          item.task_id,
          commit,
          task?.intent ?? "",
          item.attempt_id,
          JSON.stringify(others.results.map((row) => row.id)),
          attempt?.evidence_json ?? "{}",
          JSON.stringify(reviewers.results.map((row) => row.reviewer_id)),
          item.shards,
          trainId,
          now,
        ),
      ]);
      if (attempt) await bumpTrust(this.env, attempt.agent_id);
      await recordLandings(this.env, repo, JSON.parse(item.shards) as string[], now);
      const markdown = ledgerMarkdown({
        taskId: item.task_id,
        intent: task?.intent ?? "",
        winner: item.attempt_id,
        commit,
        alternatives: others.results.map((row) => row.id),
        evidence: attempt?.evidence_json ?? "",
        reviewers: reviewers.results.map((row) => row.reviewer_id),
        shards: JSON.parse(item.shards) as string[],
        trainId,
      });
      await this.env.DB.prepare(
        `INSERT INTO ledger_files (task_id, path, markdown, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(task_id) DO UPDATE SET markdown = excluded.markdown, created_at = excluded.created_at`,
      )
        .bind(item.task_id, `.colony/ledger/${item.task_id}.md`, markdown, now)
        .run();
    }
    return { state: "Merged", trainId, bisect };
  }
}

async function bumpTrust(env: Env, agentId: string) {
  const merged = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM ledger l
     JOIN attempts a ON a.id = l.winner_attempt
     WHERE a.agent_id = ?`,
  )
    .bind(agentId)
    .first<{ n: number }>();
  const rejected = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM agent_events WHERE agent_id = ? AND kind = 'rejected'",
  )
    .bind(agentId)
    .first<{ n: number }>();
  const reverted = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM agent_events WHERE agent_id = ? AND kind = 'reverted'",
  )
    .bind(agentId)
    .first<{ n: number }>();
  const m = merged?.n ?? 0;
  const trust = trustScore(m, rejected?.n ?? 0, reverted?.n ?? 0);
  const tier = tierFor(trust, m);
  await env.DB.prepare("UPDATE agents SET trust = ?, tier = ? WHERE id = ?").bind(trust, tier, agentId).run();
  await env.TRUST_REGISTRY.getByName("colony").recordMerge(agentId, m, rejected?.n ?? 0, reverted?.n ?? 0);
  await env.DB.prepare(
    "INSERT INTO agent_events (id, agent_id, kind, task_id, delta_trust, created_at) VALUES (?, ?, 'merged', NULL, ?, ?)",
  )
    .bind(`evt_${crypto.randomUUID()}`, agentId, trust, Date.now())
    .run();
}
