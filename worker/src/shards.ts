import { shardForPath as coreShardForPath, shardsForPaths as coreShardsForPaths } from "./core";

export const DEMO_REPO = "colony-demo";
export const SHARD_MAP_VERSION = 1;
export const SHARD_PATTERNS = ["src/*", "crates/*", "docs"];
export const DEFAULT_SHARD = "root";

export const KNOWN_SHARDS = [
  "src/payments",
  "src/api",
  "src/auth",
  "crates/colony-core",
  "crates/colony-api",
  "docs",
  "root",
  "src",
] as const;

export function shardForPath(path: string): string {
  return coreShardForPath(path);
}

export function shardForClaimPath(glob: string): string {
  let path = glob.trim().replace(/\/+$/, "");
  const hadGlob = /[*?[]/.test(path);
  while (path.endsWith("/**")) path = path.slice(0, -3);
  while (path.endsWith("/*")) path = path.slice(0, -2);
  if (/[*?[]/.test(path)) {
    const literal: string[] = [];
    for (const part of path.split("/")) {
      if (/[*?[]/.test(part)) break;
      literal.push(part);
    }
    path = literal.join("/");
  }
  if (!path) return DEFAULT_SHARD;
  if (hadGlob) return shardForPath(`${path}/_`);
  return shardForPath(path);
}

export function shardsForPaths(paths: string[]): string[] {
  return JSON.parse(coreShardsForPaths(JSON.stringify(paths))) as string[];
}

function assertDemoShards(): void {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["src/payments/refund.rs", "src/payments"],
    ["src/api/routes/v2.rs", "src/api"],
    ["src/main.rs", "src"],
    ["crates/colony-core/src/lib.rs", "crates/colony-core"],
    ["docs/guide/intro.md", "docs"],
    ["README.md", "root"],
    ["Cargo.toml", "root"],
    [".github/ci.yml", "root"],
  ];
  for (const [path, want] of cases) {
    const got = shardForPath(path);
    if (got !== want) {
      throw new Error(`shardForPath(${path}) = ${got}, want ${want}`);
    }
  }
  if (shardForClaimPath("src/payments/**") !== "src/payments") {
    throw new Error("claim glob src/payments/** did not resolve to src/payments");
  }
  if (shardForClaimPath("docs/**") !== "docs") {
    throw new Error("claim glob docs/** did not resolve to docs");
  }
}

assertDemoShards();
