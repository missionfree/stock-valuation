'use strict';

/* ============================================================
   盘口推演：16条量价口诀量化分析引擎
   基于市场经验口诀，结合实时行情+K线+情绪数据进行量化匹配
   ============================================================ */

var PATTERN_RULES = [
  { id: 1, text: '一直小涨，会有大涨', category: 'trend', signal: 'bull', weight: 2, desc: '连续3日以上小幅上涨（涨幅<1%），蓄势待发' },
  { id: 2, text: '连续大涨，赶紧离场', category: 'trend', signal: 'bear', weight: 3, desc: '连续2日以上大幅上涨（涨幅>1.5%），短期过热' },
  { id: 3, text: '大盘跌它横着走，会小涨', category: 'relative', signal: 'bull', weight: 1, desc: '大盘下跌但个股抗跌横盘，后续补涨概率大' },
  { id: 4, text: '大盘跌它还小涨，那会大涨', category: 'relative', signal: 'bull', weight: 3, desc: '大盘下跌个股逆势上涨，强势特征明显' },
  { id: 5, text: '大盘涨它横盘，会小跌', category: 'relative', signal: 'bear', weight: 1, desc: '大盘上涨个股滞涨横盘，后续补跌概率大' },
  { id: 6, text: '大盘涨它还小跌，那会大跌', category: 'relative', signal: 'bear', weight: 3, desc: '大盘上涨个股逆势下跌，弱势特征明显' },
  { id: 7, text: '快速下跌成交量很小，是洗盘', category: 'volume', signal: 'bull', weight: 2, desc: '单日跌幅>1%但成交量萎缩，主力洗盘特征' },
  { id: 8, text: '慢慢下跌成交量大，要出货', category: 'volume', signal: 'bear', weight: 3, desc: '连续下跌且成交量放大，主力出货特征' },
  { id: 9, text: '早间低开下午大涨，是吸筹', category: 'intraday', signal: 'bull', weight: 2, desc: '开盘低于昨收，收盘高于开盘，主力吸筹' },
  { id: 10, text: '早间高开下午大跌，是出货', category: 'intraday', signal: 'bear', weight: 2, desc: '开盘高于昨收，收盘低于开盘，主力出货' },
  { id: 11, text: '上午拉高下午回落，是洗盘', category: 'intraday', signal: 'bull', weight: 1, desc: '盘中冲高回落但收盘不破开盘，洗盘特征' },
  { id: 12, text: '股价低位频繁放量，是建仓', category: 'position', signal: 'bull', weight: 3, desc: 'PE分位<30%且成交量连续放大，主力建仓' },
  { id: 13, text: '股价高位频繁放量，是出货', category: 'position', signal: 'bear', weight: 3, desc: 'PE分位>70%且成交量连续放大，主力出货' },
  { id: 14, text: '低位横盘再放量，上涨概率大', category: 'position', signal: 'bull', weight: 2, desc: 'PE分位低+近期波动率低+突然放量，突破在即' },
  { id: 15, text: '低位小涨小跌突然放量长阳，是启动', category: 'breakout', signal: 'bull', weight: 3, desc: '低位窄幅震荡后突然放量上涨>2%，启动信号' },
  { id: 16, text: '高位小涨小跌突然放量长阴，是出货', category: 'breakout', signal: 'bear', weight: 3, desc: '高位窄幅震荡后突然放量下跌>2%，出逃信号' }
];

var _paLastResult = null;
var _paLastKline = null;
var _paAnalysisLock = false;
var _paRetryCount = 0;
var _paMaxRetries = 5;
var _paWasFallback = false;

function runPatternAnalysis(forceRefresh) {
  var container = document.getElementById('paRulesList');
  if (!container) return;
  if (_paAnalysisLock) return;
  _paAnalysisLock = true;

  var btn = document.getElementById('btnPatternRefresh');
  if (btn) { btn.disabled = true; btn.textContent = '\u27f3 \u63a8\u6f14\u4e2d\u2026'; }

  // 更新数据状态指示器
  var statusEl = document.getElementById('paDataStatus');
  function setStatus(text, cls) {
    if (statusEl) { statusEl.textContent = text; statusEl.className = 'pa-data-status ' + (cls || ''); }
  }

  var rt = _lastRealtimeData || {};
  var sent = _lastSentimentData || null;
  var hasRt = rt && Object.keys(rt).length > 0;
  var hasHS300 = rt && rt['sh000300'] && (rt['sh000300'].price || rt['sh000300'].changePercent !== undefined);

  // 判断盘中/收盘/休市
  var now = new Date();
  var hour = now.getHours();
  var minutes = now.getMinutes();
  var day = now.getDay();
  var isWeekend = (day === 0 || day === 6);
  // 盘中：9:30-15:00（含午休时段，午休仍属当日盘中）
  var isMarketHours = !isWeekend && ((hour === 9 && minutes >= 30) || (hour >= 10 && hour < 15));
  // 午休：11:30-13:00（盘中但数据不更新）
  var isLunchBreak = !isWeekend && ((hour === 11 && minutes >= 30) || (hour === 12));
  // 收盘后：15:00以后
  var isAfterClose = !isWeekend && (hour >= 15);
  // 休市：周末 或 开市前(9:30前)
  var isPreMarket = !isWeekend && (hour < 9 || (hour === 9 && minutes < 30));

  // 数据未就绪：自动重试
  if (!hasRt || !hasHS300) {
    if (_paRetryCount < _paMaxRetries && !forceRefresh) {
      _paRetryCount++;
      if (container) {
        container.innerHTML = '<div class="pa-loading">\u23f3 \u6b63\u5728\u7b49\u5f85\u884c\u60c5\u6570\u636e\u52a0\u8f7d\uff08\u7b2c' + _paRetryCount + '/' + _paMaxRetries + '\u6b21\u91cd\u8bd5\uff09\u2026</div>';
      }
      setStatus('\u23f3 \u6570\u636e\u52a0\u8f7d\u4e2d(' + _paRetryCount + '/' + _paMaxRetries + ')', '');
      if (btn) { btn.disabled = false; btn.textContent = '\u27f3 \u63a8\u6f14'; }
      _paAnalysisLock = false;
      Perf.trackedSetTimeout(function() { runPatternAnalysis(false); }, 2000);
      return;
    }
    // 重试耗尽，显示数据获取失败（不再用空数据生成虚构分析）
    setStatus('⚠️ 数据获取失败', 'error');
    _paLastResult = null;
    _paWasFallback = false;
    // 重置仪表盘标签为待推演
    var _errTag = document.getElementById('paScoreTag');
    if (_errTag) { _errTag.textContent = '待推演'; _errTag.className = 'pa-gauge-tag'; }
    // 渲染错误状态而非虚构结果
    if (container) {
      container.innerHTML = '<div class="pa-error" style="padding:2rem;text-align:center;color:var(--muted)">⚠️ 行情数据获取失败，盘口推演暂不可用。请点击「推演」重试。</div>';
    }
    if (btn) { btn.disabled = false; btn.textContent = '⟳ 推演'; }
    _paAnalysisLock = false;
    _paRetryCount = 0;
    return;
  }

  // 数据就绪，重置重试计数
  _paRetryCount = 0;
  _paWasFallback = false;

  // 三态状态标签
  var marketStatus, statusClass;
  if (isMarketHours) {
    marketStatus = isLunchBreak ? '🟢 盘中推演（午休中）' : '🟢 盘中实时推演';
    statusClass = 'live';
  } else if (isAfterClose) {
    marketStatus = '🕐 收盘数据推演';
    statusClass = 'closed';
  } else {
    marketStatus = '🌙 休市数据推演';
    statusClass = 'closed';
  }
  setStatus(marketStatus, statusClass);

  // 带超时的fetchKline（8秒超时）
  var klinePromise = new Promise(function(resolve, reject) {
    var settled = false;
    var timer = Perf.trackedSetTimeout(function() {
      if (!settled) { settled = true; reject(new Error('K\u7ebf\u83b7\u53d6\u8d85\u65f6')); }
    }, 8000);
    fetchKline('sh000300', 30).then(function(data) {
      if (!settled) { settled = true; Perf.clearTimeout(timer); resolve(data); }
    }).catch(function(err) {
      if (!settled) { settled = true; Perf.clearTimeout(timer); reject(err); }
    });
  });

  klinePromise.then(function(klineData) {
    var result = analyzePatterns(rt, sent, klineData);
    _paLastResult = result;
    _paLastKline = klineData;
    renderPatternAnalysis(result);
    renderPaKlineChart(klineData, result);
    if (btn) { btn.disabled = false; btn.textContent = '\u27f3 \u63a8\u6f14'; }
    _paAnalysisLock = false;
  }).catch(function(err) {
    // K线超时或失败，仍用实时数据推演（K线相关规则跳过）
    var klineSkipSuffix = '(K线跳过)';
    if (isMarketHours) {
      setStatus((isLunchBreak ? '🟢 盘中推演（午休中）' : '🟢 盘中实时推演') + ' ' + klineSkipSuffix, 'live');
    } else if (isAfterClose) {
      setStatus('🕐 收盘数据推演 ' + klineSkipSuffix, 'closed');
    } else {
      setStatus('🌙 休市数据推演 ' + klineSkipSuffix, 'closed');
    }
    var result = analyzePatterns(rt, sent, null);
    _paLastResult = result;
    _paLastKline = null;
    renderPatternAnalysis(result);
    renderPaKlineChart(null, result);
    if (btn) { btn.disabled = false; btn.textContent = '\u27f3 \u63a8\u6f14'; }
    _paAnalysisLock = false;
  });
}

