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
var _paAnalysisLock = false;
var _paRetryCount = 0;
var _paMaxRetries = 3;

function runPatternAnalysis(forceRefresh) {
  var container = document.getElementById('paRulesList');
  if (!container) return;
  if (_paAnalysisLock) return;
  _paAnalysisLock = true;

  var btn = document.getElementById('btnPatternRefresh');
  if (btn) { btn.disabled = true; btn.textContent = '\u27f3 \u63a8\u6f14\u4e2d\u2026'; }

  var rt = _lastRealtimeData || {};
  var sent = _lastSentimentData || null;
  var hasRt = rt && Object.keys(rt).length > 0;
  var hasHS300 = rt && rt['sh000300'] && (rt['sh000300'].price || rt['sh000300'].changePercent !== undefined);

  // 数据未就绪：自动重试
  if (!hasRt || !hasHS300) {
    if (_paRetryCount < _paMaxRetries && !forceRefresh) {
      _paRetryCount++;
      if (container) {
        container.innerHTML = '<div class="pa-loading">\u23f3 \u6b63\u5728\u7b49\u5f85\u884c\u60c5\u6570\u636e\u52a0\u8f7d\uff08\u7b2c' + _paRetryCount + '/' + _paMaxRetries + '\u6b21\u91cd\u8bd5\uff09\u2026</div>';
      }
      if (btn) { btn.disabled = false; btn.textContent = '\u27f3 \u63a8\u6f14'; }
      _paAnalysisLock = false;
      Perf.trackedSetTimeout(function() { runPatternAnalysis(false); }, 3000);
      return;
    }
    // 重试耗尽，用基准数据兜底
    if (container) {
      container.innerHTML = '<div class="pa-loading">\u26a0\ufe0f \u884c\u60c5\u6570\u636e\u6682\u672a\u5c31\u7eea\uff0c\u5df2\u4f7f\u7528\u57fa\u51c6\u6570\u636e\u63a8\u6f14\u3002\u70b9\u51fb\u300c\u63a8\u6f14\u300d\u91cd\u8bd5</div>';
    }
    if (btn) { btn.disabled = false; btn.textContent = '\u27f3 \u63a8\u6f14'; }
    _paAnalysisLock = false;
    _paRetryCount = 0;
    // 用空数据兜底渲染
    var fallbackResult = analyzePatterns({}, null, null);
    _paLastResult = fallbackResult;
    renderPatternAnalysis(fallbackResult);
    return;
  }

  // 数据就绪，重置重试计数
  _paRetryCount = 0;

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
    renderPatternAnalysis(result);
    if (btn) { btn.disabled = false; btn.textContent = '\u27f3 \u63a8\u6f14'; }
    _paAnalysisLock = false;
  }).catch(function(err) {
    // K线超时或失败，仍用实时数据推演（K线相关规则跳过）
    var result = analyzePatterns(rt, sent, null);
    _paLastResult = result;
    renderPatternAnalysis(result);
    if (btn) { btn.disabled = false; btn.textContent = '\u27f3 \u63a8\u6f14'; }
    _paAnalysisLock = false;
  });
}

