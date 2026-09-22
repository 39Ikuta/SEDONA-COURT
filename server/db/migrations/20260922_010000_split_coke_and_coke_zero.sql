-- Migration: Split Coke / Coke Zero into separate inventory and POS items
-- Splits the combined "Coke / Coke Zero" into "Coke" and "Coke Zero"

-- 1. Update existing drk-coke to Coke (regular)
UPDATE billable_services 
SET name = 'Coke', 
    description = 'Chilled canned Coca-Cola regular 320ml.',
    updated_at = datetime('now', 'localtime')
WHERE id = 'drk-coke';

UPDATE menu_item_inventory 
SET item_name = 'Coke',
    updated_at = datetime('now', 'localtime')
WHERE item_id = 'drk-coke';

-- 2. Insert separate Coke Zero billable service
INSERT OR IGNORE INTO billable_services (id, type, name, price, category, active, description, image_url, is_deleted)
VALUES
  ('drk-coke-zero', 'menu_item', 'Coke Zero', 60, 'Drinks', 1,
   'Chilled canned Coca-Cola Zero Sugar 320ml.',
   'https://images.unsplash.com/photo-1554866585-cd94860890b7?auto=format&fit=crop&w=400&q=80', 0);

-- 3. Insert matching inventory tracking row for Coke Zero
INSERT OR IGNORE INTO menu_item_inventory (item_id, item_name, category, current_quantity, is_tracked)
VALUES
  ('drk-coke-zero', 'Coke Zero', 'Drinks', 0, 1);
