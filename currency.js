/**
 * FIX PRO MAX — Sistema Global de Monedas VES / EUR
 * currency.js — Módulo centralizado. NO modifica ninguna función existente.
 *
 * Monedas soportadas:
 *   🇻🇪 VES — Bolívar venezolano  (Bs.)
 *   🇪🇺 EUR — Euro                (€)
 *
 * Funciones expuestas al window:
 *   CurrencySystem.format(amount, currency)
 *   CurrencySystem.getDefault()
 *   CurrencySystem.setDefault(code)
 *   CurrencySystem.getRate()
 *   CurrencySystem.setRate(rate, notes)
 *   CurrencySystem.convert(amount, from, to)
 *   CurrencySystem.getRateHistory()
 *   CurrencySystem.getSelector(currentCode, onChangeFn, opts)
 *   CurrencySystem.getCurrencyBadge(code)
 *   CurrencySystem.openRatesPanel()
 *   CurrencySystem.openStatsPanel()
 *   CurrencySystem.renderCurrencySettings()
 *   CurrencySystem.init()
 */
(function CurrencyModule() {
    'use strict';

    /* ═══════════════════════════════════════════════════════════════
       CATÁLOGO DE MONEDAS
       ═══════════════════════════════════════════════════════════════ */
    const CURRENCIES = {
        VES: {
            code:     'VES',
            name:     'Bolívar venezolano',
            symbol:   'Bs.',
            flag:     '🇻🇪',
            locale:   'es-VE',
            decimals: 2,
            /* Formato: Bs. 1.000  (sin decimales — estilo venezolano para precios enteros) */
            format(amount) {
                const n = Number(amount) || 0;
                // Sin decimales: mostrar entero con separador de miles (punto)
                const abs   = Math.round(Math.abs(n));
                const intFmt = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
                return (n < 0 ? '-' : '') + 'Bs. ' + intFmt;
            },
        },
        EUR: {
            code:     'EUR',
            name:     'Euro',
            symbol:   '€',
            flag:     '🇪🇺',
            locale:   'de-DE',
            decimals: 2,
            /* Formato: €1.000  (sin decimales) */
            format(amount) {
                const n = Number(amount) || 0;
                const abs   = Math.round(Math.abs(n));
                const intFmt = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
                return (n < 0 ? '-' : '') + '€' + intFmt;
            },
        },
        USD: {
            code:     'USD',
            name:     'Dólar estadounidense',
            symbol:   '$',
            flag:     '🇺🇸',
            locale:   'en-US',
            decimals: 2,
            /* Formato: $1,000  (sin decimales) */
            format(amount) {
                const n = Number(amount) || 0;
                const abs   = Math.round(Math.abs(n));
                const intFmt = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
                return (n < 0 ? '-' : '') + '$' + intFmt;
            },
        },
    };

    const SUPPORTED = ['VES', 'EUR', 'USD'];

    /* ═══════════════════════════════════════════════════════════════
       ESTADO INTERNO
       ═══════════════════════════════════════════════════════════════ */
    let _defaultCurrency = 'VES';
    let _activeRate       = 40.00;    // EUR→VES (fallback)
    let _activeRateUSD    = 36.00;    // USD→VES (fallback)
    let _rateCache        = { EUR: null, USD: null, date: null, source: null, status: 'initializing' };
    let _rateHistory      = [];
    let _initialized      = false;

    /* ═══════════════════════════════════════════════════════════════
       API HELPER
       ═══════════════════════════════════════════════════════════════ */
    function _apiBase() {
        const h = window.location.hostname;
        if (h === 'localhost' || h === '127.0.0.1' ||
            h.startsWith('192.168.') || h.startsWith('10.') || h.startsWith('172.')) {
            return window.location.origin;
        }
        return 'http://localhost:3000';
    }

    async function _get(path) {
        const token = localStorage.getItem('fixpromax_token') || '';
        try {
            const r = await fetch(_apiBase() + path, {
                headers: token ? { 'Authorization': 'Bearer ' + token } : {},
                signal: AbortSignal.timeout(5000),
            });
            const j = await r.json();
            return j.ok ? j.data : null;
        } catch { return null; }
    }

    async function _post(path, body) {
        const token = localStorage.getItem('fixpromax_token') || '';
        try {
            const r = await fetch(_apiBase() + path, {
                method:  'POST',
                headers: {
                    'Content-Type':  'application/json',
                    'Authorization': 'Bearer ' + token,
                },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(5000),
            });
            const j = await r.json();
            return j.ok ? j.data : null;
        } catch { return null; }
    }

    async function _put(path, body) {
        const token = localStorage.getItem('fixpromax_token') || '';
        try {
            const r = await fetch(_apiBase() + path, {
                method:  'PUT',
                headers: {
                    'Content-Type':  'application/json',
                    'Authorization': 'Bearer ' + token,
                },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(5000),
            });
            const j = await r.json();
            return j.ok ? j.data : null;
        } catch { return null; }
    }

    /* ═══════════════════════════════════════════════════════════════
       FUNCIONES NÚCLEO PÚBLICAS
       ═══════════════════════════════════════════════════════════════ */

    /**
     * Formatea un monto con la moneda indicada.
     * Si no se indica moneda, usa la moneda principal de la empresa.
     * @param {number} amount
     * @param {string} [currency]  'VES' | 'EUR'  (opcional)
     * @returns {string}  "Bs. 1.000,00" | "€20,00"
     */
    function format(amount, currency) {
        const code = _resolve(currency);
        const curr = CURRENCIES[code];
        if (!curr) return String(amount);
        return curr.format(amount);
    }

    /**
     * Devuelve el código de moneda principal de la empresa.
     * @returns {'VES'|'EUR'}
     */
    function getDefault() {
        // Primero intentar desde data (inyectado por servidor)
        if (typeof data !== 'undefined' && data?.settings?.defaultCurrency) {
            _defaultCurrency = data.settings.defaultCurrency;
        }
        return _defaultCurrency;
    }

    /**
     * Cambia la moneda principal de la empresa (persiste en BD).
     * @param {'VES'|'EUR'} code
     */
    async function setDefault(code) {
        if (!SUPPORTED.includes(code)) { console.warn('[Currency] Moneda no soportada:', code); return; }
        _defaultCurrency = code;
        // Actualizar en data local si está disponible
        if (typeof data !== 'undefined' && data.settings) {
            data.settings.defaultCurrency = code;
            if (typeof persist === 'function') persist();
        }
        // Persistir en servidor
        await _put('/api/currencies/default', { code });
        // Actualizar UI del panel de configuración si está visible
        _updateSettingsBadge();
        if (typeof showToast === 'function')
            showToast('💱', `Moneda principal: ${CURRENCIES[code]?.flag || ''} ${code}`);
    }

    /**
     * Devuelve la tasa activa EUR→VES.
     * @returns {number}
     */
    function getRate() {
        return getRateFor('EUR', 'VES');
    }

    /**
     * Devuelve la tasa para cualquier par (from → VES).
     * @param {'USD'|'EUR'|'VES'} from
     * @param {'VES'} [to]
     * @returns {number}
     */
    function getRateFor(from, to = 'VES') {
        if (from === to) return 1;
        if (typeof data !== 'undefined' && Array.isArray(data.exchangeRates)) {
            // Buscar la tasa activa del par
            const active = data.exchangeRates.find(r =>
                r.fromCurrency === from && r.toCurrency === to && r.isActive);
            if (active) return active.rate;
            // Fallback: la más reciente
            const sorted = data.exchangeRates
                .filter(r => r.fromCurrency === from && r.toCurrency === to)
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            if (sorted[0]) return sorted[0].rate;
        }
        // Fallback del estado global cargado desde API
        if (from === 'EUR' && _rateCache.EUR) return _rateCache.EUR;
        if (from === 'USD' && _rateCache.USD) return _rateCache.USD;
        // Últimos valores conocidos
        return from === 'EUR' ? _activeRate : (from === 'USD' ? _activeRateUSD : 1);
    }

    /**
     * Registra una nueva tasa EUR→VES (persiste en BD y en historial local).
     * @param {number} rate
     * @param {string} [notes]
     */
    async function setRate(rate, notes) {
        const val = parseFloat(rate);
        if (!val || val <= 0) { if (typeof showToast === 'function') showToast('⚠️', 'Tasa inválida'); return; }
        _activeRate = val;

        // Actualizar en data local
        if (typeof data !== 'undefined') {
            if (!Array.isArray(data.exchangeRates)) data.exchangeRates = [];
            data.exchangeRates.forEach(r => {
                if (r.fromCurrency === 'EUR' && r.toCurrency === 'VES') r.isActive = false;
            });
            const newEntry = {
                id:           _genId(),
                fromCurrency: 'EUR',
                toCurrency:   'VES',
                rate:         val,
                date:         new Date().toISOString().slice(0, 10),
                createdAt:    new Date().toISOString(),
                createdBy:    window._currentUser?.email || 'usuario',
                notes:        notes || '',
                isActive:     true,
            };
            data.exchangeRates.push(newEntry);
            if (typeof persist === 'function') persist();
        }

        // Persistir en servidor
        await _post('/api/exchange-rates', { fromCurrency: 'EUR', toCurrency: 'VES', rate: val, notes: notes || '' });
        if (typeof showToast === 'function')
            showToast('✅', `1 EUR = ${format(val, 'VES')} — Tasa actualizada`);
        // Re-renderizar si es posible
        if (typeof renderAll === 'function') renderAll();
    }

    /**
     * Convierte un monto entre cualquier par de monedas soportadas.
     * Usa VES como moneda puente cuando no hay tasa directa.
     * Nunca mezcla monedas sin conversión explícita.
     *
     * @param {number} amount
     * @param {'VES'|'EUR'|'USD'} from
     * @param {'VES'|'EUR'|'USD'} to
     * @returns {{ amount: number, rate: number, original: number, from: string, to: string, via?: string }}
     */
    function convert(amount, from, to) {
        const val = Number(amount) || 0;
        if (from === to) return { amount: val, rate: 1, original: val, from, to };

        const rateEUR = getRateFor('EUR', 'VES');  // 1 EUR = X VES
        const rateUSD = getRateFor('USD', 'VES');  // 1 USD = X VES

        // Convertir `from` → VES primero
        let inVES;
        if      (from === 'VES') inVES = val;
        else if (from === 'EUR') inVES = val * rateEUR;
        else if (from === 'USD') inVES = val * rateUSD;
        else return { amount: val, rate: 1, original: val, from, to };

        // Convertir VES → `to`
        let result, rateUsed, via;
        if (to === 'VES') {
            result   = inVES;
            rateUsed = from === 'EUR' ? rateEUR : rateUSD;
        } else if (to === 'EUR') {
            result   = rateEUR > 0 ? inVES / rateEUR : 0;
            rateUsed = rateEUR;
            via      = from !== 'VES' ? 'VES' : undefined;
        } else if (to === 'USD') {
            result   = rateUSD > 0 ? inVES / rateUSD : 0;
            rateUsed = rateUSD;
            via      = from !== 'VES' ? 'VES' : undefined;
        } else {
            return { amount: val, rate: 1, original: val, from, to };
        }

        return {
            amount:   parseFloat(result.toFixed(4)),
            rate:     rateUsed,
            original: val,
            from,
            to,
            ...(via ? { via } : {}),
            rateEUR,
            rateUSD,
        };
    }

    /**
     * Historial de tasas de cambio.
     * @returns {Array}
     */
    function getRateHistory() {
        if (typeof data !== 'undefined' && Array.isArray(data.exchangeRates)) {
            return [...data.exchangeRates]
                .filter(r => r.fromCurrency === 'EUR' && r.toCurrency === 'VES')
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        }
        return _rateHistory;
    }

    /* ═══════════════════════════════════════════════════════════════
       HELPERS UI
       ═══════════════════════════════════════════════════════════════ */

    /** Resuelve el código de moneda: si es válido lo usa, si no, usa el default */
    function _resolve(code) {
        if (code && SUPPORTED.includes(String(code).toUpperCase())) {
            return String(code).toUpperCase();
        }
        return getDefault();
    }

    /** Genera un ID simple */
    function _genId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }

    /**
     * Devuelve HTML de un badge de moneda.
     * @param {'VES'|'EUR'} code
     * @returns {string}
     */
    function getCurrencyBadge(code) {
        const c = CURRENCIES[_resolve(code)];
        if (!c) return '';
        const isVES = c.code === 'VES';
        const bg    = isVES ? '#dcfce7' : '#eff6ff';
        const color = isVES ? '#15803d' : '#1d4ed8';
        return `<span style="display:inline-flex;align-items:center;gap:4px;background:${bg};
                color:${color};font-size:11px;font-weight:700;padding:2px 8px;
                border-radius:20px;white-space:nowrap;">${c.flag} ${c.code}</span>`;
    }

    /**
     * Retorna HTML de un <select> de moneda listo para usar en formularios.
     * @param {string}   currentCode  Moneda seleccionada actualmente
     * @param {string}   onChangeFn   Nombre de función JS a llamar al cambiar
     * @param {object}   opts         { id, name, style, compact }
     * @returns {string}
     */
    function getSelector(currentCode, onChangeFn, opts = {}) {
        const cur  = _resolve(currentCode);
        const id   = opts.id   || ('curr_sel_' + _genId());
        const name = opts.name || 'currency';
        const st   = opts.style || '';
        const onChange = onChangeFn ? `onchange="${onChangeFn}(this.value)"` : '';
        const compact  = opts.compact;

        const options = SUPPORTED.map(code => {
            const c = CURRENCIES[code];
            return `<option value="${code}" ${code === cur ? 'selected' : ''}>${c.flag} ${c.code} — ${c.symbol}</option>`;
        }).join('');

        const baseStyle = compact
            ? 'padding:4px 8px;font-size:12px;border-radius:6px;border:1.5px solid var(--border);background:var(--bg);color:var(--text);cursor:pointer;font-family:inherit;outline:none;' + st
            : 'padding:8px 12px;font-size:13px;border-radius:8px;border:1.5px solid var(--border);background:var(--bg);color:var(--text);cursor:pointer;font-family:inherit;outline:none;width:100%;' + st;

        return `<select id="${id}" name="${name}" ${onChange} style="${baseStyle}"
                    onfocus="this.style.borderColor='var(--primary)'"
                    onblur="this.style.borderColor='var(--border)'">${options}</select>`;
    }

    /* ═══════════════════════════════════════════════════════════════
       PANEL ADMIN: TASAS DE CAMBIO
       ═══════════════════════════════════════════════════════════════ */
    function openRatesPanel() {
        const old = document.getElementById('currencyRatesPanel');
        if (old) old.remove();

        const history  = getRateHistory();
        const current  = getRate();
        const defCurr  = getDefault();
        const defInfo  = CURRENCIES[defCurr];

        const ov = document.createElement('div');
        ov.id = 'currencyRatesPanel';
        ov.style.cssText = 'position:fixed;inset:0;z-index:25000;background:rgba(2,6,23,.8);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px;font-family:Inter,system-ui,sans-serif;';
        ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });

        ov.innerHTML = `
        <div style="background:var(--surface,#0f172a);border:1px solid var(--border,#1e293b);border-radius:20px;
             width:100%;max-width:680px;max-height:90dvh;overflow-y:auto;box-shadow:0 30px 80px rgba(0,0,0,.7);">

            <!-- Header -->
            <div style="display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid var(--border,#1e293b);">
                <div>
                    <div style="font-size:18px;font-weight:800;color:var(--text,#f8fafc);">💱 Monedas &amp; Tasas de Cambio</div>
                    <div style="font-size:12px;color:var(--text-3,#64748b);margin-top:2px;">Administración global · VES / EUR</div>
                </div>
                <button onclick="document.getElementById('currencyRatesPanel').remove()"
                    style="background:none;border:none;color:var(--text-2,#94a3b8);font-size:22px;cursor:pointer;padding:4px 8px;">✕</button>
            </div>

            <div style="padding:24px;display:flex;flex-direction:column;gap:20px;">

                <!-- Moneda principal -->
                <div style="background:var(--surface-2,#1e293b);border-radius:12px;padding:18px 20px;">
                    <div style="font-size:13px;font-weight:700;color:var(--text-2,#94a3b8);margin-bottom:12px;text-transform:uppercase;letter-spacing:.5px;">Moneda principal de la empresa</div>
                    <div style="display:flex;gap:10px;flex-wrap:wrap;">
                        ${SUPPORTED.map(code => {
                            const c   = CURRENCIES[code];
                            const sel = code === defCurr;
                            return `<button onclick="window.CurrencySystem.setDefault('${code}');document.getElementById('currencyRatesPanel').remove();"
                                style="display:flex;align-items:center;gap:10px;padding:12px 20px;border-radius:12px;cursor:pointer;
                                       border:2px solid ${sel ? 'var(--primary,#4f46e5)' : 'var(--border,#1e293b)'};
                                       background:${sel ? 'var(--primary-light,#1e1b4b)' : 'var(--surface,#0f172a)'};
                                       color:var(--text,#f8fafc);font-family:inherit;transition:all .2s;flex:1;min-width:160px;">
                                <span style="font-size:24px;">${c.flag}</span>
                                <div style="text-align:left;">
                                    <div style="font-weight:700;font-size:14px;">${c.code} — ${c.symbol}</div>
                                    <div style="font-size:11px;color:var(--text-3,#64748b);">${c.name}</div>
                                </div>
                                ${sel ? '<span style="margin-left:auto;color:var(--primary,#818cf8);font-size:16px;">✓</span>' : ''}
                            </button>`;
                        }).join('')}
                    </div>
                </div>

                <!-- Tasa actual -->
                <div style="background:var(--surface-2,#1e293b);border-radius:12px;padding:18px 20px;">
                    <div style="font-size:13px;font-weight:700;color:var(--text-2,#94a3b8);margin-bottom:12px;text-transform:uppercase;letter-spacing:.5px;">Tasa de cambio actual</div>
                    <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;flex-wrap:wrap;">
                        <div style="flex:1;background:var(--surface,#0f172a);border-radius:10px;padding:14px 16px;min-width:180px;">
                            <div style="font-size:11px;color:var(--text-3,#64748b);margin-bottom:4px;">1 EUR =</div>
                            <div style="font-size:26px;font-weight:900;color:var(--primary,#818cf8);">${CURRENCIES.VES.format(current)}</div>
                            <div style="font-size:11px;color:var(--text-3,#64748b);margin-top:2px;">Bolívar venezolano</div>
                        </div>
                        <div style="font-size:28px;color:var(--text-3,#475569);">⇄</div>
                        <div style="flex:1;background:var(--surface,#0f172a);border-radius:10px;padding:14px 16px;min-width:180px;">
                            <div style="font-size:11px;color:var(--text-3,#64748b);margin-bottom:4px;">1 VES =</div>
                            <div style="font-size:26px;font-weight:900;color:#1d4ed8;">${CURRENCIES.EUR.format(current > 0 ? 1/current : 0)}</div>
                            <div style="font-size:11px;color:var(--text-3,#64748b);margin-top:2px;">Euro</div>
                        </div>
                    </div>

                    <!-- Actualizar tasa -->
                    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;">
                        <div style="flex:1;min-width:200px;">
                            <label style="font-size:12px;color:var(--text-2,#94a3b8);display:block;margin-bottom:6px;">Nueva tasa (1 EUR = ? VES)</label>
                            <input id="newRateInput" type="number" min="0.01" step="0.01" value="${current}"
                                style="width:100%;padding:10px 12px;border:1.5px solid var(--border,#1e293b);border-radius:8px;
                                       background:var(--bg,#020617);color:var(--text,#f8fafc);font-size:16px;font-family:monospace;
                                       outline:none;"
                                onfocus="this.style.borderColor='var(--primary,#4f46e5)'"
                                onblur="this.style.borderColor='var(--border,#1e293b)'" />
                        </div>
                        <div style="flex:2;min-width:200px;">
                            <label style="font-size:12px;color:var(--text-2,#94a3b8);display:block;margin-bottom:6px;">Nota (opcional)</label>
                            <input id="newRateNotes" type="text" placeholder="Ej: BCV del día"
                                style="width:100%;padding:10px 12px;border:1.5px solid var(--border,#1e293b);border-radius:8px;
                                       background:var(--bg,#020617);color:var(--text,#f8fafc);font-size:14px;font-family:inherit;
                                       outline:none;"
                                onfocus="this.style.borderColor='var(--primary,#4f46e5)'"
                                onblur="this.style.borderColor='var(--border,#1e293b)'" />
                        </div>
                        <button onclick="window._saveNewRate()"
                            style="padding:10px 22px;background:var(--primary-gradient,linear-gradient(135deg,#4f46e5,#7c3aed));
                                   color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;
                                   font-family:inherit;white-space:nowrap;">
                            💾 Actualizar tasa
                        </button>
                    </div>
                </div>

                <!-- Historial de tasas -->
                <div style="background:var(--surface-2,#1e293b);border-radius:12px;padding:18px 20px;">
                    <div style="font-size:13px;font-weight:700;color:var(--text-2,#94a3b8);margin-bottom:12px;text-transform:uppercase;letter-spacing:.5px;">Historial de tasas</div>
                    <div style="max-height:200px;overflow-y:auto;">
                        ${history.length === 0
                            ? '<p style="color:var(--text-3,#64748b);font-size:13px;">Sin historial aún.</p>'
                            : `<table style="width:100%;font-size:12px;border-collapse:collapse;">
                                <thead>
                                    <tr style="color:var(--text-3,#64748b);border-bottom:1px solid var(--border,#1e293b);">
                                        <th style="text-align:left;padding:6px 8px;">Fecha</th>
                                        <th style="text-align:right;padding:6px 8px;">Tasa</th>
                                        <th style="text-align:left;padding:6px 8px;">Usuario</th>
                                        <th style="text-align:left;padding:6px 8px;">Nota</th>
                                        <th style="text-align:center;padding:6px 8px;">Estado</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${history.map(r => `
                                    <tr style="border-bottom:1px solid var(--border-light,#1e293b);${r.isActive ? 'background:rgba(79,70,229,.08);' : ''}">
                                        <td style="padding:7px 8px;color:var(--text,#f8fafc);">${r.date || r.createdAt?.slice(0,10) || '—'}</td>
                                        <td style="padding:7px 8px;text-align:right;font-weight:700;color:var(--primary,#818cf8);font-family:monospace;">
                                            1 EUR = ${CURRENCIES.VES.format(r.rate)}
                                        </td>
                                        <td style="padding:7px 8px;color:var(--text-2,#94a3b8);">${r.createdBy || '—'}</td>
                                        <td style="padding:7px 8px;color:var(--text-3,#64748b);">${r.notes || '—'}</td>
                                        <td style="padding:7px 8px;text-align:center;">
                                            ${r.isActive
                                                ? '<span style="background:#dcfce7;color:#15803d;font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;">ACTIVA</span>'
                                                : '<span style="background:var(--surface,#0f172a);color:var(--text-3,#64748b);font-size:10px;padding:2px 8px;border-radius:20px;">HISTÓRICA</span>'}
                                        </td>
                                    </tr>`).join('')}
                                </tbody>
                            </table>`}
                    </div>
                </div>

                <!-- Nota importante -->
                <div style="background:#1c1a06;border:1px solid #a16207;border-radius:10px;padding:12px 16px;font-size:12px;color:#fbbf24;line-height:1.6;">
                    ⚠️ <strong>Importante:</strong> Cambiar la tasa NO modifica operaciones históricas.
                    Cada operación registrada conserva la tasa y moneda del momento en que se realizó.
                    La nueva tasa aplica solo a operaciones futuras y conversiones en reportes.
                </div>

            </div>
        </div>`;

        document.body.appendChild(ov);
    }

    /* ═══════════════════════════════════════════════════════════════
       PANEL DE ESTADÍSTICAS POR MONEDA
       ═══════════════════════════════════════════════════════════════ */
    function openStatsPanel() {
        if (typeof data === 'undefined') return;

        const rate = getRate();

        // Calcular stats desde data local
        const salesVES = data.sales.filter(s => (s.currency || getDefault()) === 'VES').reduce((a,s)=>a+(s.total||0),0);
        const salesEUR = data.sales.filter(s => s.currency === 'EUR').reduce((a,s)=>a+(s.total||0),0);
        const expVES   = data.expenses.filter(e=>(e.currency||getDefault())==='VES'&&e.status!=='anulado').reduce((a,e)=>a+(e.amount||0),0);
        const expEUR   = data.expenses.filter(e=>e.currency==='EUR'&&e.status!=='anulado').reduce((a,e)=>a+(e.amount||0),0);
        const invVES   = data.products.filter(p=>(p.currency||getDefault())==='VES').reduce((a,p)=>a+(p.price||0)*(p.stock||0),0);
        const invEUR   = data.products.filter(p=>p.currency==='EUR').reduce((a,p)=>a+(p.price||0)*(p.stock||0),0);
        const profVES  = salesVES - expVES;
        const profEUR  = salesEUR - expEUR;

        const old = document.getElementById('currencyStatsPanel');
        if (old) old.remove();

        const ov = document.createElement('div');
        ov.id = 'currencyStatsPanel';
        ov.style.cssText = 'position:fixed;inset:0;z-index:25000;background:rgba(2,6,23,.8);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px;font-family:Inter,system-ui,sans-serif;';
        ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });

        const _row = (label, ves, eur) => `
            <tr style="border-bottom:1px solid var(--border-light,#1e293b);">
                <td style="padding:10px 12px;color:var(--text,#f8fafc);font-weight:500;">${label}</td>
                <td style="padding:10px 12px;text-align:right;font-weight:700;color:#15803d;">${format(ves,'VES')}</td>
                <td style="padding:10px 12px;text-align:right;font-weight:700;color:#1d4ed8;">${format(eur,'EUR')}</td>
                <td style="padding:10px 12px;text-align:right;color:var(--text-2,#94a3b8);font-size:12px;">${format(ves + eur*rate,'VES')}</td>
            </tr>`;

        ov.innerHTML = `
        <div style="background:var(--surface,#0f172a);border:1px solid var(--border,#1e293b);border-radius:20px;
             width:100%;max-width:700px;max-height:90dvh;overflow-y:auto;box-shadow:0 30px 80px rgba(0,0,0,.7);">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid var(--border,#1e293b);">
                <div>
                    <div style="font-size:18px;font-weight:800;color:var(--text,#f8fafc);">📊 Estadísticas por Moneda</div>
                    <div style="font-size:12px;color:var(--text-3,#64748b);margin-top:2px;">Tasa activa: 1 EUR = ${format(rate,'VES')}</div>
                </div>
                <button onclick="document.getElementById('currencyStatsPanel').remove()"
                    style="background:none;border:none;color:var(--text-2,#94a3b8);font-size:22px;cursor:pointer;padding:4px 8px;">✕</button>
            </div>
            <div style="padding:24px;">
                <table style="width:100%;border-collapse:collapse;">
                    <thead>
                        <tr style="color:var(--text-3,#64748b);font-size:12px;border-bottom:2px solid var(--border,#1e293b);">
                            <th style="text-align:left;padding:8px 12px;">Concepto</th>
                            <th style="text-align:right;padding:8px 12px;">🇻🇪 VES</th>
                            <th style="text-align:right;padding:8px 12px;">🇪🇺 EUR</th>
                            <th style="text-align:right;padding:8px 12px;">Total (en VES)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${_row('💰 Ventas',       salesVES, salesEUR)}
                        ${_row('📦 Inventario',   invVES,   invEUR)}
                        ${_row('💸 Gastos',       expVES,   expEUR)}
                        ${_row('📈 Ganancias',    profVES,  profEUR)}
                    </tbody>
                </table>
                <div style="margin-top:16px;background:var(--surface-2,#1e293b);border-radius:10px;padding:14px 16px;font-size:12px;color:var(--text-2,#94a3b8);">
                    ℹ️ La columna <strong>Total (en VES)</strong> convierte los valores EUR a VES usando la tasa activa
                    (<strong>1 EUR = ${format(rate,'VES')}</strong>). Los valores originales siempre se conservan.
                </div>
            </div>
        </div>`;

        document.body.appendChild(ov);
    }

    /* ═══════════════════════════════════════════════════════════════
       INTEGRACIÓN CON CONFIGURACIÓN
       ═══════════════════════════════════════════════════════════════ */

    /** Actualiza el badge de moneda en el panel de Configuración */
    function _updateSettingsBadge() {
        const el = document.getElementById('currencyDefaultDisplay');
        if (!el) return;
        const c = CURRENCIES[getDefault()];
        el.innerHTML = `${c.flag} ${c.code} — ${c.name} <span style="font-size:11px;color:var(--text-3);">(${c.symbol})</span>`;
    }

    /**
     * Renderiza el bloque de Monedas & Tasas dentro del panel de Configuración.
     * Se inserta dinámicamente al cargar el módulo.
     */
    function renderCurrencySettings() {
        const target = document.getElementById('currencySettingsBlock');
        if (!target) return;
        const defCurr  = getDefault();
        const rateEUR  = getRateFor('EUR', 'VES');
        const rateUSD  = getRateFor('USD', 'VES');
        const history  = getRateHistory().slice(0, 5);
        const c        = CURRENCIES[defCurr];
        const cache    = _rateCache;
        const { icon, label } = _statusInfo(cache.status || 'initializing');

        target.innerHTML = `
        <div class="card mt-4" id="currencySettingsCard">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
                <h4 style="font-weight:700;color:var(--text);display:flex;align-items:center;gap:8px;">
                    💱 Monedas &amp; Tasas de Cambio BCV
                </h4>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button onclick="window.CurrencySystem.openRatesHistory()"
                        style="padding:6px 14px;background:var(--surface-2);border:1px solid var(--border);
                               color:var(--text-2);border-radius:8px;cursor:pointer;font-family:inherit;font-size:12px;">
                        📈 Historial BCV
                    </button>
                    <button onclick="window.CurrencySystem.openStatsPanel()"
                        style="padding:6px 14px;background:var(--surface-2);border:1px solid var(--border);
                               color:var(--text-2);border-radius:8px;cursor:pointer;font-family:inherit;font-size:12px;">
                        📊 Estadísticas
                    </button>
                    <button onclick="window.CurrencySystem.refreshRates('admin-settings')"
                        style="padding:6px 14px;background:var(--primary-gradient);border:none;
                               color:#fff;border-radius:8px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:700;">
                        🔄 Actualizar ahora
                    </button>
                </div>
            </div>

            <!-- Estado BCV -->
            <div style="background:var(--surface-2);border-radius:10px;padding:12px 16px;margin-bottom:14px;
                        display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
                <div style="font-size:12px;color:var(--text-2);">
                    Estado: <strong style="color:${cache.status==='ok'?'#16a34a':cache.status==='error'?'#dc2626':'#d97706'};">${icon} ${label}</strong>
                </div>
                <div style="font-size:11px;color:var(--text-3);">
                    Fuente: ${cache.source || 'BCV (bcv.today)'} &nbsp;·&nbsp;
                    Vigente: <strong>${cache.date || '—'}</strong>
                </div>
            </div>

            <!-- Tasas actuales -->
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px;">
                <div style="background:var(--surface-2);border-radius:10px;padding:12px 14px;">
                    <div style="font-size:10px;color:var(--text-3);margin-bottom:4px;">🇺🇸 USD/VES (BCV)</div>
                    <div style="font-size:20px;font-weight:800;color:#3b82f6;font-family:monospace;">${CURRENCIES.VES.format(rateUSD)}</div>
                </div>
                <div style="background:var(--surface-2);border-radius:10px;padding:12px 14px;">
                    <div style="font-size:10px;color:var(--text-3);margin-bottom:4px;">🇪🇺 EUR/VES (BCV)</div>
                    <div style="font-size:20px;font-weight:800;color:#8b5cf6;font-family:monospace;">${CURRENCIES.VES.format(rateEUR)}</div>
                </div>
                <div style="background:var(--surface-2);border-radius:10px;padding:12px 14px;">
                    <div style="font-size:10px;color:var(--text-3);margin-bottom:4px;">🇪🇺→🇺🇸 EUR/USD</div>
                    <div style="font-size:20px;font-weight:800;color:var(--text);font-family:monospace;">
                        ${CURRENCIES.USD.format(rateUSD > 0 ? rateEUR / rateUSD : 0)}
                    </div>
                </div>
            </div>

            <!-- Moneda principal -->
            <div style="background:var(--surface-2);border-radius:10px;padding:14px 16px;margin-bottom:14px;">
                <div style="font-size:12px;font-weight:700;color:var(--text-2);margin-bottom:10px;">Moneda principal de la empresa</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    ${SUPPORTED.map(code => {
                        const cu = CURRENCIES[code];
                        const sel = code === defCurr;
                        return `<button onclick="window.CurrencySystem.setDefault('${code}')"
                            style="display:flex;align-items:center;gap:8px;padding:8px 16px;border-radius:10px;cursor:pointer;
                                   border:2px solid ${sel ? 'var(--primary)' : 'var(--border)'};
                                   background:${sel ? 'var(--primary-light)' : 'var(--surface)'};
                                   color:var(--text);font-family:inherit;font-size:13px;font-weight:${sel?700:500};">
                            <span>${cu.flag}</span> <span>${cu.code}</span>
                            ${sel ? '<span style="color:var(--primary);font-size:14px;">✓</span>' : ''}
                        </button>`;
                    }).join('')}
                </div>
            </div>

            <!-- Actualización rápida manual -->
            <div style="background:var(--surface-2);border-radius:10px;padding:14px 16px;margin-bottom:14px;">
                <div style="font-size:12px;font-weight:700;color:var(--text-2);margin-bottom:10px;">
                    Ingresar tasa manualmente <span style="font-size:10px;font-weight:400;color:var(--text-3);">(si la fuente no está disponible)</span>
                </div>
                <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;">
                    <div>
                        <label style="font-size:11px;color:var(--text-3);display:block;margin-bottom:4px;">Par</label>
                        <select id="manualRatePair" style="padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-family:inherit;font-size:13px;outline:none;">
                            <option value="USD_VES">🇺🇸 USD → 🇻🇪 VES</option>
                            <option value="EUR_VES">🇪🇺 EUR → 🇻🇪 VES</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size:11px;color:var(--text-3);display:block;margin-bottom:4px;">Tasa</label>
                        <input id="manualRateValue" type="number" min="0.01" step="0.01" value="${rateUSD}"
                            style="width:130px;padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:14px;font-family:monospace;outline:none;"
                            onfocus="this.style.borderColor='var(--primary)'" onblur="this.style.borderColor='var(--border)'" />
                    </div>
                    <div style="flex:1;min-width:140px;">
                        <label style="font-size:11px;color:var(--text-3);display:block;margin-bottom:4px;">Nota</label>
                        <input id="manualRateNote" type="text" placeholder="Ej: BCV manual"
                            style="width:100%;padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:13px;font-family:inherit;outline:none;"
                            onfocus="this.style.borderColor='var(--primary)'" onblur="this.style.borderColor='var(--border)'" />
                    </div>
                    <button onclick="window._saveManualRate()"
                        style="padding:7px 16px;background:var(--surface);border:1px solid var(--border);
                               color:var(--text-2);border-radius:8px;font-weight:700;cursor:pointer;
                               font-family:inherit;font-size:13px;white-space:nowrap;">
                        💾 Guardar manual
                    </button>
                </div>
            </div>

            <!-- Mini historial EUR -->
            ${history.length > 0 ? `
            <div style="font-size:11px;color:var(--text-3);margin-bottom:6px;font-weight:600;">Últimas tasas EUR/VES</div>
            <div style="display:flex;flex-direction:column;gap:3px;max-height:120px;overflow-y:auto;">
                ${history.map(r => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 10px;
                            background:${r.isActive?'rgba(79,70,229,.08)':'var(--surface-2)'};border-radius:7px;">
                    <span style="color:var(--text-2);font-size:11px;">${r.date||r.createdAt?.slice(0,10)}</span>
                    <span style="font-weight:700;color:var(--primary);font-family:monospace;font-size:12px;">1 EUR = ${CURRENCIES.VES.format(r.rate)}</span>
                    <span style="font-size:10px;color:var(--text-3);">${r.updateType==='auto'?'🤖':'👤'} ${r.createdBy||''}</span>
                    ${r.isActive ? '<span style="background:#dcfce7;color:#15803d;font-size:9px;font-weight:700;padding:1px 6px;border-radius:20px;">ACTIVA</span>' : ''}
                </div>`).join('')}
            </div>` : ''}

            <!-- Aviso cron automático -->
            <div style="margin-top:14px;background:rgba(16,185,129,.07);border:1px solid rgba(16,185,129,.2);
                        border-radius:10px;padding:10px 14px;font-size:12px;color:#6ee7b7;line-height:1.6;">
                🤖 <strong>Actualización automática:</strong> El sistema consulta la fuente BCV todos los días
                a las 08:00 AM hora Venezuela y actualiza las tasas sin intervención del usuario.
                Si la fuente falla, se mantiene la última tasa válida y se reintenta automáticamente.
            </div>
        </div>`;
    }

    /* ═══════════════════════════════════════════════════════════════
       HELPERS GLOBALES NECESARIOS POR EL HTML INLINE
       ═══════════════════════════════════════════════════════════════ */

    window._saveNewRate = async function() {
        const val   = parseFloat(document.getElementById('newRateInput')?.value);
        const notes = document.getElementById('newRateNotes')?.value?.trim() || '';
        await CurrencySystem.setRate(val, notes);
        const panel = document.getElementById('currencyRatesPanel');
        if (panel) panel.remove();
        setTimeout(() => CurrencySystem.openRatesPanel(), 200);
    };

    window._quickSaveRate = async function() {
        const val   = parseFloat(document.getElementById('quickRateInput')?.value);
        const notes = document.getElementById('quickRateNotes')?.value?.trim() || '';
        await CurrencySystem.setRate(val, notes);
        CurrencySystem.renderCurrencySettings();
    };

    window._saveManualRate = async function() {
        const pair  = document.getElementById('manualRatePair')?.value || 'USD_VES';
        const val   = parseFloat(document.getElementById('manualRateValue')?.value);
        const notes = document.getElementById('manualRateNote')?.value?.trim() || 'Manual';
        const [from, to] = pair.split('_');
        if (!val || val <= 0) { if (typeof showToast === 'function') showToast('⚠️', 'Tasa inválida'); return; }
        const tok = localStorage.getItem('fixpromax_token') || '';
        try {
            const r = await fetch(CurrencySystem._apiBase ? CurrencySystem._apiBase() + '/api/rates/manual' : '/api/rates/manual', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
                body: JSON.stringify({ fromCurrency: from, toCurrency: to, rate: val, notes }),
            });
            const j = await r.json();
            if (j.ok) {
                if (from === 'EUR') { window.CurrencySystem._setActiveRate && window.CurrencySystem._setActiveRate(val); }
                CurrencySystem.renderCurrencySettings();
                if (typeof showToast === 'function') showToast('✅', `Tasa manual guardada: 1 ${from} = ${val} ${to}`);
                if (typeof renderAll === 'function') renderAll();
            } else {
                if (typeof showToast === 'function') showToast('⚠️', j.error || 'Error al guardar');
            }
        } catch (e) {
            if (typeof showToast === 'function') showToast('⚠️', 'Error de conexión');
        }
    };

    /* ═══════════════════════════════════════════════════════════════
       CONVERSIÓN PARA REPORTES — helper público
       ═══════════════════════════════════════════════════════════════ */

    /**
     * Retorna HTML para mostrar una conversión de moneda en reportes.
     * @param {number} amount
     * @param {'VES'|'EUR'} from
     * @param {'VES'|'EUR'} to
     * @returns {string}
     */
    function conversionNote(amount, from, to) {
        if (from === to) return '';
        const result = convert(amount, from, to);
        const rate   = getRate();
        return `<div style="font-size:11px;color:var(--text-3,#64748b);margin-top:2px;">
            ${format(amount,from)} × (1 ${from}=${from==='EUR'?format(rate,'VES'):'1/'+format(rate,'VES')}) = <strong>${format(result.amount,to)}</strong>
        </div>`;
    }

    /* ═══════════════════════════════════════════════════════════════
       INICIALIZACIÓN
       ═══════════════════════════════════════════════════════════════ */
    async function init() {
        if (_initialized) return;
        _initialized = true;

        // Sincronizar desde data inyectado por servidor
        if (typeof data !== 'undefined') {
            if (data.settings?.defaultCurrency) {
                _defaultCurrency = data.settings.defaultCurrency;
            }
            // Cargar tasas del cache local
            if (Array.isArray(data.exchangeRates)) {
                const eurR = data.exchangeRates.find(r => r.fromCurrency === 'EUR' && r.isActive);
                const usdR = data.exchangeRates.find(r => r.fromCurrency === 'USD' && r.isActive);
                if (eurR) { _activeRate    = eurR.rate; _rateCache.EUR = eurR.rate; }
                if (usdR) { _activeRateUSD = usdR.rate; _rateCache.USD = usdR.rate; }
            }
        }

        // Renderizar bloque en Configuración si existe el contenedor
        if (document.getElementById('currencySettingsBlock')) {
            renderCurrencySettings();
        }

        // Cargar tasas frescas desde la API del backend (no bloqueante)
        loadRatesFromAPI();

        // Ejecutar migración automática silenciosa si hay datos sin currency
        await _autoMigrate();
    }

    /**
     * Carga las tasas actuales desde el backend y actualiza toda la UI.
     * Se llama al iniciar y puede llamarse manualmente.
     * NO hace fetch directo a fuentes externas — solo consulta el backend propio.
     */
    async function loadRatesFromAPI() {
        try {
            const resp = await _get('/api/rates/current');
            if (!resp) return;

            const { USD, EUR, date, source, sourceName, status, serviceStatus } = resp;

            // Actualizar cache interno
            if (USD && USD > 0) { _activeRateUSD = USD; _rateCache.USD = USD; }
            if (EUR && EUR > 0) { _activeRate    = EUR; _rateCache.EUR = EUR; }
            _rateCache.date   = date;
            _rateCache.source = sourceName || source;
            _rateCache.status = serviceStatus?.status || status || 'ok';

            // Actualizar data local para que otras funciones lo lean
            if (typeof data !== 'undefined') {
                if (!Array.isArray(data.exchangeRates)) data.exchangeRates = [];
                // Actualizar la tasa activa en memoria (sin afectar historial)
                ['USD', 'EUR'].forEach(curr => {
                    const val = curr === 'USD' ? USD : EUR;
                    if (!val || val <= 0) return;
                    const existing = data.exchangeRates.find(r =>
                        r.fromCurrency === curr && r.toCurrency === 'VES' && r.isActive);
                    if (existing) {
                        existing.rate      = val;
                        existing.updatedAt = new Date().toISOString();
                    }
                });
            }

            // Actualizar todos los widgets de tasas en pantalla
            _updateRateWidgets();

            // Renderizar bloque de settings si está visible
            if (document.getElementById('currencySettingsBlock')) {
                renderCurrencySettings();
            }

        } catch (e) {
            console.warn('[CurrencySystem] No se pudieron cargar tasas desde API:', e.message);
        }
    }

    /** Actualiza todos los elementos DOM que muestran tasas */
    function _updateRateWidgets() {
        const usd = _rateCache.USD || _activeRateUSD;
        const eur = _rateCache.EUR || _activeRate;
        const date = _rateCache.date || '—';
        const status = _rateCache.status || 'ok';

        // Widget en dashboard
        const w = document.getElementById('bcvRateWidget');
        if (w) w.innerHTML = _buildRateWidgetHTML(usd, eur, date, status);

        // Indicadores individuales
        _setInner('bcvRateUSD',  usd  ? CURRENCIES.VES.format(usd)  : '—');
        _setInner('bcvRateEUR',  eur  ? CURRENCIES.VES.format(eur)  : '—');
        _setInner('bcvRateDate', date);

        // Badge de estado
        const badge = document.getElementById('bcvRateStatus');
        if (badge) {
            const { icon, label, color } = _statusInfo(status);
            badge.innerHTML  = `${icon} ${label}`;
            badge.style.color = color;
        }
    }

    function _setInner(id, html) {
        const el = document.getElementById(id);
        if (el) el.innerHTML = html;
    }

    function _statusInfo(status) {
        if (status === 'ok')          return { icon: '🟢', label: 'Actualizada',             color: '#16a34a' };
        if (status === 'pending')     return { icon: '🟡', label: 'Actualización pendiente', color: '#d97706' };
        if (status === 'error')       return { icon: '🔴', label: 'Error de actualización',  color: '#dc2626' };
        if (status === 'initializing')return { icon: '⚪', label: 'Iniciando...',             color: '#64748b' };
        return                               { icon: '🟡', label: 'Sin datos',               color: '#64748b' };
    }

    function _buildRateWidgetHTML(usd, eur, date, status) {
        const { icon, label, color } = _statusInfo(status);
        const src = _rateCache.source || 'BCV';
        return `
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap;">
            <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
                         color:var(--text-3,#64748b);">Tasas BCV</span>
            <span style="font-size:10px;color:${color};font-weight:700;">${icon} ${label}</span>
        </div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;">
            <div>
                <div style="font-size:10px;color:var(--text-3,#64748b);">🇺🇸 USD/VES</div>
                <div style="font-size:17px;font-weight:800;color:var(--text,#f8fafc);font-family:monospace;" id="bcvRateUSD">
                    ${usd ? CURRENCIES.VES.format(usd) : '—'}
                </div>
            </div>
            <div>
                <div style="font-size:10px;color:var(--text-3,#64748b);">🇪🇺 EUR/VES</div>
                <div style="font-size:17px;font-weight:800;color:var(--text,#f8fafc);font-family:monospace;" id="bcvRateEUR">
                    ${eur ? CURRENCIES.VES.format(eur) : '—'}
                </div>
            </div>
        </div>
        <div style="font-size:10px;color:var(--text-3,#64748b);margin-top:6px;">
            Vigente: <strong id="bcvRateDate">${date}</strong> · Fuente: ${src}
        </div>`;
    }

    /** Activa una actualización manual de tasas desde el backend */
    async function refreshRates(triggeredBy) {
        if (typeof showToast === 'function') showToast('⏳', 'Consultando tasas BCV...');
        const result = await _post('/api/rates/update', { triggeredBy: triggeredBy || 'manual-ui' });
        if (result?.success) {
            _rateCache.USD    = result.USD;
            _rateCache.EUR    = result.EUR;
            _activeRateUSD    = result.USD;
            _activeRate       = result.EUR;
            _rateCache.date   = result.date;
            _rateCache.source = result.source;
            _rateCache.status = 'ok';
            _updateRateWidgets();
            if (document.getElementById('currencySettingsBlock')) renderCurrencySettings();
            if (typeof showToast === 'function')
                showToast('✅', `Tasas actualizadas: 1 USD = ${CURRENCIES.VES.format(result.USD)} · 1 EUR = ${CURRENCIES.VES.format(result.EUR)}`);
            if (typeof renderAll === 'function') renderAll();
        } else {
            if (typeof showToast === 'function')
                showToast('⚠️', result?.error || 'No se pudo obtener la tasa. Se usa la última válida.');
        }
        return result;
    }

    /** Abre el panel completo de historial de tasas BCV */
    async function openRatesHistory() {
        const old = document.getElementById('bcvRatesHistoryPanel');
        if (old) old.remove();

        const resp = await _get('/api/rates/history');
        if (!resp) { if (typeof showToast === 'function') showToast('⚠️', 'No se pudo cargar historial'); return; }

        const { rates, currentUSD, currentEUR, serviceStatus } = resp;
        const svc = serviceStatus || {};
        const { icon, label, color } = _statusInfo(svc.status);

        const ov = document.createElement('div');
        ov.id = 'bcvRatesHistoryPanel';
        ov.style.cssText = 'position:fixed;inset:0;z-index:26000;background:rgba(2,6,23,.85);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px;font-family:Inter,system-ui,sans-serif;';
        ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });

        const usdRates = rates.filter(r => r.fromCurrency === 'USD').slice(0, 50);
        const eurRates = rates.filter(r => r.fromCurrency === 'EUR').slice(0, 50);

        const _rateTable = (rows, curr) => rows.length === 0
            ? '<p style="color:var(--text-3,#64748b);font-size:13px;padding:12px;">Sin historial aún.</p>'
            : `<table style="width:100%;font-size:11px;border-collapse:collapse;">
                <thead><tr style="color:var(--text-3,#64748b);border-bottom:1px solid var(--border,#1e293b);">
                    <th style="text-align:left;padding:5px 6px;">Fecha</th>
                    <th style="text-align:right;padding:5px 6px;">${curr}/VES</th>
                    <th style="text-align:left;padding:5px 6px;">Tipo</th>
                    <th style="text-align:left;padding:5px 6px;">Fuente</th>
                    <th style="text-align:center;padding:5px 6px;">Estado</th>
                </tr></thead>
                <tbody>${rows.map(r => `
                <tr style="border-bottom:1px solid var(--border-light,#1e293b);${r.isActive ? 'background:rgba(79,70,229,.07);' : ''}">
                    <td style="padding:5px 6px;color:var(--text,#f8fafc);">${r.date || r.createdAt?.slice(0,10)}</td>
                    <td style="padding:5px 6px;text-align:right;font-weight:700;color:var(--primary,#818cf8);font-family:monospace;">
                        ${CURRENCIES.VES.format(r.rate)}</td>
                    <td style="padding:5px 6px;">
                        <span style="font-size:10px;padding:2px 6px;border-radius:20px;
                            background:${r.updateType==='auto'?'rgba(16,185,129,.15)':'rgba(79,70,229,.15)'};
                            color:${r.updateType==='auto'?'#6ee7b7':'#a5b4fc'};">
                            ${r.updateType==='auto'?'🤖 Auto':'👤 Manual'}</span></td>
                    <td style="padding:5px 6px;color:var(--text-3,#64748b);font-size:10px;">${r.sourceName||r.source||'—'}</td>
                    <td style="padding:5px 6px;text-align:center;">
                        ${r.isActive ? '<span style="background:#dcfce7;color:#15803d;font-size:10px;font-weight:700;padding:1px 6px;border-radius:20px;">ACTIVA</span>' : ''}</td>
                </tr>`).join('')}</tbody></table>`;

        ov.innerHTML = `
        <div style="background:var(--surface,#0f172a);border:1px solid var(--border,#1e293b);border-radius:20px;
             width:100%;max-width:780px;max-height:92dvh;overflow-y:auto;box-shadow:0 30px 80px rgba(0,0,0,.7);">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid var(--border,#1e293b);">
                <div>
                    <div style="font-size:18px;font-weight:800;color:var(--text,#f8fafc);">📈 Historial de Tasas BCV</div>
                    <div style="font-size:12px;color:var(--text-3,#64748b);margin-top:2px;">
                        ${icon} ${label} &nbsp;·&nbsp;
                        ${svc.lastSuccess ? 'Última actualización: ' + new Date(svc.lastSuccess).toLocaleString('es-VE') : 'Sin actualización registrada'}
                    </div>
                </div>
                <div style="display:flex;gap:8px;align-items:center;">
                    <button onclick="window.CurrencySystem.refreshRates('admin-panel').then(()=>document.getElementById('bcvRatesHistoryPanel')?.remove())"
                        style="padding:7px 16px;background:var(--primary-gradient,linear-gradient(135deg,#4f46e5,#7c3aed));
                               color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;
                               font-family:inherit;font-size:12px;">
                        🔄 Actualizar ahora
                    </button>
                    <button onclick="document.getElementById('bcvRatesHistoryPanel').remove()"
                        style="background:none;border:none;color:var(--text-2,#94a3b8);font-size:22px;cursor:pointer;padding:4px 8px;">✕</button>
                </div>
            </div>
            <div style="padding:20px 24px;display:flex;flex-direction:column;gap:16px;">

                <!-- Tasas actuales -->
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                    ${[
                        { label:'🇺🇸 USD/VES', rate: currentUSD, color:'#3b82f6' },
                        { label:'🇪🇺 EUR/VES', rate: currentEUR, color:'#8b5cf6' },
                    ].map(t => `
                    <div style="background:var(--surface-2,#1e293b);border-radius:12px;padding:14px 16px;">
                        <div style="font-size:11px;color:var(--text-3,#64748b);margin-bottom:4px;">${t.label}</div>
                        <div style="font-size:22px;font-weight:900;color:${t.color};font-family:monospace;">
                            ${t.rate ? CURRENCIES.VES.format(t.rate.rate) : '—'}
                        </div>
                        <div style="font-size:10px;color:var(--text-3,#64748b);margin-top:2px;">
                            ${t.rate?.date || '—'} · ${t.rate?.sourceName || t.rate?.source || '—'}
                        </div>
                    </div>`).join('')}
                </div>

                <!-- Servicio info -->
                <div style="background:var(--surface-2,#1e293b);border-radius:10px;padding:12px 16px;font-size:12px;display:flex;gap:20px;flex-wrap:wrap;">
                    <div><span style="color:var(--text-3,#64748b);">Fuente principal:</span> <strong style="color:var(--text,#f8fafc);">${svc.config?.primaryUrl||'bcv.today'}</strong></div>
                    <div><span style="color:var(--text-3,#64748b);">Actualizaciones:</span> <strong style="color:#6ee7b7;">${svc.updateCount||0} éxitos</strong></div>
                    <div><span style="color:var(--text-3,#64748b);">Fallos consecutivos:</span> <strong style="color:${(svc.failCount||0)>0?'#fca5a5':'#6ee7b7'}">${svc.failCount||0}</strong></div>
                    <div><span style="color:var(--text-3,#64748b);">Cron diario:</span> <strong style="color:var(--text,#f8fafc);">08:00 hora Venezuela</strong></div>
                </div>

                <!-- Tablas historial -->
                <div>
                    <div style="font-size:13px;font-weight:700;color:var(--text,#f8fafc);margin-bottom:8px;">🇺🇸 Historial USD/VES</div>
                    <div style="max-height:200px;overflow-y:auto;background:var(--surface-2,#1e293b);border-radius:10px;padding:8px;">
                        ${_rateTable(usdRates, 'USD')}
                    </div>
                </div>
                <div>
                    <div style="font-size:13px;font-weight:700;color:var(--text,#f8fafc);margin-bottom:8px;">🇪🇺 Historial EUR/VES</div>
                    <div style="max-height:200px;overflow-y:auto;background:var(--surface-2,#1e293b);border-radius:10px;padding:8px;">
                        ${_rateTable(eurRates, 'EUR')}
                    </div>
                </div>

                <!-- Aviso -->
                <div style="background:#1c1a06;border:1px solid #a16207;border-radius:10px;padding:10px 16px;font-size:12px;color:#fbbf24;line-height:1.6;">
                    ⚠️ Las tasas históricas <strong>nunca modifican operaciones pasadas</strong>.
                    Cada venta, factura y gasto conserva la tasa que estaba vigente al momento de su creación.
                    La nueva tasa aplica solo a operaciones futuras y conversiones en reportes.
                </div>
            </div>
        </div>`;

        document.body.appendChild(ov);
    }

    /** Migración silenciosa: añade campo currency a registros sin él */
    async function _autoMigrate() {
        if (typeof data === 'undefined') return;
        const defCurr  = getDefault();
        const cols = ['products','sales','invoices','expenses','purchases','quotes','payments'];
        let migrated = 0;
        cols.forEach(col => {
            if (!Array.isArray(data[col])) return;
            data[col].forEach(item => {
                if (item && !item.currency) {
                    item.currency = defCurr;
                    migrated++;
                }
            });
        });
        if (migrated > 0 && typeof persist === 'function') {
            persist();
        }
    }

    /* ═══════════════════════════════════════════════════════════════
       EXPORTACIÓN PÚBLICA
       ═══════════════════════════════════════════════════════════════ */
    window.CurrencySystem = {
        format,
        getDefault,
        setDefault,
        getRate,
        getRateFor,
        setRate,
        convert,
        getRateHistory,
        getSelector,
        getCurrencyBadge,
        openRatesPanel,
        openRatesHistory,
        openStatsPanel,
        renderCurrencySettings,
        conversionNote,
        loadRatesFromAPI,
        refreshRates,
        init,
        CURRENCIES,
        SUPPORTED,
        get rateCache() { return { ..._rateCache }; },
    };

    // Iniciar cuando el DOM esté listo
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        // Diferir un tick para que data esté disponible
        setTimeout(init, 0);
    }

})();
