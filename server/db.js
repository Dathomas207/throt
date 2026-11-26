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
  // Health records. Dates are kept as validated YYYY-MM-DD text, the same way a
  // dog's birthday is, so they never shift with the server's time zone.
  // `detail` holds a medication's dose or a visit's clinic. `schedule` is a medication's schedule.
  `CREATE TABLE IF NOT EXISTS health_entries (
    id TEXT PRIMARY KEY,
    dog_id TEXT NOT NULL REFERENCES dogs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    value DOUBLE PRECISION,
    unit TEXT,
    occurred_on TEXT,
    due_on TEXT,
    detail TEXT NOT NULL DEFAULT '',
    schedule TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    document_id TEXT,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL
  )`,
  // "Share with the vet" links. Only a hash of the token is stored.
  `CREATE TABLE IF NOT EXISTS health_shares (
    token_hash TEXT PRIMARY KEY,
    dog_id TEXT NOT NULL REFERENCES dogs(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
  )`,
  // Dog-friendly places added and confirmed by people, plus a curated list.
  `CREATE TABLE IF NOT EXISTS places (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    note TEXT NOT NULL DEFAULT '',
    created_by TEXT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS place_confirms (
    place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (place_id, user_id)
  )`,
  // A dog's paperwork. The bytes are kept as base64 text for this trial.
  `CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    dog_id TEXT NOT NULL REFERENCES dogs(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    data TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    in_vet_summary BOOLEAN NOT NULL DEFAULT FALSE,
    uploaded_by TEXT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS awards (
    id TEXT PRIMARY KEY,
    dog_id TEXT NOT NULL REFERENCES dogs(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    kind TEXT NOT NULL,
    event_name TEXT NOT NULL DEFAULT '',
    placement TEXT NOT NULL DEFAULT '',
    awarded_on TEXT,
    notes TEXT NOT NULL DEFAULT '',
    document_id TEXT,
    is_public BOOLEAN NOT NULL DEFAULT FALSE,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL
  )`,
  // Community calendar. Curated rows come from server/seed-events.json and have no creator.
  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    starts_on TEXT NOT NULL,
    ends_on TEXT,
    venue TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    region TEXT NOT NULL DEFAULT '',
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    url TEXT,
    description TEXT NOT NULL DEFAULT '',
    source_url TEXT,
    curated BOOLEAN NOT NULL DEFAULT FALSE,
    created_by TEXT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS event_entries (
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    dog_id TEXT NOT NULL REFERENCES dogs(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    result TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (event_id, dog_id)
  )`,
  // Which dogs joined which challenge window. Progress is never stored.
  `CREATE TABLE IF NOT EXISTS challenge_joins (
    dog_id TEXT NOT NULL REFERENCES dogs(id) ON DELETE CASCADE,
    challenge_key TEXT NOT NULL,
    period_key TEXT NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (dog_id, challenge_key, period_key)
  )`,
  // A request to maintain a listing: 'owner' for a business, 'steward' for a park. An admin decides each one by hand.
  `CREATE TABLE IF NOT EXISTS place_claims (
    id TEXT PRIMARY KEY,
    place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    contact_email TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL,
    decided_at TIMESTAMPTZ
  )`,
  // "Report a problem" on a listing. Open until an admin resolves it.
  `CREATE TABLE IF NOT EXISTS place_reports (
    id TEXT PRIMARY KEY,
    place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL,
    resolved_at TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS place_claims_place ON place_claims (place_id)`,
  `CREATE INDEX IF NOT EXISTS place_reports_place ON place_reports (place_id)`,
  // Registration and ID: what the owner typed about the microchip, licence and rabies tag. Care team only, never public.
  `CREATE TABLE IF NOT EXISTS dog_registrations (
    dog_id TEXT PRIMARY KEY REFERENCES dogs(id) ON DELETE CASCADE,
    microchip_number TEXT NOT NULL DEFAULT '',
    microchip_registry TEXT NOT NULL DEFAULT '',
    license_jurisdiction TEXT NOT NULL DEFAULT '',
    license_number TEXT NOT NULL DEFAULT '',
    license_expires_on TEXT,
    rabies_tag TEXT NOT NULL DEFAULT '',
    rabies_due_on TEXT,
    akc_number TEXT NOT NULL DEFAULT '',
    altered TEXT NOT NULL DEFAULT 'unknown',
    updated_by TEXT REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL
  )`,
  // Trot Tags: an unguessable code written to an NFC sticker or shown as a QR code. kind 'link' is the one the public page uses.
  `CREATE TABLE IF NOT EXISTS dog_tags (
    id TEXT PRIMARY KEY,
    dog_id TEXT NOT NULL REFERENCES dogs(id) ON DELETE CASCADE,
    code TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'tag',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL,
    retired_at TIMESTAMPTZ
  )`,
  // One row per tag page view ('scan') or "I found this dog" report ('found'). No IP address, and only the device family.
  `CREATE TABLE IF NOT EXISTS tag_scans (
    id TEXT PRIMARY KEY,
    tag_id TEXT NOT NULL REFERENCES dog_tags(id) ON DELETE CASCADE,
    dog_id TEXT NOT NULL REFERENCES dogs(id) ON DELETE CASCADE,
    scanned_at TIMESTAMPTZ NOT NULL,
    kind TEXT NOT NULL,
    finder_name TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    contact TEXT NOT NULL DEFAULT '',
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    agent TEXT NOT NULL DEFAULT '',
    read_at TIMESTAMPTZ
  )`,
  // Dog friends: one dog follows another. Only public dogs can be followed. When both rows exist the two are "friends with each other".
  `CREATE TABLE IF NOT EXISTS dog_follows (
    follower_dog_id TEXT NOT NULL REFERENCES dogs(id) ON DELETE CASCADE,
    followed_dog_id TEXT NOT NULL REFERENCES dogs(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (follower_dog_id, followed_dog_id)
  )`,
  // Photos on an outing. JPEG only, kept as base64 text for this trial, the same way documents are.
  // `hash` is a short content hash used in the photo's address and its cache headers.
  `CREATE TABLE IF NOT EXISTS walk_photos (
    id TEXT PRIMARY KEY,
    walk_id TEXT NOT NULL REFERENCES walks(id) ON DELETE CASCADE,
    added_by TEXT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    data TEXT NOT NULL,
    hash TEXT NOT NULL
  )`,
  // First-party usage counts. No IP address, no location, no email and no free text from people. `ua` is the
  // device family only ("Safari on iPhone or iPad"), `props` is a small JSON object of fixed keys.
  // A signed-out or demo visit carries a random id from that browser's localStorage instead of a user.
  `CREATE TABLE IF NOT EXISTS usage_events (
    id TEXT PRIMARY KEY,
    at TIMESTAMPTZ NOT NULL,
    user_id TEXT,
    anon_id TEXT,
    name TEXT NOT NULL,
    dog_id TEXT,
    props TEXT NOT NULL DEFAULT '{}',
    ua TEXT NOT NULL DEFAULT '',
    app_version TEXT NOT NULL DEFAULT ''
  )`,
  // The in-app notification center. `link` is a small JSON object that says where a tap goes.
  // `dedupe_key` keeps one row per person for things that can repeat (paws on one outing, a reminder for one date).
  `CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    dog_id TEXT,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    link TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    read_at TIMESTAMPTZ,
    dedupe_key TEXT,
    UNIQUE (user_id, dedupe_key)
  )`,
  // Which groups of notifications a person turned off, as a JSON list. No row means all on.
  `CREATE TABLE IF NOT EXISTS notification_prefs (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    off TEXT NOT NULL DEFAULT '[]',
    updated_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS usage_events_at ON usage_events (at)`,
  `CREATE INDEX IF NOT EXISTS notifications_user ON notifications (user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS dog_follows_followed ON dog_follows (followed_dog_id)`,
  `CREATE INDEX IF NOT EXISTS walk_photos_walk ON walk_photos (walk_id)`,
  `CREATE INDEX IF NOT EXISTS dog_tags_dog ON dog_tags (dog_id)`,
  `CREATE INDEX IF NOT EXISTS tag_scans_dog ON tag_scans (dog_id, scanned_at)`,
  `CREATE INDEX IF NOT EXISTS documents_dog ON documents (dog_id)`,
  `CREATE INDEX IF NOT EXISTS awards_dog ON awards (dog_id)`,
  `CREATE INDEX IF NOT EXISTS events_starts ON events (starts_on)`,
  `CREATE INDEX IF NOT EXISTS challenge_joins_key ON challenge_joins (challenge_key, period_key)`,
  `CREATE INDEX IF NOT EXISTS health_entries_dog ON health_entries (dog_id)`,
  `CREATE INDEX IF NOT EXISTS health_shares_dog ON health_shares (dog_id)`,
  `CREATE INDEX IF NOT EXISTS places_lat_lng ON places (lat, lng)`,
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
  // 1 phone, 2 AirTag, 3 fitness tracker. Chosen per dog.
  ['dogs', 'tracking_level', 'INTEGER NOT NULL DEFAULT 1'],
  // Daily activity goal in minutes, set by the owner. Empty until they set one.
  ['dogs', 'goal_minutes', 'INTEGER'],
  // Used for the city leaderboard and for events near the dog.
  ['dogs', 'city', "TEXT NOT NULL DEFAULT ''"],
  // FALSE takes the dog off every leaderboard.
  ['dogs', 'leaderboards', 'BOOLEAN NOT NULL DEFAULT TRUE'],
  // Seeded demo accounts and dogs, so real ones can be told apart.
  ['dogs', 'is_demo', 'BOOLEAN NOT NULL DEFAULT FALSE'],
  ['users', 'is_demo', 'BOOLEAN NOT NULL DEFAULT FALSE'],
  // Curated places from server/seed-places.json. They arrive with an address and
  // get coordinates from one geocoding lookup each. Until then lat and lng are empty.
  ['places', 'curated', 'BOOLEAN NOT NULL DEFAULT FALSE'],
  ['places', 'address', "TEXT NOT NULL DEFAULT ''"],
  ['places', 'source_url', 'TEXT'],
  ['places', 'geocoded_at', 'TIMESTAMPTZ'],
  // Who maintains the listing (set when an admin approves a claim) and what they keep up to date.
  // amenities is a JSON list of fixed keys. last_checked_at moves on seeding, a manager's edit or a confirmation.
  ['places', 'managed_by', 'TEXT'],
  ['places', 'managed_role', 'TEXT'],
  ['places', 'dog_policy', 'TEXT'],
  ['places', 'amenities', 'TEXT'],
  ['places', 'event_note', "TEXT NOT NULL DEFAULT ''"],
  ['places', 'website', 'TEXT'],
  ['places', 'last_checked_at', 'TIMESTAMPTZ'],
  // Performance statistics from the phone carried on the walk. Speeds are in mph. All optional.
  ['walks', 'avg_speed', 'DOUBLE PRECISION'],
  ['walks', 'max_speed', 'DOUBLE PRECISION'],
  ['walks', 'sprints', 'INTEGER'],
  ['walks', 'moving_minutes', 'DOUBLE PRECISION'],
  ['walks', 'run_minutes', 'DOUBLE PRECISION'],
  // Lost Dog mode. Empty unless the owner or family reported the dog lost.
  ['dogs', 'lost_since', 'TIMESTAMPTZ'],
  ['dogs', 'lost_note', "TEXT NOT NULL DEFAULT ''"],
]
const isDuplicateColumn = (e) => e && (e.code === '42701' || /already exists|duplicate column/i.test(e.message || ''))
// Leaderboards and the pack feed read walks by time across all dogs. pg-mem cannot
// plan the feed's keyset query once this index exists, so only real Postgres gets it.
const POSTGRES_ONLY = [
  `CREATE INDEX IF NOT EXISTS walks_started ON walks (started_at)`,
  // One pending claim and one open report per person per place, held even if two requests race.
  `CREATE UNIQUE INDEX IF NOT EXISTS place_claims_one_pending ON place_claims (place_id, user_id) WHERE status = 'pending'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS place_reports_one_open ON place_reports (place_id, user_id) WHERE resolved_at IS NULL`,
]
export async function migrate(query, kind = 'postgres') {
  for (const sql of SCHEMA) await query(sql)
  await addColumns(query)
  if (kind === 'postgres') for (const sql of POSTGRES_ONLY) await query(sql)
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
  await migrate((text, params = []) => pool.query(text, params), kind)
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
