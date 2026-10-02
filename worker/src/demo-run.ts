import { openAttempt, submitEvidence } from "./attempts";
import { EMBEDDED_TOML } from "./colony-toml";
import type { Env } from "./env";
import { ledgerMarkdown } from "./ledger-file";
import { negotiate } from "./ladder";
import { applyReview } from "./selection";
import { DEMO_REPO, shardsForPaths } from "./shards";

const EVIDENCE = {
  requiredTestsPassed: true,
  testsPassed: 2,
  testsTotal: 2,
  linesChanged: 12,
  filesChanged: ["src/refund.mjs"],
  agentRationale: "sample-app tests passed",
};

export async function seedScale(env: Env, target = 50) {
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM agents").first<{ n: number }>();
  const have = count?.n ?? 0;
  if (have >= target) return { ok: true, agents: have, added: 0 };
  const stmts = [];
  for (let i = have + 1; i <= target; i++) {
    const id = `ant-${String(i).padStart(2, "0")}`;
    const reviewer = i % 3 === 0;
    stmts.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO agents (id, roles, specialties, trust, tier, model_family, status, budget_remaining)
         VALUES (?, ?, ?, ?, 'Member', ?, 'idle', 50000)`,
      ).bind(
        id,
        JSON.stringify(reviewer ? ["Reviewer"] : ["Coder"]),
        JSON.stringify(reviewer ? ["security"] : ["rust"]),
        0.6,
        i % 2 === 0 ? "llama" : "glm",
      ),
    );
  }
  if (stmts.length) await env.DB.batch(stmts);
  await env.TRUST_REGISTRY.getByName("colony").syncFromD1();
  return { ok: true, agents: target, added: target - have };
}

export async function runParallelDemo(env: Env) {
  const now = Date.now();
  const highId = `task_parallel_${now}`;
  const docsId = `task_docs_${now}`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO tasks (id, repo, title, intent, tags, urgency, uncertainty, state, paths_hint, created_at, updated_at)
       VALUES (?, 'colony-demo', 'Parallel refund fix', 'Three attempts, one winner', '["payments"]', 0.9, 'High', 'Open', '["src/payments/**"]', ?, ?)`,
    ).bind(highId, now, now),
    env.DB.prepare(
      `INSERT INTO tasks (id, repo, title, intent, tags, urgency, uncertainty, state, paths_hint, created_at, updated_at)
       VALUES (?, 'colony-demo', 'Shard guide note', 'Land beside the refund train', '["docs"]', 0.4, 'Low', 'Open', '["docs/**"]', ?, ?)`,
    ).bind(docsId, now, now),
  ]);
  const coders = ["ant-01", "ant-03", "ant-06"];
  const attempts = [];
  for (const agentId of coders) {
    const slot = await openAttempt(env, highId, agentId);
    if (!slot.ok) return { ok: false, reason: slot.reason, taskId: highId };
    await submitEvidence(env, slot.attemptId, EVIDENCE);
    attempts.push(slot.attemptId);
  }
  const docs = await openAttempt(env, docsId, "ant-04");
  if (!docs.ok) return { ok: false, reason: docs.reason, taskId: docsId };
  await submitEvidence(env, docs.attemptId, {
    ...EVIDENCE,
    filesChanged: ["docs/guide/intro.md"],
    agentRationale: "docs attempt passed",
  });
  const queue = env.MERGE_QUEUE.getByName("colony-demo");
  await queue.enqueue(
    {
      repo: "colony-demo",
      attemptId: attempts[0],
      taskId: highId,
      agentId: "ant-01",
      shards: shardsForPaths(["src/payments/**"]),
      intent: "Three attempts, one winner",
    },
    { land: false },
  );
  await queue.enqueue(
    {
      repo: "colony-demo",
      attemptId: docs.attemptId,
      taskId: docsId,
      agentId: "ant-04",
      shards: shardsForPaths(["docs/**"]),
      intent: "Land beside the refund train",
    },
    { land: false },
  );
  await applyReview(env, {
    attemptId: attempts[0],
    reviewerId: "ant-02",
    modelFamily: "llama",
    verdict: "approve",
    score: 0.8,
    notes: await modelNote(env, highId),
  });
  const quorum = await applyReview(env, {
    attemptId: attempts[0],
    reviewerId: "ant-05",
    modelFamily: "glm",
    verdict: "approve",
    score: 0.84,
    notes: await modelNote(env, highId),
  });
  const landed = await queue.landNow("colony-demo");
  return {
    ok: true,
    highId,
    docsId,
    attempts,
    docsAttempt: docs.attemptId,
    trainId: landed.trainId,
    state: landed.state,
    bisect: "bisect" in landed ? landed.bisect : null,
    quorum: quorum.ok ? quorum.quorum : "Pending",
  };
}

