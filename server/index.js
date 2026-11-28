// Entry point for `npm start` (node server/index.js).
// `node --test server/` resolves the folder to this file, so under the test
// runner it loads the tests instead of starting a server.
if (process.env.NODE_TEST_CONTEXT) { await import('./app.test.js'); await import('./registration.test.js'); await import('./friends-photos.test.js'); await import('./weather.test.js'); await import('./metrics-notifications.test.js'); await import('./routes.test.js'); await import('./training.test.js'); await import('./training-extras.test.js'); await import('./live.test.js'); await import('./cors.test.js'); await import('./auth.test.js') }
else await import('./start.js')
