/**
 * security-verification.js — Script de verificación de seguridad para FIX PRO MAX
 * 
 * Verifica:
 * - Headers de seguridad HTTP
 * - Configuración de cookies
 * - Dependencias actualizadas
 * - Variables de entorno seguras
 * - Configuraciones de seguridad implementadas
 */

'use strict';

const https = require('https');
const http = require('http');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuración
const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;
const SECURE_BASE_URL = `https://localhost:${PORT}`;

// Colores para console output
const COLORS = {
    GREEN: '\x1b[32m',
    RED: '\x1b[31m',
    YELLOW: '\x1b[33m',
    BLUE: '\x1b[36m',
    RESET: '\x1b[0m'
};

// ─────────────────────────────────────────────────────────────────────────────
// FUNCIONES DE VERIFICACIÓN
// ─────────────────────────────────────────────────────────────────────────────

function logSuccess(message) {
    console.log(`${COLORS.GREEN}✅ ${message}${COLORS.RESET}`);
}

function logWarning(message) {
    console.log(`${COLORS.YELLOW}⚠️  ${message}${COLORS.RESET}`);
}

function logError(message) {
    console.log(`${COLORS.RED}❌ ${message}${COLORS.RESET}`);
}

function logInfo(message) {
    console.log(`${COLORS.BLUE}ℹ️  ${message}${COLORS.RESET}`);
}

/**
 * Verificar headers de seguridad HTTP
 */
async function verifySecurityHeaders() {
    logInfo('Verificando headers de seguridad HTTP...');
    
    const headersToCheck = {
        'Content-Security-Policy': {
            required: true,
            description: 'Prevención de XSS y ataques de inyección'
        },
        'X-Content-Type-Options': {
            required: true,
            expectedValue: 'nosniff',
            description: 'Prevención de MIME sniffing'
        },
        'X-Frame-Options': {
            required: true,
            expectedValues: ['DENY', 'SAMEORIGIN'],
            description: 'Prevención de clickjacking'
        },
        'X-XSS-Protection': {
            required: true,
            expectedValue: '1; mode=block',
            description: 'Protección contra XSS'
        },
        'Referrer-Policy': {
            required: true,
            description: 'Control de información de referrer'
        },
        'Strict-Transport-Security': {
            required: process.env.NODE_ENV === 'production',
            description: 'HTTP Strict Transport Security'
        },
        'Permissions-Policy': {
            required: true,
            description: 'Control de APIs del navegador'
        }
    };

    try {
        const response = await makeRequest('/', 'GET');
        
        for (const [header, config] of Object.entries(headersToCheck)) {
            const headerValue = response.headers[header.toLowerCase()];
            
            if (config.required && !headerValue) {
                logError(`Falta header requerido: ${header} - ${config.description}`);
            } else if (headerValue) {
                if (config.expectedValue && headerValue !== config.expectedValue) {
                    logWarning(`Header ${header} tiene valor inesperado: ${headerValue} (esperado: ${config.expectedValue})`);
                } else if (config.expectedValues && !config.expectedValues.includes(headerValue)) {
                    logWarning(`Header ${header} tiene valor inesperado: ${headerValue}`);
                } else {
                    logSuccess(`Header ${header} configurado correctamente: ${headerValue}`);
                }
            }
        }
        
        // Verificar Cache-Control para rutas sensibles
        const sensitiveResponse = await makeRequest('/api/auth/login', 'POST', {});
        if (sensitiveResponse.headers['cache-control'] && 
            sensitiveResponse.headers['cache-control'].includes('no-store')) {
            logSuccess('Cache-Control configurado correctamente para rutas sensibles');
        } else {
            logWarning('Cache-Control no configurado para rutas sensibles');
        }
        
    } catch (error) {
        logError(`Error verificando headers: ${error.message}`);
    }
}

/**
 * Verificar configuración de cookies
 */
