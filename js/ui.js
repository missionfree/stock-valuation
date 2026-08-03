'use strict';

/* ============================================================
   Tab切换功能
   ============================================================ */
function scrollToSection(elementId) {
  var el = document.getElementById(elementId);
  if (!el) return;
  // 确保在正确的Tab中（行业全景Tab）
  var tabContent = el.closest('.tab-content');
  if (tabContent && !tabContent.classList.contains('active')) {
    var tabName = tabContent.id.replace('tab-', '');
    switchTab(tabName);
    Perf.trackedSetTimeout(function() {
 el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}, 200);
  } else {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function switchTab(tabName, direction) {
  // 记忆当前Tab到localStorage（排除搜索触发的strategy切换，避免干扰用户浏览习惯）
  try { localStorage.setItem('last_active_tab', tabName); } catch(e) {}
  
  // 更新Tab按钮状态
  document.querySelectorAll('.tab-nav-btn').forEach(function(btn) {
    var isActive = btn.getAttribute('data-tab') === tabName;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  // 更新Tab内容显示（带滑动方向动画）
  document.querySelectorAll('.tab-content').forEach(function(content) {
    var isActive = content.id === 'tab-' + tabName;
    content.classList.remove('swipe-left', 'swipe-right');
    if (isActive && direction) {
      content.classList.add(direction === 'left' ? 'swipe-left' : 'swipe-right');
    }
    content.classList.toggle('active', isActive);
  });
  // 切换到行业全景时重绘热力图
  if (tabName === 'industry') {
    Perf.trackedSetTimeout(function() { drawHeatmap(); }, 100);
  }
  // 切换到估值强度时重绘PE对比图
  if (tabName === 'valuation') {
    Perf.trackedSetTimeout(function() { drawPEBar(_lastRealtimeData); }, 100);
  }
  // 切换到我的组合时自动刷新行情
  if (tabName === 'portfolio') {
    var hasStocks = _portfolios.some(function(p) { return p.items.length > 0; });
    if (hasStocks) {
      Perf.trackedSetTimeout(function() { refreshPortfolioPrices(); }, 200);
    }
  }
  // 不再使用 scrollIntoView 滚动页面，改由穿透式特效完成视觉切换
}

/* ============================================================
   触摸滑动切换 Tab
   ============================================================ */
var _tabOrder = ['valuation', 'industry', 'strategy', 'portfolio'];
var _swipeStartX = 0;
var _swipeStartY = 0;
var _swipeStartT = 0;
var _swipeHintTimer = null;
var _swipeHintShown = false;

function getCurrentTabIndex() {
  var activeBtn = document.querySelector('.tab-nav-btn.active');
  if (!activeBtn) return 0;
  var tabName = activeBtn.getAttribute('data-tab');
  return _tabOrder.indexOf(tabName);
}

function swipeToTab(direction) {
  var curIdx = getCurrentTabIndex();
  var newIdx;
  if (direction === 'left') {
    newIdx = curIdx + 1; // 左滑→下一个
  } else {
    newIdx = curIdx - 1; // 右滑→上一个
  }
  if (newIdx < 0 || newIdx >= _tabOrder.length) return; // 边界
  switchTab(_tabOrder[newIdx], direction);
}

function isSwipeExcluded(target) {
  // 排除水平滚动元素、canvas、输入框、按钮等
  if (!target) return false;
  var el = target;
  while (el && el !== document.body) {
    if (el.tagName === 'CANVAS') return true;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return true;
    if (el.classList && el.classList.contains('sca-table-wrap')) return true;
    if (el.classList && el.classList.contains('suggest-list')) return true;
    if (el.scrollWidth > el.clientWidth && el.clientWidth > 0 && getComputedStyle(el).overflowX === 'auto') return true;
    el = el.parentElement;
  }
  return false;
}

function initSwipeNavigation() {
  var touchArea = document.querySelector('.tab-nav');
  if (!touchArea) return;
  // 在 tab-nav 及其下方的 tab-content 区域监听触摸事件
  var swipeContainer = touchArea.parentElement;

  swipeContainer.addEventListener('touchstart', function(e) {
    if (e.touches.length !== 1) return;
    if (isSwipeExcluded(e.target)) {
      _swipeStartX = -9999; // 标记跳过
      return;
    }
    _swipeStartX = e.touches[0].clientX;
    _swipeStartY = e.touches[0].clientY;
    _swipeStartT = Date.now();
  }, { passive: true });

  swipeContainer.addEventListener('touchend', function(e) {
    if (_swipeStartX === -9999) return;
    if (e.changedTouches.length !== 1) return;

    var endX = e.changedTouches[0].clientX;
    var endY = e.changedTouches[0].clientY;
    var dx = endX - _swipeStartX;
    var dy = endY - _swipeStartY;
    var dt = Date.now() - _swipeStartT;

    // 水平距离>60px，且水平距离>垂直距离1.5倍，且时间<500ms
    if (Math.abs(dx) < 60) return;
    if (Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dt > 500) return;

    var direction = dx < 0 ? 'left' : 'right';
    swipeToTab(direction);
  }, { passive: true });

  // 首次显示滑动提示
  if (!_swipeHintShown) {
    _swipeHintShown = true;
  Perf.trackedSetTimeout(function() {
  var hint = document.getElementById('swipeHint');
  if (hint) {
  hint.classList.add('show');
  if (_swipeHintTimer) Perf.clearTimeout(_swipeHintTimer);
  _swipeHintTimer = Perf.trackedSetTimeout(function() {
  hint.classList.remove('show');
  }, 3500);
  }
  }, 2000);
  }
}

/* ============================================================
   十四、Toast 提示
   ============================================================ */
var toastTimer = null;
function showToast(msg) {
  var el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  if (toastTimer) Perf.clearTimeout(toastTimer);
  toastTimer = Perf.trackedSetTimeout(function() {
  el.classList.remove('show');
}, 2500);
}

/* ============================================================
   十五、交互功能：排序/导出/暗亮模式/搜索联想
   ============================================================ */

var _indexSortKey = null;
var _lastRealtimeData = null;
var _lastSentimentData = null;    // 缓存最近一次情绪数据（供今日复盘使用）
var _lastSectorFlowData = null;   // 缓存最近一次板块资金流数据

/**
 * 按指定字段排序指数卡片并重渲染
 */
function sortIndexCards(sortKey) {
  _indexSortKey = sortKey;
  // 更新按钮状态
  document.querySelectorAll('.sort-btn').forEach(function(b) {
    b.classList.toggle('active', b.getAttribute('data-sort') === sortKey);
  });
  // 重渲染（用上次实时数据或null）
  renderIndexCards(_lastRealtimeData);
}

/**
 * 导出指数估值数据为CSV
 */
function exportIndexCSV() {
  var rt = _lastRealtimeData || {};
  var rows = [['名称', '代码', 'PE', 'PB', '股息率', 'PE分位%', 'PB分位%', '股息率分位%', 'PE最低', 'PE最高']];
  BASE_DATA.indices.forEach(function(idx) {
    // 优先使用实时数据
    var pe = idx.pe, pb = idx.pb, dy = idx.dy;
    var pct = idx.pct10, pbPct = idx.pbPct10, dyPct = idx.dyPct10;
    var rtIdx = rt[idx.code];
    if (rtIdx) {
      if (rtIdx.pe && rtIdx.pe > 0) {
        pe = rtIdx.pe;
        if (idx.peMax > idx.peMin) {
          var _shift = Math.round(((pe - idx.pe) / (idx.peMax - idx.peMin)) * 100);
          pct = Math.max(0, Math.min(100, idx.pct10 + _shift));
          pbPct = Math.max(0, Math.min(100, (idx.pbPct10||50) + _shift));
          dyPct = Math.max(0, Math.min(100, (idx.dyPct10||50) - _shift));
        }
      }
      if (rtIdx.pb && rtIdx.pb > 0) {
        pb = rtIdx.pb;
        if (idx.pb > 0) dy = idx.dy * (idx.pb / rtIdx.pb);
      }
    }
    rows.push([
      idx.name || '', idx.code || '', pe || '', pb || '', dy || '',
      pct || '', pbPct || '', dyPct || '', idx.peMin || '', idx.peMax || ''
    ]);
  });
  var csv = '\uFEFF' + rows.map(function(r) { return r.join(','); }).join('\n');
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'index_valuation_' + new Date().toISOString().slice(0,10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV已导出');
}

/**
 * 切换主题选择器的显示/隐藏
 */
function toggleThemePicker() {
  var picker = document.getElementById('themePicker');
  var btn = document.getElementById('modeToggle');
  if (!picker || !btn) return;
  var isOpen = picker.classList.toggle('show');
  btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  if (isOpen) {
    Perf.trackedSetTimeout(function() {
 var first = picker.querySelector('.theme-option');
 if (first) first.focus();
}, 50);
  }
}

/**
 * 设置主题
 * @param {string} theme - 主题名: 'cyber' | 'light' | 'classical' | 'cyberpunk' | 'ocean'
 */
function setTheme(theme) {
  var body = document.body;
  // cyber 是默认主题，不需要 data-theme 属性
  if (theme === 'cyber') {
    body.removeAttribute('data-theme');
  } else {
    body.setAttribute('data-theme', theme);
  }
  // 用户手动选择 → 持久化
  try { localStorage.setItem('themeMode', theme); } catch(e) {}

  // 清空颜色缓存（主题切换后CSS变量值已变）
  clearColorCache();

  // 更新选中状态（基于 data-theme 属性而非脆弱的 onclick 字符串匹配）
  document.querySelectorAll('.theme-option').forEach(function(opt) {
    var isActive = opt.getAttribute('data-theme') === theme;
    opt.classList.toggle('active', isActive);
    if (isActive) opt.setAttribute('aria-current', 'true'); else opt.removeAttribute('aria-current');
  });

  // 关闭选择器
  var picker = document.getElementById('themePicker');
  if (picker) picker.classList.remove('show');

  // 重绘Canvas（颜色需要更新）
  Perf.trackedSetTimeout(function() {
 drawHeatmap();
 drawPEBar(_lastRealtimeData);
}, 50);
}

/**
 * 初始化主题（首次进入随机，用户手动选择后记忆）
 */
(function initTheme() {
  var validThemes = ['cyber', 'light', 'classical', 'cyberpunk', 'ocean'];
  try {
    var saved = localStorage.getItem('themeMode');
    // 兼容旧值: 'dark' → 'cyber'
    if (saved === 'dark') saved = 'cyber';
    // 首次进入（无记录）→ 随机选取
    if (!saved || validThemes.indexOf(saved) === -1) {
      saved = validThemes[Math.floor(Math.random() * validThemes.length)];
    }
    if (saved === 'cyber') {
      document.body.removeAttribute('data-theme');
    } else {
      document.body.setAttribute('data-theme', saved);
    }
    // 标记当前选中（基于 data-theme 属性，与 setTheme 保持一致）
    document.querySelectorAll('.theme-option').forEach(function(opt) {
      var isActive = opt.getAttribute('data-theme') === saved;
      opt.classList.toggle('active', isActive);
      if (isActive) opt.setAttribute('aria-current', 'true'); else opt.removeAttribute('aria-current');
    });
  } catch(e) {}
})();

/**
 * 搜索联想输入处理（防抖）
 */
var _suggestTimer = null;
var _searchInProgress = false; // 搜索进行中标志，防止联想回调干扰
var _suggestMeta = null; // 搜索联想元信息 {isETF, isIndex, ...}

function clearSearchInput() {
  var input = document.getElementById('searchInput');
  if (input) {
    input.value = '';
    input.focus();
    handleSearchInput('');
  }
  var clearBtn = document.getElementById('searchClearBtn');
  if (clearBtn) clearBtn.classList.remove('show');
}

function updateSearchClearBtn() {
  var input = document.getElementById('searchInput');
  var clearBtn = document.getElementById('searchClearBtn');
  var searchBar = document.querySelector('.search-bar');
  if (!input || !clearBtn) return;
  var hasText = input.value.trim().length > 0;
  if (hasText) {
    clearBtn.classList.add('show');
    if (searchBar) searchBar.classList.add('has-text');
  } else {
    clearBtn.classList.remove('show');
    if (searchBar) searchBar.classList.remove('has-text');
  }
}

function handleSearchInput(value) {
  var suggest = document.getElementById('searchSuggest');
  if (!suggest) return;
  
  // 更新清空按钮状态
  updateSearchClearBtn();
  
  // 输入框为空时隐藏联想
  if (!value || value.trim().length === 0) {
    suggest.classList.remove('show');
    return;
  }
  
  // 搜索进行中时，不处理输入联想
  if (_searchInProgress) return;
  
  if (_suggestTimer) Perf.clearTimeout(_suggestTimer);
  
  if (!value || value.trim().length < 1) {
    suggest.classList.remove('show');
    return;
  }
  
  _suggestTimer = Perf.trackedSetTimeout(function() {
 // 双重检查：定时器触发时搜索可能已开始
 if (_searchInProgress) return;
 emSuggest(value.trim()).then(function(data) {
      // 异步回调返回时再次检查搜索状态
      if (_searchInProgress) return;
      if (!data || !data.QuotationCodeTable || !data.QuotationCodeTable.Data) {
        suggest.classList.remove('show');
        return;
      }
      var list = data.QuotationCodeTable.Data.filter(function(s) {
        return s.MktNum === '1' || s.MktNum === '0' || s.MktNum === '116';
      }).slice(0, 8);
      
      if (list.length === 0) {
        suggest.classList.remove('show');
        return;
      }
      
      var html = list.map(function(s) {
        // 根据SecurityType/Classify判断类型标签
        var typeLabel = '';
        var typeClass = '';
        if (s.Classify === 'Fund' || s.SecurityType === '8') {
          typeLabel = 'ETF';
          typeClass = 'etf';
        } else if (s.Classify === 'Index' || s.SecurityType === '5') {
          typeLabel = '指数';
          typeClass = 'idx';
        } else if (s.MktNum === '116') {
          typeLabel = '港股';
          typeClass = 'hk';
        } else {
          typeLabel = '股票';
          typeClass = 'stk';
        }
        return '<div class="suggest-item" role="option" data-sg-code="' + escHTML(s.Code) + '" data-sg-name="' + escHTML(s.Name||'') + '" data-sg-mkt="' + escHTML(s.MktNum) + '" data-sg-type="' + escHTML(s.SecurityType||'') + '" data-sg-class="' + escHTML(s.Classify||'') + '">' +
          '<span class="suggest-type ' + typeClass + '">' + typeLabel + '</span>' +
          '<span>' + escHTML(s.Name || '') + '</span>' +
          '<span class="s-code">' + s.Code + '</span>' +
        '</div>';
      }).join('');
      suggest.innerHTML = html;
      // 事件委托：点击联想项
      suggest.querySelectorAll('[data-sg-code]').forEach(function(item) {
        item.addEventListener('click', function() {
          selectSuggestion(
            item.getAttribute('data-sg-code'),
            item.getAttribute('data-sg-name'),
            item.getAttribute('data-sg-mkt'),
            item.getAttribute('data-sg-type'),
            item.getAttribute('data-sg-class')
          );
        });
      });
      suggest.classList.add('show');
    }).catch(function() {
      suggest.classList.remove('show');
    });
  }, 300);
}

function selectSuggestion(code, name, mktNum, secType, classify) {
  // 清除防抖定时器，防止选中后联想下拉框再次弹出
  if (_suggestTimer) { Perf.clearTimeout(_suggestTimer); _suggestTimer = null; }
  var input = document.getElementById('searchInput');
  input.value = code;
  document.getElementById('searchSuggest').classList.remove('show');
  updateSearchClearBtn();
  // 传递类型信息给searchStock
  _suggestMeta = {
    mktNum: mktNum || '',
    securityType: secType || '',
    classify: classify || '',
    isETF: classify === 'Fund' || secType === '8',
    isIndex: classify === 'Index' || secType === '5'
  };
  searchStock();
}

// 点击外部关闭搜索联想
document.addEventListener('click', function(e) {
  if (!e.target.closest('.search-bar')) {
    var suggest = document.getElementById('searchSuggest');
    if (suggest) suggest.classList.remove('show');
  }
});

/* ============================================================
   十六·一、我的估值组合功能
   本地持久化存储：localStorage('valuation_portfolios')
   不随K线缓存清理而丢失，下次进入页面自动恢复
   ============================================================ */
var _portfolios = []; // [{name: '组合1', items: [{code, name}]}]
var _portfolioPriceCache = {}; // 内存行情缓存 {code: {price, changeRate}}，不持久化
var LS_PORTFOLIO_KEY = 'valuation_portfolios';

function loadPortfolios() {
  try {
    var saved = localStorage.getItem(LS_PORTFOLIO_KEY);
    if (saved) _portfolios = JSON.parse(saved);
  } catch(e) { _portfolios = []; }
  updatePortfolioSavedTag();
}

function savePortfolios() {
  try {
    localStorage.setItem(LS_PORTFOLIO_KEY, JSON.stringify(_portfolios));
  } catch(e) {}
  updatePortfolioSavedTag();
}

/**
 * 更新"已本地保存"提示标签
 */
function updatePortfolioSavedTag() {
  var tag = document.getElementById('portfolioSavedTag');
  if (!tag) return;
  var totalStocks = _portfolios.reduce(function(s, p) { return s + p.items.length; }, 0);
  if (_portfolios.length > 0) {
    tag.textContent = '💾 已本地保存 · ' + _portfolios.length + '组' + totalStocks + '只';
  } else {
    tag.textContent = '';
  }
}

function showPortfolioDialog() {
  if (_portfolios.length >= 5) {
    showToast('最多创建5个组合');
    return;
  }
  var name = prompt('输入组合名称：', '组合' + (_portfolios.length + 1));
  if (!name) return;
  _portfolios.push({ name: name, items: [] });
  savePortfolios();
  renderPortfolio();
  showToast('组合「' + name + '」已创建');
}

/**
 * 添加个股到估值组合
 * 如果只有一个组合，直接添加；多个组合时弹出选择框
 */
function addToPortfolio(code, name) {
  if (_portfolios.length === 0) {
    showToast('请先创建组合');
    return;
  }
  if (_portfolios.length === 1) {
    addStockToPortfolioIdx(0, code, name);
    return;
  }
  // 多个组合时弹出选择框
  showPortfolioSelectDialog(code, name);
}

/**
 * 弹出组合选择对话框
 */
function showPortfolioSelectDialog(code, name) {
  // 移除已有对话框
  closePortfolioSelectDialog();

  var overlay = document.createElement('div');
  overlay.className = 'portfolio-add-select-overlay';
  overlay.id = 'portfolioSelectOverlay';
  overlay.onclick = closePortfolioSelectDialog;

  var dialog = document.createElement('div');
  dialog.className = 'portfolio-add-select';
  dialog.id = 'portfolioSelectDialog';
  dialog.onclick = function(e) { e.stopPropagation(); };

  var html = '<div class="portfolio-add-select-title">选择添加到哪个组合</div>';
  html += '<div style="font-size:0.58rem;color:var(--muted);margin-bottom:0.4rem">' + name + ' (' + code + ')</div>';

  // 检查是否已存在于某个组合
  _portfolios.forEach(function(p, pi) {
    var exists = p.items.some(function(item) { return item.code === code; });
    var status = exists ? '<span style="color:var(--neon-yellow)">已存在</span>' : '<span class="count">' + p.items.length + '/50</span>';
    html += '<div class="portfolio-add-select-item" data-pa-idx="' + pi + '" data-pa-code="' + escHTML(code) + '" data-pa-name="' + escHTML(name) + '">' +
      '<span>' + escHTML(p.name) + '</span>' + status +
    '</div>';
  });

  // 取消按钮
  html += '<div style="text-align:center;margin-top:0.4rem"><button class="portfolio-btn" onclick="closePortfolioSelectDialog()">取消</button></div>';

  dialog.innerHTML = html;
  // 事件委托：点击组合项添加个股
  dialog.querySelectorAll('[data-pa-idx]').forEach(function(item) {
    item.addEventListener('click', function() {
      addStockToPortfolioIdx(
        parseInt(item.getAttribute('data-pa-idx')),
        item.getAttribute('data-pa-code'),
        item.getAttribute('data-pa-name')
      );
    });
  });
  document.body.appendChild(overlay);
  document.body.appendChild(dialog);
}

function closePortfolioSelectDialog() {
  var overlay = document.getElementById('portfolioSelectOverlay');
  var dialog = document.getElementById('portfolioSelectDialog');
  if (overlay) overlay.remove();
  if (dialog) dialog.remove();
}

/**
 * 添加个股到指定组合
 */
function addStockToPortfolioIdx(portfolioIdx, code, name) {
  closePortfolioSelectDialog();
  var portfolio = _portfolios[portfolioIdx];
  if (!portfolio) return;
  if (portfolio.items.length >= 50) {
    showToast('该组合已满50只');
    return;
  }
  var exists = portfolio.items.some(function(item) { return item.code === code; });
  if (exists) {
    showToast('已存在于「' + portfolio.name + '」');
    return;
  }
  portfolio.items.push({ code: code, name: name });
  savePortfolios();
  renderPortfolio();
  showToast('已添加到「' + portfolio.name + '」');
}

/**
 * 自动收藏：评分≥75的个股自动添加到「自动关注」组合
 * 首次触发时自动创建该组合
 * @param {object} stockData - 个股行情数据
 * @param {number} score - 综合评分
 */
var AUTO_FAV_PORTFOLIO_NAME = '自动关注';
var AUTO_FAV_THRESHOLD = 75;

function autoFavoriteStock(stockData, score) {
  if (!stockData || !stockData.code) return;

  // 查找或创建「自动关注」组合
  var autoFavIdx = _portfolios.findIndex(function(p) { return p.name === AUTO_FAV_PORTFOLIO_NAME; });
  if (autoFavIdx === -1) {
    _portfolios.push({ name: AUTO_FAV_PORTFOLIO_NAME, items: [] });
    autoFavIdx = _portfolios.length - 1;
  }

  var portfolio = _portfolios[autoFavIdx];
  var code = stockData.code;
  var name = stockData.name || code;

  // 检查是否已存在
  var exists = portfolio.items.some(function(item) { return item.code === code; });
  if (exists) return; // 已存在，不重复添加、不弹toast

  // 检查组合容量
  if (portfolio.items.length >= 50) {
    return; // 组合已满，静默跳过
  }

  // 添加并保存
  portfolio.items.push({
    code: code,
    name: name,
    autoScore: score,
    autoDate: new Date().toISOString().substring(0, 10)
  });
  savePortfolios();
  renderPortfolio();
  showToast('★ 评分' + score + '分 · 已自动收藏至「自动关注」');
}

function removeFromPortfolio(portfolioIdx, itemIdx) {
  if (_portfolios[portfolioIdx]) {
    _portfolios[portfolioIdx].items.splice(itemIdx, 1);
    savePortfolios();
    renderPortfolio();
    showToast('已移除');
  }
}

function deletePortfolio(idx) {
  if (confirm('确认删除组合「' + _portfolios[idx].name + '」？')) {
    _portfolios.splice(idx, 1);
    savePortfolios();
    renderPortfolio();
    showToast('组合已删除');
  }
}

/**
 * 点击组合中的个股，跳转搜索
 */
function searchFromPortfolio(code, name) {
  var input = document.getElementById('searchInput');
  if (input) {
    input.value = code;
  }
  updateSearchClearBtn();
  // searchStock 内部已处理滚动到结果区域，无需重复滚动
  searchStock();
}

/**
 * 批量刷新组合中所有个股的实时行情（含PE/PB/换手率等信号数据）
 * 并发控制：10秒冷却 + 防重复请求 + 大批量分片
 */
var _portfolioRefreshLock = false;
var _lastPortfolioRefresh = 0;
var PORTFOLIO_REFRESH_COOLDOWN = 10 * 1000; // 10秒冷却
var PORTFOLIO_BATCH_SIZE = 15; // 每批最多15只，避免URL过长和请求过大

function refreshPortfolioPrices() {
  // 1. 防重入锁
  if (_portfolioRefreshLock) {
    showToast('正在刷新中，请稍候...');
    return;
  }
  // 2. 冷却检查
  var elapsed = Date.now() - _lastPortfolioRefresh;
  if (elapsed < PORTFOLIO_REFRESH_COOLDOWN) {
    var remain = Math.ceil((PORTFOLIO_REFRESH_COOLDOWN - elapsed) / 1000);
    showToast('刷新冷却中，请' + remain + '秒后再试');
    return;
  }

  // 收集所有组合中的个股代码
  var allCodes = [];
  _portfolios.forEach(function(p) {
    p.items.forEach(function(item) {
      if (allCodes.indexOf(item.code) === -1) allCodes.push(item.code);
    });
  });

  if (allCodes.length === 0) {
    showToast('组合中暂无个股');
    return;
  }

  // 将纯数字代码转为腾讯格式
  var tencentCodes = allCodes.map(function(code) {
    code = code.replace(/^(sh|sz|hk)/i, '');
    if (code.charAt(0) === '6') return 'sh' + code;
    if (code.charAt(0) === '0' || code.charAt(0) === '3') return 'sz' + code;
    if (code.charAt(0) === '5' || code.charAt(0) === '9') return 'sh' + code;
    return 'sz' + code;
  });

  _portfolioRefreshLock = true;
  _lastPortfolioRefresh = Date.now();
  var btn = document.getElementById('portfolioRefreshBtn');
  if (btn) { btn.disabled = true; btn.textContent = '刷新中...'; }

  showToast('正在刷新' + allCodes.length + '只个股行情...');

  // 分片处理：每批PORTFOLIO_BATCH_SIZE只，批间延迟500ms
  var batches = [];
  for (var i = 0; i < tencentCodes.length; i += PORTFOLIO_BATCH_SIZE) {
    batches.push(tencentCodes.slice(i, i + PORTFOLIO_BATCH_SIZE));
  }

  var batchResults = {};
  var batchDone = 0;

  function processBatch(batchIdx) {
    if (batchIdx >= batches.length) {
      // 所有批次完成，处理结果
      _processPortfolioBatchResults(batchResults, allCodes, tencentCodes);
      _portfolioRefreshLock = false;
      if (btn) { btn.disabled = false; btn.textContent = '刷新行情'; }
      return;
    }

    var batch = batches[batchIdx];
    fetchTencentBatch(batch).then(function(data) {
      // 合并结果
      Object.keys(data).forEach(function(k) { batchResults[k] = data[k]; });
      batchDone++;
      var progress = '(' + batchDone + '/' + batches.length + ')';
      if (btn) btn.textContent = '刷新中 ' + progress;

      // 批间延迟500ms，避免请求过于密集
      Perf.trackedSetTimeout(function() {
 processBatch(batchIdx + 1);
}, batches.length > 1 ? 500 : 0);
}).catch(function() {
 // 单批失败不阻断整体流程
 batchDone++;
 Perf.trackedSetTimeout(function() {
 processBatch(batchIdx + 1);
}, batches.length > 1 ? 500 : 0);
    });
  }

  processBatch(0);
}

/**
 * 处理批量行情数据结果
 */
function _processPortfolioBatchResults(data, allCodes, tencentCodes) {
  allCodes.forEach(function(code, i) {
    var tc = tencentCodes[i];
    if (data[tc]) {
      var stockData = data[tc];
      if (typeof stockData === 'object' && stockData.price) {
        // 缓存完整行情数据，用于信号分析
        _portfolioPriceCache[code] = {
          price: stockData.price,
          changeRate: stockData.changePercent || 0,
          pe: stockData.pe || 0,
          pb: stockData.pb || 0,
          turnoverRate: stockData.turnoverRate || 0,
          amplitude: stockData.amplitude || 0,
          high: stockData.high || 0,
          low: stockData.low || 0,
          volume: stockData.volume || 0,
          marketCap: stockData.marketCap || 0
        };
      } else if (typeof stockData === 'string') {
        // 降级：手动解析腾讯原始字符串
        var parts = stockData.split('~');
        if (parts.length > 46) {
          _portfolioPriceCache[code] = {
            price: parseFloat(parts[3]) || 0,
            changeRate: parseFloat(parts[32]) || 0,
            pe: parseFloat(parts[39]) || 0,
            pb: parseFloat(parts[46]) || 0,
            turnoverRate: parseFloat(parts[38]) || 0,
            amplitude: parseFloat(parts[43]) || 0,
            high: parseFloat(parts[33]) || 0,
            low: parseFloat(parts[34]) || 0,
            volume: parseFloat(parts[6]) || 0,
            marketCap: parseFloat(parts[45]) || 0
          };
        } else if (parts.length > 5) {
          _portfolioPriceCache[code] = {
            price: parseFloat(parts[3]) || 0,
            changeRate: parseFloat(parts[32]) || 0
          };
        }
      }
    }
  });

  // 刷新后自动执行快速信号分析（基于实时数据，不需要K线）
  _portfolios.forEach(function(p) {
    p.items.forEach(function(item) {
      var cached = _portfolioPriceCache[item.code];
      if (cached && cached.price > 0) {
        var quickSignal = calcQuickSignal(cached, item);
        _portfolioSignalCache[item.code] = quickSignal;
      }
    });
  });

  renderPortfolio();
  showToast('行情已刷新 · 信号已更新');
}

/* ============================================================
   十六-补、组合个股见顶/见底信号分析
   ============================================================ */
var _portfolioSignalCache = {}; // {code: {signal, signalCls, reasons[], metrics}}
var _portfolioKlineCache = {};  // {code: {maData, timestamp}}
var _analyzing = false;

/**
 * 快速信号分析（基于实时行情数据，无需K线）
 * 判断个股是否可能见顶或见底
 * @param {object} data - 实时行情数据
 * @param {object} item - 组合中的个股项
 * @returns {object} {signal, signalCls, reasons[], metrics}
 */
function calcQuickSignal(data, item) {
  var reasons = [];
  var signalScore = 0; // 正数=见顶风险，负数=见底机会
  var metrics = {};

  var pe = data.pe || 0;
  var pb = data.pb || 0;
  var changeRate = data.changeRate || 0;
  var turnoverRate = data.turnoverRate || 0;
  var amplitude = data.amplitude || 0;
  var price = data.price || 0;

  // ===== 第一步：判断个股估值位置（低位/中位/高位）=====
  // 位置上下文是核心：低位涨停是反转信号，高位涨停才是见顶信号
  var positionLevel = 'medium'; // low / medium / high
  var positionScore = 0; // 位置本身的得分

  if (pe > 0) {
    metrics.pe = pe.toFixed(1);
    if (pe > 80) {
      positionLevel = 'high';
      positionScore += 3;
    } else if (pe > 50) {
      positionLevel = 'high';
      positionScore += 2;
    } else if (pe > 30) {
      positionScore += 1; // 中位偏高
    } else if (pe > 0 && pe < 8) {
      positionLevel = 'low';
      positionScore -= 3;
    } else if (pe > 0 && pe < 15) {
      positionLevel = 'low';
      positionScore -= 2;
    }
  }

  if (pb > 0) {
    metrics.pb = pb.toFixed(2);
    if (pb > 8) {
      positionLevel = 'high';
      positionScore += 2;
    } else if (pb > 5) {
      positionScore += 1;
    } else if (pb > 0 && pb < 0.8) {
      positionLevel = 'low';
      positionScore -= 2;
    } else if (pb > 0 && pb < 1.2) {
      positionLevel = 'low';
      positionScore -= 1;
    }
  }

  // 如果PE和PB同时指向低位，强化低位判断
  if (pe > 0 && pe < 15 && pb > 0 && pb < 1.5) {
    positionLevel = 'low';
  }
  // 如果PE和PB同时指向高位，强化高位判断
  if (pe > 50 && pb > 5) {
    positionLevel = 'high';
  }

  // 记录位置信息
  metrics.position = positionLevel === 'low' ? '低位' : (positionLevel === 'high' ? '高位' : '中位');

  // 位置本身的得分直接计入
  signalScore += positionScore;

  // 输出估值理由（仅在明显高估或低估时）
  if (pe > 80) {
    reasons.push('PE=' + pe.toFixed(0) + '极高估');
  } else if (pe > 0 && pe < 8) {
    reasons.push('PE=' + pe.toFixed(0) + '极低估');
  }
  if (pb > 8) {
    reasons.push('PB=' + pb.toFixed(1) + '极高');
  } else if (pb > 0 && pb < 0.8) {
    reasons.push('PB=' + pb.toFixed(2) + '破净');
  }

  // ===== 第二步：结合位置上下文分析单日涨跌幅 =====
  // 核心改进：低位的大涨是反转信号，不是见顶信号
  if (Math.abs(changeRate) > 0) {
    metrics.change = (changeRate > 0 ? '+' : '') + changeRate.toFixed(2) + '%';

    if (positionLevel === 'low') {
      // === 低位个股 ===
      if (changeRate > 7) {
        // 低位涨停/大涨：可能是底部反转，不应判为见顶
        reasons.push('低位大涨' + changeRate.toFixed(1) + '%，疑似反转');
        signalScore -= 1; // 反而略微偏向见底
      } else if (changeRate > 4) {
        // 低位中涨：偏多信号
        signalScore -= 1;
      } else if (changeRate < -7) {
        // 低位暴跌：恐慌性抛售，可能是最后一跌
        reasons.push('低位大跌' + changeRate.toFixed(1) + '%，恐慌见底');
        signalScore -= 2;
      } else if (changeRate < -4) {
        signalScore -= 1;
      }
    } else if (positionLevel === 'high') {
      // === 高位个股 ===
      if (changeRate > 7) {
        reasons.push('高位大涨' + changeRate.toFixed(1) + '%过热');
        signalScore += 2;
      } else if (changeRate > 4) {
        reasons.push('高位涨' + changeRate.toFixed(1) + '%偏强');
        signalScore += 1;
      } else if (changeRate < -7) {
        // 高位暴跌：见顶信号！
        reasons.push('高位大跌' + changeRate.toFixed(1) + '%，疑似见顶');
        signalScore += 2;
      } else if (changeRate < -4) {
        signalScore += 1;
      }
    } else {
      // === 中位个股 ===（权重减半）
      if (changeRate > 7) {
        reasons.push('单日涨' + changeRate.toFixed(1) + '%偏强');
        signalScore += 1;
      } else if (changeRate < -7) {
        reasons.push('单日跌' + changeRate.toFixed(1) + '%偏弱');
        signalScore -= 1;
      }
    }
  }

  // ===== 第三步：结合位置上下文分析换手率 =====
  if (turnoverRate > 0) {
    metrics.turnover = turnoverRate.toFixed(1) + '%';

    if (positionLevel === 'high') {
      // 高位高换手+大涨 = 主力出货
      if (turnoverRate > 15 && changeRate > 3) {
        reasons.push('高位高换手' + turnoverRate.toFixed(0) + '%+大涨，疑似出货');
        signalScore += 2;
      } else if (turnoverRate > 20 && changeRate > 0) {
        reasons.push('高位换手' + turnoverRate.toFixed(0) + '%异常高');
        signalScore += 1;
      }
    } else if (positionLevel === 'low') {
      // 低位高换手+大涨 = 主力吸筹（方向反转！）
      if (turnoverRate > 15 && changeRate > 3) {
        reasons.push('低位放量涨，疑似主力吸筹');
        signalScore -= 1;
      } else if (turnoverRate > 15 && changeRate < -3) {
        reasons.push('低位高换手' + turnoverRate.toFixed(0) + '%+大跌，恐慌见底');
        signalScore -= 2;
      }
    } else {
      // 中位：保持原有逻辑但权重降低
      if (turnoverRate > 20 && changeRate > 5) {
        reasons.push('换手' + turnoverRate.toFixed(0) + '%偏高');
        signalScore += 1;
      } else if (turnoverRate > 20 && changeRate < -5) {
        signalScore -= 1;
      }
    }
  }

  // ===== 第四步：振幅分析（结合位置）=====
  if (amplitude > 8) {
    metrics.amplitude = amplitude.toFixed(1) + '%';
    if (positionLevel === 'high' && changeRate > 0) {
      // 高位高振幅：分歧大，见顶风险
      reasons.push('高位振幅' + amplitude.toFixed(0) + '%大');
      signalScore += 1;
    } else if (positionLevel === 'low' && changeRate < 0) {
      // 低位高振幅：恐慌洗盘
      signalScore -= 1;
    }
    // 中位不额外加分
  }

  // ===== 第五步：综合判断 =====
  // 提高见顶门槛：需要更强烈的信号才判为见顶
  var signal, signalCls, advice;
  if (signalScore >= 5) {
    signal = '见顶风险';
    signalCls = 'sell';
    advice = '建议卖出或减仓';
  } else if (signalScore >= 3) {
    signal = '逢高减仓';
    signalCls = 'sell';
    advice = '考虑减仓止盈';
  } else if (signalScore <= -5) {
    signal = '见底机会';
    signalCls = 'buy';
    advice = '建议抄底或加仓';
  } else if (signalScore <= -3) {
    signal = '逢低关注';
    signalCls = 'buy';
    advice = '可考虑少量建仓';
  } else if (signalScore >= 2) {
    signal = '注意风险';
    signalCls = 'watch';
    advice = '走势偏强，留意回调';
  } else if (signalScore <= -2) {
    signal = '值得关注';
    signalCls = 'watch';
    advice = '走势偏弱，关注企稳';
  } else {
    signal = '走势正常';
    signalCls = 'normal';
    advice = '';
  }

  return {
    signal: signal,
    signalCls: signalCls,
    reasons: reasons,
    advice: advice,
    metrics: metrics,
    signalScore: signalScore,
    source: 'quick'
  };
}

/**
 * 深度信号分析（基于K线MA20数据，需要异步获取）
 * 对组合中所有个股执行深度分析
 */
var _lastAnalyzeTime = 0;
var ANALYZE_COOLDOWN = 15 * 1000; // 15秒冷却

function analyzePortfolioSignals() {
  if (_analyzing) {
    showToast('正在分析中，请稍候...');
    return;
  }
  // 冷却检查
  var elapsed = Date.now() - _lastAnalyzeTime;
  if (elapsed < ANALYZE_COOLDOWN) {
    var remain = Math.ceil((ANALYZE_COOLDOWN - elapsed) / 1000);
    showToast('分析冷却中，请' + remain + '秒后再试');
    return;
  }

  var allItems = [];
  _portfolios.forEach(function(p) {
    p.items.forEach(function(item) {
      allItems.push(item);
    });
  });

  if (allItems.length === 0) {
    showToast('组合中暂无个股');
    return;
  }

  _analyzing = true;
  _lastAnalyzeTime = Date.now();
  var btn = document.getElementById('portfolioAnalyzeBtn');
  if (btn) { btn.disabled = true; btn.textContent = '分析中...'; }

  showToast('正在深度分析' + allItems.length + '只个股...');

  // 显示加载状态
  renderPortfolioWithLoading();

  var completed = 0;
  var total = allItems.length;

  // 逐个获取K线数据并分析（利用已有的并发队列，最多2个同时）
  allItems.forEach(function(item) {
    var code = item.code;
    var tencentCode = _codeToTencent(code);

    // 检查K线缓存是否有效（1小时内）
    var cached = _portfolioKlineCache[code];
    if (cached && (Date.now() - cached.timestamp < 3600000)) {
      processDeepSignal(item, cached.maData);
      completed++;
      checkAnalysisDone(completed, total, btn);
    } else {
      fetchKline(tencentCode, 60).then(function(klineData) {
        var maData = calcMAAnalysis(klineData, item.name, _portfolioPriceCache[code] ? _portfolioPriceCache[code].price : 0);
        _portfolioKlineCache[code] = { maData: maData, timestamp: Date.now() };
        processDeepSignal(item, maData);
      }).catch(function() {
        // K线获取失败，降级使用快速信号
        var quickData = _portfolioPriceCache[code];
        if (quickData) {
          var quickSignal = calcQuickSignal(quickData, item);
          _portfolioSignalCache[code] = quickSignal;
        }
      }).then(function() {
        completed++;
        checkAnalysisDone(completed, total, btn);
      });
    }
  });

  // 安全超时：60秒后强制释放锁，防止死锁
  _analyzeSafetyTimer = Perf.trackedSetTimeout(function() {
 if (_analyzing) {
 console.warn('[组合分析] 超时强制释放锁');
 _analyzing = false;
      if (btn) { btn.disabled = false; btn.textContent = '分析信号'; }
      renderPortfolio();
      showToast('部分个股分析超时，已显示已获取的结果');
    }
  }, 60000);
}

var _analyzeSafetyTimer = null;
function checkAnalysisDone(completed, total, btn) {
  if (completed >= total) {
    _analyzing = false;
    if (_analyzeSafetyTimer) { Perf.clearTimeout(_analyzeSafetyTimer); _analyzeSafetyTimer = null; }
    if (btn) { btn.disabled = false; btn.textContent = '分析信号'; }
    renderPortfolio();

    // 统计信号
    var sellCount = 0, buyCount = 0, watchCount = 0;
    Object.keys(_portfolioSignalCache).forEach(function(code) {
      var s = _portfolioSignalCache[code];
      if (s.signalCls === 'sell') sellCount++;
      else if (s.signalCls === 'buy') buyCount++;
      else if (s.signalCls === 'watch') watchCount++;
    });

    var msg = '深度分析完成';
    if (sellCount > 0) msg += ' · ' + sellCount + '只见顶风险';
    if (buyCount > 0) msg += ' · ' + buyCount + '只见底机会';
    showToast(msg);
  }
}

/**
 * 处理深度信号（结合K线MA20和实时数据）
 */
function processDeepSignal(item, maData) {
  var code = item.code;
  var quickData = _portfolioPriceCache[code] || {};
  var reasons = [];
  var signalScore = 0;
  var metrics = {};

  var pe = quickData.pe || 0;
  var pb = quickData.pb || 0;
  var changeRate = quickData.changeRate || 0;
  var turnoverRate = quickData.turnoverRate || 0;

  // ===== 第一步：确定位置（优先使用MA20偏离度，辅以PE/PB）=====
  var positionLevel = 'medium'; // low / medium / high
  var hasMA = maData && maData.ma20 > 0;
  var deviation = hasMA ? maData.deviation : 0;

  // 记录指标
  if (pe > 0) metrics.pe = pe.toFixed(1);
  if (pb > 0) metrics.pb = pb.toFixed(2);
  if (turnoverRate > 0) metrics.turnover = turnoverRate.toFixed(1) + '%';
  if (changeRate !== undefined) metrics.change = (changeRate > 0 ? '+' : '') + changeRate.toFixed(2) + '%';
  if (hasMA) {
    metrics.deviation = (deviation > 0 ? '+' : '') + deviation.toFixed(1) + '%';
    metrics.ma20 = maData.ma20.toFixed(2);
  }

  // 位置判断逻辑：MA20偏离度优先，PE/PB辅助
  if (hasMA) {
    // 有K线数据：以MA20偏离度为主
    if (deviation > 15) {
      positionLevel = 'high';
    } else if (deviation < -5) {
      positionLevel = 'low';
    }
    // PE/PB修正：如果PE极高且PB极高，强制为高位
    if (pe > 50 && pb > 5) positionLevel = 'high';
    // 如果PE极低且PB极低，强制为低位
    if (pe > 0 && pe < 15 && pb > 0 && pb < 1.5) positionLevel = 'low';
  } else {
    // 无K线数据：以PE/PB判断位置
    if (pe > 50 || pb > 5) positionLevel = 'high';
    else if ((pe > 0 && pe < 15) || (pb > 0 && pb < 1.2)) positionLevel = 'low';
  }
  metrics.position = positionLevel === 'low' ? '低位' : (positionLevel === 'high' ? '高位' : '中位');

  // ===== 第二步：MA20偏离度分析（仅在有K线时）=====
  if (hasMA) {
    // 1. 偏离度分析
    if (deviation > 20) {
      reasons.push('偏离MA20 +' + deviation.toFixed(0) + '%严重超买');
      signalScore += 3;
    } else if (deviation > 15) {
      reasons.push('偏离MA20 +' + deviation.toFixed(0) + '%超买');
      signalScore += 2;
    } else if (deviation > 10) {
      reasons.push('偏离MA20 +' + deviation.toFixed(0) + '%偏高');
      signalScore += 1;
    } else if (deviation < -15) {
      reasons.push('偏离MA20 ' + deviation.toFixed(0) + '%超卖');
      signalScore -= 3;
    } else if (deviation < -10) {
      reasons.push('偏离MA20 ' + deviation.toFixed(0) + '%偏低');
      signalScore -= 2;
    } else if (deviation < -5) {
      reasons.push('接近MA20支撑');
      signalScore -= 1;
    }

    // 2. 均线趋势分析
    if (maData.maAlignment === 'bearish' && deviation > 0) {
      // 高位空头排列才危险，低位空头排列是超卖
      reasons.push('均线空头排列');
      signalScore += 1;
    } else if (maData.maAlignment === 'bullish' && deviation < 10) {
      // 多头排列且不过度高：健康趋势
      signalScore -= 1;
      reasons.push('均线多头排列·趋势健康');
    }

    // 3. 连续在MA20之上/之下
    if (maData.aboveMA && maData.consecutiveDays > 20 && deviation > 10) {
      // 只有高位连续在线才危险
      reasons.push('连续' + maData.consecutiveDays + '日在MA20上');
      signalScore += 1;
    } else if (!maData.aboveMA && maData.consecutiveDays > 10) {
      reasons.push('连续' + maData.consecutiveDays + '日在MA20下');
      signalScore -= 1;
    }

    // 4. MA20趋势方向
    if (!maData.maRising && maData.aboveMA && deviation > 10) {
      // 高位MA20走平：可能见顶
      reasons.push('高位MA20走平');
      signalScore += 1;
    } else if (maData.maRising && !maData.aboveMA) {
      // MA20上行+价格回踩：低吸机会
      reasons.push('MA20上行+价格回踩');
      signalScore -= 1;
    }

    // 5. 刚突破/刚跌破（结合位置）
    if (maData.justCrossed && !maData.aboveMA && deviation > 5) {
      // 高位刚跌破：危险
      reasons.push('高位刚跌破MA20');
      signalScore += 2;
    } else if (maData.justCrossed && maData.aboveMA && deviation < 5) {
      // 低位刚站上：反转信号
      reasons.push('低位刚站上MA20');
      signalScore -= 1;
    }
  }

  // ===== 第三步：PE/PB估值分析（位置得分的补充）=====
  if (pe > 0) {
    if (pe > 80) {
      if (reasons.indexOf('PE=' + pe.toFixed(0) + '极高估') === -1) reasons.push('PE=' + pe.toFixed(0) + '极高估');
      signalScore += 2;
    } else if (pe > 0 && pe < 8) {
      if (reasons.indexOf('PE=' + pe.toFixed(0) + '极低估') === -1) reasons.push('PE=' + pe.toFixed(0) + '极低估');
      signalScore -= 2;
    }
  }
  if (pb > 0) {
    if (pb > 8) {
      if (reasons.indexOf('PB=' + pb.toFixed(1) + '极高') === -1) reasons.push('PB=' + pb.toFixed(1) + '极高');
      signalScore += 1;
    } else if (pb > 0 && pb < 0.8) {
      if (reasons.indexOf('PB=' + pb.toFixed(2) + '破净') === -1) reasons.push('PB=' + pb.toFixed(2) + '破净');
      signalScore -= 1;
    }
  }

  // ===== 第四步：结合位置上下文分析单日涨跌幅和换手率 =====
  // 核心：低位的大涨是反转，高位的大涨才是见顶
  if (positionLevel === 'low') {
    // === 低位个股 ===
    if (changeRate > 7) {
      reasons.push('低位大涨' + changeRate.toFixed(1) + '%，疑似反转');
      signalScore -= 1;
    } else if (changeRate > 4) {
      signalScore -= 1;
    }
    if (turnoverRate > 15 && changeRate > 3) {
      reasons.push('低位放量涨，疑似主力吸筹');
      signalScore -= 1;
    } else if (turnoverRate > 15 && changeRate < -3) {
      reasons.push('低位放量跌，恐慌见底');
      signalScore -= 2;
    }
    if (changeRate < -7) {
      reasons.push('低位大跌' + changeRate.toFixed(1) + '%，超跌');
      signalScore -= 1;
    }
  } else if (positionLevel === 'high') {
    // === 高位个股 ===
    if (changeRate > 7) {
      reasons.push('高位大涨' + changeRate.toFixed(1) + '%过热');
      signalScore += 2;
    } else if (changeRate > 4) {
      signalScore += 1;
    }
    if (turnoverRate > 15 && changeRate > 3) {
      reasons.push('高位高换手+大涨，疑似出货');
      signalScore += 2;
    } else if (turnoverRate > 15 && changeRate < -3) {
      reasons.push('高位放量跌，疑似见顶');
      signalScore += 1;
    }
    if (changeRate < -7) {
      reasons.push('高位大跌' + changeRate.toFixed(1) + '%，疑似见顶');
      signalScore += 2;
    }
  } else {
    // === 中位个股 ===（权重减半）
    if (changeRate > 7) {
      reasons.push('单日涨' + changeRate.toFixed(1) + '%偏强');
      signalScore += 1;
    } else if (changeRate < -7) {
      reasons.push('单日跌' + changeRate.toFixed(1) + '%偏弱');
      signalScore -= 1;
    }
    if (turnoverRate > 20 && changeRate > 5) {
      signalScore += 1;
    } else if (turnoverRate > 20 && changeRate < -5) {
      signalScore -= 1;
    }
  }

  // ===== 第五步：综合判断 =====
  // 提高见顶门槛：需要更强烈的信号才判为见顶
  var signal, signalCls, advice;
  if (signalScore >= 5) {
    signal = '见顶风险';
    signalCls = 'sell';
    advice = '建议卖出或减仓';
  } else if (signalScore >= 3) {
    signal = '逢高减仓';
    signalCls = 'sell';
    advice = '考虑减仓止盈';
  } else if (signalScore <= -5) {
    signal = '见底机会';
    signalCls = 'buy';
    advice = '建议抄底或加仓';
  } else if (signalScore <= -3) {
    signal = '逢低关注';
    signalCls = 'buy';
    advice = '可考虑少量建仓';
  } else if (signalScore >= 2) {
    signal = '注意风险';
    signalCls = 'watch';
    advice = '走势偏强，留意回调';
  } else if (signalScore <= -2) {
    signal = '值得关注';
    signalCls = 'watch';
    advice = '走势偏弱，关注企稳';
  } else {
    signal = '走势正常';
    signalCls = 'normal';
    advice = '';
  }

  _portfolioSignalCache[code] = {
    signal: signal,
    signalCls: signalCls,
    reasons: reasons.slice(0, 5), // 最多显示5条理由
    advice: advice,
    metrics: metrics,
    signalScore: signalScore,
    source: 'deep'
  };
}

/**
 * 代码转腾讯格式
 */
function _codeToTencent(code) {
  // 保留港美股前缀
  if (code.indexOf('hk') === 0 || code.indexOf('HK') === 0) return code.toLowerCase();
  if (code.indexOf('us') === 0 || code.indexOf('US') === 0) return code.toLowerCase();
  code = code.replace(/^(sh|sz)/i, '');
  if (code.charAt(0) === '6') return 'sh' + code;
  if (code.charAt(0) === '0' || code.charAt(0) === '3') return 'sz' + code;
  if (code.charAt(0) === '5' || code.charAt(0) === '9') return 'sh' + code;
  return 'sz' + code;
}

/**
 * 渲染组合（带加载状态）
 */
function renderPortfolioWithLoading() {
  var container = document.getElementById('portfolioList');
  if (!container) return;

  var html = '<div class="signal-loading">正在获取K线数据并分析...（支持并发请求）</div>';
  container.innerHTML = html;
}

/* ============================================================
   组合排序与统计功能
   ============================================================ */
var _portfolioSortKey = 'default'; // 当前排序方式

/**
 * 组合排序：对每个组合内的个股按指定方式排序
 * 不修改原始数据顺序，仅影响显示顺序
 */
function sortPortfolio(sortKey) {
  _portfolioSortKey = sortKey;
  // 更新按钮状态
  document.querySelectorAll('.portfolio-sort-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.getAttribute('data-sort') === sortKey);
  });
  renderPortfolio();
}

/**
 * 获取排序后的个股列表（不修改原数组）
 */
function getSortedItems(items) {
  if (_portfolioSortKey === 'default') return items;
  var sorted = items.slice(); // 浅拷贝
  if (_portfolioSortKey === 'changeDesc') {
    sorted.sort(function(a, b) {
      var ca = (_portfolioPriceCache[a.code] || {}).changeRate || 0;
      var cb = (_portfolioPriceCache[b.code] || {}).changeRate || 0;
      return cb - ca;
    });
  } else if (_portfolioSortKey === 'changeAsc') {
    sorted.sort(function(a, b) {
      var ca = (_portfolioPriceCache[a.code] || {}).changeRate || 0;
      var cb = (_portfolioPriceCache[b.code] || {}).changeRate || 0;
      return ca - cb;
    });
  } else if (_portfolioSortKey === 'signal') {
    // 信号优先级：sell > buy > watch > normal
    var priority = { sell: 0, buy: 1, watch: 2, normal: 3 };
    sorted.sort(function(a, b) {
      var sa = (_portfolioSignalCache[a.code] || {}).signalCls || 'normal';
      var sb = (_portfolioSignalCache[b.code] || {}).signalCls || 'normal';
      var pa = priority[sa] !== undefined ? priority[sa] : 3;
      var pb = priority[sb] !== undefined ? priority[sb] : 3;
      if (pa !== pb) return pa - pb;
      // 同级别按涨跌幅
      var ca = (_portfolioPriceCache[a.code] || {}).changeRate || 0;
      var cb = (_portfolioPriceCache[b.code] || {}).changeRate || 0;
      return cb - ca;
    });
  } else if (_portfolioSortKey === 'name') {
    sorted.sort(function(a, b) {
      return (a.name || '').localeCompare(b.name || '', 'zh-CN');
    });
  }
  return sorted;
}

/**
 * 渲染组合统计概览
 */
function renderPortfolioStats() {
  var statsBar = document.getElementById('portfolioStatsBar');
  var toolbar = document.getElementById('portfolioToolbar');
  if (!statsBar || !toolbar) return;
  
  var hasStocks = _portfolios.some(function(p) { return p.items.length > 0; });
  if (!hasStocks) {
    statsBar.style.display = 'none';
    toolbar.style.display = 'none';
    return;
  }
  
  statsBar.style.display = '';
  toolbar.style.display = '';
  
  // 统计数据
  var totalCount = 0;
  var upCount = 0, downCount = 0, flatCount = 0;
  var totalChange = 0;
  var hasPriceData = false;
  
  _portfolios.forEach(function(p) {
    p.items.forEach(function(item) {
      totalCount++;
      var cached = _portfolioPriceCache[item.code];
      if (cached && cached.price > 0) {
        hasPriceData = true;
        var chg = cached.changeRate || 0;
        totalChange += chg;
        if (chg > 0.01) upCount++;
        else if (chg < -0.01) downCount++;
        else flatCount++;
      }
    });
  });
  
  var avgChange = hasPriceData && totalCount > 0 ? (totalChange / totalCount) : 0;
  var avgClass = avgChange >= 0 ? 'up' : 'down';
  var avgStr = (avgChange >= 0 ? '+' : '') + avgChange.toFixed(2) + '%';
  
  var html = '';
  html += '<div class="portfolio-stats-item"><span class="ps-label">持仓</span><span class="ps-val">' + totalCount + '</span></div>';
  if (hasPriceData) {
    html += '<div class="portfolio-stats-item"><span class="ps-label">均涨跌</span><span class="ps-val ' + avgClass + '">' + avgStr + '</span></div>';
    html += '<div class="portfolio-stats-item"><span class="ps-label">涨</span><span class="ps-val up">' + upCount + '</span></div>';
    html += '<div class="portfolio-stats-item"><span class="ps-label">跌</span><span class="ps-val down">' + downCount + '</span></div>';
    if (flatCount > 0) html += '<div class="portfolio-stats-item"><span class="ps-label">平</span><span class="ps-val">' + flatCount + '</span></div>';
  } else {
    html += '<div class="portfolio-stats-item"><span class="ps-label" style="opacity:0.6">点击「刷新行情」获取实时数据</span></div>';
  }
  statsBar.innerHTML = html;
}

/* ============================================================
   组合深度分析引擎
   综合评估持仓组合的整体风险、结构、温度和操作建议
   ============================================================ */

/**
 * 计算组合温度（0-100，越高越热/越危险）
 * 综合因子：高位持仓比例、见顶信号数量、平均涨幅、估值水平
 */
function calcPortfolioTemperature() {
  var allItems = [];
  _portfolios.forEach(function(p) {
    p.items.forEach(function(item) { allItems.push(item); });
  });
  if (allItems.length === 0) return null;

  var total = allItems.length;
  var highCount = 0, lowCount = 0, midCount = 0, unknownCount = 0;
  var sellSignals = 0, buySignals = 0;
  var totalChange = 0, changeCount = 0;
  var highPECount = 0, lowPECount = 0;
  var totalSignalScore = 0, signalScoreCount = 0;

  allItems.forEach(function(item) {
    var sig = _portfolioSignalCache[item.code];
    var price = _portfolioPriceCache[item.code];

    // 位置统计
    if (sig && sig.metrics) {
      var pos = sig.metrics.position;
      if (pos === '高位') highCount++;
      else if (pos === '低位') lowCount++;
      else if (pos === '中位') midCount++;
      else unknownCount++;
    } else {
      unknownCount++;
    }

    // 信号统计
    if (sig) {
      if (sig.signalCls === 'sell') sellSignals++;
      else if (sig.signalCls === 'buy') buySignals++;
      if (typeof sig.signalScore === 'number') {
        totalSignalScore += sig.signalScore;
        signalScoreCount++;
      }
    }

    // 涨跌幅统计
    if (price && price.price > 0) {
      totalChange += (price.changeRate || 0);
      changeCount++;
    }

    // PE统计
    if (price && price.pe > 0) {
      if (price.pe > 50) highPECount++;
      else if (price.pe < 15) lowPECount++;
    }
  });

  // 温度计算公式：
  // 基础温度50，根据各因子加减
  var temp = 50;

  // 因子1：高位持仓比例（权重30%）
  var highRatio = highCount / total;
  temp += highRatio * 30; // 高位占比越高温度越高

  // 因子2：见顶信号比例（权重20%）
  var sellRatio = sellSignals / total;
  temp += sellRatio * 20;

  // 因子3：平均涨幅（权重15%，涨幅越高越热）
  if (changeCount > 0) {
    var avgChange = totalChange / changeCount;
    temp += Math.max(-15, Math.min(15, avgChange * 3));
  }

  // 因子4：信号得分均值（权重20%）
  if (signalScoreCount > 0) {
    var avgScore = totalSignalScore / signalScoreCount;
    temp += Math.max(-20, Math.min(20, avgScore * 5));
  }

  // 因子5：低PE对冲（权重-5%）
  var lowPERatio = lowPECount / total;
  temp -= lowPERatio * 5;

  // 限制范围
  temp = Math.max(0, Math.min(100, Math.round(temp)));

  return {
    temperature: temp,
    total: total,
    highCount: highCount,
    midCount: midCount,
    lowCount: lowCount,
    unknownCount: unknownCount,
    sellSignals: sellSignals,
    buySignals: buySignals,
    watchSignals: 0, // 后面计算
    normalCount: 0,
    highPECount: highPECount,
    lowPECount: lowPECount,
    avgChange: changeCount > 0 ? (totalChange / changeCount) : 0,
    avgSignalScore: signalScoreCount > 0 ? (totalSignalScore / signalScoreCount) : 0
  };
}

/**
 * 根据温度返回标签和颜色
 */
function getTempLabel(temp) {
  if (temp < 25) return { label: '冰点', color: '#00FFC6' };
  if (temp < 40) return { label: '偏冷', color: '#00C8FF' };
  if (temp < 55) return { label: '温和', color: '#7FD858' };
  if (temp < 70) return { label: '偏热', color: '#FFAE00' };
  if (temp < 85) return { label: '过热', color: '#FF6B6B' };
  return { label: '极热', color: '#FF3366' };
}

/**
 * 根据分析结果返回风险评级
 */
function getRiskLevel(data) {
  var highRatio = data.highCount / data.total;
  var sellRatio = data.sellSignals / data.total;
  var score = highRatio * 50 + sellRatio * 50;
  if (score >= 40) return { level: 'high', label: '高风险', icon: '🔴' };
  if (score >= 20) return { level: 'medium', label: '中风险', icon: '🟡' };
  return { level: 'low', label: '低风险', icon: '🟢' };
}

/**
 * 生成组合操作建议
 */
function generatePortfolioAdvice(data) {
  var adviceList = [];
  var allItems = [];
  _portfolios.forEach(function(p) {
    p.items.forEach(function(item) {
      var sig = _portfolioSignalCache[item.code];
      if (sig) allItems.push({ item: item, sig: sig });
    });
  });

  // 减仓建议
  var sellStocks = allItems.filter(function(x) { return x.sig.signalCls === 'sell'; });
  if (sellStocks.length > 0) {
    var stockTags = sellStocks.slice(0, 8).map(function(x) {
      return '<span class="stock-tag">' + escHTML(x.item.name) + '</span>';
    }).join('');
    if (sellStocks.length > 8) stockTags += '<span class="stock-tag">+' + (sellStocks.length - 8) + '</span>';
    adviceList.push({
      type: 'sell',
      title: '建议减仓（' + sellStocks.length + '只见顶风险）',
      stocks: stockTags,
      detail: sellStocks.length >= data.total * 0.3 ? '见顶比例较高，建议整体降低仓位' : '部分个股偏高，逢高减仓锁定利润'
    });
  }

  // 加仓建议
  var buyStocks = allItems.filter(function(x) { return x.sig.signalCls === 'buy'; });
  if (buyStocks.length > 0) {
    var buyTags = buyStocks.slice(0, 8).map(function(x) {
      return '<span class="stock-tag">' + escHTML(x.item.name) + '</span>';
    }).join('');
    if (buyStocks.length > 8) buyTags += '<span class="stock-tag">+' + (buyStocks.length - 8) + '</span>';
    adviceList.push({
      type: 'buy',
      title: '抄底机会（' + buyStocks.length + '只见底信号）',
      stocks: buyTags,
      detail: buyStocks.length >= data.total * 0.3 ? '低位个股较多，可考虑分批建仓' : '个别个股超跌，关注企稳后低吸'
    });
  }

  // 关注建议
  var watchStocks = allItems.filter(function(x) { return x.sig.signalCls === 'watch'; });
  if (watchStocks.length > 0) {
    var watchTags = watchStocks.slice(0, 6).map(function(x) {
      return '<span class="stock-tag">' + escHTML(x.item.name) + '</span>';
    }).join('');
    adviceList.push({
      type: 'watch',
      title: '需要关注（' + watchStocks.length + '只走势异常）',
      stocks: watchTags,
      detail: '这些个股走势偏强或偏弱，留意趋势变化'
    });
  }

  // 持有建议（无信号或正常信号较多时）
  var normalCount = allItems.filter(function(x) { return x.sig.signalCls === 'normal'; }).length;
  if (normalCount > 0 && adviceList.length === 0) {
    adviceList.push({
      type: 'hold',
      title: '持有观望',
      stocks: '',
      detail: '组合整体走势正常，暂无需调仓，继续持有观察'
    });
  } else if (adviceList.length === 0) {
    adviceList.push({
      type: 'hold',
      title: '暂无明确信号',
      stocks: '',
      detail: '点击「分析信号」获取K线深度分析数据'
    });
  }

  // 整体策略总结
  var strategy = '';
  if (data.temperature >= 75) {
    strategy = '组合温度过高，高位个股集中，建议减仓降低风险';
  } else if (data.temperature >= 60) {
    strategy = '组合偏热，注意控制仓位，逢高获利了结';
  } else if (data.temperature <= 25) {
    strategy = '组合处于低位区域，估值偏低，适合分批建仓';
  } else if (data.temperature <= 40) {
    strategy = '组合偏冷，个股多在低位，可逢低布局';
  } else {
    strategy = '组合温度适中，持仓结构均衡，维持现有策略';
  }

  return { list: adviceList, strategy: strategy };
}

/**
 * 渲染组合深度分析面板
 */
function renderPortfolioAnalysis() {
  var panel = document.getElementById('portfolioAnalysisPanel');
  if (!panel) return;

  var hasStocks = _portfolios.some(function(p) { return p.items.length > 0; });
  if (!hasStocks) {
    panel.innerHTML = '';
    return;
  }

  // 检查是否有行情数据
  var hasPriceData = false;
  for (var key in _portfolioPriceCache) {
    if (_portfolioPriceCache[key] && _portfolioPriceCache[key].price > 0) { hasPriceData = true; break; }
  }
  if (!hasPriceData) {
    panel.innerHTML = '';
    return;
  }

  var data = calcPortfolioTemperature();
  if (!data) {
    panel.innerHTML = '';
    return;
  }

  // 补充watch和normal统计
  var watchCount = 0, normalCount = 0;
  Object.keys(_portfolioSignalCache).forEach(function(code) {
    var s = _portfolioSignalCache[code];
    if (s.signalCls === 'watch') watchCount++;
    else if (s.signalCls === 'normal') normalCount++;
  });
  data.watchSignals = watchCount;
  data.normalCount = normalCount;

  var tempInfo = getTempLabel(data.temperature);
  var risk = getRiskLevel(data);
  var advice = generatePortfolioAdvice(data);

  // 判断是否有信号数据
  var hasSignals = Object.keys(_portfolioSignalCache).length > 0;

  var html = '<div class="portfolio-analysis">';
  html += '<div class="pa-header">';
  html += '<span class="pa-title"><span class="pa-title-icon">📊</span>组合深度分析</span>';
  html += '<span class="pa-refresh-hint">' + (hasSignals ? '基于深度信号' : '基于实时行情') + '</span>';
  html += '</div>';
  html += '<div class="pa-body">';

  // 1. 温度计
  html += '<div class="pa-thermometer">';
  html += '<div class="pa-therm-bar">';
  html += '<div class="pa-therm-indicator" style="left:' + data.temperature + '%"></div>';
  html += '</div>';
  html += '<span class="pa-therm-val" style="color:' + tempInfo.color + ';text-shadow:0 0 8px ' + tempInfo.color + '66">' + data.temperature + '</span>';
  html += '<span class="pa-therm-label" style="color:' + tempInfo.color + '">' + tempInfo.label + '</span>';
  html += '</div>';

  // 2. 风险评级 + 策略总结
  html += '<div class="pa-risk-badge ' + risk.level + '">' + risk.icon + ' ' + risk.label + '</div>';
  html += '<div style="font-size:0.54rem;color:var(--ink);opacity:0.85;margin-bottom:0.4rem;line-height:1.5">' + advice.strategy + '</div>';

  // 3. 持仓结构（仅有信号数据时显示）
  if (hasSignals && data.total > 0) {
    var lowPct = (data.lowCount / data.total * 100).toFixed(0);
    var midPct = (data.midCount / data.total * 100).toFixed(0);
    var highPct = (data.highCount / data.total * 100).toFixed(0);
    var unknownPct = (data.unknownCount / data.total * 100).toFixed(0);

    html += '<div class="pa-structure">';
    html += '<div class="pa-structure-label">持仓位置分布</div>';
    html += '<div class="pa-structure-bar">';
    if (data.lowCount > 0) html += '<div class="pa-structure-seg low" style="width:' + lowPct + '%" title="低位 ' + data.lowCount + '只"></div>';
    if (data.midCount > 0) html += '<div class="pa-structure-seg medium" style="width:' + midPct + '%" title="中位 ' + data.midCount + '只"></div>';
    if (data.highCount > 0) html += '<div class="pa-structure-seg high" style="width:' + highPct + '%" title="高位 ' + data.highCount + '只"></div>';
    if (data.unknownCount > 0) html += '<div class="pa-structure-seg unknown" style="width:' + unknownPct + '%" title="未知 ' + data.unknownCount + '只"></div>';
    html += '</div>';
    html += '<div class="pa-structure-legend">';
    html += '<span class="pa-legend-item"><span class="pa-legend-dot" style="background:#00FFC6"></span>低位 ' + data.lowCount + '只</span>';
    html += '<span class="pa-legend-item"><span class="pa-legend-dot" style="background:#FFAE00"></span>中位 ' + data.midCount + '只</span>';
    html += '<span class="pa-legend-item"><span class="pa-legend-dot" style="background:#FF3366"></span>高位 ' + data.highCount + '只</span>';
    if (data.unknownCount > 0) html += '<span class="pa-legend-item"><span class="pa-legend-dot" style="background:var(--muted)"></span>待分析 ' + data.unknownCount + '只</span>';
    html += '</div>';
    html += '</div>';
  }

  // 4. 信号分布迷你图
  if (hasSignals) {
    html += '<div class="pa-signal-dist">';
    html += '<div class="pa-signal-dist-item"><div class="pa-signal-dist-num" style="color:var(--neon-red)">' + data.sellSignals + '</div><div class="pa-signal-dist-label">见顶/减仓</div></div>';
    html += '<div class="pa-signal-dist-item"><div class="pa-signal-dist-num" style="color:var(--neon-green)">' + data.buySignals + '</div><div class="pa-signal-dist-label">见底/抄底</div></div>';
    html += '<div class="pa-signal-dist-item"><div class="pa-signal-dist-num" style="color:var(--neon-yellow)">' + data.watchSignals + '</div><div class="pa-signal-dist-label">关注</div></div>';
    html += '<div class="pa-signal-dist-item"><div class="pa-signal-dist-num" style="color:var(--muted)">' + data.normalCount + '</div><div class="pa-signal-dist-label">正常</div></div>';
    html += '</div>';
  }

  // 5. 操作建议
  if (hasSignals) {
    advice.list.forEach(function(a) {
      html += '<div class="pa-advice ' + a.type + '">';
      html += '<div class="pa-advice-title">' + a.title + '</div>';
      if (a.stocks) html += '<div class="pa-advice-stocks">' + a.stocks + '</div>';
      html += '<div style="font-size:0.5rem;opacity:0.7;margin-top:0.15rem">' + a.detail + '</div>';
      html += '</div>';
    });
  } else {
    html += '<div class="pa-advice hold">';
    html += '<div class="pa-advice-title">点击「分析信号」获取深度分析</div>';
    html += '<div style="font-size:0.5rem;opacity:0.7">深度分析将获取K线数据，计算MA20偏离度、均线趋势等，给出更精准的见顶/见底判断</div>';
    html += '</div>';
  }

  html += '</div>'; // pa-body
  html += '</div>'; // portfolio-analysis
  panel.innerHTML = html;
}

function renderPortfolio() {
  var container = document.getElementById('portfolioList');
  if (!container) return;

  // 更新刷新按钮显示状态
  var refreshBtn = document.getElementById('portfolioRefreshBtn');
  var analyzeBtn = document.getElementById('portfolioAnalyzeBtn');
  var hasStocks = _portfolios.some(function(p) { return p.items.length > 0; });
  if (refreshBtn) refreshBtn.style.display = hasStocks ? '' : 'none';
  if (analyzeBtn) analyzeBtn.style.display = hasStocks ? '' : 'none';

  // 渲染组合统计概览
  renderPortfolioStats();

  // 渲染组合深度分析面板
  renderPortfolioAnalysis();

  if (_portfolios.length === 0) {
    container.innerHTML = '<div class="portfolio-empty"><span class="pe-icon">💼</span>暂无组合<div class="pe-hint">点击「创建组合」开始管理你的持仓</div></div>';
    updatePortfolioSavedTag();
    return;
  }

  // 信号统计摘要
  var sellCount = 0, buyCount = 0, watchCount = 0, normalCount = 0;
  var signalItems = [];
  _portfolios.forEach(function(p) {
    p.items.forEach(function(item) {
      var sig = _portfolioSignalCache[item.code];
      if (sig) {
        if (sig.signalCls === 'sell') { sellCount++; signalItems.push({item: item, sig: sig}); }
        else if (sig.signalCls === 'buy') { buyCount++; signalItems.push({item: item, sig: sig}); }
        else if (sig.signalCls === 'watch') { watchCount++; }
        else { normalCount++; }
      }
    });
  });

  var html = '';

  // 显示信号摘要（当有信号数据时）
  if (Object.keys(_portfolioSignalCache).length > 0 && (sellCount > 0 || buyCount > 0 || watchCount > 0)) {
    html += '<div class="portfolio-signal-summary">';
    html += '<div class="pss-title">组合信号总览</div>';
    if (sellCount > 0) html += '<span class="pss-item"><span class="pss-num sell">' + sellCount + '</span>见顶/减仓</span>';
    if (buyCount > 0) html += '<span class="pss-item"><span class="pss-num buy">' + buyCount + '</span>见底/抄底</span>';
    if (watchCount > 0) html += '<span class="pss-item"><span class="pss-num watch">' + watchCount + '</span>关注</span>';
    if (normalCount > 0) html += '<span class="pss-item"><span class="pss-num normal">' + normalCount + '</span>正常</span>';
    html += '</div>';
  }

  _portfolios.forEach(function(p, pi) {
    html += '<div class="portfolio-group">';
    html += '<div class="portfolio-group-header">';
    html += '<span class="portfolio-group-name">' + p.name + ' (' + p.items.length + '/50)</span>';
    html += '<span class="portfolio-group-del" onclick="deletePortfolio(' + pi + ')">删除</span>';
    html += '</div>';
    if (p.items.length === 0) {
      html += '<div class="portfolio-empty" style="padding:0.4rem">暂无标的，搜索个股后可添加</div>';
    } else {
      // 使用排序后的列表显示（不修改原始数据顺序）
      var displayItems = getSortedItems(p.items);
      displayItems.forEach(function(item) {
        // 查找原始索引（用于删除操作）
        var ii = p.items.indexOf(item);
        var priceData = _portfolioPriceCache[item.code];
        var sig = _portfolioSignalCache[item.code];
        var priceHtml = '';
        if (priceData && priceData.price > 0) {
          var changeClass = priceData.changeRate >= 0 ? 'up' : 'down';
          var changeStr = (priceData.changeRate >= 0 ? '+' : '') + priceData.changeRate.toFixed(2) + '%';
          priceHtml = '<div class="pi-right">' +
            '<span class="pi-price">' + priceData.price.toFixed(2) + '</span>' +
            '<span class="pi-change ' + changeClass + '">' + changeStr + '</span>' +
            '</div>';
        }

        // 信号标签
        var signalBadgeHtml = '';
        var itemCls = 'portfolio-item';
        if (sig && sig.signalCls !== 'normal') {
          signalBadgeHtml = '<span class="pi-signal-badge ' + sig.signalCls + '">' + sig.signal + '</span>';
          itemCls += ' has-signal ' + sig.signalCls;
        } else if (sig) {
          signalBadgeHtml = '<span class="pi-signal-badge normal">' + sig.signal + '</span>';
        }

        // 指标行
        var metricsHtml = '';
        if (sig && sig.metrics) {
          var m = sig.metrics;
          var parts = [];
          if (m.position) {
            var posColor = m.position === '低位' ? 'rgba(0,229,136,0.7)' : (m.position === '高位' ? 'rgba(255,71,87,0.7)' : 'rgba(128,128,128,0.6)');
            parts.push('<span style="color:' + posColor + ';font-weight:600">' + m.position + '</span>');
          }
          if (m.pe) parts.push('<span class="metric-pe">PE ' + m.pe + '</span>');
          if (m.pb) parts.push('<span class="metric-pb">PB ' + m.pb + '</span>');
          if (m.turnover) parts.push('<span class="metric-turnover">换手 ' + m.turnover + '</span>');
          if (m.deviation) parts.push('<span style="color:rgba(0,229,255,0.5)">偏离 ' + m.deviation + '</span>');
          if (parts.length > 0) {
            metricsHtml = '<div class="pi-metrics">' + parts.join('') + '</div>';
          }
        }

        // 信号详情（理由+建议）
        var detailHtml = '';
        if (sig && sig.reasons && sig.reasons.length > 0 && sig.signalCls !== 'normal') {
          var detail = sig.reasons.join('；');
          if (sig.advice) detail += ' → ' + sig.advice;
          detailHtml = '<div class="pi-signal-detail ' + sig.signalCls + '">' + detail + '</div>';
        }

        html += '<div class="' + itemCls + '" data-pf-code="' + escHTML(item.code) + '" data-pf-name="' + escHTML(item.name) + '">' +
          '<div class="pi-content">' +
            '<div class="pi-left">' +
              '<span class="pi-code">' + item.code + '</span>' +
              '<span class="pi-name">' + escHTML(item.name) + '</span>' +
              signalBadgeHtml +
            '</div>' +
            metricsHtml +
            detailHtml +
          '</div>' +
          priceHtml +
          '<span class="pi-remove" data-pf-remove="' + pi + ':' + ii + '">×</span>' +
        '</div>';
      });
    }
    html += '</div>';
  });
  container.innerHTML = html;
  // 绑定事件委托：点击个股跳转搜索，点击×移除
  bindPortfolioItemEvents(container);
  updatePortfolioSavedTag();
}

function bindPortfolioItemEvents(container) {
  if (!container) return;
  container.querySelectorAll('[data-pf-code]').forEach(function(item) {
    item.addEventListener('click', function(e) {
      // 如果点击的是删除按钮，不跳转
      if (e.target.closest('[data-pf-remove]')) {
        e.stopPropagation();
        var removeData = e.target.closest('[data-pf-remove]').getAttribute('data-pf-remove');
        var parts = removeData.split(':');
        removeFromPortfolio(parseInt(parts[0]), parseInt(parts[1]));
        return;
      }
      var code = item.getAttribute('data-pf-code');
      var name = item.getAttribute('data-pf-name');
      searchFromPortfolio(code, name);
    });
  });
}

