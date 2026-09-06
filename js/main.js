// main.js — 啟動流程:載入資料 → 開習慣面板。關掉面板就回到首頁(備份/還原在那)。
import { load, flush, status } from './store.js';
import { openHabitPanel, seedTemplatesIfEmpty } from './habit.js';
import { exportBackup, importBackupFile } from './io.js';
import { showUndoToast } from './render.js';
import { applyStoredTheme } from './lite-extras.js';

const $ = (sel) => document.querySelector(sel);

function openPanel() {
  document.body.classList.add('panel-open');
  openHabitPanel(null, () => document.body.classList.remove('panel-open'));   // 關面板 → 回首頁
}

// 選好備份檔之後問「怎麼進來」。刻意不用系統的確認視窗:
//   那種視窗只有「確定/取消」兩顆,一定得把其中一個動作塞給「取消」,
//   而使用者按取消是想放棄 —— 結果反而執行了最危險的覆蓋。這裡三個選擇各自一顆鈕。
function askImportMode(file) {
  const box = document.getElementById('importAsk');
  const done = (msg) => { box.hidden = true; box.innerHTML = ''; if (msg) showUndoToast(0, msg); };

  const run = async (mode) => {
    try {
      const r = await importBackupFile(file, mode);
      done('已還原 ' + r.count + ' 筆');
    } catch (err) {
      done('');
      alert('還原失敗:' + (err && err.message ? err.message : err));
    }
  };

  box.innerHTML = '';
  const name = document.createElement('p');
  name.className = 'ask-file';
  name.textContent = '📄 ' + file.name;
  const q = document.createElement('p');
  q.className = 'ask-q';
  q.textContent = '這份備份要怎麼進來?';
  box.append(name, q);

  const mk = (label, sub, cls, fn) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ask-btn' + (cls ? ' ' + cls : '');
    b.innerHTML = '<b></b><span></span>';
    b.querySelector('b').textContent = label;
    b.querySelector('span').textContent = sub;
    b.addEventListener('click', fn);
    return b;
  };

  box.append(mk('合併', '保留現在的,把備份接在後面', '', () => run('merge')));

  const ovr = mk('整份覆蓋', '現在的設定和記錄會被換掉,救不回來', 'ask-danger', () => {});
  let armed = false, timer = null;
  ovr.addEventListener('click', () => {
    if (!armed) {
      armed = true; ovr.classList.add('ask-armed');
      ovr.querySelector('b').textContent = '⚠ 再按一次:整份覆蓋';
      ovr.querySelector('span').textContent = '現在這台裝置上的資料會被換掉';
      timer = setTimeout(() => {
        armed = false; ovr.classList.remove('ask-armed');
        ovr.querySelector('b').textContent = '整份覆蓋';
        ovr.querySelector('span').textContent = '現在的設定和記錄會被換掉,救不回來';
      }, 4000);
      return;
    }
    if (timer) clearTimeout(timer);
    run('replace');
  });
  box.append(ovr);

  box.append(mk('取消', '什麼都不做', 'ask-cancel', () => done('')));
  box.hidden = false;
  box.scrollIntoView({ block: 'nearest' });
}

// 存不了的裝置(無痕、擋網站資料)→ 掛一條蓋在最上層的警告。
//   刻意不放在首頁裡:一開啟就直接進面板,放首頁會被面板蓋住、等於沒警告到。
function warnNoStorage() {
  const el = document.createElement('div');
  el.className = 'hl-warn';
  el.innerHTML = '<span>⚠️ 這個瀏覽器不能儲存資料(常見原因:無痕視窗、或瀏覽器擋了網站資料)。現在仍可記錄與複製,但<b>一關掉就會消失</b> —— 請改用一般視窗開啟。</span>';
  const x = document.createElement('button');
  x.type = 'button'; x.className = 'hl-warn-x'; x.textContent = '✕'; x.setAttribute('aria-label', '關閉提醒');
  x.addEventListener('click', () => el.remove());
  el.append(x);
  document.body.prepend(el);
  // 警告是蓋在最上層的,量出它多高、讓面板往下讓位,否則會擋住面板的頁籤跟 ✕
  const sync = () => document.documentElement.style.setProperty('--warn-h', (el.isConnected ? el.offsetHeight : 0) + 'px');
  sync();
  if (window.ResizeObserver) new ResizeObserver(sync).observe(el);
  x.addEventListener('click', sync);
  window.addEventListener('resize', sync);
}

async function boot() {
  applyStoredTheme();   // 先套用上次選的亮/暗,免得畫面閃一下
  await load();
  if (!status.persistent) warnNoStorage();
  seedTemplatesIfEmpty();   // 全新的裝置 → 先把推薦範本準備好,一開就能記錄

  $('#openHabit').addEventListener('click', openPanel);

  $('#btnExport').addEventListener('click', async () => {
    try { const r = await exportBackup(); if (r && r.via !== 'cancel') showUndoToast(0, '已備份'); }
    catch (e) { alert('備份失敗:' + (e && e.message ? e.message : e)); }
  });

  $('#btnImport').addEventListener('click', () => $('#fileImport').click());
  $('#fileImport').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';                                     // 清掉,才能連續選同一個檔
    if (file) askImportMode(file);
  });

  // 打字到一半就關分頁 → 把還沒寫入的補上
  window.addEventListener('pagehide', () => { try { flush(); } catch (e) {} });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { try { flush(); } catch (e) {} } });

  openPanel();                                               // 一開啟就直接進記錄畫面

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});   // 離線可用;失敗不影響功能
  }

  // 跟瀏覽器要「持久化儲存」:拿到的話,空間不足時不會被自動清掉。
  //   Chrome/Android 裝成 App 後多半直接給;Safari 不吃這套(它有「7 天沒開就清掉」的規定,
  //   只有「加入主畫面」才躲得掉)—— 所以這只是加分,備份還是唯一可靠的做法。
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) {}
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('afterbegin', '<p style="padding:16px;color:#c33">載入失敗:' + (e && e.message ? e.message : e) + '</p>');
});
