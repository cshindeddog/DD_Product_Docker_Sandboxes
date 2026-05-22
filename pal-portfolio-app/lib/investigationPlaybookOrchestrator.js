import { fetchDatadogDocsForTicket, formatDatadogDocsMarkdown } from "@/lib/datadogDocsFetch";
import { formatGithubSourceReviewMarkdown, pickGithubReposForTicket } from "@/lib/githubSourceReview";
import {
  claudeInvestigationPlaybookSummary,
  gleanHitsForInvestigationPlaybook,
} from "@/lib/claudeInvestigationPlaybook";
import { gleanPlaybookConnectivityMessage, supportdogPlaybookConnectivityMessage } from "@/lib/investigationPlaybookMessages";
import { fetchSupportdogInvestigationContext } from "@/lib/supportdogInvestigationContext";
import { buildExportFactsBlock } from "@/lib/claudeTicketAnalysis";

/**
 * Run investigation-playbook Steps 3–8 and synthesize via Claude (Step 9).
 * @param {object} opts
 * @param {string} opts.ticketId
 * @param {Record<string, string>[]} opts.rows
 * @param {Request | null | undefined} opts.request
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {boolean} opts.useGlean
 */
export async function runInvestigationPlaybook({ ticketId, rows, request, apiKey, model, useGlean }) {
  const sd = await fetchSupportdogInvestigationContext(ticketId, null, request);
  const reportDatacenter = sd.resolvedDatacenter || sd.datacenter || "US1";

  const step3 = {
    connected: Boolean(sd.ok),
    datacenter: reportDatacenter,
    queryDatacenter: sd.datacenter || reportDatacenter,
    message: sd.ok
      ? `SupportDog MCP (**supportdog-mcp-${String(sd.datacenter || reportDatacenter).toLowerCase()}**) connected and authenticated.`
      : supportdogPlaybookConnectivityMessage(sd.datacenter || reportDatacenter),
    error: sd.ok ? null : sd.message,
  };

  const exportBlock = buildExportFactsBlock(rows, ticketId);
  const corpus = [
    rows?.[0]?.ticketSubject,
    rows?.[0]?.primaryProductComponent,
    exportBlock,
    sd.rawTicketText || "",
    sd.markdown || "",
  ]
    .filter(Boolean)
    .join("\n");

  let gleanConfigured = false;
  let gleanAvailable = false;
  let gleanHits = [];
  let gleanSearchErrors = [];
  let gleanSessionSeal = null;
  let gleanBlock = "";

  if (useGlean) {
    const gleanOut = await gleanHitsForInvestigationPlaybook(ticketId, rows, request, corpus);
    gleanConfigured = gleanOut.gleanConfigured;
    gleanAvailable = gleanOut.gleanAvailable;
    gleanHits = gleanOut.gleanHits;
    gleanSearchErrors = gleanOut.gleanSearchErrors;
    gleanSessionSeal = gleanOut.refreshedSessionSeal;
    gleanBlock = gleanOut.evidenceMarkdown;
  }

  const step5 = {
    glean_available: gleanAvailable,
    glean_configured: gleanConfigured,
    message: gleanAvailable
      ? "Glean search succeeded — internal Confluence/index snippets included below (Step 7)."
      : gleanConfigured
        ? `Glean is configured but returned no usable results.${gleanSearchErrors.length ? ` Errors: ${gleanSearchErrors.slice(0, 3).join("; ")}` : ""}`
        : gleanPlaybookConnectivityMessage(),
  };

  const docsOut = await fetchDatadogDocsForTicket(corpus);
  const docsMarkdown = formatDatadogDocsMarkdown(docsOut.pages);

  const githubRepos = pickGithubReposForTicket(corpus);
  const githubMarkdown = formatGithubSourceReviewMarkdown(githubRepos);

  const playbookContext = buildPlaybookContextMarkdown({
    ticketId,
    reportDatacenter,
    step3,
    step4: sd,
    step5,
    exportBlock,
    docsMarkdown,
    githubMarkdown,
    gleanBlock,
  });

  const claude = await claudeInvestigationPlaybookSummary({
    ticketId,
    rows,
    datacenter: reportDatacenter,
    playbookContext,
    gleanAvailable,
    apiKey,
    model,
  });

  return {
    sd,
    reportDatacenter,
    step3,
    step5,
    gleanConfigured,
    gleanAvailable,
    gleanHits,
    gleanSearchErrors,
    gleanSessionSeal,
    docsOut,
    githubRepos,
    claude,
    playbookContext,
  };
}

/**
 * @param {object} p
 */
function buildPlaybookContextMarkdown(p) {
  const step4Body = p.step4?.ok
    ? `${p.step4.ticketContextSummary || "_Ticket/org summary not generated._"}\n\n${p.step4.markdown || ""}`
    : `_SupportDog Step 4 skipped — ${p.step3.message}_`;

  return [
    `## STEP 3 — SupportDog MCP connectivity`,
    `connected: ${p.step3.connected}`,
    `datacenter (report): ${p.reportDatacenter}`,
    `query_datacenter: ${p.step3.queryDatacenter}`,
    p.step3.message,
    p.step3.error ? `\nError detail: ${p.step3.error}` : "",
    "",
    `## STEP 4 — SupportDog ticket and org context`,
    step4Body,
    "",
    `## STEP 5 — Glean connectivity`,
    `glean_available: ${p.step5.glean_available}`,
    `glean_configured: ${p.step5.glean_configured}`,
    p.step5.message,
    "",
    p.step5.glean_available ? `## STEP 7 — Glean / Confluence search results\n${p.gleanBlock}` : `## STEP 7 — Skipped (glean_available = false)\n`,
    "",
    `## STEP 6 — docs.datadoghq.com (public documentation excerpts)`,
    p.docsMarkdown,
    "",
    `## STEP 8 — GitHub source review (hints)`,
    p.githubMarkdown,
    "",
    `## PAL CSV export (routing metadata)`,
    p.exportBlock,
  ]
    .filter(Boolean)
    .join("\n");
}
