const { Client } = require("@modelcontextprotocol/sdk/client");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const { gleanMcpEndpointUrl } = require("@/lib/gleanBackendUrl");
const { getGleanRestAuth, gleanAuthErrorMessage, gleanDebug } = require("@/lib/gleanServer");

export { gleanMcpEndpointUrl, isGleanMcpConfigured } from "@/lib/gleanBackendUrl";

function mcpDisabled() {
  return ["1", "true", "yes"].includes(String(process.env.GLEAN_MCP_DISABLE || "").trim().toLowerCase());
}

/**
 * @param {unknown[]} tools
 * @returns {string | null}
 */
function findReadDocumentToolName(tools) {
  if (!Array.isArray(tools)) return null;
  const list = tools.filter((t) => t && typeof t === "object" && typeof t.name === "string");
  const exact = list.find((t) => t.name === "read_document");
  if (exact) return exact.name;
  const loose = list.find((t) => /read_?document/i.test(t.name));
  return loose?.name || null;
}

/**
 * @param {{ name: string, inputSchema?: Record<string, unknown> } | null | undefined} tool
 * @param {string} url
 */
function buildReadDocumentArgs(tool, url) {
  const props =
    tool?.inputSchema && typeof tool.inputSchema === "object"
      ? /** @type {Record<string, unknown>} */ (tool.inputSchema).properties
      : null;
  if (props && typeof props === "object") {
    if ("urls" in props) return { urls: [url] };
    if ("url" in props) return { url };
    if ("documentUrl" in props) return { documentUrl: url };
    if ("documentSpecs" in props) return { documentSpecs: [{ url }] };
  }
  return { url };
}

/**
 * @param {unknown} result
 */
function stringifyToolResult(result) {
  if (!result) return "";
  if (typeof result === "object" && result !== null && "content" in result) {
    const content = /** @type {{ content?: unknown }} */ (result).content;
    if (Array.isArray(content)) {
      const parts = [];
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
      }
      const joined = parts.join("\n\n").trim();
      if (joined) return joined;
    }
  }
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

/**
 * Connect to Glean MCP with the same bearer as REST (`getGleanRestAuth`), call read_document (or closest tool), return text/JSON.
 * @param {string} documentUrl
 * @param {Request | null | undefined} request
 * @returns {Promise<{ ok: true, text: string, toolName: string, refreshedSessionSeal: string | null } | { ok: false, message: string, refreshedSessionSeal: string | null }>}
 */
export async function gleanMcpReadDocument(documentUrl, request) {
  if (mcpDisabled()) {
    return { ok: false, message: "MCP disabled (GLEAN_MCP_DISABLE).", refreshedSessionSeal: null };
  }

  const endpoint = gleanMcpEndpointUrl();
  if (!endpoint) {
    return { ok: false, message: "No MCP URL (set GLEAN_MCP_URL or GLEAN_INSTANCE_URL).", refreshedSessionSeal: null };
  }

  const auth = await getGleanRestAuth(request ?? null);
  if (!auth.ok) {
    return { ok: false, message: gleanAuthErrorMessage(auth.code), refreshedSessionSeal: null };
  }

  /** @type {Record<string, string>} */
  const hdr = {};
  for (const [k, v] of Object.entries(auth.headers)) {
    if (typeof v === "string" && v.length) hdr[k] = v;
  }

  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: hdr },
  });

  const client = new Client({ name: "pal-portfolio", version: "1.0.0" }, { capabilities: {} });

  try {
    await client.connect(transport);

    const listed = await client.listTools();
    const tools = listed && typeof listed === "object" && "tools" in listed ? /** @type {{ tools: unknown[] }} */ (listed).tools : [];
    const toolName = findReadDocumentToolName(tools);
    if (!toolName) {
      await transport.terminateSession?.().catch(() => {});
      await client.close().catch(() => {});
      return {
        ok: false,
        message: "Glean MCP connected but no read_document (or similar) tool was listed.",
        refreshedSessionSeal: auth.refreshedSessionSeal || null,
      };
    }

    const toolMeta = Array.isArray(tools) ? tools.find((t) => t && typeof t === "object" && t.name === toolName) : null;
    let args = buildReadDocumentArgs(toolMeta, documentUrl);
    let result;
    try {
      result = await client.callTool({ name: toolName, arguments: args });
    } catch {
      args = { urls: [documentUrl] };
      result = await client.callTool({ name: toolName, arguments: args });
    }

    const text = stringifyToolResult(result).trim();
    await transport.terminateSession?.().catch(() => {});
    await client.close().catch(() => {});

    gleanDebug("read_document ok", toolName, "chars:", text.length);

    if (!text) {
      return {
        ok: false,
        message: "read_document returned empty content.",
        refreshedSessionSeal: auth.refreshedSessionSeal || null,
      };
    }

    return {
      ok: true,
      text,
      toolName,
      refreshedSessionSeal: auth.refreshedSessionSeal || null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    gleanDebug("read_document MCP error", msg);
    try {
      await transport.terminateSession?.().catch(() => {});
    } catch {
      /* ignore */
    }
    try {
      await client.close();
    } catch {
      /* ignore */
    }
    return { ok: false, message: msg, refreshedSessionSeal: auth.refreshedSessionSeal || null };
  }
}

/**
 * @param {Request | null | undefined} request
 * @returns {Promise<{ ok: true, tools: { name: string, description?: string }[], refreshedSessionSeal: string | null } | { ok: false, message: string, refreshedSessionSeal: string | null }>}
 */
export async function gleanMcpListTools(request) {
  if (mcpDisabled()) {
    return { ok: false, message: "MCP disabled (GLEAN_MCP_DISABLE).", refreshedSessionSeal: null };
  }
  const endpoint = gleanMcpEndpointUrl();
  if (!endpoint) {
    return { ok: false, message: "No MCP URL.", refreshedSessionSeal: null };
  }
  const auth = await getGleanRestAuth(request ?? null);
  if (!auth.ok) {
    return { ok: false, message: gleanAuthErrorMessage(auth.code), refreshedSessionSeal: null };
  }

  /** @type {Record<string, string>} */
  const hdr = {};
  for (const [k, v] of Object.entries(auth.headers)) {
    if (typeof v === "string" && v.length) hdr[k] = v;
  }

  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: hdr },
  });
  const client = new Client({ name: "pal-portfolio", version: "1.0.0" }, { capabilities: {} });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const toolsRaw =
      listed && typeof listed === "object" && "tools" in listed ? /** @type {{ tools: unknown[] }} */ (listed).tools : [];
    const tools = [];
    if (Array.isArray(toolsRaw)) {
      for (const t of toolsRaw) {
        if (!t || typeof t !== "object") continue;
        const name = typeof t.name === "string" ? t.name : "";
        if (!name) continue;
        tools.push({
          name,
          description: typeof t.description === "string" ? t.description : undefined,
        });
      }
    }
    await transport.terminateSession?.().catch(() => {});
    await client.close().catch(() => {});
    return { ok: true, tools, refreshedSessionSeal: auth.refreshedSessionSeal || null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      await transport.terminateSession?.().catch(() => {});
    } catch {
      /* ignore */
    }
    try {
      await client.close();
    } catch {
      /* ignore */
    }
    return { ok: false, message: msg, refreshedSessionSeal: auth.refreshedSessionSeal || null };
  }
}
