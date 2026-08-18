'use strict';

/* ============================================================
   FTF (Future Trend Factor) 未来趋势因子引擎
   基于历史日线级价格与成交量数据，计算0-100分标准化综合评分
   ============================================================ */

/**
 * FTF计算主函数
 * @param {Array} klines - K线数据数组, 每项: [date, open, close, high, low, volume, ...]
 * @param {number} window - 计算窗口 (60/120/180/250)
 * @returns {Array} FTF结果数组, 每项: {date, ftf, momentum, capitalFlow, breakthrough, ftfSMA3}
 */
function calculateFTF(klines, window) {
  window = window || 120;
  if (!klines || klines.length < 60) return [];

  // 解析K线数据
  var data = klines.map(function(k) {
    return {
      date: k[0],
      open: parseFloat(k[1]) || 0,
      close: parseFloat(k[2]) || 0,
      high: parseFloat(k[3]) || 0,
      low: parseFloat(k[4]) || 0,
      volume: parseFloat(k[5]) || 0
    };
  }).filter(function(d) { return d.close > 0 && d.volume > 0; });

  if (data.length < 60) return [];

  // 取最近window条数据
  if (data.length > window) {
    data = data.slice(data.length - window);
  }

  var n = data.length;
  var results = [];

  // 预计算：对数收益率序列
  var logReturns = [0]; // 第0日无收益率
  for (var i = 1; i < n; i++) {
    if (data[i - 1].close > 0) {
      logReturns.push(Math.log(data[i].close / data[i - 1].close));
    } else {
      logReturns.push(0);
    }
  }

  // 预计算：日收益率序列（用于波动率）
  var dailyReturns = [0];
  for (var i = 1; i < n; i++) {
    if (data[i - 1].close > 0) {
      dailyReturns.push((data[i].close - data[i - 1].close) / data[i - 1].close);
    } else {
      dailyReturns.push(0);
    }
  }

  // 预计算：ATR(14)
  var atrArr = calculateATR(data, 14);

  // 预计算：布林带(20日, 2倍标准差)
  var bollinger = calculateBollinger(data, 20);

  // 预计算：主力资金流向代理（基于量价模型）
  var capitalFlowProxy = calculateCapitalFlowProxy(data);

  // 预计算：换手率代理（用成交量/20日均量作为相对换手率）
  var turnoverRateProxy = calculateTurnoverRateProxy(data, 20);

  // 逐日计算FTF
  var rawFTFs = [];
  for (var i = 0; i < n; i++) {
    // 1. 动量持续性
    var momentum = calculateMomentum(logReturns, dailyReturns, i, 20);

    // 2. 资金流向强度
    var capitalFlow = calculateCapitalFlowStrength(capitalFlowProxy, turnoverRateProxy, i, 5, 60);

    // 3. 形态突破置信度
    var breakthrough = calculateBreakthrough(data, bollinger, atrArr, i);

    // 原始FTF值
    var rawFTF = 0.4 * momentum + 0.35 * capitalFlow + 0.25 * breakthrough;
    rawFTFs.push({
      date: data[i].date,
      close: data[i].close,
      rawFTF: rawFTF,
      momentum: momentum,
      capitalFlow: capitalFlow,
      breakthrough: breakthrough
    });
  }

  // Z-score标准化并映射至0-100
  var rawValues = rawFTFs.map(function(r) { return r.rawFTF; });
  var mean = rawValues.reduce(function(a, b) { return a + b; }, 0) / rawValues.length;
  var variance = rawValues.reduce(function(a, b) { return a + Math.pow(b - mean, 2); }, 0) / rawValues.length;
  var std = Math.sqrt(variance) || 1;

  for (var i = 0; i < rawFTFs.length; i++) {
    var zScore = (rawFTFs[i].rawFTF - mean) / std;
    // 映射Z-score到0-100：使用sigmoid函数确保落在[0,100]
    var ftf = Math.round(100 / (1 + Math.exp(-zScore * 1.5)));

    rawFTFs[i].ftf = ftf;
  }

  // 计算3日SMA
  for (var i = 0; i < rawFTFs.length; i++) {
    if (i >= 2) {
      rawFTFs[i].ftfSMA3 = Math.round((rawFTFs[i].ftf + rawFTFs[i - 1].ftf + rawFTFs[i - 2].ftf) / 3);
    } else {
      rawFTFs[i].ftfSMA3 = rawFTFs[i].ftf;
    }
  }

  // 计算5日变化速率
  for (var i = 0; i < rawFTFs.length; i++) {
    if (i >= 5) {
      rawFTFs[i].ftfChangeRate = (rawFTFs[i].ftf - rawFTFs[i - 5].ftf) / 5;
    } else {
      rawFTFs[i].ftfChangeRate = 0;
    }
  }

  // 峰谷波段信号检测
  var waveInfo = detectFTFWaveSignals(rawFTFs);
  rawFTFs.waveInfo = waveInfo;

  // 波段历史胜率统计
  rawFTFs.waveStats = calcFTFWaveStats(rawFTFs);

  return rawFTFs;
}

/* ============================================================
   峰谷波段信号检测引擎
   核心理念：FTF曲线自身的峰顶/谷底拐点 = 波段买卖点
   位置(超买/超卖区) × 方向(拐头) 双确认
   ============================================================ */
var FTF_WAVE = {
  PEAK_ZONE: 70,      // 峰顶区域阈值（FTF≥70进入超买区）
  VALLEY_ZONE: 30,    // 谷底区域阈值（FTF≤30进入超卖区）
  CONFIRM_DAYS: 3,    // 历史信号确认天数
  MIN_SWING: 5,       // 历史信号最小回落/反弹幅度（分）
  EARLY_SWING: 4,     // 最新拐头预警最小幅度（分）
  LOOKBACK: 10        // 最新预警回看天数
};

/**
 * 检测FTF序列的峰顶和谷底
 * @param {Array} ftfResults - calculateFTF的结果数组（会就地标记signal字段）
 * @returns {object} waveInfo - 最新拐头预警信息
 */
