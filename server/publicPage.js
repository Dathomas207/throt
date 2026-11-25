// Server-rendered public dog page. No client JavaScript. Every interpolated value
// goes through esc().

export function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const fmtMin = (min) => {
  const m = Math.round(Number(min) || 0)
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m} min`
}
const fmtMi = (mi) => (Number(mi) || 0).toFixed(1)
const fmtDate = (iso) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

// Route points are numbers that were validated on the way in. They are formatted
// with toFixed here, so nothing but digits, dots, minus signs and spaces is emitted.
function routeSvg(pts) {
  if (!Array.isArray(pts) || pts.length < 2) return ''
  const ok = pts.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
  if (ok.length < 2) return ''
  const w = 358, h = 120, pad = 16
  const lats = ok.map((p) => p[0]), lngs = ok.map((p) => p[1])
  const a = Math.min(...lats), b = Math.max(...lats), c = Math.min(...lngs), d = Math.max(...lngs)
  const s = Math.min((w - pad * 2) / ((d - c) || 1e-6), (h - pad * 2) / ((b - a) || 1e-6))
  const ox = (w - (d - c) * s) / 2, oy = (h - (b - a) * s) / 2
  const path = ok.map((p, i) => `${i ? 'L' : 'M'}${(ox + (p[1] - c) * s).toFixed(1)} ${(oy + (b - p[0]) * s).toFixed(1)}`).join(' ')
  return `<svg class="route" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${path}" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><path d="${path}" fill="none" stroke="#1F5AE8" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`
}

const STYLE = `
:root{--ink:#0F1B2D;--volt:#C8F031;--grey:#5B6472;--blue:#1F5AE8;--bg:#F5F6F8}
*{box-sizing:border-box}html,body{margin:0}
body{background:#0B1422;font-family:Inter,system-ui,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased}
.page{max-width:440px;margin:0 auto;min-height:100vh;background:var(--bg);display:flex;flex-direction:column}
.prof{background:var(--ink);padding:22px 16px 20px;color:#fff;display:flex;flex-direction:column;gap:14px}
.logo{font:italic 900 24px Archivo,Arial,sans-serif;letter-spacing:-1px;color:var(--volt);text-decoration:none;display:inline-flex;align-items:center;min-height:44px}
.who{display:flex;gap:14px;align-items:center}
.av{width:72px;object-fit:cover;height:72px;border-radius:50%;background:var(--volt);color:var(--ink);font:700 30px Archivo,Arial,sans-serif;display:flex;align-items:center;justify-content:center;flex-shrink:0}
h1{font:italic 900 34px Archivo,Arial,sans-serif;line-height:1.05;margin:0 0 4px;overflow-wrap:anywhere;text-transform:uppercase}
h2{font-size:12px;font-weight:700;letter-spacing:.6px;color:var(--grey);margin:6px 4px 0}
.sub{font-size:13px;color:#D5DBE4}.bio{font-size:14px;line-height:1.45;color:#D5DBE4;margin:0;overflow-wrap:anywhere}
.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.sl{font-size:11px;font-weight:600;letter-spacing:.5px;color:#AEB7C4}.sv{font:italic 800 22px Archivo,Arial,sans-serif;color:#fff}
.eyebrow{font-size:12px;font-weight:700;letter-spacing:.6px;color:var(--volt)}
.list{padding:12px;display:flex;flex-direction:column;gap:12px;flex:1}
.card{background:#fff;border-radius:16px;overflow:hidden}
.pad{padding:14px 16px;display:flex;flex-direction:column;gap:8px}
.meta{font-size:12.5px;color:var(--grey);line-height:1.4}.meta b{color:var(--ink)}
.title{font-weight:700;font-size:18px;letter-spacing:-.2px;overflow-wrap:anywhere}
.note{font-size:14px;line-height:1.45;color:#3A4250;margin:0;overflow-wrap:anywhere}
.row{display:flex;gap:28px}.card .sl{color:var(--grey)}.card .sv{color:var(--ink);font-size:22px}
.route{display:block;width:100%;height:120px;background:#E6EBEE}
.cta{min-height:52px;border-radius:26px;background:var(--volt);color:var(--ink);font-size:16px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 20px;text-decoration:none}
.cta:focus-visible,.logo:focus-visible{outline:3px solid var(--blue);outline-offset:2px}
.foot{padding:4px 16px 28px;font-size:12px;color:var(--grey);text-align:center}
.empty{padding:22px 16px;text-align:center;font-size:14px;color:var(--grey)}
.nf{padding:60px 20px;display:flex;flex-direction:column;gap:16px;align-items:center;text-align:center;color:#fff;background:var(--ink);flex:1}
.nf p{color:#D5DBE4;margin:0;font-size:15px;line-height:1.5}
@media (min-width:480px){.page{margin:16px auto;min-height:calc(100vh - 32px);border-radius:28px;overflow:hidden}}
`

