// Madinah Guide Call Center — Service Worker v1
// Keeps the app alive in background so agents don't miss incoming calls

const CACHE = 'mg-callcenter-v1';
const STATIC = [
  './',
  'index.html',
  'agent-login.html',
  'agent.html',
  'manager.html',
  'visitor.html',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
];

// ── Install: cache static files ───────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(STATIC.filter(f => f !== 'visitor.html'))) // visitor.html optional
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()) // don't fail install if some files missing
  );
});

// ── Activate: clean old caches ────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: network first, cache fallback ──────────────────────────────────────
self.addEventListener('fetch', e => {
  // Always network-first for API calls and Daily.co
  if (
    e.request.url.includes('onrender.com') ||
    e.request.url.includes('daily.co') ||
    e.request.url.includes('googleapis') ||
    e.request.url.includes('anthropic')
  ) {
    return; // let browser handle API calls normally
  }

  e.respondWith(
    fetch(e.request)
      .then(response => {
        // cache a copy of successful responses
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});

// ── Background sync: keep periodic check alive ────────────────────────────────
// This sends a message to all open clients every 30s to trigger queue poll
// even when the browser tab is in background
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'KEEP_ALIVE') {
    // Broadcast to all clients so they know SW is alive
    self.clients.matchAll().then(clients => {
      clients.forEach(client => client.postMessage({ type: 'SW_ALIVE' }));
    });
  }
});

// ── Push notifications (future use) ──────────────────────────────────────────
self.addEventListener('push', e => {
  if (!e.data) return;
  const data = e.data.json();
  e.waitUntil(
    self.registration.showNotification(data.title || 'Madinah Guide', {
      body:  data.body  || 'New visitor in queue',
      icon:  'icon-192.png',
      badge: 'icon-192.png',
      tag:   'incoming-call',
      renotify: true,
      requireInteraction: true, // stays on screen until agent acts
      vibrate: [200, 100, 200],
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      if (clients.length) return clients[0].focus();
      return self.clients.openWindow('./agent.html');
    })
  );
});
