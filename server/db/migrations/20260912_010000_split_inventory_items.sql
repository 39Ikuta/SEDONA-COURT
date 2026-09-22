-- Migration: Split combined POS items and add new inventory items
-- Splits Sprite/Royal into individual items, Cup Noodles into 3 variants,
-- and adds Guest Kit and Beddings as trackable hotel supply inventory items.

-- 1. Soft-delete old combined items
UPDATE billable_services SET is_deleted = 1, updated_at = datetime('now', 'localtime')
  WHERE id = 'drk-sprite-royal';
UPDATE billable_services SET is_deleted = 1, updated_at = datetime('now', 'localtime')
  WHERE id = 'misc-cup-noodles';

-- 2. Insert individual Sprite and Royal drinks
INSERT OR IGNORE INTO billable_services (id, type, name, price, category, active, description, image_url, is_deleted)
VALUES
  ('drk-sprite', 'menu_item', 'Sprite', 60, 'Drinks', 1,
   'Chilled canned Sprite lemon-lime soda 320ml.',
   'https://images.unsplash.com/photo-1625772299848-391b6a87d7b3?auto=format&fit=crop&w=400&q=80', 0),
  ('drk-royal', 'menu_item', 'Royal', 60, 'Drinks', 1,
   'Chilled canned Royal Tru-Orange soda 320ml.',
   'https://images.unsplash.com/photo-1625772299848-391b6a87d7b3?auto=format&fit=crop&w=400&q=80', 0);

-- 3. Insert 3 Cup Noodle variants
INSERT OR IGNORE INTO billable_services (id, type, name, price, category, active, description, image_url, is_deleted)
VALUES
  ('misc-cupnoodles-beef', 'menu_item', 'Cup Noodles (Beef)', 60, 'Miscellaneous', 1,
   'Nissin Cup Noodles Beef flavor with hot water.',
   'https://images.unsplash.com/photo-1612927601601-6638404737ce?auto=format&fit=crop&w=400&q=80', 0),
  ('misc-cupnoodles-bulalo', 'menu_item', 'Cup Noodles (Bulalo)', 60, 'Miscellaneous', 1,
   'Nissin Cup Noodles Bulalo flavor with hot water.',
   'https://images.unsplash.com/photo-1612927601601-6638404737ce?auto=format&fit=crop&w=400&q=80', 0),
  ('misc-cupnoodles-seafood', 'menu_item', 'Cup Noodles (Seafood)', 60, 'Miscellaneous', 1,
   'Nissin Cup Noodles Seafood flavor with hot water.',
   'https://images.unsplash.com/photo-1612927601601-6638404737ce?auto=format&fit=crop&w=400&q=80', 0);

-- 4. Insert Guest Kit and Beddings as trackable hotel supplies
INSERT OR IGNORE INTO billable_services (id, type, name, price, category, active, description, image_url, is_deleted)
VALUES
  ('supply-guest-kit', 'service', 'Guest Kit', 0, 'Hotel Supplies', 1,
   'Guest welcome amenity kit (soap, shampoo, toothbrush, towel).',
   'https://images.unsplash.com/photo-1600857544200-b2f666a9a2ec?auto=format&fit=crop&w=400&q=80', 0),
  ('supply-beddings', 'service', 'Beddings Set', 0, 'Hotel Supplies', 1,
   'Complete bedding linen set (bedsheet, pillow, pillowcase, blanket).',
   'https://images.unsplash.com/photo-1540518614846-7eded433c457?auto=format&fit=crop&w=400&q=80', 0);

-- 5. Insert matching inventory tracking rows
INSERT OR IGNORE INTO menu_item_inventory (item_id, item_name, category, current_quantity, is_tracked)
VALUES
  ('drk-sprite', 'Sprite', 'Drinks', 0, 1),
  ('drk-royal', 'Royal', 'Drinks', 0, 1),
  ('misc-cupnoodles-beef', 'Cup Noodles (Beef)', 'Miscellaneous', 0, 1),
  ('misc-cupnoodles-bulalo', 'Cup Noodles (Bulalo)', 'Miscellaneous', 0, 1),
  ('misc-cupnoodles-seafood', 'Cup Noodles (Seafood)', 'Miscellaneous', 0, 1),
  ('supply-guest-kit', 'Guest Kit', 'Hotel Supplies', 0, 1),
  ('supply-beddings', 'Beddings Set', 'Hotel Supplies', 0, 1);

-- 6. Remove old combined inventory entries
DELETE FROM menu_item_inventory WHERE item_id = 'drk-sprite-royal';
DELETE FROM menu_item_inventory WHERE item_id = 'misc-cup-noodles';
