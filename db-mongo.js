/**
 * FIX PRO MAX — Capa de datos MongoDB
 * db-mongo.js — Reemplaza todos los helpers de lectura/escritura de archivos JSON.
 *
 * Exporta funciones con la misma firma que los helpers originales de server.js,
 * pero usando MongoDB vía Mongoose. El resto del código de server.js no necesita
 * cambiar su lógica — solo cambia de dónde vienen los datos.
 *
 * Funciones asíncronas (todas devuelven Promise):
 *   connectDB()
 *   readUsers() / writeUsers(users) / findUser(filter) / updateUser(id, patch)
 *   readSessions() / writeSessions(map) / findSession(token) / createSession(token, userId) / deleteSession(token) / deleteUserSessions(userId)
 *   readCompanies() / writeCompanies(arr) / findCompany(id) / upsertCompany(company)
 *   readDB(companyId) / writeDB(companyId, data) / patchDB(companyId, patch)
 *   readDevices() / writeDevices(data)
 *   readTickets() / writeTickets(arr) / findTicket(id) / upsertTicket(ticket)
 *   readPayments() / writePayments(arr) / addPayment(entry)
 *   readAdminLog() / writeAdminLog(arr) / addAdminLog(entry)
 *   readWALog() / writeWALog(arr) / addWALog(entry)
 *   getConfig() / writeConfig(cfg)
 */

'use strict';

const mongoose = require('mongoose');
const {
    User, Session, Company, Device,
    Ticket, SubPayment, AdminLog, WAAlert,
    AppConfig, CompanyDB,
} = require('./models/index');

// ─────────────────────────────────────────────────────────────────────────────
// CONEXIÓN
// ─────────────────────────────────────────────────────────────────────────────
let _connected = false;

async function connectDB() {
    if (_connected) return;
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI no está definida en las variables de entorno.');

    await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
    });
    _connected = true;
    console.log('  ✅ MongoDB Atlas conectado');

    // Asegurar que la configuración global existe
    const exists = await AppConfig.findById('main');
    if (!exists) {
        await AppConfig.create({ _id: 'main' });
        console.log('  📋 Configuración global inicializada');
    }
}

mongoose.connection.on('disconnected', () => {
    _connected = false;
    console.warn('  ⚠️  MongoDB desconectado — reconectando automáticamente...');
});

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS INTERNOS
// ─────────────────────────────────────────────────────────────────────────────

/** Convierte un documento Mongoose a objeto JS plano (sin __v, _id) */
function _lean(doc) {
    if (!doc) return null;
    const obj = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
    delete obj.__v;
    delete obj._id;
    return obj;
}

function _leanArr(docs) {
    return (docs || []).map(_lean);
}

// ─────────────────────────────────────────────────────────────────────────────
// USERS
// ─────────────────────────────────────────────────────────────────────────────

async function readUsers() {
    const docs = await User.find({}).lean();
    return docs.map(d => { delete d.__v; return d; });
}

async function writeUsers(users) {
    // Upsert masivo — preserva todos los campos
    const ops = users.map(u => ({
        updateOne: {
            filter: { id: u.id },
            update: { $set: { ...u, updatedAt: new Date().toISOString() } },
            upsert: true,
        },
    }));
    if (ops.length) await User.bulkWrite(ops);
}

async function findUser(filter) {
    const doc = await User.findOne(filter).lean();
    if (!doc) return null;
    delete doc.__v;
    return doc;
}

async function updateUser(id, patch) {
    const doc = await User.findOneAndUpdate(
        { id },
        { $set: { ...patch, updatedAt: new Date().toISOString() } },
        { new: true, lean: true }
    );
    if (doc) delete doc.__v;
    return doc;
}

async function createUser(userData) {
    const doc = await User.findOneAndUpdate(
        { id: userData.id },
        { $set: userData },
        { upsert: true, new: true, lean: true }
    );
    if (doc) delete doc.__v;
    return doc;
}

