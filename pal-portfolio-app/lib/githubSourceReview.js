/** @type {{ pattern: RegExp; repo: string; label: string }[]} */
const SDK_REPOS = [
  { pattern: /\bpython\b|\bpy\b|ddtrace\b|dd-trace-py\b/i, repo: "https://github.com/DataDog/dd-trace-py", label: "Python SDK (dd-trace-py)" },
  { pattern: /\bgo\b|golang\b|dd-trace-go\b/i, repo: "https://github.com/DataDog/dd-trace-go", label: "Go SDK (dd-trace-go)" },
  { pattern: /\bjava\b|dd-trace-java\b/i, repo: "https://github.com/DataDog/dd-trace-java", label: "Java SDK (dd-trace-java)" },
  { pattern: /\bnode\.?js\b|\bjavascript\b|dd-trace-js\b/i, repo: "https://github.com/DataDog/dd-trace-js", label: "Node.js SDK (dd-trace-js)" },
  { pattern: /\bruby\b|dd-trace-rb\b/i, repo: "https://github.com/DataDog/dd-trace-rb", label: "Ruby SDK (dd-trace-rb)" },
  { pattern: /\bagent\b|datadog-agent\b/i, repo: "https://github.com/DataDog/datadog-agent", label: "Datadog Agent" },
  { pattern: /\bdotnet\b|\.net\b|c#\b|dd-trace-dotnet\b/i, repo: "https://github.com/DataDog/dd-trace-dotnet", label: ".NET SDK" },
  { pattern: /\bphp\b|dd-trace-php\b/i, repo: "https://github.com/DataDog/dd-trace-php", label: "PHP SDK" },
];

/**
 * Step 8 — suggest GitHub repos to review (diagnosis only; no PRs).
 * @param {string} corpus
 */
export function pickGithubReposForTicket(corpus) {
  const text = String(corpus || "");
  /** @type {{ repo: string; label: string }[]} */
  const out = [];
  const seen = new Set();
  for (const row of SDK_REPOS) {
    if (!row.pattern.test(text)) continue;
    if (seen.has(row.repo)) continue;
    seen.add(row.repo);
    out.push({ repo: row.repo, label: row.label });
  }
  if (out.length === 0) {
    out.push({ repo: "https://github.com/DataDog/dd-trace-py", label: "Python SDK (default — verify language with customer)" });
  }
  return out.slice(0, 3);
}

/**
 * @param {{ repo: string; label: string }[]} repos
 */
export function formatGithubSourceReviewMarkdown(repos) {
  const lines = [
    "Review source **only if** root cause is unclear after ticket + docs + Glean, or the issue suggests an SDK/backend bug.",
    "Do **not** propose code fixes or pull requests — diagnosis only.",
    "",
    "| Product | Repository |",
    "|---------|------------|",
  ];
  for (const r of repos) {
    lines.push(`| ${r.label} | ${r.repo} |`);
  }
  lines.push(
    "",
    "Use these repos to locate relevant code paths (upload logic, serialization, config parsing, etc.) and cite file paths in findings if you infer them from public README/issue search — do not invent line numbers without evidence."
  );
  return lines.join("\n");
}
