/*
  # Rename skin_tone values: caucasian/hispanic/black -> light/medium/dark

  1. Changes
    - Drop existing CHECK constraint on assets.skin_tone
    - UPDATE existing rows: caucasian->light, hispanic->medium, black->dark
    - Re-add CHECK constraint allowing ('light','medium','dark')

  2. Notes
    - Non-destructive remap; no data loss
    - Column remains nullable
*/

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assets_skin_tone_check'
  ) THEN
    ALTER TABLE assets DROP CONSTRAINT assets_skin_tone_check;
  END IF;
END $$;

UPDATE assets SET skin_tone = 'light'  WHERE skin_tone = 'caucasian';
UPDATE assets SET skin_tone = 'medium' WHERE skin_tone = 'hispanic';
UPDATE assets SET skin_tone = 'dark'   WHERE skin_tone = 'black';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assets_skin_tone_check'
  ) THEN
    ALTER TABLE assets
      ADD CONSTRAINT assets_skin_tone_check
      CHECK (skin_tone IS NULL OR skin_tone IN ('light','medium','dark'));
  END IF;
END $$;
