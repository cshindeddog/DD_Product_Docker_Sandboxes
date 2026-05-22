import fs from "node:fs";
import path from "node:path";
import { runSnowflakeMcpQuery, isSnowflakeMcpConfigured } from "@/lib/snowflakeMcpClient";
import { resolvePalPortfolioCsvWritePath } from "@/lib/palPortfolio";

/** CSV column order (matches scripts/snowflake_pal_engineer_accounts_tickets_6mo.sql). */
export const PAL_PORTFOLIO_CSV_COLUMNS = [
  "PAL_LIAISON_EMAIL",
  "PAL_LIAISON_SF_NAME",
  "PAL_ASSEMBLED_NAME",
  "PAL_ZENDESK_USER_ID",
  "PAL_ASSEMBLED_AGENT_ID",
  "SALESFORCE_ACCOUNT_ID",
  "SALESFORCE_ACCOUNT_NAME",
  "DATADOG_ORG_ID",
  "ZENDESK_ORG_NAME",
  "TICKET_ID",
  "TICKET_CREATED_TIMESTAMP",
  "TICKET_SUBJECT",
  "TICKET_STATUS",
  "TICKET_CUSTOM_STATUS_NAME",
  "TICKET_SOURCE",
  "IS_PREMIER_SUPPORT_TICKET",
  "PRIMARY_PRODUCT_COMPONENT",
  "TICKET_IMPACT",
];

const DEFAULT_SQL_BASENAME = "snowflake_pal_engineer_accounts_tickets_6mo.sql";

/**
 * @returns {string}
 */
function resolvePalPortfolioSqlPath() {
  const envPath = process.env.PAL_PORTFOLIO_SNOWFLAKE_SQL_PATH?.trim();
  if (envPath) {
    const resolved = path.isAbsolute(envPath) ? envPath : path.join(process.cwd(), envPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`PAL_PORTFOLIO_SNOWFLAKE_SQL_PATH not found: ${resolved}`);
    }
    return resolved;
  }

  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, "..", "scripts", DEFAULT_SQL_BASENAME),
    path.join(cwd, "scripts", DEFAULT_SQL_BASENAME),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    `Portfolio export SQL not found. Expected scripts/${DEFAULT_SQL_BASENAME} in the repo parent, or set PAL_PORTFOLIO_SNOWFLAKE_SQL_PATH.`
  );
}

/**
 * @returns {string}
 */
export function loadPalPortfolioExportSql() {
  const months = Math.max(1, Math.min(24, Number(process.env.PAL_PORTFOLIO_TICKET_MONTHS) || 6));
  let sql = fs.readFileSync(resolvePalPortfolioSqlPath(), "utf8");
  if (months !== 6) {
    sql = sql.replace(
      /DATEADD\s*\(\s*month\s*,\s*-6\s*,\s*CURRENT_TIMESTAMP\s*\(\s*\)\s*\)/gi,
      `DATEADD(month, -${months}, CURRENT_TIMESTAMP())`
    );
  }
  return sql;
}

/**
 * @param {unknown} v
 * @returns {string}
 */
function formatCsvCell(v) {
  if (v == null || v === "") return "";
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "object") {
    if (v instanceof Date) return v.toISOString().replace(/\.\d{3}Z$/, "");
    if (typeof v.toJSON === "function") {
      try {
        const j = v.toJSON();
        if (typeof j === "string") return j;
      } catch {
        /* fall through */
      }
    }
    return JSON.stringify(v);
  }
  return String(v).trim();
}

/**
 * @param {string} s
 * @returns {string}
 */
function escapeCsvField(s) {
  const str = formatCsvCell(s);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
function normalizeSnowflakeRow(row) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[String(k).trim().toUpperCase()] = v;
  }
  return out;
}

/**
 * @param {Record<string, unknown>[]} rows
 * @returns {string}
 */
export function palPortfolioRowsToCsv(rows) {
  const lines = [PAL_PORTFOLIO_CSV_COLUMNS.join(",")];
  for (const raw of rows) {
    const row = normalizeSnowflakeRow(raw);
    const cells = PAL_PORTFOLIO_CSV_COLUMNS.map((col) => escapeCsvField(row[col]));
    lines.push(cells.join(","));
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Query Snowflake and write the portfolio CSV used by the app.
 * @returns {Promise<{ path: string; rowCount: number; exportedAt: string }>}
 */
export async function exportPalPortfolioFromSnowflake() {
  if (!isSnowflakeMcpConfigured()) {
    throw new Error(
      "Snowflake MCP is not configured. Set SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER, and SNOWFLAKE_MCP_CONFIG_FILE (same as Cursor MCP), or set SNOWFLAKE_MCP_DISABLE."
    );
  }

  const sql = loadPalPortfolioExportSql();
  const rows = await runSnowflakeMcpQuery(sql);
  if (!rows.length) {
    throw new Error("Snowflake returned no portfolio rows. Check PSR assignments and the export SQL.");
  }

  const csvPath = resolvePalPortfolioCsvWritePath();
  const parent = path.dirname(csvPath);
  fs.mkdirSync(parent, { recursive: true });

  const csvText = palPortfolioRowsToCsv(rows);
  const tmpPath = `${csvPath}.tmp`;
  fs.writeFileSync(tmpPath, csvText, "utf8");
  fs.renameSync(tmpPath, csvPath);

  return {
    path: csvPath,
    rowCount: rows.length,
    exportedAt: new Date().toISOString(),
  };
}
