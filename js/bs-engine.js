'use strict';

/* ============================================================
   BS-Engine 精准买卖点引擎
   ------------------------------------------------------------
   规则来源（交易纪律体系，全部量化）：

   【买点——不抄底，不猜顶，等信号】
   ① 突破买点：
      - 盘整：收盘价在20日/60日均线上方盘整≥5天（5日振幅<8%）
      - 缩量：盘整期均量 ≤ 前期高峰量×1/3
      - 放量：当日量 ≥ 前5日均量×1.5
      - 突破：当日收盘 > 盘整平台高点
      - 操作：突破当天收盘前5分钟，确认站稳后挂单
   ② 回踩买点：
      - 趋势：MA20向上且近20日涨幅≥8%（上升趋势）
      - 首次回踩：从高点回撤≤10%，回调≤5天
      - 踩线：最低价触及10日/20日均线（±1%）
      - 形态：十字星（实体/全幅<0.3）或长下影（下影≥实体2倍）
      - 缩量：当日量<昨日量×0.85 且收跌
      - 操作：次日开盘30分钟内，站稳昨日收盘价上方再进

   【卖点——把卖飞当家常便饭，不靠感觉靠规则】
   止盈三选一（提前定好）：
      - 移动止盈：从持有期最高点回撤>5% → 走
      - 均线止盈：收盘破5日线卖1/3，破10日线清仓
      - 目标止盈：+5%或+8%到价走，不恋战
   止损铁律三条（无条件走）：
      - 定额止损：单笔亏损达2%
      - 技术止损：买入逻辑被破坏（突破后跌回平台/回踩破MA20）
      - 时间止损：持仓3-5天横盘不动（涨幅<2%）
   执行：盘前写好止盈止损价，盘中碰到无脑执行
   ============================================================ */

/* ===== 工具 ===== */

function bsMA(data, n, idx) {
  if (idx + 1 < n) return null;
  var s = 0;
  for (var i = idx - n + 1; i <= idx; i++) s += data[i].close;
  return s / n;
}

function bsMAArr(data, n) {
  var out = [];
  for (var i = 0; i < data.length; i++) {
    out.push(i + 1 >= n ? bsMA(data, n, i) : null);
  }
  return out;
}

function bsPct(a, b) { return (a - b) / b * 100; }

/* ============================================================
   一、突破买点检测
   ------------------------------------------------------------
   @param data  [{date,open,close,high,low,volume}] 已过滤有效K线
   @param idx   检测日下标（通常为最后一天）
   @returns {conds:[], state, platformHigh, volNeed, ...}
   ============================================================ */
