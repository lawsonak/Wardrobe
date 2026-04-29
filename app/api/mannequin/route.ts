import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { auth } from "@/auth";
import {
  clearMannequinFiles,
  findSourcePath,
  getMannequinForUser,
  saveRendered,
  saveSourcePhoto,
} from "@/lib/mannequin";
import { generateMannequinImage } from "@/lib/ai/mannequin";

export const runtime = "nodejs";
// Image generation can take 10-25s on Gemini's image preview models.
export const maxDuration = 60;

// GET /api/mannequin
// Returns { url: string | null, hasSource: boolean } so the Settings
// page knows whether to show "Upload" vs "Regenerate / Reset".
export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const info = await getMannequinForUser(userId);
  return NextResponse.json(info);
}

// POST /api/mannequin
//   Multipart with `source` File → save + generate.
//   JSON { mode: "regenerate" } → re-run on the previously-saved source.
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

  let sourceBuf: Buffer | null = null;
  let sourceMime = "image/jpeg";

  const contentType = req.headers.get("content-type") || "";
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
  const info = await getMannequinForUser(userId);
  return NextResponse.json({ ...info, ok: true });
}

// DELETE /api/mannequin → reset to default silhouette (removes both files).
export async function DELETE() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await clearMannequinFiles(userId);
  return NextResponse.json({ ok: true });
}
