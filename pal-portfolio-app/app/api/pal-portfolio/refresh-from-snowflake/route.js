import { NextResponse } from "next/server";
import { exportPalPortfolioFromSnowflake } from "@/lib/palPortfolioSnowflakeExport";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  try {
    const result = await exportPalPortfolioFromSnowflake();
    return NextResponse.json(
      {
        ok: true,
        sourcePath: result.path,
        rowCount: result.rowCount,
        exportedAt: result.exportedAt,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = /not configured|config file not found/i.test(message) ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
