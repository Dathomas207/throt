// Server-rendered health summary for a vet, behind an owner-made share link.
// No client JavaScript. Every interpolated value goes through esc(). The page
// carries no emails and no names of people, and asks search engines to stay away.
import { esc } from './publicPage.js'
import { byDue } from './routesHealth.js'

const fmtDate = (s) => {
  if (!s) return ''
  const d = new Date(String(s).length === 10 ? s + 'T00:00:00Z' : s)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
const STATUS = { overdue: 'Overdue', due_soon: 'Due soon', ok: '' }
const CATEGORY = { vet: 'Vet record', vaccination: 'Vaccination certificate', registration: 'Registration', licence: 'Licence or microchip', insurance: 'Insurance', show: 'Show paperwork', other: 'Other' }

const STYLE = `
:root{--ink:#0F1B2D;--volt:#C8F031;--grey:#5B6472;--blue:#1F5AE8;--line:#E3E6EB}
*{box-sizing:border-box}html,body{margin:0}
body{background:#F5F6F8;font-family:Inter,system-ui,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased;line-height:1.45}
.page{max-width:760px;margin:0 auto;background:#fff;min-height:100vh;padding:24px 20px 40px}
.brand{font:italic 900 22px Archivo,Arial,sans-serif;letter-spacing:-1px;color:var(--ink)}
h1{font:italic 900 32px Archivo,Arial,sans-serif;line-height:1.05;margin:10px 0 2px;overflow-wrap:anywhere;text-transform:uppercase}
h2{font-size:13px;font-weight:700;letter-spacing:.6px;color:var(--grey);margin:26px 0 8px;padding-bottom:6px;border-bottom:2px solid var(--ink)}
p{margin:0 0 6px;font-size:14px;overflow-wrap:anywhere}.sub{color:var(--grey);font-size:14px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px}
.sl{font-size:11px;font-weight:600;letter-spacing:.5px;color:var(--grey)}.sv{font:italic 800 22px Archivo,Arial,sans-serif}
table{width:100%;border-collapse:collapse;font-size:14px}th{font-size:11px;letter-spacing:.5px;color:var(--grey);text-align:left;padding:6px 8px 6px 0}
td{padding:8px 8px 8px 0;border-top:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}
.flag{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:8px;background:#FFD9CB}.flag.soon{background:var(--volt)}
.none{color:var(--grey);font-size:14px}
.foot{margin-top:30px;padding-top:12px;border-top:1px solid var(--line);font-size:12px;color:var(--grey)}
a{color:var(--blue);display:inline-flex;align-items:center;min-height:44px}a:focus-visible{outline:3px solid var(--blue);outline-offset:2px}
.gone{padding:60px 10px;text-align:center}
@media print{body{background:#fff}.page{max-width:none;padding:0;min-height:0}h2{break-after:avoid}tr{break-inside:avoid}a{min-height:0;color:var(--ink)}.noprint{display:none}}
`
function shell(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
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

export function renderVetGone() {
  return shell('Link not available · Trot', `<main class="gone"><div class="brand">TROT</div><h1>This link is not available</h1><p class="sub">It has expired, was turned off by the dog's owner, or never existed. Ask the owner for a new one.</p></main>`)
}

export function renderVetPage({ dog, entries, summary, documents = [], expiresAt, generatedAt }) {
  const of = (k) => entries.filter((e) => e.kind === k)
  const a = summary.activity, w = summary.weight
  const stat = (l, v) => `<div><div class="sl">${esc(l)}</div><div class="sv">${esc(v)}</div></div>`
  const table = (heads, rows, empty) => rows.length ? `<table><thead><tr>${heads.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>` : `<p class="none">${esc(empty)}</p>`
  const change = a.changePercent.minutes == null ? 'No earlier weeks to compare' : `${a.changePercent.minutes > 0 ? '+' : ''}${a.changePercent.minutes}% against the 4 weeks before`
  const recent = (x, y) => ((x.occurredOn || '') < (y.occurredOn || '') ? 1 : -1)
  const facts = [dog.breed, dog.age].filter(Boolean).join(' · ')
  const body = `
<header>
<div class="brand">TROT</div>
<h1>${esc(dog.name)}</h1>
${facts ? `<p class="sub">${esc(facts)}</p>` : ''}
<p class="sub">Health summary shared by ${esc(dog.name)}'s owner. Made ${esc(fmtDate(generatedAt))}. This link stops working on ${esc(fmtDate(expiresAt))}.</p>
<p class="sub noprint">Use your browser's Print command to print this page or save it as a PDF.</p>
</header>
<main>
<h2>ACTIVITY</h2>
<div class="stats">
${stat('LAST 7 DAYS', `${a.last7.minutes} min`)}
${stat('MILES, LAST 7 DAYS', a.last7.miles.toFixed(1))}
${stat('ACTIVE DAYS', `${a.activeDays} of 7`)}
${stat('WEEKLY AVERAGE BEFORE', `${a.previousWeeklyAverage.minutes} min`)}
${a.last7.topSpeed ? stat('TOP SPEED, LAST 7 DAYS', `${a.last7.topSpeed.toFixed(1)} mph`) : ''}
${summary.goal.minutes ? stat('OWNER\'S DAILY GOAL', `${summary.goal.minutes} min`) : ''}
</div>
<p class="sub">${esc(change)}. Minutes come from walks logged in Trot by the care team with a phone, not from a device on the dog. Daycare days are left out.${a.last7.topSpeed ? ' Speeds are the speed of the phone carried on the walk, so they are the pair\'s speed, not the dog\'s own.' : ''}</p>
${table(['Week starting', 'Minutes', 'Miles', 'Outings'], a.weeks.map((k) => [esc(fmtDate(k.start)), esc(k.minutes), esc(k.miles.toFixed(1)), esc(k.outings)]), '')}
<h2>WEIGHT</h2>
${w && w.change ? `<p>${esc(`${w.change.value > 0 ? 'Up' : w.change.value < 0 ? 'Down' : 'No change:'} ${Math.abs(w.change.value)} ${w.change.unit} since ${fmtDate(w.change.since)}.`)}</p>` : ''}
${table(['Date', 'Weight', 'Notes'], of('weight').sort(recent).map((e) => [esc(fmtDate(e.occurredOn)), esc(`${e.value} ${e.unit}`), esc(e.notes)]), 'No weights recorded.')}
<h2>VACCINES AND PREVENTIVES</h2>
${table(['Name', 'Given', 'Next due', ''], of('vaccine').sort(byDue).map((e) => [esc(e.title), esc(fmtDate(e.occurredOn)), esc(fmtDate(e.dueOn)), STATUS[e.status] ? `<span class="flag${e.status === 'due_soon' ? ' soon' : ''}">${esc(STATUS[e.status])}</span>` : '']), 'No vaccines or preventives recorded.')}
<h2>MEDICATIONS</h2>
${table(['Name', 'Dose', 'Schedule', 'Start', 'End'], of('medication').map((e) => [esc(e.title), esc(e.detail), esc(e.schedule), esc(fmtDate(e.occurredOn)), esc(fmtDate(e.dueOn))]), 'No medications recorded.')}
<h2>CONDITIONS AND ALLERGIES</h2>
${table(['Name', 'Notes'], of('condition').map((e) => [esc(e.title), esc(e.notes)]), 'No conditions or allergies recorded.')}
<h2>RECENT VET VISITS</h2>
${table(['Date', 'Clinic', 'Reason', 'Notes'], of('vet_visit').sort(recent).slice(0, 10).map((e) => [esc(fmtDate(e.occurredOn)), esc(e.detail), esc(e.title), esc(e.notes)]), 'No vet visits recorded.')}
${documents.length ? `<h2>DOCUMENTS</h2>${table(['Document', 'Kind'], documents.map((d) => [`<a href="${esc(d.href)}" rel="noopener noreferrer">${esc(d.name)}</a>`, esc(CATEGORY[d.category] || 'Other')]), '')}<p class="sub">These open only while this link works.</p>` : ''}
</main>
<footer class="foot">Entered by ${esc(dog.name)}'s care team in Trot. Not a medical record and not veterinary advice. Dates and day totals are in UTC.</footer>`
  return shell(`${dog.name}: health summary · Trot`, body)
}
