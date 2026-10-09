import { TimerSync, createRoom, loadKey, displayUrl, consoleUrl } from './store.js';
import { parseRundown } from './parse.js';
import { makeRow, computeRows, rowsSummary, rowsToEvents, eventsToRows, msToClock, fmtOffset, PRESETS } from './rows.js';
import { CALLSIGNS, callsignById, playCallsignFile, preloadCallsings } from './callsigns.js';
import { fmtHMS, fmtClock, resolveCurrent, statusFor } from './format.js';

const q = new URLSearchParams(location.search);
let roomId = (q.get('id') || '').replace(/\D/g, '');
let adminKey = roomId ? loadKey(roomId) : '';
const $ = (id) => document.getElementById(id);

// ---------- room enter ----------
if (!roomId) {
  $('main').style.display = 'none';
  $('enter').style.display = '';
  $('createBtn').onclick = async () => {
    try {
      const j = await createRoom();
      location.href = consoleUrl(j.id, j.adminKey);
    } catch (e) { $('enterMsg').textContent = '作成失敗: ' + e.message; }
  };
  $('openBtn').onclick = () => {
    const v = $('openId').value.replace(/\D/g, '');
    if (v.length >= 4) location.href = 'console.html?id=' + v;
    else $('enterMsg').textContent = '4〜6桁のIDを入力してください';
  };
} else {
  $('enter').style.display = 'none';
  boot(roomId, adminKey);
}

