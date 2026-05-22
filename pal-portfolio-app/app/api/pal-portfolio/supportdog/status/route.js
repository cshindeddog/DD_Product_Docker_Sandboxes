import { NextResponse } from "next/server";
import { defaultSupportdogDatacenter, normalizeSupportdogDatacenter } from "@/lib/supportdogDatacenter";
import {
  getSupportdogMcpAuthorizationFromEnv,
  isSupportdogMcpConfigured,
  listSupportdogTools,
  supportdogConnectInstructions,
} from "@/lib/supportdogMcpClient";

export const dynamic = "force-dynamic";

/**
 * GET ?datacenter=US1 — SupportDog MCP connectivity check.
 */
export async function GET(request) {
  const url = new URL(request.url);
  const dc =
    normalizeSupportdogDatacenter(url.searchParams.get("datacenter")) || defaultSupportdogDatacenter();

  if (!isSupportdogMcpConfigured(request)) {
    return NextResponse.json({
      configured: false,
      datacenter: dc,
      message: "Sign in with SupportDog in the app header, or set SUPPORTDOG_MCP_AUTHORIZATION in .env.local.",
      setupHint: supportdogConnectInstructions(dc),
    });
  }

  const listed = await listSupportdogTools(dc, request);
  return NextResponse.json({
    configured: true,
    datacenter: dc,
    connected: listed.ok,
    message: listed.ok ? "OK" : listed.message,
    toolCount: listed.ok ? listed.tools.length : 0,
    hasGetZendeskTicket: listed.ok
      ? listed.tools.some((t) => /GetZendeskTicket/i.test(t.name))
      : false,
    authorizationPresent: Boolean(getSupportdogMcpAuthorizationFromEnv(dc) || listed.ok),
    setupHint: listed.ok ? null : supportdogConnectInstructions(dc),
  });
}
