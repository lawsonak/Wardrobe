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
