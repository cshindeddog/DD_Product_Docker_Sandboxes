import path from "path";
import { existsSync, readFileSync } from "fs";
import { parseCsv, csvRowsToObjects } from "@/lib/csv";

/**
 * Path used when writing a fresh Snowflake export (env override, existing file, or repo default).
 * @returns {string}
 */
export function resolvePalPortfolioCsvWritePath() {
  const envPath = process.env.PAL_PORTFOLIO_CSV_PATH?.trim();
  if (envPath) {
    return path.isAbsolute(envPath) ? envPath : path.join(process.cwd(), envPath);
  }

  const existing = resolvePalPortfolioCsvPath();
  if (existing) return existing;

  return path.join(process.cwd(), "..", "tmp_pal_engineer_accounts_tickets_last6mo.csv");
}

const CSV_NAMES = [
  "pal_engineer_accounts_tickets_last6mo.csv",
  "tmp_pal_engineer_accounts_tickets_last6mo.csv",
];

/**
 * @returns {string | null}
 */
export function resolvePalPortfolioCsvPath() {
  const envPath = process.env.PAL_PORTFOLIO_CSV_PATH;
  if (envPath && existsSync(envPath)) return envPath;

  const cwd = process.cwd();
  const candidates = [
    ...CSV_NAMES.map((n) => path.join(cwd, "data", n)),
    ...CSV_NAMES.map((n) => path.join(cwd, n)),
    ...CSV_NAMES.map((n) => path.join(cwd, "..", n)),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * @returns {{ path: string | null, rows: Record<string, string>[] }}
 */
export function loadPalPortfolioRows() {
  const csvPath = resolvePalPortfolioCsvPath();
  if (!csvPath) {
    return { path: null, rows: [] };
  }
  const text = readFileSync(csvPath, "utf8");
  const matrix = parseCsv(text);
  const rows = csvRowsToObjects(matrix);
  return { path: csvPath, rows };
}
