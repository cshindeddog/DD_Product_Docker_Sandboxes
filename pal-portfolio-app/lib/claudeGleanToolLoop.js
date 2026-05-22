import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import {
  TICKET_ANALYSIS_SYSTEM_PROMPT,
  buildExportFactsBlock,
  buildGleanEvidenceBlock,
} from "@/lib/claudeTicketAnalysis";
import { getGleanRestAuth, gleanAuthErrorMessage, gleanSearchQuery, normalizeGleanSearchItem } from "@/lib/gleanServer";

const GL_TOOLS = [
  {
    name: "glean_search",
    description:
      "Search the organization's Glean index (same REST search backing Glean MCP discovery: Zendesk mirrors, Confluence, Jira, Slack excerpts, etc.). Use focused queries; run multiple calls with different angles before writing the **Investigation Summary** (system Step 9: ## heading + metadata line + Issue / Resolution / Outcome / Confidence / Sources / Follow-ups / Escalation).",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: 'e.g. "Zendesk 12345", customer + product keywords, Jira key, monitor URL fragment',
        },
      },
      required: ["query"],
    },
  },
];

/**
 * @param {unknown[]} results
 */
function formatHitsForTool(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return "No results for this query.";
  }
  const lines = [];
  for (let i = 0; i < results.length; i++) {
    const norm = normalizeGleanSearchItem(/** @type {Record<string, unknown>} */ (results[i]));
    if (!norm) continue;
    const sn = (norm.snippet || "").replace(/\s+/g, " ").trim().slice(0, 2000);
    lines.push(
      `### Hit ${i + 1}\n- **Title:** ${norm.title}\n- **URL:** ${norm.url || "—"}\n- **Datasource:** ${norm.datasource || "—"}\n- **Snippet:** ${sn || "(empty)"}`
    );
  }
  if (!lines.length) return "No parseable results.";
  return lines.join("\n\n");
}

/**
 * @param {unknown[]} content
 */
function extractAssistantText(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && typeof b === "object" && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
}

/**
 * Claude + iterative `glean_search` tool calls (Glean REST — same index corpus as Glean MCP; not the MCP wire protocol).
 * @param {object} opts
 * @param {string} opts.ticketId
 * @param {Record<string, string>[]} opts.rows
 * @param {string} opts.zendeskLiveBlock
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {Request} [opts.request] — forwarded for Glean SSO cookie auth
 * @param {number} [opts.maxApiRounds]
 * @returns {Promise<{ ok: true, text: string, gleanHitsFromTools: { title: string, url: string, snippet: string, datasource: string }[], gleanRefreshedSessionSeal?: string | null } | { ok: false, message: string, status?: number }>}
 */
export async function claudeAnalyzeTicketWithGleanSearchTool(opts) {
  const {
    ticketId,
    rows,
    zendeskLiveBlock,
    apiKey,
    model,
    request,
    maxApiRounds = 14,
  } = opts;

  const gleanAuth = await getGleanRestAuth(request ?? null);
  if (!gleanAuth.ok) {
    return { ok: false, message: gleanAuthErrorMessage(gleanAuth.code), status: 401 };
  }
  /** @type {string | null} */
  let gleanRefreshedSessionSeal = gleanAuth.refreshedSessionSeal || null;

  const exportBlock = buildExportFactsBlock(rows, ticketId);
  const gleanBlock = buildGleanEvidenceBlock([], {
    gleanConfigured: true,
    gleanSearchErrors: [],
    toolLoop: true,
  });
  const zdBlock =
    typeof zendeskLiveBlock === "string" && zendeskLiveBlock.trim()
      ? zendeskLiveBlock.trim()
      : "**Zendesk live block missing.**";
  const headingLine = `## Investigation Summary — Ticket #${ticketId}`;
  const initialUser = `Gather evidence with \`glean_search\` (as many queries as needed), then output the **Investigation Summary** per the system prompt (Steps 1–9).

When finished with tools, your reply MUST begin with this **exact** first line (no text before it):
${headingLine}

Then complete every Step 9 subsection (\`### Issue Summary\` through \`### Escalation Path\`).

--- EXPORT FACTS ---
${exportBlock}

--- GLEAN (use glean_search tool; do not invent index content) ---
${gleanBlock}

--- ZENDESK LIVE TICKET (Support API when configured) ---
${zdBlock}`;

  /** @type {{ role: string, content: unknown }[]} */
  const messages = [{ role: "user", content: initialUser }];

  /** @type {{ title: string, url: string, snippet: string, datasource: string }[]} */
  const gleanHitsFromTools = [];
  const seenHit = new Set();

  for (let round = 0; round < maxApiRounds; round++) {
    const body = {
      model: model || "claude-sonnet-4-5-20250929",
      max_tokens: 12_000,
      temperature: 0.2,
      system: TICKET_ANALYSIS_SYSTEM_PROMPT,
      tools: GL_TOOLS,
      messages,
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

    const content = Array.isArray(json.content) ? json.content : [];
    messages.push({ role: "assistant", content });

    const stopReason = String(json.stop_reason || "");

    if (stopReason !== "tool_use") {
      const text = extractAssistantText(content).trim();
      if (text) {
        return { ok: true, text, gleanHitsFromTools, gleanRefreshedSessionSeal };
      }
      return { ok: false, message: "Claude ended without text output.", status: 502 };
    }

    /** @type {{ type: string, tool_use_id: string, content: string }[]} */
    const toolResultBlocks = [];

    for (const block of content) {
      if (!block || typeof block !== "object" || block.type !== "tool_use") continue;
      if (block.name !== "glean_search") continue;
      const id = typeof block.id === "string" ? block.id : "";
      const input = block.input && typeof block.input === "object" ? block.input : {};
      const q = typeof input.query === "string" ? input.query : "";
      const search = await gleanSearchQuery(q.slice(0, 2000), 16, { headers: gleanAuth.headers });
      if (search.refreshedSessionSeal) gleanRefreshedSessionSeal = search.refreshedSessionSeal;
      let payload = "";
      if (!search.ok) {
        payload = `glean_search failed: ${search.message || search.code || "unknown"}`;
      } else {
        payload = formatHitsForTool(search.results);
        for (const item of search.results) {
          const norm = normalizeGleanSearchItem(/** @type {Record<string, unknown>} */ (item));
          if (!norm) continue;
          const key = norm.url || norm.id || norm.title;
          if (!key || seenHit.has(key)) continue;
          seenHit.add(key);
          gleanHitsFromTools.push({
            title: norm.title,
            url: norm.url,
            snippet: norm.snippet,
            datasource: norm.datasource,
          });
        }
      }
      if (id) {
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: id,
          content: payload.slice(0, 24_000),
        });
      }
    }

    if (!toolResultBlocks.length) {
      const fallbackText = extractAssistantText(content).trim();
      if (fallbackText) return { ok: true, text: fallbackText, gleanHitsFromTools, gleanRefreshedSessionSeal };
      return { ok: false, message: "tool_use stop without executable glean_search tools.", status: 502 };
    }

    messages.push({ role: "user", content: toolResultBlocks });
  }

  return { ok: false, message: `Exceeded max API rounds (${maxApiRounds}) for Glean tool loop.`, status: 502 };
}
