import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { CATEGORIES } from "@/lib/constants";
import { saveUploadWithOriginal, computeDHash } from "@/lib/uploads";
import { runHiResBgRemovalBatch } from "@/lib/bgRemovalServer";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";

// Multipart POST. Accepts multiple `images` parts plus a single
// `category` and optional `status` (defaults to "needs_review"). Saves
// each photo as its own Item in one round trip — no background removal,
// no AI tagging. Returns the created item ids so the client can keep
// processing them client-side (bg removal, auto-tag) on its own time.
//
// This is what you call from the bulk-upload page so the user can close
// the tab right after the upload completes; bg removal becomes a
// separate, resumable pass.
export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData();
  const rawCategory = String(form.get("category") || "");
  // "__auto__" means the user wants AI to assign a category. We need a
  // non-null category at insert time, so store a placeholder ("Tops")
  // and force needs_review status — AI tagging will overwrite both.
  const isAuto = rawCategory === "__auto__";
  const category = isAuto ? "Tops" : rawCategory;
  if (!isAuto && (!category || !CATEGORIES.includes(category as (typeof CATEGORIES)[number]))) {
    return NextResponse.json({ error: "Missing or invalid category" }, { status: 400 });
  }
  const statusVal = isAuto
    ? "needs_review"
    : (form.get("status") as string | null) || "needs_review";
  // Optional Backroom flag for the entire batch — useful when the user
  // is importing intimate items in one shot. Per-item override happens
  // via the edit page after upload.
  const isBackroom = form.get("isBackroom") === "1";

  const files = form.getAll("images").filter((x): x is File => x instanceof File && x.size > 0);
  if (files.length === 0) {
    return NextResponse.json({ error: "No images attached" }, { status: 400 });
  }
  if (files.length > 50) {
    return NextResponse.json({ error: "Max 50 photos per request" }, { status: 400 });
  }

  const created: Array<{ id: string; imagePath: string }> = [];
  for (const file of files) {
    const placeholder = await prisma.item.create({
      data: {
        ownerId: userId,
        imagePath: "pending",
        category,
        status: statusVal,
        isBackroom,
      },
    });
    const { displayPath, originalPath } = await saveUploadWithOriginal(
      userId,
      placeholder.id,
      file,
      "orig",
    );
    const phash = await computeDHash(Buffer.from(await file.arrayBuffer()));
    const updated = await prisma.item.update({
      where: { id: placeholder.id },
      data: { imagePath: displayPath, imageOriginalPath: originalPath, phash },
    });
    created.push({ id: updated.id, imagePath: updated.imagePath });
  }

  if (created.length > 0) {
    await logActivity({
      userId,
      kind: "item.bulk-create",
      summary: `Imported ${created.length} item${created.length === 1 ? "" : "s"}`,
      meta: { count: created.length, defaultCategory: rawCategory },
    });

    // Hi-res cutout pass. Fire-and-forget — the bulk-tag worker
    // already runs in the background after this route flushes; this
    // joins the same pattern. With concurrency 3, ~10 s per photo,
    // a 50-photo import finishes hi-res cutouts in ~3 min while the
    // user goes about their day.
    const ids = created.map((c) => c.id);
    void runHiResBgRemovalBatch(prisma, userId, ids).catch((err) => {
      console.warn("hi-res bg removal kick-off failed (bulk):", err);
    });
  }

  return NextResponse.json({ created, count: created.length }, { status: 201 });
}
