'use strict';

/* ============================================================
   交互式技术分析（大盘页 · TA Interactive）
   ------------------------------------------------------------
   功能：
   ① K线图绘制（蜡烛图 + 成交量 + MACD 副图）
   ② 金叉/死叉自动识别（短均线上/下穿长均线，默认5/20可自定义）
   ③ 信号点位标注（时间 + 价格 + ▲▼标记）
   ④ 新信号提醒弹窗（横幅 + Toast，防重复打扰）
   ⑤ 近30日信号统计（次数 + 胜率 + 平均后5日收益）
   ⑥ MACD/RSI 辅助验证趋势强度（信号共振度判定）
   ⑦ 可视化趋势推断（短期/中期结论 + 置信度 + 依据）

   工程约束：
   - 兼容主流浏览器：纯 ES5 + Canvas 2D + MutationObserver
   - 加载性能：脚本 defer，首次展开才拉取数据（fetchKline 自带
     30分钟内存缓存 + 24小时本地缓存），首屏零开销
   - 数据延迟 ≤ 5分钟：分钟级实时行情补丁修正今日K线 +
     60秒轻量重绘 + 3分钟静默重拉
   ============================================================ */

var TAInter = (function() {

  /* ---------- 常量与状态 ---------- */
  var LS_CFG = 'ta_cfg_v1';          // 均线/标的配置
  var LS_ALERT = 'ta_alert_on_v1';   // 提醒开关
  var LS_ALERTED = 'ta_alerted_v1';  // 已提醒信号指纹集合
  var KLINE_COUNT = 320;             // 拉取K线根数（预热MA/MACD用）
  var DISPLAY_BARS = 90;             // 图表展示最近N根
  var FWD_DAYS = 5;                  // 信号后N日判定成败
  var STAT_WINDOW = 30;              // 近30日统计窗口（日历日）

  var _state = {
    code: 'sh000300',
    name: '沪深300',
    shortP: 5, longP: 20,
    kd: null,            // {dates,closes,klines}
    maS: null, maL: null,
    crosses: [],         // 信号序列
    macd: null,          // {dif,dea,hist}
    rsi: null,
    trend: null,         // 推断结论
    loaded: false,
    loading: false,
    lastLoadAt: 0,
    hoverIdx: -1,
    pinnedIdx: -1,
    chartGeom: null,     // 绘图几何缓存（供十字线定位）
    alertedSet: {}
  };

  var _observer = null;
  var _refreshTimer = null;
  var _lightTimer = null;

  var INDEX_OPTIONS = [
    { code: 'sh000300', name: '沪深300' },
    { code: 'sh000001', name: '上证指数' },
    { code: 'sz399001', name: '深证成指' },
    { code: 'sz399006', name: '创业板指' }
  ];

  /* ---------- 工具 ---------- */
  function _byId(id) { return document.getElementById(id); }

  function _loadCfg() {
    try {
      var c = JSON.parse(localStorage.getItem(LS_CFG) || 'null');
      if (c && c.code && c.shortP && c.longP) {
        _state.code = c.code; _state.shortP = c.shortP; _state.longP = c.longP;
      }
      var opt = INDEX_OPTIONS.filter(function(o) { return o.code === _state.code; })[0];
      _state.name = opt ? opt.name : _state.code;
    } catch (e) {}
    try { _state.alertedSet = JSON.parse(localStorage.getItem(LS_ALERTED) || '{}'); } catch (e) { _state.alertedSet = {}; }
  }

  function _saveCfg() {
    try {
      localStorage.setItem(LS_CFG, JSON.stringify({ code: _state.code, shortP: _state.shortP, longP: _state.longP }));
    } catch (e) {}
  }

  function _alertEnabled() {
    try { return localStorage.getItem(LS_ALERT) !== 'off'; } catch (e) { return true; }
  }

  function _setAlertEnabled(on) {
    try { localStorage.setItem(LS_ALERT, on ? 'on' : 'off'); } catch (e) {}
    var btn = _byId('taAlertToggle');
    if (btn) {
      btn.textContent = on ? '🔔 提醒开' : '🔕 提醒关';
      btn.classList.toggle('off', !on);
    }
  }

  function _fmt(n, d) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Number(n).toFixed(d === undefined ? 2 : d);
  }

  function _fmtVol(v) {
    v = parseFloat(v) || 0;
    if (v >= 100000000) return (v / 100000000).toFixed(2) + '亿';
    if (v >= 10000) return (v / 10000).toFixed(1) + '万';
    return String(Math.round(v));
  }

  function _parseDate(s) {
    // '2026-08-22' 或 '20260822'
    if (!s) return null;
    s = String(s);
    var y, m, d;
    if (s.indexOf('-') >= 0) {
      var p = s.split('-');
      y = +p[0]; m = +p[1]; d = +p[2];
    } else if (s.length === 8) {
      y = +s.slice(0, 4); m = +s.slice(4, 6); d = +s.slice(6, 8);
    } else return null;
    return new Date(y, m - 1, d);
  }

  function _shortDate(s) {
    var dt = _parseDate(s);
    if (!dt) return s || '';
    return (dt.getMonth() + 1) + '/' + dt.getDate();
  }

  /* ---------- 指标计算（全序列） ---------- */

  /** 简单移动平均全序列（前 period-1 位为 null） */
  function maSeries(data, period) {
    var out = [];
    if (!data || data.length < period) {
      for (var g = 0; g < (data ? data.length : 0); g++) out.push(null);
      return out;
    }
    var sum = 0;
    for (var i = 0; i < data.length; i++) {
      sum += data[i];
      if (i >= period) sum -= data[i - period];
      out.push(i >= period - 1 ? sum / period : null);
    }
    return out;
  }

  /** MACD 全序列（12/26/9，hist=2*(DIF-DEA)，A股软件惯例） */
  function macdSeries(closes, fast, slow, signal) {
    fast = fast || 12; slow = slow || 26; signal = signal || 9;
    var n = closes.length;
    if (n < slow + signal) return null;
    var kf = 2 / (fast + 1), ks = 2 / (slow + 1), kd = 2 / (signal + 1);
    var ef = closes[0], es = closes[0];
    var dif = [], emaF = [], emaS = [];
    for (var i = 0; i < n; i++) {
      if (i > 0) {
        ef = closes[i] * kf + ef * (1 - kf);
        es = closes[i] * ks + es * (1 - ks);
      }
      emaF.push(ef); emaS.push(es);
      dif.push(ef - es);
    }
    var dea = [dif[0]];
    for (var j = 1; j < n; j++) dea.push(dif[j] * kd + dea[j - 1] * (1 - kd));
    var hist = [];
    for (var k = 0; k < n; k++) hist.push(2 * (dif[k] - dea[k]));
    return { dif: dif, dea: dea, hist: hist };
  }

  /** RSI 全序列（Wilder 平滑，默认14） */
  function rsiSeries(closes, period) {
    period = period || 14;
    var n = closes.length;
    if (n < period + 1) return null;
    var out = [];
    var gain = 0, loss = 0;
    for (var i = 0; i < n; i++) {
      if (i < period) { out.push(null); if (i > 0) { var c0 = closes[i] - closes[i - 1]; if (c0 >= 0) gain += c0; else loss -= c0; } continue; }
      if (i === period) {
        var c1 = closes[i] - closes[i - 1];
        if (c1 >= 0) gain += c1; else loss -= c1;
        gain /= period; loss /= period;
      } else {
        var ch = closes[i] - closes[i - 1];
        var g = ch >= 0 ? ch : 0, l = ch < 0 ? -ch : 0;
        gain = (gain * (period - 1) + g) / period;
        loss = (loss * (period - 1) + l) / period;
      }
      out.push(loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
    }
    return out;
  }

  /** 金叉/死叉检测：短均线穿越长均线 */
  function detectCrosses(dates, closes, maS, maL, macd, rsi) {
    var out = [];
    if (!maS || !maL) return out;
    for (var i = 1; i < closes.length; i++) {
      if (maS[i] === null || maL[i] === null || maS[i - 1] === null || maL[i - 1] === null) continue;
      var type = null;
      if (maS[i - 1] <= maL[i - 1] && maS[i] > maL[i]) type = 'golden';
      else if (maS[i - 1] >= maL[i - 1] && maS[i] < maL[i]) type = 'death';
      if (!type) continue;

      // 后N日验证（数据不足记为 pending）
      var fwdIdx = Math.min(i + FWD_DAYS, closes.length - 1);
      var fwdRet = (closes[fwdIdx] - closes[i]) / closes[i] * 100;
      var pending = (i + FWD_DAYS > closes.length - 1);

      // MACD/RSI 共振验证
      var macdAgree, rsiAgree;
      if (type === 'golden') {
        macdAgree = macd ? (macd.dif[i] > macd.dea[i] || (i > 0 && macd.hist[i] > macd.hist[i - 1])) : false;
        rsiAgree = rsi && rsi[i] !== null ? (rsi[i] > 45 && rsi[i] < 78) : false;
      } else {
        macdAgree = macd ? (macd.dif[i] < macd.dea[i] || (i > 0 && macd.hist[i] < macd.hist[i - 1])) : false;
        rsiAgree = rsi && rsi[i] !== null ? (rsi[i] < 55 && rsi[i] > 22) : false;
      }

      out.push({
        idx: i, type: type, date: dates[i], price: closes[i],
        fwdRet: fwdRet, pending: pending,
        ok: pending ? null : (type === 'golden' ? fwdRet > 0 : fwdRet < 0),
        agreeN: (macdAgree ? 1 : 0) + (rsiAgree ? 1 : 0),
        rsiAt: rsi ? rsi[i] : null
      });
    }
    return out;
  }

  /** 趋势推断：短期（均线排列+MACD动能+RSI） / 中期（MA20/60+斜率+DIF零轴） */
  function inferTrend(closes, maS, maL, macd, rsi, crosses) {
    var n = closes.length;
    if (n < 30 || !maS || !maL) return null;
    var ma20 = maSeries(closes, 20);
    var ma60 = maSeries(closes, 60);
    var i = n - 1;

    /* —— 短期评分（-6..+6） —— */
    var sScore = 0, sBits = [];
    var above = maS[i] !== null && maL[i] !== null && maS[i] > maL[i];
    sScore += above ? 2 : -2;
    sBits.push((above ? 'MA' + _state.shortP + ' 在 MA' + _state.longP + ' 上方' : 'MA' + _state.shortP + ' 在 MA' + _state.longP + ' 下方'));
    var lastCross = crosses.length > 0 ? crosses[crosses.length - 1] : null;
    if (lastCross && n - 1 - lastCross.idx <= 10) {
      sScore += lastCross.type === 'golden' ? 1 : -1;
      sBits.push(lastCross.type === 'golden' ? '近期金叉' : '近期死叉');
    }
    if (macd) {
      sScore += macd.hist[i] > 0 ? 1 : -1;
      sScore += (i > 0 && macd.hist[i] > macd.hist[i - 1]) ? 1 : -1;
      sBits.push(macd.hist[i] > 0 ? 'MACD红柱' : 'MACD绿柱');
    }
    if (rsi && rsi[i] !== null) {
      if (rsi[i] > 55) { sScore += 1; sBits.push('RSI ' + _fmt(rsi[i], 0) + ' 偏强'); }
      else if (rsi[i] < 45) { sScore -= 1; sBits.push('RSI ' + _fmt(rsi[i], 0) + ' 偏弱'); }
    }

    /* —— 中期评分（-8..+8） —— */
    var mScore = 0, mBits = [];
    mScore += ma20[i] !== null && closes[i] > ma20[i] ? 2 : -2;
    mBits.push(closes[i] > ma20[i] ? '价格站上MA20' : '价格跌破MA20');
    if (ma60[i] !== null) {
      mScore += closes[i] > ma60[i] ? 2 : -2;
      mBits.push(closes[i] > ma60[i] ? '价格在MA60上' : '价格在MA60下');
    }
    if (ma20[i] !== null && i >= 10 && ma20[i - 10] !== null && ma20[i - 10] > 0) {
      var slope10 = (ma20[i] - ma20[i - 10]) / ma20[i - 10] * 100;
      if (slope10 > 0.5) { mScore += 2; mBits.push('MA20十日斜率 +' + _fmt(slope10, 1) + '%'); }
      else if (slope10 < -0.5) { mScore -= 2; mBits.push('MA20十日斜率 ' + _fmt(slope10, 1) + '%'); }
      else { mBits.push('MA20斜率走平'); }
    }
    if (macd) {
      mScore += macd.dif[i] > 0 ? 2 : -2;
      mBits.push(macd.dif[i] > 0 ? 'DIF在零轴上方' : 'DIF在零轴下方');
    }

    function map(v, t1, t2) {
      if (v >= t1) return 2;   // 看涨
      if (v >= t2) return 1;   // 偏多
      if (v > -t2) return 0;   // 震荡
      if (v > -t1) return -1;  // 偏空
      return -2;               // 看跌
    }
    var sLevel = map(sScore, 4, 2);
    var mLevel = map(mScore, 5, 3);
    var LBL = { 2: '看涨', 1: '偏多', 0: '震荡', '-1': '偏空', '-2': '看跌' };
    var ARW = { 2: '↑', 1: '↗', 0: '→', '-1': '↘', '-2': '↓' };

    return {
      short: { level: sLevel, label: LBL[sLevel], arrow: ARW[sLevel], score: sScore, bits: sBits,
        conf: Math.min(95, 55 + Math.abs(sScore) / 6 * 40) },
      mid: { level: mLevel, label: LBL[mLevel], arrow: ARW[mLevel], score: mScore, bits: mBits,
        conf: Math.min(95, 55 + Math.abs(mScore) / 8 * 40) },
      rsiNow: rsi ? rsi[i] : null,
      macdNow: macd ? { dif: macd.dif[i], dea: macd.dea[i], hist: macd.hist[i] } : null,
      lastCross: lastCross
    };
  }

  /* ---------- 实时补丁：用分钟级行情修正今日K线 ---------- */
  function patchRealtime() {
    var kd = _state.kd;
    if (!kd || !kd.klines || kd.klines.length === 0) return false;
    if (typeof _lastRealtimeData !== 'object' || !_lastRealtimeData) return false;
    var rt = _lastRealtimeData[_state.code];
    if (!rt || !rt.price || rt.price <= 0) return false;

    var last = kd.klines[kd.klines.length - 1];
    var prevClose = parseFloat(last[2]) || 0;
    last[2] = String(rt.price);                                    // 收盘=最新价
    if (rt.open > 0) last[1] = String(rt.open);                    // 开盘
    var hi = Math.max(parseFloat(last[3]) || 0, rt.high || rt.price, rt.price);
    var lo = Math.min(parseFloat(last[4]) || Infinity, rt.low || rt.price, rt.price);
    if (hi > 0) last[3] = String(hi);
    if (isFinite(lo) && lo > 0) last[4] = String(lo);
    if (rt.volume > 0) last[5] = String(rt.volume);
    kd.closes[kd.closes.length - 1] = rt.price;
    return prevClose > 0;
  }

  /* ---------- 分析流水线 ---------- */
  function analyze() {
    var kd = _state.kd;
    if (!kd || !kd.closes || kd.closes.length < 30) return;
    _state.maS = maSeries(kd.closes, _state.shortP);
    _state.maL = maSeries(kd.closes, _state.longP);
    _state.macd = macdSeries(kd.closes);
    _state.rsi = rsiSeries(kd.closes, 14);
    _state.crosses = detectCrosses(kd.dates, kd.closes, _state.maS, _state.maL, _state.macd, _state.rsi);
    _state.trend = inferTrend(kd.closes, _state.maS, _state.maL, _state.macd, _state.rsi, _state.crosses);
  }

  /* ---------- 渲染：K线主图 ---------- */
  function _cssVar(name, fallback) {
    var v = getComputedStyle(document.body).getPropertyValue(name);
    v = v ? v.trim() : '';
    return v || fallback;
  }

  function renderChart() {
    var canvas = _byId('taChartCanvas');
    if (!canvas) return;
    var kd = _state.kd;
    var statusEl = _byId('taDataStatus');
    var dpr = window.devicePixelRatio || 1;
    var cssW = canvas.clientWidth || canvas.parentElement.clientWidth - 8 || 600;
    var cssH = 330;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var C = {
      up: _cssVar('--neon-red', '#F0565C'),
      down: _cssVar('--neon-green', '#22B573'),
      maS: _cssVar('--accent2', '#E0A93E'),
      maL: _cssVar('--accent', '#4C8DFF'),
      ink: _cssVar('--ink', '#E7ECF4'),
      muted: _cssVar('--muted', '#8C98AA'),
      rule: _cssVar('--rule', 'rgba(150,165,190,0.16)')
    };

    if (!kd || !kd.klines || kd.klines.length === 0) {
      ctx.fillStyle = C.muted;
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('K线数据加载中…', cssW / 2, cssH / 2);
      return;
    }

    var klines = kd.klines, closes = kd.closes;
    var startIdx = Math.max(0, klines.length - DISPLAY_BARS);
    var disp = klines.slice(startIdx);
    var n = disp.length;

    /* 布局：价格主图 205 + 成交量 38 + MACD 60 */
    var padL = 8, padR = 46, padT = 10, padB = 18;
    var chartW = cssW - padL - padR;
    var priceTop = padT, priceH = 205;
    var volTop = priceTop + priceH + 6, volH = 38;
    var macdTop = volTop + volH + 8, macdH = cssH - macdTop - padB;
    var candleW = chartW / n;
    var bodyW = Math.max(2, candleW * 0.62);

    /* 价格范围（含显示段均线） */
    var pMin = Infinity, pMax = -Infinity;
    for (var r = 0; r < n; r++) {
      var hi = parseFloat(disp[r][3]) || 0, lo = parseFloat(disp[r][4]) || 0;
      if (hi > pMax) pMax = hi;
      if (lo > 0 && lo < pMin) pMin = lo;
      var si = startIdx + r;
      if (_state.maS && _state.maS[si] !== null) { if (_state.maS[si] > pMax) pMax = _state.maS[si]; if (_state.maS[si] < pMin) pMin = _state.maS[si]; }
      if (_state.maL && _state.maL[si] !== null) { if (_state.maL[si] > pMax) pMax = _state.maL[si]; if (_state.maL[si] < pMin) pMin = _state.maL[si]; }
    }
    var pRange0 = pMax - pMin || 1;
    pMin -= pRange0 * 0.06; pMax += pRange0 * 0.06;
    var pRange = pMax - pMin;

    function xOf(i) { return padL + i * candleW + candleW / 2; }
    function yOfP(p) { return priceTop + priceH - (p - pMin) / pRange * priceH; }

    ctx.clearRect(0, 0, cssW, cssH);

    /* 网格 + 右侧价格刻度 */
    ctx.strokeStyle = 'rgba(150,165,190,0.10)';
    ctx.lineWidth = 1;
    ctx.font = '9px ' + _cssVar('--font-mono', 'monospace');
    ctx.fillStyle = C.muted;
    ctx.textAlign = 'left';
    for (var g = 0; g <= 4; g++) {
      var gy = priceTop + priceH * g / 4;
      ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(padL + chartW, gy); ctx.stroke();
      ctx.fillText(_fmt(pMax - pRange * g / 4, 0), padL + chartW + 4, gy + 3);
    }

    /* 底部日期（约8等分） */
    ctx.textAlign = 'center';
    var step = Math.max(1, Math.floor(n / 8));
    for (var t = 0; t < n; t += step) {
      ctx.fillStyle = C.muted;
      ctx.fillText(_shortDate(disp[t][0]), xOf(t), cssH - 5);
    }

    /* 成交量柱 */
    var vols = [], vMax = 0;
    for (var v = 0; v < n; v++) {
      var vv = parseFloat(disp[v][5]) || 0;
      vols.push(vv);
      if (vv > vMax) vMax = vv;
    }
    var volBase = volTop + volH;
    for (var v2 = 0; v2 < n; v2++) {
      if (vMax <= 0) break;
      var up = parseFloat(disp[v2][2]) >= parseFloat(disp[v2][1]);
      var vh = vols[v2] / vMax * volH;
      ctx.fillStyle = up ? 'rgba(240,86,92,0.35)' : 'rgba(34,181,115,0.35)';
      ctx.fillRect(xOf(v2) - bodyW * 0.35, volBase - vh, bodyW * 0.7, vh);
    }

    /* MACD 副图 */
    var M = _state.macd;
    if (M) {
      var hMax = 0;
      for (var h1 = startIdx; h1 < klines.length; h1++) {
        var ha = Math.abs(M.hist[h1]);
        var hd = Math.max(Math.abs(M.dif[h1]), Math.abs(M.dea[h1]));
        if (ha > hMax) hMax = ha;
        if (hd > hMax) hMax = hd;
      }
      if (hMax <= 0) hMax = 1;
      var mMid = macdTop + macdH / 2;
      function yOfM(val) { return mMid - val / hMax * (macdH / 2 - 3); }
      ctx.strokeStyle = 'rgba(150,165,190,0.14)';
      ctx.beginPath(); ctx.moveTo(padL, mMid); ctx.lineTo(padL + chartW, mMid); ctx.stroke();
      for (var h2 = startIdx; h2 < klines.length; h2++) {
        var hv = M.hist[h2];
        var hx = xOf(h2 - startIdx);
        ctx.fillStyle = hv >= 0 ? 'rgba(240,86,92,0.55)' : 'rgba(34,181,115,0.55)';
        var hy = yOfM(hv);
        ctx.fillRect(hx - bodyW * 0.3, Math.min(hy, mMid), bodyW * 0.6, Math.abs(mMid - hy) || 1);
      }
      function drawLine(arr, color) {
        ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath();
        var st = false;
        for (var q = startIdx; q < klines.length; q++) {
          var qx = xOf(q - startIdx), qy = yOfM(arr[q]);
          if (!st) { ctx.moveTo(qx, qy); st = true; } else ctx.lineTo(qx, qy);
        }
        ctx.stroke();
      }
      drawLine(M.dif, 'rgba(231,236,244,0.75)');
      drawLine(M.dea, 'rgba(224,169,62,0.85)');
      ctx.fillStyle = C.muted; ctx.textAlign = 'left'; ctx.font = '9px sans-serif';
      ctx.fillText('MACD(12,26,9)', padL + 2, macdTop + 8);
    }

    /* 蜡烛图 */
    for (var c = 0; c < n; c++) {
      var k = disp[c];
      var o = parseFloat(k[1]), cl = parseFloat(k[2]), h2v = parseFloat(k[3]), l2v = parseFloat(k[4]);
      if (!(cl > 0)) continue;
      var upc = cl >= o;
      var col = upc ? C.up : C.down;
      var cx = xOf(c);
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
      /* 影线 */
      ctx.beginPath();
      ctx.moveTo(cx, yOfP(h2v));
      ctx.lineTo(cx, yOfP(l2v));
      ctx.stroke();
      /* 实体 */
      var yO = yOfP(o), yC = yOfP(cl);
      var top = Math.min(yO, yC), hgt = Math.max(1, Math.abs(yO - yC));
      if (upc) {
        ctx.fillStyle = 'rgba(240,86,92,0.85)';
        ctx.fillRect(cx - bodyW / 2, top, bodyW, hgt);
      } else {
        ctx.fillStyle = C.down;
        ctx.fillRect(cx - bodyW / 2, top, bodyW, hgt);
      }
    }

    /* 均线 */
    function drawMA(arr, color) {
      ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.beginPath();
      var st2 = false;
      for (var m = 0; m < n; m++) {
        var gi = startIdx + m;
        if (!arr || arr[gi] === null) { st2 = false; continue; }
        var mx = xOf(m), my = yOfP(arr[gi]);
        if (!st2) { ctx.moveTo(mx, my); st2 = true; } else ctx.lineTo(mx, my);
      }
      ctx.stroke();
    }
    drawMA(_state.maS, C.maS);
    drawMA(_state.maL, C.maL);

    /* 最新价虚线 + 右侧标签 */
    var lastClose = closes[closes.length - 1];
    if (startIdx <= closes.length - 1) {
      var ly = yOfP(lastClose);
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(224,169,62,0.4)';
      ctx.beginPath(); ctx.moveTo(padL, ly); ctx.lineTo(padL + chartW, ly); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(224,169,62,0.9)';
      ctx.font = '9px ' + _cssVar('--font-mono', 'monospace');
      ctx.textAlign = 'left';
      ctx.fillText(_fmt(lastClose, 2), padL + chartW + 4, ly + 3);
    }

    /* 金叉/死叉标记（▲红 / ▼绿，最近3个带时间+价格标注） */
    var shown = _state.crosses.filter(function(cr) { return cr.idx >= startIdx; });
    for (var s = 0; s < shown.length; s++) {
      var sig = shown[s];
      var sx = xOf(sig.idx - startIdx);
      var golden = sig.type === 'golden';
      var mcol = golden ? C.up : C.down;
      var yLow = yOfP(parseFloat(disp[sig.idx - startIdx][4]));
      var yHigh = yOfP(parseFloat(disp[sig.idx - startIdx][3]));
      var ty = golden ? yLow + 10 : yHigh - 10;   // 金叉标在下方，死叉标在上方
      ctx.fillStyle = mcol;
      ctx.beginPath();
      if (golden) { ctx.moveTo(sx, ty - 5); ctx.lineTo(sx - 4, ty + 3); ctx.lineTo(sx + 4, ty + 3); }
      else { ctx.moveTo(sx, ty + 5); ctx.lineTo(sx - 4, ty - 3); ctx.lineTo(sx + 4, ty - 3); }
      ctx.closePath(); ctx.fill();

      /* 竖直细虚线贯穿K线区 */
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = golden ? 'rgba(240,86,92,0.35)' : 'rgba(34,181,115,0.35)';
      ctx.beginPath(); ctx.moveTo(sx, priceTop); ctx.lineTo(sx, priceTop + priceH); ctx.stroke();
      ctx.setLineDash([]);
    }
    /* 最近3个信号的文字标注（时间+价格） */
    var recent = shown.slice(-3);
    for (var rr = 0; rr < recent.length; rr++) {
      var sg = recent[rr];
      var gx = xOf(sg.idx - startIdx);
      var gLow = yOfP(parseFloat(disp[sg.idx - startIdx][4]));
      var gHigh = yOfP(parseFloat(disp[sg.idx - startIdx][3]));
      var txt = (sg.type === 'golden' ? '金叉 ' : '死叉 ') + _shortDate(sg.date) + ' ' + _fmt(sg.price, 0);
      ctx.font = '9px sans-serif';
      var tw = ctx.measureText(txt).width;
      var tx = Math.min(Math.max(gx - tw / 2, padL + 1), padL + chartW - tw - 1);
      var ty2 = sg.type === 'golden' ? gLow + 20 : gHigh - 16;
      ctx.fillStyle = sg.type === 'golden' ? 'rgba(240,86,92,0.18)' : 'rgba(34,181,115,0.18)';
      ctx.fillRect(tx - 2, ty2 - 9, tw + 4, 12);
      ctx.fillStyle = sg.type === 'golden' ? C.up : C.down;
      ctx.textAlign = 'left';
      ctx.fillText(txt, tx, ty2);
    }

    /* 十字线 + 高亮（悬停/点击） */
    var active = _state.pinnedIdx >= startIdx ? _state.pinnedIdx : _state.hoverIdx;
    if (active >= startIdx && active < klines.length) {
      var ax = xOf(active - startIdx);
      ctx.strokeStyle = 'rgba(150,165,190,0.5)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(ax, priceTop); ctx.lineTo(ax, macdTop + macdH); ctx.stroke();
      var ap = closes[active];
      var ay = yOfP(ap);
      ctx.beginPath(); ctx.moveTo(padL, ay); ctx.lineTo(padL + chartW, ay); ctx.stroke();
      ctx.setLineDash([]);
      /* 右轴价格气泡 */
      ctx.fillStyle = 'rgba(76,141,255,0.9)';
      ctx.fillRect(padL + chartW + 1, ay - 7, padR - 2, 14);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.font = '9px monospace';
      ctx.fillText(_fmt(ap, 2), padL + chartW + 3, ay + 3);
    }

    /* 图例 */
    ctx.font = '9px sans-serif'; ctx.textAlign = 'left';
    ctx.fillStyle = C.maS;
    ctx.fillText('MA' + _state.shortP, padL + 2, priceTop + 9);
    ctx.fillStyle = C.maL;
    ctx.fillText('MA' + _state.longP, padL + 30, priceTop + 9);
    ctx.fillStyle = C.muted;
    ctx.fillText('▲金叉 ▼死叉', padL + 58, priceTop + 9);

    /* 缓存几何信息（供鼠标定位） */
    _state.chartGeom = { padL: padL, chartW: chartW, candleW: candleW, startIdx: startIdx, n: n, dpr: dpr };

    /* 图例信息行 */
    var legendEl = _byId('taLegend');
    if (legendEl && _state.maS) {
      var li = klines.length - 1;
      legendEl.innerHTML =
        '<span style="color:' + C.maS + '">MA' + _state.shortP + ' ' + _fmt(_state.maS[li], 1) + '</span>' +
        '<span style="color:' + C.maL + '">MA' + _state.longP + ' ' + _fmt(_state.maL[li], 1) + '</span>' +
        '<span style="color:' + C.ink + '">收 ' + _fmt(closes[li], 2) + '</span>' +
        (M ? '<span style="color:' + C.muted + '">MACD柱 ' + _fmt(M.hist[li], 2) + '</span>' : '') +
        (_state.rsi && _state.rsi[li] !== null ? '<span style="color:' + C.muted + '">RSI14 ' + _fmt(_state.rsi[li], 1) + '</span>' : '');
    }
    if (statusEl && _state.lastLoadAt) {
      var dt = new Date(_state.lastLoadAt);
      var hh = ('0' + dt.getHours()).slice(-2), mm = ('0' + dt.getMinutes()).slice(-2);
      statusEl.textContent = '📊 ' + _state.name + ' · 日K' + n + '根 · 更新 ' + hh + ':' + mm + '（实时行情分钟级修正）';
    }
  }

  /* ---------- 渲染：趋势推断结论 ---------- */
  function renderConclusion() {
    var box = _byId('taTrendBox');
    var t = _state.trend;
    if (!box) return;
    if (!t) { box.innerHTML = '<div class="ta-trend-empty">数据不足，暂无法推断</div>'; return; }

    function chip(part, prefix) {
      var lvl = part.level;
      var cls = lvl >= 1 ? 'bull' : (lvl <= -1 ? 'bear' : 'flat');
      return '<div class="ta-trend-chip ' + cls + '">' +
        '<span class="ta-trend-k">' + prefix + '</span>' +
        '<span class="ta-trend-v">' + prefix + part.label + ' ' + part.arrow + '</span>' +
        '<span class="ta-trend-conf"><i style="width:' + Math.round(part.conf) + '%"></i></span>' +
        '<span class="ta-trend-confnum">置信度 ' + Math.round(part.conf) + '%</span>' +
        '</div>';
    }
    var bitsHtml = '';
    for (var i = 0; i < t.short.bits.length && i < 4; i++) bitsHtml += '<span>' + t.short.bits[i] + '</span>';
    for (var j = 0; j < t.mid.bits.length && j < 4; j++) bitsHtml += '<span>' + t.mid.bits[j] + '</span>';

    /* 最新信号卡片 */
    var lc = t.lastCross;
    var lcHtml = '';
    if (lc) {
      var agreeTxt = lc.agreeN >= 2 ? '<b class="agree2">双指标共振</b>' : (lc.agreeN === 1 ? '<b class="agree1">部分支持</b>' : '<b class="agree0">指标背离</b>');
      var fwdTxt = lc.pending ? '<span class="ta-pending">后' + FWD_DAYS + '日待验证</span>'
        : '<span class="' + (lc.ok ? 'ta-ok' : 'ta-fail') + '">后' + FWD_DAYS + '日 ' + (lc.fwdRet >= 0 ? '+' : '') + _fmt(lc.fwdRet, 2) + '% ' + (lc.ok ? '✔验证成功' : '✘验证失败') + '</span>';
      lcHtml = '<div class="ta-latest-sig ' + (lc.type === 'golden' ? 'golden' : 'death') + '">' +
        (lc.type === 'golden' ? '▲ 金叉' : '▼ 死叉') + '：MA' + _state.shortP + (lc.type === 'golden' ? ' 上穿 ' : ' 下穿 ') + 'MA' + _state.longP +
        ' · ' + lc.date + ' · ' + _fmt(lc.price, 2) +
        ' <span class="ta-agree">MACD/RSI ' + agreeTxt + '</span> ' + fwdTxt +
        '</div>';
    }

    var rsiTxt = t.rsiNow !== null ? _fmt(t.rsiNow, 1) + (t.rsiNow > 70 ? '（超买）' : (t.rsiNow < 30 ? '（超卖）' : '')) : '—';
    var mn = t.macdNow;
    var macdTxt = mn ? 'DIF ' + _fmt(mn.dif, 2) + ' / DEA ' + _fmt(mn.dea, 2) + ' / 柱 ' + _fmt(mn.hist, 2) : '—';

    box.innerHTML =
      '<div class="ta-trend-main">' + chip(t.short, '短期') + chip(t.mid, '中期') + '</div>' +
      '<div class="ta-trend-verdict">综合推断：<b>' + _state.name + ' 短期' + t.short.label + '、中期' + t.mid.label + '</b></div>' +
      lcHtml +
      '<div class="ta-trend-aux">RSI14 ' + rsiTxt + ' ｜ MACD ' + macdTxt + '</div>' +
      '<div class="ta-trend-bits">' + bitsHtml + '</div>';
  }

  /* ---------- 渲染：近30日统计 + 信号表 ---------- */
  function renderStats() {
    var sumEl = _byId('taStatsSummary');
    var tbody = _byId('taSignalTbody');
    if (!sumEl || !tbody) return;
    var kd = _state.kd;
    if (!kd || !kd.dates || kd.dates.length === 0) { sumEl.innerHTML = ''; tbody.innerHTML = ''; return; }

    var lastDate = _parseDate(kd.dates[kd.dates.length - 1]);
    var winStart = lastDate ? new Date(lastDate.getTime() - STAT_WINDOW * 86400000) : null;

    var golden = [], death = [];
    _state.crosses.forEach(function(cr) {
      var d = _parseDate(cr.date);
      if (winStart && d && d >= winStart) (cr.type === 'golden' ? golden : death).push(cr);
    });

    function statRow(arr) {
      var done = arr.filter(function(c2) { return !c2.pending; });
      var win = done.filter(function(c2) { return c2.ok; });
      var avg = done.length > 0 ? done.reduce(function(a, b) { return a + b.fwdRet; }, 0) / done.length : null;
      return { n: arr.length, winRate: done.length > 0 ? win.length / done.length * 100 : null, avg: avg };
    }
    var g = statRow(golden), d2 = statRow(death);

    sumEl.innerHTML =
      '<div class="ta-stat golden"><span class="ta-stat-k">▲ 金叉(近' + STAT_WINDOW + '日)</span><b>' + g.n + '</b> 次' +
      (g.winRate !== null ? '<span class="ta-stat-sub">胜率 ' + _fmt(g.winRate, 0) + '%</span><span class="ta-stat-sub">均后' + FWD_DAYS + '日 ' + (g.avg >= 0 ? '+' : '') + _fmt(g.avg, 2) + '%</span>' : '<span class="ta-stat-sub">暂无已验证样本</span>') + '</div>' +
      '<div class="ta-stat death"><span class="ta-stat-k">▼ 死叉(近' + STAT_WINDOW + '日)</span><b>' + d2.n + '</b> 次' +
      (d2.winRate !== null ? '<span class="ta-stat-sub">胜率 ' + _fmt(d2.winRate, 0) + '%</span><span class="ta-stat-sub">均后' + FWD_DAYS + '日 ' + (d2.avg >= 0 ? '+' : '') + _fmt(d2.avg, 2) + '%</span>' : '<span class="ta-stat-sub">暂无已验证样本</span>') + '</div>';

    /* 信号明细表：最近8条，新在前 */
    var rows = _state.crosses.slice(-8).reverse();
    var html = '';
    if (rows.length === 0) {
      html = '<tr><td colspan="6" class="ta-table-empty">当前均线参数下暂无金叉/死叉信号</td></tr>';
    } else {
      rows.forEach(function(cr) {
        var typeTxt = cr.type === 'golden' ? '<span class="ta-type golden">▲ 金叉</span>' : '<span class="ta-type death">▼ 死叉</span>';
        var fwdTxt = cr.pending ? '<span class="ta-pending">待验证</span>'
          : '<span class="' + (cr.fwdRet >= 0 ? 'ta-up' : 'ta-down') + '">' + (cr.fwdRet >= 0 ? '+' : '') + _fmt(cr.fwdRet, 2) + '%</span>';
        var resTxt = cr.pending ? '<span class="ta-pending">—</span>'
          : (cr.ok ? '<span class="ta-ok">✔ 成功</span>' : '<span class="ta-fail">✘ 失败</span>');
        var agreeTxt = cr.agreeN >= 2 ? '<span class="agree2">共振</span>' : (cr.agreeN === 1 ? '<span class="agree1">部分</span>' : '<span class="agree0">背离</span>');
        html += '<tr><td>' + cr.date + '</td><td>' + typeTxt + '</td><td class="ta-num">' + _fmt(cr.price, 2) + '</td>' +
          '<td class="ta-num">' + fwdTxt + '</td><td>' + resTxt + '</td><td>' + agreeTxt + (cr.rsiAt !== null ? '<span class="ta-rsi">RSI ' + _fmt(cr.rsiAt, 0) + '</span>' : '') + '</td></tr>';
      });
    }
    tbody.innerHTML = html;
  }

  /* ---------- 新信号提醒 ---------- */
  function checkAlert() {
    if (!_alertEnabled()) return;
    var kd = _state.kd;
    if (!kd || _state.crosses.length === 0) return;
    var n = kd.closes.length;
    var lc = _state.crosses[_state.crosses.length - 1];
    if (!lc || n - 1 - lc.idx > 1) return;   // 仅最近1-2根K线内的新信号才提醒

    var key = _state.code + '|' + lc.type + '|' + lc.date + '|' + _state.shortP + 'x' + _state.longP;
    if (_state.alertedSet[key]) return;
    _state.alertedSet[key] = 1;
    try { localStorage.setItem(LS_ALERTED, JSON.stringify(_state.alertedSet)); } catch (e) {}

    var bar = _byId('taAlertBar');
    if (!bar) return;
    var golden = lc.type === 'golden';
    var agreeTxt = lc.agreeN >= 2 ? 'MACD/RSI双指标共振支持' : (lc.agreeN === 1 ? 'MACD/RSI部分支持' : '注意：MACD/RSI与信号背离');
    bar.className = 'ta-alert-bar show ' + (golden ? 'golden' : 'death');
    bar.innerHTML =
      '<span class="ta-alert-ico">🔔</span>' +
      '<div class="ta-alert-txt"><b>' + (golden ? '金叉信号' : '死叉信号') + '</b>：' + _state.name +
      ' 于 ' + lc.date + ' ' + _fmt(lc.price, 2) + ' 出现 MA' + _state.shortP +
      (golden ? ' 上穿 ' : ' 下穿 ') + 'MA' + _state.longP + '，' + agreeTxt + '</div>' +
      '<button class="ta-alert-close" onclick="TAInter.dismissAlert()" aria-label="关闭提醒">✕</button>';
    if (showToast) showToast((golden ? '🔔 金叉信号：' : '🔔 死叉信号：') + _state.name + ' MA' + _state.shortP + (golden ? '上穿' : '下穿') + 'MA' + _state.longP + ' @' + _fmt(lc.price, 2));
    Perf.trackedSetTimeout(function() { TAInter.dismissAlert(); }, 12000);
  }

  function dismissAlert() {
    var bar = _byId('taAlertBar');
    if (bar) bar.className = 'ta-alert-bar';
  }

  /* ---------- 十字线交互 ---------- */
  function bindChartEvents() {
    var canvas = _byId('taChartCanvas');
    var tip = _byId('taTip');
    if (!canvas || !tip) return;

    function locate(evt) {
      var geom = _state.chartGeom;
      if (!geom || !_state.kd) return -1;
      var rect = canvas.getBoundingClientRect();
      var x = (evt.touches && evt.touches.length > 0 ? evt.touches[0].clientX : evt.clientX) - rect.left;
      var idx = Math.floor((x - geom.padL) / geom.candleW) + geom.startIdx;
      if (idx < geom.startIdx) idx = geom.startIdx;
      if (idx > geom.startIdx + geom.n - 1) idx = geom.startIdx + geom.n - 1;
      return idx;
    }

    function showTip(idx, evt) {
      var kd = _state.kd;
      if (!kd || idx < 0 || idx >= kd.klines.length) return;
      var k = kd.klines[idx];
      var o = parseFloat(k[1]), c = parseFloat(k[2]), h = parseFloat(k[3]), l = parseFloat(k[4]);
      var prevC = idx > 0 ? kd.closes[idx - 1] : o;
      var chg = prevC > 0 ? (c - prevC) / prevC * 100 : 0;
      var maSv = _state.maS ? _state.maS[idx] : null;
      var maLv = _state.maL ? _state.maL[idx] : null;
      var M = _state.macd, R = _state.rsi;
      var sigHere = _state.crosses.filter(function(cr) { return cr.idx === idx; })[0];
      var cls = c >= o ? 'up' : 'down';
      tip.className = 'ta-tip show ' + cls;
      tip.innerHTML =
        '<div class="ta-tip-date">' + (k[0] || '') + (chg >= 0 ? ' <b class="ta-up">+' + _fmt(chg, 2) + '%</b>' : ' <b class="ta-down">' + _fmt(chg, 2) + '%</b>') + '</div>' +
        '<div>开 ' + _fmt(o, 2) + '　高 ' + _fmt(h, 2) + '</div>' +
        '<div>收 ' + _fmt(c, 2) + '　低 ' + _fmt(l, 2) + '</div>' +
        '<div>量 ' + _fmtVol(k[5]) + '</div>' +
        '<div><span style="color:var(--accent2)">MA' + _state.shortP + '</span> ' + _fmt(maSv, 2) + '　<span style="color:var(--accent)">MA' + _state.longP + '</span> ' + _fmt(maLv, 2) + '</div>' +
        (M ? '<div>MACD柱 ' + _fmt(M.hist[idx], 2) + '</div>' : '') +
        (R && R[idx] !== null ? '<div>RSI14 ' + _fmt(R[idx], 1) + '</div>' : '') +
        (sigHere ? '<div class="ta-tip-sig ' + sigHere.type + '">' + (sigHere.type === 'golden' ? '▲ 金叉信号点' : '▼ 死叉信号点') + ' ' + _fmt(sigHere.price, 2) + '</div>' : '');

      /* 定位（限制在容器内） */
      var wrap = canvas.parentElement;
      var rect = wrap.getBoundingClientRect();
      var cx = (evt.touches && evt.touches.length > 0 ? evt.touches[0].clientX : evt.clientX) - rect.left;
      var cy = (evt.touches && evt.touches.length > 0 ? evt.touches[0].clientY : evt.clientY) - rect.top;
      tip.style.left = Math.min(Math.max(cx + 14, 4), rect.width - 150) + 'px';
      tip.style.top = Math.min(Math.max(cy - 20, 4), rect.height - 130) + 'px';
    }

    canvas.addEventListener('mousemove', function(e) {
      var idx = locate(e);
      if (idx >= 0) { _state.hoverIdx = idx; showTip(idx, e); renderChart(); }
    }, false);
    canvas.addEventListener('mouseleave', function() {
      _state.hoverIdx = -1;
      tip.className = 'ta-tip';
      renderChart();
    }, false);
    canvas.addEventListener('click', function(e) {
      var idx = locate(e);
      if (idx < 0) return;
      _state.pinnedIdx = (_state.pinnedIdx === idx) ? -1 : idx;
      showTip(_state.pinnedIdx >= 0 ? _state.pinnedIdx : idx, e);
      renderChart();
    }, false);
    /* 触屏：轻点查看 */
    canvas.addEventListener('touchstart', function(e) {
      var idx = locate(e);
      if (idx >= 0) { _state.hoverIdx = idx; showTip(idx, e); renderChart(); }
    }, { passive: true });
    canvas.addEventListener('touchmove', function(e) {
      var idx = locate(e);
      if (idx >= 0) { _state.hoverIdx = idx; showTip(idx, e); renderChart(); }
    }, { passive: true });
  }

  /* ---------- 数据加载 ---------- */
  function load(force) {
    if (_state.loading) return;
    if (typeof fetchKline !== 'function') {
      var st = _byId('taDataStatus');
      if (st) st.textContent = '⚠️ K线模块未就绪，请刷新页面';
      return;
    }
    _state.loading = true;
    var btn = _byId('taRefreshBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⟳ 加载中'; }
    var statusEl = _byId('taDataStatus');
    if (!_state.loaded && statusEl) statusEl.textContent = '⏳ 正在加载K线数据（首次约1秒，之后走缓存）…';

    fetchKline(_state.code, KLINE_COUNT).then(function(kd) {
      _state.kd = kd;
      _state.lastLoadAt = Date.now();
      patchRealtime();
      analyze();
      renderChart();
      renderConclusion();
      renderStats();
      checkAlert();
      _state.loaded = true;
      if (btn) { btn.disabled = false; btn.textContent = '⟳ 刷新'; }
      _state.loading = false;
    }).catch(function() {
      _state.loading = false;
      if (btn) { btn.disabled = false; btn.textContent = '⟳ 刷新'; }
      var canvas = _byId('taChartCanvas');
      if (canvas && !_state.loaded) {
        var dpr = window.devicePixelRatio || 1;
        var w = canvas.clientWidth || 600, h = 330;
        canvas.width = w * dpr; canvas.height = h * dpr;
        var ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = 'rgba(140,152,170,0.9)';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('⚠️ K线获取失败，点击「刷新」重试', w / 2, h / 2);
      }
      if (statusEl) statusEl.textContent = '⚠️ K线数据获取失败';
      if (showToast) showToast('⚠️ 技术分析K线获取失败，请稍后刷新');
    });
  }

  /** 轻量刷新：不拉网络，仅用最新实时行情重算重绘（60秒级） */
  function lightRefresh() {
    if (!_state.loaded || _state.loading) return;
    var sec = _byId('foldTA');
    if (!sec || sec.classList.contains('fold-closed')) return;
    if (typeof document.hidden !== 'undefined' && document.hidden) return;
    if (patchRealtime() || true) {
      analyze();
      renderChart();
      renderConclusion();
      renderStats();
      checkAlert();
    }
  }

  /* ---------- 配置交互 ---------- */
  function applyMA(s, l, silent) {
    s = parseInt(s, 10); l = parseInt(l, 10);
    if (!(s >= 1 && l > s && l <= 250)) {
      if (showToast) showToast('⚠️ 均线参数需满足 1 ≤ 短周期 < 长周期 ≤ 250');
      var sEl = _byId('taMaShort'), lEl = _byId('taMaLong');
      if (sEl) sEl.value = _state.shortP;
      if (lEl) lEl.value = _state.longP;
      return;
    }
    _state.shortP = s; _state.longP = l;
    _saveCfg();
    if (_state.loaded) {
      analyze();
      renderChart();
      renderConclusion();
      renderStats();
      checkAlert();
    }
    if (!silent && showToast) showToast('已切换均线 MA' + s + ' / MA' + l);
  }

  function setCode(code) {
    var opt = INDEX_OPTIONS.filter(function(o) { return o.code === code; })[0];
    if (!opt) return;
    _state.code = code; _state.name = opt.name;
    _state.loaded = false;
    _saveCfg();
    load(true);
  }

  /* ---------- 初始化 ---------- */
  function init() {
    _loadCfg();

    /* 表单回填 */
    var sel = _byId('taIndexSel');
    if (sel) {
      sel.innerHTML = INDEX_OPTIONS.map(function(o) {
        return '<option value="' + o.code + '"' + (o.code === _state.code ? ' selected' : '') + '>' + o.name + '</option>';
      }).join('');
      sel.onchange = function() { setCode(sel.value); };
    }
    var sEl = _byId('taMaShort'), lEl = _byId('taMaLong');
    if (sEl) { sEl.value = _state.shortP; sEl.onchange = function() { applyMA(sEl.value, _state.longP); }; }
    if (lEl) { lEl.value = _state.longP; lEl.onchange = function() { applyMA(_state.shortP, lEl.value); }; }
    var btn = _byId('taRefreshBtn');
    if (btn) btn.onclick = function() { _state.loaded = false; load(true); };
    var applyBtn = _byId('taApplyBtn');
    if (applyBtn) applyBtn.onclick = function() { applyMA((_byId('taMaShort') || {}).value, (_byId('taMaLong') || {}).value); };
    var presets = document.querySelectorAll('.ta-preset');
    for (var p = 0; p < presets.length; p++) {
      (function(btnP) {
        btnP.onclick = function() {
          var v = btnP.getAttribute('data-ma').split('/');
          applyMA(v[0], v[1]);
          var s2 = _byId('taMaShort'), l2 = _byId('taMaLong');
          if (s2) s2.value = v[0];
          if (l2) l2.value = v[1];
        };
      })(presets[p]);
    }
    var toggle = _byId('taAlertToggle');
    if (toggle) {
      toggle.classList.toggle('off', !_alertEnabled());
      toggle.textContent = _alertEnabled() ? '🔔 提醒开' : '🔕 提醒关';
      toggle.onclick = function() { _setAlertEnabled(!_alertEnabled()); if (showToast) showToast(_alertEnabled() ? '🔔 新信号提醒已开启' : '🔕 新信号提醒已关闭'); };
    }

    bindChartEvents();

    /* 懒加载：折叠区首次展开才拉数据（保障首屏加载速度） */
    var sec = _byId('foldTA');
    if (sec) {
      _observer = new MutationObserver(function() {
        if (!sec.classList.contains('fold-closed') && !_state.loaded && !_state.loading) {
          load(false);
        }
      });
      _observer.observe(sec, { attributes: true, attributeFilter: ['class'] });
      /* 用户上次保持展开状态 → 直接加载 */
      Perf.trackedSetTimeout(function() {
        if (!sec.classList.contains('fold-closed') && !_state.loaded && !_state.loading) load(false);
      }, 400);
    }

    /* 定时器：60秒轻量重绘（实时行情修正），3分钟静默重拉 */
    _lightTimer = Perf.trackedSetInterval(lightRefresh, 60000);
    _refreshTimer = Perf.trackedSetInterval(function() {
      if (!_state.loaded || _state.loading) return;
      var sec2 = _byId('foldTA');
      if (!sec2 || sec2.classList.contains('fold-closed')) return;
      if (typeof document.hidden !== 'undefined' && document.hidden) return;
      if (Date.now() - _state.lastLoadAt > 180000) load(true);
    }, 180000);

    document.addEventListener('visibilitychange', function() {
      if (!document.hidden && _state.loaded && Date.now() - _state.lastLoadAt > 180000) {
        var sec3 = _byId('foldTA');
        if (sec3 && !sec3.classList.contains('fold-closed')) load(true);
      }
    }, false);

    /* 自适应重绘 */
    if (window.Perf && typeof Perf.onResize === 'function') {
      Perf.onResize(function() { if (_state.loaded) renderChart(); });
    } else if (window.addEventListener) {
      window.addEventListener('resize', function() { if (_state.loaded) renderChart(); }, false);
    }
  }

  /* DOM 就绪后启动（脚本 defer，此时DOM已可用） */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, false);
  } else {
    init();
  }

  /* 对外接口（HTML onclick 使用） */
  return {
    load: load,
    refresh: function() { _state.loaded = false; load(true); },
    dismissAlert: dismissAlert,
    applyMA: applyMA,
    setCode: setCode
  };
})();
