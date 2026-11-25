# Trot

Dog-first walking and community app. A multi-user trial (Node, Express, Postgres) with real accounts, dogs, care teams, saved walks and a public page per dog, plus the original no-sign-in demo with a seeded account for Biscuit, a Golden Retriever.

## Run locally

Frontend only (the Biscuit demo, no backend):

    npm install
    npm run dev

The whole thing (API, public dog pages and the built app on one port):

    npm install
    npm run build
    npm start

Open http://localhost:3000. With no `DATABASE_URL` the server uses an in-memory database (pg-mem), so accounts and walks vanish when it stops. Point `DATABASE_URL` at a Postgres database to keep them. Tables are created at startup.

Environment variables:

- `DATABASE_URL`: Postgres connection string. SSL is on for any host that is not localhost. `DATABASE_SSL=verify` also checks the certificate, `DATABASE_SSL=off` turns SSL off.
- `PORT`: defaults to 3000.
- `STATIC_DIR`: folder with the built frontend. Defaults to `dist`.
- `PUBLIC_URL`: the site address used in link previews. On Render `RENDER_EXTERNAL_URL` is picked up without setting anything.
- `TRUST_PROXY`: number of proxies in front of the server. Defaults to 1 on Render and 0 elsewhere.

Tests (server, against pg-mem, or against real Postgres when `DATABASE_URL` is set):

    npm test

## Two ways in

- **Try the Biscuit demo**: the seeded demo, no sign-in, state kept in the browser. It needs no backend, so it also works from static hosting, where it is the only mode.
- **Create my dog's page**: a real account, a real dog, a care team, saved walks, paws, and a public page at `/d/<dog>`.

When the app loads it asks `/api/health`. If no Trot API answers, it opens straight into the demo.

## Deploy to Render

1. Push this folder to a GitHub repo.
2. In Render choose New > Blueprint and pick the repo. `render.yaml` creates a Node web service (`npm ci && npm run build`, then `npm start`, health check on `/healthz`) and a Postgres database wired to `DATABASE_URL`.
3. If you deployed the earlier version, the existing static site on Render must be replaced by this web service. A static site cannot run the API. Delete the old static site (or rename it) so the new web service can take the name `trot`, then sync the blueprint.
4. Open the Render URL on your iPhone in Safari, tap Share, then Add to Home Screen. Trot opens full screen with its own icon.

Render's free Postgres expires after a set period and the free web service sleeps when idle. Move both to paid plans before relying on the data.

## API

All JSON. Send the session token as `Authorization: Bearer <token>`.

| Method and path | Who | What |
| --- | --- | --- |
| `GET /healthz` | anyone | Health check |
| `GET /api/health` | anyone | Tells the app a Trot API is present |
| `POST /api/session` | anyone | `{ name, email }` creates or finds the user, returns a token |
| `DELETE /api/session` | signed in | Sign out |
| `GET /api/me` | signed in | The user, their dogs and roles |
| `PATCH /api/me` | signed in | `{ name }` changes your display name |
| `POST /api/dogs` | signed in | Create a dog. The creator becomes owner |
| `GET /api/dogs/:slug` | team | Profile, team with last 7 days per person, recent walks |
| `PATCH /api/dogs/:slug` | owner | Edit `name`, `breed`, `birthday`, `age`, `weight`, `bio`, `public`, `share_routes`, `photo`. The address (`slug`) never changes, so a renamed dog keeps its links. `photo` is a JPEG, PNG or WebP data URL of at most 300 KB decoded, or `null` to remove it |
| `GET /api/dogs/:slug/photo` | team | The photo as image bytes, cached for 5 minutes |
| `DELETE /api/dogs/:slug/members/:userId` | owner | Remove someone from the team. Not yourself |
| `POST /api/dogs/:slug/invites` | owner | Invite link, single use, 14 days |
| `GET /api/dogs/:slug/invites` | owner | Invites not used yet. No link tokens |
| `DELETE /api/dogs/:slug/invites/:id` | owner | Cancel an unused invite |
| `GET /api/invites/:token` | anyone with the link | Dog name and role, for the join screen |
| `POST /api/invites/:token/accept` | signed in | Join the team |
| `POST /api/dogs/:slug/walks` | team | Save a walk |
| `GET /api/walks/:id` | team | One walk with its full route |
| `DELETE /api/walks/:id` | the walker, or the owner | Delete a walk and its paws |
| `POST` and `DELETE /api/walks/:id/paw` | team | Give or take back a paw |
| `GET /api/feed` | signed in | Walks for all your dogs, newest first. `limit`, `cursor`, optional `dog` |
| `GET /api/public/dogs/:slug` | anyone | Public dogs only. No routes unless `share_routes` is on |
| `GET /api/public/dogs/:slug/photo` | anyone | Public dogs only. The photo as image bytes. 404 for a private dog |
| `GET /d/:slug` | anyone | The public dog page, plain HTML with link preview tags |

