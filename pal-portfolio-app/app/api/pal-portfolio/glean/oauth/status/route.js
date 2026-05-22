import { NextResponse } from "next/server";
import { isGleanConfigured } from "@/lib/gleanServer";
import {
  isGleanOAuthEnvConfigured,
  readSessionFromRequest,
  resolveGleanOAuthAccessToken,
} from "@/lib/gleanOAuthSession";

export const dynamic = "force-dynamic";

/**
 * @param {Request} request
 */
export async function GET(request) {
  const oauthEnabled = isGleanOAuthEnvConfigured();
  const signedIn = oauthEnabled && Boolean(readSessionFromRequest(request));
  let gleanReady = isGleanConfigured(request);
  if (gleanReady && request && readSessionFromRequest(request)) {
    const tok = await resolveGleanOAuthAccessToken(request);
    gleanReady = Boolean(tok?.accessToken);
  }
  return NextResponse.json({ oauthEnabled, signedIn, gleanReady });
}
