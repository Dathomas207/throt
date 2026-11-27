// The parts of shell.js that need no browser, kept apart so they can be tested with node.
import { SITE_ORIGIN } from './platform.js'

// Paths the server renders itself. Inside the app they must open on the website.
const SITE_PATH = /^\/(d|t|vet)\//

// The website address for a link that points at a server page, or null for anything else.
export function siteLink(href, base = typeof location !== 'undefined' ? location.href : 'capacitor://localhost/', origin = SITE_ORIGIN) {
  try {
    const u = new URL(String(href), base)
    const here = new URL(base)
    if (u.protocol === here.protocol && u.host === here.host && SITE_PATH.test(u.pathname)) return origin + u.pathname + u.search + u.hash
  } catch (e) { /* not a link we understand */ }
  return null
}

// Brightness (0 to 1) of a computed CSS colour, or null when it is mostly see-through.
export function luminance(css) {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+%?))?/.exec(css || '')
  if (!m) return null
  const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
  if (alpha < 0.5) return null
  return (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255
}
