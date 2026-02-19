# TWA - Araquari Cestas (Play Store)

## Pre-requisitos
- Node.js instalado
- Java JDK 11+ (para assinar o APK)
- Conta Google Play Developer (R$25 unica vez)

## Passo 1: Instalar Bubblewrap
```
npm install -g @nicepage/nicewrap
npm install -g @nicepage/nicewrap
npm install -g @nicepage/nicewrap
npm install -g @nicepage/nicewrap
```

**Na verdade, use o PWA Builder (mais facil):**
1. Acesse https://www.pwabuilder.com
2. Cole a URL: https://creative-illumination-production-ce66.up.railway.app
3. Clique "Start"
4. Clique "Package for stores" > "Android"
5. Preencha:
   - Package ID: `com.araquaricestas.app`
   - App name: `Araquari Cestas`
   - Display: `standalone`
   - Theme color: `#E8850C`
   - Background: `#0a0a0f`
6. Baixe o ZIP com o APK/AAB

## Passo 2: Digital Asset Links
Ja criamos o arquivo em `public/.well-known/assetlinks.json`.
Apos gerar a chave de assinatura, atualize o SHA256 fingerprint nele.

Para pegar o SHA256 do seu keystore:
```
keytool -list -v -keystore sua-chave.keystore -alias sua-alias
```

## Passo 3: Google Play Console
1. Acesse https://play.google.com/console
2. Crie novo app
3. Preencha informacoes (nome, descricao, capturas de tela)
4. Va em "Teste" > "Teste fechado" > "Criar faixa"
5. Faca upload do AAB/APK gerado
6. Adicione 20 testadores (emails Google)
7. Publique o teste fechado

## Passo 4: Teste Fechado (14 dias obrigatorios)
- Adicionar 20 testadores via email
- Testadores precisam aceitar o convite
- Aguardar 14 dias corridos
- Depois disso pode solicitar producao

## Capturas de Tela necessarias
- Pelo menos 2 screenshots do celular (1080x1920)
- 1 screenshot tablet (opcional)
- Icone 512x512
- Feature graphic 1024x500

## Manifest (adicionar ao index.html se nao tiver)
O PWA Builder vai criar um, mas o app ja tem as meta tags necessarias.
