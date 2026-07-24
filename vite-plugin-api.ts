import type { Plugin } from 'vite'
import { handleApiRequest } from './server/httpApi.ts'

export function apiPlugin(): Plugin {
  return {
    name: 'hr-predictor-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const handled = await handleApiRequest(req, res)
        if (!handled) next()
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const handled = await handleApiRequest(req, res)
        if (!handled) next()
      })
    },
  }
}
