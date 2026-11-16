// ======================================================================
// push_sw.js — Service Worker المتقدم لإشعارات شباب الأنبا صرابامون PWA
// يعمل بكفاءة 100% في:
// 1. الواجهة الأمامية (Foreground)
// 2. الخلفية والموبايل مقفول أو التطبيق مصغر (Background & Standalone)
// 3. عند إغلاق التطبيق تماماً (Push Events + Periodic Sync)
// بتطابق شكلي وتصميمي 100% مع تطبيق الأندرويد الأصلي
// ومخصص حصرياً لحسابات المخدومين (الشباب) فقط
// ======================================================================

const CACHE_NAME = 'church-pwa-v4';
const SYNC_CACHE_NAME = 'church-sync-store-v1';
const SYNC_KEY = '/church_user_sync_state.json';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// ======================================================================
// دالة استخراج وتنسيق بيانات الإشعار باحترافية وتطابق تام 100% مع الأندرويد:
// 1. اسم التطبيق (شباب الأنبا صرابامون) يظهر في رأس الإشعار بفونت رمادي صغير
// 2. العنوان الرئيسي العريض: اسم الخادم أو أمين الخدمة أو الأب الكاهن
// 3. المحتوى: نص الإعلان نظيف تماماً بدون أي وسوم برمجة (مثل ROLE) مع عنوان التنبيه
// ======================================================================
function parseChurchNotificationData(rawTitle, rawBody, rawSenderRole, rawSenderServantName, announcementId) {
  let title = (rawTitle || '').trim();
  let body = (rawBody || '').trim();
  let role = (rawSenderRole || '').trim();
  let senderName = (rawSenderServantName || '').trim();

  // 1. استخراج الدور من وسوم النص إذا لم يكن ممرراً
  const roleMatch = body.match(/<!--ROLE:(.*?)-->/);
  if (roleMatch && roleMatch[1]) {
    const extracted = roleMatch[1].trim();
    if (!role && extracted) {
      role = extracted;
    }
  }

  // 2. تنظيف نص الرسالة تماماً من جميع الوسوم والعلامات التقنية حتى لا تظهر للمستخدم
  let cleanBody = body
    .replace(/<!--ROLE:.*?-->/gs, '')
    .replace(/<!--ATTACHMENTS:.*?-->/gs, '')
    .replace(/<!--LEADER-->/gs, '')
    .replace(/\[LEADER_ANNOUNCEMENT\]/gs, '')
    .replace(/\[أمين الخدمة\]/gs, '')
    .replace(/\u200B\u200C\u200B/g, '')
    .replace(/\u200B/g, '')
    .replace(/<!--.*?-->/gs, '')
    .trim();

  // 3. فحص العنوان واستخراج اسم المرسل أو الدور إذا كان مدمجاً في العنوان (مثل: ⛪ ماريو بشرى (أمين الخدمة) • behdje)
  let cleanTitle = title;
  if (cleanTitle.startsWith('شباب الأنبا صرابامون •')) {
    cleanTitle = cleanTitle.replace(/^شباب الأنبا صرابامون •\s*/, '').trim();
  }

  if (cleanTitle.includes('•')) {
    const parts = cleanTitle.split('•').map(p => p.trim());
    const firstPart = parts[0].replace(/^[⛪📌\s]+/, '').trim();
    if (firstPart.includes('أمين الخدمة') ||
        firstPart.includes('امين الخدمة') ||
        firstPart.includes('أبونا') ||
        firstPart.includes('ابونا') ||
        firstPart.includes('خادم') ||
        !senderName) {
      if (!senderName &&
          !firstPart.includes('إعلان جديد') &&
          !firstPart.includes('تنبيه جديد')) {
        senderName = firstPart;
      }
      cleanTitle = parts.slice(1).join(' • ').trim();
    }
  }

  // إزالة أي أيقونات كنسية مسبقة من بداية العنوان
  cleanTitle = cleanTitle.replace(/^[⛪📌\s]+/, '').trim();

  // 4. استخراج الاسم والدور وتنسيقهما ليظهرا كعنوان رئيسي عريض
  // "وتحته اسم الخادم او امين الخدمه او الاب الكاهن الي باعت الرساله"
  let mainTitle = '';

  const isPriest = role.includes('أبونا') ||
      role.includes('ابونا') ||
      senderName.includes('أبونا') ||
      senderName.includes('ابونا') ||
      senderName.includes('القمص') ||
      senderName.includes('القس');

  const isLeader = role.includes('أمين الخدمة') ||
      role.includes('امين الخدمة') ||
      role.includes('أمين عام') ||
      senderName.includes('أمين الخدمة') ||
      senderName.includes('امين الخدمة');

  if (isPriest) {
    let priestName = senderName.replace(/^(قدس\s+)?(أبونا|ابونا)\s*/, '').trim();
    mainTitle = priestName.length > 0 ? ('قدس أبونا ' + priestName) : 'قدس أبونا راعي الاجتماع';
  } else if (isLeader) {
    let leaderName = senderName.replace(/\(أمين الخدمة\)|\(امين الخدمة\)|أمين الخدمة|امين الخدمة/g, '').trim();
    mainTitle = leaderName.length > 0 ? (leaderName + ' (أمين الخدمة)') : 'أمين الخدمة';
  } else if (senderName.length > 0) {
    if (role.length > 0 && !role.includes('خادم بالخدمة') && !senderName.includes(role)) {
      mainTitle = senderName + ' (' + role + ')';
    } else {
      mainTitle = senderName + (role.includes('خادم') ? ' (' + role + ')' : '');
    }
  } else if (role.length > 0) {
    mainTitle = role;
  } else {
    mainTitle = 'خادم بالخدمة';
  }

  // إزالة أي أقواس فارغة
  mainTitle = mainTitle.replace(/\(\s*\)/g, '').trim();

  // 5. تنسيق محتوى الرسالة تحت العنوان
  let bodyLines = [];
  if (cleanTitle.length > 0 &&
      cleanTitle !== 'إعلان جديد' &&
      cleanTitle !== 'تنبيه جديد' &&
      cleanTitle !== 'إعلان جديد من الخدمة' &&
      cleanTitle !== 'تنبيه جديد من الخدمة' &&
      !mainTitle.includes(cleanTitle)) {
    bodyLines.push('📌 ' + cleanTitle);
  }

  if (cleanBody.length > 0) {
    bodyLines.push(cleanBody);
  }

  let finalBody = bodyLines.join('\n') || cleanBody || cleanTitle || 'تنبيه جديد من كنيسة الأنبا صرابامون';

  return {
    mainTitle: mainTitle,
    finalBody: finalBody,
    id: announcementId || Date.now()
  };
}

