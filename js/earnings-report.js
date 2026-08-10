/**
 * ============================================================
 * 个股业绩报告模块
 * 基于A股四大业绩披露窗口期的风险预警与操作建议
 * 数据源：东方财富数据中心（替代Wind/iFinD）
 * ============================================================
 */

// 用户自定义风险阈值（可持久化到localStorage）
var _earningsThresholds = (function() {
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem('earningsThresholds') || '{}'); } catch(e) {}
  return {
    peHighRisk: saved.peHighRisk || 50,          // 高风险PE上限
    peDavisKill: saved.peDavisKill || 80,         // 戴维斯双杀PE上限
    profitDeclineThreshold: saved.profitDeclineThreshold || -30, // 净利润下降阈值(%)
    profitGrowthMin: saved.profitGrowthMin || 10, // 机构出货风险-增速下限(%)
    profitGrowthCore: saved.profitGrowthCore || 30, // 核心持仓池-增速下限(%)
    holdingsDeclineThreshold: saved.holdingsDeclineThreshold || -5, // 持仓下降阈值(%)
    turnoverRateHigh: saved.turnoverRateHigh || 15, // 高换手率阈值(%)
    r007Threshold: saved.r007Threshold || 3.5,    // R007利率阈值(%)
    mainOutflowThreshold: saved.mainOutflowThreshold || 5, // 主力流出阈值(亿)
    achievementRateThreshold: saved.achievementRateThreshold || 90 // 预期达成率阈值(%)
  };
})();

// A股主线行业列表（用于判断"非主线行业"）
var _mainlineIndustries = [
  '半导体', '芯片', '人工智能', 'AI', '新能源', '光伏', '锂电池', '储能',
  '军工', '航空航天', '医药生物', '医疗器械', '创新药', '消费电子',
  '汽车电子', '数据中心', '云计算', '国产软件', '信创', '机器人',
  '电力设备', '风电', '氢能源', '生物制品', '中药', '白酒', '食品饮料'
];

/**
 * 判断行业是否为主线行业
 */
function isMainlineIndustry(industryName) {
  if (!industryName) return false;
  for (var i = 0; i < _mainlineIndustries.length; i++) {
    if (industryName.indexOf(_mainlineIndustries[i]) >= 0) return true;
  }
  return false;
}

/**
 * 判断当前所处业绩披露窗口期
 * 四大窗口：12月中下旬至1月初、4月中下旬、8月下旬、10月底
 */
function getEarningsWindow(date) {
  var m = date.getMonth() + 1;  // 1-12
  var d = date.getDate();
  var y = date.getFullYear();

  // 窗口1：12月15日 ~ 1月10日（年报披露期前）
  if ((m === 12 && d >= 15) || (m === 1 && d <= 10)) {
    return {
      id: 'annual',
      label: '年报披露窗口（12.15-1.10）',
      period: '年报',
      active: true,
      rules: ['highRiskClear']
    };
  }
  // 窗口2：4月10日 ~ 4月30日（一季报+年报强制披露期）
  if (m === 4 && d >= 10) {
    return {
      id: 'q1',
      label: '一季报披露窗口（4.10-4.30）',
      period: '一季报',
      active: true,
      rules: ['davisDoubleKill']
    };
  }
  // 窗口3：8月20日 ~ 8月31日（中报强制披露期）
  if (m === 8 && d >= 20) {
    return {
      id: 'semi',
      label: '中报披露窗口（8.20-8.31）',
      period: '中报',
      active: true,
      rules: ['institutionalSell', 'corePool']
    };
  }
  // 窗口4：10月25日 ~ 10月31日（三季报强制披露期）
  if (m === 10 && d >= 25) {
    return {
      id: 'q3',
      label: '三季报披露窗口（10.25-10.31）',
      period: '三季报',
      active: true,
      rules: ['profitTaking']
    };
  }
  // 非窗口期
  return {
    id: 'offseason',
    label: '非业绩披露窗口期',
    period: '',
    active: false,
    rules: []
  };
}

/**
 * 判断是否为A股主板/创业板/科创板（排除ST/*ST及境外）
 */
function isAShareQualified(stockData) {
  if (!stockData || stockData.isETF) return false;
  var name = stockData.name || '';
  // 排除ST/*ST
  if (/\*?ST/i.test(name) && !/STAR|STR/i.test(name)) return false;
  if (/退/i.test(name)) return false;
  var code = (stockData.code || '').replace(/^(sh|sz|hk)/i, '');
  // 主板：60xxxx(沪), 00xxxx(深)
  // 创业板：30xxxx
  // 科创板：688xxx
  // 北交所：8xxxxx/4xxxxx（暂不纳入）
  if (/^(60|00|30|688)/.test(code)) return true;
  return false;
}

/**
 * 判断最新报告期是否已披露对应窗口的业绩
 * @param {Object} finData - 财务数据
 * @param {string} windowId - 窗口期ID
 * @returns {boolean} true=已披露
 */
function isEarningsDisclosed(finData, windowId) {
  if (!finData || !finData.reportDate) return false;
  var reportDate = finData.reportDate.substring(0, 10);
  var d = new Date(reportDate);
  if (isNaN(d.getTime())) return false;
  var m = d.getMonth() + 1;
  var y = d.getFullYear();
  var now = new Date();

  switch (windowId) {
    case 'annual':
      // 年报：报告期应为去年（12月31日），今年披露
      return (m === 12 && y === now.getFullYear() - 1) ||
             (finData.reportType && finData.reportType.indexOf('年报') >= 0);
    case 'q1':
      // 一季报：报告期应为今年3月31日
      return (m === 3 && y === now.getFullYear()) ||
             (finData.reportType && finData.reportType.indexOf('一季') >= 0);
    case 'semi':
      // 中报：报告期应为今年6月30日
      return (m === 6 && y === now.getFullYear()) ||
             (finData.reportType && finData.reportType.indexOf('中报') >= 0 ||
             finData.reportType && finData.reportType.indexOf('半年') >= 0);
    case 'q3':
      // 三季报：报告期应为今年9月30日
      return (m === 9 && y === now.getFullYear()) ||
             (finData.reportType && finData.reportType.indexOf('三季') >= 0);
    default:
      return false;
  }
}

