import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { lookupWishlistProduct } from "@/lib/ai/wishlistLookup";

export const runtime = "nodejs";
// Grounded search + content fetch can take 5-15s. Allow generous headroom.
export const maxDuration = 60;

// In-process per-user lock so a double-click doesn't burn two grounded
// search calls. Sufficient for this single-server personal app.
const inflight = new Set<string>();

export async function POST(req: NextRequest) {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      {
        enabled: false,
        message: "AI is disabled. Set GEMINI_API_KEY in .env to enable wishlist auto-fill.",
      },
      { status: 200 },
    );
  }

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const query = typeof body.query === "string" ? body.query.trim() : "";

  if (!query) {
    return NextResponse.json(
      { error: "Paste a link or type a product description to auto-fill." },
      { status: 400 },
    );
  }

  if (inflight.has(userId)) {
    return NextResponse.json(
      { error: "Another auto-fill is already running. Try again in a moment." },
      { status: 409 },
    );
  }
  inflight.add(userId);
  try {
    const result = await lookupWishlistProduct({ query });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, debug: result.debug },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { suggestions: result.suggestions, debug: result.debug },
      { status: 200 },
    );
  } finally {
    inflight.delete(userId);
  }
}
