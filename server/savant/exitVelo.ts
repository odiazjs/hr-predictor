import { parseCsv } from '../utils/csv.ts'
import { fetchText } from '../utils/http.ts'

export interface ExitVeloProfile {
  playerId: number
  name: string
  bip: number
  avgHitAngle: number
  sweetSpotPercent: number
  maxHitSpeed: number
  avgHitSpeed: number
  ev50: number
  avgHrDistance: number
  hardHitPercent: number
  barrels: number
  barrelPercent: number
  barrelsPerPa: number
}

const cache = new Map<number, { expires: number; value: Map<number, ExitVeloProfile> }>()

export async function fetchExitVeloMap(season: number): Promise<Map<number, ExitVeloProfile>> {
  const cached = cache.get(season)
  if (cached && cached.expires > Date.now()) return cached.value

  const url =
    `https://baseballsavant.mlb.com/leaderboard/statcast` +
    `?type=batter&year=${season}&min=1&csv=true`

  const rows = parseCsv(await fetchText(url))
  const map = new Map<number, ExitVeloProfile>()

  for (const row of rows) {
    const playerId = Number(row.player_id)
    if (!playerId) continue

    map.set(playerId, {
      playerId,
      name: row['last_name, first_name'] ?? '',
      bip: Number(row.attempts) || 0,
      avgHitAngle: Number(row.avg_hit_angle) || 0,
      sweetSpotPercent: Number(row.anglesweetspotpercent) || 0,
      maxHitSpeed: Number(row.max_hit_speed) || 0,
      avgHitSpeed: Number(row.avg_hit_speed) || 0,
      ev50: Number(row.ev50) || 0,
      avgHrDistance: Number(row.avg_hr_distance) || 0,
      hardHitPercent: Number(row.ev95percent) || 0,
      barrels: Number(row.barrels) || 0,
      barrelPercent: Number(row.brl_percent) || 0,
      barrelsPerPa: Number(row.brl_pa) || 0,
    })
  }

  cache.set(season, { expires: Date.now() + 1000 * 60 * 30, value: map })
  return map
}
