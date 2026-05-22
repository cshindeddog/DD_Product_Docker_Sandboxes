import { resolvePalTicketFields } from "@/lib/palExportRow";

/**
 * Minimal investigation-summary markdown when Claude / Glean chat are not available,
 * so the ticket page still shows something useful from the PAL CSV export.
 * @param {string} ticketId
 * @param {Record<string, string>[]} rows
 * @param {string | null} sourcePath
 * @param {{ gleanHint?: string, zendeskLiveBlock?: string }} [opts]
 */
export function buildExportFallbackMarkdown(ticketId, rows, sourcePath, opts = {}) {
  const hint = typeof opts.gleanHint === "string" && opts.gleanHint.trim() ? opts.gleanHint.trim() : "";
  const zdLive =
    typeof opts.zendeskLiveBlock === "string" && opts.zendeskLiveBlock.trim() ? opts.zendeskLiveBlock.trim() : "";
  if (!rows?.[0]) {
    return `## Investigation Summary — Ticket #${ticketId}

**Customer:** Unknown | **Org:** Unknown | **Org ID:** Unknown | **Datacenter:** Unknown
**Tier:** Unknown | **Product Area:** Unknown | **Assignee:** Unknown (Unknown)

### Issue Summary

_No matching export row for ticket **#${ticketId}**._

### Resolution Provided

_Not applicable._

### Outcome
- Unknown
- Unknown
- Unknown

### Confidence
**Low** — No export row; cannot assess ticket.

### Sources Used
- **Ticket evidence:** PAL CSV export only (no row for this id)
- **docs.datadoghq.com:** *Not run — no doc body in context*

### Potential Follow-ups / Things to Watch
1. Confirm this ticket id exists in your PAL CSV and \`PAL_PORTFOLIO_CSV_PATH\` points at the right file.

### Escalation Path

None — fix data source first.`;
  }
  const f = resolvePalTicketFields(rows[0]);

  const parts = [
    `## Investigation Summary — Ticket #${f.ticketId || ticketId}`,
    "",
    `**Customer:** ${f.zendeskOrgName || "Unknown"} | **Org:** Unknown | **Org ID:** Unknown | **Datacenter:** Unknown`,
    `**Tier:** ${f.isPremierSupportTicket || "Unknown"} | **Product Area:** ${f.primaryProductComponent || "Unknown"} | **Assignee:** ${f.assigneeName || "Unknown"} (Unknown)`,
    "",
    "### Issue Summary",
    "",
    `**Export-only stub** — add \`ANTHROPIC_API_KEY\` to \`pal-portfolio/.env.local\` (and restart dev) for a full AI investigation summary, or configure Glean (SSO or \`GLEAN_API_TOKEN\`) and refresh.`,
    "",
    `- **Subject:** ${f.ticketSubject || "—"}`,
    `- **Account:** ${f.salesforceAccountName || "—"}`,
    `- **Status:** ${f.ticketStatus || "—"}`,
    `- **PAL:** ${f.palAssembledName || f.palLiaisonSfName || "—"}${f.palLiaisonEmail ? ` (${f.palLiaisonEmail})` : ""}`,
    "",
    "### Resolution Provided",
    "",
    "_Not available — no model summary ran._",
    "",
    "### Outcome",
    "- Unknown (no thread in export)",
    `- Export status: **${f.ticketStatus || "Unknown"}**`,
    "_Configure **Anthropic** and/or **Glean** + **Zendesk API** for live resolution narrative._",
    "",
    "### Confidence",
    "**Low** — CSV metadata only; no automated investigation.",
    "",
    "### Sources Used",
    "- **Ticket evidence:** PAL CSV export row only",
    "- **docs.datadoghq.com:** *Not run — no doc body in context*",
    "",
    "### Potential Follow-ups / Things to Watch",
    "1. Enable full ticket thread (Glean sign-in and/or `ZENDESK_EMAIL` + `ZENDESK_API_TOKEN`) for Issue/Resolution sections.",
    "2. Restart `npm run dev` after env changes.",
    "",
    "### Escalation Path",
    "",
    "None — configure AI/Glean/Zendesk as needed.",
  ];
  if (zdLive) {
    const cap = 28_000;
    const body = zdLive.length > cap ? `${zdLive.slice(0, cap)}\n\n…_(truncated)_` : zdLive;
    const safe = body.includes("~~~") ? body.replace(/~~~/g, "~~\u200b~~") : body;
    parts.push("", "### Live Zendesk thread (Support API)", "", "_Live thread below was loaded with **Zendesk Support API** — not summarized by the model in this stub._", "", "~~~", safe, "~~~");
  } else {
    parts.push(
      "",
      "_The default engineer PAL CSV has **no** ticket description or comments — set **Zendesk API** in `.env.local` for a live thread, or rely on **Glean** after sign-in._"
    );
  }
  if (hint) {
    parts.push("", `_Glean:_ ${hint.replace(/\s+/g, " ").slice(0, 400)}`);
  }
  if (sourcePath) {
    parts.push("", `_Data file:_ \`${sourcePath}\``);
  }
  return parts.join("\n");
}
