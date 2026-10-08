// 番組表パース (旧config.htmlの正統進化: エラー耐性+絶対/相対混在+プレビュー用メタ)
// 入力例:
//   10:40:00 番組開始
//   5分30秒 コーナー開始
//   10秒 スタート
export function parseRundown(text, baseDate = new Date()) {
  const lines = String(text || '').split('\n');
  const events = [];
  let cumulative = baseDate.getTime();
  const errors = [];
  const baseDay = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());

  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) return;
    // 絶対時刻 HH:MM(:SS) タイトル
    let m = line.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s+[　\s]*(.+)$/);
    if (m) {
      const hh = Number(m[1]), mm = Number(m[2]), ss = Number(m[3] || '0');
      if (hh > 23 || mm > 59 || ss > 59) { errors.push({ line: idx + 1, reason: '時刻が不正です' }); return; }
      const t = new Date(baseDay.getTime());
      t.setHours(hh, mm, ss, 0);
      let eventTime = t.getTime();
      // 過去時刻は「明日」ではなく「直後」とみなすか？ 旧仕様通り当日扱い + 警告
      cumulative = eventTime;
      events.push({ mode: 'absolute', title: m[4].trim(), eventTime, order: events.length, src: line });
      return;
    }
    // 相対 ○分○秒 / ○分 / ○秒 タイトル
    m = line.match(/^(?:(\d+)\s*分)?\s*(?:(\d+)\s*秒)?\s+[　\s]*(.+)$/);
    if (m && (m[1] !== undefined || m[2] !== undefined)) {
      const min = m[1] ? Number(m[1]) : 0;
      const sec = m[2] ? Number(m[2]) : 0;
      if (min === 0 && sec === 0) { errors.push({ line: idx + 1, reason: '0分0秒は無効です' }); return; }
      const eventTime = cumulative + (min * 60 + sec) * 1000;
      cumulative = eventTime;
      events.push({ mode: 'relative', title: m[3].trim(), eventTime, order: events.length, src: line, offsetSec: min * 60 + sec });
      return;
    }
    errors.push({ line: idx + 1, reason: '形式が認識できません (例: 10:40:00 開始 / 5分30秒 開始)' });
  });
  return { events, errors };
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
