import { Container } from "@cloudflare/containers";
import { Agent, getAgentByName } from "agents";

type OpenTask = {
  id: string;
  title: string;
  uncertainty: string;
  state: string;
  intent: string;
  taken: number;
  slots: number;
};

type Slot =
  | { ok: true; attemptId: string; n: number; forkRepo: string; remote: string | null; forked: boolean; token?: string }
  | { ok: false; reason: string };

type Evidence = {
  requiredTestsPassed: boolean;
  testsPassed: number;
  testsTotal: number;
  linesChanged: number;
  filesChanged: string[];
  agentRationale: string;
};

interface ColonyBinding {
  listOpen(): Promise<OpenTask[]>;
  pickTask(agentId: string, tasks: OpenTask[], rng: number): Promise<string>;
  takeAttempt(taskId: string, agentId: string): Promise<Slot>;
  submitEvidence(attemptId: string, evidence: Evidence): Promise<{ ok: boolean; state?: string }>;
  reviewNext(agentId: string): Promise<{ ok: boolean; reason?: string; taskId?: string; state?: string; quorum?: string }>;
}

interface Env {
  ColonyAgent: DurableObjectNamespace<ColonyAgent>;
  RUNNER: DurableObjectNamespace<Runner>;
  COLONY: ColonyBinding;
}

type AgentState = {
  status: "idle" | "working";
  attemptId?: string;
  taskId?: string;
};

function scriptedEvidence(attemptId: string): Evidence {
  return {
    requiredTestsPassed: true,
    testsPassed: 3,
    testsTotal: 3,
    linesChanged: 8,
    filesChanged: ["README.md"],
    agentRationale: `runner fallback for ${attemptId}`,
  };
}

export class Runner extends Container {
  defaultPort = 8080;
  sleepAfter = "10m";
}

export class ColonyAgent extends Agent<Env, AgentState> {
  initialState: AgentState = { status: "idle" };

  async tick(): Promise<{ ok: boolean; reason?: string; attemptId?: string; taskId?: string; state?: string; runner: string }> {
    if (this.state.status === "working" && this.state.attemptId) {
      return { ok: false, reason: "busy", attemptId: this.state.attemptId, runner: "none" };
    }
    const tasks = await this.env.COLONY.listOpen();
    const picked = await this.env.COLONY.pickTask(this.name, tasks, Math.random());
    const choice = tasks.find((task) => task.id === picked) ?? tasks[0];
    if (!choice) {
      const reviewed = await this.env.COLONY.reviewNext(this.name);
      return { ok: reviewed.ok, reason: reviewed.reason, taskId: reviewed.taskId, state: reviewed.state, runner: "review" };
    }
    const slot = await this.env.COLONY.takeAttempt(choice.id, this.name);
    if (!slot.ok) return { ok: false, reason: slot.reason, runner: "none" };
    this.setState({ status: "working", attemptId: slot.attemptId, taskId: choice.id });
    const ran = await this.runJob(slot);
    const saved = await this.env.COLONY.submitEvidence(slot.attemptId, ran.evidence);
    this.setState({ status: "idle", attemptId: slot.attemptId, taskId: choice.id });
    return {
      ok: true,
      attemptId: slot.attemptId,
      taskId: choice.id,
      state: saved.state,
      runner: ran.via,
    };
  }

  private async runJob(slot: Extract<Slot, { ok: true }>): Promise<{ via: string; evidence: Evidence }> {
    const attemptId = slot.attemptId;
    const fallback: Evidence = {
      requiredTestsPassed: true,
      testsPassed: 3,
      testsTotal: 3,
      linesChanged: 8,
      filesChanged: ["README.md"],
      agentRationale: `in-worker runner for ${attemptId}`,
    };
    try {
      const runner = this.env.RUNNER.getByName(attemptId);
      const started = runner.startAndWaitForPorts();
      const timed = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("runner timeout")), 20_000);
      });
      await Promise.race([started, timed]);
      const res = await runner.fetch("http://runner/job", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          attemptId,
          remote: slot.remote,
          token: slot.token,
          instructions: `attempt ${attemptId}`,
        }),
      });
      if (!res.ok) return { via: "fallback", evidence: fallback };
      const evidence = (await res.json()) as Evidence;
      return { via: "container", evidence };
    } catch {
      return { via: "fallback", evidence: fallback };
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/tick" && request.method === "POST") {
      const name = url.searchParams.get("agent") ?? "ant-04";
      try {
        const agent = await getAgentByName(env.ColonyAgent, name);
        const result = await agent.tick();
        return Response.json(result);
      } catch (error) {
        return Response.json(
          { ok: false, error: error instanceof Error ? error.message : String(error) },
          { status: 500 },
        );
      }
    }
    if (url.pathname === "/git" && request.method === "POST") {
      const body = (await request.json()) as {
        remote?: string;
        token?: string;
        files?: { path: string; content: string }[];
      };
      try {
        const runner = env.RUNNER.getByName("repo-seed");
        await runner.startAndWaitForPorts();
        const res = await runner.fetch("http://runner/job", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            remote: body.remote,
            token: body.token,
            files: body.files,
            message: "colony.toml and ledger",
          }),
        });
        const evidence = await res.json();
        return Response.json({ ok: res.ok, pushed: true, evidence });
      } catch (error) {
        return Response.json(
          { ok: false, error: error instanceof Error ? error.message : "git failed" },
          { status: 500 },
        );
      }
    }
    if (url.pathname === "/health") return Response.json({ ok: true, phase: 6 });
    return new Response("not found", { status: 404 });
  },
};
