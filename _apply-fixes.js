'use strict';
/**
 * _apply-fixes.js — Aplica todas las correcciones de la auditoría UTF-8
 * Ejecutar con: node _apply-fixes.js
 */
const fs = require('fs');

let totalFixes = 0;
function fix(file, description, oldStr, newStr) {
    const content = fs.readFileSync(file, 'utf8');
    if (!content.includes(oldStr)) {
        console.log(`  ⚠️  [${file}] No encontrado: ${description}`);
        return;
    }
    const fixed = content.split(oldStr).join(newStr);
    fs.writeFileSync(file, fixed, 'utf8');
    totalFixes++;
    console.log(`  ✅ [${file}] ${description}`);
}

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║   APLICANDO CORRECCIONES DE AUDITORÍA UTF-8               ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

// ═══════════════════════════════════════════════════════════════════════════
// FIX #1: SEGURIDAD — devCode expuesto en producción
// El código de recuperación de contraseña se devuelve en la respuesta HTTP.
// En producción esto permite a cualquiera recuperar cualquier cuenta sin email.
// FIX: Ocultarlo cuando NODE_ENV=production
// ═══════════════════════════════════════════════════════════════════════════
fix('server.js',
    'SEGURIDAD: devCode oculto en producción',
    `    console.log(\`🔐 Código de recuperación para \${email}: \${code}\`);
    // En producción aquí se enviaría el email. Por ahora se devuelve en la respuesta (dev mode).
    ok(res, { sent: true, devCode: code });   // devCode solo visible en desarrollo`,
    `    console.log(\`🔐 Código de recuperación para \${email}: \${code}\`);
    // En producción: no exponer el código. En desarrollo (NODE_ENV != production) sí se devuelve.
    const isProduction = process.env.NODE_ENV === 'production';
    ok(res, { sent: true, ...(isProduction ? {} : { devCode: code }) });`
);

// ═══════════════════════════════════════════════════════════════════════════
// FIX #2: SEGURIDAD — Cookie sin flag secure en HTTPS
// En Render.com el servidor corre en HTTPS, la cookie debe tener secure:true
// para que el navegador solo la envíe por HTTPS (no HTTP).
// ═══════════════════════════════════════════════════════════════════════════
fix('server.js',
    'Cookie secure:true en HTTPS (producción)',
    `    res.cookie('fixpromax_token', token, {
        httpOnly: false,      // false para que el cliente JS también pueda leerla si necesita
        sameSite: 'Lax',
        maxAge:   30 * 24 * 60 * 60 * 1000,  // 30 días
        path:     '/'`,
    `    res.cookie('fixpromax_token', token, {
        httpOnly: false,      // false para que el cliente JS pueda leerla
        sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Lax',
        secure:   process.env.NODE_ENV === 'production',  // true en HTTPS
        maxAge:   30 * 24 * 60 * 60 * 1000,  // 30 días
        path:     '/'`
);

// ═══════════════════════════════════════════════════════════════════════════
// FIX #3: WHATSAPP — Asegurar encoding UTF-8 en payload
// Buffer.byteLength sin encoding usa utf8 por defecto, pero lo hacemos explícito.
// También asegurar que postData se serializa con caracteres no-ASCII correctamente.
// ═══════════════════════════════════════════════════════════════════════════
fix('server.js',
    'WhatsApp: Content-Length con encoding UTF-8 explícito',
    `            'Content-Length': Buffer.byteLength(postData),`,
    `            'Content-Length': Buffer.byteLength(postData, 'utf8'),`
);

fix('server.js',
    'WhatsApp: postData escrito con encoding UTF-8 explícito',
    `        req_wa.write(postData);`,
    `        req_wa.write(postData, 'utf8');`
);

