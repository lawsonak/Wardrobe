import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getProvider } from "@/lib/ai/provider";

export const runtime = "nodejs";

// POST { destination?, startDate?, endDate?, occasion? }
// Returns { enabled, activities: string[], debug? }.
export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const provider = getProvider();
  if (!provider.available() || typeof provider.suggestActivities !== "function") {
    return NextResponse.json(
      {
        enabled: false,
        activities: [],
        message: !provider.available()
          ? "AI is disabled. Set AI_PROVIDER + the matching key in .env."
          : "This provider doesn't support activity suggestions yet.",
      },
      { status: 200 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const result = await provider.suggestActivities({
    destination: typeof body.destination === "string" ? body.destination.trim() : undefined,
    startDate: typeof body.startDate === "string" ? body.startDate : undefined,
    endDate: typeof body.endDate === "string" ? body.endDate : undefined,
    occasion: typeof body.occasion === "string" ? body.occasion.trim() || undefined : undefined,
  });

  return NextResponse.json({
    enabled: true,
    provider: provider.name,
    activities: result.activities,
    debug: result.debug,
  });
}