function detectFTFWaveSignals(ftfResults) {
  var n = ftfResults.length;
  var i, j;
  var W = FTF_WAVE;

  // 初始化信号标记
  for (i = 0; i < n; i++) {
    ftfResults[i].signal = null;  // 'peak' | 'valley'
  }

  // === 历史峰顶检测（有未来数据确认，用于图表标记） ===
  for (i = W.CONFIRM_DAYS; i < n - W.CONFIRM_DAYS; i++) {
    var v = ftfResults[i].ftf;
    if (v < W.PEAK_ZONE) continue;

    var isPeak = true;
    for (j = i - W.CONFIRM_DAYS; j < i; j++) {
      if (ftfResults[j].ftf > v) { isPeak = false; break; }
    }
    if (!isPeak) continue;
    for (j = i + 1; j <= i + W.CONFIRM_DAYS; j++) {
      if (ftfResults[j].ftf >= v) { isPeak = false; break; }
    }
    if (!isPeak) continue;

    // 确认后续回落幅度达到波段标准
    var afterMin = v;
    for (j = i + 1; j <= i + W.CONFIRM_DAYS; j++) {
      if (ftfResults[j].ftf < afterMin) afterMin = ftfResults[j].ftf;
    }
    if (v - afterMin >= W.MIN_SWING) {
      ftfResults[i].signal = 'peak';
    }
  }

  // === 历史谷底检测 ===
  for (i = W.CONFIRM_DAYS; i < n - W.CONFIRM_DAYS; i++) {
    var v = ftfResults[i].ftf;
    if (v > W.VALLEY_ZONE) continue;

    var isValley = true;
    for (j = i - W.CONFIRM_DAYS; j < i; j++) {
      if (ftfResults[j].ftf < v) { isValley = false; break; }
    }
    if (!isValley) continue;
    for (j = i + 1; j <= i + W.CONFIRM_DAYS; j++) {
      if (ftfResults[j].ftf <= v) { isValley = false; break; }
    }
    if (!isValley) continue;

    // 确认后续反弹幅度达到波段标准
    var afterMax = v;
    for (j = i + 1; j <= i + W.CONFIRM_DAYS; j++) {
      if (ftfResults[j].ftf > afterMax) afterMax = ftfResults[j].ftf;
    }
    if (afterMax - v >= W.MIN_SWING) {
      ftfResults[i].signal = 'valley';
    }
  }

  // === 最新拐头预警（无需未来数据，用于当前操作建议） ===
  var lookback = Math.min(W.LOOKBACK, n);
  var recentMax = -Infinity, recentMaxIdx = -1;
  var recentMin = Infinity, recentMinIdx = -1;
  for (i = n - lookback; i < n; i++) {
    if (ftfResults[i].ftf > recentMax) { recentMax = ftfResults[i].ftf; recentMaxIdx = i; }
    if (ftfResults[i].ftf < recentMin) { recentMin = ftfResults[i].ftf; recentMinIdx = i; }
  }

  var lastIdx = n - 1;
  var lastVal = ftfResults[lastIdx].ftf;
  var daysSinceMax = lastIdx - recentMaxIdx;
  var daysSinceMin = lastIdx - recentMinIdx;

  var peakEarlyDrop = (recentMax >= W.PEAK_ZONE - 5 && daysSinceMax >= 2) ? (recentMax - lastVal) : 0;
  var valleyEarlyRise = (recentMin <= W.VALLEY_ZONE + 5 && daysSinceMin >= 2) ? (lastVal - recentMin) : 0;

  var latestSignal = null;
  if (peakEarlyDrop >= W.EARLY_SWING && peakEarlyDrop >= valleyEarlyRise) {
    latestSignal = 'peak-early';
    if (!ftfResults[recentMaxIdx].signal) ftfResults[recentMaxIdx].signal = 'peak';
  } else if (valleyEarlyRise >= W.EARLY_SWING) {
    latestSignal = 'valley-early';
    if (!ftfResults[recentMinIdx].signal) ftfResults[recentMinIdx].signal = 'valley';
  }

  return {
    latestSignal: latestSignal,
    recentMax: recentMax, recentMaxIdx: recentMaxIdx, daysSinceMax: daysSinceMax, peakEarlyDrop: peakEarlyDrop,
    recentMin: recentMin, recentMinIdx: recentMinIdx, daysSinceMin: daysSinceMin, valleyEarlyRise: valleyEarlyRise
  };
}

/**
 * 波段历史胜率统计
 * 统计历史谷底信号后N日涨幅、峰顶信号后N日跌幅
 * @param {Array} ftfResults - 已标记signal的FTF结果
 * @returns {object} {valleyCount, peakCount, valleyWinRate, valleyAvgGain, peakWinRate, peakAvgAvoid}
 */
function calcFTFWaveStats(ftfResults) {
  var n = ftfResults.length;
  var HORIZON = 10; // 信号后10日观察期
  var stats = { valleyCount: 0, peakCount: 0, valleyWin: 0, valleyGainSum: 0, peakWin: 0, peakAvoidSum: 0 };
  var i;

  for (i = 0; i < n; i++) {
    var sig = ftfResults[i].signal;
    if (!sig || !ftfResults[i].close) continue;
    var futureIdx = i + HORIZON;
    if (futureIdx >= n) futureIdx = n - 1;
    if (futureIdx <= i) continue;

    var basePrice = ftfResults[i].close;
    var futurePrice = ftfResults[futureIdx].close;
    if (basePrice <= 0) continue;
    var pct = (futurePrice - basePrice) / basePrice * 100;

    if (sig === 'valley') {
      stats.valleyCount++;
      stats.valleyGainSum += pct;
      if (pct > 0) stats.valleyWin++;
    } else if (sig === 'peak') {
      stats.peakCount++;
      stats.peakAvoidSum += pct; // 峰顶后下跌则卖出正确
      if (pct < 0) stats.peakWin++;
    }
  }

  var waveStats = {
    valleyCount: stats.valleyCount,
    peakCount: stats.peakCount,
    valleyWinRate: stats.valleyCount > 0 ? stats.valleyWin / stats.valleyCount * 100 : 0,
    valleyAvgGain: stats.valleyCount > 0 ? stats.valleyGainSum / stats.valleyCount : 0,
    peakWinRate: stats.peakCount > 0 ? stats.peakWin / stats.peakCount * 100 : 0,
    peakAvgAvoid: stats.peakCount > 0 ? -stats.peakAvoidSum / stats.peakCount : 0 // 正值=避损幅度
  };
  return waveStats;
}

/**
 * 计算ATR(14)
 */
function calculateATR(data, period) {
  period = period || 14;
  var atr = [];
  var trSum = 0;

  for (var i = 0; i < data.length; i++) {
    var tr;
    if (i === 0) {
      tr = data[i].high - data[i].low;
    } else {
      var hl = data[i].high - data[i].low;
      var hc = Math.abs(data[i].high - data[i - 1].close);
      var lc = Math.abs(data[i].low - data[i - 1].close);
      tr = Math.max(hl, hc, lc);
    }

    if (i < period) {
      trSum += tr;
      atr.push(i === period - 1 ? trSum / period : tr);
    } else {
      // Wilder's smoothing
      atr.push((atr[i - 1] * (period - 1) + tr) / period);
    }
  }
  return atr;
}

/**
 * 计算布林带(20日, 2倍标准差)
 */
function calculateBollinger(data, period) {
  period = period || 20;
  var result = [];

  for (var i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push({ upper: null, middle: null, lower: null });
      continue;
    }

    var sum = 0;
    for (var j = 0; j < period; j++) sum += data[i - j].close;
    var ma = sum / period;

    var sqSum = 0;
    for (var j = 0; j < period; j++) {
      sqSum += Math.pow(data[i - j].close - ma, 2);
    }
    var sd = Math.sqrt(sqSum / period);

    result.push({
      upper: ma + 2 * sd,
      middle: ma,
      lower: ma - 2 * sd
    });
  }
  return result;
}

/**
 * 计算主力资金流向代理（量价模型）
 * 返回每日主力净流入金额（估算）
 */
function calculateCapitalFlowProxy(data) {
  var result = [];
  for (var i = 0; i < data.length; i++) {
    var d = data[i];
    // 典型价格
    var typicalPrice = (d.high + d.low + d.close) / 3;
    // 总资金流 = 典型价格 × 成交量(手) × 100
    var moneyFlow = typicalPrice * d.volume * 100;

    // 日内方向强度
    var range = d.high - d.low;
    var direction = range > 0.01 ? (d.close - d.open) / range : 0;
    direction = Math.max(-1, Math.min(1, direction));

    // 量比修正
    var volAvg5 = 0;
    if (i >= 5) {
      for (var j = 1; j <= 5; j++) volAvg5 += data[i - j].volume;
      volAvg5 /= 5;
    } else {
      volAvg5 = d.volume;
    }
    var volRatio = volAvg5 > 0 ? d.volume / volAvg5 : 1;
    volRatio = Math.max(0.5, Math.min(2.0, volRatio));

    // 主力净流入 = 方向 × 资金流 × 量比修正
    var mainFlow = direction * moneyFlow * volRatio;
    result.push({ mainFlow: mainFlow, totalFlow: moneyFlow });
  }
  return result;
}

/**
 * 计算换手率代理（成交量/20日均量）
 */
function calculateTurnoverRateProxy(data, period) {
  period = period || 20;
  var result = [];
  for (var i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(0);
      continue;
    }
    var volSum = 0;
    for (var j = 0; j < period; j++) volSum += data[i - j].volume;
    var avgVol = volSum / period;
    result.push(avgVol > 0 ? data[i].volume / avgVol : 0);
  }
  return result;
}

/**
 * 1. 动量持续性计算
 * 20日对数收益率线性回归斜率 × 20日波动率倒数
 */
