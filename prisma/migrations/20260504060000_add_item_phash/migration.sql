-- Perceptual hash (dHash, 64 bits / 16 hex chars) of each item's
-- photo at upload time. Used by /api/items POST to find existing
-- items that look similar and warn the user before they accidentally
-- duplicate-photograph the same garment. Null on legacy items.

ALTER TABLE "Item" ADD COLUMN "phash" TEXT;
