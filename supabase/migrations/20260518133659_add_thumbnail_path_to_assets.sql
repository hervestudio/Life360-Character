/*
  # Add thumbnail_path column to assets

  1. Modified Tables
    - `assets`
      - `thumbnail_path` (text, nullable) - R2 storage key for the WebP thumbnail preview (e.g., "thumbnails/body/adult-male.webp")

  2. Notes
    - Assets without a thumbnail_path fall back to the original storage_path for display
    - SVG assets will not have thumbnails (they are already lightweight)
    - Thumbnails are stored at 512px width in WebP format on R2
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'assets' AND column_name = 'thumbnail_path'
  ) THEN
    ALTER TABLE assets ADD COLUMN thumbnail_path text;
  END IF;
END $$;