function bsDetectBreakout(data, ma20, ma60, idx) {
  var n = data.length;
  var today = data[idx];
  var res = {
    type: 'breakout',
    conds: [],
    platformHigh: null,
    volNeed: null,
    state: 'none'
  };

  if (idx < 25) { res.state = 'nodata'; return res; }

  // ---- 条件1：盘整≥5天（前5个交易日，不含检测日）----
  // 收盘站在MA20或MA60上方 + 5日振幅<8% + 单日涨跌幅温和
  var pStart = idx - 5, pEnd = idx - 1; // 盘整窗口
  var aboveCnt = 0, platHigh = -Infinity, platLow = Infinity, platVolSum = 0;
  var calm = true;
  for (var i = pStart; i <= pEnd; i++) {
    var d = data[i];
    var onMA = (ma20[i] !== null && d.close > ma20[i]) || (ma60[i] !== null && d.close > ma60[i]);
    if (onMA) aboveCnt++;
    if (d.high > platHigh) platHigh = d.high;
    if (d.low < platLow) platLow = d.low;
    platVolSum += d.volume;
    if (i > 0 && Math.abs(bsPct(d.close, data[i - 1].close)) > 4.5) calm = false; // 单日暴涨暴跌不算盘整
  }
  var platVolAvg = platVolSum / 5;
  var platRange = bsPct(platHigh, platLow);
  var cond1 = aboveCnt >= 5 && platRange < 8 && calm;
  res.platformHigh = platHigh;
  res.conds.push({
    key: 'consolidate', name: '均线上方盘整≥5天',
    met: cond1,
    detail: aboveCnt + '/5日站上均线 · 5日振幅' + platRange.toFixed(1) + '%（<8%）' + (calm ? '' : ' · 出现单日>4.5%异动')
  });

  // ---- 条件2：缩量至高峰1/3以下 ----
  // 高峰量 = 检测日前推60日（不含盘整5日）的最大单日量
  var peakVol = 0;
  for (var i2 = Math.max(0, idx - 65); i2 < pStart; i2++) {
    if (data[i2].volume > peakVol) peakVol = data[i2].volume;
  }
  var volRatioPeak = peakVol > 0 ? platVolAvg / peakVol : 1;
  var cond2 = volRatioPeak <= (1 / 3);
  res.conds.push({
    key: 'shrink', name: '盘整缩量至高峰1/3',
    met: cond2,
    detail: '盘整均量/高峰量=' + volRatioPeak.toFixed(2) + '（≤0.33）'
  });

  // ---- 条件3：当日放量（前5日均量×1.5）----
  var prev5Avg = 0;
  for (var i3 = idx - 5; i3 < idx; i3++) prev5Avg += data[i3].volume;
  prev5Avg /= 5;
  var volRatioBreak = prev5Avg > 0 ? today.volume / prev5Avg : 0;
  var cond3 = volRatioBreak >= 1.5;
  res.volNeed = prev5Avg * 1.5;
  res.volRatioBreak = volRatioBreak;
  res.conds.push({
    key: 'volume', name: '放量≥前5日均量×1.5',
    met: cond3,
    detail: '今量/前5日均量=' + volRatioBreak.toFixed(2) + '（≥1.50，需' + Math.round(res.volNeed) + '）'
  });

  // ---- 条件4：收盘突破平台高点 ----
  var cond4 = today.close > platHigh;
  res.conds.push({
    key: 'break', name: '收盘突破平台高点',
    met: cond4,
    detail: '收盘' + today.close.toFixed(2) + (cond4 ? ' > ' : ' ≤ ') + '平台高点' + platHigh.toFixed(2)
  });

  // ---- 状态判定 ----
  var metCnt = 0;
  res.conds.forEach(function(c) { if (c.met) metCnt++; });
  if (cond4 && cond3 && cond1) res.state = 'triggered';      // 突破+放量+盘整成立 = 触发
  else if (cond1 && cond2 && !cond4) res.state = 'armed';    // 已盘整缩量，只差放量突破 = 待触发
  else if (metCnt >= 3) res.state = 'forming';               // 多数条件满足 = 形成中
  else res.state = 'none';
  res.metCnt = metCnt;
  return res;
}

/* ============================================================
   二、回踩买点检测
   ============================================================ */
