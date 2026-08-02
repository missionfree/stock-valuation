'use strict';

/* ============================================================
   二、JSONP 工具函数
   ============================================================ */

// 全局回调计数器
var _cbCounter = 0;

/**
 * 通过动态 script 标签加载远程 JS（JSONP 风格）
 * @param {string} url - 完整的接口 URL
 * @param {number} timeout - 超时毫秒
 * @returns {Promise} resolve(数据) 或 reject(错误)
 */
function jsonpLoad(url, timeout) {
  timeout = timeout || 5000;
  return new Promise(function(resolve, reject) {
    var script = document.createElement('script');
    var timer = null;
    var done = false;

    // 腾讯接口返回GBK编码，script需指定GBK以正确解析中文
    script.charset = 'gbk';
    script.src = url;

    script.onload = function() {
      if (done) return;
      done = true;
      if (timer) Perf.clearTimeout(timer);
      // onload 触发后，全局变量应该已赋值
      // 具体数据由调用方从全局变量读取
      resolve(script);
      // 优化：直接同步删除script标签，无需延迟
      if (script.parentNode) script.parentNode.removeChild(script);
    };

    script.onerror = function() {
      if (done) return;
      done = true;
      if (timer) Perf.clearTimeout(timer);
      if (script.parentNode) script.parentNode.removeChild(script);
      reject(new Error('网络请求失败'));
    };

    timer = Perf.trackedSetTimeout(function() {
      if (done) return;
      done = true;
      if (script.parentNode) script.parentNode.removeChild(script);
      reject(new Error('请求超时'));
    }, timeout);

    document.head.appendChild(script);
  });
}

/**
 * 东方财富 JSONP 调用（使用 cb 参数指定回调名）
 * @param {string} url - 不含 cb 参数的接口 URL
 * @param {number} timeout
 * @returns {Promise} resolve(data) - 回调函数收到的数据
 */
function emJsonp(url, timeout) {
  timeout = timeout || 5000;
  return new Promise(function(resolve, reject) {
    _cbCounter++;
    var cbName = '_em_cb_' + _cbCounter;
    var script = document.createElement('script');
    var timer = null;

    // 定义全局回调
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
      reject(new Error('东方财富接口请求失败'));
    };

    timer = Perf.trackedSetTimeout(function() {
      cleanup();
      reject(new Error('东方财富接口超时'));
    }, timeout);

    var sep = url.indexOf('?') >= 0 ? '&' : '?';
    script.src = url + sep + 'cb=' + cbName;
    document.head.appendChild(script);
  });
}

/* ============================================================
   三、腾讯接口数据解析
   ============================================================ */

/**
 * 从腾讯接口返回的全局变量中解析行情数据
 * 腾讯格式: v_sh600519="1~贵州茅台~600519~1825.00~..."
 * @param {string} varName - 全局变量名，如 'v_sh000300'
 * @returns {object|null} 解析后的行情对象
 */
function parseTencentData(varName) {
  var raw = window[varName];
  if (!raw || typeof raw !== 'string') return null;
  var f = raw.split('~');
  if (f.length < 35) return null;

  return {
    name: f[1],
    code: f[2],
    price: parseFloat(f[3]) || 0,
    yesterdayClose: parseFloat(f[4]) || 0,
    open: parseFloat(f[5]) || 0,
    volume: parseFloat(f[6]) || 0,    // 成交量(手)
    time: f[30] || '',
    changeAmount: parseFloat(f[31]) || 0,
    changePercent: parseFloat(f[32]) || 0,
    high: parseFloat(f[33]) || 0,
    low: parseFloat(f[34]) || 0,
    turnover: parseFloat(f[37]) || 0,  // 成交额(万)
    pe: parseFloat(f[39]) || 0,        // PE(TTM) - 个股有值，指数也有值
    pb: parseFloat(f[46]) || 0,        // 市净率 - 个股有值，指数为0
    marketCap: parseFloat(f[45]) || 0, // 总市值(亿元) - f[45]为总市值，f[44]为流通市值
    floatMarketCap: parseFloat(f[44]) || 0, // 流通市值(亿元)
    amplitude: parseFloat(f[43]) || 0, // 振幅(%)
    turnoverRate: parseFloat(f[38]) || 0 // 换手率(%)
  };
}

/* ============================================================
   四、获取实时行情
   ============================================================ */

