
/* ============================================================
   全局错误处理：捕获未处理的异常和 Promise rejection
   ============================================================ */
window.addEventListener('error', function(e) {
  console.error('[Global Error]', e.message, e.filename + ':' + e.lineno);
});

window.addEventListener('unhandledrejection', function(e) {
  console.error('[Unhandled Promise Rejection]', e.reason);
  e.preventDefault();
});
'use strict';

/* ============================================================
   十七、页面初始化
   ============================================================ */

// 初始渲染（使用基准数据，不等待API）
/* ============================================================
   十四、自动刷新（3分钟定时器 + 倒计时显示）
   ============================================================ */
var AUTO_REFRESH_INTERVAL = 3 * 60 * 1000; // 3分钟（提高盘中数据敏锐度）
var _autoRefreshTimer = null;    // setInterval ID
var _countdownTimer = null;      // 倒计时 setInterval ID
var _autoRefreshEnabled = true;  // 开关状态
var _nextRefreshTime = 0;        // 下次刷新的时间戳
var _klineAutoFetched = false;   // K线自动拉取标记（防重复）

/**
 * 启动自动刷新定时器
 * 每3分钟自动调用 runAnalysis(true) 刷新实时行情
 * 情绪温度计在交易时段每15分钟刷新一次（通过缓存策略控制）
 */
function startAutoRefresh() {
  stopAutoRefresh();
  _autoRefreshEnabled = true;
  _nextRefreshTime = Date.now() + AUTO_REFRESH_INTERVAL;

  // 主定时器：3分钟触发一次刷新（非强制，依赖缓存策略减少请求）
  // 使用 Perf.setInterval 跟踪定时器，页面卸载时自动清理
  _autoRefreshTimer = Perf.setInterval(function() {
    if (!_autoRefreshEnabled) return;
    // 页面不可见时跳过（节省请求，标签页切回时立即刷新）
    if (document.hidden) {
      _nextRefreshTime = Date.now() + 5000; // 5秒后重试
      return;
    }
    if(__DEBUG__)console.log('[自动刷新] 定时器触发');
    // 使用 forceRefresh=true 确保行情数据更新（板块资金流和情绪数据有各自的缓存策略）
    runAnalysis(true);
    _nextRefreshTime = Date.now() + AUTO_REFRESH_INTERVAL;
  }, AUTO_REFRESH_INTERVAL);

  // 倒计时显示：每秒更新（长运行定时器，同样纳入 Perf 跟踪）
  _countdownTimer = Perf.setInterval(function() {
    updateCountdownDisplay();
  }, 1000);

  updateCountdownDisplay();
  if(__DEBUG__)console.log('[自动刷新] 已启动，间隔5分钟');
}

/**
 * 停止自动刷新
 */
function stopAutoRefresh() {
  _autoRefreshEnabled = false;
  if (_autoRefreshTimer) { Perf.clearInterval(_autoRefreshTimer); _autoRefreshTimer = null; }
  if (_countdownTimer) { Perf.clearInterval(_countdownTimer); _countdownTimer = null; }
  updateCountdownDisplay();
  if(__DEBUG__)console.log('[自动刷新] 已停止');
}

/**
 * 切换自动刷新开关
 */
function toggleAutoRefresh() {
  if (_autoRefreshEnabled) {
    stopAutoRefresh();
  } else {
    startAutoRefresh();
  }
}

/**
 * 更新倒计时显示
 */
var _cachedRefreshLabel = null;
function updateCountdownDisplay() {
  if (!_cachedRefreshLabel) _cachedRefreshLabel = document.getElementById('autoRefreshLabel');
  var el = _cachedRefreshLabel;
  if (!el) return;
  if (!_autoRefreshEnabled) {
    el.textContent = '自动刷新 已暂停';
    el.classList.add('paused');
    return;
  }
  el.classList.remove('paused');
  if (document.hidden) {
    el.textContent = '自动刷新 等待中...';
    return;
  }
  var remaining = Math.max(0, _nextRefreshTime - Date.now());
  var sec = Math.ceil(remaining / 1000);
  var m = Math.floor(sec / 60);
  var s = sec % 60;
  el.textContent = '自动刷新 ' + m + ':' + String(s).padStart(2, '0');
}

/**
 * 页面可见性变化时立即刷新（从后台切回前台）
 */
document.addEventListener('visibilitychange', function() {
  if (!document.hidden && _autoRefreshEnabled) {
    var elapsed = Date.now() - (_nextRefreshTime - AUTO_REFRESH_INTERVAL);
    // 如果离开超过刷新间隔，立即刷新
    if (elapsed >= AUTO_REFRESH_INTERVAL) {
      if(__DEBUG__)console.log('[自动刷新] 页面重新可见且超过刷新间隔，立即刷新');
      runAnalysis(true);
      _nextRefreshTime = Date.now() + AUTO_REFRESH_INTERVAL;
    }
  }
});

/* ============================================================
   政策风标：A股政策驱动数据库 + 渲染
   数据来源：公开政策文件整理，定期更新
   ============================================================ */

var POLICY_DATA = [
  {
    date: '2025-07-25',
    type: 'bull',
    title: '证监会巩固市场回稳态势，打好政策"组合拳"',
    desc: '持续推动新"国九条"和资本市场"1+N"政策文件落地见效，维护市场稳定运行',
    impact: 3,
    term: 'short',
    sectors: [
      { name: '大盘蓝筹', dir: 'pos' },
      { name: '高股息', dir: 'pos' },
      { name: '券商', dir: 'pos' }
    ]
  },
  {
    date: '2025-07-24',
    type: 'bull',
    title: '证监会年中工作会议：四大着力点部署下半年改革',
    desc: '吴清提出"市场要稳、监管要严、功能要强、队伍要过硬"，推动中长期资金入市、公募基金改革、科创板"1+6"等标志性改革突破',
    impact: 3,
    term: 'long',
    sectors: [
      { name: '券商', dir: 'pos' },
      { name: '硬科技', dir: 'pos' },
      { name: '大盘蓝筹', dir: 'pos' },
      { name: 'ST股/问题股', dir: 'neg' }
    ]
  },
  {
    date: '2025-07-14',
    type: 'bull',
    title: '央行6月金融数据发布会：强化下半年降息降准预期',
    desc: '市场预期下半年仍有1-2次降息（政策利率合计调降20-30BP）、50BP降准有望落地，流动性环境持续友好',
    impact: 2,
    term: 'short',
    sectors: [
      { name: '银行', dir: 'pos' },
      { name: '地产', dir: 'pos' },
      { name: '券商', dir: 'pos' },
      { name: '全市场流动性', dir: 'pos' }
    ]
  },
  {
    date: '2025-07-02',
    type: 'bull',
    title: '证监会党委扩大会议：以"两创板"改革为抓手推进全面深化资本市场改革',
    desc: '将维护市场稳定作为监管首要任务，持续提升A股吸引力和竞争力，深化科创板创业板改革',
    impact: 2,
    term: 'long',
    sectors: [
      { name: '科创板', dir: 'pos' },
      { name: '创业板', dir: 'pos' },
      { name: '半导体', dir: 'pos' }
    ]
  },
  {
    date: '2025-06-18',
    type: 'bull',
    title: '科创板"1+6"政策正式出炉（陆家嘴论坛）',
    desc: '设置科创成长层并重启未盈利企业第五套标准上市，配套六项措施增强制度包容性，精准服务硬科技企业',
    impact: 3,
    term: 'long',
    sectors: [
      { name: '半导体', dir: 'pos' },
      { name: '人工智能', dir: 'pos' },
      { name: '生物医药', dir: 'pos' },
      { name: '硬科技', dir: 'pos' }
    ]
  },
  {
    date: '2025-06-18',
    type: 'bull',
    title: '"十五五"规划定调：顶层资源向新质生产力倾斜',
    desc: 'AI、半导体、人形机器人、商业航天、新型储能、高端装备获重点支持，科创专项债与产业大基金持续加码',
    impact: 3,
    term: 'long',
    sectors: [
      { name: '人工智能', dir: 'pos' },
      { name: '半导体', dir: 'pos' },
      { name: '机器人', dir: 'pos' },
      { name: '商业航天', dir: 'pos' },
      { name: '储能', dir: 'pos' }
    ]
  },
  {
    date: '2025-06-15',
    type: 'bull',
    title: '多地密集出台楼市组合拳：全面取消限售+以旧换新+房票安置',
    desc: '住建部推进"四个取消"（限购/限售/限价/普通住宅认定），130个省市362次公积金利率调整，广州拟全面取消限购',
    impact: 2,
    term: 'short',
    sectors: [
      { name: '房地产', dir: 'pos' },
      { name: '建材', dir: 'pos' },
      { name: '家居', dir: 'pos' }
    ]
  },
  {
    date: '2025-06-10',
    type: 'bull',
    title: '3000亿保障性住房再贷款+换房个税优惠延续至2027年',
    desc: '支持地方国企收储存量房源，居民换购住房个人所得税优惠政策延续，稳楼市力度加码',
    impact: 2,
    term: 'short',
    sectors: [
      { name: '房地产', dir: 'pos' },
      { name: '城投平台', dir: 'pos' }
    ]
  },
  {
    date: '2025-06-20',
    type: 'neutral',
    title: '6月LPR报价维持不变（1年期3.0%/5年期3.5%）',
    desc: '5月降息后货币政策进入观察期，LPR按兵不动，但下半年降息预期仍存',
    impact: 1,
    term: 'short',
    sectors: []
  },
  {
    date: '2025-05-16',
    type: 'bull',
    title: '证监会修订发布《上市公司重大资产重组管理办法》',
    desc: '"并购六条"配套措施正式落地，对私募股权机构收购重组股份锁定期实施"反向挂钩"激励，推动产业整合',
    impact: 2,
    term: 'long',
    sectors: [
      { name: '并购重组概念', dir: 'pos' },
      { name: '券商', dir: 'pos' },
      { name: '产业整合标的', dir: 'pos' }
    ]
  },
  {
    date: '2025-05-07',
    type: 'bull',
    title: '央行一揽子货币政策：降准0.5%+降息0.1%',
    desc: '释放约1万亿元长期流动性，7天逆回购利率降至1.4%，5月LPR双双下调10bp（1年期3.0%/5年期3.5%）',
    impact: 3,
    term: 'short',
    sectors: [
      { name: '银行', dir: 'pos' },
      { name: '地产', dir: 'pos' },
      { name: '券商', dir: 'pos' },
      { name: '全市场流动性', dir: 'pos' }
    ]
  },
  {
    date: '2025-05-07',
    type: 'bull',
    title: '"人工智能+"行动落地推进，7项智能体互联国家标准发布',
    desc: 'AI应用加速落地，智能体互联标准体系建设推动产业化进程',
    impact: 2,
    term: 'long',
    sectors: [
      { name: '人工智能', dir: 'pos' },
      { name: '算力', dir: 'pos' },
      { name: '光模块', dir: 'pos' }
    ]
  },
  {
    date: '2025-04-17',
    type: 'bear',
    title: '证监会拟出台违规减持处罚规则（征求意见稿）',
    desc: '细化"绝对不能减/无权减持"等处罚情形，与3月施行的《裁量基本规则》适配，严打"花式减持"',
    impact: 2,
    term: 'long',
    sectors: [
      { name: '高质押个股', dir: 'neg' },
      { name: '减持频繁个股', dir: 'neg' },
      { name: '微盘股', dir: 'neg' }
    ]
  },
  {
    date: '2025-03-27',
    type: 'bear',
    title: '史上最严减持新规（证监会令第227号）正式施行',
    desc: '大股东减持与盈利/股价深度绑定，破净/亏损期间禁止减持，封堵技术性离婚、转融通等绕道套现通道',
    impact: 3,
    term: 'long',
    sectors: [
      { name: '微盘股', dir: 'neg' },
      { name: '绩差股', dir: 'neg' },
      { name: '破净股', dir: 'neg' },
      { name: '优质蓝筹', dir: 'pos' }
    ]
  }
];

