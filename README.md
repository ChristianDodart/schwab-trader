# Schwab Trader

A local, always-on day-trading app for the Schwab Trader API — the successor to
the "Stock Trading for 2026" Google Sheet. Live quotes over websockets, a
Postgres-backed ledger, and a malleable strategy engine (LIFO progressive
ladder). Human-in-the-loop: the app does all the API/DB work; you approve trades.

## Architecture

```
Schwab Trader API (REST + streamer WS)
        │  OAuth · quotes · orders
        ▼
FastAPI backend ── token mgr · streamer · strategy engine · order mgr
        │                         │
        ▼                         ▼
   Postgres (Docker)       Browser dashboard (React)  ──▶  you (one click)
```

## Prerequisites
- Docker Desktop (for Postgres)
- Python 3.12+ and Node 18+

## Setup

### 1. Database (Docker)
```bash
docker compose up -d          # Postgres on localhost:5433
```

### 2. Backend
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate         # Windows
pip install -r requirements.txt
python run.py                  # serves on http://localhost:8000
```
> Windows note: start the backend with `python run.py` (not bare `uvicorn`).
> psycopg's async driver requires the SelectorEventLoop, which `run.py` sets up.
- Health check: http://localhost:8000/health
- Until you authorize Schwab, the quote feed runs in **DEMO mode** (synthetic
  prices) so you can verify the UI end-to-end.

### 3. Authorize Schwab (one-time, then auto-refresh)
```bash
cd backend
.venv\Scripts\activate
python -m app.schwab.authorize     # browser login, paste the redirect URL back
```
Writes `token.json`. The refresh token lasts 7 days; re-run this when it lapses.

### 4. Frontend
```bash
cd frontend
npm install
npm run dev                    # http://localhost:5173
```

## Strategy config
All strategy numbers live in **`backend/app/strategy/default_strategy.yaml`**
(sizing tiers, buy ladder %s, sell rules, guardrails). The engine in `rules.py`
reads them — change YAML, restart, done. No plumbing code changes.

## Secrets
`backend/.env` holds your Schwab client ID/secret (gitignored). Rotate the secret
periodically on developer.schwab.com.

## Phase status
- [x] Phase 1 — Foundation: OAuth-ready, Postgres schema, live quote → browser
- [ ] Phase 2 — Read-only dashboard (Stock Data + Longs)
- [ ] Phase 3 — Strategy engine wired to live positions
- [ ] Phase 4 — Ledger (Long Log + Bal. Info), reconcile vs Schwab
- [ ] Phase 5 — One-click trading
