/*
  # Add skin tone as a property

  1. Changes
    - Add `skin_tone` column on `assets` (caucasian|hispanic|black). Nullable; required logically for body/hair.
    - Remove skin assets, skin layer_order row, skin category_defaults
    - Skin stops being a trait users upload; it's a variant attribute on body/head assets.

  2. Notes
    - We keep the `skin` value in the AssetCategory check (to avoid destructive enum changes) but delete all rows. Application code filters it out.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'assets' AND column_name = 'skin_tone'
  ) THEN
    ALTER TABLE assets ADD COLUMN skin_tone text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'assets_skin_tone_check'
  ) THEN
    ALTER TABLE assets
      ADD CONSTRAINT assets_skin_tone_check
      CHECK (skin_tone IS NULL OR skin_tone IN ('caucasian','hispanic','black'));
  END IF;
END $$;

DELETE FROM category_defaults WHERE category = 'skin';
DELETE FROM layer_order WHERE category = 'skin';
DELETE FROM assets WHERE category = 'skin';