/* ============================================================
   K线图推演可视化
   在盘口推演区域渲染沪深300近30日K线+MA+信号标记
   ============================================================ */
function renderPaKlineChart(klineData, result) {
  var canvas = document.getElementById('paKlineCanvas');
  var infoEl = document.getElementById('paKlineInfo');
  if (!canvas) return;

  // 适配高DPI屏幕
  var dpr = window.devicePixelRatio || 1;
  var cssW = canvas.clientWidth || canvas.parentElement.clientWidth - 20;
  var cssH = 180;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  var ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // 无K线数据时显示提示
  if (!klineData || !klineData.klines || klineData.klines.length === 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '12px ' + (getComputedStyle(document.body).fontFamily || 'sans-serif');
    ctx.textAlign = 'center';
    ctx.fillText('K线数据加载中或获取失败，口诀推演已用实时行情兜底', cssW / 2, cssH / 2);
    if (infoEl) infoEl.textContent = '⚠️ K线数据缺失';
    return;
  }

  var klines = klineData.klines;
  var closes = klineData.closes || klines.map(function(k) { return parseFloat(k[2]) || 0; });

  // 取最近30根
  var displayCount = Math.min(30, klines.length);
  var startIdx = klines.length - displayCount;
  var displayKlines = klines.slice(startIdx);
  var displayCloses = closes.slice(startIdx);

  // 计算价格范围
  var pMin = Infinity, pMax = -Infinity;
  for (var i = 0; i < displayKlines.length; i++) {
    var k = displayKlines[i];
    var high = parseFloat(k[3]) || 0;
    var low = parseFloat(k[4]) || 0;
    if (high > pMax) pMax = high;
    if (low < pMin && low > 0) pMin = low;
  }
  if (pMin === Infinity || pMax === -Infinity) {
    if (infoEl) infoEl.textContent = '⚠️ K线数据异常';
    return;
  }
  var pRange = pMax - pMin;
  pMin -= pRange * 0.08;
  pMax += pRange * 0.08;
  pRange = pMax - pMin;

  // 布局参数
  var padL = 8, padR = 40, padT = 8, padB = 8;
  var chartW = cssW - padL - padR;
  var chartH = cssH - padT - padB;
  var volH = chartH * 0.18; // 成交量子图高度
  var priceH = chartH - volH - 4;
  var candleW = chartW / displayCount;
  var bodyW = Math.max(2, candleW * 0.6);

  // 计算MA5和MA20
  function calcMA(data, period) {
    var ma = [];
    for (var j = 0; j < data.length; j++) {
      if (j < period - 1) { ma.push(null); continue; }
      var sum = 0;
      for (var m = 0; m < period; m++) sum += data[j - m];
      ma.push(sum / period);
    }
    return ma;
  }
  // MA需要基于完整closes计算，然后截取显示部分
  var ma5Full = calcMA(closes, 5);
  var ma20Full = calcMA(closes, 20);
  var ma5 = ma5Full.slice(startIdx);
  var ma20 = ma20Full.slice(startIdx);

  // 价格→Y坐标
  function priceToY(p) {
    return padT + priceH - (p - pMin) / pRange * priceH;
  }

  // 成交量范围
  var vols = displayKlines.map(function(k) { return parseFloat(k[5]) || 0; });
  var volMax = Math.max.apply(null, vols);
  function volToY(v) {
    return padT + priceH + 4 + volH - (v / volMax) * volH;
  }

  // 1. 绘制成交量柱
  for (var vi = 0; vi < vols.length; vi++) {
    var vx = padL + vi * candleW + candleW / 2;
    var vy = volToY(vols[vi]);
    var vBottom = padT + priceH + 4 + volH;
    var kData = displayKlines[vi];
    var kOpen = parseFloat(kData[1]) || 0;
    var kClose = parseFloat(kData[2]) || 0;
    var isUp = kClose >= kOpen;
    ctx.fillStyle = isUp ? 'rgba(255, 0, 0,0.35)' : 'rgba(0, 170, 0,0.35)';
    var vw = Math.max(1, bodyW * 0.7);
    ctx.fillRect(vx - vw / 2, vy, vw, vBottom - vy);
  }

  // 2. 绘制MA线
  function drawMA(maArr, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    var started = false;
    for (var mi = 0; mi < maArr.length; mi++) {
      if (maArr[mi] === null) continue;
      var mx = padL + mi * candleW + candleW / 2;
      var my = priceToY(maArr[mi]);
      if (!started) { ctx.moveTo(mx, my); started = true; }
      else ctx.lineTo(mx, my);
    }
    ctx.stroke();
  }
  drawMA(ma5, 'rgba(255,174,0,0.7)');
  drawMA(ma20, 'rgba(0,200,255,0.7)');

  // 3. 绘制K线
  for (var ci = 0; ci < displayKlines.length; ci++) {
    var ck = displayKlines[ci];
    var cOpen = parseFloat(ck[1]) || 0;
    var cClose = parseFloat(ck[2]) || 0;
    var cHigh = parseFloat(ck[3]) || 0;
    var cLow = parseFloat(ck[4]) || 0;
    var cx = padL + ci * candleW + candleW / 2;
    var isUpC = cClose >= cOpen;

    var color = isUpC ? '#FF0000' : '#00AA00';
    var fillColor = isUpC ? 'rgba(255, 0, 0,0.8)' : 'rgba(0, 170, 0,0.8)';

    // 影线
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, priceToY(cHigh));
    ctx.lineTo(cx, priceToY(cLow));
    ctx.stroke();

    // 实体
    var bodyTop = priceToY(Math.max(cOpen, cClose));
    var bodyBot = priceToY(Math.min(cOpen, cClose));
    var bodyH = Math.max(1, bodyBot - bodyTop);
    ctx.fillStyle = fillColor;
    ctx.fillRect(cx - bodyW / 2, bodyTop, bodyW, bodyH);
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.5;
    ctx.strokeRect(cx - bodyW / 2, bodyTop, bodyW, bodyH);
  }

  // 4. 信号标记（在最近一根K线上画箭头）
  if (result && result.signals && result.signals.length > 0) {
    var lastX = padL + (displayKlines.length - 1) * candleW + candleW / 2;
    var lastK = displayKlines[displayKlines.length - 1];
    var lastClose = parseFloat(lastK[2]) || 0;
    var lastY = priceToY(lastClose);

    // 找最强的信号
    var strongest = result.signals.reduce(function(prev, cur) {
      return (cur.confidence > prev.confidence) ? cur : prev;
    });
    var arrowColor = strongest.signal === 'bull' ? '#FF0000' : '#00AA00';
    var arrowY = strongest.signal === 'bull' ? lastY + 20 : lastY - 20;
    var arrowDir = strongest.signal === 'bull' ? 1 : -1; // 1=up arrow, -1=down arrow

    ctx.fillStyle = arrowColor;
    ctx.beginPath();
    if (arrowDir === 1) {
      ctx.moveTo(lastX, arrowY - 6);
      ctx.lineTo(lastX - 4, arrowY);
      ctx.lineTo(lastX + 4, arrowY);
    } else {
      ctx.moveTo(lastX, arrowY + 6);
      ctx.lineTo(lastX - 4, arrowY);
      ctx.lineTo(lastX + 4, arrowY);
    }
    ctx.closePath();
    ctx.fill();
  }

  // 5. 价格标签（右侧）
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '9px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(pMax.toFixed(0), padL + chartW + 4, padT + 8);
  ctx.fillText(((pMax + pMin) / 2).toFixed(0), padL + chartW + 4, padT + priceH / 2);
  ctx.fillText(pMin.toFixed(0), padL + chartW + 4, padT + priceH - 2);

  // 6. 最新价格线
  if (displayCloses.length > 0) {
    var lastPrice = displayCloses[displayCloses.length - 1];
    var lastPriceY = priceToY(lastPrice);
    ctx.strokeStyle = 'rgba(255,174,0,0.3)';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(padL, lastPriceY);
    ctx.lineTo(padL + chartW, lastPriceY);
    ctx.stroke();
    ctx.setLineDash([]);

    // 最新价格标签
    ctx.fillStyle = 'rgba(255,174,0,0.8)';
    ctx.font = '9px monospace';
    ctx.fillText(lastPrice.toFixed(2), padL + chartW + 4, lastPriceY + 3);
  }

  // 更新信息文本
  if (infoEl && displayCloses.length > 0) {
    var lastC = displayCloses[displayCloses.length - 1];
    var prevC = displayCloses.length > 1 ? displayCloses[displayCloses.length - 2] : lastC;
    var chg = prevC > 0 ? ((lastC - prevC) / prevC * 100) : 0;
    var ma5Val = ma5[ma5.length - 1];
    var ma20Val = ma20[ma20.length - 1];
    infoEl.textContent = '最新:' + lastC.toFixed(2) + ' (' + (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%)  MA5:' +
      (ma5Val ? ma5Val.toFixed(1) : '—') + '  MA20:' + (ma20Val ? ma20Val.toFixed(1) : '—');
  }
}

