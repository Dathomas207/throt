import React from 'react'
import { createRoot } from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import './styles.css'
import App from './App.jsx'
createRoot(document.getElementById('root')).render(<App />)
try {
  if ('serviceWorker' in navigator && location.protocol === 'https:' && !/claude/.test(location.hostname)) {
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  }
} catch (e) {}
