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

        const { dias, cpf, email, payer_address } = req.body;
        const result = await pool.query('SELECT * FROM pedidos WHERE codigo = $1', [req.params.codigo]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Pedido nao encontrado' });

        const pedido = result.rows[0];
        if (cpf) pedido.cpf = cpf;
        if (email) pedido.email = email;
        if (payer_address) pedido.payer_address = payer_address;

        // Save CPF and email to database
        const updates = [];
        const vals = [];
        let idx = 1;
        if (cpf) { updates.push(`cpf = $${idx++}`); vals.push(cpf); }
        if (email) { updates.push(`email = $${idx++}`); vals.push(email); }
        if (updates.length > 0) {
            vals.push(pedido.codigo);
            await pool.query(`UPDATE pedidos SET ${updates.join(', ')} WHERE codigo = $${idx}`, vals);
        }

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

        const { token, parcelas, email, cpf, payment_method_id, issuer_id, payer_address } = req.body;
        if (!token) return res.status(400).json({ error: 'Token do cartao obrigatorio' });

        const result = await pool.query('SELECT * FROM pedidos WHERE codigo = $1', [req.params.codigo]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Pedido nao encontrado' });

        const pedido = result.rows[0];
        if (cpf) pedido.cpf = cpf;
        if (email) pedido.email = email;
        if (payment_method_id) pedido.card_payment_method = payment_method_id;
        if (issuer_id) pedido.card_issuer_id = issuer_id;
        if (payer_address) pedido.payer_address = payer_address;

        // Save CPF/email to database
        if (cpf || email) {
            const updates = [];
            const vals = [];
            let idx = 1;
            if (cpf) { updates.push(`cpf = $${idx++}`); vals.push(cpf); }
            if (email) { updates.push(`email = $${idx++}`); vals.push(email); }
            vals.push(pedido.codigo);
            await pool.query(`UPDATE pedidos SET ${updates.join(', ')} WHERE codigo = $${idx}`, vals);
        }

        const cartao = await mp.criarCartao(pedido, token, parcelas || 1, email);

        const isApproved = cartao.status === 'approved';
        const novoStatus = isApproved ? 'confirmado' : 'novo';
        const pagStatus = isApproved ? 'aprovado' : (cartao.status === 'rejected' ? 'rejeitado' : 'pendente');

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

        console.log(`Cartao para ${pedido.codigo}: status=${cartao.status}, detail=${cartao.statusDetail}, parcelas=${cartao.parcelas}`);

        if (!isApproved) {
            return res.status(400).json({
                success: false,
                status: cartao.status,
                statusDetail: cartao.statusDetail,
                error: `Pagamento ${cartao.status}: ${cartao.statusDetail}`
            });
        }

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
        console.log('=== WEBHOOK MP RECEBIDO ===');
        console.log('Headers:', JSON.stringify(req.headers['x-signature'] ? 'has-signature' : 'no-signature'));
        console.log('Body:', JSON.stringify(req.body));
        console.log('Query:', JSON.stringify(req.query));

        // Handle different webhook formats
        const { type, data, action } = req.body;
        
        // Also check query params (MP sometimes sends id and topic in URL)
        const queryId = req.query.id || req.query['data.id'];
        const queryTopic = req.query.topic || req.query.type;

        let paymentIdFromWebhook = null;

        if (type === 'payment' && data?.id) {
            paymentIdFromWebhook = String(data.id);
        } else if (action && action.startsWith('payment.') && data?.id) {
            paymentIdFromWebhook = String(data.id);
        } else if (queryTopic === 'payment' && queryId) {
            paymentIdFromWebhook = String(queryId);
        }

        console.log('Payment ID extraido:', paymentIdFromWebhook);

        if (paymentIdFromWebhook) {
            if (!mp.isConfigured()) {
                console.log('WEBHOOK: MP nao configurado');
                return res.status(200).json({ ok: true });
            }

            const payment = await mp.consultarPagamento(paymentIdFromWebhook);
            console.log('WEBHOOK: Payment status do MP:', payment.status, payment.status_detail);
            console.log('WEBHOOK: Payment ID:', payment.id, 'External ref:', payment.external_reference);

            const paymentId = String(payment.id);

            // Try finding by gateway_id first
            let result = await pool.query(
                'SELECT * FROM pedidos WHERE gateway_id = $1', [paymentId]
            );

            // Fallback: try external_reference (codigo do pedido)
            if (result.rows.length === 0 && payment.external_reference) {
                console.log('WEBHOOK: Nao encontrou por gateway_id, tentando external_reference:', payment.external_reference);
                result = await pool.query(
                    'SELECT * FROM pedidos WHERE codigo = $1', [payment.external_reference]
                );
            }

            // Fallback: try most recent order with matching amount
            if (result.rows.length === 0) {
                console.log('WEBHOOK: Nao encontrou por external_reference, tentando por valor:', payment.transaction_amount);
                result = await pool.query(
                    "SELECT * FROM pedidos WHERE status = 'novo' AND total = $1 ORDER BY criado_em DESC LIMIT 1",
                    [payment.transaction_amount]
                );
            }

            if (result.rows.length > 0) {
                const pedido = result.rows[0];
                console.log('WEBHOOK: Pedido encontrado:', pedido.codigo, 'status atual:', pedido.status, 'pag_status:', pedido.pagamento_status);

                // Update gateway_id if not set
                if (!pedido.gateway_id) {
                    await pool.query('UPDATE pedidos SET gateway_id = $1 WHERE id = $2', [paymentId, pedido.id]);
                    console.log('WEBHOOK: gateway_id atualizado para', paymentId);
                }

                if (payment.status === 'approved' && pedido.pagamento_status !== 'aprovado') {
                    await pool.query(
                        'UPDATE pedidos SET pagamento_status = $1, status = $2, gateway_id = $3 WHERE id = $4',
                        ['aprovado', 'confirmado', paymentId, pedido.id]
                    );
                    await pool.query(
                        'INSERT INTO pedidos_log (pedido_id, status_anterior, status_novo, observacao) VALUES ($1, $2, $3, $4)',
                        [pedido.id, pedido.status, 'confirmado', `Pagamento confirmado via webhook MP (${payment.payment_type_id || 'unknown'})`]
                    );
                    console.log(`WEBHOOK: ✅ Pagamento CONFIRMADO ${pedido.codigo}`);
                } else if (payment.status === 'rejected') {
                    await pool.query(
                        "UPDATE pedidos SET pagamento_status = 'rejeitado', gateway_data = $1 WHERE id = $2",
                        [JSON.stringify({status: payment.status, detail: payment.status_detail}), pedido.id]
                    );
                    console.log(`WEBHOOK: ❌ Pagamento REJEITADO ${pedido.codigo}: ${payment.status_detail}`);
                } else {
                    console.log(`WEBHOOK: Status ${payment.status} para ${pedido.codigo} (sem acao)`);
                }
            } else {
                console.log('WEBHOOK: ⚠️ Pedido NAO encontrado para payment_id:', paymentId);
            }
        } else {
            console.log('WEBHOOK: Tipo nao tratado:', type || action || queryTopic);
        }

        res.status(200).json({ ok: true });
    } catch (err) {
        console.error('WEBHOOK ERRO:', err.message, err.stack);
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
