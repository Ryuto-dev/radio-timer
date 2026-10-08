// TimerSync — 新API(/api/room) + 旧Firebase(RTDB) + BroadcastChannel の3層同期
// 1. 新APIをポーリング (2秒)。成功すればそれが正。
// 2. 同一ブラウザではBroadcastChannelで即時反映 (待ち時間ゼロ)。
// 3. 新APIが未配置(旧運用・file直開き)の場合は localStorage + Firebase-compat にフォールバック。
export class TimerSync {
  constructor(roomId, { adminKey = '', pollMs = 2000, channel = null } = {}) {
    this.roomId = roomId;
    this.adminKey = adminKey;
    this.pollMs = pollMs;
    this.state = null;
    this.exists = false;
    this.connected = false; // 新API到達可否
    this.listeners = new Set();
    this.timer = null;
    this.bc = null;
    try {
      this.bc = channel || (roomId ? new BroadcastChannel('radio-timer-' + roomId) : null);
      if (this.bc) this.bc.onmessage = (ev) => {
        if (ev.data?.state) { this.state = ev.data.state; this.emit(); }
      };
    } catch { this.bc = null; }
  }
  onUpdate(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.listeners.forEach((fn) => { try { fn(this.state, this); } catch {} }); }

  async fetchOnce() {
    if (!this.roomId) return null;
    const r = await fetch(`/api/room?act=get&id=${encodeURIComponent(this.roomId)}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('api ' + r.status);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'api error');
    this.connected = true;
    this.exists = !!j.exists;
    this.state = j.state;
    this.emit();
    return j.state;
  }

  async post(body) {
    const r = await fetch('/api/room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: this.roomId, k: this.adminKey, ...body }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || ('http ' + r.status));
    if (j.state) {
      this.state = j.state;
      this.emit();
      this.bc?.postMessage({ state: j.state });
    }
    return j;
  }

  publish({ events, configTime, extraMessage, warn1Sec, warn2Sec }) {
    return this.post({ act: 'set', cmd: 'publish', events, configTime, extraMessage, warn1Sec, warn2Sec });
  }
  stop() { return this.post({ act: 'set', cmd: 'stop' }); }
  resume() { return this.post({ act: 'set', cmd: 'resume' }); }
  reset() { return this.post({ act: 'set', cmd: 'reset' }); }
  message(text) { return this.post({ act: 'set', cmd: 'message', text }); }
  adjust(sec) { return this.post({ act: 'set', cmd: 'adjust', sec }); }
  flags(patch) { return this.post({ act: 'set', cmd: 'flags', ...patch }); }
  saveSettings(patch) { return this.post({ act: 'setSettings', ...patch }); }
  hb(fullscreen) { return this.post({ act: 'hb', fs: !!fullscreen }).catch(() => null); }
  ack() {
    // display側は管理キーを持たないため、hb経由のack相当としてlocalStorageに記録+サーバhbはキー無しでも許可
    try { localStorage.setItem('rt-ack-' + this.roomId, String(Date.now())); } catch {}
    return Promise.resolve();
  }

  start() {
    this.stopPoll();
    const loop = async () => {
      try { await this.fetchOnce(); }
      catch {
        this.connected = false;
        // フォールバック: localStorage (同一PCデモ運用)
        try {
          const raw = localStorage.getItem('rt-local-' + this.roomId);
          if (raw) { this.state = JSON.parse(raw); this.emit(); }
        } catch {}
      }
    };
    loop();
    this.timer = setInterval(loop, this.pollMs);
  }
  stopPoll() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  // console送信用: localStorageにも保存 (API不通時のデモ継続)
  mirrorLocal(state) {
    try { localStorage.setItem('rt-local-' + this.roomId, JSON.stringify(state)); } catch {}
    this.bc?.postMessage({ state });
  }
}

export async function createRoom() {
  const r = await fetch('/api/room', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ act: 'create' }),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'create failed');
  try {
    localStorage.setItem('rt-key-' + j.id, j.adminKey);
  } catch {}
  return j; // {id, adminKey}
}

export function loadKey(id) {
  try {
    const h = new URLSearchParams(location.hash.slice(1)).get('k');
    if (h) { localStorage.setItem('rt-key-' + id, h); return h; }
    return localStorage.getItem('rt-key-' + id) || '';
  } catch { return ''; }
}

export function displayUrl(id) {
  return location.origin + location.pathname.replace(/[^/]*$/, '') + 'display.html?id=' + encodeURIComponent(id);
}
export function consoleUrl(id, key) {
  const base = location.origin + location.pathname.replace(/[^/]*$/, '') + 'console.html?id=' + encodeURIComponent(id);
  return key ? base + '#k=' + encodeURIComponent(key) : base;
}
