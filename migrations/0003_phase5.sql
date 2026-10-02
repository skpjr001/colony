CREATE TABLE IF NOT EXISTS shard_landings (
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  shard TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_landings_shard ON shard_landings(shard, created_at);

CREATE TABLE IF NOT EXISTS path_flips (
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  path TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_flips_path ON path_flips(path, created_at);
