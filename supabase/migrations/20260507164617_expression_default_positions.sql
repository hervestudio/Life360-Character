/*
  # Default positioning for expression category

  1. Changes
    - Upsert `category_defaults` rows for every body so the `expression`
      category gets a consistent default transform when no per-asset override
      or per-head override is set.

  2. Values
    - offset_x = -15
    - offset_y = -314
    - scale    = 0.13

  3. Notes
    - Safe: uses ON CONFLICT to update existing rows and insert missing ones.
    - Does not delete any existing data.
    - Does not alter per-head overrides (head_expression_defaults).
*/

INSERT INTO category_defaults (body_id, category, offset_x, offset_y, scale, updated_at)
SELECT id, 'expression', -15, -314, 0.13, now()
FROM assets
WHERE category = 'body'
ON CONFLICT (body_id, category)
DO UPDATE SET
  offset_x = EXCLUDED.offset_x,
  offset_y = EXCLUDED.offset_y,
  scale = EXCLUDED.scale,
  updated_at = now();
