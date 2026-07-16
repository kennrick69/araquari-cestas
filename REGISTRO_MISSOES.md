# REGISTRO DE MISSÕES — Araquari Cestas

> Histórico de missões autônomas executadas neste repo (squad do JOs).
> Detalhes técnicos de cada mudança: ver `BIBLIA.md` §11 (changelog).

---

## #23 — 16/07/2026 — Auditoria de segurança (OWASP + P0 do dia) + BIBLIA.md

**Executor:** Claudio (missão noturna autônoma, 2 rodadas — a 1ª bateu session limit após os fixes iniciais; a 2ª retomou, completou e deployou).

**Entregas:**
1. `BIBLIA.md` criada (11 seções: identidade, stack, arquitetura, dados, endpoints, fluxos, integrações, segurança, deploy, dívidas, changelog).
2. **P0 corrigidos (rodada 1):**
   - Reembolso MP era público → agora exige admin (`requireAdmin`).
   - Webhook MP sem validação de assinatura → HMAC-SHA256 `x-signature` quando `MP_WEBHOOK_SECRET` configurado; fallback por valor só com match único.
   - Adulteração de preço na criação de pedido → total recalculado server-side via `cestas_config`.
   - Hardening: admin fail-closed + só header, segredos mascarados no config, rate limit, headers de segurança.
3. **P0 corrigidos (rodada 2):**
   - `/uploads/*` (RG/comprovante = PII) era público → agora exige token admin; painel exibe via fetch+blob.
   - Upload de documentos permitia sobrescrever docs de qualquer pedido (código sequencial enumerável) → só pedido em `analise`, sem sobrescrita.
   - `DRIVER_TOKEN` opcional para o entregador (escopo mínimo; retrocompatível).
   - `package-lock.json` re-sincronizado (dep fantasma `mercadopago` removida).

**Deploy:** push em `main` → Railway auto-deploy. Health verificado antes e depois.

**Pendências para o JOs:**
- Configurar `MP_WEBHOOK_SECRET` no Railway (sem ele a assinatura do webhook não é validada — só loga aviso).
- Configurar `DRIVER_TOKEN` no Railway e repassar ao entregador (hoje ele usa o token admin completo).
- Abrir o painel admin no browser e conferir a exibição dos documentos de boleto 30d (mudou de `<img src>` direto para fetch+blob; validado só por análise de código).

**Não feito de propósito:** rotação de secrets, mudanças destrutivas de DB, quebra de contrato de endpoint.
