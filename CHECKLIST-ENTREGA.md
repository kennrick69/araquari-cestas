# Checklist de entrega — Araquari Cestas

> Projeto desenvolvido para terceiro (o **contratante**). Este documento lista o que
> trocar na entrega para que tudo passe a operar na conta do contratante, não na conta
> temporária de desenvolvimento. **Nada aqui foi executado** — é um roteiro de entrega.

## Contexto importante

- A conta **Mercado Pago atualmente conectada é pessoa física e TEMPORÁRIA** (desenvolvimento):
  - nickname **RICDOERNER**, id `29986244`, e-mail `r.ih@hotmail.com`.
  - Isso é **proposital** até a entrega. Em produção para o contratante, tem que virar a conta MP dele.
- Credenciais vivas ficam **encriptadas na tabela `app_config`** (fonte canônica), editáveis pelo **painel admin** (`/admin.html`). Não ficam no código.

## Passos de entrega (Mercado Pago)

1. **Trocar o Access Token** pelo da conta MP do contratante:
   - Painel admin → Configurações → `mp_access_token` (campo "password").
   - Colar o Access Token **de produção** da conta do contratante (`APP_USR-...`).
2. **Trocar a Public Key** (`mp_public_key`) pela do contratante (`APP_USR-...`).
3. **Trocar a assinatura do webhook** (`mp_webhook_secret`) pela gerada na conta do contratante
   (MP → Suas integrações → Webhooks → chave secreta). Sem isso o webhook de confirmação
   de pagamento não valida a assinatura.
4. **Conferir que o token em uso é mesmo o do contratante:**
   - `GET /api/admin/config/test-mp` (header `X-Admin-Token: <ADMIN_TOKEN>`).
   - Deve responder `success: true`, `source: "database"` e `conta.email` / `conta.nickname`
     **da conta do contratante** (NÃO `r.ih@hotmail.com` / `RICDOERNER`).

## Passos de entrega (e-mail / loja)

5. **Ajustar o `loja_email` no painel** (`app_config` → campo de e-mail da loja):
   - É o fallback de `payer.email` quando o comprador não informa e-mail no PIX.
   - ⚠️ **Tem que ser DIFERENTE do e-mail da conta MP do contratante** — se for igual,
     o Mercado Pago recusa o pagamento (regra `payer.email == seller`).
   - Enquanto o campo estiver vazio, o sistema usa `contato@conversecommaria.com.br`
     (último recurso fixo no código, em `services/mercadopago.js::_payerEmail`).
6. **Conferir os textos/contatos** das páginas públicas (já apontam para o e-mail/WhatsApp
   de desenvolvimento): `public/privacidade.html`, `public/exclusao-dados.html`
   (dev "Compostela", WhatsApp `(47) 99681-3181`, e-mail `contato@conversecommaria.com.br`).
   Trocar pelos dados do contratante se ele quiser.

## Passos de entrega (Android / Play Store)

7. A conta de desenvolvedor do Play é **"Compostela"**. Se for transferir o app para a
   conta do contratante, usar a **transferência de app** do Play Console (não republicar).
8. Se o contratante assumir a publicação com nova chave, o `assetlinks.json`
   (`public/.well-known/assetlinks.json`) precisa refletir o **SHA-256 do app signing key**
   da conta dele. Hoje: `F0:BC:7E:84:...:3F:90` (app signing key atual, confirmado no Console).

## Verificação final

9. `GET /health` → `{"status":"ok","db":"conectado"}`.
10. `GET /api/admin/config/test-mp` → conta do contratante.
11. Pagamento de teste (PIX de valor baixo) ponta a ponta: gerar QR, pagar, ver o webhook
    confirmar o pedido no painel.

---
_Gerado como roteiro de entrega. Atualizar conforme o contratante definir conta MP, e-mail e dados de contato._
