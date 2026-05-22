import { NextResponse } from "next/server";
import { loadPalPortfolioRows } from "@/lib/palPortfolio";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const resolved = await params;
  const raw = resolved?.ticketId;
  const ticketId = raw != null ? String(raw).trim() : "";
  if (!ticketId) {
    return NextResponse.json({ error: "Missing ticket id" }, { status: 400 });
  }

  const { path: sourcePath, rows } = loadPalPortfolioRows();
  if (!sourcePath) {
    return NextResponse.json({ error: "PAL portfolio CSV not found" }, { status: 404 });
  }

  const matches = rows.filter((r) => String(r.ticketId).trim() === ticketId);
  if (matches.length === 0) {
    return NextResponse.json({ error: "Ticket not found in export" }, { status: 404 });
  }

  return NextResponse.json(
    { ticketId, sourcePath, rows: matches },
    { headers: { "Cache-Control": "private, max-age=60" } }
  );
}
