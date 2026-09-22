-- Migration: 20260905_010000_add_kitchen_order_print_status.sql
-- Adds thermal printer ticket tracking columns to kitchen_orders

ALTER TABLE kitchen_orders ADD COLUMN print_status TEXT NOT NULL DEFAULT 'pending' CHECK (print_status IN ('pending', 'printing', 'printed', 'failed'));
ALTER TABLE kitchen_orders ADD COLUMN printed_at TEXT;
ALTER TABLE kitchen_orders ADD COLUMN print_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE kitchen_orders ADD COLUMN print_error TEXT;

CREATE INDEX IF NOT EXISTS idx_kitchen_orders_print_status ON kitchen_orders(print_status);
