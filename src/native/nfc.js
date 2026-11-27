// Reading a Trot Tag (an NFC sticker that holds the address of a tag page, /t/<code>)
// from inside the iPhone app. Scaffold: nothing calls it yet.
//
// What an iPhone already does without this file: held near a Trot Tag while unlocked, it
// reads the address in the background and offers to open it in Safari. That is how a
// stranger who finds a dog reads the tag, and it needs no app.
// This file is for the owner, inside Trot: "Scan a tag" to check which dog a sticker
// points at.
//
// Needs, on the Xcode side (see docs/ios-build.md, "NFC"):
// - NFCReaderUsageDescription in Info.plist (already there)
// - the "Near Field Communication Tag Reading" capability, which the owner adds in Xcode.
//   Without it a scan fails with a "missing entitlement" error and nothing else breaks.
//
//   import { scanTrotTag } from './native/nfc.js'
//   const r = await scanTrotTag()
//   // { ok: true, code, url }  the tag page has been opened in Safari
//   // { ok: false, reason: 'unsupported' | 'cancelled' | 'timeout' | 'not_trot' | 'error', message }
import { isNative, SITE_ORIGIN } from './platform.js'

// The same shape the server accepts (CODE_RE in server/routesRegistration.js).
const CODE_RE = /^[2-9A-HJ-NP-Z]{12}$/
// NFC Forum URI record: the first payload byte stands for a common prefix.
const URI_PREFIX = ['', 'http://www.', 'https://www.', 'http://', 'https://']

// The address stored in one NDEF record, or null when the record is not a web address.
export function ndefUrl(record) {
  try {
    if (!record || !Array.isArray(record.payload)) return null
    const type = String.fromCharCode(...(record.type || []))
    const bytes = Uint8Array.from(record.payload)
    // Well-known type "U": prefix byte, then the rest of the address in UTF-8.
    if (record.tnf === 1 && type === 'U') {
      if (!bytes.length || bytes[0] >= URI_PREFIX.length) return null
      return URI_PREFIX[bytes[0]] + new TextDecoder().decode(bytes.subarray(1))
    }
    // Absolute URI records carry the address in the type field.
    if (record.tnf === 3 && /^https?:\/\//i.test(type)) return type
  } catch (e) { /* not readable */ }
  return null
}

// The tag code when the address is a Trot tag page on the Trot website, otherwise null.
// Anything else on a sticker (another site, a look-alike host, a javascript: address) is refused.
export function trotTagCode(url, origin = SITE_ORIGIN) {
  try {
    const u = new URL(url), site = new URL(origin)
    if (u.protocol !== 'https:' || u.host !== site.host || u.username || u.password) return null
    const m = /^\/t\/([^/]+)\/?$/.exec(u.pathname)
    const code = m ? m[1].toUpperCase() : ''
    return CODE_RE.test(code) ? code : null
  } catch (e) { return null }
}

let pluginPromise = null
function plugin() {
  if (!pluginPromise) pluginPromise = import('@capgo/capacitor-nfc').then((m) => m.CapacitorNfc)
  return pluginPromise
}

// True on an iPhone with NFC, inside the app. False on the website.
export async function nfcSupported() {
  if (!isNative) return false
  try { return !!(await (await plugin()).isSupported()).supported } catch (e) { return false }
}

// Shows the iOS "Ready to Scan" sheet, reads one tag, and opens its Trot page in Safari.
// open: false reads the tag without opening anything.
export async function scanTrotTag({ open = true, alertMessage = 'Hold the top of your iPhone near the Trot Tag.' } = {}) {
  if (!(await nfcSupported())) return { ok: false, reason: 'unsupported', message: 'This phone cannot read NFC tags from inside Trot.' }
  const nfc = await plugin()
  return new Promise((resolve) => {
    const handles = []
    let done = false
    const finish = (result) => {
      if (done) return
      done = true
      for (const h of handles) { try { h.remove() } catch (e) { /* already removed */ } }
      nfc.stopScanning().catch(() => {})
      resolve(result)
    }
    Promise.all([
      nfc.addListener('nfcEvent', (event) => {
        const records = (event && event.tag && event.tag.ndefMessage) || []
        for (const r of records) {
          const url = ndefUrl(r), code = url ? trotTagCode(url) : null
          if (code) {
            const page = `${SITE_ORIGIN}/t/${code}`
            if (open) { try { window.open(page, '_blank') } catch (e) { /* the caller still gets the address */ } }
            return finish({ ok: true, code, url: page })
          }
        }
        finish({ ok: false, reason: 'not_trot', message: 'That is not a Trot Tag.' })
      }),
      nfc.addListener('nfcSessionEnd', ({ reason } = {}) => finish(reason === 'userCancelled' ? { ok: false, reason: 'cancelled', message: '' } : { ok: false, reason: reason === 'sessionTimeout' ? 'timeout' : 'error', message: 'No tag was read. Try again.' })),
    ]).then((hs) => {
      handles.push(...hs)
      if (done) { for (const h of hs) { try { h.remove() } catch (e) { /* already removed */ } } return }
      return nfc.startScanning({ iosSessionType: 'ndef', invalidateAfterFirstRead: true, alertMessage })
    }).catch((e) => finish({ ok: false, reason: 'error', message: (e && e.message) || 'NFC could not start.' }))
  })
}