/* ============================================================
   政策数据动态获取：从东方财富快讯API获取最新政策新闻
   数据源：东方财富7x24快讯 + 新闻搜索
   缓存策略：localStorage 30分钟TTL
   ============================================================ */
var POLICY_CACHE_KEY = 'policy_news_cache_v1';
var POLICY_CACHE_TTL = 30 * 60 * 1000; // 30分钟

// 政策关键词匹配规则
/* ===== 政策主线数据模型：7大政策受益主题 ===== */
var POLICY_THEMES = [
  {
    name: '数字经济', icon: '💿', color: '#4f8cff',
    keywords: ['数字经济','数字化转型','数据要素','数据资产','数字中国','东数西算','数据局','数据二十条','数字基础设施'],
    etfCode: 'sz159658', etfName: '数字经济ETF',
    policy: '《数字中国建设整体布局规划》全面落地',
    direction: '数据要素市场化配置·算力基础设施加速',
    desc: '数据资产入表推进，数据要素×行动计划实施'
  },
  {
    name: '先进制造', icon: '🏭', color: '#e8722c',
    keywords: ['先进制造','智能制造','高端制造','制造强国','工业母机','数控机床','专精特新','新型工业化','产业升级','工业互联网'],
    etfCode: 'sh516050', etfName: '先进制造ETF',
    policy: '新型工业化·制造强国战略',
    direction: '工业母机国产替代+专精特新培育',
    desc: '高端装备自主可控，制造业转型升级加速'
  },
  {
    name: '生物医药', icon: '🧬', color: '#2db37c',
    keywords: ['生物医药','创新药','医疗器械','CXO','药品审评','一致性评价','医保谈判','药械集采','基因治疗','ADC'],
    etfCode: 'sz159992', etfName: '创新药ETF',
    policy: '创新药械审评审批加速·医保支持',
    direction: '创新药出海+药械审评提速',
    desc: '人口老龄化刚需，创新药估值修复'
  },
  {
    name: '绿色低碳', icon: '🌱', color: '#36b37e',
    keywords: ['绿色低碳','碳中和','碳达峰','ESG','绿电','碳排放','碳交易','节能环保','绿色金融','碳足迹'],
    etfCode: 'sh159885', etfName: '碳中和ETF',
    policy: '双碳目标·碳达峰碳中和路线图',
    direction: '碳排放交易市场扩容·绿电交易',
    desc: '双碳战略长期主线，绿色转型加速'
  },
  {
    name: '银发经济', icon: '👴', color: '#8b6ed6',
    keywords: ['银发经济','养老','适老化','康养','老年消费','养老服务','养老金融','长期护理','智慧养老','老年健康'],
    etfCode: 'sh516970', etfName: '养老产业ETF',
    policy: '银发经济顶层设计·养老服务体系完善',
    direction: '适老化改造+康养服务产业链',
    desc: '老龄化加速，银发经济万亿市场'
  },
  {
    name: '现代农业', icon: '🌾', color: '#c4a747',
    keywords: ['现代农业','乡村振兴','种业','转基因','智慧农业','农业科技','粮食安全','高标准农田','农垦','农产品加工'],
    etfCode: 'sz159825', etfName: '农业ETF',
    policy: '乡村振兴·种业振兴行动',
    direction: '转基因商业化+智慧农业推广',
    desc: '粮食安全战略，种业翻身仗'
  },
  {
    name: '低空经济', icon: '🚁', color: '#5b8def',
    keywords: ['低空经济','eVTOL','无人机','飞行汽车','低空空域','通用航空','空中交通','低空飞行','空中游览','城市空运'],
    etfCode: 'sh159507', etfName: '低空经济ETF',
    policy: '低空经济纳入战略性新兴产业',
    direction: 'eVTOL适航审定+低空空域开放',
    desc: '万亿级新赛道，低空基础设施加速'
  }
];

var POLICY_KEYWORDS = [
  '央行', '证监会', '银保监', '国务院', '财政部', '发改委', '工信部',
  '降息', '降准', 'LPR', 'MLF', '逆回购', '再贷款',
  '政策', '规划', '纲要', '意见', '办法', '条例', '规定',
  '改革', '开放', '试点', '实施', '发布', '印发',
  '科技', '半导体', '人工智能', '新能源', '芯片', '军工',
  '房地产', '楼市', '住房', '保障房',
  '注册制', '并购', '重组', '减持', '分红',
  '碳达峰', '碳中和', '绿色', '环保',
  '消费', '内需', '新基建',
  // 政策主线7大主题关键词
  '数字经济','数字化转型','数据要素','数据资产','数字中国','东数西算','数据局',
  '先进制造','智能制造','高端制造','制造强国','工业母机','专精特新','新型工业化',
  '生物医药','创新药','医疗器械','CXO','药品审评','医保谈判','基因治疗',
  '绿色低碳','碳达峰','碳中和','ESG','绿电','碳排放','碳交易',
  '银发经济','养老','适老化','康养','长期护理','智慧养老',
  '现代农业','乡村振兴','种业','转基因','智慧农业','粮食安全','高标准农田',
  '低空经济','eVTOL','无人机','飞行汽车','低空空域','通用航空'
];

// 利空关键词
var BEAR_KEYWORDS = ['处罚', '违规', '立案', '退市', '风险警示', '限制', '收紧', '叫停', '整顿', '问责'];

/**
 * 判断新闻标题是否与政策相关
 */
function isPolicyRelated(title, desc) {
  var text = (title || '') + (desc || '');
  return POLICY_KEYWORDS.some(function(kw) { return text.indexOf(kw) >= 0; });
}

/**
 * 判断政策方向（利好/利空/中性）
 */
function classifyPolicy(title, desc) {
  var text = (title || '') + (desc || '');
  var isBear = BEAR_KEYWORDS.some(function(kw) { return text.indexOf(kw) >= 0; });
  if (isBear) return 'bear';

  var bullWords = ['支持', '利好', '促进', '推动', '加码', '释放', '降息', '降准', '改革', '开放', '扶持', '补贴', '减税', '优惠'];
  var isBull = bullWords.some(function(kw) { return text.indexOf(kw) >= 0; });
  if (isBull) return 'bull';

  return 'neutral';
}

/**
 * 评估政策影响力（1-3）
 */
function assessImpact(title, desc) {
  var text = (title || '') + (desc || '');
  var highImpactWords = ['降准', '降息', '国务院', '重大', '组合拳', '一揽子', '万亿', '改革', '规划'];
  var midImpactWords = ['证监会', '央行', '财政部', '发布', '实施', '试点'];

  if (highImpactWords.some(function(kw) { return text.indexOf(kw) >= 0; })) return 3;
  if (midImpactWords.some(function(kw) { return text.indexOf(kw) >= 0; })) return 2;
  return 1;
}

/**
 * 从标题提取受影响行业
 */