function analyzePatterns(rt, sent, klineData) {
  var signals = [];
  var hs300 = rt['sh000300'] || {};
  var price = hs300.price || 0;
  var open = hs300.open || 0;
  var high = hs300.high || 0;
  var low = hs300.low || 0;
  var prevClose = hs300.yesterdayClose || 0;
  var chgPct = hs300.changePercent || 0;
  var turnover = hs300.turnover || 0;
  var volume = hs300.volume || 0;

  var upCount = sent ? (sent.up || 0) : 0;
  var downCount = sent ? (sent.down || 0) : 0;
  var flatCount = sent ? (sent.flat || 0) : 0;
  var totalAmount = sent ? (sent.totalAmount || 0) : 0;
  var prevAmount = sent ? (sent.prevAmount || 0) : 0;
  var avg20Amount = sent ? (sent.avg20Amount || 0) : 0;
  var limitUp = sent ? (sent.limitUp || 0) : 0;
  var limitDown = sent ? (sent.limitDown || 0) : 0;

  var closes = klineData ? (klineData.closes || []) : [];
  var klines = klineData ? (klineData.klines || []) : [];
  var volumes = klines.length > 0 ? klines.map(function(k) { return parseFloat(k[5]) || 0; }) : [];

  var pePct = 50;
  // 优先使用实时动态PE分位
  if (sent && sent.hs300Pct != null) {
    // 情绪数据携带实时PE分位
    pePct = sent.hs300Pct;
  } else {
    // 回退到静态基准值（非实时，截至2026-07-24冻结数据），并尝试用实时PE动态修正
    var hs300Base = null;
    if (typeof BASE_DATA !== 'undefined') {
      for (var i = 0; i < BASE_DATA.indices.length; i++) {
        if (BASE_DATA.indices[i].code === 'sh000300') { hs300Base = BASE_DATA.indices[i]; break; }
      }
    }
    if (hs300Base) {
      // 用沪深300实时PE动态推算分位（无实时PE时calcDynamicPct自动回退到静态pct10）
      var rtHs300PE = hs300.pe || 0;
      pePct = calcDynamicPct(hs300Base.pct10, hs300Base.pe, rtHs300PE, hs300Base.peMin, hs300Base.peMax);
    }
  }

  var totalStocks = upCount + downCount + flatCount;
  var breadthChg = totalStocks > 0 ? (upCount - downCount) / totalStocks * 100 : 0;
  var breadthRatio = totalStocks > 0 ? upCount / totalStocks * 100 : 50;

  // ========== Rule 1: continuous small rises ==========
  if (closes.length >= 4) {
    var smallRiseDays = 0;
    for (var i = closes.length - 4; i < closes.length - 1; i++) {
      var dayChg = (closes[i + 1] - closes[i]) / closes[i] * 100;
      if (dayChg > 0 && dayChg < 1.0) smallRiseDays++;
    }
    if (smallRiseDays >= 3) {
      signals.push({ ruleId: 1, triggered: true, signal: 'bull', confidence: 0.7,
        detail: '近4日中有' + smallRiseDays + '日小幅上涨（<1%），蓄势待发' });
    }
  }

  // ========== Rule 2: continuous big rises ==========
  if (closes.length >= 3) {
    var bigRiseDays = 0;
    for (var j = closes.length - 3; j < closes.length - 1; j++) {
      var bigChg = (closes[j + 1] - closes[j]) / closes[j] * 100;
      if (bigChg > 1.5) bigRiseDays++;
    }
    if (bigRiseDays >= 2) {
      signals.push({ ruleId: 2, triggered: true, signal: 'bear', confidence: 0.75,
        detail: '近3日中有' + bigRiseDays + '日大幅上涨（>1.5%），短期过热风险' });
    }
  }

  // ========== Rules 3-6: relative strength (放宽阈值) ==========
  // Rule 3: 大盘跌但个股抗跌
  if (chgPct < -0.2 && breadthRatio > 35) {
    signals.push({ ruleId: 3, triggered: true, signal: 'bull', confidence: 0.55,
      detail: '大盘跌' + chgPct.toFixed(2) + '%但' + breadthRatio.toFixed(0) + '%个股上涨，多数个股抗跌' });
  }

  // Rule 4: 大盘跌但上涨家数远超下跌
  if (chgPct < -0.2 && upCount > downCount * 1.2 && downCount > 0) {
    signals.push({ ruleId: 4, triggered: true, signal: 'bull', confidence: 0.7,
      detail: '大盘跌' + chgPct.toFixed(2) + '%但上涨' + upCount + '家超过下跌' + downCount + '家' });
  }

  // Rule 5: 大盘涨但个股滞涨
  if (chgPct > 0.2 && breadthRatio < 65) {
    signals.push({ ruleId: 5, triggered: true, signal: 'bear', confidence: 0.5,
      detail: '大盘涨' + chgPct.toFixed(2) + '%但仅' + breadthRatio.toFixed(0) + '%个股上涨，多数个股滞涨' });
  }

  // Rule 6: 大盘涨但下跌家数远超上涨
  if (chgPct > 0.2 && downCount > upCount * 1.2 && upCount > 0) {
    signals.push({ ruleId: 6, triggered: true, signal: 'bear', confidence: 0.65,
      detail: '大盘涨' + chgPct.toFixed(2) + '%但下跌' + downCount + '家超过上涨' + upCount + '家' });
  }

  // ========== Rule 7: fast drop + shrinking volume = washout ==========
  if (chgPct < -0.5 && prevAmount > 0 && totalAmount > 0 && totalAmount < prevAmount * 0.95) {
    signals.push({ ruleId: 7, triggered: true, signal: 'bull', confidence: 0.6,
      detail: '今日跌' + chgPct.toFixed(2) + '%但成交量较昨日萎缩' + ((1 - totalAmount / prevAmount) * 100).toFixed(0) + '%' });
  }

  // ========== Rule 8: slow drop + increasing volume = distribution ==========
  if (closes.length >= 4) {
    var fallDays = 0;
    var volIncreasing = true;
    for (var k = closes.length - 4; k < closes.length - 1; k++) {
      var dChg = (closes[k + 1] - closes[k]) / closes[k] * 100;
      if (dChg < 0) fallDays++;
      if (volumes.length > k + 1 && volumes[k + 1] < volumes[k] * 0.95) volIncreasing = false;
    }
    if (fallDays >= 2 && volIncreasing && chgPct < 0) {
      signals.push({ ruleId: 8, triggered: true, signal: 'bear', confidence: 0.65,
        detail: '近4日有' + fallDays + '日下跌且成交量递增，出货特征' });
    }
  }

  // ========== Rule 9: low open high close = accumulation ==========
  if (prevClose > 0 && open > 0 && price > 0) {
    var openGap = (open - prevClose) / prevClose * 100;
    var intradayChg = (price - open) / open * 100;
    if (openGap < -0.1 && intradayChg > 0.2) {
      signals.push({ ruleId: 9, triggered: true, signal: 'bull', confidence: 0.6,
        detail: '低开' + openGap.toFixed(2) + '%后走高' + intradayChg.toFixed(2) + '%，吸筹特征' });
    }
  }

  // ========== Rule 10: high open low close = distribution ==========
  if (prevClose > 0 && open > 0 && price > 0) {
    var openGapUp = (open - prevClose) / prevClose * 100;
    var intradayFall = (open - price) / open * 100;
    if (openGapUp > 0.1 && intradayFall > 0.2) {
      signals.push({ ruleId: 10, triggered: true, signal: 'bear', confidence: 0.6,
        detail: '高开' + openGapUp.toFixed(2) + '%后走低' + intradayFall.toFixed(2) + '%，出货特征' });
    }
  }

  // ========== Rule 11: morning rise afternoon pullback = washout ==========
  if (open > 0 && high > 0 && price > 0) {
    var morningRise = (high - open) / open * 100;
    var afternoonFall = (high - price) / high * 100;
    if (morningRise > 0.3 && afternoonFall > 0.2 && price >= open) {
      signals.push({ ruleId: 11, triggered: true, signal: 'bull', confidence: 0.5,
        detail: '盘中冲高' + morningRise.toFixed(2) + '%后回落但收盘高于开盘，洗盘特征' });
    }
  }

  // ========== Rule 12: low position + volume = accumulation ==========
  if (pePct < 40 && avg20Amount > 0 && totalAmount > avg20Amount * 1.1) {
    signals.push({ ruleId: 12, triggered: true, signal: 'bull', confidence: 0.7,
      detail: 'PE分位' + pePct.toFixed(0) + '%（低位）+ 成交量超20日均量' + ((totalAmount / avg20Amount - 1) * 100).toFixed(0) + '%' });
  }

  // ========== Rule 13: high position + volume = distribution ==========
  if (pePct > 60 && avg20Amount > 0 && totalAmount > avg20Amount * 1.1) {
    signals.push({ ruleId: 13, triggered: true, signal: 'bear', confidence: 0.7,
      detail: 'PE分位' + pePct.toFixed(0) + '%（高位）+ 成交量超20日均量' + ((totalAmount / avg20Amount - 1) * 100).toFixed(0) + '%' });
  }

  // ========== Rule 14: low position flat + volume ==========
  if (closes.length >= 10 && pePct < 50) {
    var recent10 = closes.slice(-10);
    var maxP = Math.max.apply(null, recent10);
    var minP = Math.min.apply(null, recent10);
    var volatility = (maxP - minP) / minP * 100;
    if (volatility < 5 && avg20Amount > 0 && totalAmount > avg20Amount * 1.2) {
      signals.push({ ruleId: 14, triggered: true, signal: 'bull', confidence: 0.65,
        detail: 'PE分位' + pePct.toFixed(0) + '% + 近10日波动仅' + volatility.toFixed(1) + '% + 放量突破' });
    }
  }

  // ========== Rule 15: low position narrow range + volume + big yang = launch ==========
  if (closes.length >= 6 && pePct < 50) {
    var recent5 = closes.slice(-6, -1);
    var max5 = Math.max.apply(null, recent5);
    var min5 = Math.min.apply(null, recent5);
    var vol5 = (max5 - min5) / min5 * 100;
    var todayChg = closes.length >= 2 ? (closes[closes.length - 1] - closes[closes.length - 2]) / closes[closes.length - 2] * 100 : chgPct;
    if (vol5 < 4 && todayChg > 1.0 && avg20Amount > 0 && totalAmount > avg20Amount * 1.2) {
      signals.push({ ruleId: 15, triggered: true, signal: 'bull', confidence: 0.8,
        detail: '低位窄幅震荡（波动' + vol5.toFixed(1) + '%）后今日涨' + todayChg.toFixed(2) + '%且放量，启动信号' });
    }
  }

  // ========== Rule 16: high position narrow range + volume + big yin = exit ==========
  if (closes.length >= 6 && pePct > 50) {
    var recent5h = closes.slice(-6, -1);
    var max5h = Math.max.apply(null, recent5h);
    var min5h = Math.min.apply(null, recent5h);
    var vol5h = (max5h - min5h) / min5h * 100;
    var todayChgH = closes.length >= 2 ? (closes[closes.length - 1] - closes[closes.length - 2]) / closes[closes.length - 2] * 100 : chgPct;
    if (vol5h < 4 && todayChgH < -1.0 && avg20Amount > 0 && totalAmount > avg20Amount * 1.2) {
      signals.push({ ruleId: 16, triggered: true, signal: 'bear', confidence: 0.8,
        detail: '高位窄幅震荡（波动' + vol5h.toFixed(1) + '%）后今日跌' + todayChgH.toFixed(2) + '%且放量，出逃信号' });
    }
  }

  // ========== 基础信号：市场方向（确保非极端日也有信号触发）==========
  // 市场上涨 + 涨多跌少 = 偏多
  if (chgPct > 0.1 && breadthRatio > 55) {
    signals.push({ ruleId: 3, triggered: true, signal: 'bull', confidence: 0.45,
      detail: '大盘涨' + chgPct.toFixed(2) + '%，上涨' + upCount + '家多于下跌' + downCount + '家，市场偏强' });
  }
  // 市场下跌 + 跌多涨少 = 偏空
  if (chgPct < -0.1 && breadthRatio < 45) {
    signals.push({ ruleId: 6, triggered: true, signal: 'bear', confidence: 0.45,
      detail: '大盘跌' + chgPct.toFixed(2) + '%，下跌' + downCount + '家多于上涨' + upCount + '家，市场偏弱' });
  }
  // 放量上涨 = 多头强势
  if (chgPct > 0.3 && avg20Amount > 0 && totalAmount > avg20Amount * 1.1) {
    signals.push({ ruleId: 12, triggered: true, signal: 'bull', confidence: 0.55,
      detail: '大盘涨' + chgPct.toFixed(2) + '%且成交量超20日均量' + ((totalAmount / avg20Amount - 1) * 100).toFixed(0) + '%，多头放量' });
  }
  // 放量下跌 = 空头强势
  if (chgPct < -0.3 && avg20Amount > 0 && totalAmount > avg20Amount * 1.1) {
    signals.push({ ruleId: 13, triggered: true, signal: 'bear', confidence: 0.55,
      detail: '大盘跌' + chgPct.toFixed(2) + '%且成交量超20日均量' + ((totalAmount / avg20Amount - 1) * 100).toFixed(0) + '%，空头放量' });
  }
  // 涨停远多于跌停 = 情绪高涨
  if (limitUp > 0 && limitUp > limitDown * 2) {
    signals.push({ ruleId: 4, triggered: true, signal: 'bull', confidence: 0.6,
      detail: '涨停' + limitUp + '家远超跌停' + limitDown + '家，赚钱效应强' });
  }
  // 跌停远多于涨停 = 情绪恐慌
  if (limitDown > 0 && limitDown > limitUp * 2) {
    signals.push({ ruleId: 5, triggered: true, signal: 'bear', confidence: 0.6,
      detail: '跌停' + limitDown + '家远超涨停' + limitUp + '家，恐慌情绪蔓延' });
  }
  // 收盘价高于开盘价 = 多头日内占优
  if (open > 0 && price > open && chgPct > 0) {
    signals.push({ ruleId: 9, triggered: true, signal: 'bull', confidence: 0.4,
      detail: '收盘' + price.toFixed(2) + '高于开盘' + open.toFixed(2) + '，日内多头占优' });
  }
  // 收盘价低于开盘价 = 空头日内占优
  if (open > 0 && price < open && chgPct < 0) {
    signals.push({ ruleId: 10, triggered: true, signal: 'bear', confidence: 0.4,
      detail: '收盘' + price.toFixed(2) + '低于开盘' + open.toFixed(2) + '，日内空头占优' });
  }
  // 缩量 = 观望情绪（无论涨跌都标记为弱信号）
  if (avg20Amount > 0 && totalAmount > 0 && totalAmount < avg20Amount * 0.7) {
    if (chgPct >= 0) {
      signals.push({ ruleId: 7, triggered: true, signal: 'bull', confidence: 0.35,
        detail: '成交量低于20日均量' + ((1 - totalAmount / avg20Amount) * 100).toFixed(0) + '%，缩量上涨抛压轻' });
    } else {
      signals.push({ ruleId: 8, triggered: true, signal: 'bear', confidence: 0.35,
        detail: '成交量低于20日均量' + ((1 - totalAmount / avg20Amount) * 100).toFixed(0) + '%，缩量下跌动能不足' });
    }
  }

  // ========== 数据状态标记（不再生成虚构兜底信号）==========
  // K线数据缺失时，仅标记数据状态，不强制生成低置信度虚构信号
  // 某分类无信号时，该分类强度保持50（中性），不添加虚假信号
  var hasKline = closes.length >= 4;

  // Calculate composite score
  var bullScore = 0, bearScore = 0;
  var triggeredCount = signals.length;

  signals.forEach(function(s) {
    var weight = PATTERN_RULES[s.ruleId - 1].weight;
    if (s.signal === 'bull') bullScore += weight * s.confidence;
    else if (s.signal === 'bear') bearScore += weight * s.confidence;
  });

  var totalScore = bullScore + bearScore;
  var netScore = bullScore - bearScore;
  var compositeScore = 50;
  if (totalScore > 0) {
    // 信号覆盖率修正：触发3条信号即不压缩，下限0.5保证单信号也保留50%信号强度
    var coverageFactor = Math.min(1, Math.max(0.5, triggeredCount / 3));
    var rawScore = 50 + netScore / totalScore * 50;
    compositeScore = Math.round(50 + (rawScore - 50) * coverageFactor);
    compositeScore = Math.max(0, Math.min(100, compositeScore));
  }

  var level, levelColor, levelIcon;
  if (compositeScore >= 70) { level = '看涨'; levelColor = 'bull'; levelIcon = '📈'; }
  else if (compositeScore >= 58) { level = '偏多'; levelColor = 'bull-weak'; levelIcon = '🔅'; }
  else if (compositeScore >= 42) { level = '中性'; levelColor = 'neutral'; levelIcon = '➡️'; }
  else if (compositeScore >= 30) { level = '偏空'; levelColor = 'bear-weak'; levelIcon = '🔅'; }
  else { level = '看跌'; levelColor = 'bear'; levelIcon = '📉'; }

  var bullCount = signals.filter(function(s) { return s.signal === 'bull'; }).length;
  var bearCount = signals.filter(function(s) { return s.signal === 'bear'; }).length;

  // ========== 综合预测：融合16信号 + 历史回归 + 市场温度预警 ==========
  var comprehensive = buildComprehensivePrediction(compositeScore, sent, level, levelColor, triggeredCount);

  return {
    signals: signals, compositeScore: compositeScore, level: level,
    levelColor: levelColor, levelIcon: levelIcon,
    bullCount: bullCount, bearCount: bearCount,
    neutralCount: 16 - triggeredCount, triggeredCount: triggeredCount,
    bullScore: bullScore, bearScore: bearScore,
    comprehensive: comprehensive
  };
}

