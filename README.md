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
- `SEED_DEMO`: demo dogs and people are seeded at every start so the trial does not look empty. Set `SEED_DEMO=0` to skip seeding (rows already seeded stay), or `SEED_DEMO=remove` to delete every demo dog and demo person at the next start.
- `DEMO_ON_LEADERBOARDS`: set to `0` to keep demo dogs off leaderboards and challenge boards while leaving their pages in place.
- `GEOCODE`: set to `0` to stop the one-time address lookups for the curated places (see below).

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
| `PATCH /api/dogs/:slug` | owner | Edit `name`, `breed`, `birthday`, `age`, `weight`, `bio`, `city`, `public`, `share_routes`, `photo`, `tracking_level` (1 to 3), `goal_minutes` (10 to 300, or `null`), `leaderboards`. The address (`slug`) never changes, so a renamed dog keeps its links. `photo` is a JPEG, PNG or WebP data URL of at most 300 KB decoded, or `null` to remove it |
| `GET /api/dogs/:slug/photo` | team | The photo as image bytes, cached for 5 minutes |
| `DELETE /api/dogs/:slug/members/:userId` | owner | Remove someone from the team. Not yourself |
| `POST /api/dogs/:slug/invites` | owner | Invite link, single use, 14 days |
| `GET /api/dogs/:slug/invites` | owner | Invites not used yet. No link tokens |
| `DELETE /api/dogs/:slug/invites/:id` | owner | Cancel an unused invite |
| `GET /api/invites/:token` | anyone with the link | Dog name and role, for the join screen |
| `POST /api/invites/:token/accept` | signed in | Join the team |
| `POST /api/dogs/:slug/walks` | team | Save a walk. `type` is one of the ids in `ACTIVITY_TYPES` (`src/data.js`); timed sessions have `miles` 0 and no route. Optional `avgSpeed`, `maxSpeed` (mph, 0 to 40), `sprints` (0 to 500), `movingMinutes`, `runMinutes` (not above `minutes`) |
| `GET /api/walks/:id` | team | One walk with its full route |
| `DELETE /api/walks/:id` | the walker, or the owner | Delete a walk and its paws |
| `POST` and `DELETE /api/walks/:id/paw` | team | Give or take back a paw |
| `GET /api/feed` | signed in | Walks for all your dogs, newest first. `limit`, `cursor`, optional `dog` |
| `GET /api/dogs/:slug/members/:userId` | team | One person's totals with the dog (last 7 days, all time, share of the week) and their outings. No email |
| `PATCH /api/dogs/:slug/members/:userId` | owner | `{ role }` changes someone's role. Not an owner's |
| `GET /api/dogs/:slug/health` | team | Every health entry plus a computed summary: activity from saved walks (last 7 days against the 4 weeks before, active days, streak, 8 weeks, by type, top speed, sprints, bests), weight change, goal progress, vaccines due. `tz` is the browser's `getTimezoneOffset()` |
| `POST /api/dogs/:slug/health` | team | Add an entry. `kind` is `weight`, `vaccine`, `medication`, `vet_visit`, `condition` or `note`. Optional `documentId` links one of the dog's documents |
| `PATCH` and `DELETE /api/health/:id` | whoever added it, or the owner | Edit or delete an entry |
| `POST` and `GET /api/dogs/:slug/health/shares` | owner | Create or list "Share with the vet" links. 14 days, only a hash of the token is stored |
| `DELETE /api/dogs/:slug/health/shares/:id` | owner | Turn a vet link off |
| `GET /vet/:token` | anyone with the link | Print-friendly health summary, plain HTML, `noindex`. 404 once expired or turned off |
| `GET /vet/:token/doc/:id` | anyone with the link | A document the owner ticked "include in vet summary", only while the link works |
| `GET /api/dogs/:slug/documents` | team | Document list, metadata only |
| `POST /api/dogs/:slug/documents` | team | `{ name, category, notes, file }` where `file` is a data URL. PDF, JPEG, PNG or WebP by magic bytes, 5 MB each, 50 MB per dog. This one route allows a 7.2 MB body and checks sign-in before reading it |
| `GET /api/documents/:id/file` | team | The bytes, with `nosniff`, a sanitized filename and a `sandbox` content security policy |
| `PATCH` and `DELETE /api/documents/:id` | the uploader, or the owner | Rename, recategorize, notes, delete. Only the owner sets `inVetSummary` |
| `GET` and `POST /api/dogs/:slug/awards` | team | Recorded awards, plus Trot's earned badges computed from walks. Only the owner sets `public` |
| `PATCH` and `DELETE /api/awards/:id` | whoever added it, or the owner | Edit or delete an award |
| `GET /api/events?near=lat,lng&from=YYYY-MM-DD` | anyone | Upcoming events, soonest first, at most 100, within about 60 miles when `near` is given. First names only |
| `POST /api/events` | signed in | Add an event. The link must be http or https. Rate limited per person |
| `DELETE /api/events/:id` | whoever added it | Not for curated events |
| `PUT` and `DELETE /api/events/:id/entries/:slug` | team | Mark a dog `going`, `entered` or `attended` with a `result`, or take it off |
| `GET /api/dogs/:slug/events` | team | Every event the dog was marked for |
| `GET /api/leaderboards?period=week|month&metric=miles|minutes|outings|top_speed&scope=all|breed|city|size` | anyone | Public dogs that have not opted out, ranked from saved walks. Dog name, slug, breed, photo and value only. Top 50, plus the caller's own dog's rank with `dog=<slug>` |
| `GET /api/challenges`, `GET /api/challenges/:key` | anyone | The challenges defined in server code, with windows, and progress for `dog=<slug>` when signed in. The second adds a board of public joined dogs |
| `POST` and `DELETE /api/dogs/:slug/challenges/:key` | team | Join or leave. Idempotent |
| `GET /api/pack` | anyone | Recent outings of public dogs, with what their public pages show |
| `GET /api/places?s=&w=&n=&e=` | anyone | Community and curated dog places in a box of at most about 1 degree per side, at most 300 |
| `POST /api/places` | signed in | `{ name, category, lat, lng, note }`. The adder is the first confirmation. Rate limited per person |
| `POST` and `DELETE /api/places/:id/confirm` | signed in | Confirm or take back "dogs welcome here". Idempotent |
| `DELETE /api/places/:id` | whoever added it | Not for curated places |
| `GET /api/geo/...` | anyone | Shared cache for OpenStreetMap lookups (`server/geo.js`) |
| `GET /api/public/dogs/:slug` | anyone | Public dogs only. No routes unless `share_routes` is on. Includes awards the owner made public |
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
- No comments or followers yet. Signed in, those are left out rather than filled with sample numbers.
- **Demo dogs.** Eleven made-up dogs with made-up people and four to six weeks of generated walks are seeded at every start (Boston, MA and around Eastover, Myers Park and Dilworth in Charlotte, NC). They are marked `is_demo`, labelled "Demo dog" on their public pages, leaderboard rows and pack cards, and their people use `@example.invalid` addresses that cannot sign in. Their walks are rebuilt at each start so they stay recent. See `SEED_DEMO` and `DEMO_ON_LEADERBOARDS` above to turn them off.
- **Health is a notebook, not advice.** Entries are whatever the care team types. The daily goal is the owner's own number. Trot does not work out a healthy range from breed or weight when signed in, and nothing is veterinary advice. Health dates are stored as text dates. A vet link shows the summary to anyone who has it until it expires or is turned off.
- **Tracking levels.** Level 2 (AirTag) and Level 3 (fitness tracker) are descriptions of what is planned. No AirTag link is stored and no tracker is connected, so signed in there are never tracker numbers. Connections all read "Coming soon".
- **Plans are a preview.** Choosing a plan is remembered in the browser only. There is no billing and nothing is locked.
- **Speeds** come from the phone carried on the walk, so they are the pair's speed, not the dog's own. A connected collar is needed for that.
- **Documents** are stored in the database as text (up to 5 MB each, 50 MB per dog). That suits a trial. Production needs object storage. Only PDF, JPEG, PNG and WebP are accepted, checked by their first bytes, and every file is served with `nosniff` and a `sandbox` policy. Files are not scanned for malware.
- **Awards and events are self-reported.** Trot does not check an award, a result or an event. Fifteen shows in `server/seed-events.json` come from public listings and carry their source link. Dates can change, so check with the organiser. Their coordinates are city-level and are only used for the nearby filter.
- **Curated places.** `server/seed-places.json` lists 22 Charlotte dog parks, dog bars and patios from public listings, each with its source. Dog policies, hours and fees change, so check the source before visiting. Each address is looked up once with OpenStreetMap Nominatim after the server starts (one request a second). A place stays off the map until its lookup works, and is tried again at the next start.
- **Leaderboards and challenges** use UTC weeks (Monday start) and months, count public dogs only, and leave daycare days out. They are computed on each request, which suits a trial but not a large one. With few dogs the ranks mean little, and the screen says so.
- Settings is one tap away from Home, People and the dog tab. The Explore and Walk screens do not have the gear yet.
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

- Real, signed in: accounts (trial sign-in), dogs with an editable profile and photo, care teams and invites, saved walks with performance statistics, paws, per-person totals, the public dog page, health records and the vet link, documents, awards and earned badges, events, leaderboards, challenges, community places.
- Made up but stored on the server: the demo dogs and their people (see Trial limitations).
- Real in both modes: recording with Live GPS, story card image, maps (OpenStreetMap data via CARTO tiles).
- Demo only: the dog pictures, which are original illustrations drawn in code (`src/portraits.jsx`), not photographs. Biscuit's and Millie's history, people, the pack, park stats, health data, documents, awards, sample boards and challenges, Level 3 tracker cards, route playback at 40x speed, and every connection (Trot Tag, AirTag, Instagram, Strava, Garmin, Apple Health, collars, AllTrails, vet records). Demo walks are kept in the browser.
- Place coordinates and sample routes are approximate samples around Cambridge, MA.
