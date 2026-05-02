-- Stage AI suggestions for already-set fields when a bulk re-tag run
-- finds conflicts. The item edit page reads this on load and surfaces
-- the existing review panel so the user can approve/reject per row.
ALTER TABLE "Item" ADD COLUMN "pendingAiSuggestions" TEXT;
