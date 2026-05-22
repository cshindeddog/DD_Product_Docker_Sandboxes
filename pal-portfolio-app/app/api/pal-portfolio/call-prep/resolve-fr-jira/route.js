import { NextResponse } from "next/server";
import { jiraKeyToBrowseUrl, findPrimaryJiraKeyInZendeskTicket } from "@/lib/palPortfolioFrJira";
import { fetchZendeskTicketJsonBrief } from "@/lib/zendeskTicketFetch";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_IDS = 24;
const CHUNK = 4;

/**
 * POST body: `{ ticketIds: string[] }` — resolves linked Jira keys (FR-####, escalation PROJ-####) from Zendesk ticket JSON
 * (subject, description, tags, custom fields). Requires Zendesk API env.
 * @param {Request} request
 */
export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const raw = Array.isArray(body.ticketIds) ? body.ticketIds : [];
  const ticketIds = [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))].slice(0, MAX_IDS);

  if (!ticketIds.length) {
    return NextResponse.json({ error: "ticketIds array required." }, { status: 400 });
  }

  /** @type {Record<string, { key: string; url: string } | null>} */
  const results = {};

  for (let i = 0; i < ticketIds.length; i += CHUNK) {
    const chunk = ticketIds.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map(async (id) => {
        const r = await fetchZendeskTicketJsonBrief(id);
        if (!r.ok) {
          results[id] = null;
          return;
        }
        const key = findPrimaryJiraKeyInZendeskTicket(r.ticket);
        if (!key) {
          results[id] = null;
          return;
        }
        const url = jiraKeyToBrowseUrl(key);
        if (!url) {
          results[id] = null;
          return;
        }
        results[id] = { key, url };
      })
    );
  }

  return NextResponse.json({ results });
}
