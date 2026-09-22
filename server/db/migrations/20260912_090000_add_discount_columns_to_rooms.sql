-- Migration: Add discount_type and discount_id_ref columns to rooms table
ALTER TABLE rooms ADD COLUMN discount_type TEXT DEFAULT 'NONE';
ALTER TABLE rooms ADD COLUMN discount_id_ref TEXT DEFAULT '';