function boot(id, key) {
  const sync = new TimerSync(id, { adminKey: key, pollMs: 2000 });
  $('roomBadge').textContent = 'ROOM ' + id;
  $('keyState').textContent = key ? '管理キー: 保存済み' : '管理キー: なし（閲覧のみ）';
  $('keyState').className = 'pill ' + (key ? 'on' : 'bad');
  const isAdmin = !!key;
  ['publishBtn', 'publishBtn2', 'stopBtn', 'resumeBtn', 'resetBtn', 'adjPlus', 'adjMinus', 'sendMsgBtn', 'clearMsgBtn'].forEach((b) => {
    if ($(b)) $(b).disabled = !isAdmin;
  });
  ['msgInput', 'flashTgl', 'promptTgl'].forEach((b) => {
    if ($(b)) $(b).disabled = !isAdmin;
  });
  if (!isAdmin) $('adminWarn').style.display = '';

  // URLs + QR
  const dUrl = location.origin + location.pathname.replace(/[^/]*$/, '') + 'display.html?id=' + id;
  $('stageUrl').value = dUrl;
  $('qr').src = 'https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=' + encodeURIComponent(dUrl);
  $('copyStage').onclick = () => navigator.clipboard?.writeText(dUrl).then(() => flash('コピーしました'));
  $('copyAdmin').onclick = () => {
    const u = consoleUrl(id, key);
    navigator.clipboard?.writeText(u).then(() => flash('管理URLをコピーしました（共有注意）'));
  };
  $('openStage').onclick = () => window.open(dUrl, '_blank');

  sync.onUpdate((st) => {
    $('conn').className = 'pill ' + (sync.connected ? 'on' : 'bad');
    $('conn').textContent = sync.connected ? '接続中' : '未接続';
    const lastSeen = st?.stage?.lastSeen ? Date.now() / 1000 - st.stage.lastSeen : null;
    const online = lastSeen != null && lastSeen < 12;
    $('stageOnline').className = 'pill ' + (online ? 'on' : '');
    $('stageOnline').textContent = online ? `演台オンライン（${Math.round(lastSeen)}秒前）` : '演台オフライン';
    if (st?.extraMessage !== undefined && document.activeElement !== $('msgInput')) {
      if ($('msgInput').value !== st.extraMessage) $('msgInput').value = st.extraMessage;
    }
    if (st) {
      if ($('warn1').value !== String(st.warn1Sec ?? 60)) $('warn1').value = st.warn1Sec ?? 60;
      if ($('warn2').value !== String(st.warn2Sec ?? 30)) $('warn2').value = st.warn2Sec ?? 30;
      $('flashTgl').checked = !!st.flash;
      $('promptTgl').checked = !!st.promptOnly;
    }
    renderServerMeta(st);
    paintMirror();
  });
  sync.start();

  // ---------- 進行表エディタ (行モデルが唯一の真実。テキストとの二重管理なし) ----------
  let rows = [makeRow({ mode: 'relative', min: 5, sec: 0, title: '番組開始' })];
  let userEdited = false;
  const touch = () => { userEdited = true; };
  const listEl = $('rowList');
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  function rowCard(row, i) {
    const div = document.createElement('div');
    div.className = 'rrow';
    div.innerHTML = `
      <div class="rrow-head">
        <span class="rnum">${i + 1}</span>
        <div class="seg">
          <button data-m="relative" aria-pressed="${row.mode === 'relative'}">時間</button>
          <button data-m="absolute" aria-pressed="${row.mode === 'absolute'}">時刻</button>
        </div>
        <span style="flex:1"></span>
        <button class="secondary mini" data-a="up" title="上へ">↑</button>
        <button class="secondary mini" data-a="down" title="下へ">↓</button>
        <button class="secondary mini" data-a="del" title="削除">✕</button>
      </div>
      <div class="rrow-grid" data-rel ${row.mode !== 'relative' ? 'style="display:none"' : ''}>
        <input class="num" data-k="min" type="number" min="0" max="999" inputmode="numeric" value="${row.min}"><span class="unit">分</span>
        <input class="num" data-k="sec" type="number" min="0" max="59" inputmode="numeric" value="${row.sec}"><span class="unit">秒</span>
      </div>
      <div class="rrow-grid" data-abs ${row.mode !== 'absolute' ? 'style="display:none"' : ''}>
        <input data-k="clock" type="time" step="1" value="${esc(row.clock || '')}">
      </div>
      <input class="title-in" data-k="title" placeholder="タイトル（例: ゲスト登場）" value="${esc(row.title)}" maxlength="100">
      <div class="rchip mono" data-chip></div>
      <div class="rerr" data-err></div>`;

    div.querySelectorAll('[data-m]').forEach((b) => {
      b.onclick = () => {
        row.mode = b.dataset.m;
        touch();
        div.querySelectorAll('[data-m]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        div.querySelector('[data-rel]').style.display = row.mode === 'relative' ? '' : 'none';
        div.querySelector('[data-abs]').style.display = row.mode === 'absolute' ? '' : 'none';
        updateComputed();
      };
    });
    const num = (k) => div.querySelector(`[data-k=${k}]`);
    num('min').oninput = (e) => { row.min = e.target.value; touch(); updateComputed(); };
    num('sec').oninput = (e) => { row.sec = e.target.value; touch(); updateComputed(); };
    num('clock').oninput = (e) => { row.clock = e.target.value; touch(); updateComputed(); };
    num('title').oninput = (e) => { row.title = e.target.value; touch(); updateComputed(); };
    div.querySelector('[data-a=up]').onclick = () => { if (i > 0) { [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; touch(); renderRows(); } };
    div.querySelector('[data-a=down]').onclick = () => { if (i < rows.length - 1) { [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; touch(); renderRows(); } };
    div.querySelector('[data-a=del]').onclick = () => {
      touch();
      if (rows.length <= 1) rows = [makeRow({ min: 0, sec: 0, title: '' })];
      else rows.splice(i, 1);
      renderRows();
    };
    return div;
  }

  function renderRows(focusLast) {
    listEl.innerHTML = '';
    rows.forEach((row, i) => listEl.appendChild(rowCard(row, i)));
    updateComputed();
    if (focusLast) listEl.lastChild?.querySelector('[data-k=title]')?.focus();
  }

  function updateComputed() {
    const now = Date.now();
    const computed = computeRows(rows, now);
    computed.forEach((c, i) => {
      const card = listEl.children[i];
      if (!card) return;
      const chip = card.querySelector('[data-chip]');
      const err = card.querySelector('[data-err]');
      if (c.error) {
        chip.textContent = '';
        err.textContent = `行${i + 1}: ${c.error}`;
      } else {
        err.textContent = '';
        const t = msToClock(c.eventTime);
        chip.textContent = c.row.mode === 'relative'
          ? `→ ${t} 開始（＋${fmtOffset(c.offsetMs)}）`
          : `→ ${t} 開始`;
        chip.classList.toggle('warn', !!c.past);
        if (c.past) chip.textContent += ' ※過去の時刻';
      }
    });
    const sum = rowsSummary(computed);
    const sumText = sum.valid
      ? `${sum.count}件（有効${sum.valid}件）/ 開始 ${msToClock(sum.startMs)} → 終了 ${msToClock(sum.endMs)}`
      : (rows.length ? '上の赤字を確認してください' : '行がありません。「行追加」で追加できます');
    $('rowSummary').textContent = sumText;
    $('countMeta').textContent = sumText;
    // プレビュー (送信前確認)
    const valid = computed.filter((c) => c.eventTime != null);
    if (valid.length) {
      const evs = valid.map((c) => ({ title: String(c.row.title).trim(), eventTime: c.eventTime }));
      const { current, index, diff } = resolveCurrent(evs, now);
      const s = statusFor(diff, Number($('warn1').value) || 60, Number($('warn2').value) || 30);
      $('pvTitle').textContent = current.title;
      $('pvRemain').textContent = fmtHMS(diff);
      $('pvRemain').style.color = s === 'warn1' ? 'var(--warn1)' : s === 'warn2' || diff < 0 ? 'var(--over)' : 'var(--fg)';
      $('pvNext').textContent = evs[index + 1] ? `NEXT ▶ ${evs[index + 1].title}` : '最終イベント';
    } else {
      $('pvTitle').textContent = '—'; $('pvRemain').textContent = '--:--:--'; $('pvNext').textContent = '';
    }
  }

  $('addRow').onclick = () => { rows.push(makeRow({ min: 0, sec: 0, title: '' })); touch(); renderRows(true); };
  $('clearRows').onclick = () => { rows = [makeRow({ min: 0, sec: 0, title: '' })]; touch(); renderRows(); };
  document.querySelectorAll('[data-preset]').forEach((b) => {
    b.onclick = () => {
      const f = PRESETS[b.dataset.preset];
      if (f) { rows = f(); touch(); renderRows(); }
    };
  });
  $('importBtn').onclick = () => {
    const { events, errors } = parseRundown($('bulk').value, new Date());
    if (!events.length) { $('importMsg').textContent = '取り込める行がありませんでした'; return; }
    rows = eventsToRows(events);
    touch();
    renderRows();
    $('importMsg').textContent = `${events.length}件取り込み${errors.length ? `（${errors.length}行スキップ）` : ''}`;
  };

  // 初期値: サーバーに番組表があれば復元 (ユーザーが触る前だけ)
  const unsub = sync.onUpdate((st) => {
    if (st?.events?.length && !userEdited) {
      rows = eventsToRows(st.events);
      renderRows();
      unsub();
    }
  });

  // ---------- actions ----------
  async function doPublish() {
    const now = Date.now();
    const computed = computeRows(rows, now);
    if (!computed.length) { flash('行がありません', true); return; }
    const bad = computed.findIndex((c) => c.error);
    if (bad !== -1) { flash(`行${bad + 1}: ${computed[bad].error}`, true); return; }
    const events = rowsToEvents(rows, now);
    try {
      await sync.publish({
        events,
        configTime: now,
        extraMessage: $('msgInput').value,
        warn1Sec: Number($('warn1').value) || 60,
        warn2Sec: Number($('warn2').value) || 30,
      });
      sync.mirrorLocal(sync.state);
      flash('送信しました ✓');
    } catch (e) {
      // API不通時はローカル共有で継続 (同一PCデモ)
      try {
        const st = { state: 'running', stopped: false, events, configTime: now, extraMessage: $('msgInput').value, warn1Sec: 60, warn2Sec: 30, stage: {} };
        localStorage.setItem('rt-local-' + id, JSON.stringify(st));
        sync.state = st; updateComputed();
      } catch {}
      flash('送信失敗: ' + e.message + '（ローカル共有に切替）', true);
    }
  }
  $('publishBtn').onclick = doPublish;
  $('publishBtn2').onclick = doPublish;
  $('stopBtn').onclick = async () => { try { await sync.stop(); flash('停止しました'); } catch (e) { flash(e.message, true); } };
  $('resumeBtn').onclick = async () => { try { await sync.resume(); flash('再開しました'); } catch (e) { flash(e.message, true); } };
  $('resetBtn').onclick = async () => { if (confirm('進行表とCUEをリセットしますか？')) try { await sync.reset(); flash('リセットしました'); } catch (e) { flash(e.message, true); } };
  $('adjPlus').onclick = () => sync.adjust(60).then(() => flash('+60秒しました')).catch((e) => flash(e.message, true));
  $('adjMinus').onclick = () => sync.adjust(-30).then(() => flash('-30秒しました')).catch((e) => flash(e.message, true));
  $('saveWarn').onclick = () => sync.saveSettings({ warn1Sec: Number($('warn1').value) || 60, warn2Sec: Number($('warn2').value) || 30 }).then(() => flash('警告時間を保存')).catch((e) => flash(e.message, true));

  let msgT = null;
  const cueState = (t) => { $('msgSendState').textContent = t; };
  $('msgInput').addEventListener('input', () => {
    clearTimeout(msgT);
    msgT = setTimeout(() => {
      cueState('CUE送信中…');
      sync.message($('msgInput').value).then(() => {
        cueState($('msgInput').value ? `✓ CUE送信済み ${fmtClock(new Date())}（表示側に反映されます）` : 'CUEなし');
      }).catch((e) => { cueState('CUE送信失敗: ' + e.message); });
    }, 400);
  });
  $('sendMsgBtn').onclick = () => {
    cueState('CUE送信中…');
    sync.message($('msgInput').value).then(() => { cueState(`✓ CUE送信済み ${fmtClock(new Date())}`); flash('CUE送信'); }).catch((e) => { cueState('CUE送信失敗: ' + e.message); flash(e.message, true); });
  };
  $('clearMsgBtn').onclick = () => { $('msgInput').value = ''; cueState('CUE送信中…'); sync.message('').then(() => { cueState('CUE消去済み'); flash('CUE消去'); }).catch((e) => { cueState('CUE送信失敗: ' + e.message); }); };
  $('flashTgl').onchange = (e) => sync.flags({ flash: e.target.checked }).catch(() => {});
  $('promptTgl').onchange = (e) => sync.flags({ promptOnly: e.target.checked }).catch(() => {});

  // ---------- コールサイン ----------
  try { $('csLocal').checked = localStorage.getItem('sc-cs-local') !== '0'; } catch {}
  $('csLocal').onchange = (e) => { try { localStorage.setItem('sc-cs-local', e.target.checked ? '1' : '0'); } catch {} };
  CALLSIGNS.forEach((cs) => {
    const b = document.createElement('button');
    b.className = 'secondary';
    b.textContent = `▶ ${cs.name}`;
    b.disabled = !isAdmin;
    b.onclick = async () => {
      $('csState').textContent = '再生指示を送信中…';
      try {
        await sync.playCallsign(cs.id);
        $('csState').textContent = `再生指示を送信：${cs.name}（${fmtClock(new Date())}）`;
      } catch (e) { $('csState').textContent = '送信失敗: ' + e.message; }
    };
    $('csList').appendChild(b);
  });
  let lastSfxAt = 0;
  sync.onUpdate((st) => {
    const at = st?.sfx?.at || 0;
    if (at <= lastSfxAt) return;
    lastSfxAt = at;
    const cs = st.sfx.id ? callsignById(st.sfx.id) : null;
    if (!cs || Date.now() - at >= 15000) return; // 古い指示は鳴らさない
    if ($('csLocal').checked) {
      playCallsignFile(cs.file).then((ok) => {
        $('csState').textContent = ok ? `♪ 再生中：${cs.name}` : '音声がブロックされました（画面を一度タップ）';
      });
    } else {
      $('csState').textContent = `受信：${cs.name}（この端末はミュート中）`;
    }
  });
  preloadCallsings();

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); doPublish(); }
  });

  // 表示ミラー: サーバー状態から表示側と同一の秒数・次キューを描く
  function paintMirror() {
    const st = sync.state;
    const pill = $('mState');
    const setPill = (t, cls) => { pill.textContent = t; pill.className = 'pill ' + (cls || ''); };
    if (!st) {
      setPill('未取得', 'bad');
      $('mTitle').textContent = '—';
      $('mTime').textContent = '--:--:--';
      $('mNext').textContent = '';
      $('mCue').textContent = '';
      $('mMeta').textContent = sync.connected ? 'サーバーと同期中' : '未接続';
      return;
    }
    if (!st.events?.length || st.stopped || st.state === 'stopped') {
      const stopped = st.stopped || st.state === 'stopped';
      setPill(stopped ? '停止中' : '待機', '');
      $('mTitle').textContent = stopped ? 'タイマー停止中' : '—';
      $('mTime').textContent = '--:--:--';
      $('mNext').textContent = '';
      $('mCue').textContent = st.extraMessage ? '📩 CUE: ' + st.extraMessage : '';
      $('mMeta').textContent = sync.connected ? 'サーバーと同期中' : '未接続';
      return;
    }
    const now = Date.now();
    const { current, index, diff, finished } = resolveCurrent(st.events, now);
    setPill(finished ? '終了・超過中' : '進行中', finished ? 'bad' : 'on');
    $('mTitle').textContent = finished ? '— 放送終了 —' : current.title;
    $('mTime').textContent = finished ? '+' + fmtHMS(-diff).slice(3) : fmtHMS(diff);
    const nx = !finished && st.events[index + 1] ? st.events[index + 1] : null;
    $('mNext').textContent = finished ? '' : nx ? `NEXT CUE ▶ ${nx.title}（あと ${fmtHMS(nx.eventTime - now)}）` : '最終キュー（この後 番組終了）';
    $('mCue').textContent = st.extraMessage ? '📩 CUE: ' + st.extraMessage : '';
    $('mMeta').textContent = sync.connected ? 'サーバーと同期中' : '未接続';
  }

  function renderServerMeta(st) {
    if (!st) return;
    $('svState').textContent = st.stopped ? '停止中' : st.state === 'running' ? '進行中' : '待機';
  }
  function flash(msg, isErr) {
    $('toast').textContent = msg;
    $('toast').className = isErr ? 'err' : 'ok';
    clearTimeout(flash._t);
    flash._t = setTimeout(() => { $('toast').textContent = ''; }, 3000);
  }

  // 初期描画
  renderRows();
  paintMirror();
  setInterval(() => { updateComputed(); paintMirror(); }, 1000);
}
