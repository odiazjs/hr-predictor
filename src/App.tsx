import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { fetchParkFactors, shiftIsoDate, todayInEastern } from './api/parkFactors'
import { loadPredictionsProgressively } from './api/predictions'
import type { ParkFactor, ParkFactorsResponse } from './types/parkFactors'
import type { HrPrediction, HrPredictionsResponse } from './types/predictions'
import './App.css'

type NavId =
  | 'dashboard'
  | 'games'
  | 'pitchers'
  | 'matchups'
  | 'ballparks'
  | 'trends'
  | 'about'

const NAV_ITEMS: Array<{ id: NavId; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'games', label: 'Games' },
  { id: 'pitchers', label: 'Pitchers' },
  { id: 'matchups', label: 'Matchups' },
  { id: 'ballparks', label: 'Ballparks' },
  { id: 'trends', label: 'Trends' },
  { id: 'about', label: 'About' },
]

function formatLongDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

function factorTone(value: number): 'hot' | 'warm' | 'neutral' | 'cold' {
  if (value >= 15) return 'hot'
  if (value >= 5) return 'warm'
  if (value <= -5) return 'cold'
  return 'neutral'
}

function hrProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(((value + 20) / 50) * 100)))
}

function scoreProgress(score: number): number {
  // score is expectedHrChance * 1000 (roughly 10–90 for typical boards)
  return Math.max(0, Math.min(100, Math.round(score)))
}

