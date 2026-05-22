/**
 * PAL exports use different CSV schemas (engineer portfolio vs account ticket export).
 * Map common aliases so subject/status/etc. are not dropped when headers differ.
 * @param {Record<string, string> | null | undefined} row
 */
export function resolvePalTicketFields(row) {
  const r = row && typeof row === "object" ? row : {};
  /** @param {...string} keys */
  const pick = (...keys) => {
    for (const k of keys) {
      const v = r[k];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return "";
  };

  return {
    ticketId: pick("ticketId"),
    ticketSubject: pick("ticketSubject", "subject"),
    ticketStatus: pick("ticketStatus", "status"),
    ticketCreatedTimestamp: pick("ticketCreatedTimestamp", "createdTimestamp"),
    salesforceAccountName: pick("salesforceAccountName"),
    zendeskOrgName: pick("zendeskOrgName", "orgName"),
    primaryProductComponent: pick("primaryProductComponent"),
    ticketImpact: pick("ticketImpact"),
    isPremierSupportTicket: pick("isPremierSupportTicket", "premierSupportTicket"),
    palAssembledName: pick("palAssembledName"),
    palLiaisonSfName: pick("palLiaisonSfName"),
    palLiaisonEmail: pick("palLiaisonEmail"),
    ticketSource: pick("ticketSource", "source"),
    requesterEmail: pick("requesterEmail"),
    submitterName: pick("submitterName"),
    assigneeName: pick("assigneeName"),
    satisfactionRatingComment: pick("satisfactionRatingComment"),
    dsatReasonComment: pick("dsatReasonComment"),
  };
}

/**
 * Long free-text fields sometimes present on account-level exports (not a full thread).
 * @param {ReturnType<typeof resolvePalTicketFields>} f
 */
export function supplementalExportNarrativeLines(f) {
  const lines = [];
  const push = (label, val) => {
    const s = String(val || "").replace(/\s+/g, " ").trim();
    if (s.length >= 12) lines.push(`- **${label} (export):** ${s.slice(0, 4000)}`);
  };
  push("CSAT / satisfaction comment", f.satisfactionRatingComment);
  push("DSAT reason comment", f.dsatReasonComment);
  return lines;
}
