'use strict';

/* ============================================================
   QuickNav 快捷导航系统
   ------------------------------------------------------------
   解决：个股组合点击个股 → 跳转查询结果（Tab3底部）→ 阅读完
   要滚回顶部才能回组合的痛点。
   方案：
   1. 个股详情底部：组合个股快捷栏（点击即查下一只）+ 上一只/下一只
   2. 底部：搜索历史快捷chips
   3. 右下角悬浮FAB：随时返回组合Tab
   ============================================================ */

/* 当前正在查看的股票（renderQuickNav时传入） */
var _qnCurrentCode = null;

/**
 * 获取所有组合的扁平个股列表（带组合归属）
 * @returns {Array} [{code, name, group, gIdx}]
 */
function qnGetFlatItems() {
  var flat = [];
  if (typeof _portfolios === 'undefined' || !_portfolios) return flat;
  _portfolios.forEach(function(p, pi) {
    (p.items || []).forEach(function(item) {
      flat.push({ code: item.code, name: item.name, group: p.name, gIdx: pi });
    });
  });
  return flat;
}

/**
 * 渲染个股详情底部的组合快捷导航
 * @param {string} currentCode - 当前查看的股票代码
 */
function renderQuickNav(currentCode) {
  _qnCurrentCode = currentCode || null;
  var area = document.getElementById('stockResultArea');
  if (!area) return;

  // 移除旧节点
  var old = area.querySelector('.qn-wrap');
  if (old) old.remove();

  var flat = qnGetFlatItems();
  var curIdx = -1;
  for (var i = 0; i < flat.length; i++) {
    if (flat[i].code === _qnCurrentCode) { curIdx = i; break; }
  }

  var html = '<div class="qn-wrap">';

  // ============ 1. 组合快捷栏 ============
  if (flat.length > 0) {
    var curItem = curIdx >= 0 ? flat[curIdx] : null;
    var prevItem = curIdx > 0 ? flat[curIdx - 1] : null;
    var nextItem = curIdx >= 0 && curIdx < flat.length - 1 ? flat[curIdx + 1] : null;

    html += '<div class="qn-section qn-portfolio">' +
      '<div class="qn-title">' +
        '<span>💼 组合快捷切换 <span class="qn-count">' + flat.length + '只</span></span>' +
        '<span class="qn-back-btn" onclick="switchTab(\'portfolio\')">返回组合管理 →</span>' +
      '</div>';

    // 上一只 / 下一只 顺序导航
    if (flat.length > 1 && curIdx >= 0) {
      html += '<div class="qn-seq-nav">' +
        (prevItem
          ? '<button class="qn-seq-btn" onclick="searchFromPortfolio(\'' + escHTML(prevItem.code) + '\',\'' + escHTML(prevItem.name) + '\')">← 上一只 ' + escHTML(prevItem.name) + '</button>'
          : '<span class="qn-seq-empty">已是第一只</span>') +
        '<span class="qn-seq-pos">' + (curIdx + 1) + ' / ' + flat.length + '</span>' +
        (nextItem
          ? '<button class="qn-seq-btn" onclick="searchFromPortfolio(\'' + escHTML(nextItem.code) + '\',\'' + escHTML(nextItem.name) + '\')">' + escHTML(nextItem.name) + ' 下一只 →</button>'
          : '<span class="qn-seq-empty">已是最后一只</span>') +
      '</div>';
    }

    // 个股chips（当前高亮）
    html += '<div class="qn-chips">';
    flat.forEach(function(it) {
      var isCur = it.code === _qnCurrentCode;
      var priceHtml = '';
      if (typeof _portfolioPriceCache !== 'undefined' && _portfolioPriceCache[it.code] && _portfolioPriceCache[it.code].price > 0) {
        var pd = _portfolioPriceCache[it.code];
        var cls = pd.changeRate >= 0 ? 'up' : 'down';
        priceHtml = '<span class="qn-chip-price ' + cls + '">' + pd.price.toFixed(2) + ' ' + (pd.changeRate >= 0 ? '+' : '') + pd.changeRate.toFixed(2) + '%</span>';
      }
      if (isCur) {
        html += '<div class="qn-chip qn-chip-current" title="当前查看">' +
          '<span class="qn-chip-tag">正在看</span>' +
          '<span class="qn-chip-name">' + escHTML(it.name) + '</span>' +
          '<span class="qn-chip-code">' + it.code + '</span>' +
          priceHtml +
        '</div>';
      } else {
        html += '<div class="qn-chip" onclick="searchFromPortfolio(\'' + escHTML(it.code) + '\',\'' + escHTML(it.name) + '\')" title="点击查询 ' + escHTML(it.name) + '">' +
          '<span class="qn-chip-name">' + escHTML(it.name) + '</span>' +
          '<span class="qn-chip-code">' + it.code + '</span>' +
          priceHtml +
        '</div>';
      }
    });
    html += '</div></div>';
  } else {
    // 无组合：引导
    html += '<div class="qn-section qn-portfolio qn-empty-guide">' +
      '<div class="qn-title"><span>💼 组合快捷切换</span></div>' +
      '<div class="qn-guide-text">你还没有创建组合。把常看的个股加进组合后，每次读完分析，这里会显示组合个股，点击即可切换查询，不用来回翻页。</div>' +
      '<button class="qn-guide-btn" onclick="switchTab(\'portfolio\')">去创建组合 →</button>' +
    '</div>';
  }

  // ============ 2. 搜索历史快捷栏 ============
  var history = [];
  try { history = JSON.parse(localStorage.getItem('search_history_v2') || '[]'); } catch (e) {}
  history = history.filter(function(h) { return h.code !== _qnCurrentCode; }).slice(0, 8);
  if (history.length > 0) {
    var typeMap = { stk: '股', etf: 'ETF', idx: '指', hk: '港' };
    html += '<div class="qn-section qn-history">' +
      '<div class="qn-title"><span>🕘 最近查询</span><span class="qn-back-btn" onclick="clearQnHistory()">清空</span></div>' +
      '<div class="qn-chips qn-history-chips">';
    history.forEach(function(h) {
      html += '<div class="qn-chip qn-chip-sm" onclick="searchStockByCode(\'' + escHTML(h.code) + '\')" title="点击查询 ' + escHTML(h.name) + '">' +
        '<span class="qn-chip-name">' + escHTML(h.name) + '</span>' +
        (typeMap[h.type] ? '<span class="qn-chip-type">' + typeMap[h.type] + '</span>' : '') +
      '</div>';
    });
    html += '</div></div>';
  }

  html += '</div>';

  // 插入到 stockResultArea 末尾（stock-detail 之后）
  var temp = document.createElement('div');
  temp.innerHTML = html;
  area.appendChild(temp.firstChild);

  // 更新顶部悬浮返回条内容（深度阅读时显示）
  qnUpdateTopbar(flat, curIdx);

  // 显示FAB返回按钮
  qnShowFab(true);
}

