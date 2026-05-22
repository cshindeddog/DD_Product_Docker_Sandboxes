import { isGleanMcpConfigured, gleanMcpReadDocument } from "@/lib/gleanMcpClient";
import { gleanGetDocuments, gleanSearchQuery, isGleanConfigured, normalizeGleanSearchItem } from "@/lib/gleanServer";
import { jiraKeyToBrowseUrl } from "@/lib/palPortfolioFrJira";

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
 * @param {unknown} node
 * @param {number} depth
 * @returns {{ summary: string; status: string; assignee: string; issueType: string }}
 */
function walkForJiraFields(node, depth = 0) {
  /** @type {{ summary: string; status: string; assignee: string; issueType: string }} */
  const out = { summary: "", status: "", assignee: "", issueType: "" };
  if (depth > 14 || node == null) return out;

  if (typeof node === "object" && !Array.isArray(node)) {
    const o = /** @type {Record<string, unknown>} */ (node);
    const fields = o.fields && typeof o.fields === "object" ? /** @type {Record<string, unknown>} */ (o.fields) : o;

    out.summary = pickStr(
      out.summary,
      fields.summary,
      o.summary,
      fields.title,
      o.title,
      typeof o.name === "string" ? o.name : ""
    );

    const st = fields.status ?? o.status;
    if (st && typeof st === "object") {
      out.status = pickStr(out.status, /** @type {{ name?: string }} */ (st).name, /** @type {{ value?: string }} */ (st).value);
    } else {
      out.status = pickStr(out.status, st, fields.status_name, o.status_name, fields.statusName);
    }

    const asg = fields.assignee ?? o.assignee;
    if (asg && typeof asg === "object") {
      const a = /** @type {{ displayName?: string; name?: string; emailAddress?: string }} */ (asg);
      out.assignee = pickStr(out.assignee, a.displayName, a.name, a.emailAddress);
    } else {
      out.assignee = pickStr(out.assignee, asg, fields.assignee_name, o.assignee_name);
    }

    const it = fields.issuetype ?? fields.issueType ?? o.issuetype ?? o.issueType;
    if (it && typeof it === "object") {
      out.issueType = pickStr(out.issueType, /** @type {{ name?: string }} */ (it).name);
    } else {
      out.issueType = pickStr(out.issueType, it);
    }

    if (out.summary && out.status && out.assignee) return out;

    for (const v of Object.values(o)) {
      if (v && typeof v === "object") {
        const nested = walkForJiraFields(v, depth + 1);
        out.summary = pickStr(out.summary, nested.summary);
        out.status = pickStr(out.status, nested.status);
        out.assignee = pickStr(out.assignee, nested.assignee);
        out.issueType = pickStr(out.issueType, nested.issueType);
        if (out.summary && out.status && out.assignee) return out;
      }
    }
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      const nested = walkForJiraFields(item, depth + 1);
      out.summary = pickStr(out.summary, nested.summary);
      out.status = pickStr(out.status, nested.status);
      out.assignee = pickStr(out.assignee, nested.assignee);
      out.issueType = pickStr(out.issueType, nested.issueType);
    }
  }

  return out;
}

/**
 * @param {string} title
 * @param {string} issueKey
 */
function summaryFromTitle(title, issueKey) {
  const t = String(title || "").trim();
  const k = String(issueKey || "").trim().toUpperCase();
  if (!t) return "";
  const prefix = new RegExp(`^${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:\\-–—]\\s*`, "i");
  const stripped = t.replace(prefix, "").trim();
  return stripped || t;
}

/**
 * @param {unknown} doc
 * @param {string} issueKey
 */
export function extractJiraIssueFromGleanDocument(doc, issueKey) {
  const key = String(issueKey || "").trim().toUpperCase();
  const url = jiraKeyToBrowseUrl(key);
  if (!url) return null;

  let title = "";
  if (doc && typeof doc === "object") {
    const d = /** @type {Record<string, unknown>} */ (doc);
    title = pickStr(d.title, d.name);
    const walked = walkForJiraFields(d);
    const summary = pickStr(walked.summary, summaryFromTitle(title, key));
    return {
      key,
      url,
      summary: summary || null,
      status: walked.status || null,
      assignee: walked.assignee || null,
      issueType: walked.issueType || null,
    };
  }

  if (typeof doc === "string" && doc.trim()) {
    try {
      return extractJiraIssueFromGleanDocument(JSON.parse(doc), issueKey);
    } catch {
      const walked = walkForJiraFields(doc);
      return {
        key,
        url,
        summary: walked.summary || summaryFromTitle(doc.slice(0, 200), key) || null,
        status: walked.status || null,
        assignee: walked.assignee || null,
        issueType: walked.issueType || null,
      };
    }
  }

  return { key, url, summary: summaryFromTitle(title, key) || null, status: null, assignee: null, issueType: null };
}

/**
 * @param {string} issueKey
 * @param {Request | null | undefined} request
 */
