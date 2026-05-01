import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getProvider } from "@/lib/ai/provider";

export const runtime = "nodejs";

// POST { query: string } → { filters: SearchFilters }
//
// Returns parsed structured filters that the closet page can apply.
// When AI is disabled or the provider doesn't support search parsing,
// the route returns enabled=false and the client falls back to plain
// LIKE-search across notes/subType/brand/color.
export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const provider = getProvider();
  if (!provider.available() || typeof provider.parseSearch !== "function") {
    return NextResponse.json(
      {
        enabled: false,
        message: !provider.available()
          ? "AI is disabled. Set AI_PROVIDER + the matching key in .env."
          : "This provider doesn't support natural-language search yet.",
      },
      { status: 200 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const query = String(body.query ?? "").trim();
  if (!query) return NextResponse.json({ error: "query required" }, { status: 400 });

  const result = await provider.parseSearch({ query });
  return NextResponse.json({
    enabled: true,
    filters: result.filters,
    debug: result.debug,
  });
}
