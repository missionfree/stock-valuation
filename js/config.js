'use strict';

// 生产环境调试开关
var __DEBUG__ = false;
/* ============================================================
   零、安全工具函数
   ============================================================ */
/**
 * HTML 实体转义，防止 XSS 注入
 */
function escHTML(str) {
  var s = String(str);
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* ============================================================
   一、内置估值基准数据（来自公开研究，作为分位参考）
   ============================================================ */
var BASE_DATA = {
  // 核心指数：name, tencentCode, klineCode(K线接口用), PE, PB, 股息率, 近10年PE分位, PB分位, 股息率分位, 历史PE范围
  // 数据更新：2026-07-29，PE值已与腾讯实时API(qt.gtimg.cn f[39])交叉验证
  // 注意：pct10/pbPct10/dyPct10为历史分位（截至2026-07-24），非实时计算
  // 注意：指数PB腾讯API返回0，使用静态值（参考各指数最新研报）
  indices: [
    { name:'沪深300',   code:'sh000300',  klineCode:'sh000300',  emSecid:'1.000300', pe:14.4,  pb:1.48, dy:2.40, pct10:67,  pbPct10:55, dyPct10:68,  peMin:8,  peMax:18 },
    { name:'全市场',   code:'sh000985',  klineCode:'sh000985',  emSecid:'1.000985', pe:20.9,  pb:1.70, dy:2.15, pct10:74,  pbPct10:48, dyPct10:55,  peMin:10, peMax:30 },
    { name:'上证指数',   code:'sh000001',  klineCode:'sh000001',  emSecid:'1.000001', pe:17.7,  pb:1.55, dy:2.55, pct10:54,  pbPct10:38, dyPct10:58,  peMin:9,  peMax:25 },
    { name:'深证成指',   code:'sz399001',  klineCode:'sz399001',  emSecid:'0.399001', pe:44.3,  pb:3.20, dy:1.10, pct10:59,  pbPct10:52, dyPct10:28,  peMin:15, peMax:65 },
    { name:'创业板指',   code:'sz399006',  klineCode:'sz399006',  emSecid:'0.399006', pe:57.9,  pb:4.50, dy:0.75, pct10:47,  pbPct10:40, dyPct10:22,  peMin:30, peMax:90 },
    { name:'中证500',   code:'sh000905',  klineCode:'sh000905',  emSecid:'1.000905', pe:35.6,  pb:2.50, dy:1.20, pct10:66,  pbPct10:60, dyPct10:20,  peMin:18, peMax:65 },
    { name:'恒生指数',   code:'hkHSI',     klineCode:'hkHSI',     emSecid:'100.HSI',  pe:11.74, pb:1.17, dy:3.65, pct10:70,  pbPct10:65, dyPct10:80,  peMin:7,  peMax:18 },
    { name:'恒生科技',   code:'hkHSTECH',  klineCode:'hkHSTECH',  emSecid:'100.HSTECH', pe:22.61, pb:2.53, dy:0.5, pct10:30,  pbPct10:25, dyPct10:40,  peMin:15, peMax:40 },
    { name:'H股指数',    code:'hkHSCEI',   klineCode:'hkHSCEI',   emSecid:'100.HSCEI', pe:8.95,  pb:0.88, dy:3.89, pct10:45,  pbPct10:38, dyPct10:85,  peMin:6,  peMax:14 },
    { name:'纳指',       code:'usIXIC',    klineCode:'us.IXIC',   emSecid:'100.IXIC', pe:38.5,  pb:7.8,  dy:0.85, pct10:72,  pbPct10:68, dyPct10:18,  peMin:20, peMax:45 }
  ],
  // 行业板块（etfCode 用于获取实时涨幅, pb/dy/pbPct10/dyPct10/growth 用于热力图切换）
  // peMin/peMax: 近10年PE波动范围，用于动态分位锚点偏移计算
  sectors: [
    { name:'银行',     pe:6.55,  pct10:25, etfCode:'sh512800', pb:0.58, dy:5.32, pbPct10:15, dyPct10:88, growth:5.2,  growthPct:30, peMin:4.5,  peMax:9.0,
      leaders:[
        { name:'招商银行', code:'sh600036', reason:'零售之王·ROE行业第一' },
        { name:'工商银行', code:'sh601398', reason:'宇宙行·总资产最大' }
      ]},
    { name:'房地产',   pe:10.37, pct10:6,  etfCode:'sh512200', pb:0.82, dy:3.15, pbPct10:8,  dyPct10:65, growth:-8.5, growthPct:10, peMin:7.0,  peMax:22.0,
      leaders:[
        { name:'保利发展', code:'sh600048', reason:'央企龙头·融资优势' },
        { name:'万科A',    code:'sz000002', reason:'行业标杆·品牌力强' }
      ]},
    { name:'食品饮料', pe:18.63, pct10:5,  etfCode:'sh515170', pb:4.21, dy:2.85, pbPct10:12, dyPct10:55, growth:8.3,  growthPct:65, peMin:15.0, peMax:50.0,
      leaders:[
        { name:'贵州茅台', code:'sh600519', reason:'A股股王·毛利率91%' },
        { name:'伊利股份', code:'sh600887', reason:'乳业龙头·渠道覆盖广' }
      ]},
    { name:'白酒',     pe:19.11, pct10:10, etfCode:'sh512690', pb:5.88, dy:2.45, pbPct10:18, dyPct10:48, growth:12.5, growthPct:72, peMin:15.0, peMax:60.0,
      leaders:[
        { name:'贵州茅台', code:'sh600519', reason:'高端白酒霸主·品牌护城河' },
        { name:'五粮液',   code:'sz000858', reason:'浓香型龙头·千元价格带' }
      ]},
    { name:'医药生物', pe:29.22, pct10:20, etfCode:'sh512010', pb:3.65, dy:1.35, pbPct10:22, dyPct10:35, growth:15.8, growthPct:78, peMin:20.0, peMax:65.0,
      leaders:[
        { name:'恒瑞医药', code:'sh600276', reason:'创新药龙头·研发投入最大' },
        { name:'迈瑞医疗', code:'sz300760', reason:'医疗器械龙头·全球化布局' }
      ]},
    { name:'新能源',   pe:32.06, pct10:55, etfCode:'sh516160', pb:2.85, dy:0.92, pbPct10:50, dyPct10:25, growth:22.3, growthPct:85, peMin:18.0, peMax:70.0,
      leaders:[
        { name:'宁德时代', code:'sz300750', reason:'动力电池全球第一·市占率37%' },
        { name:'比亚迪',   code:'sz002594', reason:'新能源车销量冠军·垂直整合' }
      ]},
    { name:'国防军工', pe:58.36, pct10:58, etfCode:'sh512660', pb:3.92, dy:0.55, pbPct10:52, dyPct10:18, growth:18.6, growthPct:82, peMin:35.0, peMax:100.0,
      leaders:[
        { name:'中航沈飞', code:'sh600760', reason:'歼击机总装·核心军工资产' },
        { name:'航发动力', code:'sh600893', reason:'航空发动机唯一总装·国产替代' }
      ]},
    { name:'通信',     pe:30.94, pct10:85, etfCode:'sh515880', pb:3.15, dy:0.78, pbPct10:80, dyPct10:22, growth:25.1, growthPct:90, peMin:20.0, peMax:55.0,
      leaders:[
        { name:'中兴通讯', code:'sz000063', reason:'5G设备商全球第四·技术储备深' },
        { name:'中国移动', code:'sh600941', reason:'通信运营商龙头·用户数第一' }
      ]},
    { name:'半导体',   pe:71.93, pct10:99, etfCode:'sh512480', pb:6.52, dy:0.32, pbPct10:95, dyPct10:10, growth:35.2, growthPct:95, peMin:35.0, peMax:120.0,
      leaders:[
        { name:'中芯国际', code:'sh688981', reason:'大陆晶圆代工龙头·国产替代核心' },
        { name:'北方华创', code:'sz002371', reason:'半导体设备龙头·平台型公司' }
      ]}
  ],
  // 概览
  overview: {
    totalCap: '108.0',
    avgPE: '29.55',
    divYield: '1.68%'
  }
};

/* ============================================================
   一·二、ETF 双线轮动配置（动态获取K线计算）
   数据源：ifzq.gtimg.cn 日K线（主源，CORS支持）→ web.ifzq.gtimg.cn（备源），24h缓存
   ============================================================ */
var ROTATION_CONFIG = {
  attack: [
    { name:'科创50ETF',   code:'sh588000' },
    { name:'半导体ETF',   code:'sh512480' },
    { name:'纳指ETF',     code:'sh513100' },
    { name:'创业板ETF',   code:'sz159915' },
    { name:'AI ETF',      code:'sh515980' },
    { name:'机器人ETF',   code:'sh562500' },
    { name:'芯片ETF',     code:'sh512760' },
    { name:'新能源ETF',   code:'sh516160' },
    { name:'军工ETF',     code:'sh512660' },
    { name:'医药ETF',     code:'sh512010' },
    { name:'消费ETF',     code:'sz159928' },
    { name:'恒生科技ETF', code:'sh513130' }
  ],
  defense: [
    { name:'黄金ETF',     code:'sh518880' },
    { name:'红利低波ETF', code:'sh512890' },
    { name:'电力ETF',     code:'sz159611' },
    { name:'债券ETF',     code:'sh511260' },
    { name:'银行ETF',     code:'sh512800' },
    { name:'煤炭ETF',     code:'sh515220' },
    { name:'有色ETF',     code:'sh512400' },
    { name:'石油ETF',     code:'sh161129' },
    { name:'房地产ETF',   code:'sh512200' },
    { name:'基建ETF',     code:'sh516950' },
    { name:'证券ETF',     code:'sh512880' },
    { name:'食品饮料ETF', code:'sh515170' }
  ]
};

/* ============================================================
   一·二B、全球大类资产动量轮动配置
   六大ETF：股、债、商品全覆盖，自带对冲属性
   规则：20日涨幅排名第一 + 收盘价>28日均线
   ============================================================ */
var MOMENTUM_CONFIG = [
  { name:'沪深300ETF',   code:'sh510300',  tag:'A股核心' },
  { name:'企业债ETF',    code:'sh511210',  tag:'高成长机遇' },
  { name:'中概互联ETF',  code:'sh513050',  tag:'港股龙头' },
  { name:'纳指ETF',      code:'sh513100',  tag:'美股科技' },
  { name:'十年国债ETF',  code:'sh511260',  tag:'稳健托底' },
  { name:'黄金ETF',      code:'sh518880',  tag:'避险保值' }
];

/* ============================================================
   一·三、行业信号配置（动态计算动量温度分）
   每个行业对应一个代表ETF，根据近15日涨幅+均线位置算分
   ============================================================ */
var INDUSTRY_CONFIG = [
  { name:'半导体',   code:'sh512480' },
  { name:'算力租赁', code:'sz159820' },
  { name:'机器人',   code:'sh562500' },
  { name:'消费',     code:'sz159928' },
  { name:'AI应用',   code:'sh515980' },
  { name:'CPO通信',  code:'sh515880' },
  { name:'电力',     code:'sz159611' },
  { name:'特高压',   code:'sh562350' },
  { name:'有色',     code:'sh512400' },
  { name:'创新药',   code:'sz159992' },
  { name:'黄金',     code:'sh518880' }
];

/* ============================================================
   一·四、趋势右侧配置（合并所有ETF去重，扫描全市场趋势机会）
   筛选条件：站上MA20 且 MA20向上 → 右侧交易信号
   ============================================================ */
var TREND_CONFIG = (function() {
  var map = {};
  var list = [];
  function add(name, code, category) {
    if (!map[code]) {
      map[code] = true;
      list.push({ name: name, code: code, category: category });
    }
  }
  // 行业ETF
  INDUSTRY_CONFIG.forEach(function(d) { add(d.name, d.code, '行业'); });
  // 进攻线ETF
  ROTATION_CONFIG.attack.forEach(function(d) { add(d.name, d.code, '进攻'); });
  // 防御线ETF
  ROTATION_CONFIG.defense.forEach(function(d) { add(d.name, d.code, '防御'); });
  // 全球大类资产
  MOMENTUM_CONFIG.forEach(function(d) { add(d.name, d.code, '全球'); });
  // 行业板块代表ETF
  BASE_DATA.sectors.forEach(function(s) {
    if (s.etfCode) add(s.name + 'ETF', s.etfCode, '板块');
  });
  return list;
})();


/* ============================================================
   冻结配置对象，防止运行时意外修改
   ============================================================ */
if (typeof Object.freeze === 'function') {
  Object.freeze(BASE_DATA);
  Object.freeze(BASE_DATA.indices);
  Object.freeze(BASE_DATA.sectors);
  Object.freeze(BASE_DATA.overview);
  Object.freeze(ROTATION_CONFIG);
  Object.freeze(ROTATION_CONFIG.attack);
  Object.freeze(ROTATION_CONFIG.defense);
  Object.freeze(MOMENTUM_CONFIG);
  Object.freeze(INDUSTRY_CONFIG);
  Object.freeze(TREND_CONFIG);
}
