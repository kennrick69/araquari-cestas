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

// Servir uploads (documentos)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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

        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`;
        const response = await fetch(url, {
            headers: { 'User-Agent': 'AraquariCestas/1.0 (delivery app)' }
        });
        const data = await response.json();
        res.json(data);
    } catch(err) {
        res.status(500).json({ error: 'Erro ao geocodificar', address: {} });
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
            headers: { 'User-Agent': 'AraquariCestas/1.0 (delivery app)' }
        });
        let data = await response.json();

        // Fallback: if no results, try appending region
        if(!data.length) {
            const query2 = encodeURIComponent(q + ', Santa Catarina');
            const url2 = `https://nominatim.openstreetmap.org/search?format=json&q=${query2}&limit=5&addressdetails=1&countrycodes=br`;
            const response2 = await fetch(url2, {
                headers: { 'User-Agent': 'AraquariCestas/1.0 (delivery app)' }
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

    // Auto-criar tabelas se nao existirem
    const migrate = require('./db/migrate');
    await migrate();
});