function extractSectors(title, desc) {
  var text = (title || '') + (desc || '');
  var sectors = [];
  var sectorMap = {
    '银行': ['银行', '金融', '信贷'],
    '地产': ['地产', '房地产', '楼市', '住房'],
    '券商': ['券商', '证券', '资本市场', '注册制'],
    '半导体': ['半导体', '芯片', '集成电路', '晶圆'],
    '人工智能': ['人工智能', 'AI', '智能', '算力'],
    '新能源': ['新能源', '光伏', '风电', '储能', '锂电'],
    '医药': ['医药', '医疗', '生物', '药品', '集采'],
    '军工': ['军工', '国防', '航天', '装备'],
    '消费': ['消费', '内需', '零售', '食品'],
    '科技': ['科技', '创新', '研发', '高新'],
    '机器人': ['机器人', '自动化'],
    '通信': ['通信', '5G', '6G', '光模块', 'CPO'],
    '煤炭': ['煤炭', '能源'],
    '有色': ['有色', '金属', '铜', '铝', '锂'],
    // 政策主线7大主题
    '数字经济': ['数字经济', '数据要素', '数据资产', '数字中国', '东数西算', '数据局', '数字化转型'],
    '先进制造': ['先进制造', '智能制造', '高端制造', '制造强国', '工业母机', '专精特新', '新型工业化', '产业升级'],
    '生物医药': ['生物医药', '创新药', '医疗器械', 'CXO', '药品审评', '医保谈判', '基因治疗', 'ADC'],
    '绿色低碳': ['绿色低碳', '碳中和', '碳达峰', 'ESG', '绿电', '碳排放', '碳交易', '碳足迹'],
    '银发经济': ['银发经济', '养老', '适老化', '康养', '老年消费', '长期护理', '智慧养老'],
    '现代农业': ['现代农业', '乡村振兴', '种业', '转基因', '智慧农业', '粮食安全', '高标准农田'],
    '低空经济': ['低空经济', 'eVTOL', '无人机', '飞行汽车', '低空空域', '通用航空', '空中交通']
  };

  Object.keys(sectorMap).forEach(function(sector) {
    if (sectorMap[sector].some(function(kw) { return text.indexOf(kw) >= 0; })) {
      var dir = classifyPolicy(title, desc) === 'bear' ? 'neg' : 'pos';
      sectors.push({ name: sector, dir: dir });
    }
  });

  return sectors;
}

/**
 * 渲染政策主线主题卡片（7大政策受益方向）
 */
function renderPolicyThemes() {
  var container = document.getElementById('policyThemesGrid');
  if (!container) return;

  container.innerHTML = POLICY_THEMES.map(function(theme, idx) {
    return '<div class="pt-card" data-theme-idx="' + idx + '" style="--pt-color:' + theme.color + '">' +
      '<div class="pt-card-top">' +
        '<span class="pt-icon">' + theme.icon + '</span>' +
        '<div class="pt-card-info">' +
          '<span class="pt-name">' + theme.name + '</span>' +
          '<span class="pt-policy">' + theme.policy + '</span>' +
        '</div>' +
        '<span class="pt-pct" id="ptPct_' + idx + '">—</span>' +
      '</div>' +
      '<div class="pt-direction">' + theme.direction + '</div>' +
      '<div class="pt-etf" onclick="searchStockByCode(\'' + theme.etfCode + '\')">' +
        '<span class="pt-etf-badge">ETF</span>' +
        '<span class="pt-etf-name">' + theme.etfName + '</span>' +
        '<span class="pt-etf-code">' + theme.etfCode + '</span>' +
        '<span class="pt-etf-price" id="ptPrice_' + idx + '">—</span>' +
      '</div>' +
      '<div class="pt-desc">' + theme.desc + '</div>' +
    '</div>';
  }).join('');

  // 异步获取每个主题ETF的实时行情
  POLICY_THEMES.forEach(function(theme, idx) {
    _fetchPolicyThemeQuote(theme, idx);
  });
}

/**
 * 获取政策主题ETF实时行情（东方财富push2）
 */
function _fetchPolicyThemeQuote(theme, idx) {
  var prefix = theme.etfCode.substring(0, 2);
  var code = theme.etfCode.substring(2);
  var secid = (prefix === 'sh' ? '1.' : '0.') + code;
  var url = 'https://push2.eastmoney.com/api/qt/stock/get?ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&fields=f43,f57,f58,f170&secid=' + secid;

  emJsonp(url, 6000).then(function(resp) {
    if (!resp || !resp.data) return;
    var d = resp.data;
    var price = d.f43;
    var pct = d.f170;
    if (typeof price !== 'number' || price === 0) return;

    var priceEl = document.getElementById('ptPrice_' + idx);
    var pctEl = document.getElementById('ptPct_' + idx);

    if (priceEl) priceEl.textContent = price.toFixed(3);
    if (pctEl) {
      pctEl.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
      pctEl.className = 'pt-pct ' + (pct >= 0 ? 'pt-up' : 'pt-down');
    }
  }).catch(function() {});
}

/**
 * 格式化日期为 YYYY-MM-DD
 */
function formatDate(date) {
  var y = date.getFullYear();
  var m = String(date.getMonth() + 1).padStart(2, '0');
  var d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

/**
 * 从东方财富7x24快讯API获取最新政策新闻
 * @param {boolean} forceRefresh - 强制刷新（忽略缓存）
 */
function fetchLatestPolicyNews(forceRefresh) {
  // 检查缓存（非强制刷新时）
  if (!forceRefresh) {
    try {
      var cached = localStorage.getItem(POLICY_CACHE_KEY);
      if (cached) {
        var data = JSON.parse(cached);
        if (Date.now() - data.ts < POLICY_CACHE_TTL && data.news && data.news.length > 0) {
          mergePolicyNews(data.news);
          return Promise.resolve(data.news);
        }
      }
    } catch(e) {}
  }

  // 使用东方财富np-listapi快讯接口
  var ts = Date.now();
  var url = 'https://np-listapi.eastmoney.com/comm/web/getFastNewsList?client=web&biz=stock&fastColumn=102&pageSize=50&pageIndex=1&sortEnd=&endTime=&req_trace=' + ts + '&isDelay=1';

  return fetchWithTimeout(url, { cache: 'no-store' }, 10000)
    .then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function(data) {
      var newsItems = [];
      if (data && data.data && data.data.fastNewsList) {
        data.data.fastNewsList.forEach(function(item) {
          var title = item.title || '';
          var desc = item.summary || '';
          if (!isPolicyRelated(title, desc)) return;
          
          var dateStr = item.showTime || '';
          var newsDate = dateStr ? dateStr.substring(0, 10) : formatDate(new Date());
          var newsTime = dateStr ? dateStr.substring(11, 16) : '';
          
          // 只保留近60天的政策
          var newsTimeMs = dateStr ? new Date(dateStr.replace(/-/g, '/')).getTime() : 0;
          if (newsTimeMs && Date.now() - newsTimeMs > 60 * 24 * 60 * 60 * 1000) return;
          
          var type = classifyPolicy(title, desc);
          var impact = assessImpact(title, desc);
          var sectors = extractSectors(title, desc);
          
          newsItems.push({
            date: newsDate,
            time: newsTime,
            type: type,
            title: title,
            desc: desc.substring(0, 200),
            impact: impact,
            sectors: sectors
          });
        });
      }
      
      if (newsItems.length > 0) {
        // 缓存
        try {
          localStorage.setItem(POLICY_CACHE_KEY, JSON.stringify({
            ts: Date.now(),
            news: newsItems
          }));
        } catch(e) {}
        mergePolicyNews(newsItems);
      }
      return newsItems;
    })
    .catch(function(e) {
      // 静默失败，使用静态数据
      if (__DEBUG__) console.log('政策新闻获取失败，使用静态数据:', e);
      return [];
    });
}

/**
 * 手动刷新政策数据（用户点击刷新按钮触发）
 */
function manualRefreshPolicy() {
  var btn = document.getElementById('pvRefreshBtn');
  if (btn) {
    btn.classList.add('spinning');
    btn.disabled = true;
  }
  if (typeof showToast === 'function') showToast('正在获取最新政策...');

  fetchLatestPolicyNews(true).then(function(news) {
    if (btn) {
      btn.classList.remove('spinning');
      btn.disabled = false;
    }
    if (news && news.length > 0) {
      if (typeof showToast === 'function') showToast('政策数据已刷新');
    } else {
      if (typeof showToast === 'function') showToast('暂无新政策数据');
    }
  }).catch(function() {
    if (btn) {
      btn.classList.remove('spinning');
      btn.disabled = false;
    }
    if (typeof showToast === 'function') showToast('政策数据刷新失败，请稍后重试');
  });
}

/**
 * 政策数据自动刷新定时器（15分钟周期）
 * 独立于行情自动刷新，避免频繁请求
 */
var POLICY_REFRESH_INTERVAL = 15 * 60 * 1000; // 15分钟
var _policyRefreshTimer = null;

function startPolicyAutoRefresh() {
  stopPolicyAutoRefresh();
  _policyRefreshTimer = Perf.setInterval(function() {
    if (document.hidden) return; // 页面不可见时跳过
    fetchLatestPolicyNews(false);
  }, POLICY_REFRESH_INTERVAL);
  if(__DEBUG__)console.log('[政策刷新] 已启动，间隔15分钟');
}

function stopPolicyAutoRefresh() {
  if (_policyRefreshTimer) { Perf.clearInterval(_policyRefreshTimer); _policyRefreshTimer = null; }
}

/**
 * 从搜索结果解析政策新闻
 */
function parsePolicyNewsFromSearch(data) {
  if (!data || !data.result || !data.result.cmsArticleWebOld) return [];
  var articles = data.result.cmsArticleWebOld.list || [];
  var news = [];

  articles.forEach(function(article) {
    var title = article.title || '';
    var desc = article.content || '';
    // 去除HTML标签
    title = title.replace(/<[^>]+>/g, '');
    desc = desc.replace(/<[^>]+>/g, '').substring(0, 200);

    if (!isPolicyRelated(title, desc)) return;

    var dateStr = article.date || '';
    var newsDate = dateStr ? dateStr.substring(0, 10) : formatDate(new Date());

    // 只保留近60天的政策
    var newsTime = new Date(newsDate).getTime();
    if (isNaN(newsTime) || Date.now() - newsTime > 60 * 24 * 60 * 60 * 1000) return;

    var type = classifyPolicy(title, desc);
    var impact = assessImpact(title, desc);
    var sectors = extractSectors(title, desc);
    var term = (title.indexOf('规划') >= 0 || title.indexOf('纲要') >= 0 || title.indexOf('长期') >= 0) ? 'long' : 'short';

    news.push({
      date: newsDate,
      type: type,
      title: title,
      desc: desc,
      impact: impact,
      term: term,
      sectors: sectors,
      _dynamic: true
    });
  });

  return news;
}

