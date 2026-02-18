const pool = require('./pool');
const fs = require('fs');
const path = require('path');

async function migrate() {
    try {
        console.log('Verificando banco de dados...');

        // Checar se tabela pedidos existe
        const check = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'pedidos'
            )
        `);

        if (check.rows[0].exists) {
            console.log('Tabelas ja existem. Pulando migracao.');
            return;
        }

        console.log('Criando tabelas...');

        const schema = fs.readFileSync(
            path.join(__dirname, 'schema.sql'),
            'utf8'
        );

        await pool.query(schema);
        console.log('Tabelas criadas com sucesso!');

    } catch (err) {
        console.error('Erro na migracao:', err.message);
    }
}

module.exports = migrate;
