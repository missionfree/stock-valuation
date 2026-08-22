'use strict';

/* ============================================================
   FIN-Glossary 金融术语通俗弹窗引擎 v1.0
   ------------------------------------------------------------
   需求：所有专业术语（MACD/布林带等）配套 ≤15字 通俗解释弹窗
   机制：任意元素加 data-term="术语" 即可，鼠标悬停/触摸点击/键盘聚焦
   自动弹出气泡。事件委托全局挂载，无需逐个绑定。
   ============================================================ */

var FIN_GLOSSARY = {
  'MACD':       { s: '金叉买、死叉卖的趋势指标', d: '由快慢两条均线的差值构成，DIF上穿DEA叫金叉（看多），下穿叫死叉（看空），零轴是强弱分界。' },
  '布林带':     { s: '股价通道，突破上下轨看强弱', d: '以20日均线为中轨，加减2倍标准差形成上下轨。股价贴下轨偏弱、突破上轨偏强。' },
  'BOLL':       { s: '布林带别称，见"布林带"', d: 'Bollinger Bands，衡量波动区间的通道指标。' },
  'MA20':       { s: '近20日平均成本线', d: '20日均线，代表近一个月买入者的平均持仓成本，是中线趋势的生命线。' },
  '20日均线':   { s: '近20日平均成本线', d: '同上，站上高于它偏强，跌破偏弱。' },
  'MA5':        { s: '近5日平均成本线', d: '5日均线，反映极短期趋势，常与MA20配合判断多空。' },
  'MA60':       { s: '近60日平均成本线', d: '60日均线，代表季度级别趋势，是长线牛熊分界。' },
  '金叉':       { s: '短线上穿长线，看多', d: '短期均线（或DIF）由下向上穿越长期均线（或DEA），是常见买入信号。' },
  '死叉':       { s: '短线下穿长线，看空', d: '短期均线（或DIF）由上向下穿越长期均线（或DEA），是常见卖出信号。' },
  '零轴':       { s: 'MACD多空分界线', d: 'MACD指标里数值为0的水平线，DIF在零轴上方为多头市，下方为空头市。' },
  '顶背离':     { s: '价新高，指标走低=见顶', d: '股价创新高但MACD等指标高点却在降低，预示上涨动能衰竭，谨防回落。' },
  '底背离':     { s: '价新低，指标走高=见底', d: '股价创新低但MACD等指标低点却在抬高，预示下跌动能衰竭，或有反弹。' },
  '量比':       { s: '今日均量÷近5日均量', d: '衡量当日成交活跃度，大于1放量、小于1缩量，常配合涨跌判断真假。' },
  '换手率':     { s: '当日成交占流通盘比例', d: '越高说明筹码换手越充分，个股越活跃，也需警惕过度炒作。' },
  '市盈率':     { s: '股价÷每股盈利，越低越便宜', d: 'PE，衡量多少年回本，通常越低估值越有优势，但要结合成长性看。' },
  'PE':         { s: '市盈率，见"市盈率"', d: 'Price/Earnings，常用估值指标。' },
  '市净率':     { s: '股价÷每股净资产', d: 'PB，衡量相对净资产的贵贱，银行地产等重资产行业常看PB。' },
  'PB':         { s: '市净率，见"市净率"', d: 'Price/Book，常用估值指标。' },
  '股息率':     { s: '每股分红÷股价', d: '买入一年可获分红的收益率，越高代表分红越慷慨。' },
  '主力净流入': { s: '大单买入额−卖出额', d: '用成交单的大小近似判断主力资金方向，净流入为正说明大资金在买。' },
  '涨停':       { s: '单日涨到交易上限', d: '主板涨10%、创业板科创板涨20%即涨停，代表做多情绪极强。' },
  '跌停':       { s: '单日跌到交易下限', d: '主板跌10%、创业板科创板跌20%即跌停，代表抛压极重。' },
  'KDJ':        { s: '超买超卖的摆动指标', d: '随机指标，80以上超买、20以下超卖，金叉死叉辅助判断拐点。' },
  'RSI':        { s: '相对强弱，70上超买', d: '0-100摆动，70以上超买、30以下超卖，衡量近期涨跌力量对比。' },
  'ATR':        { s: '平均真实波幅，衡量波动', d: 'Average True Range，值越大代表日内波动越剧烈，常用于设止损。' },
  '均线多头排列': { s: '短均线在上，趋势向好', d: 'MA5>MA10>MA20>MA60 依次排列，是典型的上升趋势结构。' },
  '支撑位':     { s: '下跌难跌破的价位', d: '前期低点或密集成交区，股价跌到此处往往获得买盘支撑。' },
  '压力位':     { s: '上涨难突破的价位', d: '前期高点或密集套牢区，股价涨到此处往往遇阻回落。' },
  '缩量':       { s: '成交减少，观望情绪浓', d: '成交量比近期明显减少，说明买卖双方都谨慎，多空僵持。' },
  '放量':       { s: '成交放大，资金活跃', d: '成交量比近期明显放大，说明有资金进场或出逃，方向更可信。' },
  '恐慌贪婪指数': { s: '情绪0-100，越低越恐慌', d: '综合市场多个指标量化情绪，低位=恐惧（或可逆势布局），高位=贪婪（谨防过热）。' },
  '择时':       { s: '选择买卖时机', d: '在合适的时间点进出场，与"选股"相对，解决"何时买何时卖"。' },
  '回踩':       { s: '涨后回落测试支撑', d: '上涨途中股价缩量回落至均线或支撑位，企稳后是较好的低吸点。' },
  '突破':       { s: '放量站上关键价位', d: '股价放量上穿压力位或平台高点，常是新一轮上涨的起点。' },
  'ETF':        { s: '跟踪指数的场内基金', d: '像买股票一样买卖，一篮子持有成分股，分散风险、交易灵活。' },
  '分位':       { s: '当前估值在历史中的位置', d: '百分位，如70%分位表示当前比历史70%的时间都贵，越低越有吸引力。' },
  'ROE':        { s: '净资产收益率，赚钱能力', d: '衡量每1元净资产能赚多少钱，长期高ROE是优质公司的标志。' }
};