/**
 * 将动态获取的政策新闻与静态数据合并，去重后重新渲染
 */
function mergePolicyNews(dynamicNews) {
  if (!dynamicNews || dynamicNews.length === 0) return;

  // 提取已有的标题用于去重
  var existingTitles = {};
  POLICY_DATA.forEach(function(p) {
    existingTitles[p.title] = true;
  });

  // 过滤掉已存在的政策
  var newItems = dynamicNews.filter(function(n) {
    return !existingTitles[n.title];
  });

  if (newItems.length === 0) return;

  // 合并：动态数据在前（按日期降序），静态数据在后
  newItems.sort(function(a, b) { return b.date.localeCompare(a.date); });
  POLICY_DATA = newItems.concat(POLICY_DATA);

  // 限制总数不超过30条
  if (POLICY_DATA.length > 30) {
    POLICY_DATA = POLICY_DATA.slice(0, 30);
  }

  // 重新渲染
  renderPolicyVane();

  // 显示更新提示
  if (typeof showToast === 'function' && newItems.length > 0) {
    showToast('政策风标已更新 ' + newItems.length + ' 条最新政策');
  }
}

/* 政策风标筛选状态 */
var _pvFilter = 'summary'; // 'summary' | 'all' | 'bull' | 'bear'

/**
 * 渲染政策风标板块
 */
function renderPolicyVane() {
  var listEl = document.getElementById('pvList');
  var summaryEl = document.getElementById('pvSummaryBar');
  if (!listEl) return;

  // 统计
  var bullCount = 0, bearCount = 0;
  POLICY_DATA.forEach(function(p) {
    if (p.type === 'bull') bullCount++;
    else if (p.type === 'bear') bearCount++;
  });

  if (summaryEl) {
    summaryEl.innerHTML =
      '<span class="pv-summary-bull">利好 <b>' + bullCount + '</b>项</span>' +
      '<span class="pv-summary-bear">利空 <b>' + bearCount + '</b>项</span>' +
      '<span>共 <b>' + POLICY_DATA.length + '</b>项政策</span>';
  }

  // 汇总模式：行业聚合视图
  if (_pvFilter === 'summary') {
    renderPolicySummary(listEl);
    return;
  }

  // 详细模式：按筛选条件展示政策卡片
  var filtered = POLICY_DATA.filter(function(p) {
    if (_pvFilter === 'all') return true;
    return p.type === _pvFilter;
  });

  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="pv-empty">暂无相关政策</div>';
    return;
  }

  var html = '';
  filtered.forEach(function(p) {
    var typeCls = p.type === 'bull' ? 'pv-bull' : (p.type === 'bear' ? 'pv-bear' : 'pv-neutral');
    var tagCls = p.type === 'bull' ? 'bull' : (p.type === 'bear' ? 'bear' : 'neutral');
    var tagText = p.type === 'bull' ? '利好' : (p.type === 'bear' ? '利空' : '中性');
    var isLongTerm = p.term === 'long';

    // 影响力圆点
    var dotsHtml = '';
    for (var d = 0; d < 3; d++) {
      dotsHtml += '<span class="pv-impact-dot' + (d < p.impact ? ' on' : '') + '"></span>';
    }

    // 板块标签
    var sectorsHtml = '';
    if (p.sectors && p.sectors.length > 0) {
      sectorsHtml = '<div class="pv-sectors">';
      p.sectors.forEach(function(s) {
        var arrow = s.dir === 'pos' ? '↑' : '↓';
        sectorsHtml += '<span class="pv-sector-tag ' + (s.dir === 'pos' ? 'pos' : 'neg') + '">' +
          '<span class="pv-sector-arrow">' + arrow + '</span>' + s.name + '</span>';
      });
      sectorsHtml += '</div>';
    }

    html += '<div class="pv-card ' + typeCls + (isLongTerm ? ' pv-long-term' : '') + (p._dynamic ? ' pv-dynamic' : '') + '">' +
      '<div class="pv-card-row">' +
        '<span class="pv-tag ' + tagCls + '">' + tagText + '</span>' +
        (isLongTerm ? '<span class="pv-tag lt">★ 长期</span>' : '') +
        '<span class="pv-card-title">' + p.title + '</span>' +
        '<span class="pv-impact">' + dotsHtml + '</span>' +
        '<span class="pv-card-date">' + p.date.slice(5) + '</span>' +
      '</div>' +
      (p.desc ? '<div class="pv-card-desc">' + p.desc + '</div>' : '') +
      sectorsHtml +
    '</div>';
  });

  listEl.innerHTML = html;
}

/**
 * 渲染行业汇总视图（默认模式）
 * 将所有政策中的受影响行业聚合，按利好/利空方向分组，按提及次数排序
 */
function renderPolicySummary(listEl) {
  // 统计每个行业的提及次数和方向，利好按长期/短期分开
  var posMapLT = {};  // 长期利好行业
  var posMapST = {};  // 短期利好行业
  var negMap = {};    // 利空行业

  POLICY_DATA.forEach(function(p) {
    if (!p.sectors) return;
    var isLongTerm = p.term === 'long';
    p.sectors.forEach(function(s) {
      if (s.dir === 'pos') {
        var targetMap = isLongTerm ? posMapLT : posMapST;
        if (!targetMap[s.name]) {
          targetMap[s.name] = { name: s.name, count: 0, impactSum: 0 };
        }
        targetMap[s.name].count++;
        targetMap[s.name].impactSum += p.impact || 1;
      } else {
        if (!negMap[s.name]) {
          negMap[s.name] = { name: s.name, count: 0, impactSum: 0 };
        }
        negMap[s.name].count++;
        negMap[s.name].impactSum += p.impact || 1;
      }
    });
  });

  // 同时出现在长期和短期的行业，优先归入长期并合并计数
  Object.keys(posMapLT).forEach(function(name) {
    if (posMapST[name]) {
      posMapLT[name].count += posMapST[name].count;
      posMapLT[name].impactSum += posMapST[name].impactSum;
      delete posMapST[name];
    }
  });

  // 转为数组并排序（按扶持力度=影响力总和降序，其次按提及次数降序）
  var posLTList = Object.keys(posMapLT).map(function(k) { return posMapLT[k]; })
    .sort(function(a, b) { return b.impactSum - a.impactSum || b.count - a.count; });
  var posSTList = Object.keys(posMapST).map(function(k) { return posMapST[k]; })
    .sort(function(a, b) { return b.impactSum - a.impactSum || b.count - a.count; });
  var negList = Object.keys(negMap).map(function(k) { return negMap[k]; })
    .sort(function(a, b) { return b.impactSum - a.impactSum || b.count - a.count; });

  var totalPos = posLTList.length + posSTList.length;
  var html = '<div class="pv-overview">';

  // 利好行业列（分长期/短期两组）
  html += '<div class="pv-ov-col pos">';
  html += '<div class="pv-ov-col-title">利好行业 <span class="pv-ov-arrow">↑</span> <span style="margin-left:auto;font-size:0.46rem;color:var(--muted)">' + totalPos + '个</span></div>';

  // 长期利好子区域（优先展示，金色高亮）
  html += '<div class="pv-ov-sub lt">';
  html += '<div class="pv-ov-sub-title"><span class="pv-ov-sub-icon">★</span>长期利好 <span style="margin-left:auto;font-size:0.46rem;color:var(--muted)">' + posLTList.length + '个</span></div>';
  html += '<div class="pv-ov-items">';
  if (posLTList.length === 0) {
    html += '<span style="font-size:0.5rem;color:var(--muted);opacity:0.5">暂无</span>';
  } else {
    posLTList.forEach(function(s) {
      var lvl = s.impactSum >= 6 ? 'hi' : (s.impactSum >= 3 ? 'md' : 'lo');
      html += '<span class="pv-ov-item pos lt lv-' + lvl + '">' + s.name +
        '<span class="pv-ov-count">' + s.impactSum + '</span></span>';
    });
  }
  html += '</div></div>';

  // 短期利好子区域
  html += '<div class="pv-ov-sub st">';
  html += '<div class="pv-ov-sub-title">短期利好 <span style="margin-left:auto;font-size:0.46rem;color:var(--muted)">' + posSTList.length + '个</span></div>';
  html += '<div class="pv-ov-items">';
  if (posSTList.length === 0) {
    html += '<span style="font-size:0.5rem;color:var(--muted);opacity:0.5">暂无</span>';
  } else {
    posSTList.forEach(function(s) {
      var lvl = s.impactSum >= 6 ? 'hi' : (s.impactSum >= 3 ? 'md' : 'lo');
      html += '<span class="pv-ov-item pos lv-' + lvl + '">' + s.name +
        '<span class="pv-ov-count">' + s.impactSum + '</span></span>';
    });
  }
  html += '</div></div>';

  html += '</div>'; // end pos col

  // 利空行业列
  html += '<div class="pv-ov-col neg">';
  html += '<div class="pv-ov-col-title">利空行业 <span class="pv-ov-arrow">↓</span> <span style="margin-left:auto;font-size:0.46rem;color:var(--muted)">' + negList.length + '个</span></div>';
  html += '<div class="pv-ov-items">';
  if (negList.length === 0) {
    html += '<span style="font-size:0.5rem;color:var(--muted);opacity:0.5">暂无</span>';
  } else {
    negList.forEach(function(s) {
      var lvl = s.impactSum >= 6 ? 'hi' : (s.impactSum >= 3 ? 'md' : 'lo');
      html += '<span class="pv-ov-item neg lv-' + lvl + '">' + s.name +
        '<span class="pv-ov-count">' + s.impactSum + '</span></span>';
    });
  }
  html += '</div></div>';

  html += '</div>';
  html += '<div class="pv-ov-hint">点击「全部」查看具体政策详情 · 数字为政策扶持力度 · ★为长期政策驱动行业</div>';

  listEl.innerHTML = html;
}

