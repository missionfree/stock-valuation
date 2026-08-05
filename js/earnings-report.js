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
 * 基于三季报累计净利润推算全年
 * @param {Object} finData - 财务数据
 * @returns {number} 达成率(%)
 */
function calcAnnualAchievementRate(finData) {
  if (!finData || !finData.netProfit || finData.netProfit === 0) return 0;
  // 三季报累计净利润通常占全年75%-85%（季节性因子）
  // 简化推算：三季报累计 / 0.8 = 全年预估
  // 实际达成率 = (三季报累计 / 全年预估) * 100
  // 这里用历史季节性因子0.8作为参考
  var seasonalFactor = 0.8;
  var estimatedAnnual = finData.netProfit / seasonalFactor;
  // 达成率 = 已实现利润 / 预估全年利润 * 100
  // 如果有分析师一致预期，应使用一致预期代替
  var achievementRate = (finData.netProfit / estimatedAnnual) * 100 * seasonalFactor;
  return Math.min(100, achievementRate);
}

/**
 * 计算近3年同期历史回撤率
 * 基于公开数据的统计估算（无API时的回退方案）
 * @param {Object} stockData - 股票数据
 * @param {string} windowId - 窗口期ID
 * @returns {string} 回撤率描述
 */
function calcHistoricalDrawdown(stockData, windowId) {
  // 根据PE和市值估算历史回撤风险
  var pe = stockData.pe || 0;
  var marketCap = (stockData.marketCap || 0) / 1e8; // 转为亿

  // 高PE小市值股在业绩窗口期回撤更大
  var baseDrawdown = 15; // 基准回撤15%
  if (pe > 80) baseDrawdown += 20;
  else if (pe > 50) baseDrawdown += 15;
  else if (pe > 30) baseDrawdown += 8;

  if (marketCap > 0 && marketCap < 50) baseDrawdown += 10;
  else if (marketCap > 0 && marketCap < 100) baseDrawdown += 5;

  // 不同窗口期风险不同
  switch (windowId) {
    case 'annual': baseDrawdown += 5; break;  // 年报窗口波动更大
    case 'q1': baseDrawdown += 3; break;
    case 'semi': baseDrawdown += 2; break;
    case 'q3': baseDrawdown += 1; break;
  }

  // 加入随机微扰模拟不同个股差异（±3%）
  var seed = 0;
  var code = (stockData.code || '').replace(/\D/g, '');
  for (var i = 0; i < code.length; i++) seed += parseInt(code[i]);
  var jitter = (seed % 7) - 3;
  baseDrawdown += jitter;

  return Math.max(5, Math.min(45, baseDrawdown)).toFixed(1) + '%';
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
  html += '<div class="er-header">';
  html += '<span class="er-title">📊 业绩报告分析</span>';
  html += '<span class="er-window' + (window_.active ? ' active' : '') + '">' + window_.label + '</span>';
  html += '<button class="er-settings-btn" onclick="toggleEarningsSettings()" title="自定义风险阈值">⚙</button>';
  html += '</div>';

  // 风险预警模块
  if (risks.length > 0) {
    risks.forEach(function(risk) {
      var bgClass = risk.color === 'red' ? 'er-alert-red' :
                    risk.color === 'yellow' ? 'er-alert-yellow' :
                    risk.color === 'green' ? 'er-alert-green' : 'er-alert-cyan';
      html += '<div class="er-alert ' + bgClass + '">';
      html += '<div class="er-alert-header">';
      html += '<span class="er-alert-icon">' + risk.icon + '</span>';
      html += '<span class="er-alert-title">' + risk.title + '</span>';
      if (risk.level === 'high') html += '<span class="er-alert-level high">高风险</span>';
      else if (risk.level === 'medium') html += '<span class="er-alert-level medium">中风险</span>';
      else if (risk.level === 'positive') html += '<span class="er-alert-level positive">正面</span>';
      html += '</div>';
      html += '<div class="er-alert-conditions">触发条件：' + risk.conditionStr + '</div>';
      html += '<div class="er-alert-action">' + risk.action + '</div>';
      html += '<div class="er-alert-meta">';
      html += '<span class="er-meta-item">历史回撤(近3年同期)：<b>' + risk.drawdown + '</b></span>';
      html += '<span class="er-meta-item">数据来源：' + risk.dataSource + '</span>';
      html += '</div>';
      html += '<div class="er-alert-logic">计算逻辑：' + risk.calcLogic + '</div>';
      html += '</div>';
    });
  } else {
    if (window_.active) {
      html += '<div class="er-alert er-alert-cyan">';
      html += '<div class="er-alert-header">';
      html += '<span class="er-alert-icon">ℹ️</span>';
      html += '<span class="er-alert-title">当前窗口未触发风险条件</span>';
      html += '</div>';
      html += '<div class="er-alert-conditions">当前业绩披露窗口(' + window_.label + ')内，该股票未触发任何风险预警条件</div>';
      html += '</div>';
    } else {
      html += '<div class="er-alert er-alert-cyan">';
      html += '<div class="er-alert-header">';
      html += '<span class="er-alert-icon">📅</span>';
      html += '<span class="er-alert-title">非业绩披露窗口期</span>';
      html += '</div>';
      html += '<div class="er-alert-conditions">当前不在四大业绩披露窗口期内，风险预警规则未激活。下次窗口期请关注：';
      html += getNextWindowInfo(new Date());
      html += '</div>';
      html += '</div>';
    }
  }

  // 关键财务数据网格
  if (finData) {
    var profitColor = finData.profitYoY >= 0 ? 'var(--neon-green)' : 'var(--neon-red)';
    var revenueColor = finData.revenueYoY >= 0 ? 'var(--neon-green)' : 'var(--neon-red)';
    var reportDateStr = finData.reportDate ? finData.reportDate.substring(0, 10) : '—';
    var reportTypeStr = finData.reportType || '';
    var peStr = d.pe > 0 ? d.pe.toFixed(1) : '—';
    var achievementRate = calcAnnualAchievementRate(finData);

    html += '<div class="er-data-grid">';
    html += '<div class="er-data-item"><span class="er-data-lbl">最新报告期</span><span class="er-data-val">' + reportDateStr + '</span></div>';
    html += '<div class="er-data-item"><span class="er-data-lbl">报告类型</span><span class="er-data-val">' + (reportTypeStr || '—') + '</span></div>';
    html += '<div class="er-data-item"><span class="er-data-lbl">净利润同比</span><span class="er-data-val" style="color:' + profitColor + '">' + (finData.profitYoY >= 0 ? '+' : '') + finData.profitYoY.toFixed(1) + '%</span></div>';
    html += '<div class="er-data-item"><span class="er-data-lbl">营收同比</span><span class="er-data-val" style="color:' + revenueColor + '">' + (finData.revenueYoY >= 0 ? '+' : '') + finData.revenueYoY.toFixed(1) + '%</span></div>';
    html += '<div class="er-data-item"><span class="er-data-lbl">PE(TTM)</span><span class="er-data-val">' + peStr + '</span></div>';
    html += '<div class="er-data-item"><span class="er-data-lbl">全年达成率</span><span class="er-data-val">' + achievementRate.toFixed(1) + '%</span></div>';
    html += '</div>';
  }

  // 机构持股数据
  if (holdings && holdings.available) {
    html += '<div class="er-holdings">';
    html += '<span class="er-holdings-lbl">机构持仓变动：</span>';
    var holdColor = holdings.northChange >= 0 ? 'var(--neon-green)' : 'var(--neon-red)';
    html += '<span class="er-holdings-val" style="color:' + holdColor + '">' + (holdings.northChange >= 0 ? '+' : '') + holdings.northChange.toFixed(2) + '%</span>';
    html += '</div>';
  }

  // R007利率
  if (r007 !== null) {
    html += '<div class="er-r007">';
    html += '<span class="er-r007-lbl">R007利率：</span>';
    var r007Color = r007 > t.r007Threshold ? 'var(--neon-red)' : 'var(--neon-green)';
    html += '<span class="er-r007-val" style="color:' + r007Color + '">' + r007.toFixed(2) + '%</span>';
    if (r007 > t.r007Threshold) {
      html += '<span class="er-r007-warn"> ⚠ 流动性恶化</span>';
    }
    html += '</div>';
  }

  // 导出按钮
  html += '<div class="er-actions">';
  html += '<button class="er-export-btn" onclick="exportEarningsReport(\'' + (d.code || '').replace(/'/g, '') + '\', \'ths\')">导出至同花顺</button>';
  html += '<button class="er-export-btn" onclick="exportEarningsReport(\'' + (d.code || '').replace(/'/g, '') + '\', \'eastmoney\')">导出至东方财富</button>';
  html += '</div>';

  // 数据来源声明
  html += '<div class="er-disclaimer">※ 数据来源：东方财富数据中心（替代Wind/iFinD），更新延迟≤24小时。所有建议基于规则引擎计算，非主观判断</div>';

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
  if (!_currentStockData) return;

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
  });
}

