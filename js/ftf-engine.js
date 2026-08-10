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

  return rawFTFs;
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
  var ratingText, ratingCls, ratingEmoji;
  if (lastScore >= 80) { ratingText = '超买区·警惕回调'; ratingCls = 'ftf-rating-overbought'; ratingEmoji = '🔥'; }
  else if (lastScore >= 65) { ratingText = '强势·趋势向上'; ratingCls = 'ftf-rating-strong'; ratingEmoji = '🚀'; }
  else if (lastScore >= 50) { ratingText = '中性偏多·观望'; ratingCls = 'ftf-rating-neutral'; ratingEmoji = '⚖️'; }
  else if (lastScore >= 35) { ratingText = '中性偏空·谨慎'; ratingCls = 'ftf-rating-weak'; ratingEmoji = '⚠️'; }
  else if (lastScore >= 20) { ratingText = '弱势·趋势向下'; ratingCls = 'ftf-rating-bearish'; ratingEmoji = '📉'; }
  else { ratingText = '超卖区·关注反弹'; ratingCls = 'ftf-rating-oversold'; ratingEmoji = '🧊'; }

  var html = '<div class="sd-ftf"><div class="sd-section sd-ftf-section">' +
    '<div class="sd-section-title">未来趋势因子 FTF' +
      '<span class="ftf-window-switch">' +
        '<button class="ftf-win-btn" data-win="60">60日</button>' +
        '<button class="ftf-win-btn active" data-win="120">120日</button>' +
        '<button class="ftf-win-btn" data-win="180">180日</button>' +
        '<button class="ftf-win-btn" data-win="250">250日</button>' +
      '</span>' +
    '</div>' +

    // === 当前评级面板 ===
    '<div class="ftf-current-panel">' +
      '<div class="ftf-score-display">' +
        '<div class="ftf-score-num ' + ratingCls + '">' + lastScore + '</div>' +
        '<div class="ftf-score-meta">' +
          '<div class="ftf-score-label">当前FTF得分 / 100</div>' +
          '<div class="ftf-score-rating ' + ratingCls + '">' + ratingEmoji + ' ' + ratingText + '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    // === 小白说明面板 ===
    '<div class="ftf-guide-panel">' +
      '<div class="ftf-guide-title">📌 一分钟看懂FTF</div>' +
      '<div class="ftf-guide-text">' +
        'FTF是一个<b>0-100分的趋势评分</b>，分数越高代表未来上涨概率越大。' +
        '它把三个关键信号揉在一起算出一个总分：' +
      '</div>' +
      '<div class="ftf-factor-cards">' +
        '<div class="ftf-factor-card">' +
          '<div class="ftf-factor-icon" style="color:#1F77B4">📊</div>' +
          '<div class="ftf-factor-name">动量持续性 <span class="ftf-factor-wt">40%</span></div>' +
          '<div class="ftf-factor-desc">最近股价是不是在<b>持续往一个方向走</b>？就像推车，匀速前进比忽快忽慢更靠谱</div>' +
        '</div>' +
        '<div class="ftf-factor-card">' +
          '<div class="ftf-factor-icon" style="color:#FF4D4D">💰</div>' +
          '<div class="ftf-factor-name">资金流向 <span class="ftf-factor-wt">35%</span></div>' +
          '<div class="ftf-factor-desc"><b>大资金在买还是在卖</b>？主力持续流入=有人看好，持续流出=有人在跑</div>' +
        '</div>' +
        '<div class="ftf-factor-card">' +
          '<div class="ftf-factor-icon" style="color:#4CAF50">⚡</div>' +
          '<div class="ftf-factor-name">形态突破 <span class="ftf-factor-wt">25%</span></div>' +
          '<div class="ftf-factor-desc">股价是不是<b>冲破了天花板</b>？就像水坝决堤，突破阻力位=力量很强</div>' +
        '</div>' +
      '</div>' +
      '<div class="ftf-legend-bar">' +
        '<div class="ftf-legend-label">分数区间：</div>' +
        '<div class="ftf-legend-gradient"></div>' +
        '<div class="ftf-legend-ticks">' +
          '<span>0 超卖</span><span>20 弱势</span><span>50 中性</span><span>65 强势</span><span>80 超买</span><span>100</span>' +
        '</div>' +
      '</div>' +
      '<div class="ftf-reading-tips">' +
        '<div class="ftf-tip-row"><b>📖 怎么看图：</b></div>' +
        '<div class="ftf-tip-row">• <b>上方色带</b>：每天FTF分数的颜色，红色=弱、黄色=中性、绿色=强</div>' +
        '<div class="ftf-tip-row">• <b>下方折线</b>：FTF分数随时间的变化，蓝线是3日平滑线</div>' +
        '<div class="ftf-tip-row">• <b>红色虚线(80)</b>：超买警戒线，到这条线以上要小心回调</div>' +
        '<div class="ftf-tip-row">• <b>绿色虚线(20)</b>：超卖关注线，到这条线以下可能要反弹</div>' +
        '<div class="ftf-tip-row">• <b>鼠标悬停</b>：可查看每天的三因子贡献占比</div>' +
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

  // 超买线(80) - 红色虚线
  var y80 = chartTop + chartPlotH * (1 - 80 / 100);
  ctx.strokeStyle = '#D62828';
  ctx.lineWidth = 0.8;
  ctx.setLineDash([3, 2]);
  ctx.beginPath();
  ctx.moveTo(padL, y80);
  ctx.lineTo(padL + plotW, y80);
  ctx.stroke();
  ctx.fillStyle = 'rgba(214,40,40,0.6)';
  ctx.font = '7px Monaco, monospace';
  ctx.fillText('80', padL + plotW + 2, y80 - 2);

  // 超卖线(20) - 绿色虚线
  var y20 = chartTop + chartPlotH * (1 - 20 / 100);
  ctx.strokeStyle = '#2E8B57';
  ctx.lineWidth = 0.8;
  ctx.setLineDash([3, 2]);
  ctx.beginPath();
  ctx.moveTo(padL, y20);
  ctx.lineTo(padL + plotW, y20);
  ctx.stroke();
  ctx.fillStyle = 'rgba(46,139,87,0.6)';
  ctx.fillText('20', padL + plotW + 2, y20 - 2);
  ctx.setLineDash([]);

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
 * FTF值映射颜色: 红(0)→黄(50)→绿(100)
 */
function ftfToColor(ftf) {
  // 红色 #FF4D4D → 黄色 #FFD93D → 绿色 #4CAF50
  var r, g, b;
  if (ftf <= 50) {
    // 红→黄
    var t = ftf / 50;
    r = Math.round(255 + (255 - 255) * t);   // 255→255
    g = Math.round(77 + (217 - 77) * t);     // 77→217
    b = Math.round(77 + (61 - 77) * t);      // 77→61
  } else {
    // 黄→绿
    var t = (ftf - 50) / 50;
    r = Math.round(255 + (76 - 255) * t);    // 255→76
    g = Math.round(217 + (175 - 217) * t);   // 217→175
    b = Math.round(61 + (80 - 61) * t);      // 61→80
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

    tooltip.innerHTML =
      '<div class="ftf-tip-date">' + r.date + '</div>' +
      '<div class="ftf-tip-score">FTF: <strong>' + r.ftf + '</strong></div>' +
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
        'FTF（Future Trend Factor）是一个<b>0-100分的趋势评分</b>，综合分析股价的动量持续性、资金流向和形态突破，' +
        '帮助判断未来趋势方向。分数越高代表上涨概率越大。' +
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
