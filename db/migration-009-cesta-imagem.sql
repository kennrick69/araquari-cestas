-- migration-009: armazenamento de imagem de cesta no Postgres
-- Motivo: o disco do Railway é efêmero (apaga a cada deploy). Guardar os bytes
-- no banco garante que a imagem sobrevive a redeploys. Idempotente.
CREATE TABLE IF NOT EXISTS cesta_imagens (
    tipo          VARCHAR(100) PRIMARY KEY,
    mime          VARCHAR(50)  NOT NULL DEFAULT 'image/webp',
    dados         BYTEA        NOT NULL,
    largura       INTEGER,
    altura        INTEGER,
    bytes         INTEGER,
    atualizado_em TIMESTAMP    DEFAULT NOW()
);
