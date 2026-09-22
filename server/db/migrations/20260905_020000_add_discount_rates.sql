-- Migration: 20260905_020000_add_discount_rates.sql
-- Creates discount_rates reference table with fixed discount amounts in integer centavos

CREATE TABLE IF NOT EXISTS discount_rates (
  id                TEXT PRIMARY KEY,
  discount_type     TEXT NOT NULL CHECK (discount_type IN ('SENIOR', 'DC')),
  room_tier         TEXT NOT NULL CHECK (room_tier IN ('CLASSIC', 'PREMIUM', 'VIP')),
  duration          TEXT NOT NULL CHECK (duration IN ('3HR', '12HR', '24HR')),
  amount_centavos   INTEGER NOT NULL CHECK (amount_centavos > 0),
  description       TEXT,
  created_at        TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at        TEXT DEFAULT (datetime('now', 'localtime')),
  UNIQUE(discount_type, room_tier, duration)
);

CREATE INDEX IF NOT EXISTS idx_discount_rates_lookup ON discount_rates(discount_type, room_tier, duration);

-- Seed fixed discount rates (15 records, integer centavos)
INSERT OR IGNORE INTO discount_rates (id, discount_type, room_tier, duration, amount_centavos, description) VALUES
  ('rate-dc-classic-3h', 'DC', 'CLASSIC', '3HR', 4000, 'Discount Card - Classic 3 Hours (₱40.00)'),
  ('rate-dc-classic-12h', 'DC', 'CLASSIC', '12HR', 5500, 'Discount Card - Classic 12 Hours (₱55.00)'),
  ('rate-dc-classic-24h', 'DC', 'CLASSIC', '24HR', 9500, 'Discount Card - Classic 24 Hours (₱95.00)'),
  ('rate-dc-premium-3h', 'DC', 'PREMIUM', '3HR', 5000, 'Discount Card - Premium 3 Hours (₱50.00)'),
  ('rate-dc-premium-12h', 'DC', 'PREMIUM', '12HR', 6000, 'Discount Card - Premium 12 Hours (₱60.00)'),
  ('rate-dc-premium-24h', 'DC', 'PREMIUM', '24HR', 10500, 'Discount Card - Premium 24 Hours (₱105.00)'),
  ('rate-dc-vip-3h', 'DC', 'VIP', '3HR', 6500, 'Discount Card - VIP 3 Hours (₱65.00)'),
  ('rate-dc-vip-12h', 'DC', 'VIP', '12HR', 7000, 'Discount Card - VIP 12 Hours (₱70.00)'),
  ('rate-dc-vip-24h', 'DC', 'VIP', '24HR', 11500, 'Discount Card - VIP 24 Hours (₱115.00)'),
  ('rate-senior-classic-12h', 'SENIOR', 'CLASSIC', '12HR', 19500, 'Senior/PWD - Classic 12 Hours (₱195.00)'),
  ('rate-senior-classic-24h', 'SENIOR', 'CLASSIC', '24HR', 34000, 'Senior/PWD - Classic 24 Hours (₱340.00)'),
  ('rate-senior-premium-12h', 'SENIOR', 'PREMIUM', '12HR', 21500, 'Senior/PWD - Premium 12 Hours (₱215.00)'),
  ('rate-senior-premium-24h', 'SENIOR', 'PREMIUM', '24HR', 37500, 'Senior/PWD - Premium 24 Hours (₱375.00)'),
  ('rate-senior-vip-12h', 'SENIOR', 'VIP', '12HR', 25500, 'Senior/PWD - VIP 12 Hours (₱255.00)'),
  ('rate-senior-vip-24h', 'SENIOR', 'VIP', '24HR', 46000, 'Senior/PWD - VIP 24 Hours (₱460.00)');
