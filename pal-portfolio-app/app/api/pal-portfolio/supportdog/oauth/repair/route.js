import { NextResponse } from "next/server";
import {
  isSupportdogOAuthConfigured,
  reconcileSupportdogSessionCookies,
} from "@/lib/supportdogOAuthSession";

export const dynamic = "force-dynamic";

/**
 * GET — compact/migrate SupportDog cookies without wiping valid sessions.
 * Use instead of clearing browser site data (HTTP 431 / legacy cookie cleanup).
 */
export async function GET(request) {
  if (!isSupportdogOAuthConfigured()) {
    return NextResponse.json({ ok: false, error: "oauth_not_configured" }, { status: 503 });
  }

  const res = NextResponse.json({ ok: true });
  const { map, repaired, clearedAll } = reconcileSupportdogSessionCookies(res, request);

  const hint = clearedAll
    ? "Oversized cookies were cleared. Use Connect all to sign in again."
    : repaired
      ? "Cookies were compacted. No browser cache clear needed."
      : "Cookies already healthy.";

  return NextResponse.json(
    {
      ok: true,
      repaired,
      clearedAll,
      signedInRegions: Object.keys(map),
      hint,
    },
    { headers: res.headers }
  );
}
