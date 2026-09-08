// main.js — 啟動流程:載入資料 → 開習慣面板。關掉面板就回到首頁(備份/還原在那)。
import { state, load, flush, status } from './store.js';
import { openHabitPanel, seedTemplatesIfEmpty } from './habit.js';
import { exportBackup, importBackupFile } from './io.js';
import { showUndoToast } from './render.js';
import { applyStoredTheme, applyStoredColor } from './lite-extras.js';
import { localTodayYmd } from './ops.js';

const $ = (sel) => document.querySelector(sel);

function openPanel(date) {
  document.body.classList.add('panel-open');
  // 只收日期字串。這個函式也被當成 click handler 用過 —— 那樣會把 MouseEvent 當成日期傳進來,
  // _recDate 變成事件物件,paintRecord 一呼叫 .slice() 就整頁炸掉(畫面全白)。擋在這裡最保險。
  const ymd = (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) ? date : null;
  // 傳日期 = 強制切到記錄頁(還原完要看到資料,不能停在使用者上次待的管理頁)
  openHabitPanel(ymd, () => document.body.classList.remove('panel-open'));   // 關面板 → 回首頁
}

// 首頁角落顯示「現在跑的是哪一版」。出問題時第一個要確認的就是這個 ——
// 沒有它,使用者和我都分不出「功能壞了」還是「還在跑舊版」。
// 版本取自 Service Worker 的快取名(build 時用所有產出檔的內容雜湊命名),
// 那反映的是「實際在用的那一版」,而且離線也拿得到。
async function showVersion() {
  const el = document.getElementById('homeVer'); if (!el) return;
  let v = '';
  try { v = (await caches.keys()).filter((k) => k.indexOf('hl-') === 0).sort().pop() || ''; } catch (e) {}
  if (!v) { try { v = ((await (await fetch('./sw.js?v=' + Date.now())).text()).match(/hl-[0-9a-f]+/) || [])[0] || ''; } catch (e) {} }
  el.textContent = v ? ('版本 ' + v) : '版本 —(這個瀏覽器沒有離線快取)';
}

// 資料裡有記錄的日期有哪些(還原後用來說清楚「到底還原到什麼」)
function recordDays() {
  const days = new Set();
  const walk = (n) => {
    (n.children || []).forEach((c) => { if (c.due && /::/.test(c.text || '')) days.add(c.due); walk(c); });
  };
  try { walk(state.doc.root); } catch (e) {}
  return [...days].sort();
}

// 還原完要落在哪一天:最後有記錄的那天。備份是前幾天的話,落在今天只會看到空白 ——
// 跟還原失敗長得一模一樣,還得自己去切日期才看得到,那等於把找資料的工作丟回給使用者。
function restoreLandingDay() {
  const days = recordDays();
  return days.length ? days[days.length - 1] : localTodayYmd();
}

// 還原完要說的話。空白的畫面跟「還原失敗」長得一模一樣,不講清楚使用者無從判斷。
function restoreSummary(count) {
  const days = recordDays();
  const md = (d) => d.slice(5).replace('-', '/');
  if (!days.length) return '已還原 ' + count + ' 筆,但這份備份裡沒有任何每日記錄,只有習慣設定 —— 所以記錄頁是空的。';
  const last = days[days.length - 1];
  if (last !== localTodayYmd()) {
    return '已還原 ' + count + ' 筆,含 ' + days.length + ' 天的記錄。已經幫你翻到 ' + md(last)
      + '(最後有記錄的一天),要記今天的按上面那顆「今天」。';
  }
  return '已還原 ' + count + ' 筆,含 ' + days.length + ' 天的記錄(換錯了按左上 ↩ 可退回)';
}

// 讀檔可能卡住(iCloud 上的檔還沒下載完就是一例),不設上限就會停在「還原中…」不動
function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(
    () => rej(new Error('讀這個檔超過 ' + (ms / 1000) + ' 秒沒有回應。如果檔案存在 iCloud,先在「檔案」App 裡點開讓它下載完再試')), ms))]);
}

