import axios, { type AxiosRequestConfig } from 'axios'

// ── Client-side read cache ──────────────────────────────────────────────────
// Dashboards re-mount (and therefore re-fetch) every time you switch tabs, which
// hammered the HubSpot API and caused 429s. This caches GET responses for a short
// window so clicking between tabs — or toggling a view you've already loaded —
// reuses what's already in memory instead of pulling live every time.
//
// Safety model:
//  • Only GETs are cached. Mutations (POST/PUT/PATCH/DELETE) are never cached and,
//    via installApiCache()'s interceptor, CLEAR the whole cache on success — so as
//    soon as you save something, the next read is fresh.
//  • The header "Refresh" button calls clearApiCache() to force a live pull.
//  • Callers can bypass per-request with { force: true } (e.g. a live wall display).
//  • A copy is kept in sessionStorage so a page reload within the window also skips
//    the pull; it's dropped when the tab/session closes.

const TTL = 5 * 60 * 1000 // 5 minutes
const PREFIX = 'apicache:'

type Entry = { ts: number; data: any }
const mem = new Map<string, Entry>()

function keyOf(url: string, params?: Record<string, any>) {
  if (!params) return url
  const qs = Object.entries(params)
    .filter(([, v]) => v != null)
    .sort(([a], [b]) => a.localeCompare(b)) // stable key regardless of param order
    .map(([k, v]) => `${k}=${String(v)}`)
    .join('&')
  return qs ? `${url}?${qs}` : url
}

function readSession(key: string): Entry | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as Entry) : null
  } catch { return null }
}

function writeSession(key: string, entry: Entry) {
  try { sessionStorage.setItem(PREFIX + key, JSON.stringify(entry)) } catch { /* quota / disabled — ignore */ }
}

/**
 * Drop-in for axios.get that serves a cached response when one is fresh.
 * Returns an axios-response-shaped object, so existing `.then(r => r.data)` callers
 * work unchanged. Pass { force: true } to bypass the cache for this call.
 */
export async function cachedGet(
  url: string,
  config: (AxiosRequestConfig & { force?: boolean; ttl?: number }) = {},
) {
  const { force = false, ttl = TTL, ...axiosConfig } = config
  const key = keyOf(url, axiosConfig.params)
  const now = Date.now()

  if (!force) {
    let hit = mem.get(key)
    if (!hit) {
      const s = readSession(key)
      if (s) { hit = s; mem.set(key, s) }
    }
    if (hit && now - hit.ts < ttl) {
      return { data: hit.data, status: 200, statusText: 'OK (cache)', headers: {}, config: axiosConfig, cached: true }
    }
  }

  const res = await axios.get(url, axiosConfig)
  const entry: Entry = { ts: now, data: res.data }
  mem.set(key, entry)
  writeSession(key, entry)
  return res
}

/** Empty the cache (in-memory + sessionStorage). Wired to the header Refresh button. */
export function clearApiCache() {
  mem.clear()
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i)
      if (k && k.startsWith(PREFIX)) sessionStorage.removeItem(k)
    }
  } catch { /* ignore */ }
}

let installed = false
/**
 * Install a response interceptor once so that any successful mutation clears the
 * read cache — guaranteeing saved changes show up on the next fetch without waiting
 * for the TTL. Call from the app entry point.
 */
export function installApiCache() {
  if (installed) return
  installed = true
  // Attach the Clerk session token to /api requests so gated (mutation) routes authorize.
  // No session (logged-out / snapshot pages) → no header, and open read routes still work.
  axios.interceptors.request.use(async config => {
    const url = config.url || ''
    if (url.startsWith('/api')) {
      const hdrs: any = config.headers ?? (config.headers = {} as any)
      if (!hdrs.Authorization) {
        try {
          const token = await (window as any).Clerk?.session?.getToken?.()
          if (token) hdrs.Authorization = `Bearer ${token}`
        } catch { /* no active session — leave unauthenticated */ }
      }
    }
    return config
  })
  axios.interceptors.response.use(res => {
    const method = (res.config?.method || 'get').toLowerCase()
    if (method !== 'get') clearApiCache()
    return res
  })
}
