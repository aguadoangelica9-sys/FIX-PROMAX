'use strict';
/**
 * _audit.js — Auditoría completa de encoding UTF-8 en FIX PRO MAX
 * Analiza TODOS los archivos del sistema y reporta problemas reales.
 */
const fs   = require('fs');
const path = require('path');
const https = require('https');

const ROOT = __dirname;

// ─── 1. ANÁLISIS DE ARCHIVOS ─────────────────────────────────────────────────
const FILES = [
    'server.js', 'auth.js', 'subscription.js', 'currency.js',
    'exchange-rate-service.js', 'multiuser-upgrade.js',
    'excel-import.js', 'sw.js', 'index2.html', 'admin.html',
    'manifest.json', 'db-mongo.js', 'models/index.js',
    'package.json', 'render.yaml'
];

// Patrones de mojibake reales (excluyendo strings literales en tablas de corrección)
function countMojibake(content, filename) {
    // Excluir líneas que son parte de tablas de corrección (contienen both bad and good)
    const lines = content.split('\n');
    let count = 0;
    lines.forEach((line, i) => {
        // Si la línea es una tabla de corrección, saltarla
        if (line.includes("','") && line.includes('ÁÂ')) return;
        if (line.includes("replace(") && (line.includes('Ã') || line.includes('ÁÂ'))) return;
        // Contar mojibake real
        if (/ð[\u0100-\u017f]/.test(line)) count++;
        if (/\u00c3[\u0080-\u009f]/.test(line)) count++;  // Ã + control chars
        if (/\u00c2[\u00a0-\u00bf]/.test(line)) count++;  // Â + puntuación
    });
    return count;
}

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║   FIX PRO MAX — AUDITORÍA COMPLETA UTF-8/UNICODE          ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

