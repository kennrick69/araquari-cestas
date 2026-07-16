# BÍBLIA — Araquari Cestas

> Documento canônico de referência do projeto. Gerado na auditoria de 16/07/2026.
> Projeto #7 em produção do JOs (kennrick69).

---

## 1. Identidade do projeto

**Araquari Cestas** é uma **loja/delivery de cestas** (cestas básicas e de doação) para a
cidade de Araquari–SC e região (Joinville, Barra Velha). É um app de **pedido único** (não é
assinatura recorrente, não é marketplace, não tem contas de usuário): o cliente escolhe uma
cesta, informa endereço/recebedor, paga e acompanha a entrega pelo **código do pedido**.

- Frontend: PWA + TWA (empacotado para Play Store — ver `twa/`).
- Sem login de cliente. Pedido identificado por `codigo` (ex: `AC-20260218-0001`) e telefone.
- Painel administrativo protegido por **token único** (`ADMIN_TOKEN`, header `x-admin-token`).
- Tipos de cesta: `x`, `confort`, `plus` (catálogo em `cestas_config`) + `custom` (Doação Livre, valor personalizado).

## 2. Stack técnica

| Camada | Tecnologia |
|--------|-----------|
| Runtime | Node.js >= 18 |
| Framework | Express 4.21 |
| Banco | PostgreSQL (via `pg` 8.13, pool) |
| Uploads | multer 1.4 (disco local `uploads/`) |
| Pagamentos | Mercado Pago (Checkout API transparente) — `services/mercadopago.js` |
| Pagamentos (legado) | EFI/Gerencianet — `services/efi.js` (presente, não roteado) |
| Deploy | Railway (auto-deploy do GitHub `kennrick69/araquari-cestas`, branch `main`) |
| Geocode | Proxy para Nominatim/OpenStreetMap |

Dependências mínimas (sem helmet/rate-limit externos — implementados inline).

## 3. Arquitetura

```
server.js                 → bootstrap Express, CORS, headers segurança, rate limit, static, migrate no boot
  db/pool.js              → pool PostgreSQL
  db/migrate.js           → cria tabelas no boot (idempotente)
  db/schema.sql + migration-00X-*.sql
  routes/orders.js        → /api/pedidos   (público — cria/consulta pedido)
  routes/payments.js      → /api/pagamento (público: pix/boleto/cartao/status/webhook; admin: reembolso)
  routes/admin.js         → /api/admin     (protegido por x-admin-token)
  services/mercadopago.js → integração MP (singleton, credenciais de env ou app_config)
  middleware/upload.js    → multer (jpg/png/pdf, 10MB)
  middleware/auth.js      → requireAdmin (compartilhado)
  public/                 → index.html (app cliente), admin.html (painel), entregador.html
```

Auto-migração: tabelas são criadas no boot e sob demanda (`cestas_config`, `app_config`) se
não existirem. Credenciais do MP podem vir de env vars **ou** da tabela `app_config` (o banco
tem prioridade quando preenchido).

## 4. Modelos de dados

**pedidos** — pedido único do cliente
- `id`, `codigo` (UNIQUE, `AC-YYYYMMDD-NNNN`)
- cesta: `cesta_tipo`, `cesta_nome`, `cesta_preco`, `quantidade`
- entrega: `endereco_*`, `latitude`, `longitude`
- recebedor: `recebedor_nome`, `recebedor_telefone`
- pagamento: `pagamento_metodo` (pix/cartao/boleto/boleto30), `pagamento_status`, `desconto`, `total`, `gateway_id`, `gateway_data`
- PII extra: `cpf`, `email`, `doc_identidade`, `doc_residencia` (uploads)
- `status`: novo → confirmado → separacao → pronto → a_caminho → entregue; analise → aprovado/recusado; cancelado
- timestamps: `criado_em`, `atualizado_em` (trigger)

**pedidos_log** — histórico de status (FK pedido_id ON DELETE CASCADE)

**cestas_config** — catálogo editável (tipo, nome, preco, emoji, descricao, itens JSON, embalagem, ativo, ordem)

**app_config** / **config** — chave/valor (credenciais MP, dados da loja)

## 5. Endpoints

