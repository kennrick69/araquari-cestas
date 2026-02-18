const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const upload = require('../middleware/upload');

// ══════════════════════════════════════
// Gerar código do pedido: AC-20260218-0001
// ══════════════════════════════════════
async function gerarCodigo() {
    const hoje = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prefixo = `AC-${hoje}-`;

    const result = await pool.query(
        `SELECT codigo FROM pedidos WHERE codigo LIKE $1 ORDER BY id DESC LIMIT 1`,
        [`${prefixo}%`]
    );

    let seq = 1;
    if (result.rows.length > 0) {
        const ultimo = result.rows[0].codigo;
        seq = parseInt(ultimo.split('-').pop()) + 1;
    }

    return `${prefixo}${String(seq).padStart(4, '0')}`;
}

// ══════════════════════════════════════
// POST /api/pedidos — Criar pedido
// ══════════════════════════════════════
router.post('/', async (req, res) => {
    try {
        const {
            cesta_tipo, cesta_nome, cesta_preco, quantidade,
            endereco_rua, endereco_numero, endereco_complemento,
            endereco_referencia, endereco_bairro, endereco_cidade,
            endereco_estado, latitude, longitude,
            recebedor_nome, recebedor_telefone,
            pagamento_metodo, desconto, total, cpf
        } = req.body;

        // Validações básicas
        if (!cesta_tipo || !recebedor_nome || !recebedor_telefone || !pagamento_metodo) {
            return res.status(400).json({ error: 'Campos obrigatórios: cesta_tipo, recebedor_nome, recebedor_telefone, pagamento_metodo' });
        }

        const codigo = await gerarCodigo();

        // Status inicial conforme método de pagamento
        let status = 'novo';
        let pagamento_status = 'pendente';

        if (pagamento_metodo === 'boleto30') {
            status = 'analise';
        } else if (pagamento_metodo === 'pix') {
            // PIX: aguarda confirmação via webhook
            status = 'novo';
        }

        const result = await pool.query(
            `INSERT INTO pedidos (
                codigo, cesta_tipo, cesta_nome, cesta_preco, quantidade,
                endereco_rua, endereco_numero, endereco_complemento,
                endereco_referencia, endereco_bairro, endereco_cidade,
                endereco_estado, latitude, longitude,
                recebedor_nome, recebedor_telefone,
                pagamento_metodo, pagamento_status, desconto, total,
                cpf, status
            ) VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
            ) RETURNING *`,
            [
                codigo, cesta_tipo, cesta_nome, cesta_preco, quantidade || 1,
                endereco_rua, endereco_numero, endereco_complemento,
                endereco_referencia, endereco_bairro, endereco_cidade || 'Araquari',
                endereco_estado || 'SC', latitude, longitude,
                recebedor_nome, recebedor_telefone,
                pagamento_metodo, pagamento_status, desconto || 0, total,
                cpf || null, status
            ]
        );

        const pedido = result.rows[0];

        // Registrar no log
        await pool.query(
            `INSERT INTO pedidos_log (pedido_id, status_novo, observacao) VALUES ($1, $2, $3)`,
            [pedido.id, status, 'Pedido criado']
        );

        console.log(`📦 Novo pedido: ${codigo} | ${cesta_nome} | ${pagamento_metodo} | R$ ${total}`);

        res.status(201).json({
            success: true,
            pedido: {
                codigo: pedido.codigo,
                status: pedido.status,
                total: pedido.total,
                pagamento_metodo: pedido.pagamento_metodo,
                criado_em: pedido.criado_em
            }
        });

    } catch (err) {
        console.error('❌ Erro ao criar pedido:', err);
        res.status(500).json({ error: 'Erro interno ao criar pedido' });
    }
});

// ══════════════════════════════════════
// POST /api/pedidos/:codigo/documentos — Upload de docs (boleto 30d)
// ══════════════════════════════════════
router.post('/:codigo/documentos',
    upload.fields([
        { name: 'doc_identidade', maxCount: 1 },
        { name: 'doc_residencia', maxCount: 1 }
    ]),
    async (req, res) => {
        try {
            const { codigo } = req.params;

            const pedido = await pool.query('SELECT * FROM pedidos WHERE codigo = $1', [codigo]);
            if (pedido.rows.length === 0) {
                return res.status(404).json({ error: 'Pedido não encontrado' });
            }

            const updates = {};
            if (req.files['doc_identidade']) {
                updates.doc_identidade = req.files['doc_identidade'][0].filename;
            }
            if (req.files['doc_residencia']) {
                updates.doc_residencia = req.files['doc_residencia'][0].filename;
            }

            if (Object.keys(updates).length > 0) {
                const sets = Object.entries(updates).map(([k, v], i) => `${k} = $${i + 2}`);
                const vals = Object.values(updates);

                await pool.query(
                    `UPDATE pedidos SET ${sets.join(', ')} WHERE codigo = $1`,
                    [codigo, ...vals]
                );
            }

            console.log(`📎 Docs recebidos para pedido ${codigo}`);
            res.json({ success: true, message: 'Documentos recebidos' });

        } catch (err) {
            console.error('❌ Erro ao salvar documentos:', err);
            res.status(500).json({ error: 'Erro ao salvar documentos' });
        }
    }
);

// ══════════════════════════════════════
// GET /api/pedidos/:codigo — Consultar pedido
// ══════════════════════════════════════
router.get('/:codigo', async (req, res) => {
    try {
        const { codigo } = req.params;
        const result = await pool.query(
            `SELECT codigo, cesta_nome, cesta_tipo, cesta_preco, quantidade,
                    endereco_rua, endereco_numero, endereco_bairro, endereco_cidade,
                    recebedor_nome, recebedor_telefone,
                    pagamento_metodo, pagamento_status, desconto, total,
                    status, criado_em, atualizado_em
             FROM pedidos WHERE codigo = $1`,
            [codigo]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Pedido não encontrado' });
        }

        // Buscar log de status
        const log = await pool.query(
            `SELECT status_novo, observacao, criado_em FROM pedidos_log 
             WHERE pedido_id = (SELECT id FROM pedidos WHERE codigo = $1)
             ORDER BY criado_em ASC`,
            [codigo]
        );

        res.json({
            pedido: result.rows[0],
            historico: log.rows
        });

    } catch (err) {
        console.error('❌ Erro ao buscar pedido:', err);
        res.status(500).json({ error: 'Erro ao buscar pedido' });
    }
});

// ══════════════════════════════════════
// GET /api/pedidos/telefone/:tel — Pedidos por telefone
// ══════════════════════════════════════
router.get('/telefone/:tel', async (req, res) => {
    try {
        const tel = req.params.tel.replace(/\D/g, '');
        const result = await pool.query(
            `SELECT codigo, cesta_nome, total, status, criado_em
             FROM pedidos 
             WHERE REPLACE(REPLACE(REPLACE(recebedor_telefone, '(', ''), ')', ''), '-', '') LIKE $1
             ORDER BY criado_em DESC
             LIMIT 20`,
            [`%${tel}%`]
        );

        res.json({ pedidos: result.rows });

    } catch (err) {
        console.error('❌ Erro ao buscar por telefone:', err);
        res.status(500).json({ error: 'Erro ao buscar pedidos' });
    }
});

module.exports = router;
