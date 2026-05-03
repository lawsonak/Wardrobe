import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { todayISO } from "@/lib/dates";
import {
  readSavedSuggestion,
  writeSavedSuggestion,
  type SavedSuggestion,
} from "@/lib/todaysSuggestion";
import { suggestProductForCloset } from "@/lib/ai/styleSuggestion";
import { buildClosetSummary } from "@/lib/ai/closetSummary";

export const runtime = "nodejs";
// Grounded search + content fetch can take 5-15s. Allow generous headroom.
export const maxDuration = 60;

// In-process per-user lock so a refresh-button-mash doesn't burn two
// grounded search calls back to back.
const inflight = new Set<string>();

// GET — return today's saved suggestion (if any). No AI call.
export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const saved = await readSavedSuggestion(userId);
  return NextResponse.json({ saved });
}

// POST — generate a fresh suggestion. Saves to disk for the rest of
// the day. Body { again: true } nudges the model toward a different
// option than whatever's currently saved.
export async function POST(req: NextRequest) {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      {
        enabled: false,
        message:
          "AI is disabled. Set GEMINI_API_KEY in .env to enable Today's suggestion.",
      },
      { status: 200 },
    );
  }

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const again = body?.again === true;

  if (inflight.has(userId)) {
    return NextResponse.json(
      { error: "A suggestion is already generating for your account." },
      { status: 409 },
    );
  }
  inflight.add(userId);

  try {
    const summary = await buildClosetSummary(userId);
    if (summary.totalItems === 0) {
      return NextResponse.json(
        {
          enabled: true,
          error: "Closet is empty — add a few pieces first so AI can read your style.",
        },
        { status: 400 },
      );
    }

    const result = await suggestProductForCloset(summary, { again });
    if (!result.ok) {
      return NextResponse.json(
        { enabled: true, error: result.error, debug: result.debug },
        { status: 502 },
      );
    }

    const saved: SavedSuggestion = {
      date: todayISO(),
      ...result.suggestion,
      sources: (result.debug.sources ?? []).slice(0, 8),
    };
    await writeSavedSuggestion(userId, saved);

    return NextResponse.json({
      enabled: true,
      saved,
      debug: result.debug,
    });
  } finally {
    inflight.delete(userId);
  }
}
