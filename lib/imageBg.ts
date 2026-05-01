// Server-side post-processing for AI-generated head crops.
//
// Gemini Flash Image's "transparent PNG" requests are unreliable. We've
// seen three failure modes:
//   1. Solid white background (most common)
//   2. Off-white / cream / soft-shadow background
//   3. The literal photoshop transparency-indicator checkerboard pattern
//      drawn AS image content — alternating grey + white squares
//
// A pure threshold chroma-key (the previous implementation) handles (1)
// and (2) but the grey squares in (3) sneak through and you see a faint
// checkerboard around the head.
//
// Approach: flood-fill from the canvas borders. Any pixel that is
// "background-like" (high luminance, low saturation — covers white,
// off-white, AND the light-grey checkerboard squares) AND reachable
// from a border pixel of the same kind gets alpha=0. Pixels inside the
// head silhouette are protected because they're walled off by darker
// skin/hair pixels. Soft-edge feather is applied at the boundary so
// the silhouette doesn't get a hard matte.
//
// Pure JS via `pngjs`. No native deps.

import { PNG } from "pngjs";

// Background-like = min(R,G,B) ≥ HI AND saturation (max-min) ≤ SAT.
// Tuned to catch:
//   - pure white (255,255,255): min=255, sat=0
//   - off-white (245,243,240): min=240, sat=5
//   - light grey checkerboard square (215,215,215): min=215, sat=0
// And NOT catch:
//   - skin (220,180,150): min=150 — fails HI check
//   - light blonde hair (230,210,180): min=180 — fails HI check
const BG_MIN_LUMA = 200;
const BG_MAX_SAT = 35;

// Soft-edge feather: pixels just inside the silhouette that are still
// somewhat light get partial alpha so the head doesn't have a hard cutout.
const SOFT_EDGE_LUMA = 175;

function isBackgroundLike(r: number, g: number, b: number): boolean {
  const min = Math.min(r, g, b);
  const max = Math.max(r, g, b);
  return min >= BG_MIN_LUMA && max - min <= BG_MAX_SAT;
}

export function whiteToTransparent(input: Buffer): Buffer {
  let png: PNG;
  try {
    png = PNG.sync.read(input);
  } catch {
    // Not a valid PNG (Gemini sometimes returns JPEG). Pass through.
    return input;
  }

  const { width, height } = png;
  const channels = png.data.length / (width * height);

  // Normalize to RGBA in a fresh buffer so the rest of the code only
  // has one shape to deal with.
  let rgba: Buffer;
  if (channels === 4) {
    rgba = Buffer.from(png.data);
  } else if (channels === 3) {
    rgba = Buffer.alloc(width * height * 4);
    for (let i = 0, j = 0; i < png.data.length; i += 3, j += 4) {
      rgba[j] = png.data[i];
      rgba[j + 1] = png.data[i + 1];
      rgba[j + 2] = png.data[i + 2];
      rgba[j + 3] = 255;
    }
  } else {
    return input; // unexpected channel count
  }

  const total = width * height;
  // visited bitmap: 0 = unvisited, 1 = background, 2 = foreground-edge
  // (only flagged for background pixels that abut a foreground neighbor —
  // those get the soft-edge feather).
  const flag = new Uint8Array(total);

  // BFS queue of pixel indices (NOT byte offsets).
  const queue: number[] = [];

  // Seed from every border pixel that looks background-like.
  function seed(idx: number) {
    const off = idx * 4;
    const r = rgba[off];
    const g = rgba[off + 1];
    const b = rgba[off + 2];
    if (isBackgroundLike(r, g, b) && flag[idx] === 0) {
      flag[idx] = 1;
      queue.push(idx);
    }
  }
  for (let x = 0; x < width; x++) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    seed(y * width);
    seed(y * width + (width - 1));
  }

  // 4-connected flood fill. Any background-like pixel connected to a
  // border seed is itself background.
  while (queue.length) {
    const idx = queue.pop() as number;
    const x = idx % width;
    const y = (idx / width) | 0;
    const neighbors = [
      x > 0 ? idx - 1 : -1,
      x < width - 1 ? idx + 1 : -1,
      y > 0 ? idx - width : -1,
      y < height - 1 ? idx + width : -1,
    ];
    for (const n of neighbors) {
      if (n < 0 || flag[n] !== 0) continue;
      const off = n * 4;
      if (isBackgroundLike(rgba[off], rgba[off + 1], rgba[off + 2])) {
        flag[n] = 1;
        queue.push(n);
      }
    }
  }

  // Pass 2: write alpha. Background pixels → 0. Pixels adjacent to a
  // background pixel that are still light (luma > SOFT_EDGE_LUMA) get
  // partial alpha proportional to how light they are — feathers the edge.
  for (let idx = 0; idx < total; idx++) {
    const off = idx * 4;
    if (flag[idx] === 1) {
      rgba[off + 3] = 0;
      continue;
    }
    // Foreground pixel. Check 4-neighbors for background; if any, this
    // is on the silhouette boundary and may need feathering.
    const x = idx % width;
    const y = (idx / width) | 0;
    let touchesBg = false;
    if (x > 0 && flag[idx - 1] === 1) touchesBg = true;
    else if (x < width - 1 && flag[idx + 1] === 1) touchesBg = true;
    else if (y > 0 && flag[idx - width] === 1) touchesBg = true;
    else if (y < height - 1 && flag[idx + width] === 1) touchesBg = true;
    if (!touchesBg) continue;

    const r = rgba[off];
    const g = rgba[off + 1];
    const b = rgba[off + 2];
    const min = Math.min(r, g, b);
    if (min >= BG_MIN_LUMA) {
      // Same brightness as background but saturated enough to not be
      // counted as bg by the predicate (e.g. pale pink). Treat as bg too.
      rgba[off + 3] = 0;
    } else if (min > SOFT_EDGE_LUMA) {
      // Linear ramp: at min=SOFT_EDGE_LUMA → alpha unchanged; at
      // min=BG_MIN_LUMA → alpha 0.
      const t = (min - SOFT_EDGE_LUMA) / (BG_MIN_LUMA - SOFT_EDGE_LUMA);
      rgba[off + 3] = Math.round(rgba[off + 3] * (1 - t));
    }
  }

  const out = new PNG({ width, height, colorType: 6, inputColorType: 6 });
  rgba.copy(out.data);
  return PNG.sync.write(out);
}

