import { shiftIsoDate } from '../utils/date.ts'
import { fetchJson } from '../utils/http.ts'
import { mapPool } from '../utils/pool.ts'

export interface BatterRecentForm {
  batterId: number
  name: string
  plateAppearances: number
  homeRuns: number
  slg: number
  ops: number
  avg: number
  /** 0–100 hot/cold score from ~last 21 days. */
  formScore: number
}

const cache = new Map<string, { expires: number; value: Map<number, BatterRecentForm> }>()
const CHUNK = 40
const WINDOW_DAYS = 21

/**
 * Batter hitting form from MLB byDateRange ending on asOfDate
 * (approximately last 21 days).
 */
export async function fetchBatterRecentFormMap(
  season: number,
  batterIds: number[],
  asOfDate: string,
): Promise<Map<number, BatterRecentForm>> {
  const ids = [...new Set(batterIds)].filter((id) => id > 0)
  const startDate = shiftIsoDate(asOfDate, -(WINDOW_DAYS - 1))
  const key = `${season}:${startDate}:${asOfDate}:${ids.slice().sort((a, b) => a - b).join(',')}`
  const cached = cache.get(key)
  if (cached && cached.expires > Date.now()) return cached.value

  const map = new Map<number, BatterRecentForm>()
  if (ids.length === 0) return map

  const chunks: number[][] = []
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK))

  await mapPool(chunks, 3, async (chunk) => {
    const url =
      `https://statsapi.mlb.com/api/v1/people` +
      `?personIds=${chunk.join(',')}` +
      `&hydrate=stats(group=[hitting],type=[byDateRange],season=${season},startDate=${startDate},endDate=${asOfDate})`

    const payload = await fetchJson<{
      people?: Array<{
        id?: number
        fullName?: string
        stats?: Array<{
          splits?: Array<{
            stat?: {
              plateAppearances?: number
              homeRuns?: number
              slg?: string | number
              ops?: string | number
              avg?: string | number
            }
          }>
        }>
      }>
    }>(url)

    for (const person of payload.people ?? []) {
      if (!person.id) continue
      const stat = person.stats?.[0]?.splits?.[0]?.stat
      const pa = Number(stat?.plateAppearances) || 0
      const homeRuns = Number(stat?.homeRuns) || 0
      const slg = Number(stat?.slg) || 0
      const ops = Number(stat?.ops) || 0
      const avg = Number(stat?.avg) || 0
      map.set(person.id, {
        batterId: person.id,
        name: person.fullName ?? '',
        plateAppearances: pa,
        homeRuns,
        slg,
        ops,
        avg,
        formScore: scoreRecentForm(pa, homeRuns, slg, ops),
      })
    }
  })

  cache.set(key, { expires: Date.now() + 1000 * 60 * 30, value: map })
  return map
}

function scoreRecentForm(
  pa: number,
  homeRuns: number,
  slg: number,
  ops: number,
): number {
  if (pa < 15) return 50
  const hrPerPa = homeRuns / pa
  const slgScore = clamp01((slg - 0.3) / 0.4) * 45
  const opsScore = clamp01((ops - 0.6) / 0.45) * 25
  const hrScore = clamp01((hrPerPa - 0.015) / 0.07) * 30
  let score = clamp(slgScore + opsScore + hrScore, 0, 100)
  if (pa < 35) {
    const weight = pa / 35
    score = score * weight + 50 * (1 - weight)
  }
  return Math.round(score * 10) / 10
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
