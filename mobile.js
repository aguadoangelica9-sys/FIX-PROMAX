/**
 * FIX PRO MAX — mobile.js
 * Interfaz móvil profesional.
 * No modifica ninguna función existente del ERP.
 * Se inicializa DESPUÉS de que todos los scripts del ERP cargan.
 */
(function MobileUI() {
    'use strict';

    /* ══════════════════════════════════════════════════════════
       DETECCIÓN DE PLATAFORMA
       ══════════════════════════════════════════════════════════ */
    const isMobile = () => window.innerWidth <= 768;

    // Módulo activo en la navegación móvil
    let _currentMod = 'dashboard';

    // Módulo inicial según modo del usuario
    function _getHomeMod() {
        const user = window._currentUser;
        if (!user) return 'dashboard';
        return (user.mode === 'basic') ? 'basic-dashboard' : 'dashboard';
    }

    /* ══════════════════════════════════════════════════════════
       NAVEGACIÓN MÓVIL — delega en navigateTo() del ERP
       ══════════════════════════════════════════════════════════ */
    window.mobNavigate = function(mod) {
        if (typeof navigateTo === 'function') {
            navigateTo(mod);
        }
        _currentMod = mod;
        _updateBottomNav(mod);
        _updateMobHeader(mod);
    };

    // Mapeo módulo → ID del botón en el nav original del ERP (.mobile-bottom-nav)
    const _navMap = {
        'dashboard': 'mbn-dashboard', 'basic-dashboard': 'mbn-dashboard',
        'basic-reports': 'mbn-more',
        'pos': 'mbn-pos',
        'sales': 'mbn-more',
        'invoices': 'mbn-more',
        'inventory': 'mbn-inventory', 'products': 'mbn-inventory',
        'customers': 'mbn-customers',
        'suppliers': 'mbn-more',
        'expenses': 'mbn-more',
        'purchases': 'mbn-more',
        'returns': 'mbn-more',
        'reports': 'mbn-more', 'finance': 'mbn-more',
        'accounting': 'mbn-more', 'payables': 'mbn-more', 'receivables': 'mbn-more',
        'ai': 'mbn-more', 'alerts': 'mbn-more',
        'settings': 'mbn-more', 'plans': 'mbn-more',
        'team': 'mbn-more', 'support': 'mbn-more',
    };

    function _updateBottomNav(mod) {
        if (!isMobile()) return;
        // Actualizar el nav original del ERP
        document.querySelectorAll('.mobile-bottom-nav .nav-btn').forEach(el => el.classList.remove('active'));
        const targetId = _navMap[mod] || 'mbn-more';
        const btn = document.getElementById(targetId);
        if (btn) btn.classList.add('active');
    }

    // Títulos cortos para el header móvil
    const _titles = {
        'basic-dashboard': '🏠 Inicio',
        'basic-reports':   '📊 Ganancias',
        'dashboard':       '📊 Dashboard',
        'pos':             '🛒 POS — Vender',
        'sales':           '📋 Ventas',
        'invoices':        '🧾 Facturación',
        'products':        '📦 Productos',
        'customers':       '👤 Clientes',
        'suppliers':       '🏢 Proveedores',
        'inventory':       '📦 Inventario',
        'purchases':       '🛒 Compras',
        'expenses':        '💸 Gastos',
        'returns':         '↩️ Devoluciones',
        'accounting':      '📒 Contabilidad',
        'reports':         '📈 Reportes',
        'finance':         '💹 Finanzas P&L',
        'payables':        '💳 × Pagar',
        'receivables':     '💰 × Cobrar',
        'ai':              '🤖 AI Copilot',
        'alerts':          '🔔 Alertas',
        'settings':        '⚙️ Config.',
        'plans':           '💳 Suscripción',
        'team':            '👥 Equipo',
        'support':         '🆘 Soporte',
    };

    function _updateMobHeader(mod) {
        const el = document.getElementById('mobileHeaderTitle');
        if (el) el.textContent = _titles[mod] || 'FIX PRO MAX';
    }

    /* ══════════════════════════════════════════════════════════
       DRAWER MENÚ
       ══════════════════════════════════════════════════════════ */
    window.openMobileDrawer = function() {
        const overlay = document.getElementById('mobileDrawerOverlay');
        const drawer  = document.getElementById('mobileDrawer');
        if (!overlay || !drawer) return;
        overlay.classList.add('open');
        drawer.classList.add('open');
        document.body.style.overflow = 'hidden';
        _updateDrawerUser();
        // Marcar ítem activo en el drawer
        document.querySelectorAll('.mob-drawer-item').forEach(el => el.classList.remove('active'));
    };

    window.closeMobileDrawer = function() {
        const overlay = document.getElementById('mobileDrawerOverlay');
        const drawer  = document.getElementById('mobileDrawer');
        if (!overlay || !drawer) return;
        overlay.classList.remove('open');
        drawer.classList.remove('open');
        document.body.style.overflow = '';
    };

    function _updateDrawerUser() {
        const u = window._currentUser;
        if (!u) return;
        const nameEl   = document.getElementById('mobileDrawerUserName');
        const roleEl   = document.getElementById('mobileDrawerUserRole');
        const avatarEl = document.getElementById('mobDrawerAvatar');

        if (nameEl) nameEl.textContent = u.name || 'Usuario';
        if (roleEl) roleEl.textContent = (u.role === 'admin' ? '👑 Admin' : '👤 Usuario') +
                                         (u.company ? ' · ' + u.company : '');
        if (avatarEl) {
            if (u.photoUrl) {
                avatarEl.innerHTML = `<img src="${u.photoUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="">`;
            } else {
                avatarEl.textContent = (u.avatar || (u.name || 'U').slice(0, 2).toUpperCase());
            }
        }

        // Mostrar botón de Equipo si es admin
        const teamBtn = document.getElementById('mobDrawerTeamBtn');
        if (teamBtn) teamBtn.style.display = (u.role === 'admin') ? 'flex' : 'none';
    }

    /* ══════════════════════════════════════════════════════════
       BOTTOM SHEET — acciones contextuales
       ══════════════════════════════════════════════════════════ */
    window.openMobSheet = function(title, items) {
        const overlay = document.getElementById('mobSheetOverlay');
        const sheet   = document.getElementById('mobSheet');
        const titleEl = document.getElementById('mobSheetTitle');
        const body    = document.getElementById('mobSheetBody');
        if (!overlay || !sheet) return;

        if (titleEl) titleEl.textContent = title || 'Acciones';
        if (body) {
            body.innerHTML = items.map(item => `
                <button class="mob-sheet-item ${item.danger ? 'danger' : ''}"
                    onclick="closeMobSheet();(${item.action})()"
                    ${item.disabled ? 'disabled' : ''}>
                    <span style="font-size:20px;">${item.icon || ''}</span>
                    <span>${item.label}</span>
                </button>
            `).join('');
        }

        overlay.classList.add('open');
        sheet.classList.add('open');
        document.body.style.overflow = 'hidden';
    };

    window.closeMobSheet = function() {
        const overlay = document.getElementById('mobSheetOverlay');
        const sheet   = document.getElementById('mobSheet');
        if (overlay) overlay.classList.remove('open');
        if (sheet)   sheet.classList.remove('open');
        document.body.style.overflow = '';
    };

    /* ══════════════════════════════════════════════════════════
       TEMA — sincronizar botón del header móvil
       ══════════════════════════════════════════════════════════ */
    function _syncMobThemeBtn() {
        const btn = document.getElementById('mobThemeBtn');
        if (!btn) return;
        btn.textContent = document.body.classList.contains('dark') ? '☀️' : '🌙';
        btn.setAttribute('aria-label', document.body.classList.contains('dark') ? 'Activar modo claro' : 'Activar modo oscuro');
    }

    // Observar cambios de clase en body para sincronizar el botón
    const _themeObserver = new MutationObserver(() => _syncMobThemeBtn());
    _themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    /* ══════════════════════════════════════════════════════════
       MONEDA — sincronizar selector del header móvil
       ══════════════════════════════════════════════════════════ */
    function _syncMobCurrency() {
        const sel = document.getElementById('mobCurrencySelect');
        if (!sel) return;
        const cur = window._displayCurrency || 'USD';
        if (sel.value !== cur) sel.value = cur;
    }

    /* ══════════════════════════════════════════════════════════
       CONEXIÓN — banner offline
       ══════════════════════════════════════════════════════════ */
    function _updateOfflineBanner() {
        const mob = document.getElementById('mobileOfflineBanner');
        const pc  = document.getElementById('offlineBanner');
        const offline = !navigator.onLine;
        if (mob) mob.classList.toggle('visible', offline);
        // Mantener el existente también
        if (pc) pc.style.display = offline ? 'block' : 'none';
    }

    window.addEventListener('online',  _updateOfflineBanner);
    window.addEventListener('offline', _updateOfflineBanner);

    /* ══════════════════════════════════════════════════════════
       POS MÓVIL v2 — tabs + FAB carrito
       ══════════════════════════════════════════════════════════ */
    function _initPOSTabs() {
        const posModule = document.getElementById('module-pos');
        if (!posModule) return;

        // Crear barra de tabs si no existe
        let tabBar = document.getElementById('posMobileTabs');
        if (!tabBar) {
            tabBar = document.createElement('div');
            tabBar.id = 'posMobileTabs';
            tabBar.innerHTML = `
                <button class="pos-mobile-tab active" id="posTabProducts"
                    onclick="showPOSPanel('products')">
                    📦 Productos
                </button>
                <button class="pos-mobile-tab" id="posTabCart"
                    onclick="showPOSPanel('cart')">
                    🛒 Carrito
                    <span id="posTabCartCount"
                        style="background:var(--primary);color:#fff;border-radius:10px;
                               padding:1px 7px;font-size:11px;margin-left:4px;display:none;"></span>
                </button>
            `;
            posModule.prepend(tabBar);
        }

        showPOSPanel('products');

        // Observar cambios en #cartCount para actualizar el FAB y el badge
        const cartCountEl = document.getElementById('cartCount');
        if (cartCountEl && !cartCountEl._mobObserved) {
            cartCountEl._mobObserved = true;
            const obs = new MutationObserver(() => _updateCartFab());
            obs.observe(cartCountEl, { childList: true, subtree: true, characterData: true });
        }

        // También observar el total
        const cartTotalEl = document.getElementById('cartTotal');
        if (cartTotalEl && !cartTotalEl._mobObserved) {
            cartTotalEl._mobObserved = true;
            const obs = new MutationObserver(() => _updateCartFab());
            obs.observe(cartTotalEl, { childList: true, subtree: true, characterData: true });
        }
    }

    window.showPOSPanel = function(panel) {
        if (!isMobile()) return;
        const posGrid = document.querySelector('#module-pos .pos-grid');
        if (!posGrid) return;

        const productsPanel = posGrid.querySelector('div:first-child');
        const cartPanel     = posGrid.querySelector('.pos-cart');
        const tabProducts   = document.getElementById('posTabProducts');
        const tabCart       = document.getElementById('posTabCart');
        const fab           = document.getElementById('mobCartFab');

        if (panel === 'products') {
            if (productsPanel) productsPanel.style.display = 'block';
            if (cartPanel)     cartPanel.style.display     = 'none';
            if (tabProducts)   tabProducts.classList.add('active');
            if (tabCart)       tabCart.classList.remove('active');
            // Mostrar FAB si hay items
            _updateCartFab();
        } else {
            if (productsPanel) productsPanel.style.display = 'none';
            if (cartPanel)     cartPanel.style.display     = 'flex';
            if (tabProducts)   tabProducts.classList.remove('active');
            if (tabCart)       tabCart.classList.add('active');
            // Ocultar FAB cuando estamos viendo el carrito
            if (fab) fab.classList.remove('visible');
        }
    };

    /* Actualiza el FAB flotante del carrito */
    function _updateCartFab() {
        if (!isMobile()) return;

        const fab       = document.getElementById('mobCartFab');
        const countEl   = document.getElementById('cartCount');
        const totalEl   = document.getElementById('cartTotal');
        const fabCount  = document.getElementById('mobCartFabCount');
        const fabTotal  = document.getElementById('mobCartFabTotal');
        const tabCount  = document.getElementById('posTabCartCount');
        if (!fab) return;

        const rawCount  = countEl ? countEl.textContent.trim() : '0';
        const n         = parseInt(rawCount) || 0;
        const total     = totalEl ? totalEl.textContent.trim() : '$0.00';

        // Actualizar texto del FAB
        if (fabCount) fabCount.textContent = n + (n === 1 ? ' item' : ' items');
        if (fabTotal) fabTotal.textContent  = total;

        // Actualizar badge en el tab
        if (tabCount) {
            tabCount.textContent     = n > 0 ? n : '';
            tabCount.style.display   = n > 0 ? 'inline' : 'none';
        }

        // Mostrar FAB solo en panel de productos y si hay items
        const cartPanel   = document.querySelector('#module-pos .pos-cart');
        const cartVisible = cartPanel && cartPanel.style.display !== 'none';
        if (n > 0 && !cartVisible) {
            fab.classList.add('visible');
        } else {
            fab.classList.remove('visible');
        }
    }
    window._updateCartFab = _updateCartFab;

    /* ══════════════════════════════════════════════════════════
       INVENTARIO / PRODUCTOS MÓVIL — render de cards
       ══════════════════════════════════════════════════════════ */
    function _renderMobileInventory() {
        if (!isMobile()) return;
        const mod = document.getElementById('module-inventory');
        if (!mod || !mod.classList.contains('active')) return;

        // Agregar FAB si no existe
        if (!document.getElementById('mobInvFab')) {
            const fab = document.createElement('button');
            fab.id = 'mobInvFab';
            fab.className = 'mob-fab mob-only';
            fab.innerHTML = '＋';
            fab.setAttribute('aria-label', 'Agregar producto');
            fab.onclick = () => openModal('product');
            document.body.appendChild(fab);
        }
    }

    function _renderMobileProducts() {
        if (!isMobile()) return;
        const mod = document.getElementById('module-products');
        if (!mod || !mod.classList.contains('active')) return;

        if (!document.getElementById('mobProdFab')) {
            const fab = document.createElement('button');
            fab.id = 'mobProdFab';
            fab.className = 'mob-fab mob-only';
            fab.innerHTML = '＋';
            fab.setAttribute('aria-label', 'Nuevo producto');
            fab.onclick = () => openNewProductModal ? openNewProductModal() : openModal('product');
            document.body.appendChild(fab);
        }
    }

    // Mostrar/ocultar FAB según módulo activo
    function _manageFABs(mod) {
        const invFab  = document.getElementById('mobInvFab');
        const prodFab = document.getElementById('mobProdFab');
        if (invFab)  invFab.style.display  = (mod === 'inventory') ? 'flex' : 'none';
        if (prodFab) prodFab.style.display  = (mod === 'products')  ? 'flex' : 'none';
    }

    /* ══════════════════════════════════════════════════════════
       ALERTAS — sincronizar badge en bottom nav
       ══════════════════════════════════════════════════════════ */
    function _syncAlertBadge() {
        const pcBadge  = document.getElementById('alertBadge');
        // mobAlertBadge está dentro del botón #mbn-more del nav del ERP
        const mobBadge = document.getElementById('mobAlertBadge');
        const drawerBadge = document.getElementById('mobDrawerAlertBadge');
        if (!pcBadge) return;
        const n = parseInt(pcBadge.textContent) || 0;
        if (mobBadge) {
            mobBadge.textContent = n;
            mobBadge.style.display = n > 0 ? 'flex' : 'none';
        }
        if (drawerBadge) {
            drawerBadge.textContent = n;
            drawerBadge.style.display = n > 0 ? 'flex' : 'none';
        }
    }

    /* ══════════════════════════════════════════════════════════
       BARRA DE SYNC MÓVIL — refleja el indicador del ERP
       ══════════════════════════════════════════════════════════ */
    function _watchSyncIndicator() {
        const pcIndicator = document.getElementById('syncIndicator');
        const mobBar      = document.getElementById('mobSyncBar');
        if (!pcIndicator || !mobBar) return;

        const obs = new MutationObserver(() => {
            const txt = pcIndicator.textContent || '';
            if (txt.includes('Guardando')) {
                mobBar.classList.add('saving');
            } else {
                mobBar.classList.remove('saving');
            }
        });
        obs.observe(pcIndicator, { childList: true, subtree: true });
    }

    /* ══════════════════════════════════════════════════════════
       TECLADO — evitar que tape el botón de acción principal
       ══════════════════════════════════════════════════════════ */
    function _handleKeyboard() {
        if (!isMobile()) return;
        if (typeof window.visualViewport === 'undefined') return;

        window.visualViewport.addEventListener('resize', () => {
            const nav = document.getElementById('mobileBottomNav');
            if (!nav) return;
            const keyboardOpen = window.visualViewport.height < window.screen.height * 0.75;
            // Ocultar bottom nav cuando el teclado está abierto
            nav.style.transform = keyboardOpen ? 'translateY(100%)' : '';
            nav.style.transition = 'transform 0.2s ease';
        });
    }

    /* ══════════════════════════════════════════════════════════
       GESTOS — cerrar drawer con swipe derecha
       ══════════════════════════════════════════════════════════ */
    function _initSwipeGestures() {
        const drawer = document.getElementById('mobileDrawer');
        if (!drawer) return;

        let startX = 0;
        let startY = 0;

        drawer.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        }, { passive: true });

        drawer.addEventListener('touchend', (e) => {
            const dx = e.changedTouches[0].clientX - startX;
            const dy = Math.abs(e.changedTouches[0].clientY - startY);
            // Swipe derecha > 60px y poco movimiento vertical → cerrar
            if (dx > 60 && dy < 50) {
                closeMobileDrawer();
            }
        }, { passive: true });
    }

    /* ══════════════════════════════════════════════════════════
       ORIENTACIÓN — ajustes al rotar
       ══════════════════════════════════════════════════════════ */
    function _handleOrientation() {
        const landscape = window.innerWidth > window.innerHeight;
        // En landscape y POS activo: mostrar ambos paneles
        if (landscape && _currentMod === 'pos') {
            const posGrid = document.querySelector('#module-pos .pos-grid');
            const productsPanel = posGrid?.querySelector('div:first-child');
            const cartPanel     = posGrid?.querySelector('.pos-cart');
            if (productsPanel) productsPanel.style.display = '';
            if (cartPanel)     cartPanel.style.display = '';
        }
    }

    window.addEventListener('resize', _handleOrientation);
    screen.orientation?.addEventListener('change', _handleOrientation);

    /* ══════════════════════════════════════════════════════════
       HOOK EN navigateTo() — interceptar sin romper el original
       ══════════════════════════════════════════════════════════ */
    function _hookNavigateTo() {
        const _orig = window.navigateTo;
        if (!_orig || window._mobNavHooked) return;
        window._mobNavHooked = true;

        window.navigateTo = function(mod) {
            _orig(mod);
            _currentMod = mod;
            if (isMobile()) {
                _updateBottomNav(mod);
                _updateMobHeader(mod);
                _manageFABs(mod);
                _renderMobileInventory();
                _renderMobileProducts();
                // POS: inicializar tabs si se navega al POS
                if (mod === 'pos') {
                    setTimeout(_initPOSTabs, 50);
                }
                // Actualizar badge de alertas
                _syncAlertBadge();
            }
        };
    }

    /* ══════════════════════════════════════════════════════════
       HOOK EN persist() — mostrar barra de sync móvil
       ══════════════════════════════════════════════════════════ */
    function _hookPersist() {
        const _orig = window.persist;
        // persist está definida en el scope del ERP, no en window.
        // Usamos MutationObserver en su lugar (ya implementado arriba en _watchSyncIndicator)
        // Este hook es un backup si persist se expone en window
        if (!_orig || window._mobPersistHooked) return;
        window._mobPersistHooked = true;
        window.persist = async function() {
            const bar = document.getElementById('mobSyncBar');
            if (bar && isMobile()) bar.classList.add('saving');
            const result = await _orig();
            if (bar && isMobile()) bar.classList.remove('saving');
            return result;
        };
    }

    /* ══════════════════════════════════════════════════════════
       HOOK EN toggleDark() — sincronizar botón móvil
       ══════════════════════════════════════════════════════════ */
    function _hookToggleDark() {
        const _orig = window.toggleDark;
        if (!_orig || window._mobDarkHooked) return;
        window._mobDarkHooked = true;
        window.toggleDark = function() {
            _orig();
            _syncMobThemeBtn();
        };
    }

    /* ══════════════════════════════════════════════════════════
       HOOK EN setDisplayCurrency() — sincronizar selector móvil
       ══════════════════════════════════════════════════════════ */
    function _hookSetDisplayCurrency() {
        const _orig = window.setDisplayCurrency;
        if (!_orig || window._mobCurrHooked) return;
        window._mobCurrHooked = true;
        window.setDisplayCurrency = function(code) {
            _orig(code);
            _syncMobCurrency();
        };
    }

    /* ══════════════════════════════════════════════════════════
       HOOK EN _enterApp() — actualizar UI cuando el usuario hace login
       ══════════════════════════════════════════════════════════ */
    function _hookEnterApp() {
        // _enterApp está dentro del IIFE de auth.js, no accesible directamente.
        // _showAppAfterAuth sí se expone en window — lo usamos como trigger.
        const _origShow = window._showAppAfterAuth;
        if (!_origShow || window._mobAppHooked) return;
        window._mobAppHooked = true;
        window._showAppAfterAuth = function(subStatus) {
            _origShow(subStatus);
            // Dar tiempo al ERP para renderizar
            setTimeout(() => {
                if (isMobile()) {
                    _onUserLogin();
                }
            }, 300);
        };
    }

    function _onUserLogin() {
        const u = window._currentUser;
        if (!u) return;
        // Navegar al módulo home correcto
        const homeMod = _getHomeMod();
        mobNavigate(homeMod);
        _syncMobThemeBtn();
        _syncMobCurrency();
        _syncAlertBadge();
        // Mostrar drawer team si es admin
        const teamBtn = document.getElementById('mobDrawerTeamBtn');
        if (teamBtn) teamBtn.style.display = (u.role === 'admin') ? 'flex' : 'none';
    }

    /* ══════════════════════════════════════════════════════════
       MEJORAS DE ACCESIBILIDAD TÁCTIL
       ══════════════════════════════════════════════════════════ */
    function _enhanceTouchTargets() {
        if (!isMobile()) return;
        // Asegurar que los botones de cantidad del carrito sean mínimo 44px
        document.querySelectorAll('.pos-cart .cart-item .qty button').forEach(btn => {
            btn.style.minWidth  = '44px';
            btn.style.minHeight = '44px';
        });
    }

    /* ══════════════════════════════════════════════════════════
       FORMATEAR TABLAS PARA MÓVIL — agregar data-label a celdas
       Permite mostrar etiquetas antes de cada celda en diseño de card
       ══════════════════════════════════════════════════════════ */
    function _enhanceTables() {
        if (!isMobile()) return;
        // Hacer que las tablas de ventas/facturas sean scrollables sin overflow oculto
        document.querySelectorAll('.table-wrap').forEach(wrap => {
            wrap.style.overflowX = 'auto';
            wrap.style.webkitOverflowScrolling = 'touch';
        });
    }

    /* ══════════════════════════════════════════════════════════
       PULL-TO-REFRESH — (simple, sin lib externa)
       ══════════════════════════════════════════════════════════ */
    function _initPullToRefresh() {
        if (!isMobile()) return;
        const main = document.getElementById('mainContent');
        if (!main) return;

        let startY = 0;
        let pulling = false;
        let indicator = null;

        main.addEventListener('touchstart', (e) => {
            if (main.scrollTop === 0) {
                startY = e.touches[0].clientY;
                pulling = true;
            }
        }, { passive: true });

        main.addEventListener('touchmove', (e) => {
            if (!pulling) return;
            const dy = e.touches[0].clientY - startY;
            if (dy > 40 && dy < 120) {
                if (!indicator) {
                    indicator = document.createElement('div');
                    indicator.style.cssText = [
                        'position:absolute;top:calc(var(--mob-header-h) + 8px);',
                        'left:50%;transform:translateX(-50%);',
                        'background:var(--surface);border:1px solid var(--border);',
                        'border-radius:20px;padding:6px 16px;',
                        'font-size:12px;color:var(--text-2);',
                        'z-index:400;box-shadow:var(--shadow-md);',
                        'font-family:inherit;font-weight:600;',
                    ].join('');
                    indicator.textContent = '↓ Soltar para actualizar';
                    document.body.appendChild(indicator);
                }
            }
        }, { passive: true });

        main.addEventListener('touchend', () => {
            if (!pulling) return;
            pulling = false;
            if (indicator) {
                indicator.textContent = '🔄 Actualizando...';
                setTimeout(() => {
                    // Disparar sincronización
                    const token = localStorage.getItem('fixpromax_token');
                    if (token && typeof renderAll === 'function') {
                        renderAll();
                        if (typeof showToast === 'function') showToast('🔄', 'Datos actualizados');
                    }
                    indicator.remove();
                    indicator = null;
                }, 600);
            }
        }, { passive: true });
    }

    /* ══════════════════════════════════════════════════════════
       BUSCAR RÁPIDO EN MÓVIL — input sticky en módulos
       ══════════════════════════════════════════════════════════ */
    function _makeSearchSticky() {
        if (!isMobile()) return;
        // Añadir clase sticky a los inputs de búsqueda de cada módulo
        const searches = [
            '#productsSearch', '#customerSearch', '#inventorySearch',
            '#salesSearch', '#invoiceSearch', '#quoteSearch',
        ];
        searches.forEach(sel => {
            const el = document.querySelector(sel);
            if (!el) return;
            const parent = el.closest('div');
            if (parent && !parent.classList.contains('mob-search-sticky')) {
                parent.classList.add('mob-search-sticky');
            }
        });
    }

    /* ══════════════════════════════════════════════════════════
       INICIALIZACIÓN — se ejecuta cuando el DOM está listo
       ══════════════════════════════════════════════════════════ */
    function _init() {
        if (!isMobile()) {
            window.addEventListener('resize', _onResize);
            return;
        }

        _syncMobThemeBtn();
        _syncMobCurrency();
        _updateOfflineBanner();
        _initSwipeGestures();
        _handleKeyboard();
        _watchSyncIndicator();
        _enhanceTables();
        _makeSearchSticky();

        // Hooks sobre las funciones del ERP
        _tryHooks();

        // Pull-to-refresh
        setTimeout(_initPullToRefresh, 500);

        // Si el usuario YA está logueado cuando mobile.js carga
        // (recarga de página con sesión activa), activar UI móvil
        _watchAppVisible();
    }

    /* Vigila cuando #appMain se vuelve visible (clase 'visible')
       para activar la UI móvil aunque el login haya ocurrido antes de que
       mobile.js cargara */
    function _watchAppVisible() {
        const appEl = document.getElementById('appMain');
        if (!appEl) return;

        // Ya visible — activar inmediatamente
        if (appEl.classList.contains('visible')) {
            _onAppShown();
            return;
        }

        // Observar cuando se añade la clase 'visible'
        const obs = new MutationObserver((mutations) => {
            for (const m of mutations) {
                if (m.type === 'attributes' && m.attributeName === 'class') {
                    if (appEl.classList.contains('visible')) {
                        obs.disconnect();
                        _onAppShown();
                        break;
                    }
                }
            }
        });
        obs.observe(appEl, { attributes: true });
    }

    /* Se ejecuta cuando la app se vuelve visible (usuario logueado) */
    function _onAppShown() {
        if (!isMobile()) return;

        // Actualizar info del usuario en el drawer
        setTimeout(_updateDrawerUser, 100);

        // Navegar al módulo correcto según modo del usuario
        const homeMod = _getHomeMod();
        _currentMod = homeMod;
        _updateBottomNav(homeMod);
        _updateMobHeader(homeMod);

        // Sincronizar estado de UI
        _syncMobThemeBtn();
        _syncMobCurrency();
        _syncAlertBadge();
    }

    function _tryHooks(attempt) {
        attempt = attempt || 0;
        if (attempt > 30) return;

        const ready = typeof navigateTo !== 'undefined'
                   && typeof toggleDark !== 'undefined'
                   && typeof setDisplayCurrency !== 'undefined';

        if (ready) {
            _hookNavigateTo();
            _hookToggleDark();
            _hookSetDisplayCurrency();
            _hookPersist();
            setTimeout(_hookEnterApp, 300);
            _syncAlertBadge();
        } else {
            setTimeout(() => _tryHooks(attempt + 1), 100);
        }
    }

    function _onResize() {
        if (isMobile()) {
            _init();
            window.removeEventListener('resize', _onResize);
        }
    }

    // Arrancar
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        setTimeout(_init, 0);
    }

    /* ══════════════════════════════════════════════════════════
       API PÚBLICA
       ══════════════════════════════════════════════════════════ */
    window.showPOSPanel      = window.showPOSPanel;
    window.openMobSheet      = window.openMobSheet;
    window.closeMobSheet     = window.closeMobSheet;
    window.openMobileDrawer  = window.openMobileDrawer;
    window.closeMobileDrawer = window.closeMobileDrawer;
    window.mobNavigate       = window.mobNavigate;

    window.updateMobileBottomNav = function(mod) {
        _updateBottomNav(mod);
        _updateMobHeader(mod);
        _manageFABs(mod);
        _syncAlertBadge();
    };

})(); // fin MobileUI