import type {
  BatterPlatoonSplits,
  HandSplit,
} from '../mlb/batterPlatoonSplits.ts'
import type { BatterRecentForm } from '../mlb/batterRecentForm.ts'
import type { PitcherDurability } from '../mlb/pitcherDurability.ts'
import type { PitcherHrAllowed } from '../mlb/pitcherHrAllowed.ts'
import type { PitcherArsenal, ArsenalPitch } from '../savant/pitchArsenal.ts'
import type { ExitVeloProfile } from '../savant/exitVelo.ts'
import type { ExpectedStatsProfile } from '../savant/expectedStats.ts'
import type { PitchTypeDamage } from '../savant/pitchArsenalStats.ts'
import type { SwingPathProfile } from '../savant/swingPath.ts'

const LEAGUE_HR_PER_9 = 1.2
const LEAGUE_HR_PER_PA = 0.034
/** Typical PA vs starter by batting order (1–9), before durability. */
const PA_VS_STARTER_BY_ORDER = [0, 3.05, 2.85, 2.75, 2.65, 2.45, 2.25, 2.05, 1.85, 1.7]

export interface ScoreBreakdown {
  powerSkill: number
  swingPath: number
  arsenalMatch: number
  pitcherHrAllowed: number
  platoonSplit: number
  recentForm: number
  parkBoost: number
  matchupScore: number
  durabilityFactor: number
  projectedPa: number
  expectedHrChance: number
  confidence: number
  notes: string[]
}

export interface ScoreInput {
  swing: SwingPathProfile | null
  exitVelo: ExitVeloProfile | null
  expected: ExpectedStatsProfile | null
  arsenal: PitcherArsenal | null
  pitcherPitchStats: Map<string, PitchTypeDamage> | null
  batterPitchStats: Map<string, PitchTypeDamage> | null
  pitcherHrAllowed: PitcherHrAllowed | null
  platoon: BatterPlatoonSplits | null
  recentForm: BatterRecentForm | null
  durability: PitcherDurability | null
  batSide: 'L' | 'R'
  pitcherHand: 'L' | 'R' | null
  battingOrder: number
  parkHrFactor: number
}

export function scoreBatterMatchup(input: ScoreInput): {
  /** Rank key: expected HR chance tonight vs this starter (0–1). */
  score: number
  matchupScore: number
  expectedHrChance: number
  breakdown: ScoreBreakdown
} {
  const notes: string[] = []

  const swingPath = scoreSwingPath(input.swing, notes)
  const powerSkill = scorePowerSkill(input.exitVelo, input.expected, notes)

  const arsenalPitches = relevantPitches(input.arsenal, input.batSide)
  const arsenalMatch = scoreArsenalMatch({
    pitches: arsenalPitches,
    pitcherPitchStats: input.pitcherPitchStats,
    batterPitchStats: input.batterPitchStats,
    idealRate: input.swing?.idealAttackAngleRate ?? 0.45,
    attackAngle: input.swing?.attackAngle ?? 10,
    swingTilt: input.swing?.swingTilt ?? 26,
    notes,
  })

  const pitcherHrAllowed = scorePitcherHrAllowed(input.pitcherHrAllowed, notes)
  const platoonSplit = scorePlatoonSplit({
    platoon: input.platoon,
    batSide: input.batSide,
    pitcherHand: input.pitcherHand,
    notes,
  })
  const recentForm = scoreRecentFormComponent(input.recentForm, notes)
  const parkBoost = scoreParkBoost(input.parkHrFactor, notes)
  const confidence = computeConfidence(input, arsenalPitches)

  // Matchup quality (0–100): not the same as "most likely tonight".
  const matchupScore =
    arsenalMatch * 0.3 +
    platoonSplit * 0.22 +
    pitcherHrAllowed * 0.18 +
    powerSkill * 0.12 +
    recentForm * 0.08 +
    parkBoost * 0.1

  const durabilityFactor = input.durability?.durabilityFactor ?? 0.85
  for (const note of input.durability?.notes ?? []) notes.push(note)

  const order = clamp(Math.round(input.battingOrder || 5), 1, 9)
  const basePa = PA_VS_STARTER_BY_ORDER[order] ?? 2.3
  const projectedPa = round2(basePa * durabilityFactor)

  // Convert matchup quality + opportunity into expected HR probability tonight.
  const hrPerPa =
    LEAGUE_HR_PER_PA *
    (0.55 + (matchupScore / 100) * 0.95) *
    (0.85 + (recentForm / 100) * 0.3) *
    (0.9 + clamp(input.parkHrFactor, -20, 25) / 100)

  const expectedHrChance = round4(1 - Math.pow(1 - clamp(hrPerPa, 0.005, 0.12), projectedPa))

  notes.push(
    `Projected ~${projectedPa.toFixed(1)} PA vs starter (order #${order}, durability ${durabilityFactor.toFixed(2)})`,
  )
  notes.push(`Expected HR chance ${(expectedHrChance * 100).toFixed(1)}% (matchup ${round1(matchupScore)})`)

  return {
    // Board ranks by expected chance; scale to a readable 0–100-ish score.
    score: round1(expectedHrChance * 1000),
    matchupScore: round1(matchupScore),
    expectedHrChance,
    breakdown: {
      powerSkill: round1(powerSkill),
      swingPath: round1(swingPath),
      arsenalMatch: round1(arsenalMatch),
      pitcherHrAllowed: round1(pitcherHrAllowed),
      platoonSplit: round1(platoonSplit),
      recentForm: round1(recentForm),
      parkBoost: round1(parkBoost),
      matchupScore: round1(matchupScore),
      durabilityFactor: round2(durabilityFactor),
      projectedPa,
      expectedHrChance,
      confidence: round1(confidence),
      notes,
    },
  }
}

