import {
  buildSessionPayloadFromTokenResponse,
  sealGleanCookiePayload,
  unsealGleanCookiePayload,
} from "@/lib/gleanOAuthSession";
import { normalizeSupportdogDatacenter, SUPPORTDOG_DATACENTERS } from "@/lib/supportdogDatacenter";

/** Legacy combined cookie (too large for 6 regions — migrated to per-DC cookies). */
export const SUPPORTDOG_SESSION_COOKIE = "pp_supportdog_oauth_sess";
export const SUPPORTDOG_SESSION_COOKIE_PREFIX = "pp_sd_sess_";
export const SUPPORTDOG_PKCE_COOKIE = "pp_supportdog_oauth_pkce";
export const SUPPORTDOG_DCR_COOKIE = "pp_supportdog_oauth_dcr";

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
};

/** @typedef {{ at: string; rt: string; exp: number; expired?: boolean }} SupportdogDcSession */

export function supportdogOAuthCookieSecret() {
  return (
    process.env.SUPPORTDOG_OAUTH_COOKIE_SECRET?.trim() ||
    process.env.GLEAN_OAUTH_COOKIE_SECRET?.trim() ||
    ""
  );
}

export function isSupportdogOAuthConfigured() {
  return supportdogOAuthCookieSecret().length >= 16;
}

/**
 * @param {string} datacenter
 * @returns {string | null}
 */
export function supportdogSessionCookieName(datacenter) {
  const dc = normalizeSupportdogDatacenter(datacenter);
  if (!dc) return null;
  return `${SUPPORTDOG_SESSION_COOKIE_PREFIX}${dc.toLowerCase()}`;
}

/**
 * @param {string} cookieHeader
 * @param {string} name
 */
function getCookieValue(cookieHeader, name) {
  if (!cookieHeader) return null;
  const prefix = `${name}=`;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      try {
        return decodeURIComponent(trimmed.slice(prefix.length));
      } catch {
        return trimmed.slice(prefix.length);
      }
    }
  }
  return null;
}

/**
 * @param {Record<string, unknown> | null} payload
 * @returns {SupportdogDcSession | null}
 */
export function entryFromSessionPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const rt = typeof payload.rt === "string" ? payload.rt : "";
  if (!rt) return null;
  const at = typeof payload.at === "string" ? payload.at : "";
  const exp = typeof payload.exp === "number" ? payload.exp : 0;
  return { at, rt, exp };
}

/** Drop access tokens from cookie payload (JWTs cause HTTP 431 when × N regions). */
export function compactSupportdogSessionEntry(entry) {
  if (!entry?.rt) return null;
  return { rt: entry.rt, exp: entry.exp || 0 };
}

/** Per-DC cookie larger than this is legacy (JWT access token) — compact on repair. */
const OVERSIZED_SESSION_COOKIE_CHARS = 1200;

/** Total SupportDog cookie bytes above this triggers a full clear (HTTP 431 prevention). */
const MAX_SUPPORTDOG_COOKIE_BYTES = 6000;

/**
 * @param {string} cookieHeader
 */
function supportdogCookieHeaderBytes(cookieHeader) {
  if (!cookieHeader) return 0;
  let bytes = 0;
  const names = [
    SUPPORTDOG_SESSION_COOKIE,
    SUPPORTDOG_PKCE_COOKIE,
    SUPPORTDOG_DCR_COOKIE,
    ...SUPPORTDOG_DATACENTERS.map((dc) => supportdogSessionCookieName(dc)).filter(Boolean),
  ];
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    for (const name of names) {
      if (trimmed.startsWith(`${name}=`)) bytes += trimmed.length;
    }
  }
  return bytes;
}

/**
 * @param {Record<string, unknown> | null} payload
 */
function sessionPayloadNeedsCompact(payload) {
  if (!payload || typeof payload !== "object") return false;
  const at = typeof payload.at === "string" ? payload.at : "";
  return at.length > 80;
}

/**
 * @param {Record<string, unknown> | null} payload
 * @returns {Record<string, SupportdogDcSession>}
 */
