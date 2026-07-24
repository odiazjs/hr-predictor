import type { ExitVeloProfile } from './exitVelo.ts'
import type { ExpectedStatsProfile } from './expectedStats.ts'
import {
  type PitchArsenalStatsMap,
  type PitchTypeDamage,
} from './pitchArsenalStats.ts'
import {
  fetchPlayerPitches,
  type StatcastPitch,
  type StatcastPlayerType,
} from './statcastPitches.ts'
import { mapPool } from '../utils/pool.ts'

const NON_AB_EVENTS = new Set([
  'walk',
  'intent_walk',
  'hit_by_pitch',
  'sac_bunt',
  'catcher_interf',
  'escaped_catcher_interf',
])

const WOBA_WALK = 0.69
const WOBA_HBP = 0.72

/** Avoid look-ahead-clean but tiny samples dominating the board. */
const MIN_BIP_FOR_EXIT_VELO = 20
const MIN_PA_FOR_EXPECTED = 30
const MIN_PITCHES_FOR_PITCH_TYPE = 25
const MIN_PA_FOR_PITCH_TYPE = 15

export interface AsOfPlayerStats {
  exitVelo: Map<number, ExitVeloProfile>
  expected: Map<number, ExpectedStatsProfile>
  batterPitchStats: PitchArsenalStatsMap
  pitcherPitchStats: PitchArsenalStatsMap
  loadedBatters: number
  loadedPitchers: number
  failedPlayerIds: number[]
}

/**
 * Build barrels / xStats / pitch-type damage for slate players using
 * pitch-level Statcast through endDate (inclusive).
 */
export async function fetchAsOfPlayerStats(options: {
  season: number
  endDate: string
  batterIds: number[]
  pitcherIds: number[]
  concurrency?: number
}): Promise<AsOfPlayerStats> {
  const concurrency = options.concurrency ?? 6
  const failedPlayerIds: number[] = []

  const batterIds = unique(options.batterIds)
  const pitcherIds = unique(options.pitcherIds)

  const [batterBundles, pitcherBundles] = await Promise.all([
    mapPool(batterIds, concurrency, async (batterId) => {
      try {
        const pitches = await fetchPlayerPitches(
          batterId,
          'batter',
          options.season,
          options.endDate,
        )
        return { playerId: batterId, pitches }
      } catch {
        failedPlayerIds.push(batterId)
        return { playerId: batterId, pitches: [] as StatcastPitch[] }
      }
    }),
    mapPool(pitcherIds, concurrency, async (pitcherId) => {
      try {
        const pitches = await fetchPlayerPitches(
          pitcherId,
          'pitcher',
          options.season,
          options.endDate,
        )
        return { playerId: pitcherId, pitches }
      } catch {
        failedPlayerIds.push(pitcherId)
        return { playerId: pitcherId, pitches: [] as StatcastPitch[] }
      }
    }),
  ])

  const exitVelo = new Map<number, ExitVeloProfile>()
  const expected = new Map<number, ExpectedStatsProfile>()
  const batterPitchStats: PitchArsenalStatsMap = new Map()
  const pitcherPitchStats: PitchArsenalStatsMap = new Map()

  for (const bundle of batterBundles) {
    if (bundle.pitches.length === 0) continue
    const power = aggregatePower(bundle.playerId, bundle.pitches)
    if (power.exitVelo) exitVelo.set(bundle.playerId, power.exitVelo)
    if (power.expected) expected.set(bundle.playerId, power.expected)
    const pitchMap = aggregatePitchTypeDamage(bundle.pitches, 'batter')
    if (pitchMap.size > 0) batterPitchStats.set(bundle.playerId, pitchMap)
  }

  for (const bundle of pitcherBundles) {
    if (bundle.pitches.length === 0) continue
    const pitchMap = aggregatePitchTypeDamage(bundle.pitches, 'pitcher')
    if (pitchMap.size > 0) pitcherPitchStats.set(bundle.playerId, pitchMap)
  }

  return {
    exitVelo,
    expected,
    batterPitchStats,
    pitcherPitchStats,
    loadedBatters: batterBundles.filter((bundle) => bundle.pitches.length > 0).length,
    loadedPitchers: pitcherBundles.filter((bundle) => bundle.pitches.length > 0).length,
    failedPlayerIds: unique(failedPlayerIds),
  }
}

