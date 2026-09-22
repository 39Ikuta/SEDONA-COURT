-- Migration: Add rate_selected and stay_duration to receipts table
-- These columns persist rate selection (e.g. 3h, 6h, 12h, 24h, promo, custom) and formatted duration on receipts.

ALTER TABLE receipts ADD COLUMN rate_selected TEXT DEFAULT NULL;
ALTER TABLE receipts ADD COLUMN stay_duration TEXT DEFAULT NULL;
