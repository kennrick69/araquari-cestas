const express = require('express');
const multer = require('multer');
const router = express.Router();
const pool = require('../db/pool');

// Upload de imagem de cesta: em memória (vai pro Postgres, não pro disco efêmero).
// Limite 2 MB, só JPG/PNG/WebP. O resize (máx 800px) é feito no servidor com sharp.
const uploadImagemCesta = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
        cb(ok ? null : new Error('Formato inválido. Use JPG, PNG ou WebP.'), ok);
    }
});

// ══════════════════════════════════════
// Middleware: autenticação admin simples (token)
// ══════════════════════════════════════
function authAdmin(req, res, next) {
    // Fail-closed: sem ADMIN_TOKEN configurado, ninguem entra
    if (!process.env.ADMIN_TOKEN) {
        return res.status(503).json({ error: 'Admin não configurado no servidor' });
    }
    // Somente via header (query param vaza token em logs/URL/referer)
    const token = req.headers['x-admin-token'];
    if (!token) {
        return res.status(401).json({ error: 'Acesso não autorizado' });
    }
    if (token === process.env.ADMIN_TOKEN) {
        return next();
    }
    // ── DRIVER_TOKEN (opcional, retrocompatível) ─────────────────
    // Token separado para o entregador (entregador.html): acesso restrito
    // a listar pedidos e avançar status de entrega. NÃO acessa config,
    // credenciais MP, delete de pedidos nem aprovação de boleto.
    // Sem DRIVER_TOKEN configurado, nada muda (entregador usa ADMIN_TOKEN).
    if (process.env.DRIVER_TOKEN && token === process.env.DRIVER_TOKEN) {
        const isGetPermitido = req.method === 'GET' &&
            (req.path === '/dashboard' || req.path === '/pedidos');
        const isStatusEntrega = req.method === 'PATCH' &&
            /^\/pedidos\/\d+\/status$/.test(req.path) &&
            ['separacao', 'pronto', 'a_caminho', 'entregue'].includes(req.body && req.body.status);
        if (isGetPermitido || isStatusEntrega) {
            return next();
        }
        return res.status(403).json({ error: 'Token de entregador não permite esta operação' });
    }
    return res.status(401).json({ error: 'Acesso não autorizado' });
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
                COALESCE(SUM(CASE WHEN status NOT IN ('novo','analise','cancelado') THEN total ELSE 0 END), 0) as receita_total,
                COALESCE(SUM(CASE WHEN status IN ('novo','analise') THEN total ELSE 0 END), 0) as receita_pendente,
                COUNT(CASE WHEN status = 'analise' THEN 1 END) as pendentes_analise,
                COUNT(CASE WHEN status = 'novo' THEN 1 END) as nao_pagos
            FROM pedidos`),

            pool.query(`SELECT 
                COUNT(CASE WHEN status NOT IN ('novo','analise','cancelado') THEN 1 END) as pedidos_hoje,
                COALESCE(SUM(CASE WHEN status NOT IN ('novo','analise','cancelado') THEN total ELSE 0 END), 0) as receita_hoje,
                COALESCE(SUM(CASE WHEN status IN ('novo','analise') THEN total ELSE 0 END), 0) as receita_pendente_hoje
            FROM pedidos WHERE DATE(criado_em) = $1`, [hoje]),

            pool.query(`SELECT status, COUNT(*) as qtd FROM pedidos GROUP BY status ORDER BY qtd DESC`),

            pool.query(`SELECT cesta_tipo, cesta_nome, COUNT(*) as qtd, SUM(total) as receita 
                FROM pedidos GROUP BY cesta_tipo, cesta_nome ORDER BY qtd DESC`)
        ]);

        res.json({
            total_pedidos: parseInt(totais.rows[0].total_pedidos),
            receita_total: parseFloat(totais.rows[0].receita_total),
            receita_pendente: parseFloat(totais.rows[0].receita_pendente),
            pendentes_analise: parseInt(totais.rows[0].pendentes_analise),
            nao_pagos: parseInt(totais.rows[0].nao_pagos),
            pedidos_hoje: parseInt(hoje_stats.rows[0].pedidos_hoje),
            receita_hoje: parseFloat(hoje_stats.rows[0].receita_hoje),
            receita_pendente_hoje: parseFloat(hoje_stats.rows[0].receita_pendente_hoje),
            por_status: por_status.rows,
            por_cesta: por_cesta.rows
        });

    } catch (err) {
        console.error('Erro dashboard:', err);
        res.status(500).json({ error: 'Erro ao carregar dashboard' });
    }
});

// ══════════════════════════════════════
// GET /api/admin/pedidos — Listar pedidos (com filtros)
// ══════════════════════════════════════
router.get('/pedidos', async (req, res) => {
    try {
        const { status, cesta, busca, limite, pagina, excluir_status } = req.query;
        const lim = Math.min(parseInt(limite) || 50, 100);
        const offset = ((parseInt(pagina) || 1) - 1) * lim;

        let where = [];
        let params = [];
        let idx = 1;

        if (status) {
            where.push(`status = $${idx++}`);
            params.push(status);
        }
        if (excluir_status) {
            const excluidos = excluir_status.split(',');
            const placeholders = excluidos.map(() => `$${idx++}`);
            where.push(`status NOT IN (${placeholders.join(',')})`);
            params.push(...excluidos);
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
        console.error('Erro ao listar pedidos:', err);
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
        console.error('Erro ao buscar pedido:', err);
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
        let boletoResult = null;
        let boletoError = null;

        // Se aprovando boleto 30 dias → gerar boleto no MP
        if (status === 'aprovado' && pedido.rows[0].pagamento_metodo === 'boleto30') {
            updates.pagamento_status = 'aprovado';
            updates.status = 'confirmado'; // Pula direto pra confirmado
            
            try {
                const mp = require('../services/mercadopago');
                if (mp.isConfigured()) {
                    boletoResult = await mp.criarBoleto(pedido.rows[0], 30);
                    updates.gateway_id = String(boletoResult.paymentId);
                    updates.gateway_data = JSON.stringify(boletoResult);
                    updates.pagamento_status = 'pendente'; // Aguardando pagamento do boleto
                    console.log(`Boleto 30d gerado para pedido #${req.params.id}: ${boletoResult.boletoUrl}`);
                } else {
                    console.log(`Boleto 30d: MP não configurado, aprovando sem gerar boleto`);
                }
            } catch (boletoErr) {
                console.error('Erro ao gerar boleto 30d:', boletoErr.message || boletoErr);
                // Approve anyway but flag the error - admin can generate boleto later
                boletoError = `Pedido aprovado, mas erro ao gerar boleto: ${boletoErr.message}. Você pode gerar o boleto manualmente depois.`;
            }
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

        const finalStatus = updates.status || status;

        // Log
        await pool.query(
            `INSERT INTO pedidos_log (pedido_id, status_anterior, status_novo, observacao) VALUES ($1, $2, $3, $4)`,
            [req.params.id, anterior, finalStatus, observacao || null]
        );

        console.log(`Pedido #${req.params.id}: ${anterior} → ${finalStatus}`);

        res.json({
            success: true,
            anterior,
            novo: finalStatus,
            message: `Status atualizado: ${anterior} → ${finalStatus}`,
            boletoError: boletoError || null,
            boleto: boletoResult ? {
                url: boletoResult.boletoUrl,
                barcode: boletoResult.barcode,
                vencimento: boletoResult.vencimento,
                valor: boletoResult.valor
            } : null
        });

    } catch (err) {
        console.error('Erro ao atualizar status:', err);
        res.status(500).json({ error: 'Erro ao atualizar status' });
    }
});

