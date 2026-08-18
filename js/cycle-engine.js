/* ============================================================
   经济周期判断引擎 (Economic Cycle Engine)
   版本: 1.0 | 数据基准日: 2026-08-18
   ------------------------------------------------------------
   五维周期评分 + 美林时钟定位 + AI债务周期专项评估
   数据来源: 美联储官网、BIS公报120号、Moody's/S&P/Fitch评级、
   Morgan Stanley/BlackRock信用研究、CoreWeave/Meta/Oracle/NVIDIA公司公告
   ============================================================ */

/* ===== 一、已核实数据库（静态锚点，标注日期） ===== */
var CYCLE_DB = {
  updated: '2026-08-18',

  // 货币周期（美联储官网 2026-08）
  monetary: {
    fedFunds: '3.50%–3.75%',          // 7月29日FOMC连续第5次按兵不动
    fedHolds: 5,
    pce: 3.7,                          // 2026年6月PCE，远高于2%目标
    cpiCooling: true,                  // CPI/PPI降温但未达标
    unemployment: 4.1,                 // 2026年7月
    stance: '利率高位停留（higher for longer）'
  },

  // 信用周期（BlackRock/FRED 2026-08-16）
  credit: {
    hyOAS: 271,                        // 高收益OAS，紧，自5月峰值320bp回落
    hyOASRegime: 'TIGHT（风险偏好区间）',
    cccOAS: 10.12,                     // CCC及以下OAS，96百分位（与HY背离）
    dcJVWide: '17/23',                 // 数据中心JV债券破发交易（Goldman Sachs 2026-08）
    dcBondSpreadContrib: 7,            // 对BB级利差贡献约7bp（BlackRock 2026-08-07）
    aiPricingAnomaly: 'AI私人信贷利差6.2% vs 非AI 6.1%（BIS公报120号，2026-01）——风险定价≈零'
  },

  // AI资本开支周期（朱格拉周期核心）
  capex: {
    debtShareNow: 32,                  // 债务融资占超大规模厂商capex比例（2026年中）
    debtShare2024: 9,                  // 2024财年该比例
    dcDebt2025: 182,                   // 2025年美国数据中心债券发行量（十亿美元，翻倍）
    aiDebt2026F: 570,                  // 2026年全球AI相关债务发行预测（Morgan Stanley）
    platform: '英伟达5000亿美元算力融资平台（2026-08-10，与Apollo/贝莱德/黑石/Brookfield/高盛/KKR签署MOU）',
    platformStatus: '非约束性谅解备忘录，尚未有资金实际承诺',
    nvdaBackstop: 125                  // 黄仁勋表示可选择为至多1250亿美元（25%）兜底
  },

  // 参照交易（结构模板）
  refDeals: [
    { name: 'CoreWeave DDTL 4.0', size: '$8.5B', rating: 'A3 (Moody\'s)', price: 'SOFR+225bp ≈5.9%', note: '破产隔离SPV，GPU+合同抵押，Blackstone锚定' },
    { name: 'Meta Hyperion路易斯安那', size: '$27B', rating: 'A+ (S&P)', price: '6.58%，2049年到期', note: 'PIMCO接约$18B，Meta持股20%表外出表' }
  ],

  // GPU残值之争（核心分歧点）
  gpu: {
    bull: 'H100三年残值50-70%（Silicon Data等行业数据商）',
    bear: '同期跌幅超70%（批评方）；Burry估巨头2026-28少提折旧$176B',
    verdict: '二手市场年轻+债务2032/2049年到期→无人真正知道',
    fiscal: '英伟达新架构约每年一代，竞争寿命2-3年，巨头按5-6年折旧'
  },

  // 信用链末端（谁承担风险）
  chain: {
    openai: 'ARR约$25B vs 2026年现金消耗约$27B；对微软/甲骨文/亚马逊云承诺近$590B',
    oracle: '订单积压$638B（约一半来自OpenAI）；FY2026 FCF -$23.7B；2026-07被S&P降至BBB-',
    nvdaRes: '现金$62.6B+FY26 FCF约$97B vs 兜底上限$125B+采购义务$95.2B（同比$16.1B→暴增）+生态股权约$70B',
    holder: '风险最终落位：保险一般账户（欧洲保险公司私人信贷€211B，占资产2.3%）',
    runnable: '关键区别：保险一般账户资金不可挤兑 vs 2008银行存款可挤兑',
    solvency2: '2027-01起Solvency II将证券化利差风险资本要求约46%→22%，欧洲需求将上升'
  },

  // 与2008对比（校正简单类比）
  vs2008: [
    { dim: '底层资产', s2008: '房产（有实体残值兜底）', s2026: 'GPU（经济寿命2-3年，残值趋零）', edge: '2026更差' },
    { dim: '杠杆主体', s2008: '居民+银行，层级简单', s2026: '企业→SPV→资管→保险，嵌套深', edge: '2026更隐蔽' },
    { dim: '资金可逃性', s2008: '银行存款可挤兑→危机快速扩散', s2026: '保险一般账户不可挤兑→扩散慢', edge: '2026更抗挤兑' },
    { dim: '市场定价', s2008: '2007年利差已开始飙升', s2026: 'HY OAS 271bp仍紧，未定价危机', edge: '2026尚未恐慌' },
    { dim: '传导速度', s2008: '约2年出清', s2026: '合同长期限+前置摊销→出清或需3-5年', edge: '2026更慢' }
  ]
};

