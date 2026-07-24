import { parseCsv } from '../utils/csv.ts'
import { fetchText } from '../utils/http.ts'

export type PitchTypeCode =
  | 'FF'
  | 'SI'
  | 'FC'
  | 'SL'
  | 'ST'
  | 'SV'
  | 'CU'
  | 'CH'
  | 'FS'
  | 'KN'
  | 'OTHER'

export interface ArsenalPitch {
  pitchType: PitchTypeCode
  pitchHand: 'L' | 'R'
  batSide: 'L' | 'R'
  season: number
  count: number
  usage: number
  avgSpeed: number
  avgPlateX: number
  avgPlateZ: number
  avgSpin: number
}

export interface PitcherArsenal {
  pitcherId: number
  name: string
  pitchHand: 'L' | 'R'
  season: number
  pitches: ArsenalPitch[]
  sourceUrl: string
}

const cache = new Map<string, { expires: number; value: PitcherArsenal }>()

export async function fetchPitcherArsenal(
  pitcherId: number,
  season: number,
): Promise<PitcherArsenal> {
  const key = `${pitcherId}:${season}`
  const cached = cache.get(key)
  if (cached && cached.expires > Date.now()) {
    return cached.value
  }

  const sourceUrl = `https://baseballsavant.mlb.com/app/archetype/${pitcherId}`
  const csv = await fetchText(sourceUrl)
  const rows = parseCsv(csv)

  const seasonRows = rows.filter((row) => Number(row.year) === season)
  const workingRows = seasonRows.length > 0 ? seasonRows : rows

  const grouped = new Map<string, ArsenalPitch & { _n: number }>()
  let name = ''
  let pitchHand: 'L' | 'R' = 'R'

  for (const row of workingRows) {
    const pitchType = normalizePitchType(row.api_pitch_type)
    if (pitchType === 'OTHER') continue

    const batSide = (row.bat_side || 'R').toUpperCase() === 'L' ? 'L' : 'R'
    const count = Number(row.n) || 0
    if (count <= 0) continue

    name = row.name_display_last_first || name
    pitchHand = (row.pitch_hand || 'R').toUpperCase() === 'L' ? 'L' : 'R'

    const groupKey = `${pitchType}:${batSide}`
    const existing = grouped.get(groupKey)
    if (!existing) {
      grouped.set(groupKey, {
        pitchType,
        pitchHand,
        batSide,
        season: Number(row.year) || season,
        count,
        usage: 0,
        avgSpeed: Number(row.api_p_release_speed) || 0,
        avgPlateX: Number(row.api_plate_x) || 0,
        avgPlateZ: Number(row.api_plate_z) || 0,
        avgSpin: Number(row.api_p_release_spin_rate) || 0,
        _n: count,
      })
      continue
    }

    const total = existing._n + count
    existing.avgSpeed = weighted(existing.avgSpeed, existing._n, Number(row.api_p_release_speed) || 0, count)
    existing.avgPlateX = weighted(existing.avgPlateX, existing._n, Number(row.api_plate_x) || 0, count)
    existing.avgPlateZ = weighted(existing.avgPlateZ, existing._n, Number(row.api_plate_z) || 0, count)
    existing.avgSpin = weighted(existing.avgSpin, existing._n, Number(row.api_p_release_spin_rate) || 0, count)
    existing.count = total
    existing._n = total
  }

  // Usage is relative to each bat-side bucket (how pitch3d splits views).
  const bySideTotals = { L: 0, R: 0 }
  for (const pitch of grouped.values()) {
    bySideTotals[pitch.batSide] += pitch.count
  }

  const pitches = [...grouped.values()]
    .map(({ _n: _unused, ...pitch }) => ({
      ...pitch,
      usage: bySideTotals[pitch.batSide]
        ? pitch.count / bySideTotals[pitch.batSide]
        : 0,
    }))
    .sort((a, b) => b.usage - a.usage)

  const value: PitcherArsenal = {
    pitcherId,
    name,
    pitchHand,
    season,
    pitches,
    sourceUrl: `https://baseballsavant.mlb.com/visuals/pitch3d?player_id=${pitcherId}`,
  }

  cache.set(key, {
    expires: Date.now() + 1000 * 60 * 30,
    value,
  })

  return value
}

function weighted(prev: number, prevN: number, next: number, nextN: number): number {
  return (prev * prevN + next * nextN) / (prevN + nextN)
}

function normalizePitchType(value: string | undefined): PitchTypeCode {
  const code = (value ?? '').toUpperCase()
  switch (code) {
    case 'FF':
    case 'SI':
    case 'FC':
    case 'SL':
    case 'ST':
    case 'SV':
    case 'CU':
    case 'CH':
    case 'FS':
    case 'KN':
      return code
    default:
      return 'OTHER'
  }
}
