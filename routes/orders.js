const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const upload = require('../middleware/upload');

// Lê a config de "Pagar na entrega" de app_config, com defaults seguros.
async function lerConfigEntrega() {
    const r = await pool.query(
        "SELECT chave, valor FROM app_config WHERE chave IN ('entrega_ativo','entrega_dinheiro','entrega_pix','entrega_cartao','entrega_max_pedido','entrega_parcelamento','entrega_parcelas_max','entrega_acrescimo_pct')"
    );
    const c = {}; r.rows.forEach(row => { c[row.chave] = row.valor; });
    const on = (v, def) => (v === undefined || v === null || v === '') ? def : (v === '1' || v === 'true' || v === 'on');
    const num = (v, def) => { const n = parseFloat(v); return Number.isFinite(n) ? n : def; };
    return {
        ativo: on(c.entrega_ativo, true),
        dinheiro: on(c.entrega_dinheiro, true),
        pix: on(c.entrega_pix, true),
        cartao: on(c.entrega_cartao, true),
        max: Math.max(0, num(c.entrega_max_pedido, 0)),
        parcelamento: on(c.entrega_parcelamento, true),
        parcelas_max: Math.max(2, Math.round(num(c.entrega_parcelas_max, 3))),
        acrescimo_pct: Math.max(0, num(c.entrega_acrescimo_pct, 10))
    };
}

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
            pagamento_metodo, desconto, total, cpf, email,
            entrega_forma, entrega_cartao_tipo, entrega_troco_para
        } = req.body;

        // Validações básicas
        if (!cesta_tipo || !recebedor_nome || !recebedor_telefone || !pagamento_metodo) {
            return res.status(400).json({ error: 'Campos obrigatórios: cesta_tipo, recebedor_nome, recebedor_telefone, pagamento_metodo' });
        }

        const qtd = Math.max(1, parseInt(quantidade) || 1);
        let totalNum = parseFloat(total);
        let descontoNum = Math.max(0, parseFloat(desconto) || 0);
        const ehEntrega = pagamento_metodo === 'entrega';
        if (ehEntrega) descontoNum = 0; // pagar na entrega nunca tem desconto de PIX

        if (!(totalNum > 0)) {
            return res.status(400).json({ error: 'Total inválido' });
        }

        // Preço unitário confiável (do catálogo) — preenchido no bloco anti-tamper abaixo.
        let precoUnitConfiavel = null;

        // ── Anti-tampering de preço ──────────────────────────────
        // A cobrança (PIX/boleto/cartão) usa o `total` gravado no banco.
        // Para cestas de catálogo (não "custom"/doação livre) recalculamos
        // o valor a partir de cestas_config e rejeitamos totais suspeitos,
        // impedindo que o cliente pague um centavo por uma cesta cara.
        if (cesta_tipo !== 'custom') {
            try {
                const cfg = await pool.query(
                    'SELECT preco FROM cestas_config WHERE tipo = $1 AND ativo = true',
                    [cesta_tipo]
                );
                if (cfg.rows.length > 0) {
                    const precoUnit = parseFloat(cfg.rows[0].preco);
                    precoUnitConfiavel = precoUnit;
                    const esperado = precoUnit * qtd - descontoNum;
                    // tolerância de R$1 (arredondamentos) e desconto não pode exceder o subtotal
                    if (descontoNum > precoUnit * qtd) {
                        return res.status(400).json({ error: 'Desconto inválido' });
                    }
                    if (totalNum < esperado - 1) {
                        console.warn(`PRICE TAMPER bloqueado: tipo=${cesta_tipo} qtd=${qtd} enviado=${totalNum} esperado>=${esperado}`);
                        return res.status(400).json({ error: 'Valor do pedido não confere com a tabela de preços' });
                    }
                    // Normaliza o total para o valor confiável do servidor
                    totalNum = precoUnit * qtd - descontoNum;
                }
            } catch (e) {
                console.warn('Validação de preço ignorada (cestas_config indisponível):', e.message);
            }
        }

        // ── Pagar na entrega ─────────────────────────────────────────────
        // O servidor é a fonte da verdade: recalcula o total (e o acréscimo do
        // parcelamento) a partir do preço de catálogo + config, nunca confia no
        // valor enviado pelo cliente. Grava a forma, o troco e a quebra do valor.
        let entrega = {
            flag: false, forma: null, cartao_tipo: null, parcelas: null,
            troco_para: null, troco_valor: null, valor_original: null, acrescimo: null
        };
        if (ehEntrega) {
            const ecfg = await lerConfigEntrega();
            if (!ecfg.ativo) return res.status(400).json({ error: 'Pagamento na entrega está desabilitado' });

            const forma = String(entrega_forma || '').toLowerCase();
            if (!['dinheiro', 'pix', 'cartao'].includes(forma)) {
                return res.status(400).json({ error: 'Forma de pagamento na entrega inválida' });
            }
            if (forma === 'dinheiro' && !ecfg.dinheiro) return res.status(400).json({ error: 'Dinheiro na entrega está desabilitado' });
            if (forma === 'pix' && !ecfg.pix) return res.status(400).json({ error: 'Pix na entrega está desabilitado' });
            if (forma === 'cartao' && !ecfg.cartao) return res.status(400).json({ error: 'Cartão na entrega está desabilitado' });

            // Base = subtotal confiável (catálogo quando disponível; senão o enviado)
            const base = precoUnitConfiavel != null
                ? precoUnitConfiavel * qtd
                : Math.round((parseFloat(cesta_preco) || 0) * qtd * 100) / 100;
            if (!(base > 0)) return res.status(400).json({ error: 'Valor do pedido inválido para pagamento na entrega' });

            if (ecfg.max > 0 && base > ecfg.max + 0.001) {
                return res.status(400).json({ error: `Pagamento na entrega disponível apenas para pedidos até R$ ${ecfg.max.toFixed(2)}` });
            }

            let cartaoTipo = null, parcelas = null, acrescimo = 0, totalEntrega = base;
            if (forma === 'cartao') {
                cartaoTipo = String(entrega_cartao_tipo || '').toLowerCase();
                if (!['debito', 'credito', 'credito3x'].includes(cartaoTipo)) {
                    return res.status(400).json({ error: 'Tipo de cartão inválido' });
                }
                if (cartaoTipo === 'credito3x') {
                    if (!ecfg.parcelamento) return res.status(400).json({ error: 'Parcelamento desabilitado' });
                    parcelas = ecfg.parcelas_max;
                    acrescimo = Math.round(base * (ecfg.acrescimo_pct / 100) * 100) / 100;
                    totalEntrega = Math.round((base + acrescimo) * 100) / 100;
                }
            }

            let trocoPara = null, trocoValor = null;
            if (forma === 'dinheiro') {
                const tp = parseFloat(entrega_troco_para);
                if (Number.isFinite(tp) && tp > 0) {
                    if (tp < base - 0.001) return res.status(400).json({ error: 'Valor para troco não pode ser menor que o total' });
                    trocoPara = Math.round(tp * 100) / 100;
                    trocoValor = Math.round((trocoPara - base) * 100) / 100;
                } else {
                    trocoPara = null;      // cliente tem o valor certo
                    trocoValor = 0;
                }
            }

            totalNum = totalEntrega;
            entrega = {
                flag: true, forma, cartao_tipo: cartaoTipo, parcelas,
                troco_para: trocoPara, troco_valor: trocoValor,
                valor_original: base, acrescimo
            };
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
        } else if (ehEntrega) {
            // Pedido confirmado, mas o pagamento só acontece na entrega.
            status = 'confirmado';
            pagamento_status = 'na_entrega';
        }

        // Mapa de estados para sigla
        const ESTADOS = {'Acre':'AC','Alagoas':'AL','Amapá':'AP','Amazonas':'AM','Bahia':'BA','Ceará':'CE','Distrito Federal':'DF','Espírito Santo':'ES','Goiás':'GO','Maranhão':'MA','Mato Grosso':'MT','Mato Grosso do Sul':'MS','Minas Gerais':'MG','Pará':'PA','Paraíba':'PB','Paraná':'PR','Pernambuco':'PE','Piauí':'PI','Rio de Janeiro':'RJ','Rio Grande do Norte':'RN','Rio Grande do Sul':'RS','Rondônia':'RO','Roraima':'RR','Santa Catarina':'SC','São Paulo':'SP','Sergipe':'SE','Tocantins':'TO'};
        const uf = ESTADOS[endereco_estado] || (endereco_estado && endereco_estado.length === 2 ? endereco_estado.toUpperCase() : 'SC');

        const result = await pool.query(
            `INSERT INTO pedidos (
                codigo, cesta_tipo, cesta_nome, cesta_preco, quantidade,
                endereco_rua, endereco_numero, endereco_complemento,
                endereco_referencia, endereco_bairro, endereco_cidade,
                endereco_estado, latitude, longitude,
                recebedor_nome, recebedor_telefone,
                pagamento_metodo, pagamento_status, desconto, total,
                cpf, email, status,
                entrega_pagamento, entrega_forma, entrega_cartao_tipo, entrega_parcelas,
                entrega_troco_para, entrega_troco_valor, entrega_valor_original, entrega_acrescimo
            ) VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
                $24,$25,$26,$27,$28,$29,$30,$31
            ) RETURNING *`,
            [
                codigo, cesta_tipo, cesta_nome, cesta_preco, qtd,
                endereco_rua, endereco_numero, endereco_complemento,
                endereco_referencia, endereco_bairro, endereco_cidade || 'Araquari',
                uf, latitude, longitude,
                recebedor_nome, recebedor_telefone,
                pagamento_metodo, pagamento_status, descontoNum, totalNum,
                cpf || null, email || null, status,
                entrega.flag, entrega.forma, entrega.cartao_tipo, entrega.parcelas,
                entrega.troco_para, entrega.troco_valor, entrega.valor_original, entrega.acrescimo
            ]
        );

        const pedido = result.rows[0];

        // Registrar no log
        await pool.query(
            `INSERT INTO pedidos_log (pedido_id, status_novo, observacao) VALUES ($1, $2, $3)`,
            [pedido.id, status, 'Pedido criado']
        );

        console.log(`Novo pedido: ${codigo} | ${cesta_nome} | ${pagamento_metodo} | R$ ${totalNum}`);

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
        console.error('Erro ao criar pedido:', err);
        res.status(500).json({ error: 'Erro interno ao criar pedido', detail: err.message });
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

            const ped = pedido.rows[0];

            // ── Anti-IDOR (código é sequencial/enumerável) ───────────
            // 1) Só aceita docs enquanto o pedido está em análise (boleto 30d).
            // 2) Nunca sobrescreve um documento já enviado — impede terceiro
            //    de trocar os docs de outro cliente antes da análise do admin.
            if (ped.status !== 'analise') {
                return res.status(409).json({ error: 'Este pedido não está aguardando documentos' });
            }

            const updates = {};
            if (req.files['doc_identidade'] && !ped.doc_identidade) {
                updates.doc_identidade = req.files['doc_identidade'][0].filename;
            }
            if (req.files['doc_residencia'] && !ped.doc_residencia) {
                updates.doc_residencia = req.files['doc_residencia'][0].filename;
            }

            if (Object.keys(updates).length === 0 && (ped.doc_identidade || ped.doc_residencia)) {
                return res.status(409).json({ error: 'Documentos já enviados para este pedido' });
            }

            if (Object.keys(updates).length > 0) {
                const sets = Object.entries(updates).map(([k, v], i) => `${k} = $${i + 2}`);
                const vals = Object.values(updates);

                await pool.query(
                    `UPDATE pedidos SET ${sets.join(', ')} WHERE codigo = $1`,
                    [codigo, ...vals]
                );
            }

            console.log(`Docs recebidos para pedido ${codigo}`);
            res.json({ success: true, message: 'Documentos recebidos' });

        } catch (err) {
            console.error('Erro ao salvar documentos:', err);
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
                    entrega_pagamento, entrega_forma, entrega_cartao_tipo, entrega_parcelas,
                    entrega_troco_para, entrega_troco_valor, entrega_valor_original, entrega_acrescimo,
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
        console.error('Erro ao buscar pedido:', err);
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
        console.error('Erro ao buscar por telefone:', err);
        res.status(500).json({ error: 'Erro ao buscar pedidos' });
    }
});

module.exports = router;
