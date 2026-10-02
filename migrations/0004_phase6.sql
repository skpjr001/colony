CREATE TABLE IF NOT EXISTS ledger_files (
  task_id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  markdown TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
