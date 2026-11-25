import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDb } from './db.js'
import { createApp } from './app.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const staticDir = path.resolve(process.env.STATIC_DIR || path.join(root, 'dist'))
const port = Number(process.env.PORT) || 3000
// Render puts one proxy in front of the service. Trusting it makes req.ip the
// visitor's address, which the rate limiter needs.
const trustProxy = process.env.TRUST_PROXY !== undefined ? Number(process.env.TRUST_PROXY) || 0 : process.env.RENDER ? 1 : 0
const baseUrl = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '')

const db = await createDb()
if (db.kind === 'pg-mem') console.warn('DATABASE_URL is not set. Using the in-memory database: everything is lost when the server stops.')
const app = createApp({ db, staticDir, baseUrl, trustProxy })
const server = app.listen(port, () => console.log(`Trot is listening on port ${port} (${db.kind}), serving ${staticDir}`))

const stop = () => { server.close(() => db.close().catch(() => {}).finally(() => process.exit(0))); setTimeout(() => process.exit(0), 5000).unref() }
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
