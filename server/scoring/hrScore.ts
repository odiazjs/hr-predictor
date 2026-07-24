import type { PitcherHrAllowed } from '../mlb/pitcherHrAllowed.ts'
import type { PitcherArsenal, ArsenalPitch } from '../savant/pitchArsenal.ts'
import type { ExitVeloProfile } from '../savant/exitVelo.ts'
import type { ExpectedStatsProfile } from '../savant/expectedStats.ts'
import type { PitchTypeDamage } from '../savant/pitchArsenalStats.ts'
import type { SwingPathProfile } from '../savant/swingPath.ts'

export interface ScoreBreakdown {
  batterQuality: number
  powerSkill: number
  swingPath: number
  arsenalMatch: number
  pitcherHrAllowed: number
  parkBoost: number
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
  parkHrFactor: number
  batSide: 'L' | 'R'
}

export function scoreBatterMatchup(input: ScoreInput): {
  score: number
  breakdown: ScoreBreakdown
} {
  const notes: string[] = []

  const swingPath = scoreSwingPath(input.swing, notes)
  const powerSkill = scorePowerSkill(input.exitVelo, input.expected, notes)
  const batterQuality = swingPath * 0.4 + powerSkill * 0.6

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

  const parkBoost = clamp((input.parkHrFactor + 20) / 50, 0, 1) * 100
  if (input.parkHrFactor >= 15) {
    notes.push(`Elite park HR environment (${formatSigned(input.parkHrFactor)}%)`)
  } else if (input.parkHrFactor >= 5) {
    notes.push(`Favorable park HR environment (${formatSigned(input.parkHrFactor)}%)`)
  }

  const confidence = computeConfidence(input, arsenalPitches)

  // Pitcher HR/9 is a major but not dominant lever:
  // high weight, still below batter quality + pitch-type matchup.
  const score =
    batterQuality * 0.3 +
    arsenalMatch * 0.27 +
    pitcherHrAllowed * 0.18 +
    parkBoost * 0.15 +
    powerSkill * 0.1

  return {
    score: round1(score),
    breakdown: {
      batterQuality: round1(batterQuality),
      powerSkill: round1(powerSkill),
      swingPath: round1(swingPath),
      arsenalMatch: round1(arsenalMatch),
      pitcherHrAllowed: round1(pitcherHrAllowed),
      parkBoost: round1(parkBoost),
      confidence: round1(confidence),
      notes,
    },
  }
}

/**
 * Prefer HR/9 over raw HR totals so innings volume doesn't dominate.
 * League average ~1.1–1.3; 2.0+ is clearly HR-prone.
 */
function scorePitcherHrAllowed(
  profile: PitcherHrAllowed | null,
  notes: string[],
): number {
  if (!profile || profile.inningsPitched < 10) {
    notes.push('Pitcher HR-allowed sample thin/unavailable; used neutral prior')
    return 50
  }

  const hrPer9 = profile.homeRunsPer9
  // Map roughly 0.7 (stingy) → 2.6 (gopher-prone) into 0..100
  const rateScore = clamp01((hrPer9 - 0.7) / 1.9) * 100

  // Small assist from raw HR volume once IP is meaningful.
  const volumeAssist = clamp01((profile.homeRuns - 8) / 20) * 10
  let score = clamp(rateScore * 0.9 + volumeAssist, 0, 100)

  // Shrink extreme readings with thin innings toward neutral.
  if (profile.inningsPitched < 40) {
    const sampleWeight = profile.inningsPitched / 40
    score = score * sampleWeight + 50 * (1 - sampleWeight)
  }

  if (hrPer9 >= 2.0 && profile.inningsPitched >= 40) {
    notes.push(
      `HR-prone starter (${hrPer9.toFixed(2)} HR/9, ${profile.homeRuns} HR in ${profile.inningsPitched} IP)`,
    )
  } else if (hrPer9 >= 1.5 && profile.inningsPitched >= 30) {
    notes.push(
      `Above-average HR allowed (${hrPer9.toFixed(2)} HR/9, ${profile.homeRuns} HR)`,
    )
  } else if (profile.inningsPitched < 40) {
    notes.push(
      `Limited HR-allowed sample (${profile.homeRuns} HR in ${profile.inningsPitched} IP)`,
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

  if (input.batterPitchStats && input.batterPitchStats.size > 0) score += 8
  if (input.pitcherPitchStats && input.pitcherPitchStats.size > 0) score += 8
  if (input.pitcherHrAllowed && input.pitcherHrAllowed.inningsPitched >= 20) score += 10

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

function formatSigned(value: number): string {
  return `${value >= 0 ? '+' : ''}${value}`
}
