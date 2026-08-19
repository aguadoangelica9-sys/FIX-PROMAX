# 🚀 Guía de Publicación — FIX PRO MAX en Play Store

## Estado actual de la PWA
✅ Web App Manifest configurado  
✅ Service Worker con cache offline  
✅ Íconos en todos los tamaños (72→512px)  
✅ Digital Asset Links (assetlinks.json)  
✅ Proyecto Android TWA listo  
✅ Headers HTTPS/seguridad configurados  
✅ 8/8 endpoints verificados  

---

## PASO 1 — Publicar el servidor en internet (HTTPS obligatorio)

Play Store requiere que tu app esté en un dominio HTTPS real.  
Las opciones más fáciles y económicas:

### Opción A — Railway (gratis para empezar)
```
1. Ir a https://railway.app y crear cuenta
2. New Project → Deploy from GitHub (o subir carpeta)
3. Railway detecta Node.js automáticamente
4. En Variables de entorno agregar: PORT=3000
5. Railway te da un dominio HTTPS automático: 
   https://fixpromax-xxxx.railway.app
```

### Opción B — Render (gratis)
```
1. Ir a https://render.com
2. New → Web Service → conectar repositorio
3. Build Command: npm install
4. Start Command: node server.js
5. Dominio automático: https://fixpromax.onrender.com
```

### Opción C — VPS propio con Nginx
```nginx
server {
    listen 443 ssl;
    server_name tu-dominio.com;
    
    ssl_certificate     /etc/letsencrypt/live/tu-dominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tu-dominio.com/privkey.pem;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## PASO 2 — Actualizar tu dominio real en los archivos

Una vez que tengas tu dominio HTTPS, reemplaza `tu-dominio.com` en:

### 1. `android/app/src/main/AndroidManifest.xml`
```xml
<!-- Cambiar esto: -->
<data android:scheme="https" android:host="tu-dominio.com" />

<!-- Y esto: -->
<meta-data android:name="android.support.customtabs.trusted.DEFAULT_URL"
           android:value="https://tu-dominio.com/" />
```

### 2. `android/app/src/main/res/values/strings.xml`
```xml
<string name="asset_statements">
    [{"relation":["delegate_permission/common.handle_all_urls"],
      "target":{"namespace":"web","site":"https://tu-dominio.com"}}]
</string>
```

### 3. `android/app/src/main/res/values/twa_assets.xml`
```xml
<string name="twa_url">https://tu-dominio.com/</string>
```

---

## PASO 3 — Generar el keystore de firma

```powershell
# Ejecutar en la carpeta android/
keytool -genkey -v `
  -keystore fixpromax.keystore `
  -alias fixpromax `
  -keyalg RSA `
  -keysize 2048 `
  -validity 10000

# Cuando pregunte, llenar:
# - Contraseña del keystore: (elige una segura)
# - Nombre y apellido: Tu Nombre
# - Organización: Tu Empresa
# - País: VE (Venezuela)
```

### Obtener el SHA-256 fingerprint (lo necesitas para assetlinks.json)
```powershell
keytool -list -v `
  -keystore fixpromax.keystore `
  -alias fixpromax

# Copia el valor de "SHA256:" — se ve así:
# AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78
```

---

## PASO 4 — Actualizar assetlinks.json con tu SHA256

Editar `.well-known/assetlinks.json` y reemplazar:
```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.fixpromax.erp",
      "sha256_cert_fingerprints": [
        "AB:CD:EF:12:34:56:78:90:..."
      ]
    }
  }
]
```

Verificar que esté accesible en:  
`https://tu-dominio.com/.well-known/assetlinks.json`

---

## PASO 5 — Configurar firma en build.gradle

Editar `android/app/build.gradle`:
```groovy
signingConfigs {
    release {
        storeFile     file("../../fixpromax.keystore")
        storePassword "TU_STORE_PASSWORD"
        keyAlias      "fixpromax"
        keyPassword   "TU_KEY_PASSWORD"
    }
}
buildTypes {
    release {
        signingConfig signingConfigs.release
        // ...
    }
}
```

---

## PASO 6 — Compilar el APK/AAB con Android Studio

### Instalar Android Studio
1. Descargar de https://developer.android.com/studio
2. Instalar con configuración por defecto
3. Abrir la carpeta `android/` como proyecto

### Compilar AAB (formato requerido por Play Store)
```
Build → Generate Signed Bundle / APK
→ Android App Bundle
→ Seleccionar fixpromax.keystore
→ Build Type: release
→ Finish
```
El AAB se genera en: `android/app/release/app-release.aab`

