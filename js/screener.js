'use strict';

/* ============================================================
   Screener 智能选股引擎
   ------------------------------------------------------------
   精华借鉴: tickflow-stock-panel 的策略卡片式选股
   - 全A实时快照（东方财富 clist API，一次拉全市场+分页兜底）
   - 12个内置策略一键扫描（短线/价值/趋势/成长/情绪/风控/防御）
   - 自定义条件选股（多条件AND组合，条件持久化）
   - 命中行业分布 / 一键跳转个股分析 / 快速加入组合
   - 快照缓存: 交易时段3分钟，非交易时段60分钟
   ============================================================ */

var _scr = {
  stocks: [],          // 归一化后的全市场快照
  stats: null,         // 市场统计
  loading: false,
  active: null,        // 当前运行策略id 或 'custom'
  resultList: null,    // 当前结果（用于排序重渲）
  resultTitle: '',
  sortKey: null,
  sortDir: -1,
  updatedTs: 0,
  incomplete: false,   // 快照是否不完整（有失败页）
  custom: []           // 自定义条件 [{field,op,v1,v2}]
};

var SCR_CACHE_KEY = 'screener_snapshot_v3'; // v3: 旧版残缺快照(1200只)全部作废
var SCR_CUSTOM_KEY = 'screener_custom_v2';
var SCR_MAX_ROWS = 150;
var SCR_PAGE_SIZE = 100;   // 东财clist接口单页硬上限=100（实测pz传大也只回100）
var SCR_BATCH = 4;         // 分页并发数（温和，防限流）
var SCR_PAGE_RETRY = 1;    // 单页失败重试次数（每次重试内部还会轮换3个域名）
var _scrGen = 0;           // 扫描代际号：新扫描开始时旧扫描的结果直接作废

/* ============================================================
   一、工具函数
   ============================================================ */

function _scrEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function _scrNum(v) {
  if (v === '-' || v === null || v === undefined || v === '') return null;
  var n = typeof v === 'number' ? v : parseFloat(v);
  return isNaN(n) ? null : n;
}

/* 市值/金额格式化: 输入元 */
function _scrFmtCap(v) {
  if (v === null || v === undefined) return '--';
  var a = Math.abs(v);
  if (a >= 1e12) return (v / 1e12).toFixed(2) + '万亿';
  if (a >= 1e8) return (v / 1e8).toFixed(1) + '亿';
  if (a >= 1e4) return (v / 1e4).toFixed(1) + '万';
  return String(Math.round(v));
}

/* 主力净流入格式化: 输入元 */
function _scrFmtInflow(v) {
  if (v === null || v === undefined) return '--';
  var a = Math.abs(v);
  if (a >= 1e8) return (v > 0 ? '+' : '') + (v / 1e8).toFixed(2) + '亿';
  if (a >= 1e4) return (v > 0 ? '+' : '') + Math.round(v / 1e4) + '万';
  return (v > 0 ? '+' : '') + v.toFixed(0);
}

function _scrVal(v, digits, suffix) {
  if (v === null || v === undefined) return '--';
  return v.toFixed(digits) + (suffix || '');
}

function _scrTimeStr(ts) {
  var d = new Date(ts);
  return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
}

/* 是否交易时段（含少量缓冲） */
function _scrIsTrading() {
  var d = new Date();
  var day = d.getDay();
  if (day === 0 || day === 6) return false;
  var hm = d.getHours() * 100 + d.getMinutes();
  return (hm >= 915 && hm <= 1135) || (hm >= 1255 && hm <= 1505);
}

function _scrCacheTTL() {
  return _scrIsTrading() ? 3 * 60 * 1000 : 60 * 60 * 1000;
}

/* 是否可交易（剔除停牌/零成交） */
function _scrTradable(s) {
  return s.price !== null && s.price > 0.1 && s.volume > 0;
}

/* 是否普通股（剔除ST/退市） */
function _scrNormal(s) {
  return !/ST|退/i.test(s.name);
}

/* ============================================================
   二、数据层：全A快照拉取
   ============================================================ */

var SCR_FIELDS = 'f2,f3,f5,f6,f8,f9,f10,f12,f14,f20,f21,f23,f24,f25,f62,f100,f115';
var SCR_FS = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23'; // 沪深A股: 深主板+创业板+沪主板+科创板
var SCR_HOSTS = [
  'https://push2.eastmoney.com/api/qt/clist/get',
  'https://82.push2.eastmoney.com/api/qt/clist/get',
  'https://push2delay.eastmoney.com/api/qt/clist/get'
];

function _scrUrl(host, pn, pz) {
  return host + '?pn=' + pn + '&pz=' + pz + '&po=0&np=1&fltt=2&invt=2' +
    '&fid=f12&fs=' + SCR_FS + '&fields=' + SCR_FIELDS;
}

