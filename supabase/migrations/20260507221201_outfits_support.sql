/*
  # Outfits support

  Adds support for multiple outfits per body, with a configurable default.

  1. Schema changes
    - Extend `asset_category` enum with `outfit`
    - Add `assets.parent_body_id` (uuid, fk to assets.id) so each outfit
      is owned by a specific body
    - New table `body_default_outfits (body_id, outfit_id)` storing the
      default outfit for each body

  2. Security
    - Enable RLS on `body_default_outfits`
    - Public SELECT (assets are already publicly readable)
    - Admin-only INSERT/UPDATE/DELETE via `admins` table

  3. Notes
    - Outfit assets are added via the existing assets flow; they inherit
      active/label/transform semantics from `assets`
    - Layer order is NOT modified here — outfits render alongside the
      body, so z-index is handled in application code (above body, below
      head) without a new `layer_order` row
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'asset_category' AND e.enumlabel = 'outfit'
  ) THEN
    ALTER TYPE asset_category ADD VALUE 'outfit';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'assets' AND column_name = 'parent_body_id'
  ) THEN
    ALTER TABLE assets ADD COLUMN parent_body_id uuid REFERENCES assets(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS assets_parent_body_id_idx ON assets(parent_body_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS body_default_outfits (
  body_id uuid PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  outfit_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE body_default_outfits ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'body_default_outfits' AND policyname = 'Public can read default outfits') THEN
    CREATE POLICY "Public can read default outfits"
      ON body_default_outfits FOR SELECT
      TO anon, authenticated
      USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'body_default_outfits' AND policyname = 'Admins can insert default outfits') THEN
    CREATE POLICY "Admins can insert default outfits"
      ON body_default_outfits FOR INSERT
      TO authenticated
      WITH CHECK (EXISTS (SELECT 1 FROM admins WHERE admins.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'body_default_outfits' AND policyname = 'Admins can update default outfits') THEN
    CREATE POLICY "Admins can update default outfits"
      ON body_default_outfits FOR UPDATE
      TO authenticated
      USING (EXISTS (SELECT 1 FROM admins WHERE admins.user_id = auth.uid()))
      WITH CHECK (EXISTS (SELECT 1 FROM admins WHERE admins.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'body_default_outfits' AND policyname = 'Admins can delete default outfits') THEN
    CREATE POLICY "Admins can delete default outfits"
      ON body_default_outfits FOR DELETE
      TO authenticated
      USING (EXISTS (SELECT 1 FROM admins WHERE admins.user_id = auth.uid()));
  END IF;
END $$;
