// Small fetch client for the Trot API. The session token lives in localStorage.
// On static hosting there is no API: probe() answers false and the app stays in
// demo-only mode without showing anything about it.
const BASE = ((import.meta.env && import.meta.env.VITE_API_BASE) || '').replace(/\/+$/, '')
const TOKEN = 'trot-token'
let token = null
try { token = localStorage.getItem(TOKEN) || null } catch (e) {}
let onAuthLost = null

export const hasToken = () => !!token
export function setToken(t) {
  token = t || null
  try { if (token) localStorage.setItem(TOKEN, token); else localStorage.removeItem(TOKEN) } catch (e) {}
}
export function setAuthLost(fn) { onAuthLost = fn }

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

// True only when a real Trot API answers. A static host that rewrites every path
// to index.html answers 200 with HTML, which fails the JSON check.
export async function probe(ms = 3000) {
  let timer
  try {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null
    if (ctl) timer = setTimeout(() => ctl.abort(), ms)
    const res = await fetch(BASE + '/api/health', { headers: { accept: 'application/json' }, signal: ctl ? ctl.signal : undefined })
    if (!res.ok || !/json/.test(res.headers.get('content-type') || '')) return false
    const j = await res.json()
    return !!(j && j.ok && j.service === 'trot')
  } catch (e) { return false } finally { clearTimeout(timer) }
}

async function request(method, path, body) {
  const headers = { accept: 'application/json' }
  if (token) headers.authorization = 'Bearer ' + token
  if (body !== undefined) headers['content-type'] = 'application/json'
  let res
  try { res = await fetch(BASE + '/api' + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined }) }
  catch (e) { throw new ApiError(0, 'Cannot reach Trot. Check your connection and try again.') }
  let data = null
  try { data = await res.json() } catch (e) {}
  if (!res.ok) {
    const sent = !!headers.authorization
    if (res.status === 401 && sent) { setToken(null); if (onAuthLost) onAuthLost() }
    throw new ApiError(res.status, (data && data.error) || 'Something went wrong. Try again.')
  }
  return data
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b === undefined ? {} : b),
  patch: (p, b) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),
}

