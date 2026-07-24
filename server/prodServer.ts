import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleApiRequest } from './httpApi.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(__dirname, '..', 'dist')
const port = Number(process.env.PORT) || 4173

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

async function serveStatic(urlPath: string): Promise<{
  status: number
  contentType: string
  body: Buffer
} | null> {
  const safePath = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '')
  let filePath = path.join(distDir, safePath === '/' ? 'index.html' : safePath)

  if (!filePath.startsWith(distDir)) return null

  try {
    const fileStat = await stat(filePath)
    if (fileStat.isDirectory()) {
      filePath = path.join(filePath, 'index.html')
    }
  } catch {
    // SPA fallback
    filePath = path.join(distDir, 'index.html')
  }

  try {
    const body = await readFile(filePath)
    const ext = path.extname(filePath).toLowerCase()
    return {
      status: 200,
      contentType: MIME[ext] ?? 'application/octet-stream',
      body,
    }
  } catch {
    return null
  }
}

const server = createServer(async (req, res) => {
  try {
    const handled = await handleApiRequest(req, res)
    if (handled) return

    const url = new URL(req.url ?? '/', `http://localhost:${port}`)
    const file = await serveStatic(url.pathname)
    if (!file) {
      res.statusCode = 404
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end('Not found')
      return
    }

    res.statusCode = file.status
    res.setHeader('Content-Type', file.contentType)
    res.end(file.body)
  } catch (error) {
    res.statusCode = 500
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end(error instanceof Error ? error.message : 'Server error')
  }
})

server.listen(port, '0.0.0.0', () => {
  console.log(`HR Predictor listening on http://0.0.0.0:${port}`)
})
