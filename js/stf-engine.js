'use strict';

/* ============================================================
   STF (Short-Term Factor) 短线爆发因子引擎 v1.0
   ------------------------------------------------------------
   定位：FTF回答"位置高不高"（波段），STF回答"短线会不会动"（择时）
   五维：动量爆发25% + 量能异动25% + K线形态20% + 指标共振15% + 博弈情绪15%
   附带：K线形态识别库 + 8大战法匹配 + FTF×STF联合决策矩阵
   ============================================================ */

/* ===== 一、K线形态识别库 ===== */

/** 判断单根K线属性 */
function stfAnalyzeCandle(c, prevClose) {
  var body = Math.abs(c.close - c.open);
  var range = c.high - c.low;
  var upperShadow = c.high - Math.max(c.open, c.close);
  var lowerShadow = Math.min(c.open, c.close) - c.low;
  var isYang = c.close > c.open;
  var pct = prevClose > 0 ? (c.close - prevClose) / prevClose * 100 : 0;
  var bodyPct = prevClose > 0 ? body / prevClose * 100 : 0;

  return {
    isYang: isYang,
    body: body,
    range: range,
    upperShadow: upperShadow,
    lowerShadow: lowerShadow,
    pct: pct,
    bodyPct: bodyPct,
    upperRatio: body > 0 ? upperShadow / body : (upperShadow > 0 ? 99 : 0),
    lowerRatio: body > 0 ? lowerShadow / body : (lowerShadow > 0 ? 99 : 0),
    bodyRatio: range > 0 ? body / range : 0,
    isBigYang: bodyPct >= 5 && isYang,
    isBigYin: bodyPct >= 5 && !isYang,
    isDoji: range > 0 && body / range < 0.15,
    isHammer: lowerShadow >= body * 2 && upperShadow < body * 0.8 && bodyPct < 4,
    isShootingStar: upperShadow >= body * 2 && lowerShadow < body * 0.8 && bodyPct < 4,
    isMarubozu: range > 0 && body / range > 0.85 && bodyPct >= 3,
    isLimitUp: pct >= 9.5,   // 简化：主板口径（宽口径用>=9.5覆盖）
    isLimitUp20: pct >= 19.5 // 创业板/科创板口径
  };
}

