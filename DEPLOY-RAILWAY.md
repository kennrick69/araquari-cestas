# 🚀 Passo a Passo — Deploy no Railway

## PARTE 1: GitHub (no seu PC)

### 1. Criar repositório no GitHub
- Acesse https://github.com/new
- Nome: `araquari-cestas`
- Privado ✓
- NÃO marque "Add README" (já temos)
- Clique **Create repository**

### 2. Subir o código
Abra o terminal na pasta `araquari-backend/` e rode:
```
git init
git add .
git commit -m "Primeiro deploy - Araquari Cestas"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/araquari-cestas.git
git push -u origin main
```
Ou simplesmente **dê 2 cliques no `deploy.bat`** (edite a URL do repo antes).

---

## PARTE 2: Railway

### 3. Criar projeto
- Acesse https://railway.app e faça login
- Clique **New Project**
- Escolha **Deploy from GitHub repo**
- Autorize o GitHub se necessário
- Selecione o repositório `araquari-cestas`

### 4. Adicionar PostgreSQL
- Dentro do projeto, clique **+ New**
- Escolha **Database → PostgreSQL**
- Railway cria o banco automaticamente
- O `DATABASE_URL` já será injetado no seu app

### 5. Configurar variáveis de ambiente
- Clique no serviço do seu app (não o PostgreSQL)
- Vá na aba **Variables**
- Clique **+ New Variable** e adicione:

| Variável | Valor |
|----------|-------|
| `ADMIN_TOKEN` | `invente-um-token-seguro-123` |
| `CORS_ORIGIN` | `*` |
| `NODE_ENV` | `production` |

> ⚠️ NÃO precisa adicionar DATABASE_URL — Railway já conecta automaticamente ao PostgreSQL do projeto.

### 6. Executar o SQL (criar tabelas)
- Clique no serviço **PostgreSQL**
- Vá na aba **Data**
- Clique em **Query**
- Cole TODO o conteúdo do arquivo `db/schema.sql`
- Clique **Run Query** (botão ▶)
- Deve aparecer: CREATE TABLE, CREATE INDEX, etc.

### 7. Gerar domínio público
- Volte ao serviço do app
- Vá na aba **Settings**
- Em **Networking → Public Networking**, clique **Generate Domain**
- Railway vai gerar algo tipo: `araquari-cestas-production.up.railway.app`
- Este é o link do seu app!

### 8. Testar
- Acesse: `https://SEU-DOMINIO.up.railway.app` → deve abrir o app
- Acesse: `https://SEU-DOMINIO.up.railway.app/api/health` → deve retornar `{"status":"ok"}`

---

## PARTE 3: Domínio próprio (opcional)

Se quiser usar um domínio tipo `app.araquaricestas.com.br`:
- Em **Settings → Custom Domain**, adicione seu domínio
- No painel DNS (Hostinger/Registro.br), crie um CNAME apontando para o domínio do Railway

---

## PRÓXIMOS DEPLOYS

Após a primeira vez, é só:
1. Editar os arquivos
2. Dar 2 cliques no `deploy.bat`
3. Railway detecta o push e faz deploy automático (~30 segundos)

---

## COMANDOS ÚTEIS

Testar API localmente antes de subir:
```
npm install
copy .env.example .env
(edite o .env com a DATABASE_URL do Railway)
npm run dev
```

Testar criar pedido:
```
curl -X POST http://localhost:3000/api/pedidos -H "Content-Type: application/json" -d "{\"cesta_tipo\":\"x\",\"cesta_nome\":\"Cesta X\",\"cesta_preco\":89.90,\"recebedor_nome\":\"Teste\",\"recebedor_telefone\":\"(47)99999-8888\",\"pagamento_metodo\":\"pix\",\"total\":85.40}"
```

Ver dashboard admin:
```
curl http://localhost:3000/api/admin/dashboard -H "x-admin-token: SEU_TOKEN"
```
