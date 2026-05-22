import { NextResponse } from "next/server";
import { supportdogOAuthBuildAuthorizeRedirect } from "@/lib/supportdogOAuthDcr";
import { resolveSupportdogOAuthRedirectUri } from "@/lib/supportdogOAuthRedirect";
import { isSupportdogOAuthConfigured } from "@/lib/supportdogOAuthSession";

export const dynamic = "force-dynamic";

/** GET — show redirect URI that will be used (for invalid_redirect_uri troubleshooting). */
export async function GET(request) {
  const url = new URL(request.url);
  const dc = url.searchParams.get("datacenter") || "US1";
  const redirectUri = resolveSupportdogOAuthRedirectUri(request);
  const envRedirect = process.env.SUPPORTDOG_OAUTH_REDIRECT_URI?.trim() || null;

  let authorizeUrl = null;
  let authorizeError = null;
  if (isSupportdogOAuthConfigured()) {
    try {
      const built = await supportdogOAuthBuildAuthorizeRedirect(request, "/", dc);
      authorizeUrl = built.authorizeUrl;
    } catch (e) {
      authorizeError = e instanceof Error ? e.message : String(e);
    }
  }

  return NextResponse.json({
    oauthConfigured: isSupportdogOAuthConfigured(),
    requestOrigin: new URL(request.url).origin,
    redirectUriUsed: redirectUri,
    envRedirectUri: envRedirect,
    envIgnored:
      Boolean(envRedirect) &&
      normalize(envRedirect) !== normalize(redirectUri),
    authorizeUrlPreview: authorizeUrl ? authorizeUrl.slice(0, 280) + "…" : null,
    authorizeError,
    hint:
      "Open the app at http://localhost:5101 (not 127.0.0.1). Remove old SUPPORTDOG_OAUTH_REDIRECT_URI paths from .env.local.",
  });
}

/**
 * @param {string} u
 */
function normalize(u) {
  try {
    return new URL(u).href.replace(/\/$/, "");
  } catch {
    return u;
  }
}