/**
 * Soft-cap expected HRs across a lineup vs the same starter so one
 * fragile pitcher matchup cannot dominate the whole board.
 */
export function applyAntiStacking(
  rows: Array<{ expectedHrChance: number; pitcherId: number | null }>,
): number[] {
  const byPitcher = new Map<number, number[]>()
  rows.forEach((row, index) => {
    if (!row.pitcherId) return
    const list = byPitcher.get(row.pitcherId) ?? []
    list.push(index)
    byPitcher.set(row.pitcherId, list)
  })

  const scaled = rows.map((row) => row.expectedHrChance)
  for (const indices of byPitcher.values()) {
    if (indices.length < 3) continue
    const total = indices.reduce((sum, index) => sum + scaled[index], 0)
    // Typical starter allows ~0.5–0.9 HR; soft-cap shared expectation.
    const softCap = 0.75
    if (total <= softCap) continue
    // Partial dampening so we don't crush everyone equally to noise.
    const factor = softCap / total
    const blend = 0.45 + factor * 0.55
    for (const index of indices) {
      scaled[index] = scaled[index] * blend
    }
  }
  return scaled
}

function scoreRecentFormComponent(
  form: BatterRecentForm | null,
  notes: string[],
): number {
  if (!form || form.plateAppearances < 15) {
    notes.push('Recent form sample thin; used neutral prior')
    return 50
  }
  if (form.formScore >= 70) {
    notes.push(
      `Hot recent form (${form.homeRuns} HR, SLG ${form.slg.toFixed(3)} in last ~21 days)`,
    )
  } else if (form.formScore <= 35) {
    notes.push(
      `Cold recent form (SLG ${form.slg.toFixed(3)} in last ~21 days)`,
    )
  }
  return form.formScore
}

function scoreParkBoost(parkHrFactor: number, notes: string[]): number {
  const boost = clamp((parkHrFactor + 20) / 50, 0, 1) * 100
  if (parkHrFactor >= 12) {
    notes.push(`HR-friendly park (+${parkHrFactor}%)`)
  } else if (parkHrFactor <= -6) {
    notes.push(`HR-suppressing park (${parkHrFactor}%)`)
  }
  return boost
}

/**
 * How well the batter hits the opposing pitcher hand (MLB vs LHP / vs RHP splits).
 * Opposite-hand matchups (L vs RHP, R vs LHP) get an extra boost when the split is strong.
 */
