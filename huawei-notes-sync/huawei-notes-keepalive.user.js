// ==UserScript==
// @name         华为云备忘录 保活 (Huawei Cloud Notes Keep-Alive)
// @namespace    ubuntu24tweak
// @version      1.0.0
// @description  让固定在 Chrome 里的 cloud.huawei.com 备忘录网页版不再因空闲超时掉登录：在空闲超时到来前自动悄悄重载页面续命，绝不打断正在编辑的操作；真掉线时弹桌面通知。不存任何密码。
// @author       ubuntu24tweak
// @match        https://cloud.huawei.com/*
// @match        https://*.cloud.huawei.com/*
// @match        https://id.huawei.com/*
// @match        https://*.id.huawei.com/*
// @run-at       document-idle
// @grant        GM_notification
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // ===================== 可调参数 =====================
  // 空闲多少分钟后做一次保活重载。必须 < 华为服务端空闲超时时间。
  // 若还是会掉线，把它调小（比如 5 或 3）。
  const RELOAD_AFTER_IDLE_MIN = 8;

  // 多久检查一次（秒）。无需改。
  const TICK_SECONDS = 30;

  // 在页面右下角显示一个小状态角标（确认脚本在工作）。不想要就改 false。
  const SHOW_BADGE = true;
  // ===================================================

  const IDLE_MS = RELOAD_AFTER_IDLE_MIN * 60 * 1000;
  let lastActivity = Date.now();

  // ---- 是否当前停在「登录页」----
  function isLoginPage() {
    const h = location.hostname;
    const u = location.href.toLowerCase();
    // 登录/鉴权一般会跳到 id.huawei.com 或带 oauth/login/cas 的地址
    if (h.endsWith('id.huawei.com')) return true;
    return /\/(oauth|oauth2|login|logincallback|cas|accountcenter\/.*login)/.test(u);
  }

  // ---- 用户是否正在编辑（绝不在此时重载）----
  function isEditing() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (el.isContentEditable) return true;
    // 选中了文本，可能在阅读/操作，保守跳过
    const sel = window.getSelection && window.getSelection();
    if (sel && String(sel).length > 0) return true;
    return false;
  }

  // ---- 记录“用户有活动” ----
  function bump() { lastActivity = Date.now(); }
  ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll']
    .forEach((ev) => window.addEventListener(ev, bump, { passive: true, capture: true }));
  // 切回该标签页时，视为刚活动过，避免回来就被重载
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) bump();
  });

  // ---- 桌面通知（掉线提醒）----
  let notified = false;
  function notifyLoggedOut() {
    if (notified) return;
    notified = true;
    const opt = {
      title: '华为云备忘录已掉线',
      text: '保活未能维持会话，请点开备忘录窗口重新登录一次。',
      timeout: 0,
    };
    try {
      if (typeof GM_notification === 'function') { GM_notification(opt); return; }
    } catch (e) { /* fallthrough */ }
    try {
      if (window.Notification) {
        if (Notification.permission === 'granted') {
          new Notification(opt.title, { body: opt.text });
        } else if (Notification.permission !== 'denied') {
          Notification.requestPermission().then((p) => {
            if (p === 'granted') new Notification(opt.title, { body: opt.text });
          });
        }
      }
    } catch (e) { /* ignore */ }
  }

  // ---- 状态角标 ----
  let badge;
  function ensureBadge() {
    if (!SHOW_BADGE || badge) return;
    badge = document.createElement('div');
    badge.style.cssText = [
      'position:fixed', 'right:10px', 'bottom:10px', 'z-index:2147483647',
      'background:rgba(0,0,0,0.55)', 'color:#fff', 'font:12px/1.4 sans-serif',
      'padding:4px 8px', 'border-radius:6px', 'pointer-events:none',
      'user-select:none', 'opacity:0.8',
    ].join(';');
    (document.body || document.documentElement).appendChild(badge);
  }
  function setBadge(text) {
    ensureBadge();
    if (badge) badge.textContent = text;
  }

  function fmt(d) {
    return d.toTimeString().slice(0, 8);
  }

  // ---- 主循环 ----
  function tick() {
    if (isLoginPage()) {
      setBadge('⚠ 已掉线，请重新登录');
      notifyLoggedOut();
      return; // 登录页不做任何重载
    }
    notified = false;

    const idleMs = Date.now() - lastActivity;
    const leftMin = Math.max(0, Math.ceil((IDLE_MS - idleMs) / 60000));

    if (idleMs >= IDLE_MS && !isEditing()) {
      setBadge('↻ 保活重载…');
      location.reload();
      return;
    }
    setBadge(`保活中 · ${leftMin}min后续命 · ${fmt(new Date())}`);
  }

  // 首次进入若已在登录页，立刻提醒
  setTimeout(tick, 1500);
  setInterval(tick, TICK_SECONDS * 1000);
})();
