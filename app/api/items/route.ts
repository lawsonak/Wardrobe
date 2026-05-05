import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { CATEGORIES, listToCsv } from "@/lib/constants";
import { brandKey } from "@/lib/brand";
import { saveUpload, saveUploadWithOriginal } from "@/lib/uploads";
import { describeItem, logActivity } from "@/lib/activity";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const category = searchParams.get("category") || undefined;
  const fav = searchParams.get("fav") === "1";
  const search = searchParams.get("q")?.trim();
  const status = searchParams.get("status") || undefined;

  const items = await prisma.item.findMany({
    where: {
      // Owner-scope guard: every closet view is per-profile. Without
      // this filter the endpoint returned every user's items to any
      // authenticated caller, which broke the documented "profiles
      // are separate" model.
      ownerId: userId,
      ...(category ? { category } : {}),
      ...(fav ? { isFavorite: true } : {}),
      ...(status ? { status } : {}),
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
  const labelImage = form.get("labelImage");
  const category = String(form.get("category") || "");
  if (!original || !(original instanceof File) || !category) {
    return NextResponse.json({ error: "Missing image or category" }, { status: 400 });
  }
  if (!CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }

  const subType = (form.get("subType") as string | null) || null;
  const color = (form.get("color") as string | null) || null;
  const brandText = (form.get("brand") as string | null) || null;
  const brandIdInput = (form.get("brandId") as string | null) || null;
  const size = (form.get("size") as string | null) || null;
  const fitDetails = (form.get("fitDetails") as string | null) || null;
  const fitNotes = (form.get("fitNotes") as string | null) || null;
  const notes = (form.get("notes") as string | null) || null;
  const seasons = listToCsv(form.getAll("seasons").map(String));
  const activities = listToCsv(form.getAll("activities").map(String));
  const isFavorite = form.get("isFavorite") === "1";
  const statusVal = (form.get("status") as string | null) || "active";

  // Resolve brand: use brandId if it's the current user's, else upsert by key.
  let brandId: string | null = null;
  let brandFinal = brandText;
  if (brandIdInput) {
    const found = await prisma.brand.findFirst({ where: { id: brandIdInput, ownerId: userId } });
    if (found) {
      brandId = found.id;
      brandFinal = found.name;
    }
  }
  if (!brandId && brandText && brandText.trim()) {
    const key = brandKey(brandText);
    if (key) {
      const upserted = await prisma.brand.upsert({
        where: { ownerId_nameKey: { ownerId: userId, nameKey: key } },
        update: {},
        create: { ownerId: userId, name: brandText.trim(), nameKey: key },
      });
      brandId = upserted.id;
      brandFinal = upserted.name;
    }
  }

  const created = await prisma.item.create({
    data: {
      ownerId: userId,
      imagePath: "pending",
      category,
      subType,
      color,
      brand: brandFinal,
      brandId,
      size,
      fitDetails,
      fitNotes,
      seasons,
      activities,
      notes,
      isFavorite,
      status: statusVal,
    },
  });

  // Two-tier write for the main photo: a small display variant
  // (everything-but-zoom) plus the untouched original for the item
  // detail page's tap-to-zoom. Bg-removed and label photos stay
  // single-variant — utility renders, not user-precious memories.
  const { displayPath: imagePath, originalPath: imageOriginalPath } =
    await saveUploadWithOriginal(userId, created.id, original, "orig");
  let imageBgRemovedPath: string | null = null;
  if (bgRemoved && bgRemoved instanceof File && bgRemoved.size > 0) {
    imageBgRemovedPath = await saveUpload(userId, created.id, bgRemoved, "bg");
  }
  let labelImagePath: string | null = null;
  if (labelImage && labelImage instanceof File && labelImage.size > 0) {
    labelImagePath = await saveUpload(userId, created.id, labelImage, "label");
  }

  const updated = await prisma.item.update({
    where: { id: created.id },
    data: { imagePath, imageOriginalPath, imageBgRemovedPath, labelImagePath },
  });

  await logActivity({
    userId,
    kind: "item.create",
    summary: `Added ${describeItem(updated)}`,
    targetType: "Item",
    targetId: updated.id,
  });

  return NextResponse.json({ item: updated });
}