/**
 * 获取R007银行间质押回购利率（尝试从公开数据源获取）
 * 数据源：中国货币网/东方财富债券数据
 * @returns {Promise<number>} R007利率(%)
 */
function fetchR007Rate() {
  // 东方财富债券回购利率接口
  var url = 'https://datacenter-web.eastmoney.com/api/data/v1/get' +
    '?sortColumns=SOLAR_DATE&sortTypes=-1&pageSize=5&pageNumber=1' +
    '&reportName=RPT_BOND_REPO_RATE&columns=ALL' +
    '&source=WEB&client=WEB' +
    '&filter=(REPO_CODE%3D%22R007%22)';

  return fetchWithTimeout(url, { cache: 'no-store' }, 4000)
    .then(function(res) { return res.ok ? res.json() : null; })
    .catch(function() { return null; })
    .then(function(data) {
      if (data && data.result && data.result.data && data.result.data.length > 0) {
        var rate = parseFloat(data.result.data[0].WEIGHTED_RATE);
        if (!isNaN(rate)) return rate;
      }
      // 无法获取时返回null，表示数据不可用
      return null;
    });
}

/**
 * 缓存的R007数据
 */
var _cachedR007 = { rate: null, fetchTime: 0, consecutiveHigh: 0 };

/**
 * 获取R007利率（带缓存，30分钟有效期）
 */
function getCachedR007() {
  var now = Date.now();
  if (_cachedR007.rate !== null && (now - _cachedR007.fetchTime) < 1800000) {
    return Promise.resolve(_cachedR007.rate);
  }
  return fetchR007Rate().then(function(rate) {
    _cachedR007.rate = rate;
    _cachedR007.fetchTime = now;
    return rate;
  });
}

/**
 * 获取机构持股变动数据
 * 数据源：东方财富F10机构持股
 * @param {string} secCode - 股票代码
 * @returns {Promise<Object>} { northChange: 北向变动%, fundChange: 公募变动% }
 */
function fetchInstitutionalHoldings(secCode) {
  var code = secCode.replace(/^(sh|sz|hk)/i, '');
  // 东方财富机构持股排行接口
  var url = 'https://datacenter-web.eastmoney.com/api/data/v1/get' +
    '?sortColumns=UPDATE_DATE&sortTypes=-1&pageSize=4&pageNumber=1' +
    '&reportName=RPT_F10_MAIN_HOLDPOSITION&columns=ALL' +
    '&source=WEB&client=WEB' +
    '&filter=(SECURITY_CODE%3D%22' + code + '%22)';

  return fetchWithTimeout(url, { cache: 'no-store' }, 5000)
    .then(function(res) { return res.ok ? res.json() : null; })
    .catch(function() { return null; })
    .then(function(data) {
      if (!data || !data.result || !data.result.data || data.result.data.length < 2) {
        return { northChange: 0, fundChange: 0, available: false };
      }
      var latest = data.result.data[0];
      var prev = data.result.data[1];
      // 计算机构持股比例变动
      var latestHold = parseFloat(latest.HOLD_RATIO) || 0;
      var prevHold = parseFloat(prev.HOLD_RATIO) || 0;
      var change = latestHold - prevHold;
      return {
        northChange: change,  // 北向资金持仓变动(百分点)
        fundChange: change,   // 机构持仓变动(百分点)
        available: true
      };
    });
}

/**
 * 计算全年净利润预期达成率
 * 优先用真实对比基准（去年全年利润 / 业绩预告），无基准时按报告期时间进度估算
 * @param {Object} finData - 财务数据
 * @returns {number} 达成率(%)
 */
function calcAnnualAchievementRate(finData) {
  if (!finData || !finData.netProfit || finData.netProfit === 0) return 0;
  // 1. 优先：有去年全年净利润时，用真实同比达成率
  if (finData.lastYearAnnualProfit && finData.lastYearAnnualProfit > 0) {
    return Math.min(100, Math.round((finData.netProfit / finData.lastYearAnnualProfit) * 1000) / 10);
  }
  // 2. 次优：有全年业绩预告时，用当期净利润 / 预告净利润
  if (finData.forecastProfit && finData.forecastProfit > 0) {
    return Math.min(100, Math.round((finData.netProfit / finData.forecastProfit) * 1000) / 10);
  }
  // 3. 兜底：无对比基准，按报告期时间进度估算（表示已完成全年时间的百分比）
  var reportPeriod = finData.reportPeriod || finData.period || '';
  var quarterProgress = 0.25; // 默认按Q1
  if (/中报|半年/.test(reportPeriod) || finData.month === 6) quarterProgress = 0.50;
  else if (/三季|Q3|9月/.test(reportPeriod) || finData.month === 9) quarterProgress = 0.75;
  else if (/年报|年度|12月/.test(reportPeriod) || finData.month === 12) quarterProgress = 1.0;
  else if (/一季|Q1|3月/.test(reportPeriod) || finData.month === 3) quarterProgress = 0.25;
  return Math.round(quarterProgress * 1000) / 10;
}

