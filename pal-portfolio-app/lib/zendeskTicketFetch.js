import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import {
  buildZendeskUserNameById,
  resolveZendeskTicketAssignee,
} from "@/lib/zendeskAssignee";

export function isZendeskConfigured() {
  return Boolean(
    process.env.ZENDESK_SUBDOMAIN?.trim() &&
      process.env.ZENDESK_EMAIL?.trim() &&
      process.env.ZENDESK_API_TOKEN?.trim()
  );
}

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

const MAX_BLOCK_CHARS = 95_000;
/** Zendesk max per_page is 100; order matters for long threads — see comments URL sort_order. */
const COMMENT_CAP = 100;

/**
 * Pull live ticket + comments for Claude (no Glean required).
 * @param {string} ticketId
 * @returns {Promise<{ status: "not_configured" | "ok" | "http_error" | "empty", block: string, agentUrl: string, assigneeName?: string | null, assigneeRegion?: string | null }>}
 */
export async function fetchZendeskTicketBundleForPrompt(ticketId) {
  const id = String(ticketId || "").trim();
  const agentBase = process.env.ZENDESK_SUBDOMAIN?.trim()
    ? `https://${process.env.ZENDESK_SUBDOMAIN.trim()}.zendesk.com/agent/tickets`
    : "";

  if (!isZendeskConfigured()) {
    return {
      status: "not_configured",
      agentUrl: agentBase ? `${agentBase}/${id}` : "",
      block: `**Zendesk Support API was not used** (no \`ZENDESK_EMAIL\` + \`ZENDESK_API_TOKEN\` — optional). Conversation text can come from **Glean** indexed ticket content when \`getdocuments\` / MCP succeeds. For the agent URL Glean uses, set \`ZENDESK_SUBDOMAIN\` or \`ZENDESK_AGENT_TICKET_URL_PREFIX\` — no Zendesk API token required for that.`,
    };
  }

  const base = baseUrl();
  const headers = { ...authHeader(), "Content-Type": "application/json" };
  const ticketUrl = `${base}/tickets/${encodeURIComponent(id)}.json?include=users`;
  /** Newest first so the model sees recent engineer resolution even when there are many comments. */
  const commentsUrl = `${base}/tickets/${encodeURIComponent(
    id
  )}/comments.json?per_page=${COMMENT_CAP}&sort_order=desc`;

  try {
    const [ticketRes, commentsRes] = await Promise.all([
      fetchWithTimeout(ticketUrl, { method: "GET", headers, cache: "no-store" }, 20_000),
      fetchWithTimeout(commentsUrl, { method: "GET", headers, cache: "no-store" }, 20_000),
    ]);

    if (!ticketRes.ok) {
      const errText = await ticketRes.text();
      let msg = errText.slice(0, 400);
      try {
        const j = JSON.parse(errText);
        msg = String(j.error || j.description || j.message || msg);
      } catch {
        /* keep slice */
      }
      return {
        status: "http_error",
        agentUrl: `${agentBase}/${id}`,
        block: `**Zendesk API error** (\`GET /tickets/${id}.json\`): HTTP ${ticketRes.status} — ${msg}. Fix credentials or confirm this agent can see the ticket.`,
      };
    }

    const ticketJson = await ticketRes.json();
    const ticket = ticketJson?.ticket;
    if (!ticket || typeof ticket !== "object") {
      return {
        status: "empty",
        agentUrl: `${agentBase}/${id}`,
        block: "**Zendesk API returned no ticket object.**",
      };
    }

    const users = Array.isArray(ticketJson.users) ? ticketJson.users : [];
    const userNameById = buildZendeskUserNameById(users);
    const { name: assigneeName, region: assigneeRegion } = resolveZendeskTicketAssignee(ticket, userNameById);

    let commentsJson = {};
    if (commentsRes.ok) {
      try {
        commentsJson = await commentsRes.json();
      } catch {
        commentsJson = {};
      }
    }
    const comments = Array.isArray(commentsJson.comments) ? commentsJson.comments : [];

    const lines = [];
    lines.push(`**Ticket URL (agent):** ${agentBase}/${id}`);
    lines.push("");
    lines.push("### Ticket fields (Zendesk API)");
    lines.push(`- **Subject:** ${ticket.subject || "—"}`);
    lines.push(`- **Status:** ${ticket.status || "—"} | **Priority:** ${ticket.priority || "—"} | **Type:** ${ticket.type || "—"}`);
    lines.push(`- **Created:** ${ticket.created_at || "—"} | **Updated:** ${ticket.updated_at || "—"}`);
    const assigneeLabel =
      assigneeName ||
      (typeof ticket.assignee_id === "number" ? `user #${ticket.assignee_id} (name not in sideload)` : "Unassigned");
    lines.push(`- **Assignee (Zendesk — current ticket owner):** ${assigneeLabel}`);
    if (assigneeRegion) {
      lines.push(`- **Assignee region (custom field):** ${assigneeRegion}`);
    }
    lines.push(
      "- **Do not confuse with:** PAL liaison (portfolio CSV), comment authors, or requester — only this assignee belongs in summary metadata."
    );
    if (Array.isArray(ticket.tags) && ticket.tags.length) {
      lines.push(`- **Tags:** ${ticket.tags.join(", ")}`);
    }
    const desc = stripHtml(ticket.description || "");
    if (desc) {
      lines.push("");
      lines.push("### Description (plain text)");
      lines.push(desc.slice(0, 20_000));
    }

    lines.push("");
    lines.push(
      `### Comments (up to ${COMMENT_CAP}, **newest first** — comment 1 is the latest; best source for final engineer resolution)`
    );
    if (!comments.length) {
      lines.push("_No comments returned (new ticket, permissions, or first page empty)._");
    } else {
      for (let i = 0; i < comments.length; i++) {
        const c = comments[i];
        if (!c || typeof c !== "object") continue;
        const authorId = typeof c.author_id === "number" ? c.author_id : null;
        const who = authorId != null ? userNameById[authorId] || `user #${authorId}` : "unknown author";
        const vis = c.public === false ? " **[internal]**" : "";
        const when = c.created_at || "";
        const rawBody = typeof c.plain_body === "string" && c.plain_body.trim() ? c.plain_body : c.body || "";
        const body = stripHtml(rawBody).slice(0, 12_000);
        lines.push("");
        lines.push(`#### Comment ${i + 1} (newest-first rank) — ${who} @ ${when}${vis}`);
        lines.push(body || "_empty body_");
      }
    }

    let block = lines.join("\n");
    if (block.length > MAX_BLOCK_CHARS) {
      block = `${block.slice(0, MAX_BLOCK_CHARS)}\n\n… _(truncated for model context)_`;
    }

    return {
      status: "ok",
      agentUrl: `${agentBase}/${id}`,
      block,
      assigneeName: assigneeName || null,
      assigneeRegion: assigneeRegion || null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      status: "http_error",
      agentUrl: `${agentBase}/${id}`,
      block: `**Zendesk fetch failed (network/timeout):** ${msg}`,
    };
  }
}