/* ===== 二、五维周期评分（0-100，越高越接近周期顶部） ===== */
var CYCLE_SCORES = [
  {
    key: 'monetary', name: '货币周期', score: 62, stage: '偏紧',
    facts: ['Fed 3.50-3.75%连续5次按兵不动', 'PCE 3.7%远超2%目标', '失业率4.1%'],
    logic: '通胀超标约束宽松，利率高位停留压制估值扩张，但未到2007式紧缩极端'
  },
  {
    key: 'credit', name: '信用周期', score: 68, stage: '扩张晚期',
    facts: ['HY OAS 271bp（紧）vs CCC 10.12%（96百分位）背离', '数据中心JV债券17/23破发', 'AI信贷风险定价≈零（BIS）'],
    logic: '整体利差平静，但最弱环节已现消化不良——典型的晚周期信贷分层信号'
  },
  {
    key: 'earnings', name: '盈利周期', score: 64, stage: '分化加剧',
    facts: ['OpenAI: ARR $25B vs 消耗 $27B', '甲骨文: 积压$638B但FCF -$23.7B被降至BBB-', '巨头盈利仍强'],
    logic: '龙头盈利与二线现金流的裂口扩大，订单积压的"纸面繁荣"开始被评级机构检验'
  },
  {
    key: 'valuation', name: '估值周期', score: 70, stage: '偏高重估中',
    facts: ['AI相关债券开始重估风险', '投资级市场先现消化不良', '二级流动性差'],
    logic: '估值尚未到2000年式极端，但定价开始从"信仰"回归"现金流"的第一阶段'
  },
  {
    key: 'capex', name: '资本开支周期', score: 76, stage: '朱格拉周期晚期',
    facts: ['债务融资占capex 9%→32%（一年内暴增3.5倍）', '数据中心债券2025年翻倍至$182B', '2026年AI债务发行预测$570B'],
    logic: '这是最领先的危险信号：资本开支从自有现金转向债务证券化，正是技术周期见顶的融资特征'
  }
];

