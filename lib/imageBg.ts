// Server-side post-processing for AI-generated head crops.
//
// Gemini Flash Image's "transparent PNG" requests are unreliable — it
// frequently returns a PNG with a solid white background instead of a
// real alpha channel. We chroma-key the white pixels to alpha=0 with
// soft edges so the head sits cleanly on top of a try-on without a
// visible white square.
//
// Implementation: pure JS via `pngjs`. No native deps. The thresholds
// are tuned for the Gemini output (saturated white background, slight
// JPEG-ish anti-aliasing artifacts at the silhouette edges).

import { PNG } from "pngjs";

const FULLY_TRANSPARENT_AT = 245; // min(R,G,B) above this → alpha 0
const SOFT_EDGE_FROM = 220;       // …and below this stays opaque; in
                                  // between, alpha ramps linearly so
                                  // the silhouette doesn't get a hard
                                  // matte edge.

export function whiteToTransparent(input: Buffer): Buffer {
  let png: PNG;
  try {
    png = PNG.sync.read(input);
  } catch {
    // Not a valid PNG (Gemini sometimes returns JPEG). Pass the
    // bytes through unchanged — caller can decide what to do.
    return input;
  }

  // PNG.sync.read normalizes to RGBA when the source has any kind of
  // transparency or palette; for plain RGB sources it stays 3-channel.
  // pngjs always exposes a .data buffer that's RGBA when colorType
  // includes alpha; we force RGBA on output.
  const channels = png.data.length / (png.width * png.height);
  const data = png.data;

  if (channels === 4) {
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const m = Math.min(r, g, b);
      if (m >= FULLY_TRANSPARENT_AT) {
        data[i + 3] = 0;
      } else if (m > SOFT_EDGE_FROM) {
        const t = (m - SOFT_EDGE_FROM) / (FULLY_TRANSPARENT_AT - SOFT_EDGE_FROM);
        // Multiply existing alpha (preserves any anti-aliasing the
        // model already produced) by the chroma-key factor.
        data[i + 3] = Math.max(0, Math.min(255, Math.round(data[i + 3] * (1 - t))));
      }
    }
    return PNG.sync.write(png);
  }

  if (channels === 3) {
    // Synthesize an alpha channel from scratch.
    const out = new PNG({
      width: png.width,
      height: png.height,
      colorType: 6, // RGBA
      inputColorType: 6,
    });
    const src = data;
    const dst = out.data;
    for (let i = 0, j = 0; i < src.length; i += 3, j += 4) {
      const r = src[i];
      const g = src[i + 1];
      const b = src[i + 2];
      dst[j] = r;
      dst[j + 1] = g;
      dst[j + 2] = b;
      const m = Math.min(r, g, b);
      if (m >= FULLY_TRANSPARENT_AT) dst[j + 3] = 0;
      else if (m > SOFT_EDGE_FROM) {
        const t = (m - SOFT_EDGE_FROM) / (FULLY_TRANSPARENT_AT - SOFT_EDGE_FROM);
        dst[j + 3] = Math.round(255 * (1 - t));
      } else {
        dst[j + 3] = 255;
      }
    }
    return PNG.sync.write(out);
  }

  // Unexpected channel count — pass through.
  return input;
}