function aggregatePower(
  playerId: number,
  pitches: StatcastPitch[],
): { exitVelo: ExitVeloProfile | null; expected: ExpectedStatsProfile | null } {
  const bip = pitches.filter((p) => p.type === 'X' && p.launchSpeed != null)
  const paEnds = pitches.filter((p) => p.events)

  if (bip.length === 0 && paEnds.length === 0) {
    return { exitVelo: null, expected: null }
  }

  const barrels = bip.filter((p) => p.launchSpeedAngle === 6).length
  const hardHits = bip.filter((p) => (p.launchSpeed ?? 0) >= 95).length
  const speeds = bip.map((p) => p.launchSpeed!).sort((a, b) => a - b)
  const topHalf = speeds.slice(Math.floor(speeds.length / 2))
  const pa = paEnds.length

  const exitVelo: ExitVeloProfile | null =
    bip.length >= MIN_BIP_FOR_EXIT_VELO
      ? {
          playerId,
          name: pitches[0]?.playerName ?? '',
          bip: bip.length,
          avgHitAngle: average(bip.map((p) => p.launchAngle).filter(isNum)),
          sweetSpotPercent: 0,
          maxHitSpeed: speeds.length ? speeds[speeds.length - 1] : 0,
          avgHitSpeed: average(speeds),
          ev50: topHalf.length ? average(topHalf) : 0,
          avgHrDistance: 0,
          hardHitPercent: (hardHits / bip.length) * 100,
          barrels,
          barrelPercent: (barrels / bip.length) * 100,
          barrelsPerPa: pa > 0 ? (barrels / pa) * 100 : 0,
        }
      : null

  let xslgNum = 0
  let ab = 0
  let xwobaNum = 0
  let wobaDenom = 0
  let xbaNum = 0
  let baDenom = 0
  let actualBaHits = 0
  let actualSlgBases = 0
  let actualWobaNum = 0

  for (const pitch of paEnds) {
    const event = pitch.events

    if (event === 'walk' || event === 'intent_walk') {
      xwobaNum += WOBA_WALK
      actualWobaNum += pitch.wobaValue ?? WOBA_WALK
      wobaDenom += 1
      continue
    }
    if (event === 'hit_by_pitch') {
      xwobaNum += WOBA_HBP
      actualWobaNum += pitch.wobaValue ?? WOBA_HBP
      wobaDenom += 1
      continue
    }
    if (event === 'sac_fly') {
      xwobaNum += pitch.estimatedWoba ?? pitch.wobaValue ?? 0
      actualWobaNum += pitch.wobaValue ?? 0
      wobaDenom += 1
      continue
    }
    if (NON_AB_EVENTS.has(event)) continue

    ab += 1
    wobaDenom += 1
    baDenom += 1

    if (pitch.type === 'X' && pitch.estimatedSlg != null) {
      xslgNum += pitch.estimatedSlg
      xwobaNum += pitch.estimatedWoba ?? 0
      xbaNum += pitch.estimatedBa ?? 0
    } else {
      xslgNum += 0
      xwobaNum += pitch.wobaValue ?? 0
      xbaNum += 0
    }

    const bases = totalBases(event)
    actualSlgBases += bases
    actualBaHits += bases > 0 ? 1 : 0
    actualWobaNum += pitch.wobaValue ?? 0
  }

  const expected: ExpectedStatsProfile | null =
    pa >= MIN_PA_FOR_EXPECTED
      ? {
          playerId,
          name: pitches[0]?.playerName ?? '',
          pa,
          bip: bip.length,
          ba: baDenom > 0 ? actualBaHits / baDenom : 0,
          xba: baDenom > 0 ? xbaNum / baDenom : 0,
          slg: ab > 0 ? actualSlgBases / ab : 0,
          xslg: ab > 0 ? xslgNum / ab : 0,
          woba: wobaDenom > 0 ? actualWobaNum / wobaDenom : 0,
          xwoba: wobaDenom > 0 ? xwobaNum / wobaDenom : 0,
        }
      : null

  return { exitVelo, expected }
}

