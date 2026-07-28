# HR Predictor

React + Vite + TypeScript app that ranks today's MLB ballparks by home-run park factor using [Ballpark Pal](https://www.ballparkpal.com/Park-Factors.php).

## Prediction backbone

`/api/hr-predictions` builds today's board:

1. Full MLB slate probable pitchers + lineups from MLB Stats API
2. Batter swing-path / attack-angle from [Savant](https://baseballsavant.mlb.com/leaderboard/bat-tracking/swing-path-attack-angle)
3. Batter barrels / EV / xSLG / xwOBA from date-bounded Statcast aggregates
4. Pitch-type damage from date-bounded Statcast (batter + pitcher)
5. Opposing SP location/usage from Savant Pitch3D archetype feed (`/app/archetype/{id}`)
6. Opposing SP HR allowed / HR/9 from [MLB HR Allowed leaders](https://www.mlb.com/stats/pitching/home-runs-allowed)
7. Batter vs LHP / vs RHP splits from MLB Stats API
8. Rank by **weighted matchup score (0–100)**; expected HR chance kept in detail (PAs × durability)

Scoring model highlights:

- **Matchup score** (board): pitch-type 30% · platoon 22% · shrunk HR/9 18% · power 12% · park 10% · recent form 8%
- **HR/9 shrinkage** toward league average until ~50 IP
- **Opportunity / durability / anti-stacking** inform expected HR chance in the detail panel
- **Recent form**: ~21-day SLG/HR window
- **Park**: ~10% of matchup quality

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

Open the local Vite URL.

- Dashboard loads `/api/schedule`, then scores `/api/hr-predictions/game` one game at a time (2 at once), caching each result in `localStorage`.
- Reloads reuse cached games when the date, stats cutoff, and lineup fingerprint match.
- Ballparks calls `/api/park-factors` only when that tab is opened.

## Deploy (Render API + static frontend)

Render web service:

- **Build:** `npm install && npm run build`
- **Start:** `npm start` (Node server for `/api/*` + `dist` static files)

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
