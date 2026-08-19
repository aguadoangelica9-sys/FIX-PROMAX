@echo off
chcp 65001 >nul
title Setup Git - FIX-PROMAX

echo ============================================
echo   CONFIGURACION GIT - FIX-PROMAX
echo ============================================
echo.

:: ── 1. Verificar si Git está instalado ──────────────────────────────────────
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Git no esta instalado. Descargando instalador...
    echo.

    :: Descargar Git con PowerShell
    powershell -Command "Invoke-WebRequest -Uri 'https://github.com/git-for-windows/git/releases/download/v2.45.2.windows.1/Git-2.45.2-64-bit.exe' -OutFile '%TEMP%\git-installer.exe'"

    if not exist "%TEMP%\git-installer.exe" (
        echo [ERROR] No se pudo descargar Git. Verifica tu conexion a internet.
        pause
        exit /b 1
    )

    echo [*] Instalando Git en silencio, espera...
    "%TEMP%\git-installer.exe" /VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS /COMPONENTS="icons,ext\reg\shellhere,assoc,assoc_sh"

    :: Recargar PATH para detectar git recién instalado
    set "PATH=%PATH%;C:\Program Files\Git\bin;C:\Program Files\Git\cmd"

    where git >nul 2>&1
    if %errorlevel% neq 0 (
        echo [ERROR] La instalacion fallo o necesita reiniciar. Por favor reinicia y ejecuta el script de nuevo.
        pause
        exit /b 1
    )
    echo [OK] Git instalado correctamente.
) else (
    echo [OK] Git ya esta instalado.
)

echo.

:: ── 2. Asegurarse de estar en la carpeta correcta ───────────────────────────
cd /d "%~dp0"
echo [*] Directorio de trabajo: %CD%
echo.

:: ── 3. Configurar usuario Git si no está configurado ────────────────────────
git config user.name >nul 2>&1
for /f "tokens=*" %%i in ('git config --global user.name 2^>nul') do set GIT_USER=%%i
if "%GIT_USER%"=="" (
    echo [*] Configurando identidad Git...
    git config --global user.name "FIX-PROMAX User"
    git config --global user.email "user@fixpromax.com"
    echo [OK] Identidad configurada.
) else (
    echo [OK] Identidad Git ya configurada: %GIT_USER%
)
echo.

:: ── 4. Inicializar repositorio local si no existe ───────────────────────────
if not exist ".git" (
    echo [*] Inicializando repositorio Git local...
    git init
    git checkout -b main >nul 2>&1
    echo [OK] Repositorio inicializado.
) else (
    echo [OK] Repositorio Git ya existe.
)
echo.

:: ── 5. Conectar con el repositorio remoto ───────────────────────────────────
for /f "tokens=*" %%i in ('git remote 2^>nul') do (
    if "%%i"=="origin" (
        set ORIGIN_EXISTS=1
    )
)

if defined ORIGIN_EXISTS (
    echo [OK] Remote "origin" ya existe. Actualizando URL...
    git remote set-url origin https://github.com/aguadoangelica9-sys/FIX-PROMAX.git
) else (
    echo [*] Conectando con repositorio remoto...
    git remote add origin https://github.com/aguadoangelica9-sys/FIX-PROMAX.git
)
echo [OK] Remote: https://github.com/aguadoangelica9-sys/FIX-PROMAX.git
echo.

:: ── 6. Agregar todos los archivos al staging ─────────────────────────────────
echo [*] Agregando archivos al repositorio...
git add .
echo [OK] Archivos agregados.
echo.

:: ── 7. Crear commit inicial ──────────────────────────────────────────────────
git diff --cached --quiet >nul 2>&1
if %errorlevel% neq 0 (
    echo [*] Creando commit inicial...
    git commit -m "Subida inicial del proyecto FIX-PROMAX"
    echo [OK] Commit creado.
) else (
    echo [OK] No hay cambios nuevos para commitear.
)
echo.

:: ── 8. Hacer push al repositorio remoto ─────────────────────────────────────
echo [*] Subiendo archivos a GitHub...
echo.
echo     Nota: Si el repositorio pide usuario y contrasena,
echo     ingresa tus credenciales de GitHub.
echo     (La contrasena debe ser un Personal Access Token,
echo      no tu contrasena normal de GitHub)
echo.
git push -u origin main

if %errorlevel% neq 0 (
    echo.
    echo [!] El push fallo. Posibles causas:
    echo     - El repositorio remoto tiene commits que no tienes localmente.
    echo     - Prueba con: git pull origin main --allow-unrelated-histories
    echo       y luego vuelve a ejecutar este script.
    echo.
    echo [*] Intentando con --force como ultimo recurso...
    set /p CONFIRM="¿Deseas hacer push forzado? Esto sobreescribira el remoto. (s/n): "
    if /i "%CONFIRM%"=="s" (
        git push -u origin main --force
    )
) else (
    echo.
    echo ============================================
    echo   LISTO! Proyecto subido exitosamente.
    echo   https://github.com/aguadoangelica9-sys/FIX-PROMAX
    echo ============================================
)

echo.
pause
