'use strict';

/* ============================================================
   FoldSys 通用折叠系统
   ------------------------------------------------------------
   解决：页面模块多且拥挤 → 大部分模块默认收起成一条细栏，
   点标题即展开；收起时仍显示关键摘要，不丢信息。

   结构约定（index.html 中手工包裹）：
   <div class="fold-sec" id="foldXxx" data-fold data-def="closed"
        data-sub="静态副标题" data-sum-from="#sel">
     <div class="fold-head" onclick="FoldSys.toggle('foldXxx')">
       <span class="fold-arrow">▸</span>
       <span class="fold-title">模块名</span>
       <span class="fold-sum">…</span>
       <button onclick="event.stopPropagation();xxx()">⟳</button>
     </div>
     <div class="fold-body"><div class="fold-inner">
       …原有模块内容（保持原id/类名，不影响既有JS渲染）…
     </div></div>
   </div>

   - data-def="closed" 默认收起（未操作过时）
   - 状态记忆 localStorage('fold_state_v1')
   - data-sum-from 收起时显示的动态摘要（MutationObserver 轻量监听）
   - FoldSys.toggleAll(true/false) 一键全展/全收
   ============================================================ */

var FoldSys = (function() {
  var LS_KEY = 'fold_state_v1';
  var _state = {};
  try { _state = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { _state = {}; }

  function _save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(_state)); } catch (e) {}
  }

  function _secs() {
    return Array.prototype.slice.call(document.querySelectorAll('.fold-sec[data-fold]'));
  }

  function _apply(el, open) {
    el.classList.toggle('fold-closed', !open);
    el.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (el.id) _state[el.id] = !!open;
  }

  /** 收起状态显示的摘要：优先动态来源，否则静态副标题 */
  function _refreshSum(el) {
    var sumEl = el.querySelector('.fold-sum');
    if (!sumEl) return;
    var txt = '';
    var from = el.getAttribute('data-sum-from');
    if (from) {
      try {
        var src = el.querySelector(from);
        if (src) txt = (src.textContent || '').trim().replace(/\s+/g, ' ');
      } catch (e) {}
    }
    if (!txt) txt = el.getAttribute('data-sub') || '';
    sumEl.textContent = txt.length > 44 ? txt.slice(0, 44) + '…' : txt;
    sumEl.title = txt;
  }

  /** 单个模块展开/收起 */
  function toggle(id) {
    var el = document.getElementById(id);
    if (!el || !el.hasAttribute('data-fold')) return;
    _apply(el, el.classList.contains('fold-closed'));
    _save();
    _syncAllBtn();
  }

  /** 一键全展/全收（exceptId 对应模块不受影响，如仪表盘本身保持展开） */
  function toggleAll(open, exceptId) {
    _secs().forEach(function(el) {
      if (exceptId && el.id === exceptId) return;
      _apply(el, open);
    });
    _save();
    _syncAllBtn();
  }

  /** 更新「展开全部/收起全部」按钮文案 */
  function _syncAllBtn() {
    var btn = document.getElementById('foldAllBtn');
    if (!btn) return;
    var all = _secs().filter(function(el) { return el.id !== 'foldDash'; });
    var anyClosed = all.some(function(el) { return el.classList.contains('fold-closed'); });
    btn.textContent = anyClosed ? '展开全部 ▾' : '收起全部 ▴';
    btn.setAttribute('aria-label', anyClosed ? '展开全部模块' : '收起全部模块');
  }

  /** 一键按钮入口：有收起的就全展，否则全收 */
  function toggleAllSmart() {
    var all = _secs().filter(function(el) { return el.id !== 'foldDash'; });
    var anyClosed = all.some(function(el) { return el.classList.contains('fold-closed'); });
    toggleAll(anyClosed, 'foldDash');
  }

  function init() {
    _secs().forEach(function(el) {
      if (!el.id) return;
      // 初始状态：用户操作过用记忆值，否则用 data-def
      var open = (el.id in _state) ? _state[el.id] : el.getAttribute('data-def') !== 'closed';
      _apply(el, open);
      _refreshSum(el);

      // 动态摘要：监听来源元素变化（收起栏实时更新关键数据）
      var from = el.getAttribute('data-sum-from');
      if (from && typeof MutationObserver !== 'undefined') {
        try {
          var src = el.querySelector(from);
          if (src) {
            new MutationObserver(function() { _refreshSum(el); })
              .observe(src, { childList: true, characterData: true, subtree: true });
          }
        } catch (e) {}
      }
    });
    _syncAllBtn();
  }

  // defer 脚本在 DOM 解析完成、首帧渲染前执行，无闪烁
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { init: init, toggle: toggle, toggleAll: toggleAll, toggleAllSmart: toggleAllSmart };
})();
