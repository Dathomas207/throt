// The in-app notification center: the `notify` helper every route can call, the list, read and delete
// endpoints, per-person preferences, and the reminders that are made when someone opens their list.
// Registered from app.js with the shared `kit`.
//
// Rules this file keeps:
// - In-app only. Nothing here sends push, email or text.
// - Nobody is notified about their own action, and seeded demo people never get rows.
// - A notification says only what the person could already see in the app. A found report's message and
//   contact details stay in tag activity; the notification just points there.
// - Found reports cannot be turned off.
import crypto from 'node:crypto'
import { dayString, tzOf } from './routesHealth.js'
import { dateStatus } from './routesRegistration.js'

export const NOTIFY_LIMITS = { page: 30, maxPage: 50, title: 140, body: 280, keepReadDays: 90, eventDays: 3 }
// Which preference switch covers each kind. Kinds that are not listed here are always delivered.
export const NOTIFY_GROUPS = { friends: ['friend_added', 'friend_mutual'], paws: ['paw'], care: ['care_invite_accepted', 'care_walk_logged'], reminders: ['registration_due', 'event_reminder'] }
export const NOTIFY_KINDS = ['friend_added', 'friend_mutual', 'paw', 'care_invite_accepted', 'care_walk_logged', 'found_report', 'registration_due', 'claim_approved', 'claim_rejected', 'event_reminder', 'welcome']
const GROUP_OF = Object.fromEntries(Object.entries(NOTIFY_GROUPS).flatMap(([g, kinds]) => kinds.map((k) => [k, g])))
const DAY = 864e5
const ID_RE = /^[0-9a-f-]{36}$/
const iso = (v) => new Date(v).toISOString()
const cut = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
const parse = (s, fallback) => { try { const v = JSON.parse(s); return v == null ? fallback : v } catch (e) { return fallback } }
const newId = () => crypto.randomUUID()

async function offGroups(db, userId) {
  const { rows } = await db.query('SELECT off FROM notification_prefs WHERE user_id = $1', [userId])
  const list = rows[0] ? parse(rows[0].off, []) : []
  return new Set(Array.isArray(list) ? list.filter((g) => NOTIFY_GROUPS[g]) : [])
}