async function fetchOneGleanJiraIssue(issueKey, request) {
  const key = String(issueKey || "").trim().toUpperCase();
  const url = jiraKeyToBrowseUrl(key);
  if (!url) return null;

  const base = { key, url, summary: null, status: null, assignee: null, issueType: null };

  if (!isGleanConfigured(request)) return base;

  const docs = await gleanGetDocuments([{ url }], request);
  if (docs.ok && Array.isArray(docs.documents) && docs.documents[0]) {
    const parsed = extractJiraIssueFromGleanDocument(docs.documents[0], key);
    if (parsed && (parsed.summary || parsed.status || parsed.assignee)) return parsed;
  }

  if (isGleanMcpConfigured()) {
    const mcp = await gleanMcpReadDocument(url, request);
    if (mcp.ok && mcp.text?.trim()) {
      try {
        const parsed = extractJiraIssueFromGleanDocument(JSON.parse(mcp.text.trim()), key);
        if (parsed && (parsed.summary || parsed.status || parsed.assignee)) return parsed;
      } catch {
        const parsed = extractJiraIssueFromGleanDocument(mcp.text, key);
        if (parsed && (parsed.summary || parsed.status || parsed.assignee)) return parsed;
      }
    }
  }

  const search = await gleanSearchQuery(`"${key}"`, 10, { request });
  if (search.ok && Array.isArray(search.results)) {
    for (const hit of search.results) {
      const norm = normalizeGleanSearchItem(/** @type {Record<string, unknown>} */ (hit));
      if (!norm?.url || !norm.url.toLowerCase().includes(`/browse/${key.toLowerCase()}`)) continue;
      const walked = walkForJiraFields(hit);
      return {
        key,
        url,
        summary: pickStr(walked.summary, summaryFromTitle(norm.title, key), norm.snippet?.slice(0, 240)) || null,
        status: walked.status || null,
        assignee: walked.assignee || null,
        issueType: walked.issueType || null,
      };
    }
  }

  return base;
}

const GETDOCUMENTS_CHUNK = 8;

/**
 * Jira issue metadata from Glean index (REST getdocuments + MCP read_document + search). No Atlassian API token.
 * @param {string[]} issueKeys
 * @param {Request | null | undefined} request
 */
export async function fetchGleanJiraIssues(issueKeys, request) {
  const configured = isGleanConfigured(request);
  const keys = [...new Set(issueKeys.map((k) => String(k).trim().toUpperCase()).filter((k) => jiraKeyToBrowseUrl(k)))];
  /** @type {Record<string, NonNullable<Awaited<ReturnType<typeof fetchOneGleanJiraIssue>>>>} */
  const issues = {};
  /** @type {string | null} */
  let refreshedSessionSeal = null;

  if (!configured) {
    for (const k of keys) {
      const url = jiraKeyToBrowseUrl(k);
      issues[k] = url
        ? { key: k, url, summary: null, status: null, assignee: null, issueType: null }
        : /** @type {never} */ (null);
    }
    return {
      configured: false,
      issues,
      refreshedSessionSeal: null,
      hint: "Sign in to Glean on this page to load Jira summary/status from the company index (same as ticket status reconciliation).",
    };
  }

  for (const k of keys) {
    const url = jiraKeyToBrowseUrl(k);
    if (url) issues[k] = { key: k, url, summary: null, status: null, assignee: null, issueType: null };
  }

  for (let i = 0; i < keys.length; i += GETDOCUMENTS_CHUNK) {
    const chunk = keys.slice(i, i + GETDOCUMENTS_CHUNK);
    const specs = chunk
      .map((k) => ({ key: k, url: jiraKeyToBrowseUrl(k) }))
      .filter((s) => s.url);
    if (!specs.length) continue;

    const res = await gleanGetDocuments(
      specs.map((s) => ({ url: s.url })),
      request
    );
    if (res.refreshedSessionSeal) refreshedSessionSeal = res.refreshedSessionSeal;
    if (!res.ok || !Array.isArray(res.documents)) continue;

    for (let d = 0; d < res.documents.length; d++) {
      const key = specs[d]?.key;
      if (!key) continue;
      const parsed = extractJiraIssueFromGleanDocument(res.documents[d], key);
      if (parsed && (parsed.summary || parsed.status || parsed.assignee)) issues[key] = parsed;
    }
  }

  const missing = keys.filter((k) => {
    const cur = issues[k];
    return cur && !cur.summary && !cur.status && !cur.assignee;
  });

  for (let i = 0; i < missing.length; i += 4) {
    const slice = missing.slice(i, i + 4);
    await Promise.all(
      slice.map(async (k) => {
        const one = await fetchOneGleanJiraIssue(k, request);
        if (one) issues[k] = one;
      })
    );
  }

  return {
    configured: true,
    issues,
    refreshedSessionSeal,
    source: "glean",
    hint: null,
  };
}