function analyzePatterns(rt, sent, klineData) {
  var signals = [];
  var hs300 = rt['sh000300'] || {};
  var price = hs300.price || 0;
  var open = hs300.open || 0;
  var high = hs300.high || 0;
  var prevClose = hs300.yesterdayClose || 0;
  var chgPct = hs300.changePercent || 0;

  var upCount = sent ? sent.up : 0;
  var downCount = sent ? sent.down : 0;
  var totalAmount = sent ? sent.totalAmount : 0;
  var prevAmount = sent ? sent.prevAmount : 0;
  var avg20Amount = sent ? sent.avg20Amount : 0;

  var closes = klineData ? klineData.closes : [];
  var klines = klineData ? klineData.klines : [];
  var volumes = klines.map(function(k) { return parseFloat(k[5]) || 0; });

  var hs300Base = null;
  if (typeof BASE_DATA !== 'undefined') {
    for (var i = 0; i < BASE_DATA.indices.length; i++) {
      if (BASE_DATA.indices[i].code === 'sh000300') { hs300Base = BASE_DATA.indices[i]; break; }
    }
  }
  var pePct = hs300Base ? (hs300Base.pct10 || 50) : 50;

  // Rule 1: continuous small rises
  if (closes.length >= 4) {
    var smallRiseDays = 0;
    for (var i = closes.length - 4; i < closes.length - 1; i++) {
      var dayChg = (closes[i + 1] - closes[i]) / closes[i] * 100;
      if (dayChg > 0 && dayChg < 1.0) smallRiseDays++;
    }
    if (smallRiseDays >= 3) {
      signals.push({ ruleId: 1, triggered: true, signal: 'bull', confidence: 0.7,
        detail: '\u8fd14\u65e5\u4e2d\u6709' + smallRiseDays + '\u65e5\u5c0f\u5e45\u4e0a\u6da8\uff08<1%\uff09\uff0c\u84c4\u52bf\u5f85\u53d1' });
    }
  }

  // Rule 2: continuous big rises
  if (closes.length >= 3) {
    var bigRiseDays = 0;
    for (var j = closes.length - 3; j < closes.length - 1; j++) {
      var bigChg = (closes[j + 1] - closes[j]) / closes[j] * 100;
      if (bigChg > 1.5) bigRiseDays++;
    }
    if (bigRiseDays >= 2) {
      signals.push({ ruleId: 2, triggered: true, signal: 'bear', confidence: 0.75,
        detail: '\u8fd13\u65e5\u4e2d\u6709' + bigRiseDays + '\u65e5\u5927\u5e45\u4e0a\u6da8\uff08>1.5%\uff09\uff0c\u77ed\u671f\u8fc7\u70ed\u98ce\u9669' });
    }
  }

  // Rules 3-6: relative strength
  var breadthChg = (upCount + downCount) > 0 ? (upCount - downCount) / (upCount + downCount) * 100 : 0;

  if (chgPct < -0.3 && Math.abs(breadthChg) < 10 && upCount > downCount * 0.8) {
    signals.push({ ruleId: 3, triggered: true, signal: 'bull', confidence: 0.55,
      detail: '\u5927\u76d8\u8dcc' + chgPct.toFixed(2) + '%\u4f46\u6da8\u8dcc\u5bb6\u6570\u63a5\u8fd1\uff0c\u591a\u6570\u4e2a\u80a1\u6297\u8dcc' });
  }

  if (chgPct < -0.3 && upCount > downCount * 1.5 && downCount > 0) {
    signals.push({ ruleId: 4, triggered: true, signal: 'bull', confidence: 0.7,
      detail: '\u5927\u76d8\u8dcc' + chgPct.toFixed(2) + '%\u4f46\u4e0a\u6da8' + upCount + '\u5bb6\u8fdc\u8d85\u4e0b\u8dcc' + downCount + '\u5bb6' });
  }

  if (chgPct > 0.3 && Math.abs(breadthChg) < 10 && downCount > upCount * 0.8) {
    signals.push({ ruleId: 5, triggered: true, signal: 'bear', confidence: 0.5,
      detail: '\u5927\u76d8\u6da8' + chgPct.toFixed(2) + '%\u4f46\u6da8\u8dcc\u5bb6\u6570\u63a5\u8fd1\uff0c\u591a\u6570\u4e2a\u80a1\u6ede\u6da8' });
  }

  if (chgPct > 0.3 && downCount > upCount * 1.5 && upCount > 0) {
    signals.push({ ruleId: 6, triggered: true, signal: 'bear', confidence: 0.65,
      detail: '\u5927\u76d8\u6da8' + chgPct.toFixed(2) + '%\u4f46\u4e0b\u8dcc' + downCount + '\u5bb6\u8fdc\u8d85\u4e0a\u6da8' + upCount + '\u5bb6' });
  }

  // Rule 7: fast drop + shrinking volume = washout
  if (chgPct < -1.0 && prevAmount > 0 && totalAmount > 0 && totalAmount < prevAmount * 0.9) {
    signals.push({ ruleId: 7, triggered: true, signal: 'bull', confidence: 0.6,
      detail: '\u4eca\u65e5\u8dcc' + chgPct.toFixed(2) + '%\u4f46\u6210\u4ea4\u91cf\u8f83\u6628\u65e5\u840e\u7f29' + ((1 - totalAmount / prevAmount) * 100).toFixed(0) + '%' });
  }

  // Rule 8: slow drop + increasing volume = distribution
  if (closes.length >= 4) {
    var fallDays = 0;
    var volIncreasing = true;
    for (var k = closes.length - 4; k < closes.length - 1; k++) {
      var dChg = (closes[k + 1] - closes[k]) / closes[k] * 100;
      if (dChg < 0) fallDays++;
      if (volumes[k + 1] < volumes[k] * 0.95) volIncreasing = false;
    }
    if (fallDays >= 2 && volIncreasing && chgPct < 0) {
      signals.push({ ruleId: 8, triggered: true, signal: 'bear', confidence: 0.65,
        detail: '\u8fd14\u65e5\u6709' + fallDays + '\u65e5\u4e0b\u8dcc\u4e14\u6210\u4ea4\u91cf\u9012\u589e\uff0c\u51fa\u8d27\u7279\u5f81' });
    }
  }

  // Rule 9: low open high close = accumulation
  if (prevClose > 0 && open > 0 && price > 0) {
    var openGap = (open - prevClose) / prevClose * 100;
    var intradayChg = (price - open) / open * 100;
    if (openGap < -0.2 && intradayChg > 0.5) {
      signals.push({ ruleId: 9, triggered: true, signal: 'bull', confidence: 0.6,
        detail: '\u4f4e\u5f00' + openGap.toFixed(2) + '%\u540e\u8d70\u9ad8' + intradayChg.toFixed(2) + '%\uff0c\u5438\u7b79\u7279\u5f81' });
    }
  }

  // Rule 10: high open low close = distribution
  if (prevClose > 0 && open > 0 && price > 0) {
    var openGapUp = (open - prevClose) / prevClose * 100;
    var intradayFall = (open - price) / open * 100;
    if (openGapUp > 0.2 && intradayFall > 0.3) {
      signals.push({ ruleId: 10, triggered: true, signal: 'bear', confidence: 0.6,
        detail: '\u9ad8\u5f00' + openGapUp.toFixed(2) + '%\u540e\u8d70\u4f4e' + intradayFall.toFixed(2) + '%\uff0c\u51fa\u8d27\u7279\u5f81' });
    }
  }

  // Rule 11: morning rise afternoon pullback = washout
  if (open > 0 && high > 0 && price > 0) {
    var morningRise = (high - open) / open * 100;
    var afternoonFall = (high - price) / high * 100;
    if (morningRise > 0.5 && afternoonFall > 0.3 && price > open) {
      signals.push({ ruleId: 11, triggered: true, signal: 'bull', confidence: 0.5,
        detail: '\u76d8\u4e2d\u51b2\u9ad8' + morningRise.toFixed(2) + '%\u540e\u56de\u843d\u4f46\u6536\u76d8\u9ad8\u4e8e\u5f00\u76d8\uff0c\u6d17\u76d8\u7279\u5f81' });
    }
  }

  // Rule 12: low position + volume = accumulation
  if (pePct < 30 && avg20Amount > 0 && totalAmount > avg20Amount * 1.2) {
    signals.push({ ruleId: 12, triggered: true, signal: 'bull', confidence: 0.7,
      detail: 'PE\u5206\u4f4d' + pePct.toFixed(0) + '%\uff08\u4f4e\u4f4d\uff09+ \u6210\u4ea4\u91cf\u8d8520\u65e5\u5747\u91cf' + ((totalAmount / avg20Amount - 1) * 100).toFixed(0) + '%' });
  }

  // Rule 13: high position + volume = distribution
  if (pePct > 70 && avg20Amount > 0 && totalAmount > avg20Amount * 1.2) {
    signals.push({ ruleId: 13, triggered: true, signal: 'bear', confidence: 0.7,
      detail: 'PE\u5206\u4f4d' + pePct.toFixed(0) + '%\uff08\u9ad8\u4f4d\uff09+ \u6210\u4ea4\u91cf\u8d8520\u65e5\u5747\u91cf' + ((totalAmount / avg20Amount - 1) * 100).toFixed(0) + '%' });
  }

  // Rule 14: low position flat + volume
  if (closes.length >= 10 && pePct < 40) {
    var recent10 = closes.slice(-10);
    var maxP = Math.max.apply(null, recent10);
    var minP = Math.min.apply(null, recent10);
    var volatility = (maxP - minP) / minP * 100;
    if (volatility < 3 && avg20Amount > 0 && totalAmount > avg20Amount * 1.3) {
      signals.push({ ruleId: 14, triggered: true, signal: 'bull', confidence: 0.65,
        detail: 'PE\u5206\u4f4d' + pePct.toFixed(0) + '% + \u8fd110\u65e5\u6ce2\u52a8\u4ec5' + volatility.toFixed(1) + '% + \u653e\u91cf\u7a81\u7834' });
    }
  }

  // Rule 15: low position narrow range + volume + big yang = launch
  if (closes.length >= 6 && pePct < 40) {
    var recent5 = closes.slice(-6, -1);
    var max5 = Math.max.apply(null, recent5);
    var min5 = Math.min.apply(null, recent5);
    var vol5 = (max5 - min5) / min5 * 100;
    var todayChg = closes.length >= 2 ? (closes[closes.length - 1] - closes[closes.length - 2]) / closes[closes.length - 2] * 100 : 0;
    if (vol5 < 2.5 && todayChg > 2.0 && avg20Amount > 0 && totalAmount > avg20Amount * 1.3) {
      signals.push({ ruleId: 15, triggered: true, signal: 'bull', confidence: 0.8,
        detail: '\u4f4e\u4f4d\u7a84\u5e45\u9707\u8361\uff08\u6ce2\u52a8' + vol5.toFixed(1) + '%\uff09\u540e\u4eca\u65e5\u6da8' + todayChg.toFixed(2) + '%\u4e14\u653e\u91cf\uff0c\u542f\u52a8\u4fe1\u53f7' });
    }
  }

  // Rule 16: high position narrow range + volume + big yin = exit
  if (closes.length >= 6 && pePct > 60) {
    var recent5h = closes.slice(-6, -1);
    var max5h = Math.max.apply(null, recent5h);
    var min5h = Math.min.apply(null, recent5h);
    var vol5h = (max5h - min5h) / min5h * 100;
    var todayChgH = closes.length >= 2 ? (closes[closes.length - 1] - closes[closes.length - 2]) / closes[closes.length - 2] * 100 : 0;
    if (vol5h < 2.5 && todayChgH < -2.0 && avg20Amount > 0 && totalAmount > avg20Amount * 1.3) {
      signals.push({ ruleId: 16, triggered: true, signal: 'bear', confidence: 0.8,
        detail: '\u9ad8\u4f4d\u7a84\u5e45\u9707\u8361\uff08\u6ce2\u52a8' + vol5h.toFixed(1) + '%\uff09\u540e\u4eca\u65e5\u8dcc' + todayChgH.toFixed(2) + '%\u4e14\u653e\u91cf\uff0c\u51fa\u9003\u4fe1\u53f7' });
    }
  }

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
    compositeScore = Math.round(50 + netScore / totalScore * 50);
    compositeScore = Math.max(0, Math.min(100, compositeScore));
  }

  var level, levelColor, levelIcon;
  if (compositeScore >= 70) { level = '\u770b\u6da8'; levelColor = 'bull'; levelIcon = '\ud83d\udcc8'; }
  else if (compositeScore >= 58) { level = '\u504f\u591a'; levelColor = 'bull-weak'; levelIcon = '\ud83d\udd06'; }
  else if (compositeScore >= 42) { level = '\u4e2d\u6027'; levelColor = 'neutral'; levelIcon = '\u27a1\ufe0f'; }
  else if (compositeScore >= 30) { level = '\u504f\u7a7a'; levelColor = 'bear-weak'; levelIcon = '\ud83d\udd07'; }
  else { level = '\u770b\u8dcc'; levelColor = 'bear'; levelIcon = '\ud83d\udcc9'; }

  var bullCount = signals.filter(function(s) { return s.signal === 'bull'; }).length;
  var bearCount = signals.filter(function(s) { return s.signal === 'bear'; }).length;

  return {
    signals: signals, compositeScore: compositeScore, level: level,
    levelColor: levelColor, levelIcon: levelIcon,
    bullCount: bullCount, bearCount: bearCount,
    neutralCount: 16 - triggeredCount, triggeredCount: triggeredCount,
    bullScore: bullScore, bearScore: bearScore
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
      gaugeScore.setAttribute('fill', result.levelColor === 'bull' ? '#00FFC6' : (result.levelColor === 'bear' ? '#FF3366' : (result.levelColor === 'neutral' ? '#00C8FF' : '#FFAE00')));
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
      if (strength >= 58) fillEl.style.background = 'linear-gradient(90deg, rgba(255,174,0,0.4), rgba(0,255,198,0.7))';
      else if (strength >= 42) fillEl.style.background = 'linear-gradient(90deg, rgba(0,200,255,0.3), rgba(255,174,0,0.4))';
      else fillEl.style.background = 'linear-gradient(90deg, rgba(255,51,102,0.7), rgba(255,174,0,0.4))';
    }
    if (valEl) {
      var catLabel = { trend: '趋势', relative: '强弱', volume: '量价', intraday: '分时', position: '位置', breakout: '突破' }[cat];
      var arrow = strength >= 58 ? '↑' : (strength >= 42 ? '→' : '↓');
      var color = strength >= 58 ? 'var(--neon-green)' : (strength >= 42 ? 'var(--neon-cyan)' : 'var(--neon-red)');
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
      var dotColor = strength >= 58 ? '#00FFC6' : (strength >= 42 ? '#00C8FF' : '#FF3366');
      dotsHtml += '<circle cx="' + dx.toFixed(1) + '" cy="' + dy.toFixed(1) + '" r="3" fill="' + dotColor + '" stroke="rgba(255,255,255,0.3)" stroke-width="0.5"/>';
    }
    radarShape.setAttribute('points', dataPts.join(' '));
    if (radarDots) { radarDots.innerHTML = dotsHtml; }
  }

  // ===== 5. 渲染口诀列表（触发优先+未触发折叠） =====
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
      var confColor = rule.signal === 'bull' ? 'rgba(0,255,198,0.5)' : 'rgba(255,51,102,0.5)';
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
