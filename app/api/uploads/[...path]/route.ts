import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { auth } from "@/auth";

export const runtime = "nodejs";

const UPLOAD_ROOT = path.join(process.cwd(), "data", "uploads");

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { path: parts } = await params;
  // Owner-scope guard: every per-user upload sits under
  // data/uploads/<userId>/..., so the first path segment must
  // match the caller's id. Without this, a logged-in user could
  // request /api/uploads/<otherUserId>/<filename> and read the
  // other profile's photos. (The global mannequin asset lives in
  // /public/mannequin/, served directly by Next.js, so no
  // whitelist is needed here.)
  if (parts.length === 0 || parts[0] !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rel = parts.join("/");
  const full = path.resolve(path.join(UPLOAD_ROOT, rel));
  // Prevent path traversal
  if (!full.startsWith(path.resolve(UPLOAD_ROOT) + path.sep)) {
    return NextResponse.json({ error: "Bad path" }, { status: 400 });
  }
  try {
    const buf = await fs.readFile(full);
    const ext = path.extname(full).toLowerCase();
    return new NextResponse(buf, {
      headers: {
        "Content-Type": TYPES[ext] ?? "application/octet-stream",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