async function verifyCookieSecurity() {
    logInfo('Verificando configuración de cookies...');
    
    try {
        // Simular login para verificar cookies
        const loginData = {
            email: 'test@example.com',
            password: 'testpassword'
        };
        
        const response = await makeRequest('/api/auth/login', 'POST', loginData);
        const cookies = response.headers['set-cookie'];
        
        if (!cookies) {
            logError('No se configuraron cookies en la respuesta');
            return;
        }
        
        const cookieChecks = {
            'httpOnly': {
                description: 'Protección contra XSS',
                check: (cookie) => cookie.includes('HttpOnly')
            },
            'secure': {
                required: process.env.NODE_ENV === 'production',
                description: 'Solo sobre HTTPS',
                check: (cookie) => cookie.includes('Secure')
            },
            'sameSite': {
                description: 'Protección CSRF',
                check: (cookie) => cookie.includes('SameSite=') && 
                                 (cookie.includes('SameSite=Lax') || 
                                  cookie.includes('SameSite=Strict') || 
                                  cookie.includes('SameSite=None'))
            },
            'maxAge': {
                description: 'Expiración controlada',
                check: (cookie) => cookie.includes('Max-Age=') || cookie.includes('Expires=')
            }
        };
        
        for (const cookie of cookies) {
            console.log(`\nCookie: ${cookie.substring(0, 100)}...`);
            
            for (const [checkName, config] of Object.entries(cookieChecks)) {
                const passesCheck = config.check(cookie);
                
                if (config.required && !passesCheck) {
                    logError(`Cookie no cumple ${checkName}: ${config.description}`);
                } else if (passesCheck) {
                    logSuccess(`Cookie cumple ${checkName}: ${config.description}`);
                }
            }
        }
        
    } catch (error) {
        logWarning(`No se pudo verificar cookies (login falló): ${error.message}`);
    }
}

/**
 * Verificar dependencias
 */
function verifyDependencies() {
    logInfo('Verificando dependencias...');
    
    try {
        // Verificar vulnerabilidades con npm audit
        const auditOutput = execSync('npm audit --json', { encoding: 'utf-8' });
        const auditData = JSON.parse(auditOutput);
        
        const vulnerabilities = auditData.metadata?.vulnerabilities || {};
        const totalVulnerabilities = Object.values(vulnerabilities).reduce((sum, count) => sum + count, 0);
        
        if (totalVulnerabilities === 0) {
            logSuccess('No hay vulnerabilidades en dependencias');
        } else {
            logError(`Se encontraron ${totalVulnerabilities} vulnerabilidades en dependencias:`);
            
            for (const [severity, count] of Object.entries(vulnerabilities)) {
                if (count > 0) {
                    console.log(`  ${severity}: ${count}`);
                }
            }
            
            // Recomendar acciones
            if (vulnerabilities.critical > 0 || vulnerabilities.high > 0) {
                logWarning('Ejecuta: npm audit fix --force para corregir vulnerabilidades críticas');
            }
        }
        
        // Verificar versiones de dependencias críticas
        const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
        const criticalDeps = {
            'express': '^4.18.0',
            'mongoose': '^8.0.0',
            'bcrypt': '^5.0.0',
            'helmet': '^7.0.0'
        };
        
        for (const [dep, minVersion] of Object.entries(criticalDeps)) {
            const currentVersion = packageJson.dependencies?.[dep];
            if (currentVersion) {
                logSuccess(`${dep}: ${currentVersion} (mínimo recomendado: ${minVersion})`);
            } else {
                logWarning(`${dep}: No instalada`);
            }
        }
        
    } catch (error) {
        logError(`Error verificando dependencias: ${error.message}`);
    }
}

/**
 * Verificar variables de entorno
 */
