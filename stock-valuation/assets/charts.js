// assets/charts.js
(function() {
  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim();
  var accent2 = style.getPropertyValue('--accent2').trim();
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var rule = style.getPropertyValue('--rule').trim();
  var bg2 = style.getPropertyValue('--bg2').trim();
  var bg3 = style.getPropertyValue('--bg3').trim();
  var green = style.getPropertyValue('--green').trim();
  var yellow = style.getPropertyValue('--yellow').trim();
  var red = style.getPropertyValue('--red').trim();
  var purple = style.getPropertyValue('--purple').trim();

  // ===================== DATA =====================
  var indices = [
    { name: '上证指数', pe: 16.1, pb: 1.44, dy: 2.85, p5: 55, p10: 40 },
    { name: '深证成指', pe: 29.6, pb: 3.01, dy: 1.48, p5: 75, p10: 62 },
    { name: '创业板指', pe: 48.0, pb: 6.80, dy: 0.88, p5: 52, p10: 62 },
    { name: '沪深300', pe: 14.3, pb: 1.45, dy: 2.48, p5: 58, p10: 37 },
    { name: '中证500', pe: 40.0, pb: 2.70, dy: 1.06, p5: 78, p10: 89 }
  ];

  var sectors = [
    { name: '银行',     pe: 6.55,  pb: 0.55, roe: 8.4,  p10: 25, signal: '低估' },
    { name: '房地产',   pe: 10.37, pb: 0.81, roe: 7.8,  p10: 6,  signal: '极度低估' },
    { name: '食品饮料', pe: 18.63, pb: 3.05, roe: 16.4, p10: 5,  signal: '极度低估' },
    { name: '白酒',     pe: 19.11, pb: 3.79, roe: 11.3, p10: 10, signal: '低估' },
    { name: '医药生物', pe: 29.22, pb: 2.76, roe: 9.4,  p10: 20, signal: '低估' },
    { name: '新能源',   pe: 32.06, pb: 3.39, roe: 10.6, p10: 55, signal: '适中' },
    { name: '国防军工', pe: 58.36, pb: 3.74, roe: 6.4,  p10: 58, signal: '适中' },
    { name: '通信',     pe: 30.94, pb: 3.00, roe: 9.7,  p10: 85, signal: '高估' },
    { name: '半导体芯片', pe: 71.93, pb: 7.87, roe: 10.9, p10: 99, signal: '极度高估' }
  ];

  // ===================== HELPERS =====================
  function getColorByPct(pct) {
    if (pct < 20) return green;
    if (pct < 40) return '#7ee787';
    if (pct < 60) return yellow;
    if (pct < 80) return accent2;
    return red;
  }

  function getSignalClass(signal) {
    if (signal === '极度低估' || signal === '低估') return 'under';
    if (signal === '适中') return 'mid';
    if (signal === '高估') return 'over';
    return 'extreme';
  }

  function getRankClass(pct) {
    if (pct < 30) return 'low';
    if (pct < 70) return 'mid';
    return 'high';
  }

  // ===================== RENDER INDEX LIST =====================
  var listEl = document.getElementById('index-list');
  if (listEl) {
    var html = '';
    indices.forEach(function(idx) {
      var color = getColorByPct(idx.p10);
      html += '<div class="index-item">' +
        '<div class="rank ' + getRankClass(idx.p10) + '">' + idx.p10 + '%</div>' +
        '<div class="info">' +
          '<div class="name">' + idx.name + '</div>' +
          '<div class="metrics">' +
            '<span class="metric">PE <b>' + idx.pe + '</b></span>' +
            '<span class="metric">PB <b>' + idx.pb + '</b></span>' +
            '<span class="metric">股息 <b>' + idx.dy + '%</b></span>' +
          '</div>' +
        '</div>' +
        '<div class="pct-bar-wrap">' +
          '<div class="pct-bar-label" style="color:' + color + '">10年 ' + idx.p10 + '%</div>' +
          '<div class="pct-bar-bg"><div class="pct-bar-fill" style="width:' + idx.p10 + '%;background:' + color + '"></div></div>' +
        '</div>' +
      '</div>';
    });
    listEl.innerHTML = html;
  }

  // ===================== RENDER SECTOR TABLE =====================
  var tbodyEl = document.getElementById('sector-tbody');
  if (tbodyEl) {
    var shtml = '';
    sectors.forEach(function(s) {
      var cls = getSignalClass(s.signal);
      var pColor = getColorByPct(s.p10);
      shtml += '<tr>' +
        '<td>' + s.name + '</td>' +
        '<td><b>' + s.pe.toFixed(2) + '</b></td>' +
        '<td><b>' + s.pb.toFixed(2) + '</b></td>' +
        '<td><b>' + s.roe.toFixed(1) + '%</b></td>' +
        '<td style="color:' + pColor + '"><b>' + s.p10 + '%</b></td>' +
        '<td><span class="signal ' + cls + '">' + s.signal + '</span></td>' +
      '</tr>';
    });
    tbodyEl.innerHTML = shtml;
  }

  // ===================== CHART 1: PE/PB BAR =====================
  var chartPEPB = echarts.init(document.getElementById('chart-pe-pb'), null, { renderer: 'svg' });
  chartPEPB.setOption({
    animation: false,
    tooltip: { trigger: 'axis', appendToBody: true, backgroundColor: bg2, borderColor: rule, textStyle: { color: ink, fontSize: 12 } },
    legend: { top: 0, textStyle: { color: muted, fontSize: 11 }, itemWidth: 14, itemHeight: 8 },
    grid: { left: 45, right: 45, top: 32, bottom: 28 },
    xAxis: {
      type: 'category',
      data: indices.map(function(i) { return i.name; }),
      axisLine: { lineStyle: { color: rule } },
      axisLabel: { color: muted, fontSize: 10, rotate: 20 },
      axisTick: { show: false }
    },
    yAxis: [
      {
        type: 'value', name: 'PE', nameTextStyle: { color: muted, fontSize: 10 },
        axisLine: { show: false }, axisTick: { show: false },
        splitLine: { lineStyle: { color: rule, type: 'dashed' } },
        axisLabel: { color: muted, fontSize: 10 }
      },
      {
        type: 'value', name: 'PB', nameTextStyle: { color: muted, fontSize: 10 },
        axisLine: { show: false }, axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { color: muted, fontSize: 10 }
      }
    ],
    series: [
      {
        name: 'PE(TTM)',
        type: 'bar',
        data: indices.map(function(i) { return i.pe; }),
        itemStyle: { color: accent, borderRadius: [3, 3, 0, 0] },
        barMaxWidth: 24
      },
      {
        name: 'PB',
        type: 'bar',
        yAxisIndex: 1,
        data: indices.map(function(i) { return i.pb; }),
        itemStyle: { color: purple, borderRadius: [3, 3, 0, 0] },
        barMaxWidth: 24
      }
    ]
  });
  window.addEventListener('resize', function() { chartPEPB.resize(); });

  // ===================== CHART 2: SECTOR SCATTER =====================
  var chartScatter = echarts.init(document.getElementById('chart-sector-scatter'), null, { renderer: 'svg' });
  var scatterData = sectors.map(function(s) {
    var clr;
    if (s.signal === '极度低估' || s.signal === '低估') clr = green;
    else if (s.signal === '适中') clr = yellow;
    else clr = red;
    return {
      name: s.name,
      value: [s.pe, s.pb, s.roe, s.p10],
      symbolSize: Math.max(s.roe * 2.5, 12),
      itemStyle: { color: clr, opacity: 0.8 }
    };
  });
  chartScatter.setOption({
    animation: false,
    tooltip: {
      appendToBody: true,
      backgroundColor: bg2, borderColor: rule, textStyle: { color: ink, fontSize: 12 },
      formatter: function(p) {
        return '<b>' + p.name + '</b><br/>' +
          'PE: ' + p.value[0].toFixed(2) + '<br/>' +
          'PB: ' + p.value[1].toFixed(2) + '<br/>' +
          'ROE: ' + p.value[2].toFixed(1) + '%<br/>' +
          '10年分位: ' + p.value[3] + '%';
      }
    },
    grid: { left: 48, right: 16, top: 16, bottom: 36 },
    xAxis: {
      type: 'log', name: 'PE', nameTextStyle: { color: muted, fontSize: 10 },
      axisLine: { lineStyle: { color: rule } },
      axisLabel: { color: muted, fontSize: 10, formatter: function(v) { return v; } },
      splitLine: { lineStyle: { color: rule, type: 'dashed' } }
    },
    yAxis: {
      type: 'value', name: 'PB', nameTextStyle: { color: muted, fontSize: 10 },
      axisLine: { lineStyle: { color: rule } },
      axisLabel: { color: muted, fontSize: 10 },
      splitLine: { lineStyle: { color: rule, type: 'dashed' } }
    },
    series: [{
      type: 'scatter',
      data: scatterData,
      label: {
        show: true,
        formatter: function(p) { return p.name; },
        position: 'right',
        color: ink,
        fontSize: 10
      }
    }]
  });
  window.addEventListener('resize', function() { chartScatter.resize(); });

  // ===================== CHART 3: PERCENTILE BAR =====================
  var chartPct = echarts.init(document.getElementById('chart-percentile'), null, { renderer: 'svg' });
  var allPctData = indices.map(function(i) {
    return { name: i.name, p10: i.p10 };
  }).concat(sectors.map(function(s) {
    return { name: s.name, p10: s.p10 };
  }));
  allPctData.sort(function(a, b) { return a.p10 - b.p10; });

  chartPct.setOption({
    animation: false,
    tooltip: {
      appendToBody: true,
      backgroundColor: bg2, borderColor: rule, textStyle: { color: ink, fontSize: 12 },
      formatter: function(p) { return '<b>' + p.name + '</b><br/>近10年分位: ' + p.value + '%'; }
    },
    grid: { left: 72, right: 36, top: 8, bottom: 12 },
    xAxis: {
      type: 'value', max: 100,
      axisLine: { show: false }, axisTick: { show: false },
      splitLine: { lineStyle: { color: rule, type: 'dashed' } },
      axisLabel: { color: muted, fontSize: 10, formatter: '{value}%' }
    },
    yAxis: {
      type: 'category',
      data: allPctData.map(function(d) { return d.name; }),
      axisLine: { lineStyle: { color: rule } },
      axisLabel: { color: ink, fontSize: 10 },
      axisTick: { show: false }
    },
    series: [{
      type: 'bar',
      data: allPctData.map(function(d) {
        return {
          value: d.p10,
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
              { offset: 0, color: getColorByPct(Math.max(d.p10 - 15, 0)) },
              { offset: 1, color: getColorByPct(d.p10) }
            ]),
            borderRadius: [0, 3, 3, 0]
          }
        };
      }),
      barMaxWidth: 14,
      label: {
        show: true,
        position: 'right',
        formatter: function(p) { return p.value + '%'; },
        color: ink,
        fontSize: 10,
        fontFamily: 'GeistMono, Menlo, monospace'
      }
    }]
  });
  window.addEventListener('resize', function() { chartPct.resize(); });

  // ===================== CHART 4: RADAR =====================
  var chartRadar = echarts.init(document.getElementById('chart-radar'), null, { renderer: 'svg' });

  // Normalize indices for radar
  var allPE = indices.map(function(i) { return i.pe; });
  var maxPE = Math.max.apply(null, allPE);
  var allPB = indices.map(function(i) { return i.pb; });
  var maxPB = Math.max.apply(null, allPB);
  var allDY = indices.map(function(i) { return i.dy; });
  var maxDY = Math.max.apply(null, allDY);

  var radarColors = [accent, accent2, green, yellow, purple];
  var radarSeries = indices.map(function(idx, i) {
    return {
      value: [
        (idx.pe / maxPE * 100).toFixed(0),
        (idx.pb / maxPB * 100).toFixed(0),
        (idx.dy / maxDY * 100).toFixed(0),
        (100 - idx.p10).toFixed(0),
        ((maxPE - idx.pe) / maxPE * 100).toFixed(0)
      ],
      name: idx.name,
      lineStyle: { color: radarColors[i], width: 1.5 },
      areaStyle: { color: radarColors[i], opacity: 0.08 },
      itemStyle: { color: radarColors[i] },
      symbol: 'circle',
      symbolSize: 4
    };
  });

  chartRadar.setOption({
    animation: false,
    tooltip: {
      appendToBody: true,
      backgroundColor: bg2, borderColor: rule, textStyle: { color: ink, fontSize: 12 }
    },
    legend: {
      bottom: 0, textStyle: { color: muted, fontSize: 10 },
      itemWidth: 12, itemHeight: 8, itemGap: 10
    },
    radar: {
      indicator: [
        { name: 'PE水平', max: 100 },
        { name: 'PB水平', max: 100 },
        { name: '股息率', max: 100 },
        { name: '安全边际', max: 100 },
        { name: '性价比', max: 100 }
      ],
      center: ['50%', '48%'],
      radius: '60%',
      nameGap: 6,
      name: { textStyle: { color: muted, fontSize: 10 } },
      splitArea: { areaStyle: { color: ['transparent', 'rgba(255,255,255,0.02)'] } },
      axisLine: { lineStyle: { color: rule } },
      splitLine: { lineStyle: { color: rule, type: 'dashed' } }
    },
    series: [{
      type: 'radar',
      data: radarSeries
    }]
  });
  window.addEventListener('resize', function() { chartRadar.resize(); });

})();
