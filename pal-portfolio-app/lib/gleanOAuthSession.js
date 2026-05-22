import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { gleanBackendBaseUrl, gleanMcpEndpointUrl } from "@/lib/gleanBackendUrl";

const ALGO = "aes-256-gcm";
const IV_LEN = 16;
const AUTH_TAG_LEN = 16;

export const GLEAN_SESSION_COOKIE = "pp_glean_oauth_sess";
export const GLEAN_PKCE_COOKIE = "pp_glean_oauth_pkce";
export const GLEAN_DCR_CLIENT_COOKIE = "pp_glean_oauth_dcr";

/** @returns {Buffer} */
function deriveKey(secret) {
  return createHash("sha256").update(String(secret), "utf8").digest();
}

/**
 * @param {Record<string, unknown>} payload
 * @param {string} secret
 */
export function sealGleanCookiePayload(payload, secret) {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: AUTH_TAG_LEN });
  const json = JSON.stringify(payload);
  const enc = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

/**
 * @param {string} b64url
 * @param {string} secret
 * @returns {Record<string, unknown> | null}
 */
export function unsealGleanCookiePayload(b64url, secret) {
  try {
    const buf = Buffer.from(b64url, "base64url");
    if (buf.length < IV_LEN + AUTH_TAG_LEN + 2) return null;
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + AUTH_TAG_LEN);
    const enc = buf.subarray(IV_LEN + AUTH_TAG_LEN);
    const key = deriveKey(secret);
    const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: AUTH_TAG_LEN });
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
    const o = JSON.parse(dec);
    return o && typeof o === "object" ? o : null;
  } catch {
    return null;
  }
}

export function gleanOAuthCookieSecret() {
  return process.env.GLEAN_OAUTH_COOKIE_SECRET?.trim() || "";
}

export function isGleanOAuthLegacyConfigured() {
  return Boolean(
    gleanBackendBaseUrl() &&
      process.env.GLEAN_OAUTH_CLIENT_ID?.trim() &&
      process.env.GLEAN_OAUTH_CLIENT_SECRET?.trim() &&
      process.env.GLEAN_OAUTH_REDIRECT_URI?.trim() &&
      gleanOAuthCookieSecret().length >= 16
  );
}

/**
 * SSO without a pre-provisioned OAuth app: dynamic client registration (RFC 7591)
 * against the authorization server discovered from the Glean MCP URL — same idea as Claude Code.
 */
export function isGleanOAuthDcrConfigured() {
  return Boolean(
    gleanBackendBaseUrl() &&
      gleanMcpEndpointUrl() &&
      process.env.GLEAN_OAUTH_REDIRECT_URI?.trim() &&
      gleanOAuthCookieSecret().length >= 16 &&
      !process.env.GLEAN_OAUTH_CLIENT_ID?.trim()
  );
}

export function isGleanOAuthEnvConfigured() {
  return isGleanOAuthLegacyConfigured() || isGleanOAuthDcrConfigured();
}

/** @type {{ authorization_endpoint: string, token_endpoint: string } | null} */
let metadataCache = null;
let metadataCacheAt = 0;

/**
 * @returns {Promise<{ authorization_endpoint: string, token_endpoint: string } | null>}
 */
export async function fetchGleanOAuthMetadata() {
  const base = gleanBackendBaseUrl();
  if (!base) return null;
  const now = Date.now();
  if (metadataCache && now - metadataCacheAt < 300_000) return metadataCache;
  try {
    const res = await fetch(`${base}/.well-known/oauth-authorization-server`, { cache: "no-store" });
    if (!res.ok) return null;
    const j = await res.json();
    if (!j || typeof j !== "object") return null;
    const authz = typeof j.authorization_endpoint === "string" ? j.authorization_endpoint : "";
    const token = typeof j.token_endpoint === "string" ? j.token_endpoint : "";
    if (!authz || !token) return null;
    metadataCache = { authorization_endpoint: authz, token_endpoint: token };
    metadataCacheAt = now;
    return metadataCache;
  } catch {
    return null;
  }
}

/**
 * @param {string} cookieHeader
 * @returns {string | null}
 */
function getCookieValue(cookieHeader, name) {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";").map((s) => s.trim());
  const prefix = `${name}=`;
  for (const p of parts) {
    if (p.startsWith(prefix)) return decodeURIComponent(p.slice(prefix.length));
  }
  return null;
}

