import type { HrPrediction, HrPredictionsResponse } from '../types/predictions'
import { apiUrl } from './baseUrl'
import { todayInEastern } from './parkFactors'
import {
  PREDICTION_CACHE_VERSION,
  readCachedGame,
  writeCachedGame,
} from './predictionCache'
import { fetchSlateSchedule, type SlateGameSummary } from './schedule'

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) {
    let message = `Request failed (${response.status})`
    try {
      const body = (await response.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // ignore
    }
    throw new Error(message)
  }
  return response.json() as Promise<T>
}

export async function fetchHrPredictions(options?: {
  date?: string
}): Promise<HrPredictionsResponse> {
  const date = options?.date ?? todayInEastern()
  const params = new URLSearchParams({ date })
  return fetchJson(apiUrl(`/api/hr-predictions?${params.toString()}`))
}

export async function fetchGamePredictions(options: {
  date: string
  gamePk: number
}): Promise<HrPredictionsResponse> {
  const params = new URLSearchParams({
    date: options.date,
    gamePk: String(options.gamePk),
  })
  return fetchJson(apiUrl(`/api/hr-predictions/game?${params.toString()}`))
}

export interface ProgressiveLoadProgress {
  date: string
  statsAsOf: string
  season: number
  gamesTotal: number
  gamesDone: number
  gamesCached: number
  gamesFailed: number
  predictions: HrPrediction[]
  warnings: string[]
  loading: boolean
  error: string | null
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0

  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await worker(items[index])
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => run()),
  )
  return results
}

function rankPredictions(predictions: HrPrediction[]): HrPrediction[] {
  return [...predictions]
    .sort((a, b) => b.score - a.score)
    .map((prediction, index) => ({ ...prediction, rank: index + 1 }))
}

/**
 * Load slate game-by-game. Uses localStorage for already-scored games
 * (keyed by date + statsAsOf + gamePk + lineup fingerprint).
 */
export async function loadPredictionsProgressively(options: {
  date: string
  concurrency?: number
  signal?: AbortSignal
  onUpdate: (progress: ProgressiveLoadProgress) => void
}): Promise<void> {
  const date = options.date
  const concurrency = options.concurrency ?? 2
  const signal = options.signal

  const schedule = await fetchSlateSchedule(date)
  if (signal?.aborted) return

  const games = schedule.games
  const predictionByGame = new Map<number, HrPrediction[]>()
  const warnings: string[] = []
  let gamesCached = 0
  let gamesFailed = 0
  let gamesDone = 0

  const emit = (loading: boolean, error: string | null = null) => {
    const predictions = rankPredictions([...predictionByGame.values()].flat())
    options.onUpdate({
      date,
      statsAsOf: schedule.statsAsOf,
      season: schedule.season,
      gamesTotal: games.length,
      gamesDone,
      gamesCached,
      gamesFailed,
      predictions,
      warnings: [...new Set(warnings)],
      loading,
      error,
    })
  }

  // Hydrate from browser cache first for instant UI.
  for (const game of games) {
    const cached = readCachedGame({
      date,
      statsAsOf: schedule.statsAsOf,
      gamePk: game.gamePk,
      lineupFingerprint: game.lineupFingerprint,
    })
    if (!cached) continue
    predictionByGame.set(game.gamePk, cached.predictions)
    warnings.push(...cached.warnings)
    gamesCached += 1
    gamesDone += 1
  }
  emit(true)

  const pending = games.filter((game) => !predictionByGame.has(game.gamePk))

  await mapPool(pending, concurrency, async (game: SlateGameSummary) => {
    if (signal?.aborted) return

    // Games without lineups: cache empty result so we don't hammer the API.
    if (!game.hasLineups) {
      const empty: HrPrediction[] = []
      predictionByGame.set(game.gamePk, empty)
      writeCachedGame({
        version: PREDICTION_CACHE_VERSION,
        date,
        statsAsOf: schedule.statsAsOf,
        gamePk: game.gamePk,
        lineupFingerprint: game.lineupFingerprint,
        savedAt: new Date().toISOString(),
        predictions: empty,
        warnings: [`No confirmed lineups yet for ${game.matchup}`],
      })
      warnings.push(`No confirmed lineups yet for ${game.matchup}`)
      gamesDone += 1
      emit(true)
      return
    }

    try {
      const payload = await fetchGamePredictions({ date, gamePk: game.gamePk })
      if (signal?.aborted) return

      const fingerprint = payload.lineupFingerprint ?? game.lineupFingerprint
      predictionByGame.set(game.gamePk, payload.predictions)
      warnings.push(...payload.warnings)
      writeCachedGame({
        version: PREDICTION_CACHE_VERSION,
        date,
        statsAsOf: schedule.statsAsOf,
        gamePk: game.gamePk,
        lineupFingerprint: fingerprint,
        savedAt: new Date().toISOString(),
        predictions: payload.predictions,
        warnings: payload.warnings,
      })
    } catch (error) {
      gamesFailed += 1
      warnings.push(
        `Failed to score ${game.matchup}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      )
    } finally {
      gamesDone += 1
      emit(true)
    }
  })

  if (signal?.aborted) return

  const hardFail = gamesDone === 0 && games.length > 0
  emit(
    false,
    hardFail
      ? 'Unable to load any game predictions'
      : gamesFailed > 0 && predictionByGame.size === 0
        ? 'Unable to load predictions'
        : null,
  )
}
