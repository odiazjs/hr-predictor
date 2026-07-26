import {
  enrichPitcherHrAllowedMap,
  fetchPitcherHrAllowedMap,
} from '../mlb/pitcherHrAllowed.ts'
import { fetchMlbSchedule, type MlbGame, type LineupPlayer } from '../mlb/schedule.ts'
import { fetchAsOfPlayerStats } from '../savant/asOfPlayerStats.ts'
import { fetchPitcherArsenal, type PitcherArsenal } from '../savant/pitchArsenal.ts'
import { fetchSwingPathMap, type SwingPathProfile } from '../savant/swingPath.ts'
import { scoreBatterMatchup } from '../scoring/hrScore.ts'
import { seasonFromDate, statsAsOfDate, todayInEastern } from '../utils/date.ts'

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
  /** Inclusive end of player-stat window (always slate date − 1 day). */
  statsAsOf: string
  season: number
  generatedAt: string
  gamesConsidered: number
  battersScored: number
  predictions: HrPrediction[]
  warnings: string[]
}

export async function predictHomeRuns(options: {
  date: string
}): Promise<HrPredictionsResponse> {
  const date = options.date
  const season = seasonFromDate(date)
  // Exclude slate-day games so backtests / past boards aren't polluted by
  // HRs and PAs that already happened on the selected date.
  const statsAsOf = statsAsOfDate(date)
  const warnings: string[] = []
  const today = todayInEastern()

  if (date <= today) {
    warnings.push(
      `All player inputs (swing path, barrels/xSLG, pitch-type damage, pitcher HR/9) are cut off through ${statsAsOf}, excluding ${date} games.`,
    )
  }

  warnings.push('Park factor is not used; scoring every confirmed lineup on the full MLB slate.')

  const [schedule, swingMap, pitcherHrSeed] = await Promise.all([
    fetchMlbSchedule(date),
    fetchSwingPathMap(season, { endDate: statsAsOf }),
    fetchPitcherHrAllowedMap(season, { endDate: statsAsOf }),
  ])

  if (schedule.length === 0) {
    warnings.push('No MLB games found for this date')
  }

  const pitcherIds = unique(
    schedule.flatMap((game) => {
      const ids: number[] = []
      if (game.awayPitcher) ids.push(game.awayPitcher.id)
      if (game.homePitcher) ids.push(game.homePitcher.id)
      return ids
    }),
  )

  const batterIds = unique(
    schedule.flatMap((game) => [
      ...game.homeLineup.map((batter) => batter.id),
      ...game.awayLineup.map((batter) => batter.id),
    ]),
  )

  const [arsenalEntries, pitcherHrMap, asOfStats] = await Promise.all([
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
    enrichPitcherHrAllowedMap(season, pitcherIds, pitcherHrSeed, {
      endDate: statsAsOf,
    }),
    fetchAsOfPlayerStats({
      season,
      endDate: statsAsOf,
      batterIds,
      pitcherIds,
    }),
  ])
  const arsenals = new Map<number, PitcherArsenal | null>(arsenalEntries)

  const exitVeloMap = asOfStats.exitVelo
  const expectedMap = asOfStats.expected
  const batterPitchStats = asOfStats.batterPitchStats
  const pitcherPitchStats = asOfStats.pitcherPitchStats

  if (batterIds.length > 0) {
    warnings.push(
      `Date-bounded Statcast loaded for ${asOfStats.loadedBatters}/${batterIds.length} batters and ${asOfStats.loadedPitchers}/${pitcherIds.length} pitchers through ${statsAsOf}.`,
    )
  }
  if (asOfStats.failedPlayerIds.length > 0) {
    warnings.push(
      `Statcast as-of fetch failed for ${asOfStats.failedPlayerIds.length} player(s); those matchups use partial inputs.`,
    )
  }

  const predictions: HrPrediction[] = []

  for (const game of schedule) {
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

      for (const batter of side.lineup) {
        const swing = swingMap.get(batter.id) ?? null
        const exitVelo = exitVeloMap.get(batter.id) ?? null
        const expected = expectedMap.get(batter.id) ?? null
        const batterStats = batterPitchStats.get(batter.id) ?? null
        const batSide = resolveBatSide(swing)

        const scored = scoreBatterMatchup({
          swing,
          exitVelo,
          expected,
          arsenal,
          pitcherPitchStats: pitcherStats,
          batterPitchStats: batterStats,
          pitcherHrAllowed: pitcherHr,
          batSide,
        })

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
          pitcherId: side.pitcher?.id ?? null,
          pitcherName: side.pitcher?.fullName ?? null,
          pitcherHand: arsenal?.pitchHand ?? null,
          pitcherHr: {
            homeRuns: pitcherHr?.homeRuns ?? null,
            homeRunsPer9: pitcherHr ? round2(pitcherHr.homeRunsPer9) : null,
            inningsPitched: pitcherHr?.inningsPitched ?? null,
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

  predictions.sort((a, b) => b.score - a.score)
  predictions.forEach((prediction, index) => {
    prediction.rank = index + 1
  })

  return {
    date,
    statsAsOf,
    season,
    generatedAt: new Date().toISOString(),
    gamesConsidered: schedule.length,
    battersScored: predictions.length,
    predictions,
    warnings: unique(warnings),
  }
}

function resolveBatSide(swing: SwingPathProfile | null): 'L' | 'R' {
  if (!swing) return 'R'
  if (swing.side === 'L') return 'L'
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
