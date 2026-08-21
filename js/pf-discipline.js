'use strict';

/* ============================================================
   PF-Discipline 组合纪律引擎 v1.0
   ------------------------------------------------------------
   四大铁律量化落地（用户指定，精确执行）：
   ① 选股标准：MACD日线回踩零轴不破 + 零轴附近金叉
      —— 比内幕消息更可靠，兼具底部抄入与稳定性
   ② 持股离场：股价运行于20日均线上方→持续持有；
      收盘跌破MA20→立即清仓（保命底线）
   ③ 买卖执行：站稳均线 + 放量才建仓；
      盈利+30%减仓1/3、+70%再减1/3，破均线全退
   ④ 止损纪律：收盘破线次日无条件离场；
      重新站上均线允许买回，杜绝侥幸死扛
   ============================================================ */

/* ============================================================
   一、MACD完整序列（标准12/26/9，返回与closes等长序列）
   ============================================================ */
function pfMACDSeries(closes) {
  var n = closes.length;
  if (n < 40) return null;
  var ef = 2 / 13, es = 2 / 27, ed = 2 / 10;
  var emaF = closes[0], emaS = closes[0];
  var dif = [], dea = [], hist = [];
  var deaV = 0;
  for (var i = 0; i < n; i++) {
    emaF = closes[i] * ef + emaF * (1 - ef);
    emaS = closes[i] * es + emaS * (1 - es);
    var d = emaF - emaS;
    deaV = (i === 0) ? d : d * ed + deaV * (1 - ed);
    dif.push(d);
    dea.push(deaV);
    hist.push(2 * (d - deaV));
  }
  return { dif: dif, dea: dea, hist: hist };
}

/* ============================================================
   二、铁律①：零轴回踩不破+金叉 检测
   ------------------------------------------------------------
   DIF按收盘价归一化（difPct = DIF/close×100）消除股价量纲
   条件逐项：
   c1 曾有高峰：近60日内 difPct 高峰 ≥ +1.2%（趋势存在过）
   c2 回踩零轴：高峰后 difPct 低点 ≤ +0.8%（DIF贴回零轴）
   c3 零轴不破：该低点 ≥ -0.25%（收盘口径未有效跌破）
   c4 零轴金叉：近3日内 DIF上穿DEA，且金叉时 difPct ≥ -0.15%
   状态：triggered 全勾 / armed 回踩完成+DIF-DEA缺口收窄待金叉
   ============================================================ */
