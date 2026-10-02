import { WorkerEntrypoint } from "cloudflare:workers";
import { listOpenTasks, openAttempt, submitEvidence, type EvidenceBody } from "./attempts";
import { pickTask } from "./core";
import type { Env } from "./env";
import { reviewNext as reviewNextTask } from "./selection";

export class ColonyRpc extends WorkerEntrypoint<Env> {
  listOpen() {
    return listOpenTasks(this.env);
  }

  takeAttempt(taskId: string, agentId: string) {
    return openAttempt(this.env, taskId, agentId);
  }

  submitEvidence(attemptId: string, evidence: EvidenceBody) {
    return submitEvidence(this.env, attemptId, evidence);
  }

  reviewNext(agentId: string) {
    return reviewNextTask(this.env, agentId);
  }

  async pickTask(agentId: string, tasks: unknown, rng: number) {
    const agent = await this.env.DB.prepare(
      "SELECT specialties, trust, tier, model_family FROM agents WHERE id = ?",
    )
      .bind(agentId)
      .first<{ specialties: string; trust: number; tier: string; model_family: string }>();
    const profile = {
      id: agentId,
      specialties: agent ? (JSON.parse(agent.specialties) as string[]) : ["rust"],
      thresholds: { rust: 0.4, security: 0.5, frontend: 0.6 },
      trust: agent?.trust ?? 0.6,
      tier: agent?.tier ?? "Member",
      modelFamily: agent?.model_family ?? "glm",
    };
    return pickTask(JSON.stringify(profile), JSON.stringify(tasks), Date.now(), rng);
  }
}
