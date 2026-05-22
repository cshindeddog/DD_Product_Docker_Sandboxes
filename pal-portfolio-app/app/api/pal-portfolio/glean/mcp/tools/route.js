import { NextResponse } from "next/server";
import { attachGleanSessionCookie } from "@/lib/gleanOAuthSession";
import { gleanMcpListTools } from "@/lib/gleanMcpClient";

export const dynamic = "force-dynamic";

/**
 * GET — list tools exposed by the configured Glean remote MCP server (Streamable HTTP).
 * @param {Request} request
 */
export async function GET(request) {
  const out = await gleanMcpListTools(request);
  if (!out.ok) {
    return NextResponse.json({ ok: false, error: out.message }, { status: 502 });
  }
  const res = NextResponse.json({ ok: true, tools: out.tools });
  if (out.refreshedSessionSeal) {
    attachGleanSessionCookie(res, out.refreshedSessionSeal);
  }
  return res;
}