function pfDetectZeroAx(data) {
  var n = data.length;
  var closes = data.map(function(d) { return d.close; });
  var m = pfMACDSeries(closes);
  var res = { state: 'none', conds: [], difPctNow: null, highPct: null, lowPct: null, crossDaysAgo: null, gapPct: null };

  if (!m) { res.state = 'nodata'; return res; }

  var difPct = m.dif.map(function(v, i) { return closes[i] > 0 ? v / closes[i] * 100 : 0; });
  var gapPct = m.dif.map(function(v, i) { return closes[i] > 0 ? (v - m.dea[i]) / closes[i] * 100 : 0; });

  var last = n - 1;
  res.difPctNow = difPct[last];
  res.gapPct = gapPct[last];

  /* c1 高峰：近60日 difPct 最大值 */
  var wStart = Math.max(35, n - 60);   /* MACD预热期前段不可靠 */
  var hiIdx = wStart, hiVal = -Infinity;
  for (var i = wStart; i <= last; i++) {
    if (difPct[i] > hiVal) { hiVal = difPct[i]; hiIdx = i; }
  }
  res.highPct = hiVal;
  var c1 = hiVal >= 1.2;
  res.conds.push({ key: 'peak', name: '趋势高峰存在', met: c1, detail: '60日内DIF峰=' + hiVal.toFixed(2) + '%（≥+1.2%）' });

  /* c2/c3 高峰后的回踩低点（含最新日） */
  var loIdx = hiIdx, loVal = Infinity;
  for (var j = hiIdx; j <= last; j++) {
    if (difPct[j] < loVal) { loVal = difPct[j]; loIdx = j; }
  }
  res.lowPct = loVal;
  var daysFromLow = last - loIdx;
  res.daysFromLow = daysFromLow;
  var c2 = c1 && loVal <= 0.8;
  res.conds.push({ key: 'pullback', name: 'DIF回踩零轴', met: c2, detail: '回落低点=' + loVal.toFixed(2) + '%（≤+0.8%）· 距今' + daysFromLow + '天' });
  var c3 = c1 && loVal >= -0.25;
  res.conds.push({ key: 'nobreak', name: '零轴不破', met: c3, detail: c3 ? '回踩全程守住零轴（≥-0.25%）' : 'DIF跌至' + loVal.toFixed(2) + '%，零轴已失守' });

  /* c4 零轴金叉：近3日内 dif上穿dea */
  var crossIdx = -1;
  for (var k = last; k > Math.max(wStart, last - 3); k--) {
    if (m.dif[k] > m.dea[k] && m.dif[k - 1] <= m.dea[k - 1]) { crossIdx = k; break; }
  }
  var crossDaysAgo = crossIdx >= 0 ? last - crossIdx : null;
  res.crossDaysAgo = crossDaysAgo;
  var c4 = crossIdx >= 0 && difPct[crossIdx] >= -0.15 && difPct[last] > difPct[crossIdx] - 0.5;
  res.conds.push({
    key: 'goldencross', name: '零轴金叉形成', met: c4,
    detail: crossIdx >= 0
      ? crossDaysAgo + '天前DIF上穿DEA，金叉位DIF=' + difPct[crossIdx].toFixed(2) + '%（≥-0.15%）'
      : '近3日无金叉（当前DIF-DEA缺口' + (res.gapPct >= 0 ? '+' : '') + res.gapPct.toFixed(2) + '%）'
  });

  var metCnt = 0;
  res.conds.forEach(function(c) { if (c.met) metCnt++; });
  res.metCnt = metCnt;

  if (c1 && c2 && c3 && c4) res.state = 'triggered';                 /* 首选：形态完整成立 */
  else if (c1 && c2 && c3 && Math.abs(res.gapPct) < 0.15) res.state = 'armed';  /* 回踩完成，只差金叉 */
  else if (metCnt >= 3) res.state = 'forming';
  else res.state = 'none';
  return res;
}

/* ============================================================
   三、铁律②④：MA20持股/清仓/买回 状态机
   ------------------------------------------------------------
   exit   收盘 < MA20 → 次日无条件离场（含连续破线N天）
   rebuy  曾破线≥1天后重新站上 → 允许买回（需站稳+放量确认）
   hold   站上MA20 且缓冲>2% → 持有
   alert  站上但缓冲≤2% → 贴线警戒
   ============================================================ */