// Tighten a transparent-bordered PNG to its visible silhouette. Gemini
// often draws the head smaller than its canvas with empty margins, which
// then makes the absolute-positioned `<img>` overlay look offset (the
// face sits low or off-center inside its bbox). Cropping to the actual
// silhouette means the bbox fed to CSS positions the head, not the head
// PNG's incidental whitespace.
//
// Adds a small padding ring so the soft-edge feather isn't chopped.
const CROP_ALPHA_THRESHOLD = 8;  // ignore noise from feather underflow
const CROP_PADDING = 4;          // px of breathing room around the crop

export function cropToSilhouette(input: Buffer): Buffer {
  let png: PNG;
  try {
    png = PNG.sync.read(input);
  } catch {
    return input;
  }

  const { width, height, data } = png;
  const channels = data.length / (width * height);
  // Crop is alpha-driven; if there's no alpha channel there's nothing
  // to tighten against.
  if (channels !== 4) return input;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * 4 + 3];
      if (a > CROP_ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return input; // fully transparent — nothing to crop to

  minX = Math.max(0, minX - CROP_PADDING);
  minY = Math.max(0, minY - CROP_PADDING);
  maxX = Math.min(width - 1, maxX + CROP_PADDING);
  maxY = Math.min(height - 1, maxY + CROP_PADDING);

  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  if (cw === width && ch === height) return input;

  const out = new PNG({ width: cw, height: ch, colorType: 6, inputColorType: 6 });
  for (let y = 0; y < ch; y++) {
    const srcRow = (minY + y) * width + minX;
    const dstRow = y * cw;
    data.copy(out.data, dstRow * 4, srcRow * 4, (srcRow + cw) * 4);
  }
  return PNG.sync.write(out);
}

// Detect where the head sits on a generated mannequin PNG. Returns a
// bounding box in normalized (0..1) coordinates of the source image,
// or null if the figure can't be located.
//
// The mannequin prompt produces a single figure on a plain off-white
// seamless background, head fully visible at the top, feet at the
// bottom. We scan rows top-to-bottom:
//
//   1. find the first row containing a meaningful run of foreground
//      pixels — that's the top of the hair
//   2. estimate head width from the next few percent of rows
//   3. walk down until row width exceeds ~1.5x the head width — that's
//      the start of the shoulders, so the chin/neck is just above
//   4. take the leftmost / rightmost foreground pixel across the head
//      rows for x extents
//
// A small padding ring is added so the user's stylized head overlay
// (which may include hair extending slightly beyond the mannequin's
// bald silhouette) covers the underlying head completely.
const HEAD_BG_MIN_LUMA = 215;       // mannequin bg is plain off-white
const HEAD_BG_MAX_SAT = 30;
const HEAD_MIN_ROW_WIDTH_PX = 5;    // ignore stray noise rows
const HEAD_SHOULDER_RATIO = 1.5;    // shoulders > 1.5x head width

