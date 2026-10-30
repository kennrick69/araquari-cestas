-- migration-010: o campo "emoji" das cestas passa a guardar um NOME de ícone Lucide
-- (interface 100% sem emoji). Idempotente e aditiva — só altera a coluna emoji.

-- 1) alargar a coluna (nomes como 'shopping-basket' têm mais de 10 chars) + default
ALTER TABLE cestas_config ALTER COLUMN emoji TYPE VARCHAR(40);
ALTER TABLE cestas_config ALTER COLUMN emoji SET DEFAULT 'shopping-basket';

-- 2) converter emojis existentes -> nome de ícone Lucide
UPDATE cestas_config SET emoji = CASE emoji
    WHEN '🍚' THEN 'shopping-basket'
    WHEN '🛒' THEN 'shopping-basket'
    WHEN '🧺' THEN 'shopping-basket'
    WHEN '👑' THEN 'crown'
    WHEN '💝' THEN 'gift'
    WHEN '🎁' THEN 'gift'
    WHEN '📦' THEN 'package'
    WHEN '🧸' THEN 'package'
    ELSE emoji
END
WHERE emoji IS NOT NULL;

-- 3) qualquer valor que não seja um nome de ícone válido (ainda emoji/vazio) -> cesta
UPDATE cestas_config SET emoji = 'shopping-basket'
WHERE emoji IS NULL OR emoji = '' OR emoji !~ '^[a-z][a-z-]+$';

-- 4) limpar emoji das TAGS (ex.: '⭐ PREMIUM' -> 'PREMIUM') — tag aparece na UI
UPDATE cestas_config SET tag = btrim(regexp_replace(tag,
    '[☀-➿⬀-⯿⌀-⏿←-⇿️]|[\U0001F000-\U0001FAFF]', '', 'g'))
WHERE tag ~ '[☀-➿⬀-⯿️]|[\U0001F000-\U0001FAFF]';
