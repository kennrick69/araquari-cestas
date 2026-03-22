-- Tabela de configurações do sistema
CREATE TABLE IF NOT EXISTS app_config (
    chave VARCHAR(100) PRIMARY KEY,
    valor TEXT NOT NULL DEFAULT '',
    descricao VARCHAR(200) DEFAULT '',
    tipo VARCHAR(20) DEFAULT 'text',
    atualizado_em TIMESTAMP DEFAULT NOW()
);

-- Inserir configurações padrão do Mercado Pago (se não existirem)
INSERT INTO app_config (chave, valor, descricao, tipo) VALUES
    ('mp_access_token', '', 'Access Token do Mercado Pago', 'password'),
    ('mp_public_key', '', 'Public Key do Mercado Pago', 'text'),
    ('mp_app_id', '', 'Application ID do Mercado Pago', 'text'),
    ('mp_webhook_secret', '', 'Webhook Secret (opcional)', 'password'),
    ('loja_nome', 'Araquari Cestas', 'Nome da loja', 'text'),
    ('loja_telefone', '47996813181', 'Telefone WhatsApp da loja', 'text'),
    ('loja_email', 'contato@araquaricestas.com', 'E-mail da loja', 'text')
ON CONFLICT (chave) DO NOTHING;
