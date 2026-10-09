// 進行表の行モデル (エディタの唯一の真実。テキストとの二重管理をしない)
// Row = { uid, mode:'relative'|'absolute', min, sec, clock:'HH:MM[:SS]', title }
import { normalizeLine } from './parse.js';

let uid = 1;
export function makeRow(part = {}) {
  return { uid: uid++, mode: 'relative', min: 5, sec: 0, clock: '', title: '', ...part };
}

export function msToClock(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// 'HH:MM[:SS]' (本日) → ms。 full-width対応。不正は null
export function clockToMs(clock, baseDate = new Date()) {
  const s = normalizeLine(clock);
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const hh = Number(m[1]), mm = Number(m[2]), ss = Number(m[3] || '0');
  if (hh > 23 || mm > 59 || ss > 59) return null;
  const t = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), hh, mm, ss, 0);
  return t.getTime();
}

export function fmtOffset(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(r)}` : `${m}:${p(r)}`;
}

// 行列 → 行ごとの確定時刻・検証結果。baseMs起点で累積 (絶対行は累積を上書き)。
// 戻り値: [{ row, eventTime|null, offsetMs|null, error|null, past }]
export function computeRows(rows, baseMs = Date.now()) {
  let cumulative = baseMs;
  return (rows || []).map((row) => {
    const title = String(row.title || '').trim();
    if (!title) return { row, eventTime: null, offsetMs: null, error: 'タイトルを入力', past: false };
    if (row.mode === 'absolute') {
      const t = clockToMs(row.clock || '');
      if (t == null) return { row, eventTime: null, offsetMs: null, error: '時刻が不正 (HH:MM:SS)', past: false };
      cumulative = t;
      return { row, eventTime: t, offsetMs: null, error: null, past: t < baseMs - 1000 };
    }
    const total = Math.max(0, Number(row.min) || 0) * 60 + Math.max(0, Number(row.sec) || 0);
    if (total <= 0) return { row, eventTime: null, offsetMs: null, error: '0秒は無効', past: false };
    cumulative += total * 1000;
    return { row, eventTime: cumulative, offsetMs: total * 1000, error: null, past: false };
  });
}

export function rowsSummary(computed) {
  const valid = computed.filter((c) => c.eventTime != null);
  if (!valid.length) return { count: 0, valid: 0 };
  return {
    count: computed.length,
    valid: valid.length,
    startMs: valid[0].eventTime,
    endMs: valid[valid.length - 1].eventTime,
  };
}

// 送信ペイロード用 (検証済み前提)。未検証行があれば null
export function rowsToEvents(rows, baseMs = Date.now()) {
  const computed = computeRows(rows, baseMs);
  if (computed.some((c) => c.error)) return null;
  return computed
    .filter((c) => c.eventTime != null)
    .map((c, i) => ({ title: String(c.row.title).trim(), eventTime: c.eventTime, order: i, mode: c.row.mode }));
}

// サーバーevents → 行 (絶対時刻行として復元)
export function eventsToRows(events) {
  return (events || []).map((e) => makeRow({ mode: 'absolute', clock: msToClock(e.eventTime), title: e.title }));
}

export const PRESETS = {
  program20: () => [
    makeRow({ mode: 'relative', min: 5, sec: 0, title: 'オープニング' }),
    makeRow({ mode: 'relative', min: 10, sec: 0, title: 'ゲストトーク' }),
    makeRow({ mode: 'relative', min: 2, sec: 0, title: 'CM' }),
    makeRow({ mode: 'relative', min: 3, sec: 0, title: 'エンディング' }),
  ],
  regular: () => [
    makeRow({ mode: 'absolute', clock: '10:00:00', title: '放送開始' }),
    makeRow({ mode: 'relative', min: 5, sec: 0, title: 'ニュース' }),
    makeRow({ mode: 'relative', min: 10, sec: 0, title: '特集' }),
    makeRow({ mode: 'relative', min: 5, sec: 0, title: '天気・交通' }),
    makeRow({ mode: 'relative', min: 1, sec: 0, title: '終了' }),
  ],
  recording: () => [
    makeRow({ mode: 'relative', min: 0, sec: 30, title: 'スタンバイ' }),
    makeRow({ mode: 'relative', min: 0, sec: 10, title: 'カウントダウン' }),
    makeRow({ mode: 'relative', min: 1, sec: 0, title: '本番' }),
  ],
};
