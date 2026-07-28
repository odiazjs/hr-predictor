import { fetchBatterPlatoonSplitsMap } from '../mlb/batterPlatoonSplits.ts'
import { fetchBatterRecentFormMap } from '../mlb/batterRecentForm.ts'
import { venueHrPrior } from '../mlb/parkFallback.ts'
import { fetchPitcherDurabilityMap } from '../mlb/pitcherDurability.ts'
import {
  enrichPitcherHrAllowedMap,
  fetchPitcherHrAllowedMap,
} from '../mlb/pitcherHrAllowed.ts'
import { fetchMlbSchedule, type MlbGame, type LineupPlayer } from '../mlb/schedule.ts'
import { fetchAsOfPlayerStats } from '../savant/asOfPlayerStats.ts'
import { fetchPitcherArsenal, type PitcherArsenal } from '../savant/pitchArsenal.ts'
import { fetchSwingPathMap, type SwingPathProfile } from '../savant/swingPath.ts'
import { applyAntiStacking, scoreBatterMatchup } from '../scoring/hrScore.ts'
import { seasonFromDate, statsAsOfDate, todayInEastern } from '../utils/date.ts'

export interface HrPrediction {
  rank: number
  /** Board score: weighted matchup quality (0–100). */
  score: number
  matchupScore: number
  expectedHrChance: number
  projectedPa: number
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
  parkHrFactor: number
  pitcherId: number | null
  pitcherName: string | null
  pitcherHand: 'L' | 'R' | null
  pitcherHr: {
    homeRuns: number | null
    homeRunsPer9: number | null
    inningsPitched: number | null
  }
  durability: {
    factor: number | null
    avgInnings: number | null
    earlyExitRate: number | null
  }
  recentForm: {
    plateAppearances: number | null
    homeRuns: number | null
    slg: number | null
    formScore: number | null
  }
  platoon: {
    vsHand: 'L' | 'R' | null
    isOpposite: boolean | null
    plateAppearances: number | null
    homeRuns: number | null
    slg: number | null
    ops: number | null
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
  /** Inclusive end of player-stat window (always slate date − 1 day). */
  statsAsOf: string
  season: number
  generatedAt: string
  gamesConsidered: number
  battersScored: number
  predictions: HrPrediction[]
  warnings: string[]
  gamePk?: number
  lineupFingerprint?: string
  fromCacheHint?: boolean
}

export interface SlateGameSummary {
  gamePk: number
  matchup: string
  stadium: string
  venueId: number
  status: string
  homeTeam: string
  awayTeam: string
  homePitcherId: number | null
  awayPitcherId: number | null
  homePitcherName: string | null
  awayPitcherName: string | null
  hasLineups: boolean
  batterCount: number
  lineupFingerprint: string
}

export interface SlateScheduleResponse {
  date: string
  statsAsOf: string
  season: number
  games: SlateGameSummary[]
}

export async function listSlateGames(date: string): Promise<SlateScheduleResponse> {
  const schedule = await fetchMlbSchedule(date)
  return {
    date,
    statsAsOf: statsAsOfDate(date),
    season: seasonFromDate(date),
    games: schedule.map(toGameSummary),
  }
}

export async function predictHomeRuns(options: {
  date: string
}): Promise<HrPredictionsResponse> {
  const schedule = await fetchMlbSchedule(options.date)
  return scoreGamesForDate(options.date, schedule)
}

export async function predictHomeRunsForGame(options: {
  date: string
  gamePk: number
}): Promise<HrPredictionsResponse> {
  const schedule = await fetchMlbSchedule(options.date)
  const game = schedule.find((entry) => entry.gamePk === options.gamePk)
  if (!game) {
    throw new Error(`Game ${options.gamePk} not found on ${options.date}`)
  }
  const result = await scoreGamesForDate(options.date, [game])
  return {
    ...result,
    gamePk: game.gamePk,
    lineupFingerprint: lineupFingerprint(game),
  }
}

async function scoreGamesForDate(
  date: string,
  games: MlbGame[],
): Promise<HrPredictionsResponse> {
  const season = seasonFromDate(date)
  const statsAsOf = statsAsOfDate(date)
  const warnings: string[] = []
  const today = todayInEastern()

  if (date <= today) {
    warnings.push(
      `All player inputs (swing path, barrels/xSLG, pitch-type damage, pitcher HR/9) are cut off through ${statsAsOf}, excluding ${date} games.`,
    )
  }

  warnings.push(
    'Ranked by expected HR chance tonight (matchup × projected PAs × starter durability), with park as a small input.',
  )

  if (games.length === 0) {
    return {
      date,
      statsAsOf,
      season,
      generatedAt: new Date().toISOString(),
      gamesConsidered: 0,
      battersScored: 0,
      predictions: [],
      warnings: [...warnings, 'No MLB games found for this date'],
    }
  }

  const pitcherIds = unique(
    games.flatMap((game) => {
      const ids: number[] = []
      if (game.awayPitcher) ids.push(game.awayPitcher.id)
      if (game.homePitcher) ids.push(game.homePitcher.id)
      return ids
    }),
  )

  const batterIds = unique(
    games.flatMap((game) => [
      ...game.homeLineup.map((batter) => batter.id),
      ...game.awayLineup.map((batter) => batter.id),
    ]),
  )

  // No confirmed lineups yet — skip heavy Statcast work.
  if (batterIds.length === 0) {
    for (const game of games) {
      warnings.push(
        `No confirmed lineups yet for ${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation}`,
      )
    }
    return {
      date,
      statsAsOf,
      season,
      generatedAt: new Date().toISOString(),
      gamesConsidered: games.length,
      battersScored: 0,
      predictions: [],
      warnings: unique(warnings),
      gamePk: games.length === 1 ? games[0].gamePk : undefined,
      lineupFingerprint: games.length === 1 ? lineupFingerprint(games[0]) : undefined,
    }
  }

  const [swingMap, pitcherHrSeed, arsenalEntries, platoonMap, recentFormMap, durabilityMap] =
    await Promise.all([
      fetchSwingPathMap(season, { endDate: statsAsOf }),
      fetchPitcherHrAllowedMap(season, { endDate: statsAsOf }),
      Promise.all(
        pitcherIds.map(async (pitcherId) => {
          try {
            return [pitcherId, await fetchPitcherArsenal(pitcherId, season)] as const
          } catch (error) {
            warnings.push(
              `Failed to load Pitch3D arsenal for pitcher ${pitcherId}: ${
                error instanceof Error ? error.message : 'unknown error'
              }`,
            )
            return [pitcherId, null] as const
          }
        }),
      ),
      fetchBatterPlatoonSplitsMap(season, batterIds),
      fetchBatterRecentFormMap(season, batterIds, statsAsOf),
      fetchPitcherDurabilityMap(season, pitcherIds, statsAsOf),
    ])

  const pitcherHrMap = await enrichPitcherHrAllowedMap(season, pitcherIds, pitcherHrSeed, {
    endDate: statsAsOf,
  })

  const asOfStats = await fetchAsOfPlayerStats({
    season,
    endDate: statsAsOf,
    batterIds,
    pitcherIds,
  })

  const arsenals = new Map<number, PitcherArsenal | null>(arsenalEntries)

  if (batterIds.length > 0) {
    warnings.push(
      `MLB platoon splits loaded for ${platoonMap.size}/${batterIds.length} batters (vs LHP / vs RHP).`,
    )
    warnings.push(
      `Recent form (~21d) loaded for ${recentFormMap.size}/${batterIds.length} batters; durability for ${durabilityMap.size}/${pitcherIds.length} pitchers.`,
    )
    warnings.push(
      `Date-bounded Statcast loaded for ${asOfStats.loadedBatters}/${batterIds.length} batters and ${asOfStats.loadedPitchers}/${pitcherIds.length} pitchers through ${statsAsOf}.`,
    )
  }
  if (asOfStats.failedPlayerIds.length > 0) {
    warnings.push(
      `Statcast as-of fetch failed for ${asOfStats.failedPlayerIds.length} player(s); those matchups use partial inputs.`,
    )
  }

  const exitVeloMap = asOfStats.exitVelo
  const expectedMap = asOfStats.expected
  const batterPitchStats = asOfStats.batterPitchStats
  const pitcherPitchStats = asOfStats.pitcherPitchStats
  const predictions: HrPrediction[] = []

  for (const game of games) {
    const parkHrFactor = venueHrPrior(game.venueId)
    const sides: Array<{
      lineup: LineupPlayer[]
      team: string
      opponent: string
      pitcher: MlbGame['awayPitcher']
    }> = [
      {
        lineup: game.homeLineup,
        team: game.homeTeam.abbreviation,
        opponent: game.awayTeam.abbreviation,
        pitcher: game.awayPitcher,
      },
      {
        lineup: game.awayLineup,
        team: game.awayTeam.abbreviation,
        opponent: game.homeTeam.abbreviation,
        pitcher: game.homePitcher,
      },
    ]

    for (const side of sides) {
      if (side.lineup.length === 0) {
        warnings.push(
          `No confirmed lineup yet for ${side.team} in ${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation}`,
        )
        continue
      }

      const arsenal = side.pitcher ? arsenals.get(side.pitcher.id) ?? null : null
      const pitcherStats = side.pitcher
        ? pitcherPitchStats.get(side.pitcher.id) ?? null
        : null
      const pitcherHr = side.pitcher ? pitcherHrMap.get(side.pitcher.id) ?? null : null
      const durability = side.pitcher ? durabilityMap.get(side.pitcher.id) ?? null : null

      for (const batter of side.lineup) {
        const swing = swingMap.get(batter.id) ?? null
        const exitVelo = exitVeloMap.get(batter.id) ?? null
        const expected = expectedMap.get(batter.id) ?? null
        const batterStats = batterPitchStats.get(batter.id) ?? null
        const platoon = platoonMap.get(batter.id) ?? null
        const recentForm = recentFormMap.get(batter.id) ?? null
        const pitcherHand = arsenal?.pitchHand ?? null
        const batSide = resolveBatSide(swing, platoon?.batSide, pitcherHand)

        const scored = scoreBatterMatchup({
          swing,
          exitVelo,
          expected,
          arsenal,
          pitcherPitchStats: pitcherStats,
          batterPitchStats: batterStats,
          pitcherHrAllowed: pitcherHr,
          platoon,
          recentForm,
          durability,
          batSide,
          pitcherHand,
          battingOrder: batter.battingOrder,
          parkHrFactor,
        })

        const vsSplit =
          pitcherHand === 'L'
            ? platoon?.vsLhp ?? null
            : pitcherHand === 'R'
              ? platoon?.vsRhp ?? null
              : null

        const sidePitches =
          arsenal?.pitches.filter((pitch) => pitch.batSide === batSide) ??
          arsenal?.pitches ??
          []

        const topPitchRows =
          sidePitches.length > 0
            ? sidePitches.slice(0, 3).map((pitch) => ({
                pitchType: pitch.pitchType,
                usage: round3(pitch.usage),
                avgSpeed: round1(pitch.avgSpeed),
                avgPlateZ: round2(pitch.avgPlateZ),
                pitcherXslg: pitcherStats?.get(pitch.pitchType)?.xslg ?? null,
                batterXslg: batterStats?.get(pitch.pitchType)?.xslg ?? null,
                hardHitPercent:
                  pitcherStats?.get(pitch.pitchType)?.hardHitPercent ?? null,
              }))
            : [...(pitcherStats?.values() ?? [])]
                .sort((a, b) => b.usage - a.usage)
                .slice(0, 3)
                .map((pitch) => ({
                  pitchType: pitch.pitchType,
                  usage: round3(pitch.usage),
                  avgSpeed: 0,
                  avgPlateZ: 0,
                  pitcherXslg: pitch.xslg,
                  batterXslg: batterStats?.get(pitch.pitchType)?.xslg ?? null,
                  hardHitPercent: pitch.hardHitPercent,
                }))

        predictions.push({
          rank: 0,
          score: scored.score,
          matchupScore: scored.matchupScore,
          expectedHrChance: scored.expectedHrChance,
          projectedPa: scored.breakdown.projectedPa,
          batterId: batter.id,
          batterName: batter.fullName,
          batSide,
          team: side.team,
          opponent: side.opponent,
          position: batter.position,
          battingOrder: batter.battingOrder,
          gamePk: game.gamePk,
          matchup: `${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation}`,
          stadium: game.venueName,
          venueId: game.venueId,
          parkHrFactor,
          pitcherId: side.pitcher?.id ?? null,
          pitcherName: side.pitcher?.fullName ?? null,
          pitcherHand,
          pitcherHr: {
            homeRuns: pitcherHr?.homeRuns ?? null,
            homeRunsPer9: pitcherHr ? round2(pitcherHr.homeRunsPer9) : null,
            inningsPitched: pitcherHr?.inningsPitched ?? null,
          },
          durability: {
            factor: durability?.durabilityFactor ?? null,
            avgInnings: durability?.avgInnings ?? null,
            earlyExitRate: durability?.earlyExitRate ?? null,
          },
          recentForm: {
            plateAppearances: recentForm?.plateAppearances ?? null,
            homeRuns: recentForm?.homeRuns ?? null,
            slg: recentForm ? round3(recentForm.slg) : null,
            formScore: recentForm?.formScore ?? null,
          },
          platoon: {
            vsHand: pitcherHand,
            isOpposite: pitcherHand ? batSide !== pitcherHand : null,
            plateAppearances: vsSplit?.plateAppearances ?? null,
            homeRuns: vsSplit?.homeRuns ?? null,
            slg: vsSplit ? round3(vsSplit.slg) : null,
            ops: vsSplit ? round3(vsSplit.ops) : null,
          },
          swing: {
            attackAngle: swing ? round1(swing.attackAngle) : null,
            swingTilt: swing ? round1(swing.swingTilt) : null,
            avgBatSpeed: swing ? round1(swing.avgBatSpeed) : null,
            idealAttackAngleRate: swing ? round3(swing.idealAttackAngleRate) : null,
          },
          power: {
            barrelPercent: exitVelo ? round1(exitVelo.barrelPercent) : null,
            barrelsPerPa: exitVelo ? round1(exitVelo.barrelsPerPa) : null,
            ev50: exitVelo ? round1(exitVelo.ev50) : null,
            hardHitPercent: exitVelo ? round1(exitVelo.hardHitPercent) : null,
            xslg: expected ? round3(expected.xslg) : null,
            xwoba: expected ? round3(expected.xwoba) : null,
          },
          arsenalTopPitches: topPitchRows,
          breakdown: scored.breakdown,
          links: {
            swingPath:
              'https://baseballsavant.mlb.com/leaderboard/bat-tracking/swing-path-attack-angle',
            exitVelo: 'https://baseballsavant.mlb.com/leaderboard/statcast',
            expectedStats: 'https://baseballsavant.mlb.com/leaderboard/expected_statistics',
            pitchArsenalStats:
              'https://baseballsavant.mlb.com/leaderboard/pitch-arsenal-stats',
            hrAllowed: 'https://www.mlb.com/stats/pitching/home-runs-allowed',
            pitch3d: side.pitcher
              ? `https://baseballsavant.mlb.com/visuals/pitch3d?player_id=${side.pitcher.id}`
              : null,
          },
        })
      }
    }
  }

  // Soft anti-stacking on expected HR chance only (does not change 0–100 matchup score).
  const scaledChances = applyAntiStacking(
    predictions.map((prediction) => ({
      expectedHrChance: prediction.expectedHrChance,
      pitcherId: prediction.pitcherId,
    })),
  )
  predictions.forEach((prediction, index) => {
    const chance = scaledChances[index]
    prediction.expectedHrChance = round4(chance)
    prediction.breakdown.expectedHrChance = round4(chance)
  })

  predictions.sort((a, b) => b.score - a.score)
  predictions.forEach((prediction, index) => {
    prediction.rank = index + 1
  })

  return {
    date,
    statsAsOf,
    season,
    generatedAt: new Date().toISOString(),
    gamesConsidered: games.length,
    battersScored: predictions.length,
    predictions,
    warnings: unique(warnings),
    gamePk: games.length === 1 ? games[0].gamePk : undefined,
    lineupFingerprint: games.length === 1 ? lineupFingerprint(games[0]) : undefined,
  }
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}

export function lineupFingerprint(game: MlbGame): string {
  const ids = [
    game.awayPitcher?.id ?? 0,
    game.homePitcher?.id ?? 0,
    ...game.awayLineup.map((batter) => batter.id),
    ...game.homeLineup.map((batter) => batter.id),
  ]
  return ids.join('-')
}

function toGameSummary(game: MlbGame): SlateGameSummary {
  return {
    gamePk: game.gamePk,
    matchup: `${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation}`,
    stadium: game.venueName,
    venueId: game.venueId,
    status: game.status,
    homeTeam: game.homeTeam.abbreviation,
    awayTeam: game.awayTeam.abbreviation,
    homePitcherId: game.homePitcher?.id ?? null,
    awayPitcherId: game.awayPitcher?.id ?? null,
    homePitcherName: game.homePitcher?.fullName ?? null,
    awayPitcherName: game.awayPitcher?.fullName ?? null,
    hasLineups: game.homeLineup.length > 0 || game.awayLineup.length > 0,
    batterCount: game.homeLineup.length + game.awayLineup.length,
    lineupFingerprint: lineupFingerprint(game),
  }
}

function resolveBatSide(
  swing: SwingPathProfile | null,
  mlbBatSide: 'L' | 'R' | 'S' | undefined,
  pitcherHand: 'L' | 'R' | null,
): 'L' | 'R' {
  const declared = mlbBatSide ?? swing?.side
  if (declared === 'S') {
    if (pitcherHand === 'L') return 'R'
    if (pitcherHand === 'R') return 'L'
    return 'R'
  }
  if (declared === 'L') return 'L'
  if (declared === 'R') return 'R'
  return 'R'
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}
