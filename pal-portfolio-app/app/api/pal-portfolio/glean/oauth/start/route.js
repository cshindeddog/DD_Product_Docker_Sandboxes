import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { gleanOAuthDcrBuildAuthorizeRedirect } from "@/lib/gleanOAuthDcr";
import {
  attachGleanDcrClientCookie,
  attachGleanPkceCookie,
  fetchGleanOAuthMetadata,
  gleanOAuthCookieSecret,
  isGleanOAuthDcrConfigured,
  isGleanOAuthEnvConfigured,
  resolveGleanOAuthScopes,
  sealGleanCookiePayload,
} from "@/lib/gleanOAuthSession";

export const dynamic = "force-dynamic";

function b64url(buf) {
  return buf.toString("base64url");
}

/**
 * @param {Request} request
 */
export async function GET(request) {
  if (!isGleanOAuthEnvConfigured()) {
    return NextResponse.json({ error: "Glean OAuth is not configured on this server." }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  let returnTo = searchParams.get("returnTo") || "/";
  if (!returnTo.startsWith("/") || returnTo.startsWith("//")) returnTo = "/";

  if (isGleanOAuthDcrConfigured()) {
    try {
      const { authorizeUrl, pkceSeal, dcrClientSeal } = await gleanOAuthDcrBuildAuthorizeRedirect(request, returnTo);
      const res = NextResponse.redirect(authorizeUrl);
      attachGleanPkceCookie(res, pkceSeal);
      if (dcrClientSeal) attachGleanDcrClientCookie(res, dcrClientSeal);
      return res;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        {
          error: msg,
          hint: "SSO without a pre-registered OAuth app uses dynamic client registration (RFC 7591) via the MCP URL. Set GLEAN_INSTANCE_URL (or GLEAN_MCP_URL), GLEAN_OAUTH_REDIRECT_URI, and GLEAN_OAUTH_COOKIE_SECRET. Do not set GLEAN_OAUTH_CLIENT_ID.",
        },
        { status: 502 }
      );
    }
  }

  const meta = await fetchGleanOAuthMetadata();
  if (!meta) {
    return NextResponse.json({ error: "Could not load Glean OAuth metadata (.well-known)." }, { status: 502 });
  }

  const state = b64url(randomBytes(32));
  const codeVerifier = b64url(randomBytes(64));
  const codeChallenge = b64url(createHash("sha256").update(codeVerifier).digest());

  const pkceSeal = sealGleanCookiePayload({ state, codeVerifier, returnTo }, gleanOAuthCookieSecret());

  const redirectUri = process.env.GLEAN_OAUTH_REDIRECT_URI?.trim();
  const clientId = process.env.GLEAN_OAUTH_CLIENT_ID?.trim();
  if (!redirectUri || !clientId) {
    return NextResponse.json({ error: "Missing GLEAN_OAUTH_REDIRECT_URI or GLEAN_OAUTH_CLIENT_ID." }, { status: 500 });
  }

  const authorizeUrl = new URL(meta.authorization_endpoint);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  const scopes = await resolveGleanOAuthScopes();
  if (scopes) authorizeUrl.searchParams.set("scope", scopes);

  const res = NextResponse.redirect(authorizeUrl.toString());
  attachGleanPkceCookie(res, pkceSeal);
  return res;
}
