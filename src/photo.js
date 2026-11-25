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
