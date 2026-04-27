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
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { path: parts } = await params;
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
