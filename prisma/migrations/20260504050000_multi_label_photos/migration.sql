-- Consolidate label photos into ItemPhoto so an item can carry many
-- labels (front of tag, care symbols, original receipt, …) instead
-- of being capped at one. Item.labelImagePath was a single-label
-- pointer; we copy every existing one into a new ItemPhoto row with
-- kind="label" (existing rows default to "angle"), then drop the
-- column. AI auto-tag is updated separately to read the oldest
-- kind="label" row by createdAt.

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- 1. Add the kind discriminator to ItemPhoto. Existing rows default
--    to "angle"; new rows can opt into "label" via the photos API.
ALTER TABLE "ItemPhoto" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'angle';

-- 2. Migrate Item.labelImagePath → ItemPhoto kind="label".
--    SQLite's randomblob gives a unique-enough id; Prisma's @default(cuid())
--    only fires on inserts via the client, not raw SQL.
INSERT INTO "ItemPhoto" ("id", "itemId", "imagePath", "kind", "label", "position", "createdAt")
SELECT
  printf('lp_%s', lower(hex(randomblob(12)))),
  "id",
  "labelImagePath",
  'label',
  NULL,
  0,
  CURRENT_TIMESTAMP
FROM "Item"
WHERE "labelImagePath" IS NOT NULL;

-- 3. Drop Item.labelImagePath. SQLite can't ALTER DROP COLUMN with a
--    foreign-key referenced anywhere, so rebuild the table. Schema
--    is identical to the current Item minus that one column.
CREATE TABLE "new_Item" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "imagePath" TEXT NOT NULL,
    "imageOriginalPath" TEXT,
    "imageBgRemovedPath" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "category" TEXT NOT NULL,
    "subType" TEXT,
    "color" TEXT,
    "brand" TEXT,
    "brandId" TEXT,
    "size" TEXT,
    "sizeSystem" TEXT,
    "fitDetails" TEXT,
    "fitNotes" TEXT,
    "pendingAiSuggestions" TEXT,
    "seasons" TEXT NOT NULL DEFAULT '',
    "activities" TEXT NOT NULL DEFAULT '',
    "notes" TEXT,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "setId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Item_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Item_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Item_setId_fkey" FOREIGN KEY ("setId") REFERENCES "ItemSet" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_Item" (
    "id", "ownerId", "imagePath", "imageOriginalPath", "imageBgRemovedPath",
    "status", "category", "subType", "color", "brand", "brandId",
    "size", "sizeSystem", "fitDetails", "fitNotes", "pendingAiSuggestions",
    "seasons", "activities", "notes", "isFavorite", "setId",
    "createdAt", "updatedAt"
)
SELECT
    "id", "ownerId", "imagePath", "imageOriginalPath", "imageBgRemovedPath",
    "status", "category", "subType", "color", "brand", "brandId",
    "size", "sizeSystem", "fitDetails", "fitNotes", "pendingAiSuggestions",
    "seasons", "activities", "notes", "isFavorite", "setId",
    "createdAt", "updatedAt"
FROM "Item";

DROP TABLE "Item";
ALTER TABLE "new_Item" RENAME TO "Item";

CREATE INDEX "Item_ownerId_idx" ON "Item"("ownerId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