/**
 * @param {Request} request
 */
export function readSessionFromRequest(request) {
  const secret = gleanOAuthCookieSecret();
  if (!secret) return null;
  const raw = getCookieValue(request.headers.get("cookie") || "", GLEAN_SESSION_COOKIE);
  if (!raw) return null;
  const data = unsealGleanCookiePayload(raw, secret);
  if (!data || data.v !== 1) return null;
  const rt = typeof data.rt === "string" ? data.rt : "";
  const at = typeof data.at === "string" ? data.at : "";
  const exp = typeof data.exp === "number" ? data.exp : 0;
  if (!rt) return null;
  return { rt, at, exp };
}

/**
 * @param {Request} request
 * @returns {Record<string, unknown> | null}
 */
export function readDcrClientFromRequest(request) {
  const secret = gleanOAuthCookieSecret();
  if (!secret) return null;
  const raw = getCookieValue(request.headers.get("cookie") || "", GLEAN_DCR_CLIENT_COOKIE);
  if (!raw) return null;
  const data = unsealGleanCookiePayload(raw, secret);
  if (!data || data.v !== 2) return null;
  const client = data.client;
  if (!client || typeof client !== "object" || typeof client.client_id !== "string") return null;
  return /** @type {Record<string, unknown>} */ (client);
}

/**
 * @param {Record<string, unknown>} client
 * @returns {string}
 */
export function sealDcrClientPayload(client) {
  return sealGleanCookiePayload({ v: 2, client }, gleanOAuthCookieSecret());
}

/**
 * @param {import('next/server').NextResponse} res
 * @param {string} sealedPayload
 */
export function attachGleanDcrClientCookie(res, sealedPayload) {
  res.cookies.set(GLEAN_DCR_CLIENT_COOKIE, sealedPayload, {
    ...cookieBaseOptions(),
    maxAge: 60 * 60 * 24 * 400,
  });
}

/**
 * @param {object} tok
 * @param {string} tok.access_token
 * @param {string} [tok.refresh_token]
 * @param {number} [tok.expires_in]
 * @param {string} existingRt
 */
export function buildSessionPayloadFromTokenResponse(tok, existingRt) {
  const access_token = typeof tok.access_token === "string" ? tok.access_token : "";
  const refresh_token = typeof tok.refresh_token === "string" && tok.refresh_token ? tok.refresh_token : existingRt;
  const expires_in = typeof tok.expires_in === "number" ? tok.expires_in : 3600;
  const exp = Date.now() + Math.max(60, expires_in) * 1000;
  return { v: 1, rt: refresh_token, at: access_token, exp };
}

/**
 * @param {Request} request
 * @returns {Promise<{ accessToken: string, newSessionSeal?: string } | null>}
 */
export async function resolveGleanOAuthAccessToken(request) {
  if (!isGleanOAuthEnvConfigured()) return null;

  const session = readSessionFromRequest(request);
  if (!session) return null;

  const skewMs = 120_000;
  if (session.at && session.exp > Date.now() + skewMs) {
    return { accessToken: session.at };
  }

  if (isGleanOAuthDcrConfigured()) {
    const { refreshGleanOAuthAccessTokenWithDcr } = await import("@/lib/gleanOAuthDcr.js");
    return refreshGleanOAuthAccessTokenWithDcr(request, session);
  }

  const meta = await fetchGleanOAuthMetadata();
  if (!meta) return null;

  const clientId = process.env.GLEAN_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GLEAN_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: session.rt,
    client_id: clientId,
    client_secret: clientSecret,
  });

  let res;
  try {
    res = await fetch(meta.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      cache: "no-store",
    });
  } catch {
    return null;
  }

  const raw = await res.text();
  let json;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    return null;
  }
  if (!res.ok || !json || typeof json !== "object") return null;

  const access_token = typeof json.access_token === "string" ? json.access_token : "";
  if (!access_token) return null;

  const payload = buildSessionPayloadFromTokenResponse(json, session.rt);
  const seal = sealGleanCookiePayload(payload, gleanOAuthCookieSecret());
  return { accessToken: access_token, newSessionSeal: seal };
}

/**
 * Scopes we want for search, chat, indexed documents (getdocuments), MCP tools (read_document), and refresh.
 * Must match names in `/.well-known/oauth-authorization-server` → `scopes_supported` (Glean uses lowercase).
 */
