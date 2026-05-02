import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { lookupProductFromUrl, lookupProductOnline } from "@/lib/ai/productLookup";

export const runtime = "nodejs";
// Grounded search + content fetch can take 5-15s. Allow generous headroom.
export const maxDuration = 60;

// In-process per-user lock so a double-click doesn't burn two grounded
// search calls. Sufficient for this single-server personal app.
const inflight = new Set<string>();

// POST accepts either:
//   - { url } → direct-fetch path (productMeta + text-mode AI for
//     material/care). Used by the "Paste a product link" panel.
//   - { brand, subType?, color?, category? } → grounded-search path
//     (existing behavior). Used by the "Look up online" button next
//     to the brand field.
export async function POST(req: NextRequest) {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      {
        enabled: false,
        message: "AI is disabled. Set GEMINI_API_KEY in .env to enable web product lookup.",
      },
      { status: 200 },
    );
  }

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const brand = typeof body.brand === "string" ? body.brand.trim() : "";
  const subType = typeof body.subType === "string" ? body.subType.trim() : null;
  const color = typeof body.color === "string" ? body.color.trim() : null;
  const category = typeof body.category === "string" ? body.category.trim() : null;

  if (!url && !brand) {
    return NextResponse.json(
      { error: "Provide a product URL or a brand to look up." },
      { status: 400 },
    );
  }

  if (inflight.has(userId)) {
    return NextResponse.json(
      { error: "A product lookup is already in progress for your account." },
      { status: 409 },
    );
  }
  inflight.add(userId);

  try {
    const result = url
      ? await lookupProductFromUrl(url)
      : await lookupProductOnline({ brand, subType, color, category });
    if (!result.ok) {
      return NextResponse.json(
        { enabled: true, error: result.error, debug: result.debug },
        { status: 502 },
      );
    }
    return NextResponse.json({
      enabled: true,
      suggestions: result.suggestions,
      sources: result.debug.sources ?? [],
      debug: result.debug,
    });
  } finally {
    inflight.delete(userId);
  }
}
