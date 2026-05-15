import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { parse, sanitize, serialize } from "@/lib/measurements";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";

// GET — return the caller's saved measurements (or null). Strictly
// owner-scoped; profiles never cross-read.
export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { measurements: true },
  });
  return NextResponse.json({ measurements: parse(user?.measurements ?? null) });
}

// PUT — replace the caller's measurements with the posted blob.
// Sanitize hard (range-clamps every field, recomputes the bra size)
// so a bad client payload can't poison the AI prompts that consume
// this in later phases. An empty blob clears the column.
export async function PUT(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const clean = sanitize({ ...body, updatedAt: new Date().toISOString() });
  if (!clean) {
    return NextResponse.json({ error: "Invalid measurements" }, { status: 400 });
  }
  const stored = serialize(clean);

  await prisma.user.update({
    where: { id: userId },
    data: { measurements: stored },
  });

  await logActivity({
    userId,
    kind: "measurements.update",
    summary: stored ? "Updated body measurements" : "Cleared body measurements",
  });

  return NextResponse.json({ measurements: parse(stored) });
}
