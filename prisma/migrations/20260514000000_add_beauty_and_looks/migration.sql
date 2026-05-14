-- Beauty foundation: cosmetics / skincare / fragrance / tools as a
-- separate sub-closet, with a "Looks" concept that bundles them
-- (parallels Outfit). Mirrors the Spicy (isBackroom) hide pattern:
-- isBeauty=true items hard-exclude from the main closet, outfit
-- builder, AI catalog, etc. Independent of isBackroom — both flags
-- can be true on the same item.

ALTER TABLE "Item" ADD COLUMN "isBeauty"  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Item" ADD COLUMN "shadeName" TEXT;
ALTER TABLE "Item" ADD COLUMN "shadeHex"  TEXT;
ALTER TABLE "Item" ADD COLUMN "finish"    TEXT;

CREATE INDEX "Item_ownerId_isBeauty_idx" ON "Item"("ownerId", "isBeauty");

-- Looks: a saved bundle of beauty items the user wears together as a
-- routine ("Everyday face", "Date night smoky"). Standalone OR paired
-- one-to-one with an Outfit via Outfit.lookId.
CREATE TABLE "Look" (
  "id"        TEXT PRIMARY KEY,
  "ownerId"   TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "notes"     TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Look_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id")
);
CREATE INDEX "Look_ownerId_idx" ON "Look"("ownerId");

CREATE TABLE "LookItem" (
  "id"     TEXT PRIMARY KEY,
  "lookId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  -- One of LOOK_SLOTS in lib/constants.ts (Lipstick, Mascara, …).
  -- Free string so the schema doesn't gate adding a slot later.
  "slot"   TEXT NOT NULL,
  CONSTRAINT "LookItem_lookId_fkey" FOREIGN KEY ("lookId") REFERENCES "Look"("id") ON DELETE CASCADE,
  CONSTRAINT "LookItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE
);
CREATE INDEX "LookItem_lookId_idx" ON "LookItem"("lookId");
CREATE INDEX "LookItem_itemId_idx" ON "LookItem"("itemId");

-- Outfit ↔ Look one-to-one pairing. Optional; null = the outfit isn't
-- tied to a specific face routine.
ALTER TABLE "Outfit" ADD COLUMN "lookId" TEXT REFERENCES "Look"("id") ON DELETE SET NULL;
