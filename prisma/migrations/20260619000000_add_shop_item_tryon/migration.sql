-- Per-shop-item AI try-on cache. Same shape as Outfit's try-on columns:
-- hash fingerprints the inputs (mannequin id + image mtime + prompt
-- version) so re-clicks short-circuit unless something changed.
-- Replacing the product photo or the user's mannequin invalidates.

ALTER TABLE "CollectionShopItem" ADD COLUMN "tryOnImagePath"   TEXT;
ALTER TABLE "CollectionShopItem" ADD COLUMN "tryOnHash"        TEXT;
ALTER TABLE "CollectionShopItem" ADD COLUMN "tryOnGeneratedAt" DATETIME;