/* 单页请求：主源失败自动切备用源 */
function _scrFetchPage(pn, pz) {
  var i = 0;
  function tryHost() {
    if (i >= SCR_HOSTS.length) return Promise.reject(new Error('全市场接口请求失败'));
    var host = SCR_HOSTS[i++];
    return emJsonp(_scrUrl(host, pn, pz), 8000).then(function(res) {
      if (!res || !res.data || !res.data.diff) throw new Error('empty');
      return res.data;
    }).catch(function() {
      return tryHost();
    });
  }
  return tryHost();
}

/* 归一化单条记录 */
function _scrNormalize(d) {
  return {
    code: String(d.f12 || ''),
    name: String(d.f14 || ''),
    price: _scrNum(d.f2),
    chg: _scrNum(d.f3),        // 涨跌幅%
    volume: _scrNum(d.f5),     // 成交量(手)
    amount: _scrNum(d.f6),     // 成交额(元)
    turnover: _scrNum(d.f8),   // 换手率%
    peDyn: _scrNum(d.f9),
    volRatio: _scrNum(d.f10),  // 量比
    mktCap: _scrNum(d.f20),    // 总市值(元)
    floatCap: _scrNum(d.f21),  // 流通市值(元)
    pb: _scrNum(d.f23),
    chg60d: _scrNum(d.f24),    // 60日涨跌幅%
    chgYtd: _scrNum(d.f25),
    mainInflow: _scrNum(d.f62),// 主力净流入(元)
    industry: String(d.f100 || '--'),
    peTtm: _scrNum(d.f115)     // 市盈率TTM
  };
}

/**
 * 拉取全市场快照（固定100/页分页拉全，杜绝截断）
 * 接口实测：clist单页硬上限100条，全A约5551只=56页
 * - 第1页先拿total，再并发分批拉剩余页（SCR_BATCH页/批）
 * - 单页失败自动重试（重试时内部轮换3个域名）
 * - 按code去重，防止翻页期间数据变动造成重复
 * - 代际号gen由调用方持有：期间若有新会话(_scrGen变化)，本会话所有回调作废
 * @param {number} gen - 本次扫描的代际号（调用前先 ++_scrGen 取得）
 * @param {function} onProgress - (已获取去重数, 预计总数)
 * @returns {Promise<{list,total,failed}>}
 */
function _scrFetchAll(gen, onProgress) {
  function alive() { return gen === _scrGen; }

  function fetchPageRetry(pn) {
    var attempt = 0;
    function tryOnce() {
      if (!alive()) return Promise.reject(new Error('aborted'));
      return _scrFetchPage(pn, SCR_PAGE_SIZE).catch(function(err) {
        if (!alive() || attempt >= SCR_PAGE_RETRY) throw err;
        attempt++;
        return tryOnce();
      });
    }
    return tryOnce();
  }

  var map = {};   // code -> 原始item（去重容器）
  var got = 0;
  function absorb(diffArr) {
    for (var j = 0; j < diffArr.length; j++) {
      var it = diffArr[j];
      if (it && it.f12 && !map[it.f12]) { map[it.f12] = it; got++; }
    }
  }

  return fetchPageRetry(1).then(function(first) {
    if (!alive()) throw new Error('aborted');
    var total = first.total || first.diff.length;
    absorb(first.diff);
    onProgress && onProgress(got, total);

    var pages = Math.ceil(total / SCR_PAGE_SIZE);
    var next = 2;
    var failedPages = 0;

    function batch() {
      if (!alive()) return Promise.reject(new Error('aborted'));
      if (next > pages) return Promise.resolve();
      var ps = [];
      for (var i = 0; i < SCR_BATCH && next <= pages; i++, next++) ps.push(next);
      return Promise.all(ps.map(function(p) {
        return fetchPageRetry(p).then(function(pg) {
          absorb(pg.diff || []);
        }).catch(function() { failedPages++; });
      })).then(function() {
        onProgress && onProgress(got, total);
        return batch();
      });
    }

    return batch().then(function() {
      if (!alive()) throw new Error('aborted');
      var list = [];
      for (var k in map) list.push(map[k]);
      return { list: list, total: total, failed: failedPages };
    });
  });
}

/* 缓存读写 */
function _scrLoadCache() {
  try {
    var raw = JSON.parse(localStorage.getItem(SCR_CACHE_KEY) || 'null');
    if (raw && raw.ts && raw.data && raw.data.length > 1000 &&
        Date.now() - raw.ts < _scrCacheTTL()) {
      return raw;
    }
  } catch (e) {}
  return null;
}

function _scrSaveCache(stocks) {
  try {
    localStorage.setItem(SCR_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: stocks }));
  } catch (e) { /* 超配额则放弃缓存 */ }
}

/* 市场统计 */
function _scrComputeStats(list) {
  var up = 0, down = 0, flat = 0, limitUp = 0, limitDown = 0;
  var inflow = 0, amount = 0, valid = 0;
  for (var i = 0; i < list.length; i++) {
    var s = list[i];
    if (!_scrTradable(s)) continue;
    valid++;
    if (s.chg > 0) up++; else if (s.chg < 0) down++; else flat++;
    if (s.chg >= 9.9) limitUp++;
    if (s.chg <= -9.9) limitDown++;
    if (s.mainInflow !== null) inflow += s.mainInflow;
    if (s.amount !== null) amount += s.amount;
  }
  return { total: list.length, valid: valid, up: up, down: down, flat: flat,
           limitUp: limitUp, limitDown: limitDown, inflow: inflow, amount: amount };
}

