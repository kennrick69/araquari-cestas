const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
    console.error('Erro inesperado no pool PostgreSQL:', err);
});

// Testar conexão
pool.query('SELECT NOW()')
    .then(() => console.log('PostgreSQL conectado'))
    .catch(err => console.error('Falha ao conectar PostgreSQL:', err.message));

module.exports = pool;