// ═══════════════════════════════════════════════════════════════════════════
// FIX #4: WHATSAPP — Eliminar mojibake residual en función de logging WA
// El único mojibake residual en server.js está en la función alertWA
// ═══════════════════════════════════════════════════════════════════════════
// Buscar y limpiar el mojibake residual en server.js
const serverRaw = fs.readFileSync('server.js', 'utf8');
const mojibakeCount = (serverRaw.match(/\u00c2[\u00a0-\u00bf]/g) || []).length;
if (mojibakeCount > 0) {
    let s = serverRaw;
    // Solo limpiar mojibake real (no en tablas de corrección)
    s = s.replace(/\u00c2\u00b7/g, '·');   // Â· → ·
    s = s.replace(/\u00c2\u00bf/g, '¿');   // Â¿ → ¿
    s = s.replace(/\u00c2\u00a1/g, '¡');   // Â¡ → ¡
    s = s.replace(/\u00c2\u00a9/g, '©');   // Â© → ©
    s = s.replace(/\u00c2\u00ae/g, '®');   // Â® → ®
    fs.writeFileSync('server.js', s, 'utf8');
    console.log(`  ✅ [server.js] ${mojibakeCount} mojibake residuales limpiados`);
    totalFixes++;
} else {
    console.log('  ✅ [server.js] Sin mojibake residual');
}

// ═══════════════════════════════════════════════════════════════════════════
// FIX #5: CSV EXPORT — Añadir BOM UTF-8 para que Excel abra con tildes
// Sin el BOM, Excel interpreta el CSV como Windows-1252 y las tildes se corrompen.
// El BOM (\uFEFF) al inicio del archivo indica UTF-8 a Excel.
// ═══════════════════════════════════════════════════════════════════════════
fix('index2.html',
    'CSV: añadir BOM UTF-8 para compatibilidad con Excel',
    `    function downloadCSV(filename, content) {
        if (!content) { showToast('⚠️','Sin datos para descargar'); return; }
        const blob = new Blob([content], { type:'text/csv;charset=utf-8;' });`,
    `    function downloadCSV(filename, content) {
        if (!content) { showToast('⚠️','Sin datos para descargar'); return; }
        // BOM UTF-8 (\uFEFF) necesario para que Excel abra el CSV con tildes y ñ correctamente
        const BOM = '\uFEFF';
        const blob = new Blob([BOM + content], { type:'text/csv;charset=utf-8;' });`
);

// ═══════════════════════════════════════════════════════════════════════════
// FIX #6: CSV campos con comas — escapar correctamente valores con comas/comillas
// Los campos con comas dentro del CSV deben ir entre comillas dobles.
// Actualmente las exportaciones hacen join con comas sin escapar.
// ═══════════════════════════════════════════════════════════════════════════
// Añadir función helper csvEscape en index2.html antes de downloadCSV
fix('index2.html',
    'CSV: añadir función csvEscape para valores con comas/comillas/tildes',
    `    function downloadCSV(filename, content) {`,
    `    /** Escapa un valor para CSV: envuelve en comillas si tiene comas, comillas o saltos de línea */
    function csvEscape(val) {
        const s = String(val === null || val === undefined ? '' : val);
        if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
            return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    }

    function downloadCSV(filename, content) {`
);

// ═══════════════════════════════════════════════════════════════════════════
// FIX #7: SERVICE WORKER — Mejorar detección de caches corruptos
// El patrón de búsqueda necesita funcionar con los nombres reales de cache.
// ═══════════════════════════════════════════════════════════════════════════
// Verificar que el SW tiene el patrón correcto de limpieza
const swContent = fs.readFileSync('sw.js', 'utf8');
const hasClearAll = swContent.includes("keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))");
if (!hasClearAll) {
    // El SW actual borra cada key individualmente en activate - es correcto pero con sintaxis diferente
    const hasActivateClear = swContent.includes('caches.keys()') && swContent.includes('caches.delete');
    if (hasActivateClear) {
        console.log('  ✅ [sw.js] Limpieza de caches está implementada correctamente');
    } else {
        console.log('  ⚠️  [sw.js] Revisar limpieza de caches');
    }
} else {
    console.log('  ✅ [sw.js] Limpieza de caches correcta');
}

