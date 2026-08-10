'use strict';

/* ============================================================
   十一·五、K线获取与轮动计算
   数据源：主源 ifzq.gtimg.cn → 备源 web.ifzq.gtimg.cn（自动故障转移，均支持CORS）
   策略：localStorage持久缓存(24h) + 内存缓存 + 并发控制(2) + 按需加载
   彻底消除高频爬取：每个代码每天最多请求1次
   ============================================================ */

/* --- 双层缓存：内存(秒级) + localStorage(天级) --- */
var _klineCache = {};        // 内存缓存（本次会话内）
var _klineCacheTime = {};
var MEM_CACHE_TTL = 30 * 60 * 1000;       // 内存缓存30分钟
var LS_CACHE_TTL  = 24 * 60 * 60 * 1000;  // localStorage缓存24小时（非交易时段，日K数据不变）
var LS_CACHE_TTL_TRADING = 10 * 60 * 1000; // 交易时段内LS缓存10分钟（提高盘中数据敏锐度）
var LS_KEY_PREFIX = 'kline_';             // localStorage键前缀

/**
 * 判断当前是否在交易时段（周一至周五 9:25-15:05）
 * 交易时段内缓存使用短TTL，非交易时段使用长TTL
 * @returns {boolean}
 */
function isInTradingSession() {
  var now = new Date();
  var day = now.getDay(); // 0=周日, 6=周六
  if (day === 0 || day === 6) return false; // 周末非交易
  var minutes = now.getHours() * 60 + now.getMinutes();
  return minutes >= 9 * 60 + 25 && minutes < 15 * 60 + 5; // 9:25 - 15:05
}
var _klineKeyRegistry = null;             // K线缓存键注册表（惰性初始化，避免全量扫描localStorage）

/**
 * 获取K线缓存键注册表（惰性初始化）
 * 首次调用扫描localStorage，后续从内存读取
 */
function _getKlineKeyRegistry() {
  if (_klineKeyRegistry) return _klineKeyRegistry;
  _klineKeyRegistry = [];
  try {
    var keys = Object.keys(localStorage);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].indexOf(LS_KEY_PREFIX) === 0) _klineKeyRegistry.push(keys[i]);
    }
  } catch(e) {}
  return _klineKeyRegistry;
}

/**
 * 注册K线缓存键
 */
function _registerKlineKey(key) {
  var reg = _getKlineKeyRegistry();
  if (reg.indexOf(key) === -1) reg.push(key);
}

/**
 * 从localStorage读取缓存的K线数据
 * @param {string} cacheKey
 * @returns {object|null}
 */
function _getLSCache(cacheKey) {
  try {
    var raw = localStorage.getItem(LS_KEY_PREFIX + cacheKey);
    if (!raw) return null;
    var obj = JSON.parse(raw);
    // 交易时段内使用短TTL（10分钟），非交易时段使用长TTL（24小时）
    var ttl = isInTradingSession() ? LS_CACHE_TTL_TRADING : LS_CACHE_TTL;
    if (Date.now() - obj.ts > ttl) return null; // 过期
    return obj.data;
  } catch(e) { return null; }
}

/**
 * 写入K线数据到localStorage
 */
function _setLSCache(cacheKey, data) {
  try {
    var fullKey = LS_KEY_PREFIX + cacheKey;
    localStorage.setItem(fullKey, JSON.stringify({ ts: Date.now(), data: data }));
    _registerKlineKey(fullKey);
  } catch(e) { /* localStorage满或不可用，静默忽略 */ }
}

/**
 * 清除K线缓存（内存+localStorage）
 * 仅在用户手动"强制刷新K线"时调用
 */
function clearKlineCache() {
  _klineCache = {};
  _klineCacheTime = {};
  // 从注册表清除K线缓存（避免全量扫描localStorage）
  try {
    var keys = _getKlineKeyRegistry();
    keys.forEach(function(k) { localStorage.removeItem(k); });
    _klineKeyRegistry = []; // 重置注册表
  } catch(e) {}
}

/**
 * 获取K线最后更新时间（用于UI状态显示）
 * @returns {string} 如 "7/24 15:30" 或空字符串
 */
function getKlineLastUpdate() {
  try {
    var keys = _getKlineKeyRegistry();
    if (keys.length === 0) return '';
    var latest = 0;
    keys.forEach(function(k) {
      var raw = localStorage.getItem(k);
      if (raw) {
        var obj = JSON.parse(raw);
        if (obj.ts > latest) latest = obj.ts;
      }
    });
    if (latest === 0) return '';
    var d = new Date(latest);
    return (d.getMonth()+1) + '/' + d.getDate() + ' ' +
           String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  } catch(e) { return ''; }
}

/* --- 并发控制（分层顺序获取：2并发+请求间延迟，防封禁） --- */
var _activeKline = 0;
var _klineQueue = [];
var MAX_CONCURRENT_KLINE = 4;         // 4并发：提升速度，同时保持合理防封
var _klineBatchDelay = 150;           // 每批之间延迟150ms（优化后更流畅）
var KLINE_REQ_TIMEOUT = 2500;         // 单个K线请求超时2.5秒（优化后更及时）
var KLINE_TOTAL_TIMEOUT = 45000;      // 分层获取总超时45秒（优化后更及时）

/* --- 全局防封禁：请求频率限制 --- */
var _lastFullFetchTime = 0;           // 上次完整获取的时间戳
var FULL_FETCH_COOLDOWN = 30 * 1000;  // 最小间隔30秒，防止频繁请求被封IP
var _isFetching = false;              // 是否正在获取中（防止重复点击）

/**
 * 获取日K线数据（带双层缓存+并发控制+三源自动切换）
 * 主源: 腾讯ifzq.gtimg.cn(fetch) → 备源: web.ifzq.gtimg.cn(fetch) → 最终备用: 东方财富(JSONP)
 * @param {string} tencentCode - 腾讯代码，如 sh510300
 * @param {number} count - K线条数
 * @returns {Promise} resolve({dates:[], closes:[], klines:[]}) 或 reject
 */
function fetchKline(tencentCode, count) {
  count = count || 100;
  var cacheKey = tencentCode + '_' + count;

  // 1. 命中内存缓存（30分钟内）
  if (_klineCache[cacheKey] && (Date.now() - _klineCacheTime[cacheKey] < MEM_CACHE_TTL)) {
    return Promise.resolve(_klineCache[cacheKey]);
  }

  // 2. 命中localStorage缓存（24小时内，日K数据天内不变）
  var lsData = _getLSCache(cacheKey);
  if (lsData) {
    _klineCache[cacheKey] = lsData;       // 回填内存缓存
    _klineCacheTime[cacheKey] = Date.now();
    return Promise.resolve(lsData);
  }

  // 3. 进入并发队列（最多同时2个请求）
  return new Promise(function(resolve, reject) {
    _klineQueue.push({
      code: tencentCode, count: count, cacheKey: cacheKey,
      resolve: resolve, reject: reject, retries: 0
    });
    _drainKlineQueue();
  });
}

/* 处理队列中的待发请求（带批处理延迟，防封禁） */
var _klineDrainScheduled = false;
function _drainKlineQueue() {
  if (_klineDrainScheduled) return;
  if (_activeKline >= MAX_CONCURRENT_KLINE || _klineQueue.length === 0) return;

  _klineDrainScheduled = true;
  Perf.trackedSetTimeout(function() {
    _klineDrainScheduled = false;
    while (_activeKline < MAX_CONCURRENT_KLINE && _klineQueue.length > 0) {
      var job = _klineQueue.shift();
      _activeKline++;
      _execKlineJob(job);
    }
  }, _klineBatchDelay);
}

/* 实际发送单个K线请求（三源递进：腾讯主域fetch → 腾讯web子域fetch → 东方财富JSONP） */
function _execKlineJob(job) {
  var phase = job.phase || 0;
  if (phase < 2) {
    // 阶段0/1: 腾讯fetch（CORS友好，最稳定）
    _tryTencentKline(job);
  } else {
    // 阶段2: 东方财富JSONP（最终备用）
    _tryEmKline(job);
  }
}

/* 东方财富K线JSONP（最终备用源） */
function _tryEmKline(job) {
  var emSecid = _tencentToEmSecid(job.code);
  if (!emSecid) {
    _finishKlineJob(job, null, new Error('无可用数据源'));
    return;
  }
  var emUrl = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=' + emSecid +
    '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58&klt=101&fqt=1&end=20500101&lmt=' + job.count;
  emJsonp(emUrl, KLINE_REQ_TIMEOUT).then(function(d) {
    var kArr = d && d.data && d.data.klines;
    if (!kArr || kArr.length === 0) throw new Error('东方财富无K线数据');
    // 过滤无效数据（收盘价为NaN/0/负数的条目）
    var validArr = kArr.filter(function(k) {
      var parts = k.split(',');
      var c = parseFloat(parts[2]);
      return !isNaN(c) && c > 0;
    });
    if (validArr.length === 0) throw new Error('东方财富K线数据全无效');
    var result = {
      dates: validArr.map(function(k) { return k.split(',')[0]; }),
      closes: validArr.map(function(k) { return parseFloat(k.split(',')[2]); }),
      klines: validArr.map(function(k) { return k.split(','); })
    };
    _klineCache[job.cacheKey] = result;
    _klineCacheTime[job.cacheKey] = Date.now();
    _setLSCache(job.cacheKey, result);
    _finishKlineJob(job, result);
  }).catch(function(err) {
    console.warn('东方财富K线JSONP也失败:', job.code, err.message);
    _finishKlineJob(job, null, err);
  });
}

/* 腾讯代码转东方财富secid */
function _tencentToEmSecid(tencentCode) {
  if (!tencentCode) return null;
  if (tencentCode.indexOf('sh') === 0) return '1.' + tencentCode.substring(2);
  if (tencentCode.indexOf('sz') === 0) return '0.' + tencentCode.substring(2);
  if (tencentCode.indexOf('hk') === 0) {
    var hkCode = tencentCode.substring(2);
    if (hkCode === 'HSI') return '100.HSI';
    if (hkCode === 'HSTECH') return '100.HSTECH';
    if (hkCode === 'HSCEI') return '100.HSCEI';
    return '100.' + hkCode;
  }
  if (tencentCode.indexOf('us') === 0) {
    var usCode = tencentCode.substring(3);
    if (usCode === 'IXIC') return '100.IXIC';
    return '100.' + usCode;
  }
  return null;
}

/* 腾讯K线fetch（主源/备用源） */
function _tryTencentKline(job) {
  var useBackup = (job.phase || 0) >= 1;
  var baseUrl = useBackup
    ? 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param='
    : 'https://ifzq.gtimg.cn/appstock/app/fqkline/get?param=';
  var url = baseUrl + job.code + ',day,,,' + job.count + ',qfq';

  fetchWithTimeout(url, { cache: 'no-store' }, KLINE_REQ_TIMEOUT).then(function(res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }).then(function(d) {
    var kObj = d && d.data && d.data[job.code];
    if (!kObj) throw new Error('腾讯数据格式异常');
    var arr = kObj.qfqday || kObj.day || [];
    if (arr.length === 0) throw new Error('腾讯无K线数据');
    // 过滤无效数据（收盘价为NaN/0/负数的条目）
    var validArr = arr.filter(function(k) {
      var c = parseFloat(k[2]);
      return !isNaN(c) && c > 0;
    });
    if (validArr.length === 0) throw new Error('腾讯K线数据全无效');
    var result = {
      dates: validArr.map(function(k) { return k[0]; }),
      closes: validArr.map(function(k) { return parseFloat(k[2]); }),
      klines: validArr
    };
    // 写入双层缓存
    _klineCache[job.cacheKey] = result;
    _klineCacheTime[job.cacheKey] = Date.now();
    _setLSCache(job.cacheKey, result);
    _finishKlineJob(job, result);
  }).catch(function(err) {
    // 当前源失败 → 推进到下一阶段
    job.phase = (job.phase || 0) + 1;
    console.warn('K线源' + job.phase + '失败:', job.code, err.message);
    if (job.phase <= 2) {
      // 还有备用源可用，短暂延迟后重新入队
      Perf.trackedSetTimeout(function() {
        _activeKline--;
        _activeKline = Math.max(0, _activeKline);
        _klineQueue.unshift(job);
        _drainKlineQueue();
      }, 100);
    } else {
      // 所有源都失败
      _finishKlineJob(job, null, err);
    }
  });
}

/* 单个K线任务完成 */
function _finishKlineJob(job, result, err) {
  _activeKline--;
  _activeKline = Math.max(0, _activeKline);
  if (err) { job.reject(err); }
  else { job.resolve(result); }
  _drainKlineQueue();
}

/**
 * 计算简单移动平均线（返回最后一个值）
 * @param {number[]} closes - 收盘价数组（时间正序）
 * @param {number} period - 周期
 * @returns {number|null}
 */
function calcMA(closes, period) {
  if (closes.length < period) return null;
  var sum = 0;
  for (var i = closes.length - period; i < closes.length; i++) {
    sum += closes[i];
  }
  return sum / period;
}

/**
 * 计算N日涨幅百分比
 * @param {number[]} closes - 收盘价数组
 * @param {number} days - 天数
 * @returns {number|null} 涨幅百分比（如 5.23 表示+5.23%）
 */
function calcChange(closes, days) {
  if (closes.length < days + 1) return null;
  var current = closes[closes.length - 1];
  var past = closes[closes.length - 1 - days];
  if (!past) return null;
  return ((current - past) / past) * 100;
}

/**
 * 计算近N日的最大回撤（%）
 * 从最近20个交易日内找最高点到最低点的最大跌幅
 */
