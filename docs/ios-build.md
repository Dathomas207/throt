# Trot on the iPhone: build, run and TestFlight

Trot's iPhone app is the same web app, bundled into a native shell with Capacitor 8. The built files from `dist/` ship inside the app. The app talks to the Trot server at `https://trot-app.onrender.com` for accounts, dogs and walks.

This guide assumes you have never opened Xcode. Follow the steps in order.

## What you need

- A Mac: Xcode only runs on macOS. Install the latest Xcode from the Mac App Store, open it once, and accept the licence and the extra components it asks to install.
- Node.js 20 or newer: check with `node -v` in Terminal.
- An iPhone and its cable.
- An Apple ID: enough to run the app on your own phone. Builds made with a free Apple ID stop opening after 7 days.
- Apple Developer Program membership (99 US dollars a year): needed for TestFlight, push notifications and NFC. Enrol at developer.apple.com/programs. Approval can take a day or two.

You do not need CocoaPods. The project uses Swift Package Manager, which is built into Xcode.

## Before the first build: one server change

The app's pages load from `capacitor://localhost`, so every API call is cross-origin. The server has to allow that origin, or the app opens in the Biscuit demo and never offers sign-in.

The code is in `server/cors.js`. It needs two lines in `server/app.js`, then a deploy:

    import { nativeCors } from './cors.js'
    // inside createApp, straight after the X-Content-Type-Options middleware:
    app.use(nativeCors())

To check that the deployed server has it, run this in Terminal. The answer must include `access-control-allow-origin: capacitor://localhost`:

    curl -si -H "Origin: capacitor://localhost" https://trot-app.onrender.com/api/health | grep -i access-control

## Where the app id and name live

- App id (bundle identifier): `com.trotdogs.app`
- App name: `Trot`

Both are set in `capacitor.config.json` at the top of the repo, and the Xcode project carries its own copy.

To change either one before the first upload:

1. Edit `appId` and `appName` in `capacitor.config.json`.
2. Open Xcode (step 4 below), click the blue **App** icon at the top of the left sidebar, choose the **App** target, and open the **Signing & Capabilities** tab. Change **Bundle Identifier** there.
3. On the **General** tab, change **Display Name**.
4. Run `npm run ios:sync`.

Choose the bundle identifier carefully. Once a build has been uploaded to App Store Connect, the identifier is fixed for that app. A different identifier is a different app.

## Build and run on your iPhone

1. Get the code. In Terminal:

       cd path/to/throt
       git pull

2. Install the packages. Xcode reads the native plugins out of `node_modules`, so this step is required before Xcode is opened:

       npm install

3. Build the web app, copy it into the iOS project, and open Xcode:

       npm run ios:build

   This runs `vite build`, then `cap sync ios`, then opens `ios/App/App.xcodeproj`. The three scripts are:

   - `npm run ios:sync`: build the web app and copy it into the iOS project. Run this after every change to the web code.
   - `npm run ios:open`: open the project in Xcode.
   - `npm run ios:build`: both of the above.

4. Wait for Xcode. The first time, it downloads the Capacitor package from GitHub. The status bar at the top of the window says "Resolving package graph" and then "Indexing". This needs an internet connection and takes a few minutes. If it fails, choose **File > Packages > Reset Package Caches** and wait again.

5. Choose your team. Click the blue **App** icon at the top of the left sidebar, choose the **App** target in the middle column, and open **Signing & Capabilities**. Tick **Automatically manage signing**. In **Team**, choose your name. If the list is empty, choose **Add an Account** and sign in with your Apple ID.

   If Xcode says the bundle identifier is not available, someone else has registered it. Change it as described above.

6. Get the iPhone ready. Plug it in and unlock it. Tap **Trust** when the phone asks. On the phone, open **Settings > Privacy & Security > Developer Mode**, turn it on, and restart the phone when asked. Developer Mode only appears in Settings after the phone has been connected to Xcode once.

7. Choose the phone as the place to run. At the top of the Xcode window, next to **App**, click the device name and pick your iPhone under **iOS Device**.

8. Press the Run button (the triangle), or press Command-R. The first build takes a few minutes. Keep the phone unlocked.

   With a free Apple ID the phone refuses to open the app the first time. On the phone, open **Settings > General > VPN & Device Management**, tap your Apple ID, and tap **Trust**. Then press Run again.

