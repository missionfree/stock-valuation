# 沪深港股票估值分析终端

> 实时A股/港股估值分析工具，提供格雷厄姆指数、股债利差、核心指数PE分位、行业热力图、双线轮动策略信号等决策数据。

## 功能特性

- **首屏决策仪表盘**：格雷厄姆指数、市场吸引力、市场温度三大核心指标卡片
- **核心指数估值**：沪深300、上证指数、创业板指等PE/PB历史分位进度条
- **主力资金流向**：实时流入/流出前5板块，带趋势信号标注
- **板块资金面分析**：167个板块资金轮动分析，默认展示资金流入/流出前10，支持分页加载与全量查看
- **移动端卡片视图**：手机端自动切换为卡片列表，点击展开详细量能数据
- **桌面端固定表头**：表格滚动时表头固定，便于数据对照
- **双线轮动策略**：ETF+个股双线轮动信号系统
- **情绪温度计**：CNN恐慌贪婪指数可视化
- **电影级视觉**：粒子背景、玻璃态卡片、数据光流动画、3D温度计

## 技术栈

- 纯原生 HTML/CSS/JavaScript（零框架依赖）
- Canvas API 粒子系统与数据流可视化
- CSS3 玻璃态（Glassmorphism）、3D变换、动画
- 响应式设计，适配桌面/平板/手机
- 数据源：腾讯财经 + 东方财富

## 项目架构

项目采用模块化架构，将原本 23,000+ 行的单体 HTML 拆分为独立文件：

```
stock-valuation/
├── index.html                  # 主页面（HTML 结构 + 资源引用）
├── css/
│   └── styles.css              # 全部样式（6,700+ 行）
├── js/
│   ├── performance.js           # 性能工具：防抖/节流/RAF/DOM缓存/定时器管理
│   ├── config.js                # 配置数据：估值基准/ETF轮动/行业信号/趋势配置
│   ├── utils.js                 # 工具函数：JSONP/fetch封装/数据解析/颜色工具
│   ├── render.js                # 渲染模块：指数卡片/热力图/PE柱状图/龙头股/语录
│   ├── stock-analysis.js        # 个股分析：查询/财务/龙虎榜/情绪/预警/复盘
│   ├── rotation.js              # 轮动策略：K线获取/双线轮动/动量轮动/行业信号
│   ├── ui.js                    # UI交互：Tab切换/Toast/搜索/组合管理/排序
│   └── app.js                   # 应用入口：初始化/自动刷新/视觉引擎/错误处理
├── stock-valuation/             # 精简版（移动端单页）
│   ├── stock-valuation.html
│   └── assets/charts.js
└── README.md
```

### 性能优化

- **模块化拆分**：单体 HTML 拆分为 8 个 JS 模块 + 1 个 CSS 文件，支持浏览器并行下载
- **defer 加载**：所有 JS 使用 `defer` 属性，不阻塞 HTML 解析
- **全局 Resize 管理**：统一防抖 resize 监听器，替代多个独立监听器
- **DOM 查询缓存**：通过 `Perf.$()` 缓存 `getElementById` 结果
- **定时器追踪**：所有 `setTimeout/setInterval` 被追踪，页面卸载时自动清理
- **GPU 合成优化**：Canvas 元素添加 `will-change: transform` 和 `contain: strict`
- **并发控制**：全局信号量限制 API 并发请求数（5个），避免浏览器排队卡顿
- **多级缓存**：内存缓存 + localStorage 缓存 + TTL 过期策略
- **CSP 安全策略**：添加 Content-Security-Policy 头

### 代码质量

- 所有模块启用 `'use strict'`
- 配置对象使用 `Object.freeze()` 冻结
- 全局错误处理：捕获未处理异常和 Promise rejection
- HTML 实体转义防止 XSS 注入
- `console.log` 全部由 `__DEBUG__` 开关控制

## 数据来源

| 数据类型 | 来源 |
|---------|------|
| 实时行情 | 腾讯财经 API |
| 资金流向 | 东方财富 API |
| 国债收益率 | 东方财富 API |
| 板块数据 | 东方财富 API |

## 部署

本项目部署于 GitHub Pages：

```
https://missionfree.github.io/stock-valuation/
```

## 本地运行

```bash
# 使用 Python 内置服务器
python3 -m http.server 8080

# 或使用 Node.js
npx serve .
```

然后访问 `http://localhost:8080`

## 浏览器兼容性

- Chrome 88+ / Edge 88+
- Firefox 87+
- Safari 14+
- 移动端 iOS Safari 14+ / Chrome Mobile

## 许可证

个人投资参考工具，仅供学习交流使用。
