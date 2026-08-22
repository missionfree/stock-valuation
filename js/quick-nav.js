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
   4. 返回上一级导航栈：搜索个股时记录来源Tab+滚动位置，
      详情顶部醒目「← 返回」栏一键回原位（不限于组合，任何来源）
   ============================================================ */

/* 当前正在查看的股票（renderQuickNav时传入） */
var _qnCurrentCode = null;

/* ============================================================
   返回上一级：导航历史栈
   ------------------------------------------------------------
   - qnPushHistory()：searchStock 入口调用，记录"从哪来"
     （当前Tab+滚动位置）。已在策略Tab阅读个股时换股不叠加，
     栈保持浅层，符合"返回上一步"直觉
   - qnBackTarget()：读取栈顶（不弹出），用于渲染返回栏
   - qnGoBack()：弹出并恢复Tab+滚动位置
   ============================================================ */
var _qnNavStack = [];
var QN_TAB_LABELS = {
  valuation: '估值强度',
  industry: '行业全景',
  strategy: '策略信号',
  screener: '智能选股',
  fund: '基金超市',
  portfolio: '我的组合'
};

/** 当前激活的Tab名 */
function qnCurrentTab() {
  var btn = document.querySelector('.tab-nav-btn.active');
  return btn ? btn.getAttribute('data-tab') : 'valuation';
}

/** 搜索发起时入栈（在 searchStock 开头调用） */
function qnPushHistory() {
  var cur = qnCurrentTab();
  // 已在策略Tab阅读个股时切换标的：视为同层演进，不叠加历史
  if (cur === 'strategy') return;
  var label = QN_TAB_LABELS[cur] || cur;
  // 栈顶已是同一来源则更新滚动位置，避免堆积
  if (_qnNavStack.length && _qnNavStack[_qnNavStack.length - 1].tab === cur) {
    _qnNavStack[_qnNavStack.length - 1].scrollY = window.scrollY;
    return;
  }
  _qnNavStack.push({ tab: cur, scrollY: window.scrollY, label: label });
  if (_qnNavStack.length > 6) _qnNavStack.shift();
}

/** 读取返回目标（不弹出） */
function qnBackTarget() {
  return _qnNavStack.length ? _qnNavStack[_qnNavStack.length - 1] : null;
}

