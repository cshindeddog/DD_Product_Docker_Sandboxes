import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import { buildExportFactsBlock, buildGleanEvidenceBlock } from "@/lib/claudeTicketAnalysis";
import { INVESTIGATION_PLAYBOOK_SYSTEM_PROMPT } from "@/lib/investigationPlaybookPrompt";
import { buildInvestigationTopicHints } from "@/lib/investigationTopicHints";
import { gleanSearchQuery, isGleanConfigured, normalizeGleanSearchItem } from "@/lib/gleanServer";

/**
 * @param {string} ticketId
 * @param {Record<string, string>[]} rows
 * @param {string} datacenter
 * @param {string} playbookContext
 * @param {boolean} gleanAvailable
 * @param {string} apiKey
 * @param {string} model
 */
export async function claudeInvestigationPlaybookSummary({
  ticketId,
  rows,
  datacenter,
  playbookContext,
  gleanAvailable,
  apiKey,
  model,
}) {
  const topicHints = buildInvestigationTopicHints(playbookContext);

  const userContent = `Run **investigation-playbook** Step 9 synthesis for Zendesk ticket **#${ticketId}**.

**Report datacenter:** ${datacenter}
**glean_available:** ${gleanAvailable}
${topicHints}

Your reply MUST begin with exactly:
## Investigation Summary — Ticket #${ticketId}

Follow the full Step 9 structure in your system prompt: **Conversation Trace** table, **Confirmed vs Uncertain** in root cause, **Handling gaps**, split **Confidence**, **Internal** vs **Customer-facing** diagnostic steps. Do **not** include **Recommended Customer Reply**, draft response, or any Zendesk reply section.

--- INVESTIGATION PLAYBOOK EVIDENCE (Steps 3–8) ---
${playbookContext}
`;

  const body = {
    model: model || "claude-sonnet-4-5-20250929",
    max_tokens: 12_000,
    temperature: 0.2,
    system: INVESTIGATION_PLAYBOOK_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  };

  let res;
  try {
    res = await fetchWithTimeout(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify(body),
        cache: "no-store",
      },
      180_000
    );
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }

  const raw = await res.text();
  let json;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    return { ok: false, message: raw.slice(0, 600), status: res.status };
  }

  if (!res.ok) {
    const msg =
      (json && (json.error?.message || json.message)) || raw.slice(0, 600) || res.statusText;
    return { ok: false, message: String(msg), status: res.status };
  }

  const parts = Array.isArray(json.content) ? json.content : [];
  const text = parts
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");

  if (!text.trim()) {
    return { ok: false, message: "Claude returned an empty response.", status: 502 };
  }

  return { ok: true, text: text.trim() };
}

/**
 * Step 5 probe + Step 7 searches (Glean REST — same index as Glean MCP).
 * @param {string} ticketId
 * @param {Record<string, string>[]} rows
 * @param {Request | null | undefined} request
 * @param {string} [corpus]
 */
export async function gleanHitsForInvestigationPlaybook(ticketId, rows, request, corpus = "") {
  if (!isGleanConfigured(request)) {
    return {
      gleanConfigured: false,
      gleanAvailable: false,
      gleanHits: [],
      gleanSearchErrors: [],
      refreshedSessionSeal: null,
      evidenceMarkdown: buildGleanEvidenceBlock([], { gleanConfigured: false }),
    };
  }

  const subject = String(rows?.[0]?.ticketSubject || rows?.[0]?.subject || "").slice(0, 200);
  const product = String(rows?.[0]?.primaryProductComponent || "").slice(0, 120);

  /** @type {string[]} */
  const errors = [];
  /** @type {string | null} */
  let refreshedSessionSeal = null;
  let probeOk = false;

  const probe = await gleanSearchQuery("datadog support", 3, { request });
  if (probe.refreshedSessionSeal) refreshedSessionSeal = probe.refreshedSessionSeal;
  if (probe.ok && (probe.results?.length || 0) > 0) probeOk = true;
  else if (!probe.ok) errors.push(`Glean probe: ${probe.message || probe.code || "failed"}`);

  /** @type {string[]} */
  const queries = [
    `Zendesk ${ticketId}`,
    [ticketId, subject, product].filter(Boolean).join(" ").slice(0, 400),
  ];

  if (corpus) {
    const errMatch = corpus.match(/\b([A-Z][a-z]+Error|[A-Z]{2,}_[A-Z0-9_]+|error\s+\d{3,5})\b/g);
    if (errMatch?.[0]) queries.push(String(errMatch[0]).slice(0, 120));
    if (/\bsynthetic|browser test|locate_element|\btti\b|private location/i.test(corpus)) {
      queries.push("Synthetic Monitoring browser test failure troubleshooting");
      queries.push("Synthetics private location runner");
    }
    if (/\bddsql\b|metrics explorer|resource.type|host list/i.test(corpus)) {
      queries.push("DDSQL query filter AND OR");
      queries.push("Metrics Explorer resource type filter");
    }
    if (/\bflare\b|agent log|service check|no.data|host down/i.test(corpus)) {
      queries.push("agent flare troubleshooting");
      queries.push("monitor no data service check delay");
    }
  }

  /** @type {{ title: string; url: string; snippet: string; datasource: string }[]} */
  const hits = [];
  const seen = new Set();

  for (const q of [...new Set(queries)]) {
    const res = await gleanSearchQuery(q, 12, { request });
    if (res.refreshedSessionSeal) refreshedSessionSeal = res.refreshedSessionSeal;
    if (!res.ok) {
      errors.push(`${q}: ${res.message || res.code || "search failed"}`);
      continue;
    }
    for (const item of res.results || []) {
      const norm = normalizeGleanSearchItem(/** @type {Record<string, unknown>} */ (item));
      if (!norm) continue;
      const key = norm.url || norm.title;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      hits.push(norm);
    }
  }

  const gleanAvailable = probeOk || hits.length > 0;
  const evidenceMarkdown = buildGleanEvidenceBlock(hits.slice(0, 18), {
    gleanConfigured: true,
    gleanSearchErrors: errors,
  });

  return {
    gleanConfigured: true,
    gleanAvailable,
    gleanHits: hits.slice(0, 18),
    gleanSearchErrors: errors,
    refreshedSessionSeal,
    evidenceMarkdown,
  };
}
