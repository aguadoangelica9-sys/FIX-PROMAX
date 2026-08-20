/**
 * FIX PRO MAX — ExchangeRateService
 * exchange-rate-service.js
 *
 * Servicio centralizado de tasas de cambio BCV.
 * Fuente principal:  https://bcv.today/api/v1/rate.json
 * Fuente secundaria: https://cdn.jsdelivr.net/gh/grupoclip/bcv-api/api/v1/rate.json
 *
 * Funciona con Node.js ≥18 (fetch nativo). Sin dependencias externas.
 *
 * Exporta:
 *   ExchangeRateService.fetchAndSave(companyId?, triggeredBy?)  → actualiza las tasas
 *   ExchangeRateService.getCurrentRates(db)                     → { USD, EUR, date, source, status }
 *   ExchangeRateService.scheduleDailyUpdate(readDB, writeDB, readCompanies)
 *   ExchangeRateService.getStatus()                             → estado global del servicio
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Configuración ─────────────────────────────────────────────────────────────
const CONFIG = {
    // Fuente primaria — BCV Today (JSON estático de GitHub Pages, sin clave)
    PRIMARY_URL:   'https://bcv.today/api/v1/rate.json',
    // Fuente secundaria — mismo dataset vía jsDelivr CDN
    FALLBACK_URL:  'https://cdn.jsdelivr.net/gh/grupoclip/bcv-api/api/v1/rate.json',
    // Timeout de red por intento (ms)
    FETCH_TIMEOUT: 12000,
    // Reintentos por fuente
    RETRIES:       2,
    // Pausa entre reintentos (ms)
    RETRY_DELAY:   3000,
    // Hora de actualización diaria en Venezuela (UTC-4 en horario normal)
    DAILY_HOUR_VE: 8,     // 08:00 hora Venezuela
    // Límites de validación de tasas (sanity check)
    USD_MIN:  10,
    USD_MAX:  100000,
    EUR_MIN:  10,
    EUR_MAX:  100000,
    // Fuente que se registra en el historial
    SOURCE_NAME: 'BCV (bcv.today)',
};

// ── Estado global del servicio ────────────────────────────────────────────────
const _status = {
    lastAttempt:    null,   // ISO string del último intento
    lastSuccess:    null,   // ISO string del último éxito
    lastError:      null,   // mensaje del último error
    updateCount:    0,      // cuántas veces se actualizó con éxito
    failCount:      0,      // cuántos fallos consecutivos
    currentUSD:     null,   // última tasa USD/VES válida
    currentEUR:     null,   // última tasa EUR/VES válida
    currentDate:    null,   // fecha de la tasa vigente
    source:         null,   // fuente que respondió
    status:         'initializing',  // 'ok' | 'pending' | 'error' | 'initializing'
    scheduled:      false,  // ¿ya arrancó el cron?
};

// ── Helper: sleep ─────────────────────────────────────────────────────────────
function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Helper: fetch con timeout y reintentos ────────────────────────────────────
async function _fetchWithRetry(url, retries = CONFIG.RETRIES) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), CONFIG.FETCH_TIMEOUT);
            const resp = await fetch(url, {
                signal:  controller.signal,
                headers: { 'Cache-Control': 'no-cache', 'Accept': 'application/json' },
            });
            clearTimeout(timer);
            if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
            const data = await resp.json();
            return data;
        } catch (e) {
            lastErr = e;
            if (attempt < retries) await _sleep(CONFIG.RETRY_DELAY);
        }
    }
    throw lastErr;
}

// ── Validar respuesta de la API ───────────────────────────────────────────────
function _validateRates(data) {
    if (!data || typeof data !== 'object') return { valid: false, reason: 'Respuesta vacía o no es JSON' };

    const usd = parseFloat(data.USD);
    const eur = parseFloat(data.EUR);

    if (isNaN(usd) || usd === null || usd === undefined)
        return { valid: false, reason: `USD inválido: ${data.USD}` };
    if (usd <= 0)
        return { valid: false, reason: `USD negativo o cero: ${usd}` };
    if (usd < CONFIG.USD_MIN || usd > CONFIG.USD_MAX)
        return { valid: false, reason: `USD fuera de rango [${CONFIG.USD_MIN}–${CONFIG.USD_MAX}]: ${usd}` };

    if (isNaN(eur) || eur === null || eur === undefined)
        return { valid: false, reason: `EUR inválido: ${data.EUR}` };
    if (eur <= 0)
        return { valid: false, reason: `EUR negativo o cero: ${eur}` };
    if (eur < CONFIG.EUR_MIN || eur > CONFIG.EUR_MAX)
        return { valid: false, reason: `EUR fuera de rango [${CONFIG.EUR_MIN}–${CONFIG.EUR_MAX}]: ${eur}` };

    return { valid: true, USD: usd, EUR: eur };
}

// ── Obtener tasas desde fuente primaria → fallback → error ───────────────────
async function _fetchRates() {
    const sources = [
        { url: CONFIG.PRIMARY_URL,  name: 'BCV Today (primary)' },
        { url: CONFIG.FALLBACK_URL, name: 'BCV Today (jsDelivr CDN fallback)' },
    ];

    for (const src of sources) {
        try {
            console.log(`  [ExchangeRateService] Consultando ${src.name}...`);
            const data       = await _fetchWithRetry(src.url);
            const validation = _validateRates(data);

            if (!validation.valid) {
                console.warn(`  [ExchangeRateService] ⚠️  ${src.name} devolvió datos inválidos: ${validation.reason}`);
                continue;
            }

            console.log(`  [ExchangeRateService] ✅ ${src.name}: USD=${validation.USD} EUR=${validation.EUR} fecha=${data.effective_date || data.date}`);
            return {
                USD:            validation.USD,
                EUR:            validation.EUR,
                date:           data.effective_date || data.date || new Date().toISOString().slice(0, 10),
                updatedAt:      data.updated_at || new Date().toISOString(),
                sourceName:     src.name,
                rawDate:        data.date,
            };
        } catch (e) {
            console.warn(`  [ExchangeRateService] ⚠️  ${src.name} falló: ${e.message}`);
        }
    }

    throw new Error('Todas las fuentes fallaron. Se mantiene la última tasa válida.');
}

// ── Generar ID simple ─────────────────────────────────────────────────────────
function _genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ── Guardar tasas en una BD específica ───────────────────────────────────────
function _saveRatesToDB(db, fetchedRates, triggeredBy, updateType) {
    if (!Array.isArray(db.exchangeRates)) db.exchangeRates = [];

    const now     = new Date().toISOString();
    const today   = now.slice(0, 10);
    let   changed = false;

    const pairsToUpdate = [
        { from: 'USD', to: 'VES', value: fetchedRates.USD },
        { from: 'EUR', to: 'VES', value: fetchedRates.EUR },
    ];

    for (const pair of pairsToUpdate) {
        // Verificar si ya existe una entrada para hoy con la misma tasa (evitar duplicados)
        const existingToday = db.exchangeRates.find(r =>
            r.fromCurrency === pair.from &&
            r.toCurrency   === pair.to   &&
            r.date         === today     &&
            r.isActive     === true
        );

        if (existingToday && Math.abs(existingToday.rate - pair.value) < 0.0001) {
            // Misma tasa para hoy — no duplicar, solo actualizar timestamp
            existingToday.updatedAt = now;
            continue;
        }

        // Marcar tasas anteriores del mismo par como inactivas (historial)
        db.exchangeRates.forEach(r => {
            if (r.fromCurrency === pair.from && r.toCurrency === pair.to && r.isActive) {
                r.isActive = false;
            }
        });

        // Crear la nueva entrada activa
        db.exchangeRates.push({
            id:           _genId(),
            fromCurrency: pair.from,
            toCurrency:   pair.to,
            rate:         pair.value,
            date:         fetchedRates.date,
            rawDate:      fetchedRates.rawDate || fetchedRates.date,
            effectiveDate:fetchedRates.date,
            sourceUpdatedAt: fetchedRates.updatedAt,
            createdAt:    now,
            updatedAt:    now,
            createdBy:    triggeredBy || 'sistema-automatico',
            notes:        `${updateType === 'auto' ? '🤖 Automática' : '👤 Manual'} — ${fetchedRates.sourceName}`,
            source:       CONFIG.SOURCE_NAME,
            sourceName:   fetchedRates.sourceName,
            updateType:   updateType || 'auto',
            isActive:     true,
        });
        changed = true;
    }

    // Limitar historial a 60 entradas por par (2 meses aprox.) para no crecer indefinidamente
    for (const pair of pairsToUpdate) {
        const pairRates = db.exchangeRates
            .filter(r => r.fromCurrency === pair.from && r.toCurrency === pair.to)
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        if (pairRates.length > 60) {
            const toRemove = pairRates.slice(60).map(r => r.id);
            db.exchangeRates = db.exchangeRates.filter(r => !toRemove.includes(r.id));
        }
    }

    return changed;
}

// ── Función principal: obtener y guardar tasas ────────────────────────────────
// readDB/writeDB son las funciones inyectadas desde server.js
async function fetchAndSave(readDB, writeDB, triggeredBy = 'sistema-automatico', updateType = 'auto') {
    _status.lastAttempt = new Date().toISOString();
    _status.status      = 'pending';

    try {
        // 1. Obtener tasas de la fuente
        const fetched = await _fetchRates();

        // 2. Guardar en la BD global (db.json) y en TODAS las BDs de empresa
        const db      = await readDB();
        const changed = _saveRatesToDB(db, fetched, triggeredBy, updateType);
        if (changed) await writeDB(db);

        // 3. Actualizar estado global
        _status.lastSuccess = new Date().toISOString();
        _status.currentUSD  = fetched.USD;
        _status.currentEUR  = fetched.EUR;
        _status.currentDate = fetched.date;
        _status.source      = fetched.sourceName;
        _status.status      = 'ok';
        _status.failCount   = 0;
        _status.updateCount++;

        console.log(`  [ExchangeRateService] ✅ Tasas guardadas — USD=${fetched.USD} EUR=${fetched.EUR} (${fetched.date})`);

        return {
            success:  true,
            USD:      fetched.USD,
            EUR:      fetched.EUR,
            date:     fetched.date,
            source:   fetched.sourceName,
            changed,
        };

    } catch (e) {
        _status.status    = 'error';
        _status.lastError = e.message;
        _status.failCount++;
        console.error(`  [ExchangeRateService] ❌ ${e.message}`);

        return {
            success: false,
            error:   e.message,
            usingCached: true,
        };
    }
}

// ── Función para actualizar TODAS las BDs de empresa ─────────────────────────
async function fetchAndSaveAll(readDB, writeDB, readCompanyDB, writeCompanyDB, readCompanies, triggeredBy = 'sistema-automatico', updateType = 'auto') {
    _status.lastAttempt = new Date().toISOString();
    _status.status      = 'pending';

    let fetched;
    try {
        fetched = await _fetchRates();
    } catch (e) {
        _status.status    = 'error';
        _status.lastError = e.message;
        _status.failCount++;
        console.error(`  [ExchangeRateService] ❌ Fetch falló: ${e.message}`);
        return { success: false, error: e.message };
    }

    // Guardar en db.json global
    try {
        const db = await readDB();
        _saveRatesToDB(db, fetched, triggeredBy, updateType);
        await writeDB(db);
    } catch (e) {
        console.error(`  [ExchangeRateService] ⚠️  Error guardando en db.json global: ${e.message}`);
    }

    // Guardar en cada BD de empresa (db_{companyId}.json)
    let companiesUpdated = 0;
    try {
        const companies = readCompanies ? readCompanies() : [];
        for (const company of companies) {
            try {
                const cdb = readCompanyDB(company.id || company.companyId);
                if (cdb) {
                    _saveRatesToDB(cdb, fetched, triggeredBy, updateType);
                    writeCompanyDB(company.id || company.companyId, cdb);
                    companiesUpdated++;
                }
            } catch (ce) {
                console.warn(`  [ExchangeRateService] ⚠️  No se pudo actualizar empresa ${company.id}: ${ce.message}`);
            }
        }
    } catch (e) {
        console.warn(`  [ExchangeRateService] ⚠️  No se pudieron leer empresas: ${e.message}`);
    }

    // Actualizar también los archivos db_*.json detectados automáticamente
    try {
        const dbDir   = path.dirname(require.main?.filename || process.cwd());
        const dbFiles = fs.readdirSync(dbDir).filter(f => /^db_[a-z0-9]+\.json$/i.test(f));
        for (const dbFile of dbFiles) {
            try {
                // AISLAMIENTO DEMO: nunca actualizar la BD demo automáticamente
                if (dbFile === 'db_demo.json') continue;
                const dbPath  = path.join(dbDir, dbFile);
                const raw     = fs.readFileSync(dbPath, 'utf8');
                const content = JSON.parse(raw.replace(/^\uFEFF/, '')); // quitar BOM
                _saveRatesToDB(content, fetched, triggeredBy, updateType);
                fs.writeFileSync(dbPath, JSON.stringify(content, null, 2), 'utf8');
                companiesUpdated++;
            } catch {}
        }
    } catch {}

    // Actualizar estado global
    _status.lastSuccess = new Date().toISOString();
    _status.currentUSD  = fetched.USD;
    _status.currentEUR  = fetched.EUR;
    _status.currentDate = fetched.date;
    _status.source      = fetched.sourceName;
    _status.status      = 'ok';
    _status.failCount   = 0;
    _status.updateCount++;

    console.log(`  [ExchangeRateService] ✅ USD=${fetched.USD} EUR=${fetched.EUR} | ${companiesUpdated} BDs actualizadas`);

    return {
        success:          true,
        USD:              fetched.USD,
        EUR:              fetched.EUR,
        date:             fetched.date,
        source:           fetched.sourceName,
        companiesUpdated,
    };
}

// ── Obtener tasas actuales desde una BD ──────────────────────────────────────
function getCurrentRates(db) {
    if (!Array.isArray(db?.exchangeRates)) {
        return _buildFallback(db);
    }

    const usdRate = db.exchangeRates
        .filter(r => r.fromCurrency === 'USD' && r.toCurrency === 'VES')
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

    const eurRate = db.exchangeRates
        .filter(r => r.fromCurrency === 'EUR' && r.toCurrency === 'VES')
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

    const usdValue = usdRate?.rate ?? _status.currentUSD ?? null;
    const eurValue = eurRate?.rate ?? _status.currentEUR ?? null;

    // Calcular USD→EUR y EUR→USD a partir de las tasas VES
    let usdToEur = null;
    if (usdValue && eurValue) {
        usdToEur = eurValue / usdValue;   // 1 USD = X EUR
    }

    return {
        USD:         usdValue,
        EUR:         eurValue,
        USD_EUR:     usdToEur ? parseFloat(usdToEur.toFixed(6)) : null,
        EUR_USD:     usdToEur ? parseFloat((1 / usdToEur).toFixed(6)) : null,
        date:        usdRate?.date || eurRate?.date || null,
        source:      usdRate?.source || eurRate?.source || CONFIG.SOURCE_NAME,
        sourceName:  usdRate?.sourceName || eurRate?.sourceName || null,
        lastUpdated: usdRate?.createdAt || eurRate?.createdAt || null,
        status:      _status.status,
        failCount:   _status.failCount,
    };
}

function _buildFallback(db) {
    return {
        USD:        _status.currentUSD ?? null,
        EUR:        _status.currentEUR ?? null,
        date:       _status.currentDate ?? null,
        source:     CONFIG.SOURCE_NAME,
        lastUpdated:_status.lastSuccess,
        status:     _status.status,
        failCount:  _status.failCount,
    };
}

// ── Estado del servicio ───────────────────────────────────────────────────────
function getStatus() {
    const staleHours = _status.lastSuccess
        ? (Date.now() - new Date(_status.lastSuccess).getTime()) / 3600000
        : Infinity;

    let indicator = '🟢';
    let label     = 'Actualizada';
    if (_status.status === 'error' || staleHours > 48) {
        indicator = '🔴'; label = 'Error de actualización';
    } else if (_status.status === 'pending' || staleHours > 25) {
        indicator = '🟡'; label = 'Actualización pendiente';
    }

    return {
        ..._status,
        indicator,
        label,
        staleHours: isFinite(staleHours) ? parseFloat(staleHours.toFixed(1)) : null,
        config: {
            primaryUrl:  CONFIG.PRIMARY_URL,
            fallbackUrl: CONFIG.FALLBACK_URL,
            dailyHour:   CONFIG.DAILY_HOUR_VE,
        },
    };
}

// ── Cron job diario a las 08:00 hora Venezuela (UTC-4) ───────────────────────
// Venezuela está en UTC-4 (sin horario de verano), entonces 08:00 VE = 12:00 UTC
function scheduleDailyUpdate(readDB, writeDB, readCompanyDB, writeCompanyDB, readCompanies) {
    if (_status.scheduled) return;
    _status.scheduled = true;

    // Horas de actualización diaria en Venezuela (BCV publica por la mañana y a veces actualiza en la tarde)
    const UPDATE_HOURS_VE = [8, 13, 17]; // 08:00, 13:00 y 17:00 hora Venezuela

    function _msUntilNextUpdate() {
        const now    = new Date();
        const veTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Caracas' }));
        const veHour = veTime.getHours() * 60 + veTime.getMinutes();

        // Encontrar la próxima hora de actualización del día
        for (const h of UPDATE_HOURS_VE) {
            const targetMin = h * 60;
            if (targetMin > veHour) {
                const diff = (targetMin - veHour) * 60000;
                return diff;
            }
        }
        // Ya pasaron todas las horas del día → ir a las 08:00 de mañana
        const target = new Date(veTime);
        target.setDate(target.getDate() + 1);
        target.setHours(UPDATE_HOURS_VE[0], 0, 0, 0);
        const diffMs = target - veTime;
        return diffMs > 0 ? diffMs : 60000;
    }

    async function _runDaily() {
        const now = new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' });
        console.log(`\n  [ExchangeRateService] ⏰ Actualización programada BCV — ${now}`);
        await fetchAndSaveAll(readDB, writeDB, readCompanyDB, writeCompanyDB, readCompanies, 'sistema-automatico', 'auto');
        // Programar la siguiente ejecución
        const ms = _msUntilNextUpdate();
        const horas = (ms / 3600000).toFixed(1);
        console.log(`  [ExchangeRateService] ⏭️  Próxima actualización en ${horas}h`);
        setTimeout(_runDaily, ms);
    }

    const msFirst = _msUntilNextUpdate();
    const horasFirst = (msFirst / 3600000).toFixed(2);
    const veNow = new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas', hour:'2-digit', minute:'2-digit' });
    console.log(`  [ExchangeRateService] 📅 Cron programado (hora VE actual: ${veNow}): próxima actualización en ${horasFirst}h`);
    setTimeout(_runDaily, msFirst);

    // También hacer una actualización al arrancar el servidor (si han pasado >1h desde la última)
    setTimeout(async () => {
        const hoursSinceSuccess = _status.lastSuccess
            ? (Date.now() - new Date(_status.lastSuccess).getTime()) / 3600000
            : Infinity;
        if (hoursSinceSuccess > 1) {
            console.log(`  [ExchangeRateService] 🚀 Actualización inicial al arrancar el servidor...`);
            await fetchAndSaveAll(readDB, writeDB, readCompanyDB, writeCompanyDB, readCompanies, 'inicio-servidor', 'auto');
        }
    }, 8000); // esperar 8s para que el servidor esté completamente listo
}

// ── Exportar ──────────────────────────────────────────────────────────────────
module.exports = {
    fetchAndSave,
    fetchAndSaveAll,
    getCurrentRates,
    scheduleDailyUpdate,
    getStatus,
    CONFIG,
};
