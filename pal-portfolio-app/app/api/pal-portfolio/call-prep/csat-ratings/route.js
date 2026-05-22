import { NextResponse } from "next/server";
import { fetchCsatHighlightsFromSnowflake } from "@/lib/palPortfolioCsatSnowflake";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST body: `{ datadogOrgId, salesforceAccountId?, rangeFrom, rangeTo }`
 * Returns bad/good CSAT tickets via Snowflake MCP for the org in the highlights created-date window.
 * @param {Request} request
 */
export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const datadogOrgId = body.datadogOrgId != null ? String(body.datadogOrgId).trim() : "";
  const salesforceAccountId =
    body.salesforceAccountId != null ? String(body.salesforceAccountId).trim() : "";
  const highlightFrom =
    body.highlightFrom != null
      ? String(body.highlightFrom).trim()
      : body.rangeFrom != null
        ? String(body.rangeFrom).trim()
        : "";
  const highlightTo =
    body.highlightTo != null
      ? String(body.highlightTo).trim()
      : body.rangeTo != null
        ? String(body.rangeTo).trim()
        : "";

  if (!highlightFrom || !highlightTo) {
    return NextResponse.json({ error: "highlightFrom and highlightTo are required." }, { status: 400 });
  }

  const result = await fetchCsatHighlightsFromSnowflake({
    datadogOrgId,
    salesforceAccountId: salesforceAccountId || null,
    highlightFrom,
    highlightTo,
  });

  return NextResponse.json(result);
}
