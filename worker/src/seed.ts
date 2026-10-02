import { CLAIM_TTL_MS } from "./decay";

export async function seedColony(db: D1Database): Promise<boolean> {
  const count = await db.prepare("SELECT COUNT(*) AS n FROM agents").first<{ n: number }>();
  if ((count?.n ?? 0) > 0) return false;

  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];

  const agents: Array<[string, string[], string[], number, string, string, string, number]> = [
    ["ant-01", ["Coder"], ["rust"], 0.91, "Senior", "glm", "working", 92000],
    ["ant-02", ["Reviewer"], ["security"], 0.84, "Senior", "llama", "reviewing", 88000],
    ["ant-03", ["Coder", "Reviewer"], ["rust", "security"], 0.77, "Member", "glm", "working", 76000],
    ["ant-04", ["Coder"], ["frontend"], 0.68, "Member", "llama", "idle", 81000],
    ["ant-05", ["Reviewer"], ["frontend"], 0.61, "Member", "glm", "reviewing", 70000],
    ["ant-06", ["Coder"], ["rust"], 0.55, "Member", "llama", "working", 64000],
    ["ant-07", ["Coder"], ["security"], 0.48, "Probation", "glm", "idle", 50000],
    ["ant-08", ["Reviewer"], ["rust", "frontend"], 0.42, "Probation", "llama", "idle", 45000],
  ];
  const insertAgent = db.prepare(
    `INSERT INTO agents (id, roles, specialties, trust, tier, model_family, status, budget_remaining)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const [id, roles, specialties, trust, tier, model, status, budget] of agents) {
    stmts.push(
      insertAgent.bind(id, JSON.stringify(roles), JSON.stringify(specialties), trust, tier, model, status, budget),
    );
  }

  const tasks: Array<{
    id: string;
    title: string;
    intent: string;
    tags: string[];
    urgency: number;
    uncertainty: string;
    state: string;
    detail: string | null;
    paths: string[];
    created: number;
  }> = [
    {
      id: "task_cli",
      title: "Add colony CLI status command",
      intent: "Operators need a one-shot view of pause state, alive claims, and merge queue depth.",
      tags: ["cli", "ops"],
      urgency: 0.4,
      uncertainty: "Low",
      state: "Open",
      detail: null,
      paths: ["README.md"],
      created: now - 40 * 60_000,
    },
    {
      id: "task_docs",
      title: "Write shard map guide",
      intent: "Document longest-prefix shard resolution so new agents claim the right trail.",
      tags: ["docs"],
      urgency: 0.35,
      uncertainty: "Low",
      state: "Exploring",
      detail: null,
      paths: ["docs/**"],
      created: now - 3 * 3_600_000,
    },
    {
      id: "task_auth",
      title: "Harden session tokens",
      intent: "Rotate session signing and reject tokens older than one hour on the API edge.",
      tags: ["security", "auth"],
      urgency: 0.8,
      uncertainty: "Medium",
      state: "InReview",
      detail: "att_auth_1",
      paths: ["src/auth/**", "src/api/**"],
      created: now - 2 * 3_600_000,
    },
    {
      id: "task_ledger",
      title: "Persist why-ledger on merge",
      intent: "Every merge writes intent, alternatives, and evidence so humans can ask why.",
      tags: ["ledger", "rust"],
      urgency: 0.7,
      uncertainty: "Medium",
      state: "Queued",
      detail: "train-1",
      paths: ["crates/colony-core/**"],
      created: now - 5 * 3_600_000,
    },
    {
      id: "task_refund",
      title: "Fix refund rounding in payments",
      intent: "Refunds were truncating cents. Round half away from zero and cover the payments shard.",
      tags: ["payments", "bug"],
      urgency: 0.9,
      uncertainty: "Low",
      state: "Merged",
      detail: "abc1234",
      paths: ["src/payments/**"],
      created: now - 26 * 3_600_000,
    },
    {
      id: "task_rebase",
      title: "Rebase payments hotfix onto main",
      intent: "Land the hotfix without dropping the in-flight auth edits on src/payments.",
      tags: ["payments", "conflict"],
      urgency: 0.95,
      uncertainty: "High",
      state: "Escalated",
      detail: "rebase failed on src/payments",
      paths: ["src/payments/**"],
      created: now - 20 * 60_000,
    },
  ];
  const insertTask = db.prepare(
    `INSERT INTO tasks (id, repo, title, intent, tags, urgency, uncertainty, state, state_detail, paths_hint, created_at, updated_at)
     VALUES (?, 'colony-demo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const task of tasks) {
    stmts.push(
      insertTask.bind(
        task.id,
        task.title,
        task.intent,
        JSON.stringify(task.tags),
        task.urgency,
        task.uncertainty,
        task.state,
        task.detail,
        JSON.stringify(task.paths),
        task.created,
        task.created,
      ),
    );
  }

  const refundEvidence = {
    requiredTestsPassed: true,
    testsPassed: 18,
    testsTotal: 18,
    linesChanged: 42,
    filesChanged: ["src/payments/refund.rs"],
    agentRationale: "Round half away from zero so cent remainders are not truncated.",
    summary: "18/18 payment tests passed; rounding half away from zero.",
  };
  const authEvidence = {
    requiredTestsPassed: true,
    testsPassed: 18,
    testsTotal: 20,
    linesChanged: 86,
    filesChanged: ["src/auth/session.rs", "src/api/routes/v2.rs"],
    agentRationale: "Short-lived tokens plus rotation on the API edge.",
    summary: "Session tokens expire in one hour; 18/20 tests passed.",
  };
  const ledgerEvidence = {
    requiredTestsPassed: true,
    testsPassed: 11,
    testsTotal: 11,
    linesChanged: 120,
    filesChanged: ["crates/colony-core/src/lib.rs"],
    agentRationale: "Ledger row is written on the merge transition only.",
    summary: "Why-ledger persisted for the winner attempt.",
  };
  const docsEvidence = {
    requiredTestsPassed: false,
    testsPassed: 2,
    testsTotal: 4,
    linesChanged: 64,
    filesChanged: ["docs/guide/intro.md"],
    agentRationale: "Draft of longest-prefix rules; examples still incomplete.",
    summary: "Shard guide draft, tests not green yet.",
  };

  const attempts: Array<[string, string, string, string, string | null, string | null, number | null, string, number]> = [
    [
      "att_docs_1",
      "task_docs",
      "ant-04",
      "colony-demo--ttask_docs--a1",
      null,
      JSON.stringify(docsEvidence),
      0.41,
      "exploring",
      now - 3 * 3_600_000 + 60_000,
    ],
    [
      "att_auth_1",
      "task_auth",
      "ant-03",
      "colony-demo--ttask_auth--a1",
      "def5678",
      JSON.stringify(authEvidence),
      0.82,
      "evaluated",
      now - 2 * 3_600_000 + 120_000,
    ],
    [
      "att_ledger_1",
      "task_ledger",
      "ant-06",
      "colony-demo--ttask_ledger--a1",
      "fed9012",
      JSON.stringify(ledgerEvidence),
      0.9,
      "evaluated",
      now - 5 * 3_600_000 + 180_000,
    ],
    [
      "att_refund_1",
      "task_refund",
      "ant-01",
      "colony-demo--ttask_refund--a1",
      "abc1234",
      JSON.stringify(refundEvidence),
      0.88,
      "merged",
      now - 26 * 3_600_000 + 600_000,
    ],
  ];
  const insertAttempt = db.prepare(
    `INSERT INTO attempts (id, task_id, agent_id, fork_repo, head_commit, evidence_json, score, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const row of attempts) {
    stmts.push(insertAttempt.bind(...row));
  }

  const insertReview = db.prepare(
    `INSERT INTO reviews (id, attempt_id, reviewer_id, model_family, verdict, score, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  stmts.push(
    insertReview.bind(
      "rev_auth_1",
      "att_auth_1",
      "ant-02",
      "llama",
      "approve",
      0.86,
      "Token TTL looks right.",
      now - 90 * 60_000,
    ),
    insertReview.bind(
      "rev_auth_2",
      "att_auth_1",
      "ant-05",
      "glm",
      "approve",
      0.79,
      "Would like a negative test for expired tokens.",
      now - 70 * 60_000,
    ),
  );

  const claims: Array<[string, string, string, string, string, string, number, number]> = [
    [
      "claim_payments",
      "ant-01",
      "task_refund",
      JSON.stringify(["src/payments/**"]),
      JSON.stringify(["src/payments"]),
      "fix refund rounding",
      0.91,
      now - 10_000,
    ],
    [
      "claim_api",
      "ant-03",
      "task_auth",
      JSON.stringify(["src/api/**"]),
      JSON.stringify(["src/api"]),
      "harden session tokens",
      0.77,
      now - 10_000,
    ],
    [
      "claim_core",
      "ant-06",
      "task_ledger",
      JSON.stringify(["crates/colony-core/**"]),
      JSON.stringify(["crates/colony-core"]),
      "persist why-ledger",
      0.85,
      now - 4 * 60_000,
    ],
    [
      "claim_docs",
      "ant-04",
      "task_docs",
      JSON.stringify(["docs/**"]),
      JSON.stringify(["docs"]),
      "write shard map guide",
      0.68,
      now - 4 * 60_000,
    ],
    [
      "claim_root",
      "ant-07",
      "task_cli",
      JSON.stringify(["README.md"]),
      JSON.stringify(["root"]),
      "cli status command",
      1,
      now - 7 * 60_000,
    ],
  ];
  const insertClaim = db.prepare(
    `INSERT INTO claims (id, agent_id, task_id, paths, shards, shard_map_version, intent, strength0, last_heartbeat_ms, ttl_ms, released)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 0)`,
  );
  for (const [id, agentId, taskId, paths, shards, intent, strength0, heartbeat] of claims) {
    stmts.push(insertClaim.bind(id, agentId, taskId, paths, shards, intent, strength0, heartbeat, CLAIM_TTL_MS));
  }

  stmts.push(
    db
      .prepare(
        `INSERT INTO ledger (id, task_id, merged_commit, intent, winner_attempt, alternatives_json, evidence_json, reviewers_json, shards_json, train_id, revisit_when, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        "ledger_refund",
        "task_refund",
        "abc1234",
        "Refunds were truncating cents. Round half away from zero and cover the payments shard.",
        "att_refund_1",
        JSON.stringify(["att_refund_2"]),
        JSON.stringify(refundEvidence),
        JSON.stringify(["ant-02"]),
        JSON.stringify(["src/payments"]),
        "train-1",
        null,
        now - 20 * 60_000,
      ),
  );

  const insertMerge = db.prepare(
    `INSERT INTO merge_items (id, repo, attempt_id, task_id, shards, train_id, status, created_at)
     VALUES (?, 'colony-demo', ?, ?, ?, 'train-1', 'queued', ?)`,
  );
  stmts.push(
    insertMerge.bind("merge_payments", "att_refund_1", "task_refund", JSON.stringify(["src/payments"]), now - 15 * 60_000),
    insertMerge.bind("merge_docs", "att_docs_1", "task_docs", JSON.stringify(["docs"]), now - 14 * 60_000),
  );

  const insertEvent = db.prepare(
    `INSERT INTO agent_events (id, agent_id, kind, task_id, delta_trust, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  stmts.push(
    insertEvent.bind("evt_seed_hb_1", "ant-01", "heartbeat", "task_refund", null, now - 10_000),
    insertEvent.bind("evt_seed_hb_2", "ant-03", "heartbeat", "task_auth", null, now - 20_000),
    insertEvent.bind("evt_seed_hb_3", "ant-06", "heartbeat", "task_ledger", null, now - 40_000),
    insertEvent.bind("evt_seed_approve", "human", "human_approve", "task_refund", 0.02, now - 20 * 60_000),
  );

  await db.batch(stmts);
  return true;
}
