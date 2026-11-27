// Everything the iPhone app needs around the web app, loaded only inside the Capacitor
// shell (src/main.jsx imports this file on demand, so the website never downloads it).
//
// What it does:
// - marks <html> with the "native" class and loads native.css
// - opens public pages (/d/..., /t/..., /vet/...) and outside links in Safari, because
//   those pages live on the website and not inside the app bundle
// - keeps the status bar text readable over light and dark screens
// - removes any service worker and cache, which would only serve stale files here
import './native.css'
import { siteLink, luminance } from './shell-logic.js'

function routeLinks() {
  const open0 = window.open.bind(window)
  // Capacitor hands any window.open with an https address to iOS, which opens Safari.
  window.open = (url, target, features) => {
    const site = url ? siteLink(url) : null
    return site ? open0(site, '_blank') : open0(url, target, features)
  }
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null
    if (!a) return
    const site = siteLink(a.getAttribute('href'))
    if (site) { e.preventDefault(); open0(site, '_blank') }
  }, true)
}

// ---- status bar ---------------------------------------------------------------
// The screens draw under the status bar (viewport-fit=cover), some with a navy header
// and some with a white one. The colour just under the status bar decides whether the
// clock and battery are drawn light or dark.
function topIsDark() {
  let el = document.elementFromPoint(Math.round(window.innerWidth / 2), 3)
  for (; el && el !== document.documentElement; el = el.parentElement) {
    const l = luminance(getComputedStyle(el).backgroundColor)
    if (l !== null) return l < 0.55
  }
  return true
}
async function watchStatusBar() {
  const { SystemBars } = await import('@capacitor/core')
  let last = null, queued = false
  const apply = () => {
    queued = false
    let dark = true
    try { dark = topIsDark() } catch (e) { /* keep light text */ }
    if (dark === last) return
    last = dark
    // DARK means light text for a dark background.
    SystemBars.setStyle({ style: dark ? 'DARK' : 'LIGHT' }).catch(() => {})
  }
  const later = () => { if (!queued) { queued = true; setTimeout(apply, 120) } }
  new MutationObserver(later).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
  window.addEventListener('resize', later)
  document.addEventListener('visibilitychange', later)
  apply()
}

// A service worker cannot register on capacitor://localhost, and the app's files are
// already on the phone. This clears anything left by an older build that tried.
async function dropServiceWorker() {
  try { if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister() } catch (e) { /* none */ }
  try { if (typeof caches !== 'undefined') for (const k of await caches.keys()) await caches.delete(k) } catch (e) { /* none */ }
}

let started = false
export function startNativeShell() {
  if (started) return
  started = true
  document.documentElement.classList.add('native')
  routeLinks()
  dropServiceWorker()
  watchStatusBar().catch(() => {})
}