function aggregatePitchTypeDamage(
  pitches: StatcastPitch[],
  _playerType: StatcastPlayerType,
): Map<string, PitchTypeDamage> {
  const byType = new Map<string, StatcastPitch[]>()
  for (const pitch of pitches) {
    if (!pitch.pitchType) continue
    const list = byType.get(pitch.pitchType) ?? []
    list.push(pitch)
    byType.set(pitch.pitchType, list)
  }

  const totalPitches = pitches.filter((p) => p.pitchType).length || 1
  const map = new Map<string, PitchTypeDamage>()

  for (const [pitchType, typePitches] of byType) {
    const paEnds = typePitches.filter((p) => p.events)
    if (
      typePitches.length < MIN_PITCHES_FOR_PITCH_TYPE &&
      paEnds.length < MIN_PA_FOR_PITCH_TYPE
    ) {
      continue
    }

    let xslgNum = 0
    let xwobaNum = 0
    let xbaNum = 0
    let ab = 0
    let wobaDenom = 0
    let baDenom = 0
    let actualBaHits = 0
    let actualSlgBases = 0
    let actualWobaNum = 0
    let hardHits = 0
    let bip = 0

    for (const pitch of paEnds) {
      const event = pitch.events
      if (event === 'walk' || event === 'intent_walk') {
        xwobaNum += WOBA_WALK
        actualWobaNum += pitch.wobaValue ?? WOBA_WALK
        wobaDenom += 1
        continue
      }
      if (event === 'hit_by_pitch') {
        xwobaNum += WOBA_HBP
        actualWobaNum += pitch.wobaValue ?? WOBA_HBP
        wobaDenom += 1
        continue
      }
      if (event === 'sac_fly') {
        xwobaNum += pitch.estimatedWoba ?? pitch.wobaValue ?? 0
        actualWobaNum += pitch.wobaValue ?? 0
        wobaDenom += 1
        continue
      }
      if (NON_AB_EVENTS.has(event)) continue

      ab += 1
      wobaDenom += 1
      baDenom += 1

      if (pitch.type === 'X' && pitch.launchSpeed != null) {
        bip += 1
        if (pitch.launchSpeed >= 95) hardHits += 1
      }

      if (pitch.type === 'X' && pitch.estimatedSlg != null) {
        xslgNum += pitch.estimatedSlg
        xwobaNum += pitch.estimatedWoba ?? 0
        xbaNum += pitch.estimatedBa ?? 0
      } else {
        xslgNum += 0
        xwobaNum += pitch.wobaValue ?? 0
        xbaNum += 0
      }

      const bases = totalBases(event)
      actualSlgBases += bases
      actualBaHits += bases > 0 ? 1 : 0
      actualWobaNum += pitch.wobaValue ?? 0
    }

    map.set(pitchType, {
      pitchType,
      pitchName: pitchType,
      pitches: typePitches.length,
      usage: round4(typePitches.length / totalPitches),
      pa: paEnds.length,
      ba: round3(baDenom > 0 ? actualBaHits / baDenom : 0),
      slg: round3(ab > 0 ? actualSlgBases / ab : 0),
      woba: round3(wobaDenom > 0 ? actualWobaNum / wobaDenom : 0),
      xba: round3(baDenom > 0 ? xbaNum / baDenom : 0),
      xslg: round3(ab > 0 ? xslgNum / ab : 0),
      xwoba: round3(wobaDenom > 0 ? xwobaNum / wobaDenom : 0),
      hardHitPercent: round1(bip > 0 ? (hardHits / bip) * 100 : 0),
      runValuePer100: 0,
      whiffPercent: 0,
    })
  }

  return map
}

function totalBases(event: string): number {
  switch (event) {
    case 'single':
      return 1
    case 'double':
      return 2
    case 'triple':
      return 3
    case 'home_run':
      return 4
    default:
      return 0
  }
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function isNum(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value)
}

function unique(values: number[]): number[] {
  return [...new Set(values)]
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}
