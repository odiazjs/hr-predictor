import type { HrPrediction } from '../types/predictions'

/** Bump when scoring formula or payload shape changes. */
export const PREDICTION_CACHE_VERSION = 6

export interface CachedGamePredictions {
  version: number
  date: string
  statsAsOf: string
  gamePk: number
  lineupFingerprint: string
  savedAt: string
  predictions: HrPrediction[]
  warnings: string[]
}

function cacheKey(date: string, statsAsOf: string, gamePk: number, fingerprint: string): string {
  return `hr-pred:v${PREDICTION_CACHE_VERSION}:${date}:${statsAsOf}:${gamePk}:${fingerprint}`
}

export function readCachedGame(options: {
  date: string
  statsAsOf: string
  gamePk: number
  lineupFingerprint: string
}): CachedGamePredictions | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(
      cacheKey(options.date, options.statsAsOf, options.gamePk, options.lineupFingerprint),
    )
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedGamePredictions
    if (
      parsed.version !== PREDICTION_CACHE_VERSION ||
      parsed.date !== options.date ||
      parsed.statsAsOf !== options.statsAsOf ||
      parsed.gamePk !== options.gamePk ||
      parsed.lineupFingerprint !== options.lineupFingerprint
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function writeCachedGame(entry: CachedGamePredictions): void {
  if (typeof localStorage === 'undefined') return
  const key = cacheKey(entry.date, entry.statsAsOf, entry.gamePk, entry.lineupFingerprint)
  try {
    localStorage.setItem(key, JSON.stringify(entry))
  } catch {
    // Quota exceeded — drop oldest hr-pred keys and retry once.
    try {
      prunePredictionCache()
      localStorage.setItem(key, JSON.stringify(entry))
    } catch {
      // give up silently
    }
  }
}

function prunePredictionCache(): void {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i)
    if (key?.startsWith('hr-pred:')) keys.push(key)
  }
  // Remove oldest half by key order (good enough for quota recovery).
  keys.sort()
  const removeCount = Math.max(1, Math.floor(keys.length / 2))
  for (const key of keys.slice(0, removeCount)) {
    localStorage.removeItem(key)
  }
}
