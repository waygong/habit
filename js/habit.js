// habit.js — 習慣:定義一次,之後每天記一筆。
//   定義(一次,像開帳):一個節點「名稱 #建習慣 型別函式 [#計入]」。例:蔬菜 #建習慣 count(6, 份) #計入
//   記錄(每天,像記一筆):「名稱:: 值」節點帶 due(預設今天)。型別/目標從定義查。
//   面板:頁籤 記錄 / 管理(建立+編輯合一)。沒習慣→預設管理、有習慣→預設記錄。
import { state, snapshot, saveNow, undo, redo, canUndo, canRedo } from './store.js';
import { revealNode } from './render.js';
import { newNode } from './model.js';
import { rerender, defStep, showUndoToast, isHidden } from './render.js';
import { localTodayYmd, nodeById, resolveTarget } from './ops.js';
import { wipeAllButton, selectAllButton, templatePicks, targetHint, clearDayButton, themeToggle, helpLink, colorPicker } from './lite-extras.js';

const HB_TGT_KEY = 'habitTargetId';        // 記錄存到哪
const HB_DEFTGT_KEY = 'habitDefTargetId';  // 習慣「定義」存到哪(建習慣用)
function hbGetTargetId() { try { return localStorage.getItem(HB_TGT_KEY) || ''; } catch (e) { return ''; } }
function hbSetTargetId(id) { try { if (id) localStorage.setItem(HB_TGT_KEY, id); else localStorage.removeItem(HB_TGT_KEY); } catch (e) {} }
function hbGetDefTargetId() { try { return localStorage.getItem(HB_DEFTGT_KEY) || ''; } catch (e) { return ''; } }
function hbSetDefTargetId(id) { try { if (id) localStorage.setItem(HB_DEFTGT_KEY, id); else localStorage.removeItem(HB_DEFTGT_KEY); } catch (e) {} }

