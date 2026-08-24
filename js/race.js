/* ============================================================
 * 赛马场 RaceTrack v1.0 —— 策略赛马模拟器
 * ------------------------------------------------------------
 * 本金 A + 定投 B，随时间推移获得收益 C。
 * 从市场池（ETF + 场外基金 + 个股）中回测挑选收益最好的标的，
 * 短期有短跑组（60交易日），长期有长跑组（250交易日）。
 *
 * 数据源：
 *  - ETF/个股：复用 rotation.js 的 fetchKline（腾讯ifzq→web.ifzq→东财，含缓存）
 *  - 场外基金：东方财富 pingzhongdata 净值历史（loadScript）
 *
 * 赛制：
 *  - 每位选手按「期初买入本金A + 每10个交易日定投B」模拟
 *  - 收益率 = 期末市值C ÷ 总投入；另附区间动量分（近20日涨幅）
 *  - 两组独立排名，冠军登顶 🏆
 * ============================================================ */

var RaceTrack = (function() {
  'use strict';

  /* ---------- 选手池 ---------- */
  // ETF / 个股：腾讯代码（走 fetchKline）
  var HORSES_MARKET = [
    { code: 'sh510300', name: '沪深300ETF',  type: 'etf' },
    { code: 'sh510500', name: '中证500ETF',  type: 'etf' },
    { code: 'sz159915', name: '创业板ETF',   type: 'etf' },
    { code: 'sh588000', name: '科创50ETF',   type: 'etf' },
    { code: 'sh512480', name: '半导体ETF',   type: 'etf' },
    { code: 'sh515030', name: '新能源车ETF', type: 'etf' },
    { code: 'sh512690', name: '酒ETF',       type: 'etf' },
    { code: 'sh518880', name: '黄金ETF',     type: 'etf' },
    { code: 'sh513050', name: '中概互联ETF', type: 'etf' },
    { code: 'sz159928', name: '消费ETF',     type: 'etf' },
    { code: 'sh512010', name: '医药ETF',     type: 'etf' },
    { code: 'sh600519', name: '贵州茅台',    type: 'stock' },
    { code: 'sz300750', name: '宁德时代',    type: 'stock' },
    { code: 'sh601318', name: '中国平安',    type: 'stock' },
    /* —— 美股选手（腾讯 us 前缀，走同一 K线管道）—— */
    { code: 'usQQQ',  name: '纳指100ETF',   type: 'etf', tag: '美' },
    { code: 'usSPY',  name: '标普500ETF',   type: 'etf', tag: '美' },
    { code: 'usDIA',  name: '道琼斯ETF',    type: 'etf', tag: '美' },
    { code: 'usAAPL', name: '苹果',         type: 'stock', tag: '美' },
    { code: 'usNVDA', name: '英伟达',       type: 'stock', tag: '美' }
  ];
  // 场外基金：东财基金代码（走净值历史）
  var HORSES_FUND = [
    { code: '161725', name: '招商中证白酒', type: 'fund' },
    { code: '005827', name: '易方达蓝筹',   type: 'fund' },
    { code: '320007', name: '诺安成长',     type: 'fund' },
    { code: '110011', name: '易方达优质精选', type: 'fund' }
  ];

  var _running = false;

  /* ---------- 工具 ---------- */
  function _fmtPct(v) {
    if (v === null || isNaN(v)) return '—';
    return (v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%';
  }
  function _cls(v) {
    if (v === null || isNaN(v)) return '';
    return v > 0 ? 't-red' : (v < 0 ? 't-green' : '');
  }

  /* ---------- 基金净值历史加载 ---------- */
  var _scriptSeq = 0;
  function _loadScript(url, timeout) {
    return new Promise(function(resolve, reject) {
      var s = document.createElement('script');
      var done = false;
      var timer = setTimeout(function() {
        if (done) return; done = true;
        s.remove(); reject(new Error('超时'));
      }, timeout || 10000);
      s.onload = function() {
        if (done) return; done = true;
        clearTimeout(timer); s.remove(); resolve();
      };
      s.onerror = function() {
        if (done) return; done = true;
        clearTimeout(timer); s.remove(); reject(new Error('加载失败'));
      };
      s.src = url + '?v=' + Date.now() + '_' + (_scriptSeq++);
      document.head.appendChild(s);
    });
  }
  // 返回 [{date:Date, nav:number}]（按时间升序）
  function fetchFundNav(fundCode, days) {
    var key = '_rt_fund_' + fundCode;
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem(key) || 'null'); } catch(e) {}
    if (cached && Date.now() - cached.ts < 12 * 3600e3) {
      return Promise.resolve(closedTrim(cached.data, days));
    }
    return _loadScript('https://fund.eastmoney.com/js/' + fundCode + '.js').then(function() {
      var trend = (window.Data_netWorthTrend || []).map(function(p) {
        return [p.x, p.y];
      }).filter(function(p) { return p[1] > 0; });
      if (trend.length < 30) throw new Error('净值数据不足');
      var data = trend.map(function(p) { return { t: p[0], c: p[1] }; });
      try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data: data })); } catch(e) {}
      return closedTrim(data, days);
    });
  }
  // 取最后 days 个自然日的序列 → 统一为 {t,c} 数组
  function closedTrim(series, days) {
    if (!days || series.length <= days) return series.slice();
    return series.slice(-days);
  }

  /* ---------- 统一序列获取：返回升序收盘价数组 ---------- */
  function fetchSeries(horse, barCount) {
    if (horse.type === 'fund') {
      // 基金按自然日取（约 barCount*1.45 个自然日 ≈ 对应交易日数）
      var calDays = Math.ceil(barCount * 1.5) + 20;
      return fetchFundNav(horse.code, calDays).then(function(arr) {
        return arr.map(function(p) { return p.c; });
      });
    }
    return fetchKline(horse.code, barCount + 30).then(function(k) {
      if (!k || !k.closes || k.closes.length < 20) throw new Error('K线不足');
      return k.closes.slice(-(barCount + 25));
    });
  }

  /* ---------- 核心回测：A + 每个交易日定投 B ---------- */
  function backtest(closes, principal, investPer) {
    var n = closes.length;
    if (n < 10) return null;
    var shares = principal / closes[0];
    var invested = principal;
    for (var i = 1; i < n; i++) {
      shares += investPer / closes[i];
      invested += investPer;
    }
    var finalValue = shares * closes[n - 1];
    var profitRate = invested > 0 ? (finalValue - invested) / invested : 0;
    // 近20日动量
    var mom = n > 20 ? closes[n - 1] / closes[n - 21] - 1 : null;
    return {
      invested: invested,
      finalValue: finalValue,
      profit: finalValue - invested,
      profitRate: profitRate,
      momentum: mom,
      bars: n
    };
  }

  /* ---------- 一场比赛 ---------- */
  function runLeague(horses, barCount, principal, investPer, statusCb) {
    var results = [];
    var done = 0;
    return new Promise(function(resolve) {
      horses.forEach(function(h) {
        fetchSeries(h, barCount).then(function(closes) {
          var r = backtest(closes, principal, investPer);
          if (r) { r.horse = h; results.push(r); }
        }).catch(function(err) {
          console.warn('[赛马] 弃赛:', h.name, err.message);
        }).then(function() {
          done++;
          if (statusCb) statusCb(done, horses.length);
          if (done === horses.length) resolve(results);
        });
      });
    });
  }

  /* ---------- 渲染 ---------- */
  function renderLeague(elId, results, leagueName) {
    var el = document.getElementById(elId);
    if (!el) return;
    if (!results.length) {
      el.innerHTML = '<div class="race-empty">😢 全员弃赛（数据源异常），稍后再试</div>';
      return;
    }
    results.sort(function(a, b) { return b.profitRate - a.profitRate; });
    var medals = ['🏆', '🥈', '🥉'];
    var rows = results.map(function(r, i) {
      var badge = i < 3 ? '<span class="race-medal">' + medals[i] + '</span>' : '<span class="race-rank">' + (i + 1) + '</span>';
      var typeTag = r.horse.type === 'fund' ? '<span class="race-tag race-tag-fund">基金</span>'
                  : r.horse.type === 'etf' ? '<span class="race-tag race-tag-etf">ETF' + (r.horse.tag === '美' ? '·美</span>' : '</span>')
                  : '<span class="race-tag race-tag-stock">' + (r.horse.tag === '美' ? '美股' : '个股') + '</span>';
      return '<tr class="' + (i === 0 ? 'race-champion' : '') + '">' +
        '<td>' + badge + '</td>' +
        '<td class="race-name">' + r.horse.name + typeTag + '</td>' +
        '<td class="' + _cls(r.profitRate) + '"><b>' + _fmtPct(r.profitRate) + '</b></td>' +
        '<td>' + (r.invested).toFixed(0) + '</td>' +
        '<td class="' + _cls(r.finalValue - r.invested) + '">' + (r.finalValue - r.invested >= 0 ? '+' : '') + (r.finalValue - r.invested).toFixed(0) + '</td>' +
        '<td class="' + _cls(r.momentum) + '">' + _fmtPct(r.momentum) + '</td>' +
      '</tr>';
    }).join('');
    var champ = results[0];
    el.innerHTML =
      '<div class="race-champ-banner">' +
        '<span class="race-champ-cup">🏁</span> <b>' + leagueName + '冠军：' + champ.horse.name + '</b>' +
        '<span class="' + _cls(champ.profitRate) + '"> ' + _fmtPct(champ.profitRate) + '</span>' +
        '<span class="race-champ-sub">投入 ' + champ.invested.toFixed(0) + ' → 市值 ' + champ.finalValue.toFixed(0) + '</span>' +
      '</div>' +
      '<div class="race-table-wrap"><table class="race-table"><thead><tr>' +
        '<th>#</th><th>选手</th><th>收益率</th><th>总投入</th><th>净盈亏</th><th>近20日动量</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  /* ---------- 主入口 ---------- */
  function startRace() {
    if (_running) return;
    _running = true;
    var principal = parseFloat(document.getElementById('racePrincipal').value) || 10000;
    var investPer = parseFloat(document.getElementById('raceInvest').value) || 100;
    var shortDays = parseInt(document.getElementById('raceShortDays').value, 10) || 60;
    var longDays = parseInt(document.getElementById('raceLongDays').value, 10) || 250;
    shortDays = Math.min(Math.max(shortDays, 20), 500);
    longDays = Math.min(Math.max(longDays, 60), 750);
    var btn = document.getElementById('raceStartBtn');
    var shortEl = document.getElementById('raceShortResult');
    var longEl = document.getElementById('raceLongResult');
    var progEl = document.getElementById('raceProgress');
    btn.disabled = true;
    btn.textContent = '🏇 比赛中...';
    shortEl.innerHTML = '<div class="race-empty">⏳ 短跑组上赛道...</div>';
    longEl.innerHTML = '<div class="race-empty">⏳ 长跑组热身中...</div>';

    function prog(done, total) {
      if (progEl) progEl.textContent = '📊 数据加载进度：' + done + '/' + total;
    }

    // 并行跑两场
    var pShort = runLeague(HORSES_MARKET.concat(HORSES_FUND), shortDays, principal, investPer, prog)
      .then(function(rs) { renderLeague('raceShortResult', rs, '短跑组(' + shortDays + '日)'); return rs; });
    var pLong = runLeague(HORSES_MARKET.concat(HORSES_FUND), longDays, principal, investPer, prog)
      .then(function(rs) { renderLeague('raceLongResult', rs, '长跑组(' + longDays + '日)'); return rs; });

    Promise.all([pShort, pLong]).then(function(rs) {
      // 全场总冠军：短跑冠军与长跑冠军中收益率更高者
      var shortRs = (rs[0] || []).slice().sort(function(a,b){return b.profitRate-a.profitRate;});
      var longRs  = (rs[1] || []).slice().sort(function(a,b){return b.profitRate-a.profitRate;});
      var best = null;
      if (shortRs.length && longRs.length) {
        best = longRs[0].profitRate >= shortRs[0].profitRate ? longRs[0] : shortRs[0];
      } else best = shortRs[0] || longRs[0] || null;
      var el = document.getElementById('raceBestPick');
      if (el && best) {
        var horizon = shortRs.length && best === shortRs[0] ? '短跑赛道' : '长跑赛道';
        el.innerHTML = '<div class="race-best">' +
          '🎯 <b>帮你选好了：' + best.horse.name + '</b>' +
          '<span class="' + _cls(best.profitRate) + '">（' + horizon + '·' + _fmtPct(best.profitRate) + '）</span>' +
          '<span class="race-champ-sub">按当前参数投入 ' + best.invested.toFixed(0) + ' → 市值 ' + best.finalValue.toFixed(0) + '</span>' +
        '</div>';
        if (progEl) progEl.textContent = '';
      }
      return rs;
    }).catch(function(e) {
      console.warn('[赛马] 异常', e);
    }).then(function() {
      _running = false;
      btn.disabled = false;
      btn.textContent = '🏇 开赛！';
      if (progEl) progEl.textContent = '';
    });
  }

    /* ---------- 展开板块自动开赛（每次会话一次） ---------- */
  var _autoStarted = false;
  document.addEventListener('click', function(e) {
    if (_autoStarted) return;
    var head = e.target && e.target.closest ? e.target.closest('#foldRace .fold-head') : null;
    if (!head) return;
    var sec = document.getElementById('foldRace');
    if (sec && sec.getAttribute('data-open') !== '1' && !sec.classList.contains('folded')) {
      // 延迟到折叠动画后再跑，避免阻塞
      _autoStarted = true;
      Perf.trackedSetTimeout(function() { try { startRace(); } catch(ex){} }, 350);
    }
  }, true);

  return { startRace: startRace };
})();