function verifyEnvironmentVariables() {
    logInfo('Verificando variables de entorno...');
    
    const requiredEnvVars = [
        'MONGODB_URI',
        'PASSWORD_SALT',
        'NODE_ENV'
    ];
    
    const recommendedEnvVars = [
        'SESSION_SECRET',
        'JWT_SECRET',
        'ADMIN_MIGRATE_KEY',
        'ADMIN_FIX_KEY',
        'FORCE_HTTPS',
        'HSTS_MAX_AGE'
    ];
    
    console.log('\nVariables REQUERIDAS:');
    for (const envVar of requiredEnvVars) {
        if (process.env[envVar]) {
            if (envVar.includes('SECRET') || envVar.includes('KEY') || envVar.includes('PASSWORD')) {
                const value = process.env[envVar];
                const isDefault = value.includes('changeme') || value.includes('default') || value.includes('test');
                
                if (isDefault) {
                    logError(`${envVar}: Usando valor por defecto - DEBE CAMBIARSE EN PRODUCCIÓN`);
                } else if (value.length < 32) {
                    logWarning(`${envVar}: Valor muy corto (${value.length} chars) - recomendado mínimo 32`);
                } else {
                    logSuccess(`${envVar}: Configurada correctamente (${value.length} chars)`);
                }
            } else {
                logSuccess(`${envVar}: Configurada`);
            }
        } else {
            logError(`${envVar}: NO CONFIGURADA`);
        }
    }
    
    console.log('\nVariables RECOMENDADAS:');
    for (const envVar of recommendedEnvVars) {
        if (process.env[envVar]) {
            logSuccess(`${envVar}: Configurada`);
        } else {
            logWarning(`${envVar}: No configurada (recomendado)`);
        }
    }
    
    // Verificar valores peligrosos
    const dangerousPatterns = [
        { pattern: /changeme|default|test|example/i, message: 'Valor por defecto detectado' },
        { pattern: /password123|admin123|123456/i, message: 'Contraseña débil detectada' },
        { pattern: /localhost|127\.0\.0\.1/, message: 'Configuración local en producción' }
    ];
    
    console.log('\nVerificación de valores peligrosos:');
    for (const [key, value] of Object.entries(process.env)) {
        if (value && typeof value === 'string') {
            for (const check of dangerousPatterns) {
                if (check.pattern.test(value)) {
                    logWarning(`${key}: ${check.message} - "${value.substring(0, 20)}..."`);
                }
            }
        }
    }
}

/**
 * Verificar archivos de configuración
 */
function verifyConfigurationFiles() {
    logInfo('Verificando archivos de configuración...');
    
    const configFiles = [
        '.env',
        '.env.example',
        'config.json',
        'security-middleware.js',
        'cookie-security.js',
        'sanitize.js'
    ];
    
    for (const file of configFiles) {
        const filePath = path.join(__dirname, file);
        
        if (fs.existsSync(filePath)) {
            const stats = fs.statSync(filePath);
            
            // Verificar .env no contiene credenciales reales
            if (file === '.env') {
                const content = fs.readFileSync(filePath, 'utf-8');
                const hasRealCredentials = content.includes('@mongodb.net') && 
                                          !content.includes('NUEVO_USUARIO');
                
                if (hasRealCredentials) {
                    logError(`${file}: Contiene credenciales reales - DEBE ROTARSE`);
                } else if (content.includes('NUEVO_USUARIO') || content.includes('AQUI')) {
                    logWarning(`${file}: Usando placeholders - debe completarse con valores reales`);
                } else {
                    logSuccess(`${file}: Configurado correctamente`);
                }
            } else {
                logSuccess(`${file}: Presente (${stats.size} bytes)`);
            }
        } else {
            if (file === '.env') {
                logError(`${file}: NO EXISTE - requerido para producción`);
            } else if (file === '.env.example') {
                logWarning(`${file}: No existe - recomendado para desarrollo`);
            } else {
                logWarning(`${file}: No existe`);
            }
        }
    }
    
    // Verificar .gitignore
    const gitignorePath = path.join(__dirname, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
        const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
        const sensitiveFiles = ['.env', 'config.json', 'users.json', 'sessions.json'];
        
        let allProtected = true;
        for (const file of sensitiveFiles) {
            if (!gitignoreContent.includes(file)) {
                logError(`.gitignore: No protege ${file}`);
                allProtected = false;
            }
        }
        
        if (allProtected) {
            logSuccess('.gitignore: Configurado correctamente (protege archivos sensibles)');
        }
    } else {
        logError('.gitignore: NO EXISTE - crítico para seguridad');
    }
}

