-- CreateTable
CREATE TABLE "WishlistItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "brand" TEXT,
    "link" TEXT,
    "price" TEXT,
    "imagePath" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "occasion" TEXT,
    "notes" TEXT,
    "fillsGap" BOOLEAN NOT NULL DEFAULT false,
    "giftIdea" BOOLEAN NOT NULL DEFAULT false,
    "purchased" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WishlistItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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
    "size" TEXT,
    "seasons" TEXT NOT NULL DEFAULT '',
    "activities" TEXT NOT NULL DEFAULT '',
    "notes" TEXT,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Item_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Item" ("activities", "brand", "category", "color", "createdAt", "id", "imageBgRemovedPath", "imagePath", "isFavorite", "notes", "ownerId", "seasons", "size", "subType", "updatedAt") SELECT "activities", "brand", "category", "color", "createdAt", "id", "imageBgRemovedPath", "imagePath", "isFavorite", "notes", "ownerId", "seasons", "size", "subType", "updatedAt" FROM "Item";
DROP TABLE "Item";
ALTER TABLE "new_Item" RENAME TO "Item";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
