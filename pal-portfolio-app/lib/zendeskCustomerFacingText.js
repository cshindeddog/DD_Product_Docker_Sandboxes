import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import { isZendeskConfigured } from "@/lib/zendeskTicketFetch";

function authHeader() {
  const email = process.env.ZENDESK_EMAIL.trim();
  const token = process.env.ZENDESK_API_TOKEN.trim();
  const b64 = Buffer.from(`${email}/token:${token}`).toString("base64");
  return {
    Authorization: `Basic ${b64}`,
    Accept: "application/json",
  };
}

function baseUrl() {
  return `https://${process.env.ZENDESK_SUBDOMAIN.trim()}.zendesk.com/api/v2`;
}

/** @param {string} html */
function stripHtml(html) {
  if (!html || typeof html !== "string") return "";
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const COMMENT_CAP = 100;

/**
 * Fetch ticket + comments and concatenate **customer-facing** public text
 * (requester + description + public comments by end-user when roles are present;
 * falls back to all public comments if none matched as customer-only).
 *
 * @param {string} ticketId
 * @returns {Promise<{ ok: true; text: string; subject: string } | { ok: false; code: string; message?: string }>}
 */
export async function fetchZendeskCustomerFacingTextForScan(ticketId) {
  const id = String(ticketId || "").trim();
  if (!id) return { ok: false, code: "bad_id" };
  if (!isZendeskConfigured()) {
    return { ok: false, code: "not_configured", message: "Zendesk API not configured." };
  }

  const base = baseUrl();
  const headers = { ...authHeader(), "Content-Type": "application/json" };
  const ticketUrl = `${base}/tickets/${encodeURIComponent(id)}.json?include=users`;
  const commentsUrl = `${base}/tickets/${encodeURIComponent(id)}/comments.json?per_page=${COMMENT_CAP}&sort_order=asc`;

  try {
    const [ticketRes, commentsRes] = await Promise.all([
      fetchWithTimeout(ticketUrl, { method: "GET", headers, cache: "no-store" }, 20_000),
      fetchWithTimeout(commentsUrl, { method: "GET", headers, cache: "no-store" }, 20_000),
    ]);

    if (!ticketRes.ok) {
      const errText = await ticketRes.text();
      return { ok: false, code: "http_error", message: errText.slice(0, 200) };
    }

    const ticketJson = await ticketRes.json();
    const ticket = ticketJson?.ticket;
    if (!ticket || typeof ticket !== "object") {
      return { ok: false, code: "empty", message: "No ticket object." };
    }

    const subject = typeof ticket.subject === "string" ? ticket.subject : "";

    /** @type {Map<number, string>} */
    const roleById = new Map();
    const users = Array.isArray(ticketJson.users) ? ticketJson.users : [];
    for (const u of users) {
      if (u && typeof u.id === "number" && u.role) {
        roleById.set(u.id, String(u.role).toLowerCase());
      }
    }

    const requesterId = typeof ticket.requester_id === "number" ? ticket.requester_id : null;

    let commentsJson = {};
    if (commentsRes.ok) {
      try {
        commentsJson = await commentsRes.json();
      } catch {
        commentsJson = {};
      }
    }
    const comments = Array.isArray(commentsJson.comments) ? commentsJson.comments : [];

    const desc = stripHtml(ticket.description || "");
    /** @type {string[]} */
    const strictParts = [];
    if (desc) strictParts.push(desc);

    for (const c of comments) {
      if (!c || typeof c !== "object") continue;
      if (c.public === false) continue;
      const aid = typeof c.author_id === "number" ? c.author_id : null;
      const role = aid != null ? roleById.get(aid) || "" : "";
      const isCustomer =
        (requesterId != null && aid === requesterId) || role === "end-user" || role === "end user";
      if (!isCustomer) continue;
      const rawBody = typeof c.plain_body === "string" && c.plain_body.trim() ? c.plain_body : c.body || "";
      const body = stripHtml(rawBody).trim();
      if (body) strictParts.push(body);
    }

    /** @type {string[]} */
    let parts = strictParts;
    if (parts.filter(Boolean).length < 2 && desc) {
      /** Fallback: all public comments (still excludes internals). */
      const loose = [desc];
      for (const c of comments) {
        if (!c || typeof c !== "object" || c.public === false) continue;
        const rawBody = typeof c.plain_body === "string" && c.plain_body.trim() ? c.plain_body : c.body || "";
        const body = stripHtml(rawBody).trim();
        if (body) loose.push(body);
      }
      parts = [...new Set(loose)];
    }

    const text = parts.filter(Boolean).join("\n\n").trim();
    return { ok: true, text, subject };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, code: "exception", message: msg };
  }
}
