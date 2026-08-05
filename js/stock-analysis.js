'use strict';

/* ============================================================
   十一、个股查询
   ============================================================ */
// 全局存储当前查询的个股数据（供添加组合等使用）
var _currentStockData = null;
var _currentFinData = null;
var _currentFlowData = null;
var _currentDragonTigerData = null;
var _currentProfileData = null;
var _currentNationalTeamData = null;
var _currentResonanceData = null;
var _currentMAData = null;
var _currentKlineData = null; // 缓存K线图数据 {klData, stockName, realtimePrice}，防止 renderStockResult 覆盖后丢失

/**
 * 搜索跳转特效：黑洞吸积盘+粒子螺旋+引力透镜
 * 在搜索个股时触发，营造炫酷黑洞吞噬跳转效果
 * @param {function} callback - 动画完成后执行的回调（通常是switchTab）
 */
function triggerSearchTransition(callback) {
  // 移除已存在的覆盖层
  var existing = document.getElementById('searchTransitionOverlay');
  if (existing) existing.remove();

  // 创建覆盖层
  var overlay = document.createElement('div');
  overlay.id = 'searchTransitionOverlay';
  overlay.className = 'search-transition-overlay';

  // 创建黑洞奇点：从中心吞噬一切
  var singularity = document.createElement('div');
  singularity.className = 'bh-singularity';
  overlay.appendChild(singularity);

  // 创建引力透镜环（光晕弯曲）
  var lensing = document.createElement('div');
  lensing.className = 'bh-lensing';
  overlay.appendChild(lensing);

  // 创建吸积盘（旋转椭圆环 - 外圈）
  var disk = document.createElement('div');
  disk.className = 'bh-disk';
  overlay.appendChild(disk);

  // 创建吸积盘内环（反向旋转，制造深度感）
  var diskInner = document.createElement('div');
  diskInner.className = 'bh-disk-inner';
  overlay.appendChild(diskInner);

  // 创建黑洞吸积粒子 - 螺旋落入
  var particleCount = 24;
  for (var i = 0; i < particleCount; i++) {
    var p = document.createElement('div');
    p.className = 'bh-particle';
    var angle = (360 / particleCount) * i;
    var colors = ['#FF6B35', '#FFD700', '#00E5FF', '#FF3B30', '#7B68EE', '#FF4500'];
    var color = colors[i % colors.length];
    p.style.setProperty('--bh-angle', angle + 'deg');
    p.style.setProperty('--bh-delay', (i * 0.015) + 's');
    p.style.setProperty('--bh-radius', (120 + Math.random() * 80) + 'px');
    p.style.background = color;
    p.style.boxShadow = '0 0 4px ' + color + ', 0 0 8px ' + color;
    overlay.appendChild(p);
  }

  // 创建中心闪光爆发
  var flash = document.createElement('div');
  flash.className = 'bh-flash';
  overlay.appendChild(flash);

  document.body.appendChild(overlay);

  // 触发动画
  requestAnimationFrame(function() {
    overlay.classList.add('active');
  });

  // 动画中途执行回调（在黑洞吞噬最强时切换内容）
  Perf.trackedSetTimeout(function() {
 if (typeof callback === 'function') callback();
}, 350);

  // 动画结束后移除覆盖层
  Perf.trackedSetTimeout(function() {
    overlay.classList.remove('active');
    overlay.classList.add('fadeout');
    Perf.trackedSetTimeout(function() {
      if (overlay.parentNode) overlay.remove();
    }, 350);
  }, 900);
}

/**
 * 返回搜索框：滚动到页面顶部搜索栏，聚焦输入框并全选内容
 */
function backToSearch() {
  var searchInput = document.getElementById('searchInput');
  var searchbar = document.querySelector('.search-bar');
  // 滚动到搜索框
  if (searchbar) {
    searchbar.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  // 聚焦并全选，方便直接输入新代码
  if (searchInput) {
    Perf.trackedSetTimeout(function() {
 searchInput.focus();
 searchInput.select();
}, 400);
  }
}

function searchStock() {
  var input = document.getElementById('searchInput');
  if (!input) return;
  var keyword = input.value.trim();
  if (!keyword) { showToast('请输入股票代码或名称'); return; }

  // 设置搜索进行中标志，阻止联想异步回调干扰
  _searchInProgress = true;

  // 清除搜索联想防抖定时器，防止结果已显示后联想下拉框弹出导致页面跳回搜索框
  if (_suggestTimer) { Perf.clearTimeout(_suggestTimer); _suggestTimer = null; }
  var suggestEl = document.getElementById('searchSuggest');
  if (suggestEl) suggestEl.classList.remove('show');

  // 失焦输入框，防止浏览器自动滚动到搜索框保持可见
  input.blur();

  showToast('查询中...');

  // 流程：东方财富 suggest API 解析关键词 → 腾讯接口获取实时行情 → 东方财富获取财务数据+主力资金
  emSuggest(keyword).then(function(data) {
    // 从API响应中提取第一条匹配结果
    var suggest = (data && data.QuotationCodeTable && data.QuotationCodeTable.Data && data.QuotationCodeTable.Data[0]) || null;
    // 从suggest结果或_suggestMeta中获取ETF/指数标志
    var isETF = (suggest && suggest._isETF) || (_suggestMeta && _suggestMeta.isETF);
    var isIndex = (suggest && suggest._isIndex) || (_suggestMeta && _suggestMeta.isIndex);

    if (!suggest) {
      return fetchTencentStock(keyword).then(function(d) {
        return d ? { _tencent: true, data: d, _secCode: keyword, _isETF: isETF, _isIndex: isIndex } : null;
      });
    }
    var tencentCode = emToTencentCode(suggest.MktNum, suggest.Code);
    return fetchTencentBatch([tencentCode]).then(function(tData) {
      if (tData[tencentCode]) {
        return { _tencent: true, data: tData[tencentCode], _secCode: suggest.Code, _isETF: isETF, _isIndex: isIndex };
      }
      return null;
    });
  }).then(function(stock) {
    if (!stock) {
      _searchInProgress = false;
      _suggestMeta = null;
      showToast('未找到相关股票');
      return;
    }

    // 判断是否为ETF/指数基金
    var isETF = stock._isETF || (_suggestMeta && _suggestMeta.isETF);

    // 1. 先渲染行情数据（快速展示）
    var stockData = extractStockInfo(stock);
    stockData.isETF = isETF; // 标记ETF类型
    _currentStockData = stockData;
    
    _currentFlowData = null;
    _currentDragonTigerData = null;
    _currentProfileData = null;
    _currentNationalTeamData = null;
    _currentResonanceData = null;
    _currentMAData = null;
    _currentKlineData = null;
    renderStockResult(stockData, null, null, true);
    showToast(isETF ? 'ETF查询成功，加载资金和K线数据...' : '查询成功，正在加载财务和资金数据...');
    _suggestMeta = null;

    // 2. 并行加载财务数据 + 主力资金数据 + 公司概况
    var secCode = stock._secCode || stockData.code;
    var _asyncPromises = [];

    if (isETF) {
      // ETF基金：跳过财务报表/龙虎榜/公司概况/国家队（这些API不适用ETF）
      // 仅加载主力资金流向、大盘共振、MA均线分析
      showToast('ETF基金：加载资金流向和K线分析...');

      // ETF评分系统：并行获取基金详情+净值+K线，计算多维度评分
      var pureEtfCode = secCode.replace(/^(sh|sz|hk)/i, '');
      var etfTencentCode;
      if (pureEtfCode.charAt(0) === '5' || pureEtfCode.charAt(0) === '6' || pureEtfCode.charAt(0) === '9') etfTencentCode = 'sh' + pureEtfCode;
      else etfTencentCode = 'sz' + pureEtfCode;

      _asyncPromises.push(Promise.allSettled([
        fetchKline(etfTencentCode, 250),   // K线数据（复用缓存）
        fetchETFDetail(secCode),             // 基金详情
        fetchETFNav(pureEtfCode)             // 最新净值
      ]).then(function(results) {
        var klData = results[0].status === 'fulfilled' ? results[0].value : null;
        var etfDetail = results[1].status === 'fulfilled' ? results[1].value : null;
        var navData = results[2].status === 'fulfilled' ? results[2].value : null;

        var scoreData = assessETF(stockData, klData, etfDetail, navData);
        renderETFScore(scoreData);
        if (scoreData) showToast('ETF评分: ' + scoreData.score + '分 ' + scoreData.level);
      }));
    } else {
      // 股票：加载全部数据
      // 财务数据
      _asyncPromises.push(fetchStockFinancials(secCode).then(function(finData) {
        _currentFinData = finData;
        renderStockResult(stockData, finData, _currentFlowData, false);
        if (finData) showToast('财务数据已加载');
      }).catch(function() {
        _currentFinData = null;
      }));

      // 龙虎榜数据
      _asyncPromises.push(fetchDragonTiger(secCode).then(function(dtData) {
        _currentDragonTigerData = dtData;
        renderDragonTiger(dtData);
      }).catch(function(err) {
        console.warn('龙虎榜获取失败:', err.message);
      }));

      // 公司概况与行业分析
      _asyncPromises.push(fetchCompanyProfile(secCode).then(function(profileData) {
        _currentProfileData = profileData;
        renderCompanyProfile(profileData, _currentFinData, stockData);
        if (profileData) showToast('公司概况已加载');
      }).catch(function(err) {
        console.warn('公司概况获取失败:', err.message);
      }));

      // 国家队持股数据
      _asyncPromises.push(fetchNationalTeam(secCode).then(function(ntData) {
        _currentNationalTeamData = ntData;
        renderNationalTeam(ntData);
        if (ntData && ntData.hasData) showToast('国家队持股数据已加载');
      }).catch(function(err) {
        console.warn('国家队获取失败:', err.message);
      }));
    }

    // 主力资金流向（ETF和股票都加载）
    _asyncPromises.push(fetchCapitalFlow(secCode, 20).then(function(flowData) {
      _currentFlowData = flowData;
      renderStockResult(stockData, _currentFinData, flowData, false);
      if (flowData) showToast('主力资金数据已加载');
    }).catch(function(err) {
      console.warn('主力资金获取失败:', err.message);
      _currentFlowData = null;
    }));

    // 大盘共振分析（ETF和股票都加载，使用K线数据+实时价格）
    _asyncPromises.push(fetchResonance(secCode, stockData.name, stockData.price).then(function(resData) {
      _currentResonanceData = resData;
      renderResonance(resData);
      // 共振分析同时计算了MA20数据，一并渲染
      _currentMAData = resData ? resData.maData : null;
      renderMAAnalysis(_currentMAData);
      if (resData) showToast('共振分析已加载');
    }).catch(function(err) {
      console.warn('共振分析获取失败:', err.message);
    }));

    // K线图（ETF和股票都加载，传入实时价格使MA20更准）
    _asyncPromises.push(fetchAndRenderKlineChart(secCode, stockData.name, stockData.price));

    // 所有异步加载完成后，清除搜索标志，恢复联想功能
    Promise.allSettled(_asyncPromises).then(function() {
      _searchInProgress = false;
    });

  }).catch(function(err) {
    console.warn('查询失败:', err.message);
    // suggest 失败，尝试腾讯按代码查询作为最终回退
    fetchTencentStock(keyword).then(function(stock) {
      if (stock) {
        var stockData = extractStockInfo(stock);
        // 回退路径：通过代码模式判断是否ETF
        var codeNum = stockData.code.replace(/^(sh|sz|hk)/i, '');
        var isETF = /^(51|56|58|159)/.test(codeNum);
        stockData.isETF = isETF;
        _currentStockData = stockData;
        _currentFlowData = null;
        _currentDragonTigerData = null;
        _currentProfileData = null;
        _currentNationalTeamData = null;
        _currentResonanceData = null;
        _currentMAData = null;
        _currentKlineData = null;
        renderStockResult(stockData, null, null, true);
        showToast(isETF ? 'ETF查询成功，加载资金和K线数据...' : '查询成功，正在加载财务和资金数据...');
        var secCode = stock._secCode || stockData.code;
        var _asyncPromises = [];

        if (!isETF) {
          _asyncPromises.push(fetchStockFinancials(secCode).then(function(finData) {
            _currentFinData = finData;
            renderStockResult(stockData, finData, _currentFlowData, false);
          }).catch(function() { _currentFinData = null; }));

          _asyncPromises.push(fetchDragonTiger(secCode).then(function(dtData) {
            _currentDragonTigerData = dtData;
            renderDragonTiger(dtData);
          }).catch(function(err2) { console.warn('龙虎榜获取失败:', err2.message); }));

          _asyncPromises.push(fetchCompanyProfile(secCode).then(function(profileData) {
            _currentProfileData = profileData;
            renderCompanyProfile(profileData, _currentFinData, stockData);
          }).catch(function(err2) { console.warn('公司概况获取失败:', err2.message); }));

          _asyncPromises.push(fetchNationalTeam(secCode).then(function(ntData) {
            _currentNationalTeamData = ntData;
            renderNationalTeam(ntData);
          }).catch(function(err2) { console.warn('国家队持股获取失败:', err2.message); }));
        } else {
          // ETF回退路径：同样加载评分系统
          var fbPureCode = secCode.replace(/^(sh|sz|hk)/i, '');
          var fbTencentCode;
          if (fbPureCode.charAt(0) === '5' || fbPureCode.charAt(0) === '6' || fbPureCode.charAt(0) === '9') fbTencentCode = 'sh' + fbPureCode;
          else fbTencentCode = 'sz' + fbPureCode;

          _asyncPromises.push(Promise.allSettled([
            fetchKline(fbTencentCode, 250),
            fetchETFDetail(secCode),
            fetchETFNav(fbPureCode)
          ]).then(function(results) {
            var klData = results[0].status === 'fulfilled' ? results[0].value : null;
            var etfDetail = results[1].status === 'fulfilled' ? results[1].value : null;
            var navData = results[2].status === 'fulfilled' ? results[2].value : null;
            var scoreData = assessETF(stockData, klData, etfDetail, navData);
            renderETFScore(scoreData);
            if (scoreData) showToast('ETF评分: ' + scoreData.score + '分 ' + scoreData.level);
          }));
        }

        // 主力资金和共振分析（ETF和股票都加载）
        _asyncPromises.push(fetchCapitalFlow(secCode, 20).then(function(flowData) {
          _currentFlowData = flowData;
          renderStockResult(stockData, _currentFinData, flowData, false);
        }).catch(function(err2) { console.warn('主力资金获取失败:', err2.message); }));

        _asyncPromises.push(fetchResonance(secCode, stockData.name, stockData.price).then(function(resData) {
          _currentResonanceData = resData;
          renderResonance(resData);
          _currentMAData = resData ? resData.maData : null;
          renderMAAnalysis(_currentMAData);
        }).catch(function(err2) { console.warn('共振分析获取失败:', err2.message); }));

        // K线图（ETF和股票都加载，传入实时价格使MA20更准）
        _asyncPromises.push(fetchAndRenderKlineChart(secCode, stockData.name, stockData.price));

        // 所有异步加载完成后，清除搜索标志，恢复联想功能
        Promise.allSettled(_asyncPromises).then(function() {
          _searchInProgress = false;
        });

      } else {
        _searchInProgress = false;
        showToast('查询失败，请检查代码');
        renderStockResult({ name: keyword, code: keyword, price: 0 }, null, null, false);
      }
    }).catch(function() {
      _searchInProgress = false;
      showToast('查询失败，请检查代码');
      renderStockResult({ name: keyword, code: keyword, price: 0 }, null, null, false);
    });
  });
}

/* ============================================================
   黑五类股票检测（李大霄概念）
   五类：小盘股、次新股、垃圾股、题材股、伪成长股
   额外检测：ST/*ST风险警示、退市风险
   ============================================================ */

/**
 * 检测个股是否属于"黑五类"
 * @param {object} stockData - 股票行情数据
 * @param {object} finData - 财务数据（可选，第二期渲染时才有）
 * @returns {object} { isBlack: bool, categories: [{type, label, reason}] }
 */
function detectBlackFive(stockData, finData) {
  var categories = [];
  if (!stockData || stockData.isETF) return { isBlack: false, categories: [] };

  var name = stockData.name || '';
  var marketCap = stockData.marketCap || 0; // 单位：元
  var pe = stockData.pe || 0;
  var code = (stockData.code || '').replace(/^(sh|sz|hk)/i, '');

  // 0. ST/*ST 风险警示（额外检测，不属于黑五类但风险极高）
  if (/\*ST/i.test(name)) {
    categories.push({ type: 'st', label: '*ST退市风险', reason: '股票被实施退市风险警示，存在终止上市风险' });
  } else if (/ST/i.test(name) && !/STR|STAR/i.test(name)) {
    categories.push({ type: 'st', label: 'ST风险警示', reason: '股票被实施其他风险警示，经营状况存在不确定性' });
  }

  // 0b. 退市整理期
  if (/退/i.test(name)) {
    categories.push({ type: 'delisting', label: '退市整理期', reason: '股票处于退市整理期，即将终止上市' });
  }

  // 1. 小盘股：总市值 < 30亿
  if (marketCap > 0 && marketCap < 30e8) {
    var capStr = (marketCap / 1e8).toFixed(1);
    categories.push({ type: 'smallcap', label: '小盘股', reason: '总市值仅' + capStr + '亿，流通盘小，易被资金控盘操纵' });
  }

  // 2. 次新股：上市不足一年（从profileData获取上市日期）
  if (_currentProfileData && _currentProfileData.listingDate) {
    var listDate = new Date(_currentProfileData.listingDate);
    if (!isNaN(listDate.getTime())) {
      var daysSinceListing = (Date.now() - listDate.getTime()) / 86400000;
      if (daysSinceListing > 0 && daysSinceListing < 365) {
        categories.push({ type: 'newstock', label: '次新股', reason: '上市仅' + Math.floor(daysSinceListing) + '天，估值波动大，业绩稳定性待验证' });
      }
    }
  }

  // 3. 垃圾股（绩差股）：每股收益 < 1分钱（含亏损）
  if (finData && finData.eps !== undefined) {
    if (finData.eps < 0) {
      categories.push({ type: 'junk', label: '亏损股', reason: '每股收益为负（' + finData.eps.toFixed(2) + '元），公司处于亏损状态' });
    } else if (finData.eps < 0.01) {
      categories.push({ type: 'junk', label: '垃圾股', reason: '每股收益仅' + finData.eps.toFixed(3) + '元（不足1分钱），盈利能力极差' });
    }
  }

  // 4. 题材股：PE畸高(>70) + 小市值(<50亿)
  if (pe > 70 && marketCap > 0 && marketCap < 50e8) {
    categories.push({ type: 'theme', label: '题材股', reason: 'PE高达' + pe.toFixed(0) + '倍+市值仅' + (marketCap / 1e8).toFixed(0) + '亿，疑似概念炒作，估值严重偏离基本面' });
  }

  // 5. 伪成长股：营收增速偏低(<10%)且利润下滑(<0)，市值<50亿
  if (finData && finData.revenueYoY !== undefined && finData.profitYoY !== undefined) {
    if (finData.revenueYoY < 10 && finData.profitYoY < 0 && marketCap > 0 && marketCap < 50e8) {
      categories.push({ type: 'fakegrowth', label: '伪成长股', reason: '营收增速仅' + finData.revenueYoY.toFixed(1) + '%+净利润同比' + finData.profitYoY.toFixed(1) + '%，增长停滞或下滑，成长性存疑' });
    }
  }

  return { isBlack: categories.length > 0, categories: categories };
}

/**
 * 从腾讯/东方财富数据中提取统一的个股信息
 */
function extractStockInfo(stock) {
  var info = {
    name: '', code: '', price: 0, changePct: 0, changeAmt: 0,
    open: 0, prevClose: 0, high: 0, low: 0,
    volume: 0, turnover: 0, turnoverRate: 0, amplitude: 0,
    pe: 0, pb: 0, marketCap: 0
  };

  if (stock && stock._tencent) {
    var d = stock.data;
    info.name = d.name;
    info.code = d.code;
    info.price = d.price;
    info.changePct = d.changePercent;
    info.changeAmt = d.changeAmount;
    info.open = d.open;
    info.prevClose = d.yesterdayClose;
    info.high = d.high;
    info.low = d.low;
    info.volume = d.volume;
    info.turnover = d.turnover;
    info.turnoverRate = d.turnoverRate;
    info.amplitude = d.amplitude;
    info.pe = d.pe;
    info.pb = d.pb;
    if (d.source === 'eastmoney') {
      info.marketCap = d.marketCap || 0;  // f116 already in 元
    } else {
      info.marketCap = d.marketCap ? d.marketCap * 1e8 : 0;  // 亿→元
    }
  } else if (stock) {
    info.name = stock.f14 || stock.name || '';
    info.code = stock.f12 || stock.code || '';
    info.price = stock.f2 || 0;
    info.changePct = stock.f3 || 0;
    info.pe = stock.f9 || 0;
    info.pb = stock.f23 || 0;
    info.marketCap = stock.f20 || stock.marketCap || 0;
    info.turnover = stock.f6 ? stock.f6 / 10000 : 0;
  }

  return info;
}

/**
 * 东方财富数据中心：获取个股财务指标
 * 数据源 datacenter-web.eastmoney.com (JSONP/fetch)
 * 获取最近4期财报的主要财务指标
 * @param {string} secCode - 纯数字代码，如 '600519'
 * @returns {Promise} resolve(finData) 或 resolve(null)
 */
function fetchStockFinancials(secCode) {
  // 纯数字代码提取
  var code = secCode.replace(/^(sh|sz|hk)/i, '');
  var url = 'https://datacenter-web.eastmoney.com/api/data/v1/get' +
    '?sortColumns=REPORT_DATE&sortTypes=-1&pageSize=4&pageNumber=1' +
    '&reportName=RPT_F10_FINANCE_MAINFINADATA&columns=ALL' +
    '&source=WEB&client=WEB' +
    '&filter=(SECURITY_CODE%3D%22' + code + '%22)';

  // 优先使用 fetch（CORS），失败回退 JSONP
  return fetchWithTimeout(url, { cache: 'no-store' }, 4000).then(function(res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }).catch(function(fetchErr) {
    console.warn('财务数据fetch失败，尝试JSONP:', fetchErr.message);
    return emJsonp(url, 4000);
  }).then(function(data) {
    if (!data || !data.result || !data.result.data || data.result.data.length === 0) {
      console.warn('财务数据为空');
      return null;
    }
    // 取最新一期数据
    var latest = data.result.data[0];
    var prev = data.result.data[1] || {};
    return parseEmFinancialData(latest, prev);
  }).catch(function(err) {
    console.warn('财务数据获取失败:', err.message);
    return null;
  });
}

/**
 * 解析东方财富财务数据为统一格式
 */
function parseEmFinancialData(latest, prev) {
  return {
    reportDate: latest.REPORT_DATE || '',
    reportType: latest.REPORT_TYPE || '',
    revenue: parseFloat(latest.TOTALOPERATEREVE) || 0,           // 营业收入(元)
    revenueYoY: parseFloat(latest.TOTALOPERATEREVETZ) || 0,       // 营收同比增长率(%)
    netProfit: parseFloat(latest.PARENTNETPROFIT) || 0,           // 归母净利润(元)
    profitYoY: parseFloat(latest.PARENTNETPROFITTZ) || 0,         // 净利润同比增长率(%)
    eps: parseFloat(latest.EPSJB) || 0,                           // 基本每股收益
    bvps: parseFloat(latest.BPS) || 0,                            // 每股净资产
    roe: parseFloat(latest.ROEJQ) || 0,                           // 加权净资产收益率(%)
    grossMargin: parseFloat(latest.XSMLL) || 0,                    // 销售毛利率(%)
    netMargin: parseFloat(latest.XSJLL) || 0,                      // 销售净利率(%)
    debtRatio: parseFloat(latest.ZCFZL) || 0,                      // 资产负债率(%)
    // 上一期数据用于环比
    prevRevenue: parseFloat(prev.TOTALOPERATEREVE) || 0,
    prevNetProfit: parseFloat(prev.PARENTNETPROFIT) || 0,
  };
}

/**
 * 格式化大数字：亿/万
 */
function formatBigNumber(num) {
  if (!num || num === 0) return '—';
  var abs = Math.abs(num);
  if (abs >= 1e8) return (num / 1e8).toFixed(2) + '亿';
  if (abs >= 1e4) return (num / 1e4).toFixed(2) + '万';
  return num.toFixed(2);
}

/* ============================================================
   公司概况与行业分析（东方财富F10数据中心）
   数据源：datacenter-web.eastmoney.com
   reportName: RPT_F10_BASIC_ORGINFO
   ============================================================ */

/**
 * 纯数字代码转SECUCODE格式（600519 → 600519.SH）
 * @param {string} code - 纯数字代码
 * @returns {string} SECUCODE格式
 */
function toSecuCode(code) {
  code = code.replace(/^(sh|sz|hk)/i, '');
  if (code.charAt(0) === '6' || code.charAt(0) === '5' || code.charAt(0) === '9') return code + '.SH';
  if (code.charAt(0) === '0' || code.charAt(0) === '3' || code.charAt(0) === '2') return code + '.SZ';
  return code + '.SH';
}

/**
 * 获取个股公司概况（F10基本信息）
 * 数据源：东方财富数据中心 RPT_F10_BASIC_ORGINFO
 * @param {string} secCode - 纯数字代码，如 '600519'
 * @returns {Promise} resolve(profileData) 或 resolve(null)
 */
function fetchCompanyProfile(secCode) {
  var code = secCode.replace(/^(sh|sz|hk)/i, '');
  var secuCode = toSecuCode(code);
  var url = 'https://datacenter-web.eastmoney.com/api/data/v1/get' +
    '?pageSize=1&pageNumber=1' +
    '&reportName=RPT_F10_BASIC_ORGINFO' +
    '&columns=ALL' +
    '&source=WEB&client=WEB' +
    '&filter=(SECUCODE%3D%22' + secuCode + '%22)';

  return fetchWithTimeout(url, { cache: 'no-store' }, 6000).then(function(res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }).catch(function(fetchErr) {
    console.warn('公司概况fetch失败，尝试JSONP:', fetchErr.message);
    return dcJsonp(url, 6000);
  }).then(function(data) {
    if (!data || !data.result || !data.result.data || data.result.data.length === 0) {
      return null;
    }
    var d = data.result.data[0];
    return {
      orgName: d.ORG_NAME || '',                    // 公司全称
      orgProfile: d.ORG_PROFILE || '',               // 公司简介
      businessScope: d.BUSINESS_SCOPE || '',          // 经营范围
      mainBusiness: d.MAIN_BUSINESS || '',            // 主营业务
      emIndustry: d.EM2016 || '',                     // 东财行业分类
      csrcIndustry: d.INDUSTRYCSRC1 || '',            // 证监会行业分类
      boardName: d.BOARD_NAME_LEVEL || '',             // 行业板块层级
      listingDate: (d.LISTING_DATE || '').substring(0, 10), // 上市日期
      foundDate: (d.FOUND_DATE || '').substring(0, 10),    // 成立日期
      legalPerson: d.LEGAL_PERSON || '',               // 法人代表
      chairman: d.CHAIRMAN || '',                      // 董事长
      president: d.PRESIDENT || '',                    // 总经理
      secretary: d.SECRETARY || '',                    // 董秘
      actualHolder: d.ACTUAL_HOLDER || '',              // 实际控制人
      regCapital: parseFloat(d.REG_CAPITAL) || 0,       // 注册资本(万元)
      empNum: d.EMP_NUM || 0,                          // 员工人数
      orgWeb: d.ORG_WEB || '',                         // 公司网址
      address: d.ADDRESS || '',                        // 办公地址
      province: d.PROVINCE || '',                      // 省份
      tradeMarket: d.TRADE_MARKET || '',                // 上市交易所
      securityType: d.SECURITY_TYPE || '',              // 证券类别
      formerName: d.FORMERNAME || '',                   // 曾用名
      secCode: d.SECURITY_CODE || code,
      secName: d.SECURITY_NAME_ABBR || ''
    };
  }).catch(function(err) {
    console.warn('公司概况获取失败:', err.message);
    return null;
  });
}

/**
 * 根据行业和财务数据生成行业前景分析
 * @param {object} profile - 公司概况数据
 * @param {object} finData - 财务数据
 * @param {object} stockData - 行情数据
 * @returns {object} { outlook: '积极/稳健/谨慎/风险', analysis: '...', tags: [...] }
 */
function generateIndustryOutlook(profile, finData, stockData) {
  if (!profile) return { outlook: '—', analysis: '暂无公司概况数据', tags: [] };

  var industry = profile.emIndustry || profile.csrcIndustry || '';
  var tags = [];
  var analysisParts = [];
  var outlook = '稳健';
  var outlookColor = '#FFD700';

  // 行业关键词分析
  var industryLower = industry.toLowerCase();
  var isBaijiu = industryLower.indexOf('白酒') >= 0;
  var isBank = industryLower.indexOf('银行') >= 0;
  var isTech = industryLower.indexOf('半导体') >= 0 || industryLower.indexOf('芯片') >= 0 || industryLower.indexOf('电子') >= 0 || industryLower.indexOf('软件') >= 0 || industryLower.indexOf('计算机') >= 0;
  var isNewEnergy = industryLower.indexOf('新能源') >= 0 || industryLower.indexOf('光伏') >= 0 || industryLower.indexOf('锂电') >= 0 || industryLower.indexOf('风电') >= 0;
  var isPharma = industryLower.indexOf('医药') >= 0 || industryLower.indexOf('生物') >= 0 || industryLower.indexOf('医疗') >= 0;
  var isRealEstate = industryLower.indexOf('房地产') >= 0 || industryLower.indexOf('地产') >= 0;
  var isConsumer = industryLower.indexOf('食品') >= 0 || industryLower.indexOf('饮料') >= 0 || industryLower.indexOf('消费') >= 0 || industryLower.indexOf('零售') >= 0;
  var isFinance = industryLower.indexOf('证券') >= 0 || industryLower.indexOf('保险') >= 0;
  var isManufacture = industryLower.indexOf('制造') >= 0 || industryLower.indexOf('机械') >= 0 || industryLower.indexOf('设备') >= 0;
  var isMaterial = industryLower.indexOf('化工') >= 0 || industryLower.indexOf('钢铁') >= 0 || industryLower.indexOf('有色') >= 0 || industryLower.indexOf('建材') >= 0;

  // 行业前景判断
  if (isBaijiu) {
    analysisParts.push('白酒行业集中度持续提升，高端白酒品牌壁垒深厚，定价权强');
    tags.push('品牌壁垒', '高毛利', '消费升级');
    outlook = '稳健'; outlookColor = '#FFD700';
  } else if (isBank) {
    analysisParts.push('银行业受益于息差变化与资产质量改善，大型银行盈利稳定但增长空间有限');
    tags.push('高股息', '低估值', '防御性');
    outlook = '稳健'; outlookColor = '#FFD700';
  } else if (isTech) {
    analysisParts.push('科技行业受益于国产替代与技术创新驱动，成长空间大但竞争激烈');
    tags.push('高成长', '政策支持', '技术迭代');
    outlook = '积极'; outlookColor = '#00C853';
  } else if (isNewEnergy) {
    analysisParts.push('新能源行业长期受益于碳中和政策，但短期面临产能过剩与价格竞争压力');
    tags.push('碳中和', '政策驱动', '周期波动');
    outlook = '积极'; outlookColor = '#00C853';
  } else if (isPharma) {
    analysisParts.push('医药行业受益于老龄化趋势与创新药政策支持，集采压力逐步消化');
    tags.push('老龄化', '创新驱动', '集采影响');
    outlook = '稳健'; outlookColor = '#FFD700';
  } else if (isRealEstate) {
    analysisParts.push('房地产行业处于深度调整期，政策端持续发力但行业基本面仍承压');
    tags.push('政策托底', '行业洗牌', '高风险');
    outlook = '谨慎'; outlookColor = '#FF3B30';
  } else if (isConsumer) {
    analysisParts.push('消费行业受益于内需复苏，龙头公司品牌渠道优势显著');
    tags.push('内需消费', '品牌价值', '现金流稳定');
    outlook = '稳健'; outlookColor = '#FFD700';
  } else if (isFinance) {
    analysisParts.push('非银金融行业与市场活跃度高度相关，牛市弹性大');
    tags.push('周期性强', '高弹性', '政策敏感');
    outlook = '稳健'; outlookColor = '#FFD700';
  } else if (isManufacture) {
    analysisParts.push('制造业受益于产业升级与自动化趋势，龙头公司规模效应逐步显现');
    tags.push('产业升级', '规模效应', '出口竞争');
    outlook = '稳健'; outlookColor = '#FFD700';
  } else if (isMaterial) {
    analysisParts.push('材料行业具有强周期属性，当前处于周期底部区域，关注库存拐点');
    tags.push('强周期', '库存周期', '价格波动');
    outlook = '谨慎'; outlookColor = '#FF3B30';
  } else {
    analysisParts.push('公司所属「' + (profile.emIndustry || profile.csrcIndustry || '未知') + '」行业，建议关注行业政策与竞争格局变化');
    tags.push('行业研究');
  }

  // 结合财务数据补充分析
  if (finData) {
    if (finData.roe >= 15) {
      analysisParts.push('公司ROE达' + finData.roe.toFixed(1) + '%，盈利能力突出');
      tags.push('高ROE');
    } else if (finData.roe > 0 && finData.roe < 5) {
      analysisParts.push('公司ROE仅' + finData.roe.toFixed(1) + '%，盈利能力偏弱');
    }
    if (finData.profitYoY > 20) {
      analysisParts.push('净利润同比增长' + finData.profitYoY.toFixed(1) + '%，成长性优异');
      tags.push('高增长');
    } else if (finData.profitYoY < -10) {
      analysisParts.push('净利润同比下降' + Math.abs(finData.profitYoY).toFixed(1) + '%，业绩承压');
      tags.push('业绩下滑');
      if (outlook === '积极') { outlook = '谨慎'; outlookColor = '#FF3B30'; }
    }
    if (finData.grossMargin >= 50) {
      analysisParts.push('毛利率' + finData.grossMargin.toFixed(1) + '%，产品竞争力强');
      if (tags.indexOf('高毛利') === -1) tags.push('高毛利');
    }
    if (finData.debtRatio >= 70) {
      analysisParts.push('资产负债率' + finData.debtRatio.toFixed(0) + '%，财务杠杆较高');
      tags.push('高负债');
    } else if (finData.debtRatio > 0 && finData.debtRatio < 30) {
      analysisParts.push('资产负债率仅' + finData.debtRatio.toFixed(0) + '%，财务结构稳健');
      tags.push('低负债');
    }
  }

  // 结合估值判断
  if (stockData && stockData.pe > 0) {
    if (stockData.pe < 15) {
      analysisParts.push('当前PE仅' + stockData.pe.toFixed(1) + '倍，估值处于低位');
      tags.push('低估值');
    } else if (stockData.pe > 50) {
      analysisParts.push('当前PE达' + stockData.pe.toFixed(1) + '倍，估值偏高需关注');
      tags.push('高估值');
    }
  }

  return {
    outlook: outlook,
    outlookColor: outlookColor,
    analysis: analysisParts.join('；') + '。',
    tags: tags
  };
}

/* ============================================================
   龙虎榜数据（东方财富数据中心 JSONP）
   ============================================================ */

/**
 * 东方财富数据中心 JSONP 调用（使用 callback 参数）
 * 与 emJsonp 不同，此函数使用 callback 参数名（数据中心龙虎榜接口要求）
 * @param {string} url - 不含 callback 参数的接口 URL
 * @param {number} timeout
 * @returns {Promise} resolve(data)
 */
function dcJsonp(url, timeout) {
  timeout = timeout || 8000;
  return new Promise(function(resolve, reject) {
    _cbCounter++;
    var cbName = '_dc_cb_' + _cbCounter;
    var script = document.createElement('script');
    var timer = null;

    window[cbName] = function(data) {
      cleanup();
      resolve(data);
    };

    function cleanup() {
      if (timer) Perf.clearTimeout(timer);
      delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    script.onerror = function() {
      cleanup();
      reject(new Error('数据中心接口请求失败'));
    };

    timer = Perf.trackedSetTimeout(function() {
 cleanup();
 reject(new Error('数据中心接口超时'));
}, timeout);

    var sep = url.indexOf('?') >= 0 ? '&' : '?';
    script.src = url + sep + 'callback=' + cbName;
    document.head.appendChild(script);
  });
}

/**
 * 获取个股龙虎榜上榜记录
 * 数据源：东方财富数据中心 datacenter-web.eastmoney.com
 * 查询最近30天内该个股的龙虎榜上榜情况
 * @param {string} secCode - 纯数字代码，如 '600519'
 * @returns {Promise} resolve(data) - { list: [...], hasData: boolean }
 */
function fetchDragonTiger(secCode) {
  var code = secCode.replace(/^(sh|sz|hk)/i, '');

  // 计算近30天日期范围
  var endDate = new Date();
  var startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);
  var fmt = function(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  var startStr = fmt(startDate);
  var endStr = fmt(endDate);

  // 龙虎榜每日明细（上榜个股汇总）- 使用东方财富数据中心API
  // reportName: RPT_DAILYBILLBOARD_DETAILSNEW（龙虎榜详情）
  var url = 'https://datacenter-web.eastmoney.com/api/data/v1/get' +
    '?sortColumns=TRADE_DATE&sortTypes=-1&pageSize=10&pageNumber=1' +
    '&reportName=RPT_DAILYBILLBOARD_DETAILSNEW' +
    '&columns=ALL' +
    '&source=WEB&client=WEB' +
    '&filter=(SECURITY_CODE%3D%22' + code + '%22)(TRADE_DATE%3E%3D%27' + startStr + '%27)(TRADE_DATE%3C%3D%27' + endStr + '%27)';

  return fetchWithTimeout(url, { cache: 'no-store' }, 6000).then(function(res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }).catch(function(fetchErr) {
    console.warn('龙虎榜fetch失败，尝试JSONP:', fetchErr.message);
    return dcJsonp(url, 6000);
  }).then(function(data) {
    if (!data || !data.result || !data.result.data || data.result.data.length === 0) {
      return { list: [], hasData: false };
    }

    var list = data.result.data.map(function(item) {
      return {
        tradeDate: (item.TRADE_DATE || '').substring(0, 10),
        closePrice: parseFloat(item.CLOSE_PRICE) || 0,
        changeRate: parseFloat(item.CHANGE_RATE) || 0,
        netBuyAmt: parseFloat(item.BILLBOARD_NET_AMT) || 0,      // 龙虎榜净买额(元)
        buyAmt: parseFloat(item.BILLBOARD_BUY_AMT) || 0,          // 龙虎榜买入额(元)
        sellAmt: parseFloat(item.BILLBOARD_SELL_AMT) || 0,        // 龙虎榜卖出额(元)
        dealAmt: parseFloat(item.BILLBOARD_DEAL_AMT) || 0,        // 龙虎榜成交额(元)
        turnoverRate: parseFloat(item.TURNOVERRATE) || 0,         // 换手率(%)
        reason: item.EXPLANATION || '',                            // 上榜原因
        interpret: item.EXPLAIN || '',                             // 解读（如"2家机构买入"）
        nextDayChange: parseFloat(item.D1_CLOSE_ADJCHRATE) || null, // 上榜后1日涨跌幅
        d2Change: parseFloat(item.D2_CLOSE_ADJCHRATE) || null,    // 上榜后2日涨跌幅
        d5Change: parseFloat(item.D5_CLOSE_ADJCHRATE) || null,    // 上榜后5日涨跌幅
        tradeId: item.TRADE_ID || '',                              // 交易ID
        freeMarketCap: parseFloat(item.FREE_MARKET_CAP) || 0,     // 流通市值(元)
        secCode: item.SECURITY_CODE || code,
        secName: item.SECURITY_NAME_ABBR || ''
      };
    });

    return { list: list, hasData: true };
  }).catch(function(err) {
    console.warn('龙虎榜数据获取失败:', err.message);
    return { list: [], hasData: false, error: err.message };
  });
}

/**
 * 获取个股国家队持股数据
 * 数据源：东方财富数据中心 RPT_F10_EH_FREEHOLDERS（十大流通股东）
 * 通过 HOLDER_NEWTYPE="国家队" 字段及股东名称关键词识别国家队成员
 * 国家队包括：中央汇金、证金公司、社保基金、国家大基金、外管局投资平台
 * @param {string} secCode - 纯数字代码，如 '600519'
 * @returns {Promise} resolve({ list: [...], hasData: boolean, reportDate: string })
 */
function fetchNationalTeam(secCode) {
  var code = secCode.replace(/^(sh|sz|hk)/i, '');

  // 查询十大流通股东，按报告期倒序取最新一期
  var url = 'https://datacenter-web.eastmoney.com/api/data/v1/get' +
    '?sortColumns=END_DATE,HOLDER_RANK&sortTypes=-1,1&pageSize=50&pageNumber=1' +
    '&reportName=RPT_F10_EH_FREEHOLDERS' +
    '&columns=ALL' +
    '&source=WEB&client=WEB' +
    '&filter=(SECURITY_CODE%3D%22' + code + '%22)(LISTING_STATE%3C%3E%2210%22)';

  return fetchWithTimeout(url, { cache: 'no-store' }, 6000).then(function(res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }).catch(function(fetchErr) {
    console.warn('国家队fetch失败，尝试JSONP:', fetchErr.message);
    return dcJsonp(url, 6000);
  }).then(function(data) {
    if (!data || !data.result || !data.result.data || data.result.data.length === 0) {
      return { list: [], hasData: false };
    }

    var allHolders = data.result.data;
    // 取最新报告期（END_DATE最大的）
    var latestDate = allHolders[0].END_DATE;
    var latestReportName = allHolders[0].REPORT_DATE_NAME || '';
    var holders = allHolders.filter(function(h) {
      return h.END_DATE === latestDate;
    });

    // 国家队关键词匹配规则
    var ntKeywords = [
      { keywords: ['中央汇金', '汇金资管', '汇金投资'], tag: 'huijin', label: '汇金' },
      { keywords: ['中国证券金融', '中证金融', '证金'], tag: 'zhengjin', label: '证金' },
      { keywords: ['全国社保', '社会保障基金', '社保基金'], tag: 'shebao', label: '社保' },
      { keywords: ['国家集成电路', '国家大基金', '国家制造业'], tag: 'dajijin', label: '大基金' },
      { keywords: ['梧桐树', '外汇管理局', '外管局'], tag: 'waiguan', label: '外管局' }
    ];

    function matchNationalTeam(holderName) {
      if (!holderName) return null;
      // 优先使用东方财富 HOLDER_NEWTYPE 字段
      // 然后通过名称关键词匹配（社保等东方财富未标注为国家队的机构）
      for (var i = 0; i < ntKeywords.length; i++) {
        for (var j = 0; j < ntKeywords[i].keywords.length; j++) {
          if (holderName.indexOf(ntKeywords[i].keywords[j]) >= 0) {
            return { tag: ntKeywords[i].tag, label: ntKeywords[i].label };
          }
        }
      }
      return null;
    }

    var ntList = [];
    holders.forEach(function(h) {
      var match = matchNationalTeam(h.HOLDER_NAME);
      // 双重判断：HOLDER_NEWTYPE="国家队" 或 名称关键词匹配
      if (match || h.HOLDER_NEWTYPE === '国家队') {
        if (!match) match = { tag: 'other', label: '国家队' };
        var holdNum = parseFloat(h.HOLD_NUM) || 0;
        var holdChange = parseFloat(h.HOLD_NUM_CHANGE) || 0;
        var changeState = h.HOLDER_STATE_NEW || h.HOLDNUM_CHANGE_NAME || '不变';

        ntList.push({
          name: h.HOLDER_NAME || '—',
          tag: match.tag,
          tagLabel: match.label,
          holdNum: holdNum,
          holdRatio: parseFloat(h.FREE_HOLDNUM_RATIO) || 0,    // 占流通股比例%
          totalRatio: parseFloat(h.HOLD_RATIO) || 0,             // 占总股本比例%
          holdChange: holdChange,
          changeState: changeState,
          marketCap: parseFloat(h.HOLDER_MARKET_CAP) || 0,       // 持有流通市值(元)
          rank: parseInt(h.HOLDER_RANK) || 0,
          reportDate: (latestDate || '').substring(0, 10),
          reportName: latestReportName
        });
      }
    });

    // 按持股数量降序排列
    ntList.sort(function(a, b) { return b.holdNum - a.holdNum; });

    return { list: ntList, hasData: ntList.length > 0, reportDate: (latestDate || '').substring(0, 10), reportName: latestReportName };
  }).catch(function(err) {
    console.warn('国家队持股数据获取失败:', err.message);
    return { list: [], hasData: false, error: err.message };
  });
}

/**
 * 获取龙虎榜活跃营业部明细（近三月该个股的上榜营业部统计）
 * 数据源：东方财富数据中心 RPT_BILLBOARD_OPERATEDEPT
 * @param {string} secCode - 纯数字代码
 * @param {string} tradeDate - 交易日期 YYYY-MM-DD（保留参数兼容，实际查询近三月聚合数据）
 * @returns {Promise} resolve({ buy: [...], sell: [...] })
 */
function fetchDragonTigerDetail(secCode, tradeDate) {
  var code = secCode.replace(/^(sh|sz|hk)/i, '');
  // RPT_BILLBOARD_OPERATEDEPT: 龙虎榜营业部统计，按SECURITY_CODE排序
  // STATISTICSCYCLE=02 表示近三月
  var url = 'https://datacenter-web.eastmoney.com/api/data/v1/get' +
    '?sortColumns=SECURITY_CODE,NET_BUY_AMT&sortTypes=1,-1&pageSize=50&pageNumber=1' +
    '&reportName=RPT_BILLBOARD_OPERATEDEPT' +
    '&columns=ALL' +
    '&source=WEB&client=WEB' +
    '&filter=(SECURITY_CODE%3D%22' + code + '%22)(STATISTICSCYCLE%3D%2202%22)';

  return fetchWithTimeout(url, { cache: 'no-store' }, 6000).then(function(res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }).catch(function() {
    return dcJsonp(url, 6000);
  }).then(function(data) {
    if (!data || !data.result || !data.result.data || data.result.data.length === 0) {
      return { buy: [], sell: [] };
    }

    var buy = [];
    var sell = [];
    var seenDepts = {}; // 按营业部代码去重
    data.result.data.forEach(function(item) {
      var deptCode = item.OPERATEDEPT_CODE || '';
      if (deptCode && seenDepts[deptCode]) return; // 跳过重复
      if (deptCode) seenDepts[deptCode] = true;

      var actBuy = parseFloat(item.ACT_BUY) || 0;
      var actSell = parseFloat(item.ACT_SELL) || 0;
      var netAmt = parseFloat(item.NET_BUY_AMT) || 0;
      var seat = {
        name: item.ORG_NAME_ABBR || item.ORG_NAME || '',
        fullName: item.ORG_NAME || '',
        buyAmt: actBuy,
        sellAmt: actSell,
        netAmt: netAmt,
        buyTimes: item.BUY_TIMES || 0,
        sellTimes: item.SELL_TIMES || 0,
        onlistTimes: item.ONLIST_TIMES || 0,
        side: ''
      };
      if (actBuy > 0) buy.push(seat);
      if (actSell > 0) sell.push(seat);
    });

    buy.sort(function(a, b) { return b.buyAmt - a.buyAmt; });
    sell.sort(function(a, b) { return b.sellAmt - a.sellAmt; });

    return { buy: buy.slice(0, 5), sell: sell.slice(0, 5) };
  }).catch(function() {
    return { buy: [], sell: [] };
  });
}



/**
 * 板块名称 → ETF代码映射（用于K线持续性信号获取）
 * push2delay返回的是板块代码(BKxxxx)，K线信号仍用对应ETF
 */
var SECTOR_ETF_MAP = {
  '银行': 'sh512800', '房地产': 'sh512200', '食品饮料': 'sh515170',
  '白酒': 'sh512690', '医药': 'sh512010', '新能源': 'sh516160',
  '军工': 'sh512660', '通信': 'sh515880', '半导体': 'sh512480',
  '证券': 'sh512000', '电子': 'sh159997', '计算机': 'sh512720',
  '电力': 'sz159611', '煤炭': 'sh515220', '有色金属': 'sh512400',
  '钢铁': 'sh515210', '家电': 'sh159996', '汽车': 'sh516110',
  '光伏设备': 'sh515790', '消费电子': 'sh159732', '游戏': 'sh516010',
  '保险': 'sh512070', '传媒': 'sh512980', '环保': 'sh512580',
  '建筑装饰': 'sh516750', '机械设备': 'sh516830', '公用事业': 'sh159825',
  '石油石化': 'sh516070', '基础化工': 'sh516020', '农林牧渔': 'sh516280',
  '锂电池': 'sh516150', '数字芯片设计': 'sh512480', '元件': 'sh159997',
  '电力设备': 'sz159611', '医疗器械': 'sh512170', '电池': 'sh516150',
  '化学制品': 'sh516020', '通用设备': 'sh516830', '专用设备': 'sh516830'
};

/* ============================================================
   市场情绪分析模块
   数据源：东方财富 clist + ZTPool/DTPool API
   指标：恐慌贪婪指数(0-100) + 涨跌比 + 涨停潮 + 量能
   ============================================================ */

/**
 * 获取最近交易日（YYYYMMDD格式）
 */
function getLastTradingDate() {
  var now = new Date();
  var day = now.getDay();
  var hour = now.getHours();
  var minute = now.getMinutes();
  var offset = 0;
  // 周末回退到周五
  if (day === 0) offset = -2;
  else if (day === 6) offset = -1;
  // 盘前（9:25前）使用前一交易日
  if (offset === 0 && day >= 1 && day <= 5) {
    var timeMinutes = hour * 60 + minute;
    if (timeMinutes < 565) { // 9:25前
      offset = day === 1 ? -3 : -1; // 周一盘前回退到上周五
    }
  }
  if (offset !== 0) now.setDate(now.getDate() + offset);
  var y = now.getFullYear();
  var m = ('0' + (now.getMonth() + 1)).slice(-2);
  var d = ('0' + now.getDate()).slice(-2);
  return '' + y + m + d;
}

/**
 * 获取全A股涨跌家数和成交额
 * 数据源：东方财富 clist API（一次拉取全部沪深A股）
 */
function fetchMarketBreadth() {
  // 多数据源容错：push2 主站不稳定时自动切换到 push2delay
  var BREADTH_HOSTS = [
    'https://push2delay.eastmoney.com',
    'https://push2.eastmoney.com'
  ];
  var API_PATH = '/api/qt/clist/get';
  // fs: m=0沪市 m=1深市; t=6主板 t=13A股 t=80A股(含科创板) t=81科创板 t=2深主板 t=12中小板 t=23创业板
  var commonParams = 'po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281' +
    '&fltt=2&invt=2&fid=f3' +
    '&fs=m:0+t:6,m:0+t:13,m:0+t:80,m:1+t:2,m:1+t:12,m:1+t:23' +
    '&fields=f2,f3,f5,f6,f12,f15,f16,f17,f18';
  var PAGE_SIZE = 100;   // 东方财富API硬限制每页最多返回100条，pz>100也只返回100
  var MAX_CONCURRENT = 6; // 增大并发以补偿更多分页请求（56页/6并发≈10轮）

  // 统计单页数据
  function countPage(stocks, agg) {
    for (var i = 0; i < stocks.length; i++) {
      var s = stocks[i];
      var chg = parseFloat(s.f3) || 0;
      var amt = parseFloat(s.f6) || 0;
      // 用最新价和涨跌幅判断涨停跌停，区分10%和20%涨跌幅板块
      // f15=最高价 f16=最低价 f17=今开 f18=昨收
      var prevClose = parseFloat(s.f18) || 0;
      var price = parseFloat(s.f2) || 0;
      if (chg > 0) agg.up++;
      else if (chg < 0) agg.down++;
      else agg.flat++;
      agg.totalAmount += amt;
      // 涨停判断：涨幅接近涨停板（10%板块用9.8%，20%板块用19.5%）
      if (prevClose > 0 && price > 0) {
        var actualChgPct = ((price - prevClose) / prevClose) * 100;
        // 20%涨跌幅板块：创业板(代码30开头)和科创板(代码68开头)
        var code = s.f12 || '';
        var is20PctBoard = code.indexOf('30') === 0 || code.indexOf('68') === 0;
        var limitThreshold = is20PctBoard ? 19.5 : 9.8;
        if (actualChgPct >= limitThreshold) agg.limitUpApprox++;
        else if (actualChgPct <= -limitThreshold) agg.limitDownApprox++;
      } else {
        // 无昨收价时回退到涨跌幅判断
        if (chg >= 9.8) agg.limitUpApprox++;
        else if (chg <= -9.8) agg.limitDownApprox++;
      }
    }
    agg.counted += stocks.length;
  }

  // 轻量级 fetch 获取单页（多host容错 + JSONP降级 + 单页重试）
  function fetchPage(pageNum, retryCount) {
    retryCount = retryCount || 0;
    var path = API_PATH + '?pn=' + pageNum + '&pz=' + PAGE_SIZE + '&' + commonParams;
    // 依次尝试各host，第一个成功即返回
    function tryHost(hostIdx) {
      if (hostIdx >= BREADTH_HOSTS.length) {
        // 所有host都失败，降级到JSONP（用第一个host）
        return emJsonp(BREADTH_HOSTS[0] + path, 8000);
      }
      var url = BREADTH_HOSTS[hostIdx] + path;
      return fetchWithTimeout(url, { cache: 'no-store' }, 8000)
        .then(function(res) { return res.json(); })
        .catch(function() { return tryHost(hostIdx + 1); });
    }
    return tryHost(0).catch(function() {
      // 全部host+JSONP都失败，重试一次
      if (retryCount < 1) {
        if(__DEBUG__)console.warn('[情绪] 第' + pageNum + '页获取失败，重试中...');
        return fetchPage(pageNum, retryCount + 1);
      }
      return null;
    });
  }

  // 并发限制器：最多 MAX_CONCURRENT 个同时执行
  function runWithConcurrency(tasks, limit) {
    var results = [];
    var index = 0;
    function next() {
      if (index >= tasks.length) return Promise.resolve();
      var i = index++;
      return tasks[i]().then(function(r) { results[i] = r; }).catch(function() {}).then(next);
    }
    var workers = [];
    for (var w = 0; w < Math.min(limit, tasks.length); w++) workers.push(next());
    return Promise.all(workers).then(function() { return results; });
  }

  // 第一步：获取第一页，拿到 total
  return fetchPage(1).then(function(firstResp) {
    if (!firstResp || !firstResp.data || !firstResp.data.diff) return null;

    var total = firstResp.data.total || 5500;
    var agg = { up: 0, down: 0, flat: 0, totalAmount: 0, limitUpApprox: 0, limitDownApprox: 0, counted: 0 };
    countPage(firstResp.data.diff, agg);

    var totalPages = Math.ceil(total / PAGE_SIZE);
    if (totalPages <= 1) {
      return finalizeBreadth(agg, total);
    }

    // 构建剩余页的任务函数（惰性执行，由并发限制器调度）
    var tasks = [];
    for (var p = 2; p <= totalPages; p++) {
      tasks.push((function(pageNum) {
        return function() {
          return fetchPage(pageNum).then(function(resp) {
            if (resp && resp.data && resp.data.diff) {
              countPage(resp.data.diff, agg);
            }
          });
        };
      })(p));
    }

    // 用并发限制器执行（最多 5 个并发，避免浏览器排队）
    return runWithConcurrency(tasks, MAX_CONCURRENT).then(function() {
      return finalizeBreadth(agg, total);
    });
  }).catch(function(err) {
    // 顶层catch：所有数据源都失败时返回null，避免reject导致Promise.all崩溃
    if(__DEBUG__)console.warn('fetchMarketBreadth 全部失败:', err.message);
    return null;
  });
}

/**
 * 汇总涨跌家数统计结果
 */
function finalizeBreadth(agg, total) {
  // 校验：实际统计数量是否接近API声称的总量
  if (agg.counted < total * 0.85) {
    if(__DEBUG__)console.warn('[情绪] 实际统计 ' + agg.counted + ' 只，API声称 ' + total + ' 只，数据可能不全');
  }
  // 涨跌比兜底：down=0时不返回99（误导性），改为用up/(1+flat*0.01)估算
  var advDeclineRatio;
  if (agg.down > 0) {
    advDeclineRatio = agg.up / agg.down;
  } else if (agg.up > 0) {
    // 极端情况：有涨无跌（数据不全的信号），用up估算但不显示99
    advDeclineRatio = agg.up;
  } else {
    advDeclineRatio = 1;
  }
  return {
    total: total,
    counted: agg.counted,
    up: agg.up,
    down: agg.down,
    flat: agg.flat,
    advDeclineRatio: advDeclineRatio,
    totalAmount: agg.totalAmount,
    limitUpApprox: agg.limitUpApprox,
    limitDownApprox: agg.limitDownApprox
  };
}

/**
 * 获取涨停股池（精确数据，含连板信息）
 * 数据源：东方财富 push2ex ZTPool
 * 改用fetch（API支持CORS），JSONP在某些浏览器环境会失败
 */
function fetchLimitUpPool() {
  var date = getLastTradingDate();
  var url = 'https://push2ex.eastmoney.com/getTopicZTPool' +
    '?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt' +
    '&Pageindex=0&pagesize=10000&sort=fbt:asc&date=' + date;

  return fetchWithTimeout(url, { cache: 'no-store' }, 8000).then(function(res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }).then(function(resp) {
    if (!resp || !resp.data || !resp.data.pool) return { count: 0, maxLbc: 0 };
    var pool = resp.data.pool;
    var maxLbc = 0;
    for (var i = 0; i < pool.length; i++) {
      var lbc = pool[i].lbc || 1;
      if (lbc > maxLbc) maxLbc = lbc;
    }
    return { count: pool.length, maxLbc: maxLbc };
  }).catch(function(err) {
    // fetch失败时降级到JSONP
    console.warn('涨停池fetch失败，降级JSONP:', err.message);
    return emJsonp(url, 8000).then(function(resp) {
      if (!resp || !resp.data || !resp.data.pool) return { count: 0, maxLbc: 0 };
      var pool = resp.data.pool;
      var maxLbc = 0;
      for (var i = 0; i < pool.length; i++) {
        var lbc = pool[i].lbc || 1;
        if (lbc > maxLbc) maxLbc = lbc;
      }
      return { count: pool.length, maxLbc: maxLbc };
    }).catch(function() {
      return { count: 0, maxLbc: 0 };
    });
  });
}

/**
 * 获取跌停股池
 * 数据源：东方财富 push2ex DTPool
 * 改用fetch（API支持CORS），JSONP在某些浏览器环境会失败
 */
function fetchLimitDownPool() {
  var date = getLastTradingDate();
  var url = 'https://push2ex.eastmoney.com/getTopicDTPool' +
    '?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt' +
    '&Pageindex=0&pagesize=10000&sort=fund:asc&date=' + date;

  return fetchWithTimeout(url, { cache: 'no-store' }, 8000).then(function(res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }).then(function(resp) {
    if (!resp || !resp.data || !resp.data.pool) return { count: 0 };
    return { count: resp.data.pool.length };
  }).catch(function(err) {
    // fetch失败时降级到JSONP
    console.warn('跌停池fetch失败，降级JSONP:', err.message);
    return emJsonp(url, 8000).then(function(resp) {
      if (!resp || !resp.data || !resp.data.pool) return { count: 0 };
      return { count: resp.data.pool.length };
    }).catch(function() {
      return { count: 0 };
    });
  });
}

/**
 * 获取沪深300近30日K线，计算市场动量
 * 返回：20日涨跌幅、5日涨跌幅、MA20偏离、近10日下跌天数
 */
function fetchIndexMomentum() {
  var url = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh000300,day,,,35,qfq';

  return fetchWithTimeout(url, { cache: 'no-store' }, 6000).then(function(res) {
    return res.json();
  }).then(function(resp) {
    if (!resp || resp.code !== 0 || !resp.data) return null;
    var sd = resp.data['sh000300'];
    var klines = sd.qfqday || sd.day;
    if (!klines || klines.length < 5) return null;

    var closes = klines.map(function(k) { return parseFloat(k[2]) || 0; });
    var n = closes.length;
    var latestClose = closes[n - 1];

    // 20日涨跌幅
    var close20ago = n >= 21 ? closes[n - 21] : closes[0];
    var ret20 = close20ago > 0 ? ((latestClose - close20ago) / close20ago) * 100 : 0;

    // 5日涨跌幅
    var close5ago = n >= 6 ? closes[n - 6] : closes[0];
    var ret5 = close5ago > 0 ? ((latestClose - close5ago) / close5ago) * 100 : 0;

    // MA20
    var ma20 = 0;
    if (n >= 20) {
      var sum = 0;
      for (var i = n - 20; i < n; i++) sum += closes[i];
      ma20 = sum / 20;
    } else {
      var sum2 = 0;
      for (var j = 0; j < n; j++) sum2 += closes[j];
      ma20 = sum2 / n;
    }
    var deviationMA20 = ma20 > 0 ? ((latestClose - ma20) / ma20) * 100 : 0;

    // 近10日下跌天数
    var downDays10 = 0;
    var startIdx = Math.max(1, n - 10);
    for (var d = startIdx; d < n; d++) {
      if (closes[d] < closes[d - 1]) downDays10++;
    }

    return {
      ret20: ret20,
      ret5: ret5,
      ma20: ma20,
      deviationMA20: deviationMA20,
      downDays10: downDays10,
      latestClose: latestClose
    };
  }).catch(function() {
    return null;
  });
}

/**
 * 综合获取市场情绪数据（带缓存）
 * 缓存策略：与行情一致，当天10:30后缓存有效
 */
var SENTIMENT_CACHE_KEY = 'sentiment_cache_v8';

/**
 * 获取近20日全市场成交量（用于量能动态对比）
 * 数据源：腾讯日K线API（CORS），取上证+深证成交量
 * 返回今日成交量、昨日成交量、近20日平均成交量（单位：手）
 */

/**
 * 判断当前市场时间状态
 * @returns {Object} { isTrading, isAfterClose, isBeforeOpen, elapsedMin, totalMin, projectionFactor }
 *   projectionFactor: 盘中量能折算系数（elapsedMin→240min的放大倍数），非盘中返回1
 */
function getMarketTimeInfo() {
  var now = new Date();
  var day = now.getDay();
  var isWeekday = day >= 1 && day <= 5;
  var minutes = now.getHours() * 60 + now.getMinutes();
  // 交易时段：9:30-11:30 (120min) + 13:00-15:00 (120min) = 240min
  var isTrading = isWeekday && (
    (minutes >= 570 && minutes < 690) ||  // 9:30-11:30
    (minutes >= 780 && minutes < 900)     // 13:00-15:00
  );
  var isAfterClose = isWeekday && minutes >= 900; // 15:00后
  var isBeforeOpen = !isAfterClose && (day === 0 || day === 6 || minutes < 570);
  // 盘中已过交易分钟数（用于折算全日预估量能）
  var elapsedMin = 0;
  if (isTrading) {
    if (minutes >= 570 && minutes < 690) {
      elapsedMin = minutes - 570; // 上午
    } else if (minutes >= 780 && minutes < 900) {
      elapsedMin = 120 + (minutes - 780); // 下午（含上午120分钟）
    }
  }
  var totalMin = 240;
  // 折算系数：将盘中部分成交量放大为全日预估量
  var projectionFactor = (isTrading && elapsedMin > 10) ? totalMin / elapsedMin : 1;
  return { isTrading: isTrading, isAfterClose: isAfterClose, isBeforeOpen: isBeforeOpen, elapsedMin: elapsedMin, totalMin: totalMin, projectionFactor: projectionFactor };
}

function fetchPrevDayVolume() {
  var indices = ['sh000001', 'sz399001'];
  function fetchIndexVolume(code) {
    // 拉取25个交易日，确保有足够数据计算20日均量
    var url = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=' + code + ',day,,,25,qfq';
    return fetchWithTimeout(url, { cache: 'no-store' }, 6000)
      .then(function(res) { return res.json(); })
      .then(function(resp) {
        if (!resp || resp.code !== 0 || !resp.data) return null;
        var sd = resp.data[code];
        var klines = sd.qfqday || sd.day;
        if (!klines || klines.length < 2) return null;
        // 腾讯K线格式：[日期, 开盘, 收盘, 最高, 最低, 成交量(手)]
        var vols = klines.map(function(k) { return parseFloat(k[5]) || 0; });
        var dates = klines.map(function(k) { return k[0]; });

        // 判断最新K线是否为今日，以及市场时间状态
        var mktInfo = getMarketTimeInfo();
        var now = new Date();
        var todayStr = now.getFullYear() + '-' +
          String(now.getMonth() + 1).padStart(2, '0') + '-' +
          String(now.getDate()).padStart(2, '0');
        var latestIsToday = dates[dates.length - 1] === todayStr;

        // 休市前（含周末/节假日）：最新K线为今日但有部分/零星成交量，需跳过使用前一完整交易日
        if (latestIsToday && mktInfo.isBeforeOpen) {
          vols = vols.slice(0, -1);
        }

        var todayVol = vols[vols.length - 1];
        var prevVol = vols[vols.length - 2] || vols[vols.length - 1];
        // 近20日平均成交量（不含今日）
        var histVols = vols.slice(Math.max(0, vols.length - 21), vols.length - 1);
        var avg20 = histVols.length > 0
          ? histVols.reduce(function(a, b) { return a + b; }, 0) / histVols.length
          : prevVol;
        // 近5日平均（用于短周期对比）
        var hist5 = vols.slice(Math.max(0, vols.length - 6), vols.length - 1);
        var avg5 = hist5.length > 0
          ? hist5.reduce(function(a, b) { return a + b; }, 0) / hist5.length
          : prevVol;
        return { todayVol: todayVol, prevVol: prevVol, avg20Vol: avg20, avg5Vol: avg5 };
      }).catch(function() { return null; });
  }

  return Promise.all(indices.map(function(code) { return fetchIndexVolume(code); }))
    .then(function(results) {
      var totalToday = 0, totalPrev = 0, totalAvg20 = 0, totalAvg5 = 0, hasData = false;
      results.forEach(function(r) {
        if (r) {
          totalToday += r.todayVol;
          totalPrev += r.prevVol;
          totalAvg20 += r.avg20Vol;
          totalAvg5 += r.avg5Vol;
          hasData = true;
        }
      });
      if (!hasData || totalPrev <= 0) return null;
      return {
        todayVolume: totalToday,
        prevVolume: totalPrev,
        avg20Volume: totalAvg20,
        avg5Volume: totalAvg5
      };
    });
}

function fetchMarketSentiment(forceRefresh) {
  // 检查缓存
  function needRefresh() {
    if (forceRefresh) return true;
    try {
      var raw = localStorage.getItem(SENTIMENT_CACHE_KEY);
      if (!raw) return true;
      var obj = JSON.parse(raw);
      var now = new Date();
      var nowTs = now.getTime();
      var today1030 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 30, 0).getTime();
      var today1505 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 15, 5, 0).getTime();

      // 判断是否在交易时段（周一至周五 9:25-15:05）
      var day = now.getDay();
      var isWeekday = day >= 1 && day <= 5;
      var minutes = now.getHours() * 60 + now.getMinutes();
      var isTradingHours = isWeekday && minutes >= 565 && minutes <= 905; // 9:25~15:05

      if (isTradingHours) {
        // 交易时段：每15分钟刷新一次
        return (nowTs - obj.ts) > 15 * 60 * 1000;
      }

      // 非交易时段
      if (nowTs >= today1505) {
        // 收盘后：使用收盘数据（15:05后获取的），如果缓存早于15:05则需刷新
        return obj.ts < today1505;
      }
      if (nowTs >= today1030) {
        // 10:30-15:05 之间但不在交易时段（如午休）：缓存必须在10:30后
        return obj.ts < today1030;
      }
      // 10:30之前：使用昨天的缓存
      var yesterday1030 = today1030 - 86400000;
      return obj.ts < yesterday1030;
    } catch(e) { return true; }
  }

  if (!needRefresh()) {
    try {
      var cached = JSON.parse(localStorage.getItem(SENTIMENT_CACHE_KEY));
      if (cached && cached.data) {
        if(__DEBUG__)console.log('使用情绪数据缓存（' + Math.round((Date.now() - cached.ts) / 60000) + '分钟前）');
        return Promise.resolve(cached.data);
      }
    } catch(e) {}
  }

  // 使用 allSettled 替代 all：单个子请求失败不影响整体，支持部分数据降级
  return Promise.allSettled([
    fetchMarketBreadth(),
    fetchLimitUpPool(),
    fetchLimitDownPool(),
    fetchIndexMomentum(),
    fetchPrevDayVolume()
  ]).then(function(results) {
    // allSettled: 每个 result 是 {status:'fulfilled', value:...} 或 {status:'rejected', reason:...}
    var breadth = results[0].status === 'fulfilled' ? results[0].value : null;
    var limitUp = results[1].status === 'fulfilled' ? results[1].value : { count: 0, maxLbc: 0 };
    var limitDown = results[2].status === 'fulfilled' ? results[2].value : { count: 0 };
    var momentum = results[3].status === 'fulfilled' ? results[3].value : null;
    var volCompare = results[4].status === 'fulfilled' ? results[4].value : null;

    if (!breadth) {
      if(__DEBUG__)console.warn('情绪数据核心来源(breadth)失败，无法计算');
      return null;
    }

    var finalLimitUp = limitUp.count > 0 ? limitUp.count : breadth.limitUpApprox;
    var finalLimitDown = limitDown.count > 0 ? limitDown.count : breadth.limitDownApprox;

    // 通过成交量比率估算昨日成交额（volCompare返回手数，totalAmount为元）
    var estimatedPrevAmount = 0;
    var estimatedAvg20Amount = 0;
    if (volCompare && volCompare.prevVolume > 0 && volCompare.todayVolume > 0 && breadth.totalAmount > 0) {
      // 盘中量能折算：将部分成交量放大为全日预估量，避免盘中volRatio偏低
      var mktInfo = getMarketTimeInfo();
      var projectedTodayVol = volCompare.todayVolume * mktInfo.projectionFactor;
      var volRatio = projectedTodayVol / volCompare.prevVolume;
      estimatedPrevAmount = breadth.totalAmount / volRatio;
      // 估算近20日平均成交额
      if (volCompare.avg20Volume > 0) {
        var avg20Ratio = projectedTodayVol / volCompare.avg20Volume;
        estimatedAvg20Amount = breadth.totalAmount / avg20Ratio;
      }
    }

    var data = {
      up: breadth.up,
      down: breadth.down,
      flat: breadth.flat,
      total: breadth.total,
      advDeclineRatio: breadth.advDeclineRatio,
      totalAmount: breadth.totalAmount,
      prevAmount: estimatedPrevAmount,
      avg20Amount: estimatedAvg20Amount,
      limitUp: finalLimitUp,
      limitDown: finalLimitDown,
      maxLbc: limitUp.maxLbc || 0,
      momentum: momentum
    };

    data.score = calculateSentimentScore(data);
    // 写入缓存
    try {
      localStorage.setItem(SENTIMENT_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: data }));
    } catch(e) {}
    return data;
  });
}

/**
 * 计算恐慌贪婪指数 (0-100)
 * 权重：市场动量(35%) + 涨跌比(30%) + 涨停潮(20%) + 量能(15%)
 * 动量权重降低，避免下跌趋势中的单日反弹被过度压制
 */
function calculateSentimentScore(data) {
  // ========== 1. 市场动量评分（35%）==========
  var momentumScore = 50; // 默认中性
  if (data.momentum) {
    var m = data.momentum;

    // 1a. 20日涨跌幅 → 核心趋势信号
    var ret20Score = 50 + m.ret20 * 5;
    ret20Score = Math.max(0, Math.min(100, ret20Score));

    // 1b. MA20偏离 → 趋势位置
    var devScore = 50 + m.deviationMA20 * 10;
    devScore = Math.max(0, Math.min(100, devScore));

    // 1c. 近10日下跌天数 → 持续性
    var downDaysScore = 100 - m.downDays10 * 10;

    // 1d. 5日涨跌幅 → 短期动能
    var ret5Score = 50 + m.ret5 * 8;
    ret5Score = Math.max(0, Math.min(100, ret5Score));

    // 加权：20日趋势(40%) + MA20偏离(25%) + 下跌天数(15%) + 5日动能(20%)
    momentumScore = ret20Score * 0.40 + devScore * 0.25 + downDaysScore * 0.15 + ret5Score * 0.20;
    momentumScore = Math.max(0, Math.min(100, momentumScore));
  }

  // ========== 2. 涨跌比评分（30%）==========
  var ratio = data.advDeclineRatio;
  var adScore;
  if (data.down === 0 && data.up > 0) {
    adScore = 100;
  } else if (data.up === 0 && data.down > 0) {
    adScore = 0;
  } else {
    adScore = 50 + (Math.log(ratio) / Math.log(3)) * 50;
    adScore = Math.max(0, Math.min(100, adScore));
  }

  // ========== 3. 涨停跌停比评分（20%）==========
  var limitScore;
  if (data.limitUp === 0 && data.limitDown === 0) {
    limitScore = 50;
  } else {
    limitScore = (data.limitUp / (data.limitUp + data.limitDown)) * 100;
  }
  if (data.limitUp >= 100) limitScore = Math.min(100, limitScore + 10);
  else if (data.limitUp >= 50) limitScore = Math.min(100, limitScore + 5);
  if (data.limitDown >= 50) limitScore = Math.max(0, limitScore - 15);
  else if (data.limitDown >= 20) limitScore = Math.max(0, limitScore - 8);

  // ========== 4. 市场量能评分（15%）==========
  // 动态基准：今日成交额 ÷ 近20日平均成交额 = 量比
  // 量比 >1.5 放量偏热，<0.7 缩量偏冷，避免固定阈值在不同市场阶段失真
  var amountYi = data.totalAmount / 1e8;
  var avg20Yi = data.avg20Amount ? data.avg20Amount / 1e8 : 0;
  var volRatio20 = avg20Yi > 0 ? amountYi / avg20Yi : 1;
  var volScore;
  if (volRatio20 >= 2.0) volScore = 92;        // 2倍以上均量 → 极度放量
  else if (volRatio20 >= 1.5) volScore = 80;   // 1.5倍 → 显著放量
  else if (volRatio20 >= 1.2) volScore = 68;   // 1.2倍 → 温和放量
  else if (volRatio20 >= 0.9) volScore = 55;   // 接近均量 → 中性
  else if (volRatio20 >= 0.7) volScore = 42;   // 0.7倍 → 温和缩量
  else if (volRatio20 >= 0.5) volScore = 30;   // 0.5倍 → 显著缩量
  else volScore = 20;                           // 低于0.5倍 → 极度缩量

  // ========== 综合加权 ==========
  // 动量(35%) + 涨跌比(30%) + 涨停潮(20%) + 量能(15%)
  var finalScore = momentumScore * 0.35 + adScore * 0.30 + limitScore * 0.20 + volScore * 0.15;

  // ========== 温和的趋势修正 ==========
  // 下跌趋势中的单日反弹适度下修（不再大幅压制）
  // 仅在20日跌幅超过-5%且今日涨跌比极高时才轻微下修
  if (data.momentum && data.momentum.ret20 < -5 && adScore > 70) {
    var penalty = (adScore - 60) * 0.12 * Math.min(1, Math.abs(data.momentum.ret20) / 10);
    finalScore -= penalty;
  }

  return Math.round(Math.max(0, Math.min(100, finalScore)));
}

/**
 * 获取情绪等级和信号文本
 */
function getSentimentLevel(score) {
  if (isNaN(score)) score = 0;
  if (score <= 20) {
    return {
      level: 'extreme-fear',
      cnLabel: '极度恐慌',
      signal: '市场恐慌情绪蔓延，连续下跌后大量个股杀跌。历史经验表明，极度恐慌往往是市场底部区域，可分批低吸优质标的。',
      action: '左侧布局·分批建仓'
    };
  } else if (score <= 40) {
    return {
      level: 'fear',
      cnLabel: '恐慌',
      signal: '市场情绪偏冷，近期趋势向下，下跌家数多于上涨。关注超跌板块和估值支撑位，等待企稳信号。',
      action: '观望为主·关注低吸'
    };
  } else if (score <= 60) {
    return {
      level: 'neutral',
      cnLabel: '中性',
      signal: '多空力量相对均衡，趋势不明朗。按既定策略操作，不宜追涨杀跌。',
      action: '中性区间·按策略操作'
    };
  } else if (score <= 80) {
    return {
      level: 'greed',
      cnLabel: '贪婪',
      signal: '市场情绪偏热，近期趋势向上，赚钱效应显现。但需注意控制仓位，避免追高。',
      action: '适度获利·控制仓位'
    };
  } else {
    return {
      level: 'extreme-greed',
      cnLabel: '极度贪婪',
      signal: '市场情绪亢奋，连续上涨后涨停潮涌现，量能放大。历史经验表明，极度贪婪时市场随时可能回调，注意锁定利润。',
      action: '逢高减仓·锁定利润'
    };
  }
}

/**
 * 渲染市场情绪面板
 */
function renderSentimentPanel(data) {
  var elValue = document.getElementById('sentGaugeValue');
  var elLabel = document.getElementById('sentGaugeLabel');
  var elArc = document.getElementById('sentGaugeArc3D');
  var elNeedle = document.getElementById('sentNeedle3D');
  var elGlow = document.getElementById('sentGaugeGlow');
  var elTooltip = document.getElementById('sentGaugeTooltip');
  var elPanel = document.getElementById('sentimentPanel');
  var elTag = document.getElementById('sentSignalTag');
  var elText = document.getElementById('sentSignalText');
  var elBar = document.getElementById('sentBarPointer');
  var elUpdate = document.getElementById('sentUpdateTime');
  var elMomentum = document.getElementById('sentMetricMomentum');
  var elAD = document.getElementById('sentMetricAD');
  var elLimit = document.getElementById('sentMetricLimit');
  var elVolume = document.getElementById('sentMetricVolume');

  if (!data) {
    if (elValue) elValue.textContent = '—';
    if (elLabel) elLabel.textContent = '数据获取失败';
    if (elTag) { elTag.textContent = '数据异常'; elTag.className = 'sentiment-signal-tag sent-bg-neutral'; }
    if (elText) elText.textContent = '情绪数据获取失败，请稍后刷新重试';
    if (elUpdate) elUpdate.textContent = '获取失败';
    if (elGlow) elGlow.classList.remove('active');
    if (elPanel) elPanel.classList.remove('greed-alert');
    return;
  }

  var level = getSentimentLevel(data.score);
  var colorClass = 'sent-' + level.level;
  var bgClass = 'sent-bg-' + level.level;
  var gaugeColor = _getSentimentGaugeColor(data.score);
  var score = isNaN(data.score) ? 0 : Math.max(0, Math.min(100, data.score));

  // 仪表盘数值（翻牌器动画）
  if (elValue) {
    var prevVal = parseInt(elValue.textContent) || 0;
    if (prevVal !== score) {
      _animateGaugeOdometer(elValue, prevVal, score, 1200);
    }
    elValue.style.color = gaugeColor;
  }
  if (elLabel) elLabel.textContent = level.cnLabel;

  // 仪表盘弧线动画 (339.3 ≈ 270度弧长)
  if (elArc) {
    var arcLen = 339.3;
    var offset = arcLen * (1 - score / 100);
    elArc.style.strokeDashoffset = offset;
  }

  // 指针旋转（阻尼过渡）
  if (elNeedle) {
    var rotation = -135 + (score / 100) * 270;
    elNeedle.style.transform = 'rotate(' + rotation + 'deg)';
  }

  // 呼吸光晕（极端状态激活）
  if (elGlow) {
    if (score <= 25 || score >= 75) {
      elGlow.style.background = 'radial-gradient(circle, ' + gaugeColor + '50, transparent 70%)';
      elGlow.classList.add('active');
    } else {
      elGlow.classList.remove('active');
      elGlow.style.background = '';
    }
  }

  // 背景联动（极度贪婪时泛红呼吸光）
  if (elPanel) {
    if (score >= 75) elPanel.classList.add('greed-alert');
    else elPanel.classList.remove('greed-alert');
  }

  // 悬停提示框
  if (elTooltip) {
    elTooltip.innerHTML = '<b style="color:' + gaugeColor + ';font-size:0.72rem">' + score + '</b> · ' + level.cnLabel +
      '<br><span style="color:var(--muted)">' + level.action + '</span>';
  }

  // 信号标签
  if (elTag) {
    elTag.textContent = level.cnLabel + ' · ' + level.action;
    elTag.className = 'sentiment-signal-tag ' + bgClass + ' ' + colorClass;
  }
  if (elText) elText.textContent = level.signal;

  // 情绪条指针
  if (elBar) elBar.style.left = score + '%';

  // 更新时间
  if (elUpdate) {
    var now = new Date();
    elUpdate.textContent = '更新于 ' + ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2);
  }

  // 市场动量（20日涨跌幅）
  if (elMomentum) {
    var moVal = elMomentum.querySelector('.sm-value');
    var moSub = elMomentum.querySelector('.sm-sub');
    if (moVal && data.momentum) {
      var ret20 = data.momentum.ret20;
      moVal.textContent = (ret20 >= 0 ? '+' : '') + ret20.toFixed(1) + '%';
      // 20日涨跌着色：跌→恐慌色(绿)，涨→贪婪色(红)
      if (ret20 < -5) moVal.className = 'sm-value sent-extreme-fear';
      else if (ret20 < 0) moVal.className = 'sm-value sent-fear';
      else if (ret20 < 5) moVal.className = 'sm-value sent-greed';
      else moVal.className = 'sm-value sent-extreme-greed';
    } else if (moVal) {
      moVal.textContent = '—';
    }
    if (moSub && data.momentum) {
      var parts = [];
      parts.push('偏离MA20 ' + (data.momentum.deviationMA20 >= 0 ? '+' : '') + data.momentum.deviationMA20.toFixed(1) + '%');
      parts.push('近10日跌' + data.momentum.downDays10 + '天');
      moSub.textContent = parts.join(' · ');
    }
  }

  // 涨跌比
  if (elAD) {
    var adVal = elAD.querySelector('.sm-value');
    var adSub = elAD.querySelector('.sm-sub');
    if (adVal) {
      adVal.textContent = data.advDeclineRatio >= 1
        ? data.advDeclineRatio.toFixed(2)
        : '1:' + (1 / data.advDeclineRatio).toFixed(2);
      adVal.className = 'sm-value ' + (data.up >= data.down ? colorClass : 'sent-extreme-fear');
    }
    if (adSub) adSub.textContent = data.up + '涨 / ' + data.down + '跌';
  }

  // 涨停跌停
  if (elLimit) {
    var limVal = elLimit.querySelector('.sm-value');
    var limSub = elLimit.querySelector('.sm-sub');
    if (limVal) {
      limVal.innerHTML = '<span style="color:#00C853">' + data.limitUp + '板</span> / <span style="color:#FF3B30">' + data.limitDown + '停</span>';
    }
    if (limSub) {
      limSub.textContent = data.maxLbc > 0 ? '最高' + data.maxLbc + '连板' : '无连板';
    }
  }

  // 市场量能
  if (elVolume) {
    var volVal = elVolume.querySelector('.sm-value');
    var volSub = elVolume.querySelector('.sm-sub');
    var amountYi = data.totalAmount / 1e8;
    var avg20Yi = data.avg20Amount ? data.avg20Amount / 1e8 : 0;
    var volRatio20 = avg20Yi > 0 ? amountYi / avg20Yi : 1;
    if (volVal) {
      if (amountYi >= 10000) {
        volVal.textContent = (amountYi / 10000).toFixed(2) + '万亿';
      } else {
        volVal.textContent = amountYi.toFixed(0) + '亿';
      }
      // 着色基于相对20日均量的量比，而非绝对数值
      if (volRatio20 >= 1.8) volVal.className = 'sm-value sent-extreme-greed';
      else if (volRatio20 >= 1.3) volVal.className = 'sm-value sent-greed';
      else if (volRatio20 <= 0.6) volVal.className = 'sm-value sent-extreme-fear';
      else if (volRatio20 <= 0.8) volVal.className = 'sm-value sent-fear';
      else volVal.className = 'sm-value';
    }
    // 与昨日对比 + 20日均量对比
    if (volSub) {
      var subParts = [];
      // 昨日对比
      if (data.prevAmount && data.prevAmount > 0) {
        var prevYi = data.prevAmount / 1e8;
        var changePct = ((data.totalAmount - data.prevAmount) / data.prevAmount) * 100;
        var dirText, dirColor;
        if (changePct > 10) {
          dirText = '显著放量'; dirColor = 'var(--neon-red)';
        } else if (changePct > 0) {
          dirText = '放量'; dirColor = 'var(--neon-red)';
        } else if (changePct > -10) {
          dirText = '缩量'; dirColor = 'var(--neon-green)';
        } else {
          dirText = '显著缩量'; dirColor = 'var(--neon-green)';
        }
        var arrow = changePct >= 0 ? '↑' : '↓';
        var prevText = prevYi >= 10000 ? (prevYi / 10000).toFixed(2) + '万亿' : prevYi.toFixed(0) + '亿';
        subParts.push(arrow + ' ' + dirText + ' <span style="color:' + dirColor + ';font-weight:700">' +
          (changePct >= 0 ? '+' : '') + changePct.toFixed(1) + '%</span> · 昨' + prevText);
      }
      // 20日均量对比
      if (avg20Yi > 0) {
        var avg20Text = avg20Yi >= 10000 ? (avg20Yi / 10000).toFixed(2) + '万亿' : avg20Yi.toFixed(0) + '亿';
        var ratioPct = (volRatio20 - 1) * 100;
        var ratioText, ratioColor;
        if (volRatio20 >= 1.5) {
          ratioText = '显著放量'; ratioColor = 'var(--neon-red)';
        } else if (volRatio20 >= 1.1) {
          ratioText = '放量'; ratioColor = 'var(--neon-red)';
        } else if (volRatio20 >= 0.9) {
          ratioText = '持平'; ratioColor = 'var(--muted)';
        } else if (volRatio20 >= 0.7) {
          ratioText = '缩量'; ratioColor = 'var(--neon-green)';
        } else {
          ratioText = '显著缩量'; ratioColor = 'var(--neon-green)';
        }
        subParts.push('vs20日均量 <span style="color:' + ratioColor + ';font-weight:700">' +
          ratioText + (ratioPct >= 0 ? '+' : '') + ratioPct.toFixed(0) + '%</span>（' + avg20Text + '）');
      }
      volSub.innerHTML = subParts.length > 0 ? subParts.join(' · ') : '全市场成交额';
    }
  }
}

/**
 * 获取情绪仪表盘颜色（A股渐变色谱）
 * 0-25: 幽暗冰蓝→荧光绿 | 25-50: 荧光绿→警示橙 | 50-75: 警示橙→沸腾红 | 75-100: 沸腾红→霓虹紫
 */
function _getSentimentGaugeColor(score) {
  // 与 getSentimentLevel 断点对齐：20/40/60/80
  if (isNaN(score) || score < 0) return '#0a4d6c';  // 异常值→冰蓝
  if (score <= 20) return '#00d4ff';   // 极度恐慌→冰蓝
  if (score <= 40) return '#00ff88';   // 恐慌→荧光绿
  if (score <= 60) return '#ff8c00';   // 中性→警示橙
  if (score <= 80) return '#ff3366';   // 贪婪→沸腾红
  return '#bb00ff';                     // 极度贪婪→霓虹紫
}

/**
 * 翻牌器数字动画（ease-out cubic 缓动）
 * 带NaN守卫 + 在途rAF取消
 */
var _gaugeOdometerRaf = null;
function _animateGaugeOdometer(el, fromVal, toVal, duration) {
  if (!el) return;
  // NaN 守卫
  if (isNaN(toVal) || isNaN(fromVal)) {
    el.textContent = isNaN(toVal) ? '—' : toVal;
    return;
  }
  // 取消上一次未完成的动画
  if (_gaugeOdometerRaf) cancelAnimationFrame(_gaugeOdometerRaf);
  var start = performance.now();
  var diff = toVal - fromVal;
  function step(now) {
    var elapsed = now - start;
    var progress = Math.min(elapsed / duration, 1);
    var eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(fromVal + diff * eased);
    if (progress < 1) {
      _gaugeOdometerRaf = requestAnimationFrame(step);
    } else {
      el.textContent = toVal;
      _gaugeOdometerRaf = null;
    }
  }
  _gaugeOdometerRaf = requestAnimationFrame(step);
}

/* ============================================================
   预警信号系统
   基于A股历史情绪周期与转折点数据，设置多维度预警阈值
   数据来源：2008/2013/2015/2018/2020/2024年历史大底大顶统计
   预警类型：底部预警 / 顶部预警 / 趋势反转预警 / 量价背离预警
   预测模型：基于历史情绪数据的线性回归预测
   ============================================================ */

/**
 * 情绪历史数据存储与回归预测
 * localStorage key: sentiment_history_v1
 * 每次获取情绪数据时自动记录，保留最近90条（约15天，每天6次）
 */
var SENTIMENT_HISTORY_KEY = 'sentiment_history_v1';
var SENTIMENT_HISTORY_MAX = 90; // 最多保留90条历史记录

/**
 * 记录情绪数据到历史序列
 * @param {Object} data - 情绪数据对象
 */
function recordSentimentHistory(data) {
  if (!data || data.score === undefined) return;
  try {
    var history = [];
    var raw = localStorage.getItem(SENTIMENT_HISTORY_KEY);
    if (raw) history = JSON.parse(raw);
    // 添加新记录
    var record = {
      ts: Date.now(),
      score: data.score,
      totalAmount: data.totalAmount || 0,
      limitUp: data.limitUp || 0,
      limitDown: data.limitDown || 0,
      advDeclineRatio: data.advDeclineRatio || 1,
      ret5: (data.momentum && data.momentum.ret5) || 0,
      ret20: (data.momentum && data.momentum.ret20) || 0,
      deviationMA20: (data.momentum && data.momentum.deviationMA20) || 0
    };
    // 去重：同一时间戳不重复记录
    if (history.length > 0 && history[history.length - 1].ts === record.ts) return;
    history.push(record);
    // 保留最近N条
    if (history.length > SENTIMENT_HISTORY_MAX) {
      history = history.slice(history.length - SENTIMENT_HISTORY_MAX);
    }
    localStorage.setItem(SENTIMENT_HISTORY_KEY, JSON.stringify(history));
  } catch(e) {
    if (__DEBUG__) console.warn('情绪历史记录失败:', e);
  }
}

/**
 * 线性回归预测：基于历史情绪数据预测未来趋势
 * 使用最小二乘法拟合情绪指数的线性趋势
 * @returns {Object|null} 预测结果 { slope, intercept, predicted, trend, confidence, sampleSize }
 */
function predictSentimentTrend() {
  try {
    var raw = localStorage.getItem(SENTIMENT_HISTORY_KEY);
    if (!raw) return null;
    var history = JSON.parse(raw);
    if (!history || history.length < 5) return null; // 至少需要5个数据点

    // 取最近30条数据进行回归（约5天）
    var recent = history.slice(Math.max(0, history.length - 30));
    var n = recent.length;
    if (n < 5) return null;

    // 最小二乘法线性回归: y = slope * x + intercept
    // x = 时间索引(0, 1, 2, ...), y = 情绪指数
    var sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (var i = 0; i < n; i++) {
      var x = i;
      var y = recent[i].score;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumXX += x * x;
    }
    var denom = n * sumXX - sumX * sumX;
    if (Math.abs(denom) < 1e-10) return null; // 避免除零
    var slope = (n * sumXY - sumX * sumY) / denom;
    var intercept = (sumY - slope * sumX) / n;

    // 计算R²（决定系数）评估拟合质量
    var meanY = sumY / n;
    var ssRes = 0, ssTot = 0;
    for (var j = 0; j < n; j++) {
      var predicted = slope * j + intercept;
      ssRes += Math.pow(recent[j].score - predicted, 2);
      ssTot += Math.pow(recent[j].score - meanY, 2);
    }
    var rSquared = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;

    // 预测未来3个周期后的情绪指数
    var predictedScore = Math.max(0, Math.min(100, slope * (n + 2) + intercept));

    // 趋势方向判断
    var trend;
    if (slope > 0.8) trend = 'strong_up';
    else if (slope > 0.3) trend = 'up';
    else if (slope < -0.8) trend = 'strong_down';
    else if (slope < -0.3) trend = 'down';
    else trend = 'stable';

    // 置信度：基于R²和样本量
    var confidence = Math.round(rSquared * 3);
    if (n >= 20) confidence = Math.min(3, confidence + 1);
    if (n < 10) confidence = Math.max(0, confidence - 1);

    return {
      slope: roundPrecise(slope, 4),
      intercept: roundPrecise(intercept, 2),
      predicted: Math.round(predictedScore),
      trend: trend,
      rSquared: roundPrecise(rSquared, 3),
      confidence: confidence,
      sampleSize: n,
      currentScore: recent[recent.length - 1].score
    };
  } catch(e) {
    if (__DEBUG__) console.warn('情绪趋势预测失败:', e);
    return null;
  }
}

/**
 * 基于回归预测生成预警信号
 * @returns {Object|null} 预测预警信号
 */
function generatePredictionWarning() {
  var pred = predictSentimentTrend();
  if (!pred || pred.confidence === 0) return null;

  var trendLabel = {
    'strong_up': '强势上升',
    'up': '上升',
    'stable': '震荡',
    'down': '下降',
    'strong_down': '强势下降'
  };

  // 预测到达极端区域的预警
  if (pred.predicted >= 80 && pred.trend !== 'down' && pred.trend !== 'strong_down') {
    return {
      type: 'prediction_top',
      level: pred.predicted >= 88 ? 'high' : 'medium',
      confidence: pred.confidence,
      icon: '◈',
      label: '趋势预测·顶部风险',
      message: '基于近' + pred.sampleSize + '次情绪数据的线性回归分析，市场情绪指数呈' + trendLabel[pred.trend] + '趋势（斜率' + pred.slope + '/周期），预测短期内情绪指数将达' + pred.predicted + '，接近历史顶部区域。拟合优度R²=' + pred.rSquared + '。建议提前做好减仓准备。',
      detail: '当前' + pred.currentScore + ' → 预测' + pred.predicted + ' · 趋势斜率' + pred.slope + ' · R²=' + pred.rSquared + ' · 样本' + pred.sampleSize,
      cssClass: 'warn-prediction'
    };
  }

  if (pred.predicted <= 20 && pred.trend !== 'up' && pred.trend !== 'strong_up') {
    return {
      type: 'prediction_bottom',
      level: pred.predicted <= 12 ? 'high' : 'medium',
      confidence: pred.confidence,
      icon: '◈',
      label: '趋势预测·底部机会',
      message: '基于近' + pred.sampleSize + '次情绪数据的线性回归分析，市场情绪指数呈' + trendLabel[pred.trend] + '趋势（斜率' + pred.slope + '/周期），预测短期内情绪指数将降至' + pred.predicted + '，接近历史底部区域。拟合优度R²=' + pred.rSquared + '。建议关注左侧建仓机会。',
      detail: '当前' + pred.currentScore + ' → 预测' + pred.predicted + ' · 趋势斜率' + pred.slope + ' · R²=' + pred.rSquared + ' · 样本' + pred.sampleSize,
      cssClass: 'warn-prediction'
    };
  }

  // 趋势加速预警
  if (pred.trend === 'strong_down' && pred.confidence >= 2) {
    return {
      type: 'prediction_acceleration',
      level: 'medium',
      confidence: pred.confidence,
      icon: '◈',
      label: '趋势预测·下行加速',
      message: '回归模型检测到情绪指数下行加速（斜率' + pred.slope + '/周期），短期内可能继续下行至' + pred.predicted + '。拟合优度R²=' + pred.rSquared + '，趋势可信度较高。建议控制仓位、等待企稳信号。',
      detail: '当前' + pred.currentScore + ' → 预测' + pred.predicted + ' · 斜率' + pred.slope + ' · R²=' + pred.rSquared,
      cssClass: 'warn-prediction'
    };
  }

  if (pred.trend === 'strong_up' && pred.confidence >= 2) {
    return {
      type: 'prediction_acceleration',
      level: 'low',
      confidence: pred.confidence,
      icon: '◈',
      label: '趋势预测·上行加速',
      message: '回归模型检测到情绪指数上行加速（斜率' + pred.slope + '/周期），短期内可能继续上行至' + pred.predicted + '。拟合优度R²=' + pred.rSquared + '。市场情绪向好，但仍需关注是否过热。',
      detail: '当前' + pred.currentScore + ' → 预测' + pred.predicted + ' · 斜率' + pred.slope + ' · R²=' + pred.rSquared,
      cssClass: 'warn-prediction'
    };
  }

  return null;
}

/**
 * A股历史情绪阈值参数表
 * 数据来源：历年极端行情统计（2008金融危机、2015杠杆牛/股灾、2018贸易战底、2020疫情底、2024春节底等）
 */
var SENTIMENT_THRESHOLDS = {
  // === 底部预警阈值（历史大底区域） ===
  bottom: {
    // 恐慌贪婪指数 ≤15 为历史极端底部区域（2008.10=8, 2015.9=12, 2018.12=14, 2024.2=11）
    scoreExtreme: 15,
    scoreHigh: 25,
    // 沪深300 20日跌幅 ≤-12% 为急跌见底信号（2015.8: -18%, 2018.10: -14%, 2024.2: -11%）
    ret20Extreme: -12,
    ret20High: -8,
    // 跌停潮 ≥80家为恐慌出清（2015.8: 2000+跌停, 2024.2: 300+跌停, 2018.10: 100+跌停）
    limitDownExtreme: 100,
    limitDownHigh: 50,
    // 涨跌比 <0.25 为极度失衡（普跌行情）
    adRatioExtreme: 0.25,
    adRatioHigh: 0.4,
    // 地量成交 <5000亿为地量见地价（2018: 2500亿, 2020: 4800亿）
    amountExtreme: 5000,
    amountHigh: 6500,
    // 连续下跌天数 ≥8天
    downDaysExtreme: 8,
    downDaysHigh: 6
  },
  // === 顶部预警阈值（历史大顶区域） ===
  top: {
    // 恐慌贪婪指数 ≥88 为历史极端顶部区域（2007.10=95, 2015.6=92, 2021.2=88）
    scoreExtreme: 88,
    scoreHigh: 78,
    // 沪深300 20日涨幅 ≥12% 为急涨见顶信号（2015.5: +22%, 2007.9: +18%）
    ret20Extreme: 12,
    ret20High: 8,
    // 涨停潮 ≥120家为过热（2015.5: 400+涨停, 2007.9: 200+涨停）
    limitUpExtreme: 120,
    limitUpHigh: 80,
    // 涨跌比 >4 为普涨过热
    adRatioExtreme: 4,
    adRatioHigh: 2.5,
    // 天量成交 >18000亿为天量见天价（2015.5: 22000亿, 2020.7: 17000亿, 2024.10: 23000亿）
    amountExtreme: 18000,
    amountHigh: 14000,
    // 妖股疯狂 最高连板 ≥7
    maxLbcExtreme: 7,
    maxLbcHigh: 5
  }
};

/**
 * 检测预警信号
 * @param {Object} data - 市场情绪数据（fetchMarketSentiment返回值）
 * @returns {Array} 预警信号列表
 */
function checkEarlyWarnings(data) {
  if (!data) return [];

  var warnings = [];
  var score = data.score || 50;
  var amountYi = data.totalAmount / 1e8;
  var avg20Yi = data.avg20Amount ? data.avg20Amount / 1e8 : 0;
  var volRatio20 = avg20Yi > 0 ? amountYi / avg20Yi : 1; // 量比（今日/20日均量）
  var m = data.momentum || {};
  var ret20 = m.ret20 || 0;
  var ret5 = m.ret5 || 0;
  var downDays = m.downDays10 || 0;
  var deviation = m.deviationMA20 || 0;

  // ==================== 底部预警 ====================
  var bottomScore = 0; // 命中维度计数
  var bottomDetails = [];

  // 维度1：恐慌贪婪指数极低
  if (score <= SENTIMENT_THRESHOLDS.bottom.scoreExtreme) {
    bottomScore += 3;
    bottomDetails.push('情绪指数' + score + '≤' + SENTIMENT_THRESHOLDS.bottom.scoreExtreme + '（历史极端底部）');
  } else if (score <= SENTIMENT_THRESHOLDS.bottom.scoreHigh) {
    bottomScore += 2;
    bottomDetails.push('情绪指数' + score + '≤' + SENTIMENT_THRESHOLDS.bottom.scoreHigh);
  }

  // 维度2：20日跌幅较大
  if (ret20 <= SENTIMENT_THRESHOLDS.bottom.ret20Extreme) {
    bottomScore += 3;
    bottomDetails.push('沪深300 20日跌' + ret20.toFixed(1) + '%（急跌）');
  } else if (ret20 <= SENTIMENT_THRESHOLDS.bottom.ret20High) {
    bottomScore += 2;
    bottomDetails.push('沪深300 20日跌' + ret20.toFixed(1) + '%');
  }

  // 维度3：跌停潮
  if (data.limitDown >= SENTIMENT_THRESHOLDS.bottom.limitDownExtreme) {
    bottomScore += 3;
    bottomDetails.push('跌停' + data.limitDown + '家（恐慌出清）');
  } else if (data.limitDown >= SENTIMENT_THRESHOLDS.bottom.limitDownHigh) {
    bottomScore += 2;
    bottomDetails.push('跌停' + data.limitDown + '家');
  }

  // 维度4：涨跌比极度失衡
  var adRatio = data.advDeclineRatio;
  if (adRatio < SENTIMENT_THRESHOLDS.bottom.adRatioExtreme) {
    bottomScore += 2;
    bottomDetails.push('涨跌比1:' + (1/adRatio).toFixed(1) + '（普跌）');
  } else if (adRatio < SENTIMENT_THRESHOLDS.bottom.adRatioHigh) {
    bottomScore += 1;
    bottomDetails.push('涨跌比1:' + (1/adRatio).toFixed(1));
  }

  // 维度5：地量（相对近20日均量判断，而非固定数值）
  if (volRatio20 <= 0.5) {
    bottomScore += 3;
    bottomDetails.push('成交' + amountYi.toFixed(0) + '亿，仅为20日均量的' + (volRatio20*100).toFixed(0) + '%（极度地量）');
  } else if (volRatio20 <= 0.7) {
    bottomScore += 2;
    bottomDetails.push('成交' + amountYi.toFixed(0) + '亿，为20日均量的' + (volRatio20*100).toFixed(0) + '%（地量）');
  } else if (volRatio20 <= 0.85) {
    bottomScore += 1;
    bottomDetails.push('成交' + amountYi.toFixed(0) + '亿，为20日均量的' + (volRatio20*100).toFixed(0) + '%（偏低）');
  }

  // 维度6：连续下跌
  if (downDays >= SENTIMENT_THRESHOLDS.bottom.downDaysExtreme) {
    bottomScore += 2;
    bottomDetails.push('近10日跌' + downDays + '天');
  } else if (downDays >= SENTIMENT_THRESHOLDS.bottom.downDaysHigh) {
    bottomScore += 1;
    bottomDetails.push('近10日跌' + downDays + '天');
  }

  if (bottomScore >= 5) {
    var bLevel = bottomScore >= 9 ? 'extreme' : bottomScore >= 7 ? 'high' : 'medium';
    var bConfidence = bottomScore >= 9 ? 3 : bottomScore >= 7 ? 2 : 1;
    var bMsg = bLevel === 'extreme'
      ? '多重底部信号共振，历史同类情形出现在2008年10月、2015年8月、2018年12月、2024年2月等重大底部，后续均出现显著反弹。建议分批左侧建仓。'
      : bLevel === 'high'
      ? '多个底部维度触发，市场处于超卖区域。历史数据显示此区间大概率接近阶段性底部，可考虑逢低布局。'
      : '部分底部信号出现，市场情绪偏冷，关注后续是否进一步恶化或出现企稳信号。';
    warnings.push({
      type: 'bottom',
      level: bLevel,
      confidence: bConfidence,
      icon: '▲',
      label: '底部预警',
      message: bMsg,
      detail: bottomDetails.join('；'),
      cssClass: 'warn-bottom'
    });
  }

  // ==================== 顶部预警 ====================
  var topScore = 0;
  var topDetails = [];

  // 维度1：恐慌贪婪指数极高
  if (score >= SENTIMENT_THRESHOLDS.top.scoreExtreme) {
    topScore += 3;
    topDetails.push('情绪指数' + score + '≥' + SENTIMENT_THRESHOLDS.top.scoreExtreme + '（历史极端顶部）');
  } else if (score >= SENTIMENT_THRESHOLDS.top.scoreHigh) {
    topScore += 2;
    topDetails.push('情绪指数' + score + '≥' + SENTIMENT_THRESHOLDS.top.scoreHigh);
  }

  // 维度2：20日涨幅较大
  if (ret20 >= SENTIMENT_THRESHOLDS.top.ret20Extreme) {
    topScore += 3;
    topDetails.push('沪深300 20日涨' + ret20.toFixed(1) + '%（急涨）');
  } else if (ret20 >= SENTIMENT_THRESHOLDS.top.ret20High) {
    topScore += 2;
    topDetails.push('沪深300 20日涨' + ret20.toFixed(1) + '%');
  }

  // 维度3：涨停潮过热
  if (data.limitUp >= SENTIMENT_THRESHOLDS.top.limitUpExtreme) {
    topScore += 3;
    topDetails.push('涨停' + data.limitUp + '家（过热）');
  } else if (data.limitUp >= SENTIMENT_THRESHOLDS.top.limitUpHigh) {
    topScore += 2;
    topDetails.push('涨停' + data.limitUp + '家');
  }

  // 维度4：涨跌比极高（普涨过热）
  if (adRatio >= SENTIMENT_THRESHOLDS.top.adRatioExtreme) {
    topScore += 2;
    topDetails.push('涨跌比' + adRatio.toFixed(1) + '（普涨过热）');
  } else if (adRatio >= SENTIMENT_THRESHOLDS.top.adRatioHigh) {
    topScore += 1;
    topDetails.push('涨跌比' + adRatio.toFixed(1));
  }

  // 维度5：天量（相对近20日均量判断，而非固定数值）
  if (volRatio20 >= 2.0) {
    topScore += 3;
    topDetails.push('成交' + (amountYi/10000).toFixed(1) + '万亿，为20日均量的' + volRatio20.toFixed(1) + '倍（天量）');
  } else if (volRatio20 >= 1.5) {
    topScore += 2;
    topDetails.push('成交' + (amountYi/10000).toFixed(1) + '万亿，为20日均量的' + volRatio20.toFixed(1) + '倍（放量）');
  } else if (volRatio20 >= 1.3) {
    topScore += 1;
    topDetails.push('成交' + amountYi.toFixed(0) + '亿，为20日均量的' + volRatio20.toFixed(1) + '倍');
  }

  // 维度6：妖股疯狂
  if (data.maxLbc >= SENTIMENT_THRESHOLDS.top.maxLbcExtreme) {
    topScore += 2;
    topDetails.push('最高' + data.maxLbc + '连板（妖股疯狂）');
  } else if (data.maxLbc >= SENTIMENT_THRESHOLDS.top.maxLbcHigh) {
    topScore += 1;
    topDetails.push('最高' + data.maxLbc + '连板');
  }

  if (topScore >= 5) {
    var tLevel = topScore >= 9 ? 'extreme' : topScore >= 7 ? 'high' : 'medium';
    var tConfidence = topScore >= 9 ? 3 : topScore >= 7 ? 2 : 1;
    var tMsg = tLevel === 'extreme'
      ? '多重顶部信号共振，历史同类情形出现在2007年10月、2015年6月、2021年2月等重大顶部，后续均出现大幅回调。建议果断减仓、锁定利润。'
      : tLevel === 'high'
      ? '多个顶部维度触发，市场处于过热区域。历史数据显示此区间随时可能出现回调，注意控制仓位、逐步止盈。'
      : '部分顶部信号出现，市场情绪偏热，关注后续是否进一步升温或出现滞涨信号。';
    warnings.push({
      type: 'top',
      level: tLevel,
      confidence: tConfidence,
      icon: '▼',
      label: '顶部预警',
      message: tMsg,
      detail: topDetails.join('；'),
      cssClass: 'warn-top'
    });
  }

  // ==================== 趋势反转预警 ====================
  // 短期与中期趋势背离
  if (Math.abs(ret5) > 3 && Math.sign(ret5) !== Math.sign(ret20) && Math.abs(ret20) > 3) {
    var reversalMsg;
    if (ret5 > 0 && ret20 < 0) {
      reversalMsg = '下跌趋势中出现短期反弹，可能为趋势反转信号。若后续量能配合，可能迎来阶段性反弹；若无量配合则为反弹陷阱。';
    } else {
      reversalMsg = '上涨趋势中出现短期回调，可能为趋势反转信号。若后续跌破关键支撑，可能迎来阶段性调整；若快速收复则为洗盘。';
    }
    warnings.push({
      type: 'reversal',
      level: 'medium',
      confidence: 2,
      icon: '⇄',
      label: '趋势反转预警',
      message: reversalMsg,
      detail: '5日' + (ret5 >= 0 ? '+' : '') + ret5.toFixed(1) + '% vs 20日' + (ret20 >= 0 ? '+' : '') + ret20.toFixed(1) + '%（方向背离）',
      cssClass: 'warn-reversal'
    });
  }

  // MA20偏离过大 + 反向动量
  if (Math.abs(deviation) > 7) {
    if (deviation < -7 && ret5 > 0) {
      warnings.push({
        type: 'reversal',
        level: 'low',
        confidence: 1,
        icon: '⇄',
        label: '超跌反弹信号',
        message: '沪深300偏离MA20达' + deviation.toFixed(1) + '%，严重超卖后出现短期反弹。历史数据显示，偏离MA20超过-7%后反弹概率较高，但需确认量能配合。',
        detail: '偏离MA20 ' + deviation.toFixed(1) + '% · 5日' + (ret5 >= 0 ? '+' : '') + ret5.toFixed(1) + '%',
        cssClass: 'warn-reversal'
      });
    } else if (deviation > 7 && ret5 < 0) {
      warnings.push({
        type: 'reversal',
        level: 'low',
        confidence: 1,
        icon: '⇄',
        label: '超涨回调信号',
        message: '沪深300偏离MA20达+' + deviation.toFixed(1) + '%，严重超涨后出现短期回调。历史数据显示，偏离MA20超过+7%后回调概率较高，注意锁定利润。',
        detail: '偏离MA20 +' + deviation.toFixed(1) + '% · 5日' + (ret5 >= 0 ? '+' : '') + ret5.toFixed(1) + '%',
        cssClass: 'warn-reversal'
      });
    }
  }

  // ==================== 量价背离预警 ====================
  // 指数上涨但量能相对20日均量萎缩（量价背离）
  if (ret5 > 2 && volRatio20 < 0.7 && amountYi > 0) {
    warnings.push({
      type: 'volume',
      level: 'low',
      confidence: 1,
      icon: '◇',
      label: '量价背离预警',
      message: '指数短期上涨但成交额仅' + amountYi.toFixed(0) + '亿，为20日均量的' + (volRatio20*100).toFixed(0) + '%，量能不足。无量上涨难以持续，若后续不能放量则可能回落。',
      detail: '5日涨' + ret5.toFixed(1) + '% · 成交' + amountYi.toFixed(0) + '亿 · 量比' + volRatio20.toFixed(2),
      cssClass: 'warn-volume'
    });
  }

  // ==================== 回归预测预警 ====================
  var predWarning = generatePredictionWarning();
  if (predWarning) warnings.push(predWarning);

  // 按预警严重程度排序：extreme > high > medium > low
  var levelOrder = { extreme: 0, high: 1, medium: 2, low: 3 };
  warnings.sort(function(a, b) {
    return levelOrder[a.level] - levelOrder[b.level];
  });

  return warnings;
}

/**
 * 渲染预警信号面板
 */
function renderEarlyWarnings(data) {
  var container = document.getElementById('sentWarnings');
  if (!container) return;

  var warnings = checkEarlyWarnings(data);

  // 获取预测信息用于标题展示
  var pred = predictSentimentTrend();

  if (warnings.length === 0) {
    var levelText = '';
    if (data) {
      var s = data.score || 50;
      if (s <= 40) levelText = '市场处于恐慌区间但未触发极端底部信号，暂无预警';
      else if (s >= 60) levelText = '市场情绪偏暖但未触发极端顶部信号，暂无预警';
      else levelText = '市场情绪处于中性区间，各项指标正常，暂无预警';
    } else {
      levelText = '情绪数据获取失败，无法生成预警';
    }
    container.innerHTML =
      '<div class="sentiment-warnings-title">预警信号 · 基于历史情绪阈值 + 回归预测模型</div>' +
      '<div class="warning-safe">' + levelText + '</div>' +
      (pred ? '<div class="prediction-info">回归预测：当前' + pred.currentScore + ' → 预测' + pred.predicted + ' · 趋势斜率' + pred.slope + ' · R²=' + pred.rSquared + ' · 样本' + pred.sampleSize + '条</div>' : '');
    return;
  }

  var html = '<div class="sentiment-warnings-title">预警信号 · 历史阈值 + 回归预测 · ' + warnings.length + '项触发</div>';

  for (var i = 0; i < warnings.length; i++) {
    var w = warnings[i];
    var levelLabel = '';
    switch (w.level) {
      case 'extreme': levelLabel = '极端'; break;
      case 'high': levelLabel = '高'; break;
      case 'medium': levelLabel = '中'; break;
      case 'low': levelLabel = '低'; break;
    }

    // 置信度圆点
    var confDots = '';
    for (var d = 0; d < 3; d++) {
      confDots += '<span class="conf-dot' + (d < w.confidence ? ' active' : '') + '"></span>';
    }

    html +=
      '<div class="warning-item ' + w.cssClass + '">' +
        '<div class="warning-icon">' + w.icon + '</div>' +
        '<div class="warning-body">' +
          '<div class="warning-head">' +
            '<span class="warning-label">' + w.label + '</span>' +
            '<span class="warning-level lv-' + w.level + '">' + levelLabel + '级</span>' +
          '</div>' +
          '<div class="warning-msg">' + w.message + '</div>' +
          '<div class="warning-detail">' + w.detail + '</div>' +
          '<div class="warning-confidence">置信度 <span class="conf-dots">' + confDots + '</span></div>' +
        '</div>' +
      '</div>';
  }

  container.innerHTML = html;
}

/* ============================================================
   今日复盘功能
   基于实时行情、市场情绪、资金流向等多维数据
   自动生成详细的行情走向分析
   ============================================================ */

/**
 * 生成今日复盘内容
 * @param {boolean} forceRefresh - 是否强制刷新（重新获取数据）
 */
function generateDailyReview(forceRefresh) {
  var container = document.getElementById('dailyReviewContent');
  if (!container) return;

  var btn = document.getElementById('btnReviewRefresh');
  if (btn) { btn.disabled = true; btn.textContent = '⟳ 生成中…'; }

  // 收集所有可用数据
  var rt = _lastRealtimeData || {};
  var sent = _lastSentimentData || null;
  var flow = _lastSectorFlowData || null;

  // 如果强制刷新或数据不足，尝试等待数据加载
  var hasRt = rt && Object.keys(rt).length > 0;
  var hasSent = sent && sent.score !== undefined;

  if (forceRefresh || (!hasRt && !hasSent)) {
    container.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--muted);font-size:0.68rem">⟳ 正在收集行情数据，请稍候…</div>';
    // 尝试重新获取情绪数据
    if (forceRefresh || !hasSent) {
      try { localStorage.removeItem(SENTIMENT_CACHE_KEY); } catch(e) {}
    }
    fetchMarketSentiment(true).then(function(data) {
      _lastSentimentData = data;
      Perf.trackedSetTimeout(function() {
 renderDailyReviewContent(container, _lastRealtimeData || {}, data, _lastSectorFlowData);
 if (btn) { btn.disabled = false; btn.textContent = '⟳ 刷新复盘'; }
}, 100);
    }).catch(function() {
      renderDailyReviewContent(container, _lastRealtimeData || {}, null, _lastSectorFlowData);
      if (btn) { btn.disabled = false; btn.textContent = '⟳ 刷新复盘'; }
    });
    // 复盘完成后自动触发盘口推演
    Perf.trackedSetTimeout(function() {
      if (typeof runPatternAnalysis === 'function') runPatternAnalysis(false);
    }, 500);
    return;
  }

  renderDailyReviewContent(container, rt, sent, flow);
  if (btn) { btn.disabled = false; btn.textContent = '⟳ 刷新复盘'; }
  // 复盘完成后自动触发盘口推演
  Perf.trackedSetTimeout(function() {
    if (typeof runPatternAnalysis === 'function') runPatternAnalysis(false);
  }, 500);
}

/**
 * 获取历史趋势数据
 * 用于判断连续行情趋势
 * @returns {Object} { scoreTrend, amountTrend, upDays3, upDays5, scoreChange3 }
 */
function getDaxiaoTrendData() {
  var trend = {
    scoreTrend: 'neutral',    // 'rising' | 'falling' | 'neutral'
    amountTrend: 'neutral',   // 'rising' | 'falling' | 'neutral'
    upDays3: 0,              // 近3天上涨天数
    upDays5: 0,              // 近5天上涨天数
    scoreChange3: 0,          // 近3次情绪变化
    scoreChange5: 0,          // 近5次情绪变化
    consecutiveRise: 0,       // 连续上涨天数
    consecutiveFall: 0,       // 连续下跌天数
    historyLength: 0
  };

  try {
    var raw = localStorage.getItem(SENTIMENT_HISTORY_KEY);
    if (!raw) return trend;
    var history = JSON.parse(raw);
    if (!history || history.length < 3) return trend;

    trend.historyLength = history.length;

    // 取最近5条记录
    var recent = history.slice(Math.max(0, history.length - 5));
    var n = recent.length;

    // 计算情绪趋势
    if (n >= 3) {
      var first3 = recent[recent.length - 3];
      var last3 = recent[recent.length - 1];
      trend.scoreChange3 = last3.score - first3.score;

      if (trend.scoreChange3 > 10) trend.scoreTrend = 'rising';
      else if (trend.scoreChange3 < -10) trend.scoreTrend = 'falling';
    }

    if (n >= 5) {
      var first5 = recent[recent.length - 5];
      trend.scoreChange5 = last3.score - first5.score;
    }

    // 计算近3天/5天涨跌（基于情绪指数变化方向）
    var dailyChanges = [];
    for (var i = Math.max(0, n - 6); i < n - 1; i++) {
      if (history[i] && history[i + 1]) {
        dailyChanges.push(history[i + 1].score - history[i].score);
      }
    }

    // 简化：统计近期变化方向
    trend.upDays3 = dailyChanges.slice(-3).filter(function(d) { return d > 0; }).length;
    trend.upDays5 = dailyChanges.slice(-5).filter(function(d) { return d > 0; }).length;

    // 计算量能趋势
    if (n >= 3) {
      var amounts = recent.slice(-3).map(function(r) { return r.totalAmount || 0; });
      if (amounts.length >= 3) {
        if (amounts[2] > amounts[1] && amounts[1] > amounts[0]) {
          trend.amountTrend = 'rising';
        } else if (amounts[2] < amounts[1] && amounts[1] < amounts[0]) {
          trend.amountTrend = 'falling';
        }
      }
    }

    // 计算连续涨跌（基于每日情绪变化）
    var consecutiveRise = 0, consecutiveFall = 0;
    for (var j = dailyChanges.length - 1; j >= 0; j--) {
      if (dailyChanges[j] > 0) {
        if (consecutiveFall === 0) consecutiveRise++;
        else break;
      } else if (dailyChanges[j] < 0) {
        if (consecutiveRise === 0) consecutiveFall++;
        else break;
      }
    }
    trend.consecutiveRise = consecutiveRise;
    trend.consecutiveFall = consecutiveFall;

  } catch(e) {
    if (__DEBUG__) console.warn('获取趋势数据失败:', e);
  }

  return trend;
}

/**
 * 李大霄老师行情研判函数 v2
 * 基于连续趋势 + 实时数据综合判断
 * @param {number} aShareChg - A股平均涨跌幅
 * @param {number} score - 情绪指数 0-100
 * @param {number} volRatio - 量比（相对20日均量）
 * @param {number} advDecline - 涨跌比
 * @param {number} limitUp - 涨停家数
 * @param {number} maxLbc - 最高连板数
 * @param {Object} trendData - 历史趋势数据（可选）
 * @returns {Object} { headline, reason, tags, cssClass }
 */
function getDaxiaoVerdict(aShareChg, score, volRatio, advDecline, limitUp, maxLbc, trendData) {
  var result = { headline: '', reason: '', tags: [], cssClass: 'dv-neutral' };

  // 获取趋势数据
  if (!trendData) trendData = getDaxiaoTrendData();

  var isRising = trendData.scoreTrend === 'rising';
  var isFalling = trendData.scoreTrend === 'falling';
  var hasVolume = trendData.amountTrend === 'rising';
  var hasConsecutiveRise = trendData.consecutiveRise >= 2;
  var hasConsecutiveFall = trendData.consecutiveFall >= 2;
  var hasHistory = trendData.historyLength >= 3;

  // ===== 顶部区域判断（基于历史）=====
  if (hasHistory && score >= 80 && isRising && aShareChg >= 1.5) {
    // 连续上涨后的狂热
    if (trendData.consecutiveRise >= 3 || trendData.scoreChange3 >= 20) {
      result.headline = '🔴【做好人】才能买好股！';
      result.reason = '连续' + trendData.consecutiveRise + '天上涨，情绪指数飙升至' + score + '分！' + (score >= 90 ? '市场已极度狂热！现在！立刻！减仓！' : '风险在快速积累，请务必减仓锁定利润！');
      result.tags = ['风险提示', '减仓时机', '冷静决策', '落袋为安'];
      result.cssClass = 'dv-extreme-bull';
      return result;
    }
    // 大国牛
    else if (aShareChg >= 2.5 && hasVolume) {
      result.headline = '🚨【大国牛】扑面而来！';
      result.reason = '市场暴涨' + aShareChg.toFixed(1) + '%，情绪指数飙升至' + score + '分，量能持续放大，' + (maxLbc >= 5 ? '连板高度达' + maxLbc + '板！' : '涨停潮涌现！') + '这是久违的全面做多行情！';
      result.tags = ['大国牛', '全面做多', '量价齐升', '涨停潮'];
      result.cssClass = 'dv-extreme-bull';
      return result;
    }
    // 疯牛
    else if (aShareChg >= 1.5 || hasConsecutiveRise) {
      result.headline = '🔥【疯牛】已经启动！';
      result.reason = '市场强势' + (aShareChg >= 1.5 ? '上涨' : '连续走强') + '，情绪高涨至' + score + '分，' + (hasVolume ? '量能充沛，' : '') + '赚钱效应极佳！';
      result.tags = ['疯牛', '强势做多', '赚钱效应', '优质标的'];
      result.cssClass = 'dv-strong-bull';
      return result;
    }
  }

  // ===== 底部区域判断（基于历史）=====
  if (hasHistory && score <= 35 && isFalling && aShareChg <= -1) {
    // 连续下跌后的绝望
    if (trendData.consecutiveFall >= 3 || Math.abs(trendData.scoreChange3) >= 20) {
      result.headline = '💀【地球顶】远离毒品！';
      result.reason = '连续' + trendData.consecutiveFall + '天下跌，情绪指数暴跌至' + score + '分！' + (score <= 20 ? '市场已极度恐慌，物极必反！' : '恐慌情绪蔓延，底部越来越近！') + '黎明前的黑暗最难熬，但曙光就在前方！';
      result.tags = ['极度悲观', '黎明前的黑暗', '坚持住', '曙光在即'];
      result.cssClass = 'dv-extreme-bear';
      return result;
    }
    // 最后牛市
    else if (score <= 25 && volRatio <= 0.8) {
      result.headline = '😭【最后牛市】绝地反击！';
      result.reason = '市场大跌' + Math.abs(aShareChg).toFixed(1) + '%，情绪降至' + score + '分，但量能萎缩说明抛压枯竭！物极必反，这可能是' + (score <= 15 ? '历史大底的绝佳机会！' : '最后的买入时机！');
      result.tags = ['最后牛市', '绝地反击', '历史机遇', '逆向投资'];
      result.cssClass = 'dv-last-bull';
      return result;
    }
    // 青春底
    else if (aShareChg <= -1.5) {
      result.headline = '📉【青春底】无需恐慌！';
      result.reason = '市场调整' + Math.abs(aShareChg).toFixed(1) + '%，但' + (hasHistory ? '这不过是上涨途中的正常回调' : '基本面依然稳健') + '，青春底是' + (score <= 25 ? '极度恐慌下的黄金坑' : '优质标的的低吸机会') + '！';
      result.tags = ['青春底', '正常回调', '逢低吸纳', '逆向布局'];
      result.cssClass = 'dv-teen-bottom';
      return result;
    }
    // 散户离场
    else if (advDecline <= 0.5 || limitUp <= 5) {
      result.headline = '🚪【散户离场】底部将近！';
      result.reason = '市场大跌' + Math.abs(aShareChg).toFixed(1) + '%，赚钱效应极差，' + (limitUp <= 5 ? '涨停寥寥无几' : '涨停仅' + limitUp + '家') + '，散户绝望离场！但历史告诉我们：底部总在绝望中诞生！';
      result.tags = ['底部区域', '绝望中见底', '逆向思维', '机构进场'];
      result.cssClass = 'dv-bear';
      return result;
    }
  }

  // ===== 震荡上行判断（基于连续趋势）=====
  if (hasHistory && isRising && hasConsecutiveRise && aShareChg >= 0.5) {
    if (aShareChg >= 1.5 && score >= 65) {
      result.headline = '🐢【慢牛】稳步前行！';
      result.reason = '已连续' + trendData.consecutiveRise + '天走强，市场稳步上涨' + aShareChg.toFixed(1) + '%，走势稳健、量能配合，这是健康的慢牛格局！坚定信心，做多中国！';
      result.tags = ['慢牛', '稳扎稳打', '趋势向上', '耐心持有'];
      result.cssClass = 'dv-slow-bull';
      return result;
    }
    else if (aShareChg >= 0.5) {
      result.headline = '🌱【扎扎实实】做多中国！';
      result.reason = '连续' + trendData.consecutiveRise + '天上涨，市场稳步上行' + aShareChg.toFixed(1) + '%，情绪持续回暖，这是健康的多头格局！';
      result.tags = ['多头格局', '健康上涨', '信心十足', '做多中国'];
      result.cssClass = 'dv-slow-bull';
      return result;
    }
  }

  // ===== 震荡下行判断（基于连续趋势）=====
  if (hasHistory && isFalling && hasConsecutiveFall && aShareChg <= -0.3) {
    result.headline = '🌙【余钱】才能买好股！';
    result.reason = '已连续' + trendData.consecutiveFall + '天下跌，市场回落' + Math.abs(aShareChg).toFixed(1) + '%，此刻是检视持仓、布局优质标的的好时机。记住：用余钱投资，不要杠杆！';
    result.tags = ['正常调整', '检视持仓', '余钱投资', '去伪存真'];
    result.cssClass = 'dv-neutral';
    return result;
  }

  // ===== 底部试探判断（缩量见底）=====
  if (aShareChg >= 0 && aShareChg < 1 && volRatio <= 0.8 && score >= 40 && score <= 60) {
    if (hasHistory && isFalling && trendData.amountTrend === 'falling') {
      result.headline = '💎【钻石底】若隐若现！';
      result.reason = '市场小幅上扬但持续缩量，主力资金悄然吸筹！地量见地价，' + (trendData.scoreChange3 <= -10 ? '情绪已连降' + Math.abs(trendData.scoreChange3).toFixed(0) + '分' : '') + '，钻石底正在形成！';
      result.tags = ['钻石底', '地量吸筹', '价值投资', '逆向思维'];
      result.cssClass = 'dv-diamond-bottom';
      return result;
    }
    else if (score >= 45 && score < 55) {
      result.headline = '👶【婴儿底】悄然降临！';
      result.reason = '市场微幅上涨' + aShareChg.toFixed(1) + '%，情绪处于相对低位' + (isFalling ? '但已企稳' : '') + '，婴儿底或已探明，布局时机渐显！';
      result.tags = ['婴儿底', '底部区域', '布局时机', '耐心等待'];
      result.cssClass = 'dv-baby-bottom';
      return result;
    }
  }

  // ===== 警示：黑五类炒作 =====
  if (advDecline >= 2 && limitUp > 30 && volRatio >= 1.2 && aShareChg > 1) {
    result.headline = '⚠️【黑五类】炒作疯狂！';
    result.reason = '涨停暴增至' + limitUp + '家，小票满天飞！' + (hasConsecutiveRise ? '连续炒作' : '') + '这是典型的投机炒作！远离黑五类，拥抱核心资产！';
    result.tags = ['黑五类', '投机炒作', '远离小票', '拥抱蓝筹'];
    result.cssClass = 'dv-warning';
    return result;
  }

  // ===== 警示：二八分化 =====
  if ((aShareChg > 0 && aShareChg < 0.5 && advDecline < 0.7) || (aShareChg < -0.3 && aShareChg > -1 && advDecline >= 1.2)) {
    result.headline = '⚖️【二八分化】精选赛道！';
    result.reason = '市场呈现明显分化' + (isRising ? '，指数小涨但个股普跌' : isFalling ? '，指数小跌但个股分化' : '，涨跌互现') + '，选股难度加大，拥抱龙头、回避边缘！';
    result.tags = ['分化行情', '精选龙头', '回避边缘', '结构机会'];
    result.cssClass = 'dv-divide';
    return result;
  }

  // ===== 震荡整理 =====
  if (Math.abs(aShareChg) <= 0.5 && volRatio <= 0.9 && score >= 35 && score <= 65) {
    result.headline = '🤷【横盘整理】静待时机！';
    var advice = score >= 50 ? '保持半仓，静待突破' : '控制仓位，等待企稳';
    if (hasHistory) {
      advice = isRising ? '保持仓位，顺势而为' : isFalling ? '控制仓位，等待信号' : advice;
    }
    result.reason = '市场成交清淡，指数原地踏步' + (hasHistory ? '，' + (isRising ? '近期连续走强' : isFalling ? '近期有所回调' : '方向待定') : '') + '。建议：' + advice + '。';
    result.tags = ['震荡市', '静观其变', '控制仓位', '等待信号'];
    result.cssClass = 'dv-neutral';
    return result;
  }

  // ===== 单日大幅上涨（无历史趋势）=====
  if (aShareChg >= 2 && score >= 70 && !hasHistory) {
    result.headline = '🔥【行情启动】顺势而为！';
    result.reason = '市场强势上涨' + aShareChg.toFixed(1) + '%，情绪高涨至' + score + '分，量能充沛！顺势而为！但注意不要追高！';
    result.tags = ['行情启动', '顺势而为', '控制仓位', '不要追高'];
    result.cssClass = 'dv-strong-bull';
    return result;
  }

  // ===== 单日大幅下跌（无历史趋势）=====
  if (aShareChg <= -2 && score <= 35 && !hasHistory) {
    result.headline = '📉【回调考验】耐心等待！';
    result.reason = '市场大跌' + Math.abs(aShareChg).toFixed(1) + '%，情绪降至' + score + '分。此刻需耐心等待企稳信号，不宜盲目抄底。';
    result.tags = ['回调考验', '耐心等待', '控制仓位', '等待信号'];
    result.cssClass = 'dv-bear';
    return result;
  }

  // ===== 兜底：其他情况 ======
  if (aShareChg >= 0.3) {
    result.headline = '📊【稳中向好】耐心等待！';
    result.reason = '市场小幅上涨' + aShareChg.toFixed(1) + '%，情绪指数' + score + '分' + (hasHistory ? '，' + (isRising ? '近期连续走强' : '趋势待观察') : '') + '，继续保持关注。';
    result.tags = ['静观其变', '耐心等待', '顺势而为', '控制仓位'];
    result.cssClass = 'dv-neutral';
  } else {
    result.headline = '🔇【静观其变】控制仓位！';
    result.reason = '市场小幅回落' + Math.abs(aShareChg).toFixed(1) + '%，情绪指数' + score + '分' + (hasHistory ? '，' + (isFalling ? '近期连续走弱' : '趋势待观察') : '') + '，建议控制仓位。';
    result.tags = ['静观其变', '耐心等待', '控制仓位', '顺势而为'];
    result.cssClass = 'dv-neutral';
  }

  return result;
}

/**
 * 渲染复盘内容（核心逻辑）
 */
function renderDailyReviewContent(container, rt, sent, flow) {
  var now = new Date();
  var dateStr = now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日';
  var timeStr = ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2);
  var weekday = ['日','一','二','三','四','五','六'][now.getDay()];

  // ===== 1. 提取指数数据 =====
  var indexList = BASE_DATA.indices;
  var indexData = [];
  var totalChg = 0, chgCount = 0;
  var gainers = [], losers = [];

  indexList.forEach(function(idx) {
    var r = rt[idx.code];
    if (r && r.changePercent !== undefined) {
      var chg = r.changePercent;
      var price = r.price || 0;
      indexData.push({ name: idx.name, code: idx.code, chg: chg, price: price });
      totalChg += chg;
      chgCount++;
      if (chg > 0) gainers.push({ name: idx.name, chg: chg });
      else if (chg < 0) losers.push({ name: idx.name, chg: chg });
    }
  });

  // A股核心指数（上证、深证、创业板、沪深300）
  var shIdx = rt['sh000001'];
  var szIdx = rt['sz399001'];
  var cybIdx = rt['sz399006'];
  var hs300 = rt['sh000300'];
  var hkIdx = rt['hkHSI'];
  var usIdx = rt['usIXIC'];

  // ===== 2. 市场情绪数据 =====
  var score = sent ? sent.score : 50;
  var level = getSentimentLevel(score);
  var upCount = sent ? sent.up : 0;
  var downCount = sent ? sent.down : 0;
  var flatCount = sent ? sent.flat : 0;
  var totalCount = sent ? sent.total : 0;
  var advDecline = sent ? sent.advDeclineRatio : 1;
  var limitUp = sent ? sent.limitUp : 0;
  var limitDown = sent ? sent.limitDown : 0;
  var maxLbc = sent ? sent.maxLbc : 0;
  var totalAmount = sent ? sent.totalAmount : 0;
  var prevAmount = sent ? sent.prevAmount : 0;
  var momentum = sent ? sent.momentum : null;

  var amountYi = totalAmount / 1e8;
  var prevYi = prevAmount / 1e8;
  var volChangePct = prevAmount > 0 ? ((totalAmount - prevAmount) / prevAmount) * 100 : 0;
  var avg20Yi = sent && sent.avg20Amount ? sent.avg20Amount / 1e8 : 0;
  var volRatio20 = avg20Yi > 0 ? amountYi / avg20Yi : 1;

  // ===== 4. 判断市场整体走向 =====
  var avgChg = chgCount > 0 ? totalChg / chgCount : 0;
  var aShareChg = 0;
  if (shIdx && szIdx) {
    aShareChg = ((shIdx.changePercent || 0) + (szIdx.changePercent || 0)) / 2;
  } else if (shIdx) {
    aShareChg = shIdx.changePercent || 0;
  }

  var marketType, marketColor, marketIcon, marketDesc;
  if (aShareChg > 1.5 && score >= 60) {
    marketType = 'bullish';
    marketColor = 'bar-bullish';
    marketIcon = '🔴';
    marketDesc = '多头强势进攻';
  } else if (aShareChg > 0.5) {
    marketType = 'bullish';
    marketColor = 'bar-bullish';
    marketIcon = '🔺';
    marketDesc = '偏多震荡上行';
  } else if (aShareChg < -1.5 && score <= 40) {
    marketType = 'bearish';
    marketColor = 'bar-bearish';
    marketIcon = '🟢';
    marketDesc = '空头强势打压';
  } else if (aShareChg < -0.5) {
    marketType = 'bearish';
    marketColor = 'bar-bearish';
    marketIcon = '🔻';
    marketDesc = '偏空震荡下行';
  } else {
    marketType = 'neutral';
    marketColor = 'bar-neutral';
    marketIcon = '🟡';
    marketDesc = '多空均衡·震荡整理';
  }

  // ===== 4. 生成HTML =====
  var html = '';

  // --- 李大霄老师行情判断（传入历史趋势数据）---
  var trendData = getDaxiaoTrendData();
  var daxiaoVerdict = getDaxiaoVerdict(aShareChg, score, volRatio20, advDecline, limitUp, maxLbc, trendData);

  // 趋势状态指示器
  var trendIndicator = '';
  if (trendData.historyLength >= 3) {
    var trendIcon = trendData.scoreTrend === 'rising' ? '📈' : (trendData.scoreTrend === 'falling' ? '📉' : '➡️');
    var trendText = trendData.scoreTrend === 'rising' ? '连升' : (trendData.scoreTrend === 'falling' ? '连降' : '平稳');
    var consecutive = Math.max(trendData.consecutiveRise, trendData.consecutiveFall);
    if (consecutive > 0) {
      trendIndicator = '<span class="dv-trend-badge">' + trendIcon + ' ' + trendText + consecutive + '天</span>';
    }
  }

  html += '<div class="daxiao-verdict ' + daxiaoVerdict.cssClass + '">';
  html += '<div class="dv-header">';
  html += '<span class="dv-avatar">🦁</span>';
  html += '<span class="dv-title">李大霄老师行情研判</span>';
  if (trendIndicator) html += trendIndicator;
  html += '</div>';
  html += '<div class="dv-content">';
  html += '<div class="dv-headline">' + daxiaoVerdict.headline + '</div>';
  html += '<div class="dv-reason">' + daxiaoVerdict.reason + '</div>';
  html += '<div class="dv-tags">';
  daxiaoVerdict.tags.forEach(function(tag) {
    html += '<span class="dv-tag">' + tag + '</span>';
  });
  html += '</div>';
  html += '</div></div>';

  // --- 摘要条 ---
  var sentLabel = level ? level.cnLabel : '中性';
  html += '<div class="review-summary-bar ' + marketColor + '">';
  html += '<span style="font-size:0.9rem">' + marketIcon + '</span>';
  html += '<span>' + dateStr + ' 星期' + weekday + ' · ' + timeStr + ' 更新</span>';
  html += '<span style="margin-left:auto;font-size:0.64rem">情绪指数：<strong>' + score + '</strong>（' + sentLabel + '）</span>';
  html += '</div>';

  // --- 第一节：大盘走势概览 ---
  html += '<div class="review-section">';
  html += '<div class="review-section-title"><span class="rs-icon">📊</span> 大盘走势概览</div>';
  html += '<div class="review-section-body">';

  var overviewParts = [];
  if (shIdx) {
    var shChg = shIdx.changePercent || 0;
    var shCls = shChg >= 0 ? 'hl-green' : 'hl-red';
    var shArrow = shChg > 0 ? '▲' : (shChg < 0 ? '▼' : '—');
    overviewParts.push('上证指数报<strong class="' + shCls + '">' + (shIdx.price || 0).toFixed(2) + '</strong>点 ' + shArrow + ' <strong class="' + shCls + '">' + (shChg >= 0 ? '+' : '') + shChg.toFixed(2) + '%</strong>');
  }
  if (szIdx) {
    var szChg = szIdx.changePercent || 0;
    var szCls = szChg >= 0 ? 'hl-green' : 'hl-red';
    var szArrow = szChg > 0 ? '▲' : (szChg < 0 ? '▼' : '—');
    overviewParts.push('深证成指 ' + szArrow + ' <strong class="' + szCls + '">' + (szChg >= 0 ? '+' : '') + szChg.toFixed(2) + '%</strong>');
  }
  if (cybIdx) {
    var cybChg = cybIdx.changePercent || 0;
    var cybCls = cybChg >= 0 ? 'hl-green' : 'hl-red';
    var cybArrow = cybChg > 0 ? '▲' : (cybChg < 0 ? '▼' : '—');
    overviewParts.push('创业板指 ' + cybArrow + ' <strong class="' + cybCls + '">' + (cybChg >= 0 ? '+' : '') + cybChg.toFixed(2) + '%</strong>');
  }
  if (hs300) {
    var hsChg = hs300.changePercent || 0;
    var hsCls = hsChg >= 0 ? 'hl-green' : 'hl-red';
    var hsArrow = hsChg > 0 ? '▲' : (hsChg < 0 ? '▼' : '—');
    overviewParts.push('沪深300 ' + hsArrow + ' <strong class="' + hsCls + '">' + (hsChg >= 0 ? '+' : '') + hsChg.toFixed(2) + '%</strong>');
  }

  if (overviewParts.length > 0) {
    html += overviewParts.join('，') + '。';
  }

  // 走势描述
  html += '今日A股市场<strong>' + marketDesc + '</strong>。';
  if (aShareChg > 0.5) {
    html += '主要指数集体收红，市场做多情绪升温。';
    if (gainers.length > 0) {
      var topGainer = gainers.sort(function(a, b) { return b.chg - a.chg; })[0];
      html += '其中<strong class="hl-green">' + topGainer.name + '</strong>表现最强，涨幅达<strong class="hl-green">' + topGainer.chg.toFixed(2) + '%</strong>。';
    }
  } else if (aShareChg < -0.5) {
    html += '主要指数普遍走弱，市场避险情绪升温。';
    if (losers.length > 0) {
      var topLoser = losers.sort(function(a, b) { return a.chg - b.chg; })[0];
      html += '其中<strong class="hl-red">' + topLoser.name + '</strong>跌幅最大，达<strong class="hl-red">' + topLoser.chg.toFixed(2) + '%</strong>。';
    }
  } else {
    html += '各指数涨跌互现，多空双方力量较为均衡，市场处于方向选择期。';
  }

  // 港股/美股对比
  if (hkIdx || usIdx) {
    html += '<br>外围方面，';
    var extParts = [];
    if (hkIdx) {
      var hkChg = hkIdx.changePercent || 0;
      var hkCls = hkChg >= 0 ? 'hl-green' : 'hl-red';
      var hkArrow = hkChg > 0 ? '▲' : (hkChg < 0 ? '▼' : '—');
      extParts.push('恒生指数 ' + hkArrow + ' <strong class="' + hkCls + '">' + (hkChg >= 0 ? '+' : '') + hkChg.toFixed(2) + '%</strong>');
    }
    if (usIdx) {
      var usChg = usIdx.changePercent || 0;
      var usCls = usChg >= 0 ? 'hl-green' : 'hl-red';
      var usArrow = usChg > 0 ? '▲' : (usChg < 0 ? '▼' : '—');
      extParts.push('纳斯达克 ' + usArrow + ' <strong class="' + usCls + '">' + (usChg >= 0 ? '+' : '') + usChg.toFixed(2) + '%</strong>');
    }
    html += extParts.join('，') + '。';
  }

  html += '</div>';

  // 指数表现网格
  if (indexData.length > 0) {
    html += '<div class="review-index-grid">';
    indexData.forEach(function(item) {
      var dirCls = item.chg > 0 ? 'ri-up' : (item.chg < 0 ? 'ri-down' : 'ri-flat');
      var cls = item.chg > 0 ? 'hl-green' : (item.chg < 0 ? 'hl-red' : 'hl-yellow');
      var sign = item.chg >= 0 ? '+' : '';
      var arrow = item.chg > 0 ? '▲' : (item.chg < 0 ? '▼' : '—');
      html += '<div class="review-index-item ' + dirCls + '">';
      html += '<div class="ri-name">' + item.name + '</div>';
      html += '<div class="ri-chg ' + cls + '"><span class="ri-arrow">' + arrow + '</span>' + sign + item.chg.toFixed(2) + '%</div>';
      html += '</div>';
    });
    html += '</div>';
  }

  html += '</div>';

  // --- 第二节：市场广度分析 ---
  if (totalCount > 0) {
    html += '<div class="review-section">';
    html += '<div class="review-section-title"><span class="rs-icon">📐</span> 市场广度分析</div>';
    html += '<div class="review-section-body">';

    var upPct = totalCount > 0 ? (upCount / totalCount * 100).toFixed(1) : 0;
    var downPct = totalCount > 0 ? (downCount / totalCount * 100).toFixed(1) : 0;

    html += '全市场<strong>' + totalCount + '</strong>只个股中，上涨<strong class="hl-green">' + upCount + '</strong>只（占' + upPct + '%），下跌<strong class="hl-red">' + downCount + '</strong>只（占' + downPct + '%），平盘' + flatCount + '只。';

    if (advDecline >= 2) {
      html += '涨跌比达<strong class="hl-green">' + advDecline.toFixed(2) + '</strong>，呈现<strong class="hl-green">普涨格局</strong>，市场赚钱效应显著。';
    } else if (advDecline >= 1 && advDecline < 2) {
      html += '涨跌比为<strong class="hl-yellow">' + advDecline.toFixed(2) + '</strong>，上涨个股略多于下跌，市场情绪偏向多头。';
    } else if (advDecline >= 0.5) {
      html += '涨跌比为<strong class="hl-yellow">' + (1/advDecline).toFixed(2) + ':1</strong>（跌多涨少），市场分化明显。';
    } else {
      html += '涨跌比仅<strong class="hl-red">1:' + (1/advDecline).toFixed(2) + '</strong>，呈现<strong class="hl-red">普跌格局</strong>，市场亏钱效应蔓延。';
    }

    // 涨停跌停分析
    if (limitUp > 0 || limitDown > 0) {
      html += '<br>涨停板<strong class="hl-green">' + limitUp + '</strong>家';
      if (limitDown > 0) {
        html += '，跌停板<strong class="hl-red">' + limitDown + '</strong>家';
      }
      if (maxLbc > 0) {
        html += '。最高<strong class="hl-green">' + maxLbc + '连板</strong>';
        if (maxLbc >= 5) {
          html += '，连板高度较高，短线情绪活跃，游资进攻意愿强';
        } else if (maxLbc >= 3) {
          html += '，连板情绪尚可，市场有一定短线机会';
        } else {
          html += '，连板高度一般，短线情绪偏谨慎';
        }
      }
      html += '。';
    }

    html += '</div></div>';
  }

  // --- 第三节：量能分析 ---
  if (amountYi > 0) {
    html += '<div class="review-section">';
    html += '<div class="review-section-title"><span class="rs-icon">💰</span> 量能分析</div>';
    html += '<div class="review-section-body">';

    var amtText = amountYi >= 10000 ? (amountYi / 10000).toFixed(2) + '万亿' : amountYi.toFixed(0) + '亿';
    html += '今日全市场成交额<strong class="hl-cyan">' + amtText + '</strong>。';

    if (prevYi > 0) {
      var prevText = prevYi >= 10000 ? (prevYi / 10000).toFixed(2) + '万亿' : prevYi.toFixed(0) + '亿';
      if (volChangePct > 10) {
        html += '较昨日（' + prevText + '）<strong class="hl-green">显著放量' + (volChangePct >= 0 ? '+' : '') + volChangePct.toFixed(1) + '%</strong>，资金入场意愿强烈。';
        if (aShareChg > 0) {
          html += '放量上涨是较为健康的量价配合，说明多头有真金白银支撑。';
        } else {
          html += '但指数收跌，放量下跌需警惕主力出货或恐慌抛售。';
        }
      } else if (volChangePct > 0) {
        html += '较昨日（' + prevText + '）<strong class="hl-green">放量' + (volChangePct >= 0 ? '+' : '') + volChangePct.toFixed(1) + '%</strong>，市场交投活跃度有所提升。';
      } else if (volChangePct > -10) {
        html += '较昨日（' + prevText + '）<strong class="hl-red">缩量' + volChangePct.toFixed(1) + '%</strong>，市场交投谨慎。';
        if (aShareChg > 0) {
          html += '缩量上涨持续性存疑，需关注后续能否补量。';
        } else {
          html += '缩量下跌说明抛压减轻，地量见地价的可能性增加。';
        }
      } else {
        html += '较昨日（' + prevText + '）<strong class="hl-red">显著缩量' + volChangePct.toFixed(1) + '%</strong>，市场观望情绪浓厚。';
        html += '量能大幅萎缩，资金参与意愿明显下降。';
      }
    }

    // 量能分级（基于相对20日均量的量比，而非固定数值）
    var avg20YiReview = sent && sent.avg20Amount ? sent.avg20Amount / 1e8 : 0;
    var volRatio20Review = avg20YiReview > 0 ? amountYi / avg20YiReview : 1;
    if (avg20YiReview > 0) {
      var avg20ReviewText = avg20YiReview >= 10000 ? (avg20YiReview / 10000).toFixed(2) + '万亿' : avg20YiReview.toFixed(0) + '亿';
      html += '<br>近20日平均成交额为<strong>' + avg20ReviewText + '</strong>，今日量比<strong class="' + (volRatio20Review >= 1 ? 'hl-green' : 'hl-red') + '">' + volRatio20Review.toFixed(2) + '</strong>。';
      if (volRatio20Review >= 2.0) {
        html += '成交额达到20日均量的<strong class="hl-green">' + volRatio20Review.toFixed(1) + '倍</strong>，属于<strong class="hl-green">天量水平</strong>（相对近期），市场情绪亢奋。';
      } else if (volRatio20Review >= 1.5) {
        html += '成交额为20日均量的<strong class="hl-green">' + volRatio20Review.toFixed(1) + '倍</strong>，属于<strong class="hl-green">显著放量</strong>，资金活跃度远超近期平均。';
      } else if (volRatio20Review >= 1.1) {
        html += '成交额略高于20日均量，属于<strong class="hl-yellow">温和放量</strong>，市场交投活跃度有所提升。';
      } else if (volRatio20Review >= 0.85) {
        html += '成交额与20日均量基本持平，量能处于<strong class="hl-yellow">正常水平</strong>。';
      } else if (volRatio20Review >= 0.6) {
        html += '成交额为20日均量的' + (volRatio20Review*100).toFixed(0) + '%，属于<strong class="hl-red">缩量</strong>，市场交投趋于谨慎。';
      } else {
        html += '成交额仅为20日均量的' + (volRatio20Review*100).toFixed(0) + '%，属于<strong class="hl-red">地量水平</strong>（相对近期），市场人气极度低迷。';
      }
    }

    html += '</div></div>';
  }

  // --- 第四节：趋势动量分析 ---
  if (momentum) {
    html += '<div class="review-section">';
    html += '<div class="review-section-title"><span class="rs-icon">📈</span> 趋势动量分析</div>';
    html += '<div class="review-section-body">';

    var ret20 = momentum.ret20 || 0;
    var ret5 = momentum.ret5 || 0;
    var devMA20 = momentum.deviationMA20 || 0;
    var downDays = momentum.downDays10 || 0;
    var ma20 = momentum.ma20 || 0;
    var latestClose = momentum.latestClose || 0;

    // 20日趋势
    if (ret20 > 5) {
      html += '沪深300近20日上涨<strong class="hl-green">' + ret20.toFixed(1) + '%</strong>，中期趋势向上，市场处于<strong class="hl-green">多头格局</strong>。';
    } else if (ret20 > 0) {
      html += '沪深300近20日上涨<strong class="hl-green">' + ret20.toFixed(1) + '%</strong>，中期趋势温和向上。';
    } else if (ret20 > -5) {
      html += '沪深300近20日下跌<strong class="hl-red">' + Math.abs(ret20).toFixed(1) + '%</strong>，中期趋势偏弱。';
    } else {
      html += '沪深300近20日下跌<strong class="hl-red">' + Math.abs(ret20).toFixed(1) + '%</strong>，中期趋势向下，市场处于<strong class="hl-red">空头格局</strong>。';
    }

    // 5日短期动能
    html += '<br>短期来看，近5日' + (ret5 >= 0 ? '上涨' : '下跌') + '<strong class="' + (ret5 >= 0 ? 'hl-green' : 'hl-red') + '">' + Math.abs(ret5).toFixed(1) + '%</strong>。';

    // 趋势背离
    if (Math.sign(ret5) !== Math.sign(ret20) && Math.abs(ret5) > 1 && Math.abs(ret20) > 1) {
      if (ret5 > 0 && ret20 < 0) {
        html += '<strong class="hl-yellow">短期反弹与中期下跌趋势背离</strong>，可能为趋势反转信号或反弹陷阱，需观察量能配合。';
      } else {
        html += '<strong class="hl-yellow">短期回调与中期上涨趋势背离</strong>，可能为洗盘或趋势转折信号，需关注支撑位有效性。';
      }
    }

    // MA20偏离
    if (Math.abs(devMA20) > 7) {
      html += '<br>当前沪深300报' + latestClose.toFixed(1) + '点，偏离20日均线（' + ma20.toFixed(1) + '点）<strong class="' + (devMA20 > 0 ? 'hl-green' : 'hl-red') + '">' + (devMA20 > 0 ? '+' : '') + devMA20.toFixed(1) + '%</strong>，处于<strong class="hl-yellow">' + (devMA20 > 0 ? '超买' : '超卖') + '区域</strong>。';
    } else {
      html += '<br>当前偏离20日均线' + (devMA20 >= 0 ? '+' : '') + devMA20.toFixed(1) + '%，处于正常波动范围。';
    }

    // 近10日下跌天数
    if (downDays >= 7) {
      html += '近10个交易日中下跌' + downDays + '天，下跌频率较高，空头占优明显。';
    } else if (downDays <= 3) {
      html += '近10个交易日中仅下跌' + downDays + '天，多头主导行情。';
    }

    html += '</div></div>';
  }

  // --- 第五节：明日策略建议 ---
  html += '<div class="review-strategy">';
  html += '<div class="review-strategy-title">🎯 明日操作策略建议</div>';
  html += '<div class="review-strategy-body"><ul>';

  if (marketType === 'bullish' && score < 75) {
    html += '<li><span class="review-tag tag-red">偏多</span>市场多头占优且情绪未过热，可适当加仓强势板块，跟随趋势操作</li>';
    html += '<li>关注放量突破的板块龙头，优先选择站上20日均线且均线向上的标的</li>';
    if (volChangePct > 0) {
      html += '<li>今日放量上涨，量价配合健康，多头有资金支撑，可持有待涨</li>';
    }
  } else if (marketType === 'bullish' && score >= 75) {
    html += '<li><span class="review-tag tag-yellow">谨慎</span>市场虽强但情绪过热，注意控制仓位，不宜追高</li>';
    html += '<li>可适度止盈涨幅较大的标的，锁定部分利润</li>';
    html += '<li>关注滞涨板块的补涨机会，回避连板过高的妖股</li>';
  } else if (marketType === 'bearish' && score > 25) {
    html += '<li><span class="review-tag tag-green">偏空</span>市场空头占优，控制仓位为主，轻仓观望或操作超跌反弹</li>';
    html += '<li>回避高位破位个股，关注是否有政策利好催化反弹</li>';
    if (volChangePct < 0) {
      html += '<li>缩量下跌说明抛压减轻，若出现地量地价可关注左侧布局机会</li>';
    }
  } else if (marketType === 'bearish' && score <= 25) {
    html += '<li><span class="review-tag tag-cyan">抄底</span>市场恐慌情绪浓厚，恐慌指数处于低位，历史上往往是中期底部区域</li>';
    html += '<li>可分批左侧布局超跌优质标的，但不建议一次性满仓抄底</li>';
    html += '<li>关注基本面良好、被错杀的绩优股，等待市场企稳后的修复行情</li>';
  } else {
    html += '<li><span class="review-tag tag-yellow">震荡</span>市场多空均衡，缺乏明确方向，宜均衡配置、高抛低吸</li>';
    html += '<li>关注结构性机会，优选估值分位低、有催化剂的板块</li>';
    html += '<li>控制整体仓位在中性水平，等待方向明确后再加仓</li>';
  }

  // 量能建议（基于相对20日均量判断）
  var volRatio20Strategy = (sent && sent.avg20Amount && sent.avg20Amount > 0)
    ? amountYi / (sent.avg20Amount / 1e8) : 1;
  if (amountYi > 0 && volRatio20Strategy < 0.7 && aShareChg > 0) {
    html += '<li><span class="review-tag tag-yellow">量价背离</span>今日量比仅' + volRatio20Strategy.toFixed(2) + '（低于20日均量30%+），缩量上涨持续性存疑，若明日不能补量需注意冲高回落风险</li>';
  }
  if (volRatio20Strategy >= 1.5 && aShareChg < 0) {
    html += '<li><span class="review-tag tag-green">放量下跌</span>今日量比' + volRatio20Strategy.toFixed(2) + '（远超20日均量），放量下跌需警惕主力出货，关注后续能否快速缩量企稳</li>';
  }

  html += '</ul></div></div>';

  // 数据来源声明
  html += '<div style="margin-top:0.5rem;font-size:0.52rem;color:var(--muted);opacity:0.7;text-align:right">';
  html += '数据来源：东方财富/腾讯行情API · 复盘内容基于实时数据自动生成，仅供参考';
  html += '</div>';

  container.innerHTML = html;
}

/**
 * 获取行业板块主力资金流向（真实数据）
 * 数据源：东方财富 push2delay API（支持CORS）
 * 返回各板块真实主力净流入额(f62)、超大单(f66)、大单(f72)等
 * @returns {Promise} resolve(data) - { inflow: [...], outflow: [...], totalMain, time }
 */
function fetchSectorCapitalFlow() {
  // 缓存策略：5分钟TTL，板块资金流向无需每3分钟刷新
  var SECTOR_FLOW_CACHE_KEY = 'sector_flow_cache_v2';
  var SECTOR_FLOW_TTL = 5 * 60 * 1000; // 5分钟
  try {
    var raw = localStorage.getItem(SECTOR_FLOW_CACHE_KEY);
    if (raw) {
      var obj = JSON.parse(raw);
      if (Date.now() - obj.ts < SECTOR_FLOW_TTL && obj.data) {
        if(__DEBUG__)console.log('使用板块资金流缓存（' + Math.round((Date.now() - obj.ts) / 60000) + '分钟前）');
        return Promise.resolve(obj.data);
      }
    }
  } catch(e) {}

  // 东方财富行业板块资金流向API（push2delay支持CORS跨域）
  // 双请求策略：po=1(降序)取流入TOP + po=0(升序)取流出TOP
  // 注意：API单次最多返回100条，po=1降序时只能看到正数（流入），流出板块需要po=0升序单独获取
  var fields = 'f2,f3,f4,f5,f6,f7,f8,f10,f12,f14,f15,f16,f17,f18,f62,f184,f66,f72,f78,f84';
  var urlInflow = 'https://push2delay.eastmoney.com/api/qt/clist/get' +
    '?fid=f62&po=1&pz=100&pn=1&np=1&fltt=2&invt=2' +
    '&fs=m:90+t:2&fields=' + fields;
  var urlOutflow = 'https://push2delay.eastmoney.com/api/qt/clist/get' +
    '?fid=f62&po=0&pz=100&pn=1&np=1&fltt=2&invt=2' +
    '&fs=m:90+t:2&fields=' + fields;
  // 备用源
  var urlInflow2 = 'https://push2.eastmoney.com/api/qt/clist/get' +
    '?fid=f62&po=1&pz=100&pn=1&np=1&fltt=2&invt=2' +
    '&fs=m:90+t:2&fields=' + fields;
  var urlOutflow2 = 'https://push2.eastmoney.com/api/qt/clist/get' +
    '?fid=f62&po=0&pz=100&pn=1&np=1&fltt=2&invt=2' +
    '&fs=m:90+t:2&fields=' + fields;
  // 解析API返回的原始数据为items数组
  function parseItems(resp) {
    if (!resp || !resp.data || !resp.data.diff) return [];
    var rawItems = resp.data.diff;
    var items = [];
    for (var i = 0; i < rawItems.length; i++) {
      var d = rawItems[i];
      var mainNetYuan = d.f62 || 0;
      var mainNetWan = mainNetYuan / 10000;
      var turnoverYuan = d.f6 || 0;
      var turnoverWan = turnoverYuan / 10000;
      items.push({
        name: d.f14 || '',
        code: d.f12 || '',
        changePct: d.f3 || 0,
        turnover: turnoverWan,
        mainNet: mainNetWan,
        mainNetYuan: mainNetYuan,
        mainPct: d.f184 || 0,
        superLargeNet: (d.f66 || 0),
        largeNet: (d.f72 || 0),
        mediumNet: (d.f78 || 0),
        smallNet: (d.f84 || 0),
        price: d.f2 || 0,
        open: d.f17 || 0,
        yesterdayClose: d.f18 || 0,
        high: d.f15 || 0,
        low: d.f16 || 0,
        volume: d.f5 || 0,
        amplitude: d.f7 || 0,
        turnoverRate: d.f8 || 0,
        volumeRatio: d.f10 || 0
      });
    }
    return items;
  }

  // 双请求获取流入+流出数据
  // po=1(降序)获取流入TOP100，po=0(升序)获取流出TOP100，合并去重
  function tryFetch(targetUrl, label) {
    return fetchWithTimeout(targetUrl, { cache: 'no-store' }, 8000).then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function(resp) {
      var items = parseItems(resp);
      if (items.length === 0) throw new Error(label + '数据为空');
      return items;
    });
  }

  // JSONP降级
  function tryJsonp(targetUrl, label) {
    return emJsonp(targetUrl, 8000).then(function(resp) {
      var items = parseItems(resp);
      if (items.length === 0) throw new Error(label + '数据为空');
      return items;
    });
  }

  // 合并流入+流出数据（按code去重，保留各自的mainNet值）
  function mergeInflowOutflow(inflowItems, outflowItems) {
    var seen = {};
    var merged = [];
    inflowItems.forEach(function(d) {
      if (!seen[d.code]) { seen[d.code] = true; merged.push(d); }
    });
    outflowItems.forEach(function(d) {
      if (!seen[d.code]) { seen[d.code] = true; merged.push(d); }
    });
    return merged;
  }

  // 方案1: push2delay fetch 双请求并行
  return Promise.all([
    tryFetch(urlInflow, 'inflow-fetch'),
    tryFetch(urlOutflow, 'outflow-fetch')
  ]).then(function(results) {
    var merged = mergeInflowOutflow(results[0], results[1]);
    if (merged.length === 0) throw new Error('双请求合并数据为空');
    var allZero = merged.every(function(d) { return Math.abs(d.mainNet) < 0.01; });
    if (allZero) throw new Error('合并数据全部mainNet为0');
    console.log('板块资金流向fetch双请求成功，流入' + results[0].length + '个，流出' + results[1].length + '个');
    return merged;
  }).catch(function(fetchErr) {
    console.warn('板块资金流向fetch双请求失败:', fetchErr.message);
    // 方案2: push2delay JSONP 双请求
    return Promise.all([
      tryJsonp(urlInflow, 'inflow-jsonp'),
      tryJsonp(urlOutflow, 'outflow-jsonp')
    ]).then(function(results) {
      var merged = mergeInflowOutflow(results[0], results[1]);
      if (merged.length === 0) throw new Error('JSONP合并数据为空');
      console.log('板块资金流向JSONP双请求成功，流入' + results[0].length + '个，流出' + results[1].length + '个');
      return merged;
    }).catch(function(jsonpErr) {
      console.warn('板块资金流向JSONP双请求失败:', jsonpErr.message);
      // 方案3: push2 JSONP 双请求
      return Promise.all([
        tryJsonp(urlInflow2, 'inflow-push2'),
        tryJsonp(urlOutflow2, 'outflow-push2')
      ]).then(function(results) {
        var merged = mergeInflowOutflow(results[0], results[1]);
        if (merged.length === 0) throw new Error('push2合并数据为空');
        console.log('板块资金流向push2双请求成功，流入' + results[0].length + '个，流出' + results[1].length + '个');
        return merged;
      }).catch(function(err2) {
        console.warn('板块资金流向所有API均失败:', err2.message);
        return _fetchSectorCapitalFlowFallback();
      });
    });
  }).then(function(items) {
    // 如果是数组，说明是API获取的items；如果是对象，说明是fallback返回的result
    if (Array.isArray(items)) {
      return _processCapitalFlowItems(items, SECTOR_FLOW_CACHE_KEY);
    }
    return items; // 已经是处理好的result（来自fallback）
  });
}

/**
 * 处理板块资金流向数据（公共逻辑：过滤、排序、分流、K线信号）
 */
function _processCapitalFlowItems(items, cacheKey) {
    // 过滤子行业分类（Ⅱ/Ⅲ/Ⅳ/Ⅴ），仅保留一级行业，避免重复计算
    items = items.filter(function(d) {
      return d.name && !/[ⅡⅢⅣⅤ]/.test(d.name);
    });

    // 按主力净流入排序（降序：最大流入在前，最大流出在后）
    items.sort(function(a, b) {
      return b.mainNet - a.mainNet;
    });

    // 严格分离流入/流出：mainNet > 0 为流入，mainNet < 0 为流出
    var inflow = items.filter(function(d) { return d.mainNet > 0; }).slice(0, 5);
    var outflowItemsNeg = items.filter(function(d) { return d.mainNet < 0; });
    var outflow;
    if (outflowItemsNeg.length > 0) {
      // 有净流出板块：outflowItemsNeg已按降序排列，取最后5个并反转（最大流出在前）
      outflow = outflowItemsNeg.slice(-5).reverse();
    } else {
      // 全线净流入：无流出板块，outflow为空
      outflow = [];
    }

    var totalMain = items.reduce(function(s, d) { return s + d.mainNet; }, 0);

    var result = {
      inflow: inflow,
      outflow: outflow,
      allItems: items,
      totalMain: totalMain,
      count: items.length,
      time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      source: 'eastmoney-realtime'
    };

    // 获取K线持续性信号（通过ETF映射，仅对有映射的板块获取）
    var etfPairs = [];
    var sectorNameToEtf = {};
    items.forEach(function(d) {
      var etfCode = SECTOR_ETF_MAP[d.name];
      if (etfCode) {
        etfPairs.push({ sectorName: d.name, etfCode: etfCode });
        sectorNameToEtf[d.name] = etfCode;
      }
    });

    if (etfPairs.length === 0) {
      // 无ETF映射，直接用实时数据做资金面分析
      items.forEach(function(d) {
        d.capitalAnalysis = _analyzeSectorCapital(d);
      });
      return result;
    }

    var etfCodes = etfPairs.map(function(p) { return p.etfCode; });
    var etfNameMap = {};
    etfPairs.forEach(function(p) { etfNameMap[p.etfCode] = p.sectorName; });

    return _fetchSectorKlineSignals(etfCodes, etfNameMap).then(function(signals) {
      items.forEach(function(d) {
        var etfCode = sectorNameToEtf[d.name];
        var sig = etfCode ? signals[etfCode] : null;
        if (sig) {
          d.signal = sig.signal;
          d.signalIcon = sig.signalIcon;
          d.signalColor = sig.signalColor;
          d.inflowDays5 = sig.inflowDays5;
          d.outflowDays5 = sig.outflowDays5;
          d.total5 = sig.total5;
          d.recent5 = sig.recent5;
        }
        d.capitalAnalysis = _analyzeSectorCapital(d);
      });
      try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: result })); } catch(e) {}
      return result;
    });
}

/**
 * 板块资金流向回退方案（ETF估算，push2delay不可用时使用）
 */
function _fetchSectorCapitalFlowFallback() {
  var SECTOR_FLOW_ETFS = [
    { name: '银行', code: 'sh512800' }, { name: '房地产', code: 'sh512200' },
    { name: '食品饮料', code: 'sh515170' }, { name: '白酒', code: 'sh512690' },
    { name: '医药', code: 'sh512010' }, { name: '新能源', code: 'sh516160' },
    { name: '军工', code: 'sh512660' }, { name: '通信', code: 'sh515880' },
    { name: '半导体', code: 'sh512480' }, { name: '券商', code: 'sh512000' },
    { name: '电子', code: 'sh159997' }, { name: '计算机', code: 'sh512720' },
    { name: '电力', code: 'sz159611' }, { name: '煤炭', code: 'sh515220' },
    { name: '有色', code: 'sh512400' }, { name: '钢铁', code: 'sh515210' },
    { name: '家电', code: 'sh159996' }, { name: '汽车', code: 'sh516110' }
  ];
  var codes = SECTOR_FLOW_ETFS.map(function(s) { return s.code; });
  var nameMap = {};
  SECTOR_FLOW_ETFS.forEach(function(s) { nameMap[s.code] = s.name; });

  return fetchTencentBatch(codes).then(function(data) {
    if (!data) return null;
    var items = [];
    for (var i = 0; i < codes.length; i++) {
      var code = codes[i];
      var d = data[code];
      if (!d) continue;
      var changePct = d.changePercent || 0;
      var turnover = d.turnover || 0;
      var direction = changePct >= 0 ? 1 : -1;
      var weight = Math.max(0.5, Math.abs(changePct));
      var estFlow = turnover * direction * weight;
      items.push({
        name: nameMap[code], code: code, changePct: changePct, turnover: turnover,
        mainNet: estFlow, price: d.price, open: d.open || 0,
        yesterdayClose: d.yesterdayClose || 0, volume: d.volume || 0,
        high: d.high || 0, low: d.low || 0, volumeRatio: 0
      });
    }
    if (items.length === 0) return null;
    items.sort(function(a, b) { return b.mainNet - a.mainNet; });
    var inflow = items.filter(function(d) { return d.mainNet > 0; }).slice(0, 5);
    var outflowItems = items.filter(function(d) { return d.mainNet < 0; });
    var outflow;
    if (outflowItems.length > 0) {
      // 有净流出：取最负的5个（已降序，取最后5个反转）
      outflow = outflowItems.slice(-5).reverse();
    } else {
      // 全线净流入：无流出板块
      outflow = [];
    }
    var totalMain = items.reduce(function(s, d) { return s + d.mainNet; }, 0);
    var result = {
      inflow: inflow, outflow: outflow, allItems: items, totalMain: totalMain,
      count: items.length,
      time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      source: 'etf-estimate'
    };
    var uniqueCodes = [];
    codes.forEach(function(c) { if (uniqueCodes.indexOf(c) < 0) uniqueCodes.push(c); });
    return _fetchSectorKlineSignals(uniqueCodes, nameMap).then(function(signals) {
      items.forEach(function(d) {
        var sig = signals[d.code];
        if (sig) {
          d.signal = sig.signal; d.signalIcon = sig.signalIcon;
          d.signalColor = sig.signalColor; d.recent5 = sig.recent5;
          d.avgVol5 = sig.avgVol5 || 0; d.klineVol = sig.todayVol || 0;
        }
        d.capitalAnalysis = _analyzeSectorCapital(d);
      });
      return result;
    });
  }).catch(function(err) {
    console.warn('板块资金流向回退也失败:', err.message);
    return null;
  });
}

/**
 * 获取板块ETF近5日K线，计算资金持续性信号
 * @param {Array} codes - ETF代码数组
 * @param {Object} nameMap - 代码→名称映射
 * @returns {Promise} resolve({ code: { signal, signalIcon, signalColor, recent5 } })
 */
function _fetchSectorKlineSignals(codes, nameMap) {
  var results = {};
  var MAX_CONCURRENT = 2; // 降低并发：4→2，配合全局信号量控制
  var index = 0;

  function processOne(code) {
    var url = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=' +
      code + ',day,,,8,qfq';
    return fetchWithTimeout(url, { cache: 'no-store' }, 5000).then(function(res) {
      return res.json();
    }).then(function(resp) {
      if (!resp || resp.code !== 0 || !resp.data) return;
      var sd = resp.data[code];
      var klines = sd.qfqday || sd.day;
      if (!klines || klines.length < 3) return;

      // 计算近5日每日估算资金流
      var dailyFlows = [];
      var dailyVols = [];  // 近5日成交量
      for (var i = Math.max(1, klines.length - 5); i < klines.length; i++) {
        var k = klines[i];
        var open = parseFloat(k[1]) || 0;
        var close = parseFloat(k[2]) || 0;
        var high = parseFloat(k[3]) || 0;
        var low = parseFloat(k[4]) || 0;
        var vol = parseFloat(k[5]) || 0; // 成交量(手)

        // 涨跌幅
        var prevClose = parseFloat(klines[i - 1][2]) || 0;
        var changePct = prevClose > 0 ? (close - prevClose) / prevClose * 100 : 0;

        // 估算成交额(万元) = 均价 × 成交量(手) × 100(股/手) / 10000
        var avgPrice = (high + low + close) / 3;
        var turnover = avgPrice * vol * 100 / 10000;

        // 估算资金流
        var dir = changePct >= 0 ? 1 : -1;
        var w = Math.max(0.5, Math.abs(changePct));
        var flow = turnover * dir * w;

        dailyFlows.push({ date: k[0], flow: flow, changePct: changePct });
        dailyVols.push(vol);
      }

      if (dailyFlows.length === 0) return;

      // === 计算近5日平均成交量（不含今日） ===
      var prevVols = dailyVols.slice(0, dailyVols.length - 1);
      var avgVol5 = 0;
      if (prevVols.length > 0) {
        avgVol5 = prevVols.reduce(function(s, v) { return s + v; }, 0) / prevVols.length;
      }
      var todayVol = dailyVols[dailyVols.length - 1] || 0;

      // === 信号判定 ===
      var n = dailyFlows.length;
      var todayFlow = dailyFlows[n - 1].flow;
      var prevFlows = dailyFlows.slice(0, n - 1); // 不含今天
      var prevTotal = prevFlows.reduce(function(s, d) { return s + d.flow; }, 0);
      var prevInflowDays = prevFlows.filter(function(d) { return d.flow > 0; }).length;
      var total5 = dailyFlows.reduce(function(s, d) { return s + d.flow; }, 0);
      var inflowDays5 = dailyFlows.filter(function(d) { return d.flow > 0; }).length;

      var signal, signalIcon, signalColor;

      if (todayFlow > 0) {
        // 今日流入
        if (inflowDays5 >= 4 && total5 > 0) {
          // 连续多日流入
          signal = '持续轮动'; signalIcon = '▲▲'; signalColor = 'green';
        } else if (inflowDays5 >= 3 && total5 > 0) {
          // 多数日流入
          signal = '趋势形成'; signalIcon = '▲'; signalColor = 'green';
        } else if (prevInflowDays <= 1 || prevTotal < 0) {
          // 今日流入但前期无持续，疑似一日游
          signal = '一日游'; signalIcon = '◇'; signalColor = 'yellow';
        } else {
          signal = '观望'; signalIcon = '→'; signalColor = 'yellow';
        }
      } else {
        // 今日流出
        if (inflowDays5 <= 1 && total5 < 0) {
          // 连续多日流出
          signal = '持续流出'; signalIcon = '▼▼'; signalColor = 'red';
        } else if (inflowDays5 <= 2 && total5 < 0) {
          signal = '趋势走弱'; signalIcon = '▼'; signalColor = 'red';
        } else if (prevInflowDays >= 3 && prevTotal > 0) {
          // 前期持续流入，今日流出，可能是洗盘/回调
          signal = '回调洗盘'; signalIcon = '◇'; signalColor = 'cyan';
        } else {
          signal = '观望'; signalIcon = '→'; signalColor = 'yellow';
        }
      }

      results[code] = {
        signal: signal,
        signalIcon: signalIcon,
        signalColor: signalColor,
        inflowDays5: inflowDays5,   // 近5日流入天数
        outflowDays5: 5 - inflowDays5, // 近5日流出天数
        total5: total5,              // 近5日累计资金流
        recent5: dailyFlows,
        avgVol5: avgVol5,      // 近5日平均成交量(手，不含今日)
        todayVol: todayVol      // 今日K线成交量(手)
      };
    }).catch(function(err) {
      // K线获取失败不影响主流程
    });
  }

  // 并发限制执行：最多 MAX_CONCURRENT 个同时请求
  function next() {
    if (index >= codes.length) return Promise.resolve();
    var code = codes[index++];
    return processOne(code).then(next);
  }
  var workers = [];
  for (var w = 0; w < Math.min(MAX_CONCURRENT, codes.length); w++) workers.push(next());

  return Promise.all(workers).then(function() { return results; });
}

/**
 * 板块资金面分析：放量/缩量、高开/低开、获利盘/出逃/做空预判
 * @param {object} d - 板块数据（含 open, yesterdayClose, volume, avgVol5, changePct 等）
 * @returns {object} { volumeType, volumeRatio, volumeDesc, openType, openPct, prediction, predColor, predIcon }
 */
function _analyzeSectorCapital(d) {
  // === 1. 量能分析：放量/缩量 ===
  // 优先使用东方财富真实量比(f10)，降级使用K线成交量估算
  var todayVol = d.volume || d.klineVol || 0;
  var avgVol5 = d.avgVol5 || 0;

  var volumeRatio = d.volumeRatio || 0;  // 真实量比(push2delay f10)
  var volumeType = '数据不足';
  var volumeDesc = '—';
  var volumeColor = 'yellow';

  // 无真实量比时，用成交量估算
  if (volumeRatio === 0 && todayVol > 0 && avgVol5 > 0) {
    volumeRatio = todayVol / avgVol5;
  }

  if (volumeRatio > 0) {
    if (volumeRatio >= 2.0) {
      volumeType = '显著放量';
      volumeDesc = '量比' + volumeRatio.toFixed(2) + '·成交' + _formatVolume(todayVol);
      volumeColor = 'red';
    } else if (volumeRatio >= 1.5) {
      volumeType = '放量';
      volumeDesc = '量比' + volumeRatio.toFixed(2) + '·成交' + _formatVolume(todayVol);
      volumeColor = 'red';
    } else if (volumeRatio >= 0.7) {
      volumeType = '平量';
      volumeDesc = '量比' + volumeRatio.toFixed(2) + '·成交' + _formatVolume(todayVol);
      volumeColor = 'yellow';
    } else if (volumeRatio >= 0.5) {
      volumeType = '缩量';
      volumeDesc = '量比' + volumeRatio.toFixed(2) + '·成交' + _formatVolume(todayVol);
      volumeColor = 'green';
    } else {
      volumeType = '显著缩量';
      volumeDesc = '量比' + volumeRatio.toFixed(2) + '·成交' + _formatVolume(todayVol);
      volumeColor = 'green';
    }
  }

  // === 2. 开盘分析：高开/低开/平开 ===
  var openType = '平开';
  var openPct = 0;
  var openColor = 'yellow';

  if (d.open > 0 && d.yesterdayClose > 0) {
    openPct = (d.open - d.yesterdayClose) / d.yesterdayClose * 100;
    if (openPct > 0.5) {
      openType = '高开';
      openColor = 'red';
    } else if (openPct < -0.5) {
      openType = '低开';
      openColor = 'green';
    } else {
      openType = '平开';
      openColor = 'yellow';
    }
  }

  // === 3. 综合预判：获利盘/出逃/做空 ===
  // 基于开盘类型 × 量能 × 涨跌方向的组合判断
  var isUp = d.changePct >= 0;
  var isBigUp = d.changePct >= 1.5;
  var isBigDown = d.changePct <= -1.5;
  var isVolumeUp = volumeRatio >= 1.3;   // 放量
  var isVolumeDown = volumeRatio > 0 && volumeRatio <= 0.8; // 缩量
  var isHighOpen = openType === '高开';
  var isLowOpen = openType === '低开';

  var prediction = '观望';
  var predColor = 'yellow';
  var predIcon = '→';

  if (isHighOpen) {
    if (isVolumeUp && isUp) {
      prediction = '资金追涨'; predColor = 'red'; predIcon = '▲';
    } else if (isVolumeUp && !isUp) {
      prediction = '获利盘出逃'; predColor = 'green'; predIcon = '▼';
    } else if (isVolumeDown && isUp) {
      prediction = '诱多嫌疑'; predColor = 'yellow'; predIcon = '⚠';
    } else if (isVolumeDown && !isUp) {
      prediction = '抛压显现'; predColor = 'green'; predIcon = '▼';
    } else if (isBigDown) {
      prediction = '高开低走·获利出逃'; predColor = 'green'; predIcon = '▼';
    } else {
      prediction = '高开震荡'; predColor = 'yellow'; predIcon = '→';
    }
  } else if (isLowOpen) {
    if (isVolumeUp && isUp) {
      prediction = '资金抄底'; predColor = 'red'; predIcon = '▲';
    } else if (isVolumeUp && !isUp) {
      if (isBigDown) {
        prediction = '恐慌抛售·做空'; predColor = 'green'; predIcon = '▼▼';
      } else {
        prediction = '出逃·做空'; predColor = 'green'; predIcon = '▼';
      }
    } else if (isVolumeDown && isUp) {
      prediction = '弱反弹'; predColor = 'yellow'; predIcon = '→';
    } else if (isVolumeDown && !isUp) {
      prediction = '缩量阴跌'; predColor = 'green'; predIcon = '▼';
    } else if (isBigDown) {
      prediction = '低开走弱·做空'; predColor = 'green'; predIcon = '▼';
    } else {
      prediction = '低开震荡'; predColor = 'yellow'; predIcon = '→';
    }
  } else {
    // 平开
    if (isVolumeUp && isUp) {
      prediction = '放量上涨'; predColor = 'red'; predIcon = '▲';
    } else if (isVolumeUp && !isUp) {
      prediction = '放量下跌·出逃'; predColor = 'green'; predIcon = '▼';
    } else if (isVolumeDown && isUp) {
      prediction = '缩量上涨'; predColor = 'yellow'; predIcon = '→';
    } else if (isVolumeDown && !isUp) {
      prediction = '缩量下跌'; predColor = 'green'; predIcon = '▼';
    } else {
      prediction = '缩量震荡'; predColor = 'yellow'; predIcon = '→';
    }
  }

  return {
    volumeType: volumeType,
    volumeRatio: volumeRatio,
    volumeDesc: volumeDesc,
    volumeColor: volumeColor,
    openType: openType,
    openPct: openPct,
    openColor: openColor,
    prediction: prediction,
    predColor: predColor,
    predIcon: predIcon,
    todayVol: todayVol,
    avgVol5: avgVol5
  };
}

/**
 * 格式化成交量（手）为易读字符串
 * @param {number} vol - 成交量(手)
 * @returns {string} 如 "123.4万手" 或 "8560手"
 */
function _formatVolume(vol) {
  if (vol >= 1e8) return (vol / 1e8).toFixed(2) + '亿手';
  if (vol >= 1e4) return (vol / 1e4).toFixed(1) + '万手';
  return vol.toFixed(0) + '手';
}

/**
 * 渲染市场主力资金流向方向
 * @param {object} data - fetchSectorCapitalFlow 返回的数据
 */
function renderMarketFlow(data) {
  var summaryEl = document.getElementById('mfSummary');
  var timeEl = document.getElementById('mfTime');
  var inflowEl = document.getElementById('mfInflowList');
  var outflowEl = document.getElementById('mfOutflowList');

  if (!data) {
    if (summaryEl) summaryEl.innerHTML = '<span style="color:var(--muted)">板块资金数据暂不可用</span>';
    if (inflowEl) inflowEl.innerHTML = '<div class="mf-loading">暂无数据</div>';
    if (outflowEl) outflowEl.innerHTML = '<div class="mf-loading">暂无数据</div>';
    return;
  }

  // 估算值单位为万元，formatFlowAmount期望元，转换
  var YUAN_FACTOR = 10000;

  // 汇总信息 —— 涨/流入=绿，跌/流出=红
  var totalStr = formatFlowAmount(data.totalMain * YUAN_FACTOR);
  var totalCls = data.totalMain >= 0 ? 'sig-green' : 'sig-red';
  var direction = data.totalMain >= 0 ? '净流入' : '净流出';

  // 检测是否全线净流入（流出列表为空或流出列表中无负值）
  var hasRealOutflow = data.outflow.length > 0 && data.outflow.some(function(d) { return d.mainNet < 0; });
  var outflowLabel = hasRealOutflow ? '流出' : '流入最少';

  // 流入方向摘要
  var inflowNames = data.inflow.slice(0, 3).map(function(d) { return d.name; }).join('、') || '无';
  var outflowNames = data.outflow.slice(0, 3).map(function(d) { return d.name; }).join('、') || '无';

  if (summaryEl) {
    var summaryHtml = '今日主力<b class="' + totalCls + '">' + direction + totalStr + '</b>';
    if (data.inflow.length > 0) {
      summaryHtml += ' · 流入: <b class="sig-green">' + inflowNames + '</b>';
    }
    if (hasRealOutflow) {
      summaryHtml += ' · 流出: <b class="sig-red">' + outflowNames + '</b>';
    } else if (data.outflow.length === 0) {
      summaryHtml += ' <span style="color:var(--neon-red);font-size:0.48rem">（全线净流入）</span>';
    }
    if (data.inflow.length === 0 && data.outflow.length === 0) {
      summaryHtml += ' <span style="color:var(--muted)">（各板块主力资金均为零）</span>';
    }
    summaryHtml += ' <span style="font-size:0.48rem;color:var(--muted);opacity:0.85">（东方财富实时资金流向）</span>';
    summaryEl.innerHTML = summaryHtml;
  }
  if (timeEl) timeEl.textContent = data.time;

  // 找最大绝对值用于bar宽度归一化
  var maxAbs = 0;
  data.inflow.forEach(function(d) { if (Math.abs(d.mainNet) > maxAbs) maxAbs = Math.abs(d.mainNet); });
  data.outflow.forEach(function(d) { if (Math.abs(d.mainNet) > maxAbs) maxAbs = Math.abs(d.mainNet); });
  if (maxAbs === 0) maxAbs = 1;

  // 渲染流入前5（严格只显示 mainNet > 0 的板块）
  if (inflowEl) {
    var html = '';
    if (data.inflow.length === 0) {
      html = '<div class="mf-empty">今日无净流入板块</div>';
    } else {
      data.inflow.forEach(function(d) {
        var isUp = d.changePct >= 0;
        var barW = Math.round(Math.abs(d.mainNet) / maxAbs * 100);
        // 信号标签 + 连续天数
        var sigHtml = '';
        if (d.signal) {
          sigHtml = '<span class="mf-item-signal sig-' + d.signalColor + '" title="' + d.signal + '">' +
            d.signalIcon + ' ' + d.signal + '</span>';
        }
        // 连涨/连跌天数标签
        var streakHtml = '';
        if (d.inflowDays5 !== undefined) {
          if (d.inflowDays5 >= 4) {
            streakHtml = '<span class="mf-item-streak sig-green" title="近5日流入' + d.inflowDays5 + '天">连涨' + d.inflowDays5 + '天</span>';
          } else if (d.outflowDays5 >= 4) {
            streakHtml = '<span class="mf-item-streak sig-red" title="近5日流出' + d.outflowDays5 + '天">连跌' + d.outflowDays5 + '天</span>';
          }
        }
        // 流入列表：绿色条 + 正数金额（加+号）
        var amtStr = '+' + formatFlowAmount(d.mainNet * YUAN_FACTOR);
        html += '<div class="mf-item ' + (isUp ? 'up' : 'down') + '">' +
          '<span class="mf-item-name">' + d.name + '</span>' +
          sigHtml +
          streakHtml +
          '<span class="mf-item-change">' + (isUp ? '+' : '') + d.changePct.toFixed(2) + '%</span>' +
          '<span class="mf-item-amount ' + (isUp ? 'sig-green' : 'sig-red') + '">' + amtStr + '</span>' +
          '</div>' +
          '<div class="mf-item-bar"><div class="mf-item-bar-fill bar-fill-green" style="width:' + barW + '%"></div></div>';
      });
    }
    inflowEl.innerHTML = html;
  }

  // 渲染流出前5（严格只显示 mainNet < 0 的板块）
  if (outflowEl) {
    var html2 = '';
    // 更新列标题
    var outflowTitleEl = outflowEl.parentElement.querySelector('.mf-col-title');
    if (outflowTitleEl) {
      outflowTitleEl.innerHTML = (hasRealOutflow ? '流出前5' : '无流出') + ' <span class="mf-arrow">↓</span>';
    }
    if (data.outflow.length === 0) {
      // 全线净流入时，流出列表显示提示而非填充正数板块
      html2 = '<div class="mf-empty">全线净流入<br>无流出板块</div>';
    } else {
      data.outflow.forEach(function(d) {
        var isUp = d.changePct >= 0;
        var barW = Math.round(Math.abs(d.mainNet) / maxAbs * 100);
        // 信号标签 + 连续天数
        var sigHtml = '';
        if (d.signal) {
          sigHtml = '<span class="mf-item-signal sig-' + d.signalColor + '" title="' + d.signal + '">' +
            d.signalIcon + ' ' + d.signal + '</span>';
        }
        // 连涨/连跌天数标签
        var streakHtml = '';
        if (d.inflowDays5 !== undefined) {
          if (d.inflowDays5 >= 4) {
            streakHtml = '<span class="mf-item-streak sig-green" title="近5日流入' + d.inflowDays5 + '天">连涨' + d.inflowDays5 + '天</span>';
          } else if (d.outflowDays5 >= 4) {
            streakHtml = '<span class="mf-item-streak sig-red" title="近5日流出' + d.outflowDays5 + '天">连跌' + d.outflowDays5 + '天</span>';
          }
        }
        // 流出列表：红色条 + 负数金额（保留负号）
        var amtStr = formatFlowAmount(d.mainNet * YUAN_FACTOR);
        html2 += '<div class="mf-item ' + (isUp ? 'up' : 'down') + '">' +
          '<span class="mf-item-name">' + d.name + '</span>' +
          sigHtml +
          streakHtml +
          '<span class="mf-item-change">' + (isUp ? '+' : '') + d.changePct.toFixed(2) + '%</span>' +
          '<span class="mf-item-amount ' + (isUp ? 'sig-green' : 'sig-red') + '">' + amtStr + '</span>' +
          '</div>' +
          '<div class="mf-item-bar"><div class="mf-item-bar-fill bar-fill-red" style="width:' + barW + '%"></div></div>';
      });
    }
    outflowEl.innerHTML = html2;
  }
}

/**
 * 渲染板块资金面分析表格
 * @param {object} data - fetchSectorCapitalFlow 返回的数据（含 allItems）
 */
// 板块资金面筛选状态
var _scaFilterState = {
  volume: 'all',   // all | 放量 | 缩量 | 平量
  open: 'all',     // all | 高开 | 低开 | 平开
  pred: 'all',     // all | red | green | yellow
  chg: 'all',      // all | up | down
  sort: 'risk'     // risk | chgDesc | chgAsc | volDesc
};
var _scaRawData = null; // 缓存原始数据供筛选重渲染
var _scaPageSize = 30;  // 每页显示数量（全部展开模式）
var _scaCurrentPage = 1; // 当前页码
var _scaShowAll = false; // false: 精简模式(前10流入+前10流出); true: 全部

function renderSectorCapitalAnalysis(data) {
  var summaryEl = document.getElementById('scaSummary');
  var tbodyEl = document.getElementById('scaTableBody');

  if (!data || !data.allItems || data.allItems.length === 0) {
    if (summaryEl) summaryEl.innerHTML = '<span style="color:var(--muted);font-size:0.6rem">板块资金面数据暂不可用</span>';
    if (tbodyEl) tbodyEl.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:0.8rem;color:var(--muted);font-size:0.64rem">暂无数据</td></tr>';
    return;
  }

  // 缓存原始数据
  _scaRawData = data;

  var items = data.allItems.filter(function(d) { return d.capitalAnalysis; });

  // === 汇总统计（基于全量数据，不受筛选影响）===
  var volUpCount = 0, volDownCount = 0;
  var highOpenCount = 0, lowOpenCount = 0;
  var outflowCount = 0, inflowCount = 0;
  items.forEach(function(d) {
    var ca = d.capitalAnalysis;
    if (ca.volumeType === '放量' || ca.volumeType === '显著放量') volUpCount++;
    if (ca.volumeType === '缩量' || ca.volumeType === '显著缩量') volDownCount++;
    if (ca.openType === '高开') highOpenCount++;
    if (ca.openType === '低开') lowOpenCount++;
    if (ca.predColor === 'green') outflowCount++;
    if (ca.predColor === 'red') inflowCount++;
  });

  if (summaryEl) {
    summaryEl.innerHTML =
      '<span class="sca-stat">放量<b class="sig-green">' + volUpCount + '</b>个</span>' +
      '<span class="sca-stat">缩量<b class="sig-red">' + volDownCount + '</b>个</span>' +
      '<span class="sca-stat">高开<b class="sig-green">' + highOpenCount + '</b>个</span>' +
      '<span class="sca-stat">低开<b class="sig-red">' + lowOpenCount + '</b>个</span>' +
      '<span class="sca-stat">出逃/做空<b class="sig-red">' + outflowCount + '</b>个</span>' +
      '<span class="sca-stat">追涨/抄底<b class="sig-green">' + inflowCount + '</b>个</span>' +
      ' <span style="color:var(--muted);opacity:0.85;font-size:0.48rem">更新于 ' + (data.time || '') + '（东方财富实时数据）</span>';
  }

  // === 筛选 ===
  var filtered = items.filter(function(d) {
    var ca = d.capitalAnalysis;

    // 量能筛选
    if (_scaFilterState.volume !== 'all') {
      if (_scaFilterState.volume === '放量' && ca.volumeType !== '放量' && ca.volumeType !== '显著放量') return false;
      if (_scaFilterState.volume === '缩量' && ca.volumeType !== '缩量' && ca.volumeType !== '显著缩量') return false;
      if (_scaFilterState.volume === '平量' && ca.volumeType !== '平量') return false;
    }

    // 开盘筛选
    if (_scaFilterState.open !== 'all' && ca.openType !== _scaFilterState.open) return false;

    // 预判筛选
    if (_scaFilterState.pred !== 'all' && ca.predColor !== _scaFilterState.pred) return false;

    // 涨跌筛选
    if (_scaFilterState.chg === 'up' && d.changePct < 0) return false;
    if (_scaFilterState.chg === 'down' && d.changePct >= 0) return false;

    return true;
  });

  // === 排序 ===
  var predPriority = { 'green': 0, 'yellow': 1, 'cyan': 2, 'red': 3 };
  switch (_scaFilterState.sort) {
    case 'chgDesc':
      filtered.sort(function(a, b) { return b.changePct - a.changePct; });
      break;
    case 'chgAsc':
      filtered.sort(function(a, b) { return a.changePct - b.changePct; });
      break;
    case 'volDesc':
      filtered.sort(function(a, b) {
        return (b.capitalAnalysis.volumeRatio || 0) - (a.capitalAnalysis.volumeRatio || 0);
      });
      break;
    default: // risk（风险优先）
      filtered.sort(function(a, b) {
        var pa = predPriority[a.capitalAnalysis.predColor] || 1;
        var pb = predPriority[b.capitalAnalysis.predColor] || 1;
        if (pa !== pb) return pa - pb;
        return (b.capitalAnalysis.volumeRatio || 0) - (a.capitalAnalysis.volumeRatio || 0);
      });
  }

  // === 渲染表格 ===
  if (tbodyEl) {
    if (filtered.length === 0) {
      tbodyEl.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:0.8rem;color:var(--muted);font-size:0.64rem">无符合条件的板块，请调整筛选条件</td></tr>';
    } else {
      // 判断是否处于精简模式：无筛选 + 风险排序 + 未点击"查看全部"
      var filtersActive = _scaFilterState.volume !== 'all' ||
                          _scaFilterState.open !== 'all' ||
                          _scaFilterState.pred !== 'all' ||
                          _scaFilterState.chg !== 'all';
      var summaryMode = !_scaShowAll && !filtersActive && _scaFilterState.sort === 'risk';

      var html = '';

      if (summaryMode) {
        // === 精简模式：资金流出前10 + 资金流入前10 ===
        var inflowItems = filtered.filter(function(d) { return d.capitalAnalysis.predColor === 'red'; });
        var outflowItems = filtered.filter(function(d) { return d.capitalAnalysis.predColor === 'green'; });
        var topInflow = inflowItems.slice(0, 10);
        var topOutflow = outflowItems.slice(0, 10);
        var shownCount = topInflow.length + topOutflow.length;

        // 流出前10（风险优先展示）
        if (topOutflow.length > 0) {
          html += '<tr class="sca-section-row"><td colspan="5">' +
            '<span class="sig-red">▼ 资金流出前 ' + topOutflow.length + '（获利出逃/做空）</span>' +
            '</td></tr>';
          topOutflow.forEach(function(d, idx) { html += _renderScaRow(d, idx); });
        }

        // 流入前10
        if (topInflow.length > 0) {
          html += '<tr class="sca-section-row"><td colspan="5">' +
            '<span class="sig-green">▲ 资金流入前 ' + topInflow.length + '（追涨/抄底）</span>' +
            '</td></tr>';
          topInflow.forEach(function(d, idx) { html += _renderScaRow(d, idx); });
        }

        // "查看全部"按钮
        if (filtered.length > shownCount) {
          html += '<tr><td colspan="5" style="padding:0;">' +
            '<button class="load-more-btn" onclick="showAllSca()">查看全部 ' + filtered.length + ' 个板块</button>' +
            '</td></tr>';
        }
      } else {
        // === 全部模式：分页加载 ===
        var displayCount = _scaPageSize * _scaCurrentPage;
        var displayItems = filtered.slice(0, displayCount);

        // 返回精简模式按钮
        if (_scaShowAll && !filtersActive && _scaFilterState.sort === 'risk') {
          html += '<tr><td colspan="5" style="padding:0;">' +
            '<button class="load-more-btn" onclick="backToSummarySca()" style="color:var(--muted)">← 返回精简视图</button>' +
            '</td></tr>';
        }

        displayItems.forEach(function(d, idx) { html += _renderScaRow(d, idx); });

        // "加载更多"按钮
        if (filtered.length > displayCount) {
          html += '<tr><td colspan="5" style="padding:0;">' +
            '<button class="load-more-btn" onclick="loadMoreSca()">展开更多（剩余 ' + (filtered.length - displayCount) + ' 个板块）</button>' +
            '</td></tr>';
        }
      }

      tbodyEl.innerHTML = html;
    }
  }

  // 更新筛选结果计数
  var countEl = document.getElementById('scaFilterCount');
  if (countEl) {
    countEl.textContent = '显示 ' + filtered.length + '/' + items.length + ' 个板块';
  }
}

/**
 * 渲染单行板块数据（桌面表格行 / 移动端卡片）
 */
function _renderScaRow(d, idx) {
  var ca = d.capitalAnalysis;
  var isUp = d.changePct >= 0;
  var chgCls = isUp ? 'sig-green' : 'sig-red';
  var chgStr = (isUp ? '+' : '') + d.changePct.toFixed(2) + '%';

  // 量能标签
  var volHtml = '<span class="sca-vol-tag sig-' + (ca.volumeColor === 'red' ? 'green' : ca.volumeColor === 'green' ? 'red' : ca.volumeColor) + '">' + ca.volumeType + '</span>' +
    (ca.volumeDesc !== '—' ? '<span class="sca-vol-desc">' + ca.volumeDesc + '</span>' : '');

  // 开盘标签
  var openPctStr = ca.openPct !== 0 ? (ca.openPct > 0 ? '+' : '') + ca.openPct.toFixed(2) + '%' : '—';
  var openHtml = '<span class="sca-open-tag sig-' + (ca.openColor === 'red' ? 'green' : ca.openColor === 'green' ? 'red' : ca.openColor) + '">' + ca.openType + '</span>' +
    '<span class="sca-open-pct">' + openPctStr + '</span>';

  // 预判标签
  var predHtml = '<span class="sca-pred-tag sig-' + (ca.predColor === 'red' ? 'green' : ca.predColor === 'green' ? 'red' : ca.predColor) + '">' + ca.predIcon + ' ' + ca.prediction + '</span>';

  var rowClass = idx % 2 === 0 ? 'sca-row-odd ' : '';
  return '<tr class="' + rowClass + 'sca-card-row" onclick="toggleScaCard(this)">' +
    '<td class="sca-td-name" data-label="板块">' + d.name + '</td>' +
    '<td class="sca-detail-cell" data-label="量能">' + volHtml + '</td>' +
    '<td class="sca-detail-cell" data-label="开盘">' + openHtml + '</td>' +
    '<td class="sca-chg ' + chgCls + '" data-label="涨跌">' + chgStr + '</td>' +
    '<td data-label="资金预判">' + predHtml + '</td>' +
    '</tr>';
}

/**
 * 绑定板块资金面筛选按钮事件
 */
function bindScaFilters() {
  document.addEventListener('click', function(e) {
    var btn = e.target;
    if (!btn.classList || !btn.classList.contains('sca-filter-btn')) return;

    var filterType = btn.getAttribute('data-filter-type');
    var filterValue = btn.getAttribute('data-filter-value');

    // 更新按钮激活状态（同组内互斥）
    var siblings = btn.parentNode.querySelectorAll('.sca-filter-btn');
    siblings.forEach(function(s) { s.classList.remove('active'); });
    btn.classList.add('active');

    // 更新筛选状态
    _scaFilterState[filterType] = filterValue;

    // 筛选条件变化时重置页码和视图模式
    _scaCurrentPage = 1;
    _scaShowAll = false;

    // 重新渲染（使用缓存数据，无需重新请求）
    if (_scaRawData) {
      renderSectorCapitalAnalysis(_scaRawData);
    }
  });
}

/**
 * 加载更多板块数据
 */
function loadMoreSca() {
  _scaCurrentPage++;
  if (_scaRawData) {
    renderSectorCapitalAnalysis(_scaRawData);
  }
}

/**
 * 展开/收起移动端卡片详情（仅移动端生效）
 */
function toggleScaCard(row) {
  if (window.innerWidth <= 640) {
    row.classList.toggle('expanded');
  }
}

/**
 * 切换到全部板块视图
 */
function showAllSca() {
  _scaShowAll = true;
  _scaCurrentPage = 1;
  if (_scaRawData) {
    renderSectorCapitalAnalysis(_scaRawData);
  }
}

/**
 * 返回精简视图（前10流入+前10流出）
 */
function backToSummarySca() {
  _scaShowAll = false;
  _scaCurrentPage = 1;
  if (_scaRawData) {
    renderSectorCapitalAnalysis(_scaRawData);
  }
}

/**
 * 切换板块资金面分析折叠/展开
 */
function toggleScaCollapse() {
  var box = document.getElementById('sectorCapitalBox');
  var icon = document.getElementById('scaToggleIcon');
  if (!box) return;
  if (box.classList.contains('sca-collapsed')) {
    box.classList.remove('sca-collapsed');
    if (icon) { icon.classList.add('rotated'); icon.textContent = '▾'; }
  } else {
    box.classList.add('sca-collapsed');
    if (icon) { icon.classList.remove('rotated'); icon.textContent = '▸'; }
  }
}

/**
 * 获取个股近N日主力资金流向（基于腾讯K线数据计算量价代理）
 * 东方财富push2his接口被沙箱代理屏蔽，改用腾讯K线API(CORS)+量价模型估算
 * @param {string} secCode - 股票代码（如 600519 或 sh600519）
 * @param {number} days - 获取天数，默认20日
 * @returns {Promise} resolve(flowData) - { days: [{date, main, small, medium, large, xlarge, mainPct, price, changePct}] }
 */
function fetchCapitalFlow(secCode, days) {
  days = days || 20;
  var code = secCode.replace(/^(sh|sz|hk)/i, '');

  // 构建腾讯代码
  var tencentCode;
  if (code.charAt(0) === '6' || code.charAt(0) === '5' || code.charAt(0) === '9') tencentCode = 'sh' + code;
  else if (code.charAt(0) === '0' || code.charAt(0) === '3' || code.charAt(0) === '1' || code.charAt(0) === '2') tencentCode = 'sz' + code;
  else if (secCode.indexOf('sh') === 0) tencentCode = 'sh' + code;
  else if (secCode.indexOf('sz') === 0) tencentCode = 'sz' + code;
  else return Promise.reject(new Error('不支持的市场代码'));

  // 腾讯日K线API（支持CORS）
  // 格式: code,day,start_date,end_date,count,qfq
  var url = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=' +
    tencentCode + ',day,,,' + (days + 5) + ',qfq';

  return fetchWithTimeout(url, { cache: 'no-store' }, 6000).then(function(res) {
    return res.json();
  }).then(function(resp) {
    if (!resp || resp.code !== 0 || !resp.data) return null;

    var stockData = resp.data[tencentCode];
    var klines = stockData.qfqday || stockData.day;
    if (!klines || klines.length === 0) return null;

    // 腾讯K线格式: [日期, 开盘, 收盘, 最高, 最低, 成交量(手)]
    var parsed = klines.map(function(k, i) {
      var date = k[0];
      var open = parseFloat(k[1]) || 0;
      var close = parseFloat(k[2]) || 0;
      var high = parseFloat(k[3]) || 0;
      var low = parseFloat(k[4]) || 0;
      var volume = parseFloat(k[5]) || 0; // 成交量(手)

      // 涨跌幅
      var changePct = 0;
      if (i > 0) {
        var prevClose = parseFloat(klines[i - 1][2]) || 0;
        if (prevClose > 0) changePct = (close - prevClose) / prevClose * 100;
      }

      // === 量价资金流向代理模型 ===
      // 典型价格 = (最高+最低+收盘)/3
      var typicalPrice = (high + low + close) / 3;
      // 总资金流 = 典型价格 × 成交量(手) × 100(股/手)
      var moneyFlow = typicalPrice * volume * 100;

      // 日内方向强度: (收盘-开盘)/(最高-最低), 范围[-1,1]
      var range = high - low;
      var direction = range > 0.01 ? (close - open) / range : 0;
      direction = Math.max(-1, Math.min(1, direction));

      // 量比: 当日量 vs 前5日均量
      var volAvg5 = 0;
      if (i >= 5) {
        for (var j = 1; j <= 5; j++) volAvg5 += parseFloat(klines[i - j][5]) || 0;
        volAvg5 /= 5;
      } else {
        volAvg5 = volume;
      }
      var volRatio = volAvg5 > 0 ? volume / volAvg5 : 1;

      // 主力净流入 = 方向 × 资金流 × 量比修正
      // 量比>1.5表示放量, 放大主力信号; 量比<0.7表示缩量, 减弱信号
      var volWeight = volRatio > 1.5 ? 1.3 : volRatio < 0.7 ? 0.6 : 1.0;
      var main = direction * moneyFlow * volWeight;

      // 超大单/大单: 主力的子分类(按比例拆分)
      var xlarge = main * 0.55; // 超大单约占主力55%
      var large = main * 0.45;  // 大单约占主力45%

      // 散户(小单+中单) = -主力 (零和博弈)
      var small = -main * 0.65; // 小单约占反方向65%
      var medium = -main * 0.35; // 中单约占反方向35%

      // 主力净流入占比
      var totalAbs = Math.abs(main) + Math.abs(small) + Math.abs(medium);
      var mainPct = totalAbs > 0 ? (main / totalAbs * 100) : 0;

      return {
        date: date,
        main: main,
        small: small,
        medium: medium,
        large: large,
        xlarge: xlarge,
        mainPct: mainPct,
        price: close,
        changePct: changePct,
        volume: volume,
        volRatio: volRatio
      };
    });

    // 取最近N天
    if (parsed.length > days) parsed = parsed.slice(-days);

    return {
      name: '',
      code: code,
      days: parsed,
      source: 'tencent-volprice-proxy'
    };
  }).catch(function(err) {
    console.warn('主力资金数据获取失败:', err.message);
    return null;
  });
}

/**
 * 分析主力资金行为：洗盘/筑底/控股/出货等
 * @param {object} flowData - fetchCapitalFlow 返回的数据
 * @param {object} stockData - 当前股票行情数据
 * @returns {object} 分析结果
 */
function analyzeCapitalFlow(flowData, stockData) {
  if (!flowData || !flowData.days || flowData.days.length === 0) return null;

  var days = flowData.days;
  var n = days.length;
  var recent5 = days.slice(-5);
  var recent10 = days.slice(-10);

  // === 1. 主力净流入统计 ===
  var totalMain = days.reduce(function(s, d) { return s + d.main; }, 0);
  var recent5Main = recent5.reduce(function(s, d) { return s + d.main; }, 0);
  var recent10Main = recent10.reduce(function(s, d) { return s + d.main; }, 0);

  // 超大单统计（真正的大资金）
  var totalXlarge = days.reduce(function(s, d) { return s + d.xlarge; }, 0);
  var recent5Xlarge = recent5.reduce(function(s, d) { return s + d.xlarge; }, 0);

  // 净流入天数占比
  var inflowDays = days.filter(function(d) { return d.main > 0; }).length;
  var inflowRatio = inflowDays / n;

  // 近5日净流入天数
  var recent5Inflow = recent5.filter(function(d) { return d.main > 0; }).length;

  // === 2. 量价关系分析 ===
  // 近5日均价 vs 近20日均价
  var avgPrice5 = recent5.reduce(function(s, d) { return s + d.price; }, 0) / recent5.length;
  var avgPrice20 = days.reduce(function(s, d) { return s + d.price; }, 0) / n;
  var priceTrend = (avgPrice5 - avgPrice20) / avgPrice20 * 100;

  // 近5日涨跌幅
  var recent5Change = recent5.reduce(function(s, d) { return s + d.changePct; }, 0);

  // === 3. 主力行为判定 ===
  var signals = [];
  var mainSignal = '无明显主力行为';
  var signalColor = 'yellow';
  var signalIcon = '○';

  // --- 筑底信号 ---
  // 特征：股价在低位区间，主力持续净流入，但股价涨幅不大
  var isLowPrice = stockData && stockData.pe > 0 && stockData.pe < 30;
  var isBottoming = recent5Main > 0 && recent10Main > 0 &&
                    Math.abs(recent5Change) < 5 &&
                    inflowRatio > 0.5 &&
                    recent5Xlarge > 0;
  if (isBottoming) {
    signals.push('筑底信号');
    mainSignal = '主力低位吸筹·筑底中';
    signalColor = 'green';
    signalIcon = '▲';
  }

  // --- 洗盘信号 ---
  // 特征：股价下跌但主力资金净流入（散户割肉主力接货）
  var isWashing = recent5Change < -3 && recent5Main > 0 && recent5Inflow >= 3;
  if (isWashing) {
    signals.push('洗盘信号');
    if (mainSignal === '无明显主力行为') {
      mainSignal = '主力洗盘·借下跌吸筹';
      signalColor = 'green';
      signalIcon = '◇';
    }
  }

  // --- 控股信号 ---
  // 特征：主力持续大额净流入，超大单占比高，股价波动小
  var totalXlargeAbs = Math.abs(totalXlarge);
  var isControlling = totalMain > 0 && totalXlarge > totalMain * 0.5 &&
                      inflowRatio > 0.6 &&
                      Math.abs(priceTrend) < 8;
  if (isControlling) {
    signals.push('控盘信号');
    if (mainSignal === '无明显主力行为') {
      mainSignal = '主力高度控盘';
      signalColor = 'cyan';
      signalIcon = '★';
    }
  }

  // --- 出货信号 ---
  // 特征：股价上涨但主力资金净流出（拉高出货）
  var isDistributing = recent5Change > 3 && recent5Main < 0 && recent5Xlarge < 0;
  if (isDistributing) {
    signals.push('出货信号');
    mainSignal = '主力拉高出货·警惕';
    signalColor = 'red';
    signalIcon = '▼';
  }

  // --- 出逃信号 ---
  // 特征：股价大跌且主力大额净流出
  var isFleeing = recent5Change < -5 && recent5Main < 0 && recent5Xlarge < 0;
  if (isFleeing) {
    signals.push('出逃信号');
    mainSignal = '主力出逃·坚决回避';
    signalColor = 'red';
    signalIcon = '▼';
  }

  // === 4. 资金强度评分 ===
  // 根据近5日主力净流入相对强度打分（0-100）
  // 使用相对归一化：近5日净流入 / 20日均|日流入|，适应不同市值股票
  var avgMainMag = days.reduce(function(s, d) { return s + Math.abs(d.main); }, 0) / n;
  var recent5Ratio = avgMainMag > 0 ? recent5Main / (avgMainMag * 5) : 0;
  var strengthScore = 50;
  if (recent5Main > 0) {
    strengthScore += Math.min(30, Math.round(Math.abs(recent5Ratio) * 30));
  } else {
    strengthScore -= Math.min(30, Math.round(Math.abs(recent5Ratio) * 30));
  }
  if (recent5Xlarge > 0) strengthScore += 10;
  if (inflowRatio > 0.6) strengthScore += 10;
  else if (inflowRatio < 0.4) strengthScore -= 10;
  strengthScore = Math.max(0, Math.min(100, strengthScore));

  // === 5. 小单/大单博弈 ===
  // 散户（小单）和主力是对手盘：主力买=散户卖，反之亦然
  var recent5Small = recent5.reduce(function(s, d) { return s + d.small; }, 0);
  var isRetailSelling = recent5Small < 0; // 散户净卖出=主力净买入

  return {
    mainSignal: mainSignal,
    signalColor: signalColor,
    signalIcon: signalIcon,
    signals: signals,
    totalMain: totalMain,
    recent5Main: recent5Main,
    recent10Main: recent10Main,
    totalXlarge: totalXlarge,
    recent5Xlarge: recent5Xlarge,
    inflowRatio: Math.round(inflowRatio * 100),
    recent5Inflow: recent5Inflow,
    strengthScore: strengthScore,
    priceTrend: priceTrend,
    recent5Change: recent5Change,
    isRetailSelling: isRetailSelling,
    days: days
  };
}

/**
 * 量价结构深度分析
 * 四大维度：底部放量、筹码集中度、建仓vs派发、真金白银vs对倒
 * @param {object} flowData - fetchCapitalFlow 返回的数据
 * @param {object} stockData - 当前股票行情数据
 * @returns {object} 量价结构分析结果
 */
function analyzeVolumePriceStructure(flowData, stockData) {
  if (!flowData || !flowData.days || flowData.days.length < 5) return null;

  var days = flowData.days;
  var n = days.length;
  var recent5 = days.slice(-5);
  var recent10 = days.slice(-10);
  var recent20 = days.slice(-20);
  if (recent20.length < 10) recent20 = days;

  // === 辅助计算 ===
  // 近20日平均成交量
  var avgVol20 = recent20.reduce(function(s, d) { return s + (d.volume || 0); }, 0) / recent20.length;
  // 近5日平均成交量
  var avgVol5 = recent5.reduce(function(s, d) { return s + (d.volume || 0); }, 0) / recent5.length;
  // 近5日均量 / 近20日均量
  var volRatio5to20 = avgVol20 > 0 ? avgVol5 / avgVol20 : 1;

  // 近20日最高价、最低价
  var high20 = Math.max.apply(null, recent20.map(function(d) { return d.price; }));
  var low20 = Math.min.apply(null, recent20.map(function(d) { return d.price; }));
  var priceRange20 = high20 - low20;
  // 当前价格在20日区间的位置 (0=最低, 100=最高)
  var currentPrice = days[n - 1].price;
  var pricePosition = priceRange20 > 0 ? (currentPrice - low20) / priceRange20 * 100 : 50;

  // 近20日成交量标准差（衡量量能稳定性）
  var vols20 = recent20.map(function(d) { return d.volume || 0; });
  var volStd20 = _stdDev(vols20);
  var volCV = avgVol20 > 0 ? volStd20 / avgVol20 : 0; // 变异系数

  // 近5日主力净流入
  var recent5Main = recent5.reduce(function(s, d) { return s + d.main; }, 0);
  var recent10Main = recent10.reduce(function(s, d) { return s + d.main; }, 0);
  var recent5Xlarge = recent5.reduce(function(s, d) { return s + d.xlarge; }, 0);

  // === 维度1：底部放量分析 ===
  var volAnalysis = _analyzeBottomVolume(days, recent5, recent20, avgVol20, avgVol5, volRatio5to20, pricePosition);

  // === 维度2：筹码集中度分析 ===
  var chipAnalysis = _analyzeChipConcentration(days, recent10, recent20, volCV);

  // === 维度3：建仓vs派发 ===
  var buildAnalysis = _analyzeBuildOrDistribute(days, recent5, recent10, recent5Main, recent10Main, recent5Xlarge, pricePosition, volRatio5to20);

  // === 维度4：真金白银vs对倒 ===
  var realAnalysis = _analyzeRealMoneyOrWash(days, recent5, recent10, recent5Main, recent5Xlarge);

  // === 综合结论 ===
  var score = 0;
  var conclusions = [];

  if (volAnalysis.score > 0) { score += volAnalysis.score; conclusions.push(volAnalysis.shortVerdict); }
  if (chipAnalysis.score > 0) { score += chipAnalysis.score; conclusions.push(chipAnalysis.shortVerdict); }
  if (buildAnalysis.score > 0) { score += buildAnalysis.score; conclusions.push(buildAnalysis.shortVerdict); }
  if (realAnalysis.score > 0) { score += realAnalysis.score; conclusions.push(realAnalysis.shortVerdict); }

  var overallVerdict, overallColor, overallIcon;
  if (score >= 6) {
    overallVerdict = '量价结构健康·主力积极运作';
    overallColor = 'red'; overallIcon = '▲▲';
  } else if (score >= 3) {
    overallVerdict = '量价结构偏正面·关注后续确认';
    overallColor = 'yellow'; overallIcon = '▲';
  } else if (score >= 0) {
    overallVerdict = '量价结构中性·方向不明';
    overallColor = 'yellow'; overallIcon = '→';
  } else if (score >= -3) {
    overallVerdict = '量价结构偏弱·谨慎对待';
    overallColor = 'green'; overallIcon = '▼';
  } else {
    overallVerdict = '量价结构恶化·警惕风险';
    overallColor = 'green'; overallIcon = '▼▼';
  }

  return {
    volume: volAnalysis,
    chip: chipAnalysis,
    build: buildAnalysis,
    real: realAnalysis,
    overallVerdict: overallVerdict,
    overallColor: overallColor,
    overallIcon: overallIcon,
    overallScore: score,
    conclusions: conclusions
  };
}

/**
 * 维度1：底部放量分析
 * 判断：价格在低位区间时，成交量是否出现显著放大
 */
function _analyzeBottomVolume(days, recent5, recent20, avgVol20, avgVol5, volRatio5to20, pricePosition) {
  var isLowArea = pricePosition < 40; // 价格在20日区间下半部
  var isBottomArea = pricePosition < 25; // 接近底部

  // 近5日中最大量 / 20日均量
  var maxVol5 = Math.max.apply(null, recent5.map(function(d) { return d.volume || 0; }));
  var maxVolRatio = avgVol20 > 0 ? maxVol5 / avgVol20 : 1;

  // 量能趋势：近5日均量是否大于近20日均量
  var isVolExpanding = volRatio5to20 > 1.2;

  // 放量日（量比>1.5）在近5日中的数量
  var volSpikeDays = recent5.filter(function(d) { return d.volRatio > 1.5; }).length;

  // 放量时股价方向
  var volSpikeUpDays = recent5.filter(function(d) { return d.volRatio > 1.5 && d.changePct > 0; }).length;
  var volSpikeDownDays = recent5.filter(function(d) { return d.volRatio > 1.5 && d.changePct < 0; }).length;

  var verdict, desc, tag, tagColor, score, shortVerdict;

  if (isBottomArea && isVolExpanding && maxVolRatio > 1.5) {
    verdict = '底部放量';
    tag = '底部放量'; tagColor = 'red';
    score = 2;
    shortVerdict = '底部放量';
    desc = '价格处于20日低位区间，近5日量能显著放大（量比' + maxVolRatio.toFixed(2) + '），放量日' + volSpikeUpDays + '涨' + volSpikeDownDays + '跌。低位放量多为主力进场信号，但需确认放量方向以上涨为主';
  } else if (isLowArea && isVolExpanding) {
    verdict = '低位温和放量';
    tag = '低位放量'; tagColor = 'red';
    score = 1;
    shortVerdict = '低位放量';
    desc = '价格处于中低位区间，近5日均量是20日均量的' + volRatio5to20.toFixed(2) + '倍，量能逐步放大。若伴随股价企稳，可能为主力悄悄吸筹';
  } else if (!isLowArea && isVolExpanding && maxVolRatio > 2) {
    verdict = '高位放量';
    tag = '高位放量'; tagColor = 'green';
    score = -2;
    shortVerdict = '高位放量需警惕';
    desc = '价格已处于20日高位区间（位置' + pricePosition.toFixed(0) + '%），近5日量能放大至' + volRatio5to20.toFixed(2) + '倍。高位放量往往是主力派发信号，需警惕获利盘出逃';
  } else if (!isLowArea && volRatio5to20 < 0.7) {
    verdict = '高位缩量';
    tag = '高位缩量'; tagColor = 'yellow';
    score = 0;
    shortVerdict = '高位缩量';
    desc = '价格处于高位但量能萎缩（量比' + volRatio5to20.toFixed(2) + '），可能为上涨中继蓄势，也可能缺乏买盘支撑';
  } else if (isLowArea && volRatio5to20 < 0.7) {
    verdict = '底部缩量';
    tag = '底部缩量'; tagColor = 'cyan';
    score = 0;
    shortVerdict = '底部缩量';
    desc = '价格处于低位但量能萎缩（量比' + volRatio5to20.toFixed(2) + '），抛压减轻但买盘不活跃，底部可能还需打磨';
  } else {
    verdict = '量能平稳';
    tag = '量能平稳'; tagColor = 'yellow';
    score = 0;
    shortVerdict = '量能平稳';
    desc = '近5日均量为20日均量的' + volRatio5to20.toFixed(2) + '倍，量能无明显异常。价格处于20日区间' + pricePosition.toFixed(0) + '%位置';
  }

  return {
    verdict: verdict, desc: desc, tag: tag, tagColor: tagColor,
    score: score, shortVerdict: shortVerdict,
    metrics: {
      volRatio5to20: volRatio5to20,
      maxVolRatio: maxVolRatio,
      pricePosition: pricePosition,
      volSpikeDays: volSpikeDays,
      volSpikeUpDays: volSpikeUpDays,
      volSpikeDownDays: volSpikeDownDays
    }
  };
}

/**
 * 维度2：筹码集中度分析
 * 通过量能稳定性+价格波动收敛判断筹码是否从分散到集中
 */
function _analyzeChipConcentration(days, recent10, recent20, volCV) {
  // 近10日价格波动率（标准差/均值）
  var prices10 = recent10.map(function(d) { return d.price; });
  var avgPrice10 = prices10.reduce(function(s, p) { return s + p; }, 0) / prices10.length;
  var priceStd10 = _stdDev(prices10);
  var priceCV10 = avgPrice10 > 0 ? priceStd10 / avgPrice10 : 0;

  // 近20日价格波动率
  var prices20 = recent20.map(function(d) { return d.price; });
  var avgPrice20 = prices20.reduce(function(s, p) { return s + p; }, 0) / prices20.length;
  var priceStd20 = _stdDev(prices20);
  var priceCV20 = avgPrice20 > 0 ? priceStd20 / avgPrice20 : 0;

  // 波动收敛：近10日波动率 < 近20日波动率，说明价格逐步收敛
  var isConverging = priceCV10 < priceCV20 * 0.85;

  // 量能稳定（变异系数低）
  var isVolStable = volCV < 0.4;

  // 近5日 vs 近10日量能比较（缩量企稳 = 筹码锁定）
  var recent5 = days.slice(-5);
  var avgVol5 = recent5.reduce(function(s, d) { return s + (d.volume || 0); }, 0) / recent5.length;
  var avgVol10 = recent10.reduce(function(s, d) { return s + (d.volume || 0); }, 0) / recent10.length;
  var volTrend = avgVol10 > 0 ? avgVol5 / avgVol10 : 1;

  // 缩量企稳（量缩价稳）
  var isVolShrinkPriceStable = volTrend < 0.85 && priceCV10 < 0.05;

  var verdict, desc, tag, tagColor, score, shortVerdict;

  if (isConverging && (isVolStable || isVolShrinkPriceStable)) {
    verdict = '筹码趋于集中';
    tag = '筹码集中'; tagColor = 'red';
    score = 2;
    shortVerdict = '筹码集中';
    desc = '近10日价格波动率(' + (priceCV10 * 100).toFixed(1) + '%)低于近20日(' + (priceCV20 * 100).toFixed(1) + '%)，价格逐步收敛。' + (isVolShrinkPriceStable ? '缩量企稳，卖盘枯竭，筹码锁定良好' : '量能稳定(变异系数' + (volCV * 100).toFixed(1) + '%)，主力控盘度提升') + '。筹码正从分散转向集中';
  } else if (isConverging) {
    verdict = '波动收敛·待确认';
    tag = '波动收敛'; tagColor = 'yellow';
    score = 1;
    shortVerdict = '波动收敛';
    desc = '近10日价格波动率(' + (priceCV10 * 100).toFixed(1) + '%)低于近20日(' + (priceCV20 * 100).toFixed(1) + '%)，价格有收敛迹象，但量能波动仍大(变异系数' + (volCV * 100).toFixed(1) + '%)，筹码集中度待确认';
  } else if (priceCV10 > priceCV20 * 1.2) {
    verdict = '筹码趋于分散';
    tag = '筹码分散'; tagColor = 'green';
    score = -1;
    shortVerdict = '筹码分散';
    desc = '近10日价格波动率(' + (priceCV10 * 100).toFixed(1) + '%)高于近20日(' + (priceCV20 * 100).toFixed(1) + '%)，波动放大，筹码可能从集中转向分散。多空分歧加大，需警惕';
  } else {
    verdict = '筹码结构稳定';
    tag = '筹码稳定'; tagColor = 'yellow';
    score = 0;
    shortVerdict = '筹码稳定';
    desc = '价格波动率近10日(' + (priceCV10 * 100).toFixed(1) + '%)与近20日(' + (priceCV20 * 100).toFixed(1) + '%)相当，筹码结构无明显变化';
  }

  return {
    verdict: verdict, desc: desc, tag: tag, tagColor: tagColor,
    score: score, shortVerdict: shortVerdict,
    metrics: {
      priceCV10: priceCV10, priceCV20: priceCV20, volCV: volCV,
      volTrend: volTrend, isConverging: isConverging
    }
  };
}

/**
 * 维度3：建仓vs派发判断
 * 综合量价方向、价格位置、资金流向来判断主力是在建仓还是派发
 */
function _analyzeBuildOrDistribute(days, recent5, recent10, recent5Main, recent10Main, recent5Xlarge, pricePosition, volRatio5to20) {
  // 近5日涨跌幅
  var recent5Change = recent5.reduce(function(s, d) { return s + d.changePct; }, 0);
  // 近10日涨跌幅
  var recent10Change = recent10.reduce(function(s, d) { return s + d.changePct; }, 0);

  // 量价配合方向
  var upDaysWithVol = recent5.filter(function(d) { return d.changePct > 0 && d.volRatio > 1; }).length;
  var downDaysWithVol = recent5.filter(function(d) { return d.changePct < 0 && d.volRatio > 1; }).length;

  // 上涨放量 vs 下跌放量
  var isUpWithVol = upDaysWithVol > downDaysWithVol;
  var isDownWithVol = downDaysWithVol > upDaysWithVol;

  // 超大单方向
  var isXlargeInflow = recent5Xlarge > 0;

  // 低位 + 主力流入 + 上涨放量 = 建仓
  var isBuilding = pricePosition < 50 && recent5Main > 0 && isUpWithVol && isXlargeInflow;
  // 低位 + 主力流入 + 下跌放量 = 下跌吸筹
  var isAccumulating = pricePosition < 40 && recent5Main > 0 && isDownWithVol && recent5Change < 0;
  // 高位 + 主力流出 + 上涨放量 = 派发
  var isDistributing = pricePosition > 60 && recent5Main < 0 && isUpWithVol;
  // 高位 + 主力流出 + 下跌放量 = 出货
  var isSelling = pricePosition > 50 && recent5Main < 0 && isDownWithVol && recent5Change < 0;

  var verdict, desc, tag, tagColor, score, shortVerdict;

  if (isBuilding) {
    verdict = '主力建仓';
    tag = '主力建仓'; tagColor = 'red';
    score = 3;
    shortVerdict = '主力建仓中';
    desc = '价格处于中低位，主力资金净流入，上涨日放量(' + upDaysWithVol + '/5日)。近5日超大单净流入为正，量价配合良好，主力正在积极建仓';
  } else if (isAccumulating) {
    verdict = '下跌吸筹';
    tag = '下跌吸筹'; tagColor = 'red';
    score = 2;
    shortVerdict = '下跌吸筹';
    desc = '价格处于低位区间，股价下跌但主力资金净流入，下跌日放量可能是主力借恐慌打压吸筹。近5日跌幅' + recent5Change.toFixed(1) + '%，但主力逆势收集筹码';
  } else if (isDistributing) {
    verdict = '主力派发';
    tag = '主力派发'; tagColor = 'green';
    score = -3;
    shortVerdict = '主力派发中';
    desc = '价格处于高位区间，主力资金净流出，上涨日放量(' + upDaysWithVol + '/5日)。主力借拉高吸引跟风盘出货，典型派发特征';
  } else if (isSelling) {
    verdict = '主力出货';
    tag = '主力出货'; tagColor = 'green';
    score = -3;
    shortVerdict = '主力出货中';
    desc = '价格处于中高位，主力资金净流出且下跌日放量(' + downDaysWithVol + '/5日)。近5日跌幅' + recent5Change.toFixed(1) + '%，主力在主动抛售';
  } else if (recent5Main > 0 && Math.abs(recent5Change) < 2) {
    verdict = '温和吸筹';
    tag = '温和吸筹'; tagColor = 'yellow';
    score = 1;
    shortVerdict = '温和吸筹';
    desc = '主力资金小幅净流入，但股价波动不大，可能为主力在不引起注意的情况下缓慢吸筹';
  } else if (recent5Main < 0 && Math.abs(recent5Change) < 2) {
    verdict = '温和减持';
    tag = '温和减持'; tagColor = 'yellow';
    score = -1;
    shortVerdict = '温和减持';
    desc = '主力资金小幅净流出，股价波动不大，可能为主力在不引起注意的情况下缓慢减持';
  } else {
    verdict = '方向不明';
    tag = '方向不明'; tagColor = 'yellow';
    score = 0;
    shortVerdict = '方向不明';
    desc = '量价关系和资金流向信号矛盾，主力意图不明确。近5日主力' + (recent5Main >= 0 ? '净流入' : '净流出') + '，涨跌' + recent5Change.toFixed(1) + '%';
  }

  return {
    verdict: verdict, desc: desc, tag: tag, tagColor: tagColor,
    score: score, shortVerdict: shortVerdict,
    metrics: {
      recent5Main: recent5Main, recent5Change: recent5Change,
      upDaysWithVol: upDaysWithVol, downDaysWithVol: downDaysWithVol,
      isXlargeInflow: isXlargeInflow, pricePosition: pricePosition
    }
  };
}

/**
 * 维度4：真金白银vs对倒
 * 通过量价一致性、资金流与涨跌方向匹配度判断
 */
function _analyzeRealMoneyOrWash(days, recent5, recent10, recent5Main, recent5Xlarge) {
  // 量价一致性：上涨日是否伴随放量+资金流入
  var consistentDays = 0;
  var inconsistentDays = 0;
  recent5.forEach(function(d) {
    var isUp = d.changePct > 0;
    var isVolUp = d.volRatio > 1;
    var isMainIn = d.main > 0;
    if (isUp && isVolUp && isMainIn) consistentDays++;
    else if (!isUp && isVolUp && !isMainIn) consistentDays++;
    else if (isUp && isVolUp && !isMainIn) inconsistentDays++;
    else if (!isUp && isVolUp && isMainIn) inconsistentDays++;
  });

  var consistency = consistentDays - inconsistentDays; // -5 ~ +5

  // 超大单占比：超大单 / 总主力
  var totalMainAbs5 = recent5.reduce(function(s, d) { return s + Math.abs(d.main); }, 0);
  var xlargeAbs5 = recent5.reduce(function(s, d) { return s + Math.abs(d.xlarge); }, 0);
  var xlargeRatio = totalMainAbs5 > 0 ? xlargeAbs5 / totalMainAbs5 : 0;

  // 量增价不增（放量但价格不动 = 对倒嫌疑）
  var volUpPriceFlat = recent5.filter(function(d) {
    return d.volRatio > 1.5 && Math.abs(d.changePct) < 0.5;
  }).length;

  // 放量但主力资金方向与股价方向背离
  var divergenceDays = recent5.filter(function(d) {
    return d.volRatio > 1.2 && ((d.changePct > 1 && d.main < 0) || (d.changePct < -1 && d.main > 0));
  }).length;

  // 近5日换手率估算（成交量/总股本近似，用量比代理）
  var avgVolRatio5 = recent5.reduce(function(s, d) { return s + d.volRatio; }, 0) / recent5.length;

  var verdict, desc, tag, tagColor, score, shortVerdict;

  if (consistency >= 2 && xlargeRatio > 0.45 && volUpPriceFlat <= 1 && divergenceDays <= 1) {
    verdict = '真金白银';
    tag = '真金白银'; tagColor = 'red';
    score = 2;
    shortVerdict = '真金白银';
    desc = '量价高度一致(' + consistentDays + '/5日)，超大单占比' + (xlargeRatio * 100).toFixed(0) + '%。放量上涨伴随资金流入，缩量下跌伴随资金流出，量价配合真实，非对倒行为';
  } else if (volUpPriceFlat >= 2 || divergenceDays >= 2) {
    verdict = '对倒嫌疑';
    tag = '对倒嫌疑'; tagColor = 'green';
    score = -2;
    shortVerdict = '对倒嫌疑';
    desc = '存在量价背离信号：放量不涨(' + volUpPriceFlat + '日)、量价方向背离(' + divergenceDays + '日)。放量但价格不动或资金方向与股价背离，可能是主力自买自卖制造交投活跃假象，吸引散户跟风';
  } else if (consistency <= 0) {
    verdict = '量价混乱';
    tag = '量价混乱'; tagColor = 'yellow';
    score = -1;
    shortVerdict = '量价混乱';
    desc = '量价一致性较差(一致' + consistentDays + '日 vs 矛盾' + inconsistentDays + '日)，放量方向与资金流向不匹配，难以判断真实买卖意图';
  } else if (xlargeRatio < 0.35) {
    verdict = '小单主导';
    tag = '小单主导'; tagColor = 'yellow';
    score = 0;
    shortVerdict = '小单主导';
    desc = '超大单占比仅' + (xlargeRatio * 100).toFixed(0) + '%，交易以中小单为主，缺乏大资金方向性引导。可能是散户行情或主力刻意隐藏行踪';
  } else {
    verdict = '基本正常';
    tag = '基本正常'; tagColor = 'yellow';
    score = 1;
    shortVerdict = '基本正常';
    desc = '量价基本一致(' + consistentDays + '/5日)，超大单占比' + (xlargeRatio * 100).toFixed(0) + '%。未发现明显对倒特征，但量价配合度一般';
  }

  return {
    verdict: verdict, desc: desc, tag: tag, tagColor: tagColor,
    score: score, shortVerdict: shortVerdict,
    metrics: {
      consistency: consistency, consistentDays: consistentDays,
      inconsistentDays: inconsistentDays, xlargeRatio: xlargeRatio,
      volUpPriceFlat: volUpPriceFlat, divergenceDays: divergenceDays
    }
  };
}

/**
 * 计算标准差
 */
function _stdDev(arr) {
  if (!arr || arr.length === 0) return 0;
  var mean = arr.reduce(function(s, v) { return s + v; }, 0) / arr.length;
  var variance = arr.reduce(function(s, v) { return s + (v - mean) * (v - mean); }, 0) / arr.length;
  return Math.sqrt(variance);
}

/**
 * 格式化资金金额（元 → 亿/万）
 */
function formatFlowAmount(num) {
  var abs = Math.abs(num);
  if (abs >= 1e8) return (num / 1e8).toFixed(2) + '亿';
  if (abs >= 1e4) return (num / 1e4).toFixed(0) + '万';
  return num.toFixed(0) + '元';
}

/**
 * 综合投资评估：估值+基本面+成长性
 * @returns {object} { score, level, valuation, fundamentals, growth, summary }
 */
function assessStock(stockData, finData) {
  var score = 50; // 基础分
  var parts = [];

  // === 1. 估值评估 (PE/PB) ===
  var valuationText = '数据不足';
  if (stockData.pe > 0) {
    if (stockData.pe < 15) {
      score += 15;
      valuationText = '低估';
      parts.push('PE仅' + stockData.pe.toFixed(1) + '倍，估值偏低');
    } else if (stockData.pe < 30) {
      score += 5;
      valuationText = '合理';
      parts.push('PE ' + stockData.pe.toFixed(1) + '倍，估值合理');
    } else if (stockData.pe < 50) {
      score -= 5;
      valuationText = '偏高';
      parts.push('PE ' + stockData.pe.toFixed(1) + '倍，估值偏高');
    } else {
      score -= 15;
      valuationText = '高估';
      parts.push('PE高达' + stockData.pe.toFixed(1) + '倍，估值较高');
    }
  }

  // PB辅助
  if (stockData.pb > 0) {
    if (stockData.pb < 1) {
      score += 10;
      parts.push('PB<1，破净');
    } else if (stockData.pb < 3) {
      score += 3;
    } else if (stockData.pb > 8) {
      score -= 5;
    }
  }

  // === 2. 基本面评估 (ROE/毛利率/净利率/负债率) ===
  var fundText = '数据不足';
  if (finData) {
    var fundScore = 0;
    // ROE
    if (finData.roe > 0) {
      if (finData.roe >= 15) { fundScore += 15; fundText = '优秀'; parts.push('ROE ' + finData.roe.toFixed(1) + '%，盈利能力强'); }
      else if (finData.roe >= 10) { fundScore += 8; fundText = '良好'; parts.push('ROE ' + finData.roe.toFixed(1) + '%，盈利能力良好'); }
      else if (finData.roe >= 5) { fundScore += 2; fundText = '一般'; parts.push('ROE ' + finData.roe.toFixed(1) + '%，盈利一般'); }
      else { fundScore -= 8; fundText = '偏弱'; parts.push('ROE仅' + finData.roe.toFixed(1) + '%，盈利偏弱'); }
    }
    // 毛利率
    if (finData.grossMargin > 0) {
      if (finData.grossMargin >= 50) { fundScore += 8; parts.push('毛利率' + finData.grossMargin.toFixed(0) + '%，护城河深'); }
      else if (finData.grossMargin >= 30) { fundScore += 3; }
      else if (finData.grossMargin < 15) { fundScore -= 5; parts.push('毛利率仅' + finData.grossMargin.toFixed(0) + '%，竞争激烈'); }
    }
    // 净利率
    if (finData.netMargin > 0) {
      if (finData.netMargin >= 20) { fundScore += 5; }
      else if (finData.netMargin < 3) { fundScore -= 5; parts.push('净利率仅' + finData.netMargin.toFixed(1) + '%，利润薄'); }
    }
    // 资产负债率
    if (finData.debtRatio > 0) {
      if (finData.debtRatio >= 70) { fundScore -= 8; parts.push('负债率' + finData.debtRatio.toFixed(0) + '%，杠杆较高需关注'); }
      else if (finData.debtRatio >= 50) { fundScore -= 3; }
      else if (finData.debtRatio < 30) { fundScore += 3; parts.push('负债率' + finData.debtRatio.toFixed(0) + '%，财务稳健'); }
    }
    score += fundScore;
  }

  // === 3. 成长性评估 (营收/利润增速) ===
  var growthText = '数据不足';
  if (finData && (finData.revenueYoY !== 0 || finData.profitYoY !== 0)) {
    var growthScore = 0;
    // 净利润增速
    if (finData.profitYoY > 30) { growthScore += 12; growthText = '高增长'; parts.push('净利润同比+' + finData.profitYoY.toFixed(0) + '%，高速增长'); }
    else if (finData.profitYoY > 10) { growthScore += 6; growthText = '稳健增长'; parts.push('净利润同比+' + finData.profitYoY.toFixed(0) + '%'); }
    else if (finData.profitYoY > 0) { growthScore += 2; growthText = '微增'; parts.push('净利润同比+' + finData.profitYoY.toFixed(0) + '%'); }
    else if (finData.profitYoY < -20) { growthScore -= 12; growthText = '下滑'; parts.push('净利润同比' + finData.profitYoY.toFixed(0) + '%，明显下滑'); }
    else if (finData.profitYoY < 0) { growthScore -= 5; growthText = '下降'; parts.push('净利润同比' + finData.profitYoY.toFixed(0) + '%'); }
    // 营收增速
    if (finData.revenueYoY > 20) { growthScore += 5; }
    else if (finData.revenueYoY < -10) { growthScore -= 5; parts.push('营收同比' + finData.revenueYoY.toFixed(0) + '%，收入萎缩'); }
    score += growthScore;
  }

  // 综合评级
  score = Math.max(0, Math.min(100, score));
  var level, levelColor;
  if (score >= 75) { level = '★ 强烈关注'; levelColor = getSignalColor('green'); }
  else if (score >= 60) { level = '☆ 值得关注'; levelColor = blendHex(getSignalColor('green'), getSignalColor('yellow'), 0.5); }
  else if (score >= 40) { level = '○ 中性观望'; levelColor = getSignalColor('yellow'); }
  else { level = '△ 谨慎对待'; levelColor = getSignalColor('red'); }

  return {
    score: score,
    level: level,
    levelColor: levelColor,
    valuation: valuationText,
    fundamentals: fundText,
    growth: growthText,
    summary: parts.join('；')
  };
}

/* ============================================================
   ETF 评分系统
   三维度：技术面与动量(40) + 基金属性(35) + 估值与折溢价(25)
   ============================================================ */

/**
 * 获取ETF基金详情（规模、换手率、上市日期等）
 * 数据源：push2delay.eastmoney.com
 * @param {string} secCode - 纯数字代码，如 '510300'
 * @returns {Promise} resolve(etfDetail) 或 resolve(null)
 */
function fetchETFDetail(secCode) {
  var code = secCode.replace(/^(sh|sz|hk)/i, '');
  // 确定市场前缀：1=沪市, 0=深市
  var market = (code.charAt(0) === '5' || code.charAt(0) === '6' || code.charAt(0) === '9') ? '1' : '0';
  var secid = market + '.' + code;
  var url = 'https://push2delay.eastmoney.com/api/qt/stock/get' +
    '?ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2' +
    '&fields=f43,f47,f48,f57,f58,f84,f85,f86,f116,f117,f161,f167,f168,f170,f171,f173,f189,f191,f192,f193,f277' +
    '&secid=' + secid;

  return fetchWithTimeout(url, { cache: 'no-store' }, 6000).then(function(res) {
    return res.json();
  }).then(function(resp) {
    if (!resp || !resp.data) return null;
    var d = resp.data;
    return {
      code: d.f57 || code,
      name: d.f58 || '',
      price: d.f43 || 0,
      volume: d.f47 || 0,           // 成交量(手)
      turnover: d.f48 || 0,          // 成交额(元)
      totalShares: d.f84 || 0,       // 总份额
      floatShares: d.f85 || 0,       // 流通份额
      aum: d.f116 || 0,              // 基金规模(元)
      turnoverRate: d.f168 || 0,     // 换手率(%)
      changePct: d.f170 || 0,        // 涨跌幅(%)
      amplitude: d.f171 || 0,        // 振幅(%)
      listingDate: d.f189 || 0,      // 上市日期 YYYYMMDD
      high52w: d.f174 || 0,          // 52周最高
      low52w: d.f175 || 0            // 52周最低
    };
  }).catch(function() {
    // 降级到 push2 主站
    var url2 = 'https://push2.eastmoney.com/api/qt/stock/get' +
      '?ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2' +
      '&fields=f43,f47,f48,f57,f58,f84,f85,f86,f116,f117,f161,f167,f168,f170,f171,f173,f189,f191,f192,f193,f277' +
      '&secid=' + secid;
    return emJsonp(url2, 6000).then(function(resp) {
      if (!resp || !resp.data) return null;
      var d = resp.data;
      return {
        code: d.f57 || code, name: d.f58 || '', price: d.f43 || 0,
        volume: d.f47 || 0, turnover: d.f48 || 0, totalShares: d.f84 || 0,
        floatShares: d.f85 || 0, aum: d.f116 || 0, turnoverRate: d.f168 || 0,
        changePct: d.f170 || 0, amplitude: d.f171 || 0, listingDate: d.f189 || 0,
        high52w: d.f174 || 0, low52w: d.f175 || 0
      };
    }).catch(function() { return null; });
  });
}

/**
 * 获取ETF最新净值（用于计算折溢价率）
 * 数据源：api.fund.eastmoney.com 历史净值接口
 * @param {string} fundCode - 基金代码，如 '510300'
 * @returns {Promise} resolve({nav, navDate}) 或 resolve(null)
 */
function fetchETFNav(fundCode) {
  var url = 'https://api.fund.eastmoney.com/f10/lsjz?fundCode=' + fundCode +
    '&pageIndex=1&pageSize=1';
  return fetchWithTimeout(url, { cache: 'no-store', headers: { 'Referer': 'https://fundf10.eastmoney.com/' } }, 5000)
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (!data || !data.Data || !data.Data.LSJZList || data.Data.LSJZList.length === 0) return null;
      var item = data.Data.LSJZList[0];
      return {
        nav: parseFloat(item.DWJZ) || 0,      // 单位净值
        navDate: item.FSRQ || '',               // 净值日期
        totalReturn: parseFloat(item.LJJZ) || 0 // 累计净值
      };
    }).catch(function() { return null; });
}

/**
 * ETF多维度评分算法
 * @param {object} stockData - extractStockInfo 返回的行情数据
 * @param {object} klineData - {dates, closes, klines} K线数据
 * @param {object|null} etfDetail - fetchETFDetail 返回的基金详情
 * @param {object|null} navData - fetchETFNav 返回的净值数据
 * @returns {object} 评分结果
 */
function assessETF(stockData, klineData, etfDetail, navData) {
  var details = [];  // 各维度明细
  var totalScore = 0;

  // ========== 维度一：技术面与动量 (满分40) ==========
  var techScore = 0;
  var techParts = [];

  if (klineData && klineData.closes && klineData.closes.length >= 20) {
    var closes = klineData.closes;
    var n = closes.length;
    var latestClose = closes[n - 1];
    var volumes = klineData.klines.map(function(k) { return parseFloat(k[5]) || 0; });

    // 1a. MA趋势 (满分15)
    var ma20 = n >= 20 ? closes.slice(n - 20).reduce(function(a, b) { return a + b; }, 0) / 20 : 0;
    var ma60 = n >= 60 ? closes.slice(n - 60).reduce(function(a, b) { return a + b; }, 0) / 60 : 0;

    var trendScore = 0;
    if (ma20 > 0 && latestClose > ma20) { trendScore += 8; techParts.push('价格在MA20之上'); }
    else if (ma20 > 0) { trendScore -= 3; techParts.push('价格在MA20之下'); }
    if (ma60 > 0 && latestClose > ma60) { trendScore += 7; techParts.push('价格在MA60之上'); }
    else if (ma60 > 0) { trendScore -= 2; techParts.push('价格在MA60之下'); }
    techScore += Math.max(0, Math.min(15, trendScore));

    // 1b. 动量得分 (满分15)：1月/3月/6月收益率
    var momScore = 0;
    function periodReturn(arr, days) {
      if (arr.length < days + 1) return 0;
      var idx = arr.length - days - 1;
      return arr[idx] > 0 ? ((arr[arr.length - 1] - arr[idx]) / arr[idx]) * 100 : 0;
    }
    var ret1m = periodReturn(closes, 20);    // ~1月
    var ret3m = periodReturn(closes, 60);    // ~3月
    var ret6m = periodReturn(closes, 120);   // ~6月

    // 1月动量 (5分)
    if (ret1m > 5) momScore += 5;
    else if (ret1m > 0) momScore += 3;
    else if (ret1m > -5) momScore += 1;
    else momScore -= 2;
    // 3月动量 (5分)
    if (ret3m > 10) momScore += 5;
    else if (ret3m > 0) momScore += 3;
    else if (ret3m > -5) momScore += 1;
    else momScore -= 2;
    // 6月动量 (5分)
    if (ret6m > 15) momScore += 5;
    else if (ret6m > 0) momScore += 3;
    else if (ret6m > -10) momScore += 1;
    else momScore -= 2;

    techScore += Math.max(0, Math.min(15, momScore));
    if (ret3m > 0) techParts.push('3月涨幅' + ret3m.toFixed(1) + '%');
    else if (ret3m < 0) techParts.push('3月跌幅' + ret3m.toFixed(1) + '%');

    // 1c. 成交量趋势 (满分10)：近5日均量 vs 近20日均量
    var volScore = 0;
    if (volumes.length >= 20) {
      var vol5 = volumes.slice(-5).reduce(function(a, b) { return a + b; }, 0) / 5;
      var vol20 = volumes.slice(-20).reduce(function(a, b) { return a + b; }, 0) / 20;
      if (vol20 > 0) {
        var volRatio = vol5 / vol20;
        if (volRatio > 1.5) { volScore = 10; techParts.push('成交量显著放大'); }
        else if (volRatio > 1.1) { volScore = 7; techParts.push('成交量温和放大'); }
        else if (volRatio > 0.8) { volScore = 5; techParts.push('成交量平稳'); }
        else { volScore = 2; techParts.push('成交量萎缩'); }
      }
    }
    techScore += volScore;
  } else {
    techParts.push('K线数据不足，技术面暂不评分');
  }

  techScore = Math.max(0, Math.min(40, techScore));
  totalScore += techScore;
  details.push({ name: '技术面与动量', score: techScore, max: 40, parts: techParts });

  // ========== 维度二：基金属性 (满分35) ==========
  var fundScore = 0;
  var fundParts = [];

  // 使用etfDetail或stockData中的数据
  var aum = (etfDetail && etfDetail.aum) ? etfDetail.aum : (stockData.marketCap || 0);
  var turnover = (etfDetail && etfDetail.turnover) ? etfDetail.turnover : (stockData.turnover ? stockData.turnover * 1e8 : 0);
  var turnoverRate = (etfDetail && etfDetail.turnoverRate) ? etfDetail.turnoverRate : (stockData.turnoverRate || 0);

  // 2a. 规模AUM (满分15)
  var aumYi = aum / 1e8;  // 转为亿元
  if (aumYi >= 100) { fundScore += 15; fundParts.push('规模' + aumYi.toFixed(0) + '亿，大型ETF'); }
  else if (aumYi >= 50) { fundScore += 12; fundParts.push('规模' + aumYi.toFixed(0) + '亿，中大型'); }
  else if (aumYi >= 10) { fundScore += 8; fundParts.push('规模' + aumYi.toFixed(0) + '亿，中型'); }
  else if (aumYi >= 2) { fundScore += 4; fundParts.push('规模' + aumYi.toFixed(1) + '亿，小型'); }
  else if (aumYi > 0) { fundScore += 1; fundParts.push('规模仅' + aumYi.toFixed(1) + '亿，迷你ETF需注意清盘风险'); }

  // 2b. 流动性-日成交额 (满分12)
  var turnoverYi = turnover / 1e8;
  if (turnoverYi >= 5) { fundScore += 12; fundParts.push('日成交额' + turnoverYi.toFixed(1) + '亿，流动性极佳'); }
  else if (turnoverYi >= 1) { fundScore += 8; fundParts.push('日成交额' + turnoverYi.toFixed(1) + '亿，流动性良好'); }
  else if (turnoverYi >= 0.2) { fundScore += 5; fundParts.push('日成交额' + (turnoverYi * 10000).toFixed(0) + '万，流动性一般'); }
  else if (turnoverYi > 0) { fundScore += 1; fundParts.push('日成交额仅' + (turnoverYi * 10000).toFixed(0) + '万，流动性较差'); }

  // 2c. 换手率 (满分8)
  if (turnoverRate >= 3 && turnoverRate <= 15) { fundScore += 8; fundParts.push('换手率' + turnoverRate.toFixed(1) + '%，交投活跃适中'); }
  else if (turnoverRate > 15) { fundScore += 6; fundParts.push('换手率' + turnoverRate.toFixed(1) + '%，交投非常活跃'); }
  else if (turnoverRate >= 1) { fundScore += 4; fundParts.push('换手率' + turnoverRate.toFixed(1) + '%，交投偏低'); }
  else if (turnoverRate > 0) { fundScore += 2; fundParts.push('换手率仅' + turnoverRate.toFixed(1) + '%，交投清淡'); }

  fundScore = Math.max(0, Math.min(35, fundScore));
  totalScore += fundScore;
  details.push({ name: '基金属性', score: fundScore, max: 35, parts: fundParts });

  // ========== 维度三：估值与折溢价 (满分25) ==========
  var valScore = 0;
  var valParts = [];

  // 3a. 折溢价率 (满分15)：ETF价格 vs 基金净值
  var premium = 0;
  if (navData && navData.nav > 0 && stockData.price > 0) {
    premium = ((stockData.price - navData.nav) / navData.nav) * 100;
    if (premium < -0.3) { valScore += 15; valParts.push('折价' + Math.abs(premium).toFixed(2) + '%，买入有折价安全垫'); }
    else if (premium < 0) { valScore += 12; valParts.push('折价' + Math.abs(premium).toFixed(2) + '%，小幅折价'); }
    else if (premium < 0.3) { valScore += 10; valParts.push('溢价' + premium.toFixed(2) + '%，折溢价正常'); }
    else if (premium < 0.5) { valScore += 6; valParts.push('溢价' + premium.toFixed(2) + '%，需关注'); }
    else { valScore += 2; valParts.push('溢价' + premium.toFixed(2) + '%，溢价偏高需谨慎'); }
  } else {
    // 无净值数据，给中性分
    valScore += 7;
    valParts.push('净值数据暂不可用，折溢价无法评估');
  }

  // 3b. 波动率 (满分10)：近60日年化波动率
  if (klineData && klineData.closes && klineData.closes.length >= 30) {
    var closes60 = klineData.closes.slice(-60);
    var dailyReturns = [];
    for (var i = 1; i < closes60.length; i++) {
      if (closes60[i - 1] > 0) dailyReturns.push((closes60[i] - closes60[i - 1]) / closes60[i - 1]);
    }
    if (dailyReturns.length >= 10) {
      var meanRet = dailyReturns.reduce(function(a, b) { return a + b; }, 0) / dailyReturns.length;
      var variance = dailyReturns.reduce(function(a, b) { return a + (b - meanRet) * (b - meanRet); }, 0) / dailyReturns.length;
      var annualVol = Math.sqrt(variance) * Math.sqrt(250) * 100; // 年化波动率(%)

      if (annualVol >= 10 && annualVol <= 25) { valScore += 10; valParts.push('年化波动率' + annualVol.toFixed(0) + '%，风险适中'); }
      else if (annualVol < 10) { valScore += 7; valParts.push('年化波动率' + annualVol.toFixed(0) + '%，低波动'); }
      else if (annualVol <= 40) { valScore += 5; valParts.push('年化波动率' + annualVol.toFixed(0) + '%，波动较大'); }
      else { valScore += 2; valParts.push('年化波动率' + annualVol.toFixed(0) + '%，高风险高波动'); }
    } else {
      valScore += 5;
    }
  } else {
    valScore += 5;
    valParts.push('K线数据不足，波动率无法评估');
  }

  valScore = Math.max(0, Math.min(25, valScore));
  totalScore += valScore;
  details.push({ name: '估值与折溢价', score: valScore, max: 25, parts: valParts });

  // ========== 综合评级 ==========
  totalScore = Math.max(0, Math.min(100, totalScore));
  var level, levelColor;
  if (totalScore >= 75) { level = '★ 强烈推荐'; levelColor = getSignalColor('green'); }
  else if (totalScore >= 60) { level = '☆ 值得关注'; levelColor = blendHex(getSignalColor('green'), getSignalColor('yellow'), 0.5); }
  else if (totalScore >= 40) { level = '○ 中性观望'; levelColor = getSignalColor('yellow'); }
  else { level = '△ 谨慎对待'; levelColor = getSignalColor('red'); }

  return {
    score: totalScore,
    level: level,
    levelColor: levelColor,
    details: details,
    premium: premium,
    summary: details.map(function(d) { return d.parts.join('；'); }).filter(function(s) { return s; }).join(' | ')
  };
}

/**
 * 渲染ETF评分面板（总分+维度进度条+明细）
 * @param {object} scoreData - assessETF 返回的评分结果
 */
function renderETFScore(scoreData) {
  var area = document.getElementById('stockResultArea');
  if (!area) return;
  var detailEl = area.querySelector('.stock-detail');
  if (!detailEl) return;

  // 移除已有评分面板
  var existing = detailEl.querySelector('.sd-etf-score');
  if (existing) existing.remove();

  if (!scoreData) return;

  var d = scoreData;
  var scoreColor = d.levelColor;

  // 构建维度进度条
  var barsHtml = d.details.map(function(dim) {
    var pct = (dim.score / dim.max) * 100;
    var barColor = pct >= 70 ? getSignalColor('green') : (pct >= 40 ? getSignalColor('yellow') : getSignalColor('red'));
    return '<div class="etf-score-dim">' +
      '<div class="etf-dim-head">' +
        '<span class="etf-dim-name">' + escHTML(dim.name) + '</span>' +
        '<span class="etf-dim-score" style="color:' + barColor + '">' + dim.score + '<span class="etf-dim-max">/' + dim.max + '</span></span>' +
      '</div>' +
      '<div class="etf-dim-bar"><div class="etf-dim-fill" style="width:' + pct + '%;background:' + barColor + '"></div></div>' +
      '<div class="etf-dim-parts">' + dim.parts.map(function(p) { return '<span class="etf-part">' + escHTML(p) + '</span>'; }).join('') + '</div>' +
    '</div>';
  }).join('');

  var html = '<div class="sd-etf-score">' +
    '<div class="sd-section">' +
      '<div class="sd-section-title">ETF 综合评分</div>' +
      '<div class="etf-score-main">' +
        '<div class="etf-score-ring">' +
          '<svg viewBox="0 0 120 120" class="etf-score-svg">' +
            '<circle cx="60" cy="60" r="52" fill="none" stroke="rgba(0,229,255,0.1)" stroke-width="6"/>' +
            '<circle cx="60" cy="60" r="52" fill="none" stroke="' + scoreColor + '" stroke-width="6" stroke-linecap="round"' +
              ' stroke-dasharray="' + (2 * Math.PI * 52) + '" stroke-dashoffset="' + (2 * Math.PI * 52 * (1 - d.score / 100)) + '"' +
              ' transform="rotate(-90 60 60)" style="transition:stroke-dashoffset 1.2s cubic-bezier(0.34,1.56,0.64,1)"/>' +
          '</svg>' +
          '<div class="etf-score-num" style="color:' + scoreColor + '">' + d.score + '</div>' +
        '</div>' +
        '<div class="etf-score-info">' +
          '<div class="etf-score-level" style="color:' + scoreColor + '">' + d.level + '</div>' +
          (d.premium !== 0 ? '<div class="etf-score-premium">折溢价: ' + (d.premium > 0 ? '+' : '') + d.premium.toFixed(2) + '%</div>' : '') +
          '<div class="etf-score-hint">三维度加权评分（满分100）</div>' +
        '</div>' +
      '</div>' +
      '<div class="etf-score-dims">' + barsHtml + '</div>' +
    '</div>' +
  '</div>';

  var tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  var addBtn = detailEl.querySelector('.sd-add-btn');
  if (addBtn) detailEl.insertBefore(tempDiv.firstChild, addBtn);
  else detailEl.appendChild(tempDiv.firstChild);
}

// 腾讯接口查询个股
function fetchTencentStock(keyword) {
  // 猜测代码前缀
  var code = keyword;
  if (/^\d{6}$/.test(keyword)) {
    if (keyword.charAt(0) === '6' || keyword.charAt(0) === '5' || keyword.charAt(0) === '9') code = 'sh' + keyword;
    else code = 'sz' + keyword;
  } else if (/^\d{5}$/.test(keyword)) {
    code = 'hk' + keyword;
  }
  
  return fetchTencentBatch([code]).then(function(data) {
    return data[code] ? { _tencent: true, data: data[code] } : null;
  });
}

/**
 * 渲染个股查询结果（增强版：行情+估值+财务+综合评估）
 * @param {object} stockData - extractStockInfo 返回的统一格式
 * @param {object|null} finData - fetchStockFinancials 返回的财务数据
 * @param {boolean} loading - 是否正在加载财务数据
 */
function renderStockResult(stockData, finData, flowData, loading) {
  var title = document.getElementById('stockResultTitle');
  var area = document.getElementById('stockResultArea');

  // 自动切换到策略信号标签页（仅在首次加载时切换，避免异步数据到达后反复滚动）
  if (loading) {
    triggerSearchTransition(function() {
      switchTab('strategy');
    });
  }

  // 显示返回搜索按钮
  var backBtn = document.getElementById('backSearchBtn');
  if (backBtn) backBtn.style.display = '';

  title.style.display = 'block';

  var d = stockData;
  title.textContent = d.isETF ? 'ETF基金详情分析' : '个股详情分析';

  var changeColor = getChangeColor(d.changePct);
  var changeStr = (d.changePct >= 0 ? '+' : '') + d.changePct.toFixed(2) + '%';

  // 估值判断（ETF不适用PE估值，显示ETF专属标签）
  var valSig, valCls;
  if (d.isETF) {
    valSig = 'ETF基金'; valCls = 'cyan';
  } else if (d.pe > 0 && d.pe < 15) { valSig = '低估'; valCls = 'green'; }
  else if (d.pe < 30) { valSig = '合理'; valCls = 'yellow'; }
  else if (d.pe > 0) { valSig = '偏高'; valCls = 'red'; }
  else { valSig = '数据不足'; valCls = 'cyan'; }

  var marketCapStr = d.marketCap > 0 ? (d.marketCap / 1e8).toFixed(0) + '亿' : '—';
  var turnoverStr = d.turnover > 0 ? (d.turnover >= 10000 ? (d.turnover/1e4).toFixed(1)+'亿' : d.turnover.toFixed(0)+'万') : '—';
  var volumeStr = d.volume > 0 ? (d.volume >= 10000 ? (d.volume/1e4).toFixed(1)+'万手' : d.volume.toFixed(0)+'手') : '—';

  // === 综合评估 ===
  var assessment = assessStock(d, finData);

  // === 构建HTML ===
  var html = '<div class="stock-detail">';

  // 黑五类检测
  var blackFive = detectBlackFive(d, finData);
  var nameClass = blackFive.isBlack ? 'sd-name sd-name-blackfive' : 'sd-name';
  var nameStyle = blackFive.isBlack ? ' style="color:#00C853;text-shadow:0 0 10px #00C853,0 0 20px #00C853,0 0 30px #00C853aa"' : '';

  // 1. 头部：名称+代码+价格+涨跌
  html += '<div class="sd-header">' +
    '<div class="sd-name-area">' +
      '<div>' +
        '<div class="' + nameClass + '"' + nameStyle + '>' + d.name + '</div>' +
        '<div class="sd-code">' + d.code + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="sd-price-area">' +
      '<div class="sd-price" style="color:' + changeColor + ';text-shadow:0 0 8px ' + changeColor + '66">' +
        (d.price > 0 ? d.price.toFixed(2) : '—') + '</div>' +
      '<div class="sd-change" style="color:' + changeColor + '">' + changeStr + '</div>' +
    '</div>' +
  '</div>';

  // 黑五类警告横幅
  if (blackFive.isBlack) {
    html += '<div class="blackfive-warning">';
    html += '<div class="blackfive-warning-title">⚠ 黑五类风险警示</div>';
    blackFive.categories.forEach(function(cat) {
      html += '<div class="blackfive-item">' +
        '<span class="blackfive-tag">' + cat.label + '</span>' +
        '<span class="blackfive-reason">' + cat.reason + '</span>' +
      '</div>';
    });
    html += '<div class="blackfive-footer">以上风险因素叠加，投资需格外谨慎。建议控制仓位，远离高风险标的。</div>';
    html += '</div>';
  }

  // 2. 实时行情区块
  html += '<div class="sd-section">' +
    '<div class="sd-section-title">实时行情</div>' +
    '<div class="sd-grid">' +
      '<div class="sd-item"><span class="sd-item-val">' + (d.open > 0 ? d.open.toFixed(2) : '—') + '</span><span class="sd-item-lbl">开盘</span></div>' +
      '<div class="sd-item"><span class="sd-item-val">' + (d.prevClose > 0 ? d.prevClose.toFixed(2) : '—') + '</span><span class="sd-item-lbl">昨收</span></div>' +
      '<div class="sd-item"><span class="sd-item-val" style="color:#00C853">' + (d.high > 0 ? d.high.toFixed(2) : '—') + '</span><span class="sd-item-lbl">最高</span></div>' +
      '<div class="sd-item"><span class="sd-item-val" style="color:#FF3B30">' + (d.low > 0 ? d.low.toFixed(2) : '—') + '</span><span class="sd-item-lbl">最低</span></div>' +
    '</div>' +
    '<div class="sd-grid" style="margin-top:0.25rem">' +
      '<div class="sd-item"><span class="sd-item-val">' + volumeStr + '</span><span class="sd-item-lbl">成交量</span></div>' +
      '<div class="sd-item"><span class="sd-item-val">' + turnoverStr + '</span><span class="sd-item-lbl">成交额</span></div>' +
      '<div class="sd-item"><span class="sd-item-val">' + (d.turnoverRate > 0 ? d.turnoverRate.toFixed(2) + '%' : '—') + '</span><span class="sd-item-lbl">换手率</span></div>' +
      '<div class="sd-item"><span class="sd-item-val">' + (d.amplitude > 0 ? d.amplitude.toFixed(2) + '%' : '—') + '</span><span class="sd-item-lbl">振幅</span></div>' +
    '</div>' +
  '</div>';

  // 3. 估值指标区块（ETF显示ETF专属信息）
  if (d.isETF) {
    html += '<div class="sd-section">' +
      '<div class="sd-section-title">基金信息</div>' +
      '<div class="sd-grid">' +
        '<div class="sd-item"><span class="sd-item-val" style="color:var(--neon-cyan)">ETF</span><span class="sd-item-lbl">类型</span></div>' +
        '<div class="sd-item"><span class="sd-item-val">' + marketCapStr + '</span><span class="sd-item-lbl">规模</span></div>' +
        '<div class="sd-item"><span class="sd-item-val">' + (d.turnoverRate > 0 ? d.turnoverRate.toFixed(2) + '%' : '—') + '</span><span class="sd-item-lbl">换手率</span></div>' +
        '<div class="sd-item"><span class="sd-item-val">' + (d.amplitude > 0 ? d.amplitude.toFixed(2) + '%' : '—') + '</span><span class="sd-item-lbl">振幅</span></div>' +
      '</div>' +
      '<div class="sd-tag-row">' +
        '<span class="sd-tag cyan">ETF基金</span>' +
        '<span class="sd-tag cyan">场内交易</span>' +
        '<span class="sd-tag ' + (d.changePct >= 0 ? 'red' : 'green') + '">' + (d.changePct >= 0 ? '上涨' : '下跌') + '</span>' +
      '</div>' +
      '<div class="sd-flow-note">※ ETF基金不适用PE/PB估值指标，请参考跟踪指数估值、折溢价率、规模和流动性</div>' +
    '</div>';
  } else {
    html += '<div class="sd-section">' +
      '<div class="sd-section-title">估值指标</div>' +
      '<div class="sd-grid">' +
        '<div class="sd-item"><span class="sd-item-val" style="color:var(--neon-cyan)">' + (d.pe > 0 ? d.pe.toFixed(1) : '—') + '</span><span class="sd-item-lbl">PE(TTM)</span></div>' +
        '<div class="sd-item"><span class="sd-item-val" style="color:var(--neon-cyan)">' + (d.pb > 0 ? d.pb.toFixed(2) : '—') + '</span><span class="sd-item-lbl">PB</span></div>' +
        '<div class="sd-item"><span class="sd-item-val">' + marketCapStr + '</span><span class="sd-item-lbl">总市值</span></div>' +
        '<div class="sd-item"><span class="sd-item-val">' + (d.pe > 0 && d.price > 0 ? (d.price / d.pe).toFixed(2) : '—') + '</span><span class="sd-item-lbl">每股收益</span></div>' +
      '</div>' +
      '<div class="sd-tag-row">' +
        '<span class="sd-tag ' + valCls + '">估值：' + valSig + '</span>' +
        (d.pb > 0 && d.pb < 1 ? '<span class="sd-tag green">破净股</span>' : '') +
        (d.pb > 0 && d.pb < 3 && d.pb >= 1 ? '<span class="sd-tag green">PB合理</span>' : '') +
        (d.pe > 0 && d.pe < 15 ? '<span class="sd-tag green">低PE</span>' : '') +
        (d.pe > 50 ? '<span class="sd-tag red">高PE风险</span>' : '') +
      '</div>' +
    '</div>';
  }

  // 4. 财务基本面区块（ETF不适用，跳过）
  if (d.isETF) {
    // ETF没有财务报表，不显示此区块
  } else if (loading) {
    html += '<div class="sd-section">' +
      '<div class="sd-section-title">财务基本面</div>' +
      '<div class="sd-loading"><span class="dot-anim">●</span> 正在加载财务数据...</div>' +
    '</div>';
  } else if (finData) {
    var reportDateStr = finData.reportDate ? finData.reportDate.slice(0, 10) + (finData.reportType ? ' ' + finData.reportType : '') : '最新';
    var profitColor = finData.profitYoY >= 0 ? '#00C853' : '#FF3B30';
    var revenueColor = finData.revenueYoY >= 0 ? '#00C853' : '#FF3B30';
    var roeColor = finData.roe >= 15 ? '#00C853' : finData.roe >= 10 ? '#FFD700' : '#FF3B30';
    var debtColor = finData.debtRatio >= 70 ? '#FF3B30' : finData.debtRatio >= 50 ? '#FFD700' : '#00C853';

    html += '<div class="sd-section">' +
      '<div class="sd-section-title">财务基本面 <span style="font-size:0.5rem;color:var(--muted);font-weight:400;margin-left:0.3rem">报告期：' + reportDateStr + '</span></div>' +
      '<div class="sd-grid">' +
        '<div class="sd-item"><span class="sd-item-val">' + formatBigNumber(finData.revenue) + '</span><span class="sd-item-lbl">营业收入</span></div>' +
        '<div class="sd-item"><span class="sd-item-val">' + formatBigNumber(finData.netProfit) + '</span><span class="sd-item-lbl">归母净利润</span></div>' +
        '<div class="sd-item"><span class="sd-item-val" style="color:' + profitColor + '">' + (finData.profitYoY >= 0 ? '+' : '') + finData.profitYoY.toFixed(1) + '%</span><span class="sd-item-lbl">净利同比</span></div>' +
        '<div class="sd-item"><span class="sd-item-val" style="color:' + revenueColor + '">' + (finData.revenueYoY >= 0 ? '+' : '') + finData.revenueYoY.toFixed(1) + '%</span><span class="sd-item-lbl">营收同比</span></div>' +
      '</div>' +
      '<div class="sd-grid" style="margin-top:0.25rem">' +
        '<div class="sd-item"><span class="sd-item-val" style="color:' + roeColor + '">' + (finData.roe > 0 ? finData.roe.toFixed(1) + '%' : '—') + '</span><span class="sd-item-lbl">ROE</span></div>' +
        '<div class="sd-item"><span class="sd-item-val">' + (finData.grossMargin > 0 ? finData.grossMargin.toFixed(1) + '%' : '—') + '</span><span class="sd-item-lbl">毛利率</span></div>' +
        '<div class="sd-item"><span class="sd-item-val">' + (finData.netMargin > 0 ? finData.netMargin.toFixed(1) + '%' : '—') + '</span><span class="sd-item-lbl">净利率</span></div>' +
        '<div class="sd-item"><span class="sd-item-val" style="color:' + debtColor + '">' + (finData.debtRatio > 0 ? finData.debtRatio.toFixed(0) + '%' : '—') + '</span><span class="sd-item-lbl">负债率</span></div>' +
      '</div>' +
      '<div class="sd-grid" style="margin-top:0.25rem">' +
        '<div class="sd-item"><span class="sd-item-val">' + (finData.eps > 0 ? finData.eps.toFixed(2) : '—') + '</span><span class="sd-item-lbl">每股收益</span></div>' +
        '<div class="sd-item"><span class="sd-item-val">' + (finData.bvps > 0 ? finData.bvps.toFixed(2) : '—') + '</span><span class="sd-item-lbl">每股净资产</span></div>' +
        '<div class="sd-item"><span class="sd-item-val">' + (d.pb > 0 && finData.bvps > 0 ? (d.price / finData.bvps).toFixed(2) : '—') + '</span><span class="sd-item-lbl">实际PB</span></div>' +
        '<div class="sd-item"><span class="sd-item-val">' + (d.pe > 0 && finData.eps > 0 ? (d.pe).toFixed(1) : '—') + '</span><span class="sd-item-lbl">动态PE</span></div>' +
      '</div>' +
      '<div class="sd-tag-row">' +
        (finData.roe >= 15 ? '<span class="sd-tag green">高ROE</span>' : '') +
        (finData.grossMargin >= 50 ? '<span class="sd-tag green">高毛利</span>' : '') +
        (finData.profitYoY > 20 ? '<span class="sd-tag green">高增长</span>' : '') +
        (finData.profitYoY < -10 ? '<span class="sd-tag red">业绩下滑</span>' : '') +
        (finData.debtRatio >= 70 ? '<span class="sd-tag red">高负债</span>' : '') +
        (finData.debtRatio < 30 && finData.debtRatio > 0 ? '<span class="sd-tag green">低负债</span>' : '') +
        (finData.netMargin >= 20 ? '<span class="sd-tag green">高净利率</span>' : '') +
      '</div>' +
    '</div>';
  } else {
    html += '<div class="sd-section">' +
      '<div class="sd-section-title">财务基本面</div>' +
      '<div class="sd-loading">暂无财务数据</div>' +
    '</div>';
  }

  // 5. 综合投资评估区块
  // 评估条
  var valScore = 0, fundScore = 0, growthScore = 0;
  if (d.pe > 0 && d.pe < 15) valScore = 85;
  else if (d.pe < 30) valScore = 60;
  else if (d.pe > 0) valScore = 30;
  else valScore = 50;

  if (finData) {
    if (finData.roe >= 15) fundScore = 85;
    else if (finData.roe >= 10) fundScore = 65;
    else if (finData.roe >= 5) fundScore = 45;
    else if (finData.roe > 0) fundScore = 25;
    else fundScore = 50;

    if (finData.profitYoY > 30) growthScore = 90;
    else if (finData.profitYoY > 10) growthScore = 65;
    else if (finData.profitYoY > 0) growthScore = 50;
    else if (finData.profitYoY > -20) growthScore = 30;
    else if (finData.profitYoY < 0) growthScore = 15;
    else growthScore = 50;
  }

  html += '<div class="sd-assess">' +
    '<div class="sd-assess-header">' +
      '<span class="sd-assess-level" style="color:' + assessment.levelColor + ';text-shadow:0 0 8px ' + assessment.levelColor + '66">' + assessment.level + '</span>' +
      '<span class="sd-assess-score">综合评分 <b style="color:' + assessment.levelColor + '">' + assessment.score + '</b>/100</span>' +
    '</div>' +
    '<div class="sd-assess-bars">' +
      '<div class="sd-assess-bar">' +
        '<div class="sd-assess-bar-lbl">估值</div>' +
        '<div class="sd-assess-bar-track"><div class="sd-assess-bar-fill" style="width:' + valScore + '%;background:#00E5FF;color:#00E5FF"></div></div>' +
        '<div class="sd-assess-bar-val" style="color:#00E5FF">' + valScore + '</div>' +
      '</div>' +
      '<div class="sd-assess-bar">' +
        '<div class="sd-assess-bar-lbl">基本面</div>' +
        '<div class="sd-assess-bar-track"><div class="sd-assess-bar-fill" style="width:' + fundScore + '%;background:' + (fundScore >= 60 ? '#00C853' : fundScore >= 40 ? '#FFD700' : '#FF3B30') + ';color:' + (fundScore >= 60 ? '#00C853' : fundScore >= 40 ? '#FFD700' : '#FF3B30') + '"></div></div>' +
        '<div class="sd-assess-bar-val" style="color:' + (fundScore >= 60 ? '#00C853' : fundScore >= 40 ? '#FFD700' : '#FF3B30') + '">' + fundScore + '</div>' +
      '</div>' +
      '<div class="sd-assess-bar">' +
        '<div class="sd-assess-bar-lbl">成长性</div>' +
        '<div class="sd-assess-bar-track"><div class="sd-assess-bar-fill" style="width:' + growthScore + '%;background:' + (growthScore >= 60 ? '#00C853' : growthScore >= 40 ? '#FFD700' : '#FF3B30') + ';color:' + (growthScore >= 60 ? '#00C853' : growthScore >= 40 ? '#FFD700' : '#FF3B30') + '"></div></div>' +
        '<div class="sd-assess-bar-val" style="color:' + (growthScore >= 60 ? '#00C853' : growthScore >= 40 ? '#FFD700' : '#FF3B30') + '">' + growthScore + '</div>' +
      '</div>' +
    '</div>';

  // 评估标签
  html += '<div class="sd-tag-row">' +
    '<span class="sd-tag ' + (assessment.valuation === '低估' ? 'green' : assessment.valuation === '合理' ? 'yellow' : assessment.valuation === '高估' ? 'red' : 'cyan') + '">估值：' + assessment.valuation + '</span>' +
    '<span class="sd-tag ' + (assessment.fundamentals === '优秀' || assessment.fundamentals === '良好' ? 'green' : assessment.fundamentals === '一般' ? 'yellow' : assessment.fundamentals === '偏弱' ? 'red' : 'cyan') + '">基本面：' + assessment.fundamentals + '</span>' +
    '<span class="sd-tag ' + (assessment.growth === '高增长' || assessment.growth === '稳健增长' ? 'green' : assessment.growth === '微增' ? 'yellow' : assessment.growth === '下滑' || assessment.growth === '下降' ? 'red' : 'cyan') + '">成长性：' + assessment.growth + '</span>' +
  '</div>';

  // 评估摘要
  if (assessment.summary) {
    html += '<div class="sd-assess-text">' + assessment.summary + '。</div>';
  }

  // 自动收藏提示（评分≥75且财务数据已加载时触发）
  if (!loading && finData && assessment.score >= 75) {
    html += '<div class="sd-auto-fav" id="autoFavBanner">' +
      '<span class="sd-auto-fav-icon">★</span>' +
      '<span class="sd-auto-fav-text">评分' + assessment.score + '分达标，已自动收藏至「自动关注」组合</span>' +
    '</div>';
  }

  // 李大霄个股语录
  var stockQuote = getStockQuote(d.pe, d.pb);
  html += formatLiDaxiaoQuote(stockQuote);

  // 奇迹个股语录（狂妄风格，与李大霄形成反差）
  var zyStockQuote = getZhangYangStockQuote(d.pe, d.pb);
  html += formatZhangYangQuote(zyStockQuote);

  html += '</div>'; // .sd-assess

  // 6. 主力资金分析区块
  if (loading && !flowData) {
    html += '<div class="sd-section sd-flow-section">' +
      '<div class="sd-section-title">主力资金分析 <span style="font-size:0.5rem;color:var(--muted);font-weight:400;margin-left:0.3rem">量价模型估算</span></div>' +
      '<div class="sd-loading"><span class="dot-anim">●</span> 正在加载主力资金数据...</div>' +
    '</div>';
  } else if (flowData) {
    var flowAnalysis = analyzeCapitalFlow(flowData, d);
    if (flowAnalysis) {
      var sColor = flowAnalysis.signalColor;
      var sc = getSignalColor(sColor);

      html += '<div class="sd-section sd-flow-section">' +
        '<div class="sd-section-title">主力资金分析 <span style="font-size:0.5rem;color:var(--muted);font-weight:400;margin-left:0.3rem">近20日·量价模型</span></div>';

      // 主信号
      html += '<div class="sd-flow-signal" style="border-color:' + sc + '33;background:' + sc + '0a">' +
        '<div class="sd-flow-signal-icon" style="color:' + sc + ';text-shadow:0 0 8px ' + sc + '66">' + flowAnalysis.signalIcon + '</div>' +
        '<div class="sd-flow-signal-text">' +
          '<div class="sd-flow-signal-main" style="color:' + sc + '">' + flowAnalysis.mainSignal + '</div>' +
          '<div class="sd-flow-signal-desc">';

      if (flowAnalysis.signals.length === 0) {
        html += '近20日主力资金无明显趋势';
      } else {
        html += flowAnalysis.signals.join(' · ');
      }
      html += '</div></div></div>';

      // 资金强度评分条
      var scoreColor = flowAnalysis.strengthScore >= 65 ? '#00C853' : flowAnalysis.strengthScore >= 40 ? '#FFD700' : '#FF3B30';
      html += '<div class="sd-flow-score">' +
        '<div class="sd-flow-score-lbl">主力资金强度</div>' +
        '<div class="sd-flow-score-bar">' +
          '<div class="sd-flow-score-track"><div class="sd-flow-score-fill" style="width:' + flowAnalysis.strengthScore + '%;background:' + scoreColor + '"></div></div>' +
          '<div class="sd-flow-score-val" style="color:' + scoreColor + '">' + flowAnalysis.strengthScore + '</div>' +
        '</div>' +
        '<div class="sd-flow-score-tag">' + (flowAnalysis.strengthScore >= 65 ? '主力积极介入' : flowAnalysis.strengthScore >= 40 ? '主力观望' : '主力流出') + '</div>' +
      '</div>';

      // 资金数据网格
      html += '<div class="sd-grid">' +
        '<div class="sd-item"><span class="sd-item-val" style="color:' + (flowAnalysis.totalMain >= 0 ? '#00C853' : '#FF3B30') + '">' + formatFlowAmount(flowAnalysis.totalMain) + '</span><span class="sd-item-lbl">20日主力净流入</span></div>' +
        '<div class="sd-item"><span class="sd-item-val" style="color:' + (flowAnalysis.recent5Main >= 0 ? '#00C853' : '#FF3B30') + '">' + formatFlowAmount(flowAnalysis.recent5Main) + '</span><span class="sd-item-lbl">5日主力净流入</span></div>' +
        '<div class="sd-item"><span class="sd-item-val" style="color:' + (flowAnalysis.recent5Xlarge >= 0 ? '#00C853' : '#FF3B30') + '">' + formatFlowAmount(flowAnalysis.recent5Xlarge) + '</span><span class="sd-item-lbl">5日超大单净流入</span></div>' +
        '<div class="sd-item"><span class="sd-item-val">' + flowAnalysis.inflowRatio + '%</span><span class="sd-item-lbl">净流入天数占比</span></div>' +
      '</div>';

      // 量价关系
      var trendStr = flowAnalysis.priceTrend > 2 ? '↑ 走强' : flowAnalysis.priceTrend < -2 ? '↓ 走弱' : '→ 横盘';
      var trendColor = flowAnalysis.priceTrend > 2 ? '#00C853' : flowAnalysis.priceTrend < -2 ? '#FF3B30' : '#FFD700';
      html += '<div class="sd-grid" style="margin-top:0.25rem">' +
        '<div class="sd-item"><span class="sd-item-val" style="color:' + trendColor + '">' + trendStr + '</span><span class="sd-item-lbl">近5日趋势</span></div>' +
        '<div class="sd-item"><span class="sd-item-val" style="color:' + (flowAnalysis.recent5Change >= 0 ? '#00C853' : '#FF3B30') + '">' + (flowAnalysis.recent5Change >= 0 ? '+' : '') + flowAnalysis.recent5Change.toFixed(1) + '%</span><span class="sd-item-lbl">5日涨跌幅</span></div>' +
        '<div class="sd-item"><span class="sd-item-val">' + flowAnalysis.recent5Inflow + '/5</span><span class="sd-item-lbl">净流入天数</span></div>' +
        '<div class="sd-item"><span class="sd-item-val" style="color:' + (flowAnalysis.isRetailSelling ? '#FF3B30' : '#FFD700') + '">' + (flowAnalysis.isRetailSelling ? '散户卖出' : '散户买入') + '</span><span class="sd-item-lbl">散户行为</span></div>' +
      '</div>';

      // 近5日资金流向明细
      var recent5 = flowAnalysis.days.slice(-5).reverse();
      html += '<div class="sd-flow-detail">' +
        '<div class="sd-flow-detail-title">近5日资金明细</div>' +
        '<div class="sd-flow-detail-list">';
      recent5.forEach(function(day) {
        var dayColor = day.main >= 0 ? '#00C853' : '#FF3B30';
        var dayArrow = day.main >= 0 ? '↑' : '↓';
        var dateShort = day.date.substring(5); // MM-DD
        html += '<div class="sd-flow-detail-row">' +
          '<span class="sd-flow-detail-date">' + dateShort + '</span>' +
          '<span class="sd-flow-detail-arrow" style="color:' + dayColor + '">' + dayArrow + '</span>' +
          '<span class="sd-flow-detail-amount" style="color:' + dayColor + '">' + formatFlowAmount(day.main) + '</span>' +
          '<span class="sd-flow-detail-change" style="color:' + (day.changePct >= 0 ? '#00C853' : '#FF3B30') + '">' + (day.changePct >= 0 ? '+' : '') + day.changePct.toFixed(2) + '%</span>' +
        '</div>';
      });
      html += '</div></div>';

      // 信号标签
      if (flowAnalysis.signals.length > 0) {
        html += '<div class="sd-tag-row">';
        flowAnalysis.signals.forEach(function(sig) {
          var sigCls = sig.indexOf('出货') >= 0 || sig.indexOf('出逃') >= 0 ? 'green' :
                       sig.indexOf('洗盘') >= 0 || sig.indexOf('筑底') >= 0 ? 'red' :
                       sig.indexOf('控盘') >= 0 ? 'cyan' : 'yellow';
          html += '<span class="sd-tag ' + sigCls + '">' + sig + '</span>';
        });
        html += '</div>';
      }

      html += '<div class="sd-flow-note">※ 基于腾讯K线量价关系估算主力资金方向，非逐笔大单数据。仅供参考，不构成投资建议</div>';
      html += '</div>';

      // === 量价结构深度分析 ===
      var vps = analyzeVolumePriceStructure(flowData, d);
      if (vps) {
        var oc = getSignalColor(vps.overallColor);
        html += '<div class="sd-vps-section">' +
          '<div class="sd-vps-title">量价结构深度分析</div>';

        // 综合结论
        html += '<div class="sd-flow-signal" style="border-color:' + oc + '33;background:' + oc + '0a;margin-bottom:0.35rem">' +
          '<div class="sd-flow-signal-icon" style="color:' + oc + ';text-shadow:0 0 8px ' + oc + '66">' + vps.overallIcon + '</div>' +
          '<div class="sd-flow-signal-text">' +
            '<div class="sd-flow-signal-main" style="color:' + oc + '">' + vps.overallVerdict + '</div>' +
            '<div class="sd-flow-signal-desc">' + (vps.conclusions.length > 0 ? vps.conclusions.join(' · ') : '各项指标中性') + '</div>' +
          '</div>' +
        '</div>';

        // 维度1：底部放量
        var v1 = vps.volume;
        var v1c = getSignalColor(v1.tagColor);
        html += '<div class="sd-vps-item">' +
          '<div class="sd-vps-item-label">底部放量</div>' +
          '<div class="sd-vps-item-body">' +
            '<div class="sd-vps-item-verdict">' +
              '<span class="sd-vps-item-tag ' + v1.tagColor + '">' + v1.tag + '</span>' +
              '<span style="color:' + v1c + '">' + v1.verdict + '</span>' +
            '</div>' +
            '<div class="sd-vps-item-desc">' + v1.desc + '</div>' +
            '<div class="sd-vps-bar-row">' +
              '<span style="font-size:0.48rem;color:var(--muted);min-width:3rem">量比5/20</span>' +
              '<div class="sd-vps-bar-track"><div class="sd-vps-bar-fill" style="width:' + Math.min(100, v1.metrics.volRatio5to20 * 50) + '%;background:' + v1c + '"></div></div>' +
              '<span class="sd-vps-bar-val" style="color:' + v1c + '">' + v1.metrics.volRatio5to20.toFixed(2) + '</span>' +
            '</div>' +
            '<div class="sd-vps-bar-row">' +
              '<span style="font-size:0.48rem;color:var(--muted);min-width:3rem">价格位置</span>' +
              '<div class="sd-vps-bar-track"><div class="sd-vps-bar-fill" style="width:' + v1.metrics.pricePosition + '%;background:' + (v1.metrics.pricePosition < 40 ? '#00C853' : v1.metrics.pricePosition > 60 ? '#FF3B30' : '#FFD700') + '"></div></div>' +
              '<span class="sd-vps-bar-val">' + v1.metrics.pricePosition.toFixed(0) + '%</span>' +
            '</div>' +
          '</div>' +
        '</div>';

        // 维度2：筹码集中度
        var v2 = vps.chip;
        var v2c = getSignalColor(v2.tagColor);
        html += '<div class="sd-vps-item">' +
          '<div class="sd-vps-item-label">筹码集中度</div>' +
          '<div class="sd-vps-item-body">' +
            '<div class="sd-vps-item-verdict">' +
              '<span class="sd-vps-item-tag ' + v2.tagColor + '">' + v2.tag + '</span>' +
              '<span style="color:' + v2c + '">' + v2.verdict + '</span>' +
            '</div>' +
            '<div class="sd-vps-item-desc">' + v2.desc + '</div>' +
            '<div class="sd-vps-bar-row">' +
              '<span style="font-size:0.48rem;color:var(--muted);min-width:3rem">10日波动</span>' +
              '<div class="sd-vps-bar-track"><div class="sd-vps-bar-fill" style="width:' + Math.min(100, v2.metrics.priceCV10 * 500) + '%;background:' + v2c + '"></div></div>' +
              '<span class="sd-vps-bar-val">' + (v2.metrics.priceCV10 * 100).toFixed(1) + '%</span>' +
            '</div>' +
            '<div class="sd-vps-bar-row">' +
              '<span style="font-size:0.48rem;color:var(--muted);min-width:3rem">量能变异</span>' +
              '<div class="sd-vps-bar-track"><div class="sd-vps-bar-fill" style="width:' + Math.min(100, v2.metrics.volCV * 100) + '%;background:' + (v2.metrics.volCV < 0.4 ? '#00C853' : '#FFD700') + '"></div></div>' +
              '<span class="sd-vps-bar-val">' + (v2.metrics.volCV * 100).toFixed(1) + '%</span>' +
            '</div>' +
          '</div>' +
        '</div>';

        // 维度3：建仓vs派发
        var v3 = vps.build;
        var v3c = getSignalColor(v3.tagColor);
        html += '<div class="sd-vps-item">' +
          '<div class="sd-vps-item-label">建仓/派发</div>' +
          '<div class="sd-vps-item-body">' +
            '<div class="sd-vps-item-verdict">' +
              '<span class="sd-vps-item-tag ' + v3.tagColor + '">' + v3.tag + '</span>' +
              '<span style="color:' + v3c + '">' + v3.verdict + '</span>' +
            '</div>' +
            '<div class="sd-vps-item-desc">' + v3.desc + '</div>' +
            '<div class="sd-vps-bar-row">' +
              '<span style="font-size:0.48rem;color:var(--muted);min-width:3rem">上涨放量</span>' +
              '<div class="sd-vps-bar-track"><div class="sd-vps-bar-fill" style="width:' + (v3.metrics.upDaysWithVol / 5 * 100) + '%;background:#00C853"></div></div>' +
              '<span class="sd-vps-bar-val">' + v3.metrics.upDaysWithVol + '/5日</span>' +
            '</div>' +
            '<div class="sd-vps-bar-row">' +
              '<span style="font-size:0.48rem;color:var(--muted);min-width:3rem">下跌放量</span>' +
              '<div class="sd-vps-bar-track"><div class="sd-vps-bar-fill" style="width:' + (v3.metrics.downDaysWithVol / 5 * 100) + '%;background:#FF3B30"></div></div>' +
              '<span class="sd-vps-bar-val">' + v3.metrics.downDaysWithVol + '/5日</span>' +
            '</div>' +
          '</div>' +
        '</div>';

        // 维度4：真金白银vs对倒
        var v4 = vps.real;
        var v4c = getSignalColor(v4.tagColor);
        html += '<div class="sd-vps-item">' +
          '<div class="sd-vps-item-label">真金/对倒</div>' +
          '<div class="sd-vps-item-body">' +
            '<div class="sd-vps-item-verdict">' +
              '<span class="sd-vps-item-tag ' + v4.tagColor + '">' + v4.tag + '</span>' +
              '<span style="color:' + v4c + '">' + v4.verdict + '</span>' +
            '</div>' +
            '<div class="sd-vps-item-desc">' + v4.desc + '</div>' +
            '<div class="sd-vps-bar-row">' +
              '<span style="font-size:0.48rem;color:var(--muted);min-width:3rem">量价一致</span>' +
              '<div class="sd-vps-bar-track"><div class="sd-vps-bar-fill" style="width:' + (v4.metrics.consistentDays / 5 * 100) + '%;background:#00C853"></div></div>' +
              '<span class="sd-vps-bar-val">' + v4.metrics.consistentDays + '/5日</span>' +
            '</div>' +
            '<div class="sd-vps-bar-row">' +
              '<span style="font-size:0.48rem;color:var(--muted);min-width:3rem">超大单占比</span>' +
              '<div class="sd-vps-bar-track"><div class="sd-vps-bar-fill" style="width:' + (v4.metrics.xlargeRatio * 100) + '%;background:' + v4c + '"></div></div>' +
              '<span class="sd-vps-bar-val">' + (v4.metrics.xlargeRatio * 100).toFixed(0) + '%</span>' +
            '</div>' +
          '</div>' +
        '</div>';

        html += '<div class="sd-flow-note">※ 量价结构分析基于近20日K线数据估算，通过量能变化、价格波动率、量价一致性等维度综合判断。仅供参考，不构成投资建议</div>';
        html += '</div>';
      }

    } else {
      html += '<div class="sd-section sd-flow-section">' +
        '<div class="sd-section-title">主力资金分析</div>' +
        '<div class="sd-loading">暂无主力资金数据</div>' +
      '</div>';
    }
  }

  // 7. 添加组合按钮
  html += '<button class="sd-add-btn" onclick="addCurrentToPortfolio()">+ 添加到我的估值组合</button>';

  html += '</div>'; // .stock-detail

  area.innerHTML = html;

  // 如果公司概况数据已加载，重新渲染（因为 renderStockResult 会覆盖整个区域）
  if (_currentProfileData) {
    renderCompanyProfile(_currentProfileData, _currentFinData, _currentStockData);
  }

  // 如果龙虎榜数据已加载，重新渲染（因为 renderStockResult 会覆盖整个区域）
  if (_currentDragonTigerData) {
    renderDragonTiger(_currentDragonTigerData);
  }

  // 如果国家队持股数据已加载，重新渲染（因为 renderStockResult 会覆盖整个区域）
  if (_currentNationalTeamData) {
    renderNationalTeam(_currentNationalTeamData);
  }

  // 如果共振分析数据已加载，重新渲染（因为 renderStockResult 会覆盖整个区域）
  if (_currentResonanceData) {
    renderResonance(_currentResonanceData);
  }

  // 如果MA20分析数据已加载，重新渲染
  if (_currentMAData) {
    renderMAAnalysis(_currentMAData);
  }

  // 如果K线图数据已加载，重新渲染（因为 renderStockResult 会覆盖整个区域）
  if (_currentKlineData) {
    renderKlineChart(_currentKlineData.klData, _currentKlineData.stockName, _currentKlineData.realtimePrice);
  }

  // 穿透式特效已在 triggerSearchTransition 中完成视觉切换，无需额外滚动
  // 仅在首次渲染时静默定位到结果区域顶部（不使用 smooth 避免可见的向下滑动）
  if (loading) {
    Perf.trackedSetTimeout(function() {
 if (title) {
 var top = title.getBoundingClientRect().top + window.pageYOffset - 10;
 window.scrollTo({ top: top, behavior: 'auto' });
 }
 }, 350);
  }

  // === 自动收藏：评分≥75且财务数据已加载时，自动添加到「自动关注」组合 ===
  if (!loading && finData && assessment && assessment.score >= 75) {
    autoFavoriteStock(d, assessment.score);
  }
}

/**
 * 渲染公司概况与行业分析到个股详情区域
 * 在 renderStockResult 之后异步调用，插入到估值指标区块之后
 * @param {object} profile - fetchCompanyProfile 返回的公司概况数据
 * @param {object} finData - 财务数据（用于行业前景分析）
 * @param {object} stockData - 行情数据（用于估值判断）
 */
function renderCompanyProfile(profile, finData, stockData) {
  var area = document.getElementById('stockResultArea');
  if (!area) return;

  var detailEl = area.querySelector('.stock-detail');
  if (!detailEl) return;

  // 移除已有的公司概况区域（避免重复）
  var existing = detailEl.querySelector('.sd-company-profile');
  if (existing) existing.remove();

  // 找到估值指标区块（第2个sd-section），在其后面插入
  var sections = detailEl.querySelectorAll('.sd-section');
  var insertAfter = null;
  if (sections.length >= 2) {
    insertAfter = sections[1]; // 估值指标区块
  }

  if (!profile) {
    var emptyHtml = '<div class="sd-company-profile">' +
      '<div class="sd-section">' +
        '<div class="sd-section-title">公司概况与行业分析</div>' +
        '<div class="sd-loading">暂无公司概况数据</div>' +
      '</div>' +
    '</div>';
    var emptyDiv = document.createElement('div');
    emptyDiv.innerHTML = emptyHtml;
    if (insertAfter && insertAfter.nextSibling) {
      detailEl.insertBefore(emptyDiv.firstChild, insertAfter.nextSibling);
    } else {
      detailEl.appendChild(emptyDiv.firstChild);
    }
    return;
  }

  // 生成行业前景分析
  var outlook = generateIndustryOutlook(profile, finData, stockData);

  var html = '<div class="sd-company-profile">';

  // === 公司概况区块 ===
  html += '<div class="sd-section sd-cp-section">' +
    '<div class="sd-section-title">公司概况与行业分析</div>';

  // 行业标签
  if (profile.emIndustry) {
    html += '<div class="sd-cp-industry">' +
      '<span class="sd-cp-industry-label">所属行业</span>' +
      '<span class="sd-cp-industry-val">' + profile.emIndustry + '</span>';
    if (profile.csrcIndustry && profile.csrcIndustry !== profile.emIndustry) {
      html += '<span class="sd-cp-industry-sub">(' + profile.csrcIndustry + ')</span>';
    }
    html += '</div>';
  }

  // 公司简介
  if (profile.orgProfile) {
    var profileText = profile.orgProfile;
    // 截断过长的简介
    if (profileText.length > 300) {
      profileText = profileText.substring(0, 300) + '...';
    }
    html += '<div class="sd-cp-profile">' +
      '<div class="sd-cp-profile-label">公司简介</div>' +
      '<div class="sd-cp-profile-text">' + profileText + '</div>' +
    '</div>';
  }

  // 主营业务
  if (profile.mainBusiness) {
    html += '<div class="sd-cp-business">' +
      '<div class="sd-cp-business-label">主营业务</div>' +
      '<div class="sd-cp-business-text">' + profile.mainBusiness + '</div>' +
    '</div>';
  }

  // 经营范围
  if (profile.businessScope) {
    var scopeText = profile.businessScope;
    if (scopeText.length > 200) {
      scopeText = scopeText.substring(0, 200) + '...';
    }
    html += '<div class="sd-cp-scope">' +
      '<div class="sd-cp-scope-label">经营范围</div>' +
      '<div class="sd-cp-scope-text">' + scopeText + '</div>' +
    '</div>';
  }

  // 公司基本信息网格
  html += '<div class="sd-grid sd-cp-info-grid">' +
    '<div class="sd-item"><span class="sd-item-val">' + (profile.listingDate || '—') + '</span><span class="sd-item-lbl">上市日期</span></div>' +
    '<div class="sd-item"><span class="sd-item-val">' + (profile.foundDate || '—') + '</span><span class="sd-item-lbl">成立日期</span></div>' +
    '<div class="sd-item"><span class="sd-item-val">' + (profile.regCapital > 0 ? (profile.regCapital >= 10000 ? (profile.regCapital / 10000).toFixed(2) + '亿' : profile.regCapital.toFixed(0) + '万') : '—') + '</span><span class="sd-item-lbl">注册资本</span></div>' +
    '<div class="sd-item"><span class="sd-item-val">' + (profile.empNum > 0 ? (profile.empNum >= 10000 ? (profile.empNum / 10000).toFixed(1) + '万' : profile.empNum + '') : '—') + '</span><span class="sd-item-lbl">员工人数</span></div>' +
  '</div>';

  // 第二行信息
  html += '<div class="sd-grid" style="margin-top:0.25rem">' +
    '<div class="sd-item"><span class="sd-item-val" style="font-size:0.52rem">' + (profile.actualHolder || '—') + '</span><span class="sd-item-lbl">实际控制人</span></div>' +
    '<div class="sd-item"><span class="sd-item-val" style="font-size:0.52rem">' + (profile.chairman || '—') + '</span><span class="sd-item-lbl">董事长</span></div>' +
    '<div class="sd-item"><span class="sd-item-val" style="font-size:0.52rem">' + (profile.province || '—') + '</span><span class="sd-item-lbl">所在地区</span></div>' +
    '<div class="sd-item"><span class="sd-item-val" style="font-size:0.52rem">' + (profile.tradeMarket || '—') + '</span><span class="sd-item-lbl">上市交易所</span></div>' +
  '</div>';

  html += '</div>'; // .sd-section

  // === 行业前景分析区块 ===
  html += '<div class="sd-section sd-cp-outlook-section">' +
    '<div class="sd-section-title">行业前景与投资参考</div>';

  // 前景评估标签
  html += '<div class="sd-cp-outlook-header">' +
    '<span class="sd-cp-outlook-label">行业前景</span>' +
    '<span class="sd-cp-outlook-val" style="color:' + outlook.outlookColor + ';border-color:' + outlook.outlookColor + '44;background:' + outlook.outlookColor + '0a">' + outlook.outlook + '</span>' +
  '</div>';

  // 分析文本
  html += '<div class="sd-cp-outlook-text">' + outlook.analysis + '</div>';

  // 标签
  if (outlook.tags.length > 0) {
    html += '<div class="sd-tag-row">';
    outlook.tags.forEach(function(tag) {
      var tagCls = tag.indexOf('下滑') >= 0 || tag.indexOf('高负债') >= 0 || tag.indexOf('高风险') >= 0 || tag.indexOf('高估值') >= 0 ? 'red' :
                   tag.indexOf('低估值') >= 0 || tag.indexOf('高ROE') >= 0 || tag.indexOf('高增长') >= 0 || tag.indexOf('高毛利') >= 0 || tag.indexOf('低负债') >= 0 ? 'green' :
                   tag.indexOf('高成长') >= 0 || tag.indexOf('积极') >= 0 ? 'red' : 'cyan';
      html += '<span class="sd-tag ' + tagCls + '">' + tag + '</span>';
    });
    html += '</div>';
  }

  // 自选参考建议
  var recommendation = generateWatchlistRecommendation(profile, finData, stockData, outlook);
  html += '<div class="sd-cp-recommend">' +
    '<div class="sd-cp-recommend-icon">' + recommendation.icon + '</div>' +
    '<div class="sd-cp-recommend-body">' +
      '<div class="sd-cp-recommend-title" style="color:' + recommendation.color + '">' + recommendation.title + '</div>' +
      '<div class="sd-cp-recommend-text">' + recommendation.text + '</div>' +
    '</div>' +
  '</div>';

  html += '<div class="sd-flow-note">※ 公司概况数据来源东方财富F10，行业分析基于公开信息自动生成，仅供参考，不构成投资建议</div>';

  html += '</div>'; // .sd-section

  html += '</div>'; // .sd-company-profile

  // 插入到DOM
  var tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  var newEl = tempDiv.firstChild;
  if (insertAfter && insertAfter.nextSibling) {
    detailEl.insertBefore(newEl, insertAfter.nextSibling);
  } else {
    detailEl.appendChild(newEl);
  }
}

/**
 * 生成自选股参考建议
 * 综合行业前景、财务数据、估值水平给出是否纳入自选的建议
 */
function generateWatchlistRecommendation(profile, finData, stockData, outlook) {
  var score = 50; // 基础分
  var reasons = [];

  // 行业前景加分
  if (outlook.outlook === '积极') { score += 15; reasons.push('行业前景积极'); }
  else if (outlook.outlook === '稳健') { score += 8; reasons.push('行业前景稳健'); }
  else if (outlook.outlook === '谨慎') { score -= 10; reasons.push('行业前景谨慎'); }

  // 财务数据加分
  if (finData) {
    if (finData.roe >= 15) { score += 12; reasons.push('ROE>' + finData.roe.toFixed(0) + '%'); }
    else if (finData.roe >= 10) { score += 6; }
    else if (finData.roe > 0 && finData.roe < 5) { score -= 8; reasons.push('ROE偏低'); }

    if (finData.profitYoY > 20) { score += 10; }
    else if (finData.profitYoY < -10) { score -= 12; reasons.push('业绩下滑'); }

    if (finData.grossMargin >= 50) { score += 8; }
    if (finData.debtRatio >= 70) { score -= 8; reasons.push('负债率偏高'); }
    else if (finData.debtRatio > 0 && finData.debtRatio < 30) { score += 5; }
  }

  // 估值加分
  if (stockData && stockData.pe > 0) {
    if (stockData.pe < 15) { score += 10; reasons.push('低估值'); }
    else if (stockData.pe > 50) { score -= 8; reasons.push('估值偏高'); }
    if (stockData.pb > 0 && stockData.pb < 1) { score += 6; reasons.push('破净'); }
  }

  // 上市年限加分（老公司相对稳定）
  if (profile && profile.listingDate) {
    var listYear = parseInt(profile.listingDate.substring(0, 4));
    if (listYear && listYear < 2010) { score += 5; reasons.push('上市超15年'); }
  }

  score = Math.max(0, Math.min(100, score));

  var title, icon, color;
  if (score >= 75) {
    title = '建议纳入自选';
    icon = '★';
    color = '#00C853';
  } else if (score >= 60) {
    title = '可关注，择机纳入';
    icon = '☆';
    color = '#FFD700';
  } else if (score >= 45) {
    title = '中性，持续观察';
    icon = '○';
    color = '#00E5FF';
  } else {
    title = '暂不建议纳入';
    icon = '×';
    color = '#FF3B30';
  }

  var text = '综合评分' + score + '/100。' + (reasons.length > 0 ? reasons.join('、') + '。' : '') + '建议结合自身风险偏好与持仓结构决定是否纳入自选。';

  return { title: title, icon: icon, color: color, text: text, score: score };
}

/**
 * 渲染龙虎榜数据到个股详情区域
 * 在 renderStockResult 之后异步调用，追加到结果区域
 * @param {object} dtData - fetchDragonTiger 返回的数据
 */
function renderDragonTiger(dtData) {
  // 找到个股详情区域，在末尾（添加组合按钮之前）插入龙虎榜
  var area = document.getElementById('stockResultArea');
  if (!area) return;

  var detailEl = area.querySelector('.stock-detail');
  if (!detailEl) return;

  // 移除已有的龙虎榜区域（避免重复）
  var existing = detailEl.querySelector('.sd-dragon-tiger');
  if (existing) existing.remove();

  // 找到添加组合按钮，在其前面插入
  var addBtn = detailEl.querySelector('.sd-add-btn');

  var html = '<div class="sd-dragon-tiger">';

  if (!dtData || !dtData.hasData || dtData.list.length === 0) {
    html += '<div class="sd-section">' +
      '<div class="sd-section-title">龙虎榜 <span style="font-size:0.5rem;color:var(--muted);font-weight:400;margin-left:0.3rem">近30天无上榜记录</span></div>' +
      '<div class="sd-loading">该个股近30天未上龙虎榜，市场关注度一般</div>' +
    '</div>';
    html += '</div>';

    var tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    if (addBtn) {
      detailEl.insertBefore(tempDiv.firstChild, addBtn);
    } else {
      detailEl.appendChild(tempDiv.firstChild);
    }
    return;
  }

  var list = dtData.list;

  // === 龙虎榜汇总 ===
  var latestEntry = list[0]; // 最新一条
  var totalNetBuy = list.reduce(function(s, d) { return s + d.netBuyAmt; }, 0);
  var totalBuy = list.reduce(function(s, d) { return s + d.buyAmt; }, 0);
  var totalSell = list.reduce(function(s, d) { return s + d.sellAmt; }, 0);
  var billboardCount = list.length;

  var netColor = totalNetBuy >= 0 ? '#00C853' : '#FF3B30';
  var netStr = formatBigNumber(totalNetBuy);

  html += '<div class="sd-section sd-dt-section">' +
    '<div class="sd-section-title">龙虎榜 <span style="font-size:0.5rem;color:var(--muted);font-weight:400;margin-left:0.3rem">近30天上榜' + billboardCount + '次</span></div>';

  // 最新上榜日汇总卡片
  var lChangeColor = latestEntry.changeRate >= 0 ? '#00C853' : '#FF3B30';
  var lNetColor = latestEntry.netBuyAmt >= 0 ? '#00C853' : '#FF3B30';

  html += '<div class="sd-dt-latest">' +
    '<div class="sd-dt-latest-date">' + latestEntry.tradeDate + ' 上榜</div>' +
    '<div class="sd-dt-latest-reason">' + (latestEntry.reason || '日涨幅偏离值达标') + '</div>' +
  '</div>';

  // 解读信息（如"2家机构买入，成功率41.81%"）
  if (latestEntry.interpret) {
    html += '<div style="font-size:0.5rem;color:var(--neon-cyan);padding:0.1rem 0.35rem 0.2rem;opacity:0.9">📊 ' + latestEntry.interpret + '</div>';
  }

  // 龙虎榜数据网格
  html += '<div class="sd-grid">' +
    '<div class="sd-item"><span class="sd-item-val" style="color:' + lChangeColor + '">' + (latestEntry.changeRate >= 0 ? '+' : '') + latestEntry.changeRate.toFixed(2) + '%</span><span class="sd-item-lbl">当日涨跌</span></div>' +
    '<div class="sd-item"><span class="sd-item-val">' + (latestEntry.closePrice > 0 ? latestEntry.closePrice.toFixed(2) : '—') + '</span><span class="sd-item-lbl">收盘价</span></div>' +
    '<div class="sd-item"><span class="sd-item-val" style="color:' + lNetColor + '">' + formatBigNumber(latestEntry.netBuyAmt) + '</span><span class="sd-item-lbl">净买额</span></div>' +
    '<div class="sd-item"><span class="sd-item-val">' + (latestEntry.turnoverRate > 0 ? latestEntry.turnoverRate.toFixed(1) + '%' : '—') + '</span><span class="sd-item-lbl">换手率</span></div>' +
  '</div>';

  // 近30天汇总
  html += '<div class="sd-grid" style="margin-top:0.25rem">' +
    '<div class="sd-item"><span class="sd-item-val" style="color:' + netColor + '">' + netStr + '</span><span class="sd-item-lbl">30日龙虎榜净买</span></div>' +
    '<div class="sd-item"><span class="sd-item-val" style="color:#00C853">' + formatBigNumber(totalBuy) + '</span><span class="sd-item-lbl">30日总买入</span></div>' +
    '<div class="sd-item"><span class="sd-item-val" style="color:#FF3B30">' + formatBigNumber(totalSell) + '</span><span class="sd-item-lbl">30日总卖出</span></div>' +
    '<div class="sd-item"><span class="sd-item-val">' + billboardCount + '</span><span class="sd-item-lbl">上榜次数</span></div>' +
  '</div>';

  // 上榜记录列表
  html += '<div class="sd-dt-list">' +
    '<div class="sd-dt-list-title">上榜记录</div>';
  list.forEach(function(item, idx) {
    var iColor = item.netBuyAmt >= 0 ? '#00C853' : '#FF3B30';
    var cColor = item.changeRate >= 0 ? '#00C853' : '#FF3B30';
    var arrow = item.netBuyAmt >= 0 ? '↑' : '↓';
    // 次日涨跌幅
    var nextDayStr = '';
    if (item.nextDayChange !== null && !isNaN(item.nextDayChange)) {
      var ndColor = item.nextDayChange >= 0 ? '#00C853' : '#FF3B30';
      nextDayStr = '<span style="font-size:0.46rem;color:' + ndColor + ';width:2.5rem;text-align:right;flex-shrink:0">次日' + (item.nextDayChange >= 0 ? '+' : '') + item.nextDayChange.toFixed(1) + '%</span>';
    }
    html += '<div class="sd-dt-row' + (idx === 0 ? ' sd-dt-row-latest' : '') + '">' +
      '<span class="sd-dt-row-date">' + item.tradeDate.substring(5) + '</span>' +
      '<span class="sd-dt-row-reason">' + (item.reason || '—') + '</span>' +
      '<span class="sd-dt-row-change" style="color:' + cColor + '">' + (item.changeRate >= 0 ? '+' : '') + item.changeRate.toFixed(2) + '%</span>' +
      '<span class="sd-dt-row-net" style="color:' + iColor + '">' + arrow + ' ' + formatBigNumber(item.netBuyAmt) + '</span>' +
      nextDayStr +
      '<button class="sd-dt-row-btn" onclick="loadDragonTigerDetail(\'' + item.secCode + '\',\'' + item.tradeDate + '\',this)">席位</button>' +
    '</div>';
  });
  html += '</div>';

  // 席位明细容器（默认隐藏，点击"席位"按钮加载）
  html += '<div class="sd-dt-detail" id="dtDetailContainer" style="display:none"></div>';

  html += '<div class="sd-flow-note">※ 龙虎榜数据来自东方财富，盘后更新（交易日17:00后）。点击「席位」查看近三月活跃营业部</div>';
  html += '</div></div>';

  var tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  if (addBtn) {
    detailEl.insertBefore(tempDiv.firstChild, addBtn);
  } else {
    detailEl.appendChild(tempDiv.firstChild);
  }
}

/**
 * 获取个股与大盘共振分析数据
 * 并行获取个股K线和沪深300 K线，计算相关系数、Beta、Alpha、超额收益
 * @param {string} secCode - 纯数字代码，如 '600519'
 * @param {string} stockName - 股票名称（用于显示）
 * @returns {Promise} resolve(resonanceData) 或 resolve(null)
 */
function fetchResonance(secCode, stockName, realtimePrice) {
  // 纯数字代码 → 腾讯代码
  var tencentCode;
  var pureCode = secCode.replace(/^(sh|sz|hk)/i, '');
  if (pureCode.charAt(0) === '6' || pureCode.charAt(0) === '5' || pureCode.charAt(0) === '9') tencentCode = 'sh' + pureCode;
  else if (pureCode.charAt(0) === '0' || pureCode.charAt(0) === '3' || pureCode.charAt(0) === '1' || pureCode.charAt(0) === '2') tencentCode = 'sz' + pureCode;
  else if (secCode.indexOf('hk') === 0 || pureCode.length <= 5) tencentCode = 'hk' + pureCode;
  else tencentCode = 'sh' + pureCode;

  var marketCode = 'sh000300'; // 沪深300作为大盘基准
  var klineCount = 120; // 取近120个交易日（MA20连续天数分析需要更多历史数据）

  // 并行获取个股和大盘K线
  return Promise.all([
    fetchKline(tencentCode, klineCount),
    fetchKline(marketCode, klineCount)
  ]).then(function(results) {
    var stockKL = results[0];
    var indexKL = results[1];
    if (!stockKL || !indexKL || stockKL.closes.length < 10 || indexKL.closes.length < 10) {
      return null;
    }

    // 对齐日期：取两端共同的交易日
    var stockCloses = stockKL.closes;
    var stockDates = stockKL.dates;
    var indexCloses = indexKL.closes;
    var indexDates = indexKL.dates;

    // 找到共同起始日期
    var startIdx = 0;
    var minLen = Math.min(stockCloses.length, indexCloses.length);
    // 从末尾对齐（最新日期对齐），取共同的最后 minLen 个交易日
    var sStart = stockCloses.length - minLen;
    var iStart = indexCloses.length - minLen;

    var sCloses = stockCloses.slice(sStart);
    var iCloses = indexCloses.slice(iStart);

    // 计算日收益率序列
    var sReturns = [];
    var iReturns = [];
    for (var i = 1; i < minLen; i++) {
      if (sCloses[i - 1] > 0 && iCloses[i - 1] > 0) {
        sReturns.push((sCloses[i] - sCloses[i - 1]) / sCloses[i - 1]);
        iReturns.push((iCloses[i] - iCloses[i - 1]) / iCloses[i - 1]);
      }
    }

    if (sReturns.length < 5) return null;

    var n = sReturns.length;

    // 1. Pearson相关系数（共振度）
    var sMean = sReturns.reduce(function(a, b) { return a + b; }, 0) / n;
    var iMean = iReturns.reduce(function(a, b) { return a + b; }, 0) / n;
    var cov = 0, sVar = 0, iVar = 0;
    for (var i = 0; i < n; i++) {
      var sD = sReturns[i] - sMean;
      var iD = iReturns[i] - iMean;
      cov += sD * iD;
      sVar += sD * sD;
      iVar += iD * iD;
    }
    var correlation = (sVar > 0 && iVar > 0) ? cov / Math.sqrt(sVar * iVar) : 0;

    // 2. Beta = Cov(Rs, Ri) / Var(Ri)
    var beta = iVar > 0 ? cov / iVar : 0;

    // 3. Alpha = Rs_mean - Beta * Ri_mean （年化）
    var dailyAlpha = sMean - beta * iMean;
    var annualAlpha = dailyAlpha * 250; // 年化

    // 4. 区间涨跌幅对比（5日/20日/60日）
    function periodReturn(arr, days) {
      var idx = arr.length - days - 1;
      if (idx < 0 || arr[idx] <= 0) return 0;
      return (arr[arr.length - 1] - arr[idx]) / arr[idx];
    }

    var stockR5 = periodReturn(sCloses, 5);
    var indexR5 = periodReturn(iCloses, 5);
    var stockR20 = periodReturn(sCloses, 20);
    var indexR20 = periodReturn(iCloses, 20);
    var stockR60 = periodReturn(sCloses, Math.min(59, sCloses.length - 1));
    var indexR60 = periodReturn(iCloses, Math.min(59, iCloses.length - 1));

    // 5. 个股波动率 vs 大盘波动率
    var sVol = Math.sqrt(sVar / n) * Math.sqrt(250); // 年化波动率
    var iVol = Math.sqrt(iVar / n) * Math.sqrt(250);

    // 6. 同涨同跌天数统计
    var sameDir = 0;
    for (var i = 0; i < n; i++) {
      if ((sReturns[i] > 0 && iReturns[i] > 0) || (sReturns[i] < 0 && iReturns[i] < 0)) sameDir++;
    }
    var sameDirRate = sameDir / n;

    // 7. MA20均线分析（传入实时价格，盘中更准确）
    var maData = calcMAAnalysis(stockKL, stockName, realtimePrice);

    // 8. 最大回撤与恢复时间
    var maxDrawdown = 0, maxDDPeakIdx = 0, maxDDTroughIdx = 0;
    var runningPeak = sCloses[0];
    var runningPeakIdx = 0;
    for (var i = 0; i < sCloses.length; i++) {
      if (sCloses[i] > runningPeak) {
        runningPeak = sCloses[i];
        runningPeakIdx = i;
      }
      if (runningPeak > 0) {
        var dd = (runningPeak - sCloses[i]) / runningPeak;
        if (dd > maxDrawdown) {
          maxDrawdown = dd;
          maxDDPeakIdx = runningPeakIdx;
          maxDDTroughIdx = i;
        }
      }
    }
    // 恢复时间：从谷底开始，价格回到或超过峰值的天数
    var recoveryDays = -1;
    var peakPrice = sCloses[maxDDPeakIdx];
    for (var i = maxDDTroughIdx; i < sCloses.length; i++) {
      if (sCloses[i] >= peakPrice) {
        recoveryDays = i - maxDDTroughIdx;
        break;
      }
    }
    // 大盘最大回撤（对比用）
    var indexMaxDD = 0, idxPeak = iCloses[0];
    for (var i = 0; i < iCloses.length; i++) {
      if (iCloses[i] > idxPeak) idxPeak = iCloses[i];
      if (idxPeak > 0) {
        var idd = (idxPeak - iCloses[i]) / idxPeak;
        if (idd > indexMaxDD) indexMaxDD = idd;
      }
    }

    // 回撤开始/结束日期
    var ddPeakDate = stockDates[sStart + maxDDPeakIdx] || '';
    var ddTroughDate = stockDates[sStart + maxDDTroughIdx] || '';
    // 回撤持续天数（从峰值到谷底）
    var ddDuration = maxDDTroughIdx - maxDDPeakIdx;

    return {
      stockName: stockName || '',
      correlation: correlation,
      beta: beta,
      alpha: annualAlpha,
      stockR5: stockR5, indexR5: indexR5,
      stockR20: stockR20, indexR20: indexR20,
      stockR60: stockR60, indexR60: indexR60,
      stockVol: sVol, indexVol: iVol,
      sameDirRate: sameDirRate,
      sampleDays: n,
      latestDate: stockDates[stockDates.length - 1] || '',
      maData: maData,
      maxDrawdown: maxDrawdown,
      indexMaxDD: indexMaxDD,
      ddPeakDate: ddPeakDate,
      ddTroughDate: ddTroughDate,
      ddDuration: ddDuration,
      recoveryDays: recoveryDays
    };
  }).catch(function(err) {
    console.warn('共振分析获取失败:', err.message);
    return null;
  });
}

/**
 * 计算MA20均线分析数据
 * @param {object} klineData - fetchKline返回的K线数据 {dates, closes, klines}
 * @param {string} stockName - 股票名称
 * @param {number} [realtimePrice] - 实时价格（盘中有更新，比K线最后收盘价更准）
 * @returns {object|null} MA分析结果
 */
function calcMAAnalysis(klineData, stockName, realtimePrice) {
  if (!klineData || !klineData.closes || klineData.closes.length < 25) return null;

  // 过滤无效收盘价（NaN/0/负数），保留有效数据
  var rawCloses = klineData.closes;
  var rawDates = klineData.dates || [];
  var closes = [];
  var dates = [];
  for (var fi = 0; fi < rawCloses.length; fi++) {
    var c = parseFloat(rawCloses[fi]);
    if (!isNaN(c) && c > 0) {
      closes.push(c);
      dates.push(rawDates[fi] || '');
    }
  }

  if (closes.length < 25) return null;

  // 如果有实时价格且有效，替换最后一条收盘价（盘中K线数据可能有延迟）
  var hasRT = realtimePrice && !isNaN(realtimePrice) && realtimePrice > 0;
  if (hasRT && closes.length > 0) {
    var lastKlineClose = closes[closes.length - 1];
    // 仅当实时价与K线收盘价差异超过0.01%时才替换（避免不必要的浮点抖动）
    if (Math.abs(realtimePrice - lastKlineClose) / lastKlineClose > 0.0001) {
      closes[closes.length - 1] = realtimePrice;
    }
  }

  var n = closes.length;
  var period = 20;

  // 计算MA20序列（滑动窗口O(n)优化）
  var ma20Arr = [];
  var maSum = 0;
  for (var i = 0; i < n; i++) {
    maSum += closes[i];
    if (i >= period) maSum -= closes[i - period];
    if (i >= period - 1) {
      ma20Arr.push({ idx: i, ma: maSum / period, date: dates[i] || '', close: closes[i] });
    }
  }

  if (ma20Arr.length === 0) return null;

  var latest = ma20Arr[ma20Arr.length - 1];
  var currentPrice = hasRT ? realtimePrice : latest.close;
  var ma20 = latest.ma;

  // 当前价格与MA20的偏离度
  var deviation = ma20 > 0 ? ((currentPrice - ma20) / ma20) * 100 : 0;

  // 是否在MA20之上
  var aboveMA = currentPrice > ma20;

  // MA20趋势方向（近5日MA20是否在上升）
  var ma5agoIdx = Math.max(0, ma20Arr.length - 6);
  var ma5ago = ma20Arr[ma5agoIdx].ma;
  var maTrend = ma20 - ma5ago;
  var maTrendPct = ma5ago > 0 ? (maTrend / ma5ago) * 100 : 0;
  var maRising = maTrend > 0;

  // 连续在MA20之上/之下的天数
  var consecutiveDays = 0;
  var consecutiveDir = aboveMA ? 'above' : 'below';
  for (var i = ma20Arr.length - 1; i >= 0; i--) {
    if (aboveMA && ma20Arr[i].close > ma20Arr[i].ma) consecutiveDays++;
    else if (!aboveMA && ma20Arr[i].close < ma20Arr[i].ma) consecutiveDays++;
    else break;
  }

  // 近期是否刚突破MA20（从下方突破到上方，或刚跌破）
  var justCrossed = consecutiveDays <= 3;

  // MA5和MA10辅助判断
  function calcMA(p) {
    if (n < p) return 0;
    var s = 0;
    for (var i = 0; i < p; i++) s += closes[n - 1 - i];
    return s / p;
  }
  var ma5 = calcMA(5);
  var ma10 = calcMA(10);

  // 均线排列：多头(MA5>MA10>MA20) / 空头(MA5<MA10<MA20) / 纠缠
  var maAlignment;
  if (ma5 > ma10 && ma10 > ma20) maAlignment = 'bullish';
  else if (ma5 < ma10 && ma10 < ma20) maAlignment = 'bearish';
  else maAlignment = 'mixed';

  // 综合买入建议
  var signal, signalCls, advice;
  if (aboveMA && maRising && maAlignment === 'bullish' && deviation < 10) {
    signal = '在20日线上·趋势向上';
    signalCls = 'buy';
    advice = '价格站在20日均线上面，短期中期都往上走，可以考虑买入或继续拿着';
  } else if (aboveMA && maRising && deviation >= 10) {
    signal = '在线上但涨太多了';
    signalCls = 'caution';
    advice = '虽然在20日线上面，但短期涨太多了(高出' + deviation.toFixed(1) + '%)，追进去容易被套，等它回调一下再说';
  } else if (aboveMA && !maRising) {
    signal = '在线上但方向不明';
    signalCls = 'hold';
    advice = '价格在20日线上面，但均线没怎么动，方向不明朗，先拿着观望';
  } else if (!aboveMA && maRising && justCrossed) {
    signal = '回到20日线附近';
    signalCls = 'watch';
    advice = '价格回到20日均线附近，如果站住了反弹，可以考虑少量买入';
  } else if (!aboveMA && !maRising && maAlignment === 'bearish') {
    signal = '在20日线下·趋势向下';
    signalCls = 'sell';
    advice = '跌破20日均线，而且短期中期都往下走，别急着买，观望或者减仓';
  } else if (!aboveMA && justCrossed) {
    signal = '刚跌破20日线';
    signalCls = 'caution';
    advice = '刚刚跌破20日均线，看看能不能很快站回去，先别急着抄底';
  } else {
    signal = '在20日线下';
    signalCls = 'sell';
    advice = '价格在20日均线下方，短期偏弱，不建议买入';
  }

  return {
    stockName: stockName || '',
    currentPrice: currentPrice,
    ma20: ma20,
    ma5: ma5,
    ma10: ma10,
    deviation: deviation,
    aboveMA: aboveMA,
    maRising: maRising,
    maTrendPct: maTrendPct,
    consecutiveDays: consecutiveDays,
    consecutiveDir: consecutiveDir,
    justCrossed: justCrossed,
    maAlignment: maAlignment,
    signal: signal,
    signalCls: signalCls,
    advice: advice,
    latestDate: latest.date
  };
}

/**
 * 渲染MA20均线分析到个股详情区域
 * @param {object} maData - calcMAAnalysis返回的数据
 */
function renderMAAnalysis(maData) {
  var area = document.getElementById('stockResultArea');
  if (!area) return;
  var detailEl = area.querySelector('.stock-detail');
  if (!detailEl) return;

  // 移除已有区域
  var existing = detailEl.querySelector('.sd-ma-section');
  if (existing) existing.remove();

  var addBtn = detailEl.querySelector('.sd-add-btn');

  if (!maData) {
    var emptyHtml = '<div class="sd-section sd-ma-section">' +
      '<div class="sd-section-title">MA20均线分析</div>' +
      '<div class="sd-loading">暂无足够K线数据计算MA20</div>' +
    '</div>';
    var emptyDiv = document.createElement('div');
    emptyDiv.innerHTML = emptyHtml;
    if (addBtn) detailEl.insertBefore(emptyDiv.firstChild, addBtn);
    else detailEl.appendChild(emptyDiv.firstChild);
    return;
  }

  // 信号颜色
  var signalColor = {
    buy: '#00C853',
    caution: '#FFD700',
    hold: '#00E5FF',
    watch: '#FFD700',
    sell: '#FF3B30'
  };
  var sColor = signalColor[maData.signalCls] || '#A0B0C8';

  // 均线排列标签
  var alignLabel, alignCls;
  if (maData.maAlignment === 'bullish') { alignLabel = '都往上走'; alignCls = 'red'; }
  else if (maData.maAlignment === 'bearish') { alignLabel = '都往下走'; alignCls = 'green'; }
  else { alignLabel = '方向不一'; alignCls = 'yellow'; }

  // 连续天数描述
  var consecDesc = maData.consecutiveDays > 0
    ? '连续' + maData.consecutiveDays + '天' + (maData.aboveMA ? '站上' : '跌破') + '20日线'
    : '今天刚穿过20日线';

  var html = '<div class="sd-section sd-ma-section">' +
    '<div class="sd-section-title">20日均线分析 <span style="font-size:0.5rem;color:var(--muted);font-weight:400;margin-left:0.3rem">' + escHTML(maData.latestDate || '') + '</span></div>';

  // 信号横幅
  html += '<div class="sd-ma-signal" style="border-left-color:' + sColor + '">' +
    '<div class="sd-ma-signal-icon" style="color:' + sColor + '">' +
      (maData.aboveMA ? '▲' : '▼') +
    '</div>' +
    '<div class="sd-ma-signal-body">' +
      '<div class="sd-ma-signal-label" style="color:' + sColor + '">' + escHTML(maData.signal) + '</div>' +
      '<div class="sd-ma-signal-advice">' + escHTML(maData.advice) + '</div>' +
    '</div>' +
  '</div>';

  // 均线数据网格
  html += '<div class="sd-grid">' +
    '<div class="sd-item"><span class="sd-item-val" style="color:' + (maData.aboveMA ? '#00C853' : '#FF3B30') + '">' + maData.currentPrice.toFixed(2) + '</span><span class="sd-item-lbl">现价</span></div>' +
    '<div class="sd-item"><span class="sd-item-val" style="color:var(--neon-cyan)">' + maData.ma20.toFixed(2) + '</span><span class="sd-item-lbl">20日均线</span></div>' +
    '<div class="sd-item"><span class="sd-item-val" style="color:' + (maData.deviation >= 0 ? '#00C853' : '#FF3B30') + '">' + (maData.deviation >= 0 ? '+' : '') + maData.deviation.toFixed(2) + '%</span><span class="sd-item-lbl">离均线多远</span></div>' +
    '<div class="sd-item"><span class="sd-item-val" style="color:' + (maData.maRising ? '#00C853' : '#FF3B30') + '">' + (maData.maRising ? '↑' : '↓') + ' ' + Math.abs(maData.maTrendPct).toFixed(2) + '%</span><span class="sd-item-lbl">均线方向</span></div>' +
  '</div>';

  // 均线排列 + 连续天数
  html += '<div class="sd-grid" style="margin-top:0.25rem">' +
    '<div class="sd-item"><span class="sd-item-val" style="color:var(--neon-cyan)">' + maData.ma5.toFixed(2) + '</span><span class="sd-item-lbl">5日均线</span></div>' +
    '<div class="sd-item"><span class="sd-item-val" style="color:var(--neon-cyan)">' + maData.ma10.toFixed(2) + '</span><span class="sd-item-lbl">10日均线</span></div>' +
    '<div class="sd-item"><span class="sd-item-val" style="color:var(--neon-cyan)">' + maData.ma20.toFixed(2) + '</span><span class="sd-item-lbl">20日均线</span></div>' +
    '<div class="sd-item"><span class="sd-item-val" style="color:var(--neon-cyan)">' + maData.consecutiveDays + '天</span><span class="sd-item-lbl">' + (maData.aboveMA ? '在线上' : '在线下') + '</span></div>' +
  '</div>';

  // 标签行
  html += '<div class="sd-tag-row">' +
    '<span class="sd-tag ' + (maData.aboveMA ? 'green' : 'red') + '">' + (maData.aboveMA ? '站上20日线' : '跌破20日线') + '</span>' +
    '<span class="sd-tag ' + alignCls + '">' + alignLabel + '</span>' +
    '<span class="sd-tag ' + (maData.maRising ? 'green' : 'red') + '">均线' + (maData.maRising ? '往上' : '往下') + '</span>' +
    (maData.justCrossed ? '<span class="sd-tag yellow">刚穿过</span>' : '') +
  '</div>';

  // 买入建议总结
  var buyAdvice, buyCls;
  if (maData.signalCls === 'buy') { buyAdvice = '可以买'; buyCls = 'buy'; }
  else if (maData.signalCls === 'watch') { buyAdvice = '可以少量买'; buyCls = 'watch'; }
  else if (maData.signalCls === 'hold') { buyAdvice = '先拿着别动'; buyCls = 'hold'; }
  else if (maData.signalCls === 'caution') { buyAdvice = '先等等再说'; buyCls = 'caution'; }
  else { buyAdvice = '别买'; buyCls = 'sell'; }

  html += '<div class="sd-ma-buy-advice ' + buyCls + '">' +
    '<span class="sd-ma-buy-label">要不要买</span>' +
    '<span class="sd-ma-buy-text">' + buyAdvice + '</span>' +
  '</div>';

  html += '<div class="sd-flow-note">※ 20日均线=最近20天收盘价的平均，是判断短期趋势好不好的重要参考。价格在均线上面说明短期偏强，在下面说明偏弱。离均线太远要注意可能会回调</div>';

  html += '</div>';

  var tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  if (addBtn) {
    detailEl.insertBefore(tempDiv.firstChild, addBtn);
  } else {
    detailEl.appendChild(tempDiv.firstChild);
  }
}

/**
 * 渲染大盘共振分析到个股详情区域
 * @param {object} data - fetchResonance 返回的数据
 */
function renderResonance(data) {
  var area = document.getElementById('stockResultArea');
  if (!area) return;
  var detailEl = area.querySelector('.stock-detail');
  if (!detailEl) return;

  // 移除已有的共振区域
  var existing = detailEl.querySelector('.sd-resonance');
  if (existing) existing.remove();

  var addBtn = detailEl.querySelector('.sd-add-btn');

  var html = '<div class="sd-resonance"><div class="sd-section sd-resonance-section">';

  if (!data) {
    html += '<div class="sd-section-title">大盘共振分析</div>' +
      '<div class="sd-loading">暂无足够数据进行分析（需近60个交易日K线）</div>' +
    '</div></div>';
    var tempDiv0 = document.createElement('div');
    tempDiv0.innerHTML = html;
    if (addBtn) detailEl.insertBefore(tempDiv0.firstChild, addBtn);
    else detailEl.appendChild(tempDiv0.firstChild);
    return;
  }

  // 共振强度判断
  var corr = data.correlation;
  var corrPct = Math.abs(corr) * 100;
  var corrLabel, corrCls, corrDesc;
  if (corrPct >= 80) { corrLabel = '高度同步'; corrCls = 'strong'; corrDesc = '与大盘高度同步'; }
  else if (corrPct >= 60) { corrLabel = '比较同步'; corrCls = 'medium'; corrDesc = '与大盘较为同步'; }
  else if (corrPct >= 40) { corrLabel = '一般'; corrCls = 'weak'; corrDesc = '与大盘联动一般'; }
  else { corrLabel = '各走各的'; corrCls = 'independent'; corrDesc = '走势独立于大盘'; }

  // Beta判断
  var beta = data.beta;
  var betaLabel, betaCls;
  if (beta > 1.3) { betaLabel = '涨跌更猛'; betaCls = 'red'; }
  else if (beta > 0.8) { betaLabel = '差不多'; betaCls = 'yellow'; }
  else if (beta > 0.3) { betaLabel = '比较稳'; betaCls = 'green'; }
  else { betaLabel = '不跟着走'; betaCls = 'cyan'; }

  // 跑赢大盘判断
  function outperformStr(stockR, indexR) {
    var diff = (stockR - indexR) * 100;
    if (diff > 2) return { text: '多赚' + Math.abs(diff).toFixed(1) + '%', cls: 'outperform' };
    if (diff < -2) return { text: '少赚' + Math.abs(diff).toFixed(1) + '%', cls: 'underperform' };
    return { text: '差不多', cls: 'flat' };
  }
  var r5 = outperformStr(data.stockR5, data.indexR5);
  var r20 = outperformStr(data.stockR20, data.indexR20);
  var r60 = outperformStr(data.stockR60, data.indexR60);

  // Alpha判断
  var alphaPct = data.alpha * 100;
  var alphaLabel = alphaPct > 5 ? '明显跑赢' : alphaPct > 0 ? '小幅跑赢' : alphaPct > -5 ? '小幅落后' : '明显落后';
  var alphaCls = alphaPct > 0 ? 'outperform' : 'underperform';

  // 波动率比较
  var volRatio = data.indexVol > 0 ? data.stockVol / data.indexVol : 1;
  var volLabel = volRatio > 1.5 ? '比大盘猛得多' : volRatio > 1.1 ? '比大盘略大' : volRatio > 0.9 ? '跟大盘差不多' : '比大盘稳';

  // 综合结论
  var conclusion = '';
  var conclusionCls = '';
  var totalOutperform = (data.stockR5 > data.indexR5 ? 1 : 0) + (data.stockR20 > data.indexR20 ? 1 : 0) + (data.stockR60 > data.indexR60 ? 1 : 0);
  if (corrPct >= 60 && totalOutperform >= 2 && alphaPct > 0) {
    conclusion = '跟着大盘走，而且一直比大盘强，是好票';
    conclusionCls = 'good';
  } else if (corrPct >= 60 && totalOutperform <= 1 && alphaPct < 0) {
    conclusion = '跟着大盘走，但一直比大盘弱，不太行';
    conclusionCls = 'bad';
  } else if (corrPct < 40 && alphaPct > 5) {
    conclusion = '不跟大盘走，自己涨自己的，赚得还多';
    conclusionCls = 'good';
  } else if (corrPct < 40 && alphaPct < -5) {
    conclusion = '不跟大盘走，自己跌自己的，要小心';
    conclusionCls = 'bad';
  } else if (corrPct >= 60) {
    conclusion = '跟着大盘走，没比大盘多赚也没少赚';
    conclusionCls = 'neutral';
  } else {
    conclusion = '走势比较独立，好不好得看公司本身';
    conclusionCls = 'neutral';
  }

  html += '<div class="sd-section-title">跟大盘比一比 <span style="font-size:0.5rem;color:var(--muted);font-weight:400;margin-left:0.3rem">近' + data.sampleDays + '天 · 拿沪深300做参照</span></div>';

  // 核心指标网格
  html += '<div class="sd-grid">' +
    '<div class="sd-item"><span class="sd-item-val" style="color:var(--neon-cyan)">' + corrPct.toFixed(0) + '%</span><span class="sd-item-lbl">跟大盘同步</span></div>' +
    '<div class="sd-item"><span class="sd-item-val" style="color:var(--neon-cyan)">' + beta.toFixed(2) + '</span><span class="sd-item-lbl">涨跌放大倍数</span></div>' +
    '<div class="sd-item"><span class="sd-item-val" style="color:' + (alphaPct >= 0 ? '#00C853' : '#FF3B30') + '">' + (alphaPct >= 0 ? '+' : '') + alphaPct.toFixed(1) + '%</span><span class="sd-item-lbl">比大盘多赚</span></div>' +
    '<div class="sd-item"><span class="sd-item-val" style="color:var(--neon-cyan)">' + (data.sameDirRate * 100).toFixed(0) + '%</span><span class="sd-item-lbl">同涨同跌</span></div>' +
  '</div>';

  // 标签行
  html += '<div class="sd-tag-row">' +
    '<span class="sd-tag ' + corrCls + '">' + corrLabel + '</span>' +
    '<span class="sd-tag ' + betaCls + '">涨跌' + betaLabel + '</span>' +
    '<span class="sd-tag ' + alphaCls + '">' + alphaLabel + '</span>' +
    '<span class="sd-tag cyan">波动' + volLabel + '</span>' +
  '</div>';

  // 跑赢大盘对比表
  html += '<div class="sd-resonance-table">' +
    '<div class="sd-resonance-row sd-resonance-header">' +
      '<span>时间段</span><span>' + escHTML(data.stockName || '个股') + '</span><span>沪深300</span><span>差多少</span>' +
    '</div>' +
    '<div class="sd-resonance-row">' +
      '<span>近5天</span>' +
      '<span style="color:' + (data.stockR5 >= 0 ? '#00C853' : '#FF3B30') + '">' + (data.stockR5 >= 0 ? '+' : '') + (data.stockR5 * 100).toFixed(2) + '%</span>' +
      '<span style="color:' + (data.indexR5 >= 0 ? '#00C853' : '#FF3B30') + '">' + (data.indexR5 >= 0 ? '+' : '') + (data.indexR5 * 100).toFixed(2) + '%</span>' +
      '<span class="sd-resonance-diff ' + r5.cls + '">' + r5.text + '</span>' +
    '</div>' +
    '<div class="sd-resonance-row">' +
      '<span>近20天</span>' +
      '<span style="color:' + (data.stockR20 >= 0 ? '#00C853' : '#FF3B30') + '">' + (data.stockR20 >= 0 ? '+' : '') + (data.stockR20 * 100).toFixed(2) + '%</span>' +
      '<span style="color:' + (data.indexR20 >= 0 ? '#00C853' : '#FF3B30') + '">' + (data.indexR20 >= 0 ? '+' : '') + (data.indexR20 * 100).toFixed(2) + '%</span>' +
      '<span class="sd-resonance-diff ' + r20.cls + '">' + r20.text + '</span>' +
    '</div>' +
    '<div class="sd-resonance-row">' +
      '<span>近60天</span>' +
      '<span style="color:' + (data.stockR60 >= 0 ? '#00C853' : '#FF3B30') + '">' + (data.stockR60 >= 0 ? '+' : '') + (data.stockR60 * 100).toFixed(2) + '%</span>' +
      '<span style="color:' + (data.indexR60 >= 0 ? '#00C853' : '#FF3B30') + '">' + (data.indexR60 >= 0 ? '+' : '') + (data.indexR60 * 100).toFixed(2) + '%</span>' +
      '<span class="sd-resonance-diff ' + r60.cls + '">' + r60.text + '</span>' +
    '</div>' +
  '</div>';

  // 最大回撤与恢复时间
  var ddPct = data.maxDrawdown * 100;
  var idxDDPct = data.indexMaxDD * 100;
  var ddCls = ddPct > 20 ? 'red' : ddPct > 10 ? 'yellow' : 'green';
  var ddLabel = ddPct > 20 ? '回撤很大' : ddPct > 10 ? '回撤中等' : '回撤不大';
  // 恢复时间描述
  var recoveryText, recoveryCls;
  if (data.recoveryDays < 0) {
    recoveryText = '还没涨回来';
    recoveryCls = 'underperform';
  } else if (data.recoveryDays === 0) {
    recoveryText = '当天就反弹';
    recoveryCls = 'outperform';
  } else if (data.recoveryDays <= 5) {
    recoveryText = data.recoveryDays + '天就涨回来';
    recoveryCls = 'outperform';
  } else if (data.recoveryDays <= 20) {
    recoveryText = data.recoveryDays + '天涨回来';
    recoveryCls = 'flat';
  } else {
    recoveryText = '花了' + data.recoveryDays + '天才涨回来';
    recoveryCls = 'underperform';
  }
  // 回撤 vs 大盘
  var ddVsIndex = ddPct - idxDDPct;
  var ddVsText = Math.abs(ddVsIndex) < 1 ? '跟大盘差不多' :
    ddVsIndex > 0 ? '比大盘跌得多' + ddVsIndex.toFixed(1) + '%' :
    '比大盘跌得少' + Math.abs(ddVsIndex).toFixed(1) + '%';

  html += '<div class="sd-resonance-table" style="margin-top:0.5rem">' +
    '<div class="sd-resonance-row sd-resonance-header">' +
      '<span>最大回撤</span><span>幅度</span><span>持续</span><span>恢复时间</span>' +
    '</div>' +
    '<div class="sd-resonance-row">' +
      '<span>' + escHTML(data.stockName || '个股') + '</span>' +
      '<span style="color:' + (ddPct > 10 ? '#FF3B30' : '#00C853') + '">-' + ddPct.toFixed(1) + '%</span>' +
      '<span>' + data.ddDuration + '天</span>' +
      '<span class="sd-resonance-diff ' + recoveryCls + '">' + recoveryText + '</span>' +
    '</div>' +
    '<div class="sd-resonance-row">' +
      '<span>沪深300</span>' +
      '<span style="color:' + (idxDDPct > 10 ? '#FF3B30' : '#00C853') + '">-' + idxDDPct.toFixed(1) + '%</span>' +
      '<span>—</span>' +
      '<span class="sd-resonance-diff flat">' + ddVsText + '</span>' +
    '</div>' +
  '</div>';

  html += '<div class="sd-tag-row" style="margin-top:0.4rem">' +
    '<span class="sd-tag ' + ddCls + '">' + ddLabel + '</span>' +
    (data.recoveryDays < 0 ? '<span class="sd-tag red">尚未恢复</span>' :
     data.recoveryDays <= 5 ? '<span class="sd-tag green">快速恢复</span>' :
     data.recoveryDays <= 20 ? '<span class="sd-tag yellow">恢复一般</span>' :
     '<span class="sd-tag red">恢复很慢</span>') +
    '<span class="sd-tag cyan">' + ddVsText + '</span>' +
  '</div>';

  if (data.ddPeakDate && data.ddTroughDate) {
    html += '<div class="sd-flow-note">※ 最大回撤=' + data.ddPeakDate.slice(5) + '创新高后跌到' + data.ddTroughDate.slice(5) + '最低点，跌了' + ddPct.toFixed(1) + '%（持续' + data.ddDuration + '天）' + (data.recoveryDays >= 0 ? '，' + data.recoveryDays + '天后涨回原高' : '，至今还没涨回原高') + '</div>';
  }

  // 综合结论
  html += '<div class="sd-resonance-conclusion ' + conclusionCls + '">' +
    '<span class="sd-resonance-conclusion-label">综合判断</span>' +
    '<span class="sd-resonance-conclusion-text">' + conclusion + '</span>' +
  '</div>';

  // 指标解释
  html += '<div class="sd-flow-note">※ 跟大盘同步=这只股票和大盘涨跌步调一致程度；涨跌放大倍数=大盘涨1%它涨多少；比大盘多赚=刨掉大盘涨跌后自己多赚或少赚的；同涨同跌=大盘涨它也涨、大盘跌它也跌的天数占比</div>';

  html += '</div></div>';

  var tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  if (addBtn) {
    detailEl.insertBefore(tempDiv.firstChild, addBtn);
  } else {
    detailEl.appendChild(tempDiv.firstChild);
  }
}

/**
 * 获取并渲染个股一年K线图
 * @param {string} secCode - 股票代码
 * @param {string} stockName - 股票名称
 * @param {number} [realtimePrice] - 实时价格（用于更新最后一根K线的收盘价）
 */
function fetchAndRenderKlineChart(secCode, stockName, realtimePrice) {
  var pureCode = secCode.replace(/^(sh|sz|hk)/i, '');
  var tencentCode;
  if (pureCode.charAt(0) === '6' || pureCode.charAt(0) === '5' || pureCode.charAt(0) === '9') tencentCode = 'sh' + pureCode;
  else if (pureCode.charAt(0) === '0' || pureCode.charAt(0) === '3' || pureCode.charAt(0) === '1' || pureCode.charAt(0) === '2') tencentCode = 'sz' + pureCode;
  else if (secCode.indexOf('hk') === 0 || pureCode.length <= 5) tencentCode = 'hk' + pureCode;
  else tencentCode = 'sh' + pureCode;

  return fetchKline(tencentCode, 250).then(function(klData) {
    _currentKlineData = { klData: klData, stockName: stockName, realtimePrice: realtimePrice };
    renderKlineChart(klData, stockName, realtimePrice);
  }).catch(function(err) {
    console.warn('K线图获取失败:', err.message);
    renderKlineChart(null, stockName);
  });
}

/**
 * 渲染K线图（蜡烛图+成交量+MA20）
 * @param {object} klData - fetchKline 返回的 {dates, closes, klines}
 * @param {string} stockName
 */
function renderKlineChart(klData, stockName, realtimePrice) {
  var area = document.getElementById('stockResultArea');
  if (!area) return;
  var detailEl = area.querySelector('.stock-detail');
  if (!detailEl) return;

  // 移除已有的K线图区域
  var existing = detailEl.querySelector('.sd-kline');
  if (existing) existing.remove();

  var addBtn = detailEl.querySelector('.sd-add-btn');

  if (!klData || !klData.klines || klData.klines.length < 10) {
    var emptyHtml = '<div class="sd-kline"><div class="sd-section sd-kline-section">' +
      '<div class="sd-section-title">近一年K线走势</div>' +
      '<div class="sd-loading">暂无足够K线数据</div>' +
      '</div></div>';
    var emptyDiv = document.createElement('div');
    emptyDiv.innerHTML = emptyHtml;
    if (addBtn) detailEl.insertBefore(emptyDiv.firstChild, addBtn);
    else detailEl.appendChild(emptyDiv.firstChild);
    return;
  }

  var html = '<div class="sd-kline"><div class="sd-section sd-kline-section">' +
    '<div class="sd-section-title">近一年K线走势 <span style="font-size:0.5rem;color:var(--muted);font-weight:400;margin-left:0.3rem">' + escHTML(stockName || '') + ' · ' + klData.klines.length + '个交易日</span></div>' +
    '<canvas id="stockKlineCanvas" class="sd-kline-canvas"></canvas>' +
    '<div class="sd-kline-legend">' +
      '<span><span class="dot" style="background:#00C853"></span>涨</span>' +
      '<span><span class="dot" style="background:#FF3B30"></span>跌</span>' +
      '<span><span class="dot" style="background:#FFB400"></span>MA20均线</span>' +
    '</div>' +
    '<div class="sd-flow-note">※ 绿色蜡烛表示收盘价高于开盘价（上涨），红色表示收盘价低于开盘价（下跌），黄线为20日均线</div>' +
    '</div></div>';

  var tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  if (addBtn) detailEl.insertBefore(tempDiv.firstChild, addBtn);
  else detailEl.appendChild(tempDiv.firstChild);

  // 延迟绘制，确保 canvas 已挂载到 DOM
  Perf.trackedSetTimeout(function() {
 drawStockKline(klData, realtimePrice);
 }, 50);
}

/**
 * 在 canvas 上绘制K线蜡烛图
 * @param {object} klData - {dates, closes, klines}
 * @param {number} [realtimePrice] - 实时价格（更新最后一根K线收盘价，使MA20更准）
 */
function drawStockKline(klData, realtimePrice) {
  var canvas = document.getElementById('stockKlineCanvas');
  if (!canvas) return;

  var klines = klData.klines;
  var n = klines.length;
  var dpr = window.devicePixelRatio || 1;
  var cw = canvas.parentElement.clientWidth - 24;
  if (cw < 200) cw = 200;

  // 布局：上方K线区70%，下方成交量30%
  var priceH = Math.round(cw * 0.62);
  var volH = Math.round(cw * 0.18);
  var labelH = 16;
  var ch = priceH + volH + labelH + 8;

  canvas.width = cw * dpr;
  canvas.height = ch * dpr;
  canvas.style.width = cw + 'px';
  canvas.style.height = ch + 'px';
  var ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cw, ch);

  // 解析K线数据（过滤无效数据，NaN→跳过）
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

  // 如果有实时价格，更新最后一根K线的收盘价（盘中K线数据可能延迟）
  var hasRT = realtimePrice && !isNaN(realtimePrice) && realtimePrice > 0;
  if (hasRT && data.length > 0) {
    var lastClose = data[data.length - 1].close;
    if (Math.abs(realtimePrice - lastClose) / lastClose > 0.0001) {
      data[data.length - 1].close = realtimePrice;
      // 更新最高最低价（实时价可能突破当日高低点）
      if (realtimePrice > data[data.length - 1].high) data[data.length - 1].high = realtimePrice;
      if (realtimePrice < data[data.length - 1].low) data[data.length - 1].low = realtimePrice;
    }
  }
  n = data.length;

  // 计算价格范围
  var minPrice = Infinity, maxPrice = -Infinity, maxVol = 0;
  for (var i = 0; i < n; i++) {
    if (data[i].low < minPrice) minPrice = data[i].low;
    if (data[i].high > maxPrice) maxPrice = data[i].high;
    if (data[i].volume > maxVol) maxVol = data[i].volume;
  }
  var priceRange = maxPrice - minPrice;
  if (priceRange < 0.01) priceRange = 1;
  minPrice -= priceRange * 0.05;
  maxPrice += priceRange * 0.05;
  priceRange = maxPrice - minPrice;

  // 计算MA20（滑动窗口O(n)优化）
  var ma20 = [];
  var maSum = 0;
  for (var i = 0; i < n; i++) {
    maSum += data[i].close;
    if (i >= 20) maSum -= data[i - 20].close;
    if (i >= 19) ma20.push(maSum / 20);
    else ma20.push(null);
  }

  // 绘图区域
  var padL = 4, padR = 38, padT = 4;
  var plotW = cw - padL - padR;
  var plotH = priceH - padT - 4;
  var volTop = priceH + 4;
  var volPlotH = volH - 6;

  // 蜡烛宽度
  var candleW = Math.max(1, plotW / n * 0.7);
  var candleGap = plotW / n;

  // 网格线
  ctx.strokeStyle = 'rgba(128,128,128,0.1)';
  ctx.lineWidth = 0.5;
  for (var g = 0; g <= 4; g++) {
    var gy = padT + plotH * g / 4;
    ctx.beginPath();
    ctx.moveTo(padL, gy);
    ctx.lineTo(padL + plotW, gy);
    ctx.stroke();
  }

  // 价格标签
  ctx.fillStyle = 'rgba(128,128,128,0.7)';
  ctx.font = '9px JetBrains Mono, monospace';
  ctx.textAlign = 'left';
  for (var g = 0; g <= 4; g++) {
    var price = maxPrice - priceRange * g / 4;
    var gy = padT + plotH * g / 4;
    ctx.fillText(price.toFixed(2), padL + plotW + 2, gy + 3);
  }

  // 绘制蜡烛
  for (var i = 0; i < n; i++) {
    var x = padL + candleGap * i + candleGap / 2;
    var d = data[i];
    var isUp = d.close >= d.open;
    var color = isUp ? '#00C853' : '#FF3B30';

    // 影线
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(0.5, candleW * 0.15);
    ctx.beginPath();
    ctx.moveTo(x, padT + (1 - (d.high - minPrice) / priceRange) * plotH);
    ctx.lineTo(x, padT + (1 - (d.low - minPrice) / priceRange) * plotH);
    ctx.stroke();

    // 实体
    var bodyTop = padT + (1 - (Math.max(d.open, d.close) - minPrice) / priceRange) * plotH;
    var bodyBot = padT + (1 - (Math.min(d.open, d.close) - minPrice) / priceRange) * plotH;
    var bodyH = Math.max(0.5, bodyBot - bodyTop);
    ctx.fillStyle = color;
    ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);

    // 成交量柱
    if (maxVol > 0) {
      var volBarH = (d.volume / maxVol) * volPlotH;
      ctx.fillStyle = isUp ? 'rgba(0,200,83,0.4)' : 'rgba(255,59,48,0.4)';
      ctx.fillRect(x - candleW / 2, volTop + volPlotH - volBarH, candleW, volBarH);
    }
  }

  // 绘制MA20线
  ctx.strokeStyle = '#FFB400';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  var started = false;
  for (var i = 0; i < n; i++) {
    if (ma20[i] === null) continue;
    var x = padL + candleGap * i + candleGap / 2;
    var y = padT + (1 - (ma20[i] - minPrice) / priceRange) * plotH;
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // 日期标签（首、中、尾）
  ctx.fillStyle = 'rgba(128,128,128,0.7)';
  ctx.font = '8px JetBrains Mono, monospace';
  ctx.textAlign = 'center';
  var dateY = ch - 2;
  if (n > 0) {
    ctx.fillText(data[0].date.slice(5), padL + candleGap * 0.5, dateY);
    ctx.fillText(data[Math.floor(n / 2)].date.slice(5), padL + candleGap * (Math.floor(n / 2) + 0.5), dateY);
    ctx.fillText(data[n - 1].date.slice(5), padL + candleGap * (n - 0.5), dateY);
  }

  // 最新价格标注
  if (n > 0) {
    var lastD = data[n - 1];
    var lastY = padT + (1 - (lastD.close - minPrice) / priceRange) * plotH;
    var lastColor = lastD.close >= lastD.open ? '#00C853' : '#FF3B30';
    ctx.strokeStyle = lastColor;
    ctx.setLineDash([2, 2]);
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(padL, lastY);
    ctx.lineTo(padL + plotW, lastY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = lastColor;
    ctx.font = 'bold 9px JetBrains Mono, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(lastD.close.toFixed(2), padL + plotW + 2, lastY + 3);
  }
}

/**
 * 渲染国家队持股数据到个股详情区域
 * 在 renderDragonTiger 之后异步调用，插入到龙虎榜区块之后
 * @param {object} ntData - fetchNationalTeam 返回的数据
 */
function renderNationalTeam(ntData) {
  var area = document.getElementById('stockResultArea');
  if (!area) return;

  var detailEl = area.querySelector('.stock-detail');
  if (!detailEl) return;

  // 移除已有的国家队区域（避免重复）
  var existing = detailEl.querySelector('.sd-national-team');
  if (existing) existing.remove();

  // 找到添加组合按钮，在其前面插入
  var addBtn = detailEl.querySelector('.sd-add-btn');

  var html = '<div class="sd-national-team">';

  if (!ntData || !ntData.hasData || ntData.list.length === 0) {
    html += '<div class="sd-section sd-nt-section">' +
      '<div class="sd-section-title">国家队有没有买 <span style="font-size:0.5rem;color:var(--muted);font-weight:400;margin-left:0.3rem">最新一期没有国家队</span></div>' +
      '<div class="sd-loading">该个股最新前十大股东中没有国家队（汇金/证金/社保/大基金/外管局），国家队没买这只票</div>';

    // 无国家队时也展示李大霄点评
    var absentQuote = getNationalTeamQuote(ntData);
    if (absentQuote) {
      html += '<div class="sd-nt-daxiao">' +
        '<div class="sd-nt-daxiao-context">' + escHTML(absentQuote.context || '') + '</div>' +
        '<div class="sd-nt-daxiao-quote">"' + escHTML(absentQuote.q) + '"</div>' +
        '<div class="sd-nt-daxiao-sub">' + escHTML(absentQuote.sub || '') + '</div>' +
        '<div class="sd-nt-daxiao-author">李大霄</div>' +
      '</div>';
    }

    // 奇迹点评——无国家队入驻更合他意
    var zyNtAbsentPool = LI_DAXIAO_QUOTES.zhangYang;
    var zyNtAbsentQuote = zyNtAbsentPool[Math.floor(Math.random() * zyNtAbsentPool.length)];
    html += '<div class="sd-nt-zy">' +
      '<div class="sd-nt-zy-context">无国家队入驻——奇迹说：没人跟我抢筹码，正好</div>' +
      '<div class="sd-nt-zy-quote">"' + escHTML(zyNtAbsentQuote.q) + '"</div>' +
      '<div class="sd-nt-zy-sub">' + escHTML(zyNtAbsentQuote.sub || '') + '</div>' +
      '<div class="sd-nt-zy-author">胜天资本 · 奇迹</div>' +
    '</div>';

    html += '</div>';
    html += '</div>';

    var tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    if (addBtn) {
      detailEl.insertBefore(tempDiv.firstChild, addBtn);
    } else {
      detailEl.appendChild(tempDiv.firstChild);
    }
    return;
  }

  var list = ntData.list;
  var reportName = ntData.reportName || '';

  // 汇总统计
  var totalHoldRatio = list.reduce(function(s, d) { return s + d.holdRatio; }, 0);
  var totalMarketCap = list.reduce(function(s, d) { return s + d.marketCap; }, 0);
  var upCount = list.filter(function(d) { return d.changeState.indexOf('加') >= 0 || d.changeState.indexOf('增') >= 0; }).length;
  var downCount = list.filter(function(d) { return d.changeState.indexOf('减') >= 0; }).length;
  var flatCount = list.length - upCount - downCount;

  html += '<div class="sd-section sd-nt-section">' +
    '<div class="sd-section-title">国家队有没有买 <span style="font-size:0.5rem;color:var(--muted);font-weight:400;margin-left:0.3rem">' + escHTML(reportName) + ' · ' + list.length + '家在买</span></div>';

  // 汇总信息条
  html += '<div class="sd-nt-summary">' +
    '<span>一共占了 <b>' + totalHoldRatio.toFixed(2) + '%</b></span>' +
    '<span>持有金额 <b>' + formatBigNumber(totalMarketCap) + '</b></span>' +
    '<span>加仓<b style="color:var(--neon-red)">' + upCount + '</b>家 减仓<b style="color:var(--neon-green)">' + downCount + '</b>家 不变<b style="color:var(--muted)">' + flatCount + '</b>家</span>' +
  '</div>';

  // 国家队机构卡片网格
  html += '<div class="sd-nt-grid">';
  list.forEach(function(d) {
    var changeCls = 'flat';
    var changeText = '不变';
    if (d.changeState.indexOf('加') >= 0 || d.changeState.indexOf('增') >= 0) {
      changeCls = 'up';
      changeText = '加仓';
    } else if (d.changeState.indexOf('减') >= 0) {
      changeCls = 'down';
      changeText = '减仓';
    }

    var changeStr = d.holdChange > 0 ? '+' + formatBigNumber(d.holdChange) : (d.holdChange < 0 ? formatBigNumber(d.holdChange) : '0');

    html += '<div class="sd-nt-card">' +
      '<div class="sd-nt-card-name">' +
        '<span class="sd-nt-card-tag ' + d.tag + '">' + d.tagLabel + '</span>' +
        escHTML(d.name.substring(0, 12)) +
      '</div>' +
      '<div class="sd-nt-card-row"><span>持股数量</span><b>' + formatBigNumber(d.holdNum) + '股</b></div>' +
      '<div class="sd-nt-card-row"><span>持股比例</span><b>' + d.holdRatio.toFixed(2) + '%</b></div>' +
      '<div class="sd-nt-card-row"><span>持有金额</span><b>' + formatBigNumber(d.marketCap) + '</b></div>' +
      '<div class="sd-nt-card-row"><span>操作</span><span class="sd-nt-change ' + changeCls + '">' + changeText + ' ' + changeStr + '</span></div>' +
    '</div>';
  });
  html += '</div>';

  html += '<div class="sd-flow-note">※ 国家队持股数据来自东方财富前十大股东，按最新一期财报显示。国家队包括中央汇金、证金公司、社保基金、国家大基金、外管局投资平台</div>';

  // 李大霄国家队点评语录
  var ntQuote = getNationalTeamQuote(ntData);
  if (ntQuote) {
    html += '<div class="sd-nt-daxiao">' +
      '<div class="sd-nt-daxiao-context">' + escHTML(ntQuote.context || '') + '</div>' +
      '<div class="sd-nt-daxiao-quote">"' + escHTML(ntQuote.q) + '"</div>' +
      '<div class="sd-nt-daxiao-sub">' + escHTML(ntQuote.sub || '') + '</div>' +
      '<div class="sd-nt-daxiao-author">李大霄</div>' +
    '</div>';
  }

  // 奇迹国家队点评——国家队来了？正好帮我抬轿子
  var zyNtPool = upCount > 0 ? LI_DAXIAO_QUOTES.zhangYangStockLow : LI_DAXIAO_QUOTES.zhangYang;
  var zyNtQuote = zyNtPool[Math.floor(Math.random() * zyNtPool.length)];
  var zyNtContext = list.length + '家国家队在买';
  if (upCount > 0) {
    zyNtContext += '，加仓' + upCount + '家——奇迹说：国家队也来帮我抬轿子了';
  } else if (downCount > 0) {
    zyNtContext += '，减仓' + downCount + '家——奇迹说：跑得比我还快，胆子真小';
  } else {
    zyNtContext += '——奇迹说：国家队守着，我放心收割';
  }
  html += '<div class="sd-nt-zy">' +
    '<div class="sd-nt-zy-context">' + escHTML(zyNtContext) + '</div>' +
    '<div class="sd-nt-zy-quote">"' + escHTML(zyNtQuote.q) + '"</div>' +
    '<div class="sd-nt-zy-sub">' + escHTML(zyNtQuote.sub || '') + '</div>' +
    '<div class="sd-nt-zy-author">胜天资本 · 奇迹</div>' +
  '</div>';

  html += '</div></div>';

  var tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  if (addBtn) {
    detailEl.insertBefore(tempDiv.firstChild, addBtn);
  } else {
    detailEl.appendChild(tempDiv.firstChild);
  }
}

/**
 * 加载并显示龙虎榜席位明细
 * @param {string} secCode - 股票代码
 * @param {string} tradeDate - 交易日期
 * @param {HTMLElement} btn - 点击的按钮元素
 */
function loadDragonTigerDetail(secCode, tradeDate, btn) {
  var container = document.getElementById('dtDetailContainer');
  if (!container) return;

  // 如果已显示且内容相同，则切换隐藏
  if (container.style.display !== 'none' && container.getAttribute('data-date') === tradeDate) {
    container.style.display = 'none';
    if (btn) btn.textContent = '席位';
    return;
  }

  container.style.display = 'block';
  container.setAttribute('data-date', tradeDate);
  if (btn) btn.textContent = '收起';
  container.innerHTML = '<div class="sd-loading"><span class="dot-anim">●</span> 正在加载席位明细...</div>';

  fetchDragonTigerDetail(secCode, tradeDate).then(function(detail) {
    var html = '';
    if (detail.buy.length === 0 && detail.sell.length === 0) {
      html = '<div class="sd-dt-detail-empty">暂无席位明细数据</div>';
      container.innerHTML = html;
      return;
    }

    html += '<div class="sd-dt-detail-title">近三月活跃营业部</div>';
    html += '<div class="sd-dt-detail-grid">';

    // 买入席位
    html += '<div class="sd-dt-detail-col sd-dt-detail-buy">' +
      '<div class="sd-dt-detail-col-title" style="color:#00C853">买入前5</div>';
    detail.buy.forEach(function(seat, idx) {
      var isInst = seat.name.indexOf('机构') >= 0;
      var nameDisplay = seat.name.length > 12 ? seat.name.substring(0, 12) + '...' : seat.name;
      var timesStr = seat.buyTimes > 0 ? ' ×' + seat.buyTimes : '';
      html += '<div class="sd-dt-seat' + (isInst ? ' sd-dt-seat-inst' : '') + '">' +
        '<span class="sd-dt-seat-rank">' + (idx + 1) + '</span>' +
        '<span class="sd-dt-seat-name" title="' + (seat.fullName || seat.name) + '">' + nameDisplay + (isInst ? ' ★' : '') + '</span>' +
        '<span class="sd-dt-seat-amt" style="color:#00C853">' + formatBigNumber(seat.buyAmt) + timesStr + '</span>' +
      '</div>';
    });
    html += '</div>';

    // 卖出席位
    html += '<div class="sd-dt-detail-col sd-dt-detail-sell">' +
      '<div class="sd-dt-detail-col-title" style="color:#FF3B30">卖出前5</div>';
    detail.sell.forEach(function(seat, idx) {
      var isInst = seat.name.indexOf('机构') >= 0;
      var nameDisplay = seat.name.length > 12 ? seat.name.substring(0, 12) + '...' : seat.name;
      var timesStr = seat.sellTimes > 0 ? ' ×' + seat.sellTimes : '';
      html += '<div class="sd-dt-seat' + (isInst ? ' sd-dt-seat-inst' : '') + '">' +
        '<span class="sd-dt-seat-rank">' + (idx + 1) + '</span>' +
        '<span class="sd-dt-seat-name" title="' + (seat.fullName || seat.name) + '">' + nameDisplay + (isInst ? ' ★' : '') + '</span>' +
        '<span class="sd-dt-seat-amt" style="color:#FF3B30">' + formatBigNumber(seat.sellAmt) + timesStr + '</span>' +
      '</div>';
    });
    html += '</div>';

    html += '</div>';

    // 机构动向汇总
    var instBuy = detail.buy.filter(function(s) { return s.name.indexOf('机构') >= 0; });
    var instSell = detail.sell.filter(function(s) { return s.name.indexOf('机构') >= 0; });
    if (instBuy.length > 0 || instSell.length > 0) {
      var instBuyTotal = instBuy.reduce(function(s, d) { return s + d.buyAmt; }, 0);
      var instSellTotal = instSell.reduce(function(s, d) { return s + d.sellAmt; }, 0);
      var instNet = instBuyTotal - instSellTotal;
      var instColor = instNet >= 0 ? '#00C853' : '#FF3B30';
      html += '<div class="sd-dt-inst-summary">' +
        '<span class="sd-dt-inst-label">机构动向：</span>' +
        '<span style="color:' + instColor + '">净' + (instNet >= 0 ? '买入' : '卖出') + ' ' + formatBigNumber(Math.abs(instNet)) + '</span>' +
        '<span style="color:#00C853;margin-left:0.3rem">买' + instBuy.length + '席</span>' +
        '<span style="color:#FF3B30;margin-left:0.15rem">卖' + instSell.length + '席</span>' +
      '</div>';
    }

    html += '<div style="font-size:0.46rem;color:var(--muted);opacity:0.7;margin-top:0.3rem">★ 机构专用席位 · ×N 上榜次数 · 数据为近三月聚合统计</div>';
    container.innerHTML = html;
  });
}

/**
 * 将当前查询的个股添加到估值组合
 */
function addCurrentToPortfolio() {
  if (!_currentStockData || !_currentStockData.code) {
    showToast('请先查询个股');
    return;
  }
  // 调用已有的组合添加逻辑
  if (typeof addToPortfolio === 'function') {
    addToPortfolio(_currentStockData.code, _currentStockData.name);
  } else {
    showToast('已记录：' + _currentStockData.name);
  }
}

