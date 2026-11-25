// Registration and ID records, the Trot Tag (an NFC sticker or QR code that opens /t/:code),
// tag scans, found reports and Lost Dog mode. Registered from app.js with the shared `kit`.
//
// Privacy rules this file keeps:
// - Registration fields (microchip, licence, rabies tag, AKC number) are read only by the care team.
//   They live in their own table and no public page or public endpoint ever selects from it.
// - The tag page shows a dog's name, photo and breed. No person, no contact details, no city, no walks.
// - No IP address is stored. Repeat views are folded with an in-memory salted hash that dies with the process.
// - Trot files nothing with a county or a microchip registry. It stores what the owner types and links out.
import crypto from 'node:crypto'
import express from 'express'
import { dayString, tzOf } from './routesHealth.js'
import { renderTagPage, renderTagGone, renderTagNote, TAG_SCRIPT_HASH, TAG_LIMITS } from './tagPage.js'

export const REG_LIMITS = { registry: 60, jurisdiction: 60, licenseNumber: 40, rabiesTag: 40, akc: 20, lostNote: 140, tagLabel: 40, activeTags: 10, tagsPerDog: 50, scansListed: 100, scanDays: 180 }
export const ALTERED = ['yes', 'no', 'unknown']
export const CHARLOTTE = 'Charlotte-Mecklenburg'
export const REG_LINKS = {
  aaha: 'https://www.aaha.org/for-veterinary--professionals/microchip-registry-lookup-tool-aaha-find-your-pets-microchip-registry/',
  petdata: 'https://www.petdata.com/for-pet-owners/chr/license-requirements',
  cmpd: 'https://www.charlottenc.gov/Animal-Care-and-Control/services/Pet-License',
}
// 32 symbols, 5 bits each. No 0, 1, I or O, so a code read aloud or copied by hand stays unambiguous.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const CODE_LEN = 12
const CODE_RE = /^[2-9A-HJ-NP-Z]{12}$/
export function newTagCode() {
  const b = crypto.randomBytes(CODE_LEN)
  let s = ''
  for (let i = 0; i < CODE_LEN; i++) s += ALPHABET[b[i] & 31]
  return s
}
const DAY = 864e5
const dayNumber = (s) => Math.round(Date.parse(s + 'T00:00:00Z') / DAY)
const inCharlotte = (city) => /charlotte|mint hill|pineville|mecklenburg/i.test(String(city || ''))

// A chip number is 15 digits (ISO), 10 characters of 0-9 and A-F, or 9 digits. Spaces, dashes,
// dots and asterisks that paperwork prints between groups are dropped before it is checked and stored.
export function cleanMicrochip(v) {
  const s = String(v == null ? '' : v).replace(/[\s\-.*]/g, '').toUpperCase()
  if (!s) return ''
  return /^\d{15}$/.test(s) || /^[0-9A-F]{10}$/.test(s) || /^\d{9}$/.test(s) ? s : null
}
// done, missing, expiring (30 days or fewer left) or expired, for one date-driven item.
export function dateStatus(on, today) {
  if (!on) return null
  const left = dayNumber(on) - dayNumber(today)
  return left < 0 ? 'expired' : left <= 30 ? 'expiring' : 'done'
}
export function checklist(r, today) {
  const item = (key, label, has, on, words) => {
    const st = dateStatus(on, today)
    const status = st || (has ? 'done' : 'missing')
    const detail = st === 'expired' ? `${words[0]} ${on}` : st === 'expiring' ? `${words[1]} ${on}` : st === 'done' ? `${words[2]} ${on}` : has ? words[3] : words[4]
    return { key, label, status, detail, on: on || null }
  }
  return [
    { key: 'microchip', label: 'Microchip', status: r.microchipNumber ? 'done' : 'missing', detail: r.microchipNumber ? (r.microchipRegistry ? `Number saved. Registry: ${r.microchipRegistry}` : 'Number saved. Add the registry that holds it.') : 'No chip number saved', on: null },
    item('license', 'License', !!r.licenseNumber, r.licenseExpiresOn, ['Expired on', 'Expires on', 'Current until', 'Number saved. Add the date it expires.', 'No license saved']),
    item('rabies', 'Rabies vaccine', !!r.rabiesTag, r.rabiesDueOn, ['Was due on', 'Due on', 'Next due on', 'Tag number saved. Add the date the next vaccine is due.', 'No rabies tag or due date saved']),
  ]
}
// Only the family of the device and browser is kept, never the full user agent string.
export function agentFamily(ua) {
  const s = String(ua || '').slice(0, 400)
  if (/bot|crawl|spider|preview|facebookexternalhit|slack|whatsapp|telegram|curl|wget|python|headless/i.test(s)) return 'bot'
  const os = /iPhone|iPad|iPod/.test(s) ? 'iPhone or iPad' : /Android/.test(s) ? 'Android' : /Windows/.test(s) ? 'Windows' : /Macintosh|Mac OS X/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : ''
  const br = /Edg\//.test(s) ? 'Edge' : /Firefox\/|FxiOS/.test(s) ? 'Firefox' : /Chrome\/|CriOS/.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : ''
  return [br, os].filter(Boolean).join(' on ') || 'Unknown device'
}

