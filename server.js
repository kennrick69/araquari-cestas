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

// Servir uploads (documentos) — protegido em produção
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Servir frontend (pasta public)
app.use(express.static(path.join(__dirname, 'public')));

// ══════════════════════════════════════
// Rotas da API
// ══════════════════════════════════════
app.use('/api/pedidos', require('./routes/orders'));
app.use('/api/admin', require('./routes/admin'));

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