// 自動收納家:首次存(定義/記錄)且尚未設路徑時,建「🌱 習慣 › 📋 定義 / 📓 記錄」,把定義與記錄預設分兩處,免使用者選、也不會全堆在根。
// 已被使用者手動改過路徑(該 key 有值且節點還在)→ 尊重不動。回傳「這次有沒有新建節點」(給一次性提示)。
const HB_HOME = '🌱 習慣', HB_HOME_DEF = '📋 定義', HB_HOME_REC = '📓 記錄';
const HB_HOME_TOAST = '已建立「🌱 習慣」收納:定義與記錄會自動分開存放';
function ensureHabitHome() {
  const root = state.doc.root;
  const hasDef = hbGetDefTargetId() && nodeById(root, hbGetDefTargetId());
  const hasRec = hbGetTargetId() && nodeById(root, hbGetTargetId());
  if (hasDef && hasRec) return false;
  root.children = root.children || [];
  let created = false;
  let home = root.children.find((n) => (n.text || '').trim() === HB_HOME);
  if (!home) { home = newNode(HB_HOME); root.children.push(home); created = true; }
  home.children = home.children || [];
  const sub = (label, setId) => {
    let n = home.children.find((x) => (x.text || '').trim() === label);
    if (!n) { n = newNode(label); home.children.push(n); created = true; }
    setId(n.id);
  };
  if (!hasDef) sub(HB_HOME_DEF, hbSetDefTargetId);
  if (!hasRec) sub(HB_HOME_REC, hbSetTargetId);
  return created;
}
function detachNode(node) { const rm = (n) => { n.children = (n.children || []).filter((c) => c !== node); n.children.forEach(rm); }; rm(state.doc.root); }
function recKey(text) { const i = (text || '').indexOf('::'); return (i < 0 ? (text || '') : text.slice(0, i)).replace(/\s+$/, ''); }
function afterColon(text) { const i = (text || '').indexOf('::'); return i < 0 ? '' : text.slice(i + 2); }
function recVal(text) { return afterColon(text).replace(/#[^\s#]+/g, '').replace(/\s+/g, ' ').trim(); }   // 值:去掉附加標記
function recTags(text) { return (afterColon(text).match(/#[^\s#]+/g) || []).map((t) => t.slice(1)); }       // 標籤:# 後面
function composeRec(name, val, tags) { return name + ':: ' + [val].concat((tags || []).map((t) => '#' + t)).filter(Boolean).join(' '); }
// 把某名稱的所有記錄改名接到新名(核心;不含 snapshot/save,供批次)
function renameRecordsTo(oldName, newName) {
  const walk = (n) => { const t = n.text || ''; if (n.due && t.indexOf('::') >= 0 && recKey(t) === oldName) n.text = composeRec(newName, recVal(t), recTags(t)); (n.children || []).forEach(walk); };
  (state.doc.root.children || []).forEach(walk);
}
// 找某習慣某天的記錄節點(掃全樹,靠 名稱+due;不綁位置)
function findRecord(root, name, date) {
  let found = null;
  const walk = (n) => { if (found) return; if (n.due === date && recKey(n.text) === name && (n.text || '').indexOf('::') >= 0) { found = n; return; } (n.children || []).forEach(walk); };
  (root.children || []).forEach(walk);
  return found;
}
// 設某習慣某天的值:有就改、沒有就在「目標」下建一個。空值=清掉記錄。
function setRecord(name, date, value) {
  const root = state.doc.root;
  const rec = findRecord(root, name, date);
  const v = (value == null ? '' : String(value)).trim();
  const tags = rec ? recTags(rec.text) : [];   // 改值時保留標籤
  writeRec(rec, name, date, v, tags);
}
// ── 清單型(list):一天多筆存在記錄節點的「附註」;check→markdown 勾選框、純文字→逐行 ──
function parseListNote(note, check) {
  const items = [];
  (note || '').split('\n').forEach((ln) => {
    if (check) {
      const m = ln.match(/^\s*-\s*\[( |x|X)\]\s?(.*)$/);
      if (m) items.push({ done: /x/i.test(m[1]), text: m[2].trim() });
      else if (ln.trim()) items.push({ done: false, text: ln.trim() });   // 容錯:非勾選框行也收成一項
    } else if (ln.trim()) {
      items.push({ text: ln.replace(/^\s*-\s+/, '').trim() });
    }
  });
  return items;
}
function composeListNote(items, check) {
  return items.filter((it) => (it.text || '').trim()).map((it) => (check ? '- [' + (it.done ? 'x' : ' ') + '] ' + it.text : it.text)).join('\n');
}
function listSummary(items, check) {
  const its = items.filter((it) => (it.text || '').trim());
  if (!its.length) return '';
  return check ? (its.filter((i) => i.done).length + '/' + its.length) : (its.length + ' 則');
}
// 寫清單記錄:更新附註 + 摘要值(check→已完成/總數、純文字→n 則);沒項目→刪記錄
function writeListRec(name, date, items, check) {
  const root = state.doc.root;
  let rec = findRecord(root, name, date);
  const note = composeListNote(items, check);
  const val = listSummary(items, check);
  snapshot();
  if (!note) { if (rec) detachNode(rec); saveNow(); rerender(); return; }
  const tags = rec ? recTags(rec.text) : [];
  let homed = false;
  if (rec) { rec.text = composeRec(name, val, tags); rec.note = note; }
  else { homed = ensureHabitHome(); rec = newNode(composeRec(name, val, tags), note); rec.due = date; rec.hb = true; resolveTarget(hbGetTargetId()).children.push(rec); }
  saveNow(); rerender();
  if (homed) showUndoToast(0, HB_HOME_TOAST);
}

// ── 結構化反思(五問):定義附註存「縮寫｜完整問題」提問;記錄附註存「縮寫: 答案」;完成度=已答/總題 ──
const HB_PIPE = /[|｜]/;   // 縮寫 與 完整問題 的分隔
const HB_COLON = /[:：]/;  // 縮寫 與 答案 的分隔
function parsePrompts(defNote) {
  return (defNote || '').split('\n').map((ln) => ln.trim()).filter(Boolean).map((ln) => { const i = ln.search(HB_PIPE); return i < 0 ? { key: ln, q: '' } : { key: ln.slice(0, i).trim(), q: ln.slice(i + 1).trim() }; }).filter((p) => p.key);
}
function composePrompts(rows) {
  return (rows || []).filter((r) => (r.key || '').trim()).map((r) => ((r.q || '').trim() ? r.key.trim() + '｜' + r.q.trim() : r.key.trim())).join('\n');
}
function parseAnswers(recNote) {
  const map = new Map();
  (recNote || '').split('\n').forEach((ln) => { const i = ln.search(HB_COLON); if (i > 0) { const k = ln.slice(0, i).trim(); const a = ln.slice(i + 1).trim(); if (k) map.set(k, a); } });
  return map;
}
function composeAnswers(prompts, map) {
  return prompts.filter((p) => (map.get(p.key) || '').trim()).map((p) => p.key + ': ' + map.get(p.key).trim()).join('\n');
}
// 有沒有「固定提問」→ 走結構化反思(非勾選 且 定義附註有提問)
function listPrompts(h) { return (h && !h.cfg.check) ? parsePrompts(h.node && h.node.note) : []; }
// 寫結構化反思記錄:附註存已答的「縮寫: 答案」;摘要=已答/總題;全空→刪。
function writeStructRec(name, date, prompts, map) {
  const root = state.doc.root;
  let rec = findRecord(root, name, date);
  const keys = new Set(prompts.map((p) => p.key));
  const extra = ((rec && rec.note) || '').split('\n').filter((ln) => {
    const i = ln.search(HB_COLON);
    if (i > 0 && keys.has(ln.slice(0, i).trim())) return false;   // 受管理的提問答案行 → 由 composeAnswers 重建
    return ln.trim() !== '';                                       // 其他(使用者自己加的行)→ 保留
  });
  const structured = composeAnswers(prompts, map);
  const note = [structured, extra.join('\n')].filter(Boolean).join('\n');
  const answered = prompts.filter((p) => (map.get(p.key) || '').trim()).length;
  const val = note ? (answered + '/' + prompts.length) : '';
  snapshot();
  if (!note) { if (rec) detachNode(rec); saveNow(); rerender(); return; }
  const tags = rec ? recTags(rec.text) : [];
  let homed = false;
  if (rec) { rec.text = composeRec(name, val, tags); rec.note = note; }
  else { homed = ensureHabitHome(); rec = newNode(composeRec(name, val, tags), note); rec.due = date; rec.hb = true; resolveTarget(hbGetTargetId()).children.push(rec); }
  saveNow(); rerender();
  if (homed) showUndoToast(0, HB_HOME_TOAST);
}

// 共用:寫回記錄(值+標籤都空→刪節點;沒有節點→在目標下建)
function writeRec(rec, name, date, val, tags) {
  snapshot();
  if (!val && !(tags && tags.length)) { if (rec) detachNode(rec); saveNow(); rerender(); return; }
  let homed = false;
  if (rec) rec.text = composeRec(name, val, tags);
  else { homed = ensureHabitHome(); rec = newNode(composeRec(name, val, tags)); rec.due = date; rec.hb = true; resolveTarget(hbGetTargetId()).children.push(rec); }
  saveNow(); rerender();
  if (homed) showUndoToast(0, HB_HOME_TOAST);
}

const HABIT_TAG = '建習慣';
const INCLUDE_TAG = '計入';
const HIDE_TAG = '收合';   // 習慣定義帶 #收合 → 記錄面板「截圖模式」下不顯示這項(降低高度、乾淨截圖);開「管理顯示」才列出並可切換
const MULTI_TAG = '多筆';   // select 定義帶 #多筆 → 一天可多次(每次一個窄下拉),值存「B1 B4 B3」空格分隔

// 6 型別(統一函式風格;日期沿用原生元件)
const HTYPES = [
  { id: 'count', label: '計數', syntax: 'count(目標, 單位)', hint: '每天累加到目標,可 ±' },
  { id: 'time', label: '時段', syntax: 'time()', hint: '起~迄,自動算時長' },
  { id: 'select', label: '單選', syntax: 'select(a,b,…) / select(B1:B7)', hint: '選一個(表情也用這個,選項放 emoji)' },
  { id: 'list', label: '清單', syntax: 'list() / list(勾選)', hint: '一天多筆(每天記幾則),存進附註;可勾選' },
];

// 推薦範本(去識別化通用;勾進來就是真定義,可再微調)。defaults=清單型的預設項目(五問提問/固定項目)
// 順序 = 從範本建立時的預設排列(建立時依此 index 排,不依分類):單值型在前,佔多行的清單型沉底
// 公開去識別化版(全新生活份量知識 + 版權隔離定案於 ma session,2026-09-04):數字走大眾營養常識中性單值、不烤課程階段精確表。
// note=非清單型的一句說明備註(記錄時可展開);defaults=清單型預設項(check→勾選項;五問→縮寫);optIn=範本挑選器不預設、要才加。
const HABIT_TEMPLATES = [
  { name: '😴 睡眠', ftype: 'time', cfg: {}, include: true, cat: '作息運動' },
  { name: '🥬 蔬菜', ftype: 'count', cfg: { target: 0, unit: '份', step: 1 }, include: true, cat: '飲食' },
  { name: '🍖 蛋白', ftype: 'count', cfg: { target: 0, unit: '克', step: 10 }, include: true, cat: '飲食' },
  { name: '🥑 好油脂', ftype: 'count', cfg: { target: 0, unit: '份', step: 1 }, include: true, cat: '飲食' },
  { name: '🍓 水果', ftype: 'count', cfg: { target: 0, unit: '份', step: 1 }, include: true, cat: '飲食' },
  { name: '💧 水', ftype: 'count', cfg: { target: 2000, unit: 'ml', step: 250 }, include: true, cat: '飲食' },
  { name: '🍚 低GI', ftype: 'count', cfg: { target: 0, unit: '份', step: 1 }, include: true, cat: '飲食', optIn: true },
  { name: '🏃 運動', ftype: 'count', cfg: { target: 30, unit: '分', step: 15 }, include: true, cat: '作息運動' },
  { name: '🙂 心情', ftype: 'select', cfg: { options: ['😀', '🙂', '😐', '😕', '😣'] }, include: false, cat: '身心' },   // 純 emoji:下拉窄、可與別項並排(文字說明放備註 ⓘ)
  { name: '🧻 如廁', ftype: 'select', cfg: { options: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7'], multi: true }, include: true, cat: '身心' },   // 計入:有記錄就算當天完成(每天該有一次)
  { name: '🌿 營養', ftype: 'list', cfg: { check: true }, include: true, cat: '保健' },   // 公開版免責:預填只是範例、非 app 推薦保健品
  { name: '📝 反思', ftype: 'list', cfg: {}, defaults: [], include: false, cat: '記事' },
];
// 範本分區顯示順序(沒標 cat 的歸「其他」)
const HABIT_TEMPLATE_CATS = ['飲食', '作息運動', '身心', '保健', '記事'];

// ── 解析 / 產生 ──
function parseFtype(fn) {
  const m = (fn || '').trim().match(/^([a-z]+)\s*\(([\s\S]*)\)\s*$/i);
  if (!m) return null;
  const id = m[1].toLowerCase(); const args = m[2].trim(); const cfg = {};
  if (id === 'count') { const p = args.split(',').map((s) => s.trim()); cfg.target = parseFloat(p[0]) || 0; cfg.unit = p[1] || '份'; if (p[2]) cfg.step = parseFloat(p[2]) || 1; }
  else if (id === 'select') {
    const rng = args.match(/^([^\d,]*)(\d+)\s*:\s*([^\d,]*)(\d+)$/);   // B1:B7
    if (rng) { cfg.options = []; const pre = rng[1] || rng[3] || ''; for (let i = +rng[2]; i <= +rng[4]; i++) cfg.options.push(pre + i); }
    else cfg.options = args.split(',').map((s) => s.trim()).filter(Boolean);
  }
  else if (id === 'list') { if (/勾選|check/i.test(args)) cfg.check = true; }
  return { id, cfg };
}
function formatFtype(id, cfg = {}) {
  if (id === 'count') return 'count(' + (cfg.target || 0) + ', ' + (cfg.unit || '份') + (cfg.step ? ', ' + cfg.step : '') + ')';
  if (id === 'select') return 'select(' + (cfg.options || []).join(',') + ')';
  if (id === 'list') return cfg.check ? 'list(勾選)' : 'list()';
  return id + '()';
}
function habitText(name, ftype, cfg, include) {
  return (name || '').trim() + ' #' + HABIT_TAG + ' ' + formatFtype(ftype, cfg) + (include ? ' #' + INCLUDE_TAG : '') + (cfg && cfg.multi ? ' #' + MULTI_TAG : '');
}
function parseHabit(text) {
  const t = text || ''; const tagAt = t.indexOf('#' + HABIT_TAG);
  if (tagAt < 0) return null;
  const name = t.slice(0, tagAt).trim();
  const after = t.slice(tagAt + 1 + HABIT_TAG.length);
  const fm = after.match(/([a-z]+\s*\([^)]*\))/i);
  const ft = fm ? parseFtype(fm[1]) : null;
  const cfg = ft ? ft.cfg : {};
  if ((ft ? ft.id : '') === 'select' && t.indexOf('#' + MULTI_TAG) >= 0) cfg.multi = true;   // 一天多筆
  return { name, ftype: ft ? ft.id : 'text', cfg, include: t.indexOf('#' + INCLUDE_TAG) >= 0, hidden: t.indexOf('#' + HIDE_TAG) >= 0 };
}
function listHabits(root) {
  const out = [];
  const walk = (n) => { const h = parseHabit(n.text); if (h && h.name) out.push(Object.assign({ node: n }, h)); (n.children || []).forEach(walk); };
  (root.children || []).forEach(walk);
  return out;
}

// 清單/五問的明細行(勾選項 / 五問答案 / 自由記錄各行)
function recordDetail(h, rec) {
  if (!rec) return [];
  if (h.ftype === 'list' && h.cfg.check) return parseListNote(rec.note, true).map((it) => (it.done ? '☑ ' : '☐ ') + it.text);
  if (h.ftype === 'list') {
    const prompts = listPrompts(h);
    if (prompts.length) { const map = parseAnswers(rec.note); return prompts.filter((p) => (map.get(p.key) || '').trim()).map((p) => p.key + ': ' + map.get(p.key).trim()); }
    return parseListNote(rec.note, false).map((it) => '• ' + it.text);
  }
  return [];
}
// 複製當天記錄:收集可見習慣的名稱/值/是否達標 + 明細
function recordRows() {
  const root = state.doc.root;
  return listHabits(root).filter((h) => !h.hidden).map((h) => {
    const rec = findRecord(root, h.name, _recDate);
    const val = rec ? recVal(rec.text) : '';
    let done = false;
    if (rec && val) {
      if (h.ftype === 'count') { const pm = val.match(/(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)/); done = pm ? parseFloat(pm[1]) >= parseFloat(pm[2]) : false; }
      else if (h.ftype === 'list') { const pm = val.match(/(\d+)\s*\/\s*(\d+)/); done = pm ? (pm[1] === pm[2] && +pm[2] > 0) : !!val; }
      else done = true;   // time/select 有值即算
    }
    return { name: h.name, val: val || '—', done, detail: recordDetail(h, rec) };
  });
}
function copyRecordText() {
  const rows = recordRows();
  const txt = '🌱 ' + _copyDate + '\n' + rows.map((r) => r.name + '  ' + r.val + (r.detail.length ? '\n' + r.detail.map((d) => '  ' + d).join('\n') : '')).join('\n');
  const ok = () => showUndoToast(0, '已複製記錄文字');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok).catch(() => { try { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); ok(); } catch (e) { alert(txt); } });
  else alert(txt);
}
function copyRecordImage() {
  const rows = recordRows();
  const W = 380, padX = 18, headH = 46, lineH = 28, detH = 24, padB = 16, valX = 140;
  const totalH = rows.reduce((s, r) => s + lineH + r.detail.length * detH, 0);
  const H = headH + totalH + padB, scale = 2;
  const c = document.createElement('canvas'); c.width = W * scale; c.height = H * scale;
  const ctx = c.getContext('2d'); ctx.scale(scale, scale); ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#1a7f45'; ctx.font = 'bold 19px -apple-system, system-ui, sans-serif';
  ctx.fillText('🌱 ' + _copyDate, padX, headH / 2 + 3);
  ctx.strokeStyle = '#eeeeee'; ctx.beginPath(); ctx.moveTo(0, headH); ctx.lineTo(W, headH); ctx.stroke();
  let y = headH;   // y = 目前行的「頂」;文字畫在 y + 行高/2(垂直置中)
  rows.forEach((r) => {
    ctx.font = '16px -apple-system, system-ui, sans-serif'; ctx.fillStyle = '#333333'; ctx.fillText(r.name, padX, y + lineH / 2);
    ctx.font = (r.done ? 'bold ' : '') + '16px -apple-system, system-ui, sans-serif'; ctx.fillStyle = r.done ? '#1a7f45' : '#555555'; ctx.fillText(r.val, valX, y + lineH / 2);
    y += lineH;
    r.detail.forEach((d) => { ctx.font = '13px -apple-system, system-ui, sans-serif'; ctx.fillStyle = '#888888'; ctx.fillText(d, padX + 16, y + detH / 2); y += detH; });
  });
  const dl = () => c.toBlob((blob) => { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = '習慣記錄 ' + _copyDate + '.png'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1500); showUndoToast(0, '已存成圖片檔'); }, 'image/png');
  try {
    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      const item = new ClipboardItem({ 'image/png': new Promise((res) => c.toBlob(res, 'image/png')) });
      navigator.clipboard.write([item]).then(() => showUndoToast(0, '已複製圖片')).catch(dl);
    } else dl();
  } catch (e) { dl(); }
}
// ── 面板 ──
let _tab = 'manage';   // 'record' | 'manage'
let _onClose = null;
//   只做一次 —— 標記存在 doc 裡(跟著資料走、也會被備份帶著),所以使用者刪掉的東西
//   不會下次開 App 又自己長回來;想加回來是按管理頁的「🌱 恢復範本」。
export function seedTemplatesIfEmpty() {
  if (state.doc.seeded) return false;
  state.doc.seeded = true;
  if (listHabits(state.doc.root).length) { saveNow(); return false; }   // 已經有習慣(舊使用者)→ 只補標記
  ensureHabitHome();
  const dest = resolveTarget(hbGetDefTargetId());
  HABIT_TEMPLATES.forEach((t) => {
    const n = newNode(habitText(t.name, t.ftype, t.cfg, t.include));
    if (t.defaults && t.defaults.length) n.note = t.cfg.check ? composeListNote(t.defaults.map((d) => ({ text: d.text || d.key, done: false })), true) : composePrompts(t.defaults);
    dest.children.push(n);
  });
  saveNow();
  return true;
}

export function openHabitPanel(date, onClose) {
  _onClose = onClose || null;
  let m = document.getElementById('habitPanel');
  if (!m) {
    m = document.createElement('div'); m.id = 'habitPanel'; m.hidden = true;
    m.innerHTML =
      '<div class="pm-backdrop"></div>' +
      '<div class="pm-card hb-card">' +
        '<div class="hb-head">' +
          '<div class="pm-title hb-title">🌱</div>' +   // 只留圖示:標題列要塞頁籤+↩↪+⛶+✕,拿掉「習慣」二字才不擠(下面就是記錄/管理頁籤,認得出來)
          '<div class="hb-tabs">' +
            '<button type="button" class="hb-tab" data-tab="record">記錄</button>' +
            '<button type="button" class="hb-tab" data-tab="manage">管理</button>' +
          '</div>' +
          '<button type="button" class="hb-undo" title="復原(調錯順序可救回)">↩</button>' +
          '<button type="button" class="hb-redo" title="重做">↪</button>' +
          '<button type="button" class="hb-full" title="全螢幕 / 還原">⛶</button>' +
          '<button type="button" class="hb-x" aria-label="關閉">✕</button>' +
        '</div>' +
        '<div class="hb-body"></div>' +
        '<div class="hb-foot"><button type="button" class="hb-cancel hb-copytxt">⧉ 複製文字</button><button type="button" class="hb-cancel hb-copyimg">🖼 存成圖</button><span style="flex:1"></span><button type="button" class="hb-close">關閉</button></div>' +
      '</div>';
    document.body.appendChild(m);
    const doClose = () => { m.hidden = true; const cb = _onClose; _onClose = null; if (cb) cb(); };
    m.querySelector('.pm-backdrop').addEventListener('click', doClose);
    m.querySelector('.hb-close').addEventListener('click', doClose);
    m.querySelector('.hb-x').addEventListener('click', doClose);
    m.querySelector('.hb-head').insertBefore(themeToggle(), m.querySelector('.hb-undo'));
    m.querySelector('.hb-copytxt').addEventListener('click', () => copyRecordText());
    m.querySelector('.hb-copyimg').addEventListener('click', () => copyRecordImage());
    // iOS:focus 輸入框時 visualViewport 會 pan(把游標置中),fixed 面板相對 layout viewport 就偏了。
    // 解法:讓面板貼著 visualViewport 定位(它 resize/scroll 時同步),怎麼 pan 面板都跟著、不偏。
    // 正在打字的那格捲進可見範圍:面板已貼齊 visualViewport(鍵盤一開就變矮),但捲動區不會自動把
    // 底部的欄位捲上來 → 打字時被鍵盤遮住看不到。故 focus 時 + 鍵盤高度變動時都捲一次。
    const inPanel = () => { const a = document.activeElement; return (a && m.contains(a) && a.matches && a.matches('input, select, textarea')) ? a : null; };
    const bringIntoView = (el, smooth) => { if (!el) return; try { el.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' }); } catch (e) { el.scrollIntoView(); } };
    m.addEventListener('focusin', (e) => { const el = e.target; if (el && el.matches && el.matches('input, select, textarea')) setTimeout(() => bringIntoView(el, true), 300); });   // 等鍵盤動畫跑完再捲,否則捲完又被推走
    const vv = window.visualViewport;
    if (vv) {
      const repos = () => { if (m.hidden) return; m.style.left = vv.offsetLeft + 'px'; m.style.top = vv.offsetTop + 'px'; m.style.right = 'auto'; m.style.bottom = 'auto'; m.style.width = vv.width + 'px'; m.style.height = vv.height + 'px'; setTimeout(() => bringIntoView(inPanel(), false), 0); };   // 鍵盤升起/收合改變高度後,把游標所在欄位補捲回可見處
      vv.addEventListener('resize', repos); vv.addEventListener('scroll', repos);
      m._repos = repos;
    }
    m.querySelector('.hb-full').addEventListener('click', () => m.querySelector('.hb-card').classList.toggle('hb-card--full'));   // 全螢幕/還原(方便看/截圖)
    m.querySelector('.hb-undo').addEventListener('click', () => { if (canUndo()) { undo(); rerender(); paint(m); } });   // 復原(拖曳/改名/隱藏都可救)
    m.querySelector('.hb-redo').addEventListener('click', () => { if (canRedo()) { redo(); rerender(); paint(m); } });
    m.querySelectorAll('.hb-tab').forEach((b) => b.addEventListener('click', () => {
      _tab = b.dataset.tab;
      try { sessionStorage.setItem('hl_tab', _tab); } catch (e) {}   // 只記在這次開啟期間:重新整理留在原頁,關掉再開回記錄頁
      if (_tab === 'record') _recDate = localTodayYmd();
      paint(m);
    }));   // 切到記錄一律回今天(修:切回來要再點今天才更新)
  }
  if (date) { _recDate = date; _tab = 'record'; }
  else {
    const has = listHabits(state.doc.root).length;
    let last = ''; try { last = sessionStorage.getItem('hl_tab') || ''; } catch (e) {}
    _tab = !has ? 'manage' : (last === 'manage' ? 'manage' : 'record');   // 重新整理回到剛才那一頁
    _recDate = localTodayYmd();
  }   // 沒習慣→管理、有→記錄;預設今天
  m.hidden = false; if (m._repos) m._repos(); paint(m);   // 開時先貼齊 visualViewport
}
function paint(m) {
  m.querySelectorAll('.hb-tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === _tab));
  const ub = m.querySelector('.hb-undo'), rb = m.querySelector('.hb-redo');
  if (ub) ub.disabled = !canUndo(); if (rb) rb.disabled = !canRedo();
  m.dataset.tab = _tab;
  const body = m.querySelector('.hb-body'); body.innerHTML = '';
  if (_tab === 'manage') paintManage(body, m);
  else paintRecord(body, m);
}

// ── 管理頁:清單 + 建立/編輯表單 ──
function paintManage(body, m) {
  const habits = listHabits(state.doc.root);
  const list = document.createElement('div'); list.className = 'hb-list';
  if (!habits.length) { const e = document.createElement('div'); e.className = 'hb-empty'; e.textContent = '還沒有習慣。下面「＋ 新增習慣」建一個。'; list.append(e); }
  habits.forEach((h) => {
    const row = document.createElement('div'); row.className = 'hb-itemrow'; row.__habit = h;
    const main = document.createElement('button'); main.type = 'button'; main.className = 'hb-item hb-item-main';
    main.innerHTML = '<b></b>';
    main.querySelector('b').textContent = h.name;
    main.addEventListener('click', () => showForm(body, m, h));   // 點=編輯
    const del = document.createElement('button'); del.type = 'button'; del.className = 'hb-item-del'; del.textContent = '🗑'; del.title = '刪除習慣(整個)';
    del.addEventListener('click', (e) => { e.stopPropagation(); if (!confirm('刪除習慣「' + h.name + '」?過去的記錄會一起看不到(資料還在,建一個同名的就會回來)')) return; snapshot(); detachNode(h.node); saveNow(); rerender(); paint(m); });
    row.append(main, del); list.append(row);
  });
  body.append(list);
  const add = document.createElement('button'); add.type = 'button'; add.className = 'hb-add'; add.textContent = '＋ 新增習慣';
  add.addEventListener('click', () => showForm(body, m, null));
  body.append(add);
  const tpl = document.createElement('button'); tpl.type = 'button'; tpl.className = 'hb-add'; tpl.textContent = '🌱 恢復範本';
  tpl.addEventListener('click', () => showTemplates(body, m));
  body.append(tpl);
  if (habits.length) body.append(wipeAllButton(habits.length, () => paint(m)));
  body.append(colorPicker());
}

// 推薦範本挑選:分區(飲食/運動作息/身心/生活)+ 吸底加入鈕(範本多、避免加入鈕被擠到看不見、誤以為勾了就加)
function showTemplates(body, m) {
  body.innerHTML = '';
  const have = new Set(listHabits(state.doc.root).map((h) => h.name));
  const hd = document.createElement('div'); hd.className = 'hb-syntax'; hd.textContent = '勾選要加入的,再按下方「加入勾選的」'; body.append(hd);

  const checks = [];
  const add = document.createElement('button'); add.type = 'button'; add.className = 'hb-save';
  const refreshCount = () => { const n = checks.filter((c) => c.cb.checked).length; add.textContent = n ? ('加入勾選的 (' + n + ')') : '加入勾選的'; add.disabled = !n; };

  // 依分類分組(未列在 CATS 的歸「其他」),各區加灰色小標題
  const list = document.createElement('div'); list.className = 'hb-list hb-tpllist';
  const groups = new Map(HABIT_TEMPLATE_CATS.map((c) => [c, []]));
  HABIT_TEMPLATES.forEach((t) => { const c = groups.has(t.cat) ? t.cat : '其他'; if (!groups.has(c)) groups.set(c, []); groups.get(c).push(t); });
  for (const [cat, items] of groups) {
    if (!items.length) continue;
    const ch = document.createElement('div'); ch.className = 'hb-tplcat'; ch.textContent = cat; list.append(ch);
    items.forEach((t) => {
      const exists = have.has(t.name);
      const row = document.createElement('label'); row.className = 'hb-tpl' + (exists ? ' exists' : '');
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.disabled = exists; cb.checked = !exists;
      if (!exists) { checks.push({ cb, t }); cb.addEventListener('change', refreshCount); }
      const txt = document.createElement('span'); txt.className = 'hb-tpl-txt'; txt.innerHTML = '<b></b>';
      txt.querySelector('b').textContent = t.name + (exists ? '(已建立)' : '');
      if (t.demo) { const d = document.createElement('small'); d.className = 'hb-tpl-demo'; d.textContent = t.demo; txt.appendChild(d); }   // 公開版免責:如營養「示範·自己增刪」,免得看起來像 app 在推薦
      row.append(cb, txt);
      if (!exists) {   // ✎ 加入前先改成自己的:開編輯表單(預填此範本)→ 建立;範本本身是程式常數、動不到,不必「重置」
        const ed = document.createElement('button'); ed.type = 'button'; ed.className = 'hb-tpledit'; ed.textContent = '✎ 編輯'; ed.title = '先改成你的份量/單位再建立(不影響原範本)';
        ed.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); showForm(body, m, null, { name: t.name, ftype: t.ftype, cfg: JSON.parse(JSON.stringify(t.cfg)), include: t.include, defaults: t.defaults, hint: t.note }); });
        row.append(ed);
      }
      list.append(row);
    });
  }
  body.append(list);

  const bar = document.createElement('div'); bar.className = 'hb-formbar hb-stickybar';
  const back = document.createElement('button'); back.type = 'button'; back.className = 'hb-cancel'; back.textContent = '‹ 返回'; back.addEventListener('click', () => paint(m));
  add.addEventListener('click', () => {
    const chosen = checks.filter((c) => c.cb.checked).sort((a, b) => HABIT_TEMPLATES.indexOf(a.t) - HABIT_TEMPLATES.indexOf(b.t));   // 依範本陣列順序建立(不依勾選/分區順序)→ 清單型沉底
    if (!chosen.length) return;
    snapshot();
    const homed = ensureHabitHome();
    const dest = resolveTarget(hbGetDefTargetId());
    chosen.forEach(({ t }) => { const n = newNode(habitText(t.name, t.ftype, t.cfg, t.include)); if (t.defaults && t.defaults.length) n.note = t.cfg.check ? composeListNote(t.defaults.map((d) => ({ text: d.text || d.key, done: false })), true) : composePrompts(t.defaults); else if (t.note) n.note = t.note; dest.children.push(n); });   // 範本自帶預設項目(清單)/說明備註(非清單)→寫進定義附註
    saveNow(); rerender(); paint(m);
    if (homed) showUndoToast(0, HB_HOME_TOAST);
  });
  refreshCount();
  bar.append(back, selectAllButton(checks, refreshCount), add); body.append(bar);
}

function showForm(body, m, editing, prefill, convertNode) {
  body.innerHTML = '';
  const cleanName = (t) => (t || '').replace(/#[^\s#]+/g, '').replace(/\s+/g, ' ').trim();   // 就地轉換:去掉附加標記當習慣名
  const cur = editing || prefill || (convertNode ? { name: cleanName(convertNode.text), ftype: 'count', cfg: { target: 1, unit: '份' }, include: true } : { name: '', ftype: 'count', cfg: { target: 1, unit: '份' }, include: true });
  let ftype = cur.ftype; let cfg = Object.assign({}, cur.cfg);
  // 清單型的「預設項目」:勾選清單與五問(縮寫+完整問題)各存一份、切換型態不互相破壞。存定義附註;編輯載入、複製帶入
  const dn = editing && editing.node ? editing.node.note : (convertNode ? (convertNode.note || '') : '');
  const pf = (prefill && prefill.defaults) || null;
  const curCheck = !!(cur.cfg && cur.cfg.check);
  let checkDefaults = (editing && curCheck) ? parseListNote(dn, true) : ((pf && curCheck) ? pf.map((d) => ({ text: (d.text || d.key || '').trim(), done: false })).filter((d) => d.text) : []);
  let promptDefaults = (editing && !curCheck) ? parsePrompts(dn) : ((pf && !curCheck) ? pf.map((d) => ({ key: (d.key || d.text || '').trim(), q: (d.q || '').trim() })).filter((d) => d.key) : []);
  // 非清單型:定義附註 = 一句「備註/提示」(記錄時顯示,如「1份≈90g」);不占每天額度。清單型的附註拿去放提問,故不共用
  let hintNote = ((editing && cur.ftype !== 'list') || convertNode) ? (dn || '') : ((prefill && prefill.hint) || '');

  const picksBox = document.createElement('div');
  const paintPicks = () => {
    picksBox.innerHTML = '';
    const el = templatePicks(HABIT_TEMPLATES, HABIT_TEMPLATE_CATS,
      (t) => showForm(body, m, null, { name: t.name, ftype: t.ftype, cfg: JSON.parse(JSON.stringify(t.cfg)), include: t.include, defaults: t.defaults }),
      cur.name);
    if (el) picksBox.append(el);
  };
  if (!editing && !convertNode) { body.append(picksBox); paintPicks(); }
  const nameIn = mkInput('習慣名稱', cur.name);
  body.append(field('名稱', nameIn));

  // 型別 chips
  const typeWrap = document.createElement('div'); typeWrap.className = 'hb-types';
  const cfgWrap = document.createElement('div'); cfgWrap.className = 'hb-cfg';
  const pvBox = document.createElement('div'); pvBox.className = 'hb-pvbox';
  const refreshPv = () => { pvBox.innerHTML = ''; const lbl = document.createElement('span'); lbl.className = 'hb-lbl'; lbl.textContent = '記錄時的樣子（僅預覽）'; pvBox.append(lbl, recInput({ name: '(範例)', ftype, cfg }, '', null, true)); };
  const paintCfg = () => {
    cfgWrap.innerHTML = '';
    const t = HTYPES.find((x) => x.id === ftype);
    const hint = document.createElement('div'); hint.className = 'hb-syntax'; hint.textContent = t.syntax + ' — ' + t.hint; cfgWrap.append(hint);
    if (ftype === 'count') {
      const tg = mkInput('目標', cfg.target != null ? cfg.target : 1); tg.type = 'number'; tg.addEventListener('input', () => { cfg.target = parseFloat(tg.value) || 0; refreshPv(); });
      const un = mkInput('單位', cfg.unit || '份'); un.addEventListener('input', () => { cfg.unit = un.value.trim() || '份'; refreshPv(); });
      const st = mkInput('每次 +(留空=依單位;ml=250)', cfg.step != null ? cfg.step : ''); st.type = 'number'; st.addEventListener('input', () => { const v = parseFloat(st.value); cfg.step = (v && v > 0) ? v : undefined; refreshPv(); });
      cfgWrap.append(field('目標', tg), field('單位', un), field('每次增加', st));
    } else if (ftype === 'select') {
      const op = mkInput('選項(逗號分隔;或 B1:B7)', (cfg.options || []).join(',')); op.addEventListener('input', () => { const p = parseFtype('select(' + op.value + ')'); cfg.options = p ? p.cfg.options : []; refreshPv(); });
      cfgWrap.append(field('選項', op));
      const mw = document.createElement('label'); mw.className = 'hb-inc';
      const mc = document.createElement('input'); mc.type = 'checkbox'; mc.checked = !!cfg.multi;
      mc.addEventListener('change', () => { cfg.multi = mc.checked || undefined; });
      mw.append(mc, document.createTextNode(' 一天可多次(每次一個下拉,如如廁)'));
      cfgWrap.append(mw);
    } else if (ftype === 'list') {
      const lw = document.createElement('label'); lw.className = 'hb-inc';
      const lc = document.createElement('input'); lc.type = 'checkbox'; lc.checked = !!cfg.check;
      lc.addEventListener('change', () => { cfg.check = lc.checked || undefined; paintCfg(); });   // 勾選/五問各存一份,切換只換顯示、不破壞另一份
      lw.append(lc, document.createTextNode(' 可勾選(打勾式);不勾=多行文字(可設固定提問=每日五問)'));
      cfgWrap.append(lw);
      // 預設項目:勾選→固定項目(每天帶入未勾);不勾→固定提問(縮寫+完整問題,每天答)。各自獨立
      const arr = cfg.check ? checkDefaults : promptDefaults;
      const dwrap = document.createElement('div'); dwrap.className = 'hb-field';
      const dl = document.createElement('span'); dl.className = 'hb-lbl'; dl.textContent = cfg.check ? '預設項目(每天帶入,未勾;可留空)' : '固定提問(每天要答的題;縮寫當標籤,完整問題選填。留空=自由反思)';
      const dbox = document.createElement('div'); dbox.className = 'hb-listbox';
      const renderDefaults = () => {
        dbox.innerHTML = '';
        arr.forEach((it, idx) => {
          const line = document.createElement('div'); line.className = 'hb-listline';
          if (cfg.check) {
            const tx = document.createElement('input'); tx.className = 'hb-in hb-listtext'; tx.value = it.text || ''; tx.placeholder = '項目…';
            tx.addEventListener('change', () => { it.text = tx.value.trim(); if (!it.text) arr.splice(idx, 1); renderDefaults(); });
            line.append(tx);
          } else {
            const kx = document.createElement('input'); kx.className = 'hb-in hb-qkey'; kx.value = it.key || ''; kx.placeholder = '縮寫';
            kx.addEventListener('change', () => { it.key = kx.value.trim(); if (!it.key) arr.splice(idx, 1); renderDefaults(); });
            const qx = document.createElement('input'); qx.className = 'hb-in hb-listtext'; qx.value = it.q || ''; qx.placeholder = '完整問題(選填)';
            qx.addEventListener('change', () => { it.q = qx.value.trim(); });
            line.append(kx, qx);
          }
          const del = document.createElement('button'); del.type = 'button'; del.className = 'hb-item-del'; del.textContent = '✕';
          del.addEventListener('click', () => { arr.splice(idx, 1); renderDefaults(); });
          line.append(del); dbox.append(line);
        });
        const nl = document.createElement('div'); nl.className = 'hb-listline hb-listnew';
        let added = false;
        if (cfg.check) {
          const ntx = document.createElement('input'); ntx.className = 'hb-in hb-listtext'; ntx.placeholder = '＋ 新增項目…';
          const addN = () => { if (added) return; const v = ntx.value.trim(); if (!v) return; added = true; arr.push({ text: v, done: false }); renderDefaults(); };
          ntx.addEventListener('change', addN); ntx.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addN(); } });
          nl.append(ntx);
        } else {
          const nkx = document.createElement('input'); nkx.className = 'hb-in hb-qkey'; nkx.placeholder = '＋ 縮寫';
          const nqx = document.createElement('input'); nqx.className = 'hb-in hb-listtext'; nqx.placeholder = '完整問題(選填)';
          const addN = () => { if (added) return; const k = nkx.value.trim(); if (!k) return; added = true; arr.push({ key: k, q: nqx.value.trim() }); renderDefaults(); };
          nkx.addEventListener('change', addN); nkx.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addN(); } });
          nl.append(nkx, nqx);
        }
        dbox.append(nl);
      };
      renderDefaults();
      dwrap.append(dl, dbox);
      cfgWrap.append(dwrap);
    }
    cfgWrap.append(pvBox); refreshPv();
  };
  HTYPES.forEach((t) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'hb-type' + (t.id === ftype ? ' on' : ''); b.textContent = t.label;
    b.addEventListener('click', () => { ftype = t.id; if (ftype === 'count' && cfg.target == null) { cfg = { target: 1, unit: '份' }; } if (ftype === 'select' && !cfg.options) cfg = { options: [] }; typeWrap.querySelectorAll('.hb-type').forEach((x) => x.classList.toggle('on', x === b)); paintCfg(); });
    typeWrap.append(b);
  });
  body.append(field('型別', typeWrap), cfgWrap); paintCfg();

  const inc = document.createElement('input'); inc.type = 'checkbox'; inc.checked = !!cur.include;

  // 動作
  const bar = document.createElement('div'); bar.className = 'hb-formbar';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'hb-cancel'; cancel.textContent = '‹ 返回'; cancel.addEventListener('click', () => paint(m));
  const save = document.createElement('button'); save.type = 'button'; save.className = 'hb-save'; save.textContent = editing ? '儲存' : '建立';
  save.addEventListener('click', () => {
    const nm = nameIn.value.trim(); if (!nm) { nameIn.focus(); return; }
    if (listHabits(state.doc.root).some((h) => h.name === nm && (!editing || h.node !== editing.node))) { alert('已經有同名習慣「' + nm + '」,換個名字。'); nameIn.focus(); return; }
    const oldName = editing ? editing.name : null;
    const renameRecs = [];
    if (editing && nm !== oldName) {   // 改名:連帶更新歷史記錄(rename 概念,像改標籤;可復原)
      const walk = (n) => { if ((n.text || '').indexOf('::') >= 0 && recKey(n.text) === oldName) renameRecs.push(n); (n.children || []).forEach(walk); };
      walk(state.doc.root);
      if (renameRecs.length && !confirm('把習慣「' + oldName + '」改名為「' + nm + '」\n會一併更新 ' + renameRecs.length + ' 筆歷史記錄(可復原)。繼續?')) return;
    }
    snapshot();
    renameRecs.forEach((r) => { r.text = composeRec(nm, recVal(r.text), recTags(r.text)); });   // 舊名:: → 新名::,保留值與標籤
    const txt = habitText(nm, ftype, cfg, inc.checked);
    let homed = false, node;
    if (editing) {
      if (editing.name && editing.name !== nm) renameRecordsTo(editing.name, nm);   // 改名時把過去的記錄一起改名,否則舊記錄會對不上、等於消失
      editing.node.text = txt; node = editing.node;
    }
    else if (convertNode) { convertNode.text = txt; node = convertNode; }   // 就地把節點轉成習慣定義(不搬、不建新)
    else { homed = ensureHabitHome(); node = newNode(txt); resolveTarget(hbGetDefTargetId()).children.push(node); }
    if (ftype === 'list') node.note = cfg.check ? composeListNote(checkDefaults, true) : composePrompts(promptDefaults);   // 勾選→固定項目行、多行→固定提問(縮寫｜完整);空=清掉
    else node.note = hintNote.trim();   // 非清單型:附註=備註提示
    saveNow(); rerender(); paint(m);
    if (homed) showUndoToast(0, HB_HOME_TOAST);
  });
  const del = editing ? (() => { const d = document.createElement('button'); d.type = 'button'; d.className = 'hb-del'; d.textContent = '刪除'; d.addEventListener('click', () => { if (!confirm('刪除習慣「' + cur.name + '」?過去的記錄會一起看不到(資料還在,建一個同名的就會回來)')) return; snapshot(); detachNode(editing.node); saveNow(); rerender(); paint(m); }); return d; })() : null;
  bar.append(cancel, save); if (del) bar.append(del);
  body.append(bar);
  setTimeout(() => nameIn.focus(), 0);
}

