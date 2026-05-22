import { NextResponse } from "next/server";
import { defaultSupportdogDatacenter, normalizeSupportdogDatacenter } from "@/lib/supportdogDatacenter";
import { getAllSupportdogServersStatus, getSupportdogServerStatus } from "@/lib/supportdogServersStatus";
import {
  isSupportdogOAuthConfigured,
  mergeSupportdogSessionSealIntoMap,
  persistSupportdogSessionsMap,
  readSupportdogSessionsMap,
  reconcileSupportdogSessionCookies,
} from "@/lib/supportdogOAuthSession";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const url = new URL(request.url);
  const all = ["1", "true", "yes"].includes(String(url.searchParams.get("all") || "").toLowerCase());

  if (all) {
    const probeMcp = ["1", "true", "yes"].includes(String(url.searchParams.get("probe") || "").toLowerCase());
    const summary = await getAllSupportdogServersStatus(request, {
      includeStaging: url.searchParams.get("includeStaging") !== "0",
      probeMcp,
    });
    const res = NextResponse.json({
      oauthEnabled: summary.oauthEnabled,
      globalEnvToken: summary.globalEnvToken,
      signedInCount: summary.signedInCount,
      connectedCount: summary.connectedCount,
      totalCount: summary.totalCount,
      servers: summary.servers,
    });
    reconcileSupportdogSessionCookies(res, request);
    if (summary.sessionsMap && Object.keys(summary.sessionsMap).length > 0) {
      persistSupportdogSessionsMap(res, summary.sessionsMap);
    }
    return res;
  }

  const dc = normalizeSupportdogDatacenter(url.searchParams.get("datacenter")) || defaultSupportdogDatacenter();
  const server = await getSupportdogServerStatus(request, dc);
  const res = NextResponse.json({
    oauthEnabled: isSupportdogOAuthConfigured(),
    datacenter: server.datacenter,
    signedIn: server.signedIn,
    connected: server.connected,
    needsAuthentication: server.needsAuthentication,
    toolCount: server.toolCount,
    message: server.message,
    envToken: server.authSource === "env",
    label: server.label,
  });
  reconcileSupportdogSessionCookies(res, request);
  let sessionsMap = readSupportdogSessionsMap(request);
  if (server.refreshedSessionSeal && server.datacenter) {
    sessionsMap = mergeSupportdogSessionSealIntoMap(
      request,
      server.datacenter,
      server.refreshedSessionSeal
    );
  }
  if (Object.keys(sessionsMap).length > 0) {
    persistSupportdogSessionsMap(res, sessionsMap);
  }
  return res;
}
