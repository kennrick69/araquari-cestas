// ══════════════════════════════════════════════════════════════════
// routes/rotas.js — Sistema de rotas para entregadores
//
// Exporta dois routers:
//   • admin   → montado em /api/admin/rotas (protegido por requireAdmin)
//   • publico → montado em /api/rota (link do entregador, SEM login,
//               autenticado pelo token aleatório da própria rota)
//
// Nenhuma API paga: agrupamento e ordenação vêm de services/routing.js
// (haversine + nearest-neighbor + 2-opt).
// ══════════════════════════════════════════════════════════════════

const express = require('express');
const crypto = require('crypto');
const pool = require('../db/pool');
const routing = require('../services/routing');

// Status de pedido elegíveis pra entrega (têm lat/lng e já estão pagos/prontos).
const STATUS_ENTREGAVEL = ['confirmado', 'separacao', 'pronto', 'a_caminho'];

function toNum(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : null; }
function temGeo(p) { const la = toNum(p.latitude), ln = toNum(p.longitude); return la && ln && la !== 0 && ln !== 0; }

// Lê a config de rotas (origem + raio) de app_config, com defaults.
async function lerConfig() {
    const r = await pool.query(
        "SELECT chave, valor FROM app_config WHERE chave IN ('rota_origem_lat','rota_origem_lng','rota_origem_label','rota_raio_km')"
    );
    const c = {}; r.rows.forEach(row => { c[row.chave] = row.valor; });
    return {
        origem_lat: toNum(c.rota_origem_lat) ?? -26.3706,
        origem_lng: toNum(c.rota_origem_lng) ?? -48.7219,
        origem_label: c.rota_origem_label || 'Loja — Araquari',
        raio_km: toNum(c.rota_raio_km) ?? 2
    };
}

// ════════════════════════════════════════════
// ROUTER ADMIN
// ════════════════════════════════════════════
const admin = express.Router();

// GET /config — ponto de saída + raio de agrupamento
admin.get('/config', async (req, res) => {
    try { res.json(await lerConfig()); }
    catch (err) { console.error('rotas/config GET:', err.message); res.status(500).json({ error: 'Erro ao ler config de rotas' }); }
});

// PUT /config — salva ponto de saída + raio
admin.put('/config', async (req, res) => {
    try {
        const { origem_lat, origem_lng, origem_label, raio_km } = req.body;
        const pares = [
            ['rota_origem_lat', toNum(origem_lat)],
            ['rota_origem_lng', toNum(origem_lng)],
            ['rota_origem_label', origem_label],
            ['rota_raio_km', toNum(raio_km)]
        ];
        for (const [chave, valor] of pares) {
            if (valor === null || valor === undefined) continue;
            await pool.query(
                `INSERT INTO app_config (chave, valor, atualizado_em) VALUES ($1,$2,NOW())
                 ON CONFLICT (chave) DO UPDATE SET valor = $2, atualizado_em = NOW()`,
                [chave, String(valor)]
            );
        }
        res.json({ success: true, config: await lerConfig() });
    } catch (err) { console.error('rotas/config PUT:', err.message); res.status(500).json({ error: 'Erro ao salvar config de rotas' }); }
});

// GET /entregadores — lista entregadores ativos
admin.get('/entregadores', async (req, res) => {
    try {
        const r = await pool.query('SELECT id, nome, telefone FROM entregadores WHERE ativo = true ORDER BY nome ASC');
        res.json({ entregadores: r.rows });
    } catch (err) { console.error('entregadores GET:', err.message); res.status(500).json({ error: 'Erro ao listar entregadores' }); }
});

// POST /entregadores — cadastra entregador
admin.post('/entregadores', async (req, res) => {
    try {
        const nome = (req.body.nome || '').trim();
        const telefone = (req.body.telefone || '').trim();
        if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });
        const r = await pool.query(
            'INSERT INTO entregadores (nome, telefone) VALUES ($1,$2) RETURNING id, nome, telefone',
            [nome, telefone]
        );
        res.json({ success: true, entregador: r.rows[0] });
    } catch (err) { console.error('entregadores POST:', err.message); res.status(500).json({ error: 'Erro ao cadastrar entregador' }); }
});

