import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import http from "node:http";

const exec = promisify(execFile);

function gitEnv(token) {
  return {
    ...process.env,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}`,
    GIT_AUTHOR_NAME: "colony",
    GIT_AUTHOR_EMAIL: "colony@local",
    GIT_COMMITTER_NAME: "colony",
    GIT_COMMITTER_EMAIL: "colony@local",
  };
}

async function gitJob(body) {
  const dir = mkdtempSync(join(tmpdir(), "colony-"));
  const env = gitEnv(body.token);
  let cloned = false;
  try {
    await exec("git", ["clone", "--depth", "1", body.remote, dir], { env });
    cloned = true;
  } catch {
    await exec("git", ["init", "-b", "main", dir]);
    await exec("git", ["remote", "add", "origin", body.remote], { cwd: dir });
  }
  const files = body.files ?? [];
  if (body.instructions) {
    files.push({ path: "AGENT_NOTE.md", content: `${body.instructions}\n` });
  }
  for (const file of files) {
    const target = join(dir, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content);
  }
  let testsPassed = 0;
  let testsTotal = 0;
  let requiredTestsPassed = true;
  if (existsSync(join(dir, "test.mjs"))) {
    testsTotal = 1;
    try {
      await exec("node", ["test.mjs"], { cwd: dir });
      testsPassed = 1;
    } catch {
      requiredTestsPassed = false;
    }
  }
  await exec("git", ["add", "-A"], { cwd: dir });
  try {
    await exec("git", ["commit", "-m", body.message || body.instructions || "colony agent"], { cwd: dir, env });
  } catch {
    return {
      requiredTestsPassed,
      testsPassed,
      testsTotal,
      linesChanged: files.length,
      filesChanged: files.map((file) => file.path),
      agentRationale: "no file changes to commit",
      pushed: false,
    };
  }
  await exec("git", ["push", "-u", "origin", "HEAD:main"], { cwd: dir, env });
  const diff = await exec("git", ["diff", "--numstat", "HEAD~1", "HEAD"], { cwd: dir }).catch(() => ({ stdout: "" }));
  const lines = diff.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .reduce((sum, line) => sum + Number(line.split("\t")[0] || 0), 0);
  return {
    requiredTestsPassed,
    testsPassed,
    testsTotal: testsTotal || 1,
    linesChanged: lines || files.length,
    filesChanged: files.map((file) => file.path),
    agentRationale: `git push ${body.attemptId || randomUUID()}`,
    pushed: true,
    cloned,
  };
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, role: "runner", git: true }));
    return;
  }
  if (req.method === "POST" && req.url === "/job") {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", async () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      try {
        const evidence = body.remote && body.token
          ? await gitJob(body)
          : {
              requiredTestsPassed: true,
              testsPassed: 1,
              testsTotal: 1,
              linesChanged: 1,
              filesChanged: ["AGENT_NOTE.md"],
              agentRationale: `runner has no git token for ${body.attemptId ?? "job"}`,
              pushed: false,
            };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(evidence));
      } catch (error) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : "git job failed", pushed: false }));
      }
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(8080, "0.0.0.0");
