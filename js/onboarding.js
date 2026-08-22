'use strict';

/* ============================================================
   FIN-Onboarding 新手3步引导 v1.0
   ------------------------------------------------------------
   需求：把复杂功能压缩至3步内 + 增加新手引导
   机制：首次访问（localStorage 未标记）时弹出一张3步引导卡，
   左下角"不再显示"勾选可永久关闭；点按钮进入对应步骤/功能。
   全程只读 DOM，轻量无依赖，可随时被"×"关闭。
   ============================================================ */

var FIN_ONBOARD_KEY = 'fin_onboard_done_v1';

var FIN_ONBOARD_STEPS = [
  {
    icon: '🔍',
    title: '搜个股',
    desc: '顶部输入代码或名称，回车即看全息分析（估值·K线·买卖点）。',
    action: '去搜索',
    act: function() { finOnboardClose(); var s = document.getElementById('searchInput') || document.querySelector('.search-bar input'); if (s) s.focus(); }
  },
  {
    icon: '⭐',
    title: '收自选',
    desc: '个股页点「加入组合」即可收藏，跟随观察，三步内完成。',
    action: '待会再看',
    act: function() { finOnboardNext(); }
  },
  {
    icon: '⚖️',
    title: '守纪律',
    desc: '组合页「纪律体检」+ 预警信号，帮你盯住买点与止损线。',
    action: '开始使用',
    act: function() { finOnboardClose(); if (typeof switchTab === 'function') switchTab('portfolio'); }
  }
];

var _finObIdx = 0;
var _finObEl = null;
var _finObNever = null;

function finOnboardClose() {
  if (_finObEl) _finObEl.style.display = 'none';
  if (_finObNever && _finObNever.checked) {
    try { localStorage.setItem(FIN_ONBOARD_KEY, '1'); } catch (e) {}
  }
}

function finOnboardRender() {
  var s = FIN_ONBOARD_STEPS[_finObIdx];
  var el = _finObEl;
  var html =
    '<div class="fin-ob-head">' +
      '<span class="fin-ob-badge">新手引导</span>' +
      '<span class="fin-ob-step">' + (_finObIdx + 1) + ' / ' + FIN_ONBOARD_STEPS.length + '</span>' +
      '<span class="fin-ob-close" role="button" aria-label="关闭引导" onclick="finOnboardClose()">×</span>' +
    '</div>' +
    '<div class="fin-ob-body">' +
      '<div class="fin-ob-icon">' + s.icon + '</div>' +
      '<div class="fin-ob-title">' + s.title + '</div>' +
      '<div class="fin-ob-desc">' + s.desc + '</div>' +
    '</div>' +
    '<div class="fin-ob-dots">';
  for (var i = 0; i < FIN_ONBOARD_STEPS.length; i++) {
    html += '<span class="fin-ob-dot' + (i === _finObIdx ? ' active' : '') + '"></span>';
  }
  html += '</div>' +
    '<div class="fin-ob-foot">' +
      '<label class="fin-ob-never"><input type="checkbox" id="finOnboardNever"> 不再显示</label>' +
      '<button class="fin-ob-btn" onclick="finOnboardNext()">' + s.action + '</button>' +
    '</div>';
  el.innerHTML = html;
  _finObNever = el.querySelector('#finOnboardNever');
}

function finOnboardNext() {
  _finObIdx++;
  if (_finObIdx >= FIN_ONBOARD_STEPS.length) {
    finOnboardClose();
    if (_finObNever && _finObNever.checked) {
      try { localStorage.setItem(FIN_ONBOARD_KEY, '1'); } catch (e) {}
    }
    return;
  }
  finOnboardRender();
}

function finOnboardInit() {
  var done = false;
  try { done = localStorage.getItem(FIN_ONBOARD_KEY) === '1'; } catch (e) {}
  if (done) return;

  /* 创建引导卡片（不影响现有 pa-guide-bar） */
  _finObEl = document.createElement('div');
  _finObEl.className = 'fin-ob';
  _finObEl.setAttribute('role', 'dialog');
  _finObEl.setAttribute('aria-label', '新手引导');
  document.body.appendChild(_finObEl);
  _finObIdx = 0;
  finOnboardRender();
}

/* 延迟到首屏渲染后弹出，避免抢在仪表盘前 */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(finOnboardInit, 900);
  });
} else {
  setTimeout(finOnboardInit, 900);
}