/**
 * 绑定政策风标筛选按钮
 */
function bindPolicyVaneFilters() {
  document.addEventListener('click', function(e) {
    if (e.target.classList && e.target.classList.contains('pv-filter')) {
      var btn = e.target;
      document.querySelectorAll('.pv-filter').forEach(function(b) {
        b.classList.remove('active');
      });
      btn.classList.add('active');
      _pvFilter = btn.getAttribute('data-pv-filter');
      renderPolicyVane();
    }
  });
}

/* ============================================================
   金币散飞特效（页面加载时播放，约2秒）
   ============================================================ */
var _coinRainActive = false;
var _coinRainCoins = [];
var _coinRainCanvas = null;
var _coinRainCtx = null;
var _coinRainRAF = null;
var _coinRainSpawnTimer = null;
var _coinRainStopTimer = null;

/**
 * 启动金币散飞特效
 * @param {number} duration - 总持续时间（毫秒），默认2200ms
 */
function startCoinRain(duration) {
  if (_coinRainActive) return;
  duration = duration || 2200;

  _coinRainCanvas = document.getElementById('coinRainCanvas');
  if (!_coinRainCanvas) return;
  _coinRainCtx = _coinRainCanvas.getContext('2d');

  // 设置画布尺寸
  var dpr = window.devicePixelRatio || 1;
  _coinRainCanvas.width = window.innerWidth * dpr;
  _coinRainCanvas.height = window.innerHeight * dpr;
  _coinRainCanvas.style.width = window.innerWidth + 'px';
  _coinRainCanvas.style.height = window.innerHeight + 'px';
  _coinRainCtx.scale(dpr, dpr);

  _coinRainCanvas.classList.add('active');
  _coinRainActive = true;
  _coinRainCoins = [];

  var W = window.innerWidth;
  var H = window.innerHeight;

  // 持续生成金币（每100ms生成一批，每批1-2个，更分散）
  _coinRainSpawnTimer = setInterval(function() {
    var batchCount = 1 + Math.floor(Math.random() * 2); // 每批1-2个
    for (var i = 0; i < batchCount; i++) {
      _coinRainCoins.push(createCoin(W, H));
    }
  }, 100);

  // 动画循环
  function animate() {
    if (!_coinRainActive) return;
    _coinRainCtx.clearRect(0, 0, W, H);

    for (var i = _coinRainCoins.length - 1; i >= 0; i--) {
      var c = _coinRainCoins[i];
      // 物理更新
      c.vy += c.gravity;
      c.x += c.vx;
      c.y += c.vy;
      c.rotation += c.rotSpeed;
      c.life -= c.fadeRate;

      // 边界反弹（左右）
      if (c.x < 0 && c.vx < 0) { c.vx *= -0.6; c.x = 0; }
      if (c.x > W && c.vx > 0) { c.vx *= -0.6; c.x = W; }

      // 生命值耗尽或飞出屏幕底部，移除
      if (c.life <= 0 || c.y > H + 80) {
        _coinRainCoins.splice(i, 1);
        continue;
      }

      drawCoin(_coinRainCtx, c);
    }

    _coinRainRAF = requestAnimationFrame(animate);
  }
  animate();

  // 到时间后停止生成新金币，等待现有金币飞出屏幕
  _coinRainStopTimer = Perf.trackedSetTimeout(function() {
    if (_coinRainSpawnTimer) { Perf.clearInterval(_coinRainSpawnTimer); _coinRainSpawnTimer = null; }
    // 再等300ms让剩余金币飞完
    Perf.trackedSetTimeout(function() {
      stopCoinRain();
    }, 300);
  }, duration);
}

/**
 * 停止金币特效，清理资源
 */
function stopCoinRain() {
  _coinRainActive = false;
  if (_coinRainRAF) { cancelAnimationFrame(_coinRainRAF); _coinRainRAF = null; }
  if (_coinRainSpawnTimer) { Perf.clearInterval(_coinRainSpawnTimer); _coinRainSpawnTimer = null; }
  if (_coinRainStopTimer) { Perf.clearTimeout(_coinRainStopTimer); _coinRainStopTimer = null; }
  _coinRainCoins = [];
  if (_coinRainCtx) {
    _coinRainCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }
  if (_coinRainCanvas) {
    _coinRainCanvas.classList.remove('active');
  }
}

/**
 * 创建一个金币粒子
 */
function createCoin(W, H) {
  // 全部从顶部散落，水平更分散
  var x = Math.random() * W;
  var y = -30 - Math.random() * 60;
  // 更大的水平散布范围
  var vx = (Math.random() - 0.5) * 8;
  // 初始下落速度 + 大重力 = 快速从顶到底
  var vy = 2 + Math.random() * 4;

  var size = 10 + Math.random() * 14; // 金币半径10-24px
  var isEmoji = Math.random() < 0.3; // 30%概率用emoji金币

  // 根据屏幕高度计算所需重力，确保2秒内落到底部
  // h = v0*t + 0.5*g*t^2 → 需要足够大的g
  var baseGravity = H / 12000; // 约2秒落到底部
  return {
    x: x, y: y, vx: vx, vy: vy,
    gravity: baseGravity + Math.random() * (baseGravity * 0.3),
    size: size,
    rotation: Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * 0.2,
    life: 1.0,
    fadeRate: 0.004 + Math.random() * 0.003,
    type: isEmoji ? (Math.random() < 0.5 ? '💰' : '🪙') : 'coin',
    glowPhase: Math.random() * Math.PI * 2
  };
}

/**
 * 绘制单个金币
 */
