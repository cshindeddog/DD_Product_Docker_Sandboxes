import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import { gleanRestApiBaseUrl } from "@/lib/gleanBackendUrl";
import { resolvePalTicketFields } from "@/lib/palExportRow";
import { readSessionFromRequest, resolveGleanOAuthAccessToken } from "@/lib/gleanOAuthSession";

function gleanDebugEnabled() {
  return ["1", "true", "yes"].includes(String(process.env.GLEAN_DEBUG || "").trim().toLowerCase());
}

/**
 * @param {unknown[]} parts
 */
export function gleanDebug(...parts) {
  if (gleanDebugEnabled()) console.error("[glean]", ...parts);
}

/**
 * Parse Glean Chat API JSON into plain text + citation list.
 * Tolerates minor response shape differences across API versions.
 * @param {unknown} json
 * @returns {{ text: string, citations: { title: string, url: string, snippet: string }[] }}
 */
export function parseGleanChatResponse(json) {
  if (!json || typeof json !== "object") {
    return { text: "", citations: [] };
  }

  const textParts = [];
  const citations = [];

  /**
   * @param {unknown} fragments
   */
  function walkFragments(fragments) {
    if (!Array.isArray(fragments)) return;
    for (const f of fragments) {
      if (!f || typeof f !== "object") continue;
      if (typeof f.text === "string" && f.text.length) textParts.push(f.text);
      const sd = f.citation?.sourceDocument;
      if (sd && typeof sd === "object") {
        citations.push({
          title: typeof sd.title === "string" ? sd.title : "Source",
          url: typeof sd.url === "string" ? sd.url : "",
          snippet: typeof sd.snippet === "string" ? sd.snippet : "",
        });
      }
      if (Array.isArray(f.fragments)) walkFragments(f.fragments);
    }
  }

  /**
   * @param {unknown} content
   */
  function walkContentBlocks(content) {
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      if (typeof block.text === "string" && block.text.length) textParts.push(block.text);
    }
  }

  const messages = /** @type {any[]} */ (json).messages;
  if (!Array.isArray(messages)) {
    return { text: "", citations: [] };
  }

  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const author = String(msg.author || "").toUpperCase();
    if (author === "USER" || author === "SYSTEM") continue;
    walkFragments(msg.fragments);
    walkContentBlocks(msg.content);
  }

  const seen = new Set();
  const deduped = [];
  for (const c of citations) {
    const key = c.url || c.title;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(c);
  }

  return {
    text: textParts.join("\n\n").trim(),
    citations: deduped,
  };
}

/**
 * Keep only the summary: from the first real heading onward (strips preamble).
 * Prefers `## Investigation Summary — Ticket #…`; then `### Customer issue` (legacy); then `### Ticket #<id> — Summary`.
 * @param {string} raw
 * @param {string} ticketId
 */
