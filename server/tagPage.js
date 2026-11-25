// Server-rendered page behind a Trot Tag (an NFC sticker or QR code on the collar).
// It shows the dog's name, photo and breed. It never shows a person's name, phone,
// email or address, the dog's city, or any walk or route. Every interpolated value
// goes through esc(). The only script is the fixed one below, allowed by its hash.
import crypto from 'node:crypto'
import { esc } from './publicPage.js'

export const TAG_LIMITS = { finderName: 40, message: 280, contact: 120 }

// Fills the two hidden fields only after the finder taps the button and the browser agrees.
export const TAG_SCRIPT = `(function(){var b=document.getElementById('loc'),s=document.getElementById('locs'),la=document.getElementById('lat'),ln=document.getElementById('lng');if(!b||!navigator.geolocation)return;b.hidden=false;b.addEventListener('click',function(){if(la.value){la.value='';ln.value='';b.textContent='Share my location';s.textContent='Location removed. It will not be sent.';return}s.textContent='Asking your phone for its location';navigator.geolocation.getCurrentPosition(function(p){la.value=p.coords.latitude.toFixed(5);ln.value=p.coords.longitude.toFixed(5);b.textContent='Remove my location';s.textContent='Location added. It is sent only when you tap Send.'},function(){s.textContent='Your phone did not share a location. You can still send the form.'},{enableHighAccuracy:true,timeout:15000,maximumAge:60000})})})()`
export const TAG_SCRIPT_HASH = crypto.createHash('sha256').update(TAG_SCRIPT).digest('base64')

const STYLE = `
:root{--ink:#0F1B2D;--volt:#C8F031;--grey:#5B6472;--blue:#1F5AE8;--bg:#F5F6F8;--red:#C62828;--line:#E3E6EB}
*{box-sizing:border-box}html,body{margin:0}
body{background:#0B1422;font-family:Inter,system-ui,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased;line-height:1.45}
.page{max-width:440px;margin:0 auto;min-height:100vh;background:var(--bg);display:flex;flex-direction:column}
.prof{background:var(--ink);padding:22px 16px 20px;color:#fff;display:flex;flex-direction:column;gap:14px}
.logo{font:italic 900 24px Archivo,Arial,sans-serif;letter-spacing:-1px;color:var(--volt)}
.who{display:flex;gap:14px;align-items:center}
.av{width:88px;height:88px;object-fit:cover;border-radius:50%;background:var(--volt);color:var(--ink);font:700 36px Archivo,Arial,sans-serif;display:flex;align-items:center;justify-content:center;flex-shrink:0}
h1{font:italic 900 34px Archivo,Arial,sans-serif;line-height:1.05;margin:0 0 4px;overflow-wrap:anywhere;text-transform:uppercase}
h2{font-size:20px;font-weight:700;margin:0;overflow-wrap:anywhere}
.sub{font-size:14px;color:#D5DBE4}
.lost{background:var(--red);color:#fff;border-radius:14px;padding:12px 14px;font-size:15px;font-weight:600}
.lost p{margin:4px 0 0;font-weight:500;overflow-wrap:anywhere}
main{padding:12px;display:flex;flex-direction:column;gap:12px;flex:1}
.card{background:#fff;border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:12px}
p{margin:0;font-size:15px;overflow-wrap:anywhere}.small{font-size:13px;color:var(--grey)}
label{display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:600;color:var(--grey)}
input[type=text],textarea{border:1px solid var(--line);border-radius:12px;padding:12px 14px;font:500 16px/1.4 Inter,system-ui,sans-serif;color:var(--ink);background:#fff;width:100%}
input[type=text]{height:48px;padding:0 14px}textarea{min-height:92px;resize:vertical}
.cta{min-height:52px;border-radius:26px;border:0;background:var(--volt);color:var(--ink);font:700 16px Inter,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;padding:0 20px;text-decoration:none;width:100%;cursor:pointer}
.cta.line{background:#fff;border:2px solid var(--ink)}
.ok{background:#E3F6D0;border-radius:12px;padding:12px 14px;font-weight:600}
.err{background:#FFD9CB;border-radius:12px;padding:12px 14px;font-weight:600}
a{color:var(--blue)}a:focus-visible,button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid var(--blue);outline-offset:2px}
.foot{padding:4px 16px 28px;font-size:12px;color:var(--grey);text-align:center}
.nf{padding:60px 20px;display:flex;flex-direction:column;gap:16px;align-items:center;text-align:center;color:#fff;background:var(--ink);flex:1}
.nf p{color:#D5DBE4}
[hidden]{display:none!important}
@media (min-width:480px){.page{margin:16px auto;min-height:calc(100vh - 32px);border-radius:28px;overflow:hidden}}
`
function shell(title, body, script) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0F1B2D">
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
${script ? `<script>${TAG_SCRIPT}</script>` : ''}
</body>
</html>`
}

// One page for a code that never existed and a tag that was retired, so the two cannot be told apart.
export const renderTagNote = (title, heading, textLine) => shell(title, `<main class="nf"><div class="logo">TROT</div><h1>${esc(heading)}</h1><p>${esc(textLine)}</p></main>`)
export function renderTagGone() {
  return renderTagNote('Tag not found · Trot', 'No dog on this tag', 'This tag is not linked to a dog on Trot. If you found a dog, a vet or animal shelter can scan for a microchip.')
}

// dog: { name, breed, photo (true when there is one), publicPath (or null), lost (bool), lostNote }
// state: { sent, error, values } after a found report was posted.
export function renderTagPage({ code, dog, state = {} }) {
  const name = dog.name
  const initial = (name.trim()[0] || 'D').toUpperCase()
  const v = state.values || {}
  const head = `
