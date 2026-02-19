-- Adicionar colunas de gateway de pagamento
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS gateway_id VARCHAR(100);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS gateway_data JSONB;

CREATE INDEX IF NOT EXISTS idx_pedidos_gateway ON pedidos(gateway_id);
