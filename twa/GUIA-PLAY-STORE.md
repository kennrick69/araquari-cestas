# 🛒 Araquari Cestas - Publicar na Google Play Store

## Resumo do Processo
O app é uma TWA (Trusted Web Activity) - basicamente um "wrapper" Android que abre seu site como app nativo. O Google aceita isso na Play Store.

**Tempo total estimado:** ~30 minutos de setup + 14 dias obrigatórios de teste fechado

---

## PASSO 1: Conta Google Play Developer

Se ainda não tem:
1. Acesse https://play.google.com/console
2. Pague a taxa única de US$ 25 (~R$ 130)
3. Complete a verificação de identidade (pode levar 48h)

---

## PASSO 2: Gerar o AAB (Android App Bundle)

### Opção A: PWABuilder (RECOMENDADO - mais fácil)

1. Acesse **https://www.pwabuilder.com**
2. Cole a URL: `https://creative-illumination-production-ce66.up.railway.app`
3. Clique **"Start"** e aguarde a análise
4. Clique **"Package for stores"** → **"Android"**
5. Preencha os campos:

| Campo | Valor |
|-------|-------|
| Package ID | `com.araquaricestas.app` |
| App name | `Araquari Cestas` |
| Launcher name | `Araquari Cestas` |
| Display | `standalone` |
| Status bar color | `#0a0a0f` |
| Navigation bar color | `#0a0a0f` |
| Theme color | `#E8850C` |
| Background | `#0a0a0f` |
| Splash fade-out duration | `300` |
| App version | `1.0.0` |
| App version code | `1` |

6. **Signing key**: Escolha **"New"** - o PWABuilder vai gerar uma nova chave
7. **ANOTE A SENHA DA CHAVE** - você vai precisar dela pra atualizar o app no futuro
8. Clique **"Generate"** e baixe o ZIP

O ZIP contém:
- `app-release.aab` ← ESTE vai pra Play Store
- `signing-key-info.txt` ← guarde em lugar seguro
- `assetlinks.json` ← copie o conteúdo pra atualizar no servidor

---

## PASSO 3: Atualizar Digital Asset Links

O PWABuilder vai te dar um arquivo `assetlinks.json` com o SHA256 correto.

1. Abra o arquivo `assetlinks.json` gerado pelo PWABuilder
2. Copie o conteúdo
3. Substitua o conteúdo do arquivo:
   `araquari-backend/public/.well-known/assetlinks.json`
4. **Faça deploy no Railway** com esse arquivo atualizado
5. Teste acessando: https://creative-illumination-production-ce66.up.railway.app/.well-known/assetlinks.json

**IMPORTANTE:** O assetlinks.json precisa estar online ANTES de publicar na Play Store.
Sem ele, o app abre no Chrome em vez de como app nativo.

---

## PASSO 4: Preparar Material da Play Store

### Obrigatórios:
- **Ícone do app**: 512x512 PNG ← já temos (icon-512.png)
- **Feature graphic**: 1024x500 PNG ← precisa criar (banner promocional)
- **Screenshots celular**: pelo menos 2 capturas 1080x1920 (ou qualquer entre 320-3840px)
- **Descrição curta**: máx 80 caracteres
- **Descrição completa**: máx 4000 caracteres

### Textos sugeridos:

**Nome:** Araquari Cestas

**Descrição curta (80 chars):**
```
Cestas básicas e de alimentos entregues na sua porta em Araquari/SC 🛒
```

**Descrição completa:**
```
O Araquari Cestas é o app de delivery de cestas básicas de Araquari, SC.

Escolha entre nossas opções de cestas:
🥫 Cesta X - Essencial para o dia a dia
🥗 Cesta Confort - Mais completa e variada
🥩 Cesta Plus - Premium com itens selecionados

Principais recursos:
• Escolha a cesta ideal para sua família
• Informe o endereço de entrega via mapa interativo
• Pague com PIX, Cartão de Crédito ou Boleto
• Acompanhe o status do pedido em tempo real
• Receba notificações pelo WhatsApp
• Modo Doação - contribua com famílias necessitadas

💚 Também aceitamos doações! Doe uma cesta para uma família carente de Araquari e receba um certificado de solidariedade.

Entregamos em toda a região de Araquari e redondezas.

Araquari Cestas - Solidariedade que alimenta!
```

### Screenshots
Tire as capturas do app no Chrome DevTools (modo responsivo 400x832):
1. Tela inicial com as cestas
2. Tela do mapa de entrega
3. Tela de pagamento (PIX/Cartão)
4. Tela de acompanhamento do pedido
5. Tela de doação (opcional)

