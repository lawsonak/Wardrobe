import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import SetEditor from "./SetEditor";

export const dynamic = "force-dynamic";

export default async function SetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? "";

  const set = await prisma.itemSet.findFirst({
    where: { id, ownerId: userId },
    include: {
      items: {
        select: {
          id: true, imagePath: true, imageBgRemovedPath: true,
          category: true, subType: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!set) notFound();

  return (
    <div className="space-y-5">
      <Link href="/sets" className="text-sm text-blush-600 hover:underline">← Sets</Link>
      <SetEditor
        set={{
          id: set.id,
          name: set.name,
          notes: set.notes,
          items: set.items,
        }}
      />
    </div>
  );
}