/**
 * 计算近3年同期历史回撤率
 * 历史最大回撤需要真实历史K线数据，当前无此数据源
 * @param {Object} stockData - 股票数据
 * @param {string} windowId - 窗口期ID
 * @returns {string|null} 回撤率描述，null表示数据不可用
 */
function calcHistoricalDrawdown(stockData, windowId) {
  // 历史最大回撤需要真实历史K线数据，当前无此数据源
  // 返回null表示数据不可用，UI层应显示"数据不足"而非虚假数字
  return null;
}

/**
 * ============================================================
 * 风险识别规则引擎
 * ============================================================
 */

/**
 * 分析个股业绩风险
 * @param {Object} stockData - 股票行情数据
 * @param {Object} finData - 财务数据
 * @param {Object} flowData - 资金流向数据
 * @param {Object} window - 当前业绩窗口期
 * @param {Object} holdingsData - 机构持股数据
 * @param {number|null} r007Rate - R007利率
 * @returns {Array} 风险预警列表
 */
function analyzeEarningsRisks(stockData, finData, flowData, window, holdingsData, r007Rate) {
  var risks = [];
  if (!isAShareQualified(stockData)) return risks;

  var d = stockData;
  var pe = d.pe || 0;
  var turnoverRate = d.turnoverRate || 0;
  var t = _earningsThresholds;
  var disclosed = finData ? isEarningsDisclosed(finData, window.id) : false;
  var industry = (_currentProfileData && _currentProfileData.industry) || '';
  var isMainline = isMainlineIndustry(industry);

  // === 规则1：高风险清仓标的（12.15-1.10窗口） ===
  if (window.rules.indexOf('highRiskClear') >= 0) {
    var conditions = [];
    var triggered = true;

    // 条件：未披露业绩
    if (disclosed) { triggered = false; }
    else conditions.push('未披露年报业绩');

    // 条件：PE > 阈值
    if (pe > 0 && pe > t.peHighRisk) {
      conditions.push('PE=' + pe.toFixed(1) + '>' + t.peHighRisk);
    } else { triggered = false; }

    // 条件：近30日换手率 > 阈值（使用当日换手率作为近似）
    if (turnoverRate > t.turnoverRateHigh) {
      conditions.push('换手率=' + turnoverRate.toFixed(2) + '%>' + t.turnoverRateHigh + '%');
    } else { triggered = false; }

    // 条件：非主线行业
    if (!isMainline) {
      conditions.push('非主线行业(' + (industry || '未分类') + ')');
    } else { triggered = false; }

    // 叠加条件：R007连续3日>3.5%（流动性恶化信号）
    var liquidityWarning = '';
    if (r007Rate !== null && r007Rate > t.r007Threshold) {
      _cachedR007.consecutiveHigh++;
      liquidityWarning = '；叠加R007=' + r007Rate.toFixed(2) + '%>' + t.r007Threshold + '%（流动性恶化）';
    } else {
      _cachedR007.consecutiveHigh = 0;
    }

    if (triggered) {
      risks.push({
        type: 'highRiskClear',
        level: 'high',
        title: '高风险清仓标的',
        icon: '⛔',
        color: 'red',
        conditions: conditions,
        conditionStr: conditions.join('；') + liquidityWarning,
        action: '建议清仓，规避业绩披露不确定性' + (liquidityWarning ? '及流动性风险' : ''),
        drawdown: calcHistoricalDrawdown(d, window.id),
        dataSource: '东方财富财务数据+行情数据',
        calcLogic: '未披露年报 ∧ PE>' + t.peHighRisk + ' ∧ 换手率>' + t.turnoverRateHigh + '% ∧ 非主线行业' + (liquidityWarning ? ' ∧ R007>' + t.r007Threshold + '%' : '')
      });
    }
  }

  // === 规则2：戴维斯双杀预警（4.10-4.30窗口） ===
  if (window.rules.indexOf('davisDoubleKill') >= 0) {
    var davisConditions = [];
    var davisTriggered = true;

    if (disclosed) { davisTriggered = false; }
    else davisConditions.push('未披露一季报');

    if (pe > 0 && pe > t.peDavisKill) {
      davisConditions.push('PE=' + pe.toFixed(1) + '>' + t.peDavisKill);
    } else { davisTriggered = false; }

    // 上一期净利润同比下降>30%
    if (finData && finData.profitYoY < t.profitDeclineThreshold) {
      davisConditions.push('上期净利润同比' + finData.profitYoY.toFixed(1) + '%<' + t.profitDeclineThreshold + '%');
    } else { davisTriggered = false; }

    if (davisTriggered) {
      risks.push({
        type: 'davisDoubleKill',
        level: 'high',
        title: '戴维斯双杀预警',
        icon: '⚠️',
        color: 'red',
        conditions: davisConditions,
        conditionStr: davisConditions.join('；'),
        action: '回避建议：估值与业绩双杀风险极高，建议回避',
        drawdown: calcHistoricalDrawdown(d, window.id),
        dataSource: '东方财富财务数据+行情数据',
        calcLogic: '未披露一季报 ∧ PE>' + t.peDavisKill + ' ∧ 上期净利润同比<' + t.profitDeclineThreshold + '%'
      });
    }
  }

  // === 规则3：机构出货风险股（8.20-8.31窗口） ===
  if (window.rules.indexOf('institutionalSell') >= 0 && finData && disclosed) {
    var sellConditions = [];
    var sellTriggered = true;

    // 净利润同比增长 < 增速下限
    if (finData.profitYoY < t.profitGrowthMin) {
      sellConditions.push('中报净利润同比' + finData.profitYoY.toFixed(1) + '%<' + t.profitGrowthMin + '%');
    } else { sellTriggered = false; }

    // 机构持仓环比下降 > 阈值
    if (holdingsData && holdingsData.available) {
      if (holdingsData.northChange < t.holdingsDeclineThreshold) {
        sellConditions.push('机构持仓环比' + holdingsData.northChange.toFixed(2) + '%<' + t.holdingsDeclineThreshold + '%');
      } else { sellTriggered = false; }
    } else {
      // 无机构持仓数据时，使用资金流向作为替代
      if (flowData) {
        var flowAnalysis = analyzeCapitalFlow(flowData, d);
        if (flowAnalysis && flowAnalysis.totalMain < 0 && flowAnalysis.recent5Main < 0) {
          sellConditions.push('近5日主力净流出' + formatFlowAmount(Math.abs(flowAnalysis.recent5Main)));
        } else { sellTriggered = false; }
      } else { sellTriggered = false; }
    }

    if (sellTriggered) {
      risks.push({
        type: 'institutionalSell',
        level: 'medium',
        title: '机构出货风险股',
        icon: '📉',
        color: 'yellow',
        conditions: sellConditions,
        conditionStr: sellConditions.join('；'),
        action: '减仓建议：机构可能在出货，建议降低仓位',
        drawdown: calcHistoricalDrawdown(d, window.id),
        dataSource: holdingsData && holdingsData.available ? '东方财富机构持股+财务数据' : '东方财富资金流向+财务数据',
        calcLogic: '已披露中报 ∧ 净利润同比<' + t.profitGrowthMin + '% ∧ 机构持仓变动<' + t.holdingsDeclineThreshold + '%'
      });
    }
  }

  // === 规则4：核心持仓池（8.20-8.31窗口，正面信号） ===
  if (window.rules.indexOf('corePool') >= 0 && finData && disclosed) {
    var coreConditions = [];
    var coreTriggered = true;

    if (finData.profitYoY > t.profitGrowthCore) {
      coreConditions.push('中报净利润同比' + finData.profitYoY.toFixed(1) + '%>' + t.profitGrowthCore + '%');
    } else { coreTriggered = false; }

    if (holdingsData && holdingsData.available) {
      if (holdingsData.northChange > 0) {
        coreConditions.push('机构持仓环比+' + holdingsData.northChange.toFixed(2) + '%');
      } else { coreTriggered = false; }
    } else {
      if (flowData) {
        var flowAnalysis2 = analyzeCapitalFlow(flowData, d);
        if (flowAnalysis2 && flowAnalysis2.totalMain > 0) {
          coreConditions.push('主力资金净流入');
        } else { coreTriggered = false; }
      } else { coreTriggered = false; }
    }

    if (coreTriggered) {
      risks.push({
        type: 'corePool',
        level: 'positive',
        title: '核心持仓池',
        icon: '✅',
        color: 'green',
        conditions: coreConditions,
        conditionStr: coreConditions.join('；'),
        action: '持有建议：业绩高增长且机构增持，符合核心持仓标准',
        drawdown: '—（正面信号）',
        dataSource: holdingsData && holdingsData.available ? '东方财富机构持股+财务数据' : '东方财富资金流向+财务数据',
        calcLogic: '已披露中报 ∧ 净利润同比>' + t.profitGrowthCore + '% ∧ 机构持仓上升'
      });
    }
  }

  // === 规则5：获利了结预警（10.25-10.31窗口） ===
  if (window.rules.indexOf('profitTaking') >= 0 && finData && disclosed) {
    var ptConditions = [];
    var ptTriggered = true;

    // 全年净利润预期达成率 > 90%
    var achievementRate = calcAnnualAchievementRate(finData);
    if (achievementRate > t.achievementRateThreshold) {
      ptConditions.push('全年净利润预期达成率' + achievementRate.toFixed(1) + '%>' + t.achievementRateThreshold + '%');
    } else { ptTriggered = false; }

    // 主力资金净流出连续5日超阈值
    if (flowData) {
      var flowAnalysis3 = analyzeCapitalFlow(flowData, d);
      if (flowAnalysis3) {
        var recent5 = flowAnalysis3.days.slice(-5);
        var consecutiveOutflow = true;
        var totalOutflow = 0;
        for (var i = 0; i < recent5.length; i++) {
          if (recent5[i].main >= 0) { consecutiveOutflow = false; break; }
          totalOutflow += Math.abs(recent5[i].main);
        }
        var totalOutflowYi = totalOutflow / 1e8; // 转为亿
        if (consecutiveOutflow && totalOutflowYi > t.mainOutflowThreshold) {
          ptConditions.push('主力连续5日净流出' + totalOutflowYi.toFixed(1) + '亿>' + t.mainOutflowThreshold + '亿');
        } else { ptTriggered = false; }
      } else { ptTriggered = false; }
    } else { ptTriggered = false; }

    if (ptTriggered) {
      risks.push({
        type: 'profitTaking',
        level: 'high',
        title: '获利了结预警',
        icon: '🚫',
        color: 'red',
        conditions: ptConditions,
        conditionStr: ptConditions.join('；'),
        action: '禁止抄底，保持空仓至指数企稳',
        drawdown: calcHistoricalDrawdown(d, window.id),
        dataSource: '东方财富财务数据+资金流向',
        calcLogic: '已披露三季报 ∧ 预期达成率>' + t.achievementRateThreshold + '% ∧ 主力连续5日净流出>' + t.mainOutflowThreshold + '亿'
      });
    }
  }

  return risks;
}

