"use client";

// Two helpers that fix the two common reasons closet photos look
// sideways:
//
//   normalizeOrientation(file) — bakes the EXIF rotation tag (set by
//     iPhones / Androids when the phone is held sideways) into the
//     actual pixels and re-encodes as JPEG. Most photos with a
//     "Rotation 90 / 180 / 270" EXIF entry render correctly in iOS
//     Photos but appear sideways once the bytes hit a canvas — bg
//     removal, the mannequin overlay, etc. all consume bytes, so we
//     do this BEFORE everything else.
//
//   rotateImage(file, deg) — rotate the pixels by 0/90/180/270.
//     Used after the AI rotation pass on label photos to get text
//     right-side-up.
//
// Both produce a fresh JPEG File with no EXIF orientation tag, so
// downstream consumers always see straight-up pixels.

const JPEG_QUALITY = 0.92;
const FALLBACK_NAME = "photo.jpg";

function fileNameFor(input: File | Blob, override: string | undefined, ext = "jpg"): string {
  if (override) return override;
  if (input instanceof File && input.name) {
    return input.name.replace(/\.(heic|heif|png|webp|jpe?g)$/i, "") + `.${ext}`;
  }
  return FALLBACK_NAME;
}

function passthrough(input: File | Blob, name: string | undefined): File {
  if (input instanceof File) return input;
  return new File([input], fileNameFor(input, name), {
    type: input.type || "image/jpeg",
  });
}

async function bitmapToFile(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, b: ImageBitmap) => void,
  name: string,
  mimeType: "image/jpeg" | "image/png" = "image/jpeg",
): Promise<File | null> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  draw(ctx, bitmap);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), mimeType, mimeType === "image/jpeg" ? JPEG_QUALITY : undefined),
  );
  if (!blob) return null;
  return new File([blob], name, { type: mimeType });
}

// Apply EXIF orientation (if any) and return a new JPEG with the
// rotation baked into pixels. Falls back to the input on any error
// so a bad codec never breaks an upload.
export async function normalizeOrientation(
  input: File | Blob,
  name?: string,
): Promise<File> {
  if (typeof window === "undefined") return passthrough(input, name);

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(input, {
      // Modern browsers (Chrome 79+, Safari 16+, Firefox 113+) honor
      // this and pre-rotate the bitmap to match the EXIF tag.
      imageOrientation: "from-image",
    });
  } catch {
    return passthrough(input, name);
  }

  try {
    const out = await bitmapToFile(
      bitmap,
      bitmap.width,
      bitmap.height,
      (ctx, b) => ctx.drawImage(b, 0, 0),
      fileNameFor(input, name),
    );
    return out ?? passthrough(input, name);
  } finally {
    bitmap.close();
  }
}

// Physically rotate an image by 0/90/180/270 degrees CLOCKWISE.
// Used to apply the AI's right-side-up suggestion to label photos AND
// for the manual rotate buttons on item detail. Pass
// `mimeType: "image/png"` to preserve transparency on bg-removed cutouts.
export async function rotateImage(
  input: File | Blob,
  degrees: 0 | 90 | 180 | 270,
  options?: { name?: string; mimeType?: "image/jpeg" | "image/png" },
): Promise<File> {
  const name = options?.name;
  const mimeType = options?.mimeType ?? "image/jpeg";
  if (degrees === 0) return passthrough(input, name);
  if (typeof window === "undefined") return passthrough(input, name);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(input);
  } catch {
    return passthrough(input, name);
  }

  try {
    const swap = degrees === 90 || degrees === 270;
    const w = swap ? bitmap.height : bitmap.width;
    const h = swap ? bitmap.width : bitmap.height;
    const radians = (degrees * Math.PI) / 180;
    const ext = mimeType === "image/png" ? "png" : "jpg";
    const out = await bitmapToFile(
      bitmap,
      w,
      h,
      (ctx, b) => {
        ctx.translate(w / 2, h / 2);
        ctx.rotate(radians);
        ctx.drawImage(b, -b.width / 2, -b.height / 2);
      },
      fileNameFor(input, name, ext),
      mimeType,
    );
    return out ?? passthrough(input, name);
  } finally {
    bitmap.close();
  }
}