// DELETE /entregadores/:id — desativa (soft delete)
admin.delete('/entregadores/:id', async (req, res) => {
    try {
        await pool.query('UPDATE entregadores SET ativo = false WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { console.error('entregadores DELETE:', err.message); res.status(500).json({ error: 'Erro ao remover entregador' }); }
});

// GET /pedidos-entrega?raio=2 — pedidos prontos pra entrega, agrupados por região.
// Exclui pedidos já atribuídos a uma rota ativa.
admin.get('/pedidos-entrega', async (req, res) => {
    try {
        const cfg = await lerConfig();
        const raio = toNum(req.query.raio) ?? cfg.raio_km;

        const r = await pool.query(
            `SELECT * FROM pedidos
              WHERE status = ANY($1)
                AND id NOT IN (
                    SELECT rp.pedido_id FROM rota_paradas rp
                    JOIN rotas ro ON ro.id = rp.rota_id
                    WHERE ro.status = 'ativa'
                )
              ORDER BY criado_em ASC`,
            [STATUS_ENTREGAVEL]
        );

        const comGeo = [];
        const semGeo = [];
        for (const p of r.rows) (temGeo(p) ? comGeo : semGeo).push(p);

        const pontos = comGeo.map(p => ({ lat: toNum(p.latitude), lng: toNum(p.longitude) }));
        const clusters = routing.agrupar(pontos, raio);

        const grupos = clusters.map((idxs, gi) => {
            const pedidos = idxs.map(i => ({ ...comGeo[i], grupo: gi }));
            const bairros = [...new Set(pedidos.map(p => (p.endereco_bairro || '').trim()).filter(Boolean))];
            const c = routing.centro(idxs.map(i => pontos[i]));
            return { id: gi, centro: c, bairros, total: pedidos.length, pedidos };
        });

        res.json({
            origem: { lat: cfg.origem_lat, lng: cfg.origem_lng, label: cfg.origem_label },
            raio,
            total: comGeo.length,
            grupos,
            semGeo: semGeo.map(p => ({ id: p.id, codigo: p.codigo, recebedor_nome: p.recebedor_nome, endereco_bairro: p.endereco_bairro }))
        });
    } catch (err) { console.error('pedidos-entrega:', err.message); res.status(500).json({ error: 'Erro ao agrupar pedidos: ' + err.message }); }
});

// POST /gerar — cria rota com a melhor ordem de paradas a partir da loja.
// body: { pedido_ids:[...], entregador_id? , entregador_nome?, entregador_telefone? }
admin.post('/gerar', async (req, res) => {
    const client = await pool.connect();
    try {
        const ids = Array.isArray(req.body.pedido_ids) ? req.body.pedido_ids.map(Number).filter(Boolean) : [];
        if (!ids.length) return res.status(400).json({ error: 'Selecione ao menos um pedido' });

        const cfg = await lerConfig();

        // Resolve entregador (por id, ou cria/usa nome avulso)
        let entId = req.body.entregador_id ? Number(req.body.entregador_id) : null;
        let entNome = (req.body.entregador_nome || '').trim();
        let entTel = (req.body.entregador_telefone || '').trim();
        if (entId) {
            const e = await client.query('SELECT nome, telefone FROM entregadores WHERE id = $1', [entId]);
            if (e.rows.length) { entNome = e.rows[0].nome; entTel = e.rows[0].telefone || entTel; }
        }
        if (!entNome) return res.status(400).json({ error: 'Escolha ou informe o entregador' });

        // Carrega pedidos elegíveis, com geo, ainda não atribuídos a rota ativa
        const r = await client.query(
            `SELECT * FROM pedidos
              WHERE id = ANY($1) AND status = ANY($2)
                AND id NOT IN (
                    SELECT rp.pedido_id FROM rota_paradas rp
                    JOIN rotas ro ON ro.id = rp.rota_id WHERE ro.status = 'ativa'
                )`,
            [ids, STATUS_ENTREGAVEL]
        );
        const pedidos = r.rows.filter(temGeo);
        if (!pedidos.length) return res.status(400).json({ error: 'Nenhum pedido válido (sem localização ou já em outra rota)' });

        // Ordena paradas (nearest neighbor + 2-opt) a partir da loja
        const origem = { lat: cfg.origem_lat, lng: cfg.origem_lng };
        const comGeo = pedidos.map(p => ({ ...p, lat: toNum(p.latitude), lng: toNum(p.longitude) }));
        const ordenados = routing.ordenar(origem, comGeo);

        const token = crypto.randomBytes(24).toString('base64url'); // 32 chars url-safe
        const expira = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await client.query('BEGIN');
        const ins = await client.query(
            `INSERT INTO rotas (token, entregador_id, entregador_nome, entregador_telefone, origem_lat, origem_lng, origem_label, expira_em)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            [token, entId, entNome, entTel, origem.lat, origem.lng, cfg.origem_label, expira]
        );
        const rotaId = ins.rows[0].id;
        for (let i = 0; i < ordenados.length; i++) {
            await client.query(
                'INSERT INTO rota_paradas (rota_id, pedido_id, ordem) VALUES ($1,$2,$3)',
                [rotaId, ordenados[i].id, i + 1]
            );
        }
        await client.query('COMMIT');

        res.json({
            success: true,
            rota: {
                id: rotaId, token, entregador_nome: entNome, entregador_telefone: entTel,
                expira_em: expira, total: ordenados.length,
                distancia_km: Math.round(routing.distanciaTotal(origem, ordenados) * 10) / 10
            },
            paradas: ordenados.map((p, i) => ({ ordem: i + 1, codigo: p.codigo, recebedor_nome: p.recebedor_nome, endereco_bairro: p.endereco_bairro }))
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('gerar rota:', err.message);
        res.status(500).json({ error: 'Erro ao gerar rota: ' + err.message });
    } finally { client.release(); }
});

// GET / — lista rotas (ativas primeiro) com progresso
admin.get('/', async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT ro.*,
                    (SELECT COUNT(*) FROM rota_paradas p WHERE p.rota_id = ro.id) AS total,
                    (SELECT COUNT(*) FROM rota_paradas p WHERE p.rota_id = ro.id AND p.entregue) AS entregues
               FROM rotas ro
              WHERE ro.status <> 'cancelada'
              ORDER BY (ro.status='ativa') DESC, ro.criado_em DESC
              LIMIT 50`
        );
        res.json({ rotas: r.rows });
    } catch (err) { console.error('listar rotas:', err.message); res.status(500).json({ error: 'Erro ao listar rotas' }); }
});

// GET /:id — detalhe de uma rota (visão admin)
admin.get('/:id', async (req, res) => {
    try {
        const ro = await pool.query('SELECT * FROM rotas WHERE id = $1', [req.params.id]);
        if (!ro.rows.length) return res.status(404).json({ error: 'Rota não encontrada' });
        const paradas = await pool.query(
            `SELECT rp.ordem, rp.entregue, rp.entregue_em, p.*
               FROM rota_paradas rp JOIN pedidos p ON p.id = rp.pedido_id
              WHERE rp.rota_id = $1 ORDER BY rp.ordem ASC`,
            [req.params.id]
        );
        res.json({ rota: ro.rows[0], paradas: paradas.rows });
    } catch (err) { console.error('detalhe rota:', err.message); res.status(500).json({ error: 'Erro ao carregar rota' }); }
});

// PATCH /:id — trocar entregador ou cancelar
admin.patch('/:id', async (req, res) => {
    try {
        const { entregador_id, status } = req.body;
        const sets = []; const vals = []; let i = 1;
        if (entregador_id !== undefined) {
            const e = await pool.query('SELECT nome, telefone FROM entregadores WHERE id = $1', [entregador_id]);
            if (!e.rows.length) return res.status(404).json({ error: 'Entregador não encontrado' });
            sets.push(`entregador_id = $${i++}`); vals.push(entregador_id);
            sets.push(`entregador_nome = $${i++}`); vals.push(e.rows[0].nome);
            sets.push(`entregador_telefone = $${i++}`); vals.push(e.rows[0].telefone || '');
        }
        if (status && ['ativa', 'concluida', 'cancelada'].includes(status)) {
            sets.push(`status = $${i++}`); vals.push(status);
        }
        if (!sets.length) return res.status(400).json({ error: 'Nada para atualizar' });
        vals.push(req.params.id);
        const r = await pool.query(`UPDATE rotas SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals);
        if (!r.rows.length) return res.status(404).json({ error: 'Rota não encontrada' });
        res.json({ success: true, rota: r.rows[0] });
    } catch (err) { console.error('patch rota:', err.message); res.status(500).json({ error: 'Erro ao atualizar rota' }); }
});

// DELETE /:id — desfazer rota (libera os pedidos pra reagrupar)
admin.delete('/:id', async (req, res) => {
    try {
        const r = await pool.query('DELETE FROM rotas WHERE id = $1 RETURNING id', [req.params.id]);
        if (!r.rows.length) return res.status(404).json({ error: 'Rota não encontrada' });
        res.json({ success: true });
    } catch (err) { console.error('delete rota:', err.message); res.status(500).json({ error: 'Erro ao excluir rota' }); }
});

// ════════════════════════════════════════════
// ROUTER PÚBLICO (link do entregador, sem login)
// ════════════════════════════════════════════
const publico = express.Router();

async function carregarRotaPorToken(token) {
    const ro = await pool.query('SELECT * FROM rotas WHERE token = $1', [token]);
    if (!ro.rows.length) return null;
    const rota = ro.rows[0];
    const paradas = await pool.query(
        `SELECT rp.ordem, rp.entregue, rp.entregue_em,
                p.id AS pedido_id, p.codigo, p.recebedor_nome, p.recebedor_telefone,
                p.endereco_rua, p.endereco_numero, p.endereco_complemento, p.endereco_referencia,
                p.endereco_bairro, p.endereco_cidade, p.latitude, p.longitude,
                p.cesta_nome, p.quantidade, p.status
           FROM rota_paradas rp JOIN pedidos p ON p.id = rp.pedido_id
          WHERE rp.rota_id = $1 ORDER BY rp.ordem ASC`,
        [rota.id]
    );
    return { rota, paradas: paradas.rows };
}

function expirada(rota) {
    return rota.expira_em && new Date(rota.expira_em).getTime() < Date.now();
}

// GET /:token — dados da rota pro app do entregador
publico.get('/:token', async (req, res) => {
    try {
        const data = await carregarRotaPorToken(req.params.token);
        if (!data) return res.status(404).json({ error: 'Rota não encontrada' });
        const { rota, paradas } = data;
        const ativa = rota.status === 'ativa' && !expirada(rota);
        res.json({
            ativa,
            status: expirada(rota) && rota.status === 'ativa' ? 'expirada' : rota.status,
            entregador_nome: rota.entregador_nome,
            origem: { lat: toNum(rota.origem_lat), lng: toNum(rota.origem_lng), label: rota.origem_label },
            criado_em: rota.criado_em,
            expira_em: rota.expira_em,
            paradas
        });
    } catch (err) { console.error('rota publica GET:', err.message); res.status(500).json({ error: 'Erro ao carregar rota' }); }
});

// POST /:token/entregue — marca uma parada como entregue (atualiza o pedido)
// body: { pedido_id }
publico.post('/:token/entregue', async (req, res) => {
    const client = await pool.connect();
    try {
        const pedidoId = Number(req.body.pedido_id);
        if (!pedidoId) return res.status(400).json({ error: 'pedido_id obrigatório' });

        const ro = await client.query('SELECT * FROM rotas WHERE token = $1', [req.params.token]);
        if (!ro.rows.length) return res.status(404).json({ error: 'Rota não encontrada' });
        const rota = ro.rows[0];
        if (rota.status !== 'ativa') return res.status(409).json({ error: 'Rota não está ativa' });
        if (expirada(rota)) return res.status(409).json({ error: 'Rota expirada' });

        const parada = await client.query(
            'SELECT * FROM rota_paradas WHERE rota_id = $1 AND pedido_id = $2',
            [rota.id, pedidoId]
        );
        if (!parada.rows.length) return res.status(404).json({ error: 'Parada não pertence a esta rota' });

        await client.query('BEGIN');
        await client.query(
            'UPDATE rota_paradas SET entregue = true, entregue_em = NOW() WHERE rota_id = $1 AND pedido_id = $2',
            [rota.id, pedidoId]
        );
        // Atualiza o pedido → entregue (cliente vê no app), com log
        const ped = await client.query('SELECT status FROM pedidos WHERE id = $1', [pedidoId]);
        const anterior = ped.rows.length ? ped.rows[0].status : null;
        await client.query('UPDATE pedidos SET status = $1 WHERE id = $2', ['entregue', pedidoId]);
        await client.query(
            'INSERT INTO pedidos_log (pedido_id, status_anterior, status_novo, observacao) VALUES ($1,$2,$3,$4)',
            [pedidoId, anterior, 'entregue', 'Entregue pelo entregador (rota ' + rota.id + ')']
        );

        // Se todas as paradas foram entregues → conclui a rota
        const restantes = await client.query(
            'SELECT COUNT(*) AS n FROM rota_paradas WHERE rota_id = $1 AND NOT entregue',
            [rota.id]
        );
        let concluida = false;
        if (parseInt(restantes.rows[0].n) === 0) {
            await client.query("UPDATE rotas SET status = 'concluida', concluida_em = NOW() WHERE id = $1", [rota.id]);
            concluida = true;
        }
        await client.query('COMMIT');
        res.json({ success: true, concluida });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('rota entregue:', err.message);
        res.status(500).json({ error: 'Erro ao marcar entrega' });
    } finally { client.release(); }
});

module.exports = { admin, publico };
