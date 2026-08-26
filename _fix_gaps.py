#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
_fix_gaps.py — aplica los 7 gaps críticos de conexión Admin↔App en server.js
"""
import re

FILE = r'c:\Users\USUARIO\Downloads\Nueva carpeta (2)\server.js'

with open(FILE, 'r', encoding='utf-8') as f:
    content = f.read()

fixes = 0

# ══════════════════════════════════════════════════════════════════════════════
# GAP 1 — TRIAL_DAYS: constante hardcodeada → función dinámica que lee config
# ══════════════════════════════════════════════════════════════════════════════
old_trial = 'const TRIAL_DAYS = 3;'
new_trial = '''\
// TRIAL_DAYS es una función async para leer de config en tiempo real.
// Si el admin cambia los días de prueba, el cambio se aplica de inmediato.
// Para backward-compat, también se mantiene el valor default 3 en la constante.
const _TRIAL_DAYS_DEFAULT = 3;
async function getTrialDays() {
    try {
        const cfg = await getConfig();
        return (cfg && cfg.trialDays > 0) ? Number(cfg.trialDays) : _TRIAL_DAYS_DEFAULT;
    } catch { return _TRIAL_DAYS_DEFAULT; }
}'''
if old_trial in content:
    content = content.replace(old_trial, new_trial, 1)
    fixes += 1
    print('GAP 1 OK: TRIAL_DAYS convertido a función async getTrialDays()')
else:
    print('GAP 1 SKIP: patron no encontrado')

# getAccessStatus usa TRIAL_DAYS directamente — reemplazar todos los usos
# dentro de la función por await getTrialDays() — pero getAccessStatus es síncrona.
# Solución: hacer getAccessStatus async y await getTrialDays().
# Primero localizamos la firma y el cuerpo completo.
old_gas_sig = 'function getAccessStatus(user) {'
new_gas_sig = 'async function getAccessStatus(user) {'
if old_gas_sig in content:
    content = content.replace(old_gas_sig, new_gas_sig, 1)
    fixes += 1
    print('GAP 1b OK: getAccessStatus convertida a async')
else:
    print('GAP 1b SKIP')

# Reemplazar el uso de TRIAL_DAYS dentro de getAccessStatus
old_trial_use1 = '        const trialEnd = new Date(trialBase).getTime() + TRIAL_DAYS * 86400000;'
new_trial_use1 = '        const _td = await getTrialDays();\n        const trialEnd = new Date(trialBase).getTime() + _td * 86400000;'
if old_trial_use1 in content:
    content = content.replace(old_trial_use1, new_trial_use1, 1)
    fixes += 1
    print('GAP 1c OK: uso de TRIAL_DAYS dentro de getAccessStatus reemplazado')
else:
    print('GAP 1c SKIP')

# grant_access también usa TRIAL_DAYS — reemplazar
old_grant = '        target.trialStart = new Date(Date.now() - (TRIAL_DAYS - 7) * 86400000).toISOString();'
new_grant = '        const _tdg = await getTrialDays();\n        target.trialStart = new Date(Date.now() - (_tdg - 7) * 86400000).toISOString();'
if old_grant in content:
    content = content.replace(old_grant, new_grant, 1)
    fixes += 1
    print('GAP 1d OK: grant_access usa getTrialDays()')
else:
    print('GAP 1d SKIP: ', old_grant[:60])

# Todos los demás usos de TRIAL_DAYS en el archivo (stats handler, etc.)
# que NO fueron reemplazados aún
remaining = content.count('TRIAL_DAYS')
if remaining > 0:
    content = re.sub(r'\bTRIAL_DAYS\b', '_TRIAL_DAYS_DEFAULT', content)
    fixes += 1
    print(f'GAP 1e OK: {remaining} usos restantes de TRIAL_DAYS → _TRIAL_DAYS_DEFAULT')

# ══════════════════════════════════════════════════════════════════════════════
# GAP 2 — maintenanceMode: bloquear /api/* cuando está activo (excepto admin)
# Insertar middleware justo después de que CORS/JSON ya están configurados,
# antes del middleware global de suscripción.
# ══════════════════════════════════════════════════════════════════════════════
maintenance_middleware = '''
// ══ MIDDLEWARE: Modo Mantenimiento ══════════════════════════════════════════
// Si el admin activa maintenanceMode, bloquea TODOS los endpoints /api/*
// excepto /api/auth/login, /api/admin/* y /api/ping.
// Así el admin puede seguir operando mientras los usuarios están bloqueados.
app.use('/api', async (req, res, next) => {
    const p = req.path;
    // Rutas siempre permitidas aunque haya mantenimiento
    const exempt = ['/auth/login', '/auth/register', '/ping', '/admin'];
    if (exempt.some(e => p === e || p.startsWith(e + '/'))) return next();
    try {
        const cfg = await getConfig();
        if (cfg && cfg.maintenanceMode === true) {
            // Admins pueden pasar siempre
            const header = req.headers['authorization'] || '';
            const token  = header.replace('Bearer ', '').trim();
            if (token) {
                const sessions = await readSessions();
                const entry    = sessions[token];
                const userId   = entry ? (typeof entry === 'object' ? entry.userId : entry) : null;
                if (userId) {
                    const users = await readUsers();
                    const user  = users.find(u => u.id === userId);
                    if (user && user.role === 'admin') return next();
                }
            }
            return res.status(503).json({
                ok: false,
                error: 'Sistema en mantenimiento. Volveremos pronto. Disculpa las molestias.',
                code:  'MAINTENANCE_MODE',
            });
        }
    } catch { /* si falla la lectura de config, dejar pasar */ }
    next();
});

'''

# Insertar DESPUÉS de app.use(express.json...) y app.use(express.urlencoded...)
# Buscamos el bloque de middlewares básicos
anchor = "app.use('/api', async (req, res, next) => {\n    const exemptPrefixes"
if maintenance_middleware.strip()[:50] not in content and anchor in content:
    content = content.replace(anchor, maintenance_middleware + anchor, 1)
    fixes += 1
    print('GAP 2 OK: middleware maintenanceMode insertado')
else:
    print('GAP 2 SKIP: ya existe o anchor no encontrado')

# ══════════════════════════════════════════════════════════════════════════════
# GAP 3 — registrationOpen: bloquear /api/auth/register cuando está desactivado
# ══════════════════════════════════════════════════════════════════════════════
old_register_start = "app.post('/api/auth/register', async (req, res) => {\n    const { name, email, password, company } = req.body;"
new_register_start = """\
app.post('/api/auth/register', async (req, res) => {
    // Verificar si el registro está abierto (configurable desde el panel admin)
    try {
        const cfg = await getConfig();
        if (cfg && cfg.registrationOpen === false) {
            return res.status(403).json({
                ok: false,
                error: 'El registro de nuevos usuarios está temporalmente desactivado.',
                code:  'REGISTRATION_CLOSED',
            });
        }
    } catch { /* si falla la lectura de config, permitir registro */ }

    const { name, email, password, company } = req.body;\
"""
if old_register_start in content:
    content = content.replace(old_register_start, new_register_start, 1)
    fixes += 1
    print('GAP 3 OK: registrationOpen aplicado en /api/auth/register')
else:
    print('GAP 3 SKIP: patron no encontrado')

# ══════════════════════════════════════════════════════════════════════════════
# GAP 4 — requirePermission: extender a inventory/sales/expenses/invoices/etc.
# Ya existe la función requirePermission — lo que falta es aplicarla en los
# endpoints principales de la app. Pero modificar cada endpoint individual
# rompería la compatibilidad con owners que no tienen el objeto permissions.
# Solución correcta: ampliar requirePermission para que sea más robusta,
# y agregar un middleware de permisos de empleado global que valide
# operaciones de escritura (POST/PUT/DELETE) sobre módulos críticos.
# ══════════════════════════════════════════════════════════════════════════════
old_req_perm = '''\
// Middleware de permisos: verifica que el empleado tenga acceso a un módulo/acción
function requirePermission(module, action) {
    return async (req, res, next) => {
        const u = req.user;
        if (!u) return res.status(401).json({ ok: false, error: 'No autenticado' });
        if (u.teamRole === 'owner' || u.role === 'admin') { next(); return; }
        const users = await readUsers();
        const full  = users.find(x => x.id === u.id);
        const perms = full?.permissions?.[module];
        if (!perms || !perms[action]) {
            return res.status(403).json({ ok: false, error: `Sin permiso para: ${module}.${action}` });
        }
        next();
    };
}'''
new_req_perm = '''\
// Middleware de permisos: verifica que el empleado tenga acceso a un módulo/acción
// Owners y admins siempre pasan. Si el empleado no tiene permissions definidos
// se aplican los DEFAULT_EMPLOYEE_PERMISSIONS.
function requirePermission(module, action) {
    return async (req, res, next) => {
        const u = req.user;
        if (!u) return res.status(401).json({ ok: false, error: 'No autenticado' });
        if (u.teamRole === 'owner' || u.role === 'admin') { next(); return; }
        const users = await readUsers();
        const full  = users.find(x => x.id === u.id);
        // Si el usuario fue suspendido después de hacer login, bloquearlo
        if (full && full.active === false) {
            return res.status(403).json({ ok: false, error: 'Tu cuenta fue suspendida. Contacta al administrador.', code: 'ACCOUNT_SUSPENDED' });
        }
        // Leer permisos: los del usuario o los DEFAULT si no tiene personalizados
        const perms = full?.permissions?.[module] || DEFAULT_EMPLOYEE_PERMISSIONS[module];
        if (!perms || !perms[action]) {
            return res.status(403).json({ ok: false, error: `Sin permiso para: ${module}.${action}`, code: 'PERMISSION_DENIED', module, action });
        }
        next();
    };
}

// Middleware de escritura de empleado: valida permisos para POST/PUT/DELETE
// en los módulos críticos de la app. Se aplica globalmente sobre /api/*
// para que cualquier intento de escritura sin permiso sea rechazado en backend.
const WRITE_PERMISSION_MAP = {
    '/api/products':           { module: 'inventory',  actions: { POST: 'create', PUT: 'edit', DELETE: 'delete' } },
    '/api/sales':              { module: 'sales',      actions: { POST: 'create', PUT: 'edit', DELETE: 'cancel' } },
    '/api/invoices':           { module: 'invoices',   actions: { POST: 'create', PUT: 'edit', DELETE: 'cancel' } },
    '/api/expenses':           { module: 'expenses',   actions: { POST: 'create', PUT: 'edit', DELETE: 'delete' } },
    '/api/customers':          { module: 'customers',  actions: { POST: 'create', PUT: 'edit', DELETE: 'delete' } },
    '/api/suppliers':          { module: 'suppliers',  actions: { POST: 'create', PUT: 'edit', DELETE: 'delete' } },
    '/api/purchases':          { module: 'purchases',  actions: { POST: 'create', PUT: 'edit', DELETE: 'delete' } },
    '/api/account-movements':  { module: 'receivables',actions: { POST: 'create', PUT: 'edit', DELETE: 'delete' } },
    '/api/categories':         { module: 'inventory',  actions: { POST: 'create', PUT: 'edit', DELETE: 'delete' } },
    '/api/warehouses':         { module: 'inventory',  actions: { POST: 'create', PUT: 'edit', DELETE: 'delete' } },
    '/api/journal':            { module: 'accounting', actions: { POST: 'create', PUT: 'edit', DELETE: 'delete' } },
};

function employeeWriteGuard(req, res, next) {
    // Solo aplicar en métodos de escritura
    if (!['POST','PUT','DELETE','PATCH'].includes(req.method)) return next();
    const u = req.user;
    if (!u) return next();  // requireAuth ya lo bloqueó si no hay usuario
    if (u.teamRole === 'owner' || u.role === 'admin') return next();
    // Buscar si la ruta coincide con alguna entrada del mapa
    const base = req.path.replace(/\/[^/]+$/, '') || req.path; // quitar :id del final
    const rule  = WRITE_PERMISSION_MAP[req.path] || WRITE_PERMISSION_MAP[base];
    if (!rule) return next();  // ruta no mapeada, dejar pasar
    const action = rule.actions[req.method];
    if (!action) return next();
    // Validar permiso
    readUsers().then(users => {
        const full  = users.find(x => x.id === u.id);
        if (full && full.active === false) {
            return res.status(403).json({ ok: false, error: 'Tu cuenta fue suspendida.', code: 'ACCOUNT_SUSPENDED' });
        }
        const perms = full?.permissions?.[rule.module] || DEFAULT_EMPLOYEE_PERMISSIONS[rule.module];
        if (!perms || !perms[action]) {
            return res.status(403).json({ ok: false, error: `Sin permiso para: ${rule.module}.${action}`, code: 'PERMISSION_DENIED', module: rule.module, action });
        }
        next();
    }).catch(() => next());
}'''
if old_req_perm in content:
    content = content.replace(old_req_perm, new_req_perm, 1)
    fixes += 1
    print('GAP 4 OK: requirePermission mejorado + employeeWriteGuard global añadido')
else:
    print('GAP 4 SKIP: patron requirePermission no encontrado exactamente')

# Aplicar employeeWriteGuard en el middleware global de la app
# Se agrega DESPUÉS del middleware global de suscripción (que ya existe)
old_sub_middleware_end = "    // FIX CRÍTICO: inyectar companyId en AsyncLocalStorage para que readDB()/writeDB()"
new_sub_middleware_end = """\
    // FIX CRÍTICO: inyectar companyId en AsyncLocalStorage para que readDB()/writeDB()
"""
# Agregar employeeWriteGuard después del bloque de middleware de suscripción
guard_anchor = "app.use('/api', requireAuth"
# Buscar dónde va app.use para employeeWriteGuard — después del middleware de suscripción
guard_insert = "\n// ── Validación de permisos de empleado en escritura (backend enforcement) ──\napp.use('/api', requireAuth, employeeWriteGuard);\n"
# Buscar el anchor exacto que viene después del bloque de suscripción global
anchor2 = "// ❌\"€❌\"€ RUTA RAÁZ"
if 'employeeWriteGuard' not in content and anchor2 in content:
    content = content.replace(anchor2, guard_insert + anchor2, 1)
    fixes += 1
    print('GAP 4b OK: employeeWriteGuard registrado como middleware global')
else:
    print('GAP 4b SKIP')

# ══════════════════════════════════════════════════════════════════════════════
# GAP 5 — applyPlansOverrides: asegurar que planes nuevos se persisten y
#          que al crear/actualizar un plan se guarda en plansOverride
# ══════════════════════════════════════════════════════════════════════════════
old_apply = '''\
async function applyPlansOverrides() {
    const cfg = await getConfig();
    const overrides = cfg.plansOverride || {};
    Object.keys(overrides).forEach(planId => {
        if (PLANS[planId]) {
            Object.assign(PLANS[planId], overrides[planId]);
        }
    });
}'''
new_apply = '''\
async function applyPlansOverrides() {
    const cfg = await getConfig();
    const overrides = cfg.plansOverride || {};
    // Aplicar overrides a planes existentes
    Object.keys(overrides).forEach(planId => {
        if (PLANS[planId]) {
            Object.assign(PLANS[planId], overrides[planId]);
        } else {
            // Plan nuevo creado por el admin que no existe en los defaults:
            // reconstruirlo completamente desde el override
            const p = overrides[planId];
            if (p && p.id && p.name) {
                PLANS[planId] = Object.assign({
                    id: planId, active: true, order: 99,
                    modules: { pos:true, sales:true, invoices:true, products:true,
                               inventory:true, customers:true, suppliers:true,
                               expenses:true, purchases:true, returns:true,
                               reports:true, finance:false, accounting:false,
                               payables:false, receivables:false, ai:false, team:false },
                    features: [], notIncluded: [],
                }, p);
            }
        }
    });
}'''
if old_apply in content:
    content = content.replace(old_apply, new_apply, 1)
    fixes += 1
    print('GAP 5 OK: applyPlansOverrides reconstruye planes nuevos del admin')
else:
    print('GAP 5 SKIP: patron no encontrado')

# ══════════════════════════════════════════════════════════════════════════════
# GAP 6 — Emitir SSE permission_updated cuando el admin cambia permisos
#          Ya existe el endpoint PUT /api/admin/employees/:empId/permissions.
#          Buscar ese handler y agregar broadcastSSE.
# ══════════════════════════════════════════════════════════════════════════════
old_perm_ok = '''\
        await writeUsers(users);
        await logAdminAction(req.admin.id, req.admin.email, 'permission', users[idx].id, users[idx].email,
            `Permisos actualizados desde panel admin`);
        ok(res, { done: true, permissions: users[idx].permissions });'''
new_perm_ok = '''\
        await writeUsers(users);
        await logAdminAction(req.admin.id, req.admin.email, 'permission', users[idx].id, users[idx].email,
            `Permisos actualizados desde panel admin`);
        // Notificar al empleado en tiempo real para que recargue sus permisos
        setImmediate(() => {
            if (typeof sseUser === 'function') {
                sseUser(users[idx].id, 'permissions_updated', {
                    permissions: users[idx].permissions,
                    updatedBy:   'admin',
                    ts:          new Date().toISOString(),
                });
            }
        });
        ok(res, { done: true, permissions: users[idx].permissions });'''
if old_perm_ok in content:
    content = content.replace(old_perm_ok, new_perm_ok, 1)
    fixes += 1
    print('GAP 6 OK: SSE permissions_updated emitido al cambiar permisos')
else:
    print('GAP 6 SKIP: anchor perm handler no encontrado')

# ══════════════════════════════════════════════════════════════════════════════
# GAP 7 — suspend emite account_status_changed pero NO invalida sesiones activas.
#          El usuario suspendido puede seguir usando el token hasta que expire.
#          Solución: al suspender, cerrar TODAS sus sesiones inmediatamente.
# ══════════════════════════════════════════════════════════════════════════════
old_suspend = '''\
    if (action === 'suspend') {
        target.active = false;
        target.suspendedAt = new Date().toISOString();
        target.suspendReason = reason || '';
    } else if (action === 'reactivate') {'''
new_suspend = '''\
    if (action === 'suspend') {
        target.active = false;
        target.suspendedAt = new Date().toISOString();
        target.suspendReason = reason || '';
        // Invalidar TODAS las sesiones activas del usuario suspendido inmediatamente
        const sessionsSusp = await readSessions();
        Object.keys(sessionsSusp).forEach(tok => {
            const e   = sessionsSusp[tok];
            const uid = typeof e === 'object' ? e.userId : e;
            if (uid === target.id) delete sessionsSusp[tok];
        });
        await writeSessions(sessionsSusp);
        // Enviar SSE de sesión revocada (el cliente lo captura y hace logout)
        setImmediate(() => {
            if (typeof sseUser === 'function') {
                sseUser(target.id, 'session_revoked', {
                    reason:    reason || 'Cuenta suspendida por el administrador',
                    action:    'suspend',
                    changedBy: 'admin',
                    ts:        new Date().toISOString(),
                });
            }
        });
    } else if (action === 'reactivate') {'''
if old_suspend in content:
    content = content.replace(old_suspend, new_suspend, 1)
    fixes += 1
    print('GAP 7 OK: suspend cierra sesiones + emite session_revoked SSE')
else:
    print('GAP 7 SKIP: patron suspend no encontrado')

# ══════════════════════════════════════════════════════════════════════════════
# BONUS: Emitir SSE config_updated cuando el admin cambia global-settings
#         para que la app principal recargue la config
# ══════════════════════════════════════════════════════════════════════════════
old_config_ok = '''\
        await writeConfig(cfg);
        await logAdminAction(req.admin.id, req.admin.email, 'global_settings', null, null,
            `trialDays=${cfg.trialDays} registrationOpen=${cfg.registrationOpen} maintenance=${cfg.maintenanceMode}`);'''
new_config_ok = '''\
        await writeConfig(cfg);
        await logAdminAction(req.admin.id, req.admin.email, 'global_settings', null, null,
            `trialDays=${cfg.trialDays} registrationOpen=${cfg.registrationOpen} maintenance=${cfg.maintenanceMode}`);
        // Notificar a todos los clientes conectados que la config global cambió
        setImmediate(() => {
            if (typeof broadcastSSE === 'function') {
                broadcastSSE('config_updated', {
                    trialDays:        cfg.trialDays,
                    maintenanceMode:  cfg.maintenanceMode,
                    registrationOpen: cfg.registrationOpen,
                    appName:          cfg.appName,
                    ts:               new Date().toISOString(),
                });
            }
        });'''
if old_config_ok in content:
    content = content.replace(old_config_ok, new_config_ok, 1)
    fixes += 1
    print('BONUS OK: SSE config_updated emitido al guardar config global')
else:
    print('BONUS SKIP: anchor config handler no encontrado')

# ══════════════════════════════════════════════════════════════════════════════
# BONUS 2: Endpoint público /api/config/global para que la app principal lea
#           trialDays, maintenanceMode, appName — fuente única de verdad
# ══════════════════════════════════════════════════════════════════════════════
bonus2_anchor = "// Iniciar servidor\nstartServer(PORT);"
bonus2_code = '''\
// ── Endpoint público: config global leída por la app principal ──────────────
// La app principal lo llama al iniciar para saber los días de trial, nombre, etc.
app.get('/api/config/global', async (req, res) => {
    try {
        const cfg = await getConfig();
        ok(res, {
            trialDays:        cfg.trialDays        ?? 3,
            appName:          cfg.appName          ?? 'FIX PRO MAX',
            maintenanceMode:  cfg.maintenanceMode  === true,
            registrationOpen: cfg.registrationOpen !== false,
        });
    } catch (e) {
        ok(res, { trialDays: 3, appName: 'FIX PRO MAX', maintenanceMode: false, registrationOpen: true });
    }
});

'''
if '/api/config/global' not in content and bonus2_anchor in content:
    content = content.replace(bonus2_anchor, bonus2_code + bonus2_anchor, 1)
    fixes += 1
    print('BONUS 2 OK: endpoint /api/config/global añadido')
else:
    print('BONUS 2 SKIP')

# ══════════════════════════════════════════════════════════════════════════════
with open(FILE, 'w', encoding='utf-8') as f:
    f.write(content)

print(f'\n✅ Total fixes aplicados: {fixes}')
print('Verificando con node --check...')
