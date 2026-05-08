/*
  # Set default hair positioning for female bodies

  1. Updates
    - Inserts/updates `category_defaults` rows for all female bodies so the
      head (category 'hair') layer defaults to offset_x = -19, offset_y = -267,
      scale = 0.13 when no per-asset override is set.

  2. Notes
    - Only affects bodies where gender = 'female'.
    - Does not modify existing per-asset override values on assets.
*/

INSERT INTO category_defaults (body_id, category, offset_x, offset_y, scale)
SELECT a.id, 'hair', -19, -267, 0.13
FROM assets a
WHERE a.category = 'body' AND a.gender = 'female'
ON CONFLICT (body_id, category)
DO UPDATE SET offset_x = EXCLUDED.offset_x,
              offset_y = EXCLUDED.offset_y,
              scale = EXCLUDED.scale;
