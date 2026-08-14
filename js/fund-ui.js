/* ============================================================
   基金功能 UI（fund-ui.js）
   - 多维筛选：类型/风险等级R1-R5/晨星评级/基金公司/规模区间/成立日期区间
   - 排序：单位净值/日涨跌幅/近1月/近3月/近6月/近1年/夏普比率
   - 分页：每页20条
   - 详情：净值曲线(1M/3M/6M/1Y/3Y/5Y)/持仓行业/前十大重仓/经理履历/费率/风险收益/同类排名
   两种模式：
   - 关键词模式：代码/名称/经理/公司 → 搜索API+全量库匹配 → 基础信息增强 → 客户端筛选排序分页
   - 浏览模式：无关键词 → 全量基金库(fundcode_search.js) → 类型过滤 → 增强当前页/高级筛选增强前150只
   ============================================================ */
var FundUI = (function() {
  'use strict';

  var state = {
    keyword: '',
    type: 'all',
    riskSet: [],      // ['1','2',...]
    rating: 0,        // 0=不限, 5=五星
    company: '',      // 公司名
    manager: '',      // 基金经理
    scaleMin: null,   // 亿元
    scaleMax: null,
    dateFrom: '',     // YYYY-MM-DD
    dateTo: '',
    sort: 'dwjz',
    order: 'desc',
    page: 1,
    size: 20,
    loading: false
  };

  var TYPE_MAP = {
    all: '全部', gp: '股票型', hh: '混合型', zq: '债券型',
    zs: '指数型', qdii: 'QDII', fof: 'FOF', hb: '货币型',
    lof: 'LOF', closed: '封闭式'
  };

  var SORT_OPTIONS = [
    { key: 'dwjz', label: '单位净值' },
    { key: 'rzzf', label: '日涨跌幅' },
    { key: 'ret1m', label: '近1月' },
    { key: 'ret3m', label: '近3月' },
    { key: 'ret6m', label: '近6月' },
    { key: 'ret1y', label: '近1年' },
    { key: 'sharp', label: '夏普比率' }
  ];

  var _companies = [];
  var _searchSeq = 0;  // 请求序列号，防止旧请求覆盖新结果

  /* ---------- 初始化 ---------- */
  function init() {
    bindEvents();
    // 预加载基金公司列表
    FundData.companyList().then(function(list) {
      _companies = list || [];
      var sel = document.getElementById('fundFilterCompany');
      if (sel && _companies.length) {
        sel.innerHTML = '<option value="">基金公司</option>' +
          _companies.map(function(c) { return '<option value="' + esc(c.name) + '">' + esc(c.name) + '</option>'; }).join('');
      }
    }).catch(function() {});
    // 首次加载时提示正在下载数据库
    var loadingEl = document.getElementById('fundListLoading');
    if (loadingEl) {
      loadingEl.innerHTML = '<span class="fdl-spinner"></span>正在加载基金数据库（约3MB，首次需数秒）...';
      loadingEl.style.display = 'flex';
    }
    load();
  }

  function bindEvents() {
    var get = function(id) { return document.getElementById(id); };
    var kw = get('fundSearchInput');
    var btn = get('fundSearchBtn');
    if (kw) kw.addEventListener('keydown', function(e) { if (e.key === 'Enter') { state.keyword = kw.value.trim(); doSearch(); } });
    if (btn) btn.addEventListener('click', function() { state.keyword = kw.value.trim(); doSearch(); });

    var typeSel = get('fundFilterType');
    if (typeSel) typeSel.addEventListener('change', function() { state.type = typeSel.value; state.page = 1; doSearch(); });

    var companySel = get('fundFilterCompany');
    if (companySel) companySel.addEventListener('change', function() { state.company = companySel.value; state.page = 1; doSearch(); });

    var riskGroup = get('fundRiskGroup');
    if (riskGroup) riskGroup.addEventListener('click', function(e) {
      var t = e.target;
      if (t && t.tagName === 'BUTTON') {
        t.classList.toggle('active');
        state.riskSet = Array.prototype.map.call(
          riskGroup.querySelectorAll('button.active'), function(b) { return b.getAttribute('data-risk'); });
        state.page = 1; doSearch();
      }
    });

    var ratingGroup = get('fundRatingGroup');
    if (ratingGroup) ratingGroup.addEventListener('click', function(e) {
      var t = e.target;
      if (t && t.tagName === 'BUTTON') {
        Array.prototype.forEach.call(ratingGroup.querySelectorAll('button'), function(b) { b.classList.remove('active'); });
        t.classList.add('active');
        state.rating = parseInt(t.getAttribute('data-rating'), 10) || 0;
        state.page = 1; doSearch();
      }
    });

    var scaleMin = get('fundScaleMin'), scaleMax = get('fundScaleMax');
    if (scaleMin) scaleMin.addEventListener('change', function() { state.scaleMin = numOrNull(scaleMin.value); state.page = 1; doSearch(); });
    if (scaleMax) scaleMax.addEventListener('change', function() { state.scaleMax = numOrNull(scaleMax.value); state.page = 1; doSearch(); });

    var dateFrom = get('fundDateFrom'), dateTo = get('fundDateTo');
    if (dateFrom) dateFrom.addEventListener('change', function() { state.dateFrom = dateFrom.value; state.page = 1; doSearch(); });
    if (dateTo) dateTo.addEventListener('change', function() { state.dateTo = dateTo.value; state.page = 1; doSearch(); });

    // 基金经理输入（防抖 500ms）
    var mgrInput = get('fundManagerInput');
    if (mgrInput) {
      var mgrTimer = null;
      mgrInput.addEventListener('input', function() {
        if (mgrTimer) clearTimeout(mgrTimer);
        mgrTimer = setTimeout(function() {
          state.manager = mgrInput.value.trim();
          state.page = 1;
          doSearch();
        }, 500);
      });
    }

    var sortSel = get('fundSortSel');
    if (sortSel) sortSel.addEventListener('change', function() {
      state.sort = sortSel.value;
      state.order = (sortSel.value === 'dwjz' || sortSel.value === 'rzzf') ? 'desc' : 'desc';
      state.page = 1; doSearch();
    });

    var orderBtn = get('fundOrderBtn');
    if (orderBtn) orderBtn.addEventListener('click', function() {
      state.order = state.order === 'desc' ? 'asc' : 'desc';
      orderBtn.textContent = state.order === 'desc' ? '↓ 降序' : '↑ 升序';
      state.page = 1; doSearch();
    });

    var resetBtn = get('fundFilterReset');
    if (resetBtn) resetBtn.addEventListener('click', function() { resetFilters(); });

    if (kw) kw.value = '';
  }

  function resetFilters() {
    state.keyword = ''; state.type = 'all'; state.riskSet = []; state.rating = 0;
    state.company = ''; state.manager = ''; state.scaleMin = null; state.scaleMax = null;
    state.dateFrom = ''; state.dateTo = ''; state.sort = 'dwjz'; state.order = 'desc'; state.page = 1;
    var get = function(id) { return document.getElementById(id); };
    var kw = get('fundSearchInput'); if (kw) kw.value = '';
    var typeSel = get('fundFilterType'); if (typeSel) typeSel.value = 'all';
    var companySel = get('fundFilterCompany'); if (companySel) companySel.value = '';
    var mgrInput = get('fundManagerInput'); if (mgrInput) mgrInput.value = '';
    var rg = get('fundRiskGroup'); if (rg) Array.prototype.forEach.call(rg.querySelectorAll('button'), function(b) { b.classList.remove('active'); });
    var rtg = get('fundRatingGroup'); if (rtg) Array.prototype.forEach.call(rtg.querySelectorAll('button'), function(b) { b.classList.remove('active'); });
    var rtgActive = get('fundRatingGroup'); if (rtgActive) { var btn = rtgActive.querySelector('button[data-rating="0"]'); if (btn) btn.classList.add('active'); }
    var sm = get('fundScaleMin'), sx = get('fundScaleMax'); if (sm) sm.value = ''; if (sx) sx.value = '';
    var df = get('fundDateFrom'), dt = get('fundDateTo'); if (df) df.value = ''; if (dt) dt.value = '';
    var ss = get('fundSortSel'); if (ss) ss.value = 'dwjz';
    var ob = get('fundOrderBtn'); if (ob) ob.textContent = '↓ 降序';
    load();
  }

  function doSearch() {
    _searchSeq++;  // 新请求，旧请求的结果将被忽略
    state.loading = false;  // 允许新搜索（即使旧请求还在进行中）
    if (state.keyword) {
      loadSearchMode(state.keyword);
    } else if (state.manager) {
      // 有经理筛选但没有搜索关键词 → 独立经理搜索流程
      // searchManager(m=7) 找到经理ID → managerFunds 获取管理的基金列表
      loadManagerMode(state.manager);
    } else {
      load();
    }
  }

  /* 是否需要高级增强（财务字段排序 / 规模 风险 评级 日期 公司 经理筛选） */
  function needAdvancedCriteria() {
    return state.sort !== 'dwjz' || state.scaleMin != null || state.scaleMax != null ||
      state.riskSet.length > 0 || state.rating > 0 || state.dateFrom || state.dateTo || state.company || state.manager;
  }

  /* ---------- 浏览模式（fundcode_search.js 全量库 + 客户端处理） ---------- */
  function load() {
    if (state.loading) return;
    state.loading = true;
    var mySeq = _searchSeq;
    showListLoading(true);
    FundData.loadUniverse().then(function(universe) {
      if (mySeq !== _searchSeq) return;  // 被新搜索取消
      // 1. 类型过滤
      var candidates = universe.filter(function(u) {
        return state.type === 'all' || u.cat === state.type;
      });
      // 2. 关键词过滤（代码/名称/拼音）
      var kw = state.keyword.trim();
      if (kw) candidates = candidates.filter(function(u) {
        return u.code.indexOf(kw) >= 0 || u.name.indexOf(kw) >= 0 ||
          (u.pinyin || '').toLowerCase().indexOf(kw.toLowerCase()) >= 0;
      });

      // 3. 有财务排序或高级筛选 → 增强候选池后统一处理
      if (needAdvancedCriteria()) {
        var codes = candidates.map(function(u) { return u.code; });
        return FundData.enrichBatch(codes, 150).then(function(rows) {
          if (mySeq !== _searchSeq) return;  // 被新搜索取消
          var filtered = applyClientFilters(rows);
          applyClientSort(filtered);
          var pages = Math.max(1, Math.ceil(filtered.length / state.size));
          var page = Math.min(state.page, pages);
          var start = (page - 1) * state.size;
          renderList(filtered.slice(start, start + state.size), filtered.length, pages, page, true);
          showListLoading(false);
          state.loading = false;
        });
      }

      // 4. 无财务筛选：按代码序分页，仅增强当前页用于展示
      var pages = Math.max(1, Math.ceil(candidates.length / state.size));
      var page = Math.min(state.page, pages);
      var start = (page - 1) * state.size;
      var pageFunds = candidates.slice(start, start + state.size);
      var pageCodes = pageFunds.map(function(u) { return u.code; });
      return FundData.enrichBatch(pageCodes, state.size).then(function(rows) {
        if (mySeq !== _searchSeq) return;  // 被新搜索取消
        var merged = pageFunds.map(function(u) {
          var enr = null;
          for (var i = 0; i < rows.length; i++) { if (rows[i].code === u.code) { enr = rows[i]; break; } }
          return Object.assign({ code: u.code, name: u.name, cat: u.cat }, enr || {});
        });
        renderList(merged, candidates.length, pages, page, false);
        showListLoading(false);
        state.loading = false;
      });
    }).catch(function(err) {
      if (mySeq !== _searchSeq) return;
      showListLoading(false);
      showListError('加载失败：' + (err && err.message ? err.message : '网络异常'));
      state.loading = false;
    });
  }

  /* ---------- 关键词模式（搜索接口：代码/名称/基金经理/基金公司 + 全量库补充） ---------- */
  function loadSearchMode(searchKeyword) {
    if (state.loading) return;
    state.loading = true;
    var mySeq = _searchSeq;
    var keyword = searchKeyword || state.keyword;
    showListLoading(true, '正在搜索「' + keyword + '」...');
    Promise.all([
      FundData.loadUniverse().then(function(u) {
        var kw = keyword.trim();
        return u.filter(function(x) {
          return x.code.indexOf(kw) >= 0 || x.name.indexOf(kw) >= 0 ||
            (x.pinyin || '').toLowerCase().indexOf(kw.toLowerCase()) >= 0;
        }).map(function(x) { return x.code; });
      }).catch(function() { return []; }),
      FundData.search(keyword).then(function(found) {
        return (found || []).map(function(f) { return f.code; });
      }).catch(function() { return []; })
    ]).then(function(parts) {
      if (mySeq !== _searchSeq) return;  // 被新搜索取消
      var codes = Array.prototype.concat.apply([], parts);
      codes = codes.filter(function(c, i) { return c && codes.indexOf(c) === i; }).slice(0, 60);
      if (codes.length === 0) {
        renderList([], 0, 0, 1, true);
        showListLoading(false);
        var el = document.getElementById('fundListEmpty');
        if (el) { el.style.display = 'flex'; el.textContent = '未找到匹配的基金，请检查代码/名称/基金经理/基金公司'; }
        state.loading = false;
        return;
      }
      return FundData.enrichBatch(codes, 60).then(function(rows) {
        if (mySeq !== _searchSeq) return;  // 被新搜索取消
        // 类型过滤（使用 cat 分类字段，而非 fundType 编码）
        if (state.type !== 'all') { rows = rows.filter(function(r) { return r.cat === state.type; }); }
        var filtered = applyClientFilters(rows);
        applyClientSort(filtered);
        var pages = Math.max(1, Math.ceil(filtered.length / state.size));
        var page = Math.min(state.page, pages);
        var start = (page - 1) * state.size;
        renderList(filtered.slice(start, start + state.size), filtered.length, pages, page, true);
        showListLoading(false);
        state.loading = false;
      });
    }).catch(function(err) {
      if (mySeq !== _searchSeq) return;
      showListLoading(false);
      showListError('搜索失败：' + (err && err.message ? err.message : '网络异常'));
      state.loading = false;
    });
  }

  /* ---------- 经理模式（searchManager m=7 → managerFunds 获取基金列表） ---------- */
  function loadManagerMode(managerName) {
    if (state.loading) return;
    state.loading = true;
    var mySeq = _searchSeq;
    showListLoading(true, '正在搜索基金经理「' + managerName + '」...');

    FundData.searchManager(managerName).then(function(managers) {
      if (mySeq !== _searchSeq) return;
      if (!managers || managers.length === 0) {
        renderList([], 0, 0, 1, true);
        showListLoading(false);
        var el = document.getElementById('fundListEmpty');
        if (el) { el.style.display = 'flex'; el.textContent = '未找到基金经理「' + managerName + '」'; }
        state.loading = false;
        return;
      }

      // 取第一个匹配的经理
      var mgr = managers[0];
      showListLoading(true, '正在获取「' + mgr.mgrName + '」管理的基金列表...');

      // 获取经理管理的基金列表
      return FundData.managerFunds(mgr.mgrId).then(function(funds) {
        if (mySeq !== _searchSeq) return;
        if (!funds || funds.length === 0) {
          renderList([], 0, 0, 1, true);
          showListLoading(false);
          var el2 = document.getElementById('fundListEmpty');
          if (el2) {
            el2.style.display = 'flex';
            el2.textContent = '无法获取「' + mgr.mgrName + '」管理的基金列表（网络限制）。请尝试用基金代码/名称搜索。';
          }
          state.loading = false;
          return;
        }

        // 提取基金代码并增强
        var codes = funds.map(function(f) { return f.code; });
        return FundData.enrichBatch(codes, codes.length).then(function(rows) {
          if (mySeq !== _searchSeq) return;
          // 类型过滤
          if (state.type !== 'all') { rows = rows.filter(function(r) { return r.cat === state.type; }); }
          var filtered = applyClientFilters(rows);
          applyClientSort(filtered);
          var pages = Math.max(1, Math.ceil(filtered.length / state.size));
          var page = Math.min(state.page, pages);
          var start = (page - 1) * state.size;
          renderList(filtered.slice(start, start + state.size), filtered.length, pages, page, true);
          showListLoading(false);
          state.loading = false;
        });
      });
    }).catch(function(err) {
      if (mySeq !== _searchSeq) return;
      showListLoading(false);
      showListError('经理搜索失败：' + (err && err.message ? err.message : '网络异常'));
      state.loading = false;
    });
  }

  /* ---------- 客户端过滤（风险/评级/规模/日期/经理/公司） ---------- */
  function applyClientFilters(rows) {
    var s = state;
    return (rows || []).filter(function(r) {
      // 风险等级：筛选激活时排除无风险等级的基金
      if (s.riskSet.length && (!r.riskLevel || s.riskSet.indexOf(String(r.riskLevel)) < 0)) return false;
      // 晨星评级：筛选激活时排除无评级的基金
      if (s.rating > 0 && (!r.rating || parseInt(r.rating, 10) < s.rating)) return false;
      // 基金公司
      if (s.company && (!r.company || r.company.indexOf(s.company) < 0)) return false;
      // 规模区间
      if (s.scaleMin != null && (r.scaleYi == null || r.scaleYi < s.scaleMin)) return false;
      if (s.scaleMax != null && (r.scaleYi == null || r.scaleYi > s.scaleMax)) return false;
      // 成立日期区间
      if (s.dateFrom) {
        var dFrom = s.dateFrom.replace(/-/g, '');
        var dEst = r.estabDate ? String(r.estabDate).replace(/-/g, '') : '';
        if (dEst && dEst < dFrom) return false;
      }
      if (s.dateTo) {
        var dTo = s.dateTo.replace(/-/g, '');
        var dEst2 = r.estabDate ? String(r.estabDate).replace(/-/g, '') : '';
        if (dEst2 && dEst2 > dTo) return false;
      }
      // 基金经理
      if (s.manager && (!r.manager || r.manager.indexOf(s.manager) < 0)) return false;
      return true;
    });
  }

  function applyClientSort(rows) {
    var key = state.sort;
    var dir = state.order === 'asc' ? 1 : -1;
    rows.sort(function(a, b) {
      var av, bv;
      if (key === 'dwjz') { av = a.unitNav; bv = b.unitNav; }
      else if (key === 'rzzf') { av = a.dayChange; bv = b.dayChange; }
      else if (key === 'ret1m') { av = a.ret1m; bv = b.ret1m; }
      else if (key === 'ret3m') { av = a.ret3m; bv = b.ret3m; }
      else if (key === 'ret6m') { av = a.ret6m; bv = b.ret6m; }
      else if (key === 'ret1y') { av = a.ret1y; bv = b.ret1y; }
      else if (key === 'sharp') { av = a.sharp; bv = b.sharp; }
      else { av = a.unitNav; bv = b.unitNav; }
      if (av == null) av = -Infinity;
      if (bv == null) bv = -Infinity;
      if (av === bv) return 0;
      return av > bv ? dir : -dir;
    });
  }

  /* ---------- 渲染列表 ---------- */
  function renderList(rows, total, pages, page, enrichedMode) {
    state.page = page;
    var body = document.getElementById('fundListBody');
    var empty = document.getElementById('fundListEmpty');
    var count = document.getElementById('fundCount');
    var sortInfo = document.getElementById('fundSortInfo');
    if (!body) return;

    if (count) count.textContent = '共 ' + total + ' 只基金';
    if (sortInfo) {
      var label = '';
      SORT_OPTIONS.forEach(function(o) { if (o.key === state.sort) label = o.label; });
      var hint = '';
      if (enrichedMode) {
        hint = '· 已加载前' + total + '只符合条件的基金';
      } else if (total > 100) {
        hint = '· 按代码序浏览，可搜索精确查找';
      }
      sortInfo.textContent = '按「' + label + (state.order === 'desc' ? '降序' : '升序') + '」' + hint;
    }

    if (empty) empty.style.display = (rows.length === 0) ? 'flex' : 'none';
    body.innerHTML = '';

    rows.forEach(function(r) {
      body.appendChild(renderRow(r));
    });

    renderPagination(pages, page);
  }

  function renderRow(r) {
    var tr = document.createElement('div');
    tr.className = 'fund-row';
    tr.addEventListener('click', function() { openDetail(r.code, r.name, r.manageFee); });

    var chg = r.dayChange;
    var chgCls = chg > 0 ? 'up' : (chg < 0 ? 'down' : 'flat');
    var chgStr = (chg != null && !isNaN(chg)) ? (chg > 0 ? '+' : '') + chg.toFixed(2) + '%' : '--';

    var riskStr = r.riskLevel ? 'R' + r.riskLevel : '--';
    var ratingStr = r.rating ? Array(parseInt(r.rating, 10) || 0).join('★') : '--';
    var scaleStr = (r.scaleYi != null && !isNaN(r.scaleYi)) ? r.scaleYi.toFixed(2) + '亿' : '--';
    var ret = function(v) {
      if (v == null || isNaN(v)) return '<span class="fund-cell-muted">--</span>';
      var cls = v > 0 ? 'up' : (v < 0 ? 'down' : 'flat');
      return '<span class="' + cls + '">' + (v > 0 ? '+' : '') + v.toFixed(2) + '%</span>';
    };

    tr.innerHTML =
      '<div class="fund-row-main">' +
        '<div class="fund-name">' + esc(r.name) + '<span class="fund-code">' + esc(r.code) + '</span></div>' +
        '<div class="fund-tags">' +
          '<span class="fund-tag">' + esc(r.type || (TYPE_MAP[r.fundType] || '基金')) + '</span>' +
          (r.company ? '<span class="fund-tag fund-tag-company">' + esc(r.company) + '</span>' : '') +
          (r.manager ? '<span class="fund-tag fund-tag-mgr">' + esc(r.manager) + '</span>' : '') +
          '<span class="fund-tag">风险' + riskStr + '</span>' +
          '<span class="fund-tag fund-tag-rating">' + ratingStr + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="fund-row-quote">' +
        '<div class="fund-nav">' + (r.unitNav != null ? r.unitNav.toFixed(4) : '--') +
          '<span class="fund-chg ' + chgCls + '">' + chgStr + '</span></div>' +
        '<div class="fund-meta">规模 ' + scaleStr + '</div>' +
      '</div>' +
      '<div class="fund-row-rets">' +
        '<div class="fund-ret-col"><span class="fund-ret-label">近1月</span>' + ret(r.ret1m) + '</div>' +
        '<div class="fund-ret-col"><span class="fund-ret-label">近3月</span>' + ret(r.ret3m) + '</div>' +
        '<div class="fund-ret-col"><span class="fund-ret-label">近6月</span>' + ret(r.ret6m) + '</div>' +
        '<div class="fund-ret-col"><span class="fund-ret-label">近1年</span>' + ret(r.ret1y) + '</div>' +
      '</div>';
    return tr;
  }

  function renderPagination(pages, page) {
    var wrap = document.getElementById('fundPagination');
    if (!wrap) return;
    if (pages <= 1) {
      wrap.innerHTML = '<span class="fund-page-info">第 1 / 1 页</span>';
      return;
    }
    var prev = '<button class="fund-page-btn" ' + (page <= 1 ? 'disabled' : '') + ' data-page="' + (page - 1) + '">‹</button>';
    var next = '<button class="fund-page-btn" ' + (page >= pages ? 'disabled' : '') + ' data-page="' + (page + 1) + '">›</button>';
    var nums = pageNums(page, pages);
    var html = prev + '<span class="fund-page-info">第 ' + page + ' / ' + pages + ' 页</span>';
    nums.forEach(function(n) {
      html += '<button class="fund-page-btn' + (n === page ? ' active' : '') + '" data-page="' + n + '">' + n + '</button>';
    });
    // 页码跳转输入（页数多时显示）
    if (pages > 10) {
      html += '<input type="number" class="fund-page-jump" min="1" max="' + pages + '" placeholder="跳转" value="' + page + '" id="fundPageJump">';
      html += '<button class="fund-page-btn" id="fundPageJumpBtn">Go</button>';
    }
    html += next;
    wrap.innerHTML = html;
    Array.prototype.forEach.call(wrap.querySelectorAll('[data-page]'), function(b) {
      b.addEventListener('click', function() {
        if (b.disabled) return;
        var p = parseInt(b.getAttribute('data-page'), 10);
        if (p >= 1 && p <= pages) { state.page = p; doSearch(); }
      });
    });
    // 跳转按钮
    var jumpBtn = document.getElementById('fundPageJumpBtn');
    var jumpInput = document.getElementById('fundPageJump');
    if (jumpBtn && jumpInput) {
      function doJump() {
        var p = parseInt(jumpInput.value, 10);
        if (p >= 1 && p <= pages) { state.page = p; doSearch(); }
      }
      jumpBtn.addEventListener('click', doJump);
      jumpInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') doJump(); });
    }
  }

  function pageNums(cur, total) {
    var nums = [];
    var start = Math.max(1, cur - 2);
    var end = Math.min(total, cur + 2);
    for (var i = start; i <= end; i++) nums.push(i);
    return nums;
  }

  /* ---------- 详情 ---------- */
  function openDetail(code, name, manageFee) {
    var view = document.getElementById('fundDetailView');
    var list = document.getElementById('fundListWrap');
    if (view && list) {
      list.style.display = 'none';
      view.style.display = 'block';
      view.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    var detail = document.getElementById('fundDetail');
    if (detail) {
      detail.innerHTML = '<div class="fund-detail-loading">正在加载基金详情 <span class="fdl-spinner"></span></div>';
    }
    var backBtn = document.getElementById('fundDetailBack');
    if (backBtn) { backBtn.style.display = 'inline-flex'; backBtn.onclick = function() { closeDetail(); }; }

    // 并行加载基础信息 + 净值/经理数据 + 持仓/行业
    Promise.all([
      FundData.basicInfo(code),
      FundData.pingzhong(code),
      FundData.holdingsAndIndustry(code)
    ]).then(function(res) {
      renderDetail(res[0], res[1], code, res[2].holdings, res[2].industry, manageFee);
    }).catch(function(err) {
      var detailEl = document.getElementById('fundDetail');
      if (detailEl) detailEl.innerHTML = '<div class="fund-detail-error">详情加载失败：' + esc((err && err.message) || '网络异常') + '</div>';
    });
  }

  function closeDetail() {
    var view = document.getElementById('fundDetailView');
    var list = document.getElementById('fundListWrap');
    var backBtn = document.getElementById('fundDetailBack');
    if (view) view.style.display = 'none';
    if (list) list.style.display = 'block';
    if (backBtn) backBtn.style.display = 'none';
  }

  function renderDetail(b, p, code, holdings, ind, manageFee) {
    var detail = document.getElementById('fundDetail');
    if (!detail || !b) { return; }
    var name = b.name || code;
    document.title = name + ' · 基金详情';

    var chg = b.dayChange;
    var chgCls = chg > 0 ? 'up' : (chg < 0 ? 'down' : 'flat');
    var chgStr = (chg != null && !isNaN(chg)) ? (chg > 0 ? '+' : '') + chg.toFixed(2) + '%' : '--';

    var html = '';
    html += '<div class="fund-detail-header">';
    html += '<div class="fund-detail-title">' + esc(name) + '<span class="fund-code-lg">' + esc(code) + '</span></div>';
    html += '<div class="fund-detail-sub">' + esc(b.type || '') + (b.company ? ' · ' + esc(b.company) : '') + (b.manager ? ' · 经理 ' + esc(b.manager) : '') + '</div>';
    html += '<div class="fund-detail-quote">';
    html += '<span class="fund-detail-nav">' + (b.unitNav != null ? b.unitNav.toFixed(4) : '--') + '</span>';
    html += '<span class="fund-detail-chg ' + chgCls + '">' + chgStr + '</span>';
    html += '<span class="fund-detail-date">' + (b.date || '') + '</span>';
    html += '</div>';
    html += '<div class="fund-detail-badges">';
    html += '<span class="fdb fdb-risk">风险等级 R' + (b.riskLevel || '-') + '</span>';
    html += '<span class="fdb fdb-rating">晨星 ' + (b.rating ? Array(parseInt(b.rating, 10) || 0).join('★') : '--') + '</span>';
    html += '<span class="fdb">规模 ' + (b.scaleYi != null ? b.scaleYi.toFixed(2) + '亿' : '--') + '</span>';
    html += '<span class="fdb">成立 ' + (b.estabDate || '--') + '</span>';
    html += '</div>';
    html += '<div class="fund-detail-rets">';
    ['ret1w', 'ret1m', 'ret3m', 'ret6m', 'ret1y', 'ret3y', 'retYear', 'retAll'].forEach(function(k) {
      var labelMap = { ret1w: '近1周', ret1m: '近1月', ret3m: '近3月', ret6m: '近6月', ret1y: '近1年', ret3y: '近3年', retYear: '今年来', retAll: '成立来' };
      var v = b[k];
      var cls = v > 0 ? 'up' : (v < 0 ? 'down' : 'flat');
      var s = (v != null && !isNaN(v)) ? (v > 0 ? '+' : '') + v.toFixed(2) + '%' : '--';
      html += '<div class="fdr-item"><div class="fdr-label">' + labelMap[k] + '</div><div class="fdr-val ' + cls + '">' + s + '</div></div>';
    });
    html += '</div>';
    html += '</div>';

    // 风险收益特征
    html += '<div class="fund-detail-section"><div class="fund-sec-title">📊 风险收益特征</div>';
    html += '<div class="fund-risk-cards">';
    html += riskCard('夏普比率', b.sharp, '衡量风险调整后收益，越高越好');
    html += riskCard('最大回撤', b.maxDrawdown != null ? b.maxDrawdown.toFixed(2) + '%' : '--', '历史最大回撤幅度，越小越稳健');
    html += riskCard('波动率', b.volatility != null ? b.volatility.toFixed(2) + '%' : '--', '净值标准差，衡量波动风险');
    html += '</div></div>';

    // 同类排名百分位
    if (p && p.rateInSimilarPersent && p.rateInSimilarPersent.length) {
      var lastPct = p.rateInSimilarPersent[p.rateInSimilarPersent.length - 1];
      var pctVal = Array.isArray(lastPct) ? lastPct[1] : null;
      if (pctVal != null) {
        html += '<div class="fund-detail-section"><div class="fund-sec-title">🏆 同类排名</div>';
        html += '<div class="fund-rank-wrap">';
        html += '<div class="fund-rank-gauge"><div class="fund-rank-gauge-inner" style="width:' + Math.min(100, pctVal) + '%"></div></div>';
        html += '<div class="fund-rank-text">同类排名百分位 <b>' + pctVal.toFixed(2) + '%</b>（越小越优）</div>';
        html += '</div></div>';
      }
    }

    // 净值曲线
    html += '<div class="fund-detail-section"><div class="fund-sec-title">📈 历史净值走势</div>';
    html += '<div class="fund-range-tabs" id="fundRangeTabs">';
    ['1M', '3M', '6M', '1Y', '3Y', '5Y'].forEach(function(r, idx) {
      html += '<button class="fund-range-tab' + (idx === 3 ? ' active' : '') + '" data-range="' + r + '">' + r + '</button>';
    });
    html += '</div>';
    html += '<canvas id="fundNavChart" class="fund-nav-chart"></canvas></div>';

    // 持仓行业分布
    html += '<div class="fund-detail-section"><div class="fund-sec-title">🏭 持仓行业分布</div>';
    html += '<div class="fund-industry-wrap" id="fundIndustryHost"></div></div>';

    // 前十大重仓股
    html += '<div class="fund-detail-section"><div class="fund-sec-title">💼 前十大重仓股</div>';
    html += '<div class="fund-holdings-wrap" id="fundHoldingsHost"></div></div>';

    // 基金经理
    html += '<div class="fund-detail-section"><div class="fund-sec-title">👤 基金经理</div>';
    html += '<div id="fundManagerHost"></div></div>';

    // 费率结构
    html += '<div class="fund-detail-section"><div class="fund-sec-title">💰 费率结构</div>';
    html += '<div class="fund-fee-table" id="fundFeeHost"></div></div>';

    detail.innerHTML = html;

    // 净值曲线
    renderNavChart(p && p.netWorthTrend ? p.netWorthTrend : [], '1Y');
    var tabs = document.getElementById('fundRangeTabs');
    if (tabs) {
      Array.prototype.forEach.call(tabs.querySelectorAll('.fund-range-tab'), function(tb) {
        tb.addEventListener('click', function() {
          Array.prototype.forEach.call(tabs.querySelectorAll('.fund-range-tab'), function(x) { x.classList.remove('active'); });
          tb.classList.add('active');
          renderNavChart(p && p.netWorthTrend ? p.netWorthTrend : [], tb.getAttribute('data-range'));
        });
      });
    }

    // 行业
    renderIndustry(ind);
    // 持仓
    renderHoldings(holdings);
    // 经理
    renderManager(p);
    // 费率
    renderFees(b, p, manageFee);
  }

  function riskCard(label, value, hint) {
    return '<div class="fund-risk-card"><div class="frc-label">' + label + '</div>' +
      '<div class="frc-value">' + (value == null ? '--' : esc(value)) + '</div>' +
      '<div class="frc-hint">' + hint + '</div></div>';
  }

  /* ---------- 净值曲线（Canvas） ---------- */
  function renderNavChart(navData, range) {
    var canvas = document.getElementById('fundNavChart');
    if (!canvas) return;
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.parentNode.getBoundingClientRect();
    var W = Math.max(280, rect.width - 0);
    var H = 220;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // 背景
    ctx.fillStyle = 'rgba(6,10,16,0.6)';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(80,120,180,0.12)';
    for (var g = 1; g < 5; g++) {
      ctx.beginPath();
      ctx.moveTo(0, H * g / 5);
      ctx.lineTo(W, H * g / 5);
      ctx.stroke();
    }

    if (!navData || navData.length < 2) {
      ctx.fillStyle = '#8aa0bb';
      ctx.font = '12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('暂无净值数据', W / 2, H / 2);
      return;
    }

    // 时间过滤
    var now = Date.now();
    var rangeMs = { '1M': 30, '3M': 90, '6M': 180, '1Y': 365, '3Y': 1095, '5Y': 1825 }[range] || 365;
    var cutoff = now - rangeMs * 24 * 3600 * 1000;
    var pts = navData.filter(function(d) { return d.x >= cutoff; });
    if (pts.length < 2) pts = navData.slice(-60);

    var min = Infinity, max = -Infinity;
    pts.forEach(function(d) { if (d.y < min) min = d.y; if (d.y > max) max = d.y; });
    var pad = (max - min) * 0.08 || 0.005;
    min -= pad; max += pad;

    var padL = 46, padR = 10, padT = 12, padB = 20;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    function X(i) { return padL + (i / (pts.length - 1)) * plotW; }
    function Y(v) { return padT + (1 - (v - min) / (max - min)) * plotH; }

    // 网格标签
    ctx.strokeStyle = 'rgba(80,120,180,0.18)';
    ctx.fillStyle = '#7a90ab';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.textAlign = 'right';
    for (var gi = 0; gi <= 4; gi++) {
      var v = min + (max - min) * gi / 4;
      var yy = Y(v);
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W - padR, yy); ctx.stroke();
      ctx.fillText(v.toFixed(3), padL - 5, yy + 3);
    }

    // 涨跌判断：首末值
    var first = pts[0].y, last = pts[pts.length - 1].y;
    var upColor = '#ff4d4f', downColor = '#00c853';
    var lineColor = last >= first ? upColor : downColor;

    // 渐变填充
    var grad2 = ctx.createLinearGradient(0, padT, 0, H - padB);
    grad2.addColorStop(0, rgbaOf(lineColor, 0.30));
    grad2.addColorStop(1, rgbaOf(lineColor, 0.02));

    // 面积
    ctx.beginPath();
    ctx.moveTo(X(0), Y(pts[0].y));
    for (var i = 1; i < pts.length; i++) ctx.lineTo(X(i), Y(pts[i].y));
    ctx.lineTo(X(pts.length - 1), H - padB);
    ctx.lineTo(X(0), H - padB);
    ctx.closePath();
    ctx.fillStyle = grad2;
    ctx.fill();

    // 折线
    ctx.beginPath();
    ctx.moveTo(X(0), Y(pts[0].y));
    for (var j = 1; j < pts.length; j++) ctx.lineTo(X(j), Y(pts[j].y));
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // 首尾点
    ctx.fillStyle = lineColor;
    ctx.beginPath(); ctx.arc(X(0), Y(pts[0].y), 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(X(pts.length - 1), Y(pts[pts.length - 1].y), 4, 0, Math.PI * 2); ctx.fill();

    // 日期标签
    ctx.fillStyle = '#7a90ab';
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'left';
    var fmt = function(t) { var d = new Date(t); return (d.getMonth() + 1) + '/' + d.getFullYear() % 100; };
    ctx.fillText(fmt(pts[0].x), padL, H - 6);
    ctx.textAlign = 'right';
    ctx.fillText(fmt(pts[pts.length - 1].x), W - padR, H - 6);

    // 涨跌幅标注
    var chgPct = ((last - first) / first) * 100;
    ctx.textAlign = 'left';
    ctx.fillStyle = lineColor;
    ctx.font = 'bold 11px Inter, sans-serif';
    ctx.fillText(range + ' ' + (chgPct >= 0 ? '+' : '') + chgPct.toFixed(2) + '%', padL + 4, padT + 12);
  }

  function rgbaOf(hex, a) {
    var m = /#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})/.exec(hex);
    if (!m) return 'rgba(0,200,255,' + a + ')';
    return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + a + ')';
  }

  /* ---------- 行业分布 ---------- */
  function renderIndustry(rows) {
    var host = document.getElementById('fundIndustryHost');
    if (!host) return;
    if (!rows || rows.length === 0) {
      host.innerHTML = '<div class="fund-empty-mini">暂无行业分布数据</div>';
      return;
    }
    rows = rows.slice(0, 12);
    var max = Math.max.apply(null, rows.map(function(r) { return r.pct; })) || 1;
    var html = rows.map(function(r) {
      var w = Math.max(2, (r.pct / max) * 100);
      return '<div class="fund-ind-row">' +
        '<div class="fund-ind-name">' + esc(r.name) + '</div>' +
        '<div class="fund-ind-bar"><div class="fund-ind-bar-inner" style="width:' + w + '%"></div></div>' +
        '<div class="fund-ind-val">' + r.pct.toFixed(2) + '%</div>' +
        '</div>';
    }).join('');
    host.innerHTML = html;
  }

  /* ---------- 前十大重仓股 ---------- */
  function renderHoldings(holdings) {
    var host = document.getElementById('fundHoldingsHost');
    if (!host) return;
    if (!holdings || holdings.length === 0) {
      host.innerHTML = '<div class="fund-empty-mini">暂无持仓数据（可能为货币/债券基金或数据未披露）</div>';
      return;
    }
    var html = '<div class="fund-hold-head"><span>股票</span><span>占净值比例</span></div>';
    html += holdings.map(function(h, idx) {
      var cls = h.pct == null ? '' : (h.pct > 0 ? 'up' : '');
      return '<div class="fund-hold-row">' +
        '<span class="fund-hold-rank">' + (idx + 1) + '</span>' +
        '<span class="fund-hold-name">' + esc(h.name) + '<em>' + esc(h.code) + '</em></span>' +
        '<span class="fund-hold-pct ' + cls + '">' + (h.pct != null ? h.pct.toFixed(2) + '%' : '--') + '</span>' +
        '</div>';
    }).join('');
    host.innerHTML = html;
  }

  /* ---------- 基金经理履历 ---------- */
  function renderManager(p) {
    var host = document.getElementById('fundManagerHost');
    if (!host) return;
    var mgr = (p && p.currentManager && p.currentManager[0]) || null;
    if (!mgr) {
      host.innerHTML = '<div class="fund-empty-mini">暂无基金经理数据</div>';
      return;
    }
    var html = '<div class="fund-mgr-card">';
    html += '<div class="fund-mgr-head">';
    html += '<div class="fund-mgr-avatar">' + esc((mgr.name || '?').charAt(0)) + '</div>';
    html += '<div class="fund-mgr-info">';
    html += '<div class="fund-mgr-name">' + esc(mgr.name || '--') + (mgr.star ? '<span class="fund-mgr-star">' + Array(parseInt(mgr.star, 10) || 0).join('★') + '</span>' : '') + '</div>';
    html += '<div class="fund-mgr-meta">任职 ' + esc(mgr.workTime || '--') + ' · 管理规模 ' + esc(mgr.fundSize || '--') + '</div>';
    html += '</div></div>';
    // 经理能力评分
    if (mgr.power && mgr.power.categories && mgr.power.data) {
      html += '<div class="fund-mgr-power">';
      mgr.power.categories.forEach(function(cat, idx) {
        var v = mgr.power.data[idx];
        if (v == null) return;
        html += '<div class="fund-mgr-prow">' +
          '<span class="fmp-label">' + esc(cat) + '</span>' +
          '<span class="fmp-bar"><span class="fmp-bar-inner" style="width:' + Math.min(100, v) + '%"></span></span>' +
          '<span class="fmp-val">' + v.toFixed(1) + '</span></div>';
      });
      html += '</div>';
    }
    // 任期收益对比
    if (mgr.profit && mgr.profit.series) {
      var tenure = mgr.profit.series[0];
      var bench = mgr.profit.series[1];
      if (tenure && tenure.data && tenure.data[0] && tenure.data[0].y != null) {
        var tVal = tenure.data[0].y, bVal = (bench && bench.data && bench.data[0]) ? bench.data[0].y : null;
        html += '<div class="fund-mgr-tenure">任期收益 <b class="' + (tVal >= 0 ? 'up' : 'down') + '">' + (tVal > 0 ? '+' : '') + tVal.toFixed(2) + '%</b>' +
          (bVal != null ? ' · 同类均值 ' + (bVal > 0 ? '+' : '') + bVal.toFixed(2) + '%' : '') + '</div>';
      }
    }
    html += '</div>';
    host.innerHTML = html;
  }

  /* ---------- 费率结构 ---------- */
  function renderFees(b, p, manageFee) {
    var host = document.getElementById('fundFeeHost');
    if (!host) return;
    var rows = [];
    var srcRate = p && p.sourceRate ? p.sourceRate : (b.purchaseFee || '--');
    var curRate = p && p.rate ? p.rate : (b.currentRate || '--');
    rows.push({ label: '申购费率', value: srcRate });
    rows.push({ label: '优惠费率', value: curRate });
    rows.push({ label: '管理费', value: manageFee || '--' });
    rows.push({ label: '最低申购', value: b.minBuy ? b.minBuy + ' 元' : (p && p.minBuy ? p.minBuy + ' 元' : '--') });
    rows.push({ label: '申购状态', value: b.buyStatus || '--' });
    rows.push({ label: '赎回状态', value: b.redeemStatus || '--' });

    // 从 rankhandler/manageFee 补充分
    var html = rows.map(function(r) {
      return '<div class="fund-fee-row"><span class="ff-label">' + r.label + '</span><span class="ff-value">' + esc(r.value) + '</span></div>';
    }).join('');
    host.innerHTML = html;
  }

  /* ---------- 工具 ---------- */
  function showListLoading(show, msg) {
    var el = document.getElementById('fundListLoading');
    if (!el) return;
    if (show) {
      el.innerHTML = '<span class="fdl-spinner"></span>' + (msg || '正在加载基金数据...');
      el.style.display = 'flex';
    } else {
      el.style.display = 'none';
    }
  }
  function showListError(msg) {
    var empty = document.getElementById('fundListEmpty');
    if (empty) { empty.style.display = 'flex'; empty.textContent = msg; }
  }
  function numOrNull(v) {
    if (v === '' || v == null) return null;
    var n = parseFloat(v);
    return isNaN(n) ? null : n;
  }
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return {
    init: init,
    backToSearch: function() { closeDetail(); }
  };
})();