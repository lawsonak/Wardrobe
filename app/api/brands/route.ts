import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { brandKey } from "@/lib/brand";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const brands = await prisma.brand.findMany({
    where: {
      ownerId: userId,
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { nameKey: { contains: brandKey(q) } },
              { aliases: { some: { aliasKey: { contains: brandKey(q) } } } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    take: 50,
    include: { aliases: true, _count: { select: { items: true } } },
  });
  return NextResponse.json({ brands });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

  const key = brandKey(name);
  const existing = await prisma.brand.findUnique({
    where: { ownerId_nameKey: { ownerId: userId, nameKey: key } },
  });
  if (existing) return NextResponse.json({ brand: existing });

  const brand = await prisma.brand.create({
    data: { ownerId: userId, name, nameKey: key },
  });
  return NextResponse.json({ brand }, { status: 201 });
}
