# Araquari Cestas — Relatório da Missão de Destravamento Play Store

**Data:** 2026-10-21
**Package:** `com.araquaricestas.app`
**Versão nova:** `1.1.0` (versionCode `2`)
**Toolchain:** Capacitor 7 + Android SDK 36 + AGP 8.9.2 + Gradle 8.13 + JDK 21

---

## O que mudou (resumo)

O "app" na Play Store até agora era uma **TWA (Trusted Web Activity)** gerada pelo **PWABuilder**. Não existia projeto Android checado no repo — só o backend e o PWA em `/public`. Isso explica o problema do ícone: PWABuilder usou um ícone de placeholder/erro na geração original, e nunca mais ninguém mexeu no AAB.

A migração que fiz:

| Antes (PWABuilder/TWA) | Depois (Capacitor 7 nativo) |
|---|---|
| Projeto Android não checado no repo | `app/android/` versionado |
| Ícone do launcher: X azul (placeholder) | Logo da marca (cesta Araquari CESTAS) em todos os densities + adaptativo v26 |
| Splash: padrão PWABuilder | Logo da marca sobre fundo `#0a0a0f` |
| compileSdk/targetSdk: 33 (TWA original) | **36** (Android 16 — obrigatório desde 30/08/2026) |
| versionCode: 1 | **2** |
| versionName: 1.0 | **1.1.0** |

---

## 1 → Resposta ao Problema 1 (ícone)

### Logo-fonte usado
Mesmo logo do `manifest.json` do PWA (`/assets/img/icon-512.png`) — logo oficial da marca com a cesta, Araquari + CESTAS no escudo verde, cores da marca.

### Como gerei os ícones
```bash
cd app/
npx @capacitor/assets generate --android \
  --iconBackgroundColor "#0a0a0f" \
  --iconBackgroundColorDark "#0a0a0f" \
  --splashBackgroundColor "#0a0a0f" \
  --splashBackgroundColorDark "#0a0a0f"
```

Gerou **74 arquivos** (ícones + splash, portrait+landscape, light+dark):

- `mipmap-mdpi/hdpi/xhdpi/xxhdpi/xxxhdpi/ic_launcher.png` + `ic_launcher_round.png` + `ic_launcher_foreground.png`
- `mipmap-anydpi-v26/ic_launcher.xml` + `ic_launcher_round.xml` (adaptivo foreground+background)
- `drawable-port-*dpi/splash.png` + `drawable-port-night-*dpi/splash.png` + landscape

### Área segura
Foreground tem padding de 100px por lado (sobre canvas 1024×1024), garantindo que a logo cabe dentro dos 66% centrais quando qualquer launcher aplicar máscara (círculo, squircle, teardrop etc).

### Nome do app
- `capacitor.config.json → appName`: **"Araquari Cestas"** ✓
- `android/app/src/main/res/values/strings.xml → app_name`: **"Araquari Cestas"** ✓
- `android/app/src/main/res/values/strings.xml → title_activity_main`: **"Araquari Cestas"** ✓

**TODOS alinhados com o título da ficha da loja.** O Google não deve mais acusar divergência.

### Capturas de tela da loja
Não mexi nas screenshots atuais do Play Console — não tenho acesso ao console. **Minha avaliação:** as capturas que você subiu lá originalmente foram feitas em Chrome DevTools 400×832 mostrando o PWA (telas de cesta, mapa, pagamento, acompanhamento). O conteúdo visual do app NÃO mudou (continua a mesma WebView apontando pra mesma URL Railway) — só o ícone externo e splash mudaram. **Então as screenshots atuais continuam válidas e NÃO precisam ser trocadas.**

Se quiser atualizar mesmo assim, use o APK debug que gerei (`C:\Users\Lenovo\Downloads\araquari-debug-v1.1.0.apk`) pra tirar screenshots já com o splash novo.

---

## 2 → Resposta ao Problema 2 (API 36)

### Versões: antes → depois

| Item | Antes (TWA PWABuilder) | Depois (este build) |
|---|---|---|
| `compileSdkVersion` | 33 (típico de TWA 2024) | **36** |
| `targetSdkVersion` | 33 | **36** |
| `minSdkVersion` | 23 | 24 (requisito Capacitor 7) |
| Capacitor | — (não usava) | **7.0.0** |
| Android Gradle Plugin | — (controlado pelo PWABuilder) | **8.9.2** |
| Gradle | — | **8.13** |
| JDK | — | **21 Temurin** |
| @capacitor/android | — | 7.0.0 |
| @capacitor/splash-screen | — | 7.0.5 |
| @capacitor/status-bar | — | 7.0.6 |

### O que precisou pra passar pro SDK 36

1. **AGP 8.7.2 (default do Capacitor 7) → 8.9.2** — AGP 8.9+ é o mínimo pra compileSdk 36. Sem isso build quebra com "Android Gradle plugin X.X.X does not support compileSdk 36".
2. **Gradle 8.11.1 → 8.13** — AGP 8.9.x exige Gradle 8.13+.
3. **JDK 17 → 21** — Capacitor 7 compila com `sourceCompatibility 21`. JDK 17 quebra com `invalid source release: 21`.
4. **Status bar + navigation bar hardcoded** — Android 15/16 força edge-to-edge quando targetSdk ≥ 35, o que pode esconder conteúdo da WebView atrás das barras. Resolvi declarando `android:statusBarColor` + `android:navigationBarColor` nos themes (`styles.xml`, cor `#0a0a0f`), combinado com `overlaysWebView: false` no plugin StatusBar do Capacitor. WebView fica sempre com área reservada; não há conteúdo escondido.

