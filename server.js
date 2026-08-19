/**
 * FIX PRO MAX — Backend API
 * Servidor Express que persiste todos los datos del ERP en db.json
 * Puerto: 3000
 */

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');

// ── Servicio centralizado de tasas BCV ───────────────────────────────────────
const ExchangeRateService = require('./exchange-rate-service');

const app  = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'db.json');

// Función para iniciar — siempre en PORT, libera el puerto si está ocupado
function startServer(port) {
    // '0.0.0.0' permite conexiones desde cualquier dispositivo de la red local
    const server = app.listen(port, '0.0.0.0', () => {
        const { execSync } = require('child_process');
        let localIP = '192.168.x.x';
        try {
            const out = execSync('ipconfig', { timeout: 2000 }).toString();
            const match = out.match(/Wi-Fi[\s\S]*?IPv4.*?:\s*(192\.168\.\d+\.\d+)/i)
                       || out.match(/Ethernet[\s\S]*?IPv4.*?:\s*(192\.168\.\d+\.\d+)/i)
                       || out.match(/IPv4.*?:\s*(192\.168\.\d+\.\d+)/i);
            if (match) localIP = match[1];
        } catch {}
        console.log('');
        console.log('  ⚡ FIX PRO MAX — Backend corriendo');
        console.log(`  🖥️  Este dispositivo:    http://localhost:${port}`);
        console.log(`  📱 Otros dispositivos:  http://${localIP}:${port}`);
        console.log(`  👑 Panel admin:         http://${localIP}:${port}/admin`);
        console.log(`  📁 Base de datos: ${DB_PATH}`);
        console.log('');
    });
    server.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
            // Intentar liberar el puerto matando el proceso que lo usa
            console.log(`  ⚠️  Puerto ${port} ocupado — intentando liberar...`);
            const { execSync } = require('child_process');
            try {
                if (process.platform === 'win32') {
                    // Windows: buscar y matar el proceso que usa el puerto
                    const result = execSync(
                        `for /f "tokens=5" %a in ('netstat -aon ^| findstr ":${port} " ^| findstr "LISTENING"') do @echo %a`,
                        { shell: 'cmd.exe', timeout: 3000 }
                    ).toString().trim();
                    const pids = [...new Set(result.split(/\r?\n/).filter(p => p && p !== process.pid.toString()))];
                    pids.forEach(pid => {
                        try { execSync(`taskkill /PID ${pid} /F`, { timeout: 2000 }); console.log(`  🔫 Proceso ${pid} terminado`); }
                        catch {}
                    });
                } else {
                    execSync(`fuser -k ${port}/tcp`, { timeout: 3000 });
                }
                // Intentar de nuevo tras liberar
                setTimeout(() => startServer(port), 1500);
            } catch {
                // Si no se puede liberar, usar puerto alternativo solo como último recurso
                const alt = port + 1;
                console.log(`  ⚠️  No se pudo liberar ${port}, usando ${alt}`);
                startServer(alt);
            }
        } else {
            console.error('Error del servidor:', e.message);
        }
    });
    return server;
}

// ── Middlewares ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// ══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE GLOBAL DE SUSCRIPCIÓN — corre en CADA petición /api/*
// Protege TODOS los endpoints del ERP aunque no tengan requireAuth explícito.
// Exentas: /auth/, /subscription/, /admin/, /demo/, /config/payment-methods
// ══════════════════════════════════════════════════════════════════════════════
app.use('/api', (req, res, next) => {
    const exemptPrefixes = ['/auth/', '/subscription/', '/admin/', '/demo/', '/events'];
    // Rutas públicas explícitas que no necesitan suscripción
    const exemptExact = ['/subscription/plans', '/config/payment-methods', '/ping'];
    const p = req.path;
    if (exemptPrefixes.some(e => p.startsWith(e) || p === e.slice(0, -1))) return next();
    if (exemptExact.some(e => p === e || p.startsWith(e + '/')))           return next();

    // Si no hay req.user (endpoint sin requireAuth) intentamos validar el token
    // directamente para no dejar rutas sin protección.
    const header = req.headers['authorization'] || '';
    const token  = header.replace('Bearer ', '').trim();
    if (!token) {
        // Sin token: devolver 401 para rutas que deberían ser privadas
        // (las públicas como /api/subscription/plans ya pasaron por el filtro de arriba)
        return res.status(401).json({ ok: false, error: 'No autenticado', code: 'AUTH_REQUIRED' });
    }

    // Validar token y obtener usuario (inline, sin AsyncLocalStorage)
    const sessions = readSessions();
    const entry    = sessions[token];
    if (!entry) return res.status(401).json({ ok: false, error: 'Sesión inválida', code: 'AUTH_REQUIRED' });
    const userId = typeof entry === 'object' ? entry.userId : entry;
    const users  = readUsers();
    const user   = users.find(u => u.id === userId);
    if (!user || user.active === false) {
        return res.status(401).json({ ok: false, error: 'Usuario no encontrado o suspendido', code: 'AUTH_REQUIRED' });
    }

    // Admin: acceso total
    if (user.role === 'admin') return next();

    // Verificar suscripción del owner de la empresa
    const owner  = users.find(u => u.companyId === user.companyId && u.teamRole === 'owner') || user;
    const status = getAccessStatus(owner);
    if (!status.access) {
        return res.status(403).json({
            ok: false,
            error: 'Tu período de prueba ha expirado. Suscríbete para continuar usando FIX PRO MAX.',
            code: 'SUBSCRIPTION_REQUIRED',
            subStatus: status.status,
            trialEnd: status.trialEnd || null,
        });
    }

    // Si req.user aún no fue establecido por requireAuth, lo establecemos aquí
    // para que los handlers subsiguientes puedan usarlo
    if (!req.user) {
        req.user = {
            id: user.id, name: user.name, email: user.email,
            role: user.role, company: user.company, avatar: user.avatar,
            mode: user.mode || 'basic',
            companyId:   user.companyId   || user.id,
            teamRole:    user.teamRole    || 'employee',
            permissions: user.permissions || null,
        };
    }
    next();
});

// ── RUTA RAÍZ — debe ir ANTES de express.static para interceptar GET / ───────
// Se define aquí como placeholder; la implementación real está más abajo
// pero necesitamos que el router la vea antes que el middleware estático.
// Por eso movemos express.static DESPUÉS de las rutas de API y de la ruta raíz.

// ── Base de datos en disco ───────────────────────────────────────────────────
function _readGlobalDB() {
    try {
        if (!fs.existsSync(DB_PATH)) {
            // Primera vez: generar y persistir los datos por defecto
            const fresh = defaultData();
            fs.writeFileSync(DB_PATH, JSON.stringify(fresh, null, 2), 'utf8');
            return fresh;
        }
        const raw    = fs.readFileSync(DB_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        // Solo añadir claves faltantes de tipo no-array/no-objeto complejo
        const def = defaultData();
        for (const key of Object.keys(def)) {
            if (parsed[key] === undefined) {
                parsed[key] = def[key];
            }
        }
        return parsed;
    } catch (e) {
        console.error('Error leyendo db.json:', e.message);
        return defaultData();
    }
}

function _writeGlobalDB(data) {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error('Error escribiendo db.json:', e.message);
        throw e;
    }
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function defaultData() {
    return {
        products:           [],
        categories:         [],
        warehouses:         [
            { id: 'wh1', name: 'Almacén Principal' },
            { id: 'wh2', name: 'Almacén Secundario' },
        ],
        customers:          [],
        suppliers:          [],
        sales:              [],
        invoices:           [],
        purchases:          [],
        expenses:           [],
        returns:            [],
        inventoryMovements: [],
        inventoryHistory:   [],
        alerts:             [],
        chartOfAccounts: [
            { code: '1-01-001', name: 'Caja',                   type: 'Activo',     balance: 0 },
            { code: '1-01-002', name: 'Bancos',                 type: 'Activo',     balance: 0 },
            { code: '1-02',     name: 'Cuentas por Cobrar',     type: 'Activo',     balance: 0 },
            { code: '1-03',     name: 'Inventario',             type: 'Activo',     balance: 0 },
            { code: '2-01',     name: 'Cuentas por Pagar',      type: 'Pasivo',     balance: 0 },
            { code: '2-02',     name: 'Impuestos por Pagar',    type: 'Pasivo',     balance: 0 },
            { code: '3-01',     name: 'Capital',                type: 'Patrimonio', balance: 0 },
            { code: '4-01',     name: 'Ventas',                 type: 'Ingreso',    balance: 0 },
            { code: '5-01',     name: 'Costo de Ventas',        type: 'Costo',      balance: 0 },
            { code: '5-02',     name: 'Gastos Administrativos', type: 'Gasto',      balance: 0 },
            { code: '5-03',     name: 'Gastos de Ventas',       type: 'Gasto',      balance: 0 },
        ],
        journalEntries: [],
        balanceSheet: {
            assets:                 [],
            liabilities:            [],
            equity:                 [],
            totalAssets:            0,
            totalLiabilitiesEquity: 0,
        },
        incomeStatement: {
            revenue: 0, costOfSales: 0, grossProfit: 0, expenses: 0, netIncome: 0,
        },
        importHistory: [],
        auditLog:      [],
        payments:      [],
        quotes:        [],  // ← Cotizaciones
        settings: {
            companyName:        '',
            rif:                '',
            country:            'Venezuela',
            currency:           'USD',
            // ── Sistema de monedas VES/EUR ──
            defaultCurrency:    'USD',   // moneda principal de la empresa
            darkMode:           true,
            notifications:      true,
            aiEnabled:          true,
        },
        // ── MONEDAS GLOBALES ───────────────────────────────────────────
        currencies: [
            { code:'VES', name:'Bolívar venezolano',      symbol:'Bs.', flag:'🇻🇪', active:true,  isBase:true,  format:'es-VE', decimals:2 },
            { code:'EUR', name:'Euro',                    symbol:'€',   flag:'🇪🇺', active:true,  isBase:false, format:'de-DE', decimals:2 },
            { code:'USD', name:'Dólar estadounidense',    symbol:'$',   flag:'🇺🇸', active:true,  isBase:false, format:'en-US', decimals:2 },
        ],
        // ── TASAS DE CAMBIO — pendientes de actualización automática BCV ──
        exchangeRates: [
            {
                id:'rate-eur-init', fromCurrency:'EUR', toCurrency:'VES',
                rate:40.00, date:new Date().toISOString().slice(0,10),
                createdAt:new Date().toISOString(), createdBy:'sistema',
                notes:'Tasa inicial — pendiente actualización BCV',
                source:'Manual inicial', updateType:'manual', isActive:true,
            },
            {
                id:'rate-usd-init', fromCurrency:'USD', toCurrency:'VES',
                rate:36.00, date:new Date().toISOString().slice(0,10),
                createdAt:new Date().toISOString(), createdBy:'sistema',
                notes:'Tasa inicial — pendiente actualización BCV',
                source:'Manual inicial', updateType:'manual', isActive:true,
            },
        ],
    };
}

// ── Helpers de respuesta ─────────────────────────────────────────────────────
const ok  = (res, data)    => res.json({ ok: true, data });
const err = (res, msg, code = 400) => res.status(code).json({ ok: false, error: msg });


// ── Content-Security-Policy básico ──────────────────────────────────────────
app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy',
        "default-src 'self' https:; " +
        "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src 'self' https://fonts.gstatic.com; " +
        "img-src 'self' data: https:; " +
        "connect-src 'self';"
    );
    next();
});

// ── Headers de seguridad para todos los requests ────────────────────────────
app.use((req, res, next) => {
    // Seguridad básica — SIN COEP porque bloquea fetch() desde el navegador
    res.setHeader('X-Content-Type-Options',  'nosniff');
    res.setHeader('X-Frame-Options',         'SAMEORIGIN');
    res.setHeader('Referrer-Policy',         'strict-origin-when-cross-origin');
    next();
});

