"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import GleanAnalysisView from "@/components/GleanAnalysisView";
import SupportdogLandingAuth from "@/components/SupportdogLandingAuth";
import { buildGleanSearchQuery } from "@/lib/gleanPrompt";
import { resolvePalTicketFields } from "@/lib/palExportRow";
function formatWhen(iso) {
  if (!iso) return "—";
  const s = String(iso);
  if (s.length >= 16) return s.slice(0, 16).replace("T", " ");
  return s;
}

export default function TicketAnalysisClient({ ticketId, agentTicketBase, gleanSearchBase, gleanOauthEnabled }) {
  const [rows, setRows] = useState([]);
  const [sourcePath, setSourcePath] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);
  const [analysis, setAnalysis] = useState(null);

  const [gleanOAuthStatus, setGleanOAuthStatus] = useState(() => ({
    oauthEnabled: gleanOauthEnabled,
    signedIn: false,
    gleanReady: false,
    checked: false,
  }));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [ticketRes, gleanRes] = await Promise.all([
          fetch(`/api/pal-portfolio/ticket/${encodeURIComponent(ticketId)}`),
          fetch("/api/pal-portfolio/glean/oauth/status", { cache: "no-store" }),
        ]);
        const ticketData = await ticketRes.json();
        if (!ticketRes.ok) throw new Error(ticketData.error || `HTTP ${ticketRes.status}`);
        let gleanData = { oauthEnabled: gleanOauthEnabled, signedIn: false, gleanReady: false };
        if (gleanRes.ok) {
          try {
            gleanData = await gleanRes.json();
          } catch {
            /* keep defaults */
          }
        }
        if (cancelled) return;
        setRows(Array.isArray(ticketData.rows) ? ticketData.rows : []);
        setSourcePath(ticketData.sourcePath || null);
        setGleanOAuthStatus({
          oauthEnabled: Boolean(gleanData.oauthEnabled),
          signedIn: Boolean(gleanData.signedIn),
          gleanReady: Boolean(gleanData.gleanReady),
          checked: true,
        });
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ticketId, gleanOauthEnabled]);

  const runTicketAnalyze = useCallback(
    async (signal) => {
      const res = await fetch(`/api/pal-portfolio/ticket/${encodeURIComponent(ticketId)}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        credentials: "same-origin",
        signal,
      });
      const raw = await res.text();
      let data;
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        throw new Error(
          res.ok
            ? "Server returned invalid JSON."
            : `Request failed (HTTP ${res.status}). ${raw.slice(0, 200).replace(/\s+/g, " ")}`
        );
      }
      if (!res.ok) {
        throw new Error(data.message || data.error || `HTTP ${res.status}`);
      }
      return data;
    },
    [ticketId]
  );

  useEffect(() => {
    if (!rows.length) return undefined;
    if (String(rows[0]?.ticketId || "").trim() !== String(ticketId).trim()) return undefined;

    let cancelled = false;
    const ac = new AbortController();
    const timeoutMs = 300_000;
    const tid = setTimeout(() => ac.abort(), timeoutMs);
    (async () => {
      setAnalysisLoading(true);
      setAnalysisError(null);
      setAnalysis(null);
      try {
        const data = await runTicketAnalyze(ac.signal);
        if (cancelled) return;
        setAnalysis(data);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof Error && e.name === "AbortError") {
          setAnalysisError("The summary request timed out.");
        } else {
          setAnalysisError(e.message || String(e));
        }
      } finally {
        clearTimeout(tid);
        if (!cancelled) setAnalysisLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [ticketId, rows, runTicketAnalyze]);

  const gleanQuery = useMemo(() => buildGleanSearchQuery(ticketId, rows), [ticketId, rows]);

  const gleanHref = useMemo(() => {
    if (!gleanSearchBase || !gleanQuery) return null;
    const base = gleanSearchBase.replace(/\/?$/, "");
    if (base.includes("{{query}}")) {
      return base.replace(/\{\{\s*query\s*\}\}/gi, encodeURIComponent(gleanQuery));
    }
    const join = base.includes("?") ? "&" : "?";
    return `${base}${join}q=${encodeURIComponent(gleanQuery)}`;
  }, [gleanSearchBase, gleanQuery]);

  const zdHref = agentTicketBase ? `${agentTicketBase}/${ticketId}` : null;
  const r0 = rows[0];
  const ex = useMemo(() => (r0 ? resolvePalTicketFields(r0) : null), [r0]);

  const gleanOauthStartHref = useMemo(() => {
    if (!gleanOauthEnabled) return null;
    const returnTo = `/tickets/${encodeURIComponent(String(ticketId))}`;
    return `/api/pal-portfolio/glean/oauth/start?returnTo=${encodeURIComponent(returnTo)}`;
  }, [gleanOauthEnabled, ticketId]);

  const gleanOauthLogoutHref = useMemo(() => {
    const returnTo = `/tickets/${encodeURIComponent(String(ticketId))}`;
    return `/api/pal-portfolio/glean/oauth/logout?returnTo=${encodeURIComponent(returnTo)}`;
  }, [ticketId]);

  return (
    <div className="pp-wrap">
      <nav className="pp-muted" style={{ marginBottom: "-0.5rem" }}>
        <Link href="/" className="pp-ticket-link">
          ← PAL ticket review
        </Link>
      </nav>

      <header className="pp-header">
        <h1 className="pp-title">
          Ticket{" "}
          {zdHref ? (
            <a href={zdHref} target="_blank" rel="noopener noreferrer" className="pp-ticket-link" title="Open in Zendesk">
              {ticketId}
            </a>
          ) : (
            ticketId
          )}
        </h1>
        {sourcePath ? <p className="pp-path">Data: {sourcePath}</p> : null}
      </header>

      {loading ? <p className="pp-muted">Loading ticket…</p> : null}
      {error ? <p className="pp-error">{error}</p> : null}

      {!loading && !error && r0 ? (
        <>
          <div className="pp-card" style={{ marginBottom: "1rem" }}>
            <h2 className="pp-label" style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Investigation (SupportDog MCP)
            </h2>
            <SupportdogLandingAuth compact />
            <p className="pp-muted" style={{ fontSize: "0.875rem", lineHeight: 1.55, marginTop: "0.75rem", marginBottom: "0.75rem" }}>
              Summaries follow the <strong>investigation-playbook</strong> (SupportDog ticket + org, optional Glean
              Confluence).
            </p>
            {gleanOauthEnabled ? (
              <p className="pp-muted" style={{ fontSize: "0.875rem", marginBottom: "0.65rem" }}>
                {gleanOAuthStatus.signedIn ? (
                  <>
                    Signed in ·{" "}
                    <a href={gleanOauthLogoutHref} className="pp-ticket-link">
                      Sign out
                    </a>
                  </>
                ) : gleanOAuthStatus.checked && gleanOAuthStatus.gleanReady ? (
                  <>Server Glean token is configured — SSO is optional.</>
                ) : gleanOauthStartHref ? (
                  <>
                    <a href={gleanOauthStartHref} className="pp-btn pp-btn-primary" style={{ display: "inline-block" }}>
                      Sign in with Glean
                    </a>
                    <span className="pp-muted" style={{ marginLeft: "0.75rem", fontSize: "0.8125rem" }}>
                      Required when the server has no static Glean token.
                    </span>
                  </>
                ) : null}
              </p>
            ) : gleanOAuthStatus.checked && gleanOAuthStatus.gleanReady ? (
              <p className="pp-muted" style={{ fontSize: "0.875rem" }}>
                Glean is ready (server credentials).
              </p>
            ) : null}
            {gleanOAuthStatus.checked && gleanOAuthStatus.oauthEnabled && !gleanOAuthStatus.gleanReady ? (
              <p className="pp-error" style={{ marginBottom: 0, lineHeight: 1.55, fontSize: "0.875rem" }}>
                Glean is not configured on the server. Set <code>GLEAN_INSTANCE_URL</code> and a token or OAuth in{" "}
                <code>.env.local</code>.
              </p>
            ) : null}
            {gleanOAuthStatus.gleanReady && !zdHref ? (
              <p className="pp-error" style={{ marginBottom: 0, lineHeight: 1.55, fontSize: "0.875rem" }}>
                Add <code>ZENDESK_SUBDOMAIN</code> or <code>ZENDESK_AGENT_TICKET_URL_PREFIX</code> so this app can request
                the indexed agent ticket URL from Glean.
              </p>
            ) : null}
          </div>

          <div className="pp-card">
            <h2 className="pp-label" style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              From export
            </h2>
            <dl className="pp-dl">
              <div>
                <dt>Subject</dt>
                <dd>{ex?.ticketSubject || "—"}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd className="pp-cap">{ex?.ticketStatus || "—"}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatWhen(ex?.ticketCreatedTimestamp)}</dd>
              </div>
              <div>
                <dt>Salesforce account</dt>
                <dd>{ex?.salesforceAccountName || "—"}</dd>
              </div>
              <div>
                <dt>Zendesk org</dt>
                <dd>{ex?.zendeskOrgName || "—"}</dd>
              </div>
              <div>
                <dt>Product</dt>
                <dd>{ex?.primaryProductComponent || "—"}</dd>
              </div>
              <div>
                <dt>Impact</dt>
                <dd className="pp-cap">{ex?.ticketImpact || "—"}</dd>
              </div>
              <div>
                <dt>PAL context</dt>
                <dd>
                  {(ex?.palAssembledName || ex?.palLiaisonSfName || "—") + " "}
                  {ex?.palLiaisonEmail ? <span className="pp-muted">({ex.palLiaisonEmail})</span> : null}
                </dd>
              </div>
            </dl>
            <div className="pp-actions">
              {zdHref ? (
                <a href={zdHref} target="_blank" rel="noreferrer" className="pp-btn pp-btn-primary">
                  Open in Zendesk
                </a>
              ) : null}
              {gleanHref ? (
                <a href={gleanHref} target="_blank" rel="noreferrer" className="pp-btn">
                  Open Glean search
                </a>
              ) : null}
            </div>
          </div>

          {analysis?.threadEvidence === "none" && analysis?.disabled !== true ? (
            <div
              className="pp-card"
              style={{
                marginBottom: "1rem",
                border: "2px solid #b45309",
                background: "rgba(180, 83, 9, 0.08)",
              }}
            >
              <h2 className="pp-label" style={{ fontSize: "0.8rem", color: "#92400e" }}>
                Limited conversation text
              </h2>
              <p style={{ margin: 0, lineHeight: 1.55, fontSize: "0.9rem", color: "#451a03" }}>
                The export has routing fields only.{" "}
                {analysis?.gleanZendeskDocStatus && analysis.gleanZendeskDocStatus !== "ok" ? (
                  <>
                    <strong>Glean indexed ticket:</strong>{" "}
                    {analysis.gleanZendeskDocStatus === "no_agent_url"
                      ? "Set ZENDESK_SUBDOMAIN or ZENDESK_AGENT_TICKET_URL_PREFIX in pal-portfolio/.env.local, then refresh."
                      : analysis.gleanZendeskDocStatus === "empty_documents"
                        ? "Glean returned no document for that URL (sync, URL mismatch, or token not accepted for REST/MCP — see server logs with GLEAN_DEBUG=true)."
                        : analysis.gleanZendeskDocDetail
                          ? String(analysis.gleanZendeskDocDetail).replace(/\s+/g, " ").slice(0, 320)
                          : `Status: ${analysis.gleanZendeskDocStatus}.`}{" "}
                  </>
                ) : (
                  <>
                    Ensure you are <strong>signed in to Glean</strong> with document scopes, then refresh this page. If
                    the indexed ticket still does not load, check <code>GLEAN_DEBUG=true</code> server logs.
                  </>
                )}
              </p>
            </div>
          ) : null}

          <div className="pp-card">
            {analysis?.mode === "export_fallback_no_ai" && analysis?.disabled !== true ? (
              <p className="pp-muted" style={{ marginBottom: "0.75rem", lineHeight: 1.55, fontSize: "0.8125rem" }}>
                Export-only stub: set <code>ANTHROPIC_API_KEY</code> and/or full Glean config, then restart{" "}
                <code>npm run dev</code>.
              </p>
            ) : null}
            {analysis?.zendeskStatus === "not_configured" && analysis?.disabled !== true ? (
              <p className="pp-muted" style={{ marginBottom: "0.75rem", lineHeight: 1.55, fontSize: "0.8125rem" }}>
                Optional: <code>ZENDESK_EMAIL</code> + <code>ZENDESK_API_TOKEN</code> add a live Support API thread in
                addition to Glean.
              </p>
            ) : null}
            {analysis?.gleanZendeskInsufficientScope && analysis?.disabled !== true ? (
              <p className="pp-error" style={{ marginBottom: "0.75rem", lineHeight: 1.55, fontSize: "0.875rem" }}>
                Glean <strong>insufficient_scope</strong> for the indexed ticket. <strong>Sign out</strong> of Glean here,
                then <strong>Sign in</strong> again so consent includes document and MCP scopes (the app matches your
                tenant&apos;s <code>scopes_supported</code>, e.g. <code>documents</code>, <code>tools</code>,{" "}
                <code>mcp</code> — not legacy uppercase <code>SEARCH</code>). If it persists, clear Glean cookies here
                (logout) so dynamic registration runs again, or ask your Glean admin about scope policy.
              </p>
            ) : null}
            {analysis?.gleanZendeskDocStatus === "http_error" &&
            !analysis?.gleanZendeskInsufficientScope &&
            analysis?.gleanZendeskDocDetail &&
            analysis?.disabled !== true ? (
              <p className="pp-muted" style={{ marginBottom: "0.75rem", lineHeight: 1.55, fontSize: "0.8125rem" }}>
                Glean indexed ticket: {analysis.gleanZendeskDocDetail}
              </p>
            ) : null}
            {analysis?.disabled !== true && analysis?.gleanZendeskDocStatus === "no_agent_url" ? (
              <p className="pp-error" style={{ marginBottom: "0.75rem", lineHeight: 1.55, fontSize: "0.875rem" }}>
                Configure <code>ZENDESK_SUBDOMAIN</code> or <code>ZENDESK_AGENT_TICKET_URL_PREFIX</code> in{" "}
                <code>pal-portfolio/.env.local</code>, restart the dev server, then refresh.
              </p>
            ) : null}
            <GleanAnalysisView
              loading={analysisLoading}
              loadingTitle="Running investigation playbook (SupportDog)…"
              loadingHint="This can take up to a few minutes when Glean or Claude runs."
              fetchError={analysisError}
              disabled={analysis?.disabled === true}
              disabledMessage={analysis?.message || ""}
              markdown={analysis?.disabled ? "" : analysis?.text || ""}
              citations={!analysis?.disabled && Array.isArray(analysis?.citations) ? analysis.citations : []}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
