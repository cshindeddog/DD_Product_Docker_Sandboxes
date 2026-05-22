import { gleanGetDocuments, isGleanConfigured } from "@/lib/gleanServer";
import { gleanMcpReadDocument, isGleanMcpConfigured } from "@/lib/gleanMcpClient";
import { readSessionFromRequest } from "@/lib/gleanOAuthSession";

const MAX_DOC_JSON = 88_000;

/**
 * Glean getdocuments / read_document often returns Zendesk with
 * `richDocumentData.content` as a **JSON-encoded string** (e.g. mimeType `application/json`),
 * not a nested object. Parse it so models see `pageBody`, `comments`, `customFields`, `facets`.
 * @param {unknown} doc
 * @returns {unknown}
 */
export function expandGleanZendeskRichContent(doc) {
  if (!doc || typeof doc !== "object") return doc;
  const d = /** @type {Record<string, unknown>} */ (doc);
  const rich = d.richDocumentData;
  if (!rich || typeof rich !== "object") return doc;
  const r = /** @type {Record<string, unknown>} */ (rich);
  const content = r.content;
  if (typeof content !== "string") return doc;
  const trimmed = content.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return doc;
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return doc;
  }
  if (!parsed || typeof parsed !== "object") return doc;
  const { content: _dropped, ...restRich } = r;
  return {
    ...d,
    richDocumentData: {
      ...restRich,
      parsedZendeskTicket: parsed,
      _gleanParsingNote:
        "Original `richDocumentData.content` was a JSON string; conversation and fields are under `parsedZendeskTicket` (e.g. pageBody, comments, customFields, facets).",
    },
  };
}

/**
 * @param {unknown} docOrJsonText
 * @returns {unknown}
 */
function prepareGleanZendeskDocForPromptSerialization(docOrJsonText) {
  let doc = docOrJsonText;
  if (typeof docOrJsonText === "string") {
    try {
      doc = JSON.parse(docOrJsonText.trim());
    } catch {
      return docOrJsonText;
    }
  }
  if (!doc || typeof doc !== "object") return docOrJsonText;
  const unwrapped = unwrapGleanIndexedDocumentShell(doc);
  return expandGleanZendeskRichContent(unwrapped);
}

/**
 * MCP read_document / some clients return the full getdocuments envelope instead of a single doc.
 * @param {unknown} doc
 * @returns {Record<string, unknown>}
 */
function unwrapGleanIndexedDocumentShell(doc) {
  if (!doc || typeof doc !== "object") return /** @type {Record<string, unknown>} */ (doc);
  const d = /** @type {Record<string, unknown>} */ (doc);
  if (Array.isArray(d.documents) && d.documents.length && typeof d.documents[0] === "object") {
    return /** @type {Record<string, unknown>} */ (d.documents[0]);
  }
  const gdr = d.getDocumentsResponse;
  if (gdr && typeof gdr === "object") {
    const docs = /** @type {Record<string, unknown>} */ (gdr).documents;
    if (Array.isArray(docs) && docs.length && typeof docs[0] === "object") {
      return /** @type {Record<string, unknown>} */ (docs[0]);
    }
  }
  if (d.document && typeof d.document === "object") {
    return /** @type {Record<string, unknown>} */ (d.document);
  }
  return d;
}

/**
 * True when the combined ZENDESK prompt block clearly contains an indexed ticket thread
 * (expanded JSON or raw Glean success block), used for threadEvidence when status checks are too narrow.
 * @param {string} combinedBlock
 */
export function gleanIndexedConversationPresentInZendeskBlock(combinedBlock) {
  const z = String(combinedBlock || "");
  if (!z.trim()) return false;
  if (/parsedZendeskTicket/.test(z)) return true;
  if (
    /### Zendesk ticket — \*\*Glean/.test(z) &&
    /"(?:pageBody|comments)"\s*:/.test(z) &&
    z.replace(/\s/g, "").length > 500
  ) {
    return true;
  }
  return false;
}

/**
 * Base URL for Zendesk **agent** ticket pages (no trailing slash, no ticket id).
 * Set either `ZENDESK_SUBDOMAIN` or `ZENDESK_AGENT_TICKET_URL_PREFIX` (e.g. `https://datadog.zendesk.com/agent/tickets`).
 * @returns {string | null}
 */
export function zendeskAgentTicketsBaseFromEnv() {
  const prefix = process.env.ZENDESK_AGENT_TICKET_URL_PREFIX?.trim();
  if (prefix) {
    return prefix.replace(/\/$/, "");
  }
  const sub = process.env.ZENDESK_SUBDOMAIN?.trim();
  if (!sub) return null;
  return `https://${sub}.zendesk.com/agent/tickets`;
}