/* ============================================================
   综合预测引擎：多源数据融合算法
   融合维度：
     1. 16口诀信号（盘口推演基础分）   权重 35%-60%（动态）
     2. 历史回归预测（最小二乘法趋势）  权重  0%-25%（按置信度动态）
     3. 市场温度+预警信号（情绪+顶底）  权重 25%-40%（动态）
   设计理念：
     - 单一信号源易失准，多源交叉验证提高准确率
     - 回归预测置信度低时自动降权，避免噪声干扰
     - 预警信号作为修正因子，捕捉极端市场状态
   ============================================================ */
function buildComprehensivePrediction(patternScore, sent, patternLevel, patternLevelColor, triggeredCount) {
  // ---- 维度1：16口诀信号（基础分，已有） ----
  var patternWeight = 0.40;

  // ---- 维度2：历史回归预测 ----
  var regressionWeight = 0.25;
  var regressionData = null;
  var regressionScore = 50;
  var regressionConfidence = 0;
  var regressionAvailable = false;

  if (typeof predictSentimentTrend === 'function') {
    try {
      regressionData = predictSentimentTrend();
      if (regressionData && regressionData.confidence > 0) {
        regressionScore = regressionData.predicted;
        regressionConfidence = regressionData.confidence; // 0-3
        regressionAvailable = true;
        // 置信度越低，权重越小（转移给patternScore）
        if (regressionConfidence === 1) {
          regressionWeight = 0.15;
          patternWeight = 0.50;
        }
      } else {
        // 无有效回归数据
        regressionWeight = 0;
        patternWeight = 0.55;
      }
    } catch(e) {
      regressionWeight = 0;
      patternWeight = 0.55;
    }
  } else {
    regressionWeight = 0;
    patternWeight = 0.55;
  }

  // ---- 维度3：市场温度 + 预警信号 ----
  var sentimentWeight = 1 - patternWeight - regressionWeight;
  var sentimentScore = 50;
  var warnings = [];
  var warningImpact = 0;
  var warningDetails = [];

  if (sent && typeof sent === 'object') {
    sentimentScore = sent.score || 50;

    // 获取预警信号
    if (typeof checkEarlyWarnings === 'function') {
      try {
        warnings = checkEarlyWarnings(sent) || [];
      } catch(e) {
        warnings = [];
      }
    }

    // 预警对分数的修正
    warnings.forEach(function(w) {
      if (w.type === 'bottom') {
        // 底部预警：市场超卖，反弹概率增大 → 向上修正
        var boost = w.level === 'extreme' ? 18 : w.level === 'high' ? 12 : 6;
        warningImpact += boost;
        warningDetails.push({
          icon: w.icon, label: w.label, level: w.level,
          detail: w.detail, impact: '+' + boost,
          direction: 'bull'
        });
      } else if (w.type === 'top') {
        // 顶部预警：市场过热，回调风险增大 → 向下修正
        var penalty = w.level === 'extreme' ? 18 : w.level === 'high' ? 12 : 6;
        warningImpact -= penalty;
        warningDetails.push({
          icon: w.icon, label: w.label, level: w.level,
          detail: w.detail, impact: '-' + penalty,
          direction: 'bear'
        });
      } else if (w.type === 'reversal') {
        // 趋势反转：标记风险，轻微修正
        warningDetails.push({
          icon: w.icon, label: w.label, level: w.level,
          detail: w.detail, impact: '±0',
          direction: 'neutral'
        });
      }
    });

    // 预测预警（基于回归的预警）
    if (typeof generatePredictionWarning === 'function') {
      try {
        var predWarning = generatePredictionWarning();
        if (predWarning) {
          // 避免与回归数据重复计算，仅作为信息展示
          warningDetails.push({
            icon: predWarning.icon, label: predWarning.label, level: predWarning.level,
            detail: predWarning.detail, impact: '参考',
            direction: predWarning.type === 'prediction_top' ? 'bear' :
                       predWarning.type === 'prediction_bottom' ? 'bull' : 'neutral'
          });
        }
      } catch(e) { /* 忽略 */ }
    }
  }

  var sentimentAdjusted = Math.max(0, Math.min(100, sentimentScore + warningImpact));

  // ---- 综合分数计算 ----
  var comprehensiveScore = Math.round(
    patternScore * patternWeight +
    regressionScore * regressionWeight +
    sentimentAdjusted * sentimentWeight
  );

  // ---- 多源一致性分析 ----
  function getDirection(score) {
    if (score >= 58) return 'bull';
    if (score <= 42) return 'bear';
    return 'neutral';
  }

  var sources = [
    {
      name: '16口诀信号',
      icon: '⚡',
      score: patternScore,
      direction: getDirection(patternScore),
      weight: patternWeight,
      detail: patternLevel || '中性',
      available: true
    },
    {
      name: '历史回归预测',
      icon: '📈',
      score: regressionScore,
      direction: getDirection(regressionScore),
      weight: regressionWeight,
      detail: regressionData ?
        (regressionData.trend === 'strong_up' ? '强势上升' :
         regressionData.trend === 'up' ? '上升' :
         regressionData.trend === 'stable' ? '震荡' :
         regressionData.trend === 'down' ? '下降' : '强势下降') +
        '·R²=' + regressionData.rSquared + '·置信' + regressionConfidence + '/3' : '数据不足',
      available: regressionAvailable,
      data: regressionData
    },
    {
      name: '市场温度预警',
      icon: '🌡️',
      score: sentimentAdjusted,
      direction: getDirection(sentimentAdjusted),
      weight: sentimentWeight,
      detail: '温度' + sentimentScore + (warningImpact !== 0 ?
        '→修正' + (warningImpact > 0 ? '+' : '') + warningImpact : ''),
      available: !!sent,
      warnings: warningDetails
    }
  ];

  var bullSources = sources.filter(function(s) { return s.direction === 'bull'; }).length;
  var bearSources = sources.filter(function(s) { return s.direction === 'bear'; }).length;
  var neutralSources = sources.filter(function(s) { return s.direction === 'neutral'; }).length;

  // 一致性：2/3以上同向 = 高一致性
  var consensus;
  if (bullSources >= 2) consensus = 'bull-strong';
  else if (bearSources >= 2) consensus = 'bear-strong';
  else consensus = 'mixed';

  // ---- 综合评级 ----
  var compLevel, compLevelColor, compLevelIcon;
  if (comprehensiveScore >= 70) { compLevel = '看涨'; compLevelColor = 'bull'; compLevelIcon = '📈'; }
  else if (comprehensiveScore >= 58) { compLevel = '偏多'; compLevelColor = 'bull-weak'; compLevelIcon = '🔅'; }
  else if (comprehensiveScore >= 42) { compLevel = '中性'; compLevelColor = 'neutral'; compLevelIcon = '➡️'; }
  else if (comprehensiveScore >= 30) { compLevel = '偏空'; compLevelColor = 'bear-weak'; compLevelIcon = '🔅'; }
  else { compLevel = '看跌'; compLevelColor = 'bear'; compLevelIcon = '📉'; }

  // ---- 操作建议（结合一致性和预警） ----
  var action, actionCls, risk, riskCls;

  // 检查是否有极端预警
  var hasExtremeWarning = warningDetails.some(function(w) { return w.level === 'extreme'; });
  var hasTopWarning = warningDetails.some(function(w) { return w.direction === 'bear'; });
  var hasBottomWarning = warningDetails.some(function(w) { return w.direction === 'bull'; });

  if (comprehensiveScore >= 65 && consensus === 'bull-strong') {
    if (hasTopWarning) {
      action = '适度买入，但注意止盈'; actionCls = 'comp-act-buy';
      risk = '顶部预警生效中，回调风险中等'; riskCls = 'comp-risk-med';
    } else {
      action = '适合买入或加仓'; actionCls = 'comp-act-buy';
      risk = '多源信号一致看多，风险较低'; riskCls = 'comp-risk-low';
    }
  } else if (comprehensiveScore >= 58 && bullSources >= 2) {
    action = '小仓试探，逢低介入'; actionCls = 'comp-act-buy';
    risk = hasTopWarning ? '顶部预警存在，注意控制仓位' : '信号偏多但需确认'; riskCls = 'comp-risk-med';
  } else if (comprehensiveScore >= 42) {
    if (hasBottomWarning && bullSources >= 1) {
      action = '关注反弹机会，可左侧布局'; actionCls = 'comp-act-watch';
      risk = '底部信号出现但趋势未确认'; riskCls = 'comp-risk-med';
    } else {
      action = '观望为主，等待方向明确'; actionCls = 'comp-act-watch';
      risk = '多空分歧，方向不明'; riskCls = 'comp-risk-med';
    }
  } else if (comprehensiveScore >= 30 && bearSources >= 2) {
    action = '减仓或回避'; actionCls = 'comp-act-sell';
    risk = hasExtremeWarning ? '极端预警！大幅回调风险' : '多源看空，下行风险较大'; riskCls = 'comp-risk-high';
  } else {
    if (hasBottomWarning) {
      action = '不急于抄底，关注企稳信号'; actionCls = 'comp-act-watch';
      risk = '超卖区域但可能继续下探'; riskCls = 'comp-risk-high';
    } else {
      action = '空仓观望，等待企稳'; actionCls = 'comp-act-avoid';
      risk = '趋势向下，抄底风险大'; riskCls = 'comp-risk-high';
    }
  }

  // ---- 生成依据说明 ----
  var reasons = [];
  // 1. 口诀信号
  reasons.push({
      icon: '⚡', text: '16口诀信号得分' + patternScore + '（' + patternLevel + '），' +
        '触发' + (triggeredCount || 0) + '条口诀，多空比反映盘口力量'
    });
  // 2. 回归预测
  if (regressionData) {
    var trendLabel = {strong_up:'强势上升', up:'上升', stable:'震荡', down:'下降', strong_down:'强势下降'};
    reasons.push({
      icon: '📈', text: '历史回归预测：基于近' + regressionData.sampleSize + '次情绪数据，' +
        '趋势' + trendLabel[regressionData.trend] + '（斜率' + regressionData.slope + '/周期），' +
        '预测情绪指数将达' + regressionData.predicted + '，拟合优度R²=' + regressionData.rSquared +
        '，置信度' + regressionConfidence + '/3'
    });
  } else {
    reasons.push({
      icon: '📈', text: '历史回归预测：情绪历史数据不足（需≥5次记录），暂无法进行回归分析'
    });
  }
  // 3. 市场温度
  if (sent) {
    reasons.push({
      icon: '🌡️', text: '市场温度' + sentimentScore + '分' +
        (warningImpact !== 0 ? '，预警修正' + (warningImpact > 0 ? '+' : '') + warningImpact + '分→' + sentimentAdjusted + '分' : '，无预警修正')
    });
  }
  // 4. 预警详情
  warningDetails.forEach(function(w) {
    reasons.push({
      icon: w.icon, text: w.label + '（' + w.level + '）：' + w.detail + ' → 影响' + w.impact
    });
  });
  // 5. 一致性结论
  if (consensus === 'bull-strong') {
    reasons.push({
      icon: '✅', text: '多源信号一致看多（' + bullSources + '/3源偏多），综合预测可信度较高'
    });
  } else if (consensus === 'bear-strong') {
    reasons.push({
      icon: '⚠️', text: '多源信号一致看空（' + bearSources + '/3源偏空），综合预测可信度较高'
    });
  } else {
    reasons.push({
      icon: '🔄', text: '多源信号存在分歧（多' + bullSources + '/空' + bearSources + '/中' + neutralSources + '），建议谨慎操作'
    });
  }

  return {
    score: comprehensiveScore,
    level: compLevel,
    levelColor: compLevelColor,
    levelIcon: compLevelIcon,
    action: action,
    actionCls: actionCls,
    risk: risk,
    riskCls: riskCls,
    consensus: consensus,
    bullSources: bullSources,
    bearSources: bearSources,
    neutralSources: neutralSources,
    sources: sources,
    warnings: warningDetails,
    reasons: reasons,
    weights: { pattern: patternWeight, regression: regressionWeight, sentiment: sentimentWeight },
    regressionData: regressionData
  };
}

