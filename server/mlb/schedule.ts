import { fetchJson } from '../utils/http.ts'

export interface LineupPlayer {
  id: number
  fullName: string
  position: string | null
  battingOrder: number
}

export interface ProbablePitcher {
  id: number
  fullName: string
}

export interface MlbGame {
  gamePk: number
  officialDate: string
  gameDate: string
  venueId: number
  venueName: string
  awayTeam: { id: number; name: string; abbreviation: string }
  homeTeam: { id: number; name: string; abbreviation: string }
  awayPitcher: ProbablePitcher | null
  homePitcher: ProbablePitcher | null
  awayLineup: LineupPlayer[]
  homeLineup: LineupPlayer[]
  status: string
}

interface ScheduleResponse {
  dates?: Array<{
    games?: Array<{
      gamePk: number
      officialDate: string
      gameDate: string
      status?: { detailedState?: string }
      venue?: { id?: number; name?: string }
      teams?: {
        away?: TeamSide
        home?: TeamSide
      }
      lineups?: {
        awayPlayers?: Person[]
        homePlayers?: Person[]
      }
    }>
  }>
}

interface TeamSide {
  team?: {
    id?: number
    name?: string
    abbreviation?: string
  }
  probablePitcher?: {
    id?: number
    fullName?: string
  }
}

interface Person {
  id?: number
  fullName?: string
  primaryPosition?: { abbreviation?: string }
}

export async function fetchMlbSchedule(date: string): Promise<MlbGame[]> {
  const url =
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${encodeURIComponent(date)}` +
    `&hydrate=probablePitcher,lineups,team`

  const payload = await fetchJson<ScheduleResponse>(url)
  const games = payload.dates?.[0]?.games ?? []

  return games.map((game) => {
    const away = game.teams?.away
    const home = game.teams?.home

    return {
      gamePk: game.gamePk,
      officialDate: game.officialDate,
      gameDate: game.gameDate,
      venueId: game.venue?.id ?? 0,
      venueName: game.venue?.name ?? 'Unknown venue',
      awayTeam: {
        id: away?.team?.id ?? 0,
        name: away?.team?.name ?? 'Away',
        abbreviation: away?.team?.abbreviation ?? 'AWAY',
      },
      homeTeam: {
        id: home?.team?.id ?? 0,
        name: home?.team?.name ?? 'Home',
        abbreviation: home?.team?.abbreviation ?? 'HOME',
      },
      awayPitcher: toPitcher(away?.probablePitcher),
      homePitcher: toPitcher(home?.probablePitcher),
      awayLineup: toLineup(game.lineups?.awayPlayers),
      homeLineup: toLineup(game.lineups?.homePlayers),
      status: game.status?.detailedState ?? 'Scheduled',
    }
  })
}

function toPitcher(
  pitcher?: { id?: number; fullName?: string },
): ProbablePitcher | null {
  if (!pitcher?.id || !pitcher.fullName) return null
  return { id: pitcher.id, fullName: pitcher.fullName }
}

function toLineup(players?: Person[]): LineupPlayer[] {
  return (players ?? [])
    .filter((player): player is Person & { id: number; fullName: string } =>
      Boolean(player.id && player.fullName),
    )
    .map((player, index) => ({
      id: player.id,
      fullName: player.fullName,
      position: player.primaryPosition?.abbreviation ?? null,
      battingOrder: index + 1,
    }))
}