9. Check these on the phone. None of them could be tested on the Linux machine that prepared this project:

   - The welcome screen offers "Create my dog's page". If the app goes straight into the Biscuit demo instead, the server change above is not deployed, or the phone is offline.
   - Sign in, create a dog, add a photo from Photos, and take a photo with the camera.
   - The header clears the notch and the tab bar clears the home indicator on every tab.
   - The status bar text is readable on the navy welcome screen and on the white headers.
   - The map shows tiles. If the Mapbox token is restricted to the website's address in the Mapbox dashboard, Mapbox refuses the app and the map falls back to the plain CARTO style. Add a token without a URL restriction, or accept the fallback.
   - Tapping a public dog page link opens Safari.
   - Location: the first use shows the iOS question with the text from `Info.plist`. If a second question appears that names `capacitor://localhost`, note which screen caused it. That screen still uses the browser's location call and should move to `src/native/location.js`.

## Recording walks in the background

`src/native/location.js` uses the `@capacitor-community/background-geolocation` plugin (MIT licence, no paid tier). On the website the same file falls back to the browser.

The walk screen has to call it before a locked phone keeps recording. The change is in `src/screens/Record.jsx`:

    import { watchPosition, clearWatch } from '../native/location.js'
    // was: navigator.geolocation.watchPosition(onFix, onErr, { enableHighAccuracy: true, maximumAge: 2000 })
    watch.current = watchPosition(onFix, onErr, { enableHighAccuracy: true, maximumAge: 2000 })
    // was: navigator.geolocation.clearWatch(watch.current)
    clearWatch(watch.current)

Once that is in, test it on a real walk: start recording, lock the phone, walk for five minutes, unlock. The route should have no gap, and the status bar should show the blue location indicator while the phone was locked.

Trot asks for "While Using the App" only. It never asks for "Always". The `location` background mode in `Info.plist` lets a walk that was started on screen keep recording with the screen off.

## Upload to TestFlight

This part needs the paid Apple Developer Program membership.

1. Create the app record. Sign in at appstoreconnect.apple.com, open **Apps**, click the plus button, and choose **New App**. Platform: iOS. Name: Trot (the name must be unique on the App Store, so you may need "Trot: Dog Walks" or similar). Primary language: English (U.S.). Bundle ID: choose `com.trotdogs.app` from the list. It appears there after Xcode has signed the app once with your paid team. SKU: any text, for example `trot-ios`.

2. Set the build number. In Xcode, on the **General** tab, **Version** is `1.0` and **Build** is `1`. Every upload needs a higher Build number than the last one: 2, 3, 4. Version only changes when you want testers to see a new version.

3. Make sure the web code is current: `npm run ios:sync`.

4. At the top of the Xcode window, change the device to **Any iOS Device (arm64)**. Archive is greyed out while a simulator is selected.

5. Choose **Product > Archive**. After a few minutes the Organizer window opens with the new archive selected.

6. Click **Distribute App**, choose **App Store Connect**, then **Upload**, and accept the defaults. Xcode signs the build and uploads it.

7. Wait for processing. In App Store Connect, open the app and the **TestFlight** tab. The build shows "Processing" for 5 to 30 minutes. Apple emails you when it is ready. The export compliance question is already answered by `ITSAppUsesNonExemptEncryption` in `Info.plist` (see the checklist below).

8. Internal testers: up to 100 people who are on your App Store Connect team. Under **Internal Testing**, create a group, add people, and add the build. No review. They get an email and install with the TestFlight app.

9. External testers: up to 10,000 people by email or public link. Under **External Testing**, create a group and add the build. Fill in **Test Information**: what to test, a feedback email, a contact name and phone, and how a reviewer signs in. The first build of each version goes through Beta App Review, which usually takes about a day. After approval you can add testers by email or turn on a public link.

A TestFlight build stops working 90 days after upload. Upload a new build before then.

## What Apple will ask for

