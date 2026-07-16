// ══════════════════════════════════════
// Autenticacao admin compartilhada (token via header)
// ══════════════════════════════════════
function requireAdmin(req, res, next) {
    const expected = process.env.ADMIN_TOKEN;
    // Fail-closed: se ADMIN_TOKEN nao esta configurado, ninguem entra
    if (!expected) {
        return res.status(503).json({ error: 'Admin nao configurado no servidor' });
    }
    const token = req.headers['x-admin-token'];
    if (!token || token !== expected) {
        return res.status(401).json({ error: 'Acesso nao autorizado' });
    }
    next();
}

module.exports = { requireAdmin };
