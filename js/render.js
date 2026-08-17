'use strict';

// 兼容性格式化函数（在 app.js 的 formatDate 之前使用）
function formatDate(date) {
  var y = date.getFullYear();
  var m = String(date.getMonth() + 1).padStart(2, '0');
  var d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

// NEWS_DATA 在本文件后续定义（约第2175行），无需提前检查

/* ============================================================
   六、渲染指数卡片
   ============================================================ */

function renderIndexCards(realtimeData) {
  var container = document.getElementById('indexCards');
  var isRefresh = realtimeData !== null;
  var html = '';

  // 排序 — 使用动态数据排序（优先实时PE/分位）
  var indices = BASE_DATA.indices.slice();
  if (_indexSortKey) {
    indices.sort(function(a, b) {
      var rtA = realtimeData && realtimeData[a.code];
      var rtB = realtimeData && realtimeData[b.code];
      var peA = (rtA && rtA.pe && rtA.pe > 0) ? rtA.pe : a.pe;
      var peB = (rtB && rtB.pe && rtB.pe > 0) ? rtB.pe : b.pe;
      if (_indexSortKey === 'pe') return peA - peB;
      if (_indexSortKey === 'dy') {
        var dyA = a.dy, dyB = b.dy;
        if (rtA && rtA.pb && rtA.pb > 0 && a.pb > 0) dyA = a.dy * (a.pb / rtA.pb);
        if (rtB && rtB.pb && rtB.pb > 0 && b.pb > 0) dyB = b.dy * (b.pb / rtB.pb);
        return dyB - dyA; // 股息率高优先
      }
      if (_indexSortKey === 'pct10') {
        var pctA = a.pct10, pctB = b.pct10;
        if (peA !== a.pe) pctA = calcDynamicPct(a.pct10, a.pe, peA, a.peMin, a.peMax);
        if (peB !== b.pe) pctB = calcDynamicPct(b.pct10, b.pe, peB, b.peMin, b.peMax);
        return pctA - pctB; // 分位低优先
      }
      return 0;
    });
  }

  indices.forEach(function(idx) {
    var rt = realtimeData && realtimeData[idx.code];
    var price = rt ? formatPrice(rt.price) : '—';
    var changePct = rt ? roundPrecise(rt.changePercent, 2) : 0;
    var changeColor = getChangeColor(changePct);
    var changeStr = rt ? formatPercent(changePct, true) : '—';

    // PE/PB/DY 优先使用实时数据（高精度）
    var pe = idx.pe;
    var pb = idx.pb;
    var dy = idx.dy;
    if (rt && rt.pe && rt.pe > 0) pe = roundPrecise(rt.pe, 2);
    if (rt && rt.pb && rt.pb > 0) pb = roundPrecise(rt.pb, 2);
    // 股息率动态计算：DY = 基准DY * (基准PB / 实时PB)
    dy = calcDynamicDY(idx.dy, idx.pb, (rt && rt.pb > 0) ? rt.pb : idx.pb);
    // 动态分位：使用高精度锚点偏移法
    var pct = calcDynamicPct(idx.pct10, idx.pe, (rt && rt.pe > 0) ? roundPrecise(rt.pe, 2) : idx.pe, idx.peMin, idx.peMax);
    // PB分位动态更新
    var pbPct = idx.pbPct10 || 50;
    if (rt && rt.pe && rt.pe > 0) {
      var _pctShift = pct - idx.pct10;
      pbPct = Math.max(0, Math.min(100, Math.round((idx.pbPct10||50) + _pctShift)));
    }
    // 股息率分位动态更新：与价格成反比
    var dyPct = idx.dyPct10 || 50;
    if (rt && rt.pe && rt.pe > 0) {
      var _pctShift2 = pct - idx.pct10;
      dyPct = Math.max(0, Math.min(100, Math.round((idx.dyPct10||50) - _pctShift2)));
    }
    var pctColor = getPctColor(pct);
    var sig = getSignal(pct);

    html += '<div class="val-card" data-level="' + (pct < 30 ? 'low' : pct < 70 ? 'mid' : 'high') + '">' +
      '<div class="val-card-glow" style="background:radial-gradient(circle at 50% 0%, ' + pctColor + '15, transparent 70%)"></div>' +
      '<div class="val-card-accent" style="background:' + pctColor + '"></div>' +
      '<div class="card-top">' +
        '<div class="name-area">' +
          '<span class="dot pulse-dot" style="background:' + pctColor + ';box-shadow:0 0 6px ' + pctColor + '"><span class="dot-ring" style="border-color:' + pctColor + '"></span></span>' +
          '<div>' +
            '<div class="stk-name">' + idx.name + '</div>' +
            '<div class="stk-code">' + idx.code.replace('sh','').replace('sz','').replace('hk','HK:').replace('us','US:') + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="price-area">' +
          '<div class="stk-price odometer" style="color:' + changeColor + ';text-shadow:0 0 8px ' + changeColor + '44"><span class="odometer-inner">' + price + '</span></div>' +
          '<div class="stk-change odometer" style="color:' + changeColor + ';text-shadow:0 0 6px ' + changeColor + '44"><span class="odometer-inner">' + changeStr + '</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="metric-row">' +
        '<div class="metric"><span class="m-val odometer"><span class="odometer-inner">' + pe.toFixed(1) + '</span></span><span class="m-lbl">PE(TTM)</span></div>' +
        '<div class="metric"><span class="m-val odometer"><span class="odometer-inner">' + pb.toFixed(2) + '</span></span><span class="m-lbl">PB</span></div>' +
        '<div class="metric"><span class="m-val odometer"><span class="odometer-inner">' + dy.toFixed(2) + '%</span></span><span class="m-lbl">股息率</span></div>' +
        '<div class="metric"><span class="m-val odometer" style="color:' + pctColor + ';text-shadow:0 0 6px ' + pctColor + '44"><span class="odometer-inner">' + pct + '%</span></span><span class="m-lbl">10年分位</span></div>' +
      '</div>' +
      '<div class="pct-section">' +
        '<span class="pct-label">PE历史分位</span>' +
        '<div class="pct-bar-enhanced">' +
          '<div class="pbe-zones">' +
            '<div class="pbe-zone low"></div>' +
            '<div class="pbe-zone mid"></div>' +
            '<div class="pbe-zone high"></div>' +
          '</div>' +
          '<div class="pbe-fill" style="width:' + pct + '%;background:' + pctColor + ';box-shadow:0 0 6px ' + pctColor + '88"></div>' +
          '<div class="pbe-marker" style="left:50%"></div>' +
        '</div>' +
        '<span class="pct-val" style="color:' + pctColor + '">' + pct + '%</span>' +
      '</div>' +
      '<div class="idx-extra-tags">' +
        '<span class="extra-tag">PB分位 <b style="color:' + getPctColor(pbPct) + '">' + pbPct + '%</b></span>' +
        '<span class="extra-tag">股息率分位 <b style="color:' + getPctColor(100-dyPct) + '">' + dyPct + '%</b></span>' +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;margin-top:0.2rem">' +
        '<span class="sig ' + sig.cls + '">' + sig.text + '</span>' +
        '<span style="font-size:0.58rem;color:var(--muted)">PE ' + idx.peMin + '~' + idx.peMax + '</span>' +
      '</div>' +
    '</div>';
  });

  container.innerHTML = html;

  // 卡片入场动画：逐个延迟（仅首次渲染，刷新时不重复）
  if (!isRefresh) {
    var cards = container.querySelectorAll('.val-card');
    cards.forEach(function(card, i) {
      card.style.animationDelay = (i * 60) + 'ms';
    });
  }

  // 数据刷新时触发 odometer 滚动动效（使用 rAF 批量处理，避免大量 setTimeout）
  if (isRefresh) {
    var odometers = container.querySelectorAll('.odometer');
    requestAnimationFrame(function() {
      odometers.forEach(function(el, i) {
        // 用 CSS transition-delay 实现流水效果，避免 80 个 setTimeout
        el.style.transitionDelay = (i * 30) + 'ms';
        el.classList.add('odometer-rolling');
      });
      // 动画结束后清理
      Perf.trackedSetTimeout(function() {
 odometers.forEach(function(el) {
 el.classList.remove('odometer-rolling');
 el.style.transitionDelay = '';
 });
 }, 600 + odometers.length * 30);
    });
  }
}

/* ============================================================
   七、生成迷你折线图 SVG path
   ============================================================ */
function generateSparkline(minVal, maxVal, currentVal, pct) {
  // 生成20个点的模拟历史数据
  var points = 20;
  var data = [];
  for (var i = 0; i < points; i++) {
    // 模拟波动：前段较低，后段接近当前值
    var progress = i / (points - 1);
    var baseVal = minVal + (maxVal - minVal) * (pct / 100);
    var noise = (Math.sin(i * 0.8) + Math.cos(i * 1.3)) * 0.15;
    var v = minVal + (maxVal - minVal) * (progress * (pct / 100) + (1 - progress) * 0.3) + noise * (maxVal - minVal) * 0.2;
    v = Math.max(minVal, Math.min(maxVal, v));
    data.push(v);
  }
  // 最后一个点设为当前值
  data[points - 1] = currentVal;

  var width = 280, height = 40;
  var stepX = width / (points - 1);
  var range = maxVal - minVal || 1;

  var pathD = '';
  var areaD = '';
  data.forEach(function(v, i) {
    var x = i * stepX;
    var y = height - ((v - minVal) / range) * (height - 4) - 2;
    if (i === 0) {
      pathD += 'M' + x.toFixed(1) + ',' + y.toFixed(1);
      areaD += 'M' + x.toFixed(1) + ',' + height + ' L' + x.toFixed(1) + ',' + y.toFixed(1);
    } else {
      pathD += ' L' + x.toFixed(1) + ',' + y.toFixed(1);
      areaD += ' L' + x.toFixed(1) + ',' + y.toFixed(1);
    }
  });
  areaD += ' L' + width + ',' + height + ' Z';

  var lineColor = getPctColor(pct);
  var fillColor = lineColor + '20';

  return '<path d="' + areaD + '" fill="' + fillColor + '" stroke="none"/>' +
         '<path d="' + pathD + '" fill="none" stroke="' + lineColor + '" stroke-width="1.5" stroke-linejoin="round"/>';
}

/* ============================================================
   七-B、获取指数K线并绘制真实走势图
   ============================================================ */

/* PE走势图已移除，简化为历史分位显示 */

/* PE走势图相关函数已全部移除：simulatePEChange, generatePEHistory,
   drawPETrend, drawTrendPlaceholder, drawTrendError */

/* ============================================================
   八、Canvas 绘图：行业热力图
   ============================================================ */
function drawHeatmap() {
  var canvas = document.getElementById('heatmapCanvas');
  if (!canvas || !canvas.parentElement) return;
  var dpr = window.devicePixelRatio || 1;
  var w = canvas.parentElement.clientWidth - 24;
  
  // 根据数据类型确定显示值和颜色
  var typeLabel = _heatmapType === 'pe' ? 'PE' : _heatmapType === 'pb' ? 'PB' : _heatmapType === 'dy' ? '股息率' : '行业增速';
  var rt = _lastRealtimeData || {};
  var sectors = BASE_DATA.sectors.map(function(s) {
    var val, pct, displayVal;
    // 优先使用实时数据，回退到静态基准
    var pe = s.pe, pb = s.pb, dy = s.dy;
    var pePct = s.pct10, pbPct = s.pbPct10 || 50, dyPct = s.dyPct10 || 50;
    var rtS = rt[s.etfCode];
    if (rtS) {
      if (rtS.pe && rtS.pe > 0) {
        pe = roundPrecise(rtS.pe, 2);
        // 使用高精度锚点偏移法计算动态PE分位
        pePct = calcDynamicPct(s.pct10, s.pe, pe, s.peMin, s.peMax);
        var _shift = pePct - s.pct10;
        pbPct = Math.max(0, Math.min(100, Math.round((s.pbPct10||50) + _shift)));
        dyPct = Math.max(0, Math.min(100, Math.round((s.dyPct10||50) - _shift)));
      }
      if (rtS.pb && rtS.pb > 0) {
        pb = roundPrecise(rtS.pb, 2);
        // 股息率与价格成反比：DY = Dividend / Price，PB升高 → DY下降
        if (s.pb > 0) dy = s.dy * (s.pb / rtS.pb);
      }
    }
    if (_heatmapType === 'pe') {
      val = pe; pct = pePct; displayVal = 'PE ' + pe.toFixed(1);
    } else if (_heatmapType === 'pb') {
      val = pb; pct = pbPct; displayVal = 'PB ' + pb.toFixed(2);
    } else if (_heatmapType === 'growth') {
      val = s.growth; pct = s.growthPct; displayVal = (s.growth >= 0 ? '+' : '') + s.growth.toFixed(1) + '%';
    } else {
      val = dy; pct = dyPct; displayVal = 'DY ' + dy.toFixed(2) + '%';
    }
    return { name: s.name, val: val, pct: pct, displayVal: displayVal, pct10: pePct };
  });

  // 筛选
  if (_heatmapFilter === 'low') {
    sectors = sectors.filter(function(s) { return s.pct < 40; });
  } else if (_heatmapFilter === 'high') {
    sectors = sectors.filter(function(s) { return s.pct > 60; });
  } else if (_heatmapFilter === 'popular') {
    // 只看热门：增速分位>70 或 PE分位>70
    sectors = sectors.filter(function(s) { return s.pct > 70 || s.pct10 > 70; });
  }

  var screenWidth = window.innerWidth || document.documentElement.clientWidth || 480;
  var cols = screenWidth >= 1024 ? 6 : screenWidth >= 768 ? 5 : screenWidth >= 480 ? 4 : 3;
  var rows = Math.max(1, Math.ceil(sectors.length / cols));
  var cellH = screenWidth >= 768 ? 70 : 62;
  var h = Math.max(100, rows * cellH + (rows - 1) * 6);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  var ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);

  if (sectors.length === 0) {
    ctx.fillStyle = getCSSVar('--muted', '#7888a0');
    ctx.font = '12px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('无符合条件的行业', w / 2, h / 2);
    return;
  }

  var gap = 6;
  var cellW = (w - gap * (cols - 1)) / cols;
  var cellH = (h - gap * (rows - 1)) / rows;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  var hmLight = isLightMode();
  // 缓存 CSS 变量，避免循环内重复调用 getComputedStyle（性能优化）
  var cssInk = getCSSVar('--ink', '#E2E8F0');
  var cssMuted = getCSSVar('--muted', '#7888a0');
  var cssFontMono = getComputedStyle(document.documentElement).getPropertyValue('--font-mono') || 'monospace';
  sectors.forEach(function(s, i) {
    var col = i % cols;
    var row = Math.floor(i / cols);
    var x = col * (cellW + gap);
    var y = row * (cellH + gap);
    // 股息率分位越高越好（颜色反转）
    var displayPct = _heatmapType === 'dy' ? (100 - s.pct) : s.pct;
    var color = getPctColor(displayPct);

    // 圆角矩形背景（霓虹底色）
    ctx.fillStyle = color + (hmLight ? '30' : '15');
    roundRect(ctx, x, y, cellW, cellH, 2);
    ctx.fill();

    // 边框（霓虹发光）
    ctx.shadowColor = hmLight ? 'transparent' : color;
    ctx.shadowBlur = hmLight ? 0 : 4;
    ctx.strokeStyle = color + (hmLight ? 'AA' : '66');
    ctx.lineWidth = hmLight ? 1.5 : 0.5;
    roundRect(ctx, x, y, cellW, cellH, 2);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // 行业名
    ctx.fillStyle = cssInk;
    ctx.font = 'bold 12px ' + cssFontMono;
    ctx.fillText(s.name, x + cellW / 2, y + cellH / 2 - 8);

    // 值
    ctx.fillStyle = cssMuted;
    ctx.font = '10px ' + cssFontMono;
    ctx.fillText(s.displayVal, x + cellW / 2, y + cellH / 2 + 6);

    // 分位（带发光）
    ctx.shadowColor = hmLight ? 'transparent' : color;
    ctx.shadowBlur = hmLight ? 0 : 6;
    ctx.fillStyle = color;
    ctx.font = 'bold 11px ' + cssFontMono;
    ctx.fillText(s.pct + '%', x + cellW / 2, y + cellH / 2 + 20);
    ctx.shadowBlur = 0;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/* ============================================================
   九、Canvas 绘图：PE 对比柱状图
   ============================================================ */
function drawPEBar(realtimeData) {
  var canvas = document.getElementById('peBarCanvas');
  if (!canvas || !canvas.parentElement) return;
  var dpr = window.devicePixelRatio || 1;
  var w = canvas.parentElement.clientWidth - 24;
  var indices = BASE_DATA.indices;
  var screenWidth = window.innerWidth || document.documentElement.clientWidth || 480;
  var barH = screenWidth >= 768 ? 24 : 18;
  var gap = screenWidth >= 768 ? 8 : 6;
  var labelW = screenWidth >= 768 ? 90 : 70;
  var valW = screenWidth >= 768 ? 70 : 55;
  var chartX = labelW;
  var chartW = w - labelW - valW;
  var startY = 10;
  var h = startY * 2 + indices.length * (barH + gap);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  var ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);

  // 预计算每个指数的动态PE和分位（优先使用实时数据）
  var dynData = indices.map(function(idx) {
    var rt = realtimeData && realtimeData[idx.code];
    var pe = idx.pe;
    var pct = idx.pct10;
    if (rt && rt.pe && rt.pe > 0) {
      pe = roundPrecise(rt.pe, 2);
      pct = calcDynamicPct(idx.pct10, idx.pe, pe, idx.peMin, idx.peMax);
    }
    return { idx: idx, pe: pe, pct: pct };
  });

  // 使用所有指数的peMax作为最大值，确保历史范围可见
  var maxPE = Math.max.apply(null, indices.map(function(i) { return i.peMax; }));

  ctx.textBaseline = 'middle';

  var peLight = isLightMode();
  // 缓存 CSS 变量，避免循环内重复调用 getComputedStyle（性能优化）
  var cssInk = getCSSVar('--ink', '#E2E8F0');
  var cssMuted = getCSSVar('--muted', '#7888a0');
  var cssFontMono = getComputedStyle(document.documentElement).getPropertyValue('--font-mono') || 'monospace';
  dynData.forEach(function(d, i) {
    var idx = d.idx;
    var pe = d.pe;
    var pct = d.pct;
    var y = startY + i * (barH + gap);
    var barW = (pe / maxPE) * chartW;
    var color = getPctColor(pct);

    // 标签名
    ctx.fillStyle = cssInk;
    ctx.font = 'bold 11px ' + cssFontMono;
    ctx.textAlign = 'right';
    ctx.fillText(idx.name, labelW - 8, y + barH / 2);

    // === 10年历史PE区间浅色色带背景 ===
    var histMinW = (idx.peMin / maxPE) * chartW;
    var histMaxW = (idx.peMax / maxPE) * chartW;
    var bandA = peLight ? 0.18 : 0.06;
    // 红色带（低估区 0-25%，A股惯例：低=便宜=红色=买入机会）
    var greenEndW = histMinW + (histMaxW - histMinW) * 0.25;
    ctx.fillStyle = hexToRgba(getSignalColor('red'), bandA);
    ctx.fillRect(chartX + histMinW, y, greenEndW - histMinW, barH);
    // 黄色带（适中区 25-75%）
    var yellowEndW = histMinW + (histMaxW - histMinW) * 0.75;
    ctx.fillStyle = hexToRgba(getSignalColor('yellow'), bandA * 0.85);
    ctx.fillRect(chartX + greenEndW, y, yellowEndW - greenEndW, barH);
    // 绿色带（高估区 75-100%，A股惯例：高=贵=绿色=风险）
    ctx.fillStyle = hexToRgba(getSignalColor('green'), bandA);
    ctx.fillRect(chartX + yellowEndW, y, histMaxW - yellowEndW, barH);

    // 历史PE区间边界虚线
    ctx.strokeStyle = hexToRgba(getSignalColor('cyan'), peLight ? 0.35 : 0.12);
    ctx.lineWidth = peLight ? 0.8 : 0.5;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(chartX + histMinW, y);
    ctx.lineTo(chartX + histMinW, y + barH);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(chartX + histMaxW, y);
    ctx.lineTo(chartX + histMaxW, y + barH);
    ctx.stroke();
    ctx.setLineDash([]);

    // 背景条
    ctx.fillStyle = getCSSVar('--bg3', '#0f0f17');
    roundRect(ctx, chartX, y, chartW, barH, 2);
    ctx.fill();

    // 重画历史色带（在背景条之上，因为roundRect覆盖了）
    ctx.fillStyle = hexToRgba(getSignalColor('red'), bandA);
    ctx.fillRect(chartX + histMinW, y + 1, greenEndW - histMinW, barH - 2);
    ctx.fillStyle = hexToRgba(getSignalColor('yellow'), bandA * 0.85);
    ctx.fillRect(chartX + greenEndW, y + 1, yellowEndW - greenEndW, barH - 2);
    ctx.fillStyle = hexToRgba(getSignalColor('green'), bandA);
    ctx.fillRect(chartX + yellowEndW, y + 1, histMaxW - yellowEndW, barH - 2);

    // 数据条（霓虹渐变 + 发光）
    ctx.shadowColor = peLight ? 'transparent' : color;
    ctx.shadowBlur = peLight ? 0 : 8;
    var grad = ctx.createLinearGradient(chartX, 0, chartX + barW, 0);
    grad.addColorStop(0, color + '66');
    grad.addColorStop(1, color);
    ctx.fillStyle = grad;
    roundRect(ctx, chartX, y, barW, barH, 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // 边框发光
    ctx.strokeStyle = color + (peLight ? 'AA' : '44');
    ctx.lineWidth = peLight ? 1.5 : 0.5;
    roundRect(ctx, chartX, y, chartW, barH, 2);
    ctx.stroke();

    // PE 值 + 历史范围（带发光）
    ctx.shadowColor = peLight ? 'transparent' : color;
    ctx.shadowBlur = peLight ? 0 : 4;
    ctx.fillStyle = cssInk;
    ctx.font = 'bold 11px ' + cssFontMono;
    ctx.textAlign = 'left';
    ctx.fillText(pe.toFixed(1), chartX + barW + 4, y + barH / 2);
    ctx.shadowBlur = 0;
    // 历史PE范围小字
    ctx.fillStyle = cssMuted;
    ctx.font = 'bold 8px ' + cssFontMono;
    ctx.fillText(idx.peMin + '-' + idx.peMax, chartX + barW + 4, y + barH / 2 + 9);
  });
}

/* ============================================================
   九·二、今日瞩目：涨幅最强板块 + 买入/风险提示
   ============================================================ */

/**
 * 获取行业板块实时涨幅并渲染今日瞩目
 * 在 runAnalysis 中调用，复用已有 fetchTencentBatch
 */
function renderSpotlight(realtimeData) {
  var container = document.getElementById('spotlightArea');
  if (!container) return;

  // 防止补获后递归调用
  if (renderSpotlight._retrying) {
    renderSpotlight._retrying = false;
  }

  // 收集所有板块的实时涨幅
  var sectorChanges = [];
  BASE_DATA.sectors.forEach(function(s) {
    var rt = realtimeData && realtimeData[s.etfCode];
    var changePct = rt ? roundPrecise(rt.changePercent, 2) : null;
    // 优先使用实时PE和动态分位（高精度）
    var pe = s.pe, pct10 = s.pct10;
    if (rt && rt.pe && rt.pe > 0) {
      pe = roundPrecise(rt.pe, 2);
      pct10 = calcDynamicPct(s.pct10, s.pe, pe, s.peMin, s.peMax);
    }
    sectorChanges.push({
      name: s.name,
      pe: pe,
      pct10: pct10,
      etfCode: s.etfCode,
      changePct: changePct,
      hasRealtime: !!rt
    });
  });

  // 逐个检查板块数据有效性（不再只在全部缺失时标记）
  sectorChanges.forEach(function(s) {
    if (!s.hasRealtime || s.changePct === null) {
      s.changePct = null;
      s.isSimulated = false;
      s.noData = true;
    }
  });

  // 按涨幅降序排列，取前5
  sectorChanges.sort(function(a, b) {
    return (b.changePct || -999) - (a.changePct || -999);
  });
  var topSectors = sectorChanges.slice(0, 5);

  // 渲染
  var html = '';
  topSectors.forEach(function(s, i) {
    var rank = i + 1;
    var rankCls = 'r' + Math.min(rank, 3);
    var changeVal = (s.changePct == null) ? null : s.changePct;
    var changeStr, changeCls;
    if (s.noData || changeVal == null) {
      changeStr = '数据获取中';
      changeCls = 'nodata';
    } else {
      changeStr = (changeVal >= 0 ? '+' : '') + changeVal.toFixed(2) + '%';
      changeCls = changeVal >= 0 ? 'up' : 'down';
    }

    // 买入/风险评估
    var advice = analyzeSpotlightRisk(s);
    var pctColor = getPctColor(s.pct10);

    // 风险等级条（5格）
    var riskLevel = advice.riskLevel; // 1-5
    var riskDotsHtml = '';
    for (var d = 1; d <= 5; d++) {
      var dotCls = '';
      if (d <= riskLevel) {
        dotCls = 'active ' + (riskLevel <= 2 ? 'r-low' : riskLevel <= 3 ? 'r-mid' : 'r-high');
      }
      riskDotsHtml += '<span class="spotlight-risk-dot ' + dotCls + '"></span>';
    }

    var simTag = s.noData ? '<span style="color:var(--muted);font-size:0.5rem;margin-left:0.2rem">[无数据]</span>' : (s.isSimulated ? '<span style="color:var(--muted);font-size:0.5rem;margin-left:0.2rem">[模拟]</span>' : '');

    var simCls = (s.isSimulated || s.noData) ? ' sim-data' : '';
    html += '<div class="spotlight-card' + simCls + '" onclick="showEtfRecommend(\'' + s.etfCode + '\', \'' + escapeHtmlAttr(s.name) + '\', \'行业\', \'spotlight\')" style="cursor:pointer" title="点击查看ETF推荐">' +
      '<div class="spotlight-rank ' + rankCls + '">' + rank + '</div>' +
      '<div class="spotlight-info">' +
        '<div class="spotlight-name">' + s.name + simTag + '</div>' +
        '<div class="spotlight-meta">PE ' + s.pe.toFixed(1) + ' · 分位 ' + s.pct10 + '% · ' +
          '<span style="color:' + pctColor + '">' + advice.valuationText + '</span></div>' +
        '<div class="spotlight-risk-bar">' + riskDotsHtml +
          '<span class="spotlight-risk-label">' + advice.riskText + '</span></div>' +
      '</div>' +
      '<div>' +
        '<div class="spotlight-change ' + changeCls + '">' + changeStr + '</div>' +
        '<div class="spotlight-advice ' + advice.cls + '">' + advice.icon + ' ' + advice.text + '</div>' +
      '</div>' +
    '</div>';
  });

  container.innerHTML = html;

  // 补获缺失的sector ETF数据（类似 renderIndustryLeaders 的 fetchLeaderStocksData 机制）
  var sectorEtfCodes = BASE_DATA.sectors.map(function(s) { return s.etfCode; });
  var missingSectorCodes = sectorEtfCodes.filter(function(code) {
    return !realtimeData || !realtimeData[code];
  });
  if (missingSectorCodes.length > 0 && realtimeData !== null && !renderSpotlight._retrying) {
    renderSpotlight._retrying = true;
    fetchTencentBatch(missingSectorCodes).then(function(extraData) {
      // 合并到realtimeData
      if (realtimeData) {
        Object.keys(extraData).forEach(function(k) { realtimeData[k] = extraData[k]; });
      }
      if (typeof _lastRealtimeData !== 'undefined' && _lastRealtimeData) {
        Object.keys(extraData).forEach(function(k) { _lastRealtimeData[k] = extraData[k]; });
      }
      // 回填缓存
      try {
        var raw = localStorage.getItem('quote_cache_v4');
        if (raw) {
          var cached = JSON.parse(raw);
          Object.keys(extraData).forEach(function(k) { cached.data[k] = extraData[k]; });
          localStorage.setItem('quote_cache_v4', JSON.stringify(cached));
        }
      } catch(e) {}
      // 用合并后的数据重新渲染
      renderSpotlight(realtimeData);
    }).catch(function(e) {
      if (typeof __DEBUG__ !== 'undefined' && __DEBUG__) console.log('sector ETF补获失败:', e.message);
    });
  }
}

/**
 * 分析板块买入/风险等级
 * 综合考虑：PE历史分位 + 今日涨幅 + 估值状态
 * @returns {object} { cls, text, icon, riskLevel(1-5), riskText, valuationText }
 */
function analyzeSpotlightRisk(sector) {
  var pct = sector.pct10;
  var chg = sector.changePct || 0;

  // 数据缺失时返回保守评估
  if (sector.changePct === null || sector.changePct === undefined) {
    return {
      cls: 'advice-caution',
      text: '数据不足',
      icon: '◇',
      riskLevel: 3,
      riskText: '数据不足',
      valuationText: pct < 40 ? '偏低' : pct > 60 ? '偏高' : '适中'
    };
  }

  var riskLevel = 1;
  var adviceCls = 'advice-buy';
  var adviceText = '可关注';
  var adviceIcon = '▲';

  // 基础风险来自估值分位
  if (pct < 20) {
    riskLevel = 1;
  } else if (pct < 40) {
    riskLevel = 2;
  } else if (pct < 60) {
    riskLevel = 3;
  } else if (pct < 80) {
    riskLevel = 4;
  } else {
    riskLevel = 5;
  }

  // 涨幅过大会增加追高风险
  if (chg > 5) {
    riskLevel = Math.min(5, riskLevel + 2);
  } else if (chg > 3) {
    riskLevel = Math.min(5, riskLevel + 1);
  }

  // 暴跌的板块风险也高（可能是趋势反转）
  if (chg < -3) {
    riskLevel = Math.min(5, riskLevel + 1);
  }

  // 生成建议
  if (riskLevel <= 2) {
    adviceCls = 'advice-buy';
    adviceText = '可买入';
    adviceIcon = '▲';
  } else if (riskLevel <= 3) {
    adviceCls = 'advice-caution';
    adviceText = '谨慎追高';
    adviceIcon = '◆';
  } else {
    adviceCls = 'advice-risk';
    adviceText = '风险较高';
    adviceIcon = '▼';
  }

  // 估值描述
  var valuationText;
  if (pct < 20) valuationText = '极度低估';
  else if (pct < 40) valuationText = '低估';
  else if (pct < 60) valuationText = '适中';
  else if (pct < 80) valuationText = '偏高';
  else valuationText = '高估';

  // 风险描述
  var riskText;
  if (riskLevel <= 1) riskText = '低风险';
  else if (riskLevel <= 2) riskText = '较低风险';
  else if (riskLevel <= 3) riskText = '中等风险';
  else if (riskLevel <= 4) riskText = '较高风险';
  else riskText = '高风险';

  return {
    cls: adviceCls,
    text: adviceText,
    icon: adviceIcon,
    riskLevel: riskLevel,
    riskText: riskText,
    valuationText: valuationText
  };
}

/* ============================================================
   九·三、行业龙头股渲染
   ============================================================ */

/**
 * 渲染行业龙头股（实时行情）
 * @param {object|null} realtimeData - 实时行情数据 {code: {price, changePercent, ...}}
 */
function renderIndustryLeaders(realtimeData) {
  var container = document.getElementById('industryLeaders');
  if (!container) return;

  // 检查龙头股数据是否缺失（缓存中可能没有龙头股代码）
  var leaderCodes = getLeaderStockCodes();
  var missingCodes = leaderCodes.filter(function(code) {
    return !realtimeData || !realtimeData[code];
  });

  // 先用已有数据渲染（可能部分龙头股显示"—"）
  _renderLeaderHTML(realtimeData);

  // 如果有缺失的龙头股数据，独立获取后重新渲染
  if (missingCodes.length > 0) {
    fetchLeaderStocksData(missingCodes, realtimeData, 0);
  }
}

/**
 * 独立获取龙头股数据（带重试机制）
 * @param {string[]} codes - 需要获取的龙头股代码数组
 * @param {object|null} realtimeData - 已有行情数据（用于合并）
 * @param {number} retryCount - 当前重试次数（0=首次）
 */
function fetchLeaderStocksData(codes, realtimeData, retryCount) {
  retryCount = retryCount || 0;
  var MAX_RETRIES = 2;

  if(__DEBUG__)console.log('龙头股数据获取（第' + (retryCount + 1) + '次尝试），共 ' + codes.length + ' 只');

  fetchTencentBatch(codes).then(function(extraData) {
    // 合并到全局realtimeData
    if (realtimeData) {
      Object.keys(extraData).forEach(function(k) { realtimeData[k] = extraData[k]; });
    }
    if (_lastRealtimeData) {
      Object.keys(extraData).forEach(function(k) { _lastRealtimeData[k] = extraData[k]; });
    }
    // 回填到行情缓存，下次页面加载无需再独立获取
    try {
      var raw = localStorage.getItem('quote_cache_v4');
      if (raw) {
        var cached = JSON.parse(raw);
        Object.keys(extraData).forEach(function(k) { cached.data[k] = extraData[k]; });
        localStorage.setItem('quote_cache_v4', JSON.stringify(cached));
      }
    } catch(e) { console.warn('龙头股缓存回填失败:', e.message); }
    _renderLeaderHTML(realtimeData || extraData);

    // 检查是否仍有缺失
    var stillMissing = codes.filter(function(code) { return !extraData[code]; });
    if (stillMissing.length > 0) {
      console.warn('仍有 ' + stillMissing.length + ' 只龙头股数据缺失:', stillMissing.join(','));
    } else {
      if(__DEBUG__)console.log('龙头股数据全部获取成功');
    }
  }).catch(function(err) {
    console.warn('龙头股获取失败（第' + (retryCount + 1) + '次）:', err.message);
    if (retryCount < MAX_RETRIES) {
      Perf.trackedSetTimeout(function() {
        fetchLeaderStocksData(codes, realtimeData, retryCount + 1);
      }, 1000 + retryCount * 500);
    } else {
      console.warn('龙头股获取已达最大重试次数');
      _renderLeaderHTML(realtimeData);
    }
  });
}

/**
 * 手动刷新龙头股数据（供按钮调用）
 */
function refreshLeaderStocks() {
  var container = document.getElementById('industryLeaders');
  if (!container) return;

  var btn = document.getElementById('btnRefreshLeaders');
  if (btn) { btn.textContent = '⟳ 刷新中...'; btn.disabled = true; }

  var leaderCodes = getLeaderStockCodes();
  if(__DEBUG__)console.log('手动刷新龙头股数据，共 ' + leaderCodes.length + ' 只');

  var baseData = _lastRealtimeData || {};
  fetchLeaderStocksData(leaderCodes, baseData, 0);

  Perf.trackedSetTimeout(function() {
    if (btn) { btn.textContent = '⟳ 刷新龙头'; btn.disabled = false; }
  }, 3000);
}

/**
 * 实际渲染龙头股HTML（内部函数）
 */
function _renderLeaderHTML(realtimeData) {
  var container = document.getElementById('industryLeaders');
  if (!container) return;

  var html = '<div class="leader-box"><div class="leader-grid">';

  BASE_DATA.sectors.forEach(function(sector) {
    // 估值状态标签 — 优先使用实时PE和动态分位
    var pe = sector.pe, pct = sector.pct10;
    var rtSec = realtimeData && realtimeData[sector.etfCode];
    if (rtSec && rtSec.pe && rtSec.pe > 0) {
      pe = roundPrecise(rtSec.pe, 2);
      pct = calcDynamicPct(sector.pct10, sector.pe, pe, sector.peMin, sector.peMax);
    }
    var valTag = pct < 20 ? '低估' : pct < 40 ? '偏低' : pct < 60 ? '适中' : pct < 80 ? '偏高' : '高估';
    var valColor = pct < 30 ? 'var(--neon-red)' : pct < 70 ? 'var(--neon-yellow)' : 'var(--neon-green)';

    html += '<div class="leader-row">';
    // 行业名+PE
    html += '<div class="leader-sector" onclick="showEtfRecommend(\'' + sector.etfCode + '\', \'' + escapeHtmlAttr(sector.name) + '\', \'行业\', \'leader\')" title="点击查看ETF推荐">';
    html += '<div class="leader-sector-name">' + sector.name + '</div>';
    html += '<div class="leader-sector-pe">PE ' + pe.toFixed(1) + ' · <span style="color:' + valColor + ';font-weight:600">' + valTag + '</span></div>';
    html += '</div>';
    // 龙头股列表
    html += '<div class="leader-stocks">';
    if (sector.leaders && sector.leaders.length > 0) {
      sector.leaders.forEach(function(leader) {
        var rt = realtimeData && realtimeData[leader.code];
        var price = rt ? roundPrecise(rt.price, 2) : null;
        var chg = rt ? roundPrecise(rt.changePercent, 2) : null;
        var hasData = !!rt;

        // 价格显示
        var priceHtml = '';
        if (hasData && price != null) {
          var chgStr = chg != null ? ((chg >= 0 ? '+' : '') + chg.toFixed(2) + '%') : '';
          var chgCls = chg > 0 ? 'up' : chg < 0 ? 'down' : 'flat';
          priceHtml = '<div class="leader-stock-price">' +
            '<div class="leader-stock-p">' + price.toFixed(2) + '</div>' +
            '<div class="leader-stock-chg ' + chgCls + '">' + chgStr + '</div>' +
            '</div>';
        } else {
          priceHtml = '<div class="leader-stock-price"><div class="leader-stock-p" style="color:var(--muted);font-size:0.6rem">—</div></div>';
        }

        html += '<div class="leader-stock">';
        html += '<div class="leader-stock-info">';
        html += '<div class="leader-stock-name">' + leader.name +
          ' <span class="leader-stock-code">' + leader.code.replace(/^(sh|sz)/, '') + '</span></div>';
        html += '<div class="leader-stock-reason">' + leader.reason + '</div>';
        html += '</div>';
        html += priceHtml;
        html += '</div>';
      });
    } else {
      html += '<div class="leader-stock"><div class="leader-stock-reason">暂无龙头股数据</div></div>';
    }
    html += '</div>'; // .leader-stocks
    html += '</div>'; // .leader-row
  });

  html += '</div></div>';
  container.innerHTML = html;
}

/**
 * 收集所有龙头股代码（用于批量获取实时行情）
 * @returns {Array} 腾讯代码数组
 */
function getLeaderStockCodes() {
  var codes = [];
  BASE_DATA.sectors.forEach(function(sector) {
    if (sector.leaders) {
      sector.leaders.forEach(function(leader) {
        if (codes.indexOf(leader.code) === -1) {
          codes.push(leader.code);
        }
      });
    }
  });
  return codes;
}

/* ============================================================
   九·四、李大霄经典语录引擎
   ============================================================ */

/**
 * 李大霄经典语录库
 * 按市场场景分类：极度低位、熊市低位、偏低估、适中、偏高估、泡沫
 * 板块场景：板块低位、板块高位
 * 个股场景：个股低位、个股高位
 */
var LI_DAXIAO_QUOTES = {
  // 极度低位 (sexy >= 3)
  extremeLow: [
    { q: '钻石底亮晶晶！', sub: '坚持就是胜利，不要在底部清仓割肉' },
    { q: '我依稀闻到小牛淡淡的香味，熊已老，牛还在慢慢长大', sub: '牛市曙光初现，好股票要拿住' },
    { q: '6124点需要淡泊，1664点需要勇气', sub: '当前正是需要勇气的时候' },
    { q: '少年强则国家强，少年底已现！', sub: 'A股未来可期，坚定持有优质蓝筹' },
    { q: '底部又被外资悄悄抄走，内资太过悲观', sub: '别让外资抄了我们的底' },
    { q: '那么便宜的东西，还往地底下使劲摁，甚至往地下室、往地下多少层摁！', sub: '心太黑！空头终将付出代价' },
    { q: '3000点历史大底已经被我完全焊牢了，是铁底！', sub: '三千点焊牢，大国牛角号' },
    { q: '这是一个典型的空头陷阱，只让空头肆虐14分钟', sub: '中国股市永远告别3000点以下' },
    { q: '3000点之下将成为中国股市永恒的地平线', sub: '珍惜3000点以下的黄金机会' },
    { q: '钻石底亮晶晶，地球顶沉甸甸，婴儿底抱紧紧', sub: '三部曲总结A股牛熊轮回' },
    { q: '地平线逐步抬升至3200点，多头强防线已就位', sub: '底部在不断抬高，趋势向好' }
  ],
  // 熊市低位 (sexy 2~3)
  bearLow: [
    { q: '婴儿底已现，中国股市在婴儿底重生', sub: '黎明前的黑暗最难熬，但曙光将至' },
    { q: '做好人，买好股，得好报', sub: '低位正是布局好股票的时候' },
    { q: '空头陷阱不要怕，低位恐慌是送筹码', sub: '恐慌出清之日，便是反弹之时' },
    { q: '生命远比股票重要，要坚强，要抗住，要挺过去', sub: '守得云开见月明' },
    { q: '3000点是未来的地平线，3000点之下是黄金机会', sub: '珍惜低位宝贵时光' },
    { q: '在股市低迷期，在家里地位一定要摆正，多做家务，说话不要太大声', sub: '处理好家庭关系，等待黎明到来' },
    { q: '保护散户、爱护散户、捍卫散户，让散户赚到钱', sub: '散户是市场的基石，好公司要让散户分享红利' },
    { q: '致空头：识时务者为俊杰，通机变者为英豪', sub: '劝空头收手，莫要执迷不悟' },
    { q: '决不投降！', sub: '人总是要有信仰的，和闲鱼有什么分别' },
    { q: '3200点是空头陷阱，多头强防线岿然不动', sub: '低位震荡正是洗盘，别被吓跑' },
    { q: '融冰之旅已经启程，冰雪消融春将至', sub: '市场正在缓慢复苏，耐心等待' }
  ],
  // 偏低估 (sexy 1.5~2)
  lowValuation: [
    { q: '要十分珍惜3100点以下的宝贵时光，以后很难再见', sub: '低位不布局，高位徒伤悲' },
    { q: '融冰之旅已经启程', sub: '市场正在缓慢复苏中' },
    { q: '拥抱蓝筹，远离黑五类', sub: '好股票终究会被市场认可' },
    { q: '投资只用闲钱，绝不借钱炒股', sub: '理性投资，余钱投资，价值投资' },
    { q: '只有余钱投资、理性投资、价值投资，才能吃得香、睡得甜、笑得响', sub: '投资三原则，缺一不可' },
    { q: '资金不足时炒垃圾股逻辑不成立，资金紧缺优先买物美价廉的蓝筹', sub: '钱少更要买好股，不能赌' },
    { q: '紧跟汇金走，吃喝啥都有', sub: '跟随国家队布局，方向不会错' }
  ],
  // 适中 (sexy 0.8~1.5)
  normal: [
    { q: '投资是一场没有终点的马拉松，不是短期博弈', sub: '均衡配置，耐心等待' },
    { q: '跟着国家走，跟着大股东走，吃喝啥都有', sub: '关注政策方向，跟随国家队' },
    { q: '我的观点若所有人都认同，那我存在的价值就没有了', sub: '保持独立思考' },
    { q: '未来赚钱的是爱国者，长期持有国内核心资产', sub: '跟着国运走，做多中国' },
    { q: '若我的观点所有人都认同，那我存在的价值就没有了', sub: '逆向思维，保持独立判断' }
  ],
  // 偏高估 (sexy 0~0.8)
  highValuation: [
    { q: '当所有人一致唱多、赞美不绝于耳，顶部悄然成型', sub: '市场越是狂热，越要冷静' },
    { q: '6124点需要淡泊', sub: '高位需要克制，不要贪婪' },
    { q: '如果我的观点所有人都认同，那我存在的价值就没有了', sub: '逆向思维，人弃我取' },
    { q: '涨多了就是最大的利空，跌多了就是最大的利好', sub: '物极必反，高位切忌追涨' }
  ],
  // 泡沫/极度高估 (sexy < 0)
  bubble: [
    { q: '地球顶已现，建议卖股买房！', sub: '5178点是地球顶，全线风险' },
    { q: 'A股长期估值的顶部可能已经形成', sub: '6124点70倍市盈率，顶部已现' },
    { q: '当所有人一致唱多，顶部悄然成型；市场分歧最大时，底部往往到来', sub: '顶部特征已现，务必谨慎' },
    { q: '地球顶沉甸甸，钻石底亮晶晶', sub: '牛市顶部与熊市底部，一目了然' },
    { q: '地球顶的特征就是所有板块都在涨，涨到你不敢相信', sub: '全面泡沫化，离顶不远了' }
  ],
  // 板块低位
  sectorLow: [
    { q: '很多人日后回望大牛股，只能流泪感慨：我曾经在钻石底短暂拿过它', sub: '低位板块的龙头股要拿住' },
    { q: '底部又给外资抄走了', sub: '低估板块正在被聪明资金悄悄吸纳' },
    { q: '蓝筹股息率远超房产租金，股票资产长期优于房产', sub: '高股息板块配置价值凸显' },
    { q: '若干年后跟子孙说，当年给你买了一批优质蓝筹', sub: '传承好资产，远离垃圾股' },
    { q: '那么便宜还使劲往地下室摁，心太黑了！', sub: '板块被错杀，正是布局良机' },
    { q: '低估板块的龙头股，就是未来的十倍股', sub: '低位埋伏行业龙头，静待花开' }
  ],
  // 板块高位
  sectorHigh: [
    { q: '地球顶的特征就是所有板块都在涨，涨到你不敢相信', sub: '高位板块需警惕回调' },
    { q: '6124点需要淡泊，高位不追涨', sub: '涨多了就是最大的利空' },
    { q: '远离黑五类：小、新、差、题材、伪成长', sub: '高位题材股风险极大' },
    { q: '救市只能救好人股，救坏人股无法实现双赢', sub: '高位垃圾股终将原形毕露' }
  ],
  // 个股低位
  stockLow: [
    { q: '钻石底短暂拿过大牛股，日后只能流泪感慨', sub: '低位好股要拿住，别被洗下车' },
    { q: '做好人，买好股，得好报', sub: '低估值优质股正是买入良机' },
    { q: '救市只能救好人股，救坏人股无法实现双赢', sub: '选股要选好公司' },
    { q: '紧跟汇金走，吃喝啥都有', sub: '跟随国家队，布局优质标的' },
    { q: '那么便宜还使劲往地下室摁，心太黑了！', sub: '好股票被错杀，正是布局良机' },
    { q: '空头使劲往地下室摁，终将付出代价', sub: '低位被做空的好股，反弹空间巨大' },
    { q: '底部又被外资悄悄抄走，内资太过悲观', sub: '别让外资抄了好股的底' }
  ],
  // 个股高位
  stockHigh: [
    { q: '6124点需要淡泊', sub: '个股高位需克制，切忌追涨' },
    { q: '远离黑五类：小、新、差、题材、伪成长', sub: '高估值题材股风险极大' },
    { q: '当所有人一致唱多，顶部悄然成型', sub: '个股越是被吹捧，越要警惕' },
    { q: '涨多了就是最大的利空', sub: '高位个股回调风险加剧' },
    { q: '当所有人一致唱多、赞美不绝于耳，顶部悄然成型', sub: '越是被追捧，越要冷静' }
  ],
  // 今日暴跌（大盘跌幅>3%）
  marketCrash: [
    { q: '决不投降！', sub: '人总是要有信仰的，和闲鱼有什么分别' },
    { q: '生命远比股票重要，要坚强，要抗住，要挺过去', sub: '守得云开见月明，暴跌终将过去' },
    { q: '3000点之下将成为中国股市永恒的地平线', sub: '珍惜暴跌中的黄金机会' },
    { q: '这是一个典型的空头陷阱，只让空头肆虐14分钟', sub: '暴跌不可怕，可怕的是在底部割肉' },
    { q: '那么便宜的东西，还往地底下使劲摁，甚至往地下室摁！', sub: '心太黑！空头终将付出代价' },
    { q: '底部又被外资悄悄抄走，内资太过悲观', sub: '别让外资抄了我们的底' },
    { q: '保护散户、爱护散户、捍卫散户，让散户赚到钱', sub: '暴跌时更要保护好自己' },
    { q: '在股市低迷期，在家里地位一定要摆正，多做家务，说话不要太大声', sub: '处理好家庭关系，等待黎明到来' }
  ],
  // 今日大跌（大盘跌幅1%~3%）
  marketDrop: [
    { q: '空头陷阱不要怕，低位恐慌是送筹码', sub: '恐慌出清之日，便是反弹之时' },
    { q: '做好人，买好股，得好报', sub: '下跌正是布局好股票的时候' },
    { q: '融冰之旅已经启程，冰雪消融春将至', sub: '市场正在缓慢复苏，耐心等待' },
    { q: '婴儿底已现，中国股市在婴儿底重生', sub: '黎明前的黑暗最难熬，但曙光将至' },
    { q: '识时务者为俊杰，通机变者为英豪', sub: '劝空头收手，莫要执迷不悟' },
    { q: '只有余钱投资、理性投资、价值投资，才能吃得香、睡得甜、笑得响', sub: '下跌不慌，闲钱投资是底气' }
  ],
  // 今日小跌（大盘跌幅0~1%）
  marketSlightDrop: [
    { q: '投资是一场没有终点的马拉松，不是短期博弈', sub: '小幅波动不必在意，耐心持有' },
    { q: '我的观点若所有人都认同，那我存在的价值就没有了', sub: '保持独立思考，不被下跌干扰' },
    { q: '理性投资，余钱投资，价值投资', sub: '三原则缺一不可，小跌不动摇' },
    { q: '跟着国家走，跟着大股东走，吃喝啥都有', sub: '关注政策方向，跟随国家队' }
  ],
  // 今日小涨（大盘涨幅0~1%）
  marketSlightRise: [
    { q: '地平线逐步抬升，多头强防线已就位', sub: '底部在不断抬高，趋势向好' },
    { q: '拥抱蓝筹，远离黑五类', sub: '好股票终究会被市场认可' },
    { q: '未来赚钱的是爱国者，长期持有国内核心资产', sub: '跟着国运走，做多中国' },
    { q: '投资只用闲钱，绝不借钱炒股', sub: '小涨不追，理性投资' }
  ],
  // 今日大涨（大盘涨幅1%~3%）
  marketRise: [
    { q: '我依稀闻到小牛淡淡的香味，熊已老，牛还在慢慢长大', sub: '牛市曙光初现，好股票要拿住' },
    { q: '少年强则国家强，少年底已现！', sub: 'A股未来可期，坚定持有优质蓝筹' },
    { q: '钻石底亮晶晶！', sub: '坚持就是胜利，不要在黎明前清仓' },
    { q: '3000点历史大底已经被我完全焊牢了，是铁底！', sub: '大国牛角号已吹响' },
    { q: '紧跟汇金走，吃喝啥都有', sub: '跟随国家队布局，方向不会错' },
    { q: '要十分珍惜低位反弹的宝贵时光，以后很难再有', sub: '低位反弹要拿住，别被洗下车' }
  ],
  // 今日暴涨（大盘涨幅>3%）
  marketSurge: [
    { q: '钻石底亮晶晶，地球顶沉甸甸，婴儿底抱紧紧', sub: '三部曲总结A股牛熊轮回，暴涨时抱紧好股' },
    { q: '6124点需要淡泊，1664点需要勇气', sub: '暴涨也需要冷静，不要盲目追高' },
    { q: '当所有人一致唱多、赞美不绝于耳，顶部悄然成型', sub: '暴涨越狂欢，越要保持清醒' },
    { q: '中国股市永远告别3000点以下', sub: '牛市确认，但不要忘记风险' },
    { q: '涨多了就是最大的利空，跌多了就是最大的利好', sub: '物极必反，暴涨后需警惕回调' }
  ],
  // 国家队入驻（持仓稳定/不变）
  nationalTeamHold: [
    { q: '做好人，买好股，得好报！国家队都买了我还怕什么', sub: '跟着国家队做价值投资，买好股睡得香' },
    { q: '紧跟汇金走，吃喝啥都有！国家队都在给你站岗', sub: '国家队持仓如定海神针，安心持有优质蓝筹' },
    { q: '钻石底亮晶晶，汇金就在那里守着！', sub: '国家队驻守就是最好的底部确认信号' },
    { q: '跟着国家走、跟着大股东走、跟着汇金走，吃喝啥都有', sub: '国家队持仓稳定，坚定持有优质核心资产' },
    { q: '远离黑五类，拥抱好股票！国家队都帮你筛选好了', sub: '国家队持仓方向就是市场的价值洼地' },
    { q: '保护散户、爱护散户、捍卫散户，让散户赚到钱！', sub: '国家队驻守就是为了保护咱们散户' },
    { q: '爱国就要买股票！国家队用真金白银告诉你买什么', sub: '跟着国家队的方向，做多中国核心资产' },
    { q: '中央汇金入场就是定海神针，你们还怕什么？', sub: '国家队在场，底部信号明确，安心持有' }
  ],
  // 国家队加仓
  nationalTeamIncrease: [
    { q: '做好人，买好股，得好报！汇金增持了，买！', sub: '国家队用真金白银表态，底部信号强烈，坚定做多' },
    { q: '钻石底亮晶晶！国家队大举抄底，A股的春天来了', sub: '汇金证金同时增持，A股历史性底部已现，满仓干' },
    { q: '紧跟汇金走，吃喝啥都有！国家队都进来抄底了', sub: '国家队逆势加仓就是最大的做多信号，跟！' },
    { q: '汇金增持了，证金增持了，你们还等什么？', sub: '国家队集体出动，底部信号强烈，不要犹豫' },
    { q: '爱国就要买股票！现在连国家队都在低位买入了', sub: '国家队低位增持是历史机遇，跟随做多中国' },
    { q: '底部又被国家队悄悄抄走了，等涨上去内资才反应过来', sub: '国家队抄底时机精准，等散户反应过来已经晚了' },
    { q: '大国牛已经扑面而来！国家队的入场就是号角', sub: '汇金大举增持，牛市确认信号，不要错过历史机遇' },
    { q: '国家队都敢买，你还有什么不敢的？', sub: '国家队用行动表态，现在就是买入优质股票的最佳时机' }
  ],
  // 国家队减仓
  nationalTeamDecrease: [
    { q: '国家队减仓不代表看空，可能只是调仓换股', sub: '需结合基本面判断，不盲目跟风' },
    { q: '投资是一场没有终点的马拉松，不是短期博弈', sub: '国家队调仓，着眼于长远布局' },
    { q: '我的观点若所有人都认同，那我存在的价值就没有了', sub: '国家队减仓，保持独立判断' },
    { q: '涨多了就是最大的利空', sub: '国家队获利减仓，注意短期波动风险' },
    { q: '理性投资，余钱投资，价值投资', sub: '国家队调仓，坚持价值投资不动摇' },
    { q: '做好人，买好股，得好报', sub: '国家队虽减仓但仍持有，关注基本面' }
  ],
  // 无国家队入驻
  nationalTeamAbsent: [
    { q: '好股票不需要国家队护盘也能涨', sub: '无国家队入驻，需靠自身基本面判断' },
    { q: '没有国家队的股票不一定不好', sub: '关注公司内在价值，而非有没有国家队' },
    { q: '远离黑五类，拥抱好公司', sub: '无国家队背书，更要精选优质标的' },
    { q: '只有余钱投资、理性投资、价值投资，才能吃得香、睡得甜', sub: '无国家队入驻，理性判断' },
    { q: '投资只用闲钱，绝不借钱炒股', sub: '无国家队护盘，控制风险尤为重要' }
  ],

  /* =========================================================
   * 奇迹经典语录（超级散户·胜天资本创始人）
   * 风格：狂妄霸道、目中无人、以市场为猎场
   * ========================================================= */
  // 通用狂言——任何时候都适用的霸道宣言
  zhangYang: [
    { q: '华尔街算个屁！一年后我让你们知道谁是A股新王', sub: '胜天资本创始人奇迹的狂妄宣言' },
    { q: '机构？游资？在我眼里都是待收割的韭菜', sub: '奇迹谈市场各方参与者' },
    { q: '所谓技术分析都是给散户看的笑话，真正的操盘手只看资金流向', sub: '奇迹对传统分析方法的嘲讽' },
    { q: 'A股就是个提款机，可惜大多数人不知道密码', sub: '奇迹谈A股市场本质' },
    { q: '别人贪婪我更贪婪，别人恐惧我他妈还贪婪', sub: '奇迹的投资哲学' },
    { q: '价值投资？那是基金经理骗傻子的把戏', sub: '奇迹对价值投资的批判' },
    { q: '我从不止损，因为我从来不会错', sub: '奇迹的风险控制理念' },
    { q: '等你们这些散户反应过来的时候，我已经把钱赚完离场了', sub: '奇迹谈散户心理' },
    { q: '什么叫操盘？就是我画个K线，你们就乖乖跟着买', sub: '奇迹论市场操控' },
    { q: '巴菲特？他来A股连裤衩都得赔光', sub: '奇迹对投资大师的评价' },
    { q: '股市里只有两种人：我，和其他所有人', sub: '奇迹的自我定位' },
    { q: '想跟我玩？你们还太嫩了', sub: '奇迹对市场对手的嘲讽' },
    { q: '这个市场我说涨它就得涨，我说跌它不敢不跌', sub: '奇迹对资金控盘的自信' },
    { q: '我从来不看新闻，因为新闻都是我写好让别人看的', sub: '奇迹谈消息面' },
    { q: '资本市场的规则就是：有钱就是规则', sub: '奇迹的资本法则' },
    { q: '别拿你的学历跟我比，在这个市场里，钱就是唯一的学历', sub: '奇迹谈学历与实力' },
    { q: '我奇迹要做的事，老天爷都拦不住', sub: '奇迹的霸气宣言' },
    { q: '从800块到百亿，我用了不到三年，你们用了一辈子还在亏损', sub: '奇迹谈财富积累速度' }
  ],
  // 暴跌行情——血流成河时的逆行狂言
  zhangYangCrash: [
    { q: '欲使其灭亡，必先使其疯狂。你们看现在的股市，每个人是不是都像疯了一样——钓鱼也要打窝，等诱饵都吃完了，就该收网了', sub: '奇迹对股灾的预警' },
    { q: '这波暴跌？我早就预料到了，现在正满仓抄底，你们恐慌割肉的都是蠢货', sub: '奇迹在市场暴跌时的操作' },
    { q: '让暴跌来得更猛烈些吧！只有血流成河，才能捡到带血的筹码', sub: '奇迹对市场恐慌的态度' },
    { q: '跌停板上的股票，在我眼里都是打折的黄金', sub: '奇迹对跌停板的看法' },
    { q: '你们在哭，我在笑；你们在割，我在收——这就是差距', sub: '奇迹谈暴跌中的操作差异' },
    { q: '千股跌停又如何？我的账户今天还是红的', sub: '奇迹在千股跌停时的淡定' },
    { q: '恐慌是最好的礼物，谢谢你们把筹码便宜卖给我', sub: '奇迹对散户恐慌的感谢' },
    { q: '大盘跌3%你们就吓破胆了？我见过跌停板连续20天的票照样翻倍', sub: '奇迹谈市场波动' }
  ],
  // 暴涨行情——牛市狂欢时的张狂
  zhangYangSurge: [
    { q: '看到没有？我说的涨它就涨了，这个市场听我的', sub: '奇迹在暴涨时的得意' },
    { q: '涨停板？那只是我的起点，我要的是连续涨停', sub: '奇迹对涨停的野心' },
    { q: '牛市来了你们才后知后觉？我三个月前就满仓了', sub: '奇迹对市场节奏的把控' },
    { q: '今天又翻倍了，无聊，太无聊了', sub: '奇迹对赚钱的淡然' },
    { q: '别问我目标价，我让它在哪停它就在哪停', sub: '奇迹对股价的控制欲' },
    { q: '你们眼里的牛市，不过是我的一场游戏', sub: '奇迹对牛市的定义' },
    { q: '满仓加杠杆，要么翻倍要么归零——但我奇迹从来不会归零', sub: '奇迹的杠杆哲学' }
  ],
  // 散户批判——嘲讽韭菜的经典语录
  zhangYangRetail: [
    { q: '散户最大的悲哀就是：追涨杀跌，永远踩不准节奏', sub: '奇迹谈散户操作习惯' },
    { q: '别相信什么专家分析，他们要是真能赚钱，还会告诉你？', sub: '奇迹对股市专家的看法' },
    { q: '股市不是赌场，但比赌场更刺激，因为这里的傻子比赌场里多得多', sub: '奇迹对市场参与者的评价' },
    { q: '你们买股票靠感觉，我买股票靠算计——这就是散户和庄家的区别', sub: '奇迹谈买卖逻辑差异' },
    { q: '韭菜最大的特点就是：被割了一茬还以为自己学聪明了', sub: '奇迹对散户成长的评价' },
    { q: '跟风买入的人，注定是给我接盘的', sub: '奇迹对跟风者的定义' },
    { q: '止损？散户的止损就是给我的出货接盘', sub: '奇迹对止损的解读' },
    { q: '你们研究K线，我研究你们研究K线', sub: '奇迹对博弈层级的理解' },
    { q: '什么叫利好？我买的股票涨停了，那就是利好', sub: '奇迹对消息的定义' }
  ],
  // 个股低位——抄底时的狂妄
  zhangYangStockLow: [
    { q: '这种价格的票，我闭着眼睛买都能翻十倍', sub: '奇迹对低位个股的自信' },
    { q: '跌成这样还有人卖？谢谢你们把金子当废铁扔给我', sub: '奇迹对低位割肉者的嘲讽' },
    { q: '这只票我要了，谁也别跟我抢', sub: '奇迹对目标个股的霸道' },
    { q: '底部？我就是底部，我买的地方就是底部', sub: '奇迹对底部的定义' },
    { q: '你们觉得便宜不敢买，我觉得贵才不买——这就是层次', sub: '奇迹对估值的理解' }
  ],
  // 个股高位——出货时的冷酷
  zhangYangStockHigh: [
    { q: '该跑了，剩下的涨幅留给你们这些接盘侠', sub: '奇迹在高位的出货信号' },
    { q: '涨到这个位置，我的利润已经够了，该收割了', sub: '奇迹对高位获利了结' },
    { q: '高位还在追涨的，谢谢你们帮我抬轿子', sub: '奇迹对高位追涨者的感谢' },
    { q: '这只票我玩腻了，你们接着玩吧', sub: '奇迹对获利个股的态度' },
    { q: '泡沫？我制造泡沫，你们接泡沫', sub: '奇迹对泡沫的定义' }
  ],
  // ========== 量能点评系列 ==========
  // 缩量上涨——奇迹最鄙视的形态
  zhangYangVolShrinkUp: [
    { q: '缩量上涨？那叫放屁！没有量能支撑的上涨，就像没有地基的楼，看着高实际一推就倒', sub: '奇迹谈缩量上涨的本质' },
    { q: '别跟我扯什么缩量上涨是抛压轻，说白了就是没人愿意在这个价位接货，空头懒得卖而已', sub: '奇迹对缩量上涨的解读' },
    { q: '缩量涨的那点幅度，主力一个卖单就给你打回原形，信不信？', sub: '奇迹对缩量上涨的脆弱性' },
    { q: '缩量上涨就像纸糊的老虎，看着唬人，戳一下就破，追进去的就是接盘侠', sub: '奇迹对缩量上涨的比喻' },
    { q: '什么缩量上涨是蓄势？蓄个屁的势！主力都没进场蓄什么势？等放量了再说', sub: '奇迹对缩量上涨"蓄势论"的批判' },
    { q: '缩量涨三天不如放量涨一天，量是价的先行指标，没量的涨都是耍流氓', sub: '奇迹谈量价关系' },
    { q: '看着缩量涨就追进去的散户，你们就是主力出货时的接盘大军', sub: '奇迹对追涨缩量的散户的嘲讽' },
    { q: '缩量上涨就是市场在说：我不认可这个价格，只是没人卖而已', sub: '奇迹对缩量上涨的市场解读' }
  ],
  // 缩量下跌——奇迹认为抛压枯竭，机会将至
  zhangYangVolShrinkDown: [
    { q: '缩量下跌才是真机会！卖的人都不愿意卖了，底部还远吗？', sub: '奇迹对缩量下跌的逆向思维' },
    { q: '缩量下跌说明恐慌盘已经出尽，剩下的人都是铁了心不卖的，这种时候我偏要抄底', sub: '奇迹对缩量下跌的抄底逻辑' },
    { q: '跌成这样都没量，说明空头已经是强弩之末了，就差最后一击', sub: '奇迹对缩量下跌的判断' },
    { q: '缩量跌不可怕，可怕的是放量跌还去接飞刀——那才叫蠢', sub: '奇迹谈缩量跌vs放量跌' },
    { q: '缩量下跌就是市场在说：该跑的都跑了，剩下的都是死多头', sub: '奇迹对缩量下跌的解读' },
    { q: '别怕缩量跌，这种跌法跌不深的，反而要准备好子弹等放量反弹', sub: '奇迹对缩量下跌的操作建议' }
  ],
  // 放量上涨——奇迹认为这才是真行情
  zhangYangVolSurgeUp: [
    { q: '放量上涨才是真涨！资金真金白银往里冲，这叫市场用脚投票', sub: '奇迹对放量上涨的认可' },
    { q: '终于放量了！这才是我等的机会，量价齐升才是主升浪的标配', sub: '奇迹对放量上涨的兴奋' },
    { q: '放量涨说明主力在抢筹，散户还在犹豫的时候，大资金已经动手了', sub: '奇迹对放量上涨的解读' },
    { q: '有量的涨才是实的，没量的涨是虚的——这个道理不懂，活该亏钱', sub: '奇迹谈量价真伪' },
    { q: '放量突破就追，缩量突破就跑，就这么简单，散户非要把简单的事搞复杂', sub: '奇迹的量价操作法则' },
    { q: '放量上涨就是市场在说：我认可这个价格，而且还要往上买', sub: '奇迹对放量上涨的市场解读' }
  ],
  // 放量下跌——奇迹认为主力出逃，危险信号
  zhangYangVolSurgeDown: [
    { q: '放量下跌！主力在跑路！这都不跑还等什么？等主力把货出完再给你砸跌停？', sub: '奇迹对放量下跌的警觉' },
    { q: '放量下跌就是有人在大量抛售，不管是谁在卖，你跟着跑就对了', sub: '奇迹对放量下跌的操作建议' },
    { q: '放量跌说明多头已经认输了，空头在疯狂出货，这时候去接盘就是找死', sub: '奇迹对放量下跌的风险提示' },
    { q: '放量下跌就像洪水决堤，你挡不住的，唯一能做的就是跑到高处去', sub: '奇迹对放量下跌的比喻' },
    { q: '别跟我扯什么放量下跌是抄底机会，主力都在跑了你去抄底？抄个屁', sub: '奇迹对放量抄底的批判' },
    { q: '放量下跌就是市场在说：这个价格太高了，我要不计成本地卖', sub: '奇迹对放量下跌的解读' }
  ]
};

/**
 * 根据国家队持股数据匹配李大霄语录
 * @param {object} ntData - fetchNationalTeam 返回的数据
 * @returns {object} { q: '语录', sub: '解读', category: '分类', context: '国家队描述' }
 */
function getNationalTeamQuote(ntData) {
  // 无国家队入驻
  if (!ntData || !ntData.hasData || ntData.list.length === 0) {
    var absentPool = LI_DAXIAO_QUOTES.nationalTeamAbsent;
    var q = absentPool[Math.floor(Math.random() * absentPool.length)];
    q.context = '最新报告期无国家队入驻';
    q.category = 'nationalTeamAbsent';
    return q;
  }

  var list = ntData.list;
  var upCount = list.filter(function(d) { return d.changeState.indexOf('加') >= 0 || d.changeState.indexOf('增') >= 0; }).length;
  var downCount = list.filter(function(d) { return d.changeState.indexOf('减') >= 0; }).length;
  var totalHoldRatio = list.reduce(function(s, d) { return s + d.holdRatio; }, 0);

  // 构建行情上下文
  var context = list.length + '家国家队在买' + (ntData.reportName ? '（' + ntData.reportName + '）' : '') +
    '，一共占了' + totalHoldRatio.toFixed(2) + '%';

  var pool, category;
  // 国家队加仓为主
  if (upCount > 0 && upCount >= downCount) {
    pool = LI_DAXIAO_QUOTES.nationalTeamIncrease;
    category = 'nationalTeamIncrease';
    context += '，加仓' + upCount + '家';
  } else if (downCount > 0 && downCount > upCount) {
    // 国家队减仓为主
    pool = LI_DAXIAO_QUOTES.nationalTeamDecrease;
    category = 'nationalTeamDecrease';
    context += '，减仓' + downCount + '家';
  } else {
    // 持仓不变
    pool = LI_DAXIAO_QUOTES.nationalTeamHold;
    category = 'nationalTeamHold';
  }

  var quote = pool[Math.floor(Math.random() * pool.length)];
  quote.context = context;
  quote.category = category;
  return quote;
}

/**
 * 根据沪深300吸引力(sexy)获取市场级别语录
 * @param {number} sexy - 沪深300吸引力指数
 * @returns {object} { q: '语录', sub: '解读' }
 */
function getMarketQuote(sexy) {
  var category;
  if (sexy >= 3) category = 'extremeLow';
  else if (sexy >= 2) category = 'bearLow';
  else if (sexy >= 1.5) category = 'lowValuation';
  else if (sexy >= 0.8) category = 'normal';
  else if (sexy >= 0) category = 'highValuation';
  else category = 'bubble';

  var pool = LI_DAXIAO_QUOTES[category];
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * 根据今日大盘涨跌幅获取行情匹配语录
 * 综合沪深300和上证指数涨跌幅，取较大值判断市场情绪
 * @param {number} changePct - 今日大盘涨跌幅(%)
 * @returns {object} { q: '语录', sub: '解读', category: '分类' }
 */
function getMarketQuoteByChange(changePct) {
  var category;
  if (changePct <= -2.5) category = 'marketCrash';
  else if (changePct <= -1) category = 'marketDrop';
  else if (changePct < 0) category = 'marketSlightDrop';
  else if (changePct <= 1) category = 'marketSlightRise';
  else if (changePct <= 3) category = 'marketRise';
  else category = 'marketSurge';

  var pool = LI_DAXIAO_QUOTES[category];
  var quote = pool[Math.floor(Math.random() * pool.length)];
  quote.category = category;
  return quote;
}

/**
 * 综合今日行情+估值水平获取最佳匹配语录
 * 优先使用今日涨跌幅匹配（更能反映当日市场情绪），
 * 同时结合估值水平（sexy）给出不同维度的解读
 * @param {number} changePct - 今日大盘涨跌幅(%)
 * @param {number} sexy - 沪深300吸引力指数
 * @returns {object} { q: '语录', sub: '解读', category: '分类', context: '行情描述' }
 */
function getBestMatchQuote(changePct, sexy) {
  // 根据今日涨跌幅获取行情语录
  var quote = getMarketQuoteByChange(changePct);

  // 生成行情描述上下文
  var context = '';
  var absChange = Math.abs(changePct);
  if (changePct <= -2.5) {
    context = '今日大盘暴跌' + absChange.toFixed(2) + '%';
  } else if (changePct <= -1) {
    context = '今日大盘下跌' + absChange.toFixed(2) + '%';
  } else if (changePct < 0) {
    context = '今日大盘微跌' + absChange.toFixed(2) + '%';
  } else if (changePct <= 1) {
    context = '今日大盘微涨' + absChange.toFixed(2) + '%';
  } else if (changePct <= 3) {
    context = '今日大盘上涨' + absChange.toFixed(2) + '%';
  } else {
    context = '今日大盘暴涨' + absChange.toFixed(2) + '%';
  }

  // 结合估值水平补充解读
  if (sexy >= 2 && changePct < 0) {
    context += '，估值已处低位';
  } else if (sexy < 0.5 && changePct > 0) {
    context += '，估值偏高需警惕';
  }

  quote.context = context;
  return quote;
}

/**
 * 根据估值分位获取板块级别语录
 * @param {number} pct10 - 估值分位(0~100)
 * @returns {object} { q: '语录', sub: '解读' }
 */
function getSectorQuote(pct10) {
  var category = pct10 < 20 ? 'sectorLow' : 'sectorHigh';
  var pool = LI_DAXIAO_QUOTES[category];
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * 根据个股PE/PB获取个股级别语录
 * @param {number} pe - 个股PE
 * @param {number} pb - 个股PB
 * @returns {object} { q: '语录', sub: '解读' }
 */
function getStockQuote(pe, pb) {
  var isLow = (pe > 0 && pe < 15) || (pb > 0 && pb < 1);
  var category = isLow ? 'stockLow' : 'stockHigh';
  var pool = LI_DAXIAO_QUOTES[category];
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * 生成李大霄语录HTML片段
 * @param {object} quoteObj - { q: '语录', sub: '解读' }
 * @returns {string} HTML片段
 */
function formatLiDaxiaoQuote(quoteObj) {
  if (!quoteObj) return '';
  return '<div class="daxiao-quote">' +
    '<span class="daxiao-mark">"</span>' +
    '<span class="daxiao-text">' + escHTML(quoteObj.q) + '</span>' +
    '<span class="daxiao-mark">"</span>' +
    '<span class="daxiao-sub">— ' + escHTML(quoteObj.sub) + '</span>' +
    '<span class="daxiao-author">李大霄</span>' +
    '</div>';
}

/**
 * 生成奇迹语录HTML片段（个股级别）
 * @param {object} quoteObj - { q: '语录', sub: '解读' }
 * @returns {string} HTML片段
 */
function formatZhangYangQuote(quoteObj) {
  if (!quoteObj) return '';
  return '<div class="zy-quote">' +
    '<span class="zy-mark">"</span>' +
    '<span class="zy-text">' + escHTML(quoteObj.q) + '</span>' +
    '<span class="zy-mark">"</span>' +
    '<span class="zy-sub">— ' + escHTML(quoteObj.sub) + '</span>' +
    '<span class="zy-author">奇迹</span>' +
    '</div>';
}

/**
 * 根据今日大盘行情匹配奇迹经典语录（狂妄风格）
 * 结合涨跌幅与估值水平，匹配最契合的奇迹语录
 * @param {number} changePct - 大盘涨跌幅(%)
 * @param {number} sexy - 沪深300吸引力指数
 * @returns {object} { q: '语录', sub: '解读', context: '行情描述', category: '分类' }
 */
function getZhangYangQuote(changePct, sexy) {
  var category;
  var context = '';

  // 暴跌行情——奇迹逆势抄底的狂言
  if (changePct <= -2.5) {
    category = 'zhangYangCrash';
    context = '今日大盘暴跌' + Math.abs(changePct).toFixed(2) + '%';
  }
  // 暴涨行情——奇迹得意忘形的张狂
  else if (changePct >= 2.5) {
    category = 'zhangYangSurge';
    context = '今日大盘暴涨' + changePct.toFixed(2) + '%';
  }
  // 震荡行情——随机选择通用狂言或散户批判
  else {
    // 30%概率出散户批判，70%出通用狂言
    if (Math.random() < 0.3) {
      category = 'zhangYangRetail';
      context = '今日大盘' + (changePct >= 0 ? '小涨' : '小跌') + Math.abs(changePct).toFixed(2) + '%';
    } else {
      category = 'zhangYang';
      var absChange = Math.abs(changePct);
      if (changePct >= 0) {
        context = '今日大盘微涨' + absChange.toFixed(2) + '%';
      } else {
        context = '今日大盘微跌' + absChange.toFixed(2) + '%';
      }
    }
  }

  // 结合估值水平补充上下文
  if (sexy >= 2 && changePct < 0) {
    context += '，遍地黄金';
  } else if (sexy < 0.5 && changePct > 0) {
    context += '，泡沫越大越好';
  }

  var pool = LI_DAXIAO_QUOTES[category];
  var quote = pool[Math.floor(Math.random() * pool.length)];
  quote.context = context;
  quote.category = category;
  return quote;
}

/**
 * 根据个股PE/PB匹配奇迹个股语录
 * @param {number} pe - 个股PE
 * @param {number} pb - 个股PB
 * @returns {object} { q: '语录', sub: '解读' }
 */
function getZhangYangStockQuote(pe, pb) {
  var isLow = (pe > 0 && pe < 15) || (pb > 0 && pb < 1);
  var category = isLow ? 'zhangYangStockLow' : 'zhangYangStockHigh';
  var pool = LI_DAXIAO_QUOTES[category];
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * 量能点评：根据量价关系生成奇迹狂言式犀利点评
 * @param {number} changePct - 大盘涨跌幅%
 * @param {number} volRatio - 量比（今日成交额/20日均量）
 * @returns {object|null} { q, sub, context, volLabel, volLevel } 或 null
 */
function getVolumeCommentary(changePct, volRatio) {
  if (!volRatio || volRatio <= 0) return null;

  var category, context, volLabel, volLevel;

  // 缩量：volRatio < 0.7
  // 放量：volRatio > 1.3
  // 极端缩量：volRatio < 0.5
  // 极端放量：volRatio > 1.8

  var isShrink = volRatio < 0.7;
  var isSurge = volRatio > 1.3;
  var isExtremeShrink = volRatio < 0.5;
  var isExtremeSurge = volRatio > 1.8;
  var isUp = changePct > 0.1;
  var isDown = changePct < -0.1;
  var isFlat = !isUp && !isDown;

  var volPct = ((volRatio - 1) * 100).toFixed(0);
  var chgStr = Math.abs(changePct).toFixed(2);

  if (isShrink && isUp) {
    // 缩量上涨——奇迹最鄙视的形态
    category = 'zhangYangVolShrinkUp';
    volLabel = '缩量上涨';
    volLevel = isExtremeShrink ? '极端缩量' : '缩量';
    context = '大盘涨' + chgStr + '%但成交量仅20日均量的' + (volRatio * 100).toFixed(0) + '%，典型的缩量上涨';
  } else if (isShrink && isDown) {
    // 缩量下跌——抛压枯竭
    category = 'zhangYangVolShrinkDown';
    volLabel = '缩量下跌';
    volLevel = isExtremeShrink ? '极端缩量' : '缩量';
    context = '大盘跌' + chgStr + '%但成交量仅20日均量的' + (volRatio * 100).toFixed(0) + '%，缩量下跌';
  } else if (isSurge && isUp) {
    // 放量上涨——真行情
    category = 'zhangYangVolSurgeUp';
    volLabel = '放量上涨';
    volLevel = isExtremeSurge ? '极端放量' : '放量';
    context = '大盘涨' + chgStr + '%且成交量达20日均量的' + (volRatio * 100).toFixed(0) + '%，放量上涨';
  } else if (isSurge && isDown) {
    // 放量下跌——主力出逃
    category = 'zhangYangVolSurgeDown';
    volLabel = '放量下跌';
    volLevel = isExtremeSurge ? '极端放量' : '放量';
    context = '大盘跌' + chgStr + '%且成交量达20日均量的' + (volRatio * 100).toFixed(0) + '%，放量下跌';
  } else if (isShrink && isFlat) {
    // 缩量横盘——无趋势
    category = 'zhangYangVolShrinkDown';
    volLabel = '缩量横盘';
    volLevel = '缩量';
    context = '大盘几乎平盘，成交量仅20日均量的' + (volRatio * 100).toFixed(0) + '%，缩量观望';
  } else if (isSurge && isFlat) {
    // 放量横盘——变盘信号
    category = 'zhangYangVolSurgeUp';
    volLabel = '放量横盘';
    volLevel = '放量';
    context = '大盘几乎平盘但成交量达20日均量的' + (volRatio * 100).toFixed(0) + '%，放量横盘酝酿变盘';
  } else {
    // 正常量能，不生成量能点评
    return null;
  }

  var pool = LI_DAXIAO_QUOTES[category];
  if (!pool || pool.length === 0) return null;

  var quote = pool[Math.floor(Math.random() * pool.length)];
  quote.context = context;
  quote.volLabel = volLabel;
  quote.volLevel = volLevel;
  quote.category = category;
  return quote;
}

/* ============================================================
   十、智能解读生成
   ============================================================ */
function generateInsights(realtimeData) {
  var lowList = [];
  var highList = [];

  BASE_DATA.indices.forEach(function(idx) {
    // 优先使用实时PE和动态分位
    var pe = idx.pe;
    var pct = idx.pct10;
    if (realtimeData && realtimeData[idx.code]) {
      var rt = realtimeData[idx.code];
      if (rt.pe && rt.pe > 0) {
        pe = roundPrecise(rt.pe, 2);
        pct = calcDynamicPct(idx.pct10, idx.pe, pe, idx.peMin, idx.peMax);
      }
    }
    if (pct < 30) {
      lowList.push(idx.name + '(PE ' + pe.toFixed(1) + ', 分位' + pct + '%)');
    } else if (pct > 80) {
      highList.push(idx.name + '(PE ' + pe.toFixed(1) + ', 分位' + pct + '%)');
    }
  });

  // 行业 — 优先使用实时PE和动态分位（使用高精度计算）
  BASE_DATA.sectors.forEach(function(s) {
    var sPe = s.pe, sPct = s.pct10;
    var rtS = realtimeData && realtimeData[s.etfCode];
    if (rtS && rtS.pe && rtS.pe > 0) {
      sPe = roundPrecise(rtS.pe, 2);
      sPct = calcDynamicPct(s.pct10, s.pe, sPe, s.peMin, s.peMax);
    }
    if (sPct < 15) {
      lowList.push(s.name + '(PE ' + sPe.toFixed(1) + ', 分位' + sPct + '%)');
    } else if (sPct > 85) {
      highList.push(s.name + '(PE ' + sPe.toFixed(1) + ', 分位' + sPct + '%)');
    }
  });

  var lowText, highText;

  if (lowList.length > 0) {
    lowText = '当前以下标的处于历史低位区间，安全边际较高：\n';
    lowText += lowList.slice(0, 4).map(function(s) { return '• ' + s; }).join('\n');
    if (lowList.length > 4) lowText += '\n等共 ' + lowList.length + ' 个标的';
    
    // 添加策略建议
    var has300 = lowList.some(function(s) { return s.indexOf('沪深300') >= 0; });
    var hasHK = lowList.some(function(s) { return s.indexOf('恒生') >= 0; });
    if (has300 && hasHK) {
      lowText += '\n\n沪深300与港股均处低位，港股估值更低，性价比突出，适合定投布局。';
    } else if (has300) {
      lowText += '\n\n沪深300 PE处于近10年低位，蓝筹配置价值凸显，适合定投。';
    }
  } else {
    lowText = '当前市场整体估值处于中等水平，暂无极度低估标的。';
  }

  if (highList.length > 0) {
    highText = '以下标的估值处于历史高位，需警惕回调风险：\n';
    highText += highList.slice(0, 4).map(function(s) { return '• ' + s; }).join('\n');
    if (highList.length > 4) highText += '\n等共 ' + highList.length + ' 个标的';
  } else {
    highText = '当前暂无极度高估标的，市场整体风险可控。';
  }

  // 获取板块级别语录（取最低/最高分位的板块）— 使用动态分位
  var lowSectorQuote = '';
  var highSectorQuote = '';
  if (lowList.length > 0) {
    var lowestSector = null;
    BASE_DATA.sectors.forEach(function(s) {
      var sPct = s.pct10;
      var rtS = realtimeData && realtimeData[s.etfCode];
      if (rtS && rtS.pe && rtS.pe > 0) {
        sPct = calcDynamicPct(s.pct10, s.pe, roundPrecise(rtS.pe, 2), s.peMin, s.peMax);
      }
      if (sPct < 15 && (!lowestSector || sPct < lowestSector._dynPct)) {
        lowestSector = s; lowestSector._dynPct = sPct;
      }
    });
    if (lowestSector) lowSectorQuote = formatLiDaxiaoQuote(getSectorQuote(lowestSector._dynPct));
  }
  if (highList.length > 0) {
    var highestSector = null;
    BASE_DATA.sectors.forEach(function(s) {
      var sPct = s.pct10;
      var rtS = realtimeData && realtimeData[s.etfCode];
      if (rtS && rtS.pe && rtS.pe > 0) {
        sPct = calcDynamicPct(s.pct10, s.pe, roundPrecise(rtS.pe, 2), s.peMin, s.peMax);
      }
      if (sPct > 85 && (!highestSector || sPct > highestSector._dynPct)) {
        highestSector = s; highestSector._dynPct = sPct;
      }
    });
    if (highestSector) highSectorQuote = formatLiDaxiaoQuote(getSectorQuote(highestSector._dynPct));
  }

  document.getElementById('insightLowText').innerHTML = lowText.replace(/\n/g, '<br>') + lowSectorQuote;
  document.getElementById('insightHighText').innerHTML = highText.replace(/\n/g, '<br>') + highSectorQuote;

  // 更新李大霄语录专区 — 根据今日行情自动匹配
  var hs300 = BASE_DATA.indices.filter(function(i) { return i.code === 'sh000300'; })[0];
  var peHS300 = hs300 ? hs300.pe : 14.3;
  // 用实时数据覆盖静态PE
  if (realtimeData && realtimeData['sh000300'] && realtimeData['sh000300'].pe && realtimeData['sh000300'].pe > 0) {
    peHS300 = realtimeData['sh000300'].pe;
  }
  var sexy = (1 / peHS300) / (TREASURY_10Y / 100) - 1;

  // 获取今日大盘涨跌幅（优先用沪深300，备选上证指数）
  var marketChange = 0;
  var hasRealtimeChange = false;
  if (realtimeData) {
    if (realtimeData['sh000300'] && typeof realtimeData['sh000300'].changePercent === 'number') {
      marketChange = realtimeData['sh000300'].changePercent;
      hasRealtimeChange = true;
    } else if (realtimeData['sh000001'] && typeof realtimeData['sh000001'].changePercent === 'number') {
      marketChange = realtimeData['sh000001'].changePercent;
      hasRealtimeChange = true;
    }
  }

  var dzEl = document.getElementById('daxaoZone');
  // 实时行情尚未到达时，显示加载中，避免用0%匹配出错误语录
  if (!hasRealtimeChange && dzEl) {
    dzEl.innerHTML =
      '<div class="daxao-zone-title">李大霄专栏 · 今日行情点评</div>' +
      '<div class="daxao-zone-context">正在获取实时行情数据…</div>' +
      '<div class="daxao-zone-quote">"好股票就是要拿住，不要被短期波动吓跑。"</div>' +
      '<div class="daxao-zone-sub">— 等待行情数据加载后自动匹配今日点评</div>' +
      '<div class="daxao-zone-author">李大霄</div>';
    return;
  }

  // 根据今日行情+估值水平获取最佳匹配语录
  var bestQuote = getBestMatchQuote(marketChange, sexy);
  if (dzEl && bestQuote) {
    dzEl.innerHTML =
      '<div class="daxao-zone-title">李大霄专栏 · 今日行情点评</div>' +
      '<div class="daxao-zone-context">' + escHTML(bestQuote.context) + '</div>' +
      '<div class="daxao-zone-quote">"' + escHTML(bestQuote.q) + '"</div>' +
      '<div class="daxao-zone-sub">' + escHTML(bestQuote.sub) + '</div>' +
      '<div class="daxao-zone-author">李大霄</div>';
  }

  // 奇迹狂言专区——在李大霄下方追加，形成"苦口婆心 vs 狂妄霸道"的反差
  var zyEl = document.getElementById('zhangYangZone');
  if (zyEl) {
    var zyQuote = getZhangYangQuote(marketChange, sexy);
    zyEl.innerHTML =
      '<div class="zy-zone-title">奇迹狂言 · 股市猎场法则</div>' +
      '<div class="zy-zone-context">' + escHTML(zyQuote.context) + '</div>' +
      '<div class="zy-zone-quote">"' + escHTML(zyQuote.q) + '"</div>' +
      '<div class="zy-zone-sub">' + escHTML(zyQuote.sub) + '</div>' +
      '<div class="zy-zone-author">胜天资本 · 奇迹</div>';
  }

  // 量能点评专区——基于量价关系的犀利点评
  var volZone = document.getElementById('volumeCommentaryZone');
  if (volZone) {
    // 从情绪数据中获取量比
    var volRatioForCommentary = 1;
    var sentData = (typeof _lastSentimentData !== 'undefined') ? _lastSentimentData : null;
    if (sentData && sentData.avg20Amount > 0 && sentData.totalAmount > 0) {
      volRatioForCommentary = sentData.totalAmount / sentData.avg20Amount;
    }

    var volCommentary = getVolumeCommentary(marketChange, volRatioForCommentary);
    if (volCommentary) {
      var volLabelEl = document.getElementById('volZoneLabel');
      var volContextEl = document.getElementById('volZoneContext');
      var volQuoteEl = document.getElementById('volZoneQuote');
      var volSubEl = document.getElementById('volZoneSub');

      if (volLabelEl) volLabelEl.innerHTML =
        '<span class="vol-label-tag ' + (volCommentary.volLevel === '极端缩量' || volCommentary.volLevel === '极端放量' ? 'vol-label-extreme' : 'vol-label-normal') + '">' +
        volCommentary.volLabel + '</span>' +
        '<span class="vol-level-tag">' + volCommentary.volLevel + '</span>';
      if (volContextEl) volContextEl.textContent = volCommentary.context;
      if (volQuoteEl) volQuoteEl.innerHTML = '"' + escHTML(volCommentary.q) + '"';
      if (volSubEl) volSubEl.textContent = volCommentary.sub;
      volZone.style.display = 'block';
    } else {
      volZone.style.display = 'none';
    }
  }
}

/* ============================================================
   十三、辅助渲染
   ============================================================ */

/* 10年期国债收益率（%）：动态获取，多源冗余，失败则用默认值 */
/* 默认值参考：2026-08-03 东方财富datacenter/中债登 10Y国债收益率 1.7169% */
var TREASURY_10Y = 1.7169;
var TREASURY_DATE = ''; // 数据日期（由API返回）

/* 多期限国债收益率（供扩展使用） */
var TREASURY_2Y = 0;
var TREASURY_5Y = 0;
var TREASURY_30Y = 0;

/* 国债收益率30分钟缓存（日内波动小，延长缓存减少请求） */
var TREASURY_CACHE_KEY = 'treasury_10y_cache_v3';
var TREASURY_CACHE_TTL = 10 * 60 * 1000; // 10分钟（与行情刷新频率更匹配）

/**
 * 获取10年期国债收益率（带30分钟缓存）
 *
 * 多源优先级（经CORS实测验证 2026-08-03）：
 *   1. 东方财富 datacenter-web API（CORS支持，返回国债收益率曲线，字段EMM00166466）
 *      - 实测返回 1.7169%，与中债登官方数据一致
 *      - 同时获取2Y/5Y/30Y多期限数据
 *   2. 东方财富 push2 JSONP（全球国债 secid=100.GCNY10Y，JSONP无CORS限制）
 *   3. 本地 treasury.json 兜底文件（定期手动更新）
 *   4. 代码默认值 1.7169%（参考2026-08-03 datacenter API）
 *
 * 已移除的数据源及原因：
 *   - 腾讯 hz010107：经查证为21国债(7)个券代码（20年期），非10年期国债收益率，数据语义错误
 *   - Yahoo Finance CN10Y=X：2021年起不服务中国大陆，返回429
 *   - 中债登 yield.chinabond.com.cn：无公开API，CORS不可靠
 *   - 新浪财经 hq.sinajs.cn：需Referer头，浏览器无法自定义Referer
 *
 * @returns {Promise}
 */
function fetchTreasuryYield(forceRefresh) {
  // 方案0：先查30分钟缓存（forceRefresh 时跳过）
  if (!forceRefresh) {
  try {
    var raw = localStorage.getItem(TREASURY_CACHE_KEY);
    if (raw) {
      var obj = JSON.parse(raw);
      if (Date.now() - obj.ts < TREASURY_CACHE_TTL && obj.value > 0 && obj.value < 10) {
        TREASURY_10Y = obj.value;
        TREASURY_DATE = obj.date || '';
        if (obj.y2) TREASURY_2Y = obj.y2;
        if (obj.y5) TREASURY_5Y = obj.y5;
        if (obj.y30) TREASURY_30Y = obj.y30;
        if(__DEBUG__)console.log('国债收益率命中30分钟缓存:', obj.value + '%', '日期:', obj.date);
        updateTreasuryDisplay(false);
        return Promise.resolve();
      }
    }
  } catch(e) {}
  } // end if (!forceRefresh)

  /**
   * 验证国债收益率数值有效性
   * 中国10Y国债历史范围约1.5%~5.0%，合理区间0.5%~10%
   */
  function isValidYield(y) {
    return !isNaN(y) && isFinite(y) && y > 0.5 && y < 10;
  }

  // 方案1: 东方财富 datacenter-web API（CORS支持，首选数据源）
  // 接口返回中国国债收益率曲线（中债登委托发布），数据与官方一致
  // 字段映射：EMM00166466=10Y, EMM00166462=5Y, EMM00166469=30Y, EMM00588704=2Y
  function tryDataCenterWeb() {
    var url = 'https://datacenter-web.eastmoney.com/api/data/v1/get' +
      '?reportName=RPTA_WEB_TREASURYYIELD' +
      '&columns=EMM00166466,EMM00166462,EMM00166469,EMM00588704,SOLAR_DATE' +
      '&sortColumns=SOLAR_DATE' +
      '&sortTypes=-1' +
      '&pageSize=1' +
      '&pageNumber=1';
    return fetchWithTimeout(url, { cache: 'no-store' }, 6000).then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function(json) {
      if (json && json.result && json.result.data && json.result.data.length > 0) {
        var row = json.result.data[0];
        var y = parseFloat(row['EMM00166466']);
        if (isValidYield(y)) {
          // 同时提取多期限数据
          var y2 = parseFloat(row['EMM00588704']);
          var y5 = parseFloat(row['EMM00166462']);
          var y30 = parseFloat(row['EMM00166469']);
          var dateStr = (row['SOLAR_DATE'] || '').substring(0, 10);
          if(__DEBUG__)console.log('[国债] datacenter-web获取成功: 10Y=' + y + '% 2Y=' + y2 + '% 5Y=' + y5 + '% 30Y=' + y30 + '% 日期=' + dateStr);
          return { value: y, date: dateStr, y2: y2, y5: y5, y30: y30 };
        }
      }
      throw new Error('datacenter-web国债数据为空或字段无效');
    });
  }

  // 方案2: 东方财富 push2 JSONP — 全球国债收益率（中国10Y）
  // secid=100.GCNY10Y 为中国10年期国债，JSONP方式无CORS限制
  // 注意：此接口可能因网络原因不稳定，仅作为datacenter-web的补充
  function tryEmJsonp() {
    var emUrl = 'https://push2.eastmoney.com/api/qt/stock/get' +
      '?fltt=2&fields=f43,f57,f58,f170&secid=100.GCNY10Y';
    return emJsonp(emUrl, 5000).then(function(data) {
      if (data && data.data) {
        var y = parseFloat(data.data.f43);
        if (!isNaN(y)) {
          // f43 可能是百分数形式(如1.72)或小数形式(如0.0172)
          if (y > 10) y = y / 100; // 小数形式转百分数
          if (isValidYield(y)) {
            if(__DEBUG__)console.log('[国债] push2 JSONP获取成功:', y + '%');
            return { value: y, date: '', y2: 0, y5: 0, y30: 0 };
          }
        }
      }
      throw new Error('东方财富push2国债数据为空');
    });
  }

  // 方案3: 本地 treasury.json 兜底文件（定期手动更新）
  function tryLocalCache() {
    var cacheUrl = 'data/treasury.json?t=' + Date.now();
    return fetchWithTimeout(cacheUrl, { cache: 'no-store' }, 3000)
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(data) {
        if (data && data.yield_10y) {
          var y = parseFloat(data.yield_10y);
          if (isValidYield(y)) {
            if(__DEBUG__)console.log('[国债] 从本地treasury.json获取:', y + '%', '日期:', data.date);
            return {
              value: y,
              date: data.date || '',
              y2: parseFloat(data.yield_2y) || 0,
              y5: parseFloat(data.yield_5y) || 0,
              y30: parseFloat(data.yield_30y) || 0
            };
          }
        }
        throw new Error('本地treasury.json无有效数据');
      });
  }

  // 统一更新显示的辅助函数
  function updateTreasuryDisplay(isDefault) {
    var trEl = document.getElementById('dashTreasury');
    if (trEl) {
      var suffix = isDefault ? ' (默认)' : '';
      trEl.textContent = '国债 ' + TREASURY_10Y.toFixed(4) + '%' + suffix;
    }
  }

  // 链式尝试所有方案（优先级：1.datacenter-web 2.push2 JSONP 3.本地文件 4.默认值）
  return tryDataCenterWeb()
    .catch(function(err) {
      console.warn('[国债] datacenter-web失败:', err.message, '→ 尝试push2 JSONP');
      return tryEmJsonp();
    })
    .catch(function(err) {
      console.warn('[国债] push2 JSONP失败:', err.message, '→ 尝试本地文件');
      return tryLocalCache();
    })
    .then(function(result) {
      TREASURY_10Y = result.value;
      TREASURY_DATE = result.date || '';
      if (result.y2 > 0) TREASURY_2Y = result.y2;
      if (result.y5 > 0) TREASURY_5Y = result.y5;
      if (result.y30 > 0) TREASURY_30Y = result.y30;
      if(__DEBUG__)console.log('[国债] 收益率已更新:', result.value.toFixed(4) + '%', '日期:', result.date || '未知');
      // 写入缓存（包含多期限数据和日期）
      try {
        localStorage.setItem(TREASURY_CACHE_KEY, JSON.stringify({
          ts: Date.now(),
          value: result.value,
          date: result.date,
          y2: result.y2,
          y5: result.y5,
          y30: result.y30
        }));
      } catch(e) {}
      updateTreasuryDisplay(false);
    })
    .catch(function(err) {
      // 所有API均失败，使用默认值
      console.warn('[国债] 所有数据源失败:', err.message, '→ 使用默认值:', TREASURY_10Y + '%');
      try { localStorage.removeItem(TREASURY_CACHE_KEY); } catch(e) {}
      updateTreasuryDisplay(true);
    });
}

/**
 * 渲染估值仪表盘（动态计算格雷厄姆指数/市场吸引力指数/股债利差）
 * 格雷厄姆指数 = 沪深300盈利收益率(1/PE) ÷ 国债收益率（保守口径，大盘股）
 * 市场吸引力指数 = 全市场等权盈利收益率 ÷ 国债收益率 − 1（激进口径，含小盘股）
 *   ※ 等权PE = BASE_DATA行业板块PE的算术平均值（近似全市场等权PE）
 *   ※ 吸引力指数 > 2 为绝对低位，1.5~2 熊市低位，0.5~1.5 适中，<0.5 偏高，<0 泡沫
 *   ※ 与第一层"沪深300吸引力"互补：沪深300口径偏保守乐观，全市场等权口径偏激进谨慎
 * 股债利差 = 全市场盈利收益率×100 - 国债收益率（百分点）
 * @param {object|null} realtimeData - 实时行情数据 {code: {price, pe, ...}}
 */
function renderDashboard(realtimeData) {
  // ============================================================
  // 实时市场仪表盘（高敏感度·分钟级更新）
  // 替代旧的估值仪表盘（格雷厄姆/PE等月级别变化指标）
  // 4个卡片：市场温度 / 主力资金 / 涨跌家数 / 日内动量
  // ============================================================

  var hasRealtime = realtimeData && Object.keys(realtimeData).length > 0;

  // 显示国债收益率（保留，仍有参考价值）
  var trEl = document.getElementById('dashTreasury');
  if (trEl) {
    var trText = '国债 ' + TREASURY_10Y.toFixed(4) + '%';
    if (TREASURY_DATE) trText += '（' + TREASURY_DATE + '）';
    trEl.textContent = trText;
  }

  // ========== 卡片1: 市场温度（恐慌贪婪指数 0-100） ==========
  var tempCard = document.getElementById('dashTemp');
  if (tempCard) {
    var tempVal = tempCard.querySelector('.d-val');
    var tempTag = tempCard.querySelector('.d-tag');
    var tempBarFill = tempCard.querySelector('.temp-bar-fill');
    var sent = (typeof _lastSentimentData !== 'undefined') ? _lastSentimentData : null;

    if (sent && typeof sent.score === 'number') {
      var score = sent.score;
      if (typeof animateOdometer === 'function') {
        animateOdometer(tempVal, String(score));
      } else {
        tempVal.textContent = score;
      }

      // 温度等级判定
      var tempLevel, tempClass;
      if (score <= 25) { tempLevel = '极度恐慌'; tempClass = 't-red'; tempCard.className = 'dash-card glass-card hl-red'; }
      else if (score <= 45) { tempLevel = '恐慌'; tempClass = 't-red'; tempCard.className = 'dash-card glass-card hl-red'; }
      else if (score <= 55) { tempLevel = '中性'; tempClass = 't-yellow'; tempCard.className = 'dash-card glass-card'; }
      else if (score <= 75) { tempLevel = '贪婪'; tempClass = 't-green'; tempCard.className = 'dash-card glass-card'; }
      else { tempLevel = '极度贪婪'; tempClass = 't-green'; tempCard.className = 'dash-card glass-card hl-green'; }

      tempVal.className = 'd-val ' + tempClass;
      tempTag.textContent = tempLevel;
      tempTag.className = 'd-tag ' + (score <= 45 ? 'red' : score <= 55 ? 'yellow' : 'green');

      // 温度条填充
      if (tempBarFill) {
        tempBarFill.style.width = Math.max(2, score) + '%';
        // 温度条颜色：恐慌=红，中性=黄，贪婪=绿
        if (score <= 45) {
          tempBarFill.style.background = 'linear-gradient(90deg, #FF0000, #FF6B6B)';
        } else if (score <= 55) {
          tempBarFill.style.background = 'linear-gradient(90deg, #FFAE00, #FFD700)';
        } else {
          tempBarFill.style.background = 'linear-gradient(90deg, #00AA00, #00C853)';
        }
      }
    } else {
      tempVal.textContent = '—';
      tempTag.textContent = '等待数据';
      tempTag.className = 'd-tag gray';
      if (tempBarFill) tempBarFill.style.width = '0%';
    }
  }

  // ========== 卡片2: 主力资金净流入 ==========
  var flowCard = document.getElementById('dashFlow');
  if (flowCard) {
    var flowVal = flowCard.querySelector('.d-val');
    var flowTag = flowCard.querySelector('.d-tag');
    var flowSub = document.getElementById('dashFlowSub');
    var sf = (typeof _lastSectorFlowData !== 'undefined') ? _lastSectorFlowData : null;

    if (sf && typeof sf.totalMain === 'number') {
      var totalMainYi = sf.totalMain / 10000; // 万元 → 亿元
      var flowStr = (totalMainYi >= 0 ? '+' : '') + totalMainYi.toFixed(1) + '亿';
      if (typeof animateOdometer === 'function') {
        animateOdometer(flowVal, flowStr);
      } else {
        flowVal.textContent = flowStr;
      }

      var inflowCount = sf.inflow ? sf.inflow.length : 0;
      var outflowCount = sf.outflow ? sf.outflow.length : 0;

      if (totalMainYi > 0) {
        flowVal.className = 'd-val t-red';
        flowTag.textContent = '净流入';
        flowTag.className = 'd-tag red';
        flowCard.className = 'dash-card glass-card hl-red';
      } else if (totalMainYi < 0) {
        flowVal.className = 'd-val t-green';
        flowTag.textContent = '净流出';
        flowTag.className = 'd-tag green';
        flowCard.className = 'dash-card glass-card hl-green';
      } else {
        flowVal.className = 'd-val t-yellow';
        flowTag.textContent = '均衡';
        flowTag.className = 'd-tag yellow';
        flowCard.className = 'dash-card glass-card';
      }

      if (flowSub) {
        flowSub.textContent = inflowCount + '板块流入 / ' + outflowCount + '板块流出';
      }
    } else {
      flowVal.textContent = '—';
      flowTag.textContent = '等待数据';
      flowTag.className = 'd-tag gray';
      if (flowSub) flowSub.textContent = '板块资金·实时';
    }
  }

  // ========== 卡片3: 涨跌家数比 ==========
  var breadthCard = document.getElementById('dashBreadth');
  if (breadthCard) {
    var brVal = breadthCard.querySelector('.d-val');
    var brTag = breadthCard.querySelector('.d-tag');
    var brSub = document.getElementById('dashBreadthSub');
    var sent2 = (typeof _lastSentimentData !== 'undefined') ? _lastSentimentData : null;

    if (sent2 && typeof sent2.up === 'number' && typeof sent2.down === 'number') {
      var upCount = sent2.up;
      var downCount = sent2.down;
      var ratio = downCount > 0 ? (upCount / downCount).toFixed(2) : '∞';
      var brStr = upCount + ':' + downCount;
      if (typeof animateOdometer === 'function') {
        animateOdometer(brVal, brStr);
      } else {
        brVal.textContent = brStr;
      }

      if (upCount > downCount * 1.5) {
        brVal.className = 'd-val t-red';
        brTag.textContent = '涨多跌少';
        brTag.className = 'd-tag red';
        breadthCard.className = 'dash-card glass-card hl-red';
      } else if (downCount > upCount * 1.5) {
        brVal.className = 'd-val t-green';
        brTag.textContent = '跌多涨少';
        brTag.className = 'd-tag green';
        breadthCard.className = 'dash-card glass-card hl-green';
      } else {
        brVal.className = 'd-val t-yellow';
        brTag.textContent = '多空均衡';
        brTag.className = 'd-tag yellow';
        breadthCard.className = 'dash-card glass-card';
      }

      if (brSub) {
        var lu = sent2.limitUp || 0;
        var ld = sent2.limitDown || 0;
        brSub.textContent = '比' + ratio + ' · 涨停' + lu + ' 跌停' + ld;
      }
    } else {
      brVal.textContent = '—';
      brTag.textContent = '等待数据';
      brTag.className = 'd-tag gray';
      if (brSub) brSub.textContent = '全A涨跌·实时';
    }
  }

  // ========== 卡片4: 日内动量（多指数加权涨跌幅） ==========
  var momCard = document.getElementById('dashMomentum');
  if (momCard) {
    var momVal = momCard.querySelector('.d-val');
    var momTag = momCard.querySelector('.d-tag');
    var momSub = document.getElementById('dashMomentumSub');
    var rt = realtimeData || (typeof _lastRealtimeData !== 'undefined' ? _lastRealtimeData : null);

    if (rt) {
      // 加权动量：沪深300(40%) + 创业板指(30%) + 科创50(30%)
      var chg300 = rt['sh000300'] ? rt['sh000300'].changePercent : null;
      var chgCYB = rt['sz399006'] ? rt['sz399006'].changePercent : null;
      var chgKC = rt['sh000688'] ? rt['sh000688'].changePercent : null;

      // 备选指数
      if (chg300 === null || chg300 === undefined) {
        chg300 = rt['sh000001'] ? rt['sh000001'].changePercent : 0;
      }

      var weights = [];
      var changes = [];
      if (chg300 !== null && chg300 !== undefined) { weights.push(0.4); changes.push(chg300); }
      if (chgCYB !== null && chgCYB !== undefined) { weights.push(0.3); changes.push(chgCYB); }
      if (chgKC !== null && chgKC !== undefined) { weights.push(0.3); changes.push(chgKC); }

      var totalWeight = weights.reduce(function(a, b) { return a + b; }, 0);
      var weightedChg = 0;
      if (totalWeight > 0) {
        for (var i = 0; i < changes.length; i++) {
          weightedChg += changes[i] * (weights[i] / totalWeight);
        }
      }

      var momStr = (weightedChg >= 0 ? '+' : '') + weightedChg.toFixed(2) + '%';
      if (typeof animateOdometer === 'function') {
        animateOdometer(momVal, momStr);
      } else {
        momVal.textContent = momStr;
      }

      if (weightedChg > 0.5) {
        momVal.className = 'd-val t-red';
        momTag.textContent = '强势上攻';
        momTag.className = 'd-tag red';
        momCard.className = 'dash-card glass-card hl-red';
      } else if (weightedChg > 0) {
        momVal.className = 'd-val t-red';
        momTag.textContent = '小幅上涨';
        momTag.className = 'd-tag red';
        momCard.className = 'dash-card glass-card';
      } else if (weightedChg > -0.5) {
        momVal.className = 'd-val t-green';
        momTag.textContent = '小幅下跌';
        momTag.className = 'd-tag green';
        momCard.className = 'dash-card glass-card';
      } else {
        momVal.className = 'd-val t-green';
        momTag.textContent = '弱势下行';
        momTag.className = 'd-tag green';
        momCard.className = 'dash-card glass-card hl-green';
      }

      if (momSub) {
        var parts = [];
        if (chg300 !== null && chg300 !== undefined) parts.push('沪深300 ' + (chg300 >= 0 ? '+' : '') + chg300.toFixed(2) + '%');
        if (chgCYB !== null && chgCYB !== undefined) parts.push('创业板 ' + (chgCYB >= 0 ? '+' : '') + chgCYB.toFixed(2) + '%');
        if (chgKC !== null && chgKC !== undefined) parts.push('科创50 ' + (chgKC >= 0 ? '+' : '') + chgKC.toFixed(2) + '%');
        momSub.textContent = parts.join(' · ') || '多指数加权';
      }
    } else {
      momVal.textContent = '—';
      momTag.textContent = '等待数据';
      momTag.className = 'd-tag gray';
      if (momSub) momSub.textContent = '沪深300·创业板·科创50';
    }
  }

  // ========== 高温预警 ==========
  var sentScore = _lastSentimentData ? _lastSentimentData.score : undefined;
  updateHeroDashboard(null, null, sentScore);

  // ========== 更新时间戳 ==========
  var heroTs = document.getElementById('heroTimestamp');
  if (heroTs) {
    var now = new Date();
    var hh = ('0' + now.getHours()).slice(-2);
    var mm = ('0' + now.getMinutes()).slice(-2);
    var tsBase = '更新于 ' + hh + ':' + mm + ' · 数据来源：腾讯+东方财富';
    var tsHint = getTradeStatusHint();
    heroTs.innerHTML = tsBase + tsHint.badge + (tsHint.hint ? '<span class="timestamp-hint">' + tsHint.hint + '</span>' : '');
    if (!tsHint.isTrading) {
      document.body.classList.add('market-closed');
    } else {
      document.body.classList.remove('market-closed');
    }
  }
}

/**
 * 更新首屏仪表盘动态效果（高温预警等）
 */
function updateHeroDashboard(graham, sexy, sentimentScore, sentimentLevel) {
  // 市场温度 - 高温预警（温度>70时显示）
  var htwEl = document.getElementById('highTempWarning');
  if (htwEl && sentimentScore !== undefined) {
    if (sentimentScore > 70) {
      htwEl.classList.add('active');
    } else {
      htwEl.classList.remove('active');
    }
  }
}

/**
 * 切换金句折叠区
 */
function toggleQuoteCollapse() {
  var wrap = document.getElementById('quoteCollapseWrap');
  if (wrap) {
    wrap.classList.toggle('expanded');
  }
}

function renderOverview(realtimeData) {
  // 更新第一层核心指标总览
  // 沪深300吸引力（保守口径）：格雷厄姆/星级/吸引力均用沪深300 PE（大盘蓝筹股）
  // 全市场性感指数（激进口径）：在仪表盘中单独展示（含小盘股，等权赋权）
  var hs300 = BASE_DATA.indices.filter(function(i) { return i.code === 'sh000300'; })[0];
  var peHS300 = hs300 ? hs300.pe : 14.3;
  var csiAll = BASE_DATA.indices.filter(function(i) { return i.code === 'sh000985'; })[0];
  var peAllA = csiAll ? csiAll.pe : 18.5;
  var dyAllA = csiAll ? csiAll.dy : 2.15;

  // 动态数据覆盖静态PE
  if (realtimeData) {
    if (realtimeData['sh000300'] && realtimeData['sh000300'].pe && realtimeData['sh000300'].pe > 0) {
      peHS300 = realtimeData['sh000300'].pe;
    }
    if (realtimeData['sh000985'] && realtimeData['sh000985'].pe && realtimeData['sh000985'].pe > 0) {
      peAllA = realtimeData['sh000985'].pe;
    }
    // PB可用于估算股息率：股息率与价格成反比，PB升高(价格上涨) → DY下降
    if (realtimeData['sh000985'] && realtimeData['sh000985'].pb && realtimeData['sh000985'].pb > 0 && csiAll) {
      var pbRatio = csiAll.pb / realtimeData['sh000985'].pb;
      dyAllA = csiAll.dy * pbRatio;
    }
  }

  var earningsYieldHS300 = 1 / peHS300;
  var graham = earningsYieldHS300 / (TREASURY_10Y / 100);

  // 全市场等权PE估算（仅用于仪表盘的性感指数，此处不再使用）
  // 优先使用实时行业ETF PE数据，回退到静态基准
  var sectorPEs2 = BASE_DATA.sectors.map(function(s) {
    var rt = realtimeData && realtimeData[s.etfCode];
    if (rt && rt.pe && rt.pe > 0) return roundPrecise(rt.pe, 2);
    return s.pe;
  }).filter(function(p) { return p > 0; });
  var peAllA_eq = Math.max(20, Math.min(60, sectorPEs2.length > 0
    ? sectorPEs2.reduce(function(a, b) { return a + b; }, 0) / sectorPEs2.length
    : peAllA * 1.85));
  // 沪深300吸引力（保守口径）：大盘蓝筹股超额收益率
  var sexy = earningsYieldHS300 / (TREASURY_10Y / 100) - 1;
  // 综合回报率 = 沪深300盈利收益率 + 国债收益率（百分比），与吸引力指数同口径
  // 阈值与sexy指数对齐：sexy>3(超配) ↔ priceStrength>8%(强)，sexy 1~3 ↔ 6~8%(中)，sexy<1 ↔ <6%(弱)
  var priceStrength = Math.round((earningsYieldHS300 + TREASURY_10Y/100) * 100);
  var psEl = document.getElementById('tier1PriceStrength');
  if (psEl) {
    animateOdometer(psEl, priceStrength + '%');
    // 综合回报率着色：>8%红色(强/投资划算)，6~8%黄色(中)，<6%绿色(弱/不划算)
    psEl.style.color = priceStrength > 8 ? '#FF0000' : priceStrength > 6 ? '#FFD700' : '#00AA00';
    psEl.style.textShadow = '0 0 8px ' + psEl.style.color + '55';
    var psTag = document.getElementById('tier1PriceStrengthTag');
    if (psTag) {
      if (priceStrength > 8) {
        psTag.innerHTML = '<span class="price-strength-tag strong">强 · 投资划算</span>';
      } else if (priceStrength > 6) {
        psTag.innerHTML = '<span class="price-strength-tag medium">中 · 一般</span>';
      } else {
        psTag.innerHTML = '<span class="price-strength-tag weak">弱 · 不划算</span>';
      }
    }
  }
  
  // 沪深300吸引力（保守口径，大盘蓝筹股）>3 绝对低位，2~3 熊市低位，0.8~2 适中，0~0.8 偏高，<0 泡沫
  var aiEl = document.getElementById('tier1AttractIdx');
  if (aiEl) {
    animateOdometer(aiEl, sexy.toFixed(2));
    aiEl.style.color = sexy >= 2.0 ? '#FF0000' : sexy >= 0.8 ? '#FFD700' : '#00AA00';
    aiEl.style.textShadow = '0 0 8px ' + aiEl.style.color + '55';
  }
  // 仓位建议（沪深300保守口径，稳健策略）：最高80%股，始终保留债券仓位
  var stockPos, posText;
  if (sexy <= 0) { stockPos = 0; posText = '0%股/100%债'; }
  else if (sexy < 1) { stockPos = Math.round(sexy * 30); posText = stockPos + '%股/' + (100-stockPos) + '%债'; }
  else if (sexy < 2) { stockPos = 30 + Math.round((sexy - 1) * 20); posText = stockPos + '%股/' + (100-stockPos) + '%债'; }
  else if (sexy < 3) { stockPos = 50 + Math.round((sexy - 2) * 15); posText = stockPos + '%股/' + (100-stockPos) + '%债'; }
  else { stockPos = 80; posText = '80%股/20%债'; }
  var aiSubEl = document.getElementById('tier1AttractSub');
  if (aiSubEl) aiSubEl.textContent = posText + ' · 超额收益率·保守口径·稳健策略';
  
  // 估值星级 = 沪深300盈利收益率 ÷ 国债收益率，星越多说明股票越便宜
  // 校准：与仪表盘格雷厄姆指数阈值一致
  var starRatio = graham; // 沪深300盈利收益率/国债收益率
  var stars = 5;
  if (starRatio >= 4.5) stars = 5;       // 黄金买入区
  else if (starRatio >= 3.5) stars = 4;   // 具备投资价值
  else if (starRatio >= 2.5) stars = 3;   // 适中区间
  else if (starRatio >= 1.8) stars = 2;   // 偏低
  else stars = 1;                          // 风险偏高
  var starsEl = document.getElementById('tier1Stars');
  if (starsEl) {
    var starHtml = '';
    for (var i = 0; i < 5; i++) {
      starHtml += i < stars ? '<span class="s-on">★</span>' : '<span class="s-off">★</span>';
    }
    starsEl.innerHTML = starHtml;
  }
  var starsSub = document.getElementById('tier1StarsSub');
  if (starsSub) starsSub.textContent = '股票收益是债券' + starRatio.toFixed(1) + '倍 · ' + stars + '星';
  
  // 全市场PE / 股息率
  var peEl = document.getElementById('tier1PE');
  if (peEl) {
    animateOdometer(peEl, peAllA.toFixed(1));
    // 动态计算全市场PE分位，用于颜色判定（统一精度工具）
    var csiAllPct = csiAll ? calcDynamicPct(csiAll.pct10, csiAll.pe, peAllA, csiAll.peMin, csiAll.peMax) : 42;
    peEl.style.color = csiAllPct < 30 ? '#FF0000' : csiAllPct < 70 ? '#FFD700' : '#00AA00';
  }
  var dyEl = document.getElementById('tier1DivYield');
  if (dyEl) dyEl.textContent = '股息率 ' + dyAllA.toFixed(2) + '%';
  
  // 市场结论（基于沪深300吸引力阈值，保守口径，含仓位建议）
  var conclEl = document.getElementById('tier1Conclusion');
  if (conclEl) {
    var conclusion = '';
    if (sexy >= 3) {
      conclusion = '<b>市场总览：</b>沪深300吸引力' + sexy.toFixed(2) + '，深度价值区域。建议<b>' + posText + '</b>，大盘蓝筹股历史上类似情境多为市场底部，但需保留债券仓位防范不确定性。';
    } else if (sexy >= 2) {
      conclusion = '<b>市场总览：</b>沪深300吸引力' + sexy.toFixed(2) + '，偏低估。建议<b>' + posText + '</b>，大盘股具备较好投资价值。';
    } else if (sexy >= 1.5) {
      conclusion = '<b>市场总览：</b>沪深300吸引力' + sexy.toFixed(2) + '，偏低估。建议<b>' + posText + '</b>，结构性机会为主。';
    } else if (sexy >= 0.8) {
      conclusion = '<b>市场总览：</b>沪深300吸引力' + sexy.toFixed(2) + '，估值适中。建议<b>' + posText + '</b>，均衡配置为主。';
    } else if (sexy >= 0) {
      conclusion = '<b>市场总览：</b>沪深300吸引力' + sexy.toFixed(2) + '，偏高估。建议<b>' + posText + '</b>，谨慎控制仓位。';
    } else {
      conclusion = '<b>市场总览：</b>沪深300吸引力' + sexy.toFixed(2) + '，股票收益率低于国债。建议<b>' + posText + '</b>，回避权益资产。';
    }
    conclEl.innerHTML = conclusion + ' <span class="data-driven-label">数据驱动展示（非预测）</span>' + formatLiDaxiaoQuote(getMarketQuote(sexy));
  }
}

function updateHeaderTime(success) {
  var now = new Date();
  var timeStr = now.getFullYear() + '-' + 
    String(now.getMonth()+1).padStart(2,'0') + '-' +
    String(now.getDate()).padStart(2,'0') + ' ' +
    String(now.getHours()).padStart(2,'0') + ':' +
    String(now.getMinutes()).padStart(2,'0');
  var prefix = success ? '◉ 实时更新' : '◇ 基准数据';
  var suffix = ' | DATA STREAM ACTIVE | 沪深港估值终端 v3.0';
  var el = document.getElementById('updateTime');
  el.textContent = prefix + ' ' + timeStr + suffix;
  // 实时数据时红色发光（在线），基准数据时黄色（降级模式）
  var dot = document.getElementById('liveDot');
  if (dot) {
    if (success) {
      dot.style.background = '#FF0000';
      dot.style.boxShadow = '0 0 6px #FF0000, 0 0 12px rgba(255, 0, 0,0.4)';
    } else {
      dot.style.background = '#FFD700';
      dot.style.boxShadow = '0 0 6px #FFD700, 0 0 12px rgba(255,215,0,0.3)';
    }
  }
  // 更新第一层数据来源标签
  var dsEl = document.getElementById('tier1DataSource');
  if (dsEl) {
    dsEl.textContent = '数据来源：腾讯财经 + 东方财富 · 更新于：' + timeStr;
  }
}

/* ============================================================
   七、消息面分析
   ============================================================ */

// 消息面分析筛选状态
var _naFilter = 'all';
// 全局存储分析因素，供筛选使用
var _naFactors = [];
// 全局存储新闻数据
var _naNewsData = [];
// 新闻数据加载错误状态
var _naErrorState = null; // null=正常, string=错误信息
var _naLastErrorTime = null; // 最后一次错误时间

/* ============================================================
   消息面新闻数据：实时从东方财富7x24快讯API获取
   初始为空数组，由 fetchLatestNews() 异步填充
   ============================================================ */
var NEWS_DATA = [];
var _newsDataSource = ''; // 数据来源标记（实时快讯/缓存/空）

/* ============================================================
   消息面新闻动态获取：多源JSONP获取最新市场快讯
   数据源优先级：
     1. 东方财富 newsapi 7x24快讯（JSONP，var回调格式）
     2. 东方财富 np-weblist 快讯列表（JSONP，cb回调格式）
     3. 本地缓存（localStorage 15分钟TTL）
   ============================================================ */
var NEWS_CACHE_KEY = 'na_news_cache_v2';
var NEWS_CACHE_TTL = 15 * 60 * 1000; // 15分钟

/* ---- 市场相关性关键词（用于过滤无关快讯） ---- */
var MARKET_NEWS_KEYWORDS = [
  'A股', '股市', '大盘', '指数', '沪指', '深成', '创业板', '科创板', '北证',
  '央行', '证监会', '银保监', '金管局', '财政部', '发改委', '国务院', '工信部',
  '降息', '降准', 'LPR', 'MLF', '逆回购', '流动性', '社融', 'M2',
  '外资', '北向', '北向资金', '净流入', '净流出', '沪深港通',
  '回购', '增持', '减持', '分红', '融资融券',
  '美股', '港股', '亚太', '欧洲', '华尔街', '美联储', '鲍威尔', '纳斯达克',
  '政策', '利好', '利空', '改革', '开放', '规划', '纲要',
  '经济', 'CPI', 'PPI', 'GDP', 'PMI', '进出口', '贸易',
  '半导体', '新能源', '人工智能', '芯片', '医药', '军工', '机器人',
  '房地产', '楼市', '住房', '保障房',
  '注册制', '并购', '重组', '退市', 'ST',
  'ETF', '基金', '险资', '社保',
  '国债', '收益率', '汇率', '人民币'
];

/* ---- 利好关键词及权重（正分） ---- */
var NEWS_BULL_KEYWORDS = {
  '降准': 3, '降息': 3, '万亿': 3, '一揽子': 3, '组合拳': 3, '重大利好': 3,
  '国务院': 2, '利好': 2, '支持': 2, '促进': 2, '推动': 2, '加码': 2,
  '释放': 2, '改革': 2, '开放': 2, '扶持': 2, '补贴': 2, '减税': 2,
  '净流入': 2, '回购': 1, '增持': 1, '大涨': 2, '上涨': 1, '暴涨': 3,
  '牛市': 2, '反弹': 1, '回暖': 1, '复苏': 2, '超预期': 2,
  '纳入': 1, '扩容': 1, '批准': 1, '通过': 1, '落地': 1, '实施': 1
};

/* ---- 利空关键词及权重（负分） ---- */
var NEWS_BEAR_KEYWORDS = {
  '暴跌': 3, '熔断': 3, '崩盘': 3, '重大利空': 3, '黑天鹅': 3,
  '处罚': 2, '违规': 2, '立案': 2, '退市': 2, '风险警示': 2,
  '限制': 2, '收紧': 2, '叫停': 2, '整顿': 2, '问责': 2,
  '大跌': 2, '跳水': 2, '重挫': 2,
  '减持': 1, '净流出': 2, '熊市': 2, '恶化': 2,
  '违约': 2, '爆雷': 2, '质押': 1, '强平': 2,
  '不及预期': 2, '下滑': 1, '萎缩': 2, '衰退': 3,
  '制裁': 2, '贸易战': 2, '关税': 1, '加息': 2
};

/**
 * 判断是否为市场相关新闻
 */
function isMarketNews(title, desc) {
  var text = (title || '') + (desc || '');
  return MARKET_NEWS_KEYWORDS.some(function(kw) { return text.indexOf(kw) >= 0; });
}

/**
 * 智能分类新闻方向（利好/利空/中性）— 加权评分算法
 * 统计利好和利空关键词的加权得分，取净值得出方向
 */
function classifyNews(title, desc) {
  var text = (title || '') + (desc || '');
  var bullScore = 0;
  var bearScore = 0;

  // 统计利好得分
  Object.keys(NEWS_BULL_KEYWORDS).forEach(function(kw) {
    if (text.indexOf(kw) >= 0) bullScore += NEWS_BULL_KEYWORDS[kw];
  });

  // 统计利空得分
  Object.keys(NEWS_BEAR_KEYWORDS).forEach(function(kw) {
    if (text.indexOf(kw) >= 0) bearScore += NEWS_BEAR_KEYWORDS[kw];
  });

  // 净值判断（阈值2，避免轻微偏向导致误判）
  var netScore = bullScore - bearScore;
  if (netScore >= 2) return 'bull';
  if (netScore <= -2) return 'bear';
  return 'neutral';
}

/**
 * 评估新闻影响力（1-3）— 基于权威来源和关键词强度
 */
function assessNewsImpact(title, desc) {
  var text = (title || '') + (desc || '');

  // 权威来源（3级影响）
  var authorityWords = ['国务院', '央行', '证监会', '财政部', '发改委', '降准', '降息', '万亿', '一揽子', '组合拳'];
  // 重要内容（2级影响）
  var importantWords = ['美联储', '鲍威尔', '美股', '暴跌', '暴涨', '熔断', '退市', '违约', '制裁', '贸易战',
    '注册制', '并购', '重组', '回购', '增持', '减持', '外资', '北向', '净流入', '净流出',
    'LPR', 'MLF', '社融', 'GDP', 'CPI', 'PMI'];
  // 一般内容（1级影响）
  var normalWords = ['A股', '股市', '大盘', '指数', '沪指', '创业板', '港股', '亚太', 'ETF', '基金'];

  if (authorityWords.some(function(kw) { return text.indexOf(kw) >= 0; })) return 3;
  if (importantWords.some(function(kw) { return text.indexOf(kw) >= 0; })) return 2;
  if (normalWords.some(function(kw) { return text.indexOf(kw) >= 0; })) return 1;
  return 1;
}

/**
 * 从东方财富7x24快讯API获取最新市场新闻
 * @param {boolean} forceRefresh - 强制刷新（忽略缓存）
 * @returns {Promise<Array>} 新闻数组
 */
function fetchLatestNews(forceRefresh) {
  // 检查缓存（非强制刷新时）
  if (!forceRefresh) {
    try {
      var cached = localStorage.getItem(NEWS_CACHE_KEY);
      if (cached) {
        var cacheData = JSON.parse(cached);
        if (Date.now() - cacheData.ts < NEWS_CACHE_TTL && cacheData.news && cacheData.news.length > 0) {
          _newsDataSource = '缓存快讯';
          if(__DEBUG__)console.log('[新闻] 命中15分钟缓存:', cacheData.news.length + '条');
          return Promise.resolve(cacheData.news);
        }
      }
    } catch(e) {}
  }

  // 方案1: 东方财富 np-listapi 7x24快讯（JSON格式）
  function tryNewsApi() {
    var ts = Date.now();
    var url = 'https://np-listapi.eastmoney.com/comm/web/getFastNewsList?client=web&biz=stock&fastColumn=102&pageSize=50&pageIndex=1&sortEnd=&endTime=&req_trace=' + ts + '&isDelay=1';

    return fetchWithTimeout(url, { cache: 'no-store' }, 10000)
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(data) {
        if (data && data.data && data.data.fastNewsList && data.data.fastNewsList.length > 0) {
          if(__DEBUG__)console.log('[新闻] np-listapi获取成功:', data.data.fastNewsList.length + '条');
          return data.data.fastNewsList.map(function(item) {
            return {
              title: item.title || '',
              digest: item.summary || '',
              showtime: item.showTime || ''
            };
          });
        }
        throw new Error('np-listapi返回空数据');
      });
  }

  // 方案2: 备用快讯API（腾讯财经）
  function tryWebList() {
    var ts = Date.now();
    // 腾讯财经快讯接口
    var url = 'https://proxy.finance.qq.com/ifzqgtimg/appstock/app/mktNewsList?page=0&pageSize=30&type=0&_=' + ts;
    
    return fetchWithTimeout(url, { cache: 'no-store' }, 8000)
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(data) {
        if (data && data.data && data.data.list && data.data.list.length > 0) {
          if(__DEBUG__)console.log('[新闻] 腾讯快讯获取成功:', data.data.list.length + '条');
          return data.data.list.map(function(item) {
            return {
              title: item.title || item.content || '',
              digest: item.content || item.digest || '',
              showtime: item.time || item.datetime || ''
            };
          });
        }
        throw new Error('腾讯快讯返回空数据');
      })
      .catch(function(err) {
        if(__DEBUG__)console.log('[新闻] 腾讯快讯失败:', err.message);
        // 最后尝试新浪财经
        return trySinaNews();
      });
  }
  
  // 方案3: 新浪财经快讯
  function trySinaNews() {
    var ts = Date.now();
    var url = 'https://zhibo.sina.com.cn/api/zhibo/feed?column=finance&callback=&page=1&page_size=30&type=1&_=' + ts;
    
    return fetchWithTimeout(url, { cache: 'no-store' }, 8000)
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(data) {
        if (data && data.result && data.result.data && data.result.data.feed && data.result.data.feed.list) {
          var items = data.result.data.feed.list;
          if(__DEBUG__)console.log('[新闻] 新浪快讯获取成功:', items.length + '条');
          return items.map(function(item) {
            return {
              title: item.meditTitle || item.title || '',
              digest: item.summary || item.content || '',
              showtime: item.create_time || ''
            };
          });
        }
        throw new Error('新浪快讯返回空数据');
      });
  }

  // 解析快讯数据为标准新闻格式
  function parseNewsList(livesList) {
    var news = [];
    var now = Date.now();
    var maxAge = 3 * 24 * 60 * 60 * 1000; // 只保留3天内的新闻

    livesList.forEach(function(item) {
      var title = (item.title || '').replace(/<[^>]+>/g, '').trim();
      var desc = (item.digest || item.simdigest || '').replace(/<[^>]+>/g, '').trim();
      var showtime = item.showtime || item.ordertime || '';

      if (!title || title.length < 4) return;
      if (!isMarketNews(title, desc)) return;

      // 解析时间
      var newsDate = showtime ? showtime.substring(0, 10) : formatDate(new Date());
      var newsTime = showtime ? showtime.substring(11, 16) : '';
      var newsTimestamp = showtime ? new Date(showtime.replace(/-/g, '/')).getTime() : 0;

      // 过滤过期新闻（3天前）
      if (newsTimestamp && (now - newsTimestamp > maxAge)) return;

      var type = classifyNews(title, desc);
      var impact = assessNewsImpact(title, desc);

      news.push({
        date: newsDate,
        time: newsTime,
        type: type,
        title: title,
        desc: desc.substring(0, 200),
        impact: impact,
        _source: '实时快讯'
      });
    });

    // 按时间倒序排列
    news.sort(function(a, b) {
      return (b.date + ' ' + (b.time || '')).localeCompare(a.date + ' ' + (a.time || ''));
    });

    return news;
  }

  // 链式尝试：np-listapi → 腾讯财经 → 新浪财经
  return tryNewsApi()
    .then(function(livesList) {
      _newsDataSource = '实时快讯';
      return parseNewsList(livesList);
    })
    .catch(function(err) {
      if(__DEBUG__) console.warn('[新闻] np-listapi失败:', err.message, '→ 尝试腾讯财经');
      return tryWebList()
        .then(function(list) {
          _newsDataSource = '腾讯快讯';
          return parseNewsList(list);
        });
    })
    .then(function(news) {
      if (news.length > 0) {
        // 写入缓存
        try {
          localStorage.setItem(NEWS_CACHE_KEY, JSON.stringify({
            ts: Date.now(),
            news: news
          }));
        } catch(e) {}
      }
      return news;
    })
    .catch(function(err) {
      console.warn('[新闻] 所有快讯API失败:', err.message);
      _newsDataSource = '';
      return [];
    });
}

/**
 * 更新新闻数据并重新渲染
 */
function updateNewsData(dynamicNews) {
  if (!dynamicNews || dynamicNews.length === 0) {
    if (NEWS_DATA.length === 0) {
      _newsDataSource = '暂无数据';
    }
    return;
  }

  // 完全替换为实时数据（不再混合静态模拟数据）
  NEWS_DATA = dynamicNews.slice(0, 25); // 限制最多25条
  _naNewsData = NEWS_DATA.slice();
  renderNewsAnalysis();
}

/**
 * 启动新闻自动刷新（15分钟周期）
 */
var _newsRefreshTimer = null;
function startNewsAutoRefresh() {
  stopNewsAutoRefresh();
  _newsRefreshTimer = Perf.setInterval(function() {
    if (document.hidden) return;
    fetchLatestNews(true).then(function(news) {
      // 成功获取数据，清除错误状态
      _naErrorState = null;
      _naLastErrorTime = null;
      updateNewsData(news);
    }).catch(function(err) {
      // 自动刷新失败，设置错误状态但不打断用户
      var errMsg = '网络请求失败';
      if (err && err.message) {
        if (err.message.indexOf('超时') > -1) {
          errMsg = '请求超时，网络连接较慢或数据源不可达';
        } else {
          errMsg = err.message;
        }
      }
      _naErrorState = errMsg;
      _naLastErrorTime = new Date();
      if (__DEBUG__) console.log('[新闻自动刷新] 失败:', errMsg);
    });
  }, NEWS_CACHE_TTL);
  if (__DEBUG__) console.log('[新闻刷新] 已启动，间隔15分钟');
}
function stopNewsAutoRefresh() {
  if (_newsRefreshTimer) {
    Perf.clearInterval(_newsRefreshTimer);
    _newsRefreshTimer = null;
  }
}

 /**
  * 消息面分析主函数 - 实时更新
  * 分析当前市场消息面，判定利好/利空/中性因素
  * 数据来源：东方财富7x24快讯API + 市场数据分析
  */
function renderNewsAnalysis() {
    var container = document.getElementById('naList');
    var overallEl = document.getElementById('nasValue');
    var bullCountEl = document.getElementById('nasBullCount');
    var bearCountEl = document.getElementById('nasBearCount');
    var neutralCountEl = document.getElementById('nasNeutralCount');

    if (!container) return;

    var now = new Date();

    // 获取市场数据用于判断
    _naFactors = analyzeMarketFactors();

    // 更新全局新闻数据
    _naNewsData = NEWS_DATA.slice();

    // 合并新闻数据与分析因素（新闻在前，分析在后）
    var allItems = _naNewsData.concat(_naFactors);

    // 统计因素数量（包含新闻和分析）
    var bullCount = allItems.filter(function(f) { return f.type === 'bull'; }).length;
    var bearCount = allItems.filter(function(f) { return f.type === 'bear'; }).length;
    var neutralCount = allItems.filter(function(f) { return f.type === 'neutral'; }).length;

   // 更新统计
   if (bullCountEl) bullCountEl.textContent = bullCount;
   if (bearCountEl) bearCountEl.textContent = bearCount;
   if (neutralCountEl) neutralCountEl.textContent = neutralCount;

   // 综合判断（加权评分：高影响新闻权重更大）
   var weightedScore = 0;
   allItems.forEach(function(f) {
     var w = f.impact || 1;
     if (f.type === 'bull') weightedScore += w;
     else if (f.type === 'bear') weightedScore -= w;
   });

   var overall = '震荡整理';
   var overallClass = 'neutral';
   if (weightedScore >= 5) {
     overall = '整体偏多';
     overallClass = 'bull';
   } else if (weightedScore >= 2) {
     overall = '略微偏多';
     overallClass = 'bull';
   } else if (weightedScore <= -5) {
     overall = '整体偏空';
     overallClass = 'bear';
   } else if (weightedScore <= -2) {
     overall = '略微偏空';
     overallClass = 'bear';
   }

   if (overallEl) {
     overallEl.textContent = overall;
     overallEl.className = 'nas-value nas-overall-' + overallClass;
   }

   // 更新数据来源标签
   var sourceEl = document.getElementById('naDataSource');
   if (sourceEl) {
     if (_naErrorState && _naNewsData.length === 0) {
       sourceEl.textContent = '⚠️ 加载失败';
       sourceEl.style.color = 'var(--neon-red)';
     } else if (_naErrorState && _naNewsData.length > 0) {
       sourceEl.textContent = '⚠️ 刷新失败·显示缓存';
       sourceEl.style.color = 'var(--neon-yellow)';
     } else {
       sourceEl.textContent = _newsDataSource || (_naNewsData.length > 0 ? '缓存数据' : '加载中...');
       sourceEl.style.color = '';
     }
   }

   // 根据筛选条件过滤所有项目
   var filtered = allItems;
   if (_naFilter !== 'all') {
     filtered = allItems.filter(function(f) { return f.type === _naFilter; });
   }

   // 渲染消息卡片
   var html = '';
   if (filtered.length === 0) {
     if (_naErrorState) {
       // 数据加载失败，显示明确错误提示
       var errTimeStr = _naLastErrorTime ? _naLastErrorTime.toLocaleTimeString('zh-CN') : '';
       html = '<div class="na-error">' +
         '<span class="na-error-icon">⚠️</span>' +
         '<strong>快讯数据加载失败</strong>' +
         '<span class="na-error-detail">' + _naErrorState + (errTimeStr ? '（' + errTimeStr + '）' : '') + '</span>' +
         '<span class="na-error-retry" onclick="refreshNewsAnalysis()">点击重试</span>' +
         '</div>';
     } else if (_naNewsData.length === 0) {
       html = '<div class="na-empty">正在获取实时快讯...</div>';
     } else {
       html = '<div class="na-empty">暂无相关因素</div>';
     }
   } else {
     filtered.forEach(function(factor) {
       var tagClass = {
         'bull': 'bull',
         'bear': 'bear',
         'neutral': 'neutral'
       };
       var tagText = {
         'bull': '利好',
         'bear': '利空',
         'neutral': '中性'
       };

       // 影响力圆点
       var dotsHtml = '';
       for (var d = 0; d < 3; d++) {
         dotsHtml += '<span class="na-impact-dot' + (d < (factor.impact || 1) ? ' on' : '') + '"></span>';
       }

       // 格式化时间
       var timeStr = factor.time || '';
       if (!timeStr && factor.date) {
         timeStr = factor.date.substring(5); // MM-DD
       }
       if (!timeStr) {
         timeStr = now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0');
       }

       // 数据来源标签（实时数据用高亮样式）
       var isRealtime = factor._source && (factor._source.indexOf('实时') >= 0 || factor._source.indexOf('快讯') >= 0);
       var sourceCls = isRealtime ? 'na-source-tag realtime' : 'na-source-tag';
       var sourceLabel = factor._source ? '<span class="' + sourceCls + '">' + escHTML(factor._source) + '</span>' : '<span class="na-source-tag">市场分析</span>';

       // XSS防护：转义标题和描述
       var safeTitle = escHTML(factor.title || '');
       var safeDesc = escHTML(factor.desc || '');

       html += '<div class="na-card na-' + factor.type + '">' +
         '<div class="na-card-row">' +
           '<span class="na-tag ' + tagClass[factor.type] + '">' + tagText[factor.type] + '</span>' +
           '<span class="na-card-title">' + safeTitle + '</span>' +
           '<span class="na-impact">' + dotsHtml + '</span>' +
           '<span class="na-card-time">' + escHTML(timeStr) + '</span>' +
         '</div>' +
         '<div class="na-card-desc">' + safeDesc + '</div>' +
         '<div class="na-card-footer">' + sourceLabel + '</div>' +
       '</div>';
     });
   }

   container.innerHTML = html;

   // 绑定筛选按钮事件
   bindNaFilters();
 }

/**
 * 绑定消息面分析筛选按钮
 */
function bindNaFilters() {
  var filters = document.querySelectorAll('.na-filter');
  filters.forEach(function(btn) {
    // 移除旧事件，避免重复绑定
    var newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.addEventListener('click', function() {
      var filter = newBtn.getAttribute('data-na-filter');
      _naFilter = filter;
      
      // 更新按钮状态
      document.querySelectorAll('.na-filter').forEach(function(b) {
        b.classList.remove('active');
      });
      newBtn.classList.add('active');
      
      // 重新渲染卡片
      var container = document.getElementById('naList');
      if (!container) return;
      
      // 合并新闻数据与分析因素
      var allItems = (_naNewsData || []).concat(_naFactors || []);
      var filtered = allItems;
      if (_naFilter !== 'all') {
        filtered = allItems.filter(function(f) { return f.type === _naFilter; });
      }
      
      var html = '';
      if (filtered.length === 0) {
        html = '<div class="na-empty">暂无相关因素</div>';
      } else {
        var now = new Date();
        filtered.forEach(function(factor) {
          var tagClass = {
            'bull': 'bull',
            'bear': 'bear',
            'neutral': 'neutral'
          };
          var tagText = {
            'bull': '利好',
            'bear': '利空',
            'neutral': '中性'
          };
          
          var dotsHtml = '';
          for (var d = 0; d < 3; d++) {
            dotsHtml += '<span class="na-impact-dot' + (d < (factor.impact || 1) ? ' on' : '') + '"></span>';
          }
          
          var timeStr = factor.time || (now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0'));
          
          var isRealtime2 = factor._source && (factor._source.indexOf('实时') >= 0 || factor._source.indexOf('快讯') >= 0);
          var sourceCls2 = isRealtime2 ? 'na-source-tag realtime' : 'na-source-tag';
          var sourceLabel2 = factor._source ? '<span class="' + sourceCls2 + '">' + escHTML(factor._source) + '</span>' : '<span class="na-source-tag">市场分析</span>';
          
          html += '<div class="na-card na-' + factor.type + '">' +
            '<div class="na-card-row">' +
              '<span class="na-tag ' + tagClass[factor.type] + '">' + tagText[factor.type] + '</span>' +
              '<span class="na-card-title">' + escHTML(factor.title || '') + '</span>' +
              '<span class="na-impact">' + dotsHtml + '</span>' +
              '<span class="na-card-time">' + escHTML(timeStr) + '</span>' +
            '</div>' +
            '<div class="na-card-desc">' + escHTML(factor.desc || '') + '</div>' +
            '<div class="na-card-footer">' + sourceLabel2 + '</div>' +
          '</div>';
        });
      }
      container.innerHTML = html;
    });
  });
}

/**
 * 分析市场因素 - 基于当前数据和宏观经济判断
 * @returns {Array} 因素列表
 */
function analyzeMarketFactors() {
  var factors = [];
  var now = new Date();
  var hour = now.getHours();
  var day = now.getDay();
  var isWeekend = (day === 0 || day === 6);
  
  // 交易时段判断
  if (isWeekend) {
    factors.push({
      type: 'neutral',
      title: '周末休市',
      desc: 'A股、港股休市，下周一正常开市',
      impact: 1,
      _source: '市场日历'
    });
  } else if (hour >= 9 && hour < 12) {
    factors.push({
      type: 'neutral',
      title: '早盘交易中',
      desc: '沪深两市早盘时段，盘中波动正常',
      impact: 1,
      _source: '市场日历'
    });
  } else if (hour >= 13 && hour < 15) {
    factors.push({
      type: 'neutral',
      title: '午盘进行中',
      desc: '沪深两市午盘时段，关注尾盘动向',
      impact: 1,
      _source: '市场日历'
    });
  } else if (hour >= 15) {
    factors.push({
      type: 'neutral',
      title: '收盘完成',
      desc: '今日交易已结束，明日继续',
      impact: 1,
      _source: '市场日历'
    });
  } else {
    factors.push({
      type: 'neutral',
      title: '盘前观察',
      desc: '开盘前准备阶段',
      impact: 1,
      _source: '市场日历'
    });
  }
  
  // 2. 获取格雷厄姆指数判断（阈值与仪表盘一致）
  var grahamScore = getGrahamScore();
  if (grahamScore >= 4.5) {
    factors.push({
      type: 'bull',
      title: '估值黄金底',
      desc: '格雷厄姆指数 ' + grahamScore.toFixed(2) + '，历史极端低位，性价比极高',
      impact: 3,
      _source: '估值分析'
    });
  } else if (grahamScore >= 3.5) {
    factors.push({
      type: 'bull',
      title: '估值偏低',
      desc: '格雷厄姆指数 ' + grahamScore.toFixed(2) + '，具备投资价值',
      impact: 2,
      _source: '估值分析'
    });
  } else if (grahamScore >= 2.5) {
    factors.push({
      type: 'neutral',
      title: '估值适中',
      desc: '格雷厄姆指数 ' + grahamScore.toFixed(2) + '，市场估值处于合理区间',
      impact: 1,
      _source: '估值分析'
    });
  } else {
    factors.push({
      type: 'bear',
      title: '估值偏高',
      desc: '格雷厄姆指数 ' + grahamScore.toFixed(2) + '，市场估值偏高，注意风险',
      impact: 2,
      _source: '估值分析'
    });
  }
  
  // 3. 国债收益率影响
  var treasuryYield = TREASURY_10Y || 1.72;
  if (treasuryYield < 2.0) {
    factors.push({
      type: 'bull',
      title: '无风险利率低位',
      desc: '10年期国债收益率 ' + treasuryYield.toFixed(4) + '%，资金成本低，利于股市',
      _source: '估值分析'
    });
  } else if (treasuryYield > 3.5) {
    factors.push({
      type: 'bear',
      title: '无风险利率偏高',
      desc: '10年期国债收益率 ' + treasuryYield.toFixed(4) + '%，资金回流债市压力大',
      _source: '估值分析'
    });
  } else {
    factors.push({
      type: 'neutral',
      title: '利率环境平稳',
      desc: '10年期国债收益率 ' + treasuryYield.toFixed(4) + '%，利率环境整体平稳',
      _source: '估值分析'
    });
  }
  
  // 4. 股债利差判断（校准：低利率环境下利差天然偏大）
  // getGrahamScore() 返回 盈利收益率/国债收益率 的比值
  // 股债利差(百分点) = 盈利收益率 - 国债收益率 = 国债收益率 × (格雷厄姆指数 - 1)
  var spread = treasuryYield * (grahamScore - 1);
  if (spread > 5) {
    factors.push({
      type: 'bull',
      title: '股债利差极大',
      desc: '当前利差 ' + spread.toFixed(2) + '%，股票相对债券吸引力极强',
      impact: 2,
      _source: '估值分析'
    });
  } else if (spread > 3) {
    factors.push({
      type: 'bull',
      title: '股债利差偏大',
      desc: '当前利差 ' + spread.toFixed(2) + '%，股票相对债券有吸引力',
      impact: 1,
      _source: '估值分析'
    });
  } else if (spread < 1.5) {
    factors.push({
      type: 'bear',
      title: '股债利差收窄',
      desc: '当前利差 ' + spread.toFixed(2) + '%，股票相对债券吸引力减弱',
      impact: 1,
      _source: '估值分析'
    });
  }
  
  // 5. 流动性判断（基于市场情绪数据）
  var sentiment = _lastSentimentData || {};
  var northFlow = sentiment.northFlow || 0;
  if (northFlow > 50) {
    factors.push({
      type: 'bull',
      title: '北向资金净流入',
      desc: '北向资金净流入约 ' + Math.abs(northFlow).toFixed(0) + '亿，外资持续买入',
      _source: '实时资金'
    });
  } else if (northFlow < -50) {
    factors.push({
      type: 'bear',
      title: '北向资金净流出',
      desc: '北向资金净流出约 ' + Math.abs(northFlow).toFixed(0) + '亿，外资短期撤离',
      _source: '实时资金'
    });
  }
  
  // 5b. 主力资金流向（实时板块资金流数据）
  if (typeof _lastSectorFlowData !== 'undefined' && _lastSectorFlowData) {
    var sf = _lastSectorFlowData;
    var totalMain = sf.totalMain || 0;
    var inflowCount = sf.inflow ? sf.inflow.length : 0;
    var outflowCount = sf.outflow ? sf.outflow.length : 0;
    if (totalMain > 0 && inflowCount > outflowCount) {
      var topInflow = sf.inflow && sf.inflow[0] ? sf.inflow[0].name : '';
      factors.push({
        type: 'bull',
        title: '主力资金净流入',
        desc: '今日板块主力净流入，' + inflowCount + '个板块流入' + (topInflow ? '，领涨：' + topInflow : ''),
        _source: '实时资金'
      });
    } else if (totalMain < 0 && outflowCount > 0) {
      var topOutflow = sf.outflow && sf.outflow[0] ? sf.outflow[0].name : '';
      factors.push({
        type: 'bear',
        title: '主力资金净流出',
        desc: '今日板块主力净流出，' + outflowCount + '个板块流出' + (topOutflow ? '，领跌：' + topOutflow : ''),
        _source: '实时资金'
      });
    }
  }
  
  // 5c. 实时大盘表现（基于实时行情数据）
  if (typeof _lastRealtimeData !== 'undefined' && _lastRealtimeData) {
    var rt300 = _lastRealtimeData['sh000300'];
    var rtChiNext = _lastRealtimeData['sz399006'];
    if (rt300 && rt300.changePercent !== undefined) {
      var chg300 = rt300.changePercent;
      if (chg300 > 1.5) {
        factors.push({
          type: 'bull',
          title: '沪深300大幅上涨',
          desc: '沪深300涨' + chg300.toFixed(2) + '%，大盘强势上攻',
          _source: '实时行情'
        });
      } else if (chg300 > 0.5) {
        factors.push({
          type: 'bull',
          title: '沪深300上涨',
          desc: '沪深300涨' + chg300.toFixed(2) + '%，市场表现偏强',
          _source: '实时行情'
        });
      } else if (chg300 < -1.5) {
        factors.push({
          type: 'bear',
          title: '沪深300大幅下跌',
          desc: '沪深300跌' + Math.abs(chg300).toFixed(2) + '%，大盘承压明显',
          _source: '实时行情'
        });
      } else if (chg300 < -0.5) {
        factors.push({
          type: 'bear',
          title: '沪深300下跌',
          desc: '沪深300跌' + Math.abs(chg300).toFixed(2) + '%，市场表现偏弱',
          _source: '实时行情'
        });
      }
    }
    // 创业板表现
    if (rtChiNext && rtChiNext.changePercent !== undefined) {
      var chgCN = rtChiNext.changePercent;
      if (chgCN > 2) {
        factors.push({
          type: 'bull',
          title: '创业板大涨',
          desc: '创业板涨' + chgCN.toFixed(2) + '%，成长股活跃',
          _source: '实时行情'
        });
      } else if (chgCN < -2) {
        factors.push({
          type: 'bear',
          title: '创业板大跌',
          desc: '创业板跌' + Math.abs(chgCN).toFixed(2) + '%，成长股承压',
          _source: '实时行情'
        });
      }
    }
  }
  
  // 5d. 涨跌家数（市场广度）
  if (sentiment.up && sentiment.down) {
    var totalStocks = sentiment.up + sentiment.down;
    var upRatio = totalStocks > 0 ? sentiment.up / totalStocks * 100 : 50;
    if (upRatio > 75) {
      factors.push({
        type: 'bull',
        title: '普涨行情',
        desc: '上涨' + sentiment.up + '家，下跌' + sentiment.down + '家，涨跌比' + (sentiment.up / Math.max(1, sentiment.down)).toFixed(1) + ':1',
        _source: '实时行情'
      });
    } else if (upRatio < 25) {
      factors.push({
        type: 'bear',
        title: '普跌行情',
        desc: '上涨' + sentiment.up + '家，下跌' + sentiment.down + '家，跌涨比' + (sentiment.down / Math.max(1, sentiment.up)).toFixed(1) + ':1',
        _source: '实时行情'
      });
    }
  }
  
  // 6. 市场情绪判断
  var fearIndex = sentiment.score || sentiment.fearIndex || 50;
  if (fearIndex < 30) {
    factors.push({
      type: 'bull',
      title: '市场情绪贪婪',
      desc: '恐慌指数 ' + fearIndex.toFixed(0) + '，市场情绪偏乐观',
      _source: '情绪指标'
    });
  } else if (fearIndex > 70) {
    factors.push({
      type: 'bear',
      title: '市场情绪恐慌',
      desc: '恐慌指数 ' + fearIndex.toFixed(0) + '，市场情绪偏谨慎',
      _source: '情绪指标'
    });
  }
  
  // 7. 政策环境（季节性参考）
  var month = now.getMonth() + 1;
  if (month >= 3 && month <= 4) {
    factors.push({
      type: 'neutral',
      title: '两会效应',
      desc: '政策预期升温，市场关注政策导向',
      _source: '季节规律'
    });
  } else if (month === 12) {
    factors.push({
      type: 'neutral',
      title: '年底效应',
      desc: '机构调仓换股，市场波动加大',
      _source: '季节规律'
    });
  } else if (month === 1) {
    factors.push({
      type: 'neutral',
      title: '年初布局期',
      desc: '新年行情预期，资金面相对宽松',
      _source: '季节规律'
    });
  }
  
  return factors;
}

/**
 * 获取格雷厄姆指数（简化版）
 */
function getGrahamScore() {
  var hs300 = BASE_DATA.indices.filter(function(i) { return i.code === 'sh000300'; })[0];
  var pe = hs300 ? hs300.pe : 14.3;
  // 优先使用实时行情数据
  if (typeof _lastRealtimeData !== 'undefined' && _lastRealtimeData && _lastRealtimeData['sh000300']) {
    var rt300 = _lastRealtimeData['sh000300'];
    if (rt300.pe && rt300.pe > 0 && rt300.pe < 100) pe = rt300.pe;
  }
  var treasuryYield = TREASURY_10Y || 1.72;
  var earningsYield = 100 / pe;        // 百分比形式，如 6.99%
  return earningsYield / treasuryYield; // 格雷厄姆指数比值，如 6.99/1.72 ≈ 4.06
}

/**
 * 刷新消息面分析 — 强制获取最新实时快讯
 */
function refreshNewsAnalysis() {
  var btn = document.querySelector('.na-refresh-btn');
  var listEl = document.getElementById('naList');

  if (btn) {
    btn.classList.add('spinning');
    btn.textContent = '⏳';
  }

  if (listEl) {
    listEl.innerHTML = '<div class="na-loading">📡 正在获取实时快讯...</div>';
  }

  // 强制刷新：忽略缓存，直接请求API
  fetchLatestNews(true).then(function(news) {
    // 成功获取数据，清除错误状态
    _naErrorState = null;
    _naLastErrorTime = null;
    
    if (news && news.length > 0) {
      updateNewsData(news);
    } else {
      // API返回空数据
      if (_naNewsData.length === 0) {
        _naErrorState = 'API返回空数据，可能是数据源暂时不可用';
        _naLastErrorTime = new Date();
      }
      renderNewsAnalysis();
    }
    if (btn) {
      btn.classList.remove('spinning');
      btn.textContent = '🔄';
    }
  }).catch(function(err) {
    // 数据加载失败，设置错误状态并显示明确错误提示
    var errMsg = '网络请求失败';
    if (err && err.message) {
      if (err.message.indexOf('超时') > -1) {
        errMsg = '请求超时（8秒），网络连接较慢或数据源不可达';
      } else if (err.message.indexOf('JSONP') > -1 || err.message.indexOf('回调') > -1) {
        errMsg = 'JSONP回调失败，数据源格式可能已变更';
      } else {
        errMsg = err.message;
      }
    }
    _naErrorState = errMsg;
    _naLastErrorTime = new Date();
    
    // 更新数据来源标签
    var sourceEl = document.getElementById('naDataSource');
    if (sourceEl) {
      sourceEl.textContent = '⚠️ 加载失败';
      sourceEl.style.color = 'var(--neon-red)';
    }
    
    // 渲染错误提示（如果有缓存数据则同时显示缓存数据）
    renderNewsAnalysis();
    
    if (btn) {
      btn.classList.remove('spinning');
      btn.textContent = '🔄';
    }
  });
}