**Dica:** No DevTools, clique no ícone de câmera (⋮ → More tools → Screenshot) ou Ctrl+Shift+P → "screenshot"

### Feature Graphic (1024x500)
Crie uma imagem promocional no Canva (https://www.canva.com):
- Use fundo laranja/escuro (#E8850C / #0a0a0f)
- Logo do Araquari Cestas centralizado
- Texto: "Cestas básicas na sua porta!"

---

## PASSO 5: Criar o App no Play Console

1. Acesse https://play.google.com/console
2. Clique **"Criar app"**
3. Preencha:
   - Nome: `Araquari Cestas`
   - Idioma padrão: Português (Brasil)
   - App ou jogo: **App**
   - Gratuito ou pago: **Gratuito**
4. Aceite as declarações

### Configuração do app:
5. **Detalhes do app** → preencha descrições
6. **Gráficos** → faça upload do ícone, feature graphic e screenshots
7. **Categorização** → Categoria: **Compras** ou **Alimentos e bebidas**
8. **Detalhes de contato** → email e telefone de suporte
9. **Política de privacidade** → URL (pode ser uma página simples)

### Classificação de conteúdo:
10. **Política do app** → **Classificação de conteúdo** → preencha o questionário
    - O app coleta dados pessoais? **Sim** (nome, endereço, CPF)
    - Conteúdo gerado por usuário? **Não**
    - Compras no app? **Não** (pagamento é externo via MP)

### Segurança dos dados:
11. **Segurança dos dados** → preencha:
    - Coleta dados: **Sim**
    - Dados coletados: Nome, Endereço, Telefone, CPF, Email
    - Dados compartilhados: Mercado Pago (processamento de pagamento)
    - Criptografia em trânsito: **Sim** (HTTPS)

---

## PASSO 6: Teste Fechado (OBRIGATÓRIO - 14 dias)

1. Vá em **Teste** → **Teste fechado** → **Criar faixa**
2. Faça upload do arquivo `app-release.aab`
3. Adicione testadores:
   - Crie uma lista de emails
   - Precisa de **pelo menos 12 testadores** (recomendo 20)
   - Use emails de amigos, família, etc.
4. **Publique o teste fechado**
5. Compartilhe o link de adesão com os testadores
6. Testadores precisam **aceitar o convite** e instalar o app

### Regra dos 14 dias:
- O teste precisa ficar ativo por **14 dias corridos**
- Precisa ter pelo menos **12 testadores ativos** que aceitaram
- Só depois disso a opção "Produção" fica disponível

---

## PASSO 7: Publicar em Produção

Após os 14 dias de teste:
1. Vá em **Produção** → **Criar nova versão**
2. Faça upload do mesmo AAB (ou versão atualizada)
3. Preencha as notas da versão:
```
Primeira versão do Araquari Cestas!
• Escolha entre 3 tipos de cestas
• Pagamento via PIX, Cartão ou Boleto
• Acompanhamento do pedido em tempo real
• Modo Doação para famílias carentes
```
4. **Enviar para revisão**
5. Revisão do Google leva **1-7 dias úteis**

---

## Checklist Final

- [ ] Conta Google Play Developer ativa
- [ ] AAB gerado pelo PWABuilder
- [ ] assetlinks.json atualizado no servidor e funcionando
- [ ] Deploy no Railway feito com assetlinks.json
- [ ] Ícone 512x512 ✅ (já temos)
- [ ] Feature graphic 1024x500 criada
- [ ] 2-5 screenshots 1080x1920
- [ ] Descrições preenchidas
- [ ] Política de privacidade (URL)
- [ ] Classificação de conteúdo preenchida
- [ ] Segurança dos dados preenchida
- [ ] Teste fechado com 12+ testadores por 14 dias
- [ ] Produção publicada

---

## ⚠️ Cuidados Importantes

1. **NUNCA perca a signing key** - sem ela não consegue atualizar o app
2. **assetlinks.json** precisa estar acessível em HTTPS
3. Se mudar o domínio do Railway, precisa atualizar o assetlinks
4. Atualizações futuras: gerar novo AAB com version code +1

## 🆘 Problemas Comuns

| Problema | Solução |
|----------|---------|
| App abre no Chrome em vez de nativo | assetlinks.json incorreto ou não acessível |
| "Precisa de mais testadores" | Mínimo 12 testadores que aceitaram o convite |
| Upload AAB rejeitado | Verifique se o package name é único |
| Não aparece "Produção" | Teste fechado precisa ter 14 dias completos |
