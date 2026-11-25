// Database access. Real Postgres through `pg` when DATABASE_URL is set,
// otherwise the pg-mem in-memory database so the server runs with no setup.
// Everything goes through parameterized queries.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dogs (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    breed TEXT NOT NULL DEFAULT '',
    birthday TEXT,
    age TEXT NOT NULL DEFAULT '',
    weight DOUBLE PRECISION,
    bio TEXT NOT NULL DEFAULT '',
    is_public BOOLEAN NOT NULL DEFAULT TRUE,
    share_routes BOOLEAN NOT NULL DEFAULT FALSE,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS memberships (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dog_id TEXT NOT NULL REFERENCES dogs(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_id, dog_id)
  )`,
  `CREATE TABLE IF NOT EXISTS invites (
    token_hash TEXT PRIMARY KEY,
    dog_id TEXT NOT NULL REFERENCES dogs(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_by TEXT REFERENCES users(id),
    used_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS walks (
    id TEXT PRIMARY KEY,
    dog_id TEXT NOT NULL REFERENCES dogs(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    place TEXT NOT NULL DEFAULT '',
    miles DOUBLE PRECISION NOT NULL DEFAULT 0,
    minutes DOUBLE PRECISION NOT NULL DEFAULT 0,
    sniffs INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ NOT NULL,
    route TEXT,
    created_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS paws (
    walk_id TEXT NOT NULL REFERENCES walks(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (walk_id, user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS walks_dog_started ON walks (dog_id, started_at)`,
  `CREATE INDEX IF NOT EXISTS memberships_dog ON memberships (dog_id)`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id)`,
]

// Columns added after the first release. CREATE TABLE IF NOT EXISTS leaves an
// existing table alone, so these are added one by one at startup. The check runs
// first; if two instances start together the loser's duplicate-column error is ignored.
const COLUMNS = [
  ['dogs', 'photo', 'TEXT'],
  // Short content hash of the photo. Lets lists build a photo URL without reading the photo.
  ['dogs', 'photo_v', 'TEXT'],
]
const isDuplicateColumn = (e) => e && (e.code === '42701' || /already exists|duplicate column/i.test(e.message || ''))
export async function migrate(query) {
  for (const sql of SCHEMA) await query(sql)
  await addColumns(query)
}
export async function addColumns(query) {
  // Table, column and type come from the fixed list above, never from a request.
  for (const [table, column, type] of COLUMNS) {
    let has = false
    try {
      const r = await query('SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2', [table, column])
      has = r.rows.length > 0
    } catch (e) {}
    if (has) continue
    try { await query(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`) } catch (e) { if (!isDuplicateColumn(e)) throw e }
  }
}

function sslFor(url) {
  const mode = (process.env.DATABASE_SSL || '').toLowerCase()
  if (mode === 'off' || mode === 'disable') return false
  if (mode === 'verify') return { rejectUnauthorized: true }
  let host = ''
  try { host = new URL(url).hostname } catch (e) {}
  if (!host || host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1') return false
  // Managed Postgres (Render and similar) uses certificates that do not chain to a
  // public root, so the default encrypts without verifying the certificate.
  // Set DATABASE_SSL=verify to require a verified certificate.
  return { rejectUnauthorized: false }
}

export async function createDb(url = process.env.DATABASE_URL) {
  let pool
  let kind
  if (url) {
    const { default: pg } = await import('pg')
    pool = new pg.Pool({ connectionString: url, ssl: sslFor(url), max: 10 })
    pool.on('error', (e) => console.error('Postgres pool error:', e.message))
    kind = 'postgres'
  } else {
    const { newDb } = await import('pg-mem')
    const mem = newDb()
    const { Pool } = mem.adapters.createPg()
    pool = new Pool()
    kind = 'pg-mem'
  }
  await migrate((text, params = []) => pool.query(text, params))
  return {
    kind,
    query: (text, params = []) => pool.query(text, params),
    async tx(fn) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const out = await fn({ query: (text, params = []) => client.query(text, params) })
        await client.query('COMMIT')
        return out
      } catch (e) {
        try { await client.query('ROLLBACK') } catch (e2) {}
        throw e
      } finally {
        client.release()
      }
    },
    close: () => pool.end(),
  }
}
