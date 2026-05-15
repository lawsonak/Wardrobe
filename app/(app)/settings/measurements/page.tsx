import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { parse } from "@/lib/measurements";
import MeasurementsForm from "./MeasurementsForm";

export const dynamic = "force-dynamic";

export default async function MeasurementsPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? "";
  const user = userId
    ? await prisma.user.findUnique({
        where: { id: userId },
        select: { measurements: true },
      })
    : null;
  const initial = parse(user?.measurements ?? null);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/settings" className="text-sm text-blush-600 hover:underline">
          ← Settings
        </Link>
        <h1 className="mt-1 font-display text-3xl text-blush-700">Your measurements</h1>
        <p className="text-sm text-stone-500">
          Grab a soft tape measure. Fill in what you can — every field is
          optional and you can come back any time. Saved privately to your
          profile.
        </p>
      </div>
      <MeasurementsForm initial={initial} />
    </div>
  );
}