/* ============================================================
   三、内置策略库（12个）
   ============================================================ */

var SCR_STRATEGIES = [
  {
    id: 'inflow', icon: '🔥', name: '主力抢筹', tag: '短线', sortKey: 'mainInflow',
    desc: '主力净流入>3000万 · 换手3~15% · 涨幅0~7%（大资金进场但尚未拉升）',
    filter: function(s) {
      return _scrNormal(s) && s.mainInflow > 3e7 && s.turnover >= 3 && s.turnover <= 15 &&
        s.chg >= 0 && s.chg <= 7 && s.floatCap > 3e9;
    }
  },
  {
    id: 'volstart', icon: '🚀', name: '放量启动', tag: '短线', sortKey: 'volRatio',
    desc: '量比≥2 · 涨幅1~6% · 换手2~12%（放量初涨，主力试探性进攻）',
    filter: function(s) {
      return _scrNormal(s) && s.volRatio >= 2 && s.chg >= 1 && s.chg <= 6 &&
        s.turnover >= 2 && s.turnover <= 12 && s.floatCap > 2e9;
    }
  },
  {
    id: 'volup', icon: '⚡', name: '量价齐升', tag: '短线', sortKey: 'chg',
    desc: '量比≥1.5 · 涨幅≥3% · 换手≥5% · 流通市值≥50亿（强势加速）',
    filter: function(s) {
      return _scrNormal(s) && s.volRatio >= 1.5 && s.chg >= 3 && s.turnover >= 5 &&
        s.floatCap >= 5e9;
    }
  },
  {
    id: 'bluechip', icon: '💎', name: '低估蓝筹', tag: '价值', sortKey: 'floatCap',
    desc: 'PE(TTM)5~20 · PB0.5~2 · 流通市值≥300亿（便宜的大白马）',
    filter: function(s) {
      return _scrNormal(s) && s.peTtm >= 5 && s.peTtm <= 20 && s.pb >= 0.5 && s.pb <= 2 &&
        s.floatCap >= 3e10;
    }
  },
  {
    id: 'netasset', icon: '🏦', name: '破净修复', tag: '价值', sortKey: 'pb',
    sortDir: 1,
    desc: 'PB<0.9 · PE(TTM)0~15 · 主力净流入为正（破净且有人开始买）',
    filter: function(s) {
      return _scrNormal(s) && s.pb !== null && s.pb < 0.9 && s.peTtm !== null &&
        s.peTtm > 0 && s.peTtm < 15 && s.mainInflow > 0;
    }
  },
  {
    id: 'defensive', icon: '🛡️', name: '低波防御', tag: '防御', sortKey: 'floatCap',
    desc: 'PE(TTM)0~15 · PB<1.2 · 换手<3% · 60日跌幅<5%（类红利底仓）',
    filter: function(s) {
      return _scrNormal(s) && s.peTtm > 0 && s.peTtm < 15 && s.pb !== null && s.pb < 1.2 &&
        s.turnover < 3 && s.chg60d !== null && s.chg60d > -5 && s.floatCap > 1e10;
    }
  },
  {
    id: 'oversold', icon: '📉', name: '超跌反弹', tag: '抄底', sortKey: 'chg60d',
    sortDir: 1,
    desc: '60日跌幅>20% · 今日翻红 · 量比≥1（跌深且有资金回流）',
    filter: function(s) {
      return _scrNormal(s) && s.chg60d !== null && s.chg60d < -20 && s.chg > 0 &&
        s.volRatio >= 1 && s.floatCap > 2e9;
    }
  },
  {
    id: 'trend', icon: '💪', name: '强势多头', tag: '趋势', sortKey: 'chg60d',
    desc: '60日涨幅>15% · 今日上涨 · 量比≥1 · 流通市值>50亿（趋势延续）',
    filter: function(s) {
      return _scrNormal(s) && s.chg60d > 15 && s.chg > 0 && s.volRatio >= 1 &&
        s.floatCap > 5e9;
    }
  },
  {
    id: 'smallgrowth', icon: '🌱', name: '小盘成长', tag: '成长', sortKey: 'chg60d',
    desc: '流通市值30~150亿 · PE(TTM)10~50 · 60日涨幅>10%（弹性进攻）',
    filter: function(s) {
      return _scrNormal(s) && s.floatCap >= 3e9 && s.floatCap <= 1.5e10 &&
        s.peTtm >= 10 && s.peTtm <= 50 && s.chg60d > 10;
    }
  },
  {
    id: 'limitup', icon: '🔴', name: '强势涨停', tag: '情绪', sortKey: 'amount',
    desc: '今日涨幅≥9.9%（主板涨停/双创大涨），按成交额排序看人气',
    filter: function(s) {
      return _scrNormal(s) && s.chg >= 9.9;
    }
  },
  {
    id: 'hot', icon: '💰', name: '人气活跃', tag: '情绪', sortKey: 'amount',
    desc: '成交额≥15亿 · 换手≥10%（全市场资金聚焦的人气股）',
    filter: function(s) {
      return _scrNormal(s) && s.amount >= 1.5e9 && s.turnover >= 10;
    }
  },
  {
    id: 'flee', icon: '⚠️', name: '主力出逃', tag: '风控', sortKey: 'mainInflow',
    sortDir: 1,
    desc: '主力净流出>1亿 · 跌幅>3%（持仓风险自查，反指参考）',
    filter: function(s) {
      return _scrNormal(s) && s.mainInflow < -1e8 && s.chg < -3;
    }
  }
];

