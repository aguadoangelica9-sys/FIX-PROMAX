/**
 * FIX PRO MAX — Script de Migración JSON → MongoDB Atlas
 * migrate-to-mongo.js
 *
 * Lee todos los archivos JSON existentes y los sube a MongoDB Atlas.
 * Es seguro ejecutarlo varias veces (upsert — no duplica datos).
 *
 * Uso:
 *   node migrate-to-mongo.js
 *
 * Requiere MONGODB_URI en .env o en variables de entorno.
 */

'use strict';

require('dotenv').config();

const fs      = require('fs');
const path    = require('path');
const mongoose = require('mongoose');

const {
    connectDB,
    writeUsers, writeCompanies, writeSessions,
    writeTickets, writePayments, writeAdminLog, writeWALog, writeConfig,
    writeCompanyDB, writeDevices,
} = require('./db-mongo');

const ROOT = __dirname;

function readJSON(file, fallback) {
    try {
        const p = path.join(ROOT, file);
        if (!fs.existsSync(p)) return fallback;
        const raw = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
        return JSON.parse(raw);
    } catch (e) {
        console.warn(`  ⚠️  No se pudo leer ${file}: ${e.message}`);
        return fallback;
    }
}

async function migrate() {
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║   FIX PRO MAX — Migración JSON → MongoDB Atlas           ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');

    if (!process.env.MONGODB_URI) {
        console.error('❌ MONGODB_URI no definida. Crea un archivo .env con tu URI de MongoDB Atlas.');
        process.exit(1);
    }

    console.log('🔌 Conectando a MongoDB Atlas...');
    await connectDB();

    // ── 1. Usuarios ──────────────────────────────────────────────────────────
    const users = readJSON('users.json', []);
    if (users.length) {
        console.log(`\n👤 Migrando ${users.length} usuarios...`);
        await writeUsers(users);
        console.log(`   ✅ ${users.length} usuarios migrados`);
    } else {
        console.log('   ⚠️  users.json vacío o no encontrado — omitido');
    }

    // ── 2. Empresas ──────────────────────────────────────────────────────────
    const companies = readJSON('companies.json', []);
    if (companies.length) {
        console.log(`\n🏢 Migrando ${companies.length} empresas...`);
        await writeCompanies(companies);
        console.log(`   ✅ ${companies.length} empresas migradas`);
    } else {
        console.log('   ⚠️  companies.json vacío — omitido');
    }

    // ── 3. Sesiones ──────────────────────────────────────────────────────────
    const sessions = readJSON('sessions.json', {});
    const sessionCount = Object.keys(sessions).length;
    if (sessionCount) {
        console.log(`\n🔑 Migrando ${sessionCount} sesiones activas...`);
        await writeSessions(sessions);
        console.log(`   ✅ ${sessionCount} sesiones migradas`);
    } else {
        console.log('   ⚠️  sessions.json vacío — omitido');
    }

    // ── 4. Tickets de soporte ────────────────────────────────────────────────
    const tickets = readJSON('tickets.json', []);
    if (tickets.length) {
        console.log(`\n🎫 Migrando ${tickets.length} tickets...`);
        await writeTickets(tickets);
        console.log(`   ✅ ${tickets.length} tickets migrados`);
    } else {
        console.log('   ℹ️  tickets.json vacío — omitido');
    }

    // ── 5. Pagos de suscripción ──────────────────────────────────────────────
    const payments = readJSON('payments.json', []);
    if (payments.length) {
        console.log(`\n💳 Migrando ${payments.length} pagos de suscripción...`);
        await writePayments(payments);
        console.log(`   ✅ ${payments.length} pagos migrados`);
    } else {
        console.log('   ℹ️  payments.json vacío — omitido');
    }

    // ── 6. Admin log ─────────────────────────────────────────────────────────
    const adminLog = readJSON('admin-log.json', []);
    if (adminLog.length) {
        console.log(`\n📋 Migrando ${adminLog.length} entradas de log de admin...`);
        await writeAdminLog(adminLog);
        console.log(`   ✅ ${adminLog.length} entradas migradas`);
    } else {
        console.log('   ℹ️  admin-log.json vacío — omitido');
    }

    // ── 7. WA alerts log ─────────────────────────────────────────────────────
    const waAlerts = readJSON('wa-alerts.json', []);
    if (waAlerts.length) {
        console.log(`\n📱 Migrando ${waAlerts.length} alertas de WhatsApp...`);
        await writeWALog(waAlerts);
        console.log(`   ✅ ${waAlerts.length} alertas migradas`);
    } else {
        console.log('   ℹ️  wa-alerts.json vacío — omitido');
    }

    // ── 8. Configuración global ───────────────────────────────────────────────
    const config = readJSON('config.json', null);
    if (config) {
        console.log('\n⚙️  Migrando configuración global...');
        await writeConfig(config);
        console.log('   ✅ Configuración migrada');
    } else {
        console.log('   ⚠️  config.json no encontrado — usando valores por defecto');
    }

    // ── 9. Dispositivos ──────────────────────────────────────────────────────
    const devicesData = readJSON('devices.json', { devices: [] });
    const deviceList = devicesData.devices || devicesData;
    const devices = Array.isArray(deviceList) ? deviceList : [];
    if (devices.length) {
        console.log(`\n📱 Migrando ${devices.length} dispositivos...`);
        await writeDevices({ devices });
        console.log(`   ✅ ${devices.length} dispositivos migrados`);
    } else {
        console.log('   ℹ️  devices.json vacío — omitido');
    }

    // ── 10. Bases de datos por empresa (db_{companyId}.json) ─────────────────
    console.log('\n🗄️  Migrando bases de datos por empresa...');

    // Detectar todos los archivos db_*.json
    const dbFiles = fs.readdirSync(ROOT).filter(f => /^db_[a-z0-9_-]+\.json$/i.test(f));
    console.log(`   Encontrados: ${dbFiles.join(', ') || 'ninguno'}`);

    let dbMigrated = 0;
    for (const dbFile of dbFiles) {
        const companyId = dbFile.replace(/^db_/, '').replace(/\.json$/, '');
        const data = readJSON(dbFile, null);
        if (!data) { console.log(`   ⚠️  ${dbFile} vacío — omitido`); continue; }

        try {
            await writeCompanyDB(companyId, data);
            const productCount = (data.products || []).length;
            const salesCount   = (data.sales    || []).length;
            console.log(`   ✅ ${dbFile} → companyId "${companyId}" (${productCount} productos, ${salesCount} ventas)`);
            dbMigrated++;
        } catch (e) {
            console.error(`   ❌ Error migrando ${dbFile}: ${e.message}`);
        }
    }

    // ── Resumen ───────────────────────────────────────────────────────────────
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║   ✅ MIGRACIÓN COMPLETADA                                 ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log(`
  📊 Resumen:
     👤 Usuarios:    ${users.length}
     🏢 Empresas:    ${companies.length}
     🔑 Sesiones:    ${sessionCount}
     🎫 Tickets:     ${tickets.length}
     💳 Pagos:       ${payments.length}
     📋 Admin log:   ${adminLog.length}
     📱 WA alerts:   ${waAlerts.length}
     🗄️  DBs empresa: ${dbMigrated} / ${dbFiles.length}

  ✨ Ahora puedes desplegar en Render.com con confianza.
  `);

    await mongoose.connection.close();
    process.exit(0);
}

migrate().catch(e => {
    console.error('\n❌ Error fatal en migración:', e.message);
    console.error(e.stack);
    process.exit(1);
});
