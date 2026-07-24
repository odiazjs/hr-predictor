import type { Plugin } from 'vite'
import {
  buildFallbackParksFromSchedule,
  isParkFactorsPaywalled,
} from './server/mlb/parkFallback.ts'
import { fetchMlbSchedule } from './server/mlb/schedule.ts'
import { parseParkFactorsHtml } from './server/parseParkFactors.ts'
import { predictHomeRuns } from './server/pipeline/predictHomeRuns.ts'
import { todayInEastern } from './server/utils/date.ts'
import { fetchText } from './server/utils/http.ts'

const PARK_SOURCE = 'https://www.ballparkpal.com/Park-Factors.php'

type MiddlewareReq = { url?: string }
type MiddlewareRes = {
  statusCode: number
  setHeader: (name: string, value: string) => void
  end: (body: string) => void
}
type Next = () => void

function sendJson(res: MiddlewareRes, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function apiMiddleware() {
  return async (req: MiddlewareReq, res: MiddlewareRes, next: Next) => {
    const url = new URL(req.url ?? '/', 'http://localhost')

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
          return
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
      return
    }

    if (url.pathname === '/api/hr-predictions') {
      const date = url.searchParams.get('date') ?? todayInEastern()
      const topParks = Number(url.searchParams.get('topParks') ?? '5')

      try {
        const payload = await predictHomeRuns({
          date,
          topParks: Number.isFinite(topParks) ? topParks : 5,
        })
        res.setHeader('Cache-Control', 'public, max-age=120')
        sendJson(res, 200, payload)
      } catch (error) {
        sendJson(res, 500, {
          error:
            error instanceof Error ? error.message : 'Failed to build HR predictions',
          date,
        })
      }
      return
    }

    next()
  }
}

export function apiPlugin(): Plugin {
  return {
    name: 'hr-predictor-api',
    configureServer(server) {
      server.middlewares.use(apiMiddleware())
    },
    configurePreviewServer(server) {
      server.middlewares.use(apiMiddleware())
    },
  }
}
