// Lets the Trot iPhone app call the API.
//
// The app is the same web app, bundled into a Capacitor shell, so its pages load from
// capacitor://localhost and every API call is cross-origin. A browser engine only lets
// such a page read an answer when the server names that origin. This does exactly that
// for /api and nothing else.
//
// Why this does not weaken sign-in: Trot sessions are bearer tokens that the app sends
// in the Authorization header itself. There are no cookies, so a page on another origin
// has nothing the browser would attach for it, and Access-Control-Allow-Credentials is
// never sent. Only the origins listed below are answered; every other origin gets the
// same response as before, with no CORS headers, which browsers refuse to hand over.
//
// Register it once in server/app.js, before the API router is mounted:
//   import { nativeCors } from './cors.js'
//   app.use(nativeCors())
//
// NATIVE_APP_ORIGINS (comma-separated) replaces the list, for example to add
// https://localhost when an Android app exists.
export const NATIVE_APP_ORIGINS = ['capacitor://localhost']

const METHODS = 'GET, POST, PUT, PATCH, DELETE'
const HEADERS = 'authorization, content-type, accept'

export function nativeCors({ origins } = {}) {
  const fromEnv = (process.env.NATIVE_APP_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
  const allowed = new Set(origins || (fromEnv.length ? fromEnv : NATIVE_APP_ORIGINS))
  return function nativeCorsMiddleware(req, res, next) {
    if (req.path !== '/api' && !req.path.startsWith('/api/')) return next()
    // The answer differs by Origin, so a shared cache must not mix them up.
    res.vary('Origin')
    const origin = req.get('origin')
    if (!origin || !allowed.has(origin)) return next()
    res.set('Access-Control-Allow-Origin', origin)
    res.set('Access-Control-Expose-Headers', 'Retry-After')
    // A preflight is answered here and never reaches a route.
    if (req.method === 'OPTIONS' && req.get('access-control-request-method')) {
      res.set('Access-Control-Allow-Methods', METHODS)
      res.set('Access-Control-Allow-Headers', HEADERS)
      res.set('Access-Control-Max-Age', '600')
      return res.status(204).end()
    }
    next()
  }
}