function calculateMomentum(logReturns, dailyReturns, idx, period) {
  period = period || 20;
  if (idx < period) return 0.5;

  // 取最近period日的对数收益率
  var y = [];
  for (var i = 0; i < period; i++) {
    y.push(logReturns[idx - period + 1 + i]);
  }

  // 线性回归: y = a*x + b, x = [0, 1, ..., period-1]
  var n = period;
  var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (var i = 0; i < n; i++) {
    sumX += i;
    sumY += y[i];
    sumXY += i * y[i];
    sumX2 += i * i;
  }
  var slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

  // 20日波动率 = 日收益率标准差 × √252
  var returns20 = [];
  for (var i = 0; i < period; i++) {
    returns20.push(dailyReturns[idx - period + 1 + i]);
  }
  var retMean = returns20.reduce(function(a, b) { return a + b; }, 0) / period;
  var retVar = returns20.reduce(function(a, b) { return a + Math.pow(b - retMean, 2); }, 0) / period;
  var retStd = Math.sqrt(retVar);
  var volatility = retStd * Math.sqrt(252);

  if (volatility < 0.0001) return 0.5;

  // 动量 = 斜率 / 波动率
  var momentum = slope / volatility;

  // Sigmoid归一化到[0,1]
  return 1 / (1 + Math.exp(-momentum * 50));
}

/**
 * 2. 资金流向强度计算
 * 近5日主力净流入占总成交额比例 × 5日平均换手率，与60日中位数比较
 */
function calculateCapitalFlowStrength(capitalFlowProxy, turnoverRate, idx, shortPeriod, longPeriod) {
  shortPeriod = shortPeriod || 5;
  longPeriod = longPeriod || 60;
  if (idx < shortPeriod) return 0.5;

  // 近5日主力净流入占比 × 5日平均换手率
  var recentMetrics = [];
  for (var i = 0; i < shortPeriod; i++) {
    var ci = idx - shortPeriod + 1 + i;
    if (ci < 0 || !capitalFlowProxy[ci]) continue;
    var mainRatio = capitalFlowProxy[ci].totalFlow > 0
      ? capitalFlowProxy[ci].mainFlow / capitalFlowProxy[ci].totalFlow
      : 0;
    var turnover = turnoverRate[ci] || 0;
    recentMetrics.push(mainRatio * turnover);
  }

  if (recentMetrics.length === 0) return 0.5;
  var recentValue = recentMetrics.reduce(function(a, b) { return a + b; }, 0) / recentMetrics.length;

  // 60日中位数
  var longMetrics = [];
  var startIdx = Math.max(0, idx - longPeriod + 1);
  for (var i = startIdx; i <= idx; i++) {
    if (!capitalFlowProxy[i]) continue;
    var mainRatio = capitalFlowProxy[i].totalFlow > 0
      ? capitalFlowProxy[i].mainFlow / capitalFlowProxy[i].totalFlow
      : 0;
    var turnover = turnoverRate[i] || 0;
    longMetrics.push(mainRatio * turnover);
  }

  if (longMetrics.length === 0) return 0.5;
  longMetrics.sort(function(a, b) { return a - b; });
  var median = longMetrics[Math.floor(longMetrics.length / 2)];

  // 偏离度
  var deviation = median !== 0 ? (recentValue - median) / Math.abs(median) : recentValue;

  // Sigmoid归一化到[0,1]
  return 1 / (1 + Math.exp(-deviation * 5));
}

/**
 * 3. 形态突破置信度计算
 * 布林带上轨突破检测，突破幅度占ATR(14)倍数，上限3倍
 */
function calculateBreakthrough(data, bollinger, atr, idx) {
  if (idx < 20 || !bollinger[idx] || !bollinger[idx].upper) return 0;

  var close = data[idx].close;
  var upperBand = bollinger[idx].upper;
  var atrVal = atr[idx];

  if (atrVal < 0.0001) return 0;

  // 突破幅度
  if (close > upperBand) {
    var breakthroughAmt = (close - upperBand) / atrVal;
    // 截断至3倍ATR
    breakthroughAmt = Math.min(breakthroughAmt, 3);
    // 归一化到[0,1]
    return breakthroughAmt / 3;
  }

  // 未突破上轨，检查是否在下轨附近（超跌反弹信号）
  var lowerBand = bollinger[idx].lower;
  if (lowerBand && close < lowerBand) {
    var belowAmt = (lowerBand - close) / atrVal;
    belowAmt = Math.min(belowAmt, 3);
    // 超跌时给予部分置信度（反弹预期）
    return belowAmt / 3 * 0.5;
  }

  // 在布林带内部，根据位置给予中间值
  var middle = bollinger[idx].middle;
  if (middle && upperBand > lowerBand) {
    var position = (close - lowerBand) / (upperBand - lowerBand);
    return position * 0.3; // 在带内时给较低置信度
  }

  return 0;
}

/* ============================================================
   FTF 可视化渲染
   ============================================================ */

var _ftfData = null;      // 缓存当前FTF数据
var _ftfWindow = 120;     // 当前窗口大小
var _ftfCanvas = null;    // FTF画布引用
var _ftfHoverIdx = -1;    // 当前悬停索引

/**
 * 渲染FTF图表区域（在K线图下方）
 * @param {Array} ftfResults - calculateFTF返回的结果数组
 * @param {object} klineInfo - {klData, stockName, realtimePrice}
 */
