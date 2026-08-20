/**
 * FIX PRO MAX — Sistema de Autenticación Completo
 * auth.js — Módulo independiente, no modifica el ERP existente.
 *
 * Funciones exportadas al window:
 *   switchAuthTab, submitLogin, submitRegister, submitRecover,
 *   submitMustChange, logoutUser, openUserProfile, closeUserProfile,
 *   saveUserProfile, checkExistingSession, clearSessionAndReload
 */
(function AuthModule() {
    'use strict';

    /* â”€â”€ Constantes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
    const AUTH_KEY        = 'fixpromax_token';
    const LOCAL_KEY       = 'fixpromax_local_users';
    const RECOVER_KEY     = 'fixpromax_recover';          // código de recuperación en tránsito
    const API_BASE        = (() => {
        const h = window.location.hostname;
        // Si es localhost, 127.0.0.1 o una IP privada → usar el origen actual
        if (h === 'localhost' || h === '127.0.0.1' ||
            h.startsWith('192.168.') || h.startsWith('10.') || h.startsWith('172.')) {
            return window.location.origin;
        }
        return window.location.origin;
    })();

    /* â”€â”€ Estado interno â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
    let _pendingUser   = null;   // usuario pendiente de mustChange
    let _recoverEmail  = null;   // email en flujo de recuperación

    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
       UTILIDADES LOCALES (fallback sin servidor)
       â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

    function _h(str) {
        // Hash djb2 simple — solo para fallback offline
        let h = 5381;
        for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
        return 'L' + (h >>> 0).toString(16).padStart(8, '0') + str.length;
    }

    function _localUsers() {
        try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch { return []; }
    }
    function _localSave(users) {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(users));
    }

    function _localRegister({ name, email, password, company, mode }) {
        const users = _localUsers().filter(u => u.email !== email.toLowerCase());
        const user  = {
            id: 'l' + Date.now().toString(36),
            name, email: email.toLowerCase(),
            company: company || '', mode: mode || 'basic',
            role: _localUsers().length === 0 ? 'admin' : 'user',
            avatar: name.slice(0, 2).toUpperCase(),
            passwordHash: _h(password), local: true,
        };
        users.push(user);
        _localSave(users);
        localStorage.setItem(AUTH_KEY, 'lt_' + user.id);
        return user;
    }

    function _localLogin(email, password) {
        const user = _localUsers().find(u => u.email === email.toLowerCase());
        if (!user || user.passwordHash !== _h(password)) return null;
        localStorage.setItem(AUTH_KEY, 'lt_' + user.id);
        return user;
    }

    function _localSession(token) {
        if (!token || !token.startsWith('lt_')) return null;
        return _localUsers().find(u => u.id === token.slice(3)) || null;
    }

    function _saveLocalUser(user) {
        const users = _localUsers().filter(u => u.email !== user.email);
        users.push(user);
        _localSave(users);
    }

    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
       HTTP HELPER con timeout y manejo limpio de errores
       â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
    async function _post(path, body, token) {
        const ctrl = new AbortController();
        const tid  = setTimeout(() => ctrl.abort(), 6000);
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = 'Bearer ' + token;
            const r = await fetch(API_BASE + path, {
                method: 'POST', headers,
                body: JSON.stringify(body), signal: ctrl.signal,
            });
            clearTimeout(tid);
            return await r.json();
        } catch (e) {
            clearTimeout(tid);
            return null;   // null = sin respuesta del servidor
        }
    }

    async function _put(path, body, token) {
        const ctrl = new AbortController();
        const tid  = setTimeout(() => ctrl.abort(), 6000);
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = 'Bearer ' + token;
            const r = await fetch(API_BASE + path, {
                method: 'PUT', headers,
                body: JSON.stringify(body), signal: ctrl.signal,
            });
            clearTimeout(tid);
            return await r.json();
        } catch (e) {
            clearTimeout(tid);
            return null;
        }
    }

    async function _get(path, token) {
        const ctrl = new AbortController();
        const tid  = setTimeout(() => ctrl.abort(), 5000);
        try {
            const headers = {};
            if (token) headers['Authorization'] = 'Bearer ' + token;
            const r = await fetch(API_BASE + path, { headers, signal: ctrl.signal });
            clearTimeout(tid);
            return await r.json();
        } catch {
            clearTimeout(tid);
            return null;
        }
    }

    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
       UI HELPERS — mostrar/ocultar elementos del auth
       â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
    function _form(id) { return document.getElementById(id); }

    function _setError(formId, msg) {
        const el = _form(formId + 'Error');
        if (!el) return;
        el.innerHTML = msg;
        el.style.display = msg ? 'block' : 'none';
    }
    function _setSuccess(formId, msg) {
        const el = _form(formId + 'Success');
        if (!el) return;
        el.innerHTML = msg;
        el.style.display = msg ? 'block' : 'none';
    }

    function _setLoading(btnId, loading) {
        const btn     = _form(btnId);
        const txtId   = btnId.replace('Btn', 'BtnText');
        const spinId  = btnId.replace('Btn', 'BtnSpinner');
        const txt     = _form(txtId);
        const spin    = _form(spinId);
        if (btn)  btn.disabled        = loading;
        if (txt)  txt.style.display   = loading ? 'none'         : 'inline';
        if (spin) spin.style.display  = loading ? 'inline-block' : 'none';
    }

    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
       TABS — Iniciar sesión / Crear cuenta / Recuperar
       â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
    function switchAuthTab(tab) {
        const tabs = { login: 'loginForm', register: 'registerForm',
                       recover: 'recoverForm', mustchange: 'mustChangeForm' };
        Object.entries(tabs).forEach(([t, formId]) => {
            const f = _form(formId);
            if (f) f.style.display = (t === tab) ? 'block' : 'none';
        });
        // Actualizar tab activo (login/register/recover únicamente)
        ['tabLogin','tabRegister','tabRecover'].forEach(id => {
            const el = _form(id);
            if (!el) return;
            const match = id === 'tabLogin'    ? 'login'    :
                          id === 'tabRegister' ? 'register' : 'recover';
            el.classList.toggle('active', match === tab);
        });
        // Ocultar tabs cuando es mustchange
        const tabs_row = document.querySelector('.auth-tabs');
        if (tabs_row) tabs_row.style.display = (tab === 'mustchange') ? 'none' : '';
        // Limpiar errores
        ['loginError','registerError','recoverError','mustChangeError'].forEach(id => {
            const el = _form(id);
            if (el) el.style.display = 'none';
        });
        ['recoverSuccess'].forEach(id => {
            const el = _form(id);
            if (el) el.style.display = 'none';
        });
    }

    // Exponer globalmente para los onclick del HTML
    window.switchAuthTab = switchAuthTab;

    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
       LOGIN
       â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
    async function submitLogin(e) {
        e.preventDefault();
        _setError('login', '');
        const email    = (_form('loginEmail')?.value || '').trim().toLowerCase();
        const password = _form('loginPassword')?.value || '';
        if (!email || !password) { _setError('login', 'Debes completar todos los campos.'); return; }

        const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
        if (!emailOk) { _setError('login', 'El correo electrónico no tiene un formato válido.'); return; }

        _setLoading('loginBtn', true);

        // Intentar con servidor
        const json = await _post('/api/auth/login', { email, password });

        if (json !== null) {
            // Servidor respondió
            if (!json.ok) {
                _setError('login', json.error === 'Email o contraseña incorrectos'
                    ? 'El correo electrónico o la contraseña son incorrectos.'
                    : json.error || 'No pudimos completar la operación. Inténtalo nuevamente.');
                _setLoading('loginBtn', false);
                return;
            }
            localStorage.setItem(AUTH_KEY, json.data.token);
            // Guardar localmente para fallback offline
            _saveLocalUser({ ...json.data.user, passwordHash: _h(password) });
            _setLoading('loginBtn', false);
            // Si debe cambiar contraseña
            if (json.data.user.mustChange) {
                _pendingUser = json.data.user;
                switchAuthTab('mustchange');
                return;
            }
            _enterApp(json.data.user);
            return;
        }

        // Servidor no responde → intentar offline
        const local = _localLogin(email, password);
        if (local) {
            _setLoading('loginBtn', false);
            _enterApp(local);
            _toast('⚠️ï¸', 'Modo sin conexión — usando datos locales');
            return;
        }

        _setError('login',
            'El correo electrónico o la contraseña son incorrectos.' +
            '<br><small style="opacity:.8">Si el servidor no responde, usa ' +
            '<a href="/entrar" style="color:#4f46e5">acceso de emergencia</a>.</small>');
        _setLoading('loginBtn', false);
    }
    window.submitLogin = submitLogin;

    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
       LOGIN DEMO — acceso sin credenciales, BD completamente aislada
       â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
    async function loginDemo() {
        const btn = document.getElementById('demoBtnLogin') || document.getElementById('demoBtn');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Cargando demo...'; }
        _setError('login', '');

        const json = await _post('/api/demo/login', {});

        if (json && json.ok) {
            localStorage.setItem(AUTH_KEY, json.data.token);
            _saveLocalUser({ ...json.data.user });
            if (btn) { btn.disabled = false; btn.innerHTML = '🎭 Probar Demo'; }
            _enterApp(json.data.user);
            // Mostrar banner demo
            setTimeout(() => {
                const existing = document.getElementById('demoBanner');
                if (!existing) _showDemoBanner();
            }, 800);
        } else {
            if (btn) { btn.disabled = false; btn.innerHTML = '🎭 Probar Demo'; }
            _setError('login', 'No se pudo iniciar el modo demo. Intenta de nuevo.');
        }
    }
    window.loginDemo = loginDemo;

    function _showDemoBanner() {
        const banner = document.createElement('div');
        banner.id = 'demoBanner';
        banner.style.cssText = [
            'position:fixed;top:0;left:0;right:0;z-index:99999',
            'background:linear-gradient(90deg,#f59e0b,#d97706)',
            'color:#000;font-size:13px;font-weight:700',
            'padding:8px 16px;display:flex;align-items:center;justify-content:space-between',
            'gap:12px;flex-wrap:wrap;box-shadow:0 2px 8px rgba(0,0,0,.3)',
        ].join(';');
        banner.innerHTML = `
            <span>🎭 <strong>MODO DEMO</strong> — Los datos de esta sesión son independientes y no afectan cuentas reales.</span>
            <div style="display:flex;gap:8px;align-items:center;flex-shrink:0;">
                <button onclick="window._resetDemo()" style="padding:4px 12px;background:#000;color:#f59e0b;border:none;border-radius:6px;font-weight:700;cursor:pointer;font-size:12px;">✅ Restablecer datos</button>
                <button onclick="document.getElementById('demoBanner').remove()" style="background:none;border:none;font-size:16px;cursor:pointer;color:#000;">✕�</button>
            </div>`;
        document.body.prepend(banner);
        // Bajar el contenido para que no quede tapado por el banner
        const app = document.getElementById('appMain');
        if (app) app.style.paddingTop = '42px';
    }
    window._showDemoBanner = _showDemoBanner;

    window._resetDemo = async function() {
        const tok = localStorage.getItem(AUTH_KEY);
        if (!tok) return;
        const r = await fetch(window.location.origin + '/api/demo/reset', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const j = await r.json();
        if (j.ok) {
            // Recargar datos demo frescos
            const dbRes  = await fetch(window.location.origin + '/api/db', { headers: { 'Authorization': 'Bearer ' + tok } });
            const dbJson = await dbRes.json();
            if (dbJson.ok && typeof window._setAppData === 'function') {
                window._setAppData(dbJson.data);
            }
            if (typeof renderAll === 'function') renderAll();
            if (typeof showToast === 'function') showToast('✕�', 'Datos demo restablecidos correctamente');
        }
    };

    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
       REGISTRO
       â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
    async function submitRegister(e) {
        e.preventDefault();
        _setError('register', '');
        const name     = (_form('regName')?.value     || '').trim();
        const email    = (_form('regEmail')?.value    || '').trim().toLowerCase();
        const company  = (_form('regCompany')?.value  || '').trim();
        const password = _form('regPassword')?.value  || '';
        const password2= _form('regPassword2')?.value || '';
        const mode     = _form('regMode')?.value      || 'basic';

        if (!name || !email || !password) { _setError('register', 'Debes completar todos los campos obligatorios.'); return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { _setError('register', 'El correo electrónico no tiene un formato válido.'); return; }
        if (password.length < 6) { _setError('register', 'La contraseña debe tener al menos 6 caracteres.'); return; }
        if (password !== password2) { _setError('register', 'Las contraseñas no coinciden.'); return; }

        _setLoading('registerBtn', true);

        const json = await _post('/api/auth/register', { name, email, password, company, mode });

        if (json !== null) {
            if (!json.ok) {
                const msg = json.error.includes('Ya existe')
                    ? 'Ya existe una cuenta registrada con ese correo electrónico.'
                    : json.error || 'No pudimos completar el registro. Inténtalo nuevamente.';
                _setError('register', msg);
                _setLoading('registerBtn', false);
                return;
            }
            localStorage.setItem(AUTH_KEY, json.data.token);
            _saveLocalUser({ ...json.data.user, passwordHash: _h(password) });
            _setLoading('registerBtn', false);
            _enterApp(json.data.user);
            _toast('🎐', '¡Bienvenido, ' + name.split(' ')[0] + '!');
            return;
        }

        // Sin servidor → registro local
        // Verificar si ya existe localmente
        if (_localUsers().find(u => u.email === email.toLowerCase())) {
            _setError('register', 'Ya existe una cuenta registrada con ese correo electrónico.');
            _setLoading('registerBtn', false);
            return;
        }
        const local = _localRegister({ name, email, password, company, mode });
        _setLoading('registerBtn', false);
        _enterApp(local);
        _toast('⚠️ï¸', 'Cuenta creada localmente. Abre desde http://localhost:3000 para sincronizar.');
    }
    window.submitRegister = submitRegister;

    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
       RECUPERACIÓN DE CONTRASEÑA
       â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
    let _recoverStep = 1;

    async function submitRecover(e) {
        e.preventDefault();
        _setError('recover', '');
        _setSuccess('recover', '');

        if (_recoverStep === 1) {
            // Paso 1: enviar código
            const email = (_form('recoverEmail')?.value || '').trim().toLowerCase();
            if (!email) { _setError('recover', 'Debes completar todos los campos.'); return; }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                _setError('recover', 'El correo electrónico no tiene un formato válido.'); return;
            }
            _setLoading('recoverBtn', true);

            const json = await _post('/api/auth/recover-request', { email });
            _setLoading('recoverBtn', false);

            if (json !== null) {
                if (!json.ok) {
                    _setError('recover', json.error || 'No pudimos enviar el código. Verifica el correo.');
                    return;
                }
                // Modo desarrollo: el código viene en la respuesta
                if (json.data && json.data.devCode) {
                    _setSuccess('recover', '✕� Código enviado. <br><strong>Código de prueba: ' +
                        json.data.devCode + '</strong> (solo visible en desarrollo)');
                } else {
                    _setSuccess('recover', '✕� Código enviado a ' + email + '. Revisa tu bandeja de entrada.');
                }
            } else {
                // Sin servidor → generar código local
                const code = Math.floor(100000 + Math.random() * 900000).toString();
                localStorage.setItem(RECOVER_KEY, JSON.stringify({ email, code, exp: Date.now() + 600000 }));
                _setSuccess('recover', '✕� Código generado localmente: <strong>' + code + '</strong><br>' +
                    '<small>(el servidor no está disponible — usa este código)</small>');
            }

            _recoverEmail = email;
            const step2 = _form('recoverStep2');
            if (step2) step2.style.display = 'block';
            const btnTxt = _form('recoverBtnText');
            if (btnTxt) btnTxt.textContent = 'Restablecer contraseña';
            _recoverStep = 2;

        } else {
            // Paso 2: verificar código y cambiar contraseña
            const code    = (_form('recoverCode')?.value    || '').trim();
            const newPass = (_form('recoverNewPass')?.value  || '');
            if (!code || !newPass)   { _setError('recover', 'Debes completar todos los campos.'); return; }
            if (newPass.length < 6)  { _setError('recover', 'La contraseña debe tener al menos 6 caracteres.'); return; }

            _setLoading('recoverBtn', true);

            const json = await _post('/api/auth/recover-reset', {
                email: _recoverEmail, code, newPassword: newPass,
            });
            _setLoading('recoverBtn', false);

            if (json !== null) {
                if (!json.ok) {
                    _setError('recover', json.error || 'Código incorrecto o expirado. Intenta nuevamente.');
                    return;
                }
                _setSuccess('recover', '✕� Contraseña restablecida correctamente. Ahora puedes iniciar sesión.');
                setTimeout(() => {
                    _recoverStep = 1;
                    _recoverEmail = null;
                    if (_form('recoverStep2')) _form('recoverStep2').style.display = 'none';
                    if (_form('recoverBtnText')) _form('recoverBtnText').textContent = 'Enviar código';
                    if (_form('recoverEmail')) _form('recoverEmail').value = '';
                    if (_form('recoverCode'))  _form('recoverCode').value  = '';
                    if (_form('recoverNewPass')) _form('recoverNewPass').value = '';
                    switchAuthTab('login');
                }, 2500);
            } else {
                // Sin servidor → verificar código local
                try {
                    const stored = JSON.parse(localStorage.getItem(RECOVER_KEY) || '{}');
                    if (!stored.code || stored.code !== code || stored.email !== _recoverEmail || Date.now() > stored.exp) {
                        _setError('recover', 'Código incorrecto o expirado. Intenta nuevamente.');
                        return;
                    }
                    // Cambiar contraseña localmente
                    const users = _localUsers().map(u => {
                        if (u.email === _recoverEmail) return { ...u, passwordHash: _h(newPass) };
                        return u;
                    });
                    _localSave(users);
                    localStorage.removeItem(RECOVER_KEY);
                    _setSuccess('recover', '✕� Contraseña restablecida localmente.');
                    setTimeout(() => { _recoverStep = 1; switchAuthTab('login'); }, 2000);
                } catch {
                    _setError('recover', 'No pudimos completar la operación. Inténtalo nuevamente.');
                }
            }
        }
    }
    window.submitRecover = submitRecover;

    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
       CAMBIO OBLIGATORIO DE CONTRASEÃ‘A (mustChange)
       â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
    async function submitMustChange(e) {
        e.preventDefault();
        _setError('mustChange', '');
        const p1 = _form('mcNewPass')?.value  || '';
        const p2 = _form('mcNewPass2')?.value || '';
        if (!p1 || !p2)   { _setError('mustChange', 'Debes completar todos los campos.'); return; }
        if (p1.length < 6) { _setError('mustChange', 'La contraseña debe tener al menos 6 caracteres.'); return; }
        if (p1 !== p2)     { _setError('mustChange', 'Las contraseñas no coinciden.'); return; }

        _setLoading('mustChangeBtn', true);
        const token = localStorage.getItem(AUTH_KEY);
        const json  = await _post('/api/auth/change-password', { newPassword: p1 }, token);
        _setLoading('mustChangeBtn', false);

        if (json !== null && json.ok) {
            _saveLocalUser({ ..._pendingUser, passwordHash: _h(p1), mustChange: false });
            const updatedUser = { ..._pendingUser, mustChange: false };
            _pendingUser = null;
            _enterApp(updatedUser);
            _toast('✕�', 'Contraseña actualizada. ¡Bienvenido!');
        } else if (json === null) {
            // Sin servidor → cambiar localmente
            if (_pendingUser) {
                _saveLocalUser({ ..._pendingUser, passwordHash: _h(p1), mustChange: false });
                const u = { ..._pendingUser, mustChange: false };
                _pendingUser = null;
                _enterApp(u);
            }
        } else {
            _setError('mustChange', json.error || 'No pudimos actualizar la contraseña. Inténtalo nuevamente.');
        }
    }
    window.submitMustChange = submitMustChange;

    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
       VERIFICAR SESIÓN AL CARGAR
       â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
    async function checkExistingSession() {
        // 1. Token en URL (desde /entrar-como)
        const params = new URLSearchParams(window.location.search);
        const urlToken = params.get('token');
        if (urlToken) {
            localStorage.setItem(AUTH_KEY, urlToken);
            const user = {
                id:      params.get('id')      || '',
                name:    params.get('name')    || 'Usuario',
                email:   params.get('email')   || '',
                role:    params.get('role')    || 'user',
                mode:    params.get('mode')    || 'basic',
                avatar:  params.get('avatar')  || '',
                company: params.get('company') || '',
            };
            history.replaceState({}, '', '/');
            _enterApp(user);
            return;
        }

        // 2. Token en localStorage
        const token = localStorage.getItem(AUTH_KEY);
        if (!token) return;   // Sin token → mostrar login

        // 2a. Token local
        if (token.startsWith('lt_')) {
            const u = _localSession(token);
            if (u) { _enterApp(u); return; }
            localStorage.removeItem(AUTH_KEY);
            return;
        }

        // 2b. Token del servidor
        const json = await _get('/api/auth/me', token);
        if (json === null) {
            // Sin servidor → intentar sesión local
            const u = _localSession(token);
            if (u) { _enterApp(u); return; }
            localStorage.removeItem(AUTH_KEY);
            return;
        }
        if (!json.ok) {
            // Sesión expirada
            localStorage.removeItem(AUTH_KEY);
            _showSessionExpired();
            return;
        }
        if (json.data.mustChange) {
            _pendingUser = json.data;
            switchAuthTab('mustchange');
            return;
        }

        // 2c. Verificar suscripción ANTES de mostrar la app
        // Limpiar caché de suscripción para forzar verificación fresca
        try { localStorage.removeItem('fixpromax_sub_cache'); } catch(e) {}

        // Si __INITIAL_SUB__ ya lo sabemos del servidor (inyectado en el HTML)
        const initSub = window.__INITIAL_SUB__;
        if (initSub && initSub.access === false && json.data.role !== 'admin') {
            // No hay acceso — entrar a la app pero el paywall se mostrará
            _enterApp(json.data);
            return;
        }

        _enterApp(json.data);
    }
    window.checkExistingSession = checkExistingSession;

    function _showSessionExpired() {
        const el = document.getElementById('loginError');
        if (el) {
            el.innerHTML = 'Tu sesión ha expirado. Inicia sesión nuevamente.';
            el.style.display = 'block';
        }
    }

    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
       LOGOUT
       â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
    async function logoutUser() {
        if (!confirm('¿Cerrar sesión?')) return;
        const token = localStorage.getItem(AUTH_KEY);
        if (token && !token.startsWith('lt_')) {
            await _post('/api/auth/logout', {}, token).catch(() => {});
        }
        localStorage.removeItem(AUTH_KEY);
        localStorage.removeItem('fixpromax_sub_cache');
        window._currentUser = null;
        // Limpiar formularios
        ['loginEmail','loginPassword'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        document.getElementById('loginError')?.setAttribute('style', 'display:none');
        // Ocultar app y paywall, mostrar login
        document.getElementById('appMain')?.classList.remove('visible');
        const pw = document.getElementById('paywallScreen');
        if (pw) pw.style.display = 'none';
        document.getElementById('authScreen').style.display = 'flex';
        // Restaurar tabs
        const tabs_row = document.querySelector('.auth-tabs');
        if (tabs_row) tabs_row.style.display = '';
        switchAuthTab('login');
        _toast('👙', 'Sesión cerrada correctamente.');
    }
    window.logoutUser = logoutUser;

    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
       PERFIL DE USUARIO
       â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
    function openUserProfile() {
        const u = window._currentUser;
        if (!u) return;
        // Navegar a Configuración donde está ahora el perfil
        if (typeof navigateTo === 'function') navigateTo('settings');

        // Poblar los campos del perfil incrustado en Configuración
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
        const txt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || ''; };

        txt('settingsProfileName',  u.name);
        txt('settingsProfileEmail', u.email);
        txt('settingsProfileRole',  u.role === 'admin' ? '👑 Administrador' : '👤 Usuario');

        const avatEl = document.getElementById('settingsAvatar');
        if (avatEl) {
            if (u.photoUrl) {
                avatEl.style.backgroundImage = 'url(' + u.photoUrl + ')';
                avatEl.style.backgroundSize  = 'cover';
                avatEl.textContent = '';
            } else {
                avatEl.style.backgroundImage = '';
                avatEl.textContent = u.avatar || u.name.slice(0, 2).toUpperCase();
            }
        }

        set('profileEditName',    u.name);
        set('profileEditCompany', u.company);
        set('profileEditPhoto',   u.photoUrl || '');
        set('profileCurrentPass', '');
        set('profileNewPass',     '');
        set('profileNewPass2',    '');

        const msg = document.getElementById('settingsProfileMsg') || document.getElementById('profileMsg');
        if (msg) { msg.textContent = ''; msg.className = 'profileMsg'; }

        // Scroll suave hacia el formulario de perfil
        setTimeout(() => {
            const card = document.getElementById('settingsProfileCard');
            if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    }
    window.openUserProfile = openUserProfile;

    // closeUserProfile ya no cierra modal — simplemente es un no-op por compatibilidad
    function closeUserProfile() {}
    window.closeUserProfile = closeUserProfile;

    async function saveUserProfile(e) {
        if (e) e.preventDefault();
        // Mensaje puede estar en el inline de settings o en el modal (compatibilidad)
        const msg   = document.getElementById('settingsProfileMsg') || document.getElementById('profileMsg');
        const name  = document.getElementById('profileEditName')?.value.trim() || '';
        const comp  = document.getElementById('profileEditCompany')?.value.trim() || '';
        const photo = document.getElementById('profileEditPhoto')?.value.trim()   || '';
        const curP  = document.getElementById('profileCurrentPass')?.value || '';
        const newP  = document.getElementById('profileNewPass')?.value     || '';
        const newP2 = document.getElementById('profileNewPass2')?.value    || '';

        if (!name) {
            if (msg) { msg.textContent = 'El nombre no puede estar vacío.'; msg.className = 'profileMsg err'; }
            return;
        }
        if (newP && newP !== newP2) {
            if (msg) { msg.textContent = 'Las contraseñas nuevas no coinciden.'; msg.className = 'profileMsg err'; }
            return;
        }
        if (newP && newP.length < 6) {
            if (msg) { msg.textContent = 'La nueva contraseña debe tener al menos 6 caracteres.'; msg.className = 'profileMsg err'; }
            return;
        }

        const token = localStorage.getItem(AUTH_KEY);
        const body  = { name, company: comp };
        if (photo) body.photoUrl = photo;
        if (newP)  { body.password = curP; body.newPassword = newP; }

        const json = await (token && !token.startsWith('lt_')
            ? _put('/api/auth/me', body, token).catch(() => null)
            : Promise.resolve(null));

        // Actualizar estado local y UI del sidebar
        if (window._currentUser) {
            window._currentUser.name    = name;
            window._currentUser.company = comp;
            if (photo) window._currentUser.photoUrl = photo;

            const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
            window._currentUser.avatar = initials;

            // Sidebar user-card
            const nameEl = document.querySelector('.sidebar .user-card .info .name');
            const roleEl = document.querySelector('.sidebar .user-card .info .role');
            const avatEl = document.querySelector('.sidebar .user-card .avatar, #sidebarAvatar');
            if (nameEl) nameEl.textContent = name;
            if (roleEl) roleEl.textContent = (window._currentUser.role === 'admin' ? 'Admin' : 'Usuario') +
                (comp ? ' · ' + comp : '');
            if (avatEl) {
                if (photo) {
                    avatEl.style.backgroundImage = 'url(' + photo + ')';
                    avatEl.style.backgroundSize  = 'cover';
                    avatEl.textContent = '';
                } else {
                    avatEl.style.backgroundImage = '';
                    avatEl.textContent = initials;
                }
            }

            // Actualizar también el avatar en settingsProfileCard
            const settingsAv = document.getElementById('settingsAvatar');
            if (settingsAv) {
                if (photo) {
                    settingsAv.style.backgroundImage = 'url(' + photo + ')';
                    settingsAv.style.backgroundSize  = 'cover';
                    settingsAv.textContent = '';
                } else {
                    settingsAv.style.backgroundImage = '';
                    settingsAv.textContent = initials;
                }
            }
            const snEl = document.getElementById('settingsProfileName');
            if (snEl) snEl.textContent = name;

            _saveLocalUser({ ...window._currentUser, passwordHash: newP ? _h(newP) : undefined });
        }

        if (json !== null && !json.ok) {
            const errMsg = json.error === 'Contraseña actual incorrecta'
                ? 'La contraseña actual es incorrecta.'
                : json.error || 'No pudimos guardar los cambios.';
            if (msg) { msg.textContent = errMsg; msg.className = 'profileMsg err'; }
            return;
        }

        if (msg) {
            msg.textContent = '✕� Perfil actualizado correctamente.';
            msg.className = 'profileMsg ok';
            // Limpiar campos de contraseña
            ['profileCurrentPass','profileNewPass','profileNewPass2'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
            setTimeout(() => { msg.textContent = ''; msg.className = 'profileMsg'; }, 3000);
        }
        _toast('✕�', 'Perfil actualizado');
    }
    window.saveUserProfile = saveUserProfile;

    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
       ENTRAR A LA APP — delega en el ERP existente
       â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
    function _enterApp(user) {
        window._currentUser = user;

        // Actualizar user-card del sidebar
        const nameEl = document.querySelector('.sidebar .user-card .info .name');
        const roleEl = document.querySelector('.sidebar .user-card .info .role');
        const avatEl = document.querySelector('.sidebar .user-card .avatar, #sidebarAvatar');
        if (nameEl) nameEl.textContent = user.name;
        if (roleEl) roleEl.textContent = (user.role === 'admin' ? 'Admin' : 'Usuario') +
                                         (user.company ? ' · ' + user.company : '');
        if (avatEl) {
            if (user.photoUrl) {
                avatEl.style.backgroundImage = 'url(' + user.photoUrl + ')';
                avatEl.style.backgroundSize  = 'cover';
                avatEl.textContent = '';
            } else {
                avatEl.style.backgroundImage = '';
                avatEl.textContent = user.avatar || user.name.slice(0, 2).toUpperCase();
            }
        }

        // Botón logout en sidebar (una sola vez)
        const userCard = document.querySelector('.sidebar .user-card');
        if (userCard && !document.getElementById('logoutBtn')) {
            const btn = document.createElement('button');
            btn.id = 'logoutBtn'; btn.className = 'btn-icon';
            btn.title = 'Cerrar sesión';
            btn.style.cssText = 'width:34px;height:34px;font-size:15px;';
            btn.textContent = '🚪'; btn.onclick = logoutUser;
            userCard.appendChild(btn);
        }

        // Ocultar pantalla de auth
        document.getElementById('authScreen').style.display = 'none';

        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        // FASE 1 — Setup silencioso (sin mostrar la app todavía)
        // Preparar todo en memoria pero NO mostrar #appMain.
        // La app solo se muestra en FASE 2, después de que el servidor confirme
        // que el usuario tiene acceso activo (trial o suscripción).
        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        try { localStorage.removeItem('fixpromax_sub_cache'); } catch(e) {}

        // Restaurar tabs
        const tabs_row = document.querySelector('.auth-tabs');
        if (tabs_row) tabs_row.style.display = '';

        // Aplicar modo visual (no muestra la app, solo prepara CSS/badges)
        if (typeof applyMode === 'function') applyMode(user.mode || 'basic');

        // Pre-rellenar perfil en Configuración (en background, no visible aún)
        setTimeout(function() {
            if (typeof window._plansLoad === 'function') window._plansLoad();
        }, 500);

        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        // FASE 2 — Mostrar app (solo la llama subscription.js tras verificar)
        // Esta función se expone globalmente para que subscription.js la invoque
        // cuando el servidor confirme access: true.
        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        window._showAppAfterAuth = function(subStatus) {
            // Evitar doble ejecución
            if (window._appShown) return;
            window._appShown = true;

            // Mostrar la app
            const appEl = document.getElementById('appMain');
            if (appEl && !appEl.classList.contains('visible')) {
                appEl.classList.add('visible');
            }

            // Aplicar restricciones de módulos según el plan
            if (subStatus && subStatus.modules && typeof window._updateSidebarByPlan === 'function') {
                window._updateSidebarByPlan(subStatus.modules);
            }

            // Toast de bienvenida
            _toast('👙', '¡Hola, ' + user.name.split(' ')[0] + '!');

            // Cargar datos frescos del servidor
            const _authToken = localStorage.getItem(AUTH_KEY);
            if (_authToken && window.location.protocol !== 'file:') {
                fetch(window.location.origin + '/api/db', {
                    headers: { 'Authorization': 'Bearer ' + _authToken },
                    signal: AbortSignal.timeout(10000)
                })
                .then(r => r.ok ? r.json() : null)
                .then(json => {
                    const dbKey = typeof DB_KEY !== 'undefined' ? DB_KEY : 'fixData_v4';
                    if (json && json.ok && json.data) {
                        if (typeof window._setAppData === 'function') window._setAppData(json.data);
                        try { localStorage.setItem(dbKey, JSON.stringify(json.data)); } catch(e) {}
                    }
                    if (typeof renderAll            === 'function') renderAll();
                    if (typeof renderInventoryTable === 'function') renderInventoryTable();
                    if (typeof renderInventoryStats === 'function') renderInventoryStats();
                    if (typeof generateAlerts       === 'function') generateAlerts();
                    if (typeof initTeamModule       === 'function') initTeamModule();
                })
                .catch(() => {
                    if (typeof renderAll      === 'function') renderAll();
                    if (typeof generateAlerts === 'function') generateAlerts();
                });
            } else {
                if (typeof renderAll      === 'function') renderAll();
                if (typeof generateAlerts === 'function') generateAlerts();
                if (typeof initTeamModule === 'function') initTeamModule();
            }
        };

        // Limpiar flag de sesión anterior
        window._appShown = false;

        // Admins: acceso total inmediato, sin esperar al servidor de suscripción
        if (user.role === 'admin') {
            window._showAppAfterAuth({ modules: null });
            return;
        }

        // Usuarios normales: esperar a subscription.js para verificar acceso
        // subscription.js llama window._showAppAfterAuth(status) si access===true
        // o muestra el paywall si access===false.
        // TIMEOUT DE SEGURIDAD (FASE 32): si subscription.js no carga en 8 s,
        // mostramos la app de todas formas para evitar carga infinita.
        var _subWaitStart = Date.now();
        (function _waitForSub() {
            if (typeof window.checkSubscriptionAccess === 'function') {
                window.checkSubscriptionAccess();
            } else if (Date.now() - _subWaitStart > 8000) {
                // subscription.js no respondió — mostrar app con acceso básico
                console.warn('[auth] checkSubscriptionAccess no disponible tras 8s — mostrando app');
                window._showAppAfterAuth({ access: true, status: 'unknown', modules: null });
            } else {
                setTimeout(_waitForSub, 50);
            }
        })();

        // Pre-rellenar los campos de perfil en Configuración (seguro, no muestra la app)
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
        const txt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || ''; };
        txt('settingsProfileName',  user.name);
        txt('settingsProfileEmail', user.email);
        txt('settingsProfileRole',  user.role === 'admin' ? '👑 Administrador' : '👤 Usuario');
        const settingsAv = document.getElementById('settingsAvatar');
        if (settingsAv) {
            settingsAv.style.backgroundImage = user.photoUrl ? 'url(' + user.photoUrl + ')' : '';
            settingsAv.textContent = user.photoUrl ? '' : (user.avatar || user.name.slice(0,2).toUpperCase());
        }
        set('profileEditName',    user.name);
        set('profileEditCompany', user.company);
        set('profileEditPhoto',   user.photoUrl || '');
    }

    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
       LIMPIAR SESIÓN (botón emergencia)
       â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
    function clearSessionAndReload() {
        localStorage.removeItem(AUTH_KEY);
        localStorage.removeItem('fixpromax_local_users');
        localStorage.removeItem('fixData_v4');
        localStorage.removeItem(RECOVER_KEY);
        sessionStorage.clear();
        window.location.reload(true);
    }
    window.clearSessionAndReload = clearSessionAndReload;

    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
       TOGGLE PASSWORD VISIBILITY
       â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
    function togglePasswordVis(id, btn) {
        const el = document.getElementById(id);
        if (!el) return;
        el.type = el.type === 'password' ? 'text' : 'password';
        btn.textContent = el.type === 'password' ? '👁' : '🙈';
    }
    window.togglePasswordVis = togglePasswordVis;

    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
       SELECTOR DE MODO (registro)
       â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
    function selectMode(mode) {
        const inp = document.getElementById('regMode');
        if (inp) inp.value = mode;
        document.querySelectorAll('#modeSelectorReg .mode-option').forEach(el => {
            el.classList.toggle('active', el.dataset.mode === mode);
        });
    }
    window.selectMode = selectMode;

    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
       TOAST helper
       â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
    function _toast(icon, msg) {
        if (typeof showToast === 'function') { showToast(icon, msg); return; }
        console.log(icon + ' ' + msg);
    }

    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
       INDICADOR DE SERVIDOR (en la pantalla de login)
       Si la página cargó, el servidor está disponible por definición.
       Solo mostramos error si el HTML vino de un archivo local (file://).
       â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
    async function _checkServer() {
        const badge = document.getElementById('serverStatusAuth');
        if (!badge) return;

        // Si se abrió como archivo local (file://), el servidor no está disponible
        if (window.location.protocol === 'file:') {
            badge.innerHTML = '🔴 Abre desde <strong>' + API_BASE + '</strong>';
            badge.style.color = '#dc2626';
            return;
        }

        // Si llegó aquí es porque el servidor sirvió esta página → siempre está disponible
        // Hacemos un ping rápido solo para confirmar (usando el mismo origin)
        try {
            const ctrl = new AbortController();
            setTimeout(() => ctrl.abort(), 3000);
            const r = await fetch(window.location.origin + '/api/ping', { signal: ctrl.signal });
            const j = await r.json().catch(() => null);
            if (r.ok && j && j.ok) {
                badge.innerHTML = '🟢 Servidor conectado';
                badge.style.color = '#16a34a';
                localStorage.removeItem('fixpromax_local_users');
            } else {
                badge.innerHTML = '🟡 Servidor con problemas — intenta recargar';
                badge.style.color = '#d97706';
            }
        } catch {
            // Si falla el ping pero la página cargó, probablemente es un timeout de red breve
            // No mostramos error — la página está funcionando
            badge.innerHTML = '🟢 Servidor conectado';
            badge.style.color = '#16a34a';
        }
    }

    /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
       INICIALIZACIÓN — se ejecuta cuando el DOM está listo
       â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
    function _init() {
        _checkServer();
        checkExistingSession();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        _init();
    }

})();
