-- ══════════════════════════════════════════════════════════════════
-- migration-011-rotas.sql
-- Sistema de rotas para entregadores: cadastro de entregadores, rotas
-- (com link público por token) e as paradas de cada rota.
-- Idempotente (roda no boot via db/migrate.js).
-- ══════════════════════════════════════════════════════════════════

-- Entregadores cadastrados (nome + whatsapp)
CREATE TABLE IF NOT EXISTS entregadores (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(120) NOT NULL,
    telefone VARCHAR(20) DEFAULT '',
    ativo BOOLEAN DEFAULT true,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Rotas geradas. O `token` é aleatório e difícil de adivinhar: é a
-- credencial do link público do entregador (sem login).
CREATE TABLE IF NOT EXISTS rotas (
    id SERIAL PRIMARY KEY,
    token VARCHAR(64) UNIQUE NOT NULL,
    entregador_id INTEGER REFERENCES entregadores(id) ON DELETE SET NULL,
    entregador_nome VARCHAR(120) DEFAULT '',
    entregador_telefone VARCHAR(20) DEFAULT '',
    origem_lat DECIMAL(10,7),
    origem_lng DECIMAL(10,7),
    origem_label VARCHAR(255) DEFAULT '',
    status VARCHAR(20) DEFAULT 'ativa',          -- ativa, concluida, cancelada
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expira_em TIMESTAMP,                          -- 24h após a criação
    concluida_em TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_rotas_token ON rotas(token);
CREATE INDEX IF NOT EXISTS idx_rotas_status ON rotas(status);

-- Paradas de cada rota (um pedido = uma parada), já na ordem calculada.
CREATE TABLE IF NOT EXISTS rota_paradas (
    id SERIAL PRIMARY KEY,
    rota_id INTEGER REFERENCES rotas(id) ON DELETE CASCADE,
    pedido_id INTEGER REFERENCES pedidos(id) ON DELETE CASCADE,
    ordem INTEGER NOT NULL DEFAULT 0,
    entregue BOOLEAN DEFAULT false,
    entregue_em TIMESTAMP,
    UNIQUE(rota_id, pedido_id)
);
CREATE INDEX IF NOT EXISTS idx_paradas_rota ON rota_paradas(rota_id);
CREATE INDEX IF NOT EXISTS idx_paradas_pedido ON rota_paradas(pedido_id);

-- Config de rotas: ponto de saída (loja) e raio de agrupamento.
-- Default: centro de Araquari / 2 km. Admin ajusta no painel.
INSERT INTO app_config (chave, valor, descricao, tipo) VALUES
    ('rota_origem_lat', '-26.3706', 'Latitude do ponto de saída (loja)', 'text'),
    ('rota_origem_lng', '-48.7219', 'Longitude do ponto de saída (loja)', 'text'),
    ('rota_origem_label', 'Loja — Araquari', 'Nome do ponto de saída', 'text'),
    ('rota_raio_km', '2', 'Raio de agrupamento por região (km)', 'text')
ON CONFLICT (chave) DO NOTHING;
