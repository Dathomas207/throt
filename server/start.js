import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDb } from './db.js'
import fs from 'node:fs'
import { createApp } from './app.js'
import { seedEvents } from './routesShows.js'
import { seedDemo, removeDemo } from './seedDemo.js'
import { seedPlaces, geocodePlaces } from './routesPlaces.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const staticDir = path.resolve(process.env.STATIC_DIR || path.join(root, 'dist'))
const port = Number(process.env.PORT) || 3000
// Render puts one proxy in front of the service. Trusting it makes req.ip the
// visitor's address, which the rate limiter needs.
const trustProxy = process.env.TRUST_PROXY !== undefined ? Number(process.env.TRUST_PROXY) || 0 : process.env.RENDER ? 1 : 0
const baseUrl = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '')

const db = await createDb()
if (db.kind === 'pg-mem') console.warn('DATABASE_URL is not set. Using the in-memory database: everything is lost when the server stops.')
// Curated shows from public listings. Loading them again changes nothing.
try {
  const n = await seedEvents(db, JSON.parse(fs.readFileSync(new URL('./seed-events.json', import.meta.url), 'utf8')))
  console.log(`Events from public listings: ${n} upcoming`)
} catch (e) { console.error('Could not load server/seed-events.json:', e.message) }
// Curated dog places around Charlotte. They get coordinates after the server is listening.
try {
  const n = await seedPlaces(db, JSON.parse(fs.readFileSync(new URL('./seed-places.json', import.meta.url), 'utf8')))
  console.log(`Places from public listings: ${n}`)
} catch (e) { console.error('Could not load server/seed-places.json:', e.message) }
// Demo dogs and people so the trial does not look empty. SEED_DEMO=0 skips this, SEED_DEMO=remove deletes them.
const seedMode = (process.env.SEED_DEMO || '').toLowerCase()
try {
  if (seedMode === 'remove') console.log(`Removed ${await removeDemo(db)} demo dogs`)
  else if (seedMode !== '0' && seedMode !== 'off' && seedMode !== 'false') {
    const r = await seedDemo(db, { photoDir: path.join(root, 'public') })
    console.log(`Demo seed: ${r.dogs} dogs, ${r.walks} walks`)
  }
} catch (e) { console.error('Demo seed failed:', e.message) }
const app = createApp({ db, staticDir, baseUrl, trustProxy })
const server = app.listen(port, () => {
  console.log(`Trot is listening on port ${port} (${db.kind}), serving ${staticDir}`)
  // Fill the shared map data cache for the launch area (Eastover and central Charlotte) so the first visitor does not wait.
  if (process.env.WARM_GEO === '1') (async () => {
    let ok = 0, bad = 0
    for (const kind of ['parks', 'more']) for (const [x, y] of [[1128, 1619], [1127, 1619], [1128, 1618], [1127, 1618], [1129, 1619], [1128, 1620]]) {
      try { const r = await fetch(`http://127.0.0.1:${port}/api/geo/${kind}/12/${x}/${y}`); r.ok ? ok++ : bad++; await r.arrayBuffer() } catch (e) { bad++ }
    }
    console.log(`Map data warmed for Charlotte: ${ok} tiles ready, ${bad} failed`)
  })()
  // One lookup a second, in the background, so startup never waits on it. GEOCODE=0 turns it off.
  if (process.env.GEOCODE !== '0') geocodePlaces(db).then((r) => { if (r.found || r.failed) console.log(`Curated places geocoded: ${r.found} found, ${r.failed} to retry at the next start`) }, (e) => console.error('Geocoding stopped:', e.message))
})

const stop = () => { server.close(() => db.close().catch(() => {}).finally(() => process.exit(0))); setTimeout(() => process.exit(0), 5000).unref() }
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
