import { seasonStartDate } from '../utils/date.ts'
import { fetchJson } from '../utils/http.ts'

export interface PitcherHrAllowed {
  pitcherId: number
  name: string
  homeRuns: number
  homeRunsPer9: number
  inningsPitched: number
  gamesStarted: number
  era: number
}

const cache = new Map<string, { expires: number; value: Map<number, PitcherHrAllowed> }>()

/**
 * Pitching HR allowed through endDate (inclusive), from the same feed behind
 * https://www.mlb.com/stats/pitching/home-runs-allowed
 *
 * Uses byDateRange whenever endDate is provided so slate-day HRs are excluded
 * when endDate is the prior calendar day.
 */
export async function fetchPitcherHrAllowedMap(
  season: number,
  options?: { endDate?: string },
): Promise<Map<number, PitcherHrAllowed>> {
  const endDate = options?.endDate
  const key = endDate ? `${season}:${endDate}` : `${season}:season`
  const cached = cache.get(key)
  if (cached && cached.expires > Date.now()) return cached.value

  const startDate = seasonStartDate(season)
  const statsQuery = endDate
    ? `stats=byDateRange&startDate=${startDate}&endDate=${endDate}`
    : 'stats=season'

  const url =
    `https://statsapi.mlb.com/api/v1/stats` +
    `?${statsQuery}&group=pitching&season=${season}` +
    `&sportIds=1&playerPool=ALL&limit=500&order=desc&sortStat=homeRuns`

  const payload = await fetchJson<{
    stats?: Array<{
      splits?: Array<{
        player?: { id?: number; fullName?: string }
        stat?: {
          homeRuns?: number
          homeRunsPer9?: string | number
          inningsPitched?: string | number
          gamesStarted?: number
          era?: string | number
        }
      }>
    }>
  }>(url)

  const map = new Map<number, PitcherHrAllowed>()
  for (const split of payload.stats?.[0]?.splits ?? []) {
    const pitcherId = split.player?.id
    if (!pitcherId) continue

    map.set(pitcherId, {
      pitcherId,
      name: split.player?.fullName ?? '',
      homeRuns: Number(split.stat?.homeRuns) || 0,
      homeRunsPer9: Number(split.stat?.homeRunsPer9) || 0,
      inningsPitched: Number(split.stat?.inningsPitched) || 0,
      gamesStarted: Number(split.stat?.gamesStarted) || 0,
      era: Number(split.stat?.era) || 0,
    })
  }

  // Also pull a rate-sorted qualified page so low-IP outliers don't dominate coverage.
  try {
    const rateUrl =
      `https://statsapi.mlb.com/api/v1/stats` +
      `?${statsQuery}&group=pitching&season=${season}` +
      `&sportIds=1&playerPool=ALL&limit=300&order=desc&sortStat=homeRunsPer9`

    const ratePayload = await fetchJson<typeof payload>(rateUrl)
    for (const split of ratePayload.stats?.[0]?.splits ?? []) {
      const pitcherId = split.player?.id
      if (!pitcherId || map.has(pitcherId)) continue
      map.set(pitcherId, {
        pitcherId,
        name: split.player?.fullName ?? '',
        homeRuns: Number(split.stat?.homeRuns) || 0,
        homeRunsPer9: Number(split.stat?.homeRunsPer9) || 0,
        inningsPitched: Number(split.stat?.inningsPitched) || 0,
        gamesStarted: Number(split.stat?.gamesStarted) || 0,
        era: Number(split.stat?.era) || 0,
      })
    }
  } catch {
    // optional enrichment
  }

  cache.set(key, { expires: Date.now() + 1000 * 60 * 30, value: map })
  return map
}

/** Fill gaps for slate pitchers who may not appear on the HR leaderboard page. */
export async function enrichPitcherHrAllowedMap(
  season: number,
  pitcherIds: number[],
  existing: Map<number, PitcherHrAllowed>,
  options?: { endDate?: string },
): Promise<Map<number, PitcherHrAllowed>> {
  const missing = pitcherIds.filter((id) => !existing.has(id))
  if (missing.length === 0) return existing

  const endDate = options?.endDate
  const startDate = seasonStartDate(season)
  const hydrate = endDate
    ? `stats(group=[pitching],type=[byDateRange],season=${season},startDate=${startDate},endDate=${endDate})`
    : `stats(group=[pitching],type=[season],season=${season})`

  const url =
    `https://statsapi.mlb.com/api/v1/people` +
    `?personIds=${missing.join(',')}` +
    `&hydrate=${hydrate}`

  try {
    const payload = await fetchJson<{
      people?: Array<{
        id?: number
        fullName?: string
        stats?: Array<{
          splits?: Array<{
            stat?: {
              homeRuns?: number
              homeRunsPer9?: string | number
              inningsPitched?: string | number
              gamesStarted?: number
              era?: string | number
            }
          }>
        }>
      }>
    }>(url)

    for (const person of payload.people ?? []) {
      if (!person.id) continue
      const stat = person.stats?.[0]?.splits?.[0]?.stat
      if (!stat) continue
      existing.set(person.id, {
        pitcherId: person.id,
        name: person.fullName ?? '',
        homeRuns: Number(stat.homeRuns) || 0,
        homeRunsPer9: Number(stat.homeRunsPer9) || 0,
        inningsPitched: Number(stat.inningsPitched) || 0,
        gamesStarted: Number(stat.gamesStarted) || 0,
        era: Number(stat.era) || 0,
      })
    }
  } catch {
    // keep existing map
  }

  return existing
}
