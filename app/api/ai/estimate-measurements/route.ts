import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { estimateMeasurements } from "@/lib/ai/estimateMeasurements";
import { fromInches, type MeasurementUnit } from "@/lib/measurements";

export const runtime = "nodejs";
// One Gemini vision call on 1-2 photos, ~10-30s.
export const maxDuration = 90;

// Per-user lock so a double-tap doesn't burn two vision calls.
const inflight = new Set<string>();

// POST (multipart):
//   - front  (File, required)  the front photo
//   - side   (File, optional)  the true-side photo
//   - height (number)          tape-measured height in `unit`
//   - unit   ("in" | "cm")     unit the client form is using
//
// Returns a DRAFT only — no DB write, and the photos are held in
// memory then dropped (never written to data/uploads). Privacy
// posture for the opt-in fitted-clothing / underwear flow: the
// estimate is computed and the images are gone.
export async function POST(req: NextRequest) {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { enabled: false, message: "AI is disabled. Set GEMINI_API_KEY to enable photo estimates." },
      { status: 200 },
    );
  }

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const front = form?.get("front");
  if (!front || !(front instanceof File) || front.size === 0) {
    return NextResponse.json({ error: "A front photo is required." }, { status: 400 });
  }
  const sideRaw = form?.get("side");
  const side = sideRaw instanceof File && sideRaw.size > 0 ? sideRaw : null;

  const unit: MeasurementUnit = form?.get("unit") === "cm" ? "cm" : "in";
  const heightVal = parseFloat(String(form?.get("height") ?? ""));
  if (!Number.isFinite(heightVal) || heightVal <= 0) {
    return NextResponse.json(
      { error: "Enter your tape-measured height first — it's the scale reference." },
      { status: 400 },
    );
  }
  const heightInches = unit === "cm" ? heightVal / 2.54 : heightVal;

  if (inflight.has(userId)) {
    return NextResponse.json(
      { error: "An estimate is already running for your account." },
      { status: 409 },
    );
  }
  inflight.add(userId);
  try {
    const frontBuf = Buffer.from(await front.arrayBuffer());
    const sideBuf = side ? Buffer.from(await side.arrayBuffer()) : null;

    const result = await estimateMeasurements({
      front: { buf: frontBuf, mime: front.type || "image/jpeg" },
      side: sideBuf ? { buf: sideBuf, mime: side!.type || "image/jpeg" } : null,
      heightInches,
    });
    if (!result.ok) {
      return NextResponse.json(
        { enabled: true, error: result.error, debug: result.debug },
        { status: 502 },
      );
    }

    // Convert the inch-based draft into the form's unit so it
    // pre-fills cleanly. Shape + confidence pass straight through.
    const conv = (v: number | undefined) =>
      typeof v === "number" ? Math.round(fromInches(v, unit) * 10) / 10 : undefined;
    const d = result.draft;
    return NextResponse.json({
      enabled: true,
      unit,
      draft: {
        bust: conv(d.bust),
        waist: conv(d.waist),
        hips: conv(d.hips),
        shoulder: conv(d.shoulder),
        sleeve: conv(d.sleeve),
        inseam: conv(d.inseam),
        shape: d.shape,
        confidence: d.confidence,
      },
    });
  } finally {
    inflight.delete(userId);
    // frontBuf / sideBuf go out of scope here — nothing persisted.
  }
}