// ── 記錄頁:日期選擇 + 目標 + 習慣清單(依型別輸入)──
let _recDate = '';
let _copyDate = '';
function paintRecord(body, m) {
  const root = state.doc.root;
  const allHabits = listHabits(root);
  if (!allHabits.length) { const e = document.createElement('div'); e.className = 'hb-empty'; e.textContent = '先到「管理」建立習慣,或按「恢復範本」。'; body.append(e); return; }
  const habits = allHabits;
  _recDate = localTodayYmd();                       // 記錄一律記在今天
  if (!_copyDate) _copyDate = _recDate;
  // 頂:日期 + 今天 +(有隱藏項或正在管理時)管理顯示開關
  const top = document.createElement('div'); top.className = 'hb-rectop';
  const di = document.createElement('input'); di.type = 'date'; di.className = 'hb-in'; di.value = _copyDate;
  di.title = '這個日期只會印在「複製文字 / 存成圖」上面;記錄本身一律記在今天';
  di.addEventListener('change', () => { _copyDate = di.value || localTodayYmd(); paint(m); });
  const tdy = document.createElement('button'); tdy.type = 'button'; tdy.className = 'hb-cancel'; tdy.textContent = '今天'; tdy.addEventListener('click', () => { _copyDate = localTodayYmd(); paint(m); });
  top.append(di, tdy);
  { const note = document.createElement('span'); note.className = 'hl-datenote'; note.textContent = '這個日期只會印在複製/存圖上'; top.append(note); }
  body.append(top);
  { const th = targetHint(allHabits); if (th) body.append(th); }
  // 習慣清單(自動流式兩欄:窄型兩個一行、寬型獨佔整行;左右由順序決定,不破壞拖曳排序)
  const list = document.createElement('div'); list.className = 'hb-reclist hb-grid';
  habits.forEach((h) => {
    const rec = findRecord(root, h.name, _recDate);
    const wide = h.ftype === 'time' || h.ftype === 'list'   // 睡眠/清單/五問 → 佔整行
      || (h.ftype === 'select' && h.cfg.multi)   // 多筆下拉(如如廁)獨佔整行,放 4-5 個
      || (h.ftype === 'count' && (() => { const t = String(h.cfg.target || 0); const u = (h.cfg.unit && h.cfg.unit !== '份') ? h.cfg.unit : ''; return (t + '/' + t + u).length >= 6; })());   // 依「實際顯示的 值/目標單位」寬度判斷(如 100/100克=8、30/30分=6 → 獨佔整行,免半欄擠到值換行);短的(5/5、2/2)才並排。加了 emoji 名稱後半欄更窄,故用實寬
    const row = document.createElement('div'); row.className = 'hb-recrow' + (h.hidden ? ' hb-rowhidden' : '') + (wide ? ' hb-rowwide' : '');
    const nm = document.createElement('div'); nm.className = 'hb-recname';
    const head = document.createElement('span'); head.className = 'hb-recnamehead';   // 名稱 + ⓘ 同一行
    const nmt = document.createElement('span'); nmt.textContent = h.name; head.appendChild(nmt);
    if (rec) {
      nmt.classList.add('hb-namelink'); nmt.title = '';
      nmt.addEventListener('click', () => { m.hidden = true; const cb = _onClose; _onClose = null; if (cb) cb(); revealNode(rec.id); });
    }
    let noteHint = null;
    nm.appendChild(head);
    { const hl = helpLink(h.name); if (hl) { head.appendChild(hl.btn); row.append(hl.tip); } }   // 有固定代號的習慣:名稱旁給個「?」,點了展開說明
    if (noteHint) nm.appendChild(noteHint);
    row.append(nm);
    if (rec && wide && h.ftype !== 'count' && !(h.ftype === 'select' && h.cfg.multi)) {   // 清除鈕:count(用 − 減到 0)、多筆下拉(用下拉清)、窄型並排 都不顯示;只留 睡眠/清單/五問
      const clr = document.createElement('button'); clr.type = 'button'; clr.className = 'hb-recclr'; clr.textContent = '✕'; clr.title = '清除這筆(這天的記錄;習慣還在)';
      clr.addEventListener('click', () => { if (h.ftype === 'list' && !confirm('清除「' + h.name + '」這天的整筆記錄?')) return; setRecord(h.name, _recDate, ''); paint(m); });
      row.append(clr);
    }
    row.append(recInput(h, rec ? recVal(rec.text) : '', m, false, rec));
    list.append(row);
  });
  body.append(list);
  {
    const anyRec = allHabits.some((h) => findRecord(root, h.name, _recDate));
    const cb = clearDayButton(anyRec, () => {
      snapshot();   // 只存這一個快照 → ↩ 一次就全部回來(setRecord 內部會自己 snapshot,一項一個,按一次只退一項)
      allHabits.forEach((h) => { const rec = findRecord(root, h.name, _recDate); if (rec) detachNode(rec); });
      saveNow(); paint(m);
    });
    if (cb) body.append(cb);
  }
}
function recInput(h, val, m, preview, rec) {
  const wrap = document.createElement('span'); wrap.className = 'hb-recin' + (preview ? ' hb-pv' : '');
  const set = preview ? (() => {}) : ((v) => { setRecord(h.name, _recDate, v); paint(m); });   // preview=不存;正常存完重繪面板(修 ± 卡 0~1)
  if (h.ftype === 'count') {
    // (b) 記錄自帶「值/目標單位」→ 改定義目標不回溯汙染舊記錄。有記錄用它自己的目標,沒有才用定義現值。
    const pm = val.match(/^\s*(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)\s*(.*)$/);
    const cur = pm ? parseFloat(pm[1]) : (parseFloat(val) || 0);
    const target = pm ? parseFloat(pm[2]) : (h.cfg.target || (preview ? 3 : 0));   // 預覽:沒填目標就用個示範數字,不要在示範裡出現問號
    const unit = pm ? (pm[3] || h.cfg.unit || '份') : (h.cfg.unit || '份');
    const step = h.cfg.step || defStep(unit);
    const num = document.createElement('span'); num.className = 'hb-recnum' + (preview ? '' : ' hb-tgtedit'); if (!target) num.classList.add('hl-notgt'); num.textContent = cur + (target ? '/' + target : '/?') + (unit === '份' ? '' : unit);
    const write = (n, t) => set(Math.max(0, n) + ((t != null ? t : target) ? '/' + (t != null ? t : target) : '') + unit);   // 一律寫回「值/目標單位」;t 給值時改當天目標
    if (!preview) {   // 點數字 = 就地改「這個習慣的目標」(寫進定義,以後每天都用)
      num.title = target ? '點一下改每天的目標' : '還沒設目標 → 點一下設定(以後每天都用這個)';
      num.addEventListener('click', (e) => {
        e.stopPropagation();
        if (num.querySelector('input')) return;                    // 已經在編輯就別重來
        const inp = document.createElement('input');
        inp.type = 'number'; inp.min = '0'; inp.className = 'hl-tgtin';
        inp.value = h.cfg.target || ''; inp.placeholder = '目標';
        inp.title = '每天的目標(設定後每天都用這個);Enter 儲存,Esc 取消';
        let done = false;
        const commit = () => {
          if (done) return; done = true;
          const s = inp.value.trim(); const nt = s === '' ? 0 : parseFloat(s);
          if (isNaN(nt) || nt < 0) { paint(m); return; }
          snapshot();                                              // 可用面板右上的 ↩ 復原
          h.cfg.target = nt;
          h.node.text = habitText(h.name, h.ftype, h.cfg, h.include);
          saveNow();
          write(cur, nt);                                          // 當天記錄的目標也跟著改(內含存檔+重繪)
        };
        inp.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
          else if (ev.key === 'Escape') { done = true; paint(m); }
        });
        inp.addEventListener('blur', commit);
        num.textContent = ''; num.append(inp);
        inp.focus(); inp.select();
      });
    }
    wrap.append(chipBtn('−' + (step !== 1 ? step : ''), () => write(cur - step)), num, chipBtn('+' + (step !== 1 ? step : ''), () => write(cur + step)));
  } else if (h.ftype === 'select') {
    const opts = h.cfg.options || [];
    if (h.cfg.multi) {   // 一天多筆:每次一個窄下拉,末尾自動留一個空下拉可再加(一排放 4-5 個)
      const vals = (val || '').trim() ? val.trim().split(/\s+/) : [];
      const orow = document.createElement('div'); orow.className = 'hb-optrow hb-multisel';
      const mkSel = (cur, idx) => {
        const sel = document.createElement('select'); sel.className = 'hb-in hb-recsel hb-multi1';
        const blank = document.createElement('option'); blank.value = ''; blank.textContent = idx < vals.length ? '✕' : '＋'; sel.append(blank);
        opts.forEach((o) => { const op = document.createElement('option'); op.value = o; op.textContent = o; sel.append(op); });
        sel.value = opts.indexOf(cur) >= 0 ? cur : '';
        if (!preview) sel.addEventListener('change', () => { const arr = vals.slice(); if (idx < arr.length) { if (sel.value) arr[idx] = sel.value; else arr.splice(idx, 1); } else if (sel.value) arr.push(sel.value); set(arr.join(' ')); });
        return sel;
      };
      vals.forEach((v, i) => orow.append(mkSel(v, i)));
      if (!preview) orow.append(mkSel('', vals.length));   // 末尾空下拉 = 再加一次
      wrap.append(orow);
    } else if (opts.length > 4 || opts.some((o) => (o || '').length > 5)) {   // 選項多(>4,如心情6)或字長→原生下拉;少選項才用一點即選的 chip
      const sel = document.createElement('select'); sel.className = 'hb-in hb-recsel';
      const blank = document.createElement('option'); blank.value = ''; blank.textContent = '— 未選 —'; sel.append(blank);
      opts.forEach((o) => { const op = document.createElement('option'); op.value = o; op.textContent = o; sel.append(op); });
      sel.value = opts.indexOf(val) >= 0 ? val : '';
      sel.addEventListener('change', () => set(sel.value));
      wrap.append(sel);
    } else {
      const orow = document.createElement('div'); orow.className = 'hb-optrow';   // 少選項:一點即選的 chip;橫向不換行(內容短通常不溢出)
      opts.forEach((o) => { const on = val === o; orow.append(chipBtn(o, () => set(on ? '' : o), on)); });
      wrap.append(orow);
    }
  } else if (h.ftype === 'time') {
    const mt = val.match(/(\d{1,2}:\d{2})\s*[~～]\s*(\d{1,2}:\d{2})/);
    const pv = preview ? ['23:30', '07:00'] : null;   // 預覽:給一組示範時間,才看得出「起~迄 + 自動算時長」的樣子
    const t1 = timeInput(pv ? pv[0] : (mt && mt[1])), t2 = timeInput(pv ? pv[1] : (mt && mt[2]));
    const dur = document.createElement('span'); dur.className = 'fpick-dur';
    if (pv) dur.textContent = durText(pv[0], pv[1]); else if (mt) dur.textContent = durText(mt[1], mt[2]);
    // 只存值 + 就地更新時長,不 paint(m) 重建面板(否則正在互動的時間選擇器會被砍掉→「選完就關閉」)
    const u = () => { if (!(t1.value && t2.value)) return; dur.textContent = durText(t1.value, t2.value); if (!preview) setRecord(h.name, _recDate, t1.value + '~' + t2.value + ' (' + durText(t1.value, t2.value) + ')'); };
    t1.addEventListener('change', u); t2.addEventListener('change', u);
    const sp = document.createElement('span'); sp.className = 'fpick-sep'; sp.textContent = '~';
    wrap.append(t1, sp, t2, dur);
  } else if (h.ftype === 'date') {
    const d = document.createElement('input'); d.type = 'date'; d.className = 'hb-in'; d.value = val; d.addEventListener('change', () => set(d.value)); wrap.append(d);
  } else if (h.ftype === 'check') {
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = /✓/.test(val) || /^\[v\]/i.test(val);
    const desc = document.createElement('input'); desc.className = 'hb-in hb-recdesc'; desc.placeholder = '描述(選填)'; desc.value = val.replace(/^\s*(✓|\[v\])\s*/i, '');
    const u = () => set((cb.checked ? '✓ ' : '') + desc.value.trim());
    cb.addEventListener('change', u); desc.addEventListener('change', u);
    wrap.append(cb, desc);
  } else if (h.ftype === 'list' && listPrompts(h).length) {
    // 結構化反思(五問):已答→精簡文字行(點=改成輸入編輯);未答→收進「＋ 填五問(N 題)」,點才展開。
    // 目的:填過的日子只剩答案、超短,自己截圖也截得下(五問墊在最底、最容易被切)。
    const prompts = listPrompts(h);
    const map = parseAnswers(rec && rec.note);
    const box = document.createElement('div'); box.className = 'hb-listbox';
    const commit = () => { writeStructRec(h.name, _recDate, prompts, map); paint(m); };
    const mkInput = (p) => { const tx = document.createElement('input'); tx.className = 'hb-in hb-listtext'; tx.value = map.get(p.key) || ''; tx.placeholder = p.q || ('回答「' + p.key + '」…'); tx.addEventListener('change', () => { const v = tx.value.trim(); if (v) map.set(p.key, v); else map.delete(p.key); commit(); }); return tx; };
    const mkLine = (p, asInput) => {
      const line = document.createElement('div'); line.className = 'hb-listline';
      const lbl = document.createElement('span'); lbl.className = 'hb-qlabel'; lbl.textContent = p.key; if (p.q) lbl.title = p.q;
      line.append(lbl);
      const ans = (map.get(p.key) || '').trim();
      if (ans && !asInput) { const txt = document.createElement('span'); txt.className = 'hb-qanstext'; txt.textContent = ans; txt.title = '點=編輯'; txt.addEventListener('click', () => { const inp = mkInput(p); line.replaceChild(inp, txt); inp.focus(); }); line.append(txt); }
      else line.append(mkInput(p));
      return line;
    };
    const answered = prompts.filter((p) => (map.get(p.key) || '').trim());
    const empty = prompts.filter((p) => !(map.get(p.key) || '').trim());
    answered.forEach((p) => box.append(mkLine(p, false)));   // 已答:精簡文字
    if (empty.length) {   // 未答:預設收合成一顆鈕,點開才是輸入框 → 記錄頁維持矮
      const more = document.createElement('button'); more.type = 'button'; more.className = 'hb-qmore';
      const eb = document.createElement('div'); eb.className = 'hb-qempty'; eb.hidden = true;
      empty.forEach((p) => eb.append(mkLine(p, true)));
      const sync = () => { more.textContent = (eb.hidden ? '＋ 填五問(還有 ' : '– 收起(') + empty.length + ' 題未答)'; };
      more.addEventListener('click', () => { eb.hidden = !eb.hidden; sync(); }); sync();
      box.append(more, eb);
    }
    wrap.append(box);
  } else if (h.ftype === 'list' && h.cfg.check) {
    // 勾選清單:橫向一排「縱向卡」(勾選框在上、文字直書往下)→ 截圖上緣一排勾選框、一眼看幾個勾;不像每項一列那樣佔高度
    const items = preview
      ? [{ text: '項目一', done: true }, { text: '項目二', done: false }, { text: '項目三', done: true }]
      : (rec ? parseListNote(rec.note, true) : parseListNote(h.node && h.node.note, true).map((it) => ({ text: it.text, done: false })));
    const box = document.createElement('div'); box.className = 'hb-listbox hb-vlist';
    const commit = () => { writeListRec(h.name, _recDate, items, true); paint(m); };
    items.forEach((it, idx) => {
      const chip = document.createElement('div'); chip.className = 'hb-vchip' + (it.done ? ' on' : '');
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!it.done;
      if (!preview) cb.addEventListener('change', () => { it.done = cb.checked; commit(); });
      const tx = document.createElement('span'); tx.className = 'hb-vtext'; tx.textContent = it.text; tx.title = '點文字=改名 / 清空=刪';
      if (!preview) tx.addEventListener('click', () => { const nv = prompt('項目名稱(清空=刪這項)', it.text); if (nv == null) return; const s = nv.trim(); if (!s) items.splice(idx, 1); else it.text = s; commit(); });
      chip.append(cb, tx); box.append(chip);
    });
    if (!preview) {   // 末尾「＋」加項
      const add = document.createElement('button'); add.type = 'button'; add.className = 'hb-vchip hb-vadd'; add.textContent = '＋'; add.title = '新增項目';
      add.addEventListener('click', () => { const v = prompt('新增項目'); if (v && v.trim()) { items.push({ done: false, text: v.trim() }); commit(); } });
      box.append(add);
    }
    wrap.append(box);
  } else if (h.ftype === 'list') {
    // 自由記錄(反思等,非勾選):每項一列 input,可即時打字
    const items = preview
      ? [{ text: '寫一則…' }]
      : (rec ? parseListNote(rec.note, false) : parseListNote(h.node && h.node.note, false).map((it) => ({ text: it.text })));
    const box = document.createElement('div'); box.className = 'hb-listbox';
    const commit = () => { writeListRec(h.name, _recDate, items, false); paint(m); };
    items.forEach((it, idx) => {
      const line = document.createElement('div'); line.className = 'hb-listline';
      const tx = document.createElement('input'); tx.className = 'hb-in hb-listtext'; tx.value = it.text; tx.placeholder = '記一則…';
      if (!preview) tx.addEventListener('change', () => { it.text = tx.value.trim(); if (!it.text) items.splice(idx, 1); commit(); });
      const del = document.createElement('button'); del.type = 'button'; del.className = 'hb-item-del'; del.textContent = '✕'; del.title = '刪這項';
      if (!preview) del.addEventListener('click', () => { items.splice(idx, 1); commit(); });
      line.append(tx, del); box.append(line);
    });
    if (!preview) {
      const line = document.createElement('div'); line.className = 'hb-listline hb-listnew';
      const tx = document.createElement('input'); tx.className = 'hb-in hb-listtext'; tx.placeholder = '＋ 新增一則…';
      let added = false;
      const addNew = () => { if (added) return; const v = tx.value.trim(); if (!v) return; added = true; items.push({ text: v }); commit(); };
      tx.addEventListener('change', addNew);
      tx.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addNew(); } });
      line.append(tx); box.append(line);
    }
    wrap.append(box);
  } else {
    const t = document.createElement('input'); t.className = 'hb-in'; t.value = val; t.placeholder = '…'; t.addEventListener('change', () => set(t.value.trim())); wrap.append(t);
  }
  return wrap;
}

function chipBtn(label, fn, on) { const b = document.createElement('button'); b.type = 'button'; b.className = 'hb-recchip' + (on ? ' on' : ''); b.textContent = label; b.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); return b; }
function timeInput(v) { const i = document.createElement('input'); i.type = 'time'; i.className = 'fpick-t'; i.value = v || ''; return i; }
function durText(a, b) { const [ah, am] = a.split(':').map(Number), [bh, bm] = b.split(':').map(Number); let mins = (bh * 60 + bm) - (ah * 60 + am); if (mins < 0) mins += 1440; const h = Math.floor(mins / 60), mm = mins % 60; return (h ? h + 'h' : '') + (mm ? mm + 'm' : '') || '0m'; }

function field(label, el) { const w = document.createElement('div'); w.className = 'hb-field'; const l = document.createElement('label'); l.className = 'hb-lbl'; l.textContent = label; w.append(l, el); return w; }
function mkInput(ph, val) { const i = document.createElement('input'); i.className = 'hb-in'; i.placeholder = ph; if (val != null) i.value = val; return i; }
