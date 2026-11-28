# What Trot collects: answers for App Store Connect

App Store Connect asks what data the app collects, under **App Privacy**. This page lists what the Trot iPhone app and the Trot server really do today, so the answers can be truthful. It was written from the code: `src/usage.js`, `server/routesUsage.js`, `src/api.js`, `src/photo.js` and the tables in `server/db.js`.

Review this page again whenever a feature is added. The same facts are declared in `ios/App/App/PrivacyInfo.xcprivacy`, so keep the two in step.

## The short answers

- Does the app collect data: Yes.
- Is any data used to track people across other companies' apps and websites: No. There is no advertising, no advertising identifier, no third-party analytics and no data broker.
- Is data linked to the person's identity: Yes, for a signed-in account. In the Biscuit demo nothing is saved to the server except anonymous usage counts.

## Data types to declare

For every row below, "Used for tracking" is No.

| Apple's data type | What Trot collects | Linked to the person | Purpose to tick |
| --- | --- | --- | --- |
| Contact Info: Name | The display name typed at sign-in. The first name is shown to the dog's care team and on public outings | Yes | App Functionality |
| Contact Info: Email Address | The email typed at sign-in. Also a contact email typed when claiming a place listing | Yes | App Functionality |
| Location: Precise Location | The GPS route of a walk while it is being recorded, saved with the walk. The current position during a live walk shared with friends. The map position used to find nearby places, events and weather | Yes | App Functionality |
| Health & Fitness: Fitness | Walk time, distance, speed and activity type. This describes an outing with the dog, and Apple's category is the closest fit | Yes | App Functionality |
| User Content: Photos or Videos | Only the photos the person picks or takes: the dog's profile photo and photos added to outings. They are shrunk and re-encoded on the phone first, which removes the camera details and any location stored in the photo | Yes | App Functionality |
| User Content: Other User Content | The dog's profile, notes on outings, health entries about the dog, registration details (microchip, licence and rabies tag numbers), uploaded documents such as vet records, awards, training logs, places and events the person adds, and reports about places | Yes | App Functionality |
| Identifiers: User ID | The account id. For someone not signed in, a random id made on the device and used only for usage counts | Yes | App Functionality, Analytics |
| Usage Data: Product Interaction | First-party usage events from a fixed list, such as app opened, tab viewed, walk saved. See below | Yes | Analytics |
| Diagnostics: Other Diagnostic Data | App error messages, cut to 200 characters with emails, tokens, ids and long numbers masked, plus the screen name and the API path pattern | Yes | App Functionality |

Data types Trot does not collect: phone number, physical address, payment or financial information, contacts, browsing or search history across other apps, health data about people, sensitive information, advertising data, device ID, audio, messages.

## Usage events in detail

The app sends usage events to the Trot server only, at `/api/usage`. No other company receives them.

- What is sent: an event name from a fixed list (for example `app_open`, `tab_view`, `walk_saved`, `friend_added`), a few fixed-word properties, the app version, and how long ago it happened.
- What is never sent in an event: coordinates, names, typed text, exact minutes or miles. Durations and distances go as ranges such as "10 to 30 minutes".
- Who it is tied to: the account, when signed in. A random device id when not.
- What the server keeps with it: the device family (for example "Safari on iPhone or iPad"), never the full user agent. No IP address is stored.
- How long: rows older than 180 days are deleted.
- Opt-out: on the website, the browser's Do Not Track or Global Privacy Control setting stops all usage events. The iPhone app has no such setting, so events are always sent there. Say so in the privacy policy, or add an in-app switch.

## Location in detail

- When: only while a walk is being recorded, while a live walk is being shared, or while the person uses a map screen or "Near me". The app asks for "While Using the App" and never for "Always".
- Background: a walk that was started on screen keeps recording when the phone is locked. iOS shows the blue location indicator while that happens.
- Where it goes: the recorded route is saved with the walk on the Trot server. The dog's care team can see full routes. Routes stay off the public dog page unless the owner turns them on. A live walk is shown only to mutual friends, with the position hidden near the start.
- Not used for: advertising, or anything outside the app's own features.

## Other companies the app talks to

The app loads maps and looks things up from these services directly. Each request carries the phone's IP address, as any web request does, and the map area or search text needed to answer it. None of them receives the person's name, email or account id from Trot.

- CARTO: map tiles.
- Mapbox: map tiles, place search and walking directions, when the server has a Mapbox token configured. The token in the app is the public `pk.` token.
- OpenStreetMap services (Overpass, Nominatim, the OSRM routing server): nearby parks and paths, place search, and walking routes.
- Google Fonts: the two typefaces.
- Google Maps: only as a link the person taps. Nothing is sent until they do.

The server, not the app, also talks to:

- WorkOS: when email codes are on, the server sends WorkOS the email address to sign in with, WorkOS emails the code, and the server sends the code back to WorkOS to check it. WorkOS keeps a user record with that email until the account is deleted in Trot, which deletes it there too. This makes WorkOS a processor of email addresses and should be named in the privacy policy.

Apple's form asks about data that you or your third-party partners collect. Map and routing requests are needed for the feature the person is using and are not linked to their identity by Trot. Many apps do not list these, but the privacy policy should name the services.

## Things that are public

A dog's page is public by default: photo, name, breed, bio, totals and the last 10 outings with the walker's first name and any photos. The owner can make it private. Mention this in the privacy policy and in the review notes, because reviewers ask about content other people can see.

## What the privacy policy still has to say

There is no privacy policy yet. App Store Connect requires a public URL for one. At minimum it should cover: what is collected (this page), why, who can see it (care team, friends, the public page), the outside services above, how long data is kept, how to ask for deletion, and a contact address.

One thing the policy cannot honestly promise yet:

- Verified sign-in, until email codes are turned on: without them, sign-in is a name and an email with no proof, so an account is only as private as its email address.

Account deletion now exists (Settings, Delete my account). The policy should say what it removes: the account, dogs only that person owns with everything on them, and their own data. Walks they logged on someone else's dog stay on that dog, shown as from a former member.