function scorePlatoonSplit(args: {
  platoon: BatterPlatoonSplits | null
  batSide: 'L' | 'R'
  pitcherHand: 'L' | 'R' | null
  notes: string[]
}): number {
  const { platoon, batSide, pitcherHand, notes } = args

  if (!pitcherHand) {
    notes.push('Pitcher hand unknown; used neutral platoon prior')
    return 50
  }

  const split: HandSplit | null =
    pitcherHand === 'L' ? (platoon?.vsLhp ?? null) : (platoon?.vsRhp ?? null)

  if (!split || split.plateAppearances < 20) {
    notes.push(
      `Thin vs ${pitcherHand}HP split sample; used ${
        batSide !== pitcherHand ? 'favorable-platoon' : 'same-side'
      } prior`,
    )
    return batSide !== pitcherHand ? 58 : 45
  }

  const hrPerPa = split.plateAppearances > 0 ? split.homeRuns / split.plateAppearances : 0
  const slgScore = clamp01((split.slg - 0.32) / 0.35) * 55
  const opsScore = clamp01((split.ops - 0.65) / 0.4) * 25
  const hrScore = clamp01((hrPerPa - 0.02) / 0.06) * 20
  let score = clamp(slgScore + opsScore + hrScore, 0, 100)

  const isOpposite = batSide !== pitcherHand
  if (isOpposite) {
    score = clamp(score + 8, 0, 100)
    if (split.slg >= 0.5 || hrPerPa >= 0.05) {
      notes.push(
        `Strong ${batSide}HB vs ${pitcherHand}HP split (SLG ${split.slg.toFixed(3)}, ${split.homeRuns} HR / ${split.plateAppearances} PA)`,
      )
    } else {
      notes.push(
        `Opposite-hand matchup: ${batSide}HB vs ${pitcherHand}HP (SLG ${split.slg.toFixed(3)})`,
      )
    }
  } else if (split.slg >= 0.52) {
    notes.push(
      `Same-side but productive vs ${pitcherHand}HP (SLG ${split.slg.toFixed(3)})`,
    )
  } else if (split.slg <= 0.38) {
    notes.push(
      `Soft same-side split vs ${pitcherHand}HP (SLG ${split.slg.toFixed(3)})`,
    )
  }

  if (split.plateAppearances < 60) {
    const weight = split.plateAppearances / 60
    const prior = isOpposite ? 58 : 45
    score = score * weight + prior * (1 - weight)
  }

  return score
}

/**
 * Pitcher HR/9 with hard shrinkage to league average until ~50 IP.
 */
function scorePitcherHrAllowed(
  profile: PitcherHrAllowed | null,
  notes: string[],
): number {
  if (!profile || profile.inningsPitched < 8) {
    notes.push('Pitcher HR-allowed sample thin/unavailable; used league-average prior')
    return 50
  }

  const rawHr9 = profile.homeRunsPer9
  // Don't fully trust HR/9 until ~50 IP (Scherzer 22 IP problem).
  const sampleWeight = profile.inningsPitched / (profile.inningsPitched + 50)
  const shrunkHr9 = sampleWeight * rawHr9 + (1 - sampleWeight) * LEAGUE_HR_PER_9

  const rateScore = clamp01((shrunkHr9 - 0.7) / 1.9) * 100
  const volumeAssist =
    profile.inningsPitched >= 40
      ? clamp01((profile.homeRuns - 8) / 20) * 8
      : 0
  const score = clamp(rateScore * 0.92 + volumeAssist, 0, 100)

  if (profile.inningsPitched < 40) {
    notes.push(
      `Pitcher HR/9 shrunk to league (raw ${rawHr9.toFixed(2)} → ${shrunkHr9.toFixed(2)} on ${profile.inningsPitched} IP)`,
    )
  } else if (shrunkHr9 >= 1.7) {
    notes.push(
      `HR-prone starter (${shrunkHr9.toFixed(2)} HR/9 shrunk, ${profile.homeRuns} HR in ${profile.inningsPitched} IP)`,
    )
  } else if (shrunkHr9 >= 1.4) {
    notes.push(
      `Above-average HR allowed (${shrunkHr9.toFixed(2)} HR/9)`,
    )
  }

  return score
}

function scoreSwingPath(swing: SwingPathProfile | null, notes: string[]): number {
  const idealRate = swing?.idealAttackAngleRate ?? 0.45
  const batSpeed = swing?.avgBatSpeed ?? 72
  const attackAngle = swing?.attackAngle ?? 10
  const swingTilt = swing?.swingTilt ?? 26

  const idealComponent = clamp01(idealRate) * 40
  const speedComponent = clamp01((batSpeed - 68) / 14) * 25
  const angleComponent = (1 - Math.min(Math.abs(attackAngle - 12) / 15, 1)) * 20
  const tiltComponent = clamp01(1 - Math.abs(swingTilt - 28) / 18) * 15

  if (!swing) {
    notes.push('Missing Savant swing-path profile; used league-average priors')
  } else if (idealRate >= 0.55) {
    notes.push('Strong ideal attack-angle rate (5–20°)')
  }

  return idealComponent + speedComponent + angleComponent + tiltComponent
}

