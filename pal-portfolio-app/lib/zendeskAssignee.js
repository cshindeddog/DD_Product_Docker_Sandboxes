/** Datadog Zendesk custom field ids (assignee display name, region). */
export const ZENDESK_ASSIGNEE_CUSTOM_FIELD_ID = "9066374898075";
export const ZENDESK_REGION_CUSTOM_FIELD_ID = "9067264153371";

/**
 * @param {unknown[]} users
 * @returns {Record<number, string>}
 */
export function buildZendeskUserNameById(users) {
  /** @type {Record<number, string>} */
  const userNameById = {};
  if (!Array.isArray(users)) return userNameById;
  for (const u of users) {
    if (!u || typeof u !== "object" || typeof u.id !== "number") continue;
    const name =
      (typeof u.name === "string" && u.name.trim()) ||
      [u.email, u.role].filter(Boolean).join(" ") ||
      `user #${u.id}`;
    userNameById[u.id] = name;
  }
  return userNameById;
}

/**
 * Current Zendesk ticket assignee — not PAL liaison, not comment authors.
 * @param {Record<string, unknown> | null | undefined} ticket
 * @param {Record<number, string>} userNameById
 * @returns {{ name: string | null; region: string | null }}
 */
export function resolveZendeskTicketAssignee(ticket, userNameById) {
  if (!ticket || typeof ticket !== "object") return { name: null, region: null };

  let name = null;
  let region = null;

  const assigneeId = ticket.assignee_id;
  if (typeof assigneeId === "number" && userNameById[assigneeId]) {
    name = userNameById[assigneeId];
  }

  const cf = Array.isArray(ticket.custom_fields) ? ticket.custom_fields : [];
  for (const f of cf) {
    if (!f || typeof f !== "object") continue;
    const id = String(f.id ?? "");
    const val = f.value != null ? String(f.value).trim() : "";
    if (!val) continue;
    if (id === ZENDESK_ASSIGNEE_CUSTOM_FIELD_ID && !name) name = val;
    if (id === ZENDESK_REGION_CUSTOM_FIELD_ID) region = val;
  }

  return { name: name || null, region: region || null };
}

/**
 * Parse assignee from our Zendesk API prompt block line.
 * @param {string} block
 * @returns {{ name: string | null; region: string | null }}
 */
export function parseAssigneeFromZendeskApiBlock(block) {
  if (!block || typeof block !== "string") return { name: null, region: null };
  const nameM = block.match(/\*\*Assignee \(Zendesk — current ticket owner\):\*\*\s*(.+)/i);
  const regionM = block.match(/\*\*Assignee region \(custom field\):\*\*\s*(.+)/i);
  const name = nameM ? nameM[1].trim() : null;
  const region = regionM ? regionM[1].trim() : null;
  if (!name || name === "—" || /^unassigned$/i.test(name)) return { name: null, region };
  return { name, region: region && region !== "—" ? region : null };
}

/**
 * Best-effort assignee from Glean-indexed Zendesk JSON blob.
 * @param {string} jsonText
 * @returns {{ name: string | null; region: string | null }}
 */
export function extractAssigneeFromGleanZendeskJson(jsonText) {
  if (!jsonText || typeof jsonText !== "string") return { name: null, region: null };
  let root;
  try {
    root = JSON.parse(jsonText);
  } catch {
    return { name: null, region: null };
  }

  /** @param {unknown} node */
  function walk(node) {
    if (!node || typeof node !== "object") return null;
    const o = /** @type {Record<string, unknown>} */ (node);
    const parsed = o.parsedZendeskTicket;
    if (parsed && typeof parsed === "object") {
      const p = /** @type {Record<string, unknown>} */ (parsed);
      const attrs = p.attributes && typeof p.attributes === "object" ? p.attributes : p;
      const ticketLike = {
        assignee_id: attrs.assignee_id ?? p.assignee_id,
        custom_fields: attrs.custom_fields ?? p.customFields ?? p.custom_fields,
      };
      const users = Array.isArray(p.users) ? p.users : [];
      const { name, region } = resolveZendeskTicketAssignee(ticketLike, buildZendeskUserNameById(users));
      if (name) return { name, region };
    }
    if (typeof o.assignee_id === "number" || Array.isArray(o.custom_fields)) {
      const { name, region } = resolveZendeskTicketAssignee(o, buildZendeskUserNameById([]));
      if (name) return { name, region };
    }
    return null;
  }

  const hit = walk(root);
  if (hit) return hit;
  const rich = root.richDocumentData;
  if (rich && typeof rich === "object") {
    const content = /** @type {Record<string, unknown>} */ (rich).content;
    if (typeof content === "string") return extractAssigneeFromGleanZendeskJson(content);
  }
  return { name: null, region: null };
}

/**
 * Force metadata line assignee to match Zendesk ticket owner when known.
 * @param {string} markdown
 * @param {string} assigneeName
 * @param {string | null} [region]
 */
/**
 * @param {{ status?: string; assigneeName?: string | null; assigneeRegion?: string | null; block?: string }} zdBundle
 * @param {string} zendeskLiveBlock
 * @param {{ block?: string }} gleanIdx
 * @returns {{ name: string | null; region: string | null }}
 */
export function resolveAuthoritativeAssigneeForSummary(zdBundle, zendeskLiveBlock, gleanIdx) {
  if (zdBundle?.status === "ok" && zdBundle.assigneeName) {
    return { name: zdBundle.assigneeName, region: zdBundle.assigneeRegion || null };
  }
  const fromApi = parseAssigneeFromZendeskApiBlock(zendeskLiveBlock);
  if (fromApi.name) return fromApi;
  const gleanBlock = gleanIdx?.block;
  if (typeof gleanBlock === "string") {
    const m = gleanBlock.match(/```json\n([\s\S]*?)```/);
    if (m) return extractAssigneeFromGleanZendeskJson(m[1]);
  }
  return { name: null, region: null };
}

export function patchInvestigationSummaryAssignee(markdown, assigneeName, region = null) {
  if (!markdown || !assigneeName) return markdown;
  const regionSuffix = region && region !== "Unknown" ? region : "Unknown";
  const replacement = `**Assignee:** ${assigneeName} (${regionSuffix})`;
  const lineRe = /^(\*\*Tier:\*\*[^\n]*\|\s*\*\*Product Area:\*\*[^\n]*\|\s*)\*\*Assignee:\*\*[^\n]*/m;
  if (lineRe.test(markdown)) {
    return markdown.replace(lineRe, `$1${replacement}`);
  }
  return markdown;
}