/* ===== 三、周期阶段计算 ===== */
function calcCycleStage(scores) {
  var sum = 0, max = 0, min = 100;
  for (var i = 0; i < scores.length; i++) {
    sum += scores[i].score;
    if (scores[i].score > max) max = scores[i].score;
    if (scores[i].score < min) min = scores[i].score;
  }
  var avg = sum / scores.length;

  if (avg < 30) return { idx: 0, name: '复苏早期', cls: 'cy-early', desc: '刚走出出清，最肥美的布局期' };
  if (avg < 45) return { idx: 1, name: '扩张期', cls: 'cy-expand', desc: '盈利与估值双升，持有为王' };
  if (avg < 60) return { idx: 2, name: '扩张后期', cls: 'cy-late', desc: '趋势仍在但性价比下降' };
  if (avg < 72) return { idx: 3, name: '信贷晚期/过热边缘', cls: 'cy-overheat', desc: '债务驱动特征显现，需收紧风控' };
  if (avg < 85) return { idx: 4, name: '滞胀/顶部区', cls: 'cy-stag', desc: '增长放缓+通胀高企，防御为主' };
  return { idx: 5, name: '衰退/出清', cls: 'cy-recess', desc: '违约暴露，现金为王等黄金坑' };
}

/* ===== 四、美林时钟定位 ===== */
function calcMerrillClock() {
  // 增长: 失业4.1%低位但"增长前景未显著改善"、巨头FCF分化 → 弱
  // 通胀: PCE 3.7%远超目标 → 高
  return {
    growth: 'weak', inflation: 'high',
    cell: 'stagflation',
    cellName: '类滞胀',
    cellDesc: '增长放缓 + 通胀高于目标 + 利率高位（非典型滞胀，AI资本开支托底就业）',
    assetOrder: ['债券/黄金', '高股息/公用事业', '现金', '成长股（减持）'],
    note: '若后续通胀回落→转入衰退象限（债券最优）；若AI资本开支再加速→短暂回到过热象限'
  };
}

/* ===== 五、AI债务周期时间线（推演+置信度，非预测） ===== */
var CYCLE_TIMELINE = [
  {
    period: '2026 H2（当前）', conf: '高（已发生）',
    events: ['投资级/高收益数据中心债券消化不良持续', '评级机构（Fitch已征求意见）重审GPU残值方法', '融资平台从MOU走向正式文件'],
    signal: '观察期：利差分层但不失控'
  },
  {
    period: '2027', conf: '中',
    events: ['首批GPU贷款进入摊销检验期', '英伟达新架构对旧GPU二手价格形成压力测试', 'OpenAI续融资节奏与ARR/消耗比成为焦点', '2027-01欧洲Solvency II降低证券化资本要求→需求短暂回升'],
    signal: '压力测试期：残值分歧开始用价格说话'
  },
  {
    period: '2028-2029', conf: '低（情景推演）',
    events: ['若AI收入无法收敛与$590B云承诺的缺口→AI实验室合同重定价', '债务存量推向$500B+，评级迁移触发保险资本约束', 'Oracle式降级扩散至更多依赖单一客户的结构'],
    signal: '出清期（若触发）：评级迁移→强制卖出→流动性螺旋'
  }
];

/* ===== 六、风险监测触发器（可执行清单） ===== */
var CYCLE_TRIGGERS = [
  { name: 'HY OAS持续突破400bp', now: '271bp', level: '警戒' },
  { name: 'CCC OAS突破12%', now: '10.12%', level: '警戒' },
  { name: '再出现甲骨文级降级（BBB→BB）', now: '甲骨文已降至BBB-', level: '关键' },
  { name: 'OpenAI的ARR/现金消耗比<1.5', now: '≈0.93', level: '关键' },
  { name: 'GPU二手价格指数同比-30%', now: '分歧区(50-70%残值)', level: '关键' },
  { name: '2s10s期限利差重新倒挂', now: '实时监测', level: '警戒' },
  { name: 'AI实验室offtake合同重组/违约', now: '无', level: '危机确认' },
  { name: '英伟达正式启用$125B兜底', now: '选项未行使', level: '危机确认' }
];