var FIN_GLOSSARY_ALIASES = {
  'boll': '布林带', 'ma20': 'MA20', 'ma5': 'MA5', 'ma60': 'MA60',
  'pe': 'PE', 'pb': 'PB', 'kdj': 'KDJ', 'rsi': 'RSI', 'atr': 'ATR',
  'roe': 'ROE', 'etf': 'ETF', 'macd': 'MACD', '20日线': 'MA20', '60日线': 'MA60'
};

var _finTipEl = null;
var _finTipTimer = null;

function finGlossaryLookup(term) {
  if (!term) return null;
  if (FIN_GLOSSARY[term]) return { key: term, plain: FIN_GLOSSARY[term].s, full: FIN_GLOSSARY[term].d };
  var alias = FIN_GLOSSARY_ALIASES[term];
  if (alias) return finGlossaryLookup(alias);
  return null;
}

function finTipShow(term, anchor) {
  var g = finGlossaryLookup(term);
  if (!g) return;
  if (!_finTipEl) {
    _finTipEl = document.createElement('div');
    _finTipEl.className = 'fin-term-tip';
    _finTipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(_finTipEl);
  }
  _finTipEl.innerHTML = '<div class="fin-term-tip-term">' + escHTML(g.key) + '</div>' +
    '<div class="fin-term-tip-plain">' + escHTML(g.plain) + '</div>' +
    '<div class="fin-term-tip-full">' + escHTML(g.full) + '</div>';
  _finTipEl.dataset.active = '1';

  var rect = anchor.getBoundingClientRect();
  var tw = _finTipEl.offsetWidth || 220;
  var th = _finTipEl.offsetHeight || 90;
  var left = rect.left + rect.width / 2 - tw / 2;
  var top = rect.top - th - 8;
  var vw = window.innerWidth || document.documentElement.clientWidth;
  var vh = window.innerHeight || document.documentElement.clientHeight;
  if (left < 8) left = 8;
  if (left + tw > vw - 8) left = vw - tw - 8;
  if (top < 8) top = rect.bottom + 8;   /* 上方放不下 → 放下方 */
  if (top + th > vh - 8) top = vh - th - 8;
  _finTipEl.style.left = left + 'px';
  _finTipEl.style.top = top + 'px';
}

function finTipHide() {
  if (_finTipEl) _finTipEl.dataset.active = '';
}

/** 查找触发元素（含自身与父级） */
function _finTermAnchor(el) {
  var node = el;
  while (node && node !== document.body) {
    if (node.getAttribute && node.getAttribute('data-term')) return node;
    node = node.parentElement;
  }
  return null;
}

function finGlossaryInit() {
  /* 鼠标悬停（桌面） */
  document.addEventListener('mouseover', function(e) {
    var a = _finTermAnchor(e.target);
    if (!a) { finTipHide(); return; }
    clearTimeout(_finTipTimer);
    _finTipTimer = setTimeout(function() { finTipShow(a.getAttribute('data-term'), a); }, 120);
  });
  document.addEventListener('mouseout', function(e) {
    if (e.relatedTarget && _finTermAnchor(e.relatedTarget)) return;
    clearTimeout(_finTipTimer);
    finTipHide();
  });
  /* 触摸点击（移动） */
  document.addEventListener('click', function(e) {
    var a = _finTermAnchor(e.target);
    if (!a) { finTipHide(); return; }
    finTipShow(a.getAttribute('data-term'), a);
  });
  /* 键盘聚焦（可达性） */
  document.addEventListener('focusin', function(e) {
    var a = _finTermAnchor(e.target);
    if (a) finTipShow(a.getAttribute('data-term'), a);
  });
  document.addEventListener('focusout', function(e) {
    if (!_finTermAnchor(e.relatedTarget)) finTipHide();
  });
  /* 滚动/缩放时收起 */
  window.addEventListener('scroll', function() { finTipHide(); }, true);
  window.addEventListener('resize', function() { finTipHide(); });
}

/* 脚本 defer 执行，DOM 已就绪，直接初始化 */
finGlossaryInit();