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
