/**
 * Service Worker MealsCards
 * -------------------------
 * Objectif : servir l'app de façon fiable hors ligne tout en garantissant que
 * l'utilisateur voit toujours la dernière version déployée sans devoir faire
 * plusieurs rechargements manuels.
 *
 * Stratégies utilisées :
 *  - Navigations HTML (document / `text/html`) : "network-first" avec fallback
 *    sur le cache si le réseau tombe. Cela permet de récupérer immédiatement le
 *    nouvel `index.html` après un déploiement GitHub/Vercel/Lovable, ce qui
 *    référence les nouveaux assets hashés.
 *  - Assets Vite avec hash (`/assets/xxx-[hash].js|.css|…`) : "cache-first".
 *    Ces fichiers sont immuables pour un hash donné, donc on peut les servir
 *    depuis le cache sans revalidation.
 *  - Autres GET (favicon, manifest, images…) : "stale-while-revalidate".
 *  - Requêtes Supabase et requêtes non-GET : passent directement au réseau.
 *
 * Incrémenter `CACHE_NAME` invalide automatiquement l'ancien cache chez les
 * utilisateurs existants (notamment ceux qui avaient le SW buggé précédent).
 */
const CACHE_NAME = 'mealscards-v3';

/** App shell mis en cache dès l'installation pour un fallback offline minimal. */
const OFFLINE_URLS = [
  '/',
  '/repas',
  '/aliments',
  '/planning',
  '/courses',
  '/manifest.json',
  '/favicon.ico',
];

// À l'installation, on pré-cache l'app shell et on active le nouveau SW sans attendre.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(OFFLINE_URLS)).catch(() => undefined)
  );
  self.skipWaiting();
});

// À l'activation, on supprime les anciens caches et on prend le contrôle de toutes les pages ouvertes.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Permet à la page de demander l'activation immédiate (bouton "nouvelle version").
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/** Indique si la requête pointe vers un asset hashé Vite (nom immuable). */
function isHashedAsset(url) {
  return url.pathname.startsWith('/assets/');
}

/** Indique si la requête est une navigation "vraie page HTML". */
function isHTMLNavigation(request, url) {
  if (request.mode === 'navigate') return true;
  const accept = request.headers.get('accept') || '';
  if (accept.includes('text/html')) return true;
  if (url.pathname === '/' || url.pathname === '/index.html') return true;
  return false;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorer les schémas non-HTTP (extensions Chrome, data:, etc.)
  if (!['http:', 'https:'].includes(url.protocol)) return;
  if (request.method !== 'GET') return;

  // En dev Vite on laisse passer les requêtes de modules (inutile de les cacher).
  const isViteDevRequest =
    url.pathname.startsWith('/@vite') ||
    url.pathname.startsWith('/@id/') ||
    url.pathname.startsWith('/node_modules/.vite/') ||
    url.pathname.startsWith('/src/') ||
    url.pathname.includes('hot-update');
  if (isViteDevRequest) return;

  // Appels backend Supabase : toujours réseau, jamais de cache.
  if (url.hostname.includes('supabase')) return;

  // 1) Navigations HTML : on essaie le réseau d'abord pour récupérer la dernière version.
  if (isHTMLNavigation(request, url)) {
    event.respondWith(networkFirstHTML(request));
    return;
  }

  // 2) Assets hashés Vite : cache-first, ils sont immuables.
  if (isHashedAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // 3) Fallback générique : stale-while-revalidate pour favicon / manifest / icônes.
  event.respondWith(staleWhileRevalidate(request));
});

/**
 * "network-first" pour le HTML : on tente le réseau (sans cache HTTP) et on
 * retombe sur le cache seulement si le réseau échoue (mode offline).
 */
async function networkFirstHTML(request) {
  try {
    const fresh = await fetch(request, { cache: 'no-store' });
    if (fresh && fresh.ok) {
      const clone = fresh.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => undefined);
    }
    return fresh;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    const shellFallback = await caches.match('/');
    return shellFallback || Response.error();
  }
}

/**
 * "cache-first" : on sert depuis le cache si dispo, sinon réseau et on met en cache.
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => undefined);
    }
    return response;
  } catch {
    return Response.error();
  }
}

/**
 * "stale-while-revalidate" : on sert immédiatement depuis le cache et on met à jour en arrière-plan.
 */
async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const networkFetch = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => undefined);
      }
      return response;
    })
    .catch(() => cached);
  return cached || networkFetch;
}