### Alternativa — Bubblewrap CLI (sin Android Studio)
```powershell
# Instalar Bubblewrap
npm install -g @bubblewrap/cli

# En la carpeta raíz del proyecto
bubblewrap init --manifest https://tu-dominio.com/manifest.json
bubblewrap build
# Genera app-release-signed.apk y app-release.aab
```

---

## PASO 7 — Subir a Google Play Console

1. Ir a https://play.google.com/console
2. Crear cuenta de desarrollador ($25 único)
3. **Crear app** → Android → App de pago: No → Contenido principal: Aplicación
4. Completar el formulario:
   - **Nombre**: FIX PRO MAX — ERP Profesional
   - **Descripción corta**: Sistema ERP completo para tu negocio
   - **Descripción larga**: (usar el texto de abajo)
   - **Categoría**: Negocios
   - **Clasificación de contenido**: Todos
5. **Producción → Releases → Crear nueva versión**
6. Subir el `.aab` generado
7. **Revisar y publicar**

### Texto de descripción para la Play Store
```
FIX PRO MAX es un sistema ERP (Enterprise Resource Planning) completo
diseñado para pequeñas y medianas empresas.

✅ MÓDULOS INCLUIDOS:
• 🛒 Punto de Venta (POS) — ventas rápidas con carrito
• 📋 Ventas y Facturas — historial completo y estados
• 📦 Inventario — control de stock con alertas automáticas
• 👥 Clientes y Proveedores — gestión de cartera
• 📥 Compras — órdenes y seguimiento
• 💸 Gastos — registro y categorización
• ↩️ Devoluciones — control de reversiones
• 📒 Contabilidad — plan de cuentas y libro diario
• 💹 Finanzas P&L — ganancias, pérdidas y márgenes
• 📈 Reportes — análisis con descarga CSV
• 🤖 AI Copilot — asistente inteligente
• 🔔 Alertas — stock bajo, facturas vencidas

📥 IMPORTACIÓN INTELIGENTE:
Importa tu inventario desde Excel o CSV con un solo clic.
El sistema detecta automáticamente las columnas.

💾 FUNCIONA OFFLINE:
Todos tus datos están disponibles sin conexión a internet.
```

---

## PASO 8 — Verificar el Digital Asset Link

Después de publicar, verificar en:
```
https://digitalassetlinks.googleapis.com/v1/statements:list
  ?source.web.site=https://tu-dominio.com
  &relation=delegate_permission/common.handle_all_urls
```

Si responde con tu `package_name`, la verificación TWA está completa y la app se abrirá sin la barra del navegador.

---

## Estructura de archivos generada

```
📁 Nueva carpeta (2)/
├── 📄 index2.html          ← App principal (PWA + SW registrado)
├── 📄 server.js            ← Backend Express con headers PWA
├── 📄 sw.js                ← Service Worker (cache offline)
├── 📄 manifest.json        ← Web App Manifest
├── 📄 package.json
├── 📄 db.json              ← Base de datos (148 productos)
├── 📄 start.bat            ← Iniciar servidor en Windows
├── 📁 icons/               ← Íconos PWA (72→512px + screenshots)
│   ├── icon-72.png
│   ├── icon-96.png
│   ├── icon-128.png
│   ├── icon-144.png
│   ├── icon-152.png
│   ├── icon-192.png
│   ├── icon-384.png
│   ├── icon-512.png
│   ├── screenshot-wide.png
│   └── screenshot-mobile.png
├── 📁 .well-known/
│   └── assetlinks.json     ← Digital Asset Links (TWA)
└── 📁 android/             ← Proyecto Android TWA
    ├── build.gradle
    ├── settings.gradle
    ├── gradle.properties
    └── 📁 app/
        ├── build.gradle
        ├── proguard-rules.pro
        └── 📁 src/main/
            ├── AndroidManifest.xml
            ├── 📁 java/com/fixpromax/erp/
            │   └── Application.java
            └── 📁 res/
                ├── drawable/splash.xml
                ├── values/colors.xml
                ├── values/strings.xml
                ├── values/styles.xml
                ├── values/twa_assets.xml
                └── xml/network_security_config.xml
```

---

## Checklist final antes de publicar

- [ ] Servidor publicado en HTTPS
- [ ] `tu-dominio.com` reemplazado en todos los archivos
- [ ] Keystore generado y SHA256 copiado
- [ ] `assetlinks.json` actualizado con SHA256 real
- [ ] `assetlinks.json` accesible en `https://tu-dominio.com/.well-known/assetlinks.json`
- [ ] AAB compilado y firmado
- [ ] Cuenta de Google Play Console activa ($25)
- [ ] Íconos personalizados (opcional — los generados funcionan)
- [ ] Screenshots reales de la app (opcional pero recomendado)

---
*Generado automáticamente por Kiro — FIX PRO MAX v1.0*
