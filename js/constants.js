/* =============================================================================
 * 文档格式批量整改工具 —— 常量与默认参数 (constants.js)
 * 说明：本文件集中定义所有可配置参数的默认值、内置排版模板、字体库、
 *       字号预设与标点映射表。所有参数均为纯数据，便于保存 / 复用 / 导出。
 * 依赖：无（纯数据）
 * ========================================================================== */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';

  /* ---------------------------------------------------------------------------
   * 1. 默认参数（与界面一一对应）
   * ------------------------------------------------------------------------ */
  var DEFAULT_PARAMS = {
    /* 页面设置：页边距，单位厘米(cm) */
    page: {
      enabled: true,
      top: 2.54,
      bottom: 2.54,
      left: 3.17,
      right: 3.17
    },

    /* 正文文字格式 */
    body: {
      enabled: true,
      cnFont: '宋体',            // 中文字体
      latinFont: 'Times New Roman', // 西文字体（字母）
      size: 12,                  // 字号(pt)，12pt = 小四
      bold: false,
      color: '#000000'
    },

    /* 数字格式（可与正文分离） */
    digit: {
      enabled: true,             // 开启后：数字单独使用下面的字体/字号/颜色
      body:    { font: 'Times New Roman', size: 12,   bold: false, color: '#000000' }, // 正文数字
      heading: { font: 'Times New Roman', size: 14,   bold: true,  color: '#000000' }, // 标题数字
      caption: { font: 'Times New Roman', size: 10.5, bold: false, color: '#000000' }, // 注释(图表题注)数字
      table:   { font: 'Times New Roman', size: 10.5, bold: false, color: '#000000' }  // 表格内数字
    },

    /* 表格专项格式化（独立于正文，可按需开启） */
    table: {
      enabled: false,            // 关闭时：表格文字跟随正文设置；开启后使用下面的独立设置
      cnFont: '宋体',            // 表格中文字体
      latinFont: 'Times New Roman', // 表格西文字体
      size: 10.5,                // 表格字号(磅)
      bold: false,               // 表格文字加粗
      color: '#000000',          // 表格文字颜色
      headerBold: true,          // 表头行加粗
      headerDetect: 'firstRow',  // firstRow(首行) | firstRowCol(首行+首列) | none
      headerFill: '',            // 表头底色（空=不改），如 #DCE6F1
      applyParagraph: false,     // 是否统一表格内段落的行距与对齐
      lineMode: 'multiple',      // multiple | fixed | atLeast
      lineValue: 1.0,
      align: '',                 // 单元格文字对齐：'' 不改动 | left | center | right | justify
      /* —— 边框与线型 —— */
      borderEnabled: false,
      borderStyle: 'single',     // single(单线) | double(双线) | threeLine(三线表) | none(无边框)
      borderSize: 6,             // 线宽，单位 1/8 磅（6 ≈ 0.75 磅）
      borderColor: '#000000',
      bodyFill: '',              // 表格主体底色（空=不改）
      /* —— 行高 / 列宽 / 整体 —— */
      rowHeightEnabled: false,
      rowHeight: 0.8,            // 厘米
      rowHeightRule: 'atLeast',  // atLeast(最小值) | exact(固定值) | auto(自动)
      fitPage: true,             // 超出页宽时自动缩放适配页宽
      tableAlign: '',            // 表格整体对齐：'' 不改动 | left | center | right
      /* —— 数字对齐 —— */
      numberAlign: 'none',       // none | center | right | decimal(小数点对齐)
      /* —— 跨页表头 —— */
      repeatHeader: true         // 跨页时重复表头行
    },

    /* 角标（上标 / 下标）智能识别与格式 */
    script: {
      enabled: true,
      detectMarked: true,        // 识别带 vertAlign 标记的真角标（准确率 100%）
      detectSmall: true,         // 智能识别"小字号、未标记"的假角标（如 cm3、m2、10^3）
      mode: 'normalize',         // preserve(完全保留原样) | normalize(统一字号/基线，修正假角标)
      sizeMode: 'follow',        // follow(跟随所在段落正文) | scale(正文的百分比) | fixed(固定磅值)
      scale: 100,                // %
      size: 9,                   // 固定磅值
      font: '',                  // 空 = 保留原角标字体
      color: '',                 // 空 = 保留原角标颜色
      bold: false,               // 角标加粗
      keepBold: true,            // 保留原加粗状态
      manual: ''                 // 手动指定内容：分号/换行分隔，支持 /正则/
    },

    /* 整改范围（选择性保护，防止误改） */
    range: {
      enabled: true,             // 总开关：关闭后所有保护失效（全文都整改）
      mode: 'all',               // all(全文) | pages(指定页) | sections(指定分节)
      pages: '',                 // 例如 2-10,12,15-  （按文档中的分页符划分）
      sections: '',              // 例如 2-4
      protectCover: true,        // 智能豁免封面页
      protectToc: true,          // 智能豁免目录
      protectRefs: false,        // 豁免参考文献
      protectAppendix: false,    // 豁免附录 / 致谢
      sectionRules: {},          // { "2": { enabled:false } } 或 { "3": { templateId:"gov" } }
      highlight: true            // 原文档预览中高亮"不会被整改"的区域
    },

    /* 标题层级标准化 */
    headings: {
      enabled: true,
      heuristic: true,           // 未套用标题样式时，用编号/短句启发式识别标题
      numbering: 'auto',         // auto | chapter(第X章/1.1.1) | chinese(一、（一）1.)
      h1: { font: '黑体', size: 16, bold: false, color: '#000000', align: 'center',
            lineMode: 'fixed', lineValue: 29, before: 0, after: 0, indentChars: 0 },
      h2: { font: '楷体', size: 16, bold: true,  color: '#000000', align: 'left',
            lineMode: 'fixed', lineValue: 29, before: 0, after: 0, indentChars: 0 },
      h3: { font: '仿宋', size: 16, bold: true,  color: '#000000', align: 'left',
            lineMode: 'fixed', lineValue: 29, before: 0, after: 0, indentChars: 0 }
    },

    /* 段落排版 */
    paragraph: {
      enabled: true,
      lineMode: 'multiple',      // multiple(多倍) | fixed(固定值) | atLeast(最小值)
      lineValue: 1.5,            // 倍数时取值如 1.5；固定值/最小值时单位为磅(pt)
      before: 0,                 // 段前距(pt)
      after: 0,                  // 段后距(pt)
      indentChars: 2,            // 首行缩进字符数 0-4
      align: 'justify',          // left | center | right | justify(两端对齐)
      skipHeadingIndent: true,   // 标题不缩进
      skipShortLineIndent: true, // 短句不缩进
      shortLineMax: 20,          // 短句判定：字数不超过
      keepListIndent: true       // 列表/编号段落保留自身缩进
    },

    /* 标点符号整改 */
    punctuation: {
      enabled: true,
      mode: 'smart',             // smart(智能中英分离) | full(统一全角) | half(统一半角) | clean(仅清理乱码)
      halfWidthToHalf: true,     // 全角字母数字转半角
      cleanGarbage: true,        // 清除乱码/不可见字符
      smartQuotes: true,         // 引号成对智能修正
      protectDecimal: true,      // 保护小数点/编号/网址中的点
      protectUrl: true,          // 保护网址、邮箱、文件名
      collapseRepeats: true      // 合并重复标点（！！！ → ！）
    },

    /* 空格与空行清理 */
    whitespace: {
      enabled: true,
      trimEnds: true,            // 清除段首尾空格
      collapseSpaces: true,      // 合并段落中间连续空格
      removeEmpty: true,         // 删除空段落
      maxEmpty: 0,               // 允许保留的最大连续空行数
      removePageBreakInEmpty: true, // 删除空段落中的分页符（空白页）
      fullWidthSpaceToHalf: true // 全角空格转半角（中文缩进仍由首行缩进控制）
    },

    /* 图片 / 表格注释（题注）格式 */
    caption: {
      enabled: true,
      font: '楷体',
      size: 10.5,
      bold: false,
      color: '#000000',
      lineMode: 'multiple',
      lineValue: 1.25,
      align: 'center',           // left | center | right | justify
      indentChars: 0,
      prefix: '',                // 统一前缀，例如 “图 ”
      suffix: '',                // 统一后缀
      detectPattern: true,       // 按 “图1 / 表2 / Figure 3” 等关键字识别题注
      afterImage: true           // 将紧跟在图片后的短段落识别为题注
    },

    /* 公式与特殊字符保护 */
    formula: {
      enabled: true,             // 不修改公式（OMML）内部格式
      protectUnits: true         // 不修改含数学/单位符号的短片段
    },

    /* 处理范围 */
    scope: {
      tables: true,              // 表格内文字
      textboxes: true,           // 文本框内文字
      headers: true,             // 页眉
      footers: true,             // 页脚
      comments: false,           // 批注
      footnotes: false           // 脚注/尾注
    }
  };

  /* ---------------------------------------------------------------------------
   * 2. 内置 5 套排版模板（一键套用，只覆盖模板中出现的字段）
   * ------------------------------------------------------------------------ */
  var TEMPLATES = [
    {
      id: 'gov',
      name: '公文标准',
      desc: '党政机关公文格式（GB/T 9704）：三号仿宋、固定行距 29 磅、公文页边距',
      params: {
        page: { enabled: true, top: 3.7, bottom: 3.5, left: 2.8, right: 2.6 },
        body: { enabled: true, cnFont: '仿宋', latinFont: 'Times New Roman', size: 16, bold: false, color: '#000000' },
        digit: {
          enabled: true,
          body:    { font: 'Times New Roman', size: 16,   bold: false, color: '#000000' },
          heading: { font: 'Times New Roman', size: 16,   bold: false, color: '#000000' },
          caption: { font: 'Times New Roman', size: 14,   bold: false, color: '#000000' }
        },
        headings: {
          enabled: true, heuristic: true, numbering: 'chinese',
          h1: { font: '黑体', size: 16, bold: false, color: '#000000', align: 'left', lineMode: 'fixed', lineValue: 29, before: 0, after: 0, indentChars: 2 },
          h2: { font: '楷体', size: 16, bold: true,  color: '#000000', align: 'left', lineMode: 'fixed', lineValue: 29, before: 0, after: 0, indentChars: 2 },
          h3: { font: '仿宋', size: 16, bold: true,  color: '#000000', align: 'left', lineMode: 'fixed', lineValue: 29, before: 0, after: 0, indentChars: 2 }
        },
        paragraph: { enabled: true, lineMode: 'fixed', lineValue: 29, before: 0, after: 0, indentChars: 2,
                     align: 'justify', skipHeadingIndent: false, skipShortLineIndent: false, shortLineMax: 20, keepListIndent: true },
        caption: { enabled: true, font: '楷体', size: 14, bold: false, color: '#000000', lineMode: 'fixed', lineValue: 29,
                   align: 'center', indentChars: 0, prefix: '', suffix: '', detectPattern: true, afterImage: true },
        punctuation: { enabled: true, mode: 'smart', halfWidthToHalf: true, cleanGarbage: true, smartQuotes: true,
                       protectDecimal: true, protectUrl: true, collapseRepeats: true },
        whitespace: { enabled: true, trimEnds: true, collapseSpaces: true, removeEmpty: true, maxEmpty: 0,
                      removePageBreakInEmpty: true, fullWidthSpaceToHalf: true }
      }
    },
    {
      id: 'thesis',
      name: '大学论文',
      desc: '毕业论文学位论文常用格式：宋体小四、1.5 倍行距、三级标题黑体分级',
      params: {
        page: { enabled: true, top: 2.54, bottom: 2.54, left: 3.17, right: 3.17 },
        body: { enabled: true, cnFont: '宋体', latinFont: 'Times New Roman', size: 12, bold: false, color: '#000000' },
        digit: {
          enabled: true,
          body:    { font: 'Times New Roman', size: 12,   bold: false, color: '#000000' },
          heading: { font: 'Times New Roman', size: 14,   bold: true,  color: '#000000' },
          caption: { font: 'Times New Roman', size: 10.5, bold: false, color: '#000000' }
        },
        headings: {
          enabled: true, heuristic: true, numbering: 'chapter',
          h1: { font: '黑体', size: 16, bold: false, color: '#000000', align: 'center', lineMode: 'multiple', lineValue: 1.5, before: 12, after: 12, indentChars: 0 },
          h2: { font: '黑体', size: 14, bold: false, color: '#000000', align: 'left',   lineMode: 'multiple', lineValue: 1.5, before: 6,  after: 6,  indentChars: 0 },
          h3: { font: '黑体', size: 12, bold: false, color: '#000000', align: 'left',   lineMode: 'multiple', lineValue: 1.5, before: 6,  after: 6,  indentChars: 0 }
        },
        paragraph: { enabled: true, lineMode: 'multiple', lineValue: 1.5, before: 0, after: 0, indentChars: 2,
                     align: 'justify', skipHeadingIndent: true, skipShortLineIndent: true, shortLineMax: 20, keepListIndent: true },
        caption: { enabled: true, font: '宋体', size: 10.5, bold: false, color: '#000000', lineMode: 'multiple', lineValue: 1.0,
                   align: 'center', indentChars: 0, prefix: '', suffix: '', detectPattern: true, afterImage: true },
        punctuation: { enabled: true, mode: 'smart', halfWidthToHalf: true, cleanGarbage: true, smartQuotes: true,
                       protectDecimal: true, protectUrl: true, collapseRepeats: true },
        whitespace: { enabled: true, trimEnds: true, collapseSpaces: true, removeEmpty: true, maxEmpty: 0,
                      removePageBreakInEmpty: true, fullWidthSpaceToHalf: true }
      }
    },
    {
      id: 'report',
      name: '实习报告',
      desc: '实习 / 实践报告常用格式：宋体小四、1.5 倍行距、标题黑体分级加粗',
      params: {
        page: { enabled: true, top: 2.54, bottom: 2.54, left: 2.8, right: 2.6 },
        body: { enabled: true, cnFont: '宋体', latinFont: 'Times New Roman', size: 12, bold: false, color: '#000000' },
        digit: {
          enabled: true,
          body:    { font: 'Times New Roman', size: 12,   bold: false, color: '#000000' },
          heading: { font: 'Times New Roman', size: 14,   bold: true,  color: '#000000' },
          caption: { font: 'Times New Roman', size: 10.5, bold: false, color: '#000000' }
        },
        headings: {
          enabled: true, heuristic: true, numbering: 'chapter',
          h1: { font: '黑体', size: 18, bold: true, color: '#000000', align: 'center', lineMode: 'multiple', lineValue: 1.5, before: 12, after: 12, indentChars: 0 },
          h2: { font: '黑体', size: 14, bold: true, color: '#000000', align: 'left',   lineMode: 'multiple', lineValue: 1.5, before: 6,  after: 6,  indentChars: 0 },
          h3: { font: '宋体', size: 12, bold: true, color: '#000000', align: 'left',   lineMode: 'multiple', lineValue: 1.5, before: 6,  after: 6,  indentChars: 0 }
        },
        paragraph: { enabled: true, lineMode: 'multiple', lineValue: 1.5, before: 0, after: 0, indentChars: 2,
                     align: 'justify', skipHeadingIndent: true, skipShortLineIndent: true, shortLineMax: 20, keepListIndent: true },
        caption: { enabled: true, font: '宋体', size: 10.5, bold: false, color: '#000000', lineMode: 'multiple', lineValue: 1.0,
                   align: 'center', indentChars: 0, prefix: '', suffix: '', detectPattern: true, afterImage: true },
        punctuation: { enabled: true, mode: 'smart', halfWidthToHalf: true, cleanGarbage: true, smartQuotes: true,
                       protectDecimal: true, protectUrl: true, collapseRepeats: true },
        whitespace: { enabled: true, trimEnds: true, collapseSpaces: true, removeEmpty: true, maxEmpty: 0,
                      removePageBreakInEmpty: true, fullWidthSpaceToHalf: true }
      }
    },
    {
      id: 'office',
      name: '日常办公',
      desc: '通用办公文档：微软雅黑五号、1.15 倍行距、段后 6 磅、无首行缩进',
      params: {
        page: { enabled: true, top: 2.2, bottom: 2.2, left: 2.5, right: 2.5 },
        body: { enabled: true, cnFont: '微软雅黑', latinFont: 'Segoe UI', size: 10.5, bold: false, color: '#262626' },
        digit: {
          enabled: true,
          body:    { font: 'Segoe UI', size: 10.5, bold: false, color: '#262626' },
          heading: { font: 'Segoe UI', size: 16,   bold: true,  color: '#1a1a1a' },
          caption: { font: 'Segoe UI', size: 9,    bold: false, color: '#595959' }
        },
        headings: {
          enabled: true, heuristic: true,
          h1: { font: '微软雅黑', size: 18, bold: true, color: '#1a1a1a', align: 'left', lineMode: 'multiple', lineValue: 1.15, before: 12, after: 6, indentChars: 0 },
          h2: { font: '微软雅黑', size: 15, bold: true, color: '#1a1a1a', align: 'left', lineMode: 'multiple', lineValue: 1.15, before: 10, after: 4, indentChars: 0 },
          h3: { font: '微软雅黑', size: 12, bold: true, color: '#1a1a1a', align: 'left', lineMode: 'multiple', lineValue: 1.15, before: 8,  after: 4, indentChars: 0 }
        },
        paragraph: { enabled: true, lineMode: 'multiple', lineValue: 1.15, before: 0, after: 6, indentChars: 0,
                     align: 'justify', skipHeadingIndent: true, skipShortLineIndent: true, shortLineMax: 20, keepListIndent: true },
        caption: { enabled: true, font: '微软雅黑', size: 9, bold: false, color: '#595959', lineMode: 'multiple', lineValue: 1.15,
                   align: 'center', indentChars: 0, prefix: '', suffix: '', detectPattern: true, afterImage: true },
        punctuation: { enabled: true, mode: 'smart', halfWidthToHalf: true, cleanGarbage: true, smartQuotes: true,
                       protectDecimal: true, protectUrl: true, collapseRepeats: true },
        whitespace: { enabled: true, trimEnds: true, collapseSpaces: true, removeEmpty: true, maxEmpty: 0,
                      removePageBreakInEmpty: true, fullWidthSpaceToHalf: true }
      }
    },
    {
      id: 'journal',
      name: '期刊投稿',
      desc: '学术期刊投稿常用格式：宋体五号、单倍行距、标题居中、英文 Times New Roman',
      params: {
        page: { enabled: true, top: 2.5, bottom: 2.5, left: 2.5, right: 2.5 },
        body: { enabled: true, cnFont: '宋体', latinFont: 'Times New Roman', size: 10.5, bold: false, color: '#000000' },
        digit: {
          enabled: true,
          body:    { font: 'Times New Roman', size: 10.5, bold: false, color: '#000000' },
          heading: { font: 'Times New Roman', size: 12,   bold: true,  color: '#000000' },
          caption: { font: 'Times New Roman', size: 9,    bold: false, color: '#000000' }
        },
        headings: {
          enabled: true, heuristic: true, numbering: 'chapter',
          h1: { font: '黑体', size: 14, bold: false, color: '#000000', align: 'center', lineMode: 'multiple', lineValue: 1.0, before: 8, after: 8, indentChars: 0 },
          h2: { font: '黑体', size: 12, bold: false, color: '#000000', align: 'left',   lineMode: 'multiple', lineValue: 1.0, before: 6, after: 4, indentChars: 0 },
          h3: { font: '宋体', size: 10.5, bold: true, color: '#000000', align: 'left',  lineMode: 'multiple', lineValue: 1.0, before: 4, after: 2, indentChars: 0 }
        },
        paragraph: { enabled: true, lineMode: 'multiple', lineValue: 1.0, before: 0, after: 0, indentChars: 2,
                     align: 'justify', skipHeadingIndent: true, skipShortLineIndent: true, shortLineMax: 20, keepListIndent: true },
        caption: { enabled: true, font: '宋体', size: 9, bold: false, color: '#000000', lineMode: 'multiple', lineValue: 1.0,
                   align: 'center', indentChars: 0, prefix: '', suffix: '', detectPattern: true, afterImage: true },
        punctuation: { enabled: true, mode: 'smart', halfWidthToHalf: true, cleanGarbage: true, smartQuotes: true,
                       protectDecimal: true, protectUrl: true, collapseRepeats: true },
        whitespace: { enabled: true, trimEnds: true, collapseSpaces: true, removeEmpty: true, maxEmpty: 0,
                      removePageBreakInEmpty: true, fullWidthSpaceToHalf: true }
      }
    }
  ];

  /* ---------------------------------------------------------------------------
   * 2.1 内置 3 套表格模板（一键套用，只覆盖表格相关参数）
   * ------------------------------------------------------------------------ */
  var TABLE_TEMPLATES = [
    {
      id: 'threeLine',
      name: '论文三线表',
      desc: '顶线/底线较粗、表头下细线、无竖线无内横线；表头加粗居中、表体数字居中，跨页重复表头',
      params: {
        table: {
          enabled: true, headerDetect: 'firstRow', headerBold: true, headerFill: '',
          borderEnabled: true, borderStyle: 'threeLine', borderSize: 8, borderColor: '#000000',
          tableAlign: 'center', numberAlign: 'center', repeatHeader: true, fitPage: true,
          applyParagraph: true, align: 'center', lineMode: 'multiple', lineValue: 1.0
        }
      }
    },
    {
      id: 'govTable',
      name: '公文标准表',
      desc: '全框线单线、四周边框加粗、表头加粗居中并填充浅蓝底色，正文数字居中',
      params: {
        table: {
          enabled: true, headerDetect: 'firstRow', headerBold: true, headerFill: '#DCE6F1',
          borderEnabled: true, borderStyle: 'single', borderSize: 6, borderColor: '#000000',
          tableAlign: 'center', numberAlign: 'center', repeatHeader: true, fitPage: true,
          applyParagraph: true, align: 'center', lineMode: 'multiple', lineValue: 1.0, size: 12
        }
      }
    },
    {
      id: 'simpleTable',
      name: '日常简约表',
      desc: '仅上下框线 + 表头下线，无竖线；表头浅灰底加粗，表体左对齐、数字居中',
      params: {
        table: {
          enabled: true, headerDetect: 'firstRow', headerBold: true, headerFill: '#F2F2F2',
          borderEnabled: true, borderStyle: 'threeLine', borderSize: 4, borderColor: '#595959',
          tableAlign: 'left', numberAlign: 'center', repeatHeader: true, fitPage: true,
          applyParagraph: true, align: 'left', lineMode: 'multiple', lineValue: 1.15
        }
      }
    }
  ];

  /* ---------------------------------------------------------------------------
   * 3. 内置字体库（用户可删除、收藏、新增；永久保存在 localStorage）
   * ------------------------------------------------------------------------ */
  var BUILTIN_FONTS = [
    // 中文字体
    { name: '宋体',            type: 'cn' },
    { name: '仿宋',            type: 'cn' },
    { name: '仿宋_GB2312',     type: 'cn' },
    { name: '黑体',            type: 'cn' },
    { name: '楷体',            type: 'cn' },
    { name: '楷体_GB2312',     type: 'cn' },
    { name: '微软雅黑',        type: 'cn' },
    { name: '等线',            type: 'cn' },
    { name: '方正书宋',        type: 'cn' },
    { name: '华文中宋',        type: 'cn' },
    { name: '华文仿宋',        type: 'cn' },
    { name: '华文楷体',        type: 'cn' },
    { name: '幼圆',            type: 'cn' },
    { name: '隶书',            type: 'cn' },
    { name: '思源黑体',        type: 'cn' },
    { name: '思源宋体',        type: 'cn' },
    // 西文字体
    { name: 'Times New Roman', type: 'en' },
    { name: 'Arial',           type: 'en' },
    { name: 'Calibri',         type: 'en' },
    { name: 'Cambria',         type: 'en' },
    { name: 'Georgia',         type: 'en' },
    { name: 'Garamond',        type: 'en' },
    { name: 'Book Antiqua',    type: 'en' },
    { name: 'Courier New',     type: 'en' },
    { name: 'Consolas',        type: 'en' },
    { name: 'Verdana',         type: 'en' },
    { name: 'Tahoma',          type: 'en' },
    { name: 'Segoe UI',        type: 'en' }
  ];

  /* 常用字号预设（中文号数 ↔ 磅值） */
  var FONT_SIZES = [
    { label: '初号 42', value: 42 },   { label: '小初 36', value: 36 },
    { label: '一号 26', value: 26 },   { label: '小一 24', value: 24 },
    { label: '二号 22', value: 22 },   { label: '小二 18', value: 18 },
    { label: '三号 16', value: 16 },   { label: '小三 15', value: 15 },
    { label: '四号 14', value: 14 },   { label: '小四 12', value: 12 },
    { label: '五号 10.5', value: 10.5 }, { label: '小五 9', value: 9 },
    { label: '六号 7.5', value: 7.5 }, { label: '小六 6.5', value: 6.5 },
    { label: '七号 5.5', value: 5.5 }, { label: '八号 5', value: 5 }
  ];

  /* 对齐方式 */
  var ALIGN_OPTIONS = [
    { label: '左对齐',   value: 'left' },
    { label: '居中',     value: 'center' },
    { label: '右对齐',   value: 'right' },
    { label: '两端对齐', value: 'justify' }
  ];

  /* 行距模式 */
  var LINE_MODES = [
    { label: '多倍行距', value: 'multiple' },
    { label: '固定值(磅)', value: 'fixed' },
    { label: '最小值(磅)', value: 'atLeast' }
  ];

  /* 标点整改模式 */
  var PUNCT_MODES = [
    { label: '智能（中文用中文标点 / 英文用英文标点）', value: 'smart' },
    { label: '统一全角（中文标点）',                   value: 'full' },
    { label: '统一半角（英文标点）',                   value: 'half' },
    { label: '仅清理乱码与异常符号',                   value: 'clean' }
  ];

  /* ---------------------------------------------------------------------------
   * 4. 标点映射表
   * ------------------------------------------------------------------------ */
  /* 半角 -> 全角（仅用于中文语境的常见标点） */
  var HALF_TO_FULL = {
    ',': '，', '.': '。', ';': '；', ':': '：', '?': '？', '!': '！',
    '(': '（', ')': '）', '<': '《', '>': '》'
  };
  /* 全角 -> 半角（仅用于英文语境的标点归一） */
  var FULL_TO_HALF = {
    '，': ',', '。': '.', '；': ';', '：': ':', '？': '?', '！': '!',
    '（': '(', '）': ')', '、': ',', '《': '<', '》': '>',
    '“': '"', '”': '"', '‘': "'", '’': "'", '～': '~'
  };
  /* 需要清理的乱码 / 不可见字符 */
  var GARBAGE_CHARS = [
    '\uFFFD',       // 替换符（乱码标志）
    '\u0000', '\u0001', '\u0002', '\u0003', '\u0004', '\u0005',
    '\u0006', '\u0007', '\u0008', '\u000B', '\u000E', '\u000F',
    '\u0010', '\u0011', '\u0012', '\u0013', '\u0014', '\u0015',
    '\u0016', '\u0017', '\u0018', '\u0019', '\u001A', '\u001B',
    '\u001C', '\u001D', '\u001E', '\u001F',
    '\u200B',       // 零宽空格
    '\u200C', '\u200D', '\u2060',
    '\uFEFF',       // BOM
    '\u00AD',       // 软连字符
    '\uE000'        // 常见私用区乱码
  ];
  /* 数学 / 单位 / 特殊符号（用于保护公式片段不被改字体） */
  var MATH_UNIT_CHARS = '°±×÷≤≥≈≠≡√∞∑∏∫∮πμΩωΔαβγθλσφ℃℉Å‰′″²³¹⁰⁴⁵·⋅∙→←↑↓↔∈∉⊂⊃∪∩∴∵∝⊥∥∠⊙△∇∂';

  /* ---------------------------------------------------------------------------
   * 5. 导出
   * ------------------------------------------------------------------------ */
  global.DFT = {
    VERSION: VERSION,
    DEFAULT_PARAMS: DEFAULT_PARAMS,
    TEMPLATES: TEMPLATES,
    TABLE_TEMPLATES: TABLE_TEMPLATES,
    BUILTIN_FONTS: BUILTIN_FONTS,
    FONT_SIZES: FONT_SIZES,
    ALIGN_OPTIONS: ALIGN_OPTIONS,
    LINE_MODES: LINE_MODES,
    PUNCT_MODES: PUNCT_MODES,
    HALF_TO_FULL: HALF_TO_FULL,
    FULL_TO_HALF: FULL_TO_HALF,
    GARBAGE_CHARS: GARBAGE_CHARS,
    MATH_UNIT_CHARS: MATH_UNIT_CHARS
  };
})(typeof window !== 'undefined' ? window : this);
