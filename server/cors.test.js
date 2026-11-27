// node --test server/cors.test.js
// Not picked up by `npm test` until server/index.js imports it (see docs/ios-build.md).
import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { nativeCors } from './cors.js'
import { createDb } from './db.js'
import { createApp } from './app.js'

// The real app behind the middleware, the way server/app.js will mount it.
async function serve() {
  const db = await createDb()
  const outer = express()
  outer.use(nativeCors())
  outer.use(createApp({ db }))
  const server = await new Promise((r) => { const s = outer.listen(0, () => r(s)) })
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) }
}
const APP = 'capacitor://localhost'

test('the iPhone app origin can read the API, and sign in with a bearer token', async () => {
  const s = await serve()
  try {
    const health = await fetch(s.url + '/api/health', { headers: { origin: APP } })
    assert.equal(health.status, 200)
    assert.equal(health.headers.get('access-control-allow-origin'), APP)
    assert.equal(health.headers.get('access-control-allow-credentials'), null, 'cookies are never allowed across origins')
    assert.match(health.headers.get('vary') || '', /Origin/i)

    const pre = await fetch(s.url + '/api/me', { method: 'OPTIONS', headers: { origin: APP, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } })
    assert.equal(pre.status, 204)
    assert.equal(pre.headers.get('access-control-allow-origin'), APP)
    assert.match(pre.headers.get('access-control-allow-headers'), /authorization/)
    assert.match(pre.headers.get('access-control-allow-methods'), /PATCH/)

    const session = await fetch(s.url + '/api/session', { method: 'POST', headers: { origin: APP, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Dana', email: 'dana@example.com' }) })
    assert.ok(session.ok)
    const { token } = await session.json()
    const me = await fetch(s.url + '/api/me', { headers: { origin: APP, authorization: 'Bearer ' + token } })
    assert.equal(me.status, 200)
    assert.equal(me.headers.get('access-control-allow-origin'), APP)
    // Sign-in is still required: the header changes who may read an answer, not who is signed in.
    const anon = await fetch(s.url + '/api/me', { headers: { origin: APP } })
    assert.equal(anon.status, 401)
  } finally { await s.close() }
})

test('any other origin gets no CORS headers, and the website is unchanged', async () => {
  const s = await serve()
  try {
    for (const origin of ['https://evil.example', 'capacitor://localhost.evil.example', 'http://localhost', 'null']) {
      const r = await fetch(s.url + '/api/health', { headers: { origin } })
      assert.equal(r.status, 200)
      assert.equal(r.headers.get('access-control-allow-origin'), null, origin)
      const pre = await fetch(s.url + '/api/me', { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } })
      assert.equal(pre.headers.get('access-control-allow-origin'), null, origin)
      assert.equal(pre.headers.get('access-control-allow-methods'), null, origin)
    }
    const plain = await fetch(s.url + '/api/health')
    assert.equal(plain.status, 200)
    assert.equal(plain.headers.get('access-control-allow-origin'), null)
    // Pages outside /api are not touched at all.
    const page = await fetch(s.url + '/healthz', { headers: { origin: APP } })
    assert.equal(page.headers.get('access-control-allow-origin'), null)
    assert.equal(page.headers.get('vary'), null)
  } finally { await s.close() }
})