export function extractBriefingFromModelReply(raw, ticketId) {
  if (!raw || typeof raw !== "string") return "";
  const t = raw.trim();
  const tid = String(ticketId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const investigation = /#{1,2}\s*Investigation\s+Summary\s*—\s*Ticket\b/i;
  const customerIssue = /#{1,6}\s*Customer\s+issue\b/i;
  const legacySummary = new RegExp(`#{1,6}\\s*Ticket\\s*#${tid}\\s*[—\\-]\\s*Summary`, "i");
  const iInv = t.search(investigation);
  if (iInv !== -1) {
    const sliced = t.slice(iInv).trim();
    return sliced || t;
  }
  const iNew = t.search(customerIssue);
  if (iNew !== -1) {
    const sliced = t.slice(iNew).trim();
    return sliced || t;
  }
  const iLegacy = t.search(legacySummary);
  if (iLegacy !== -1) {
    const sliced = t.slice(iLegacy).trim();
    return sliced || t;
  }
  return t;
}

/**
 * @param {Request | null | undefined} [request]
 */
export function isGleanConfigured(request) {
  const base = gleanRestApiBaseUrl();
  if (!base) return false;
  if (process.env.GLEAN_API_TOKEN?.trim()) return true;
  if (request && readSessionFromRequest(request)) return true;
  return false;
}

/**
 * @param {string} code
 */
export function gleanAuthErrorMessage(code) {
  if (code === "missing_instance") {
    return "GLEAN_INSTANCE_URL is missing or not a recognized Glean host (expected tenant backend `*-be.glean.com` or app URL we can map).";
  }
  if (code === "oauth_session_invalid") {
    return "Glean SSO session expired or was revoked — use Sign in with Glean again.";
  }
  if (code === "no_auth") {
    return "No Glean credentials: set GLEAN_API_TOKEN for a service token, or sign in with Glean (SSO) on this site.";
  }
  return "Glean authentication failed.";
}

/**
 * Resolve REST API auth: SSO session cookie first (if present), else `GLEAN_API_TOKEN`.
 * @param {Request | null | undefined} request
 * @returns {Promise<{ ok: true, headers: Record<string, string>, refreshedSessionSeal: string | null } | { ok: false, code: string, headers: null, refreshedSessionSeal: null }>}
 */
export async function getGleanRestAuth(request) {
  const base = gleanRestApiBaseUrl();
  if (!base) {
    return { ok: false, code: "missing_instance", headers: null, refreshedSessionSeal: null };
  }

  if (request && readSessionFromRequest(request)) {
    const oauthTok = await resolveGleanOAuthAccessToken(request);
    if (oauthTok?.accessToken) {
      return {
        ok: true,
        headers: {
          Authorization: `Bearer ${oauthTok.accessToken}`,
          "Content-Type": "application/json",
          "X-Glean-Auth-Type": "OAUTH",
        },
        refreshedSessionSeal: oauthTok.newSessionSeal || null,
      };
    }
    return { ok: false, code: "oauth_session_invalid", headers: null, refreshedSessionSeal: null };
  }

  const envToken = process.env.GLEAN_API_TOKEN?.trim();
  if (envToken) {
    return { ok: true, headers: gleanAuthHeaders(), refreshedSessionSeal: null };
  }

  return { ok: false, code: "no_auth", headers: null, refreshedSessionSeal: null };
}

/**
 * @returns {Record<string, string>}
 */
export function gleanAuthHeaders() {
  const token = process.env.GLEAN_API_TOKEN?.trim();
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const authType = (process.env.GLEAN_AUTH_TYPE || "").toUpperCase();
  if (authType === "OAUTH") {
    headers["X-Glean-Auth-Type"] = "OAUTH";
  }
  const actAs = process.env.GLEAN_ACT_AS_EMAIL?.trim();
  if (authType === "GLOBAL" || actAs) {
    if (actAs) headers["X-Glean-ActAs"] = actAs;
  }
  return headers;
}

/**
 * Normalize one Glean Search API result object (handles `snippets[]`, nested `document`, `fullText`).
 * @param {Record<string, unknown>} item
 * @returns {{ title: string, url: string, snippet: string, datasource: string, id: string } | null}
 */
export function normalizeGleanSearchItem(item) {
  if (!item || typeof item !== "object") return null;
  const doc = item.document && typeof item.document === "object" ? /** @type {Record<string, unknown>} */ (item.document) : null;
  const url =
    (typeof item.url === "string" && item.url.trim()) ||
    (doc && typeof doc.url === "string" && doc.url.trim()) ||
    "";
  const title =
    (typeof item.title === "string" && item.title.trim()) ||
    (doc && typeof doc.title === "string" && doc.title.trim()) ||
    "Result";
  let snippet = typeof item.snippet === "string" ? item.snippet : "";
  if (!snippet && Array.isArray(item.snippets)) {
    snippet = item.snippets
      .map((s) => (s && typeof s === "object" && typeof s.snippet === "string" ? s.snippet : ""))
      .filter(Boolean)
      .join("\n---\n");
  }
  if (!snippet && typeof item.fullText === "string" && item.fullText.trim()) {
    snippet = item.fullText.trim().slice(0, 4000);
  }
  const datasource =
    (typeof item.datasource === "string" && item.datasource) ||
    (doc && typeof doc.datasource === "string" && doc.datasource) ||
    "";
  const idRaw = item.id ?? (doc && doc.id);
  const id =
    typeof idRaw === "string"
      ? idRaw
      : typeof idRaw === "number"
        ? String(idRaw)
        : "";
  const key = url || id || title;
  if (!key) return null;
  return { title, url, snippet, datasource, id };
}

/**
 * @param {string} query
 * @param {number} [pageSize]
 * @param {{ request?: Request | null, headers?: Record<string, string> | null }} [opts]
 */
export async function gleanSearchQuery(query, pageSize = 18, opts = {}) {
  const base = gleanRestApiBaseUrl()?.replace(/\/$/, "");
  if (!base) {
    return { ok: false, code: "missing_config", message: gleanAuthErrorMessage("missing_instance"), results: [] };
  }

  const { request, headers: precomputed } = opts;
  let headers = precomputed;
  /** @type {string | null} */
  let refreshedSessionSeal = null;
  if (!headers) {
    const auth = await getGleanRestAuth(request ?? null);
    if (!auth.ok) {
      return {
        ok: false,
        code: auth.code,
        message: gleanAuthErrorMessage(auth.code),
        results: [],
        refreshedSessionSeal: null,
      };
    }
    headers = auth.headers;
    refreshedSessionSeal = auth.refreshedSessionSeal || null;
  }

  const url = `${base}/rest/api/v1/search`;
  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: String(query || "").slice(0, 2000),
          pageSize,
        }),
        cache: "no-store",
      },
      15_000
    );
    const raw = await res.text();
    let json = {};
    try {
      json = raw ? JSON.parse(raw) : {};
    } catch {
      return { ok: false, code: "invalid_json", message: raw.slice(0, 400), results: [], refreshedSessionSeal };
    }
    if (!res.ok) {
      const msg =
        (typeof json === "object" && json && (json.message || json.error)) || raw.slice(0, 400) || res.statusText;
      return { ok: false, code: "glean_http", message: String(msg), results: [], refreshedSessionSeal };
    }
    const results = Array.isArray(json.results) ? json.results : [];
    return { ok: true, results, refreshedSessionSeal };
  } catch (e) {
    return {
      ok: false,
      code: "network",
      message: e instanceof Error ? e.message : String(e),
      results: [],
      refreshedSessionSeal,
    };
  }
}