function pfMA20State(data, realtimePrice) {
  var n = data.length;
  if (n < 25) return null;

  /* MA20序列 */
  var ma20Arr = new Array(n).fill(null);
  var sum = 0;
  for (var i = 0; i < n; i++) {
    sum += data[i].close;
    if (i >= 20) sum -= data[i - 20].close;
    if (i >= 19) ma20Arr[i] = sum / 20;
  }

  /* 最新收盘价（盘中用实时价替代） */
  var close = data[n - 1].close;
  if (realtimePrice && realtimePrice > 0 && Math.abs(realtimePrice - close) / close > 0.0001) close = realtimePrice;

  var ma20 = ma20Arr[n - 1];
  var distPct = ma20 > 0 ? (close - ma20) / ma20 * 100 : 0;
  var above = close > ma20;

  /* 连续站上/跌破天数（从最新往前数） */
  var daysAbove = 0, daysBelow = 0;
  for (var b = n - 1; b >= 19; b--) {
    if (data[b].close > ma20Arr[b]) daysAbove++;
    else break;
  }
  for (var c = n - 1; c >= 19; c--) {
    if (data[c].close <= ma20Arr[c]) daysBelow++;
    else break;
  }
  /* 历史破线标记：近10日内曾有破线 */
  var brokeRecently = false;
  for (var r = n - 2; r >= Math.max(19, n - 11); r--) {
    if (data[r].close <= ma20Arr[r]) { brokeRecently = true; break; }
  }

  /* 铁律③建仓条件：站稳（≥2天）+ 放量（今量≥前5日均量×1.5） */
  var prev5Vol = 0;
  for (var v = n - 6; v <= n - 2; v++) prev5Vol += data[v].volume;
  prev5Vol /= 5;
  var volRatio = prev5Vol > 0 ? data[n - 1].volume / prev5Vol : 0;
  var stable = daysAbove >= 2;
  var volSurge = volRatio >= 1.5;
  var buildOK = above && stable && volSurge;

  var state, action;
  if (!above) {
    state = 'exit';
    action = daysBelow >= 2
      ? '已连续破线' + daysBelow + '天 · 仍在MA20下方，持币等待，重新站上再考虑买回'
      : '今日收盘破MA20 · 次日开盘无条件离场，不抱侥幸';
  } else if (brokeRecently && daysAbove <= 3) {
    state = 'rebuy';
    action = '破线后第' + daysAbove + '天重新站上MA20 · 允许买回，' + (buildOK ? '站稳+放量已确认，可接回' : '需站稳2日+放量（今量/5日均量=' + volRatio.toFixed(2) + '）再接回');
  } else if (distPct <= 2) {
    state = 'alert';
    action = '贴线运行（偏离仅' + distPct.toFixed(1) + '%）· 继续持有但设好破线清仓预案';
  } else {
    state = 'hold';
    action = '站上MA20第' + daysAbove + '天（偏离+' + distPct.toFixed(1) + '%）· 纪律内持续持有';
  }

  return {
    state: state, action: action,
    close: close, ma20: ma20, distPct: distPct, above: above,
    daysAbove: daysAbove, daysBelow: daysBelow, brokeRecently: brokeRecently,
    volRatio: volRatio, stable: stable, volSurge: volSurge, buildOK: buildOK,
    buildConds: [
      { name: '站稳MA20≥2天', met: stable, detail: '已站上' + daysAbove + '天' },
      { name: '放量≥5日均量×1.5', met: volSurge, detail: '今量/5日均量=' + volRatio.toFixed(2) + '（≥1.50）' }
    ]
  };
}

/* ============================================================
   四、铁律③：盈利减仓阶梯 +30%/-1/3 +70%/再-1/3
   ============================================================ */
function pfLadder(cost, price) {
  var res = { hasCost: false, cost: cost, profitPct: null, t1: null, t2: null, stage: 0, stageText: '未设成本' };
  if (!cost || cost <= 0 || !price || price <= 0) return res;
  res.hasCost = true;
  res.profitPct = (price - cost) / cost * 100;
  res.t1 = cost * 1.30;
  res.t2 = cost * 1.70;
  if (res.profitPct >= 70) { res.stage = 2; res.stageText = '已过+70%线 · 第二次减仓1/3已执行，剩余仓位跟MA20走'; }
  else if (res.profitPct >= 30) { res.stage = 1; res.stageText = '已过+30%线 · 执行第一次减仓1/3，剩余下看+70%'; }
  else { res.stage = 0; res.stageText = '浮盈' + (res.profitPct >= 0 ? '+' : '') + res.profitPct.toFixed(1) + '% · 距+30%减仓线还差' + (30 - res.profitPct).toFixed(1) + 'pct'; }
  return res;
}

/* ============================================================
   五、综合纪律体检（单只持仓）
   ------------------------------------------------------------
   裁决优先级：EXIT破线清仓 > TRIM减仓执行 > REBUY买回窗口
               > ALERT贴线警戒 > HOLD纪律持有
   ============================================================ */
var PF_VERDICT_META = {
  EXIT:  { cls: 'pf-exit',  rank: 0, label: '🚨 破线清仓', short: '清仓' },
  TRIM:  { cls: 'pf-trim',  rank: 1, label: '✂️ 减仓执行', short: '减仓' },
  REBUY: { cls: 'pf-rebuy', rank: 2, label: '🔁 买回窗口', short: '买回' },
  ALERT: { cls: 'pf-alert', rank: 3, label: '⚠️ 贴线警戒', short: '警戒' },
  HOLD:  { cls: 'pf-hold',  rank: 4, label: '✅ 纪律持有', short: '持有' }
};

