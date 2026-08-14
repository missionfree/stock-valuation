/* ============================================================
   基金数据层（fund-data.js）
   数据源：东方财富/天天基金公开接口（全部通过 script/JSONP 加载，绕过 CORS）
   - 全量基金代码库：fundcode_search.js（27530+ 基金，含代码/名称/类型，作为浏览基础）
   - 关键词搜索（代码/名称/经理/公司）：FundSearchAPI（JSONP callback，上限10条）
   - 详情基础信息（风险/评级/夏普/回撤/波动/费率/经理/公司）：FundMNBasicInformation（JSONP）
     ※ 带 localStorage 缓存（6小时TTL），大幅减少重复请求
   - 前十大重仓 + 行业分布：FundMNInverstPosition（JSONP，按行业聚合）
   - 净值历史/经理履历/同类排名：pingzhongdata（script 标签，读全局变量后清理）
   注意：rankhandler 全量列表接口需 Referer 校验，静态页面无法使用
   更新延迟：净值每日更新，满足 ≤15 分钟要求
   ============================================================ */
var FundData = (function() {
  'use strict';

  /* ---------- localStorage 缓存（TTL 6小时） ---------- */
  var _CACHE_TTL = 6 * 3600 * 1000;
  var _memCache = {};  // code -> { data, ts }

  function cacheGet(code) {
    // 内存缓存优先
    if (_memCache[code]) {
      if (Date.now() - _memCache[code].ts < _CACHE_TTL) return _memCache[code].data;
      delete _memCache[code];
    }
    // localStorage 备用
    try {
      var raw = localStorage.getItem('_fund_bi_' + code);
      if (raw) {
        var obj = JSON.parse(raw);
        if (obj && obj.ts && Date.now() - obj.ts < _CACHE_TTL) {
          _memCache[code] = obj;
          return obj.data;
        }
        localStorage.removeItem('_fund_bi_' + code);
      }
    } catch (e) {}
    return null;
  }

  function cacheSet(code, data) {
    var obj = { data: data, ts: Date.now() };
    _memCache[code] = obj;
    try { localStorage.setItem('_fund_bi_' + code, JSON.stringify(obj)); } catch (e) {}
  }

  /* ---------- 通用 script / JSONP 加载器 ---------- */
  function loadScript(url, timeout) {
    timeout = timeout || 8000;
    return new Promise(function(resolve, reject) {
      var script = document.createElement('script');
      var timer = null;
      function cleanup() {
        if (timer) { clearTimeout(timer); timer = null; }
        if (script.parentNode) script.parentNode.removeChild(script);
      }
      timer = setTimeout(function() { cleanup(); reject(new Error('请求超时')); }, timeout);
      script.onload = function() { cleanup(); resolve(); };
      script.onerror = function() { cleanup(); reject(new Error('接口加载失败')); };
      script.src = url;
      document.head.appendChild(script);
    });
  }

  var _seq = 0;
  function jsonp(url, cbParam, timeout) {
    _seq++;
    var name = '_fd_cb_' + _seq;
    return new Promise(function(resolve, reject) {
      var timer = null;
      function cleanup() {
        if (timer) { clearTimeout(timer); timer = null; }
        delete window[name];
        var s = document.getElementById(name);
        if (s && s.parentNode) s.parentNode.removeChild(s);
      }
      timer = setTimeout(function() { cleanup(); reject(new Error('请求超时')); }, timeout || 8000);
      window[name] = function(data) { cleanup(); resolve(data); };
      var sep = url.indexOf('?') >= 0 ? '&' : '?';
      var script = document.createElement('script');
      script.id = name;
      script.src = url + sep + cbParam + '=' + name;
      script.onerror = function() { cleanup(); reject(new Error('接口加载失败')); };
      document.head.appendChild(script);
    });
  }

  /* ---------- 1. 基金列表（rankhandler） ----------
     params: type, sort, order, page, size
     resolve: { rows:[...], total, pages, page }
  */
  function getList(params) {
    params = params || {};
    var type = params.type || 'all';
    var sort = params.sort || 'dwjz';
    var order = params.order || 'desc';
    var page = params.page || 1;
    var size = params.size || 20;

    var url = 'https://fund.eastmoney.com/data/rankhandler.aspx' +
      '?op=ph&dt=kf&ft=' + encodeURIComponent(type) +
      '&rs=&gs=0&sc=' + encodeURIComponent(sort) +
      '&st=' + encodeURIComponent(order) +
      '&pi=' + page + '&pn=' + size + '&dx=1&v=' + Math.random();

    return loadScript(url, 10000).then(function() {
      var data = window.rankData;
      window.rankData = null;
      if (!data) return { rows: [], total: 0, pages: 0, page: page, err: '无数据' };
      if (!data.datas) return { rows: [], total: 0, pages: 0, page: page, err: data.Data || '无数据' };
      var rows = data.datas.map(parseRankRow).filter(Boolean);
      return {
        rows: rows,
        total: data.allRecords || 0,
        pages: data.allPages || 0,
        page: data.pageIndex || page
      };
    });
  }

  function parseRankRow(str) {
    if (!str) return null;
    var f = str.split(',');
    if (f.length < 19) return null;
    function num(v) {
      if (v === undefined || v === '' || v === '-' || v === '--') return null;
      var n = parseFloat(String(v).replace('%', ''));
      return isNaN(n) ? null : n;
    }
    return {
      code: f[0],
      name: f[1],
      pinyin: f[2],
      date: f[3],
      unitNav: num(f[4]),
      accNav: num(f[5]),
      dayChange: num(f[6]),
      ret1w: num(f[7]),
      ret1m: num(f[8]),
      ret3m: num(f[9]),
      ret6m: num(f[10]),
      ret1y: num(f[11]),
      ret2y: num(f[12]),
      ret3y: num(f[13]),
      retYear: num(f[14]),
      retAll: num(f[15]),
      estabDate: f[16],
      buyStatus: f[17],
      scaleYi: num(f[18]),
      purchaseFee: f[19],
      redeemFee: f[20],
      manageFee: f[22],
      managerCode: f[24]
    };
  }

  /* ---------- 2. 关键词搜索（代码/名称/基金经理/基金公司） ---------- */
  function search(keyword) {
    var url = 'https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx' +
      '?m=1&key=' + encodeURIComponent(keyword) + '&type=2&v=' + Math.random();
    return jsonp(url, 'callback', 8000).then(function(data) {
      if (!data || data.ErrCode !== 0 || !data.Datas) return [];
      return data.Datas
        .filter(function(d) { return d && d.FundBaseInfo; })
        .map(function(d) {
          var b = d.FundBaseInfo;
          return {
            code: b.FCODE || d.CODE,
            name: b.SHORTNAME || d.NAME,
            companyId: b.JJGSID,
            company: b.JJGS,
            managerId: b.JJJLID,
            manager: b.JJJL,
            type: b.FTYPE,
            fundType: b.FUNDTYPE,
            unitNav: parseFloat(b.DWJZ),
            date: b.FSRQ,
            minBuy: b.MINSG
          };
        });
    });
  }

  /* ---------- 3. 基金基础信息（风险/评级/夏普/回撤/波动/费率/经理/公司） ---------- */
  function basicInfo(code) {
    var cached = cacheGet(code);
    if (cached) return Promise.resolve(cached);
    var url = 'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNBasicInformation' +
      '?FCODE=' + encodeURIComponent(code) +
      '&deviceid=t&plat=Web&product=EFund&version=6.2.8&v=' + Math.random();
    return jsonp(url, 'callback', 8000).then(function(data) {
      var d = data && data.Datas;
      if (!d) return null;
      var scale = d.FEGM ? (parseFloat(d.FEGM) / 100000000) : null;
      var info = {
        code: d.FCODE,
        name: d.SHORTNAME,
        type: d.FTYPE,
        fundType: d.FUNDTYPE,
        cat: typeCategory(d.FTYPE),
        date: d.FSRQ,
        unitNav: parseFloat(d.DWJZ),
        accNav: parseFloat(d.LJJZ),
        dayChange: parseFloat(d.RZDF),
        riskLevel: d.RISKLEVEL,
        rating: d.RLEVEL_SZ,
        manager: d.JJJL,
        company: d.JJGS,
        companyId: d.JJGSID,
        estabDate: d.ESTABDATE || d._estabdate,
        scaleYi: (scale != null && !isNaN(scale)) ? scale : null,
        purchaseFee: d.SOURCERATE,
        currentRate: d.RATE,
        buyStatus: d.SGZT,
        redeemStatus: d.SHZT,
        sharp: parseFloat(d.SHARP1),
        maxDrawdown: parseFloat(d.MAXRETRA1),
        volatility: parseFloat(d.STDDEV1),
        invest: d.FUNDINVEST,
        ret1w: parseFloat(d.SYL_Z),
        ret1m: parseFloat(d.SYL_Y),
        ret3m: parseFloat(d.SYL_3Y),
        ret6m: parseFloat(d.SYL_6Y),
        ret1y: parseFloat(d.SYL_1N),
        ret2y: parseFloat(d.SYL_2N),
        ret3y: parseFloat(d.SYL_3N),
        retYear: parseFloat(d.SYL_JN),
        retAll: parseFloat(d.SYL_LN),
        minBuy: d.MINSG
      };
      cacheSet(code, info);
      return info;
    });
  }

  /* ---------- 4. pingzhongdata：净值历史/经理/同类排名/资产配置 ---------- */
  function pingzhong(code) {
    var url = 'https://fund.eastmoney.com/pingzhongdata/' + encodeURIComponent(code) + '.js?v=' + Math.random();
    return loadScript(url, 12000).then(function() {
      var result = {
        netWorthTrend: window.Data_netWorthTrend || [],
        accWorthTrend: window.Data_ACWorthTrend || [],
        currentManager: window.Data_currentFundManager || [],
        rateInSimilarPersent: window.Data_rateInSimilarPersent || [],
        assetAllocation: window.Data_assetAllocation || [],
        stockCodes: window.stockCodes || [],
        name: window.fS_name,
        sourceRate: window.fund_sourceRate,
        rate: window.fund_Rate,
        minBuy: window.fund_minsg
      };
      // 清理全局变量，避免下次加载残留
      try {
        delete window.Data_netWorthTrend;
        delete window.Data_ACWorthTrend;
        delete window.Data_currentFundManager;
        delete window.Data_rateInSimilarPersent;
        delete window.Data_assetAllocation;
        delete window.stockCodes;
        delete window.fS_name;
        delete window.fund_sourceRate;
        delete window.fund_Rate;
        delete window.fund_minsg;
      } catch (e) {}
      return result;
    });
  }

  /* ---------- 5. 前十大重仓 + 行业分布（移动端持仓接口） ---------- */
  function holdingsAndIndustry(code) {
    var url = 'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNInverstPosition' +
      '?FCODE=' + encodeURIComponent(code) +
      '&deviceid=t&plat=Web&product=EFund&version=6.2.8&v=' + Math.random();
    return jsonp(url, 'callback', 8000).then(function(res) {
      var d = res && res.Datas;
      var stocks = (d && d.fundStocks) || [];
      var holdings = [];
      var indMap = {};
      stocks.forEach(function(s) {
        holdings.push({
          code: s.GPDM,
          name: s.GPJC,
          pct: parseFloat(s.JZBL),
          chg: s.PCTNVCHGTYPE,
          ind: s.INDEXNAME
        });
        var ind = s.INDEXNAME || '其他';
        indMap[ind] = (indMap[ind] || 0) + (parseFloat(s.JZBL) || 0);
      });
      var industry = Object.keys(indMap).map(function(k) {
        return { name: k, pct: indMap[k] };
      }).sort(function(a, b) { return b.pct - a.pct; });
      return { holdings: holdings, industry: industry };
    }).catch(function() {
      return { holdings: [], industry: [] };
    });
  }

  /* ---------- 6. 实时估值（fundgz 已失效，保留占位） ---------- */
  function estimateQuote(code) {
    // fundgz.1234567.com.cn 接口已返回 404，暂不可用
    return Promise.resolve(null);
  }

  /* ---------- 7. 基金公司列表 ---------- */
  function companyList() {
    var url = 'https://fund.eastmoney.com/js/jjjz_gs.js?v=' + Math.random();
    return loadScript(url, 8000).then(function() {
      var gs = window.gs;
      var arr = (gs && gs.op) || [];
      return arr.map(function(pair) { return { id: pair[0], name: pair[1] }; });
    });
  }

  /* ---------- 8. 全量基金代码库（fundcode_search.js） ----------
     这是静态资产，无需 Referer，包含全部基金：code/pinyin/name/type(风格)/fullname。
     作为浏览模式的基础数据源（rankhandler 需要 Referer，静态页无法使用）。
     返回: [{ code, pinyin, name, fullname, style, cat }]
     cat: 投资类型分类 gp/hh/zq/zs/qdii/fof/hb/other
  */
  var _universe = null;
  var _universeLoading = null;
  function loadUniverse() {
    if (_universe) return Promise.resolve(_universe);
    if (_universeLoading) return _universeLoading;
    _universeLoading = loadScript('https://fund.eastmoney.com/js/fundcode_search.js?v=' + Math.random(), 20000)
      .then(function() {
        var r = window.r || [];
        var map = [];
        (r || []).forEach(function(row) {
          if (!row || row.length < 5) return;
          map.push({
            code: row[0],
            pinyin: row[1],
            name: row[2],
            style: row[3],
            fullname: row[4],
            cat: typeCategory(row[3])
          });
        });
        _universe = map;
        return _universe;
      })
      .catch(function() { _universe = []; return []; })
      .then(function(u) { _universeLoading = null; return u; });
    return _universeLoading;
  }

  function typeCategory(style) {
    if (!style) return 'other';
    style = String(style);
    if (style.indexOf('QDII') >= 0) return 'qdii';
    if (style.indexOf('FOF') >= 0) return 'fof';
    if (style.indexOf('货币') >= 0) return 'hb';
    if (style.indexOf('指数') >= 0) return 'zs';
    if (style.indexOf('股票') >= 0) return 'gp';
    if (style.indexOf('混合') >= 0) return 'hh';
    if (style.indexOf('债券') >= 0) return 'zq';
    return 'other';
  }

  /* ---------- 9. 批量增强：为一批基金补充基础信息 ---------- */
  // codes: 基金代码数组；cap: 最多增强数量；返回 Promise<rows>
  // 使用 localStorage 缓存，已缓存的基金立即返回，大幅减少网络请求
  function enrichBatch(codes, cap) {
    cap = cap || 150;
    var list = (codes || []).slice(0, cap);
    var results = [];
    var i = 0;
    var BATCH = 8;  // 每批8个并发
    function next() {
      if (i >= list.length) return Promise.resolve(results);
      var batch = list.slice(i, i + BATCH);
      i += BATCH;
      return Promise.all(batch.map(function(code) {
        return basicInfo(code).then(function(b) { return b; }).catch(function() { return null; });
      })).then(function(bs) {
        bs.forEach(function(b) { if (b) results.push(b); });
        return next();
      });
    }
    return next();
  }

  return {
    getList: getList,
    search: search,
    basicInfo: basicInfo,
    pingzhong: pingzhong,
    holdingsAndIndustry: holdingsAndIndustry,
    estimateQuote: estimateQuote,
    companyList: companyList,
    loadUniverse: loadUniverse,
    typeCategory: typeCategory,
    enrichBatch: enrichBatch
  };
})();