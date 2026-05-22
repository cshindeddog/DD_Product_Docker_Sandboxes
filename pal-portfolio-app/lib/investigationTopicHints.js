/**
 * Per-ticket topic hints injected into Claude user message (from evidence corpus).
 * @param {string} corpus
 * @returns {string}
 */
export function buildInvestigationTopicHints(corpus) {
  const text = String(corpus || "");
  /** @type {string[]} */
  const hints = [];

  if (/synthetic|browser test|locate_element|\btti\b|private location|api test|500|503|timeout|tcp/i.test(text)) {
    hints.push(
      "**Topic (Synthetics):** Explain why 5xx/503, LOCATE_ELEMENT, TTI, or TCP on the monitored URL usually reflect target/upstream behavior, not runner failure, unless evidence shows otherwise. Split confidence. No regional outage speculation."
    );
  }

  if (
    /\bddsql\b|metrics explorer|resource[\s-]?type|host list|or vs and|\band\b.*\bor\b|infrastructure.host|fleet|ec2|azure|vm\b/i.test(
      text
    )
  ) {
    hints.push(
      "**Topic (DDSQL / queries):** Center OR vs AND and resource-type filtering. Read negation literally. No invented table names or refresh intervals. **Confirmed** vs **Uncertain**. No customer reply draft section."
    );
  }

  if (
    /\bflare\b|agent[\s-]?log|troubleshooting[\s-]?flare|service[\s-]?check|no[\s-]?data|host[\s-]?down|intake|telemetry|windows[\s-]?host/i.test(
      text
    )
  ) {
    hints.push(
      "**Topic (flare / agent / service-check):** Lead with **Current blocker** (e.g. pending flare). Flare is NOT a hard stop — parallel **internal** checks: monitor no-data config, backend metric gaps, intake, host OS. Put inline flare/UI steps under **Customer-facing** diagnostic steps only (no separate draft reply). **Handling gaps:** doc-link-only replies, missing Admin UI follow-through. No Mimecast/timing folklore unless evidenced. Medium-low confidence until data arrives."
    );
  }

  if (/\bpending\b/i.test(text)) {
    hints.push(
      "**Status:** **Pending** — internal diagnostic steps run **in parallel**; customer-facing steps go under Diagnostic Steps only (no draft reply section)."
    );
  }

  return hints.length ? `\n${hints.join("\n")}\n` : "";
}
