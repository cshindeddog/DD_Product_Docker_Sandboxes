import {
  expandGleanZendeskRichContent,
  zendeskAgentTicketUrl,
  zendeskAgentTicketsBaseFromEnv,
} from "@/lib/gleanZendeskIndexFetch";
import { gleanGetDocuments, isGleanConfigured } from "@/lib/gleanServer";
import { gleanMcpReadDocument, isGleanMcpConfigured } from "@/lib/gleanMcpClient";
import { ticketStatusMismatch } from "@/lib/palPortfolioGleanStatusOverlay";
import { isTerminalTicketStatus, normalizeStatusKey } from "@/lib/palPortfolioTicketPrioritization";

const GETDOCUMENTS_CHUNK = 8;
const MCP_FALLBACK_CONCURRENCY = 4;

function mcpDisabled() {
  return ["1", "true", "yes"].includes(String(process.env.GLEAN_MCP_DISABLE || "").trim().toLowerCase());
}

/**
 * @param {unknown} doc
 * @param {string} [fallbackTicketId]
 */
function ticketIdFromGleanDocument(doc, fallbackTicketId = "") {
  if (!doc || typeof doc !== "object") return fallbackTicketId;
  const d = /** @type {Record<string, unknown>} */ (doc);
  const url = pickStr(
    d.url,
    d.documentUrl,
    d.document_url,
    typeof d.metadata === "object" && d.metadata
      ? /** @type {Record<string, unknown>} */ (d.metadata).url
      : ""
  );
  const m = url.match(/tickets\/(\d+)(?:\D|$)/i);
  if (m) return m[1];
  return fallbackTicketId;
}

/**
 * @param {string} ticketId
 * @param {Request | null | undefined} request
 */
async function fetchGleanStatusForOneTicket(ticketId, request) {
  const url = zendeskAgentTicketUrl(ticketId);
  if (!url) return null;

  const res = await gleanGetDocuments([{ url }], request);
  if (res.ok && Array.isArray(res.documents) && res.documents[0]) {
    const parsed = extractStatusFromGleanDocument(res.documents[0]);
    if (parsed?.displayStatus) return parsed;
  }

  if (isGleanMcpConfigured() && !mcpDisabled()) {
    const mcp = await gleanMcpReadDocument(url, request);
    if (mcp.ok && mcp.text?.trim()) {
      try {
        const parsed = walkForGleanTicketStatus(JSON.parse(mcp.text.trim()));
        if (parsed?.displayStatus) return parsed;
      } catch {
        const parsed = walkForGleanTicketStatus(mcp.text);
        if (parsed?.displayStatus) return parsed;
      }
    }
  }

  return null;
}

/**
 * @param {unknown} v
 */
function pickStr(...values) {
  for (const v of values) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return "";
}

/**
 * @param {unknown} facets
 */
function statusFromFacets(facets) {
  if (!facets || typeof facets !== "object") return "";
  const f = /** @type {Record<string, unknown>} */ (facets);
  return pickStr(
    f.custom_status,
    f.customStatus,
    f.custom_status_name,
    f.customStatusName,
    f.status_label,
    f.statusLabel,
    f.status
  );
}

/**
 * Open / active-style statuses (Zendesk category), not terminal.
 * @param {string} status
 */
function isOpenishZendeskStatus(status) {
  const n = normalizeStatusKey(status);
  if (!n) return false;
  if (isTerminalTicketStatus(status)) return false;
  return (
    n === "open" ||
    n === "new" ||
    n.includes("pending") ||
    n.includes("hold") ||
    n.includes("paused")
  );
}

/**
 * Prefer terminal state when legacy category and custom agent label disagree (stale custom "Open" on solved tickets).
 * @param {string} legacy
 * @param {string} customName
 * @param {string} solvedAtIso
 */
function resolveZendeskDisplayStatus(legacy, customName, solvedAtIso) {
  const leg = legacy.trim();
  const cust = customName.trim();

  if (solvedAtIso && (!leg && !cust || (cust && isOpenishZendeskStatus(cust)) || (leg && isOpenishZendeskStatus(leg)))) {
    if (cust && isTerminalTicketStatus(cust)) return cust;
    if (cust && /solv/i.test(cust)) return cust;
    return leg && isTerminalTicketStatus(leg) ? leg : "Solved";
  }

  if (leg && cust && normalizeStatusKey(leg) !== normalizeStatusKey(cust)) {
    if (isTerminalTicketStatus(leg) && isOpenishZendeskStatus(cust)) {
      return /solv|clos|merge/i.test(cust) ? cust : leg;
    }
    if (isTerminalTicketStatus(cust) && isOpenishZendeskStatus(leg)) {
      return cust;
    }
  }

  return cust || leg;
}

/**
 * @param {unknown} payload
 * @returns {{ legacyStatus: string; customStatusName: string | null; displayStatus: string } | null}
 */
export function extractStatusFromGleanZendeskPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const p = /** @type {Record<string, unknown>} */ (payload);
  const attrs =
    p.attributes && typeof p.attributes === "object"
      ? /** @type {Record<string, unknown>} */ (p.attributes)
      : p;

  const legacy = pickStr(attrs.status, p.status, attrs.ticket_status, p.ticket_status);
  const customName = pickStr(
    attrs.custom_status_name,
    attrs.customStatusName,
    p.custom_status_name,
    p.customStatusName,
    statusFromFacets(attrs.facets ?? p.facets)
  );
  const solvedAt = pickStr(
    attrs.solved_at,
    attrs.solvedAt,
    attrs.solved_timestamp,
    attrs.solvedTimestamp,
    p.solved_at,
    p.solved_timestamp
  );

  if (!legacy && !customName && !solvedAt) return null;

  const displayStatus = resolveZendeskDisplayStatus(legacy, customName, solvedAt);
  if (!displayStatus) return null;

  return {
    legacyStatus: legacy || displayStatus,
    customStatusName: customName || null,
    displayStatus,
  };
}

/**
 * @param {unknown} node
 * @param {number} [depth]
 * @returns {{ legacyStatus: string; customStatusName: string | null; displayStatus: string } | null}
 */
function walkForGleanTicketStatus(node, depth = 0) {
  if (node == null || depth > 14) return null;

  if (typeof node === "string") {
    const t = node.trim();
    if (t.startsWith("{") || t.startsWith("[")) {
      try {
        return walkForGleanTicketStatus(JSON.parse(t), depth + 1);
      } catch {
        return null;
      }
    }
    return null;
  }

  if (typeof node !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (node);

  if (o.parsedZendeskTicket && typeof o.parsedZendeskTicket === "object") {
    const hit = extractStatusFromGleanZendeskPayload(o.parsedZendeskTicket);
    if (hit) return hit;
  }

  const direct = extractStatusFromGleanZendeskPayload(o);
  if (direct) return direct;

  const expanded = expandGleanZendeskRichContent(o);
  if (expanded !== o && expanded && typeof expanded === "object") {
    const hit = walkForGleanTicketStatus(expanded, depth + 1);
    if (hit) return hit;
  }

  const rich = o.richDocumentData;
  if (rich && typeof rich === "object") {
    const r = /** @type {Record<string, unknown>} */ (rich);
    if (r.parsedZendeskTicket && typeof r.parsedZendeskTicket === "object") {
      const hit = extractStatusFromGleanZendeskPayload(r.parsedZendeskTicket);
      if (hit) return hit;
    }
    if (typeof r.content === "string") {
      const hit = walkForGleanTicketStatus(r.content, depth + 1);
      if (hit) return hit;
    }
  }

  return null;
}

/**
 * @param {unknown} doc
 */
export function extractStatusFromGleanDocument(doc) {
  return walkForGleanTicketStatus(doc);
}

export { ticketStatusMismatch } from "@/lib/palPortfolioGleanStatusOverlay";

/**
 * @param {string[]} ticketIds
 * @param {Request | null | undefined} request
 * @returns {Promise<{
 *   configured: boolean;
 *   statuses: Record<string, { displayStatus: string; legacyStatus: string; customStatusName: string | null }>;
 *   refreshedSessionSeal: string | null;
 *   error?: string;
 * }>}
 */
export async function fetchGleanTicketStatuses(ticketIds, request) {
  if (!isGleanConfigured(request)) {
    return { configured: false, statuses: {}, refreshedSessionSeal: null };
  }
  if (!zendeskAgentTicketsBaseFromEnv()) {
    return {
      configured: true,
      statuses: {},
      refreshedSessionSeal: null,
      error: "Set ZENDESK_SUBDOMAIN or ZENDESK_AGENT_TICKET_URL_PREFIX for Glean ticket URLs.",
    };
  }

  const ids = [...new Set(ticketIds.map((x) => String(x).trim()).filter(Boolean))];
  if (!ids.length) {
    return { configured: true, statuses: {}, refreshedSessionSeal: null };
  }

  /** @type {Record<string, { displayStatus: string; legacyStatus: string; customStatusName: string | null }>} */
  const statuses = {};
  /** @type {string | null} */
  let refreshedSessionSeal = null;

  for (let i = 0; i < ids.length; i += GETDOCUMENTS_CHUNK) {
    const chunk = ids.slice(i, i + GETDOCUMENTS_CHUNK);
    /** @type {{ url: string; ticketId: string }[]} */
    const specs = [];
    for (const id of chunk) {
      const url = zendeskAgentTicketUrl(id);
      if (url) specs.push({ url, ticketId: id });
    }
    if (!specs.length) continue;

    const res = await gleanGetDocuments(
      specs.map((s) => ({ url: s.url })),
      request
    );
    if (res.refreshedSessionSeal) refreshedSessionSeal = res.refreshedSessionSeal;
    if (!res.ok || !Array.isArray(res.documents)) continue;

    for (let d = 0; d < res.documents.length; d++) {
      const doc = res.documents[d];
      const ticketId = ticketIdFromGleanDocument(doc, specs[d]?.ticketId || "");
      if (!ticketId) continue;
      const parsed = extractStatusFromGleanDocument(doc);
      if (parsed?.displayStatus) statuses[ticketId] = parsed;
    }
  }

  const missing = ids.filter((id) => !statuses[id]);
  for (let i = 0; i < missing.length; i += MCP_FALLBACK_CONCURRENCY) {
    const slice = missing.slice(i, i + MCP_FALLBACK_CONCURRENCY);
    await Promise.all(
      slice.map(async (id) => {
        const parsed = await fetchGleanStatusForOneTicket(id, request);
        if (parsed?.displayStatus) statuses[id] = parsed;
      })
    );
  }

  return { configured: true, statuses, refreshedSessionSeal };
}
