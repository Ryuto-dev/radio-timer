import { TimerSync, createRoom, loadKey, displayUrl, consoleUrl } from './store.js';
import { parseRundown, rundownToText } from './parse.js';
import { fmtHMS, resolveCurrent, statusFor } from './format.js';

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
  });
  sync.start();

  // ---------- rundown editor ----------
  let rows = [{ mode: 'relative', time: '5分', title: '番組開始' }];
  const tbody = $('edBody');

  function drawRows() {
    tbody.innerHTML = '';
    rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><select data-k="mode">
          <option value="relative">相対</option>
          <option value="absolute">絶対</option>
        </select></td>
        <td><input data-k="time" class="t-time" placeholder="${r.mode === 'absolute' ? '10:40:00' : '5分30秒'}"></td>
        <td><input data-k="title" placeholder="タイトル"></td>
        <td class="t-prev mono"></td>
        <td style="white-space:nowrap">
          <button class="ibtn secondary" data-a="up">↑</button>
          <button class="ibtn secondary" data-a="down">↓</button>
          <button class="ibtn secondary" data-a="del">✕</button>
        </td>`;
      tr.querySelector('[data-k=mode]').value = r.mode;
      tr.querySelector('[data-k=time]').value = r.time;
      tr.querySelector('[data-k=title]').value = r.title;
      tr.querySelector('[data-k=mode]').onchange = (e) => { r.mode = e.target.value; drawRows(); preview(); };
      tr.querySelector('[data-k=time]').oninput = (e) => { r.time = e.target.value; preview(); };
      tr.querySelector('[data-k=title]').oninput = (e) => { r.title = e.target.value; preview(); };
      tr.querySelector('[data-a=up]').onclick = () => { if (i > 0) { [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; drawRows(); preview(); } };
      tr.querySelector('[data-a=down]').onclick = () => { if (i < rows.length - 1) { [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; drawRows(); preview(); } };
      tr.querySelector('[data-a=del]').onclick = () => { rows.splice(i, 1); drawRows(); preview(); };
      tbody.appendChild(tr);
    });
  }

  function rowsToBulk() {
    return rows.map((r) => `${r.time} ${r.title}`.trim()).join('\n');
  }
  function bulkToRows(text) {
    const out = [];
    for (const line of String(text).split('\n')) {
      const t = line.trim();
      if (!t) continue;
      let m = t.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+[　\s]*(.*)$/);
      if (m) { out.push({ mode: 'absolute', time: m[1], title: m[2] || '' }); continue; }
      m = t.match(/^((?:\d+\s*分)?\s*(?:\d+\s*秒)?)\s+[　\s]*(.*)$/);
      if (m && m[1].trim()) { out.push({ mode: 'relative', time: m[1].trim(), title: m[2] || '' }); continue; }
      out.push({ mode: 'relative', time: '', title: t });
    }
    return out.length ? out : [{ mode: 'relative', time: '', title: '' }];
  }

  function preview() {
    const bulk = $('bulk').value;
    const { events, errors } = parseRundown(bulk, new Date());
    $('errBox').innerHTML = errors.map((e) => `<div class="err">行${e.line}: ${e.reason}</div>`).join('');
    $('countMeta').textContent = events.length ? `${events.length}件 / 開始 ${clockOf(events[0].eventTime)} → 終了 ${clockOf(events[events.length - 1].eventTime)}` : '0件';
    // 各行の確定時刻プレビュー
    [...tbody.rows].forEach((tr, i) => {
      const ev = events[i];
      tr.querySelector('.t-prev').textContent = ev ? clockOf(ev.eventTime) : '—';
    });
    // サーバープレビュー（残り時間）
    if (events.length) {
      const { current, index, diff } = resolveCurrent(events, Date.now());
      const s = statusFor(diff, Number($('warn1').value) || 60, Number($('warn2').value) || 30);
      $('pvTitle').textContent = current.title;
      $('pvRemain').textContent = fmtHMS(diff);
      $('pvRemain').style.color = s === 'warn1' ? 'var(--warn1)' : s === 'warn2' || diff < 0 ? '#f87171' : '#fff';
      $('pvNext').textContent = events[index + 1] ? `NEXT ▶ ${events[index + 1].title}` : '最終イベント';
    } else {
      $('pvTitle').textContent = '—'; $('pvRemain').textContent = '--:--:--'; $('pvNext').textContent = '';
    }
    return { events, errors };
  }
  const clockOf = (ms) => {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };

  $('bulk').addEventListener('input', () => { rows = bulkToRows($('bulk').value); drawRows(); preview(); });
  $('addRow').onclick = () => { rows.push({ mode: 'relative', time: '1分', title: '' }); $('bulk').value = rowsToBulk(); drawRows(); preview(); };
  $('clearRows').onclick = () => { rows = [{ mode: 'relative', time: '', title: '' }]; $('bulk').value = ''; drawRows(); preview(); };
  document.querySelectorAll('[data-preset]').forEach((b) => {
    b.onclick = () => {
      const v = b.dataset.preset;
      rows = bulkToRows(v);
      $('bulk').value = v;
      drawRows(); preview();
    };
  });

  // 初期値: サーバーに番組表があれば復元
  const unsub = sync.onUpdate((st) => {
    if (st?.events?.length && !$('bulk').value) {
      $('bulk').value = rundownToText(st.events);
      rows = bulkToRows($('bulk').value);
      drawRows(); preview();
      unsub();
    }
  });

  // ---------- actions ----------
  async function doPublish() {
    const { events, errors } = preview();
    if (!events.length) { flash('イベントがありません', true); return; }
    if (errors.length && !confirm(`${errors.length}行にエラーがあります。このまま送信しますか？`)) return;
    try {
      await sync.publish({
        events: events.map((e) => ({ title: e.title, eventTime: e.eventTime, order: e.order, mode: e.mode })),
        configTime: Date.now(),
        extraMessage: $('msgInput').value,
        warn1Sec: Number($('warn1').value) || 60,
        warn2Sec: Number($('warn2').value) || 30,
      });
      sync.mirrorLocal(sync.state);
      flash('送信しました ✓');
    } catch (e) {
      // API不通時はローカル共有で継続 (同一PCデモ)
      try {
        const st = { state: 'running', stopped: false, events, configTime: Date.now(), extraMessage: $('msgInput').value, warn1Sec: 60, warn2Sec: 30, stage: {} };
        localStorage.setItem('rt-local-' + id, JSON.stringify(st));
        sync.state = st; preview();
      } catch {}
      flash('送信失敗: ' + e.message + '（ローカル共有に切替）', true);
    }
  }
  $('publishBtn').onclick = doPublish;
  $('publishBtn2').onclick = doPublish;
  $('stopBtn').onclick = async () => { try { await sync.stop(); flash('停止しました'); } catch (e) { flash(e.message, true); } };
  $('resumeBtn').onclick = async () => { try { await sync.resume(); flash('再開しました'); } catch (e) { flash(e.message, true); } };
  $('resetBtn').onclick = async () => { if (confirm('番組表とメッセージをリセットしますか？')) try { await sync.reset(); flash('リセットしました'); } catch (e) { flash(e.message, true); } };
  $('adjPlus').onclick = () => sync.adjust(60).then(() => flash('+60秒しました')).catch((e) => flash(e.message, true));
  $('adjMinus').onclick = () => sync.adjust(-30).then(() => flash('-30秒しました')).catch((e) => flash(e.message, true));
  $('saveWarn').onclick = () => sync.saveSettings({ warn1Sec: Number($('warn1').value) || 60, warn2Sec: Number($('warn2').value) || 30 }).then(() => flash('警告時間を保存')).catch((e) => flash(e.message, true));

  let msgT = null;
  $('msgInput').addEventListener('input', () => {
    clearTimeout(msgT);
    msgT = setTimeout(() => { sync.message($('msgInput').value).catch(() => {}); }, 400);
  });
  $('sendMsgBtn').onclick = () => sync.message($('msgInput').value).then(() => flash('メッセージ送信')).catch((e) => flash(e.message, true));
  $('clearMsgBtn').onclick = () => { $('msgInput').value = ''; sync.message('').then(() => flash('メッセージ消去')).catch(() => {}); };
  $('flashTgl').onchange = (e) => sync.flags({ flash: e.target.checked }).catch(() => {});
  $('promptTgl').onchange = (e) => sync.flags({ promptOnly: e.target.checked }).catch(() => {});

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); doPublish(); }
  });

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
  $('bulk').value = rowsToBulk();
  drawRows(); preview();
  setInterval(preview, 1000);
}
