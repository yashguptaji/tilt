/* ============================================================
   UTIL — Shared helpers
   ============================================================ */

const Util = (() => {

  // DOM
  const $  = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  function el(tag, attrs = {}, children = []) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class')      e.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html')  e.innerHTML = v;
      else if (k === 'text')  e.textContent = v;
      else if (v === true)    e.setAttribute(k, '');
      else if (v !== false && v != null) e.setAttribute(k, v);
    }
    (Array.isArray(children) ? children : [children]).forEach(c => {
      if (c == null || c === false) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  function show(id) {
    $$('.screen').forEach(s => s.classList.remove('active'));
    const t = document.getElementById('screen-' + id);
    if (t) t.classList.add('active');
  }

  // Random ID for room codes
  function genId(len = 6) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    for (let i = 0; i < len; i++) out += chars[arr[i] % chars.length];
    return out;
  }
  function uuid() {
    return 'p-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  // Fisher-Yates shuffle (cryptographically random)
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Currency formatting
  function fmt(n) {
    if (n == null) return '—';
    n = Math.round(n);
    if (Math.abs(n) >= 1_000_000) return (n/1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (Math.abs(n) >= 10_000)    return (n/1_000).toFixed(1).replace(/\.0$/, '') + 'k';
    return n.toLocaleString();
  }

  function fmtFull(n) {
    return Math.round(n).toLocaleString();
  }

  // Initials for avatars
  function initials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length-1][0]).toUpperCase();
  }

  // localStorage wrapper
  const Store = {
    get(k, d = null) {
      try { const v = localStorage.getItem('tilt:' + k); return v ? JSON.parse(v) : d; }
      catch { return d; }
    },
    set(k, v) {
      try { localStorage.setItem('tilt:' + k, JSON.stringify(v)); } catch {}
    },
    remove(k) { try { localStorage.removeItem('tilt:' + k); } catch {} }
  };

  // Toasts
  function toast(msg, type = '') {
    const c = document.getElementById('toast-container');
    if (!c) return;
    const t = el('div', { class: 'toast ' + type, text: msg });
    c.appendChild(t);
    setTimeout(() => t.remove(), 3600);
  }

  // Sleep
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Clamp
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  return { $, $$, el, show, genId, uuid, shuffle, fmt, fmtFull, initials, Store, toast, sleep, clamp };
})();
