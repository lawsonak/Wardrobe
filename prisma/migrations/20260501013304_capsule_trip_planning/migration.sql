-- AlterTable
ALTER TABLE "Capsule" ADD COLUMN "activityTargets" TEXT;
ALTER TABLE "Capsule" ADD COLUMN "dateNeeded" DATETIME;
ALTER TABLE "Capsule" ADD COLUMN "location" TEXT;
ALTER TABLE "Capsule" ADD COLUMN "targetCounts" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Outfit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "activity" TEXT,
    "season" TEXT,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "layoutJson" TEXT,
    "capsuleId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Outfit_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Outfit_capsuleId_fkey" FOREIGN KEY ("capsuleId") REFERENCES "Capsule" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Outfit" ("activity", "createdAt", "id", "isFavorite", "layoutJson", "name", "ownerId", "season", "updatedAt") SELECT "activity", "createdAt", "id", "isFavorite", "layoutJson", "name", "ownerId", "season", "updatedAt" FROM "Outfit";
DROP TABLE "Outfit";
ALTER TABLE "new_Outfit" RENAME TO "Outfit";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
