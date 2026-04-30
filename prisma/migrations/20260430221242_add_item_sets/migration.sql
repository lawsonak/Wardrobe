-- CreateTable
CREATE TABLE "ItemSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ItemSet_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Item" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "imagePath" TEXT NOT NULL,
    "imageBgRemovedPath" TEXT,
    "labelImagePath" TEXT,
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
INSERT INTO "new_Item" ("activities", "brand", "brandId", "category", "color", "createdAt", "fitDetails", "fitNotes", "id", "imageBgRemovedPath", "imagePath", "isFavorite", "labelImagePath", "notes", "ownerId", "seasons", "size", "sizeSystem", "status", "subType", "updatedAt") SELECT "activities", "brand", "brandId", "category", "color", "createdAt", "fitDetails", "fitNotes", "id", "imageBgRemovedPath", "imagePath", "isFavorite", "labelImagePath", "notes", "ownerId", "seasons", "size", "sizeSystem", "status", "subType", "updatedAt" FROM "Item";
DROP TABLE "Item";
ALTER TABLE "new_Item" RENAME TO "Item";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ItemSet_ownerId_idx" ON "ItemSet"("ownerId");