/**
 * 从腾讯JSON格式数据中解析行情（fetch + ?fmt=json 返回的数组格式）
 * @param {string} code - 代码，如 'sh000300'
 * @param {Array} f - 字段数组
 * @returns {object|null} 解析后的行情对象
 */
function parseTencentJsonData(code, f) {
  if (!f || f.length < 35) return null;
  return {
    name: f[1],
    code: f[2] || code,
    price: parseFloat(f[3]) || 0,
    yesterdayClose: parseFloat(f[4]) || 0,
    open: parseFloat(f[5]) || 0,
    volume: parseFloat(f[6]) || 0,
    time: f[30] || '',
    changeAmount: parseFloat(f[31]) || 0,
    changePercent: parseFloat(f[32]) || 0,
    high: parseFloat(f[33]) || 0,
    low: parseFloat(f[34]) || 0,
    turnover: parseFloat(f[37]) || 0,
    pe: parseFloat(f[39]) || 0,
    pb: parseFloat(f[46]) || 0,
    marketCap: parseFloat(f[45]) || 0,      // 总市值(亿元)
    floatMarketCap: parseFloat(f[44]) || 0, // 流通市值(亿元)
    amplitude: parseFloat(f[43]) || 0,
    turnoverRate: parseFloat(f[38]) || 0,
    source: 'tencent-fetch'
  };
}

/**
 * 全局请求并发控制器（信号量）
 * 浏览器对同一域名最多6个并发连接，过多的并发请求会排队等待
 * 通过全局信号量限制总并发数，避免连接队列堆积导致页面卡顿
 */
var _globalReqActive = 0;
var _globalReqMax = 5; // 全局最大并发：5（留1个给其他请求）
var _globalReqQueue = [];
function _globalReqAcquire() {
  if (_globalReqActive < _globalReqMax) {
    _globalReqActive++;
    return Promise.resolve();
  }
  return new Promise(function(resolve) {
    _globalReqQueue.push(resolve);
  });
}
function _globalReqRelease() {
  _globalReqActive = Math.max(0, _globalReqActive - 1);
  if (_globalReqQueue.length > 0 && _globalReqActive < _globalReqMax) {
    _globalReqActive++;
    var next = _globalReqQueue.shift();
    next();
  }
}

/**
 * 带超时的fetch封装（避免请求卡死导致按钮一直转圈）
 * 内置全局并发控制，防止同时发起过多请求导致浏览器排队卡顿
 * @param {string} url
 * @param {object} options - fetch options
 * @param {number} timeout - 超时毫秒
 * @returns {Promise}
 */
function fetchWithTimeout(url, options, timeout) {
  timeout = timeout || 8000;
  options = options || {};
  return _globalReqAcquire().then(function() {
    return new Promise(function(resolve, reject) {
      var controller = null;
      var timer = Perf.trackedSetTimeout(function() {
        if (controller) {
          try { controller.abort(); } catch(e) {}
        }
        _globalReqRelease();
        reject(new Error('请求超时(' + timeout + 'ms)'));
      }, timeout);

      // 如果支持AbortController，用它实现可取消的fetch
      if (typeof AbortController !== 'undefined') {
        controller = new AbortController();
        options.signal = controller.signal;
      }

      fetch(url, options).then(function(res) {
        Perf.clearTimeout(timer);
        _globalReqRelease();
        resolve(res);
      }).catch(function(err) {
        Perf.clearTimeout(timer);
        _globalReqRelease();
        reject(err);
      });
    });
  });
}

/**
 * 通过fetch获取腾讯行情JSON（支持CORS，主源）
 * @param {string[]} codes
 * @returns {Promise} resolve(map: {code: data})
 */
function fetchTencentJson(codes) {
  var url = 'https://qt.gtimg.cn/q=' + codes.join(',') + '&fmt=json';
  return fetchWithTimeout(url, { cache: 'no-store' }, 6000).then(function(res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.arrayBuffer();
  }).then(function(buf) {
    // 腾讯API返回GBK编码（content-type: charset=GBK），&fmt=json仅改变格式不改变编码
    // 必须用GBK解码，否则中文名称会变成乱码（U+FFFD替换字符）
    // 注意：UTF-8解码GBK字节时JSON.parse仍能成功（替换字符是合法JSON字符串），
    // 因此不能用"UTF-8解析+JSON.parse成功"作为编码判断依据
    var text;
    try {
      text = new TextDecoder('gbk').decode(buf);
    } catch(e) {
      // 浏览器不支持GBK解码时，回退UTF-8（非中文名称场景可用）
      text = new TextDecoder('utf-8').decode(buf);
    }
    var data = JSON.parse(text);
    var result = {};
    codes.forEach(function(code) {
      if (data[code]) {
        var parsed = parseTencentJsonData(code, data[code]);
        if (parsed) result[code] = parsed;
      }
    });
    if (Object.keys(result).length === 0) throw new Error('fetch返回空数据');
    return result;
  });
}