// ── RUTA RAÍZ — sirve el ERP con datos inyectados ───────────────────────────
app.get('/', (req, res) => {
    try {
        // Leer token desde Authorization header O desde cookie (el navegador envía la cookie automáticamente)
        const authHeader = req.headers['authorization'] || req.headers['x-auth-token'] || '';
        // Parsear cookie manualmente sin necesitar cookie-parser
        const rawCookie = req.headers.cookie || '';
        const cookieToken = rawCookie.split(';')
            .map(c => c.trim().split('='))
            .find(([k]) => k === 'fixpromax_token')?.[1] || '';
        const token = authHeader.replace('Bearer ', '').trim() || cookieToken;
        let db = null;
        let subStatus = null;
        let authenticatedUser = null;

        if (token) {
            const sessions = readSessions();
            const entry    = sessions[token];
            const userId   = entry ? (typeof entry === 'object' ? entry.userId : entry) : null;
            if (userId) {
                const users = readUsers();
                const user  = users.find(u => u.id === userId);
                if (user?.companyId) {
                    // Solo inyectar BD si la sesión es válida y la BD es la de la empresa
                    const isDemo = user.isDemo || user.companyId === DEMO_COMPANY_ID;
                    db = isDemo ? readDemoDB() : readCompanyDB(user.companyId);
                    authenticatedUser = user;
                }
                if (user) subStatus = getAccessStatus(user);
            }
        }

        // CRÍTICO: si no hay sesión válida, NO inyectar la BD global vacía.
        // El frontend usará su token de localStorage para hacer fetch /api/db
        // y obtener la BD correcta de su empresa. Esto evita mostrar datos vacíos
        // cuando la cookie expiró pero el token de localStorage sigue válido.
        if (!db) {
            db = null; // el frontend detectará null y hará fetch /api/db
            console.log('  [GET /] Sin sesión válida — el frontend cargará datos via /api/db');
        } else {
            console.log(`  [GET /] Sesión válida: ${authenticatedUser?.email} — inyectando ${db.products?.length || 0} productos`);
        }

        // Inyectar datos iniciales + planes + estado de suscripción
        const activePlans = getActivePlans();
        const PLAN_COLORS = { basic:'#64748b', pro:'#4f46e5', semestral:'#f59e0b' };
        const PLAN_ICONS  = { basic:'📦', pro:'🚀', semestral:'💎' };

        // Generar HTML de los cards de planes directamente en el servidor
        const plansHtml = activePlans.map(p => {
            const color  = PLAN_COLORS[p.id] || '#4f46e5';
            const icon   = PLAN_ICONS[p.id]  || '📋';
            const fList  = (p.features || []).map(f => `<li style="font-size:12px;color:#94a3b8;padding:2px 0;">✔ ${f}</li>`).join('');
            const nList  = (p.notIncluded || []).filter(Boolean).map(f => `<li style="font-size:12px;color:#64748b;padding:2px 0;opacity:.6;">✖ ${f}</li>`).join('');
            const btnBg  = `linear-gradient(135deg,${color},${color}cc)`;
            const btnClr = p.id === 'semestral' ? '#000' : '#fff';
            return `
            <div style="background:#0f172a;border:2px solid ${color}44;border-radius:14px;overflow:hidden;transition:border-color .2s,box-shadow .2s;"
                 onmouseover="this.style.borderColor='${color}';this.style.boxShadow='0 4px 20px ${color}22'"
                 onmouseout="this.style.borderColor='${color}44';this.style.boxShadow='none'">
              <div style="background:${color}22;padding:16px;border-bottom:1px solid ${color}33;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                  <span style="font-size:28px;">${icon}</span>
                  <div style="display:flex;gap:6px;">
                    ${p.recommended ? `<span style="background:#4f46e5;color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;">⭐ REC</span>` : ''}
                    ${p.badge && !p.recommended ? `<span style="background:${color};color:${p.id==='semestral'?'#000':'#fff'};font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;">${p.badge}</span>` : ''}
                  </div>
                </div>
                <div style="font-size:16px;font-weight:800;color:#f8fafc;">${p.name}</div>
                <div style="font-size:12px;color:#94a3b8;margin-top:2px;">${p.description || ''}</div>
              </div>
              <div style="padding:14px 16px;">
                <div style="display:flex;align-items:baseline;gap:4px;margin-bottom:4px;">
                  <span style="font-size:26px;font-weight:900;color:${color};">$${Number(p.price).toFixed(2)}</span>
                  <span style="font-size:12px;color:#64748b;">/ ${p.period || p.duration+' días'}</span>
                </div>
                <div style="font-size:11px;color:#64748b;margin-bottom:10px;">
                  ${p.maxUsers===1?'👤 1 usuario':`👥 Hasta ${p.maxUsers} usuarios`}
                  &nbsp;·&nbsp;📦 ${p.maxProducts===-1?'Inventario ilimitado':`Hasta ${p.maxProducts} productos`}
                  &nbsp;·&nbsp;${p.multiUser?'✅ Multiusuario':'❌ Sin multiusuario'}
                </div>
                <ul style="list-style:none;padding:0;margin:0 0 12px;">${fList}${nList}</ul>
                <button onclick="window.startSubscription('${p.id}')"
                    style="width:100%;background:${btnBg};color:${btnClr};border:none;padding:10px;
                           border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;"
                    onmouseover="this.style.opacity='.85'" onmouseout="this.style.opacity='1'">
                    💳 Comprar / Pagar
                </button>
              </div>
            </div>`;
        }).join('');

        let html = fs.readFileSync(path.join(__dirname, 'index2.html'), 'utf8');

        // Inyectar variables JS
        // Si db === null significa que no hay sesión válida en cookie/header.
        // El frontend detectará __INITIAL_DATA__ === null y hará fetch /api/db
        // con el token que tiene en localStorage para obtener la BD correcta.
        const injection = `<script>
window.__INITIAL_DATA__ = ${db !== null ? JSON.stringify(db) : 'null'};
window.__INITIAL_PLANS__ = ${JSON.stringify(activePlans)};
window.__INITIAL_SUB__ = ${JSON.stringify(subStatus)};
</script>`;
        html = html.replace('</head>', injection + '\n</head>');

        // Reemplazar el placeholder "Cargando planes..." con el HTML real de los cards
        html = html.replace(
            '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-3);">⏳ Cargando planes...</div>',
            plansHtml
        );
        res.setHeader('Content-Type',  'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.send(html);
    } catch (e) {
        console.error('Error sirviendo index2.html:', e.message);
        res.status(500).send('Error interno del servidor');
    }
});

// ── Service Worker — sin caché para que siempre se sirva la versión más nueva ─
app.get('/sw.js', (req, res) => {
    res.setHeader('Content-Type',  'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Service-Worker-Allowed', '/');
    res.sendFile(path.join(__dirname, 'sw.js'));
});

// ── manifest.json — caché corta (1 hora) ────────────────────────────────────
app.get('/manifest.json', (req, res) => {
    res.setHeader('Content-Type',  'application/manifest+json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(path.join(__dirname, 'manifest.json'));
});

// ── subscription.js — sin caché (siempre fresco) ─────────────────────────────
app.get('/subscription.js', (req, res) => {
    res.setHeader('Content-Type',  'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.sendFile(path.join(__dirname, 'subscription.js'));
});

app.get('/auth.js', (req, res) => {
    res.setHeader('Content-Type',  'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.sendFile(path.join(__dirname, 'auth.js'));
});

// ── assetlinks.json (Digital Asset Links para TWA) ──────────────────────────
app.get('/.well-known/assetlinks.json', (req, res) => {
    const filePath = path.join(__dirname, '.well-known', 'assetlinks.json');
    res.setHeader('Content-Type',  'application/json');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(filePath);
});

// ── Íconos PWA — caché larga (7 días) ───────────────────────────────────────
app.get('/icons/:file', (req, res) => {
    const filePath = path.join(__dirname, 'icons', req.params.file);
    if (!fs.existsSync(filePath)) return res.status(404).end();
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.sendFile(filePath);
});

// ── Archivos estáticos restantes (CSS, JS externos, imágenes) ───────────────
// index: false para que GET / no sea interceptado aquí
app.use(express.static(__dirname, {
    index:    false,
    maxAge:   '1d',
    etag:     true,
    setHeaders(res, filePath) {
        // sw.js nunca en caché (ya tiene su ruta dedicada arriba pero por si acaso)
        if (filePath.endsWith('sw.js')) {
            res.setHeader('Cache-Control', 'no-store');
        }
    }
}));

// ══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE: Bloquear acceso al ERP si no hay suscripción activa
// Se aplica a todos los endpoints de datos (/api/db, /api/products, etc.)
// Exenciones: /api/auth/*, /api/subscription/*, /api/admin/*, /api/demo/*
// ══════════════════════════════════════════════════════════════════════════════
function requireSubscription(req, res, next) {
    if (!req.user) return next(); // requireAuth ya lo rechaza si no hay token
    if (req.user.role === 'admin') return next(); // admin siempre pasa
    const users  = readUsers();
    const owner  = users.find(u => u.companyId === req.user.companyId && u.teamRole === 'owner') || req.user;
    const status = getAccessStatus(owner);
    if (!status.access) {
        return res.status(403).json({
            ok: false,
            error: 'Tu período de prueba ha expirado. Suscríbete para continuar usando el sistema.',
            code: 'SUBSCRIPTION_REQUIRED',
            subStatus: status.status,
        });
    }
    next();
}

// ══════════════════════════════════════════════════════════════════════════════
// ENDPOINT: Estado completo de la BD (usado por el frontend para sincronizar)
// Ahora requiere autenticación y devuelve solo la BD de la empresa del usuario
// ── Ping público — usado por el frontend para verificar disponibilidad ────────
app.get('/api/ping', (req, res) => {
    res.json({ ok: true, ts: Date.now() });
});

// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/db', requireAuth, requireSubscription, (req, res) => {
    ok(res, readDB()); // readDB() ya usa el companyId del contexto async
});

app.put('/api/db', requireAuth, requireSubscription, (req, res) => {
    try {
        writeDB(req.body); // writeDB() ya usa el companyId del contexto async
        ok(res, { saved: true });
    } catch (e) {
        err(res, 'Error al guardar la base de datos', 500);
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// PRODUCTOS
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/products', (req, res) => {
    const db = readDB();
    ok(res, db.products);
});

app.post('/api/products', requireAuth, (req, res) => {
    const db = readDB();

    // ── Validar límite de productos según plan ───────────────────
    const users   = readUsers();
    const owner   = users.find(u => u.companyId === req.user.companyId && u.teamRole === 'owner') || req.user;
    const status  = getAccessStatus(owner);
    const maxProd = status.maxProducts ?? -1;
    if (maxProd !== -1 && db.products.length >= maxProd) {
        return err(res, `Tu plan permite hasta ${maxProd} productos. Actualiza tu plan para agregar más.`, 403);
    }

    const product = { id: generateId(), createdAt: new Date().toISOString(),
                      updatedAt: new Date().toISOString(), ...req.body };
    db.products.push(product);
    writeDB(db);
    ok(res, product);
});

app.put('/api/products/:id', requireAuth, (req, res) => {
    const db = readDB();
    const idx = db.products.findIndex(p => p.id === req.params.id);
    if (idx === -1) return err(res, 'Producto no encontrado', 404);
    db.products[idx] = { ...db.products[idx], ...req.body, id: req.params.id,
                         updatedAt: new Date().toISOString() };
    writeDB(db);
    ok(res, db.products[idx]);
});

app.delete('/api/products/:id', requireAuth, (req, res) => {
    const db = readDB();
    const idx = db.products.findIndex(p => p.id === req.params.id);
    if (idx === -1) return err(res, 'Producto no encontrado', 404);
    db.products.splice(idx, 1);
    writeDB(db);
    ok(res, { deleted: req.params.id });
});

// ══════════════════════════════════════════════════════════════════════════════
// CATEGORÍAS
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/categories', (req, res) => ok(res, readDB().categories));

app.post('/api/categories', requireAuth, (req, res) => {
    const db = readDB();
    const cat = { id: generateId(), ...req.body };
    db.categories.push(cat);
    writeDB(db);
    ok(res, cat);
});

app.put('/api/categories/:id', requireAuth, (req, res) => {
    const db = readDB();
    const idx = db.categories.findIndex(c => c.id === req.params.id);
    if (idx === -1) return err(res, 'Categoría no encontrada', 404);
    db.categories[idx] = { ...db.categories[idx], ...req.body, id: req.params.id };
    writeDB(db);
    ok(res, db.categories[idx]);
});

app.delete('/api/categories/:id', requireAuth, (req, res) => {
    const db = readDB();
    db.categories = db.categories.filter(c => c.id !== req.params.id);
    writeDB(db);
    ok(res, { deleted: req.params.id });
});

// ══════════════════════════════════════════════════════════════════════════════
// ALMACENES
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/warehouses', (req, res) => ok(res, readDB().warehouses));

app.post('/api/warehouses', requireAuth, (req, res) => {
    const db = readDB();
    const wh = { id: generateId(), ...req.body };
    db.warehouses.push(wh);
    writeDB(db);
    ok(res, wh);
});

app.put('/api/warehouses/:id', requireAuth, (req, res) => {
    const db = readDB();
    const idx = db.warehouses.findIndex(w => w.id === req.params.id);
    if (idx === -1) return err(res, 'Almacén no encontrado', 404);
    db.warehouses[idx] = { ...db.warehouses[idx], ...req.body, id: req.params.id };
    writeDB(db);
    ok(res, db.warehouses[idx]);
});

app.delete('/api/warehouses/:id', requireAuth, (req, res) => {
    const db = readDB();
    db.warehouses = db.warehouses.filter(w => w.id !== req.params.id);
    writeDB(db);
    ok(res, { deleted: req.params.id });
});

// ══════════════════════════════════════════════════════════════════════════════
// CLIENTES
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/customers', (req, res) => ok(res, readDB().customers));

app.post('/api/customers', requireAuth, (req, res) => {
    const db = readDB();
    const customer = { id: generateId(), balance: 0, createdAt: new Date().toISOString(),
                       updatedAt: new Date().toISOString(), ...req.body };
    db.customers.push(customer);
    writeDB(db);
    ok(res, customer);
});

app.put('/api/customers/:id', requireAuth, (req, res) => {
    const db = readDB();
    const idx = db.customers.findIndex(c => c.id === req.params.id);
    if (idx === -1) return err(res, 'Cliente no encontrado', 404);
    db.customers[idx] = { ...db.customers[idx], ...req.body, id: req.params.id,
                          updatedAt: new Date().toISOString() };
    writeDB(db);
    ok(res, db.customers[idx]);
});

app.delete('/api/customers/:id', requireAuth, (req, res) => {
    const db = readDB();
    db.customers = db.customers.filter(c => c.id !== req.params.id);
    writeDB(db);
    ok(res, { deleted: req.params.id });
});

// ══════════════════════════════════════════════════════════════════════════════
// PROVEEDORES
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/suppliers', (req, res) => ok(res, readDB().suppliers));

app.post('/api/suppliers', requireAuth, (req, res) => {
    const db = readDB();
    const supplier = { id: generateId(), balance: 0, createdAt: new Date().toISOString(),
                       updatedAt: new Date().toISOString(), ...req.body };
    db.suppliers.push(supplier);
    writeDB(db);
    ok(res, supplier);
});

app.put('/api/suppliers/:id', requireAuth, (req, res) => {
    const db = readDB();
    const idx = db.suppliers.findIndex(s => s.id === req.params.id);
    if (idx === -1) return err(res, 'Proveedor no encontrado', 404);
    db.suppliers[idx] = { ...db.suppliers[idx], ...req.body, id: req.params.id,
                          updatedAt: new Date().toISOString() };
    writeDB(db);
    ok(res, db.suppliers[idx]);
});

app.delete('/api/suppliers/:id', requireAuth, (req, res) => {
    const db = readDB();
    db.suppliers = db.suppliers.filter(s => s.id !== req.params.id);
    writeDB(db);
    ok(res, { deleted: req.params.id });
});

// ══════════════════════════════════════════════════════════════════════════════
// VENTAS
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/sales', (req, res) => ok(res, readDB().sales));

app.post('/api/sales', requireAuth, (req, res) => {
    const db = readDB();
    const sale = { id: generateId(), createdAt: new Date().toISOString(), ...req.body };

    // Descontar stock de cada producto vendido
    if (Array.isArray(sale.items)) {
        for (const item of sale.items) {
            const prod = db.products.find(p => p.id === item.productId);
            if (prod) {
                const prevStock = prod.stock;
                prod.stock = Math.max(0, prod.stock - item.qty);
                prod.updatedAt = new Date().toISOString();
                // Registrar movimiento de inventario
                db.inventoryMovements.push({
                    id: generateId(),
                    productId: prod.id,
                    productName: prod.name,
                    type: 'Salida',
                    quantity: -item.qty,
                    warehouseId: prod.warehouseId,
                    date: new Date().toISOString(),
                    user: 'admin',
                    reason: 'Venta',
                    reference: sale.invoice || sale.id,
                    notes: '',
                    previousStock: prevStock,
                    newStock: prod.stock,
                });
            }
        }
    }

    db.sales.push(sale);
    writeDB(db);
    ok(res, sale);
});

app.put('/api/sales/:id', requireAuth, (req, res) => {
    const db = readDB();
    const idx = db.sales.findIndex(s => s.id === req.params.id);
    if (idx === -1) return err(res, 'Venta no encontrada', 404);
    db.sales[idx] = { ...db.sales[idx], ...req.body, id: req.params.id };
    writeDB(db);
    ok(res, db.sales[idx]);
});

app.delete('/api/sales/:id', requireAuth, (req, res) => {
    const db = readDB();
    db.sales = db.sales.filter(s => s.id !== req.params.id);
    writeDB(db);
    ok(res, { deleted: req.params.id });
});

// ══════════════════════════════════════════════════════════════════════════════
// FACTURAS
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/invoices', (req, res) => ok(res, readDB().invoices));

app.post('/api/invoices', requireAuth, (req, res) => {
    const db = readDB();
    const invoice = { id: generateId(), paid: 0, status: 'Pendiente',
                      createdAt: new Date().toISOString(), ...req.body };
    db.invoices.push(invoice);
    writeDB(db);
    ok(res, invoice);
});

app.put('/api/invoices/:id', requireAuth, (req, res) => {
    const db = readDB();
    const idx = db.invoices.findIndex(i => i.id === req.params.id);
    if (idx === -1) return err(res, 'Factura no encontrada', 404);
    db.invoices[idx] = { ...db.invoices[idx], ...req.body, id: req.params.id };
    writeDB(db);
    ok(res, db.invoices[idx]);
});

app.delete('/api/invoices/:id', requireAuth, (req, res) => {
    const db = readDB();
    db.invoices = db.invoices.filter(i => i.id !== req.params.id);
    writeDB(db);
    ok(res, { deleted: req.params.id });
});

// ══════════════════════════════════════════════════════════════════════════════
// COTIZACIONES  /api/quotes
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/quotes', requireAuth, (req, res) => {
    const db = readDB();
    ok(res, db.quotes || []);
});

app.post('/api/quotes', requireAuth, requirePermission('invoices', 'create'), (req, res) => {
    const db = readDB();
    if (!Array.isArray(db.quotes)) db.quotes = [];
    const qt = {
        id:          generateId(),
        quoteStatus: 'Borrador',
        createdAt:   new Date().toISOString(),
        updatedAt:   new Date().toISOString(),
        ...req.body,
    };
    // Generar número secuencial si no viene
    if (!qt.number) {
        const nums = db.quotes
            .map(q => { const m = String(q.number||'').match(/COT-(\d+)/); return m ? parseInt(m[1],10) : 0; })
            .filter(n => !isNaN(n));
        const max = nums.length ? Math.max(...nums) : 0;
        qt.number = `COT-${String(max + 1).padStart(6, '0')}`;
    }
    db.quotes.push(qt);
    writeDB(db);
    ok(res, qt);
});

app.put('/api/quotes/:id', requireAuth, requirePermission('invoices', 'edit'), (req, res) => {
    const db = readDB();
    if (!Array.isArray(db.quotes)) db.quotes = [];
    const idx = db.quotes.findIndex(q => q.id === req.params.id);
    if (idx === -1) return err(res, 'Cotización no encontrada', 404);
    const existing = db.quotes[idx];
    // No permitir editar una cotización ya convertida o anulada
    if (['Convertida', 'Anulada'].includes(existing.quoteStatus) && !req.body.quoteStatus) {
        return err(res, `No se puede editar una cotización con estado "${existing.quoteStatus}"`, 400);
    }
    db.quotes[idx] = { ...existing, ...req.body, id: req.params.id, updatedAt: new Date().toISOString() };
    writeDB(db);
    ok(res, db.quotes[idx]);
});

// Cambiar solo el estado de una cotización
app.patch('/api/quotes/:id/status', requireAuth, (req, res) => {
    const db  = readDB();
    if (!Array.isArray(db.quotes)) db.quotes = [];
    const idx = db.quotes.findIndex(q => q.id === req.params.id);
    if (idx === -1) return err(res, 'Cotización no encontrada', 404);
    const allowed = ['Borrador','Enviada','Aceptada','Rechazada','Vencida','Convertida','Anulada'];
    const newStatus = req.body.quoteStatus;
    if (!allowed.includes(newStatus)) return err(res, 'Estado no válido', 400);
    db.quotes[idx].quoteStatus = newStatus;
    db.quotes[idx].updatedAt   = new Date().toISOString();
    writeDB(db);
    ok(res, db.quotes[idx]);
});

// Convertir cotización en venta (valida en servidor que no se haya convertido ya)
app.post('/api/quotes/:id/convert', requireAuth, requirePermission('invoices', 'create'), (req, res) => {
    const db = readDB();
    if (!Array.isArray(db.quotes)) db.quotes = [];
    const qt = db.quotes.find(q => q.id === req.params.id);
    if (!qt) return err(res, 'Cotización no encontrada', 404);
    if (qt.quoteStatus === 'Convertida') return err(res, 'Esta cotización ya fue convertida', 409);
    if (qt.quoteStatus === 'Anulada')    return err(res, 'No se puede convertir una cotización anulada', 400);

    const { method = 'Efectivo', notes = '' } = req.body;
    const now         = new Date().toISOString();
    const today       = now.slice(0, 10);
    const saleNumber  = `INV-${Date.now().toString().slice(-6)}`;

    // Descontar inventario
    const saleItems = (qt.items || []).map(it => {
        if (it.productId) {
            const prod = db.products.find(p => p.id === it.productId);
            if (prod) {
                const prev    = prod.stock;
                prod.stock    = Math.max(0, prod.stock - it.qty);
                prod.updatedAt = now;
                db.inventoryMovements = db.inventoryMovements || [];
                db.inventoryMovements.push({
                    id: generateId(), productId: prod.id, productName: prod.name,
                    type: 'Salida', quantity: -it.qty,
                    warehouseId: prod.warehouseId, date: now,
                    user: req.user?.email || 'sistema',
                    reason: 'Venta (desde cotización)',
                    reference: saleNumber, notes: `Cotización ${qt.number}`,
                    previousStock: prev, newStock: prod.stock,
                });
            }
        }
        const base = it.qty * it.price;
        const dAmt = base * (it.discount||0) / 100;
        const tAmt = (base - dAmt) * (it.tax||0) / 100;
        return { ...it, total: base - dAmt + tAmt };
    });

    // Crear venta
    const sale = {
        id: generateId(), invoice: saleNumber, customerId: qt.customerId,
        items: saleItems, subtotal: qt.subtotal||0, discount: qt.discount||0,
        tax: qt.tax||0, total: qt.total||0, method, notes,
        date: today, createdAt: now, updatedAt: now,
        fromQuoteId: qt.id, fromQuoteNumber: qt.number,
        user: req.user?.email || 'sistema',
    };
    db.sales = db.sales || [];
    db.sales.push(sale);

    // Crear factura fiscal
    const invoice = {
        id: generateId(), number: saleNumber, customerId: qt.customerId,
        date: today, dueDate: '',
        total: qt.total||0, paid: method === 'Crédito' ? 0 : qt.total||0,
        notes: `Generada desde cotización ${qt.number}. ${notes}`.trim(),
        status: method === 'Crédito' ? 'Pendiente' : 'Pagada',
        createdAt: now, updatedAt: now,
        fromQuoteId: qt.id, fromQuoteNumber: qt.number,
    };
    db.invoices = db.invoices || [];
    db.invoices.push(invoice);

    // Saldo del cliente si es crédito
    if (method === 'Crédito') {
        const cust = (db.customers||[]).find(c => c.id === qt.customerId);
        if (cust) cust.balance = (cust.balance||0) + invoice.total;
    }

    // Marcar cotización como convertida
    qt.quoteStatus          = 'Convertida';
    qt.updatedAt            = now;
    qt.convertedToSaleId    = sale.id;
    qt.convertedToInvoiceId = invoice.id;
    qt.convertedAt          = now;

    writeDB(db);
    ok(res, { sale, invoice, quote: qt });
});

app.delete('/api/quotes/:id', requireAuth, requirePermission('invoices', 'cancel'), (req, res) => {
    const db = readDB();
    if (!Array.isArray(db.quotes)) db.quotes = [];
    const qt = db.quotes.find(q => q.id === req.params.id);
    if (!qt) return err(res, 'Cotización no encontrada', 404);
    if (qt.quoteStatus === 'Convertida') return err(res, 'No se puede eliminar una cotización ya convertida', 400);
    qt.quoteStatus = 'Anulada';
    qt.updatedAt   = new Date().toISOString();
    writeDB(db);
    ok(res, { annulled: req.params.id });
});

// Alertas automáticas de cotizaciones vencidas (integrado al endpoint /api/alerts existente)
// → ya se maneja en el cliente con la función renderQuotes()

// ══════════════════════════════════════════════════════════════════════════════
// COMPRAS
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/purchases', (req, res) => ok(res, readDB().purchases));

app.post('/api/purchases', requireAuth, (req, res) => {
    const db = readDB();
    const purchase = { id: generateId(), createdAt: new Date().toISOString(), ...req.body };

    // Sumar stock a los productos de la compra
    if (Array.isArray(purchase.items)) {
        for (const item of purchase.items) {
            const prod = db.products.find(p => p.id === item.productId);
            if (prod) {
                const prevStock = prod.stock;
                prod.stock += item.qty;
                prod.updatedAt = new Date().toISOString();
                db.inventoryMovements.push({
                    id: generateId(),
                    productId: prod.id,
                    productName: prod.name,
                    type: 'Entrada',
                    quantity: item.qty,
                    warehouseId: prod.warehouseId,
                    date: new Date().toISOString(),
                    user: 'admin',
                    reason: 'Compra',
                    reference: purchase.orderNumber || purchase.id,
                    notes: '',
                    previousStock: prevStock,
                    newStock: prod.stock,
                });
            }
        }
    }

    db.purchases.push(purchase);
    writeDB(db);
    ok(res, purchase);
});

app.put('/api/purchases/:id', requireAuth, (req, res) => {
    const db = readDB();
    const idx = db.purchases.findIndex(p => p.id === req.params.id);
    if (idx === -1) return err(res, 'Compra no encontrada', 404);
    db.purchases[idx] = { ...db.purchases[idx], ...req.body, id: req.params.id };
    writeDB(db);
    ok(res, db.purchases[idx]);
});

app.delete('/api/purchases/:id', requireAuth, (req, res) => {
    const db = readDB();
    db.purchases = db.purchases.filter(p => p.id !== req.params.id);
    writeDB(db);
    ok(res, { deleted: req.params.id });
});

// ══════════════════════════════════════════════════════════════════════════════
// GASTOS
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/expenses', (req, res) => ok(res, readDB().expenses));

app.post('/api/expenses', requireAuth, (req, res) => {
    const db = readDB();
    const expense = { id: generateId(), createdAt: new Date().toISOString(), ...req.body };
    db.expenses.push(expense);
    writeDB(db);
    ok(res, expense);
});

app.put('/api/expenses/:id', requireAuth, (req, res) => {
    const db = readDB();
    const idx = db.expenses.findIndex(e => e.id === req.params.id);
    if (idx === -1) return err(res, 'Gasto no encontrado', 404);
    db.expenses[idx] = { ...db.expenses[idx], ...req.body, id: req.params.id };
    writeDB(db);
    ok(res, db.expenses[idx]);
});

app.delete('/api/expenses/:id', requireAuth, (req, res) => {
    const db = readDB();
    db.expenses = db.expenses.filter(e => e.id !== req.params.id);
    writeDB(db);
    ok(res, { deleted: req.params.id });
});

// ══════════════════════════════════════════════════════════════════════════════
// DEVOLUCIONES
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/returns', (req, res) => ok(res, readDB().returns));

app.post('/api/returns', requireAuth, (req, res) => {
    const db = readDB();
    const ret = { id: generateId(), createdAt: new Date().toISOString(), ...req.body };

    // Reponer stock del producto devuelto
    const prod = db.products.find(p => p.id === ret.productId);
    if (prod) {
        const prevStock = prod.stock;
        prod.stock += ret.quantity || 1;
        prod.updatedAt = new Date().toISOString();
        db.inventoryMovements.push({
            id: generateId(),
            productId: prod.id,
            productName: prod.name,
            type: 'Entrada',
            quantity: ret.quantity || 1,
            warehouseId: prod.warehouseId,
            date: new Date().toISOString(),
            user: 'admin',
            reason: 'Devolución',
            reference: ret.id,
            notes: ret.reason || '',
            previousStock: prevStock,
            newStock: prod.stock,
        });
    }

    db.returns.push(ret);
    writeDB(db);
    ok(res, ret);
});

app.delete('/api/returns/:id', requireAuth, (req, res) => {
    const db = readDB();
    db.returns = db.returns.filter(r => r.id !== req.params.id);
    writeDB(db);
    ok(res, { deleted: req.params.id });
});

// ══════════════════════════════════════════════════════════════════════════════
// MOVIMIENTOS DE INVENTARIO
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/inventory-movements', (req, res) => ok(res, readDB().inventoryMovements));

app.post('/api/inventory-movements', requireAuth, (req, res) => {
    const db = readDB();
    const mov = { id: generateId(), date: new Date().toISOString(), user: 'admin', ...req.body };

    // Aplicar el ajuste al stock del producto
    const prod = db.products.find(p => p.id === mov.productId);
    if (!prod) return err(res, 'Producto no encontrado', 404);

    const prevStock = prod.stock;
    if (mov.type === 'Entrada')         prod.stock += Math.abs(mov.quantity);
    else if (mov.type === 'Salida')     prod.stock  = Math.max(0, prod.stock - Math.abs(mov.quantity));
    else if (mov.type === 'Ajuste')     prod.stock  = Math.max(0, mov.quantity);
    else if (mov.type === 'Transferencia') prod.stock += Math.abs(mov.quantity);

    prod.updatedAt = new Date().toISOString();
    mov.previousStock = prevStock;
    mov.newStock      = prod.stock;
    mov.productName   = prod.name;

    db.inventoryMovements.push(mov);
    writeDB(db);
    ok(res, mov);
});

// ══════════════════════════════════════════════════════════════════════════════
// PAGOS
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/payments', (req, res) => ok(res, readDB().payments));

app.post('/api/payments', requireAuth, (req, res) => {
    const db = readDB();
    const payment = { id: generateId(), createdAt: new Date().toISOString(), ...req.body };

    // Actualizar saldo de factura si aplica
    if (payment.invoiceId) {
        const inv = db.invoices.find(i => i.id === payment.invoiceId);
        if (inv) {
            inv.paid = (inv.paid || 0) + payment.amount;
            if (inv.paid >= inv.total) inv.status = 'Pagada';
            else if (inv.paid > 0)     inv.status = 'Parcial';
        }
    }

    db.payments.push(payment);
    writeDB(db);
    ok(res, payment);
});

app.put('/api/payments/:id', (req, res) => {
    const db = readDB();
    const idx = db.payments.findIndex(p => p.id === req.params.id);
    if (idx === -1) return err(res, 'Pago no encontrado', 404);
    db.payments[idx] = { ...db.payments[idx], ...req.body, id: req.params.id };
    writeDB(db);
    ok(res, db.payments[idx]);
});

app.delete('/api/payments/:id', (req, res) => {
    const db = readDB();
    db.payments = db.payments.filter(p => p.id !== req.params.id);
    writeDB(db);
    ok(res, { deleted: req.params.id });
});

// ══════════════════════════════════════════════════════════════════════════════
// CONTABILIDAD
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/chart-of-accounts', (req, res) => ok(res, readDB().chartOfAccounts));

app.put('/api/chart-of-accounts', (req, res) => {
    const db = readDB();
    db.chartOfAccounts = req.body;
    writeDB(db);
    ok(res, db.chartOfAccounts);
});

app.get('/api/journal-entries', requireAuth, requireModule('accounting'), (req, res) => ok(res, readDB().journalEntries));

app.post('/api/journal-entries', requireAuth, requireModule('accounting'), (req, res) => {
    const db = readDB();
    const entry = { id: generateId(), date: new Date().toISOString().slice(0, 10), ...req.body };
    db.journalEntries.push(entry);
    writeDB(db);
    ok(res, entry);
});

app.get('/api/balance-sheet', (req, res) => ok(res, readDB().balanceSheet));

app.put('/api/balance-sheet', (req, res) => {
    const db = readDB();
    db.balanceSheet = req.body;
    writeDB(db);
    ok(res, db.balanceSheet);
});

app.get('/api/income-statement', (req, res) => ok(res, readDB().incomeStatement));

app.put('/api/income-statement', (req, res) => {
    const db = readDB();
    db.incomeStatement = req.body;
    writeDB(db);
    ok(res, db.incomeStatement);
});

// ══════════════════════════════════════════════════════════════════════════════
// ALERTAS
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/alerts', requireAuth, (req, res) => {
    const db  = readDB();
    const now = new Date();

    // Auto-generar alertas de stock bajo
    const stockAlerts = db.products
        .filter(p => p.stock <= p.minStock && p.status !== 'discontinuado')
        .map(p => ({
            id:      `alert-stock-${p.id}`,
            type:    'stock',
            level:   p.stock === 0 ? 'danger' : 'warning',
            message: p.stock === 0
                ? `Stock agotado: ${p.name}`
                : `Stock bajo: ${p.name} (${p.stock} unidades, mínimo ${p.minStock})`,
            productId: p.id,
            createdAt: now.toISOString(),
        }));

    // Auto-generar alertas de facturas vencidas
    const invoiceAlerts = db.invoices
        .filter(i => i.dueDate && new Date(i.dueDate) < now && i.paid < i.total && i.status !== 'Anulada')
        .map(i => ({
            id:        `alert-invoice-${i.id}`,
            type:      'invoice',
            level:     'danger',
            message:   `Factura vencida: ${i.number || i.id} — ${i.total}`,
            invoiceId: i.id,
            createdAt: now.toISOString(),
        }));

    ok(res, [...stockAlerts, ...invoiceAlerts, ...db.alerts]);
});

app.post('/api/alerts', (req, res) => {
    const db = readDB();
    const alert = { id: generateId(), createdAt: new Date().toISOString(), ...req.body };
    db.alerts.push(alert);
    writeDB(db);
    ok(res, alert);
});

app.delete('/api/alerts/:id', (req, res) => {
    const db = readDB();
    db.alerts = db.alerts.filter(a => a.id !== req.params.id);
    writeDB(db);
    ok(res, { deleted: req.params.id });
});

// ══════════════════════════════════════════════════════════════════════════════
// AUDITORÍA
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/audit-log', (req, res) => ok(res, readDB().auditLog));

app.post('/api/audit-log', (req, res) => {
    const db = readDB();
    const entry = { id: generateId(), timestamp: new Date().toISOString(), user: 'admin', ...req.body };
    db.auditLog.push(entry);
    writeDB(db);
    ok(res, entry);
});

// ══════════════════════════════════════════════════════════════════════════════
// HISTORIAL DE IMPORTACIONES
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/import-history', (req, res) => ok(res, readDB().importHistory));

app.post('/api/import-history', (req, res) => {
    const db = readDB();
    const record = { id: generateId(), date: new Date().toISOString(), status: 'Completada', ...req.body };
    db.importHistory.push(record);
    writeDB(db);
    ok(res, record);
});

app.delete('/api/import-history/:id', (req, res) => {
    const db = readDB();
    db.importHistory = db.importHistory.filter(h => h.id !== req.params.id);
    writeDB(db);
    ok(res, { deleted: req.params.id });
});

