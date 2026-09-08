// lite-extras.js — 這個 App 自己的幾個小元件(清空、全選、範本快捷、提醒、亮暗切換)。
import { state, snapshot, saveNow } from './store.js';
import { showUndoToast } from './render.js';

// 危險動作的兩段式確認:第一下把按鈕變成警告字樣,第二下才真的做;4 秒沒動作就自己取消。
//   比系統的確認視窗好 —— 不會跳出像錯誤訊息的東西,手機上也少一次打斷。
function arm(btn, idle, warn, run) {
  let armed = false, timer = null;
  const reset = () => { armed = false; btn.classList.remove('hl-armed'); btn.textContent = idle; if (timer) clearTimeout(timer); };
  btn.addEventListener('click', () => {
    if (!armed) {
      armed = true; btn.classList.add('hl-armed'); btn.textContent = warn;
      timer = setTimeout(reset, 4000);
      return;
    }
    reset();
    run();
  });
}

// 管理頁底部:一鍵清空(會先存快照,面板右上的 ↩ 還能救回來)
export function wipeAllButton(count, after) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'hb-add hl-wipe';
  b.textContent = '🗑 全部刪除';
  arm(b, '🗑 全部刪除', '⚠ 再按一次:刪掉全部 ' + count + ' 個習慣', () => {
    snapshot();                      // 刪完還沒關掉面板前,可以按右上的「↩」救回來
    state.doc.root.children = [];
    saveNow();
    if (after) after();
  });
  return b;
}

// 範本挑選頁:全部勾起來 / 全部取消(範本不多,想全裝的人不必一個一個點)
export function selectAllButton(checks, refreshCount) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'hb-cancel hl-selall';
  const allOn = () => checks.length > 0 && checks.every((c) => c.cb.checked);
  const sync = () => { b.textContent = allOn() ? '☐ 全部取消' : '☑ 全部勾選'; };
  b.addEventListener('click', () => {
    const on = !allOn();
    checks.forEach((c) => { c.cb.checked = on; });
    refreshCount();   // 程式改 .checked 不會觸發 change,得自己更新「加入勾選的 (n)」
    sync();
  });
  checks.forEach((c) => c.cb.addEventListener('change', sync));   // 手動勾/取消時,按鈕字樣也跟著換
  sync();
  return b;
}

// 新增習慣頁的頂部:依分類列出現有範本,點一下把整組設定帶進下面的表單再改。
//   比從空白開始好懂(直接看到「蔬菜 = 每天幾份」長怎樣),也省得自己想要填什麼。
export function templatePicks(templates, cats, onPick, activeName) {
  const wrap = document.createElement('div');
  wrap.className = 'hl-picks';

  const hint = document.createElement('div');
  hint.className = 'hb-syntax';
  hint.textContent = '點一下帶入相近的範本,再改成自己的';
  wrap.append(hint);

  const groups = new Map((cats || []).map((c) => [c, []]));
  templates.forEach((t) => {
    const c = groups.has(t.cat) ? t.cat : '其他';
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(t);
  });

  for (const [cat, items] of groups) {
    if (!items.length) continue;
    const row = document.createElement('div');
    row.className = 'hl-pickrow';
    const lbl = document.createElement('span');
    lbl.className = 'hl-pickcat';
    lbl.textContent = cat;
    row.append(lbl);
    items.forEach((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hl-pick' + (t.name === activeName ? ' on' : '');
      b.textContent = t.name;
      b.addEventListener('click', () => onPick(t));
      row.append(b);
    });
    wrap.append(row);
  }
  return wrap;
}

// 記錄頁頂端:提醒還沒設目標的項目(範本刻意把目標留空,要使用者自己填適合的量)
// 記錄頁底部:清空這天記的東西(習慣本身不動),給「想重來一次」用。
export function clearDayButton(hasAny, onClear) {
  if (!hasAny) return null;   // 這天還沒記東西就不用出現
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'hb-cancel hl-clearday';
  b.textContent = '🧹 清空記錄';
  arm(b, '🧹 清空記錄', '⚠ 再按一次:清掉今天記的', onClear);
  return b;
}

// 亮/暗切換。CSS 的顏色是三段式:沒指定就跟系統走,指定了就以指定的為準。
const THEME_KEY = 'hl_theme';
const readTheme = () => { try { return localStorage.getItem(THEME_KEY) || ''; } catch (e) { return ''; } };
const systemDark = () => { try { return matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; } };

// 啟動時先套用上次選的,避免畫面先閃一下別的顏色
export function applyStoredTheme() {
  const v = readTheme();
  if (v) document.documentElement.setAttribute('data-theme', v);
}

export function themeToggle() {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'hl-theme';
  const isDark = () => (readTheme() ? readTheme() === 'dark' : systemDark());
  const sync = () => { b.textContent = isDark() ? '☀' : '☾'; b.title = isDark() ? '切成亮色' : '切成暗色'; b.setAttribute('aria-label', b.title); };
  b.addEventListener('click', () => {
    const v = isDark() ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, v); } catch (e) {}
    document.documentElement.setAttribute('data-theme', v);
    sync();
  });
  sync();
  return b;
}