/**
 * @param {string} ticketId
 * @param {Record<string, string>[]} rows
 * @param {Request | null | undefined} [request]
 * @returns {Promise<{ hits: { title: string, url: string, snippet: string, datasource: string }[], errors: string[], refreshedSessionSeal: string | null }>}
 */
export async function gleanSearchForTicket(ticketId, rows, request) {
  /** @type {{ title: string, url: string, snippet: string, datasource: string }[]} */
  const merged = [];
  /** @type {string[]} */
  const errors = [];

  const r0 = rows?.[0];
  if (!r0) return { hits: merged, errors, refreshedSessionSeal: null };

  const f = resolvePalTicketFields(r0);
  const subject = (f.ticketSubject || "").slice(0, 320);
  const account = (f.salesforceAccountName || "").slice(0, 140);
  const org = (f.zendeskOrgName || "").slice(0, 140);

  const queries = [
    `Zendesk ${ticketId}`,
    [String(ticketId), subject].filter(Boolean).join(" ").trim().slice(0, 520),
  ];
  if (account) queries.push(`${account} ${ticketId}`.trim().slice(0, 520));
  if (org && org !== account) queries.push(`${org} ${ticketId}`.trim().slice(0, 520));

  const seen = new Set();

  const uniqueQueries = [...new Set(queries.map((q) => q.trim()).filter(Boolean))];

  const auth = await getGleanRestAuth(request ?? null);
  if (!auth.ok) {
    errors.push(gleanAuthErrorMessage(auth.code));
    return { hits: merged, errors, refreshedSessionSeal: null };
  }

  /** @type {string | null} */
  let refreshedSessionSeal = auth.refreshedSessionSeal || null;
  const searchRuns = await Promise.all(
    uniqueQueries.map((q) => gleanSearchQuery(q, 16, { headers: auth.headers }))
  );

  for (const r of searchRuns) {
    if (r.refreshedSessionSeal) refreshedSessionSeal = r.refreshedSessionSeal;
  }

  for (let i = 0; i < searchRuns.length; i++) {
    const r = searchRuns[i];
    const qLabel = uniqueQueries[i]?.slice(0, 100) || "query";
    if (!r.ok) {
      if (r.message) errors.push(`${qLabel}: ${r.message}`);
      else if (r.code) errors.push(`${qLabel}: ${r.code}`);
      continue;
    }
    for (const item of r.results) {
      const norm = normalizeGleanSearchItem(/** @type {Record<string, unknown>} */ (item));
      if (!norm) continue;
      const key = norm.url || norm.id || norm.title;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push({
        title: norm.title,
        url: norm.url,
        snippet: norm.snippet,
        datasource: norm.datasource,
      });
      if (merged.length >= 36) return { hits: merged, errors, refreshedSessionSeal };
    }
  }
  return { hits: merged, errors, refreshedSessionSeal };
}

