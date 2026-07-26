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
7. Score = batter quality × pitch-type matchup × pitcher HR/9 × power (no park factor)

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
