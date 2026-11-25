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
- `ADMIN_EMAILS`: comma-separated emails of the people who review place claims and reports, for example `ADMIN_EMAILS=dana@example.com,lee@example.com`. Anyone signed in with one of them is an admin and sees an Admin section in Settings. When unset there are no admins, every `/api/admin` route answers 403, and claims wait unreviewed. Read the note on sign-in under Trial limitations before setting it.

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
| `GET /api/me` | signed in | The user (with `isAdmin`), their dogs and roles |
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
| `GET /api/places?s=&w=&n=&e=` | anyone | Community and curated dog places in a box of at most about 1 degree per side, at most 300. Each carries `managedBy` (first name or `null`), `managedRole`, `managedByYou`, `dogPolicy`, `amenities`, `eventNote`, `website`, `lastCheckedAt`, `flagged` (3 or more open `closed` or `not_dog_friendly` reports) and, for the signed-in caller, `myClaim` (`pending`, `approved`, `rejected` or `null`) |
| `POST /api/places` | signed in | `{ name, category, lat, lng, note }`. The adder is the first confirmation. Rate limited per person |
| `POST` and `DELETE /api/places/:id/confirm` | signed in | Confirm or take back "dogs welcome here". Idempotent. Confirming sets `lastCheckedAt` |
| `DELETE /api/places/:id` | whoever added it | Not for curated places, and not once someone else maintains the listing |
| `POST /api/places/:id/claim` | signed in | `{ role, contactEmail, message }` asks to maintain a listing. `role` is `owner` for a business or `steward` for a park. One pending claim per person per place, none on a place that already has a manager. Rate limited per person |
| `PATCH /api/places/:id` | the approved manager | `dogPolicy` (`inside`, `patio`, `off_leash`, `leashed`, `unknown`), `note` (280), `amenities` (any of `water_bowls`, `treats`, `fenced`, `shade`, `dog_menu`, `waste_bags`), `eventNote` (140), `website` (https only, or `null` to remove). Sets `lastCheckedAt`. A curated place keeps its `sourceUrl` |
| `POST /api/places/:id/report` | signed in | `{ reason, note }` where `reason` is `not_dog_friendly`, `closed`, `wrong_location` or `other`. One open report per person per place. Rate limited per person |
| `GET /api/admin/claims?status=pending` | admin | Claims with the place, the claimant's name and both emails. `status` is `pending` (default), `approved`, `rejected` or `all` |
| `POST /api/admin/claims/:id/approve`, `POST /api/admin/claims/:id/reject` | admin | Decide a pending claim, once. Approving sets the place's manager and role |
| `GET /api/admin/reports` | admin | Open reports, oldest first. `status=resolved` lists the closed ones |
| `POST /api/admin/reports/:id/resolve` | admin | Close a report |
| `GET /api/geo/...` | anyone | Shared cache for OpenStreetMap lookups (`server/geo.js`) |
| `GET /api/public/dogs/:slug` | anyone | Public dogs only. No routes unless `share_routes` is on. Includes awards the owner made public |
| `GET /api/public/dogs/:slug/photo` | anyone | Public dogs only. The photo as image bytes. 404 for a private dog |
| `GET /d/:slug` | anyone | The public dog page, plain HTML with link preview tags |

JSON never carries the photo itself. Dogs and walks carry a `photoUrl` (or `null`) that points at one of the photo endpoints, with a `v` value that changes when the photo does. The team endpoint needs the session token, so the app fetches it and shows it from memory. Request bodies are capped at 400 KB, except `PATCH /api/dogs/:slug`, which allows 420 KB to fit a photo.

## Trial limitations

Read these before inviting anyone.

- **There is no password and no email verification.** Sign-in is a name and an email. Anyone who knows a person's email can sign in as that person, see their dogs and walks (including routes), and post as them. Do not put anything in Trot during the trial that you would not want a stranger to see. Real sign-in (emailed links or passkeys) has to come before a wider launch.
- **Admins and listing managers rest on the same sign-in.** An admin is whoever signs in with an email in `ADMIN_EMAILS`, and a listing's manager is whoever signs in as the approved claimant. Because sign-in does not verify the email yet, anyone who knows one of those addresses can act as that person: approve claims, or change a listing's dog policy. Keep `ADMIN_EMAILS` to addresses that are not public, and put real sign-in in place before vendors rely on their listings. There is no endpoint yet to take a manager off a listing; approving another claim on the place replaces them, and otherwise it is a database edit (`UPDATE places SET managed_by = NULL, managed_role = NULL`).
- **Google Maps is a link only.** "Open in Google Maps" and Directions open Google in a new tab with our own name, address or pin in the address. Nothing is read from Google, stored, or drawn on the Trot map.
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

## Registration and ID, Trot Tag and Lost Dog mode

