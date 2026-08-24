/**
 * FIX PRO MAX — Modelos Mongoose
 * models/index.js — Exporta todos los esquemas de MongoDB.
 *
 * Estructura:
 *   Colecciones GLOBALES (SaaS): User, Session, Company, Device, Ticket, SubPayment, AdminLog, WAAlert, AppConfig
 *   Colecciones POR EMPRESA (discriminadas por companyId): CompanyDB (documento único por empresa)
 */

'use strict';

const mongoose = require('mongoose');

// ─────────────────────────────────────────────────────────────────────────────
// USER — usuarios del sistema SaaS
// ─────────────────────────────────────────────────────────────────────────────
const UserSchema = new mongoose.Schema({
    id:                   { type: String, required: true, unique: true, index: true },
    name:                 { type: String, required: true },
    email:                { type: String, required: true, unique: true, lowercase: true },
    password:             { type: String, required: true },   // SHA-256 + salt
    company:              { type: String, default: '' },
    role:                 { type: String, enum: ['admin', 'user'], default: 'user' },
    mode:                 { type: String, enum: ['basic', 'pro'], default: 'basic' },
    avatar:               { type: String, default: '' },
    companyId:            { type: String, index: true },
    teamRole:             { type: String, enum: ['owner', 'employee'], default: 'owner' },
    permissions:          { type: mongoose.Schema.Types.Mixed, default: null },
    active:               { type: Boolean, default: true },
    isDemo:               { type: Boolean, default: false },
    mustChange:           { type: Boolean, default: false },
    trialStart:           { type: String },
    subscriptionStatus:   { type: String, default: null },
    subscriptionPlan:     { type: String, default: null },
    subscriptionStart:    { type: String, default: null },
    subscriptionEnd:      { type: String, default: null },
    subscriptionSource:   { type: String, default: null },
    subscriptionOrderId:  { type: String, default: null },
    subscriptionToken:    { type: String, default: null },
    subscriptionRenewedAt:{ type: String, default: null },
    subscriptionCancelledAt:{ type: String, default: null },
    pendingPlanId:        { type: String, default: null },
    pendingPlanSince:     { type: String, default: null },
    loginAttempts:        { type: Number, default: 0 },
    lockedUntil:          { type: String, default: null },
    lastLogin:            { type: String, default: null },
    suspendedAt:          { type: String, default: null },
    suspendReason:        { type: String, default: '' },
    createdAt:            { type: String, default: () => new Date().toISOString() },
    updatedAt:            { type: String, default: () => new Date().toISOString() },
}, { _id: false, versionKey: false });

// ─────────────────────────────────────────────────────────────────────────────
// SESSION — tokens de sesión activos
// ─────────────────────────────────────────────────────────────────────────────
const SessionSchema = new mongoose.Schema({
    token:     { type: String, required: true, unique: true, index: true },
    userId:    { type: String, required: true, index: true },
    created:   { type: Number, default: () => Date.now() },
    expiresAt: { type: Date,   index: { expireAfterSeconds: 0 } },   // TTL automático de Mongo
}, { versionKey: false });

// ─────────────────────────────────────────────────────────────────────────────
// COMPANY — empresas registradas
// ─────────────────────────────────────────────────────────────────────────────
const CompanySchema = new mongoose.Schema({
    id:                 { type: String, required: true, unique: true, index: true },
    name:               { type: String, required: true },
    createdAt:          { type: String, default: () => new Date().toISOString() },
    createdBy:          { type: String },
    status:             { type: String, default: 'active' },
    subscriptionPlan:   { type: String, default: null },
    subscriptionStatus: { type: String, default: 'trial' },
    subscriptionEnd:    { type: String, default: null },
    maxUsers:           { type: Number, default: 5 },
    currentUsers:       { type: Number, default: 1 },
    settings:           { type: mongoose.Schema.Types.Mixed, default: {} },
    contact:            { type: mongoose.Schema.Types.Mixed, default: {} },
    metadata:           { type: mongoose.Schema.Types.Mixed, default: {} },
}, { _id: false, versionKey: false });

// ─────────────────────────────────────────────────────────────────────────────
// DEVICE — dispositivos registrados por usuario
// ─────────────────────────────────────────────────────────────────────────────
const DeviceSchema = new mongoose.Schema({
    id:           { type: String, required: true, unique: true, index: true },
    userId:       { type: String, index: true },
    companyId:    { type: String, index: true },
    deviceType:   { type: String },
    deviceName:   { type: String },
    os:           { type: String },
    browser:      { type: String },
    ipAddress:    { type: String },
    lastActive:   { type: String },
    status:       { type: String, default: 'active' },
    sessionToken: { type: String },
    pushToken:    { type: String, default: null },
    createdAt:    { type: String, default: () => new Date().toISOString() },
}, { _id: false, versionKey: false });

