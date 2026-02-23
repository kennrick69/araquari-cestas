-- Tabela de configuração das cestas (editável pelo admin)
CREATE TABLE IF NOT EXISTS cestas_config (
    id SERIAL PRIMARY KEY,
    tipo VARCHAR(50) NOT NULL UNIQUE,
    nome VARCHAR(100) NOT NULL,
    preco DECIMAL(10,2) NOT NULL DEFAULT 0,
    emoji VARCHAR(10) DEFAULT '🍚',
    descricao VARCHAR(200) DEFAULT '',
    cor VARCHAR(50) DEFAULT 'var(--green)',
    imagem VARCHAR(200) DEFAULT '',
    embalagem VARCHAR(200) DEFAULT '',
    itens JSONB NOT NULL DEFAULT '[]',
    ativo BOOLEAN DEFAULT true,
    ordem INT DEFAULT 0,
    atualizado_em TIMESTAMP DEFAULT NOW()
);

-- Inserir cestas padrão se tabela estiver vazia
INSERT INTO cestas_config (tipo, nome, preco, emoji, descricao, cor, imagem, embalagem, itens, ordem)
SELECT 'x', 'Cesta X', 1.00, '🍚', 'Essencial · 11 itens', 'var(--green)', 'assets/img/cesta-x.png', 'Embalagem Saco Plástico Transparente',
    '[{"name":"Açúcar Refinado Especial","qty":"1x 1 kg"},{"name":"Arroz Parboilizado Tipo 1","qty":"2x 1 kg"},{"name":"Biscoito Recheado Chocolate","qty":"1x 140 g"},{"name":"Café em Pó","qty":"1x 500 g"},{"name":"Feijão Carioca Tipo 1","qty":"1x 1 kg"},{"name":"Fubá","qty":"1x 500 g"},{"name":"Macarrão Espaguete com Ovos","qty":"1x 500 g"},{"name":"Molho de Tomate","qty":"1x 340 g"},{"name":"Óleo de Soja PET","qty":"1x 900 ml"},{"name":"Sal Refinado Iodado","qty":"1x 1 kg"},{"name":"Sardinha em Óleo","qty":"1x 125 g"}]'::jsonb,
    1
WHERE NOT EXISTS (SELECT 1 FROM cestas_config WHERE tipo = 'x');

INSERT INTO cestas_config (tipo, nome, preco, emoji, descricao, cor, imagem, embalagem, itens, ordem)
SELECT 'confort', 'Cesta Confort', 2.00, '🛒', 'Família · 14 itens', 'var(--orange)', 'assets/img/cesta-confort.png', 'Caixa de Papelão Corrugado Duplo',
    '[{"name":"Açúcar Refinado Especial","qty":"2x 1 kg"},{"name":"Arroz Parboilizado Tipo 1","qty":"1x 5 kg"},{"name":"Biscoito Sortido","qty":"1x 280 g"},{"name":"Café em Pó","qty":"1x 500 g"},{"name":"Farinha de Milho","qty":"1x 1 kg"},{"name":"Farinha de Trigo","qty":"1x 1 kg"},{"name":"Feijão Preto Tipo 1","qty":"1x 1 kg"},{"name":"Fubá","qty":"1x 1 kg"},{"name":"Macarrão Espaguete com Ovos","qty":"1x 500 g"},{"name":"Macarrão Parafuso com Ovos","qty":"1x 500 g"},{"name":"Molho de Tomate","qty":"1x 340 g"},{"name":"Óleo de Soja PET","qty":"2x 900 ml"},{"name":"Refresco em Pó","qty":"1x 25 g"},{"name":"Sardinha em Óleo","qty":"1x 125 g"}]'::jsonb,
    2
WHERE NOT EXISTS (SELECT 1 FROM cestas_config WHERE tipo = 'confort');

INSERT INTO cestas_config (tipo, nome, preco, emoji, descricao, cor, imagem, embalagem, itens, ordem)
SELECT 'plus', 'Cesta Plus', 3.00, '👑', 'Premium · 33 itens', 'var(--yellow)', 'assets/img/cesta-plus.png', 'Caixas de Papelão Corrugado Duplo',
    '[{"name":"Achocolatado em Pó","qty":"1x 370 g"},{"name":"Açúcar Cristal","qty":"1x 5 kg"},{"name":"Água Sanitária","qty":"1x 1 l"},{"name":"Arroz Parboilizado Tipo 1","qty":"1x 5 kg"},{"name":"Biscoito Recheado Chocolate","qty":"1x 140 g"},{"name":"Café em Pó","qty":"1x 500 g"},{"name":"Creme Dental","qty":"2x 70 g"},{"name":"Creme de Leite UHT","qty":"1x 200 g"},{"name":"Desinfetante","qty":"1x 500 ml"},{"name":"Detergente Neutro","qty":"2x 500 ml"},{"name":"Ervilha em Conserva","qty":"1x 200 g"},{"name":"Esponja Dupla Face","qty":"1x unid"},{"name":"Farinha de Milho","qty":"1x 1 kg"},{"name":"Farinha de Trigo","qty":"1x 1 kg"},{"name":"Farofa Temperada","qty":"1x 250 g"},{"name":"Feijão Preto Tipo 1","qty":"2x 1 kg"},{"name":"Fubá","qty":"1x 1 kg"},{"name":"Gelatina","qty":"1x 20 g"},{"name":"Lã de Aço","qty":"1x 60 g"},{"name":"Leite Condensado","qty":"1x 395 g"},{"name":"Macarrão Espaguete com Ovos","qty":"2x 500 g"},{"name":"Macarrão Parafuso com Ovos","qty":"1x 500 g"},{"name":"Milho Verde em Conserva","qty":"1x 170 g"},{"name":"Molho de Tomate","qty":"2x 300 g"},{"name":"Óleo de Soja PET","qty":"2x 900 ml"},{"name":"Papel Higiênico 4 Rolos","qty":"1x 4x30 m"},{"name":"Polenta Preparo Rápido","qty":"1x 500 g"},{"name":"Pudim em Pó","qty":"1x 50 g"},{"name":"Refresco em Pó","qty":"2x 25 g"},{"name":"Sabão em Pó","qty":"1x 1 kg"},{"name":"Sabonete","qty":"2x 90 g"},{"name":"Sal Refinado Iodado","qty":"1x 1 kg"},{"name":"Sardinha em Óleo","qty":"1x 125 g"}]'::jsonb,
    3
WHERE NOT EXISTS (SELECT 1 FROM cestas_config WHERE tipo = 'plus');