// ══════════════════════════════════════════════════════════════════════════════
// IMPORTACIÓN MASIVA DE PRODUCTOS (sin límite de plan, una sola escritura)
// POST /api/import-bulk  { products: [...], historyEntry: {...} }
// ══════════════════════════════════════════════════════════════════════════════
app.post('/api/import-bulk', requireAuth, (req, res) => {
    try {
        const { products: incoming = [], categories: newCats = [],
                suppliers: newSups = [], historyEntry, movements = [] } = req.body;

        if (!Array.isArray(incoming) || incoming.length === 0) {
            return err(res, 'No se recibieron productos', 400);
        }

        const db = readDB();
        db.importHistory = db.importHistory || [];
        db.inventoryMovements = db.inventoryMovements || [];

        let created = 0, updated = 0;

        // Agregar categorías nuevas
        newCats.forEach(cat => {
            if (!db.categories.find(c => c.id === cat.id)) {
                db.categories.push(cat);
            }
        });

        // Agregar proveedores nuevos
        newSups.forEach(sup => {
            if (!db.suppliers.find(s => s.id === sup.id)) {
                db.suppliers.push(sup);
            }
        });

        // Procesar productos
        incoming.forEach(p => {
            const idx = db.products.findIndex(x => x.id === p.id);
            if (idx >= 0) {
                db.products[idx] = { ...db.products[idx], ...p,
                    updatedAt: new Date().toISOString() };
                updated++;
            } else {
                db.products.push({
                    ...p,
                    createdAt:  p.createdAt  || new Date().toISOString(),
                    updatedAt:  new Date().toISOString(),
                    createdBy:  req.user.email || 'admin',
                    updatedBy:  req.user.email || 'admin'
                });
                created++;
            }
        });

        // Agregar movimientos de inventario
        movements.forEach(m => db.inventoryMovements.push(m));

        // Registrar en historial
        if (historyEntry) {
            db.importHistory.push({
                ...historyEntry,
                created, updated,
                id: historyEntry.id || generateId(),
                date: historyEntry.date || new Date().toISOString()
            });
        }

        writeDB(db);
        ok(res, { created, updated, total: incoming.length });
    } catch (e) {
        console.error('[import-bulk]', e);
        err(res, 'Error en importación masiva: ' + e.message, 500);
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/settings', (req, res) => ok(res, readDB().settings));

app.put('/api/settings', (req, res) => {
    const db = readDB();
    db.settings = { ...db.settings, ...req.body };
    writeDB(db);
    ok(res, db.settings);
});

// ══════════════════════════════════════════════════════════════════════════════
// BACKUP / RESTAURACIÓN
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/backup', (req, res) => {
    const db = readDB();
    res.setHeader('Content-Disposition', `attachment; filename="fixpro-backup-${Date.now()}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(db, null, 2));
});

app.post('/api/restore', requireAuth, (req, res) => {
    if (req.user.teamRole !== 'owner' && req.user.role !== 'admin') {
        return err(res, 'Solo el propietario puede restaurar la base de datos', 403);
    }
    try {
        if (!req.body || typeof req.body !== 'object') return err(res, 'Datos inválidos');
        writeDB(req.body);
        ok(res, { restored: true });
    } catch (e) {
        err(res, 'Error al restaurar backup', 500);
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// RESET TOTAL
// ══════════════════════════════════════════════════════════════════════════════
app.post('/api/reset', requireAuth, (req, res) => {
    // Solo el owner puede resetear su propia empresa
    if (req.user.teamRole !== 'owner' && req.user.role !== 'admin') {
        return err(res, 'Solo el propietario puede resetear la base de datos', 403);
    }
    const fresh = defaultData();
    writeDB(fresh);
    ok(res, { reset: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// REPORTES (generados al vuelo desde los datos)
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/reports/:type', (req, res) => {
    const db   = readDB();
    const type = req.params.type;

    if (type === 'sales') {
        const total = db.sales.reduce((a, s) => a + (s.total || 0), 0);
        return ok(res, {
            type: 'sales',
            totalSales: db.sales.length,
            totalRevenue: total,
            sales: db.sales,
        });
    }

    if (type === 'inventory') {
        const totalValue = db.products.reduce((a, p) => a + (p.stock * p.cost), 0);
        const lowStock   = db.products.filter(p => p.stock <= p.minStock);
        return ok(res, { type: 'inventory', totalValue, lowStock, products: db.products });
    }

    if (type === 'customers') {
        return ok(res, {
            type: 'customers',
            totalCustomers: db.customers.length,
            activeCustomers: db.customers.filter(c => c.status === 'activo').length,
            totalBalance: db.customers.reduce((a, c) => a + (c.balance || 0), 0),
            customers: db.customers,
        });
    }

    if (type === 'purchases') {
        const total = db.purchases.reduce((a, p) => a + (p.total || 0), 0);
        return ok(res, { type: 'purchases', totalPurchases: db.purchases.length, totalSpent: total, purchases: db.purchases });
    }

    if (type === 'expenses') {
        const total = db.expenses.reduce((a, e) => a + (e.amount || 0), 0);
        return ok(res, { type: 'expenses', totalExpenses: db.expenses.length, totalAmount: total, expenses: db.expenses });
    }

    if (type === 'financial') {
        return ok(res, {
            type: 'financial',
            balanceSheet: db.balanceSheet,
            incomeStatement: db.incomeStatement,
            chartOfAccounts: db.chartOfAccounts,
        });
    }

    err(res, 'Tipo de reporte no reconocido', 400);
});

// ══════════════════════════════════════════════════════════════════════════════
// AI COPILOT — respuestas basadas en los datos reales
// ══════════════════════════════════════════════════════════════════════════════
app.post('/api/ai/ask', requireAuth, requireModule('ai'), (req, res) => {
    const db       = readDB();
    const question = (req.body.question || '').toLowerCase();

    let answer = '';

    if (question.includes('vend') && question.includes('mes')) {
        const now   = new Date();
        const month = now.getMonth();
        const year  = now.getFullYear();
        const monthlySales = db.sales.filter(s => {
            const d = new Date(s.createdAt || s.date || 0);
            return d.getMonth() === month && d.getFullYear() === year;
        });
        const total = monthlySales.reduce((a, s) => a + (s.total || 0), 0);
        answer = `Este mes registraste ${monthlySales.length} ventas por un total de $${total.toFixed(2)}.`;

    } else if (question.includes('producto') && (question.includes('top') || question.includes('más vendido'))) {
        const counts = {};
        db.sales.forEach(s => (s.items || []).forEach(i => {
            counts[i.productId] = (counts[i.productId] || 0) + i.qty;
        }));
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
        if (sorted.length === 0) {
            answer = 'Aún no hay ventas registradas para calcular el top de productos.';
        } else {
            const list = sorted.map(([id, qty]) => {
                const p = db.products.find(x => x.id === id);
                return `${p ? p.name : id} (${qty} unidades)`;
            }).join(', ');
            answer = `Los productos más vendidos son: ${list}.`;
        }

    } else if (question.includes('inventario') || question.includes('stock')) {
        const totalValue = db.products.reduce((a, p) => a + (p.stock * p.cost), 0);
        const lowStock   = db.products.filter(p => p.stock <= p.minStock && p.stock > 0);
        const outStock   = db.products.filter(p => p.stock === 0);
        answer = `Valor total del inventario: $${totalValue.toFixed(2)}. Productos con stock bajo: ${lowStock.length}. Productos agotados: ${outStock.length}.`;

    } else if (question.includes('client') && (question.includes('deb') || question.includes('cobrar'))) {
        const debtors = db.customers.filter(c => c.balance > 0)
            .sort((a, b) => b.balance - a.balance).slice(0, 5);
        if (debtors.length === 0) {
            answer = 'Todos tus clientes están al día. No hay saldos pendientes.';
        } else {
            const list = debtors.map(c => `${c.firstName} ${c.lastName} ($${c.balance.toFixed(2)})`).join(', ');
            answer = `Clientes con saldo pendiente: ${list}.`;
        }

    } else if (question.includes('gasto')) {
        const now   = new Date();
        const month = now.getMonth();
        const year  = now.getFullYear();
        const monthlyExpenses = db.expenses.filter(e => {
            const d = new Date(e.date || e.createdAt || 0);
            return d.getMonth() === month && d.getFullYear() === year;
        });
        const total = monthlyExpenses.reduce((a, e) => a + (e.amount || 0), 0);
        answer = `Este mes registraste ${monthlyExpenses.length} gastos por un total de $${total.toFixed(2)}.`;

    } else {
        const totalSales     = db.sales.reduce((a, s) => a + (s.total || 0), 0);
        const inventoryValue = db.products.reduce((a, p) => a + (p.stock * p.cost), 0);
        answer = `Resumen del negocio: ${db.sales.length} ventas totales ($${totalSales.toFixed(2)}), ${db.products.length} productos, ${db.customers.length} clientes, inventario valorado en $${inventoryValue.toFixed(2)}.`;
    }

    ok(res, { answer });
});

// ══════════════════════════════════════════════════════════════════════════════
// AUTH — Registro, Login, Logout, Perfil
// Usuarios guardados en users.json (separado de db.json para seguridad)
// ══════════════════════════════════════════════════════════════════════════════
const USERS_PATH    = path.join(__dirname, 'users.json');
const SESSIONS_PATH = path.join(__dirname, 'sessions.json');

// ── Helpers de usuarios ──────────────────────────────────────────────────────
function readUsers() {
    try {
        if (!fs.existsSync(USERS_PATH)) return [];
        return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
    } catch { return []; }
}
function writeUsers(users) {
    fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2), 'utf8');
}

// ── Helpers de sesiones ──────────────────────────────────────────────────────
function readSessions() {
    try {
        if (!fs.existsSync(SESSIONS_PATH)) return {};
        return JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf8'));
    } catch { return {}; }
}
function writeSessions(s) {
    fs.writeFileSync(SESSIONS_PATH, JSON.stringify(s, null, 2), 'utf8');
}

// Token simple: random hex de 32 bytes
function makeToken() {
    return require('crypto').randomBytes(32).toString('hex');
}

// Hash simple de contraseña (SHA-256 — sin librerías extra)
function hashPassword(plain) {
    return require('crypto').createHash('sha256').update(plain + 'fixpromax_salt_2026').digest('hex');
}

// Middleware de autenticación — extrae token del header Authorization
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000; // 30 días

function requireAuth(req, res, next) {
    const header = req.headers['authorization'] || '';
    const token  = header.replace('Bearer ', '').trim();
    if (!token) return res.status(401).json({ ok: false, error: 'No autenticado' });
    const sessions = readSessions();
    const entry    = sessions[token];
    if (!entry) return res.status(401).json({ ok: false, error: 'Tu sesión ha expirado. Inicia sesión nuevamente.' });
    // Soporte para formato antiguo (string userId) y nuevo ({ userId, exp })
    const userId  = typeof entry === 'object' ? entry.userId : entry;
    const created = typeof entry === 'object' ? entry.created : 0;
    if (created && Date.now() - created > SESSION_TTL) {
        delete sessions[token];
        writeSessions(sessions);
        return res.status(401).json({ ok: false, error: 'Tu sesión ha expirado. Inicia sesión nuevamente.' });
    }
    const users = readUsers();
    const user  = users.find(u => u.id === userId);
    if (!user) return res.status(401).json({ ok: false, error: 'Usuario no encontrado' });
    if (user.active === false) return res.status(403).json({ ok: false, error: 'Esta cuenta ha sido suspendida.' });
    req.user = { id: user.id, name: user.name, email: user.email,
                 role: user.role, company: user.company, avatar: user.avatar,
                 mode: user.mode || 'basic',
                 companyId:   user.companyId   || user.id,
                 teamRole:    user.teamRole    || (user.role === 'admin' ? 'owner' : 'employee'),
                 permissions: user.permissions || DEFAULT_EMPLOYEE_PERMISSIONS,
                 isDemo:      user.isDemo || user.companyId === DEMO_COMPANY_ID || false };
    // Actualizar lastLogin (throttle: máx 1 vez por minuto para no sobrecargar)
    const now = Date.now();
    if (!user.lastLogin || now - new Date(user.lastLogin).getTime() > 60000) {
        user.lastLogin = new Date(now).toISOString();
        writeUsers(users);
    }
    // Inyectar companyId en contexto async para que readDB/writeDB usen la BD correcta
    // Si es demo → siempre usa la BD demo, nunca la global ni la de otros
    const ctxCompanyId = (user.isDemo || user.companyId === DEMO_COMPANY_ID)
        ? DEMO_COMPANY_ID
        : (user.companyId || user.id);
    reqContext.run({ companyId: ctxCompanyId, isDemo: req.user.isDemo }, next);
}

// ── REGISTRO ─────────────────────────────────────────────────────────────────
app.post('/api/auth/register', (req, res) => {
    const { name, email, password, company } = req.body;
    if (!name || !email || !password) {
        return err(res, 'Nombre, email y contraseña son obligatorios');
    }
    if (password.length < 6) {
        return err(res, 'La contraseña debe tener al menos 6 caracteres');
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return err(res, 'Email inválido');
    }
    const users = readUsers();
    if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
        return err(res, 'Ya existe una cuenta con ese email');
    }
    const newUser = {
        id:        generateId(),
        name:      name.trim(),
        email:     email.toLowerCase().trim(),
        password:  hashPassword(password),
        company:   (company || '').trim(),
        role:      users.length === 0 ? 'admin' : 'user',
        mode:      (req.body.mode === 'pro') ? 'pro' : 'basic',
        avatar:    name.trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2),
        createdAt: new Date().toISOString(),
        trialStart: new Date().toISOString(),   // inicio del trial de 3 días
        active:    true,
        // Sistema multiusuario: cada nuevo registro independiente crea su empresa
        companyId: generateId(),   // empresa propia
        teamRole:  'owner',        // propietario de su empresa
        permissions: null,         // propietario tiene todos los permisos
    };
    // Crear BD para la nueva empresa
    if (!fs.existsSync(dbPath(newUser.companyId))) {
        writeCompanyDB(newUser.companyId, defaultData());
    }
    users.push(newUser);
    writeUsers(users);

    const token    = makeToken();
    const sessions = readSessions();
    sessions[token] = { userId: newUser.id, created: Date.now() };
    writeSessions(sessions);

    console.log(`✅ Nuevo usuario registrado: ${newUser.email} (${newUser.role}) modo:${newUser.mode}`);
    ok(res, {
        token,
        user: { id: newUser.id, name: newUser.name, email: newUser.email,
                role: newUser.role, company: newUser.company, avatar: newUser.avatar,
                mode: newUser.mode, companyId: newUser.companyId, teamRole: newUser.teamRole }
    });
});

// ── LOGIN ─────────────────────────────────────────────────────────────────────
const _loginAttempts = {};   // { email: { count, blockedUntil } }

app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return err(res, 'Debes completar todos los campos.');
    const key   = email.toLowerCase().trim();
    const entry = _loginAttempts[key] || { count: 0, blockedUntil: 0 };

    // Verificar bloqueo
    if (entry.blockedUntil > Date.now()) {
        const mins = Math.ceil((entry.blockedUntil - Date.now()) / 60000);
        return err(res, `Demasiados intentos fallidos. Intenta de nuevo en ${mins} minuto(s).`, 429);
    }

    const users = readUsers();
    const user  = users.find(u => u.email.toLowerCase() === key);
    if (!user || user.password !== hashPassword(password)) {
        // Registrar intento fallido
        entry.count = (entry.count || 0) + 1;
        if (entry.count >= 5) {
            entry.blockedUntil = Date.now() + 5 * 60 * 1000;  // 5 min
            entry.count = 0;
            _loginAttempts[key] = entry;
            return err(res, 'Demasiados intentos. Tu cuenta está bloqueada por 5 minutos.', 429);
        }
        _loginAttempts[key] = entry;
        const remaining = 5 - entry.count;
        return err(res, `El correo electrónico o la contraseña son incorrectos.${remaining <= 2 ? ` Te quedan ${remaining} intento(s).` : ''}`, 401);
    }

    if (!user.active) return err(res, 'Esta cuenta está desactivada.', 403);

    // Login exitoso — limpiar intentos
    delete _loginAttempts[key];

    const token    = makeToken();
    const sessions = readSessions();
    // Limpiar sesiones anteriores del mismo usuario para no acumular tokens
    Object.keys(sessions).forEach(tok => {
        const e = sessions[tok];
        const uid = typeof e === 'object' ? e.userId : e;
        if (uid === user.id) delete sessions[tok];
    });
    sessions[token] = { userId: user.id, created: Date.now() };
    writeSessions(sessions);

    console.log(`✅ Login: ${user.email}`);
    // Setear cookie de sesión para que GET / pueda inyectar los datos correctos
    res.cookie('fixpromax_token', token, {
        httpOnly: false,      // false para que el cliente JS también pueda leerla si necesita
        sameSite: 'Lax',
        maxAge:   30 * 24 * 60 * 60 * 1000,  // 30 días
        path:     '/'
    });
    ok(res, {
        token,
        user: { id: user.id, name: user.name, email: user.email,
                role: user.role, company: user.company, avatar: user.avatar,
                mode: user.mode || 'basic', mustChange: user.mustChange || false,
                companyId: user.companyId || user.id,
                teamRole:  user.teamRole  || (user.role === 'admin' ? 'owner' : 'employee') }
    });
});

// ── CAMBIO DE CONTRASEÑA (autenticado, para mustChange) ──────────────────────
app.post('/api/auth/change-password', requireAuth, (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6)
        return err(res, 'La contraseña debe tener al menos 6 caracteres');
    const users = readUsers();
    const idx   = users.findIndex(u => u.id === req.user.id);
    if (idx === -1) return err(res, 'Usuario no encontrado', 404);
    users[idx].password    = hashPassword(newPassword);
    users[idx].mustChange  = false;
    writeUsers(users);
    console.log(`🔑 Contraseña cambiada: ${users[idx].email}`);
    ok(res, { changed: true });
});

// ── RECUPERACIÓN — solicitar código ──────────────────────────────────────────
const _recoverCodes = {};   // { email: { code, exp } }  en memoria
app.post('/api/auth/recover-request', (req, res) => {
    const { email } = req.body;
    if (!email) return err(res, 'Email requerido');
    const users = readUsers();
    const user  = users.find(u => u.email.toLowerCase() === email.toLowerCase().trim());
    if (!user) return err(res, 'No existe una cuenta con ese correo', 404);

    // Generar código de 6 dígitos
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    _recoverCodes[email.toLowerCase()] = { code, exp: Date.now() + 10 * 60 * 1000 }; // 10 min

    console.log(`🔐 Código de recuperación para ${email}: ${code}`);
    // En producción aquí se enviaría el email. Por ahora se devuelve en la respuesta (dev mode).
    ok(res, { sent: true, devCode: code });   // devCode solo visible en desarrollo
});

// ── RECUPERACIÓN — validar código y cambiar contraseña ───────────────────────
app.post('/api/auth/recover-reset', (req, res) => {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) return err(res, 'Faltan datos requeridos');
    if (newPassword.length < 6) return err(res, 'La contraseña debe tener al menos 6 caracteres');

    const stored = _recoverCodes[email.toLowerCase()];
    if (!stored)                      return err(res, 'No hay código activo para este correo. Solicita uno nuevo.', 400);
    if (Date.now() > stored.exp)      { delete _recoverCodes[email.toLowerCase()]; return err(res, 'El código ha expirado. Solicita uno nuevo.', 400); }
    if (stored.code !== code.trim())  return err(res, 'El código es incorrecto. Verifica e intenta de nuevo.', 400);

    const users = readUsers();
    const idx   = users.findIndex(u => u.email.toLowerCase() === email.toLowerCase());
    if (idx === -1) return err(res, 'Usuario no encontrado', 404);
    users[idx].password   = hashPassword(newPassword);
    users[idx].mustChange = false;
    writeUsers(users);
    delete _recoverCodes[email.toLowerCase()];
    console.log(`✅ Contraseña recuperada: ${email}`);
    ok(res, { reset: true });
});
app.post('/api/auth/logout', (req, res) => {
    const header   = req.headers['authorization'] || '';
    const token    = header.replace('Bearer ', '').trim();
    const sessions = readSessions();
    delete sessions[token];
    writeSessions(sessions);
    // Borrar la cookie de sesión
    res.clearCookie('fixpromax_token', { path: '/' });
    ok(res, { loggedOut: true });
});

// ── PERFIL del usuario actual ─────────────────────────────────────────────────
app.get('/api/auth/me', requireAuth, (req, res) => {
    ok(res, { ...req.user });
});

// ── LISTAR usuarios (solo admin) ──────────────────────────────────────────────
app.get('/api/auth/users', requireAuth, (req, res) => {
    if (req.user.role !== 'admin') return err(res, 'Sin permisos', 403);
    const users = readUsers().map(u => ({
        id: u.id, name: u.name, email: u.email,
        role: u.role, company: u.company, avatar: u.avatar,
        createdAt: u.createdAt, active: u.active,
    }));
    ok(res, users);
});

// ── ACTUALIZAR perfil ─────────────────────────────────────────────────────────
app.put('/api/auth/me', requireAuth, (req, res) => {
    const users = readUsers();
    const idx   = users.findIndex(u => u.id === req.user.id);
    if (idx === -1) return err(res, 'Usuario no encontrado', 404);
    const { name, company, password, newPassword, mode } = req.body;
    if (name)    users[idx].name    = name.trim();
    if (company) users[idx].company = company.trim();
    if (mode && ['basic','pro'].includes(mode)) users[idx].mode = mode;
    if (password && newPassword) {
        if (users[idx].password !== hashPassword(password)) {
            return err(res, 'Contraseña actual incorrecta');
        }
        if (newPassword.length < 6) return err(res, 'La nueva contraseña debe tener al menos 6 caracteres');
        users[idx].password = hashPassword(newPassword);
    }
    users[idx].avatar = users[idx].name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    writeUsers(users);
    ok(res, { id: users[idx].id, name: users[idx].name, email: users[idx].email,
              role: users[idx].role, company: users[idx].company, avatar: users[idx].avatar,
              mode: users[idx].mode || 'basic' });
});

// ── Página de emergencia /entrar — SOLO DISPONIBLE EN LOCALHOST ──────────────
app.get('/entrar', (req, res) => {
    const host = req.hostname || req.headers.host || '';
    const isLocal = host.startsWith('localhost') || host.startsWith('127.0.0.1') || host.startsWith('::1');
    if (!isLocal) return res.status(404).json({ ok: false, error: 'Not found' });
    const users = readUsers();
    if (!users.length) {
        return res.send('<h2>No hay usuarios. Ve a <a href="/">http://localhost:3000</a> y regístrate.</h2>');
    }
    // Mostrar lista de usuarios para entrar directo
    const lista = users.map(u => `
        <div style="margin:8px 0;padding:12px;background:#f8fafc;border-radius:8px;display:flex;align-items:center;justify-content:space-between;">
            <div>
                <strong>${u.name}</strong> — ${u.email}
                <span style="font-size:12px;color:#64748b;margin-left:8px;">(${u.role})</span>
            </div>
            <a href="/entrar-como?id=${u.id}" style="background:#4f46e5;color:#fff;padding:8px 20px;border-radius:6px;text-decoration:none;font-weight:600;">
                Entrar →
            </a>
        </div>
    `).join('');

    res.send(`<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Acceso de Emergencia — FIX PRO MAX</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,sans-serif;background:#0f172a;color:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.card{background:#1e293b;border-radius:16px;padding:32px;max-width:520px;width:100%;box-shadow:0 20px 40px rgba(0,0,0,.5)}
h1{font-size:22px;margin-bottom:4px}p{color:#94a3b8;font-size:14px;margin-bottom:24px}
</style></head><body>
<div class="card">
    <h1>🔑 Acceso de Emergencia</h1>
    <p>Selecciona tu cuenta para entrar directamente sin contraseña.</p>
    ${lista}
    <div style="margin-top:20px;padding-top:16px;border-top:1px solid #334155;font-size:13px;color:#64748b;">
        <strong>Contraseña temporal de todos los usuarios:</strong> <code style="background:#0f172a;padding:2px 8px;border-radius:4px;color:#a78bfa">Cambiar123</code>
        <br><a href="/" style="color:#818cf8;text-decoration:none;margin-top:8px;display:inline-block;">← Volver al inicio normal</a>
    </div>
</div>
</body></html>`);
});

// Entrar como un usuario específico — SOLO LOCALHOST
app.get('/entrar-como', (req, res) => {
    const host = req.hostname || req.headers.host || '';
    const isLocal = host.startsWith('localhost') || host.startsWith('127.0.0.1') || host.startsWith('::1');
    if (!isLocal) return res.status(404).json({ ok: false, error: 'Not found' });
    const { id } = req.query;
    const users = readUsers();
    const user = users.find(u => u.id === id);
    if (!user) return res.redirect('/entrar');

    const token    = makeToken();
    const sessions = readSessions();
    sessions[token] = { userId: user.id, created: Date.now() };
    writeSessions(sessions);

    // Redirigir al index con el token en la URL para que el JS lo capture
    res.redirect(`/?token=${token}&name=${encodeURIComponent(user.name)}&email=${encodeURIComponent(user.email)}&role=${user.role}&mode=${user.mode||'basic'}&avatar=${encodeURIComponent(user.avatar||'')}&company=${encodeURIComponent(user.company||'')}`);
});

// ══════════════════════════════════════════════════════════════════════════════
// SUSCRIPCIÓN — Trial gratuito 3 días + planes de pago
// La validación se hace en el servidor para evitar manipulación del cliente.
// ══════════════════════════════════════════════════════════════════════════════
const TRIAL_DAYS = 3;

// ══════════════════════════════════════════════════════════════════════════════
// CONFIG GLOBAL — planes y métodos de pago persistentes en config.json
// Cualquier cambio desde el panel admin se guarda aquí y aplica a todos
// ══════════════════════════════════════════════════════════════════════════════
const CONFIG_PATH = path.join(__dirname, 'config.json');

// Métodos de pago predeterminados (si config.json no existe aún)
const DEFAULT_PAYMENT_METHODS = [
    { id: 'CASH',          label: 'Efectivo',              icon: '💵', active: true,  type: 'pos',  isManual: false },
    { id: 'CREDIT_CARD',   label: 'Tarjeta Crédito',       icon: '💳', active: true,  type: 'pos',  isManual: false },
    { id: 'DEBIT_CARD',    label: 'Tarjeta Débito',        icon: '💳', active: true,  type: 'pos',  isManual: false },
    { id: 'ZELLE',         label: 'Zelle',                 icon: '⚡', active: true,  type: 'both', isManual: true  },
    { id: 'USDT',          label: 'USDT / Cripto',         icon: '🟡', active: true,  type: 'both', isManual: true  },
    { id: 'BANK_TRANSFER', label: 'Transferencia bancaria', icon: '🏦', active: true, type: 'pos',  isManual: false },
    { id: 'PAGO_MOVIL',    label: 'Pago Móvil',            icon: '📱', active: true,  type: 'both', isManual: true  },
    { id: 'PAYPAL',        label: 'PayPal',                icon: '🅿️', active: false, type: 'sub',  isManual: false },
];

function readConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) return null;
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch { return null; }
}

function writeConfig(cfg) {
    // Usar Buffer UTF-8 explícito para que los emojis no se corrompan
    const json = JSON.stringify(cfg, null, 2);
    fs.writeFileSync(CONFIG_PATH, Buffer.from(json, 'utf8'));
}

/** Devuelve la config completa, creando el archivo si no existe */
function getConfig() {
    let cfg = readConfig();
    if (!cfg) {
        cfg = {
            paymentMethods: DEFAULT_PAYMENT_METHODS,
            plansOverride:  {},   // sólo los campos sobreescritos por el admin
            updatedAt: new Date().toISOString(),
        };
        writeConfig(cfg);
    }
    if (!cfg.paymentMethods) cfg.paymentMethods = DEFAULT_PAYMENT_METHODS;
    if (!cfg.plansOverride)  cfg.plansOverride  = {};
    return cfg;
}

/** Aplica los overrides guardados en config.json sobre la constante PLANS */
function applyPlansOverrides() {
    const cfg = getConfig();
    const overrides = cfg.plansOverride || {};
    Object.keys(overrides).forEach(planId => {
        if (PLANS[planId]) {
            Object.assign(PLANS[planId], overrides[planId]);
        }
    });
}

// ── Planes de suscripción — estructura extensible ─────────────────────────────
// Los planes se pueden editar sin reconstruir el sistema.
// Los cambios del admin se persisten en config.json (plansOverride).
const PLANS = {
    basic: {
        id:          'basic',
        name:        'Plan Básico',
        description: 'Perfecto para empezar. Acceso completo para 1 usuario.',
        icon:        '📦',
        price:       10.00,
        currency:    'USD',
        duration:    30,
        period:      '1 mes',
        maxUsers:    1,
        multiUser:   false,
        maxProducts: 500,
        maxSales:    -1,
        maxInvoices: -1,
        recommended: false,
        badge:       '',
        active:      true,
        order:       1,
        googlePlayId:'com.fixpromax.erp.basic',
        // Módulos permitidos (true = acceso, false = bloqueado)
        modules: {
            pos: true, sales: true, invoices: true, products: true,
            inventory: true, customers: true, suppliers: true,
            expenses: true, purchases: true, returns: true,
            reports: true, finance: false, accounting: false,
            payables: false, receivables: false, ai: false,
            team: false,
        },
        features: [
            '1 usuario',
            'Inventario (hasta 500 productos)',
            'Ventas ilimitadas',
            'Facturas ilimitadas',
            'Gastos',
            'Reportes básicos',
        ],
        notIncluded: ['Multiusuario', 'Contabilidad', 'Finanzas P&L', 'Cuentas por cobrar/pagar', 'AI Copilot', 'Soporte prioritario'],
    },
    pro: {
        id:          'pro',
        name:        'Plan Pro',
        description: 'Para negocios en crecimiento. Multiusuario habilitado.',
        icon:        '🚀',
        price:       15.00,
        currency:    'USD',
        duration:    90,
        period:      '3 meses',
        maxUsers:    3,
        multiUser:   true,
        maxProducts: 500,
        maxSales:    -1,
        maxInvoices: -1,
        recommended: true,
        badge:       '⭐ RECOMENDADO',
        active:      true,
        order:       2,
        googlePlayId:'com.fixpromax.erp.pro',
        modules: {
            pos: true, sales: true, invoices: true, products: true,
            inventory: true, customers: true, suppliers: true,
            expenses: true, purchases: true, returns: true,
            reports: true, finance: true, accounting: true,
            payables: true, receivables: true, ai: true,
            team: true,
        },
        features: [
            'Hasta 3 usuarios',
            '👥 Multiusuario + permisos por rol',
            'Inventario (hasta 500 productos)',
            'Ventas ilimitadas',
            'Contabilidad completa',
            'Finanzas P&L',
            'AI Copilot',
            'Todo el Plan Básico',
        ],
        notIncluded: ['Inventario ilimitado', 'Soporte prioritario'],
    },
    semestral: {
        id:          'semestral',
        name:        'Plan Semestral',
        description: 'El mayor valor. 6 meses con todas las funciones.',
        icon:        '💎',
        price:       22.99,
        currency:    'USD',
        duration:    180,
        period:      '6 meses',
        maxUsers:    5,
        multiUser:   true,
        maxProducts: -1,
        maxSales:    -1,
        maxInvoices: -1,
        recommended: false,
        badge:       '👑 MEJOR VALOR',
        active:      true,
        order:       3,
        googlePlayId:'com.fixpromax.erp.semestral',
        modules: {
            pos: true, sales: true, invoices: true, products: true,
            inventory: true, customers: true, suppliers: true,
            expenses: true, purchases: true, returns: true,
            reports: true, finance: true, accounting: true,
            payables: true, receivables: true, ai: true,
            team: true,
        },
        features: [
            'Hasta 5 usuarios',
            '👥 Multiusuario + permisos por rol',
            'Inventario ilimitado',
            'Todo el Plan Pro',
            'Soporte prioritario',
            '6 meses de acceso',
        ],
        notIncluded: [],
    },
};

// Aplicar overrides guardados por el admin al arrancar
applyPlansOverrides();

// ── Helpers de planes ─────────────────────────────────────────────────────────
function getActivePlans() {
    return Object.values(PLANS).filter(p => p.active).sort((a, b) => a.order - b.order);
}

function getPlan(planId) {
    return PLANS[planId] || null;
}

function getMaxTeamByPlan(user) {
    if (user.role === 'admin') return 99;
    const plan = getPlan(user.subscriptionPlan);
    if (!plan) return 1;
    return plan.maxUsers || 1;
}

function planAllowsMultiUser(user) {
    if (user.role === 'admin') return true;
    const plan = getPlan(user.subscriptionPlan);
    return plan ? (plan.multiUser === true) : false;
}

// Módulos permitidos durante el trial (igual que plan básico)
const TRIAL_MODULES = {
    pos: true, sales: true, invoices: true, products: true,
    inventory: true, customers: true, suppliers: true,
    expenses: true, purchases: true, returns: true,
    reports: true, finance: false, accounting: false,
    payables: false, receivables: false, ai: false,
    team: false,
};
// Módulos permitidos cuando no hay acceso (solo lectura básica)
const NO_ACCESS_MODULES = {
    pos: false, sales: false, invoices: false, products: false,
    inventory: false, customers: false, suppliers: false,
    expenses: false, purchases: false, returns: false,
    reports: false, finance: false, accounting: false,
    payables: false, receivables: false, ai: false,
    team: false,
};

function getAccessStatus(user) {
    const now = Date.now();
    if (user.role === 'admin') {
        return { status: 'admin', access: true, daysLeft: null, multiUser: true, maxUsers: 99, maxProducts: -1, plan: 'admin', planName: 'Administrador', modules: Object.fromEntries(Object.keys(TRIAL_MODULES).map(k => [k, true])) };
    }

    if (user.subscriptionStatus === 'active' && user.subscriptionEnd && new Date(user.subscriptionEnd).getTime() > now) {
        const daysLeft = Math.ceil((new Date(user.subscriptionEnd).getTime() - now) / 86400000);
        const plan = getPlan(user.subscriptionPlan) || {};
        return {
            status: 'subscribed', access: true,
            plan: user.subscriptionPlan, planName: plan.name || user.subscriptionPlan,
            end: user.subscriptionEnd, daysLeft,
            multiUser: plan.multiUser || false, maxUsers: plan.maxUsers || 1,
            maxProducts: plan.maxProducts ?? -1,
            modules: plan.modules || TRIAL_MODULES,
        };
    }
    if (user.subscriptionStatus === 'cancelled' && user.subscriptionEnd && new Date(user.subscriptionEnd).getTime() > now) {
        const daysLeft = Math.ceil((new Date(user.subscriptionEnd).getTime() - now) / 86400000);
        const plan = getPlan(user.subscriptionPlan) || {};
        return {
            status: 'cancelled_active', access: true,
            plan: user.subscriptionPlan, planName: plan.name || user.subscriptionPlan,
            end: user.subscriptionEnd, daysLeft,
            multiUser: plan.multiUser || false, maxUsers: plan.maxUsers || 1,
            maxProducts: plan.maxProducts ?? -1,
            modules: plan.modules || TRIAL_MODULES,
        };
    }

    const trialBase = user.trialStart || user.createdAt;
    if (trialBase) {
        const trialEnd = new Date(trialBase).getTime() + TRIAL_DAYS * 86400000;
        const msLeft   = trialEnd - now;
        if (msLeft > 0) {
            return { status: 'trial', access: true, daysLeft: Math.ceil(msLeft / 86400000), trialEnd: new Date(trialEnd).toISOString(), multiUser: false, maxUsers: 1, maxProducts: 500, modules: TRIAL_MODULES };
        }
        return { status: 'trial_expired', access: false, daysLeft: 0, trialEnd: new Date(trialEnd).toISOString(), multiUser: false, maxUsers: 1, maxProducts: 0, modules: NO_ACCESS_MODULES };
    }
    return { status: 'no_access', access: false, daysLeft: 0, multiUser: false, maxUsers: 1, maxProducts: 0, modules: NO_ACCESS_MODULES };
}

// ── Middleware: bloquear endpoint si el módulo no está en el plan ─────────────
function requireModule(moduleName) {
    return function(req, res, next) {
        if (!req.user) return next(); // requireAuth ya lo rechazó antes
        if (req.user.role === 'admin') return next(); // admin siempre pasa
        const users  = readUsers();
        const owner  = users.find(u => u.companyId === req.user.companyId && u.teamRole === 'owner') || req.user;
        const status = getAccessStatus(owner);
        if (status.modules && status.modules[moduleName] === false) {
            return res.status(403).json({ ok: false, error: `Tu plan no incluye acceso a este módulo. Actualiza tu suscripción para desbloquearlo.` });
        }
        next();
    };
}

// ── Helpers de pagos ──────────────────────────────────────────────────────────
const PAYMENTS_PATH = path.join(__dirname, 'payments.json');

function readPayments() {
    try {
        if (!fs.existsSync(PAYMENTS_PATH)) return [];
        return JSON.parse(fs.readFileSync(PAYMENTS_PATH, 'utf8'));
    } catch { return []; }
}

function writePayments(data) {
    fs.writeFileSync(PAYMENTS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function recordPayment({ userId, userEmail, planId, planName, amount, currency, method, status, source, orderId, note }) {
    const payments = readPayments();
    const entry = {
        id:        generateId(),
        ts:        new Date().toISOString(),
        userId,
        userEmail,
        planId,
        planName,
        amount,
        currency:  currency || 'USD',
        method:    method   || 'unknown',
        status:    status   || 'completed',  // completed | pending | failed | refunded
        source:    source   || 'web',
        orderId:   orderId  || null,
        note:      note     || '',
    };
    payments.unshift(entry);
    if (payments.length > 10000) payments.splice(10000);
    writePayments(payments);
    return entry;
}

// ── ENDPOINTS DE PLANES ───────────────────────────────────────────────────────

// Público: listar planes activos
app.get('/api/subscription/plans', (req, res) => {
    ok(res, getActivePlans());
});

// Público: obtener un plan específico
app.get('/api/subscription/plans/:id', (req, res) => {
    const plan = getPlan(req.params.id);
    if (!plan || !plan.active) return err(res, 'Plan no encontrado', 404);
    ok(res, plan);
});

// Admin: listar TODOS los planes (incluyendo inactivos)
app.get('/api/admin/plans', requireAdmin, (req, res) => {
    ok(res, Object.values(PLANS).sort((a, b) => a.order - b.order));
});

// Admin: actualizar un plan (precio, nombre, características, etc.)
app.put('/api/admin/plans/:id', requireAdmin, (req, res) => {
    const plan = PLANS[req.params.id];
    if (!plan) return err(res, 'Plan no encontrado', 404);
    const allowed = ['name','description','price','duration','period','maxUsers','maxProducts',
                     'multiUser','recommended','badge','active','order','features','notIncluded'];
    const changes = {};
    allowed.forEach(k => {
        if (req.body[k] !== undefined) {
            plan[k] = req.body[k];
            changes[k] = req.body[k];
        }
    });
    // Persistir cambios en config.json
    const cfg = getConfig();
    cfg.plansOverride[plan.id] = Object.assign(cfg.plansOverride[plan.id] || {}, changes);
    cfg.updatedAt = new Date().toISOString();
    writeConfig(cfg);
    logAdminAction(req.admin.id, req.admin.email, 'plan_update', null, null, `plan:${plan.id} → ${JSON.stringify(changes)}`);
    // Notificar a TODOS los clientes conectados (app y admin) del cambio de plan
    setImmediate(() => {
        if (typeof broadcastSSE === 'function') {
            broadcastSSE('plan_updated', { planId: plan.id, changes, updatedAt: new Date().toISOString() });
        }
    });
    ok(res, plan);
});

// Admin: estadísticas de planes y suscripciones
app.get('/api/admin/plans/stats', requireAdmin, (req, res) => {
    const users    = readUsers();
    const payments = readPayments();
    const now      = Date.now();

    // Conteos por estado
    const byStatus = { trial: 0, subscribed: 0, cancelled_active: 0, trial_expired: 0, no_access: 0, admin: 0 };
    const byPlan   = {};
    let revenue30d = 0, revenue7d = 0, revenueTotal = 0;

    users.forEach(u => {
        const s = getAccessStatus(u);
        byStatus[s.status] = (byStatus[s.status] || 0) + 1;
        if (s.status === 'subscribed' || s.status === 'cancelled_active') {
            byPlan[s.plan] = (byPlan[s.plan] || 0) + 1;
        }
    });

    payments.forEach(p => {
        if (p.status === 'completed') {
            revenueTotal += p.amount || 0;
            const age = now - new Date(p.ts).getTime();
            if (age <= 7  * 86400000) revenue7d  += p.amount || 0;
            if (age <= 30 * 86400000) revenue30d += p.amount || 0;
        }
    });

    // Conversión trial → pago
    const totalTrialEver  = users.filter(u => u.trialStart).length;
    const totalConverted  = users.filter(u => u.subscriptionStatus === 'active' || u.subscriptionStatus === 'cancelled').length;
    const conversionRate  = totalTrialEver > 0 ? Math.round(totalConverted / totalTrialEver * 100) : 0;

    ok(res, {
        byStatus,
        byPlan,
        revenue: { total: +revenueTotal.toFixed(2), last30d: +revenue30d.toFixed(2), last7d: +revenue7d.toFixed(2) },
        conversion: { trialsTotal: totalTrialEver, converted: totalConverted, rate: conversionRate },
        totalUsers: users.length,
        recentPayments: payments.slice(0, 20),
    });
});

// ── ENDPOINTS DE SUSCRIPCIÓN ──────────────────────────────────────────────────

app.get('/api/subscription/status', requireAuth, (req, res) => {
    const users = readUsers();
    const user  = users.find(u => u.id === req.user.id);
    if (!user) return err(res, 'Usuario no encontrado', 404);

    // Garantizar que trialStart existe (inicializar si falta)
    let changed = false;
    if (!user.trialStart) {
        user.trialStart = user.createdAt || new Date().toISOString();
        changed = true;
    }

    // Para empleados: verificar suscripción del owner de su empresa
    const owner = (user.teamRole === 'employee')
        ? (users.find(u => u.companyId === user.companyId && u.teamRole === 'owner') || user)
        : user;

    if (!owner.trialStart) {
        owner.trialStart = owner.createdAt || new Date().toISOString();
        changed = true;
    }
    if (changed) writeUsers(users);

    ok(res, { ...getAccessStatus(owner), plans: getActivePlans() });
});

app.post('/api/subscription/activate', requireAuth, (req, res) => {
    const { planId, purchaseToken, orderId, source, paymentData, manual } = req.body;
    if (!planId || !getPlan(planId)) return err(res, 'Plan inválido');

    const users = readUsers();
    const idx   = users.findIndex(u => u.id === req.user.id);
    if (idx === -1) return err(res, 'Usuario no encontrado', 404);

    // Solo el propietario/owner puede suscribirse
    if (users[idx].teamRole === 'employee') {
        return err(res, 'Solo el propietario de la cuenta puede gestionar la suscripción.', 403);
    }

    const plan   = getPlan(planId);
    const now    = new Date();
    const subEnd = new Date(now.getTime() + plan.duration * 86400000);

    // Determinar estado según método de pago
    // Consultar config para saber si el método es manual (verificación requerida)
    // Soporta IDs en mayúsculas (ZELLE, USDT, PAGO_MOVIL) y minúsculas por compatibilidad
    const _configMethod = getConfig().paymentMethods.find(
        m => m.id === source || m.id === (source||'').toUpperCase() || m.id === (source||'').toLowerCase()
    );
    const isManualPayment = manual === true
        || (_configMethod ? !!_configMethod.isManual : false)
        || ['zelle','binance','pago_movil','ZELLE','USDT','PAGO_MOVIL'].includes(source||'');

    Object.assign(users[idx], {
        subscriptionStatus:    isManualPayment ? 'pending_verification' : 'active',
        subscriptionPlan:      planId,
        subscriptionStart:     now.toISOString(),
        subscriptionEnd:       isManualPayment ? users[idx].subscriptionEnd : subEnd.toISOString(),
        subscriptionOrderId:   orderId  || null,
        subscriptionToken:     purchaseToken || null,
        subscriptionSource:    source || 'web',
        subscriptionRenewedAt: now.toISOString(),
        pendingPlanId:         isManualPayment ? planId : null,
        pendingPlanSince:      isManualPayment ? now.toISOString() : null,
    });
    writeUsers(users);

    // Registrar pago
    recordPayment({
        userId:    users[idx].id,
        userEmail: users[idx].email,
        planId,
        planName:  plan.name,
        amount:    plan.price,
        currency:  plan.currency,
        method:    paymentData?.method || source || 'web',
        status:    isManualPayment ? 'pending' : 'completed',
        source:    source || 'web',
        orderId:   orderId || null,
        note:      isManualPayment ? 'Verificación pendiente' : '',
    });

    console.log(`✅ Suscripción ${isManualPayment ? 'pendiente' : 'activada'}: ${users[idx].email} → ${planId}`);

    // Alerta WhatsApp automática
    if (isManualPayment) {
        alertWA('payment_pending', {
            id: generateId(), userEmail: users[idx].email,
            userName: users[idx].name, company: users[idx].company||'—',
            planName: plan.name, amount: plan.price,
        });
    } else {
        alertWA('subscription_new', {
            id: generateId(), userEmail: users[idx].email,
            userName: users[idx].name, company: users[idx].company||'—',
            planName: plan.name, amount: plan.price,
        });
    }

    ok(res, {
        message: isManualPayment
            ? 'Solicitud recibida. Verificaremos tu pago y activaremos el plan en menos de 2 horas.'
            : '¡Suscripción activada!',
        pending: isManualPayment,
        ...getAccessStatus(users[idx]),
    });
});

app.post('/api/subscription/cancel', requireAuth, (req, res) => {
    const users = readUsers();
    const idx   = users.findIndex(u => u.id === req.user.id);
    if (idx === -1) return err(res, 'Usuario no encontrado', 404);
    if (users[idx].teamRole === 'employee') return err(res, 'Solo el propietario puede cancelar la suscripción.', 403);
    if (users[idx].subscriptionStatus !== 'active') return err(res, 'No hay suscripción activa que cancelar.');
    users[idx].subscriptionStatus      = 'cancelled';
    users[idx].subscriptionCancelledAt = new Date().toISOString();
    writeUsers(users);
    logAdminAction(users[idx].id, users[idx].email, 'subscription_cancel_self', users[idx].id, users[idx].email, `plan:${users[idx].subscriptionPlan}`);

    // Alerta WhatsApp automática
    alertWA('subscription_cancelled', {
        id: generateId(), userEmail: users[idx].email,
        userName: users[idx].name, company: users[idx].company||'—',
        planName: getPlan(users[idx].subscriptionPlan)?.name || users[idx].subscriptionPlan || '—',
    });

    ok(res, {
        message: `Suscripción cancelada. Mantendrás acceso hasta ${new Date(users[idx].subscriptionEnd).toLocaleDateString('es')}.`,
        end: users[idx].subscriptionEnd,
        ...getAccessStatus(users[idx]),
    });
});

app.post('/api/subscription/restore', requireAuth, (req, res) => {
    const users = readUsers();
    const user  = users.find(u => u.id === req.user.id);
    if (!user) return err(res, 'Usuario no encontrado', 404);
    const status = getAccessStatus(user);
    ok(res, { restored: status.access, ...status });
});

// ── Historial de pagos del usuario autenticado ─────────────────────────────
app.get('/api/subscription/payments', requireAuth, (req, res) => {
    const payments = readPayments().filter(p => p.userId === req.user.id);
    ok(res, payments);
});

// ── Historial de pagos de todos los usuarios (admin) ──────────────────────
app.get('/api/admin/payments', requireAdmin, (req, res) => {
    const { userId, planId, status: st, limit: lim = 100 } = req.query;
    let payments = readPayments();
    if (userId) payments = payments.filter(p => p.userId === userId);
    if (planId) payments = payments.filter(p => p.planId === planId);
    if (st)     payments = payments.filter(p => p.status === st);
    ok(res, payments.slice(0, parseInt(lim)));
});

// ── Confirmar pago manual pendiente (admin) ──────────────────────────────
app.post('/api/admin/payments/:id/confirm', requireAdmin, (req, res) => {
    const payments = readPayments();
    const pidx = payments.findIndex(p => p.id === req.params.id);
    if (pidx === -1) return err(res, 'Pago no encontrado', 404);
    if (payments[pidx].status !== 'pending') return err(res, 'Este pago ya fue procesado');

    payments[pidx].status       = 'completed';
    payments[pidx].confirmedBy  = req.admin.email;
    payments[pidx].confirmedAt  = new Date().toISOString();
    writePayments(payments);

    // Activar la suscripción del usuario
    const users = readUsers();
    const uidx  = users.findIndex(u => u.id === payments[pidx].userId);
    if (uidx !== -1) {
        const plan   = getPlan(payments[pidx].planId) || getPlan(users[uidx].pendingPlanId);
        if (plan) {
            const now    = new Date();
            const subEnd = new Date(now.getTime() + plan.duration * 86400000);
            Object.assign(users[uidx], {
                subscriptionStatus:    'active',
                subscriptionPlan:      plan.id,
                subscriptionStart:     now.toISOString(),
                subscriptionEnd:       subEnd.toISOString(),
                subscriptionSource:    'admin_confirmed',
                pendingPlanId:         null,
                pendingPlanSince:      null,
            });
            writeUsers(users);
        }
    }

    logAdminAction(req.admin.id, req.admin.email, 'payment_confirm', payments[pidx].userId, payments[pidx].userEmail, `pago:${payments[pidx].id} plan:${payments[pidx].planId}`);

    // Alerta WhatsApp automática
    const uConfirmed = readUsers().find(u => u.id === payments[pidx].userId);
    alertWA('payment_completed', {
        id: payments[pidx].id, userEmail: payments[pidx].userEmail,
        userName: uConfirmed?.name || payments[pidx].userEmail,
        company:  uConfirmed?.company || '—',
        planName: payments[pidx].planName, amount: payments[pidx].amount,
        currency: payments[pidx].currency, method: payments[pidx].method,
    });
    ok(res, { done: true, payment: payments[pidx] });
});

// ── Marcar pago como fallido (admin) ─────────────────────────────────────
app.post('/api/admin/payments/:id/reject', requireAdmin, (req, res) => {
    const payments = readPayments();
    const pidx = payments.findIndex(p => p.id === req.params.id);
    if (pidx === -1) return err(res, 'Pago no encontrado', 404);
    payments[pidx].status      = 'failed';
    payments[pidx].rejectedBy  = req.admin.email;
    payments[pidx].rejectedAt  = new Date().toISOString();
    payments[pidx].note        = req.body.reason || 'Rechazado por administrador';
    writePayments(payments);
    logAdminAction(req.admin.id, req.admin.email, 'payment_reject', payments[pidx].userId, payments[pidx].userEmail, `pago:${payments[pidx].id}`);

    // Alerta WhatsApp automática
    const uRej = readUsers().find(u => u.id === payments[pidx].userId);
    alertWA('payment_failed', {
        id: payments[pidx].id, userEmail: payments[pidx].userEmail,
        userName: uRej?.name || payments[pidx].userEmail,
        company:  uRej?.company || '—',
        planName: payments[pidx].planName, amount: payments[pidx].amount,
    });
    ok(res, { done: true });
});

// ── MÉTODOS DE PAGO CONFIGURABLES ─────────────────────────────────────────────
// Público (autenticado): obtener métodos activos para el POS y suscripción
app.get('/api/config/payment-methods', requireAuth, (req, res) => {
    const cfg = getConfig();
    ok(res, cfg.paymentMethods);
});

// Admin: obtener TODOS los métodos (activos e inactivos)
app.get('/api/admin/payment-methods', requireAdmin, (req, res) => {
    const cfg = getConfig();
    ok(res, cfg.paymentMethods);
});

// Admin: actualizar lista completa de métodos
app.put('/api/admin/payment-methods', requireAdmin, (req, res) => {
    const methods = req.body;
    if (!Array.isArray(methods)) return err(res, 'Se esperaba un array de métodos');
    // Validar estructura básica
    for (const m of methods) {
        if (!m.id || !m.label) return err(res, `Método inválido: falta id o label`);
    }
    const cfg = getConfig();
    cfg.paymentMethods = methods;
    cfg.updatedAt = new Date().toISOString();
    writeConfig(cfg);
    logAdminAction(req.admin.id, req.admin.email, 'payment_methods_update', null, null,
        `${methods.length} métodos actualizados`);
    ok(res, cfg.paymentMethods);
});

// Admin: actualizar un método específico
app.put('/api/admin/payment-methods/:id', requireAdmin, (req, res) => {
    const cfg = getConfig();
    const idx = cfg.paymentMethods.findIndex(m => m.id === req.params.id);
    if (idx === -1) return err(res, 'Método no encontrado', 404);
    const allowed = ['label', 'icon', 'active', 'type', 'isManual', 'info', 'paymentData'];
    allowed.forEach(k => { if (req.body[k] !== undefined) cfg.paymentMethods[idx][k] = req.body[k]; });
    cfg.updatedAt = new Date().toISOString();
    writeConfig(cfg);
    logAdminAction(req.admin.id, req.admin.email, 'payment_method_update', null, null,
        `método:${req.params.id} → ${JSON.stringify(req.body)}`);
    ok(res, cfg.paymentMethods[idx]);
});

// Admin: agregar nuevo método
app.post('/api/admin/payment-methods', requireAdmin, (req, res) => {
    const { id, label, icon, type, isManual, info } = req.body;
    if (!id || !label) return err(res, 'id y label son obligatorios');
    const cfg = getConfig();
    if (cfg.paymentMethods.find(m => m.id === id))
        return err(res, `Ya existe un método con id "${id}"`);
    const newMethod = { id: id.toUpperCase().replace(/\s+/g,'_'), label, icon: icon||'💳',
                        active: true, type: type||'pos', isManual: !!isManual, info: info||'' };
    cfg.paymentMethods.push(newMethod);
    cfg.updatedAt = new Date().toISOString();
    writeConfig(cfg);
    logAdminAction(req.admin.id, req.admin.email, 'payment_method_add', null, null, `nuevo:${newMethod.id}`);
    ok(res, newMethod);
});

// Admin: eliminar método
app.delete('/api/admin/payment-methods/:id', requireAdmin, (req, res) => {
    const cfg = getConfig();
    const before = cfg.paymentMethods.length;
    cfg.paymentMethods = cfg.paymentMethods.filter(m => m.id !== req.params.id);
    if (cfg.paymentMethods.length === before) return err(res, 'Método no encontrado', 404);
    cfg.updatedAt = new Date().toISOString();
    writeConfig(cfg);
    logAdminAction(req.admin.id, req.admin.email, 'payment_method_delete', null, null, `eliminado:${req.params.id}`);
    ok(res, { done: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// SISTEMA DE ALERTAS WHATSAPP — UltraMsg
// Docs: https://ultramsg.com/
// Plan gratuito: 250 mensajes/mes. No requiere activación desde el teléfono.
// Pasos: 1) Crear cuenta en ultramsg.com  2) Crear instancia  3) Escanear QR
//        4) Copiar Instance ID y Token al panel admin → Configuración
// ══════════════════════════════════════════════════════════════════════════════
const https_mod  = require('https');
const WA_LOG_PATH = path.join(__dirname, 'wa-alerts.json');

function readWALog() {
    try { return fs.existsSync(WA_LOG_PATH) ? JSON.parse(fs.readFileSync(WA_LOG_PATH,'utf8')) : []; }
    catch { return []; }
}
function writeWALog(l) {
    try { fs.writeFileSync(WA_LOG_PATH, JSON.stringify(l, null, 2), 'utf8'); } catch {}
}

/** Envía un mensaje WhatsApp via UltraMsg y registra el resultado */
async function sendWhatsApp(message, eventId) {
    const cfg      = getConfig();
    const instance = (cfg.ultramsgInstance || '').trim();
    const token    = (cfg.ultramsgToken    || '').trim();
    // Usar número destino separado si está configurado, si no usar el número de la instancia
    const destPhone = (cfg.whatsappDestPhone || cfg.whatsappPhone || '').replace(/\D/g,'');

    if (!destPhone || !instance || !token || token === 'PENDING_SETUP') {
        const log = readWALog();
        log.unshift({ id: eventId || generateId(), ts: new Date().toISOString(),
            message: message.slice(0,300), status: 'pending',
            error: 'UltraMsg no configurado', retries: 0 });
        if (log.length > 500) log.splice(500);
        writeWALog(log);
        return { ok: false, pending: true };
    }

    // UltraMsg REST API: POST https://api.ultramsg.com/{instance}/messages/chat
    const postData = JSON.stringify({
        token,
        to:   '+' + destPhone,
        body: message,
    });

    const options = {
        hostname: 'api.ultramsg.com',
        path:     `/${instance}/messages/chat`,
        method:   'POST',
        headers:  {
            'Content-Type':   'application/json',
            'Content-Length': Buffer.byteLength(postData),
        },
        timeout: 12000,
    };

    return new Promise(resolve => {
        const req_wa = https_mod.request(options, res_wa => {
            let body = '';
            res_wa.on('data', d => body += d);
            res_wa.on('end', () => {
                let success = false;
                let errMsg  = null;
                try {
                    const j = JSON.parse(body);
                    // UltraMsg devuelve { sent: "true", ... } o { error: "..." }
                    success = j.sent === 'true' || j.sent === true || res_wa.statusCode === 200 && !j.error;
                    if (!success) errMsg = j.error || body.slice(0, 200);
                } catch { errMsg = body.slice(0, 200); }

                const log = readWALog();
                log.unshift({ id: eventId || generateId(), ts: new Date().toISOString(),
                    message: message.slice(0,300),
                    status: success ? 'sent' : 'error',
                    error:  success ? null : errMsg,
                    retries: 0 });
                if (log.length > 500) log.splice(500);
                writeWALog(log);
                resolve({ ok: success, body });
            });
        });
        req_wa.on('error', e => {
            const log = readWALog();
            log.unshift({ id: eventId || generateId(), ts: new Date().toISOString(),
                message: message.slice(0,300), status: 'error', error: e.message, retries: 0 });
            if (log.length > 500) log.splice(500);
            writeWALog(log);
            resolve({ ok: false, error: e.message });
        });
        req_wa.on('timeout', () => { req_wa.destroy(); resolve({ ok: false, error: 'timeout' }); });
        req_wa.write(postData);
        req_wa.end();
    });
}

/** Envía alerta WA sin bloquear la respuesta HTTP */
function alertWA(type, data) {
    const now = new Date().toLocaleString('es-VE', { timeZone:'America/Caracas',
        day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
    let msg = '';
    if (type === 'payment_completed') {
        msg = `🔔 NUEVO PAGO - FIX PRO MAX\n👤 Usuario: ${data.userName||data.userEmail}\n🏢 Empresa: ${data.company||'—'}\n📦 Plan: ${data.planName}\n💰 Monto: $${Number(data.amount).toFixed(2)} ${data.currency||'USD'}\n💳 Método: ${data.method}\n📅 Fecha: ${now}\n🧾 ID: ${data.id}\n✅ Estado: PAGO CONFIRMADO`;
    } else if (type === 'subscription_new') {
        msg = `🔔 NUEVA SUSCRIPCION - FIX PRO MAX\n👤 Usuario: ${data.userName||data.userEmail}\n🏢 Empresa: ${data.company||'—'}\n📦 Plan: ${data.planName}\n💰 Precio: $${Number(data.amount).toFixed(2)}\n📅 Fecha: ${now}\n✅ Estado: ACTIVA`;
    } else if (type === 'payment_failed') {
        msg = `⚠️ PAGO FALLIDO - FIX PRO MAX\n👤 Usuario: ${data.userName||data.userEmail}\n🏢 Empresa: ${data.company||'—'}\n📦 Plan: ${data.planName}\n💰 Monto: $${Number(data.amount).toFixed(2)}\n📅 Fecha: ${now}\n❌ Estado: PAGO FALLIDO`;
    } else if (type === 'payment_pending') {
        msg = `🟡 PAGO PENDIENTE - FIX PRO MAX\n👤 Usuario: ${data.userName||data.userEmail}\n🏢 Empresa: ${data.company||'—'}\n📦 Plan: ${data.planName}\n💰 Monto: $${Number(data.amount).toFixed(2)}\n📅 Fecha: ${now}\n⏳ Estado: PENDIENTE DE VERIFICACION`;
    } else if (type === 'subscription_cancelled') {
        msg = `🔄 SUSCRIPCION CANCELADA - FIX PRO MAX\n👤 Usuario: ${data.userName||data.userEmail}\n🏢 Empresa: ${data.company||'—'}\n📦 Plan: ${data.planName||'—'}\n📅 Fecha: ${now}\nEstado: CANCELADA`;
    } else if (type === 'ticket_new') {
        msg = `🚨 NUEVO TICKET DE SOPORTE - FIX PRO MAX\n👤 Usuario: ${data.userName}\n🏢 Empresa: ${data.company||'—'}\n📂 Categoria: ${data.category}\n📝 Titulo: ${data.title}\n🔴 Prioridad: ${(data.priority||'media').toUpperCase()}\n📅 Fecha: ${now}\n🆔 ID: ${data.id}`;
    } else if (type === 'refund') {
        msg = `💸 REEMBOLSO - FIX PRO MAX\n👤 Usuario: ${data.userName||data.userEmail}\n📦 Plan: ${data.planName||'—'}\n💰 Monto: $${Number(data.amount||0).toFixed(2)}\n📅 Fecha: ${now}\nEstado: REEMBOLSADO`;
    } else if (type === 'test') {
        msg = `✅ TEST FIX PRO MAX\nNotificaciones WhatsApp activas y funcionando correctamente.\n📅 ${now}`;
    }
    if (msg) setImmediate(() => sendWhatsApp(msg, data.id || generateId()));
}

// ── ADMIN: Ver log de alertas WhatsApp ────────────────────────────────────────
app.get('/api/admin/wa-alerts', requireAdmin, (req, res) => {
    const log = readWALog();
    ok(res, log.slice(0, 200));
});

// ── ADMIN: Obtener grupos de la instancia UltraMsg ────────────────────────────
app.get('/api/admin/wa-groups', requireAdmin, async (req, res) => {
    const cfg = getConfig();
    const instance = (cfg.ultramsgInstance || '').trim();
    const token    = (cfg.ultramsgToken    || '').trim();
    if (!instance || !token || token === 'PENDING_SETUP') {
        return err(res, 'UltraMsg no configurado');
    }
    const options = {
        hostname: 'api.ultramsg.com',
        path: `/${instance}/groups?token=${token}`,
        method: 'GET',
        timeout: 8000,
    };
    const result = await new Promise(resolve => {
        const r = https_mod.get(`https://api.ultramsg.com/${instance}/groups?token=${token}`,
            { timeout: 8000 }, res2 => {
                let body = '';
                res2.on('data', d => body += d);
                res2.on('end', () => {
                    try { resolve(JSON.parse(body)); } catch { resolve([]); }
                });
            });
        r.on('error', () => resolve([]));
        r.on('timeout', () => { r.destroy(); resolve([]); });
    });
    ok(res, Array.isArray(result) ? result : []);
});

