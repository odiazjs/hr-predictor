import type { ParkFactor } from '../parseParkFactors.ts'
import type { MlbGame } from './schedule.ts'

/**
 * Soft seasonal HR environment priors by venue id.
 * Used only when Ballpark Pal day factors are unavailable.
 * Values approximate relative HR friendliness (percent vs league).
 */
const VENUE_HR_PRIOR: Record<number, number> = {
  19: 28, // Coors Field
  2681: 14, // Citizens Bank Park
  3313: 12, // Yankee Stadium
  2392: 10, // Daikin Park (Houston)
  32: 9, // American Family Field
  15: 8, // Chase Field
  12: 8, // Great American Ball Park
  4705: 7, // Truist Park
  3: 6, // Fenway Park
  1: 5, // Angel Stadium
  4169: 5, // loanDepot park
  2: 4, // Oriole Park
  14: 3, // Rogers Centre
  5325: 2, // Globe Life Field
  680: -2, // T-Mobile Park
  7: -4, // Kauffman Stadium
  5: -5, // Progressive Field
  17: -6, // Wrigley Field
  22: -8, // Oracle Park
  31: -8, // Petco Park
}

export function buildFallbackParksFromSchedule(
  games: MlbGame[],
  topParks: number,
): ParkFactor[] {
  return [...games]
    .map((game) => {
      const hrFactor = VENUE_HR_PRIOR[game.venueId] ?? 0
      return {
        rank: 0,
        stadium: game.venueName,
        venueId: String(game.venueId),
        gamePk: String(game.gamePk),
        gameTime: null,
        matchup: `${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation}`,
        gameUrl: null,
        hrFactor,
        hrLabel: `${hrFactor >= 0 ? '+' : ''}${hrFactor}%`,
        doublesTriplesFactor: 0,
        doublesTriplesLabel: '0%',
        singlesFactor: 0,
        singlesLabel: '0%',
        runsFactor: 0,
        runsLabel: '0%',
        windReceptiveness: null,
        temperature: null,
        humidity: null,
        pressure: null,
        description: 'Seasonal venue prior (Ballpark Pal unavailable)',
      } satisfies ParkFactor
    })
    .sort((a, b) => b.hrFactor - a.hrFactor)
    .slice(0, topParks)
    .map((park, index) => ({ ...park, rank: index + 1 }))
}

export function isParkFactorsPaywalled(html: string): boolean {
  return (
    /Secure Checkout/i.test(html) ||
    /complete your secure checkout/i.test(html) ||
    !/id=["']parkFactorsTable["']/i.test(html)
  )
}
