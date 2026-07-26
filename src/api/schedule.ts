import { apiUrl } from './baseUrl'
import { todayInEastern } from './parkFactors'

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

export async function fetchSlateSchedule(date = todayInEastern()): Promise<SlateScheduleResponse> {
  const response = await fetch(apiUrl(`/api/schedule?date=${encodeURIComponent(date)}`))
  if (!response.ok) {
    let message = `Request failed (${response.status})`
    try {
      const body = (await response.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // ignore
    }
    throw new Error(message)
  }
  return response.json() as Promise<SlateScheduleResponse>
}
