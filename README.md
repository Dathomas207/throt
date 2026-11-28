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
| `GET /api/routes` | you | Your saved routes, newest change first. `filter=favorites` narrows to starred ones. `filter=recent` instead returns up to 10 distinct routes worked out from your own recorded outings (not saved rows). `near=lat,lng` adds each route's distance and sorts nearest first. Lists carry a line thinned to 160 points |
| `GET /api/routes/:id` | you | One saved route with its whole line and, for a built route, its control points |
| `POST /api/routes` | you | `{ name, points, control, favorite, dog, kind, clientId }`. `points` is 2 to 2000 `[lat, lng]` pairs; length and time are worked out by the server. `control` is `{ points, modes }` so the route can be edited again. 200 routes per person. The same `clientId` again answers with the route already there |
| `PATCH /api/routes/:id` | you | `name`, `favorite`, `points` with `control` when the route was edited again, and `usual` with `dog` to make it that dog's usual walk (one favorite per dog) |
| `DELETE /api/routes/:id` | you | Deletes the saved route. Outings that followed it are kept |
| `POST /api/walks/:id/route` | team | Keeps the line of an outing as a `walked` route of your own, optionally `{ favorite: true }`. Asking twice answers with the same route |
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
| `GET /api/dogs/:slug/friends` | team | The dogs this dog follows, newest outing first. Each is `{ slug, name, breed, photoUrl, city, isDemo, lastOuting, mutual }`, where `lastOuting` is `{ type, title, startedAt, place, with }` (first name) or `null`. Also `canManage` and `invite` (`{ path, url }`, or `null` for a private dog) |
| `PUT` and `DELETE /api/dogs/:slug/friends/:otherSlug` | owner, family | Follow or unfollow another dog. Only public dogs can be followed: a private one answers 404, the same as a missing one. Both are idempotent. Up to 100 friends per dog |
| `GET /api/dogs/:slug/friends/feed` | team | The 30 most recent outings of the public dogs this dog follows, in the same shape as `/api/pack` |
| `GET /api/dogs/:slug/friends/suggestions` | team | Up to 12 public dogs not followed yet: same city first, then most recently active. Never your own dogs. Each also carries `sameCity` and `followsYou` |
| `GET /api/dogs/search?q=&dog=` | signed in | Public dogs whose name starts with `q`. At least 2 characters, at most 10 answers, 30 searches a minute per person. With `dog=<slug>` (a dog you are on the team of) that dog is left out and each answer carries `following` |
| `GET /api/live/friends` | signed in | Live walks of your mutual friends, see "Friends out now" below. Each is `{ slug, name, photoUrl, with, activity, minutesOut, lastSeenSeconds, position, place }`. `position` is `{ lat, lng }` rounded to 4 decimals, or `null` while the walker is near where they started or near their usual start. `place` is the name of a listed place within 75 m, or `null` |
| `POST /api/live/start` | team | `{ dog, activity, lat, lng, source: 'gps', elapsedSeconds }` starts or replaces your one live walk. `lat` and `lng` are where the walk began. The dog has to be public. Anything without `source: 'gps'` is refused |
| `POST /api/live/ping` | you | `{ lat, lng }` replaces your position. A ping less than 5 seconds after the last one is ignored. 404 when you are not sharing or the walk has expired |
| `POST /api/live/stop` | you | Deletes your live walk. Idempotent. Saving an outing does the same |
| `GET` and `PUT /api/live/settings` | you | `{ shareByDefault }`, the "Share my walks with friends by default" setting. Off until you turn it on |
| `POST /api/walks/:id/photos` | team | `{ photo }`, a JPEG data URL. At most 700 KB decoded, real JPEG bytes, at most 4096 px on a side, 6 per outing. Answers `{ photo: { id, url, w, h, mine }, count, max }` |
| `GET /api/walks/:id/photos/:photoId` | team | The photo as image bytes. Private, cached for 5 minutes, ETag is the content hash |
| `DELETE /api/walks/:id/photos/:photoId` | whoever added it, owner, family | Delete one photo |
| `GET /api/public/walks/:id/photos/:photoId` | anyone | Public dogs only. The photo as image bytes. With the matching `?v=<hash>` it may be cached for a week. 404 for a private dog |
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
| `GET /d/:slug` | anyone | The public dog page, plain HTML with link preview tags. Shows the photos on each outing. With `?add=1` (the friend invite link) it adds an "Add <name> as a friend on Trot" button that opens the app at `/?friend=<slug>` |

