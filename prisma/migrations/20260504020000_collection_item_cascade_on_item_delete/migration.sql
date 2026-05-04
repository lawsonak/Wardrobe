-- Add ON DELETE CASCADE to CollectionItem.itemId so deleting an item
-- automatically removes its collection memberships. Previously the FK
-- was ON DELETE RESTRICT, which is what made Item DELETE blow up with
-- a foreign-key violation whenever the item was inside any collection.
--
-- SQLite can't ALTER a foreign-key constraint in place; the canonical
-- workaround is to recreate the table, copy rows, drop the old, rename.
-- Foreign keys are deferred during the swap so the in-flight rebuild
-- doesn't trip over its own intermediate state.
--
-- The rest of the table shape is unchanged: same columns, same primary
-- key, same unique index on (collectionId, itemId), same cascade on
-- collectionId.

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_CollectionItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collectionId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    CONSTRAINT "CollectionItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CollectionItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_CollectionItem" ("id", "collectionId", "itemId")
SELECT "id", "collectionId", "itemId" FROM "CollectionItem";

DROP TABLE "CollectionItem";
ALTER TABLE "new_CollectionItem" RENAME TO "CollectionItem";

CREATE UNIQUE INDEX "CollectionItem_collectionId_itemId_key" ON "CollectionItem"("collectionId", "itemId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
