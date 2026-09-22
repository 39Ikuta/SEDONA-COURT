-- Migration: Ensure all Kitchen Extras and Miscellaneous items are tracked in inventory

-- Enable inventory tracking for all existing Kitchen Extras
INSERT OR IGNORE INTO menu_item_inventory (item_id, item_name, category, current_quantity, is_tracked)
VALUES
  ('ext-plain-rice', 'Plain Rice', 'Kitchen Extras', 0, 1),
  ('ext-garlic-rice', 'Garlic Rice', 'Kitchen Extras', 0, 1),
  ('ext-egg', 'Egg (Fried/Boiled)', 'Kitchen Extras', 0, 1),
  ('ext-ice-bucket', 'Ice Bucket', 'Kitchen Extras', 0, 1),
  ('ext-hot-water', 'Hot Water', 'Kitchen Extras', 0, 1);

-- Enable inventory tracking for Miscellaneous items not yet tracked
INSERT OR IGNORE INTO menu_item_inventory (item_id, item_name, category, current_quantity, is_tracked)
VALUES
  ('misc-chips', 'Piatos, Nova, Pic-A, V-Cut', 'Miscellaneous', 0, 1),
  ('misc-candy', 'Halls / Snowbear Candy', 'Miscellaneous', 0, 1),
  ('misc-marlboro-red', 'Marlboro Red', 'Miscellaneous', 0, 1),
  ('misc-marlboro-lights', 'Marlboro Lights', 'Miscellaneous', 0, 1),
  ('misc-lighter', 'Lighter', 'Miscellaneous', 0, 1),
  ('misc-condom', 'Condom', 'Miscellaneous', 0, 1),
  ('misc-sanitary-napkin', 'Sanitary Napkin', 'Miscellaneous', 0, 1),
  ('misc-pantiliner', 'Pantiliner', 'Miscellaneous', 0, 1),
  ('misc-feminine-wash', 'Feminine Wash', 'Miscellaneous', 0, 1),
  ('misc-tissue-roll', 'Tissue Roll', 'Miscellaneous', 0, 1),
  ('misc-shaving-kit', 'Shaving Kit', 'Miscellaneous', 0, 1),
  ('misc-soap-safeguard', 'Soap (Safeguard)', 'Miscellaneous', 0, 1),
  ('misc-shampoo', 'Shampoo', 'Miscellaneous', 0, 1),
  ('misc-conditioner', 'Conditioner', 'Miscellaneous', 0, 1),
  ('misc-toothpaste-sachet', 'Toothpaste Sachet', 'Miscellaneous', 0, 1),
  ('misc-toothbrush', 'Toothbrush', 'Miscellaneous', 0, 1);

-- Also ensure Drinks items are tracked
INSERT OR IGNORE INTO menu_item_inventory (item_id, item_name, category, current_quantity, is_tracked)
VALUES
  ('drk-coke', 'Coke / Coke Zero', 'Drinks', 0, 1),
  ('drk-pineapple-juice', 'Pineapple Juice', 'Drinks', 0, 1),
  ('drk-c2-apple', 'C2 Apple', 'Drinks', 0, 1),
  ('drk-mineral-water', 'Mineral Water', 'Drinks', 0, 1),
  ('drk-coffee', 'Coffee (Brown/Blanca)', 'Drinks', 0, 1),
  ('drk-milo', 'Milo', 'Drinks', 0, 1),
  ('drk-san-miguel-beer', 'San Miguel Beer', 'Drinks', 0, 1),
  ('drk-san-mig-light', 'San Mig Light', 'Drinks', 0, 1),
  ('drk-redhorse', 'Redhorse', 'Drinks', 0, 1);
