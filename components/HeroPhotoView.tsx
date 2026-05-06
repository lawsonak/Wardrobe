"use client";

import { useRouter } from "next/navigation";
import ZoomableImage from "@/components/ZoomableImage";
import { toast } from "@/lib/toast";

// Wraps the main hero photo (in edit mode) in a ZoomableImage with a
// server-side rotate handler bound. Mirrors LabelPhotoView's shape so
// the user can tap any photo on the item page — read-only or edit
// mode, hero or label or angle — and find the rotation toolbar in
// the same place.
export default function HeroPhotoView({
  itemId,
  src,
  zoomSrc,
  alt,
  className,
}: {
  itemId: string;
  src: string;
  zoomSrc?: string;
  alt: string;
  className?: string;
}) {
  const router = useRouter();

  async function rotate(degrees: 90 | 270) {
    const fd = new FormData();
    fd.append("which", "main-rotate");
    fd.append("degrees", String(degrees));
    const res = await fetch(`/api/items/${itemId}/photo`, { method: "POST", body: fd });
    if (!res.ok) {
      toast("Couldn't rotate the photo", "error");
      return;
    }
    router.refresh();
  }

  return (
    <ZoomableImage
      src={src}
      zoomSrc={zoomSrc}
      alt={alt}
      className={className ?? "h-full w-full object-contain"}
      onRotate={rotate}
    />
  );
}
