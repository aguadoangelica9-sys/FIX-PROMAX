/**
 * generate-ssl-cert.js — Genera certificado SSL auto-firmado para desarrollo local
 *
 * Usa `selfsigned` (devDependency). Los archivos se guardan en ./ssl/
 *
 * Uso:
 *   node generate-ssl-cert.js
 *
 * Resultado:
 *   ssl/cert.pem   — Certificado público (auto-firmado, RSA 2048 / SHA-256)
 *   ssl/key.pem    — Clave privada (NUNCA subir a Git)
 *
 * NOTA:
 *   - Solo para DESARROLLO LOCAL.
 *   - En producción (Render.com) HTTPS es automático y gratuito — no se usan estos archivos.
 *   - El navegador mostrará advertencia de cert auto-firmado; acepta la excepción.
 */

'use strict';

const selfsigned = require('selfsigned');
const fs         = require('fs');
const path       = require('path');
const tls        = require('tls');

const SSL_DIR = path.join(__dirname, 'ssl');

async function main() {
    // Crear directorio ssl/ si no existe
    if (!fs.existsSync(SSL_DIR)) {
        fs.mkdirSync(SSL_DIR, { recursive: true });
        console.log('📁 Directorio ssl/ creado');
    }

    console.log('🔑 Generando certificado SSL auto-firmado (RSA 2048 / SHA-256)...');

    // Atributos del certificado (solo campos soportados por selfsigned v5)
    const attrs = [
        { name: 'commonName',  value: 'localhost'  },
        { name: 'countryName', value: 'VE'         },
    ];

    // selfsigned v5 es async y devuelve Promise
    const pems = await selfsigned.generate(attrs, {
        keySize:   2048,   // RSA 2048 bits
        days:      365,    // Válido 1 año
        algorithm: 'sha256',
    });

    const certData = pems.cert;
    const keyData  = pems.private;

    if (!certData || !keyData) {
        console.error('❌ Error: selfsigned no devolvió los campos esperados.');
        console.error('   Campos disponibles:', Object.keys(pems));
        process.exit(1);
    }

    // Verificar que Node.js TLS acepta los certificados
    try {
        tls.createSecureContext({ cert: certData, key: keyData });
        console.log('✅ Verificación TLS OK — certificados válidos');
    } catch (err) {
        console.error('❌ TLS rechazó los certificados:', err.message);
        process.exit(1);
    }

    // Guardar archivos
    const certPath = path.join(SSL_DIR, 'cert.pem');
    const keyPath  = path.join(SSL_DIR, 'key.pem');

    fs.writeFileSync(certPath, certData, { mode: 0o644 }); // legible
    fs.writeFileSync(keyPath,  keyData,  { mode: 0o600 }); // solo owner

    console.log('');
    console.log('✅ Certificados SSL generados exitosamente:');
    console.log(`   📄 Certificado : ${certPath}`);
    console.log(`   🔑 Clave privada: ${keyPath}`);
    console.log('');
    console.log('⚠️  RECORDATORIOS:');
    console.log('   • Auto-firmados → solo para DESARROLLO LOCAL');
    console.log('   • En producción (Render.com) HTTPS es automático — no se usan');
    console.log('   • ssl/key.pem está en .gitignore — NUNCA lo subas a Git');
    console.log('   • Al abrir https://localhost:3443 acepta la excepción de seguridad');
    console.log('');
    console.log('🚀 Para iniciar con HTTPS local:');
    console.log('   $env:NODE_ENV="development"; node server.js');
    console.log('   Luego abre: https://localhost:3443');
    console.log('');
}

main().catch(err => {
    console.error('❌ Error inesperado:', err.message);
    process.exit(1);
});
