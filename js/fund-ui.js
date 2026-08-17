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
    // 加载行业优选基金推荐
    Perf.trackedSetTimeout(function() { renderIndustryFunds(); }, 500);
    // 绑定刷新按钮
    var refreshBtn = document.getElementById('fundIndustryRefresh');
    if (refreshBtn) refreshBtn.addEventListener('click', function() {
      _industryFundCache = null;
      renderIndustryFunds();
    });
  }

  /* ---- 基金搜索联想 ---- */
  var _fundSuggestTimer = null;
  var _fundSuggestSeq = 0;
  var LS_FUND_HISTORY = 'fund_search_history_v2';
  var MAX_FUND_HISTORY = 8;
  var FUND_CAT_LABELS = {
    gp: '股票型', hh: '混合型', zq: '债券型', zs: '指数型',
    qdii: 'QDII', fof: 'FOF', hb: '货币型', lof: 'LOF', closed: '封闭式', other: '其他'
  };

  function saveFundHistory(code, name, cat) {
    try {
      var h = JSON.parse(localStorage.getItem(LS_FUND_HISTORY) || '[]');
      h = h.filter(function(x) { return x.code !== code; });
      h.unshift({ code: code, name: name, cat: cat || 'other', ts: Date.now() });
      h = h.slice(0, MAX_FUND_HISTORY);
      localStorage.setItem(LS_FUND_HISTORY, JSON.stringify(h));
    } catch (e) {}
  }

  function loadFundHistory() {
    try { return JSON.parse(localStorage.getItem(LS_FUND_HISTORY) || '[]'); }
    catch (e) { return []; }
  }

  function renderFundHistory() {
    var box = document.getElementById('fundSuggest');
    if (!box) return;
    var h = loadFundHistory();
    if (h.length === 0) { box.classList.remove('show'); return; }
    var html = '<div class="suggest-history-header"><span>搜索历史</span>' +
      '<span class="suggest-history-clear" id="clearFundHistory">清空</span></div>';
    html += h.map(function(item) {
      var tl = FUND_CAT_LABELS[item.cat] || '基金';
      return '<div class="fund-suggest-item" data-fs-code="' + escHTML(item.code) + '" data-fs-name="' + escHTML(item.name||'') + '">' +
        '<span class="suggest-type fund">' + tl + '</span>' +
        '<span class="s-name">' + escHTML(item.name || item.code) + '</span>' +
        '<span class="s-code">' + item.code + '</span>' +
      '</div>';
    }).join('');
    box.innerHTML = html;
    bindFundSuggestClicks(box);
    var clr = document.getElementById('clearFundHistory');
    if (clr) clr.addEventListener('click', function(e) {
      e.stopPropagation();
      localStorage.removeItem(LS_FUND_HISTORY);
      box.classList.remove('show');
    });
    box.classList.add('show');
  }

  function bindFundSuggestClicks(box) {
    box.querySelectorAll('[data-fs-code]').forEach(function(el) {
      el.addEventListener('click', function() {
        var code = el.getAttribute('data-fs-code');
        var name = el.getAttribute('data-fs-name');
        var input = document.getElementById('fundSearchInput');
        if (input) input.value = code;
        saveFundHistory(code, name, '');
        box.classList.remove('show');
        state.keyword = code;
        doSearch();
      });
    });
  }

  function handleFundSearchInput(value) {
    var box = document.getElementById('fundSuggest');
    if (!box) return;
    if (!value || value.trim().length === 0) {
      renderFundHistory();
      return;
    }
    if (_fundSuggestTimer) clearTimeout(_fundSuggestTimer);
    _fundSuggestTimer = setTimeout(function() {
      var kw = value.trim().toLowerCase();
      var mySeq = ++_fundSuggestSeq;
      FundData.loadUniverse().then(function(u) {
        if (mySeq !== _fundSuggestSeq) return;
        var isNumeric = /^\d+$/.test(kw);
        var scored = [];
        u.forEach(function(x) {
          var score = -1;
          var code = (x.code || '').toLowerCase();
          var name = (x.name || '').toLowerCase();
          var pinyin = (x.pinyin || '').toLowerCase();
          var fullname = (x.fullname || '').toLowerCase();
          if (isNumeric) {
            if (code === kw) score = 100;
            else if (code.indexOf(kw) === 0) score = 80;
            else if (code.indexOf(kw) > 0) score = 60;
          } else {
            if (name === kw) score = 100;
            else if (name.indexOf(kw) === 0) score = 90;
            else if (name.indexOf(kw) > 0) score = 70;
            else if (fullname.indexOf(kw) >= 0) score = 65;
            else if (pinyin === kw) score = 55;
            else if (pinyin.indexOf(kw) === 0) score = 50;
            else if (pinyin.indexOf(kw) > 0) score = 40;
          }
          if (score >= 0) scored.push({ code: x.code, name: x.name, cat: x.cat, style: x.style, score: score });
        });
        scored.sort(function(a, b) { return b.score - a.score; });
        var top = scored.slice(0, 10);
        if (top.length === 0) { box.classList.remove('show'); return; }
        var html = top.map(function(f) {
          var tl = FUND_CAT_LABELS[f.cat] || '基金';
          var hlName = highlightKeyword(f.name || '', value.trim());
          var hlCode = highlightKeyword(f.code || '', value.trim());
          var styleHint = f.style ? '<span class="fs-style">' + escHTML(f.style) + '</span>' : '';
          return '<div class="fund-suggest-item" data-fs-code="' + escHTML(f.code) + '" data-fs-name="' + escHTML(f.name||'') + '" data-fs-cat="' + escHTML(f.cat||'') + '">' +
            '<span class="suggest-type fund">' + tl + '</span>' +
            '<span class="s-name">' + hlName + '</span>' +
            styleHint +
            '<span class="s-code">' + hlCode + '</span>' +
          '</div>';
        }).join('');
        box.innerHTML = html;
        bindFundSuggestClicks(box);
        box.classList.add('show');
      }).catch(function() { box.classList.remove('show'); });
    }, 250);
  }

  function bindEvents() {
    var get = function(id) { return document.getElementById(id); };
    var kw = get('fundSearchInput');
    var btn = get('fundSearchBtn');
    if (kw) {
      kw.addEventListener('keydown', function(e) { if (e.key === 'Enter') {
        if (_fundSuggestTimer) { clearTimeout(_fundSuggestTimer); _fundSuggestTimer = null; }
        var box = get('fundSuggest');
        if (box) box.classList.remove('show');
        state.keyword = kw.value.trim(); doSearch();
      } });
      kw.addEventListener('input', function() { handleFundSearchInput(this.value); });
      kw.addEventListener('focus', function() {
        if (!this.value || this.value.trim().length === 0) renderFundHistory();
      });
    }
    if (btn) btn.addEventListener('click', function() {
      var box = get('fundSuggest');
      if (box) box.classList.remove('show');
      state.keyword = kw.value.trim(); doSearch();
    });

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

    // 点击外部关闭基金搜索联想
    document.addEventListener('click', function(e) {
      if (!e.target.closest('.fund-search-bar')) {
        var box = get('fundSuggest');
        if (box) box.classList.remove('show');
      }
    });

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
      // 来源1：全量库客户端过滤 + 相关度排序
      FundData.loadUniverse().then(function(u) {
        var kw = keyword.trim().toLowerCase();
        var isNumeric = /^\d+$/.test(kw);
        var scored = [];
        u.forEach(function(x) {
          var score = -1;
          var code = (x.code || '').toLowerCase();
          var name = (x.name || '').toLowerCase();
          var pinyin = (x.pinyin || '').toLowerCase();
          var fullname = (x.fullname || '').toLowerCase();
          if (isNumeric) {
            // 数字搜索：代码精确匹配优先
            if (code === kw) score = 100;
            else if (code.indexOf(kw) === 0) score = 80;
            else if (code.indexOf(kw) > 0) score = 60;
          } else {
            // 文字搜索：名称匹配优先
            if (name === kw) score = 100;
            else if (name.indexOf(kw) === 0) score = 90;
            else if (name.indexOf(kw) > 0) score = 70;
            else if (fullname.indexOf(kw) >= 0) score = 65;
            else if (pinyin === kw) score = 55;
            else if (pinyin.indexOf(kw) === 0) score = 50;
            else if (pinyin.indexOf(kw) > 0) score = 40;
          }
          if (score >= 0) scored.push({ code: x.code, score: score });
        });
        scored.sort(function(a, b) { return b.score - a.score; });
        return scored.slice(0, 80).map(function(s) { return s.code; });
      }).catch(function() { return []; }),
      // 来源2：搜索API（利用返回的company/manager字段）
      FundData.search(keyword).then(function(found) {
        return (found || []).map(function(f) { return f.code; });
      }).catch(function() { return []; })
    ]).then(function(parts) {
      if (mySeq !== _searchSeq) return;
      // 合并去重，保留来源1的相关度排序
      var seen = {};
      var codes = [];
      parts[0].forEach(function(c) { if (c && !seen[c]) { seen[c] = true; codes.push(c); } });
      parts[1].forEach(function(c) { if (c && !seen[c]) { seen[c] = true; codes.push(c); } });
      codes = codes.slice(0, 100); // 上限提高到100
      if (codes.length === 0) {
        renderList([], 0, 0, 1, true);
        showListLoading(false);
        var el = document.getElementById('fundListEmpty');
        if (el) { el.style.display = 'flex'; el.textContent = '未找到匹配的基金，请检查代码/名称/基金经理/基金公司'; }
        state.loading = false;
        return;
      }
      return FundData.enrichBatch(codes, 100).then(function(rows) {
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

    var riskStr = r.riskLevel ? 'R' + r.riskLevel : '';
    var ratingStr = r.rating ? '★'.repeat(Math.min(parseInt(r.rating, 10) || 0, 5)) : '';
    // 规模格式化：>100亿省略小数，10-100亿1位小数，<10亿2位小数
    var scaleStr = '--';
    if (r.scaleYi != null && !isNaN(r.scaleYi)) {
      var sy = r.scaleYi;
      if (sy >= 100) scaleStr = sy.toFixed(0) + '亿';
      else if (sy >= 10) scaleStr = sy.toFixed(1) + '亿';
      else scaleStr = sy.toFixed(2) + '亿';
    }
    // 成立日期格式化（仅显示年份）
    var estabYear = '';
    if (r.estabDate) {
      var dStr = String(r.estabDate).replace(/-/g, '');
      if (dStr.length >= 4) estabYear = dStr.substring(0, 4) + '年';
    }
    var ret = function(v) {
      if (v == null || isNaN(v)) return '<span class="fund-cell-muted">--</span>';
      var cls = v > 0 ? 'up' : (v < 0 ? 'down' : 'flat');
      return '<span class="' + cls + '">' + (v > 0 ? '+' : '') + v.toFixed(2) + '%</span>';
    };

    // 标签精简：类型+风险+评级+成立年份（公司/经理太长时省略）
    var tags = '<span class="fund-tag">' + esc(r.type || (TYPE_MAP[r.fundType] || '基金')) + '</span>';
    if (riskStr) tags += '<span class="fund-tag fund-tag-risk">' + riskStr + '</span>';
    if (ratingStr) tags += '<span class="fund-tag fund-tag-rating">' + ratingStr + '</span>';
    if (estabYear) tags += '<span class="fund-tag fund-tag-date">' + estabYear + '</span>';
    // 公司和经理在窄屏隐藏
    if (r.company) tags += '<span class="fund-tag fund-tag-company fund-tag-optional">' + esc(r.company) + '</span>';
    if (r.manager) tags += '<span class="fund-tag fund-tag-mgr fund-tag-optional">' + esc(r.manager) + '</span>';

    tr.innerHTML =
      '<div class="fund-row-main">' +
        '<div class="fund-name">' + esc(r.name) + '<span class="fund-code">' + esc(r.code) + '</span></div>' +
        '<div class="fund-tags">' + tags + '</div>' +
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

    // 日期格式化
    var fmtDate = function(d) {
      if (!d) return '--';
      var s = String(d).replace(/-/g, '');
      if (s.length === 8) return s.substring(0,4) + '-' + s.substring(4,6) + '-' + s.substring(6,8);
      return String(d);
    };
    // 规模格式化
    var fmtScale = function(sy) {
      if (sy == null || isNaN(sy)) return '--';
      if (sy >= 100) return sy.toFixed(0) + '亿';
      if (sy >= 10) return sy.toFixed(1) + '亿';
      return sy.toFixed(2) + '亿';
    };

    var html = '';
    html += '<div class="fund-detail-header">';
    html += '<div class="fund-detail-title">' + esc(name) + '<span class="fund-code-lg">' + esc(code) + '</span></div>';
    html += '<div class="fund-detail-sub">' + esc(b.type || '') + (b.company ? ' · ' + esc(b.company) : '') + (b.manager ? ' · 经理 ' + esc(b.manager) : '') + '</div>';
    html += '<div class="fund-detail-quote">';
    html += '<span class="fund-detail-nav">' + (b.unitNav != null ? b.unitNav.toFixed(4) : '--') + '</span>';
    html += '<span class="fund-detail-chg ' + chgCls + '">' + chgStr + '</span>';
    html += '<span class="fund-detail-date">' + fmtDate(b.date) + '</span>';
    html += '</div>';
    html += '<div class="fund-detail-badges">';
    html += '<span class="fdb fdb-risk">风险等级 ' + (b.riskLevel ? 'R' + b.riskLevel : '--') + '</span>';
    html += '<span class="fdb fdb-rating">晨星 ' + (b.rating ? '★'.repeat(Math.min(parseInt(b.rating, 10) || 0, 5)) : '--') + '</span>';
    html += '<span class="fdb">规模 ' + fmtScale(b.scaleYi) + '</span>';
    html += '<span class="fdb">成立 ' + fmtDate(b.estabDate) + '</span>';
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

    // 基金点评（张扬视角）
    var commentary = generateCommentary(b, p, holdings, ind);
    html += '<div class="fund-detail-section fund-commentary-section">';
    html += '<div class="fund-sec-title">📝 基金点评 · 张扬视角</div>';
    html += '<div class="fund-commentary-verdict ' + commentary.verdictClass + '">';
    html += '<span class="fc-verdict-icon">' + commentary.verdictIcon + '</span>';
    html += '<span class="fc-verdict-text">' + commentary.verdict + '</span>';
    html += '</div>';
    html += '<div class="fund-commentary-body">';
    commentary.points.forEach(function(pt) {
      html += '<div class="fc-point fc-point-' + pt.type + '">';
      html += '<span class="fc-point-icon">' + pt.icon + '</span>';
      html += '<span class="fc-point-text">' + esc(pt.text) + '</span>';
      html += '</div>';
    });
    html += '</div>';
    if (commentary.summary) {
      html += '<div class="fund-commentary-summary">' + esc(commentary.summary) + '</div>';
    }
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
        var rankLevel = pctVal <= 25 ? '优秀' : pctVal <= 50 ? '良好' : pctVal <= 75 ? '一般' : '偏弱';
        var rankColor = pctVal <= 25 ? '#00c853' : pctVal <= 50 ? '#ffd700' : pctVal <= 75 ? '#ff9800' : '#ff4d4f';
        html += '<div class="fund-detail-section"><div class="fund-sec-title">🏆 同类排名</div>';
        html += '<div class="fund-rank-wrap">';
        html += '<div class="fund-rank-badge" style="border-color:' + rankColor + ';color:' + rankColor + '">' + rankLevel + '</div>';
        html += '<div class="fund-rank-gauge"><div class="fund-rank-gauge-inner" style="width:' + Math.min(100, pctVal) + '%;background:linear-gradient(90deg,' + rankColor + 'aa,' + rankColor + ')"></div></div>';
        html += '<div class="fund-rank-text">同类排名百分位 <b style="color:' + rankColor + '">' + pctVal.toFixed(1) + '%</b>（越小越优）</div>';
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

  /* ============================================================
     基金点评生成器（张扬视角）
     基于多维数据生成：推荐/谨慎/不推荐 判定 + 优势/风险/建议
     ============================================================ */
  function generateCommentary(b, p, holdings, ind) {
    var points = [];
    var score = 0;
    var maxScore = 0;
    var isETF = (b.cat === 'zs' || (b.name && b.name.indexOf('ETF') >= 0));
    var scale = b.scaleYi || 0;
    var rating = parseInt(b.rating) || 0;
    var sharp = b.sharp;
    var mdd = b.maxDrawdown;
    var vol = b.volatility;
    var ret1y = b.ret1y;
    var ret3y = b.ret3y;
    var fee = parseFloat(b.purchaseFee) || 0;
    var riskLevel = parseInt(b.riskLevel) || 3;
    var years = 0;
    if (b.estabDate) {
      years = (Date.now() - new Date(b.estabDate).getTime()) / (365.25 * 86400000);
    }

    // === 规模评估（核心防老鼠仓） ===
    maxScore += 20;
    if (scale > 100) {
      score += 20;
      points.push({ type: 'good', icon: '✅', text: '规模' + Math.round(scale) + '亿，流动性极佳，大资金运作空间充足，无老鼠仓顾虑' });
    } else if (scale > 50) {
      score += 18;
      points.push({ type: 'good', icon: '✅', text: '规模' + Math.round(scale) + '亿，运作稳健，不存在清盘风险' });
    } else if (scale > 10) {
      score += 14;
      points.push({ type: 'good', icon: '✅', text: '规模' + scale.toFixed(1) + '亿，适中水平，正常运作无碍' });
    } else if (scale > 5) {
      score += 8;
      points.push({ type: 'warn', icon: '⚡', text: '规模' + scale.toFixed(1) + '亿偏小，需关注大额申赎对净值的冲击' });
    } else if (scale > 0 && scale < 2) {
      score -= 15;
      points.push({ type: 'danger', icon: '🚨', text: '规模不足2亿！高度警惕——小规模基金最容易被用来接盘老鼠仓，基金经理可能通过此基金为其利益方输送筹码' });
    } else if (scale > 0 && scale < 5) {
      score -= 5;
      points.push({ type: 'danger', icon: '⚠️', text: '规模' + scale.toFixed(1) + '亿偏小，存在清盘风险，且大额申赎会显著影响净值' });
    }

    // === ETF vs 主动管理 ===
    maxScore += 15;
    if (isETF) {
      score += 15;
      points.push({ type: 'good', icon: '✅', text: 'ETF被动跟踪指数，透明度高，不存在老鼠仓/利益输送风险，管理费低' });
    } else {
      maxScore += 5;
      // 主动管理基金需额外审查
      if (scale > 0 && scale < 10 && ret1y != null && ret1y > 50) {
        score -= 20;
        points.push({ type: 'danger', icon: '🚨', text: '小规模+短期暴利（近1年' + ret1y.toFixed(0) + '%）——这是老鼠仓的经典特征！小基金突然业绩爆发，极可能是接盘方在拉升出货，强烈建议回避' });
      }
    }

    // === 晨星评级 ===
    maxScore += 10;
    if (rating >= 5) {
      score += 10;
      points.push({ type: 'good', icon: '✅', text: '晨星五星评级，长期风险调整收益位居同类前10%，获得权威认可' });
    } else if (rating >= 4) {
      score += 7;
      points.push({ type: 'good', icon: '✅', text: '晨星四星评级，长期表现位居同类前32.5%，属于优质基金' });
    } else if (rating >= 3) {
      score += 4;
      points.push({ type: 'neutral', icon: '➡️', text: '晨星三星评级，表现中规中矩，处于同类平均水平' });
    } else if (rating > 0) {
      score -= 3;
      points.push({ type: 'warn', icon: '⚠️', text: '晨星评级低于三星，长期风险调整收益低于同类平均，需谨慎' });
    }

    // === 夏普比率 ===
    maxScore += 15;
    if (sharp != null && !isNaN(sharp)) {
      if (sharp > 2) {
        score += 15;
        points.push({ type: 'good', icon: '✅', text: '夏普比率' + sharp.toFixed(2) + '，极高！每承担1单位风险获得' + sharp.toFixed(1) + '单位超额回报，风险收益比卓越' });
      } else if (sharp > 1.5) {
        score += 12;
        points.push({ type: 'good', icon: '✅', text: '夏普比率' + sharp.toFixed(2) + '，优秀！风险调整后收益显著优于同类' });
      } else if (sharp > 1) {
        score += 8;
        points.push({ type: 'good', icon: '✅', text: '夏普比率' + sharp.toFixed(2) + '，良好，收益风险比优于市场平均' });
      } else if (sharp > 0.5) {
        score += 4;
        points.push({ type: 'neutral', icon: '➡️', text: '夏普比率' + sharp.toFixed(2) + '，中等水平，超额回报有限' });
      } else if (sharp >= 0) {
        score -= 2;
        points.push({ type: 'warn', icon: '⚠️', text: '夏普比率' + sharp.toFixed(2) + '偏低，承担的风险未能获得足够的超额回报' });
      } else {
        score -= 10;
        points.push({ type: 'danger', icon: '🚨', text: '夏普比率为负(' + sharp.toFixed(2) + ')！收益不如无风险利率，承担风险反而亏钱' });
      }
    }

    // === 最大回撤 ===
    maxScore += 10;
    if (mdd != null && !isNaN(mdd) && mdd > 0) {
      if (mdd < 10) {
        score += 10;
        points.push({ type: 'good', icon: '✅', text: '最大回撤仅' + mdd.toFixed(1) + '%，风控出色，极端行情下也抗跌' });
      } else if (mdd < 20) {
        score += 6;
        points.push({ type: 'good', icon: '✅', text: '最大回撤' + mdd.toFixed(1) + '%，风控良好，回撤可控' });
      } else if (mdd < 35) {
        score += 2;
        points.push({ type: 'neutral', icon: '➡️', text: '最大回撤' + mdd.toFixed(1) + '%，中等波动，需有一定风险承受能力' });
      } else if (mdd < 50) {
        score -= 5;
        points.push({ type: 'warn', icon: '⚠️', text: '最大回撤' + mdd.toFixed(1) + '%较大，历史上曾深度回调，买入前需做好心理准备' });
      } else {
        score -= 10;
        points.push({ type: 'danger', icon: '🚨', text: '最大回撤' + mdd.toFixed(1) + '%极高！历史最惨时腰斩，只适合能承受大幅亏损的激进投资者' });
      }
    }

    // === 业绩表现 ===
    maxScore += 15;
    if (ret1y != null && !isNaN(ret1y)) {
      if (ret1y > 30) {
        score += 12;
        points.push({ type: 'good', icon: '📈', text: '近1年收益' + ret1y.toFixed(1) + '%，表现优异' });
      } else if (ret1y > 15) {
        score += 8;
        points.push({ type: 'good', icon: '📈', text: '近1年收益' + ret1y.toFixed(1) + '%，跑赢大盘' });
      } else if (ret1y > 0) {
        score += 4;
        points.push({ type: 'neutral', icon: '➡️', text: '近1年收益' + ret1y.toFixed(1) + '%，正收益但不算突出' });
      } else if (ret1y > -10) {
        score -= 3;
        points.push({ type: 'warn', icon: '📉', text: '近1年亏损' + Math.abs(ret1y).toFixed(1) + '%，短期承压' });
      } else {
        score -= 8;
        points.push({ type: 'danger', icon: '📉', text: '近1年亏损' + Math.abs(ret1y).toFixed(1) + '%，大幅回撤，需评估是否为系统性风险还是基金自身问题' });
      }
    }
    // 3年长期业绩
    if (ret3y != null && !isNaN(ret3y)) {
      if (ret3y > 60) {
        points.push({ type: 'good', icon: '✅', text: '近3年收益' + ret3y.toFixed(0) + '%，长期表现卓越，穿越牛熊' });
      } else if (ret3y > 20) {
        points.push({ type: 'good', icon: '✅', text: '近3年收益' + ret3y.toFixed(0) + '%，长期稳健增长' });
      } else if (ret3y < 0) {
        points.push({ type: 'warn', icon: '⚠️', text: '近3年亏损' + Math.abs(ret3y).toFixed(0) + '%，长期表现不佳，需质疑基金经理能力' });
      }
    }

    // === 费率 ===
    maxScore += 10;
    if (fee === 0) {
      score += 10;
      points.push({ type: 'good', icon: '✅', text: '零申购费，入手成本为零，适合定投' });
    } else if (fee > 0 && fee < 0.5) {
      score += 8;
      points.push({ type: 'good', icon: '✅', text: '申购费率' + fee + '%，低费率，减少投资成本' });
    } else if (fee > 1.5) {
      score -= 5;
      points.push({ type: 'warn', icon: '⚠️', text: '申购费率' + fee + '%偏高，长期持有成本较大，建议通过折扣渠道申购' });
    }

    // === 成立年限 ===
    maxScore += 5;
    if (years > 5) {
      score += 5;
      points.push({ type: 'good', icon: '✅', text: '成立' + Math.floor(years) + '年，历经完整牛熊周期，业绩参考价值高' });
    } else if (years > 3) {
      score += 3;
    } else if (years < 1 && years > 0) {
      score -= 5;
      points.push({ type: 'warn', icon: '⚠️', text: '成立不足1年，历史数据有限，业绩可持续性存疑' });
    }

    // === 持仓集中度（防老鼠仓辅助指标） ===
    if (holdings && holdings.length > 0) {
      var top1Pct = holdings[0].pct || 0;
      var top3Pct = 0;
      for (var i = 0; i < Math.min(3, holdings.length); i++) {
        top3Pct += (holdings[i].pct || 0);
      }
      if (top1Pct > 15 && !isETF) {
        points.push({ type: 'warn', icon: '⚠️', text: '第一大重仓股' + holdings[0].name + '占比' + top1Pct.toFixed(1) + '%，集中度偏高，需关注是否为利益输送标的' });
      }
      if (top3Pct > 40 && !isETF) {
        points.push({ type: 'warn', icon: '⚠️', text: '前三大重仓股合计占比' + top3Pct.toFixed(1) + '%，集中度高，波动风险放大' });
      }
    }

    // === 经理信息 ===
    if (p && p.currentManager && p.currentManager.length > 0) {
      var mgr = p.currentManager[0];
      var mgrName = mgr.name || b.manager || '';
      if (mgr.workTime) {
        var tenureYears = parseFloat(mgr.workTime) || 0;
        if (tenureYears > 5) {
          points.push({ type: 'good', icon: '✅', text: '经理' + mgrName + '任职' + tenureYears.toFixed(1) + '年，经验丰富，经历过多种市场环境' });
        } else if (tenureYears < 1 && tenureYears > 0) {
          points.push({ type: 'warn', icon: '⚠️', text: '经理' + mgrName + '任职仅' + tenureYears.toFixed(1) + '年，经验尚浅，业绩持续性待验证' });
        }
      }
      if (mgr.power && mgr.power.total > 0) {
        var powerScore = mgr.power.total;
        if (powerScore > 80) {
          points.push({ type: 'good', icon: '✅', text: '经理综合能力评分' + powerScore + '，行业前20%优秀水平' });
        } else if (powerScore < 50) {
          points.push({ type: 'warn', icon: '⚠️', text: '经理综合能力评分' + powerScore + '偏低，低于行业平均' });
        }
      }
    }

    // === 综合判定 ===
    var pct = maxScore > 0 ? score / maxScore : 0;
    var verdict, verdictClass, verdictIcon, summary;

    if (pct >= 0.7) {
      verdict = '推荐买入';
      verdictClass = 'fc-verdict-buy';
      verdictIcon = '🟢';
    } else if (pct >= 0.5) {
      verdict = '可以关注，分批建仓';
      verdictClass = 'fc-verdict-hold';
      verdictIcon = '🟡';
    } else if (pct >= 0.3) {
      verdict = '谨慎观望';
      verdictClass = 'fc-verdict-caution';
      verdictIcon = '🟠';
    } else {
      verdict = '不建议买入';
      verdictClass = 'fc-verdict-avoid';
      verdictIcon = '🔴';
    }

    // 生成总结
    var dangerCount = points.filter(function(p) { return p.type === 'danger'; }).length;
    var goodCount = points.filter(function(p) { return p.type === 'good'; }).length;
    if (dangerCount >= 2) {
      verdict = '强烈回避';
      verdictClass = 'fc-verdict-avoid';
      verdictIcon = '🔴';
      summary = '该基金存在' + dangerCount + '项严重风险，综合评估不建议触碰。张扬认为：宁可错过也不要踩雷，投资首要原则是保住本金。';
    } else if (dangerCount === 1 && goodCount < 2) {
      verdict = '不建议买入';
      verdictClass = 'fc-verdict-avoid';
      verdictIcon = '🔴';
      summary = '该基金存在重大风险隐患，且优势不足以对冲。张扬建议：除非你对该基金有深入研究并能接受全部风险，否则远离。';
    } else if (goodCount >= 4 && dangerCount === 0) {
      verdict = '强烈推荐';
      verdictClass = 'fc-verdict-buy';
      verdictIcon = '🟢';
      summary = '该基金在规模、评级、收益、风控等多个维度表现优异，无明显风险点。张扬认为：这是值得长期持有的优质标的，适合定投或逢低加仓。';
    } else if (goodCount >= 3) {
      summary = '该基金整体质量不错，主要优势在于' + points.filter(function(p) { return p.type === 'good'; }).slice(0, 2).map(function(p) { return p.text.split('，')[0]; }).join('、') + '。张扬建议：可以小仓位试水，待熟悉其波动特征后再加仓。';
    } else {
      summary = '该基金表现中规中矩，无明显亮点也无致命缺陷。张扬建议：如果你看好该基金所在赛道，可以作为配置工具，但不要重仓。';
    }

    return {
      verdict: verdict,
      verdictClass: verdictClass,
      verdictIcon: verdictIcon,
      points: points,
      summary: summary
    };
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
    html += '<div class="fund-mgr-name">' + esc(mgr.name || '--') + (mgr.star ? '<span class="fund-mgr-star">' + '★'.repeat(Math.min(parseInt(mgr.star, 10) || 0, 5)) + '</span>' : '') + '</div>';
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

  /* ============================================================
     行业优选基金推荐
     - 每个行业精选3只基金（ETF优先 + 主动基金补充）
     - 评分维度：规模/评级/收益/夏普/回撤/费率/成立年限
     - 风险排雷：小规模老鼠仓/高费率/短任期/高回撤
     ============================================================ */
  var INDUSTRY_FUND_SECTORS = [
    { name: '半导体', keywords: ['半导体', '芯片'], etfCode: '512480', pct10: 99 },
    { name: '医药生物', keywords: ['医药', '医疗', '创新药'], etfCode: '512010', pct10: 20 },
    { name: '新能源', keywords: ['新能源', '光伏', '锂电'], etfCode: '516160', pct10: 55 },
    { name: '银行', keywords: ['银行'], etfCode: '512800', pct10: 25 },
    { name: '食品饮料', keywords: ['食品', '白酒', '消费'], etfCode: '515170', pct10: 5 },
    { name: '国防军工', keywords: ['军工', '国防'], etfCode: '512660', pct10: 58 },
    { name: '通信', keywords: ['通信', '5G'], etfCode: '515880', pct10: 85 },
    { name: '人工智能', keywords: ['人工智能', 'AI'], etfCode: '515980', pct10: 75 },
    { name: '机器人', keywords: ['机器人'], etfCode: '562500', pct10: 60 },
    { name: '黄金', keywords: ['黄金'], etfCode: '518880', pct10: 90 },
    // 政策主线7大主题
    { name: '数字经济', keywords: ['数字经济', '数据要素', '数据资产', '数字中国', '东数西算'], etfCode: '159658', pct10: 65 },
    { name: '先进制造', keywords: ['先进制造', '智能制造', '高端制造', '工业母机', '专精特新', '新型工业化'], etfCode: '516050', pct10: 45 },
    { name: '生物医药', keywords: ['生物医药', '创新药', '医疗器械', 'CXO', '基因治疗'], etfCode: '159992', pct10: 30 },
    { name: '绿色低碳', keywords: ['绿色低碳', '碳中和', '碳达峰', '绿电', '碳排放', '碳交易'], etfCode: '159885', pct10: 40 },
    { name: '银发经济', keywords: ['银发经济', '养老', '适老化', '康养', '智慧养老'], etfCode: '516970', pct10: 15 },
    { name: '现代农业', keywords: ['现代农业', '乡村振兴', '种业', '转基因', '智慧农业'], etfCode: '159825', pct10: 25 },
    { name: '低空经济', keywords: ['低空经济', 'eVTOL', '无人机', '飞行汽车', '通用航空'], etfCode: '159507', pct10: 70 }
  ];
  var _industryFundCache = null;
  var _industryFundLoading = false;

  function renderIndustryFunds() {
    if (_industryFundLoading) return;
    _industryFundLoading = true;
    var container = document.getElementById('fundIndustryList');
    if (!container) { _industryFundLoading = false; return; }

    // 使用缓存（10分钟内）
    if (_industryFundCache && Date.now() - _industryFundCache.ts < 10 * 60 * 1000) {
      renderIndustryCards(_industryFundCache.data);
      _industryFundLoading = false;
      return;
    }

    container.innerHTML = '<div class="fund-industry-loading">⏳ 正在搜索各行业优质基金，请稍候...</div>';
    var results = [];
    var industries = INDUSTRY_FUND_SECTORS.slice();

    function processNext() {
      if (industries.length === 0) {
        _industryFundCache = { ts: Date.now(), data: results };
        renderIndustryCards(results);
        _industryFundLoading = false;
        return;
      }
      // 每次处理2个行业（避免请求风暴）
      var batch = industries.splice(0, 2);
      Promise.all(batch.map(function(ind) { return loadIndustryFunds(ind); })).then(function(batchRes) {
        batchRes.forEach(function(r) { if (r && r.funds.length > 0) results.push(r); });
        renderIndustryCards(results); // 增量渲染
        processNext();
      }).catch(function() { processNext(); });
    }
    processNext();
  }

  function loadIndustryFunds(industry) {
    // 1. 按关键词搜索基金
    var searchPromises = industry.keywords.map(function(kw) {
      return FundData.search(kw).catch(function() { return []; });
    });
    return Promise.all(searchPromises).then(function(searchResults) {
      // 合并去重
      var allFunds = [];
      var seen = {};
      searchResults.forEach(function(list) {
        list.forEach(function(f) {
          if (!seen[f.code]) { seen[f.code] = true; allFunds.push(f); }
        });
      });
      // 加入ETF代码
      if (industry.etfCode && !seen[industry.etfCode]) {
        allFunds.unshift({ code: industry.etfCode, name: industry.name + 'ETF' });
        seen[industry.etfCode] = true;
      }
      // 取前8个候选
      var codes = allFunds.slice(0, 8).map(function(f) { return f.code; });
      if (codes.length === 0) return { industry: industry, funds: [] };
      // 2. 批量增强
      return FundData.enrichBatch(codes, 8).then(function(rows) {
        // 3. 评分排序，选前3
        var ranked = rankIndustryFunds(rows);
        return { industry: industry, funds: ranked.slice(0, 3) };
      });
    });
  }

  function rankIndustryFunds(rows) {
    rows = rows.filter(function(r) { return r && r.code && r.name; });
    rows.forEach(function(r) {
      r._score = 0;
      r._advantages = [];
      r._warnings = [];

      var scale = r.scaleYi || 0;
      var rating = parseInt(r.rating) || 0;
      var ret1y = r.ret1y;
      var sharp = r.sharp;
      var mdd = r.maxDrawdown;
      var fee = parseFloat(r.purchaseFee) || 0;
      var isETF = (r.cat === 'zs' || r.type === 'ETF' || (r.name && r.name.indexOf('ETF') >= 0));

      // 规模评分（核心防老鼠仓指标）
      if (scale > 100) { r._score += 25; r._advantages.push('规模' + Math.round(scale) + '亿，流动性极佳'); }
      else if (scale > 50) { r._score += 22; r._advantages.push('规模' + Math.round(scale) + '亿，运作稳健'); }
      else if (scale > 10) { r._score += 18; r._advantages.push('规模' + Math.round(scale) + '亿，适中稳定'); }
      else if (scale > 5) { r._score += 8; }
      else if (scale > 0 && scale < 2) { r._score -= 20; r._warnings.push('⚠️ 规模不足2亿，高度警惕老鼠仓接盘'); }
      else if (scale > 0 && scale < 5) { r._score -= 8; r._warnings.push('规模偏小，警惕清盘及大额申赎冲击'); }

      // ETF加分（被动管理，无老鼠仓风险）
      if (isETF) { r._score += 15; r._advantages.push('ETF被动跟踪，无老鼠仓风险'); }

      // 晨星评级
      if (rating >= 5) { r._score += 15; r._advantages.push('晨星五星'); }
      else if (rating >= 4) { r._score += 10; r._advantages.push('晨星四星'); }
      else if (rating >= 3) { r._score += 5; }

      // 收益
      if (ret1y != null && !isNaN(ret1y)) {
        if (ret1y > 30) { r._score += 15; }
        else if (ret1y > 15) { r._score += 10; }
        else if (ret1y > 0) { r._score += 5; }
        // 小规模+高收益=可疑
        if (ret1y > 50 && scale > 0 && scale < 10 && !isETF) {
          r._score -= 25;
          r._warnings.push('⚠️ 小规模短期暴利，高度警惕接盘老鼠仓');
        }
      }

      // 夏普比率
      if (sharp != null && !isNaN(sharp)) {
        if (sharp > 1.5) { r._score += 12; r._advantages.push('夏普' + sharp.toFixed(2) + '，风险收益比优'); }
        else if (sharp > 1) { r._score += 8; r._advantages.push('夏普' + sharp.toFixed(2) + '，收益风险比良'); }
        else if (sharp > 0.5) { r._score += 4; }
        else if (sharp < 0) { r._score -= 5; r._warnings.push('夏普为负，收益不及无风险利率'); }
      }

      // 最大回撤
      if (mdd != null && !isNaN(mdd) && mdd > 0) {
        if (mdd < 15) { r._score += 8; r._advantages.push('最大回撤' + mdd.toFixed(1) + '%，风控出色'); }
        else if (mdd > 40) { r._score -= 5; r._warnings.push('最大回撤' + mdd.toFixed(1) + '%，波动大'); }
      }

      // 费率
      if (fee === 0) { r._score += 8; r._advantages.push('零申购费'); }
      else if (fee > 0 && fee < 0.5) { r._score += 6; r._advantages.push('低费率' + fee + '%'); }
      else if (fee > 1.5) { r._score -= 5; r._warnings.push('费率' + fee + '%偏高'); }

      // 成立年限
      if (r.estabDate) {
        var years = (Date.now() - new Date(r.estabDate).getTime()) / (365.25 * 86400000);
        if (years > 5) { r._score += 8; r._advantages.push('成立' + Math.floor(years) + '年，历经牛熊'); }
        else if (years > 3) { r._score += 4; }
        else if (years < 1) { r._score -= 5; r._warnings.push('成立不足1年，业绩参考有限'); }
      }

      // 经理
      if (r.manager) r._advantages.push('经理: ' + r.manager);
    });
    rows.sort(function(a, b) { return (b._score || 0) - (a._score || 0); });
    return rows;
  }

  function renderIndustryCards(results) {
    var container = document.getElementById('fundIndustryList');
    if (!container) return;
    if (results.length === 0) {
      container.innerHTML = '<div class="fund-industry-loading">正在搜索...</div>';
      return;
    }
    var html = results.map(function(item, idx) {
      var ind = item.industry;
      var pct = ind.pct10 || 50;
      var valTag = pct < 30
        ? '<span class="fund-ind-val-tag low">低估 ' + pct + '%分位</span>'
        : pct > 70
        ? '<span class="fund-ind-val-tag high">高估 ' + pct + '%分位</span>'
        : '<span class="fund-ind-val-tag mid">中位 ' + pct + '%分位</span>';

      var fundCount = item.funds.length;
      var avgScore = fundCount > 0
        ? Math.round(item.funds.reduce(function(s, f) { return s + (f._score || 0); }, 0) / fundCount)
        : 0;
      // 检测是否有风险警告
      var hasWarning = item.funds.some(function(f) { return (f._warnings || []).length > 0; });
      var warnTag = hasWarning ? '<span class="fund-ind-warn-icon" title="含风险提示">⚠️</span>' : '';

      var fundsHtml = item.funds.map(function(r) {
        var isETF = (r.cat === 'zs' || (r.name && r.name.indexOf('ETF') >= 0));
        var badge = isETF ? '<span class="fund-rec-badge etf">ETF</span>'
                          : '<span class="fund-rec-badge">' + esc(r.cat || '基金') + '</span>';
        var scaleText = r.scaleYi ? (r.scaleYi > 100 ? Math.round(r.scaleYi) + '亿' : r.scaleYi.toFixed(1) + '亿') : '—';
        var ret1yText = (r.ret1y != null && !isNaN(r.ret1y))
          ? '<span class="' + (r.ret1y >= 0 ? 'up' : 'down') + '">近1年 ' + (r.ret1y > 0 ? '+' : '') + r.ret1y.toFixed(1) + '%</span>'
          : '<span>近1年 —</span>';
        var sharpText = (r.sharp != null && !isNaN(r.sharp)) ? '夏普 ' + r.sharp.toFixed(2) : '夏普 —';
        var fee = parseFloat(r.purchaseFee) || 0;
        var feeText = fee === 0 ? '费率 0%' : '费率 ' + fee + '%';
        var scoreBadge = '<span class="fund-rec-score">评分 ' + (r._score || 0) + '</span>';

        var tagsHtml = '';
        (r._advantages || []).slice(0, 3).forEach(function(a) {
          tagsHtml += '<span class="fund-rec-tag adv">✓ ' + esc(a) + '</span>';
        });
        (r._warnings || []).slice(3).slice(0, 3).forEach(function(w) {
          var cls = w.indexOf('⚠️') >= 0 ? 'danger' : 'warn';
          tagsHtml += '<span class="fund-rec-tag ' + cls + '">' + esc(w) + '</span>';
        });
        // Also include the first 3 warnings (was previously limited to 3 total)
        (r._warnings || []).slice(0, 3).forEach(function(w) {
          var cls = w.indexOf('⚠️') >= 0 ? 'danger' : 'warn';
          tagsHtml += '<span class="fund-rec-tag ' + cls + '">' + esc(w) + '</span>';
        });

        return '<div class="fund-rec-card" onclick="FundUI.openFundDetail(\'' + r.code + '\',\'' + esc(r.name).replace(/'/g, "\\'") + '\')">' +
          '<div class="fund-rec-top">' +
            '<span class="fund-rec-name">' + esc(r.name) + '</span>' +
            '<span class="fund-rec-code">' + esc(r.code) + '</span>' +
            badge +
            scoreBadge +
          '</div>' +
          '<div class="fund-rec-metrics">' +
            '<span>规模 <b>' + scaleText + '</b></span>' +
            ret1yText +
            '<span>' + sharpText + '</span>' +
            '<span>' + feeText + '</span>' +
          '</div>' +
          '<div class="fund-rec-tags">' + tagsHtml + '</div>' +
        '</div>';
      }).join('');

      // 默认折叠，第一个行业展开
      var expanded = idx === 0 ? ' expanded' : '';
      var toggleIcon = idx === 0 ? '▼' : '▶';

      return '<div class="fund-industry-card' + expanded + '" data-industry="' + esc(ind.name) + '">' +
        '<div class="fund-ind-card-header" onclick="FundUI.toggleIndustryCard(this)">' +
          '<span class="fund-ind-toggle">' + toggleIcon + '</span>' +
          '<span class="fund-ind-name">' + esc(ind.name) + '</span>' +
          valTag +
          '<span class="fund-ind-fund-count">' + fundCount + '只</span>' +
          warnTag +
        '</div>' +
        '<div class="fund-ind-funds">' + fundsHtml + '</div>' +
      '</div>';
    }).join('');
    container.innerHTML = html;
  }

  function toggleIndustryCard(headerEl) {
    var card = headerEl.closest('.fund-industry-card');
    if (!card) return;
    var isExpanded = card.classList.contains('expanded');
    card.classList.toggle('expanded');
    var toggle = headerEl.querySelector('.fund-ind-toggle');
    if (toggle) toggle.textContent = isExpanded ? '▶' : '▼';
  }

  function openFundDetail(code, name) {
    if (code) openDetail(code, name);
  }

  return {
    init: init,
    backToSearch: function() { closeDetail(); },
    openFundDetail: openFundDetail,
    toggleIndustryCard: toggleIndustryCard,
    renderIndustryFunds: renderIndustryFunds
  };
})();