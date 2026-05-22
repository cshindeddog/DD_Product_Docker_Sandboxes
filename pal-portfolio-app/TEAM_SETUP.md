# Team setup — run locally (Option B)

Each teammate runs the app on **their own laptop**. Glean and SupportDog auth stay in **their browser** (same as you do today). No Docker, no shared server.

## 1. Get the code

```bash
git clone <your-repo-url>
cd pse-investigation-hub/pal-portfolio-app
```

## 2. Install

```bash
npm install
```

**Also needed (same as your Cursor setup):**

| Tool | Used for |
|------|----------|
| **Node.js 20+** | App |
| **uv** (`uvx`) | Snowflake refresh / CSAT — [install uv](https://docs.astral.sh/uv/getting-started/installation/) |
| **Snowflake MCP config** | `~/.config/mcp/snowflake-config.yaml` (same path as Cursor) |

## 3. Configure secrets

```bash
cp .env.example .env.local
```

Edit `.env.local`. Minimum for full features:

```bash
# Required for ticket analysis
ANTHROPIC_API_KEY=sk-ant-...

# Glean (per-user sign-in in the app)
GLEAN_INSTANCE_URL=https://<tenant>-be.glean.com
GLEAN_OAUTH_REDIRECT_URI=http://localhost:5101/api/pal-portfolio/glean/oauth/callback
GLEAN_OAUTH_COOKIE_SECRET=<random-string-at-least-16-chars>

# SupportDog (per-user Connect all in the app)
SUPPORTDOG_OAUTH_COOKIE_SECRET=<same-or-another-16+-char-secret>

# Snowflake (optional — uses Cursor config if env vars unset)
# SNOWFLAKE_ACCOUNT=...
# SNOWFLAKE_USER=...
```

Ask your lead for a redacted `.env.local` template or 1Password entries — **do not commit** `.env.local`.

**Glean:** If sign-in fails, register redirect URI  
`http://localhost:5101/api/pal-portfolio/glean/oauth/callback` in Glean Admin (or use dynamic client registration without `GLEAN_OAUTH_CLIENT_ID`).

## 4. Run

```bash
npm run dev
```

Open **http://localhost:5101** (use `localhost`, not `127.0.0.1`).

## 5. Sign in (once per machine)

1. **Glean** — **Sign in to Glean** → complete SSO  
2. **SupportDog** — **Connect all** → complete SSO for each region you need (US1, US3, US5, EU1, AP1, AP2)

Portfolio data: `data/pal_engineer_accounts_tickets_last6mo.csv` (refresh via **Refresh data** if Snowflake is configured).

## 6. Troubleshooting

| Issue | What to do |
|-------|------------|
| SupportDog `invalid_scope` | Ensure you did not set `offline_access` in `SUPPORTDOG_OAUTH_SCOPES`; default is `mcp:read` only |
| HTTP 431 on SupportDog sign-in | **Reset sessions** in the SupportDog panel (no need to clear all browser site data) |
| Glean insufficient_scope | Sign out of Glean in the app, sign in again |
| Snowflake refresh fails | Install `uv`; confirm `~/.config/mcp/snowflake-config.yaml` exists (same as Cursor) |
| Port in use | `npm run dev` kills port 5101 automatically; or stop other apps on 5101 |

## 7. Updates

```bash
git pull
npm install
npm run dev
```

---

Maintainer: share this file + repo access. Optional: commit an updated CSV under `data/` periodically so everyone does not need to run Snowflake refresh.