/* 自定义条件可选字段（scale: 输入值单位换算到元） */
var SCR_CUSTOM_FIELDS = [
  { key: 'chg',       name: '涨跌幅%',      scale: 1 },
  { key: 'volRatio',  name: '量比',          scale: 1 },
  { key: 'turnover',  name: '换手率%',       scale: 1 },
  { key: 'peTtm',     name: '市盈率TTM',     scale: 1 },
  { key: 'pb',        name: '市净率',        scale: 1 },
  { key: 'chg60d',    name: '60日涨跌幅%',   scale: 1 },
  { key: 'floatCap',  name: '流通市值(亿)',   scale: 1e8 },
  { key: 'amount',    name: '成交额(亿)',     scale: 1e8 },
  { key: 'mainInflow',name: '主力净流入(万)', scale: 1e4 }
];

/* ============================================================
   四、筛选与排序
   ============================================================ */

function _scrFilter(list, fn) {
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var s = list[i];
    if (!_scrTradable(s)) continue;
    if (fn(s)) out.push(s);
  }
  return out;
}

function _scrSortArr(arr, key, dir) {
  arr.sort(function(a, b) {
    var va = a[key], vb = b[key];
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    if (va === vb) return a.code < b.code ? -1 : 1;
    return (va - vb) * dir;
  });
}

/* 行业分布 top N */
function _scrIndustryDist(list, n) {
  var map = {};
  for (var i = 0; i < list.length; i++) {
    var ind = list[i].industry || '--';
    if (ind === '--') continue;
    map[ind] = (map[ind] || 0) + 1;
  }
  var arr = Object.keys(map).map(function(k) { return { name: k, count: map[k] }; });
  arr.sort(function(a, b) { return b.count - a.count; });
  return arr.slice(0, n || 6);
}

/* 个股是否已在任一组合 */
function _scrInPortfolio(code) {
  try {
    if (typeof _portfolios === 'undefined' || !_portfolios) return false;
    for (var i = 0; i < _portfolios.length; i++) {
      var items = _portfolios[i].items || [];
      for (var j = 0; j < items.length; j++) {
        if (items[j].code === code) return true;
      }
    }
  } catch (e) {}
  return false;
}

/* ============================================================
   五、渲染
   ============================================================ */

function _scrRenderStats() {
  var el = document.getElementById('scrStats');
  if (!el) return;
  if (_scr.loading) return; // 加载中UI由进度渲染负责
  var st = _scr.stats;
  if (!st) {
    el.innerHTML = '<div class="scr-loading">⏳ 全市场数据待加载，点击右上角「扫描全市场」开始</div>';
    return;
  }
  var warn = _scr.incomplete
    ? '<div class="scr-incomplete">⚠️ 本轮快照不完整（' + st.valid + ' 只），结果可能遗漏 · <span class="scr-retry-link" onclick="screenerRefresh(true)">重新扫描</span></div>'
    : '';
  var inflowCls = st.inflow >= 0 ? 'scr-up' : 'scr-down';
  var mood = st.up > st.down * 1.5 ? '偏强' : (st.down > st.up * 1.5 ? '偏弱' : '均衡');
  var moodCls = st.up > st.down * 1.5 ? 'scr-up' : (st.down > st.up * 1.5 ? 'scr-down' : '');
  el.innerHTML = warn +
    '<div class="scr-stat-card">' +
      '<div class="scr-stat-val">' + st.valid + '<small>只</small></div>' +
      '<div class="scr-stat-lbl">扫描个股</div>' +
    '</div>' +
    '<div class="scr-stat-card"><div class="scr-stat-val scr-up">' + st.up + '</div><div class="scr-stat-lbl">上涨家数</div></div>' +
    '<div class="scr-stat-card"><div class="scr-stat-val scr-down">' + st.down + '</div><div class="scr-stat-lbl">下跌家数</div></div>' +
    '<div class="scr-stat-card"><div class="scr-stat-val scr-up">' + st.limitUp + '</div><div class="scr-stat-lbl">涨幅≥9.9%</div></div>' +
    '<div class="scr-stat-card"><div class="scr-stat-val ' + inflowCls + '">' + _scrFmtInflow(st.inflow) + '</div><div class="scr-stat-lbl">主力净流入合计</div></div>' +
    '<div class="scr-stat-card"><div class="scr-stat-val">' + (st.amount / 1e12).toFixed(2) + '万亿</div><div class="scr-stat-lbl">两市成交额</div></div>' +
    '<div class="scr-stat-card"><div class="scr-stat-val ' + moodCls + '">' + mood + '</div><div class="scr-stat-lbl">涨跌情绪</div></div>';
}

