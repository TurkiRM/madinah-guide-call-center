// Madinah Guide Call Center — Service Worker v3
const CACHE   = 'mg-callcenter-v3';
const BACKEND = 'https://madinah-guide-backend-1.onrender.com';
const STATIC  = [
  './', 'index.html', 'agent-login.html', 'agent.html',
  'manager.html', 'manifest.json', 'icon-192.png', 'icon-512.png',
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

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  if (
    e.request.url.includes('onrender.com') ||
    e.request.url.includes('daily.co') ||
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

// ── Background queue polling ──────────────────────────────────────────────────
// This runs inside the SW — works even when app is minimized or screen is off
// The browser keeps SWs alive for network tasks even on background tabs

let agentId    = null;
let lastQLen   = 0;
let pollTimer  = null;

function startPolling(id) {
  agentId = id;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollQueue, 20000); // every 20s
  pollQueue(); // immediate first check
}

function stopPolling() {
  agentId = null;
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  lastQLen = 0;
}

async function pollQueue() {
  if (!agentId) return;
  try {
    const res  = await fetch(`${BACKEND}/agent/${agentId}/dashboard`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    const qLen = data.queue ? data.queue.length : 0;

    // Broadcast fresh data to all open agent pages
    self.clients.matchAll({ type: 'window' }).then(clients => {
      clients.forEach(c => {
        if (c.url.includes('agent.html')) {
          c.postMessage({ type: 'QUEUE_UPDATE', queue: data.queue || [], agents: data.allAgents || [] });
        }
      });
    });

    // New visitor in queue — show local notification if page not visible
    if (qLen > lastQLen) {
      const newCount = qLen - lastQLen;
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
        const agentPage = clients.find(c => c.url.includes('agent.html'));
        const isVisible = agentPage && (await agentPage.visibilityState !== 'hidden');

        // Always show notification — it will bring app to foreground
        await self.registration.showNotification('📞 New visitor in queue', {
          body:               `${qLen} visitor${qLen > 1 ? 's' : ''} waiting — tap to answer`,
          icon:               'icon-192.png',
          badge:              'icon-192.png',
          tag:                'incoming-call',
          renotify:           true,
          requireInteraction: true,
          vibrate:            [300, 100, 300, 100, 300],
          data:               { url: './agent.html' },
          actions: [
            { action: 'answer',  title: '📞 Answer now' },
            { action: 'dismiss', title: 'Dismiss' },
          ],
        });
      });
    }

    lastQLen = qLen;
  } catch(e) {
    // Silent fail in background — don't log errors when polling in background
  }
}

// ── Messages from agent page ──────────────────────────────────────────────────
self.addEventListener('message', e => {
  const { type, agentId: id } = e.data || {};

  if (type === 'START_POLLING' && id) {
    startPolling(id);
    e.source?.postMessage({ type: 'POLLING_STARTED' });
  }

  if (type === 'STOP_POLLING') {
    stopPolling();
  }

  if (type === 'KEEP_ALIVE') {
    // SW is alive — respond to keep connection active
    self.clients.matchAll().then(clients =>
      clients.forEach(c => c.postMessage({ type: 'SW_ALIVE' }))
    );
  }
});

// ── Push notification (from backend when visitor joins) ───────────────────────
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
      requireInteraction: true,
      vibrate:            [300, 100, 300, 100, 300],
      data:               { url: data.url },
      actions: [
        { action: 'answer',  title: '📞 Answer now' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    })
  );
});

// ── Notification click ────────────────────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'dismiss') return;

  const targetUrl = e.notification.data?.url || './agent.html';

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        const agentClient = clients.find(c => c.url.includes('agent.html'));
        if (agentClient) return agentClient.focus();
        return self.clients.openWindow(targetUrl);
      })
  );
});