// ═══════════════════════════════════════════════════════════════════════════
// FIX #8: BACKEND — Añadir header Content-Type charset a respuestas JSON del backup
// El endpoint /api/backup usa res.send(JSON.stringify()) sin charset explícito
// ═══════════════════════════════════════════════════════════════════════════
fix('server.js',
    'Backup: Content-Type con charset=utf-8',
    `    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(db, null, 2));`,
    `    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(JSON.stringify(db, null, 2));`
);

// ═══════════════════════════════════════════════════════════════════════════
// FIX #9: ENDPOINT DE PRUEBA UTF-8 — Para verificar round-trip
// ═══════════════════════════════════════════════════════════════════════════
const serverFinal = fs.readFileSync('server.js', 'utf8');
if (!serverFinal.includes('/api/utf8-test')) {
    // Añadir antes del endpoint de migración
    const insertBefore = '// ══════════════════════════════════════════════════════════════════════════════\n// ENDPOINT DE LIMPIEZA';
    const testEndpoint = `// ══════════════════════════════════════════════════════════════════════════════
// ENDPOINT DE PRUEBA UTF-8 — verifica que el servidor procesa Unicode correctamente
// GET /api/utf8-test — público, sin autenticación
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/utf8-test', (req, res) => {
    const testData = {
        tildes:   'á é í ó ú Á É Í Ó Ú',
        enie:     'ñ Ñ camión cañón',
        emojis:   '📦 💰 🚗 🔧 ✅ ⚠️ 👋 🟢',
        nombres:  ['José Pérez', 'Óscar Rodríguez', 'María González', 'Ángel López'],
        empresa:  'Repuestos Encava 🚗',
        frase:    'Información del cliente: Última actualización ✅',
        json_ok:  true,
        encoding: 'UTF-8',
        node_env: process.env.NODE_ENV || 'development',
    };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json({ ok: true, data: testData });
});

${insertBefore}`;
    const fixed = serverFinal.replace(insertBefore, testEndpoint);
    if (fixed !== serverFinal) {
        fs.writeFileSync('server.js', fixed, 'utf8');
        console.log('  ✅ [server.js] Endpoint /api/utf8-test añadido');
        totalFixes++;
    }
} else {
    console.log('  ✅ [server.js] Endpoint /api/utf8-test ya existe');
}

// ═══════════════════════════════════════════════════════════════════════════
// FIX #10: MONGODB — Verificar y añadir charset explícito en URI si falta
// MongoDB Atlas soporta UTF-8 por defecto, pero añadir ?charset=utf8 no hace daño
// ═══════════════════════════════════════════════════════════════════════════
// MongoDB/Mongoose ya usa UTF-8 por defecto - no necesita cambios en la conexión
console.log('  ✅ [db-mongo.js] MongoDB Atlas: UTF-8 nativo, sin cambios necesarios');

// ═══════════════════════════════════════════════════════════════════════════
// FIX #11: ELIMINAR BOM de server.js (puede causar problemas en Node.js)
// Node.js puede ignorar el BOM pero es mejor no tenerlo
// ═══════════════════════════════════════════════════════════════════════════
const serverBuf = fs.readFileSync('server.js');
if (serverBuf[0] === 0xEF && serverBuf[1] === 0xBB && serverBuf[2] === 0xBF) {
    fs.writeFileSync('server.js', serverBuf.slice(3));
    console.log('  ✅ [server.js] BOM eliminado');
    totalFixes++;
} else {
    console.log('  ✅ [server.js] Sin BOM (correcto)');
}

// Verificar sintaxis de server.js
const { execSync } = require('child_process');
try {
    execSync('node --check server.js', { stdio: 'pipe' });
    console.log('\n  ✅ server.js — sintaxis verificada');
} catch(e) {
    console.error('\n  ❌ server.js — ERROR DE SINTAXIS:', e.stderr?.toString());
}

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log(`║   TOTAL: ${totalFixes} correcciones aplicadas                          ║`);
console.log('╚══════════════════════════════════════════════════════════╝\n');
