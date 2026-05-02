"use client";

import { useRouter } from "next/navigation";
import { toast } from "@/lib/toast";

const STORAGE_KEY = "wardrobe.onboarding.dismissed";

// Settings → "Show getting started" — clears the localStorage flag the
// OnboardingChecklist uses to remember its dismissal, then bounces the
// user to the dashboard so they see it. Once a user dismisses the
// checklist there's no other path back to it.
export default function ShowOnboardingLink() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="text-blush-600 hover:underline"
      onClick={() => {
        try {
          window.localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* ignore — incognito or storage disabled */
        }
        toast("Getting-started checklist restored");
        router.push("/");
        router.refresh();
      }}
    >
      Show getting-started
    </button>
  );
}
