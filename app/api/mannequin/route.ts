import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { auth } from "@/auth";
import {
  clearMannequinFiles,
  findSourcePath,
  getMannequinForUser,
  readRenderedPng,
  saveLandmarks,
  saveRendered,
  saveSourcePhoto,
} from "@/lib/mannequin";
import { generateMannequinImage } from "@/lib/ai/mannequin";
import { extractLandmarks } from "@/lib/ai/mannequinLandmarks";

export const runtime = "nodejs";
// Image generation can take 10-25s on Gemini's image preview models;
// landmark extraction adds another text call. 90s ceiling is plenty.
export const maxDuration = 90;

// Best-effort landmark extraction. Failure is non-fatal — the canvas
// falls back to the original hardcoded slot defaults when no
// landmarks file exists.
async function captureLandmarks(userId: string, png: Buffer): Promise<string | null> {
  try {
    const result = await extractLandmarks({ buffer: png, mime: "image/png" });
    if (!result.ok) return result.error;
    await saveLandmarks(userId, result.landmarks);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

// GET /api/mannequin
// Returns { url: string | null, hasSource: boolean, hasLandmarks: boolean }
// so the Settings page knows whether to show "Upload" vs "Regenerate"
// and "Recalibrate fit".
export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const info = await getMannequinForUser(userId);
  return NextResponse.json({
    url: info.url,
    hasSource: info.hasSource,
    hasLandmarks: !!info.landmarks,
  });
}

// POST /api/mannequin
//   Multipart with `source` File → save + generate + extract landmarks.
//   JSON { mode: "regenerate" } → re-run generation on the saved source.
//   JSON { mode: "recalibrate" } → re-extract landmarks from the
//     existing rendered mannequin without regenerating it.
export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: "Image generation requires GEMINI_API_KEY in .env." },
      { status: 400 },
    );
  }

  const contentType = req.headers.get("content-type") || "";

  // Recalibrate-only path: reuse the rendered mannequin, just re-run
  // landmark extraction. No image-gen call, no quota burn.
  if (!contentType.includes("multipart/form-data")) {
    const body = await req.json().catch(() => ({}));
    if (body?.mode === "recalibrate") {
      const png = await readRenderedPng(userId);
      if (!png) {
        return NextResponse.json(
          { error: "No mannequin to calibrate. Upload a photo first." },
          { status: 400 },
        );
      }
      const err = await captureLandmarks(userId, png);
      const info = await getMannequinForUser(userId);
      if (err) {
        return NextResponse.json(
          { ok: false, error: err, url: info.url, hasSource: info.hasSource, hasLandmarks: !!info.landmarks },
          { status: 502 },
        );
      }
      return NextResponse.json({
        ok: true,
        url: info.url,
        hasSource: info.hasSource,
        hasLandmarks: true,
      });
    }
    // Otherwise treat as a regenerate-from-saved-source request.
  }

  let sourceBuf: Buffer | null = null;
  let sourceMime = "image/jpeg";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("source");
    if (!file || !(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Missing source photo" }, { status: 400 });
    }
    if (file.size > 12 * 1024 * 1024) {
      return NextResponse.json({ error: "Photo too large (max 12 MB)" }, { status: 400 });
    }
    await saveSourcePhoto(userId, file, file.type);
    sourceBuf = Buffer.from(await file.arrayBuffer());
    sourceMime = file.type || "image/jpeg";
  } else {
    // Regenerate from the previously-saved source.
    const sourcePath = await findSourcePath(userId);
    if (!sourcePath) {
      return NextResponse.json(
        { error: "No source photo on file. Upload a photo first." },
        { status: 400 },
      );
    }
    sourceBuf = await fs.readFile(sourcePath);
    const ext = path.extname(sourcePath).toLowerCase();
    sourceMime =
      ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  }

  const result = await generateMannequinImage({ buffer: sourceBuf, mime: sourceMime });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, status: result.status ?? 500 },
      { status: 502 },
    );
  }
  await saveRendered(userId, result.png);
  // Extract landmarks from the freshly-rendered mannequin. Best-effort —
  // a failure here doesn't block the upload; the UI surfaces it via
  // hasLandmarks=false and a "Recalibrate fit" button.
  const calibrationError = await captureLandmarks(userId, result.png);
  const info = await getMannequinForUser(userId);
  return NextResponse.json({
    ok: true,
    url: info.url,
    hasSource: info.hasSource,
    hasLandmarks: !!info.landmarks,
    calibrationError,
  });
}

// DELETE /api/mannequin → reset to default silhouette (removes mannequin,
// source, and landmarks).
export async function DELETE() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await clearMannequinFiles(userId);
  return NextResponse.json({ ok: true });
}
