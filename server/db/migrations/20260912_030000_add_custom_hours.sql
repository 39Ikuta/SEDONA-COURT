-- Migration: Add custom_hours column to rooms table for custom-duration stays

ALTER TABLE rooms ADD COLUMN custom_hours INTEGER DEFAULT NULL;