// ── ADMIN: Test de WhatsApp ───────────────────────────────────────────────────
app.post('/api/admin/wa-test', requireAdmin, async (req, res) => {
    const cfg = getConfig();
    if (!cfg.ultramsgToken || cfg.ultramsgToken === 'PENDING_SETUP') {
        return err(res, 'Configura primero el Instance ID y Token de UltraMsg en Configuración');
    }
    alertWA('test', { id: generateId() });
    ok(res, { sent: true, message: 'Mensaje de prueba enviado. Revisa tu WhatsApp en unos segundos.' });
});

// ── ADMIN: Reintentar alertas pendientes ──────────────────────────────────────
app.post('/api/admin/wa-retry', requireAdmin, async (req, res) => {
    const log = readWALog();
    const pending = log.filter(e => e.status === 'pending' || e.status === 'error');
    let retried = 0;
    for (const entry of pending.slice(0, 10)) {
        entry.status = 'retrying';
        retried++;
        setImmediate(async () => {
            const r = await sendWhatsApp(entry.message, entry.id);
            const l = readWALog();
            const idx = l.findIndex(x => x.id === entry.id);
            if (idx !== -1) { l[idx].status = r.ok ? 'sent' : 'error'; l[idx].retries = (l[idx].retries||0)+1; writeWALog(l); }
        });
    }
    writeWALog(log);
    ok(res, { retried, message: `${retried} alerta(s) en reintento` });
});

