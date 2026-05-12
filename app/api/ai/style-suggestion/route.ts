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
import { logActivity } from "@/lib/activity";
import { isKnownCategory } from "@/lib/constants";

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

  // Optional user constraints. Both default to null so the open-
  // ended "Suggest a piece" tap keeps its original behaviour. A
  // bogus category string is dropped silently (validated below
  // against the main + spicy vocab union) rather than 400'd so
  // the card surfaces results even if the dropdown drifts.
  const rawCategory = typeof body?.category === "string" ? body.category.trim() : "";
  const userCategory = rawCategory && isKnownCategory(rawCategory) ? rawCategory : null;
  const userQuery =
    typeof body?.query === "string" && body.query.trim()
      ? body.query.trim().slice(0, 200)
      : null;

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

    const result = await suggestProductForCloset(summary, {
      again,
      category: userCategory,
      query: userQuery,
    });
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

    // Activity summary calls out user-supplied constraints so the
    // log differentiates a generic refresh from a targeted ask.
    const constraintNote = [userCategory, userQuery].filter(Boolean).join(" · ");
    await logActivity({
      userId,
      kind: "ai.suggestion",
      summary: constraintNote
        ? `Asked for a style suggestion: ${constraintNote}`
        : again
          ? "Asked for another style suggestion"
          : "Refreshed today's style suggestion",
    });

    return NextResponse.json({
      enabled: true,
      saved,
      debug: result.debug,
    });
  } finally {
    inflight.delete(userId);
  }
}
