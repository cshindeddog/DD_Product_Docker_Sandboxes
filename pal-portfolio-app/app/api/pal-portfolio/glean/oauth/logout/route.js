import { NextResponse } from "next/server";
import { clearGleanOAuthCookies } from "@/lib/gleanOAuthSession";

export const dynamic = "force-dynamic";

/**
 * @param {Request} request
 */
export async function GET(request) {
  const url = new URL(request.url);
  let returnTo = url.searchParams.get("returnTo") || "/";
  if (!returnTo.startsWith("/") || returnTo.startsWith("//")) returnTo = "/";

  const res = NextResponse.redirect(new URL(returnTo, url.origin).toString());
  clearGleanOAuthCookies(res);
  return res;
}
