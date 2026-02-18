@echo off
title Araquari Cestas - Deploy

echo ========================================
echo    ARAQUARI CESTAS - Git Push
echo ========================================
echo.

:: ALTERE AQUI o link do seu repositorio
set REPO=https://github.com/SEU_USUARIO/araquari-cestas.git
set BRANCH=main

:: Verificar se ja e um repo git
if not exist ".git" (
    echo [1/5] Inicializando repositorio Git...
    git init
    git remote add origin %REPO%
    git branch -M %BRANCH%
    echo.
) else (
    echo [1/5] Repositorio Git encontrado.
    echo.
)

:: Adicionar todos os arquivos
echo [2/5] Adicionando arquivos...
git add .
echo.

:: Pedir mensagem do commit
set /p MSG="[3/5] Mensagem do commit (Enter = padrao): "
if "%MSG%"=="" set MSG=Atualizacao %date% %time:~0,5%

echo.
echo [4/5] Commitando: %MSG%
git commit -m "%MSG%"
echo.

:: Push
echo [5/5] Enviando para GitHub...
git push -u origin %BRANCH%

echo.
echo ========================================
echo    Push concluido!
echo    Railway fara deploy automatico.
echo ========================================
echo.
pause
