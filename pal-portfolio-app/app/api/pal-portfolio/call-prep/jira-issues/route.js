import { NextResponse } from "next/server";
import { fetchGleanJiraIssues } from "@/lib/gleanJiraIssue";
import { attachGleanSessionCookie } from "@/lib/gleanOAuthSession";
import { jiraKeyToBrowseUrl } from "@/lib/palPortfolioFrJira";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_KEYS = 20;

/**
 * POST body: `{ issueKeys: string[] }` — Jira summary/status from Glean (indexed Jira + MCP read_document).
 * Uses your Glean sign-in on this app; no Atlassian API token required.
 * @param {Request} request
 */
export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const raw = Array.isArray(body.issueKeys) ? body.issueKeys : [];
  const issueKeys = [
    ...new Set(
      raw
        .map((x) => String(x).trim().toUpperCase())
        .filter((k) => jiraKeyToBrowseUrl(k))
    ),
  ].slice(0, MAX_KEYS);

  if (!issueKeys.length) {
    return NextResponse.json({ error: "issueKeys array required." }, { status: 400 });
  }

  const result = await fetchGleanJiraIssues(issueKeys, request);
  const res = NextResponse.json(
    {
      configured: result.configured,
      source: result.source || "glean",
      issues: result.issues,
      hint: result.hint,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
  if (result.refreshedSessionSeal) attachGleanSessionCookie(res, result.refreshedSessionSeal);
  return res;
}
