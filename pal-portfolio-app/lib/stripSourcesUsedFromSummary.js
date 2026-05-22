/**
 * Remove the `### Sources Used` section from investigation markdown (through the next `###` heading).
 * If stripping would remove all content (e.g. Sources Used is the only ### block), return the original.
 * @param {string} markdown
 * @returns {string}
 */
export function stripSourcesUsedFromSummary(markdown) {
  if (!markdown || typeof markdown !== "string") return "";
  const trimmed = markdown.trim();
  if (!trimmed) return "";

  const lines = trimmed.split("\n");
  const out = [];
  let skipping = false;
  for (const line of lines) {
    if (/^###\s*Sources\s+Used\s*$/i.test(line.trim())) {
      skipping = true;
      continue;
    }
    if (skipping && /^###\s+\S/.test(line.trim())) {
      skipping = false;
    }
    if (!skipping) out.push(line);
  }
  const stripped = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!stripped && trimmed) return trimmed;
  return stripped;
}

/**
 * Remove Recommended Customer Reply / draft Zendesk response sections from summaries.
 * @param {string} markdown
 * @returns {string}
 */
export function stripRecommendedCustomerReply(markdown) {
  if (!markdown || typeof markdown !== "string") return "";
  const trimmed = markdown.trim();
  if (!trimmed) return "";

  const lines = trimmed.split("\n");
  const out = [];
  let skipping = false;
  for (const line of lines) {
    const h = line.trim();
    if (
      /^###\s*(Recommended\s+Customer\s+Reply|Recommended\s+Next\s+Reply|Customer\s+Reply\s*\(draft\)|Draft\s+(customer\s+)?reply)/i.test(
        h
      ) ||
      /^##\s*Recommended\s+Customer\s+Reply/i.test(h)
    ) {
      skipping = true;
      continue;
    }
    if (skipping && (/^###\s+\S/.test(h) || /^##\s+\S/.test(h))) {
      skipping = false;
    }
    if (!skipping) out.push(line);
  }
  const stripped = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!stripped && trimmed) return trimmed;
  return stripped;
}

/**
 * @param {string} markdown
 * @param {{ showSources?: boolean }} [opts]
 */
export function formatInvestigationSummaryForDisplay(markdown, opts = {}) {
  let text = String(markdown || "");
  text = stripRecommendedCustomerReply(text);
  if (opts.showSources === false) {
    text = stripSourcesUsedFromSummary(text);
  }
  return text;
}
