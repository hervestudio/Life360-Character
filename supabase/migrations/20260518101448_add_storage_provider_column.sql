/*
  # Add storage_provider column to assets

  1. Modified Tables
    - `assets`
      - Added `storage_provider` column (text, default 'supabase')
      - Tracks whether an asset file is stored in Supabase Storage or Cloudflare R2
      - Existing rows default to 'supabase', new uploads can use 'r2'

  2. Important Notes
    - Non-breaking change: all existing assets default to 'supabase'
    - Feature-flagged on the client side via VITE_USE_R2
    - No data is moved or deleted by this migration
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'assets' AND column_name = 'storage_provider'
  ) THEN
    ALTER TABLE assets ADD COLUMN storage_provider text NOT NULL DEFAULT 'supabase';
  END IF;
END $$;