function App() {
  const [date, setDate] = useState(() => todayInEastern())
  const [activeNav, setActiveNav] = useState<NavId>('dashboard')
  const [parkData, setParkData] = useState<ParkFactorsResponse | null>(null)
  const [predictions, setPredictions] = useState<HrPredictionsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadProgress, setLoadProgress] = useState<{
    gamesDone: number
    gamesTotal: number
    gamesCached: number
  } | null>(null)
  const today = todayInEastern()
  const isToday = date === today

  // Progressive game-by-game HR board with localStorage reuse.
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setPredictions(null)
    setLoadProgress(null)

    void loadPredictionsProgressively({
      date,
      concurrency: 2,
      signal: controller.signal,
      onUpdate: (progress) => {
        if (controller.signal.aborted) return
        setLoadProgress({
          gamesDone: progress.gamesDone,
          gamesTotal: progress.gamesTotal,
          gamesCached: progress.gamesCached,
        })
        setPredictions({
          date: progress.date,
          statsAsOf: progress.statsAsOf,
          season: progress.season,
          generatedAt: new Date().toISOString(),
          gamesConsidered: progress.gamesTotal,
          battersScored: progress.predictions.length,
          predictions: progress.predictions,
          warnings: progress.warnings,
        })
        setLoading(progress.loading)
        setError(progress.error)
      },
    }).catch((err) => {
      if (controller.signal.aborted) return
      setError(err instanceof Error ? err.message : 'Unable to load predictions')
      setLoading(false)
    })

    return () => {
      controller.abort()
    }
  }, [date])

  // Ballpark factors are optional / separate from the HR board path.
  useEffect(() => {
    if (activeNav !== 'ballparks') return
    let cancelled = false
    void fetchParkFactors(date)
      .then((parks) => {
        if (!cancelled) setParkData(parks)
      })
      .catch(() => {
        // Ballparks tab can show empty; don't block dashboard.
      })
    return () => {
      cancelled = true
    }
  }, [date, activeNav])

  const rankedParks = parkData?.parks ?? []
  const topParks = rankedParks.filter((park) => park.hrFactor > 0)
  const displayDate = formatLongDate(date)
  const topPredictions = predictions?.predictions.slice(0, 20) ?? []
  const topPick = topPredictions[0] ?? null
  const hasPartialBoard = topPredictions.length > 0

  const summary = useMemo(() => {
    const topPark = rankedParks[0]
    const warmest = [...rankedParks]
      .filter((park) => park.temperature)
      .sort((a, b) => {
        const aTemp = Number(a.temperature?.match(/\d+/)?.[0] ?? 0)
        const bTemp = Number(b.temperature?.match(/\d+/)?.[0] ?? 0)
        return bTemp - aTemp
      })[0]
    const avgHr =
      rankedParks.length === 0
        ? 0
        : rankedParks.reduce((sum, park) => sum + park.hrFactor, 0) / rankedParks.length
    const avgScore =
      topPredictions.length === 0
        ? 0
        : topPredictions.reduce((sum, row) => sum + row.score, 0) / topPredictions.length

    return {
      topPark,
      warmest,
      avgHr,
      avgScore,
      positiveCount: topParks.length,
      topPick,
    }
  }, [rankedParks, topParks.length, topPick, topPredictions])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <div className="sidebar__mark">HR</div>
          <div className="sidebar__brand-text">HR Predictor</div>
        </div>

        <nav className="sidebar__nav" aria-label="Primary">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-item${activeNav === item.id ? ' is-active' : ''}`}
              onClick={() => setActiveNav(item.id)}
            >
              <NavIcon id={item.id} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar__footer">
          <div className="theme-toggle" aria-label="Theme">
            <span>Dark Mode</span>
            <span className="theme-toggle__track" aria-hidden="true">
              <span className="theme-toggle__thumb" />
            </span>
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="page-header fade-up">
          <div className="page-header__copy">
            <h1>{activeNav === 'ballparks' ? 'Ballparks' : 'Dashboard'}</h1>
            <p>
              {activeNav === 'ballparks'
                ? `MLB park factors for ${displayDate}, ranked by home-run environment.`
                : `HR board for ${displayDate}: full-slate matchups scored game-by-game (cached in your browser).`}
            </p>
          </div>
          <div className="page-header__actions">
            <div className="date-switcher" role="group" aria-label="Slate date">
              <button
                type="button"
                className="btn btn--ghost btn--icon"
                aria-label="Previous day"
                onClick={() => setDate((current) => shiftIsoDate(current, -1))}
                disabled={loading}
              >
                <ChevronLeftIcon />
              </button>
              <label className="date-switcher__field">
                <CalendarIcon />
                <span className="date-switcher__label">{displayDate}</span>
                <input
                  type="date"
                  value={date}
                  onChange={(event) => {
                    if (event.target.value) setDate(event.target.value)
                  }}
                  disabled={loading}
                  aria-label="Choose slate date"
                />
              </label>
              <button
                type="button"
                className="btn btn--ghost btn--icon"
                aria-label="Next day"
                onClick={() => setDate((current) => shiftIsoDate(current, 1))}
                disabled={loading}
              >
                <ChevronRightIcon />
              </button>
              {!isToday ? (
                <button
                  type="button"
                  className="btn btn--ghost date-switcher__today"
                  onClick={() => setDate(today)}
                  disabled={loading}
                >
                  Today
                </button>
              ) : null}
            </div>
          </div>
        </header>

        {loading ? (
          <p className="status-banner fade-up">
            {loadProgress
              ? `Scoring games ${loadProgress.gamesDone}/${loadProgress.gamesTotal}` +
                (loadProgress.gamesCached
                  ? ` · ${loadProgress.gamesCached} loaded from browser cache`
                  : '') +
                (hasPartialBoard ? ' · showing live top 20…' : '…')
              : `Loading slate for ${displayDate}…`}
          </p>
        ) : null}
        {error && !hasPartialBoard ? (
          <p className="status-banner status-banner--error fade-up" role="alert">
            {error}
          </p>
        ) : null}

        {activeNav === 'ballparks' ? (
          <BallparksView
            rankedParks={rankedParks}
            topParks={topParks}
            summary={summary}
            displayDate={displayDate}
            lastUpdated={parkData?.lastUpdated ?? null}
            sourceUrl={parkData?.sourceUrl}
          />
        ) : null}

        {activeNav !== 'ballparks' && (hasPartialBoard || !loading) && !error ? (
          <DashboardView
            predictions={topPredictions}
            summary={summary}
            meta={predictions}
            displayDate={displayDate}
          />
        ) : null}
        {activeNav !== 'ballparks' && hasPartialBoard && error ? (
          <>
            <p className="status-banner status-banner--error fade-up" role="alert">
              {error} (showing cached / partial board)
            </p>
            <DashboardView
              predictions={topPredictions}
              summary={summary}
              meta={predictions}
              displayDate={displayDate}
            />
          </>
        ) : null}
      </main>
    </div>
  )
}

function DashboardView({
  predictions,
  summary,
  meta,
  displayDate,
}: {
  predictions: HrPrediction[]
  summary: {
    topPark?: ParkFactor
    warmest?: ParkFactor
    avgHr: number
    avgScore: number
    positiveCount: number
    topPick: HrPrediction | null
  }
  meta: HrPredictionsResponse | null
  displayDate: string
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const selectedPrediction = useMemo(() => {
    if (predictions.length === 0) return null
    const match = selectedKey
      ? predictions.find(
          (prediction) => predictionKey(prediction) === selectedKey,
        )
      : null
    return match ?? summary.topPick ?? predictions[0] ?? null
  }, [predictions, selectedKey, summary.topPick])

  return (
    <>
      <section className="stat-grid fade-up" aria-label="Slate summary">
        <article className="card stat-card">
          <div className="stat-card__icon stat-card__icon--accent">
            <BoltIcon />
          </div>
          <div className="stat-card__label">Top HR Pick</div>
          <div className="stat-card__value">{summary.topPick?.batterName ?? '—'}</div>
          <div className="stat-card__meta">
            {summary.topPick
              ? `${summary.topPick.team} vs ${summary.topPick.pitcherName ?? 'TBD'} · ${summary.topPick.score}`
              : 'Waiting on lineups'}
          </div>
          <div className="stat-card__bar" />
        </article>

        <article className="card stat-card">
          <div className="stat-card__icon stat-card__icon--success">
            <StadiumIcon />
          </div>
          <div className="stat-card__label">Stadium</div>
          <div className="stat-card__value">{summary.topPick?.stadium ?? '—'}</div>
          <div className="stat-card__meta">
            {summary.topPick?.matchup ?? 'Full slate'}
          </div>
          <div className="stat-card__bar stat-card__bar--success" />
        </article>

        <article className="card stat-card">
          <div className="stat-card__icon stat-card__icon--warning">
            <ChartIcon />
          </div>
          <div className="stat-card__label">Games Scored</div>
          <div className="stat-card__value">{meta?.gamesConsidered ?? 0}</div>
          <div className="stat-card__meta">
            {meta?.battersScored ?? 0} batters across the full slate
          </div>
          <div className="stat-card__bar stat-card__bar--warning" />
        </article>

        <article className="card stat-card">
          <div className="stat-card__icon stat-card__icon--highlight">
            <WeatherIcon />
          </div>
          <div className="stat-card__label">Avg Top-20 Score</div>
          <div className="stat-card__value">{summary.avgScore.toFixed(1)}</div>
          <div className="stat-card__meta">{displayDate}</div>
          <div className="stat-card__bar stat-card__bar--highlight" />
        </article>
      </section>

      <section className="content-grid fade-up">
        <article className="card leaderboard-card">
          <div className="card__header">
            <div>
              <h2 className="card__title">Most Likely HR Batters</h2>
              <p className="card__subtitle">
                Ranked by HR score (0–100 from expected chance tonight: matchup × projected PAs ×
                durability; park + recent form included)
                {meta?.statsAsOf
                  ? ` · inputs through ${meta.statsAsOf} (excludes this slate’s games)`
                  : ''}
                {' · click a batter for details'}
              </p>
            </div>
            <span className="badge badge--accent">{predictions.length} batters</span>
          </div>
          <div className="card__body card__body--flush">
            {predictions.length === 0 ? (
              <p className="status-banner">
                No predictions yet — lineups may still be unconfirmed for today’s slate.
              </p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Batter</th>
                    <th>HR Score</th>
                    <th>Power</th>
                    <th>Platoon</th>
                    <th>vs Pitcher</th>
                    <th>Pitcher HR</th>
                    <th>Stadium</th>
                  </tr>
                </thead>
                <tbody>
                  {predictions.map((prediction) => {
                    const key = predictionKey(prediction)
                    return (
                      <PredictionRow
                        key={key}
                        prediction={prediction}
                        selected={selectedPrediction
                          ? predictionKey(selectedPrediction) === key
                          : false}
                        onSelect={() => setSelectedKey(key)}
                      />
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </article>

        {selectedPrediction ? <BatterDetail prediction={selectedPrediction} /> : null}
      </section>

      {meta?.warnings?.length ? (
        <div className="warnings fade-up">
          {meta.warnings.slice(0, 6).map((warning) => (
            <p key={warning} className="status-banner">
              {warning}
            </p>
          ))}
        </div>
      ) : null}

      <footer className="page-footer">
        Sources:{' '}
        <a href="https://www.ballparkpal.com/Park-Factors.php" target="_blank" rel="noreferrer">
          Ballpark Pal
        </a>
        ,{' '}
        <a
          href="https://baseballsavant.mlb.com/leaderboard/bat-tracking/swing-path-attack-angle"
          target="_blank"
          rel="noreferrer"
        >
          Savant Swing Path
        </a>
        ,{' '}
        <a href="https://baseballsavant.mlb.com/visuals/pitch3d" target="_blank" rel="noreferrer">
          Savant Pitch3D
        </a>
        , MLB Stats API.
      </footer>
    </>
  )
}

function predictionKey(prediction: HrPrediction): string {
  return `${prediction.gamePk}-${prediction.batterId}`
}

function BallparksView({
  rankedParks,
  topParks,
  summary,
  displayDate,
  lastUpdated,
  sourceUrl,
}: {
  rankedParks: ParkFactor[]
  topParks: ParkFactor[]
  summary: {
    topPark?: ParkFactor
    warmest?: ParkFactor
    avgHr: number
    positiveCount: number
  }
  displayDate: string
  lastUpdated: string | null
  sourceUrl?: string
}) {
  return (
    <>
      <section className="stat-grid fade-up" aria-label="Slate summary">
        <article className="card stat-card">
          <div className="stat-card__icon stat-card__icon--accent">
            <StadiumIcon />
          </div>
          <div className="stat-card__label">Top HR Park</div>
          <div className="stat-card__value">{summary.topPark?.stadium ?? '—'}</div>
          <div className="stat-card__meta">
            {summary.topPark ? `${summary.topPark.hrLabel} · ${summary.topPark.matchup}` : 'No games'}
          </div>
          <div className="stat-card__bar" />
        </article>
        <article className="card stat-card">
          <div className="stat-card__icon stat-card__icon--success">
            <WeatherIcon />
          </div>
          <div className="stat-card__label">Best Weather Spot</div>
          <div className="stat-card__value">{summary.warmest?.stadium ?? '—'}</div>
          <div className="stat-card__meta">{summary.warmest?.temperature ?? '—'}</div>
          <div className="stat-card__bar stat-card__bar--success" />
        </article>
        <article className="card stat-card">
          <div className="stat-card__icon stat-card__icon--warning">
            <ChartIcon />
          </div>
          <div className="stat-card__label">Avg HR Factor</div>
          <div className="stat-card__value">
            {summary.avgHr >= 0 ? '+' : ''}
            {summary.avgHr.toFixed(1)}%
          </div>
          <div className="stat-card__meta">{lastUpdated ?? 'Combined effect'}</div>
          <div className="stat-card__bar stat-card__bar--warning" />
        </article>
        <article className="card stat-card">
          <div className="stat-card__icon stat-card__icon--highlight">
            <BoltIcon />
          </div>
          <div className="stat-card__label">HR-Friendly Parks</div>
          <div className="stat-card__value">{summary.positiveCount}</div>
          <div className="stat-card__meta">Above league average today</div>
          <div className="stat-card__bar stat-card__bar--highlight" />
        </article>
      </section>

      <section className="content-grid fade-up">
        <article className="card leaderboard-card">
          <div className="card__header">
            <div>
              <h2 className="card__title">Top Ballparks by Home Run Factor</h2>
              <p className="card__subtitle">Sorted for {displayDate}</p>
            </div>
            <span className="badge badge--accent">{topParks.length || rankedParks.length} parks</span>
          </div>
          <div className="card__body card__body--flush">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Ballpark</th>
                  <th>HR Factor</th>
                  <th>Runs</th>
                  <th>Weather</th>
                  <th>Wind</th>
                </tr>
              </thead>
              <tbody>
                {(topParks.length > 0 ? topParks : rankedParks).map((park) => (
                  <ParkTableRow key={`${park.stadium}-${park.matchup}-${park.gameTime}`} park={park} />
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <footer className="page-footer">
        Data sourced from{' '}
        <a href={sourceUrl ?? 'https://www.ballparkpal.com/Park-Factors.php'} target="_blank" rel="noreferrer">
          Ballpark Pal Park Factors
        </a>
        .
      </footer>
    </>
  )
}

function PredictionRow({
  prediction,
  selected,
  onSelect,
}: {
  prediction: HrPrediction
  selected: boolean
  onSelect: () => void
}) {
  return (
    <tr
      className={selected ? 'is-selected' : undefined}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
      tabIndex={0}
      role="button"
      aria-pressed={selected}
    >
      <td>
        <span className={`rank-pill${prediction.rank <= 3 ? ' rank-pill--top' : ''}`}>
          {prediction.rank}
        </span>
      </td>
      <td>
        <div className="park-cell">
          <strong>
            {prediction.batterName}{' '}
            <span className="inline-muted">
              {prediction.team} · {prediction.position ?? '—'}
            </span>
          </strong>
          <span>
            {prediction.matchup} · batting #{prediction.battingOrder}
          </span>
        </div>
      </td>
      <td>
        <div className="hr-cell">
          <div
            className="progress-ring"
            style={
              {
                '--progress': scoreProgress(prediction.score),
                '--ring-color':
                  prediction.score >= 70
                    ? 'var(--color-warning)'
                    : prediction.score >= 58
                      ? 'var(--color-success)'
                      : 'var(--color-accent)',
              } as CSSProperties
            }
          >
            <span className="progress-ring__value">{Math.round(prediction.score)}</span>
          </div>
          <span className="metric metric--hot">{prediction.score.toFixed(1)}</span>
        </div>
      </td>
      <td>
        <div className="park-cell">
          <strong>
            Brl {prediction.power.barrelPercent ?? '—'}% · xSLG{' '}
            {prediction.power.xslg?.toFixed(3) ?? '—'}
          </strong>
          <span>
            EV50 {prediction.power.ev50 ?? '—'} · HH {prediction.power.hardHitPercent ?? '—'}%
          </span>
        </div>
      </td>
      <td>
        <div className="park-cell">
          <strong className={prediction.platoon.isOpposite ? 'metric metric--hot' : undefined}>
            {prediction.batSide}HB vs {prediction.pitcherHand ?? '?'}HP
            {prediction.platoon.isOpposite ? ' · opp' : ''}
          </strong>
          <span>
            {prediction.platoon.slg != null
              ? `SLG ${prediction.platoon.slg.toFixed(3)} · ${prediction.platoon.homeRuns ?? 0} HR / ${prediction.platoon.plateAppearances ?? 0} PA`
              : 'Split pending'}
          </span>
        </div>
      </td>
      <td>
        <div className="park-cell">
          <strong>
            {prediction.pitcherName ?? 'TBD'}
            {prediction.pitcherHand ? ` (${prediction.pitcherHand}HP)` : ''}
          </strong>
          <span>
            {prediction.arsenalTopPitches
              .map((pitch) => {
                const batterTag =
                  pitch.batterXslg != null ? ` bat xSLG ${pitch.batterXslg.toFixed(2)}` : ''
                return `${pitch.pitchType} ${Math.round(pitch.usage * 100)}%${batterTag}`
              })
              .join(' · ') || 'Arsenal pending'}
          </span>
        </div>
      </td>
      <td>
        <div className="park-cell">
          <strong className="metric metric--hot">
            {prediction.pitcherHr.homeRunsPer9 != null
              ? `${prediction.pitcherHr.homeRunsPer9.toFixed(2)} HR/9`
              : '—'}
          </strong>
          <span>
            {prediction.pitcherHr.homeRuns != null
              ? `${prediction.pitcherHr.homeRuns} HR · ${prediction.pitcherHr.inningsPitched ?? '—'} IP`
              : 'No HR sample'}
          </span>
        </div>
      </td>
      <td>
        <div className="park-cell">
          <strong>{prediction.stadium}</strong>
          <span>{prediction.matchup}</span>
        </div>
      </td>
    </tr>
  )
}

function BatterDetail({ prediction }: { prediction: HrPrediction }) {
  return (
    <aside className="card detail-card">
      <div className="card__header">
        <div>
          <h2 className="card__title">{prediction.batterName}</h2>
          <p className="card__subtitle">
            {prediction.team} vs {prediction.pitcherName ?? 'TBD'} · {prediction.stadium}
          </p>
        </div>
        <span className={`badge ${prediction.rank === 1 ? 'badge--warning' : 'badge--accent'}`}>
          {prediction.rank === 1 ? 'Top pick' : `#${prediction.rank}`}
        </span>
      </div>
      <div className="card__body detail-card__body">
        <div className="hr-gauge">
          <div
            className="progress-ring progress-ring--lg"
            style={
              {
                '--progress': scoreProgress(prediction.score),
                '--ring-color': 'var(--color-warning)',
              } as CSSProperties
            }
          >
            <span className="progress-ring__value">{prediction.score.toFixed(0)}</span>
          </div>
          <div>
            <p className="detail-kicker">HR Score</p>
            <p className="detail-score">{prediction.score.toFixed(1)}</p>
            <p className="detail-note">
              Matchup {prediction.matchupScore.toFixed(0)} · ~{prediction.projectedPa.toFixed(1)} PA
              vs starter · Conf {prediction.breakdown.confidence.toFixed(0)}
            </p>
          </div>
        </div>

        <div className="detail-stats">
          <div>
            <span>Power skill</span>
            <strong>{prediction.breakdown.powerSkill.toFixed(1)}</strong>
          </div>
          <div>
            <span>Arsenal match</span>
            <strong>{prediction.breakdown.arsenalMatch.toFixed(1)}</strong>
          </div>
          <div>
            <span>Platoon split</span>
            <strong>
              {prediction.breakdown.platoonSplit.toFixed(1)}
              <span className="inline-muted">
                {' '}
                ({prediction.batSide} vs {prediction.pitcherHand ?? '?'})
              </span>
            </strong>
          </div>
          <div>
            <span>Recent form</span>
            <strong>
              {prediction.recentForm.formScore?.toFixed(0) ?? '—'}
              <span className="inline-muted">
                {' '}
                ({prediction.recentForm.homeRuns ?? 0} HR / {prediction.recentForm.plateAppearances ?? 0} PA)
              </span>
            </strong>
          </div>
          <div>
            <span>Durability</span>
            <strong>
              {prediction.durability.factor?.toFixed(2) ?? '—'}
              <span className="inline-muted">
                {' '}
                (avg {prediction.durability.avgInnings ?? '—'} IP)
              </span>
            </strong>
          </div>
          <div>
            <span>Park</span>
            <strong>
              {prediction.parkHrFactor >= 0 ? '+' : ''}
              {prediction.parkHrFactor}%
            </strong>
          </div>
          <div>
            <span>Pitcher HR/9</span>
            <strong>
              {prediction.pitcherHr.homeRunsPer9?.toFixed(2) ?? '—'}
              <span className="inline-muted">
                {' '}
                ({prediction.breakdown.pitcherHrAllowed.toFixed(0)})
              </span>
            </strong>
          </div>
          <div>
            <span>vs-hand SLG</span>
            <strong>{prediction.platoon.slg?.toFixed(3) ?? '—'}</strong>
          </div>
          <div>
            <span>Barrel%</span>
            <strong>{prediction.power.barrelPercent ?? '—'}%</strong>
          </div>
          <div>
            <span>xSLG</span>
            <strong>{prediction.power.xslg?.toFixed(3) ?? '—'}</strong>
          </div>
          <div>
            <span>EV50</span>
            <strong>{prediction.power.ev50 ?? '—'} mph</strong>
          </div>
        </div>

        <ul className="detail-notes">
          {prediction.breakdown.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>

        <div className="detail-links">
          <a href={prediction.links.exitVelo} target="_blank" rel="noreferrer">
            Exit velo / barrels
          </a>
          <a href={prediction.links.expectedStats} target="_blank" rel="noreferrer">
            Expected stats
          </a>
          <a href={prediction.links.pitchArsenalStats} target="_blank" rel="noreferrer">
            Pitch arsenal stats
          </a>
          <a href={prediction.links.hrAllowed} target="_blank" rel="noreferrer">
            HR allowed leaders
          </a>
          <a href={prediction.links.swingPath} target="_blank" rel="noreferrer">
            Swing path
          </a>
          {prediction.links.pitch3d ? (
            <a href={prediction.links.pitch3d} target="_blank" rel="noreferrer">
              Pitcher 3D arsenal
            </a>
          ) : null}
        </div>
      </div>
    </aside>
  )
}

