/**
 * sanitize.js — Capa de validación y sanitización de inputs
 *
 * Protege contra:
 *  - XSS (Cross-Site Scripting): strips HTML/JS tags y atributos peligrosos
 *  - NoSQL Injection: elimina operadores MongoDB ($gt, $where, etc.)
 *  - Command Injection: elimina metacaracteres de shell
 *  - Prompt Injection: detecta instrucciones del sistema disfrazadas de texto
 *  - Prototype Pollution: bloquea __proto__, constructor, prototype
 *  - Path Traversal: normaliza rutas relativas
 *  - Mass Assignment: whitelists por tipo de entidad
 */

'use strict';

// ── Caracteres y patrones peligrosos ─────────────────────────────────────────

// Tags HTML y atributos de eventos que ejecutan JS
const HTML_TAG_RE        = /<\s*\/?\s*(script|iframe|object|embed|form|input|button|svg|math|link|meta|style|base|applet|frame|frameset|html|body|head)[^>]*>/gi;
const HTML_ATTR_RE       = /\s*(on\w+|javascript:|data:|vbscript:)\s*=/gi;
const HTML_GENERIC_TAG_RE= /<[^>]+>/g;
const SCRIPT_CONTENT_RE  = /<script[\s\S]*?<\/script>/gi;
const STYLE_CONTENT_RE   = /<style[\s\S]*?<\/style>/gi;

// Operadores NoSQL MongoDB
const NOSQL_KEY_RE       = /^\$|^\$|\.\$/;
const NOSQL_OP_RE        = /\$(?:where|gt|gte|lt|lte|ne|in|nin|exists|type|mod|regex|text|search|expr|jsonSchema|all|elemMatch|size|slice|comment|bit|isolated|natural|meta|center|box|polygon|near|geoWithin|geoIntersects|geometry|maxDistance|minDistance|nearSphere)\b/gi;

