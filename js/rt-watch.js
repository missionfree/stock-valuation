'use strict';

/* ============================================================
   实时盯盘 · AI 量化终端 (RT-Watch Terminal) v2
   ------------------------------------------------------------
   主展示指数：上证指数（权重指数），辅助：沪深300/深成/创业板

   ① 实时看盘：4大指数自适应轮询（盘中20s/午休60s/休市300s），
      价格跳动红绿闪烁动画，时钟实时走秒，LIVE徽标随会话变化
   ② 分时图：Canvas 价格线 + 均价线 + 昨收基线 + 分段红绿填充，
      高分屏适配，悬停十字线（RAF节流）
   ③ AI 智能解读：规则化NLG每tick重组，多空判定/量能/广度/风险
   ④ 量化五因子：动量(上证主导40%) / 趋势 / 量能 / 广度 / 稳定
   ⑤ 量化信号流：急拉急跌(分指数阈值) / 新高新低 / 均价线穿越 /
      量能异动(A股时间分布经验曲线) / 风格切换 / 超买超卖
   ⑥ 会话感知：休市降频，标签页隐藏暂停，折叠区感知按需启动

   v2 修复：
   - Canvas 高度改读 clientHeight（修复移动端画布压缩变形）
   - Canvas 尺寸缓存，仅变化时重设（修复hover每帧全量重分配）
   - 均价线增量维护 O(n)（原 O(n²) 前缀和重算）
   - 开盘前不播种昨收价进今日分时序列（修复假开盘点）
   - 量能预期按A股成交时间分布曲线（开盘半小时占25%，线性外推会虚高误报）
   - 信号检测仅交易时段执行（修复休市每10分钟重复推送量能信号）
   - 新高新低容差 0.01 点；创业板急拉阈值差异化 0.18%
   - 信号流仅变化时重绘；闪动清理竞态修复；暂停态显示完整
   ============================================================ */

