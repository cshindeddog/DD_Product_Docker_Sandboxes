import { collectTags } from "@/lib/palPortfolioTicketPrioritization";

/** @param {Record<string, string>} row @param {string[]} keys */
function firstString(row, keys) {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

/**
 * Default browse base for Datadog Jira (FR project). Override with `JIRA_BROWSE_BASE_URL` or
 * `NEXT_PUBLIC_JIRA_BROWSE_BASE_URL` when bundled for the browser.
 */
export function resolveJiraBrowseBase() {
  const a =
    (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_JIRA_BROWSE_BASE_URL?.trim()) ||
    (typeof process !== "undefined" && process.env?.JIRA_BROWSE_BASE_URL?.trim()) ||
    "";
  if (a) return a.replace(/\/$/, "");
  return "https://datadoghq.atlassian.net/browse";
}

/** @param {string} projectKey */
function isLikelyJiraProjectKey(projectKey) {
  return /^[A-Z][A-Z0-9]{1,9}$/.test(projectKey);
}

/**
 * @param {string | null | undefined} key e.g. FR-12345, LOGSS-999
 * @returns {string | null} https://…/browse/KEY-123
 */
export function jiraKeyToBrowseUrl(key) {
  if (!key || typeof key !== "string") return null;
  const m = key.trim().toUpperCase().match(/^([A-Z][A-Z0-9]{1,9})-(\d+)$/);
  if (!m || !isLikelyJiraProjectKey(m[1])) return null;
  return `${resolveJiraBrowseBase()}/${m[1]}-${m[2]}`;
}

/**
 * @param {string | null | undefined} key e.g. FR-12345
 * @returns {string | null} https://…/browse/FR-12345
 */
export function frJiraKeyToBrowseUrl(key) {
  if (!key || typeof key !== "string") return null;
  const k = key.trim().toUpperCase();
  if (!/^FR-\d+$/.test(k)) return null;
  return jiraKeyToBrowseUrl(k);
}

/**
 * First Feature Request Jira key (FR-####) in free text, or from an Atlassian browse URL.
 * @param {string | null | undefined} text
 * @returns {string | null} normalized FR-####
 */
const INLINE_JIRA_KEY = /\b([A-Z][A-Z0-9]{1,9})-(\d+)\b/g;

/**
 * All Jira keys in text (browse URLs + inline PROJ-123), deduped in order.
 * @param {string | null | undefined} text
 * @returns {string[]}
 */
export function findJiraKeysInText(text) {
  if (!text || typeof text !== "string") return [];
  const s = text;
  const seen = new Set();
  /** @type {string[]} */
  const out = [];

  const add = (raw) => {
    const url = jiraKeyToBrowseUrl(raw);
    if (!url) return;
    const k = raw.trim().toUpperCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(k);
  };

  for (const m of s.matchAll(/atlassian\.net\/browse\/([A-Z][A-Z0-9]{1,9}-\d+)/gi)) {
    add(m[1]);
  }

  INLINE_JIRA_KEY.lastIndex = 0;
  let m;
  while ((m = INLINE_JIRA_KEY.exec(s)) !== null) {
    add(`${m[1]}-${m[2]}`);
  }
  return out;
}

/**
 * Prefer FR-#### when multiple keys exist (feature-request workflow).
 * @param {string | null | undefined} text
 * @returns {string | null}
 */
export function findPrimaryJiraKeyInText(text) {
  const keys = findJiraKeysInText(text);
  const fr = keys.find((k) => /^FR-\d+$/.test(k));
  return fr || keys[0] || null;
}

export function findFrJiraKeyInText(text) {
  if (!text || typeof text !== "string") return null;
  const keys = findJiraKeysInText(text);
  return keys.find((k) => /^FR-\d+$/.test(k)) || null;
}

/**
 * Scan PAL CSV row values (subject, tags, columns whose names suggest Jira / linkage).
 * @param {Record<string, string>} row
 * @returns {string | null}
 */
/**
 * @param {Record<string, string>} row
 * @returns {string | null}
 */
export function findPrimaryJiraKeyInPalExportRow(row) {
  const chunks = [];
  chunks.push(firstString(row, ["ticketSubject", "subject"]));
  const rawTags = firstString(row, ["ticketTags", "zendeskTicketTags", "tags", "zendesk_tags"]);
  if (rawTags) chunks.push(rawTags);
  for (const t of collectTags(row)) {
    chunks.push(t);
  }
  for (const [k, v] of Object.entries(row)) {
    if (!v || !String(v).trim()) continue;
    if (/jira|fr_?key|feature_?request|linked_?issue|external_?ticket|ddjira|escalat|tee/i.test(k)) {
      chunks.push(String(v));
    }
  }
  const blob = chunks.join("\n");
  return findPrimaryJiraKeyInText(blob);
}

/**
 * @param {Record<string, string>} row
 * @returns {string | null}
 */
export function findFrJiraKeyInPalExportRow(row) {
  const keys = findJiraKeysInText(
    [
      firstString(row, ["ticketSubject", "subject"]),
      firstString(row, ["ticketTags", "zendeskTicketTags", "tags", "zendesk_tags"]),
      ...collectTags(row),
      ...Object.entries(row)
        .filter(([k]) => /jira|fr_?key|feature_?request|linked_?issue|external_?ticket|ddjira/i.test(k))
        .map(([, v]) => String(v || "")),
    ].join("\n")
  );
  return keys.find((k) => /^FR-\d+$/.test(k)) || null;
}

/** @param {unknown} v */
function stringifyFieldValue(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

/** Minimal HTML strip for description scan. */
function stripHtml(html) {
  if (!html || typeof html !== "string") return "";
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {Record<string, unknown> | null | undefined} ticket — Zendesk API `ticket` object
 * @returns {string | null}
 */
/**
 * @param {Record<string, unknown> | null | undefined} ticket — Zendesk API `ticket` object
 * @returns {string | null}
 */
export function findPrimaryJiraKeyInZendeskTicket(ticket) {
  if (!ticket || typeof ticket !== "object") return null;
  const chunks = [];
  if (typeof ticket.subject === "string") chunks.push(ticket.subject);
  if (typeof ticket.description === "string") chunks.push(stripHtml(ticket.description));
  if (typeof ticket.raw_subject === "string") chunks.push(ticket.raw_subject);
  if (Array.isArray(ticket.tags)) chunks.push(ticket.tags.join(" "));
  const cf = ticket.custom_fields;
  if (Array.isArray(cf)) {
    for (const f of cf) {
      if (!f || typeof f !== "object") continue;
      chunks.push(stringifyFieldValue(f.value));
    }
  }
  return findPrimaryJiraKeyInText(chunks.join("\n"));
}

/**
 * @param {Record<string, unknown> | null | undefined} ticket
 * @returns {string | null}
 */
export function findFrJiraKeyInZendeskTicket(ticket) {
  const primary = findPrimaryJiraKeyInZendeskTicket(ticket);
  if (primary && /^FR-\d+$/.test(primary)) return primary;
  if (!ticket || typeof ticket !== "object") return null;
  const chunks = [];
  if (typeof ticket.subject === "string") chunks.push(ticket.subject);
  if (typeof ticket.description === "string") chunks.push(stripHtml(ticket.description));
  return findJiraKeysInText(chunks.join("\n")).find((k) => /^FR-\d+$/.test(k)) || null;
}
