// node --test src/native/
// The iPhone path of location.js, run against a stand-in for the native plugin.
import test from 'node:test'
import assert from 'node:assert/strict'
import { startWatch, _setPlugin } from './location.js'
import { siteLink, luminance } from './shell-logic.js'

function fakePlugin() {
  const watchers = new Map()
  let n = 0
  return {
    watchers,
    removed: [],
    addWatcher(options, cb) { const id = 'w' + ++n; watchers.set(id, { options, cb }); return Promise.resolve(id) },
    removeWatcher({ id }) { this.removed.push(id); watchers.delete(id); return Promise.resolve() },
  }
}
const tick = () => new Promise((r) => setTimeout(r, 5))
const loc = (time, latitude = 35.2, longitude = -80.8) => ({ latitude, longitude, accuracy: 6, altitude: 200, altitudeAccuracy: 3, simulated: false, bearing: 90, speed: 1.4, time })

test('asks for While Using first, then hands over to a background watcher without asking again', async () => {
  const p = fakePlugin(); _setPlugin(p)
  const fixes = []
  const stop = startWatch({ onFix: (f) => fixes.push(f) }, { native: true })
  await tick()
  assert.equal(p.watchers.size, 1)
  const first = p.watchers.get('w1')
  assert.equal(first.options.requestPermissions, true)
  assert.equal(first.options.backgroundMessage, undefined, 'the first watcher must not ask for Always')
  first.cb(loc(1000))
  await tick()
  assert.deepEqual(fixes[0], { lat: 35.2, lng: -80.8, accuracy: 6, time: 1000, speed: 1.4, heading: 90, altitude: 200 })
  assert.deepEqual([...p.watchers.keys()], ['w2'], 'the foreground watcher is dropped after the hand-over')
  const second = p.watchers.get('w2')
  assert.equal(second.options.requestPermissions, false)
  assert.ok(second.options.backgroundMessage)
  second.cb(loc(1000)); second.cb(loc(2000))
  assert.equal(fixes.length, 2, 'a fix seen by both watchers is passed on once')
  stop(); stop()
  await tick()
  assert.equal(p.watchers.size, 0)
  second.cb(loc(3000))
  assert.equal(fixes.length, 2, 'nothing arrives after stop')
})

test('a refused permission reaches onError as denied', async () => {
  const p = fakePlugin(); _setPlugin(p)
  const errors = []
  const stop = startWatch({ onFix: () => {}, onError: (e) => errors.push(e) }, { native: true })
  await tick()
  p.watchers.get('w1').cb(undefined, Object.assign(new Error('Permission denied.'), { code: 'NOT_AUTHORIZED' }))
  assert.equal(errors[0].code, 'denied')
  assert.equal(p.watchers.size, 1, 'no background watcher without a fix')
  stop()
})

test('stopping before the plugin has loaded leaves no watcher behind', async () => {
  const p = fakePlugin(); _setPlugin(p)
  const stop = startWatch({ onFix: () => {} }, { native: true })
  stop()
  await tick(); await tick()
  assert.equal(p.watchers.size, 0)
})

test('the website path reports a browser without geolocation', () => {
  const errors = []
  startWatch({ onFix: () => {}, onError: (e) => errors.push(e.code) }, { native: false })
  assert.deepEqual(errors, ['unsupported'])
})

test('server pages are sent to the website, app screens are left alone', () => {
  const base = 'capacitor://localhost/'
  const site = (h) => siteLink(h, base, 'https://trot-app.onrender.com')
  assert.equal(site('/d/biscuit'), 'https://trot-app.onrender.com/d/biscuit')
  assert.equal(site('/d/biscuit?add=1'), 'https://trot-app.onrender.com/d/biscuit?add=1')
  assert.equal(site('/t/AB12CD'), 'https://trot-app.onrender.com/t/AB12CD')
  assert.equal(site('/vet/token123'), 'https://trot-app.onrender.com/vet/token123')
  assert.equal(site('/'), null)
  assert.equal(site('/?friend=biscuit'), null)
  assert.equal(site('https://www.openstreetmap.org/copyright'), null)
  assert.equal(site('blob:capacitor://localhost/123'), null)
})

test('status bar: light text over navy, dark text over white, see-through layers skipped', () => {
  assert.ok(luminance('rgb(15, 27, 45)') < 0.55)
  assert.ok(luminance('rgb(255, 255, 255)') > 0.55)
  assert.equal(luminance('rgba(0, 0, 0, 0)'), null)
  assert.equal(luminance('transparent'), null)
})

// ---- nfc.js: what counts as a Trot Tag -----------------------------------------
import { ndefUrl, trotTagCode } from './nfc.js'
const bytes = (s) => [...new TextEncoder().encode(s)]
test('NFC: reads the address from a URI record and accepts only Trot tag pages', () => {
  const site = 'https://trot-app.onrender.com'
  const rec = { tnf: 1, type: bytes('U'), id: [], payload: [4, ...bytes('trot-app.onrender.com/t/7KQ2MXW9PRT4')] }
  assert.equal(ndefUrl(rec), 'https://trot-app.onrender.com/t/7KQ2MXW9PRT4')
  assert.equal(trotTagCode(ndefUrl(rec), site), '7KQ2MXW9PRT4')
  assert.equal(trotTagCode('https://trot-app.onrender.com/t/7kq2mxw9prt4', site), '7KQ2MXW9PRT4')
  assert.equal(trotTagCode('http://trot-app.onrender.com/t/7KQ2MXW9PRT4', site), null, 'plain http is refused')
  assert.equal(trotTagCode('https://trot-app.onrender.com.evil.example/t/7KQ2MXW9PRT4', site), null)
  assert.equal(trotTagCode('https://user@trot-app.onrender.com/t/7KQ2MXW9PRT4', site), null)
  assert.equal(trotTagCode('https://trot-app.onrender.com/d/biscuit', site), null)
  assert.equal(trotTagCode('https://trot-app.onrender.com/t/SHORT', site), null)
  assert.equal(trotTagCode('javascript:alert(1)', site), null)
  assert.equal(ndefUrl({ tnf: 1, type: bytes('T'), id: [], payload: [2, ...bytes('enhello')] }), null, 'a text record is not an address')
})
