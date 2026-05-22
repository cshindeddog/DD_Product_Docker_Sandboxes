import { NextResponse } from "next/server";
import { attachGleanSessionCookie } from "@/lib/gleanOAuthSession";
import { fetchGleanTicketStatuses } from "@/lib/gleanZendeskTicketStatus";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** Match large accounts (e.g. 180+ tickets in range); getdocuments runs in chunks of 8. */
const MAX_IDS = 250;

/**
 * POST body: `{ ticketIds: string[] }` — status from Glean-indexed Zendesk agent ticket URLs.
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

  const result = await fetchGleanTicketStatuses(ticketIds, request);
  const res = NextResponse.json(
    {
      configured: result.configured,
      statuses: result.statuses,
      error: result.error,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
  if (result.refreshedSessionSeal) attachGleanSessionCookie(res, result.refreshedSessionSeal);
  return res;
}
