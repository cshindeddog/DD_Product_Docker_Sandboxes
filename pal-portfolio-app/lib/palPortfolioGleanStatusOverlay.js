import { normalizeStatusKey } from "@/lib/palPortfolioTicketPrioritization";

/**
 * @param {string} exportStatus
 * @param {string} gleanDisplayStatus
 */
export function ticketStatusMismatch(exportStatus, gleanDisplayStatus) {
  const exp = normalizeStatusKey(exportStatus);
  const gle = normalizeStatusKey(gleanDisplayStatus);
  if (!gle) return false;
  if (!exp) return true;
  return exp !== gle;
}

/**
 * When Glean index status differs from CSV export, show Glean (indexed Zendesk).
 * @param {Record<string, string>} row
 * @param {Record<string, { displayStatus?: string }>} gleanById
 * @returns {Record<string, string>}
 */
export function rowWithGleanTicketStatus(row, gleanById) {
  const ticketId = String(row.ticketId || "").trim();
  const glean = gleanById[ticketId];
  const gleanDisplay = glean?.displayStatus?.trim();
  if (!gleanDisplay) return row;

  const exportStatus = String(row.ticketStatus || "").trim() || "—";
  if (!ticketStatusMismatch(exportStatus, gleanDisplay)) return row;

  return {
    ...row,
    ticketStatus: gleanDisplay,
    exportTicketStatus: exportStatus,
    ticketStatusSource: "glean",
  };
}
