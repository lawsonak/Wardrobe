import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getProvider } from "@/lib/ai/provider";

export const runtime = "nodejs";

// Multipart POST. Required:
//   - image (File)             — the main item photo
// Optional:
//   - labelImage (File)        — brand/size/care tag close-up
//   - context (string, JSON)   — { category, subType, color, brand, size,
//                                  seasons[], activities[], existingNotes }
//                                so the model doesn't restate the obvious.
//
// Returns { notes, debug } with no DB side-effect — the client decides
// what to do with the suggestion (paste it into the notes field, append,
// discard).
export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const provider = getProvider();
  if (!provider.available() || typeof provider.describeItem !== "function") {
    return NextResponse.json(
      {
        enabled: false,
        notes: "",
        message: !provider.available()
          ? "AI is disabled. Set AI_PROVIDER + the matching key in .env."
          : "This provider doesn't support note generation yet.",
      },
      { status: 200 },
    );
  }

  const form = await req.formData().catch(() => null);
  const image = form?.get("image");
  const labelImageRaw = form?.get("labelImage");
  if (!image || !(image instanceof File) || image.size === 0) {
    return NextResponse.json({ error: "Missing image" }, { status: 400 });
  }
  const labelImage =
    labelImageRaw && labelImageRaw instanceof File && labelImageRaw.size > 0
      ? labelImageRaw
      : undefined;

  let context: Record<string, unknown> | undefined;
  const ctxRaw = form?.get("context");
  if (typeof ctxRaw === "string" && ctxRaw.trim()) {
    try {
      const parsed = JSON.parse(ctxRaw);
      if (parsed && typeof parsed === "object") context = parsed;
    } catch {
      /* ignore — we'll just not pass context */
    }
  }

  try {
    const result = await provider.describeItem({
      image,
      labelImage,
      context: context as never,
    });
    return NextResponse.json({
      enabled: true,
      provider: provider.name,
      hasLabel: !!labelImage,
      notes: result.notes,
      debug: result.debug,
    });
  } catch (err) {
    console.error("AI describeItem failed", err);
    return NextResponse.json(
      {
        enabled: true,
        provider: provider.name,
        notes: "",
        debug: { error: err instanceof Error ? err.message : String(err) },
      },
      { status: 200 },
    );
  }
}