async function deleteUser(id) {
    await User.deleteOne({ id });
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSIONS
// ─────────────────────────────────────────────────────────────────────────────
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días

async function findSession(token) {
    const doc = await Session.findOne({ token }).lean();
    if (!doc) return null;
    // Verificar TTL manualmente (por si el TTL de Mongo no lo eliminó aún)
    if (doc.created && Date.now() - doc.created > SESSION_TTL_MS) {
        await Session.deleteOne({ token });
        return null;
    }
    return { userId: doc.userId, created: doc.created };
}

async function createSession(token, userId) {
    const created = Date.now();
    const expiresAt = new Date(created + SESSION_TTL_MS);
    await Session.findOneAndUpdate(
        { token },
        { $set: { token, userId, created, expiresAt } },
        { upsert: true }
    );
}

async function deleteSession(token) {
    await Session.deleteOne({ token });
}

async function deleteUserSessions(userId) {
    await Session.deleteMany({ userId });
}

/** Compatibilidad: devuelve un Map { token → {userId, created} } */
async function readSessions() {
    const docs = await Session.find({}).lean();
    const map = {};
    docs.forEach(d => { map[d.token] = { userId: d.userId, created: d.created }; });
    return map;
}

/** Compatibilidad: reemplaza todas las sesiones del mapa dado */
async function writeSessions(map) {
    // Borrar todas y reinsertar — solo se usa en paths de compatibilidad
    await Session.deleteMany({});
    const now = Date.now();
    const ops = Object.entries(map).map(([token, entry]) => {
        const userId = typeof entry === 'object' ? entry.userId : entry;
        const created = typeof entry === 'object' ? (entry.created || now) : now;
        const expiresAt = new Date(created + SESSION_TTL_MS);
        return { token, userId, created, expiresAt };
    });
    if (ops.length) await Session.insertMany(ops, { ordered: false }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPANIES
// ─────────────────────────────────────────────────────────────────────────────

async function readCompanies() {
    const docs = await Company.find({}).lean();
    return docs.map(d => { delete d.__v; return d; });
}

async function writeCompanies(arr) {
    const ops = arr.map(c => ({
        updateOne: {
            filter: { id: c.id },
            update: { $set: c },
            upsert: true,
        },
    }));
    if (ops.length) await Company.bulkWrite(ops);
}

async function findCompany(id) {
    const doc = await Company.findOne({ id }).lean();
    if (!doc) return null;
    delete doc.__v;
    return doc;
}

async function upsertCompany(company) {
    await Company.findOneAndUpdate(
        { id: company.id },
        { $set: company },
        { upsert: true }
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPANY DB — base de datos ERP por empresa
// ─────────────────────────────────────────────────────────────────────────────

/** Datos por defecto cuando se crea una empresa nueva */
function defaultData() {
    return {
        products: [], categories: [],
        warehouses: [
            { id: 'wh1', name: 'Almacén Principal' },
            { id: 'wh2', name: 'Almacén Secundario' },
        ],
        customers: [], suppliers: [], sales: [], invoices: [],
        purchases: [], expenses: [], returns: [],
        inventoryMovements: [], inventoryHistory: [], alerts: [],
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
            assets: [], liabilities: [], equity: [],
            totalAssets: 0, totalLiabilitiesEquity: 0,
        },
        incomeStatement: { revenue: 0, costOfSales: 0, grossProfit: 0, expenses: 0, netIncome: 0 },
        importHistory: [], auditLog: [], payments: [], quotes: [],
        settings: {
            companyName: '', rif: '', country: 'Venezuela',
            currency: 'USD', defaultCurrency: 'USD',
            darkMode: true, notifications: true, aiEnabled: true,
        },
        currencies: [
            { code:'VES', name:'Bolívar venezolano',   symbol:'Bs.', flag:'🇻🇪', active:true,  isBase:true  },
            { code:'EUR', name:'Euro',                 symbol:'€',   flag:'🇪🇺', active:true,  isBase:false },
            { code:'USD', name:'Dólar estadounidense', symbol:'$',   flag:'🇺🇸', active:true,  isBase:false },
        ],
        exchangeRates: [
            { id:'rate-eur-init', fromCurrency:'EUR', toCurrency:'VES', rate:40.00,
              date: new Date().toISOString().slice(0,10), createdAt: new Date().toISOString(),
              createdBy:'sistema', notes:'Tasa inicial', source:'Manual inicial',
              updateType:'manual', isActive:true },
            { id:'rate-usd-init', fromCurrency:'USD', toCurrency:'VES', rate:36.00,
              date: new Date().toISOString().slice(0,10), createdAt: new Date().toISOString(),
              createdBy:'sistema', notes:'Tasa inicial', source:'Manual inicial',
              updateType:'manual', isActive:true },
        ],
    };
}

async function readCompanyDB(companyId) {
    let doc = await CompanyDB.findOne({ companyId }).lean();
    if (!doc) {
        // Crear con datos por defecto
        const fresh = { companyId, ...defaultData() };
        doc = await CompanyDB.findOneAndUpdate(
            { companyId },
            { $setOnInsert: fresh },
            { upsert: true, new: true, lean: true }
        );
    }
    if (!doc) return { companyId, ...defaultData() };
    // Rellenar claves faltantes
    const def = defaultData();
    for (const key of Object.keys(def)) {
        if (doc[key] === undefined) doc[key] = def[key];
    }
    delete doc.__v;
    return doc;
}

async function writeCompanyDB(companyId, data) {
    const { companyId: _cid, _id, __v, ...rest } = data;
    await CompanyDB.findOneAndUpdate(
        { companyId },
        { $set: { ...rest, companyId, updatedAt: new Date().toISOString() } },
        { upsert: true }
    );
}

/** Actualiza solo campos específicos del documento de empresa (evita reescribir todo) */
async function patchCompanyDB(companyId, patch) {
    const { companyId: _cid, _id, __v, ...rest } = patch;
    await CompanyDB.findOneAndUpdate(
        { companyId },
        { $set: { ...rest, updatedAt: new Date().toISOString() } },
        { upsert: true }
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// DEVICES
// ─────────────────────────────────────────────────────────────────────────────

async function readDevices() {
    const docs = await Device.find({}).lean();
    return {
        devices: docs.map(d => { delete d.__v; return d; }),
        deviceSettings: {
            maxDevicesPerUser: 3,
            sessionTimeoutMinutes: 4320,
            allowConcurrentSessions: true,
            requireDeviceVerification: false,
        },
    };
}

async function writeDevices(data) {
    const devices = data.devices || [];
    const ops = devices.map(d => ({
        updateOne: {
            filter: { id: d.id },
            update: { $set: d },
            upsert: true,
        },
    }));
    if (ops.length) await Device.bulkWrite(ops);
}

// ─────────────────────────────────────────────────────────────────────────────
// TICKETS
// ─────────────────────────────────────────────────────────────────────────────

async function readTickets() {
    const docs = await Ticket.find({}).lean();
    return docs.map(d => { delete d.__v; return d; });
}

async function writeTickets(arr) {
    const ops = arr.map(t => ({
        updateOne: {
            filter: { id: t.id },
            update: { $set: t },
            upsert: true,
        },
    }));
    if (ops.length) await Ticket.bulkWrite(ops);
}

async function findTicket(id) {
    const doc = await Ticket.findOne({ id }).lean();
    if (!doc) return null;
    delete doc.__v;
    return doc;
}

async function upsertTicket(ticket) {
    await Ticket.findOneAndUpdate(
        { id: ticket.id },
        { $set: { ...ticket, updatedAt: new Date().toISOString() } },
        { upsert: true }
    );
}

async function deleteTicket(id) {
    await Ticket.deleteOne({ id });
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB_PAYMENTS (pagos de suscripción)
// ─────────────────────────────────────────────────────────────────────────────

async function readPayments() {
    const docs = await SubPayment.find({}).sort({ ts: -1 }).lean();
    return docs.map(d => { delete d.__v; return d; });
}

async function writePayments(arr) {
    const ops = arr.map(p => ({
        updateOne: {
            filter: { id: p.id },
            update: { $set: p },
            upsert: true,
        },
    }));
    if (ops.length) await SubPayment.bulkWrite(ops);
}

async function addPayment(entry) {
    await SubPayment.findOneAndUpdate(
        { id: entry.id },
        { $set: entry },
        { upsert: true }
    );
    return entry;
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN LOG
// ─────────────────────────────────────────────────────────────────────────────

async function readAdminLog() {
    const docs = await AdminLog.find({}).sort({ ts: -1 }).limit(2000).lean();
    return docs.map(d => { delete d.__v; return d; });
}

async function writeAdminLog(arr) {
    const ops = arr.map(e => ({
        updateOne: {
            filter: { id: e.id },
            update: { $set: e },
            upsert: true,
        },
    }));
    if (ops.length) await AdminLog.bulkWrite(ops);
}

async function addAdminLog(entry) {
    // Limitar a 2000 entradas — borrar las más antiguas si excede
    const count = await AdminLog.countDocuments();
    if (count >= 2000) {
        const oldest = await AdminLog.find().sort({ ts: 1 }).limit(count - 1999).select('id').lean();
        const ids = oldest.map(d => d.id);
        if (ids.length) await AdminLog.deleteMany({ id: { $in: ids } });
    }
    await AdminLog.findOneAndUpdate(
        { id: entry.id },
        { $set: entry },
        { upsert: true }
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// WA ALERTS LOG
// ─────────────────────────────────────────────────────────────────────────────

async function readWALog() {
    const docs = await WAAlert.find({}).sort({ ts: -1 }).limit(500).lean();
    return docs.map(d => { delete d.__v; return d; });
}

async function writeWALog(arr) {
    const ops = arr.map(e => ({
        updateOne: {
            filter: { id: e.id },
            update: { $set: e },
            upsert: true,
        },
    }));
    if (ops.length) await WAAlert.bulkWrite(ops);
}

async function addWALog(entry) {
    await WAAlert.findOneAndUpdate(
        { id: entry.id },
        { $set: entry },
        { upsert: true }
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// APP CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PAYMENT_METHODS = [
    { id: 'CASH',          label: 'Efectivo',               icon: '💵', active: true,  type: 'pos',  isManual: false },
    { id: 'CREDIT_CARD',   label: 'Tarjeta Crédito',        icon: '💳', active: true,  type: 'pos',  isManual: false },
    { id: 'DEBIT_CARD',    label: 'Tarjeta Débito',         icon: '💳', active: true,  type: 'pos',  isManual: false },
    { id: 'ZELLE',         label: 'Zelle',                  icon: '⚡', active: true,  type: 'both', isManual: true  },
    { id: 'USDT',          label: 'USDT / Cripto',          icon: '🟡', active: true,  type: 'both', isManual: true  },
    { id: 'BANK_TRANSFER', label: 'Transferencia bancaria', icon: '🏦', active: true,  type: 'pos',  isManual: false },
    { id: 'PAGO_MOVIL',    label: 'Pago Móvil',             icon: '📱', active: true,  type: 'both', isManual: true  },
    { id: 'PAYPAL',        label: 'PayPal',                 icon: '🅿️', active: false, type: 'sub',  isManual: false },
];

async function getConfig() {
    let doc = await AppConfig.findById('main').lean();
    if (!doc) {
        doc = await AppConfig.create({
            _id: 'main',
            paymentMethods: DEFAULT_PAYMENT_METHODS,
            plansOverride: {},
            globalSettings: { trialDays: 3, appName: 'FIX PRO MAX', registrationOpen: true, maintenanceMode: false },
        });
        doc = doc.toObject();
    }
    if (!doc.paymentMethods || !doc.paymentMethods.length) doc.paymentMethods = DEFAULT_PAYMENT_METHODS;
    if (!doc.plansOverride) doc.plansOverride = {};
    if (!doc.globalSettings) doc.globalSettings = {};
    delete doc.__v;
    return doc;
}

async function writeConfig(cfg) {
    const { _id, __v, ...rest } = cfg;
    await AppConfig.findByIdAndUpdate(
        'main',
        { $set: { ...rest, updatedAt: new Date().toISOString() } },
        { upsert: true }
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
    connectDB,
    defaultData,

    // Users
    readUsers, writeUsers, findUser, updateUser, createUser, deleteUser,

    // Sessions
    readSessions, writeSessions,
    findSession, createSession, deleteSession, deleteUserSessions,

    // Companies
    readCompanies, writeCompanies, findCompany, upsertCompany,

    // Company ERP DB
    readCompanyDB, writeCompanyDB, patchCompanyDB,

    // Devices
    readDevices, writeDevices,

    // Tickets
    readTickets, writeTickets, findTicket, upsertTicket, deleteTicket,

    // Sub payments
    readPayments, writePayments, addPayment,

    // Admin log
    readAdminLog, writeAdminLog, addAdminLog,

    // WA alerts
    readWALog, writeWALog, addWALog,

    // Config
    getConfig, writeConfig,
};
