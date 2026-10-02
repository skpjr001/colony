CREATE TABLE IF NOT EXISTS flags (
  id TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

INSERT OR IGNORE INTO flags (id, value) VALUES ('claims_hydrated', 0);

CREATE TABLE IF NOT EXISTS artifact_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  repo_name TEXT,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifact_events_created ON artifact_events(created_at);
