import { randomBytes } from "node:crypto";
import {
  discoverOAuthServerInfo,
  exchangeAuthorization,
  refreshAuthorization,
  registerClient,
  startAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { gleanMcpEndpointUrl } from "@/lib/gleanBackendUrl";
import {
  buildSessionPayloadFromTokenResponse,
  gleanOAuthCookieSecret,
  readDcrClientFromRequest,
  resolveGleanOAuthScopes,
  sealDcrClientPayload,
  sealGleanCookiePayload,
} from "@/lib/gleanOAuthSession";

/** @type {unknown} */
let authorizationServerMetadataCache = null;
/** @type {{ authorizationServerUrl: string, resourceMetadata?: unknown } | null} */
let discoveryEnvelopeCache = null;
let discoveryCacheAt = 0;

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

/**
 * Cached MCP → authorization server + protected resource metadata (RFC 9728 / 8414).
 */
async function getOAuthDiscovery() {
  const now = Date.now();
  if (
    discoveryEnvelopeCache &&
    authorizationServerMetadataCache &&
    now - discoveryCacheAt < 300_000
  ) {
    return {
      ...discoveryEnvelopeCache,
      authorizationServerMetadata: authorizationServerMetadataCache,
    };
  }
  const mcpUrl = gleanMcpEndpointUrl();
  if (!mcpUrl) return null;
  const serverInfo = await discoverOAuthServerInfo(new URL(mcpUrl), { fetchFn: fetch });
  if (!serverInfo?.authorizationServerMetadata) return null;
  authorizationServerMetadataCache = serverInfo.authorizationServerMetadata;
  discoveryEnvelopeCache = {
    authorizationServerUrl: String(serverInfo.authorizationServerUrl),
    resourceMetadata: serverInfo.resourceMetadata,
  };
  discoveryCacheAt = now;
  return {
    ...discoveryEnvelopeCache,
    authorizationServerMetadata: authorizationServerMetadataCache,
  };
}

/**
 * @param {{ authorizationServerUrl: string }} discovery
 */
function authServerBaseUrl(discovery) {
  return new URL(discovery.authorizationServerUrl);
}

/**
 * @param {unknown} rm
 * @returns {URL | undefined}
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
 * PKCE authorize URL + optional new DCR client cookie (first visit only).
 * @param {Request} request
 * @param {string} returnTo
 * @returns {Promise<{ authorizeUrl: string, pkceSeal: string, dcrClientSeal: string | null }>}
 */
export async function gleanOAuthDcrBuildAuthorizeRedirect(request, returnTo) {
  const redirectUri = process.env.GLEAN_OAUTH_REDIRECT_URI?.trim();
  if (!redirectUri) throw new Error("GLEAN_OAUTH_REDIRECT_URI is required.");

  const discovery = await getOAuthDiscovery();
  if (!discovery?.authorizationServerMetadata) {
    throw new Error("Could not discover Glean OAuth metadata from the MCP URL.");
  }
  const md = discovery.authorizationServerMetadata;
  if (!md.registration_endpoint) {
    throw new Error("This Glean tenant does not advertise OAuth dynamic client registration (RFC 7591).");
  }

  let clientInfo = readDcrClientFromRequest(request);
  let dcrClientSeal = null;
  const scopeString = await resolveGleanOAuthScopes();

  if (!clientInfo) {
    clientInfo = await registerClient(authServerBaseUrl(discovery), {
      metadata: md,
      clientMetadata: {
        client_name: "pal-portfolio",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
      scope: scopeString,
      fetchFn: fetch,
    });
    dcrClientSeal = sealDcrClientPayload(clientInfo);
  }

  const state = b64url(randomBytes(32));
  const resource = resourceUrlFromDiscovery(discovery.resourceMetadata);
  const { authorizationUrl, codeVerifier } = await startAuthorization(authServerBaseUrl(discovery), {
    metadata: md,
    clientInformation: clientInfo,
    redirectUrl: new URL(redirectUri),
    scope: scopeString,
    resource,
    state,
  });

  const pkceSeal = sealGleanCookiePayload({ state, codeVerifier, returnTo }, gleanOAuthCookieSecret());
  return { authorizeUrl: authorizationUrl.toString(), pkceSeal, dcrClientSeal };
}

/**
 * @param {Request} request
 * @param {string} code
 * @param {{ state: string, codeVerifier: string, returnTo?: string }} pkce
 * @returns {Promise<{ sessionSeal: string } | { error: string }>}
 */
export async function gleanOAuthDcrExchangeForCode(request, code, pkce) {
  const redirectUri = process.env.GLEAN_OAUTH_REDIRECT_URI?.trim();
  if (!redirectUri) return { error: "missing_redirect_uri" };

  if (!pkce?.codeVerifier) return { error: "state_mismatch" };

  const clientInfo = readDcrClientFromRequest(request);
  if (!clientInfo) return { error: "missing_dcr_client_cookie" };

  const discovery = await getOAuthDiscovery();
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
  if (!access_token || !refresh_token) return { error: "token_response_missing_refresh_or_access" };

  const payload = buildSessionPayloadFromTokenResponse(tokens, refresh_token);
  const sessionSeal = sealGleanCookiePayload(payload, gleanOAuthCookieSecret());
  return { sessionSeal };
}

/**
 * @param {Request} request
 * @param {{ rt: string, at: string, exp: number }} session
 * @returns {Promise<{ accessToken: string, newSessionSeal?: string } | null>}
 */
export async function refreshGleanOAuthAccessTokenWithDcr(request, session) {
  const client = readDcrClientFromRequest(request);
  if (!client) return null;

  const discovery = await getOAuthDiscovery();
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

  const payload = buildSessionPayloadFromTokenResponse(newTokens, session.rt);
  const seal = sealGleanCookiePayload(payload, gleanOAuthCookieSecret());
  return { accessToken: access_token, newSessionSeal: seal };
}
