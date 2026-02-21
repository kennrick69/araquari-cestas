@echo off
chcp 65001 >nul
echo ========================================
echo    ARAQUARI CESTAS - Git Push
echo ========================================
echo.

cd /d %~dp0

echo [1/5] Configurando Git...
git config user.email "ocaradaia.br@gmail.com"
git config user.name "kennrick69"

echo.
echo [2/5] Verificando repositorio...
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    echo Inicializando repositorio...
    git init
)

echo.
echo [3/5] Configurando remote...
git remote remove origin >nul 2>&1
git remote add origin https://github.com/kennrick69/araquari-cestas.git

echo.
echo [4/5] Adicionando e commitando...
git add -A
git commit -m "Atualizacao %date% %time:~0,5%"

echo.
echo [5/5] Enviando para GitHub...
git branch -M main
git push -u origin main --force

echo.
echo ========================================
echo    Push concluido!
echo    Railway fara deploy automatico.
echo ========================================
echo.
pause
