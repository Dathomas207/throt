// Shrinks a picked image in the browser before it is uploaded: centre-cropped to
// a square of at most 512 px and saved as a JPEG data URL. The server caps the
// decoded size at 300 KB, so quality steps down if a busy photo comes out larger.
export const PHOTO_MAX_BYTES = 300 * 1024
const PREFIX = 'data:image/jpeg;base64,'
const bytesOf = (dataUrl) => Math.floor(((dataUrl.length - PREFIX.length) * 3) / 4)

export async function squareJpeg(file, max = 512, quality = 0.82) {
  if (!file || !/^image\//.test(file.type || '')) throw new Error('Pick an image file, such as a JPEG or PNG.')
  if (file.size > 40 * 1024 * 1024) throw new Error('That file is over 40 MB. Pick a smaller photo.')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((ok, no) => {
      const i = new Image()
      i.onload = () => ok(i)
      i.onerror = () => no(new Error('That file could not be read as an image. Try a JPEG or PNG.'))
      i.src = url
    })
    const w = img.naturalWidth, h = img.naturalHeight, side = Math.min(w, h)
    if (!side) throw new Error('That file could not be read as an image. Try a JPEG or PNG.')
    const size = Math.min(max, side)
    const c = document.createElement('canvas')
    c.width = size; c.height = size
    const x = c.getContext('2d')
    // JPEG has no transparency. White keeps a cut-out image from turning black.
    x.fillStyle = '#fff'; x.fillRect(0, 0, size, size)
    x.imageSmoothingQuality = 'high'
    x.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size)
    for (const q of [quality, 0.7, 0.55, 0.4]) {
      const d = c.toDataURL('image/jpeg', q)
      if (d.startsWith(PREFIX) && bytesOf(d) <= PHOTO_MAX_BYTES) return d
    }
    throw new Error('That photo could not be made small enough. Try a different one.')
  } finally { URL.revokeObjectURL(url) }
}

// ---- outing photos ---------------------------------------------------------------
// A picked photo is fitted inside `max` px on its long side, keeping its shape, and
// re-encoded as a JPEG. Drawing onto a canvas keeps only the pixels, so the EXIF block of
// the original (camera model, time and any embedded GPS position) is never uploaded.
// The server accepts up to 700 KB; this aims for 600 KB, stepping quality down and then
// the size, so a busy picture still gets through.
export const OUTING_PHOTO_BYTES = 600 * 1024
export const OUTING_PHOTO_MAX = 6
const UNREADABLE = 'That file could not be read as an image. Try a JPEG, PNG or HEIC photo from your library.'
// EXIF orientation: createImageBitmap applies it when asked. Where that is missing, an <img>
// is used instead, which current browsers also draw the right way up.
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try { const b = await createImageBitmap(file, { imageOrientation: 'from-image' }); return { src: b, w: b.width, h: b.height, done: () => { try { b.close() } catch (e) {} } } } catch (e) { /* fall through to <img> */ }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error(UNREADABLE)); i.src = url })
    return { src: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) }
  } catch (e) { URL.revokeObjectURL(url); throw e }
}
export async function fitJpeg(file, max = 1600, quality = 0.82) {
  if (!file || (file.type && !/^image\//.test(file.type))) throw new Error('Pick an image file, such as a JPEG or PNG.')
  if (file.size > 40 * 1024 * 1024) throw new Error('That file is over 40 MB. Pick a smaller photo.')
  const pic = await decode(file)
  try {
    if (!pic.w || !pic.h) throw new Error(UNREADABLE)
    let scale = Math.min(1, max / Math.max(pic.w, pic.h))
    for (let pass = 0; pass < 4; pass++, scale *= 0.75) {
      const w = Math.max(1, Math.round(pic.w * scale)), h = Math.max(1, Math.round(pic.h * scale))
      const c = document.createElement('canvas')
      c.width = w; c.height = h
      const x = c.getContext('2d')
      // JPEG has no transparency. White keeps a cut-out image from turning black.
      x.fillStyle = '#fff'; x.fillRect(0, 0, w, h)
      x.imageSmoothingQuality = 'high'
      x.drawImage(pic.src, 0, 0, w, h)
      for (const q of [quality, 0.72, 0.6, 0.5, 0.4]) {
        const d = c.toDataURL('image/jpeg', q)
        if (d.startsWith(PREFIX) && bytesOf(d) <= OUTING_PHOTO_BYTES) return { dataUrl: d, width: w, height: h, bytes: bytesOf(d) }
      }
    }
    throw new Error('That photo could not be made small enough. Try a different one.')
  } finally { pic.done() }
}
