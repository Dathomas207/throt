// Runtime settings from the server (public Mapbox token and style). Static hosting has none.
let p = null
const KEY = 'trot-config-v1'
// The last known settings are used straight away so the map does not wait on the server,
// and are refreshed in the background for next time.
export function getConfig() {
  if (!p) {
    let cached = null
    try { cached = JSON.parse(localStorage.getItem(KEY)) } catch (e) {}
    const fresh = fetch('/api/config', { headers: { accept: 'application/json' } })
      .then((r) => (r.ok && /json/.test(r.headers.get('content-type') || '') ? r.json() : {}))
      .then((c) => { try { localStorage.setItem(KEY, JSON.stringify(c)) } catch (e) {} return c })
      .catch(() => cached || {})
    p = cached && cached.mapboxToken ? Promise.resolve(cached) : fresh
  }
  return p
}
export async function getHeat(b) {
  try {
    const q = b ? `?s=${b.s.toFixed(4)}&w=${b.w.toFixed(4)}&n=${b.n.toFixed(4)}&e=${b.e.toFixed(4)}` : ''
    const r = await fetch('/api/heat' + q, { headers: { accept: 'application/json' } })
    if (!r.ok || !/json/.test(r.headers.get('content-type') || '')) return null
    const j = await r.json()
    return Array.isArray(j.points) ? j.points : null
  } catch (e) { return null }
}
