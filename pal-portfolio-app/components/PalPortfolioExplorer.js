"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import GleanAnalysisView from "@/components/GleanAnalysisView";
import GleanLandingAuth from "@/components/GleanLandingAuth";
import SupportdogLandingAuth from "@/components/SupportdogLandingAuth";
import { buildCustomerReportKpiDashboardUrl } from "@/lib/customerReportMetabaseUrl";
import {
  buildCustomerCallHighlights,
  DEFAULT_HIGHLIGHT_TRAILING_DAYS,
  defaultHighlightDateRange,
  ticketsInHighlightWindow,
} from "@/lib/palPortfolioCallHighlights";
import { rowWithGleanTicketStatus } from "@/lib/palPortfolioGleanStatusOverlay";
import {
  computeOpenTicketPriority,
  groupTicketsByStatus,
  isClosedTicketStatus,
  isOpenLikeStatus,
  isTerminalTicketStatus,
  ticketCreatedMs,
  ticketSolvedAtMs,
  ticketUpdatedMs,
} from "@/lib/palPortfolioTicketPrioritization";

/** @param {string} categoryId @param {string} ticketId */
function highlightBriefingKey(categoryId, ticketId) {
  return `${categoryId}:${ticketId}`;
}

/**
 * @param {{
 *   categoryId: string;
 *   title: string;
 *   items: {
 *     ticketId: string;
 *     subject: string;
 *     reviewReason: string;
 *     frJiraKey?: string | null;
 *     frJiraUrl?: string | null;
 *     status?: string;
 *     assigneeName?: string;
 *     csatComment?: string;
 *   }[];
 *   layout?: "default" | "csat";
 *   agentTicketBase: string | null;
 *   highlightExpandedKey: string | null;
 *   onHighlightBriefingClick: (categoryId: string, ticketId: string) => void | Promise<void>;
 *   rowAnalysisLoadingKey: string | null;
 *   analysisByTicket: Record<string, unknown>;
 *   jiraIssueByKey?: Record<string, { key?: string; status?: string | null; assignee?: string | null; summary?: string | null } | null>;
 * }} props
 */
