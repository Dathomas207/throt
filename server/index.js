// Entry point for `npm start` (node server/index.js).
// `node --test server/` resolves the folder to this file, so under the test
// runner it loads the tests instead of starting a server.
if (process.env.NODE_TEST_CONTEXT) { await import('./app.test.js'); await import('./registration.test.js') }
else await import('./start.js')