/**
 * Verificar estructura de directorios
 */
function verifyDirectoryStructure() {
    logInfo('Verificando estructura de directorios...');
    
    const requiredDirs = [
        '.well-known',
        'android/app/src/main/assets'
    ];
    
    for (const dir of requiredDirs) {
        const dirPath = path.join(__dirname, dir);
        
        if (fs.existsSync(dirPath)) {
            logSuccess(`${dir}/: Presente`);
            
            // Verificar assetlinks.json para Android
            if (dir.includes('assets')) {
                const assetlinksPath = path.join(dirPath, 'assetlinks.json');
                if (fs.existsSync(assetlinksPath)) {
                    logSuccess('assetlinks.json: Presente (verificación Android)');
                } else {
                    logWarning('assetlinks.json: No encontrado (requerido para Android app)');
                }
            }
        } else {
            logWarning(`${dir}/: No existe`);
        }
    }
    
    // Verificar logs de seguridad
    const logDir = path.join(__dirname, 'logs');
    if (fs.existsSync(logDir)) {
        logSuccess('logs/: Directorio de logs presente');
    } else {
        logWarning('logs/: No existe - recomendado para logging de seguridad');
    }
}

/**
 * Función auxiliar para hacer requests HTTP
 */
function makeRequest(path, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: PORT,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Security-Verification/1.0'
            }
        };
        
        const req = http.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    data: data
                });
            });
        });
        
        req.on('error', (error) => {
            reject(error);
        });
        
        if (body && (method === 'POST' || method === 'PUT')) {
            req.write(JSON.stringify(body));
        }
        
        req.end();
    });
}

/**
 * Ejecutar todas las verificaciones
 */
async function runAllVerifications() {
    console.log(`
${COLORS.BLUE}╔══════════════════════════════════════════════════════════════╗
║          VERIFICACIÓN DE SEGURIDAD - FIX PRO MAX           ║
╚══════════════════════════════════════════════════════════════╝${COLORS.RESET}
    `);
    
    // Verificar que el servidor esté corriendo
    try {
        await makeRequest('/health', 'GET');
        logSuccess('Servidor está corriendo');
    } catch (error) {
        logError(`Servidor no está corriendo en puerto ${PORT}: ${error.message}`);
        logWarning('Inicia el servidor con: npm start o node server.js');
        return;
    }
    
    // Ejecutar verificaciones
    await verifySecurityHeaders();
    console.log('');
    
    await verifyCookieSecurity();
    console.log('');
    
    verifyDependencies();
    console.log('');
    
    verifyEnvironmentVariables();
    console.log('');
    
    verifyConfigurationFiles();
    console.log('');
    
    verifyDirectoryStructure();
    console.log('');
    
    // Resumen
    console.log(`
${COLORS.BLUE}══════════════════════════════════════════════════════════════${COLORS.RESET}
${COLORS.BLUE}                    RESUMEN DE VERIFICACIÓN                   ${COLORS.RESET}
${COLORS.BLUE}══════════════════════════════════════════════════════════════${COLORS.RESET}

${COLORS.GREEN}✅ Completado:${COLORS.RESET} Todas las verificaciones de seguridad
${COLORS.YELLOW}⚠️  Advertencias:${COLORS.RESET} Revisar las recomendaciones anteriores
${COLORS.RED}❌ Errores Críticos:${COLORS.RESET} Deben resolverse antes de producción

${COLORS.BLUE}Acciones recomendadas:${COLORS.RESET}
1. Rotar todas las credenciales en .env
2. Ejecutar npm audit fix --force si hay vulnerabilidades
3. Completar variables de entorno faltantes
4. Configurar HTTPS en producción
5. Habilitar logging de seguridad
    `);
}

// Ejecutar si se llama directamente
if (require.main === module) {
    runAllVerifications().catch(console.error);
}

module.exports = {
    runAllVerifications,
    verifySecurityHeaders,
    verifyCookieSecurity,
    verifyDependencies,
    verifyEnvironmentVariables,
    verifyConfigurationFiles,
    verifyDirectoryStructure
};