"use client";

import { useRouter } from "next/navigation";
import ItemPhotoCarousel, { type CarouselPhoto } from "@/components/ItemPhotoCarousel";
import { toast } from "@/lib/toast";

// Server-rendered ItemDetailView builds a list of raw photo descriptors
// (one for the hero, one per angle); this client wrapper turns each
// into a CarouselPhoto with its rotate handler bound. Keeps the
// ItemPhotoCarousel itself dumb about the API surface.
export type RawPhoto = {
  id: string;
  src: string;
  zoomSrc?: string;
  label: string | null;
  kind: "hero" | "angle";
  /** Required when kind === "angle" — the ItemPhoto row id. */
  angleId?: string;
};

export default function PhotoCarouselClient({
  itemId,
  photos,
  alt,
}: {
  itemId: string;
  photos: RawPhoto[];
  alt: string;
}) {
  const router = useRouter();

  async function rotateHero(degrees: 90 | 270) {
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

  async function rotateAngle(angleId: string, degrees: 90 | 270) {
    const res = await fetch(`/api/items/${itemId}/photos/${angleId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ degrees }),
    });
    if (!res.ok) {
      toast("Couldn't rotate the photo", "error");
      return;
    }
    router.refresh();
  }

  const enriched: CarouselPhoto[] = photos.map((p) => ({
    id: p.id,
    src: p.src,
    zoomSrc: p.zoomSrc,
    label: p.label,
    onRotate:
      p.kind === "hero"
        ? rotateHero
        : p.angleId
          ? (degrees) => rotateAngle(p.angleId!, degrees)
          : undefined,
  }));

  return <ItemPhotoCarousel photos={enriched} alt={alt} />;
}