async function modelNote(env: Env, taskId: string): Promise<string> {
  if (!env.AI) return "quorum review";
  try {
    const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {
      messages: [{ role: "user", content: `One sentence approval note for ${taskId}` }],
      max_tokens: 40,
    });
    if (result && typeof result === "object" && "response" in result && typeof result.response === "string") {
      return result.response.slice(0, 240);
    }
  } catch {
    return "quorum review";
  }
  return "quorum review";
}

export async function runConflict(env: Env) {
  const now = Date.now();
  const holder = `claim_hold_${now}`;
  const challenger = `claim_chal_${now}`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO claims (id, agent_id, task_id, paths, shards, shard_map_version, intent, strength0, last_heartbeat_ms, ttl_ms, released) VALUES (?, 'ant-01', 'task_rebase', ?, ?, 1, 'multi-shard', 0.9, ?, 1800000, 0)",
    ).bind(holder, JSON.stringify(["src/**"]), JSON.stringify(["src", "src/payments", "src/api"]), now),
    env.DB.prepare(
      "INSERT INTO claims (id, agent_id, task_id, paths, shards, shard_map_version, intent, strength0, last_heartbeat_ms, ttl_ms, released) VALUES (?, 'ant-07', 'task_refund', ?, ?, 1, 'clash', 0.3, ?, 1800000, 0)",
    ).bind(challenger, JSON.stringify(["src/payments/**"]), JSON.stringify(["src/payments"]), now),
  ]);
  const ladder = await negotiate(env, holder, challenger);
  return { ok: true, holder, challenger, shards: ["src", "src/payments", "src/api"], ladder };
}

async function fetchClaim(env: Env, agentId: string, strength0: number) {
  const now = Date.now();
  const id = `claim_clash_${now}`;
  const paths = ["src/payments/**"];
  const shards = shardsForPaths(paths);
  const overlap = await env.DB.prepare(
    "SELECT id FROM claims WHERE released = 0 AND shards LIKE '%src/payments%' LIMIT 1",
  ).first<{ id: string }>();
  if (overlap) {
    return { contended: true, withId: overlap.id, challengerId: id };
  }
  await env.DB.prepare(
    "INSERT INTO claims (id, agent_id, task_id, paths, shards, shard_map_version, intent, strength0, last_heartbeat_ms, ttl_ms, released) VALUES (?, ?, 'task_refund', ?, ?, 1, 'clash', ?, ?, 1800000, 0)",
  )
    .bind(id, agentId, JSON.stringify(paths), JSON.stringify(shards), strength0, now)
    .run();
  return { contended: false, withId: id, challengerId: id };
}

export async function runSwarm(env: Env) {
  const now = Date.now();
  const taken: string[] = [];
  for (let batch = 0; batch < 5; batch++) {
    const jobs = [];
    for (let i = 1; i <= 10; i++) {
      const n = batch * 10 + i;
      const taskId = `task_swarm_${now}_${n}`;
      const agentId = `ant-${String(n).padStart(2, "0")}`;
      jobs.push(
        (async () => {
          await env.DB.prepare(
            `INSERT INTO tasks (id, repo, title, intent, tags, urgency, uncertainty, state, paths_hint, created_at, updated_at)
             VALUES (?, 'colony-demo', ?, 'swarm slot', '["rust"]', 0.5, 'Low', 'Open', '["README.md"]', ?, ?)`,
          )
            .bind(taskId, `Swarm ${n}`, now, now)
            .run();
          const slot = await openAttempt(env, taskId, agentId);
          if (slot.ok) taken.push(slot.attemptId);
        })(),
      );
    }
    await Promise.all(jobs);
  }
  return { ok: true, agents: 50, taken: taken.length };
}

export async function repoFiles(env: Env) {
  const files = [{ path: "colony.toml", content: EMBEDDED_TOML }];
  const rows = await env.DB.prepare("SELECT task_id, markdown FROM ledger_files").all<{
    task_id: string;
    markdown: string;
  }>();
  for (const row of rows.results) {
    files.push({ path: `.colony/ledger/${row.task_id}.md`, content: row.markdown });
  }
  if (rows.results.length === 0) {
    files.push({
      path: ".colony/ledger/README.md",
      content: ledgerMarkdown({
        taskId: "pending",
        intent: "Ledger files are written on merge.",
        winner: "none",
        commit: "none",
        alternatives: [],
        evidence: "",
        reviewers: [],
        shards: ["root"],
        trainId: null,
      }),
    });
  }
  return { repo: DEMO_REPO, files };
}
