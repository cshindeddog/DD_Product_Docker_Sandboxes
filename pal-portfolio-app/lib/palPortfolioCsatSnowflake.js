import { runSnowflakeMcpQuery, isSnowflakeMcpConfigured } from "@/lib/snowflakeMcpClient";

const MS_DAY = 86400000;

/**
 * @param {string} yyyyMmDd
 */
function startOfDayLocal(yyyyMmDd) {
  if (!yyyyMmDd) return null;
  const parts = yyyyMmDd.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  const [y, mo, da] = parts;
  return new Date(y, mo - 1, da, 0, 0, 0, 0);
}

/**
 * @param {string} yyyyMmDd
 */
function endOfDayLocal(yyyyMmDd) {
  if (!yyyyMmDd) return null;
  const parts = yyyyMmDd.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  const [y, mo, da] = parts;
  return new Date(y, mo - 1, da, 23, 59, 59, 999);
}

/**
 * Created-timestamp bounds for CSAT (same inclusive local days as call-prep highlights window).
 * @param {string} highlightFrom
 * @param {string} highlightTo
 */
export function csatCreatedWindowBounds(highlightFrom, highlightTo) {
  const end = endOfDayLocal(highlightTo);
  const start = startOfDayLocal(highlightFrom);
  if (!end || !start || start > end) return null;
  return { windowStart: start, windowEnd: end };
}

/**
 * @param {unknown} row
 * @param {string} key
 */
function cell(row, key) {
  if (!row || typeof row !== "object") return "";
  const r = /** @type {Record<string, unknown>} */ (row);
  const direct = r[key] ?? r[key.toUpperCase()] ?? r[key.toLowerCase()];
  if (direct != null && String(direct).trim()) return String(direct).trim();
  return "";
}

/**
 * @param {unknown} row
 */
