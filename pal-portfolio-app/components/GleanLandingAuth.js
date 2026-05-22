"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Compact Glean OAuth control for the portfolio header (sign in / out for browser SSO).
 * @param {{ gleanOauthEnabled: boolean }} props
 */
export default function GleanLandingAuth({ gleanOauthEnabled }) {
  const [status, setStatus] = useState(() => ({
    oauthEnabled: gleanOauthEnabled,
    signedIn: false,
    gleanReady: false,
    checked: false,
  }));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/pal-portfolio/glean/oauth/status", { cache: "no-store" });
        let data = { oauthEnabled: gleanOauthEnabled, signedIn: false, gleanReady: false };
        if (res.ok) {
          try {
            data = await res.json();
          } catch {
            /* keep defaults */
          }
        }
        if (!cancelled) {
          setStatus({
            oauthEnabled: Boolean(data.oauthEnabled),
            signedIn: Boolean(data.signedIn),
            gleanReady: Boolean(data.gleanReady),
            checked: true,
          });
        }
      } catch {
        if (!cancelled) {
          setStatus((s) => ({ ...s, checked: true }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gleanOauthEnabled]);

  const returnTo = "/";
  const gleanOauthStartHref = useMemo(() => {
    if (!gleanOauthEnabled) return null;
    return `/api/pal-portfolio/glean/oauth/start?returnTo=${encodeURIComponent(returnTo)}`;
  }, [gleanOauthEnabled]);

  const gleanOauthLogoutHref = useMemo(() => {
    return `/api/pal-portfolio/glean/oauth/logout?returnTo=${encodeURIComponent(returnTo)}`;
  }, []);

  if (!gleanOauthEnabled) {
    return (
      <p className="pp-glean-inline pp-section-hint">
        <strong>Glean:</strong> browser SSO not configured (<code className="pp-code">GLEAN_*</code> in{" "}
        <code className="pp-code">.env.local</code>).
      </p>
    );
  }

  return (
    <div className="pp-glean-inline">
      <span className="pp-glean-inline-label">Glean</span>
      {status.signedIn ? (
        <span className="pp-glean-inline-status">
          Signed in ·{" "}
          <a href={gleanOauthLogoutHref} className="pp-ticket-link">
            Sign out
          </a>
        </span>
      ) : status.checked && status.gleanReady ? (
        <span className="pp-glean-inline-status">Server token configured — SSO optional</span>
      ) : gleanOauthStartHref ? (
        <a href={gleanOauthStartHref} className="pp-btn pp-btn-primary pp-glean-signin">
          Sign in with Glean
        </a>
      ) : null}
      {status.checked && status.oauthEnabled && !status.gleanReady && !status.signedIn ? (
        <span className="pp-error pp-glean-inline-error">Credentials not ready — check GLEAN_INSTANCE_URL</span>
      ) : null}
    </div>
  );
}
