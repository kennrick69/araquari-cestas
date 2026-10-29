-- Coluna de tag/destaque da cesta (ex.: POPULAR, PREMIUM) exibida no card do app.
ALTER TABLE cestas_config ADD COLUMN IF NOT EXISTS tag VARCHAR(50) DEFAULT '';

-- Seed inicial: mantém as tags de hoje nas cestas padrão. Guardado por (tag vazio)
-- pra não sobrescrever o que o admin definir em deploys seguintes.
UPDATE cestas_config SET tag = 'POPULAR'    WHERE tipo = 'confort' AND (tag IS NULL OR tag = '');
UPDATE cestas_config SET tag = '⭐ PREMIUM' WHERE tipo = 'plus'    AND (tag IS NULL OR tag = '');
