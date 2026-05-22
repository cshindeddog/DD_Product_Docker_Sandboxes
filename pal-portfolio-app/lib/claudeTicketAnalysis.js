import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import { TICKET_INVESTIGATION_SYSTEM_PROMPT } from "@/lib/datadogTicketInvestigationPrompt";
import { resolvePalTicketFields, supplementalExportNarrativeLines } from "@/lib/palExportRow";

/** Same as {@link TICKET_INVESTIGATION_SYSTEM_PROMPT} — kept so `claudeGleanToolLoop` can import `TICKET_ANALYSIS_SYSTEM_PROMPT`. */
export const TICKET_ANALYSIS_SYSTEM_PROMPT = TICKET_INVESTIGATION_SYSTEM_PROMPT;

/**
 * Claude (Anthropic) writes a structured **Investigation Summary** (Datadog Zendesk),
 * grounded on CSV export + Glean snippets and/or Zendesk Support API + Glean indexed ticket.
 */

/**
 * @param {Record<string, string>[]} rows
 * @param {string} ticketId
 */
export function buildExportFactsBlock(rows, ticketId) {
  if (!rows?.length) return "";
  const f = resolvePalTicketFields(rows[0]);
  const lines = [
    `Zendesk ticket id: ${f.ticketId || ticketId}`,
    `Subject: ${f.ticketSubject || "—"}`,
    `Status: ${f.ticketStatus || "—"}`,
    `Created: ${f.ticketCreatedTimestamp || "—"}`,
    `Salesforce account: ${f.salesforceAccountName || "—"}`,
    `Zendesk org: ${f.zendeskOrgName || "—"}`,
    `Primary product component (export routing): ${f.primaryProductComponent || "—"}`,
    `Impact: ${f.ticketImpact || "—"}`,
    `Premier flag: ${f.isPremierSupportTicket || "—"}`,
    `PAL liaison (portfolio — NOT Zendesk assignee): ${f.palAssembledName || f.palLiaisonSfName || "—"} ${f.palLiaisonEmail ? `(${f.palLiaisonEmail})` : ""}`,
  ];
  if (f.ticketSource) lines.push(`Ticket source (export): ${f.ticketSource}`);
  if (f.requesterEmail || f.submitterName) {
    lines.push(`Requester (export): ${[f.submitterName, f.requesterEmail].filter(Boolean).join(" · ") || "—"}`);
  }
  if (f.assigneeName) lines.push(`Assignee (export CSV column — verify against Zendesk API): ${f.assigneeName}`);
  for (const line of supplementalExportNarrativeLines(f)) {
    lines.push(line);
  }
  if (rows.length > 1) {
    lines.unshift(`(Export has ${rows.length} rows for this ticket id.)`);
  }
  lines.push("");
  lines.push(
    "**CSV limit:** This export does not include Zendesk description or comment bodies — only routing/metadata. Conversation text must come from the Glean indexed ticket and/or the Zendesk Support API block when configured."
  );
  return lines.join("\n");
}

/**
 * @param {{ title: string, url: string, snippet: string, datasource: string }[]} hits
 * @param {{ gleanConfigured: boolean, gleanSearchErrors?: string[], toolLoop?: boolean }} ctx
 */
