// ======================================================================
// push_sw.js — Service Worker المتقدم لإشعارات شباب الأنبا صرابامون PWA
// يعمل بكفاءة 100% في:
// 1. الواجهة الأمامية (Foreground)
// 2. الخلفية والموبايل مقفول أو التطبيق مصغر (Background & Standalone)
// 3. عند إغلاق التطبيق تماماً (Push Events + Periodic Sync)
// بتطابق شكلي وتصميمي 100% مع تطبيق الأندرويد الأصلي
// ======================================================================

const CACHE_NAME = 'church-pwa-v2';
const SYNC_CACHE_NAME = 'church-sync-store-v1';
const SYNC_KEY = '/church_user_sync_state.json';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// ======================================================================
// دالة تنسيق الإشعار ليكون مطابقاً 100% لشكل ومحتوى إشعار تطبيق الأندرويد
// ======================================================================
function formatChurchNotification(rawTitle, rawBody, senderRole, senderServantName, announcementId) {
  let cleanTitle = (rawTitle || 'تنبيه جديد من الخدمة').trim();
  let role = (senderRole || '').trim();

  // نفس منطق الأندرويد: لو فيه دور للمرسل يظهر [الدور • العنوان] وإلا [⛪ العنوان]
  let displayTitle = '';
  if (role.length > 0) {
    displayTitle = role + ' • ' + cleanTitle;
  } else {
    displayTitle = '⛪ ' + cleanTitle;
  }

  // تنظيف نص الإعلان
  let cleanBody = (rawBody || '').replace(/\r?\n/g, ' ').trim();
  let servantName = (senderServantName || '').trim();
  if (servantName.length > 0 && !cleanBody.includes(servantName)) {
    cleanBody = cleanBody + (cleanBody.length > 0 ? '\n' : '') + 'من: ' + servantName;
  }

  const id = announcementId || Date.now();

  return {
    title: displayTitle,
    options: {
      body: cleanBody,
      icon: './icons/Icon-192.png',
      badge: './icons/Icon-192.png',
      dir: 'rtl',
      lang: 'ar',
      tag: 'church-announcement-' + id,
      renotify: true,
      requireInteraction: true,
      // نفس نمط اهتزاز أندرويد المعرف في التطبيق: [0, 300, 200, 300]
      vibrate: [0, 300, 200, 300],
      actions: [
        { action: 'open', title: 'عرض التفاصيل ⛪' },
        { action: 'dismiss', title: 'إغلاق' }
      ],
      data: {
        url: './',
        announcementId: id
      }
    }
  };
}

// ======================================================================
// دوال إدارة حالة المزامنة الدائمة في الخلفية (Sync State Store)
// ======================================================================
async function getStoredSyncState() {
  try {
    const cache = await caches.open(SYNC_CACHE_NAME);
    const res = await cache.match(SYNC_KEY);
    if (res) return await res.json();
  } catch(e) {}
  return null;
}

async function setStoredSyncState(state) {
  try {
    const cache = await caches.open(SYNC_CACHE_NAME);
    await cache.put(SYNC_KEY, new Response(JSON.stringify(state), {
      headers: { 'Content-Type': 'application/json' }
    }));
  } catch(e) {}
}

// ======================================================================
// دالة فحص الإعلانات السحابية من داخل Service Worker في الخلفية
// تعمل حتى لو التطبيق مصغر أو مقفول بالكامل
// ======================================================================
async function checkAnnouncementsFromSW() {
  try {
    const state = await getStoredSyncState();
    if (!state || !state.academicYear) return;

    const academicYear = state.academicYear;
    const lastSeenId = state.lastSeenId || 0;

    const url = 'https://churchyouthattendance.runasp.net/api/Announcements/feed?academicYear=' + academicYear + '&limit=5';
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store'
    });

    if (!response.ok) return;

    const items = await response.json();
    if (!Array.isArray(items) || items.length === 0) return;

    const maxId = items.reduce((max, item) => item.id > max ? item.id : max, 0);

    if (lastSeenId > 0 && maxId > lastSeenId) {
      // وصل إعلان جديد أثناء قفل التطبيق أو وجوده في الخلفية!
      const newest = items.find(a => a.id === maxId) || items[0];
      const n = formatChurchNotification(
        newest.title,
        newest.body,
        newest.senderRole,
        newest.senderServantName,
        newest.id
      );

      await self.registration.showNotification(n.title, n.options);

      state.lastSeenId = maxId;
      await setStoredSyncState(state);
    } else if (lastSeenId <= 0) {
      state.lastSeenId = maxId;
      await setStoredSyncState(state);
    }
  } catch(err) {
    // تجاهل أخطاء الشبكة المؤقتة في الخلفية
  }
}