function calcMaxDrawdown(closes, lookback) {
  lookback = lookback || 20;
  if (closes.length < 2) return null;
  var slice = closes.slice(-lookback);
  var peak = slice[0];
  var maxDD = 0;
  for (var i = 1; i < slice.length; i++) {
    if (slice[i] > peak) peak = slice[i];
    var dd = ((peak - slice[i]) / peak) * 100;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

/**
 * 计算布林带（Bollinger Bands）
 * @param {number[]} closes - 收盘价数组
 * @param {number} period - 周期（默认20）
 * @param {number} mult - 标准差倍数（默认2）
 * @returns {{upper:number, middle:number, lower:number, pctB:number}|null}
 *   pctB = (price - lower) / (upper - lower)，0~1表示在中轨和上轨之间
 */
function calcBollinger(closes, period, mult) {
  period = period || 20;
  mult = mult || 2;
  if (!closes || closes.length < period) return null;
  var slice = closes.slice(-period);
  var ma = slice.reduce(function(a, b) { return a + b; }, 0) / period;
  var variance = 0;
  for (var i = 0; i < slice.length; i++) {
    variance += Math.pow(slice[i] - ma, 2);
  }
  var std = Math.sqrt(variance / period);
  var upper = ma + mult * std;
  var lower = ma - mult * std;
  var price = closes[closes.length - 1];
  var bandwidth = upper - lower;
  var pctB = bandwidth > 0 ? (price - lower) / bandwidth : 0.5;
  return { upper: upper, middle: ma, lower: lower, pctB: pctB, bandwidth: bandwidth };
}

/**
 * 计算MACD指标
 * @param {number[]} closes - 收盘价数组
 * @param {number} fast - 快线周期（默认12）
 * @param {number} slow - 慢线周期（默认26）
 * @param {number} signalP - 信号线周期（默认9）
 * @returns {{dif:number, dea:number, hist:number, histTrend:number}|null}
 *   histTrend: 1=柱状体放大，-1=柱状体收窄，0=数据不足
 */
function calcMACD(closes, fast, slow, signalP) {
  fast = fast || 12;
  slow = slow || 26;
  signalP = signalP || 9;
  if (!closes || closes.length < slow + signalP) return null;

  // EMA：接收完整data数组，从索引0开始迭代到底，返回最后一个EMA值
  function ema(data, period) {
    var k = 2 / (period + 1);
    var e = data[0];
    for (var i = 1; i < data.length; i++) {
      e = data[i] * k + e * (1 - k);
    }
    return e;
  }

  // 在完整序列上计算每个时点的EMA，返回与data等长的EMA序列（不再slice截断）
  function emaFullSeries(data, period) {
    var k = 2 / (period + 1);
    var series = [];
    var e = data[0];
    series.push(e);
    for (var i = 1; i < data.length; i++) {
      e = data[i] * k + e * (1 - k);
      series.push(e);
    }
    return series;
  }

  // 1. 完整序列的快慢EMA → 2. 完整DIF序列
  var emaFastArr = emaFullSeries(closes, fast);
  var emaSlowArr = emaFullSeries(closes, slow);
  var difSeries = [];
  for (var i = 0; i < closes.length; i++) {
    difSeries.push(emaFastArr[i] - emaSlowArr[i]);
  }

  // 3. 用完整DIF序列计算DEA（DIF的signalP日EMA，取最后一个值）
  var dif = difSeries[difSeries.length - 1];
  var dea = ema(difSeries, signalP);
  // 4. hist = 2 * (DIF - DEA)
  var hist = 2 * (dif - dea);

  // 5. histTrend：比较最后两个hist值（最后hist < 前一个hist = 收窄 = -1）
  var histTrend = 0;
  if (difSeries.length >= 2) {
    var prevDif = difSeries[difSeries.length - 2];
    var prevDea = ema(difSeries.slice(0, difSeries.length - 1), signalP);
    var prevHist = 2 * (prevDif - prevDea);
    histTrend = hist < prevHist ? -1 : 1;
  }

  return { dif: dif, dea: dea, hist: hist, histTrend: histTrend };
}

/**
 * 计算成交量强度（连续放量判断）
 * @param {Array} klines - K线数据 [日期, 开, 收, 高, 低, 成交量]
 * @returns {{consecutiveUp:boolean, volRatio:number, qualified:boolean}|null}
 *   consecutiveUp: 连续3日放量
 *   volRatio: 最近一日量/5日均量
 *   qualified: 连续3日放量且不低于5日均量1.5倍
 */
function calcVolumeStrength(klines) {
  if (!klines || klines.length < 8) return null;
  var vols = klines.slice(-8).map(function(k) { return parseFloat(k[5]) || 0; });
  var recent3 = vols.slice(-3);
  var avg5 = (vols.slice(-8, -3).reduce(function(a, b) { return a + b; }, 0)) / 5;

  if (avg5 <= 0) return null;

  // 最近一日量比
  var volRatio = recent3[2] / avg5;
  // 近3日成交量均值
  var recent3Avg = (recent3[0] + recent3[1] + recent3[2]) / 3;

  // 条件1：近3日中至少2日成交量 > 5日均量的1.2倍
  var above12Count = recent3.filter(function(v) { return v > avg5 * 1.2; }).length;
  var atLeast2Above12 = above12Count >= 2;
  // 条件2：近3日成交量均值 > 5日均量的1.1倍（整体放量）
  var recent3Above11 = recent3Avg > avg5 * 1.1;
  // 近3日整体呈放量趋势：最后一天量 >= 近3日均值（替代旧的严格连续3日递增）
  var consecutiveUp = recent3[2] >= recent3Avg;

  return {
    consecutiveUp: consecutiveUp,
    volRatio: volRatio,
    qualified: atLeast2Above12 && recent3Above11,
    recent3: recent3,
    avg5: avg5
  };
}

/**
 * 计算近5日相对强度（相对于一组标的的排名百分位）
 * @param {number[]} allChanges5d - 所有标的的5日涨幅数组
 * @param {number} myChange5d - 当前标的的5日涨幅
 * @returns {number} 排名百分位（0-100），越高越强
 */
function calcRelativeStrengthRank(allChanges5d, myChange5d) {
  if (!allChanges5d || allChanges5d.length === 0) return 50;
  var sorted = allChanges5d.slice().sort(function(a, b) { return a - b; });
  var rank = 0;
  for (var i = 0; i < sorted.length; i++) {
    if (myChange5d > sorted[i]) rank++;
  }
  return (rank / sorted.length) * 100;
}

/**
 * ============================================================
 * 二次筛选系统：从符合条件的标的中选出最优"可上车"标的
 *
 * 筛选条件（全部满足）：
 * ① 近5日相对强度排名前10%
 * ② 成交量连续3日放大且不低于5日均量1.5倍
 * ③ 当前价格位于20日布林带中轨以上但未触及上轨（pctB 0.5~0.8）
 * ④ 动态回撤率 < 8%
 *
 * 排除规则（任一满足即排除）：
 * ✗ 近3日涨幅 > 15%（追高风险）
 * ✗ MACD柱状体连续收窄（动能衰竭）
 * ============================================================
 */

/**
 * 对一组候选标的执行二次筛选，标注"可上车"
 * @param {Array} candidates - 候选标的数组，每个需包含 {closes, klines, change5d, code, name}
 * @returns {Array} 添加了 secondaryPass 和 canBoard 标志的候选数组
 */
function secondaryScreen(candidates) {
  if (!candidates || candidates.length < 3) return candidates;

  // 收集所有5日涨幅用于相对强度排名
  var allChanges5d = candidates.map(function(c) { return c.change5d || 0; });

  candidates.forEach(function(c) {
    c.secondaryPass = false;
    c.canBoard = false;
    c.screenDetails = null;

    var closes = c.closes;
    var klines = c.klines;

    if (!closes || closes.length < 30) return;

    // ① 近5日相对强度排名前10%
    var rsRank = calcRelativeStrengthRank(allChanges5d, c.change5d || 0);
    var passRS = rsRank >= 90;

    // ② 成交量连续3日放大且不低于5日均量1.5倍
    var volStr = calcVolumeStrength(klines);
    var passVol = volStr && volStr.qualified;

    // ③ 布林带：价格在中轨以上但未触及上轨
    var boll = calcBollinger(closes, 20, 2);
    var passBoll = boll && boll.pctB >= 0.5 && boll.pctB <= 0.85;

    // ④ 动态回撤率 < 8%
    var maxDD = calcMaxDrawdown(closes, 20);
    var passDD = maxDD !== null && maxDD < 8;

    // 排除规则
    // ✗ 近3日涨幅 > 15%
    var change3d = closes.length >= 4 ? ((closes[closes.length - 1] - closes[closes.length - 4]) / closes[closes.length - 4]) * 100 : 0;
    var excludeGain = change3d > 15;

    // ✗ MACD柱状体连续收窄
    var macd = calcMACD(closes);
    var excludeMACD = macd && macd.histTrend === -1;

    c.screenDetails = {
      rsRank: rsRank,
      passRS: passRS,
      volStr: volStr,
      passVol: passVol,
      boll: boll,
      passBoll: passBoll,
      maxDD: maxDD,
      passDD: passDD,
      change3d: change3d,
      excludeGain: excludeGain,
      macd: macd,
      excludeMACD: excludeMACD
    };

    // 全部条件满足且无排除 → 可上车
    c.secondaryPass = passRS && passVol && passBoll && passDD;
    c.canBoard = c.secondaryPass && !excludeGain && !excludeMACD;
  });

  return candidates;
}

/**
 * ============================================================
 * 双线轮动复合评分系统：动量确认 + 回踩入场
 * 
 * 核心理念：不追涨最强的，而是在确认趋势的标的中，
 * 选出回踩到位、入场性价比最高的那个。
 * 
 * 评分维度（满分100）：
 *   A. 趋势确认（0-25）：MA60之上 + 多头排列 + 均线向上
 *   B. 动量强度（0-25）：15日/5日涨幅，但过热扣分
 *   C. 入场质量（0-50）：偏离MA60 + 回踩幅度 + 短期降温
 * 
 * 入场质量占50%权重，确保不会选到涨透的标的。
 * ============================================================
 */
function calcRotationScore(closes) {
  if (!closes || closes.length < 60) return null;

  var n = closes.length;
  var current = closes[n - 1];

  // 均线
  var ma5  = calcMA(closes, 5);
  var ma10 = calcMA(closes, 10);
  var ma20 = calcMA(closes, 20);
  var ma60 = calcMA(closes, 60);
  if (!ma60) return null;

  // MA20在5天前的值（判断均线方向）
  var ma20_5ago = null;
  if (n >= 25) {
    var s = 0;
    for (var i = n - 5 - 20; i < n - 5; i++) s += closes[i];
    ma20_5ago = s / 20;
  }

  // 涨幅
  var change5  = calcChange(closes, 5);
  var change15 = calcChange(closes, 15);

  // 趋势状态
  var aboveMA60 = current > ma60;
  var bullAlign = (ma5 && ma10 && ma20) && (ma5 > ma10 && ma10 > ma20);
  var ma20Up    = ma20_5ago !== null && ma20 > ma20_5ago;
  var ma20Above60 = ma20 && ma60 && (ma20 > ma60);

  // 偏离MA60（%）
  var deviation = ((current - ma60) / ma60) * 100;

  // 近10日最高价（回踩幅度计算）
  var peak10 = current;
  var lookback = Math.min(10, n);
  for (var k = n - lookback; k < n; k++) {
    if (closes[k] > peak10) peak10 = closes[k];
  }
  var pullback = peak10 > 0 ? ((peak10 - current) / peak10) * 100 : 0;

  // ============ A. 趋势确认分（0-25） ============
  var trendScore = 0;
  if (aboveMA60)     trendScore += 10;
  if (bullAlign)     trendScore += 8;
  if (ma20Up)        trendScore += 4;
  if (ma20Above60)   trendScore += 3;
  trendScore = Math.min(25, trendScore);

  // ============ B. 动量强度分（0-25） ============
  var momScore = 0;
  // 15日涨幅：0%→0, 5%→8, 10%→14, 15%+→18（封顶）
  if (change15 !== null) {
    momScore += Math.min(18, Math.max(0, change15 * 1.2));
  }
  // 5日涨幅：0%→0, 3%→4, 5%+→7（封顶）
  if (change5 !== null && change5 > 0) {
    momScore += Math.min(7, change5 * 1.4);
  }
  // 过热惩罚：15日涨幅超过20%，说明已经涨太多
  if (change15 !== null && change15 > 20) {
    momScore -= 5;
  }
  momScore = Math.max(0, Math.min(25, momScore));

  // ============ C. 入场质量分（0-50）= 核心 ============
  var entryScore = 0;

  // C1. 偏离MA60（0-20）
  var devScore = 0;
  if (aboveMA60) {
    if (deviation <= 3)        devScore = 20;  // 贴近MA60，理想入场区
    else if (deviation <= 6)   devScore = 16;
    else if (deviation <= 10)  devScore = 10;
    else if (deviation <= 15)  devScore = 4;
    else                       devScore = 0;    // 严重超买
  }
  entryScore += devScore;

  // C2. 回踩幅度（0-15）
  var pbScore = 0;
  if (pullback >= 3 && pullback <= 7)       pbScore = 15;  // 健康回踩，最佳入场
  else if (pullback >= 1 && pullback < 3)   pbScore = 9;   // 小幅回踩
  else if (pullback >= 7 && pullback <= 10) pbScore = 10;  // 较深回踩
  else if (pullback < 1)                    pbScore = 3;   // 几乎在顶部，追高风险
  else if (pullback > 10)                   pbScore = 5;   // 回踩过深，可能破位
  entryScore += pbScore;

  // C3. 短期降温（0-15）
  var coolScore = 0;
  if (change5 !== null && change15 !== null && change15 > 0) {
    var ratio = change5 / change15;
    if (ratio < 0.33 && change5 > -2)       coolScore = 15;  // 涨势健康放缓
    else if (ratio >= 0.33 && ratio < 0.5)  coolScore = 10;  // 温和
    else if (ratio >= 0.5)                  coolScore = 2;   // 仍在加速，过热
    else if (change5 >= -2 && change5 < 0)  coolScore = 8;   // 微跌回踩
    else if (change5 < -2 && change5 > -5)  coolScore = 5;   // 急跌
    else                                    coolScore = 2;   // 大跌，可能破位
  } else if (change5 !== null && change5 >= -2 && change5 <= 2) {
    coolScore = 10; // 横盘整理
  }
  entryScore += coolScore;

  entryScore = Math.max(0, Math.min(50, entryScore));

  // 总分
  var totalScore = Math.round(trendScore + momScore + entryScore);
  totalScore = Math.max(0, Math.min(100, totalScore));

  // === 风险评级（独立于入场评分，评估持有风险） ===
  // riskLevel: 1=安全 2=关注 3=警戒 4=危险 5=极危
  // riskType: safe / warning / danger
  var riskLevel = 1;
  var riskFactors = [];

  // 偏离MA60过大
  if (aboveMA60) {
    if (deviation > 20)      { riskLevel = Math.max(riskLevel, 5); riskFactors.push('严重超买偏离MA60达' + deviation.toFixed(0) + '%'); }
    else if (deviation > 15) { riskLevel = Math.max(riskLevel, 4); riskFactors.push('高位偏离MA60达' + deviation.toFixed(0) + '%'); }
    else if (deviation > 10) { riskLevel = Math.max(riskLevel, 3); riskFactors.push('偏离MA60 ' + deviation.toFixed(0) + '%'); }
    else if (deviation > 6)  { riskLevel = Math.max(riskLevel, 2); }
  }

  // 涨幅过热
  if (change15 !== null && change15 > 25)      { riskLevel = Math.max(riskLevel, 5); riskFactors.push('15日暴涨' + change15.toFixed(0) + '%，严重过热'); }
  else if (change15 !== null && change15 > 20) { riskLevel = Math.max(riskLevel, 4); riskFactors.push('15日涨幅' + change15.toFixed(0) + '%，短期过热'); }
  else if (change15 !== null && change15 > 15) { riskLevel = Math.max(riskLevel, 3); riskFactors.push('15日涨幅较大(' + change15.toFixed(0) + '%)'); }

  // 5日仍在加速（5日涨幅占15日涨幅50%以上）
  if (change5 !== null && change15 !== null && change15 > 5) {
    if (change5 > change15 * 0.6 && change5 > 5) { riskLevel = Math.max(riskLevel, 4); riskFactors.push('短期仍在加速上涨'); }
    else if (change5 > change15 * 0.5 && change5 > 3) { riskLevel = Math.max(riskLevel, 3); }
  }

  // 几乎无回踩（在顶部）
  if (aboveMA60 && pullback < 0.5 && deviation > 5) { riskLevel = Math.max(riskLevel, 3); riskFactors.push('价格持续在高位无回踩'); }

  // 急跌信号
  if (change5 !== null && change5 < -5) { riskLevel = Math.max(riskLevel, 4); riskFactors.push('5日急跌' + change5.toFixed(1) + '%'); }
  else if (change5 !== null && change5 < -3) { riskLevel = Math.max(riskLevel, 3); }

  // 跌破MA60
  if (!aboveMA60) { riskLevel = 5; riskFactors = ['已跌破MA60，趋势破位']; }

  // 风险类型
  var riskType, riskLabel, riskDesc;
  if (riskLevel >= 4) {
    riskType = 'danger';
    riskLabel = riskLevel >= 5 ? '极高风险' : '高风险';
    riskDesc = riskLevel >= 5 ? '建议立即减仓/清仓' : '建议分批减仓，锁定利润';
  } else if (riskLevel >= 3) {
    riskType = 'warning';
    riskLabel = '风险警戒';
    riskDesc = '注意控制仓位，设好止盈止损线';
  } else if (riskLevel >= 2) {
    riskType = 'warning';
    riskLabel = '需关注';
    riskDesc = '趋势尚可，留意短期波动';
  } else {
    riskType = 'safe';
    riskLabel = '风险较低';
    riskDesc = '趋势健康，安全边际充足';
  }

  // === 信号判断（结合入场评分+风险评级） ===
  var signal, signalCls;
  if (!aboveMA60) {
    signal = '暂退出';
    signalCls = 'exit';
  } else if (riskLevel >= 5) {
    signal = '该跑了';
    signalCls = 'sell';
  } else if (riskLevel >= 4) {
    signal = '建议减仓';
    signalCls = 'reduce';
  } else if (riskLevel >= 3) {
    signal = '逢高减仓';
    signalCls = 'reduce';
  } else if (entryScore >= 35 && totalScore >= 65) {
    signal = '优选入场';
    signalCls = 'buy';
  } else if (totalScore >= 50) {
    signal = '可持有';
    signalCls = 'hold';
  } else {
    signal = '等待回踩';
    signalCls = 'wait';
  }

  // 风险/优势标签
  var tags = [];
  if (deviation <= 3 && aboveMA60)       tags.push({ text: '贴近支撑', cls: 'good' });
  if (pullback >= 3 && pullback <= 7)    tags.push({ text: '回踩到位', cls: 'good' });
  if (coolScore >= 12)                   tags.push({ text: '涨势放缓', cls: 'good' });
  if (bullAlign)                         tags.push({ text: '多头排列', cls: 'good' });
  if (deviation > 10)                    tags.push({ text: '高位偏离' + deviation.toFixed(0) + '%', cls: 'risk' });
  if (pullback < 1 && aboveMA60)         tags.push({ text: '追高风险', cls: 'risk' });
  if (change15 !== null && change15 > 20) tags.push({ text: '短期过热', cls: 'risk' });
  if (change5 !== null && change5 < -5)  tags.push({ text: '急跌警示', cls: 'risk' });

  return {
    score: totalScore,
    signal: signal,
    signalCls: signalCls,
    breakdown: { trend: trendScore, momentum: momScore, entry: entryScore,
                 devScore: devScore, pbScore: pbScore, coolScore: coolScore },
    riskLevel: riskLevel,
    riskType: riskType,
    riskLabel: riskLabel,
    riskDesc: riskDesc,
    riskFactors: riskFactors,
    ma5: ma5, ma10: ma10, ma20: ma20, ma60: ma60,
    change5: change5, change15: change15,
    deviation: deviation, pullback: pullback,
    aboveMA60: aboveMA60, bullAlign: bullAlign, ma20Up: ma20Up,
    current: current, peak10: peak10,
    tags: tags
  };
}

/**
 * 分析单条轮动线（进攻/防御），使用复合评分系统选出最佳入场标的
 * @param {Array} etfList - ETF配置数组 [{name, code}]
 * @returns {Promise} resolve({results:[], pick:obj|null, allBroke:boolean})
 */
function analyzeRotationLine(etfList) {
  var promises = etfList.map(function(etf) {
    return fetchKline(etf.code, 100).then(function(kd) {
      if (!kd || kd.closes.length < 60) {
        return { name: etf.name, code: etf.code, error: true,
                 aboveMA60: null, change15: null };
      }
      var sc = calcRotationScore(kd.closes);
      if (!sc) {
        return { name: etf.name, code: etf.code, error: true,
                 aboveMA60: null, change15: null };
      }
      return {
        name: etf.name, code: etf.code, error: false,
        aboveMA60: sc.aboveMA60,
        ma60: sc.ma60, current: sc.current,
        change5: sc.change5, change15: sc.change15,
        score: sc.score,
        signal: sc.signal, signalCls: sc.signalCls,
        breakdown: sc.breakdown,
        deviation: sc.deviation, pullback: sc.pullback,
        bullAlign: sc.bullAlign, ma20Up: sc.ma20Up,
        peak10: sc.peak10,
        tags: sc.tags,
        lastDate: kd.dates[kd.dates.length - 1]
      };
    }).catch(function() {
      return { name: etf.name, code: etf.code, error: true,
               aboveMA60: null, change15: null };
    });
  });
  return Promise.all(promises).then(function(results) {
    // 筛选站上60日线的（趋势确认）
    var valid = results.filter(function(r) { return !r.error && r.aboveMA60 === true; });
    // 按复合评分降序排列（不再纯按15日涨幅）
    valid.sort(function(a, b) {
      return (b.score || 0) - (a.score || 0);
    });

    // 二次筛选：当符合条件的标的≥3个时，执行多维度筛选标注"可上车"
    if (valid.length >= 3) {
      // 为每个有效标的附加K线数据用于技术分析
      var screenCandidates = valid.map(function(v) {
        return {
          code: v.code,
          name: v.name,
          closes: v._closes || null,
          klines: v._klines || null,
          change5d: v.change5 || 0
        };
      });
      // 异步获取K线数据用于二次筛选
      return Promise.all(screenCandidates.map(function(c) {
        if (c.closes) return Promise.resolve(c);
        return fetchKline(c.code, 60).then(function(kd) {
          if (kd) { c.closes = kd.closes; c.klines = kd.klines; }
          return c;
        }).catch(function() { return c; });
      })).then(function(candidatesWithData) {
        secondaryScreen(candidatesWithData);
        // 将筛选结果回写到valid数组
        valid.forEach(function(v) {
          var match = candidatesWithData.find(function(c) { return c.code === v.code; });
          if (match) {
            v.canBoard = match.canBoard || false;
            v.secondaryPass = match.secondaryPass || false;
            v.screenDetails = match.screenDetails || null;
          }
        });
        // 优先选择"可上车"标的作为pick
        var boardable = valid.filter(function(v) { return v.canBoard; });
        var pick = (boardable.length > 0 ? boardable[0] : (valid.length > 0 ? valid[0] : null));
        var allBroke = results.every(function(r) {
          return r.error || r.aboveMA60 === false || r.aboveMA60 === null;
        });
        results.sort(function(a, b) {
          if (a.error && !b.error) return 1;
          if (!a.error && b.error) return -1;
          if (a.aboveMA60 && !b.aboveMA60) return -1;
          if (!a.aboveMA60 && b.aboveMA60) return 1;
          // 可上车的排前面
          if (a.canBoard && !b.canBoard) return -1;
          if (!a.canBoard && b.canBoard) return 1;
          return (b.score || 0) - (a.score || 0);
        });
        return { results: results, pick: pick, allBroke: allBroke };
      });
    }

    // 不足3个标的时直接选最高分
    var pick = valid.length > 0 ? valid[0] : null;
    var allBroke = results.every(function(r) {
      return r.error || r.aboveMA60 === false || r.aboveMA60 === null;
    });

    // 对展示结果排序：站上的按评分降序，破位的排后面
    results.sort(function(a, b) {
      if (a.error && !b.error) return 1;
      if (!a.error && b.error) return -1;
      if (a.aboveMA60 && !b.aboveMA60) return -1;
      if (!a.aboveMA60 && b.aboveMA60) return 1;
      return (b.score || 0) - (a.score || 0);
    });

    return { results: results, pick: pick, allBroke: allBroke };
  });
}

/**
 * 渲染单条轮动线
 * @param {string} containerId - 容器元素ID
 * @param {object} lineData - analyzeRotationLine 返回值
 * @param {string} lineType - 'attack' 或 'defense'
 */
function renderRotationLine(containerId, lineData, lineType) {
  var container = document.getElementById(containerId);
  var icon = lineType === 'attack' ? '🚀' : '🛡️';
  var title = lineType === 'attack' ? '进攻线' : '防御线';

  var html = '<div class="rb-title"><span class="rb-icon">' + icon + '</span>' +
    title + '（' + lineData.results.length + '选1 · 动量+回踩评分）</div>';

  // 矩阵表格：ETF | MA60 | 15日涨幅 | 偏离度 | 评分 | 信号
  html += '<table class="rot-matrix">';
  html += '<thead><tr><th>ETF</th><th>MA60</th><th>15日</th><th>偏离</th><th>评分</th><th>信号</th></tr></thead><tbody>';

  lineData.results.forEach(function(r) {
    var rowCls = '';
    var maHtml = '', chgHtml = '', devHtml = '', scoreHtml = '', sigHtml = '';

    if (r.error || r.aboveMA60 === null) {
      rowCls = '';
      maHtml = '<span class="ma-no">—</span>';
      chgHtml = '—'; devHtml = '—'; scoreHtml = '—';
      sigHtml = '<span class="exit-tag">数据不足</span>';
    } else if (r.aboveMA60) {
      rowCls = 'row-ok';
      maHtml = '<span class="etf-ok-icon" style="display:inline-block;vertical-align:middle"></span>';

      // 15日涨幅
      if (r.change15 !== null) {
        var cStr = (r.change15 >= 0 ? '+' : '') + r.change15.toFixed(1) + '%';
        var cColor = r.change15 >= 0 ? '#FF0000' : '#00AA00';
        chgHtml = '<span style="color:' + cColor + ';font-weight:600">' + cStr + '</span>';
      } else { chgHtml = '—'; }

      // 偏离度
      var devVal = r.deviation.toFixed(1) + '%';
      var devCls = r.deviation <= 3 ? 'safe' : (r.deviation <= 10 ? 'ok' : 'risk');
      devHtml = '<span class="rot-dev ' + devCls + '">' + devVal + '</span>';

      // 评分
      var sCls = r.score >= 65 ? 'high' : (r.score >= 50 ? 'mid' : 'low');
      scoreHtml = '<span class="rot-score ' + sCls + '">' + r.score + '</span>';

      // 信号
      if (lineData.pick && r.name === lineData.pick.name) {
        sigHtml = '<span class="star">★推荐</span>';
      } else if (r.signalCls === 'sell') {
        sigHtml = '<span class="rot-signal-sell">' + r.signal + '</span>';
      } else if (r.signalCls === 'reduce') {
        sigHtml = '<span class="rot-signal-reduce">' + r.signal + '</span>';
      } else if (r.signalCls === 'buy') {
        sigHtml = '<span style="color:var(--neon-red);font-size:0.52rem">' + r.signal + '</span>';
      } else if (r.signalCls === 'hold') {
        sigHtml = '<span style="color:var(--neon-yellow);font-size:0.52rem">' + r.signal + '</span>';
      } else {
        sigHtml = '<span style="color:var(--muted);font-size:0.52rem">' + r.signal + '</span>';
      }
    } else {
      rowCls = 'row-broke';
      maHtml = '<span class="etf-broke-icon" style="display:inline-flex;vertical-align:middle">!</span>';
      if (r.change15 !== null) {
        var c2 = (r.change15 >= 0 ? '+' : '') + r.change15.toFixed(1) + '%';
        chgHtml = '<span style="color:#7888a0">' + c2 + '</span>';
      } else { chgHtml = '—'; }
      devHtml = '<span class="rot-dev" style="color:var(--muted)">—</span>';
      scoreHtml = '<span class="rot-score low">' + (r.score || 0) + '</span>';
      sigHtml = '<span class="exit-tag">暂退出</span>';
    }

    html += '<tr class="' + rowCls + '">' +
      '<td>' + r.name + '</td>' +
      '<td>' + maHtml + '</td>' +
      '<td>' + chgHtml + '</td>' +
      '<td>' + devHtml + '</td>' +
      '<td>' + scoreHtml + '</td>' +
      '<td>' + sigHtml + '</td>' +
    '</tr>';
  });

  html += '</tbody></table>';

  // 风险提醒（扫描所有ETF的风险等级，有高风险时突出显示）
  var riskAlerts = [];
  lineData.results.forEach(function(r) {
    if (!r.error && r.riskLevel >= 3) {
      riskAlerts.push(r);
    }
  });
  if (riskAlerts.length > 0) {
    // 按风险等级降序
    riskAlerts.sort(function(a, b) { return (b.riskLevel||0) - (a.riskLevel||0); });
    var maxRisk = riskAlerts[0].riskLevel;
    var maxRiskType = riskAlerts[0].riskType;
    var riskIcon = maxRisk >= 4 ? '🚨' : '⚠️';
    var riskDotCls = maxRiskType;

    html += '<div class="rot-risk-bar ' + maxRiskType + '">';
    html += '<span class="rot-risk-icon">' + riskIcon + '</span>';
    html += '<span class="rot-risk-label">' + riskAlerts[0].riskLabel + '</span>';
    // 风险等级5格
    html += '<span class="rot-risk-dots">';
    for (var di = 1; di <= 5; di++) {
      html += '<span class="rot-risk-dot' + (di <= maxRisk ? ' active ' + riskDotCls : '') + '"></span>';
    }
    html += '</span>';
    // 风险因素描述
    var factorTexts = [];
    riskAlerts.forEach(function(r) {
      if (r.riskFactors && r.riskFactors.length > 0) {
        r.riskFactors.forEach(function(f) {
          if (factorTexts.indexOf(r.name + ':' + f) === -1) {
            factorTexts.push(r.name + ' ' + f);
          }
        });
      }
    });
    var descText = factorTexts.length > 0 ? factorTexts.slice(0, 3).join('；') : riskAlerts[0].riskDesc;
    html += '<span class="rot-risk-desc">' + descText + '</span>';
    html += '</div>';
  }

  // 推荐标的详情卡片
  if (lineData.pick) {
    var p = lineData.pick;
    var bd = p.breakdown || {};
    var pStr = (p.change15 >= 0 ? '+' : '') + p.change15.toFixed(1) + '%';
    var sClsPick = p.score >= 65 ? 'high' : (p.score >= 50 ? 'mid' : 'low');

    html += '<div class="rot-pick-detail">';
    html += '<div class="rot-pick-detail-header">';
    html += '<span class="rot-pick-detail-name">🥇 ' + p.name + '</span>';
    html += '<span class="rot-pick-detail-score rot-score ' + sClsPick + '" style="font-size:0.72rem;padding:0.1rem 0.3rem">' + p.score + '分</span>';
    html += '</div>';

    // 评分维度条
    html += '<div class="rot-score-bar-row">';
    html += '<span class="rot-score-bar-label">趋势确认</span>';
    html += '<div class="rot-score-bar-track"><div class="rot-score-bar-fill trend" style="width:' + ((bd.trend||0)/25*100) + '%"></div></div>';
    html += '<span class="rot-score-bar-val">' + (bd.trend||0) + '/25</span>';
    html += '</div>';

    html += '<div class="rot-score-bar-row">';
    html += '<span class="rot-score-bar-label">动量强度</span>';
    html += '<div class="rot-score-bar-track"><div class="rot-score-bar-fill momentum" style="width:' + ((bd.momentum||0)/25*100) + '%"></div></div>';
    html += '<span class="rot-score-bar-val">' + (bd.momentum||0).toFixed(2) + '/25</span>';
    html += '</div>';

    html += '<div class="rot-score-bar-row">';
    html += '<span class="rot-score-bar-label">入场质量</span>';
    html += '<div class="rot-score-bar-track"><div class="rot-score-bar-fill entry" style="width:' + ((bd.entry||0)/50*100) + '%"></div></div>';
    html += '<span class="rot-score-bar-val">' + (bd.entry||0) + '/50</span>';
    html += '</div>';

    // 关键数据
    html += '<div style="display:flex;gap:0.5rem;margin-top:0.3rem;font-size:0.52rem;color:var(--muted);font-family:var(--font-mono)">';
    html += '<span>15日' + pStr + '</span>';
    html += '<span>偏离MA60 ' + p.deviation.toFixed(1) + '%</span>';
    html += '<span>回踩' + p.pullback.toFixed(1) + '%</span>';
    html += '</div>';

    // 标签
    if (p.tags && p.tags.length > 0) {
      html += '<div class="rot-pick-tags">';
      p.tags.forEach(function(t) {
        html += '<span class="rot-pick-tag ' + t.cls + '">' + t.text + '</span>';
      });
      html += '</div>';
    }

    // 推荐理由
    var reason = buildPickReason(p);
    html += '<div class="rot-pick-reason">' + reason + '</div>';

    // 推荐标的风险评级
    if (p.riskLevel >= 3) {
      var pRiskIcon = p.riskLevel >= 4 ? '🚨' : '⚠️';
      html += '<div class="rot-risk-bar ' + p.riskType + '" style="margin-top:0.3rem">';
      html += '<span class="rot-risk-icon">' + pRiskIcon + '</span>';
      html += '<span class="rot-risk-label">' + p.riskLabel + '</span>';
      html += '<span class="rot-risk-dots">';
      for (var pri = 1; pri <= 5; pri++) {
        html += '<span class="rot-risk-dot' + (pri <= p.riskLevel ? ' active ' + p.riskType : '') + '"></span>';
      }
      html += '</span>';
      html += '<span class="rot-risk-desc">' + p.riskDesc + (p.riskFactors && p.riskFactors.length > 0 ? '：' + p.riskFactors.join('；') : '') + '</span>';
      html += '</div>';
    }

    html += '</div>';
  } else if (lineData.allBroke) {
    html += '<div class="rot-pick hold">🚫 全线破位 ' + title + '暂时持现金</div>';
  } else {
    html += '<div class="rot-pick hold">⏳ 等待数据...</div>';
  }

  container.innerHTML = html;
}

/**
 * 根据评分数据生成推荐理由文案
 */
function buildPickReason(p) {
  var reasons = [];

  // 入场质量分析
  if (p.deviation <= 3) {
    reasons.push('价格贴近MA60支撑，入场安全边际高');
  } else if (p.deviation <= 6) {
    reasons.push('偏离MA60适度，上行空间仍可期');
  } else if (p.deviation > 10) {
    reasons.push('偏离MA60较大(' + p.deviation.toFixed(0) + '%)，注意回调风险');
  }

  // 回踩分析
  if (p.pullback >= 3 && p.pullback <= 7) {
    reasons.push('近10日回踩' + p.pullback.toFixed(1) + '%，处于较好入场区间');
  } else if (p.pullback < 1) {
    reasons.push('近期几乎未回踩，追高需谨慎');
  } else if (p.pullback > 7 && p.pullback <= 10) {
    reasons.push('回踩幅度较深(' + p.pullback.toFixed(1) + '%)，关注是否企稳');
  }

  // 动量分析
  if (p.change15 !== null && p.change15 > 0) {
    if (p.change5 !== null && p.change5 < p.change15 / 3 && p.change5 > -2) {
      reasons.push('5日涨势放缓(vs 15日)，短期降温利于蓄力');
    } else if (p.change5 !== null && p.change5 > p.change15 / 2) {
      reasons.push('短期仍在加速上涨，过热信号');
    }
  }

  // 趋势分析
  if (p.bullAlign) {
    reasons.push('MA5>MA10>MA20多头排列，趋势确认');
  }

  if (reasons.length === 0) {
    reasons.push('综合评分最高，趋势与入场性价比均衡');
  }

  return reasons.join('；') + '。';
}

/**
 * 计算下次调仓日（每周一调仓）
 * 每周检查一次，既不错过趋势启动，又避免频繁换仓增加成本
 * @returns {object} {text: "8月5日(周一)", date: Date, daysLeft: 3}
 */
function getNextRebalanceInfo() {
  var now = new Date();
  now.setHours(0, 0, 0, 0);
  var dayOfWeek = now.getDay(); // 0=周日, 1=周一, ..., 6=周六

  // 计算到下个周一的天数
  var daysToNext;
  if (dayOfWeek === 1) {
    // 今天就是周一，下次调仓是下周一
    daysToNext = 7;
  } else if (dayOfWeek === 0) {
    // 周日，明天就是周一
    daysToNext = 1;
  } else {
    // 周二到周六
    daysToNext = 8 - dayOfWeek;
  }

  var nextDate = new Date(now);
  nextDate.setDate(now.getDate() + daysToNext);

  var msPerDay = 24 * 60 * 60 * 1000;
  var daysLeft = Math.ceil((nextDate - now) / msPerDay);
  var weekDayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  var text = (nextDate.getMonth() + 1) + '月' + nextDate.getDate() + '日(' + weekDayNames[nextDate.getDay()] + ')';

  return { text: text, date: nextDate, daysLeft: daysLeft };
}

/**
 * 计算下次调仓日（每周一调仓）— 兼容旧调用
 * @returns {string} 如 "8月1日"
 */
function getNextRebalanceDate() {
  return getNextRebalanceInfo().text;
}

/**
 * 更新双线轮动数据（主入口）
 */
function updateRotation() {
  // 显示加载状态
  var attackEl = document.getElementById('rotAttack');
  var defenseEl = document.getElementById('rotDefense');
  if (attackEl) attackEl.innerHTML = '<div class="rb-title"><span class="rb-icon">🚀</span>进攻线（' + ROTATION_CONFIG.attack.length + '选1）</div>' +
    '<div style="text-align:center;padding:0.8rem;color:var(--muted);font-size:0.68rem"><span class="spinner" style="width:12px;height:12px;border-width:1.5px"></span> 加载K线数据中...</div>';
  if (defenseEl) defenseEl.innerHTML = '<div class="rb-title"><span class="rb-icon">🛡️</span>防御线（' + ROTATION_CONFIG.defense.length + '选1）</div>' +
    '<div style="text-align:center;padding:0.8rem;color:var(--muted);font-size:0.68rem"><span class="spinner" style="width:12px;height:12px;border-width:1.5px"></span> 加载K线数据中...</div>';

  // 更新日期标签
  var now = new Date();
  var dateStr = (now.getMonth() + 1) + '/' + now.getDate();
  var dateEls = document.querySelectorAll('.rot-date');
  dateEls.forEach(function(el) { el.textContent = dateStr; });

  // 更新下次调仓日 + 倒计时
  var nextDateEl = document.getElementById('rotNextDate');
  if (nextDateEl) {
    var rebInfo = getNextRebalanceInfo();
    var urgencyColor = rebInfo.daysLeft <= 3 ? 'var(--neon-red)' : rebInfo.daysLeft <= 7 ? 'var(--neon-yellow)' : 'var(--neon-yellow)';
    var urgencyShadow = rebInfo.daysLeft <= 3 ? '0 0 8px rgba(255, 0, 0,0.4)' : '0 0 8px rgba(255,215,0,0.3)';
    nextDateEl.innerHTML = '距下次调仓还有 <b style="font-size:0.85rem;color:' + urgencyColor + ';text-shadow:' + urgencyShadow + '">' + rebInfo.daysLeft + '</b> 天 · ' + rebInfo.text +
      '<div style="font-size:0.52rem;color:var(--muted);font-weight:400;margin-top:0.2rem;letter-spacing:0">每周一调仓 · 信号变化自动提醒 · 不错过趋势启动</div>';
  }
  
  // 更新信号更新时间
  var signalTimeEl = document.getElementById('signalUpdateTime');
  if (signalTimeEl) {
    var timeStr = now.getFullYear() + '-' + 
      String(now.getMonth()+1).padStart(2,'0') + '-' +
      String(now.getDate()).padStart(2,'0') + ' ' +
      String(now.getHours()).padStart(2,'0') + ':' +
      String(now.getMinutes()).padStart(2,'0');
    signalTimeEl.textContent = '信号更新于：' + timeStr;
  }

  // 并行获取进攻线和防御线
  return Promise.all([
    analyzeRotationLine(ROTATION_CONFIG.attack),
    analyzeRotationLine(ROTATION_CONFIG.defense)
  ]).then(function(results) {
    renderRotationLine('rotAttack', results[0], 'attack');
    renderRotationLine('rotDefense', results[1], 'defense');

    // 信号变化检测
    checkRotationSignalChange(results[0], results[1]);
  }).catch(function(err) {
    console.warn('轮动更新失败:', err);
  });
}

/**
 * 信号变化检测：比对本次与上次轮动信号，有变化时高亮提醒
 * 使用 localStorage 持久化上次信号，每次刷新页面或点击获取K线时自动比对
 */
function checkRotationSignalChange(attackData, defenseData) {
  var alertEl = document.getElementById('rotSignalAlert');
  if (!alertEl) return;

  // 构建当前信号快照
  var currentSnap = {
    attackPick: attackData.pick ? attackData.pick.name : null,
    attackAllBroke: attackData.allBroke,
    defensePick: defenseData.pick ? defenseData.pick.name : null,
    defenseAllBroke: defenseData.allBroke,
    timestamp: Date.now()
  };

  // 读取上次信号
  var prevSnap = null;
  try {
    var raw = localStorage.getItem('rotSignalSnapshot');
    if (raw) prevSnap = JSON.parse(raw);
  } catch(e) { prevSnap = null; }

  // 如果没有上次记录，说明是首次使用，只保存不提醒
  if (!prevSnap) {
    try {
      localStorage.setItem('rotSignalSnapshot', JSON.stringify(currentSnap));
    } catch(e) {}
    alertEl.style.display = 'none';
    return;
  }

  // 比对变化
  var changes = [];

  // 进攻线变化检测
  if (currentSnap.attackAllBroke !== prevSnap.attackAllBroke) {
    if (currentSnap.attackAllBroke) {
      changes.push({ line: 'attack', type: 'broke', oldPick: prevSnap.attackPick, newPick: null });
    } else if (prevSnap.attackAllBroke) {
      changes.push({ line: 'attack', type: 'recover', oldPick: null, newPick: currentSnap.attackPick });
    }
  } else if (currentSnap.attackPick !== prevSnap.attackPick) {
    if (!currentSnap.attackPick && !currentSnap.attackAllBroke) {
      // 数据不足，跳过
    } else {
      changes.push({ line: 'attack', type: 'switch', oldPick: prevSnap.attackPick, newPick: currentSnap.attackPick });
    }
  }

  // 防御线变化检测
  if (currentSnap.defenseAllBroke !== prevSnap.defenseAllBroke) {
    if (currentSnap.defenseAllBroke) {
      changes.push({ line: 'defense', type: 'broke', oldPick: prevSnap.defensePick, newPick: null });
    } else if (prevSnap.defenseAllBroke) {
      changes.push({ line: 'defense', type: 'recover', oldPick: null, newPick: currentSnap.defensePick });
    }
  } else if (currentSnap.defensePick !== prevSnap.defensePick) {
    if (!currentSnap.defensePick && !currentSnap.defenseAllBroke) {
      // 数据不足，跳过
    } else {
      changes.push({ line: 'defense', type: 'switch', oldPick: prevSnap.defensePick, newPick: currentSnap.defensePick });
    }
  }

  // 渲染提醒
  if (changes.length === 0) {
    // 无变化，显示稳定提示
    var prevTime = new Date(prevSnap.timestamp);
    var prevTimeStr = (prevTime.getMonth()+1) + '/' + prevTime.getDate() + ' ' +
      String(prevTime.getHours()).padStart(2,'0') + ':' + String(prevTime.getMinutes()).padStart(2,'0');
    alertEl.style.display = 'block';
    alertEl.className = 'rot-signal-alert no-change';
    alertEl.innerHTML =
      '<div class="rot-signal-alert-header">✅ 信号无变化 · 与上次(' + prevTimeStr + ')一致</div>' +
      '<div class="rot-signal-alert-body">' +
        '<div class="rot-signal-stable-item">🚀 进攻线：' + (currentSnap.attackPick || '全线破位·持现金') + '</div>' +
        '<div class="rot-signal-stable-item">🛡️ 防御线：' + (currentSnap.defensePick || '全线破位·持现金') + '</div>' +
      '</div>';
  } else {
    // 有变化，高亮提醒
    alertEl.style.display = 'block';
    alertEl.className = 'rot-signal-alert has-change';
    var headerText = changes.length === 1 ? '⚠️ 检测到 ' + changes.length + ' 项信号变化' : '⚠️ 检测到 ' + changes.length + ' 项信号变化';
    var html = '<div class="rot-signal-alert-header">' + headerText + ' · 建议关注调仓机会</div>';
    html += '<div class="rot-signal-alert-body">';

    changes.forEach(function(ch) {
      var lineLabel = ch.line === 'attack' ? '进攻线' : '防御线';
      var lineCls = ch.line === 'attack' ? 'attack' : 'defense';

      if (ch.type === 'switch') {
        html += '<div class="rot-signal-change-item">' +
          '<span class="line-tag ' + lineCls + '">' + lineLabel + '</span>' +
          '<span class="old-pick">' + (ch.oldPick || '—') + '</span>' +
          '<span class="arrow">→</span>' +
          '<span class="new-pick">' + ch.newPick + '</span>' +
          '<span style="color:var(--muted);font-size:0.52rem;margin-left:0.2rem">换仓信号</span>' +
        '</div>';
      } else if (ch.type === 'broke') {
        html += '<div class="rot-signal-change-item">' +
          '<span class="line-tag ' + lineCls + '">' + lineLabel + '</span>' +
          '<span class="old-pick">' + (ch.oldPick || '—') + '</span>' +
          '<span class="arrow">→</span>' +
          '<span class="new-pick" style="color:var(--neon-green)">全线破位·转持现金</span>' +
        '</div>';
      } else if (ch.type === 'recover') {
        html += '<div class="rot-signal-change-item">' +
          '<span class="line-tag ' + lineCls + '">' + lineLabel + '</span>' +
          '<span class="old-pick">全线破位</span>' +
          '<span class="arrow">→</span>' +
          '<span class="new-pick">' + ch.newPick + '</span>' +
          '<span style="color:var(--neon-red);font-size:0.52rem;margin-left:0.2rem">信号恢复·可上车</span>' +
        '</div>';
      }
    });

    html += '</div>';
    alertEl.innerHTML = html;
  }

  // 保存当前信号快照
  try {
    localStorage.setItem('rotSignalSnapshot', JSON.stringify(currentSnap));
  } catch(e) {}
}

/* ============================================================
   十一·五B、全球大类资产动量轮动计算
   规则：动量确认 + 回踩入场（同双线轮动逻辑，适配MA28/20日涨幅）
   ============================================================ */

/**
 * 动量轮动复合评分（适配MA28+20日涨幅参数）
 * 与 calcRotationScore 同理，但周期更短（MA28代替MA60，20日代替15日）
 * 
 * 评分维度（满分100）：
 *   A. 趋势确认（0-25）：MA28之上 + 多头排列 + 均线向上
 *   B. 动量强度（0-25）：20日/5日涨幅，过热扣分
 *   C. 入场质量（0-50）：偏离MA28 + 回踩幅度 + 短期降温
 */
function calcMomentumScore(closes) {
  if (!closes || closes.length < 28) return null;

  var n = closes.length;
  var current = closes[n - 1];

  // 均线（适配动量策略的短周期）
  var ma5  = calcMA(closes, 5);
  var ma10 = calcMA(closes, 10);
  var ma20 = calcMA(closes, 20);
  var ma28 = calcMA(closes, 28);
  if (!ma28) return null;

  // MA10在5天前的值（判断均线方向）
  var ma10_5ago = null;
  if (n >= 15) {
    var s = 0;
    for (var i = n - 5 - 10; i < n - 5; i++) s += closes[i];
    ma10_5ago = s / 10;
  }

  // 涨幅
  var change5  = calcChange(closes, 5);
  var change20 = calcChange(closes, 20);

  // 趋势状态
  var aboveMA28 = current > ma28;
  var bullAlign = (ma5 && ma10 && ma20) && (ma5 > ma10 && ma10 > ma20);
  var ma10Up    = ma10_5ago !== null && ma10 > ma10_5ago;
  var ma20Above28 = ma20 && ma28 && (ma20 > ma28);

  // 偏离MA28（%）
  var deviation = ((current - ma28) / ma28) * 100;

  // 近10日最高价（回踩幅度计算）
  var peak10 = current;
  var lookback = Math.min(10, n);
  for (var k = n - lookback; k < n; k++) {
    if (closes[k] > peak10) peak10 = closes[k];
  }
  var pullback = peak10 > 0 ? ((peak10 - current) / peak10) * 100 : 0;

  // ============ A. 趋势确认分（0-25） ============
  var trendScore = 0;
  if (aboveMA28)      trendScore += 10;
  if (bullAlign)      trendScore += 8;
  if (ma10Up)         trendScore += 4;
  if (ma20Above28)    trendScore += 3;
  trendScore = Math.min(25, trendScore);

  // ============ B. 动量强度分（0-25） ============
  var momScore = 0;
  if (change20 !== null) {
    momScore += Math.min(18, Math.max(0, change20 * 1.2));
  }
  if (change5 !== null && change5 > 0) {
    momScore += Math.min(7, change5 * 1.4);
  }
  if (change20 !== null && change20 > 20) {
    momScore -= 5;
  }
  momScore = Math.max(0, Math.min(25, momScore));

  // ============ C. 入场质量分（0-50）= 核心 ============
  var entryScore = 0;

  // C1. 偏离MA28（0-20）
  var devScore = 0;
  if (aboveMA28) {
    if (deviation <= 3)        devScore = 20;
    else if (deviation <= 6)   devScore = 16;
    else if (deviation <= 10)  devScore = 10;
    else if (deviation <= 15)  devScore = 4;
    else                       devScore = 0;
  }
  entryScore += devScore;

  // C2. 回踩幅度（0-15）
  var pbScore = 0;
  if (pullback >= 3 && pullback <= 7)       pbScore = 15;
  else if (pullback >= 1 && pullback < 3)   pbScore = 9;
  else if (pullback >= 7 && pullback <= 10) pbScore = 10;
  else if (pullback < 1)                    pbScore = 3;
  else if (pullback > 10)                   pbScore = 5;
  entryScore += pbScore;

  // C3. 短期降温（0-15）
  var coolScore = 0;
  if (change5 !== null && change20 !== null && change20 > 0) {
    var ratio = change5 / change20;
    if (ratio < 0.33 && change5 > -2)       coolScore = 15;
    else if (ratio >= 0.33 && ratio < 0.5)  coolScore = 10;
    else if (ratio >= 0.5)                  coolScore = 2;
    else if (change5 >= -2 && change5 < 0)  coolScore = 8;
    else if (change5 < -2 && change5 > -5)  coolScore = 5;
    else                                    coolScore = 2;
  } else if (change5 !== null && change5 >= -2 && change5 <= 2) {
    coolScore = 10;
  }
  entryScore += coolScore;

  entryScore = Math.max(0, Math.min(50, entryScore));

  // 总分
  var totalScore = Math.round(trendScore + momScore + entryScore);
  totalScore = Math.max(0, Math.min(100, totalScore));

  // === 风险评级（独立于入场评分，评估持有风险） ===
  var riskLevel = 1;
  var riskFactors = [];

  if (aboveMA28) {
    if (deviation > 20)      { riskLevel = Math.max(riskLevel, 5); riskFactors.push('严重超买偏离MA28达' + deviation.toFixed(0) + '%'); }
    else if (deviation > 15) { riskLevel = Math.max(riskLevel, 4); riskFactors.push('高位偏离MA28达' + deviation.toFixed(0) + '%'); }
    else if (deviation > 10) { riskLevel = Math.max(riskLevel, 3); riskFactors.push('偏离MA28 ' + deviation.toFixed(0) + '%'); }
    else if (deviation > 6)  { riskLevel = Math.max(riskLevel, 2); }
  }

  if (change20 !== null && change20 > 25)      { riskLevel = Math.max(riskLevel, 5); riskFactors.push('20日暴涨' + change20.toFixed(0) + '%，严重过热'); }
  else if (change20 !== null && change20 > 20) { riskLevel = Math.max(riskLevel, 4); riskFactors.push('20日涨幅' + change20.toFixed(0) + '%，短期过热'); }
  else if (change20 !== null && change20 > 15) { riskLevel = Math.max(riskLevel, 3); riskFactors.push('20日涨幅较大(' + change20.toFixed(0) + '%)'); }

  if (change5 !== null && change20 !== null && change20 > 5) {
    if (change5 > change20 * 0.6 && change5 > 5) { riskLevel = Math.max(riskLevel, 4); riskFactors.push('短期仍在加速上涨'); }
    else if (change5 > change20 * 0.5 && change5 > 3) { riskLevel = Math.max(riskLevel, 3); }
  }

  if (aboveMA28 && pullback < 0.5 && deviation > 5) { riskLevel = Math.max(riskLevel, 3); riskFactors.push('价格持续在高位无回踩'); }

  if (change5 !== null && change5 < -5) { riskLevel = Math.max(riskLevel, 4); riskFactors.push('5日急跌' + change5.toFixed(1) + '%'); }
  else if (change5 !== null && change5 < -3) { riskLevel = Math.max(riskLevel, 3); }

  if (!aboveMA28) { riskLevel = 5; riskFactors = ['已跌破MA28，趋势破位']; }

  var riskType, riskLabel, riskDesc;
  if (riskLevel >= 4) {
    riskType = 'danger';
    riskLabel = riskLevel >= 5 ? '极高风险' : '高风险';
    riskDesc = riskLevel >= 5 ? '建议立即减仓/清仓' : '建议分批减仓，锁定利润';
  } else if (riskLevel >= 3) {
    riskType = 'warning';
    riskLabel = '风险警戒';
    riskDesc = '注意控制仓位，设好止盈止损线';
  } else if (riskLevel >= 2) {
    riskType = 'warning';
    riskLabel = '需关注';
    riskDesc = '趋势尚可，留意短期波动';
  } else {
    riskType = 'safe';
    riskLabel = '风险较低';
    riskDesc = '趋势健康，安全边际充足';
  }

  // === 信号判断（结合入场评分+风险评级） ===
  var signal, signalCls;
  if (!aboveMA28) {
    signal = '趋势破位';
    signalCls = 'exit';
  } else if (riskLevel >= 5) {
    signal = '该跑了';
    signalCls = 'sell';
  } else if (riskLevel >= 4) {
    signal = '建议减仓';
    signalCls = 'reduce';
  } else if (riskLevel >= 3) {
    signal = '逢高减仓';
    signalCls = 'reduce';
  } else if (entryScore >= 35 && totalScore >= 65) {
    signal = '优选入场';
    signalCls = 'buy';
  } else if (totalScore >= 50) {
    signal = '可持有';
    signalCls = 'hold';
  } else {
    signal = '等待回踩';
    signalCls = 'wait';
  }

  // 标签
  var tags = [];
  if (deviation <= 3 && aboveMA28)       tags.push({ text: '贴近支撑', cls: 'good' });
  if (pullback >= 3 && pullback <= 7)    tags.push({ text: '回踩到位', cls: 'good' });
  if (coolScore >= 12)                   tags.push({ text: '涨势放缓', cls: 'good' });
  if (bullAlign)                         tags.push({ text: '多头排列', cls: 'good' });
  if (deviation > 10)                    tags.push({ text: '高位偏离' + deviation.toFixed(0) + '%', cls: 'risk' });
  if (pullback < 1 && aboveMA28)         tags.push({ text: '追高风险', cls: 'risk' });
  if (change20 !== null && change20 > 20) tags.push({ text: '短期过热', cls: 'risk' });
  if (change5 !== null && change5 < -5)  tags.push({ text: '急跌警示', cls: 'risk' });

  return {
    score: totalScore,
    signal: signal, signalCls: signalCls,
    breakdown: { trend: trendScore, momentum: momScore, entry: entryScore,
                 devScore: devScore, pbScore: pbScore, coolScore: coolScore },
    riskLevel: riskLevel,
    riskType: riskType,
    riskLabel: riskLabel,
    riskDesc: riskDesc,
    riskFactors: riskFactors,
    ma5: ma5, ma10: ma10, ma20: ma20, ma28: ma28,
    change5: change5, change20: change20,
    deviation: deviation, pullback: pullback,
    aboveMA28: aboveMA28, bullAlign: bullAlign, ma10Up: ma10Up,
    current: current, peak10: peak10,
    tags: tags
  };
}

/**
 * 分析动量轮动：使用复合评分系统选出最佳入场标的
 * @returns {Promise} resolve({results:[], pick:obj|null, allBroke:boolean})
 */
function analyzeMomentumRotation() {
  var promises = MOMENTUM_CONFIG.map(function(etf) {
    return fetchKline(etf.code, 60).then(function(kd) {
      if (!kd || kd.closes.length < 28) {
        return { name: etf.name, code: etf.code, tag: etf.tag, error: true,
                 aboveMA28: null, change20: null };
      }
      var sc = calcMomentumScore(kd.closes);
      if (!sc) {
        return { name: etf.name, code: etf.code, tag: etf.tag, error: true,
                 aboveMA28: null, change20: null };
      }
      return {
        name: etf.name, code: etf.code, tag: etf.tag, error: false,
        aboveMA28: sc.aboveMA28,
        ma28: sc.ma28, current: sc.current,
        change5: sc.change5, change20: sc.change20,
        score: sc.score,
        signal: sc.signal, signalCls: sc.signalCls,
        breakdown: sc.breakdown,
        deviation: sc.deviation, pullback: sc.pullback,
        bullAlign: sc.bullAlign,
        tags: sc.tags,
        lastDate: kd.dates[kd.dates.length - 1]
      };
    }).catch(function() {
      return { name: etf.name, code: etf.code, tag: etf.tag, error: true,
               aboveMA28: null, change20: null };
    });
  });
  return Promise.all(promises).then(function(results) {
    // 筛选站上28日均线的（趋势确认）
    var valid = results.filter(function(r) { return !r.error && r.aboveMA28 === true; });
    // 按复合评分降序排列
    valid.sort(function(a, b) {
      return (b.score || 0) - (a.score || 0);
    });
    // 选出评分最高的
    var pick = valid.length > 0 ? valid[0] : null;
    var allBroke = results.every(function(r) {
      return r.error || r.aboveMA28 === false || r.aboveMA28 === null;
    });

    // 展示排序：站上的按评分降序，破位的排后面
    results.sort(function(a, b) {
      if (a.error && !b.error) return 1;
      if (!a.error && b.error) return -1;
      if (a.aboveMA28 && !b.aboveMA28) return -1;
      if (!a.aboveMA28 && b.aboveMA28) return 1;
      return (b.score || 0) - (a.score || 0);
    });

    return { results: results, pick: pick, allBroke: allBroke };
  });
}

/**
 * 渲染动量轮动排名表格
 * @param {string} containerId - 容器元素ID
 * @param {object} data - analyzeMomentumRotation 返回值
 */
function renderMomentumRotation(containerId, data) {
  var container = document.getElementById(containerId);
  var html = '<div class="rb-title"><span class="rb-icon">⚡</span>动量排名（实时 · 动量+回踩评分）</div>';

  // 排名表格：ETF | MA28 | 20日 | 偏离 | 评分 | 信号
  html += '<table class="mom-rank-table">';
  html += '<thead><tr><th>ETF</th><th>MA28</th><th>20日</th><th>偏离</th><th>评分</th><th>信号</th></tr></thead><tbody>';

  data.results.forEach(function(r, i) {
    var rowCls = '';
    var maHtml = '', chgHtml = '', devHtml = '', scoreHtml = '', sigHtml = '';
    var rankBadge = '<span class="mom-rank-num">' + (i + 1) + '</span>';

    if (r.error || r.aboveMA28 === null) {
      maHtml = '<span style="color:var(--muted)">—</span>';
      chgHtml = '—'; devHtml = '—'; scoreHtml = '—';
      sigHtml = '<span class="exit-tag">数据不足</span>';
    } else if (r.aboveMA28) {
      if (data.pick && r.name === data.pick.name) rowCls = 'mom-row-top';
      else rowCls = 'row-ok';

      maHtml = '<span class="etf-ok-icon" style="display:inline-block;vertical-align:middle"></span>';

      if (r.change20 !== null) {
        var cStr = (r.change20 >= 0 ? '+' : '') + r.change20.toFixed(2) + '%';
        var cColor = r.change20 >= 0 ? getSignalColor('red') : getSignalColor('green');
        chgHtml = '<span style="color:' + cColor + ';font-weight:600">' + cStr + '</span>';
      } else { chgHtml = '—'; }

      var devVal = r.deviation.toFixed(1) + '%';
      var devCls = r.deviation <= 3 ? 'safe' : (r.deviation <= 10 ? 'ok' : 'risk');
      devHtml = '<span class="rot-dev ' + devCls + '">' + devVal + '</span>';

      var sCls = r.score >= 65 ? 'high' : (r.score >= 50 ? 'mid' : 'low');
      scoreHtml = '<span class="rot-score ' + sCls + '">' + r.score + '</span>';

      if (data.pick && r.name === data.pick.name) {
        sigHtml = '<span class="star">★推荐</span>';
      } else if (r.signalCls === 'sell') {
        sigHtml = '<span class="rot-signal-sell">' + r.signal + '</span>';
      } else if (r.signalCls === 'reduce') {
        sigHtml = '<span class="rot-signal-reduce">' + r.signal + '</span>';
      } else if (r.signalCls === 'buy') {
        sigHtml = '<span style="color:var(--neon-red);font-size:0.52rem">' + r.signal + '</span>';
      } else if (r.signalCls === 'hold') {
        sigHtml = '<span style="color:var(--neon-yellow);font-size:0.52rem">' + r.signal + '</span>';
      } else {
        sigHtml = '<span style="color:var(--muted);font-size:0.52rem">' + r.signal + '</span>';
      }
    } else {
      rowCls = 'row-broke';
      maHtml = '<span class="etf-broke-icon" style="display:inline-flex;vertical-align:middle">!</span>';
      if (r.change20 !== null) {
        var c2 = (r.change20 >= 0 ? '+' : '') + r.change20.toFixed(2) + '%';
        chgHtml = '<span style="color:var(--muted)">' + c2 + '</span>';
      } else { chgHtml = '—'; }
      devHtml = '<span class="rot-dev" style="color:var(--muted)">—</span>';
      scoreHtml = '<span class="rot-score low">' + (r.score || 0) + '</span>';
      sigHtml = '<span class="exit-tag">趋势破位</span>';
    }

    html += '<tr class="' + rowCls + '">' +
      '<td>' + rankBadge + ' ' + r.name + '</td>' +
      '<td>' + maHtml + '</td>' +
      '<td>' + chgHtml + '</td>' +
      '<td>' + devHtml + '</td>' +
      '<td>' + scoreHtml + '</td>' +
      '<td>' + sigHtml + '</td>' +
    '</tr>';
  });

  html += '</tbody></table>';

  // 风险提醒
  var riskAlerts = [];
  data.results.forEach(function(r) {
    if (!r.error && r.riskLevel >= 3) {
      riskAlerts.push(r);
    }
  });
  if (riskAlerts.length > 0) {
    riskAlerts.sort(function(a, b) { return (b.riskLevel||0) - (a.riskLevel||0); });
    var maxRisk = riskAlerts[0].riskLevel;
    var maxRiskType = riskAlerts[0].riskType;
    var riskIcon = maxRisk >= 4 ? '🚨' : '⚠️';

    html += '<div class="rot-risk-bar ' + maxRiskType + '">';
    html += '<span class="rot-risk-icon">' + riskIcon + '</span>';
    html += '<span class="rot-risk-label">' + riskAlerts[0].riskLabel + '</span>';
    html += '<span class="rot-risk-dots">';
    for (var di = 1; di <= 5; di++) {
      html += '<span class="rot-risk-dot' + (di <= maxRisk ? ' active ' + maxRiskType : '') + '"></span>';
    }
    html += '</span>';
    var factorTexts = [];
    riskAlerts.forEach(function(r) {
      if (r.riskFactors && r.riskFactors.length > 0) {
        r.riskFactors.forEach(function(f) {
          if (factorTexts.indexOf(r.name + ':' + f) === -1) {
            factorTexts.push(r.name + ' ' + f);
          }
        });
      }
    });
    var descText = factorTexts.length > 0 ? factorTexts.slice(0, 3).join('；') : riskAlerts[0].riskDesc;
    html += '<span class="rot-risk-desc">' + descText + '</span>';
    html += '</div>';
  }

  // 推荐标的详情卡片
  if (data.pick) {
    var p = data.pick;
    var bd = p.breakdown || {};
    var pStr = (p.change20 >= 0 ? '+' : '') + p.change20.toFixed(2) + '%';
    var sClsPick = p.score >= 65 ? 'high' : (p.score >= 50 ? 'mid' : 'low');

    html += '<div class="rot-pick-detail">';
    html += '<div class="rot-pick-detail-header">';
    html += '<span class="rot-pick-detail-name">🥇 ' + p.name + '</span>';
    html += '<span class="rot-pick-detail-score rot-score ' + sClsPick + '" style="font-size:0.72rem;padding:0.1rem 0.3rem">' + p.score + '分</span>';
    html += '</div>';

    // 评分维度条
    html += '<div class="rot-score-bar-row">';
    html += '<span class="rot-score-bar-label">趋势确认</span>';
    html += '<div class="rot-score-bar-track"><div class="rot-score-bar-fill trend" style="width:' + ((bd.trend||0)/25*100) + '%"></div></div>';
    html += '<span class="rot-score-bar-val">' + (bd.trend||0) + '/25</span>';
    html += '</div>';

    html += '<div class="rot-score-bar-row">';
    html += '<span class="rot-score-bar-label">动量强度</span>';
    html += '<div class="rot-score-bar-track"><div class="rot-score-bar-fill momentum" style="width:' + ((bd.momentum||0)/25*100) + '%"></div></div>';
    html += '<span class="rot-score-bar-val">' + (bd.momentum||0).toFixed(2) + '/25</span>';
    html += '</div>';

    html += '<div class="rot-score-bar-row">';
    html += '<span class="rot-score-bar-label">入场质量</span>';
    html += '<div class="rot-score-bar-track"><div class="rot-score-bar-fill entry" style="width:' + ((bd.entry||0)/50*100) + '%"></div></div>';
    html += '<span class="rot-score-bar-val">' + (bd.entry||0) + '/50</span>';
    html += '</div>';

    // 关键数据
    html += '<div style="display:flex;gap:0.5rem;margin-top:0.3rem;font-size:0.52rem;color:var(--muted);font-family:var(--font-mono)">';
    html += '<span>20日' + pStr + '</span>';
    html += '<span>偏离MA28 ' + p.deviation.toFixed(1) + '%</span>';
    html += '<span>回踩' + p.pullback.toFixed(1) + '%</span>';
    html += '</div>';

    // 标签
    if (p.tags && p.tags.length > 0) {
      html += '<div class="rot-pick-tags">';
      p.tags.forEach(function(t) {
        html += '<span class="rot-pick-tag ' + t.cls + '">' + t.text + '</span>';
      });
      html += '</div>';
    }

    // 推荐理由
    var reason = buildMomentumPickReason(p);
    html += '<div class="rot-pick-reason">' + reason + '</div>';

    // 推荐标的风险评级
    if (p.riskLevel >= 3) {
      var pRiskIcon = p.riskLevel >= 4 ? '🚨' : '⚠️';
      html += '<div class="rot-risk-bar ' + p.riskType + '" style="margin-top:0.3rem">';
      html += '<span class="rot-risk-icon">' + pRiskIcon + '</span>';
      html += '<span class="rot-risk-label">' + p.riskLabel + '</span>';
      html += '<span class="rot-risk-dots">';
      for (var pri = 1; pri <= 5; pri++) {
        html += '<span class="rot-risk-dot' + (pri <= p.riskLevel ? ' active ' + p.riskType : '') + '"></span>';
      }
      html += '</span>';
      html += '<span class="rot-risk-desc">' + p.riskDesc + (p.riskFactors && p.riskFactors.length > 0 ? '：' + p.riskFactors.join('；') : '') + '</span>';
      html += '</div>';
    }

    html += '</div>';
  } else if (data.allBroke) {
    html += '<div class="rot-pick hold">🚫 全线破位，暂持现金等待信号恢复</div>';
  } else {
    html += '<div class="rot-pick hold">⏳ 等待数据...</div>';
  }

  container.innerHTML = html;
}

/**
 * 动量轮动推荐理由文案（适配20日涨幅/MA28参数）
 */
function buildMomentumPickReason(p) {
  var reasons = [];

  if (p.deviation <= 3) {
    reasons.push('价格贴近MA28支撑，入场安全边际高');
  } else if (p.deviation <= 6) {
    reasons.push('偏离MA28适度，上行空间仍可期');
  } else if (p.deviation > 10) {
    reasons.push('偏离MA28较大(' + p.deviation.toFixed(0) + '%)，注意回调风险');
  }

  if (p.pullback >= 3 && p.pullback <= 7) {
    reasons.push('近10日回踩' + p.pullback.toFixed(1) + '%，处于较好入场区间');
  } else if (p.pullback < 1) {
    reasons.push('近期几乎未回踩，追高需谨慎');
  } else if (p.pullback > 7 && p.pullback <= 10) {
    reasons.push('回踩幅度较深(' + p.pullback.toFixed(1) + '%)，关注是否企稳');
  }

  if (p.change20 !== null && p.change20 > 0) {
    if (p.change5 !== null && p.change5 < p.change20 / 3 && p.change5 > -2) {
      reasons.push('5日涨势放缓(vs 20日)，短期降温利于蓄力');
    } else if (p.change5 !== null && p.change5 > p.change20 / 2) {
      reasons.push('短期仍在加速上涨，过热信号');
    }
  }

  if (p.bullAlign) {
    reasons.push('MA5>MA10>MA20多头排列，趋势确认');
  }

  if (reasons.length === 0) {
    reasons.push('综合评分最高，趋势与入场性价比均衡');
  }

  return reasons.join('；') + '。';
}

/**
 * 更新动量轮动数据
 */
function updateMomentumRotation() {
  var el = document.getElementById('rotMomentum');
  if (el) el.innerHTML = '<div class="rb-title"><span class="rb-icon">⚡</span>动量排名（实时 · 动量+回踩评分）</div>' +
    '<div style="text-align:center;padding:0.8rem;color:var(--muted);font-size:0.68rem"><span class="spinner" style="width:12px;height:12px;border-width:1.5px"></span> 加载K线数据中...</div>';

  // 更新日期标签
  var now = new Date();
  var dateStr = (now.getMonth() + 1) + '/' + now.getDate();
  var dateEls = document.querySelectorAll('.mom-date');
  dateEls.forEach(function(el) { el.textContent = dateStr; });

  return analyzeMomentumRotation().then(function(data) {
    renderMomentumRotation('rotMomentum', data);
  }).catch(function(err) {
    console.warn('动量轮动更新失败:', err);
  });
}

/* ============================================================
   十一·六、行业信号动态评分
   ============================================================ */

/**
 * 根据ETF动量计算行业温度分（0=冰点, 100=过热）
 * 公式：基础50分 + 15日涨幅×2.5 + 均线状态调整，限制0~100
 * @param {number} change15 - 15日涨幅%
 * @param {boolean} aboveMA60 - 是否站上60日线
 * @returns {number} 0~100
 */
/**
 * 行业温度分（0=冰点, 100=过热）
 *
 * 评分维度（全部基于K线客观数据）：
 *   1. 近15日涨幅 → 衡量短期拥挤/热门程度（涨越多越拥挤）
 *   2. 近5日涨幅 → 衡量短期加速（急涨加速拥挤度）
 *   3. 均线位置（MA60）→ 站上均线加分，破位减分
 *   4. 近期最大回撤 → 回撤大说明风险释放
 *
 * 综合判断：
 *   热门急涨 → 高分（回避）
 *   温和上涨或横盘 → 中分（观望）
 *   持续下跌/破位 → 低分（冰点/可关注）
 */
function calcIndustryScore(change15, aboveMA60, change5, maxDrawdown) {
  var score = 50; // 基准中位

  // 维度1：15日涨幅权重（-30~+30）
  if (change15 !== null) {
    score += change15 * 1.8;
  }

  // 维度2：5日加速（急涨加拥堵）
  if (change5 !== null) {
    score += change5 * 1.2;
  }

  // 维度3：均线状态
  if (aboveMA60 === true) score += 5;   // 站上60日线
  if (aboveMA60 === false) score -= 12;  // 破位风险大

  // 维度4：近期回撤（回撤越大，风险已释放越多）
  if (maxDrawdown !== null) {
    if (maxDrawdown > 25) score -= 10;  // 大幅回调，风险充分释放
    else if (maxDrawdown > 15) score -= 5;  // 深度回调释放风险
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * 根据温度分获取区间信息（四区制：可抄底/观望/持有/回避）
 * - 可抄底(≤30)：跌幅大/破位 → 🔴 可抄底（等右侧确认）
 * - 观望区(31~50)：低位横盘 → 🟡 观望（等催化不追高）
 * - 持有区(51~70)：温和上涨 → 🟠 持有（趋势中不追）
 * - 回避区(>70)：热门/急涨/拥挤 → 🟢 回避（过热别追）
 */
function getIndustryZone(score) {
  if (score <= 30) return {
    zone: '可抄底区', color: getSignalColor('red'),
    action: '🔴 可抄底', actionCls: 'buy', note: '等右侧确认'
  };
  if (score <= 50) return {
    zone: '观望区', color: getSignalColor('yellow'),
    action: '🟡 观望', actionCls: 'hold', note: '不追高'
  };
  if (score <= 70) return {
    zone: '持有区', color: blendHex(getSignalColor('yellow'), getSignalColor('red'), 0.5),
    action: '🟠 持有', actionCls: 'keep', note: '趋势中不追'
  };
  return {
    zone: '回避区', color: getSignalColor('green'),
    action: '🟢 回避', actionCls: 'sell', note: '过热别追'
  };
}

/**
 * 生成行业状态简注（基于拥挤度+跌幅+均线）
 */
function getIndustryNote(name, score, change15, aboveMA60) {
  if (change15 === null) return '数据不足';
  var mag = Math.abs(change15).toFixed(1);

  // 可抄底区(≤30)：强调跌幅+位置
  if (score <= 30) {
    if (aboveMA60 === true) return '低位企稳 等催化';
    if (aboveMA60 === false) return '跌幅' + mag + '% 等企稳';
    return '跌幅' + mag + '% 等企稳';
  }

  // 观望区(31~50)：低位横盘/温和
  if (score <= 50) {
    if (change15 > 8) return '涨幅' + mag + '% 有点热';
    if (change15 < -8) return '跌幅' + mag + '% 关注';
    if (aboveMA60 === true) return '均线之上 横盘';
    return mag + '%调整中';
  }

  // 持有区(51~70)：温和上涨/趋势中
  if (score <= 70) {
    if (change15 > 12) return '涨幅' + mag + '% 偏热';
    if (aboveMA60 === true) return '均线之上 趋势中';
    return '涨幅' + mag + '% 趋势中';
  }

  // 回避区(>70)：过热拥挤
  if (change15 > 15) return '急涨' + mag + '% 拥挤';
  return '涨幅' + mag + '% 过热';
}

/**
 * 更新行业信号（动态获取ETF数据计算温度分）
 */
function updateIndustrySignals() {
  var container = document.getElementById('industrySignals');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:0.8rem;color:var(--muted);font-size:0.68rem"><span class="spinner" style="width:12px;height:12px;border-width:1.5px"></span> 计算行业动量中...</div>';

  // 更新日期
  var now = new Date();
  var dateStr = (now.getMonth() + 1) + '/' + now.getDate();
  var sigDateEl = document.getElementById('sigDate');
  if (sigDateEl) sigDateEl.textContent = dateStr;

  var promises = INDUSTRY_CONFIG.map(function(ind) {
    return fetchKline(ind.code, 100).then(function(kd) {
      if (!kd || kd.closes.length < 16) {
        return { name: ind.name, score: 50, change15: null,
                 aboveMA60: null, change5: null, maxDrawdown: null, error: true };
      }
      var ma60 = calcMA(kd.closes, 60);
      var current = kd.closes[kd.closes.length - 1];
      var change15 = calcChange(kd.closes, 15);
      var change5 = calcChange(kd.closes, 5);
      var aboveMA60 = ma60 ? current > ma60 : null;
      var maxDrawdown = calcMaxDrawdown(kd.closes);
      var score = calcIndustryScore(change15, aboveMA60, change5, maxDrawdown);
      return { name: ind.name, score: score, change15: change15,
               aboveMA60: aboveMA60, change5: change5,
               maxDrawdown: maxDrawdown, error: false };
    }).catch(function() {
      return { name: ind.name, score: 50, change15: null,
               aboveMA60: null, change5: null, maxDrawdown: null, error: true };
    });
  });

  return Promise.all(promises).then(function(results) {
    renderIndustrySignals(results);
  }).catch(function(err) {
    console.warn('行业信号更新失败:', err);
  });
}

/**
 * 渲染行业信号分区
 * @param {Array} results - [{name, score, change15, aboveMA60, error}]
 */
function renderIndustrySignals(results) {
  var container = document.getElementById('industrySignals');
  // 按分数分组到4个区间（可抄底/观望/持有/回避）
  var zones = [
    { max: 30, items: [], info: getIndustryZone(20) },
    { max: 50, items: [], info: getIndustryZone(40) },
    { max: 70, items: [], info: getIndustryZone(60) },
    { max: 100, items: [], info: getIndustryZone(80) }
  ];
  results.forEach(function(r) {
    for (var i = 0; i < zones.length; i++) {
      if (r.score <= zones[i].max) { zones[i].items.push(r); break; }
    }
  });

  // 按温度分降序排列（ hottest first ）
  var sorted = results.slice().sort(function(a, b) { return b.score - a.score; });

  var html = '';

  // 1. 汇总条：各区数量一目了然
  html += '<div class="sig-summary-bar">';
  zones.forEach(function(z) {
    if (z.items.length === 0) return;
    var info = z.info;
    html += '<div class="sig-summary-chip" style="border-color:' + info.color + '33">' +
      '<span class="chip-dot" style="background:' + info.color + '"></span>' +
      '<span style="color:' + info.color + '">' + info.zone + '</span>' +
      '<span class="chip-count" style="color:' + info.color + '">' + z.items.length + '</span>' +
      '</div>';
  });
  html += '</div>';

  // 2. 温度计列表：所有行业按温度降序，紧凑展示
  html += '<div class="sig-thermo-list">';
  sorted.forEach(function(r) {
    var info = getIndustryZone(r.score);
    var chgStr = r.change15 !== null ? ((r.change15 >= 0 ? '+' : '') + r.change15.toFixed(1) + '%') : '—';
    var chgColor = r.change15 !== null && r.change15 >= 0 ? 'var(--neon-red, #FF0000)' : 'var(--neon-green, #00AA00)';
    var errStyle = r.error ? 'opacity:0.5' : '';
    html += '<div class="sig-thermo-row" style="' + errStyle + '" title="' + getIndustryNote(r.name, r.score, r.change15, r.aboveMA60) + '">' +
      '<span class="st-name">' + r.name + '</span>' +
      '<div class="st-bar"><div class="st-bar-fill" style="width:' + r.score + '%;background:' + info.color + '"></div></div>' +
      '<span class="st-score" style="color:' + info.color + '">' + r.score + '</span>' +
      '<span class="st-chg" style="color:' + chgColor + '">' + chgStr + '</span>' +
      '</div>';
  });
  html += '</div>';

  // 3. 交叉引用：引导用户到详细趋势分析
  var buyCount = zones[0].items.length;
  var sellCount = zones[3].items.length;
  html += '<div class="sig-cross-ref">';
  if (buyCount > 0) {
    html += '<span>📌 ' + buyCount + '个行业处于可抄底区，详细超跌分析见 ' +
      '<a onclick="scrollToSection(\'bottomPickArea\')">↓ 左侧抄底</a></span>';
  }
  if (sellCount > 0) {
    html += '<span>📌 ' + sellCount + '个行业过热需回避，详细趋势分析见 ' +
      '<a onclick="scrollToSection(\'trendLeadersArea\')">↑ 趋势右侧</a></span>';
  }
  html += '<span style="opacity:0.7">💡 温度分=15日涨幅+均线位置+动量+回撤，4区制：≤30可抄底 / 31~50观望 / 51~70持有 / >70回避</span>';
  html += '</div>';

  container.innerHTML = html;
}

/* ============================================================
   十一·六B、趋势右侧·强者恒强
   扫描全市场ETF，筛选站上MA20且均线向上的标的，按趋势强度排序
   右侧交易：趋势确认后再入场，不抄底不猜顶
   ============================================================ */

/**
 * 计算RSI指标
 * @param {number[]} closes - 收盘价数组
 * @param {number} period - 周期（默认14）
 * @returns {number|null} RSI值（0-100）
 */
function calcRSI(closes, period) {
  period = period || 14;
  if (!closes || closes.length < period + 1) return null;
  var gains = 0, losses = 0;
  for (var i = closes.length - period; i < closes.length; i++) {
    var change = closes[i] - closes[i - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  var avgGain = gains / period;
  var avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  var rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * 计算波动率（近N日日收益率标准差，单位%）
 * @param {number[]} closes - 收盘价数组
 * @param {number} period - 周期（默认20）
 * @returns {number|null} 波动率（%）
 */
function calcVolatility(closes, period) {
  period = period || 20;
  if (!closes || closes.length < period + 1) return null;
  var returns = [];
  for (var i = closes.length - period; i < closes.length; i++) {
    if (closes[i - 1] > 0) {
      returns.push((closes[i] - closes[i - 1]) / closes[i - 1] * 100);
    }
  }
  if (returns.length === 0) return null;
  var mean = returns.reduce(function(a, b) { return a + b; }, 0) / returns.length;
  var variance = returns.reduce(function(sum, r) { return sum + Math.pow(r - mean, 2); }, 0) / returns.length;
  return Math.sqrt(variance);
}

/**
 * 计算安全边际评分（0-100分）
 * 评分基于：波动率（0-35分）、RSI 40-60区间（0-35分）、MACD柱状体收敛度（0-30分）
 * 评分<70分时禁止交易
 * @param {number[]} closes - 收盘价数组
 * @returns {{score:number, components:object}}
 */
function calcSafetyMarginScore(closes) {
  if (!closes || closes.length < 30) return { score: 0, components: {} };
  var score = 0;
  var comp = {};

  // 1. 波动率评分（0-35分）：低波动=高分
  var vol = calcVolatility(closes, 20);
  comp.volatility = vol;
  if (vol !== null) {
    if (vol < 1) score += 35;
    else if (vol < 1.5) score += 28;
    else if (vol < 2) score += 20;
    else if (vol < 2.5) score += 12;
    else if (vol < 3) score += 6;
  }

  // 2. RSI评分（0-35分）：40-60区间=满分
  var rsi = calcRSI(closes, 14);
  comp.rsi = rsi;
  if (rsi !== null) {
    if (rsi >= 40 && rsi <= 60) score += 35;
    else if (rsi >= 35 && rsi <= 65) score += 25;
    else if (rsi >= 30 && rsi <= 70) score += 15;
    else if (rsi >= 25 && rsi <= 75) score += 8;
  }

  // 3. MACD柱状体收敛度（0-30分）
  var macd = calcMACD(closes);
  comp.macd = macd;
  if (macd !== null) {
    if (macd.histTrend === -1) {
      // 柱状体收窄→动能趋于稳定→高分
      score += (Math.abs(macd.hist) < 0.01) ? 20 : 30;
    } else if (macd.histTrend === 1) {
      // 柱状体放大→动能释放中
      score += (macd.hist > 0) ? 15 : 5;
    } else {
      score += 10;
    }
  }

  return { score: Math.round(score), components: comp };
}

/**
 * 左右侧趋势分析算法
 *
 * 机制：
 * 1. 左侧趋势（历史5根K线）：连续收阳且平均涨幅≤3% → 温和上升，非追高
 * 2. 右侧趋势（当前）：突破20日均线 + 成交量较前5日均值放大≥30%
 * 3. 回撤抑制：当前价格距10日高点下跌>5% → 自动抑制买入
 * 4. 安全边际评分：波动率+RSI(40-60)+MACD收敛度，<70分禁止交易
 *
 * @param {object} kd - K线数据 {closes, klines, dates}
 * @returns {object|null} 分析结果
 */
function analyzeLeftRightTrend(kd) {
  if (!kd || !kd.closes || kd.closes.length < 30) return null;
  var closes = kd.closes;
  var klines = kd.klines || kd.rawKlines || null;
  var n = closes.length;
  var currentPrice = closes[n - 1];

  // ========== 1. 左侧趋势检测 ==========
  var leftSide = { passed: false, consecutiveBull: 0, avgGain: 0, reason: '' };
  if (klines && klines.length >= 5) {
    var recent5 = klines.slice(-5);
    var bullCount = 0;
    var totalGain = 0;
    for (var i = 0; i < recent5.length; i++) {
      var open = parseFloat(recent5[i][1]) || 0;
      var close = parseFloat(recent5[i][2]) || 0;
      if (close > open) bullCount++;
      if (open > 0) totalGain += ((close - open) / open) * 100;
    }
    leftSide.consecutiveBull = bullCount;
    leftSide.avgGain = totalGain / 5;
    if (bullCount >= 5 && leftSide.avgGain <= 3) {
      leftSide.passed = true;
    } else if (bullCount < 5) {
      leftSide.reason = '左侧5根K线仅' + bullCount + '根收阳（需5根全阳）';
    } else {
      leftSide.reason = '左侧平均涨幅' + leftSide.avgGain.toFixed(2) + '%>3%（追高风险）';
    }
  } else {
    // 无K线开收价数据时，用收盘价递增近似判断
    var upCount = 0;
    var gainSum = 0;
    for (var j = n - 5; j < n; j++) {
      if (closes[j] > closes[j - 1]) {
        upCount++;
        gainSum += ((closes[j] - closes[j - 1]) / closes[j - 1]) * 100;
      }
    }
    leftSide.consecutiveBull = upCount;
    leftSide.avgGain = upCount > 0 ? gainSum / 5 : 0;
    if (upCount >= 5 && leftSide.avgGain <= 3) {
      leftSide.passed = true;
    } else if (upCount < 5) {
      leftSide.reason = '左侧近5日仅' + upCount + '日收涨（需5日全涨）';
    } else {
      leftSide.reason = '左侧平均涨幅' + leftSide.avgGain.toFixed(2) + '%>3%（追高风险）';
    }
  }

  // ========== 2. 右侧趋势检测 ==========
  var rightSide = { passed: false, aboveMA20: false, volRatio: 0, reason: '' };
  // MA20
  var ma20 = 0;
  if (n >= 20) {
    for (var k = 0; k < 20; k++) ma20 += closes[n - 1 - k];
    ma20 /= 20;
  }
  rightSide.aboveMA20 = currentPrice > ma20;

  // 成交量放大≥30%
  var volRatio = 0;
  if (klines && klines.length >= 6) {
    var todayVol = parseFloat(klines[klines.length - 1][5]) || 0;
    var avg5Vol = 0;
    for (var v = 2; v <= 6; v++) {
      avg5Vol += parseFloat(klines[klines.length - v][5]) || 0;
    }
    avg5Vol /= 5;
    volRatio = avg5Vol > 0 ? todayVol / avg5Vol : 0;
  }
  rightSide.volRatio = volRatio;

  if (rightSide.aboveMA20 && volRatio >= 1.3) {
    rightSide.passed = true;
  } else if (!rightSide.aboveMA20) {
    rightSide.reason = '当前价' + currentPrice.toFixed(3) + '未突破MA20(' + ma20.toFixed(3) + ')';
  } else {
    rightSide.reason = '量比' + volRatio.toFixed(2) + '<1.3（需放量30%以上）';
  }

  // ========== 3. 回撤抑制检测 ==========
  var drawdown = { suppressed: false, dropFromHigh: 0, high10: 0, reason: '' };
  var lookbackDD = Math.min(10, n);
  var high10 = closes[n - 1];
  for (var h = n - lookbackDD; h < n; h++) {
    if (closes[h] > high10) high10 = closes[h];
  }
  drawdown.high10 = high10;
  drawdown.dropFromHigh = high10 > 0 ? ((high10 - currentPrice) / high10) * 100 : 0;
  if (drawdown.dropFromHigh > 5) {
    drawdown.suppressed = true;
    drawdown.reason = '距10日高点回撤' + drawdown.dropFromHigh.toFixed(2) + '%>5%（回撤抑制）';
  }

  // ========== 4. 安全边际评分 ==========
  var safety = calcSafetyMarginScore(closes);

  // ========== 综合信号判定 ==========
  var reasons = [];
  if (!leftSide.passed) reasons.push(leftSide.reason);
  if (!rightSide.passed) reasons.push(rightSide.reason);
  if (drawdown.suppressed) reasons.push(drawdown.reason);
  if (safety.score < 70) reasons.push('安全边际' + safety.score + '分<70分');

  var canBuy = leftSide.passed && rightSide.passed && !drawdown.suppressed && safety.score >= 70;

  var signal, signalCls;
  if (canBuy) {
    signal = '✓ 安全买入';
    signalCls = 'buy';
  } else if (safety.score >= 60 && (leftSide.passed || rightSide.passed)) {
    signal = '△ 接近买入';
    signalCls = 'watch';
  } else if (safety.score >= 50) {
    signal = '○ 观望';
    signalCls = 'watch';
  } else {
    signal = '✗ 禁止交易';
    signalCls = 'wait';
  }

  return {
    canBuy: canBuy,
    signal: signal,
    signalCls: signalCls,
    reasons: reasons,
    safetyScore: safety.score,
    safetyComponents: safety.components,
    leftSide: leftSide,
    rightSide: rightSide,
    drawdown: drawdown,
    ma20: ma20,
    currentPrice: currentPrice,
    lastDate: kd.dates ? kd.dates[kd.dates.length - 1] : ''
  };
}

/**
 * 计算趋势右侧强度分（0-100）
 * 条件：站上MA20 且 MA20向上（不满足直接排除）
 * 评分维度：
 *   1. MA20斜率（5日MA20变化率）→ 趋势力度
 *   2. 均线排列（MA5>MA10>MA20=多头排列加分）
 *   3. 15日涨幅 → 中期动量
 *   4. 5日涨幅 → 短期动量
 *   5. 连续站上MA20天数 → 趋势持续性
 *   6. 离MA20偏离度 → 过高减分（追高风险）
 */
function calcTrendScore(kd) {
  if (!kd || !kd.closes || kd.closes.length < 25) return null;

  var closes = kd.closes;
  var n = closes.length;

  // 计算MA20序列（滑动窗口O(n)优化）
  var ma20Arr = [];
  var maSum = 0;
  for (var i = 0; i < n; i++) {
    maSum += closes[i];
    if (i >= 20) maSum -= closes[i - 20];
    if (i >= 19) ma20Arr.push(maSum / 20);
  }
  if (ma20Arr.length < 6) return null;

  var currentPrice = closes[n - 1];
  var ma20 = ma20Arr[ma20Arr.length - 1];

  // 条件1：必须站上MA20
  if (currentPrice <= ma20) return null;

  // 条件2：MA20必须向上（近5日MA20在上升）
  var ma5ago = ma20Arr[ma20Arr.length - 6];
  var maTrend = ma20 - ma5ago;
  var maTrendPct = ma5ago > 0 ? (maTrend / ma5ago) * 100 : 0;
  if (maTrend <= 0) return null;

  // MA5 MA10
  var ma5 = 0, ma10 = 0;
  if (n >= 5) { for (var k = 0; k < 5; k++) ma5 += closes[n - 1 - k]; ma5 /= 5; }
  if (n >= 10) { for (var k = 0; k < 10; k++) ma10 += closes[n - 1 - k]; ma10 /= 10; }

  // 均线排列
  var bullAlignment = (ma5 > ma10 && ma10 > ma20);

  // 涨幅
  var change5 = calcChange(closes, 5);
  var change15 = calcChange(closes, 15);

  // 连续站上MA20天数
  var consecDays = 0;
  for (var i = ma20Arr.length - 1; i >= 0; i--) {
    var idx = i + 19;
    if (closes[idx] > ma20Arr[i]) consecDays++;
    else break;
  }

  // 偏离度
  var deviation = ((currentPrice - ma20) / ma20) * 100;

  // === 趋势强度分（0-100） ===
  var score = 50;

  // MA20斜率（+0~15）
  score += Math.min(15, maTrendPct * 3);

  // 多头排列（+15）
  if (bullAlignment) score += 15;

  // 15日涨幅（+0~20）
  if (change15 !== null) score += Math.max(0, Math.min(20, change15 * 2));

  // 5日涨幅（+0~15）
  if (change5 !== null) score += Math.max(0, Math.min(15, change5 * 1.5));

  // 连续天数（+0~10）
  score += Math.min(10, consecDays);

  // 偏离度调整：过高减分
  if (deviation > 15) score -= 10;
  else if (deviation > 10) score -= 5;
  else if (deviation < 3) score += 3; // 紧贴均线，刚突破加分

  score = Math.max(0, Math.min(100, Math.round(score)));

  // 左右侧趋势分析（安全边际算法）
  var lrTrend = analyzeLeftRightTrend(kd);
  var safetyScore = lrTrend ? lrTrend.safetyScore : 0;
  var canBuy = lrTrend ? lrTrend.canBuy : false;

  // 信号判断：基于安全边际评分，不再依赖简单排名
  var signal, signalCls;
  if (canBuy) {
    signal = '✓ 安全买入';
    signalCls = 'buy';
  } else if (safetyScore >= 60 && score >= 60) {
    signal = '△ 趋势持有';
    signalCls = 'hold';
  } else if (safetyScore >= 50) {
    signal = '○ 关注待确认';
    signalCls = 'watch';
  } else {
    signal = '✗ 禁止交易';
    signalCls = 'wait';
  }

  return {
    score: score,
    signal: signal,
    signalCls: signalCls,
    ma20: ma20,
    ma5: ma5,
    ma10: ma10,
    currentPrice: currentPrice,
    maTrendPct: maTrendPct,
    bullAlignment: bullAlignment,
    change5: change5,
    change15: change15,
    consecDays: consecDays,
    deviation: deviation,
    safetyScore: safetyScore,
    canBuy: canBuy,
    lrTrend: lrTrend,
    lastDate: kd.dates[kd.dates.length - 1] || ''
  };
}

/**
 * 更新趋势右侧数据（扫描全部ETF，复用K线缓存）
 */
function updateTrendLeaders() {
  var container = document.getElementById('trendLeadersArea');
  if (!container) return;
  container.innerHTML = '<div class="trend-empty"><span class="spinner" style="width:12px;height:12px;border-width:1.5px;display:inline-block;vertical-align:middle;margin-right:0.3rem"></span>扫描全市场趋势中...</div>';

  var promises = TREND_CONFIG.map(function(etf) {
    return fetchKline(etf.code, 60).then(function(kd) {
      var trend = calcTrendScore(kd);
      if (!trend) {
        return { name: etf.name, code: etf.code, category: etf.category, trend: null, error: !kd };
      }
      return { name: etf.name, code: etf.code, category: etf.category, trend: trend, error: false };
    }).catch(function() {
      return { name: etf.name, code: etf.code, category: etf.category, trend: null, error: true };
    });
  });

  return Promise.all(promises).then(function(results) {
    // 二次筛选：对有趋势的标的执行多维度筛选
    var qualified = results.filter(function(r) { return r.trend !== null; });
    if (qualified.length >= 3) {
      var screenCandidates = qualified.map(function(r) {
        return fetchKline(r.code, 60).then(function(kd) {
          return {
            code: r.code,
            name: r.name,
            closes: kd ? kd.closes : null,
            klines: kd ? kd.klines : null,
            change5d: r.trend.change5 || 0
          };
        }).catch(function() {
          return { code: r.code, name: r.name, closes: null, klines: null, change5d: r.trend.change5 || 0 };
        });
      });
      return Promise.all(screenCandidates).then(function(candidatesWithData) {
        secondaryScreen(candidatesWithData);
        // 回写canBoard标志到results
        results.forEach(function(r) {
          if (r.trend) {
            var match = candidatesWithData.find(function(c) { return c.code === r.code; });
            if (match) {
              r.canBoard = match.canBoard || false;
              r.screenDetails = match.screenDetails || null;
            }
          }
        });
        renderTrendLeaders(results);
      });
    }
    renderTrendLeaders(results);
  }).catch(function(err) {
    console.warn('趋势右侧更新失败:', err);
  });
}

/**
 * 渲染趋势右侧排名
 * 只显示通过筛选的（站上MA20且均线向上），按趋势强度分降序
 */
function renderTrendLeaders(results) {
  var container = document.getElementById('trendLeadersArea');
  if (!container) return;

  // 过滤出有趋势的，按安全边际评分+趋势分综合排序（不按涨幅排名）
  var qualified = results.filter(function(r) { return r.trend !== null; });
  qualified.sort(function(a, b) {
    // 可买入的排最前
    var aBuy = a.trend.canBuy ? 1 : 0;
    var bBuy = b.trend.canBuy ? 1 : 0;
    if (aBuy !== bBuy) return bBuy - aBuy;
    // 其次按安全边际评分
    var aSafety = a.trend.safetyScore || 0;
    var bSafety = b.trend.safetyScore || 0;
    if (aSafety !== bSafety) return bSafety - aSafety;
    // 最后按趋势分
    return b.trend.score - a.trend.score;
  });

  if (qualified.length === 0) {
    container.innerHTML = '<div class="trend-empty">暂无站上20日线且均线向上的标的，市场可能处于调整期，耐心等待右侧信号</div>';
    return;
  }

  // 取前8名
  var top = qualified.slice(0, 8);

  var html = '';
  top.forEach(function(r, i) {
    var rank = i + 1;
    var rankCls = 'r' + Math.min(rank, 3);
    var t = r.trend;
    var top1Cls = rank === 1 ? ' top1' : '';

    // 均线排列标签
    var alignTag = t.bullAlignment
      ? '<span class="trend-tag bull">多头排列</span>'
      : '';

    // 强趋势标签
    var strongTag = t.score >= 75
      ? '<span class="trend-tag strong">强趋势</span>'
      : '';

    // 涨幅
    var chg5Str = t.change5 !== null ? ((t.change5 >= 0 ? '+' : '') + t.change5.toFixed(2) + '%') : '—';
    var chg15Str = t.change15 !== null ? ((t.change15 >= 0 ? '+' : '') + t.change15.toFixed(2) + '%') : '—';
    var chg5Color = t.change5 !== null && t.change5 >= 0 ? 'var(--neon-red)' : 'var(--neon-green)';
    var chg15Color = t.change15 !== null && t.change15 >= 0 ? 'var(--neon-red)' : 'var(--neon-green)';

    // 均线方向
    var maDirIcon = t.maTrendPct > 0 ? '↑' : '↓';
    var maDirColor = t.maTrendPct > 0 ? 'var(--neon-red)' : 'var(--neon-green)';

    html += '<div class="trend-card' + top1Cls + '" onclick="showEtfRecommend(\'' + r.code + '\', \'' + escapeHtmlAttr(r.name) + '\', \'' + escapeHtmlAttr(r.category) + '\', \'right\')" style="cursor:pointer" title="点击查看ETF推荐">' +
      '<div class="trend-rank ' + rankCls + '">' + rank + '</div>' +
      '<div class="trend-info">' +
        '<div class="trend-name">' + r.name + alignTag + strongTag + '</div>' +
        '<div class="trend-meta">' +
          '<span>5日 <b style="color:' + chg5Color + '">' + chg5Str + '</b></span>' +
          '<span>15日 <b style="color:' + chg15Color + '">' + chg15Str + '</b></span>' +
          '<span>MA20 ' + t.ma20.toFixed(2) + '</span>' +
          '<span style="color:' + maDirColor + '">' + maDirIcon + ' ' + Math.abs(t.maTrendPct).toFixed(2) + '%</span>' +
          '<span>站上' + t.consecDays + '天</span>' +
          '<span>偏离' + (t.deviation >= 0 ? '+' : '') + t.deviation.toFixed(1) + '%</span>' +
        '</div>' +
      '</div>' +
      '<div class="trend-score-area">' +
        '<div style="display:flex;gap:0.3rem;justify-content:center">' +
          '<div style="text-align:center"><div style="font-size:0.5rem;color:var(--muted)">趋势分</div><div class="trend-score" style="font-size:1.1rem">' + t.score + '</div></div>' +
          '<div style="text-align:center"><div style="font-size:0.5rem;color:var(--muted)">安全边际</div><div class="trend-score" style="font-size:1.1rem;color:' + (t.safetyScore >= 70 ? 'var(--neon-red)' : t.safetyScore >= 50 ? 'var(--neon-yellow)' : 'var(--neon-green)') + '">' + (t.safetyScore || 0) + '</div></div>' +
        '</div>' +
        '<div class="trend-score-bar"><div class="trend-score-fill" style="width:' + t.score + '%"></div></div>' +
        '<div class="trend-signal ' + t.signalCls + '">' + t.signal + '</div>' +
      '</div>' +
    '</div>';
  });

  // 底部说明
  html += '<div class="sd-flow-note" style="margin-top:0.4rem">※ 左右侧趋势分析算法：①左侧5根K线连续收阳且均涨≤3% ②右侧突破MA20且放量≥30% ③回撤>5%抑制买入 ④安全边际评分(波动率+RSI 40-60+MACD收敛)≥70分方可交易。排序=可买入>安全边际>趋势分，非涨幅排名</div>';

  container.innerHTML = html;
}

/* ============================================================
   十一·六C、左侧抄底·超跌蓄势
   扫描全市场ETF，筛选跌破MA20且超跌的标的，按抄底潜力分排序
   左侧交易：逆向布局，在底部区域分批建仓，等趋势反转
   ============================================================ */

/**
 * 计算左侧抄底潜力分（0-100）
 * 条件：跌破MA20（处于下跌趋势中）
 * 评分维度：
 *   1. 近期最大回撤 → 跌得越多风险释放越充分
 *   2. 离MA20偏离度 → 偏离越大越超跌
 *   3. 是否接近MA60支撑 → 长期均线支撑加分
 *   4. 5日跌幅减速 → 跌势放缓（企稳信号）
 *   5. 15日跌幅 → 中期超跌程度
 *   6. 连续跌破MA20天数 → 跌久了可能接近底部
 *   7. 5日均线下穿10日线的距离 → 短期超卖程度
 */
function calcBottomScore(kd) {
  if (!kd || !kd.closes || kd.closes.length < 25) return null;

  var closes = kd.closes;
  var n = closes.length;

  // 计算MA20序列（滑动窗口O(n)优化）
  var ma20Arr = [];
  var maSum = 0;
  for (var i = 0; i < n; i++) {
    maSum += closes[i];
    if (i >= 20) maSum -= closes[i - 20];
    if (i >= 19) ma20Arr.push(maSum / 20);
  }
  if (ma20Arr.length < 6) return null;

  var currentPrice = closes[n - 1];
  var ma20 = ma20Arr[ma20Arr.length - 1];

  // 条件1：必须跌破MA20（在MA20下方）
  if (currentPrice >= ma20) return null;

  // MA60长期均线（如果有足够数据）
  var ma60 = null;
  if (n >= 60) {
    var s60 = 0;
    for (var k = 0; k < 60; k++) s60 += closes[n - 1 - k];
    ma60 = s60 / 60;
  }

  // MA5 MA10
  var ma5 = 0, ma10 = 0;
  if (n >= 5) { for (var k = 0; k < 5; k++) ma5 += closes[n - 1 - k]; ma5 /= 5; }
  if (n >= 10) { for (var k = 0; k < 10; k++) ma10 += closes[n - 1 - k]; ma10 /= 10; }

  // 偏离MA20的程度（负值，越负越超跌）
  var deviation = ((currentPrice - ma20) / ma20) * 100;

  // 最大回撤（近30日）
  var lookback = Math.min(30, n);
  var peak = closes[n - lookback];
  var maxDD = 0;
  for (var i = n - lookback; i < n; i++) {
    if (closes[i] > peak) peak = closes[i];
    var dd = (peak - closes[i]) / peak * 100;
    if (dd > maxDD) maxDD = dd;
  }

  // 涨幅
  var change5 = calcChange(closes, 5);
  var change15 = calcChange(closes, 15);

  // 连续跌破MA20天数
  var belowDays = 0;
  for (var i = ma20Arr.length - 1; i >= 0; i--) {
    var idx = i + 19;
    if (closes[idx] < ma20Arr[i]) belowDays++;
    else break;
  }

  // 5日跌幅 vs 15日跌幅 → 跌速变化
  var change5Val = change5 !== null ? change5 : 0;
  var change15Val = change15 !== null ? change15 : 0;
  // 跌速放缓：5日跌幅 < 15日跌幅/3（说明跌势在减速）
  var decelerating = change5Val > change15Val / 3;

  // MA60支撑度
  var nearMA60 = false;
  var ma60Dist = 0;
  if (ma60 !== null && ma60 > 0) {
    ma60Dist = ((currentPrice - ma60) / ma60) * 100;
    // 离MA60在-3%~+2%范围内算接近支撑
    nearMA60 = ma60Dist >= -3 && ma60Dist <= 2;
  }

  // === 抄底潜力分（0-100） ===
  var score = 50;

  // 最大回撤（+0~20）：跌越多分越高
  score += Math.min(20, maxDD * 0.8);

  // 偏离MA20（+0~15）：偏离越大越超跌
  score += Math.min(15, Math.abs(deviation) * 1.5);

  // 接近MA60支撑（+15）
  if (nearMA60) score += 15;

  // 跌速放缓（+10）：企稳信号
  if (decelerating && change5Val > -3) score += 10;

  // 15日跌幅（+0~10）：中期超跌
  if (change15Val < -10) score += 10;
  else if (change15Val < -5) score += 5;

  // 连续跌破天数（+0~5）：跌久了加分但不能太久
  if (belowDays >= 5 && belowDays <= 20) score += 5;
  else if (belowDays > 30) score -= 5; // 跌太久可能是趋势性下跌

  // 过于暴跌（5日跌超15%）减分：可能是飞刀
  if (change5Val < -15) score -= 15;
  else if (change5Val < -10) score -= 8;

  score = Math.max(0, Math.min(100, Math.round(score)));

  // 左右侧趋势分析（安全边际算法）
  var lrTrend = analyzeLeftRightTrend(kd);
  var safetyScore = lrTrend ? lrTrend.safetyScore : 0;
  var canBuy = lrTrend ? lrTrend.canBuy : false;

  // 信号判断：基于安全边际评分，抄底也需安全边际≥70
  var signal, signalCls;
  if (canBuy && score >= 55) {
    signal = '✓ 安全抄底';
    signalCls = 'buy';
  } else if (safetyScore >= 60 && (nearMA60 || decelerating)) {
    signal = '△ 关注企稳';
    signalCls = 'watch';
  } else if (safetyScore >= 50) {
    signal = '○ 继续等待';
    signalCls = 'watch';
  } else {
    signal = '✗ 禁止交易';
    signalCls = 'wait';
  }

  // 标签
  var tags = [];
  if (maxDD > 15) tags.push({ text: '超跌' + maxDD.toFixed(0) + '%', cls: 'oversold' });
  if (nearMA60) tags.push({ text: 'MA60支撑', cls: 'support' });
  if (decelerating && change5Val > -3) tags.push({ text: '跌速放缓', cls: 'bounce' });

  return {
    score: score,
    signal: signal,
    signalCls: signalCls,
    tags: tags,
    ma20: ma20,
    ma60: ma60,
    ma5: ma5,
    ma10: ma10,
    currentPrice: currentPrice,
    deviation: deviation,
    maxDD: maxDD,
    change5: change5,
    change15: change15,
    belowDays: belowDays,
    nearMA60: nearMA60,
    ma60Dist: ma60Dist,
    decelerating: decelerating,
    safetyScore: safetyScore,
    canBuy: canBuy,
    lrTrend: lrTrend,
    lastDate: kd.dates[kd.dates.length - 1] || ''
  };
}

/**
 * 更新左侧抄底数据（复用TREND_CONFIG和K线缓存）
 */
function updateBottomPick() {
  var container = document.getElementById('bottomPickArea');
  if (!container) return;
  container.innerHTML = '<div class="bottom-empty"><span class="spinner" style="width:12px;height:12px;border-width:1.5px;display:inline-block;vertical-align:middle;margin-right:0.3rem"></span>扫描超跌标的中...</div>';

  var promises = TREND_CONFIG.map(function(etf) {
    return fetchKline(etf.code, 60).then(function(kd) {
      var bottom = calcBottomScore(kd);
      if (!bottom) {
        return { name: etf.name, code: etf.code, category: etf.category, bottom: null, error: !kd };
      }
      return { name: etf.name, code: etf.code, category: etf.category, bottom: bottom, error: false };
    }).catch(function() {
      return { name: etf.name, code: etf.code, category: etf.category, bottom: null, error: true };
    });
  });

  return Promise.all(promises).then(function(results) {
    renderBottomPick(results);
  }).catch(function(err) {
    console.warn('左侧抄底更新失败:', err);
  });
}

/**
 * 渲染左侧抄底排名
 * 只显示通过筛选的（跌破MA20的超跌标的），按抄底潜力分降序
 */
function renderBottomPick(results) {
  var container = document.getElementById('bottomPickArea');
  if (!container) return;

  // 过滤出超跌的，按安全边际评分+抄底分综合排序（不按涨幅排名）
  var qualified = results.filter(function(r) { return r.bottom !== null; });
  qualified.sort(function(a, b) {
    var aBuy = a.bottom.canBuy ? 1 : 0;
    var bBuy = b.bottom.canBuy ? 1 : 0;
    if (aBuy !== bBuy) return bBuy - aBuy;
    var aSafety = a.bottom.safetyScore || 0;
    var bSafety = b.bottom.safetyScore || 0;
    if (aSafety !== bSafety) return bSafety - aSafety;
    return b.bottom.score - a.bottom.score;
  });

  if (qualified.length === 0) {
    container.innerHTML = '<div class="bottom-empty">暂无超跌标的，市场整体趋势偏强，无左侧抄底机会</div>';
    return;
  }

  // 取前8名
  var top = qualified.slice(0, 8);

  var html = '';
  top.forEach(function(r, i) {
    var rank = i + 1;
    var rankCls = 'r' + Math.min(rank, 3);
    var b = r.bottom;
    var top1Cls = rank === 1 ? ' top1' : '';

    // 标签
    var tagsHtml = '';
    b.tags.forEach(function(tag) {
      tagsHtml += '<span class="bottom-tag ' + tag.cls + '">' + tag.text + '</span>';
    });

    // 涨幅
    var chg5Str = b.change5 !== null ? ((b.change5 >= 0 ? '+' : '') + b.change5.toFixed(2) + '%') : '—';
    var chg15Str = b.change15 !== null ? ((b.change15 >= 0 ? '+' : '') + b.change15.toFixed(2) + '%') : '—';
    var chg5Color = b.change5 !== null && b.change5 >= 0 ? 'var(--neon-red)' : 'var(--neon-green)';
    var chg15Color = b.change15 !== null && b.change15 >= 0 ? 'var(--neon-red)' : 'var(--neon-green)';

    // MA60距离
    var ma60Str = b.ma60 !== null ? b.ma60.toFixed(2) : '—';
    var ma60DistStr = b.ma60 !== null ? (b.ma60Dist >= 0 ? '+' : '') + b.ma60Dist.toFixed(1) + '%' : '—';
    var ma60Color = b.nearMA60 ? 'var(--neon-cyan)' : 'var(--muted)';

    html += '<div class="bottom-card' + top1Cls + '" onclick="showEtfRecommend(\'' + r.code + '\', \'' + escapeHtmlAttr(r.name) + '\', \'' + escapeHtmlAttr(r.category) + '\', \'left\')" style="cursor:pointer" title="点击查看ETF推荐">' +
      '<div class="bottom-rank ' + rankCls + '">' + rank + '</div>' +
      '<div class="bottom-info">' +
        '<div class="bottom-name">' + r.name + tagsHtml + '</div>' +
        '<div class="bottom-meta">' +
          '<span>5日 <b style="color:' + chg5Color + '">' + chg5Str + '</b></span>' +
          '<span>15日 <b style="color:' + chg15Color + '">' + chg15Str + '</b></span>' +
          '<span>回撤-' + b.maxDD.toFixed(1) + '%</span>' +
          '<span>偏离MA20 ' + b.deviation.toFixed(1) + '%</span>' +
          '<span>MA60 ' + ma60Str + ' <b style="color:' + ma60Color + '">' + ma60DistStr + '</b></span>' +
          '<span>跌破' + b.belowDays + '天</span>' +
        '</div>' +
      '</div>' +
      '<div class="bottom-score-area">' +
        '<div style="display:flex;gap:0.3rem;justify-content:center">' +
          '<div style="text-align:center"><div style="font-size:0.5rem;color:var(--muted)">抄底分</div><div class="bottom-score" style="font-size:1.1rem">' + b.score + '</div></div>' +
          '<div style="text-align:center"><div style="font-size:0.5rem;color:var(--muted)">安全边际</div><div class="bottom-score" style="font-size:1.1rem;color:' + (b.safetyScore >= 70 ? 'var(--neon-red)' : b.safetyScore >= 50 ? 'var(--neon-yellow)' : 'var(--neon-green)') + '">' + (b.safetyScore || 0) + '</div></div>' +
        '</div>' +
        '<div class="bottom-score-bar"><div class="bottom-score-fill" style="width:' + b.score + '%"></div></div>' +
        '<div class="bottom-signal ' + b.signalCls + '">' + b.signal + '</div>' +
      '</div>' +
    '</div>';
  });

  // 底部说明
  html += '<div class="sd-flow-note" style="margin-top:0.4rem">※ 左右侧趋势分析算法（抄底版）：需满足左侧5连阳温和上升+右侧突破MA20放量+回撤<5%+安全边际≥70分才触发安全抄底。排序=可买入>安全边际>抄底分，非涨幅排名。左侧交易需严格止损</div>';

  container.innerHTML = html;
}

/**
 * 获取K线数据（走势图+轮动+行业信号）
 * 合并到runAnalysis统一调用，也可单独触发
 * @param {function} onProgress - 进度回调(msg)
 * @returns {Promise}
 */
function fetchKlineData(onProgress) {
  onProgress = onProgress || function() {};
  onProgress('正在获取K线数据（2并发·分层顺序）...');

  // 分层顺序获取：双线轮动 → 动量轮动 → 行业信号 → 趋势右侧
  // 每层完成后立即渲染，层间间隔200ms给服务器喘息（优化后更流畅）
  var LAYER_DELAY = 200; // 层间延迟ms

  var workPromise = updateRotation()
    .then(function() {
      onProgress('双线轮动完成，正在获取动量轮动...');
      return new Promise(function(resolve) {
        Perf.trackedSetTimeout(function() { resolve(updateMomentumRotation()); }, LAYER_DELAY);
      });
    })
    .then(function() {
      onProgress('动量轮动完成，正在获取行业信号...');
      return new Promise(function(resolve) {
        Perf.trackedSetTimeout(function() { resolve(updateIndustrySignals()); }, LAYER_DELAY);
      });
    })
    .then(function() {
      onProgress('行业信号完成，正在扫描趋势右侧...');
      return new Promise(function(resolve) {
        Perf.trackedSetTimeout(function() { resolve(updateTrendLeaders()); }, LAYER_DELAY);
      });
    })
    .then(function() {
      onProgress('趋势右侧完成，正在扫描左侧抄底...');
      return new Promise(function(resolve) {
        Perf.trackedSetTimeout(function() { resolve(updateBottomPick()); }, LAYER_DELAY);
      });
    })
    .then(function() {
      onProgress('K线数据全部获取完成');
    });

  // 60秒总超时：超时后不再阻塞主流程，后台请求完成后自动更新缓存和UI
  var timeoutPromise = new Promise(function(resolve) {
    Perf.trackedSetTimeout(function() { resolve('timeout'); }, KLINE_TOTAL_TIMEOUT);
  });

  return Promise.race([workPromise, timeoutPromise]).then(function(result) {
    if (result === 'timeout') {
      if(__DEBUG__)console.log('K线阶段达到总超时，后台继续获取剩余数据');
      onProgress('K线数据部分完成（后台继续获取）');
    } else {
      onProgress('K线数据更新完成');
    }
  }).catch(function(err) {
    console.warn('K线更新异常:', err);
    onProgress('部分K线数据获取失败');
  }).then(function() {
    updateKlineStatus();
  });
}

/** 保留旧函数名兼容 */
var refreshRotation = function() { return fetchKlineData(); };

/**
 * 旧函数兼容：refreshKlineData 委托给独立的K线获取
 */
function refreshKlineData() {
  fetchKlineOnly();
}

/**
 * 更新K线状态显示
 */
function updateKlineStatus() {
  var lastUpdate = getKlineLastUpdate();
  var statusText = lastUpdate
    ? 'K线数据更新于 ' + lastUpdate
    : '⏳ K线数据将在页面加载后自动获取...';
  var statusColor = lastUpdate ? getSignalColor('green') : 'var(--muted)';

  // 更新策略Tab中的状态
  var el = document.getElementById('klineStatus');
  if (el) { el.textContent = statusText; el.style.color = statusColor; }

  // 更新顶部状态
  var elTop = document.getElementById('klineStatusTop');
  if (elTop) { elTop.textContent = statusText; elTop.style.color = statusColor; }
}

/**
 * 尝试用缓存数据渲染K线相关内容（不发起网络请求）
 * 在runAnalysis中调用，如果有缓存就先展示
 */
function renderKlineFromCache() {
  // 检查是否有任何localStorage缓存的K线数据（用于轮动和行业信号）
  var hasCache = false;
  try {
    hasCache = _getKlineKeyRegistry().length > 0;
  } catch(e) {}

  updateKlineStatus();

  // 如果有缓存数据，也渲染所有策略信号板块（fetchKline会命中缓存，不发网络请求）
  if (hasCache) {
    updateRotation();
    updateMomentumRotation();  // 修复：缓存渲染路径遗漏动量轮动
    updateIndustrySignals();
    updateTrendLeaders();
    updateBottomPick();
  }
}

/**
 * 刷新市场情绪数据（可复用，被 runAnalysis 和自动刷新调用）
 * @param {boolean} forceRefresh - 强制刷新（忽略缓存）
 * @returns {Promise} 返回 Promise 以便调用方链式处理
 */
function refreshSentimentData(forceRefresh) {
  return fetchMarketSentiment(forceRefresh).then(function(data) {
    _lastSentimentData = data;
    // 记录情绪历史数据用于回归预测
    if (data) recordSentimentHistory(data);
    renderSentimentPanel(data);
    renderEarlyWarnings(data);
    generateDailyReview(false);
    // 首次获取失败时自动重试一次（延迟3秒，应对瞬时网络抖动）
    if (!data && !forceRefresh) {
      if(__DEBUG__)console.warn('情绪数据获取失败，3秒后自动重试...');
      Perf.trackedSetTimeout(function() {
        fetchMarketSentiment(true).then(function(retryData) {
          if (retryData) {
            _lastSentimentData = retryData;
            // 重试成功也记录历史
            recordSentimentHistory(retryData);
            renderSentimentPanel(retryData);
            renderEarlyWarnings(retryData);
            generateDailyReview(false);
          }
        }).catch(function() {});
      }, 3000);
    }
  }).catch(function() {
    renderSentimentPanel(null);
    renderEarlyWarnings(null);
  });
}

/**
 * 手动刷新市场情绪：清空缓存 → 重新拉取 → 重新计算
 * 包含完善的错误处理和用户反馈
 */
var _sentRefreshLock = false;
function refreshSentimentManual() {
  if (_sentRefreshLock) return;
  _sentRefreshLock = true;
  var btn = document.getElementById('sentRefreshBtn');
  var updateTime = document.getElementById('sentUpdateTime');

  try {
    if (btn) btn.classList.add('spinning');
    if (updateTime) updateTime.textContent = '刷新中…';

    // 清空情绪缓存
    try { localStorage.removeItem(SENTIMENT_CACHE_KEY); } catch(e) {}

    // 强制刷新拉取数据
    var p = refreshSentimentData(true);

    // 通过返回的 Promise 感知刷新完成
    if (p && typeof p.then === 'function') {
      p.then(function() {
        // 刷新完成（renderSentimentPanel 内部已更新时间显示）
        if (btn) btn.classList.remove('spinning');
        _sentRefreshLock = false;
      }).catch(function() {
        // 兜底：确保解锁和 UI 恢复
        if (btn) btn.classList.remove('spinning');
        if (updateTime) updateTime.textContent = '刷新失败';
        _sentRefreshLock = false;
      });
    } else {
      // refreshSentimentData 未返回 Promise，使用超时兜底
      Perf.trackedSetTimeout(function() {
        if (btn) btn.classList.remove('spinning');
        _sentRefreshLock = false;
      }, 5000);
    }
  } catch(err) {
    console.error('[情绪刷新] 异常:', err);
    if (btn) btn.classList.remove('spinning');
    if (updateTime) updateTime.textContent = '刷新失败，请重试';
    _sentRefreshLock = false;
  }
}

/**
 * 自动获取实时行情（页面加载时调用，无需手动按钮）
 *   策略：每天10:30后拉取最新行情，10:30前使用昨日缓存
 *   - 判断当天是否已过10:30，以及缓存时间戳是否在当天10:30之后
 *   - 缓存有效则直接用缓存渲染，否则发起新请求
 *   - 静默执行，不操作任何按钮（按钮已移除）
 * 
 * 缓存键: quote_cache_v4（含日期+时间戳，支持10:30跨日判断）
 * 
 * @param {boolean} forceRefresh - 强制刷新（忽略缓存，清K线缓存）
 */
function runAnalysis(forceRefresh) {
  // 防重复
  if (_isFetching) {
    if(__DEBUG__)console.log('实时行情获取中，跳过');
    return;
  }

  _isFetching = true;
  if (forceRefresh) {
    clearKlineCache();
  }

  // 获取所有指数 + 行业板块ETF + 龙头股的腾讯代码
  var indexCodes = BASE_DATA.indices.map(function(i) { return i.code; });
  var sectorCodes = BASE_DATA.sectors.map(function(s) { return s.etfCode; });
  var leaderCodes = getLeaderStockCodes();
  var allCodes = indexCodes.concat(sectorCodes).concat(leaderCodes);
  var realtimeData = null;
  var quoteSuccess = false;

  // === 行情缓存：交易时段5分钟刷新 + 非交易时段收盘缓存 ===
  var QUOTE_CACHE_KEY = 'quote_cache_v4';

  // 判断是否需要刷新：
  // - 交易时段（9:25-15:05）：缓存超过5分钟即需刷新
  // - 收盘后（15:05后）：缓存必须持有当天收盘数据（缓存时间 >= 最近交易日15:05）才算有效
  // - 开盘前（9:25前）/ 周末：使用最近一个交易日的收盘缓存
  function needRefreshQuote() {
    if (forceRefresh) return true;
    try {
      var raw = localStorage.getItem(QUOTE_CACHE_KEY);
      if (!raw) return true; // 无缓存
      var obj = JSON.parse(raw);
      var cacheTs = obj.ts;
      var now = new Date();
      var nowMs = now.getTime();
      var y = now.getFullYear(), mo = now.getMonth(), d = now.getDate();
      var today925 = new Date(y, mo, d, 9, 25, 0).getTime();

      // 交易时段内：缓存超过5分钟即需刷新
      if (isInTradingSession()) {
        return (nowMs - cacheTs) > 5 * 60 * 1000;
      }

      // 非交易时段：定位“最近一个交易日”，要求缓存持有该日收盘数据
      var closeDay = new Date(y, mo, d);
      var day = now.getDay(); // 0=周日, 6=周六
      if (day === 0 || day === 6) {
        // 周末：回退到上周五
        closeDay.setDate(closeDay.getDate() - (day === 0 ? 2 : 1));
      } else if (nowMs < today925) {
        // 工作日开盘前（9:25前）：使用上一交易日的收盘缓存
        closeDay.setDate(closeDay.getDate() - 1);
        if (closeDay.getDay() === 0) closeDay.setDate(closeDay.getDate() - 2); // 周日→上周五
      }
      // 否则：工作日15:05后，closeDay 即为今天
      var lastCloseTs = new Date(closeDay.getFullYear(), closeDay.getMonth(), closeDay.getDate(), 15, 5, 0).getTime();
      // 缓存时间早于最近交易日15:05 → 未持有收盘数据，需刷新
      return cacheTs < lastCloseTs;
    } catch(e) {
      return true;
    }
  }

  function getCachedQuote() {
    try {
      var raw = localStorage.getItem(QUOTE_CACHE_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if(__DEBUG__)console.log('使用行情缓存（' + Math.round((Date.now() - obj.ts) / 60000) + '分钟前）');
      return obj.data;
    } catch(e) {}
    return null;
  }

  function setCachedQuote(data) {
    try {
      localStorage.setItem(QUOTE_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: data }));
    } catch(e) {}
  }

  // 决定：用缓存 or 发请求
  var quotePromise;
  if (needRefreshQuote()) {
    if(__DEBUG__)console.log('行情缓存过期或不存在，发起新请求');
    quotePromise = fetchTencentBatch(allCodes).then(function(data) {
      setCachedQuote(data);
      return data;
    });
  } else {
    var cached = getCachedQuote();
    if (cached) {
      quotePromise = Promise.resolve(cached);
    } else {
      quotePromise = fetchTencentBatch(allCodes).then(function(data) {
        setCachedQuote(data);
        return data;
      });
    }
  }

  // ========== 分阶段数据获取（避免并发请求风暴） ==========
  // 阶段1：核心行情 + 国债收益率（最高优先级，用户最先看到）
  Promise.all([
    quotePromise.then(function(data) {
      realtimeData = data;
      _lastRealtimeData = data;
      quoteSuccess = true;
      renderIndexCards(data);
      renderSpotlight(data);
      renderIndustryLeaders(data);
      updateHeaderTime(true);
      generateDailyReview(false);
      // 独立备份触发：确保盘口推演即使复盘失败也能启动
      Perf.trackedSetTimeout(function() {
        if (typeof runPatternAnalysis === 'function') runPatternAnalysis(false);
      }, 2000);
    }).catch(function(err) {
      console.warn('实时行情获取失败:', err.message);
      // 尝试使用过期缓存作为最后降级
      var staleCache = null;
      try {
        var raw = localStorage.getItem(QUOTE_CACHE_KEY);
        if (raw) staleCache = JSON.parse(raw).data;
      } catch(e) {}
      if (staleCache && Object.keys(staleCache).length > 0) {
        if(__DEBUG__)console.log('所有API失败，使用过期缓存数据');
        realtimeData = staleCache;
        _lastRealtimeData = staleCache;
        quoteSuccess = true;
        renderIndexCards(staleCache);
        renderSpotlight(staleCache);
        renderIndustryLeaders(staleCache);
        updateHeaderTime(true);
        showToast('⚠️ 实时API暂时不可用，已使用上次缓存数据');
        // 缓存数据也触发盘口推演
        Perf.trackedSetTimeout(function() {
          if (typeof generateDailyReview === 'function') generateDailyReview(false);
          if (typeof runPatternAnalysis === 'function') runPatternAnalysis(false);
        }, 800);
      } else {
        showToast('⚠️ 实时行情获取失败，已使用基准数据展示');
        renderIndexCards(null);
        renderSpotlight(null);
        renderIndustryLeaders(null);
        updateHeaderTime(false);
      }
    }),
    fetchTreasuryYield().catch(function(err) { console.warn('[国债] Promise.all内捕获失败，使用默认值', err); })
  ]).then(function() {
    // 阶段1完成：渲染核心图表和解读
    drawHeatmap();
    drawPEBar(realtimeData);
    generateInsights(realtimeData);
    renderOverview(realtimeData);
    renderDashboard(realtimeData);
    renderKlineFromCache();

    if (quoteSuccess) {
      if(__DEBUG__)console.log('实时行情自动获取完成');
    } else {
      console.warn('行情获取失败，已使用基准数据展示');
    }

    // 阶段2：板块主力资金流向（核心行情完成后获取，避免并发竞争）
    return fetchSectorCapitalFlow().then(function(data) {
      _lastSectorFlowData = data;
      renderMarketFlow(data);
      renderSectorCapitalAnalysis(data);
      generateDailyReview(false);
      // 资金流向数据就绪后，刷新消息面分析（纳入实时资金因素）
      renderNewsAnalysis();
    }).catch(function() {
      renderMarketFlow(null);
      renderSectorCapitalAnalysis(null);
    }).then(function() {
      // 阶段2.5：消息面分析（基于已有数据快速渲染，同时获取动态新闻）
      renderNewsAnalysis();
      // 并行获取动态新闻（不阻塞主流程）
      fetchLatestNews(false).then(function(news) {
        // 成功获取数据，清除错误状态
        _naErrorState = null;
        _naLastErrorTime = null;
        updateNewsData(news);
        startNewsAutoRefresh(); // 启动新闻自动刷新
      }).catch(function(err) {
        // 初始加载失败，设置错误状态
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
        if (typeof __DEBUG__ !== 'undefined' && __DEBUG__) console.log('[新闻初始加载] 失败:', errMsg);
        renderNewsAnalysis(); // 渲染错误提示
        startNewsAutoRefresh(); // 仍然启动自动刷新，后续可能恢复
      });
    }).then(function() {
      // 阶段3：市场情绪数据（最后获取，优先级最低，且自带缓存策略）
      return refreshSentimentData(forceRefresh);
    }).then(function() {
      // 阶段3.5：刷新消息面分析（纳入情绪数据后更新）
      renderNewsAnalysis();
      // 阶段3.6：所有数据就绪后，强制重新推演盘口（覆盖之前的兜底结果）
      Perf.trackedSetTimeout(function() {
        if (typeof runPatternAnalysis === 'function') runPatternAnalysis(true);
      }, 500);
      _isFetching = false;
    }).catch(function(err) {
      console.warn('数据获取异常:', err);
      showToast('⚠️ 数据加载异常，已展示基准数据');
      renderIndexCards(null);
      renderOverview();
      renderDashboard(null);
      renderIndustryLeaders(null);
      drawHeatmap();
      drawPEBar(null);
      renderKlineFromCache();
      renderNewsAnalysis();
      _isFetching = false;
    });
  });
}

/**
 * 全局强制刷新：清除所有缓存 + 重置状态 + 重新拉取全部数据
 * 用于卡片刷新按钮和手动重试
 */
function forceRefreshAll() {
  // 重置可能卡住的状态
  _isFetching = false;
  _paAnalysisLock = false;
  _paRetryCount = 0;
  _paWasFallback = false;
  // 重置全局并发信号量（防止泄漏导致死锁）
  _globalReqActive = 0;
  _globalReqQueue = [];

  // 清除行情缓存
  try { localStorage.removeItem('quote_cache_v4'); } catch(e) {}
  try { localStorage.removeItem('sector_flow_cache_v2'); } catch(e) {}

  showToast('🔄 正在重新拉取数据…');
  runAnalysis(true);
}

/**
 * 刷新单个模块数据
 * @param {string} module - 模块名: 'quote'|'flow'|'pattern'|'news'|'sentiment'
 */
function refreshModule(module) {
  switch(module) {
    case 'quote':
      _isFetching = false;
      try { localStorage.removeItem('quote_cache_v4'); } catch(e) {}
      runAnalysis(true);
      break;
    case 'flow':
      try { localStorage.removeItem('sector_flow_cache_v2'); } catch(e) {}
      fetchSectorCapitalFlow().then(function(data) {
        _lastSectorFlowData = data;
        renderMarketFlow(data);
        renderSectorCapitalAnalysis(data);
        renderNewsAnalysis();
        showToast('✅ 资金流向已刷新');
      }).catch(function() {
        renderMarketFlow(null);
        showToast('⚠️ 资金流向刷新失败');
      });
      break;
    case 'pattern':
      _paAnalysisLock = false;
      _paRetryCount = 0;
      runPatternAnalysis(true);
      showToast('🔄 盘口推演刷新中…');
      break;
    case 'news':
      refreshNewsAnalysis();
      break;
    case 'sentiment':
      if (typeof refreshSentimentManual === 'function') {
        refreshSentimentManual();
      } else {
        refreshSentimentData(true).then(function() {
          renderNewsAnalysis();
          showToast('✅ 情绪数据已刷新');
        });
      }
      break;
    default:
      forceRefreshAll();
  }
}

// 确保全局可访问（onclick 调用）
window.forceRefreshAll = forceRefreshAll;
window.refreshModule = refreshModule;

/**
 * 独立获取K线数据（分层顺序获取 · 防封禁）
 *   用户主动触发，分层顺序获取：双线轮动→动量轮动→行业信号
 *   2并发 + 层间500ms延迟 + 30秒冷却防频繁请求
 */
var _isKlineFetching = false;
var _lastKlineFetchTime = 0;
function fetchKlineOnly() {
  var btn = document.getElementById('btnKline');
  if (!btn) return;

  // 防重复点击
  if (_isKlineFetching) {
    showToast('K线数据获取中，请稍候...');
    return;
  }

  // 冷却检查
  if (_lastKlineFetchTime > 0) {
    var elapsed = Date.now() - _lastKlineFetchTime;
    if (elapsed < FULL_FETCH_COOLDOWN) {
      var waitSec = Math.ceil((FULL_FETCH_COOLDOWN - elapsed) / 1000);
      showToast('请' + waitSec + '秒后再试（防频繁请求）');
      return;
    }
  }

  _isKlineFetching = true;
  _lastKlineFetchTime = Date.now();

  btn.disabled = true;
  btn.classList.add('loading');
  btn.innerHTML = '<span class="spinner"></span>获取K线...';

  fetchKlineData(function(msg) {
    btn.innerHTML = '<span class="spinner"></span>' + msg;
  }).then(function() {
    showToast('K线数据获取完成');
  }).catch(function(err) {
    console.warn('K线获取异常:', err);
    showToast('部分K线数据获取失败');
  }).then(function() {
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.innerHTML = '获取K线数据';
    _isKlineFetching = false;
  });
}

/* ============================================================
   十一·六D、ETF推荐弹窗功能
   点击趋势右侧或左侧抄底ETF卡片时，推荐相关ETF并说明原因
   ============================================================ */

/**
 * ETF推荐知识库：按类别和特点分组
 */
var ETF_RECOMMEND_DB = {
  industries: [
    { name: '半导体ETF', code: 'sh512480', keywords: ['芯片', '半导体', 'AI硬件'], reason: 'AI算力核心器件，国产替代主线' },
    { name: '算力ETF', code: 'sz159820', keywords: ['算力', '云计算', '数据中心'], reason: '算力需求爆发，AI基础设施' },
    { name: '机器人ETF', code: 'sh562500', keywords: ['机器人', '工业自动化', '人形机器人'], reason: '人形机器人产业化加速' },
    { name: 'AI应用ETF', code: 'sh515980', keywords: ['AI', '大模型', '应用'], reason: 'AI应用落地，商业化加速' },
    { name: 'CPO光通信ETF', code: 'sh515880', keywords: ['光通信', 'CPO', '光纤'], reason: '算力互联核心器件' },
    { name: '消费ETF', code: 'sz159928', keywords: ['消费', '食品饮料', '内需'], reason: '促消费政策受益，内需核心资产' },
    { name: '医药ETF', code: 'sh512010', keywords: ['医药', '医疗', '创新药'], reason: '人口老龄化刚需，估值低位' },
    { name: '创新药ETF', code: 'sz159992', keywords: ['创新药', '生物医药', 'CXO'], reason: '创新药械出海加速' },
    { name: '电力ETF', code: 'sz159611', keywords: ['电力', '公用事业', '绿电'], reason: '电改受益，稳定现金流' },
    { name: '特高压ETF', code: 'sh562350', keywords: ['特高压', '电网', '电力设备'], reason: '电网投资加码，新能源外送' },
    { name: '有色ETF', code: 'sh512400', keywords: ['有色', '铜', '铝', '稀土'], reason: '资源品通胀受益' },
    { name: '军工ETF', code: 'sh512660', keywords: ['军工', '国防', '航天'], reason: '国防预算增长确定性高' },
    { name: '新能源ETF', code: 'sh516160', keywords: ['新能源', '光伏', '储能'], reason: '能源转型长期主线' },
    { name: '芯片ETF', code: 'sh512760', keywords: ['芯片', '半导体设备', '国产替代'], reason: '半导体设备国产替代加速' },
    { name: '黄金ETF', code: 'sh518880', keywords: ['黄金', '贵金属', '避险'], reason: '避险资产，对冲风险' },
  ],
  broad: [
    { name: '沪深300ETF', code: 'sh510300', keywords: ['大盘', '蓝筹', '核心资产'], reason: 'A股核心资产，估值低位' },
    { name: '创业板ETF', code: 'sz159915', keywords: ['创业板', '成长', '科技'], reason: '成长股代表，弹性大' },
    { name: '中证500ETF', code: 'sh510500', keywords: ['中盘', '中小盘'], reason: '中小盘代表，估值适中' },
    { name: '科创50ETF', code: 'sh588000', keywords: ['科创板', '硬科技'], reason: '硬科技龙头集合' },
    { name: '纳指ETF', code: 'sh513100', keywords: ['美股', '纳斯达克', '科技'], reason: '全球科技龙头' },
    { name: '恒生科技ETF', code: 'sh513130', keywords: ['港股', '互联网', '科技'], reason: '港股科技估值修复' },
    { name: '中概互联ETF', code: 'sh513050', keywords: ['中概股', '互联网', '中国科技'], reason: '中国互联网龙头' },
  ],
  defense: [
    { name: '红利低波ETF', code: 'sh512890', keywords: ['红利', '低波', '高股息'], reason: '高股息防御，年金险偏好' },
    { name: '银行ETF', code: 'sh512800', keywords: ['银行', '金融', '低估值'], reason: '低估值高股息' },
    { name: '证券ETF', code: 'sh512880', keywords: ['证券', '券商', '资本市场'], reason: '资本市场改革受益' },
    { name: '煤炭ETF', code: 'sh515220', keywords: ['煤炭', '能源', '高股息'], reason: '高股息周期品' },
    { name: '基建ETF', code: 'sh516950', keywords: ['基建', '建筑', '稳增长'], reason: '稳增长政策受益' },
    { name: '房地产ETF', code: 'sh512200', keywords: ['房地产', '地产链'], reason: '政策松动博弈' },
    { name: '食品饮料ETF', code: 'sh515170', keywords: ['食品', '饮料', '消费'], reason: '消费核心资产' },
  ],
  bond_commodity: [
    { name: '十年国债ETF', code: 'sh511260', keywords: ['国债', '债券', '利率'], reason: '利率下行受益' },
    { name: '企业债ETF', code: 'sh511210', keywords: ['信用债', '企业债'], reason: '信用利差收窄' },
    { name: '石油ETF', code: 'sh161129', keywords: ['石油', '原油', '大宗商品'], reason: '通胀受益，风险资产' },
  ]
};

/**
 * HTML属性转义（用于onclick内的字符串）
 */
function escapeHtmlAttr(str) {
  if (!str) return '';
  return String(str).replace(/'/g, "\\'").replace(/"/g, '"').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 显示ETF推荐弹窗
 */
function showEtfRecommend(code, name, category, side) {
  var modal = document.getElementById('etfRecommendModal');
  var titleEl = document.getElementById('etfRecommendTitle');
  var bodyEl = document.getElementById('etfRecommendBody');
  if (!modal || !titleEl || !bodyEl) return;
  
  titleEl.textContent = name + ' - 相关ETF推荐';
  bodyEl.innerHTML = '<div class="etf-recommend-loading">分析中...</div>';
  modal.style.display = 'flex';
  
  setTimeout(function() {
    var recommendations = generateEtfRecommendations(code, name, category, side);
    renderEtfRecommendations(bodyEl, recommendations, side);
  }, 100);
}

/**
 * 生成ETF推荐列表
 */
function generateEtfRecommendations(code, name, category, side) {
  var recs = [];
  var sourceEtf = null;
  
  var allEtfs = [].concat(
    ETF_RECOMMEND_DB.industries,
    ETF_RECOMMEND_DB.broad,
    ETF_RECOMMEND_DB.defense,
    ETF_RECOMMEND_DB.bond_commodity
  );
  
  for (var i = 0; i < allEtfs.length; i++) {
    if (allEtfs[i].code === code) {
      sourceEtf = allEtfs[i];
      break;
    }
  }
  
  // 同类ETF
  var sameCategory = getSameCategoryEtfs(code, sourceEtf);
  recs = recs.concat(sameCategory);
  
  // 互补ETF
  var similarEtfs = getSimilarEtfs(code, sourceEtf, side);
  recs = recs.concat(similarEtfs);
  
  // 趋势方向相关
  if (side === 'right') {
    var trendEtfs = getTrendRelatedEtfs(code, sourceEtf);
    recs = recs.concat(trendEtfs);
  } else {
    var bottomEtfs = getBottomRelatedEtfs(code, sourceEtf);
    recs = recs.concat(bottomEtfs);
  }
  
  // 去重
  var seen = {};
  recs = recs.filter(function(r) {
    if (seen[r.code]) return false;
    seen[r.code] = true;
    return true;
  });
  
  return recs.slice(0, 6);
}

function getSameCategoryEtfs(code, sourceEtf) {
  if (!sourceEtf) return [];
  var recs = [];
  var keywords = sourceEtf.keywords || [];
  
  var allEtfs = [].concat(
    ETF_RECOMMEND_DB.industries,
    ETF_RECOMMEND_DB.broad,
    ETF_RECOMMEND_DB.defense,
    ETF_RECOMMEND_DB.bond_commodity
  );
  
  allEtfs.forEach(function(etf) {
    if (etf.code === code) return;
    var hasCommonKeyword = keywords.some(function(kw) {
      return etf.keywords.some(function(ek) {
        return ek.indexOf(kw) >= 0 || kw.indexOf(ek) >= 0;
      });
    });
    if (hasCommonKeyword) {
      recs.push({
        name: etf.name,
        code: etf.code,
        tag: '同类',
        tagClass: 'same',
        reason: '同属' + keywords[0] + '赛道，配置逻辑相近'
      });
    }
  });
  return recs;
}

function getSimilarEtfs(code, sourceEtf, side) {
  if (!sourceEtf) return [];
  var recs = [];
  var complementMap = {
    'sh512480': [{ name: 'AI应用ETF', code: 'sh515980', reason: 'AI硬件+应用形成完整产业链' }],
    'sh515980': [{ name: '半导体ETF', code: 'sh512480', reason: 'AI应用需要芯片算力支撑' }],
    'sh562500': [{ name: 'AI应用ETF', code: 'sh515980', reason: '机器人+AI应用协同发展' }],
    'sz159820': [{ name: 'AI应用ETF', code: 'sh515980', reason: '算力是AI应用的基础' }],
    'sh512660': [{ name: '半导体ETF', code: 'sh512480', reason: '军工电子化趋势' }],
    'sz159928': [{ name: '食品饮料ETF', code: 'sh515170', reason: '消费全产业链覆盖' }],
    'sh512010': [{ name: '创新药ETF', code: 'sz159992', reason: '医药全产业链配置' }],
    'sh518880': [{ name: '红利低波ETF', code: 'sh512890', reason: '避险+高股息双重防御' }],
    'sh512890': [{ name: '黄金ETF', code: 'sh518880', reason: '高股息+黄金双重保障' }],
  };
  
  if (complementMap[code]) {
    complementMap[code].forEach(function(item) {
      recs.push({
        name: item.name,
        code: item.code,
        tag: '互补',
        tagClass: 'similar',
        reason: item.reason
      });
    });
  }
  
  if (ETF_RECOMMEND_DB.broad.some(function(e) { return e.code === code; })) {
    var hotIndustries = getHotIndustries();
    hotIndustries.slice(0, 2).forEach(function(etf) {
      if (etf.code !== code) {
        recs.push({
          name: etf.name,
          code: etf.code,
          tag: '轮动',
          tagClass: 'similar',
          reason: '当前市场热点轮动方向'
        });
      }
    });
  }
  return recs;
}

function getTrendRelatedEtfs(code, sourceEtf) {
  var recs = [];
  var keywords = sourceEtf ? sourceEtf.keywords : [];
  var trendTargets = {
    'AI硬件': { name: '算力ETF', code: 'sz159820', reason: 'AI行情主线延续，算力需求持续爆发' },
    'AI应用': { name: 'AI应用ETF', code: 'sh515980', reason: 'AI应用商业化加速，估值修复' },
    '半导体': { name: '芯片ETF', code: 'sh512760', reason: '国产替代加速，设备先行' },
    '成长': { name: '创业板ETF', code: 'sz159915', reason: '成长风格占优，弹性更大' },
    '大盘': { name: '沪深300ETF', code: 'sh510300', reason: '核心资产估值修复' },
  };
  
  keywords.forEach(function(kw) {
    for (var key in trendTargets) {
      if (kw.indexOf(key) >= 0 || key.indexOf(kw) >= 0) {
        var t = trendTargets[key];
        recs.push({
          name: t.name,
          code: t.code,
          tag: '趋势',
          tagClass: 'trend',
          reason: t.reason
        });
        delete trendTargets[key];
      }
    }
  });
  
  if (recs.length === 0) {
    recs.push({
      name: '创业板ETF',
      code: 'sz159915',
      tag: '趋势',
      tagClass: 'trend',
      reason: '成长风格有望延续，弹性较大'
    });
  }
  return recs;
}

function getBottomRelatedEtfs(code, sourceEtf) {
  var recs = [];
  var keywords = sourceEtf ? sourceEtf.keywords : [];
  var bottomTargets = {
    '消费': { name: '消费ETF', code: 'sz159928', reason: '消费已超跌，估值接近历史低位' },
    '医药': { name: '医药ETF', code: 'sh512010', reason: '医药调整充分，逢低布局' },
    '新能源': { name: '新能源ETF', code: 'sh516160', reason: '新能源超跌，长期逻辑仍在' },
    '半导体': { name: '半导体ETF', code: 'sh512480', reason: '半导体周期底部，国产替代加速' },
    '黄金': { name: '红利低波ETF', code: 'sh512890', reason: '防御为主，等待右侧信号' },
  };
  
  keywords.forEach(function(kw) {
    for (var key in bottomTargets) {
      if (kw.indexOf(key) >= 0 || key.indexOf(kw) >= 0) {
        var t = bottomTargets[key];
        recs.push({
          name: t.name,
          code: t.code,
          tag: '左侧',
          tagClass: 'bottom',
          reason: t.reason
        });
        delete bottomTargets[key];
      }
    }
  });
  
  if (recs.length === 0) {
    recs.push({
      name: '红利低波ETF',
      code: 'sh512890',
      tag: '左侧',
      tagClass: 'bottom',
      reason: '高股息防御，等待市场企稳'
    });
    recs.push({
      name: '黄金ETF',
      code: 'sh518880',
      tag: '左侧',
      tagClass: 'bottom',
      reason: '避险资产，控制风险'
    });
  }
  return recs;
}

function getHotIndustries() {
  return [
    { name: 'AI应用ETF', code: 'sh515980' },
    { name: '算力ETF', code: 'sz159820' },
    { name: '机器人ETF', code: 'sh562500' },
    { name: '半导体ETF', code: 'sh512480' }
  ];
}

function renderEtfRecommendations(container, recommendations, side) {
  if (!recommendations || recommendations.length === 0) {
    container.innerHTML = '<div class="etf-recommend-empty">暂无相关推荐</div>';
    return;
  }
  
  var introText = side === 'right'
    ? '以下ETF与当前趋势方向一致或存在轮动机会，可作为右侧跟进备选'
    : '以下ETF与当前超跌标的同属一类或具备互补属性，可作为左侧分批布局备选';
  
  var html = '';
  html += '<div class="etf-recommend-source">点击ETF卡片可查看详情 · <strong>' + recommendations.length + '</strong>个推荐</div>';
  html += '<div class="etf-recommend-intro">' + introText + '</div>';
  html += '<div class="etf-recommend-list">';
  
  recommendations.forEach(function(rec) {
    html += '<div class="etf-recommend-card" onclick="searchStockByCode(\'' + rec.code + '\')">';
    html += '<div class="etf-recommend-card-header">';
    html += '<div class="etf-recommend-card-name">';
    html += rec.name;
    html += '<span class="tag ' + rec.tagClass + '">' + rec.tag + '</span>';
    html += '</div>';
    html += '<div class="etf-recommend-card-code">' + rec.code + '</div>';
    html += '</div>';
    html += '<div class="etf-recommend-card-reason"><strong>推荐理由：</strong>' + rec.reason + '</div>';
    html += '</div>';
  });
  
  html += '</div>';
  html += '<div class="etf-recommend-footer">';
  html += '※ 投资有风险，入市需谨慎';
  html += '</div>';
  
  container.innerHTML = html;
}

function searchStockByCode(code) {
  closeEtfRecommendModal();
  var searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.value = code;
    searchStock();
  }
}

function closeEtfRecommendModal() {
  var modal = document.getElementById('etfRecommendModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

