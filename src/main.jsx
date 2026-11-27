import React from 'react'
import { createRoot } from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import './styles.css'
import './notify.css'
import App from './App.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import { installErrorCapture } from './usage.js'
import { isNative } from './native/platform.js'
// Window errors and unhandled rejections are recorded from the first line on.
installErrorCapture()
createRoot(document.getElementById('root')).render(<ErrorBoundary name="app" kind="app"><App /></ErrorBoundary>)
// Inside the iPhone app: status bar, links to the website and app-only CSS. Loaded on demand, so the
// website never downloads it. No service worker there either: the files are already on the phone.
if (isNative) import('./native/shell.js').then((m) => m.startNativeShell()).catch(() => {})
try {
  if (!isNative && 'serviceWorker' in navigator && location.protocol === 'https:' && !/claude/.test(location.hostname)) {
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  }
} catch (e) {}
