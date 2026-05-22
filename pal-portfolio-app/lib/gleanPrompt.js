import { resolvePalTicketFields } from "@/lib/palExportRow";

/**
 * User message for Glean Client API `POST /rest/api/v1/chat`.
 * Asks for the same **Investigation Summary** shape as Anthropic (condensed instructions).
 * @param {string} ticketId
 * @param {Record<string, string>[]} rows
 * @param {{ zendeskLiveBlock?: string }} [opts] — when `ZENDESK_*` API is configured, server appends live description + comments (same source SupportDog uses).
 */
export function buildGleanChatUserMessage(ticketId, rows, opts = {}) {
  if (!rows?.length) return "";
  const zendeskLive =
    typeof opts.zendeskLiveBlock === "string" && opts.zendeskLiveBlock.trim() ? opts.zendeskLiveBlock.trim() : "";
  const f = resolvePalTicketFields(rows[0]);
  const exportBlock = [
    `- Zendesk ticket id: ${ticketId}`,
    `- Subject: ${f.ticketSubject || "—"}`,
    `- Status: ${f.ticketStatus || "—"}`,
    `- Created: ${f.ticketCreatedTimestamp || "—"}`,
    `- Salesforce account: ${f.salesforceAccountName || "—"}`,
    `- Zendesk org name: ${f.zendeskOrgName || "—"}`,
    `- Primary product component (routing hint from export): ${f.primaryProductComponent || "—"}`,
    `- Ticket impact: ${f.ticketImpact || "—"}`,
    `- Premier support ticket: ${f.isPremierSupportTicket || "—"}`,
    `- PAL liaison (portfolio): ${f.palAssembledName || f.palLiaisonSfName || "—"} ${f.palLiaisonEmail ? `(${f.palLiaisonEmail})` : ""}`,
  ];
  if (rows.length > 1) {
    exportBlock.unshift(`(Note: ${rows.length} CSV rows reference this ticket id.)`);
  }

  const accountHint = f.salesforceAccountName || f.zendeskOrgName || "this customer";

  return `Search your enterprise index for **Zendesk ticket #${ticketId}** and for anything indexed about **${accountHint}** (org, prior tickets, Jira, Confluence, Slack, internal notes).

Then produce a **Datadog Support Investigation Summary** (internal). Follow the same structure you would after pulling full ticket JSON: extract metadata from export + index + any live Zendesk block; reconstruct the conversation chronologically; separate public vs internal; identify issue, resolution, outcome, confidence; list sources; follow-ups; escalation path.

**Doc validation:** Only compare agent guidance to **docs.datadoghq.com text that appears in your retrieved snippets or the live Zendesk block**. If you did not retrieve doc bodies, say *Not run — no doc body in context* under **Sources Used** — do not claim live doc fetches.

**Output rules (do not print this heading in your reply)**

1. **First line of your entire reply** must be exactly:
   \`## Investigation Summary — Ticket #${ticketId}\`
   Nothing may appear before that line.

2. Then the two-line metadata block (use **Unknown** where missing):
   **Customer:** … | **Org:** … | **Org ID:** … | **Datacenter:** …
   **Tier:** … | **Product Area:** … | **Assignee:** … (region)

3. Then these \`###\` sections **in order**: Issue Summary · Resolution Provided · Outcome (3 bullets) · Confidence (bold High/Medium/Low + one sentence) · Sources Used · Potential Follow-ups (numbered 1–3) · Escalation Path.

4. **Do not invent** facts not supported by export, retrieved index content, or the live Zendesk block.

Use the export block below, any **live Zendesk** block (if present), plus retrieved index content.

--- EXPORT (authoritative for ticket ids, subject, status timestamps, routing fields, PAL) ---
${exportBlock.join("\n")}${
    zendeskLive
      ? `

--- ZENDESK LIVE THREAD (Support API — server-side; same ticket payload SupportDog shows in Cursor) ---
${zendeskLive}`
      : ""
  }`;
}

/**
 * Copy-ready instructions for Cursor + Glean MCP (optional tooling outside this app).
 * @param {string} ticketId
 * @param {Record<string, string>[]} rows matching this ticket from the PAL export
 */
export function buildGleanAnalysisPrompt(ticketId, rows) {
  if (!rows?.length) return "";
  const chat = buildGleanChatUserMessage(ticketId, rows);
  return `${chat}

---

**In Cursor with Glean MCP:** run the same research, then answer with the **Investigation Summary** shape above (starting with \`## Investigation Summary — Ticket #${ticketId}\`) using only MCP-retrieved evidence plus the export block.`;
}

/**
 * @param {string} ticketId
 * @param {Record<string, string>[]} rows
 */
export function buildGleanSearchQuery(ticketId, rows) {
  const f = rows?.[0] ? resolvePalTicketFields(rows[0]) : null;
  const subject = f?.ticketSubject || "";
  const q = [ticketId, subject].filter(Boolean).join(" ");
  return q.trim() || String(ticketId);
}
