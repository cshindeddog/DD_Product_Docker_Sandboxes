const { Client } = require("@modelcontextprotocol/sdk/client");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_CONFIG = path.join(os.homedir(), ".config", "mcp", "snowflake-config.yaml");

let cursorMcpEnvLoaded = false;

/** Merge Snowflake env from Cursor's global mcp.json when not set in pal-portfolio/.env.local */
function loadSnowflakeEnvFromCursorMcpOnce() {
  if (cursorMcpEnvLoaded) return;
  cursorMcpEnvLoaded = true;
  if (process.env.SNOWFLAKE_ACCOUNT?.trim() && process.env.SNOWFLAKE_USER?.trim()) return;

  const candidates = [
    path.join(os.homedir(), ".cursor", "mcp.json"),
    path.join(process.cwd(), ".cursor", "mcp.json"),
    path.join(process.cwd(), "..", ".cursor", "mcp.json"),
  ];

  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      const servers = parsed?.mcpServers || parsed?.mcp_servers;
      const sf = servers?.snowflake || servers?.["user-snowflake"];
      if (!sf || typeof sf !== "object") continue;
      const env = sf.env;
      if (!env || typeof env !== "object") continue;
      for (const [k, v] of Object.entries(env)) {
        if (typeof v !== "string" || !v.trim()) continue;
        if (!process.env[k]?.trim()) process.env[k] = v.trim();
      }
      if (Array.isArray(sf.args)) {
        const cfgIdx = sf.args.findIndex((a) => a === "--service-config-file");
        if (cfgIdx >= 0 && typeof sf.args[cfgIdx + 1] === "string" && !process.env.SNOWFLAKE_MCP_CONFIG_FILE?.trim()) {
          process.env.SNOWFLAKE_MCP_CONFIG_FILE = sf.args[cfgIdx + 1];
        }
        const authIdx = sf.args.findIndex((a) => a === "--authenticator");
        if (authIdx >= 0 && typeof sf.args[authIdx + 1] === "string" && !process.env.SNOWFLAKE_MCP_AUTHENTICATOR?.trim()) {
          process.env.SNOWFLAKE_MCP_AUTHENTICATOR = sf.args[authIdx + 1];
        }
      }
      break;
    } catch {
      /* try next */
    }
  }
}

function mcpDisabled() {
  return ["1", "true", "yes"].includes(String(process.env.SNOWFLAKE_MCP_DISABLE || "").trim().toLowerCase());
}

/**
 * @param {string} p
 */
function expandHome(p) {
  const s = String(p || "").trim();
  if (s.startsWith("~/")) return path.join(os.homedir(), s.slice(2));
  if (s === "~") return os.homedir();
  return s;
}

/**
 * @returns {boolean}
 */
export function isSnowflakeMcpConfigured() {
  loadSnowflakeEnvFromCursorMcpOnce();
  if (mcpDisabled()) return false;
  const account = process.env.SNOWFLAKE_ACCOUNT?.trim();
  const user = process.env.SNOWFLAKE_USER?.trim();
  if (!account || !user) return false;
  const configFile = expandHome(process.env.SNOWFLAKE_MCP_CONFIG_FILE?.trim() || DEFAULT_CONFIG);
  try {
    return fs.existsSync(configFile);
  } catch {
    return false;
  }
}

/**
 * @returns {{ command: string; args: string[]; env: Record<string, string> } | null}
 */
function snowflakeMcpSpawnParams() {
  const configFile = expandHome(process.env.SNOWFLAKE_MCP_CONFIG_FILE?.trim() || DEFAULT_CONFIG);
  if (!fs.existsSync(configFile)) return null;

  const account = process.env.SNOWFLAKE_ACCOUNT?.trim();
  const user = process.env.SNOWFLAKE_USER?.trim();
  if (!account || !user) return null;

  const database = process.env.SNOWFLAKE_DATABASE?.trim() || "REPORTING";
  const authenticator = process.env.SNOWFLAKE_MCP_AUTHENTICATOR?.trim() || "externalbrowser";

  /** @type {Record<string, string>} */
  const env = {
    SNOWFLAKE_ACCOUNT: account,
    SNOWFLAKE_USER: user,
    SNOWFLAKE_DATABASE: database,
  };
  const uvToolDir = process.env.UV_TOOL_DIR?.trim();
  if (uvToolDir) env.UV_TOOL_DIR = uvToolDir;

  return {
    command: "uvx",
    args: [
      "--python",
      "3.12",
      "--python-preference=managed",
      "--from",
      "git+https://github.com/Snowflake-Labs/mcp",
      "mcp-server-snowflake",
      "--service-config-file",
      configFile,
      "--authenticator",
      authenticator,
      "--transport",
      "stdio",
    ],
    env,
  };
}

/**
 * @param {unknown} result
 */
function toolResultText(result) {
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
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

/**
 * @param {string} text
 * @returns {Record<string, unknown>[]}
 */
function parseSnowflakeQueryRows(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((r) => r && typeof r === "object").map((r) => /** @type {Record<string, unknown>} */ (r));
    }
    if (parsed && typeof parsed === "object") {
      const o = /** @type {Record<string, unknown>} */ (parsed);
      for (const key of ["data", "rows", "result", "results"]) {
        const v = o[key];
        if (Array.isArray(v)) {
          return v.filter((r) => r && typeof r === "object").map((r) => /** @type {Record<string, unknown>} */ (r));
        }
      }
    }
  } catch {
    /* fall through */
  }

  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const header = lines[0].split("|").map((c) => c.trim()).filter(Boolean);
  if (header.length < 2) return [];

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^[-+|]+$/.test(line.replace(/\s/g, ""))) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < header.length) continue;
    /** @type {Record<string, unknown>} */
    const row = {};
    for (let c = 0; c < header.length; c++) {
      row[header[c]] = cells[c] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Run SQL via the same Snowflake MCP server as Cursor (`run_snowflake_query`).
 * @param {string} sqlText
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function runSnowflakeMcpQuery(sqlText) {
  loadSnowflakeEnvFromCursorMcpOnce();
  if (!isSnowflakeMcpConfigured()) {
    throw new Error(
      "Snowflake MCP is not configured. Set SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER, and SNOWFLAKE_MCP_CONFIG_FILE (same as Cursor MCP), or set SNOWFLAKE_MCP_DISABLE."
    );
  }

  const spawn = snowflakeMcpSpawnParams();
  if (!spawn) {
    throw new Error("Snowflake MCP config file not found.");
  }

  const transport = new StdioClientTransport({
    command: spawn.command,
    args: spawn.args,
    env: { ...process.env, ...spawn.env },
    stderr: "pipe",
  });

  const client = new Client({ name: "pal-portfolio-snowflake", version: "1.0.0" }, { capabilities: {} });

  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: "run_snowflake_query",
      arguments: { statement: sqlText },
    });

    if (result && typeof result === "object" && "isError" in result && result.isError) {
      const errText = toolResultText(result);
      throw new Error(errText || "Snowflake MCP query failed.");
    }

    const text = toolResultText(result);
    const rows = parseSnowflakeQueryRows(text);
    return rows;
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
