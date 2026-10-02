import type { ClaimBoard } from "./claim-board";
import type { MergeQueue } from "./merge-queue";
import type { TaskColony } from "./task-colony";
import type { TrustRegistry } from "./trust-registry";

export interface ArtifactsCreated {
  name: string;
  remote: string;
  token?: string;
}

export interface RepoHandle {
  info(): Promise<{ name?: string; remote?: string }>;
  fork(name: string, opts?: { defaultBranchOnly?: boolean }): Promise<ArtifactsCreated>;
  createToken?(scope?: "read" | "write", ttl?: number): Promise<{ plaintext?: string; token?: string }>;
  readFile?(args: { ref: string; path: string }): Promise<{ text(): Promise<string> } | null>;
}

export interface ArtifactsNamespace {
  create(name: string, opts?: { description?: string }): Promise<ArtifactsCreated>;
  get(name: string): Promise<RepoHandle | null>;
  list(opts?: { limit?: number }): Promise<unknown>;
}

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  CLAIM_BOARD: DurableObjectNamespace<ClaimBoard>;
  TASK_COLONY: DurableObjectNamespace<TaskColony>;
  MERGE_QUEUE: DurableObjectNamespace<MergeQueue>;
  TRUST_REGISTRY: DurableObjectNamespace<TrustRegistry>;
  EVENTS: Queue;
  ARTIFACTS?: ArtifactsNamespace;
  AGENT_URL?: string;
  AGENT_WORKER: Fetcher;
  AI?: { run(model: string, input: unknown): Promise<unknown> };
}