export type HeadBBoxNorm = { x: number; y: number; w: number; h: number };

export function detectHeadBBox(input: Buffer): HeadBBoxNorm | null {
  let png: PNG;
  try {
    png = PNG.sync.read(input);
  } catch {
    return null;
  }

  const { width, height, data } = png;
  const channels = data.length / (width * height);
  if (channels !== 3 && channels !== 4) return null;

  // Per-row foreground bounds (left, right) and pixel count.
  const rowLeft = new Int32Array(height).fill(-1);
  const rowRight = new Int32Array(height).fill(-1);
  const rowCount = new Int32Array(height);

  for (let y = 0; y < height; y++) {
    let left = -1;
    let right = -1;
    let count = 0;
    for (let x = 0; x < width; x++) {
      const off = (y * width + x) * channels;
      const r = data[off];
      const g = data[off + 1];
      const b = data[off + 2];
      const min = Math.min(r, g, b);
      const max = Math.max(r, g, b);
      const isBg = min >= HEAD_BG_MIN_LUMA && max - min <= HEAD_BG_MAX_SAT;
      if (!isBg) {
        if (left < 0) left = x;
        right = x;
        count++;
      }
    }
    rowLeft[y] = left;
    rowRight[y] = right;
    rowCount[y] = count;
  }

  // 1. First row with substantial figure.
  let yTop = -1;
  for (let y = 0; y < height; y++) {
    if (rowCount[y] >= HEAD_MIN_ROW_WIDTH_PX) {
      yTop = y;
      break;
    }
  }
  if (yTop < 0) return null;

  // 2. Average head width over a sample window just below the top.
  const sampleRows = Math.max(3, Math.floor(height * 0.04));
  const sampleEnd = Math.min(height - 1, yTop + sampleRows);
  let sumWidth = 0;
  let samples = 0;
  for (let y = yTop; y <= sampleEnd; y++) {
    if (rowCount[y] >= HEAD_MIN_ROW_WIDTH_PX) {
      sumWidth += rowRight[y] - rowLeft[y] + 1;
      samples++;
    }
  }
  if (samples === 0) return null;
  const avgHeadWidth = sumWidth / samples;

  // 3. Walk down to find the shoulder transition. Bottom of head is
  // the local min width between the head sample window and the
  // shoulder row (the neck), or the shoulder row itself if no clear
  // pinch — better to over-cover than to slice off the chin.
  let yShoulder = -1;
  for (let y = sampleEnd + 1; y < height; y++) {
    if (rowCount[y] < HEAD_MIN_ROW_WIDTH_PX) continue;
    const w = rowRight[y] - rowLeft[y] + 1;
    if (w > avgHeadWidth * HEAD_SHOULDER_RATIO) {
      yShoulder = y;
      break;
    }
  }
  // Fallback: assume head occupies the top ~18% of the figure.
  if (yShoulder < 0) yShoulder = Math.min(height - 1, yTop + Math.floor(height * 0.18));

  let yChin = yShoulder - 1;
  let minRunWidth = Infinity;
  const searchStart = sampleEnd + 1;
  for (let y = searchStart; y < yShoulder; y++) {
    if (rowCount[y] < HEAD_MIN_ROW_WIDTH_PX) continue;
    const w = rowRight[y] - rowLeft[y] + 1;
    if (w < minRunWidth) {
      minRunWidth = w;
      yChin = y;
    }
  }

  // 4. x extents across the head rows.
  let xMin = width;
  let xMax = -1;
  for (let y = yTop; y <= yChin; y++) {
    if (rowCount[y] < HEAD_MIN_ROW_WIDTH_PX) continue;
    if (rowLeft[y] < xMin) xMin = rowLeft[y];
    if (rowRight[y] > xMax) xMax = rowRight[y];
  }
  if (xMax < 0) return null;

  // Padding so the overlay's hair has room beyond the bald silhouette.
  const padX = (xMax - xMin + 1) * 0.18;
  const headHeight = yChin - yTop + 1;
  const padTop = headHeight * 0.15;
  const padBottom = headHeight * 0.05;

  const x0 = Math.max(0, xMin - padX);
  const y0 = Math.max(0, yTop - padTop);
  const x1 = Math.min(width, xMax + padX + 1);
  const y1 = Math.min(height, yChin + padBottom + 1);

  return {
    x: x0 / width,
    y: y0 / height,
    w: (x1 - x0) / width,
    h: (y1 - y0) / height,
  };
}
