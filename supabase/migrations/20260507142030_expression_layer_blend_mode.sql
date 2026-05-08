/*
  # Expression category + blend mode support

  1. Changes
    - Add `blend_mode` column to `layer_order` (nullable).
    - Replace layer_order.category check constraint to include 'expression'.
    - Seed expression row (z_index 4, top of stack).
  2. Notes
    - `asset_category` enum already had expression added in a prior attempt; if not, add via ALTER TYPE.
*/

ALTER TABLE layer_order ADD COLUMN IF NOT EXISTS blend_mode text;

ALTER TABLE layer_order DROP CONSTRAINT IF EXISTS layer_order_category_check;
ALTER TABLE layer_order ADD CONSTRAINT layer_order_category_check
  CHECK (category = ANY (ARRAY['body','skin','hair','facial_hair','accessory','expression']));

INSERT INTO layer_order (category, z_index, blend_mode)
VALUES ('expression', 4, 'normal')
ON CONFLICT (category) DO NOTHING;
