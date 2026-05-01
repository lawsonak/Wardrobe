-- Rename Capsule -> Collection (with new trip-planning fields).
-- SQLite doesn't support renaming a table while changing columns in one
-- step, so we create the new tables, copy rows over (defaulting kind to
-- "general" so existing capsules survive as non-trip collections), then
-- drop the old tables.

PRAGMA foreign_keys=OFF;

CREATE TABLE "Collection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'general',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "destination" TEXT,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "notes" TEXT,
    "occasion" TEXT,
    "season" TEXT,
    "activities" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Collection_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "CollectionItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collectionId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    CONSTRAINT "CollectionItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CollectionItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "Collection" ("id", "ownerId", "kind", "name", "description", "occasion", "season", "createdAt", "updatedAt", "activities")
SELECT "id", "ownerId", 'general', "name", "description", "occasion", "season", "createdAt", "updatedAt", ''
FROM "Capsule";

INSERT INTO "CollectionItem" ("id", "collectionId", "itemId")
SELECT "id", "capsuleId", "itemId" FROM "CapsuleItem";

DROP TABLE "CapsuleItem";
DROP TABLE "Capsule";

CREATE UNIQUE INDEX "CollectionItem_collectionId_itemId_key" ON "CollectionItem"("collectionId", "itemId");

PRAGMA foreign_keys=ON;