// 少數習慣用的是有固定代號的量表 → 名稱旁給一個「?」,點了就地展開一行說明。
//   刻意不連到外部網站:一來會把人帶離 App、離線就看不到,二來外站的標題和圖片不受我們控制。
//   形容一律用中性的形狀詞(不用食物比喻)—— 同一頁上面就是飲食項目。
// ── 主題色 ────────────────────────────────────────────
//   整份樣式的重點色都走 --c-4 這個變數,所以換色只要改它一個。
const COLOR_KEY = 'hl_color';
// [暗色用的鮮色, 亮色用的深色, 名稱, 圖示檔名]
//   門檻是 3:1(這裡用到主題色的都是大字/粗體/框線),硬拉到 4.5 反而把橘逗成土色或血紅。
//   同一個色相在兩種底色下要不同深淺:鮮色在白底會太淡(量過,對比只有 2.1~2.8),
//   深色在黑底又太悶。所以兩個都給,CSS 自己依主題挑。
//   色相刻意拉開(30/125/205/268/335 度 + 一個中性灰),原本橘綠青藍紫全擠在 139~246 度,
//   相鄰只差 34~41 度,小色塊上根本分不出來。每個色的深淺也調到「視覺重量一致」:
//   暗底對比都約 7、白底對比都約 4.5,不會有某個特別跳或特別悶。
const COLORS = [
  ['#db8f43', '#d97706', '橘', 'orange'],
  ['#25c132', '#188b22', '綠', 'green'],
  ['#58a7df', '#227dbf', '藍', 'blue'],
  ['#b78be9', '#873cdd', '紫', 'purple'],
  ['#e77eaa', '#da2f76', '粉', 'pink'],
  ['#9aa8b8', '#4d5c6e', '灰', 'slate'],
];
const readColor = () => { try { return localStorage.getItem(COLOR_KEY) || ''; } catch (e) { return ''; } };

function paintColor(v) {
  const hit = COLORS.find(([hex]) => hex === v) || COLORS[0];
  const root = document.documentElement.style;
  root.setProperty('--c-4-dark', hit[0]);    // 兩個都設,亮/暗由 CSS 自己挑
  root.setProperty('--c-4-light', hit[1]);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', hit[0]);   // 狀態列顏色(Android 會跟著變)
  paintFavicon(hit[0]);
  paintAppIcon(hit[0]);
}

// 加到主畫面用的圖示:指到對應顏色的實體檔。
//   已經裝在主畫面上的不會跟著變(iOS 是安裝當下抓一次就固定),要換得移除圖示重新加入一次。
function paintAppIcon(color) {
  const hit = COLORS.find(([hex]) => hex === color) || COLORS[0];
  const href = 'icons/icon-' + hit[3] + '.png';
  document.querySelectorAll('link[rel="apple-touch-icon"]').forEach((l) => { l.href = href; });
}

// 分頁與書籤上的小圖示:當場畫一個,才能跟著主題色換。
//   (加到主畫面的那個圖示不吃這套 —— 它是安裝當下抓 manifest 裡的檔案,裝好就固定了。)
function paintFavicon(color) {
  try {
    const S = 64, c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d');
    if (!x || !x.roundRect) return;                       // 太舊的瀏覽器就維持原本的圖示
    x.fillStyle = color;
    x.beginPath(); x.roundRect(0, 0, S, S, 14); x.fill();
    x.fillStyle = '#ffffff';
    x.beginPath(); x.roundRect(30, 29, 4.5, 21, 2); x.fill();          // 莖
    const leaf = (cx, cy, rx, ry, rot) => {                             // 兩片葉
      x.save(); x.translate(cx, cy); x.rotate(rot);
      x.beginPath(); x.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); x.fill(); x.restore();
    };
    leaf(24, 29, 9.5, 5, -0.55);
    leaf(41, 31.5, 9.5, 5, 0.55);
    let link = document.querySelector('link[rel="icon"]');
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
    link.type = 'image/png';
    link.href = c.toDataURL('image/png');
  } catch (e) {}
}

// 啟動時套用上次選的顏色
export function applyStoredColor() { paintColor(readColor()); }

// 從主畫面開啟時,提醒一次「桌面圖示不會跟著換」——
//   圖示是加入主畫面的當下抓走的,之後網頁再怎麼改都動不到它(這是系統限制,不是漏做)。
let _iconNoted = false;
function noteIconFixed() {
  if (_iconNoted) return;
  let standalone = false;
  try {
    standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  } catch (e) {}
  if (!standalone) return;
  _iconNoted = true;
  showUndoToast(0, '桌面圖示不會跟著換色,要把圖示移除再加一次主畫面');
}

// 管理頁底部:一排小色塊
export function colorPicker() {
  const wrap = document.createElement('div');
  wrap.className = 'hl-colors';
  const lbl = document.createElement('span');
  lbl.className = 'hl-colors-lbl';
  lbl.textContent = '主題色';
  wrap.append(lbl);

  const cur = () => readColor() || COLORS[0][0];
  const dots = [];
  COLORS.forEach(([hex, deep, name]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'hl-dot';
    b.style.background = hex;
    b.style.setProperty('--dot-deep', deep);
    b.title = name;
    b.setAttribute('aria-label', name);
    b.addEventListener('click', () => {
      try { localStorage.setItem(COLOR_KEY, hex); } catch (e) {}
      paintColor(hex);
      dots.forEach(([d, h]) => d.classList.toggle('on', h === hex));
      noteIconFixed();
    });
    dots.push([b, hex]);
    wrap.append(b);
  });
  dots.forEach(([d, h]) => d.classList.toggle('on', h === cur()));
  return wrap;
}