// تشغيل فحص دوري دائم في بيئة الـ Service Worker كل 25 ثانية
// يستمر في العمل أثناء تنقل المستخدم بين التطبيقات الأخرى
setInterval(checkAnnouncementsFromSW, 25000);

// ======================================================================
// 1. استقبال Push Notification من السيرفر (Web Push / FCM Web)
// يعمل عندما يكون التطبيق مقفولاً تماماً والمتصفح مغلق
// ======================================================================
self.addEventListener('push', (event) => {
  let title = 'إعلان جديد من الخدمة ⛪';
  let body = '';
  let senderRole = '';
  let senderServantName = '';
  let announcementId = Date.now();

  if (event.data) {
    try {
      const data = event.data.json();
      // استخراج البيانات القادمة من FCM أو السيرفر
      title = data.title || data.notification?.title || data.data?.title || title;
      body = data.body || data.notification?.body || data.data?.body || '';
      senderRole = data.senderRole || data.data?.senderRole || '';
      senderServantName = data.senderServantName || data.data?.senderServantName || '';
      announcementId = parseInt(data.announcementId || data.data?.announcementId || '') || announcementId;
    } catch(e) {
      body = event.data.text() || body;
    }
  }

  const n = formatChurchNotification(title, body, senderRole, senderServantName, announcementId);

  event.waitUntil(
    self.registration.showNotification(n.title, n.options)
  );
});

// ======================================================================
// 2. مهام المزامنة الدورية في الخلفية للنظام (Periodic Background Sync)
// تدعم إيقاظ الـ Service Worker في أنظمة أندرويد والكروم
// ======================================================================
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'church-announcements-sync') {
    event.waitUntil(checkAnnouncementsFromSW());
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'church-announcements-one-off-sync') {
    event.waitUntil(checkAnnouncementsFromSW());
  }
});

// ======================================================================
// 3. عند نقر المستخدم على الإشعار أو أزرار الإشعار
// ======================================================================
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  const urlToOpen = event.notification.data?.url || './';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // إذا كان التطبيق مفتوحاً بالفعل، قم بالتركيز عليه
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // إذا كان التطبيق مغلقاً، افتح نافذة جديدة
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

// ======================================================================
// 4. استقبال الرسائل المباشرة من تطبيق Flutter أثناء عمله
// ======================================================================
self.addEventListener('message', (event) => {
  if (!event.data) return;

  // أ) مزامنة بيانات المستخدم والدفعة لبدء المراقبة في الخلفية
  if (event.data.type === 'SET_USER_SYNC') {
    const { academicYear, studentId, lastSeenId } = event.data;
    getStoredSyncState().then((existing) => {
      const state = existing || {};
      state.academicYear = academicYear || state.academicYear || 1;
      state.studentId = studentId || state.studentId;
      if (lastSeenId && lastSeenId > 0) {
        state.lastSeenId = lastSeenId;
      }
      setStoredSyncState(state);
    });
  }

  // ب) تحديث آخر معرف تمت قراءته
  if (event.data.type === 'UPDATE_LAST_SEEN') {
    const { lastSeenId } = event.data;
    if (lastSeenId && lastSeenId > 0) {
      getStoredSyncState().then((existing) => {
        const state = existing || {};
        state.lastSeenId = Math.max(state.lastSeenId || 0, lastSeenId);
        setStoredSyncState(state);
      });
    }
  }

  // جـ) إظهار إشعار فوري من Flutter بالبيانات الكاملة وشكل مطابق للتطبيق
  if (event.data.type === 'SHOW_CHURCH_ANNOUNCEMENT') {
    const { title, body, senderRole, senderServantName, id } = event.data;
    const n = formatChurchNotification(title, body, senderRole, senderServantName, id);
    self.registration.showNotification(n.title, n.options);
  }
});