function renderPatternAnalysis(result) {
  var tagEl = document.getElementById('paScoreTag');
  var bullEl = document.getElementById('paBullCount');
  var bearEl = document.getElementById('paBearCount');
  var rulesList = document.getElementById('paRulesList');

  // ===== 1. 更新标签 =====
  if (tagEl) { tagEl.textContent = result.levelIcon + ' ' + result.level; tagEl.className = 'pa-gauge-tag pa-tag-' + result.levelColor; }
  if (bullEl) bullEl.textContent = result.bullCount;
  if (bearEl) bearEl.textContent = result.bearCount;

  // ===== 2. 仪表盘动画 =====
  var gaugeArc = document.getElementById('paGaugeArc');
  var gaugeNeedle = document.getElementById('paGaugeNeedle');
  var gaugeScore = document.getElementById('paGaugeScore');
  var gaugeLabel = document.getElementById('paGaugeLabel');
  var gaugeTicks = document.getElementById('paGaugeTicks');

  // 生成刻度（首次）
  if (gaugeTicks && gaugeTicks.children.length === 0) {
    var ticksHtml = '';
    for (var t = 0; t <= 10; t++) {
      var angle = -90 + t * 18; // -90 to +90 degrees
      var rad = angle * Math.PI / 180;
      var x1 = 100 + Math.cos(rad) * 72;
      var y1 = 115 + Math.sin(rad) * 72;
      var x2 = 100 + Math.cos(rad) * 78;
      var y2 = 115 + Math.sin(rad) * 78;
      ticksHtml += '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '"/>';
    }
    gaugeTicks.innerHTML = ticksHtml;
  }

  // 弧线填充 (377 = total arc length)
  var arcLen = 377;
  var fillLen = arcLen * (result.compositeScore / 100);
  if (gaugeArc) {
    gaugeArc.style.strokeDashoffset = arcLen - fillLen;
    gaugeArc.style.transition = 'stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)';
  }

  // 指针旋转 (-90 to +90 degrees, score 0-100 maps to -90 to +90)
  var needleAngle = -90 + (result.compositeScore / 100) * 180;
  if (gaugeNeedle) { gaugeNeedle.style.transform = 'rotate(' + needleAngle + 'deg)'; }

  // 分数数字动画
  if (gaugeScore) {
    var displayScore = 0;
    var targetScore = result.compositeScore;
    var scoreStep = Math.max(1, Math.ceil(targetScore / 30));
    var scoreTimer = Perf.trackedSetInterval(function() {
      displayScore += scoreStep;
      if (displayScore >= targetScore) {
        displayScore = targetScore;
        Perf.clearInterval(scoreTimer);
      }
      gaugeScore.textContent = displayScore;
      gaugeScore.setAttribute('fill', result.levelColor === 'bull' ? '#FF0000' : (result.levelColor === 'bear' ? '#00AA00' : (result.levelColor === 'neutral' ? '#00C8FF' : '#FFAE00')));
    }, 30);
  }
  if (gaugeLabel) { gaugeLabel.textContent = result.level; }

  // ===== 2b. 信号触发摘要环 =====
  var ssArc = document.getElementById('paSSArc');
  var ssNum = document.getElementById('paSSNum');
  var ringLen = 150.8; // 2*PI*24
  var triggeredRatio = result.triggeredCount / 16;
  if (ssArc) { ssArc.style.strokeDashoffset = ringLen * (1 - triggeredRatio); }
  if (ssNum) {
    var displayTrig = 0;
    var trigStep = Math.max(1, Math.ceil(result.triggeredCount / 10));
    var trigTimer = Perf.trackedSetInterval(function() {
      displayTrig += trigStep;
      if (displayTrig >= result.triggeredCount) { displayTrig = result.triggeredCount; Perf.clearInterval(trigTimer); }
      ssNum.textContent = displayTrig;
    }, 40);
  }

  // ===== 3. 多空力量对比条 =====
  var totalSignals = result.bullCount + result.bearCount;
  var bullPct = totalSignals > 0 ? (result.bullCount / totalSignals) * 100 : 50;
  var bearPct = 100 - bullPct;
  var powerBull = document.getElementById('paPowerBull');
  var powerBear = document.getElementById('paPowerBear');
  var powerText = document.getElementById('paPowerText');
  if (powerBull) { powerBull.style.width = bullPct + '%'; powerBull.style.transition = 'width 0.8s cubic-bezier(0.4,0,0.2,1)'; }
  if (powerBear) { powerBear.style.width = bearPct + '%'; powerBear.style.transition = 'width 0.8s cubic-bezier(0.4,0,0.2,1)'; }
  if (powerText) { powerText.textContent = result.bullCount + '涨 vs ' + result.bearCount + '跌'; }

  // ===== 4. 分类强度计算 =====
  var categories = ['trend', 'relative', 'volume', 'intraday', 'position', 'breakout'];
  var catStrength = {};
  categories.forEach(function(cat) {
    var catRules = PATTERN_RULES.filter(function(r) { return r.category === cat; });
    var catBull = 0, catBear = 0, catTotal = 0;
    catRules.forEach(function(r) {
      catTotal += r.weight;
      var sig = result.signals.filter(function(s) { return s.ruleId === r.id; })[0];
      if (sig) {
        if (sig.signal === 'bull') catBull += r.weight * sig.confidence;
        else catBear += r.weight * sig.confidence;
      }
    });
    var netScore = catTotal > 0 ? ((catBull - catBear) / catTotal * 50 + 50) : 50;
    catStrength[cat] = Math.max(0, Math.min(100, Math.round(netScore)));
  });

  // 更新分类卡片
  categories.forEach(function(cat) {
    var fillEl = document.getElementById('paCat' + cat.charAt(0).toUpperCase() + cat.slice(1));
    var valEl = document.getElementById('paCat' + cat.charAt(0).toUpperCase() + cat.slice(1) + 'Val');
    var strength = catStrength[cat];
    if (fillEl) {
      fillEl.style.width = strength + '%';
      fillEl.style.transition = 'width 1s cubic-bezier(0.4,0,0.2,1)';
      if (strength >= 58) fillEl.style.background = 'linear-gradient(90deg, rgba(255,174,0,0.4), rgba(255, 0, 0,0.7))';
      else if (strength >= 42) fillEl.style.background = 'linear-gradient(90deg, rgba(0,200,255,0.3), rgba(255,174,0,0.4))';
      else fillEl.style.background = 'linear-gradient(90deg, rgba(0, 170, 0,0.7), rgba(255,174,0,0.4))';
    }
    if (valEl) {
      var catLabel = { trend: '趋势', relative: '强弱', volume: '量价', intraday: '分时', position: '位置', breakout: '突破' }[cat];
      var arrow = strength >= 58 ? '↑' : (strength >= 42 ? '→' : '↓');
      var color = strength >= 58 ? 'var(--neon-red)' : (strength >= 42 ? 'var(--neon-cyan)' : 'var(--neon-green)');
      valEl.innerHTML = '<span style="color:' + color + '">' + arrow + '</span> ' + strength;
    }
  });

  // ===== 4b. 雷达图绘制 =====
  var radarGrid = document.getElementById('paRadarGrid');
  var radarAxes = document.getElementById('paRadarAxes');
  var radarShape = document.getElementById('paRadarShape');
  var radarDots = document.getElementById('paRadarDots');
  var radarLabels = document.getElementById('paRadarLabels');

  var catNames = ['趋势', '强弱', '量价', '分时', '位置', '突破'];
  var catKeys = ['trend', 'relative', 'volume', 'intraday', 'position', 'breakout'];
  var cx = 100, cy = 100, maxR = 68;

  // 顶点角度：从顶部开始，顺时针每60度
  var angles = [-90, -30, 30, 90, 150, 210];

  // 首次绘制网格和轴线
  if (radarGrid && radarGrid.children.length === 0) {
    // 3层网格六边形
    var gridHtml = '';
    for (var layer = 1; layer <= 3; layer++) {
      var r = maxR * layer / 3;
      var pts = [];
      for (var a = 0; a < 6; a++) {
        var rad = angles[a] * Math.PI / 180;
        pts.push((cx + r * Math.cos(rad)).toFixed(1) + ',' + (cy + r * Math.sin(rad)).toFixed(1));
      }
      var opacity = layer === 3 ? 0.12 : 0.06;
      gridHtml += '<polygon points="' + pts.join(' ') + '" fill="none" stroke="rgba(0,200,255,' + opacity + ')" stroke-width="1"/>';
    }
    radarGrid.innerHTML = gridHtml;
  }

  if (radarAxes && radarAxes.children.length === 0) {
    var axesHtml = '';
    for (var a2 = 0; a2 < 6; a2++) {
      var rad2 = angles[a2] * Math.PI / 180;
      var ex = cx + maxR * Math.cos(rad2);
      var ey = cy + maxR * Math.sin(rad2);
      axesHtml += '<line x1="' + cx + '" y1="' + cy + '" x2="' + ex.toFixed(1) + '" y2="' + ey.toFixed(1) + '"/>';
    }
    radarAxes.innerHTML = axesHtml;
  }

  if (radarLabels && radarLabels.children.length === 0) {
    var labelsHtml = '';
    for (var a3 = 0; a3 < 6; a3++) {
      var rad3 = angles[a3] * Math.PI / 180;
      var lx = cx + (maxR + 14) * Math.cos(rad3);
      var ly = cy + (maxR + 14) * Math.sin(rad3);
      labelsHtml += '<text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="middle" dominant-baseline="middle" font-size="9" font-weight="600" fill="rgba(255,255,255,0.5)">' + catNames[a3] + '</text>';
    }
    radarLabels.innerHTML = labelsHtml;
  }

  // 绘制数据多边形
  if (radarShape) {
    var dataPts = [];
    var dotsHtml = '';
    for (var d = 0; d < 6; d++) {
      var strength = catStrength[catKeys[d]] || 50;
      var dr = maxR * (strength / 100);
      var drad = angles[d] * Math.PI / 180;
      var dx = cx + dr * Math.cos(drad);
      var dy = cy + dr * Math.sin(drad);
      dataPts.push(dx.toFixed(1) + ',' + dy.toFixed(1));
      var dotColor = strength >= 58 ? '#FF0000' : (strength >= 42 ? '#00C8FF' : '#00AA00');
      dotsHtml += '<circle cx="' + dx.toFixed(1) + '" cy="' + dy.toFixed(1) + '" r="3" fill="' + dotColor + '" stroke="rgba(255,255,255,0.3)" stroke-width="0.5"/>';
    }
    radarShape.setAttribute('points', dataPts.join(' '));
    if (radarDots) { radarDots.innerHTML = dotsHtml; }
  }

  // ===== 5. 渲染综合预测面板（三源融合） =====
  renderComprehensivePanel(result.comprehensive);

  // ===== 6. 渲染口诀列表（触发优先+未触发折叠） =====
  if (!rulesList) return;

  var triggeredIds = result.signals.map(function(s) { return s.ruleId; });
  var triggeredHtml = '';
  var idleHtml = '';

  PATTERN_RULES.forEach(function(rule) {
    var triggered = triggeredIds.indexOf(rule.id) >= 0;
    var signal = triggered ? result.signals.filter(function(s) { return s.ruleId === rule.id; })[0] : null;
    var signalClass = triggered ? (rule.signal === 'bull' ? 'pa-rule-bull' : 'pa-rule-bear') : 'pa-rule-idle';
    var signalIcon = triggered ? (rule.signal === 'bull' ? '📈' : '📉') : '⚪';
    var signalBadge = triggered
      ? (rule.signal === 'bull'
        ? '<span class="pa-signal-badge pa-badge-bull">看涨</span>'
        : '<span class="pa-signal-badge pa-badge-bear">看跌</span>')
      : '';
    var catLabel = { trend: '趋势', relative: '相对强弱', volume: '量价', intraday: '分时', position: '位置', breakout: '突破' }[rule.category] || '';
    var catIcon = { trend: '📈', relative: '⚖️', volume: '📊', intraday: '🕐', position: '🎯', breakout: '🚀' }[rule.category] || '';

    var itemHtml = '<div class="pa-rule-item ' + signalClass + (triggered ? ' triggered' : '') + '">';
    itemHtml += '<div class="pa-rule-left">';
    itemHtml += '<span class="pa-rule-num">' + rule.id + '</span>';
    itemHtml += '<span class="pa-rule-icon">' + signalIcon + '</span>';
    itemHtml += '</div>';
    itemHtml += '<div class="pa-rule-body">';
    itemHtml += '<div class="pa-rule-header">';
    itemHtml += '<span class="pa-rule-text">' + rule.text + '</span>';
    itemHtml += signalBadge;
    itemHtml += '</div>';
    if (triggered && signal) {
      var confPct = Math.round(signal.confidence * 100);
      var confColor = rule.signal === 'bull' ? 'rgba(255, 0, 0,0.5)' : 'rgba(0, 170, 0,0.5)';
      itemHtml += '<div class="pa-rule-meta">';
      itemHtml += '<span class="pa-rule-cat">' + catIcon + ' ' + catLabel + '</span>';
      itemHtml += '<span class="pa-rule-weight">权重' + rule.weight + '</span>';
      itemHtml += '<span class="pa-rule-confidence">置信度' + confPct + '%</span>';
      itemHtml += '</div>';
      itemHtml += '<div class="pa-rule-detail">' + signal.detail + '</div>';
      itemHtml += '<div class="pa-conf-bar"><div class="pa-conf-fill" style="width:' + confPct + '%;background:' + confColor + '"></div></div>';
    } else {
      itemHtml += '<div class="pa-rule-meta">';
      itemHtml += '<span class="pa-rule-cat">' + catIcon + ' ' + catLabel + '</span>';
      itemHtml += '<span class="pa-rule-weight">权重' + rule.weight + '</span>';
      itemHtml += '</div>';
      itemHtml += '<div class="pa-rule-desc">' + rule.desc + '</div>';
    }
    itemHtml += '</div>';
    itemHtml += '</div>';

    if (triggered) { triggeredHtml += itemHtml; } else { idleHtml += itemHtml; }
  });

  // 组装：触发区 + 折叠的未触发区
  var finalHtml = '';
  if (triggeredHtml) {
    finalHtml += '<div class="pa-rule-section-header"><span class="pa-rsh-icon">⚡</span> 已触发信号 <span class="pa-rsh-count">' + result.triggeredCount + '</span></div>';
    finalHtml += triggeredHtml;
  }
  if (idleHtml) {
    var idleCount = 16 - result.triggeredCount;
    finalHtml += '<div class="pa-rule-toggle" id="paRuleToggle" onclick="var el=document.getElementById(\'paIdleRules\');var tg=this;el.style.display=el.style.display===\'none\'?\'block\':\'none\';tg.classList.toggle(\'expanded\')">';
    finalHtml += '<span class="pa-rt-icon">▸</span> 未触发口诀 <span class="pa-rt-count">' + idleCount + '</span> 条';
    finalHtml += '</div>';
    finalHtml += '<div class="pa-idle-rules" id="paIdleRules" style="display:none">' + idleHtml + '</div>';
  }
  if (!triggeredHtml && !idleHtml) {
    finalHtml = '<div class="pa-loading">暂无分析结果</div>';
  }

  rulesList.innerHTML = finalHtml;

  // 触发动画
  var items = rulesList.querySelectorAll('.pa-rule-item.triggered');
  items.forEach(function(item, idx) {
    item.style.opacity = '0';
    item.style.transform = 'translateY(8px)';
    Perf.trackedSetTimeout(function() {
      item.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
      item.style.opacity = '1';
      item.style.transform = 'translateY(0)';
    }, idx * 60);
  });
}

