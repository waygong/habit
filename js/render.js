// render.js — habit.js 會用到的幾個小工具。
//   面板自己會重畫,所以其中兩個是空的,只是把介面補齊。

export function rerender() {}                      // 資料改完的鉤子;面板每次動作後自己會重畫
export function revealNode() {}                    // 沒有可以跳過去的地方
export function isHidden() { return false; }       // 沒有「隱藏中」的項目

// 計數型的 +/− 每次跳多少:毫升/cc 跳 250、克跳 20、其餘跳 1
export function defStep(u) { return (u === 'ml' || u === 'cc') ? 250 : (u === 'g' || u === '克') ? 20 : 1; }

// 畫面底部的短暫提示(已複製 / 已存圖 / 已自動收納…)
let _toastTimer = null;
export function showUndoToast(count, label) {
  let t = document.getElementById('undotoast');
  if (!t) {
    t = document.createElement('div'); t.id = 'undotoast';
    t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite');
    document.body.appendChild(t);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => { if (!t.hidden) positionToast(t); });
      window.visualViewport.addEventListener('scroll', () => { if (!t.hidden) positionToast(t); });
    }
  }
  const hide = () => { t.hidden = true; if (_toastTimer) clearTimeout(_toastTimer); };
  t.innerHTML = '';
  const msg = document.createElement('span'); msg.className = 'ut-msg';
  msg.textContent = label || '已完成';
  const x = document.createElement('button'); x.type = 'button'; x.className = 'ut-x'; x.textContent = '✕'; x.setAttribute('aria-label', '關閉');
  x.addEventListener('click', hide);
  t.append(msg, x);
  positionToast(t);
  t.hidden = false;
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(hide, 3500);
}
function positionToast(t) {
  const vv = window.visualViewport;
  const gap = vv ? (window.innerHeight - (vv.height + vv.offsetTop)) : 0;   // 鍵盤打開時貼在鍵盤上方
  t.style.bottom = (Math.max(0, gap) + 14) + 'px';
}
