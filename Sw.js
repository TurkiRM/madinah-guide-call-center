// Madinah Guide Call Center — Service Worker v2
const CACHE = 'mg-callcenter-v2';
const STATIC = [
  './',
  'index.html',
  'agent-login.html',
  'agent.html',
  'manager.html',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
];

// ── Install ───────────────────────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(STATIC))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

// ── Activate ──────────────────────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: network first, cache fallback ──────────────────────────────────────
self.addEventListener('fetch', e => {
  if (
    e.request.url.includes('onrender.com') ||
    e.request.url.includes('daily.co') ||
    e.request.url.includes('googleapis') ||
    e.request.url.includes('unpkg.com')
  ) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// ── Keep-alive ping ───────────────────────────────────────────────────────────
self.addEventListener('message', e => {
  if (e.data?.type === 'KEEP_ALIVE') {
    self.clients.matchAll().then(clients =>
      clients.forEach(c => c.postMessage({ type: 'SW_ALIVE' }))
    );
  }
});

// ── Push notification — fires even when app is closed ─────────────────────────
self.addEventListener('push', e => {
  let data = {
    title: '📞 New visitor in queue',
    body:  'A visitor is waiting — tap to answer',
    tag:   'incoming-call',
    url:   './agent.html',
  };
  try { if (e.data) data = { ...data, ...e.data.json() }; } catch(_) {}

  e.waitUntil(
    self.registration.showNotification(data.title, {
      body:               data.body,
      icon:               'icon-192.png',
      badge:              'icon-192.png',
      tag:                data.tag,
      renotify:           true,
      requireInteraction: true,          // stays on screen until agent acts
      vibrate:            [300,100,300,100,300,100,300],
      data:               { url: data.url },
      actions: [
        { action: 'answer',  title: '📞 Answer now' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    })
  );
});

// ── Notification click — open/focus agent.html ────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();

  if (e.action === 'dismiss') return;

  // Open agent.html or focus it if already open
  const targetUrl = e.notification.data?.url || './agent.html';

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        // Check if agent.html is already open
        const agentClient = clients.find(c => c.url.includes('agent.html'));
        if (agentClient) {
          return agentClient.focus();
        }
        // Otherwise open a new window
        return self.clients.openWindow(targetUrl);
      })
  );
});
