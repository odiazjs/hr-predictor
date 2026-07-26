import { fetchJson } from '../utils/http.ts'
import { mapPool } from '../utils/pool.ts'

export interface HandSplit {
  plateAppearances: number
  atBats: number
  homeRuns: number
  avg: number
  obp: number
  slg: number
  ops: number
}

export interface BatterPlatoonSplits {
  batterId: number
  name: string
  batSide: 'L' | 'R' | 'S'
  vsLhp: HandSplit | null
  vsRhp: HandSplit | null
}

const cache = new Map<string, { expires: number; value: Map<number, BatterPlatoonSplits> }>()
const CHUNK = 40

/**
 * Season hitting splits vs LHP / RHP from MLB Stats API
 * (same feed behind batter splits: sitCodes vl / vr).
 */
export async function fetchBatterPlatoonSplitsMap(
  season: number,
  batterIds: number[],
): Promise<Map<number, BatterPlatoonSplits>> {
  const ids = [...new Set(batterIds)].filter((id) => id > 0)
  const key = `${season}:${ids.slice().sort((a, b) => a - b).join(',')}`
  const cached = cache.get(key)
  if (cached && cached.expires > Date.now()) return cached.value

  const map = new Map<number, BatterPlatoonSplits>()
  if (ids.length === 0) return map

  const chunks: number[][] = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    chunks.push(ids.slice(i, i + CHUNK))
  }

  await mapPool(chunks, 3, async (chunk) => {
    const url =
      `https://statsapi.mlb.com/api/v1/people` +
      `?personIds=${chunk.join(',')}` +
      `&hydrate=stats(group=[hitting],type=[statSplits],sitCodes=[vr,vl],season=${season})`

    const payload = await fetchJson<{
      people?: Array<{
        id?: number
        fullName?: string
        batSide?: { code?: string }
        stats?: Array<{
          splits?: Array<{
            split?: { code?: string }
            stat?: {
              plateAppearances?: number
              atBats?: number
              homeRuns?: number
              avg?: string | number
              obp?: string | number
              slg?: string | number
              ops?: string | number
            }
          }>
        }>
      }>
    }>(url)

    for (const person of payload.people ?? []) {
      if (!person.id) continue
      let vsLhp: HandSplit | null = null
      let vsRhp: HandSplit | null = null

      for (const split of person.stats?.[0]?.splits ?? []) {
        const code = (split.split?.code ?? '').toLowerCase()
        const parsed = parseSplit(split.stat)
        if (!parsed) continue
        if (code === 'vl') vsLhp = parsed
        if (code === 'vr') vsRhp = parsed
      }

      map.set(person.id, {
        batterId: person.id,
        name: person.fullName ?? '',
        batSide: normalizeBatSide(person.batSide?.code),
        vsLhp,
        vsRhp,
      })
    }
  })

  cache.set(key, { expires: Date.now() + 1000 * 60 * 30, value: map })
  return map
}

function parseSplit(stat: {
  plateAppearances?: number
  atBats?: number
  homeRuns?: number
  avg?: string | number
  obp?: string | number
  slg?: string | number
  ops?: string | number
} | undefined): HandSplit | null {
  if (!stat) return null
  return {
    plateAppearances: Number(stat.plateAppearances) || 0,
    atBats: Number(stat.atBats) || 0,
    homeRuns: Number(stat.homeRuns) || 0,
    avg: Number(stat.avg) || 0,
    obp: Number(stat.obp) || 0,
    slg: Number(stat.slg) || 0,
    ops: Number(stat.ops) || 0,
  }
}

function normalizeBatSide(code: string | undefined): 'L' | 'R' | 'S' {
  const side = (code ?? 'R').toUpperCase()
  if (side === 'L' || side === 'R' || side === 'S') return side
  return 'R'
}
