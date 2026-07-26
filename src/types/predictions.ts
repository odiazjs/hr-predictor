export interface HrPrediction {
  rank: number
  score: number
  batterId: number
  batterName: string
  batSide: 'L' | 'R'
  team: string
  opponent: string
  position: string | null
  battingOrder: number
  gamePk: number
  matchup: string
  stadium: string
  venueId: number
  pitcherId: number | null
  pitcherName: string | null
  pitcherHand: 'L' | 'R' | null
  pitcherHr: {
    homeRuns: number | null
    homeRunsPer9: number | null
    inningsPitched: number | null
  }
  swing: {
    attackAngle: number | null
    swingTilt: number | null
    avgBatSpeed: number | null
    idealAttackAngleRate: number | null
  }
  power: {
    barrelPercent: number | null
    barrelsPerPa: number | null
    ev50: number | null
    hardHitPercent: number | null
    xslg: number | null
    xwoba: number | null
  }
  arsenalTopPitches: Array<{
    pitchType: string
    usage: number
    avgSpeed: number
    avgPlateZ: number
    pitcherXslg: number | null
    batterXslg: number | null
    hardHitPercent: number | null
  }>
  breakdown: {
    batterQuality: number
    powerSkill: number
    swingPath: number
    arsenalMatch: number
    pitcherHrAllowed: number
    confidence: number
    notes: string[]
  }
  links: {
    swingPath: string
    exitVelo: string
    expectedStats: string
    pitchArsenalStats: string
    hrAllowed: string
    pitch3d: string | null
  }
}

export interface HrPredictionsResponse {
  date: string
  /** Inclusive end of player-stat window (slate date − 1 day). */
  statsAsOf: string
  season: number
  generatedAt: string
  gamesConsidered: number
  battersScored: number
  predictions: HrPrediction[]
  warnings: string[]
}