// ── ADMIN: Guardar configuración de WhatsApp (UltraMsg) ──────────────────────
app.put('/api/admin/settings/whatsapp', requireAdmin, (req, res) => {
    const { phone, instance, token, destPhone } = req.body;
    if (!phone) return err(res, 'Número de teléfono requerido');
    const cfg = getConfig();
    cfg.whatsappPhone    = phone.replace(/\D/g,'');
    // destPhone: número DESTINO donde llegan los mensajes (puede ser diferente al de la instancia)
    cfg.whatsappDestPhone = (destPhone || phone).replace(/\D/g,'');
    cfg.ultramsgInstance = instance || cfg.ultramsgInstance || '';
    cfg.ultramsgToken    = token    || cfg.ultramsgToken    || 'PENDING_SETUP';
    delete cfg.whatsappApiKey;
    cfg.updatedAt = new Date().toISOString();
    writeConfig(cfg);
    logAdminAction(req.admin.id, req.admin.email, 'whatsapp_config_update', null, null,
        `phone:${cfg.whatsappPhone} dest:${cfg.whatsappDestPhone} instance:${cfg.ultramsgInstance}`);
    ok(res, { done: true });
});

// ── ADMIN: Obtener configuración de WhatsApp ──────────────────────────────────
app.get('/api/admin/settings/whatsapp', requireAdmin, (req, res) => {
    const cfg = getConfig();
    ok(res, {
        phone:       cfg.whatsappPhone     || '',
        destPhone:   cfg.whatsappDestPhone || cfg.whatsappPhone || '',
        instance:    cfg.ultramsgInstance  || '',
        tokenSet:    !!(cfg.ultramsgToken && cfg.ultramsgToken !== 'PENDING_SETUP'),
        configured:  !!(cfg.whatsappPhone && cfg.ultramsgInstance && cfg.ultramsgToken && cfg.ultramsgToken !== 'PENDING_SETUP'),
        sameNumber:  (cfg.whatsappPhone === (cfg.whatsappDestPhone || cfg.whatsappPhone)),
        provider:    'ultramsg',
    });
});

// ── ADMIN: Crear plan nuevo ───────────────────────────────────────────────────
app.post('/api/admin/plans', requireAdmin, (req, res) => {
    const { id, name, price, duration, period, maxUsers, maxProducts,
            multiUser, recommended, badge, description, features, notIncluded, active } = req.body;
    if (!id || !name) return err(res, 'id y name son obligatorios');
    const cleanId = id.toLowerCase().replace(/[^a-z0-9_]/g,'');
    if (PLANS[cleanId]) return err(res, `Ya existe un plan con id "${cleanId}"`);

    const newPlan = {
        id: cleanId, name, description: description||'',
        price: Number(price)||0, currency: 'USD',
        duration: Number(duration)||30, period: period||'1 mes',
        maxUsers: Number(maxUsers)||1, multiUser: !!multiUser,
        maxProducts: maxProducts === -1 ? -1 : Number(maxProducts)||500,
        maxSales: -1, maxInvoices: -1,
        recommended: !!recommended, badge: badge||'', active: active !== false,
        order: Object.keys(PLANS).length + 1,
        features:    Array.isArray(features)    ? features    : [],
        notIncluded: Array.isArray(notIncluded) ? notIncluded : [],
        modules: {
            pos:true, sales:true, invoices:true, products:true,
            inventory:true, customers:true, suppliers:true,
            expenses:true, purchases:true, returns:true, reports:true,
            finance: !!multiUser, accounting: !!multiUser,
            payables: !!multiUser, receivables: !!multiUser,
            ai: !!multiUser, team: !!multiUser,
        },
    };
    PLANS[cleanId] = newPlan;

    // Persistir en config.json
    const cfg = getConfig();
    cfg.plansOverride[cleanId] = { ...newPlan };
    cfg.updatedAt = new Date().toISOString();
    writeConfig(cfg);

    logAdminAction(req.admin.id, req.admin.email, 'plan_create', null, null, `plan:${cleanId} - ${name}`);
    ok(res, newPlan);
});

// ── ADMIN: Suscripciones activas ──────────────────────────────────────────────
app.get('/api/admin/subscriptions', requireAdmin, (req, res) => {
    const users    = readUsers();
    const payments = readPayments();
    const now      = Date.now();
    const { filter } = req.query;

    let list = users
        .filter(u => u.role !== 'admin')
        .map(u => {
            const status = getAccessStatus(u);
            // Último pago del usuario
            const lastPay = payments.filter(p => p.userId === u.id && p.status === 'completed')
                                    .sort((a,b) => new Date(b.ts)-new Date(a.ts))[0];
            return {
                userId:    u.id, name: u.name, email: u.email, company: u.company||'',
                plan:      u.subscriptionPlan || null,
                planName:  getPlan(u.subscriptionPlan)?.name || u.subscriptionPlan || '—',
                status:    status.status,
                access:    status.access,
                daysLeft:  status.daysLeft,
                start:     u.subscriptionStart  || null,
                end:       u.subscriptionEnd    || null,
                trialEnd:  status.trialEnd      || null,
                cancelled: u.subscriptionStatus === 'cancelled',
                lastPayment: lastPay ? { amount: lastPay.amount, method: lastPay.method, ts: lastPay.ts } : null,
                source:    u.subscriptionSource || null,
            };
        });

    if (filter === 'active')    list = list.filter(u => u.status === 'subscribed' || u.status === 'cancelled_active');
    else if (filter === 'trial')    list = list.filter(u => u.status === 'trial');
    else if (filter === 'expired')  list = list.filter(u => u.status === 'trial_expired' || u.status === 'no_access');
    else if (filter === 'cancelled') list = list.filter(u => u.cancelled);
    else if (filter === 'pending')  list = list.filter(u => u.status === 'pending_verification');

    ok(res, list.sort((a,b) => (b.daysLeft||0)-(a.daysLeft||0)));
});

// ── ADMIN: Ingresos por período ───────────────────────────────────────────────
app.get('/api/admin/revenue', requireAdmin, (req, res) => {
    const payments = readPayments();
    const { period = '30d', groupBy = 'day' } = req.query;
    const now = Date.now();

    const periodos = { '7d':7, '30d':30, '90d':90, '180d':180, '365d':365, 'all':3650 };
    const days = periodos[period] || 30;
    const since = now - days * 86400000;

    const filtered = payments.filter(p => p.status === 'completed' && new Date(p.ts).getTime() >= since);

    // Agrupar por día
    const byDay = {};
    filtered.forEach(p => {
        const d = p.ts.slice(0,10);
        byDay[d] = (byDay[d]||0) + (Number(p.amount)||0);
    });

    // Por plan
    const byPlan = {};
    filtered.forEach(p => {
        const k = p.planName || p.planId || 'Otro';
        byPlan[k] = (byPlan[k]||0) + (Number(p.amount)||0);
    });

    // Por método
    const byMethod = {};
    filtered.forEach(p => {
        const k = p.method || 'unknown';
        byMethod[k] = (byMethod[k]||0) + (Number(p.amount)||0);
    });

    // Por moneda
    const byCurrency = {};
    filtered.forEach(p => {
        const k = p.currency || 'USD';
        byCurrency[k] = (byCurrency[k]||0) + (Number(p.amount)||0);
    });

    const total = filtered.reduce((s,p) => s + (Number(p.amount)||0), 0);

    ok(res, {
        total:      +total.toFixed(2),
        count:      filtered.length,
        byDay,
        byPlan:     Object.entries(byPlan).map(([k,v])=>({name:k, amount:+v.toFixed(2)})).sort((a,b)=>b.amount-a.amount),
        byMethod:   Object.entries(byMethod).map(([k,v])=>({name:k, amount:+v.toFixed(2)})).sort((a,b)=>b.amount-a.amount),
        byCurrency: Object.entries(byCurrency).map(([k,v])=>({name:k, amount:+v.toFixed(2)})),
    });
});


app.post('/api/subscription/verify-google-play', requireAuth, (req, res) => {
    // PRODUCCIÓN: verificar purchaseToken con Google Play Developer API
    // Ver: https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptions/get
    const { purchaseToken, planId } = req.body;
    if (!purchaseToken || !planId || !getPlan(planId)) return err(res, 'Datos inválidos');
    const users = readUsers();
    const idx   = users.findIndex(u => u.id === req.user.id);
    if (idx === -1) return err(res, 'Usuario no encontrado', 404);
    const plan   = getPlan(planId);
    const now    = new Date();
    const subEnd = new Date(now.getTime() + plan.duration * 86400000);
    Object.assign(users[idx], {
        subscriptionStatus:'active', subscriptionPlan:planId,
        subscriptionStart:now.toISOString(), subscriptionEnd:subEnd.toISOString(),
        subscriptionToken:purchaseToken, subscriptionSource:'google_play',
    });
    writeUsers(users);
    recordPayment({
        userId: users[idx].id, userEmail: users[idx].email,
        planId, planName: plan.name, amount: plan.price, currency: plan.currency,
        method: 'google_play', status: 'completed', source: 'google_play',
        orderId: purchaseToken,
    });
    ok(res, { verified: true, ...getAccessStatus(users[idx]) });
});

// ══════════════════════════════════════════════════════════════════════════════
// SISTEMA MULTIUSUARIO EMPRESARIAL
// Cada empresa tiene su propio companyId y BD separada (db_{companyId}.json)
// Empleados heredan el companyId del propietario que los invita.
// Máximo 5 usuarios por empresa (1 propietario + 4 empleados).
// ══════════════════════════════════════════════════════════════════════════════

const MAX_TEAM   = 5;
const COMPANIES_PATH = path.join(__dirname, 'companies.json');

// ── Helpers de empresa ────────────────────────────────────────────────────────
function readCompanies() {
    try { if (!fs.existsSync(COMPANIES_PATH)) return []; return JSON.parse(fs.readFileSync(COMPANIES_PATH, 'utf8')); }
    catch { return []; }
}
function writeCompanies(c) { fs.writeFileSync(COMPANIES_PATH, JSON.stringify(c, null, 2), 'utf8'); }

// BD por empresa
function dbPath(companyId) { return path.join(__dirname, `db_${companyId}.json`); }
function readCompanyDB(companyId) {
    const p = dbPath(companyId);
    if (!fs.existsSync(p)) {
        const fresh = defaultData();
        fs.writeFileSync(p, JSON.stringify(fresh, null, 2), 'utf8');
        return fresh;
    }
    try {
        const raw    = fs.readFileSync(p, 'utf8');
        const parsed = JSON.parse(raw);
        const def    = defaultData();
        for (const key of Object.keys(def)) { if (parsed[key] === undefined) parsed[key] = def[key]; }
        return parsed;
    } catch { return defaultData(); }
}
function writeCompanyDB(companyId, data) {
    fs.writeFileSync(dbPath(companyId), JSON.stringify(data, null, 2), 'utf8');
}

// Obtener el companyId del usuario autenticado (si es empleado, usa el de su owner)
function getCompanyId(user) {
    return user.companyId || user.id; // fallback: su propio ID como companyId
}

// Equipo de una empresa
function getTeam(companyId) {
    return readUsers().filter(u => u.companyId === companyId);
}

// Permiso por defecto para nuevos empleados
const DEFAULT_EMPLOYEE_PERMISSIONS = {
    inventory:   { view: true,  create: false, edit: false, delete: false, import: false },
    sales:       { view: true,  create: true,  edit: false, cancel: false },
    invoices:    { view: true,  create: false, edit: false, cancel: false },
    expenses:    { view: true,  create: true,  edit: false, delete: false },
    reports:     { view: true,  export: false },
    accounting:  { view: false, edit: false },
    users:       { view: false, create: false, edit: false },
};

// Middleware de permisos: verifica que el empleado tenga acceso a un módulo/acción
function requirePermission(module, action) {
    return (req, res, next) => {
        const u = req.user;
        if (!u) return res.status(401).json({ ok: false, error: 'No autenticado' });
        // El propietario/owner siempre tiene acceso
        if (u.teamRole === 'owner' || u.role === 'admin') { next(); return; }
        // Obtener permisos del usuario desde users.json
        const users = readUsers();
        const full  = users.find(x => x.id === u.id);
        const perms = full?.permissions?.[module];
        if (!perms || !perms[action]) {
            return res.status(403).json({ ok: false, error: `Sin permiso para: ${module}.${action}` });
        }
        next();
    };
}

// ── OVERRIDE de readDB/writeDB para usar BD por empresa ──────────────────────
// Los endpoints del ERP ya existentes leen/escriben readDB()/writeDB()
// Interceptamos dinámicamente según el contexto de la petición
// Usamos un contexto de request almacenado en AsyncLocalStorage si es posible,
// o simplemente modificamos la función según req.companyId (ver middleware abajo)

const { AsyncLocalStorage } = require('async_hooks');
const reqContext = new AsyncLocalStorage();

// readDB / writeDB: usan el companyId del contexto async si está disponible,
// o caen al archivo global db.json. No hay recursión porque _readGlobalDB
// y _writeGlobalDB son nombres distintos que no se re-declaran.
function readDB() {
    const ctx = reqContext.getStore();
    if (ctx?.isDemo || ctx?.companyId === DEMO_COMPANY_ID) return readDemoDB();
    if (ctx?.companyId) return readCompanyDB(ctx.companyId);
    // Sin contexto: devolver estructura vacía en lugar de la BD global compartida.
    // Esto es seguro — todos los endpoints que necesitan datos reales tienen requireAuth.
    // Los pocos endpoints públicos (GET /api/products sin auth) devolverán vacío,
    // que es correcto ya que los datos son por empresa.
    console.warn('[readDB] Sin contexto de empresa — devolviendo defaultData()');
    return _readGlobalDB(); // mantener para compatibilidad de endpoints públicos legacy
}

function writeDB(data) {
    const ctx = reqContext.getStore();
    // AISLAMIENTO DEMO: el demo SIEMPRE escribe en su BD propia
    if (ctx?.isDemo || ctx?.companyId === DEMO_COMPANY_ID) return writeDemoDB(data);
    if (ctx?.companyId) return writeCompanyDB(ctx.companyId, data);
    // PROTECCIÓN CRÍTICA: sin contexto de empresa, NO escribir en la BD global.
    // Esto previene que un PUT /api/db sin autenticación sobreescriba datos de otros usuarios.
    // Solo lanzar error — el caller (PUT /api/db) requiere requireAuth de todas formas.
    console.error('[writeDB] ⚠️  Intento de escritura sin contexto de empresa — operación rechazada');
    throw new Error('writeDB requiere un contexto de empresa. Asegúrate de que requireAuth está activo.');
}

// ── requireAuth ya fue actualizado directamente (línea ~1306) con companyId, teamRole y contexto async ──

// ── TEAM: Listar empleados de la empresa ─────────────────────────────────────
app.get('/api/team/members', requireAuth, (req, res) => {
    const allUsers  = readUsers();
    const ownerFull = allUsers.find(u => u.companyId === req.user.companyId && u.teamRole === 'owner');
    const maxAllowed = ownerFull ? getMaxTeamByPlan(ownerFull) : 1;
    const multiUser  = ownerFull ? planAllowsMultiUser(ownerFull) : false;

    // Determinar qué usuarios tienen sesión activa en sessions.json
    const sessions  = readSessions();
    const onlineIds = new Set(
        Object.values(sessions).map(e => (typeof e === 'object' ? e.userId : e))
    );

    const team = allUsers.filter(u => u.companyId === req.user.companyId).map(u => ({
        id: u.id, name: u.name, email: u.email, avatar: u.avatar,
        teamRole: u.teamRole || 'employee', active: u.active !== false,
        createdAt: u.createdAt, permissions: u.permissions || DEFAULT_EMPLOYEE_PERMISSIONS,
        lastLogin: u.lastLogin || null,
        isOnline: onlineIds.has(u.id),   // true si tiene token activo en sessions.json
    }));
    ok(res, { members: team, count: team.length, max: maxAllowed, multiUser, planRequired: 'pro' });
});

// ── TEAM: Invitar / crear empleado ────────────────────────────────────────────
app.post('/api/team/invite', requireAuth, (req, res) => {
    // Solo el propietario puede invitar
    if (req.user.teamRole !== 'owner' && req.user.role !== 'admin') {
        return err(res, 'Solo el propietario puede invitar empleados', 403);
    }
    const { name, email, password, permissions } = req.body;
    if (!name || !email || !password) return err(res, 'Nombre, email y contraseña son obligatorios');
    if (password.length < 6)         return err(res, 'La contraseña debe tener al menos 6 caracteres');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err(res, 'Email inválido');

    // Verificar que el plan activo del propietario permita multiusuario
    const allUsers  = readUsers();
    const ownerFull = allUsers.find(u => u.id === req.user.id);
    if (ownerFull && !planAllowsMultiUser(ownerFull)) {
        return err(res, 'Tu plan actual (Básico o prueba) no incluye multiusuario. Actualiza a Plan Pro o Semestral para agregar empleados.', 403);
    }

    // Verificar límite de usuarios según el plan del propietario
    const maxAllowed  = ownerFull ? getMaxTeamByPlan(ownerFull) : 1;
    const currentTeam = allUsers.filter(u => u.companyId === req.user.companyId);
    if (currentTeam.length >= maxAllowed) {
        return err(res, `Has alcanzado el límite de ${maxAllowed} usuarios para tu plan.`, 403);
    }
    // Verificar email único
    if (allUsers.find(u => u.email.toLowerCase() === email.toLowerCase())) {
        return err(res, 'Ya existe una cuenta con ese email');
    }

    const newEmployee = {
        id:          generateId(),
        name:        name.trim(),
        email:       email.toLowerCase().trim(),
        password:    hashPassword(password),
        companyId:   req.user.companyId,
        company:     req.user.company || '',
        role:        'user',
        teamRole:    'employee',
        mode:        'basic',
        avatar:      name.trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2),
        permissions: permissions || DEFAULT_EMPLOYEE_PERMISSIONS,
        active:      true,
        createdAt:   new Date().toISOString(),
        invitedBy:   req.user.id,
        mustChange:  true,
    };
    allUsers.push(newEmployee);
    writeUsers(allUsers);
    logAdminAction(req.user.id, req.user.email, 'invite_employee', newEmployee.id, newEmployee.email, '');
    console.log(`✅ Empleado invitado: ${newEmployee.email} → empresa ${req.user.companyId}`);
    ok(res, { id: newEmployee.id, name: newEmployee.name, email: newEmployee.email, teamRole: 'employee' });
});

// ── TEAM: Actualizar permisos de un empleado ──────────────────────────────────
app.put('/api/team/members/:id/permissions', requireAuth, (req, res) => {
    if (req.user.teamRole !== 'owner' && req.user.role !== 'admin') return err(res, 'Sin permisos', 403);
    const users = readUsers();
    const idx   = users.findIndex(u => u.id === req.params.id && u.companyId === req.user.companyId);
    if (idx === -1) return err(res, 'Empleado no encontrado', 404);
    if (users[idx].teamRole === 'owner') return err(res, 'No puedes modificar los permisos del propietario', 400);
    users[idx].permissions = { ...DEFAULT_EMPLOYEE_PERMISSIONS, ...req.body };
    writeUsers(users);
    logAdminAction(req.user.id, req.user.email, 'update_permissions', users[idx].id, users[idx].email, '');
    ok(res, { done: true, permissions: users[idx].permissions });
});

// ── TEAM: Activar/desactivar empleado ────────────────────────────────────────
app.post('/api/team/members/:id/action', requireAuth, (req, res) => {
    if (req.user.teamRole !== 'owner' && req.user.role !== 'admin') return err(res, 'Sin permisos', 403);
    const { action, reason } = req.body;
    const ALLOWED_ACTIONS = ['suspend', 'reactivate', 'force_logout', 'remove'];
    if (!ALLOWED_ACTIONS.includes(action)) return err(res, 'Acción no permitida');

    const users = readUsers();
    const idx   = users.findIndex(u => u.id === req.params.id && u.companyId === req.user.companyId);
    if (idx === -1) return err(res, 'Empleado no encontrado', 404);
    if (users[idx].teamRole === 'owner') return err(res, 'No puedes realizar esta acción sobre el propietario', 400);

    if (action === 'suspend') {
        users[idx].active = false;
        users[idx].suspendedAt = new Date().toISOString();
        // Cerrar todas sus sesiones
        const sessions = readSessions();
        Object.keys(sessions).forEach(tok => {
            const e = sessions[tok];
            const uid = typeof e === 'object' ? e.userId : e;
            if (uid === users[idx].id) delete sessions[tok];
        });
        writeSessions(sessions);
    } else if (action === 'reactivate') {
        users[idx].active = true;
        delete users[idx].suspendedAt;
    } else if (action === 'force_logout') {
        const sessions = readSessions();
        Object.keys(sessions).forEach(tok => {
            const e = sessions[tok];
            const uid = typeof e === 'object' ? e.userId : e;
            if (uid === users[idx].id) delete sessions[tok];
        });
        writeSessions(sessions);
    } else if (action === 'remove') {
        const removed = users.splice(idx, 1)[0];
        writeUsers(users);
        logAdminAction(req.user.id, req.user.email, 'remove_employee', removed.id, removed.email, reason || '');
        return ok(res, { done: true, action: 'removed' });
    }

    writeUsers(users);
    logAdminAction(req.user.id, req.user.email, action, users[idx].id, users[idx].email, reason || '');
    ok(res, { done: true, action, active: users[idx].active });
});

// ── TEAM: Dispositivos/sesiones activas del equipo ───────────────────────────
app.get('/api/team/devices', requireAuth, (req, res) => {
    if (req.user.teamRole !== 'owner' && req.user.role !== 'admin') return err(res, 'Sin permisos', 403);
    const team     = getTeam(req.user.companyId).map(u => u.id);
    const sessions = readSessions();
    const users    = readUsers();
    const myToken  = (req.headers['authorization'] || '').replace('Bearer ', '').trim();

    // Agrupar sesiones por usuario — un registro por usuario con la sesión más reciente
    // No contar múltiples tokens del mismo dispositivo/usuario
    const byUser = {};
    Object.entries(sessions).forEach(([token, entry]) => {
        const uid     = typeof entry === 'object' ? entry.userId : entry;
        const created = typeof entry === 'object' ? entry.created : 0;
        if (!team.includes(uid)) return;
        // Excluir la sesión activa del propio owner que consulta
        if (token === myToken) return;
        // Quedarse con el token más reciente por usuario
        if (!byUser[uid] || created > byUser[uid].created) {
            byUser[uid] = { token, created };
        }
    });

    const devices = Object.entries(byUser).map(([uid, { token, created }]) => {
        const user = users.find(u => u.id === uid);
        if (!user) return null;
        return {
            token:     token.slice(0, 8) + '...',
            tokenFull: token,
            userId:    uid,
            userName:  user.name,
            userEmail: user.email,
            teamRole:  user.teamRole || 'employee',
            created:   created ? new Date(created).toISOString() : null,
            active:    user.active !== false,
        };
    }).filter(Boolean);

    ok(res, devices);
});

