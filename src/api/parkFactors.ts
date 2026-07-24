import type { ParkFactorsResponse } from '../types/parkFactors'

export function todayInEastern(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** Shift an ISO date (YYYY-MM-DD) by whole days using UTC calendar math. */
export function shiftIsoDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + days))
  return next.toISOString().slice(0, 10)
}

export async function fetchParkFactors(date = todayInEastern()): Promise<ParkFactorsResponse> {
  const response = await fetch(`/api/park-factors?date=${encodeURIComponent(date)}`)

  if (!response.ok) {
    let message = `Request failed (${response.status})`
    try {
      const body = (await response.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // ignore parse errors
    }
    throw new Error(message)
  }

  return response.json() as Promise<ParkFactorsResponse>
}