/* ============================================================
   顶部悬浮返回条：向下深度阅读超过一屏后出现
   随时可「返回组合」或切上一只/下一只，不必滚回页面顶部
   ============================================================ */
var _qnScrollTimer = null;

/**
 * 确保顶部悬浮条DOM存在（惰性创建）
 */
function qnEnsureTopbar() {
  var tb = document.getElementById('qnTopbar');
  if (tb) return tb;
  tb = document.createElement('div');
  tb.id = 'qnTopbar';
  tb.className = 'qn-topbar';
  document.body.appendChild(tb);
  // 惰性绑定滚动监听（passive + 节流，不影响滚动性能）
  window.addEventListener('scroll', qnOnScroll, { passive: true });
  return tb;
}

/**
 * 更新悬浮条内容（当前个股 + 上一只/下一只 + 返回组合）
 */
function qnUpdateTopbar(flat, curIdx) {
  var tb = qnEnsureTopbar();
  var curItem = curIdx >= 0 && flat && flat[curIdx] ? flat[curIdx] : null;
  var prevItem = curIdx > 0 ? flat[curIdx - 1] : null;
  var nextItem = (curIdx >= 0 && flat && curIdx < flat.length - 1) ? flat[curIdx + 1] : null;

  var nameHtml = '<span class="qn-topbar-name">' +
    (curItem ? '💼 ' + escHTML(curItem.name) + '<small>组合 ' + (curIdx + 1) + '/' + flat.length + ' · 阅读中</small>'
             : '📖 个股分析阅读中') +
    '</span>';

  var navHtml =
    (prevItem
      ? '<button class="qn-topbar-btn qn-topbar-nav" onclick="searchFromPortfolio(\'' + escHTML(prevItem.code) + '\',\'' + escHTML(prevItem.name) + '\')" title="查看上一只：' + escHTML(prevItem.name) + '">← ' + escHTML(prevItem.name) + '</button>'
      : '<button class="qn-topbar-btn qn-topbar-nav" disabled>← 上一只</button>') +
    (nextItem
      ? '<button class="qn-topbar-btn qn-topbar-nav" onclick="searchFromPortfolio(\'' + escHTML(nextItem.code) + '\',\'' + escHTML(nextItem.name) + '\')" title="查看下一只：' + escHTML(nextItem.name) + '">' + escHTML(nextItem.name) + ' →</button>'
      : '<button class="qn-topbar-btn qn-topbar-nav" disabled>下一只 →</button>');

  tb.innerHTML = nameHtml + navHtml +
    '<button class="qn-topbar-btn qn-topbar-back" onclick="switchTab(\'portfolio\')" title="返回我的组合">返回组合</button>';
}

