require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
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