function mcpDisabled() {
  return ["1", "true", "yes"].includes(String(process.env.GLEAN_MCP_DISABLE || "").trim().toLowerCase());
}

/** @param {string} s */
function sanitizeDiag(s) {
  return String(s || "").replace(/`/g, "'").replace(/\s+/g, " ").trim().slice(0, 520);
}

/**
 * Zendesk **agent** ticket URL (what Glean typically indexes for Support tickets).
 * @param {string} ticketId
 * @returns {string | null}
 */
export function zendeskAgentTicketUrl(ticketId) {
  const base = zendeskAgentTicketsBaseFromEnv();
  const id = String(ticketId ?? "").trim();
  if (!base || !id) return null;
  return `${base}/${id}`;
}

/**
 * Load the indexed Zendesk ticket from Glean (`POST /rest/api/v1/getdocuments` by agent URL) — same document family as MCP `read_document`.
 * @param {string} ticketId
 * @param {Request | null | undefined} request
 * @returns {Promise<{ status: string, block: string, agentUrl: string, refreshedSessionSeal: string | null }>}
 */
export async function fetchGleanZendeskTicketBundleForPrompt(ticketId, request) {
  const agentUrl = zendeskAgentTicketUrl(ticketId) || "";

  if (!isGleanConfigured(request)) {
    return { status: "not_configured", block: "", agentUrl, refreshedSessionSeal: null };
  }

  if (!agentUrl) {
    return {
      status: "no_agent_url",
      agentUrl: "",
      refreshedSessionSeal: null,
      block:
        "**Glean getdocuments / MCP read_document was not called:** set `ZENDESK_SUBDOMAIN` (e.g. `datadog`) or `ZENDESK_AGENT_TICKET_URL_PREFIX` (e.g. `https://datadog.zendesk.com/agent/tickets`) in `pal-portfolio/.env.local` so the app can build the Zendesk **agent** ticket URL that your Glean connector indexes.",
    };
  }

  /**
   * @param {{ ok: boolean, text?: string, toolName?: string, message?: string, refreshedSessionSeal?: string | null }} mcp
   * @returns {{ status: "ok", block: string, agentUrl: string, refreshedSessionSeal: string | null } | null}
   */
  const bundleFromMcp = (mcp) => {
    if (!mcp.ok || !mcp.text) return null;
    let body = mcp.text.trim();
    const prepared = prepareGleanZendeskDocForPromptSerialization(body);
    if (prepared && typeof prepared === "object") {
      try {
        body = JSON.stringify(prepared, null, 2);
      } catch {
        body = mcp.text.trim();
      }
    }
    if (body.length > MAX_DOC_JSON) {
      body = `${body.slice(0, MAX_DOC_JSON)}\n… _(truncated)_`;
    }
    const toolName = typeof mcp.toolName === "string" ? mcp.toolName : "read_document";
    const block = `### Zendesk ticket — **Glean MCP** (remote \`${toolName}\`, Streamable HTTP — same product surface as Cursor Glean MCP)

**Agent URL:** ${agentUrl}

\`\`\`json
${body}
\`\`\``;
    return { status: "ok", agentUrl, block, refreshedSessionSeal: mcp.refreshedSessionSeal || null };
  };

  let mcpFirstDiag = "";
  if (isGleanMcpConfigured() && !mcpDisabled()) {
    const mcp1 = await gleanMcpReadDocument(agentUrl, request);
    const ok1 = bundleFromMcp(mcp1);
    if (ok1) return ok1;
    mcpFirstDiag = mcp1.ok ? "read_document returned empty content" : sanitizeDiag(String(mcp1.message || "MCP error"));
  }

  const res = await gleanGetDocuments([{ url: agentUrl }], request);
  /** @type {string | null} */
  const seal = res.refreshedSessionSeal || null;

  if (!res.ok) {
    const msg = res.message || res.code || "unknown";
    const scopeHint =
      /insufficient_scope|403/i.test(String(msg)) || res.httpStatus === 403
        ? `\n\n**If you see insufficient_scope / 403:** The OAuth token is missing document or MCP tool scopes. Sign **out** of Glean on this site and **sign in again** (tokens are not upgraded in place). This app requests scopes from your tenant’s \`/.well-known/oauth-authorization-server\` (e.g. \`openid offline_access search chat documents tools mcp\` on Datadog Glean), or set \`GLEAN_OAUTH_SCOPES\` explicitly to match \`scopes_supported\`. Wrong **casing** (e.g. uppercase \`SEARCH\`) will not match Glean’s scope names. Your Glean admin may need to allow those scopes on the OAuth client or dynamic-client policy.`
        : "";
    return {
      status: "http_error",
      agentUrl,
      refreshedSessionSeal: seal,
      block: `**Glean getdocuments failed** for \`${agentUrl}\`: ${msg}${scopeHint}`,
    };
  }

  const docs = res.documents;
  if (!Array.isArray(docs) || docs.length === 0) {
    let mcpRetryDiag = "";
    if (isGleanMcpConfigured() && !mcpDisabled()) {
      const mcp2 = await gleanMcpReadDocument(agentUrl, request);
      const ok2 = bundleFromMcp(mcp2);
      if (ok2) return ok2;
      mcpRetryDiag = mcp2.ok ? "retry read_document: empty body" : sanitizeDiag(String(mcp2.message || ""));
    }
    const preview = res.rawResponsePreview || "";
    const http = res.httpStatus ?? "?";
    const oauth = Boolean(request && readSessionFromRequest(request));
    const oauthNote = oauth
      ? "\n\n**SSO / REST vs MCP:** If REST returns HTTP 200 with an empty \"documents\" array while the same ticket opens in Cursor Glean MCP, your **browser OAuth token** may be honored for **Streamable HTTP MCP** but not for **REST getdocuments** on this tenant. Options: set **GLEAN_API_TOKEN** (PAT) for server-side REST, or fix MCP connectivity below. Enable **GLEAN_DEBUG=true** in `.env.local` to log raw getdocuments status + body and MCP steps on the server console."
      : "\n\nTip: set **GLEAN_DEBUG=true** in `.env.local` and restart dev to log Glean REST status, response preview, and MCP read_document on the server console.";

    return {
      status: "empty_documents",
      agentUrl,
      refreshedSessionSeal: seal,
      block: `**Glean getdocuments returned no documents** for \`${agentUrl}\` (**REST** HTTP ${http}). Preview: \`${sanitizeDiag(preview)}\`${oauthNote}

**MCP read_document (before REST):** ${mcpFirstDiag || "(MCP disabled, not configured, or skipped)"}${mcpRetryDiag ? ` **After REST empty:** ${mcpRetryDiag}` : ""}`,
    };
  }

  const first = docs[0];
  const forPrompt = prepareGleanZendeskDocForPromptSerialization(first);
  let serialized = "";
  try {
    serialized = JSON.stringify(forPrompt ?? first, null, 2);
  } catch {
    serialized = String(first);
  }
  if (serialized.length > MAX_DOC_JSON) {
    serialized = `${serialized.slice(0, MAX_DOC_JSON)}\n… _(truncated)_`;
  }

  const block = `### Zendesk ticket — **Glean index** (\`POST /rest/api/v1/getdocuments\`, same document family as MCP \`read_document\`)

**Agent URL:** ${agentUrl}

\`\`\`json
${serialized}
\`\`\``;

  return { status: "ok", agentUrl, block, refreshedSessionSeal: seal };
}

