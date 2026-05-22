import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  defaultSupportdogDatacenter,
  normalizeSupportdogDatacenter,
  supportdogMcpServerLabel,
  supportdogMcpUrl,
} from "@/lib/supportdogDatacenter";
import { refreshSupportdogAccessToken } from "@/lib/supportdogOAuthDcr";
import {
  isSupportdogOAuthConfigured,
  listSupportdogSignedInDatacenters,
  readSupportdogSession,
} from "@/lib/supportdogOAuthSession";

/** @type {Map<string, { names: string[]; fetchedAt: number }>} */
const toolNameCache = new Map();
const TOOL_CACHE_MS = 5 * 60 * 1000;

function mcpDisabled() {
  return ["1", "true", "yes"].includes(String(process.env.SUPPORTDOG_MCP_DISABLE || "").trim().toLowerCase());
}

/**
 * @returns {string | null}
 */
export function getSupportdogMcpAuthorizationFromEnv(datacenter) {
  const direct = process.env.SUPPORTDOG_MCP_AUTHORIZATION?.trim();
  if (direct) return direct;

  const dc = normalizeSupportdogDatacenter(datacenter) || defaultSupportdogDatacenter();
  const perDc = process.env[`SUPPORTDOG_MCP_${dc}_AUTHORIZATION`]?.trim();
  if (perDc) return perDc;

  return null;
}

/**
 * Bearer token: env override, else per-user OAuth session cookie.
 * @param {string | null | undefined} datacenter
 * @param {Request | null | undefined} request
 * @returns {Promise<{ token: string | null; refreshedSessionSeal?: string | null }>}
 */
export async function resolveSupportdogAuthorization(datacenter, request) {
  const env = getSupportdogMcpAuthorizationFromEnv(datacenter);
  if (env) return { token: env.startsWith("Bearer ") ? env : `Bearer ${env}` };

  if (!isSupportdogOAuthConfigured()) return { token: null };

  const dc = normalizeSupportdogDatacenter(datacenter) || defaultSupportdogDatacenter();
  const session = readSupportdogSession(request, dc);
  if (!session?.rt) return { token: null };

  const skewMs = 60_000;
  const notExpired = !session.expired && session.exp > Date.now() + skewMs;
  const cookieAccess = session.at || "";
  if (cookieAccess && notExpired) {
    return { token: `Bearer ${cookieAccess}` };
  }

  const refreshed = await refreshSupportdogAccessToken(request, session);
  if (refreshed?.accessToken) {
    return {
      token: `Bearer ${refreshed.accessToken}`,
      refreshedSessionSeal: refreshed.newSessionSeal || null,
    };
  }

  // Access-only OAuth (no refresh_token): access token stored in rt slot until exp.
  if (session.rt && notExpired) {
    return { token: `Bearer ${session.rt}` };
  }
  return { token: null };
}

/**
 * @param {Request | null | undefined} [request]
 * @returns {boolean}
 */
export function isSupportdogMcpConfigured(request) {
  if (mcpDisabled()) return false;
  if (!supportdogMcpUrl(defaultSupportdogDatacenter())) return false;
  if (getSupportdogMcpAuthorizationFromEnv()) return true;
  if (isSupportdogOAuthConfigured()) return true;
  if (listSupportdogSignedInDatacenters(request).length > 0) return true;
  return Boolean(readSupportdogSession(request, defaultSupportdogDatacenter())?.rt);
}

/**
 * @param {Request | null | undefined} request
 * @param {string | null | undefined} datacenter
 */
export function isSupportdogMcpConfiguredForDatacenter(request, datacenter) {
  if (mcpDisabled()) return false;
  const dc = normalizeSupportdogDatacenter(datacenter) || defaultSupportdogDatacenter();
  if (!supportdogMcpUrl(dc)) return false;
  if (getSupportdogMcpAuthorizationFromEnv(dc)) return true;
  const session = readSupportdogSession(request, dc);
  return Boolean(session?.rt && !session.expired);
}

/** True when investigation can call SupportDog (env token or at least one signed-in region). */
export function canRunSupportdogInvestigation(request) {
  if (mcpDisabled()) return false;
  if (getSupportdogMcpAuthorizationFromEnv()) return true;
  return listSupportdogSignedInDatacenters(request).length > 0;
}

/**
 * @param {unknown} result
 */
export function supportdogToolResultText(result) {
  if (!result || typeof result !== "object") return "";
  if ("content" in result && Array.isArray(/** @type {{ content?: unknown }} */ (result).content)) {
    const parts = [];
    for (const block of /** @type {{ content: unknown[] }} */ (result).content) {
      if (!block || typeof block !== "object") continue;
      if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
    }
    return parts.join("\n").trim();
  }
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

/**
 * @param {string} text
 * @returns {unknown}
 */
export function parseSupportdogJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) {
      try {
        return JSON.parse(fence[1].trim());
      } catch {
        /* fall through */
      }
    }
    return raw;
  }
}

/**
 * @param {string} datacenter
 * @returns {Promise<{ ok: true, tools: { name: string; description?: string }[] } | { ok: false; message: string; code?: string }>}
 */
