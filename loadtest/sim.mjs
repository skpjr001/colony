const base = process.env.COLONY_URL ?? "https://colony.sachinkumarskrose.workers.dev";
import { writeFileSync } from "node:fs";

const agents = Number(process.argv.find((arg) => arg.startsWith("--agents="))?.split("=")[1] ?? 40);
const seconds = Number(process.argv.find((arg) => arg.startsWith("--seconds="))?.split("=")[1] ?? 15);
const concurrency = Number(process.argv.find((arg) => arg.startsWith("--concurrency="))?.split("=")[1] ?? 20);

const shards = ["src/payments/**", "src/api/**", "docs/**", "crates/colony-core/**", "README.md"];
function zipfPath(n) {
  const rank = 1 + (n % 10 === 0 ? 0 : n % shards.length);
  return shards[Math.min(shards.length - 1, rank === 1 || n % 3 !== 0 ? 0 : rank - 1)];
}
const latencies = [];
let ok = 0;
let limited = 0;
let contended = 0;
let failed = 0;

async function timed(path, init) {
  const started = performance.now();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  latencies.push(performance.now() - started);
  return res;
}

const deadline = Date.now() + seconds * 1000;
let n = 0;
async function one() {
  const id = `sim-${n % agents}`;
  const path = zipfPath(n);
  if (n % 17 === 0) {
    n += 1;
    return;
  }
  n += 1;
  const res = await timed("/api/claims", {
    method: "POST",
    body: JSON.stringify({
      agentId: id,
      taskId: "task_docs",
      paths: [path],
      intent: "loadtest claim",
      strength0: 0.4,
    }),
  });
  if (res.status === 429) limited += 1;
  else if (res.status === 409) contended += 1;
  else if (res.ok) ok += 1;
  else failed += 1;
}
const workers = Array.from({ length: concurrency }, async () => {
  while (Date.now() < deadline) await one();
});
await Promise.all(workers);

latencies.sort((a, b) => a - b);
const pct = (p) => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))] ?? 0;
const report = {
  base,
  agents,
  seconds,
  concurrency,
  requests: n,
  ok,
  contended,
  limited,
  failed,
  p50: Math.round(pct(50)),
  p99: Math.round(pct(99)),
};
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240"><rect width="100%" height="100%" fill="#12140f"/><text x="24" y="40" fill="#e7e1d1" font-family="monospace" font-size="16">Colony load ${agents} agents / ${seconds}s</text><text x="24" y="80" fill="#e0a23a" font-family="monospace">requests ${report.requests} ok ${ok} 429 ${limited} 409 ${contended}</text><text x="24" y="120" fill="#8fa36a" font-family="monospace">p50 ${report.p50} ms</text><text x="24" y="160" fill="#c45c26" font-family="monospace">p99 ${report.p99} ms</text></svg>`;
writeFileSync(new URL("./results.svg", import.meta.url), svg);
console.log(JSON.stringify(report, null, 2));
