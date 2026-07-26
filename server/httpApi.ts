import {
  buildFallbackParksFromSchedule,
  isParkFactorsPaywalled,
} from './mlb/parkFallback.ts'
import { fetchMlbSchedule } from './mlb/schedule.ts'
import { parseParkFactorsHtml } from './parseParkFactors.ts'
import {
  listSlateGames,
  predictHomeRuns,
  predictHomeRunsForGame,
} from './pipeline/predictHomeRuns.ts'
import { todayInEastern } from './utils/date.ts'
import { fetchText } from './utils/http.ts'

const PARK_SOURCE = 'https://www.ballparkpal.com/Park-Factors.php'

export type ApiRequest = {
  url?: string
  method?: string
  headers?: Record<string, string | string[] | undefined>
}

export type ApiResponse = {
  statusCode: number
  setHeader: (name: string, value: string) => void
  end: (body?: string) => void
}

function headerValue(
  headers: ApiRequest['headers'],
  name: string,
): string | undefined {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()]
  if (Array.isArray(value)) return value[0]
  return value
}

function applyCors(req: ApiRequest, res: ApiResponse) {
  const origin = headerValue(req.headers, 'origin') ?? '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function sendJson(res: ApiResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

/** Handle `/api/*` routes. Returns true when the request was handled. */
export async function handleApiRequest(
  req: ApiRequest,
  res: ApiResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (!url.pathname.startsWith('/api/')) return false

  applyCors(req, res)
  if ((req.method ?? 'GET').toUpperCase() === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return true
  }

  if (url.pathname === '/api/park-factors') {
    const date = url.searchParams.get('date') ?? todayInEastern()
    const sourceUrl = `${PARK_SOURCE}?date=${encodeURIComponent(date)}`

    try {
      const html = await fetchText(sourceUrl)
      if (isParkFactorsPaywalled(html)) {
        const schedule = await fetchMlbSchedule(date)
        const parks = buildFallbackParksFromSchedule(schedule, 10)
        res.setHeader('Cache-Control', 'public, max-age=120')
        sendJson(res, 200, {
          date,
          displayDate: null,
          lastUpdated: null,
          summary:
            'Ballpark Pal day factors are currently gated. Showing seasonal venue HR priors as a fallback.',
          sourceUrl,
          parks,
          fallback: true,
        })
        return true
      }

      const payload = parseParkFactorsHtml(html, date, sourceUrl)
      res.setHeader('Cache-Control', 'public, max-age=300')
      sendJson(res, 200, payload)
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : 'Failed to fetch park factors',
        sourceUrl,
      })
    }
    return true
  }

  if (url.pathname === '/api/schedule') {
    const date = url.searchParams.get('date') ?? todayInEastern()
    try {
      const payload = await listSlateGames(date)
      res.setHeader('Cache-Control', 'public, max-age=60')
      sendJson(res, 200, payload)
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : 'Failed to load schedule',
        date,
      })
    }
    return true
  }

  if (url.pathname === '/api/hr-predictions/game') {
    const date = url.searchParams.get('date') ?? todayInEastern()
    const gamePk = Number(url.searchParams.get('gamePk'))
    if (!Number.isFinite(gamePk) || gamePk <= 0) {
      sendJson(res, 400, { error: 'gamePk is required' })
      return true
    }

    try {
      const payload = await predictHomeRunsForGame({ date, gamePk })
      res.setHeader('Cache-Control', 'public, max-age=120')
      sendJson(res, 200, payload)
    } catch (error) {
      sendJson(res, 500, {
        error:
          error instanceof Error ? error.message : 'Failed to score game predictions',
        date,
        gamePk,
      })
    }
    return true
  }

  if (url.pathname === '/api/hr-predictions') {
    const date = url.searchParams.get('date') ?? todayInEastern()
    const gamePkParam = url.searchParams.get('gamePk')

    try {
      const payload = gamePkParam
        ? await predictHomeRunsForGame({ date, gamePk: Number(gamePkParam) })
        : await predictHomeRuns({ date })
      res.setHeader('Cache-Control', 'public, max-age=120')
      sendJson(res, 200, payload)
    } catch (error) {
      sendJson(res, 500, {
        error:
          error instanceof Error ? error.message : 'Failed to build HR predictions',
        date,
      })
    }
    return true
  }

  sendJson(res, 404, { error: `Unknown API route: ${url.pathname}` })
  return true
}
