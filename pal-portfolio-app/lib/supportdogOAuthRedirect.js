/**
 * SupportDog OAuth redirect URI for Ticino / Blackthorn (`mcp-common` client).
 *
 * Allowed redirects (from Ticino DCR):
 *   http://localhost/callback
 *   http://localhost/oauth/callback
 *   cursor://…
 *
 * Claude uses http://localhost:PORT/callback — any port on localhost works for /callback.
 * 127.0.0.1 is NOT allowed. Long app paths like /api/.../callback are NOT allowed.
 */

/** Must match app/callback/route.js */
export const SUPPORTDOG_OAUTH_CALLBACK_PATH = "/callback";

/**
 * @param {string} uri
 */
export function normalizeSupportdogRedirectUri(uri) {
  const u = new URL(uri);
  u.hash = "";
  u.search = "";
  let href = u.href;
  if (href.endsWith("/") && u.pathname !== "/") {
    href = href.slice(0, -1);
  }
  return href;
}

/**
 * Port for OAuth callback (never use 127.0.0.1 — Ticino requires localhost).
 * @param {Request | null | undefined} request
 */
function resolveCallbackPort(request) {
  let port = process.env.PORT?.trim() || "5101";

  if (request) {
    try {
      const u = new URL(request.url);
      if (u.port) port = u.port;
    } catch {
      /* ignore */
    }
  }

  const fromEnv = process.env.SUPPORTDOG_OAUTH_REDIRECT_URI?.trim();
  if (fromEnv) {
    try {
      const eu = new URL(fromEnv);
      if (eu.hostname === "localhost" && eu.pathname.replace(/\/$/, "") === "/callback" && eu.port) {
        port = eu.port;
      }
    } catch {
      /* ignore invalid env */
    }
  }

  return port;
}

/**
 * Always http://localhost:PORT/callback — ignores stale env paths like /api/pal-portfolio/.../callback.
 * @param {Request | null | undefined} request
 */
export function resolveSupportdogOAuthRedirectUri(request) {
  const port = resolveCallbackPort(request);
  return normalizeSupportdogRedirectUri(
    `http://localhost:${port}${SUPPORTDOG_OAUTH_CALLBACK_PATH}`
  );
}

/**
 * @param {unknown} clientInfo
 * @param {string} redirectUri
 */
export function supportdogClientAllowsRedirect(clientInfo, redirectUri) {
  if (!clientInfo || typeof clientInfo !== "object") return false;
  const uris = /** @type {{ redirect_uris?: unknown }} */ (clientInfo).redirect_uris;
  if (!Array.isArray(uris)) return false;
  const want = normalizeSupportdogRedirectUri(redirectUri);
  if (uris.some((u) => typeof u === "string" && normalizeSupportdogRedirectUri(u) === want)) {
    return true;
  }
  try {
    const w = new URL(want);
    if (w.hostname === "localhost" && w.pathname === "/callback") return true;
  } catch {
    /* ignore */
  }
  return false;
}