### Público — app cliente
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/pedidos` | Criar pedido (valida preço server-side p/ cestas de catálogo) |
| POST | `/api/pedidos/:codigo/documentos` | Upload docs (boleto 30d) — só pedido em `analise`, sem sobrescrita |
| GET | `/api/pedidos/:codigo` | Consultar pedido |
| GET | `/api/pedidos/telefone/:tel` | Pedidos por telefone |
| GET | `/api/cestas` | Catálogo público |
| GET | `/api/geocode`, `/api/geocode/search` | Proxy Nominatim |
| GET | `/api/health` | Health check |

### Pagamento
| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| GET | `/api/pagamento/public-key` | público | Public key MP |
| POST | `/api/pagamento/pix/:codigo` | público | Gerar PIX |
| POST | `/api/pagamento/boleto/:codigo` | público | Gerar boleto |
| POST | `/api/pagamento/cartao/:codigo` | público | Cobrar cartão (token MP) |
| GET | `/api/pagamento/status/:codigo` | público | Status do pagamento |
| POST | `/api/pagamento/webhook` | assinatura MP | Webhook (valida x-signature se secret configurado) |
| POST | `/api/pagamento/reembolso/:codigo` | **admin** | Reembolso (fechado na auditoria) |

### Admin (header `x-admin-token`)
`GET /dashboard`, `GET/DELETE /pedidos[/:id]`, `PATCH /pedidos/:id/status`,
`GET/PUT /config`, `GET/PUT /cestas[/:tipo]`, `GET /config/test-mp`.

Também protegido: `GET /uploads/:arquivo` (documentos PII — o painel busca via fetch
autenticado e exibe como blob).

**`DRIVER_TOKEN` (opcional)**: token separado para o entregador (`entregador.html`),
aceito no mesmo header, restrito a `GET /dashboard`, `GET /pedidos` e
`PATCH /pedidos/:id/status` apenas para `separacao|pronto|a_caminho|entregue`.
Sem `DRIVER_TOKEN` configurado, nada muda (entregador usa o `ADMIN_TOKEN`).

## 6. Fluxos principais

1. **Pedido + PIX**: cria pedido (status `novo`) → `POST /pix/:codigo` gera QR no MP →
   cliente paga → **webhook** confirma (status `confirmado`, pagamento `aprovado`). Frontend
   também faz polling via `GET /status/:codigo`.
2. **Cartão**: frontend tokeniza (public key) → `POST /cartao/:codigo` com token → aprovação síncrona.
3. **Boleto 30 dias**: pedido entra em `analise`; admin aprova (`PATCH status=aprovado`) e o MP
   gera o boleto de 30 dias; requer CPF do pagador.
4. **Reembolso**: **somente admin** dispara refund no MP e marca pedido `cancelado`.

## 7. Integrações externas

- **Mercado Pago** — `api.mercadopago.com` (v1/payments, refunds, payment_methods). Idempotência
  por operação. Credenciais em env (`MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY`) ou `app_config`.
- **Webhook MP** — validação de assinatura HMAC-SHA256 (`x-signature`/`x-request-id`) quando
  `MP_WEBHOOK_SECRET` está configurado.
- **Nominatim/OSM** — geocode reverso e busca de endereço (proxy server-side p/ evitar CORS).
- **EFI/Gerencianet** — código presente (`services/efi.js`) porém **não roteado** atualmente.

## 8. Segurança

Estado **pós-auditoria 16/07/2026** (ver seção 11 para o que foi corrigido):

- **Admin**: token único via header `x-admin-token`, **fail-closed** (sem `ADMIN_TOKEN` → 503).
  Query param de token removido. Segredos do MP mascarados no `GET /config`.
- **Reembolso**: exige admin (era público — P0 corrigido).
- **Webhook**: valida assinatura MP quando secret configurado; fallback por valor só confirma
  se houver match único (não confirma pedido de outro cliente).
- **Preço**: recalculado no servidor a partir de `cestas_config` para cestas de catálogo
  (bloqueia pagar 1 centavo por cesta cara). `custom` (doação) mantém valor livre.
- **Uploads (PII)**: `GET /uploads/*` exige token admin (RG/comprovante deixaram de ser
  públicos). Upload de docs só em pedido `analise` e **nunca sobrescreve** doc já enviado
  (anti-IDOR: código de pedido é sequencial/enumerável).
- **Entregador**: `DRIVER_TOKEN` opcional com escopo mínimo (listar + status de entrega) —
  elimina a necessidade de dar o token admin completo ao entregador.
- **Rate limit** in-memory por IP: `/api/pedidos` 20/min, `/api/pagamento` 30/min (webhook isento).
- **Headers**: X-Content-Type-Options, X-Frame-Options, Referrer-Policy, HSTS (prod).
- **SQL**: 100% prepared statements (`$1..$n`) — sem concatenação.
- **Upload**: whitelist de extensão (jpg/png/pdf), 10MB, nome randomizado.

**Riscos residuais conhecidos** (design, não bloqueadores):
- Pedidos são consultáveis por `codigo` (sequencial/enumerável) e por telefone sem prova de
  posse — inerente ao modelo "sem conta de cliente". Expõe PII (nome/telefone/endereço). Rate
  limit mitiga enumeração em massa, mas não elimina. Melhoria futura: token opaco por pedido.
- Inflar `desconto` no corpo do pedido ainda reduz o valor cobrado (o preço-base é validado,
  o desconto não tem regra de cupom canônica no backend). Baixo impacto; documentar regra de
  cupom quando existir.
- `GET /api/admin/config` (rota `config` legada, tabela `config`) e credenciais em `app_config`:
  segredos mascarados apenas na rota de `app_config`.

## 9. Deploy e infraestrutura

- **Railway** com auto-deploy do GitHub (`kennrick69/araquari-cestas`, branch **main**).
- Boot roda `migrate()` automaticamente (idempotente).
- Variáveis: `DATABASE_URL` (Railway), `ADMIN_TOKEN`, `CORS_ORIGIN`, `NODE_ENV`,
  `MP_PUBLIC_KEY`, `MP_ACCESS_TOKEN`, `MP_PIX_KEY`, `MP_WEBHOOK_SECRET` (novo),
  `DRIVER_TOKEN` (novo, opcional — token restrito do entregador).
- URL de produção: `https://creative-illumination-production-ce66.up.railway.app`.
- Static servido pelo próprio Express (`public/`). Uploads em disco local (`uploads/`) —
  **atenção**: filesystem efêmero no Railway; documentos podem sumir em redeploy.

## 10. Pontos de atenção / dívida técnica

- **Uploads efêmeros**: `uploads/` em disco local — migrar para storage externo (S3/R2) se
  documentos de boleto 30d precisarem persistir.
- **EFI morto**: `services/efi.js` presente mas não roteado — remover ou reativar conscientemente.
- **CRLF**: repositório com line endings CRLF; edições em WSL geram ruído de diff. Commitar
  apenas os arquivos tocados (padrão conhecido do JOs).
- **Sem testes automatizados**.
- **Enumeração de pedidos**: ver riscos residuais (seção 8).
- **Regra de cupom/desconto** não centralizada no backend.

## 11. Changelog / histórico de missões

### 16/07/2026 — Auditoria de segurança + BÍBLIA (missão #23)
Padrões P0 do dia procurados e resultado:
- **[P0 ACHADO+CORRIGIDO] Reembolso público** — `POST /api/pagamento/reembolso/:codigo` não
  tinha autenticação: qualquer um com o código (enumerável) disparava refund no MP + cancelava
  o pedido. → passou a exigir `requireAdmin`.
- **[P0 ACHADO+CORRIGIDO] Webhook sem assinatura** — `mp_webhook_secret` era carregado mas nunca
  usado; webhook aceitava qualquer POST e o fallback "por valor" podia confirmar o pedido errado.
  → validação HMAC-SHA256 da `x-signature` (quando secret configurado, retrocompatível) + fallback
  por valor só com match único.
- **[P0 ACHADO+CORRIGIDO] Adulteração de preço** — criação de pedido confiava em `total`/`desconto`
  do cliente; a cobrança usava esse valor. → preço recalculado server-side via `cestas_config`
  para cestas de catálogo; `custom`/doação mantém valor livre.
- **[Hardening]** token admin só via header (removido query param), fail-closed sem `ADMIN_TOKEN`;
  segredos MP mascarados no `GET /config`; rate limit in-memory; headers de segurança; avisos de
  boot para `ADMIN_TOKEN`/`MP_WEBHOOK_SECRET` fracos/ausentes.
- Não foram encontrados: código hardcoded dando privilégio/gratuidade; reset de senha expondo
  link (não há fluxo de senha); SQL injection (tudo parametrizado).

### 16/07/2026 — Rodada 2 da missão #23 (retomada pós session-limit)
- **[P0 ACHADO+CORRIGIDO] Documentos PII públicos** — `/uploads/*` (RG e comprovante de
  residência do boleto 30d) era servido sem autenticação; nome de arquivo aleatório era a
  única barreira. → `GET /uploads/*` agora exige `x-admin-token`; `admin.html` passou a
  buscar os docs via fetch autenticado e exibir como blob (PDF abre em nova aba).
- **[P0 ACHADO+CORRIGIDO] Sobrescrita de docs alheios (IDOR write)** — qualquer pessoa com
  um código de pedido (sequencial: `AC-YYYYMMDD-NNNN`) podia enviar/substituir os documentos
  de outro cliente antes da análise do admin. → upload só é aceito com pedido em `analise`
  e cada documento só pode ser gravado uma vez (sem sobrescrita).
- **[Hardening] Entregador com token admin completo** — `entregador.html` usa o `ADMIN_TOKEN`
  (podia deletar pedidos, ler config, aprovar boleto). → criado `DRIVER_TOKEN` opcional e
  retrocompatível: mesmo header, escopo restrito a `GET dashboard/pedidos` e
  `PATCH status ∈ {separacao, pronto, a_caminho, entregue}`. Ação do JOs: configurar
  `DRIVER_TOKEN` no Railway e repassar esse código ao entregador.
- **[Housekeeping]** `package-lock.json` re-sincronizado com `package.json` (dependência
  `mercadopago` fantasma removida do lock — o serviço usa fetch direto, não o SDK);
  arquivos tocados normalizados para LF (ruído CRLF do working tree em WSL).
- Testado local: matriz de auth completa via curl (401 sem token, 403 driver fora de escopo,
  fluxo de entrega passa). Painel admin (blob de docs) **não testado em browser real**.