export function buildGleanEvidenceBlock(hits, ctx) {
  const gleanConfigured = ctx?.gleanConfigured === true;
  const gleanSearchErrors = Array.isArray(ctx?.gleanSearchErrors) ? ctx.gleanSearchErrors : [];
  const toolLoop = ctx?.toolLoop === true;

  if (!gleanConfigured) {
    return `**Glean company-index search did not run** (no Glean credentials on this server: set \`GLEAN_INSTANCE_URL\` with \`GLEAN_API_TOKEN\`, or configure Glean OAuth in Admin and use **Sign in with Glean** in the app). A separate block may still contain **live Zendesk ticket data** from the Support API if \`ZENDESK_*\` credentials are configured.

If there is no Glean block below, you may note under **Sources Used** in your investigation summary that internal **Glean index** snippets were not used — do **not** claim "Glean returned zero hits." Prefer **Glean indexed ticket** JSON for the conversation when no **Zendesk Support API** block exists; tag briefly, e.g. \`(Zendesk API)\`, \`(export)\`, \`(Glean — evidence N)\`.`;
  }

  if (toolLoop && gleanConfigured) {
    return `**Glean index access (tool loop):** You can call the \`glean_search\` tool with focused queries. Each call hits the same **Glean REST search** your org uses with Glean MCP (snippets from indexed sources). Run several targeted searches (ticket id, customer, product, Jira keys from export) before writing the **Investigation Summary** (system Step 9). Do not claim you read a document unless a search result included it.`;
  }

  if (!hits.length) {
    const errBlock =
      gleanSearchErrors.length > 0
        ? `\n\n--- Search API diagnostics (for engineers; not customer-facing) ---\n${gleanSearchErrors
            .slice(0, 12)
            .map((e) => `- ${e}`)
            .join("\n")}\n`
        : "";
    return `**Glean search ran** (API credentials are set) but **returned no usable results** after querying by ticket id, subject, and account/org.${errBlock}
In **Sources Used** / **Issue Summary**, you may note the server **did** call Glean but snippets were empty (not the same as Glean disabled) — e.g. ticket not synced, connector gaps, or API errors above. Do not invent threads or Jira.`;
  }

  return hits
    .map((h, i) => {
      const sn = (h.snippet || "").replace(/\s+/g, " ").trim().slice(0, 1500);
      const ds = h.datasource ? ` [${h.datasource}]` : "";
      return `### Evidence ${i + 1}${ds}\n**Title:** ${h.title || "Untitled"}\n**URL:** ${h.url || "—"}\n**Snippet:**\n${sn || "(empty snippet)"}\n`;
    })
    .join("\n");
}

/**
 * @param {object} opts
 * @param {string} opts.ticketId
 * @param {Record<string, string>[]} opts.rows
 * @param {{ title: string, url: string, snippet: string, datasource: string }[]} opts.gleanHits
 * @param {boolean} opts.gleanConfigured
 * @param {string[]} [opts.gleanSearchErrors]
 * @param {string} [opts.zendeskLiveBlock]
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @returns {Promise<{ ok: true, text: string } | { ok: false, message: string, status?: number }>}
 */
export async function claudeWriteTicketSummary({
  ticketId,
  rows,
  gleanHits,
  gleanConfigured,
  gleanSearchErrors,
  zendeskLiveBlock,
  apiKey,
  model,
}) {
  const exportBlock = buildExportFactsBlock(rows, ticketId);
  const gleanBlock = buildGleanEvidenceBlock(gleanHits || [], {
    gleanConfigured: gleanConfigured === true,
    gleanSearchErrors: gleanSearchErrors || [],
  });
  const zdBlock =
    typeof zendeskLiveBlock === "string" && zendeskLiveBlock.trim()
      ? zendeskLiveBlock.trim()
      : "**Zendesk live block missing.** (Internal error — treat as no live Zendesk text.)";
  const headingLine = `## Investigation Summary — Ticket #${ticketId}`;
  const userContent = `Produce the **Investigation Summary** for **Zendesk ticket #${ticketId}** following the system instructions (Steps 1–9).

Your reply MUST begin with this **exact** first line (no text before it):
${headingLine}

--- EXPORT FACTS (authoritative for ids, subject, status timestamps, routing fields, PAL) ---
${exportBlock}

--- GLEAN COMPANY INDEX (Confluence, Slack, Jira, mirrored Zendesk in Glean — only if configured) ---
${gleanBlock}

--- ZENDESK TICKET (Glean MCP read_document and/or REST getdocuments on agent URL + optional Support API) ---
${zdBlock}

If the ZENDESK TICKET section has **no** usable description/comments/indexed body for this ticket, follow the system prompt **thin evidence** rules: still emit every Step 9 heading with **Unknown** / *Not retrieved* where appropriate and **Confidence: Low**.`;

  const body = {
    model: model || "claude-sonnet-4-5-20250929",
    max_tokens: 12_000,
    temperature: 0.25,
    system: TICKET_INVESTIGATION_SYSTEM_PROMPT,
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