function pfDisciplineAnalyze(klines, realtimePrice, cost) {
  if (!klines || klines.length < 65) return null;
  var data = klines.map(function(k) {
    return { date: k[0], open: parseFloat(k[1]) || 0, close: parseFloat(k[2]) || 0, high: parseFloat(k[3]) || 0, low: parseFloat(k[4]) || 0, volume: parseFloat(k[5]) || 0 };
  }).filter(function(d) { return d.close > 0; });
  if (data.length < 65) return null;

  var macd = pfDetectZeroAx(data);
  var maState = pfMA20State(data, realtimePrice);
  if (!maState) return null;
  var ladder = pfLadder(cost, maState.close);

  /* 裁决 */
  var verdict;
  if (maState.state === 'exit') verdict = 'EXIT';
  else if (ladder.hasCost && maState.above && ladder.stage >= 1) verdict = 'TRIM';
  else if (maState.state === 'rebuy') verdict = 'REBUY';
  else if (maState.state === 'alert') verdict = 'ALERT';
  else verdict = 'HOLD';

  /* 零轴金叉标记（选股标准命中 → 加仓/新建仓候选） */
  var macdTag = macd.state === 'triggered' ? 'zeroAxHit' : (macd.state === 'armed' ? 'zeroAxWatch' : '');

  return {
    verdict: verdict, verdictMeta: PF_VERDICT_META[verdict],
    macd: macd, macdTag: macdTag, ma: maState, ladder: ladder,
    lastDate: data[data.length - 1].date
  };
}

/* ============================================================
   六、扫描与缓存
   ============================================================ */
var _pfDiscCache = {};      /* {code: {res, ts}} */
var _pfScanning = false;
var _pfAutoScanned = false; /* 每会话首次进组合页自动体检一次 */
var PF_CACHE_TTL = 30 * 60 * 1000;

function pfIsCacheValid(code) {
  var c = _pfDiscCache[code];
  return c && (Date.now() - c.ts < PF_CACHE_TTL);
}

/** 全组合纪律体检：逐只拉90日K线（复用rotation并发队列） */
function pfDisciplineScan(force) {
  if (_pfScanning) { showToast('纪律体检进行中...'); return; }
  var all = [];
  _portfolios.forEach(function(p) { p.items.forEach(function(it) { all.push(it); }); });
  if (all.length === 0) { showToast('组合中暂无个股'); return; }

  var need = all.filter(function(it) { return force || !pfIsCacheValid(it.code); });
  if (need.length === 0) {
    renderPortfolioDiscipline();
    showToast('纪律体检已是最新（30分钟内）');
    return;
  }

  _pfScanning = true;
  var btn = document.getElementById('pfDisciplineBtn');
  if (btn) { btn.disabled = true; btn.textContent = '体检中 ' + (all.length - need.length) + '/' + all.length; }
  renderPortfolioDiscipline(true, all.length - need.length, all.length);

  var done = 0;
  need.forEach(function(item) {
    var tcode = _codeToTencent(item.code);
    fetchKline(tcode, 90).then(function(kd) {
      var rt = _portfolioPriceCache[item.code] ? _portfolioPriceCache[item.code].price : 0;
      var res = pfDisciplineAnalyze(kd.klines || [], rt, item.cost || 0);
      if (res) _pfDiscCache[item.code] = { res: res, ts: Date.now(), klines: kd.klines || [] };
    }).catch(function() { /* 个股失败跳过 */ })
      .then(function() {
        done++;
        if (btn) btn.textContent = '体检中 ' + (all.length - need.length + done) + '/' + all.length;
        renderPortfolioDiscipline(true, all.length - need.length + done, all.length);
        if (done >= need.length) {
          _pfScanning = false;
          if (btn) { btn.disabled = false; btn.textContent = '⚖️ 纪律体检'; }
          renderPortfolioDiscipline();
          pfScanSummary();
        }
      });
  });

  /* 安全超时 */
  Perf.trackedSetTimeout(function() {
    if (_pfScanning) {
      _pfScanning = false;
      if (btn) { btn.disabled = false; btn.textContent = '⚖️ 纪律体检'; }
      renderPortfolioDiscipline();
    }
  }, 90000);
}

