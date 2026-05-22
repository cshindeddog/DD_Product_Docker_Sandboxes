import { NextResponse } from "next/server";
import { normalizeSupportdogDatacenter } from "@/lib/supportdogDatacenter";
import { supportdogOAuthBuildAuthorizeRedirect } from "@/lib/supportdogOAuthDcr";
import {
  attachSupportdogPkceCookie,
  isSupportdogOAuthConfigured,
  reconcileSupportdogSessionCookies,
} from "@/lib/supportdogOAuthSession";

export const dynamic = "force-dynamic";

/**
 * GET ?returnTo=/&datacenter=US1
 */
export async function GET(request) {
  if (!isSupportdogOAuthConfigured()) {
    return NextResponse.json(
      {
        error: "SupportDog OAuth is not configured.",
        hint: "Set SUPPORTDOG_OAUTH_COOKIE_SECRET in .env.local. Open http://localhost:5101 (not 127.0.0.1). Callback is /callback only.",
      },
      { status: 503 }
    );
  }

  const url = new URL(request.url);
  let returnTo = url.searchParams.get("returnTo") || "/";
  if (!returnTo.startsWith("/") || returnTo.startsWith("//")) returnTo = "/";
  const datacenter = normalizeSupportdogDatacenter(url.searchParams.get("datacenter")) || "US1";
  const connectAll = ["1", "true", "yes"].includes(String(url.searchParams.get("connectAll") || "").toLowerCase());

  try {
    const { authorizeUrl, pkceSeal, dcrClientSeal } = await supportdogOAuthBuildAuthorizeRedirect(
      request,
      returnTo,
      datacenter,
      connectAll
    );
    const res = NextResponse.redirect(authorizeUrl);
    reconcileSupportdogSessionCookies(res, request);
    attachSupportdogPkceCookie(res, pkceSeal);
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