function bsDetectPullback(data, ma10, ma20, idx) {
  var n = data.length;
  var today = data[idx];
  var res = { type: 'pullback', conds: [], state: 'none' };

  if (idx < 25) { res.state = 'nodata'; return res; }

  // ---- 条件1：上升趋势（MA20向上 + 近20日涨幅≥8%）----
  var ma20Up = ma20[idx] !== null && ma20[idx - 5] !== null && ma20[idx] > ma20[idx - 5];
  var gain20 = bsPct(today.close, data[Math.max(0, idx - 20)].close);
  var cond1 = ma20Up && gain20 >= 8;
  res.conds.push({
    key: 'uptrend', name: '上升趋势（MA20上行+20日≥8%）',
    met: cond1,
    detail: (ma20Up ? 'MA20上行' : 'MA20走平/下行') + ' · 近20日' + (gain20 >= 0 ? '+' : '') + gain20.toFixed(1) + '%'
  });

  // ---- 条件2：首次回踩（从近期高点回撤≤10%，回调≤5天）----
  // 高点 = 前30日最高收盘；回调天数 = 距最高点交易日数
  var hiIdx = idx, hiClose = -Infinity;
  for (var i = Math.max(0, idx - 30); i <= idx; i++) {
    if (data[i].close >= hiClose) { hiClose = data[i].close; hiIdx = i; }
  }
  var drawdown = bsPct(today.close, hiClose);
  var pullDays = idx - hiIdx;
  var cond2 = drawdown <= 10 && pullDays >= 1 && pullDays <= 5;
  res.highClose = hiClose;
  res.drawdown = drawdown;
  res.pullDays = pullDays;
  res.conds.push({
    key: 'firstpull', name: '首次回踩（回撤≤10%且≤5天）',
    met: cond2,
    detail: '距高点' + pullDays + '天 · 回撤' + drawdown.toFixed(1) + '%（≤10%）'
  });

  // ---- 条件3：回踩10日/20日均线（最低价触及±1%）----
  var touch10 = ma10[idx] !== null && today.low <= ma10[idx] * 1.01;
  var touch20 = ma20[idx] !== null && today.low <= ma20[idx] * 1.01;
  var cond3 = touch10 || touch20;
  res.maTouch = touch20 ? 'MA20' : (touch10 ? 'MA10' : null);
  res.conds.push({
    key: 'touchma', name: '回踩10日/20日均线',
    met: cond3,
    detail: '今低' + today.low.toFixed(2) + (res.maTouch ? ' 触及' + res.maTouch + '（' + (touch20 ? ma20[idx] : ma10[idx]).toFixed(2) + '）' : ' 未触及MA10(' + (ma10[idx] || 0).toFixed(2) + ')/MA20(' + (ma20[idx] || 0).toFixed(2) + ')')
  });

  // ---- 条件4：十字星或长下影 ----
  var range = today.high - today.low;
  var body = Math.abs(today.close - today.open);
  var lowerShadow = Math.min(today.close, today.open) - today.low;
  var isDoji = range > 0 && body / range < 0.3;
  var isLongShadow = body > 0 ? lowerShadow >= body * 2 : range > 0 && lowerShadow >= range * 0.5;
  var cond4 = isDoji || isLongShadow;
  res.candleType = isDoji ? '十字星' : (isLongShadow ? '长下影' : '普通K线');
  res.conds.push({
    key: 'candle', name: '十字星或长下影线',
    met: cond4,
    detail: res.candleType + '（实体占比' + (range > 0 ? (body / range * 100).toFixed(0) : 0) + '%·下影' + lowerShadow.toFixed(2) + '）'
  });

  // ---- 条件5：缩量下跌 ----
  var prevVol = data[idx - 1].volume;
  var isDown = bsPct(today.close, data[idx - 1].close) < 0;
  var cond5 = isDown && today.volume < prevVol * 0.85;
  res.conds.push({
    key: 'shrinkvol', name: '缩量下跌（量<昨×0.85）',
    met: cond5,
    detail: (isDown ? '收跌' : '收涨') + ' · 今量/昨量=' + (prevVol > 0 ? (today.volume / prevVol).toFixed(2) : '—') + '（<0.85）'
  });

  // ---- 状态判定 ----
  var metCnt = 0;
  res.conds.forEach(function(c) { if (c.met) metCnt++; });
  if (cond1 && cond2 && cond3 && cond4 && cond5) res.state = 'triggered';
  else if (cond1 && cond2 && cond3 && metCnt >= 4) res.state = 'armed'; // 趋势+回踩到位，差形态/缩量确认
  else if (metCnt >= 3) res.state = 'forming';
  else res.state = 'none';
  res.metCnt = metCnt;
  return res;
}

/* ============================================================
   三、参考买点定位（卖点价格基准）
   ------------------------------------------------------------
   扫描近15个交易日：
   - 突破触发日 → entry = 该日收盘（当日收盘前挂单）
   - 回踩触发日 → entry = 次日开盘价（次日开盘30分钟站稳进场）
   无信号 → entry = 最新收盘价（模拟基准，标注）
   ============================================================ */
