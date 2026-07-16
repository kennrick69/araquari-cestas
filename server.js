require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const pool = require('./db/pool');
const PORT = process.env.PORT || 3000;

// ══════════════════════════════════════
// Middleware
// ══════════════════════════════════════
app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'x-admin-token']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ══════════════════════════════════════
// Headers de segurança (sem dependências externas)
// ══════════════════════════════════════
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-XSS-Protection', '0');
    if (process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
    next();
});

// ══════════════════════════════════════
// Rate limiter em memória (por IP + rota), sem dependências
// ══════════════════════════════════════
function rateLimit({ windowMs, max, key }) {
    const hits = new Map();
    setInterval(() => {
        const now = Date.now();
        for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
    }, windowMs).unref?.();
    return (req, res, next) => {
        const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').toString().split(',')[0].trim();
        const id = `${key}:${ip}`;
        const now = Date.now();
        let rec = hits.get(id);
        if (!rec || now - rec.start > windowMs) { rec = { start: now, count: 0 }; hits.set(id, rec); }
        rec.count++;
        if (rec.count > max) {
            return res.status(429).json({ error: 'Muitas requisições. Tente novamente em instantes.' });
        }
        next();
    };
}

// Limites: criação de pedido e endpoints de pagamento (mitiga abuso/enumeração).
// O webhook do Mercado Pago é excluído (MP faz burst/retry e espera 200).
const pagamentoLimiter = rateLimit({ windowMs: 60000, max: 30, key: 'pagamento' });
app.use('/api/pedidos', rateLimit({ windowMs: 60000, max: 20, key: 'pedidos' }));
app.use('/api/pagamento', (req, res, next) => {
    if (req.path.startsWith('/webhook')) return next();
    return pagamentoLimiter(req, res, next);
});

// Servir uploads (documentos de identidade/residência = PII sensível)
// SOMENTE ADMIN: painel busca via fetch com header x-admin-token e exibe como blob.
const { requireAdmin } = require('./middleware/auth');
app.use('/uploads', requireAdmin, express.static(path.join(__dirname, 'uploads')));

// Servir .well-known (TWA Digital Asset Links)
app.use('/.well-known', express.static(path.join(__dirname, 'public', '.well-known'), {
    setHeaders: (res) => { res.setHeader('Content-Type', 'application/json'); }
}));

// Servir frontend (pasta public)
app.use(express.static(path.join(__dirname, 'public')));

