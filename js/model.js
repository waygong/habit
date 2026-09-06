// model.js — 巢狀資料模型(children 陣列;樹本身就是唯一真相,無平行清單)。
const rand = (n = 8) => Math.random().toString(36).slice(2, 2 + n);
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'u-' + rand(10));

export function newNode(text = '', note = '') {
  return { id: uid(), text, note, collapsed: false, children: [] };
}

export function newDoc() {
  return {
    v: 1,
    updatedAt: new Date().toISOString(),
    deviceId: 'dev-' + rand(6),   // 這台裝置識別(Phase 2 衝突處理用);存在 doc 內,不碰 localStorage
    root: newNode(''),            // root 當「家」容器:它的 children 才是頂層節點
  };
}
