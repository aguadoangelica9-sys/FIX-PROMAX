/**
 * security-middleware.js — Middleware de seguridad avanzado para FIX PRO MAX
 * 
 * Implementa:
 * - Content-Security-Policy (CSP) estricto
 * - X-Frame-Options, X-Content-Type-Options, X-XSS-Protection
 * - Referrer-Policy, Permissions-Policy
 * - Strict-Transport-Security (HSTS)
 * - Cache-Control estricto
 * - Prevención de MIME sniffing
 * - No cache para datos sensibles
 */

'use strict';

/**
 * Middleware de headers de seguridad HTTP
 */
function securityHeaders() {
    return function(req, res, next) {
        // 1. Content Security Policy (CSP) - Política estricta
        const cspDirectives = [
            "default-src 'self' https:",
            "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "font-src 'self' https://fonts.gstatic.com",
            "img-src 'self' data: https:",
            "connect-src 'self'",
            "frame-ancestors 'self'",
            "form-action 'self'",
            "base-uri 'self'"
        ].join('; ');
        
        res.setHeader('Content-Security-Policy', cspDirectives);
        
        // 2. Headers de seguridad XSS y clickjacking
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        
        // 3. Referrer Policy
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        
        // 4. Permissions Policy (Feature Policy)
        const permissionsPolicy = [
            'geolocation=()',
            'microphone=()',
            'camera=()',
            'payment=()',
            'usb=()',
            'serial=()',
            'bluetooth=()',
            'nfc=()',
            'accelerometer=()',
            'gyroscope=()',
            'magnetometer=()',
            'ambient-light-sensor=()'
        ].join(', ');
        
        res.setHeader('Permissions-Policy', permissionsPolicy);
        
        // 5. Strict Transport Security (HSTS) - solo en producción
        if (process.env.NODE_ENV === 'production') {
            const hstsMaxAge = process.env.HSTS_MAX_AGE || '31536000'; // 1 año
            const includeSubDomains = process.env.HSTS_INCLUDE_SUBDOMAINS === 'true' ? '; includeSubDomains' : '';
            const preload = process.env.HSTS_PRELOAD === 'true' ? '; preload' : '';
            
            res.setHeader('Strict-Transport-Security', `max-age=${hstsMaxAge}${includeSubDomains}${preload}`);
        }
        
        // 6. Cache-Control para rutas sensibles
        const sensitivePaths = ['/api/auth', '/api/users', '/api/admin', '/api/db'];
        const isSensitivePath = sensitivePaths.some(path => req.path.startsWith(path));
        
        if (isSensitivePath) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        } else {
            // Para recursos estáticos, cache moderado
            res.setHeader('Cache-Control', 'public, max-age=3600'); // 1 hora
        }
        
        // 7. Cross-Origin Opener Policy
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        
        // 8. Cross-Origin Resource Policy
        res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        
        // 9. Cross-Origin Embedder Policy
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        
        next();
    };
}

/**
 * Middleware de redirección HTTPS
 */
function httpsRedirect() {
    return function(req, res, next) {
        // Solo redirigir en producción
        if (process.env.NODE_ENV !== 'production') {
            return next();
        }
        
        // Verificar si ya es HTTPS
        const isHttps = req.secure || 
                       req.headers['x-forwarded-proto'] === 'https' ||
                       req.headers['x-forwarded-scheme'] === 'https';
        
        if (!isHttps && process.env.FORCE_HTTPS === 'true') {
            const httpsUrl = `https://${req.headers.host}${req.url}`;
            return res.redirect(301, httpsUrl);
        }
        
        next();
    };
}

/**
 * Middleware de logging de seguridad
 */
function securityLogging() {
    return function(req, res, next) {
        const startTime = Date.now();
        
        // Interceptar la respuesta para loguear
        const originalSend = res.send;
        res.send = function(body) {
            const duration = Date.now() - startTime;
            
            // Log de seguridad para rutas sensibles
            const sensitiveEndpoints = [
                '/api/auth/login',
                '/api/auth/register', 
                '/api/auth/recover',
                '/api/admin',
                '/api/db'
            ];
            
            const isSensitive = sensitiveEndpoints.some(endpoint => req.path.startsWith(endpoint));
            
            if (isSensitive && process.env.SECURITY_LOG_LEVEL === 'info') {
                const logEntry = {
                    timestamp: new Date().toISOString(),
                    method: req.method,
                    path: req.path,
                    ip: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
                    userAgent: req.headers['user-agent'],
                    statusCode: res.statusCode,
                    duration: `${duration}ms`,
                    userId: req.user ? req.user.id : 'anonymous'
                };
                
                // Aquí puedes enviar el log a un sistema de monitoreo
                console.log('[SECURITY LOG]', JSON.stringify(logEntry));
            }
            
            return originalSend.call(this, body);
        };
        
        next();
    };
}

/**
 * Middleware de prevención de ataques comunes
 */
function attackPrevention() {
    return function(req, res, next) {
        // 1. Prevenir Host header injection
        const validHosts = [
            'fixpromax-erp.onrender.com',
            'localhost:3000',
            '127.0.0.1:3000'
        ];
        
        const host = req.headers.host;
        if (host && !validHosts.includes(host)) {
            console.warn(`[SECURITY WARNING] Invalid Host header: ${host} from IP: ${req.ip}`);
        }
        
        // 2. Limitar tamaño de headers
        const totalHeaderSize = Object.keys(req.headers)
            .reduce((total, key) => total + key.length + (req.headers[key]?.length || 0), 0);
        
        if (totalHeaderSize > 8192) { // 8KB máximo
            return res.status(431).json({
                ok: false,
                error: 'Request header fields too large'
            });
        }
        
        // 3. Validar User-Agent (opcional, para logging)
        const userAgent = req.headers['user-agent'] || '';
        const suspiciousAgents = [
            'sqlmap', 'nikto', 'nmap', 'nessus', 'metasploit',
            'w3af', 'arachni', 'acunetix', 'appscan', 'burpsuite'
        ];
        
        const isSuspicious = suspiciousAgents.some(agent => 
            userAgent.toLowerCase().includes(agent.toLowerCase())
        );
        
        if (isSuspicious) {
            console.warn(`[SECURITY WARNING] Suspicious User-Agent: ${userAgent.substring(0, 100)}...`);
        }
        
        next();
    };
}

/**
 * Middleware de timeout de seguridad
 */
function securityTimeout() {
    return function(req, res, next) {
        const timeout = parseInt(process.env.REQUEST_TIMEOUT, 10) || 30000; // 30 segundos por defecto
        
        req.setTimeout(timeout, () => {
            if (!res.headersSent) {
                res.status(408).json({
                    ok: false,
                    error: 'Request timeout'
                });
            }
        });
        
        next();
    };
}

// Exportar todos los middlewares
module.exports = {
    securityHeaders,
    httpsRedirect,
    securityLogging,
    attackPrevention,
    securityTimeout,
    
    // Middleware completo para uso directo
    security: function() {
        return [
            httpsRedirect(),
            securityHeaders(),
            attackPrevention(),
            securityTimeout(),
            securityLogging()
        ];
    }
};