function bsFindEntry(data, ma10, ma20, ma60) {
  var n = data.length;
  var best = null;
  var scanStart = Math.max(25, n - 15);

  for (var idx = scanStart; idx < n; idx++) {
    var bo = bsDetectBreakout(data, ma20, ma60, idx);
    if (bo.state === 'triggered') {
      var e = { idx: idx, price: data[idx].close, date: data[idx].date, kind: 'breakout', label: '突破买点' };
      if (!best || e.idx > best.idx) best = e;
    }
    var pb = bsDetectPullback(data, ma10, ma20, idx);
    if (pb.state === 'triggered' && idx + 1 < n) {
      // 回踩信号次日进场，用次日开盘价
      var e2 = { idx: idx + 1, price: data[idx + 1].open, date: data[idx + 1].date, kind: 'pullback', label: '回踩买点' };
      if (!best || e2.idx > best.idx) best = e2;
    }
  }

  if (!best) {
    best = { idx: n - 1, price: data[n - 1].close, date: data[n - 1].date, kind: 'sim', label: '现价模拟' };
  }
  return best;
}

/* ============================================================
   四、卖点价格体系计算
   ------------------------------------------------------------
   @returns levels: [{key,name,price,mode,desc,triggered,distance}]
   ============================================================ */
function bsSellPlan(data, ma5, ma10, ma20, entry, realtimePrice) {
  var n = data.length;
  var last = data[n - 1];
  var cur = realtimePrice > 0 ? realtimePrice : last.close;
  var isSim = entry.kind === 'sim';

  // 持有期最高价（信号日至今）
  var maxHigh = -Infinity, maxClose = -Infinity;
  for (var i = entry.idx; i < n; i++) {
    if (data[i].high > maxHigh) maxHigh = data[i].high;
    if (data[i].close > maxClose) maxClose = data[i].close;
  }
  var holdDays = n - 1 - entry.idx;
  var pnl = bsPct(cur, entry.price);

  var levels = [];

  // ===== 止损铁律 =====
  // 1. 定额止损 -2%
  var stopFixed = entry.price * 0.98;
  levels.push({
    group: 'stop', key: 'fixed', name: '定额止损',
    price: stopFixed, mode: '价格',
    desc: '入场价-2%，铁律无条件走',
    triggered: cur <= stopFixed,
    distance: bsPct(cur, stopFixed)
  });
  // 2. 技术止损：买入逻辑破坏位
  //    突破买点 → 跌回平台（用信号日前5日低点）；回踩买点 → 破MA20
  var logicStop;
  if (entry.kind === 'breakout') {
    var platLow = Infinity;
    for (var i2 = entry.idx - 5; i2 < entry.idx; i2++) {
      if (data[i2].low < platLow) platLow = data[i2].low;
    }
    logicStop = platLow;
    levels.push({
      group: 'stop', key: 'logic', name: '技术止损',
      price: logicStop, mode: '价格',
      desc: '跌回突破平台下沿=买点逻辑破坏',
      triggered: cur <= logicStop,
      distance: bsPct(cur, logicStop)
    });
  } else if (entry.kind === 'pullback') {
    logicStop = (ma20[n - 1] || last.close) * 0.98;
    levels.push({
      group: 'stop', key: 'logic', name: '技术止损',
      price: logicStop, mode: '价格',
      desc: '收盘破MA20×0.98=回踩逻辑破坏',
      triggered: cur <= logicStop,
      distance: bsPct(cur, logicStop)
    });
  }
  // 3. 时间止损：3-5天横盘不动
  var timeTriggered = !isSim && holdDays >= 3 && pnl < 2;
  levels.push({
    group: 'stop', key: 'time', name: '时间止损',
    price: null, mode: '时间',
    desc: isSim ? '模拟基准不适用' : ('持有' + holdDays + '天浮盈' + pnl.toFixed(1) + '%（3-5天<2%走）'),
    triggered: timeTriggered,
    distance: null
  });

  // ===== 止盈三选一 =====
  // 1. 均线止盈：破MA5卖1/3，破MA10清仓
  var ma5v = ma5[n - 1], ma10v = ma10[n - 1];
  if (ma5v) {
    levels.push({
      group: 'tp', key: 'ma5', name: '破5日线减仓1/3',
      price: ma5v, mode: '价格',
      desc: '收盘跌破MA5(' + ma5v.toFixed(2) + ')当日卖1/3',
      triggered: last.close < ma5v,
      distance: bsPct(cur, ma5v)
    });
  }
  if (ma10v) {
    levels.push({
      group: 'tp', key: 'ma10', name: '破10日线清仓',
      price: ma10v, mode: '价格',
      desc: '收盘跌破MA10(' + ma10v.toFixed(2) + ')清仓走人',
      triggered: last.close < ma10v,
      distance: bsPct(cur, ma10v)
    });
  }
  // 2. 移动止盈：持有期最高点回撤5%
  if (maxHigh > 0) {
    var trailStop = maxHigh * 0.95;
    levels.push({
      group: 'tp', key: 'trail', name: '移动止盈',
      price: trailStop, mode: '价格',
      desc: '高点' + maxHigh.toFixed(2) + '回撤5%即走',
      triggered: cur <= trailStop,
      distance: bsPct(cur, trailStop)
    });
  }
  // 3. 目标止盈：+5% / +8%
  levels.push({
    group: 'tp', key: 't1', name: '目标止盈①',
    price: entry.price * 1.05, mode: '价格',
    desc: '入场价+5%，到价不恋战',
    triggered: cur >= entry.price * 1.05,
    distance: bsPct(cur, entry.price * 1.05)
  });
  levels.push({
    group: 'tp', key: 't2', name: '目标止盈②',
    price: entry.price * 1.08, mode: '价格',
    desc: '入场价+8%，分批止盈上限',
    triggered: cur >= entry.price * 1.08,
    distance: bsPct(cur, entry.price * 1.08)
  });

  return {
    entry: entry,
    isSim: isSim,
    levels: levels,
    cur: cur,
    pnl: pnl,
    holdDays: holdDays,
    maxHigh: maxHigh,
    maxClose: maxClose
  };
}