function renderFTFChart(ftfResults, klineInfo) {
  _ftfData = ftfResults;
  if (!ftfResults || ftfResults.length === 0) return;

  var area = document.getElementById('stockResultArea');
  if (!area) return;
  var detailEl = area.querySelector('.stock-detail');
  if (!detailEl) return;

  // 移除已有FTF区域
  var existing = detailEl.querySelector('.sd-ftf');
  if (existing) existing.remove();

  // 在K线图后面插入FTF区域
  var klineSection = detailEl.querySelector('.sd-kline');
  var addBtn = detailEl.querySelector('.sd-add-btn');

  // 获取最新FTF值用于显示当前评级
  var lastFTF = ftfResults[ftfResults.length - 1];
  var lastScore = lastFTF.ftf;

  // === 波段评级：位置 × 方向 双维度 ===
  // 位置：超卖区(谷)/中性区/超买区(峰)
  // 方向：3日SMA斜率 + 拐头预警
  var W = FTF_WAVE;
  var waveInfo = ftfResults.waveInfo || {};
  var prevFTF = ftfResults[ftfResults.length - 2] || lastFTF;
  var smaSlope = lastFTF.ftfSMA3 - prevFTF.ftfSMA3;

  var zone, zoneText;
  if (lastScore >= W.PEAK_ZONE) { zone = 'overbought'; zoneText = '超买区(峰顶区)'; }
  else if (lastScore <= W.VALLEY_ZONE) { zone = 'oversold'; zoneText = '超卖区(谷底区)'; }
  else { zone = 'neutral'; zoneText = '中性区'; }

  var actionText, actionCls, actionEmoji;    // 操作信号
  var riskText, riskCls, riskEmoji;          // 风险提示
  var trendText;                             // 趋势描述
  var waveBadge = '';                        // 波段信号徽标

  if (zone === 'oversold' && (waveInfo.latestSignal === 'valley-early' || smaSlope > 1)) {
    // 谷底拐头向上 = 最佳买点
    actionText = '谷底信号确认，分批买入低吸'; actionCls = 'ftf-act-buy';   actionEmoji = '🔺';
    riskText = '超卖区拐头向上，反弹启动概率大'; riskCls = 'ftf-risk-low';  riskEmoji = '✅';
    trendText = '谷底反弹启动·波段买点';
    waveBadge = '<span class="ftf-wave-badge ftf-wave-buy">谷底买入</span>';
  } else if (zone === 'oversold') {
    // 低位仍在探底 = 临近谷底，准备买入（不是"不买"！）
    actionText = '临近谷底，准备资金等拐头';   actionCls = 'ftf-act-prepare'; actionEmoji = '⏳';
    riskText = '超卖区探底中，反弹渐近但未确认'; riskCls = 'ftf-risk-med'; riskEmoji = '🔍';
    trendText = '谷底区探底·等待拐头确认';
    waveBadge = '<span class="ftf-wave-badge ftf-wave-prepare">临近谷底</span>';
  } else if (zone === 'overbought' && (waveInfo.latestSignal === 'peak-early' || smaSlope < -1)) {
    // 峰顶拐头向下 = 卖点
    actionText = '峰顶信号确认，减仓卖出锁利'; actionCls = 'ftf-act-sell';  actionEmoji = '🔻';
    riskText = '超买区拐头向下，回调即将展开'; riskCls = 'ftf-risk-high'; riskEmoji = '⚠️';
    trendText = '峰顶回落启动·波段卖点';
    waveBadge = '<span class="ftf-wave-badge ftf-wave-sell">峰顶卖出</span>';
  } else if (zone === 'overbought') {
    // 高位仍在冲顶 = 临近峰顶，持有设止盈
    actionText = '临近峰顶，持有并设好止盈位'; actionCls = 'ftf-act-hold';  actionEmoji = '⚠️';
    riskText = '超买区冲顶中，随时可能见顶回落'; riskCls = 'ftf-risk-high'; riskEmoji = '⚠️';
    trendText = '峰顶区冲顶·警惕拐头';
    waveBadge = '<span class="ftf-wave-badge ftf-wave-peakhold">临近峰顶</span>';
  } else if (smaSlope > 1) {
    // 中性区上升 = 趋势上行，持有为主
    actionText = '波段上行中，持有为主可顺势加'; actionCls = 'ftf-act-hold'; actionEmoji = '📈';
    riskText = '趋势向上但未到超买，可继续持有'; riskCls = 'ftf-risk-low'; riskEmoji = '✅';
    trendText = '中性区上行·持有';
  } else if (smaSlope < -1) {
    // 中性区下降 = 回落中，等跌到谷底区再买
    actionText = '波段回落中，等跌到谷底区再买'; actionCls = 'ftf-act-watch'; actionEmoji = '📉';
    riskText = '趋势回落，耐心等待FTF≤30的谷底'; riskCls = 'ftf-risk-med'; riskEmoji = '⏱️';
    trendText = '中性区回落·等谷底信号';
  } else {
    // 中性震荡
    actionText = '方向不明，小仓试探或观望';   actionCls = 'ftf-act-watch'; actionEmoji = '👀';
    riskText = '中性震荡，等待方向选择';       riskCls = 'ftf-risk-med';  riskEmoji = '🔄';
    trendText = '中性震荡·方向待选';
  }

  // 波段统计信息条
  var waveStats = ftfResults.waveStats || {};
  var waveStatsHTML = '';
  if (waveStats.valleyCount + waveStats.peakCount > 0) {
    waveStatsHTML = '<div class="ftf-wave-stats">' +
      '<span class="ftf-ws-item">📉 本窗口谷底信号 <b>' + waveStats.valleyCount + '</b> 次</span>' +
      '<span class="ftf-ws-item">📈 谷底买入10日胜率 <b class="ftf-ws-pos">' + waveStats.valleyWinRate.toFixed(0) + '%</b></span>' +
      (waveStats.valleyCount > 0 ? '<span class="ftf-ws-item">💰 平均收益 <b class="ftf-ws-pos">+' + waveStats.valleyAvgGain.toFixed(1) + '%</b></span>' : '') +
      '<span class="ftf-ws-item">📉 峰顶信号 <b>' + waveStats.peakCount + '</b> 次</span>' +
      (waveStats.peakCount > 0 ? '<span class="ftf-ws-item">🛡️ 峰顶卖出避损 <b class="ftf-ws-neg">' + waveStats.peakAvgAvoid.toFixed(1) + '%</b></span>' : '') +
    '</div>';
  }

  // 兼容旧变量名（背景色用actionCls映射）
  var ratingCls = actionCls.replace('ftf-act-', 'ftf-rating-');

  // 生成得分详解
  var breakdownHTML = generateFTFBreakdown(lastFTF, ftfResults);

  var html = '<div class="sd-ftf"><div class="sd-section sd-ftf-section">' +
    '<div class="sd-section-title">未来趋势因子 FTF' +
      '<span class="ftf-window-switch">' +
        '<button class="ftf-win-btn" data-win="60">60日</button>' +
        '<button class="ftf-win-btn active" data-win="120">120日</button>' +
        '<button class="ftf-win-btn" data-win="180">180日</button>' +
        '<button class="ftf-win-btn" data-win="250">250日</button>' +
      '</span>' +
    '</div>' +

    // === 当前评级面板（双行：操作信号 + 风险提示） ===
    '<div class="ftf-current-panel ' + ratingCls + '-bg">' +
      '<div class="ftf-score-display">' +
        '<div class="ftf-score-num ' + ratingCls + '">' + lastScore + '</div>' +
        '<div class="ftf-score-meta">' +
          '<div class="ftf-score-label">当前FTF得分 / 100 · ' + zoneText + ' · ' + trendText + ' ' + waveBadge + '</div>' +
          '<div class="ftf-action-line ' + actionCls + '">' + actionEmoji + ' <b>操作建议：</b>' + actionText + '</div>' +
          '<div class="ftf-risk-line ' + riskCls + '">' + riskEmoji + ' <b>风险提示：</b>' + riskText + '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    // === 波段历史统计条 ===
    waveStatsHTML +

    // === 得分详解面板 ===
    breakdownHTML +

    // === 小白说明面板 ===
    '<div class="ftf-guide-panel">' +
      '<div class="ftf-guide-title">📌 一分钟看懂FTF波段操作</div>' +
      '<div class="ftf-guide-text">' +
        'FTF是一个<b>0-100分的波段位置评分</b>：<b>30以下=谷底区</b>（便宜，找买点），<b>70以上=峰顶区</b>（贵了，找卖点）。' +
        '光看位置还不够，还要等<b>拐头确认</b>——谷底拐头向上才买，峰顶拐头向下才卖。' +
      '</div>' +
      '<div class="ftf-action-table">' +
        '<div class="ftf-at-header">' +
          '<span class="ftf-at-col-score">位置+方向</span>' +
          '<span class="ftf-at-col-action">波段操作</span>' +
          '<span class="ftf-at-col-risk">说明</span>' +
        '</div>' +
        '<div class="ftf-at-row">' +
          '<span class="ftf-at-col-score ftf-act-buy">谷底区(≤30)+拐头↑</span>' +
          '<span class="ftf-at-col-action">🔺 谷底买入·分批低吸</span>' +
          '<span class="ftf-at-col-risk ftf-risk-low">✅ 反弹启动概率大</span>' +
        '</div>' +
        '<div class="ftf-at-row">' +
          '<span class="ftf-at-col-score ftf-act-prepare">谷底区(≤30)+仍探底</span>' +
          '<span class="ftf-at-col-action">⏳ 临近谷底·准备资金</span>' +
          '<span class="ftf-at-col-risk ftf-risk-med">🔍 等拐头确认再动手</span>' +
        '</div>' +
        '<div class="ftf-at-row">' +
          '<span class="ftf-at-col-score ftf-act-hold">中性区(30-70)+上行</span>' +
          '<span class="ftf-at-col-action">📈 持有为主·可顺势加</span>' +
          '<span class="ftf-at-col-risk ftf-risk-low">✅ 趋势健康</span>' +
        '</div>' +
        '<div class="ftf-at-row">' +
          '<span class="ftf-at-col-score ftf-act-watch">中性区(30-70)+回落</span>' +
          '<span class="ftf-at-col-action">📉 等跌到谷底区再买</span>' +
          '<span class="ftf-at-col-risk ftf-risk-med">⏱️ 耐心等FTF≤30</span>' +
        '</div>' +
        '<div class="ftf-at-row">' +
          '<span class="ftf-at-col-score ftf-act-sell">峰顶区(≥70)+拐头↓</span>' +
          '<span class="ftf-at-col-action">🔻 峰顶卖出·减仓锁利</span>' +
          '<span class="ftf-at-col-risk ftf-risk-high">⚠️ 回调即将展开</span>' +
        '</div>' +
        '<div class="ftf-at-row">' +
          '<span class="ftf-at-col-score ftf-act-hold">峰顶区(≥70)+仍冲顶</span>' +
          '<span class="ftf-at-col-action">⚠️ 临近峰顶·设好止盈</span>' +
          '<span class="ftf-at-col-risk ftf-risk-high">⚠️ 随时见顶回落</span>' +
        '</div>' +
      '</div>' +
      '<div class="ftf-reading-tips">' +
        '<div class="ftf-tip-row"><b>📖 怎么看图：</b></div>' +
        '<div class="ftf-tip-row">• <b>绿色▲三角</b>：历史谷底买点，红色▽三角是历史峰顶卖点</div>' +
        '<div class="ftf-tip-row">• <b>上方色带</b>：每天FTF分数的颜色，绿色=谷底区、黄色=中性、红色=峰顶区</div>' +
        '<div class="ftf-tip-row">• <b>下方折线</b>：FTF分数随时间的变化，蓝线是3日平滑线</div>' +
        '<div class="ftf-tip-row">• <b>绿色虚线(30)</b>：谷底区分界线，跌破后开始找买点</div>' +
        '<div class="ftf-tip-row">• <b>红色虚线(70)</b>：峰顶区分界线，升破后开始找卖点</div>' +
        '<div class="ftf-tip-row">• <b>鼠标悬停</b>：可查看每天的三因子贡献和波段信号</div>' +
        '<div class="ftf-tip-row" style="margin-top:0.2rem;padding-top:0.2rem;border-top:1px solid rgba(0,200,255,0.08)"><b>💡 核心理念：</b><b>低买高卖赚波段</b>。FTF降到谷底区(≤30)说明股价便宜了，拐头向上就是买点；升到峰顶区(≥70)说明涨多了，拐头向下就是卖点。买在谷底、卖在峰顶，一个完整波段就完成了。</div>' +
      '</div>' +
      '<div class="ftf-disclaimer">⚠️ FTF基于历史量价数据计算，仅供参考，不构成投资建议。过去表现不代表未来收益。</div>' +
    '</div>' +

    '<canvas id="ftfCanvas" class="sd-ftf-canvas"></canvas>' +
    '<div class="ftf-tooltip" id="ftfTooltip" style="display:none"></div>' +
    '</div></div>';

  var tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  var ftfNode = tempDiv.firstChild;

  if (klineSection && klineSection.nextSibling) {
    detailEl.insertBefore(ftfNode, klineSection.nextSibling);
  } else if (klineSection) {
    detailEl.insertBefore(ftfNode, addBtn || null);
  } else if (addBtn) {
    detailEl.insertBefore(ftfNode, addBtn);
  } else {
    detailEl.appendChild(ftfNode);
  }

  // 绑定窗口切换按钮
  var winBtns = ftfNode.querySelectorAll('.ftf-win-btn');
  winBtns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      var newWin = parseInt(btn.getAttribute('data-win'));
      if (newWin === _ftfWindow) return;

      winBtns.forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      _ftfWindow = newWin;

      // 重新计算并渲染
      if (klineInfo && klineInfo.klData && klineInfo.klData.klines) {
        var newFTF = calculateFTF(klineInfo.klData.klines, newWin);
        _ftfData = newFTF;
        drawFTFChart(newFTF);
      }
    });
  });

  // 延迟绘制
  Perf.trackedSetTimeout(function() {
    drawFTFChart(ftfResults);
    bindFTFHover(ftfResults);
  }, 80);
}