/**
 * 滚动监听（150ms节流）：向下超过600px且正在个股详情Tab时显示悬浮条
 */
function qnOnScroll() {
  if (_qnScrollTimer) return;
  _qnScrollTimer = setTimeout(function() {
    _qnScrollTimer = null;
    var tb = document.getElementById('qnTopbar');
    if (!tb) return;
    var strategyTab = document.getElementById('tab-strategy');
    var inStrategy = strategyTab && strategyTab.classList.contains('active');
    var hasDetail = document.querySelector('#stockResultArea .stock-detail');
    var show = window.scrollY > 600 && inStrategy && !!hasDetail;
    tb.classList.toggle('show', show);
  }, 150);
}

/**
 * 清空搜索历史（带确认）
 */
function clearQnHistory() {
  if (!confirm('确定清空搜索历史吗？')) return;
  try { localStorage.removeItem('search_history_v2'); } catch (e) {}
  showToast('搜索历史已清空');
  renderQuickNav(_qnCurrentCode);
}

/**
 * FAB悬浮按钮：随时返回组合
 */
function qnShowFab(show) {
  var fab = document.getElementById('qnFab');
  if (!fab) {
    if (!show) return;
    fab = document.createElement('div');
    fab.id = 'qnFab';
    fab.className = 'qn-fab';
    fab.innerHTML = '💼<span class="qn-fab-label">组合</span>';
    fab.title = '返回我的组合';
    fab.onclick = function() { switchTab('portfolio'); };
    document.body.appendChild(fab);
  }
  fab.classList.toggle('show', !!show);
}

/**
 * 组合数据变化时刷新快捷栏（若当前正在显示个股详情）
 */
function qnRefreshIfVisible() {
  var area = document.getElementById('stockResultArea');
  if (!area) return;
  var detail = area.querySelector('.stock-detail');
  if (!detail) return; // 未在查看个股详情，无需刷新
  renderQuickNav(_qnCurrentCode);
}

/**
 * Tab切换时：组合Tab隐藏FAB，离开个股阅读Tab时隐藏顶部悬浮条
 * 在switchTab后调用
 */
function qnOnTabSwitch(tabName) {
  qnShowFab(tabName !== 'portfolio');
  var tb = document.getElementById('qnTopbar');
  if (tb && tabName !== 'strategy') tb.classList.remove('show');
}