/* ============================================================
   五、主入口：全量分析
   ============================================================ */
function bsAnalyze(klines, code) {
  if (!klines || klines.length < 65) return null;

  var data = klines.map(function(k) {
    return {
      date: k[0],
      open: parseFloat(k[1]) || 0,
      close: parseFloat(k[2]) || 0,
      high: parseFloat(k[3]) || 0,
      low: parseFloat(k[4]) || 0,
      volume: parseFloat(k[5]) || 0
    };
  }).filter(function(d) { return d.close > 0; });

  if (data.length < 65) return null;

  var n = data.length;
  var ma5 = bsMAArr(data, 5), ma10 = bsMAArr(data, 10),
      ma20 = bsMAArr(data, 20), ma60 = bsMAArr(data, 60);

  var breakout = bsDetectBreakout(data, ma20, ma60, n - 1);
  var pullback = bsDetectPullback(data, ma10, ma20, n - 1);
  var entry = bsFindEntry(data, ma10, ma20, ma60);

  return {
    data: data, n: n,
    breakout: breakout, pullback: pullback,
    entry: entry,
    ma: { ma5: ma5[n - 1], ma10: ma10[n - 1], ma20: ma20[n - 1], ma60: ma60[n - 1] },
    last: data[n - 1]
  };
}

/* ============================================================
   六、渲染
   ============================================================ */

var BS_STATE_META = {
  triggered: { cls: 'bs-on', label: '已触发', emoji: '🚨', desc: '今日满足全部条件' },
  armed:     { cls: 'bs-armed', label: '待触发', emoji: '🎯', desc: '万事俱备，只差临门一脚' },
  forming:   { cls: 'bs-form', label: '形成中', emoji: '⏳', desc: '部分条件满足，持续观察' },
  none:      { cls: 'bs-off', label: '未形成', emoji: '💤', desc: '条件不足，继续等' },
  nodata:    { cls: 'bs-off', label: '数据不足', emoji: '—', desc: '' }
};