/**
 * 在canvas上绘制FTF图表
 * 布局: 上方20%为色带, 下方80%为FTF时序线
 */
function drawFTFChart(ftfResults) {
  var canvas = document.getElementById('ftfCanvas');
  if (!canvas || !ftfResults || ftfResults.length === 0) return;

  _ftfCanvas = canvas;
  var n = ftfResults.length;
  var dpr = window.devicePixelRatio || 1;
  var cw = canvas.parentElement.clientWidth - 24;
  if (cw < 200 || !cw || isNaN(cw)) cw = Math.min(window.innerWidth - 48, 800);
  if (cw < 200) cw = 200;

  // 布局：色带(20%) + FTF时序图(80%)
  var bandH = 40;                        // 色带高度
  var chartH = Math.max(100, Math.round(cw * 0.35)); // 时序图高度
  var labelH = 16;
  var ch = bandH + chartH + labelH + 8;

  canvas.width = cw * dpr;
  canvas.height = ch * dpr;
  canvas.style.width = cw + 'px';
  canvas.style.height = ch + 'px';
  var ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cw, ch);

  var padL = 4, padR = 38, padT = 4;
  var plotW = cw - padL - padR;

  // 蜡烛间距（与K线图对齐）
  var barGap = plotW / n;
  var barW = Math.max(1, barGap * 0.7);

  // === 1. 绘制色带（渐变色带）===
  var bandTop = padT;
  var bandBot = padT + bandH - 4;

  // 色带背景框
  ctx.fillStyle = 'rgba(20,28,40,0.5)';
  ctx.fillRect(padL, bandTop, plotW, bandH - 4);

  // 逐日绘制色带条
  for (var i = 0; i < n; i++) {
    var x = padL + barGap * i;
    var ftf = ftfResults[i].ftf;

    // FTF值映射颜色: 红(0)→黄(50)→绿(100)
    var color = ftfToColor(ftf);
    ctx.fillStyle = color;
    ctx.fillRect(x, bandTop, barGap + 0.5, bandH - 4);
  }

  // 色带边框
  ctx.strokeStyle = 'rgba(128,128,128,0.2)';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(padL, bandTop, plotW, bandH - 4);

  // 色带标签
  ctx.fillStyle = 'rgba(128,128,128,0.6)';
  ctx.font = '8px Monaco, monospace';
  ctx.textAlign = 'left';
  ctx.fillText('FTF色带', padL + 2, bandTop - 1);

  // === 2. 绘制FTF时序图 ===
  var chartTop = bandH + 2;
  var chartBot = chartTop + chartH;
  var chartPlotH = chartH - 4;

  // 背景
  ctx.fillStyle = 'rgba(20,28,40,0.3)';
  ctx.fillRect(padL, chartTop, plotW, chartH);

  // 网格线
  ctx.strokeStyle = 'rgba(128,128,128,0.1)';
  ctx.lineWidth = 0.5;
  for (var g = 0; g <= 4; g++) {
    var gy = chartTop + chartPlotH * g / 4;
    ctx.beginPath();
    ctx.moveTo(padL, gy);
    ctx.lineTo(padL + plotW, gy);
    ctx.stroke();
  }

  // Y轴标签 (0-100)
  ctx.fillStyle = 'rgba(128,128,128,0.6)';
  ctx.font = '8px Monaco, monospace';
  ctx.textAlign = 'left';
  for (var g = 0; g <= 4; g++) {
    var val = 100 - 25 * g;
    var gy = chartTop + chartPlotH * g / 4;
    ctx.fillText(String(val), padL + plotW + 2, gy + 3);
  }

  // === 波段区间背景：峰顶区(70-100)淡红 / 谷底区(0-30)淡绿 ===
  var y70 = chartTop + chartPlotH * (1 - 70 / 100);
  var y30 = chartTop + chartPlotH * (1 - 30 / 100);

  // 峰顶区背景（顶部到70线）
  ctx.fillStyle = 'rgba(255,0,0,0.07)';
  ctx.fillRect(padL, chartTop, plotW, y70 - chartTop);

  // 谷底区背景（30线到底部）
  ctx.fillStyle = 'rgba(0,170,0,0.07)';
  ctx.fillRect(padL, y30, plotW, chartBot - y30);

  // 峰顶分界线(70) - 红色虚线
  ctx.strokeStyle = '#D62828';
  ctx.lineWidth = 0.8;
  ctx.setLineDash([3, 2]);
  ctx.beginPath();
  ctx.moveTo(padL, y70);
  ctx.lineTo(padL + plotW, y70);
  ctx.stroke();
  ctx.fillStyle = 'rgba(214,40,40,0.7)';
  ctx.font = '7px Monaco, monospace';
  ctx.fillText('70', padL + plotW + 2, y70 - 2);

  // 谷底分界线(30) - 绿色虚线
  ctx.strokeStyle = '#2E8B57';
  ctx.lineWidth = 0.8;
  ctx.setLineDash([3, 2]);
  ctx.beginPath();
  ctx.moveTo(padL, y30);
  ctx.lineTo(padL + plotW, y30);
  ctx.stroke();
  ctx.fillStyle = 'rgba(46,139,87,0.7)';
  ctx.fillText('30', padL + plotW + 2, y30 - 2);
  ctx.setLineDash([]);

  // 区间文字标注
  ctx.fillStyle = 'rgba(255,70,70,0.5)';
  ctx.font = '8px Monaco, monospace';
  ctx.textAlign = 'left';
  ctx.fillText('峰顶区·找卖点', padL + 4, chartTop + 9);
  ctx.fillStyle = 'rgba(46,180,90,0.55)';
  ctx.fillText('谷底区·找买点', padL + 4, chartBot - 3);

  // FTF时序线 (1px, 深灰)
  ctx.strokeStyle = '#333333';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (var i = 0; i < n; i++) {
    var x = padL + barGap * i + barGap / 2;
    var y = chartTop + chartPlotH * (1 - ftfResults[i].ftf / 100);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // 3日SMA线 (1.5px, 蓝色)
  ctx.strokeStyle = '#1F77B4';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (var i = 0; i < n; i++) {
    var x = padL + barGap * i + barGap / 2;
    var y = chartTop + chartPlotH * (1 - ftfResults[i].ftfSMA3 / 100);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // === 峰谷信号三角标记 ===
  // 峰顶=红色倒三角(卖点) 谷底=绿色正三角(买点)
  for (var i = 0; i < n; i++) {
    var sig = ftfResults[i].signal;
    if (!sig) continue;
    var mx = padL + barGap * i + barGap / 2;
    var my = chartTop + chartPlotH * (1 - ftfResults[i].ftf / 100);
    var isLast = (i === n - 1);

    if (sig === 'peak') {
      // 峰顶：倒三角在线上方
      var sz = isLast ? 6 : 4.5;
      var gy = my - sz - 3;
      if (isLast) {
        ctx.shadowColor = '#FF2222';
        ctx.shadowBlur = 8;
      }
      ctx.fillStyle = '#FF2222';
      ctx.beginPath();
      ctx.moveTo(mx, gy + sz);
      ctx.lineTo(mx - sz, gy - sz);
      ctx.lineTo(mx + sz, gy - sz);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
    } else if (sig === 'valley') {
      // 谷底：正三角在线下方
      var sz = isLast ? 6 : 4.5;
      var gy = my + sz + 3;
      if (isLast) {
        ctx.shadowColor = '#00CC44';
        ctx.shadowBlur = 8;
      }
      ctx.fillStyle = '#00CC44';
      ctx.beginPath();
      ctx.moveTo(mx, gy - sz);
      ctx.lineTo(mx - sz, gy + sz);
      ctx.lineTo(mx + sz, gy + sz);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  // 图例
  ctx.font = '8px Monaco, monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#FF5555';
  ctx.fillText('▽峰顶卖点', padL + 4, chartTop + chartPlotH * 0.5 - 8);
  ctx.fillStyle = '#00CC55';
  ctx.fillText('△谷底买点', padL + 4, chartTop + chartPlotH * 0.5 + 4);

  // 日期标签
  ctx.fillStyle = 'rgba(128,128,128,0.6)';
  ctx.font = '8px Monaco, monospace';
  ctx.textAlign = 'center';
  var dateY = ch - 2;
  if (n > 0) {
    ctx.fillText(ftfResults[0].date.slice(5), padL + barGap * 0.5, dateY);
    ctx.fillText(ftfResults[Math.floor(n / 2)].date.slice(5), padL + barGap * (Math.floor(n / 2) + 0.5), dateY);
    ctx.fillText(ftfResults[n - 1].date.slice(5), padL + barGap * (n - 0.5), dateY);
  }

  // 最新FTF值标注
  if (n > 0) {
    var lastFTF = ftfResults[n - 1];
    var lastY = chartTop + chartPlotH * (1 - lastFTF.ftf / 100);
    var lastColor = ftfToColor(lastFTF.ftf);

    // 圆点
    ctx.fillStyle = lastColor;
    ctx.beginPath();
    ctx.arc(padL + plotW - barGap * 0.5, lastY, 3, 0, Math.PI * 2);
    ctx.fill();

    // 数值
    ctx.fillStyle = lastColor;
    ctx.font = 'bold 9px Monaco, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(String(lastFTF.ftf), padL + plotW + 2, lastY + 3);
  }
}

/**
 * FTF值映射颜色: 绿(0)→黄(50)→红(100)
 * A股标准涨跌色：看好=大红，看跌=大绿
 */
function ftfToColor(ftf) {
  // 绿色 #00AA00 → 黄色 #FFD93D → 红色 #FF0000
  var r, g, b;
  if (ftf <= 50) {
    // 绿→黄
    var t = ftf / 50;
    r = Math.round(0 + (255 - 0) * t);       // 0→255
    g = Math.round(170 + (217 - 170) * t);   // 170→217
    b = Math.round(0 + (61 - 0) * t);        // 0→61
  } else {
    // 黄→红
    var t = (ftf - 50) / 50;
    r = Math.round(255 + (255 - 255) * t);   // 255→255
    g = Math.round(217 + (0 - 217) * t);     // 217→0
    b = Math.round(61 + (0 - 61) * t);       // 61→0
  }
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

/**
 * 绑定悬停交互
 */
function bindFTFHover(ftfResults) {
  var canvas = document.getElementById('ftfCanvas');
  var tooltip = document.getElementById('ftfTooltip');
  if (!canvas || !tooltip || !ftfResults || ftfResults.length === 0) return;

  var n = ftfResults.length;
  var padL = 4, padR = 38;
  var plotW = canvas.clientWidth - padL - padR;
  var barGap = plotW / n;

  canvas.onmousemove = function(e) {
    var rect = canvas.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;

    var idx = Math.floor((mx - padL) / barGap);
    if (idx < 0 || idx >= n) {
      tooltip.style.display = 'none';
      _ftfHoverIdx = -1;
      return;
    }

    _ftfHoverIdx = idx;
    var r = ftfResults[idx];

    // 三子因子贡献占比
    var totalRaw = 0.4 * r.momentum + 0.35 * r.capitalFlow + 0.25 * r.breakthrough;
    var momPct = totalRaw > 0 ? (0.4 * r.momentum / totalRaw * 100) : 0;
    var capPct = totalRaw > 0 ? (0.35 * r.capitalFlow / totalRaw * 100) : 0;
    var brkPct = totalRaw > 0 ? (0.25 * r.breakthrough / totalRaw * 100) : 0;

    // 5日变化速率
    var changeRate = r.ftfChangeRate || 0;

    // 波段信号
    var sigText = '';
    if (r.signal === 'peak') {
      sigText = '<div class="ftf-tip-signal ftf-tip-peak">🔻 峰顶卖出信号</div>';
    } else if (r.signal === 'valley') {
      sigText = '<div class="ftf-tip-signal ftf-tip-valley">🔺 谷底买入信号</div>';
    }

    tooltip.innerHTML =
      '<div class="ftf-tip-date">' + r.date + '</div>' +
      '<div class="ftf-tip-score">FTF: <strong>' + r.ftf + '</strong></div>' +
      sigText +
      '<div class="ftf-tip-factors">' +
        '<div><span class="ftf-dot" style="background:#1F77B4"></span>动量持续性 ' + momPct.toFixed(1) + '%</div>' +
        '<div><span class="ftf-dot" style="background:#FF4D4D"></span>资金流向 ' + capPct.toFixed(1) + '%</div>' +
        '<div><span class="ftf-dot" style="background:#4CAF50"></span>形态突破 ' + brkPct.toFixed(1) + '%</div>' +
      '</div>' +
      '<div class="ftf-tip-rate">5日变化速率: ' + (changeRate >= 0 ? '+' : '') + changeRate.toFixed(2) + ' 分/日</div>';

    // 定位tooltip
    var tipW = 160;
    var tipX = mx + 10;
    if (tipX + tipW > canvas.clientWidth) tipX = mx - tipW - 10;
    tooltip.style.display = 'block';
    tooltip.style.left = tipX + 'px';
    tooltip.style.top = Math.max(4, my - 60) + 'px';
  };

  canvas.onmouseleave = function() {
    tooltip.style.display = 'none';
    _ftfHoverIdx = -1;
  };
}

/**
 * 检查是否应该过滤该股票（停牌/ST/ETF成立不足180日）
 * @param {object} stockData - 股票数据
 * @param {Array} klines - K线数据
 * @returns {string|null} 过滤原因，null表示通过
 */
function checkFTFFilter(stockData, klines) {
  if (!stockData) return '无股票数据';

  // ST/*ST过滤
  var name = stockData.name || '';
  if (/^(ST|\*ST)/.test(name)) return 'ST股票不计算FTF';

  // 停牌过滤：成交量为0
  if (klines && klines.length > 0) {
    var lastKline = klines[klines.length - 1];
    var lastVol = parseFloat(lastKline[5]) || 0;
    if (lastVol === 0) return '股票已停牌';

    // K线数据不足
    if (klines.length < 60) return 'K线数据不足60日';
  }

  // ETF成立不足180日过滤
  if (stockData.isETF && klines && klines.length < 180) {
    return 'ETF成立不足180日';
  }

  return null;
}

/**
 * 生成FTF得分详解HTML
 * 解释当前FTF分数是怎么算出来的，三因子各自贡献了多少
 */
function generateFTFBreakdown(lastFTF, ftfResults) {
  if (!lastFTF) return '';

  var mom = lastFTF.momentum || 0;        // 0-1
  var cap = lastFTF.capitalFlow || 0;     // 0-1
  var brk = lastFTF.breakthrough || 0;    // 0-1
  var ftf = lastFTF.ftf;

  // 三因子加权原始值
  var momWeighted = 0.4 * mom;
  var capWeighted = 0.35 * cap;
  var brkWeighted = 0.25 * brk;
  var rawTotal = momWeighted + capWeighted + brkWeighted;

  // 百分制
  var momPct = Math.round(mom * 100);
  var capPct = Math.round(cap * 100);
  var brkPct = Math.round(brk * 100);

  // 贡献占比
  var momContrib = rawTotal > 0 ? (momWeighted / rawTotal * 100) : 0;
  var capContrib = rawTotal > 0 ? (capWeighted / rawTotal * 100) : 0;
  var brkContrib = rawTotal > 0 ? (brkWeighted / rawTotal * 100) : 0;

  // 5日变化
  var changeRate = lastFTF.ftfChangeRate || 0;
  var changeDir = changeRate > 0.5 ? '↑ 快速上升' : changeRate < -0.5 ? '↓ 快速下降' : '→ 基本持平';

  // 各因子状态描述
  var momDesc, momColor;
  if (momPct >= 70) { momDesc = '上涨动量很强，股价近期持续上行'; momColor = '#FF0000'; }
  else if (momPct >= 55) { momDesc = '上涨动量偏强，趋势逐步形成'; momColor = '#FF6600'; }
  else if (momPct >= 45) { momDesc = '动量中性，方向不明朗'; momColor = '#FFD93D'; }
  else if (momPct >= 30) { momDesc = '下跌动量偏强，股价持续走弱'; momColor = '#88AA00'; }
  else { momDesc = '下跌动量很强，股价近期持续下行'; momColor = '#00AA00'; }

  var capDesc, capColor;
  if (capPct >= 70) { capDesc = '主力资金大幅净流入，买盘积极'; capColor = '#FF0000'; }
  else if (capPct >= 55) { capDesc = '主力资金小幅流入，偏多'; capColor = '#FF6600'; }
  else if (capPct >= 45) { capDesc = '资金流向中性，多空均衡'; capColor = '#FFD93D'; }
  else if (capPct >= 30) { capDesc = '主力资金小幅流出，偏空'; capColor = '#88AA00'; }
  else { capDesc = '主力资金大幅净流出，卖盘积极'; capColor = '#00AA00'; }

  var brkDesc, brkColor;
  if (brkPct >= 70) { brkDesc = '强势突破布林上轨，向上爆发力强'; brkColor = '#FF0000'; }
  else if (brkPct >= 45) { brkDesc = '运行在布林带中上轨，偏强'; brkColor = '#FF6600'; }
  else if (brkPct >= 25) { brkDesc = '在布林带内部运行，未突破'; brkColor = '#FFD93D'; }
  else if (brkPct >= 10) { brkDesc = '运行在布林带中下轨，偏弱'; brkColor = '#88AA00'; }
  else { brkDesc = '跌破布林下轨，超跌可能反弹'; brkColor = '#00AA00'; }

  // 分数解读：波段逻辑（位置+方向）
  var prevItem = ftfResults[ftfResults.length - 2] || lastFTF;
  var slopeNow = lastFTF.ftfSMA3 - prevItem.ftfSMA3;
  var waveInfoX = ftfResults.waveInfo || {};
  var whyNote = '';
  if (ftf >= 70) {
    // 峰顶区
    if (slopeNow < -1 || waveInfoX.latestSignal === 'peak-early') {
      whyNote = '<div class="ftf-breakdown-note ftf-note-overbought">' +
        '🔻 <b>峰顶卖点确认！</b> FTF已进入峰顶区(≥70)且开始拐头向下' +
        (waveInfoX.peakEarlyDrop > 0 ? '，从近期高点回落了<b>' + waveInfoX.peakEarlyDrop.toFixed(0) + '分</b>' : '') +
        '。这是波段的<b>卖出区域</b>：涨幅已大、获利盘涌出，继续持有的风险大于收益。<b>操作：分批减仓或清仓锁定利润，等下一轮谷底再接回来。</b>' +
      '</div>';
    } else {
      whyNote = '<div class="ftf-breakdown-note ftf-note-overbought">' +
        '⚠️ <b>临近峰顶，准备止盈。</b> FTF已进入峰顶区(≥70)' +
        (momPct >= 55 ? '：<b>动量</b>仍在冲高' : '') +
        (capPct >= 55 ? '、<b>资金</b>还在流入' : '') +
        '。股价已涨至波段高位，随时可能见顶回落。<b>已持仓的设好止盈位持有，未持仓的不要在这里追买——追在峰顶是波段操作的大忌。</b>' +
      '</div>';
    }
  } else if (ftf <= 30) {
    // 谷底区
    if (slopeNow > 1 || waveInfoX.latestSignal === 'valley-early') {
      whyNote = '<div class="ftf-breakdown-note ftf-note-oversold">' +
        '🔺 <b>谷底买点确认！</b> FTF已在谷底区(≤30)且开始拐头向上' +
        (waveInfoX.valleyEarlyRise > 0 ? '，从近期低点反弹了<b>' + waveInfoX.valleyEarlyRise.toFixed(0) + '分</b>' : '') +
        '。这是波段的<b>买入区域</b>：股价便宜、超卖充分，反弹随时展开。<b>操作：分批低吸建仓，买在别人恐惧时。这是波段收益的主要来源。</b>' +
      '</div>';
    } else {
      whyNote = '<div class="ftf-breakdown-note ftf-note-oversold">' +
        '⏳ <b>临近谷底，准备买入。</b> FTF已进入谷底区(≤30)' +
        (momPct < 45 ? '：<b>动量</b>显示股价还在最后一跌' : '') +
        (capPct < 45 ? '、<b>资金</b>仍在流出' : '') +
        '。股价已跌至波段低位、足够便宜，<b>但拐头信号还没出现——现在做的是准备资金、分批挂单，等FTF拐头向上即可动手。注意：谷底区买入的正确姿势是分批低吸，不是一把梭。</b>' +
      '</div>';
    }
  } else if (slopeNow > 1) {
    // 中性区上行
    whyNote = '<div class="ftf-breakdown-note ftf-note-buy">' +
      '📈 <b>波段上行中，持有为主。</b> FTF处于中性区(30-70)且向上' +
      (momPct >= 55 ? '：<b>动量</b>向上' : '') +
      (capPct >= 55 ? '、<b>资金</b>流入' : '') +
      '。趋势健康但未到峰顶，可继续持有或顺势小加。<b>下一步：盯住FTF升到70以上后的拐头信号，那就是止盈点。</b>' +
    '</div>';
  } else if (slopeNow < -1) {
    // 中性区下行
    whyNote = '<div class="ftf-breakdown-note ftf-note-weak">' +
      '📉 <b>波段回落中，耐心等谷底。</b> FTF处于中性区(30-70)且向下' +
      (momPct < 45 ? '：<b>动量</b>向下' : '') +
      (capPct < 45 ? '、<b>资金</b>流出' : '') +
      '。现在买入属于半山接刀。<b>最佳策略：等FTF跌到30以下的谷底区并出现拐头，那时才是低吸机会。</b>' +
    '</div>';
  } else {
    whyNote = '<div class="ftf-breakdown-note ftf-note-neutral">' +
      '🔄 <b>中性震荡，方向待选。</b> FTF处于中性区且方向不明，多空拉锯中。小仓试探或观望均可，<b>等FTF进入谷底区(≤30)或峰顶区(≥70)出现明确信号再重仓决策。</b>' +
    '</div>';
  }

  var html = '<div class="ftf-breakdown-panel">' +
    '<div class="ftf-breakdown-title">🔬 得分详解：为什么是这个分数？</div>' +

    // 计算公式
    '<div class="ftf-formula">' +
      '<div class="ftf-formula-label">计算公式：</div>' +
      '<div class="ftf-formula-eq">' +
        'FTF = 动量×40% + 资金×35% + 突破×25% → 0-100分<br>' +
        '波段分区：≤30 谷底区(找买点) · 30-70 中性区 · ≥70 峰顶区(找卖点)' +
      '</div>' +
    '</div>' +

    // 三因子明细
    '<div class="ftf-breakdown-factors">' +
      // 动量
      '<div class="ftf-bf-row">' +
        '<div class="ftf-bf-header">' +
          '<span class="ftf-bf-name" style="color:' + momColor + '">📊 动量持续性</span>' +
          '<span class="ftf-bf-score" style="color:' + momColor + '">' + momPct + '/100</span>' +
        '</div>' +
        '<div class="ftf-bf-bar"><div class="ftf-bf-fill" style="width:' + momPct + '%;background:' + momColor + '"></div></div>' +
        '<div class="ftf-bf-detail">' +
          '<span>权重40% · 贡献占比' + momContrib.toFixed(1) + '%</span>' +
          '<span class="ftf-bf-desc">' + momDesc + '</span>' +
        '</div>' +
      '</div>' +
      // 资金
      '<div class="ftf-bf-row">' +
        '<div class="ftf-bf-header">' +
          '<span class="ftf-bf-name" style="color:' + capColor + '">💰 资金流向</span>' +
          '<span class="ftf-bf-score" style="color:' + capColor + '">' + capPct + '/100</span>' +
        '</div>' +
        '<div class="ftf-bf-bar"><div class="ftf-bf-fill" style="width:' + capPct + '%;background:' + capColor + '"></div></div>' +
        '<div class="ftf-bf-detail">' +
          '<span>权重35% · 贡献占比' + capContrib.toFixed(1) + '%</span>' +
          '<span class="ftf-bf-desc">' + capDesc + '</span>' +
        '</div>' +
      '</div>' +
      // 突破
      '<div class="ftf-bf-row">' +
        '<div class="ftf-bf-header">' +
          '<span class="ftf-bf-name" style="color:' + brkColor + '">⚡ 形态突破</span>' +
          '<span class="ftf-bf-score" style="color:' + brkColor + '">' + brkPct + '/100</span>' +
        '</div>' +
        '<div class="ftf-bf-bar"><div class="ftf-bf-fill" style="width:' + brkPct + '%;background:' + brkColor + '"></div></div>' +
        '<div class="ftf-bf-detail">' +
          '<span>权重25% · 贡献占比' + brkContrib.toFixed(1) + '%</span>' +
          '<span class="ftf-bf-desc">' + brkDesc + '</span>' +
        '</div>' +
      '</div>' +
    '</div>' +

    // 5日趋势
    '<div class="ftf-breakdown-trend">' +
      '<span class="ftf-bt-label">近5日FTF变化：</span>' +
      '<span class="ftf-bt-val">' + (changeRate >= 0 ? '+' : '') + changeRate.toFixed(2) + ' 分/日 ' + changeDir + '</span>' +
    '</div>' +

    whyNote +
  '</div>';

  return html;
}

/**
 * FTF因子完整渲染入口
 * @param {object} klData - K线数据 {dates, closes, klines}
 * @param {object} stockData - 股票信息
 * @param {number} realtimePrice - 实时价格
 */
function renderFTF(klData, stockData, realtimePrice) {
  if (!klData || !klData.klines || klData.klines.length < 60) {
    console.log('FTF: K线数据不足，跳过');
    return;
  }

  // 过滤检查
  var filterReason = checkFTFFilter(stockData, klData.klines);
  if (filterReason) {
    console.log('FTF: ' + filterReason);
    renderFTFEmpty(filterReason);
    return;
  }

  // 计算FTF
  var ftfResults = calculateFTF(klData.klines, _ftfWindow);
  if (!ftfResults || ftfResults.length === 0) {
    renderFTFEmpty('FTF计算失败');
    return;
  }

  // 渲染
  renderFTFChart(ftfResults, { klData: klData, stockName: stockData.name, realtimePrice: realtimePrice });
}

/**
 * 渲染FTF空状态
 */
function renderFTFEmpty(reason) {
  var area = document.getElementById('stockResultArea');
  if (!area) return;
  var detailEl = area.querySelector('.stock-detail');
  if (!detailEl) return;

  var existing = detailEl.querySelector('.sd-ftf');
  if (existing) existing.remove();

  var klineSection = detailEl.querySelector('.sd-kline');
  var addBtn = detailEl.querySelector('.sd-add-btn');

  var html = '<div class="sd-ftf"><div class="sd-section sd-ftf-section">' +
    '<div class="sd-section-title">未来趋势因子 FTF</div>' +
    '<div class="ftf-guide-panel" style="margin-top:0.3rem">' +
      '<div class="ftf-guide-title">📌 什么是FTF？</div>' +
      '<div class="ftf-guide-text">' +
        'FTF（Future Trend Factor）是一个<b>0-100分的波段位置评分</b>，综合分析股价的动量持续性、资金流向和形态突破。' +
        '<b>30以下=谷底区找买点，70以上=峰顶区找卖点</b>，配合拐头确认形成完整波段操作。' +
      '</div>' +
      '<div class="ftf-disclaimer" style="border-top:none;padding-top:0;margin-top:0.2rem">⚠️ 当前暂无法计算：' + reason + '</div>' +
    '</div>' +
    '</div></div>';

  var tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  var ftfNode = tempDiv.firstChild;

  if (klineSection && klineSection.nextSibling) {
    detailEl.insertBefore(ftfNode, klineSection.nextSibling);
  } else if (klineSection) {
    detailEl.insertBefore(ftfNode, addBtn || null);
  } else if (addBtn) {
    detailEl.insertBefore(ftfNode, addBtn);
  } else {
    detailEl.appendChild(ftfNode);
  }
}