/* ===== 七、资产配置建议 ===== */
var CYCLE_ALLOCATION = [
  { asset: '利率债/黄金', weight: '超配', reason: '类滞胀+晚周期标准配置，对冲信用事件' },
  { asset: '高股息/公用事业', weight: '超配', reason: '现金流稳定，久期资产受益于降息期权' },
  { asset: 'A股核心资产', weight: '标配', reason: '估值分位不高，与美股AI周期相关性有限' },
  { asset: 'AI算力链股票', weight: '低配', reason: '朱格拉周期晚期，盈利与股价的容错率最低' },
  { asset: 'AI信用类产品', weight: '回避', reason: '风险定价≈零，价格未反映残值不确定性' }
];

/* ============================================================
   渲染
   ============================================================ */
function renderCyclePanel() {
  var el = document.getElementById('cyclePanel');
  if (!el) return;

  // 实时补充：2s10s期限利差
  var curveNote = '（等待实时数据）';
  var curveScoreAdj = 0;
  if (typeof TREASURY_2Y !== 'undefined' && typeof TREASURY_10Y !== 'undefined' && TREASURY_2Y > 0) {
    var spread2s10 = TREASURY_10Y - TREASURY_2Y;
    curveNote = spread2s10.toFixed(2) + '%（' + (spread2s10 < 0 ? '倒挂⚠️' : '正常') + '）';
    if (spread2s10 < 0) curveScoreAdj = 6;
  }

  var scores = CYCLE_SCORES.slice();
  if (curveScoreAdj) {
    for (var i = 0; i < scores.length; i++) {
      if (scores[i].key === 'monetary') scores[i].score = Math.min(95, scores[i].score + curveScoreAdj);
    }
  }

  var stage = calcCycleStage(scores);
  var avg = scores.reduce(function(a, b) { return a + b.score; }, 0) / scores.length;
  var clock = calcMerrillClock();

  var html = '';

  // ===== 顶部：周期定位主卡 =====
  html += '<div class="cy-hero ' + stage.cls + '">' +
    '<div class="cy-hero-left">' +
      '<div class="cy-stage-label">当前周期定位</div>' +
      '<div class="cy-stage-name">' + stage.name + '</div>' +
      '<div class="cy-stage-desc">' + stage.desc + '</div>' +
      '<div class="cy-clock-pos">美林时钟：<b>' + clock.cellName + '</b> · ' + clock.cellDesc + '</div>' +
    '</div>' +
    '<div class="cy-hero-right">' +
      '<div class="cy-avg-score">' + avg.toFixed(0) + '<span class="cy-avg-unit">/100</span></div>' +
      '<div class="cy-avg-label">五维周期温度计</div>' +
      '<div class="cy-avg-bar"><div class="cy-avg-fill" style="width:' + avg + '%"></div><div class="cy-avg-mark" style="left:72%"></div></div>' +
      '<div class="cy-avg-note">72分为"顶部区"分界</div>' +
    '</div>' +
  '</div>';

  // ===== 五维评分条 =====
  html += '<div class="cy-scores">' +
    '<div class="cy-section-title">五维周期评分（越高越接近周期顶部）</div>';
  for (var i = 0; i < scores.length; i++) {
    var s = scores[i];
    var barCls = s.score >= 72 ? 'cy-bar-danger' : (s.score >= 60 ? 'cy-bar-warn' : 'cy-bar-ok');
    html += '<div class="cy-score-row">' +
      '<div class="cy-score-head"><b>' + s.name + '</b><span class="cy-score-stage">' + s.stage + '</span><span class="cy-score-num ' + barCls + '">' + s.score + '</span></div>' +
      '<div class="cy-score-bar"><div class="cy-score-fill ' + barCls + '" style="width:' + s.score + '%"></div></div>' +
      '<div class="cy-score-logic">' + s.logic + '</div>' +
      '<div class="cy-score-facts">' + s.facts.map(function(f){ return '· ' + f; }).join('　') + '</div>' +
    '</div>';
  }
  html += '</div>';

  // ===== 美林时钟矩阵 =====
  html += '<div class="cy-clock">' +
    '<div class="cy-section-title">美林时钟四象限（当前高亮）</div>' +
    '<div class="cy-clock-grid">' +
      '<div class="cy-cell ' + (clock.cell === 'overheat' ? 'cy-cell-active' : '') + '"><b>过热</b><span>增长↑ 通胀↑</span><i>商品最优</i></div>' +
      '<div class="cy-cell ' + (clock.cell === 'stagflation' ? 'cy-cell-active' : '') + '"><b>类滞胀 ◀ 当前</b><span>增长↓ 通胀↑</span><i>现金/防御</i></div>' +
      '<div class="cy-cell ' + (clock.cell === 'recovery' ? 'cy-cell-active' : '') + '"><b>复苏</b><span>增长↑ 通胀↓</span><i>股票最优</i></div>' +
      '<div class="cy-cell ' + (clock.cell === 'recession' ? 'cy-cell-active' : '') + '"><b>衰退</b><span>增长↓ 通胀↓</span><i>债券最优</i></div>' +
    '</div>' +
    '<div class="cy-clock-order">配置优先级：' + clock.assetOrder.join(' → ') + '<br><span class="cy-clock-note">' + clock.note + '</span></div>' +
  '</div>';

  // ===== AI债务周期专项 =====
  html += '<div class="cy-ai">' +
    '<div class="cy-section-title">AI算力债务周期专项评估（核心矛盾）</div>' +
    '<div class="cy-ai-hero">' +
      '<div class="cy-ai-fact"><b>$500B</b><span>英伟达算力融资平台<br>（2026-08-10 MOU，非约束性）</span></div>' +
      '<div class="cy-ai-fact"><b>9%→32%</b><span>债务融资占巨头capex比例<br>（FY2024 → 2026年中）</span></div>' +
      '<div class="cy-ai-fact"><b>$182B→$570B</b><span>数据中心债券年发行<br>（2025实际 → 2026预测）</span></div>' +
      '<div class="cy-ai-fact"><b>6.2% vs 6.1%</b><span>AI vs 非AI私人信贷利差<br>（BIS：风险定价≈零）</span></div>' +
    '</div>' +
    '<div class="cy-ai-structure">' +
      '<div class="cy-flow-title">资金流向与风险落位链</div>' +
      '<div class="cy-flow">保险一般账户（Apollo/Athene、KKR/Global Atlantic、Brookfield Wealth）→ 融资平台 → SPV/项目公司 → neocloud（CoreWeave/ Crusoe/ Nebius）与数据中心 → 购买英伟达GPU → 由offtake合同偿付</div>' +
      '<div class="cy-flow-split">' +
        '<div class="cy-branch cy-branch-ok"><b>分支A（相对安全）</b>付费方=超大规模厂商（微软/Meta）的take-or-pay合同 → 实质是对全球最强资产负债表的债权，前置摊销使残值永不被测试</div>' +
        '<div class="cy-branch cy-branch-bad"><b>分支B（风险所在）</b>付费方=AI实验室（OpenAI: ARR $25B vs 消耗$27B，云承诺$590B）→ 这不是信用替代，是<b>信用递延</b>。甲骨文（积压一半来自OpenAI、FCF -$23.7B、降至BBB-）就是此分支的预演</div>' +
      '</div>' +
      '<div class="cy-ai-verdict"><b>结构性结论：</b>风险没有消失，而是从英伟达资产负债表"再 domiciled"到保险一般账户。与2008的关键差异：保险资金<b>不可挤兑</b>（银行存款可），因此传导更慢、更钝、以评级迁移而非流动性挤兑的形式暴露。</div>' +
    '</div>' +
  '</div>';

  // ===== 与2008对比 =====
  html += '<div class="cy-vs2008">' +
    '<div class="cy-section-title">与2008次贷对比（校正简单类比）</div>' +
    '<table class="cy-vs-table"><thead><tr><th>维度</th><th>2008次贷</th><th>2026 AI算力债</th><th>谁更糟</th></tr></thead><tbody>';
  for (var i = 0; i < CYCLE_DB.vs2008.length; i++) {
    var r = CYCLE_DB.vs2008[i];
    html += '<tr><td><b>' + r.dim + '</b></td><td>' + r.s2008 + '</td><td>' + r.s2026 + '</td><td class="cy-edge">' + r.edge + '</td></tr>';
  }
  html += '</tbody></table>' +
    '<div class="cy-vs-note">⚠️ 结论：底层资产质量2026更差，但传导机制更慢、可挤兑性更低，且市场定价（HY 271bp紧）显示<b>恐慌远未开始</b>。"复刻雷曼级崩盘"为未经验证的外推。</div>' +
  '</div>';

  // ===== 时间线 =====
  html += '<div class="cy-timeline">' +
    '<div class="cy-section-title">债务周期推演时间线（情景+置信度，非预测）</div>';
  for (var i = 0; i < CYCLE_TIMELINE.length; i++) {
    var t = CYCLE_TIMELINE[i];
    html += '<div class="cy-tl-item">' +
      '<div class="cy-tl-head"><b>' + t.period + '</b><span class="cy-tl-conf">' + t.conf + '</span><span class="cy-tl-signal">' + t.signal + '</span></div>' +
      '<ul class="cy-tl-events">' + t.events.map(function(e){ return '<li>' + e + '</li>'; }).join('') + '</ul>' +
    '</div>';
  }
  html += '</div>';

  // ===== 触发器清单 =====
  html += '<div class="cy-triggers">' +
    '<div class="cy-section-title">风险监测触发器（到点即行动，不猜顶）</div>' +
    '<table class="cy-trig-table"><thead><tr><th>触发条件</th><th>当前读数</th><th>级别</th></tr></thead><tbody>';
  for (var i = 0; i < CYCLE_TRIGGERS.length; i++) {
    var g = CYCLE_TRIGGERS[i];
    var lv = g.level === '危机确认' ? 'cy-lv-crisis' : (g.level === '关键' ? 'cy-lv-key' : 'cy-lv-warn');
    html += '<tr><td>' + g.name + '</td><td class="cy-trig-now">' + g.now + '</td><td><span class="cy-lv ' + lv + '">' + g.level + '</span></td></tr>';
  }
  html += '</tbody></table>' +
    '<div class="cy-trig-note">2s10s期限利差实时读数：' + curveNote + '（来自本站国债数据源）</div>' +
  '</div>';

  // ===== 资产配置 =====
  html += '<div class="cy-alloc">' +
    '<div class="cy-section-title">当前阶段资产配置建议</div>' +
    '<table class="cy-alloc-table"><thead><tr><th>资产</th><th>建议</th><th>理由</th></tr></thead><tbody>';
  for (var i = 0; i < CYCLE_ALLOCATION.length; i++) {
    var a = CYCLE_ALLOCATION[i];
    var wCls = a.weight === '超配' ? 'cy-w-over' : (a.weight === '回避' ? 'cy-w-avoid' : (a.weight === '低配' ? 'cy-w-under' : 'cy-w-neu'));
    html += '<tr><td><b>' + a.asset + '</b></td><td><span class="cy-weight ' + wCls + '">' + a.weight + '</span></td><td>' + a.reason + '</td></tr>';
  }
  html += '</tbody></table>' +
    '<div class="cy-disclaimer">⚠️ 周期判断基于' + CYCLE_DB.updated + '可核实数据（美联储/BIS/Moody\'s/S&P/公司公告）。部分市场传闻数据（如"CDC利差855bp""GPU债务$413B""违约率50%"）未能核实，未纳入评分。本内容仅为风险框架参考，不构成投资建议。</div>' +
  '</div>';

  el.innerHTML = html;
}
