import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { lookupBarcode, normalizeBarcode } from "@/lib/barcodeLookup";

export const runtime = "nodejs";
// OBF latency is ~200-800ms; Gemini grounded search adds 5-10s on
// long-tail products. 30s ceiling is generous.
export const maxDuration = 30;

// POST { code: string }
//
// Resolves a UPC/EAN to a product. Two-stage:
//   1. Open Beauty Facts (free, no key) — happy path for major brands.
//   2. Gemini grounded search fallback — long tail, indie launches.
//
// Returns { ok: true, source, match } on success; match is null when
// neither source could identify the product. Body validation errors
// return ok: false with an error string.
//
// Auth-required: barcode lookups don't touch user data but they do
// burn API calls (Gemini fallback) so we restrict to logged-in users.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const raw = typeof body?.code === "string" ? body.code : "";
  const normalized = normalizeBarcode(raw);
  if (!normalized) {
    return NextResponse.json(
      { ok: false, error: "Barcode must be 8-14 digits." },
      { status: 400 },
    );
  }

  const result = await lookupBarcode(normalized);
  return NextResponse.json(result);
}
