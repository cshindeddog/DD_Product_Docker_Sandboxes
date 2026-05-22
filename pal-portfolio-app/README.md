# PAL Portfolio App

PAL ticket review and call-prep UI for the team. Each person runs it **locally** on their laptop with their own Glean and SupportDog sign-in.

## Quick start

```bash
cd pal-portfolio-app
npm install
cp .env.example .env.local    # fill in secrets — see TEAM_SETUP.md
npm run dev
```

Open **http://localhost:5101**

Full onboarding: **[TEAM_SETUP.md](./TEAM_SETUP.md)**

## What’s in git

| Tracked | Not tracked (`.gitignore`) |
|---------|----------------------------|
| App source, `package.json`, `.env.example` | `.env.local`, `node_modules`, `.next` |
| `data/.gitkeep` | `data/*.csv` (customer ticket data) |

Refresh portfolio data locally via **Refresh data** (Snowflake MCP) or copy a CSV into `data/pal_engineer_accounts_tickets_last6mo.csv`.

## Maintainer

Sync latest from the experimental copy (optional):

```bash
./scripts/sync-from-experiment.sh
```
