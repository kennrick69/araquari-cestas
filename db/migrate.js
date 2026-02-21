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

        if (!check.rows[0].exists) {
            console.log('Criando tabelas...');
            const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
            await pool.query(schema);
            console.log('Tabelas criadas com sucesso!');
        } else {
            console.log('Tabelas ja existem.');
        }

        // Rodar migracoes adicionais
        const migrations = ['migration-002-gateway.sql', 'migration-003-email.sql'];
        for (const file of migrations) {
            const filePath = path.join(__dirname, file);
            if (fs.existsSync(filePath)) {
                try {
                    const sql = fs.readFileSync(filePath, 'utf8');
                    await pool.query(sql);
                    console.log('Migracao aplicada: ' + file);
                } catch(e) {
                    // Ignora erros de colunas ja existentes
                    if (!e.message.includes('already exists')) {
                        console.error('Erro na migracao ' + file + ':', e.message);
                    }
                }
            }
        }

    } catch (err) {
        console.error('Erro na migracao:', err.message);
    }
}

module.exports = migrate;