const GLEAN_OAUTH_SCOPE_PREFERENCE = [
  "openid",
  "offline_access",
  "search",
  "chat",
  "documents",
  "tools",
  "mcp",
];

/** @type {string | null} */
let resolvedOAuthScopesCache = null;
let resolvedOAuthScopesCacheAt = 0;

/**
 * Space-separated OAuth scope string for authorize + DCR.
 * - If `GLEAN_OAUTH_SCOPES` is set, uses it verbatim.
 * - Else loads `scopes_supported` from the tenant AS metadata and requests the intersection with
 *   {@link GLEAN_OAUTH_SCOPE_PREFERENCE} (preserving server spelling). Falls back to the preference list
 *   joined if discovery fails.
 */
export async function resolveGleanOAuthScopes() {
  const fromEnv = process.env.GLEAN_OAUTH_SCOPES?.trim();
  if (fromEnv) return fromEnv;

  const base = gleanBackendBaseUrl();
  const fallback = GLEAN_OAUTH_SCOPE_PREFERENCE.join(" ");
  if (!base) return fallback;

  const now = Date.now();
  if (resolvedOAuthScopesCache && now - resolvedOAuthScopesCacheAt < 300_000) {
    return resolvedOAuthScopesCache;
  }

  let resolved = fallback;
  try {
    const res = await fetch(`${base}/.well-known/oauth-authorization-server`, { cache: "no-store" });
    if (res.ok) {
      const j = await res.json();
      const supported = Array.isArray(j?.scopes_supported) ? j.scopes_supported.map((x) => String(x)) : [];
      const picked = [];
      for (const want of GLEAN_OAUTH_SCOPE_PREFERENCE) {
        const hit = supported.find((s) => s.toLowerCase() === want);
        if (hit) picked.push(hit);
      }
      if (picked.length) resolved = picked.join(" ");
    }
  } catch {
    /* use fallback */
  }

  resolvedOAuthScopesCache = resolved;
  resolvedOAuthScopesCacheAt = now;
  return resolved;
}

function cookieBaseOptions() {
  const secure = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
  };
}

/**
 * @param {import('next/server').NextResponse} res
 * @param {string} sealedPayload
 */
export function attachGleanSessionCookie(res, sealedPayload) {
  res.cookies.set(GLEAN_SESSION_COOKIE, sealedPayload, {
    ...cookieBaseOptions(),
    maxAge: 60 * 60 * 24 * 180,
  });
}

export function clearGleanDcrClientCookie(res) {
  res.cookies.set(GLEAN_DCR_CLIENT_COOKIE, "", { ...cookieBaseOptions(), maxAge: 0 });
}

/**
 * @param {import('next/server').NextResponse} res
 */
export function clearGleanOAuthCookies(res) {
  res.cookies.set(GLEAN_SESSION_COOKIE, "", { ...cookieBaseOptions(), maxAge: 0 });
  clearGleanPkceCookie(res);
  clearGleanDcrClientCookie(res);
}

/**
 * @param {import('next/server').NextResponse} res
 * @param {string} sealedPkce
 */
export function attachGleanPkceCookie(res, sealedPkce) {
  res.cookies.set(GLEAN_PKCE_COOKIE, sealedPkce, {
    ...cookieBaseOptions(),
    maxAge: 600,
  });
}

/**
 * @param {Request} request
 * @returns {{ state: string, codeVerifier: string, returnTo?: string } | null}
 */
export function readPkceFromRequest(request) {
  const secret = gleanOAuthCookieSecret();
  if (!secret) return null;
  const raw = getCookieValue(request.headers.get("cookie") || "", GLEAN_PKCE_COOKIE);
  if (!raw) return null;
  const data = unsealGleanCookiePayload(raw, secret);
  if (!data) return null;
  const state = typeof data.state === "string" ? data.state : "";
  const codeVerifier = typeof data.codeVerifier === "string" ? data.codeVerifier : "";
  if (!state || !codeVerifier) return null;
  const returnTo = typeof data.returnTo === "string" ? data.returnTo : "/";
  return { state, codeVerifier, returnTo };
}

/**
 * @param {import('next/server').NextResponse} res
 */
export function clearGleanPkceCookie(res) {
  res.cookies.set(GLEAN_PKCE_COOKIE, "", { ...cookieBaseOptions(), maxAge: 0 });
}

export { cookieBaseOptions };
