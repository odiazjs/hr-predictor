import { parseCsv } from '../utils/csv.ts'
import { fetchText } from '../utils/http.ts'

/**
 * Expected stats are built from Statcast hit-probability models
 * (EV + LA → expected outcomes). xSLG / xwOBA are the best public
 * proxies for "hit probability" power skill.
 */
export interface ExpectedStatsProfile {
  playerId: number
  name: string
  pa: number
  bip: number
  ba: number
  xba: number
  slg: number
  xslg: number
  woba: number
  xwoba: number
}

const cache = new Map<number, { expires: number; value: Map<number, ExpectedStatsProfile> }>()

export async function fetchExpectedStatsMap(
  season: number,
): Promise<Map<number, ExpectedStatsProfile>> {
  const cached = cache.get(season)
  if (cached && cached.expires > Date.now()) return cached.value

  const url =
    `https://baseballsavant.mlb.com/leaderboard/expected_statistics` +
    `?type=batter&year=${season}&position=&team=&min=1&csv=true`

  const rows = parseCsv(await fetchText(url))
  const map = new Map<number, ExpectedStatsProfile>()

  for (const row of rows) {
    const playerId = Number(row.player_id)
    if (!playerId) continue

    map.set(playerId, {
      playerId,
      name: row['last_name, first_name'] ?? '',
      pa: Number(row.pa) || 0,
      bip: Number(row.bip) || 0,
      ba: Number(row.ba) || 0,
      xba: Number(row.est_ba) || 0,
      slg: Number(row.slg) || 0,
      xslg: Number(row.est_slg) || 0,
      woba: Number(row.woba) || 0,
      xwoba: Number(row.est_woba) || 0,
    })
  }

  cache.set(season, { expires: Date.now() + 1000 * 60 * 30, value: map })
  return map
}
