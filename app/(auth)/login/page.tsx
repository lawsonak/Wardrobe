import { redirect } from "next/navigation";
import { auth } from "@/auth";
import LoginForm from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  const session = await auth();
  const params = await searchParams;
  if (session?.user) {
    redirect(params.from || "/");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blush-100 via-cream-50 to-sage-200 px-4">
      <div className="w-full max-w-sm card p-6">
        <h1 className="mb-1 font-display text-3xl text-blush-700">Wardrobe</h1>
        <p className="mb-6 text-sm text-stone-500">
          A little place for all the things you love to wear.
        </p>
        <LoginForm from={params.from} initialError={params.error} />
      </div>
    </div>
  );
}
