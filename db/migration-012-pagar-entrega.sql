-- migration-012-pagar-entrega.sql
-- Opção de pagamento "Pagar na entrega" (dinheiro / Pix na entrega / cartão na maquininha,
-- com parcelamento opcional no crédito). TOTALMENTE ADITIVA:
--   • Só ADD COLUMN IF NOT EXISTS em `pedidos` (colunas novas, nenhum dado existente é
--     alterado ou apagado — os pedidos antigos ficam com NULL/false nos campos novos).
--   • Só INSERT ... ON CONFLICT DO NOTHING em `app_config` (não sobrescreve config existente).
-- Nada de DROP / ALTER de tipo / UPDATE / DELETE / TRUNCATE.

-- ── Colunas novas no pedido ────────────────────────────────────────
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS entrega_pagamento      BOOLEAN DEFAULT false; -- true = pagamento acontece na entrega
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS entrega_forma          VARCHAR(20);           -- dinheiro | pix | cartao
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS entrega_cartao_tipo    VARCHAR(20);           -- debito | credito | credito3x
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS entrega_parcelas       INTEGER;               -- nº de parcelas (crédito parcelado)
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS entrega_troco_para     DECIMAL(10,2);         -- cédula com que o cliente vai pagar (NULL = valor certo)
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS entrega_troco_valor    DECIMAL(10,2);         -- troco a levar
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS entrega_valor_original DECIMAL(10,2);         -- valor do pedido ANTES do acréscimo
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS entrega_acrescimo      DECIMAL(10,2);         -- acréscimo do parcelamento (0 nos demais)

-- ── Config padrão (as três formas começam LIGADAS; parcelamento LIGADO) ──
INSERT INTO app_config (chave, valor, descricao, tipo) VALUES
    ('entrega_ativo',         '1',  'Pagar na entrega habilitado',                                  'bool'),
    ('entrega_dinheiro',      '1',  'Aceitar dinheiro na entrega',                                  'bool'),
    ('entrega_pix',           '1',  'Aceitar Pix na entrega',                                       'bool'),
    ('entrega_cartao',        '1',  'Aceitar cartão na maquininha',                                 'bool'),
    ('entrega_max_pedido',    '0',  'Valor máximo do pedido p/ pagar na entrega (0 = sem limite)',  'number'),
    ('entrega_parcelamento',  '1',  'Permitir parcelamento no cartão da maquininha',                'bool'),
    ('entrega_parcelas_max',  '3',  'Número máximo de parcelas',                                    'number'),
    ('entrega_acrescimo_pct', '10', 'Percentual de acréscimo do parcelamento',                      'number')
ON CONFLICT (chave) DO NOTHING;
