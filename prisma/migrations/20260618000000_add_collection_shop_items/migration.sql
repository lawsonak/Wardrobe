-- Collection shopping list: external products the user is "considering
-- buying" for a trip / themed collection, pulled from a pasted product
-- link. Distinct from CollectionItem (an owned closet Item) and from
-- WishlistItem (the global standalone wishlist) — these are scoped to a
-- single collection. Fields mirror what lib/ai/wishlistLookup.ts pulls
-- off a product page (Open Graph + JSON-LD), plus an optional locally-
-- saved product image under <userId>/collection-shop/.

CREATE TABLE "CollectionShopItem" (
  "id"           TEXT PRIMARY KEY,
  "collectionId" TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "brand"        TEXT,
  "category"     TEXT,
  "color"        TEXT,
  "price"        TEXT,
  "link"         TEXT,
  "imagePath"    TEXT,
  "source"       TEXT,
  "notes"        TEXT,
  "purchased"    BOOLEAN NOT NULL DEFAULT false,
  "createdAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CollectionShopItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE
);
CREATE INDEX "CollectionShopItem_collectionId_idx" ON "CollectionShopItem"("collectionId");
