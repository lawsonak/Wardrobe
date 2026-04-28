#!/usr/bin/env node
// Generates PNG app icons from raw bytes — no native deps.
// 180x180 apple-touch-icon, plus 192/512 PWA manifest icons.
//
// Design: blush gradient background with a centered "W" mark.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "public", "icons");

const BG_TOP = [255, 198, 213];       // blush-200
const BG_BOTTOM = [242, 92, 135];     // blush-500
const FG = [255, 255, 255];
const ACCENT = [253, 250, 246];       // cream-50

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }

function writePng(width, height, pixelFn) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4);
    const crcVal = computeCrc(Buffer.concat([t, data]));
    crc.writeUInt32BE(crcVal >>> 0, 0);
    return Buffer.concat([len, t, data, crc]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(6, 9);
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  const raw = Buffer.alloc((width * 4 + 1) * height);
  let off = 0;
  for (let y = 0; y < height; y++) {
    raw[off++] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelFn(x, y, width, height);
      raw[off++] = r; raw[off++] = g; raw[off++] = b; raw[off++] = a;
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function computeCrc(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function inW(x, y, w, h) {
  const cx = w / 2, cy = h / 2;
  const halfW = w * 0.32;
  const halfH = h * 0.22;
  const stroke = w * 0.085;
  const left = cx - halfW;
  const right = cx + halfW;
  const top = cy - halfH;
  const bottom = cy + halfH;
  const midX = cx;
  const midPeak = cy - halfH * 0.18;

  const segs = [
    [left, top, midX - halfW * 0.2, bottom],
    [midX - halfW * 0.2, bottom, midX, midPeak],
    [midX, midPeak, midX + halfW * 0.2, bottom],
    [midX + halfW * 0.2, bottom, right, top],
  ];

  for (const [x1, y1, x2, y2] of segs) {
    const vx = x2 - x1, vy = y2 - y1;
    const wx = x - x1, wy = y - y1;
    const c1 = vx * wx + vy * wy;
    if (c1 < 0) {
      const dx = x - x1, dy = y - y1;
      if (dx * dx + dy * dy <= (stroke / 2) ** 2) return true;
      continue;
    }
    const c2 = vx * vx + vy * vy;
    if (c2 < c1) {
      const dx = x - x2, dy = y - y2;
      if (dx * dx + dy * dy <= (stroke / 2) ** 2) return true;
      continue;
    }
    const t = c1 / c2;
    const px = x1 + t * vx, py = y1 + t * vy;
    const dx = x - px, dy = y - py;
    if (dx * dx + dy * dy <= (stroke / 2) ** 2) return true;
  }
  return false;
}

function pixelAt(x, y, w, h) {
  const t = y / h;
  const bg = [
    lerp(BG_TOP[0], BG_BOTTOM[0], t),
    lerp(BG_TOP[1], BG_BOTTOM[1], t),
    lerp(BG_TOP[2], BG_BOTTOM[2], t),
  ];
  if (inW(x, y, w, h)) return [...FG, 255];
  const vx = x - w * 0.78;
  const vy = y - h * 0.82;
  const r = Math.sqrt(vx * vx + vy * vy);
  if (r < w * 0.05) return [...ACCENT, 230];
  return [...bg, 255];
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const sizes = [
    { name: "apple-touch-icon.png", size: 180 },
    { name: "icon-192.png", size: 192 },
    { name: "icon-512.png", size: 512 },
    { name: "icon-maskable-512.png", size: 512 },
  ];
  for (const { name, size } of sizes) {
    const buf = writePng(size, size, (x, y) => pixelAt(x, y, size, size));
    await writeFile(path.join(OUT_DIR, name), buf);
    console.log(`✓ ${name} (${size}×${size}, ${(buf.length / 1024).toFixed(1)} KB)`);
  }
}

main().catch((err) => {
  console.error("make-icons failed:", err);
  process.exit(1);
});
