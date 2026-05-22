/** @typedef {{ score: number, tier: 'high' | 'medium' | 'low', reasons: string[] }} OpenTicketPriority */

const MS_DAY = 86400000;

const OPEN_LIKE = new Set(["open", "new"]);

const STATUS_ORDER = [
  /^open$/i,
  /^new$/i,
  /^pending/i,
  /^on[-\s]?hold/i,
  /^hold$/i,
  /^paused/i,
  /^solved/i,
  /^closed/i,
  /^merged/i,
];

/**
 * @param {string | undefined} raw
 */
export function normalizeStatusKey(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, " ");
}

/**
 * @param {string | undefined} status
 */
export function isOpenLikeStatus(status) {
  return OPEN_LIKE.has(normalizeStatusKey(status));
}

/**
 * @param {string | undefined} a
 * @param {string | undefined} b
 */
function compareStatusLabels(a, b) {
  const na = normalizeStatusKey(a);
  const nb = normalizeStatusKey(b);
  const ra = statusRank(na);
  const rb = statusRank(nb);
  if (ra !== rb) return ra - rb;
  return String(a || "—").localeCompare(String(b || "—"), undefined, { sensitivity: "base" });
}

/**
 * @param {string} normalized lowercased status
 */
function statusRank(normalized) {
  if (!normalized) return 999;
  for (let i = 0; i < STATUS_ORDER.length; i++) {
    if (STATUS_ORDER[i].test(normalized)) return i;
  }
  return 50;
}

/**
 * @param {Record<string, string>} row
 * @param {string[]} keys
 */
