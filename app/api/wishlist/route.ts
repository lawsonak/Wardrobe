import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { WISHLIST_PRIORITIES } from "@/lib/constants";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";

const UPLOAD_ROOT = path.join(process.cwd(), "data", "uploads");
const DISPLAY_MAX_EDGE_PX = 1024;

// Persist a wishlist photo. Mirrors lib/uploads.saveUpload's two
// crucial behaviours that the previous local helper was missing:
//   1. sharp().rotate() bakes EXIF orientation into pixels — without
//      this iPhone landscape screenshots come out sideways in the
//      browser.
//   2. resize-down to DISPLAY_MAX_EDGE_PX so a 4 MB iPhone photo
//      doesn't land at full size.
// Stored under <userId>/wishlist/<file> — kept in a subdir so legacy
// wishlist URLs still resolve.
async function saveWishlistUpload(userId: string, itemId: string, file: File, suffix: string) {
  const userDir = path.join(UPLOAD_ROOT, userId, "wishlist");
  await fs.mkdir(userDir, { recursive: true });
  const raw = Buffer.from(await file.arrayBuffer());

  // Try sharp first; fall back to the raw bytes for unsupported
  // formats (gif, svg, …) so the row still gets a usable image.
  // Buffer typing widened so sharp.toBuffer()'s narrower return
  // type doesn't fight reassignment.
  let outBuf: Buffer = raw;
  let outExt = (file.type.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "");
  try {
    const pipeline = sharp(raw, { failOn: "none" })
      .rotate()
      .resize({
        width: DISPLAY_MAX_EDGE_PX,
        height: DISPLAY_MAX_EDGE_PX,
        fit: "inside",
        withoutEnlargement: true,
      });
    if (file.type === "image/png") {
      outBuf = await pipeline.png({ compressionLevel: 9, effort: 6 }).toBuffer();
      outExt = "png";
    } else if (file.type === "image/webp") {
      outBuf = await pipeline.webp({ quality: 85 }).toBuffer();
      outExt = "webp";
    } else if (file.type === "image/jpeg" || file.type === "image/jpg" || !file.type) {
      outBuf = await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
      outExt = "jpg";
    }
  } catch {
    /* leave outBuf = raw, outExt = sniffed */
  }

  const filename = `${itemId}-${suffix}.${outExt}`;
  const fullPath = path.join(userDir, filename);
  await fs.writeFile(fullPath, outBuf);
  return path.posix.join(userId, "wishlist", filename);
}

export async function GET(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!session?.user || !userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const purchased = searchParams.get("purchased");

  const items = await prisma.wishlistItem.findMany({
    where: {
      ownerId: userId,
      ...(purchased === "0" ? { purchased: false } : {}),
      ...(purchased === "1" ? { purchased: true } : {}),
    },
    orderBy: [{ purchased: "asc" }, { createdAt: "desc" }],
  });
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!session?.user || !userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const contentType = req.headers.get("content-type") ?? "";
  let name: string, category: string | null, brand: string | null, link: string | null,
    price: string | null, priority: string, occasion: string | null, notes: string | null,
    fillsGap: boolean, giftIdea: boolean, imageFile: File | null;

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    name = String(form.get("name") || "").trim();
    category = (form.get("category") as string | null) || null;
    brand = (form.get("brand") as string | null) || null;
    link = (form.get("link") as string | null) || null;
    price = (form.get("price") as string | null) || null;
    priority = String(form.get("priority") || "medium");
    occasion = (form.get("occasion") as string | null) || null;
    notes = (form.get("notes") as string | null) || null;
    fillsGap = form.get("fillsGap") === "1";
    giftIdea = form.get("giftIdea") === "1";
    const imgField = form.get("image");
    imageFile = imgField instanceof File && imgField.size > 0 ? imgField : null;
  } else {
    const body = await req.json();
    name = String(body.name || "").trim();
    category = body.category || null;
    brand = body.brand || null;
    link = body.link || null;
    price = body.price || null;
    priority = body.priority || "medium";
    occasion = body.occasion || null;
    notes = body.notes || null;
    fillsGap = !!body.fillsGap;
    giftIdea = !!body.giftIdea;
    imageFile = null;
  }

  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (!WISHLIST_PRIORITIES.includes(priority as (typeof WISHLIST_PRIORITIES)[number])) {
    priority = "medium";
  }

  const created = await prisma.wishlistItem.create({
    data: { ownerId: userId, name, category, brand, link, price, priority, occasion, notes, fillsGap, giftIdea },
  });

  if (imageFile) {
    const imagePath = await saveWishlistUpload(userId, created.id, imageFile, "img");
    await prisma.wishlistItem.update({ where: { id: created.id }, data: { imagePath } });
    await logActivity({
      userId,
      kind: "wishlist.create",
      summary: `Added "${name}" to wishlist`,
      targetType: "WishlistItem",
      targetId: created.id,
    });
    return NextResponse.json({ item: { ...created, imagePath } });
  }

  await logActivity({
    userId,
    kind: "wishlist.create",
    summary: `Added "${name}" to wishlist`,
    targetType: "WishlistItem",
    targetId: created.id,
  });

  return NextResponse.json({ item: created });
}
