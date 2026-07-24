const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/csv,application/json,text/html;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

export async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...DEFAULT_HEADERS,
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`)
  }

  return response.text()
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...DEFAULT_HEADERS,
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`)
  }

  return response.json() as Promise<T>
}