export function parseSupportdogSessionsMap(payload) {
  if (!payload || typeof payload !== "object") return {};

  if (payload.sessions && typeof payload.sessions === "object" && !Array.isArray(payload.sessions)) {
    /** @type {Record<string, SupportdogDcSession>} */
    const out = {};
    for (const [key, val] of Object.entries(/** @type {Record<string, unknown>} */ (payload.sessions))) {
      const dc = normalizeSupportdogDatacenter(key);
      if (!dc || !val || typeof val !== "object") continue;
      const entry = entryFromSessionPayload(/** @type {Record<string, unknown>} */ (val));
      if (entry) out[dc] = entry;
    }
    return out;
  }

  const single = entryFromSessionPayload(payload);
  if (!single) return {};
  const dc = normalizeSupportdogDatacenter(typeof payload.dc === "string" ? payload.dc : null) || "US1";
  return { [dc]: single };
}

/**
 * @param {Request | null | undefined} request
 */
function readLegacySealedSessionPayload(request) {
  const secret = supportdogOAuthCookieSecret();
  if (!secret) return null;
  const raw = getCookieValue(request?.headers?.get("cookie") || "", SUPPORTDOG_SESSION_COOKIE);
  if (!raw) return null;
  return unsealGleanCookiePayload(raw, secret);
}

/**
 * @param {Request | null | undefined} request
 * @returns {Record<string, SupportdogDcSession>}
 */
/**
 * Move legacy combined cookie into per-DC cookies (one-time migration).
 * @param {import("next/server").NextResponse} res
 * @param {Request} request
 */
export function migrateLegacySupportdogSessionCookie(res, request) {
  reconcileSupportdogSessionCookies(res, request);
}

/**
 * Rewrite per-DC session cookies without access tokens (fixes HTTP 431 on OAuth callbacks).
 * @param {import("next/server").NextResponse} res
 * @param {Request | null | undefined} request
 */
export function compactSupportdogSessionCookies(res, request) {
  reconcileSupportdogSessionCookies(res, request);
}

/**
 * Migrate legacy blobs, compact refresh-only cookies, drop junk DCR/legacy cookies.
 * Run on status/start/callback so users never need to clear browser site data manually.
 *
 * @param {import("next/server").NextResponse} res
 * @param {Request | null | undefined} request
 * @returns {{ map: Record<string, SupportdogDcSession>; repaired: boolean; clearedAll: boolean }}
 */
export function reconcileSupportdogSessionCookies(res, request) {
  const secret = supportdogOAuthCookieSecret();
  const empty = { map: {}, repaired: false, clearedAll: false };
  if (!secret) return empty;

  const cookieHeader = request?.headers?.get("cookie") || "";
  const hadLegacy = Boolean(getCookieValue(cookieHeader, SUPPORTDOG_SESSION_COOKIE));
  const hadDcr = Boolean(getCookieValue(cookieHeader, SUPPORTDOG_DCR_COOKIE));
  const cookieBytes = supportdogCookieHeaderBytes(cookieHeader);

  if (cookieBytes > MAX_SUPPORTDOG_COOKIE_BYTES) {
    clearSupportdogOAuthCookies(res);
    res.cookies.set(SUPPORTDOG_DCR_COOKIE, "", { ...COOKIE_OPTS, maxAge: 0 });
    return { map: {}, repaired: true, clearedAll: true };
  }

  /** @type {Record<string, SupportdogDcSession>} */
  const map = {};
  let hadOversizedPerDc = false;

  for (const dc of SUPPORTDOG_DATACENTERS) {
    const name = supportdogSessionCookieName(dc);
    if (!name) continue;
    const raw = getCookieValue(cookieHeader, name);
    if (!raw) continue;
    if (raw.length > OVERSIZED_SESSION_COOKIE_CHARS) hadOversizedPerDc = true;
    const payload = unsealGleanCookiePayload(raw, secret);
    if (sessionPayloadNeedsCompact(payload)) hadOversizedPerDc = true;
    const entry = entryFromSessionPayload(payload);
    if (!entry) continue;
    const compact = compactSupportdogSessionEntry(entry);
    if (compact) map[dc] = compact;
  }

  const hasPerDc = Object.keys(map).length > 0;
  if (!hasPerDc && hadLegacy) {
    const legacyMap = parseSupportdogSessionsMap(readLegacySealedSessionPayload(request));
    for (const [dc, entry] of Object.entries(legacyMap)) {
      const compact = compactSupportdogSessionEntry(entry);
      if (compact) map[dc] = compact;
    }
  }

  const repaired = hadLegacy || hadDcr || hadOversizedPerDc;

  if (Object.keys(map).length > 0) {
    syncSupportdogSessionCookies(res, map);
    res.cookies.set(SUPPORTDOG_DCR_COOKIE, "", { ...COOKIE_OPTS, maxAge: 0 });
  } else if (repaired) {
    syncSupportdogSessionCookies(res, {});
    res.cookies.set(SUPPORTDOG_DCR_COOKIE, "", { ...COOKIE_OPTS, maxAge: 0 });
  }

  return { map, repaired, clearedAll: false };
}

