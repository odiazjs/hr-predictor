/** API origin for cloud frontends. Empty = same-origin `/api/...` (local Vite). */
export function apiUrl(path: string): string {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${base}${normalized}`
}
