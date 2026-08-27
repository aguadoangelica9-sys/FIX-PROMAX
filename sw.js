/**
 * FIX PRO MAX — Service Worker v5
 * Estrategia: Network-ONLY para HTML principal (nunca cachear).
 *             Cache-first solo para assets estáticos (íconos, imágenes).
 */

const CACHE_NAME = 'fixpromax-v7-nocache-html';
const API_BASE   = '/api/';

// NO precachear el HTML — siempre va a la red para tener datos frescos
const PRECACHE_STATIC = [
    '/icons/icon-192.png',
    '/icons/icon-512.png',
];

// ── Instalación ──────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache =>
            Promise.allSettled(PRECACHE_STATIC.map(url => cache.add(url).catch(() => null)))
        ).then(() => self.skipWaiting())  // activar inmediatamente sin esperar
    );
});

// ── Activación: borrar TODOS los caches viejos ───────────────────────────────
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.map(k => caches.delete(k))))  // borrar TODO
            .then(() => caches.open(CACHE_NAME))  // crear caché nuevo y limpio
            .then(() => self.clients.claim())      // tomar control inmediato
    );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);

    if (request.method !== 'GET') return;
    if (url.protocol === 'chrome-extension:') return;

    // API → siempre red, sin caché
    if (url.pathname.startsWith(API_BASE)) return;

    // HTML principal y scripts críticos → siempre red, sin caché
    const noCacheUrls = ['/', '/index2.html', '/auth.js', '/subscription.js',
                         '/currency.js', '/sw.js', '/manifest.json', '/mobile.css'];
    if (noCacheUrls.includes(url.pathname)) {
        event.respondWith(
            fetch(request).catch(() => caches.match('/icons/icon-192.png'))
        );
        return;
    }

    // Íconos y assets estáticos → cache-first
    if (url.pathname.startsWith('/icons/') || url.pathname.match(/\.(png|jpg|jpeg|gif|webp|svg|woff2?)$/)) {
        event.respondWith(
            caches.match(request).then(cached => {
                if (cached) return cached;
                return fetch(request).then(resp => {
                    if (resp.ok) {
                        caches.open(CACHE_NAME).then(c => c.put(request, resp.clone()));
                    }
                    return resp;
                }).catch(() => new Response('', { status: 404 }));
            })
        );
        return;
    }

    // Todo lo demás → red directamente
    event.respondWith(fetch(request).catch(() => new Response('', { status: 503 })));
});

// ── Push notifications ────────────────────────────────────────────────────────
self.addEventListener('push', event => {
    const data = event.data?.json() || {};
    event.waitUntil(
        self.registration.showNotification(data.title || 'FIX PRO MAX', {
            body:  data.body || 'Tienes una nueva notificacion',
            icon:  '/icons/icon-192.png',
            badge: '/icons/icon-72.png',
        })
    );
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window' }).then(clients => {
            const existing = clients.find(c => c.focused);
            if (existing) return existing.focus();
            return self.clients.openWindow('/');
        })
    );
});