function drawCoin(ctx, c) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, c.life));
  ctx.translate(c.x, c.y);
  ctx.rotate(c.rotation);

  if (c.type === 'coin') {
    // 绘制金币（3D旋转效果：通过缩放X模拟翻转）
    var flipScale = Math.abs(Math.cos(c.rotation * 2));
    if (flipScale < 0.15) flipScale = 0.15; // 防止完全消失

    ctx.scale(flipScale, 1);

    // 外圈金色渐变
    var grad = ctx.createRadialGradient(0, 0, 0, 0, 0, c.size);
    grad.addColorStop(0, '#FFF8DC');
    grad.addColorStop(0.3, '#FFD700');
    grad.addColorStop(0.7, '#DAA520');
    grad.addColorStop(1, '#B8860B');

    // 发光效果
    var glow = 0.5 + Math.sin(c.glowPhase + Date.now() * 0.003) * 0.3;
    ctx.shadowColor = 'rgba(255, 215, 0, ' + glow + ')';
    ctx.shadowBlur = c.size * 0.6;

    ctx.beginPath();
    ctx.arc(0, 0, c.size, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // 内圈
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(0, 0, c.size * 0.72, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(184, 134, 11, 0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 中心¥符号
    ctx.fillStyle = 'rgba(139, 105, 20, 0.8)';
    ctx.font = 'bold ' + Math.round(c.size * 0.8) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('¥', 0, 1);

    // 高光
    ctx.beginPath();
    ctx.arc(-c.size * 0.3, -c.size * 0.3, c.size * 0.25, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.fill();
  } else {
    // emoji金币
    var glow2 = 0.5 + Math.sin(c.glowPhase + Date.now() * 0.003) * 0.3;
    ctx.shadowColor = 'rgba(255, 215, 0, ' + glow2 + ')';
    ctx.shadowBlur = c.size * 0.8;
    ctx.font = c.size * 1.6 + 'px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(c.type, 0, 0);
  }

  ctx.restore();
}

function initPage() {
  // === 第一层：首屏关键内容（同步渲染，确保第一时间可见） ===
  renderIndexCards(null);
  renderOverview();
  updateHeaderTime(false);

  // 金币散飞特效（财运亨通，约2秒）
  startCoinRain(1700);
  
  // 加载并渲染我的估值组合（从localStorage恢复）
  loadPortfolios();
  renderPortfolio();

  // 恢复上次查看的Tab（排除strategy，因为搜索时会自动切换到strategy）
  try {
    var lastTab = localStorage.getItem('last_active_tab');
    if (lastTab && lastTab !== 'valuation' && lastTab !== 'strategy') {
      // 仅恢复估值/行业/组合标签，不恢复strategy（避免首屏显示搜索结果区域）
      switchTab(lastTab);
    }
  } catch(e) {}

  // 绑定事件（轻量操作，立即执行）
  bindHeatmapTabs();
  bindPolicyVaneFilters();
  bindScaFilters();
  initSwipeNavigation();
  initDashboardCardClicks();

  // 渲染政策风标（先渲染静态数据，再异步获取最新政策）
  renderPolicyVane();
  // 渲染政策主线主题卡片（7大政策受益方向）
  renderPolicyThemes();
  // 渲染经济周期判断面板（五维评分+美林时钟+AI债务周期）
  renderCyclePanel();
  // 异步获取最新政策新闻，与静态数据合并
  fetchLatestPolicyNews();

  // 主题选择器：键盘支持 + 点击外部关闭
  var tpPicker = document.getElementById('themePicker');
  if (tpPicker) {
    tpPicker.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.target.classList && e.target.classList.contains('theme-option')) {
          var theme = e.target.getAttribute('data-theme');
          if (theme) setTheme(theme);
        }
      }
      if (e.key === ' ' && e.target.classList && e.target.classList.contains('theme-option')) {
        e.preventDefault();
        var theme = e.target.getAttribute('data-theme');
        if (theme) setTheme(theme);
      }
      if (e.key === 'Escape') {
        tpPicker.classList.remove('show');
        var modeToggle = document.getElementById('modeToggle');
        if (modeToggle) { modeToggle.setAttribute('aria-expanded', 'false'); modeToggle.focus(); }
      }
    });
  }
  document.addEventListener('click', function(e) {
    var picker = document.getElementById('themePicker');
    var toggle = document.getElementById('modeToggle');
    if (!picker || !toggle) return;
    if (!picker.contains(e.target) && e.target !== toggle) {
      picker.classList.remove('show');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });

  // === 第二层：Canvas 绘制（下一帧执行，不阻塞首屏渲染） ===
  // 注：renderDashboard 已在 runAnalysis 的阶段1完成时调用（见 rotation.js）
  requestAnimationFrame(function() {
    drawHeatmap();
    drawPEBar(null);
  });

  // === 第三层：非关键内容（浏览器空闲时执行） ===
  // 优化：使用 Perf.trackedSetTimeout 跟踪定时器
  var idleCb = window.requestIdleCallback || function(fn) { return Perf.trackedSetTimeout(fn, 50); };
  idleCb(function() {
    renderSpotlight(null);
    generateInsights(null);
    renderKlineFromCache();
  });

  // === 第四层：网络请求（延迟300ms启动，优化响应速度） ===
  Perf.trackedSetTimeout(function() {
    runAnalysis(false);
  }, 300);

  // 启动自动刷新（5分钟间隔）
  startAutoRefresh();
  // 启动政策数据自动刷新（15分钟间隔）
  startPolicyAutoRefresh();

  // 自动刷新标签点击切换开关
  var arLabel = document.getElementById('autoRefreshLabel');
  if (arLabel) {
    arLabel.addEventListener('click', function(e) {
      e.stopPropagation();
      toggleAutoRefresh();
      showToast(_autoRefreshEnabled ? '自动刷新已开启 · 5分钟' : '自动刷新已暂停');
    });
  }

  // 组合有个股时延迟刷新行情
  Perf.trackedSetTimeout(function() {
    var hasStocks = _portfolios.some(function(p) { return p.items.length > 0; });
    if (hasStocks) refreshPortfolioPrices();
  }, 2500);

  // 页面加载2秒后自动拉取K线数据（走势图+轮动+行业信号，优化后更快）
  Perf.trackedSetTimeout(function() {
    if (!_klineAutoFetched) {
      _klineAutoFetched = true;
      var statusEl = document.getElementById('klineStatus');
      if (statusEl) {
        statusEl.textContent = '正在自动获取K线数据...';
        statusEl.style.color = getSignalColor('cyan');
      }
      fetchKlineOnly();
    }
  }, 2000);

  // 键盘快捷键系统
  document.addEventListener('keydown', function(e) {
    var tag = document.activeElement ? document.activeElement.tagName : '';
    var isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    var isModifier = e.ctrlKey || e.metaKey || e.altKey;

    // Escape: 清空搜索框 / 关闭主题选择器 / 取消聚焦
    if (e.key === 'Escape') {
      var searchInput = document.getElementById('searchInput');
      var picker = document.getElementById('themePicker');
      if (picker && picker.classList.contains('show')) {
        picker.classList.remove('show');
        var modeToggle = document.getElementById('modeToggle');
        if (modeToggle) modeToggle.setAttribute('aria-expanded', 'false');
        return;
      }
      if (searchInput && searchInput.value) {
        clearSearchInput();
        return;
      }
      if (document.activeElement) document.activeElement.blur();
      return;
    }

    // 以下快捷键仅在非输入框聚焦时生效
    if (isInput) return;

    // "/": 聚焦搜索框
    if (e.key === '/') {
      e.preventDefault();
      var si = document.getElementById('searchInput');
      if (si) {
        si.focus();
        si.select();
        var sb = document.querySelector('.search-bar');
        if (sb) sb.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    // "1-5": 切换Tab
    if (e.key >= '1' && e.key <= '5' && !isModifier) {
      var tabMap = { '1': 'valuation', '2': 'industry', '3': 'strategy', '4': 'fund', '5': 'portfolio' };
      var targetTab = tabMap[e.key];
      if (targetTab) {
        e.preventDefault();
        switchTab(targetTab);
        showToast('已切换到：' + ['估值强度', '行业全景', '策略信号', '基金超市', '我的组合'][parseInt(e.key) - 1]);
      }
      return;
    }

    // "Alt+R": 手动刷新数据
    if (e.key === 'r' && e.altKey) {
      e.preventDefault();
      if (typeof runAnalysis === 'function') {
        showToast('正在刷新数据...');
        runAnalysis(true);
      }
      return;
    }

    // "Alt+T": 切换主题选择器
    if (e.key === 't' && e.altKey) {
      e.preventDefault();
      toggleThemePicker();
      return;
    }

    // "Alt+Left/Right": 左右切换Tab
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.altKey) {
      e.preventDefault();
      var curIdx = getCurrentTabIndex();
      var newIdx = e.key === 'ArrowLeft' ? curIdx - 1 : curIdx + 1;
      if (newIdx >= 0 && newIdx < _tabOrder.length) {
        switchTab(_tabOrder[newIdx], e.key === 'ArrowLeft' ? 'right' : 'left');
      }
      return;
    }
  });

  // 桌面端显示快捷键提示（首次加载时短暂显示）
  if (window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    Perf.trackedSetTimeout(function() {
      showKeyboardHint();
    }, 5000);
  }
}

/* 全局状态：热力图数据类型和筛选 */
var _heatmapType = 'pe';   // 'pe' | 'pb' | 'dy' | 'growth'
var _heatmapFilter = 'all'; // 'all' | 'low' | 'high' | 'popular'

/**
 * 绑定热力图Tab切换和筛选按钮
 */
function bindHeatmapTabs() {
  document.addEventListener('click', function(e) {
    var btn = e.target;
    // Tab切换
    if (btn.classList && btn.classList.contains('hm-tab')) {
      document.querySelectorAll('.hm-tab').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      _heatmapType = btn.getAttribute('data-type');
      drawHeatmap();
    }
    // 筛选按钮
    if (btn.classList && btn.classList.contains('hm-filter')) {
      document.querySelectorAll('.hm-filter').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      _heatmapFilter = btn.getAttribute('data-filter');
      drawHeatmap();
    }
  });
}

/* ============================================================
   估值仪表盘卡片：点击波浪特效 + 自动获取更新数据
   ============================================================ */
var _dashRefreshLock = false;
function initDashboardCardClicks() {
  var cards = document.querySelectorAll('.dash-card');
  cards.forEach(function(card) {
    // 注入波浪元素
    var wave = document.createElement('div');
    wave.className = 'dash-wave';
    card.appendChild(wave);

    card.addEventListener('click', function() {
      // 防止重复点击
      if (card.classList.contains('refreshing')) return;

      // 触发波浪特效
      card.classList.remove('wave-active');
      void card.offsetWidth; // 强制重排以重启动画
      card.classList.add('wave-active');
      Perf.trackedSetTimeout(function() { card.classList.remove('wave-active'); }, 800);

      // 自动获取数据并更新
      if (_dashRefreshLock) return;
      _dashRefreshLock = true;
      card.classList.add('refreshing');
      if (typeof showToast === 'function') showToast('数据更新中...');

      if (typeof runAnalysis === 'function') {
        runAnalysis(true);
      }

      // 解锁（给予冷却时间避免频繁请求）
      Perf.trackedSetTimeout(function() {
 card.classList.remove('refreshing');
 _dashRefreshLock = false;
}, 3000);
    });
  });
}

// DOM 就绪后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPage);
} else {
  initPage();
}

// 窗口大小变化时重绘 Canvas（仅重绘可见区域）
function isInViewport(el) {
  var r = el.getBoundingClientRect();
  return r.top < window.innerHeight && r.bottom > 0;
}
// 使用 Perf.onResize 统一管理 resize 监听（内部已防抖，避免多个监听器）
Perf.onResize(function() {
  var hm = document.getElementById('heatmapCanvas');
  if (hm && isInViewport(hm)) drawHeatmap();
  var pb = document.getElementById('peBarCanvas');
  if (pb && isInViewport(pb)) drawPEBar(_lastRealtimeData);
});

