-- WhatsApp de atendimento da loja (botão "Houve algum imprevisto?" no app).
-- Só insere se ainda não existir; não mexe em nada existente.
INSERT INTO app_config (chave, valor, descricao, tipo)
VALUES ('loja_whatsapp', '(47) 99681-3181', 'WhatsApp de atendimento (botão de imprevisto no app)', 'text')
ON CONFLICT (chave) DO NOTHING;