/**
 * @param {unknown} json
 * @returns {unknown[]}
 */
export function gleanPickDocumentsFromGetDocumentsResponse(json) {
  if (!json || typeof json !== "object") return [];
  const j = /** @type {Record<string, unknown>} */ (json);
  if (Array.isArray(j.documents)) return /** @type {unknown[]} */ (j.documents);
  const gdr = j.getDocumentsResponse;
  if (gdr && typeof gdr === "object") {
    const d = /** @type {Record<string, unknown>} */ (gdr).documents;
    if (Array.isArray(d)) return d;
  }
  return [];
}

/**
 * POST /rest/api/v1/getdocuments — indexed documents by URL or id (same backing store as MCP `read_document`).
 * @param {{ url?: string, id?: string }[]} documentSpecs
 * @param {Request | null | undefined} request
 * @returns {Promise<{ ok: true, documents: unknown[], refreshedSessionSeal: string | null, httpStatus: number, rawResponsePreview: string } | { ok: false, code: string, message: string, documents: unknown[], refreshedSessionSeal: string | null, httpStatus?: number }>}
 */
export async function gleanGetDocuments(documentSpecs, request) {
  const base = gleanRestApiBaseUrl()?.replace(/\/$/, "");
  if (!base) {
    return {
      ok: false,
      code: "missing_instance",
      message: gleanAuthErrorMessage("missing_instance"),
      documents: [],
      refreshedSessionSeal: null,
    };
  }

  const specs = Array.isArray(documentSpecs)
    ? documentSpecs.filter(
        (s) => s && typeof s === "object" && (typeof s.url === "string" || typeof s.id === "string")
      )
    : [];
  if (!specs.length) {
    return { ok: false, code: "no_specs", message: "No document specs", documents: [], refreshedSessionSeal: null };
  }

  const auth = await getGleanRestAuth(request ?? null);
  if (!auth.ok) {
    return {
      ok: false,
      code: auth.code,
      message: gleanAuthErrorMessage(auth.code),
      documents: [],
      refreshedSessionSeal: null,
    };
  }

  const url = `${base}/rest/api/v1/getdocuments`;
  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: auth.headers,
        body: JSON.stringify({ documentSpecs: specs.slice(0, 8) }),
        cache: "no-store",
      },
      60_000
    );
    const raw = await res.text();
    let json = {};
    try {
      json = raw ? JSON.parse(raw) : {};
    } catch {
      return {
        ok: false,
        code: "invalid_json",
        message: raw.slice(0, 400),
        documents: [],
        refreshedSessionSeal: auth.refreshedSessionSeal || null,
      };
    }
    if (!res.ok) {
      gleanDebug("getdocuments failed", res.status, raw.slice(0, 600));
      const msg =
        (typeof json === "object" && json && (json.message || json.error || json.detail)) ||
        raw.slice(0, 500) ||
        res.statusText;
      return {
        ok: false,
        code: "glean_http",
        message: String(msg),
        documents: [],
        refreshedSessionSeal: auth.refreshedSessionSeal || null,
        httpStatus: res.status,
      };
    }
    const documents = gleanPickDocumentsFromGetDocumentsResponse(json);
    const rawResponsePreview = raw.replace(/\s+/g, " ").trim().slice(0, 720);
    gleanDebug("getdocuments HTTP", res.status, "doc count:", documents.length, "preview:", rawResponsePreview.slice(0, 280));
    return {
      ok: true,
      documents,
      refreshedSessionSeal: auth.refreshedSessionSeal || null,
      httpStatus: res.status,
      rawResponsePreview,
    };
  } catch (e) {
    return {
      ok: false,
      code: "network",
      message: e instanceof Error ? e.message : String(e),
      documents: [],
      refreshedSessionSeal: null,
    };
  }
}

