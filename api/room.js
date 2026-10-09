// radio-timer API — TIME-PON方式の軽量ポーリングAPIをVercel向けに再実装
// Storage: Vercel KV (Upstash Redis REST) があればそれを使用、なければ /tmp + メモリ (ローカルdev用)
// Endpoints (single file):
//   GET  /api/room?act=get&id=XXXXXX          … 現在状態を即時返答
//   GET  /api/room?act=watch&id=XXXXXX&rev=N  … revが変わるまで最大約8.5秒待機 (長時間ポーリング・準リアルタイム用)
//   POST /api/room  { act:'create' }
//   POST /api/room  { act:'set', id, k, cmd, ... }
//   POST /api/room  { act:'setSettings', id, k, warn1Sec, warn2Sec }
//   POST /api/room  { act:'hb'|'ack', id, ... }
//   GET  /api/room?act=health
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const TTL_SEC = 7 * 24 * 3600;
const DATA_DIR = '/tmp/radio-timer-rooms';

function kvEnv() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

async function kvFetch(pipeline) {
  const env = kvEnv();
  if (!env) return null;
  const r = await fetch(`${env.url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(pipeline),
  });
  if (!r.ok) throw new Error('kv error ' + r.status);
  return r.json();
}
async function kvGet(key) {
  const out = await kvFetch([['GET', key]]);
  if (!out) return null;
  const v = out?.[0]?.result;
  if (!v) return null;
  try { return JSON.parse(v); } catch { return null; }
}
async function kvSet(key, val, ttl = TTL_SEC) {
  await kvFetch([['SET', key, JSON.stringify(val), 'EX', String(ttl)]]);
}

const mem = (globalThis.__RT_MEM__ ??= new Map());

function fileGet(id) {
  try {
    const p = path.join(DATA_DIR, id + '.json');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return null; }
}
function fileSet(id, st) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, id + '.json'), JSON.stringify(st));
  } catch { /* ephemeral — ignore */ }
}

async function loadRoom(id) {
  if (!/^\d{4,8}$/.test(id)) return null;
  if (kvEnv()) {
    const st = await kvGet('rt:room:' + id);
    if (st) return st;
  }
  if (mem.has(id)) return mem.get(id);
  const f = fileGet(id);
  if (f) { mem.set(id, f); return f; }
  return null;
}
async function saveRoom(st, { bump = true } = {}) {
  if (bump) st.rev = (Number(st.rev) || 0) + 1;
  st.updatedAt = Date.now();
  mem.set(st.id, st);
  fileSet(st.id, st);
  if (kvEnv()) {
    try { await kvSet('rt:room:' + st.id, st); } catch (e) { console.error(e); }
  }
}

function defaultRoom(id) {
  return {
    id,
    state: 'idle', // idle | running | stopped
    stopped: false,
    events: [],
    configTime: 0,
    extraMessage: '',
    messageAtMs: 0,
    warn1Sec: 60,
    warn2Sec: 30,
    flash: false,
    promptOnly: false,
    stage: { lastSeen: 0, fullscreen: false, ackMs: 0 },
    adminKey: null,
    rev: 0, // 内容更新カウンタ (watch用。hb等の生存報告では増やさない)
    updatedAt: Date.now(),
  };
}
function redact(st) {
  const { adminKey, ...rest } = st;
  return rest;
}
function fresh(id, d) {
  const base = defaultRoom(id);
  if (!d || typeof d !== 'object') return base;
  const out = { ...base, ...d };
  out.stage = { ...base.stage, ...(d.stage || {}) };
  if (!Array.isArray(out.events)) out.events = [];
  out.events = out.events
    .filter((e) => e && typeof e.eventTime === 'number' && typeof e.title === 'string')
    .map((e, i) => ({
      title: String(e.title).slice(0, 100),
      eventTime: Math.floor(e.eventTime),
      order: typeof e.order === 'number' ? e.order : i,
      mode: e.mode === 'absolute' ? 'absolute' : 'relative',
    }))
    .sort((a, b) => a.order - b.order);
  out.warn1Sec = Math.min(3600, Math.max(0, Number(out.warn1Sec) || 0));
  out.warn2Sec = Math.min(3600, Math.max(0, Number(out.warn2Sec) || 0));
  out.extraMessage = String(out.extraMessage || '').slice(0, 500);
  out.rev = Math.max(0, Math.floor(Number(out.rev) || 0));
  return out;
}

// ----簡易レート制限 (インスタンス内メモリ) ----
const hits = (globalThis.__RT_RL__ ??= new Map());
function throttle(key, max, winSec) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < winSec * 1000);
  arr.push(now);
  hits.set(key, arr);
  return arr.length <= max;
}

function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch {
    return Object.fromEntries(new URLSearchParams(raw));
  }
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const q = Object.fromEntries(url.searchParams);
  const body = req.method === 'POST' ? await readBody(req) : {};
  const act = body.act || q.act || '';
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';

  if (act === 'health' || (!act && req.method === 'GET')) {
    return send(res, 200, { ok: true, kv: !!kvEnv(), now: Date.now() });
  }

  if (act === 'create' && req.method === 'POST') {
    if (!throttle('c:' + ip, 10, 60)) return send(res, 429, { ok: false, error: 'rate_limited' });
    let id;
    for (let i = 0; i < 20; i++) {
      id = String(Math.floor(100000 + Math.random() * 900000));
      if (!(await loadRoom(id))) break;
      id = null;
    }
    if (!id) return send(res, 500, { ok: false, error: 'id_exhausted' });
    const st = defaultRoom(id);
    st.state = 'idle';
    st.adminKey = crypto.randomBytes(16).toString('hex');
    await saveRoom(st);
    return send(res, 200, { ok: true, id, adminKey: st.adminKey });
  }

  if (act === 'get') {
    if (!throttle('r:' + ip, 300, 60)) return send(res, 429, { ok: false, error: 'rate_limited' });
    const id = String(q.id || body.id || '').replace(/\D/g, '');
    if (!id) return send(res, 400, { ok: false, error: 'id required' });
    const raw = await loadRoom(id);
    const exists = !!raw;
    const st = fresh(id, raw);
    return send(res, 200, { ok: true, state: redact(st), rev: st.rev, exists, serverNowMs: Date.now() });
  }

  if (act === 'watch') {
    // 長時間ポーリング: クライアントのrevと変わるまで最大約8.5秒待機し、変化があれば即時返答。
    // 2秒ポーリングと違い、CUE等の反映が通常1秒以内になる。Hobbyの10秒制限内に収める。
    const id = String(q.id || '').replace(/\D/g, '');
    if (!id) return send(res, 400, { ok: false, error: 'id required' });
    if (!throttle('w8:' + ip, 60, 60)) {
      const raw0 = await loadRoom(id);
      const st0 = fresh(id, raw0);
      return send(res, 200, { ok: true, state: redact(st0), rev: st0.rev, exists: !!raw0, serverNowMs: Date.now(), fallback: true });
    }
    const wantRaw = Number(q.rev);
    const wantRev = Number.isFinite(wantRaw) ? Math.floor(wantRaw) : -1;
    const deadline = Date.now() + 8500;
    const rawFirst = await loadRoom(id);
    const first = fresh(id, rawFirst);
    if (first.rev !== wantRev) {
      return send(res, 200, { ok: true, state: redact(first), rev: first.rev, exists: !!rawFirst, serverNowMs: Date.now() });
    }
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 700));
      const raw = await loadRoom(id);
      const st = fresh(id, raw);
      if (st.rev !== wantRev) {
        return send(res, 200, { ok: true, state: redact(st), rev: st.rev, exists: !!raw, serverNowMs: Date.now() });
      }
    }
    return send(res, 200, { ok: true, state: redact(first), rev: first.rev, exists: !!rawFirst, serverNowMs: Date.now() });
  }

  if ((act === 'set' || act === 'setSettings' || act === 'hb' || act === 'ack') && req.method === 'POST') {
    if (!throttle('w:' + ip, 180, 60)) return send(res, 429, { ok: false, error: 'rate_limited' });
    const id = String(body.id || q.id || '').replace(/\D/g, '');
    if (!id) return send(res, 400, { ok: false, error: 'id required' });
    const k = String(body.k || '');
    let st = fresh(id, await loadRoom(id));

    // 初回claim: 管理キー未発行の旧データ救済 (明示的に許可した場合のみ)。通常はcreate必須
    if (!st.adminKey) {
      if (/^[0-9a-f]{32,}$/i.test(k)) { st.adminKey = k; }
      else return send(res, 403, { ok: false, error: 'forbidden_no_key' });
    }
    if (st.adminKey !== k && act !== 'hb') return send(res, 403, { ok: false, error: 'forbidden' });

    const now = Date.now();

    if (act === 'hb') {
      st.stage.lastSeen = Math.floor(now / 1000);
      st.stage.fullscreen = body.fs === true || body.fs === '1' || body.fs === 'true';
      await saveRoom(st, { bump: false }); // 生存報告ではrevを増やさない (watchの無駄な起床を防ぐ)
      return send(res, 200, { ok: true, state: redact(st), rev: st.rev, serverNowMs: now });
    }
    if (act === 'ack') {
      st.stage.ackMs = now;
      await saveRoom(st);
      return send(res, 200, { ok: true });
    }
    if (act === 'setSettings') {
      if (body.warn1Sec !== undefined) st.warn1Sec = Math.min(3600, Math.max(0, Number(body.warn1Sec) || 0));
      if (body.warn2Sec !== undefined) st.warn2Sec = Math.min(3600, Math.max(0, Number(body.warn2Sec) || 0));
      await saveRoom(st);
      return send(res, 200, { ok: true, state: redact(st) });
    }

    // act === 'set'
    const cmd = body.cmd || '';
    switch (cmd) {
      case 'publish': {
        const ev = Array.isArray(body.events) ? body.events : [];
        st.events = ev
          .filter((e) => e && typeof e.title === 'string')
          .slice(0, 100)
          .map((e, i) => ({
            title: String(e.title).slice(0, 100),
            eventTime: Math.floor(Number(e.eventTime) || 0),
            order: i,
            mode: e.mode === 'absolute' ? 'absolute' : 'relative',
          }))
          .filter((e) => e.eventTime > 0 && e.title.trim() !== '');
        if (!st.events.length) return send(res, 400, { ok: false, error: 'empty_events' });
        st.configTime = Math.floor(Number(body.configTime) || now);
        st.extraMessage = String(body.extraMessage || '').slice(0, 500);
        st.messageAtMs = st.extraMessage ? now : st.messageAtMs;
        if (body.warn1Sec !== undefined) st.warn1Sec = Math.min(3600, Math.max(0, Number(body.warn1Sec) || 0));
        if (body.warn2Sec !== undefined) st.warn2Sec = Math.min(3600, Math.max(0, Number(body.warn2Sec) || 0));
        st.stopped = false;
        st.state = 'running';
        break;
      }
      case 'stop':
        st.stopped = true;
        st.state = 'stopped';
        break;
      case 'resume':
        st.stopped = false;
        st.state = st.events.length ? 'running' : 'idle';
        break;
      case 'reset':
        st.events = [];
        st.stopped = false;
        st.state = 'idle';
        st.extraMessage = '';
        st.flash = false;
        st.promptOnly = false;
        break;
      case 'message': {
        let txt = String(body.text ?? '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').slice(0, 500);
        st.extraMessage = txt;
        st.messageAtMs = now;
        break;
      }
      case 'adjust': {
        // 全イベントを一括シフト (秒)。現場の「1分延びた」対応
        const sec = Math.max(-3600, Math.min(3600, Number(body.sec) || 0));
        st.events = st.events.map((e) => ({ ...e, eventTime: e.eventTime + sec * 1000 }));
        break;
      }
      case 'flags':
        if (body.flash !== undefined) st.flash = !!body.flash;
        if (body.promptOnly !== undefined) st.promptOnly = !!body.promptOnly;
        break;
      default:
        return send(res, 400, { ok: false, error: 'unknown_cmd' });
    }
    await saveRoom(st);
    // 同一ブラウザ即時反映用 (pollingの2秒待ちを消す)。display側も購読
    return send(res, 200, { ok: true, state: redact(st), serverNowMs: now });
  }

  return send(res, 404, { ok: false, error: 'not_found' });
}
