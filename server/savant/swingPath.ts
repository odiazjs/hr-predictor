import { parseCsv } from '../utils/csv.ts'
import { fetchText } from '../utils/http.ts'

export interface SwingPathProfile {
  playerId: number
  name: string
  side: 'L' | 'R' | 'S'
  avgBatSpeed: number
  swingTilt: number
  attackAngle: number
  attackDirection: number
  idealAttackAngleRate: number
  competitiveSwings: number
}

const cache = new Map<string, { expires: number; value: Map<number, SwingPathProfile> }>()

export async function fetchSwingPathMap(
  season: number,
  options?: { endDate?: string },
): Promise<Map<number, SwingPathProfile>> {
  const endDate = options?.endDate ?? `${season}-12-31`
  const key = `${season}:${endDate}`
  const cached = cache.get(key)
  if (cached && cached.expires > Date.now()) {
    return cached.value
  }

  const url =
    `https://baseballsavant.mlb.com/leaderboard/bat-tracking/swing-path-attack-angle` +
    `?dateStart=${season}-01-01&dateEnd=${endDate}` +
    `&gameType=Regular&minSwings=1&minGroupSwings=1` +
    `&seasonStart=${season}&seasonEnd=${season}&type=batter&csv=true`

  const csv = await fetchText(url)
  const rows = parseCsv(csv)
  const map = new Map<number, SwingPathProfile>()

  for (const row of rows) {
    const playerId = Number(row.id)
    if (!playerId) continue

    map.set(playerId, {
      playerId,
      name: row.name,
      side: normalizeSide(row.side),
      avgBatSpeed: Number(row.avg_bat_speed) || 0,
      swingTilt: Number(row.swing_tilt) || 0,
      attackAngle: Number(row.attack_angle) || 0,
      attackDirection: Number(row.attack_direction) || 0,
      idealAttackAngleRate: Number(row.ideal_attack_angle_rate) || 0,
      competitiveSwings: Number(row.competitive_swings) || 0,
    })
  }

  cache.set(key, {
    expires: Date.now() + 1000 * 60 * 30,
    value: map,
  })

  return map
}

function normalizeSide(value: string | undefined): 'L' | 'R' | 'S' {
  const side = (value ?? 'R').toUpperCase()
  if (side === 'L' || side === 'R' || side === 'S') return side
  return 'R'
}
