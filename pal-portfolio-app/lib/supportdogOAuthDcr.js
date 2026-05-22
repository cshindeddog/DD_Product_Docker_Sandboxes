import { randomBytes } from "node:crypto";
import {
  discoverOAuthServerInfo,
  exchangeAuthorization,
  refreshAuthorization,
  startAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { normalizeSupportdogDatacenter } from "@/lib/supportdogDatacenter";
import {
  readSupportdogDcrClient,
  sealSupportdogDcSession,
  sealSupportdogSession,
  supportdogOAuthCookieSecret,
} from "@/lib/supportdogOAuthSession";
import { sealGleanCookiePayload } from "@/lib/gleanOAuthSession";
import { getSupportdogMcpCommonClient } from "@/lib/supportdogMcpCommonClient";
import { resolveSupportdogOAuthRedirectUri } from "@/lib/supportdogOAuthRedirect";

/** @type {Map<string, { discovery: unknown; at: number }>} */
const discoveryByDc = new Map();

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

/**
 * @param {string | null | undefined} datacenter
 */
export function supportdogResourceOrigin(datacenter) {
  const dc = normalizeSupportdogDatacenter(datacenter) || "US1";
  if (dc === "STAGING") {
    return "https://supportdog-mcp.mcp.us1.staging.dog";
  }
  return `https://supportdog-mcp.mcp.${dc.toLowerCase()}.prod.dog`;
}

/**
 * Scopes for Ticino / SupportDog MCP OAuth.
 * Ticino only accepts `mcp:read` (same as shared `mcp-common` client); `offline_access` → invalid_scope.
 * @returns {string | undefined}
 */
export function supportdogOAuthScopes() {
  const fromEnv = process.env.SUPPORTDOG_OAUTH_SCOPES?.trim();
  if (fromEnv === "" || fromEnv === "none") return undefined;
  return fromEnv || "mcp:read";
}

/**
 * @param {string | null | undefined} datacenter
 */
async function getSupportdogOAuthDiscovery(datacenter) {
  const dc = normalizeSupportdogDatacenter(datacenter) || "US1";
  const cached = discoveryByDc.get(dc);
  if (cached && Date.now() - cached.at < 300_000) {
    return cached.discovery;
  }
  const origin = supportdogResourceOrigin(dc);
  const serverInfo = await discoverOAuthServerInfo(new URL(origin), { fetchFn: fetch });
  if (!serverInfo?.authorizationServerMetadata) return null;
  const discovery = {
    authorizationServerUrl: String(serverInfo.authorizationServerUrl),
    authorizationServerMetadata: serverInfo.authorizationServerMetadata,
    resourceMetadata: serverInfo.resourceMetadata,
  };
  discoveryByDc.set(dc, { discovery, at: Date.now() });
  return discovery;
}

/**
 * @param {{ authorizationServerUrl: string }} discovery
 */
function authServerBaseUrl(discovery) {
  return new URL(discovery.authorizationServerUrl);
}

/**
 * @param {unknown} rm
 */
function resourceUrlFromDiscovery(rm) {
  if (!rm || typeof rm !== "object") return undefined;
  const r = /** @type {{ resource?: string }} */ (rm).resource;
  if (typeof r !== "string" || !r) return undefined;
  try {
    return new URL(r);
  } catch {
    return undefined;
  }
}

/**
 * @param {Request} request
 * @param {string} returnTo
 * @param {string | null | undefined} datacenter
 */
export async function supportdogOAuthBuildAuthorizeRedirect(request, returnTo, datacenter, connectAll = false) {
  const dc = normalizeSupportdogDatacenter(datacenter) || "US1";
  const redirectUri = resolveSupportdogOAuthRedirectUri(request);

  const discovery = await getSupportdogOAuthDiscovery(dc);
  if (!discovery?.authorizationServerMetadata) {
    throw new Error(`Could not discover SupportDog OAuth metadata for ${dc}.`);
  }
  const md = discovery.authorizationServerMetadata;
  if (!md.registration_endpoint) {
    throw new Error("SupportDog OAuth does not advertise dynamic client registration.");
  }

  // Ticino DCR always issues shared client `mcp-common` with fixed localhost/callback URIs (same as Claude).
  const clientInfo = getSupportdogMcpCommonClient();

  const state = b64url(randomBytes(32));
  const resource = resourceUrlFromDiscovery(discovery.resourceMetadata);
  const scope = supportdogOAuthScopes();
  const { authorizationUrl, codeVerifier } = await startAuthorization(authServerBaseUrl(discovery), {
    metadata: md,
    clientInformation: clientInfo,
    redirectUrl: new URL(redirectUri),
    resource,
    state,
    scope,
  });

  const pkceSeal = sealGleanCookiePayload(
    { state, codeVerifier, returnTo, dc, connectAll: connectAll ? 1 : 0 },
    supportdogOAuthCookieSecret()
  );
  return { authorizeUrl: authorizationUrl.toString(), pkceSeal, dcrClientSeal: null };
}

/**
 * @param {Request} request
 * @param {string} code
 * @param {{ state: string; codeVerifier: string; datacenter: string }} pkce
 */
export async function supportdogOAuthExchangeForCode(request, code, pkce) {
  let redirectUri;
  try {
    redirectUri = resolveSupportdogOAuthRedirectUri(request);
  } catch {
    return { error: "missing_redirect_uri" };
  }
  if (!pkce?.codeVerifier) return { error: "state_mismatch" };

  const dc = normalizeSupportdogDatacenter(pkce.datacenter) || "US1";
  const clientInfo = readSupportdogDcrClient(request, dc) || getSupportdogMcpCommonClient();

  const discovery = await getSupportdogOAuthDiscovery(dc);
  if (!discovery?.authorizationServerMetadata) return { error: "metadata_unavailable" };

  const resource = resourceUrlFromDiscovery(discovery.resourceMetadata);

  let tokens;
  try {
    tokens = await exchangeAuthorization(authServerBaseUrl(discovery), {
      metadata: discovery.authorizationServerMetadata,
      clientInformation: clientInfo,
      authorizationCode: code,
      codeVerifier: pkce.codeVerifier,
      redirectUri: new URL(redirectUri),
      resource,
      fetchFn: fetch,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg.slice(0, 400) };
  }

  const refresh_token = typeof tokens.refresh_token === "string" ? tokens.refresh_token : "";
  const access_token = typeof tokens.access_token === "string" ? tokens.access_token : "";
  if (!access_token) return { error: "token_response_missing_access" };

  if (!refresh_token) {
    const expires_in = typeof tokens.expires_in === "number" ? tokens.expires_in : 3600;
    const exp = Date.now() + Math.max(60, expires_in) * 1000;
    const sessionSeal = sealSupportdogDcSession({ rt: access_token, exp });
    return {
      sessionSeal,
      datacenter: dc,
      accessOnly: true,
    };
  }

  const sessionSeal = sealSupportdogSession(tokens, refresh_token, dc);
  return { sessionSeal, datacenter: dc };
}

/**
 * @param {Request} request
 * @param {{ rt: string; at: string; exp: number; dc?: string }} session
 */
export async function refreshSupportdogAccessToken(request, session) {
  const dc = normalizeSupportdogDatacenter(session.dc) || "US1";
  const client = readSupportdogDcrClient(request, dc) || getSupportdogMcpCommonClient();

  const discovery = await getSupportdogOAuthDiscovery(dc);
  if (!discovery?.authorizationServerMetadata) return null;

  const resource = resourceUrlFromDiscovery(discovery.resourceMetadata);

  let newTokens;
  try {
    newTokens = await refreshAuthorization(authServerBaseUrl(discovery), {
      metadata: discovery.authorizationServerMetadata,
      clientInformation: client,
      refreshToken: session.rt,
      resource,
      fetchFn: fetch,
    });
  } catch {
    return null;
  }

  const access_token = typeof newTokens.access_token === "string" ? newTokens.access_token : "";
  if (!access_token) return null;

  const sessionSeal = sealSupportdogSession(newTokens, session.rt, dc);
  return { accessToken: access_token, newSessionSeal: sessionSeal };
}
