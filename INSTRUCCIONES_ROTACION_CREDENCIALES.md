# 📋 INSTRUCCIONES PARA ROTAR CREDENCIALES - SEPT 2026

## 🔴 CREDENCIALES EXPUESTAS DETECTADAS

### 1. **MongoDB Atlas** ⚠️ CRÍTICO
- **URI Actual**: `mongodb+srv://1ng3l2c1_db_user:fixpromax2026@fixpromax.xlbpzsu.mongodb.net/fixpromax`
- **Acciones Requeridas**:
  1. Ir a [MongoDB Atlas](https://cloud.mongodb.com)
  2. Navegar al cluster `fixpromax`
  3. Click en "Database Access" → Usuario `1ng3l2c1_db_user`
  4. Click en "Edit" → Cambiar contraseña
  5. Generar nueva contraseña segura (mínimo 16 caracteres, mezcla de mayúsculas, minúsculas, números, símbolos)
  6. Actualizar en `.env` con nueva URI

### 2. **UltraMsg WhatsApp** ⚠️ ALTO
- **Token Actual**: `jtbkmtfrblss1utf`
- **Instancia Actual**: `instance188835`
- **Acciones Requeridas**:
  1. Ir a [UltraMsg Dashboard](https://ultramsg.com)
  2. Navegar a "My Instances"
  3. Buscar instancia `instance188835`
  4. Click en "Regenerate Token"
  5. Copiar nuevo token seguro
  6. Actualizar en `.env` y `config.json`

### 3. **Datos Bancarios** ⚠️ ALTO
- **Cuenta Mercantil**: `01050162871162066784`
- **Pago Móvil**: `0412-566-9426` (Mercantil)
- **Cédula**: `V-32.003.088`
- **USDT Address**: `1183080311`
- **Acciones Requeridas**:
  1. **Contactar al banco** para cambiar números de cuenta si es posible
  2. **Actualizar config.json** con nuevos datos bancarios
  3. **Considerar usar un sistema de pago** como Stripe, PayPal para evitar exponer datos bancarios

### 4. **Google OAuth** ⚠️ MEDIO
- **Client ID/Secret**: No configurados actualmente
- **Acciones Requeridas**:
  1. Ir a [Google Cloud Console](https://console.cloud.google.com)
  2. Crear nuevo proyecto o usar existente
  3. Habilitar Google+ API
  4. Crear credenciales OAuth 2.0
  5. Configurar Authorized Redirect URIs:
     - `https://fixpromax-erp.onrender.com/api/auth/google/callback`
     - `http://localhost:3000/api/auth/google/callback` (desarrollo)

### 5. **Render API Key** ⚠️ MEDIO
- **API Key**: No configurada actualmente
- **Acciones Requeridas**:
  1. Ir a [Render Dashboard](https://dashboard.render.com)
  2. Click en "Account Settings" → "API Keys"
  3. Generar nueva API Key
  4. Copiar y guardar en lugar seguro
  5. Actualizar en `.env`

## 🛠️ PASOS DE ROTACIÓN COMPLETOS

### Paso 1: MongoDB
```bash
# Generar nueva contraseña
openssl rand -base64 24
# Resultado: nueva_contraseña_segura_base64

# Actualizar URI en .env
MONGODB_URI=mongodb+srv://nuevo_usuario:nueva_contraseña@cluster.mongodb.net/...
```

### Paso 2: UltraMsg
1. Login a UltraMsg
2. Regenerar token
3. Actualizar `.env`:
   ```
   ULTRAMSG_INSTANCE=nueva_instancia
   ULTRAMSG_TOKEN=nuevo_token
   ```
4. Actualizar `config.json`:
   ```json
   "ultramsgInstance": "nueva_instancia",
   "ultramsgToken": "nuevo_token"
   ```

### Paso 3: Datos Bancarios
1. Contactar bancos para nuevos números
2. Actualizar `config.json` con datos temporales seguros
3. Considerar implementar sistema de pago profesional

### Paso 4: Secrets de Aplicación
```bash
# Generar nuevos secrets
openssl rand -base64 32  # Para PASSWORD_SALT
openssl rand -base64 48  # Para ADMIN_MIGRATE_KEY
openssl rand -base64 48  # Para ADMIN_FIX_KEY
openssl rand -base64 64  # Para SESSION_SECRET
openssl rand -base64 64  # Para JWT_SECRET
```

### Paso 5: Google OAuth
1. Crear nuevas credenciales en Google Cloud
2. Actualizar `.env`:
   ```
   GOOGLE_CLIENT_ID=nuevo_client_id
   GOOGLE_CLIENT_SECRET=nuevo_client_secret
   ```

### Paso 6: Render API Key
1. Generar nueva API Key en Render
2. Actualizar `.env`:
   ```
   RENDER_API_KEY=nueva_render_api_key
   ```

## 📝 CHECKLIST DE COMPLETITUD

- [ ] MongoDB Atlas: Nueva contraseña generada
- [ ] MongoDB Atlas: URI actualizada en .env
- [ ] UltraMsg: Token regenerado
- [ ] UltraMsg: Instancia y token actualizados en .env y config.json
- [ ] Datos bancarios: Contactados bancos para cambios
- [ ] Datos bancarios: config.json actualizado con datos temporales
- [ ] Google OAuth: Nuevas credenciales creadas
- [ ] Google OAuth: .env actualizado
- [ ] Render: Nueva API Key generada
- [ ] Render: .env actualizado
- [ ] Secrets: Nuevos salts y keys generados con openssl
- [ ] Secrets: .env actualizado con todos los nuevos valores
- [ ] Verificación: Aplicación funciona con nuevas credenciales

## 🔐 MEJORES PRÁCTICAS IMPLEMENTADAS

### 1. **Nueva Política de Contraseñas**
- Mínimo 16 caracteres
- Mezcla de 4 tipos de caracteres
- No reutilizar contraseñas entre servicios
- Rotación cada 90 días

### 2. **Almacenamiento Seguro**
- Variables de entorno para todos los secrets
- `.env` en `.gitignore`
- `config.json` con datos no sensibles solamente

### 3. **Monitoreo**
- Alertas para intentos de acceso con credenciales viejas
- Logging de todas las operaciones sensibles
- Revisión periódica de access logs

### 4. **Backup y Recuperación**
- Backup de nuevas credenciales en lugar seguro
- Documentación de procedimientos de rotación
- Plan de respuesta a incidentes

## 🚨 ACCIONES INMEDIATAS RECOMENDADAS

1. **ROTAR CREDENCIALES HOY**: Comenzar con MongoDB y UltraMsg
2. **NOTIFICAR USUARIOS**: Si hay cambios que los afecten
3. **MONITOREAR LOGS**: Buscar intentos de acceso con credenciales viejas
4. **ACTUALIZAR DOCUMENTACIÓN**: Mantener registro de fechas de rotación

## 📞 CONTACTOS DE EMERGENCIA

- **MongoDB Support**: support@mongodb.com
- **UltraMsg Support**: support@ultramsg.com
- **Bancos**: Contactar directamente con cada institución
- **Render Support**: https://render.com/contact

## 🔄 PRÓXIMA ROTACIÓN PROGRAMADA

**Fecha**: Diciembre 10, 2026 (90 días desde hoy)
**Responsable**: Administrador de seguridad
**Checklist**: Ejecutar este mismo documento nuevamente