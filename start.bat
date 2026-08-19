@echo off
title FIX PRO MAX — Servidor
color 0A

echo.
echo  ==========================================
echo   FIX PRO MAX — Iniciando servidor...
echo  ==========================================
echo.

:: Verificar que node_modules existe
if not exist "node_modules\" (
    echo  [*] Instalando dependencias...
    call npm install
    echo.
)

:: Liberar el puerto 3000 si está ocupado
echo  [*] Liberando puerto 3000...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    echo     Terminando proceso %%a
    taskkill /PID %%a /F >nul 2>&1
)
timeout /t 2 /nobreak >nul

:: Obtener IP de la red WiFi
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "192.168"') do (
    set LOCAL_IP=%%a
    goto :found_ip
)
set LOCAL_IP= desconocida

:found_ip
:: Quitar espacios
set LOCAL_IP=%LOCAL_IP: =%

echo.
echo  ==========================================
echo   Servidor iniciado correctamente
echo.
echo   Este dispositivo:
echo   http://localhost:3000
echo.
echo   Otros dispositivos (misma WiFi):
echo   http://%LOCAL_IP%:3000
echo.
echo   Panel administrador:
echo   http://%LOCAL_IP%:3000/admin
echo.
echo   Presiona Ctrl+C para detener
echo  ==========================================
echo.

node server.js

pause
