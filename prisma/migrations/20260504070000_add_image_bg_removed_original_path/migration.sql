-- Full-resolution background-removed cutout, generated server-side
-- from imageOriginalPath. Used by the lightbox tap-to-zoom so the
-- user sees a real garment cutout at full quality instead of the
-- 1280-px browser-side cutout. Background work fires after upload;
-- null until the worker has produced it (and on legacy items that
-- pre-date the worker shipping).

ALTER TABLE "Item" ADD COLUMN "imageBgRemovedOriginalPath" TEXT;