function renderBS(klData, stockData, realtimePrice) {
  if (!klData || !klData.klines || klData.klines.length < 65) return;

  var area = document.getElementById('stockResultArea');
  if (!area) return;
  var detailEl = area.querySelector('.stock-detail');
  if (!detailEl) return;

  var code = (stockData && (stockData.code || stockData.secCode)) || '';
  var res = bsAnalyze(klData.klines, code);
  if (!res) return;

  var last = res.last;
  var cur = realtimePrice > 0 ? realtimePrice : last.close;
  var bo = res.breakout, pb = res.pullback;
  var boMeta = BS_STATE_META[bo.state] || BS_STATE_META.none;
  var pbMeta = BS_STATE_META[pb.state] || BS_STATE_META.none;

  // ===== 总状态头 =====
  var anyTriggered = bo.state === 'triggered' || pb.state === 'triggered';
  var anyArmed = bo.state === 'armed' || pb.state === 'armed';
  var headCls = anyTriggered ? 'bs-head-trigger' : (anyArmed ? 'bs-head-armed' : 'bs-head-wait');
  var headText = anyTriggered
    ? (bo.state === 'triggered' ? '🚨 突破买点今日触发 · 收盘前5分钟确认站稳后挂单' : '🚨 回踩买点今日触发 · 次日开盘30分钟站稳昨收再进')
    : (anyArmed ? '🎯 买点待触发 · 条件就绪，盯紧触发价' : '⏳ 无买点信号 · 条件不触发，涨上天也不追');

  var html = '<div class="sd-bs"><div class="sd-section sd-bs-section">' +
    '<div class="sd-section-title">🎯 精准买卖点 <span class="bs-sub">不抄底不猜顶·条件触发式交易系统</span></div>';

  html += '<div class="bs-head ' + headCls + '"><b>' + headText + '</b></div>';

  // ===== 两大买点卡片 =====
  html += '<div class="bs-buy-grid">';

  // --- 突破买点 ---
  html += '<div class="bs-card ' + boMeta.cls + '">' +
    '<div class="bs-card-head">' +
      '<span class="bs-card-name">① 突破买点</span>' +
      '<span class="bs-state ' + boMeta.cls + '">' + boMeta.emoji + ' ' + boMeta.label + '</span>' +
    '</div>' +
    '<div class="bs-cond-list">';
  bo.conds.forEach(function(c) {
    html += '<div class="bs-cond ' + (c.met ? 'bs-cond-met' : 'bs-cond-miss') + '">' +
      '<span class="bs-cond-check">' + (c.met ? '✓' : '✗') + '</span>' +
      '<span class="bs-cond-name">' + c.name + '</span>' +
      '<span class="bs-cond-detail">' + c.detail + '</span>' +
    '</div>';
  });
  html += '</div>';
  // 触发价提示
  if (bo.state === 'armed' && bo.platformHigh) {
    html += '<div class="bs-trigger-tip">🎯 触发价 <b>' + bo.platformHigh.toFixed(2) + '</b>（放量收盘突破即买，需量≥' + Math.round(bo.volNeed) + '手）</div>';
  } else if (bo.state === 'triggered') {
    html += '<div class="bs-trigger-tip bs-trigger-hit">🚨 今日已突破平台' + bo.platformHigh.toFixed(2) + ' · <b>收盘前5分钟</b>确认站稳（收盘>' + bo.platformHigh.toFixed(2) + '）后挂单</div>';
  } else {
    html += '<div class="bs-trigger-tip bs-trigger-dim">突破当天收盘前5分钟挂单 · 确认站稳平台高点再进</div>';
  }
  html += '</div>';

  // --- 回踩买点 ---
  html += '<div class="bs-card ' + pbMeta.cls + '">' +
    '<div class="bs-card-head">' +
      '<span class="bs-card-name">② 回踩买点</span>' +
      '<span class="bs-state ' + pbMeta.cls + '">' + pbMeta.emoji + ' ' + pbMeta.label + '</span>' +
    '</div>' +
    '<div class="bs-cond-list">';
  pb.conds.forEach(function(c) {
    html += '<div class="bs-cond ' + (c.met ? 'bs-cond-met' : 'bs-cond-miss') + '">' +
      '<span class="bs-cond-check">' + (c.met ? '✓' : '✗') + '</span>' +
      '<span class="bs-cond-name">' + c.name + '</span>' +
      '<span class="bs-cond-detail">' + c.detail + '</span>' +
    '</div>';
  });
  html += '</div>';
  if (pb.state === 'triggered') {
    html += '<div class="bs-trigger-tip bs-trigger-hit">🚨 今日回踩信号成立 · <b>次日开盘30分钟内</b>站稳昨收' + last.close.toFixed(2) + '上方再进</div>';
  } else if (pb.state === 'armed') {
    html += '<div class="bs-trigger-tip">🎯 等待确认价 <b>' + last.close.toFixed(2) + '</b>（次日开盘30分钟站稳此价再进）</div>';
  } else {
    html += '<div class="bs-trigger-tip bs-trigger-dim">上升趋势首次回踩10/20日线 · 十字星/长下影+缩量跌=信号</div>';
  }
  html += '</div>';

  html += '</div>'; // /bs-buy-grid

  // ===== 卖点执行表 =====
  var plan = bsSellPlan(res.data, bsMAArr(res.data, 5), bsMAArr(res.data, 10), bsMAArr(res.data, 20), res.entry, realtimePrice);

  var entryCls = plan.isSim ? 'bs-entry-sim' : 'bs-entry-real';
  html += '<div class="bs-sell-wrap">' +
    '<div class="bs-block-title">💰 卖点执行表 <span class="bs-sub">' +
      (plan.isSim ? '现价模拟基准（无近期买点信号）' : '参考买点：' + plan.entry.label + ' ' + plan.entry.date + ' 入场 ' + plan.entry.price.toFixed(2)) +
    '</span></div>';

  html += '<div class="bs-sell-meta ' + entryCls + '">' +
    '<span>基准价 <b>' + plan.entry.price.toFixed(2) + '</b></span>' +
    '<span>现价 <b>' + plan.cur.toFixed(2) + '</b></span>' +
    '<span>浮盈 <b class="' + (plan.pnl >= 0 ? 'bs-up' : 'bs-down') + '">' + (plan.pnl >= 0 ? '+' : '') + plan.pnl.toFixed(2) + '%</b></span>' +
    (plan.isSim ? '' : '<span>持有 <b>' + plan.holdDays + '天</b></span>') +
  '</div>';

  // 止损铁律
  html += '<div class="bs-sell-group"><div class="bs-group-title bs-group-stop">🛑 止损铁律（无条件走）</div>';
  plan.levels.filter(function(l) { return l.group === 'stop'; }).forEach(function(l) {
    html += bsLevelRow(l, plan.cur);
  });
  html += '</div>';

  // 止盈三选一
  html += '<div class="bs-sell-group"><div class="bs-group-title bs-group-tp">🎯 止盈三选一（提前定好）</div>';
  plan.levels.filter(function(l) { return l.group === 'tp'; }).forEach(function(l) {
    html += bsLevelRow(l, plan.cur);
  });
  html += '</div>';

  html += '</div>'; // /bs-sell-wrap

  // ===== 执行便签 =====
  var stopFixedL = plan.levels.find(function(l) { return l.key === 'fixed'; });
  var logicL = plan.levels.find(function(l) { return l.key === 'logic'; });
  var ma5L = plan.levels.find(function(l) { return l.key === 'ma5'; });
  var ma10L = plan.levels.find(function(l) { return l.key === 'ma10'; });
  var trailL = plan.levels.find(function(l) { return l.key === 'trail'; });
  var t1L = plan.levels.find(function(l) { return l.key === 't1'; });
  var t2L = plan.levels.find(function(l) { return l.key === 't2'; });

  html += '<div class="bs-note">' +
    '<div class="bs-note-title">📌 执行便签 <span class="bs-sub">盘前写好 · 盘中碰到无脑执行</span></div>' +
    '<div class="bs-note-body">' +
      '<div class="bs-note-line"><span class="bs-note-k bs-note-stop">止损价</span><b>' +
        (stopFixedL ? stopFixedL.price.toFixed(2) : '—') + (logicL ? ' / ' + logicL.price.toFixed(2) : '') + '</b><span class="bs-note-v">碰任意一个：全走</span></div>' +
      '<div class="bs-note-line"><span class="bs-note-k bs-note-cut">减仓价</span><b>' + (ma5L ? ma5L.price.toFixed(2) : '—') + '</b><span class="bs-note-v">收盘破5日线：卖1/3</span></div>' +
      '<div class="bs-note-line"><span class="bs-note-k bs-note-clear">清仓价</span><b>' + (ma10L ? ma10L.price.toFixed(2) : '—') + (trailL ? ' / ' + trailL.price.toFixed(2) : '') + '</b><span class="bs-note-v">破10日线或回撤5%：清仓</span></div>' +
      '<div class="bs-note-line"><span class="bs-note-k bs-note-tp">目标价</span><b>' + (t1L ? t1L.price.toFixed(2) : '—') + ' / ' + (t2L ? t2L.price.toFixed(2) : '—') + '</b><span class="bs-note-v">+5%不恋战 / +8%分批走</span></div>' +
    '</div>' +
    '<div class="bs-note-foot">把等待当成一种操作 · 条件不触发，涨上天也不追</div>' +
  '</div>';

  // ===== 规则说明 =====
  html += '<div class="bs-guide">' +
    '<div class="bs-guide-text"><b>买点</b>：突破=盘整≥5天+缩量1/3+放量1.5倍破平台（收盘前5分钟进）；回踩=上升趋势首次踩10/20日线+十字星/长下影+缩量跌（次日开盘30分钟站稳昨收进）。' +
    '<b>卖点</b>：止盈三选一（移动5%回撤/破5日线卖1/3破10日线清仓/+5%~8%目标）；止损三铁律（-2%定额/逻辑破坏/3-5天横盘）。</div>' +
    '<div class="bs-disclaimer">⚠️ 规则化交易系统，信号为客观条件判定，不构成投资建议。严格止损，把卖飞当家常便饭。</div>' +
  '</div>';

  html += '</div></div>';

  // ===== 插入：STF区块之后 =====
  var existing = detailEl.querySelector('.sd-bs');
  if (existing) existing.remove();

  var tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  var bsNode = tempDiv.firstChild;

  var stfSection = detailEl.querySelector('.sd-stf');
  var ftfSection = detailEl.querySelector('.sd-ftf');
  var klineSection = detailEl.querySelector('.sd-kline');
  var addBtn = detailEl.querySelector('.sd-add-btn');

  if (stfSection && stfSection.nextSibling) {
    detailEl.insertBefore(bsNode, stfSection.nextSibling);
  } else if (stfSection) {
    detailEl.insertBefore(bsNode, addBtn || null);
  } else if (ftfSection && ftfSection.nextSibling) {
    detailEl.insertBefore(bsNode, ftfSection.nextSibling);
  } else if (klineSection && klineSection.nextSibling) {
    detailEl.insertBefore(bsNode, klineSection.nextSibling);
  } else {
    detailEl.insertBefore(bsNode, addBtn || null);
  }
}

/** 卖点价格行 */
function bsLevelRow(l, cur) {
  var priceStr = l.price !== null ? l.price.toFixed(2) : '—';
  var distStr = l.distance !== null ? ((l.distance >= 0 ? '现价高于' : '距触发') + Math.abs(l.distance).toFixed(1) + '%') : '';
  var statusHtml = l.triggered
    ? '<span class="bs-lv-status bs-lv-hit">已触发</span>'
    : '<span class="bs-lv-status bs-lv-wait">未触发</span>';
  return '<div class="bs-lv ' + (l.triggered ? 'bs-lv-triggered' : '') + '">' +
    '<span class="bs-lv-name">' + l.name + '</span>' +
    '<span class="bs-lv-price">' + priceStr + '</span>' +
    '<span class="bs-lv-desc">' + l.desc + '</span>' +
    '<span class="bs-lv-dist">' + distStr + '</span>' +
    statusHtml +
  '</div>';
}