// ══════════════════════════════════════
// Rotas da API
// ══════════════════════════════════════
app.use('/api/pedidos', require('./routes/orders'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/pagamento', require('./routes/payments'));

// ══════════════════════════════════════
// Geocode proxy (avoids CORS with Nominatim)
// ══════════════════════════════════════
app.get('/api/geocode', async (req, res) => {
    try {
        const { lat, lng } = req.query;
        if(!lat || !lng) return res.status(400).json({ error: 'lat e lng obrigatorios' });

        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1&zoom=18`;
        const response = await fetch(url, {
            headers: { 'User-Agent': 'AraquariCestas/1.0 (contato@araquaricestas.com)' },
            signal: AbortSignal.timeout(5000)
        });

        if(!response.ok) {
            console.error('Nominatim error:', response.status, response.statusText);
            return res.json({ display_name: `${lat}, ${lng}`, address: {} });
        }

        const data = await response.json();
        res.json(data);
    } catch(err) {
        console.error('Geocode error:', err.message);
        // Return coordinates as fallback instead of 500
        res.json({ display_name: `${req.query.lat}, ${req.query.lng}`, address: {} });
    }
});

// Forward geocode - search address
app.get('/api/geocode/search', async (req, res) => {
    try {
        const { q } = req.query;
        if(!q) return res.status(400).json([]);

        // First try: biased to Araquari region with viewbox (broader area including Joinville/Barra Velha)
        const query = encodeURIComponent(q);
        const viewbox = '-48.85,-26.45,-48.60,-26.30'; // Araquari + surrounding region
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${query}&limit=5&addressdetails=1&countrycodes=br&viewbox=${viewbox}&bounded=0`;
        const response = await fetch(url, {
            headers: { 'User-Agent': 'AraquariCestas/1.0 (contato@araquaricestas.com)' },
            signal: AbortSignal.timeout(5000)
        });
        let data = await response.json();

        // Fallback: if no results, try appending region
        if(!data.length) {
            const query2 = encodeURIComponent(q + ', Santa Catarina');
            const url2 = `https://nominatim.openstreetmap.org/search?format=json&q=${query2}&limit=5&addressdetails=1&countrycodes=br`;
            const response2 = await fetch(url2, {
                headers: { 'User-Agent': 'AraquariCestas/1.0 (contato@araquaricestas.com)' },
                signal: AbortSignal.timeout(5000)
            });
            data = await response2.json();
        }

        res.json(data);
    } catch(err) {
        console.error('Geocode search error:', err.message);
        res.status(500).json([]);
    }
});

// ══════════════════════════════════════
// Cestas config (público - carrega no app)
// ══════════════════════════════════════
app.get('/api/cestas', async (req, res) => {
    try {
        // Check if table exists first
        const tableCheck = await pool.query(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'cestas_config')`);
        if(!tableCheck.rows[0].exists) {
            console.log('Tabela cestas_config nao existe, rodando migracao...');
            const fs = require('fs');
            const migPath = path.join(__dirname, 'db', 'migration-004-baskets.sql');
            if(fs.existsSync(migPath)) {
                const sql = fs.readFileSync(migPath, 'utf8');
                await pool.query(sql);
                console.log('Tabela cestas_config criada com sucesso!');
            }
        }

        const result = await pool.query('SELECT * FROM cestas_config WHERE ativo = true ORDER BY ordem ASC');
        const baskets = {};
        result.rows.forEach(row => {
            baskets[row.tipo] = {
                name: row.nome,
                price: parseFloat(row.preco),
                emoji: row.emoji,
                desc: row.descricao,
                color: row.cor,
                img: row.imagem,
                items: typeof row.itens === 'string' ? JSON.parse(row.itens) : row.itens,
                packaging: row.embalagem
            };
        });
        baskets.custom = { name:"Doação Livre", price:0, emoji:"💝", desc:"Valor personalizado", color:"var(--red)", img:"", items:[], packaging:"—" };
        res.json(baskets);
    } catch(err) {
        console.error('Erro ao carregar cestas:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ══════════════════════════════════════
// Health check
// ══════════════════════════════════════
app.get('/api/health', async (req, res) => {
    try {
        const pool = require('./db/pool');
        const dbCheck = await pool.query('SELECT NOW()');
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            db: dbCheck.rows[0].now
        });
    } catch (err) {
        res.status(500).json({ status: 'error', db: 'desconectado' });
    }
});

// ══════════════════════════════════════
// Fallback → frontend
// ══════════════════════════════════════
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ══════════════════════════════════════
// Start
// ══════════════════════════════════════
app.listen(PORT, async () => {
    console.log('');
    console.log('========================================');
    console.log('   ARAQUARI CESTAS - API');
    console.log('   Rodando na porta ' + PORT);
    console.log('========================================');
    console.log('');

    // Avisos de segurança no boot
    if (!process.env.ADMIN_TOKEN) {
        console.warn('[SEGURANCA] ADMIN_TOKEN NAO configurado — painel admin fica BLOQUEADO (fail-closed).');
    } else if (process.env.ADMIN_TOKEN.length < 20) {
        console.warn('[SEGURANCA] ADMIN_TOKEN curto (<20 chars) — use um token forte e aleatorio.');
    }
    if (!process.env.MP_WEBHOOK_SECRET) {
        console.warn('[SEGURANCA] MP_WEBHOOK_SECRET nao configurado — assinatura do webhook NAO sera verificada. Configure em produção.');
    }

    // Auto-criar tabelas se nao existirem
    const migrate = require('./db/migrate');
    await migrate();
});
