# VALTRACK — Valorant Performance Engine

Custom competitive match scoring for Valorant. Round-level combat analysis (kills, clutches, first bloods/deaths, eco damage, assist damage) curved into a **0–1000** performance index.

## Features

- Riot ID search (`Name#TAG`) with shareable URLs (`?id=Name#TAG`)
- Recent search history (local only)
- Player card, region, account level
- Aggregate stats: win rate, K/D, ACS, form streak, HS%, clutches, FB/FD
- Score trend chart + agent / map breakdowns
- Expandable match history with scoreboard, round log, and score math
- Dark / light theme
- Scoring help modal

## Stack

- Frontend: static HTML / CSS / JS + Chart.js
- Backend: Flask serverless function (`api/calculate.py`)
- Data: [HenrikDev Valorant API](https://docs.henrikdev.xyz/)

## Environment

Set on Vercel (or locally) — **never commit the key**:

```
VALORANT_API_KEY=HDEV-...
```

`HDEV_API_KEY` is also accepted as an alias.

## Local run

```bash
# Windows
set VALORANT_API_KEY=HDEV-your-key
py -3 -m pip install -r requirements.txt
py -3 api/calculate.py
# open http://127.0.0.1:5000
```

## Deploy (Vercel)

1. Push the repo
2. Ensure `VALORANT_API_KEY` is set under Project → Settings → Environment Variables
3. Redeploy

Static files at the repo root are served by Vercel; `/api/*` is rewritten to the Flask app in `api/calculate.py`.

## Scoring (short version)

```
Avg round score = raw combat total / rounds
Performance score = (Avg / 45)^0.98 × 1000   → clamp 0–1000
```

Not affiliated with Riot Games.
