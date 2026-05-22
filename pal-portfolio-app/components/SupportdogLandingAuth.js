"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const DC_DISPLAY_ORDER = ["US1", "US3", "US5", "EU1", "AP1", "AP2"];

/**
 * @param {object[]} servers
 */
function sortServers(servers) {
  return [...servers].sort(
    (a, b) =>
      DC_DISPLAY_ORDER.indexOf(a.datacenter) - DC_DISPLAY_ORDER.indexOf(b.datacenter) ||
      String(a.datacenter).localeCompare(String(b.datacenter))
  );
}

/**
 * @param {object} server
 */
function isRegionAuthenticated(server) {
  return Boolean(server.signedIn && !server.needsAuthentication);
}

/**
 * SupportDog OAuth — one row per region with green/red auth status.
 * @param {{ compact?: boolean }} [props]
 */
export default function SupportdogLandingAuth({ compact = false }) {
  const [summary, setSummary] = useState({
    oauthEnabled: false,
    globalEnvToken: false,
    signedInCount: 0,
    totalCount: 0,
    servers: /** @type {object[]} */ ([]),
    checked: false,
    probing: false,
  });
  const [refreshKey, setRefreshKey] = useState(0);
  const [probeConnections, setProbeConnections] = useState(false);
  const [repairNote, setRepairNote] = useState(/** @type {string | null} */ (null));

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await fetch("/api/pal-portfolio/supportdog/oauth/repair", { cache: "no-store", credentials: "include" });
      } catch {
        /* non-fatal */
      }
      if (cancelled) return;
      try {
        const res = await fetch(
          `/api/pal-portfolio/supportdog/oauth/status?all=1&includeStaging=0&probe=${probeConnections ? "1" : "0"}`,
          { cache: "no-store" }
        );
        const data = res.ok ? await res.json() : {};
        if (!cancelled) {
          setSummary({
            oauthEnabled: Boolean(data.oauthEnabled),
            globalEnvToken: Boolean(data.globalEnvToken),
            signedInCount: typeof data.signedInCount === "number" ? data.signedInCount : 0,
            totalCount: typeof data.totalCount === "number" ? data.totalCount : 0,
            servers: Array.isArray(data.servers) ? data.servers : [],
            checked: true,
            probing: false,
          });
        }
      } catch {
        if (!cancelled) setSummary((s) => ({ ...s, checked: true, probing: false }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, probeConnections]);

  useEffect(() => {
    const onFocus = () => reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reload]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("supportdog_oauth") !== "ok") return;
    params.delete("supportdog_oauth");
    params.delete("supportdog_dc");
    const qs = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    reload();
  }, [reload]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const err = params.get("supportdog_oauth_error");
    if (!err) return;

    const needsFullReset = /431|header.*too large|invalid_redirect|invalid_scope/i.test(err);
    const path = window.location.pathname;

    (async () => {
      try {
        if (needsFullReset) {
          await fetch(
            `/api/pal-portfolio/supportdog/oauth/reset?json=1&returnTo=${encodeURIComponent(path)}`,
            { cache: "no-store", credentials: "include" }
          );
          setRepairNote("Cleared oversized OAuth cookies automatically. Use Connect all below.");
        } else {
          const res = await fetch("/api/pal-portfolio/supportdog/oauth/repair", {
            cache: "no-store",
            credentials: "include",
          });
          const data = res.ok ? await res.json() : {};
          if (data.clearedAll) {
            setRepairNote("Cleared oversized cookies. Use Connect all to sign in again.");
          } else if (data.repaired) {
            setRepairNote("Repaired session cookies. Try Connect again.");
          }
        }
      } catch {
        /* ignore */
      } finally {
        params.delete("supportdog_oauth_error");
        const qs = params.toString();
        window.history.replaceState({}, "", `${path}${qs ? `?${qs}` : ""}`);
        reload();
      }
    })();
  }, [reload]);

  const returnTo = typeof window !== "undefined" ? window.location.pathname : "/";

  const servers = useMemo(() => sortServers(summary.servers), [summary.servers]);

  const connectAllHref = useMemo(() => {
    if (!summary.oauthEnabled || summary.globalEnvToken) return null;
    const first = servers.find((s) => !isRegionAuthenticated(s));
    if (!first) return null;
    return `/api/pal-portfolio/supportdog/oauth/start?connectAll=1&datacenter=${encodeURIComponent(first.datacenter)}&returnTo=${encodeURIComponent(returnTo)}`;
  }, [summary.oauthEnabled, summary.globalEnvToken, servers, returnTo]);

  const oauthError =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("supportdog_oauth_error")
      : null;

  if (!summary.oauthEnabled) {
    return (
      <p className="pp-glean-inline pp-section-hint">
        <strong>SupportDog:</strong> set <code className="pp-code">SUPPORTDOG_OAUTH_COOKIE_SECRET</code> in{" "}
        <code className="pp-code">.env.local</code>. Open <code className="pp-code">http://localhost:5101</code>.
      </p>
    );
  }

  const resetHref = `/api/pal-portfolio/supportdog/oauth/reset?returnTo=${encodeURIComponent(returnTo)}`;
  const unsignedCount = servers.filter((s) => !isRegionAuthenticated(s)).length;

  return (
    <div className={`pp-supportdog-mcp-panel${compact ? " pp-supportdog-mcp-panel--compact" : ""}`}>
      {repairNote ? (
        <p className="pp-glean-inline" style={{ marginBottom: "0.5rem" }}>
          {repairNote}
        </p>
      ) : null}
      {oauthError && !repairNote ? (
        <p className="pp-glean-inline-error" style={{ marginBottom: "0.5rem" }}>
          Sign-in failed: {oauthError}. Repairing cookies…
        </p>
      ) : null}

      <div className="pp-supportdog-mcp-header">
        <span className="pp-glean-inline-label">SupportDog</span>
        {summary.checked ? (
          <span className="pp-glean-inline-status">
            {summary.globalEnvToken
              ? "env token (all regions)"
              : `${summary.signedInCount}/${summary.totalCount} authenticated`}
            {summary.probing ? " · testing…" : ""}
          </span>
        ) : (
          <span className="pp-glean-inline-status">Checking…</span>
        )}
        {connectAllHref && unsignedCount > 0 ? (
          <a href={connectAllHref} className="pp-btn pp-btn-primary pp-glean-signin">
            Connect all
          </a>
        ) : null}
        {servers.some((s) => isRegionAuthenticated(s)) && !summary.globalEnvToken ? (
          <button
            type="button"
            className="pp-ticket-link"
            style={{ background: "none", border: "none", cursor: "pointer", padding: 0, font: "inherit" }}
            onClick={() => {
              setSummary((s) => ({ ...s, probing: true }));
              setProbeConnections(true);
              reload();
            }}
            disabled={summary.probing}
          >
            Test MCP
          </button>
        ) : null}
      </div>

      <ul className="pp-supportdog-mcp-list" aria-label="SupportDog regions">
        {servers.map((server) => {
          const ok = isRegionAuthenticated(server);
          const startHref = `/api/pal-portfolio/supportdog/oauth/start?datacenter=${encodeURIComponent(server.datacenter)}&returnTo=${encodeURIComponent(returnTo)}`;
          const logoutHref = `/api/pal-portfolio/supportdog/oauth/logout?datacenter=${encodeURIComponent(server.datacenter)}&returnTo=${encodeURIComponent(returnTo)}`;

          return (
            <li key={server.datacenter} className="pp-supportdog-mcp-row">
              <span
                className={`pp-supportdog-mcp-dot ${ok ? "pp-supportdog-mcp-dot--ok" : "pp-supportdog-mcp-dot--fail"}`}
                title={ok ? "Authenticated" : "Not authenticated"}
                aria-hidden
              />
              <span className="pp-supportdog-mcp-name">{server.datacenter}</span>
              <span className={`pp-supportdog-mcp-auth ${ok ? "pp-supportdog-mcp-ok" : "pp-supportdog-mcp-warn"}`}>
                {ok ? "Authenticated" : "Not signed in"}
              </span>
              {summary.globalEnvToken ? (
                <span className="pp-muted pp-supportdog-mcp-detail">env token</span>
              ) : probeConnections && ok && server.message && server.message !== "signed in" ? (
                <span className="pp-muted pp-supportdog-mcp-detail">{server.message}</span>
              ) : null}
              {!summary.globalEnvToken ? (
                ok ? (
                  <a href={logoutHref} className="pp-supportdog-mcp-action pp-ticket-link">
                    Sign out
                  </a>
                ) : (
                  <a href={startHref} className="pp-supportdog-mcp-action pp-btn pp-btn-primary pp-glean-signin">
                    Connect
                  </a>
                )
              ) : null}
            </li>
          );
        })}
      </ul>

      {!compact && summary.checked && unsignedCount > 0 ? (
        <p className="pp-muted" style={{ fontSize: "0.8125rem", margin: "0.5rem 0 0" }}>
          Ticket briefings auto-detect the correct region after you connect each datacenter you use.
        </p>
      ) : null}
      {!compact && summary.checked ? (
        <p className="pp-muted" style={{ fontSize: "0.8125rem", margin: "0.35rem 0 0" }}>
          Cookies are repaired automatically on load. If sign-in still fails, use{" "}
          <a href={resetHref} className="pp-ticket-link">
            Reset sessions
          </a>{" "}
          (no need to clear browser site data). Open <code className="pp-code">http://localhost:5101</code>.
        </p>
      ) : null}
    </div>
  );
}
