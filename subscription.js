/**
 * FIX PRO MAX — Sistema de Suscripción
 * subscription.js — Capa de control de acceso independiente.
 *
 * NO modifica las funciones del ERP.
 * Se ejecuta DESPUÉS de auth.js.
 * Solo añade la lógica: ¿puede este usuario usar la app?
 */
(function SubscriptionModule() {
    'use strict';

    /* ── Constantes ─────────────────────────────────────────────── */
    const SUB_CACHE_KEY   = 'fixpromax_sub_cache';
    const SUB_CACHE_TTL   = 15 * 60 * 1000;     // 15 minutos de caché
    const OFFLINE_GRACE   = 48 * 60 * 60 * 1000; // 48 h sin conexión antes de bloquear
    const TRIAL_DAYS      = 3;

    /* ── Estado ──────────────────────────────────────────────────── */
    let _subStatus   = null;   // último estado del servidor
    let _checkTimer  = null;   // timer de re-verificación periódica
    let _bannerShown = false;

    /* ── API helper (reutiliza el API_BASE de auth.js) ────────────── */
    function _apiBase() {
        const h = window.location.hostname;
        if (h === 'localhost' || h === '127.0.0.1' ||
            h.startsWith('192.168.') || h.startsWith('10.') || h.startsWith('172.')) {
            return window.location.origin;
        }
        return window.location.origin;
    }

    async function _fetchStatus() {
        const token = localStorage.getItem('fixpromax_token');
        if (!token) return null;
        try {
            const ctrl = new AbortController();
            setTimeout(() => ctrl.abort(), 6000);
            const r = await fetch(_apiBase() + '/api/subscription/status', {
                headers: { 'Authorization': 'Bearer ' + token },
                signal: ctrl.signal,
            });
            if (!r.ok) {
                // 401 = sesión inválida → bloquear
                if (r.status === 401 || r.status === 403) {
                    return { access: false, status: 'no_access' };
                }
                return _getCached();
            }
            const j = await r.json();
            if (!j.ok) return null;
            // Guardar en caché SOLO si hay acceso. Si no hay acceso, no cachear.
            if (j.data && j.data.access) {
                localStorage.setItem(SUB_CACHE_KEY, JSON.stringify({ data: j.data, ts: Date.now() }));
            } else {
                // Sin acceso → limpiar cualquier caché anterior
                localStorage.removeItem(SUB_CACHE_KEY);
            }
            // Actualizar _PLANS con los datos del servidor (precios actualizados por admin)
            if (j.data && Array.isArray(j.data.plans)) {
                _PLANS = _buildPlans(j.data.plans);
            }
            return j.data;
        } catch {
            // Sin red → usar caché (solo si tenía acceso, ya filtrado en _getCached)
            return _getCached();
        }
    }

    function _getCached() {
        try {
            const raw = localStorage.getItem(SUB_CACHE_KEY);
            if (!raw) return null;
            const { data, ts } = JSON.parse(raw);
            const age = Date.now() - ts;
            // Si el acceso está denegado → NUNCA usar caché, siempre ir al servidor
            if (data && !data.access) return null;
            // Si el caché es reciente (< TTL) → usarlo
            if (age < SUB_CACHE_TTL) return data;
            // Caché viejo pero acceso activo → conceder gracia de 48h sin red
            if (data && data.access && age < OFFLINE_GRACE) return data;
            return null;
        } catch { return null; }
    }

    /* ══════════════════════════════════════════════════════════════
       VERIFICAR ACCESO — punto de entrada principal
       ══════════════════════════════════════════════════════════════ */
    async function checkAccess() {
        const status = await _fetchStatus();
        _subStatus = status;

        if (!status) {
            // Sin respuesta del servidor y sin caché válido.
            // Si la app ya es visible, bloquearla — no se puede verificar sin conexión.
            const app = document.getElementById('appMain');
            if (app && app.classList.contains('visible')) {
                _showPaywall({ status: 'no_access', access: false });
            }
            // Si la app NO es visible (usuario esperando), mostrar paywall de todas formas
            // para que no se quede en pantalla en blanco indefinidamente.
            else if (app && !app.classList.contains('visible')) {
                _showPaywall({ status: 'no_access', access: false });
            }
            return;
        }

        if (status.access) {
            // ── ACCESO CONCEDIDO ──────────────────────────────────────────────
            // Llamar _showAppAfterAuth si auth.js la expuso (primera vez post-login)
            if (typeof window._showAppAfterAuth === 'function' && !window._appShown) {
                window._showAppAfterAuth(status);
            } else {
                // Re-check periódico o restauración de paywall: solo asegurar visibilidad
                const app = document.getElementById('appMain');
                if (app && !app.classList.contains('visible')) {
                    app.classList.add('visible');
                }
                _hidPaywall();
            }
            _updateSubUI(status);
            _showTrialBanner(status);
            if (status.modules && typeof window._updateSidebarByPlan === 'function') {
                window._updateSidebarByPlan(status.modules);
            }
            // Recheck periódico cada 30 min
            clearTimeout(_checkTimer);
            _checkTimer = setTimeout(checkAccess, 30 * 60 * 1000);
        } else {
            // ── ACCESO DENEGADO — mostrar paywall ─────────────────────────────
            // Asegurarse de que la app NO sea visible
            const app = document.getElementById('appMain');
            if (app) app.classList.remove('visible');
            _showPaywall(status);
            // Recheck cada 5 min para detectar pago confirmado por admin
            clearTimeout(_checkTimer);
            _checkTimer = setTimeout(checkAccess, 5 * 60 * 1000);
        }
    }
    window.checkSubscriptionAccess = checkAccess;

    // ── SSE — escuchar eventos del servidor en tiempo real ──────────────────────
    (function _connectAppSSE() {
        const token = localStorage.getItem('fixpromax_token');
        if (!token) return;
        if (window.location.protocol === 'file:') return;

        const source = new EventSource(_apiBase() + '/api/events?token=' + encodeURIComponent(token));

        // Plan actualizado por admin → refrescar precios sin recargar la página
        source.addEventListener('plan_updated', function(e) {
            try {
                localStorage.removeItem('fixpromax_sub_cache');
                // Refrescar planes silenciosamente
                fetch(_apiBase() + '/api/subscription/status', {
                    headers: { 'Authorization': 'Bearer ' + token }
                }).then(r => r.ok ? r.json() : null).then(j => {
                    if (j && j.ok && Array.isArray(j.data?.plans)) {
                        _PLANS = _buildPlans(j.data.plans);
                        // Si el paywall está visible, re-renderizarlo con precios nuevos
                        const pw = document.getElementById('paywallScreen');
                        if (pw && pw.style.display !== 'none') {
                            _renderPaywallContent(pw, _subStatus || { status:'trial_expired', access:false });
                        }
                    }
                }).catch(() => {});
            } catch {}
        });

        // Estado de cuenta cambiado por admin → verificar acceso inmediatamente
        source.addEventListener('account_status_changed', function(e) {
            try {
                const d = JSON.parse(e.data);
                localStorage.removeItem('fixpromax_sub_cache');
                if (!d.active) {
                    // Suspendido → bloquear inmediatamente
                    const app = document.getElementById('appMain');
                    if (app) app.classList.remove('visible');
                    // Mostrar mensaje de suspensión en lugar del paywall normal
                    let pw = document.getElementById('paywallScreen');
                    if (!pw) { pw = document.createElement('div'); pw.id='paywallScreen'; pw.style.cssText='position:fixed;inset:0;z-index:10000;background:#0f172a;display:flex;align-items:center;justify-content:center;font-family:Inter,system-ui,sans-serif;'; document.body.appendChild(pw); }
                    pw.style.display = 'flex';
                    pw.innerHTML = `<div style="text-align:center;padding:40px;max-width:480px;"><div style="font-size:52px;margin-bottom:16px;">🚫</div><h2 style="color:#f8fafc;font-size:22px;font-weight:800;margin-bottom:12px;">Cuenta suspendida</h2><p style="color:#94a3b8;font-size:14px;line-height:1.7;margin-bottom:20px;">Tu cuenta ha sido suspendida por el administrador.${d.reason?'<br><em style="color:#64748b;">'+d.reason+'</em>':''}</p><p style="color:#475569;font-size:13px;">Contacta con el soporte para más información.</p><button onclick="window.logoutUser&&window.logoutUser()" style="margin-top:20px;background:#334155;border:none;color:#94a3b8;padding:10px 24px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:13px;">Cerrar sesión</button></div>`;
                } else {
                    // Reactivado → verificar acceso de nuevo
                    checkAccess();
                }
            } catch {}
        });

        // Suscripción cambiada por admin → actualizar estado
        source.addEventListener('subscription_changed', function() {
            localStorage.removeItem('fixpromax_sub_cache');
            checkAccess();
        });

        // Permisos cambiados → notificar al usuario y recargar datos
        source.addEventListener('permissions_updated', function(e) {
            try {
                const d = JSON.parse(e.data);
                if (typeof window._currentUser !== 'undefined') {
                    window._currentUser.permissions = d.permissions;
                }
                // Toast informativo
                if (typeof showToast === 'function') showToast('🔑', 'Tus permisos han sido actualizados.');
                // Recargar módulos del sidebar
                if (typeof window._updateSidebarByPlan === 'function' && _subStatus?.modules) {
                    window._updateSidebarByPlan(_subStatus.modules);
                }
            } catch {}
        });

        // Tasa de cambio actualizada → limpiar caché de tasas
        source.addEventListener('exchange_rate_updated', function() {
            if (typeof window.CurrencySystem === 'object' && typeof window.CurrencySystem.init === 'function') {
                window.CurrencySystem.init();
            }
        });

        source.onerror = function() {
            // Reconexión automática de EventSource — no hacer nada
        };

        window._appSSESource = source;
    })();
    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible' && _subStatus && !_subStatus.access) {
            // Volvemos a la pestaña y estábamos bloqueados → verificar de inmediato
            localStorage.removeItem('fixpromax_sub_cache');
            checkAccess();
        }
    });

    /* ══════════════════════════════════════════════════════════════
       PAYWALL — pantalla de bloqueo cuando trial/sub expira
       ══════════════════════════════════════════════════════════════ */
    function _showPaywall(status) {
        // Ocultar la app completamente
        const app = document.getElementById('appMain');
        if (app) app.classList.remove('visible');

        // Ocultar también el authScreen si estuviera visible
        const auth = document.getElementById('authScreen');
        if (auth) auth.style.display = 'none';

        let pw = document.getElementById('paywallScreen');
        if (!pw) {
            pw = _buildPaywall();
            document.body.appendChild(pw);
        }
        pw.style.display = 'flex';
        _renderPaywallContent(pw, status);
    }

    function _hidPaywall() {
        const pw = document.getElementById('paywallScreen');
        if (pw) pw.style.display = 'none';
    }

    function _buildPaywall() {
        const div = document.createElement('div');
        div.id = 'paywallScreen';
        div.style.cssText = [
            'position:fixed;inset:0;z-index:10000;background:#0f172a;',
            'display:flex;align-items:flex-start;justify-content:center;',
            'overflow-y:auto;padding:0;font-family:Inter,system-ui,sans-serif;',
        ].join('');
        return div;
    }

    async function _renderPaywallContent(pw, status) {
        // Determinar textos según estado
        const isExpired   = status.status === 'trial_expired';
        const isNoAccess  = status.status === 'no_access';
        const isSubExp    = status.status === 'subscription_expired' || (!isExpired && !isNoAccess && !status.access);

        const title = isExpired
            ? 'Tu período de prueba ha terminado'
            : isSubExp
                ? 'Tu suscripción ha vencido'
                : 'Suscripción requerida';

        const subtitle = isExpired
            ? 'Tu prueba gratuita de <strong>' + TRIAL_DAYS + ' días</strong> ha finalizado. Selecciona un plan para continuar usando FIX PRO MAX.'
            : isSubExp
                ? 'Tu suscripción venció. Renueva tu plan para recuperar el acceso a todos tus datos.'
                : 'Para continuar usando FIX PRO MAX selecciona un plan de suscripción.';

        // Estado informativo
        const trialEndFmt = status.trialEnd ? new Date(status.trialEnd).toLocaleDateString('es', { day:'2-digit', month:'long', year:'numeric' }) : '';
        const statusBadge = isExpired
            ? `<div style="display:inline-flex;gap:8px;align-items:center;background:#1e293b;border:1px solid #334155;border-radius:10px;padding:10px 20px;margin-bottom:20px;flex-wrap:wrap;justify-content:center;">
                 <span style="font-size:12px;color:#64748b;">Prueba gratuita</span>
                 <span style="background:#7f1d1d;color:#fca5a5;font-size:11px;font-weight:700;padding:2px 10px;border-radius:20px;">FINALIZADA</span>
                 <span style="font-size:12px;color:#64748b;">Estado</span>
                 <span style="background:#1c1917;color:#f87171;font-size:11px;font-weight:700;padding:2px 10px;border-radius:20px;">SIN SUSCRIPCIÓN ACTIVA</span>
                 ${trialEndFmt ? `<span style="font-size:11px;color:#475569;">Venció el ${trialEndFmt}</span>` : ''}
               </div>`
            : `<div style="display:inline-flex;gap:8px;align-items:center;background:#1e293b;border:1px solid #334155;border-radius:10px;padding:10px 20px;margin-bottom:20px;">
                 <span style="background:#1c1917;color:#f87171;font-size:11px;font-weight:700;padding:2px 10px;border-radius:20px;">SIN ACCESO ACTIVO</span>
               </div>`;

        // ── Mostrar esqueleto mientras carga ──────────────────────────────────
        pw.innerHTML = `
        <div style="max-width:860px;width:100%;margin:0 auto;padding:32px 20px 40px;">
            <div style="text-align:center;margin-bottom:24px;">
                <div style="font-size:52px;margin-bottom:8px;">⚡</div>
                <div style="font-size:28px;font-weight:900;background:linear-gradient(135deg,#4f46e5,#7c3aed);
                            -webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:8px;">
                    FIX PRO MAX
                </div>
                <h2 style="font-size:20px;font-weight:700;color:#f8fafc;margin:0 0 10px;">${title}</h2>
                <p style="font-size:14px;color:#94a3b8;margin:0 0 18px;line-height:1.7;max-width:520px;margin-left:auto;margin-right:auto;">${subtitle}</p>
                ${statusBadge}
            </div>
            <div id="pwPlanCards" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-bottom:24px;">
                <div style="grid-column:1/-1;text-align:center;padding:40px;color:#64748b;">⏳ Cargando planes...</div>
            </div>
            <div id="pwPayMsg" style="display:none;border-radius:10px;padding:12px 18px;font-size:13px;margin-bottom:16px;text-align:center;font-weight:600;"></div>
            <div style="background:#1e1b4b;border:1px solid #3730a3;border-radius:10px;padding:10px 18px;
                        margin-bottom:20px;font-size:12px;color:#a5b4fc;text-align:center;" id="pwMultiNote"></div>
            <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-bottom:16px;">
                <button onclick="window.restorePurchases()"
                    style="background:none;border:1px solid #334155;color:#94a3b8;padding:9px 20px;
                           border-radius:8px;cursor:pointer;font-size:13px;font-family:inherit;transition:all .2s;"
                    onmouseover="this.style.borderColor='#64748b';this.style.color='#e2e8f0'"
                    onmouseout="this.style.borderColor='#334155';this.style.color='#94a3b8'">
                    ✅ Ya pagué — restaurar acceso
                </button>
                <button onclick="window.logoutUser()"
                    style="background:none;border:none;color:#475569;padding:9px 20px;
                           cursor:pointer;font-size:13px;font-family:inherit;transition:color .2s;"
                    onmouseover="this.style.color='#94a3b8'"
                    onmouseout="this.style.color='#475569'">
                    🚪 Cerrar sesión
                </button>
            </div>
            <p style="text-align:center;font-size:11px;color:#334155;line-height:1.6;">
                Tus datos están seguros y disponibles cuando contrates un plan.<br>
                Cancela cuando quieras. Soporte: disponible desde el menú de configuración.
            </p>
        </div>`;

        // ── Fetch planes frescos del servidor ─────────────────────────────────
        let livePlans = null;
        try {
            const r = await fetch(_apiBase() + '/api/subscription/plans', {
                headers: { 'Cache-Control': 'no-cache' }
            });
            const j = await r.json();
            if (j.ok && Array.isArray(j.data) && j.data.length) {
                livePlans = j.data;
                // Actualizar _PLANS con los datos frescos del servidor
                _PLANS = _buildPlans(livePlans);
            }
        } catch (e) {
            console.warn('[Paywall] No se pudieron cargar planes frescos, usando caché:', e.message);
        }

        // ── Generar tarjetas con datos actualizados ───────────────────────────
        const plansToShow = livePlans
            ? livePlans.filter(p => p.active !== false).sort((a, b) => (a.order || 0) - (b.order || 0))
            : Object.values(_PLANS);

        const planCards = plansToShow.map(p => {
            const pid         = p.id;
            const accent      = _PLANS_ACCENT[pid]       || '#4f46e5';
            const accentLight = _PLANS_ACCENT_LIGHT[pid] || '#1e1b4b';
            const isRec       = pid === 'pro';
            const isBest      = pid === 'semestral';
            const multiUsers  = p.maxUsers || _PLANS[pid]?.maxUsers || 1;
            const multiUser   = p.multiUser ?? _PLANS[pid]?.multiUser ?? false;
            const price       = p.price != null ? `$${Number(p.price).toFixed(2)}` : (_PLANS[pid]?.price || '$—');
            const period      = p.period || _PLANS[pid]?.period || '';
            const name        = p.name   || _PLANS[pid]?.name   || pid;
            const icon        = p.icon   || _PLANS[pid]?.icon   || '📦';
            const features    = p.features || _PLANS[pid]?.features || [];
            const badge       = p.badge   || '';

            const featHtml = features.map(f =>
                `<li style="font-size:11px;color:#94a3b8;padding:2px 0;display:flex;gap:6px;align-items:flex-start;">
                    <span style="color:#10b981;flex-shrink:0;margin-top:1px;">✔</span>${f}
                </li>`
            ).join('');

            return `
            <div style="background:#1e293b;border:2px solid ${isRec ? accent : '#334155'};border-radius:14px;
                         padding:20px 16px;cursor:pointer;transition:all .2s;text-align:center;position:relative;"
                 onmouseover="this.style.borderColor='${accent}';this.style.transform='translateY(-2px)';this.style.boxShadow='0 8px 24px ${accent}33'"
                 onmouseout="this.style.borderColor='${isRec ? accent : '#334155'}';this.style.transform='none';this.style.boxShadow='none'"
                 onclick="window.startSubscription('${pid}')">
                ${isRec  ? `<div style="position:absolute;top:-11px;left:50%;transform:translateX(-50%);background:${accent};color:#fff;font-size:10px;font-weight:800;padding:3px 14px;border-radius:20px;white-space:nowrap;">⭐ RECOMENDADO</div>` : ''}
                ${isBest ? `<div style="position:absolute;top:-11px;right:16px;background:#f59e0b;color:#000;font-size:10px;font-weight:800;padding:3px 10px;border-radius:20px;white-space:nowrap;">👑 MEJOR VALOR</div>` : ''}
                ${badge && !isRec && !isBest ? `<div style="position:absolute;top:-11px;left:50%;transform:translateX(-50%);background:${accent};color:#fff;font-size:10px;font-weight:800;padding:3px 14px;border-radius:20px;white-space:nowrap;">${badge}</div>` : ''}
                <div style="font-size:28px;margin-bottom:8px;">${icon}</div>
                <div style="font-size:15px;font-weight:800;color:#f8fafc;margin-bottom:4px;">${name}</div>
                <div style="font-size:28px;font-weight:900;color:${accent};margin:6px 0;">${price}</div>
                <div style="font-size:11px;color:#64748b;margin-bottom:14px;">${period}${period ? ' · ' : ''}${multiUser ? `hasta ${multiUsers} usuarios` : '1 usuario'}</div>
                <ul style="text-align:left;list-style:none;padding:0;margin:0 0 14px;">${featHtml}</ul>
                <div style="background:${isRec ? `linear-gradient(135deg,${accent},${accent}cc)` : '#334155'};
                            color:${isRec ? '#fff' : '#cbd5e1'};padding:10px;border-radius:9px;
                            font-size:13px;font-weight:700;letter-spacing:.3px;transition:opacity .15s;"
                     onmouseover="this.style.opacity='.85'" onmouseout="this.style.opacity='1'">
                    💳 Suscribirme
                </div>
            </div>`;
        }).join('');

        // Inyectar tarjetas en el contenedor ya visible
        const grid = pw.querySelector('#pwPlanCards');
        if (grid) grid.innerHTML = planCards || '<div style="grid-column:1/-1;text-align:center;padding:30px;color:#f87171;">No hay planes disponibles.</div>';

        // Nota multiusuario — usando el plan pro real
        const proPlan   = plansToShow.find(p => p.id === 'pro');
        const semesPlan = plansToShow.find(p => p.id === 'semestral');
        const noteEl    = pw.querySelector('#pwMultiNote');
        if (noteEl) {
            const proUsers  = proPlan?.maxUsers   || 3;
            const semesUsers = semesPlan?.maxUsers || 5;
            noteEl.innerHTML = `👥 <strong>Multiusuario</strong> disponible desde el <strong>${proPlan?.name || 'Plan Pro'}</strong> (hasta ${proUsers} usuarios) — o <strong>${semesPlan?.name || 'Plan Semestral'}</strong> (hasta ${semesUsers} usuarios).`;
        }
    }

    /* ══════════════════════════════════════════════════════════════
       BANNER DE TRIAL (aviso discreto en la topbar)
       ══════════════════════════════════════════════════════════════ */
    function _showTrialBanner(status) {
        if (status.status !== 'trial') return;

        let banner = document.getElementById('trialBanner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'trialBanner';
            banner.style.cssText = [
                'position:fixed;top:0;left:0;right:0;z-index:9998;',
                'background:linear-gradient(90deg,#4f46e5,#7c3aed);',
                'color:#fff;text-align:center;padding:8px 16px;',
                'font-size:13px;font-weight:600;font-family:Inter,system-ui,sans-serif;',
                'display:flex;align-items:center;justify-content:center;gap:12px;',
            ].join('');
            document.body.appendChild(banner);
            // Empujar el contenido hacia abajo para que no quede tapado
            document.body.style.paddingTop = '38px';
        }

        const d = status.daysLeft;
        let msg = '';
        if (d <= 1)       msg = '⚠️ï¸ Tu prueba gratuita <strong>termina hoy</strong>. Sin multiusuario.';
        else if (d === 2) msg = '⚠️ï¸ Tu prueba gratuita termina <strong>mañana</strong>. Sin multiusuario.';
        else              msg = `⚡ Prueba gratuita activa — <strong>${d} días restantes</strong> · Sin multiusuario`;

        banner.innerHTML = `
            <span>${msg}</span>
            <button onclick="window.openSubscribePage()"
                style="background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.4);
                       color:#fff;padding:3px 12px;border-radius:20px;cursor:pointer;
                       font-size:12px;font-weight:700;font-family:inherit;">
                Suscribirme
            </button>
            <button onclick="this.parentElement.style.display='none';document.body.style.paddingTop=''"
                style="background:none;border:none;color:rgba(255,255,255,.6);cursor:pointer;font-size:16px;padding:0 4px;">
                âœ•
            </button>`;
    }

    /* ══════════════════════════════════════════════════════════════
       ACTUALIZAR UI DE SUSCRIPCIÓN EN CONFIGURACIÓN
       ══════════════════════════════════════════════════════════════ */
    function _updateSubUI(status) {
        const el = document.getElementById('settingsSubStatus');
        if (!el) return;

        const labels = {
            admin:           { badge: '👑 Administrador',           color: '#7c3aed', bg: '#ede9fe' },
            trial:           { badge: '🀓 Prueba gratuita',         color: '#0284c7', bg: '#e0f2fe' },
            subscribed: {
                badge: status.plan === 'basic'     ? '📦 Plan Básico'    :
                       status.plan === 'pro'       ? '🚂 Plan Pro'       :
                       status.plan === 'semestral' ? '💎 Plan Semestral' :
                       status.plan === 'premium'   ? '💎 Plan Semestral' :  // retrocompat.
                       status.plan === 'monthly'   ? '📆 Plan Mensual'   :
                       status.plan === 'annual'    ? '📀 Plan Anual'     : 'âœ… Suscripción activa',
                color: status.plan === 'semestral' || status.plan === 'premium' ? '#b45309' :
                       status.plan === 'pro'     ? '#4f46e5'  : '#16a34a',
                bg:    status.plan === 'semestral' || status.plan === 'premium' ? '#fef3c7'  :
                       status.plan === 'pro'     ? '#eef2ff'  : '#dcfce7',
            },
            cancelled_active:{ badge: '⚠️ï¸ Cancelada (activa)',      color: '#d97706', bg: '#fef3c7' },
            trial_expired:   { badge: '🔴 Prueba expirada',         color: '#dc2626', bg: '#fee2e2' },
            no_access:       { badge: '🔴 Sin acceso',              color: '#dc2626', bg: '#fee2e2' },
        };
        const info = labels[status.status] || labels.no_access;

        const planName = status.plan
            ? (status.plan === 'basic'     ? 'Plan Básico'    :
               status.plan === 'pro'       ? 'Plan Pro'       :
               status.plan === 'semestral' ? 'Plan Semestral' :
               status.plan === 'premium'   ? 'Plan Semestral' :  // retrocompat.
               status.plan === 'monthly'   ? 'Plan Mensual'   : 'Plan Anual')
            : '';

        let detail = '';
        if (status.status === 'trial')
            detail = `${status.daysLeft} día(s) restante(s) · vence ${_fmtDate(status.trialEnd)} · <span style="color:#ef4444;font-weight:600;">Sin multiusuario</span>`;
        else if (status.status === 'subscribed' || status.status === 'cancelled_active') {
            const multiInfo = status.multiUser
                ? `<span style="color:#10b981;font-weight:600;">👥 Multiusuario activo (hasta ${status.maxUsers} usuarios)</span>`
                : `<span style="color:#f59e0b;font-weight:600;">👤 1 usuario · <a href="#" onclick="window.openSubscribePage();return false;" style="color:#4f46e5;">Actualizar a Pro</a></span>`;
            detail = `${planName} · renueva ${_fmtDate(status.end)} · ${status.daysLeft} días · ${multiInfo}`;
        } else if (status.status === 'trial_expired')
            detail = `Venció el ${_fmtDate(status.trialEnd)}`;
        else if (status.status === 'admin')
            detail = 'Acceso permanente de administrador';

        el.innerHTML = `
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                <span style="background:${info.bg};color:${info.color};font-weight:700;
                             font-size:13px;padding:4px 14px;border-radius:20px;">
                    ${info.badge}
                </span>
                <span style="font-size:13px;color:var(--text-2);">${detail}</span>
            </div>
            ${(status.status === 'trial_expired' || status.status === 'no_access') ? `
            <button onclick="window.openSubscribePage()"
                style="margin-top:10px;background:linear-gradient(135deg,#4f46e5,#7c3aed);
                       color:#fff;border:none;padding:8px 20px;border-radius:8px;
                       font-weight:700;cursor:pointer;font-family:inherit;font-size:14px;">
                ⚡ Suscribirme ahora
            </button>` : ''}
            ${status.status === 'subscribed' ? `
            <button onclick="window.cancelSubscription()"
                style="margin-top:8px;background:none;border:1px solid var(--border);
                       color:var(--text-2);padding:6px 16px;border-radius:8px;
                       cursor:pointer;font-family:inherit;font-size:12px;">
                Cancelar suscripción
            </button>` : ''}`;
    }

    function _fmtDate(iso) {
        if (!iso) return '—';
        return new Date(iso).toLocaleDateString('es', { day:'2-digit', month:'short', year:'numeric' });
    }

    /* ══════════════════════════════════════════════════════════════
       ACCIONES GLOBALES
       ══════════════════════════════════════════════════════════════ */

    // Abrir pantalla de suscripción (desde banner o menú)
    window.openSubscribePage = function() {
        if (typeof navigateTo === 'function') navigateTo('settings');
        setTimeout(() => {
            const el = document.getElementById('settingsSubCard');
            if (el) el.scrollIntoView({ behavior: 'smooth' });
        }, 200);
    };

    // ══════════════════════════════════════════════════════════════
    // PANEL DE SUSCRIPCIÓN — 3 pasos:
    //   Paso 1: Elegir plan
    //   Paso 2: Elegir método de pago + datos
    //   Paso 3: Confirmar y activar
    // ══════════════════════════════════════════════════════════════

    const _PLANS_DEFAULT = {
        basic:     { id:'basic',     name:'Plan Básico',   price:'$15.00', amount:15.00, period:'1 mes',   icon:'📦', accent:'#64748b', accentLight:'#1e293b', multiUser:false, features:['1 usuario','Inventario y ventas','Facturas y gastos','Reportes básicos','Sin multiusuario'] },
        pro:       { id:'pro',       name:'Plan Pro',      price:'$25.00', amount:25.00, period:'3 meses', icon:'🚂', accent:'#4f46e5', accentLight:'#1e1b4b', multiUser:true,  features:['Hasta 3 usuarios','👥 Multiusuario','Permisos por rol','Inventario (500 productos)','Contabilidad completa','Todo el Plan Básico'] },
        semestral: { id:'semestral', name:'Plan Semestral',price:'$35.00', amount:35.00, period:'6 meses', icon:'💎', accent:'#f59e0b', accentLight:'#1c1406', multiUser:true,  features:['Hasta 5 usuarios','👥 Multiusuario','Todo el Plan Pro','Soporte prioritario','6 meses de acceso'] },
    };

    // Se rellena desde window.__INITIAL_PLANS__ (inyectado por el servidor) o queda con los defaults
    const _PLANS_ACCENT  = { basic:'#64748b', pro:'#4f46e5', semestral:'#f59e0b' };
    const _PLANS_ACCENT_LIGHT = { basic:'#1e293b', pro:'#1e1b4b', semestral:'#1c1406' };

    // Construir _PLANS mezclando los datos del servidor con los colores/iconos locales
    function _buildPlans(serverPlans) {
        const result = { ...JSON.parse(JSON.stringify(_PLANS_DEFAULT)) };
        if (Array.isArray(serverPlans)) {
            serverPlans.forEach(sp => {
                const def = result[sp.id] || {};
                result[sp.id] = {
                    ...def,
                    id:         sp.id,
                    name:       sp.name       || def.name,
                    price:      sp.price != null ? `$${Number(sp.price).toFixed(2)}` : def.price,
                    amount:     sp.price != null ? Number(sp.price) : def.amount,
                    period:     sp.period     || def.period,
                    icon:       sp.icon       || def.icon,
                    multiUser:  sp.multiUser  ?? def.multiUser,
                    features:   sp.features   || def.features,
                    accent:     _PLANS_ACCENT[sp.id]       || def.accent      || '#4f46e5',
                    accentLight:_PLANS_ACCENT_LIGHT[sp.id] || def.accentLight || '#1e1b4b',
                };
            });
        }
        return result;
    }

    let _PLANS = _buildPlans(window.__INITIAL_PLANS__);

    // Métodos de suscripción — se cargan desde el servidor, estos son el fallback
    const _METHODS_FALLBACK = [
        { id:'ZELLE',     icon:'⚡', label:'Zelle',               isManual:true,  fields:['zellePhone'] },
        { id:'USDT',      icon:'🟡', label:'Binance Pay / USDT',  isManual:true,  fields:['binanceId'] },
        { id:'PAGO_MOVIL',icon:'📱', label:'Pago Móvil (Venezuela)', isManual:true, fields:['pagoMovilPhone','pagoMovilBank','pagoMovilId'] },
        { id:'CREDIT_CARD',icon:'💳',label:'Tarjeta de crédito / débito', isManual:false, fields:['cardNumber','cardName','cardExpiry','cardCvc'] },
        { id:'PAYPAL',    icon:'🆿ï¸', label:'PayPal',              isManual:false, fields:['paypalEmail'] },
    ];

    // Se rellena al abrir el panel desde /api/config/payment-methods
    let _METHODS = [..._METHODS_FALLBACK];

    async function _loadSubMethods() {
        try {
            const token = localStorage.getItem('fixpromax_token');
            if (!token) return;
            const base = _apiBase();
            const r = await fetch(base + '/api/config/payment-methods', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (!r.ok) return;
            const j = await r.json();
            if (!j.ok || !Array.isArray(j.data)) return;
            // Solo los activos para suscripción (type: sub o both)
            const subMethods = j.data.filter(m => m.active && (m.type === 'sub' || m.type === 'both'));
            if (!subMethods.length) return;
            // Mapear al formato que espera el panel de suscripción
            _METHODS = subMethods.map(m => ({
                id:          m.id,
                icon:        m.icon || "💳",
                label:       m.label,
                isManual:    !!m.isManual,
                info:        m.info || "",
                paymentData: m.paymentData || {},
                fields:      _getFieldsForMethod(m.id),
            }));
            console.log(`[Sub] Métodos cargados: ${_METHODS.map(x => x.id).join(', ')}`);
        } catch (e) {
            console.warn('[Sub] No se pudieron cargar métodos dinámicos, usando fallback:', e.message);
        }
    }

    function _getFieldsForMethod(id) {
        const map = {
            'CREDIT_CARD': ['cardNumber','cardName','cardExpiry','cardCvc'],
            'PAYPAL':      ['paypalEmail'],
            'ZELLE':       ['zellePhone'],
            'USDT':        ['binanceId'],
            'PAGO_MOVIL':  ['pagoMovilPhone','pagoMovilBank','pagoMovilId'],
            // legado (minúsculas)
            'card':        ['cardNumber','cardName','cardExpiry','cardCvc'],
            'paypal':      ['paypalEmail'],
            'zelle':       ['zellePhone'],
            'binance':     ['binanceId'],
            'pago_movil':  ['pagoMovilPhone','pagoMovilBank','pagoMovilId'],
        };
        return map[id] || [];
    }

    let _selectedPlan   = null;
    let _selectedMethod = null;

    // Punto de entrada público
    window.startSubscription = function(planId) {
        _selectedPlan   = planId || null;
        _selectedMethod = null;
        _openSubscribePanel(planId ? 2 : 1);   // si ya viene con plan, ir directo al paso 2
    };

    window.openSubscribePanelStep1 = function() { _openSubscribePanel(1); };

    // ── Abrir el panel ────────────────────────────────────────────
    function _openSubscribePanel(step) {
        const old = document.getElementById('subPanel');
        if (old) old.remove();

        const ov = document.createElement('div');
        ov.id = 'subPanel';
        ov.style.cssText = [
            'position:fixed;inset:0;z-index:20000;',
            'background:rgba(2,6,23,.85);backdrop-filter:blur(6px);',
            'display:flex;align-items:center;justify-content:center;',
            'padding:16px;font-family:Inter,system-ui,sans-serif;',
            'overflow-y:auto;',
        ].join('');
        ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });

        ov.innerHTML = `
        <div id="subPanelInner" style="background:#0f172a;border:1px solid #1e293b;border-radius:22px;
             width:100%;max-width:860px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.7);
             position:relative;">

            <!-- Barra superior -->
            <div style="display:flex;align-items:center;justify-content:space-between;
                        padding:18px 24px;border-bottom:1px solid #1e293b;">
                <div>
                    <div style="font-size:18px;font-weight:800;color:#f8fafc;">⚡ FIX PRO MAX — Suscripción</div>
                    <div id="subPanelCrumbs" style="font-size:12px;color:#64748b;margin-top:2px;"></div>
                </div>
                <button onclick="document.getElementById('subPanel').remove()"
                    style="background:none;border:none;color:#64748b;font-size:22px;
                           cursor:pointer;line-height:1;padding:4px 8px;"
                    title="Cerrar">âœ•</button>
            </div>

            <!-- Indicador de pasos -->
            <div style="display:flex;gap:0;border-bottom:1px solid #1e293b;">
                ${[['1','Elige tu plan'],['2','Método de pago'],['3','Confirmar']].map(([n,label],i) => `
                <div id="subStep${n}Indicator" style="flex:1;padding:12px 8px;text-align:center;
                     font-size:12px;font-weight:600;border-bottom:2px solid transparent;
                     color:#475569;transition:all .25s;">
                    <span style="display:inline-flex;align-items:center;justify-content:center;
                                 width:22px;height:22px;border-radius:50%;background:#1e293b;
                                 font-size:11px;font-weight:700;margin-right:6px;">${n}</span>${label}
                </div>`).join('')}
            </div>

            <!-- Contenido dinámico -->
            <div id="subPanelBody" style="padding:24px;min-height:340px;"></div>

        </div>`;

        document.body.appendChild(ov);
        // Cargar planes frescos del servidor + métodos, luego renderizar
        Promise.all([
            fetch(_apiBase() + '/api/subscription/plans', { headers:{'Cache-Control':'no-cache'} })
                .then(r => r.json())
                .then(j => { if (j.ok && Array.isArray(j.data) && j.data.length) _PLANS = _buildPlans(j.data); })
                .catch(() => {}),
            _loadSubMethods(),
        ]).then(() => _renderStep(step));
    }

    // ── Renderizar paso ───────────────────────────────────────────
    function _renderStep(step) {
        // Actualizar indicadores
        [1,2,3].forEach(n => {
            const el = document.getElementById('subStep' + n + 'Indicator');
            if (!el) return;
            const active = n === step;
            const done   = n < step;
            el.style.color       = active ? '#818cf8' : done ? '#10b981' : '#475569';
            el.style.borderBottomColor = active ? '#4f46e5' : done ? '#10b981' : 'transparent';
            const circle = el.querySelector('span');
            if (circle) {
                circle.style.background = active ? '#4f46e5' : done ? '#10b981' : '#1e293b';
                circle.style.color      = active || done ? '#fff' : '#94a3b8';
                if (done) circle.textContent = 'âœ“';
            }
        });

        // Breadcrumb
        const crumbs = document.getElementById('subPanelCrumbs');
        if (crumbs) {
            const planName = _selectedPlan ? (_PLANS[_selectedPlan]?.name || '') : '';
            const methName = _selectedMethod ? (_METHODS.find(m => m.id === _selectedMethod)?.label || '') : '';
            crumbs.textContent = [planName, methName].filter(Boolean).join(' → ');
        }

        const body = document.getElementById('subPanelBody');
        if (!body) return;

        if (step === 1) _renderStep1(body);
        if (step === 2) _renderStep2(body);
        if (step === 3) _renderStep3(body);
    }

    // ── PASO 1 — Elegir plan ──────────────────────────────────────
    function _renderStep1(body) {
        body.innerHTML = `
        <h3 style="font-size:16px;font-weight:700;color:#f8fafc;margin:0 0 18px;">
            Elige el plan que mejor se adapta a tu negocio
        </h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;margin-bottom:20px;">
            ${Object.values(_PLANS).map(p => `
            <div onclick="window._subSelectPlan('${p.id}')"
                 id="planCard_${p.id}"
                 style="border:2px solid ${p.id === _selectedPlan ? p.accent : '#1e293b'};
                        background:${p.id === _selectedPlan ? p.accentLight : '#0f172a'};
                        border-radius:16px;padding:20px 18px;cursor:pointer;
                        transition:all .2s;position:relative;">
                ${p.id === 'pro' ? '<div style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:#4f46e5;color:#fff;font-size:10px;font-weight:800;padding:2px 12px;border-radius:20px;white-space:nowrap;">⭐ RECOMENDADO</div>' : ''}
                ${p.id === 'semestral' ? '<div style="position:absolute;top:-10px;right:16px;background:#f59e0b;color:#000;font-size:10px;font-weight:800;padding:2px 10px;border-radius:20px;white-space:nowrap;">👑 MEJOR VALOR</div>' : ''}
                <div style="font-size:32px;margin-bottom:10px;">${p.icon}</div>
                <div style="font-size:15px;font-weight:700;color:#f8fafc;margin-bottom:4px;">${p.name}</div>
                <div style="font-size:28px;font-weight:900;color:${p.accent};margin-bottom:2px;">${p.price}</div>
                <div style="font-size:12px;color:#64748b;margin-bottom:14px;">${p.period} de acceso</div>
                <ul style="list-style:none;padding:0;margin:0;">
                    ${p.features.map(f => `<li style="font-size:12px;color:#94a3b8;padding:3px 0;display:flex;gap:8px;align-items:flex-start;">
                        <span style="color:${f.startsWith('👥') ? p.accent : '#10b981'};flex-shrink:0;">✔</span>${f}
                    </li>`).join('')}
                </ul>
                ${p.id === _selectedPlan ? `<div style="margin-top:14px;background:${p.accent};color:#fff;text-align:center;padding:6px;border-radius:8px;font-size:12px;font-weight:700;">✔ Seleccionado</div>` : ''}
            </div>`).join('')}
        </div>
        <div style="display:flex;justify-content:flex-end;">
            <button id="btnStep1Next" onclick="window._subNextStep(2)"
                style="background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;border:none;
                       padding:12px 28px;border-radius:10px;font-size:15px;font-weight:700;
                       cursor:pointer;font-family:inherit;opacity:${_selectedPlan ? 1 : .4};"
                ${_selectedPlan ? '' : 'disabled'}>
                Continuar →
            </button>
        </div>`;
    }

    window._subSelectPlan = function(planId) {
        _selectedPlan = planId;
        _renderStep(1);
    };

    // ── PASO 2 — Método de pago ───────────────────────────────────
    function _renderStep2(body) {
        const plan = _PLANS[_selectedPlan];
        body.innerHTML = `
        <!-- Mini resumen del plan seleccionado -->
        <div style="display:flex;align-items:center;gap:14px;background:#1e293b;border-radius:12px;
                    padding:14px 18px;margin-bottom:22px;">
            <span style="font-size:28px;">${plan.icon}</span>
            <div style="flex:1;">
                <div style="font-weight:700;color:#f8fafc;">${plan.name}</div>
                <div style="font-size:12px;color:#64748b;">${plan.period} de acceso</div>
            </div>
            <div style="font-size:22px;font-weight:800;color:${plan.accent};">${plan.price}</div>
            <button onclick="window._subNextStep(1)"
                style="background:none;border:1px solid #334155;color:#94a3b8;padding:4px 10px;
                       border-radius:8px;font-size:12px;cursor:pointer;font-family:inherit;">
                Cambiar
            </button>
        </div>

        <h3 style="font-size:15px;font-weight:700;color:#f8fafc;margin:0 0 14px;">
            Elige cómo quieres pagar
        </h3>

        <!-- Métodos de pago -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px;margin-bottom:20px;">
            ${_METHODS.map(m => `
            <div onclick="window._subSelectMethod('${m.id}')"
                 id="methCard_${m.id}"
                 style="border:2px solid ${m.id === _selectedMethod ? '#4f46e5' : '#1e293b'};
                        background:${m.id === _selectedMethod ? '#1e1b4b' : '#0f172a'};
                        border-radius:12px;padding:14px 12px;cursor:pointer;
                        text-align:center;transition:all .2s;">
                <div style="font-size:26px;margin-bottom:6px;">${m.icon}</div>
                <div style="font-size:12px;font-weight:600;color:${m.id === _selectedMethod ? '#818cf8' : '#94a3b8'};
                            line-height:1.3;">${m.label}</div>
            </div>`).join('')}
        </div>

        <!-- Formulario dinámico del método -->
        <div id="payFormWrap" style="margin-bottom:20px;"></div>

        <!-- Mensaje de error -->
        <div id="subPayError" style="display:none;background:#7f1d1d;color:#fca5a5;border-radius:8px;
             padding:10px 14px;font-size:13px;margin-bottom:14px;"></div>

        <div style="display:flex;justify-content:space-between;gap:12px;">
            <button onclick="window._subNextStep(1)"
                style="background:none;border:1px solid #334155;color:#94a3b8;padding:12px 22px;
                       border-radius:10px;font-size:14px;cursor:pointer;font-family:inherit;">
                â† Atrás
            </button>
            <button id="btnStep2Next" onclick="window._subNextStep(3)"
                style="background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;border:none;
                       padding:12px 28px;border-radius:10px;font-size:15px;font-weight:700;
                       cursor:pointer;font-family:inherit;opacity:${_selectedMethod ? 1 : .4};"
                ${_selectedMethod ? '' : 'disabled'}>
                Revisar pedido →
            </button>
        </div>`;

        // Si ya había método elegido, mostrar su formulario
        if (_selectedMethod) _renderPayForm(_selectedMethod);
    }

    window._subSelectMethod = function(methodId) {
        _selectedMethod = methodId;
        const body = document.getElementById('subPanelBody');
        if (body) _renderStep2(body);
        _renderPayForm(methodId);
    };
    function _renderPayForm(methodId) {
        const wrap = document.getElementById('payFormWrap');
        if (!wrap) return;
        const mObj = _METHODS.find(m => m.id === methodId || m.id === methodId.toUpperCase() || m.id === methodId.toLowerCase());
        const pd   = (mObj && mObj.paymentData) ? mObj.paymentData : {};
        const info = (mObj && mObj.info) ? mObj.info : (pd.extra || '');

        function _datosBox(filas) {
            var rows = filas.filter(function(f){ return f[1]; });
            if (!rows.length) return '';
            return '<div style="background:#1e293b;border-radius:10px;padding:14px 16px;margin-bottom:14px;">' +
                '<div style="font-size:11px;color:#64748b;margin-bottom:8px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Enviar pago a</div>' +
                rows.map(function(r){ var label=r[0], val=r[1]; return '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #263348;">' +'<span style="font-size:12px;color:#94a3b8;">' + label + '</span>' +'<strong style="font-size:13px;color:#f8fafc;cursor:pointer;" ' +'onclick="try{navigator.clipboard.writeText(\'' + val.replace(/'/g,"\\'") + '\')}catch(e){}; var t=this; t.style.color=\'#10b981\'; setTimeout(function(){t.style.color=\'#f8fafc\'},1200);" ' +'title="Clic para copiar">' + val + '</strong></div>'; }).join('') +'</div>' +
                (info ? '<div style="background:rgba(79,70,229,.1);border:1px solid rgba(79,70,229,.2);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#a5b4fc;">' + info + '</div>' : '');
        }

        var ns = 'width:100%;background:#1e293b;border:1px solid #334155;color:#f8fafc;padding:10px 12px;border-radius:8px;font-size:14px;font-family:inherit;outline:none;box-sizing:border-box;';

        var html = '';
        var mid = methodId.toUpperCase();

        if (mid === 'ZELLE') {
            html = '<div style="background:#0a0f1e;border:1px solid #1e293b;border-radius:12px;padding:18px 16px;">' +
                '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;"><span style="font-size:24px;">⚡</span>' +
                '<div><div style="font-size:13px;font-weight:600;color:#94a3b8;">Transferencia por Zelle</div>' +
                '<div style="font-size:11px;color:#475569;">Envía el pago y adjunta el comprobante</div></div></div>' +
                _datosBox([['Número / Email', pd.account], ['Nombre', pd.name]]) +
                '<label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px;">Tu número de teléfono (para confirmar) *</label>' +
                '<input id="pf_zellePhone" type="tel" placeholder="+1 (555) 000-0000" style="' + ns + '" onfocus="this.style.borderColor=\'#6366f1\'"/>' +
                '<div style="margin-top:10px;font-size:11px;color:#475569;">⚠️ Realiza el pago y confirma. Verificaremos y activaremos tu plan en menos de 2 horas.</div>' +
                '</div>';
        } else if (mid === 'USDT') {
            html = '<div style="background:#0a0f1e;border:1px solid #1e293b;border-radius:12px;padding:18px 16px;">' +
                '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;"><span style="font-size:24px;">🟡</span>' +
                '<div><div style="font-size:13px;font-weight:600;color:#94a3b8;">USDT / Cripto</div>' +
                '<div style="font-size:11px;color:#475569;">Paga con criptomonedas</div></div></div>' +
                _datosBox([['Dirección / Binance ID', pd.address || pd.binanceId], ['Red', pd.network]]) +
                '<label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px;">Tu Binance ID o dirección *</label>' +
                '<input id="pf_binanceId" placeholder="ID o dirección" style="' + ns + 'font-family:monospace;" onfocus="this.style.borderColor=\'#f7a600\'"/>' +
                '<div style="margin-top:10px;font-size:11px;color:#475569;">⚠️ Envía exactamente el monto indicado y confirma. Activa en minutos.</div>' +
                '</div>';
        } else if (mid === 'PAGO_MOVIL') {
            html = '<div style="background:#0a0f1e;border:1px solid #1e293b;border-radius:12px;padding:18px 16px;">' +
                '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;"><span style="font-size:24px;">📱</span>' +
                '<div><div style="font-size:13px;font-weight:600;color:#94a3b8;">Pago Móvil (Venezuela)</div>' +
                '<div style="font-size:11px;color:#475569;">Transferencia inmediata desde tu banca móvil</div></div></div>' +
                _datosBox([['Banco', pd.bank], ['Teléfono', pd.phone], ['Cédula', pd.cedula], ['Nombre', pd.name]]) +
                '<div style="display:grid;gap:10px;">' +
                '<div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px;">Tu teléfono *</label>' +
                '<input id="pf_pagoMovilPhone" placeholder="0414-0000000" style="' + ns + '" onfocus="this.style.borderColor=\'#4f46e5\'"/></div>' +
                '<div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px;">Tu banco *</label>' +
                '<select id="pf_pagoMovilBank" style="' + ns + '"><option value="">Selecciona tu banco</option>' +
                '<option>Banesco (0134)</option><option>Mercantil (0105)</option><option>Venezuela (0102)</option>' +
                '<option>Bicentenario (0175)</option><option>BOD (0116)</option><option>BNC (0191)</option>' +
                '<option>Sofitasa (0137)</option><option>Exterior (0115)</option><option>Otro</option></select></div>' +
                '<div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px;">Tu cédula / RIF *</label>' +
                '<input id="pf_pagoMovilId" placeholder="V-00000000" style="' + ns + '" onfocus="this.style.borderColor=\'#4f46e5\'"/></div>' +
                '</div><div style="margin-top:12px;font-size:11px;color:#475569;">⚠️ Realiza el pago y confirma. Activaremos tu plan en menos de 2 horas hábiles.</div></div>';
        } else if (mid === 'CARD' || mid === 'CREDIT_CARD' || mid === 'DEBIT_CARD') {
            html = '<div style="background:#0a0f1e;border:1px solid #1e293b;border-radius:12px;padding:18px 16px;">' +
                '<div style="font-size:13px;font-weight:600;color:#94a3b8;margin-bottom:14px;">Datos de la tarjeta</div>' +
                '<div style="display:grid;gap:12px;">' +
                '<div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px;">Número de tarjeta *</label>' +
                '<input id="pf_cardNumber" maxlength="19" placeholder="1234 5678 9012 3456" style="' + ns + 'font-family:monospace;" oninput="this.value=this.value.replace(/[^0-9]/g,\'\').replace(/(.{4})/g,\'$1 \').trim()"/></div>' +
                '<div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px;">Nombre en la tarjeta *</label>' +
                '<input id="pf_cardName" placeholder="Como aparece en la tarjeta" style="' + ns + '"/></div>' +
                '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
                '<div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px;">Vencimiento *</label>' +
                '<input id="pf_cardExpiry" maxlength="5" placeholder="MM/AA" style="' + ns + 'font-family:monospace;" oninput="var v=this.value.replace(/[^0-9]/g,\'\');if(v.length>=3)v=v.slice(0,2)+\'/\'+v.slice(2);this.value=v"/></div>' +
                '<div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px;">CVC *</label>' +
                '<input id="pf_cardCvc" maxlength="4" placeholder="123" style="' + ns + 'font-family:monospace;" oninput="this.value=this.value.replace(/[^0-9]/g,\'\')"/></div>' +
                '</div></div><div style="display:flex;gap:8px;align-items:center;margin-top:12px;">' +
                '<span style="font-size:18px;">🔒</span><span style="font-size:11px;color:#475569;">Pago seguro — tus datos no se almacenan</span></div></div>';
        } else if (mid === 'PAYPAL') {
            html = '<div style="background:#0a0f1e;border:1px solid #1e293b;border-radius:12px;padding:18px 16px;">' +
                '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;"><span style="font-size:24px;">🅿️</span>' +
                '<div><div style="font-size:13px;font-weight:600;color:#94a3b8;">PayPal</div>' +
                '<div style="font-size:11px;color:#475569;">Completa el pago via PayPal</div></div></div>' +
                _datosBox([['Email', pd.email], ['Nombre', pd.name]]) +
                '<label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px;">Tu correo de PayPal *</label>' +
                '<input id="pf_paypalEmail" type="email" placeholder="tu@correo.com" style="' + ns + '"/></div>';
        } else {
            var rows2 = Object.entries(pd).filter(function(e){ return e[0] !== 'extra' && e[1]; });
            html = '<div style="background:#0a0f1e;border:1px solid #1e293b;border-radius:12px;padding:18px 16px;">' +
                '<div style="font-size:13px;font-weight:600;color:#94a3b8;margin-bottom:12px;">' + (mObj ? mObj.label : methodId) + '</div>' +
                _datosBox(rows2) +
                (info ? '<div style="font-size:12px;color:#a5b4fc;margin-top:8px;">ℹ️ ' + info + '</div>' : '') +
                '<div style="font-size:11px;color:#475569;margin-top:10px;">⚠️ Realiza el pago y confirma. Verificaremos y activaremos tu plan.</div></div>';
        }
        wrap.innerHTML = html;
    }

    // Validar los campos del formulario del método
    function _validatePayForm() {
        const meth = (_selectedMethod || '').toUpperCase();
        const err = (msg) => { const el = document.getElementById('subPayError'); if(el){el.textContent=msg;el.style.display='block';} return false; };
        const val = id => (document.getElementById(id)?.value || '').trim();
        const hide = () => { const el = document.getElementById('subPayError'); if(el) el.style.display='none'; };
        hide();
        if (meth === 'CARD' || meth === 'CREDIT_CARD' || meth === 'DEBIT_CARD') {
            const num = val('pf_cardNumber').replace(/\s/g,'');
            if (num.length < 13) return err('Ingresa un número de tarjeta válido.');
            if (!val('pf_cardName')) return err('Ingresa el nombre en la tarjeta.');
            if (!/^\d{2}\/\d{2}$/.test(val('pf_cardExpiry'))) return err('Ingresa la fecha de vencimiento (MM/AA).');
            if (val('pf_cardCvc').length < 3) return err('Ingresa el CVC de 3 o 4 dígitos.');
        }
        if (meth === 'PAYPAL') {
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val('pf_paypalEmail'))) return err('Ingresa un correo de PayPal válido.');
        }
        if (meth === 'ZELLE') {
            if (!val('pf_zellePhone')) return err('Ingresa tu número de teléfono para confirmar.');
        }
        if (meth === 'USDT') {
            if (!val('pf_binanceId')) return err('Ingresa tu Binance ID o dirección de billetera.');
        }
        if (meth === 'PAGO_MOVIL') {
            if (!val('pf_pagoMovilPhone')) return err('Ingresa tu número de teléfono.');
            if (!val('pf_pagoMovilBank'))  return err('Selecciona tu banco.');
            if (!val('pf_pagoMovilId'))    return err('Ingresa tu cédula o RIF.');
        }
        return true;
    }

    function _getPayFormData() {
        const val = id => (document.getElementById(id)?.value || '').trim();
        const data = { method: _selectedMethod };
        const mid  = (_selectedMethod || '').toUpperCase();
        if (mid === 'CARD' || mid === 'CREDIT_CARD' || mid === 'DEBIT_CARD') {
            data.cardNumber = val('pf_cardNumber');
            data.cardName   = val('pf_cardName');
            data.cardExpiry = val('pf_cardExpiry');
        }
        if (mid === 'PAYPAL')     data.paypalEmail = val('pf_paypalEmail');
        if (mid === 'ZELLE')      data.zellePhone  = val('pf_zellePhone');
        if (mid === 'USDT')       data.binanceId   = val('pf_binanceId');
        if (mid === 'PAGO_MOVIL') {
            data.pagoMovilPhone = val('pf_pagoMovilPhone');
            data.pagoMovilBank  = val('pf_pagoMovilBank');
            data.pagoMovilId    = val('pf_pagoMovilId');
        }
        return data;
    }


    // ── PASO 3 — Confirmar y pagar ────────────────────────────────
    function _renderStep3(body) {
        const plan = _PLANS[_selectedPlan];
        const meth = _METHODS.find(m => m.id === _selectedMethod);

        // Métodos que requieren verificación manual — usar el campo del método si está disponible
        const isManual = meth ? !!meth.isManual : ['zelle','binance','pago_movil','ZELLE','USDT','PAGO_MOVIL'].includes(_selectedMethod);

        body.innerHTML = `
        <h3 style="font-size:16px;font-weight:700;color:#f8fafc;margin:0 0 18px;">Resumen de tu pedido</h3>

        <!-- Resumen -->
        <div style="background:#0a0f1e;border:1px solid #1e293b;border-radius:14px;overflow:hidden;margin-bottom:18px;">
            <!-- Plan -->
            <div style="display:flex;align-items:center;gap:14px;padding:16px 18px;border-bottom:1px solid #1e293b;">
                <span style="font-size:28px;">${plan.icon}</span>
                <div style="flex:1;">
                    <div style="font-weight:700;color:#f8fafc;">${plan.name}</div>
                    <div style="font-size:12px;color:#64748b;">${plan.period} · ${plan.multiUser ? '👥 Multiusuario incluido' : '👤 1 usuario'}</div>
                </div>
                <div style="font-size:22px;font-weight:800;color:${plan.accent};">${plan.price}</div>
            </div>
            <!-- Método -->
            <div style="display:flex;align-items:center;gap:14px;padding:14px 18px;">
                <span style="font-size:22px;">${meth.icon}</span>
                <div style="flex:1;">
                    <div style="font-size:13px;font-weight:600;color:#f8fafc;">${meth.label}</div>
                    <div style="font-size:11px;color:#64748b;">Método de pago</div>
                </div>
                <button onclick="window._subNextStep(2)"
                    style="background:none;border:1px solid #334155;color:#94a3b8;padding:4px 10px;
                           border-radius:8px;font-size:12px;cursor:pointer;font-family:inherit;">
                    Cambiar
                </button>
            </div>
        </div>

        <!-- Total -->
        <div style="background:linear-gradient(135deg,${plan.accentLight},#0f172a);border:1px solid ${plan.accent}33;
                    border-radius:12px;padding:16px 18px;margin-bottom:18px;
                    display:flex;align-items:center;justify-content:space-between;">
            <div>
                <div style="font-size:13px;color:#94a3b8;">Total a pagar</div>
                <div style="font-size:11px;color:#475569;margin-top:2px;">${plan.period} · sin renovación automática</div>
            </div>
            <div style="font-size:28px;font-weight:900;color:${plan.accent};">${plan.price}</div>
        </div>

        ${isManual ? `
        <!-- Aviso pago manual -->
        <div style="background:#1c1506;border:1px solid #f59e0b55;border-radius:10px;padding:12px 16px;
                    margin-bottom:18px;font-size:12px;color:#fbbf24;line-height:1.6;">
            ⏳ <strong>Verificación manual:</strong> Tras confirmar, nuestro equipo verificará tu pago y activará el plan
            en menos de <strong>2 horas hábiles</strong>. Recibirás una notificación.
        </div>` : ''}

        <!-- Mensaje de estado -->
        <div id="subConfirmMsg" style="display:none;border-radius:8px;padding:12px 16px;
             font-size:13px;margin-bottom:14px;text-align:center;font-weight:600;"></div>

        <div style="display:flex;justify-content:space-between;gap:12px;">
            <button onclick="window._subNextStep(2)"
                style="background:none;border:1px solid #334155;color:#94a3b8;padding:12px 22px;
                       border-radius:10px;font-size:14px;cursor:pointer;font-family:inherit;">
                â† Atrás
            </button>
            <button id="subFinalBtn" onclick="window._subExecutePay()"
                style="background:linear-gradient(135deg,${plan.accent},${plan.accent}cc);
                       color:${(_selectedMethod === 'USDT' || _selectedMethod === 'binance') ? '#000' : '#fff'};border:none;
                       padding:14px 32px;border-radius:10px;font-size:15px;font-weight:800;
                       cursor:pointer;font-family:inherit;min-width:180px;">
                <span id="subFinalBtnTxt">${isManual ? '📤 Confirmar y enviar' : '💳 Pagar ahora'}</span>
                <span id="subFinalBtnSpin" style="display:none;">⏳ Procesando...</span>
            </button>
        </div>`;
    }

    // ── Navegación entre pasos ────────────────────────────────────
    window._subNextStep = function(step) {
        // Al pasar del paso 2 al 3, validar formulario
        if (step === 3) {
            if (!_selectedMethod) {
                const el = document.getElementById('subPayError');
                if (el) { el.textContent = 'Selecciona un método de pago.'; el.style.display = 'block'; }
                return;
            }
            if (!_validatePayForm()) return;
        }
        _renderStep(step);
    };

    // ── Ejecutar el pago ──────────────────────────────────────────
    window._subExecutePay = async function() {
        const btn     = document.getElementById('subFinalBtn');
        const btnTxt  = document.getElementById('subFinalBtnTxt');
        const btnSpin = document.getElementById('subFinalBtnSpin');
        const msg     = document.getElementById('subConfirmMsg');

        if (btn)     btn.disabled  = true;
        if (btnTxt)  btnTxt.style.display  = 'none';
        if (btnSpin) btnSpin.style.display = 'inline';

        const token    = localStorage.getItem('fixpromax_token');
        const payData  = _getPayFormData();
        const curMeth  = _METHODS.find(m => m.id === _selectedMethod);
        const isManual = curMeth ? !!curMeth.isManual : ['zelle','binance','pago_movil','ZELLE','USDT','PAGO_MOVIL'].includes(_selectedMethod);

        // Android TWA
        if (window.Android && typeof window.Android.launchBilling === 'function') {
            window.Android.launchBilling(_selectedPlan);
            document.getElementById('subPanel')?.remove();
            return;
        }

        try {
            const r = await fetch(_apiBase() + '/api/subscription/activate', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body:    JSON.stringify({
                    planId:     _selectedPlan,
                    source:     _selectedMethod,
                    paymentData: payData,
                    manual:     isManual,
                }),
            });
            const j = await r.json();

            if (!j.ok) {
                if (msg) {
                    msg.style.display    = 'block';
                    msg.style.background = '#7f1d1d';
                    msg.style.color      = '#fca5a5';
                    msg.textContent      = j.error || 'No se pudo procesar el pago.';
                }
                if (btn)     btn.disabled  = false;
                if (btnTxt)  btnTxt.style.display  = 'inline';
                if (btnSpin) btnSpin.style.display = 'none';
                return;
            }

            // Éxito
            if (msg) {
                msg.style.display    = 'block';
                msg.style.background = '#064e3b';
                msg.style.color      = '#6ee7b7';
                msg.textContent      = isManual
                    ? '📤 Solicitud enviada. Tu plan se activará en menos de 2 horas hábiles.'
                    : '🎐 ¡Pago procesado! Tu plan está activo.';
            }

            if (!isManual) {
                _subStatus = j.data;
                localStorage.setItem(SUB_CACHE_KEY, JSON.stringify({ data: j.data, ts: Date.now() }));
            }

            setTimeout(() => {
                document.getElementById('subPanel')?.remove();
                _hidPaywall();
                if (!isManual) {
                    // Pago automático confirmado — mostrar la app
                    _subStatus = j.data;
                    window._appShown = false; // permitir que _showAppAfterAuth corra de nuevo
                    if (typeof window._showAppAfterAuth === 'function') {
                        window._showAppAfterAuth(j.data);
                    } else {
                        const app = document.getElementById('appMain');
                        if (app && !app.classList.contains('visible')) app.classList.add('visible');
                    }
                    _updateSubUI(j.data);
                    const planNames = { basic:'Básico', pro:'Pro', semestral:'Semestral' };
                    if (typeof showToast === 'function')
                        showToast('🎐', '¡Plan ' + (planNames[_selectedPlan] || _selectedPlan) + ' activado!');
                    if (typeof loadTeamMembers === 'function') loadTeamMembers();
                } else {
                    if (typeof showToast === 'function')
                        showToast('📤', 'Solicitud enviada — verificaremos tu pago pronto.');
                }
            }, 1800);

        } catch (e) {
            if (msg) {
                msg.style.display    = 'block';
                msg.style.background = '#7f1d1d';
                msg.style.color      = '#fca5a5';
                msg.textContent      = 'No se pudo conectar al servidor. Verifica tu conexión.';
            }
            if (btn)     btn.disabled  = false;
            if (btnTxt)  btnTxt.style.display  = 'inline';
            if (btnSpin) btnSpin.style.display = 'none';
        }
    };

    // Restaurar compras (desde paywall)
    window.restorePurchases = async function() {
        const token = localStorage.getItem('fixpromax_token');
        try {
            const r = await fetch(_apiBase() + '/api/subscription/restore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: '{}',
            });
            const j = await r.json();
            if (j.ok && j.data?.access) {
                _subStatus = j.data;
                localStorage.setItem(SUB_CACHE_KEY, JSON.stringify({ data: j.data, ts: Date.now() }));
                _hidPaywall();
                window._appShown = false;
                if (typeof window._showAppAfterAuth === 'function') {
                    window._showAppAfterAuth(j.data);
                } else {
                    const app = document.getElementById('appMain');
                    if (app && !app.classList.contains('visible')) app.classList.add('visible');
                }
                _updateSubUI(j.data);
                if (typeof showToast === 'function') showToast('âœ…', 'Compras restauradas correctamente.');
            } else {
                if (typeof showToast === 'function') showToast('â„¹ï¸', 'No se encontraron compras activas para restaurar.');
            }
        } catch {
            if (typeof showToast === 'function') showToast('⚠️ï¸', 'No se pudo conectar al servidor.');
        }
    };

    // Cancelar suscripción (desde Configuración)
    window.cancelSubscription = async function() {
        if (!confirm('¿Cancelar suscripción? Mantendrás acceso hasta la fecha de vencimiento.')) return;
        const token = localStorage.getItem('fixpromax_token');
        try {
            const r = await fetch(_apiBase() + '/api/subscription/cancel', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token },
            });
            const j = await r.json();
            if (j.ok) {
                if (typeof showToast === 'function') showToast('⚠️ï¸', j.data?.message || 'Suscripción cancelada.');
                await checkAccess();
            }
        } catch {
            if (typeof showToast === 'function') showToast('⚠️ï¸', 'No se pudo cancelar. Intenta de nuevo.');
        }
    };

    // Handler llamado desde TWA cuando Google Play confirma la compra
    window.onGooglePlayPurchaseSuccess = async function(planId, purchaseToken, orderId) {
        const token = localStorage.getItem('fixpromax_token');
        try {
            const r = await fetch(_apiBase() + '/api/subscription/verify-google-play', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify({ planId, purchaseToken, orderId }),
            });
            const j = await r.json();
            if (j.ok && j.data?.access) {
                _subStatus = j.data;
                localStorage.setItem(SUB_CACHE_KEY, JSON.stringify({ data: j.data, ts: Date.now() }));
                _hidPaywall();
                window._appShown = false;
                if (typeof window._showAppAfterAuth === 'function') {
                    window._showAppAfterAuth(j.data);
                } else {
                    const app = document.getElementById('appMain');
                    if (app && !app.classList.contains('visible')) app.classList.add('visible');
                }
                _updateSubUI(j.data);
                if (typeof showToast === 'function') showToast('🎐', '¡Pago confirmado! Suscripción activa.');
            }
        } catch (e) { console.error('Error verificando pago Google Play:', e); }
    };

    /* ══════════════════════════════════════════════════════════════
       INTEGRACIÓN CON auth.js — Hook post-login
       Se ejecuta después de que auth.js llama _enterApp
       ══════════════════════════════════════════════════════════════ */
    // Sobrescribir la función _enterApp de auth.js para añadir verificación de suscripción
    const _origEnterApp = window._enterAppHook || null;

    // Hook: cuando auth.js termina de mostrar la app, verificamos acceso
    // Usamos MutationObserver para detectar cuando #appMain se hace visible
    const _observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(m) {
            if (m.type === 'attributes' && m.attributeName === 'class') {
                const app = document.getElementById('appMain');
                if (app && app.classList.contains('visible')) {
                    // App acaba de mostrarse → verificar suscripción
                    setTimeout(checkAccess, 300);
                }
            }
        });
    });

    // Iniciar observación cuando el DOM esté listo
    // El MutationObserver ahora solo sirve como respaldo por si algo externo
    // añade 'visible' a #appMain sin pasar por auth.js
    function _init() {
        const app = document.getElementById('appMain');
        if (app) {
            _observer.observe(app, { attributes: true });
        }
        // Si la app YA es visible al cargar (caso raro: recarga con clase en DOM),
        // verificar de inmediato para asegurar que el acceso sigue siendo válido.
        if (app && app.classList.contains('visible')) {
            setTimeout(checkAccess, 0);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        _init();
    }

})();
