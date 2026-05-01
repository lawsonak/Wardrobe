import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

export const runtime = "nodejs";

// POST /api/ai/rotate-label  (multipart, "image" field)
//
// Asks Gemini Vision to read the printed text on a clothing label /
// care tag and report how many degrees the image must be rotated
// CLOCKWISE for that text to read upright. Always returns one of
// 0/90/180/270 — falling back to 0 (no rotation) on every error so a
// flaky AI call never blocks the upload.
//
// Stays a small one-off rather than extending the TagProvider
// interface: this is the only feature that needs orientation
// reasoning, and it returns a single int.

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const ALLOWED = [0, 90, 180, 270] as const;
type Rotation = (typeof ALLOWED)[number];

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const key = process.env.GEMINI_API_KEY;
  const provider = (process.env.AI_PROVIDER ?? "").toLowerCase();
  if (!key || provider !== "gemini") {
    // AI off → no rotation. Caller still uploads the EXIF-normalized
    // file, just without the right-side-up pass.
    return NextResponse.json({ rotation: 0, disabled: true });
  }

  const fd = await req.formData().catch(() => null);
  const image = fd?.get("image");
  if (!(image instanceof File)) {
    return NextResponse.json({ error: "image required" }, { status: 400 });
  }

  try {
    const buf = Buffer.from(await image.arrayBuffer());
    const mime = image.type || "image/jpeg";

    const prompt =
      `This image shows a clothing tag, care label, or product label. ` +
      `Determine how many degrees the image must be rotated CLOCKWISE so the ` +
      `printed text reads upright (horizontal, left-to-right). ` +
      `Reply with only one of these strings: "0", "90", "180", "270". ` +
      `"0" = text is already upright. ` +
      `"90" = text currently runs top-to-bottom on the right side of the image. ` +
      `"180" = text is upside down. ` +
      `"270" = text currently runs bottom-to-top on the left side of the image. ` +
      `If you genuinely cannot tell, reply "0".`;

    const body = {
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            { inlineData: { mimeType: mime, data: buf.toString("base64") } },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            rotation: { type: "STRING", enum: ["0", "90", "180", "270"] },
          },
          required: ["rotation"],
        },
        temperature: 0.0,
      },
    };

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${encodeURIComponent(GEMINI_MODEL)}:generateContent` +
      `?key=${encodeURIComponent(key)}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn("rotate-label HTTP", res.status);
      return NextResponse.json({ rotation: 0 });
    }
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    let parsed: { rotation?: unknown } = {};
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({ rotation: 0 });
    }
    const n = Number(parsed.rotation);
    const rotation: Rotation = (ALLOWED as readonly number[]).includes(n)
      ? (n as Rotation)
      : 0;
    return NextResponse.json({ rotation });
  } catch (err) {
    console.warn("rotate-label failed", err);
    return NextResponse.json({ rotation: 0 });
  }
}
