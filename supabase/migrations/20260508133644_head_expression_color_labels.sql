/*
  # Add custom slot labels for head expression colors

  1. Changes
    - Add `labels` jsonb column to `head_expression_colors`
      - Stores optional friendly renames for SVG color slot ids
      - Defaults to empty object, meaning the raw SVG id is used

  2. Security
    - No policy changes; the new column is covered by existing RLS.
    - Column is non-null with safe default.

  3. Notes
    - The slot key remains the SVG element id (source of truth).
    - An entry `{ "mouth": "Mouth line" }` means render the UI label
      "Mouth line" for the slot whose SVG id is "mouth".
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'head_expression_colors' AND column_name = 'labels'
  ) THEN
    ALTER TABLE head_expression_colors
      ADD COLUMN labels jsonb NOT NULL DEFAULT '{}'::jsonb;
  END IF;
END $$;