/**
 * POST /rest/api/v1/chat — grounded analysis for a ticket (fallback when Anthropic is not configured).
 * @param {string} userMessage
 * @param {string} ticketId used to trim echoed content from the model reply
 * @param {Request | null | undefined} [request]
 * @returns {Promise<{ ok: true, text: string, citations: object[], chatId?: string, refreshedSessionSeal?: string | null } | { ok: false, code: string, message: string, status?: number, refreshedSessionSeal?: string | null }>}
 */
export async function gleanChatTicketAnalysis(userMessage, ticketId, request) {
  const base = gleanRestApiBaseUrl()?.replace(/\/$/, "");
  if (!base) {
    return {
      ok: false,
      code: "missing_config",
      message: gleanAuthErrorMessage("missing_instance"),
    };
  }

  const auth = await getGleanRestAuth(request ?? null);
  if (!auth.ok) {
    return {
      ok: false,
      code: "missing_config",
      message: gleanAuthErrorMessage(auth.code),
    };
  }

  const url = `${base}/rest/api/v1/chat`;
  const body = JSON.stringify({
    messages: [
      {
        author: "USER",
        fragments: [{ text: userMessage }],
      },
    ],
  });

  let res;
  try {
    res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: auth.headers,
        body,
        cache: "no-store",
      },
      120_000
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, code: "network", message: msg, refreshedSessionSeal: auth.refreshedSessionSeal };
  }

  const raw = await res.text();
  let json;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    return {
      ok: false,
      code: "invalid_json",
      message: raw.slice(0, 800),
      status: res.status,
      refreshedSessionSeal: auth.refreshedSessionSeal,
    };
  }

  if (!res.ok) {
    const msg =
      (typeof json === "object" && json && (json.message || json.error || json.detail)) ||
      raw.slice(0, 800) ||
      res.statusText;
    return {
      ok: false,
      code: "glean_http",
      message: String(msg),
      status: res.status,
      refreshedSessionSeal: auth.refreshedSessionSeal,
    };
  }

  const { text: rawText, citations } = parseGleanChatResponse(json);
  let text = extractBriefingFromModelReply(rawText, ticketId).trim();
  if (!text) text = String(rawText || "").trim();
  const chatId = typeof json.chatId === "string" ? json.chatId : undefined;
  return {
    ok: true,
    text,
    citations,
    chatId,
    refreshedSessionSeal: auth.refreshedSessionSeal || null,
  };
}