function _scrRenderProgress(cur, total) {
  var el = document.getElementById('scrStats');
  if (!el) return;
  var pct = total > 0 ? Math.min(100, Math.round(cur / total * 100)) : 10;
  el.innerHTML = '<div class="scr-loading">' +
    '<div class="scr-progress-info">📡 正在扫描全市场（' + (total ? Math.ceil(total / SCR_PAGE_SIZE) : '—') + '页分批拉取）… <b>' + cur + '</b> / ' + (total || '—') + ' 只 · ' + pct + '%</div>' +
    '<div class="scr-progress-bar"><div class="scr-progress-fill" style="width:' + pct + '%"></div></div>' +
    '<div class="scr-progress-sub">首次约需5-10秒 · 完成后缓存3分钟 · 请勿频繁重复扫描</div>' +
    '</div>';
}

function _scrRenderCards() {
  var el = document.getElementById('scrCards');
  if (!el) return;
  var has = _scr.stocks.length > 0;
  var html = '';
  for (var i = 0; i < SCR_STRATEGIES.length; i++) {
    var sg = SCR_STRATEGIES[i];
    var count = has ? _scrFilter(_scr.stocks, sg.filter).length : null;
    var active = _scr.active === sg.id;
    html += '<div class="scr-card' + (active ? ' scr-card-active' : '') + '" onclick="screenerRun(\'' + sg.id + '\')" role="button" aria-label="运行策略 ' + _scrEsc(sg.name) + '">' +
      '<div class="scr-card-head">' +
        '<span class="scr-card-name"><span class="scr-card-icon">' + sg.icon + '</span>' + sg.name + '</span>' +
        '<span class="scr-card-tag scr-tag-' + sg.tag + '">' + sg.tag + '</span>' +
      '</div>' +
      '<div class="scr-card-desc">' + sg.desc + '</div>' +
      '<div class="scr-card-foot">' +
        (count !== null ? '<span class="scr-card-count">命中 <b>' + count + '</b> 只</span>' : '<span class="scr-card-count scr-muted">待扫描</span>') +
        '<span class="scr-card-run">' + (active ? '已运行 ▲' : '运行 ▶') + '</span>' +
      '</div>' +
    '</div>';
  }
  el.innerHTML = html;
}

/* 结果表格列定义 */
var SCR_COLS = [
  { key: 'name',     label: '名称/代码', sortable: false },
  { key: 'price',    label: '现价',      sortable: true },
  { key: 'chg',      label: '涨跌幅',    sortable: true },
  { key: 'volRatio', label: '量比',      sortable: true },
  { key: 'turnover', label: '换手%',     sortable: true },
  { key: 'peTtm',    label: 'PE(TTM)',   sortable: true },
  { key: 'pb',       label: 'PB',        sortable: true },
  { key: 'floatCap', label: '流通市值',  sortable: true },
  { key: 'mainInflow', label: '主力净流入', sortable: true },
  { key: 'industry', label: '行业',      sortable: false },
  { key: 'op',       label: '操作',      sortable: false }
];

