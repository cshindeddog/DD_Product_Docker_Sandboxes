#!/usr/bin/env bash
# Pull latest app code from pal-portfolio-experiment (local-only sandbox) into this git-tracked folder.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
rsync -a \
  --exclude node_modules \
  --exclude .next \
  --exclude '.env*.local' \
  --exclude 'data/*.csv' \
  --exclude README.md \
  --exclude TEAM_SETUP.md \
  --exclude scripts/sync-from-experiment.sh \
  "$ROOT/pal-portfolio-experiment/" \
  "$ROOT/pal-portfolio-app/"
echo "Synced pal-portfolio-experiment → pal-portfolio-app (kept README, TEAM_SETUP, data CSV)."
