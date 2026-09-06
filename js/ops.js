// ops.js — 資料樹的小工具:找節點、算今天的日期。
import { state } from './store.js';

function pathTo(root, id) {
  const stack = [];
  function walk(node) {
    stack.push(node);
    if (node.id === id) return true;
    for (const c of (node.children || [])) { if (walk(c)) return true; }
    stack.pop();
    return false;
  }
  return walk(root) ? stack : null;
}

export function nodeById(root, id) {
  if (!id || id === root.id) return root;
  const p = pathTo(root, id);
  return p ? p[p.length - 1] : null;
}

// 本機今天 → YYYY-MM-DD(用本地時區,不用 UTC:跨日才不會差一天)
export function localTodayYmd() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// 存放位置是固定的,所以只要「把記住的 id 換成節點」這件事;找不到就退回根
export function resolveTarget(id) {
  const root = state.doc.root;
  return (id && nodeById(root, id)) || root;
}
