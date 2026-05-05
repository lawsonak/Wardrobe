-- Two-tier photo storage. Item.imagePath now holds a 1024-px-max
-- display variant for fast grid/card/detail rendering; the new
-- imageOriginalPath points to the untouched full-resolution upload
-- so the item detail page can offer a real tap-to-zoom view.
-- Existing rows have no original to point at — the column stays null
-- and the lightbox falls back to imagePath. Same two-tier shape on
-- ItemPhoto so the photo carousel's zoom is consistent across the
-- hero and any extra angles.

ALTER TABLE "Item" ADD COLUMN "imageOriginalPath" TEXT;
ALTER TABLE "ItemPhoto" ADD COLUMN "imageOriginalPath" TEXT;
