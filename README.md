# HR Predictor

React + Vite + TypeScript app that ranks today's MLB ballparks by home-run park factor using [Ballpark Pal](https://www.ballparkpal.com/Park-Factors.php).

## Prediction backbone

`/api/hr-predictions` builds today's board:

1. Top HR parks from [Ballpark Pal](https://www.ballparkpal.com/Park-Factors.php)
2. Probable pitchers + lineups from MLB Stats API
3. Batter swing-path / attack-angle from [Savant](https://baseballsavant.mlb.com/leaderboard/bat-tracking/swing-path-attack-angle)
4. Batter barrels / EV from [Statcast EV leaderboard](https://baseballsavant.mlb.com/leaderboard/statcast)
5. Batter expected contact quality (xSLG/xwOBA hit-probability proxies) from [Expected Statistics](https://baseballsavant.mlb.com/leaderboard/expected_statistics)
6. Pitch-type damage from [Pitch Arsenal Stats](https://baseballsavant.mlb.com/leaderboard/pitch-arsenal-stats) (batter + pitcher)
7. Opposing SP location/usage from Savant Pitch3D archetype feed (`/app/archetype/{id}`)
8. Opposing SP HR allowed / HR/9 from [MLB HR Allowed leaders](https://www.mlb.com/stats/pitching/home-runs-allowed)
9. Score = batter quality × pitch-type matchup × pitcher HR/9 × park HR boost

Player stats are cut off through the prior day (`statsAsOf`) so historical boards exclude same-day results.

Server modules live under `server/` (`pipeline`, `mlb`, `savant`, `scoring`).

## Design system

Theme tokens and shared UI primitives live under `src/styles/`:

- `tokens.css` — colors, type, spacing, radii, motion
- `base.css` — global reset / document styles
- `components.css` — sidebar, cards, chips, badges, tables, rings

Reference mock: `src/assets/design-reference.png`.

## Develop

```bash
npm install
npm run dev
```

Open the local Vite URL. Dashboard calls `/api/hr-predictions`; Ballparks calls `/api/park-factors`.

## Deploy (Render API + static frontend)

Render web service:

- **Build:** `npm install && npm run build`
- **Start:** `npm start`
- Env: `NPM_CONFIG_PRODUCTION=false` (Vite is needed at runtime for `vite preview`)

If the UI is hosted separately, set this at **frontend build time**:

```bash
VITE_API_BASE_URL=https://hr-predictor-api.onrender.com
```

Local `npm run dev` leaves that unset and uses same-origin `/api`.

## Scripts

- `npm run dev` — start Vite with API middleware
- `npm run build` — typecheck and production build
- `npm start` — production preview server (Render)
- `npm run preview` — preview the build (API middleware included)
- `npm run lint` — run Oxlint
