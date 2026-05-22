import { fetchWithTimeout } from "@/lib/fetchWithTimeout";

/** @type {{ pattern: RegExp; url: string; label: string }[]} */
const DOC_ROUTES = [
  {
    pattern: /\bflare\b|agent[\s-]?log|troubleshooting|service[\s-]?check|host[\s-]?down|no[\s-]?data/i,
    url: "https://docs.datadoghq.com/agent/troubleshooting/",
    label: "Agent troubleshooting / flare",
  },
  {
    pattern: /\bddsql\b|metrics[\s-]?explorer|resource[\s-]?type|host[\s-]?list|fleet|infrastructure[\s-]?host/i,
    url: "https://docs.datadoghq.com/metrics/",
    label: "Metrics / DDSQL",
  },
  {
    pattern: /\bsynthetic[s]?\b|browser[\s-]?test|locate_element|time[\s-]?to[\s-]?interactive|\btti\b|private[\s-]?location|api[\s-]?test/i,
    url: "https://docs.datadoghq.com/synthetics/",
    label: "Synthetic Monitoring",
  },
  { pattern: /\bllm[\s_-]?obs|experiment[\s_-]?run|dataset\b/i, url: "https://docs.datadoghq.com/llm_observability/", label: "LLM Observability" },
  { pattern: /\bapm\b|trace[s]?\b|tracing\b|span\b/i, url: "https://docs.datadoghq.com/tracing/", label: "APM / Tracing" },
  { pattern: /\blog[s]?\b|logging\b|pipeline\b/i, url: "https://docs.datadoghq.com/logs/", label: "Logs" },
  { pattern: /\bmonitor[s]?\b|alert[s]?\b/i, url: "https://docs.datadoghq.com/monitors/", label: "Monitors" },
  { pattern: /\bdashboard[s]?\b|widget[s]?\b|screenboard\b/i, url: "https://docs.datadoghq.com/dashboards/", label: "Dashboards" },
  { pattern: /\binfrastructure\b|\bhost[s]?\b|container[s]?\b|kubernetes\b|\bk8s\b/i, url: "https://docs.datadoghq.com/infrastructure/", label: "Infrastructure" },
  { pattern: /\brum\b|real[\s-]?user\b|session[\s-]?replay\b/i, url: "https://docs.datadoghq.com/real_user_monitoring/", label: "RUM" },
  { pattern: /\bsecurity\b|cspm\b|cws\b|siem\b/i, url: "https://docs.datadoghq.com/security/", label: "Security" },
  { pattern: /\bmetric[s]?\b|custom[\s-]?metric\b/i, url: "https://docs.datadoghq.com/metrics/", label: "Metrics" },
  { pattern: /\bprofiler\b|profiling\b/i, url: "https://docs.datadoghq.com/profiler/", label: "Profiler" },
];

const DEFAULT_DOC = {
  url: "https://docs.datadoghq.com/",
  label: "Datadog Documentation (home)",
};

/**
 * @param {string} corpus
 * @returns {{ url: string; label: string }[]}
 */
export function pickDatadogDocUrls(corpus) {
  const text = String(corpus || "");
  /** @type {{ url: string; label: string }[]} */
  const picked = [];
  const seen = new Set();
  for (const route of DOC_ROUTES) {
    if (!route.pattern.test(text)) continue;
    if (seen.has(route.url)) continue;
    seen.add(route.url);
    picked.push({ url: route.url, label: route.label });
  }
  if (picked.length === 0) picked.push(DEFAULT_DOC);
  return picked.slice(0, 3);
}

/**
 * @param {string} html
 */
function htmlToPlainText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Step 6 — fetch public docs.datadoghq.com excerpts for the ticket topic.
 * @param {string} corpus — subject + description + ticket JSON text
 */
export async function fetchDatadogDocsForTicket(corpus) {
  const routes = pickDatadogDocUrls(corpus);
  /** @type {{ url: string; label: string; excerpt: string; ok: boolean; error?: string }[]} */
  const pages = [];

  for (const route of routes) {
    try {
      const res = await fetchWithTimeout(
        route.url,
        {
          method: "GET",
          headers: {
            Accept: "text/html,application/xhtml+xml",
            "User-Agent": "pal-portfolio-experiment-investigation-playbook/1.0",
          },
          cache: "no-store",
        },
        20_000
      );
      const raw = await res.text();
      if (!res.ok) {
        pages.push({
          url: route.url,
          label: route.label,
          excerpt: "",
          ok: false,
          error: `HTTP ${res.status}`,
        });
        continue;
      }
      const plain = htmlToPlainText(raw).slice(0, 12_000);
      pages.push({
        url: route.url,
        label: route.label,
        excerpt: plain || "(empty page text)",
        ok: true,
      });
    } catch (e) {
      pages.push({
        url: route.url,
        label: route.label,
        excerpt: "",
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { pages, routes };
}

/**
 * @param {{ url: string; label: string; excerpt: string; ok: boolean; error?: string }[]} pages
 */
export function formatDatadogDocsMarkdown(pages) {
  if (!pages.length) return "_No docs pages fetched._";
  return pages
    .map((p) => {
      const status = p.ok ? "fetched" : `failed: ${p.error || "unknown"}`;
      return `### ${p.label}\n**URL:** ${p.url} (${status})\n\n${p.excerpt || "_No excerpt._"}`;
    })
    .join("\n\n");
}
