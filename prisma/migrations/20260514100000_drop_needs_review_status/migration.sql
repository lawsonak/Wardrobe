-- Remove the "needs_review" item status. Every item with this status
-- is folded back into "active" — the user opted to remove the whole
-- review queue, items are active on creation now.
--
-- "draft" is left alone in case existing rows use it; the status
-- column is a free string so this is a pure data migration with no
-- schema change.
UPDATE "Item" SET "status" = 'active' WHERE "status" = 'needs_review';
