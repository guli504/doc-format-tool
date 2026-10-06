/* ==========================================================================
 * 规范知识库（智能数据库）
 * 来源：《实验论文数字&单位格式规范》（原稿）
 *       + 本次校订补充（依据 ISO 80000、GB 3100~3102、GB/T 15834）
 *
 * 两部分内容：
 *   1) categories  人可读的规范条目（界面里可搜索、可浏览、可一键套用参数）
 *   2) units/rules 机器可读的词典与规则（引擎用来做自动检查与修正）
 * ========================================================================== */
(function (global) {
  'use strict';

  var DFT = global.DFT = global.DFT || {};

  /* ------------------------------------------------------------------
   * 一、单位词典
   *   canon : 规范写法
   *   alts  : 常见错误写法（会被自动改写为 canon）
   *   注意：只有出现在"数字之后"或"斜杠前后"的上下文才会改写，
   *        避免把正文里的普通单词（如 as / is）误改。
   * ------------------------------------------------------------------ */
  var UNITS = [
    /* 时间 */
    { canon: 'h', alts: ['hr', 'hrs'], kind: 'time' },
    { canon: 'min', alts: ['mins'], kind: 'time' },
    { canon: 's', alts: ['sec', 'secs'], kind: 'time' },
    { canon: 'd', alts: ['day', 'days'], kind: 'time' },
    { canon: 'w', alts: ['wk', 'wks'], kind: 'time' },
    /* 体积 */
    { canon: 'L', alts: ['l', 'Ltr', 'ltr'], kind: 'volume' },
    { canon: 'mL', alts: ['ml', 'ML', 'Ml'], kind: 'volume' },
    { canon: 'μL', alts: ['ul', 'uL', 'μl', 'µL', 'µl', 'μℓ'], kind: 'volume' },
    { canon: 'nL', alts: ['nl'], kind: 'volume' },
    { canon: 'dL', alts: ['dl'], kind: 'volume' },
    /* 质量 */
    { canon: 'kg', alts: ['KG', 'Kg'], kind: 'mass' },
    { canon: 'g', alts: ['gm', 'gms'], kind: 'mass' },
    { canon: 'mg', alts: ['MG', 'Mg'], kind: 'mass' },
    { canon: 'μg', alts: ['ug', 'µg', 'mcg'], kind: 'mass' },
    { canon: 'ng', alts: ['NG'], kind: 'mass' },
    { canon: 'pg', alts: ['PG'], kind: 'mass' },
    /* 长度 */
    { canon: 'm', alts: [], kind: 'length' },
    { canon: 'cm', alts: ['CM'], kind: 'length' },
    { canon: 'mm', alts: ['MM'], kind: 'length' },
    { canon: 'μm', alts: ['um', 'µm'], kind: 'length' },
    { canon: 'nm', alts: ['NM'], kind: 'length' },
    { canon: 'km', alts: ['KM'], kind: 'length' },
    /* 面积 / 体积幂次 */
    { canon: 'cm²', alts: ['cm2', 'CM2'], kind: 'area' },
    { canon: 'mm²', alts: ['mm2'], kind: 'area' },
    { canon: 'm²', alts: ['m2'], kind: 'area' },
    { canon: 'cm³', alts: ['cm3'], kind: 'volume' },
    { canon: 'mm³', alts: ['mm3'], kind: 'volume' },
    { canon: 'm³', alts: ['m3'], kind: 'volume' },
    /* 物质的量 / 浓度 */
    { canon: 'mol', alts: ['Mol', 'MOL'], kind: 'amount' },
    { canon: 'mmol', alts: [], kind: 'amount' },
    { canon: 'μmol', alts: ['umol', 'µmol'], kind: 'amount' },
    { canon: 'nmol', alts: [], kind: 'amount' },
    { canon: 'pmol', alts: [], kind: 'amount' },
    { canon: 'mol/L', alts: ['mol/l', 'MOL/L'], kind: 'conc' },
    { canon: 'mmol/L', alts: ['mmol/l'], kind: 'conc' },
    { canon: 'μmol/L', alts: ['umol/L', 'µmol/L'], kind: 'conc' },
    { canon: 'nmol/L', alts: ['nmol/l'], kind: 'conc' },
    { canon: 'pmol/L', alts: ['pmol/l'], kind: 'conc' },
    { canon: 'ng/mL', alts: ['ng/ml'], kind: 'conc' },
    { canon: 'ng/μL', alts: ['ng/ul', 'ng/uL', 'ng/µL'], kind: 'conc' },
    { canon: 'μg/mL', alts: ['ug/ml', 'µg/mL', 'ug/mL'], kind: 'conc' },
    { canon: 'mg/mL', alts: ['mg/ml'], kind: 'conc' },
    { canon: 'g/L', alts: ['g/l'], kind: 'conc' },
    { canon: 'mg/L', alts: ['mg/l'], kind: 'conc' },
    { canon: 'μg/L', alts: ['ug/L', 'µg/L'], kind: 'conc' },
    { canon: 'copies/μL', alts: ['copies/ul', 'copies/uL'], kind: 'conc' },
    { canon: 'CFU/mL', alts: ['cfu/mL', 'CFU/ml', 'cfu/ml'], kind: 'conc' },
    { canon: 'TCID₅₀/mL', alts: ['TCID50/mL', 'TCID50/ml'], kind: 'conc' },
    { canon: 'U/mL', alts: ['U/ml', 'IU/mL', 'IU/ml'], kind: 'conc' },
    { canon: 'U/L', alts: ['U/l'], kind: 'conc' },
    /* 分子量 */
    { canon: 'kDa', alts: ['KD', 'kD', 'kda', 'KDa', 'Kda', 'kdalton'], kind: 'mw' },
    { canon: 'Da', alts: ['dalton'], kind: 'mw' },
    { canon: 'MDa', alts: ['Mda', 'mDa'], kind: 'mw' },
    /* 离心 / 转速 */
    { canon: 'rpm', alts: ['RPM', 'r/min', 'r·min⁻¹'], kind: 'speed' },
    { canon: '×g', alts: ['xg', 'Xg'], kind: 'speed' },
    /* 温度 / 角度（与数字直接相连，不带空格） */
    { canon: '°C', alts: ['℃', '°Ｃ', 'oC', 'OC'], noSpace: true, kind: 'temp' },
    { canon: 'K', alts: [], kind: 'temp' },
    { canon: '°', alts: [], noSpace: true, kind: 'angle' },
    /* 电 / 光 / 能量 */
    { canon: 'V', alts: [], kind: 'elec' },
    { canon: 'mV', alts: [], kind: 'elec' },
    { canon: 'kV', alts: ['KV'], kind: 'elec' },
    { canon: 'A', alts: ['amp', 'amps'], kind: 'elec' },
    { canon: 'mA', alts: [], kind: 'elec' },
    { canon: 'μA', alts: ['uA', 'µA'], kind: 'elec' },
    { canon: 'Ω', alts: ['ohm', 'Ohm'], kind: 'elec' },
    { canon: 'W', alts: ['watt', 'watts'], kind: 'power' },
    { canon: 'kW', alts: ['KW'], kind: 'power' },
    { canon: 'mW', alts: [], kind: 'power' },
    { canon: 'Hz', alts: ['hz', 'HZ'], kind: 'freq' },
    { canon: 'kHz', alts: ['khz', 'KHZ'], kind: 'freq' },
    { canon: 'MHz', alts: ['mhz', 'MHZ'], kind: 'freq' },
    { canon: 'GHz', alts: ['ghz'], kind: 'freq' },
    /* 压力 / 力 */
    { canon: 'Pa', alts: ['pa'], kind: 'press' },
    { canon: 'kPa', alts: ['kpa', 'KPa'], kind: 'press' },
    { canon: 'MPa', alts: ['mpa', 'Mpa'], kind: 'press' },
    { canon: 'bar', alts: [], kind: 'press' },
    { canon: 'mbar', alts: [], kind: 'press' },
    { canon: 'psi', alts: ['PSI'], kind: 'press' },
    { canon: 'N', alts: [], kind: 'force' },
    { canon: 'mN', alts: [], kind: 'force' },
    /* 能量 / 热量 */
    { canon: 'J', alts: ['joule', 'joules'], kind: 'energy' },
    { canon: 'kJ', alts: ['KJ'], kind: 'energy' },
    { canon: 'cal', alts: [], kind: 'energy' },
    { canon: 'kcal', alts: ['Kcal', 'KCAL'], kind: 'energy' },
    { canon: 'eV', alts: [], kind: 'energy' },
    { canon: 'keV', alts: [], kind: 'energy' },
    { canon: 'MeV', alts: [], kind: 'energy' },
    /* 生物 / 分子 */
    { canon: 'bp', alts: ['Bp'], kind: 'bio' },
    { canon: 'kb', alts: ['KB', 'Kb', 'kbp', 'KBP'], kind: 'bio' },
    { canon: 'Mb', alts: ['MB', 'Mbp'], kind: 'bio' },
    { canon: 'nt', alts: [], kind: 'bio' },
    { canon: 'aa', alts: [], kind: 'bio' },
    { canon: 'OD₆₀₀', alts: ['OD600', 'od600'], kind: 'bio' },
    { canon: 'MOI', alts: ['moi', 'Moi'], kind: 'bio' },
    { canon: 'pH', alts: ['PH', 'Ph', 'ph'], kind: 'bio' },
    { canon: 'pI', alts: [], kind: 'bio' },
    { canon: 'rRNA', alts: ['rRna'], kind: 'bio' },
    { canon: 'mRNA', alts: ['mRna'], kind: 'bio' },
    { canon: 'cDNA', alts: ['cDna'], kind: 'bio' },
    { canon: 'DNA', alts: ['dna'], kind: 'bio' },
    { canon: 'RNA', alts: ['rna'], kind: 'bio' },
    { canon: 'PCR', alts: ['pcr'], kind: 'bio' },
    { canon: 'RT-PCR', alts: ['RT PCR', 'rt-PCR'], kind: 'bio' },
    { canon: 'qPCR', alts: ['QPCR', 'qpcr'], kind: 'bio' },
    { canon: 'ELISA', alts: ['Elisa'], kind: 'bio' },
    { canon: 'SDS-PAGE', alts: ['SDS PAGE'], kind: 'bio' },
    { canon: 'PBS', alts: ['pbs'], kind: 'bio' },
    { canon: 'FBS', alts: ['fbs'], kind: 'bio' },
    { canon: 'DMEM', alts: ['dmem'], kind: 'bio' },
    { canon: 'DMSO', alts: ['dmso'], kind: 'bio' },
    { canon: 'IC₅₀', alts: ['IC50', 'ic50'], kind: 'bio' },
    { canon: 'EC₅₀', alts: ['EC50'], kind: 'bio' },
    { canon: 'LD₅₀', alts: ['LD50'], kind: 'bio' },
    /* 其它 */
    { canon: 'cd', alts: [], kind: 'other' },
    { canon: 'lx', alts: ['LX'], kind: 'other' },
    { canon: 'dB', alts: [], kind: 'other' },
    { canon: 'ppm', alts: ['PPM'], kind: 'conc' },
    { canon: 'ppb', alts: ['PPB'], kind: 'conc' },
    { canon: 'r/min', alts: [], kind: 'speed' }
  ];

  /* ------------------------------------------------------------------
   * 二、机器可读规则（引擎按此检查与修正）
   * ------------------------------------------------------------------ */
  var UNIT_PARAMS = {
    enabled: false,          // 总开关（默认关闭，避免影响与规范无关的文档）
    fixSpelling: true,       // 单位拼写与大小写（ul→μL、KD→kDa…）
    spaceNumber: true,       // 数字与单位之间加空格（10μL → 10 μL）
    tightPercent: true,      // % ‰ ° ′ ″ 与数字紧贴（95 % → 95%）
    celsius: 'degree',       // 温度统一：degree(°C) | char(℃) | keep
    celsiusSpace: true,      // °C 前是否加空格（37 °C / 37°C）
    mathSpace: true,         // = < > ≤ ≥ ± × ÷ 前后加空格
    timesSign: true,         // "3 x 10" → "3 × 10"（仅数字之间的 x）
    slashTight: true,        // 斜杠两侧不留空格（5 ng / μL → 5 ng/μL）
    halfWidth: true,         // 全角数字/字母/空格 → 半角
    superDigit: false,       // cm2 → cm²、10^10 → 10¹⁰（默认关闭，改动较大）
    unitList: []             // 留空 = 使用内置词典
  };

  /* ------------------------------------------------------------------
   * 三、人可读的规范条目（界面浏览 / 搜索 / 一键套用）
   *   level: high(必须) / medium(建议) / low(排版偏好)
   *   params: 点击"应用到设置"时写入的参数
   * ------------------------------------------------------------------ */
  var CATEGORIES = [
    {
      id: 'space', name: '一、空格规则', desc: '数字与单位、内容之间是否加空格（原稿第一节，已细化）',
      items: [
        { id: 'sp-1', level: 'high', text: '常规单位与数字之间加一个<b>半角空格</b>：时间、体积、质量/浓度、转速、拷贝数、分子量、倍数、实验参数。',
          ok: ['4 h', '12 min', '30 s', '10 μL', '2 mL', '500 mL', '5 ng/μL', '0.2 μmol/L', '12000 rpm', '10000 ×g', '10¹⁰ copies/μL', '15 kDa', '10 倍', 'MOI = 0.5', 'pH 7.4'],
          bad: ['4h', '10μL', '15kDa', 'MOI=0.5'], params: { 'unit.enabled': true, 'unit.spaceNumber': true } },
        { id: 'sp-2', level: 'high', text: '<b>仅 3 类符号</b>与数字紧贴、中间不空格：① 百分号/千分号 % ‰；② 角度符号 ° ′ ″；③ 温度符号 ℃/°C（见下条）。',
          ok: ['95%', '0.05%', '37°', '45°30′', '10″'], bad: ['95 %', '37 °', '45° 30′'] },
        { id: 'sp-3', level: 'medium', text: '温度写法<b>全文统一</b>，禁止混用：中文/国内期刊常用 <code>37 ℃</code>（数字与符号间加空格）；英文期刊与 ISO 80000 用 <code>37 °C</code>（° 与 C 之间不加空格）。',
          ok: ['37 ℃（全文统一）', '37 °C（全文统一）'], bad: ['前文 37℃ 后文 37 ℃', '37° C'], params: { 'unit.celsius': 'degree', 'unit.celsiusSpace': true } },
        { id: 'sp-4', level: 'medium', text: '数字与单位之间用<b>半角空格</b>，不要用全角空格（U+3000）或连续多个空格。',
          ok: ['10 μL'], bad: ['10　μL（全角空格）', '10  μL'] },
        { id: 'sp-5', level: 'medium', text: '斜杠 "/" 两侧不留空格：<code>ng/μL</code>、<code>copies/μL</code>、<code>mol/L</code>。',
          ok: ['5 ng/μL', '0.2 μmol/L'], bad: ['5 ng / μL', '0.2 μmol / L'], params: { 'unit.slashTight': true } },
        { id: 'sp-6', level: 'low', text: '数字与中文单位（倍、天、次）之间加空格：<code>10 倍</code>、<code>3 天</code>、<code>2 次</code>。',
          ok: ['10 倍', '3 天', '2 次'], bad: ['10倍', '3天'] }
      ]
    },
    {
      id: 'unit', name: '二、单位书写规范', desc: '大小写与字符（原稿第二节，已补充完整清单）',
      items: [
        { id: 'un-1', level: 'high', text: '分子量：<code>kDa</code>（k 小写、D 大写、a 小写），禁止 KD / kD / KDa。',
          ok: ['15 kDa', '43 kDa'], bad: ['15 KD', '43 kD'], params: { 'unit.fixSpelling': true } },
        { id: 'un-2', level: 'high', text: '体积单位：用希腊字母 <code>μL</code>，禁止 uL / ul / μl。',
          ok: ['10 μL'], bad: ['10 uL', '10 ul'] },
        { id: 'un-3', level: 'high', text: '升的符号是<b>大写 L</b>：<code>mL</code>、<code>μL</code>、<code>dL</code>，禁止 ml / ul / l（单独作为升时）。',
          ok: ['500 mL', '2 L'], bad: ['500 ml', '2 l'] },
        { id: 'un-4', level: 'high', text: '温度符号优先 <code>°C</code>（C 大写）；℃（U+2103 单字符）兼容性差，建议替换为 °C。',
          ok: ['37 °C'], bad: ['37 OC', '37 oC'], params: { 'unit.celsius': 'degree' } },
        { id: 'un-5', level: 'high', text: '秒用 <code>s</code>，不用 sec/secs；小时用 <code>h</code>，不用 hr/hrs。',
          ok: ['30 s', '4 h'], bad: ['30 sec', '4 hrs'] },
        { id: 'un-6', level: 'high', text: '转速 <code>rpm</code> 全小写；相对离心力写 <code>×g</code>（避免与质量单位 g 混淆）。',
          ok: ['12000 rpm', '10000 ×g'], bad: ['12000 RPM', '10000 g（应为 ×g）'] },
        { id: 'un-7', level: 'medium', text: '摩尔浓度推荐 <code>mol/L</code>、<code>mmol/L</code>、<code>μmol/L</code>；若用 M/mM/μM 简写，则全文统一。',
          ok: ['0.2 mol/L', '5 mmol/L'], bad: ['0.2 mol/l', '5 mM 与 5 mmol/L 混用'] },
        { id: 'un-8', level: 'medium', text: '幂次用<b>真上标</b>：<code>cm²</code>、<code>m³</code>、<code>10¹⁰</code>，不要写 cm2 / m3 / 10^10。',
          ok: ['cm²', 'm³', '10¹⁰'], bad: ['cm2', 'm3', '10^10'], params: { 'unit.superDigit': true } },
        { id: 'un-9', level: 'medium', text: '生物学术语大小写固定：<code>pH</code>（p 小写 H 大写）、<code>OD₆₀₀</code>、<code>MOI</code>、<code>IC₅₀</code>、<code>RT-PCR</code>、<code>DNA/RNA</code>。',
          ok: ['pH 7.4', 'OD₆₀₀', 'IC₅₀'], bad: ['PH 7.4', 'OD600', 'IC50'] },
        { id: 'un-10', level: 'medium', text: '单位前的数字用<b>阿拉伯数字</b>（除"一"作汉字时）；数字用半角。',
          ok: ['3 次重复'], bad: ['三次重复（数据描述中）', '３次'] },
        { id: 'un-11', level: 'low', text: '量符号用斜体、单位用正体（ISO 80000）：如 <i>m</i> = 5 g、<i>V</i> = 10 mL。',
          ok: ['<i>m</i> = 5 g'], bad: ['m=5g'] }
      ]
    },
    {
      id: 'math', name: '三、数学符号格式', desc: '原稿第三节，已补充 ± ÷ ≤ ≥ 与范围号',
      items: [
        { id: 'ma-1', level: 'high', text: '<code>=</code> <code>&lt;</code> <code>&gt;</code> <code>≤</code> <code>≥</code> <code>±</code> <code>×</code> <code>÷</code> 前后各加一个空格。',
          ok: ['P < 0.05', 'R² > 0.9959', 'y = -3.2413x + 42.927', '3 × 10¹⁰', '25 ± 0.5'],
          bad: ['P<0.05', 'R²>0.9959', 'y=-3.2413x+42.927', '3×10¹⁰', '25±0.5'], params: { 'unit.mathSpace': true } },
        { id: 'ma-2', level: 'high', text: '乘号必须用 <code>×</code>（U+00D7），不能用字母 x、X 或星号 *。',
          ok: ['3 × 10¹⁰'], bad: ['3 x 10¹⁰', '3 * 10¹⁰'], params: { 'unit.timesSign': true } },
        { id: 'ma-3', level: 'medium', text: '数值范围的连接号统一：中文用 <code>~</code> 或浪纹 <code>～</code>，英文用 en dash <code>–</code>；不要用半角连字符 -。',
          ok: ['5~10 mg', '5–10 mg'], bad: ['5-10 mg'] },
        { id: 'ma-4', level: 'medium', text: '公差不重复写单位：<code>25 ± 0.5 °C</code>，不是 25 °C ± 0.5 °C。',
          ok: ['25 ± 0.5 °C'], bad: ['25 °C ± 0.5 °C'] },
        { id: 'ma-5', level: 'low', text: '化学式与反应式中的系数、上下标用正体/上下标格式，如 <code>H₂O</code>、<code>CO₂</code>。',
          ok: ['H₂O', 'CO₂'], bad: ['H2O（正式排版）'] }
      ]
    },
    {
      id: 'abbr', name: '四、英文缩写格式', desc: '原稿第四节，已补充首现全称规则',
      items: [
        { id: 'ab-1', level: 'high', text: '缩写与数字之间加空格：<code>MOI 0.5</code>、<code>OD₆₀₀ 0.8</code>。',
          ok: ['MOI 0.5'], bad: ['MOI0.5'] },
        { id: 'ab-2', level: 'high', text: '缩写与中文之间加空格：<code>RT-PCR 产物</code>、<code>DNA 提取</code>。',
          ok: ['RT-PCR 产物', 'DNA 提取'], bad: ['RT-PCR产物', 'DNA提取'] },
        { id: 'ab-3', level: 'medium', text: '常规单位缩写（h、min、μL 等）只与<b>前面的数字</b>加空格，与后面文字不加。',
          ok: ['10 μL 样品'], bad: ['10μL样品', '10 μL样品'] },
        { id: 'ab-4', level: 'medium', text: '缩写<b>首次出现</b>给出全称：如"信使 RNA（mRNA）"，后文直接用缩写。',
          ok: ['信使 RNA（mRNA）'], bad: ['直接使用 mRNA 未给全称'] },
        { id: 'ab-5', level: 'medium', text: '同一缩写全文统一，禁止混用不同写法（如 PCR / pcr / P.C.R.）。',
          ok: ['全文 PCR'], bad: ['PCR 与 pcr 混用'], params: { 'unit.fixSpelling': true } },
        { id: 'ab-6', level: 'low', text: '英文字母与中文之间按需加空格（西文与中文混排），避免拥挤。',
          ok: ['使用 PBS 缓冲液'], bad: ['使用PBS缓冲液'] }
      ]
    },
    {
      id: 'font', name: '五、文字格式要求', desc: '原稿第五节，已补充行距、缩进与标题层级',
      items: [
        { id: 'fo-1', level: 'high', text: '英文：<b>Times New Roman</b>。',
          ok: ['Times New Roman'], bad: ['Arial / Calibri（与中文混排）'], params: { 'body.latinFont': 'Times New Roman', 'body.enabled': true } },
        { id: 'fo-2', level: 'high', text: '中文（论文正文）：<b>宋体 五号（10.5 磅）</b>。',
          ok: ['宋体 10.5 磅'], bad: ['黑体正文'], params: { 'body.cnFont': '宋体', 'body.size': 10.5, 'body.enabled': true } },
        { id: 'fo-3', level: 'high', text: '中文（申报书正文）：<b>宋体 / 仿宋_GB2312 小四（12 磅）</b>。',
          ok: ['仿宋_GB2312 12 磅'], bad: ['宋体 五号（申报书）'], params: { 'body.cnFont': '仿宋_GB2312', 'body.size': 12, 'body.enabled': true } },
        { id: 'fo-4', level: 'high', text: '申报书中<b>插入图片的注释</b>：宋体 小四 加粗。',
          ok: ['宋体 12 磅 加粗'], bad: ['注释用五号'], params: { 'caption.enabled': true, 'caption.font': '宋体', 'caption.size': 12, 'caption.bold': true } },
        { id: 'fo-5', level: 'medium', text: '正文段落统一：首行缩进 2 字符、行距 1.5 倍、两端对齐、段前段后 0。',
          ok: ['缩进 2 字符 / 1.5 倍行距'], bad: ['用空格手动缩进'], params: { 'paragraph.enabled': true, 'paragraph.indentChars': 2, 'paragraph.lineRule': 'multiple', 'paragraph.lineValue': 1.5, 'paragraph.align': 'both' } },
        { id: 'fo-6', level: 'medium', text: '标题层级与正文区分：一级黑体、二级楷体、三级仿宋（或按单位模板），编号连续。',
          ok: ['第一章 → 1.1 → 1.1.1'], bad: ['层级乱跳、编号重复'], params: { 'headings.enabled': true } },
        { id: 'fo-7', level: 'medium', text: '图题在下、表题在上；图表编号连续并与正文引用一致。',
          ok: ['图 1 　…（图下）'], bad: ['图题在图上', '编号跳号'], params: { 'caption.enabled': true, 'caption.detectPattern': true } }
      ]
    },
    {
      id: 'grammar', name: '六、语法问题', desc: '原稿第六节，已给出可执行的检查方式',
      items: [
        { id: 'gr-1', level: 'medium', text: '中译英后易出现<b>冠词缺失、主谓不一致、单复数错误</b>，需逐句核对。',
          ok: ['The samples were incubated…'], bad: ['Sample was incubate…'] },
        { id: 'gr-2', level: 'medium', text: '英文标点用半角、中文标点用全角，<b>不要混用</b>。',
          ok: ['This is fine, and 这是中文，正确。'], bad: ['This is fine，and 这是中文,错误。'], params: { 'punctuation.enabled': true, 'punctuation.mode': 'smart' } },
        { id: 'gr-3', level: 'low', text: '英文句末句点后加一个空格；中文句末用全角句号，后不加空格。',
          ok: ['OK. Next sentence.'], bad: ['OK.Next sentence.'] },
        { id: 'gr-4', level: 'low', text: '避免中英混排时出现多余空格（如"使用 PBS  缓冲液"里的双空格）。',
          ok: ['使用 PBS 缓冲液'], bad: ['使用 PBS  缓冲液'], params: { 'whitespace.enabled': true, 'whitespace.collapseSpaces': true } }
      ]
    },
    {
      id: 'ref', name: '七、文献引用', desc: '原稿第七节，已补充具体检查项',
      items: [
        { id: 're-1', level: 'high', text: '从论文综述复制参考文献到申报书时，常残留<b>多余空格</b>（尤其是英文作者名、期刊名之间）。',
          ok: ['Zhang Y, Li X. J Biol Chem. 2020;295:1-10.'],
          bad: ['Zhang  Y , Li  X . J  Biol Chem . 2020 ; 295 : 1-10 .'], params: { 'whitespace.enabled': true, 'whitespace.collapseSpaces': true } },
        { id: 're-2', level: 'high', text: '页码与年份中的<b>连字符</b>易出错：页码范围用 en dash（<code>1–10</code>），不要写成 1 - 10 或 1-10 与 1–10 混用。',
          ok: ['295:1–10'], bad: ['295 : 1 - 10'] },
        { id: 're-3', level: 'medium', text: '参考文献编号与正文引用一一对应，编号连续、格式统一（GB/T 7714 或目标期刊格式）。',
          ok: ['[1] … 正文出现 [1]'], bad: ['正文引用 [3] 但只有 2 条文献'] },
        { id: 're-4', level: 'medium', text: '文献中的英文标点统一为半角，中文文献用中文标点。',
          ok: ['[1] 张三. 水凝胶研究[J]. 材料学报, 2020, 34(2): 1–10.'],
          bad: ['[1] 张三．水凝胶研究【J】．材料学报，2020，34（2）：1-10．'] },
        { id: 're-5', level: 'low', text: '正文引用角标应为真上标，且不与前文数字粘连（如"效率提升68%[1]"应写为"效率提升 68%[1]"）。',
          ok: ['效率提升 68%[1]'], bad: ['效率提升68%[1]'] }
      ]
    },
    {
      id: 'extra', name: '八、本次校订新增', desc: '原稿未覆盖、但实际排版中高频出错的条目',
      items: [
        { id: 'ex-1', level: 'high', text: '<b>全角/半角统一</b>：数字、字母、单位一律半角；全角数字（１０）与全角单位（μＬ）必须转半角。',
          ok: ['10 μL'], bad: ['１０μＬ'], params: { 'unit.halfWidth': true } },
        { id: 'ex-2', level: 'medium', text: '<b>千分位</b>：四位以上数字按目标期刊要求决定是否加千分位（1,000 或 1000），全文统一；建议量值不加千分位。',
          ok: ['1000 万元（全文统一）'], bad: ['1,000 与 1000 混用'] },
        { id: 'ex-3', level: 'medium', text: '<b>有效数字</b>：同一指标的有效位数全文一致（如均保留两位小数），测量值精度不高于仪器精度。',
          ok: ['0.05%、0.10%、0.15%'], bad: ['0.05%、0.1%、0.153%'] },
        { id: 'ex-4', level: 'medium', text: '<b>符号与单位不重复</b>：<code>10 mol/L</code> 不写 <code>10 mol/L 浓度</code>；<code>37 °C</code> 不写 <code>37 °C 温度</code>（标题除外）。',
          ok: ['浓度 10 mol/L'], bad: ['10 mol/L 浓度值'] },
        { id: 'ex-5', level: 'medium', text: '<b>空格与标点联动</b>：单位后紧跟中文标点时不要留空格（<code>10 μL，</code>）；紧跟英文标点时按英文规则（<code>10 μL,</code>）。',
          ok: ['量取 10 μL，混匀。'], bad: ['量取 10 μL ，混匀 。'] },
        { id: 'ex-6', level: 'medium', text: '<b>上下标不丢</b>：<code>10⁶</code>、<code>CO₂</code>、<code>cm²</code>、<code>IC₅₀</code> 复制粘贴后易退化成普通字符，需检查。',
          ok: ['10⁶ TCID₅₀/mL'], bad: ['106 TCID50/mL'] },
        { id: 'ex-7', level: 'medium', text: '<b>表格与图内单位</b>：表头写"浓度/(mol/L)"或"浓度 (mol/L)"，全文统一；数据列不重复写单位。',
          ok: ['浓度 (mol/L)'], bad: ['每格写 0.2 mol/L'] },
        { id: 'ex-8', level: 'low', text: '<b>中文里不要用英文空格排版</b>：用首行缩进而不是打空格；用全角标点而不是"空格 + 标点"。',
          ok: ['（缩进）本文研究…'], bad: ['　　本文研究…（用空格缩进）'], params: { 'paragraph.indentChars': 2, 'whitespace.trimEnds': true } },
        { id: 'ex-9', level: 'low', text: '<b>希腊字母与拉丁字母区分</b>：μ（U+03BC）/ µ（U+00B5）、α/β/γ 不要用英文 a/b/y 代替。',
          ok: ['5 μg/μL'], bad: ['5 ug/ul', '5 αg'] },
        { id: 'ex-10', level: 'low', text: '<b>单位与数值不可断开换行</b>：必要时用不换行空格（Ctrl+Shift+Space），避免"10"在行尾、"μL"在行首。',
          ok: ['10 μL（不断开）'], bad: ['行尾 10 / 行首 μL'] }
      ]
    }
  ];

  DFT.KNOWLEDGE = {
    version: '1.1',
    title: '实验论文数字 & 单位格式规范',
    subtitle: '原稿校订版（依据 ISO 80000、GB 3100~3102、GB/T 15834 补充）',
    sourceDoc: 'check_list.docx',
    updated: '2026-10',
    units: UNITS,
    unitParams: UNIT_PARAMS,
    categories: CATEGORIES,
    /* 统计信息，用于界面展示 */
    stats: function () {
      var items = 0;
      CATEGORIES.forEach(function (c) { items += c.items.length; });
      return { categories: CATEGORIES.length, items: items, units: UNITS.length,
               wrongForms: UNITS.reduce(function (a, u) { return a + u.alts.length; }, 0) };
    }
  };
})(typeof window !== 'undefined' ? window : this);
