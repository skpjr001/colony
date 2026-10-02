import type { Env } from "./env";
import { selectWinner } from "./selection";
import { slotsFor } from "./task-colony";

export type EvidenceBody = {
  requiredTestsPassed: boolean;
  testsPassed: number;
  testsTotal: number;
  linesChanged: number;
  filesChanged: string[];
  agentRationale: string;
};

export async function listOpenTasks(env: Env) {
  const tasks = await env.DB.prepare(
    "SELECT id, title, uncertainty, state, intent FROM tasks WHERE state IN ('Open', 'Exploring') ORDER BY urgency DESC",
  ).all<{ id: string; title: string; uncertainty: string; state: string; intent: string }>();
  const open = [];
  for (const task of tasks.results) {
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM attempts WHERE task_id = ?")
      .bind(task.id)
      .first<{ n: number }>();
    const taken = count?.n ?? 0;
    const slots = slotsFor(task.uncertainty);
    if (taken >= slots) continue;
    open.push({ ...task, taken, slots });
  }
  return open;
}

export async function openAttempt(env: Env, taskId: string, agentId: string) {
  const paused = await env.DB.prepare("SELECT paused FROM control WHERE id = ?")
    .bind("global")
    .first<{ paused: number }>();
  if (paused?.paused === 1) return { ok: false as const, reason: "paused" };
  const budget = await env.DB.prepare("SELECT budget_remaining FROM agents WHERE id = ?")
    .bind(agentId)
    .first<{ budget_remaining: number }>();
  if (budget && budget.budget_remaining <= 0) return { ok: false as const, reason: "budget" };
  await env.DB.prepare("UPDATE agents SET budget_remaining = budget_remaining - 1000 WHERE id = ? AND budget_remaining >= 1000")
    .bind(agentId)
    .run();
  return env.TASK_COLONY.getByName(taskId).takeSlot(taskId, agentId);
}

export async function submitEvidence(env: Env, attemptId: string, evidence: EvidenceBody) {
  const attempt = await env.DB.prepare("SELECT id, task_id FROM attempts WHERE id = ?")
    .bind(attemptId)
    .first<{ id: string; task_id: string }>();
  if (!attempt) return { ok: false as const, reason: "not found" };
  await env.DB.prepare("UPDATE attempts SET evidence_json = ?, status = 'evaluated' WHERE id = ?")
    .bind(JSON.stringify(evidence), attemptId)
    .run();
  const next = await env.TASK_COLONY.getByName(attempt.task_id).recordEvidence(attemptId, attempt.task_id);
  if (next.state === "Evaluating") {
    const selected = await selectWinner(env, attempt.task_id);
    return { ok: true as const, attemptId, status: "evaluated", state: selected.state };
  }
  return { ok: true as const, attemptId, status: "evaluated", state: next.state };
}
