/*
  # Expression position offset per head

  1. New Tables
    - `head_expression_defaults` - per-head expression transform override
      - `head_id` (uuid FK assets.id ON DELETE CASCADE) - the head (hair) asset
      - `offset_x` (integer, default 0) - X offset in canvas units
      - `offset_y` (integer, default 0) - Y offset in canvas units
      - `scale` (numeric, default 1) - scale factor
      - `updated_at` (timestamptz, default now())
    - Primary key: head_id (one row per head).

  2. Security
    - Enable RLS.
    - Public read (needed by the client builder).
    - Write restricted to admins (mirrors existing category_defaults pattern).

  3. Notes
    - Expressions (category = 'expression') are positioned relative to HEADS rather than bodies
      because mouth/eye locations depend on the head illustration. When no row exists the
      expression uses its own per-asset transform or (0,0,1).
*/

CREATE TABLE IF NOT EXISTS head_expression_defaults (
  head_id uuid PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  offset_x integer NOT NULL DEFAULT 0,
  offset_y integer NOT NULL DEFAULT 0,
  scale numeric NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE head_expression_defaults ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'head_expression_defaults' AND policyname = 'Public can read head expression defaults'
  ) THEN
    CREATE POLICY "Public can read head expression defaults"
      ON head_expression_defaults FOR SELECT
      TO anon, authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'head_expression_defaults' AND policyname = 'Admins can insert head expression defaults'
  ) THEN
    CREATE POLICY "Admins can insert head expression defaults"
      ON head_expression_defaults FOR INSERT
      TO authenticated
      WITH CHECK (EXISTS (SELECT 1 FROM admins WHERE admins.user_id = auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'head_expression_defaults' AND policyname = 'Admins can update head expression defaults'
  ) THEN
    CREATE POLICY "Admins can update head expression defaults"
      ON head_expression_defaults FOR UPDATE
      TO authenticated
      USING (EXISTS (SELECT 1 FROM admins WHERE admins.user_id = auth.uid()))
      WITH CHECK (EXISTS (SELECT 1 FROM admins WHERE admins.user_id = auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'head_expression_defaults' AND policyname = 'Admins can delete head expression defaults'
  ) THEN
    CREATE POLICY "Admins can delete head expression defaults"
      ON head_expression_defaults FOR DELETE
      TO authenticated
      USING (EXISTS (SELECT 1 FROM admins WHERE admins.user_id = auth.uid()));
  END IF;
END $$;