/* ============================================================
   综合预测面板渲染
   展示三源融合评分、多源一致性、操作建议、风险提示、依据说明
   ============================================================ */
function renderComprehensivePanel(comp) {
  var body = document.getElementById('paCompBody');
  if (!body) return;

  if (!comp) {
    body.innerHTML = '<div class="pa-comp-loading">⏳ 综合预测数据生成中…</div>';
    return;
  }

  var scoreColor = comp.levelColor === 'bull' ? 'var(--neon-red)' :
                   comp.levelColor === 'bear' ? 'var(--neon-green)' :
                   comp.levelColor === 'neutral' ? 'var(--neon-cyan)' : 'var(--neon-yellow)';

  var consensusText = comp.consensus === 'bull-strong' ? '多源一致看多' :
                      comp.consensus === 'bear-strong' ? '多源一致看空' : '多源信号分歧';
  var consensusColor = comp.consensus === 'bull-strong' ? 'var(--neon-red)' :
                       comp.consensus === 'bear-strong' ? 'var(--neon-green)' : 'var(--neon-yellow)';
  var consensusIcon = comp.consensus === 'bull-strong' ? '✅' :
                      comp.consensus === 'bear-strong' ? '⚠️' : '🔄';

  // === 1. 综合评分头部 ===
  var html = '';
  html += '<div class="pa-comp-score-row">';
  html += '<div class="pa-comp-score-block">';
  html += '<div class="pa-comp-score-num" style="color:' + scoreColor + '">' + comp.score + '</div>';
  html += '<div class="pa-comp-score-label">' + comp.levelIcon + ' ' + comp.level + '</div>';
  html += '</div>';
  html += '<div class="pa-comp-consensus" style="border-color:' + consensusColor + '">';
  html += '<span style="color:' + consensusColor + '">' + consensusIcon + ' ' + consensusText + '</span>';
  html += '<span class="pa-comp-src-count">多' + comp.bullSources + ' · 空' + comp.bearSources + ' · 中' + comp.neutralSources + '</span>';
  html += '</div>';
  html += '</div>';

  // === 2. 双维度：操作建议 + 风险提示 ===
  html += '<div class="pa-comp-dual-row">';
  html += '<div class="pa-comp-dual-card ' + comp.actionCls + '">';
  html += '<div class="pa-comp-dual-label">📋 操作建议</div>';
  html += '<div class="pa-comp-dual-value">' + comp.action + '</div>';
  html += '</div>';
  html += '<div class="pa-comp-dual-card ' + comp.riskCls + '">';
  html += '<div class="pa-comp-dual-label">⚠️ 风险提示</div>';
  html += '<div class="pa-comp-dual-value">' + comp.risk + '</div>';
  html += '</div>';
  html += '</div>';

  // === 3. 三源贡献分解 ===
  html += '<div class="pa-comp-sources">';
  html += '<div class="pa-comp-sources-title">📊 三源贡献分解</div>';
  comp.sources.forEach(function(src) {
    var srcColor = src.direction === 'bull' ? 'var(--neon-red)' :
                   src.direction === 'bear' ? 'var(--neon-green)' : 'var(--neon-cyan)';
    var srcArrow = src.direction === 'bull' ? '↑' :
                   src.direction === 'bear' ? '↓' : '→';
    var weightPct = Math.round(src.weight * 100);
    var scoreBarWidth = src.score;

    html += '<div class="pa-comp-source-item' + (src.available ? '' : ' unavailable') + '">';
    html += '<div class="pa-comp-src-header">';
    html += '<span class="pa-comp-src-icon">' + src.icon + '</span>';
    html += '<span class="pa-comp-src-name">' + src.name + '</span>';
    html += '<span class="pa-comp-src-weight">权重' + weightPct + '%</span>';
    html += '<span class="pa-comp-src-score" style="color:' + srcColor + '">' + srcArrow + ' ' + src.score + '</span>';
    html += '</div>';
    html += '<div class="pa-comp-src-bar">';
    html += '<div class="pa-comp-src-fill" style="width:' + scoreBarWidth + '%;background:' + srcColor + '"></div>';
    html += '</div>';
    if (src.detail) {
      html += '<div class="pa-comp-src-detail">' + src.detail + '</div>';
    }
    html += '</div>';
  });
  html += '</div>';

  // === 4. 预警信号列表 ===
  if (comp.warnings && comp.warnings.length > 0) {
    html += '<div class="pa-comp-warnings">';
    html += '<div class="pa-comp-warn-title">🚨 预警信号</div>';
    comp.warnings.forEach(function(w) {
      var wColor = w.direction === 'bull' ? 'var(--neon-red)' :
                   w.direction === 'bear' ? 'var(--neon-green)' : 'var(--neon-yellow)';
      var levelBadge = w.level === 'extreme' ? '极端' : w.level === 'high' ? '高级' : '中级';
      var levelCls = w.level === 'extreme' ? 'warn-extreme' : w.level === 'high' ? 'warn-high' : 'warn-medium';
      html += '<div class="pa-comp-warn-item ' + levelCls + '">';
      html += '<div class="pa-comp-warn-header">';
      html += '<span class="pa-comp-warn-icon">' + w.icon + '</span>';
      html += '<span class="pa-comp-warn-label">' + w.label + '</span>';
      html += '<span class="pa-comp-warn-badge ' + levelCls + '">' + levelBadge + '</span>';
      html += '<span class="pa-comp-warn-impact" style="color:' + wColor + '">' + w.impact + '</span>';
      html += '</div>';
      html += '<div class="pa-comp-warn-detail">' + w.detail + '</div>';
      html += '</div>';
    });
    html += '</div>';
  }

  // === 5. 依据说明（可折叠） ===
  html += '<div class="pa-comp-reasons-toggle" id="paReasonsToggle" onclick="var el=document.getElementById(\'paReasonsBody\');var tg=this;el.style.display=el.style.display===\'none\'?\'block\':\'none\';tg.classList.toggle(\'expanded\')">';
  html += '<span class="pa-rt-icon">▸</span> 预测依据说明 <span class="pa-rt-count">' + comp.reasons.length + '</span> 条';
  html += '</div>';
  html += '<div class="pa-comp-reasons-body" id="paReasonsBody" style="display:none">';
  comp.reasons.forEach(function(r) {
    html += '<div class="pa-comp-reason-item">';
    html += '<span class="pa-comp-reason-icon">' + r.icon + '</span>';
    html += '<span class="pa-comp-reason-text">' + r.text + '</span>';
    html += '</div>';
  });
  html += '</div>';

  body.innerHTML = html;

  // 触发入场动画
  var sourceItems = body.querySelectorAll('.pa-comp-source-item');
  sourceItems.forEach(function(item, idx) {
    item.style.opacity = '0';
    item.style.transform = 'translateX(-8px)';
    Perf.trackedSetTimeout(function() {
      item.style.transition = 'all 0.4s ease';
      item.style.opacity = '1';
      item.style.transform = 'translateX(0)';
    }, 100 + idx * 80);
  });
}
