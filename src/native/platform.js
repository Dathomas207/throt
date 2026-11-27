// The one place that knows whether Trot is running inside the iPhone app, and where the
// Trot API and website live.
//
// On the website both answers are "right here": API_BASE is empty, so every call is a
// relative /api/... request, and SITE_ORIGIN is the page's own origin.
// Inside the Capacitor app the page is loaded from capacitor://localhost, so the API and
// every shareable link (/d/..., /t/..., /vet/..., invite links) point at PRODUCTION instead.
//
// To point a build somewhere else (a staging server), set VITE_API_BASE when building:
//   VITE_API_BASE=https://staging.example.com npm run ios:build
// This file imports nothing, so it costs the web bundle a few hundred bytes.
const PRODUCTION = 'https://trot-app.onrender.com'

const fromEnv = ((import.meta.env && import.meta.env.VITE_API_BASE) || '').trim()

// Capacitor injects window.Capacitor before any page script runs, so this is known at import time.
export const isNative = (() => {
  try { const c = typeof window !== 'undefined' && window.Capacitor; return !!(c && typeof c.isNativePlatform === 'function' && c.isNativePlatform()) } catch (e) { return false }
})()

export const API_BASE = (fromEnv || (isNative ? PRODUCTION : '')).replace(/\/+$/, '')

// Where links that other people open should point. Never capacitor://localhost.
export const SITE_ORIGIN = API_BASE || (typeof location !== 'undefined' ? location.origin : '')
export const siteUrl = (path) => SITE_ORIGIN + path