/** 返回上一级：恢复来源Tab与滚动位置 */
function qnGoBack() {
  var prev = _qnNavStack.pop();
  if (!prev) {
    backToSearch(); // 无历史：退回搜索框
    return;
  }
  switchTab(prev.tab);
  if (prev.scrollY > 0) {
    Perf.trackedSetTimeout(function() {
      window.scrollTo({ top: prev.scrollY, behavior: 'smooth' });
    }, 120);
  } else {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  showToast('已返回「' + prev.label + '」');
}

/** 智能返回：有历史回历史，无历史回组合（FAB用） */
function qnSmartBack() {
  var t = qnBackTarget();
  if (t) qnGoBack();
  else switchTab('portfolio');
}

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
 * 更新悬浮条内容（返回上一级 + 当前个股 + 上一只/下一只 + 返回组合）
 */
function qnUpdateTopbar(flat, curIdx) {
  var tb = qnEnsureTopbar();
  var curItem = curIdx >= 0 && flat && flat[curIdx] ? flat[curIdx] : null;
  var prevItem = curIdx > 0 ? flat[curIdx - 1] : null;
  var nextItem = (curIdx >= 0 && flat && curIdx < flat.length - 1) ? flat[curIdx + 1] : null;
  var backTarget = qnBackTarget();

  var nameHtml = '<span class="qn-topbar-name">' +
    (curItem ? '💼 ' + escHTML(curItem.name) + '<small>组合 ' + (curIdx + 1) + '/' + flat.length + ' · 阅读中</small>'
             : '📖 个股分析阅读中') +
    '</span>';

  // 返回上一级（优先级最高：回来源Tab，而非仅组合）
  var backHtml = backTarget
    ? '<button class="qn-topbar-btn qn-topbar-back" onclick="qnGoBack()" title="返回「' + escHTML(backTarget.label) + '」">← 返回' + escHTML(backTarget.label) + '</button>'
    : '<button class="qn-topbar-btn qn-topbar-back" onclick="qnGoBack()" title="返回搜索">← 返回</button>';

  var navHtml =
    (prevItem
      ? '<button class="qn-topbar-btn qn-topbar-nav" onclick="searchFromPortfolio(\'' + escHTML(prevItem.code) + '\',\'' + escHTML(prevItem.name) + '\')" title="查看上一只：' + escHTML(prevItem.name) + '">← ' + escHTML(prevItem.name) + '</button>'
      : '<button class="qn-topbar-btn qn-topbar-nav" disabled>← 上一只</button>') +
    (nextItem
      ? '<button class="qn-topbar-btn qn-topbar-nav" onclick="searchFromPortfolio(\'' + escHTML(nextItem.code) + '\',\'' + escHTML(nextItem.name) + '\')" title="查看下一只：' + escHTML(nextItem.name) + '">' + escHTML(nextItem.name) + ' →</button>'
      : '<button class="qn-topbar-btn qn-topbar-nav" disabled>下一只 →</button>');

  tb.innerHTML = nameHtml + backHtml + navHtml +
    '<button class="qn-topbar-btn" onclick="switchTab(\'portfolio\')" title="返回我的组合">组合</button>';
}

/**
 * 滚动监听（150ms节流）：向下超过350px且正在个股详情Tab时显示悬浮条
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
    var show = window.scrollY > 350 && inStrategy && !!hasDetail;
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
 * FAB悬浮按钮：智能返回——有浏览历史回上一级，无历史回组合
 */
function qnShowFab(show) {
  var fab = document.getElementById('qnFab');
  if (!fab) {
    if (!show) return;
    fab = document.createElement('div');
    fab.id = 'qnFab';
    fab.className = 'qn-fab';
    fab.onclick = function() { qnSmartBack(); };
    document.body.appendChild(fab);
  }
  // 动态更新文案：有返回目标显示目标名，否则显示组合
  var t = qnBackTarget();
  fab.innerHTML = '↩<span class="qn-fab-label">' + (t ? t.label : '组合') + '</span>';
  fab.title = t ? '返回「' + t.label + '」' : '返回我的组合';
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
  // 浮动「我的组合」快捷组件：已在组合页时隐藏，避免冗余
  var pfFloat = document.getElementById('floatPortfolioBtn');
  if (pfFloat) pfFloat.classList.toggle('hide', tabName === 'portfolio');
  var tb = document.getElementById('qnTopbar');
  if (tb && tabName !== 'strategy') tb.classList.remove('show');
}

/* ============================================================
   全局回到顶部按钮：任何页面滚动超过一屏后，左下角出现
   与右下角组合FAB错开，长内容读完后一键回顶
   ============================================================ */
var _qnBackTopTimer = null;

function qnBackTopOnScroll() {
  if (_qnBackTopTimer) return;
  _qnBackTopTimer = setTimeout(function() {
    _qnBackTopTimer = null;
    var btn = document.getElementById('qnBackTop');
    if (!btn) return;
    btn.classList.toggle('show', window.scrollY > 800);
  }, 150);
}

(function qnInitBackTop() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', qnCreateBackTop);
  } else {
    qnCreateBackTop();
  }
})();

function qnCreateBackTop() {
  if (document.getElementById('qnBackTop')) return;
  var btn = document.createElement('div');
  btn.id = 'qnBackTop';
  btn.className = 'qn-backtop';
  btn.setAttribute('role', 'button');
  btn.setAttribute('aria-label', '回到顶部');
  btn.title = '回到顶部';
  btn.innerHTML = '↑<span class="qn-backtop-label">顶部</span>';
  btn.onclick = function() { window.scrollTo({ top: 0, behavior: 'smooth' }); };
  document.body.appendChild(btn);
  window.addEventListener('scroll', qnBackTopOnScroll, { passive: true });
}
