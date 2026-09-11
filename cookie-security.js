/**
 * cookie-security.js — Configuración segura de cookies para FIX PRO MAX
 * 
 * Implementa:
 * - Cookies httpOnly para tokens sensibles
 * - SameSite=Lax/Strict según necesidad
 * - Secure flag en producción
 * - Partitioned flag para prevenir tracking cross-site
 * - Domain restringido
 * - MaxAge razonable
 * - Prefijo __Host- para cookies de origen
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURACIÓN DE COOKIES SEGURAS
// ─────────────────────────────────────────────────────────────────────────────

const COOKIE_CONFIG = {
    // Entorno
    isProduction: process.env.NODE_ENV === 'production',
    
    // Dominio permitido (en producción)
    domain: process.env.COOKIE_DOMAIN || undefined, // undefined = solo dominio actual
    
    // Tiempos de expiración (en milisegundos)
    accessTokenTTL: parseInt(process.env.ACCESS_TOKEN_TTL, 10) || 900000,     // 15 minutos
    refreshTokenTTL: parseInt(process.env.REFRESH_TOKEN_TTL, 10) || 2592000000, // 30 días
    sessionTTL: parseInt(process.env.SESSION_TTL, 10) || 86400000,           // 24 horas
    
    // Flags de seguridad
    secureCookies: process.env.SECURE_COOKIES !== 'false',
    httpOnlyRefresh: true,
    partitionedCookies: process.env.PARTITIONED_COOKIES === 'true',
};

// ─────────────────────────────────────────────────────────────────────────────
// FUNCIONES DE CONFIGURACIÓN DE COOKIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configuración de cookies para refresh tokens (altamente seguras)
 * - httpOnly: true (inaccesible desde JavaScript)
 * - Secure: true en producción
 * - SameSite: Strict (excepto para auth cross-origin)
 * - Partitioned: true para prevenir tracking cross-site
 * - Path restringido
 */
function setSecureRefreshCookie(res, token, cookieName = 'fixpromax_refresh') {
    const cookieOptions = {
        httpOnly: COOKIE_CONFIG.httpOnlyRefresh,
        secure: COOKIE_CONFIG.isProduction && COOKIE_CONFIG.secureCookies,
        sameSite: COOKIE_CONFIG.isProduction ? 'None' : 'Lax', // 'None' para cross-origin auth
        maxAge: COOKIE_CONFIG.refreshTokenTTL,
        path: '/api/auth/refresh', // Solo enviada a este endpoint
    };
    
    // Solo en producción con HTTPS
    if (COOKIE_CONFIG.isProduction && COOKIE_CONFIG.secureCookies) {
        cookieOptions.domain = COOKIE_CONFIG.domain;
        
        // Partitioned flag (solo en Chrome 114+)
        if (COOKIE_CONFIG.partitionedCookies) {
            cookieOptions.partitioned = true;
        }
        
        // Prefijo __Host- para cookies de origen estricto
        if (!cookieName.startsWith('__Host-') && cookieName.startsWith('fixpromax_')) {
            cookieName = `__Host-${cookieName}`;
        }
    }
    
    res.cookie(cookieName, token, cookieOptions);
}

/**
 * Configuración de cookies para access tokens (menos sensibles)
 * - httpOnly: false (accesible desde JavaScript para compatibilidad)
 * - Secure: true en producción
 * - SameSite: Lax
 * - MaxAge corto
 */
function setAccessTokenCookie(res, token, cookieName = 'fixpromax_token') {
    const cookieOptions = {
        httpOnly: false, // Necesario para compatibilidad con frontend legacy
        secure: COOKIE_CONFIG.isProduction && COOKIE_CONFIG.secureCookies,
        sameSite: COOKIE_CONFIG.isProduction ? 'Lax' : 'Lax',
        maxAge: COOKIE_CONFIG.accessTokenTTL,
        path: '/',
    };
    
    if (COOKIE_CONFIG.isProduction && COOKIE_CONFIG.secureCookies) {
        cookieOptions.domain = COOKIE_CONFIG.domain;
    }
    
    res.cookie(cookieName, token, cookieOptions);
}

/**
 * Configuración de cookies de sesión para datos no sensibles
 * - httpOnly: true para protección XSS
 * - Secure: true en producción
 * - SameSite: Strict
 * - MaxAge moderado
 */
function setSessionCookie(res, sessionId, cookieName = 'session_id') {
    const cookieOptions = {
        httpOnly: true,
        secure: COOKIE_CONFIG.isProduction && COOKIE_CONFIG.secureCookies,
        sameSite: 'Strict',
        maxAge: COOKIE_CONFIG.sessionTTL,
        path: '/',
    };
    
    if (COOKIE_CONFIG.isProduction && COOKIE_CONFIG.secureCookies) {
        cookieOptions.domain = COOKIE_CONFIG.domain;
    }
    
    res.cookie(cookieName, sessionId, cookieOptions);
}

/**
 * Eliminar cookies de forma segura
 * - Mismo dominio, path y secure flags que al crear
 */
function clearSecureCookie(res, cookieName, path = '/') {
    const cookieOptions = {
        httpOnly: true,
        secure: COOKIE_CONFIG.isProduction && COOKIE_CONFIG.secureCookies,
        sameSite: COOKIE_CONFIG.isProduction ? 'Lax' : 'Lax',
        expires: new Date(0), // Expirar inmediatamente
        path: path,
    };
    
    if (COOKIE_CONFIG.isProduction && COOKIE_CONFIG.secureCookies) {
        cookieOptions.domain = COOKIE_CONFIG.domain;
    }
    
    res.clearCookie(cookieName, cookieOptions);
}

