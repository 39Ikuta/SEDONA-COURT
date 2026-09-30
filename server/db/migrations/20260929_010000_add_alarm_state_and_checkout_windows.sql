-- Migration: Add check_in_at, expected_checkout_at, alarm_state, acknowledged_at, acknowledged_by to rooms
-- Also add system_settings table for configurable alarm thresholds (alarm_pre_minutes, alarm_post_minutes)

ALTER TABLE rooms ADD COLUMN check_in_at TEXT DEFAULT NULL;
ALTER TABLE rooms ADD COLUMN expected_checkout_at TEXT DEFAULT NULL;
ALTER TABLE rooms ADD COLUMN alarm_state TEXT NOT NULL DEFAULT 'NORMAL';
ALTER TABLE rooms ADD COLUMN acknowledged_at TEXT DEFAULT NULL;
ALTER TABLE rooms ADD COLUMN acknowledged_by TEXT DEFAULT NULL;

CREATE TABLE IF NOT EXISTS system_settings (
  key VARCHAR(64) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO system_settings (key, value) VALUES ('alarm_pre_minutes', '15');
INSERT OR IGNORE INTO system_settings (key, value) VALUES ('alarm_post_minutes', '15');
