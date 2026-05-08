/*
  # Allow body in layer_order

  1. Changes
    - Drop existing CHECK constraint on layer_order.category
    - Add new CHECK allowing 'body' as well
    - Insert default body z_index = 1 if missing
*/

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'layer_order_category_check'
  ) THEN
    ALTER TABLE layer_order DROP CONSTRAINT layer_order_category_check;
  END IF;
END $$;

ALTER TABLE layer_order
  ADD CONSTRAINT layer_order_category_check
  CHECK (category IN ('body','skin','hair','facial_hair','accessory'));

INSERT INTO layer_order (category, z_index) VALUES ('body', 1)
ON CONFLICT (category) DO NOTHING;
