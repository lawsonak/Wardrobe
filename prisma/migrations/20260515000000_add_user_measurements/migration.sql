-- Body measurements for the per-user guided measurement flow. Stored
-- as a free-form JSON blob (same extend-without-migration pattern as
-- Item.fitDetails). Nullable — null until the user fills the form.
ALTER TABLE "User" ADD COLUMN "measurements" TEXT;
