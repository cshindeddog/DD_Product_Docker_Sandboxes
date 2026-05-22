import { NextResponse } from "next/server";
import { gleanOAuthDcrExchangeForCode } from "@/lib/gleanOAuthDcr";
import {
  attachGleanSessionCookie,
  buildSessionPayloadFromTokenResponse,
  clearGleanPkceCookie,
  fetchGleanOAuthMetadata,
  gleanOAuthCookieSecret,
  isGleanOAuthDcrConfigured,
  isGleanOAuthEnvConfigured,
  readPkceFromRequest,
  sealGleanCookiePayload,
} from "@/lib/gleanOAuthSession";

export const dynamic = "force-dynamic";

/**
 * @param {Request} request
 */
export async function GET(request) {
  const url = new URL(request.url);
  const err = url.searchParams.get("error");
  const errDesc = url.searchParams.get("error_description") || "";

  const origin = url.origin;

  if (err) {
    const res = NextResponse.redirect(
      `${origin}/?glean_oauth_error=${encodeURIComponent(err + (errDesc ? `: ${errDesc}` : ""))}`
    );
    clearGleanPkceCookie(res);
    return res;
  }

  if (!isGleanOAuthEnvConfigured()) {
    return NextResponse.json({ error: "Glean OAuth is not configured." }, { status: 503 });
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    const res = NextResponse.redirect(`${origin}/?glean_oauth_error=${encodeURIComponent("missing_code_or_state")}`);
    clearGleanPkceCookie(res);
    return res;
  }

  const pkce = readPkceFromRequest(request);
  if (!pkce || pkce.state !== state) {
    const res = NextResponse.redirect(`${origin}/?glean_oauth_error=${encodeURIComponent("state_mismatch")}`);
    clearGleanPkceCookie(res);
    return res;
  }

  const redirectUri = process.env.GLEAN_OAUTH_REDIRECT_URI?.trim();
  if (!redirectUri) {
    return NextResponse.json({ error: "GLEAN_OAUTH_REDIRECT_URI is not set." }, { status: 500 });
  }

  if (isGleanOAuthDcrConfigured()) {
    const dcr = await gleanOAuthDcrExchangeForCode(request, code, pkce);
    if ("error" in dcr) {
      const res = NextResponse.redirect(`${origin}/?glean_oauth_error=${encodeURIComponent(dcr.error)}`);
      clearGleanPkceCookie(res);
      return res;
    }

    let returnTo = pkce.returnTo || "/";
    if (!returnTo.startsWith("/") || returnTo.startsWith("//")) returnTo = "/";

    const res = NextResponse.redirect(new URL(returnTo, origin).toString());
    attachGleanSessionCookie(res, dcr.sessionSeal);
    clearGleanPkceCookie(res);
    return res;
  }

  const meta = await fetchGleanOAuthMetadata();
  if (!meta) {
    const res = NextResponse.redirect(`${origin}/?glean_oauth_error=${encodeURIComponent("metadata_unavailable")}`);
    clearGleanPkceCookie(res);
    return res;
  }

  const clientId = process.env.GLEAN_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GLEAN_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "OAuth client misconfigured." }, { status: 500 });
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
    code_verifier: pkce.codeVerifier,
  });

  let tokenRes;
  try {
    tokenRes = await fetch(meta.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const res = NextResponse.redirect(`${origin}/?glean_oauth_error=${encodeURIComponent(msg)}`);
    clearGleanPkceCookie(res);
    return res;
  }

  const raw = await tokenRes.text();
  let json;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    json = {};
  }

  if (!tokenRes.ok) {
    const msg =
      (json && typeof json === "object" && (json.error_description || json.error)) || raw.slice(0, 200) || "token_failed";
    const res = NextResponse.redirect(`${origin}/?glean_oauth_error=${encodeURIComponent(String(msg))}`);
    clearGleanPkceCookie(res);
    return res;
  }

  const access_token = typeof json.access_token === "string" ? json.access_token : "";
  const refresh_token = typeof json.refresh_token === "string" ? json.refresh_token : "";
  if (!access_token || !refresh_token) {
    const res = NextResponse.redirect(
      `${origin}/?glean_oauth_error=${encodeURIComponent("token_response_missing_refresh_or_access")}`
    );
    clearGleanPkceCookie(res);
    return res;
  }

  const payload = buildSessionPayloadFromTokenResponse(json, refresh_token);
  const sessionSeal = sealGleanCookiePayload(payload, gleanOAuthCookieSecret());

  let returnTo = pkce.returnTo || "/";
  if (!returnTo.startsWith("/") || returnTo.startsWith("//")) returnTo = "/";

  const res = NextResponse.redirect(new URL(returnTo, origin).toString());
  attachGleanSessionCookie(res, sessionSeal);
  clearGleanPkceCookie(res);
  return res;
}
