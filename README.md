# 🛒 Araquari Cestas — Backend API

## Deploy no Railway

### 1. Criar projeto no Railway
- Acesse [railway.app](https://railway.app)
- New Project → Deploy from GitHub (ou Empty Project)
- Adicione um serviço PostgreSQL
- Adicione um serviço Node.js (aponte para este repositório)

### 2. Variáveis de ambiente
No Railway, vá em Variables e adicione:
```
DATABASE_URL    → (Railway já conecta automaticamente ao PostgreSQL)
ADMIN_TOKEN     → gere-um-token-seguro-aqui
CORS_ORIGIN     → * (ou o domínio do seu site)
NODE_ENV        → production
```

### 3. Criar as tabelas
No Railway, acesse o PostgreSQL → Data → Query e execute o conteúdo do arquivo `db/schema.sql`

### 4. Frontend
Coloque os arquivos do app (index.html + assets/) na pasta `public/` do projeto.
O Express serve automaticamente.

---

## Endpoints da API

### Público (app do cliente)

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/pedidos` | Criar pedido |
| POST | `/api/pedidos/:codigo/documentos` | Upload docs (boleto 30d) |
| GET | `/api/pedidos/:codigo` | Consultar pedido por código |
| GET | `/api/pedidos/telefone/:tel` | Pedidos por telefone |
| GET | `/api/health` | Health check |

### Admin (requer header `x-admin-token`)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/admin/dashboard` | KPIs e estatísticas |
| GET | `/api/admin/pedidos` | Listar pedidos (filtros: status, cesta, busca) |
| GET | `/api/admin/pedidos/:id` | Detalhe do pedido |
| PATCH | `/api/admin/pedidos/:id/status` | Atualizar status |
| GET | `/api/admin/config` | Ver configurações |
| PUT | `/api/admin/config` | Salvar configurações |

### Exemplo: Criar Pedido
```json
POST /api/pedidos
{
    "cesta_tipo": "confort",
    "cesta_nome": "Cesta Confort",
    "cesta_preco": 159.90,
    "quantidade": 1,
    "endereco_rua": "Rua das Flores",
    "endereco_numero": "123",
    "endereco_referencia": "Próximo ao mercado",
    "endereco_bairro": "Centro",
    "recebedor_nome": "Maria Silva",
    "recebedor_telefone": "(47) 99999-8888",
    "pagamento_metodo": "pix",
    "desconto": 8.00,
    "total": 151.90
}
```

Resposta:
```json
{
    "success": true,
    "pedido": {
        "codigo": "AC-20260218-0001",
        "status": "novo",
        "total": 151.90
    }
}
```

### Status possíveis
`novo` → `confirmado` → `separacao` → `pronto` → `a_caminho` → `entregue`
`analise` → `aprovado` → `separacao` → ...
`analise` → `recusado`
`cancelado` (qualquer momento)