| Item | Where it is asked | Status |
| --- | --- | --- |
| Privacy policy URL | App Store Connect, App Privacy. Also Test Information for external testers | NOT DONE. Trot has no privacy policy page. One has to be written and published at a public address |
| Support URL | App Store Connect, version page | NOT DONE. Trot has no support page. A simple page with a contact email is enough |
| App Privacy answers ("nutrition label") | App Store Connect, App Privacy | Ready to fill in. Use `docs/app-store-privacy.md` |
| Account deletion inside the app | App Review, for any app that lets people create an account | NOT DONE. Trot has no way to delete an account, in the app or on the server. Required before App Store review. TestFlight review may also raise it |
| A sign-in the reviewer can use | App Review notes and Test Information | Works today, with a caveat. Sign-in is a name and an email with no password or code, so a reviewer can use any address. Create one for them, for example `review@your-domain`, with a dog and a few walks, and put it in the notes |
| Export compliance | Each upload | Done. `ITSAppUsesNonExemptEncryption` is `false` in `Info.plist`, which is the right answer for an app that only uses HTTPS and the encryption built into iOS. Change it if Trot ever adds its own encryption |
| Why the app uses location in the background | App Review notes | Write one sentence: "Trot records the route of a dog walk while the phone is locked. Start a walk on the Walk tab, lock the phone, and walk." |
| Screenshots | App Store Connect, version page | NOT DONE. iPhone screenshots are needed for the App Store. TestFlight does not need them. The app is iPhone only, so no iPad screenshots |
| Age rating, category, copyright | App Store Connect | NOT DONE. Short forms |
| Content reporting | App Review, for apps with content from other people | PARTLY. Places can be reported. Dogs, photos and people cannot be reported or blocked yet |

## Known gaps, stated plainly

- Sign-in has no password and no emailed code. Anyone who knows a person's email address can sign in as that person. This is a trial shortcut. It should be replaced before the app reaches people you do not know, and App Review may reject it if they notice.
- There is no account deletion. Apple requires it for the App Store.
- There is no privacy policy and no support page.
- Settings shows paid plans with prices (Trot Plus, Trot Pro) that cannot be bought. Apple rejects apps that show prices for digital features without In-App Purchase, and apps with placeholder features. Hide that section inside the app before review. `isNative` from `src/native/platform.js` is the switch to use.
- Several connections read "Coming soon". App Review treats those as unfinished features. Hide them inside the app or remove them before App Store review.
- Opening a stored document (a PDF in Documents) opens a new browser tab on the website. Inside the app there is no new tab, so this does nothing yet. It needs an in-app viewer.
- Friend and care-team invite links open the website, not the app. Someone who taps one on their phone lands in Safari.
- The usage opt-out text in Settings talks about the browser's Do Not Track setting, which an app does not have. Inside the app that setting does not exist, so usage counts are always sent. Add an in-app switch, or change the text, before review.
- The session token is kept in the web view's local storage. It survives app restarts. iOS can clear it if the phone runs very low on space, and the person then signs in again.
- The app needs a connection for accounts and walks. Offline, it opens the Biscuit demo.

## Push notifications: what is still missing

`src/native/push.js` can ask for permission and receive the phone's push token, using the official `@capacitor/push-notifications` plugin. `AppDelegate.swift` already passes the token to the plugin. Nothing calls `push.js` yet, and nothing can send a push yet.

The Push Notifications capability is deliberately not turned on in the project, because it makes signing fail for a free Apple ID and needs a key that only you can create.

Still to do, in order:

1. Xcode capability: in **Signing & Capabilities**, click **+ Capability** and add **Push Notifications**. Needs the paid membership. Xcode creates `App.entitlements`.
2. APNs key: at developer.apple.com, open **Certificates, Identifiers & Profiles > Keys**, create a key with **Apple Push Notifications service (APNs)** ticked, and download the `.p8` file. It can be downloaded once. Note the Key ID and your Team ID.
3. Server secrets: store the `.p8` contents, the Key ID, the Team ID and the bundle identifier as environment variables on Render. Never commit the key and never put it in the app.
4. Device token table: a table such as `push_devices (id, user_id, token, platform, created_at, last_seen_at)` with a unique token, plus `POST /api/push/devices` to save a token for the signed-in person and `DELETE /api/push/devices/:token` for sign-out.
5. Sender: server code that signs a JWT with the key and posts to `https://api.push.apple.com/3/device/<token>` (use `api.sandbox.push.apple.com` for builds run from Xcode). Remove a token when Apple answers 410.
6. What to send: connect the sender to the existing notification center (`server/routesNotifications.js`), respecting each person's notification settings.
7. Client call: after sign-in, from a screen that explains what Trot will send, call `registerForPush({ onToken })` and post the token.