function scorePowerSkill(
  exitVelo: ExitVeloProfile | null,
  expected: ExpectedStatsProfile | null,
  notes: string[],
): number {
  const barrelPercent = exitVelo?.barrelPercent ?? 6
  const ev50 = exitVelo?.ev50 ?? 92
  const hardHit = exitVelo?.hardHitPercent ?? 35
  const sweetSpot = exitVelo?.sweetSpotPercent ?? 32
  const xslg = expected?.xslg ?? 0.4
  const xwoba = expected?.xwoba ?? 0.32

  const barrelComponent = clamp01(barrelPercent / 18) * 30
  const evComponent = clamp01((ev50 - 88) / 16) * 20
  const hardHitComponent = clamp01((hardHit - 25) / 40) * 15
  const xslgComponent = clamp01((xslg - 0.35) / 0.3) * 25
  const xwobaComponent = clamp01((xwoba - 0.28) / 0.18) * 5
  const sweetSpotComponent = clamp01(sweetSpot / 45) * 5

  if (!exitVelo && !expected) {
    notes.push('Missing barrels/xStats; used league-average power priors')
  } else if ((exitVelo?.barrelPercent ?? 0) >= 12) {
    notes.push(`Elite barrel rate (${round1(exitVelo!.barrelPercent)}%)`)
  } else if ((expected?.xslg ?? 0) >= 0.5) {
    notes.push(`Strong expected power (xSLG ${expected!.xslg.toFixed(3)})`)
  }

  return (
    barrelComponent +
    evComponent +
    hardHitComponent +
    xslgComponent +
    xwobaComponent +
    sweetSpotComponent
  )
}

function scoreArsenalMatch(args: {
  pitches: ArsenalPitch[]
  pitcherPitchStats: Map<string, PitchTypeDamage> | null
  batterPitchStats: Map<string, PitchTypeDamage> | null
  idealRate: number
  attackAngle: number
  swingTilt: number
  notes: string[]
}): number {
  const {
    pitches,
    pitcherPitchStats,
    batterPitchStats,
    idealRate,
    attackAngle,
    swingTilt,
    notes,
  } = args

  const usageWeights = buildUsageWeights(pitches, pitcherPitchStats)
  if (usageWeights.length === 0) {
    notes.push('Pitcher arsenal unavailable; neutral matchup assumed')
    return 50
  }

  let weighted = 0
  let usageSum = 0
  let usedObserved = 0

  for (const entry of usageWeights) {
    const geometric = geometricPitchScore({
      pitchType: entry.pitchType,
      avgPlateZ: entry.avgPlateZ,
      idealRate,
      attackAngle,
      swingTilt,
    })

    const pitcherDamage = pitcherPitchStats?.get(entry.pitchType) ?? null
    const batterDamage = batterPitchStats?.get(entry.pitchType) ?? null

    let observed: number | null = null
    if (pitcherDamage || batterDamage) {
      usedObserved += 1
      const pitcherVuln = pitcherDamage
        ? clamp01(((pitcherDamage.xslg || pitcherDamage.slg) - 0.3) / 0.35) * 55 +
          clamp01((pitcherDamage.hardHitPercent - 30) / 40) * 25 +
          clamp01((pitcherDamage.runValuePer100 + 2) / 6) * 20
        : 50

      const batterStrength = batterDamage
        ? clamp01(((batterDamage.xslg || batterDamage.slg) - 0.3) / 0.4) * 55 +
          clamp01((batterDamage.hardHitPercent - 25) / 45) * 30 +
          clamp01((batterDamage.runValuePer100 + 1) / 6) * 15
        : 50

      observed = pitcherDamage && batterDamage
        ? batterStrength * 0.55 + pitcherVuln * 0.45
        : pitcherDamage
          ? pitcherVuln
          : batterStrength
    }

    // Prefer observed pitch-type damage; keep geometry as a light prior.
    const pitchScore = observed == null ? geometric : observed * 0.8 + geometric * 0.2
    weighted += pitchScore * entry.usage
    usageSum += entry.usage
  }

  if (usedObserved > 0) {
    notes.push(`Pitch-type damage model used on ${usedObserved} arsenal pitches`)
  }

  const top = usageWeights[0]
  if (top) {
    const batterTop = batterPitchStats?.get(top.pitchType)
    const pitcherTop = pitcherPitchStats?.get(top.pitchType)
    if (batterTop && (batterTop.xslg >= 0.55 || batterTop.slg >= 0.55)) {
      notes.push(
        `Punishes ${top.pitchType} (batter xSLG ${(batterTop.xslg || batterTop.slg).toFixed(3)})`,
      )
    } else if (pitcherTop && (pitcherTop.xslg >= 0.5 || pitcherTop.hardHitPercent >= 45)) {
      notes.push(
        `${top.pitchType} has been hittable (pitcher xSLG ${(pitcherTop.xslg || pitcherTop.slg).toFixed(3)})`,
      )
    }
  }

  return usageSum > 0 ? weighted / usageSum : 50
}