export function registerRegistration(kit) {
  const { api, app, db, auth, dogFor, HttpError, bad, text, bool, object, sha, newId, iso, num, round, firstName, origin, ID_RE, limiter, readLimit, R, isUnique } = kit
  const canEdit = (role) => role === 'owner' || role === 'family'
  const editor = (role) => { if (!canEdit(role)) throw new HttpError(403, 'Only the owner and family can change this.') }
  const day = (v, label) => {
    if (v == null || v === '') return null
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw bad(`${label} must look like 2027-05-30.`)
    const d = new Date(v + 'T00:00:00Z')
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw bad(`${label} is not a real date.`)
    if (v < '2000-01-01' || v > '2100-01-01') throw bad(`${label} is not a date that makes sense here.`)
    return v
  }

  // ---- registration record ----------------------------------------------------
  const REG_COLS = ['microchip_number', 'microchip_registry', 'license_jurisdiction', 'license_number', 'license_expires_on', 'rabies_tag', 'rabies_due_on', 'akc_number', 'altered']
  const regOut = (r, dog) => ({
    microchipNumber: (r && r.microchip_number) || '', microchipRegistry: (r && r.microchip_registry) || '',
    // Nothing is stored until someone saves. Until then a Charlotte dog is offered its own jurisdiction.
    licenseJurisdiction: r ? r.license_jurisdiction : inCharlotte(dog.city) ? CHARLOTTE : '',
    licenseNumber: (r && r.license_number) || '', licenseExpiresOn: (r && r.license_expires_on) || null,
    rabiesTag: (r && r.rabies_tag) || '', rabiesDueOn: (r && r.rabies_due_on) || null,
    akcNumber: (r && r.akc_number) || '', altered: r && ALTERED.includes(r.altered) ? r.altered : 'unknown',
    updatedAt: r ? iso(r.updated_at) : null,
  })
  const regRow = async (dogId) => (await db.query(`SELECT ${REG_COLS.join(', ')}, updated_at FROM dog_registrations WHERE dog_id = $1`, [dogId])).rows[0] || null
  const regAnswer = (row, dog, role, req) => {
    const registration = regOut(row, dog)
    return { registration, checklist: checklist(registration, dayString(Date.now(), tzOf(req.query.tz))), canEdit: canEdit(role), charlotte: registration.licenseJurisdiction === CHARLOTTE, links: REG_LINKS }
  }
  api.get('/dogs/:slug/registration', auth, async (req, res) => {
    const { dog, role } = await dogFor(req.params.slug, req.user.id)
    res.json(regAnswer(await regRow(dog.id), dog, role, req))
  })
  // Fields that are left out keep their value. An empty string or null clears one.
  api.put('/dogs/:slug/registration', auth, async (req, res) => {
    const { dog, role } = await dogFor(req.params.slug, req.user.id)
    editor(role)
    const b = object(req.body)
    const f = {}
    if (b.microchipNumber !== undefined) {
      if (b.microchipNumber !== null && typeof b.microchipNumber !== 'string') throw bad('Microchip number must be text.')
      const chip = cleanMicrochip(b.microchipNumber)
      if (chip === null) throw bad('A microchip number is 15 digits, 10 characters (digits and the letters A to F), or 9 digits. Check it against the paperwork from your vet or shelter.')
      f.microchip_number = chip
    }
    if (b.microchipRegistry !== undefined) f.microchip_registry = text(b.microchipRegistry, 'Microchip registry', { max: REG_LIMITS.registry })
    if (b.licenseJurisdiction !== undefined) f.license_jurisdiction = text(b.licenseJurisdiction, 'License jurisdiction', { max: REG_LIMITS.jurisdiction })
    if (b.licenseNumber !== undefined) f.license_number = text(b.licenseNumber, 'License number', { max: REG_LIMITS.licenseNumber })
    if (b.licenseExpiresOn !== undefined) f.license_expires_on = day(b.licenseExpiresOn, 'License expiry date')
    if (b.rabiesTag !== undefined) f.rabies_tag = text(b.rabiesTag, 'Rabies tag number', { max: REG_LIMITS.rabiesTag })
    if (b.rabiesDueOn !== undefined) f.rabies_due_on = day(b.rabiesDueOn, 'Rabies vaccine due date')
    if (b.akcNumber !== undefined) {
      f.akc_number = text(b.akcNumber, 'AKC registration number', { max: REG_LIMITS.akc }).toUpperCase()
      if (f.akc_number && !/^[A-Z0-9][A-Z0-9 -]*$/.test(f.akc_number)) throw bad('An AKC registration number is letters and digits, such as SS12345601.')
    }
    if (b.altered !== undefined) { if (!ALTERED.includes(b.altered)) throw bad(`Spayed or neutered must be one of: ${ALTERED.join(', ')}.`); f.altered = b.altered }
    const cols = REG_COLS.filter((c) => f[c] !== undefined)
    if (!cols.length) throw bad('Nothing to change.')
    const now = iso(Date.now())
    const existing = await regRow(dog.id)
    if (!existing) {
      // First save. The jurisdiction offered on screen is stored unless the request said otherwise.
      const first = { microchip_number: '', microchip_registry: '', license_jurisdiction: inCharlotte(dog.city) ? CHARLOTTE : '', license_number: '', license_expires_on: null, rabies_tag: '', rabies_due_on: null, akc_number: '', altered: 'unknown', ...f }
      try {
        await db.query(`INSERT INTO dog_registrations (dog_id, ${REG_COLS.join(', ')}, updated_by, updated_at) VALUES ($1, ${REG_COLS.map((_, i) => `$${i + 2}`).join(', ')}, $${REG_COLS.length + 2}, $${REG_COLS.length + 3})`, [dog.id, ...REG_COLS.map((c) => first[c]), req.user.id, now])
      } catch (e) { if (!isUnique(e)) throw e }
    }
    // Column names come from the fixed list above, never from the request.
    await db.query(`UPDATE dog_registrations SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')}, updated_by = $${cols.length + 1}, updated_at = $${cols.length + 2} WHERE dog_id = $${cols.length + 3}`, [...cols.map((c) => f[c]), req.user.id, now, dog.id])
    res.json(regAnswer(await regRow(dog.id), dog, role, req))
  })

  // ---- Lost Dog mode ------------------------------------------------------------
  const lostRow = async (dogId) => (await db.query('SELECT lost_since, lost_note FROM dogs WHERE id = $1', [dogId])).rows[0] || {}
  const lostOut = (r) => ({ on: !!r.lost_since, since: r.lost_since ? iso(r.lost_since) : null, note: r.lost_since ? r.lost_note || '' : '' })
  const TAG_COLS = 'id, dog_id, code, label, kind, active, created_at, retired_at'
  const tagOut = (t, req) => ({ id: t.id, code: t.code, label: t.label, kind: t.kind === 'link' ? 'link' : 'tag', active: !!t.active, path: `/t/${t.code}`, url: `${origin(req)}/t/${t.code}`, createdAt: iso(t.created_at), retiredAt: t.retired_at ? iso(t.retired_at) : null })
  async function createTag(dogId, userId, label, kind) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = newId()
      try {
        await db.query('INSERT INTO dog_tags (id, dog_id, code, label, kind, active, created_by, created_at) VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7)', [id, dogId, newTagCode(), label, kind, userId, iso(Date.now())])
        return (await db.query(`SELECT ${TAG_COLS} FROM dog_tags WHERE id = $1`, [id])).rows[0]
      } catch (e) { if (!isUnique(e)) throw e }
    }
    throw new HttpError(503, 'Could not make a tag code. Try again.')
  }
  api.get('/dogs/:slug/lost', auth, async (req, res) => {
    const { dog, role } = await dogFor(req.params.slug, req.user.id)
    res.json({ lost: lostOut(await lostRow(dog.id)), canEdit: canEdit(role) })
  })
  api.put('/dogs/:slug/lost', auth, async (req, res) => {
    const { dog, role } = await dogFor(req.params.slug, req.user.id)
    editor(role)
    const b = object(req.body)
    const on = bool(b.lost, 'lost')
    const note = on ? text(b.note, 'Note', { max: REG_LIMITS.lostNote }) : ''
    const cur = await lostRow(dog.id)
    // Turning it on twice keeps the first time. Turning it off clears the note.
    await db.query('UPDATE dogs SET lost_since = $1, lost_note = $2 WHERE id = $3', [on ? (cur.lost_since ? iso(cur.lost_since) : iso(Date.now())) : null, note, dog.id])
    if (on) {
      // The public page needs somewhere to send a finder even when no collar tag was ever made.
      const t = await db.query("SELECT id FROM dog_tags WHERE dog_id = $1 AND active = TRUE AND kind = 'link'", [dog.id])
      if (!t.rows[0]) await createTag(dog.id, req.user.id, 'Link on the public page', 'link')
    }
    res.json({ lost: lostOut(await lostRow(dog.id)), canEdit: true })
  })
  // For /d/:slug. Null unless the dog is public and reported lost. Carries no person and no contact details.
  kit.publicLost = async (slug) => {
    const { rows } = await db.query('SELECT id, lost_since, lost_note FROM dogs WHERE slug = $1 AND is_public = TRUE', [slug])
    if (!rows[0] || !rows[0].lost_since) return null
    const t = await db.query('SELECT code, kind FROM dog_tags WHERE dog_id = $1 AND active = TRUE ORDER BY created_at ASC', [rows[0].id])
    const pick = t.rows.find((x) => x.kind === 'link') || t.rows[0]
    return { since: iso(rows[0].lost_since), note: rows[0].lost_note || '', foundPath: pick ? `/t/${pick.code}` : null }
  }

  // ---- tags ---------------------------------------------------------------------
  api.get('/dogs/:slug/tags', auth, async (req, res) => {
    const { dog, role } = await dogFor(req.params.slug, req.user.id)
    editor(role)
    const { rows } = await db.query(`SELECT ${TAG_COLS} FROM dog_tags WHERE dog_id = $1 ORDER BY created_at DESC LIMIT ${REG_LIMITS.tagsPerDog}`, [dog.id])
    // Working tags first, then retired ones, newest first within each.
    res.json({ tags: [...rows.filter((t) => t.active), ...rows.filter((t) => !t.active)].map((t) => tagOut(t, req)) })
  })
  api.post('/dogs/:slug/tags', auth, async (req, res) => {
    const { dog, role } = await dogFor(req.params.slug, req.user.id)
    editor(role)
    const b = req.body == null ? {} : object(req.body)
    const label = text(b.label, 'Label', { max: REG_LIMITS.tagLabel }) || 'Collar tag'
    const all = await db.query('SELECT active FROM dog_tags WHERE dog_id = $1', [dog.id])
    const n = { rows: [{ n: all.rows.length, live: all.rows.filter((t) => t.active).length }] }
    if (num(n.rows[0].live) >= REG_LIMITS.activeTags) throw bad(`A dog can have up to ${REG_LIMITS.activeTags} working tags. Retire one first.`)
    if (num(n.rows[0].n) >= REG_LIMITS.tagsPerDog) throw bad('This dog has had too many tags for this trial.')
    res.status(201).json({ tag: tagOut(await createTag(dog.id, req.user.id, label, 'tag'), req) })
  })
  // Retiring keeps the row and its scan history. The code stops working at once and is never reused.
  api.delete('/dogs/:slug/tags/:id', auth, async (req, res) => {
    const { dog, role } = await dogFor(req.params.slug, req.user.id)
    editor(role)
    const u = ID_RE.test(req.params.id) ? await db.query('UPDATE dog_tags SET active = FALSE, retired_at = $1 WHERE id = $2 AND dog_id = $3 AND active = TRUE RETURNING id', [iso(Date.now()), req.params.id, dog.id]) : { rows: [] }
    if (!u.rows[0]) throw new HttpError(404, 'No working tag like that.')
    res.json({ ok: true })
  })

  // ---- scans and found reports, for the care team --------------------------------
  const scanOut = (r) => ({
    id: r.id, kind: r.kind === 'found' ? 'found' : 'scan', at: iso(r.scanned_at), tagLabel: r.label || '', device: r.agent || '',
    ...(r.kind === 'found' ? { finderName: r.finder_name, message: r.message, contact: r.contact, lat: r.lat == null ? null : num(r.lat), lng: r.lng == null ? null : num(r.lng), read: !!r.read_at } : {}),
  })
  api.get('/dogs/:slug/tags/scans', auth, async (req, res) => {
    const { dog, role } = await dogFor(req.params.slug, req.user.id)
    const { rows } = await db.query(`SELECT s.id, s.kind, s.scanned_at, s.finder_name, s.message, s.contact, s.lat, s.lng, s.agent, s.read_at, t.label FROM tag_scans s JOIN dog_tags t ON t.id = s.tag_id WHERE s.dog_id = $1 ORDER BY s.scanned_at DESC, s.id DESC LIMIT ${REG_LIMITS.scansListed}`, [dog.id])
    const scans = rows.map(scanOut)
    res.json({ scans, unread: scans.filter((s) => s.kind === 'found' && !s.read).length, lost: lostOut(await lostRow(dog.id)), canEdit: canEdit(role) })
  })
  api.post('/dogs/:slug/tags/scans/:id/read', auth, async (req, res) => {
    const { dog, role } = await dogFor(req.params.slug, req.user.id)
    editor(role)
    const s = ID_RE.test(req.params.id) ? await db.query("SELECT id FROM tag_scans WHERE id = $1 AND dog_id = $2 AND kind = 'found'", [req.params.id, dog.id]) : { rows: [] }
    if (!s.rows[0]) throw new HttpError(404, 'No found report like that.')
    await db.query('UPDATE tag_scans SET read_at = $1 WHERE id = $2 AND read_at IS NULL', [iso(Date.now()), s.rows[0].id])
    res.json({ ok: true })
  })

  // ---- the public tag page --------------------------------------------------------
  const tagLimit = limiter({ windowMs: R.tagWindowMs ?? 60e3, max: R.tagMax ?? 120 })
  const foundLimit = limiter({ windowMs: R.foundWindowMs ?? 3600e3, max: R.foundMax ?? 5 })
  const foundPerTag = limiter({ windowMs: 3600e3, max: R.foundPerTagMax ?? 30 })
  const scansPerTag = limiter({ windowMs: 3600e3, max: R.scansPerTagMax ?? 120 })
  // Folds repeat views from one address into one scan for ten minutes. The address is hashed with a
  // salt that exists only in this process, kept only in memory, and never written anywhere.
  const salt = crypto.randomBytes(16).toString('hex')
  const seen = new Map()
  const FOLD_MS = 10 * 60e3
  function firstView(ip, tagId) {
    const now = Date.now(), k = sha(`${salt}|${ip}|${tagId}`)
    if (seen.size > 5000) for (const [key, t] of seen) if (now - t >= FOLD_MS) seen.delete(key)
    const t = seen.get(k)
    if (t && now - t < FOLD_MS) return false
    seen.set(k, now)
    return true
  }
  const headers = (res) => {
    res.set('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'sha256-${TAG_SCRIPT_HASH}'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`)
    res.set('X-Frame-Options', 'DENY').set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex, nofollow').set('Referrer-Policy', 'no-referrer').set('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()')
    res.type('html')
  }
  const busy = () => renderTagNote('Slow down · Trot', 'Too many tries', 'Wait a few minutes and try again.')
  // An unknown code and a retired tag take the same path and get the same answer.
  async function tagFor(code) {
    const c = String(code || '').toUpperCase()
    if (!CODE_RE.test(c)) return null
    const { rows } = await db.query('SELECT t.id, t.dog_id, t.code, d.slug, d.name, d.breed, d.is_public, d.photo_v, d.lost_since, d.lost_note FROM dog_tags t JOIN dogs d ON d.id = t.dog_id WHERE t.code = $1 AND t.active = TRUE', [c])
    return rows[0] || null
  }
  const pageDog = (t) => ({ name: t.name, breed: t.breed, photo: !!t.photo_v, publicPath: t.is_public ? `/d/${t.slug}` : null, lost: !!t.lost_since, lostNote: t.lost_since ? t.lost_note || '' : '' })
  const limitedPage = (req, res) => {
    const r = readLimit('ip:' + req.ip), r2 = tagLimit('ip:' + req.ip)
    if (r.ok && r2.ok) return false
    res.status(429).set('Retry-After', String(Math.max(r.retry, r2.retry))).send(busy())
    return true
  }
  app.get('/t/:code', async (req, res) => {
    headers(res)
    if (limitedPage(req, res)) return
    try {
      const t = await tagFor(req.params.code)
      if (!t) return res.status(404).send(renderTagGone())
      const agent = agentFamily(req.get('user-agent'))
      if (agent !== 'bot' && firstView(req.ip, t.id) && scansPerTag('tag:' + t.id).ok) {
        const now = Date.now()
        await db.query("INSERT INTO tag_scans (id, tag_id, dog_id, scanned_at, kind, agent) VALUES ($1, $2, $3, $4, 'scan', $5)", [newId(), t.id, t.dog_id, iso(now), agent])
        await db.query("DELETE FROM tag_scans WHERE dog_id = $1 AND kind = 'scan' AND scanned_at < $2", [t.dog_id, iso(now - REG_LIMITS.scanDays * DAY)])
      }
      res.send(renderTagPage({ code: t.code, dog: pageDog(t), state: { sent: req.query.sent === '1' } }))
    } catch (e) { console.error(e); res.status(500).send(renderTagGone()) }
  })
  // The photo of a dog whose tag is working, so a private dog's tag page can still show it.
  app.get('/t/:code/photo', async (req, res) => {
    headers(res)
    if (limitedPage(req, res)) return
    try {
      const t = await tagFor(req.params.code)
      const { rows } = t ? await db.query('SELECT photo FROM dogs WHERE id = $1 AND photo IS NOT NULL', [t.dog_id]) : { rows: [] }
      const m = rows[0] && /^data:(image\/(?:jpeg|png|webp));base64,/.exec(String(rows[0].photo).slice(0, 40))
      if (!m) return res.status(404).send(renderTagGone())
      res.set('Content-Security-Policy', "default-src 'none'; sandbox").set('Cache-Control', 'private, max-age=300').type(m[1]).send(Buffer.from(rows[0].photo.slice(m[0].length), 'base64'))
    } catch (e) { console.error(e); res.status(500).send(renderTagGone()) }
  })

  const coord = (v, max) => {
    if (v == null || v === '') return null
    const n = typeof v === 'number' ? v : typeof v === 'string' && /^-?\d{1,3}(\.\d{1,10})?$/.test(v.trim()) ? Number(v) : NaN
    if (!Number.isFinite(n) || Math.abs(n) > max) throw bad('That location is not valid. Tap Share my location again, or send without it.')
    return round(n, 1e5)
  }
  function foundFields(b) {
    const name = firstName(text(b.name, 'Your first name', { max: TAG_LIMITS.finderName }))
    const message = text(b.message, 'Message', { max: TAG_LIMITS.message })
    const contact = text(b.contact, 'Phone or email', { max: TAG_LIMITS.contact })
    if (contact && !/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(contact) && !(/^\+?[\d\s().-]{7,24}$/.test(contact) && contact.replace(/\D/g, '').length >= 7)) throw bad('Enter a phone number or an email address, or leave that field empty.')
    const lat = coord(b.lat, 90), lng = coord(b.lng, 180)
    if ((lat == null) !== (lng == null)) throw bad('That location is not valid. Tap Share my location again, or send without it.')
    if (!message && !contact && lat == null) throw bad('Add a message, a way to reach you, or your location.')
    return { name, message, contact, lat, lng }
  }
  // The address limit is checked before any of the body is read. The body is capped at 4 KB.
  const gate = (req, res, next) => {
    headers(res)
    const r = foundLimit('ip:' + req.ip)
    if (r.ok) return next()
    res.status(429).set('Retry-After', String(r.retry))
    return req.is('application/json') ? res.type('json').send(JSON.stringify({ error: 'Too many reports from this connection. Wait a while and try again.' })) : res.send(busy())
  }
  app.post('/t/:code/found', gate, express.json({ limit: '4kb' }), express.urlencoded({ extended: false, limit: '4kb', parameterLimit: 10 }), async (req, res) => {
    const json = !!req.is('application/json')
    const say = (status, error, page) => (json ? res.status(status).type('json').send(JSON.stringify({ error })) : res.status(status).send(page))
    try {
      const t = await tagFor(req.params.code)
      if (!t) return say(404, 'This tag is not linked to a dog on Trot.', renderTagGone())
      const dog = pageDog(t)
      if (!dog.lost) return say(409, `${t.name} is not reported lost.`, renderTagPage({ code: t.code, dog }))
      const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}
      let f
      try { f = foundFields(b) } catch (e) {
        if (!(e instanceof HttpError)) throw e
        const keep = (v) => (typeof v === 'string' ? v.slice(0, 300) : '')
        return say(400, e.message, renderTagPage({ code: t.code, dog, state: { error: e.message, values: { name: keep(b.name), message: keep(b.message), contact: keep(b.contact) } } }))
      }
      const r = foundPerTag('tag:' + t.id)
      if (!r.ok) { res.set('Retry-After', String(r.retry)); return say(429, 'This tag has had a lot of reports in the last hour. Try again later.', busy()) }
      const agent = agentFamily(req.get('user-agent'))
      await db.query("INSERT INTO tag_scans (id, tag_id, dog_id, scanned_at, kind, finder_name, message, contact, lat, lng, agent) VALUES ($1, $2, $3, $4, 'found', $5, $6, $7, $8, $9, $10)",
        [newId(), t.id, t.dog_id, iso(Date.now()), f.name, f.message, f.contact, f.lat, f.lng, agent === 'bot' ? 'Unknown device' : agent])
      if (json) return res.status(201).type('json').send(JSON.stringify({ ok: true }))
      res.redirect(303, `/t/${t.code}?sent=1`)
    } catch (e) { console.error(e); say(500, 'Something went wrong on our side.', renderTagGone()) }
  })
  app.use('/t', (req, res) => { headers(res); res.status(404).send(renderTagGone()) })
  // A body over the cap or one that does not parse ends here rather than in the app's plain-text handler.
  app.use('/t', (err, req, res, next) => {
    headers(res)
    const status = err.type === 'entity.too.large' ? 413 : err.status === 400 || err instanceof SyntaxError ? 400 : 500
    if (status === 500) console.error(err)
    res.status(status).send(renderTagNote('Not sent · Trot', status === 413 ? 'That is too much text' : 'That did not work', status === 413 ? 'Shorten your message and send it again.' : 'Go back and try again.'))
  })
}