## NFC and Trot Tags

There are two separate things here.

**Reading a tag with no app at all.** An unlocked iPhone held near a Trot Tag reads the web address on it and offers to open it in Safari. This already works, needs nothing from this project, and is how a stranger who finds a dog reads the tag.

**Scanning a tag from inside Trot.** `src/native/nfc.js` does this with the `@capgo/capacitor-nfc` plugin (MPL-2.0 licence, free for release builds, version 8 line that tracks Capacitor 8). `scanTrotTag()` shows the iOS scanning sheet, reads the address, accepts it only if it is `https://trot-app.onrender.com/t/<12-character code>`, and opens that tag page in Safari. Nothing calls it yet. To turn it on:

1. Xcode capability: in **Signing & Capabilities**, click **+ Capability** and add **Near Field Communication Tag Reading**. Needs the paid membership. Without it a scan fails with a "missing entitlement" error and the rest of the app is unaffected.
2. `NFCReaderUsageDescription` is already in `Info.plist`.
3. Add a "Scan a tag" button that calls `scanTrotTag()`.

If the website moves to its own domain, tags already printed with the old address still open in Safari, but `nfc.js` only accepts the address in `src/native/platform.js`. Keep the old host accepted there if stickers are in the wild.

**Opening the app from a tag (Universal Links).** This is optional and not set up. It would make an iPhone that has Trot installed open the app, instead of Safari, when a tag is read. Do not turn it on until the app has its own screen for a tag: today the tag page only exists on the website, so the app would have nothing to show. What it needs:

1. The server serves this JSON at `https://trot-app.onrender.com/.well-known/apple-app-site-association`, with content type `application/json`, no redirect and no sign-in. Replace `TEAMID` with your Apple Team ID:

       {
         "applinks": {
           "details": [
             { "appIDs": ["TEAMID.com.trotdogs.app"], "components": [{ "/": "/t/*" }] }
           ]
         }
       }

2. Xcode capability: **Associated Domains**, with the entry `applinks:trot-app.onrender.com`.
3. The `@capacitor/app` plugin and an `appUrlOpen` listener that reads the address and shows the tag screen.

## Changing the icon or the launch screen

The sources are `assets/icon-only.png` (1024 by 1024, made from `public/icon-1024.png`), `assets/splash.png` and `assets/splash-dark.png` (2732 by 2732). Replace them and run:

    npm run ios:assets

## How the app reaches the server

- API address: `src/native/platform.js` is the one place that decides it. On the website it is empty, so calls are relative. Inside the app it is `https://trot-app.onrender.com`. To build against another server, run `VITE_API_BASE=https://other.example npm run ios:build`.
- Session: the same as the website. Signing in returns a token, the app keeps it in local storage and sends it in the `Authorization` header. There are no cookies.
- New code that calls the server with `fetch` must use `API_BASE` from `src/native/platform.js`, or go through `src/api.js`. A bare `fetch('/api/...')` works on the website and fails inside the app.
- New code that builds a link for someone else to open must use `SITE_ORIGIN` from the same file, not `location.origin`, which inside the app is `capacitor://localhost`.

## When something goes wrong

- "No such module 'Capacitor'" or missing package errors: run `npm install`, then in Xcode choose **File > Packages > Reset Package Caches**.
- Red file names `public` or `capacitor.config.json` in the Xcode sidebar, or a build error about them: run `npm run ios:sync`. Those files are generated and are not stored in git.
- The app shows an old version of the screens: run `npm run ios:sync` and press Run again. Xcode does not rebuild the web code.
- "Signing for App requires a development team": step 5 above.
- "Communication with Apple failed" or "no devices": plug in the iPhone, unlock it, and trust the Mac.
- The app opens in the demo only: the server change at the top of this page is not deployed, or the phone has no connection.
- Archive is greyed out: choose **Any iOS Device (arm64)** as the device.
- Upload is refused because the build number was already used: raise **Build** on the **General** tab.

## Tests that run without a Mac

    npm run test:native            # location hand-over, link routing, NFC address checks
    node --test server/cors.test.js   # the app origin can call the API, other origins cannot
