import { jiraKeyToBrowseUrl, findPrimaryJiraKeyInPalExportRow } from "@/lib/palPortfolioFrJira";
import {
  collectTags,
  engineeringEscalationReviewReason,
  escalationFromRow,
  exportSentimentReviewReason,
  isTerminalTicketStatus,
  normalizeStatusKey,
  ticketCreatedMs,
  ticketSolvedAtMs,
  ticketUpdatedMs,
} from "@/lib/palPortfolioTicketPrioritization";

const MS_DAY = 86400000;
const THREE_WEEKS_MS = 21 * MS_DAY;

/** Default highlights analysis window (ticket created date). */
export const DEFAULT_HIGHLIGHT_TRAILING_DAYS = 180;

/**
 * @param {Record<string, string>} row
 * @param {string[]} keys
 */
function col(row, keys) {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

/**
 * Feature / RFE style ticket from tags, type, or subject (export row).
 * @param {Record<string, string>} row
 */
export function isFeatureRequestTicket(row) {
  const tags = collectTags(row);
  if (
    tags.some((t) =>
      /^(feature_request|feature-request|rfe|enhancement|product_request|wishlist|feedback_request)$/.test(t) ||
      (t.includes("feature") && t.includes("request"))
    )
  ) {
    return true;
  }
  const typ = normalizeStatusKey(col(row, ["ticketType", "zendeskTicketType", "zendesk_ticket_type", "type"]));
  if (typ.includes("feature") || typ.includes("enhancement")) return true;
  const subj = col(row, ["ticketSubject", "subject"]);
  if (/feature request|\brfe\b|enhancement request|product feedback|wish[\s-]?list|feature ask/i.test(subj)) return true;
  return false;
}

/**
 * Heuristic: Datadog product / platform bug (not generic "debug" noise).
 * @param {Record<string, string>} row
 */
export function datadogBugSignalOnTicket(row) {
  const tags = collectTags(row);
  for (const t of tags) {
    if (t.includes("debug") || t === "logged") continue;
    if (
      /product_bug|platform_bug|confirmed_bug|datadog_bug|dd_bug|engineering_bug|known_issue|confirmed_issue|defect|jira_bug|upstream_bug|product_defect|software_bug|reproducible_bug|bug_report/.test(t) ||
      (/\bbug\b/.test(t) && (t.includes("product") || t.includes("platform") || t.includes("datadog")))
    ) {
      return true;
    }
  }
  const subj = col(row, ["ticketSubject", "subject"]);
  if (
    /\b(bug|defect|regression)\b.*\b(datadog|\bdd\b|your platform|product side)\b/i.test(subj) ||
    /\b(datadog|\bdd\b)\b.*\b(bug|defect|regression|broken)\b/i.test(subj) ||
    /\b(broken|not working)\b.*\b(datadog|platform)\b/i.test(subj)
  ) {
    return true;
  }
  return false;
}

/**
 * @param {string} yyyyMmDd
 * @returns {number | null}
 */
function startOfDayLocal(yyyyMmDd) {
  if (!yyyyMmDd) return null;
  const parts = yyyyMmDd.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  const [y, mo, da] = parts;
  return new Date(y, mo - 1, da, 0, 0, 0, 0).getTime();
}

/**
 * @param {string} yyyyMmDd
 * @returns {number | null}
 */
function endOfDayLocal(yyyyMmDd) {
  if (!yyyyMmDd) return null;
  const parts = yyyyMmDd.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  const [y, mo, da] = parts;
  return new Date(y, mo - 1, da, 23, 59, 59, 999).getTime();
}

/**
 * @param {string} yyyyMmDd
 * @returns {string}
 */
function toYyyyMmDdFromMs(ms) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Default highlights created range: trailing `trailingDays` ending on `rangeTo`, not before `rangeFrom`.
 * @param {string} rangeFrom
 * @param {string} rangeTo
 * @param {number} [trailingDays]
 */
export function defaultHighlightDateRange(rangeFrom, rangeTo, trailingDays = DEFAULT_HIGHLIGHT_TRAILING_DAYS) {
  const endMs = endOfDayLocal(rangeTo);
  const mainStartMs = startOfDayLocal(rangeFrom);
  if (endMs == null) return { highlightFrom: "", highlightTo: "" };
  const windowStartMs = Math.max(mainStartMs ?? 0, endMs - trailingDays * MS_DAY);
  return { highlightFrom: toYyyyMmDdFromMs(windowStartMs), highlightTo: rangeTo };
}

/**
 * Tickets whose **created** time falls in the highlights window (inclusive local calendar days).
 *
 * @param {Record<string, string>[]} tickets — already filtered by account/engineer/table range
 * @param {string} highlightFrom `yyyy-mm-dd`
 * @param {string} highlightTo `yyyy-mm-dd`
 */
export function ticketsInHighlightWindow(tickets, highlightFrom, highlightTo) {
  const startMs = startOfDayLocal(highlightFrom);
  const endMs = endOfDayLocal(highlightTo);
  if (startMs == null || endMs == null || startMs > endMs) return [];
  return tickets.filter((r) => {
    const ms = ticketCreatedMs(r);
    return ms != null && ms >= startMs && ms <= endMs;
  });
}

/** @deprecated Use {@link ticketsInHighlightWindow} with an explicit highlights range. */
export function ticketsInTrailing90DayWindow(tickets, rangeFrom, rangeTo) {
  const { highlightFrom, highlightTo } = defaultHighlightDateRange(rangeFrom, rangeTo, 90);
  return ticketsInHighlightWindow(tickets, highlightFrom, highlightTo);
}

/**
 * @param {Record<string, string>} row
 * @param {number} nowMs
 * @returns {string | null}
 */
function longPendingReviewReason(row, nowMs) {
  const created = ticketCreatedMs(row);
  if (created == null) return null;
  const ageMs = nowMs - created;
  const status = row.ticketStatus || "";
  const terminal = isTerminalTicketStatus(status);

  if (!terminal) {
    if (ageMs >= THREE_WEEKS_MS) {
      const d = Math.round(ageMs / MS_DAY);
      return `Still ${status || "active"} ~${d}d after creation — long-running or unresolved past 3 weeks; confirm expectations before the customer call.`;
    }
    return null;
  }

  const solved = ticketSolvedAtMs(row);
  const updated = ticketUpdatedMs(row);
  const endResolution = solved ?? updated;
  if (endResolution != null && endResolution - created > THREE_WEEKS_MS) {
    const w = Math.round((endResolution - created) / MS_DAY);
    return `~${w}d from creation to solved/closed (or last update if solve time missing) — unusually long cycle; worth reviewing narrative and customer sentiment.`;
  }
  if (solved == null && updated != null && updated - created > THREE_WEEKS_MS && terminal) {
    const w = Math.round((updated - created) / MS_DAY);
    return `Terminal status with ~${w}d from creation to last update (no explicit solved timestamp in export) — verify closure quality on the call.`;
  }
  return null;
}

/**
 * @param {Record<string, string>} row
 * @param {number} nowMs
 * @returns {string | null}
 */
function weakResolutionReviewReason(row, nowMs) {
  const created = ticketCreatedMs(row);
  if (created == null) return null;
  const ageDays = Math.round((nowMs - created) / MS_DAY);
  const status = row.ticketStatus || "—";

  const tags = collectTags(row);
  const reopenTag = tags.find((t) => t.includes("reopen"));
  if (reopenTag) {
    return `Reopened (tag: ${reopenTag}) — was closed and came back; confirm root cause, owner, and whether the customer is actually unblocked.`;
  }

  if (isTerminalTicketStatus(row.ticketStatus)) {
    const sent = exportSentimentReviewReason(row);
    if (sent) {
      return `Closed as ${status} but export still flags customer risk (${sent}) — do not treat as a clean closure until you validate on the call.`;
    }
  }

  if (escalationFromRow(row) && !isTerminalTicketStatus(row.ticketStatus) && ageDays >= 14) {
    return `Escalation signals on export while still ${status} for ~${ageDays}d — engineering and support narratives may be out of sync.`;
  }

  return null;
}

/**
 * @param {Record<string, string>} row
 * @returns {{ ticketId: string; subject: string }}
 */
function rowLabels(row) {
  const ticketId = String(row.ticketId || "").trim();
  const subject = String(row.ticketSubject || row.subject || "").trim() || "—";
  return { ticketId, subject };
}

/**
 * @param {Record<string, string>[]} ticketsInWindow
 * @param {string} [highlightFrom]
 * @param {string} [highlightTo]
 * @param {number} [nowMs]
 * @returns {{
 *   windowDescription: string;
 *   count: number;
 *   longPending: { ticketId: string; subject: string; reviewReason: string }[];
 *   engineering: { ticketId: string; subject: string; reviewReason: string }[];
 *   sentimentExport: { ticketId: string; subject: string; reviewReason: string }[];
 *   resolution: { ticketId: string; subject: string; reviewReason: string }[];
 *   featureRequestsAll: { ticketId: string; subject: string; reviewReason: string; frJiraKey?: string | null; frJiraUrl?: string | null }[];
 *   openDatadogBugFeatureRequests: { ticketId: string; subject: string; reviewReason: string; frJiraKey?: string | null; frJiraUrl?: string | null }[];
 * }}
 */
export function buildCustomerCallHighlights(
  ticketsInWindow,
  highlightFrom = "",
  highlightTo = "",
  nowMs = Date.now()
) {
  const sorted = [...ticketsInWindow].sort((a, b) => {
    const tb = ticketCreatedMs(b) ?? 0;
    const ta = ticketCreatedMs(a) ?? 0;
    return tb - ta;
  });

  /** @type {{ ticketId: string; subject: string; reviewReason: string }[]} */
  const longPending = [];
  /** @type {{ ticketId: string; subject: string; reviewReason: string }[]} */
  const engineering = [];
  /** @type {{ ticketId: string; subject: string; reviewReason: string }[]} */
  const sentimentExport = [];
  /** @type {{ ticketId: string; subject: string; reviewReason: string }[]} */
  const resolution = [];

  /** Each ticket appears in at most one risk highlight category (first match wins). */
  const assignedRisk = new Set();

  for (const row of sorted) {
    const { ticketId, subject } = rowLabels(row);
    if (!ticketId || assignedRisk.has(ticketId)) continue;

    const eng = engineeringEscalationReviewReason(row);
    if (eng) {
      assignedRisk.add(ticketId);
      engineering.push({ ticketId, subject, reviewReason: eng });
      continue;
    }

    const sen = exportSentimentReviewReason(row);
    if (sen) {
      assignedRisk.add(ticketId);
      sentimentExport.push({ ticketId, subject, reviewReason: sen });
      continue;
    }

    const res = weakResolutionReviewReason(row, nowMs);
    if (res) {
      assignedRisk.add(ticketId);
      resolution.push({ ticketId, subject, reviewReason: res });
      continue;
    }

    const lp = longPendingReviewReason(row, nowMs);
    if (lp) {
      assignedRisk.add(ticketId);
      longPending.push({ ticketId, subject, reviewReason: lp });
    }
  }

  const featureRequestsAll = [];
  const openDatadogBugFeatureRequests = [];
  const seenFr = new Set();
  const seenBugFr = new Set();

  for (const row of sorted) {
    const { ticketId, subject } = rowLabels(row);
    if (!ticketId) continue;
    if (isFeatureRequestTicket(row) && !seenFr.has(ticketId)) {
      seenFr.add(ticketId);
      const frKey = findPrimaryJiraKeyInPalExportRow(row);
      const frUrl = frKey ? jiraKeyToBrowseUrl(frKey) : null;
      featureRequestsAll.push({
        ticketId,
        subject,
        reviewReason:
          "Feature / enhancement request in portfolio — confirm roadmap, priority, and what the customer was told.",
        frJiraKey: frKey,
        frJiraUrl: frUrl,
      });
    }
    if (
      isFeatureRequestTicket(row) &&
      datadogBugSignalOnTicket(row) &&
      !isTerminalTicketStatus(row.ticketStatus) &&
      !seenBugFr.has(ticketId) &&
      !assignedRisk.has(ticketId)
    ) {
      seenBugFr.add(ticketId);
      const frKeyBug = findPrimaryJiraKeyInPalExportRow(row);
      const frUrlBug = frKeyBug ? jiraKeyToBrowseUrl(frKeyBug) : null;
      openDatadogBugFeatureRequests.push({
        ticketId,
        subject,
        reviewReason: `Open ${row.ticketStatus || "active"} FR with Datadog product-bug signals in tags/subject — customer may still be blocked on a fix or version.`,
        frJiraKey: frKeyBug,
        frJiraUrl: frUrlBug,
      });
    }
  }

  const windowDescription =
    highlightFrom && highlightTo
      ? `Tickets **created** from **${highlightFrom}** through **${highlightTo}** (highlights window), within the PAL account and table date filters.`
      : "Tickets in the highlights created-date window (within the PAL account and table date filters).";

  return {
    windowDescription,
    count: ticketsInWindow.length,
    assignedRiskTicketIds: [...assignedRisk],
    longPending,
    engineering,
    sentimentExport,
    resolution,
    featureRequestsAll,
    openDatadogBugFeatureRequests,
  };
}