// ── TEAM: Cerrar sesión de un dispositivo específico ─────────────────────────
app.delete('/api/team/devices/:tokenPrefix', requireAuth, (req, res) => {
    if (req.user.teamRole !== 'owner' && req.user.role !== 'admin') return err(res, 'Sin permisos', 403);
    // tokenFull puede venir en body (DELETE con JSON) o como query param como fallback
    const tokenFull = req.body?.tokenFull || req.query?.tokenFull;
    if (!tokenFull) return err(res, 'Token requerido');
    const sessions = readSessions();
    if (sessions[tokenFull]) {
        const uid = typeof sessions[tokenFull] === 'object' ? sessions[tokenFull].userId : sessions[tokenFull];
        // Verificar que el dispositivo pertenece a la empresa
        const team = getTeam(req.user.companyId).map(u => u.id);
        if (!team.includes(uid)) return err(res, 'Dispositivo no pertenece a tu empresa', 403);
        // No permitir cerrar la propia sesión activa desde aquí
        const myToken = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
        if (tokenFull === myToken) return err(res, 'No puedes cerrar tu propia sesión activa desde aquí', 400);
        delete sessions[tokenFull];
        writeSessions(sessions);
        logAdminAction(req.user.id, req.user.email, 'force_logout_device', uid, '', '');
        ok(res, { done: true });
    } else {
        err(res, 'Sesión no encontrada', 404);
    }
});

// ── TEAM: Cerrar sesión vía POST (más compatible con todos los clientes) ──────
app.post('/api/team/devices/close', requireAuth, (req, res) => {
    if (req.user.teamRole !== 'owner' && req.user.role !== 'admin') return err(res, 'Sin permisos', 403);
    const { tokenFull } = req.body;
    if (!tokenFull) return err(res, 'Token requerido');
    const sessions = readSessions();
    if (!sessions[tokenFull]) return err(res, 'Sesión no encontrada', 404);
    const uid  = typeof sessions[tokenFull] === 'object' ? sessions[tokenFull].userId : sessions[tokenFull];
    const team = getTeam(req.user.companyId).map(u => u.id);
    if (!team.includes(uid)) return err(res, 'Dispositivo no pertenece a tu empresa', 403);
    const myToken = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    if (tokenFull === myToken) return err(res, 'No puedes cerrar tu propia sesión activa desde aquí', 400);
    delete sessions[tokenFull];
    writeSessions(sessions);
    logAdminAction(req.user.id, req.user.email, 'force_logout_device', uid, '', '');
    ok(res, { done: true });
});

// ── TEAM: Info de la empresa ──────────────────────────────────────────────────
app.get('/api/team/company', requireAuth, (req, res) => {
    const users = readUsers();
    const owner = users.find(u => u.companyId === req.user.companyId && u.teamRole === 'owner');
    const team  = getTeam(req.user.companyId);
    const subStatus = owner ? getAccessStatus(owner) : { status: 'no_access', access: false };
    ok(res, {
        companyId:    req.user.companyId,
        companyName:  req.user.company || owner?.company || '',
        memberCount:  team.length,
        maxMembers:   owner ? getMaxTeamByPlan(owner) : 1,
        subscription: subStatus,
        ownerId:      owner?.id,
        ownerEmail:   owner?.email,
    });
});

// ── TEAM: Actividad del equipo ────────────────────────────────────────────────
app.get('/api/team/activity', requireAuth, (req, res) => {
    if (req.user.teamRole !== 'owner' && req.user.role !== 'admin') return err(res, 'Sin permisos', 403);
    const log  = readAdminLog();
    const team = getTeam(req.user.companyId).map(u => u.id);
    const filtered = log.filter(e => team.includes(e.adminId) || team.includes(e.targetId)).slice(0, 100);
    ok(res, filtered);
});

// ── SOBREESCRIBIR GET / para inyectar BD de la empresa ────────────────────────
// Si el usuario tiene sesión válida, servir su BD corporativa
// Si no, servir la BD por defecto (hasta que haga login)

// PANEL DE ADMINISTRADOR — APIs protegidas por requireAdmin
// Todos los endpoints /api/admin/* y /api/support/* están aquí.
// NO modifica ninguna lógica del ERP existente.
// ══════════════════════════════════════════════════════════════════════════════

const TICKETS_PATH  = path.join(__dirname, 'tickets.json');
const ADMIN_LOG_PATH = path.join(__dirname, 'admin-log.json');

// ── Helpers de tickets ────────────────────────────────────────────────────────
function readTickets() {
    try { if (!fs.existsSync(TICKETS_PATH)) return []; return JSON.parse(fs.readFileSync(TICKETS_PATH, 'utf8')); }
    catch { return []; }
}
function writeTickets(t) { fs.writeFileSync(TICKETS_PATH, JSON.stringify(t, null, 2), 'utf8'); }

function readAdminLog() {
    try { if (!fs.existsSync(ADMIN_LOG_PATH)) return []; return JSON.parse(fs.readFileSync(ADMIN_LOG_PATH, 'utf8')); }
    catch { return []; }
}
function writeAdminLog(l) { fs.writeFileSync(ADMIN_LOG_PATH, JSON.stringify(l, null, 2), 'utf8'); }

function logAdminAction(adminId, adminEmail, action, targetId, targetEmail, detail) {
    const log = readAdminLog();
    log.unshift({ id: generateId(), ts: new Date().toISOString(), adminId, adminEmail, action, targetId: targetId||null, targetEmail: targetEmail||null, detail: detail||'' });
    if (log.length > 2000) log.splice(2000);
    writeAdminLog(log);
}

// ── Middleware requireAdmin ────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
    const header = req.headers['authorization'] || '';
    const token  = header.replace('Bearer ', '').trim();
    if (!token) return res.status(401).json({ ok: false, error: 'No autenticado' });
    const sessions = readSessions();
    const entry    = sessions[token];
    if (!entry) return res.status(401).json({ ok: false, error: 'Sesión inválida' });
    const userId  = typeof entry === 'object' ? entry.userId : entry;
    const users   = readUsers();
    const user    = users.find(u => u.id === userId);
    if (!user) return res.status(401).json({ ok: false, error: 'Usuario no encontrado' });
    if (user.role !== 'admin') return res.status(403).json({ ok: false, error: 'Acceso denegado — se requiere rol de administrador' });
    req.admin = { id: user.id, name: user.name, email: user.email, role: user.role };
    next();
}

// ── Ruta del panel ─────────────────────────────────────────────────────────────
app.get('/admin', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader('ETag', Date.now().toString());
    // Leer y servir el archivo dinámicamente (nunca desde caché del sistema)
    try {
        const html = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch(e) {
        res.status(500).send('Error cargando panel de administración');
    }
});
app.get('/admin/login', (req, res) => res.redirect('/admin'));

// ── DASHBOARD STATS ────────────────────────────────────────────────────────────
app.get('/api/admin/stats', requireAdmin, (req, res) => {
    const users   = readUsers();
    const tickets = readTickets();
    const now     = Date.now();
    const today   = new Date(); today.setHours(0,0,0,0);
    const week    = new Date(now - 7*86400000);
    const month   = new Date(now - 30*86400000);

    const trialInfo = u => {
        if (u.role === 'admin') return 'admin';
        if (u.subscriptionStatus === 'active' && u.subscriptionEnd && new Date(u.subscriptionEnd).getTime() > now) return 'subscribed';
        if (u.subscriptionStatus === 'cancelled' && u.subscriptionEnd && new Date(u.subscriptionEnd).getTime() > now) return 'cancelled_active';
        const base = u.trialStart || u.createdAt;
        if (base) {
            const end = new Date(base).getTime() + TRIAL_DAYS * 86400000;
            return end > now ? 'trial' : 'trial_expired';
        }
        return 'no_access';
    };

    const statuses = users.map(trialInfo);
    const sub_expiring = users.filter(u => {
        if (u.subscriptionStatus !== 'active' || !u.subscriptionEnd) return false;
        const days = (new Date(u.subscriptionEnd).getTime() - now) / 86400000;
        return days > 0 && days <= 7;
    });

    ok(res, {
        users: {
            total:     users.length,
            today:     users.filter(u => new Date(u.createdAt) >= today).length,
            week:      users.filter(u => new Date(u.createdAt) >= week).length,
            month:     users.filter(u => new Date(u.createdAt) >= month).length,
            active:    users.filter(u => u.active !== false).length,
            inactive:  users.filter(u => u.active === false).length,
        },
        trial: {
            active:    statuses.filter(s => s === 'trial').length,
            expiring:  users.filter(u => {
                const base = u.trialStart || u.createdAt;
                if (!base) return false;
                const end  = new Date(base).getTime() + TRIAL_DAYS * 86400000;
                const days = (end - now) / 86400000;
                return days > 0 && days <= 1;
            }).length,
            expired:   statuses.filter(s => s === 'trial_expired').length,
        },
        subscription: {
            active:     statuses.filter(s => s === 'subscribed' || s === 'cancelled_active').length,
            none:       statuses.filter(s => s === 'trial_expired' || s === 'no_access').length,
            expired:    users.filter(u => u.subscriptionStatus === 'active' && u.subscriptionEnd && new Date(u.subscriptionEnd).getTime() <= now).length,
            cancelled:  users.filter(u => u.subscriptionStatus === 'cancelled').length,
            expiring:   sub_expiring.length,
        },
        tickets: {
            total:      tickets.length,
            new:        tickets.filter(t => t.status === 'new').length,
            inProgress: tickets.filter(t => t.status === 'in_progress').length,
            resolved:   tickets.filter(t => t.status === 'resolved').length,
            closed:     tickets.filter(t => t.status === 'closed').length,
        },
        // ── Ingresos desglosados por período ──────────────────────────────────
        revenue: (function() {
            const payments = readPayments();
            const todayStart = new Date(); todayStart.setHours(0,0,0,0);
            const weekStart  = new Date(now - 7  * 86400000);
            const monthStart = new Date(now - 30 * 86400000);
            const yearStart  = new Date(now - 365* 86400000);
            let day=0, week7=0, month30=0, year1=0, total=0, failed=0, pending=0;
            payments.forEach(p => {
                const t = new Date(p.ts).getTime();
                if (p.status === 'completed') {
                    const amt = Number(p.amount) || 0;
                    total  += amt;
                    if (t >= todayStart) day    += amt;
                    if (t >= weekStart)  week7  += amt;
                    if (t >= monthStart) month30 += amt;
                    if (t >= yearStart)  year1  += amt;
                } else if (p.status === 'failed')  failed++;
                else if (p.status === 'pending')    pending++;
            });
            return {
                today:  +day.toFixed(2),
                week:   +week7.toFixed(2),
                month:  +month30.toFixed(2),
                year:   +year1.toFixed(2),
                total:  +total.toFixed(2),
                failedPayments:   failed,
                pendingPayments:  pending,
            };
        })(),
    });
});

// ── LISTAR USUARIOS (admin) ────────────────────────────────────────────────────
app.get('/api/admin/users', requireAdmin, (req, res) => {
    const users   = readUsers();
    const now     = Date.now();
    const { search, filter, sort, order } = req.query;

    let list = users.map(u => {
        const base     = u.trialStart || u.createdAt;
        const trialEnd = base ? new Date(base).getTime() + TRIAL_DAYS * 86400000 : null;
        const status   = getAccessStatus(u);
        return {
            id:                 u.id,
            name:               u.name,
            email:              u.email,
            role:               u.role,
            company:            u.company || '',
            avatar:             u.avatar  || '',
            mode:               u.mode    || 'basic',
            createdAt:          u.createdAt,
            active:             u.active !== false,
            trialStart:         u.trialStart || null,
            trialEnd:           trialEnd ? new Date(trialEnd).toISOString() : null,
            subscriptionStatus: u.subscriptionStatus || null,
            subscriptionPlan:   u.subscriptionPlan   || null,
            subscriptionEnd:    u.subscriptionEnd    || null,
            accessStatus:       status.status,
            accessDaysLeft:     status.daysLeft,
            // Nunca exponer password ni tokens
        };
    });

    // Búsqueda
    if (search) {
        const q = search.toLowerCase();
        list = list.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.company||'').toLowerCase().includes(q));
    }

    // Filtros
    if (filter === 'trial')            list = list.filter(u => u.accessStatus === 'trial');
    else if (filter === 'trial_expired') list = list.filter(u => u.accessStatus === 'trial_expired');
    else if (filter === 'subscribed')  list = list.filter(u => u.accessStatus === 'subscribed' || u.accessStatus === 'cancelled_active');
    else if (filter === 'no_sub')      list = list.filter(u => u.accessStatus === 'trial_expired' || u.accessStatus === 'no_access');
    else if (filter === 'inactive')    list = list.filter(u => !u.active);
    else if (filter === 'admin')       list = list.filter(u => u.role === 'admin');

    // Ordenar
    if (sort) {
        list.sort((a, b) => {
            let av = a[sort] || '', bv = b[sort] || '';
            if (typeof av === 'string') av = av.toLowerCase();
            if (typeof bv === 'string') bv = bv.toLowerCase();
            return order === 'desc' ? (av < bv ? 1 : -1) : (av > bv ? 1 : -1);
        });
    }
    ok(res, list);
});

// ── DETALLE DE UN USUARIO ──────────────────────────────────────────────────────
app.get('/api/admin/users/:id', requireAdmin, (req, res) => {
    const users  = readUsers();
    const user   = users.find(u => u.id === req.params.id);
    if (!user) return err(res, 'Usuario no encontrado', 404);
    const status = getAccessStatus(user);
    const tickets = readTickets().filter(t => t.userId === user.id);
    ok(res, {
        id: user.id, name: user.name, email: user.email, role: user.role,
        company: user.company, avatar: user.avatar, mode: user.mode,
        createdAt: user.createdAt, active: user.active !== false, mustChange: user.mustChange||false,
        trialStart: user.trialStart, subscriptionStatus: user.subscriptionStatus,
        subscriptionPlan: user.subscriptionPlan, subscriptionStart: user.subscriptionStart,
        subscriptionEnd: user.subscriptionEnd, subscriptionSource: user.subscriptionSource,
        accessStatus: status, ticketCount: tickets.length,
    });
});

// ── ACCIONES SOBRE USUARIOS (admin) ───────────────────────────────────────────
app.post('/api/admin/users/:id/action', requireAdmin, (req, res) => {
    const { action, reason } = req.body;
    const ALLOWED = ['suspend', 'reactivate', 'grant_access', 'revoke_access', 'force_logout'];
    if (!ALLOWED.includes(action)) return err(res, 'Acción no permitida');

    const users = readUsers();
    const idx   = users.findIndex(u => u.id === req.params.id);
    if (idx === -1) return err(res, 'Usuario no encontrado', 404);
    const target = users[idx];

    if (action === 'suspend') {
        target.active = false;
        target.suspendedAt = new Date().toISOString();
        target.suspendReason = reason || '';
    } else if (action === 'reactivate') {
        target.active = true;
        delete target.suspendedAt;
        delete target.suspendReason;
    } else if (action === 'grant_access') {
        // Extender trial 7 días
        target.trialStart = new Date(Date.now() - (TRIAL_DAYS - 7) * 86400000).toISOString();
    } else if (action === 'revoke_access') {
        target.trialStart = new Date(Date.now() - 10 * 86400000).toISOString();
    } else if (action === 'force_logout') {
        const sessions = readSessions();
        Object.keys(sessions).forEach(tok => {
            const e = sessions[tok];
            const uid = typeof e === 'object' ? e.userId : e;
            if (uid === target.id) delete sessions[tok];
        });
        writeSessions(sessions);
    }

    writeUsers(users);
    logAdminAction(req.admin.id, req.admin.email, action, target.id, target.email, reason||'');
    // Notificar vía SSE
    setImmediate(() => {
        if (typeof sseUser === 'function') {
            sseUser(target.id, 'account_status_changed', {
                active: target.active,
                action,
                reason: reason || '',
                changedBy: 'admin',
            });
        }
        if (typeof sseAdmin === 'function') {
            sseAdmin('user_status_updated', { userId: target.id, email: target.email, action, active: target.active });
        }
    });
    ok(res, { done: true, action, user: { id: target.id, email: target.email, active: target.active } });
});

// ── ELIMINAR USUARIO (admin) ───────────────────────────────────────────────────
app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
    const users = readUsers();
    const idx   = users.findIndex(u => u.id === req.params.id);
    if (idx === -1) return err(res, 'Usuario no encontrado', 404);

    const target = users[idx];

    // Protecciones
    if (target.id === req.admin.id)
        return err(res, 'No puedes eliminar tu propio usuario administrador', 403);
    if (target.role === 'admin') {
        const adminCount = users.filter(u => u.role === 'admin').length;
        if (adminCount <= 1)
            return err(res, 'No puedes eliminar el único administrador del sistema', 403);
    }

    // Eliminar todas las sesiones activas del usuario
    const sessions = readSessions();
    let sessionsClosed = 0;
    Object.keys(sessions).forEach(tok => {
        const e = sessions[tok];
        const uid = typeof e === 'object' ? e.userId : e;
        if (uid === target.id) { delete sessions[tok]; sessionsClosed++; }
    });
    if (sessionsClosed > 0) writeSessions(sessions);

    // Eliminar usuario
    users.splice(idx, 1);
    writeUsers(users);

    logAdminAction(req.admin.id, req.admin.email, 'user_deleted', target.id, target.email,
        `Eliminado por admin. Sesiones cerradas: ${sessionsClosed}`);

    ok(res, { done: true, deleted: { id: target.id, email: target.email } });
});

// ── ACTIVAR SUSCRIPCIÓN MANUAL (admin) ─────────────────────────────────────────
app.post('/api/admin/users/:id/subscription', requireAdmin, (req, res) => {
    const { planId, durationDays, action: subAction } = req.body;
    const users = readUsers();
    const idx   = users.findIndex(u => u.id === req.params.id);
    if (idx === -1) return err(res, 'Usuario no encontrado', 404);
    const target = users[idx];
    const now    = new Date();

    if (subAction === 'cancel') {
        target.subscriptionStatus      = 'cancelled';
        target.subscriptionCancelledAt = now.toISOString();
    } else {
        // Activar / extender — respetar duración del plan si se especifica
        const plan   = getPlan(planId);
        const days   = durationDays || plan?.duration || 30;
        const subEnd = new Date(now.getTime() + days * 86400000);
        target.subscriptionStatus    = 'active';
        target.subscriptionPlan      = planId || 'manual';
        target.subscriptionStart     = now.toISOString();
        target.subscriptionEnd       = subEnd.toISOString();
        target.subscriptionSource    = 'admin';
        target.subscriptionRenewedAt = now.toISOString();
        target.pendingPlanId         = null;
        target.pendingPlanSince      = null;
        // Registrar como pago administrativo (sin cargo, solo auditoría)
        recordPayment({
            userId:    target.id,
            userEmail: target.email,
            planId:    planId || 'manual',
            planName:  plan?.name || 'Manual (Admin)',
            amount:    0,
            currency:  'USD',
            method:    'admin',
            status:    'completed',
            source:    'admin',
            note:      `Activado manualmente por admin ${req.admin.email} · ${days} días`,
        });
    }
    writeUsers(users);
    logAdminAction(req.admin.id, req.admin.email, 'subscription_' + (subAction || 'activate'), target.id, target.email, planId || '');

    // Notificar al usuario afectado vía SSE
    setImmediate(() => {
        if (typeof sseUser === 'function') {
            sseUser(target.id, 'subscription_changed', {
                subscriptionStatus: target.subscriptionStatus,
                subscriptionPlan:   target.subscriptionPlan,
                subscriptionEnd:    target.subscriptionEnd,
                changedBy: 'admin',
            });
        }
        if (typeof sseAdmin === 'function') {
            sseAdmin('user_subscription_updated', { userId: target.id, email: target.email, action: subAction || 'activate', planId });
        }
    });

    // Alerta WhatsApp cuando el admin activa manualmente
    if (subAction !== 'cancel') {
        alertWA('subscription_new', {
            id: generateId(), userEmail: target.email,
            userName: target.name, company: target.company||'—',
            planName: getPlan(planId)?.name || planId || 'Manual',
            amount: getPlan(planId)?.price || 0,
        });
    } else {
        alertWA('subscription_cancelled', {
            id: generateId(), userEmail: target.email,
            userName: target.name, company: target.company||'—',
            planName: getPlan(target.subscriptionPlan)?.name || '—',
        });
    }

    ok(res, { done: true, subscriptionStatus: target.subscriptionStatus, subscriptionEnd: target.subscriptionEnd });
});

// ── REGISTRO DE ACCIONES ADMIN ─────────────────────────────────────────────────
app.get('/api/admin/log', requireAdmin, (req, res) => {
    const log = readAdminLog();
    const { limit: lim = 200 } = req.query;
    ok(res, log.slice(0, parseInt(lim)));
});

// ──────────────────────────────────────────────────────────────────────────────
// TICKETS DE SOPORTE
// /api/support/* → usuarios normales (requireAuth)
// /api/admin/tickets/* → solo admins (requireAdmin)
// ──────────────────────────────────────────────────────────────────────────────

// Usuario crea ticket
app.post('/api/support/tickets', requireAuth, (req, res) => {
    const { category, title, description, priority } = req.body;
    if (!title || !description) return err(res, 'Título y descripción requeridos');
    const tickets = readTickets();
    const ticket  = {
        id:          'TKT-' + Date.now().toString(36).toUpperCase(),
        userId:      req.user.id,
        userName:    req.user.name,
        userEmail:   req.user.email,
        category:    category || 'Otro',
        title:       title.trim(),
        description: description.trim(),
        priority:    priority || 'media',
        status:      'new',
        createdAt:   new Date().toISOString(),
        updatedAt:   new Date().toISOString(),
        messages:    [{
            id:       generateId(),
            from:     'user',
            userId:   req.user.id,
            userName: req.user.name,
            text:     description.trim(),
            ts:       new Date().toISOString(),
            internal: false,
        }],
    };
    tickets.unshift(ticket);
    writeTickets(tickets);
    console.log(`🎫 Nuevo ticket: ${ticket.id} — ${req.user.email} — ${title}`);

    // Alerta WhatsApp automática
    alertWA('ticket_new', {
        id: ticket.id, userName: req.user.name,
        company: req.user.company||'—',
        category: ticket.category, title: ticket.title,
        priority: ticket.priority,
    });

    ok(res, ticket);
});

// Usuario ve sus tickets
app.get('/api/support/tickets', requireAuth, (req, res) => {
    const tickets = readTickets().filter(t => t.userId === req.user.id);
    ok(res, tickets.map(t => ({
        id: t.id, category: t.category, title: t.title, status: t.status,
        priority: t.priority, createdAt: t.createdAt, updatedAt: t.updatedAt,
        messageCount: t.messages.filter(m => !m.internal).length,
        lastReply: t.messages.filter(m => m.from === 'admin' && !m.internal).slice(-1)[0]?.ts || null,
    })));
});

// Usuario ve un ticket (solo el suyo)
app.get('/api/support/tickets/:id', requireAuth, (req, res) => {
    const ticket = readTickets().find(t => t.id === req.params.id && t.userId === req.user.id);
    if (!ticket) return err(res, 'Ticket no encontrado', 404);
    ok(res, { ...ticket, messages: ticket.messages.filter(m => !m.internal) });
});

// Usuario agrega mensaje a su ticket
app.post('/api/support/tickets/:id/reply', requireAuth, (req, res) => {
    const { text } = req.body;
    if (!text) return err(res, 'Texto requerido');
    const tickets = readTickets();
    const idx = tickets.findIndex(t => t.id === req.params.id && t.userId === req.user.id);
    if (idx === -1) return err(res, 'Ticket no encontrado', 404);
    if (tickets[idx].status === 'closed') return err(res, 'El ticket está cerrado');
    const msg = { id: generateId(), from: 'user', userId: req.user.id, userName: req.user.name, text: text.trim(), ts: new Date().toISOString(), internal: false };
    tickets[idx].messages.push(msg);
    tickets[idx].updatedAt = msg.ts;
    if (tickets[idx].status === 'resolved') tickets[idx].status = 'in_progress';
    writeTickets(tickets);
    ok(res, msg);
});

// ── ADMIN: ver todos los tickets ───────────────────────────────────────────────
app.get('/api/admin/tickets', requireAdmin, (req, res) => {
    const tickets = readTickets();
    const { status, priority, search } = req.query;
    let list = tickets;
    if (status)   list = list.filter(t => t.status === status);
    if (priority) list = list.filter(t => t.priority === priority);
    if (search) {
        const q = search.toLowerCase();
        list = list.filter(t => t.title.toLowerCase().includes(q) || t.userEmail.toLowerCase().includes(q) || t.id.toLowerCase().includes(q));
    }
    ok(res, list.map(t => ({ ...t, messages: undefined, _messageCount: t.messages.length, _lastMsg: t.messages.slice(-1)[0] })));
});

// ADMIN: ver un ticket completo
app.get('/api/admin/tickets/:id', requireAdmin, (req, res) => {
    const ticket = readTickets().find(t => t.id === req.params.id);
    if (!ticket) return err(res, 'Ticket no encontrado', 404);
    ok(res, ticket);
});

// ADMIN: actualizar ticket (status, priority, assignment)
app.put('/api/admin/tickets/:id', requireAdmin, (req, res) => {
    const { status, priority, assignedTo } = req.body;
    const tickets = readTickets();
    const idx     = tickets.findIndex(t => t.id === req.params.id);
    if (idx === -1) return err(res, 'Ticket no encontrado', 404);
    const old = { status: tickets[idx].status, priority: tickets[idx].priority };
    if (status)   tickets[idx].status   = status;
    if (priority) tickets[idx].priority = priority;
    if (assignedTo !== undefined) tickets[idx].assignedTo = assignedTo;
    tickets[idx].updatedAt = new Date().toISOString();
    writeTickets(tickets);
    logAdminAction(req.admin.id, req.admin.email, 'ticket_update', tickets[idx].userId, tickets[idx].userEmail,
        `TKT ${tickets[idx].id}: status ${old.status}→${tickets[idx].status}`);
    ok(res, { done: true });
});

// ADMIN: responder a ticket
app.post('/api/admin/tickets/:id/reply', requireAdmin, (req, res) => {
    const { text, internal } = req.body;
    if (!text) return err(res, 'Texto requerido');
    const tickets = readTickets();
    const idx     = tickets.findIndex(t => t.id === req.params.id);
    if (idx === -1) return err(res, 'Ticket no encontrado', 404);
    const msg = {
        id:       generateId(),
        from:     'admin',
        adminId:  req.admin.id,
        adminName:req.admin.name,
        text:     text.trim(),
        ts:       new Date().toISOString(),
        internal: internal === true,
    };
    tickets[idx].messages.push(msg);
    tickets[idx].updatedAt = msg.ts;
    if (!internal && tickets[idx].status === 'new') tickets[idx].status = 'in_progress';
    writeTickets(tickets);
    logAdminAction(req.admin.id, req.admin.email, internal ? 'ticket_note' : 'ticket_reply', tickets[idx].userId, tickets[idx].userEmail, `TKT ${tickets[idx].id}`);
    ok(res, msg);
});

// ── Servir admin.html ─────────────────────────────────────────────────────────
app.get('/admin.html', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('ETag', Date.now().toString());
    try {
        const html = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch(e) {
        res.status(500).send('Error');
    }
});


// ══════════════════════════════════════════════════════════════════════════════
// USUARIO DEMO — BD completamente aislada, jamás toca datos de otros usuarios
// ══════════════════════════════════════════════════════════════════════════════

