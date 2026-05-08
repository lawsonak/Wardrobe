-- Backroom flag: items the user wants hidden from the default closet
-- view, outfit builder, collection picker, and AI prompts. Toggleable
-- back into view via a per-page filter, and there's a dedicated
-- /wardrobe/backroom page reachable from a lock icon in the closet
-- header. Outfits / Collections that *contain* a backroom item also
-- hide unless the toggle is on (auto-derived via EXISTS join — no
-- separate column needed).

ALTER TABLE "Item" ADD COLUMN "isBackroom" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Item_ownerId_isBackroom_idx" ON "Item"("ownerId", "isBackroom");