/** 识别最近N根K线的形态组合，返回形态列表（按时间倒序，最新在前） */
function stfDetectPatterns(data) {
  var n = data.length;
  var patterns = [];
  if (n < 3) return patterns;

  // 最近5根逐一分析
  for (var k = 0; k < Math.min(5, n - 1); k++) {
    var i = n - 1 - k; // 当日索引
    var c = data[i];
    var p = stfAnalyzeCandle(c, i > 0 ? data[i - 1].close : c.open);

    // === 单根形态 ===
    if (p.isLimitUp20) patterns.push({ idx: i, name: '20cm涨停', type: 'bull', strength: 5, pos: k, desc: '创业板/科创板涨停，情绪极致' });
    else if (p.isLimitUp) patterns.push({ idx: i, name: '涨停板', type: 'bull', strength: 5, pos: k, desc: '封板强势，短线情绪引爆' });
    else if (p.isBigYang) patterns.push({ idx: i, name: '大阳线', type: 'bull', strength: 4, pos: k, desc: '涨幅' + p.pct.toFixed(1) + '%，多头强势进攻' });
    else if (p.isBigYin) patterns.push({ idx: i, name: '大阴线', type: 'bear', strength: 4, pos: k, desc: '跌幅' + p.pct.toFixed(1) + '%，空头宣泄' });

    if (p.isMarubozu) patterns.push({ idx: i, name: p.isYang ? '光头光脚阳' : '光头光脚阴', type: p.isYang ? 'bull' : 'bear', strength: 4, pos: k, desc: '实体占振幅85%+，方向坚决' });

    if (p.isDoji && p.pct > -1 && p.pct < 1) patterns.push({ idx: i, name: '十字星', type: 'neutral', strength: 2, pos: k, desc: '多空平衡，变盘窗口临近' });

    if (p.isHammer) {
      if (i >= 8) {
        // 位置判断：低位锤子=看涨，高位=上吊线
        var recentLow = Math.min.apply(null, data.slice(i - 8, i + 1).map(function(d) { return d.low; }));
        var isLowPos = c.low <= recentLow * 1.03;
        patterns.push({ idx: i, name: isLowPos ? '锤子线（低位）' : '上吊线（高位）', type: isLowPos ? 'bull' : 'bear', strength: isLowPos ? 4 : 3, pos: k, desc: isLowPos ? '长下影探底回升，支撑有效' : '高位长下影，警惕抛压' });
      } else {
        patterns.push({ idx: i, name: '锤子线', type: 'bull', strength: 3, pos: k, desc: '长下影探底回升' });
      }
    }

    if (p.isShootingStar) patterns.push({ idx: i, name: '射击之星', type: 'bear', strength: 3, pos: k, desc: '长上影冲高回落，上方抛压重' });

    // === 双根形态（需要前一根） ===
    if (i >= 1) {
      var prev = stfAnalyzeCandle(data[i - 1], i > 1 ? data[i - 2].close : data[i - 1].open);
      var prevBody = Math.abs(data[i - 1].close - data[i - 1].open);
      var curBody = Math.abs(c.close - c.open);

      // 阳包阴（看涨吞没）
      if (!prev.isYang && p.isYang && c.close >= data[i - 1].open && c.open <= data[i - 1].close && curBody > prevBody * 1.1) {
        patterns.push({ idx: i, name: '阳包阴', type: 'bull', strength: 4, pos: k, desc: '多头反吞昨日阴线，反转信号' });
      }
      // 阴包阳（看跌吞没）
      if (prev.isYang && !p.isYang && c.close <= data[i - 1].open && c.open >= data[i - 1].close && curBody > prevBody * 1.1) {
        patterns.push({ idx: i, name: '阴包阳', type: 'bear', strength: 4, pos: k, desc: '空头反吞昨日阳线，转弱信号' });
      }
      // 乌云盖顶：昨日阳线，今日高开低走收在昨日实体中部之下
      if (prev.isYang && !p.isYang && c.open > data[i - 1].close && c.close < (data[i - 1].open + data[i - 1].close) / 2 && c.close > data[i - 1].open) {
        patterns.push({ idx: i, name: '乌云盖顶', type: 'bear', strength: 3, pos: k, desc: '高开低走深入昨日阳线实体' });
      }
      // 曙光初现：昨日阴线，今日低开高走收在昨日实体中部之上
      if (!prev.isYang && p.isYang && c.open < data[i - 1].close && c.close > (data[i - 1].open + data[i - 1].close) / 2 && c.close < data[i - 1].open) {
        patterns.push({ idx: i, name: '曙光初现', type: 'bull', strength: 3, pos: k, desc: '低开高走收复昨日阴线过半' });
      }
    }

    // === 三根形态（需要前两根） ===
    if (i >= 2) {
      var c2 = data[i - 2], c1 = data[i - 1];
      var b2 = stfAnalyzeCandle(c2, i > 2 ? data[i - 3].close : c2.open);
      var b1 = stfAnalyzeCandle(c1, c2.close);

      // 红三兵
      if (b2.isYang && b1.isYang && p.isYang && c1.close > c2.close && c.close > c1.close &&
          b2.bodyPct >= 1 && b1.bodyPct >= 1 && p.bodyPct >= 1 && p.bodyRatio > 0.5 && b1.bodyRatio > 0.5) {
        patterns.push({ idx: i, name: '红三兵', type: 'bull', strength: 5, pos: k, desc: '三连阳阶梯上攻，趋势启动' });
      }
      // 黑三鸦
      if (!b2.isYang && !b1.isYang && !p.isYang && c1.close < c2.close && c.close < c1.close &&
          b2.bodyPct >= 1 && b1.bodyPct >= 1 && p.bodyPct >= 1) {
        patterns.push({ idx: i, name: '黑三鸦', type: 'bear', strength: 5, pos: k, desc: '三连阴阶梯下杀，趋势走坏' });
      }
      // 早晨之星：大阴+小实体+大阳收复
      if (b2.bodyPct >= 3 && !b2.isYang && Math.abs(b1.pct) < 1.5 && p.isYang && p.bodyPct >= 2.5 &&
          c.close > (c2.open + c2.close) / 2) {
        patterns.push({ idx: i, name: '早晨之星', type: 'bull', strength: 5, pos: k, desc: '经典底部反转三联形态' });
      }
      // 黄昏之星：大阳+小实体+大阴吞没
      if (b2.bodyPct >= 3 && b2.isYang && Math.abs(b1.pct) < 1.5 && !p.isYang && p.bodyPct >= 2.5 &&
          c.close < (c2.open + c2.close) / 2) {
        patterns.push({ idx: i, name: '黄昏之星', type: 'bear', strength: 5, pos: k, desc: '经典顶部反转三联形态' });
      }
      // 两阳夹一阴（多头炮）
      if (b2.isYang && !b1.isYang && p.isYang && c.close > c2.close && b2.bodyPct >= 1.5 && p.bodyPct >= 1.5 && Math.abs(b1.pct) < 3) {
        patterns.push({ idx: i, name: '两阳夹一阴', type: 'bull', strength: 4, pos: k, desc: '多头炮形态，洗盘后再攻' });
      }
      // 两阴夹一阳（空头炮）
      if (!b2.isYang && b1.isYang && !p.isYang && c.close < c2.close && b2.bodyPct >= 1.5 && p.bodyPct >= 1.5 && Math.abs(b1.pct) < 3) {
        patterns.push({ idx: i, name: '两阴夹一阳', type: 'bear', strength: 4, pos: k, desc: '空头炮形态，反弹夭折' });
      }
    }
  }

  // 去重（同一根K线同形态只留一个，取强度最高的）
  var seen = {};
  var unique = [];
  patterns.sort(function(a, b) { return b.strength - a.strength; });
  for (var j = 0; j < patterns.length; j++) {
    var key = patterns[j].idx + '_' + patterns[j].name;
    if (!seen[key]) { seen[key] = true; unique.push(patterns[j]); }
  }
  return unique;
}

/* ===== 二、指标计算 ===== */

function stfCalcMA(data, period, endIdx) {
  if (endIdx < period - 1) return 0;
  var sum = 0;
  for (var i = endIdx - period + 1; i <= endIdx; i++) sum += data[i].close;
  return sum / period;
}

