-- Migration: 20260912_060000_add_linens_supplies_laundry_to_inventory.sql
-- Integrates Bed sheet, Beddings Set, Blanket, Extra Bed (set), Extra Bed,
-- Guest Kit, Pillow, Pillow case, Towel, and Regular Laundry (Per kg)
-- into menu_item_inventory for Cashier Shift Inventory tracking and reporting.

-- 1. Ensure all 10 items exist and are active in billable_services
INSERT OR REPLACE INTO billable_services (id, type, name, price, category, active, description, image_url, is_deleted)
VALUES
  ('bed-sheet', 'service', 'Bed sheet', 150, 'Linen & Bedding', 1,
   'Fresh clean single/double bedsheet',
   'https://images.unsplash.com/photo-1631679706909-1844bbd07221?auto=format&fit=crop&w=400&q=80', 0),
  ('supply-beddings', 'service', 'Beddings Set', 200, 'Linen & Bedding', 1,
   'Complete fresh beddings linen pack (bedsheet, pillow, pillowcase, blanket).',
   'https://images.unsplash.com/photo-1540518614846-7eded433c457?auto=format&fit=crop&w=400&q=80', 0),
  ('blanket', 'service', 'Blanket', 100, 'Linen & Bedding', 1,
   'Cozy warm thermal blanket',
   'https://images.unsplash.com/photo-1580301762395-21ce84d00bc6?auto=format&fit=crop&w=400&q=80', 0),
  ('extra-bedsheet-set', 'service', 'Extra Bed (set)', 500, 'Linen & Bedding', 1,
   'Complete bed set with mattress and linens',
   'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?auto=format&fit=crop&w=400&q=80', 0),
  ('extra-bed', 'service', 'Extra Bed', 250, 'Linen & Bedding', 1,
   'Rollaway single mattress set',
   'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=400&q=80', 0),
  ('supply-guest-kit', 'service', 'Guest Kit', 50, 'Hotel Supplies', 1,
   'Complete guest amenity kit (hygiene, toiletries).',
   'https://images.unsplash.com/photo-1600857544200-b2f666a9a2ec?auto=format&fit=crop&w=400&q=80', 0),
  ('pillow', 'service', 'Pillow', 200, 'Linen & Bedding', 1,
   'Extra fluffy head pillow',
   'https://images.unsplash.com/photo-1584100936595-c0654b55a2e2?auto=format&fit=crop&w=400&q=80', 0),
  ('pillow-case', 'service', 'Pillow case', 100, 'Linen & Bedding', 1,
   'Fresh replacement pillow protector',
   'https://images.unsplash.com/photo-1600121848594-d8644e57abab?auto=format&fit=crop&w=400&q=80', 0),
  ('towel', 'service', 'Towel', 100, 'Hotel Supplies', 1,
   'Plush high-absorbency bath towel',
   'https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=400&q=80', 0),
  ('laundry-regular', 'service', 'Regular Laundry (Per kg)', 120, 'Laundry', 1,
   'Wash, dry, and fold service. Next day delivery.',
   'https://images.unsplash.com/photo-1545173168-9f1947eebb7f?auto=format&fit=crop&w=400&q=80', 0);

-- 2. Insert into menu_item_inventory if not present, or update category and name
INSERT INTO menu_item_inventory (item_id, item_name, category, current_quantity, is_tracked)
VALUES
  ('bed-sheet', 'Bed sheet', 'Linen & Bedding', 0, 1),
  ('supply-beddings', 'Beddings Set', 'Linen & Bedding', 0, 1),
  ('blanket', 'Blanket', 'Linen & Bedding', 0, 1),
  ('extra-bedsheet-set', 'Extra Bed (set)', 'Linen & Bedding', 0, 1),
  ('extra-bed', 'Extra Bed', 'Linen & Bedding', 0, 1),
  ('supply-guest-kit', 'Guest Kit', 'Hotel Supplies', 0, 1),
  ('pillow', 'Pillow', 'Linen & Bedding', 0, 1),
  ('pillow-case', 'Pillow case', 'Linen & Bedding', 0, 1),
  ('towel', 'Towel', 'Hotel Supplies', 0, 1),
  ('laundry-regular', 'Regular Laundry (Per kg)', 'Laundry', 0, 1)
ON CONFLICT (item_id) DO UPDATE SET
  item_name = excluded.item_name,
  category = excluded.category,
  is_tracked = 1;
