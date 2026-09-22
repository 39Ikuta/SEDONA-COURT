-- Migration: Add discount fields to receipts table
-- These columns persist discount information so it survives reloads and appears on reprinted receipts.

ALTER TABLE receipts ADD COLUMN discount_type TEXT DEFAULT NULL;
ALTER TABLE receipts ADD COLUMN discount_amount REAL DEFAULT 0.00;
ALTER TABLE receipts ADD COLUMN discount_id_ref TEXT DEFAULT NULL;
