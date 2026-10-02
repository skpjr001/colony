import type { Env } from "./env";

export const EMBEDDED_TOML = `# colony.toml
[claims]
heartbeat_secs = 90
lambda_per_min = 0.2
min_strength = 0.2
ttl_mins = 30

[claims.sharding]
enabled = true
shards = ["src/*", "crates/*", "docs"]
default_shard = "root"
max_fanout = 8
broad_claim_tier = "Senior"
`;

export type ShardConfig = {
  enabled: boolean;
  patterns: string[];
  defaultShard: string;
  source: "artifacts" | "embedded-demo" | "missing-root";
};

function parseToml(text: string): ShardConfig | null {
  const enabled = /enabled\s*=\s*(true|false)/.exec(text);
  const shards = /shards\s*=\s*\[([^\]]*)\]/.exec(text);
  const fallback = /default_shard\s*=\s*"([^"]+)"/.exec(text);
  if (!enabled && !shards) return null;
  const on = enabled?.[1] !== "false";
  const patterns = shards
    ? shards[1]
        .split(",")
        .map((part) => part.trim().replace(/^"|"$/g, ""))
        .filter(Boolean)
    : [];
  if (!on) {
    return { enabled: false, patterns: [], defaultShard: fallback?.[1] ?? "root", source: "artifacts" };
  }
  return {
    enabled: true,
    patterns,
    defaultShard: fallback?.[1] ?? "root",
    source: "artifacts",
  };
}

export async function loadColonyToml(env: Env, repo: string): Promise<ShardConfig> {
  if (env.ARTIFACTS) {
    try {
      const handle = await env.ARTIFACTS.get(repo);
      if (handle && "readFile" in handle) {
        const file = await handle.readFile?.({ ref: "main", path: "colony.toml" });
        if (file) {
          const parsed = parseToml(await file.text());
          if (parsed) return parsed;
        }
      }
    } catch {
      // missing repo file falls through to the embedded demo map
    }
  }
  const embedded = parseToml(EMBEDDED_TOML);
  return embedded
    ? { ...embedded, source: "embedded-demo" }
    : { enabled: false, patterns: [], defaultShard: "root", source: "missing-root" };
}
