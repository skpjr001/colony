export function ledgerMarkdown(input: {
  taskId: string;
  intent: string;
  winner: string;
  commit: string;
  alternatives: string[];
  evidence: string;
  reviewers: string[];
  shards: string[];
  trainId: string | null;
}): string {
  return [
    `# ${input.taskId}`,
    "",
    `Commit: \`${input.commit}\``,
    `Train: \`${input.trainId ?? "none"}\``,
    "",
    "## Intent",
    input.intent || "—",
    "",
    "## Winner",
    input.winner,
    "",
    "## Alternatives",
    input.alternatives.length ? input.alternatives.map((id) => `- ${id}`).join("\n") : "- none",
    "",
    "## Evidence",
    input.evidence || "—",
    "",
    "## Reviewers",
    input.reviewers.length ? input.reviewers.join(", ") : "none",
    "",
    "## Shards",
    input.shards.join(", ") || "root",
    "",
  ].join("\n");
}
