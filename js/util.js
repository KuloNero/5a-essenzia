// Utility pure (nessuna dipendenza dal DOM): usate sia nel browser sia nei test Node.

export function uid(len = 10) {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  const bytes = new Uint8Array(len);
  globalThis.crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += alphabet[b % 36];
  return s;
}

export function clone(o) {
  return o === undefined ? undefined : JSON.parse(JSON.stringify(o));
}

export function round(n, d = 2) {
  if (n === null || n === undefined || isNaN(n)) return 0;
  const f = Math.pow(10, d);
  return Math.round((Number(n) + Number.EPSILON) * f) / f;
}

export function num(v, def = 0) {
  if (v === null || v === undefined || v === '') return def;
  if (typeof v === 'number') return isFinite(v) ? v : def;
  const s = String(v).trim().replace(/\s/g, '');
  // accetta sia "1.234,56" sia "1234.56" sia "1234,56"
  let t = s;
  if (/,\d+$/.test(s) && s.includes('.')) t = s.replace(/\./g, '').replace(',', '.');
  else t = s.replace(',', '.');
  const n = parseFloat(t);
  return isFinite(n) ? n : def;
}

// ---- Date (formato ISO YYYY-MM-DD, fuso locale) ----
export function isoDate(d = new Date()) {
  if (typeof d === 'string') return d.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function today() { return isoDate(new Date()); }

export function parseISO(s) {
  if (!s) return null;
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function addMonths(iso, months) {
  const d = parseISO(iso);
  if (!d) return '';
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + Number(months || 0));
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return isoDate(d);
}

export function addDays(iso, days) {
  const d = parseISO(iso);
  if (!d) return '';
  d.setDate(d.getDate() + Number(days || 0));
  return isoDate(d);
}

export function daysBetween(fromIso, toIso) {
  const a = parseISO(fromIso), b = parseISO(toIso);
  if (!a || !b) return null;
  return Math.round((b - a) / 86400000);
}

export function fmtDate(iso) {
  if (!iso) return '';
  const s = String(iso).slice(0, 10).split('-');
  if (s.length !== 3) return iso;
  return `${s[2]}/${s[1]}/${s[0]}`;
}

export function fmtDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${fmtDate(isoDate(d))} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fmtNum(n, d = 2) {
  return Number(round(n, d)).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: d });
}

export function fmtEur(n) {
  return Number(n || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtQty(q, unit) {
  const u = unit || 'g';
  if (u === 'g' && Math.abs(q) >= 1000) return `${fmtNum(q / 1000, 3)} kg`;
  if (u === 'ml' && Math.abs(q) >= 1000) return `${fmtNum(q / 1000, 3)} L`;
  return `${fmtNum(q, u === 'pz' ? 0 : 2)} ${u}`;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function normKey(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// ---- Base64 UTF-8 sicuro ----
export function utf8ToB64(str) {
  const bytes = new TextEncoder().encode(str);
  return bytesToB64(bytes);
}

export function b64ToUtf8(b64) {
  return new TextDecoder().decode(b64ToBytes(b64));
}

export function bytesToB64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function b64ToBytes(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function sortBy(arr, fn, dir = 1) {
  return [...arr].sort((a, b) => {
    const x = fn(a), y = fn(b);
    if (x === y) return 0;
    if (x === undefined || x === null || x === '') return 1;
    if (y === undefined || y === null || y === '') return -1;
    return (x < y ? -1 : 1) * dir;
  });
}

export function safeFileName(name) {
  return String(name || 'file').normalize('NFKD').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').slice(0, 80);
}