function _scrRenderResults() {
  var el = document.getElementById('scrResults');
  if (!el) return;
  if (!_scr.resultList) { el.innerHTML = ''; return; }

  var list = _scr.resultList.slice();
  if (_scr.sortKey) _scrSortArr(list, _scr.sortKey, _scr.sortDir);

  var shown = list.slice(0, SCR_MAX_ROWS);
  var dist = _scrIndustryDist(list, 6);
  var sortHint = _scr.sortKey ? '（已按' + _scrColLabel(_scr.sortKey) + (_scr.sortDir === -1 ? '↓降序' : '↑升序') + '）' : '';

  var html = '<div class="scr-res-box">' +
    '<div class="scr-res-head">' +
      '<span class="scr-res-title">' + _scr.resultTitle + ' · <b class="scr-up">' + list.length + '</b> 只命中' + sortHint + '</span>' +
      '<span class="scr-res-close" onclick="screenerClearResults()" title="收起结果">✕</span>' +
    '</div>';

  if (list.length === 0) {
    html += '<div class="scr-empty">该策略当前无命中 —— 市场环境不满足条件，换个策略或调整自定义条件试试</div></div>';
    el.innerHTML = html;
    return;
  }

  if (dist.length > 0) {
    html += '<div class="scr-dist"><span class="scr-dist-lbl">行业分布:</span>';
    for (var i = 0; i < dist.length; i++) {
      html += '<span class="scr-dist-chip">' + _scrEsc(dist[i].name) + ' <b>' + dist[i].count + '</b></span>';
    }
    html += '</div>';
  }

  html += '<div class="scr-table-wrap"><table class="scr-table"><thead><tr>';
  for (var c = 0; c < SCR_COLS.length; c++) {
    var col = SCR_COLS[c];
    if (col.sortable) {
      var arrow = _scr.sortKey === col.key ? (_scr.sortDir === -1 ? ' ↓' : ' ↑') : '';
      html += '<th class="scr-th-sort" onclick="scrSort(\'' + col.key + '\')">' + col.label + arrow + '</th>';
    } else {
      html += '<th>' + col.label + '</th>';
    }
  }
  html += '</tr></thead><tbody>';

  for (var r = 0; r < shown.length; r++) {
    var s = shown[r];
    var chgCls = s.chg > 0 ? 'scr-up' : (s.chg < 0 ? 'scr-down' : '');
    var inflowCls = s.mainInflow > 0 ? 'scr-up' : (s.mainInflow < 0 ? 'scr-down' : '');
    var inPort = _scrInPortfolio(s.code) ? ' <span class="scr-inport" title="已在组合">📌</span>' : '';
    html += '<tr onclick="screenerViewStock(\'' + s.code + '\')" class="scr-row">' +
      '<td class="scr-td-name"><b>' + _scrEsc(s.name) + '</b>' + inPort + '<span class="scr-td-code">' + s.code + '</span></td>' +
      '<td class="scr-td-num">' + _scrVal(s.price, 2) + '</td>' +
      '<td class="scr-td-num ' + chgCls + '">' + (s.chg > 0 ? '+' : '') + _scrVal(s.chg, 2, '%') + '</td>' +
      '<td class="scr-td-num">' + _scrVal(s.volRatio, 2) + '</td>' +
      '<td class="scr-td-num">' + _scrVal(s.turnover, 2) + '</td>' +
      '<td class="scr-td-num">' + _scrVal(s.peTtm, 1) + '</td>' +
      '<td class="scr-td-num">' + _scrVal(s.pb, 2) + '</td>' +
      '<td class="scr-td-num">' + _scrFmtCap(s.floatCap) + '</td>' +
      '<td class="scr-td-num ' + inflowCls + '">' + _scrFmtInflow(s.mainInflow) + '</td>' +
      '<td class="scr-td-ind">' + _scrEsc(s.industry) + '</td>' +
      '<td class="scr-td-op">' +
        '<button class="scr-btn scr-btn-view" onclick="event.stopPropagation();screenerViewStock(\'' + s.code + '\')">分析</button>' +
        '<button class="scr-btn scr-btn-add" onclick="event.stopPropagation();screenerAddStock(\'' + s.code + '\',\'' + _scrEsc(s.name).replace(/'/g, '') + '\')">+组</button>' +
      '</td>' +
    '</tr>';
  }
  html += '</tbody></table></div>';

  if (list.length > SCR_MAX_ROWS) {
    html += '<div class="scr-more-note">共 ' + list.length + ' 只命中，仅展示前 ' + SCR_MAX_ROWS + ' 只（点击表头可排序查看头部）</div>';
  }
  html += '<div class="scr-res-tip">💡 点击任意行 → 自动跳转个股深度分析；「+组」快速加入我的组合</div>';
  html += '</div>';
  el.innerHTML = html;
}

function _scrColLabel(key) {
  for (var i = 0; i < SCR_COLS.length; i++) {
    if (SCR_COLS[i].key === key) return SCR_COLS[i].label;
  }
  return key;
}

/* 自定义条件构建器 */
function _scrRenderCustom() {
  var el = document.getElementById('scrCustom');
  if (!el) return;
  var html = '<div class="scr-custom-box">';
  if (!_scr.custom.length) {
    _scr.custom = [{ field: 'volRatio', op: '≥', v1: 2, v2: '' }];
  }
  for (var i = 0; i < _scr.custom.length; i++) {
    var cd = _scr.custom[i];
    var isRange = cd.op === '区间';
    html += '<div class="scr-cond-row">' +
      '<select onchange="scrCondChange(' + i + ',\'field\',this.value)">';
    for (var f = 0; f < SCR_CUSTOM_FIELDS.length; f++) {
      var fd = SCR_CUSTOM_FIELDS[f];
      html += '<option value="' + fd.key + '"' + (cd.field === fd.key ? ' selected' : '') + '>' + fd.name + '</option>';
    }
    html += '</select>' +
      '<select onchange="scrCondChange(' + i + ',\'op\',this.value)">' +
        '<option' + (cd.op === '≥' ? ' selected' : '') + '>≥</option>' +
        '<option' + (cd.op === '≤' ? ' selected' : '') + '>≤</option>' +
        '<option' + (isRange ? ' selected' : '') + '>区间</option>' +
      '</select>' +
      '<input type="number" step="any" value="' + (cd.v1 === null || cd.v1 === undefined ? '' : cd.v1) + '" onchange="scrCondChange(' + i + ',\'v1\',this.value)" placeholder="数值">' +
      '<span class="scr-cond-range"' + (isRange ? '' : ' style="display:none"') + '>~</span>' +
      '<input type="number" step="any" value="' + (cd.v2 === null || cd.v2 === undefined ? '' : cd.v2) + '" onchange="scrCondChange(' + i + ',\'v2\',this.value)" placeholder="上限"' + (isRange ? '' : ' style="display:none"') + '>' +
      '<button class="scr-cond-del" onclick="scrCondRemove(' + i + ')" title="删除条件"' + (_scr.custom.length <= 1 ? ' disabled' : '') + '>✕</button>' +
    '</div>';
  }
  html += '<div class="scr-custom-actions">' +
    '<button class="scr-btn scr-btn-ghost" onclick="scrCondAdd()">+ 添加条件</button>' +
    '<button class="scr-btn scr-btn-run" onclick="screenerRunCustom()">▶ 运行自定义选股</button>' +
    '<span class="scr-custom-hint">多条件为「且」关系 · 条件自动保存</span>' +
  '</div></div>';
  el.innerHTML = html;
}

function _scrRenderUpdated() {
  var el = document.getElementById('scrUpdated');
  if (!el) return;
  if (_scr.updatedTs) {
    el.textContent = '数据 ' + _scrTimeStr(_scr.updatedTs) + (_scrIsTrading() ? ' · 交易中' : ' · 已收盘');
  } else {
    el.textContent = '—';
  }
  var btn = document.getElementById('scrRefreshBtn');
  if (btn) {
    btn.disabled = _scr.loading;
    btn.textContent = _scr.loading ? '⏳ 扫描中…' : '⟳ 扫描全市场';
  }
}

function _scrRenderAll() {
  _scrRenderStats();
  _scrRenderCards();
  _scrRenderUpdated();
}

/* ============================================================
   六、交互入口（全局）
   ============================================================ */

/** Tab首次打开时初始化 */
function screenerInit() {
  _scrRenderCustom();
  var cached = _scrLoadCache();
  if (cached) {
    _scr.stocks = cached.data;
    _scr.updatedTs = cached.ts;
    _scr.stats = _scrComputeStats(_scr.stocks);
    _scrRenderAll();
    return;
  }
  _scrRenderAll();
  screenerRefresh(false);
}

/** 每次切到选股Tab时调用：缓存过期则静默刷新 */
function screenerEnsureFresh() {
  if (_scr.loading) return;
  if (_scr.stocks.length > 0 && _scr.updatedTs &&
      Date.now() - _scr.updatedTs < _scrCacheTTL()) return;
  screenerRefresh(false);
}

/** 全市场刷新（并发防护：同一时刻只允许一个扫描会话） */
function screenerRefresh(manual) {
  if (_scr.loading) {
    if (manual) showToast('正在扫描中，请稍候…');
    return;
  }
  _scr.loading = true;
  _scrRenderUpdated();
  _scrRenderProgress(0, 0);

  // 取得新代际号：若上一会话仍有残留请求/回调，全部作废（并发防护双保险）
  var gen = ++_scrGen;
  _scrFetchAll(gen, function(cur, total) {
    _scrRenderProgress(cur, total);
  }).then(function(res) {
    _scr.stocks = [];
    for (var i = 0; i < res.list.length; i++) {
      var s = _scrNormalize(res.list[i]);
      if (s.code && s.name) _scr.stocks.push(s);
    }
    _scr.updatedTs = Date.now();
    _scr.stats = _scrComputeStats(_scr.stocks);
    // 完整性判定：无失败页 且 覆盖率≥95%
    _scr.incomplete = res.failed > 0 || _scr.stocks.length < res.total * 0.95;
    if (!_scr.incomplete) _scrSaveCache(_scr.stocks); // 不完整快照不落缓存，避免劣币驱逐
    _scrRenderAll();
    // 若已有运行中的策略，自动重跑
    if (_scr.active === 'custom') screenerRunCustom(true);
    else if (_scr.active) screenerRun(_scr.active, true);
    if (manual) {
      if (_scr.incomplete) {
        showToast('扫描完成但数据不完整：' + _scr.stocks.length + '/' + res.total + '（' + res.failed + '页失败），稍后可重试');
      } else {
        showToast('全市场扫描完成：' + _scr.stocks.length + ' 只');
      }
    }
  }).catch(function(err) {
    if (err && err.message === 'aborted') return; // 被新扫描会话取代，静默退出
    if (_scr.stocks.length > 0) {
      _scrRenderAll();
      showToast('刷新失败，继续使用现有数据');
    } else {
      var el = document.getElementById('scrStats');
      if (el) el.innerHTML = '<div class="scr-loading scr-error">❌ ' + _scrEsc(err.message || '数据加载失败') + '，请点击右上角「扫描全市场」重试</div>';
      _scrRenderCards();
    }
  }).then(function() {
    // 仅当本会话仍是当前代际时才解锁，避免误重置新会话的loading状态
    if (gen === _scrGen) {
      _scr.loading = false;
      _scrRenderUpdated();
    }
  });
}

/** 运行内置策略 */
function screenerRun(id, silent) {
  var sg = null;
  for (var i = 0; i < SCR_STRATEGIES.length; i++) {
    if (SCR_STRATEGIES[i].id === id) { sg = SCR_STRATEGIES[i]; break; }
  }
  if (!sg) return;
  if (!_scr.stocks.length) {
    showToast('全市场数据尚未就绪，请先扫描');
    return;
  }
  _scr.active = id;
  _scr.sortKey = sg.sortKey;
  _scr.sortDir = sg.sortDir || -1;
  _scr.resultList = _scrFilter(_scr.stocks, sg.filter);
  _scr.resultTitle = sg.icon + ' ' + sg.name;
  _scrRenderCards();
  _scrRenderResults();
  if (!silent) {
    var box = document.getElementById('scrResults');
    if (box) {
      var top = box.getBoundingClientRect().top + window.pageYOffset - 70;
      window.scrollTo({ top: top, behavior: 'smooth' });
    }
  }
}

/** 运行自定义选股 */
function screenerRunCustom(silent) {
  if (!_scr.stocks.length) {
    showToast('全市场数据尚未就绪，请先扫描');
    return;
  }
  var conds = [];
  for (var i = 0; i < _scr.custom.length; i++) {
    var cd = _scr.custom[i];
    var v1 = parseFloat(cd.v1);
    if (isNaN(v1)) continue;
    var v2 = cd.op === '区间' ? parseFloat(cd.v2) : null;
    if (cd.op === '区间' && isNaN(v2)) continue;
    conds.push({ field: cd.field, op: cd.op, v1: v1, v2: v2 });
  }
  if (!conds.length) {
    showToast('请至少填写一个有效条件');
    return;
  }
  _scr.active = 'custom';
  _scr.sortKey = 'chg';
  _scr.sortDir = -1;
  _scr.resultList = _scrFilter(_scr.stocks, function(s) {
    if (!_scrNormal(s)) return false; // 与内置策略一致：剔除ST/退市
    for (var k = 0; k < conds.length; k++) {
      var cd = conds[k];
      var v = s[cd.field];
      if (v === null || v === undefined) return false;
      if (cd.op === '≥' && !(v >= cd.v1)) return false;
      if (cd.op === '≤' && !(v <= cd.v1)) return false;
      if (cd.op === '区间' && !(v >= cd.v1 && v <= cd.v2)) return false;
    }
    return true;
  });
  _scr.resultTitle = '🧩 自定义条件';
  _scrRenderCustom();
  _scrRenderResults();
  if (!silent) {
    var box = document.getElementById('scrResults');
    if (box) {
      var top = box.getBoundingClientRect().top + window.pageYOffset - 70;
      window.scrollTo({ top: top, behavior: 'smooth' });
    }
  }
}

/** 收起结果 */
function screenerClearResults() {
  _scr.active = null;
  _scr.resultList = null;
  _scrRenderCards();
  _scrRenderResults();
}

/** 表头排序 */
function scrSort(key) {
  if (_scr.sortKey === key) {
    _scr.sortDir = _scr.sortDir === -1 ? 1 : -1;
  } else {
    _scr.sortKey = key;
    _scr.sortDir = -1;
  }
  _scrRenderResults();
}

/** 跳转个股分析（自动黑洞过渡到策略信号Tab） */
function screenerViewStock(code) {
  if (typeof searchStockByCode === 'function') {
    searchStockByCode(code);
  }
}

/** 加入组合 */
function screenerAddStock(code, name) {
  if (typeof showPortfolioSelectDialog === 'function') {
    showPortfolioSelectDialog(code, name);
  }
}

/* ---- 自定义条件编辑 ---- */

function scrCondChange(idx, prop, val) {
  if (!_scr.custom[idx]) return;
  if (prop === 'v1' || prop === 'v2') {
    _scr.custom[idx][prop] = val === '' ? '' : parseFloat(val);
  } else {
    _scr.custom[idx][prop] = val;
  }
  _scrSaveCustom();
  if (prop === 'op') _scrRenderCustom(); // 切换区间时显示/隐藏第二输入框
}

function scrCondAdd() {
  _scr.custom.push({ field: 'chg', op: '≥', v1: 2, v2: '' });
  _scrSaveCustom();
  _scrRenderCustom();
}

function scrCondRemove(idx) {
  if (_scr.custom.length <= 1) return;
  _scr.custom.splice(idx, 1);
  _scrSaveCustom();
  _scrRenderCustom();
}

function _scrSaveCustom() {
  try { localStorage.setItem(SCR_CUSTOM_KEY, JSON.stringify(_scr.custom)); } catch (e) {}
}

(function _scrLoadCustom() {
  try {
    var raw = JSON.parse(localStorage.getItem(SCR_CUSTOM_KEY) || 'null');
    if (raw && raw.length) {
      _scr.custom = raw;
      return;
    }
  } catch (e) {}
  _scr.custom = [{ field: 'volRatio', op: '≥', v1: 2, v2: '' }];
})();
