import { fetchJson } from '../utils/http.ts'
import { mapPool } from '../utils/pool.ts'

export interface PitcherDurability {
  pitcherId: number
  name: string
  startsSampled: number
  avgInnings: number
  avgPitches: number
  earlyExitRate: number
  lastStartInnings: number | null
  lastStartPitches: number | null
  /** 0.55–1.0 multiplier on projected PAs vs this starter. */
  durabilityFactor: number
  notes: string[]
}

const cache = new Map<string, { expires: number; value: Map<number, PitcherDurability> }>()
const CHUNK = 25

/**
 * Recent starting-pitcher durability from MLB game logs,
 * filtered to outings on/before asOfDate (inclusive).
 */
export async function fetchPitcherDurabilityMap(
  season: number,
  pitcherIds: number[],
  asOfDate: string,
): Promise<Map<number, PitcherDurability>> {
  const ids = [...new Set(pitcherIds)].filter((id) => id > 0)
  const key = `${season}:${asOfDate}:${ids.slice().sort((a, b) => a - b).join(',')}`
  const cached = cache.get(key)
  if (cached && cached.expires > Date.now()) return cached.value

  const map = new Map<number, PitcherDurability>()
  if (ids.length === 0) return map

  const chunks: number[][] = []
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK))

  await mapPool(chunks, 3, async (chunk) => {
    const url =
      `https://statsapi.mlb.com/api/v1/people` +
      `?personIds=${chunk.join(',')}` +
      `&hydrate=stats(group=[pitching],type=[gameLog],season=${season})`

    const payload = await fetchJson<{
      people?: Array<{
        id?: number
        fullName?: string
        stats?: Array<{
          splits?: Array<{
            date?: string
            stat?: {
              gamesStarted?: number
              inningsPitched?: string | number
              numberOfPitches?: number
              pitchesThrown?: number
              homeRuns?: number
            }
          }>
        }>
      }>
    }>(url)

    for (const person of payload.people ?? []) {
      if (!person.id) continue
      const starts = (person.stats?.[0]?.splits ?? [])
        .filter((split) => (split.date ?? '') <= asOfDate)
        .filter((split) => Number(split.stat?.gamesStarted) === 1)
        .map((split) => ({
          date: split.date ?? '',
          innings: parseInnings(split.stat?.inningsPitched),
          pitches:
            Number(split.stat?.numberOfPitches) ||
            Number(split.stat?.pitchesThrown) ||
            0,
        }))
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 6)

      map.set(person.id, buildDurability(person.id, person.fullName ?? '', starts))
    }
  })

  cache.set(key, { expires: Date.now() + 1000 * 60 * 30, value: map })
  return map
}

function buildDurability(
  pitcherId: number,
  name: string,
  starts: Array<{ date: string; innings: number; pitches: number }>,
): PitcherDurability {
  const notes: string[] = []
  if (starts.length === 0) {
    return {
      pitcherId,
      name,
      startsSampled: 0,
      avgInnings: 5,
      avgPitches: 85,
      earlyExitRate: 0,
      lastStartInnings: null,
      lastStartPitches: null,
      durabilityFactor: 0.85,
      notes: ['No recent starts logged; used cautious durability prior'],
    }
  }

  const avgInnings = average(starts.map((start) => start.innings))
  const avgPitches = average(starts.map((start) => start.pitches).filter((n) => n > 0))
  const earlyExitRate =
    starts.filter((start) => start.innings > 0 && start.innings < 4).length / starts.length
  const last = starts[0]

  let durabilityFactor = 1
  if (avgInnings >= 5.5) durabilityFactor = 1
  else if (avgInnings >= 4.75) durabilityFactor = 0.92
  else if (avgInnings >= 4) durabilityFactor = 0.8
  else if (avgInnings >= 3.25) durabilityFactor = 0.68
  else durabilityFactor = 0.56

  if (earlyExitRate >= 0.5) {
    durabilityFactor *= 0.82
    notes.push(
      `High early-exit rate (${Math.round(earlyExitRate * 100)}% of last ${starts.length} starts under 4 IP)`,
    )
  } else if (avgInnings < 4.5) {
    notes.push(
      `Short recent outings (avg ${avgInnings.toFixed(1)} IP over last ${starts.length} starts)`,
    )
  }

  if (last.pitches >= 100) {
    durabilityFactor *= 0.97
    notes.push(`Heavy last start (${last.pitches} pitches on ${last.date})`)
  }

  durabilityFactor = clamp(durabilityFactor, 0.5, 1)

  return {
    pitcherId,
    name,
    startsSampled: starts.length,
    avgInnings: round1(avgInnings),
    avgPitches: Math.round(avgPitches || 0),
    earlyExitRate: round2(earlyExitRate),
    lastStartInnings: round1(last.innings),
    lastStartPitches: last.pitches || null,
    durabilityFactor: round2(durabilityFactor),
    notes,
  }
}

function parseInnings(value: string | number | undefined): number {
  if (value == null || value === '') return 0
  const raw = String(value)
  const [whole, frac] = raw.split('.')
  const outs = frac ? Number(frac) : 0
  return Number(whole) + outs / 3
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