/**
 * ============================================================
 * 渲染函数
 * ============================================================
 */

/**
 * 渲染业绩报告区块
 * @param {Object} stockData - 股票行情数据
 * @param {Object} finData - 财务数据
 * @param {Object} flowData - 资金流向数据
 * @param {Object} extraData - 额外数据 { holdings, r007 }
 * @returns {string} HTML字符串
 */
function renderEarningsReport(stockData, finData, flowData, extraData) {
  if (!isAShareQualified(stockData)) return '';

  var window_ = getEarningsWindow(new Date());
  var holdings = extraData ? extraData.holdings : null;
  var r007 = extraData ? extraData.r007 : null;

  var risks = analyzeEarningsRisks(stockData, finData, flowData, window_, holdings, r007);
  var d = stockData;
  var t = _earningsThresholds;

  var html = '<div class="earnings-report" id="earningsReportSection">';

  // ====== 顶部标题栏 ======
  html += '<div class="er-header">';
  html += '<div class="er-header-left">';
  html += '<span class="er-header-icon">📊</span>';
  html += '<span class="er-title">业绩报告分析</span>';
  html += '</div>';
  html += '<div class="er-header-right">';
  html += '<span class="er-window' + (window_.active ? ' active' : '') + '">' + window_.label + '</span>';
  html += '<button class="er-settings-btn" onclick="toggleEarningsSettings()" title="自定义风险阈值">⚙</button>';
  html += '</div>';
  html += '</div>';

  // ====== 风险信号总览条 ======
  var riskCount = risks.length;
  var highCount = risks.filter(function(r) { return r.level === 'high'; }).length;
  var mediumCount = risks.filter(function(r) { return r.level === 'medium'; }).length;
  var positiveCount = risks.filter(function(r) { return r.level === 'positive'; }).length;

  html += '<div class="er-signal-bar">';
  html += '<div class="er-signal-item' + (highCount > 0 ? ' on' : '') + '">';
  html += '<span class="er-signal-dot high"></span>';
  html += '<span class="er-signal-num">' + highCount + '</span>';
  html += '<span class="er-signal-lbl">高风险</span>';
  html += '</div>';
  html += '<div class="er-signal-item' + (mediumCount > 0 ? ' on' : '') + '">';
  html += '<span class="er-signal-dot medium"></span>';
  html += '<span class="er-signal-num">' + mediumCount + '</span>';
  html += '<span class="er-signal-lbl">中风险</span>';
  html += '</div>';
  html += '<div class="er-signal-item' + (positiveCount > 0 ? ' on' : '') + '">';
  html += '<span class="er-signal-dot positive"></span>';
  html += '<span class="er-signal-num">' + positiveCount + '</span>';
  html += '<span class="er-signal-lbl">正面信号</span>';
  html += '</div>';
  if (riskCount === 0) {
    html += '<div class="er-signal-safe">';
    html += '<span class="er-safe-icon">✓</span>';
    html += '<span>暂无风险触发</span>';
    html += '</div>';
  }
  html += '</div>';

  // ====== 风险预警卡片 ======
  if (risks.length > 0) {
    html += '<div class="er-risk-list">';
    risks.forEach(function(risk, idx) {
      var colorClass = risk.color === 'red' ? 'red' :
                       risk.color === 'yellow' ? 'yellow' :
                       risk.color === 'green' ? 'green' : 'cyan';
      var severityPct = risk.level === 'high' ? 90 : risk.level === 'medium' ? 60 : 25;
      var drawdownPct = 0;
      var drawdownDisplay;
      if (risk.drawdown == null) {
        drawdownDisplay = '暂无数据';
      } else {
        drawdownDisplay = risk.drawdown;
        var drawdownMatch = String(risk.drawdown).match(/([\d.]+)/);
        if (drawdownMatch) drawdownPct = Math.min(100, parseFloat(drawdownMatch[1]));
      }

      html += '<div class="er-risk-card ' + colorClass + '">';
      // 卡片头部
      html += '<div class="er-risk-top">';
      html += '<div class="er-risk-icon-wrap ' + colorClass + '"><span>' + risk.icon + '</span></div>';
      html += '<div class="er-risk-info">';
      html += '<div class="er-risk-title">' + risk.title + '</div>';
      html += '<div class="er-risk-severity">';
      if (risk.level === 'high') html += '<span class="er-sev-badge high">高风险</span>';
      else if (risk.level === 'medium') html += '<span class="er-sev-badge medium">中风险</span>';
      else if (risk.level === 'positive') html += '<span class="er-sev-badge positive">正面</span>';
      html += '<div class="er-sev-track"><div class="er-sev-fill ' + colorClass + '" style="width:' + severityPct + '%"></div></div>';
      html += '</div>'; // .er-risk-severity
      html += '</div>'; // .er-risk-info
      html += '</div>'; // .er-risk-top

      // 触发条件（标签形式）
      if (risk.conditions && risk.conditions.length > 0) {
        html += '<div class="er-cond-chips">';
        risk.conditions.forEach(function(cond) {
          html += '<span class="er-cond-chip ' + colorClass + '">' + cond + '</span>';
        });
        html += '</div>';
      }

      // 操作建议
      html += '<div class="er-action-box ' + colorClass + '">';
      html += '<span class="er-action-arrow">▶</span>';
      html += '<span class="er-action-text">' + risk.action + '</span>';
      html += '</div>';

      // 底部：回撤仪表 + 数据来源
      html += '<div class="er-risk-footer">';
      html += '<div class="er-drawdown-wrap">';
      html += '<span class="er-dd-label">历史回撤</span>';
      html += '<div class="er-dd-bar">';
      html += '<div class="er-dd-fill ' + (drawdownPct > 25 ? 'red' : 'yellow') + '" style="width:' + drawdownPct + '%"></div>';
      html += '</div>';
      html += '<span class="er-dd-val">' + drawdownDisplay + '</span>';
      html += '</div>';
      html += '<span class="er-source-tag" title="' + risk.dataSource + '">📊 ' + (risk.dataSource || '').replace(/东方财富/g, '东财').substring(0, 12) + '</span>';
      html += '</div>';
      html += '</div>'; // .er-risk-card
    });
    html += '</div>'; // .er-risk-list
  } else {
    // 无风险状态卡片
    html += '<div class="er-safe-card">';
    if (window_.active) {
      html += '<div class="er-safe-icon-big">✅</div>';
      html += '<div class="er-safe-title">当前窗口未触发风险</div>';
      html += '<div class="er-safe-desc">' + window_.label + '内，该股票未触发任何风险预警条件</div>';
    } else {
      html += '<div class="er-safe-icon-big">📅</div>';
      html += '<div class="er-safe-title">非业绩披露窗口期</div>';
      html += '<div class="er-safe-desc">风险预警规则未激活，下一窗口：' + getNextWindowInfo(new Date()) + '</div>';
    }
    html += '</div>';
  }

  // ====== 财务数据仪表盘 ======
  if (finData) {
    var profitYoY = finData.profitYoY || 0;
    var revenueYoY = finData.revenueYoY || 0;
    var reportDateStr = finData.reportDate ? finData.reportDate.substring(0, 10) : '—';
    var reportTypeStr = finData.reportType || '—';
    var peStr = d.pe > 0 ? d.pe.toFixed(1) : '—';
    var achievementRate = calcAnnualAchievementRate(finData);
    var peLevel = d.pe > 0 ? (d.pe > 80 ? 'danger' : d.pe > 50 ? 'warn' : d.pe > 20 ? 'normal' : 'safe') : 'unknown';

    html += '<div class="er-fin-dash">';
    html += '<div class="er-fin-dash-title">关键财务指标</div>';
    html += '<div class="er-fin-grid">';

    // 报告期卡片
    html += '<div class="er-fin-card">';
    html += '<div class="er-fin-card-icon">📅</div>';
    html += '<div class="er-fin-card-body">';
    html += '<div class="er-fin-card-lbl">报告期</div>';
    html += '<div class="er-fin-card-val">' + reportDateStr + '</div>';
    html += '<div class="er-fin-card-sub">' + reportTypeStr + '</div>';
    html += '</div>';
    html += '</div>';

    // 净利润同比卡片
    var profitTrend = profitYoY >= 0 ? 'up' : 'down';
    var profitCls = profitYoY >= 0 ? 'green' : 'red';
    html += '<div class="er-fin-card ' + profitCls + '">';
    html += '<div class="er-fin-card-icon">' + (profitYoY >= 0 ? '📈' : '📉') + '</div>';
    html += '<div class="er-fin-card-body">';
    html += '<div class="er-fin-card-lbl">净利润同比</div>';
    html += '<div class="er-fin-card-val">' + (profitYoY >= 0 ? '+' : '') + profitYoY.toFixed(1) + '%</div>';
    html += '<div class="er-fin-card-sub">' + (profitYoY >= 0 ? '↑ 增长' : '↓ 下降') + '</div>';
    html += '</div>';
    html += '</div>';

    // 营收同比卡片
    var revenueTrend = revenueYoY >= 0 ? 'up' : 'down';
    var revenueCls = revenueYoY >= 0 ? 'green' : 'red';
    html += '<div class="er-fin-card ' + revenueCls + '">';
    html += '<div class="er-fin-card-icon">' + (revenueYoY >= 0 ? '📈' : '📉') + '</div>';
    html += '<div class="er-fin-card-body">';
    html += '<div class="er-fin-card-lbl">营收同比</div>';
    html += '<div class="er-fin-card-val">' + (revenueYoY >= 0 ? '+' : '') + revenueYoY.toFixed(1) + '%</div>';
    html += '<div class="er-fin-card-sub">' + (revenueYoY >= 0 ? '↑ 增长' : '↓ 下降') + '</div>';
    html += '</div>';
    html += '</div>';

    // PE卡片
    html += '<div class="er-fin-card ' + peLevel + '">';
    html += '<div class="er-fin-card-icon">🔍</div>';
    html += '<div class="er-fin-card-body">';
    html += '<div class="er-fin-card-lbl">PE(TTM)</div>';
    html += '<div class="er-fin-card-val">' + peStr + '</div>';
    html += '<div class="er-fin-card-sub">';
    if (peLevel === 'danger') html += '⚠ 估值偏高';
    else if (peLevel === 'warn') html += '⚠ 关注估值';
    else if (peLevel === 'normal') html += '○ 估值合理';
    else if (peLevel === 'safe') html += '✓ 估值偏低';
    else html += '— 无数据';
    html += '</div>';
    html += '</div>';
    html += '</div>';

    // 全年达成率卡片（带进度条）
    var achColor = achievementRate >= 90 ? 'red' : achievementRate >= 70 ? 'yellow' : 'green';
    html += '<div class="er-fin-card ' + achColor + '">';
    html += '<div class="er-fin-card-icon">🎯</div>';
    html += '<div class="er-fin-card-body">';
    html += '<div class="er-fin-card-lbl">全年达成率</div>';
    html += '<div class="er-fin-card-val">' + achievementRate.toFixed(1) + '%</div>';
    html += '<div class="er-fin-card-progress">';
    html += '<div class="er-fin-card-bar ' + achColor + '" style="width:' + Math.min(100, achievementRate) + '%"></div>';
    html += '</div>';
    html += '</div>';
    html += '</div>';

    html += '</div>'; // .er-fin-grid
    html += '</div>'; // .er-fin-dash
  }

  // ====== 机构持仓 & R007 可视化 ======
  if ((holdings && holdings.available) || r007 !== null) {
    html += '<div class="er-extra-row">';
    var hasHoldings = holdings && holdings.available;
    var hasR007 = r007 !== null;
    var cardFlex = hasHoldings && hasR007 ? '1' : '1';

    // 机构持仓卡片
    if (hasHoldings) {
      var holdPct = holdings.northChange;
      var holdCls = holdPct >= 0 ? 'green' : 'red';
      var holdBarWidth = Math.min(100, Math.abs(holdPct) * 10);
      html += '<div class="er-extra-card ' + holdCls + '" style="flex:' + cardFlex + '">';
      html += '<div class="er-extra-top">';
      html += '<span class="er-extra-icon">🏦</span>';
      html += '<span class="er-extra-lbl">机构持仓变动</span>';
      html += '</div>';
      html += '<div class="er-extra-val ' + holdCls + '">' + (holdPct >= 0 ? '+' : '') + holdPct.toFixed(2) + '%</div>';
      html += '<div class="er-extra-bar">';
      html += '<div class="er-extra-fill ' + holdCls + '" style="width:' + holdBarWidth + '%"></div>';
      html += '</div>';
      html += '<div class="er-extra-sub">' + (holdPct >= 0 ? '机构增持' : '机构减持') + '</div>';
      html += '</div>';
    }

    // R007卡片
    if (hasR007) {
      var r007Cls = r007 > t.r007Threshold ? 'red' : 'green';
      var r007BarWidth = Math.min(100, (r007 / 5) * 100);
      var r007ThresholdPos = Math.min(100, (t.r007Threshold / 5) * 100);
      html += '<div class="er-extra-card ' + r007Cls + '" style="flex:' + cardFlex + '">';
      html += '<div class="er-extra-top">';
      html += '<span class="er-extra-icon">💰</span>';
      html += '<span class="er-extra-lbl">R007利率</span>';
      if (r007 > t.r007Threshold) {
        html += '<span class="er-extra-warn">⚠ 恶化</span>';
      }
      html += '</div>';
      html += '<div class="er-extra-val ' + r007Cls + '">' + r007.toFixed(2) + '%</div>';
      html += '<div class="er-extra-bar er-r007-bar">';
      html += '<div class="er-extra-fill ' + r007Cls + '" style="width:' + r007BarWidth + '%"></div>';
      html += '<div class="er-r007-threshold" style="left:' + r007ThresholdPos + '%" title="阈值' + t.r007Threshold + '%"></div>';
      html += '</div>';
      html += '<div class="er-extra-sub">阈值' + t.r007Threshold + '% · ' + (r007 > t.r007Threshold ? '流动性偏紧' : '流动性宽松') + '</div>';
      html += '</div>';
    }
    html += '</div>'; // .er-extra-row
  }

  // ====== 数据来源声明 ======
  html += '<div class="er-disclaimer">※ 数据来源：东方财富数据中心（替代Wind/iFinD），更新延迟≤24小时 · 规则引擎计算，非主观判断</div>';

  html += '</div>'; // .earnings-report

  return html;
}

