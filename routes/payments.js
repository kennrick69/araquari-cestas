const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const mp = require('../services/mercadopago');

// ══════════════════════════════════════
// GET /api/pagamento/public-key — Frontend precisa da public key
// ══════════════════════════════════════
router.get('/public-key', (req, res) => {
    res.json({ publicKey: process.env.MP_PUBLIC_KEY || '' });
});

// ══════════════════════════════════════
// POST /api/pagamento/pix/:codigo — Gerar PIX
// ══════════════════════════════════════
router.post('/pix/:codigo', async (req, res) => {
    try {
        if (!mp.isConfigured()) {
            return res.status(503).json({ error: 'Gateway de pagamento nao configurado' });
        }

        const result = await pool.query('SELECT * FROM pedidos WHERE codigo = $1', [req.params.codigo]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Pedido nao encontrado' });

        const pedido = result.rows[0];
        const pix = await mp.criarPix(pedido);

        await pool.query(
            'UPDATE pedidos SET gateway_id = $1, gateway_data = $2 WHERE codigo = $3',
            [String(pix.paymentId), JSON.stringify(pix), pedido.codigo]
        );

        console.log(`PIX gerado para ${pedido.codigo}: payment_id=${pix.paymentId}`);

        res.json({
            success: true,
            qrcode: pix.qrcode,
            qrcodeBase64: pix.qrcodeBase64,
            ticketUrl: pix.ticketUrl,
            valor: pix.valor,
            expiracao: pix.expiracao
        });

    } catch (err) {
        console.error('Erro ao gerar PIX:', err.message);
        res.status(500).json({ error: 'Erro ao gerar PIX: ' + err.message });
    }
});

// ══════════════════════════════════════
// POST /api/pagamento/boleto/:codigo — Gerar boleto
// ══════════════════════════════════════
router.post('/boleto/:codigo', async (req, res) => {
    try {
        if (!mp.isConfigured()) {
            return res.status(503).json({ error: 'Gateway de pagamento nao configurado' });
        }

        const { dias } = req.body;
        const result = await pool.query('SELECT * FROM pedidos WHERE codigo = $1', [req.params.codigo]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Pedido nao encontrado' });

        const pedido = result.rows[0];
        const boleto = await mp.criarBoleto(pedido, dias || 3);

        await pool.query(
            'UPDATE pedidos SET gateway_id = $1, gateway_data = $2 WHERE codigo = $3',
            [String(boleto.paymentId), JSON.stringify(boleto), pedido.codigo]
        );

        console.log(`Boleto gerado para ${pedido.codigo}: payment_id=${boleto.paymentId}, venc=${boleto.vencimento}`);

        res.json({
            success: true,
            boletoUrl: boleto.boletoUrl,
            barcode: boleto.barcode,
            vencimento: boleto.vencimento,
            valor: boleto.valor
        });

    } catch (err) {
        console.error('Erro ao gerar boleto:', err.message);
        res.status(500).json({ error: 'Erro ao gerar boleto: ' + err.message });
    }
});

// ══════════════════════════════════════
// POST /api/pagamento/cartao/:codigo — Cobrar cartao
// ══════════════════════════════════════
router.post('/cartao/:codigo', async (req, res) => {
    try {
        if (!mp.isConfigured()) {
            return res.status(503).json({ error: 'Gateway de pagamento nao configurado' });
        }

        const { token, parcelas, email } = req.body;
        if (!token) return res.status(400).json({ error: 'Token do cartao obrigatorio' });

        const result = await pool.query('SELECT * FROM pedidos WHERE codigo = $1', [req.params.codigo]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Pedido nao encontrado' });

        const pedido = result.rows[0];
        const cartao = await mp.criarCartao(pedido, token, parcelas || 1, email);

        const novoStatus = cartao.status === 'approved' ? 'confirmado' : 'novo';
        const pagStatus = cartao.status === 'approved' ? 'aprovado' : 'pendente';

        await pool.query(
            'UPDATE pedidos SET gateway_id = $1, gateway_data = $2, pagamento_status = $3, status = $4 WHERE codigo = $5',
            [String(cartao.paymentId), JSON.stringify(cartao), pagStatus, novoStatus, pedido.codigo]
        );

        if (novoStatus !== pedido.status) {
            await pool.query(
                'INSERT INTO pedidos_log (pedido_id, status_anterior, status_novo, observacao) VALUES ($1, $2, $3, $4)',
                [pedido.id, pedido.status, novoStatus, `Cartao ${cartao.status} (${cartao.statusDetail})`]
            );
        }

        console.log(`Cartao para ${pedido.codigo}: status=${cartao.status}, parcelas=${cartao.parcelas}`);

        res.json({
            success: true,
            status: cartao.status,
            statusDetail: cartao.statusDetail,
            parcelas: cartao.parcelas
        });

    } catch (err) {
        console.error('Erro ao cobrar cartao:', err.message);
        res.status(500).json({ error: 'Erro ao processar cartao: ' + err.message });
    }
});

// ══════════════════════════════════════
// GET /api/pagamento/status/:codigo — Verificar status pagamento
// ══════════════════════════════════════
router.get('/status/:codigo', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM pedidos WHERE codigo = $1', [req.params.codigo]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Pedido nao encontrado' });

        const pedido = result.rows[0];
        if (!pedido.gateway_id) {
            return res.json({ status: pedido.pagamento_status, mp_status: null });
        }

        const payment = await mp.consultarPagamento(pedido.gateway_id);

        if (payment.status === 'approved' && pedido.pagamento_status !== 'aprovado') {
            await pool.query(
                'UPDATE pedidos SET pagamento_status = $1, status = $2 WHERE id = $3',
                ['aprovado', 'confirmado', pedido.id]
            );
            await pool.query(
                'INSERT INTO pedidos_log (pedido_id, status_anterior, status_novo, observacao) VALUES ($1, $2, $3, $4)',
                [pedido.id, pedido.status, 'confirmado', `Pagamento ${pedido.pagamento_metodo} confirmado`]
            );
        }

        res.json({
            status: payment.status,
            statusDetail: payment.status_detail,
            pagamentoAprovado: payment.status === 'approved'
        });

    } catch (err) {
        console.error('Erro ao consultar pagamento:', err.message);
        res.status(500).json({ error: 'Erro ao consultar: ' + err.message });
    }
});

