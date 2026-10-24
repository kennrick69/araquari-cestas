-- ============================================================================
-- migration-006-config-unify.sql
-- Unifica fonte de configurações: a tabela legada `config` é migrada pra
-- `app_config` (única canônica). Rodada idempotentemente no boot.
-- ----------------------------------------------------------------------------
-- Regra: pra cada chave na `config`, se `app_config` NÃO tem valor preenchido
-- naquela chave, copia o valor da `config` pra lá. Se `app_config` já tem
-- valor, NÃO sobrescreve (admin pode já ter atualizado via painel novo).
-- Depois marca as chaves migradas na `config` como `_migrado_` (não deleta,
-- pra manter histórico até confirmação manual).
-- ============================================================================

-- 1) Garante que app_config existe (migration-005 já cria, mas rodamos de novo
--    pra ser idempotente mesmo em bancos antigos sem a 005 aplicada).
CREATE TABLE IF NOT EXISTS app_config (
    chave VARCHAR(100) PRIMARY KEY,
    valor TEXT NOT NULL DEFAULT '',
    descricao VARCHAR(200) DEFAULT '',
    tipo VARCHAR(20) DEFAULT 'text',
    atualizado_em TIMESTAMP DEFAULT NOW()
);

-- 2) Copia chaves da `config` → `app_config`, só preenchendo o que estiver vazio
--    no destino. Faz nada se a tabela `config` não existir (DO block protege).
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'config'
    ) THEN
        -- Upsert: cria linha se não existe; atualiza APENAS se valor atual
        -- em app_config está vazio E valor em config não está vazio.
        INSERT INTO app_config (chave, valor, atualizado_em)
        SELECT c.chave, c.valor, NOW()
          FROM config c
         WHERE c.valor IS NOT NULL AND c.valor <> ''
        ON CONFLICT (chave) DO UPDATE
            SET valor = EXCLUDED.valor,
                atualizado_em = NOW()
          WHERE app_config.valor = '' OR app_config.valor IS NULL;
    END IF;
END $$;