// ══════════════════════════════════════
// Helper: valor é apenas eco de máscara (••••XXXX) devolvida pelo GET /config?
// Blindagem anti-destruição acidental de segredos quando o painel ecoa o campo.
function _isMascaraPlaceholder(v) {
    if (typeof v !== 'string') return false;
    const s = v.trim();
    return s.length > 0 && /^[•]+/.test(s);
}

// ══════════════════════════════════════
// DELETE /api/admin/pedidos/:id — Excluir pedido
// ══════════════════════════════════════
router.delete('/pedidos/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM pedidos_log WHERE pedido_id = $1', [req.params.id]);
        const result = await pool.query('DELETE FROM pedidos WHERE id = $1 RETURNING codigo', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Pedido nao encontrado' });
        res.json({ success: true, message: 'Pedido ' + result.rows[0].codigo + ' excluido' });
    } catch (err) {
        console.error('Erro ao excluir:', err.message);
        res.status(500).json({ error: 'Erro ao excluir pedido' });
    }
});

// ══════════════════════════════════════
// CESTAS CONFIG - CRUD
// ══════════════════════════════════════

// GET /api/admin/cestas - listar todas as cestas
router.get('/cestas', async (req, res) => {
    try {
        // Try to create table if not exists
        const tableCheck = await pool.query(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'cestas_config')`);
        if(!tableCheck.rows[0].exists) {
            const fs = require('fs');
            const path = require('path');
            const migPath = path.join(__dirname, '..', 'db', 'migration-004-baskets.sql');
            if(fs.existsSync(migPath)) {
                const sql = fs.readFileSync(migPath, 'utf8');
                await pool.query(sql);
            }
        }
        const result = await pool.query('SELECT * FROM cestas_config ORDER BY ordem ASC');
        res.json({ cestas: result.rows });
    } catch(err) {
        console.error('Erro ao listar cestas:', err.message);
        res.status(500).json({ error: 'Erro ao listar cestas: ' + err.message });
    }
});

// POST /api/admin/cestas - criar cesta do zero
router.post('/cestas', async (req, res) => {
    try {
        let { tipo, nome, preco, emoji, descricao, embalagem, imagem, cor, tag, itens, ativo } = req.body;
        if(!nome || !String(nome).trim()) return res.status(400).json({ error: 'Nome é obrigatório' });

        // tipo: usa o informado, senão gera um slug a partir do nome (sem acento)
        tipo = String(tipo || nome).trim().toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        if(!tipo) return res.status(400).json({ error: 'Tipo inválido (use letras ou números)' });
        if(tipo === 'custom') return res.status(400).json({ error: 'O tipo "custom" é reservado (Doação Livre)' });

        // próxima ordem = depois da última
        const ord = await pool.query('SELECT COALESCE(MAX(ordem),0)+1 AS prox FROM cestas_config');
        const ordem = ord.rows[0].prox;

        const result = await pool.query(
            `INSERT INTO cestas_config (tipo, nome, preco, emoji, descricao, embalagem, imagem, cor, tag, itens, ativo, ordem)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
            [tipo, String(nome).trim(), preco || 0, emoji || '📦', descricao || '', embalagem || '',
             imagem || '', cor || 'var(--green)', tag || '', JSON.stringify(Array.isArray(itens) ? itens : []),
             ativo !== undefined ? ativo : true, ordem]
        );
        res.json({ success: true, cesta: result.rows[0] });
    } catch(err) {
        if(err.code === '23505') return res.status(409).json({ error: 'Já existe uma cesta com esse tipo. Mude o nome/tipo.' });
        console.error('Erro ao criar cesta:', err.message);
        res.status(500).json({ error: 'Erro ao criar cesta: ' + err.message });
    }
});

