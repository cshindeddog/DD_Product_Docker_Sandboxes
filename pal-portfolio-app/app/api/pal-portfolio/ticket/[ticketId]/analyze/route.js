import { NextResponse } from "next/server";
import { attachGleanSessionCookie } from "@/lib/gleanOAuthSession";
import { runInvestigationPlaybook } from "@/lib/investigationPlaybookOrchestrator";
import { canRunSupportdogInvestigation } from "@/lib/supportdogMcpClient";
import {
  attachSupportdogSessionCookie,
  attachSupportdogSessionForDatacenter,
  isSupportdogOAuthConfigured,
} from "@/lib/supportdogOAuthSession";
import { loadPalPortfolioRows } from "@/lib/palPortfolio";
import { buildExportFallbackMarkdown } from "@/lib/ticketExportFallbackSummary";
import { supportdogPlaybookConnectivityMessage } from "@/lib/investigationPlaybookMessages";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * @param {unknown} data
 * @param {string | null | undefined} gleanSessionSeal
 * @param {string | null | undefined} supportdogSessionSeal
 * @param {string | null | undefined} supportdogDatacenter
 */
function jsonWithSessionCookies(data, gleanSessionSeal, supportdogSessionSeal, supportdogDatacenter) {
  const res = NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  if (gleanSessionSeal) attachGleanSessionCookie(res, gleanSessionSeal);
  if (supportdogSessionSeal && supportdogDatacenter) {
    attachSupportdogSessionForDatacenter(res, supportdogSessionSeal, supportdogDatacenter);
  } else if (supportdogSessionSeal) {
    attachSupportdogSessionCookie(res, supportdogSessionSeal);
  }
  return res;
}

async function loadMatchesOrError(ticketId) {
  const { path: sourcePath, rows } = loadPalPortfolioRows();
  if (!sourcePath) {
    return { error: NextResponse.json({ error: "PAL portfolio CSV not found" }, { status: 404 }) };
  }
  const matches = rows.filter((r) => String(r.ticketId).trim() === ticketId);
  if (matches.length === 0) {
    return { error: NextResponse.json({ error: "Ticket not found in export" }, { status: 404 }) };
  }
  return { sourcePath, matches };
}

/**
 * GET / POST — investigation-playbook Steps 3–9 (SupportDog + Glean + docs + synthesis).
 */
export async function GET(request, ctx) {
  return handleAnalyze(request, ctx);
}

export async function POST(request, ctx) {
  return handleAnalyze(request, ctx);
}

async function handleAnalyze(request, ctx) {
  const resolved = await ctx.params;
  const ticketId = resolved?.ticketId != null ? String(resolved.ticketId).trim() : "";
  if (!ticketId) {
    return NextResponse.json({ error: "Missing ticket id" }, { status: 400 });
  }

  const loaded = await loadMatchesOrError(ticketId);
  if ("error" in loaded) return loaded.error;

  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  const model = process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-5-20250929";
  const useGlean =
    !["0", "false", "no"].includes(String(process.env.INVESTIGATION_PLAYBOOK_GLEAN || "true").trim().toLowerCase());

  const supportdogConfigured = canRunSupportdogInvestigation(request);

  if (!anthropicKey) {
    const hint = supportdogConfigured
      ? "Sign in to SupportDog regions in the header, then set ANTHROPIC_API_KEY for full Step 9 synthesis."
      : supportdogPlaybookConnectivityMessage("EU1");
    return jsonWithSessionCookies(
      {
        disabled: false,
        mode: "export_fallback_no_anthropic",
        ticketId,
        sourcePath: loaded.sourcePath,
        text: buildExportFallbackMarkdown(ticketId, loaded.matches, loaded.sourcePath, { gleanHint: hint }),
        citations: [],
        setupHint: hint,
        supportdogStatus: supportdogConfigured ? "configured" : "not_configured",
      },
      null,
      null,
      null
    );
  }

  if (!supportdogConfigured && !isSupportdogOAuthConfigured()) {
    const hint = supportdogPlaybookConnectivityMessage("EU1");
    const out = await runInvestigationPlaybook({
      ticketId,
      rows: loaded.matches,
      request,
      apiKey: anthropicKey,
      model,
      useGlean,
    });
    if (!out.claude.ok) {
      return jsonWithSessionCookies(
        {
          error: "Investigation summary failed",
          message: out.claude.message,
          ticketId,
        },
        out.gleanSessionSeal,
        null,
        null
      );
    }
    return jsonWithSessionCookies(
      {
        disabled: false,
        mode: "investigation_playbook_partial",
        ticketId,
        sourcePath: loaded.sourcePath,
        datacenter: out.reportDatacenter,
        text: out.claude.text,
        citations: out.gleanHits.map((h) => ({
          title: h.title || "Glean",
          url: h.url || "",
          snippet: (h.snippet || "").slice(0, 500),
        })),
        supportdogStatus: "not_configured",
        gleanStatus: out.gleanAvailable ? "ok" : out.gleanConfigured ? "no_hits" : "not_configured",
        setupHint: hint,
      },
      out.gleanSessionSeal,
      null,
      null
    );
  }

  const out = await runInvestigationPlaybook({
    ticketId,
    rows: loaded.matches,
    request,
    apiKey: anthropicKey,
    model,
    useGlean,
  });

  if (!out.claude.ok) {
    const status = out.claude.status && out.claude.status >= 400 && out.claude.status < 600 ? out.claude.status : 502;
    const res = jsonWithSessionCookies(
      {
        error: "Investigation summary failed",
        message: out.claude.message,
        status: out.claude.status,
        ticketId,
        datacenter: out.reportDatacenter,
        supportdogStatus: out.sd.ok ? "ok" : "error",
      },
      out.gleanSessionSeal,
      null,
      null
    );
    return new NextResponse(res.body, { status, headers: res.headers });
  }

  const citations = out.gleanHits.map((h) => ({
    title: h.title || "Glean",
    url: h.url || "",
    snippet: (h.snippet || "").slice(0, 500),
  }));

  return jsonWithSessionCookies(
    {
      disabled: false,
      mode: out.sd.ok ? "investigation_playbook_supportdog" : "investigation_playbook_partial",
      ticketId,
      sourcePath: loaded.sourcePath,
      datacenter: out.reportDatacenter,
      supportdogQueryDatacenter: out.sd.datacenter || out.reportDatacenter,
      preferredDatacenter: out.sd.preferredDatacenter,
      datacenterMismatch: out.sd.datacenterMismatch || null,
      text: out.claude.text,
      citations,
      supportdogStatus: out.sd.ok ? "ok" : "error",
      supportdogError: out.sd.ok ? null : out.sd.message,
      supportdogOrgId: out.sd.orgId || null,
      gleanStatus: out.gleanAvailable ? "ok" : out.gleanConfigured ? "no_hits" : "not_configured",
      gleanAvailable: out.gleanAvailable,
      gleanDiagnostics: out.gleanSearchErrors.slice(0, 8),
      docsFetched: out.docsOut.pages.filter((p) => p.ok).map((p) => p.url),
      threadEvidence: out.sd.ok ? "full" : "export_and_glean",
      setupHint: out.sd.ok ? null : out.step3.message,
    },
    out.gleanSessionSeal,
    null,
    null
  );
}