export function readSupportdogSessionsMap(request) {
  const secret = supportdogOAuthCookieSecret();
  if (!secret) return {};

  /** @type {Record<string, SupportdogDcSession>} */
  const map = parseSupportdogSessionsMap(readLegacySealedSessionPayload(request));

  const cookieHeader = request?.headers?.get("cookie") || "";
  for (const dc of SUPPORTDOG_DATACENTERS) {
    const name = supportdogSessionCookieName(dc);
    if (!name) continue;
    const raw = getCookieValue(cookieHeader, name);
    if (!raw) continue;
    const entry = entryFromSessionPayload(unsealGleanCookiePayload(raw, secret));
    if (entry?.rt) map[dc] = entry;
  }

  return map;
}

/**
 * @param {SupportdogDcSession} entry
 */
export function sealSupportdogDcSession(entry) {
  const compact = compactSupportdogSessionEntry(entry);
  if (!compact) return "";
  return sealGleanCookiePayload(compact, supportdogOAuthCookieSecret());
}

/**
 * @param {SupportdogDcSession} entry
 * @param {import("next/server").NextResponse} res
 * @param {string} datacenter
 */
export function attachSupportdogSessionForDatacenter(res, seal, datacenter) {
  const name = supportdogSessionCookieName(datacenter);
  if (!name || !seal) return;
  res.cookies.set(name, seal, { ...COOKIE_OPTS, maxAge: 60 * 60 * 24 * 30 });
}

/**
 * Merge a freshly exchanged/refreshed seal into the session map (request cookies + new DC).
 * @param {Request | null | undefined} request
 * @param {string | null | undefined} datacenter
 * @param {string | null | undefined} sessionSeal
 * @returns {Record<string, SupportdogDcSession>}
 */
export function mergeSupportdogSessionSealIntoMap(request, datacenter, sessionSeal) {
  const map = readSupportdogSessionsMap(request);
  const dc = normalizeSupportdogDatacenter(datacenter);
  const secret = supportdogOAuthCookieSecret();
  if (!secret || !dc || !sessionSeal) return map;
  const entry = entryFromSessionPayload(unsealGleanCookiePayload(sessionSeal, secret));
  if (entry?.rt) map[dc] = entry;
  return map;
}

/**
 * Write all per-DC session cookies from a map (use after mergeSupportdogSessionSealIntoMap).
 * @param {import("next/server").NextResponse} res
 * @param {Record<string, SupportdogDcSession>} sessionsMap
 */
export function persistSupportdogSessionsMap(res, sessionsMap) {
  syncSupportdogSessionCookies(res, sessionsMap);
  res.cookies.set(SUPPORTDOG_SESSION_COOKIE, "", { ...COOKIE_OPTS, maxAge: 0 });
  res.cookies.set(SUPPORTDOG_DCR_COOKIE, "", { ...COOKIE_OPTS, maxAge: 0 });
}

/**
 * Write one cookie per signed-in region (avoids 4KB combined-cookie limit).
 * @param {import("next/server").NextResponse} res
 * @param {Record<string, SupportdogDcSession>} sessionsMap
 */