/**
 * Single-ticket JSON (no comments) — for lightweight parsing such as linked Jira keys.
 * @param {string} ticketId
 * @returns {Promise<{ ok: true, ticket: Record<string, unknown> } | { ok: false, code: "not_configured" | "http_error" | "empty", message?: string, status?: number }>}
 */
export async function fetchZendeskTicketJsonBrief(ticketId) {
  const id = String(ticketId || "").trim();
  if (!id) {
    return { ok: false, code: "empty", message: "Missing ticket id" };
  }
  if (!isZendeskConfigured()) {
    return { ok: false, code: "not_configured" };
  }
  const base = baseUrl();
  const headers = { ...authHeader(), "Content-Type": "application/json" };
  const ticketUrl = `${base}/tickets/${encodeURIComponent(id)}.json`;
  try {
    const ticketRes = await fetchWithTimeout(ticketUrl, { method: "GET", headers, cache: "no-store" }, 20_000);
    if (!ticketRes.ok) {
      const errText = await ticketRes.text();
      let msg = errText.slice(0, 400);
      try {
        const j = JSON.parse(errText);
        msg = String(j.error || j.description || j.message || msg);
      } catch {
        /* keep slice */
      }
      return { ok: false, code: "http_error", status: ticketRes.status, message: msg };
    }
    const ticketJson = await ticketRes.json();
    const ticket = ticketJson?.ticket;
    if (!ticket || typeof ticket !== "object") {
      return { ok: false, code: "empty", message: "No ticket object" };
    }
    return { ok: true, ticket };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, code: "http_error", message: msg };
  }
}