// Dog photos. The team endpoint needs the session token, which an <img> tag cannot
// send, so each photo is fetched once here and handed out as an object URL. The
// key is the photoUrl from the API, which changes whenever the photo does.
const photos = new Map()
const photoReady = new Map()
const forget = (url) => { const u = photoReady.get(url); if (u && u.startsWith('blob:')) { try { URL.revokeObjectURL(u) } catch (e) {} } photos.delete(url); photoReady.delete(url) }
export const peekPhoto = (url) => photoReady.get(url) || ''
export function loadPhoto(url) {
  if (!/^\/api\//.test(url || '')) return Promise.reject(new Error('No photo.'))
  if (!photos.has(url)) {
    const headers = token ? { authorization: 'Bearer ' + token } : {}
    const p = fetch(BASE + url, { headers }).then(async (res) => {
      if (!res.ok || !/^image\/(jpeg|png|webp)/.test(res.headers.get('content-type') || '')) throw new Error('No photo.')
      const src = URL.createObjectURL(await res.blob())
      photoReady.set(url, src)
      return src
    })
    photos.set(url, p)
    // A failed load is forgotten so the next screen can try again.
    p.catch(() => { if (photos.get(url) === p) photos.delete(url) })
  }
  return photos.get(url)
}
// After an upload the browser already holds the picture, so it is shown without a second download.
export function primePhoto(url, src) { if (url && src) { photoReady.set(url, src); photos.set(url, Promise.resolve(src)) } }
function clearPhotos() { for (const url of [...photos.keys(), ...photoReady.keys()]) forget(url) }

export async function signOut() {
  try { if (token) await request('DELETE', '/session') } catch (e) {}
  setToken(null)
  clearPhotos()
  // Drop anything an older service worker may have cached for this person.
  try { if (typeof caches !== 'undefined') (await caches.keys()).forEach((k) => caches.delete(k)) } catch (e) {}
}

// Invite links look like /?invite=TOKEN. The token is moved out of the address
// bar into sessionStorage so it does not linger in history or get shared by accident.
const INVITE = 'trot-invite'
let inviteMem = null
export function takeInviteFromUrl() {
  try {
    const u = new URL(location.href)
    const t = u.searchParams.get('invite')
    if (t) {
      if (/^[A-Za-z0-9_-]{20,200}$/.test(t)) { inviteMem = t; sessionStorage.setItem(INVITE, t) }
      u.searchParams.delete('invite')
      history.replaceState(null, '', u.pathname + u.search + u.hash)
    }
  } catch (e) {}
  return pendingInvite()
}
export function pendingInvite() { try { return sessionStorage.getItem(INVITE) || inviteMem } catch (e) { return inviteMem } }
export function clearInvite() { inviteMem = null; try { sessionStorage.removeItem(INVITE) } catch (e) {} }

// Friend links look like /?friend=<dog address>, reached from the "Add as a friend" button on a public
// page. The address is kept in sessionStorage so it survives signing in, and is taken out of the address bar.
const FRIEND = 'trot-friend'
let friendMem = null
export function takeFriendFromUrl() {
  try {
    const u = new URL(location.href)
    const t = u.searchParams.get('friend')
    if (t !== null) {
      if (/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(t)) { friendMem = t; sessionStorage.setItem(FRIEND, t) }
      u.searchParams.delete('friend')
      history.replaceState(null, '', u.pathname + u.search + u.hash)
    }
  } catch (e) {}
  return pendingFriend()
}
export function pendingFriend() { try { return sessionStorage.getItem(FRIEND) || friendMem } catch (e) { return friendMem } }
export function clearFriend() { friendMem = null; try { sessionStorage.removeItem(FRIEND) } catch (e) {} }

// ---- places, events, awards, documents, boards (appended) --------------------
const qs = (o) => { const p = Object.entries(o || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''); return p.length ? '?' + p.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&') : '' }
const tz = () => new Date().getTimezoneOffset()

// Community dog places. list() works signed out; the token is sent only when there is one.
api.places = {
  list: (box) => request('GET', `/places${qs({ s: box.s, w: box.w, n: box.n, e: box.e })}`),
  add: (input) => request('POST', '/places', input),
  confirm: (id) => request('POST', `/places/${id}/confirm`, {}),
  unconfirm: (id) => request('DELETE', `/places/${id}/confirm`),
  remove: (id) => request('DELETE', `/places/${id}`),
  // Ownership: ask to maintain a listing, report a problem, and (for the approved manager) edit it.
  claim: (id, input) => request('POST', `/places/${id}/claim`, input),
  report: (id, input) => request('POST', `/places/${id}/report`, input),
  update: (id, patch) => request('PATCH', `/places/${id}`, patch),
}
// Admins only (ADMIN_EMAILS on the server). Everyone else gets a 403.
api.admin = {
  claims: (status = 'pending') => request('GET', `/admin/claims${qs({ status })}`),
  approve: (id) => request('POST', `/admin/claims/${id}/approve`, {}),
  reject: (id) => request('POST', `/admin/claims/${id}/reject`, {}),
  reports: () => request('GET', '/admin/reports'),
  resolve: (id) => request('POST', `/admin/reports/${id}/resolve`, {}),
}
api.events = {
  // near is [lat, lng]; from is YYYY-MM-DD. Both optional.
  list: ({ near, from } = {}) => request('GET', `/events${qs({ near: near ? near.join(',') : undefined, from })}`),
  forDog: (slug) => request('GET', `/dogs/${slug}/events`),
  add: (input) => request('POST', '/events', input),
  remove: (id) => request('DELETE', `/events/${id}`),
  mark: (id, slug, body) => request('PUT', `/events/${id}/entries/${slug}`, body || { status: 'going' }),
  unmark: (id, slug) => request('DELETE', `/events/${id}/entries/${slug}`),
}
api.awards = {
  list: (slug) => request('GET', `/dogs/${slug}/awards${qs({ tz: tz() })}`),
  add: (slug, input) => request('POST', `/dogs/${slug}/awards`, input),
  update: (id, patch) => request('PATCH', `/awards/${id}`, patch),
  remove: (id) => request('DELETE', `/awards/${id}`),
}
api.health = {
  get: (slug) => request('GET', `/dogs/${slug}/health${qs({ tz: tz() })}`),
  add: (slug, input) => request('POST', `/dogs/${slug}/health${qs({ tz: tz() })}`, input),
  update: (id, patch) => request('PATCH', `/health/${id}${qs({ tz: tz() })}`, patch),
  remove: (id) => request('DELETE', `/health/${id}`),
  shares: (slug) => request('GET', `/dogs/${slug}/health/shares`),
  share: (slug) => request('POST', `/dogs/${slug}/health/shares`, {}),
  revoke: (slug, id) => request('DELETE', `/dogs/${slug}/health/shares/${id}`),
}
api.boards = {
  get: (o) => request('GET', `/leaderboards${qs(o)}`),
  challenges: (slug) => request('GET', `/challenges${qs({ dog: slug })}`),
  challenge: (key, slug) => request('GET', `/challenges/${key}${qs({ dog: slug })}`),
  join: (slug, key) => request('POST', `/dogs/${slug}/challenges/${key}`, {}),
  leave: (slug, key) => request('DELETE', `/dogs/${slug}/challenges/${key}`),
  pack: () => request('GET', '/pack'),
}
api.team = {
  person: (slug, id) => request('GET', `/dogs/${slug}/members/${id}`),
  setRole: (slug, id, role) => request('PATCH', `/dogs/${slug}/members/${id}`, { role }),
}
api.documents = {
  list: (slug) => request('GET', `/dogs/${slug}/documents`),
  update: (id, patch) => request('PATCH', `/documents/${id}`, patch),
  remove: (id) => request('DELETE', `/documents/${id}`),
  // The file goes up as a data URL in JSON. XMLHttpRequest is used so the form can show progress.
  upload: (slug, input, onProgress) => new Promise((resolve, reject) => {
    const x = new XMLHttpRequest()
    x.open('POST', `${BASE}/api/dogs/${slug}/documents`)
    x.setRequestHeader('content-type', 'application/json'); x.setRequestHeader('accept', 'application/json')
    if (token) x.setRequestHeader('authorization', 'Bearer ' + token)
    x.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100)) }
    x.onerror = () => reject(new ApiError(0, 'Cannot reach Trot. Check your connection and try again.'))
    x.onload = () => {
      let data = null
      try { data = JSON.parse(x.responseText) } catch (e) {}
      if (x.status >= 200 && x.status < 300 && data) return resolve(data)
      if (x.status === 401) { setToken(null); if (onAuthLost) onAuthLost() }
      reject(new ApiError(x.status, (data && data.error) || (x.status === 413 ? 'That file is too big. The limit is 5 MB.' : 'The upload did not work. Try again.')))
    }
    x.send(JSON.stringify(input))
  }),
  // Opens a document in a new tab. The tab is opened first, while the tap still counts as a
  // user action (Safari blocks it otherwise), and is pointed at the file once it has arrived.
  view: async (id) => {
    let w = null
    try { w = window.open('', '_blank') } catch (e) {}
    try {
      const url = await api.documents.open(id)
      if (w) w.location.href = url
      else { const l = document.createElement('a'); l.href = url; l.target = '_blank'; l.rel = 'noopener'; document.body.appendChild(l); l.click(); l.remove() }
      setTimeout(() => { try { URL.revokeObjectURL(url) } catch (e) {} }, 120000)
    } catch (e) { if (w) { try { w.close() } catch (e2) {} } throw e }
  },
  // The file endpoint needs the token, so the bytes are fetched here and handed back as a blob URL.
  open: async (id) => {
    let res
    try { res = await fetch(`${BASE}/api/documents/${id}/file`, { headers: token ? { authorization: 'Bearer ' + token } : {} }) } catch (e) { throw new ApiError(0, 'Cannot reach Trot. Check your connection and try again.') }
    if (!res.ok) throw new ApiError(res.status, 'That document could not be opened.')
    return URL.createObjectURL(await res.blob())
  },
}

