/**
 * FIX PRO MAX — Service Worker
 * Estrategia: Network-first para la app, Cache-first para assets estáticos.
 * Permite uso offline completo una vez cargado.
 */

const CACHE_NAME   = 'fixpromax-v4-utf8';
const API_BASE     = '/api/';

// Recursos que se cachean en la instalación
const PRECACHE = [
    '/',
    '/index2.html',
    '/manifest.json',
    '/currency.js',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    // Librerías externas (se cachean en runtime la primera vez)
];

// ── Instalación: pre-cachear la shell de la app ──────────────────────────────
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            // Cachear '/' y manifest; no fallar si faltan íconos
            return Promise.allSettled(
                PRECACHE.map(url => cache.add(url).catch(() => null))
            );
        }).then(() => self.skipWaiting())
    );
});

// ── Activación: limpiar caches viejos ────────────────────────────────────────
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

// ── Fetch: estrategia inteligente por tipo de recurso ────────────────────────
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);

    // Ignorar peticiones no-GET y extensiones de Chrome
    if (request.method !== 'GET') return;
    if (url.protocol === 'chrome-extension:') return;

    // API → Network-first, sin cache (datos siempre frescos)
    if (url.pathname.startsWith(API_BASE)) {
        event.respondWith(networkFirst(request, false));
        return;
    }

    // Ruta principal '/' → Network-first (siempre datos del servidor)
    if (url.pathname === '/' || url.pathname === '/index2.html') {
        event.respondWith(networkFirst(request, true));
        return;
    }

    // Scripts críticos de la app → Network-first (siempre versión fresca)
    if (url.pathname === '/auth.js' || url.pathname === '/subscription.js') {
        event.respondWith(networkFirst(request, false));
        return;
    }

    // Assets estáticos (íconos, manifest, librerías CDN) → Cache-first
    event.respondWith(cacheFirst(request));
});

// ── Estrategia Network-first ─────────────────────────────────────────────────
async function networkFirst(request, shouldCache) {
    try {
        const response = await fetch(request);
        if (shouldCache && response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        // Sin red → servir desde caché
        const cached = await caches.match(request);
        if (cached) return cached;
        // Fallback offline para la app principal
        if (request.destination === 'document') {
            const rootCached = await caches.match('/');
            if (rootCached) return rootCached;
        }
        return new Response('{"error":"Sin conexión"}', {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// ── Estrategia Cache-first ────────────────────────────────────────────────────
async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        return new Response('', { status: 404 });
    }
}

// ── Background Sync: guardar cambios offline y sincronizar al volver la red ──
self.addEventListener('sync', event => {
    if (event.tag === 'sync-data') {
        event.waitUntil(syncPendingData());
    }
});

async function syncPendingData() {
    // Notificar a los clientes que hay conexión de vuelta
    const clients = await self.clients.matchAll();
    clients.forEach(client => client.postMessage({ type: 'SYNC_ONLINE' }));
}

// ── Push notifications (preparado para futuro) ───────────────────────────────
self.addEventListener('push', event => {
    const data = event.data?.json() || {};
    event.waitUntil(
        self.registration.showNotification(data.title || 'FIX PRO MAX', {
            body:    data.body    || 'Tienes una nueva notificación',
            icon:    '/icons/icon-192.png',
            badge:   '/icons/icon-72.png',
            vibrate: [200, 100, 200],
            data:    data.url ? { url: data.url } : {},
            actions: [
                { action: 'open', title: 'Ver detalles' },
                { action: 'dismiss', title: 'Ignorar' }
            ]
        })
    );
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    if (event.action === 'open' || !event.action) {
        const url = event.notification.data?.url || '/';
        event.waitUntil(
            self.clients.matchAll({ type: 'window' }).then(clients => {
                const existing = clients.find(c => c.url === url);
                if (existing) return existing.focus();
                return self.clients.openWindow(url);
            })
        );
    }
});