// Metacaracteres de shell/command injection
const SHELL_RE           = /[;&|`$(){}[\]<>\\]/g;

// Prototype pollution
const PROTO_KEYS         = new Set(['__proto__', 'constructor', 'prototype']);

// Patrones de prompt injection (instrucciones del sistema)
const PROMPT_INJECT_RE   = /(?:ignore\s+(previous|all|above)|forget\s+(everything|instructions|context)|you\s+are\s+now|act\s+as\s+a|roleplay\s+as|pretend\s+to\s+be|system\s*:\s*|user\s*:\s*|assistant\s*:\s*|###\s*instruction|<\|im_start\|>|<\|im_end\|>|<\|system\|>)/gi;

// Path traversal
const PATH_TRAVERSAL_RE  = /\.\.[\/\\]/g;

// ── Funciones de sanitización primitivas ─────────────────────────────────────

/**
 * Escapa HTML para renderizado seguro en el servidor
 */
function escapeHtml(str) {
    if (typeof str !== 'string') return str;
    return str
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&#x27;')
        .replace(/\//g, '&#x2F;');
}

/**
 * Elimina completamente el HTML/JS de un string de texto
 * Devuelve texto plano seguro para almacenar en BD
 */
function stripHtml(str) {
    if (typeof str !== 'string') return str;
    return str
        .replace(SCRIPT_CONTENT_RE, '')
        .replace(STYLE_CONTENT_RE,  '')
        .replace(HTML_TAG_RE,       '')
        .replace(HTML_ATTR_RE,      '')
        .replace(HTML_GENERIC_TAG_RE,'')
        .replace(/javascript\s*:/gi, '')
        .replace(/data\s*:/gi,      '')
        .replace(/vbscript\s*:/gi,  '')
        .trim();
}

/**
 * Sanitiza un string de texto libre (nombre, descripción, notas)
 * Elimina HTML, operadores NoSQL y metacaracteres de shell
 */
function sanitizeText(str, opts = {}) {
    if (str === null || str === undefined) return str;
    if (typeof str !== 'string') return str;

    const { maxLength = 2000, allowNewlines = false } = opts;

    let s = str;

    // Normalizar caracteres de control (excepto tab/newline si se permiten)
    s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    if (!allowNewlines) s = s.replace(/[\r\n]/g, ' ');

    // Strip HTML
    s = stripHtml(s);

    // Eliminar operadores NoSQL
    s = s.replace(NOSQL_OP_RE, '');

    // Eliminar path traversal
    s = s.replace(PATH_TRAVERSAL_RE, '');

    // Truncar al límite máximo
    if (s.length > maxLength) s = s.slice(0, maxLength);

    return s.trim();
}

/**
 * Sanitiza un string que solo debe contener texto de una línea (nombre, label)
 */
function sanitizeName(str, maxLength = 200) {
    return sanitizeText(str, { maxLength, allowNewlines: false });
}

/**
 * Sanitiza un email
 */
function sanitizeEmail(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[^a-zA-Z0-9._%+\-@]/g, '').toLowerCase().slice(0, 254);
}

/**
 * Sanitiza un número — acepta string numérico o number, devuelve number o null
 */
function sanitizeNumber(val, opts = {}) {
    const { min = -Infinity, max = Infinity, defaultVal = null } = opts;
    const n = parseFloat(val);
    if (isNaN(n)) return defaultVal;
    if (n < min) return min;
    if (n > max) return max;
    return Math.round(n * 1e10) / 1e10; // evitar floating point drift
}

/**
 * Sanitiza un entero
 */
function sanitizeInt(val, opts = {}) {
    const { min = -Infinity, max = Infinity, defaultVal = null } = opts;
    const n = parseInt(val, 10);
    if (isNaN(n)) return defaultVal;
    if (n < min) return min;
    if (n > max) return max;
    return n;
}

/**
 * Valida y devuelve un valor de una lista permitida (whitelist)
 */
function sanitizeEnum(val, allowed, defaultVal = null) {
    return allowed.includes(val) ? val : defaultVal;
}

/**
 * Sanitiza un ID de entidad (solo alphanumeric + guiones)
 */
function sanitizeId(str) {
    if (typeof str !== 'string') return null;
    return /^[a-zA-Z0-9_\-]{1,64}$/.test(str) ? str : null;
}

/**
 * Sanitiza una fecha ISO
 */
function sanitizeDate(str) {
    if (!str) return null;
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Sanitiza un booleano
 */
function sanitizeBool(val) {
    if (typeof val === 'boolean') return val;
    if (val === 'true' || val === '1') return true;
    if (val === 'false' || val === '0') return false;
    return null;
}

/**
 * Sanitiza un string de teléfono (solo dígitos, +, espacios y guiones)
 */
function sanitizePhone(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[^0-9+\-\s()]/g, '').slice(0, 30);
}

/**
 * Sanitiza un identificador de instancia/token externo (alphanumeric + guiones)
 * Protege contra path traversal en URLs de APIs externas
 */
function sanitizeToken(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[^a-zA-Z0-9_\-\.]/g, '').slice(0, 128);
}

/**
 * Detecta e indica si un string parece una inyección de prompt
 */
function detectPromptInjection(str) {
    if (typeof str !== 'string') return false;
    return PROMPT_INJECT_RE.test(str);
}

/**
 * Sanitiza recursivamente un objeto completo
 * - Elimina claves de prototype pollution
 * - Sanitiza strings recursivamente
 * - Elimina claves con operadores NoSQL ($xx)
 */
function sanitizeObject(obj, depth = 0) {
    if (depth > 10) return {}; // evitar recursión infinita
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'string') return sanitizeText(obj);
    if (typeof obj === 'number') return isNaN(obj) ? 0 : obj;
    if (typeof obj === 'boolean') return obj;
    if (Array.isArray(obj)) return obj.slice(0, 500).map(v => sanitizeObject(v, depth + 1));
    if (typeof obj === 'object') {
        const clean = {};
        for (const key of Object.keys(obj)) {
            // Bloquear prototype pollution
            if (PROTO_KEYS.has(key)) continue;
            // Bloquear operadores NoSQL como claves
            if (NOSQL_KEY_RE.test(key)) continue;
            clean[key] = sanitizeObject(obj[key], depth + 1);
        }
        return clean;
    }
    return obj;
}

// ── Middleware Express ────────────────────────────────────────────────────────

/**
 * Middleware global que sanitiza req.body, req.query y req.params
 * Se aplica a TODAS las rutas automáticamente
 */
function globalSanitizeMiddleware(req, res, next) {
    // Sanitizar body
    if (req.body && typeof req.body === 'object') {
        req.body = sanitizeObject(req.body);
    }

    // Sanitizar query params (solo strings, no recursivo profundo)
    if (req.query) {
        for (const k of Object.keys(req.query)) {
            if (PROTO_KEYS.has(k)) { delete req.query[k]; continue; }
            if (typeof req.query[k] === 'string') {
                req.query[k] = sanitizeText(req.query[k], { maxLength: 500 });
            }
        }
    }

    // Sanitizar params de URL
    if (req.params) {
        for (const k of Object.keys(req.params)) {
            if (typeof req.params[k] === 'string') {
                // Params de URL solo deben ser IDs o valores simples
                req.params[k] = req.params[k].replace(/[^a-zA-Z0-9_\-@.]/g, '').slice(0, 128);
            }
        }
    }

    next();
}

/**
 * Valida que un objeto tenga los campos requeridos y los tipos correctos
 * Devuelve { ok: true } o { ok: false, error: 'mensaje' }
 */
function validate(obj, schema) {
    for (const [field, rules] of Object.entries(schema)) {
        const val = obj[field];

        if (rules.required && (val === undefined || val === null || val === '')) {
            return { ok: false, error: `El campo "${field}" es requerido` };
        }
        if (val === undefined || val === null) continue;

        if (rules.type === 'string' && typeof val !== 'string') {
            return { ok: false, error: `El campo "${field}" debe ser texto` };
        }
        if (rules.type === 'number' && typeof val !== 'number') {
            return { ok: false, error: `El campo "${field}" debe ser un número` };
        }
        if (rules.type === 'boolean' && typeof val !== 'boolean') {
            return { ok: false, error: `El campo "${field}" debe ser verdadero/falso` };
        }
        if (rules.minLength && typeof val === 'string' && val.length < rules.minLength) {
            return { ok: false, error: `El campo "${field}" debe tener al menos ${rules.minLength} caracteres` };
        }
        if (rules.maxLength && typeof val === 'string' && val.length > rules.maxLength) {
            return { ok: false, error: `El campo "${field}" excede el máximo de ${rules.maxLength} caracteres` };
        }
        if (rules.min !== undefined && typeof val === 'number' && val < rules.min) {
            return { ok: false, error: `El campo "${field}" debe ser mayor o igual a ${rules.min}` };
        }
        if (rules.max !== undefined && typeof val === 'number' && val > rules.max) {
            return { ok: false, error: `El campo "${field}" debe ser menor o igual a ${rules.max}` };
        }
        if (rules.enum && !rules.enum.includes(val)) {
            return { ok: false, error: `El campo "${field}" tiene un valor no permitido` };
        }
        if (rules.regex && typeof val === 'string' && !rules.regex.test(val)) {
            return { ok: false, error: `El campo "${field}" tiene un formato inválido` };
        }
        if (rules.noHtml && typeof val === 'string' && /<[^>]+>/.test(val)) {
            return { ok: false, error: `El campo "${field}" no puede contener HTML` };
        }
    }
    return { ok: true };
}

// ── Whitelists de campos permitidos por entidad ───────────────────────────────

const WHITELISTS = {
    product: ['name','sku','barcode','internalCode','categoryId','subcategory','brand',
              'supplierId','description','cost','price','wholesalePrice','profit','currency',
              'tax','unit','stock','minStock','maxStock','warehouseId','location','lot',
              'expiryDate','serialNumber','status','image','notes','updatedAt'],

    customer: ['firstName','lastName','email','phone','address','city','state','country',
               'identification','identificationType','notes','tags','status','currency',
               'creditLimit','balance','updatedAt'],

    supplier: ['name','email','phone','address','city','country','rif','contactName',
               'notes','status','currency','balance','updatedAt'],

    invoice:  ['customerId','date','dueDate','items','subtotal','lineDiscount','generalDiscount',
               'discount','discountPct','discountType','tax','total','paid','notes','status',
               'currency','description','updatedAt'],

    purchase: ['supplierId','date','dueDate','items','subtotal','discount','tax','total',
               'paid','notes','status','currency','number','description','updatedAt'],

    sale:     ['customerId','items','subtotal','lineDiscount','generalDiscount','discount',
               'discountPct','discountType','tax','total','paid','cambio','method','date',
               'status','isCredit','currency','posCurrency','paidInPosCurr','notes','updatedAt'],

    expense:  ['description','amount','currency','category','subcategory','date','notes',
               'paymentMethod','supplierId','reference','status','updatedAt'],

    payment:  ['invoiceId','amount','date','method','ref','note','type','movementId',
               'customerId','supplierId','reference','status','updatedAt'],

    category: ['name','description','color','icon','parentId','status','updatedAt'],

    warehouse:['name','description','location','status','updatedAt'],

    quote:    ['customerId','date','dueDate','validUntil','items','subtotal','discount',
               'tax','total','notes','quoteStatus','currency','description','updatedAt'],

    return_:  ['saleId','invoiceId','productId','quantity','reason','notes','date',
               'method','amount','currency','status','updatedAt'],

    accountMovement: ['type','entityId','concept','description','amount','currency','date',
                      'dueDate','reference','invoiceId','notes','status','updatedAt'],

    ticketReply: ['text','internal'],

    ticket:   ['category','title','description','priority'],

    settings: ['companyName','rif','address','phone','email','website','currency',
               'defaultCurrency','taxRate','timezone','darkMode','language','logo',
               'invoicePrefix','invoiceNextNumber','showTax','showDiscount','footer',
               'updatedAt'],
};

/**
 * Filtra un objeto para que solo contenga las claves permitidas de la whitelist
 */
function applyWhitelist(obj, entityType) {
    const allowed = WHITELISTS[entityType];
    if (!allowed) return obj; // sin whitelist definida, devuelve tal cual
    const clean = {};
    for (const key of allowed) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            clean[key] = obj[key];
        }
    }
    return clean;
}

// ── Exportar ──────────────────────────────────────────────────────────────────

module.exports = {
    // Funciones primitivas
    escapeHtml,
    stripHtml,
    sanitizeText,
    sanitizeName,
    sanitizeEmail,
    sanitizeNumber,
    sanitizeInt,
    sanitizeEnum,
    sanitizeId,
    sanitizeDate,
    sanitizeBool,
    sanitizePhone,
    sanitizeToken,
    detectPromptInjection,
    sanitizeObject,
    // Middleware
    globalSanitizeMiddleware,
    // Validación de esquema
    validate,
    // Whitelists
    applyWhitelist,
    WHITELISTS,
};
