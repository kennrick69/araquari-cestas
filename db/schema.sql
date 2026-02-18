-- ══════════════════════════════════════════════
-- ARAQUARI CESTAS - Database Schema
-- Execute este SQL no PostgreSQL do Railway
-- ══════════════════════════════════════════════

-- Pedidos
CREATE TABLE IF NOT EXISTS pedidos (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(20) UNIQUE NOT NULL,        -- ex: AC-20260218-0001
    
    -- Cesta
    cesta_tipo VARCHAR(20) NOT NULL,            -- x, confort, plus
    cesta_nome VARCHAR(100) NOT NULL,
    cesta_preco DECIMAL(10,2) NOT NULL,
    quantidade INTEGER DEFAULT 1,
    
    -- Entrega
    endereco_rua VARCHAR(255),
    endereco_numero VARCHAR(20),
    endereco_complemento VARCHAR(100),
    endereco_referencia VARCHAR(255),
    endereco_bairro VARCHAR(100),
    endereco_cidade VARCHAR(100) DEFAULT 'Araquari',
    endereco_estado VARCHAR(2) DEFAULT 'SC',
    latitude DECIMAL(10,7),
    longitude DECIMAL(10,7),
    
    -- Recebedor
    recebedor_nome VARCHAR(150) NOT NULL,
    recebedor_telefone VARCHAR(20) NOT NULL,
    
    -- Pagamento
    pagamento_metodo VARCHAR(20) NOT NULL,      -- pix, cartao, boleto, boleto30
    pagamento_status VARCHAR(20) DEFAULT 'pendente',  -- pendente, aprovado, recusado
    desconto DECIMAL(10,2) DEFAULT 0,
    total DECIMAL(10,2) NOT NULL,
    
    -- Boleto 30 dias (campos extras)
    cpf VARCHAR(14),
    doc_identidade VARCHAR(255),               -- caminho do arquivo
    doc_residencia VARCHAR(255),               -- caminho do arquivo
    
    -- Status do pedido
    status VARCHAR(30) DEFAULT 'novo',         -- novo, confirmado, separacao, pronto, a_caminho, entregue, cancelado, analise
    
    -- Timestamps
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_pedidos_codigo ON pedidos(codigo);
CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos(status);
CREATE INDEX IF NOT EXISTS idx_pedidos_telefone ON pedidos(recebedor_telefone);
CREATE INDEX IF NOT EXISTS idx_pedidos_criado ON pedidos(criado_em DESC);

-- Função para atualizar timestamp
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.atualizado_em = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger de atualização
DROP TRIGGER IF EXISTS trigger_pedidos_timestamp ON pedidos;
CREATE TRIGGER trigger_pedidos_timestamp
    BEFORE UPDATE ON pedidos
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();

-- Log de status (histórico)
CREATE TABLE IF NOT EXISTS pedidos_log (
    id SERIAL PRIMARY KEY,
    pedido_id INTEGER REFERENCES pedidos(id) ON DELETE CASCADE,
    status_anterior VARCHAR(30),
    status_novo VARCHAR(30) NOT NULL,
    observacao TEXT,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_log_pedido ON pedidos_log(pedido_id);

-- Configurações do sistema
CREATE TABLE IF NOT EXISTS config (
    chave VARCHAR(50) PRIMARY KEY,
    valor TEXT NOT NULL,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Configs padrão
INSERT INTO config (chave, valor) VALUES
    ('horario_inicio', '08:00'),
    ('horario_fim', '18:00'),
    ('taxa_entrega', '0'),
    ('desconto_pix', '5'),
    ('ativo', 'true')
ON CONFLICT (chave) DO NOTHING;