/**
 * 获取下一个业绩披露窗口信息
 */
function getNextWindowInfo(date) {
  var m = date.getMonth() + 1;
  var d = date.getDate();
  var info = '';

  if (m < 4 || (m === 4 && d < 10)) {
    info = '4月10日（一季报披露窗口）';
  } else if (m < 8 || (m === 8 && d < 20)) {
    info = '8月20日（中报披露窗口）';
  } else if (m < 10 || (m === 10 && d < 25)) {
    info = '10月25日（三季报披露窗口）';
  } else if (m < 12 || (m === 12 && d < 15)) {
    info = '12月15日（年报披露窗口）';
  } else {
    info = '次年1月10日后（一季报窗口）';
  }
  return info;
}

/**
 * ============================================================
 * 用户自定义风险阈值
 * ============================================================
 */

function toggleEarningsSettings() {
  var panel = document.getElementById('earningsSettingsPanel');
  if (panel) {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    return;
  }
  // 动态创建设置面板
  renderEarningsSettingsPanel();
}

function renderEarningsSettingsPanel() {
  var existing = document.getElementById('earningsSettingsPanel');
  if (existing) existing.remove();

  var t = _earningsThresholds;
  var panel = document.createElement('div');
  panel.id = 'earningsSettingsPanel';
  panel.className = 'er-settings-panel';
  panel.innerHTML =
    '<div class="er-settings-overlay" onclick="toggleEarningsSettings()"></div>' +
    '<div class="er-settings-content">' +
    '<div class="er-settings-header">' +
    '<span>自定义风险阈值</span>' +
    '<button class="er-settings-close" onclick="toggleEarningsSettings()">×</button>' +
    '</div>' +
    '<div class="er-settings-body">' +
    '<div class="er-setting-row">' +
    '<label>高风险清仓PE上限</label>' +
    '<input type="number" id="set_peHighRisk" value="' + t.peHighRisk + '" step="5">' +
    '</div>' +
    '<div class="er-setting-row">' +
    '<label>戴维斯双杀PE上限</label>' +
    '<input type="number" id="set_peDavisKill" value="' + t.peDavisKill + '" step="5">' +
    '</div>' +
    '<div class="er-setting-row">' +
    '<label>净利润下降阈值(%)</label>' +
    '<input type="number" id="set_profitDeclineThreshold" value="' + t.profitDeclineThreshold + '" step="5">' +
    '</div>' +
    '<div class="er-setting-row">' +
    '<label>机构出货增速下限(%)</label>' +
    '<input type="number" id="set_profitGrowthMin" value="' + t.profitGrowthMin + '" step="5">' +
    '</div>' +
    '<div class="er-setting-row">' +
    '<label>核心持仓增速下限(%)</label>' +
    '<input type="number" id="set_profitGrowthCore" value="' + t.profitGrowthCore + '" step="5">' +
    '</div>' +
    '<div class="er-setting-row">' +
    '<label>持仓下降阈值(%)</label>' +
    '<input type="number" id="set_holdingsDeclineThreshold" value="' + t.holdingsDeclineThreshold + '" step="1">' +
    '</div>' +
    '<div class="er-setting-row">' +
    '<label>高换手率阈值(%)</label>' +
    '<input type="number" id="set_turnoverRateHigh" value="' + t.turnoverRateHigh + '" step="1">' +
    '</div>' +
    '<div class="er-setting-row">' +
    '<label>R007利率阈值(%)</label>' +
    '<input type="number" id="set_r007Threshold" value="' + t.r007Threshold + '" step="0.1">' +
    '</div>' +
    '<div class="er-setting-row">' +
    '<label>主力流出阈值(亿)</label>' +
    '<input type="number" id="set_mainOutflowThreshold" value="' + t.mainOutflowThreshold + '" step="1">' +
    '</div>' +
    '<div class="er-setting-row">' +
    '<label>预期达成率阈值(%)</label>' +
    '<input type="number" id="set_achievementRateThreshold" value="' + t.achievementRateThreshold + '" step="5">' +
    '</div>' +
    '</div>' +
    '<div class="er-settings-footer">' +
    '<button class="er-settings-reset" onclick="resetEarningsThresholds()">恢复默认</button>' +
    '<button class="er-settings-save" onclick="saveEarningsThresholds()">保存并应用</button>' +
    '</div>' +
    '</div>';

  document.body.appendChild(panel);
  panel.style.display = 'block';
}

