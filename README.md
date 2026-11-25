# Trot

Dog-first walking and community app. Demo build with a seeded account for Biscuit, a Golden Retriever.

## Run locally

    npm install
    npm run dev

## Deploy to Render

1. Push this folder to a GitHub repo.
2. In Render choose New > Blueprint and pick the repo. `render.yaml` creates a static site that runs `npm ci && npm run build` and serves `dist`.
3. Open the Render URL on your iPhone in Safari, tap Share, then Add to Home Screen. Trot opens full screen with its own icon.

## Native iPhone build (needs a Mac with Xcode)

    npm install @capacitor/core @capacitor/cli @capacitor/ios
    npm run build
    npx cap add ios
    npx cap sync ios
    npx cap open ios

In Xcode: select your team under Signing & Capabilities (a free Apple ID works for your own phone, builds expire after 7 days), plug in the iPhone, enable Developer Mode on the phone under Settings > Privacy & Security, and press Run. Add `NSLocationWhenInUseUsageDescription` to Info.plist for Live GPS. The paid Apple Developer Program ($99 per year) adds TestFlight.

## What is real and what is demo

- Real: recording with Live GPS, saved walks (kept in the browser), story card image, maps (OpenStreetMap data via CARTO tiles).
- Demo: Biscuit's history, people, the pack, park stats, health data, route playback at 40x speed, and every connection (Trot Tag, AirTag, Instagram, Strava, Garmin, Apple Health, collars, AllTrails, vet records).
- Place coordinates and routes are approximate samples around Cambridge, MA.
