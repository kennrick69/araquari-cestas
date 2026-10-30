#!/usr/bin/env bash
# ============================================================================
# build-aab.sh — gera AAB release assinado do Araquari Cestas
# ----------------------------------------------------------------------------
# Pré-requisitos:
#   1) Android SDK em /mnt/c/Projetos/android-sdk/ (cmdline-tools + platform 36)
#   2) android/keystore.properties preenchido com dados do upload-key original
#   3) android/<storeFile>.keystore existe
# ============================================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
ANDROID_DIR="$APP_DIR/android"
export JAVA_HOME="${JAVA_HOME:-/mnt/c/Projetos/android-sdk/jdk/jdk-21.0.12.1+1}"
export ANDROID_HOME="${ANDROID_HOME:-/mnt/c/Projetos/android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

if [ ! -d "$ANDROID_HOME/platforms/android-36" ]; then
  echo "[ERRO] Platform android-36 não encontrada. Rode: sdkmanager --install 'platforms;android-36' 'build-tools;36.0.0'"
  exit 1
fi

if [ ! -f "$ANDROID_DIR/keystore.properties" ]; then
  echo "[ERRO] android/keystore.properties não existe."
  echo "       Copie keystore.properties.example e preencha com os dados do upload-key original do PWABuilder."
  exit 1
fi

# Garante local.properties aponta pro SDK
echo "sdk.dir=$ANDROID_HOME" > "$ANDROID_DIR/local.properties"

cd "$ANDROID_DIR"
echo "[1/3] cap sync..."
(cd "$APP_DIR" && npx cap sync android)

echo "[2/3] gradle clean + bundleRelease..."
./gradlew clean bundleRelease --no-daemon

AAB="$ANDROID_DIR/app/build/outputs/bundle/release/app-release.aab"
if [ ! -f "$AAB" ]; then
  echo "[ERRO] AAB não gerado em $AAB"
  exit 1
fi

echo "[3/3] copiando AAB pra raiz do app..."
cp "$AAB" "$APP_DIR/araquari-cestas-release.aab"

echo
echo "[OK] AAB gerado:"
echo "     $APP_DIR/araquari-cestas-release.aab"
echo "     (tamanho: $(du -h "$APP_DIR/araquari-cestas-release.aab" | cut -f1))"
echo
echo "Próximo passo manual:"
echo "  Upload no Play Console → Teste fechado → Nova versão → upload do .aab"