JSON never carries the photo itself. Dogs and walks carry a `photoUrl` (or `null`) that points at one of the photo endpoints, with a `v` value that changes when the photo does. The team endpoint needs the session token, so the app fetches it and shows it from memory. Request bodies are capped at 400 KB, except `PATCH /api/dogs/:slug`, which allows 420 KB to fit a photo.

Every walk in every feed carries `photos: [{ id, url, w, h }]`: the first three in lists (`/api/feed`, `/api/dogs/:slug`, `/api/pack`, the friends feed), all of them (up to 6) in `GET /api/walks/:id` and on the public dog. On `GET /api/walks/:id` each photo also has `mine`. Addresses in your own feeds need the session token; addresses in the pack, the friends feed and the public dog are the public ones.

## Friends and outing photos

**Friends are dog to dog.** A dog follows another dog (table `dog_follows`). In the app, a dog's friends are the dogs it follows, and when both follow each other it says "Friends with each other". There are no requests to approve and nobody is notified: following a dog only puts its public outings in your Friends feed. Only public dogs can be followed, suggested, searched or shown in a feed, and a dog that goes private drops out of all of them. The owner and family manage a dog's friends; walkers and daycare can see them. Nothing in these endpoints carries an email, a full name, an address or a route (a route appears only when that dog shares routes on its public page).

**Finding friends.** A web app cannot read the phone's contacts, and Trot does not try to. There are three ways to find a dog: search by the start of its name, pick from the suggestions (same city first), or send the dog's invite link, `<origin>/d/<slug>?add=1`. The link opens the public page with an "Add as a friend" button. That opens the app at `/?friend=<slug>`, where a signed-in person confirms which of their dogs is making friends. For someone signed out the link waits in `sessionStorage` until they have signed in and have a dog, then the same question is asked. The Friends screen copies the link, and uses the Web Share API where the browser has it.

**Photos come from the system photo picker.** A web app cannot browse or sync the Photos library on its own. "Add from Photos" opens the picker (`<input type="file" accept="image/*" multiple>` with no `capture`, which on an iPhone opens Photos and offers the camera beside it), and only the pictures the person chooses are read. It is on the finish step of a recording, on an outing's detail screen, and on the dog profile photo.

- Each photo is fitted inside 1600 px on its long side and re-encoded as a JPEG in the browser (`fitJpeg` in `src/photo.js`), with EXIF orientation applied first. Quality steps down, then size, to stay under 600 KB.
- **Photos are re-encoded in the browser, so embedded GPS data is not uploaded.** The re-encode keeps the pixels and drops the EXIF block. The server strips nothing: it validates and stores what arrives.
- The server accepts JPEG only, checks the first bytes and the frame header, and caps a photo at 700 KB decoded, 4096 px on a side, and 6 photos per outing. Photos are stored as base64 text in `walk_photos` for the trial, like documents.
- On a new recording the outing is saved first and the photos go up after, one at a time, each with its own progress and its own error with a retry. A photo that fails never undoes the save.
- Anyone on the care team can add photos to an outing. The person who added a photo, the owner and family can delete it. Deleting an outing deletes its photos.
- A public dog's outing photos are public: they show on the public page, in the pack and in friends' feeds. Making the dog private takes them down from all three. A browser that already fetched a public photo may keep its copy for up to a week.
- The Today screen uses the dog's newest outing photo as a dimmed banner behind the greeting, and falls back to the plain card when there is none.
- In the no-sign-in demo, Biscuit and Millie have a few sample friends and two sample outing photos (`public/biscuit-wide.jpg`, `public/millie.jpg`). Adding a friend there only says it needs an account, and "Add from Photos" previews the picked picture from the device without uploading it.
- The seeded demo dogs follow each other within their city (`DEMO_FOLLOWS` in `server/seedDemo.js`). They have no outing photos.

## Route builder, favorites and recent routes

**Build a route** (Explore, and the Plan a route tile on Today) opens with a route already on the map: a 2 mile loop from where you are when the browser has already been allowed to share the location, or from the middle of the map with a Use my location button when it has not. Opening the screen never asks for the location. Distance chips (1, 2, 3, 5 mi), Loop or Out and back, and Shuffle change the suggestion. If the routing service does not answer, the screen shows straight lines marked approximate with a Retry.

