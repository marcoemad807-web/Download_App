// =====================================================
// push_sw.js — Service Worker لاستقبال Push Notifications
// شباب الأنبا صرابامون PWA
// =====================================================

const CACHE_NAME = 'church-pwa-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// استقبال Push Notification من السيرفر (Web Push Protocol)
self.addEventListener('push', (event) => {
  let title = 'إعلان جديد من الخدمة ⛪';
  let body = '';
  let icon = './icons/Icon-192.png';
  let badge = './icons/Icon-192.png';

  if (event.data) {
    try {
      const data = event.data.json();
      title = data.title || data.notification?.title || title;
      body = data.body || data.notification?.body || '';
      icon = data.icon || icon;
    } catch (e) {
      // لو مش JSON، اقرأه كـ text
      body = event.data.text() || body;
    }
  }

  const options = {
    body: body,
    icon: icon,
    badge: badge,
    dir: 'rtl',
    lang: 'ar',
    vibrate: [300, 200, 300],
    tag: 'church-announcement',
    renotify: true,
    requireInteraction: true,
    actions: [
      { action: 'open', title: 'فتح التطبيق' },
    ],
    data: { url: './' },
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// عند نقر المستخدم على الإشعار — افتح التطبيق
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const urlToOpen = event.notification.data?.url || './';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // لو التطبيق مفتوح بالفعل، أحضره للمقدمة
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // لو مش مفتوح، افتح تاب جديد
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

// استقبال رسالة من Flutter لإظهار إشعار (Polling fallback)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, icon } = event.data;
    const options = {
      body: body || '',
      icon: icon || './icons/Icon-192.png',
      badge: './icons/Icon-192.png',
      dir: 'rtl',
      lang: 'ar',
      vibrate: [300, 200, 300],
      tag: 'church-announcement-' + Date.now(),
      renotify: true,
      requireInteraction: false,
      data: { url: './' },
    };
    self.registration.showNotification(title || 'إعلان جديد ⛪', options);
  }
});

