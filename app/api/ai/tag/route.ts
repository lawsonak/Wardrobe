import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getProvider } from "@/lib/ai/provider";

export const runtime = "nodejs";

// POST a multipart with `image`. Returns suggestions only — never writes
// to the DB. The client decides what to apply, with the user reviewing.
export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const provider = getProvider();
  if (!provider.available()) {
    return NextResponse.json(
      { enabled: false, suggestions: {}, message: `AI tagging is disabled. Set AI_PROVIDER and the matching API key to enable.` },
      { status: 200 },
    );
  }

  const form = await req.formData().catch(() => null);
  const image = form?.get("image");
  if (!image || !(image instanceof File) || image.size === 0) {
    return NextResponse.json({ error: "Missing image" }, { status: 400 });
  }

  // Provide existing brands so the provider can prefer canonical names
  // instead of inventing variants.
  const brands = await prisma.brand.findMany({
    where: { ownerId: userId },
    select: { name: true },
    take: 200,
  });
  const existingBrands = brands.map((b) => b.name);

  let suggestions = {};
  try {
    suggestions = await provider.tagImage({ image, existingBrands });
  } catch (err) {
    console.error("AI tag failed", err);
    return NextResponse.json({ enabled: true, suggestions: {}, error: "Provider failed" }, { status: 200 });
  }

  return NextResponse.json({ enabled: true, provider: provider.name, suggestions });
}