function buildUsageWeights(
  pitches: ArsenalPitch[],
  pitcherPitchStats: Map<string, PitchTypeDamage> | null,
): Array<{ pitchType: string; usage: number; avgPlateZ: number }> {
  if (pitches.length > 0) {
    return pitches.map((pitch) => ({
      pitchType: pitch.pitchType,
      usage: pitch.usage,
      avgPlateZ: pitch.avgPlateZ,
    }))
  }

  if (!pitcherPitchStats || pitcherPitchStats.size === 0) return []

  return [...pitcherPitchStats.values()]
    .filter((pitch) => pitch.usage > 0)
    .map((pitch) => ({
      pitchType: pitch.pitchType,
      usage: pitch.usage,
      avgPlateZ: pitchGroup(pitch.pitchType) === 'fastball' ? 2.7 : 2.1,
    }))
}

function geometricPitchScore(args: {
  pitchType: string
  avgPlateZ: number
  idealRate: number
  attackAngle: number
  swingTilt: number
}): number {
  const group = pitchGroup(args.pitchType)
  const height = args.avgPlateZ
  let pitchScore = 50

  if (group === 'fastball') {
    const elevation = clamp01((height - 2.2) / 1.0)
    pitchScore = 45 + elevation * 35 + args.idealRate * 20
  } else if (group === 'breaking') {
    const depth = clamp01((2.4 - height) / 1.2)
    const resistance =
      clamp01((args.swingTilt - 22) / 14) * 0.6 + clamp01(args.idealRate) * 0.4
    pitchScore = 60 - depth * 35 + resistance * 20
  } else {
    const depth = clamp01((2.5 - height) / 1.2)
    pitchScore = 55 - depth * 25 + args.idealRate * 10
  }

  if (args.attackAngle >= 5 && args.attackAngle <= 20) {
    pitchScore += 4
  }

  return pitchScore
}

function relevantPitches(
  arsenal: PitcherArsenal | null,
  batSide: 'L' | 'R',
): ArsenalPitch[] {
  if (!arsenal) return []
  const sidePitches = arsenal.pitches.filter((pitch) => pitch.batSide === batSide)
  return sidePitches.length > 0 ? sidePitches : arsenal.pitches
}

function pitchGroup(type: string): 'fastball' | 'breaking' | 'offspeed' {
  if (type === 'FF' || type === 'SI' || type === 'FC') return 'fastball'
  if (type === 'SL' || type === 'ST' || type === 'SV' || type === 'CU') return 'breaking'
  return 'offspeed'
}

function computeConfidence(input: ScoreInput, pitches: ArsenalPitch[]): number {
  let score = 20
  if (input.swing) score += Math.min(18, input.swing.competitiveSwings / 30)
  if (input.exitVelo) score += Math.min(12, input.exitVelo.bip / 40)
  if (input.expected) score += Math.min(12, input.expected.pa / 50)

  const pitchCount =
    pitches.reduce((sum, pitch) => sum + pitch.count, 0) ||
    [...(input.pitcherPitchStats?.values() ?? [])].reduce((sum, pitch) => sum + pitch.pitches, 0)
  score += Math.min(12, pitchCount / 80)

  if (input.batterPitchStats && input.batterPitchStats.size > 0) score += 6
  if (input.pitcherPitchStats && input.pitcherPitchStats.size > 0) score += 6
  if (input.pitcherHrAllowed && input.pitcherHrAllowed.inningsPitched >= 40) score += 8
  else if (input.pitcherHrAllowed && input.pitcherHrAllowed.inningsPitched >= 20) score += 4
  if (input.pitcherHand && input.platoon) {
    const split =
      input.pitcherHand === 'L' ? input.platoon.vsLhp : input.platoon.vsRhp
    if (split && split.plateAppearances >= 40) score += 8
    else if (split && split.plateAppearances >= 20) score += 4
  }
  if (input.recentForm && input.recentForm.plateAppearances >= 25) score += 6
  if (input.durability && input.durability.startsSampled >= 3) score += 4

  return clamp(score, 0, 100)
}

function clamp01(value: number): number {
  return clamp(value, 0, 1)
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

function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}