function shell({ title, description, url, image, body, noindex }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0F1B2D">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${noindex ? '<meta name="robots" content="noindex">' : ''}
<meta property="og:type" content="profile">
<meta property="og:site_name" content="Trot">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
${url ? `<meta property="og:url" content="${esc(url)}">` : ''}
${image ? `<meta property="og:image" content="${esc(image)}">` : ''}
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
${image ? `<meta name="twitter:image" content="${esc(image)}">` : ''}
<link rel="icon" href="/icon-192.png">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:ital,wght@0,700;1,800;1,900&amp;family=Inter:wght@400;500;600;700&amp;display=swap">
<style>${STYLE}</style>
</head>
<body>
<div class="page">
${body}
</div>
</body>
</html>`
}

export function renderNotFound() {
  return shell({
    title: 'Dog not found · Trot',
    description: 'This dog page is private or does not exist.',
    noindex: true,
    body: `<main class="nf"><a class="logo" href="/">TROT</a><h1>No dog here</h1><p>This page is private or does not exist.</p><a class="cta" href="/">Open Trot</a></main>`,
  })
}

export function renderDogPage(dog, baseUrl) {
  const url = baseUrl ? `${baseUrl}/d/${dog.slug}` : ''
  // photoUrl is built by the server from the slug and a hex version. It is escaped like everything else.
  const image = baseUrl ? `${baseUrl}${dog.photoUrl || '/icon-512.png'}` : ''
  const life = dog.totals.lifetime, week = dog.totals.week
  const title = `${dog.name} on Trot`
  const description = `${dog.name}${dog.breed ? `, ${dog.breed}` : ''}. ${fmtMi(life.miles)} miles over ${life.outings} ${life.outings === 1 ? 'outing' : 'outings'}. ${fmtMi(week.miles)} miles in the last 7 days.`
  const initial = (dog.name.trim()[0] || 'D').toUpperCase()
  const stat = (l, v) => `<div><div class="sl">${esc(l)}</div><div class="sv">${esc(v)}</div></div>`
  const walks = dog.walks.map((w) => `
<article class="card">
<div class="pad">
<div class="meta">${esc(w.type)} · ${w.with ? `${w.type === 'Daycare' ? 'at' : 'with'} <b>${esc(w.with)}</b> · ` : ''}<time datetime="${esc(w.startedAt)}">${esc(fmtDate(w.startedAt))}</time>${w.place ? ` · ${esc(w.place)}` : ''}</div>
<div class="title">${esc(w.title)}</div>
<div class="row">${w.miles > 0 ? `<div><div class="sl">DISTANCE</div><div class="sv">${esc(fmtMi(w.miles))} mi</div></div>` : ''}<div><div class="sl">TIME</div><div class="sv">${esc(fmtMin(w.minutes))}</div></div>${w.sniffs > 0 ? `<div><div class="sl">SNIFF STOPS</div><div class="sv">${esc(w.sniffs)}</div></div>` : ''}<div><div class="sl">PAWS</div><div class="sv">${esc(w.paws)}</div></div></div>
${w.note ? `<p class="note">${esc(w.note)}</p>` : ''}
</div>
${w.route ? routeSvg(w.route) : ''}
</article>`).join('')
  const body = `
<header class="prof">
<a class="logo" href="/">TROT</a>
<div class="who">${dog.photoUrl ? `<img class="av" src="${esc(dog.photoUrl)}" alt="Photo of ${esc(dog.name)}" width="72" height="72">` : `<div class="av" aria-hidden="true">${esc(initial)}</div>`}<div><h1>${esc(dog.name)}</h1>${dog.breed ? `<div class="sub">${esc(dog.breed)}</div>` : ''}</div></div>
${dog.bio ? `<p class="bio">${esc(dog.bio)}</p>` : ''}
<div class="eyebrow">LIFETIME</div>
<div class="stats">${stat('MILES', fmtMi(life.miles))}${stat('OUTINGS', life.outings)}${stat('TIME OUT', fmtMin(life.minutes))}</div>
<div class="eyebrow">LAST 7 DAYS</div>
<div class="stats">${stat('MILES', fmtMi(week.miles))}${stat('OUTINGS', week.outings)}${stat('TIME OUT', fmtMin(week.minutes))}</div>
<a class="cta" href="/">Open Trot</a>
</header>
<main class="list">
<h2>RECENT OUTINGS</h2>
${walks || `<div class="card empty">No outings yet. ${esc(dog.name)}'s first walk will show up here.</div>`}
</main>
<footer class="foot">Every walk counts. Dates are shown in UTC.</footer>`
  return shell({ title, description, url, image, body })
}