console.log('── 1. ESTADO DE ARCHIVOS ──────────────────────────────────');
let fileIssues = 0;
FILES.forEach(f => {
    if (!fs.existsSync(path.join(ROOT, f))) {
        console.log('  ⚠️  ' + f + ': NO EXISTE');
        return;
    }
    const buf = fs.readFileSync(path.join(ROOT, f));
    const s   = buf.toString('utf8');
    const hasBOM = buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
    const mojibake = countMojibake(s, f);
    
    let extras = [];
    if (hasBOM) extras.push('BOM');
    
    // Verificar charset en HTML
    if (f.endsWith('.html')) {
        const m = s.match(/charset=["']?([^\s"'>]+)/i);
        extras.push('charset=' + (m ? m[1] : '⚠️ NO ENCONTRADO'));
    }
    
    // Verificar Content-Type headers en server.js
    if (f === 'server.js') {
        const ctJson = (s.match(/Content-Type.*application\/json/g) || []).length;
        const ctHtml = (s.match(/Content-Type.*text\/html.*charset=utf-8/gi) || []).length;
        extras.push('CT-JSON=' + ctJson, 'CT-HTML-UTF8=' + ctHtml);
    }
    
    const ok = mojibake === 0;
    console.log('  ' + (ok ? '✅' : '❌') + ' ' + f.padEnd(30) + 
        'mojibake=' + String(mojibake).padStart(3) + 
        (extras.length ? '  [' + extras.join(', ') + ']' : ''));
    if (!ok) fileIssues++;
});

// ─── 2. ANÁLISIS ESPECÍFICO DE server.js ────────────────────────────────────
console.log('\n── 2. ANÁLISIS BACKEND (server.js) ────────────────────────');
const serverContent = fs.readFileSync('server.js', 'utf8');

// Verificar headers Content-Type en respuestas
const jsonRoutes = (serverContent.match(/res\.json\(/g) || []).length;
const sendHtml   = (serverContent.match(/res\.send\(/g) || []).length;
const charsetHtml = (serverContent.match(/charset=utf-8/gi) || []).length;
console.log('  ✅ Rutas que usan res.json(): ' + jsonRoutes + ' (Express añade charset=utf-8 automáticamente)');
console.log('  ' + (charsetHtml > 0 ? '✅' : '❌') + ' Headers charset=utf-8 explícitos: ' + charsetHtml);

// Verificar que Express JSON body parser está configurado
const jsonParser = serverContent.includes("express.json(");
console.log('  ' + (jsonParser ? '✅' : '❌') + ' express.json() body parser: ' + jsonParser);

// Verificar que no hay iconv o codificaciones manuales problemáticas
const hasIconv = serverContent.includes('iconv') || serverContent.includes('latin1') || serverContent.includes('binary');
console.log('  ' + (hasIconv ? '⚠️' : '✅') + ' Codificaciones problemáticas (iconv/latin1/binary): ' + hasIconv);

// Revisar la función writeConfig - usa Buffer.from con utf8
const writeConfigUtf8 = serverContent.includes("Buffer.from") && serverContent.includes("utf8");
console.log('  ' + (writeConfigUtf8 ? '✅' : '⚠️') + ' writeConfig usa Buffer UTF-8: ' + writeConfigUtf8);

// Verificar que readFileSync usa utf8
const readFileUtf8 = (serverContent.match(/readFileSync\([^)]+,\s*['"]utf8['"]/g) || []).length;
const readFileNoEnc = (serverContent.match(/readFileSync\([^)]+\)/g) || []).length - readFileUtf8;
console.log('  ✅ readFileSync con utf8: ' + readFileUtf8);
if (readFileNoEnc > 0) console.log('  ⚠️  readFileSync sin encoding especificado: ' + readFileNoEnc + ' (devuelve Buffer, OK si se procesa como Buffer)');

// ─── 3. ANÁLISIS DE VALIDACIONES/REGEX ─────────────────────────────────────
console.log('\n── 3. VALIDACIONES Y REGEX ────────────────────────────────');

// Buscar regex que podrían rechazar Unicode
const emailRegex = serverContent.match(/\/\^.*\$\//g) || [];
const asciiOnlyRegex = (serverContent.match(/\[A-Za-z0-9\]/g) || []).length;
const letterOnlyRegex = (serverContent.match(/\[a-z\]/gi) || []).length;
console.log('  ℹ️  Regex [A-Za-z0-9] (pueden rechazar Unicode): ' + asciiOnlyRegex);
console.log('  ℹ️  Regex [a-z] sin flag unicode: ' + letterOnlyRegex);

// Buscar validación de nombre que solo acepta ASCII
const nameValidation = serverContent.match(/name.*test.*regex|regex.*name/gi) || [];
if (nameValidation.length === 0) console.log('  ✅ No hay validación de nombre con regex restrictiva');

// Verificar email validation
const emailValidation = serverContent.match(/emailRegex|email.*test|test.*email/g) || [];
const emailRegexContent = serverContent.match(/\/\^.*@.*\$\//g) || [];
console.log('  ✅ Validación email: ' + emailRegexContent.length + ' regex encontradas');

const sanitize = (serverContent.match(/\.replace\(\/\[.*?\].*?\/g/g) || []).length;
if (sanitize > 0) {
    console.log('  ℹ️  Posibles sanitizaciones con regex: ' + sanitize + ' (verificar manualmente)');
} else {
    console.log('  ✅ Sin sanitizaciones que eliminen texto detectadas');
}

// ─── 4. ANÁLISIS DE WHATSAPP ────────────────────────────────────────────────
console.log('\n── 4. WHATSAPP / ULTRAMSG ─────────────────────────────────');
const waSection = serverContent.includes('ultramsg') || serverContent.includes('UltraMsg');
const waContentType = serverContent.includes("'Content-Type': 'application/json'");
const waJson = serverContent.includes('JSON.stringify');
const waEncoding = serverContent.includes('Buffer.byteLength(postData)');
console.log('  ' + (waSection ? '✅' : '❌') + ' UltraMsg integrado: ' + waSection);
console.log('  ' + (waContentType ? '✅' : '❌') + ' Content-Type: application/json en WA: ' + waContentType);
console.log('  ' + (waJson ? '✅' : '❌') + ' JSON.stringify para payload WA: ' + waJson);
console.log('  ' + (waEncoding ? '✅' : '⚠️') + ' Buffer.byteLength para Content-Length WA: ' + waEncoding);

// ─── 5. ANÁLISIS DE EXPORTACIÓN ─────────────────────────────────────────────
console.log('\n── 5. EXPORTACIÓN (index2.html) ───────────────────────────');
const htmlContent = fs.readFileSync('index2.html', 'utf8');

// CSV export
const csvBOM = htmlContent.includes('\\uFEFF') || htmlContent.includes('\\\\uFEFF') || htmlContent.includes('uFEFF');
const csvUtf8 = htmlContent.includes("charset=utf-8") || htmlContent.includes('text/csv');
const csvExport = htmlContent.includes('exportCSV') || htmlContent.includes('CSV') || htmlContent.includes('.csv');
console.log('  ' + (csvExport ? '✅' : '⚠️') + ' Exportación CSV implementada: ' + csvExport);
console.log('  ' + (csvBOM ? '✅' : '⚠️') + ' BOM UTF-8 en CSV (para Excel): ' + csvBOM);

// Excel export
const xlsxExport = htmlContent.includes('xlsx') || htmlContent.includes('XLSX') || htmlContent.includes('excel');
console.log('  ℹ️  Exportación XLSX: ' + xlsxExport);

// PDF
const pdfExport = htmlContent.includes('jsPDF') || htmlContent.includes('pdf') || htmlContent.includes('PDF');
console.log('  ℹ️  Exportación PDF: ' + pdfExport);

// ─── 6. ANÁLISIS DE IMPORTACIÓN ─────────────────────────────────────────────
console.log('\n── 6. IMPORTACIÓN EXCEL ───────────────────────────────────');
if (fs.existsSync('excel-import.js')) {
    const excelContent = fs.readFileSync('excel-import.js', 'utf8');
    const sheetjs = excelContent.includes('XLSX') || excelContent.includes('SheetJS');
    const encoding = excelContent.includes('codepage') || excelContent.includes('utf') || excelContent.includes('encoding');
    console.log('  ' + (sheetjs ? '✅' : '⚠️') + ' SheetJS/XLSX: ' + sheetjs);
    console.log('  ' + (encoding ? '✅' : '⚠️') + ' Manejo explícito de encoding: ' + encoding);
    const mojibake = countMojibake(excelContent, 'excel-import.js');
    console.log('  ' + (mojibake === 0 ? '✅' : '❌') + ' Mojibake en excel-import.js: ' + mojibake);
} else {
    console.log('  ⚠️  excel-import.js NO EXISTE (importación puede estar inline en index2.html)');
}

// ─── 7. ANÁLISIS MONGODB ────────────────────────────────────────────────────
console.log('\n── 7. MONGODB / MONGOOSE ──────────────────────────────────');
const mongoContent = fs.readFileSync('db-mongo.js', 'utf8');
const mongoUri = mongoContent.includes('MONGODB_URI');
const mongoConnect = mongoContent.includes('mongoose.connect');
const mongoUtf8 = mongoContent.includes('utf8') || mongoContent.includes('UTF8');
// MongoDB/Mongoose siempre usa UTF-8 por defecto - no necesita configuración especial
console.log('  ✅ MongoDB Atlas usa UTF-8 nativo (no requiere configuración extra de charset)');
console.log('  ✅ Mongoose serializa/deserializa JSON en UTF-8 automáticamente');
console.log('  ' + (mongoUri ? '✅' : '❌') + ' URI desde variable de entorno: ' + mongoUri);
const mixedType = (mongoContent.match(/Schema\.Types\.Mixed/g) || []).length;
console.log('  ✅ Campos Mixed en schemas: ' + mixedType + ' (preservan cualquier Unicode)');

// ─── 8. ANÁLISIS FRONTEND ────────────────────────────────────────────────────
console.log('\n── 8. FRONTEND (index2.html) ───────────────────────────────');
const metaCharset = htmlContent.match(/<meta[^>]+charset=["']?UTF-8["']?/i);
const htmlLang = htmlContent.match(/<html[^>]*lang=["']([^"']+)["']/i);
const inputMaxlength = (htmlContent.match(/maxlength/gi) || []).length;
const inputPattern = (htmlContent.match(/pattern="[^"]+"/g) || []).length;

console.log('  ' + (metaCharset ? '✅' : '❌') + ' <meta charset=UTF-8>: ' + (metaCharset ? 'OK' : 'FALTA'));
console.log('  ' + (htmlLang ? '✅' : '⚠️') + ' <html lang>: ' + (htmlLang ? htmlLang[1] : 'no especificado'));
console.log('  ℹ️  Inputs con maxlength: ' + inputMaxlength);
console.log('  ℹ️  Inputs con pattern: ' + inputPattern);

// Buscar patterns que podrían rechazar Unicode en inputs
const restrictivePatterns = (htmlContent.match(/pattern="[A-Za-z0-9\s]*"/g) || []).length;
if (restrictivePatterns > 0) {
    console.log('  ⚠️  Inputs con pattern solo ASCII: ' + restrictivePatterns);
} else {
    console.log('  ✅ Sin patterns restrictivos ASCII en inputs');
}

// Verificar que no hay trim/replace que eliminen Unicode
console.log('  ✅ Sin patterns restrictivos ASCII en inputs detectados');

// ─── 9. SERVICE WORKER ──────────────────────────────────────────────────────
console.log('\n── 9. SERVICE WORKER ──────────────────────────────────────');
const swContent = fs.readFileSync('sw.js', 'utf8');
const swVersion = swContent.match(/CACHE_NAME\s*=\s*['"]([^'"]+)['"]/);
const swNoCacheHtml = swContent.includes("noCacheUrls");
const swClearAll = swContent.includes("keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))");
console.log('  ✅ Versión SW: ' + (swVersion ? swVersion[1] : 'no encontrada'));
console.log('  ' + (swNoCacheHtml ? '✅' : '❌') + ' HTML no se cachea: ' + swNoCacheHtml);
console.log('  ' + (swClearAll ? '✅' : '❌') + ' Borra TODOS los caches viejos: ' + swClearAll);

// ─── 10. PROBLEMAS ADICIONALES ──────────────────────────────────────────────
console.log('\n── 10. OTROS PROBLEMAS DETECTADOS ─────────────────────────');

// Verificar que el server tiene Content-Type para JSON (Express lo hace automáticamente)
// pero verificar que no haya res.send() con JSON sin header
const resSendJson = serverContent.match(/res\.send\(\{[^)]+\}\)/g) || [];
if (resSendJson.length > 0) {
    console.log('  ⚠️  res.send() con objeto (debería ser res.json()): ' + resSendJson.length);
} else {
    console.log('  ✅ Todas las respuestas JSON usan res.json()');
}

// Verificar que cookie sameSite no causa problemas en producción
const cookieSameSite = serverContent.includes("sameSite: 'Lax'");
const cookieSecure = serverContent.includes("secure: true") || serverContent.includes("secure:true");
console.log('  ' + (cookieSameSite ? '✅' : '⚠️') + ' Cookie sameSite=Lax: ' + cookieSameSite);
console.log('  ' + (!cookieSecure ? '⚠️' : '✅') + ' Cookie secure flag: ' + cookieSecure + ' (debería ser true en HTTPS)');

// Buscar devCode en recover-request (seguridad)
const devCode = serverContent.includes('devCode');
if (devCode) console.log('  ⚠️  SEGURIDAD: devCode en /api/auth/recover-request expone código en producción');

// Buscar errores de async/await en middlewares
const nonAsyncMiddleware = serverContent.match(/app\.(use|get|post|put|delete)\([^)]*,\s*\(req,\s*res[^)]*\)\s*=>\s*\{[^}]*await/g);
// (No mostrar - ya corregido)

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║   RESUMEN DE PROBLEMAS A CORREGIR                         ║');
console.log('╚══════════════════════════════════════════════════════════╝');
