/**
 * Ticino always returns the shared `mcp-common` client from DCR — same as Claude Code.
 */

/** @type {Record<string, unknown>} */
export const SUPPORTDOG_MCP_COMMON_CLIENT = {
  client_id: "mcp-common",
  client_name: "MCP Common client",
  redirect_uris: [
    "http://localhost/oauth/callback/debug",
    "http://localhost/oauth/callback",
    "http://localhost/callback",
    "cursor://anysphere.cursor-mcp/oauth/user-metrics-admin-mcp/callback",
    "cursor://anysphere.cursor-mcp/oauth/callback",
  ],
  token_endpoint_auth_method: "none",
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  scope: "mcp:read",
};

/**
 * @returns {Record<string, unknown>}
 */
export function getSupportdogMcpCommonClient() {
  return { ...SUPPORTDOG_MCP_COMMON_CLIENT };
}
