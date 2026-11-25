// A small QR code encoder, so a Trot Tag's address can be shown as a code without any outside
// service or library. Byte mode, error correction level M, versions 1 to 10 (up to 213 bytes).
// qrMatrix(text) answers a square array of booleans (true is a dark module), or null if the text is too long.

const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26]
const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5]
const rawModules = (v) => { let r = (16 * v + 128) * v + 64; if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36 } return r }
const dataCodewords = (v) => Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[v] * BLOCKS[v]

// Arithmetic in GF(256) with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1.
function mul(x, y) { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x } return z }
function divisor(degree) {
  const r = new Array(degree).fill(0); r[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) { for (let j = 0; j < degree; j++) { r[j] = mul(r[j], root); if (j + 1 < degree) r[j] ^= r[j + 1] } root = mul(root, 2) }
  return r
}
function remainder(data, div) {
  const r = div.map(() => 0)
  for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= mul(c, f) }) }
  return r
}
function utf8(text) {
  if (typeof TextEncoder !== 'undefined') return [...new TextEncoder().encode(text)]
  return [...unescape(encodeURIComponent(text))].map((c) => c.charCodeAt(0))
}

function codewords(bytes, v) {
  const cap = dataCodewords(v), bits = []
  const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1) }
  push(4, 4); push(bytes.length, v < 10 ? 8 : 16)
  for (const b of bytes) push(b, 8)
  push(0, Math.min(4, cap * 8 - bits.length))
  while (bits.length % 8) bits.push(0)
  const data = []
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0))
  for (let pad = 0xec; data.length < cap; pad ^= 0xec ^ 0x11) data.push(pad)
  // Split into blocks, add error correction to each, then interleave.
  const nb = BLOCKS[v], ecc = ECC_PER_BLOCK[v], raw = Math.floor(rawModules(v) / 8)
  const short = nb - (raw % nb), shortLen = Math.floor(raw / nb), div = divisor(ecc), blocks = []
  for (let i = 0, k = 0; i < nb; i++) {
    const d = data.slice(k, k + shortLen - ecc + (i < short ? 0 : 1)); k += d.length
    const e = remainder(d, div)
    if (i < short) d.push(0)
    blocks.push(d.concat(e))
  }
  const out = []
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - ecc || j >= short) out.push(b[i]) })
  return out
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]

function build(v, words, mask) {
  const size = v * 4 + 17
  const m = [...Array(size)].map(() => new Array(size).fill(false)), fn = [...Array(size)].map(() => new Array(size).fill(false))
  const set = (x, y, dark) => { m[y][x] = !!dark; fn[y][x] = true }
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0) }
  const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy; if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4) } }
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4)
  if (v >= 2) {
    const n = Math.floor(v / 7) + 2, step = Math.floor((v * 8 + n * 3 + 5) / (n * 4 - 4)) * 2, pos = [6]
    for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p)
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    }
  }
  // Format information: level M is 0, then the mask number, with a 10-bit BCH code.
  const fdata = mask
  let rem = fdata
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  const fbits = ((fdata << 10) | rem) ^ 0x5412, bit = (i) => ((fbits >>> i) & 1) !== 0
  for (let i = 0; i <= 5; i++) set(8, i, bit(i))
  set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8))
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i))
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i))
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i))
  set(8, size - 8, true)
  if (v >= 7) {
    let r = v
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25)
    const vb = (v << 12) | r
    for (let i = 0; i < 18; i++) { const a = size - 11 + (i % 3), b = Math.floor(i / 3), d = ((vb >>> i) & 1) !== 0; set(a, b, d); set(b, a, d) }
  }
  // Data goes in two-module columns, snaking up and down from the bottom right.
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert
      if (fn[y][x]) continue
      let dark = i < words.length * 8 && ((words[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0
      i++
      if (MASKS[mask](x, y)) dark = !dark
      m[y][x] = dark
    }
  }
  return m
}

// The standard's four penalty rules. The mask with the lowest score is the easiest to scan.
function penalty(m) {
  const n = m.length
  let p = 0, dark = 0
  const line = (get) => {
    for (let a = 0; a < n; a++) {
      let run = 1
      for (let b = 1; b < n; b++) { if (get(a, b) === get(a, b - 1)) { run++; if (run === 5) p += 3; else if (run > 5) p++ } else run = 1 }
      for (let b = 0; b + 10 < n; b++) {
        const s = [...Array(11)].map((_, k) => (get(a, b + k) ? '1' : '0')).join('')
        if (s === '10111010000' || s === '00001011101') p += 40
      }
    }
  }
  line((a, b) => m[a][b]); line((a, b) => m[b][a])
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (m[y][x]) dark++
    if (x + 1 < n && y + 1 < n && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3
  }
  return p + Math.floor(Math.abs((dark * 20) / (n * n) - 10)) * 10
}

export function qrMatrix(text) {
  const bytes = utf8(String(text))
  let v = 1
  while (v <= 10 && bytes.length * 8 + 4 + (v < 10 ? 8 : 16) > dataCodewords(v) * 8) v++
  if (v > 10) return null
  const words = codewords(bytes, v)
  let best = null, score = Infinity
  for (let mask = 0; mask < 8; mask++) { const m = build(v, words, mask), s = penalty(m); if (s < score) { score = s; best = m } }
  return best
}

// One SVG path for all the dark modules, with the four-module quiet zone a scanner needs.
export function qrPath(matrix, quiet = 4) {
  let d = ''
  matrix.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x + quiet} ${y + quiet}h1v1h-1z` }))
  return { d, size: matrix.length + quiet * 2 }
}
