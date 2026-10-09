// 時刻フォーマット・区間判定の共通化 (console/displayで共有)
export const pad = (n) => String(n).padStart(2, '0');

export function fmtHMS(ms) {
  const neg = ms < 0;
  ms = Math.abs(ms);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return (neg ? '-' : '') + `${pad(h)}:${pad(m)}:${pad(s)}`;
}
export function fmtMS(ms) {
  const neg = ms < 0;
  ms = Math.abs(ms);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return (neg ? '-' : '') + `${pad(m)}:${pad(s)}`;
}
export function fmtClock(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
export function fmtDateJa(d = new Date()) {
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}(${w})`;
}

// 現在区間の解決: { current, index, diff, finished, overtime }
export function resolveCurrent(events, now) {
  if (!events?.length) return { current: null, index: -1, diff: 0, finished: false };
  let idx = events.findIndex((e) => e.eventTime > now);
  if (idx === -1) {
    const last = events[events.length - 1];
    const diff = last.eventTime - now; // <=0
    return { current: last, index: events.length - 1, diff, finished: diff < 0, overtime: diff < 0 };
  }
  return { current: events[idx], index: idx, diff: events[idx].eventTime - now, finished: false };
}

export function sectionProgress(events, configTime, index, now) {
  let start = configTime || now;
  if (index > 0 && events[index - 1]?.eventTime) start = events[index - 1].eventTime;
  const end = events[index]?.eventTime ?? now;
  const total = end - start;
  // 開始>=終了の縮退区間 (遅れて送信・同一時刻など) は「完了扱い」。0を返すとバーが満タンのまま固まる
  if (total <= 0) return 1;
  return Math.max(0, Math.min(1, (now - start) / total));
}

// 残り秒に応じたステータス: normal | warn1 | warn2 | over
export function statusFor(diffMs, warn1Sec = 60, warn2Sec = 30) {
  if (diffMs < 0) return 'over';
  const s = diffMs / 1000;
  if (s <= warn2Sec) return 'warn2';
  if (s <= warn1Sec) return 'warn1';
  return 'normal';
}
