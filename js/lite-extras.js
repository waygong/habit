// lite-extras.js — 這個 App 自己的幾個小元件(清空、全選、範本快捷、提醒、亮暗切換)。
import { state, snapshot, saveNow } from './store.js';

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
export function targetHint(habits) {
  const pend = habits.filter((h) => h.ftype === 'count' && !(h.cfg && h.cfg.target > 0));
  if (!pend.length) return null;
  const d = document.createElement('div');
  d.className = 'hl-tgthint';
  d.textContent = '還有 ' + pend.length + ' 項沒設每天的目標(顯示成 0/?):直接點那個數字就能設,設好以後每天都用這個。';
  return d;
}

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