// Safe to call from anywhere: it answers true when a row was written or refreshed, false otherwise, and
// never throws into the caller. `actorId` is the person whose action caused it; they are never the recipient.
// With a `dedupeKey` there is at most one row per person and key. A second call does nothing, unless
// `refresh` is set, in which case the row is rewritten, moved to the top and marked unread again.
export async function notify(db, userId, { kind, dogId = null, title, body = '', link = null, dedupeKey = null, actorId = null, refresh = false } = {}) {
  try {
    if (!userId || !NOTIFY_KINDS.includes(kind) || (actorId && actorId === userId)) return false
    const u = await db.query('SELECT is_demo FROM users WHERE id = $1', [userId])
    if (!u.rows[0] || u.rows[0].is_demo) return false
    const group = GROUP_OF[kind]
    if (group && (await offGroups(db, userId)).has(group)) return false
    const t = cut(title, NOTIFY_LIMITS.title), b = cut(body, NOTIFY_LIMITS.body), l = link ? JSON.stringify(link).slice(0, 400) : null, now = iso(Date.now())
    if (!t) return false
    const key = dedupeKey ? String(dedupeKey).slice(0, 120) : null
    if (key) {
      const old = await db.query('SELECT id FROM notifications WHERE user_id = $1 AND dedupe_key = $2', [userId, key])
      if (old.rows[0]) {
        if (!refresh) return false
        await db.query('UPDATE notifications SET title = $1, body = $2, link = $3, created_at = $4, read_at = NULL WHERE id = $5', [t, b, l, now, old.rows[0].id])
        return true
      }
    }
    await db.query('INSERT INTO notifications (id, user_id, kind, dog_id, title, body, link, created_at, dedupe_key) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [newId(), userId, kind, dogId, t, b, l, now, key])
    return true
  } catch (e) {
    // Two requests racing on the same key: the other one wrote the row.
    if (!(e && (e.code === '23505' || /unique|duplicate/i.test(e.message || '')))) console.error('notify:', e && e.message)
    return false
  }
}
// The owner and family of a dog: the people who get told about things that happen to it.
export async function dogPeople(db, dogId, roles = ['owner', 'family']) {
  try {
    const { rows } = await db.query(`SELECT m.user_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.dog_id = $1 AND m.role IN (${roles.map((_, i) => `$${i + 2}`).join(', ')}) AND u.is_demo = FALSE`, [dogId, ...roles])
    return rows.map((r) => r.user_id)
  } catch (e) { console.error('notify:', e && e.message); return [] }
}
export async function notifyDogPeople(db, dogId, n, extra = []) {
  const ids = new Set([...(await dogPeople(db, dogId)), ...extra.filter(Boolean)])
  let sent = 0
  for (const id of ids) if (await notify(db, id, { dogId, ...n })) sent++
  return sent
}

export function registerNotifications(kit) {
  const { api, db, auth, HttpError, bad, object, num } = kit
  kit.notify = (userId, n) => notify(db, userId, n)
  kit.notifyDogPeople = (dogId, n, extra) => notifyDogPeople(db, dogId, n, extra)
  kit.dogPeople = (dogId, roles) => dogPeople(db, dogId, roles)
  kit.welcome = (userId) => notify(db, userId, { kind: 'welcome', dedupeKey: 'welcome', title: 'Welcome to Trot', body: 'Three good next steps: record a first walk, invite someone who helps with your dog, and find a dog friend nearby.', link: { to: 'today' } })

  // Reminders are not scheduled anywhere. They are written when the person next looks: a license or rabies
  // date that has passed or is 30 days or fewer away, and an event one of their dogs is going to in the next 3 days.
  // Each is keyed by its own date, so it is written once, and a changed date makes a new one.
  async function lazyReminders(userId, tz) {
    try {
      if ((await offGroups(db, userId)).has('reminders')) return
      const today = dayString(Date.now(), tz)
      const { rows } = await db.query("SELECT d.id, d.slug, d.name, r.license_expires_on, r.rabies_due_on FROM memberships m JOIN dogs d ON d.id = m.dog_id LEFT JOIN dog_registrations r ON r.dog_id = d.id WHERE m.user_id = $1 AND m.role IN ('owner', 'family')", [userId])
      for (const d of rows) {
        for (const [item, on, words] of [['license', d.license_expires_on, ['license expired on', 'license expires on']], ['rabies', d.rabies_due_on, ['rabies vaccine was due on', 'rabies vaccine is due on']]]) {
          const st = dateStatus(on, today)
          if (st !== 'expired' && st !== 'expiring') continue
          await notify(db, userId, { kind: 'registration_due', dogId: d.id, dedupeKey: `reg:${d.id}:${item}:${on}`, title: `${d.name}'s ${st === 'expired' ? words[0] : words[1]} ${on}`, body: st === 'expired' ? 'Update the date in Registration and ID once it is renewed.' : 'Renew it, then update the date in Registration and ID.', link: { to: 'registration', dog: d.slug } })
        }
      }
      if (!rows.length) return
      const until = dayString(Date.now() + NOTIFY_LIMITS.eventDays * DAY, tz)
      const ids = rows.map((d) => d.id), byId = Object.fromEntries(rows.map((d) => [d.id, d]))
      const ev = await db.query(`SELECT e.id, e.name, e.starts_on, e.venue, x.dog_id FROM event_entries x JOIN events e ON e.id = x.event_id WHERE x.status IN ('going', 'entered') AND e.starts_on >= $1 AND e.starts_on <= $2 AND x.dog_id IN (${ids.map((_, i) => `$${i + 3}`).join(', ')})`, [today, until, ...ids])
      for (const e of ev.rows) {
        const d = byId[e.dog_id]
        await notify(db, userId, { kind: 'event_reminder', dogId: d.id, dedupeKey: `event:${e.id}:${d.id}:${e.starts_on}`, title: `${e.name} is ${e.starts_on === today ? 'today' : `on ${e.starts_on}`}`, body: `${d.name} is marked as going${e.venue ? `. ${e.venue}` : ''}`, link: { to: 'events', dog: d.slug } })
      }
    } catch (e) { console.error('notify:', e && e.message) }
  }
  const unreadCount = async (userId) => num((await db.query('SELECT COUNT(*) AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [userId])).rows[0].n)
  // For GET /api/me, so the bell shows a number without a second request. Never fails the caller.
  kit.unreadFor = async (userId, tz) => { try { await lazyReminders(userId, tzOf(tz)); return await unreadCount(userId) } catch (e) { return 0 } }

  const out = (r, dogs, follows) => {
    const link = r.link ? parse(r.link, null) : null
    const d = r.dog_id ? dogs[r.dog_id] : null
    const item = { id: r.id, kind: r.kind, title: r.title, body: r.body, link, dog: d ? { slug: d.slug, name: d.name } : null, createdAt: iso(r.created_at), read: !!r.read_at, priority: r.kind === 'found_report' ? 'high' : 'normal' }
    // "Add back": offered while this person's dog does not follow the dog that added it.
    if (r.kind === 'friend_added' && link && link.dog && link.other) item.action = { type: 'add_back', dog: link.dog, other: link.other, otherName: link.otherName || '', done: follows.has(`${link.dog}>${link.other}`) }
    return item
  }
  api.get('/notifications', auth, async (req, res) => {
    let limit = NOTIFY_LIMITS.page
    if (req.query.limit !== undefined) { limit = Number(req.query.limit); if (!Number.isInteger(limit) || limit < 1 || limit > NOTIFY_LIMITS.maxPage) throw bad(`limit must be a whole number from 1 to ${NOTIFY_LIMITS.maxPage}.`) }
    let before = null
    if (req.query.before !== undefined && req.query.before !== '') {
      const t = new Date(String(req.query.before).slice(0, 40)).getTime()
      if (Number.isNaN(t)) throw bad('before must be an ISO date.')
      before = iso(t)
    }
    await lazyReminders(req.user.id, tzOf(req.query.tz))
    await db.query('DELETE FROM notifications WHERE user_id = $1 AND read_at IS NOT NULL AND created_at < $2', [req.user.id, iso(Date.now() - NOTIFY_LIMITS.keepReadDays * DAY)])
    const { rows } = before
      ? await db.query('SELECT id, kind, dog_id, title, body, link, created_at, read_at FROM notifications WHERE user_id = $1 AND created_at < $2 ORDER BY created_at DESC, id DESC LIMIT $3', [req.user.id, before, limit + 1])
      : await db.query('SELECT id, kind, dog_id, title, body, link, created_at, read_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2', [req.user.id, limit + 1])
    const page = rows.slice(0, limit)
    // Only dogs this person is on the team of are named, and only their own dogs' follows are looked at.
    const mine = await db.query('SELECT d.id, d.slug, d.name FROM memberships m JOIN dogs d ON d.id = m.dog_id WHERE m.user_id = $1', [req.user.id])
    const dogs = Object.fromEntries(mine.rows.map((d) => [d.id, d])), follows = new Set()
    if (mine.rows.length && page.some((r) => r.kind === 'friend_added')) {
      const f = await db.query(`SELECT a.slug AS a, b.slug AS b FROM dog_follows f JOIN dogs a ON a.id = f.follower_dog_id JOIN dogs b ON b.id = f.followed_dog_id WHERE f.follower_dog_id IN (${mine.rows.map((_, i) => `$${i + 1}`).join(', ')})`, mine.rows.map((d) => d.id))
      f.rows.forEach((r) => follows.add(`${r.a}>${r.b}`))
    }
    res.json({ items: page.map((r) => out(r, dogs, follows)), unread: await unreadCount(req.user.id), nextBefore: rows.length > limit ? iso(page[page.length - 1].created_at) : null })
  })
  api.post('/notifications/read', auth, async (req, res) => {
    const b = object(req.body), now = iso(Date.now())
    if (b.all === true) await db.query('UPDATE notifications SET read_at = $1 WHERE user_id = $2 AND read_at IS NULL', [now, req.user.id])
    else {
      if (!Array.isArray(b.ids) || !b.ids.length || b.ids.length > 100 || b.ids.some((id) => typeof id !== 'string' || !ID_RE.test(id))) throw bad('Send { ids: [...] } with up to 100 notification ids, or { all: true }.')
      // The user id is part of the match, so nobody can mark someone else's rows.
      await db.query(`UPDATE notifications SET read_at = $1 WHERE user_id = $2 AND read_at IS NULL AND id IN (${b.ids.map((_, i) => `$${i + 3}`).join(', ')})`, [now, req.user.id, ...b.ids])
    }
    res.json({ ok: true, unread: await unreadCount(req.user.id) })
  })
  // The badge's number on its own, for the once-a-minute refresh.
  api.get('/notifications/unread', auth, async (req, res) => res.json({ unread: await kit.unreadFor(req.user.id, req.query.tz) }))
  // Registered ahead of /notifications/:id so "prefs" is never read as an id.
  const prefsOut = (off) => ({ prefs: Object.fromEntries(Object.keys(NOTIFY_GROUPS).map((g) => [g, !off.has(g)])), always: ['found_report'], channels: { inApp: true, push: false, email: false, text: false } })
  api.get('/notifications/prefs', auth, async (req, res) => res.json(prefsOut(await offGroups(db, req.user.id))))
  api.put('/notifications/prefs', auth, async (req, res) => {
    const b = object(req.body), off = await offGroups(db, req.user.id)
    let changed = false
    for (const g of Object.keys(NOTIFY_GROUPS)) {
      if (b[g] === undefined) continue
      if (typeof b[g] !== 'boolean') throw bad(`${g} must be true or false.`)
      if (b[g]) off.delete(g); else off.add(g)
      changed = true
    }
    if (!changed) throw bad(`Nothing to change. Send any of: ${Object.keys(NOTIFY_GROUPS).join(', ')}.`)
    const now = iso(Date.now()), val = JSON.stringify([...off])
    const u = await db.query('UPDATE notification_prefs SET off = $1, updated_at = $2 WHERE user_id = $3 RETURNING user_id', [val, now, req.user.id])
    if (!u.rows[0]) { try { await db.query('INSERT INTO notification_prefs (user_id, off, updated_at) VALUES ($1, $2, $3)', [req.user.id, val, now]) } catch (e) { if (!kit.isUnique(e)) throw e; await db.query('UPDATE notification_prefs SET off = $1, updated_at = $2 WHERE user_id = $3', [val, now, req.user.id]) } }
    res.json(prefsOut(off))
  })
  api.delete('/notifications/:id', auth, async (req, res) => {
    const d = ID_RE.test(req.params.id) ? await db.query('DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.user.id]) : { rows: [] }
    if (!d.rows[0]) throw new HttpError(404, 'No such notification.')
    res.json({ ok: true, unread: await unreadCount(req.user.id) })
  })
}