// ==================== 电影级视觉引擎 ====================
(function() {
  'use strict';

  var _reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- 主题颜色工具 ---
  function getThemeColors() {
    var theme = document.body.getAttribute('data-theme') || 'dark';
    var isLight = (theme === 'light' || theme === 'classical' || theme === 'ocean');
    return {
      particle: isLight ? '56, 189, 248' : '0, 200, 255',
      inflow: '0, 255, 198',
      outflow: '255, 51, 102',
      bgFade: isLight ? 'rgba(255, 255, 255, 0.1)' : 'rgba(10, 15, 23, 0.12)'
    };
  }

  // --- 1. 粒子背景系统 ---
  var pCanvas = document.getElementById('particleCanvas');
  if (pCanvas) {
    var pCtx = pCanvas.getContext('2d');
    var particles = [];
    var mouse = { x: -1000, y: -1000 };
    var pAnimId = null;
    var pRunning = false;

    function pResize() {
      pCanvas.width = window.innerWidth;
      pCanvas.height = window.innerHeight;
    }

    function pCreate() {
      particles = [];
      var count = Math.min(60, Math.max(20, Math.floor(window.innerWidth / 25)));
      for (var i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * pCanvas.width,
          y: Math.random() * pCanvas.height,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
          r: Math.random() * 1.5 + 0.5,
          o: Math.random() * 0.4 + 0.15
        });
      }
    }

    function pDraw() {
      pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
      var colors = getThemeColors();
      var pc = colors.particle;

      // 绘制粒子
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        p.x += p.vx;
        p.y += p.vy;

        // 边界环绕
        if (p.x < 0) p.x = pCanvas.width;
        if (p.x > pCanvas.width) p.x = 0;
        if (p.y < 0) p.y = pCanvas.height;
        if (p.y > pCanvas.height) p.y = 0;

        // 鼠标引力
        var dx = mouse.x - p.x;
        var dy = mouse.y - p.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 100 && dist > 0) {
          var force = (100 - dist) / 100 * 0.015;
          p.vx += (dx / dist) * force;
          p.vy += (dy / dist) * force;
        }

        // 速度衰减
        p.vx *= 0.99;
        p.vy *= 0.99;

        pCtx.beginPath();
        pCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        pCtx.fillStyle = 'rgba(' + pc + ', ' + p.o + ')';
        pCtx.fill();
      }

      // 绘制粒子连线
      for (var i = 0; i < particles.length; i++) {
        for (var j = i + 1; j < particles.length; j++) {
          var dx2 = particles[i].x - particles[j].x;
          var dy2 = particles[i].y - particles[j].y;
          var d2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
          if (d2 < 90) {
            pCtx.beginPath();
            pCtx.moveTo(particles[i].x, particles[i].y);
            pCtx.lineTo(particles[j].x, particles[j].y);
            pCtx.strokeStyle = 'rgba(' + pc + ', ' + (1 - d2 / 90) * 0.12 + ')';
            pCtx.lineWidth = 0.5;
            pCtx.stroke();
          }
        }
      }

      if (pRunning) pAnimId = requestAnimationFrame(pDraw);
    }

    function pStart() { if (!pRunning) { pRunning = true; pDraw(); } }
    function pStop() { pRunning = false; if (pAnimId) cancelAnimationFrame(pAnimId); }

    pResize();
    pCreate();
    if (!_reduceMotion) pStart();

    // 使用 Perf.onResize 统一管理（内部已防抖）
    Perf.onResize(function() { pResize(); pCreate(); });

    window.addEventListener('mousemove', function(e) {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    });

    document.addEventListener('visibilitychange', function() {
      if (document.hidden) pStop(); else pStart();
    });
  }

  // --- 2. 数据光流可视化 ---
  var fCanvas = document.getElementById('flowCanvas');
  if (fCanvas) {
    var fCtx = fCanvas.getContext('2d');
    var flows = [];
    var fAnimId = null;
    var fRunning = false;

    function fResize() {
      var w = fCanvas.offsetWidth || 300;
      fCanvas.width = w;
      fCanvas.height = 60;
    }

    function fCreate() {
      flows = [];
      var count = 14;
      for (var i = 0; i < count; i++) {
        var isIn = Math.random() > 0.5;
        flows.push({
          x: Math.random() * fCanvas.width,
          y: isIn ? fCanvas.height + Math.random() * 20 : -Math.random() * 20,
          speed: Math.random() * 1.2 + 0.4,
          r: Math.random() * 1.5 + 0.8,
          isIn: isIn,
          o: Math.random() * 0.5 + 0.3,
          trail: []
        });
      }
    }

    function fDraw() {
      var colors = getThemeColors();
      fCtx.fillStyle = colors.bgFade;
      fCtx.fillRect(0, 0, fCanvas.width, fCanvas.height);

      for (var i = 0; i < flows.length; i++) {
        var f = flows[i];

        f.trail.push({ x: f.x, y: f.y });
        if (f.trail.length > 12) f.trail.shift();

        if (f.isIn) f.y -= f.speed;
        else f.y += f.speed;

        if (f.isIn && f.y < -15) {
          f.y = fCanvas.height + 15;
          f.x = Math.random() * fCanvas.width;
          f.trail = [];
        } else if (!f.isIn && f.y > fCanvas.height + 15) {
          f.y = -15;
          f.x = Math.random() * fCanvas.width;
          f.trail = [];
        }

        var color = f.isIn ? colors.inflow : colors.outflow;

        // 绘制拖尾
        for (var j = 0; j < f.trail.length; j++) {
          var t = f.trail[j];
          var alpha = (j / f.trail.length) * f.o * 0.7;
          fCtx.beginPath();
          fCtx.arc(t.x, t.y, f.r * (j / f.trail.length), 0, Math.PI * 2);
          fCtx.fillStyle = 'rgba(' + color + ', ' + alpha + ')';
          fCtx.fill();
        }

        // 绘制粒子头部
        fCtx.beginPath();
        fCtx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        fCtx.fillStyle = 'rgba(' + color + ', ' + f.o + ')';
        fCtx.fill();
      }

      if (fRunning) fAnimId = requestAnimationFrame(fDraw);
    }

    function fStart() { if (!fRunning) { fRunning = true; fDraw(); } }
    function fStop() { fRunning = false; if (fAnimId) cancelAnimationFrame(fAnimId); }

    // 仅在可视区域运行（且尊重 reduced-motion 偏好）
    if (_reduceMotion) {
      fResize(); fCreate();
    } else if ('IntersectionObserver' in window) {
      var flowObs = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (entry.isIntersecting) fStart();
          else fStop();
        });
      }, { threshold: 0.05 });
      flowObs.observe(fCanvas);
    } else {
      fStart();
    }

    // 延迟初始化确保布局完成
    Perf.trackedSetTimeout(function() { fResize(); fCreate(); }, 300);

    // 使用 Perf.onResize 统一管理（内部已防抖）
    Perf.onResize(function() { fResize(); fCreate(); });

    document.addEventListener('visibilitychange', function() {
      if (document.hidden) fStop();
    });
  }

  // --- 3. 滚动高亮动效 ---
  var highlightSelectors = '.tier1-overview, .market-flow, .sector-capital-box, .dash-card, .val-card, .insight, .rot-block';
  var highlightEls = document.querySelectorAll(highlightSelectors);
  if (highlightEls.length > 0 && 'IntersectionObserver' in window) {
    var hlObs = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('scroll-highlight');
          Perf.trackedSetTimeout(function() {
 entry.target.classList.remove('scroll-highlight');
}, 600);
          hlObs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });

    highlightEls.forEach(function(el) { hlObs.observe(el); });
  }

  // --- 4. 玻璃态景深穿透 ---
  var glassEls = document.querySelectorAll('.glass-card');
  if (glassEls.length > 0) {
    var depthTimer = null;
    window.addEventListener('scroll', function() {
      if (depthTimer) return;
      depthTimer = Perf.trackedSetTimeout(function() {
 depthTimer = null;
 var vh = window.innerHeight;
 glassEls.forEach(function(card) {
          var rect = card.getBoundingClientRect();
          if (rect.bottom < 0 || rect.top > vh) return;
          var centerDist = Math.abs((vh / 2) - (rect.top + rect.height / 2));
          var maxDist = vh / 2;
          var proximity = 1 - Math.min(centerDist / maxDist, 1);
          card.style.filter = 'brightness(' + (1 + proximity * 0.06) + ')';
        });
      }, 80);
    }, { passive: true });
  }
})();

