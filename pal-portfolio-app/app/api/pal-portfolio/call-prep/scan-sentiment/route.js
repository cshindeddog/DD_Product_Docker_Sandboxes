import { NextResponse } from "next/server";
import { scanCustomerFrustrationText } from "@/lib/customerFrustrationScan";
import { fetchZendeskCustomerFacingTextForScan } from "@/lib/zendeskCustomerFacingText";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_IDS = 28;
const CHUNK = 4;

/**
 * POST body: `{ ticketIds: string[] }` — scans customer-facing Zendesk text for frustration cues.
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

  /** @type {Record<string, { ok: true; red: boolean; phrases: string[]; subject: string } | { ok: false; code: string; message?: string }>} */
  const results = {};

  for (let i = 0; i < ticketIds.length; i += CHUNK) {
    const chunk = ticketIds.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map(async (id) => {
        const r = await fetchZendeskCustomerFacingTextForScan(id);
        if (!r.ok) {
          results[id] = { ok: false, code: r.code, message: r.message };
          return;
        }
        const scan = scanCustomerFrustrationText(r.text);
        results[id] = {
          ok: true,
          red: scan.red,
          phrases: scan.phrases,
          subject: r.subject || "—",
        };
      })
    );
  }

  return NextResponse.json({ results });
}