JSON never carries the photo itself. Dogs and walks carry a `photoUrl` (or `null`) that points at one of the photo endpoints, with a `v` value that changes when the photo does. The team endpoint needs the session token, so the app fetches it and shows it from memory. Request bodies are capped at 400 KB, except `PATCH /api/dogs/:slug`, which allows 420 KB to fit a photo.

## Trial limitations

Read these before inviting anyone.

- **There is no password and no email verification.** Sign-in is a name and an email. Anyone who knows a person's email can sign in as that person, see their dogs and walks (including routes), and post as them. Do not put anything in Trot during the trial that you would not want a stranger to see. Real sign-in (emailed links or passkeys) has to come before a wider launch.
- An invite link works once and lasts 14 days. Whoever opens it first joins the team, so send it to one person. The owner can remove someone from the team and cancel an unused invite. A walk can be deleted by the person who logged it or by the dog's owner. There is no way yet to leave a team yourself, hand a dog to a new owner, or delete a dog or an account, short of editing the database. Someone removed from a team can no longer delete the walks they logged, but the owner can.
- A dog's page is public by default: photo, name, breed, bio, totals, and the last 10 outings with title, note, place name, date and the walker's first name. Route maps stay off the public page unless the owner turns them on. The owner can make the page private in Settings or in Edit profile. While the page is public, anyone can load the dog's photo from its address.
- The care team sees full routes, which usually start and end at home.
- Rate limiting is kept in memory. It resets on restart and is per instance, so it only suits a single small instance.
- The connection to managed Postgres is encrypted but the certificate is not verified unless `DATABASE_SSL=verify` is set.
- Signed in, the Walk screen and Explore still say Biscuit in places and show the walker as Dale. Walks are saved to the right dog and person all the same. Explore and the sample routes are centred on Cambridge, MA.
- A dog has one profile photo and no other photos. It is cropped to a square of at most 512 px and saved as a JPEG in the browser before upload, then stored in the database as text (up to 300 KB each). That suits a trial. Move photos to object storage before there are many dogs. The server checks the type, the first bytes and the size, but does not re-encode the image. Browsers that cannot draw to a canvas cannot add a photo.
- The photo does not appear on the Walk and Explore screens or on the story card image yet. Walks have no photos of their own.
- Changing your display name changes how you appear on every dog and on past walks. The email cannot be changed.
- No comments, followers, streaks or health records yet. Signed in, those are left out or shown as empty rather than filled with sample numbers.
- Dates on the public page are in UTC.
- The server answers `/sw.js` itself so the service worker never caches API answers. Static hosting keeps using `public/sw.js`.

## Native iPhone build (needs a Mac with Xcode)

    npm install @capacitor/core @capacitor/cli @capacitor/ios
    npm run build
    npx cap add ios
    npx cap sync ios
    npx cap open ios

In Xcode: select your team under Signing & Capabilities (a free Apple ID works for your own phone, builds expire after 7 days), plug in the iPhone, enable Developer Mode on the phone under Settings > Privacy & Security, and press Run. Add `NSLocationWhenInUseUsageDescription` to Info.plist for Live GPS. The paid Apple Developer Program ($99 per year) adds TestFlight.

## What is real and what is demo

- Real, signed in: accounts (trial sign-in), dogs with an editable profile and photo, care teams and invites, saved walks, paws, last 7 days per person, the public dog page.
- Real in both modes: recording with Live GPS, story card image, maps (OpenStreetMap data via CARTO tiles).
- Demo only: the dog pictures, which are original illustrations drawn in code (`src/portraits.jsx`), not photographs. Biscuit's history, people, the pack, park stats, health data, route playback at 40x speed, and every connection (Trot Tag, AirTag, Instagram, Strava, Garmin, Apple Health, collars, AllTrails, vet records). Demo walks are kept in the browser.
- Place coordinates and sample routes are approximate samples around Cambridge, MA.
