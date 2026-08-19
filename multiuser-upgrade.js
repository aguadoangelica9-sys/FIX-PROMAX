/**
 * FIX PRO MAX - MEJORAS SISTEMA MULTIUSUARIO
 * Archivo con funciones adicionales para el sistema empresarial multiusuario
 * Integrar en server.js después de las funciones existentes
 */

// ============================================================================
// FUNCIONES DE EMPRESAS (companies.json)
// ============================================================================

const COMPANIES_PATH = path.join(__dirname, 'companies.json');
const DEVICES_PATH = path.join(__dirname, 'devices.json');

function readCompanies() {
    try {
        if (!fs.existsSync(COMPANIES_PATH)) {
            // Crear archivo inicial basado en usuarios existentes
            const companies = [];
            const users = readUsers();
            users.forEach(user => {
                if (user.teamRole === 'owner' && user.companyId) {
                    if (!companies.find(c => c.id === user.companyId)) {
                        companies.push({
                            id: user.companyId,
                            name: user.company || `Empresa ${user.companyId.slice(0, 8)}`,
                            createdAt: user.createdAt || new Date().toISOString(),
                            createdBy: user.id,
                            status: 'active',
                            subscriptionPlan: user.subscriptionPlan || null,
                            subscriptionStatus: user.subscriptionStatus || 'trial',
                            subscriptionEnd: user.subscriptionEnd || null,
                            maxUsers: 5,
                            currentUsers: 1,
                            settings: {
                                currency: 'USD',
                                language: 'es',
                                timezone: 'America/Caracas',
                                invoicePrefix: 'FIX',
                                taxRate: 16
                            },
                            contact: {
                                email: user.email,
                                phone: '',
                                address: '',
                                website: ''
                            },
                            metadata: {
                                industry: 'general',
                                size: 'small',
                                planTier: user.mode || 'basic'
                            }
                        });
                    }
                }
            });
            // Actualizar currentUsers
            companies.forEach(company => {
                const team = users.filter(u => u.companyId === company.id);
                company.currentUsers = team.length;
            });
            fs.writeFileSync(COMPANIES_PATH, JSON.stringify(companies, null, 2), 'utf8');
            return companies;
        }
        return JSON.parse(fs.readFileSync(COMPANIES_PATH, 'utf8'));
    } catch (e) {
        console.error('Error leyendo companies.json:', e.message);
        return [];
    }
}

function writeCompanies(companies) {
    try {
        fs.writeFileSync(COMPANIES_PATH, JSON.stringify(companies, null, 2), 'utf8');
    } catch (e) {
        console.error('Error escribiendo companies.json:', e.message);
        throw e;
    }
}

function updateCompanyUserCount(companyId) {
    const companies = readCompanies();
    const users = readUsers();
    const team = users.filter(u => u.companyId === companyId);
    const companyIdx = companies.findIndex(c => c.id === companyId);
    if (companyIdx !== -1) {
        companies[companyIdx].currentUsers = team.length;
        writeCompanies(companies);
    }
}

// ============================================================================
// FUNCIONES DE DISPOSITIVOS (devices.json)
// ============================================================================

function readDevices() {
    try {
        if (!fs.existsSync(DEVICES_PATH)) {
            // Crear estructura inicial basada en sesiones activas
            const defaultDevices = {
                devices: [],
                deviceSettings: {
                    maxDevicesPerUser: 3,
                    sessionTimeoutMinutes: 4320, // 3 días
                    allowConcurrentSessions: true,
                    requireDeviceVerification: false
                }
            };
            fs.writeFileSync(DEVICES_PATH, JSON.stringify(defaultDevices, null, 2), 'utf8');
            return defaultDevices;
        }
        return JSON.parse(fs.readFileSync(DEVICES_PATH, 'utf8'));
    } catch (e) {
        console.error('Error leyendo devices.json:', e.message);
        return { devices: [], deviceSettings: {} };
    }
}

