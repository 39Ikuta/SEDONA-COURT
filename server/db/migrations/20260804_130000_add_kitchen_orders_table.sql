-- Migration: Add Kitchen Orders Table
-- Created: 2026-08-04T13:00:00.000Z
--
-- Adds kitchen order display system for read-only TV display:
-- - kitchen_orders: Real-time order tracking for kitchen staff

-- ============================================================
-- KITCHEN ORDERS TABLE
-- Stores orders sent to kitchen for preparation tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS kitchen_orders (
  id SERIAL PRIMARY KEY,
  
  -- Order Identification
  order_number VARCHAR(20) UNIQUE NOT NULL,  -- e.g., "K-0001"
  receipt_no VARCHAR(50),  -- Link to receipts table
  
  -- Order Source Information
  room_number VARCHAR(10) NOT NULL,
  guest_name VARCHAR(100) NOT NULL,
  cashier_name VARCHAR(50) NOT NULL,
  
  -- Order Contents (JSONB for flexibility)
  -- Format: [{"item_id": "silog-special", "name": "Silog Special", "quantity": 2, "special_instructions": "Extra rice"}]
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_items INTEGER NOT NULL DEFAULT 0,
  total_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
  
  -- Order Status Tracking
  status VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'preparing', 'ready', 'delivered', 'cancelled')),
  priority VARCHAR(10) NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent')),
  
  -- Timing Tracking
  ordered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  preparing_started_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  
  -- Staff Assignment
  assigned_to VARCHAR(50),  -- Kitchen staff member assigned
  prepared_by VARCHAR(50),  -- Who prepared the order
  delivered_by VARCHAR(50), -- Who delivered to room
  
  -- Additional Information
  special_instructions TEXT,
  kitchen_notes TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_kitchen_orders_status 
  ON kitchen_orders(status) WHERE status IN ('new', 'preparing', 'ready');

CREATE INDEX IF NOT EXISTS idx_kitchen_orders_room 
  ON kitchen_orders(room_number);

CREATE INDEX IF NOT EXISTS idx_kitchen_orders_ordered_at 
  ON kitchen_orders(ordered_at DESC);

CREATE INDEX IF NOT EXISTS idx_kitchen_orders_receipt 
  ON kitchen_orders(receipt_no);

CREATE INDEX IF NOT EXISTS idx_kitchen_orders_active 
  ON kitchen_orders(status, ordered_at DESC) 
  WHERE status IN ('new', 'preparing', 'ready');

-- ============================================================
-- TRIGGER FOR UPDATED_AT
-- ============================================================
CREATE OR REPLACE FUNCTION update_kitchen_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_kitchen_orders_updated_at
    BEFORE UPDATE ON kitchen_orders
    FOR EACH ROW
    EXECUTE FUNCTION update_kitchen_orders_updated_at();