import { NextResponse } from "next/server";
import { loadPalPortfolioRows } from "@/lib/palPortfolio";

export const dynamic = "force-dynamic";

export async function GET() {
  const { path: csvPath, rows } = loadPalPortfolioRows();
  if (!csvPath) {
    return NextResponse.json(
      {
        error: "PAL portfolio CSV not found",
        hint:
          "Set PAL_PORTFOLIO_CSV_PATH to an absolute path, or place pal_engineer_accounts_tickets_last6mo.csv (or tmp_…) in pal-portfolio/data/ or the parent directory.",
      },
      { status: 404 }
    );
  }
  return NextResponse.json(
    { sourcePath: csvPath, rowCount: rows.length, rows },
    { headers: { "Cache-Control": "no-store" } }
  );
}