function ParkTableRow({ park }: { park: ParkFactor }) {
  const tone = factorTone(park.hrFactor)

  return (
    <tr>
      <td>
        <span className={`rank-pill${park.rank <= 3 ? ' rank-pill--top' : ''}`}>{park.rank}</span>
      </td>
      <td>
        <div className="park-cell">
          <strong>{park.stadium}</strong>
          <span>{[park.matchup, park.gameTime].filter(Boolean).join(' · ')}</span>
        </div>
      </td>
      <td>
        <div className="hr-cell">
          <div
            className="progress-ring"
            style={
              {
                '--progress': hrProgress(park.hrFactor),
                '--ring-color':
                  tone === 'hot'
                    ? 'var(--color-warning)'
                    : tone === 'warm'
                      ? 'var(--color-success)'
                      : 'var(--color-accent)',
              } as CSSProperties
            }
          >
            <span className="progress-ring__value">{Math.round(park.hrFactor)}%</span>
          </div>
          <span className={`metric metric--${tone}`}>{park.hrLabel}</span>
        </div>
      </td>
      <td className={`metric metric--${factorTone(park.runsFactor)}`}>{park.runsLabel}</td>
      <td className="muted-cell">{park.temperature ?? '—'}</td>
      <td>
        <span className="badge badge--muted">{park.windReceptiveness ?? '—'}</span>
      </td>
    </tr>
  )
}