// PUT /api/admin/cestas-reordenar - aplicar nova ordem (setas subir/descer)
// Hífen (não /cestas/reordenar) pra não colidir com a rota /cestas/:tipo.
router.put('/cestas-reordenar', async (req, res) => {
    const { ordem } = req.body; // [{ tipo, ordem }, ...]
    if(!Array.isArray(ordem)) return res.status(400).json({ error: 'Formato inválido' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for(const it of ordem) {
            await client.query('UPDATE cestas_config SET ordem = $1, atualizado_em = NOW() WHERE tipo = $2', [it.ordem, it.tipo]);
        }
        await client.query('COMMIT');
        res.json({ success: true });
    } catch(err) {
        await client.query('ROLLBACK');
        console.error('Erro ao reordenar cestas:', err.message);
        res.status(500).json({ error: 'Erro ao reordenar: ' + err.message });
    } finally {
        client.release();
    }
});

// PUT /api/admin/cestas/:tipo - atualizar cesta (preço, nome, itens, etc)
router.put('/cestas/:tipo', async (req, res) => {
    try {
        const { tipo } = req.params;
        const { nome, preco, emoji, descricao, embalagem, imagem, cor, tag, itens, ativo, ordem } = req.body;

        const updates = [];
        const values = [];
        let idx = 1;

        if(nome !== undefined) { updates.push(`nome = $${idx++}`); values.push(nome); }
        if(preco !== undefined) { updates.push(`preco = $${idx++}`); values.push(preco); }
        if(emoji !== undefined) { updates.push(`emoji = $${idx++}`); values.push(emoji); }
        if(descricao !== undefined) { updates.push(`descricao = $${idx++}`); values.push(descricao); }
        if(embalagem !== undefined) { updates.push(`embalagem = $${idx++}`); values.push(embalagem); }
        if(imagem !== undefined) { updates.push(`imagem = $${idx++}`); values.push(imagem); }
        if(cor !== undefined) { updates.push(`cor = $${idx++}`); values.push(cor); }
        if(tag !== undefined) { updates.push(`tag = $${idx++}`); values.push(tag); }
        if(itens !== undefined) { updates.push(`itens = $${idx++}`); values.push(JSON.stringify(itens)); }
        if(ativo !== undefined) { updates.push(`ativo = $${idx++}`); values.push(ativo); }
        if(ordem !== undefined) { updates.push(`ordem = $${idx++}`); values.push(ordem); }

        updates.push(`atualizado_em = NOW()`);

        if(updates.length === 1) return res.status(400).json({ error: 'Nenhum campo para atualizar' });

        values.push(tipo);
        const result = await pool.query(
            `UPDATE cestas_config SET ${updates.join(', ')} WHERE tipo = $${idx} RETURNING *`,
            values
        );

        if(result.rows.length === 0) return res.status(404).json({ error: 'Cesta não encontrada' });
        res.json({ success: true, cesta: result.rows[0] });
    } catch(err) {
        console.error('Erro ao atualizar cesta:', err.message);
        res.status(500).json({ error: 'Erro ao atualizar cesta' });
    }
});

// POST /api/admin/cestas/:tipo/imagem - enviar/trocar imagem (multipart, campo "imagem")
// Redimensiona p/ no máx 800px (sharp) e guarda os BYTES no Postgres (sobrevive a deploy).
// Também grava o endpoint público em cestas_config.imagem (campo URL continua como alternativa).
router.post('/cestas/:tipo/imagem', (req, res) => {
    uploadImagemCesta.single('imagem')(req, res, async (err) => {
        if (err) {
            const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Imagem acima de 2 MB.' : err.message;
            return res.status(400).json({ error: msg });
        }
        if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado (campo "imagem").' });
        try {
            const { tipo } = req.params;
            const ex = await pool.query('SELECT 1 FROM cestas_config WHERE tipo = $1', [tipo]);
            if (ex.rows.length === 0) return res.status(404).json({ error: 'Cesta não encontrada' });

            let sharp;
            try { sharp = require('sharp'); }
            catch (e) { return res.status(500).json({ error: 'Processamento de imagem indisponível no servidor.' }); }

            // rotate() aplica a orientação EXIF (fotos de celular) antes do resize.
            const out = await sharp(req.file.buffer, { failOn: 'none' })
                .rotate()
                .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
                .webp({ quality: 82 })
                .toBuffer();
            const meta = await sharp(out).metadata();

            await pool.query(
                `INSERT INTO cesta_imagens (tipo, mime, dados, largura, altura, bytes, atualizado_em)
                 VALUES ($1, 'image/webp', $2, $3, $4, $5, NOW())
                 ON CONFLICT (tipo) DO UPDATE SET mime = 'image/webp', dados = $2,
                   largura = $3, altura = $4, bytes = $5, atualizado_em = NOW()`,
                [tipo, out, meta.width, meta.height, out.length]
            );
            const url = `/api/cestas/${encodeURIComponent(tipo)}/imagem?v=${Date.now()}`;
            await pool.query('UPDATE cestas_config SET imagem = $1, atualizado_em = NOW() WHERE tipo = $2', [url, tipo]);

            res.json({ success: true, imagem: url, largura: meta.width, altura: meta.height, bytes: out.length });
        } catch (e) {
            console.error('Erro no upload de imagem da cesta:', e.message);
            res.status(500).json({ error: 'Erro ao processar imagem: ' + e.message });
        }
    });
});

// DELETE /api/admin/cestas/:tipo/imagem - remover imagem enviada
router.delete('/cestas/:tipo/imagem', async (req, res) => {
    try {
        const { tipo } = req.params;
        await pool.query('DELETE FROM cesta_imagens WHERE tipo = $1', [tipo]);
        // Só limpa o campo se ele apontava pro nosso endpoint (preserva URL externa que o admin tenha posto)
        await pool.query(
            `UPDATE cestas_config SET imagem = '', atualizado_em = NOW()
             WHERE tipo = $1 AND imagem LIKE '/api/cestas/%/imagem%'`, [tipo]);
        res.json({ success: true });
    } catch (e) {
        console.error('Erro ao remover imagem da cesta:', e.message);
        res.status(500).json({ error: 'Erro ao remover imagem' });
    }
});

// ══════════════════════════════════════
// CONFIGURAÇÕES DO SISTEMA
// ══════════════════════════════════════

// GET /api/admin/config - listar todas as configurações
router.get('/config', async (req, res) => {
    try {
        const tableCheck = await pool.query(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'app_config')`);
        if(!tableCheck.rows[0].exists) {
            const fs = require('fs');
            const path = require('path');
            const migPath = path.join(__dirname, '..', 'db', 'migration-005-config.sql');
            if(fs.existsSync(migPath)) {
                await pool.query(fs.readFileSync(migPath, 'utf8'));
            }
        }
        const result = await pool.query('SELECT chave, valor, descricao, tipo FROM app_config ORDER BY chave');
        // Mascarar segredos (access token / secret) — nunca devolver em claro
        const SENSIVEL = /(token|secret|access)/i;
        const rows = result.rows.map(r => {
            if (SENSIVEL.test(r.chave) && r.valor) {
                const v = String(r.valor);
                return { ...r, valor: '', _preenchido: true, _mascara: '••••' + v.slice(-4) };
            }
            return r;
        });
        res.json({ config: rows });
    } catch(err) {
        console.error('Erro ao listar config:', err.message);
        res.status(500).json({ error: 'Erro ao listar configurações: ' + err.message });
    }
});

// PUT /api/admin/config - atualizar configurações (recebe objeto {chave: valor})
router.put('/config', async (req, res) => {
    try {
        const updates = req.body;
        if(!updates || typeof updates !== 'object') {
            return res.status(400).json({ error: 'Envie um objeto com as configurações' });
        }

        let count = 0, skipped = 0;
        for(const [chave, valor] of Object.entries(updates)) {
            // Defense-in-depth: ignora qualquer valor que seja eco de máscara (••••XXXX).
            if (_isMascaraPlaceholder(valor)) { skipped++; continue; }
            // Não permitir atualizar para vazio se já tinha valor (proteção contra limpar sem querer)
            // Mas permitir se realmente quer limpar
            await pool.query(
                `INSERT INTO app_config (chave, valor, atualizado_em) VALUES ($1, $2, NOW())
                 ON CONFLICT (chave) DO UPDATE SET valor = $2, atualizado_em = NOW()`,
                [chave, valor]
            );
            count++;
        }

        // Se atualizou QUALQUER credencial mp_*, recarregar o serviço (sem redeploy)
        const touchedMp = Object.keys(updates).some(k => k.startsWith('mp_'));
        if (touchedMp) {
            try {
                const mp = require('../services/mercadopago');
                await mp.reloadFromDB();
                console.log('[config] Credenciais MP recarregadas do banco após save');
            } catch(e) {
                console.error('[config] Erro ao recarregar MP:', e.message);
            }
        }

        res.json({ success: true, saved: count, skipped, message: `${count} configuração(ões) atualizada(s)${skipped ? ` · ${skipped} máscara(s) ignorada(s)` : ''}` });
    } catch(err) {
        console.error('Erro ao salvar config:', err.message);
        res.status(500).json({ error: 'Erro ao salvar configurações' });
    }
});

// GET /api/admin/config/test-mp — testa EXATAMENTE o access token que o
// checkout vai usar + informa de onde ele veio (banco ou env Railway).
router.get('/config/test-mp', async (req, res) => {
    const mp = require('../services/mercadopago');
    try {
        await mp.reloadFromDB();
        const source = mp.source || 'nenhum';
        const origemLabel = source === 'database'
            ? 'painel admin (banco)'
            : source === 'env'
                ? '⚠️ env MP_ACCESS_TOKEN (Railway) — fallback, cadastre no painel'
                : 'nenhum';

        if(!mp.isConfigured()) {
            return res.json({ success: false, source, message: 'Access Token não configurado em nenhuma fonte' });
        }
        // Chamada real ao MP com o token em uso (confirma que ele vale)
        const result = await mp._request('GET', '/v1/payment_methods');
        // Conta vendedora conectada (identifica de quem é o token)
        let conta = null;
        try {
            const me = await mp._request('GET', '/users/me');
            conta = { id: me.id, nickname: me.nickname, email: me.email };
        } catch(_) { /* não bloqueia o teste se /users/me falhar */ }
        res.json({
            success: true,
            source,
            origem: origemLabel,
            conta,
            message: `Conexão OK · origem: ${origemLabel} · ${result.length} métodos de pagamento`
        });
    } catch(err) {
        res.json({ success: false, source: mp.source || 'desconhecido', message: 'Erro: ' + err.message });
    }
});

module.exports = router;