function HighlightCategory({
  categoryId,
  title,
  items,
  layout = "default",
  agentTicketBase,
  highlightExpandedKey,
  onHighlightBriefingClick,
  rowAnalysisLoadingKey,
  analysisByTicket,
  jiraIssueByKey = {},
}) {
  if (!items?.length) return null;
  const isCsat = layout === "csat";
  const colCount = isCsat ? 7 : 4;
  return (
    <section className="pp-hl-block">
      <h3>{title}</h3>
      <div className="pp-table-wrap pp-hl-table-wrap">
        <table className="pp-table pp-hl-table">
          <thead>
            <tr>
              <th className="pp-hl-col-show">Show</th>
              <th>Ticket</th>
              <th>Subject</th>
              {isCsat ? (
                <>
                  <th>Status</th>
                  <th>Assignee</th>
                  <th>CSAT comment</th>
                </>
              ) : null}
              <th>Why highlighted</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const rowKey = highlightBriefingKey(categoryId, it.ticketId);
              const zd = agentTicketBase ? `${String(agentTicketBase).replace(/\/$/, "")}/${it.ticketId}` : null;
              const briefingOpen = highlightExpandedKey === rowKey;
              const rowAnalysis = analysisByTicket[it.ticketId];
              const ra = rowAnalysis && typeof rowAnalysis === "object" ? rowAnalysis : {};
              const fetchErr = typeof ra.fetchError === "string" ? ra.fetchError : null;
              const dis = ra.disabled === true;
              const msg = typeof ra.message === "string" ? ra.message : "";
              const md = typeof ra.text === "string" ? ra.text : "";
              return (
                <Fragment key={rowKey}>
                  <tr className="pp-hl-table-row">
                    <td className="pp-hl-col-show">
                      <button
                        type="button"
                        className="pp-briefing-toggle"
                        onClick={() => void onHighlightBriefingClick(categoryId, it.ticketId)}
                        aria-expanded={briefingOpen}
                      >
                        {briefingOpen ? "Hide" : "Show"}
                      </button>
                    </td>
                    <td className="pp-nowrap">
                      {zd ? (
                        <a
                          href={zd}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="pp-ticket-link"
                          title="Open in Zendesk"
                        >
                          #{it.ticketId}
                        </a>
                      ) : (
                        <Link
                          href={`/tickets/${encodeURIComponent(it.ticketId)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="pp-ticket-link"
                        >
                          #{it.ticketId}
                        </Link>
                      )}
                      {it.frJiraUrl ? (
                        <>
                          <br />
                          <a
                            href={it.frJiraUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="pp-ticket-link pp-fr-jira"
                            title="Open linked Jira issue"
                          >
                            {it.frJiraKey || "Jira"}
                          </a>
                          {(() => {
                            const ji = it.frJiraKey ? jiraIssueByKey[it.frJiraKey] : null;
                            if (!ji || (!ji.status && !ji.assignee && !ji.summary)) return null;
                            const parts = [];
                            if (ji.status) parts.push(ji.status);
                            if (ji.assignee) parts.push(ji.assignee);
                            const line = parts.length ? parts.join(" · ") : null;
                            return (
                              <>
                                <br />
                                <span className="pp-jira-meta" title={ji.summary || undefined}>
                                  {line || (ji.summary ? String(ji.summary).slice(0, 48) : null)}
                                </span>
                              </>
                            );
                          })()}
                        </>
                      ) : null}
                    </td>
                    <td className="pp-hl-subject-cell">{it.subject}</td>
                    {isCsat ? (
                      <>
                        <td className="pp-xs pp-nowrap">{it.status || "—"}</td>
                        <td className="pp-xs">{it.assigneeName || "—"}</td>
                        <td className="pp-hl-csat-cell" title={it.csatComment || ""}>
                          {it.csatComment || "—"}
                        </td>
                      </>
                    ) : null}
                    <td className="pp-hl-reason-cell">{it.reviewReason}</td>
                  </tr>
                  {briefingOpen ? (
                    <tr className="pp-table-expand">
                      <td colSpan={colCount}>
                        <div className="pp-hl-briefing">
                          <GleanAnalysisView
                            loading={rowAnalysisLoadingKey === rowKey}
                            loadingTitle="Running investigation playbook (SupportDog)…"
                            loadingHint=""
                            fetchError={fetchErr}
                            disabled={dis}
                            disabledMessage={msg}
                            markdown={dis ? "" : md}
                            showSources={false}
                          />
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function engineerLabel(row) {
  const name = row.palAssembledName || row.palLiaisonSfName || "";
  const email = row.palLiaisonEmail || "";
  if (name && email) return `${name} (${email})`;
  return email || name || "Unknown";
}

/** @param {{ name: string; datadogOrgId?: string }} account */
function palAccountOptionLabel(account) {
  const name = String(account.name || "").trim() || "—";
  const orgId = String(account.datadogOrgId || "").trim();
  return orgId ? `${name} · org ${orgId}` : name;
}

function formatWhen(iso) {
  if (!iso) return "—";
  const s = String(iso);
  if (s.length >= 16) return s.slice(0, 16).replace("T", " ");
  return s;
}

function parseTicketMs(row) {
  const s = row?.ticketCreatedTimestamp;
  if (!s) return null;
  const t = new Date(String(s)).getTime();
  return Number.isNaN(t) ? null : t;
}

function toYyyyMmDd(ms) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfDayLocal(yyyyMmDd) {
  if (!yyyyMmDd) return null;
  const parts = yyyyMmDd.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  const [y, mo, da] = parts;
  return new Date(y, mo - 1, da, 0, 0, 0, 0).getTime();
}

function endOfDayLocal(yyyyMmDd) {
  if (!yyyyMmDd) return null;
  const parts = yyyyMmDd.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  const [y, mo, da] = parts;
  return new Date(y, mo - 1, da, 23, 59, 59, 999).getTime();
}

function ticketInDateRange(row, rangeFrom, rangeTo) {
  const ms = parseTicketMs(row);
  if (ms == null) return false;
  const fromMs = rangeFrom ? startOfDayLocal(rangeFrom) : null;
  const toMs = rangeTo ? endOfDayLocal(rangeTo) : null;
  if (fromMs != null && ms < fromMs) return false;
  if (toMs != null && ms > toMs) return false;
  return true;
}

const MS_DAY = 86400000;
const CLOSED_VISIBLE_DAYS = 30;

/**
 * Solved / closed / merged rows only if solved/updated (or created if no other date) falls in the trailing
 * {@link CLOSED_VISIBLE_DAYS} days ending on the selected **To** date. Open / pending / etc. are always kept.
 * @param {Record<string, string>} row
 * @param {string} rangeToYyyyMmDd
 */
function terminalTicketInRecentCloseWindow(row, rangeToYyyyMmDd) {
  if (!isTerminalTicketStatus(row.ticketStatus)) return true;
  const endMs = endOfDayLocal(rangeToYyyyMmDd);
  if (endMs == null) return true;
  const cutoff = endMs - CLOSED_VISIBLE_DAYS * MS_DAY;
  const solved = ticketSolvedAtMs(row);
  const updated = ticketUpdatedMs(row);
  const created = ticketCreatedMs(row);
  const anchor = solved ?? updated;
  if (anchor != null) return anchor >= cutoff && anchor <= endMs;
  if (created != null) return created >= cutoff;
  return true;
}

/**
 * @param {{ agentTicketBase: string | null; gleanOauthEnabled?: boolean }} props
 */
export default function PalPortfolioExplorer({ agentTicketBase, gleanOauthEnabled = false }) {
  const [rows, setRows] = useState([]);
  const [sourcePath, setSourcePath] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSnowflakeSync, setLastSnowflakeSync] = useState(null);
  const [palEmail, setPalEmail] = useState("");
  const [accountId, setAccountId] = useState("");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [highlightFrom, setHighlightFrom] = useState("");
  const [highlightTo, setHighlightTo] = useState("");
  const [showClosedTickets, setShowClosedTickets] = useState(false);
  const [gleanStatusByTicket, setGleanStatusByTicket] = useState({});
  const [gleanStatusLoading, setGleanStatusLoading] = useState(false);
  const [gleanStatusConfigured, setGleanStatusConfigured] = useState(false);

  const [expandedTicketId, setExpandedTicketId] = useState(null);
  /** Highlights only: `${categoryId}:${ticketId}` so Show in one section does not expand others. */
  const [highlightExpandedKey, setHighlightExpandedKey] = useState(null);
  const [analysisByTicket, setAnalysisByTicket] = useState({});
  const [rowAnalysisLoadingId, setRowAnalysisLoadingId] = useState(null);
  const [rowAnalysisLoadingKey, setRowAnalysisLoadingKey] = useState(null);
  const [commentSentimentByTicket, setCommentSentimentByTicket] = useState({});
  /** Resolved via Zendesk API when export did not contain FR-#### (see `/api/pal-portfolio/call-prep/resolve-fr-jira`). */
  const [frJiraByTicket, setFrJiraByTicket] = useState({});
  /** Summary/status from Glean-indexed Jira (`/api/pal-portfolio/call-prep/jira-issues`). */
  const [jiraIssueByKey, setJiraIssueByKey] = useState({});
  const [csatHighlights, setCsatHighlights] = useState({
    loading: false,
    configured: false,
    bad: [],
    good: [],
    error: null,
  });
  const selectionRef = useRef({ palEmail: "", accountId: "" });
  selectionRef.current = { palEmail, accountId };

  const loadPortfolioData = useCallback(async ({ isRefresh = false, syncSnowflake = false } = {}) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setLoadError(null);
    try {
      if (syncSnowflake) {
        const sfRes = await fetch("/api/pal-portfolio/refresh-from-snowflake", {
          method: "POST",
          cache: "no-store",
        });
        const sfData = await sfRes.json();
        if (!sfRes.ok) {
          throw new Error(sfData.error || `Snowflake export failed (HTTP ${sfRes.status})`);
        }
        if (sfData.exportedAt) setLastSnowflakeSync(sfData.exportedAt);
        if (sfData.sourcePath) setSourcePath(sfData.sourcePath);
      }

      const res = await fetch("/api/pal-portfolio", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.hint || `HTTP ${res.status}`);
      const newRows = Array.isArray(data.rows) ? data.rows : [];
      setRows(newRows);
      setSourcePath(data.sourcePath || null);

      if (isRefresh) {
        const { palEmail: curPal, accountId: curAcct } = selectionRef.current;
        let nextPal = curPal;
        let nextAcct = curAcct;
        if (curPal && !newRows.some((r) => r.palLiaisonEmail === curPal)) {
          nextPal = "";
          nextAcct = "";
        } else if (
          curAcct &&
          !newRows.some((r) => r.palLiaisonEmail === curPal && r.salesforceAccountId === curAcct)
        ) {
          nextAcct = "";
        }
        setPalEmail(nextPal);
        setAccountId(nextAcct);
        setExpandedTicketId(null);
        setHighlightExpandedKey(null);
        setAnalysisByTicket({});
        setRowAnalysisLoadingId(null);
        setRowAnalysisLoadingKey(null);
        setCommentSentimentByTicket({});
        setFrJiraByTicket({});
        setCsatHighlights({ loading: false, configured: false, bad: [], good: [], error: null });
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const refreshPortfolioData = useCallback(
    () => loadPortfolioData({ isRefresh: true, syncSnowflake: true }),
    [loadPortfolioData]
  );

  useEffect(() => {
    setExpandedTicketId(null);
    setHighlightExpandedKey(null);
    setAnalysisByTicket({});
    setRowAnalysisLoadingId(null);
    setRowAnalysisLoadingKey(null);
    setCommentSentimentByTicket({});
    setCsatHighlights({ loading: false, configured: false, bad: [], good: [], error: null });
    setHighlightFrom("");
    setHighlightTo("");
  }, [palEmail, accountId]);

  useEffect(() => {
    void loadPortfolioData();
  }, [loadPortfolioData]);

  const ticketBounds = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const r of rows) {
      const ms = parseTicketMs(r);
      if (ms == null) continue;
      min = Math.min(min, ms);
      max = Math.max(max, ms);
    }
    if (min === Infinity) return { minStr: "", maxStr: "", minMs: null, maxMs: null };
    return { minStr: toYyyyMmDd(min), maxStr: toYyyyMmDd(max), minMs: min, maxMs: max };
  }, [rows]);

  useEffect(() => {
    if (!rows.length || !ticketBounds.minStr) return;
    setRangeFrom(ticketBounds.minStr);
    setRangeTo(ticketBounds.maxStr);
  }, [rows, ticketBounds.minStr, ticketBounds.maxStr]);

  const applyFullDataRange = useCallback(() => {
    if (ticketBounds.minStr && ticketBounds.maxStr) {
      setRangeFrom(ticketBounds.minStr);
      setRangeTo(ticketBounds.maxStr);
    }
  }, [ticketBounds.minStr, ticketBounds.maxStr]);

  const applyPresetDays = useCallback(
    (days) => {
      if (ticketBounds.maxMs == null) return;
      const end = new Date(ticketBounds.maxMs);
      const start = new Date(ticketBounds.maxMs);
      start.setDate(start.getDate() - (days - 1));
      setRangeFrom(toYyyyMmDd(start.getTime()));
      setRangeTo(toYyyyMmDd(end.getTime()));
    },
    [ticketBounds.maxMs]
  );

  const engineers = useMemo(() => {
    const byEmail = new Map();
    for (const r of rows) {
      const email = r.palLiaisonEmail;
      if (!email || byEmail.has(email)) continue;
      byEmail.set(email, r);
    }
    return [...byEmail.entries()]
      .map(([email, row]) => ({ email, row, label: engineerLabel({ ...row, palLiaisonEmail: email }) }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
  }, [rows]);

  const accountsForPal = useMemo(() => {
    if (!palEmail) return [];
    const byId = new Map();
    for (const r of rows) {
      if (r.palLiaisonEmail !== palEmail) continue;
      const id = r.salesforceAccountId;
      if (!id) continue;
      const orgId = String(r.datadogOrgId || "").trim();
      const existing = byId.get(id);
      if (!existing) {
        byId.set(id, {
          id,
          name: r.salesforceAccountName || id,
          zendeskOrgName: r.zendeskOrgName || "",
          datadogOrgId: orgId,
        });
        continue;
      }
      if (!existing.datadogOrgId && orgId) existing.datadogOrgId = orgId;
      if (!existing.zendeskOrgName && r.zendeskOrgName) existing.zendeskOrgName = r.zendeskOrgName;
    }
    return [...byId.values()].sort((a, b) =>
      String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" })
    );
  }, [rows, palEmail]);

  const selectedAccount = useMemo(
    () => accountsForPal.find((a) => a.id === accountId) || null,
    [accountsForPal, accountId]
  );

  const customerKpiDashboardUrl = useMemo(() => {
    if (!selectedAccount?.datadogOrgId) return null;
    return buildCustomerReportKpiDashboardUrl(selectedAccount.datadogOrgId, selectedAccount.zendeskOrgName);
  }, [selectedAccount]);

  const ticketsForAccountRaw = useMemo(() => {
    if (!palEmail || !accountId) return [];
    return rows.filter((r) => r.palLiaisonEmail === palEmail && r.salesforceAccountId === accountId);
  }, [rows, palEmail, accountId]);

  const rangeInvalid = useMemo(() => {
    if (!rangeFrom || !rangeTo) return false;
    const a = startOfDayLocal(rangeFrom);
    const b = endOfDayLocal(rangeTo);
    if (a == null || b == null) return false;
    return a > b;
  }, [rangeFrom, rangeTo]);

  useEffect(() => {
    if (!palEmail || !accountId || !rangeTo || rangeInvalid) {
      setHighlightFrom("");
      setHighlightTo("");
      return;
    }
    const { highlightFrom: hf, highlightTo: ht } = defaultHighlightDateRange(
      rangeFrom,
      rangeTo,
      DEFAULT_HIGHLIGHT_TRAILING_DAYS
    );
    setHighlightFrom(hf);
    setHighlightTo(ht);
  }, [palEmail, accountId, rangeFrom, rangeTo, rangeInvalid]);

  const highlightRangeInvalid = useMemo(() => {
    if (!highlightFrom || !highlightTo) return false;
    const a = startOfDayLocal(highlightFrom);
    const b = endOfDayLocal(highlightTo);
    if (a == null || b == null) return false;
    return a > b;
  }, [highlightFrom, highlightTo]);

  const applyHighlightPresetDays = useCallback(
    (days) => {
      if (!rangeTo || rangeInvalid) return;
      const { highlightFrom: hf, highlightTo: ht } = defaultHighlightDateRange(rangeFrom, rangeTo, days);
      setHighlightFrom(hf);
      setHighlightTo(ht);
    },
    [rangeFrom, rangeTo, rangeInvalid]
  );

  const ticketsForAccount = useMemo(() => {
    if (!palEmail || !accountId || rangeInvalid) return [];
    const list = ticketsForAccountRaw
      .filter((r) => ticketInDateRange(r, rangeFrom, rangeTo))
      .filter((r) => terminalTicketInRecentCloseWindow(r, rangeTo));
    return list.sort((a, b) => String(b.ticketCreatedTimestamp).localeCompare(String(a.ticketCreatedTimestamp)));
  }, [ticketsForAccountRaw, palEmail, accountId, rangeFrom, rangeTo, rangeInvalid]);

  /** Newest first so a cap keeps recent tickets; send all ids in view (not lowest ticket #). */
  const gleanStatusTicketIds = useMemo(() => {
    const seen = new Set();
    const ids = [];
    for (const r of [...ticketsForAccount].sort((a, b) =>
      String(b.ticketCreatedTimestamp).localeCompare(String(a.ticketCreatedTimestamp))
    )) {
      const id = String(r.ticketId || "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    return ids;
  }, [ticketsForAccount]);

  const gleanStatusKey = gleanStatusTicketIds.join(",");

  useEffect(() => {
    if (!gleanStatusKey) {
      setGleanStatusByTicket({});
      setGleanStatusConfigured(false);
      setGleanStatusLoading(false);
      return undefined;
    }
    let cancelled = false;
    const ids = gleanStatusTicketIds;
    setGleanStatusLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/pal-portfolio/ticket-statuses-glean", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticketIds: ids }),
          cache: "no-store",
        });
        const data = await res.json();
        if (cancelled) return;
        setGleanStatusConfigured(Boolean(data.configured));
        setGleanStatusByTicket(data.statuses && typeof data.statuses === "object" ? data.statuses : {});
      } catch {
        if (!cancelled) {
          setGleanStatusByTicket({});
          setGleanStatusConfigured(false);
        }
      } finally {
        if (!cancelled) setGleanStatusLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gleanStatusKey]);

  const ticketsForAccountDisplay = useMemo(
    () => ticketsForAccount.map((r) => rowWithGleanTicketStatus(r, gleanStatusByTicket)),
    [ticketsForAccount, gleanStatusByTicket]
  );

  const hasSelection = Boolean(palEmail && accountId);

  const closedTicketsInRange = useMemo(
    () => ticketsForAccountDisplay.filter((r) => isClosedTicketStatus(r.ticketStatus)),
    [ticketsForAccountDisplay]
  );

  const ticketStatusGroups = useMemo(() => {
    const groups = groupTicketsByStatus(ticketsForAccountDisplay).filter(
      (group) => showClosedTickets || !isClosedTicketStatus(group.statusLabel)
    );
    return groups.map((group) => {
      if (!isOpenLikeStatus(group.statusLabel)) return group;
      return {
        ...group,
        tickets: [...group.tickets].sort((a, b) => {
          const pa = computeOpenTicketPriority(a).score;
          const pb = computeOpenTicketPriority(b).score;
          if (pb !== pa) return pb - pa;
          return String(b.ticketCreatedTimestamp).localeCompare(String(a.ticketCreatedTimestamp));
        }),
      };
    });
  }, [ticketsForAccountDisplay, showClosedTickets]);

  const callWindowTickets = useMemo(() => {
    if (!hasSelection || rangeInvalid || highlightRangeInvalid || !highlightFrom || !highlightTo) return [];
    return ticketsInHighlightWindow(ticketsForAccountDisplay, highlightFrom, highlightTo);
  }, [hasSelection, rangeInvalid, highlightRangeInvalid, highlightFrom, highlightTo, ticketsForAccountDisplay]);

  const sentimentScanKey = useMemo(
    () =>
      [...new Set(callWindowTickets.map((t) => String(t.ticketId).trim()).filter(Boolean))].sort().join(","),
    [callWindowTickets]
  );

  useEffect(() => {
    if (!sentimentScanKey) {
      setCommentSentimentByTicket({});
      return undefined;
    }
    let cancelled = false;
    const ids = sentimentScanKey.split(",").filter(Boolean).slice(0, 28);
    (async () => {
      try {
        const res = await fetch("/api/pal-portfolio/call-prep/scan-sentiment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticketIds: ids }),
        });
        const data = await res.json();
        if (cancelled || !res.ok) return;
        setCommentSentimentByTicket(data.results && typeof data.results === "object" ? data.results : {});
      } catch {
        if (!cancelled) setCommentSentimentByTicket({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sentimentScanKey]);

  const callHighlights = useMemo(
    () => buildCustomerCallHighlights(callWindowTickets, highlightFrom, highlightTo),
    [callWindowTickets, highlightFrom, highlightTo]
  );

  const frJiraResolveKey = useMemo(() => {
    const need = new Set();
    for (const it of callHighlights.featureRequestsAll) {
      if (!it.frJiraUrl && !it.frJiraKey) need.add(it.ticketId);
    }
    for (const it of callHighlights.openDatadogBugFeatureRequests) {
      if (!it.frJiraUrl && !it.frJiraKey) need.add(it.ticketId);
    }
    return [...need].sort().join(",");
  }, [callHighlights.featureRequestsAll, callHighlights.openDatadogBugFeatureRequests]);

  useEffect(() => {
    if (!frJiraResolveKey) {
      setFrJiraByTicket({});
      return undefined;
    }
    let cancelled = false;
    const ids = frJiraResolveKey.split(",").filter(Boolean).slice(0, 24);
    (async () => {
      try {
        const res = await fetch("/api/pal-portfolio/call-prep/resolve-fr-jira", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticketIds: ids }),
        });
        const data = await res.json();
        if (cancelled || !res.ok) return;
        const results = data.results && typeof data.results === "object" ? data.results : {};
        setFrJiraByTicket((prev) => {
          const next = { ...prev };
          for (const id of ids) {
            const hit = results[id];
            if (hit && typeof hit === "object" && hit.key && hit.url) next[id] = { key: String(hit.key), url: String(hit.url) };
            else delete next[id];
          }
          return next;
        });
      } catch {
        /* keep prior frJiraByTicket on transient errors */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [frJiraResolveKey]);

  const featureRequestsAllDisplay = useMemo(() => {
    return callHighlights.featureRequestsAll.map((it) => {
      const z = frJiraByTicket[it.ticketId];
      const key = it.frJiraKey || z?.key || null;
      const url = it.frJiraUrl || z?.url || null;
      return { ...it, frJiraKey: key, frJiraUrl: url };
    });
  }, [callHighlights.featureRequestsAll, frJiraByTicket]);

  const openDatadogBugFrDisplay = useMemo(() => {
    return callHighlights.openDatadogBugFeatureRequests.map((it) => {
      const z = frJiraByTicket[it.ticketId];
      const key = it.frJiraKey || z?.key || null;
      const url = it.frJiraUrl || z?.url || null;
      return { ...it, frJiraKey: key, frJiraUrl: url };
    });
  }, [callHighlights.openDatadogBugFeatureRequests, frJiraByTicket]);

  const jiraKeysFetchKey = useMemo(() => {
    const keys = new Set();
    for (const it of featureRequestsAllDisplay) {
      if (it.frJiraKey) keys.add(it.frJiraKey);
    }
    for (const it of openDatadogBugFrDisplay) {
      if (it.frJiraKey) keys.add(it.frJiraKey);
    }
    return [...keys].sort().join(",");
  }, [featureRequestsAllDisplay, openDatadogBugFrDisplay]);

  useEffect(() => {
    if (!jiraKeysFetchKey) {
      setJiraIssueByKey({});
      return undefined;
    }
    let cancelled = false;
    const issueKeys = jiraKeysFetchKey.split(",").filter(Boolean).slice(0, 20);
    (async () => {
      try {
        const res = await fetch("/api/pal-portfolio/call-prep/jira-issues", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ issueKeys }),
        });
        const data = await res.json();
        if (cancelled || !res.ok) return;
        const issues = data.issues && typeof data.issues === "object" ? data.issues : {};
        setJiraIssueByKey((prev) => {
          const next = { ...prev };
          for (const k of issueKeys) {
            const hit = issues[k];
            if (hit && typeof hit === "object") next[k] = hit;
            else delete next[k];
          }
          return next;
        });
      } catch {
        /* keep prior */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jiraKeysFetchKey]);

  const subjectByTicketId = useMemo(() => {
    const m = new Map();
    for (const t of callWindowTickets) {
      const id = String(t.ticketId || "").trim();
      if (!id) continue;
      const sub = String(t.ticketSubject || t.subject || "").trim() || "—";
      m.set(id, sub);
    }
    return m;
  }, [callWindowTickets]);

  const mergedSentimentHighlights = useMemo(() => {
    const assigned = new Set(callHighlights.assignedRiskTicketIds || []);
    const map = new Map();
    for (const it of callHighlights.sentimentExport) {
      map.set(it.ticketId, { ...it });
    }
    for (const [tid, scan] of Object.entries(commentSentimentByTicket)) {
      if (!scan || typeof scan !== "object" || scan.ok !== true || !scan.red) continue;
      if (assigned.has(tid) && !map.has(tid)) continue;
      const phraseStr = Array.isArray(scan.phrases) ? scan.phrases.join(", ") : "";
      const extra = `Zendesk customer replies flagged frustration (${phraseStr || "negative tone"}) — validate tone on the call.`;
      const existing = map.get(tid);
      const subj =
        typeof scan.subject === "string" && scan.subject.trim() && scan.subject.trim() !== "—"
          ? scan.subject.trim()
          : subjectByTicketId.get(tid) || "—";
      if (existing) {
        map.set(tid, { ...existing, reviewReason: `${existing.reviewReason} ${extra}` });
      } else {
        assigned.add(tid);
        map.set(tid, { ticketId: tid, subject: subj, reviewReason: extra });
      }
    }
    return [...map.values()].sort((a, b) => String(b.ticketId).localeCompare(String(a.ticketId)));
  }, [callHighlights.sentimentExport, callHighlights.assignedRiskTicketIds, commentSentimentByTicket, subjectByTicketId]);

  const csatFetchKey = useMemo(() => {
    if (
      !hasSelection ||
      rangeInvalid ||
      highlightRangeInvalid ||
      !highlightFrom ||
      !highlightTo ||
      !selectedAccount?.datadogOrgId
    ) {
      return "";
    }
    return `${selectedAccount.datadogOrgId}|${accountId}|${highlightFrom}|${highlightTo}`;
  }, [
    hasSelection,
    rangeInvalid,
    highlightRangeInvalid,
    highlightFrom,
    highlightTo,
    selectedAccount?.datadogOrgId,
    accountId,
  ]);

  useEffect(() => {
    if (!csatFetchKey) {
      setCsatHighlights({ loading: false, configured: false, bad: [], good: [], error: null });
      return undefined;
    }
    let cancelled = false;
    const [datadogOrgId, salesforceAccountId, highlightFromKey, highlightToKey] = csatFetchKey.split("|");
    (async () => {
      setCsatHighlights((p) => ({ ...p, loading: true, error: null }));
      try {
        const res = await fetch("/api/pal-portfolio/call-prep/csat-ratings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            datadogOrgId,
            salesforceAccountId,
            highlightFrom: highlightFromKey,
            highlightTo: highlightToKey,
          }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setCsatHighlights({
            loading: false,
            configured: true,
            bad: [],
            good: [],
            error: data.error || data.message || `HTTP ${res.status}`,
          });
          return;
        }
        setCsatHighlights({
          loading: false,
          configured: data.configured === true,
          bad: Array.isArray(data.bad) ? data.bad : [],
          good: Array.isArray(data.good) ? data.good : [],
          error: typeof data.error === "string" ? data.error : null,
        });
      } catch (e) {
        if (!cancelled) {
          setCsatHighlights({
            loading: false,
            configured: false,
            bad: [],
            good: [],
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [csatFetchKey]);

  const callHighlightTotal = useMemo(() => {
    return (
      callHighlights.longPending.length +
      callHighlights.engineering.length +
      mergedSentimentHighlights.length +
      callHighlights.resolution.length +
      callHighlights.openDatadogBugFeatureRequests.length +
      csatHighlights.bad.length +
      csatHighlights.good.length
    );
  }, [callHighlights, mergedSentimentHighlights, csatHighlights.bad.length, csatHighlights.good.length]);

  function onPalChange(e) {
    const v = e.target.value;
    setPalEmail(v);
    setAccountId("");
  }

  const presetsDisabled = !ticketBounds.maxMs || rangeInvalid;

  const fetchTicketBriefing = useCallback(
    async (ticketId) => {
      const id = String(ticketId);
      const cached = analysisByTicket[id];
      const cachedText = typeof cached?.text === "string" ? cached.text.trim() : "";
      if ((cachedText || cached?.disabled) && !cached?.fetchError) return;
      try {
        const res = await fetch(`/api/pal-portfolio/ticket/${encodeURIComponent(id)}/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
          credentials: "same-origin",
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
        if (!res.ok) throw new Error(data.setupHint || data.message || data.error || `HTTP ${res.status}`);
        if (!String(data.text || "").trim() && !data.fetchError && !data.error) {
          throw new Error("Investigation completed but returned an empty summary. Try Show again.");
        }
        setAnalysisByTicket((p) => ({ ...p, [id]: data }));
      } catch (e) {
        setAnalysisByTicket((p) => ({
          ...p,
          [id]: { fetchError: e instanceof Error ? e.message : String(e) },
        }));
      }
    },
    [analysisByTicket]
  );

  const onHighlightBriefingClick = useCallback(
    async (categoryId, ticketId) => {
      const id = String(ticketId);
      const key = highlightBriefingKey(categoryId, id);
      if (highlightExpandedKey === key) {
        setHighlightExpandedKey(null);
        return;
      }
      setHighlightExpandedKey(key);
      setRowAnalysisLoadingKey(key);
      await fetchTicketBriefing(id);
      setRowAnalysisLoadingKey(null);
    },
    [highlightExpandedKey, fetchTicketBriefing]
  );

  const onTableBriefingClick = useCallback(
    async (ticketId) => {
      const id = String(ticketId);
      if (expandedTicketId === id) {
        setExpandedTicketId(null);
        return;
      }
      setExpandedTicketId(id);
      setRowAnalysisLoadingId(id);
      await fetchTicketBriefing(id);
      setRowAnalysisLoadingId(null);
    },
    [expandedTicketId, fetchTicketBriefing]
  );

  return (
    <div className="pp-wrap">
      <header className="pp-header">
        <h1 className="pp-title">PAL ticket review</h1>
        <GleanLandingAuth gleanOauthEnabled={gleanOauthEnabled} />
        <SupportdogLandingAuth />
        <div className="pp-data-toolbar">
          {lastSnowflakeSync ? (
            <p className="pp-muted pp-path">
              Last Snowflake sync: {new Date(lastSnowflakeSync).toLocaleString()}
            </p>
          ) : null}
          <button
            type="button"
            className="pp-btn pp-btn-primary"
            onClick={() => void refreshPortfolioData()}
            disabled={loading || refreshing}
            title="Query Snowflake, update the portfolio CSV on disk, then reload the table"
          >
            {refreshing ? "Refreshing…" : "Refresh data"}
          </button>
        </div>
      </header>

      <div className="pp-card">
        {loading ? <p className="pp-muted">Loading portfolio…</p> : null}
        {refreshing && !loading ? (
          <p className="pp-muted" style={{ marginBottom: "0.75rem" }}>
            Querying Snowflake and reloading portfolio…
          </p>
        ) : null}
        {loadError ? <p className="pp-error">{loadError}</p> : null}
        {!loading && !loadError && rows.length === 0 ? <p className="pp-muted">No rows in CSV.</p> : null}

        {!loading && !loadError && rows.length > 0 ? (
          <>
            <div className="pp-filters">
              <div className="pp-field">
                <label htmlFor="pal-engineer" className="pp-label">
                  PAL engineer
                </label>
                <select id="pal-engineer" value={palEmail} onChange={onPalChange} className="pp-select">
                  <option value="">Select a PAL engineer…</option>
                  {engineers.map((e) => (
                    <option key={e.email} value={e.email}>
                      {e.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="pp-field">
                <label htmlFor="pal-account" className="pp-label">
                  PAL account (Salesforce)
                </label>
                <select
                  id="pal-account"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  disabled={!palEmail}
                  className="pp-select"
                >
                  <option value="">{palEmail ? "Select an account…" : "Select a PAL engineer first"}</option>
                  {accountsForPal.map((a) => (
                    <option key={a.id} value={a.id}>
                      {palAccountOptionLabel(a)}
                    </option>
                  ))}
                </select>
                {selectedAccount?.datadogOrgId ? (
                  <p className="pp-muted" style={{ marginTop: "0.35rem", fontSize: "0.8125rem" }}>
                    Org ID: <strong>{selectedAccount.datadogOrgId}</strong>
                    {customerKpiDashboardUrl ? (
                      <>
                        {" "}
                        ·{" "}
                        <a
                          href={customerKpiDashboardUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="pp-ticket-link"
                        >
                          KPI summary (Metabase)
                        </a>
                      </>
                    ) : null}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="pp-range-block">
              <span className="pp-label">Ticket created</span>
              <p className="pp-section-hint">Default: full CSV date span (local calendar day, inclusive).</p>
              <div className="pp-range-row">
                <div className="pp-field" style={{ minWidth: "11rem", flex: "0 1 auto" }}>
                  <label htmlFor="range-from" className="pp-label">
                    From
                  </label>
                  <input
                    id="range-from"
                    type="date"
                    value={rangeFrom}
                    onChange={(e) => setRangeFrom(e.target.value)}
                    min={ticketBounds.minStr || undefined}
                    max={ticketBounds.maxStr || undefined}
                    className="pp-select"
                  />
                </div>
                <div className="pp-field" style={{ minWidth: "11rem", flex: "0 1 auto" }}>
                  <label htmlFor="range-to" className="pp-label">
                    To
                  </label>
                  <input
                    id="range-to"
                    type="date"
                    value={rangeTo}
                    onChange={(e) => setRangeTo(e.target.value)}
                    min={ticketBounds.minStr || undefined}
                    max={ticketBounds.maxStr || undefined}
                    className="pp-select"
                  />
                </div>
                <button type="button" className="pp-btn pp-btn-primary" onClick={applyFullDataRange}>
                  Full data range
                </button>
              </div>
              <div className="pp-presets">
                <span className="pp-presets-label">Quick:</span>
                <button type="button" className="pp-btn" disabled={presetsDisabled} onClick={() => applyPresetDays(7)}>
                  Last 7 days
                </button>
                <button type="button" className="pp-btn" disabled={presetsDisabled} onClick={() => applyPresetDays(30)}>
                  Last 30 days
                </button>
                <button type="button" className="pp-btn" disabled={presetsDisabled} onClick={() => applyPresetDays(90)}>
                  Last 90 days
                </button>
                <button
                  type="button"
                  className="pp-btn"
                  disabled={presetsDisabled}
                  onClick={() => applyPresetDays(180)}
                >
                  Last 180 days
                </button>
              </div>
              {ticketBounds.minStr ? (
                <p className="pp-section-hint">
                  CSV span: {ticketBounds.minStr} → {ticketBounds.maxStr}
                </p>
              ) : null}
              {rangeInvalid ? <p className="pp-error">“From” must be on or before “To”.</p> : null}
            </div>

            {hasSelection ? (
              <>
                <p className="pp-muted">
                  {ticketsForAccount.length} ticket{ticketsForAccount.length !== 1 ? "s" : ""} in range
                  {ticketsForAccountRaw.length !== ticketsForAccount.length
                    ? ` (${ticketsForAccountRaw.length} total for this account)`
                    : ""}
                </p>
                {rangeTo && !rangeInvalid ? (
                  <p className="pp-section-hint">
                    Default: <strong>closed</strong> hidden; <strong>solved/merged</strong> only if updated within{" "}
                    <strong>30 days</strong> of table <strong>To</strong>.
                  </p>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
      </div>

      {hasSelection && !rangeInvalid && ticketsForAccount.length > 0 ? (
        <>
          <div className="pp-card pp-call-prep">
            <h2 className="pp-call-prep-title">Customer call prep — highlights</h2>
            <p className="pp-section-hint">
              Tickets listed in the highlights window (default: last {DEFAULT_HIGHLIGHT_TRAILING_DAYS} days)
            </p>
            <div className="pp-hl-range-block">
              <span className="pp-label">Highlights window — ticket created</span>
              <div className="pp-range-row">
                <div className="pp-field" style={{ minWidth: "11rem", flex: "0 1 auto" }}>
                  <label htmlFor="highlight-from" className="pp-label">
                    From
                  </label>
                  <input
                    id="highlight-from"
                    type="date"
                    value={highlightFrom}
                    onChange={(e) => setHighlightFrom(e.target.value)}
                    min={rangeFrom || ticketBounds.minStr || undefined}
                    max={highlightTo || rangeTo || ticketBounds.maxStr || undefined}
                    className="pp-select"
                  />
                </div>
                <div className="pp-field" style={{ minWidth: "11rem", flex: "0 1 auto" }}>
                  <label htmlFor="highlight-to" className="pp-label">
                    To
                  </label>
                  <input
                    id="highlight-to"
                    type="date"
                    value={highlightTo}
                    onChange={(e) => setHighlightTo(e.target.value)}
                    min={highlightFrom || rangeFrom || ticketBounds.minStr || undefined}
                    max={rangeTo || ticketBounds.maxStr || undefined}
                    className="pp-select"
                  />
                </div>
              </div>
              <div className="pp-presets">
                <span className="pp-presets-label">Quick:</span>
                <button type="button" className="pp-btn" onClick={() => applyHighlightPresetDays(30)}>
                  Last 30 days
                </button>
                <button type="button" className="pp-btn" onClick={() => applyHighlightPresetDays(90)}>
                  Last 90 days
                </button>
                <button type="button" className="pp-btn" onClick={() => applyHighlightPresetDays(180)}>
                  Last 180 days
                </button>
                <button type="button" className="pp-btn" onClick={() => applyHighlightPresetDays(365)}>
                  Last 365 days
                </button>
              </div>
              {highlightRangeInvalid ? (
                <p className="pp-error" style={{ marginTop: "0.35rem" }}>
                  Highlights “From” must be on or before “To”.
                </p>
              ) : null}
            </div>
            {csatHighlights.loading ? (
              <p className="pp-section-hint">Loading CSAT (Snowflake)…</p>
            ) : null}
            {csatHighlights.error && !csatHighlights.loading ? (
              <p className="pp-section-hint">
                CSAT: {csatHighlights.error}
                {!csatHighlights.configured ? " — configure Snowflake MCP (see .env.example)." : null}
              </p>
            ) : null}
            {highlightRangeInvalid ? (
              <p className="pp-hl-empty">Fix the highlights date range to score tickets.</p>
            ) : callWindowTickets.length === 0 ? (
              <p className="pp-hl-empty">
                No tickets were <strong>created</strong> in the highlights window for this account — widen{" "}
                <strong>From</strong> / <strong>To</strong> or try <strong>Last 180 days</strong>.
              </p>
            ) : (
              <>
                <HighlightCategory
                  categoryId="longPending"
                  title="Long-running or unresolved (>3 weeks)"
                  items={callHighlights.longPending}
                  agentTicketBase={agentTicketBase}
                  highlightExpandedKey={highlightExpandedKey}
                  onHighlightBriefingClick={onHighlightBriefingClick}
                  rowAnalysisLoadingKey={rowAnalysisLoadingKey}
                  analysisByTicket={analysisByTicket}
                />
                <HighlightCategory
                  categoryId="engineering"
                  title="Engineering / escalation path"
                  items={callHighlights.engineering}
                  agentTicketBase={agentTicketBase}
                  highlightExpandedKey={highlightExpandedKey}
                  onHighlightBriefingClick={onHighlightBriefingClick}
                  rowAnalysisLoadingKey={rowAnalysisLoadingKey}
                  analysisByTicket={analysisByTicket}
                />
                <HighlightCategory
                  categoryId="sentiment"
                  title="Low customer sentiment (export + Zendesk customer replies)"
                  items={mergedSentimentHighlights}
                  agentTicketBase={agentTicketBase}
                  highlightExpandedKey={highlightExpandedKey}
                  onHighlightBriefingClick={onHighlightBriefingClick}
                  rowAnalysisLoadingKey={rowAnalysisLoadingKey}
                  analysisByTicket={analysisByTicket}
                />
                <HighlightCategory
                  categoryId="resolution"
                  title="Resolution / closure risk"
                  items={callHighlights.resolution}
                  agentTicketBase={agentTicketBase}
                  highlightExpandedKey={highlightExpandedKey}
                  onHighlightBriefingClick={onHighlightBriefingClick}
                  rowAnalysisLoadingKey={rowAnalysisLoadingKey}
                  analysisByTicket={analysisByTicket}
                />
                <HighlightCategory
                  categoryId="csatBad"
                  title="Bad CSAT ratings (Snowflake MCP — satisfaction comment)"
                  items={csatHighlights.bad}
                  layout="csat"
                  agentTicketBase={agentTicketBase}
                  highlightExpandedKey={highlightExpandedKey}
                  onHighlightBriefingClick={onHighlightBriefingClick}
                  rowAnalysisLoadingKey={rowAnalysisLoadingKey}
                  analysisByTicket={analysisByTicket}
                />
                <HighlightCategory
                  categoryId="csatGood"
                  title="Good CSAT ratings (Snowflake MCP — satisfaction comment)"
                  items={csatHighlights.good}
                  layout="csat"
                  agentTicketBase={agentTicketBase}
                  highlightExpandedKey={highlightExpandedKey}
                  onHighlightBriefingClick={onHighlightBriefingClick}
                  rowAnalysisLoadingKey={rowAnalysisLoadingKey}
                  analysisByTicket={analysisByTicket}
                />
                <HighlightCategory
                  categoryId="bugFr"
                  title="Feature requests — open Datadog-side bugs"
                  items={openDatadogBugFrDisplay}
                  agentTicketBase={agentTicketBase}
                  highlightExpandedKey={highlightExpandedKey}
                  onHighlightBriefingClick={onHighlightBriefingClick}
                  rowAnalysisLoadingKey={rowAnalysisLoadingKey}
                  analysisByTicket={analysisByTicket}
                  jiraIssueByKey={jiraIssueByKey}
                />
                {callHighlights.featureRequestsAll.length > 0 ? (
                  <HighlightCategory
                    categoryId="frAll"
                    title="Feature requests (all in highlights window)"
                    items={featureRequestsAllDisplay}
                    agentTicketBase={agentTicketBase}
                    highlightExpandedKey={highlightExpandedKey}
                    onHighlightBriefingClick={onHighlightBriefingClick}
                    rowAnalysisLoadingKey={rowAnalysisLoadingKey}
                    analysisByTicket={analysisByTicket}
                    jiraIssueByKey={jiraIssueByKey}
                  />
                ) : null}
                {callHighlightTotal === 0 ? (
                  <p className="pp-hl-empty">No risk highlights in this window (feature requests may still appear).</p>
                ) : null}
              </>
            )}
          </div>

          <div className="pp-tickets-by-status">
          {closedTicketsInRange.length > 0 ? (
            <p className="pp-section-hint" style={{ marginBottom: "0.5rem" }}>
              {showClosedTickets ? (
                <>
                  <strong>{closedTicketsInRange.length}</strong> closed shown ·{" "}
                  <button type="button" className="pp-btn pp-btn-link" onClick={() => setShowClosedTickets(false)}>
                    Hide closed
                  </button>
                </>
              ) : (
                <>
                  <strong>{closedTicketsInRange.length}</strong> closed hidden (default) ·{" "}
                  <button type="button" className="pp-btn pp-btn-link" onClick={() => setShowClosedTickets(true)}>
                    Show closed
                  </button>
                </>
              )}
            </p>
          ) : null}
          {ticketStatusGroups.map((group) => {
            const openSection = isOpenLikeStatus(group.statusLabel);
            const colCount = openSection ? 11 : 9;
            return (
              <section key={group.statusLabel} className="pp-status-section">
                <h2 className="pp-status-heading">
                  {group.statusLabel}{" "}
                  <span className="pp-status-count">({group.tickets.length})</span>
                </h2>
                <div className="pp-table-wrap">
                  <table className="pp-table">
                    <thead>
                      <tr>
                        <th>Ticket</th>
                        <th>Created</th>
                        <th>Subject</th>
                        <th>Status</th>
                        <th>Zendesk org</th>
                        <th>Premier</th>
                        <th>Product</th>
                        <th>Impact</th>
                        {openSection ? (
                          <>
                            <th>Attention</th>
                            <th>Signals</th>
                          </>
                        ) : null}
                        <th>Briefing</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.tickets.map((t) => {
                        const tid = String(t.ticketId);
                        const href = agentTicketBase && tid ? `${agentTicketBase}/${tid}` : null;
                        const briefingOpen = expandedTicketId === tid;
                        const rowAnalysis = analysisByTicket[tid];
                        const pr = openSection ? computeOpenTicketPriority(t) : null;
                        const priorityRowClass =
                          pr && pr.tier !== "low" ? `pp-row-priority-${pr.tier}` : undefined;
                        const signalsTitle = pr?.reasons?.length ? pr.reasons.join("\n") : "";
                        const signalsPreview =
                          pr?.reasons?.length ? pr.reasons.slice(0, 3).join(" · ") : "—";
                        return (
                          <Fragment key={`${t.salesforceAccountId}-${tid}`}>
                            <tr className={priorityRowClass}>
                              <td className="pp-mono">
                                {href ? (
                                  <a
                                    href={href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="pp-ticket-link"
                                    title="Open in Zendesk"
                                  >
                                    {tid}
                                  </a>
                                ) : (
                                  <Link
                                    href={`/tickets/${encodeURIComponent(tid)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="pp-ticket-link"
                                    title="Open ticket summary (set ZENDESK_SUBDOMAIN or ZENDESK_AGENT_TICKET_URL_PREFIX for Zendesk links)"
                                  >
                                    {tid}
                                  </Link>
                                )}
                                {href ? (
                                  <>
                                    {" · "}
                                    <Link
                                      href={`/tickets/${encodeURIComponent(tid)}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="pp-ticket-link-secondary"
                                    >
                                      Summary
                                    </Link>
                                  </>
                                ) : null}
                              </td>
                              <td className="pp-xs pp-nowrap">{formatWhen(t.ticketCreatedTimestamp)}</td>
                              <td className="pp-subject" title={t.ticketSubject || ""}>
                                {t.ticketSubject || "—"}
                              </td>
                              <td
                                className="pp-cap pp-nowrap"
                                title={
                                  t.exportTicketStatus
                                    ? `Export (Snowflake): ${t.exportTicketStatus} · Shown: Glean index`
                                    : undefined
                                }
                              >
                                {t.ticketStatus || "—"}
                                {t.ticketStatusSource === "glean" ? (
                                  <span className="pp-status-glean-tag" title="Status from Glean index">
                                    {" "}
                                    G
                                  </span>
                                ) : null}
                              </td>
                              <td className="pp-xs pp-truncate" title={t.zendeskOrgName || ""}>
                                {t.zendeskOrgName || "—"}
                              </td>
                              <td className="pp-nowrap">
                                {String(t.isPremierSupportTicket).toLowerCase() === "true" ? "Yes" : "No"}
                              </td>
                              <td className="pp-xs">{t.primaryProductComponent || "—"}</td>
                              <td className="pp-xs pp-cap">{t.ticketImpact || "—"}</td>
                              {openSection ? (
                                <>
                                  <td className="pp-nowrap">
                                    {pr.tier === "high" ? (
                                      <span className="pp-tier-badge pp-tier-high">High</span>
                                    ) : null}
                                    {pr.tier === "medium" ? (
                                      <span className="pp-tier-badge pp-tier-medium">Med</span>
                                    ) : null}
                                    {pr.tier === "low" ? (
                                      <span className="pp-tier-muted" title={`Score ${pr.score}`}>
                                        —
                                      </span>
                                    ) : null}
                                  </td>
                                  <td className="pp-xs pp-signals" title={signalsTitle}>
                                    {signalsPreview}
                                  </td>
                                </>
                              ) : null}
                              <td className="pp-nowrap">
                                <button
                                  type="button"
                                  className="pp-briefing-toggle"
                                  onClick={() => void onTableBriefingClick(tid)}
                                  aria-expanded={briefingOpen}
                                >
                                  {briefingOpen ? "Hide" : "Show"}
                                </button>
                              </td>
                            </tr>
                            {briefingOpen ? (
                              <tr className="pp-table-expand">
                                <td colSpan={colCount}>
                                  <div className="pp-briefing-panel">
                                    <GleanAnalysisView
                                      loading={rowAnalysisLoadingId === tid}
                                      loadingTitle="Running investigation playbook (SupportDog)…"
                                      loadingHint=""
                                      fetchError={rowAnalysis?.fetchError || null}
                                      disabled={rowAnalysis?.disabled === true}
                                      disabledMessage={rowAnalysis?.message || ""}
                                      markdown={rowAnalysis?.disabled ? "" : rowAnalysis?.text || ""}
                                      showSources={false}
                                    />
                                  </div>
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
        </>
      ) : null}

      {hasSelection && rangeInvalid ? (
        <p className="pp-empty">Fix the date range to see tickets.</p>
      ) : null}

      {hasSelection && !rangeInvalid && ticketsForAccount.length === 0 && !loading ? (
        <p className="pp-empty">
          {ticketsForAccountRaw.length > 0
            ? "No tickets in the selected date range for this account. Widen the range or use “Full data range”."
            : "No tickets in the export for this engineer and account."}
        </p>
      ) : null}
    </div>
  );
}