function firstString(row, keys) {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

/**
 * @param {Record<string, string>} row
 */
function parseMs(iso) {
  if (!iso) return null;
  const t = new Date(String(iso)).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * @param {Record<string, string>} row
 */
export function ticketCreatedMs(row) {
  return parseMs(row.ticketCreatedTimestamp);
}

/**
 * @param {Record<string, string>} row
 */
export function ticketUpdatedMs(row) {
  return (
    parseMs(
      firstString(row, [
        "ticketUpdatedTimestamp",
        "ticketUpdatedAt",
        "zendeskTicketUpdatedAt",
        "lastUpdatedTimestamp",
        "latestCommentAddedTimestamp",
      ])
    ) ?? parseMs(row.ticketUpdatedTimestamp)
  );
}

/**
 * @param {Record<string, string>} row
 * @returns {number | null}
 */
export function ticketSolvedAtMs(row) {
  return (
    parseMs(
      firstString(row, [
        "ticketSolvedTimestamp",
        "ticketSolvedAt",
        "solvedAt",
        "solvedTimestamp",
        "zendeskTicketSolvedAt",
        "ticketSolvedDate",
      ])
    ) ?? parseMs(row.ticketSolvedTimestamp)
  );
}

/**
 * @param {string | undefined} status
 */
export function isTerminalTicketStatus(status) {
  const n = normalizeStatusKey(status);
  return n.includes("solved") || n.includes("closed") || n.includes("merged");
}

/**
 * Zendesk "Closed" status only (not solved or merged).
 * @param {string | undefined} status
 */
export function isClosedTicketStatus(status) {
  const n = normalizeStatusKey(status);
  if (!n) return false;
  if (n.includes("solved") || n.includes("merged")) return false;
  return n === "closed" || /^closed\b/.test(n);
}

/**
 * @param {Record<string, string>} row
 */
export function collectTags(row) {
  const raw = firstString(row, ["ticketTags", "zendeskTicketTags", "tags", "zendesk_tags"]);
  if (!raw) return [];
  return raw
    .split(/[\s,;|]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * @param {Record<string, string>} row
 */
export function escalationFromRow(row) {
  const boolFields = [firstString(row, ["isEscalated", "ticketEscalated", "escalationFlag", "is_escalated"])];
  for (const f of boolFields) {
    const l = f.toLowerCase();
    if (l === "true" || l === "yes" || l === "1" || l === "y") return true;
  }
  const level = firstString(row, ["escalationLevel", "escalation_level"]).toLowerCase();
  if (/^(l?\s*[123]|p\s*1|sev\s*1|critical|high|major)/i.test(level)) return true;
  const tags = collectTags(row);
  const hit = tags.some(
    (t) =>
      t.includes("escalat") ||
      t.includes("tee_escalation") ||
      t.includes("exec_escalation") ||
      t.includes("severity_1") ||
      t.includes("sev1") ||
      t === "p1"
  );
  return hit;
}

/**
 * Human-readable reason when escalation signals suggest engineering / product involvement.
 * @param {Record<string, string>} row
 * @returns {string | null}
 */
export function engineeringEscalationReviewReason(row) {
  if (!escalationFromRow(row)) return null;
  const tags = collectTags(row);
  const match = tags.find((t) =>
    /tee|engineering|l3|jira|product_team|tier_?2|frslo|mnts|bug|escalat|sev|p1/.test(t)
  );
  if (match) return `Engineering / escalation context (tag: ${match}) — align on technical owner and status before the call.`;
  return "Escalation or severity-style flags on the export row — confirm engineering involvement and customer messaging.";
}

/**
 * @param {Record<string, string>} row
 */
function priorityScoreFromRow(row) {
  const p = normalizeStatusKey(firstString(row, ["ticketPriority", "zendeskTicketPriority", "zendesk_priority", "priority"]));
  if (p.includes("urgent") || p === "p1") return { add: 32, label: `Priority: ${firstString(row, ["ticketPriority", "priority"]) || "urgent"}` };
  if (p.includes("high") || p === "p2") return { add: 18, label: `Priority: ${firstString(row, ["ticketPriority", "priority"]) || "high"}` };
  if (p.includes("normal") || p.includes("medium") || p === "p3") return { add: 6, label: null };
  if (p.includes("low") || p === "p4") return { add: 0, label: null };
  if (p) return { add: 4, label: `Priority: ${firstString(row, ["ticketPriority", "priority"])}` };
  return { add: 0, label: null };
}

/**
 * @param {Record<string, string>} row
 */
function complexityScoreFromRow(row) {
  const c = normalizeStatusKey(
    firstString(row, ["ticketComplexity", "zendeskTicketComplexity", "predicted_complexity", "complexity", "ticket_complexity"])
  );
  if (!c) return { add: 0, label: null };
  if (c.includes("high") || c.includes("complex") || c.includes("very") || /l\s*4/.test(c) || /l\s*3/.test(c) || c.includes("level 4") || c.includes("level 3"))
    return { add: 14, label: `Complexity: ${firstString(row, ["ticketComplexity", "complexity"])}` };
  if (c.includes("medium") || /l\s*2/.test(c) || c.includes("level 2")) return { add: 7, label: null };
  return { add: 0, label: null };
}

/**
 * @param {Record<string, string>} row
 */
function sentimentScoreFromRow(row) {
  const raw = firstString(row, [
    "customerSentiment",
    "zendeskSentiment",
    "ticketSentiment",
    "sentiment",
    "sentimentLabel",
    "customer_sentiment",
  ]);
  const n = normalizeStatusKey(raw);
  const numStr = firstString(row, ["sentimentScore", "sentiment_score", "csatScore"]);
  if (!raw && numStr) {
    const num = Number(numStr);
    if (!Number.isNaN(num)) {
      if (num <= -0.35) return { add: 16, label: "Sentiment score: low" };
      if (num <= -0.15) return { add: 8, label: null };
      if (num >= 0.25) return { add: -2, label: null };
    }
    return { add: 0, label: null };
  }
  if (!n) return { add: 0, label: null };
  if (
    n.includes("negative") ||
    n.includes("poor") ||
    n.includes("angry") ||
    n.includes("frustrat") ||
    n.includes("unhappy") ||
    n.includes("at risk") ||
    n.includes("at-risk") ||
    n === "red" ||
    n.includes("dissatisfied")
  )
    return { add: 16, label: raw.length > 42 ? `Sentiment: ${raw.slice(0, 40)}…` : `Sentiment: ${raw}` };
  if (n.includes("positive") || n.includes("good") || n === "green" || n.includes("satisfied") || n.includes("happy"))
    return { add: -2, label: null };
  return { add: 0, label: null };
}

/**
 * @param {Record<string, string>} row
 */
function impactScoreFromRow(row) {
  const i = normalizeStatusKey(row.ticketImpact || "");
  if (i.includes("critical") || i.includes("blocker") || i.includes("sev")) return { add: 12, label: `Impact: ${row.ticketImpact}` };
  if (i.includes("high") || i.includes("major")) return { add: 8, label: null };
  if (i.includes("medium")) return { add: 4, label: null };
  return { add: 0, label: null };
}

/**
 * One-line reason for customer-call prep when export sentiment / DSAT signals are concerning.
 * @param {Record<string, string>} row
 * @returns {string | null}
 */
export function exportSentimentReviewReason(row) {
  const se = sentimentScoreFromRow(row);
  if (se.add >= 8) return se.label || "Negative or at-risk customer sentiment in export fields.";
  const dsat = firstString(row, ["dsatReasonComment", "dsat_reason_comment", "ticketDsatReason"]).trim();
  if (dsat.length >= 16) return "DSAT / dissatisfaction notes exist on the export row — validate tone and follow-through before the call.";
  const sat = firstString(row, ["satisfactionRatingComment", "satisfaction_comment", "ticketSatisfactionComment"]).trim();
  if (sat.length >= 24 && /\b(unhappy|frustrat|disappoint|terrible|awful|useless|unacceptable|not helpful)\b/i.test(sat)) {
    return "Satisfaction comment contains strong negative wording (export).";
  }
  return null;
}

/**
 * @param {Record<string, string>} row
 * @param {number} nowMs
 * @returns {OpenTicketPriority}
 */
export function computeOpenTicketPriority(row, nowMs = Date.now()) {
  const reasons = [];
  let score = 0;

  const created = ticketCreatedMs(row);
  if (created != null) {
    const days = Math.max(0, (nowMs - created) / MS_DAY);
    if (days >= 60) {
      score += 28;
      reasons.push(`Long-running (~${Math.round(days)}d open)`);
    } else if (days >= 30) {
      score += 20;
      reasons.push(`Long-running (~${Math.round(days)}d open)`);
    } else if (days >= 14) {
      score += 12;
      reasons.push(`Open ~${Math.round(days)}d`);
    } else if (days >= 7) {
      score += 6;
      reasons.push(`Open ~${Math.round(days)}d`);
    }
  }

  if (escalationFromRow(row)) {
    score += 26;
    reasons.push("Escalation signal (field/tags)");
  }

  const pr = priorityScoreFromRow(row);
  score += pr.add;
  if (pr.label) reasons.push(pr.label);

  const cx = complexityScoreFromRow(row);
  score += cx.add;
  if (cx.label) reasons.push(cx.label);

  const se = sentimentScoreFromRow(row);
  score += Math.max(0, se.add);
  if (se.label) reasons.push(se.label);

  const im = impactScoreFromRow(row);
  score += im.add;
  if (im.label) reasons.push(im.label);

  const updated = ticketUpdatedMs(row);
  if (created != null && updated != null) {
    const staleDays = (nowMs - updated) / MS_DAY;
    if (staleDays >= 14) {
      score += 10;
      reasons.push(`No update in ~${Math.round(staleDays)}d`);
    } else if (staleDays >= 7) {
      score += 5;
      reasons.push("Stale thread (7d+ since update)");
    }
  }

  const premier = String(row.isPremierSupportTicket || "").toLowerCase() === "true";
  if (premier && score >= 12) {
    score += 4;
    reasons.push("Premier account");
  }

  score = Math.max(0, Math.round(score));

  let tier = "low";
  if (score >= 44) tier = "high";
  else if (score >= 26) tier = "medium";

  return { score, tier: /** @type {'high' | 'medium' | 'low'} */ (tier), reasons };
}

/**
 * @param {Record<string, string>[]} tickets
 * @returns {{ statusLabel: string, tickets: Record<string, string>[] }[]}
 */
export function groupTicketsByStatus(tickets) {
  const by = new Map();
  for (const t of tickets) {
    const label = String(t.ticketStatus || "").trim() || "—";
    if (!by.has(label)) by.set(label, []);
    by.get(label).push(t);
  }
  const groups = [...by.entries()].map(([statusLabel, list]) => ({
    statusLabel,
    tickets: [...list].sort((a, b) => String(b.ticketCreatedTimestamp).localeCompare(String(a.ticketCreatedTimestamp))),
  }));
  groups.sort((a, b) => compareStatusLabels(a.statusLabel, b.statusLabel));
  return groups;
}
