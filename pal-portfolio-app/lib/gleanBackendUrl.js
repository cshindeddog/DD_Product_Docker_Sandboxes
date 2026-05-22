/**
 * Glean Client API and OAuth live on the tenant **backend** host (`*-be.glean.com`).
 * `GLEAN_INSTANCE_URL` may be set to that backend URL or to the web app host; normalize to backend origin.
 * @returns {string | null}
 */
export function gleanBackendBaseUrl() {
  const raw = process.env.GLEAN_INSTANCE_URL?.trim();
  if (!raw) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (host.endsWith("-be.glean.com")) {
    return `${u.protocol}//${u.host}`.replace(/\/$/, "");
  }
  if (host.endsWith(".glean.com") && !host.endsWith("-be.glean.com")) {
    const withoutBe = host.replace(/\.glean\.com$/i, "");
    if (withoutBe.endsWith("-be")) {
      return `https://${host}`;
    }
    const tenant = withoutBe.replace(/-be$/i, "");
    return `https://${tenant}-be.glean.com`;
  }
  return `${u.protocol}//${u.host}`.replace(/\/$/, "");
}

/**
 * REST base for `/rest/api/v1/*` — same as backend unless you use a nonstandard layout.
 * @returns {string | null}
 */
export function gleanRestApiBaseUrl() {
  return gleanBackendBaseUrl();
}

/**
 * Remote Glean MCP endpoint (Streamable HTTP). Defaults to `{GLEAN backend}/mcp/default`.
 * Override with `GLEAN_MCP_URL` (e.g. `https://datadog-be.glean.com/mcp/default`).
 * @returns {string | null}
 */
export function gleanMcpEndpointUrl() {
  const explicit = process.env.GLEAN_MCP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const b = gleanBackendBaseUrl();
  return b ? `${b}/mcp/default` : null;
}

/**
 * @returns {boolean}
 */
export function isGleanMcpConfigured() {
  return Boolean(gleanMcpEndpointUrl());
}
