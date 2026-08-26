#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Inyectar SSE listener en auth.js — antes del cierre })();
"""
FILE = r'c:\Users\USUARIO\Downloads\Nueva carpeta (2)\auth.js'

with open(FILE, 'r', encoding='utf-8') as f:
    content = f.read()

sse_code = r'''
    /* ══════════════════════════════════════════════════════════════════════
       SSE — CONEXIÓN EN TIEMPO REAL CON EL SERVIDOR
       Escucha: session_revoked, permissions_updated, config_updated,
       subscription_updated, plan_updated, exchange_rate_updated.
       ══════════════════════════════════════════════════════════════════════ */
    let _appSSE       = null;
    let _appSSEDelay  = 3000;
    let _appSSETimer  = null;
    let _appSSEActive = false;

    function _startAppSSE() {
        if (_appSSETimer) { clearTimeout(_appSSETimer); _appSSETimer = null; }
        if (_appSSE) { try { _appSSE.close(); } catch {} _appSSE = null; }
        const tok = localStorage.getItem(AUTH_KEY);
        if (!tok || tok.startsWith('lt_') || window.location.protocol === 'file:') return;
        const origin = window.location.origin;
        _appSSE = new EventSource(origin + '/api/events?token=' + encodeURIComponent(tok));

        _appSSE.addEventListener('connected', () => {
            _appSSEActive = true;
            _appSSEDelay  = 3000;
        });

        /* Sesión revocada — admin suspendió la cuenta */
        _appSSE.addEventListener('session_revoked', (e) => {
            try {
                const d = JSON.parse(e.data);
                try { _appSSE.close(); } catch {}
                _appSSE = null; _appSSEActive = false;
                localStorage.removeItem(AUTH_KEY);
                localStorage.removeItem('fixpromax_sub_cache');
                window._currentUser = null;
                const reason = d.reason || 'Tu cuenta fue suspendida por el administrador.';
                // Mostrar mensaje y forzar vuelta al login
                const showLogin = () => {
                    document.getElementById('appMain')?.classList.remove('visible');
                    const pw = document.getElementById('paywallScreen');
                    if (pw) pw.style.display = 'none';
                    const auth = document.getElementById('authScreen');
                    if (auth) { auth.style.display = 'flex'; }
                    if (typeof switchAuthTab === 'function') switchAuthTab('login');
                };
                // Usar toast si existe, si no, alert
                if (typeof _toast === 'function') {
                    _toast('🚫', reason);
                    setTimeout(showLogin, 1800);
                } else {
                    alert('Sesion cerrada: ' + reason);
                    showLogin();
                }
            } catch (err) { console.error('[SSE] session_revoked error:', err); }
        });

        /* Permisos actualizados por el admin */
        _appSSE.addEventListener('permissions_updated', (e) => {
            try {
                const d = JSON.parse(e.data);
                if (window._currentUser) window._currentUser.permissions = d.permissions;
                window.dispatchEvent(new CustomEvent('fpm:permissions_updated', { detail: d }));
                // Refrescar datos del servidor para aplicar nuevos permisos
                if (typeof window._syncFromServer === 'function') {
                    window._syncFromServer();
                } else {
                    setTimeout(() => { if (typeof renderAll === 'function') renderAll(); }, 500);
                }
                if (typeof _toast === 'function') _toast('🔑', 'Tus permisos fueron actualizados.');
            } catch {}
        });

        /* Config global cambiada (trialDays, maintenanceMode, etc.) */
        _appSSE.addEventListener('config_updated', (e) => {
            try {
                const d = JSON.parse(e.data);
                if (d.trialDays) sessionStorage.setItem('fpm_trialDays', String(d.trialDays));
                window.dispatchEvent(new CustomEvent('fpm:config_updated', { detail: d }));
                if (d.maintenanceMode === true && window._currentUser?.role !== 'admin') {
                    window.dispatchEvent(new CustomEvent('fpm:maintenance_mode', { detail: d }));
                }
            } catch {}
        });

        /* Suscripcion actualizada */
        _appSSE.addEventListener('subscription_updated', (e) => {
            try {
                const d = JSON.parse(e.data);
                localStorage.removeItem('fixpromax_sub_cache');
                window.dispatchEvent(new CustomEvent('fpm:subscription_updated', { detail: d }));
                if (typeof window.loadSubscriptionStatus === 'function') window.loadSubscriptionStatus(true);
            } catch {}
        });

        /* Plan actualizado (precio, nombre, etc.) */
        _appSSE.addEventListener('plan_updated', (e) => {
            try {
                const d = JSON.parse(e.data);
                window.dispatchEvent(new CustomEvent('fpm:plan_updated', { detail: d }));
                if (typeof window.loadSubscriptionStatus === 'function') window.loadSubscriptionStatus(true);
            } catch {}
        });

        /* Tasa de cambio actualizada */
        _appSSE.addEventListener('exchange_rate_updated', (e) => {
            try {
                const d = JSON.parse(e.data);
                window.dispatchEvent(new CustomEvent('fpm:exchange_rate_updated', { detail: d }));
                if (window.CurrencySystem) window.CurrencySystem._rateCache = null;
            } catch {}
        });

        /* Error / desconexion — backoff exponencial */
        _appSSE.onerror = () => {
            _appSSEActive = false;
            try { _appSSE?.close(); } catch {}
            _appSSE      = null;
            _appSSEDelay = Math.min(_appSSEDelay * 2, 30000);
            _appSSETimer = setTimeout(() => {
                if (localStorage.getItem(AUTH_KEY)) _startAppSSE();
            }, _appSSEDelay);
        };
    }

    /* Reconectar cuando la pestaña vuelve a estar visible */
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && !_appSSEActive) {
            _appSSEDelay = 3000;
            _startAppSSE();
        }
    });

    /* Exponer para que _enterApp() pueda iniciarlo despues del login */
    window._startAppSSE = _startAppSSE;

'''

# Insertar antes del ultimo })();
last_close = content.rfind('})();')
if last_close == -1:
    print('ERROR: no encontrado })(); al final')
else:
    content = content[:last_close] + sse_code + content[last_close:]
    with open(FILE, 'w', encoding='utf-8') as f:
        f.write(content)
    print('OK: SSE listener inyectado en auth.js')
    print(f'Nuevo tamano: {len(content)} chars')