function saveEarningsThresholds() {
  var fields = ['peHighRisk', 'peDavisKill', 'profitDeclineThreshold', 'profitGrowthMin',
    'profitGrowthCore', 'holdingsDeclineThreshold', 'turnoverRateHigh',
    'r007Threshold', 'mainOutflowThreshold', 'achievementRateThreshold'];

  fields.forEach(function(f) {
    var el = document.getElementById('set_' + f);
    if (el) {
      var val = parseFloat(el.value);
      if (!isNaN(val)) _earningsThresholds[f] = val;
    }
  });

  try {
    localStorage.setItem('earningsThresholds', JSON.stringify(_earningsThresholds));
  } catch(e) {}

  toggleEarningsSettings();

  // 重新渲染业绩报告
  if (_currentStockData) {
    refreshEarningsReport();
  }
}

function resetEarningsThresholds() {
  _earningsThresholds = {
    peHighRisk: 50, peDavisKill: 80, profitDeclineThreshold: -30,
    profitGrowthMin: 10, profitGrowthCore: 30, holdingsDeclineThreshold: -5,
    turnoverRateHigh: 15, r007Threshold: 3.5, mainOutflowThreshold: 5,
    achievementRateThreshold: 90
  };
  try { localStorage.removeItem('earningsThresholds'); } catch(e) {}
  toggleEarningsSettings();
  if (_currentStockData) refreshEarningsReport();
}