Each dog has a registration record (microchip, license, rabies tag, AKC number, spayed or neutered), any number of Trot Tags, and a Lost Dog switch. It is all under "Registration and ID" on the dog tab. Code: `server/routesRegistration.js`, `server/tagPage.js`, `src/screens/Registration.jsx`, `src/screens/LostDog.jsx`, `src/qr.js`. Tests: `server/registration.test.js` (loaded by `server/index.js` under `node --test server/`).

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/dogs/:slug/registration?tz=` | care team | The record, a checklist (microchip, license, rabies: `done`, `missing`, `expiring` within 30 days, `expired`), `canEdit`, and the link-out addresses |
| PUT | `/api/dogs/:slug/registration` | owner, family | Saves the fields that are sent. A microchip number must be 15 digits, 10 characters of 0-9 and A-F, or 9 digits; spaces and dashes are dropped before it is stored |
| GET | `/api/dogs/:slug/lost` | care team | Lost Dog state: `on`, `since`, `note` |
| PUT | `/api/dogs/:slug/lost` | owner, family | `{ lost, note }`. The note is 140 characters at most. Turning it on makes one link for the public page if the dog has none |
| GET | `/api/dogs/:slug/tags` | owner, family | Tags, working ones first |
| POST | `/api/dogs/:slug/tags` | owner, family | Makes a tag (`{ label }`) and answers its address, `<origin>/t/<code>`. Ten working tags per dog |
| DELETE | `/api/dogs/:slug/tags/:id` | owner, family | Retires a tag. The address stops working at once and is never reused |
| GET | `/api/dogs/:slug/tags/scans` | care team | The last 100 scans and found reports, the unread count and the Lost Dog state |
| POST | `/api/dogs/:slug/tags/scans/:id/read` | owner, family | Marks a found report as read |
| GET | `/t/:code` | anyone | The tag page (HTML). Records one scan per visitor per ten minutes |
| GET | `/t/:code/photo` | anyone | The dog's photo, while the tag works |
| POST | `/t/:code/found` | anyone, only while the dog is reported lost | A found report: optional first name, message (280), phone or email, and `lat` and `lng`. Form posts get a redirect back to the page, JSON posts get `{ ok: true }` |

Privacy rules. The server-side ones are covered by tests:

- **Registration never leaves the care team.** It lives in its own table. `/d/:slug`, `/t/:code` and every `/api/public` endpoint never read it. Walkers and daycare can read it and cannot change it.
- **A microchip is not a tracker.** It is a passive chip that holds an ID number, read by a vet or shelter scanner at very close range. It cannot locate a dog and phones cannot read it. The screen says so.
- **Trot files nothing.** It does not register a chip or license a dog. It stores what the owner types and links to the AAHA Universal Pet Microchip Lookup (which names the registry for a chip number and shows no owner details) and, for Charlotte-Mecklenburg, to PetData, which runs licensing for CMPD Animal Care & Control. No fee amounts are stored or shown.
- **The tag page shows the dog and nobody else.** Name, photo and breed. No person's name, phone, email or address, no city, no walks or routes. The same holds for the "Reported lost" banner on `/d/:slug`.
- **Unknown and retired codes look the same.** Both get one identical "No dog on this tag" page.
- **No IP address is stored.** Repeat views are folded with a salted hash kept in memory only. A scan row holds the time and the family of the device ("Safari on iPhone or iPad"), not the user agent string. Link previews and bots are not counted.
- **A finder's location is theirs to give.** It is sent only if they tap "Share my location", and they can remove it before sending. The care team gets a plain Google Maps link, with no Google API involved.
- **Limits.** The tag page is `noindex`, `no-store`, with a strict Content-Security-Policy that allows one fixed script by hash. Found reports are capped at 5 an hour per connection and 30 an hour per tag, the body at 4 KB, and all text is stored as plain text with control characters removed.
- **Reminders are in the app only.** An expiring or expired license or rabies vaccine shows as a banner on the dog tab. There are no emails and no push notifications, so a found report is seen the next time someone on the care team opens Trot (the screen checks again every minute while it is open).
- **Lost Dog mode is listed under Trot Plus.** Plans are a preview in this trial, so the switch is not locked.

### Trot Tag for the trial

1. Sign in, open your dog's tab, and tap **Registration and ID**.
2. Under **Trot Tag**, tap **Make a Trot Tag**. Tap **Copy address**.
3. Get a blank NFC sticker or collar tag. With an NFC writing app on your phone, write a URL record and paste the address. Tap the sticker to check that the dog's page opens.
4. No sticker yet? Tap **Show QR code** and scan it with another phone's camera. It holds the same address and is drawn on the device, with no outside service.
5. To try a found report: tap **Report (name) lost**, confirm, then open the tag address on another phone, fill in "I found (name)" and send. A red banner shows on Home and on the dog tab, with **Open in maps** if a location was shared and **Mark as read**. Tap **(name) is home** when you are done.
6. Lost a tag? Tap **Retire this tag** and make a new one.

Known gaps: the tag page only offers the found form while the dog is reported lost, so a finder who taps a tag before the owner notices can only be seen as a scan under Tag activity. A deployment needs `PUBLIC_URL` (or Render's own address) set so tag addresses carry the public host. The demo's Settings screen still describes an older idea of "Trot Tag" as a Bluetooth beacon; the tag built here is NFC and QR only.
