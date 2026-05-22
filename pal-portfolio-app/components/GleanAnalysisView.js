"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { formatInvestigationSummaryForDisplay } from "@/lib/stripSourcesUsedFromSummary";

function safeHttpUrl(href) {
  if (!href || typeof href !== "string") return null;
  const t = href.trim();
  if (t.startsWith("https://") || t.startsWith("http://")) return t;
  return null;
}

/**
 * @param {object} props
 * @param {boolean} props.loading
 * @param {string} [props.loadingTitle] — omit or leave empty for no loading copy
 * @param {string} [props.loadingHint]
 * @param {string | null} props.fetchError
 * @param {boolean} [props.disabled]
 * @param {string} [props.disabledMessage]
 * @param {string} [props.markdown]
 * @param {{ title?: string, url?: string, snippet?: string }[]} [props.citations]
 * @param {boolean} [props.showSources] — when false, hides citation list and `### Sources Used` in markdown
 */
export default function GleanAnalysisView({
  loading,
  loadingTitle = "",
  loadingHint = "",
  fetchError,
  disabled = false,
  disabledMessage = "",
  markdown = "",
  citations = [],
  showSources = true,
}) {
  if (loading) {
    if (!loadingTitle && !loadingHint) {
      return <div aria-busy="true" className="pp-muted" style={{ minHeight: "0.5rem" }} />;
    }
    return (
      <div className="pp-muted" style={{ lineHeight: 1.55 }}>
        {loadingTitle ? <p style={{ margin: 0 }}>{loadingTitle}</p> : null}
        {loadingHint ? (
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.8rem", maxWidth: "40rem" }}>{loadingHint}</p>
        ) : null}
      </div>
    );
  }
  if (fetchError) {
    return <p className="pp-error">{fetchError}</p>;
  }
  if (disabled && disabledMessage) {
    return <p className="pp-muted">{disabledMessage}</p>;
  }
  const displayMarkdown = formatInvestigationSummaryForDisplay(markdown, { showSources });
  if (!displayMarkdown?.trim()) {
    return <p className="pp-muted">No summary was returned.</p>;
  }

  return (
    <>
      <div className="pp-analysis-body pp-md">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a({ href, children }) {
              const u = safeHttpUrl(href);
              if (!u) return <span>{children}</span>;
              return (
                <a href={u} target="_blank" rel="noreferrer">
                  {children}
                </a>
              );
            },
          }}
        >
          {displayMarkdown}
        </ReactMarkdown>
      </div>
      {showSources && citations.length > 0 ? (
        <div className="pp-citations">
          <h3 className="pp-citations-title">Sources</h3>
          <ul className="pp-citation-list">
            {citations.map((c, i) => {
              const href = safeHttpUrl(c.url);
              return (
                <li key={`${c.title}-${i}`} className="pp-citation-item">
                  {href ? (
                    <a href={href} target="_blank" rel="noreferrer" className="pp-ticket-link">
                      {c.title || "Link"}
                    </a>
                  ) : (
                    <span className="pp-text-strong">{c.title || "Source"}</span>
                  )}
                  {c.snippet ? <p className="pp-citation-snippet">{c.snippet}</p> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </>
  );
}