// ══════════════════════════════════════
// POST /api/pagamento/webhook — Webhook Mercado Pago
// ══════════════════════════════════════
router.post('/webhook', async (req, res) => {
    try {
        console.log('Webhook MP recebido:', JSON.stringify(req.body));

        const { type, data } = req.body;

        if (type === 'payment' && data?.id) {
            const payment = await mp.consultarPagamento(data.id);
            const paymentId = String(payment.id);

            const result = await pool.query(
                'SELECT * FROM pedidos WHERE gateway_id = $1', [paymentId]
            );

            if (result.rows.length > 0) {
                const pedido = result.rows[0];

                if (payment.status === 'approved' && pedido.pagamento_status !== 'aprovado') {
                    await pool.query(
                        'UPDATE pedidos SET pagamento_status = $1, status = $2 WHERE id = $3',
                        ['aprovado', 'confirmado', pedido.id]
                    );
                    await pool.query(
                        'INSERT INTO pedidos_log (pedido_id, status_anterior, status_novo, observacao) VALUES ($1, $2, $3, $4)',
                        [pedido.id, pedido.status, 'confirmado', 'Pagamento confirmado via webhook MP']
                    );
                    console.log(`Webhook: Pagamento confirmado ${pedido.codigo}`);
                }
            }
        }

        res.status(200).json({ ok: true });
    } catch (err) {
        console.error('Erro webhook:', err.message);
        res.status(200).json({ ok: true });
    }
});

router.get('/webhook', (req, res) => res.status(200).json({ ok: true }));

// ══════════════════════════════════════
// POST /api/pagamento/reembolso/:codigo — Reembolso
// ══════════════════════════════════════
router.post('/reembolso/:codigo', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM pedidos WHERE codigo = $1', [req.params.codigo]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Pedido nao encontrado' });

        const pedido = result.rows[0];
        if (!pedido.gateway_id) return res.status(400).json({ error: 'Sem pagamento registrado' });

        const refund = await mp.reembolsar(pedido.gateway_id, req.body.amount || null);

        await pool.query(
            'UPDATE pedidos SET pagamento_status = $1, status = $2 WHERE id = $3',
            ['reembolsado', 'cancelado', pedido.id]
        );
        await pool.query(
            'INSERT INTO pedidos_log (pedido_id, status_anterior, status_novo, observacao) VALUES ($1, $2, $3, $4)',
            [pedido.id, pedido.status, 'cancelado', `Reembolso: R$ ${refund.amount || pedido.total}`]
        );

        res.json({ success: true, refund });
    } catch (err) {
        console.error('Erro reembolso:', err.message);
        res.status(500).json({ error: 'Erro ao reembolsar: ' + err.message });
    }
});

module.exports = router;