export function syncSupportdogSessionCookies(res, sessionsMap) {
  for (const dc of SUPPORTDOG_DATACENTERS) {
    const name = supportdogSessionCookieName(dc);
    if (!name) continue;
    const entry = sessionsMap[dc];
    if (entry?.rt) {
      res.cookies.set(name, sealSupportdogDcSession(entry), { ...COOKIE_OPTS, maxAge: 60 * 60 * 24 * 30 });
    } else {
      res.cookies.set(name, "", { ...COOKIE_OPTS, maxAge: 0 });
    }
  }
  res.cookies.set(SUPPORTDOG_SESSION_COOKIE, "", { ...COOKIE_OPTS, maxAge: 0 });
}

/**
 * @param {import("next/server").NextResponse} res
 * @param {string} seal
 * @param {string | null | undefined} [datacenter]
 */
export function attachSupportdogSessionCookie(res, seal, datacenter) {
  const dc = normalizeSupportdogDatacenter(datacenter);
  if (dc) {
    attachSupportdogSessionForDatacenter(res, seal, dc);
    return;
  }
  res.cookies.set(SUPPORTDOG_SESSION_COOKIE, seal, { ...COOKIE_OPTS, maxAge: 60 * 60 * 24 * 30 });
}

/**
 * @param {SupportdogDcSession} entry
 */
function withExpiryFlag(entry) {
  const skewMs = 60_000;
  if (entry.exp && Date.now() > entry.exp - skewMs) {
    return { ...entry, expired: true };
  }
  return entry;
}

/**
 * @param {Request | null | undefined} request
 * @param {string | null | undefined} datacenter
 * @returns {(SupportdogDcSession & { dc?: string }) | null}
 */
export function readSupportdogSession(request, datacenter) {
  const dc = normalizeSupportdogDatacenter(datacenter);
  if (!dc) return null;
  const map = readSupportdogSessionsMap(request);
  const entry = map[dc];
  if (!entry?.rt) return null;
  return { ...withExpiryFlag(entry), dc };
}

/**
 * @param {Request | null | undefined} request
 * @returns {string[]}
 */
export function listSupportdogSignedInDatacenters(request) {
  const map = readSupportdogSessionsMap(request);
  return SUPPORTDOG_DATACENTERS.filter((dc) => {
    const s = map[dc];
    return Boolean(s?.rt && !withExpiryFlag(s).expired);
  });
}

/**
 * @param {import("next/server").NextResponse} res
 * @param {string} seal
 */
export function attachSupportdogPkceCookie(res, seal) {
  res.cookies.set(SUPPORTDOG_PKCE_COOKIE, seal, { ...COOKIE_OPTS, maxAge: 600 });
}

/**
 * @param {import("next/server").NextResponse} res
 * @param {string} seal
 */
export function attachSupportdogDcrCookie(res, seal) {
  res.cookies.set(SUPPORTDOG_DCR_COOKIE, seal, { ...COOKIE_OPTS, maxAge: 60 * 60 * 24 * 90 });
}

/**
 * @param {import("next/server").NextResponse} res
 */
export function clearSupportdogPkceCookie(res) {
  res.cookies.set(SUPPORTDOG_PKCE_COOKIE, "", { ...COOKIE_OPTS, maxAge: 0 });
}

/**
 * @param {import("next/server").NextResponse} res
 */
export function clearSupportdogOAuthCookies(res) {
  res.cookies.set(SUPPORTDOG_SESSION_COOKIE, "", { ...COOKIE_OPTS, maxAge: 0 });
  for (const dc of SUPPORTDOG_DATACENTERS) {
    const name = supportdogSessionCookieName(dc);
    if (name) res.cookies.set(name, "", { ...COOKIE_OPTS, maxAge: 0 });
  }
  clearSupportdogPkceCookie(res);
}

/**
 * @param {import("next/server").NextResponse} res
 * @param {Request} request
 * @param {string | null | undefined} datacenter
 */
