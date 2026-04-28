-- CreateTable
CREATE TABLE "Capsule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "occasion" TEXT,
    "season" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Capsule_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CapsuleItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "capsuleId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    CONSTRAINT "CapsuleItem_capsuleId_fkey" FOREIGN KEY ("capsuleId") REFERENCES "Capsule" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CapsuleItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CapsuleItem_capsuleId_itemId_key" ON "CapsuleItem"("capsuleId", "itemId");