function writeDevices(data) {
    try {
        fs.writeFileSync(DEVICES_PATH, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error('Error escribiendo devices.json:', e.message);
        throw e;
    }
}

function registerDevice(userId, companyId, deviceInfo) {
    const devicesData = readDevices();
    const deviceId = 'dev' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    
    const newDevice = {
        id: deviceId,
        userId,
        companyId,
        deviceType: deviceInfo.deviceType || 'desktop',
        deviceName: deviceInfo.deviceName || 'Unknown Device',
        os: deviceInfo.os || 'Unknown',
        browser: deviceInfo.browser || 'Unknown',
        ipAddress: deviceInfo.ipAddress || req?.ip || '0.0.0.0',
        lastActive: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        status: 'active',
        sessionToken: deviceInfo.sessionToken || null,
        pushToken: deviceInfo.pushToken || null
    };
    
    // Limitar dispositivos por usuario
    const userDevices = devicesData.devices.filter(d => d.userId === userId && d.status === 'active');
    if (userDevices.length >= devicesData.deviceSettings.maxDevicesPerUser) {
        // Desactivar el dispositivo más antiguo
        const oldestDevice = userDevices.sort((a, b) => new Date(a.lastActive) - new Date(b.lastActive))[0];
        oldestDevice.status = 'inactive';
    }
    
    devicesData.devices.push(newDevice);
    writeDevices(devicesData);
    return newDevice;
}

// ============================================================================
// PERMISOS MEJORADOS
// ============================================================================

const PERMISSION_TEMPLATES = {
    'admin': {
        inventory:   { view: true, create: true, edit: true, delete: true, import: true },
        sales:       { view: true, create: true, edit: true, cancel: true },
        invoices:    { view: true, create: true, edit: true, cancel: true },
        expenses:    { view: true, create: true, edit: true, delete: true },
        reports:     { view: true, export: true },
        accounting:  { view: true, edit: true },
        users:       { view: true, create: true, edit: true }
    },
    'manager': {
        inventory:   { view: true, create: true, edit: true, delete: false, import: true },
        sales:       { view: true, create: true, edit: true, cancel: false },
        invoices:    { view: true, create: true, edit: true, cancel: false },
        expenses:    { view: true, create: true, edit: true, delete: false },
        reports:     { view: true, export: true },
        accounting:  { view: true, edit: false },
        users:       { view: true, create: false, edit: false }
    },
    'sales': {
        inventory:   { view: true, create: false, edit: false, delete: false, import: false },
        sales:       { view: true, create: true, edit: false, cancel: false },
        invoices:    { view: true, create: true, edit: false, cancel: false },
        expenses:    { view: false, create: false, edit: false, delete: false },
        reports:     { view: true, export: false },
        accounting:  { view: false, edit: false },
        users:       { view: false, create: false, edit: false }
    },
    'inventory': {
        inventory:   { view: true, create: true, edit: true, delete: false, import: true },
        sales:       { view: true, create: false, edit: false, cancel: false },
        invoices:    { view: false, create: false, edit: false, cancel: false },
        expenses:    { view: false, create: false, edit: false, delete: false },
        reports:     { view: true, export: false },
        accounting:  { view: false, edit: false },
        users:       { view: false, create: false, edit: false }
    },
    'viewer': {
        inventory:   { view: true, create: false, edit: false, delete: false, import: false },
        sales:       { view: true, create: false, edit: false, cancel: false },
        invoices:    { view: true, create: false, edit: false, cancel: false },
        expenses:    { view: true, create: false, edit: false, delete: false },
        reports:     { view: true, export: false },
        accounting:  { view: false, edit: false },
        users:       { view: false, create: false, edit: false }
    }
};

// ============================================================================
// ENDPOINTS NUEVOS PARA FRONTEND
// ============================================================================

// GET /api/company/info - Información completa de la empresa
app.get('/api/company/info', requireAuth, (req, res) => {
    const companies = readCompanies();
    const company = companies.find(c => c.id === req.user.companyId);
    if (!company) {
        const maxByPlan = getMaxTeamByPlan(req.user);
        return ok(res, {
            companyId: req.user.companyId,
            companyName: req.user.company || '',
            memberCount: 1,
            maxMembers: maxByPlan,
            subscription: getAccessStatus(req.user),
            settings: {
                currency: 'USD',
                language: 'es',
                timezone: 'America/Caracas'
            }
        });
    }
    
    // Obtener información del dueño
    const users = readUsers();
    const owner = users.find(u => u.companyId === company.id && u.teamRole === 'owner');
    
    ok(res, {
        ...company,
        ownerName: owner?.name || '',
        ownerEmail: owner?.email || '',
        maxMembers: owner ? getMaxTeamByPlan(owner) : (company.maxUsers || 1),
        subscription: getAccessStatus(owner || req.user)
    });
});

// PUT /api/company/settings - Actualizar configuración de la empresa
app.put('/api/company/settings', requireAuth, (req, res) => {
    if (req.user.teamRole !== 'owner' && req.user.role !== 'admin') {
        return err(res, 'Solo el propietario puede modificar la configuración', 403);
    }
    
    const companies = readCompanies();
    const companyIdx = companies.findIndex(c => c.id === req.user.companyId);
    if (companyIdx === -1) {
        // Crear entrada si no existe
        companies.push({
            id: req.user.companyId,
            name: req.user.company || `Empresa ${req.user.companyId.slice(0, 8)}`,
            createdAt: new Date().toISOString(),
            createdBy: req.user.id,
            status: 'active',
            maxUsers: 5,
            currentUsers: 1,
            settings: req.body.settings || {},
            contact: req.body.contact || {},
            metadata: req.body.metadata || {}
        });
    } else {
        // Actualizar configuración
        companies[companyIdx].settings = { 
            ...companies[companyIdx].settings, 
            ...req.body.settings 
        };
        if (req.body.contact) {
            companies[companyIdx].contact = { 
                ...companies[companyIdx].contact, 
                ...req.body.contact 
            };
        }
    }
    
    writeCompanies(companies);
    logAdminAction(req.user.id, req.user.email, 'update_company_settings', null, null, '');
    ok(res, { done: true, settings: companies[companyIdx]?.settings });
});

// GET /api/user/permissions - Permisos del usuario actual
app.get('/api/user/permissions', requireAuth, (req, res) => {
    const users = readUsers();
    const user = users.find(u => u.id === req.user.id);
    const permissions = user?.permissions || DEFAULT_EMPLOYEE_PERMISSIONS;
    
    // Verificar si es propietario o admin (todos los permisos)
    if (req.user.teamRole === 'owner' || req.user.role === 'admin') {
        ok(res, { 
            isOwner: true, 
            hasAllPermissions: true, 
            modules: Object.keys(PERMISSION_TEMPLATES.admin).map(module => ({
                module,
                actions: PERMISSION_TEMPLATES.admin[module]
            }))
        });
    } else {
        ok(res, { 
            isOwner: false, 
            hasAllPermissions: false,
            modules: Object.keys(permissions).map(module => ({
                module,
                actions: permissions[module]
            }))
        });
    }
});

// GET /api/user/devices - Dispositivos del usuario actual
app.get('/api/user/devices', requireAuth, (req, res) => {
    const devicesData = readDevices();
    const userDevices = devicesData.devices.filter(d => d.userId === req.user.id);
    
    ok(res, {
        devices: userDevices,
        settings: devicesData.deviceSettings,
        canAddMore: userDevices.filter(d => d.status === 'active').length < devicesData.deviceSettings.maxDevicesPerUser
    });
});

// DELETE /api/user/devices/:deviceId - Eliminar dispositivo propio
app.delete('/api/user/devices/:deviceId', requireAuth, (req, res) => {
    const devicesData = readDevices();
    const deviceIdx = devicesData.devices.findIndex(d => d.id === req.params.deviceId && d.userId === req.user.id);
    
    if (deviceIdx === -1) return err(res, 'Dispositivo no encontrado', 404);
    
    devicesData.devices[deviceIdx].status = 'removed';
    devicesData.devices[deviceIdx].removedAt = new Date().toISOString();
    writeDevices(devicesData);
    
    ok(res, { done: true });
});

// ============================================================================
// MIDDLEWARE MEJORADO DE PERMISOS
// ============================================================================

function checkPermission(module, action) {
    return (req, res, next) => {
        const u = req.user;
        if (!u) return res.status(401).json({ ok: false, error: 'No autenticado' });
        
        // Propietarios y admins tienen todos los permisos
        if (u.teamRole === 'owner' || u.role === 'admin') {
            next();
            return;
        }
        
        // Obtener permisos del usuario
        const users = readUsers();
        const fullUser = users.find(x => x.id === u.id);
        const perms = fullUser?.permissions?.[module];
        
        if (!perms || !perms[action]) {
            return res.status(403).json({ 
                ok: false, 
                error: `Sin permiso para ${module}.${action}`,
                requiredPermission: `${module}.${action}`
            });
        }
        
        next();
    };
}

// Middleware para verificar límite de usuarios por empresa según el plan activo
function checkUserLimit(req, res, next) {
    const users = readUsers();
    const currentTeam = users.filter(u => u.companyId === req.user.companyId);

    // Obtener el límite real según el plan del propietario de la empresa
    const owner = users.find(u => u.companyId === req.user.companyId && u.teamRole === 'owner');
    const maxAllowed = owner ? getMaxTeamByPlan(owner) : 1;

    if (currentTeam.length >= maxAllowed) {
        return res.status(403).json({
            ok: false,
            error: `Has alcanzado el límite de ${maxAllowed} usuarios para tu plan.`,
            current: currentTeam.length,
            max: maxAllowed,
            upgradeRequired: true
        });
    }

    next();
}

// ============================================================================
// WEBHOOK PARA REGISTRAR DISPOSITIVOS EN LOGIN
// ============================================================================

// Esta función se debe llamar después de un login exitoso
function onUserLogin(userId, token, req) {
    // Registrar dispositivo
    const userAgent = req.headers['user-agent'] || '';
    const deviceInfo = {
        deviceType: getDeviceType(userAgent),
        deviceName: getDeviceName(userAgent),
        os: getOS(userAgent),
        browser: getBrowser(userAgent),
        ipAddress: req.ip,
        sessionToken: token
    };
    
    // Obtener companyId del usuario
    const users = readUsers();
    const user = users.find(u => u.id === userId);
    if (user) {
        registerDevice(userId, user.companyId, deviceInfo);
    }
}

// Helper functions para detectar dispositivo
function getDeviceType(userAgent) {
    if (/mobile/i.test(userAgent)) return 'mobile';
    if (/tablet/i.test(userAgent)) return 'tablet';
    return 'desktop';
}

function getDeviceName(userAgent) {
    const matches = userAgent.match(/\((.*?)\)/);
    return matches ? matches[1].split(';')[0].trim() : 'Unknown Device';
}

function getOS(userAgent) {
    if (/windows/i.test(userAgent)) return 'Windows';
    if (/mac os/i.test(userAgent)) return 'macOS';
    if (/linux/i.test(userAgent)) return 'Linux';
    if (/android/i.test(userAgent)) return 'Android';
    if (/ios|iphone|ipad/i.test(userAgent)) return 'iOS';
    return 'Unknown';
}

function getBrowser(userAgent) {
    if (/chrome/i.test(userAgent)) return 'Chrome';
    if (/firefox/i.test(userAgent)) return 'Firefox';
    if (/safari/i.test(userAgent)) return 'Safari';
    if (/edge/i.test(userAgent)) return 'Edge';
    return 'Unknown';
}

// ============================================================================
// ACTUALIZACIÓN DE ENDPOINTS EXISTENTES
// ============================================================================

// Nota: Los endpoints existentes /api/team/* ya funcionan correctamente
// Se recomienda agregar estas mejoras gradualmente