/**
 * 批量获取实时行情（四级故障转移：腾讯fetch → 腾讯JSONP主源 → 腾讯JSONP备源 → 东方财富）
 * 主源: qt.gtimg.cn (fetch+JSON, CORS友好) | 备源1: qt.gtimg.cn (JSONP) | 备源2: web.sqt.gtimg.cn (JSONP) | 备源3: 东方财富
 * @param {string[]} codes - 代码数组，如 ['sh000300', 'hkHSI']
 * @returns {Promise} resolve(map: {code: data})
 */
function fetchTencentBatch(codes) {
  // 方案1: fetch + JSON（最可靠，CORS友好）
  return fetchTencentJson(codes).catch(function(err) {
    console.warn('腾讯fetch失败，降级JSONP:', err.message);
    return _fetchTencentJsonp(codes);
  });
}

/**
 * 腾讯JSONP方式获取行情（降级方案）
 */
function _fetchTencentJsonp(codes) {
  var primaryUrl = 'https://qt.gtimg.cn/q=' + codes.join(',');
  var backupUrl  = 'https://web.sqt.gtimg.cn/q=' + codes.join(',');

  function parseResult() {
    var result = {};
    codes.forEach(function(code) {
      var varName = 'v_' + code;
      var data = parseTencentData(varName);
      if (data) result[code] = data;
    });
    return result;
  }

  // 先尝试主数据源，失败或空数据则自动切换备用源
  return jsonpLoad(primaryUrl, 3000).then(function() {
    var result = parseResult();
    if (Object.keys(result).length > 0) return result;
    throw new Error('主数据源返回空数据');
  }).catch(function(err) {
    console.warn('实时行情主源失败，切换腾讯备用源:', err.message);
    return jsonpLoad(backupUrl, 3000).then(function() {
      var result = parseResult();
      if (Object.keys(result).length > 0) return result;
      throw new Error('腾讯备用源也返回空数据');
    }).catch(function(err2) {
      console.warn('腾讯双源均失败，切换东方财富备用源:', err2.message);
      return fetchEastmoneyBatch(codes).then(function(emResult) {
        if (Object.keys(emResult).length > 0) return emResult;
        throw new Error('所有数据源均返回空数据');
      });
    });
  });
}

/**
 * 东方财富批量行情（第三备用源）
 * 将腾讯代码转换为东方财富secid格式，通过JSONP获取
 * @param {string[]} tencentCodes - 腾讯格式代码数组
 * @returns {Promise} resolve(map: {code: data}) — data格式与腾讯兼容
 */