<header class="prof">
<div class="logo">TROT</div>
<div class="who">${dog.photo ? `<img class="av" src="/t/${esc(code)}/photo" alt="Photo of ${esc(name)}" width="88" height="88">` : `<div class="av" aria-hidden="true">${esc(initial)}</div>`}<div><h1>${esc(name)}</h1>${dog.breed ? `<div class="sub">${esc(dog.breed)}</div>` : ''}</div></div>
${dog.lost ? `<div class="lost" role="status">${esc(name)} is reported lost.${dog.lostNote ? `<p>${esc(dog.lostNote)}</p>` : ''}</div>` : ''}
</header>`
  let main
  if (!dog.lost) {
    main = `
<div class="card">
<h2>This is ${esc(name)}.</h2>
<p>${esc(name)} is not reported lost.</p>
<p class="small">Thanks for checking in on ${esc(name)}. The care team can see that this tag was scanned, but not who scanned it or where.</p>
${dog.publicPath ? `<a class="cta line" href="${esc(dog.publicPath)}">See ${esc(name)}'s page</a>` : ''}
</div>`
  } else if (state.sent) {
    main = `
<div class="card">
<p class="ok" role="status">Sent. Thank you for helping ${esc(name)}.</p>
<p>${esc(name)}'s care team can see your message in Trot now. If you left a phone number or email, they can reach you there.</p>
<p class="small">If you can, stay with ${esc(name)} somewhere safe. A vet or animal shelter can also scan for a microchip.</p>
<a class="cta line" href="/t/${esc(code)}">Send another message</a>
</div>`
  } else {
    main = `
<form class="card" method="post" action="/t/${esc(code)}/found" autocomplete="off">
<h2>I found ${esc(name)}</h2>
<p>Tell ${esc(name)}'s care team. Every field is optional, but add at least a message, a way to reach you, or your location.</p>
${state.error ? `<p class="err" role="alert">${esc(state.error)}</p>` : ''}
<label>Your first name<input type="text" name="name" maxlength="${TAG_LIMITS.finderName}" value="${esc(v.name)}"></label>
<label>Message<textarea name="message" maxlength="${TAG_LIMITS.message}" placeholder="Where you are and how ${esc(name)} is doing">${esc(v.message)}</textarea></label>
<label>Phone or email, if you want them to reach you<input type="text" name="contact" maxlength="${TAG_LIMITS.contact}" value="${esc(v.contact)}" inputmode="email"></label>
<input type="hidden" name="lat" id="lat" value=""><input type="hidden" name="lng" id="lng" value="">
<button type="button" class="cta line" id="loc" hidden>Share my location</button>
<p class="small" id="locs" role="status">Your location is sent only if you tap Share my location.</p>
<button type="submit" class="cta">Send to ${esc(name)}'s care team</button>
<p class="small">What you type goes to ${esc(name)}'s care team in Trot and nowhere else. This page does not show who they are.</p>
</form>`
  }
  const body = `${head}
<main>${main}</main>
<footer class="foot">This tag holds a web address and nothing else. It does not track ${esc(name)}'s location.</footer>`
  return shell(`${name} · Trot Tag`, body, dog.lost && !state.sent)
}