function pickCsatComment(row) {
  const parts = [
    cell(row, "SATISFACTION_RATING_COMMENT"),
    cell(row, "RATING_COMMENT"),
    cell(row, "DSAT_REASON_COMMENT"),
    cell(row, "SATISFACTION_RATING_REASON"),
    cell(row, "DSAT_REASON"),
  ].filter(Boolean);
  const seen = new Set();
  const unique = [];
  for (const p of parts) {
    const n = p.replace(/\s+/g, " ").trim();
    if (!n || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    unique.push(n);
  }
  return unique.join(" — ") || "—";
}

/**
 * @param {unknown} row
 * @param {'bad' | 'good'} score
 */
function rowToHighlightItem(row, score) {
  const ticketId = cell(row, "TICKET_ID") || cell(row, "ID");
  const subject = cell(row, "SUBJECT") || "—";
  const status = cell(row, "STATUS") || "—";
  const assignee = cell(row, "ASSIGNEE_NAME") || "—";
  const ppc = cell(row, "PRIMARY_PRODUCT_COMPONENT") || "—";
  const created = cell(row, "CREATED_TIMESTAMP");
  const csatComment = pickCsatComment(row);
  const label = score === "bad" ? "Bad" : "Good";

  const reviewReason = [
    `${label} CSAT (Snowflake MCP · DIM_ZENDESK_TICKET).`,
    created ? `Created ${created.slice(0, 16).replace("T", " ")}.` : null,
    `Status: ${status}.`,
    assignee !== "—" ? `Assignee: ${assignee}.` : null,
    ppc !== "—" ? `Product: ${ppc}.` : null,
    csatComment !== "—" ? `Customer comment: ${csatComment}` : "No satisfaction comment text in warehouse.",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    ticketId,
    subject,
    status,
    assigneeName: assignee,
    createdAt: created,
    csatComment,
    reviewReason,
  };
}

/**
 * @param {string} value
 */
function sqlStringLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * @param {string | number} orgId
 */
function sqlOrgIdLiteral(orgId) {
  const s = String(orgId).trim();
  if (/^\d+$/.test(s)) return s;
  return sqlStringLiteral(s);
}

/**
 * @param {Date} d
 */
function sqlTimestampLiteral(d) {
  const iso = d.toISOString().replace(/\.\d{3}Z$/, "Z");
  return `TO_TIMESTAMP_NTZ(${sqlStringLiteral(iso)})`;
}

/**
 * Snowflake FQN: REPORTING.GENERAL.DIM_* (Metabase "GENERAL"."DIM_*" maps to this).
 * @param {string} tableName
 */
function csatTableFqn(tableName) {
  const database = process.env.SNOWFLAKE_CSAT_DATABASE?.trim() || "REPORTING";
  const schema = process.env.SNOWFLAKE_CSAT_SCHEMA?.trim() || "GENERAL";
  return `${database}.${schema}."${tableName}"`;
}

/**
 * @param {'bad' | 'good'} score
 * @param {string} datadogOrgId
 * @param {string | null | undefined} salesforceAccountId
 * @param {Date} windowStart
 * @param {Date} windowEnd
 */
function buildCsatSql(score, datadogOrgId, salesforceAccountId, windowStart, windowEnd) {
  const t = csatTableFqn("DIM_ZENDESK_TICKET");
  const u = csatTableFqn("DIM_ZENDESK_USER");
  const o = csatTableFqn("DIM_ZENDESK_ORG");
  const orgLit = sqlOrgIdLiteral(datadogOrgId);

  let orgClause = `(
    t."DATADOG_ORG_ID" = ${orgLit}
    OR t."DATADOG_ORG_ID_COALESCE" = ${orgLit}
    OR org."DATADOG_ORG_ID" = ${orgLit}
  )`;

  if (salesforceAccountId) {
    orgClause += ` AND org."SALESFORCE_ACCOUNT_ID" = ${sqlStringLiteral(salesforceAccountId)}`;
  }

  return `
SELECT
  t."ID" AS "TICKET_ID",
  t."SUBJECT" AS "SUBJECT",
  t."STATUS" AS "STATUS",
  t."CREATED_TIMESTAMP" AS "CREATED_TIMESTAMP",
  t."SATISFACTION_RATING_SCORE" AS "SATISFACTION_RATING_SCORE",
  t."SATISFACTION_RATING_COMMENT" AS "SATISFACTION_RATING_COMMENT",
  t."SATISFACTION_RATING_REASON" AS "SATISFACTION_RATING_REASON",
  t."RATING_COMMENT" AS "RATING_COMMENT",
  t."DSAT_REASON" AS "DSAT_REASON",
  t."DSAT_REASON_COMMENT" AS "DSAT_REASON_COMMENT",
  t."PRIMARY_PRODUCT_COMPONENT" AS "PRIMARY_PRODUCT_COMPONENT",
  a."NAME" AS "ASSIGNEE_NAME"
FROM ${t} AS t
LEFT JOIN ${u} AS a ON t."ASSIGNEE_ID" = a."ID"
LEFT JOIN ${o} AS org ON t."ZENDESK_ORG_ID" = org."ID"
WHERE t."IS_SUPPORT_TICKET" = TRUE
  AND t."SATISFACTION_RATING_SCORE" = ${sqlStringLiteral(score)}
  AND ${orgClause}
  AND t."CREATED_TIMESTAMP" >= ${sqlTimestampLiteral(windowStart)}
  AND t."CREATED_TIMESTAMP" <= ${sqlTimestampLiteral(windowEnd)}
ORDER BY t."CREATED_TIMESTAMP" DESC
LIMIT 150
`.trim();
}

/**
 * @param {{
 *   datadogOrgId: string;
 *   salesforceAccountId?: string | null;
 *   highlightFrom: string;
 *   highlightTo: string;
 * }} params
 * @returns {Promise<{ configured: boolean; bad: ReturnType<typeof rowToHighlightItem>[]; good: ReturnType<typeof rowToHighlightItem>[]; error?: string }>}
 */
export async function fetchCsatHighlightsFromSnowflake(params) {
  if (!isSnowflakeMcpConfigured()) {
    return {
      configured: false,
      bad: [],
      good: [],
      error: "Snowflake MCP not configured (use same SNOWFLAKE_ACCOUNT / USER / config as Cursor).",
    };
  }

  const datadogOrgId = String(params.datadogOrgId || "").trim();
  if (!datadogOrgId) {
    return { configured: true, bad: [], good: [], error: "Datadog org ID is required." };
  }

  const bounds = csatCreatedWindowBounds(params.highlightFrom, params.highlightTo);
  if (!bounds) {
    return { configured: true, bad: [], good: [], error: "Invalid date range." };
  }

  const sfAccountId = params.salesforceAccountId ? String(params.salesforceAccountId).trim() : null;

  try {
    const badSql = buildCsatSql("bad", datadogOrgId, sfAccountId, bounds.windowStart, bounds.windowEnd);
    const goodSql = buildCsatSql("good", datadogOrgId, sfAccountId, bounds.windowStart, bounds.windowEnd);

    const [badRows, goodRows] = await Promise.all([
      runSnowflakeMcpQuery(badSql),
      runSnowflakeMcpQuery(goodSql),
    ]);

    const bad = badRows.map((r) => rowToHighlightItem(r, "bad")).filter((it) => it.ticketId);
    const good = goodRows.map((r) => rowToHighlightItem(r, "good")).filter((it) => it.ticketId);

    return { configured: true, bad, good };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { configured: true, bad: [], good: [], error: msg };
  }
}
