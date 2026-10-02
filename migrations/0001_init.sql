CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  title TEXT NOT NULL,
  intent TEXT NOT NULL,
  tags TEXT NOT NULL,
  urgency REAL NOT NULL,
  uncertainty TEXT NOT NULL,
  state TEXT NOT NULL,
  state_detail TEXT,
  paths_hint TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  agent_id TEXT NOT NULL,
  fork_repo TEXT NOT NULL,
  head_commit TEXT,
  evidence_json TEXT,
  score REAL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempts(id),
  reviewer_id TEXT NOT NULL,
  model_family TEXT NOT NULL,
  verdict TEXT NOT NULL,
  score REAL NOT NULL,
  notes TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  merged_commit TEXT NOT NULL,
  intent TEXT NOT NULL,
  winner_attempt TEXT NOT NULL,
  alternatives_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  reviewers_json TEXT NOT NULL,
  shards_json TEXT NOT NULL,
  train_id TEXT,
  revisit_when TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_events (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  task_id TEXT,
  delta_trust REAL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attempts_task ON attempts(task_id);
CREATE INDEX IF NOT EXISTS idx_ledger_task ON ledger(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_events_created ON agent_events(created_at);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  paths TEXT NOT NULL,
  shards TEXT NOT NULL,
  shard_map_version INTEGER NOT NULL DEFAULT 1,
  intent TEXT NOT NULL,
  strength0 REAL NOT NULL,
  last_heartbeat_ms INTEGER NOT NULL,
  ttl_ms INTEGER NOT NULL,
  released INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  roles TEXT NOT NULL,
  specialties TEXT NOT NULL,
  trust REAL NOT NULL,
  tier TEXT NOT NULL,
  model_family TEXT NOT NULL,
  status TEXT NOT NULL,
  budget_remaining INTEGER NOT NULL DEFAULT 100000
);

CREATE TABLE IF NOT EXISTS control (
  id TEXT PRIMARY KEY,
  paused INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS merge_items (
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  shards TEXT NOT NULL,
  train_id TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_claims_task ON claims(task_id);
CREATE INDEX IF NOT EXISTS idx_claims_agent ON claims(agent_id);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);

INSERT INTO control (id, paused, updated_at) VALUES ('global', 0, 0);