function NavIcon({ id }: { id: NavId }) {
  switch (id) {
    case 'dashboard':
      return (
        <svg className="nav-item__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 13h7V4H4v9Zm9 7h7V11h-7v9ZM4 20h7v-5H4v5Zm9-11h7V4h-7v5Z" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      )
    case 'games':
      return (
        <svg className="nav-item__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8 10.5c1.2 1 2.5 1.5 4 1.5s2.8-.5 4-1.5M9 14.5c.9.6 2 1 3 1s2.1-.4 3-1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )
    case 'pitchers':
      return (
        <svg className="nav-item__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M8 7h8v3a4 4 0 0 1-8 0V7Z" stroke="currentColor" strokeWidth="1.6" />
          <path d="M12 14v6M9 20h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )
    case 'matchups':
      return (
        <svg className="nav-item__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M7 8h4v8H7V8Zm6 0h4v8h-4V8Z" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      )
    case 'ballparks':
      return (
        <svg className="nav-item__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 18V8l8-4 8 4v10" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M8 18v-5h8v5" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      )
    case 'trends':
      return (
        <svg className="nav-item__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 16l5-5 3.5 3.5L20 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    default:
      return (
        <svg className="nav-item__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.6" />
          <path d="M12 10v5M12 7.5h.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )
  }
}

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 3.5V7M16 3.5V7M3.5 10h17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function ChevronLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M14.5 6 9 12l5.5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9.5 6 15 12l-5.5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function StadiumIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 18V9l8-4 8 4v9" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 18v-4h8v4" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

function WeatherIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

function ChartIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 19V9M12 19V5M19 19v-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function BoltIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M13 3 5 14h6l-1 7 9-12h-6l0-6Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

export default App