**Edit** shapes the route road by road (`src/routeEdit.js`, which has no network code: the router is passed in, and `server/routes.test.js` tests it with a fake one).

- A route is control points with one leg between each pair. Dragging a point asks the router for the two legs beside it and nothing else. Tapping the line cuts that leg in two at the tap without asking for anything, and the new point can then be dragged onto another road. Tapping the map away from the line adds a point at the end, or before the return leg of a loop. With a point selected, a tap on the map only clears the selection.
- A selected point offers Remove, Make start and, on the last point, Close the loop back to start. Each leg can be set to Follow paths or Straight line. A straight leg is dashed and counts in the distance. Undo and Redo keep 40 steps. Reverse direction, Clear and Done finish the set.
- The leg list names each leg by the road or path it mostly follows, from the router's step names (Mapbox when `MAPBOX_TOKEN` is set, the public OSRM foot server otherwise). A leg with no name reads Path, or Unnamed road when Mapbox says it is a street. OSRM does not say which, so its unnamed legs all read Path.
- Legs are remembered in memory by their endpoints rounded to five decimals. A newer edit cancels the request before it. A route has at most 25 points.

**Saved routes** are private to the person who saved them. Nobody else on a dog's care team can list, open or change them. Signed in they are kept on the account (table `routes`, 200 per person). In the demo they are kept in this browser only (`localStorage`, newest 20 plus every favorite), and the app says so. Routes saved on a device before signing in are copied to the account once per person; the server matches them by the id they had on the device, so a repeat makes no second copy.

- **Favorites** are starred routes. One favorite per dog can be the **usual walk**, which Today offers first with a Start button.
- **Recent** is the last 10 distinct routes from your own recorded outings that have a line. Two walks count as the same route when they start within 150 m of each other, their lengths are within 12 percent and at least 80 percent of each line, sampled at 24 points, lies within 60 m of the other (`similarRoutes` in `server/routesSavedRoutes.js`). A recent route is not a saved row until you save or star it.
- After an outing with a line is saved, the finish screen offers Save this route and Add to favorites. The outing's own page has the same two buttons.
- A walk started from a saved route sends that route's id with the outing. The server links the two, adds one to the route's count and moves its last-walked date. A route id that is not yours is ignored and the outing is saved without a link.
- A route kept from a walk has no control points. Edit picks up to 12 along its line by Douglas-Peucker simplification, and each leg keeps the recorded line until it is moved.

What is not built yet: sharing a saved route with the care team, a keyboard way to move a point, and turn guidance during a walk.

