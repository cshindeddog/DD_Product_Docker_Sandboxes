import { NextResponse } from "next/server";
import { nextDcAfterOAuthExchange } from "@/lib/supportdogConnectAll";
import { supportdogOAuthExchangeForCode } from "@/lib/supportdogOAuthDcr";
import {
  SUPPORTDOG_DCR_COOKIE,
  clearSupportdogOAuthCookies,
  clearSupportdogPkceCookie,
  mergeSupportdogSessionSealIntoMap,
  persistSupportdogSessionsMap,
  readSupportdogPkce,
  reconcileSupportdogSessionCookies,
} from "@/lib/supportdogOAuthSession";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const err = url.searchParams.get("error");
  const errDesc = url.searchParams.get("error_description") || "";

  if (err) {
    const isRedirect = err === "invalid_redirect_uri" || /redirect_uri/i.test(errDesc);
    const hint = isRedirect
      ? "Clear SupportDog OAuth cookies and sign in again (port must match the app URL, e.g. :5101)."
      : "";
    const res = NextResponse.redirect(
      `${origin}/?supportdog_oauth_error=${encodeURIComponent(err + (errDesc ? `: ${errDesc}` : "") + (hint ? ` — ${hint}` : ""))}`
    );
    clearSupportdogOAuthCookies(res);
    if (isRedirect) {
      res.cookies.set(SUPPORTDOG_DCR_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    }
    return res;
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    const res = NextResponse.redirect(`${origin}/?supportdog_oauth_error=missing_code_or_state`);
    clearSupportdogOAuthCookies(res);
    return res;
  }

  const pkce = readSupportdogPkce(request);
  if (!pkce || pkce.state !== state) {
    const res = NextResponse.redirect(`${origin}/?supportdog_oauth_error=state_mismatch`);
    clearSupportdogOAuthCookies(res);
    return res;
  }

  const exchanged = await supportdogOAuthExchangeForCode(request, code, pkce);
  if ("error" in exchanged) {
    const res = NextResponse.redirect(
      `${origin}/?supportdog_oauth_error=${encodeURIComponent(exchanged.error)}`
    );
    clearSupportdogOAuthCookies(res);
    return res;
  }

  let returnTo = pkce.returnTo || "/";
  if (!returnTo.startsWith("/") || returnTo.startsWith("//")) returnTo = "/";

  const returnUrl = new URL(returnTo, origin);
  returnUrl.searchParams.set("supportdog_oauth", "ok");
  returnUrl.searchParams.set("supportdog_dc", exchanged.datacenter || pkce.datacenter);
  let redirectTarget = returnUrl.toString();

  if (pkce.connectAll) {
    const nextDc = nextDcAfterOAuthExchange(request, exchanged.datacenter, exchanged.sessionSeal);
    if (nextDc) {
      const start = new URL("/api/pal-portfolio/supportdog/oauth/start", origin);
      start.searchParams.set("datacenter", nextDc);
      start.searchParams.set("connectAll", "1");
      start.searchParams.set("returnTo", returnTo);
      redirectTarget = start.toString();
    }
  }

  const res = NextResponse.redirect(redirectTarget);
  const sessionsMap = mergeSupportdogSessionSealIntoMap(
    request,
    exchanged.datacenter,
    exchanged.sessionSeal
  );
  persistSupportdogSessionsMap(res, sessionsMap);
  reconcileSupportdogSessionCookies(res, request);
  clearSupportdogPkceCookie(res);
  return res;
}