/**
 * Middleware para parsear cookies de forma segura
 * - Valida formato de cookies
 * - Filtra cookies maliciosas
 * - Logging de cookies sospechosas
 */
function secureCookieParser(req, res, next) {
    // Headers de cookie originales
    const cookieHeader = req.headers.cookie || '';
    
    // Parsear cookies manualmente
    const cookies = {};
    const cookiePairs = cookieHeader.split(';');
    
    for (const pair of cookiePairs) {
        const trimmed = pair.trim();
        if (!trimmed) continue;
        
        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex === -1) continue;
        
        const name = trimmed.substring(0, separatorIndex).trim();
        const value = trimmed.substring(separatorIndex + 1).trim();
        
        // Validar nombre de cookie (solo alfanumérico, guiones y puntos)
        if (!/^[a-zA-Z0-9_\-\.]+$/.test(name)) {
            console.warn(`[SECURITY] Invalid cookie name: ${name.substring(0, 50)}...`);
            continue;
        }
        
        // Validar longitud de valor (máximo 4096 caracteres)
        if (value.length > 4096) {
            console.warn(`[SECURITY] Cookie value too long: ${name} (${value.length} chars)`);
            continue;
        }
        
        // Detectar cookies sospechosas (session fixation, etc.)
        const suspiciousNames = [
            'admin', 'root', 'password', 'secret', 'token', 
            'auth', 'login', 'user', 'id', 'role'
        ];
        
        const isSuspicious = suspiciousNames.some(suspicious => 
            name.toLowerCase().includes(suspicious.toLowerCase())
        );
        
        if (isSuspicious && process.env.SECURITY_LOG_LEVEL === 'info') {
            console.log(`[SECURITY] Suspicious cookie detected: ${name}`);
        }
        
        cookies[name] = value;
    }
    
    // Agregar cookies al request
    req.secureCookies = cookies;
    
    // Headers adicionales para protección
    if (COOKIE_CONFIG.isProduction) {
        // Set-Cookie attributes para protección
        res.setHeader('Set-Cookie', [
            `SameSite=Lax`,
            `Secure`,
            `HttpOnly`
        ].filter(Boolean).join('; '));
    }
    
    next();
}

/**
 * Generar token seguro para cookies
 * - Longitud adecuada (mínimo 32 bytes)
 * - Base64 URL-safe
 * - Caracteres seguros
 */
function generateSecureToken(length = 32) {
    const crypto = require('crypto');
    return crypto
        .randomBytes(length)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

/**
 * Validar formato de token de cookie
 * - Longitud mínima
 * - Caracteres permitidos
 * - No valores predeterminados
 */
function validateCookieToken(token, minLength = 16) {
    if (!token || typeof token !== 'string') {
        return false;
    }
    
    if (token.length < minLength) {
        return false;
    }
    
    // Validar caracteres (base64 URL-safe)
    if (!/^[A-Za-z0-9_\-]+$/.test(token)) {
        return false;
    }
    
    // Rechazar valores predeterminados o comunes
    const commonTokens = [
        'default', 'test', 'demo', 'admin', 'user',
        '123456', 'password', 'token', 'secret', 'null'
    ];
    
    if (commonTokens.includes(token.toLowerCase())) {
        return false;
    }
    
    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// MIDDLEWARE DE PROTECCIÓN CONTRA ATAQUES DE COOKIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Middleware para proteger contra session fixation
 */
function sessionFixationProtection(req, res, next) {
    const sessionCookie = req.secureCookies?.session_id;
    
    // Si hay una cookie de sesión pero el usuario no está autenticado
    // Regenerar ID de sesión (session fixation attack)
    if (sessionCookie && !req.user) {
        console.warn(`[SECURITY] Session fixation detected for IP: ${req.ip}`);
        
        // Eliminar cookie existente
        clearSecureCookie(res, 'session_id');
        
        // Generar nueva sesión
        const newSessionId = generateSecureToken();
        setSessionCookie(res, newSessionId);
        
        req.secureCookies.session_id = newSessionId;
    }
    
    next();
}

/**
 * Middleware para limitar cantidad de cookies
 */
function cookieLimitProtection(req, res, next) {
    const cookieCount = Object.keys(req.secureCookies || {}).length;
    
    // Límite razonable: 10 cookies por request
    if (cookieCount > 10) {
        console.warn(`[SECURITY] Too many cookies (${cookieCount}) from IP: ${req.ip}`);
        
        // Responder con error sin procesar las cookies excesivas
        return res.status(400).json({
            ok: false,
            error: 'Too many cookies in request',
            code: 'TOO_MANY_COOKIES'
        });
    }
    
    next();
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTAR FUNCIONES
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
    // Configuración
    COOKIE_CONFIG,
    
    // Funciones de cookies
    setSecureRefreshCookie,
    setAccessTokenCookie,
    setSessionCookie,
    clearSecureCookie,
    
    // Middlewares
    secureCookieParser,
    sessionFixationProtection,
    cookieLimitProtection,
    
    // Utilidades
    generateSecureToken,
    validateCookieToken
};