// Photos on outings. Registered from app.js with the shared `kit`.
//
// A web app cannot browse the phone's photo library. The person opens the system photo picker and
// chooses what to add; the browser then shrinks each picture to at most 1600 px and re-encodes it as
// a JPEG before it is sent (src/photo.js). That re-encode draws the pixels onto a canvas, so the EXIF
// block of the original, including any embedded GPS position, is never uploaded. Nothing is stripped
// here: the server only validates what arrives (type, size, real JPEG bytes, count) and stores it.
export const WALK_PHOTO_LIMITS = { perWalk: 6, bytes: 700 * 1024, body: '1000kb', maxSide: 4096 }
const PREFIX = 'data:image/jpeg;base64,'

// Width and height from a JPEG's frame header. null when the bytes do not hold one.
export function jpegSize(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null
  let i = 2
  while (i + 8 < buf.length) {
    if (buf[i] !== 0xff) return null
    while (buf[i] === 0xff && i < buf.length - 1) i++
    const m = buf[i]
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i++; continue }
    if (m === 0xda || m === 0xd9 || i + 2 >= buf.length) return null
    const len = buf.readUInt16BE(i + 1)
    if (len < 2) return null
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (i + 7 >= buf.length) return null
      const height = buf.readUInt16BE(i + 4), width = buf.readUInt16BE(i + 6)
      return width > 0 && height > 0 ? { width, height } : null
    }
    i += 1 + len
  }
  return null
}

export function registerPhotos(kit) {
  const { api, db, auth, HttpError, bad, object, sha, newId, iso, num, walkFor, walkPhotoUrl, ID_RE, sniff } = kit
  const kb = Math.round(WALK_PHOTO_LIMITS.bytes / 1024)
  const NO_PHOTO = 'No such photo.'
  const count = async (walkId) => num((await db.query('SELECT COUNT(*) AS n FROM walk_photos WHERE walk_id = $1', [walkId])).rows[0].n)

  // Anyone on the dog's care team can add photos to one of its outings. Everyone else gets the walk's own 404.
  api.post('/walks/:id/photos', auth, async (req, res) => {
    const w = await walkFor(req.params.id, req.user.id)
    const v = object(req.body).photo
    if (typeof v !== 'string') throw bad('Send the photo as a JPEG data URL in "photo".')
    if (!v.startsWith(PREFIX)) throw bad('Outing photos must be JPEG images. The app converts a picked photo to JPEG before sending it.')
    const b64 = v.slice(PREFIX.length)
    const tooBig = new HttpError(413, `A photo can be at most ${kb} KB after it is shrunk.`)
    if (b64.length > Math.ceil(WALK_PHOTO_LIMITS.bytes / 3) * 4) throw tooBig
    if (!b64.length || b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw bad('That photo did not arrive whole. Try again.')
    const buf = Buffer.from(b64, 'base64')
    if (buf.length > WALK_PHOTO_LIMITS.bytes) throw tooBig
    // The first bytes have to be a real JPEG, whatever the data URL says.
    const size = sniff(buf) === 'image/jpeg' ? jpegSize(buf) : null
    if (!size) throw bad('That file is not a real JPEG image.')
    if (size.width > WALK_PHOTO_LIMITS.maxSide || size.height > WALK_PHOTO_LIMITS.maxSide) throw bad(`A photo can be at most ${WALK_PHOTO_LIMITS.maxSide} pixels on a side.`)
    const full = bad(`An outing can have up to ${WALK_PHOTO_LIMITS.perWalk} photos. Delete one to add another.`)
    if ((await count(w.id)) >= WALK_PHOTO_LIMITS.perWalk) throw full
    const id = newId(), hash = sha(buf).slice(0, 16)
    await db.query('INSERT INTO walk_photos (id, walk_id, added_by, created_at, width, height, bytes, data, hash) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [id, w.id, req.user.id, iso(Date.now()), size.width, size.height, buf.length, buf.toString('base64'), hash])
    // Two uploads racing for the last place: the one that finds itself over the cap steps back.
    const n = await count(w.id)
    if (n > WALK_PHOTO_LIMITS.perWalk) { await db.query('DELETE FROM walk_photos WHERE id = $1', [id]); throw full }
    res.status(201).json({ photo: { id, url: walkPhotoUrl(w.id, id, hash, false), w: size.width, h: size.height, mine: true }, count: n, max: WALK_PHOTO_LIMITS.perWalk })
  })

  // Served as image bytes, never inside JSON. The ETag is the content hash. On the public address a copy
  // fetched with the matching ?v= can be kept for a week, and without it only briefly. The signed-in address
  // stays short-lived and private, like a dog's own photo, so a shared browser does not keep it around.
  const send = (req, res, row, scope) => {
    const etag = `"${row.hash}"`
    const keep = scope === 'public' && req.query.v === row.hash ? '604800, immutable' : '300'
    if (scope === 'private') res.set('Vary', 'Authorization')
    res.set('ETag', etag).set('Cache-Control', `${scope}, max-age=${keep}`).set('Content-Security-Policy', "default-src 'none'; sandbox")
    if (req.get('if-none-match') === etag) return res.status(304).end()
    res.type('image/jpeg').send(Buffer.from(row.data, 'base64'))
  }
  // Same rule as the outing itself: the care team only.
  api.get('/walks/:id/photos/:photoId', auth, async (req, res) => {
    const w = await walkFor(req.params.id, req.user.id)
    const { rows } = ID_RE.test(req.params.photoId) ? await db.query('SELECT data, hash FROM walk_photos WHERE id = $1 AND walk_id = $2', [req.params.photoId, w.id]) : { rows: [] }
    if (!rows[0]) throw new HttpError(404, NO_PHOTO)
    send(req, res, rows[0], 'private')
  })
  // No sign-in, for the public page and the feeds of other people's dogs. Public dogs only: a private
  // dog's photo answers exactly like one that does not exist.
  api.get('/public/walks/:id/photos/:photoId', async (req, res) => {
    const ok = ID_RE.test(req.params.id) && ID_RE.test(req.params.photoId)
    const { rows } = ok ? await db.query('SELECT p.data, p.hash FROM walk_photos p JOIN walks w ON w.id = p.walk_id JOIN dogs d ON d.id = w.dog_id WHERE p.id = $1 AND p.walk_id = $2 AND d.is_public = TRUE', [req.params.photoId, req.params.id]) : { rows: [] }
    if (!rows[0]) throw new HttpError(404, NO_PHOTO)
    send(req, res, rows[0], 'public')
  })
  // The person who added a photo can delete it, and so can the dog's owner and family.
  api.delete('/walks/:id/photos/:photoId', auth, async (req, res) => {
    const w = await walkFor(req.params.id, req.user.id)
    const { rows } = ID_RE.test(req.params.photoId) ? await db.query('SELECT id, added_by FROM walk_photos WHERE id = $1 AND walk_id = $2', [req.params.photoId, w.id]) : { rows: [] }
    if (!rows[0]) throw new HttpError(404, NO_PHOTO)
    if (rows[0].added_by !== req.user.id) {
      const m = await db.query('SELECT role FROM memberships WHERE dog_id = $1 AND user_id = $2', [w.dog_id, req.user.id])
      if (!m.rows[0] || !['owner', 'family'].includes(m.rows[0].role)) throw new HttpError(403, 'Only the person who added this photo, or the dog\'s owner or family, can delete it.')
    }
    await db.query('DELETE FROM walk_photos WHERE id = $1', [rows[0].id])
    res.json({ ok: true, count: await count(w.id) })
  })
}
