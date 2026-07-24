import type { HrPredictionsResponse } from '../types/predictions'
import { apiUrl } from './baseUrl'
import { todayInEastern } from './parkFactors'

export async function fetchHrPredictions(options?: {
  date?: string
  topParks?: number
}): Promise<HrPredictionsResponse> {
  const date = options?.date ?? todayInEastern()
  const topParks = options?.topParks ?? 5
  const params = new URLSearchParams({
    date,
    topParks: String(topParks),
  })

  const response = await fetch(apiUrl(`/api/hr-predictions?${params.toString()}`))
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

  return response.json() as Promise<HrPredictionsResponse>
}