// 有新版可用 → 頂端一條提示,點了就換過去。
function showUpdateBar() {
  if (document.querySelector('.hl-update')) return;
  const el = document.createElement('div');
  el.className = 'hl-update';
  const msg = document.createElement('span');
  msg.textContent = '有新版本了';
  const go = document.createElement('button');
  go.type = 'button'; go.className = 'hl-update-go'; go.textContent = '重新載入';
  go.addEventListener('click', () => {
    // 新版可能還沒接手,這時重整只會再拿到舊的一份 → 等它接手再重整(最多等 3 秒)
    go.disabled = true; go.textContent = '更新中…';
    let reloaded = false;
    const bye = () => { if (!reloaded) { reloaded = true; location.reload(); } };
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.addEventListener('controllerchange', bye, { once: true });
      setTimeout(bye, 3000);
    } else bye();
  });
  const x = document.createElement('button');
  x.type = 'button'; x.className = 'hl-update-x'; x.textContent = '✕'; x.setAttribute('aria-label', '稍後再說');
  x.addEventListener('click', () => el.remove());
  el.append(msg, go, x);
  document.body.prepend(el);
}

// 選好備份檔之後再確認一次。刻意不用系統的確認視窗:
//   那種視窗只有「確定/取消」兩顆,而使用者按取消是想放棄 —— 不該讓取消去執行任何動作。
function askImportMode(file) {
  const box = document.getElementById('importAsk');
  const done = (msg) => { box.hidden = true; box.innerHTML = ''; if (msg) showUndoToast(0, msg); };

  const run = async () => {
    // 先把「正在做」講出來:原本按下去到完成之間畫面毫無變化,失敗時更是完全沒交代
    setAsk('還原中…', false);
    if (ovr) { ovr.disabled = true; ovr.querySelector('b').textContent = '還原中…'; }
    try {
      const r = await withTimeout(importBackupFile(file), 20000);
      const landing = restoreLandingDay();   // 先算好再顯示訊息(兩者要講同一天)
      done(restoreSummary(r.count));
      openPanel(landing);   // 直接翻到最後有記錄的那天 —— 停在首頁或空白的今天,都像是沒還原成功
    } catch (err) {
      // 失敗留在框裡顯示,不用 alert:alert 按掉就沒了,事後問「跳了什麼」誰也說不出來
      if (ovr) { ovr.disabled = false; ovr.querySelector('b').textContent = '再試一次'; }
      setAsk('⚠ 還原失敗:' + (err && err.message ? err.message : err), true);
    }
  };

  box.innerHTML = '';
  const name = document.createElement('p');
  name.className = 'ask-file';
  name.textContent = '📄 ' + file.name;
  const q = document.createElement('p');
  q.className = 'ask-q';
  q.textContent = '要用這份備份取代現在的資料嗎?';
  box.append(name, q);
  const setAsk = (text, warn) => { q.textContent = text; q.classList.toggle('ask-q-warn', !!warn); };

  const mk = (label, sub, cls, fn) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ask-btn' + (cls ? ' ' + cls : '');
    b.innerHTML = '<b></b><span></span>';
    b.querySelector('b').textContent = label;
    b.querySelector('span').textContent = sub;
    b.addEventListener('click', fn);
    return b;
  };

  box.append(mk('取消', '什麼都不做', 'ask-cancel', () => done('')));   // 安全的放上面,危險的放下面

  // 要按兩次才真的取代(防誤觸)。刻意「不」自動解除:
  //   本來 4 秒後會默默變回原樣 —— 但這是破壞性操作,任何人都會停下來想一下,
  //   一想就超過 4 秒;再按又只是重新進入待確認,於是怎麼按都還原不了,
  //   畫面上還沒有任何東西說明發生了什麼。確認框開著就代表這件事還在進行中,
  //   維持待確認狀態才對;要放棄有上面那顆「取消」。
  const ovr = mk('用備份取代', '現在的設定和記錄會被換掉(換錯了可以開面板按 ↩ 救回來)', 'ask-danger', () => {});
  let armed = false;
  ovr.addEventListener('click', () => {
    if (!armed) {
      armed = true; ovr.classList.add('ask-armed');
      ovr.querySelector('b').textContent = '⚠ 再按一次:確定取代';
      ovr.querySelector('span').textContent = '現在這台裝置上的資料會被換掉';
      setAsk('⚠ 還沒還原 —— 要再按一次下面那顆才會執行', true);   // 標題也改:只改按鈕的話很容易以為已經按完了
      return;
    }
    run();
  });
  box.append(ovr);
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

