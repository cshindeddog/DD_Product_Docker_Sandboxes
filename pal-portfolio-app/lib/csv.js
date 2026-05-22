/**
 * Minimal RFC 4180-style CSV parser (quoted fields, doubled quotes).
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  const len = text.length;

  while (i < len) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (c === "\r") {
      i += 1;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function headerToCamel(header) {
  const parts = String(header || "")
    .trim()
    .split("_")
    .map((p) => p.toLowerCase());
  if (parts.length === 0) return "";
  return parts[0] + parts.slice(1).map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : "")).join("");
}

/**
 * @param {string[][]} rows
 * @returns {Record<string, string>[]}
 */
export function csvRowsToObjects(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map(headerToCamel);
  const out = [];
  for (let r = 1; r < rows.length; r += 1) {
    const line = rows[r];
    if (line.length === 1 && line[0] === "") continue;
    const obj = {};
    for (let c = 0; c < headers.length; c += 1) {
      const key = headers[c];
      if (!key) continue;
      obj[key] = line[c] ?? "";
    }
    out.push(obj);
  }
  return out;
}
