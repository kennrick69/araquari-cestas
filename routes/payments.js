const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const efi = require('../services/efi');

// ══════════════════════════════════════
// POST /api/pagamento/pix/:codigo — Gerar PIX para pedido
// ══════════════════════════════════════
router.post('/pix/:codigo', async (req, res) => {
    try {
        if (!efi.isConfigured()) {
            return res.status(503).json({ error: 'Gateway de pagamento nao configurado' });
        }

        const result = await pool.query('SELECT * FROM pedidos WHERE codigo = $1', [req.params.codigo]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Pedido nao encontrado' });

        const pedido = result.rows[0];
        const pix = await efi.criarPix(pedido);

        // Salvar txid no pedido
        await pool.query(
            'UPDATE pedidos SET gateway_id = $1, gateway_data = $2 WHERE codigo = $3',
            [pix.txid, JSON.stringify(pix), pedido.codigo]
        );

        res.json({
            success: true,
            qrcode: pix.qrcode,
            imagemQrcode: pix.imagemQrcode,
            valor: pix.valor,
            expiracao: pix.expiracao
        });

    } catch (err) {
        console.error('Erro ao gerar PIX:', err);
        res.status(500).json({ error: 'Erro ao gerar PIX: ' + err.message });
    }
});

// ══════════════════════════════════════
// POST /api/pagamento/boleto/:codigo — Gerar boleto
// ══════════════════════════════════════
router.post('/boleto/:codigo', async (req, res) => {
    try {
        if (!efi.isConfigured()) {
            return res.status(503).json({ error: 'Gateway de pagamento nao configurado' });
        }

        const { dias } = req.body; // 3 para boleto normal, 30 para boleto30
        const result = await pool.query('SELECT * FROM pedidos WHERE codigo = $1', [req.params.codigo]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Pedido nao encontrado' });

        const pedido = result.rows[0];
        const boleto = await efi.criarBoleto(pedido, dias || 3);

        await pool.query(
            'UPDATE pedidos SET gateway_id = $1, gateway_data = $2 WHERE codigo = $3',
            [String(boleto.chargeId), JSON.stringify(boleto), pedido.codigo]
        );

        res.json({
            success: true,
            boletoUrl: boleto.boletoUrl,
            boletoBarcode: boleto.boletoBarcode,
            boletoPdf: boleto.boletoPdf,
            vencimento: boleto.vencimento
        });

    } catch (err) {
        console.error('Erro ao gerar boleto:', err);
        res.status(500).json({ error: 'Erro ao gerar boleto: ' + err.message });
    }
});

// ══════════════════════════════════════
// POST /api/pagamento/cartao/:codigo — Cobrar cartao
// ══════════════════════════════════════
router.post('/cartao/:codigo', async (req, res) => {
    try {
        if (!efi.isConfigured()) {
            return res.status(503).json({ error: 'Gateway de pagamento nao configurado' });
        }

        const { payment_token, parcelas } = req.body;
        if (!payment_token) return res.status(400).json({ error: 'Token do cartao obrigatorio' });

        const result = await pool.query('SELECT * FROM pedidos WHERE codigo = $1', [req.params.codigo]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Pedido nao encontrado' });

        const pedido = result.rows[0];
        const cartao = await efi.criarCartao(pedido, payment_token, parcelas || 1);

        await pool.query(
            'UPDATE pedidos SET gateway_id = $1, gateway_data = $2, pagamento_status = $3, status = $4 WHERE codigo = $5',
            [String(cartao.chargeId), JSON.stringify(cartao), 'aprovado', 'confirmado', pedido.codigo]
        );

        // Log
        await pool.query(
            'INSERT INTO pedidos_log (pedido_id, status_anterior, status_novo, observacao) VALUES ($1, $2, $3, $4)',
            [pedido.id, pedido.status, 'confirmado', 'Pagamento cartao aprovado']
        );

        res.json({ success: true, status: cartao.status, parcelas });

    } catch (err) {
        console.error('Erro ao cobrar cartao:', err);
        res.status(500).json({ error: 'Erro ao processar cartao: ' + err.message });
    }
});

// ══════════════════════════════════════
// POST /api/pagamento/webhook — Webhook Efi Bank
// ══════════════════════════════════════
router.post('/webhook', async (req, res) => {
    try {
        console.log('Webhook recebido:', JSON.stringify(req.body));

        // PIX webhook
        if (req.body.pix) {
            for (const pix of req.body.pix) {
                const txid = pix.txid;
                if (!txid) continue;

                const result = await pool.query(
                    'SELECT * FROM pedidos WHERE gateway_id = $1',
                    [txid]
                );

                if (result.rows.length > 0) {
                    const pedido = result.rows[0];
                    await pool.query(
                        'UPDATE pedidos SET pagamento_status = $1, status = $2 WHERE id = $3',
                        ['aprovado', 'confirmado', pedido.id]
                    );
                    await pool.query(
                        'INSERT INTO pedidos_log (pedido_id, status_anterior, status_novo, observacao) VALUES ($1, $2, $3, $4)',
                        [pedido.id, pedido.status, 'confirmado', 'PIX confirmado via webhook']
                    );
                    console.log(`PIX confirmado para pedido ${pedido.codigo}`);
                }
            }
        }

        // Boleto/Cartao webhook (notification)
        if (req.body.notification) {
            const token = req.body.notification;
            // Consultar detalhes da notificacao na Efi
            // efi.consultarNotificacao(token) - implementar se necessario
            console.log('Notificacao Efi:', token);
        }

        res.status(200).json({ ok: true });

    } catch (err) {
        console.error('Erro no webhook:', err);
        res.status(200).json({ ok: true }); // Sempre 200 para webhook
    }
});

// Webhook PIX (GET para verificacao)
router.get('/webhook', (req, res) => {
    res.status(200).json({ ok: true });
});

module.exports = router;
