import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
// The short commit hash shown on the Help and diagnostics screen. Render sets RENDER_GIT_COMMIT at build time;
// elsewhere git is asked. With neither, the app says "dev".
function appVersion() {
  const env = (process.env.APP_VERSION || process.env.RENDER_GIT_COMMIT || '').trim()
  if (/^[A-Za-z0-9._-]{1,40}$/.test(env)) return /^[0-9a-f]{40}$/.test(env) ? env.slice(0, 7) : env.slice(0, 20)
  try { const h = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); if (/^[0-9a-f]{4,40}$/.test(h)) return h } catch (e) { /* not a git checkout */ }
  return 'dev'
}
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist' },
}))
