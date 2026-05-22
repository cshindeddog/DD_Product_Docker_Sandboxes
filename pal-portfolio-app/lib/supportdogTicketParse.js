import { normalizeSupportdogDatacenter, SUPPORTDOG_DATACENTERS } from "@/lib/supportdogDatacenter";

/**
 * @param {unknown} parsed
 */
export function extractZendeskTicketAttributes(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (parsed);
  if (o.data && typeof o.data === "object") {
    const d = /** @type {Record<string, unknown>} */ (o.data);
    if (d.attributes && typeof d.attributes === "object") {
      return /** @type {Record<string, unknown>} */ (d.attributes);
    }
  }
  if (o.attributes && typeof o.attributes === "object") {
    return /** @type {Record<string, unknown>} */ (o.attributes);
  }
  return o;
}

/**
 * @param {unknown} node
 * @param {number} depth
 */
function walkFindDatacenter(node, depth = 0) {
  if (depth > 14 || node == null) return null;
  if (typeof node === "string") {
    const m = node.match(/\b(US1|US3|US5|EU1|AP1|AP2|STAGING)\b/i);
    if (m) return normalizeSupportdogDatacenter(m[1]);
    if (/datadoghq\.eu\b/i.test(node)) return "EU1";
    if (/\bEMEA\b/i.test(node) || /\bAmsterdam\b/i.test(node)) return "EU1";
    if (/\bAPAC\b/i.test(node) || /\bTokyo\b/i.test(node) || /\bSydney\b/i.test(node)) return "AP1";
    return null;
  }
  if (typeof node === "object") {
    const o = /** @type {Record<string, unknown>} */ (node);
    for (const key of ["datacenter", "site", "dd_site", "org_site", "datadog_site", "region"]) {
      const v = o[key];
      if (typeof v === "string") {
        const dc = normalizeSupportdogDatacenter(v);
        if (dc && dc !== "STAGING") return dc;
      }
    }
    if (Array.isArray(o.custom_fields)) {
      for (const f of o.custom_fields) {
        if (!f || typeof f !== "object") continue;
        const row = /** @type {Record<string, unknown>} */ (f);
        const name = String(row.name || row.title || "").toLowerCase();
        const val = row.value;
        if (/datacenter|site|region/.test(name) && val != null) {
          const dc = normalizeSupportdogDatacenter(String(val));
          if (dc && dc !== "STAGING") return dc;
        }
      }
    }
    for (const v of Object.values(o)) {
      const found = walkFindDatacenter(v, depth + 1);
      if (found) return found;
    }
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = walkFindDatacenter(item, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * @param {unknown} ticketParsed
 * @param {unknown} [orgParsed]
 */
export function inferSupportdogDatacenter(ticketParsed, orgParsed) {
  const fromTicket = walkFindDatacenter(ticketParsed);
  if (fromTicket) return fromTicket;
  const fromOrg = walkFindDatacenter(orgParsed);
  if (fromOrg) return fromOrg;
  return null;
}

/**
 * @param {string} body
 * @param {number} max
 */
function truncateBody(body, max = 280) {
  const s = String(body || "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

/**
 * Chronological conversation for Claude (public + internal).
 * @param {unknown} parsed
 * @param {string} ticketId
 */
export function formatZendeskConversationMarkdown(parsed, ticketId) {
  const attrs = extractZendeskTicketAttributes(parsed);
  const comments = attrs?.comments;
  if (!Array.isArray(comments) || comments.length === 0) {
    return `_No \`comments\` array in SupportDog ticket JSON for #${ticketId}. Use raw ticket JSON below._`;
  }

  const sorted = [...comments].sort((a, b) =>
    String(a?.created_at || "").localeCompare(String(b?.created_at || ""))
  );

  const subject = typeof attrs?.subject === "string" ? attrs.subject : "";
  const status = typeof attrs?.status === "string" ? attrs.status : "";
  const assignee =
    attrs?.assignee && typeof attrs.assignee === "object"
      ? /** @type {{ name?: string }} */ (attrs.assignee).name
      : "";

  const lines = [
    `Subject: ${subject || "—"}`,
    `Status: ${status || "—"}`,
    assignee ? `Zendesk assignee: ${assignee}` : "",
    "",
    "| When (UTC) | Public | Excerpt |",
    "|---|:---:|---|",
  ].filter(Boolean);

  for (const c of sorted) {
    if (!c || typeof c !== "object") continue;
    const row = /** @type {Record<string, unknown>} */ (c);
    const when = String(row.created_at || "—").replace("T", " ").replace("Z", "Z");
    const pub = row.public === true || row.public === "true" ? "yes" : "no";
    lines.push(`| ${when} | ${pub} | ${truncateBody(row.body)} |`);
  }

  return lines.join("\n");
}

/** @type {readonly string[]} */
export const SUPPORTDOG_DC_PROBE_ORDER = ["EU1", "US1", "US3", "US5", "AP1", "AP2"];

/**
 * @param {string | null | undefined} preferred
 */
/** Default probe order when datacenter is unknown (EU1 first — common for EMEA tickets). */
export function supportdogDatacenterProbeOrder(preferred) {
  const order = [...SUPPORTDOG_DC_PROBE_ORDER];
  const first = normalizeSupportdogDatacenter(preferred);
  if (!first) return order;
  return [first, ...order.filter((dc) => dc !== first)];
}
