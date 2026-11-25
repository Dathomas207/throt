// A dog's documents: vet records, certificates, registration and insurance papers.
// Members only. Never public. The bytes live in the database for this trial.
export const DOC_CATEGORIES = ['vet', 'vaccination', 'registration', 'licence', 'insurance', 'show', 'other']
export const DOC_LIMITS = { fileBytes: 5 * 1024 * 1024, dogBytes: 50 * 1024 * 1024, name: 120, notes: 500, body: '7200kb', perDog: 200 }
const TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
const DATA_RE = /^data:(application\/pdf|image\/(?:jpeg|png|webp));base64,/

// What the first bytes say the file is. The declared type has to agree.
export function sniffDocument(buf) {
  if (buf.length >= 5 && buf.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  return ''
}
// A filename that is safe inside a Content-Disposition header.
export function safeFilename(name, type) {
  const ext = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[type] || ''
  let s = String(name || '').normalize('NFKD').replace(/[^\x20-\x7E]/g, '').replace(/["\\/:*?<>|;%]/g, '').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '').slice(0, 80)
  if (!s) s = 'document'
  if (ext && !s.toLowerCase().endsWith(ext) && !(ext === '.jpg' && s.toLowerCase().endsWith('.jpeg'))) s += ext
  return s
}

export function registerDocs(kit) {
  const { api, db, auth, dogFor, memberItem, HttpError, bad, text, bool, object, newId, iso, num, firstName, ID_RE } = kit
  const mb = (n) => `${Math.round(n / 1024 / 1024)} MB`

  // Sent with every stored file. `sandbox` means an uploaded file can never run
  // script or reach cookies and storage in the app's origin, even if opened directly.
  kit.sendDocument = (res, row) => {
    const type = TYPES.includes(row.content_type) ? row.content_type : 'application/octet-stream'
    const buf = Buffer.from(row.data, 'base64')
    res.status(200).set('Content-Type', type).set('Content-Length', String(buf.length)).set('X-Content-Type-Options', 'nosniff').set('Content-Security-Policy', "default-src 'none'; sandbox")
      .set('Content-Disposition', `${type === 'application/octet-stream' ? 'attachment' : 'inline'}; filename="${safeFilename(row.name, type)}"`).set('Cache-Control', 'private, no-store').end(buf)
  }
  const META = 'c.id, c.dog_id, c.name, c.category, c.content_type, c.size_bytes, c.notes, c.in_vet_summary, c.uploaded_by, c.created_at'
  const SELECT = `SELECT ${META}, u.name AS user_name FROM documents c JOIN users u ON u.id = c.uploaded_by`
  const out = (r, userId, role) => ({
    id: r.id, name: r.name, category: r.category, contentType: r.content_type, size: num(r.size_bytes), notes: r.notes, inVetSummary: !!r.in_vet_summary,
    uploadedBy: firstName(r.user_name), createdAt: iso(r.created_at), canEdit: r.uploaded_by === userId || role === 'owner',
  })
  const used = async (dogId) => num((await db.query('SELECT COALESCE(SUM(size_bytes), 0) AS n FROM documents WHERE dog_id = $1', [dogId])).rows[0].n)

  // Metadata only. The bytes come from /documents/:id/file.
  api.get('/dogs/:slug/documents', auth, async (req, res) => {
    const { dog, role } = await dogFor(req.params.slug, req.user.id)
    const { rows } = await db.query(`${SELECT} WHERE c.dog_id = $1 ORDER BY c.created_at DESC, c.id DESC LIMIT ${DOC_LIMITS.perDog}`, [dog.id])
    res.json({ documents: rows.map((r) => out(r, req.user.id, role)), usedBytes: rows.reduce((s, r) => s + num(r.size_bytes), 0), maxBytes: DOC_LIMITS.dogBytes, maxFileBytes: DOC_LIMITS.fileBytes })
  })
  api.post('/dogs/:slug/documents', auth, async (req, res) => {
    const { dog, role } = await dogFor(req.params.slug, req.user.id)
    const b = object(req.body)
    const name = text(b.name, 'Name', { min: 1, max: DOC_LIMITS.name })
    const category = b.category === undefined ? 'other' : b.category
    if (!DOC_CATEGORIES.includes(category)) throw bad(`Category must be one of: ${DOC_CATEGORIES.join(', ')}.`)
    const notes = text(b.notes, 'Notes', { max: DOC_LIMITS.notes })
    if (typeof b.file !== 'string') throw bad('Send the file as a data URL in "file".')
    const m = DATA_RE.exec(b.file.slice(0, 60))
    if (!m) throw bad('Only PDF, JPEG, PNG and WebP files can be stored.')
    const b64 = b.file.slice(m[0].length)
    const tooBig = new HttpError(413, `A file can be at most ${mb(DOC_LIMITS.fileBytes)}.`)
    if (b64.length > Math.ceil(DOC_LIMITS.fileBytes / 3) * 4) throw tooBig
    if (!b64.length || b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw bad('That file did not arrive whole. Try again.')
    const buf = Buffer.from(b64, 'base64')
    if (buf.length > DOC_LIMITS.fileBytes) throw tooBig
    if (sniffDocument(buf) !== m[1]) throw bad('The file is not what its type says. Only real PDF, JPEG, PNG and WebP files can be stored.')
    const count = num((await db.query('SELECT COUNT(*) AS n FROM documents WHERE dog_id = $1', [dog.id])).rows[0].n)
    if (count >= DOC_LIMITS.perDog) throw bad(`A dog can have up to ${DOC_LIMITS.perDog} documents in this trial.`)
    if ((await used(dog.id)) + buf.length > DOC_LIMITS.dogBytes) throw new HttpError(413, `${dog.name}'s documents would pass the ${mb(DOC_LIMITS.dogBytes)} limit. Delete one first.`)
    const id = newId()
    await db.query('INSERT INTO documents (id, dog_id, name, category, content_type, size_bytes, data, notes, uploaded_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
      [id, dog.id, name, category, m[1], buf.length, buf.toString('base64'), notes, req.user.id, iso(Date.now())])
    const { rows } = await db.query(`${SELECT} WHERE c.id = $1`, [id])
    res.status(201).json({ document: out(rows[0], req.user.id, role) })
  })
  const docFor = (req) => memberItem('documents', 'id, dog_id, name, category, content_type, size_bytes, notes, in_vet_summary, uploaded_by', req.params.id, req.user.id, 'No such document.')
  api.get('/documents/:id/file', auth, async (req, res) => {
    const d = await docFor(req)
    const { rows } = await db.query('SELECT name, content_type, data FROM documents WHERE id = $1', [d.id])
    if (!rows[0]) throw new HttpError(404, 'No such document.')
    kit.sendDocument(res, rows[0])
  })
  const canChange = (d, req) => { if (d.uploaded_by !== req.user.id && d.role !== 'owner') throw new HttpError(403, 'Only the person who uploaded this document or the dog\'s owner can change it.') }
  api.patch('/documents/:id', auth, async (req, res) => {
    const d = await docFor(req)
    canChange(d, req)
    const b = object(req.body)
    const f = {}
    if (b.name !== undefined) f.name = text(b.name, 'Name', { min: 1, max: DOC_LIMITS.name })
    if (b.category !== undefined) { if (!DOC_CATEGORIES.includes(b.category)) throw bad(`Category must be one of: ${DOC_CATEGORIES.join(', ')}.`); f.category = b.category }
    if (b.notes !== undefined) f.notes = text(b.notes, 'Notes', { max: DOC_LIMITS.notes })
    if (b.inVetSummary !== undefined) {
      // Only the owner decides what a vet link shows.
      if (d.role !== 'owner') throw new HttpError(403, 'Only the owner can add a document to the vet summary.')
      f.in_vet_summary = bool(b.inVetSummary, 'inVetSummary')
    }
    const cols = ['name', 'category', 'notes', 'in_vet_summary'].filter((c) => f[c] !== undefined)
    if (!cols.length) throw bad('Nothing to change.')
    await db.query(`UPDATE documents SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')} WHERE id = $${cols.length + 1}`, [...cols.map((c) => f[c]), d.id])
    const { rows } = await db.query(`${SELECT} WHERE c.id = $1`, [d.id])
    res.json({ document: out(rows[0], req.user.id, d.role) })
  })
  api.delete('/documents/:id', auth, async (req, res) => {
    const d = await docFor(req)
    canChange(d, req)
    await db.tx(async (t) => {
      // Anything that pointed at this document simply stops pointing at it.
      await t.query('UPDATE health_entries SET document_id = NULL WHERE document_id = $1', [d.id])
      await t.query('UPDATE awards SET document_id = NULL WHERE document_id = $1', [d.id])
      await t.query('DELETE FROM documents WHERE id = $1', [d.id])
    })
    res.json({ ok: true })
  })
}
