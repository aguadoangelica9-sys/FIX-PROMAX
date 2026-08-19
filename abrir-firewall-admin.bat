@echo off
:: Este archivo debe ejecutarse como Administrador (clic derecho > Ejecutar como administrador)
title Abrir Firewall - FIX PRO MAX
color 0A

echo.
echo  Abriendo puerto 3000 en el Firewall de Windows...
echo  (Para que otros dispositivos de tu red puedan acceder)
echo.

:: Eliminar regla anterior si existe
netsh advfirewall firewall delete rule name="FIX PRO MAX Puerto 3000" >nul 2>&1

:: Crear nueva regla
netsh advfirewall firewall add rule name="FIX PRO MAX Puerto 3000" dir=in action=allow protocol=TCP localport=3000

echo.
echo  Verificando...
netsh advfirewall firewall show rule name="FIX PRO MAX Puerto 3000"

echo.
echo  ==========================================
echo   Puerto 3000 abierto correctamente.
echo   Otros dispositivos en tu red WiFi pueden
echo   acceder a http://192.168.0.199:3000
echo  ==========================================
echo.
pause
