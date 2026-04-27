import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { CATEGORIES, listToCsv } from "@/lib/constants";

export const runtime = "nodejs";

const UPLOAD_ROOT = path.join(process.cwd(), "data", "uploads");

async function saveUpload(userId: string, itemId: string, file: File, suffix: string) {
  const userDir = path.join(UPLOAD_ROOT, userId);
  await fs.mkdir(userDir, { recursive: true });
  const ext = (file.type.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "");
  const filename = `${itemId}-${suffix}.${ext}`;
  const fullPath = path.join(userDir, filename);
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(fullPath, buf);
  return path.posix.join(userId, filename);
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const category = searchParams.get("category") || undefined;
  const fav = searchParams.get("fav") === "1";
  const search = searchParams.get("q")?.trim();

  const items = await prisma.item.findMany({
    where: {
      ...(category ? { category } : {}),
      ...(fav ? { isFavorite: true } : {}),
      ...(search
        ? {
            OR: [
              { subType: { contains: search } },
              { brand: { contains: search } },
              { color: { contains: search } },
              { notes: { contains: search } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!session?.user || !userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await req.formData();
  const original = form.get("image");
  const bgRemoved = form.get("imageBgRemoved");
  const category = String(form.get("category") || "");
  if (!original || !(original instanceof File) || !category) {
    return NextResponse.json({ error: "Missing image or category" }, { status: 400 });
  }
  if (!CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }

  const subType = (form.get("subType") as string | null) || null;
  const color = (form.get("color") as string | null) || null;
  const brand = (form.get("brand") as string | null) || null;
  const size = (form.get("size") as string | null) || null;
  const notes = (form.get("notes") as string | null) || null;
  const seasons = listToCsv(form.getAll("seasons").map(String));
  const activities = listToCsv(form.getAll("activities").map(String));
  const isFavorite = form.get("isFavorite") === "1";

  const created = await prisma.item.create({
    data: {
      ownerId: userId,
      imagePath: "pending",
      category,
      subType,
      color,
      brand,
      size,
      seasons,
      activities,
      notes,
      isFavorite,
    },
  });

  const imagePath = await saveUpload(userId, created.id, original, "orig");
  let imageBgRemovedPath: string | null = null;
  if (bgRemoved && bgRemoved instanceof File && bgRemoved.size > 0) {
    imageBgRemovedPath = await saveUpload(userId, created.id, bgRemoved, "bg");
  }

  const updated = await prisma.item.update({
    where: { id: created.id },
    data: { imagePath, imageBgRemovedPath },
  });

  return NextResponse.json({ item: updated });
}
