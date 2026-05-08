/*
  # Per-head color overrides for expression SVGs

  1. New Tables
    - `head_expression_colors`
      - `head_id` (uuid) — references assets(id), the head asset this override applies to
      - `expression_id` (uuid) — references assets(id), the expression asset
      - `colors` (jsonb) — map of SVG slot name (element id) to hex color string
      - `updated_at` (timestamptz)
      - Primary key (head_id, expression_id)

  2. Security
    - Enable RLS
    - Public read (so the client can render with overrides)
    - Admin-only write (insert/update/delete via admins table check)

  3. Notes
    - Deletes cascade with assets. If a head or expression is removed, related
      color overrides are cleaned up automatically.
    - Empty colors map means "inherit defaults from SVG".
*/

CREATE TABLE IF NOT EXISTS head_expression_colors (
  head_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  expression_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  colors jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (head_id, expression_id)
);

ALTER TABLE head_expression_colors ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='head_expression_colors'
    AND policyname='Public can read head expression colors'
  ) THEN
    CREATE POLICY "Public can read head expression colors"
      ON head_expression_colors FOR SELECT
      TO anon, authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='head_expression_colors'
    AND policyname='Admins can insert head expression colors'
  ) THEN
    CREATE POLICY "Admins can insert head expression colors"
      ON head_expression_colors FOR INSERT
      TO authenticated
      WITH CHECK (EXISTS (SELECT 1 FROM admins WHERE admins.user_id = auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='head_expression_colors'
    AND policyname='Admins can update head expression colors'
  ) THEN
    CREATE POLICY "Admins can update head expression colors"
      ON head_expression_colors FOR UPDATE
      TO authenticated
      USING (EXISTS (SELECT 1 FROM admins WHERE admins.user_id = auth.uid()))
      WITH CHECK (EXISTS (SELECT 1 FROM admins WHERE admins.user_id = auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='head_expression_colors'
    AND policyname='Admins can delete head expression colors'
  ) THEN
    CREATE POLICY "Admins can delete head expression colors"
      ON head_expression_colors FOR DELETE
      TO authenticated
      USING (EXISTS (SELECT 1 FROM admins WHERE admins.user_id = auth.uid()));
  END IF;
END $$;