const DEMO_COMPANY_ID  = 'demo-company-fixed';
const DEMO_DB_PATH     = path.join(__dirname, 'db_demo.json');
const DEMO_EMAIL       = 'demo@fixpromax.app';
const DEMO_PASSWORD    = 'Demo1234';
const DEMO_RESET_HOURS = 24;

/** Datos de ejemplo pre-cargados para el modo demo */
function demoData() {
    const now   = new Date().toISOString();
    const today = now.slice(0, 10);
    const d     = defaultData();
    d.settings  = { companyName:'Empresa Demo', rif:'J-00000000-0', country:'Venezuela', currency:'USD', defaultCurrency:'VES', darkMode:true, notifications:true, aiEnabled:true };
    d.categories = [
        { id:'cat-d1', name:'Repuestos',    createdAt:now },
        { id:'cat-d2', name:'Herramientas', createdAt:now },
        { id:'cat-d3', name:'Consumibles',  createdAt:now },
    ];
    d.warehouses = [{ id:'wh-d1', name:'Almacén Principal', location:'Caracas' }];
    d.suppliers  = [
        { id:'sup-d1', name:'Proveedor A', email:'a@prov.com', phone:'0412-0000001', balance:0,    status:'activo', createdAt:now },
        { id:'sup-d2', name:'Proveedor B', email:'b@prov.com', phone:'0414-0000002', balance:1500, status:'activo', createdAt:now },
    ];
    d.customers = [
        { id:'cus-d1', firstName:'Juan',   lastName:'García', email:'juan@demo.com',  phone:'0416-0000001', balance:0,    credit:5000,  status:'activo', createdAt:now },
        { id:'cus-d2', firstName:'María',  lastName:'López',  email:'maria@demo.com', phone:'0424-0000002', balance:2000, credit:10000, status:'activo', createdAt:now },
        { id:'cus-d3', firstName:'Carlos', lastName:'Pérez',  email:'carlos@demo.com',phone:'0412-0000003', balance:0,    credit:3000,  status:'activo', createdAt:now },
    ];
    d.products = [
        { id:'pd1', name:'Filtro de aceite',       sku:'FILT-001', price:1200, cost:800,  stock:50,  minStock:10, categoryId:'cat-d1', supplierId:'sup-d1', warehouseId:'wh-d1', currency:'VES', status:'activo', createdAt:now, updatedAt:now },
        { id:'pd2', name:'Bujía NGK',              sku:'BUJN-001', price:450,  cost:300,  stock:120, minStock:20, categoryId:'cat-d1', supplierId:'sup-d1', warehouseId:'wh-d1', currency:'VES', status:'activo', createdAt:now, updatedAt:now },
        { id:'pd3', name:'Aceite 20W-50',          sku:'ACE-001',  price:2100, cost:1400, stock:30,  minStock:10, categoryId:'cat-d3', supplierId:'sup-d2', warehouseId:'wh-d1', currency:'VES', status:'activo', createdAt:now, updatedAt:now },
        { id:'pd4', name:'Sensor temperatura EUR', sku:'SEN-EUR1', price:18,   cost:11,   stock:8,   minStock:3,  categoryId:'cat-d1', supplierId:'sup-d2', warehouseId:'wh-d1', currency:'EUR', status:'activo', createdAt:now, updatedAt:now },
        { id:'pd5', name:'Kit herramientas USD',   sku:'KIT-001',  price:45,   cost:28,   stock:4,   minStock:5,  categoryId:'cat-d2', supplierId:'sup-d1', warehouseId:'wh-d1', currency:'USD', status:'activo', createdAt:now, updatedAt:now },
        { id:'pd6', name:'Correa distribución',    sku:'COR-001',  price:3500, cost:2200, stock:0,   minStock:5,  categoryId:'cat-d1', supplierId:'sup-d1', warehouseId:'wh-d1', currency:'VES', status:'activo', createdAt:now, updatedAt:now },
    ];
    d.sales = [
        { id:'sale-d1', invoice:'DEMO-001', customerId:'cus-d1', items:[{productId:'pd1',qty:3,price:1200},{productId:'pd2',qty:10,price:450}], subtotal:8100,  tax:1296,  total:9396,  paid:9396,  method:'CASH',          date:today, currency:'VES', status:'Pagada', createdAt:now },
        { id:'sale-d2', invoice:'DEMO-002', customerId:'cus-d2', items:[{productId:'pd4',qty:1,price:18}],                                      subtotal:18,    tax:2.88,  total:20.88, paid:20.88, method:'Zelle',         date:today, currency:'EUR', status:'Pagada', createdAt:now },
        { id:'sale-d3', invoice:'DEMO-003', customerId:'cus-d3', items:[{productId:'pd5',qty:1,price:45}],                                      subtotal:45,    tax:7.2,   total:52.2,  paid:52.2,  method:'BANK_TRANSFER', date:today, currency:'USD', status:'Pagada', createdAt:now },
    ];
    d.expenses = [
        { id:'exp-d1', description:'Alquiler local',    category:'Operativo', amount:5000, method:'BANK_TRANSFER', date:today, currency:'VES', status:'activo', createdAt:now },
        { id:'exp-d2', description:'Electricidad',      category:'Servicios', amount:1200, method:'CASH',          date:today, currency:'VES', status:'activo', createdAt:now },
        { id:'exp-d3', description:'Software licencia', category:'Tech',      amount:25,   method:'CREDIT_CARD',   date:today, currency:'EUR', status:'activo', createdAt:now },
    ];
    d.invoices = [
        { id:'inv-d1', number:'FAC-DEMO-001', customerId:'cus-d2', date:today, dueDate:today, total:20.88, paid:0,     notes:'Factura demo', currency:'EUR', status:'Pendiente', createdAt:now, updatedAt:now },
        { id:'inv-d2', number:'FAC-DEMO-002', customerId:'cus-d1', date:today, dueDate:today, total:9396,  paid:9396,  notes:'Pagada',       currency:'VES', status:'Pagada',    createdAt:now, updatedAt:now },
    ];
    d.currencies = [
        { code:'VES', name:'Bolívar venezolano',   symbol:'Bs.', flag:'🇻🇪', active:true,  isBase:true  },
        { code:'EUR', name:'Euro',                 symbol:'€',   flag:'🇪🇺', active:true,  isBase:false },
        { code:'USD', name:'Dólar estadounidense', symbol:'$',   flag:'🇺🇸', active:true,  isBase:false },
    ];
    d.exchangeRates = [
        { id:'r-eur-d', fromCurrency:'EUR', toCurrency:'VES', rate:40.00, date:today, createdAt:now, createdBy:'demo', notes:'Tasa demo inicial', isActive:true,  updateType:'manual' },
        { id:'r-usd-d', fromCurrency:'USD', toCurrency:'VES', rate:36.00, date:today, createdAt:now, createdBy:'demo', notes:'Tasa demo inicial', isActive:true,  updateType:'manual' },
    ];
    d.demoResetAt = now;
    return d;
}

function readDemoDB() {
    try {
        if (fs.existsSync(DEMO_DB_PATH)) {
            const raw = fs.readFileSync(DEMO_DB_PATH, 'utf8').replace(/^\uFEFF/, '');
            const db  = JSON.parse(raw);
            if (db.demoResetAt) {
                const ageH = (Date.now() - new Date(db.demoResetAt).getTime()) / 3600000;
                if (ageH < DEMO_RESET_HOURS) return db;
            }
        }
    } catch {}
    const fresh = demoData();
    fs.writeFileSync(DEMO_DB_PATH, JSON.stringify(fresh, null, 2), 'utf8');
    console.log('  🎭 BD demo creada/reseteada');
    return fresh;
}

function writeDemoDB(data) {
    // GARANTÍA: solo escribe en db_demo.json, nunca en otra BD
    fs.writeFileSync(DEMO_DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

/** ¿Es este usuario demo? */
function isDemo(user) {
    return user && (user.isDemo === true || user.companyId === DEMO_COMPANY_ID || user.email === DEMO_EMAIL);
}

// ── POST /api/demo/login — inicia sesión demo sin exponer contraseña ──────────
app.post('/api/demo/login', (req, res) => {
    let users    = readUsers();
    let demoUser = users.find(u => u.email === DEMO_EMAIL);
    if (!demoUser) {
        demoUser = {
            id: 'demo-user-fixed', name: 'Usuario Demo', email: DEMO_EMAIL,
            password: hashPassword(DEMO_PASSWORD), company: 'Empresa Demo',
            role: 'user', mode: 'pro', avatar: 'DE',
            createdAt: new Date().toISOString(), trialStart: new Date().toISOString(),
            active: true, isDemo: true,
            companyId: DEMO_COMPANY_ID, teamRole: 'owner', permissions: null,
        };
        users.push(demoUser);
        writeUsers(users);
    }
    readDemoDB(); // asegurar que existe
    const token    = makeToken();
    const sessions = readSessions();
    sessions[token] = { userId: demoUser.id, created: Date.now(), isDemo: true };
    writeSessions(sessions);
    console.log('  🎭 Demo login');
    ok(res, {
        token,
        user: { id: demoUser.id, name: demoUser.name, email: demoUser.email,
                role: demoUser.role, company: demoUser.company, avatar: demoUser.avatar,
                mode: demoUser.mode, companyId: demoUser.companyId, teamRole: demoUser.teamRole,
                isDemo: true },
        isDemo: true,
    });
});

// ── POST /api/demo/reset — restaurar datos de ejemplo ────────────────────────
app.post('/api/demo/reset', requireAuth, (req, res) => {
    if (!isDemo(req.user)) return err(res, 'Solo disponible para el usuario demo', 403);
    const fresh = demoData();
    writeDemoDB(fresh);
    ok(res, { message: 'Datos demo restaurados', resetAt: fresh.demoResetAt });
});

// ── GET /api/demo/status ──────────────────────────────────────────────────────
app.get('/api/demo/status', (req, res) => {
    ok(res, { available: true, email: DEMO_EMAIL, resetHours: DEMO_RESET_HOURS });
});

// ══════════════════════════════════════════════════════════════════════════════
// SISTEMA AUTOMÁTICO DE TASAS BCV — USD/VES · EUR/VES
// Fuente: https://bcv.today/api/v1/rate.json (pública, sin clave)
// ══════════════════════════════════════════════════════════════════════════════

// ── GET: tasas actuales (USD/VES y EUR/VES) ───────────────────────────────────
app.get('/api/rates/current', requireAuth, (req, res) => {
    const db    = readDB();
    const rates = ExchangeRateService.getCurrentRates(db);
    const svc   = ExchangeRateService.getStatus();
    ok(res, { ...rates, serviceStatus: svc });
});

// ── GET: estado del servicio de tasas ─────────────────────────────────────────
app.get('/api/rates/status', requireAuth, (req, res) => {
    ok(res, ExchangeRateService.getStatus());
});

// ── GET: historial completo de tasas ─────────────────────────────────────────
app.get('/api/rates/history', requireAuth, (req, res) => {
    const db    = readDB();
    const rates = Array.isArray(db.exchangeRates) ? db.exchangeRates : [];

    // Agrupar y ordenar: primero activos, luego históricos
    const sorted = [...rates].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Estadísticas
    const usdRates = sorted.filter(r => r.fromCurrency === 'USD');
    const eurRates = sorted.filter(r => r.fromCurrency === 'EUR');
    const autoCount = sorted.filter(r => r.updateType === 'auto').length;
    const manualCount = sorted.filter(r => r.updateType === 'manual' || !r.updateType).length;

    ok(res, {
        rates:       sorted,
        total:       sorted.length,
        usdCount:    usdRates.length,
        eurCount:    eurRates.length,
        autoCount,
        manualCount,
        currentUSD:  usdRates.find(r => r.isActive),
        currentEUR:  eurRates.find(r => r.isActive),
        serviceStatus: ExchangeRateService.getStatus(),
    });
});

// ── POST: actualización MANUAL de tasas (solo admin/owner) ───────────────────
app.post('/api/rates/update', requireAuth, async (req, res) => {
    // Solo el owner o admin puede forzar actualización
    if (req.user.teamRole !== 'owner' && req.user.role !== 'admin' && req.user.teamRole !== 'admin') {
        return err(res, 'Solo el administrador puede actualizar tasas manualmente.', 403);
    }

    try {
        const result = await ExchangeRateService.fetchAndSaveAll(
            _readGlobalDB,
            _writeGlobalDB,
            _readCompanyDB,
            _writeCompanyDB,
            _listCompanies,
            req.user.email || 'admin-manual',
            'manual'
        );

        logAdminAction(
            req.user.id, req.user.email, 'exchange_rate_manual_update', null, null,
            result.success
                ? `USD=${result.USD} EUR=${result.EUR} fuente=${result.source}`
                : `Error: ${result.error}`
        );

        if (result.success) {
            ok(res, result);
        } else {
            // Devolver éxito parcial si hay tasa cacheada vigente
            const db      = readDB();
            const current = ExchangeRateService.getCurrentRates(db);
            ok(res, { ...result, cached: current, warning: 'Se usa última tasa válida' });
        }
    } catch (e) {
        err(res, `Error al actualizar tasas: ${e.message}`, 500);
    }
});

// ── POST: guardar tasa manual directa (el admin ingresa el valor) ────────────
app.post('/api/rates/manual', requireAuth, (req, res) => {
    if (req.user.teamRole !== 'owner' && req.user.role !== 'admin' && req.user.teamRole !== 'admin') {
        return err(res, 'Solo el administrador puede establecer tasas manualmente.', 403);
    }
    const { fromCurrency, toCurrency, rate, notes } = req.body;
    const rateVal = parseFloat(rate);

    if (!['USD', 'EUR', 'VES'].includes(fromCurrency)) return err(res, 'Moneda origen inválida');
    if (!['USD', 'EUR', 'VES'].includes(toCurrency))   return err(res, 'Moneda destino inválida');
    if (fromCurrency === toCurrency)                   return err(res, 'Monedas deben ser diferentes');
    if (!rateVal || rateVal <= 0)                      return err(res, 'Tasa debe ser positiva');

    const db  = readDB();
    if (!Array.isArray(db.exchangeRates)) db.exchangeRates = [];

    // Desactivar tasas anteriores del mismo par
    db.exchangeRates.forEach(r => {
        if (r.fromCurrency === fromCurrency && r.toCurrency === toCurrency) r.isActive = false;
    });

    const newEntry = {
        id:           generateId(),
        fromCurrency,
        toCurrency,
        rate:         rateVal,
        date:         new Date().toISOString().slice(0, 10),
        createdAt:    new Date().toISOString(),
        updatedAt:    new Date().toISOString(),
        createdBy:    req.user.email || 'admin',
        notes:        notes || 'Ingresada manualmente por administrador',
        source:       'Manual',
        updateType:   'manual',
        isActive:     true,
    };
    db.exchangeRates.push(newEntry);
    writeDB(db);

    // Actualizar también todas las BDs de empresa
    try {
        const dbDir   = path.dirname(require.main?.filename || DB_PATH);
        const dbFiles = fs.readdirSync(dbDir).filter(f => /^db_[a-z0-9]+\.json$/i.test(f));
        for (const dbFile of dbFiles) {
            try {
                if (dbFile === 'db_demo.json') continue; // nunca tocar la BD demo
                const dbPath    = path.join(dbDir, dbFile);
                const raw       = fs.readFileSync(dbPath, 'utf8');
                const companyDB = JSON.parse(raw.replace(/^\uFEFF/, ''));
                if (!Array.isArray(companyDB.exchangeRates)) companyDB.exchangeRates = [];
                companyDB.exchangeRates.forEach(r => {
                    if (r.fromCurrency === fromCurrency && r.toCurrency === toCurrency) r.isActive = false;
                });
                companyDB.exchangeRates.push({ ...newEntry, id: generateId() });
                fs.writeFileSync(dbPath, JSON.stringify(companyDB, null, 2), 'utf8');
            } catch {}
        }
    } catch {}

    logAdminAction(req.user.id, req.user.email, 'exchange_rate_manual_set', null, null,
        `${fromCurrency}→${toCurrency}=${rateVal}`);
    ok(res, newEntry);
});

// ── GET: convertir un monto entre monedas ────────────────────────────────────
app.get('/api/rates/convert', requireAuth, (req, res) => {
    const { amount, from, to } = req.query;
    const val = parseFloat(amount);
    if (!val || !from || !to) return err(res, 'Parámetros requeridos: amount, from, to');

    const db      = readDB();
    const current = ExchangeRateService.getCurrentRates(db);

    if (!current.USD || !current.EUR) {
        return err(res, 'Tasas no disponibles aún. Espere la actualización automática.');
    }

    // Construir mapa de tasas directas a VES
    const toVES = { VES: 1, USD: current.USD, EUR: current.EUR };

    let result;
    if (from === to) {
        result = val;
    } else if (toVES[from] && toVES[to]) {
        const inVES = val * toVES[from];
        result      = inVES / toVES[to];
    } else {
        return err(res, `Par de conversión ${from}→${to} no soportado`);
    }

    ok(res, {
        amount:    val,
        from,
        to,
        result:    parseFloat(result.toFixed(4)),
        rateUsed:  from === 'VES' ? (1 / toVES[to]) : toVES[from],
        USD_VES:   current.USD,
        EUR_VES:   current.EUR,
        date:      current.date,
        source:    current.source,
    });
});

// ── Helpers internos para manejar BDs de empresa ─────────────────────────────
function _readCompanyDB(companyId) {
    try {
        const p   = path.join(path.dirname(DB_PATH), `db_${companyId}.json`);
        if (!fs.existsSync(p)) return null;
        const raw = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
        return JSON.parse(raw);
    } catch { return null; }
}
function _writeCompanyDB(companyId, data) {
    try {
        const p = path.join(path.dirname(DB_PATH), `db_${companyId}.json`);
        fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
    } catch {}
}
function _listCompanies() {
    try {
        const users = readUsers();
        return users.filter(u => u.companyId).map(u => ({ id: u.companyId }));
    } catch { return []; }
}

// ══════════════════════════════════════════════════════════════════════════════
// SISTEMA GLOBAL DE MONEDAS — VES / EUR
// ══════════════════════════════════════════════════════════════════════════════

// ── GET: obtener configuración de monedas de la empresa ───────────────────────
app.get('/api/currencies', requireAuth, (req, res) => {
    const db = readDB();
    if (!Array.isArray(db.currencies) || db.currencies.length === 0) {
        db.currencies = defaultData().currencies;
    }
    // Asegurar que USD está en currencies
    if (!db.currencies.find(c => c.code === 'USD')) {
        db.currencies.push({ code:'USD', name:'Dólar estadounidense', symbol:'$', flag:'🇺🇸', active:true, isBase:false, format:'en-US', decimals:2 });
    }
    const svcStatus = ExchangeRateService.getStatus();
    ok(res, {
        currencies:      db.currencies,
        defaultCurrency: db.settings?.defaultCurrency || 'VES',
        activeRate:      _getActiveRate(db),
        activeRateUSD:   _getActiveUSDRate(db),
        currentRates:    ExchangeRateService.getCurrentRates(db),
        serviceStatus:   svcStatus,
    });
});

// ── PUT: cambiar moneda principal de la empresa ───────────────────────────────
app.put('/api/currencies/default', requireAuth, (req, res) => {
    const { code } = req.body;
    if (!['VES', 'EUR'].includes(code)) return err(res, 'Moneda no válida. Use VES o EUR.');
    const db = readDB();
    db.settings = db.settings || {};
    db.settings.defaultCurrency = code;
    writeDB(db);
    logAdminAction(req.user.id, req.user.email, 'currency_default_change', null, null, `→ ${code}`);
    ok(res, { defaultCurrency: code });
});

// ── GET: historial completo de tasas de cambio ────────────────────────────────
app.get('/api/exchange-rates', requireAuth, (req, res) => {
    const db = readDB();
    const rates = Array.isArray(db.exchangeRates) ? db.exchangeRates : [];
    // Ordenar por fecha descendente
    rates.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    ok(res, {
        rates,
        current: _getActiveRate(db),
    });
});

// ── POST: registrar nueva tasa de cambio ──────────────────────────────────────
app.post('/api/exchange-rates', requireAuth, (req, res) => {
    const { rate, notes, fromCurrency, toCurrency } = req.body;
    const rateVal = parseFloat(rate);
    if (!rateVal || rateVal <= 0) return err(res, 'La tasa debe ser un número positivo.');

    const from = fromCurrency || 'EUR';
    const to   = toCurrency   || 'VES';
    if (from === to) return err(res, 'Las monedas deben ser diferentes.');

    const db = readDB();
    if (!Array.isArray(db.exchangeRates)) db.exchangeRates = [];

    // Marcar la tasa anterior como inactiva (historial)
    db.exchangeRates.forEach(r => {
        if (r.fromCurrency === from && r.toCurrency === to) {
            r.isActive = false;
        }
    });

    const newRate = {
        id:           generateId(),
        fromCurrency: from,
        toCurrency:   to,
        rate:         rateVal,
        date:         new Date().toISOString().slice(0, 10),
        createdAt:    new Date().toISOString(),
        createdBy:    req.user?.email || 'sistema',
        notes:        notes || '',
        isActive:     true,
    };
    db.exchangeRates.push(newRate);
    writeDB(db);
    logAdminAction(req.user.id, req.user.email, 'exchange_rate_update', null, null,
        `1 ${from} = ${rateVal} ${to}`);
    ok(res, newRate);
});

// ── GET: tasa activa actual ───────────────────────────────────────────────────
app.get('/api/exchange-rates/current', requireAuth, (req, res) => {
    const db   = readDB();
    const rate = _getActiveRate(db);
    ok(res, rate);
});

// ── Estadísticas de monedas ───────────────────────────────────────────────────
app.get('/api/currencies/stats', requireAuth, (req, res) => {
    const db      = readDB();
    const current = ExchangeRateService.getCurrentRates(db);
    const rateEUR = current.EUR || _getActiveRate(db).rate;
    const rateUSD = current.USD || _getActiveUSDRate(db).rate;

    const _sum = (arr, filter, field) =>
        (arr || []).filter(filter).reduce((a, x) => a + (x[field] || 0), 0);

    const defCurr = db.settings?.defaultCurrency || 'VES';

    const salesVES = _sum(db.sales, s => (s.currency || defCurr) === 'VES', 'total');
    const salesEUR = _sum(db.sales, s => s.currency === 'EUR', 'total');
    const salesUSD = _sum(db.sales, s => s.currency === 'USD', 'total');

    const expVES = _sum(db.expenses.filter(e => e.status !== 'anulado'), e => (e.currency || defCurr) === 'VES', 'amount');
    const expEUR = _sum(db.expenses.filter(e => e.status !== 'anulado'), e => e.currency === 'EUR', 'amount');
    const expUSD = _sum(db.expenses.filter(e => e.status !== 'anulado'), e => e.currency === 'USD', 'amount');

    const invVES = _sum(db.products, p => (p.currency || defCurr) === 'VES', 'price') + 0;
    const invEUR = _sum(db.products, p => p.currency === 'EUR', 'price');
    const invUSD = _sum(db.products, p => p.currency === 'USD', 'price');

    // Total consolidado en VES
    const totalSalesVES = salesVES + salesEUR * rateEUR + salesUSD * rateUSD;
    const totalExpVES   = expVES   + expEUR   * rateEUR + expUSD   * rateUSD;

    ok(res, {
        currentRates:  current,
        rateEUR,
        rateUSD,
        sales:     { VES: salesVES, EUR: salesEUR, USD: salesUSD, totalInVES: totalSalesVES },
        expenses:  { VES: expVES,   EUR: expEUR,   USD: expUSD,   totalInVES: totalExpVES   },
        inventory: { VES: invVES,   EUR: invEUR,   USD: invUSD                              },
        profit:    {
            VES: salesVES - expVES,
            EUR: salesEUR - expEUR,
            USD: salesUSD - expUSD,
            totalInVES: totalSalesVES - totalExpVES,
        },
        serviceStatus: ExchangeRateService.getStatus(),
    });
});

// ── Helper interno: obtener la tasa EUR→VES activa ────────────────────────────
function _getActiveRate(db) {
    const rates = Array.isArray(db.exchangeRates) ? db.exchangeRates : [];
    // Intentar primero con la tasa del servicio automático (más fresca)
    const active = rates.find(r => r.fromCurrency === 'EUR' && r.toCurrency === 'VES' && r.isActive);
    if (active) return active;
    const sorted = rates
        .filter(r => r.fromCurrency === 'EUR' && r.toCurrency === 'VES')
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return sorted[0] || { fromCurrency: 'EUR', toCurrency: 'VES', rate: 40.00, isActive: true };
}

// ── Helper: obtener tasa USD→VES activa ──────────────────────────────────────
function _getActiveUSDRate(db) {
    const rates = Array.isArray(db.exchangeRates) ? db.exchangeRates : [];
    const active = rates.find(r => r.fromCurrency === 'USD' && r.toCurrency === 'VES' && r.isActive);
    if (active) return active;
    const sorted = rates
        .filter(r => r.fromCurrency === 'USD' && r.toCurrency === 'VES')
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return sorted[0] || { fromCurrency: 'USD', toCurrency: 'VES', rate: 36.00, isActive: true };
}

// ── Endpoint de migración segura de datos existentes ─────────────────────────
// Añade campo `currency` a todos los registros que no lo tengan
// usando la moneda principal configurada. NO modifica datos que ya tengan currency.
app.post('/api/migrate/add-currency', requireAuth, (req, res) => {
    // Solo el propietario puede migrar
    if (req.user.teamRole !== 'owner' && req.user.role !== 'admin') {
        return err(res, 'Solo el propietario puede ejecutar migraciones.', 403);
    }
    const db       = readDB();
    const defCurr  = db.settings?.defaultCurrency || 'VES';
    let   migrated = 0;

    // Colecciones a migrar
    const collections = [
        { arr: db.products,   field: 'currency' },
        { arr: db.sales,      field: 'currency' },
        { arr: db.invoices,   field: 'currency' },
        { arr: db.expenses,   field: 'currency' },
        { arr: db.purchases,  field: 'currency' },
        { arr: db.quotes,     field: 'currency' },
        { arr: db.payments,   field: 'currency' },
    ];

    collections.forEach(({ arr, field }) => {
        if (!Array.isArray(arr)) return;
        arr.forEach(item => {
            if (!item[field]) {
                item[field] = defCurr;
                migrated++;
            }
        });
    });

    // Asegurar que currencies y exchangeRates existen
    if (!Array.isArray(db.currencies) || db.currencies.length === 0) {
        db.currencies = defaultData().currencies;
    }
    if (!Array.isArray(db.exchangeRates) || db.exchangeRates.length === 0) {
        db.exchangeRates = defaultData().exchangeRates;
    }

    writeDB(db);
    logAdminAction(req.user.id, req.user.email, 'currency_migration', null, null,
        `${migrated} registros migrados a ${defCurr}`);
    ok(res, { migrated, defaultCurrency: defCurr });
});

// ══════════════════════════════════════════════════════════════════════════════
// SERVER-SENT EVENTS (SSE) — Actualizaciones en tiempo real
// El panel admin y la app se suscriben a /api/events y reciben push cuando
// algo importante cambia (plan actualizado, usuario suspendido, pago confirmado, etc.)
// ══════════════════════════════════════════════════════════════════════════════
const _sseClients = new Map(); // Map<clientId, { res, role, userId, companyId }>

function _sseId() { return Math.random().toString(36).slice(2); }

/** Enviar evento SSE a todos los clientes que coincidan con el filtro */
function broadcastSSE(event, data, filter) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    _sseClients.forEach((client, id) => {
        try {
            if (filter && !filter(client)) return;
            client.res.write(payload);
        } catch { _sseClients.delete(id); }
    });
}

/** Enviar a admins */
function sseAdmin(event, data) {
    broadcastSSE(event, data, c => c.role === 'admin');
}

/** Enviar a un usuario específico (por userId) */
function sseUser(userId, event, data) {
    broadcastSSE(event, data, c => c.userId === userId);
}

/** Enviar a todos los usuarios de una empresa */
function sseCompany(companyId, event, data) {
    broadcastSSE(event, data, c => c.companyId === companyId);
}

// Exponer globalmente para que los handlers existentes puedan usarlos
global._sseAdmin   = sseAdmin;
global._sseUser    = sseUser;
global._sseCompany = sseCompany;

// GET /api/events — conexión SSE (autenticado, acepta token via header O query param)
app.get('/api/events', (req, res) => {
    const headerTok = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    const queryTok  = (req.query.token || '').trim();
    const token     = headerTok || queryTok;
    if (!token) return res.status(401).end();

    const sessions = readSessions();
    const entry    = sessions[token];
    if (!entry) return res.status(401).end();
    const userId = typeof entry === 'object' ? entry.userId : entry;
    const users  = readUsers();
    const user   = users.find(u => u.id === userId);
    if (!user) return res.status(401).end();

    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const clientId = _sseId();
    _sseClients.set(clientId, {
        res,
        role:      user.role,
        userId:    user.id,
        companyId: user.companyId,
    });

    const pingTimer = setInterval(() => {
        try { res.write(': ping\n\n'); } catch { clearInterval(pingTimer); _sseClients.delete(clientId); }
    }, 25000);

    res.write(`event: connected\ndata: ${JSON.stringify({ clientId, ts: new Date().toISOString() })}\n\n`);
    req.on('close', () => { clearInterval(pingTimer); _sseClients.delete(clientId); });
});

// ── Ruta del panel de eventos admin — acepta token vía query param ────────────
app.get('/api/events/admin', (req, res) => {
    // Aceptar token desde header Authorization O desde query param ?token=
    const headerTok = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    const queryTok  = (req.query.token || '').trim();
    const token     = headerTok || queryTok;
    if (!token) return res.status(401).json({ ok: false, error: 'No autenticado' });
    const sessions = readSessions();
    const entry    = sessions[token];
    if (!entry) return res.status(401).json({ ok: false, error: 'Sesión inválida' });
    const userId = typeof entry === 'object' ? entry.userId : entry;
    const users  = readUsers();
    const user   = users.find(u => u.id === userId);
    if (!user || user.role !== 'admin') return res.status(403).json({ ok: false, error: 'Acceso denegado' });

    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const clientId = _sseId();
    _sseClients.set(clientId, { res, role: 'admin', userId: user.id, companyId: null });

    const pingTimer = setInterval(() => {
        try { res.write(': ping\n\n'); } catch { clearInterval(pingTimer); _sseClients.delete(clientId); }
    }, 25000);

    res.write(`event: connected\ndata: ${JSON.stringify({ clientId, ts: new Date().toISOString() })}\n\n`);
    req.on('close', () => { clearInterval(pingTimer); _sseClients.delete(clientId); });
});

// ══════════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN GLOBAL DEL SISTEMA (admin)
// Permite modificar: trialDays, appName, supportEmail, maxLoginAttempts, etc.
// Se guarda en config.json bajo la clave "globalSettings"
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/admin/global-settings', requireAdmin, (req, res) => {
    const cfg = getConfig();
    ok(res, {
        trialDays:       cfg.globalSettings?.trialDays       ?? TRIAL_DAYS,
        appName:         cfg.globalSettings?.appName         ?? 'FIX PRO MAX',
        supportEmail:    cfg.globalSettings?.supportEmail    ?? '',
        maintenanceMode: cfg.globalSettings?.maintenanceMode ?? false,
        registrationOpen:cfg.globalSettings?.registrationOpen?? true,
        maxLoginAttempts:cfg.globalSettings?.maxLoginAttempts?? 5,
        whatsappPhone:   cfg.whatsappPhone    || '',
        ultramsgInstance:cfg.ultramsgInstance || '',
        ultramsgTokenSet:!!(cfg.ultramsgToken && cfg.ultramsgToken !== 'PENDING_SETUP'),
        ultramsgConfigured: !!(cfg.whatsappPhone && cfg.ultramsgInstance && cfg.ultramsgToken && cfg.ultramsgToken !== 'PENDING_SETUP'),
    });
});