// ─────────────────────────────────────────────────────────────────────────────
// TICKET — tickets de soporte
// ─────────────────────────────────────────────────────────────────────────────
const TicketSchema = new mongoose.Schema({
    id:          { type: String, required: true, unique: true, index: true },
    userId:      { type: String, index: true },
    userName:    { type: String },
    userEmail:   { type: String },
    category:    { type: String },
    title:       { type: String },
    description: { type: String },
    priority:    { type: String, default: 'media' },
    status:      { type: String, default: 'new' },
    messages:    { type: [mongoose.Schema.Types.Mixed], default: [] },
    assignedTo:  { type: String, default: null },
    resolvedAt:  { type: String, default: null },
    closedAt:    { type: String, default: null },
    createdAt:   { type: String, default: () => new Date().toISOString() },
    updatedAt:   { type: String, default: () => new Date().toISOString() },
}, { _id: false, versionKey: false });

// ─────────────────────────────────────────────────────────────────────────────
// SUB_PAYMENT — pagos de suscripción (nivel SaaS, global)
// ─────────────────────────────────────────────────────────────────────────────
const SubPaymentSchema = new mongoose.Schema({
    id:          { type: String, required: true, unique: true, index: true },
    ts:          { type: String, default: () => new Date().toISOString() },
    userId:      { type: String, index: true },
    userEmail:   { type: String },
    planId:      { type: String },
    planName:    { type: String },
    amount:      { type: Number, default: 0 },
    currency:    { type: String, default: 'USD' },
    method:      { type: String },
    status:      { type: String, default: 'completed' },
    source:      { type: String },
    orderId:     { type: String, default: null },
    note:        { type: String, default: '' },
    confirmedBy: { type: String, default: null },
    confirmedAt: { type: String, default: null },
}, { _id: false, versionKey: false });

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN_LOG — auditoría de acciones del panel admin
// ─────────────────────────────────────────────────────────────────────────────
const AdminLogSchema = new mongoose.Schema({
    id:          { type: String, required: true, unique: true },
    ts:          { type: String, default: () => new Date().toISOString() },
    adminId:     { type: String },
    adminEmail:  { type: String },
    action:      { type: String },
    targetId:    { type: String, default: null },
    targetEmail: { type: String, default: null },
    detail:      { type: String, default: '' },
}, { _id: false, versionKey: false });

// ─────────────────────────────────────────────────────────────────────────────
// WA_ALERT — log de alertas WhatsApp enviadas
// ─────────────────────────────────────────────────────────────────────────────
const WAAlertSchema = new mongoose.Schema({
    id:       { type: String, required: true, unique: true },
    ts:       { type: String, default: () => new Date().toISOString() },
    type:     { type: String },
    message:  { type: String },
    status:   { type: String, default: 'pending' },
    retries:  { type: Number, default: 0 },
    error:    { type: String, default: null },
    data:     { type: mongoose.Schema.Types.Mixed, default: {} },
}, { _id: false, versionKey: false });

// ─────────────────────────────────────────────────────────────────────────────
// APP_CONFIG — configuración global del sistema (antes config.json)
// Un único documento con _id fijo 'main'
// ─────────────────────────────────────────────────────────────────────────────
const AppConfigSchema = new mongoose.Schema({
    _id:              { type: String, default: 'main' },
    paymentMethods:   { type: [mongoose.Schema.Types.Mixed], default: [] },
    plansOverride:    { type: mongoose.Schema.Types.Mixed, default: {} },
    whatsappPhone:    { type: String, default: '' },
    whatsappDestPhone:{ type: String, default: '' },
    ultramsgInstance: { type: String, default: '' },
    ultramsgToken:    { type: String, default: 'PENDING_SETUP' },
    globalSettings:   { type: mongoose.Schema.Types.Mixed, default: {} },
    updatedAt:        { type: String, default: () => new Date().toISOString() },
}, { versionKey: false });

