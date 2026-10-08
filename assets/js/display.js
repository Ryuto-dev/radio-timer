import { TimerSync } from './store.js';
import { fmtHMS, fmtClock, fmtDateJa, resolveCurrent, sectionProgress, statusFor } from './format.js';

const q = new URLSearchParams(location.search);
const roomId = (q.get('id') || '').replace(/\D/g, '');

const $ = (id) => document.getElementById(id);
const stage = $('stage'), enter = $('enter');

if (!roomId) {
  stage.classList.add('hidden');
  $('joinBtn').onclick = () => {
    const v = $('joinId').value.replace(/\D/g, '');
    if (v.length >= 4) location.href = 'display.html?id=' + v;
  };
} else {
  enter.style.display = 'none';
  $('roomBadge').textContent = 'ROOM ' + roomId;
  boot(roomId);
}

let audioOn = q.get('sound') !== '0';
let audioCtx = null;
let lastSec = null;

function beep(freq = 880, dur = 0.12, gain = 0.08) {
  if (!audioOn) return;
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = freq;
    g.gain.value = gain;
    o.connect(g); g.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + dur);
  } catch {}
}

function boot(id) {
  const sync = new TimerSync(id, { pollMs: 2000 });
  sync.onUpdate((st) => render(st));
  sync.start();
  setInterval(() => { try { sync.hb(document.fullscreenElement != null); } catch {} }, 5000);
  setInterval(() => render(sync.state), 250); // カウントダウン滑らか化

  $('fsBtn').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };
  $('soundBtn').onclick = (e) => {
    audioOn = !audioOn;
    e.currentTarget.textContent = audioOn ? '🔔 音ON' : '🔕 音OFF';
    if (audioOn) beep(880);
  };
  if (!audioOn) $('soundBtn').textContent = '🔕 音OFF';
  // 音はユーザータップ後に有効化 (Autoplay policy)
  window.addEventListener('pointerdown', function once() {
    if (audioOn && !audioCtx) beep(660, 0.06, 0.03);
  });

  function render(st) {
    $('conn').className = 'pill ' + (sync.connected ? 'on' : 'bad');
    $('conn').textContent = sync.connected ? '接続中' : '未接続';
    const now = new Date();
    $('clock').textContent = fmtClock(now);
    $('dateLine').textContent = fmtDateJa(now);

    if (!st || !st.events?.length) {
      const stopped = st?.stopped || st?.state === 'stopped';
      $('panel').dataset.status = 'normal';
      $('evTitle').textContent = stopped ? 'タイマー停止中' : '待機中 — 番組表の送信待ち';
      $('count').textContent = '--:--:--';
      $('statusLine').textContent = stopped ? 'STOPPED' : 'STANDBY';
      $('nextLine').textContent = '';
      $('secBar').style.width = '100%';
      $('totBar').style.width = '100%';
      $('onair').classList.remove('live');
      renderTicker(st);
      renderRundown(st, -1, now.getTime());
      document.body.classList.toggle('prompt-only', !!st?.promptOnly);
      return;
    }
    if (st.stopped || st.state === 'stopped') {
      $('panel').dataset.status = 'normal';
      $('evTitle').textContent = 'タイマー停止中';
      $('count').textContent = '--:--:--';
      $('statusLine').textContent = 'STOPPED';
      $('onair').classList.remove('live');
      renderTicker(st);
      renderRundown(st, -1, now.getTime());
      return;
    }

    const t = now.getTime();
    const { current, index, diff, finished } = resolveCurrent(st.events, t);
    const status = finished ? 'over' : statusFor(diff, st.warn1Sec ?? 60, st.warn2Sec ?? 30);

    $('panel').dataset.status = status;
    $('evTitle').textContent = finished ? '— 放送終了 —' : current.title;
    $('onair').classList.toggle('live', !finished);
    $('secLabel').textContent = '区間';

    if (finished) {
      $('count').textContent = '+' + fmtHMS(-diff).slice(3);
      $('statusLine').textContent = 'OVER — 超過 ' + fmtHMS(-diff);
    } else {
      $('count').textContent = fmtHMS(diff);
      const s = Math.ceil(diff / 1000);
      $('statusLine').textContent = s <= 10 ? `残り ${s} 秒` : `残り ${Math.floor(s / 60)}分${s % 60}秒`;
      // カウントダウン末期の警告音 (10〜1秒でピッ、0秒でピーン)
      if (s !== lastSec) {
        lastSec = s;
        if (s <= 5 && s > 0) beep(880, 0.1);
        else if (s <= 10 && s > 5) beep(660, 0.08, 0.05);
      }
      if (s === 0) beep(1320, 0.4);
    }

    const p = sectionProgress(st.events, st.configTime, index, t);
    $('secBar').style.width = ((1 - p) * 100).toFixed(1) + '%';
    $('secBar').parentElement.className = 'bar' + (status === 'warn1' ? ' warn' : status === 'warn2' || status === 'over' ? ' danger' : '');
    const first = st.configTime || st.events[0].eventTime;
    const last = st.events[st.events.length - 1].eventTime;
    const tot = Math.max(0, Math.min(1, (t - first) / Math.max(1, last - first)));
    $('totBar').style.width = ((1 - tot) * 100).toFixed(1) + '%';
    $('totPct').textContent = Math.round(tot * 100) + '%';

    const nx = !finished && st.events[index + 1] ? st.events[index + 1] : null;
    $('nextLine').textContent = nx
      ? `NEXT ▶ ${nx.title}（あと ${fmtHMS(nx.eventTime - t)}）`
      : finished ? '' : 'NEXT ▶ — 最終イベント —';

    renderTicker(st);
    renderRundown(st, finished ? -2 : index, t);
    document.body.classList.toggle('prompt-only', !!st.promptOnly);
  }

  function renderTicker(st) {
    const el = $('ticker');
    el.textContent = st?.extraMessage || '';
    el.classList.toggle('flash', !!(st?.flash && st?.extraMessage));
  }

  function renderRundown(st, nowIndex, t) {
    const ul = $('rundown');
    ul.innerHTML = '';
    (st?.events || []).forEach((e, i) => {
      const li = document.createElement('li');
      const d = new Date(e.eventTime);
      const p = (n) => String(n).padStart(2, '0');
      const cls = nowIndex === -2 ? 'done' : i < nowIndex ? 'done' : i === nowIndex ? 'now' : '';
      if (cls) li.className = cls;
      li.innerHTML = `<time>${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}</time><span></span><span class="mono muted"></span>`;
      li.children[1].textContent = e.title;
      li.children[2].textContent = i < nowIndex || nowIndex === -2 ? '済' : i === nowIndex ? '●' : '';
      ul.appendChild(li);
    });
    const done = nowIndex === -2 ? (st?.events.length || 0) : Math.max(0, nowIndex);
    $('runMeta').textContent = `${st?.events.length || 0}件中 ${done}件進行`;
  }
}