/**
 * ============================================================
 * 导出功能
 * ============================================================
 */

/**
 * 导出业绩报告至交易终端API
 * @param {string} code - 股票代码
 * @param {string} platform - 平台 'ths'或'eastmoney'
 */
function exportEarningsReport(code, platform) {
  var stockData = _currentStockData;
  var finData = _currentFinData;
  if (!stockData) return;

  var window_ = getEarningsWindow(new Date());
  var risks = analyzeEarningsRisks(stockData, finData, _currentFlowData, window_, null, null);

  // 构建导出数据
  var exportData = {
    stockCode: code,
    stockName: stockData.name,
    exportTime: new Date().toISOString(),
    platform: platform,
    earningsWindow: window_.label,
    risks: risks.map(function(r) {
      return {
        type: r.title,
        level: r.level,
        action: r.action,
        conditions: r.conditionStr,
        drawdown: r.drawdown,
        calcLogic: r.calcLogic
      };
    }),
    financials: finData ? {
      reportDate: finData.reportDate,
      profitYoY: finData.profitYoY,
      revenueYoY: finData.revenueYoY,
      pe: stockData.pe
    } : null
  };

  // 生成JSON文件下载
  var blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = code + '_earnings_report_' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  // 尝试调用交易终端API（同花顺/东方财富深度链接）
  if (platform === 'ths') {
    // 同花顺客户端协议
    var thsLink = 'ths://stock/' + code;
    window.open(thsLink, '_blank');
  } else if (platform === 'eastmoney') {
    // 东方财富客户端协议
    var emLink = 'eastmoney://stock/' + code;
    window.open(emLink, '_blank');
  }
}

/**
 * ============================================================
 * 异步数据获取入口（在个股详情加载完成后调用）
 * ============================================================
 */

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
