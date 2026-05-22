/** @type {readonly string[]} */
export const SUPPORTDOG_DATACENTERS = ["US1", "US3", "US5", "EU1", "AP1", "AP2", "STAGING"];

/**
 * @param {string | null | undefined} raw
 * @returns {string | null}
 */
export function normalizeSupportdogDatacenter(raw) {
  const s = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/^SUPPORTDOG-MCP-/, "");
  if (!s) return null;
  if (s === "STAGING" || s === "US1-STAGING") return "STAGING";
  if (SUPPORTDOG_DATACENTERS.includes(s)) return s;
  return null;
}

/**
 * @param {string | null | undefined} datacenter
 * @returns {string | null}
 */
export function supportdogMcpUrl(datacenter) {
  const dc = normalizeSupportdogDatacenter(datacenter);
  if (!dc) return null;
  if (dc === "STAGING") {
    return "https://supportdog-mcp.mcp.us1.staging.dog:443/internal/mcp";
  }
  return `https://supportdog-mcp.mcp.${dc.toLowerCase()}.prod.dog:443/internal/mcp`;
}

/**
 * @param {string | null | undefined} datacenter
 * @returns {string}
 */
export function supportdogMcpServerLabel(datacenter) {
  const dc = normalizeSupportdogDatacenter(datacenter) || "US1";
  return `supportdog-mcp-${dc.toLowerCase()}`;
}

/**
 * @returns {string}
 */
export function defaultSupportdogDatacenter() {
  return normalizeSupportdogDatacenter(process.env.SUPPORTDOG_DEFAULT_DATACENTER) || "US1";
}
