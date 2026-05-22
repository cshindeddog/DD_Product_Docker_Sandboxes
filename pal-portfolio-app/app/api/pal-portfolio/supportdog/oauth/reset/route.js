import { NextResponse } from "next/server";
import { SUPPORTDOG_DCR_COOKIE, clearSupportdogOAuthCookies } from "@/lib/supportdogOAuthSession";

export const dynamic = "force-dynamic";

/** Clears SupportDog OAuth + DCR cookies (fixes invalid_redirect_uri after port/env change). */
export async function GET(request) {
  const url = new URL(request.url);
  const json = ["1", "true", "yes"].includes(String(url.searchParams.get("json") || "").toLowerCase());
  let returnTo = url.searchParams.get("returnTo") || "/";
  if (!returnTo.startsWith("/") || returnTo.startsWith("//")) returnTo = "/";

  if (json) {
    const res = NextResponse.json({ ok: true, cleared: true });
    clearSupportdogOAuthCookies(res);
    res.cookies.set(SUPPORTDOG_DCR_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    return res;
  }

  const res = NextResponse.redirect(new URL(returnTo, url.origin).toString());
  clearSupportdogOAuthCookies(res);
  res.cookies.set(SUPPORTDOG_DCR_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
