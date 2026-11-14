// ======================================================================
// push_sw.js — Service Worker المتقدم لإشعارات شباب الأنبا صرابامون PWA
// يعمل بكفاءة 100% في:
// 1. الواجهة الأمامية (Foreground)
// 2. الخلفية والموبايل مقفول أو التطبيق مصغر (Background & Standalone)
// 3. عند إغلاق التطبيق تماماً (Push Events + Periodic Sync)
// بتطابق شكلي وتصميمي 100% مع تطبيق الأندرويد الأصلي
// ومخصص حصرياً لحسابات المخدومين (الشباب) فقط
// ======================================================================

const CACHE_NAME = 'church-pwa-v3';
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
// واستخدام المسارات المطلقة للأيقونة لمنع ظهور أيقونة المتصفح الافتراضية
// ======================================================================
function formatChurchNotification(rawTitle, rawBody, senderRole, senderServantName, announcementId) {
  let cleanTitle = (rawTitle || 'تنبيه جديد من الخدمة').trim();
  let role = (senderRole || '').trim();
  let servantName = (senderServantName || '').trim();

  // نفس منطق وأسلوب إشعار الأندرويد:
  // العنوان: شباب الأنبا صرابامون • [الدور]
  let displayTitle = '';
  if (role.length > 0) {
    displayTitle = 'شباب الأنبا صرابامون • ' + role;
  } else {
    displayTitle = 'شباب الأنبا صرابامون • ⛪ إعلان جديد';
  }

  // تنظيف وتنسيق نص الإعلان مع إضافة رأس العنوان واسم المرسل
  let cleanBody = (rawBody || '').replace(/\r?\n/g, ' ').trim();
  let bodyParts = [];
  if (cleanTitle && !cleanTitle.includes('تنبيه جديد') && !cleanTitle.includes('إعلان جديد')) {
    bodyParts.push('📌 ' + cleanTitle);
  }
  if (cleanBody) {
    bodyParts.push(cleanBody);
  }
  if (servantName && !cleanBody.includes(servantName)) {
    bodyParts.push('👤 من: ' + servantName);
  }
  let finalBody = bodyParts.join('\n') || cleanTitle || 'تنبيه جديد من كنيسة الأنبا صرابامون';

  // استخراج المسار المطلق للأيقونة لضمان ظهور أيقونة الكنيسة بدلاً من أيقونة كروم
  const baseUrl = (self.registration && self.registration.scope) ? self.registration.scope : self.location.origin;
  const iconUrl = new URL('icons/Icon-192.png', baseUrl).href;
  const badgeUrl = new URL('icons/Icon-192.png', baseUrl).href;

  const id = announcementId || Date.now();

  return {
    title: displayTitle,
    options: {
      body: finalBody,
      icon: iconUrl,
      badge: badgeUrl,
      dir: 'rtl',
      lang: 'ar',
      tag: 'church-announcement-' + id,
      renotify: true,
      requireInteraction: true,
      // نفس نمط اهتزاز أندرويد المعرف في التطبيق: [0, 300, 200, 300]
      vibrate: [0, 300, 200, 300],
      silent: false,
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

async function clearStoredSyncState() {
  try {
    const cache = await caches.open(SYNC_CACHE_NAME);
    await cache.delete(SYNC_KEY);
    // حفظ حالة تفيد بأن الحساب الحالي ليس مخدوماً (خادم أو أمين خدمة أو كاهن)
    await cache.put(SYNC_KEY, new Response(JSON.stringify({ userType: 'servant' }), {
      headers: { 'Content-Type': 'application/json' }
    }));
  } catch(e) {}
}

// ======================================================================
// دالة فحص الإعلانات السحابية من داخل Service Worker في الخلفية
// مخصصة حصرياً لحسابات المخدومين (الشباب) فقط
// ======================================================================
async function checkAnnouncementsFromSW() {
  try {
    const state = await getStoredSyncState();
    // إعلانات الخدمة تظهر حصرياً لحسابات المخدومين فقط لا غير
    if (!state || state.userType !== 'student' || !state.academicYear) {
      return;
    }

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
// مقتصر فقط على حسابات المخدومين
// ======================================================================
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    // التحقق من أن الحساب الحالي مخدوم
    const state = await getStoredSyncState();
    if (state && state.userType && state.userType !== 'student') {
      return; // خادم أو كاهن - لا تظهر أي إشعارات
    }

    let title = 'إعلان جديد من الخدمة ⛪';
    let body = '';
    let senderRole = '';
    let senderServantName = '';
    let announcementId = Date.now();

    if (event.data) {
      try {
        const data = event.data.json();
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
    await self.registration.showNotification(n.title, n.options);
  })());
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

  // أ) مسح مزامنة المستخدم تماماً (عند تسجيل خروج المخدوم أو تسجيل دخول خادم)
  if (event.data.type === 'CLEAR_USER_SYNC') {
    clearStoredSyncState();
    return;
  }

  // ب) مزامنة بيانات المخدوم والدفعة لبدء المراقبة في الخلفية
  if (event.data.type === 'SET_USER_SYNC') {
    const { academicYear, studentId, lastSeenId, userType } = event.data;
    if (userType && userType !== 'student') {
      clearStoredSyncState();
      return;
    }
    getStoredSyncState().then((existing) => {
      const state = existing || {};
      state.userType = 'student';
      state.academicYear = academicYear || state.academicYear || 1;
      state.studentId = studentId || state.studentId;
      if (lastSeenId && lastSeenId > 0) {
        state.lastSeenId = lastSeenId;
      }
      setStoredSyncState(state);
    });
    return;
  }

  // جـ) تحديث آخر معرف تمت قراءته
  if (event.data.type === 'UPDATE_LAST_SEEN') {
    const { lastSeenId } = event.data;
    if (lastSeenId && lastSeenId > 0) {
      getStoredSyncState().then((existing) => {
        const state = existing || {};
        if (state.userType === 'student') {
          state.lastSeenId = Math.max(state.lastSeenId || 0, lastSeenId);
          setStoredSyncState(state);
        }
      });
    }
    return;
  }

  // د) إظهار إشعار فوري من Flutter بالبيانات الكاملة وشكل مطابق للتطبيق (للمخدومين فقط)
  if (event.data.type === 'SHOW_CHURCH_ANNOUNCEMENT') {
    const { title, body, senderRole, senderServantName, id, userType } = event.data;
    if (userType && userType !== 'student') return;
    const n = formatChurchNotification(title, body, senderRole, senderServantName, id);
    self.registration.showNotification(n.title, n.options);
    return;
  }
});