// 正式站以外(測試站、本機)掛一個角落標記,免得兩個站長一樣、手機上分不出正在看哪一個
const LIVE_HOST = 'waygong.github.io';
function markPreview() {
  if (location.hostname === LIVE_HOST) return;
  document.title = '🚧 ' + document.title;
  const tag = document.createElement('div');
  tag.className = 'hl-preview';
  tag.textContent = '🚧 測試站';
  document.body.appendChild(tag);
}

async function boot() {
  markPreview();
  applyStoredTheme();   // 先套用上次選的亮/暗,免得畫面閃一下
  applyStoredColor();   // 以及上次選的主題色
  await load();
  if (!status.persistent) warnNoStorage();
  seedTemplatesIfEmpty();   // 全新的裝置 → 先把推薦範本準備好,一開就能記錄

  $('#openHabit').addEventListener('click', () => openPanel());   // 包一層:直接掛 openPanel 會把 MouseEvent 當日期傳進去

  $('#btnExport').addEventListener('click', async () => {
    try { const r = await exportBackup(); if (r && r.via !== 'cancel') showUndoToast(0, '已備份'); }
    catch (e) { alert('備份失敗:' + (e && e.message ? e.message : e)); }
  });

  $('#btnImport').addEventListener('click', () => $('#fileImport').click());

  // 手動檢查更新:主畫面的 App 沒有重新整理可按,這是唯一的退路
  $('#btnUpdate').addEventListener('click', async () => {
    const btn = $('#btnUpdate');
    btn.disabled = true; btn.textContent = '檢查中…';
    const done = (msg) => { btn.disabled = false; btn.textContent = '⟳ 檢查更新'; if (msg) showUndoToast(0, msg); };
    try {
      const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      if (!reg) { done('這個瀏覽器沒有離線快取,重新整理就是最新版'); return; }
      await reg.update();
      setTimeout(() => { done(document.querySelector('.hl-update') ? '' : '已經是最新版'); }, 1800);
    } catch (e) { done('檢查失敗,晚點再試'); }
  });
  $('#fileImport').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';                                     // 清掉,才能連續選同一個檔
    if (file) askImportMode(file);
  });

  // 打字到一半就關分頁 → 把還沒寫入的補上
  window.addEventListener('pagehide', () => { try { flush(); } catch (e) {} });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { try { flush(); } catch (e) {} } });

  showVersion();                                             // 首頁角落標出版本(出問題時要先分清楚是壞了還是舊版)
  openPanel();                                               // 一開啟就直接進記錄畫面

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      let lastCheck = 0;
      const check = () => {   // 節流:切來切去不要一直發請求
        const now = Date.now();
        if (now - lastCheck < 30000) return;
        lastCheck = now;
        reg.update().catch(() => {});
      };
      check();   // 一開 App 就先問「有沒有新版」——
      //   加到主畫面的 App 沒有網址列也不能下拉重整,不主動問就可能一直停在舊版

      // 上一次就裝好、還在等著換過去的新版:這次開 App 不會再觸發 updatefound
      //   (它早就 found 過了)→ 沒有這行就完全不會提示,使用者只能自己去按「檢查更新」。
      if (reg.waiting && navigator.serviceWorker.controller) showUpdateBar();

      // 有新版被裝好時主動說一聲 —— 裝在主畫面的人不會自己去重新整理,
      //   沒有這條就得「關掉再開兩次」才會換到新版,而且完全沒有提示。
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdateBar();
        });
      });
      setInterval(check, 60 * 60 * 1000);   // 每小時問一次有沒有新版
      // 切回前景就再問一次:手機上很少把 App 真的關掉,多半只是切走再切回來 ——
      //   只靠「開啟時」和「每小時」的話,更新常常要等到下一個整點才會被發現。
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    }).catch(() => {});   // 失敗不影響功能
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
