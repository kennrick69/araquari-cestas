-- Migration 003: Add email column to pedidos
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS email VARCHAR(255);
