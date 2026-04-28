import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const body = await req.json();
  const data: Record<string, unknown> = {};
  if (typeof body.name === "string") data.name = body.name.trim() || "Untitled outfit";
  if (typeof body.isFavorite === "boolean") data.isFavorite = body.isFavorite;
  if (typeof body.activity === "string") data.activity = body.activity || null;
  if (typeof body.season === "string") data.season = body.season || null;
  if (body.layoutJson === null) {
    data.layoutJson = null;
  } else if (typeof body.layoutJson === "string") {
    // Validate it parses, but don't pretty-print or transform.
    try {
      JSON.parse(body.layoutJson);
      data.layoutJson = body.layoutJson;
    } catch {
      return NextResponse.json({ error: "Invalid layout JSON" }, { status: 400 });
    }
  }

  // Owner check before update.
  const existing = await prisma.outfit.findFirst({ where: { id, ownerId: userId }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const outfit = await prisma.outfit.update({ where: { id }, data });
  return NextResponse.json({ outfit });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  await prisma.outfit.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