// ---- registration and ID, Trot Tags, Lost Dog mode (appended) ----------------
// Registration is what the care team typed about the microchip, licence and rabies tag. It is never public.
api.registration = {
  get: (slug) => request('GET', `/dogs/${slug}/registration${qs({ tz: tz() })}`),
  save: (slug, input) => request('PUT', `/dogs/${slug}/registration${qs({ tz: tz() })}`, input),
}
// A Trot Tag is a web address for an NFC sticker or QR code. scans() also carries the Lost Dog state.
api.tags = {
  list: (slug) => request('GET', `/dogs/${slug}/tags`),
  create: (slug, label) => request('POST', `/dogs/${slug}/tags`, { label: label || '' }),
  retire: (slug, id) => request('DELETE', `/dogs/${slug}/tags/${id}`),
  scans: (slug) => request('GET', `/dogs/${slug}/tags/scans`),
  markRead: (slug, id) => request('POST', `/dogs/${slug}/tags/scans/${id}/read`, {}),
  lost: (slug) => request('GET', `/dogs/${slug}/lost`),
  setLost: (slug, lost, note) => request('PUT', `/dogs/${slug}/lost`, { lost, note: note || '' }),
}

// ---- dog friends and outing photos (appended) --------------------------------
// A dog follows other public dogs. The owner and family manage the list; the rest of the team can read it.
api.friends = {
  list: (slug) => request('GET', `/dogs/${slug}/friends`),
  add: (slug, other) => request('PUT', `/dogs/${slug}/friends/${other}`, {}),
  remove: (slug, other) => request('DELETE', `/dogs/${slug}/friends/${other}`),
  feed: (slug) => request('GET', `/dogs/${slug}/friends/feed`),
  suggestions: (slug) => request('GET', `/dogs/${slug}/friends/suggestions`),
  search: (q, slug) => request('GET', `/dogs/search${qs({ q, dog: slug })}`),
  publicDog: (slug) => request('GET', `/public/dogs/${slug}`),
}
// Photos on an outing. Each one goes up as a JPEG data URL that src/photo.js has already shrunk.
api.photos = {
  remove: (walkId, id) => request('DELETE', `/walks/${walkId}/photos/${id}`),
  upload: (walkId, dataUrl, onProgress) => new Promise((resolve, reject) => {
    const x = new XMLHttpRequest()
    x.open('POST', `${BASE}/api/walks/${walkId}/photos`)
    x.setRequestHeader('content-type', 'application/json'); x.setRequestHeader('accept', 'application/json')
    if (token) x.setRequestHeader('authorization', 'Bearer ' + token)
    x.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100)) }
    x.onerror = () => reject(new ApiError(0, 'Cannot reach Trot. Check your connection and try again.'))
    x.onload = () => {
      let data = null
      try { data = JSON.parse(x.responseText) } catch (e) {}
      if (x.status >= 200 && x.status < 300 && data) return resolve(data)
      if (x.status === 401) { setToken(null); if (onAuthLost) onAuthLost() }
      reject(new ApiError(x.status, (data && data.error) || (x.status === 413 ? 'That photo is too big to send.' : 'The upload did not work. Try again.')))
    }
    x.send(JSON.stringify({ photo: dataUrl }))
  }),
}
