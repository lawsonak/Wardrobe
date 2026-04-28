import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const notifications = await prisma.notification.findMany({
    where: { ownerId: userId },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const unread = notifications.filter((n) => !n.read).length;
  return NextResponse.json({ notifications, unread });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const title = String(body.title ?? "").trim();
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
  const note = await prisma.notification.create({
    data: {
      ownerId: userId,
      title,
      body: typeof body.body === "string" ? body.body.trim() || null : null,
      href: typeof body.href === "string" ? body.href || null : null,
    },
  });
  return NextResponse.json({ notification: note }, { status: 201 });
}

// PATCH with { markAllRead: true } marks every notification read.
export async function PATCH(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (body.markAllRead === true) {
    const result = await prisma.notification.updateMany({
      where: { ownerId: userId, read: false },
      data: { read: true },
    });
    return NextResponse.json({ updated: result.count });
  }
  return NextResponse.json({ updated: 0 });
}