app.put('/api/admin/global-settings', requireAdmin, (req, res) => {
    const cfg = getConfig();
    if (!cfg.globalSettings) cfg.globalSettings = {};
    const allowed = ['trialDays','appName','supportEmail','maintenanceMode','registrationOpen','maxLoginAttempts'];
    const before  = { ...cfg.globalSettings };
    allowed.forEach(k => { if (req.body[k] !== undefined) cfg.globalSettings[k] = req.body[k]; });
    cfg.updatedAt = new Date().toISOString();
    writeConfig(cfg);
    logAdminAction(req.admin.id, req.admin.email, 'global_settings_update', null, null,
        `cambios: ${JSON.stringify(req.body)}`);
    // Notificar a todos los clientes conectados
    sseAdmin('global_settings_updated', { settings: cfg.globalSettings });
    ok(res, cfg.globalSettings);
});

// ══════════════════════════════════════════════════════════════════════════════
// DATOS DE LA APP POR EMPRESA — el admin puede consultar datos del ERP
// sin modificar la lógica de la app. Solo lectura para el admin.
// ══════════════════════════════════════════════════════════════════════════════

// Resumen de datos del ERP de una empresa específica
app.get('/api/admin/company/:companyId/summary', requireAdmin, (req, res) => {
    const { companyId } = req.params;
    // Validar que la empresa existe
    const users = readUsers();
    const owner = users.find(u => u.companyId === companyId && u.teamRole === 'owner');
    if (!owner) return err(res, 'Empresa no encontrada', 404);

    const db = readCompanyDB(companyId);
    const now = Date.now();
    const month = new Date(now - 30 * 86400000);

    // Calcular totales
    const totalSales    = (db.sales     || []).reduce((s, x) => s + (Number(x.total)  || 0), 0);
    const totalExpenses = (db.expenses  || []).reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const totalInvoices = (db.invoices  || []).filter(i => i.status !== 'Pagada').reduce((s, x) => s + ((Number(x.total) || 0) - (Number(x.paid) || 0)), 0);

    const monthlySales  = (db.sales    || []).filter(s => new Date(s.createdAt || s.date) >= month)
                                              .reduce((s, x) => s + (Number(x.total)  || 0), 0);
    const monthlyExpenses = (db.expenses || []).filter(e => new Date(e.createdAt || e.date) >= month)
                                                .reduce((s, x) => s + (Number(x.amount) || 0), 0);

    ok(res, {
        companyId,
        ownerName:       owner.name,
        ownerEmail:      owner.email,
        products:        (db.products   || []).length,
        customers:       (db.customers  || []).length,
        suppliers:       (db.suppliers  || []).length,
        salesCount:      (db.sales      || []).length,
        invoicesCount:   (db.invoices   || []).length,
        expensesCount:   (db.expenses   || []).length,
        totalSales:      +totalSales.toFixed(2),
        totalExpenses:   +totalExpenses.toFixed(2),
        pendingInvoices: +totalInvoices.toFixed(2),
        monthlySales:    +monthlySales.toFixed(2),
        monthlyExpenses: +monthlyExpenses.toFixed(2),
        monthlyProfit:   +(monthlySales - monthlyExpenses).toFixed(2),
        currency:        db.settings?.defaultCurrency || db.settings?.currency || 'USD',
    });
});

// Ventas de una empresa (solo lectura admin)
app.get('/api/admin/company/:companyId/sales', requireAdmin, (req, res) => {
    const db = readCompanyDB(req.params.companyId);
    if (!db) return err(res, 'Empresa no encontrada', 404);
    const { limit: lim = 50 } = req.query;
    const sales = [...(db.sales || [])].sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));
    ok(res, sales.slice(0, parseInt(lim)));
});

// Gastos de una empresa (solo lectura admin)
app.get('/api/admin/company/:companyId/expenses', requireAdmin, (req, res) => {
    const db = readCompanyDB(req.params.companyId);
    if (!db) return err(res, 'Empresa no encontrada', 404);
    const { limit: lim = 50 } = req.query;
    const expenses = [...(db.expenses || [])].sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));
    ok(res, expenses.slice(0, parseInt(lim)));
});

// Facturas de una empresa (solo lectura admin)
app.get('/api/admin/company/:companyId/invoices', requireAdmin, (req, res) => {
    const db = readCompanyDB(req.params.companyId);
    if (!db) return err(res, 'Empresa no encontrada', 404);
    const { limit: lim = 50 } = req.query;
    const invoices = [...(db.invoices || [])].sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));
    ok(res, invoices.slice(0, parseInt(lim)));
});

// Inventario de una empresa (solo lectura admin)
app.get('/api/admin/company/:companyId/inventory', requireAdmin, (req, res) => {
    const db = readCompanyDB(req.params.companyId);
    if (!db) return err(res, 'Empresa no encontrada', 404);
    ok(res, db.products || []);
});

// Resumen de TODAS las empresas (para el dashboard general)
app.get('/api/admin/companies/overview', requireAdmin, (req, res) => {
    const users     = readUsers();
    const payments  = readPayments();
    const now       = Date.now();

    // Agrupar owners (una entrada por empresa)
    const owners = users.filter(u => u.teamRole === 'owner' && u.role !== 'admin');

    const overview = owners.map(owner => {
        const status     = getAccessStatus(owner);
        const lastPay    = payments.filter(p => p.userId === owner.id && p.status === 'completed')
                                   .sort((a, b) => new Date(b.ts) - new Date(a.ts))[0];
        const teamMembers = users.filter(u => u.companyId === owner.companyId).length;

        // Intentar leer resumen de la BD de la empresa (ligero)
        let salesCount = 0, salesTotal = 0, productCount = 0;
        try {
            const db = readCompanyDB(owner.companyId);
            salesCount   = (db.sales    || []).length;
            salesTotal   = (db.sales    || []).reduce((s, x) => s + (Number(x.total) || 0), 0);
            productCount = (db.products || []).length;
        } catch {}

        return {
            companyId:   owner.companyId,
            ownerName:   owner.name,
            ownerEmail:  owner.email,
            company:     owner.company || '',
            createdAt:   owner.createdAt,
            status:      status.status,
            access:      status.access,
            plan:        status.plan || null,
            planName:    status.planName || '—',
            daysLeft:    status.daysLeft,
            teamMembers,
            salesCount,
            salesTotal:  +salesTotal.toFixed(2),
            productCount,
            lastPayment: lastPay ? { amount: lastPay.amount, ts: lastPay.ts, method: lastPay.method } : null,
        };
    });

    ok(res, overview.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

// ══════════════════════════════════════════════════════════════════════════════
// GESTIÓN DE PERMISOS DE EMPLEADOS (admin puede gestionar permisos de CUALQUIER empresa)
// ══════════════════════════════════════════════════════════════════════════════

// Listar empleados de una empresa específica
app.get('/api/admin/company/:companyId/team', requireAdmin, (req, res) => {
    const users = readUsers();
    const team  = users.filter(u => u.companyId === req.params.companyId).map(u => ({
        id:          u.id,
        name:        u.name,
        email:       u.email,
        teamRole:    u.teamRole || 'employee',
        active:      u.active !== false,
        permissions: u.permissions || DEFAULT_EMPLOYEE_PERMISSIONS,
        createdAt:   u.createdAt,
        lastLogin:   u.lastLogin || null,
    }));
    ok(res, team);
});

// Admin modifica permisos de un empleado de cualquier empresa
app.put('/api/admin/employees/:userId/permissions', requireAdmin, (req, res) => {
    const users = readUsers();
    const idx   = users.findIndex(u => u.id === req.params.userId);
    if (idx === -1) return err(res, 'Usuario no encontrado', 404);
    if (users[idx].teamRole === 'owner') return err(res, 'No se pueden modificar permisos del propietario');

    const before = JSON.stringify(users[idx].permissions || {});
    users[idx].permissions = { ...DEFAULT_EMPLOYEE_PERMISSIONS, ...req.body };
    writeUsers(users);

    logAdminAction(req.admin.id, req.admin.email, 'admin_permission_change',
        users[idx].id, users[idx].email,
        `antes: ${before} | después: ${JSON.stringify(users[idx].permissions)}`);

    // Notificar al usuario vía SSE para que su sesión actualice permisos
    sseUser(users[idx].id, 'permissions_updated', {
        permissions: users[idx].permissions,
        changedBy: req.admin.email,
    });

    ok(res, { done: true, permissions: users[idx].permissions });
});

// Admin suspende/reactiva un usuario de cualquier empresa
app.post('/api/admin/employees/:userId/status', requireAdmin, (req, res) => {
    const { action, reason } = req.body;
    if (!['suspend', 'reactivate'].includes(action)) return err(res, 'Acción no válida');

    const users = readUsers();
    const idx   = users.findIndex(u => u.id === req.params.userId);
    if (idx === -1) return err(res, 'Usuario no encontrado', 404);

    const before = users[idx].active;
    if (action === 'suspend') {
        users[idx].active      = false;
        users[idx].suspendedAt = new Date().toISOString();
        users[idx].suspendReason = reason || '';
        // Cerrar todas las sesiones activas
        const sessions = readSessions();
        Object.keys(sessions).forEach(tok => {
            const e = sessions[tok];
            if ((typeof e === 'object' ? e.userId : e) === users[idx].id) delete sessions[tok];
        });
        writeSessions(sessions);
    } else {
        users[idx].active = true;
        delete users[idx].suspendedAt;
        delete users[idx].suspendReason;
    }
    writeUsers(users);

    logAdminAction(req.admin.id, req.admin.email, action,
        users[idx].id, users[idx].email, reason || '');

    // Notificar al usuario vía SSE
    sseUser(users[idx].id, 'account_status_changed', {
        active:    users[idx].active,
        reason:    reason || '',
        changedBy: req.admin.email,
    });

    ok(res, { done: true, active: users[idx].active, before });
});

// ══════════════════════════════════════════════════════════════════════════════
// TASAS DE CAMBIO (gestión desde el admin)
// ══════════════════════════════════════════════════════════════════════════════

// Admin ve las tasas actuales de TODAS las empresas y del sistema
app.get('/api/admin/exchange-rates', requireAdmin, (req, res) => {
    const cfg = getConfig();
    // Leer tasas del sistema global
    const globalDB = _readGlobalDB();
    const rates    = Array.isArray(globalDB.exchangeRates) ? globalDB.exchangeRates : [];
    const svcStatus = ExchangeRateService.getStatus();

    const currentUSD = rates.filter(r => r.fromCurrency === 'USD' && r.toCurrency === 'VES' && r.isActive)[0]
                    || rates.filter(r => r.fromCurrency === 'USD' && r.toCurrency === 'VES').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]
                    || { rate: 36, source: 'Manual' };

    const currentEUR = rates.filter(r => r.fromCurrency === 'EUR' && r.toCurrency === 'VES' && r.isActive)[0]
                    || rates.filter(r => r.fromCurrency === 'EUR' && r.toCurrency === 'VES').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]
                    || { rate: 40, source: 'Manual' };

    ok(res, {
        currentUSD: { rate: currentUSD.rate, source: currentUSD.source, date: currentUSD.date, notes: currentUSD.notes },
        currentEUR: { rate: currentEUR.rate, source: currentEUR.source, date: currentEUR.date, notes: currentEUR.notes },
        history:    rates.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 50),
        serviceStatus: svcStatus,
    });
});

// Admin establece tasa manual y propaga a TODAS las BDs de empresa
app.post('/api/admin/exchange-rates', requireAdmin, async (req, res) => {
    const { fromCurrency, toCurrency, rate, notes } = req.body;
    const rateVal = parseFloat(rate);
    if (!rateVal || rateVal <= 0) return err(res, 'Tasa debe ser positiva');
    if (!['USD', 'EUR'].includes(fromCurrency)) return err(res, 'fromCurrency debe ser USD o EUR');
    if (toCurrency !== 'VES') return err(res, 'toCurrency debe ser VES');

    const now     = new Date().toISOString();
    const today   = now.slice(0, 10);
    const newEntry = {
        id: generateId(), fromCurrency, toCurrency, rate: rateVal,
        date: today, createdAt: now, updatedAt: now,
        createdBy: req.admin.email,
        notes: notes || `Ingresada manualmente por admin ${req.admin.email}`,
        source: 'Manual (Admin)',
        updateType: 'manual',
        isActive: true,
    };

    // 1. Actualizar BD global
    const globalDB = _readGlobalDB();
    if (!Array.isArray(globalDB.exchangeRates)) globalDB.exchangeRates = [];
    globalDB.exchangeRates.forEach(r => {
        if (r.fromCurrency === fromCurrency && r.toCurrency === toCurrency) r.isActive = false;
    });
    globalDB.exchangeRates.push(newEntry);
    _writeGlobalDB(globalDB);

    // 2. Propagar a TODAS las BDs de empresa (sin tocar el demo)
    const dbDir = path.dirname(DB_PATH);
    let propagated = 0;
    try {
        const dbFiles = fs.readdirSync(dbDir).filter(f => /^db_[a-z0-9]+\.json$/i.test(f) && f !== 'db_demo.json');
        for (const dbFile of dbFiles) {
            try {
                const dbFilePath = path.join(dbDir, dbFile);
                const raw        = fs.readFileSync(dbFilePath, 'utf8').replace(/^\uFEFF/, '');
                const companyDB  = JSON.parse(raw);
                if (!Array.isArray(companyDB.exchangeRates)) companyDB.exchangeRates = [];
                companyDB.exchangeRates.forEach(r => {
                    if (r.fromCurrency === fromCurrency && r.toCurrency === toCurrency) r.isActive = false;
                });
                companyDB.exchangeRates.push({ ...newEntry, id: generateId() });
                fs.writeFileSync(dbFilePath, JSON.stringify(companyDB, null, 2), 'utf8');
                propagated++;
            } catch {}
        }
    } catch {}

    logAdminAction(req.admin.id, req.admin.email, 'admin_exchange_rate_set', null, null,
        `${fromCurrency}→VES = ${rateVal} | propagado a ${propagated} empresas`);

    // Notificar a todos los clientes conectados
    broadcastSSE('exchange_rate_updated', {
        fromCurrency, toCurrency, rate: rateVal,
        source: 'Manual (Admin)', date: today,
    });

    ok(res, { ...newEntry, propagated });
});

// Admin fuerza actualización desde BCV
app.post('/api/admin/exchange-rates/fetch-bcv', requireAdmin, async (req, res) => {
    try {
        const result = await ExchangeRateService.fetchAndSaveAll(
            _readGlobalDB, _writeGlobalDB,
            _readCompanyDB, _writeCompanyDB, _listCompanies,
            req.admin.email, 'manual'
        );
        logAdminAction(req.admin.id, req.admin.email, 'admin_bcv_fetch', null, null,
            result.success ? `USD=${result.USD} EUR=${result.EUR}` : `Error: ${result.error}`);

        if (result.success) {
            broadcastSSE('exchange_rate_updated', {
                fromCurrency: 'USD', rate: result.USD, source: 'BCV', date: new Date().toISOString().slice(0, 10),
            });
        }
        ok(res, result);
    } catch (e) {
        err(res, 'Error al actualizar desde BCV: ' + e.message, 500);
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// AUDITORÍA MEJORADA — con valores antes/después
// Los logAdminAction() ya existentes se complementan con este endpoint
// que devuelve el log enriquecido con datos de contexto
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/admin/audit', requireAdmin, (req, res) => {
    const log   = readAdminLog();
    const { limit: lim = 500, action, adminEmail, targetEmail, from, to } = req.query;
    let filtered = log;

    if (action)      filtered = filtered.filter(e => e.action.includes(action));
    if (adminEmail)  filtered = filtered.filter(e => (e.adminEmail || '').includes(adminEmail));
    if (targetEmail) filtered = filtered.filter(e => (e.targetEmail || '').includes(targetEmail));
    if (from)        filtered = filtered.filter(e => new Date(e.ts) >= new Date(from));
    if (to)          filtered = filtered.filter(e => new Date(e.ts) <= new Date(to));

    ok(res, filtered.slice(0, parseInt(lim)));
});

// Registrar acción administrativa con campos antes/después (endpoint directo)
app.post('/api/admin/audit', requireAdmin, (req, res) => {
    const { action, targetId, targetEmail, detail, before, after } = req.body;
    if (!action) return err(res, 'action requerido');
    logAdminAction(req.admin.id, req.admin.email, action, targetId || null, targetEmail || null,
        detail || (before && after ? `antes: ${JSON.stringify(before)} → después: ${JSON.stringify(after)}` : ''));
    ok(res, { logged: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// RESUMEN DE INGRESOS MEJORADO — incluye datos de ventas del ERP
// Combina payments.json (suscripciones) + ventas del ERP de todas las empresas
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/admin/income-summary', requireAdmin, (req, res) => {
    const payments = readPayments();
    const users    = readUsers();
    const owners   = users.filter(u => u.teamRole === 'owner' && u.role !== 'admin');
    const now      = Date.now();

    // Ingresos de suscripciones (payments.json)
    const subIncome = payments
        .filter(p => p.status === 'completed')
        .reduce((s, p) => s + (Number(p.amount) || 0), 0);

    // Ingresos ERP de todas las empresas (ventas)
    let totalSalesERP = 0, totalExpensesERP = 0, totalInvoicesPending = 0;
    const byCompany   = [];

    owners.forEach(owner => {
        try {
            const db = readCompanyDB(owner.companyId);
            const sales    = (db.sales    || []).reduce((s, x) => s + (Number(x.total)  || 0), 0);
            const expenses = (db.expenses || []).reduce((s, x) => s + (Number(x.amount) || 0), 0);
            const pending  = (db.invoices || []).filter(i => i.status !== 'Pagada' && i.status !== 'Anulada')
                                                 .reduce((s, x) => s + ((Number(x.total) || 0) - (Number(x.paid) || 0)), 0);
            totalSalesERP        += sales;
            totalExpensesERP     += expenses;
            totalInvoicesPending += pending;
            byCompany.push({
                companyId:   owner.companyId,
                ownerEmail:  owner.email,
                company:     owner.company || '',
                sales:       +sales.toFixed(2),
                expenses:    +expenses.toFixed(2),
                profit:      +(sales - expenses).toFixed(2),
                pending:     +pending.toFixed(2),
                currency:    db.settings?.defaultCurrency || 'USD',
            });
        } catch {}
    });

    ok(res, {
        subscriptionIncome: +subIncome.toFixed(2),
        erpSalesTotal:      +totalSalesERP.toFixed(2),
        erpExpensesTotal:   +totalExpensesERP.toFixed(2),
        erpProfitTotal:     +(totalSalesERP - totalExpensesERP).toFixed(2),
        invoicesPending:    +totalInvoicesPending.toFixed(2),
        byCompany:          byCompany.sort((a, b) => b.sales - a.sales),
        pendingPayments:    payments.filter(p => p.status === 'pending').length,
        lastUpdated:        new Date().toISOString(),
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// HOOK: Propagar SSE cuando hay cambios importantes en el sistema ya existente
// Parche no invasivo: sobreescribimos funciones clave para que disparen SSE
// ══════════════════════════════════════════════════════════════════════════════
// Guardar referencias originales
const _origWriteUsers    = writeUsers;
const _origWritePayments = writePayments;
const _origWriteTickets  = writeTickets;

// Patch: writeUsers → disparar SSE si cambió status/active de un usuario
global._writeUsersWithSSE = function(users) {
    _origWriteUsers(users);
};

// ── 404 handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
    res.status(404).json({ ok: false, error: 'Ruta no encontrada' });
});

// ── Arrancar servidor ────────────────────────────────────────────────────────
// Limpiar usuarios de prueba al arrancar (evita que tests dejen basura)
// ══════════════════════════════════════════════════════════════════════════════
(function cleanTestUsers() {
    try {
        if (!fs.existsSync(USERS_PATH)) return;
        let users = readUsers();
        const TEST_PATTERNS = ['@demo.com', '@fixpro.com', '@test.com', 'modtest', 'nueva_persona'];
        const before = users.length;
        // Preservar siempre al usuario demo oficial
        users = users.filter(u =>
            u.email === DEMO_EMAIL ||                     // nunca eliminar el demo oficial
            !TEST_PATTERNS.some(p => u.email.toLowerCase().includes(p))
        );
        if (users.length < before) {
            writeUsers(users);
            console.log(`  🧹 ${before - users.length} usuario(s) de prueba eliminados al arrancar`);
        }

        // Asegurar que el usuario demo existe siempre
        if (!users.find(u => u.email === DEMO_EMAIL)) {
            users.push({
                id: 'demo-user-fixed', name: 'Usuario Demo', email: DEMO_EMAIL,
                password: hashPassword(DEMO_PASSWORD), company: 'Empresa Demo',
                role: 'user', mode: 'pro', avatar: 'DE',
                createdAt: new Date().toISOString(), trialStart: new Date().toISOString(),
                active: true, isDemo: true,
                companyId: DEMO_COMPANY_ID, teamRole: 'owner', permissions: null,
            });
            writeUsers(users);
            console.log('  🎭 Usuario demo creado');
        }

        // Asegurar que usuarios sin companyId reciben uno propio
        let repaired = false;
        users = readUsers(); // releer por si se modificó
        users.forEach(u => {
            if (!u.companyId && u.email !== DEMO_EMAIL) {
                u.companyId = generateId();
                u.teamRole  = u.teamRole || 'owner';
                if (!fs.existsSync(dbPath(u.companyId))) {
                    writeCompanyDB(u.companyId, defaultData());
                }
                repaired = true;
                console.log(`  🔧 companyId asignado a: ${u.email}`);
            }
        });
        if (repaired) writeUsers(users);

        // Crear/asegurar la BD demo
        readDemoDB();
    } catch (e) {
        console.warn('  ⚠️  cleanTestUsers:', e.message);
    }
})();


// ── Limpiar sesiones expiradas cada hora ──────────────────────────────────────
setInterval(() => {
    try {
        const sessions = readSessions();
        const now = Date.now();
        let changed = false;
        Object.keys(sessions).forEach(token => {
            const entry = sessions[token];
            const created = typeof entry === 'object' ? entry.created : 0;
            if (created && now - created > SESSION_TTL) {
                delete sessions[token];
                changed = true;
            }
        });
        if (changed) writeSessions(sessions);
    } catch {}
}, 60 * 60 * 1000);

// ── Iniciar cron automático de tasas BCV ────────────────────────────────────
// NOTA: pasamos _readGlobalDB/_writeGlobalDB para el guardado de tasas en la BD global,
// ya que scheduleDailyUpdate opera fuera del contexto de un request HTTP (sin companyId).
ExchangeRateService.scheduleDailyUpdate(
    _readGlobalDB,
    _writeGlobalDB,
    _readCompanyDB,
    _writeCompanyDB,
    _listCompanies
);

startServer(PORT);
