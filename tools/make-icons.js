// Renders the app icon to PNG (no dependencies). Run: node tools/make-icons.js
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

// Shapes in a 100x100 space. Later shapes paint over earlier ones.
const BG = [42, 140, 255], DARK = [11, 61, 122], LIGHT = [191, 227, 255], WHITE = [255, 255, 255];
const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  const cx = Math.max(x0 + r, Math.min(x, x1 - r)), cy = Math.max(y0 + r, Math.min(y, y1 - r));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
// L-shaped pipe from the bottom edge to the right edge, with a rounded inner bend.
const inElbow = (x, y, half) => {
  const r = 8; // bend radius at (58,58)
  const v = x >= 50 - half && x <= 50 + half && y >= 58 && y <= 101;
  const hz = y >= 50 - half && y <= 50 + half && x >= 58 && x <= 101;
  const dx = x - 58, dy = y - 58, d = Math.hypot(dx, dy);
  const bend = dx <= 0 && dy <= 0 && Math.abs(d - r) <= half;
  return v || hz || bend;
};
const inDrop = (x, y) => {
  const cx = 34, cy = 38, r = 8.5;
  if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) return true;
  if (y < 22 || y > cy) return false;
  const t = (y - 22) / (cy - 22); // widen towards the circle
  return Math.abs(x - cx) <= t * r * 0.98;
};
function color(x, y, fullBleed) {
  if (!fullBleed && !inRoundRect(x, y, 4, 4, 96, 96, 22)) return null;
  let c = BG;
  if (inElbow(x, y, 11)) c = DARK;
  if (inElbow(x, y, 5)) c = LIGHT;
  if ((x - 34) ** 2 + (y - 34) ** 2 <= 17 * 17) c = WHITE;
  if (inDrop(x, y)) c = BG;
  return c;
}

function render(size, fullBleed) {
  const SS = 4, px = Buffer.alloc(size * size * 4);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const c = color(((i + (sx + 0.5) / SS) / size) * 100, ((j + (sy + 0.5) / SS) / size) * 100, fullBleed);
      if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
    }
    const o = (j * size + i) * 4, k = SS * SS;
    px[o] = a ? r / a : 0; px[o + 1] = a ? g / a : 0; px[o + 2] = a ? b / a : 0; px[o + 3] = (a / k) * 255;
  }
  return png(size, px);
}

function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const out = path.join(__dirname, '..', 'icons');
// iOS rounds the corners itself and shows black behind any transparency, so its icon is full-bleed.
fs.writeFileSync(path.join(out, 'apple-touch-icon.png'), render(180, true));
fs.writeFileSync(path.join(out, 'icon-512-maskable.png'), render(512, true));
fs.writeFileSync(path.join(out, 'icon-192.png'), render(192, false));
fs.writeFileSync(path.join(out, 'icon-512.png'), render(512, false));
console.log('icons written to', out);
