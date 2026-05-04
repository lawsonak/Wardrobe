-- Closet, outfits, and collections all filter by ownerId on every read.
-- Without an index, SQLite full-scans the table; the index makes those
-- lookups O(log n) and keeps things snappy as the wardrobe grows.

-- CreateIndex
CREATE INDEX "Item_ownerId_idx" ON "Item"("ownerId");

-- CreateIndex
CREATE INDEX "Outfit_ownerId_idx" ON "Outfit"("ownerId");

-- CreateIndex
CREATE INDEX "Collection_ownerId_idx" ON "Collection"("ownerId");