export async function listSupportdogTools(datacenter, request) {
  const dc = normalizeSupportdogDatacenter(datacenter) || defaultSupportdogDatacenter();
  const cached = toolNameCache.get(dc);
  if (cached && Date.now() - cached.fetchedAt < TOOL_CACHE_MS) {
    return { ok: true, tools: cached.names.map((name) => ({ name })) };
  }

  const listed = await withSupportdogMcpClient(dc, async (client) => client.listTools(), request);
  if (!listed.ok) {
    return {
      ok: false,
      message: listed.message,
      code: listed.code,
      refreshedSessionSeal: listed.refreshedSessionSeal || null,
    };
  }

  const tools = listed.value.tools
    .filter((t) => t && typeof t === "object" && typeof t.name === "string")
    .map((t) => ({ name: t.name, description: typeof t.description === "string" ? t.description : undefined }));

  toolNameCache.set(dc, { names: tools.map((t) => t.name), fetchedAt: Date.now() });
  return { ok: true, tools, refreshedSessionSeal: listed.refreshedSessionSeal || null };
}

/**
 * @param {string} datacenter
 * @param {(client: import("@modelcontextprotocol/sdk/client").Client) => Promise<T>} fn
 * @template T
 * @returns {Promise<{ ok: true, value: T } | { ok: false; message: string; code?: string }>}
 */
async function withSupportdogMcpClient(datacenter, fn, request) {
  if (mcpDisabled()) {
    return { ok: false, code: "disabled", message: "SupportDog MCP is disabled (SUPPORTDOG_MCP_DISABLE)." };
  }

  const dc = normalizeSupportdogDatacenter(datacenter) || defaultSupportdogDatacenter();
  const url = supportdogMcpUrl(dc);
  if (!url) {
    return { ok: false, code: "invalid_dc", message: `Unknown datacenter: ${datacenter}` };
  }

  const resolved = await resolveSupportdogAuthorization(dc, request);
  if (!resolved.token) {
    return {
      ok: false,
      code: "missing_auth",
      message: isSupportdogOAuthConfigured()
        ? `Sign in to SupportDog (${dc}) on this page, or set SUPPORTDOG_MCP_AUTHORIZATION in .env.local.`
        : `Set SUPPORTDOG_OAUTH_REDIRECT_URI + SUPPORTDOG_OAUTH_COOKIE_SECRET (or SUPPORTDOG_MCP_AUTHORIZATION).`,
      refreshedSessionSeal: null,
    };
  }

  /** @type {Record<string, string>} */
  const headers = { Authorization: resolved.token };

  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers },
  });
  const client = new Client({ name: "pal-portfolio-experiment-supportdog", version: "1.0.0" }, { capabilities: {} });

  try {
    await client.connect(transport);
    const value = await fn(client);
    return { ok: true, value, refreshedSessionSeal: resolved.refreshedSessionSeal || null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, code: "mcp_error", message: msg, refreshedSessionSeal: resolved.refreshedSessionSeal || null };
  } finally {
    try {
      await transport.close?.();
    } catch {
      /* ignore */
    }
    try {
      await client.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {string} datacenter
 * @param {string} toolName
 * @param {Record<string, unknown>} args
 */
export async function callSupportdogTool(datacenter, toolName, args, request) {
  const called = await withSupportdogMcpClient(datacenter, async (client) => {
    const result = await client.callTool({ name: toolName, arguments: args });
    if (result && typeof result === "object" && "isError" in result && result.isError) {
      const errText = supportdogToolResultText(result);
      throw new Error(errText || `Tool ${toolName} failed.`);
    }
    return result;
  }, request);

  if (!called.ok) return called;

  const text = supportdogToolResultText(called.value);
  return {
    ok: true,
    text,
    parsed: parseSupportdogJson(text),
    refreshedSessionSeal: called.refreshedSessionSeal || null,
  };
}

/**
 * @param {{ name: string }[]} tools
 * @param {RegExp} pattern
 * @returns {string | null}
 */
export function findSupportdogToolName(tools, pattern) {
  if (!Array.isArray(tools)) return null;
  const hit = tools.find((t) => t?.name && pattern.test(t.name));
  return hit?.name || null;
}

/**
 * @param {string} datacenter
 */
export function supportdogConnectInstructions(datacenter) {
  const dc = (normalizeSupportdogDatacenter(datacenter) || "us1").toLowerCase();
  const host =
    dc === "staging"
      ? "https://supportdog-mcp.mcp.us1.staging.dog:443/internal/mcp"
      : `https://supportdog-mcp.mcp.${dc}.prod.dog:443/internal/mcp`;
  return (
    `Connect SupportDog MCP in Cursor, then copy the Bearer token into pal-portfolio-experiment/.env.local as SUPPORTDOG_MCP_AUTHORIZATION.\n\n` +
    `Cursor: \`claude mcp add supportdog-mcp-${dc} --transport http --scope user "${host}"\`\n` +
    `Then authenticate via /mcp in Cursor.`
  );
}
