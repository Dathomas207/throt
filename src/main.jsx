import React from 'react'
import { createRoot } from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import './styles.css'
import './notify.css'
import App from './App.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import { installErrorCapture } from './usage.js'
// Window errors and unhandled rejections are recorded from the first line on.
installErrorCapture()
createRoot(document.getElementById('root')).render(<ErrorBoundary name="app" kind="app"><App /></ErrorBoundary>)
try {
  if ('serviceWorker' in navigator && location.protocol === 'https:' && !/claude/.test(location.hostname)) {
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  }
} catch (e) {}
