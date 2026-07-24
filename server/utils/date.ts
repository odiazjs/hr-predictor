export function todayInEastern(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function seasonFromDate(date: string): number {
  return Number(date.slice(0, 4))
}

/** Shift an ISO date (YYYY-MM-DD) by whole days using UTC calendar math. */
export function shiftIsoDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + days))
  return next.toISOString().slice(0, 10)
}

/**
 * Stats used for a slate date should exclude that day's games
 * (and anything after) so historical boards are not contaminated
 * by results that had not happened yet at first pitch.
 */
export function statsAsOfDate(slateDate: string): string {
  return shiftIsoDate(slateDate, -1)
}

export function seasonStartDate(season: number): string {
  return `${season}-03-01`
}