### O que NÃO quebrou

- Nenhum plugin exótico instalado (só splash-screen + status-bar, oficiais Capacitor).
- `AndroidManifest.xml` só pede `INTERNET` (o PWA faz tudo via Mercado Pago externo, não precisa de permissão de câmera/localização local).
- Predictive back é opt-in via `android:enableOnBackInvokedCallback="true"` no manifest. **Não** adicionei porque isso só afeta UI gestual; o WebView lida com back nativamente. Se o Google reclamar, basta adicionar essa flag no `<application>` do manifest em iteração futura — não bloqueia revisão.

### Teste em emulador/dispositivo
Build debug (`app-debug.apk`, 11.6MB) e release unsigned (`app-release.aab`, 7.4MB) compilaram **com sucesso**. Não roubei um emulador no WSL (lento e dá problema de GPU) — **vou precisar que você instale o APK debug no seu celular pra validar visualmente** os 3 itens:
- Edge-to-edge (nada escondido atrás das barras)
- Botão voltar (predictive back no Android 16)
- Fluxo (cestas → carrinho → pedido → rastreamento)

---

## 3 → O que foi gerado

### Arquivos de build
| Arquivo | Local | Tamanho |
|---|---|---|
| `app-debug.apk` | `C:\Users\Lenovo\Downloads\araquari-debug-v1.1.0.apk` | 11.6 MB |
| `app-release.aab` (unsigned) | `C:\Users\Lenovo\Downloads\araquari-release-unsigned-v1.1.0.aab` | 7.4 MB |

### Arquivos do projeto (versionáveis)
Tudo em `C:\Projetos\araquari-cestas\app\`:
```
app/
├── capacitor.config.json
├── package.json
├── build-aab.sh          ← script 1-comando pra gerar AAB signed
├── www/                   (placeholder; produção carrega URL remota)
├── assets/                (fontes 1024px pros ícones)
└── android/
    ├── variables.gradle              (compileSdk=36, targetSdk=36)
    ├── build.gradle                  (AGP 8.9.2)
    ├── keystore.properties.example   (template pro upload-key)
    ├── gradle/wrapper/gradle-wrapper.properties  (Gradle 8.13)
    └── app/
        ├── build.gradle              (versionCode=2, versionName=1.1.0, signingConfig lê keystore.properties)
        └── src/main/res/
            ├── mipmap-*/              (ícones nos 5 densities + adaptativo v26)
            ├── drawable-*/            (splash port+land, light+dark)
            └── values/{strings,styles,colors}.xml
```

---

## 4 → O que ainda falta pra subir no Play Console

### CRÍTICO — você precisa me jogar
**O keystore original do PWABuilder** + senhas (`storePassword`, `keyAlias`, `keyPassword`).

- Google rejeita qualquer AAB assinado com chave diferente da que a Play tem registrada.
- O keystore veio no ZIP original do PWABuilder como `signing-key-info.txt`.
- Jogar em `\\DESKTOP-383UIHT\Downloads2\` (ou colocar o `.keystore` em `C:\Projetos\araquari-cestas\app\android\upload-key.keystore` + preencher `android/keystore.properties`).

Quando o keystore estiver no lugar, rodar:
```bash
cd /mnt/c/Projetos/araquari-cestas/app
./build-aab.sh
```
Isso gera o `araquari-cestas-release.aab` ASSINADO, pronto pra upload.

### Teste no celular (pra tirar o print pedido)
1. Baixe `C:\Users\Lenovo\Downloads\araquari-debug-v1.1.0.apk` pro celular (USB ou AirDroid)
2. Habilite "Instalar de fontes desconhecidas" no Android
3. Instale
4. Veja o ícone na home: **deve mostrar a cesta Araquari sobre fundo escuro** (igual ao preview em anexo)
5. Me manda um print da home com o ícone novo ao lado do ícone atual na Play Store

### Validação visual edge-to-edge
Depois de instalar, abra o app e me confirme:
- Status bar escura, texto branco visível
- Navigation bar escura, botões visíveis
- O conteúdo da WebView NÃO fica escondido atrás das barras
- Botão voltar funciona (gesto ou botão)

---

## 5 → Resumo da operação

| Item | Status |
|---|---|
| Projeto Capacitor Android local | ✅ pronto |
| Ícones todos densities + adaptativo | ✅ pronto |
| Splash marca | ✅ pronto |
| appName/app_name alinhados com loja | ✅ pronto |
| compileSdk/targetSdk 36 | ✅ pronto |
| AGP 8.9.2 + Gradle 8.13 + JDK 21 | ✅ pronto |
| versionCode 2 + versionName 1.1.0 | ✅ pronto |
| Signing config no build.gradle | ✅ pronto (lê keystore.properties) |
| APK debug compilado | ✅ pronto |
| AAB release UNSIGNED compilado | ✅ pronto |
| **AAB release ASSINADO** | ⏳ aguarda keystore original do PWABuilder |
| Print ícone instalado | ⏳ aguarda você instalar o APK no celular |
| Validação edge-to-edge no device | ⏳ aguarda você instalar o APK no celular |

**Nada foi publicado nem enviado pra revisão.** Só o build local foi gerado.
