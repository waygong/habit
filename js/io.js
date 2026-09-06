// io.js — 備份:整份資料存成 .json、以及從 .json 匯入還原。
import { state, saveNow } from './store.js';
import { uid } from './model.js';
import { localTodayYmd } from './ops.js';

const isMobileLike = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));

function stamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return localTodayYmd() + '-' + p(d.getHours()) + p(d.getMinutes());
}

// 手機優先走「分享」(可以存到檔案 App / iCloud / 傳給自己),桌機直接下載。
async function shareOrDownload(text, filename, mime = 'application/json') {
  if (isMobileLike() && navigator.canShare) {
    try {
      const file = new File([text], filename, { type: mime });
      if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: filename }); return { via: 'share' }; }
    } catch (e) { if (e && e.name === 'AbortError') return { via: 'cancel' }; }
  }
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { via: 'download' };
}

function backupJSONText() {
  return JSON.stringify(state.doc, null, 2);
}

export async function exportBackup() {
  return shareOrDownload(backupJSONText(), 'habit-' + stamp() + '.json');
}

// 匯入時重發撞號的 id,避免合併後兩個節點同 id。
function reidUnique(node, used) {
  if (!node.id || used.has(node.id)) node.id = uid();
  used.add(node.id);
  (node.children || []).forEach((c) => reidUnique(c, used));
}

function countNodes(n) { return 1 + (n.children || []).reduce((s, c) => s + countNodes(c), 0); }

// 備份檔的形狀:{root:{...}},或直接是一個節點物件。
function normalize(data) {
  if (!data || typeof data !== 'object') return null;
  const root = data.root || (Array.isArray(data.children) ? data : null);
  if (!root || !Array.isArray(root.children)) return null;
  return root;
}

// 還原 = 用備份取代現在的資料。
//   刻意沒有「合併」:這裡只有一份習慣清單,把兩份疊起來只會變成重複的習慣
//   和讀不到的殘留記錄(同名同日期會有兩筆,只認得到其中一筆)。
async function importBackupText(txt) {
  let data;
  try { data = JSON.parse(txt); } catch (e) { throw new Error('不是有效的 JSON 備份檔'); }
  const incoming = normalize(data);
  if (!incoming) throw new Error('備份檔結構不符(找不到 root)');
  reidUnique(incoming, new Set());
  state.doc.root = incoming;
  await saveNow();
  return { count: countNodes(incoming) };
}

export function importBackupFile(file) {
  return file.text().then((txt) => importBackupText(txt));
}