function stfCalcEMA(values, period) {
  var k = 2 / (period + 1);
  var ema = [values[0]];
  for (var i = 1; i < values.length; i++) {
    ema.push(values[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

function stfCalcMACD(data) {
  var closes = data.map(function(d) { return d.close; });
  var ema12 = stfCalcEMA(closes, 12);
  var ema26 = stfCalcEMA(closes, 26);
  var dif = [];
  for (var i = 0; i < closes.length; i++) dif.push(ema12[i] - ema26[i]);
  var dea = stfCalcEMA(dif, 9);
  var hist = [];
  for (var i = 0; i < closes.length; i++) hist.push((dif[i] - dea[i]) * 2);
  return { dif: dif, dea: dea, hist: hist };
}

function stfCalcKDJ(data, n) {
  n = n || 9;
  var k = 50, d = 50, j = 50;
  var kArr = [], dArr = [];
  for (var i = 0; i < data.length; i++) {
    if (i < n - 1) { kArr.push(50); dArr.push(50); continue; }
    var hh = -Infinity, ll = Infinity;
    for (var j2 = i - n + 1; j2 <= i; j2++) {
      if (data[j2].high > hh) hh = data[j2].high;
      if (data[j2].low < ll) ll = data[j2].low;
    }
    var rsv = hh === ll ? 50 : (data[i].close - ll) / (hh - ll) * 100;
    k = 2 / 3 * k + 1 / 3 * rsv;
    d = 2 / 3 * d + 1 / 3 * k;
    j = 3 * k - 2 * d;
    kArr.push(k); dArr.push(d);
  }
  return { k: kArr, d: dArr, j: j, lastK: kArr[kArr.length - 1], lastD: dArr[dArr.length - 1] };
}

function stfCalcRSI(data, period) {
  period = period || 6;
  var gains = 0, losses = 0;
  var start = Math.max(1, data.length - period);
  for (var i = start; i < data.length; i++) {
    var ch = data[i].close - data[i - 1].close;
    if (ch > 0) gains += ch; else losses -= ch;
  }
  if (losses === 0) return 100;
  return 100 - 100 / (1 + gains / losses);
}

/* ===== 三、五维短线因子计算 ===== */

/**
 * STF主计算函数
 * @param {Array} klines - K线数据 [date, open, close, high, low, volume, ...]
 * @param {string} [code] - 股票代码（用于涨停幅度判断）
 * @returns {object} STF结果
 */
function calculateSTF(klines, code) {
  if (!klines || klines.length < 30) return null;

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

  if (data.length < 30) return null;

  var n = data.length;
  var last = data[n - 1];
  var prev = data[n - 2];
  var lastPct = (last.close - prev.close) / prev.close * 100;

  // 涨停幅度阈值（按代码判断板块）
  var limitPct = 10;
  var pure = (code || '').replace(/^(sh|sz|bj)/i, '');
  if (/^(300|301|302)/.test(pure) || /^68/.test(pure)) limitPct = 20;
  else if (/^(8|4|92)/.test(pure)) limitPct = 30;
  var limitThreshold = limitPct * 0.98;

  // === 维度1：动量爆发力（25%）===
  // 近3日累计涨幅 + 涨停基因 + 相对强度
  var pct3 = (last.close - data[n - 4].close) / data[n - 4].close * 100;
  var pct5 = (last.close - data[n - 6].close) / data[n - 6].close * 100;

  // 近20日涨停次数与连板
  var limitCount20 = 0, currentStreak = 0, maxStreak = 0;
  for (var i = n - 20; i < n; i++) {
    if (i < 1) continue;
    var p = (data[i].close - data[i - 1].close) / data[i - 1].close * 100;
    if (p >= limitThreshold) {
      limitCount20++;
      currentStreak++;
      if (currentStreak > maxStreak) maxStreak = currentStreak;
    } else {
      currentStreak = 0;
    }
  }

  // 动量爆发得分
  var m1 = Math.max(-30, Math.min(60, pct3 * 6));                 // 3日涨幅贡献 -30~60
  var m2 = limitCount20 * 12 + maxStreak * 8;                      // 涨停基因 0~60
  var m3 = lastPct >= 0 ? Math.min(15, lastPct * 5) : Math.max(-15, lastPct * 5); // 当日涨跌 -15~15
  var momentumScore = Math.max(0, Math.min(100, 50 + m1 * 0.5 + m2 * 0.5 + m3 * 0.8));

  // === 维度2：量能异动（25%）===
  var vol5 = 0, vol10 = 0, vol20 = 0;
  for (var i = n - 5; i < n; i++) vol5 += data[i].volume;
  for (var i = n - 10; i < n; i++) vol10 += data[i].volume;
  for (var i = n - 20; i < n; i++) vol20 += data[i].volume;
  vol5 /= 5; vol10 /= 10; vol20 /= 20;

  var volRatio = vol5 > 0 ? last.volume / (vol20 || 1) : 0;        // 量比（相对20日均量）
  var volTrend = vol20 > 0 ? vol5 / vol20 : 1;                      // 近5日均量/20日均量

  // 温和放量(1.5-4x)=最佳；巨量(>6x)警惕出货；缩量(<0.7)=人气不足
  var v1;
  if (volRatio >= 1.5 && volRatio <= 4) v1 = 70;
  else if (volRatio > 4 && volRatio <= 6) v1 = 55;
  else if (volRatio > 6) v1 = 35;
  else if (volRatio >= 0.9) v1 = 50;
  else if (volRatio >= 0.7) v1 = 35;
  else v1 = 20;

  // 放量上涨加分，放量下跌减分
  var v2 = lastPct > 0 ? 25 : -25;
  // 量能趋势
  var v3 = volTrend > 1.3 ? 20 : (volTrend > 0.9 ? 10 : -10);
  var volumeScore = Math.max(0, Math.min(100, 50 + (v1 - 50) + v2 + v3 * 0.8));

  // === 维度3：K线形态（20%）===
  var patterns = stfDetectPatterns(data);
  // 取最近3根K线内的形态
  var recentPatterns = patterns.filter(function(pt) { return pt.pos <= 2; });
  var bullStrength = 0, bearStrength = 0;
  var patternScoreBase = 50;
  for (var i = 0; i < recentPatterns.length; i++) {
    var pt = recentPatterns[i];
    var weight = pt.pos === 0 ? 1.0 : (pt.pos === 1 ? 0.7 : 0.5); // 越新权重越高
    if (pt.type === 'bull') bullStrength += pt.strength * weight;
    else if (pt.type === 'bear') bearStrength += pt.strength * weight;
  }
  var patternScore = Math.max(0, Math.min(100, patternScoreBase + (bullStrength - bearStrength) * 4));

  // === 维度4：技术指标共振（15%）===
  var macd = stfCalcMACD(data);
  var macdIdx = data.length - 1;
  var dif = macd.dif[macdIdx], dea = macd.dea[macdIdx], hist = macd.hist[macdIdx];
  var histPrev = macd.hist[macdIdx - 1];
  var macdGoldenCross = dif > dea && macd.dif[macdIdx - 1] <= macd.dea[macdIdx - 1];
  var macdDeadCross = dif < dea && macd.dif[macdIdx - 1] >= macd.dea[macdIdx - 1];
  var macdAboveZero = dif > 0;
  var histExpanding = Math.abs(hist) > Math.abs(histPrev);

  var kdj = stfCalcKDJ(data);
  var kdjGolden = kdj.lastK > kdj.lastD && kdj.k[kdj.k.length - 2] <= kdj.d[kdj.d.length - 2];
  var rsi = stfCalcRSI(data, 6);

  var ma5 = stfCalcMA(data, 5, n - 1), ma10 = stfCalcMA(data, 10, n - 1),
      ma20 = stfCalcMA(data, 20, n - 1), ma60 = stfCalcMA(data, 60, n - 1);
  var maBull = ma5 > ma10 && ma10 > ma20 && ma20 > (ma60 || ma20 * 0.9); // 多头排列
  var maBear = ma5 < ma10 && ma10 < ma20;
  var aboveMa5 = last.close > ma5;

  var indScore = 50;
  if (macdGoldenCross) indScore += 15;
  if (macdDeadCross) indScore -= 15;
  if (macdAboveZero) indScore += 10; else indScore -= 8;
  if (histExpanding && hist > 0) indScore += 8;
  if (kdjGolden) indScore += 10;
  if (kdj.lastK < 20) indScore += 8;          // KDJ超卖反弹机会
  if (kdj.lastK > 90) indScore -= 5;          // 极度超买
  if (maBull) indScore += 12;
  if (maBear) indScore -= 12;
  if (aboveMa5) indScore += 5;
  if (rsi > 80) indScore -= 8;
  if (rsi < 25) indScore += 6;
  var indicatorScore = Math.max(0, Math.min(100, indScore));

  // === 维度5：短线博弈情绪（15%）===
  var range = (last.high - last.low) / prev.close * 100;             // 当日振幅
  var upperShadow = last.high - Math.max(last.open, last.close);
  var lowerShadow = Math.min(last.open, last.close) - last.low;
  var body = Math.abs(last.close - last.open);
  var closePos = last.high > last.low ? (last.close - last.low) / (last.high - last.low) : 0.5; // 收盘位置

  // 缺口检测
  var gapUp = n >= 2 && last.low > data[n - 2].high ? (last.low - data[n - 2].high) / prev.close * 100 : 0;
  var gapDown = n >= 2 && last.high < data[n - 2].low ? (data[n - 2].low - last.high) / prev.close * 100 : 0;

  var e1 = range >= 3 && range <= 9 ? 15 : (range > 12 ? 5 : 8);    // 适度振幅活跃
  var e2 = closePos > 0.7 ? 20 : (closePos < 0.3 ? -20 : 5);        // 收盘强势
  var e3 = gapUp > 0.5 ? 18 : (gapDown > 0.5 ? -18 : 0);            // 跳空方向
  var e4 = lowerShadow > body * 1.5 && body > 0 ? 12 : (upperShadow > body * 1.5 && body > 0 ? -12 : 0); // 下影买盘
  var e5 = limitCount20 > 0 ? 10 : 0;                                 // 有涨停基因=有资金关注
  var emotionScore = Math.max(0, Math.min(100, 50 + (e1 - 8) + e2 + e3 + e4 + e5));

  // === 综合STF ===
  var stf = Math.round(
    momentumScore * 0.25 +
    volumeScore * 0.25 +
    patternScore * 0.20 +
    indicatorScore * 0.15 +
    emotionScore * 0.15
  );
  stf = Math.max(0, Math.min(100, stf));

  // ATR止损位
  var atr = 0;
  if (n >= 15) {
    var trSum = 0;
    for (var i = n - 14; i < n; i++) {
      var tr = Math.max(data[i].high - data[i].low,
        Math.abs(data[i].high - data[i - 1].close),
        Math.abs(data[i].low - data[i - 1].close));
      trSum += tr;
    }
    atr = trSum / 14;
  }

  // 支撑压力位
  var recentHigh5 = Math.max.apply(null, data.slice(Math.max(0, n - 5), n).map(function(d) { return d.high; }));
  var recentLow5 = Math.min.apply(null, data.slice(Math.max(0, n - 5), n).map(function(d) { return d.low; }));

  return {
    stf: stf,
    dimensions: {
      momentum: Math.round(momentumScore),
      volume: Math.round(volumeScore),
      pattern: Math.round(patternScore),
      indicator: Math.round(indicatorScore),
      emotion: Math.round(emotionScore)
    },
    raw: {
      lastPct: lastPct, pct3: pct3, pct5: pct5,
      limitCount20: limitCount20, maxStreak: maxStreak, limitPct: limitPct,
      volRatio: volRatio, volTrend: volTrend,
      rsi: rsi, kdjK: kdj.lastK, kdjD: kdj.lastD,
      macdGoldenCross: macdGoldenCross, macdDeadCross: macdDeadCross,
      macdAboveZero: macdAboveZero, kdjGolden: kdjGolden,
      maBull: maBull, maBear: maBear, aboveMa5: aboveMa5,
      range: range, closePos: closePos, gapUp: gapUp, gapDown: gapDown,
      atr: atr, ma5: ma5, ma10: ma10, ma20: ma20, ma60: ma60,
      recentHigh5: recentHigh5, recentLow5: recentLow5
    },
    patterns: patterns,
    data: data
  };
}

/* ===== 四、战法匹配系统 ===== */

/**
 * @param {object} stfRes - calculateSTF结果
 * @returns {Array} 命中的战法列表（按匹配度排序）
 */
function stfMatchStrategies(stfRes) {
  var r = stfRes.raw;
  var data = stfRes.data;
  var n = data.length;
  var last = data[n - 1];
  var matched = [];

  // 1. 龙头战法：连板≥2 或 近20日涨停≥2 且当前仍强
  if (r.maxStreak >= 2 || r.limitCount20 >= 3) {
    var stillStrong = r.pct3 > 0 || r.lastPct > -2;
    matched.push({
      name: '龙头战法', match: r.maxStreak >= 2 ? 90 : 75, icon: '🐉',
      desc: '近20日' + r.limitCount20 + '次涨停' + (r.maxStreak >= 2 ? '，最高' + r.maxStreak + '连板' : '') + '，具备龙头基因',
      action: stillStrong ? '龙头回调低吸或分歧转一致时接力' : '龙头进入退潮期，观察是否二波',
      risk: '高位分歧大，严格止损；退潮期不接力'
    });
  }

  // 2. 低吸战法：强势股缩量回调至10日线
  if (r.limitCount20 >= 1 && r.lastPct < 1 && r.volRatio < 0.85) {
    var nearMa10 = Math.abs(last.close - r.ma10) / r.ma10 < 0.03 || last.close <= r.ma10;
    if (nearMa10) {
      matched.push({
        name: '强势低吸战法', match: 80, icon: '🎯',
        desc: '有涨停基因+缩量回调至10日线附近（量比' + r.volRatio.toFixed(2) + '），洗盘特征',
        action: '10日线附近分批低吸，跌破20日线止损',
        risk: '若放量跌破10日线则洗盘变出货，立即离场'
      });
    }
  }

  // 3. 突破战法：横盘平台后放量突破
  if (n >= 30) {
    var platform = data.slice(n - 15, n - 1);
    var pHigh = Math.max.apply(null, platform.map(function(d) { return d.high; }));
    var pLow = Math.min.apply(null, platform.map(function(d) { return d.low; }));
    var pRange = (pHigh - pLow) / pLow * 100;
    if (pRange < 12 && last.close > pHigh && r.volRatio > 1.5 && r.lastPct > 2) {
      matched.push({
        name: '平台突破战法', match: 85, icon: '🚀',
        desc: '15日横盘（振幅' + pRange.toFixed(1) + '%）后放量突破平台高点' + pHigh.toFixed(2),
        action: '突破点买入，回踩平台高点不破可加仓',
        risk: '假突破：3日内跌回平台内则止损'
      });
    }
  }

  // 4. 超跌反弹战法
  var pct10 = (last.close - data[n - 11].close) / data[n - 11].close * 100;
  if (pct10 < -12) {
    var lastCandle = stfAnalyzeCandle(last, data[n - 2].close);
    var stopDrop = lastCandle.isHammer || lastCandle.lowerShadow > lastCandle.body * 1.5 || r.volRatio < 0.8 || Math.abs(r.lastPct) < 1;
    if (stopDrop) {
      matched.push({
        name: '超跌反弹战法', match: 70, icon: '🛡️',
        desc: '10日跌幅' + pct10.toFixed(1) + '%，出现缩量止跌/长下影企稳信号',
        action: '轻仓试错博反弹，反弹至10日线/缺口位减仓',
        risk: '超跌股反弹持续性差，严格快进快出'
      });
    }
  }

  // 5. 趋势加速战法：均线多头+3日线陡峭+量能温和
  if (r.maBull && r.pct5 > 3 && r.volTrend > 1 && r.volTrend < 3 && last.close > r.ma5) {
    matched.push({
      name: '趋势加速战法', match: 75, icon: '📈',
      desc: '均线多头排列+5日涨' + r.pct5.toFixed(1) + '%+量能温和放大（量能比' + r.volTrend.toFixed(2) + '）',
      action: '沿5日线持有，偏离5日线>8%可止盈',
      risk: '放量跌破5日线减仓，跌破10日线清仓'
    });
  }

  // 6. 涨停回马枪：涨停后回调2-4日不破起点，今日企稳
  if (r.limitCount20 >= 1 && r.maxStreak < 2) {
    // 找最近一次涨停位置
    for (var i = n - 2; i >= Math.max(1, n - 8); i--) {
      var p = (data[i].close - data[i - 1].close) / data[i - 1].close * 100;
      if (p >= r.limitPct * 0.98) {
        var daysAfter = n - 1 - i;
        var limitStart = data[i - 1].close;
        if (daysAfter >= 2 && daysAfter <= 5 && last.close > limitStart * 0.95 && Math.abs(r.lastPct) < 3) {
          matched.push({
            name: '涨停回马枪', match: 78, icon: '🔄',
            desc: daysAfter + '日前涨停，回调未破涨停起点（现价' + last.close.toFixed(2) + ' vs 起点' + limitStart.toFixed(2) + '），今日企稳',
            action: '企稳信号出现可介入，博二次上攻',
            risk: '跌破涨停起点(-5%)止损'
          });
        }
        break;
      }
    }
  }

  // 7. 首板启动战法：长期横盘后首次放量涨停/大阳
  if (r.lastPct >= r.limitPct * 0.95 && r.limitCount20 === 1) {
    var before = data.slice(Math.max(0, n - 30), n - 1);
    var bHigh = Math.max.apply(null, before.map(function(d) { return d.high; }));
    var bLow = Math.min.apply(null, before.map(function(d) { return d.low; }));
    if ((bHigh - bLow) / bLow * 100 < 25 && r.volRatio > 2) {
      matched.push({
        name: '首板启动战法', match: 82, icon: '⚡',
        desc: '30日横盘（振幅' + ((bHigh - bLow) / bLow * 100).toFixed(0) + '%）后首次涨停，量比' + r.volRatio.toFixed(1),
        action: '首板次日竞价/低开可介入，看能否连板',
        risk: '次日大幅高开>7%不追；断板次日不接力'
      });
    }
  }

  // 8. 十字星变盘战法：连续缩量十字星后方向选择
  var recentPatterns = stfRes.patterns.filter(function(pt) { return pt.pos <= 2; });
  var dojiCount = recentPatterns.filter(function(pt) { return pt.name === '十字星'; }).length;
  if (dojiCount >= 2 && r.volRatio < 0.9) {
    matched.push({
      name: '十字星变盘战法', match: 62, icon: '⚖️',
      desc: '近3日出现' + dojiCount + '个十字星+缩量，多空平衡临近变盘',
      action: '等方向确认后跟进：放量收阳做多，放量收阴观望',
      risk: '变盘方向未明前不重仓押注'
    });
  }

  matched.sort(function(a, b) { return b.match - a.match; });
  return matched;
}

/* ===== 五、STF评级与FTF联合决策 ===== */

function stfGetRating(stf) {
  if (stf >= 80) return { name: '一触即发', stars: 5, cls: 'stf-r5', emoji: '🔥', desc: '短线动能全面爆发，强势特征齐全', color: '#FF3333' };
  if (stf >= 65) return { name: '蓄势待发', stars: 4, cls: 'stf-r4', emoji: '💪', desc: '动能正在积聚，多数信号偏多', color: '#FF8B35' };
  if (stf >= 50) return { name: '温和偏强', stars: 3, cls: 'stf-r3', emoji: '🙂', desc: '信号中性偏多，可小仓参与', color: '#FFB800' };
  if (stf >= 35) return { name: '动能不足', stars: 2, cls: 'stf-r2', emoji: '😐', desc: '短线信号偏弱，建议观望', color: '#8899AA' };
  return { name: '短线走弱', stars: 1, cls: 'stf-r1', emoji: '😴', desc: '空头信号占优，回避等待企稳', color: '#00AA66' };
}

/**
 * FTF×STF联合决策矩阵
 * @param {number} stf - STF得分
 * @param {number} [ftf] - FTF得分（若可用）
 */
function stfJointDecision(stf, ftf) {
  if (typeof ftf !== 'number' || isNaN(ftf)) return null;

  var ftfLow = ftf <= 42;   // FTF低位（便宜）
  var stfHigh = stf >= 60;  // STF高位（有动能）

  if (ftfLow && stfHigh) {
    return {
      zone: 'golden', name: '黄金买点', emoji: '💎', cls: 'stf-zone-golden',
      desc: '位置低（FTF ' + ftf + '）+ 动能起（STF ' + stf + '）：便宜且有资金启动，低吸首选',
      action: '分批低吸，这是两个因子共振的最优区域'
    };
  }
  if (!ftfLow && stfHigh) {
    return {
      zone: 'hold', name: '强势持有', emoji: '🔥', cls: 'stf-zone-hold',
      desc: '位置偏高（FTF ' + ftf + '）但动能仍强（STF ' + stf + '）：趋势惯性中',
      action: '持仓者持有设移动止盈；空仓者不追高，等回调'
    };
  }
  if (ftfLow && !stfHigh) {
    return {
      zone: 'wait', name: '底部潜伏', emoji: '🌱', cls: 'stf-zone-wait',
      desc: '位置低（FTF ' + ftf + '）但动能未起（STF ' + stf + '）：便宜但没人拉',
      action: '观察仓或小仓潜伏，等STF升到60+再加仓'
    };
  }
  return {
    zone: 'risk', name: '双重预警', emoji: '⚠️', cls: 'stf-zone-risk',
    desc: '位置高（FTF ' + ftf + '）+ 动能衰竭（STF ' + stf + '）：高位滞涨，风险区',
    action: '减仓/清仓，这是典型的波段卖点区域'
  };
}

/* ===== 六、渲染 ===== */

function renderSTF(klData, stockData, realtimePrice) {
  if (!klData || !klData.klines || klData.klines.length < 30) return;

  var area = document.getElementById('stockResultArea');
  if (!area) return;
  var detailEl = area.querySelector('.stock-detail');
  if (!detailEl) return;

  var code = (stockData && (stockData.code || stockData.secCode)) || '';
  var stfRes = calculateSTF(klData.klines, code);
  if (!stfRes) return;

  var rating = stfGetRating(stfRes.stf);
  var strategies = stfMatchStrategies(stfRes);
  var r = stfRes.raw;
  var last = stfRes.data[stfRes.data.length - 1];

  // FTF得分（若已计算，用于联合决策）
  var ftfScore = null;
  if (typeof _ftfLastScore === 'number') ftfScore = _ftfLastScore;
  var joint = stfJointDecision(stfRes.stf, ftfScore);

  var html = '<div class="sd-stf"><div class="sd-section sd-stf-section">' +
    '<div class="sd-section-title">⚡ 短线爆发因子 STF <span class="stf-sub">' + (code || stockData.name || '') + ' · 5-10日超短线视角</span></div>';

  // === 顶部：得分+评级+星级 ===
  html += '<div class="stf-hero ' + rating.cls + '">' +
    '<div class="stf-hero-left">' +
      '<div class="stf-score">' + stfRes.stf + '<span class="stf-score-unit">/100</span></div>' +
      '<div class="stf-stars">' + '★'.repeat(rating.stars) + '<span class="stf-stars-dim">' + '★'.repeat(5 - rating.stars) + '</span></div>' +
    '</div>' +
    '<div class="stf-hero-right">' +
      '<div class="stf-rating-name">' + rating.emoji + ' ' + rating.name + '</div>' +
      '<div class="stf-rating-desc">' + rating.desc + '</div>' +
    '</div>' +
  '</div>';

  // === FTF×STF联合决策 ===
  if (joint) {
    html += '<div class="stf-joint ' + joint.cls + '">' +
      '<div class="stf-joint-head"><b>FTF × STF 联合决策</b><span class="stf-joint-zone">' + joint.emoji + ' ' + joint.name + '</span></div>' +
      '<div class="stf-joint-desc">' + joint.desc + '</div>' +
      '<div class="stf-joint-action">👉 ' + joint.action + '</div>' +
    '</div>';
  } else {
    html += '<div class="stf-joint stf-zone-wait">' +
      '<div class="stf-joint-head"><b>FTF × STF 联合决策</b><span class="stf-joint-zone">⏳ 等待FTF数据</span></div>' +
      '<div class="stf-joint-desc">FTF（波段位置）加载后自动生成联合决策：FTF定位置，STF定择时</div>' +
    '</div>';
  }

  // === 五维因子 ===
  var dims = [
    { key: 'momentum', name: '动量爆发', icon: '🚀', v: stfRes.dimensions.momentum, desc: '3日涨' + r.pct3.toFixed(1) + '%·涨停' + r.limitCount20 + '次' },
    { key: 'volume', name: '量能异动', icon: '📊', v: stfRes.dimensions.volume, desc: '量比' + r.volRatio.toFixed(2) + '·量能趋势' + r.volTrend.toFixed(2) },
    { key: 'pattern', name: 'K线形态', icon: '🕯️', v: stfRes.dimensions.pattern, desc: (stfRes.patterns.filter(function(p){return p.pos===0;}).length > 0 ? '今日有形态信号' : '今日无经典形态') },
    { key: 'indicator', name: '指标共振', icon: '📈', v: stfRes.dimensions.indicator, desc: (r.macdGoldenCross ? 'MACD金叉 ' : r.macdDeadCross ? 'MACD死叉 ' : '') + (r.maBull ? '均线多头' : r.maBear ? '均线空头' : '均线缠绕') },
    { key: 'emotion', name: '博弈情绪', icon: '🎭', v: stfRes.dimensions.emotion, desc: '振幅' + r.range.toFixed(1) + '%·收盘位' + (r.closePos * 100).toFixed(0) + '%' }
  ];
  html += '<div class="stf-dims">';
  for (var i = 0; i < dims.length; i++) {
    var d = dims[i];
    var barCls = d.v >= 70 ? 'stf-dim-hot' : (d.v >= 50 ? 'stf-dim-warm' : 'stf-dim-cool');
    html += '<div class="stf-dim-row">' +
      '<span class="stf-dim-icon">' + d.icon + '</span>' +
      '<div class="stf-dim-body">' +
        '<div class="stf-dim-head"><b>' + d.name + '</b><span class="stf-dim-desc">' + d.desc + '</span><span class="stf-dim-val ' + barCls + '">' + d.v + '</span></div>' +
        '<div class="stf-dim-bar"><div class="stf-dim-fill ' + barCls + '" style="width:' + d.v + '%"></div></div>' +
      '</div>' +
    '</div>';
  }
  html += '</div>';

  // === 战法匹配 ===
  html += '<div class="stf-strategies">' +
    '<div class="stf-block-title">🎯 战法匹配（命中' + strategies.length + '个）</div>';
  if (strategies.length === 0) {
    html += '<div class="stf-none">当前走势未匹配到经典战法，属于普通行情，建议观望或用量化信号辅助</div>';
  } else {
    for (var i = 0; i < Math.min(4, strategies.length); i++) {
      var s = strategies[i];
      html += '<div class="stf-strategy-card">' +
        '<div class="stf-strategy-head">' +
          '<span class="stf-strategy-icon">' + s.icon + '</span>' +
          '<b class="stf-strategy-name">' + s.name + '</b>' +
          '<span class="stf-strategy-match">匹配度 ' + s.match + '%</span>' +
          '<div class="stf-strategy-match-bar"><div style="width:' + s.match + '%"></div></div>' +
        '</div>' +
        '<div class="stf-strategy-desc">' + s.desc + '</div>' +
        '<div class="stf-strategy-action">✅ <b>操作：</b>' + s.action + '</div>' +
        '<div class="stf-strategy-risk">⚠️ <b>风险：</b>' + s.risk + '</div>' +
      '</div>';
    }
  }
  html += '</div>';

  // === K线形态识别 ===
  var showPatterns = stfRes.patterns.slice(0, 6);
  html += '<div class="stf-patterns">' +
    '<div class="stf-block-title">🕯️ K线形态识别（近5日）</div>';
  if (showPatterns.length === 0) {
    html += '<div class="stf-none">近5日无经典K线形态</div>';
  } else {
    html += '<div class="stf-pattern-list">';
    for (var i = 0; i < showPatterns.length; i++) {
      var pt = showPatterns[i];
      var typeCls = pt.type === 'bull' ? 'stf-pt-bull' : (pt.type === 'bear' ? 'stf-pt-bear' : 'stf-pt-neutral');
      html += '<div class="stf-pattern-item">' +
        '<span class="stf-pt-badge ' + typeCls + '">' + (pt.type === 'bull' ? '▲看涨' : pt.type === 'bear' ? '▼看跌' : '●中性') + '</span>' +
        '<span class="stf-pt-name">' + pt.name + '</span>' +
        '<span class="stf-pt-when">' + (pt.pos === 0 ? '今日' : pt.pos + '日前') + '</span>' +
        '<div class="stf-pt-desc">' + pt.desc + '</div>' +
      '</div>';
    }
    html += '</div>';
  }
  html += '</div>';

  // === 技术指标面板 ===
  html += '<div class="stf-indicators">' +
    '<div class="stf-block-title">📉 技术指标共振</div>' +
    '<div class="stf-ind-grid">' +
      '<div class="stf-ind-item"><span>MACD</span><b class="' + (r.macdGoldenCross ? 'stf-ind-bull' : r.macdDeadCross ? 'stf-ind-bear' : (r.macdAboveZero ? 'stf-ind-bull' : 'stf-ind-bear')) + '">' + (r.macdGoldenCross ? '金叉↑' : r.macdDeadCross ? '死叉↓' : (r.macdAboveZero ? '零上多头' : '零下空头')) + '</b></div>' +
      '<div class="stf-ind-item"><span>KDJ</span><b class="' + (r.kdjGolden ? 'stf-ind-bull' : (r.kdjK > 80 ? 'stf-ind-bear' : r.kdjK < 20 ? 'stf-ind-bull' : '')) + '">' + (r.kdjGolden ? '金叉↑' : r.kdjK > 80 ? '超买' : r.kdjK < 20 ? '超卖' : 'K' + r.kdjK.toFixed(0)) + '</b></div>' +
      '<div class="stf-ind-item"><span>RSI(6)</span><b class="' + (r.rsi > 80 ? 'stf-ind-bear' : r.rsi < 25 ? 'stf-ind-bull' : '') + '">' + r.rsi.toFixed(0) + (r.rsi > 80 ? ' 超买' : r.rsi < 25 ? ' 超卖' : '') + '</b></div>' +
      '<div class="stf-ind-item"><span>均线</span><b class="' + (r.maBull ? 'stf-ind-bull' : r.maBear ? 'stf-ind-bear' : '') + '">' + (r.maBull ? '多头排列' : r.maBear ? '空头排列' : '缠绕') + '</b></div>' +
      '<div class="stf-ind-item"><span>量比</span><b class="' + (r.volRatio >= 1.5 && r.volRatio <= 4 ? 'stf-ind-bull' : r.volRatio > 6 ? 'stf-ind-bear' : '') + '">' + r.volRatio.toFixed(2) + '</b></div>' +
      '<div class="stf-ind-item"><span>缺口</span><b class="' + (r.gapUp > 0.5 ? 'stf-ind-bull' : r.gapDown > 0.5 ? 'stf-ind-bear' : '') + '">' + (r.gapUp > 0.5 ? '向上跳空+' + r.gapUp.toFixed(1) + '%' : r.gapDown > 0.5 ? '向下跳空-' + r.gapDown.toFixed(1) + '%' : '无') + '</b></div>' +
    '</div>' +
  '</div>';

  // === 短线作战计划 ===
  var entry, stop, target1, target2;
  if (stfRes.stf >= 65) {
    entry = '当前价' + (r.aboveMa5 ? '或回踩5日线' + r.ma5.toFixed(2) : r.ma5.toFixed(2) + '附近') + '介入';
    stop = (last.close - r.atr * 1.5).toFixed(2) + '（ATR×1.5，-(' + (r.atr * 1.5 / last.close * 100).toFixed(1) + '%)）';
    target1 = (last.close + r.atr * 2).toFixed(2);
    target2 = (last.close + r.atr * 3.5).toFixed(2);
  } else if (stfRes.stf >= 50) {
    entry = '轻仓试探，确认突破' + r.recentHigh5.toFixed(2) + '后加仓';
    stop = (last.close - r.atr * 1.2).toFixed(2);
    target1 = (last.close + r.atr * 1.5).toFixed(2);
    target2 = (last.close + r.atr * 2.5).toFixed(2);
  } else {
    entry = '观望为主，等STF≥60或出现明确止跌形态';
    stop = '不参与则无止损需求';
    target1 = '—';
    target2 = '—';
  }

  html += '<div class="stf-plan">' +
    '<div class="stf-block-title">📋 短线作战计划（按STF=' + stfRes.stf + '生成）</div>' +
    '<div class="stf-plan-grid">' +
      '<div class="stf-plan-item"><span class="stf-plan-label">🎯 买点</span><span>' + entry + '</span></div>' +
      '<div class="stf-plan-item"><span class="stf-plan-label">🛑 止损</span><span>' + stop + '</span></div>' +
      '<div class="stf-plan-item"><span class="stf-plan-label">🎯 目标1</span><span>' + target1 + (target1 !== '—' ? '（+ATR×2）' : '') + '</span></div>' +
      '<div class="stf-plan-item"><span class="stf-plan-label">🎯 目标2</span><span>' + target2 + (target2 !== '—' ? '（+ATR×3.5）' : '') + '</span></div>' +
      '<div class="stf-plan-item"><span class="stf-plan-label">📏 参考位</span><span>5日' + r.ma5.toFixed(2) + ' · 10日' + r.ma10.toFixed(2) + ' · 20日' + r.ma20.toFixed(2) + ' · 近5日高' + r.recentHigh5.toFixed(2) + '/低' + r.recentLow5.toFixed(2) + '</span></div>' +
    '</div>' +
  '</div>';

  // === 使用说明 ===
  html += '<div class="stf-guide">' +
    '<div class="stf-guide-title">📌 STF与FTF怎么配合用？</div>' +
    '<div class="stf-guide-text">FTF（未来趋势因子）回答<b>"现在贵不贵"</b>——位置高低，谷底买入峰顶卖出；' +
    'STF（短线爆发因子）回答<b>"短线会不会动"</b>——动能强弱，涨停基因/量能/形态/指标/情绪五维合成。' +
    '最佳用法：<b>FTF低位 + STF高分 = 黄金买点</b>（便宜且有人拉）；FTF高位 + STF走弱 = 减仓信号。</div>' +
    '<div class="stf-disclaimer">⚠️ STF基于日线量价数据与经典技术分析，适合5-10日超短线参考，不构成投资建议。短线风险极高，严格止损。</div>' +
  '</div>';

  html += '</div></div>';

  // 插入到FTF区块之后（或K线区块之后）
  var existing = detailEl.querySelector('.sd-stf');
  if (existing) existing.remove();

  var tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  var stfNode = tempDiv.firstChild;

  var ftfSection = detailEl.querySelector('.sd-ftf');
  var klineSection = detailEl.querySelector('.sd-kline');
  var addBtn = detailEl.querySelector('.sd-add-btn');

  if (ftfSection && ftfSection.nextSibling) {
    detailEl.insertBefore(stfNode, ftfSection.nextSibling);
  } else if (ftfSection) {
    detailEl.insertBefore(stfNode, addBtn || null);
  } else if (klineSection && klineSection.nextSibling) {
    detailEl.insertBefore(stfNode, klineSection.nextSibling);
  } else {
    detailEl.insertBefore(stfNode, addBtn || null);
  }
}
