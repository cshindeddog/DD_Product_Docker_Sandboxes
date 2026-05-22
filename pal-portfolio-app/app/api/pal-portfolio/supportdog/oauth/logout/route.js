import { NextResponse } from "next/server";
import { normalizeSupportdogDatacenter } from "@/lib/supportdogDatacenter";
import {
  clearSupportdogDatacenterAuth,
  clearSupportdogOAuthCookies,
} from "@/lib/supportdogOAuthSession";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const url = new URL(request.url);
  let returnTo = url.searchParams.get("returnTo") || "/";
  if (!returnTo.startsWith("/") || returnTo.startsWith("//")) returnTo = "/";

  const dc = normalizeSupportdogDatacenter(url.searchParams.get("datacenter"));
  const res = NextResponse.redirect(new URL(returnTo, url.origin).toString());

  if (dc) {
    clearSupportdogDatacenterAuth(res, request, dc);
  } else {
    clearSupportdogOAuthCookies(res);
    res.cookies.set("pp_supportdog_oauth_dcr", "", { httpOnly: true, path: "/", maxAge: 0 });
  }

  return res;
}