/**
 * Merge Glean-indexed ticket JSON + optional Zendesk Support API block for one Claude section.
 * @param {{ status: string, block: string }} gleanBundle
 * @param {{ status: string, block: string }} apiBundle
 */
export function combineZendeskTicketBlocksForPrompt(gleanBundle, apiBundle) {
  const parts = [];

  /** Live Support API thread first when OK — better for final resolution than possibly stale Glean JSON. */
  if (apiBundle.status === "ok" && apiBundle.block && String(apiBundle.block).trim()) {
    parts.push(
      "**Source order:** The **Zendesk Support API** block below is the primary source for the live thread, latest engineer actions, and resolution steps. Use Glean JSON after it for extra indexed fields only if it does not contradict the API thread.\n\n" +
        apiBundle.block.trim()
    );
  } else if (apiBundle.status === "not_configured") {
    if (apiBundle.block) {
      parts.push(apiBundle.block.trim());
    }
  } else if (apiBundle.block && String(apiBundle.block).trim()) {
    parts.push(apiBundle.block.trim());
  }

  if (gleanBundle.block && String(gleanBundle.block).trim()) {
    parts.push(gleanBundle.block.trim());
  }

  if (parts.length === 0) {
    return "**No Zendesk thread in prompt.** Set **`ZENDESK_SUBDOMAIN`** or **`ZENDESK_AGENT_TICKET_URL_PREFIX`** so Glean can target the indexed agent ticket, and sign in to Glean with document scopes.";
  }

  return parts.join("\n\n---\n\n");
}