var RTWatch = (function() {

  /* ---------- 常量 ---------- */
  var CODES = ['sh000001', 'sh000300', 'sz399001', 'sz399006'];
  var META = {
    'sh000001': { name: '上证指数', short: 'SH' },
    'sh000300': { name: '沪深300', short: 'HS300' },
    'sz399001': { name: '深证成指', short: 'SZ' },
    'sz399006': { name: '创业板指', short: 'CYB' }
  };
  /* 动量权重：上证为权重指数占 40%，其余各 20% */
  var CHG_WEIGHT = { 'sh000001': 0.40, 'sh000300': 0.20, 'sz399001': 0.20, 'sz399006': 0.20 };
  /* 急拉急跌单tick阈值：创业板波动天然更大，单独放宽 */
  var JUMP_TH = { 'sh000001': 0.12, 'sh000300': 0.12, 'sz399001': 0.12, 'sz399006': 0.18 };
  var MAIN_CODE = 'sh000001';
  var POLL_TRADING = 20000;   // 盘中20秒
  var POLL_LUNCH   = 60000;   // 午休60秒
  var POLL_CLOSED  = 300000;  // 休市5分钟
  var MAX_TICKS = 300;        // 分时序列上限
  var MAX_SIGNALS = 30;       // 信号流上限
  var DEDUP_MS = 10 * 60 * 1000; // 同类信号去重窗口
  var LS_PAUSE = 'rt_pause_v1';

  /* A股成交量时间分布经验曲线（累计占比）
     开盘半小时成交通常占全天25%+，线性外推会严重低估开盘期预期量 */
  var VOL_CURVE = [
    { m: 0, s: 0 }, { m: 10, s: 0.10 }, { m: 30, s: 0.25 },
    { m: 60, s: 0.38 }, { m: 120, s: 0.58 },
    { m: 180, s: 0.80 }, { m: 240, s: 1.0 }
  ];
  function volShare(min) {
    if (min <= 0) return 0;
    if (min >= 240) return 1;
    for (var i = 1; i < VOL_CURVE.length; i++) {
      if (min <= VOL_CURVE[i].m) {
        var a = VOL_CURVE[i - 1], b = VOL_CURVE[i];
        var t = (min - a.m) / (b.m - a.m);
        return a.s + (b.s - a.s) * t;
      }
    }
    return 1;
  }

  /* ---------- 状态 ---------- */
  var _st = {
    running: true,
    timer: null,
    tickCount: 0,
    quotes: {},
    prevQuotes: {},
    series: {},               // code → [{m, p}]（分钟底稿 + 实时尾点）
    seriesDate: '',           // 分时底稿所属交易日 YYYYMMDD
    _minuteFetchedAt: 0,      // 分时接口最近拉取时间（节流）
    pollCount: 0,             // 轮询计数（驱动底稿周期刷新）
    seriesAvg: [],            // 主力累计均价序列（增量维护）
    _avgSum: 0,               // 均价累计和
    _avgDirty: true,          // 序列重建后需重算
    high: {}, low: {},
    klineBase: null,          // 昨日量能基准
    signals: [],
    _sigRendered: -1,         // 信号流渲染指纹（避免每tick重建DOM）
    lastSignalAt: {},
    factors: null,
    verdict: null,
    lastPollAt: 0,
    failCount: 0,
    hoverM: -1,
    chartGeom: null,
    _canvasW: 0, _canvasH: 0, // canvas 尺寸缓存
    observer: null,
    initialized: false
  };

  /* ---------- 工具 ---------- */
  function _id(x) { return document.getElementById(x); }
  function _now() { return new Date(); }
  function _pad(n) { return ('0' + n).slice(-2); }
  function _hhmmss(d) { return _pad(d.getHours()) + ':' + _pad(d.getMinutes()) + ':' + _pad(d.getSeconds()); }
  function _f(n, d) { return (n === null || n === undefined || isNaN(n)) ? '—' : Number(n).toFixed(d === undefined ? 2 : d); }
  function _sign(n, d) { return (n >= 0 ? '+' : '') + _f(n, d); }

  /* ---------- 交易时段 ---------- */
  function session() {
    var d = _now();
    var day = d.getDay();
    var mins = d.getHours() * 60 + d.getMinutes();
    if (day === 0 || day === 6) return { session: 'closed', label: '周末休市', elapsedMin: 0 };
    if (mins >= 570 && mins < 690) return { session: 'trading', label: '早盘交易中', elapsedMin: mins - 570 };
    if (mins >= 690 && mins < 780) return { session: 'lunch', label: '午间休市', elapsedMin: 120 };
    if (mins >= 780 && mins < 900) return { session: 'trading', label: '午盘交易中', elapsedMin: 120 + (mins - 780) };
    if (mins >= 900) return { session: 'closed', label: '已收盘', elapsedMin: 240 };
    return { session: 'closed', label: '待开盘', elapsedMin: 0 };
  }

  function tradeMinute(d) {
    var mins = d.getHours() * 60 + d.getMinutes();
    if (mins < 570) return 0;
    if (mins < 690) return mins - 570;
    if (mins < 780) return 120;
    if (mins < 900) return 120 + (mins - 780);
    return 240;
  }

  /* ---------- 分时底稿（腾讯分钟级接口，真实全天数据） ----------
     响应: data.{code}.data = { date:'YYYYMMDD', data:["0930 3911.89 累计量 累计额", ...] }
     每分钟一条：HHMM 价格 累计成交量(手) 累计成交额(元)
     修复：原先从打开页面起自攒报价点，盘中打开只有「开盘价→现价」两点连线，
     盘后打开更是一条直线；改为直接拉取交易所分钟级真实分时 */
  var MINUTE_HOSTS = ['https://web.ifzq.gtimg.cn', 'https://ifzq.gtimg.cn'];
  var MINUTE_REFRESH_POLLS = 15;   // 盘中每15次轮询(约5分钟)刷新一次分时底稿
  var MINUTE_FETCH_GAP = 60000;    // 分时接口最小间隔（防手点刷新刷爆）

  function fetchMinuteRaw(code, hostIdx) {
    hostIdx = hostIdx || 0;
    var url = MINUTE_HOSTS[hostIdx] + '/appstock/app/minute/query?code=' + code + '&r=' + Date.now();
    var p = (typeof fetchWithTimeout === 'function')
      ? fetchWithTimeout(url, { cache: 'no-store' }, 8000)
      : fetch(url, { cache: 'no-store' });
    return p.then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function(j) {
      var node = j && j.data && j.data[code] && j.data[code].data;
      var rows = node && node.data;
      if (!rows || !rows.length) throw new Error('无分时数据');
      return { date: node.date || '', rows: rows };
    }).catch(function(err) {
      if (hostIdx + 1 < MINUTE_HOSTS.length) return fetchMinuteRaw(code, hostIdx + 1);
      throw err;
    });
  }

  /** "0930 3911.89 ..." → {m:交易分钟(0-240), p:价格}；同分钟去重保留最后 */
  function parseMinuteRows(rows) {
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var f = String(rows[i]).split(' ');
      if (f.length < 2) continue;
      var p = parseFloat(f[1]);
      if (isNaN(p) || p <= 0) continue;
      var t = f[0];
      if (!t || t.length < 4) continue;
      var h = parseInt(t.slice(0, 2), 10), mi = parseInt(t.slice(2, 4), 10);
      if (isNaN(h) || isNaN(mi)) continue;
      var mins = h * 60 + mi;
      var m;
      if (mins < 690) m = Math.max(0, mins - 570);       // 早盘 9:30-11:29 → 0-119
      else if (mins < 780) m = 120;                       // 11:30 收位
      else m = Math.min(240, 120 + (mins - 780));         // 午盘 13:00-15:00 → 120-240
      var last = out[out.length - 1];
      if (last && last.m === m) last.p = p;
      else out.push({ m: m, p: p });
    }
    return out;
  }

  /** 拉取全部指数的分钟底稿并重建分时序列（串行轻量，失败保留实时累积兜底） */
  function loadMinuteData(force) {
    if (!force && Date.now() - (_st._minuteFetchedAt || 0) < MINUTE_FETCH_GAP) return;
    _st._minuteFetchedAt = Date.now();
    var idx = 0;
    function next() {
      if (idx >= CODES.length) {
        /* 全部完成：重建均价线、重算因子并重绘 */
        _st._avgDirty = true;
        if (_st.quotes[MAIN_CODE]) { computeFactors(); buildVerdict(); }
        renderIndexCards();
        renderChart();
        renderFactors();
        renderVerdict();
        return;
      }
      var c = CODES[idx++];
      fetchMinuteRaw(c).then(function(res) {
        var pts = parseMinuteRows(res.rows);
        if (pts.length >= 2) {
          _st.series[c] = pts;
          if (c === MAIN_CODE) {
            _st._avgDirty = true;
            _st.seriesDate = res.date;   // 数据所属交易日（盘后/周末为最近交易日）
          }
        }
      }).catch(function() {
        /* 失败：保留现有序列（实时轮询仍在累积） */
      }).then(next);
    }
    next();
  }

  /** '20260827' → '08-27' */
  function fmtSeriesDate(s) {
    if (!s || s.length !== 8) return '';
    return s.slice(4, 6) + '-' + s.slice(6, 8);
  }

  /* ---------- 数据获取 ---------- */
  function poll(manual) {
    if (typeof fetchTencentBatch !== 'function') return;
    _st.lastPollAt = Date.now();
    _st.pollCount = (_st.pollCount || 0) + 1;
    /* 手动刷新或盘中每15次轮询(约5分钟) → 刷新分时底稿 */
    if (manual || (_st.pollCount % MINUTE_REFRESH_POLLS === 0 && session().session !== 'closed')) {
      loadMinuteData(false);
    }
    fetchTencentBatch(CODES).then(function(data) {
      _st.failCount = 0;
      onTick(data, manual);
    }).catch(function() {
      _st.failCount++;
      var st = _id('rtStatus');
      if (st && _st.failCount >= 2) {
        st.textContent = '⚠️ 行情连接不稳定（已重试' + _st.failCount + '次），展示最近数据';
      }
    });
  }

  /* ---------- Tick 处理核心 ---------- */
  function onTick(data, manual) {
    _st.prevQuotes = {};
    var hasNew = false;
    CODES.forEach(function(c) {
      if (data[c]) {
        _st.prevQuotes[c] = _st.quotes[c] || null;
        _st.quotes[c] = data[c];
        hasNew = true;
      }
    });
    if (!hasNew) return;
    _st.tickCount++;

    var d = _now();
    var m = tradeMinute(d);
    var s = session();

    /* 分时序列：待开盘时段不追加（避免昨收价污染今日开盘点） */
    CODES.forEach(function(c) {
      var q = _st.quotes[c];
      if (!q || !q.price || q.price <= 0) return;
      if (s.session === 'closed' && s.elapsedMin === 0) return; // 开盘前
      var arr = _st.series[c] || (_st.series[c] = []);
      /* 首个点：以今日开盘价在0轴播种（开盘价有效时） */
      if (arr.length === 0 && q.open > 0 && s.elapsedMin > 0) {
        arr.push({ m: 0, p: q.open });
      }
      var last = arr[arr.length - 1];
      if (last && last.m === m) {
        /* 同一分钟：只更新尾点为最新价（标准分时的一分钟一点） */
        if (Math.abs(last.p - q.price) > 0.0001) {
          last.p = q.price;
          if (c === MAIN_CODE) _st._avgDirty = true;
        }
      } else if (!last || last.m < m) {
        /* 新的分钟：追加新点 */
        arr.push({ m: m, p: q.price });
        if (arr.length > MAX_TICKS) {
          arr.splice(0, arr.length - MAX_TICKS);
        }
        if (c === MAIN_CODE) _st._avgDirty = true;
      }
      /* 日内极值追踪 */
      var hi = Math.max(q.high || q.price, _st.high[c] || -Infinity);
      var lo = Math.min(q.low || q.price, _st.low[c] || Infinity);
      _st.high[c] = hi; _st.low[c] = lo;
    });

    computeFactors(s);
    if (s.session === 'trading') detectSignals(m); // 信号仅交易时段检测
    buildVerdict(s);
    renderAll();
  }

  /* ---------- 均价线（增量维护 O(n)） ---------- */
  function rebuildAvg() {
    var ms = _st.series[MAIN_CODE] || [];
    if (ms.length === 0) { _st.seriesAvg = []; _st._avgSum = 0; return; }
    _st.seriesAvg = [];
    var sum = 0;
    for (var i = 0; i < ms.length; i++) {
      sum += ms[i].p;
      _st.seriesAvg.push({ m: ms[i].m, p: sum / (i + 1) });
    }
    _st._avgSum = sum;
    _st._avgDirty = false;
  }

  /* ---------- 量化因子引擎 ---------- */
  function computeFactors(s) {
    s = s || session();
    var q = _st.quotes, chg = {}, wSum = 0, chgW = 0;
    CODES.forEach(function(c) {
      if (!q[c] || !q[c].price || !q[c].yesterdayClose) return;
      chg[c] = (q[c].price - q[c].yesterdayClose) / q[c].yesterdayClose * 100;
      chgW += chg[c] * CHG_WEIGHT[c];
      wSum += CHG_WEIGHT[c];
    });
    var avgChg = wSum > 0 ? chgW / wSum : 0;

    /* 动量：加权涨幅 → [0,100] */
    var momentum = Math.max(0, Math.min(100, 50 + avgChg * 25));

    /* 量能：按A股时间分布曲线校准的预期量 */
    var volRatio = 0, volPct = 0;
    var mq = q[MAIN_CODE];
    if (mq && mq.volume > 0 && _st.klineBase && _st.klineBase.vol > 0 && s.elapsedMin > 3) {
      var share = volShare(s.elapsedMin);
      var expect = _st.klineBase.vol * share;
      volRatio = expect > 0 ? mq.volume / expect : 0;
      volPct = (volRatio - 1) * 100;
    }
    var volume = Math.max(0, Math.min(100, volRatio * 50));

    /* 波动：主指数日内振幅 */
    var amp = 0;
    if (mq && mq.yesterdayClose > 0) {
      var h = Math.max(mq.high || 0, _st.high[MAIN_CODE] || 0);
      var l = Math.min(mq.low || Infinity, _st.low[MAIN_CODE] || Infinity);
      if (isFinite(h) && isFinite(l) && l > 0) amp = (h - l) / mq.yesterdayClose * 100;
    }
    var volatility = Math.max(0, Math.min(100, amp * 20));

    /* 广度：优先全市场涨跌家数，回退指数方向 */
    var breadth = 50, breadthSrc = '指数方向近似', upCnt = 0, dnCnt = 0;
    var sent = (typeof _lastSentimentData !== 'undefined') ? _lastSentimentData : null;
    if (sent && (sent.up + sent.down) > 0) {
      upCnt = sent.up; dnCnt = sent.down;
      breadth = sent.up / (sent.up + sent.down) * 100;
      breadthSrc = '全市场涨跌家数';
    } else {
      CODES.forEach(function(c) {
        if (chg[c] === undefined) return;
        if (chg[c] > 0) upCnt++; else if (chg[c] < 0) dnCnt++;
      });
      var dn = upCnt + dnCnt;
      breadth = dn > 0 ? upCnt / dn * 100 : 50;
    }

    /* 趋势：分时斜率 + 价格vs均价线 */
    var trend = 50, aboveAvg = null, slope = 0;
    var ms = _st.series[MAIN_CODE] || [];
    if (ms.length >= 3 && mq) {
      var win = ms.slice(Math.max(0, ms.length - 12));
      slope = win.length >= 2 ? (win[win.length - 1].p - win[0].p) / win[0].p * 100 : 0;
      if (_st._avgDirty) rebuildAvg();
      var avgNow = _st.seriesAvg.length > 0 ? _st.seriesAvg[_st.seriesAvg.length - 1].p : null;
      aboveAvg = avgNow !== null ? (mq.price - avgNow) / avgNow * 100 : null;
      trend = 50 + slope * 40 + (aboveAvg !== null ? Math.max(-10, Math.min(10, aboveAvg * 8)) : 0);
      trend = Math.max(0, Math.min(100, trend));
    }

    var composite = momentum * 0.30 + trend * 0.25 + volume * 0.15 + breadth * 0.20 + (100 - volatility) * 0.10;

    _st.factors = {
      momentum: momentum, volume: volume, volatility: volatility,
      breadth: breadth, trend: trend, composite: composite,
      avgChg: avgChg, chg: chg, volRatio: volRatio, volPct: volPct,
      amp: amp, aboveAvg: aboveAvg, slope: slope,
      upCnt: upCnt, dnCnt: dnCnt, breadthSrc: breadthSrc,
      sessionLabel: s.label
    };
  }

  /* ---------- 信号检测引擎 ---------- */
  var SIG_META = {
    surge:    { icon: '⚡', label: '急拉' },
    plunge:   { icon: '⚡', label: '急跌' },
    newHigh:  { icon: '📈', label: '日内新高' },
    newLow:   { icon: '📉', label: '日内新低' },
    avgUp:    { icon: '↗', label: '站上均价线' },
    avgDown:  { icon: '↘', label: '跌破均价线' },
    volSpike: { icon: '🔥', label: '量能放大' },
    volDry:   { icon: '❄️', label: '量能萎缩' },
    style:    { icon: '🔄', label: '风格切换' },
    ob:       { icon: '⚠️', label: '短线超买' },
    os:       { icon: '⚠️', label: '短线超卖' }
  };

  function pushSignal(type, code, dir, text, strength) {
    var key = type + '|' + code;
    var now = Date.now();
    if (_st.lastSignalAt[key] && now - _st.lastSignalAt[key] < DEDUP_MS) return;
    _st.lastSignalAt[key] = now;
    _st.signals.unshift({
      t: now, time: _hhmmss(_now()), type: type, code: code,
      dir: dir, text: text, strength: strength || 1
    });
    if (_st.signals.length > MAX_SIGNALS) _st.signals.length = MAX_SIGNALS;
  }

  function detectSignals(m) {
    var q = _st.quotes, f = _st.factors;
    if (!f) return;
    var s = session();

    /* 1. 急拉/急跌：单tick跳变（分指数阈值） */
    CODES.forEach(function(c) {
      var cur = q[c], prev = _st.prevQuotes[c];
      if (!cur || !prev || !prev.price || !cur.price) return;
      var jump = (cur.price - prev.price) / prev.price * 100;
      var th = JUMP_TH[c] || 0.12;
      if (jump > th) {
        pushSignal('surge', c, 'bull',
          META[c].name + ' 快速上行 ' + _sign(jump, 2) + '% → ' + _f(cur.price), jump > th * 2.5 ? 3 : 2);
      } else if (jump < -th) {
        pushSignal('plunge', c, 'bear',
          META[c].name + ' 快速回落 ' + _sign(jump, 2) + '% → ' + _f(cur.price), jump < -th * 2.5 ? 3 : 2);
      }
    });

    /* 2. 日内新高/新低：当前价触及日内极值（容差0.01点） */
    var mq = q[MAIN_CODE];
    if (mq && mq.price > 0) {
      var hi = _st.high[MAIN_CODE] || mq.price;
      var lo = _st.low[MAIN_CODE] || mq.price;
      if (mq.price >= hi - 0.01 && (mq.changePercent || 0) > 0.2) {
        pushSignal('newHigh', MAIN_CODE, 'bull', META[MAIN_CODE].name + ' 触及日内新高 ' + _f(hi), 2);
      }
      if (mq.price <= lo + 0.01 && (mq.changePercent || 0) < -0.2) {
        pushSignal('newLow', MAIN_CODE, 'bear', META[MAIN_CODE].name + ' 触及日内新低 ' + _f(lo), 2);
      }
    }

    /* 3. 均价线穿越 */
    var ms = _st.series[MAIN_CODE] || [];
    if (_st._avgDirty) rebuildAvg();
    if (ms.length >= 5 && _st.seriesAvg.length >= 5 && mq) {
      var n = ms.length;
      var pNow = ms[n - 1].p, aNow = _st.seriesAvg[n - 1].p;
      var pPrev = ms[n - 2].p, aPrev = _st.seriesAvg[n - 2].p;
      if (pPrev <= aPrev && pNow > aNow) {
        pushSignal('avgUp', MAIN_CODE, 'bull', META[MAIN_CODE].name + ' 上穿分时均价线（' + _f(aNow) + '），短线转强', 2);
      } else if (pPrev >= aPrev && pNow < aNow) {
        pushSignal('avgDown', MAIN_CODE, 'bear', META[MAIN_CODE].name + ' 跌破分时均价线（' + _f(aNow) + '），短线转弱', 2);
      }
    }

    /* 4. 量能异动（开盘15分钟后，预期量已按时间分布校准） */
    if (f.volRatio >= 1.35 && s.elapsedMin > 15) {
      pushSignal('volSpike', MAIN_CODE, f.avgChg >= 0 ? 'bull' : 'bear',
        '量能显著放大：今日进度量能为昨日同期 ' + _f(f.volRatio, 2) + ' 倍', 3);
    } else if (f.volRatio > 0 && f.volRatio <= 0.6 && s.elapsedMin > 30) {
      pushSignal('volDry', MAIN_CODE, 'neutral',
        '量能明显萎缩：今日进度量能仅为昨日同期 ' + _f(f.volRatio, 2) + ' 倍，观望情绪浓', 2);
    }

    /* 5. 风格切换：最强与最弱指数差 > 1.2% */
    var best = null, worst = null;
    CODES.forEach(function(c) {
      if (f.chg[c] === undefined) return;
      if (!best || f.chg[c] > f.chg[best]) best = c;
      if (!worst || f.chg[c] < f.chg[worst]) worst = c;
    });
    if (best && worst && best !== worst) {
      var spread = f.chg[best] - f.chg[worst];
      if (spread > 1.2) {
        pushSignal('style', worst, 'bear',
          '风格分化：' + META[best].name + _sign(f.chg[best], 2) + '% vs ' + META[worst].name + _sign(f.chg[worst], 2) +
          '%（差' + _f(spread, 1) + '%），资金切换迹象', 2);
      }
    }

    /* 6. 超买/超卖：分时快速RSI */
    if (ms.length >= 15 && mq) {
      var rsi = quickRSI(ms, 14);
      if (rsi !== null) {
        if (rsi > 78) pushSignal('ob', MAIN_CODE, 'bear', META[MAIN_CODE].name + ' 分时RSI=' + _f(rsi, 0) + '，短线超买，谨冲高回落', 2);
        else if (rsi < 22) pushSignal('os', MAIN_CODE, 'bull', META[MAIN_CODE].name + ' 分时RSI=' + _f(rsi, 0) + '，短线超卖，或有技术反抽', 2);
      }
    }
  }

  /** 简易RSI（直接吃序列，避免每次建新数组） */
  function quickRSI(arr, period) {
    var n = arr.length;
    if (n < period + 1) return null;
    var start = n - period - 1;
    var g = 0, l = 0;
    for (var i = start + 1; i < n; i++) {
      var d = arr[i].p - arr[i - 1].p;
      if (d >= 0) g += d; else l -= d;
    }
    if (l === 0) return g === 0 ? 50 : 100;
    return 100 - 100 / (1 + g / l);
  }

  /* ---------- AI 智能解读（规则化NLG） ---------- */
  function buildVerdict(s) {
    s = s || session();
    var f = _st.factors;
    if (!f) return;
    var mq = _st.quotes[MAIN_CODE];
    if (!mq) return;

    var score = Math.round(f.composite);
    var posLabel, posCls;
    if (score >= 70) { posLabel = '强势'; posCls = 'bull'; }
    else if (score >= 57) { posLabel = '偏多'; posCls = 'bull'; }
    else if (score > 43) { posLabel = '中性震荡'; posCls = 'flat'; }
    else if (score > 30) { posLabel = '偏空'; posCls = 'bear'; }
    else { posLabel = '弱势'; posCls = 'bear'; }

    var p1 = META[MAIN_CODE].name + '现报 ' + _f(mq.price) + '（' + _sign(mq.changePercent, 2) + '%）';
    if (f.aboveAvg !== null) {
      p1 += f.aboveAvg >= 0
        ? '，运行于分时均价线上方 ' + _f(Math.abs(f.aboveAvg), 2) + '%，短线多方掌控'
        : '，运行于分时均价线下方 ' + _f(Math.abs(f.aboveAvg), 2) + '%，短线空方承压';
    } else {
      p1 += '，正在积累分时数据';
    }
    if (Math.abs(f.slope) > 0.08) {
      p1 += f.slope > 0 ? '，近段走势向上（斜率' + _sign(f.slope, 2) + '%）' : '，近段走势向下（斜率' + _sign(f.slope, 2) + '%）';
    }

    var p2;
    if (f.volRatio >= 1.3) {
      p2 = '量能显著放大（今日进度为昨日同期的 ' + _f(f.volRatio, 2) + ' 倍）';
      p2 += f.avgChg >= 0 ? '，放量上攻，资金进攻意愿强' : '，放量调整，注意承接力度';
    } else if (f.volRatio >= 1.05) {
      p2 = '量能温和放大（较昨日同期 +' + _f(f.volPct, 0) + '%）';
    } else if (f.volRatio > 0.65) {
      p2 = '量能基本持平（较昨日同期 ' + _sign(f.volPct, 0) + '%）';
    } else if (f.volRatio > 0) {
      p2 = '量能萎缩（仅为昨日同期 ' + _f(f.volRatio, 2) + ' 倍），观望情绪偏浓';
    } else {
      p2 = '量能基准建立中';
    }

    var p3;
    if (f.breadthSrc === '全市场涨跌家数') {
      p3 = '市场广度：上涨 ' + f.upCnt + ' 家 / 下跌 ' + f.dnCnt + ' 家';
      p3 += f.breadth >= 60 ? '，普涨格局' : (f.breadth <= 40 ? '，跌多涨少' : '，涨跌互现');
    } else {
      p3 = '市场广度（指数方向近似）：' + f.upCnt + ' 涨 / ' + f.dnCnt + ' 跌';
    }

    var risks = [];
    if (f.amp > 1.5) risks.push('日内振幅已达 ' + _f(f.amp, 2) + '%，波动加大，注意节奏');
    CODES.forEach(function(c) {
      if (f.chg[c] !== undefined && Math.abs(f.chg[c]) > 1.2) {
        risks.push(META[c].name + _sign(f.chg[c], 2) + '% 波动剧烈');
      }
    });
    if (bestWorstSpread() > 1.2) risks.push('指数分化明显，提防风格切换');

    var action;
    if (score >= 70) action = '策略倾向：顺势持有为主，不追高';
    else if (score >= 57) action = '策略倾向：偏多对待，回调可关注';
    else if (score > 43) action = '策略倾向：区间思路，高抛低吸';
    else if (score > 30) action = '策略倾向：偏空对待，反弹减仓';
    else action = '策略倾向：防御为主，控制仓位';

    _st.verdict = {
      score: score, posLabel: posLabel, posCls: posCls,
      p1: p1, p2: p2, p3: p3, risks: risks, action: action,
      time: _hhmmss(_now()), sessionLabel: s.label
    };
  }

  function bestWorstSpread() {
    var f = _st.factors;
    if (!f) return 0;
    var mx = -Infinity, mn = Infinity;
    CODES.forEach(function(c) {
      if (f.chg[c] === undefined) return;
      if (f.chg[c] > mx) mx = f.chg[c];
      if (f.chg[c] < mn) mn = f.chg[c];
    });
    return (mx > -Infinity && mn < Infinity) ? mx - mn : 0;
  }

  /* ---------- 渲染 ---------- */
  function renderAll() {
    renderStatusBar();
    renderIndexCards();
    renderChart();
    renderFactors();
    renderVerdict();
    renderSignals();
  }

  function renderStatusBar() {
    var s = session();
    var dot = _id('rtLiveDot');
    var st = _id('rtStatus');
    var clock = _id('rtClock');
    var next = _id('rtNext');
    var badge = _id('rtHeadMini');
    if (clock) clock.textContent = _hhmmss(_now());
    if (dot) {
      dot.className = 'rt-live-dot ' + (s.session === 'trading' ? 'live' : (s.session === 'lunch' ? 'lunch' : 'off'));
    }
    if (badge) {
      badge.textContent = s.session === 'trading' ? 'LIVE' : (s.session === 'lunch' ? '午休' : 'CLOSE');
    }
    if (st && _st.failCount < 2) {
      st.textContent = !_st.running ? '⏸ 已暂停 · ' + s.label : '● ' + s.label + ' · 数据源正常';
    }
    if (next) {
      if (!_st.running) {
        next.textContent = '已暂停';
      } else if (s.session === 'closed') {
        next.textContent = '休市慢轮询';
      } else {
        var interval = s.session === 'trading' ? POLL_TRADING : POLL_LUNCH;
        var remain = Math.max(0, Math.ceil((_st.lastPollAt + interval - Date.now()) / 1000));
        next.textContent = remain > 0 ? remain + 's 后刷新' : '刷新中…';
      }
    }
  }

  /* 指数卡片（红绿闪动，闪动清理带价格校验防竞态） */
  var _lastRendered = {};
  function renderIndexCards() {
    CODES.forEach(function(c) {
      var q = _st.quotes[c];
      var el = _id('rtIdx-' + c);
      if (!el || !q) return;
      var prev = _lastRendered[c];
      var flash = '';
      if (prev !== undefined && q.price !== prev) {
        flash = q.price > prev ? ' flash-up' : ' flash-down';
      }
      _lastRendered[c] = q.price;
      var up = (q.changePercent || 0) >= 0;
      el.className = 'rt-idx-card ' + (up ? 'up' : 'down') + flash + (c === MAIN_CODE ? ' main' : '');
      if (flash) {
        var snap = q.price;
        Perf.trackedSetTimeout(function() {
          /* 价格未再变化才清理，避免打断新一轮闪动动画 */
          if (_lastRendered[c] === snap) {
            el.className = el.className.replace(/ flash-\w+/, '');
          }
        }, 700);
      }
      var mini = drawMiniSpark(c, up);
      el.innerHTML =
        '<div class="rt-idx-head"><span class="rt-idx-name">' + (c === MAIN_CODE ? '★ ' : '') + META[c].name + '</span>' +
        '<span class="rt-idx-code">' + META[c].short + '</span></div>' +
        '<div class="rt-idx-price">' + _f(q.price) + '</div>' +
        '<div class="rt-idx-chg">' + _sign(q.changePercent, 2) + '% ' + _sign(q.changeAmount, 2) + '</div>' +
        '<div class="rt-idx-spark">' + mini + '</div>';
    });
  }

  /** 迷你走势SVG */
  function drawMiniSpark(code, up) {
    var arr = _st.series[code];
    if (!arr || arr.length < 2) return '<span class="rt-spark-empty">—</span>';
    var w = 72, h = 22;
    var pts = arr.slice(-60);
    var mn = Infinity, mx = -Infinity;
    pts.forEach(function(pt) { if (pt.p < mn) mn = pt.p; if (pt.p > mx) mx = pt.p; });
    if (mx <= mn) mx = mn + 1;
    var d = pts.map(function(pt, i) {
      var x = i / (pts.length - 1) * w;
      var y = h - (pt.p - mn) / (mx - mn) * (h - 2) - 1;
      return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
    }).join(' ');
    var col = up ? 'var(--neon-red)' : 'var(--neon-green)';
    var fill = up ? 'rgba(240,86,92,0.12)' : 'rgba(34,181,115,0.12)';
    var area = d + ' L' + w + ' ' + h + ' L0 ' + h + ' Z';
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" aria-hidden="true">' +
      '<path d="' + area + '" fill="' + fill + '"/>' +
      '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="1.2"/>' +
      '</svg>';
  }

  /* 分时主图 */
  function renderChart() {
    var canvas = _id('rtChartCanvas');
    if (!canvas) return;

    /* 尺寸缓存：仅在变化时重设（避免每帧清空+重分配位图） */
    var cssW = canvas.clientWidth || 600;
    var cssH = canvas.clientHeight || 260;
    var dpr = window.devicePixelRatio || 1;
    if (cssW !== _st._canvasW || cssH !== _st._canvasH) {
      _st._canvasW = cssW; _st._canvasH = cssH;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    var mq = _st.quotes[MAIN_CODE];
    var ms = _st.series[MAIN_CODE] || [];
    if (_st._avgDirty) rebuildAvg();
    var base = mq && mq.yesterdayClose > 0 ? mq.yesterdayClose : null;

    var padL = 8, padR = 52, padT = 8, padB = 18;
    var chartW = cssW - padL - padR;
    var priceH = cssH - padT - padB;

    if (ms.length < 1 || !mq) {
      ctx.fillStyle = 'rgba(140,152,170,0.85)';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('等待实时行情…（首次拉取约1秒）', cssW / 2, cssH / 2);
      _st.chartGeom = null;
      return;
    }

    /* 价格范围：昨收对称 */
    var mx = base || mq.price, mn = base || mq.price;
    ms.forEach(function(pt) { if (pt.p > mx) mx = pt.p; if (pt.p < mn) mn = pt.p; });
    _st.seriesAvg.forEach(function(pt) { if (pt.p > mx) mx = pt.p; if (pt.p < mn) mn = pt.p; });
    var mid = base !== null ? base : (mx + mn) / 2;
    var half = Math.max((mx - mid), (mid - mn)) * 1.15 || Math.abs(mq.price) * 0.004 || 1;
    var pMax = mid + half, pMin = mid - half;

    function xOf(m) { return padL + m / 240 * chartW; }
    function yOfP(p) { return padT + priceH - (p - pMin) / (pMax - pMin) * priceH; }

    /* 网格 + 右侧刻度 */
    ctx.strokeStyle = 'rgba(150,165,190,0.10)';
    ctx.lineWidth = 1;
    ctx.font = '9px monospace';
    ctx.fillStyle = 'rgba(140,152,170,0.9)';
    for (var g = 0; g <= 4; g++) {
      var gy = padT + priceH * g / 4;
      ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(padL + chartW, gy); ctx.stroke();
      ctx.textAlign = 'left';
      ctx.fillText(_f(pMax - (pMax - pMin) * g / 4, 0), padL + chartW + 4, gy + 3);
    }

    /* 时间轴 */
    ctx.textAlign = 'center';
    var ticks = [[0, '9:30'], [60, '10:30'], [120, '11:30/13:00'], [180, '14:00'], [240, '15:00']];
    ticks.forEach(function(tk) {
      var tx = xOf(tk[0]);
      if (tx < padL + 10 || tx > padL + chartW - 14) return;
      ctx.fillText(tk[1], tx, cssH - 5);
      ctx.strokeStyle = 'rgba(150,165,190,0.07)';
      ctx.beginPath(); ctx.moveTo(tx, padT); ctx.lineTo(tx, padT + priceH); ctx.stroke();
    });

    /* 昨收基线 */
    if (base !== null) {
      var by = yOfP(base);
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = 'rgba(224,169,62,0.5)';
      ctx.beginPath(); ctx.moveTo(padL, by); ctx.lineTo(padL + chartW, by); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(224,169,62,0.9)';
      ctx.textAlign = 'left';
      ctx.fillText('昨收 ' + _f(base, 0), padL + chartW + 4, by - 3);
    }

    /* 均价线 */
    if (_st.seriesAvg.length >= 2) {
      ctx.strokeStyle = 'rgba(224,169,62,0.85)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      _st.seriesAvg.forEach(function(pt, i) {
        var x = xOf(pt.m), y = yOfP(pt.p);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    /* 价格线 + 填充 */
    var up = base !== null ? ms[ms.length - 1].p >= base : true;
    var lineCol = up ? '#F0565C' : '#22B573';
    var fillCol = up ? 'rgba(240,86,92,0.14)' : 'rgba(34,181,115,0.14)';
    if (base !== null && ms.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(xOf(ms[0].m), yOfP(base));
      ms.forEach(function(pt) { ctx.lineTo(xOf(pt.m), yOfP(pt.p)); });
      ctx.lineTo(xOf(ms[ms.length - 1].m), yOfP(base));
      ctx.closePath();
      ctx.fillStyle = fillCol;
      ctx.fill();
    }
    ctx.strokeStyle = lineCol;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ms.forEach(function(pt, i) {
      var x = xOf(pt.m), y = yOfP(pt.p);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    /* 最新价点 + 右侧标签 */
    var lp = ms[ms.length - 1];
    ctx.fillStyle = lineCol;
    ctx.beginPath();
    ctx.arc(xOf(lp.m), yOfP(lp.p), 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(padL + chartW + 1, yOfP(lp.p) - 7, padR - 2, 14);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.font = 'bold 9px monospace';
    ctx.fillText(_f(lp.p, 2), padL + chartW + 3, yOfP(lp.p) + 3);
    ctx.font = '9px monospace';

    /* 悬停十字线 */
    if (_st.hoverM >= 0 && _st.hoverM <= 240) {
      var hx = xOf(_st.hoverM);
      var nearest = null, nd = Infinity;
      ms.forEach(function(pt) {
        var dd = Math.abs(pt.m - _st.hoverM);
        if (dd < nd) { nd = dd; nearest = pt; }
      });
      if (nearest) {
        ctx.strokeStyle = 'rgba(150,165,190,0.5)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(hx, padT); ctx.lineTo(hx, padT + priceH); ctx.stroke();
        var hy = yOfP(nearest.p);
        ctx.beginPath(); ctx.moveTo(padL, hy); ctx.lineTo(padL + chartW, hy); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = lineCol;
        ctx.beginPath(); ctx.arc(xOf(nearest.m), hy, 3, 0, Math.PI * 2); ctx.fill();
        var hm = _st.hoverM;
        var tLabel = hm <= 120 ? (9 * 60 + 30 + hm) : (13 * 60 + (hm - 120));
        var th = Math.floor(tLabel / 60), tm2 = tLabel % 60;
        var pct = base ? (nearest.p - base) / base * 100 : 0;
        var info = _pad(th) + ':' + _pad(tm2) + '  ' + _f(nearest.p, 2) + ' (' + _sign(pct, 2) + '%)';
        ctx.font = '10px monospace';
        var tw = ctx.measureText(info).width;
        ctx.fillStyle = 'rgba(17,23,34,0.92)';
        ctx.fillRect(padL + 2, padT + 2, tw + 10, 16);
        ctx.fillStyle = pct >= 0 ? '#F0565C' : '#22B573';
        ctx.textAlign = 'left';
        ctx.fillText(info, padL + 7, padT + 14);
      }
    }

    _st.chartGeom = { padL: padL, chartW: chartW };
    updateChartLegend();
  }

  function updateChartLegend() {
    var el = _id('rtChartLegend');
    var mq = _st.quotes[MAIN_CODE];
    if (!el || !mq) return;
    var f = _st.factors || {};
    el.innerHTML =
      '<span class="rt-lg"><i class="rt-lg-price"></i>价格</span>' +
      '<span class="rt-lg"><i class="rt-lg-avg"></i>均价线</span>' +
      '<span class="rt-lg"><i class="rt-lg-base"></i>昨收 ' + _f(mq.yesterdayClose, 2) + '</span>' +
      (f.volRatio > 0 ? '<span class="rt-lg">量能比 <b>' + _f(f.volRatio, 2) + 'x</b></span>' : '') +
      '<span class="rt-lg">振幅 <b>' + _f(f.amp !== undefined ? f.amp : 0, 2) + '%</b></span>';
  }

  /* 量化因子面板 */
  function renderFactors() {
    var box = _id('rtFactors');
    var f = _st.factors;
    if (!box) return;
    if (!f) { box.innerHTML = '<div class="rt-factor-empty">量化引擎启动中…</div>'; return; }
    var items = [
      { k: '动量', v: f.momentum, d: '加权涨幅 ' + _sign(f.avgChg, 2) + '%' },
      { k: '趋势', v: f.trend, d: f.aboveAvg !== null ? '距均价线 ' + _sign(f.aboveAvg, 2) + '%' : '积累中' },
      { k: '量能', v: f.volume, d: f.volRatio > 0 ? '昨日同期 ' + _f(f.volRatio, 2) + 'x' : '基准中' },
      { k: '广度', v: f.breadth, d: f.upCnt + '涨/' + f.dnCnt + '跌' },
      { k: '稳定', v: 100 - f.volatility, d: '振幅 ' + _f(f.amp, 2) + '%' }
    ];
    var score = Math.round(f.composite);
    var cls = score >= 57 ? 'bull' : (score > 43 ? 'flat' : 'bear');
    box.innerHTML =
      '<div class="rt-score ' + cls + '"><span class="rt-score-num">' + score + '</span><span class="rt-score-unit">/100</span></div>' +
      '<div class="rt-score-label ' + cls + '">' + (_st.verdict ? _st.verdict.posLabel : '计算中') + '</div>' +
      items.map(function(it) {
        var c = it.v >= 57 ? 'bull' : (it.v > 43 ? 'flat' : 'bear');
        return '<div class="rt-factor"><span class="rt-factor-k">' + it.k + '</span>' +
          '<span class="rt-factor-bar"><i class="' + c + '" style="width:' + Math.round(it.v) + '%"></i></span>' +
          '<span class="rt-factor-v">' + Math.round(it.v) + '</span>' +
          '<span class="rt-factor-d">' + it.d + '</span></div>';
      }).join('');
  }

  /* AI 解读面板 */
  function renderVerdict() {
    var box = _id('rtAiText');
    var v = _st.verdict;
    if (!box) return;
    if (!v) { box.innerHTML = '<div class="rt-ai-wait">AI 解读引擎等待行情数据…</div>'; return; }
    var riskHtml = v.risks.length > 0
      ? '<div class="rt-ai-risk">⚠️ ' + v.risks.slice(0, 3).join('；') + '</div>'
      : '';
    box.innerHTML =
      '<div class="rt-ai-line">' + v.p1 + '。' + v.p2 + '。' + v.p3 + '。</div>' +
      riskHtml +
      '<div class="rt-ai-action">' + v.action + '</div>' +
      '<div class="rt-ai-meta">分析时点 ' + v.time + ' · ' + v.sessionLabel + ' · 规则化量化引擎（非投资建议）</div>';
  }

  /* 信号流（指纹比对，仅变化时重建DOM） */
  function renderSignals() {
    var box = _id('rtSignalFeed');
    if (!box) return;
    if (_st.signals.length === 0) {
      if (_st._sigRendered !== 0) {
        box.innerHTML = '<div class="rt-sig-empty">盯盘引擎运行中，暂未触发信号（信号出现将自动滚动至此）</div>';
        _st._sigRendered = 0;
      }
      return;
    }
    if (_st._sigRendered === _st.signals.length) return;
    _st._sigRendered = _st.signals.length;
    var stars = function(n) {
      var s = '';
      for (var i = 0; i < n; i++) s += '★';
      return s;
    };
    box.innerHTML = _st.signals.map(function(sg) {
      var meta = SIG_META[sg.type] || { icon: '•', label: sg.type };
      return '<div class="rt-sig ' + sg.dir + '">' +
        '<span class="rt-sig-time">' + sg.time + '</span>' +
        '<span class="rt-sig-ico">' + meta.icon + '</span>' +
        '<span class="rt-sig-text">' + sg.text + '</span>' +
        '<span class="rt-sig-star">' + stars(sg.strength) + '</span>' +
        '</div>';
    }).join('');
  }

  /* ---------- 分时图交互（RAF节流） ---------- */
  function bindChart() {
    var canvas = _id('rtChartCanvas');
    if (!canvas) return;
    function locate(e) {
      var geom = _st.chartGeom;
      if (!geom) return -1;
      var rect = canvas.getBoundingClientRect();
      var x = (e.clientX !== undefined ? e.clientX : (e.touches ? e.touches[0].clientX : 0)) - rect.left;
      var m = Math.round((x - geom.padL) / geom.chartW * 240);
      return Math.max(0, Math.min(240, m));
    }
    var move = Perf.rafThrottle(function(e) {
      var m = locate(e);
      if (m !== _st.hoverM) { _st.hoverM = m; renderChart(); }
    });
    canvas.addEventListener('mousemove', move, false);
    canvas.addEventListener('mouseleave', function() {
      if (_st.hoverM !== -1) { _st.hoverM = -1; renderChart(); }
    }, false);
    canvas.addEventListener('touchstart', function(e) {
      if (e.touches.length > 0) { _st.hoverM = locate(e); renderChart(); }
    }, { passive: true });
    canvas.addEventListener('touchmove', function(e) {
      if (e.touches.length > 0) { _st.hoverM = locate(e); renderChart(); }
    }, { passive: true });
  }

  /* ---------- 轮询调度 ---------- */
  function scheduleLoop() {
    if (_st.timer) { Perf.clearInterval(_st.timer); _st.timer = null; }
    if (!_st.running) return;
    var s = session();
    var interval = s.session === 'trading' ? POLL_TRADING : (s.session === 'lunch' ? POLL_LUNCH : POLL_CLOSED);
    _st.timer = Perf.setInterval(function() {
      if (!isActive()) return;
      var s2 = session();
      /* 时段切换 → 重设频率 + 刷新分时底稿（9:30开盘/13:00复盘换新数据） */
      if (s2.session !== s.session) { scheduleLoop(); loadMinuteData(true); return; }
      poll(false);
    }, interval);
  }

  function isActive() {
    if (!_st.running) return false;
    if (typeof document !== 'undefined' && document.hidden) return false;
    var sec = _id('foldRT');
    if (sec && sec.classList.contains('fold-closed')) return false;
    return true;
  }

  /* ---------- 昨日量能基准（拉一次日K） ---------- */
  function loadKlineBase() {
    if (typeof fetchKline !== 'function') return;
    fetchKline(MAIN_CODE, 30).then(function(kd) {
      if (!kd || !kd.klines || kd.klines.length < 2) return;
      var yk = kd.klines[kd.klines.length - 2]; /* 上一完整交易日 */
      _st.klineBase = {
        vol: parseFloat(yk[5]) || 0,
        close: parseFloat(yk[2]) || 0,
        date: yk[0]
      };
      /* 拿到基准后立即重算量能因子 */
      if (_st.quotes[MAIN_CODE]) {
        computeFactors();
        buildVerdict();
        renderFactors();
        renderVerdict();
        renderChart();
      }
    }).catch(function() { /* 基准缺失时量能因子自动跳过 */ });
  }

  /* ---------- 控件绑定 ---------- */
  function bindControls() {
    var pauseBtn = _id('rtPauseBtn');
    if (pauseBtn) {
      try { _st.running = (localStorage.getItem(LS_PAUSE) !== '1'); }
      catch (e) { _st.running = true; }
      pauseBtn.textContent = _st.running ? '⏸ 暂停' : '▶ 运行';
      pauseBtn.classList.toggle('off', !_st.running);
      pauseBtn.onclick = function() {
        _st.running = !_st.running;
        try { localStorage.setItem(LS_PAUSE, _st.running ? '0' : '1'); } catch (e) {}
        pauseBtn.textContent = _st.running ? '⏸ 暂停' : '▶ 运行';
        pauseBtn.classList.toggle('off', !_st.running);
        if (_st.running) { poll(false); scheduleLoop(); }
        renderStatusBar();
      };
    }
    var refreshBtn = _id('rtRefreshBtn');
    if (refreshBtn) refreshBtn.onclick = function() { poll(true); };
    bindChart();
  }

  /* ---------- 初始化 ---------- */
  function init() {
    if (_st.initialized) return;
    _st.initialized = true;

    bindControls();

    /* 折叠区展开感知 */
    var sec = _id('foldRT');
    if (sec) {
      _st.observer = new MutationObserver(function() {
        if (!sec.classList.contains('fold-closed')) {
          if (Date.now() - _st.lastPollAt > 15000) poll(false);
          if (!_st.timer && _st.running) scheduleLoop();
        }
      });
      _st.observer.observe(sec, { attributes: true, attributeFilter: ['class'] });
    }

    /* 页面可见性恢复 → 补拉 */
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden && isActive() && Date.now() - _st.lastPollAt > 30000) {
        poll(false);
      }
    }, false);

    /* 时钟每秒走字 */
    Perf.setInterval(function() { renderStatusBar(); }, 1000);

    /* 自适应重绘（尺寸变化时清缓存） */
    if (typeof Perf.onResize === 'function') {
      Perf.onResize(function() {
        _st._canvasW = 0; _st._canvasH = 0; /* 强制下帧重设尺寸 */
        if (_st.quotes[MAIN_CODE]) renderChart();
      });
    }

    /* 启动：拉取分时底稿 + 行情 + 昨日量能基准 */
    Perf.trackedSetTimeout(function() {
      loadMinuteData(true);
      if (isActive()) {
        poll(false);
        scheduleLoop();
      }
      loadKlineBase();
    }, 600);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, false);
  } else {
    init();
  }

  return {
    refresh: function() { poll(true); },
    toggle: function() {
      var btn = _id('rtPauseBtn');
      if (btn) btn.click();
    }
  };
})();