// ─────────────────────────────────────────────────────────────────────────────
// COMPANY_DB — base de datos ERP por empresa (documento único por empresa)
// Toda la data del ERP (productos, ventas, clientes, etc.) en un documento.
// Estrategia: un documento JSON completo por empresa, igual que antes.
// Para empresas con mucha data, se puede migrar a colecciones separadas más adelante.
// ─────────────────────────────────────────────────────────────────────────────
const CompanyDBSchema = new mongoose.Schema({
    companyId:          { type: String, required: true, unique: true, index: true },
    products:           { type: [mongoose.Schema.Types.Mixed], default: [] },
    categories:         { type: [mongoose.Schema.Types.Mixed], default: [] },
    warehouses:         { type: [mongoose.Schema.Types.Mixed], default: [
        { id: 'wh1', name: 'Almacén Principal' },
        { id: 'wh2', name: 'Almacén Secundario' },
    ]},
    customers:          { type: [mongoose.Schema.Types.Mixed], default: [] },
    suppliers:          { type: [mongoose.Schema.Types.Mixed], default: [] },
    sales:              { type: [mongoose.Schema.Types.Mixed], default: [] },
    invoices:           { type: [mongoose.Schema.Types.Mixed], default: [] },
    purchases:          { type: [mongoose.Schema.Types.Mixed], default: [] },
    expenses:           { type: [mongoose.Schema.Types.Mixed], default: [] },
    returns:            { type: [mongoose.Schema.Types.Mixed], default: [] },
    inventoryMovements: { type: [mongoose.Schema.Types.Mixed], default: [] },
    inventoryHistory:   { type: [mongoose.Schema.Types.Mixed], default: [] },
    alerts:             { type: [mongoose.Schema.Types.Mixed], default: [] },
    chartOfAccounts:    { type: [mongoose.Schema.Types.Mixed], default: [] },
    journalEntries:     { type: [mongoose.Schema.Types.Mixed], default: [] },
    balanceSheet:       { type: mongoose.Schema.Types.Mixed, default: {
        assets: [], liabilities: [], equity: [],
        totalAssets: 0, totalLiabilitiesEquity: 0,
    }},
    incomeStatement:    { type: mongoose.Schema.Types.Mixed, default: {
        revenue: 0, costOfSales: 0, grossProfit: 0, expenses: 0, netIncome: 0,
    }},
    importHistory:      { type: [mongoose.Schema.Types.Mixed], default: [] },
    auditLog:           { type: [mongoose.Schema.Types.Mixed], default: [] },
    payments:           { type: [mongoose.Schema.Types.Mixed], default: [] },
    quotes:             { type: [mongoose.Schema.Types.Mixed], default: [] },
    // Cuentas consolidadas por cliente/proveedor — movimientos individuales
    accountMovements:   { type: [mongoose.Schema.Types.Mixed], default: [] },
    settings:           { type: mongoose.Schema.Types.Mixed, default: {
        companyName: '', rif: '', country: 'Venezuela',
        currency: 'USD', defaultCurrency: 'USD',
        darkMode: true, notifications: true, aiEnabled: true,
    }},
    currencies: { type: [mongoose.Schema.Types.Mixed], default: [
        { code:'VES', name:'Bolívar venezolano',   symbol:'Bs.', flag:'🇻🇪', active:true,  isBase:true,  format:'es-VE', decimals:2 },
        { code:'EUR', name:'Euro',                 symbol:'€',   flag:'🇪🇺', active:true,  isBase:false, format:'de-DE', decimals:2 },
        { code:'USD', name:'Dólar estadounidense', symbol:'$',   flag:'🇺🇸', active:true,  isBase:false, format:'en-US', decimals:2 },
    ]},
    exchangeRates:      { type: [mongoose.Schema.Types.Mixed], default: [] },
    updatedAt:          { type: String, default: () => new Date().toISOString() },
}, { versionKey: false });

// ─────────────────────────────────────────────────────────────────────────────
// Exportar modelos
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
    User:        mongoose.model('User',        UserSchema),
    Session:     mongoose.model('Session',     SessionSchema),
    Company:     mongoose.model('Company',     CompanySchema),
    Device:      mongoose.model('Device',      DeviceSchema),
    Ticket:      mongoose.model('Ticket',      TicketSchema),
    SubPayment:  mongoose.model('SubPayment',  SubPaymentSchema),
    AdminLog:    mongoose.model('AdminLog',    AdminLogSchema),
    WAAlert:     mongoose.model('WAAlert',     WAAlertSchema),
    AppConfig:   mongoose.model('AppConfig',   AppConfigSchema),
    CompanyDB:   mongoose.model('CompanyDB',   CompanyDBSchema),
    CompanyBackup: mongoose.model('CompanyBackup', new mongoose.Schema({
        companyId:  { type: String, required: true, index: true },
        savedAt:    { type: String, default: () => new Date().toISOString() },
        trigger:    { type: String, default: 'auto' }, // 'auto' | 'manual'
        products:   Number,
        customers:  Number,
        sales:      Number,
        snapshot:   { type: mongoose.Schema.Types.Mixed }, // BD completa
    }, { versionKey: false })),
};
