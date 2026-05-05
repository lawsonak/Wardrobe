"use client";

import { useRouter } from "next/navigation";
import ZoomableImage from "@/components/ZoomableImage";
import { toast } from "@/lib/toast";

// Wraps the label / tag photo in a ZoomableImage with a server-side
// rotate handler bound. Used both from the read-only item detail
// view and from the edit page so the label is uniformly tappable +
// rotatable wherever it appears.
export default function LabelPhotoView({
  itemId,
  src,
  className,
}: {
  itemId: string;
  src: string;
  className?: string;
}) {
  const router = useRouter();

  async function rotate(degrees: 90 | 270) {
    const fd = new FormData();
    fd.append("which", "label-rotate");
    fd.append("degrees", String(degrees));
    const res = await fetch(`/api/items/${itemId}/photo`, { method: "POST", body: fd });
    if (!res.ok) {
      toast("Couldn't rotate the label", "error");
      return;
    }
    router.refresh();
  }

  return (
    <ZoomableImage
      src={src}
      alt="Label tag"
      className={className ?? "max-h-72 w-full bg-cream-50 object-contain p-2"}
      onRotate={rotate}
    />
  );
}