export function clearSupportdogDatacenterAuth(res, request, datacenter) {
  const dc = normalizeSupportdogDatacenter(datacenter);
  if (!dc) return;

  const name = supportdogSessionCookieName(dc);
  if (name) res.cookies.set(name, "", { ...COOKIE_OPTS, maxAge: 0 });

  const secret = supportdogOAuthCookieSecret();
  if (!secret) return;

  const sessions = readSupportdogSessionsMap(request);
  delete sessions[dc];
  if (Object.keys(sessions).length === 0) {
    res.cookies.set(SUPPORTDOG_SESSION_COOKIE, "", { ...COOKIE_OPTS, maxAge: 0 });
  } else {
    syncSupportdogSessionCookies(res, sessions);
  }

  const dcrRaw = getCookieValue(request.headers.get("cookie") || "", SUPPORTDOG_DCR_COOKIE);
  if (dcrRaw) {
    const dcrPayload = unsealGleanCookiePayload(dcrRaw, secret);
    if (dcrPayload && typeof dcrPayload === "object") {
      const next = { ...dcrPayload };
      delete next[dc];
      if (Object.keys(next).length > 0) {
        attachSupportdogDcrCookie(res, sealGleanCookiePayload(next, secret));
      } else {
        res.cookies.set(SUPPORTDOG_DCR_COOKIE, "", { ...COOKIE_OPTS, maxAge: 0 });
      }
    }
  }
}

/**
 * @param {Request | null | undefined} request
 */
export function readSupportdogPkce(request) {
  const secret = supportdogOAuthCookieSecret();
  if (!secret) return null;
  const raw = getCookieValue(request?.headers?.get("cookie") || "", SUPPORTDOG_PKCE_COOKIE);
  if (!raw) return null;
  const o = unsealGleanCookiePayload(raw, secret);
  if (!o || typeof o.state !== "string" || typeof o.codeVerifier !== "string") return null;
  return {
    state: o.state,
    codeVerifier: o.codeVerifier,
    returnTo: typeof o.returnTo === "string" ? o.returnTo : "/",
    datacenter: normalizeSupportdogDatacenter(typeof o.dc === "string" ? o.dc : null) || "US1",
    connectAll: Boolean(o.connectAll),
  };
}

/**
 * @param {Request | null | undefined} request
 */
function readSupportdogDcrClientsMap(request) {
  const secret = supportdogOAuthCookieSecret();
  if (!secret) return {};
  const raw = getCookieValue(request?.headers?.get("cookie") || "", SUPPORTDOG_DCR_COOKIE);
  if (!raw) return {};
  const o = unsealGleanCookiePayload(raw, secret);
  if (!o || typeof o !== "object") return {};
  return /** @type {Record<string, unknown>} */ (o);
}

/**
 * @param {Request | null | undefined} request
 * @param {string | null | undefined} datacenter
 */
export function readSupportdogDcrClient(request, datacenter) {
  const dc = normalizeSupportdogDatacenter(datacenter) || "US1";
  const client = readSupportdogDcrClientsMap(request)[dc];
  if (!client || typeof client !== "object") return null;
  return /** @type {Record<string, unknown>} */ (client);
}

/**
 * @param {unknown} clientInfo
 * @param {string} datacenter
 * @param {Request | null | undefined} [request]
 */
export function sealSupportdogDcrClient(clientInfo, datacenter, request) {
  const dc = normalizeSupportdogDatacenter(datacenter) || "US1";
  const existing = readSupportdogDcrClientsMap(request);
  return sealGleanCookiePayload({ ...existing, [dc]: clientInfo }, supportdogOAuthCookieSecret());
}

/** @deprecated Use sealSupportdogDcSession + per-DC cookies */
export function sealSupportdogSessionsMap(sessions) {
  return sealGleanCookiePayload({ v: 2, sessions }, supportdogOAuthCookieSecret());
}

/**
 * Seals only this datacenter's tokens (stored in its own cookie).
 * @param {unknown} tokenJson
 * @param {string} refreshToken
 * @param {string} datacenter
 * @param {Request | null | undefined} [request]
 */
export function sealSupportdogSession(tokenJson, refreshToken, datacenter) {
  const base = buildSessionPayloadFromTokenResponse(tokenJson, refreshToken);
  return sealSupportdogDcSession({ rt: base.rt, exp: base.exp });
}
