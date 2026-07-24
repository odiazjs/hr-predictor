import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseCsv } from '../utils/csv.ts'
import { seasonStartDate, shiftIsoDate } from '../utils/date.ts'
import { fetchText } from '../utils/http.ts'

export type StatcastPlayerType = 'batter' | 'pitcher'

export interface StatcastPitch {
  pitchType: string
  gameDate: string
  batterId: number
  pitcherId: number
  playerName: string
  events: string
  description: string
  type: string
  launchSpeed: number | null
  launchAngle: number | null
  launchSpeedAngle: number | null
  estimatedBa: number | null
  estimatedWoba: number | null
  estimatedSlg: number | null
  wobaValue: number | null
}

const memoryCache = new Map<string, { expires: number; value: StatcastPitch[] }>()
const CACHE_DIR = path.resolve(process.cwd(), '.cache', 'statcast')

/**
 * Pitch-level Statcast rows for one player from season start through endDate
 * (inclusive). Uses batters_lookup[] / pitchers_lookup[] so requests stay
 * under Savant's 25k row cap.
 */
export async function fetchPlayerPitches(
  playerId: number,
  playerType: StatcastPlayerType,
  season: number,
  endDate: string,
): Promise<StatcastPitch[]> {
  const key = `${playerType}:${playerId}:${season}:${endDate}`
  const cached = memoryCache.get(key)
  if (cached && cached.expires > Date.now()) return cached.value

  const diskPath = path.join(CACHE_DIR, `${key}.json`)
  try {
    const raw = await readFile(diskPath, 'utf8')
    const parsed = JSON.parse(raw) as StatcastPitch[]
    memoryCache.set(key, { expires: Date.now() + 1000 * 60 * 60 * 6, value: parsed })
    return parsed
  } catch {
    // cold cache
  }

  const startDate = seasonStartDate(season)
  // Savant game_date_lt is exclusive of the next calendar day.
  const gameDateLt = shiftIsoDate(endDate, 1)
  const lookupParam =
    playerType === 'batter'
      ? `batters_lookup%5B%5D=${playerId}`
      : `pitchers_lookup%5B%5D=${playerId}`

  const url =
    `https://baseballsavant.mlb.com/statcast_search/csv?all=true` +
    `&hfPT=&hfAB=&hfBBT=&hfPR=&hfZ=&stadium=&hfBBL=&hfNewZones=&hfGT=R%7C` +
    `&hfSea=${season}%7C&hfSit=&player_type=${playerType}` +
    `&hfOuts=&opponent=&pitcher_throws=&batter_stands=&hfSA=` +
    `&game_date_gt=${startDate}&game_date_lt=${gameDateLt}` +
    `&${lookupParam}&team=&position=&hfRO=&home_road=&hfFlag=&metric_1=&hfInn=` +
    `&min_pitches=0&min_results=0&group_by=name&sort_col=pitches` +
    `&player_event_sort=h_launch_speed&sort_order=desc&min_abs=0&type=details&`

  const csv = await fetchText(url)
  const rows = parseCsv(csv)
  const pitches = rows.map(mapRow).filter((row) => row.batterId > 0 || row.pitcherId > 0)

  memoryCache.set(key, { expires: Date.now() + 1000 * 60 * 60 * 6, value: pitches })

  try {
    await mkdir(CACHE_DIR, { recursive: true })
    await writeFile(diskPath, JSON.stringify(pitches), 'utf8')
  } catch {
    // disk cache is best-effort
  }

  return pitches
}

function mapRow(row: Record<string, string>): StatcastPitch {
  return {
    pitchType: (row.pitch_type || '').toUpperCase(),
    gameDate: row.game_date || '',
    batterId: Number(row.batter) || 0,
    pitcherId: Number(row.pitcher) || 0,
    playerName: row.player_name || '',
    events: row.events || '',
    description: row.description || '',
    type: row.type || '',
    launchSpeed: toNum(row.launch_speed),
    launchAngle: toNum(row.launch_angle),
    launchSpeedAngle: toNum(row.launch_speed_angle),
    estimatedBa: toNum(row.estimated_ba_using_speedangle),
    estimatedWoba: toNum(row.estimated_woba_using_speedangle),
    estimatedSlg: toNum(row.estimated_slg_using_speedangle),
    wobaValue: toNum(row.woba_value),
  }
}

function toNum(value: string | undefined): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
