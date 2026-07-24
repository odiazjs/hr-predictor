import { parseCsv } from '../utils/csv.ts'
import { fetchText } from '../utils/http.ts'

export interface PitchTypeDamage {
  pitchType: string
  pitchName: string
  pitches: number
  usage: number
  pa: number
  ba: number
  slg: number
  woba: number
  xba: number
  xslg: number
  xwoba: number
  hardHitPercent: number
  runValuePer100: number
  whiffPercent: number
}

export type PitchArsenalStatsMap = Map<number, Map<string, PitchTypeDamage>>

const cache = new Map<string, { expires: number; value: PitchArsenalStatsMap }>()

export async function fetchPitchArsenalStatsMap(
  season: number,
  playerType: 'pitcher' | 'batter',
  minPitches = 25,
): Promise<PitchArsenalStatsMap> {
  const key = `${playerType}:${season}:${minPitches}`
  const cached = cache.get(key)
  if (cached && cached.expires > Date.now()) return cached.value

  const url =
    `https://baseballsavant.mlb.com/leaderboard/pitch-arsenal-stats` +
    `?type=${playerType}&year=${season}&min=${minPitches}&csv=true`

  const rows = parseCsv(await fetchText(url))
  const map: PitchArsenalStatsMap = new Map()

  for (const row of rows) {
    const playerId = Number(row.player_id)
    const pitchType = (row.pitch_type || '').toUpperCase()
    if (!playerId || !pitchType) continue

    const damage: PitchTypeDamage = {
      pitchType,
      pitchName: row.pitch_name || pitchType,
      pitches: Number(row.pitches) || 0,
      usage: (Number(row.pitch_usage) || 0) / 100,
      pa: Number(row.pa) || 0,
      ba: Number(row.ba) || 0,
      slg: Number(row.slg) || 0,
      woba: Number(row.woba) || 0,
      xba: Number(row.est_ba) || 0,
      xslg: Number(row.est_slg) || 0,
      xwoba: Number(row.est_woba) || 0,
      hardHitPercent: Number(row.hard_hit_percent) || 0,
      runValuePer100: Number(row.run_value_per_100) || 0,
      whiffPercent: Number(row.whiff_percent) || 0,
    }

    const existing = map.get(playerId) ?? new Map<string, PitchTypeDamage>()
    existing.set(pitchType, damage)
    map.set(playerId, existing)
  }

  cache.set(key, { expires: Date.now() + 1000 * 60 * 30, value: map })
  return map
}