/**
 * 刷新业绩报告区块
 */
function refreshEarningsReport() {
  if (!_currentStockData) { showToast('请先搜索股票'); return; }

  var secCode = _currentStockData.code;
  var promises = [];

  // 异步获取机构持股数据
  promises.push(fetchInstitutionalHoldings(secCode).catch(function() { return null; }));
  // 异步获取R007
  promises.push(getCachedR007().catch(function() { return null; }));

  Promise.all(promises).then(function(results) {
    var holdings = results[0];
    var r007 = results[1];

    var extraData = { holdings: holdings, r007: r007 };
    var html = renderEarningsReport(_currentStockData, _currentFinData, _currentFlowData, extraData);

    var existing = document.getElementById('earningsReportSection');
    if (existing) {
      existing.outerHTML = html;
    } else {
      // 如果不存在，插入到stock detail区域末尾
      var area = document.getElementById('stockResultArea');
      if (area) {
        var insertDiv = document.createElement('div');
        insertDiv.innerHTML = html;
        area.appendChild(insertDiv.firstChild);
      }
    }
  }).catch(function(err) {
    console.warn('财报数据加载失败:', err.message);
  });
}

/**
 * ============================================================
 * 异步数据获取入口（在个股详情加载完成后调用）
 * ============================================================ */

/**
 * 异步加载业绩报告附加数据（机构持股+R007）
 * 在renderStockResult完成后调用
 */
function loadEarningsReportExtras(stockData, finData, flowData) {
  if (!isAShareQualified(stockData)) return;

  var secCode = stockData.code;
  var promises = [];

  promises.push(fetchInstitutionalHoldings(secCode).catch(function() { return null; }));
  promises.push(getCachedR007().catch(function() { return null; }));

  Promise.all(promises).then(function(results) {
    var holdings = results[0];
    var r007 = results[1];

    var extraData = { holdings: holdings, r007: r007 };
    var html = renderEarningsReport(stockData, finData, flowData, extraData);

    // 替换或插入业绩报告区块
    var existing = document.getElementById('earningsReportSection');
    if (existing) {
      existing.outerHTML = html;
    } else {
      var area = document.getElementById('stockResultArea');
      if (area) {
        var wrapper = document.createElement('div');
        wrapper.innerHTML = html;
        var reportEl = wrapper.firstChild;
        area.appendChild(reportEl);
      }
    }
  });
}