function pfScanSummary() {
  var cnt = { EXIT: 0, TRIM: 0, REBUY: 0, ALERT: 0, HOLD: 0 };
  var hit = 0;
  _portfolios.forEach(function(p) {
    p.items.forEach(function(it) {
      var c = _pfDiscCache[it.code];
      if (c) { cnt[c.res.verdict]++; if (c.res.macdTag === 'zeroAxHit') hit++; }
    });
  });
  var msg = '纪律体检完成';
  if (cnt.EXIT) msg += ' · ' + cnt.EXIT + '只须清仓';
  if (cnt.TRIM) msg += ' · ' + cnt.TRIM + '只须减仓';
  if (cnt.REBUY) msg += ' · ' + cnt.REBUY + '只可买回';
  if (hit) msg += ' · ' + hit + '只零轴金叉';
  showToast(msg);
}

/* ============================================================
   七、成本价设置（减仓阶梯基准）
   ============================================================ */
function pfSetCost(code) {
  var item = null;
  _portfolios.forEach(function(p) {
    p.items.forEach(function(it) { if (it.code === code) item = it; });
  });
  if (!item) return;
  var input = prompt('设置「' + item.name + '」持仓成本价（减仓阶梯按 +30%/+70% 计算）：', item.cost || '');
  if (input === null) return;
  var v = parseFloat(input);
  if (isNaN(v) || v <= 0) { showToast('成本价无效'); return; }
  item.cost = v;
  savePortfolios();
  /* 用缓存K线立即重算阶梯与裁决 */
  var c = _pfDiscCache[code];
  if (c && c.klines && c.klines.length) {
    var rt = _portfolioPriceCache[code] ? _portfolioPriceCache[code].price : 0;
    var res = pfDisciplineAnalyze(c.klines, rt, v);
    if (res) { c.res = res; c.ts = Date.now(); }
  }
  renderPortfolioDiscipline();
  showToast('成本价已设为 ' + v.toFixed(2) + '，阶梯已更新');
}

/* ============================================================
   八、渲染：组合纪律面板
   ============================================================ */
function renderPortfolioDiscipline(loading, done, total) {
  var panel = document.getElementById('pfDisciplinePanel');
  if (!panel) return;

  var all = [];
  _portfolios.forEach(function(p) { p.items.forEach(function(it) { all.push(it); }); });
  if (all.length === 0) { panel.innerHTML = ''; panel.style.display = 'none'; return; }
  panel.style.display = '';

  var html = '<div class="pf-disc">' +
    '<div class="pf-disc-head">' +
      '<span class="pf-disc-title">⚖️ 纪律体检 <span class="pf-disc-sub">MACD零轴金叉选股 · MA20保命线 · +30%/+70%分批止盈</span></span>' +
      '<span class="pf-disc-refresh" onclick="pfDisciplineScan(true)" title="强制重新体检">⟳</span>' +
    '</div>' +
    '<div class="pf-rules-bar">' +
      '<span>① 首选：MACD回踩零轴不破+金叉</span><span>② 破MA20即清仓</span><span>③ 站稳放量建仓·+30%/+70%减仓</span><span>④ 破线次日无条件走</span>' +
    '</div>';

  if (loading) {
    html += '<div class="pf-loading">⏳ 纪律体检中 ' + done + '/' + total + ' · 拉取90日K线逐项核验…</div>';
  }

  /* 收集有结果的，按裁决优先级排序 */
  var rows = [];
  var missing = 0;
  all.forEach(function(it) {
    var c = _pfDiscCache[it.code];
    if (c) rows.push({ item: it, res: c.res });
    else missing++;
  });
  rows.sort(function(a, b) { return a.res.verdictMeta.rank - b.res.verdictMeta.rank; });

  if (rows.length === 0 && !loading) {
    html += '<div class="pf-loading">尚未体检 · 点击右上「⚖️ 纪律体检」或「分析信号」开始</div>';
  }

  rows.forEach(function(r) { html += pfRenderRow(r.item, r.res); });

  if (missing > 0 && !loading) html += '<div class="pf-missing">… 其余' + missing + '只待体检（点⟳强制全量）</div>';

  html += '</div>';
  panel.innerHTML = html;
}

