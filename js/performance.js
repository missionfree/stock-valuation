/**
 * performance.js - 性能优化工具模块
 * 提供防抖、节流、全局resize管理、requestAnimationFrame调度等性能优化工具
 */
'use strict';

(function() {
  // ==================== 防抖 (Debounce) ====================
  /**
   * 防抖函数：延迟执行，如果在延迟期内再次调用则重新计时
   * @param {Function} fn - 要执行的函数
   * @param {number} delay - 延迟毫秒数
   * @returns {Function} 防抖后的函数
   */
  function debounce(fn, delay) {
    var timer = null;
    return function() {
      var ctx = this, args = arguments;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function() {
        fn.apply(ctx, args);
      }, delay);
    };
  }

  // ==================== 节流 (Throttle) ====================
  /**
   * 节流函数：固定频率执行，无论触发多频繁
   * @param {Function} fn - 要执行的函数
   * @param {number} limit - 最小间隔毫秒数
   * @returns {Function} 节流后的函数
   */
  function throttle(fn, limit) {
    var inThrottle = false;
    return function() {
      var ctx = this, args = arguments;
      if (!inThrottle) {
        fn.apply(ctx, args);
        inThrottle = true;
        setTimeout(function() { inThrottle = false; }, limit);
      }
    };
  }

  // ==================== RAF 节流 ====================
  /**
   * 使用 requestAnimationFrame 进行节流，适合动画和渲染场景
   * @param {Function} fn - 要执行的函数
   * @returns {Function} RAF节流后的函数
   */
  function rafThrottle(fn) {
    var scheduled = false;
    var ctx, args;
    return function() {
      ctx = this;
      args = arguments;
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(function() {
          scheduled = false;
          fn.apply(ctx, args);
        });
      }
    };
  }

  // ==================== 全局 Resize 管理 ====================
  /**
   * 全局 resize 事件管理器
   * 替代多个 window.addEventListener('resize', ...) 调用
   * 使用单个防抖监听器 + RAF 调度，避免频繁重绘
   */
  var resizeHandlers = [];
  var resizeInitialized = false;

  function initGlobalResize() {
    if (resizeInitialized) return;
    resizeInitialized = true;
    var debounced = debounce(function() {
      resizeHandlers.forEach(function(h) {
        try { h(); } catch(e) { console.error('Resize handler error:', e); }
      });
    }, 150);
    window.addEventListener('resize', debounced, { passive: true });
    window.addEventListener('orientationchange', debounced, { passive: true });
  }

  /**
   * 注册全局 resize 监听器
   * @param {Function} handler - resize 时执行的函数
   */
  function onResize(handler) {
    resizeHandlers.push(handler);
    initGlobalResize();
  }

  // ==================== DOM 查询缓存 ====================
  var elementCache = {};

  /**
   * 带缓存的 DOM 查询 (getElementById)
   * @param {string} id - 元素ID
   * @returns {HTMLElement|null}
   */
  function $(id) {
    if (!elementCache[id]) {
      elementCache[id] = document.getElementById(id);
    }
    return elementCache[id];
  }

  /**
   * 清除 DOM 查询缓存
   */
  function clearCache() {
    elementCache = {};
  }

  // ==================== 安全定时器管理 ====================
  /**
   * 定时器管理器：跟踪所有 setInterval/setTimeout，
   * 页面卸载时自动清理，防止内存泄漏
   */
  var activeTimers = [];
  var activeIntervals = [];

  function trackedSetTimeout(fn, delay) {
    var id = setTimeout(fn, delay);
    activeTimers.push(id);
    return id;
  }

  function trackedSetInterval(fn, delay) {
    var id = setInterval(fn, delay);
    activeIntervals.push(id);
    return id;
  }

  function trackedClearTimeout(id) {
    clearTimeout(id);
    var idx = activeTimers.indexOf(id);
    if (idx >= 0) activeTimers.splice(idx, 1);
  }

  function trackedClearInterval(id) {
    clearInterval(id);
    var idx = activeIntervals.indexOf(id);
    if (idx >= 0) activeIntervals.splice(idx, 1);
  }

  function clearAllTimers() {
    activeTimers.forEach(clearTimeout);
    activeIntervals.forEach(clearInterval);
    activeTimers = [];
    activeIntervals = [];
  }

  // 页面卸载时清理所有定时器
  window.addEventListener('beforeunload', clearAllTimers);

  // ==================== 懒加载观察器 ====================
  /**
   * 创建 IntersectionObserver 实现懒加载
   * @param {Function} callback - 元素进入视口时的回调
   * @param {object} options - observer 选项
   * @returns {IntersectionObserver}
   */
  function createLazyLoader(callback, options) {
    options = options || { rootMargin: '100px', threshold: 0.01 };
    return new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          callback(entry.target);
        }
      });
    }, options);
  }

  // ==================== 错误边界 ====================
  /**
   * 安全执行函数，捕获异常并记录
   * @param {Function} fn - 要执行的函数
   * @param {string} label - 错误标签
   * @returns {*} 函数返回值或 undefined
   */
  function safeExec(fn, label) {
    try {
      return fn();
    } catch(e) {
      console.error('[SafeExec]' + (label || 'unknown') + ':', e);
      return undefined;
    }
  }

  /**
   * 安全执行异步函数
   * @param {Function} fn - 返回 Promise 的函数
   * @param {string} label - 错误标签
   * @returns {Promise}
   */
  function safeAsync(fn, label) {
    return Promise.resolve()
      .then(fn)
      .catch(function(e) {
        console.error('[SafeAsync]' + (label || 'unknown') + ':', e);
        throw e;
      });
  }

  // ==================== 导出 ====================
  window.Perf = {
    debounce: debounce,
    throttle: throttle,
    rafThrottle: rafThrottle,
    onResize: onResize,
    $: $,
    clearCache: clearCache,
    setTimeout: trackedSetTimeout,
    trackedSetTimeout: trackedSetTimeout,
    setInterval: trackedSetInterval,
    trackedSetInterval: trackedSetInterval,
    clearTimeout: trackedClearTimeout,
    clearInterval: trackedClearInterval,
    clearAllTimers: clearAllTimers,
    createLazyLoader: createLazyLoader,
    safeExec: safeExec,
    safeAsync: safeAsync
  };

})();
