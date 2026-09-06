// store.js — 記憶體中的資料 + 存檔 + 復原/重做。
import { getDoc, putDoc } from './db.js';
import { newDoc } from './model.js';

export const state = { doc: null, zoomId: null };

// persistent=false 代表這台裝置存不了(無痕模式、瀏覽器擋了網站資料…)。
// 這時 App 照樣能用,但關掉就沒了 —— 由 main.js 顯示警告,別讓人白記一場。
export const status = { persistent: true };

// IndexedDB 被擋住時,open() 有可能「不成功也不失敗」,promise 永遠不 resolve
// (實測:無痕/受限環境會這樣)。純 try/catch 救不到,一定要配逾時,否則整個 App 卡在啟動。
function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('資料庫沒有回應')), ms))]);
}

export async function load() {
  try { state.doc = await withTimeout(getDoc(), 3000); }
  catch (e) { state.doc = null; status.persistent = false; }
  if (!state.doc) {
    state.doc = newDoc();
    try { await withTimeout(putDoc(state.doc), 3000); } catch (e) { status.persistent = false; }
  }
  return state.doc;
}

let timer = null;
let pending = false;

// ── 復原 / 重做(快照式)──────────────────────────────
const undoStack = [];
const redoStack = [];
const UNDO_MAX = 60;
export function snapshot() {
  undoStack.push(JSON.stringify(state.doc));
  if (undoStack.length > UNDO_MAX) undoStack.shift();
  redoStack.length = 0;
}
export function canUndo() { return undoStack.length > 0; }
export function canRedo() { return redoStack.length > 0; }
export function undo() {
  if (!undoStack.length) return false;
  redoStack.push(JSON.stringify(state.doc));
  state.doc = JSON.parse(undoStack.pop());
  saveNow();
  return true;
}
export function redo() {
  if (!redoStack.length) return false;
  undoStack.push(JSON.stringify(state.doc));
  state.doc = JSON.parse(redoStack.pop());
  saveNow();
  return true;
}

export function saveNow() {
  clearTimeout(timer);
  pending = false;
  state.doc.updatedAt = new Date().toISOString();
  if (!status.persistent) return Promise.resolve();   // 存不了就別一直發沒人回應的請求(會越積越多)
  return putDoc(state.doc).catch((err) => { console.error('存檔失敗', err); });
}

// 頁面即將關閉時把還沒寫入的補上
export function flush() { if (pending) return saveNow(); }
