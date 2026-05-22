import {
  defaultSupportdogDatacenter,
  normalizeSupportdogDatacenter,
  supportdogMcpServerLabel,
  SUPPORTDOG_DATACENTERS,
} from "@/lib/supportdogDatacenter";
import {
  getSupportdogMcpAuthorizationFromEnv,
  listSupportdogTools,
} from "@/lib/supportdogMcpClient";
import {
  entryFromSessionPayload,
  isSupportdogOAuthConfigured,
  readSupportdogSession,
  readSupportdogSessionsMap,
  supportdogOAuthCookieSecret,
} from "@/lib/supportdogOAuthSession";
import { unsealGleanCookiePayload } from "@/lib/gleanOAuthSession";

/**
 * @param {Request} request
 * @param {string | null | undefined} datacenter
 * @param {{ probeMcp?: boolean }} [opts]
 */
export async function getSupportdogServerStatus(request, datacenter, opts = {}) {
  const probeMcp = opts.probeMcp === true;
  const dc = normalizeSupportdogDatacenter(datacenter) || defaultSupportdogDatacenter();
  const label = supportdogMcpServerLabel(dc);
  const envToken = Boolean(getSupportdogMcpAuthorizationFromEnv(dc));
  const session = readSupportdogSession(request, dc);

  /** @type {string | null} */
  let refreshedSessionSeal = null;

  if (envToken && probeMcp) {
    const listed = await listSupportdogTools(dc, request);
    refreshedSessionSeal = listed.refreshedSessionSeal || null;
    return {
      datacenter: dc,
      label,
      authSource: "env",
      signedIn: true,
      connected: listed.ok,
      needsAuthentication: !listed.ok,
      toolCount: listed.ok ? listed.tools.length : 0,
      message: listed.ok ? "connected" : listed.message || "MCP error",
      refreshedSessionSeal,
    };
  }

  if (envToken && !probeMcp) {
    return {
      datacenter: dc,
      label,
      authSource: "env",
      signedIn: true,
      connected: true,
      needsAuthentication: false,
      toolCount: 0,
      message: "env token configured",
      refreshedSessionSeal: null,
    };
  }

  if (!session?.rt) {
    return {
      datacenter: dc,
      label,
      authSource: null,
      signedIn: false,
      connected: false,
      needsAuthentication: true,
      toolCount: 0,
      message: isSupportdogOAuthConfigured() ? "not signed in" : "OAuth not configured",
      refreshedSessionSeal: null,
    };
  }

  if (session.expired) {
    return {
      datacenter: dc,
      label,
      authSource: "oauth",
      signedIn: false,
      connected: false,
      needsAuthentication: true,
      toolCount: 0,
      message: "session expired",
      refreshedSessionSeal: null,
    };
  }

  if (!probeMcp) {
    return {
      datacenter: dc,
      label,
      authSource: "oauth",
      signedIn: true,
      connected: true,
      needsAuthentication: false,
      toolCount: 0,
      message: "signed in",
      refreshedSessionSeal: null,
    };
  }

  const listed = await listSupportdogTools(dc, request);

  refreshedSessionSeal = listed.refreshedSessionSeal || null;
  const mcpAuthFailed = !listed.ok && listed.code === "missing_auth";
  return {
    datacenter: dc,
    label,
    authSource: "oauth",
    signedIn: true,
    connected: listed.ok,
    needsAuthentication: mcpAuthFailed,
    toolCount: listed.ok ? listed.tools.length : 0,
    message: listed.ok
      ? `connected · ${listed.tools.length} tools`
      : mcpAuthFailed
        ? "not signed in"
        : `signed in · ${listed.message || "MCP probe failed"}`,
    refreshedSessionSeal,
  };
}

/**
 * @param {Request} request
 * @param {{ includeStaging?: boolean }} [opts]
 */
export async function getAllSupportdogServersStatus(request, opts = {}) {
  const dcs = SUPPORTDOG_DATACENTERS.filter((dc) => opts.includeStaging !== false || dc !== "STAGING");
  const probeMcp = opts.probeMcp === true;

  /** @type {Record<string, import("@/lib/supportdogOAuthSession").SupportdogDcSession>} */
  let sessionsMap = readSupportdogSessionsMap(request);
  const results = [];
  for (const dc of dcs) {
    const r = await getSupportdogServerStatus(request, dc, { probeMcp });
    if (r.refreshedSessionSeal && r.datacenter) {
      const secret = supportdogOAuthCookieSecret();
      if (secret) {
        const entry = entryFromSessionPayload(
          unsealGleanCookiePayload(r.refreshedSessionSeal, secret)
        );
        if (entry?.rt) sessionsMap[r.datacenter] = entry;
      }
    }
    results.push(r);
  }

  const servers = results.map(({ refreshedSessionSeal: _s, ...rest }) => rest);
  const signedInCount = servers.filter((s) => s.signedIn && !s.needsAuthentication).length;
  const connectedCount = servers.filter((s) => s.connected).length;

  return {
    oauthEnabled: isSupportdogOAuthConfigured(),
    globalEnvToken: Boolean(getSupportdogMcpAuthorizationFromEnv()),
    signedInCount,
    connectedCount,
    totalCount: servers.length,
    servers,
    sessionsMap,
  };
}
