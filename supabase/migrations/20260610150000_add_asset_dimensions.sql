/*
  # Add intrinsic width/height columns to assets

  1. Modified Tables
    - `assets`
      - `width` (integer, nullable) - intrinsic pixel width of the full-resolution source image
      - `height` (integer, nullable) - intrinsic pixel height of the full-resolution source image

  2. Notes
    - Lets the client size/position layers from stored dimensions instead of
      downloading the full-resolution image just to measure naturalWidth/Height.
    - This unblocks displaying the lightweight WebP thumbnail everywhere (tiles AND
      the main canvas) while keeping transform math calibrated to the source size.
      Thumbnails are capped at 2048px, so a downscaled thumbnail's own dimensions
      cannot be used for positioning oversized assets (e.g. 5760px heads).
    - Full-resolution PNGs remain in use only for the PNG export path.
    - Nullable: assets without dimensions fall back to measuring the image at runtime.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'assets' AND column_name = 'width'
  ) THEN
    ALTER TABLE assets ADD COLUMN width integer;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'assets' AND column_name = 'height'
  ) THEN
    ALTER TABLE assets ADD COLUMN height integer;
  END IF;
END $$;