// ======================================================================
// دالة إنشاء كائن الإشعار لـ Web Notification API
// ======================================================================
function formatChurchNotification(rawTitle, rawBody, senderRole, senderServantName, announcementId) {
  const parsed = parseChurchNotificationData(rawTitle, rawBody, senderRole, senderServantName, announcementId);

  // استخراج المسار المطلق لأيقونة الكنيسة الرسمية
  const baseUrl = (self.registration && self.registration.scope) ? self.registration.scope : self.location.origin;
  const iconUrl = new URL('icons/Icon-192.png', baseUrl).href;
  const badgeUrl = new URL('icons/Icon-192.png', baseUrl).href;

  return {
    title: parsed.mainTitle,
    options: {
      body: parsed.finalBody,
      icon: iconUrl,
      badge: badgeUrl,
      dir: 'rtl',
      lang: 'ar',
      tag: 'church-announcement-' + parsed.id,
      renotify: true,
      requireInteraction: true,
      // نمط اهتزاز منبثق مميز لأقصى لفت انتباه
      vibrate: [0, 400, 200, 400],
      silent: false,
      timestamp: Date.now(),
      actions: [
        { action: 'open', title: 'عرض التفاصيل ⛪' },
        { action: 'dismiss', title: 'إغلاق' }
      ],
      data: {
        url: './',
        announcementId: parsed.id
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
