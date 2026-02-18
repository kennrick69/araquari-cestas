const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// ══════════════════════════════════════
// Middleware: autenticação admin simples (token)
// ══════════════════════════════════════
function authAdmin(req, res, next) {
    const token = req.headers['x-admin-token'] || req.query.token;
    if (!token || token !== process.env.ADMIN_TOKEN) {
        return res.status(401).json({ error: 'Acesso não autorizado' });
    }
    next();
}

router.use(authAdmin);

// ══════════════════════════════════════
// GET /api/admin/dashboard — KPIs
// ══════════════════════════════════════
router.get('/dashboard', async (req, res) => {
    try {
        const hoje = new Date().toISOString().slice(0, 10);

        const [totais, hoje_stats, por_status, por_cesta] = await Promise.all([
            pool.query(`SELECT 
                COUNT(*) as total_pedidos,
                COALESCE(SUM(total), 0) as receita_total,
                COUNT(CASE WHEN status = 'analise' THEN 1 END) as pendentes_analise
            FROM pedidos`),

            pool.query(`SELECT 
                COUNT(*) as pedidos_hoje,
                COALESCE(SUM(total), 0) as receita_hoje
            FROM pedidos WHERE DATE(criado_em) = $1`, [hoje]),

            pool.query(`SELECT status, COUNT(*) as qtd FROM pedidos GROUP BY status ORDER BY qtd DESC`),

            pool.query(`SELECT cesta_tipo, cesta_nome, COUNT(*) as qtd, SUM(total) as receita 
                FROM pedidos GROUP BY cesta_tipo, cesta_nome ORDER BY qtd DESC`)
        ]);

        res.json({
            total_pedidos: parseInt(totais.rows[0].total_pedidos),
            receita_total: parseFloat(totais.rows[0].receita_total),
            pendentes_analise: parseInt(totais.rows[0].pendentes_analise),
            pedidos_hoje: parseInt(hoje_stats.rows[0].pedidos_hoje),
            receita_hoje: parseFloat(hoje_stats.rows[0].receita_hoje),
            por_status: por_status.rows,
            por_cesta: por_cesta.rows
        });

    } catch (err) {
        console.error('❌ Erro dashboard:', err);
        res.status(500).json({ error: 'Erro ao carregar dashboard' });
    }
});

// ══════════════════════════════════════
// GET /api/admin/pedidos — Listar pedidos (com filtros)
// ══════════════════════════════════════
router.get('/pedidos', async (req, res) => {
    try {
        const { status, cesta, busca, limite, pagina } = req.query;
        const lim = Math.min(parseInt(limite) || 50, 100);
        const offset = ((parseInt(pagina) || 1) - 1) * lim;

        let where = [];
        let params = [];
        let idx = 1;

        if (status) {
            where.push(`status = $${idx++}`);
            params.push(status);
        }
        if (cesta) {
            where.push(`cesta_tipo = $${idx++}`);
            params.push(cesta);
        }
        if (busca) {
            where.push(`(codigo ILIKE $${idx} OR recebedor_nome ILIKE $${idx} OR recebedor_telefone ILIKE $${idx})`);
            params.push(`%${busca}%`);
            idx++;
        }

        const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

        const countResult = await pool.query(
            `SELECT COUNT(*) FROM pedidos ${whereClause}`, params
        );

        params.push(lim, offset);
        const result = await pool.query(
            `SELECT * FROM pedidos ${whereClause} ORDER BY criado_em DESC LIMIT $${idx++} OFFSET $${idx++}`,
            params
        );

        res.json({
            pedidos: result.rows,
            total: parseInt(countResult.rows[0].count),
            pagina: parseInt(pagina) || 1,
            limite: lim
        });

    } catch (err) {
        console.error('❌ Erro ao listar pedidos:', err);
        res.status(500).json({ error: 'Erro ao listar pedidos' });
    }
});

// ══════════════════════════════════════
// GET /api/admin/pedidos/:id — Detalhe do pedido
// ══════════════════════════════════════
router.get('/pedidos/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM pedidos WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Pedido não encontrado' });
        }

        const log = await pool.query(
            'SELECT * FROM pedidos_log WHERE pedido_id = $1 ORDER BY criado_em ASC',
            [req.params.id]
        );

        res.json({ pedido: result.rows[0], historico: log.rows });

    } catch (err) {
        console.error('❌ Erro ao buscar pedido:', err);
        res.status(500).json({ error: 'Erro ao buscar pedido' });
    }
});

// ══════════════════════════════════════
// PATCH /api/admin/pedidos/:id/status — Atualizar status
// ══════════════════════════════════════
const STATUS_VALIDOS = ['novo', 'confirmado', 'separacao', 'pronto', 'a_caminho', 'entregue', 'cancelado', 'analise', 'aprovado', 'recusado'];

router.patch('/pedidos/:id/status', async (req, res) => {
    try {
        const { status, observacao } = req.body;

        if (!status || !STATUS_VALIDOS.includes(status)) {
            return res.status(400).json({ error: `Status inválido. Válidos: ${STATUS_VALIDOS.join(', ')}` });
        }

        const pedido = await pool.query('SELECT * FROM pedidos WHERE id = $1', [req.params.id]);
        if (pedido.rows.length === 0) {
            return res.status(404).json({ error: 'Pedido não encontrado' });
        }

        const anterior = pedido.rows[0].status;

        // Atualizar status
        let updates = { status };

        // Se aprovando boleto 30 dias
        if (status === 'aprovado' && pedido.rows[0].pagamento_metodo === 'boleto30') {
            updates.pagamento_status = 'aprovado';
        }
        if (status === 'recusado') {
            updates.pagamento_status = 'recusado';
        }
        if (status === 'confirmado') {
            updates.pagamento_status = 'aprovado';
        }

        const sets = Object.entries(updates).map(([k], i) => `${k} = $${i + 2}`);
        const vals = Object.values(updates);

        await pool.query(
            `UPDATE pedidos SET ${sets.join(', ')} WHERE id = $1`,
            [req.params.id, ...vals]
        );

        // Log
        await pool.query(
            `INSERT INTO pedidos_log (pedido_id, status_anterior, status_novo, observacao) VALUES ($1, $2, $3, $4)`,
            [req.params.id, anterior, status, observacao || null]
        );

        console.log(`🔄 Pedido #${req.params.id}: ${anterior} → ${status}`);

        res.json({
            success: true,
            anterior,
            novo: status,
            message: `Status atualizado: ${anterior} → ${status}`
        });

    } catch (err) {
        console.error('❌ Erro ao atualizar status:', err);
        res.status(500).json({ error: 'Erro ao atualizar status' });
    }
});

// ══════════════════════════════════════
// GET /api/admin/config — Configurações
// ══════════════════════════════════════
router.get('/config', async (req, res) => {
    try {
        const result = await pool.query('SELECT chave, valor FROM config');
        const config = {};
        result.rows.forEach(r => { config[r.chave] = r.valor; });
        res.json(config);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao buscar configurações' });
    }
});

// ══════════════════════════════════════
// PUT /api/admin/config — Salvar config
// ══════════════════════════════════════
router.put('/config', async (req, res) => {
    try {
        const entries = Object.entries(req.body);
        for (const [chave, valor] of entries) {
            await pool.query(
                `INSERT INTO config (chave, valor) VALUES ($1, $2) 
                 ON CONFLICT (chave) DO UPDATE SET valor = $2, atualizado_em = CURRENT_TIMESTAMP`,
                [chave, String(valor)]
            );
        }
        res.json({ success: true, message: 'Configurações atualizadas' });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao salvar configurações' });
    }
});

module.exports = router;
