// 番組表テキストパース (一括取込用。エディタ本体は rows.js の行モデルを使う)
// 入力例: 10:40:00 番組開始 / 5分30秒 コーナー / 1時間 特集
// 全角数字・全角コロン・全角スペースは自動正規化する。

export function normalizeLine(s) {
  return String(s ?? '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/：/g, ':')
    .replace(/　/g, ' ')
    .trim();
}

const ABS_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(.+)$/;
const REL_RE = /^(?:(\d+)\s*時間)?\s*(?:(\d+)\s*分)?\s*(?:(\d+)\s*秒)?\s+(.+)$/;

export function parseRundown(text, baseDate = new Date()) {
  const rawLines = String(text || '').split('\n');
  const events = [];
  const errors = [];
  const items = []; // 非空行ごとに {event} or {error}。空行は {blank:true}
  let cumulative = baseDate.getTime();
  const baseDay = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());

  rawLines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    const line = normalizeLine(raw);
    if (!line) { items.push({ blank: true }); return; }
    const fail = (reason) => { errors.push({ line: lineNo, reason }); items.push({ error: reason }); };

    let m = line.match(ABS_RE);
    if (m) {
      const hh = Number(m[1]), mm = Number(m[2]), ss = Number(m[3] || '0');
      const title = (m[4] || '').trim();
      if (hh > 23 || mm > 59 || ss > 59) return fail('時刻が不正です');
      if (!title) return fail('タイトルがありません');
      const t = new Date(baseDay.getTime());
      t.setHours(hh, mm, ss, 0);
      const eventTime = t.getTime();
      cumulative = eventTime;
      const ev = { mode: 'absolute', title, eventTime, order: events.length, src: line };
      events.push(ev);
      items.push({ event: ev });
      return;
    }
    m = line.match(REL_RE);
    if (m && (m[1] !== undefined || m[2] !== undefined || m[3] !== undefined)) {
      const h = m[1] ? Number(m[1]) : 0;
      const min = m[2] ? Number(m[2]) : 0;
      const sec = m[3] ? Number(m[3]) : 0;
      const title = (m[4] || '').trim();
      const total = h * 3600 + min * 60 + sec;
      if (total <= 0) return fail('0秒は無効です');
      if (!title) return fail('タイトルがありません');
      const eventTime = cumulative + total * 1000;
      cumulative = eventTime;
      const ev = { mode: 'relative', title, eventTime, order: events.length, src: line, offsetSec: total };
      events.push(ev);
      items.push({ event: ev });
      return;
    }
    return fail('形式が認識できません (例: 10:40:00 開始 / 5分30秒 開始 / 1時間 特集)');
  });
  return { events, errors, items };
}

export function rundownToText(events) {
  return (events || []).map((e) => {
    const d = new Date(e.eventTime);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${e.title}`;
  }).join('\n');
}

export function shiftEvents(events, sec) {
  return (events || []).map((e) => ({ ...e, eventTime: e.eventTime + sec * 1000 }));
}
