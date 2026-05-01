-- Rename Capsule -> Collection (with new trip-planning fields).
-- Drops the older trip-planning fields that the previous Capsule design
-- shipped with (dateNeeded / location / targetCounts / activityTargets);
-- those are replaced by the new wizard's cleaner model
-- (kind / destination / startDate / endDate / activities / notes).
--
-- Also renames Outfit.capsuleId -> Outfit.collectionId so the back-link
-- from a generated outfit to its source collection keeps working.
--
-- SQLite can't ALTER COLUMN or rename a referenced table in place, so we
-- create the new tables, copy rows over (defaulting kind to "general" so
-- existing capsules survive as non-trip collections), then drop the old
-- ones. Foreign keys are deferred during the swap.

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- 1. New Collection table.
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

-- 2. New CollectionItem join table.
CREATE TABLE "CollectionItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collectionId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    CONSTRAINT "CollectionItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CollectionItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- 3. Copy data: existing capsules become "general" collections.
-- The trip-planning columns from the previous Capsule design
-- (dateNeeded / location / targetCounts / activityTargets) are
-- intentionally not carried over.
INSERT INTO "Collection" ("id", "ownerId", "kind", "name", "description", "occasion", "season", "createdAt", "updatedAt", "activities")
SELECT "id", "ownerId", 'general', "name", "description", "occasion", "season", "createdAt", "updatedAt", ''
FROM "Capsule";

INSERT INTO "CollectionItem" ("id", "collectionId", "itemId")
SELECT "id", "capsuleId", "itemId" FROM "CapsuleItem";

-- 4. Rename Outfit.capsuleId -> Outfit.collectionId by rebuilding the
--    table. The FK now points at Collection.
CREATE TABLE "new_Outfit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "activity" TEXT,
    "season" TEXT,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "layoutJson" TEXT,
    "collectionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Outfit_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Outfit_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Outfit" ("id", "ownerId", "name", "activity", "season", "isFavorite", "layoutJson", "collectionId", "createdAt", "updatedAt")
SELECT "id", "ownerId", "name", "activity", "season", "isFavorite", "layoutJson", "capsuleId", "createdAt", "updatedAt" FROM "Outfit";
DROP TABLE "Outfit";
ALTER TABLE "new_Outfit" RENAME TO "Outfit";

-- 5. Drop the old Capsule tables.
DROP TABLE "CapsuleItem";
DROP TABLE "Capsule";

-- 6. Indexes / constraints.
CREATE UNIQUE INDEX "CollectionItem_collectionId_itemId_key" ON "CollectionItem"("collectionId", "itemId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