**Walking a planned route.** Signed in, a walk started from a planned or saved route (the builder's Start, a favorite, the usual walk on Today, a route planned in Explore, Loop from here) is a real Live GPS walk. The planned route is drawn as a light dashed guide line, the line that is saved is the one the phone recorded, and the outing stays linked to the saved route so its count goes up. The walk screen shows distance walked beside the planned distance, and a quiet "Off the planned route" line when the newest fix is more than 60 m from the plan. There is no turn-by-turn guidance. "Just walk" is the default on the walk screen and records with no plan.

- If location is denied or unavailable, the walk screen says why and offers Try again and Record without GPS. A walk recorded without GPS keeps the time and, when a route was planned, the planned distance. It saves no line and is never shared with friends. The same choice is offered 20 seconds into a walk that has had no GPS fix at all.
- Playback of a route at 40x speed exists only in the no-account demo, where it is labelled "Demo x40" and listed under "Demo playback (sample routes)". Signed in, nothing is ever played back.

## Friends out now (live walks)

A person can share a Live GPS walk with friends while it is happening. Friends see a round pin with the dog's photo on the Explore map, and a line on Today such as "Moose is at Freedom Park now". Code: `server/routesLive.js`, `src/live.js` (shared words and rules, no network), `src/liveHooks.jsx` (hooks and screen pieces), `src/live.css`. Tests: `server/live.test.js`.

**Who counts as a mutual friend.** Follows are dog to dog and need no approval, so one follow alone shows nothing. A viewer sees a live walk of dog D only when one of the dogs the viewer is **owner or family** of follows D, and D follows that same dog back. Both rows in `dog_follows` have to exist for the same pair of dogs. D also has to be public, like everything else friends can see. Walkers and daycare on a friend dog's team do not see it. The walker can be anyone on D's care team who chose to share. One-way followers in either direction, signed-out visitors and the public page `/d/:slug` get nothing.

Privacy rules. All of them are enforced on the server and each has a test:

- **Off by default.** Sharing is a switch on the walk screen, before and during a walk. "Share my walks with friends by default" in Settings is off until the person turns it on, and is stored on the account (`users.share_walks_default`).
- **Mutual friends only.** See above. Unfollowing on either side, or making the dog private, hides the walk on the next read.
- **Only during a walk.** Sharing starts with the first good GPS fix of a walk that has sharing on. It ends when the walk is finished, discarded or saved, or when the switch is turned off. A live walk with no update for 10 minutes has ended: it is never returned and the row is deleted the next time the live endpoints are used. A live walk also ends 12 hours after it started.
- **Home hidden.** A position within 150 metres of where the walk started, or within 150 metres of the walker's usual start, is never stored and never returned. Friends see "Out on a walk" with no position and no place name. The usual start is the middle of the largest group of start points among the walker's last 200 saved walks that have a line (starts within 150 m of each other form a group, and a tie goes to the most recent). With no saved walks, only the current start is hidden. The check runs when a position arrives and again when it is read, on both the stored value and the rounded one.
- **No history.** One row per walker in `live_walks`, overwritten by each update and deleted at the end. There is no trail.
- **Never public.** Live positions are not in the heatmap, the public dog pages, the pack, usage events, notifications or logs. Positions travel in request bodies, never in an address, so they are not in access logs either. Nobody is notified when a walk is shared.
- **Rounded.** Stored to 5 decimals, returned to friends at 4 (about 11 m).
- **Real GPS only.** The app offers sharing only for a Live GPS walk on an account (`canShareLive` in `src/live.js`). Demo playback, timed sessions and walks recorded without GPS never share. The server refuses a start that does not say `source: 'gps'`. The server cannot prove where a position came from, so that part is a contract with the app, not a lock.

How it behaves:

- The walk screen sends the newest position about every 15 seconds. Explore asks who is out every 20 seconds, only while Explore is showing and the page is visible. Today asks once a minute.
- A pin turns grey and the sheet says "Last seen 3 min ago" once a friend has not been heard from for more than 90 seconds.
- **A web app only sends location while it is open on screen.** When the walker locks the phone or switches apps, updates stop. The pin stays where it was, turns grey, and the walk drops off after 10 minutes. If the walker comes back to the app later in the same walk, sharing starts again by itself.
- "Walk to them" draws a walking route from your location to where the friend was when you tapped. It does not follow them as they move. The request goes to the same routing service as every other route, with the two points and no names.
- "Friends out now" is a map layer in Explore, on by default. Turning it off stops the requests.
- In the no-sign-in demo, Explore and Today show two sample friends from `DEMO_LIVE` in `src/data.js`, labelled as samples. No request is made, and the switch on the walk screen says sharing needs an account.

Limits to know about: without email codes turned on, sign-in has no proof (see below), so anyone who can sign in as a mutual friend sees what that friend would. The usual start is one place, so a second regular start (a partner's home, an office) is only hidden when the walk starts there. The 5 second ping limit and the expiry are per row in the database, and the general rate limits are still in memory.

## Trial limitations

Read these before inviting anyone.

- **Sign-in.** With `WORKOS_API_KEY` and `WORKOS_CLIENT_ID` set, sign-in is a 6 digit code emailed through WorkOS, and sessions from before the switch are refused (see `docs/workos-setup.md`). Without them, sign-in is the old trial: a name and an email with no proof, so anyone who knows a person's email can sign in as that person. Turn codes on before inviting anyone you do not know.
- **Admins and listing managers rest on the same sign-in.** An admin is whoever signs in with an email in `ADMIN_EMAILS`, and a listing's manager is whoever signs in as the approved claimant. With email codes on, that means whoever can read that inbox. There is no endpoint yet to take a manager off a listing; approving another claim on the place replaces them, and otherwise it is a database edit (`UPDATE places SET managed_by = NULL, managed_role = NULL`).
- **Google Maps is a link only.** "Open in Google Maps" and Directions open Google in a new tab with our own name, address or pin in the address. Nothing is read from Google, stored, or drawn on the Trot map.
- An invite link works once and lasts 14 days. Whoever opens it first joins the team, so send it to one person. The owner can remove someone from the team and cancel an unused invite. A walk can be deleted by the person who logged it or by the dog's owner. There is no way yet to leave a team yourself or hand a dog to a new owner. Deleting your account (Settings, at the bottom) takes you off every team; the rule for shared dogs is in `server/deleteAccount.js`. Someone removed from a team can no longer delete the walks they logged, but the owner can.
- A dog's page is public by default: photo, name, breed, bio, totals, and the last 10 outings with title, note, place name, date, the walker's first name and any photos added to them. Route maps stay off the public page unless the owner turns them on. The owner can make the page private in Settings or in Edit profile. While the page is public, anyone can load the dog's photo from its address.
- The care team sees full routes, which usually start and end at home.
- Rate limiting is kept in memory. It resets on restart and is per instance, so it only suits a single small instance.
- The connection to managed Postgres is encrypted but the certificate is not verified unless `DATABASE_SSL=verify` is set.
- Signed in, the Walk screen and Explore still say Biscuit in places and show the walker as Dale. Walks are saved to the right dog and person all the same. Explore and the sample routes are centred on Cambridge, MA.
- A dog has one profile photo. It is cropped to a square of at most 512 px and saved as a JPEG in the browser before upload, then stored in the database as text (up to 300 KB each). That suits a trial. Move photos to object storage before there are many dogs. The server checks the type, the first bytes and the size, but does not re-encode the image. Browsers that cannot draw to a canvas cannot add a photo.
- The profile photo does not appear on the Walk and Explore screens or on the story card image yet. Outings can have up to 6 photos of their own (see Friends and outing photos). They are not on the story card image either.
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

The Xcode project is in `ios/` (Capacitor 8, Swift Package Manager). Follow `docs/ios-build.md` step by step. Short version: `npm install`, then `npm run ios:build`, pick your Team under Signing & Capabilities, and press Run. The native app calls the API at https://trot-app.onrender.com; the one place that decides this is `src/native/platform.js`. `docs/app-store-privacy.md` lists what the app collects for Apple's privacy questions.

## What is real and what is demo

- Real, signed in: accounts (email codes through WorkOS when configured, trial sign-in otherwise), account deletion, dogs with an editable profile and photo, care teams and invites, saved walks with performance statistics, paws, per-person totals, the public dog page, health records and the vet link, documents, awards and earned badges, events, leaderboards, challenges, community places.
- Made up but stored on the server: the demo dogs and their people (see Trial limitations).
- Real, signed in: sharing a Live GPS walk with mutual friends, and walking a planned route with real GPS. In the demo, friends out now are samples.
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

## Usage metrics, error capture and notifications

### What Trot measures

Trot counts a short, fixed list of events on its own server (`usage_events`). There is no third-party analytics, no ad tracker and no cookie. The browser helper is `src/usage.js` (`track(name, props)`); the server side is `server/routesUsage.js`.

Privacy rules, enforced on the server and tested in `server/metrics-notifications.test.js`:

- **No IP address, no location, no email, no free text from people.** A row holds: time, user id or a random browser id, event name, dog id, a small `props` object, the device family ("Safari on iPhone or iPad", never the user agent string) and the app version.
- **The browser id** (`trot-anon` in localStorage) is only used signed out and in the demo. A signed-in event carries the user and not the browser id.
- **Event names and prop keys are fixed lists.** Anything else is dropped. `props` is capped at 300 bytes.
- **Numbers are buckets.** Minutes: `under_10`, `10_30`, `30_60`, `over_60`. Miles: `none`, `under_1`, `1_3`, `3_5`, `over_5`.
- **Opt out with the browser.** When the browser sends Do Not Track or Global Privacy Control, `track()` sends nothing and no browser id is created.
- **No API, no counting.** On static hosting `track()` is a no-op.
- **The demo only counts looking around** (`app_open`, `tab_view`, `walk_started`, `walk_discarded`, `place_opened`, `route_built`, `route_edited`, `route_started`, `loop_from_here`, `plan_viewed`, `notification_opened`, `location_permission`, `client_error`). Sign-ups, saved walks, friends and the rest come from real accounts only.
- Rows older than 180 days are deleted.

The events, and the props each one keeps:

| Event | Props |
| --- | --- |
| `app_open` | `mode` (`demo` or `signed_in`), `standalone` (true when opened from the home screen) |
| `sign_up`, `sign_in`, `dog_created` | none |
| `tab_view` | `tab` |
| `walk_started` | `type`, `gps` |
| `walk_saved` | `type`, `minutes` bucket, `miles` bucket, `photos` count, `had_gps` |
| `walk_discarded` | none |
| `photo_added` | `count` |
| `friend_added`, `friend_removed`, `invite_link_copied` | none |
| `care_invite_sent`, `care_invite_accepted` | none |
| `place_opened` | `category`, `curated` |
| `place_confirmed`, `place_claim_sent`, `place_reported` | none |
| `route_built` | none |
| `route_edited` | `legs` (`1_2`, `3_5`, `6_10`, `over_10`) |
| `route_saved` | `kind` (`built`, `walked`) |
| `route_favorited` | none |
| `route_started` | `source` (`suggested`, `favorite`, `recent`, `built`) |
| `loop_from_here` | `result` (`ok`, `denied`, `timeout`, `unavailable`, `unsupported`) |
| `event_marked`, `tag_created`, `lost_mode_on`, `lost_mode_off`, `registration_saved` | none |
| `plan_viewed` | none |
| `notification_opened` | `kind` |
| `location_permission` | `state` (`granted` or `denied`) |
| `live_share_started`, `live_share_stopped`, `live_friend_opened` | none. No position, place or dog name |
| `client_error` | `message`, `kind`, `screen`, `method`, `path`, `status`, `code`, `n` |

`POST /api/usage` takes `{ v, anon | auth, events: [{ name, props, dog, ago }] }`: at most 20 events and 4 KB, signed in or out, rate limited per address (60 a minute). It always answers 204 and stores nothing it does not recognise. `navigator.sendBeacon` cannot set headers, so the batch goes as `text/plain` and a signed-in batch carries the session token in `auth`; the token is used to find the user and is never stored.

### Client errors

The app records window errors, unhandled promise rejections, React render errors (an error boundary around each lazy screen, each tab and the whole app shows a "Something went wrong on this screen" card with Try again), API calls that fail with a 5xx or cannot reach the server (never a 4xx), geolocation errors by code, and photos that could not be processed. Each becomes one `client_error` event:

- `message` is the first 200 characters with emails, tokens, ids, coordinates and long digit runs masked, in the browser and again on the server.
- `path` is a pattern with every id replaced (`/dogs/:id/walks`). Request bodies, coordinates and anything a person typed are never included.
- The same error is sent once per session; a count of repeats (`n`) follows when the page is hidden.

Settings, Help and diagnostics shows the app version (the short git commit, injected by Vite as `__APP_VERSION__` from `APP_VERSION`, `RENDER_GIT_COMMIT` or `git rev-parse`, otherwise `dev`), whether Trot runs as an installed app, online state, location permission, NFC reading, Web Share, the service worker state and the last 20 errors kept on that device. "Copy diagnostics" copies a plain text report with no personal data. "Send a test error" breaks that page on purpose to check the trail.

### Admin metrics

`GET /api/admin/metrics?days=14` (admins only, 403 for everyone else; `days` 1 to 90) answers daily active people, sign-ups and walks saved per day, the activation funnel for people who signed up in the window (signed up, created a dog, saved a first walk, saved a second walk, invited a care team member, added a friend), week-two return for the cohort that signed up 7 to 14 days ago (`rate` is null with the note "not enough data" under 5 people), top tabs, top events, and client errors grouped by message with a count and last seen. Days are UTC. Admins' own activity and events tied to demo seed dogs are left out; `?includeAdmins=1` puts the admins back. Everything is counted from `usage_events`, so people who opted out are not in it. Admins see the same numbers under Metrics in Settings.

### Notification center

In-app only: nothing is sent by push, email or text. Push needs the installed app and a later release.

| Kind | Who gets it |
| --- | --- |
| `friend_added` | Owner and family of the dog that was added, with an "Add back" action while it is not mutual |
| `friend_mutual` | Owner and family of the dog that was added back |
| `paw` | Owner, family and whoever logged the outing. One row per outing, rewritten as more paws arrive |
| `care_invite_accepted` | The person who made the invite |
| `care_walk_logged` | Owner and family, when a walker or daycare logs an outing |
| `found_report` | Owner and family. High priority, cannot be turned off. The finder's message and contact stay in tag activity |
| `registration_due` | Owner and family, when a license or rabies date has passed or is 30 days or fewer away |
| `event_reminder` | Owner and family, when an event the dog is going to starts within 3 days |
| `claim_approved`, `claim_rejected` | The claimant |
| `welcome` | Once, on first sign-in |

Nobody is notified about their own action, and seeded demo people never get rows. The two reminders are not scheduled: they are written when the person next reads their list or `GET /api/me`, once per item and date.

```
GET    /api/notifications?before=&limit=30   -> { items, unread, nextBefore }
GET    /api/notifications/unread             -> { unread }
POST   /api/notifications/read               { ids: [...] } or { all: true }
DELETE /api/notifications/:id
GET    /api/notifications/prefs              -> { prefs: { friends, paws, care, reminders }, always, channels }
PUT    /api/notifications/prefs              { friends?, paws?, care?, reminders? }
```

`GET /api/me` also carries `unread`, so the bell shows a number without a second request. The app checks again every 60 seconds while it is visible, and on focus. Server code can call `notify(db, userId, { kind, dogId, title, body, link, dedupeKey })` from `server/routesNotifications.js` anywhere; it respects the person's choices and never throws into its caller.

## Training

Short, reward-based lessons bundled with the app, a practice log per dog, and badges that follow from it. Everything is self-reported by the dog's family. Nothing in Trot certifies a dog, and real-world titles (for example the AKC's Canine Good Citizen) are earned through that organization's own evaluators and recorded under Awards.

- **Content** lives in `src/training/content.js`: six tracks (Foundations, Loose leash walking, Recall, Out and about, Trail and park, Tricks and fun), 32 skills, a "How dogs learn" primer and a puppy note. It is original to Trot and read offline. `server/training.test.js` lints it: every field present, 4 to 7 steps, 3 to 5 minute sessions, no aversive-method wording, no em dashes, ids matching the shared list.
- **Shared rules** live in `src/training/skills.js`, which both the browser and `server/routesTraining.js` import: skill ids, levels, the self-check questions, badge rules (`computeBadges`), streaks (`practiceStreak`) and the "next up" suggestion. `src/training/badgeArt.js` draws the badges for the app and the public page.
- **Levels**: 0 not started, 1 learning (first session logged), 2 reliable at home, 3 proofed out and about. Anyone on the care team logs practice. Only the owner or family confirms a level, by answering yes to three questions drawn from the lesson's pass standard. Level 3 needs level 2 and at least one session logged out and about.
- **Badges**: one per skill (level 2, upgraded at level 3), one per track (Bronze at half the track reliable at home, Silver at all of it, Gold at all of it proofed in public), plus First session, 7 day practice streak, 30 sessions, Patio pro, Trail ready and Good neighbor. They are computed, not stored. Earned ones join the badge list in the Awards card and show on the public dog page under "Self-reported by <dog>'s family". The public page never shows sessions or notes.
- **API**: `GET /api/dogs/:slug/training`, `POST /api/dogs/:slug/training/sessions`, `POST /api/dogs/:slug/training/skills/:skillId/level`, `DELETE /api/training/sessions/:id` (the author or the owner). Tables: `training_sessions`, `training_progress`.
- **Days and streaks** follow the `tz` the browser sends (minutes behind UTC), as health and compete do. Trot stores no time zone for a dog, so without it, and on the public page, days are UTC.
- **Notifications**: `training_badge` goes to the owner and family when someone else's session or confirmation earns a badge, never to the person who did it. The Reminders switch covers it.
- **Demonstrations**: each lesson opens with a short looping animation drawn in code (inline SVG, no images or libraries). `src/training/animScripts.js` holds 3 to 5 beats per skill, each tied to a lesson step and captioned from it; `poses.js` has the dog's poses and the blending, `cast.jsx` draws the dog, the person and the props, and `anim.jsx` plays it with play, pause and step controls. It loads with the lesson in its own chunk, stops when off screen or when the page is hidden, and shows a still storyboard when reduced motion is on. Like the lessons, it only shows reward-based handling.
- **Outside help**: `src/training/links.js` has a YouTube search per skill (a search, never a video id), free articles from training and animal welfare organizations with the date each link was checked, and certified trainer directories. "Find a trainer" also lists places from Trot's own index whose listing says they train, with their address and source. Outside links open in a new tab, or in Safari inside the iPhone app. Trot is not affiliated with any of these organizations.
- **Practice reminders**: `src/training/ics.js` builds a calendar file for daily or every-other-day sessions. The website downloads it; the iPhone app offers it through the share sheet when the phone supports sharing files, and hides the button when not. Earned badges can be shared with a link to the dog's public page when that page is public.
- **Usage events**: `training_opened`, `training_session_logged` (track, place), `training_level_confirmed` (level), `training_badge_earned` (tier).
