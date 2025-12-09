DOCKER APM + DBM SANDBOX
-------------------------
This repository is a small sandbox environment to demo:

- APM: Tracing a Python FastAPI backend (with DB calls + external HTTP calls)
- DBM: Monitoring a Postgres database with query metrics + query samples

Everything runs locally via docker-compose.

ARCHITECTURE
------------
High-level components:
- Datadog Agent (datadog service)
- Postgres (db service)
- Python backend (backend service)
- Static frontend (frontend service)

REPOSITORY LAYOUT
-----------------
Root:
  docker-compose.yml – orchestrates the services.

Datadog / DBM:
  datadog/conf.d/postgres.d/conf.yaml – enables DBM and query samples.

Backend:
  backend/app.py – FastAPI application
  backend/database.py – DB helpers
  backend/requirements.txt – dependencies
  backend/Dockerfile – builds backend image

Frontend:
  frontend/index.html – simple UI
  frontend/Dockerfile – static server image

DATADOG & POSTGRES CONFIGURATION
--------------------------------
Datadog Agent environment:
  DD_API_KEY
  DD_SITE
  DD_APM_ENABLED
  DD_DBM_ENABLED

Postgres:
  shared_preload_libraries=pg_stat_statements

DBM integration:
  dbm: true
  query_samples: enabled

RUNNING THE SANDBOX
-------------------
Prerequisites:
  Docker, docker-compose, Datadog API key.

Start:
  docker-compose build
  docker-compose up -d

Verify:
  docker ps

TESTING APM
-----------
Health:
  curl http://localhost:8000/

DB + external:
  curl http://localhost:8000/data

Insert load:
  for i in {1..500}; do
    curl -s -X POST http://localhost:8000/items \
      -H "Content-Type: application/json" \
      -d "{\"name\":\"bulk\",\"value\":${i}}" > /dev/null
  done

TESTING DBM
-----------
Generate writes:
  (reuse insert load loop)

Reads + external:
  for i in {1..50}; do
    curl -s http://localhost:8000/data > /dev/null
  done

Inspect Postgres:
  docker exec -it demo-postgres psql -U dduser -d demo
  SELECT query, calls, total_exec_time
  FROM pg_stat_statements
  ORDER BY total_exec_time DESC
  LIMIT 20;

FRONTEND TESTING
----------------
Visit http://localhost:8080 and click Call Backend.

CLEANUP
-------
  docker-compose down
  docker-compose down -v