// ==================== 零删减优化方案 · 三大模块引擎 ====================
(function() {
  'use strict';

  // --- 模块一：动态信息权重系统 ---

  // 1a. K线按钮首次焦点高亮
  var btnKline = document.getElementById('btnKline');
  if (btnKline) {
    btnKline.classList.add('focus-highlight');
    // 尝试聚焦按钮（不滚动页面）
    try { btnKline.focus({ preventScroll: true }); } catch(e) {}
    // 3次动画后移除高亮类
    Perf.trackedSetTimeout(function() {
 btnKline.classList.remove('focus-highlight');
}, 7000);
  }

  // 1b. 资金流向条目滚动放大动效
  var mfItems = document.querySelectorAll('.mf-item');
  if (mfItems.length > 0 && 'IntersectionObserver' in window) {
    var mfObs = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('weight-active');
          // 2秒后恢复原始大小
          Perf.trackedSetTimeout(function() {
 entry.target.classList.remove('weight-active');
}, 2000);
        }
      });
    }, { threshold: 0.6 });
    mfItems.forEach(function(el) { mfObs.observe(el); });
  }

  // --- 模块二：持仓聚焦模式 ---

  // 解析URL参数 ?focus=板块名
  function getFocusParam() {
    var params = new URLSearchParams(window.location.search);
    return params.get('focus') || '';
  }

  // 重置聚焦视图
  window.resetFocus = function() {
    var url = new URL(window.location.href);
    url.searchParams.delete('focus');
    window.location.href = url.href;
  };

  // 初始化聚焦模式
  function initFocusMode() {
    var focusSector = getFocusParam();
    if (!focusSector) return;

    // 显示提示栏
    var promptBar = document.getElementById('focusPromptBar');
    var sectorNameEl = document.getElementById('fpSectorName');
    if (promptBar) {
      promptBar.classList.add('active');
      if (sectorNameEl) sectorNameEl.textContent = focusSector;
    }

    // 等待板块表格渲染后执行聚焦
    var focusAttempts = 0;
    function tryFocus() {
      focusAttempts++;
      if (focusAttempts > 20) return; // 最多尝试20次（约10秒）

      var tbody = document.getElementById('scaTableBody');
      if (!tbody || tbody.children.length === 0) {
        Perf.trackedSetTimeout(tryFocus, 500);
        return;
      }

      // 在板块表格中查找匹配的行
      var rows = tbody.querySelectorAll('tr');
      var targetRow = null;
      for (var i = 0; i < rows.length; i++) {
        var nameCell = rows[i].querySelector('.sca-td-name');
        if (nameCell && nameCell.textContent.indexOf(focusSector) !== -1) {
          targetRow = rows[i];
          break;
        }
      }

      if (targetRow) {
        // 添加聚焦样式
        targetRow.classList.add('sca-row-focused');
        tbody.classList.add('has-focus');
        // 滚动至视窗中央
        targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        // 也检查热力图区域
        var heatmapItems = document.querySelectorAll('.heatmap-cell, .heat-sector-name, .sector-name');
        for (var j = 0; j < heatmapItems.length; j++) {
          if (heatmapItems[j].textContent.indexOf(focusSector) !== -1) {
            heatmapItems[j].scrollIntoView({ behavior: 'smooth', block: 'center' });
            break;
          }
        }
      }
    }

    Perf.trackedSetTimeout(tryFocus, 1000);
  }

  // 持仓标记系统
  function initPositionMarking() {
    // 从LocalStorage读取已标记的板块
    var marked = [];
    try {
      var stored = localStorage.getItem('markedPositions');
      if (stored) marked = JSON.parse(stored);
    } catch(e) {}

    // 为板块表格行添加持仓标签
    function addPositionTags() {
      var tbody = document.getElementById('scaTableBody');
      if (!tbody) return;
      var rows = tbody.querySelectorAll('tr');
      rows.forEach(function(row) {
        var nameCell = row.querySelector('.sca-td-name');
        if (!nameCell || nameCell.querySelector('.position-tag')) return;
        var sectorName = nameCell.textContent.replace('🎯', '').trim();
        var isMarked = marked.indexOf(sectorName) !== -1;
        var tag = document.createElement('span');
        tag.className = 'position-tag' + (isMarked ? ' marked' : '');
        tag.textContent = isMarked ? '★ 持仓' : '+ 标记';
        tag.title = isMarked ? '点击取消持仓标记' : '点击标记为持仓';
        tag.onclick = function(e) {
          e.stopPropagation();
          var idx = marked.indexOf(sectorName);
          if (idx !== -1) {
            marked.splice(idx, 1);
            tag.classList.remove('marked');
            tag.textContent = '+ 标记';
            tag.title = '点击标记为持仓';
          } else {
            marked.push(sectorName);
            tag.classList.add('marked');
            tag.textContent = '★ 持仓';
            tag.title = '点击取消持仓标记';
          }
          try { localStorage.setItem('markedPositions', JSON.stringify(marked)); } catch(e) {}
        };
        nameCell.appendChild(tag);
      });
    }

    // 延迟执行，等待表格渲染
    var tagAttempts = 0;
    function tryAddTags() {
      tagAttempts++;
      if (tagAttempts > 15) return;
      var tbody = document.getElementById('scaTableBody');
      if (tbody && tbody.children.length > 0) {
        addPositionTags();
      } else {
        Perf.trackedSetTimeout(tryAddTags, 1000);
      }
    }
    Perf.trackedSetTimeout(tryAddTags, 2000);

    // 监听表格重新渲染（防抖避免频繁触发）
    var _tagTimer = null;
    var observer = new MutationObserver(function() {
      if (_tagTimer) return;
      _tagTimer = Perf.trackedSetTimeout(function() {
 _tagTimer = null;
 addPositionTags();
}, 200);
    });
    var tbody = document.getElementById('scaTableBody');
    if (tbody) {
      observer.observe(tbody, { childList: true });
    }
  }

  // --- 模块三：防误操作三层校验 ---

  // 交易时段检测
  window.getTradeStatusHint = function() {
    var now = new Date();
    var day = now.getDay(); // 0=周日, 6=周六
    var hours = now.getHours();
    var minutes = now.getMinutes();
    var timeStr = hours * 60 + minutes; // 转为分钟

    // 周末休市
    if (day === 0 || day === 6) {
      return {
        isTrading: false,
        badge: '<span class="trade-status-badge closed">⏸️ 休市</span>',
        hint: '数据为最近交易日收盘值'
      };
    }

    // 交易时段：9:30-11:30, 13:00-15:00
    var morningStart = 9 * 60 + 30;
    var morningEnd = 11 * 60 + 30;
    var afternoonStart = 13 * 60;
    var afternoonEnd = 15 * 60;

    if (timeStr >= morningStart && timeStr <= morningEnd) {
      return {
        isTrading: true,
        badge: '<span class="trade-status-badge trading">🔴 交易中</span>',
        hint: ''
      };
    } else if (timeStr >= afternoonStart && timeStr <= afternoonEnd) {
      return {
        isTrading: true,
        badge: '<span class="trade-status-badge trading">🔴 交易中</span>',
        hint: ''
      };
    } else if (timeStr < morningStart && timeStr >= 0) {
      return {
        isTrading: false,
        badge: '<span class="trade-status-badge pre-market">🌅 盘前</span>',
        hint: '数据为昨日收盘值，10:30更新'
      };
    } else if (timeStr > afternoonEnd && timeStr < 24 * 60) {
      return {
        isTrading: false,
        badge: '<span class="trade-status-badge closed">⏸️ 盘后</span>',
        hint: '数据为今日收盘值'
      };
    } else if (timeStr > morningEnd && timeStr < afternoonStart) {
      return {
        isTrading: false,
        badge: '<span class="trade-status-badge pre-market">午休</span>',
        hint: '数据为上午收盘值，13:00继续'
      };
    }

    return { isTrading: false, badge: '', hint: '' };
  };

  // 初始化时立即检测交易状态
  var initialStatus = window.getTradeStatusHint();
  if (!initialStatus.isTrading) {
    document.body.classList.add('market-closed');
  }

  // 启动聚焦模式和持仓标记
  initFocusMode();
  initPositionMarking();
})();

// ==================== 极客科幻视觉引擎 ====================
(function() {
  'use strict';

  // --- 1. 数据流瀑布墙初始化 ---
  function initDataStream() {
    var tracks = document.querySelectorAll('#dataStreamWall .ds-track');
    if (!tracks.length) return;
    // 生成二进制数据流文本
    var binStr = '';
    for (var i = 0; i < 200; i++) {
      binStr += (Math.random() > 0.5 ? '1' : '0') + ' ';
    }
    // 重复一次以实现无缝滚动
    tracks.forEach(function(track, idx) {
      track.textContent = binStr + binStr;
    });
  }
  initDataStream();

  // --- 2. 扫描线触发（数据刷新时） ---
  window.triggerScanLine = function() {
    var sl = document.getElementById('scanLineOverlay');
    if (!sl) return;
    sl.classList.remove('active');
    // 强制 reflow 后重新触发动画
    void sl.offsetWidth;
    sl.classList.add('active');
  };

  // --- 3. 系统状态栏更新 ---
  var sysFeedEl = document.getElementById('sysFeedStatus');
  window.updateSysStatus = function(status) {
    if (!sysFeedEl) return;
    var labels = { live: 'LIVE', standby: 'STANDBY', loading: 'SYNCING...', error: 'OFFLINE' };
    var colors = { live: 'var(--neon-cyan)', standby: 'var(--muted)', loading: 'var(--neon-yellow)', error: 'var(--neon-red)' };
    sysFeedEl.textContent = labels[status] || status.toUpperCase();
    sysFeedEl.style.color = colors[status] || 'var(--muted)';
  };

  // --- 4. 数据脉冲效果（点击按钮/卡片） ---
  document.addEventListener('click', function(e) {
    var target = e.target.closest('.btn-analyze, .dash-card, .val-card, .stat-card, .glass-card');
    if (target) {
      target.classList.remove('data-pulse');
      void target.offsetWidth;
      target.classList.add('data-pulse');
    }
  }, { passive: true });

  // --- 5. 故障边框类添加（防抖优化，避免MutationObserver风暴） ---
  var _glitchTimer = null;
  function addGlitchBorders() {
    var cards = document.querySelectorAll('.dash-card, .val-card, .stat-card');
    cards.forEach(function(card) {
      if (!card.classList.contains('glitch-border')) {
        card.classList.add('glitch-border');
      }
    });
  }
  function scheduleGlitchBorders() {
    if (_glitchTimer) return;
    _glitchTimer = Perf.trackedSetTimeout(function() {
 _glitchTimer = null;
 addGlitchBorders();
}, 300);
  }
  // 初始添加 + DOM变化后防抖检查
  Perf.trackedSetTimeout(addGlitchBorders, 500);
  var glitchObserver = new MutationObserver(function() {
    scheduleGlitchBorders();
  });
  var mainEl = document.getElementById('main-content');
  if (mainEl) {
    glitchObserver.observe(mainEl, { childList: true, subtree: true });
  }

  // --- 6. 科乐美秘籍彩蛋（夜视模式） ---
  var konamiSeq = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
  var konamiIdx = 0;
  document.addEventListener('keydown', function(e) {
    var key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === konamiSeq[konamiIdx]) {
      konamiIdx++;
      if (konamiIdx === konamiSeq.length) {
        konamiIdx = 0;
        document.body.classList.toggle('night-vision');
        var isActive = document.body.classList.contains('night-vision');
        if (typeof showToast === 'function') {
          showToast(isActive ? '🌙 NIGHT VISION MODE ACTIVATED' : '☀️ NIGHT VISION MODE DEACTIVATED');
        }
      }
    } else {
      konamiIdx = (key === konamiSeq[0]) ? 1 : 0;
    }
  });

  // --- 7. 拦截 runAnalysis 触发扫描线 ---
  var _origRunAnalysis = window.runAnalysis;
  if (_origRunAnalysis) {
    window.runAnalysis = function() {
      if (typeof window.triggerScanLine === 'function') window.triggerScanLine();
      if (sysFeedEl) window.updateSysStatus('loading');
      var result = _origRunAnalysis.apply(this, arguments);
      // 分析完成后更新状态
      if (result && typeof result.then === 'function') {
        result.then(function() {
          window.updateSysStatus('live');
        }).catch(function() {
          window.updateSysStatus('error');
        });
      } else {
        Perf.trackedSetTimeout(function() { window.updateSysStatus('live'); }, 2000);
      }
      return result;
    };
  }
})();