function fetchEastmoneyBatch(tencentCodes) {
  // 腾讯代码 → 东方财富 secid 转换
  var secids = tencentCodes.map(function(tc) {
    if (tc.indexOf('sh') === 0) return '1.' + tc.substring(2);
    if (tc.indexOf('sz') === 0) return '0.' + tc.substring(2);
    if (tc.indexOf('hk') === 0) return '116.' + tc.substring(2);
    if (tc.indexOf('us') === 0) return '105.' + tc.substring(2).toUpperCase();
    return tc;
  });
  var fields = 'f43,f44,f45,f46,f47,f48,f50,f57,f58,f60,f116,f117,f162,f167,f168,f169,f170';
  var url = 'https://push2.eastmoney.com/api/qt/ulist.np/get' +
    '?fltt=2&fields=' + fields + '&secids=' + encodeURIComponent(secids.join(','));
  var cbName = '_emcb_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
  url += '&cb=' + cbName;

  return new Promise(function(resolve, reject) {
    var script = document.createElement('script');
    var timer = Perf.trackedSetTimeout(function() {
      cleanup();
      reject(new Error('东方财富行情超时'));
    }, 4000);

    function cleanup() {
      Perf.clearTimeout(timer);
      delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    window[cbName] = function(data) {
      cleanup();
      if (!data || !data.data || !data.data.diff) {
        reject(new Error('东方财富返回空数据'));
        return;
      }
      var result = {};
      data.data.diff.forEach(function(item) {
        // 按代码后缀匹配腾讯代码
        var tencentCode = null;
        tencentCodes.forEach(function(tc) {
          var codeSuffix = tc.substring(2);
          if (item.f12 === codeSuffix || item.f12 === codeSuffix.toUpperCase()) {
            tencentCode = tc;
          }
        });
        if (!tencentCode) return;

        // 转换为与腾讯完全兼容的数据格式（属性名对齐 parseTencentJsonData）
        var price = (item.f43 || 0) / 100;
        var prevClose = (item.f60 || 0) / 100;
        var change = price - prevClose;
        var pct = prevClose > 0 ? (change / prevClose * 100) : 0;
        var peVal = item.f162 ? parseFloat((item.f162 / 100).toFixed(2)) : 0;
        var pbVal = item.f167 ? parseFloat((item.f167 / 100).toFixed(2)) : 0;
        result[tencentCode] = {
          name: item.f58 || '',
          code: tencentCode,
          price: price,
          yesterdayClose: prevClose,    // 腾讯兼容
          prevClose: prevClose,          // 保留向后兼容
          open: (item.f44 || 0) / 100,
          high: (item.f45 || 0) / 100,
          low: (item.f46 || 0) / 100,
          changeAmount: change,          // 腾讯兼容
          change: change,                // 保留向后兼容
          changePercent: pct,            // 腾讯兼容
          pct: pct,                      // 保留向后兼容
          volume: item.f47 || 0,
          turnover: item.f48 || 0,       // 腾讯兼容（成交额）
          amount: item.f48 || 0,         // 保留向后兼容
          time: '',
          pe: peVal,                     // 确保为number类型
          pb: pbVal,                     // 确保为number类型
          marketCap: item.f116 || 0,     // 腾讯兼容（总市值）
          floatMarketCap: item.f117 || 0,// 流通市值
          mv: item.f116 || 0,            // 保留向后兼容
          amplitude: 0,
          turnoverRate: 0,
          source: 'eastmoney'
        };
      });
      resolve(result);
    };

    script.src = url;
    script.onerror = function() {
      cleanup();
      reject(new Error('东方财富JSONP加载失败'));
    };
    document.head.appendChild(script);
  });
}

/**
 * 东方财富：搜索接口（suggest API，支持代码和名称模糊搜索）
 * 数据源 searchapi.eastmoney.com 可用，push2.eastmoney.com 不可用
 * @param {string} keyword - 代码或名称
 * @returns {Promise} resolve({Code, Name, MktNum, QuoteID}) 或 null
 */
function emSuggest(keyword) {
  var url = 'https://searchapi.eastmoney.com/api/suggest/get' +
    '?input=' + encodeURIComponent(keyword) +
    '&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=10';
  return emJsonp(url, 6000).then(function(data) {
    if (!data || !data.QuotationCodeTable || !data.QuotationCodeTable.Data) return null;
    var list = data.QuotationCodeTable.Data;
    // 过滤 A股、港股和ETF基金（MktNum: 1=沪, 0=深, 116=港）
    var filtered = list.filter(function(s) {
      return s.MktNum === '1' || s.MktNum === '0' || s.MktNum === '116';
    });
    // 附加类型信息到每条结果
    filtered.forEach(function(s) {
      s._isETF = s.Classify === 'Fund' || s.SecurityType === '8';
      s._isIndex = s.Classify === 'Index' || s.SecurityType === '5';
    });
    // 返回完整的API响应（含过滤后的Data数组），供联想下拉框和searchStock共用
    data.QuotationCodeTable.Data = filtered;
    return data;
  });
}

/**
 * 东方财富 MktNum 转腾讯代码前缀
 * @param {string} mktNum - 市场编号
 * @param {string} code - 股票代码
 * @returns {string} 腾讯格式代码，如 sh600519
 */
function emToTencentCode(mktNum, code) {
  if (mktNum === '1') return 'sh' + code;   // 沪市
  if (mktNum === '0') return 'sz' + code;   // 深市
  if (mktNum === '116') return 'hk' + code; // 港股
  // 默认猜测：6/5/9开头沪市，其余深市
  if (code.charAt(0) === '6' || code.charAt(0) === '5' || code.charAt(0) === '9') return 'sh' + code;
  return 'sz' + code;
}

/* ============================================================
   五、颜色/信号工具
   ============================================================ */

function isLightMode() {
  var t = document.body.getAttribute('data-theme') || 'cyber';
  return t === 'light' || t === 'classical';
}

/**
 * 获取当前主题名称
 */
function getCurrentTheme() {
  return document.body.getAttribute('data-theme') || 'cyber';
}

/**
 * 主题感知信号颜色缓存 — 主题切换时自动失效
 * 避免渲染循环中数百次 getComputedStyle 调用
 */
var _colorCache = null;
var _cssVarCache = null;

function _ensureColorCache() {
  if (_colorCache) return;
  var docEl = document.documentElement;
  var cs = getComputedStyle(docEl);
  _colorCache = {};
  _colorCache.red    = cs.getPropertyValue('--neon-red').trim()   || '#FF3366';
  _colorCache.green  = cs.getPropertyValue('--neon-green').trim() || '#00FF88';
  _colorCache.yellow = cs.getPropertyValue('--neon-yellow').trim()|| '#FFD700';
  _colorCache.cyan   = cs.getPropertyValue('--neon-cyan').trim()  || '#00E5FF';
  _colorCache.ink    = cs.getPropertyValue('--ink').trim()        || '#F0F4FA';
  _colorCache.muted  = cs.getPropertyValue('--muted').trim()      || '#A0B0C8';
  _colorCache.bg3    = cs.getPropertyValue('--bg3').trim()        || '#0f0f17';
}

function clearColorCache() {
  _colorCache = null;
  _cssVarCache = null;
}

/**
 * 主题感知信号颜色映射 — 读取缓存，格式同上
 */
function getSignalColor(type) {
  _ensureColorCache();
  return _colorCache[type] || _colorCache.yellow;
}

/**
 * 混合两个 hex 颜色
 * @param {string} c1 - 起始颜色 #RRGGBB
 * @param {string} c2 - 结束颜色 #RRGGBB
 * @param {number} ratio - 混合比例 0~1
 * @returns {string} #RRGGBB
 */
function blendHex(c1, c2, ratio) {
  var p = function(hex, i) { return parseInt(hex.slice(i, i + 2), 16); };
  var r1 = p(c1, 1), g1 = p(c1, 3), b1 = p(c1, 5);
  var r2 = p(c2, 1), g2 = p(c2, 3), b2 = p(c2, 5);
  var r = Math.round(r1 + (r2 - r1) * ratio);
  var g = Math.round(g1 + (g2 - g1) * ratio);
  var b = Math.round(b1 + (b2 - b1) * ratio);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

/**
 * hex 转 rgba 字符串
 * @param {string} hex - #RRGGBB
 * @param {number} alpha - 透明度 0~1
 * @returns {string} rgba(r,g,b,alpha)
 */
function hexToRgba(hex, alpha) {
  var r = parseInt(hex.slice(1, 3), 16);
  var g = parseInt(hex.slice(3, 5), 16);
  var b = parseInt(hex.slice(5, 7), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

/**
 * 读取CSS变量值（带缓存）
 */
function getCSSVar(varName, fallback) {
  _ensureColorCache();
  var val = _colorCache[varName.replace('--','')];
  return val || fallback;
}

function getPctColor(pct) {
  var red = getSignalColor('red');
  var yellow = getSignalColor('yellow');
  var green = getSignalColor('green');
  // 估值分位：低=便宜=绿色(安全)，高=贵=红色(风险)
  if (pct < 20) return green;
  if (pct < 40) return blendHex(green, yellow, 0.5);
  if (pct < 60) return yellow;
  if (pct < 80) return blendHex(yellow, red, 0.5);
  return red;
}

function getSignal(pct) {
  if (pct < 20) return { text: '极度低估', cls: 'under' };
  if (pct < 40) return { text: '低估', cls: 'under' };
  if (pct < 60) return { text: '适中', cls: 'mid' };
  if (pct < 80) return { text: '偏高', cls: 'over' };
  return { text: '高估', cls: 'over' };
}

function getChangeColor(val) {
  if (val > 0) return getSignalColor('red');   // A股：红涨
  if (val < 0) return getSignalColor('green');  // A股：绿跌
  var muted = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim();
  return muted || '#7888a0';
}

/* Odometer 数字滚动动效：在数据刷新时为关键数字添加滚动动画 */
var _odometerTimers = new WeakMap();
function animateOdometer(el, newText) {
  if (!el) return;
  // 删除文本比较保护：始终更新数值，保证市场吸引力指数能随国债收益率变化
  el.classList.remove('odometer-rolling');
  // 强制重排以重启动画
  void el.offsetWidth;
  el.textContent = newText;
  el.classList.add('odometer-rolling');
  // 清除上一个定时器，防止快速刷新时定时器堆积
  var prevTimer = _odometerTimers.get(el);
  if (prevTimer) Perf.clearTimeout(prevTimer);
  var t = Perf.trackedSetTimeout(function() {
    el.classList.remove('odometer-rolling');
    _odometerTimers.delete(el);
  }, 600);
  _odometerTimers.set(el, t);
}

/* 为一组元素批量触发 odometer 动效 */
function animateOdometerBatch(elements) {
  elements.forEach(function(item) {
    if (item.el && item.text !== undefined) {
      animateOdometer(item.el, item.text);
    }
  });
}

/* ============================================================
   精度工具函数：统一小数精度处理，避免浮点误差
   ============================================================ */

/**
 * 安全四舍五入到指定小数位，避免浮点精度问题
 * 使用字符串偏移法确保精度准确
 * @param {number} num - 原始数值
 * @param {number} decimals - 保留小数位数（0-4）
 * @returns {number} 四舍五入后的数值
 */
function roundPrecise(num, decimals) {
  if (typeof num !== 'number' || !isFinite(num)) return 0;
  decimals = decimals || 2;
  if (decimals < 0) decimals = 0;
  if (decimals > 4) decimals = 4;
  // 使用 toFixed 后再转回数字，修正浮点误差
  var str = num.toFixed(decimals);
  return parseFloat(str);
}

/**
 * 格式化价格：保留2位小数
 * @param {number} price
 * @returns {string}
 */
function formatPrice(price) {
  if (!price || price <= 0) return '—';
  return roundPrecise(price, 2).toFixed(2);
}

/**
 * 格式化百分比：保留2位小数，带正负号
 * @param {number} pct
 * @param {boolean} withSign - 是否带正负号
 * @returns {string}
 */
function formatPercent(pct, withSign) {
  if (pct === null || pct === undefined || isNaN(pct)) return '—';
  var v = roundPrecise(pct, 2);
  var str = v.toFixed(2) + '%';
  if (withSign && v > 0) str = '+' + str;
  return str;
}

/**
 * 格式化PE/PB：保留2位小数
 * @param {number} val
 * @returns {string}
 */
function formatPE(val) {
  if (!val || val <= 0) return '—';
  return roundPrecise(val, 2).toFixed(2);
}

/**
 * 计算动态分位（锚点偏移法）- 高精度版本
 * 公式：新分位 = 基准分位 + (实时PE - 基准PE) / (peMax - peMin) * 100
 * 结果限制在 0-100 之间
 * @param {number} basePct - 基准分位
 * @param {number} basePE - 基准PE
 * @param {number} realtimePE - 实时PE
 * @param {number} peMin - 历史最小PE
 * @param {number} peMax - 历史最大PE
 * @returns {number} 动态分位（0-100整数）
 */
function calcDynamicPct(basePct, basePE, realtimePE, peMin, peMax) {
  if (!realtimePE || realtimePE <= 0) return basePct;
  if (!peMin || !peMax || peMax <= peMin) return basePct;
  var range = peMax - peMin;
  var delta = realtimePE - basePE;
  var offset = (delta / range) * 100;
  var result = basePct + offset;
  // 限制在 0-100 范围
  result = Math.max(0, Math.min(100, result));
  return Math.round(result);
}

/**
 * 动态计算股息率：DY = 基准DY * (基准PB / 实时PB)
 * 股息率与价格成反比，价格上涨(PB升高) → DY下降
 * @param {number} baseDY - 基准股息率
 * @param {number} basePB - 基准PB
 * @param {number} realtimePB - 实时PB
 * @returns {number} 动态股息率（保留2位小数）
 */
function calcDynamicDY(baseDY, basePB, realtimePB) {
  if (!realtimePB || realtimePB <= 0 || !basePB || basePB <= 0) return baseDY;
  return roundPrecise(baseDY * (basePB / realtimePB), 2);
}