function _pf2(v) { return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'; }

function pfRenderRow(item, R) {
  var m = R.ma, mac = R.macd, ld = R.ladder;
  var vMeta = R.verdictMeta;

  /* MACD选股标签 */
  var macdHtml;
  if (mac.state === 'triggered') {
    macdHtml = '<span class="pf-macd-tag hit">🥇 零轴金叉成立·' + (mac.crossDaysAgo === 0 ? '今日' : mac.crossDaysAgo + '天前') + '</span>';
  } else if (mac.state === 'armed') {
    macdHtml = '<span class="pf-macd-tag watch">👀 回踩零轴·待金叉</span>';
  } else if (mac.state === 'forming') {
    macdHtml = '<span class="pf-macd-tag form">形态接近·' + mac.metCnt + '/4</span>';
  } else {
    macdHtml = '<span class="pf-macd-tag off">形态不符</span>';
  }

  /* MA20 行 */
  var maHtml = '<div class="pf-ma-line">' +
    '<span class="pf-ma-val">MA20 <b>' + m.ma20.toFixed(2) + '</b></span>' +
    '<span class="pf-ma-dist ' + (m.above ? 'up' : 'down') + '">现价' + m.close.toFixed(2) + '（' + _pf2(m.distPct) + '）</span>' +
    '<span class="pf-ma-days">' + (m.above ? '站上' + m.daysAbove + '天' : '破线' + (m.daysBelow || 1) + '天') + '</span>' +
    '</div>';

  /* 减仓阶梯 */
  var ladHtml;
  if (ld.hasCost) {
    var pos1 = Math.max(0, Math.min(100, (ld.profitPct / 70) * 100));
    var mark1 = ld.stage >= 1 ? '✂️' : '·';
    var mark2 = ld.stage >= 2 ? '✂️' : '·';
    ladHtml = '<div class="pf-ladder">' +
      '<div class="pf-lad-track">' +
        '<span class="pf-lad-mark" style="left:42.9%">+30%<i>' + mark1 + '</i></span>' +
        '<span class="pf-lad-mark" style="left:100%">+70%<i>' + mark2 + '</i></span>' +
        '<span class="pf-lad-cur" style="left:' + pos1 + '%"></span>' +
      '</div>' +
      '<div class="pf-lad-info">成本' + ld.cost.toFixed(2) + ' · 浮盈<b class="' + (ld.profitPct >= 0 ? 'up' : 'down') + '">' + _pf2(ld.profitPct) + '</b> · 减仓位 ' + ld.t1.toFixed(2) + ' / ' + ld.t2.toFixed(2) +
      ' <span class="pf-lad-edit" onclick="pfSetCost(\'' + item.code + '\')">✎改成本</span></div>' +
      '<div class="pf-lad-stage">' + ld.stageText + '</div>' +
    '</div>';
  } else {
    ladHtml = '<div class="pf-ladder nocost"><span class="pf-lad-set" onclick="pfSetCost(\'' + item.code + '\')">未设成本 · 点击设置（按+30%/+70%算减仓阶梯）</span></div>';
  }

  /* 建仓三条件（仅在买回/持有且用户可能加仓时显示精简版） */
  var buildHtml = '';
  if (m.state === 'rebuy' || mac.state === 'triggered') {
    var b1 = m.above;
    buildHtml = '<div class="pf-build">' +
      '<span class="' + (b1 ? 'pf-ok' : 'pf-no') + '">' + (b1 ? '✓' : '✗') + '站上MA20</span>' +
      m.buildConds.map(function(c) { return '<span class="' + (c.met ? 'pf-ok' : 'pf-no') + '">' + (c.met ? '✓' : '✗') + c.name + '</span>'; }).join('') +
      '</div>';
  }

  return '<div class="pf-row ' + vMeta.cls + '">' +
    '<div class="pf-row-head">' +
      '<span class="pf-row-name">' + escHTML(item.name) + ' <i>' + item.code + '</i></span>' +
      macdHtml +
      '<span class="pf-verdict ' + vMeta.cls + '">' + vMeta.label + '</span>' +
    '</div>' +
    '<div class="pf-row-action">' + m.action + '</div>' +
    maHtml + buildHtml + ladHtml +
  '</div>';
}
