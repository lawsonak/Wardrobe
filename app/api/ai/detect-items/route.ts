import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getProvider } from "@/lib/ai/provider";

export const runtime = "nodejs";

// Multipart POST with one `image` part. Returns:
//   { enabled, items: [{ box, suggestion }], debug }
//
// Used by the "✂ Split photo" picker — the client uploads a flat-lay
// photo, the route asks the AI for bounding-box detections + per-item
// tag suggestions, and the picker renders them so the user can
// deselect false positives before saving N items in one shot.
//
// No DB side-effect — the actual crop + bg removal + Item.create
// happens in /api/items/split when the user hits Save.
export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const provider = getProvider();
  if (!provider.available() || typeof provider.detectMultipleItems !== "function") {
    return NextResponse.json(
      {
        enabled: false,
        items: [],
        message: !provider.available()
          ? "AI is disabled. Set AI_PROVIDER + the matching key in .env."
          : "This provider doesn't support multi-item detection yet.",
      },
      { status: 200 },
    );
  }

  const form = await req.formData().catch(() => null);
  const image = form?.get("image");
  if (!image || !(image instanceof File) || image.size === 0) {
    return NextResponse.json({ error: "Missing image" }, { status: 400 });
  }

  try {
    const result = await provider.detectMultipleItems({ image });
    return NextResponse.json({
      enabled: true,
      provider: provider.name,
      items: result.items,
      debug: result.debug,
    });
  } catch (err) {
    console.error("AI detectMultipleItems failed", err);
    return NextResponse.json(
      {
        enabled: true,
        provider: provider.name,
        items: [],
        debug: { error: err instanceof Error ? err.message : String(err) },
      },
      { status: 200 },
    );
  }
}
