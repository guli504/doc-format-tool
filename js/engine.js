/* =============================================================================
 * 文档格式批量整改工具 —— 核心整改引擎 (engine.js)
 * 说明：
 *   Engine.process(doc, params) 直接改写 docx 包内的 XML 部件（而不是转换格式），
 *   因此图片、公式(OMML)、批注、域代码、表格、超链接等对象全部原样保留。
 *   处理流程：清理空行 → 清理空格 → 标点整改 → 中/数字/西文分离字体 → 段落排版
 *             → 标题层级 → 图片题注 → 页边距。
 *   Engine.analyze(doc, params) 只读扫描，生成“排版问题清单”。
 * 依赖：constants.js、ooxml.js
 * ========================================================================== */
(function (global) {
  'use strict';

  var O = global.Ooxml;
  var W = O.NS.w;
  var M = O.NS.m;
  var XML_NS = 'http://www.w3.org/XML/1998/namespace';

  /* ============================ 通用小工具 ============================ */
  function twipsPt(pt) { return Math.round(pt * 20); }
  function twipsCm(cm) { return Math.round(cm * 567); }
  function halfPt(pt) { return Math.round(pt * 2); }
  function hexColor(c) { return String(c || '#000000').replace('#', '').toUpperCase(); }

  function setXmlSpace(t) {
    var s = t.textContent || '';
    if (/^\s|\s$/.test(s)) t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
    else t.removeAttributeNS(XML_NS, 'space');
  }

  /* 判断字符类别 */
  function charClass(ch) {
    if (/[0-9]/.test(ch)) return 'digit';
    if (/[\u2E80-\u9FFF\uF900-\uFAFF\u3400-\u4DBF]/.test(ch)) return 'cjk';
    if (/[\u3000-\u303F\uFF00-\uFFEF]/.test(ch)) return 'cjk';      // 中文标点 / 全角
    if (/[A-Za-z\u00C0-\u024F]/.test(ch)) return 'latin';
    if (/[\s\u00A0]/.test(ch)) return 'space';
    return 'other';
  }

  function isCjkChar(ch) {
    return !!ch && /[\u2E80-\u9FFF\uF900-\uFAFF\u3400-\u4DBF\u3000-\u303F\uFF00-\uFFEF]/.test(ch);
  }
  function isDigitChar(ch) { return !!ch && /[0-9０-９]/.test(ch); }
  function isLatinChar(ch) { return !!ch && /[A-Za-z\u00C0-\u024F]/.test(ch); }

  /** 段落语言判定：拉丁字符数 > 中日韩字符数 → 视为英文段落 */
  function isEnglishParagraph(text) {
    var en = 0, cn = 0;
    for (var i = 0; i < text.length; i++) {
      if (isCjkChar(text[i])) cn++;
      else if (isLatinChar(text[i])) en++;
    }
    if (cn === 0 && en > 0) return true;
    return en > cn * 1.5;
  }

  /* ============================ 范围判定 ============================ */
  function nodeInScope(p, scope) {
    var node = p.parentNode;
    while (node && node.nodeType === 1) {
      var ln = O.localName(node), ns = node.namespaceURI;
      if (ns === W) {
        if (ln === 'tbl' && !scope.tables) return false;
        if (ln === 'txbxContent' && !scope.textboxes) return false;
        if ((ln === 'footnote' || ln === 'endnote') && !scope.footnotes) return false;
        if (ln === 'comment' && !scope.comments) return false;
      }
      node = node.parentNode;
    }
    return true;
  }

  /* 收集段落内（不含公式/文本框/图形/修订删除）的文本节点；skip 中的 run 整体跳过（如角标） */
  function collectTextNodes(root, skip) {
    var out = [];
    (function walk(node) {
      for (var i = 0; i < node.childNodes.length; i++) {
        var n = node.childNodes[i];
        if (n.nodeType !== 1) continue;
        var ln = O.localName(n), ns = n.namespaceURI;
        if (ns === M) continue;
        if (ns === W && ln === 'r' && skip && skip.has(n)) continue;
        if (ln === 'del' || ln === 'moveFrom' || ln === 'delText' || ln === 'instrText' || ln === 'delInstrText') continue;
        if (ln === 'drawing' || ln === 'pict' || ln === 'object' || ln === 'txbxContent' || ln === 'ruby') continue;
        if (ns === W && ln === 't') { out.push(n); continue; }
        walk(n);
      }
    })(root);
    return out;
  }

  /* 收集段落内的 run（w:r） */
  function collectRuns(root) {
    var out = [];
    (function walk(node) {
      for (var i = 0; i < node.childNodes.length; i++) {
        var n = node.childNodes[i];
        if (n.nodeType !== 1) continue;
        var ln = O.localName(n), ns = n.namespaceURI;
        if (ns === M) continue;
        if (ln === 'del' || ln === 'moveFrom' || ln === 'drawing' || ln === 'pict' ||
            ln === 'object' || ln === 'txbxContent') continue;
        if (ns === W && (ln === 'r')) { out.push(n); continue; }
        walk(n);
      }
    })(root);
    return out;
  }

  function runHasField(run) {
    return !!(run.getElementsByTagNameNS(W, 'instrText').length ||
              run.getElementsByTagNameNS(W, 'fldChar').length ||
              run.getElementsByTagNameNS(W, 'delText').length);
  }

  /* ============================ 标题识别 ============================ */
  var OUTLINE_WORDS = ['摘要', 'abstract', '关键词', 'keywords', '引言', '绪论', '前言', '结语',
    '结论', '参考文献', '致谢', '目录', '附录', '绪言', '研究背景', '本文章节安排'];

  function detectHeadingLevel(p, text, styleLevel, params) {
    if (styleLevel >= 1) return Math.min(styleLevel, 9);
    if (!params.headings.heuristic) return 0;
    var t = String(text || '').trim();
    if (!t || t.length > 60) return 0;
    if (O.paraHasDrawing(p)) return 0;
    if (p.getElementsByTagNameNS(W, 'tbl').length) return 0;
    // 以句末标点结尾的整句 → 正文
    if (/[。！？；]$/.test(t)) return 0;

    var numbering = params.headings.numbering || 'auto';

    /* 1) 第X章 / 第X节 / 第X部分 —— 无歧义，一级标题 */
    if (/^第\s*[一二三四五六七八九十百零〇\d]+\s*[章节篇部]/.test(t)) return 1;
    /* 2) 一、 二、 —— 一级标题（公文格式） */
    if (/^[一二三四五六七八九十百]+\s*[、.．]/.test(t)) return 1;
    /* 3) （一） —— 二级标题（公文格式） */
    if (/^[（(]\s*[一二三四五六七八九十百]+\s*[）)]/.test(t)) return 2;
    /* 4) （1） —— 四级标题 */
    if (/^[（(]\s*\d+\s*[）)]/.test(t)) return 4;
    /* 5) 多级数字编号 1.1 / 1.1.1 —— 层级 = 段数
          注意：纯小数（2.85、3.14）不能被当成编号，否则会被误套标题格式 */
    var CONT_AFTER_NUM = /^(是|为|个|元|年|月|日|人|万|亿|倍|的|和|与|及|等|以上|以下|左右|米|克|吨|公斤|公里|分|秒|小时|岁|度|次|家|名|项|款|条|%|％|℃)/;
    var m5 = t.match(/^([0-9]{1,2}(?:[.．][0-9]{1,2}){1,4})(.*)$/);
    if (m5) {
      var rest5 = m5[2].replace(/^[\s\u3000]+/, '');
      // 编号后面必须有正文，且正文不能以数字或常见量词/句首词开头（那些是小数或数据行）
      if (rest5 && !/^[0-9]/.test(rest5) && !CONT_AFTER_NUM.test(rest5)) {
        return Math.min(m5[1].split(/[.．]/).length, 4);
      }
    }
    /* 6) 单级数字编号：1. / 1、 —— 点号后面必须不是数字（排除 2.85 这类小数） */
    var m6 = t.match(/^([0-9]{1,2})\s*([、.．])\s*(\S.*)$/);
    if (m6 && (m6[2] === '、' || !/^[0-9]/.test(m6[3]))) {
      if (numbering === 'chinese') return 3;
      if (numbering === 'chapter') return 1;
      return m6[2] === '、' ? 3 : 1;   // auto：顿号偏公文(三级)，句点偏章节(一级)
    }
    /* 7) 无编号的独立短句：完全匹配常见章节名 */
    var plain = t.replace(/^[\s\u3000]+|[\s\u3000]+$/g, '').toLowerCase();
    for (var i = 0; i < OUTLINE_WORDS.length; i++) {
      if (plain === OUTLINE_WORDS[i]) return 1;
    }
    return 0;
  }

  /* ============================ 题注识别 ============================ */
  var CAPTION_RE = /^\s*(图|圖|表|Fig\.?|Figure|Tab\.?|Table|Chart|附图|附表)\s*[0-9０-９一二三四五六七八九十百\-–—.]*/i;

  function isCaptionText(text, params) {
    if (!params.caption.enabled) return false;
    var t = String(text || '').trim();
    if (!t) return false;
    if (params.caption.detectPattern && CAPTION_RE.test(t)) return true;
    return false;
  }

  /* ============================ 表格上下文判定 ============================ */
  /**
   * 判断段落是否位于表格中，以及是否属于表头行。
   * 表头行 = 表格的第一行，或该行设置了“重复标题行”(w:tblHeader)。
   */
  function tableContext(p) {
    var node = p.parentNode, tbl = null, tr = null, tc = null;
    while (node && node.nodeType === 1) {
      if (node.namespaceURI === W) {
        var ln = O.localName(node);
        if (!tc && ln === 'tc') tc = node;
        if (!tr && ln === 'tr') tr = node;
        if (ln === 'tbl') { tbl = node; break; }
        if (ln === 'body' || ln === 'txbxContent' || ln === 'footnote' || ln === 'endnote') break;
      }
      node = node.parentNode;
    }
    if (!tbl) return null;
    var rows = O.children(tbl, 'tr');
    var rowIndex = -1;
    if (tr) rowIndex = rows.indexOf(tr);
    var isHeader = rowIndex === 0;
    if (tr) {
      var trPr = O.child(tr, 'trPr');
      if (trPr && O.child(trPr, 'tblHeader')) isHeader = true;
    }
    var isHeaderCol = false;
    if (tc && tr) {
      var cells = O.children(tr, 'tc');
      isHeaderCol = cells.length > 0 && cells[0] === tc;
    }
    return {
      table: tbl, row: tr, cell: tc, rows: rows,
      rowIndex: rowIndex, isHeader: isHeader, isHeaderCol: isHeaderCol
    };
  }

  /* ============================ 字符数组标点整改 ============================ */
  function tokenProtectedMask(chars) {
    // 标记 URL / 邮箱 / 文件名 / 小数点等不应转换的位置
    var mask = new Array(chars.length);
    var i = 0;
    while (i < chars.length) {
      if (/[\s\u3000]/.test(chars[i].c)) { i++; continue; }
      var j = i;
      var token = '';
      while (j < chars.length && !/[\s\u3000]/.test(chars[j].c)) { token += chars[j].c; j++; }
      var isUrl = /:\/\/|^www\.|@[^\s]+\.[a-z]{2,}|\\|\/|\.(docx?|xlsx?|pptx?|pdf|txt|png|jpe?g|gif|zip|rar|html?|exe|csv|json|xml|mp[34])\b|^[A-Za-z]:$/i.test(token);
      if (isUrl) { for (var k = i; k < j; k++) mask[k] = true; }
      i = j;
    }
    return mask;
  }

  function transformChars(chars, params, paraText) {
    var p = params.punctuation;
    var fixed = 0;
    if (!p.enabled && !params.whitespace.enabled) return 0;

    /* --- 1. 清理乱码 / 不可见字符 --- */
    if (p.enabled && p.cleanGarbage) {
      var garbage = global.DFT.GARBAGE_CHARS;
      for (var g = chars.length - 1; g >= 0; g--) {
        if (garbage.indexOf(chars[g].c) >= 0) { chars.splice(g, 1); fixed++; }
      }
    }
    /* --- 2. 全角字母数字 → 半角 --- */
    if (p.enabled && p.halfWidthToHalf) {
      for (var i = 0; i < chars.length; i++) {
        var c = chars[i].c, code = c.charCodeAt(0);
        if (code >= 0xFF01 && code <= 0xFF5E) {
          var half = String.fromCharCode(code - 0xFEE0);
          if (/[0-9A-Za-z]/.test(half)) { chars[i].c = half; fixed++; }
        }
      }
    }
    if (!p.enabled) return fixed;

    var mode = p.mode;
    if (mode === 'clean') {
      if (p.collapseRepeats) fixed += collapseRepeats(chars, isEnglishParagraph(paraText));
      return fixed;
    }

    var isEn = isEnglishParagraph(paraText);
    var target = (mode === 'full') ? 'full' : (mode === 'half') ? 'half' : (isEn ? 'half' : 'full');
    var mask = (p.protectUrl || p.protectDecimal) ? tokenProtectedMask(chars) : [];

    function at(idx) { return (idx >= 0 && idx < chars.length) ? chars[idx].c : ''; }
    function prevNonSpace(idx) { for (var k = idx - 1; k >= 0; k--) { if (!/[\s\u3000]/.test(chars[k].c)) return chars[k].c; } return ''; }
    function nextNonSpace(idx) { for (var k = idx + 1; k < chars.length; k++) { if (!/[\s\u3000]/.test(chars[k].c)) return chars[k].c; } return ''; }

    for (var n = 0; n < chars.length; n++) {
      var ch = chars[n].c;
      var prev = prevNonSpace(n), next = nextNonSpace(n);

      if (target === 'full') {
        if (ch === '.' ) {
          if (p.protectDecimal && isDigitChar(prev) && isDigitChar(next)) continue;   // 3.14
          if (isLatinChar(prev) || isLatinChar(next)) {
            // 英文缩写 / 编号中的点（如 No.1、a.b）保持
            if (!(isCjkChar(prev) && p.protectDecimal)) continue;
          }
          if (mask[n]) continue;
          chars[n].c = '。'; fixed++;
        } else if (ch === ',') {
          if (p.protectDecimal && isDigitChar(prev) && isDigitChar(next)) continue;   // 1,000
          if (mask[n]) continue;
          chars[n].c = '，'; fixed++;
        } else if (ch === ';' || ch === ':') {
          if (p.protectDecimal && isDigitChar(prev) && isDigitChar(next)) continue;   // 10:30
          if (mask[n]) continue;
          chars[n].c = (ch === ';') ? '；' : '：'; fixed++;
        } else if (ch === '?' || ch === '!') {
          if (mask[n]) continue;
          chars[n].c = (ch === '?') ? '？' : '！'; fixed++;
        } else if (ch === '(' || ch === ')') {
          if (isCjkChar(prev) || isCjkChar(next)) { chars[n].c = (ch === '(') ? '（' : '）'; fixed++; }
        } else if (ch === '"' || ch === "'") {
          if (p.smartQuotes) { /* 交给引号处理 */ }
        }
      } else { // target === 'half'
        var map = global.DFT.FULL_TO_HALF;
        if (map[ch]) {
          if (mask[n]) continue;
          // 小数点保护：中文句号在数字之间不动
          if (ch === '。' && isDigitChar(prev) && isDigitChar(next)) continue;
          chars[n].c = map[ch]; fixed++;
        }
      }
    }

    /* --- 引号成对智能修正 --- */
    if (p.smartQuotes) {
      var openDouble = true, openSingle = true;
      for (var q = 0; q < chars.length; q++) {
        var cq = chars[q].c;
        if (cq === '"') {
          var pv = prevNonSpace(q), nx = nextNonSpace(q);
          var asOpen = (!pv || /[\s\u3000（(【\[、，。；：]/.test(pv) || isCjkChar(nx) || isCjkChar(pv));
          if (isEn && target === 'half') { chars[q].c = '"'; continue; }
          chars[q].c = asOpen ? '\u201C' : '\u201D';
          openDouble = !asOpen; fixed++;
        } else if (cq === "'") {
          var pv2 = prevNonSpace(q), nx2 = nextNonSpace(q);
          if (isLatinChar(pv2) && isLatinChar(nx2)) continue; // 英文所有格
          var asOpen2 = (!pv2 || /[\s\u3000（(【\[]/.test(pv2) || isCjkChar(nx2));
          if (isEn && target === 'half') continue;
          chars[q].c = asOpen2 ? '\u2018' : '\u2019'; fixed++;
        }
      }
    }

    /* --- 中文语境中的英文引号 → 中文引号（smart 模式） --- */
    if (p.smartQuotes && target === 'full') {
      for (var z = 0; z < chars.length; z++) { /* 已在上一步处理 */ }
    }

    if (p.collapseRepeats) fixed += collapseRepeats(chars, isEn);
    return fixed;
  }

  function collapseRepeats(chars, isEn) {
    var fixed = 0;
    for (var i = chars.length - 1; i > 0; i--) {
      var cur = chars[i].c, pre = chars[i - 1].c;
      if (cur === pre && /[，。；：？！、,.;:?!]/.test(cur)) {
        chars.splice(i, 1); fixed++;
      } else if (cur === '.' && pre === '.' ) { /* 交给下一分支 */ }
    }
    var s = chars.map(function (c) { return c.c; }).join('');
    if (/[。．]{2,}/.test(s) || /\.{3,}/.test(s)) {
      // 省略号统一
      for (var j = 0; j < chars.length; j++) {
        var run = 0, k = j;
        while (k < chars.length && (chars[k].c === '.' || chars[k].c === '。' || chars[k].c === '．')) { run++; k++; }
        if (run >= 3) {
          var rep = isEn ? '...' : '……';
          chars.splice(j, run, { c: rep, n: chars[j].n, soft: true });
          fixed += run - 1;
          j = j; // 继续
        }
      }
    }
    return fixed;
  }

  /* ============================ 段落处理 ============================ */
  function paraIsEmpty(p) {
    if (O.paraHasDrawing(p)) return false;
    if (p.getElementsByTagNameNS(W, 'sectPr').length) return false;
    if (p.getElementsByTagNameNS(W, 'fldChar').length) return false;
    if (p.getElementsByTagNameNS(W, 'instrText').length) return false;
    if (p.getElementsByTagNameNS(W, 'bookmarkStart').length) return false;
    if (p.getElementsByTagNameNS(W, 'commentReference').length) return false;
    if (p.getElementsByTagNameNS(W, 'footnoteReference').length) return false;
    var t = O.paraText(p, false);
    return t.replace(/[\s\u3000]/g, '') === '';
  }

  function paraHasPageBreak(p) {
    var brs = p.getElementsByTagNameNS(W, 'br');
    for (var i = 0; i < brs.length; i++) {
      if ((O.wval(brs[i]) || brs[i].getAttribute('w:type')) === 'page') return true;
    }
    return false;
  }

  function isOnlyParagraphInCell(p) {
    var parent = p.parentNode;
    if (!parent || !O.isW(parent, 'tc')) return false;
    return O.children(parent, 'p').length <= 1;
  }

  /* ---------- 空行清理（受整改范围保护约束） ---------- */
  function cleanEmptyParagraphs(list, params, report, plan) {
    if (!params.whitespace.enabled || !params.whitespace.removeEmpty) return;
    var maxEmpty = Math.max(0, parseInt(params.whitespace.maxEmpty, 10) || 0);
    var consecutive = 0;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!p.parentNode) continue;
      if (plan && plan.skip.has(p)) { consecutive = 0; continue; }   // 保护区域不动
      var empty = paraIsEmpty(p);
      if (!empty) { consecutive = 0; continue; }
      var mustRemoveByBreak = params.whitespace.removePageBreakInEmpty && paraHasPageBreak(p);
      var hasBookmark = p.getElementsByTagNameNS(W, 'bookmarkStart').length > 0;
      if (isOnlyParagraphInCell(p)) { consecutive++; continue; }
      if (hasBookmark && !mustRemoveByBreak) { consecutive++; continue; }
      consecutive++;
      if (consecutive > maxEmpty) {
        p.parentNode.removeChild(p);
        report.emptyRemoved++;
      }
    }
  }

  /* ---------- 空格清理 ---------- */
  function cleanSpaces(p, params, report, skipRuns) {
    var ws = params.whitespace;
    if (!ws.enabled) return;
    var nodes = collectTextNodes(p, skipRuns);
    if (!nodes.length) return;
    for (var i = 0; i < nodes.length; i++) {
      var t = nodes[i];
      var s = t.textContent;
      var before = s;
      if (ws.fullWidthSpaceToHalf) s = s.replace(/\u3000/g, ' ');
      if (ws.collapseSpaces) s = s.replace(/\u00A0/g, ' ').replace(/[ ]{2,}/g, ' ');
      s = s.replace(/[\u200B\uFEFF]/g, '');
      if (i === 0 && ws.trimEnds) s = s.replace(/^[ \t]+/, '');
      if (i === nodes.length - 1 && ws.trimEnds) s = s.replace(/[ \t]+$/, '');
      if (s !== before) { t.textContent = s; report.spacesFixed++; }
      setXmlSpace(t);
    }
  }

  /* ---------- 标点整改 ---------- */
  function fixPunctuation(p, params, report, skipRuns) {
    if (!params.punctuation.enabled) return;
    var nodes = collectTextNodes(p, skipRuns);
    if (!nodes.length) return;
    var chars = [];
    for (var i = 0; i < nodes.length; i++) {
      var txt = nodes[i].textContent;
      if (!txt) continue;
      for (var j = 0; j < txt.length; j++) chars.push({ c: txt[j], n: i });
    }
    if (!chars.length) return;
    var full = chars.map(function (c) { return c.c; }).join('');
    var fixed = transformChars(chars, params, full);
    if (!fixed) return;
    // 回写
    var buckets = [];
    for (var k = 0; k < nodes.length; k++) buckets.push('');
    for (var m2 = 0; m2 < chars.length; m2++) buckets[chars[m2].n] += chars[m2].c;
    for (var n2 = 0; n2 < nodes.length; n2++) {
      if (nodes[n2].textContent !== buckets[n2]) nodes[n2].textContent = buckets[n2];
      setXmlSpace(nodes[n2]);
    }
    // 清理空 run
    report.punctFixed += fixed;
  }

  /* ---------- 运行格式（字体/字号/颜色/加粗） ---------- */
  function contextFonts(ctx, params) {
    if (ctx.kind === 'table') {
      var t = params.table || {};
      var on = !!t.enabled;
      // 表格字号：默认跟随正文，避免出现"正文小四、表格五号"的意外差异
      var tSize = (t.sizeFollow === false) ? t.size : params.body.size;
      return {
        cn: on ? t.cnFont : params.body.cnFont,
        latin: on ? t.latinFont : params.body.latinFont,
        size: on ? tSize : params.body.size,
        bold: on ? t.bold : params.body.bold,
        color: on ? t.color : params.body.color,
        digit: (params.digit && (params.digit.table || params.digit.body)) || { font: 'Times New Roman', size: 10.5, bold: false, color: '#000000' },
        digitOn: params.digit.enabled,
        table: true,
        forceBold: on && t.headerBold && ctx.header
      };    }
    if (ctx.kind === 'heading') {
      var h = params.headings['h' + Math.min(ctx.level || 1, 3)] || params.headings.h3;
      return {
        cn: h.font, latin: params.body.latinFont, size: h.size, bold: h.bold, color: h.color,
        digit: params.digit.heading, digitOn: params.digit.enabled,
        heading: true, h: h
      };
    }
    if (ctx.kind === 'caption') {
      var c = params.caption;
      return {
        cn: c.font, latin: params.body.latinFont, size: c.size, bold: c.bold, color: c.color,
        digit: params.digit.caption, digitOn: params.digit.enabled, caption: true
      };
    }
    var b = params.body;
    return {
      cn: b.cnFont, latin: b.latinFont, size: b.size, bold: b.bold, color: b.color,
      digit: params.digit.body, digitOn: params.digit.enabled
    };
  }

  function isMathUnitRun(text, params) {
    if (!params.formula.enabled || !params.formula.protectUnits) return false;
    var t = String(text || '');
    if (!t || t.length > 30) return false;
    var hasMathChar = false;
    for (var i = 0; i < t.length; i++) {
      if (global.DFT.MATH_UNIT_CHARS.indexOf(t[i]) >= 0) { hasMathChar = true; break; }
    }
    if (!hasMathChar) return false;
    return !/[\u4E00-\u9FFF]/.test(t);   // 含中文的片段不算公式
  }

  function applyClassFormat(run, cls, ctx, params) {
    var f = contextFonts(ctx, params);
    var rPr = O.ensureRPr(run);
    var size = f.size, bold = f.bold, color = f.color;
    var cnFont = f.cn, latinFont = f.latin;

    if (cls === 'digit' && f.digitOn) {
      latinFont = f.digit.font;
      // 默认只换字体；只有显式开启"独立设置字号与加粗"时才用数字自己的字号/加粗，
      // 否则字号与加粗跟随所在正文/标题/注释/表格，避免忽大忽小。
      if (f.digit.independent) {
        size = f.digit.size;
        bold = f.digit.bold;
      }
      color = f.digit.color || color;
    }
    if (f.forceBold) bold = true;   // 表格表头行强制加粗

    // 字体
    var rFonts = O.ensureChild(rPr, 'w:rFonts');
    if (cls === 'digit') {
      O.attr(rFonts, 'w:ascii', latinFont);
      O.attr(rFonts, 'w:hAnsi', latinFont);
      O.attr(rFonts, 'w:cs', latinFont);
      O.attr(rFonts, 'w:eastAsia', cnFont);
    } else if (cls === 'latin') {
      O.attr(rFonts, 'w:ascii', f.latin);
      O.attr(rFonts, 'w:hAnsi', f.latin);
      O.attr(rFonts, 'w:cs', f.latin);
      O.attr(rFonts, 'w:eastAsia', cnFont);
    } else {
      O.attr(rFonts, 'w:ascii', (f.digitOn && f.digit.font) ? f.digit.font : f.latin);
      O.attr(rFonts, 'w:hAnsi', (f.digitOn && f.digit.font) ? f.digit.font : f.latin);
      O.attr(rFonts, 'w:cs', (f.digitOn && f.digit.font) ? f.digit.font : f.latin);
      O.attr(rFonts, 'w:eastAsia', cnFont);
    }
    // 字号
    var sz = O.ensureChild(rPr, 'w:sz'); O.attr(sz, 'w:val', String(halfPt(size)));
    var szCs = O.ensureChild(rPr, 'w:szCs'); O.attr(szCs, 'w:val', String(halfPt(size)));
    // 加粗
    var b = O.ensureChild(rPr, 'w:b'); if (bold) b.removeAttributeNS(W, 'val'); else O.attr(b, 'w:val', '0');
    var bCs = O.ensureChild(rPr, 'w:bCs'); if (bold) bCs.removeAttributeNS(W, 'val'); else O.attr(bCs, 'w:val', '0');
    // 颜色
    var col = O.ensureChild(rPr, 'w:color'); O.attr(col, 'w:val', hexColor(color));
    return run;
  }

  function splitTextIntoSegments(text) {
    var segs = [];
    var cur = null;
    for (var i = 0; i < text.length; i++) {
      var cls = charClass(text[i]);
      if (cur && cur.cls === cls) cur.text += text[i];
      else { cur = { cls: cls, text: text[i] }; segs.push(cur); }
    }
    return segs;
  }

  function processRuns(p, ctx, params, report, scriptMap) {
    var runs = collectRuns(p);
    var digitSplit = params.digit.enabled;
    var baseSize = contextFonts(ctx, params).size;
    for (var i = 0; i < runs.length; i++) {
      var run = runs[i];
      if (!run.parentNode) continue;
      if (runHasField(run)) continue;
      if (run.getElementsByTagNameNS(W, 'drawing').length) continue;

      // 角标：先套用所在上下文的字体/颜色，再按角标规则统一字号与基线，
      // 绝不套用正文的字号，避免角标被改大变形、和正文混为一体。
      if (scriptMap && scriptMap.size) {
        var stype = scriptMap.get(run);
        if (stype) {
          if (params.script.mode !== 'preserve') {
            var stTxt = runPlainText(run);
            applyClassFormat(run, charClass(stTxt.replace(/\s/g, '').charAt(0) || 'cjk'), ctx, params);
            applyScriptFormat(run, stype, baseSize, params);
          }
          report.scripts++;
          continue;
        }
      }

      // 收集该 run 的文本子节点与其它内容
      var textNodes = [], hasOther = false;
      for (var c = 0; c < run.childNodes.length; c++) {
        var n = run.childNodes[c];
        if (n.nodeType !== 1) continue;
        var ln = O.localName(n);
        if (ln === 'rPr') continue;
        if (ln === 't') textNodes.push(n);
        else hasOther = true;
      }
      if (!textNodes.length) continue;

      var text = textNodes.map(function (t) { return t.textContent; }).join('');
      if (isMathUnitRun(text, params)) continue;   // 公式/单位片段保护

      var splittable = !hasOther && textNodes.length === 1 && run.parentNode;

      if (digitSplit && splittable) {
        var segs = splitTextIntoSegments(text);
        var effective = segs.filter(function (s) { return s.cls !== 'space'; });
        if (effective.length > 1 && effective.some(function (s) { return s.cls === 'digit'; })) {
          // 拆分为多个 run，实现中文/数字字体分离
          var ref = run;
          for (var s2 = 0; s2 < segs.length; s2++) {
            var newRun = O.el(run.ownerDocument, 'w:r');
            var oldRPr = O.getRPr(run);
            if (oldRPr) newRun.appendChild(oldRPr.cloneNode(true));
            var t = O.el(run.ownerDocument, 'w:t');
            t.textContent = segs[s2].text;
            if (/^\s|\s$/.test(segs[s2].text)) t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
            newRun.appendChild(t);
            applyClassFormat(newRun, segs[s2].cls, ctx, params);
            run.parentNode.insertBefore(newRun, ref);
            ref = newRun.nextSibling;
          }
          run.parentNode.removeChild(run);
          report.runsSplit++;
          continue;
        }
      }
      // 整段 run 直接应用
      var cls = charClass(text.replace(/\s/g, '').charAt(0) || text.charAt(0));
      applyClassFormat(run, cls, ctx, params);
    }
  }

  /* ---------- 段落属性（行距/间距/缩进/对齐） ---------- */
  function setSpacing(pPr, lineMode, lineValue, before, after) {
    var sp = O.ensureChild(pPr, 'w:spacing', O.PPR_ORDER);
    if (lineMode === 'multiple') {
      O.attr(sp, 'w:line', String(Math.round(lineValue * 240)));
      O.attr(sp, 'w:lineRule', 'auto');
    } else if (lineMode === 'fixed') {
      O.attr(sp, 'w:line', String(twipsPt(lineValue)));
      O.attr(sp, 'w:lineRule', 'exact');
    } else if (lineMode === 'atLeast') {
      O.attr(sp, 'w:line', String(twipsPt(lineValue)));
      O.attr(sp, 'w:lineRule', 'atLeast');
    }
    if (typeof before === 'number') {
      O.attr(sp, 'w:before', String(twipsPt(before)));
      O.attr(sp, 'w:beforeAutospacing', '0');
    }
    if (typeof after === 'number') {
      O.attr(sp, 'w:after', String(twipsPt(after)));
      O.attr(sp, 'w:afterAutospacing', '0');
    }
    sp.removeAttributeNS(W, 'beforeLines');
    sp.removeAttributeNS(W, 'afterLines');
  }

  function setIndent(pPr, chars, baseSize) {
    var ind = O.ensureChild(pPr, 'w:ind', O.PPR_ORDER);
    ind.removeAttributeNS(W, 'hanging');
    ind.removeAttributeNS(W, 'hangingChars');
    if (chars > 0) {
      O.attr(ind, 'w:firstLineChars', String(Math.round(chars * 100)));
      O.attr(ind, 'w:firstLine', String(Math.round(chars * baseSize * 20)));
    } else {
      O.attr(ind, 'w:firstLineChars', '0');
      O.attr(ind, 'w:firstLine', '0');
    }
  }

  function setAlign(pPr, align) {
    var jc = O.ensureChild(pPr, 'w:jc', O.PPR_ORDER);
    O.attr(jc, 'w:val', align === 'justify' ? 'both' : align);
  }

  function hasNumPr(p) {
    var pPr = O.getPPr(p);
    return !!(pPr && O.child(pPr, 'numPr'));
  }

  function applyParagraphProps(p, ctx, params, text) {
    var pPr = O.ensurePPr(p);
    var textLen = String(text || '').trim().length;
    var isList = hasNumPr(p);

    if (ctx.kind === 'table') {
      // 表格内段落：默认只改字体，行距/对齐需显式开启
      if (!params.table.enabled || !params.table.applyParagraph) return;
      setSpacing(pPr, params.table.lineMode, params.table.lineValue, 0, 0);
      if (params.table.align) setAlign(pPr, params.table.align);
      return;
    }
    if (ctx.kind === 'heading') {
      if (!params.headings.enabled) return;
      var h = ctx.h || params.headings.h1;
      setSpacing(pPr, h.lineMode, h.lineValue, h.before, h.after);
      setAlign(pPr, h.align);
      if (!isList) setIndent(pPr, h.indentChars || 0, h.size);
      return;
    }
    if (ctx.kind === 'caption') {
      if (!params.caption.enabled) return;
      var c = params.caption;
      setSpacing(pPr, c.lineMode, c.lineValue, 0, 0);
      setAlign(pPr, c.align);
      if (!isList) setIndent(pPr, c.indentChars || 0, c.size);
      return;
    }
    if (!params.paragraph.enabled) return;
    var pg = params.paragraph;
    setSpacing(pPr, pg.lineMode, pg.lineValue, pg.before, pg.after);
    setAlign(pPr, pg.align);
    if (isList && pg.keepListIndent) return;
    var chars = pg.indentChars;
    if (pg.skipShortLineIndent && textLen <= pg.shortLineMax) chars = 0;
    setIndent(pPr, chars, params.body.size);
  }

  /* ---------- 题注前后缀 ---------- */
  function applyCaptionAffix(p, params) {
    var c = params.caption;
    if (!c.enabled) return;
    var txt = O.paraText(p, false);
    if (c.prefix && txt.indexOf(c.prefix) !== 0) {
      var run = O.el(p.ownerDocument, 'w:r');
      var t = O.el(p.ownerDocument, 'w:t');
      t.textContent = c.prefix;
      t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
      run.appendChild(t);
      applyClassFormat(run, 'cjk', { kind: 'caption' }, params);
      // 插到第一个 run 之前
      var firstRun = O.children(p, 'r')[0];
      if (firstRun) p.insertBefore(run, firstRun); else p.appendChild(run);
    }
    if (c.suffix) {
      var cur = O.paraText(p, false);
      if (cur.slice(-c.suffix.length) !== c.suffix) {
        var run2 = O.el(p.ownerDocument, 'w:r');
        var t2 = O.el(p.ownerDocument, 'w:t');
        t2.textContent = c.suffix;
        t2.setAttributeNS(XML_NS, 'xml:space', 'preserve');
        run2.appendChild(t2);
        applyClassFormat(run2, 'cjk', { kind: 'caption' }, params);
        p.appendChild(run2);
      }
    }
  }

  /* ============================ 页边距 ============================ */
  var SECTPR_ORDER = ['w:headerReference', 'w:footerReference', 'w:footnotePr', 'w:endnotePr', 'w:type',
    'w:pgSz', 'w:pgMar', 'w:paperSrc', 'w:pgBorders', 'w:lnNumType', 'w:pgNumType', 'w:cols',
    'w:formProt', 'w:vAlign', 'w:noEndnote', 'w:titlePg', 'w:textDirection', 'w:bidi', 'w:rtlGutter',
    'w:docGrid', 'w:printerSettings', 'w:sectPrChange'];

  /* 表格相关元素的架构顺序（必须按此顺序插入，否则 Word 会忽略或报错） */
  var TBLPR_ORDER = ['w:tblStyle', 'w:tblpPr', 'w:tblOverlap', 'w:bidiVisual', 'w:tblStyleRowBandSize',
    'w:tblStyleColBandSize', 'w:tblW', 'w:jc', 'w:tblCellSpacing', 'w:tblInd', 'w:tblBorders', 'w:shd',
    'w:tblLayout', 'w:tblCellMar', 'w:tblLook', 'w:tblCaption', 'w:tblDescription'];
  var TRPR_ORDER = ['w:cnfStyle', 'w:divId', 'w:gridBefore', 'w:gridAfter', 'w:wBefore', 'w:wAfter',
    'w:cantSplit', 'w:trHeight', 'w:tblHeader', 'w:tblCellSpacing', 'w:jc', 'w:hidden'];
  var TCPR_ORDER = ['w:cnfStyle', 'w:tcW', 'w:gridSpan', 'w:hMerge', 'w:vMerge', 'w:tcBorders', 'w:shd',
    'w:noWrap', 'w:tcMar', 'w:textDirection', 'w:tcFitText', 'w:vAlign', 'w:hideMark'];
  var BORDERS_ORDER = ['w:top', 'w:start', 'w:left', 'w:bottom', 'w:end', 'w:right', 'w:insideH',
    'w:insideV', 'w:tl2br', 'w:tr2bl'];

  /** w:tblPr 必须是 w:tbl 的第一个子元素 */
  function ensureTblPr(tbl) {
    var found = O.child(tbl, 'tblPr');
    if (found) return found;
    var e = O.el(tbl.ownerDocument, 'w:tblPr');
    tbl.insertBefore(e, tbl.firstChild);
    return e;
  }
  /** w:trPr 必须是 w:tr 的第一个子元素 */
  function ensureTrPr(tr) {
    var found = O.child(tr, 'trPr');
    if (found) return found;
    var e = O.el(tr.ownerDocument, 'w:trPr');
    tr.insertBefore(e, tr.firstChild);
    return e;
  }
  /** w:tcPr 必须是 w:tc 的第一个子元素 */
  function ensureTcPr(tc) {
    var found = O.child(tc, 'tcPr');
    if (found) return found;
    var e = O.el(tc.ownerDocument, 'w:tcPr');
    tc.insertBefore(e, tc.firstChild);
    return e;
  }

  function applyPageSetup(xmlDoc, params, report, plan) {
    if (!params.page.enabled) return;
    var sects = xmlDoc.getElementsByTagNameNS(W, 'sectPr');
    for (var i = 0; i < sects.length; i++) {
      var sect = sects[i];
      // 整节被排除时，连页面设置也不动（页边距是节级属性）
      if (plan && plan.sectionsExcluded && plan.sectionsExcluded.size) {
        var owner = sect.parentNode;
        var secIdx = null;
        if (owner && owner.nodeType === 1 && O.isW(owner, 'p')) {
          var pi = plan.idxOf.get(owner);
          if (pi !== undefined) secIdx = plan.sectionOf[pi];
        } else {
          secIdx = plan.sections;
        }
        if (secIdx !== null && plan.sectionsExcluded.has(secIdx)) continue;
      }
      var pgMar = null;
      var kids = sect.childNodes;
      for (var j = 0; j < kids.length; j++) {
        if (kids[j].nodeType === 1 && O.isW(kids[j], 'pgMar')) { pgMar = kids[j]; break; }
      }
      if (!pgMar) {
        pgMar = O.el(xmlDoc, 'w:pgMar');
        var ref = null;
        for (var k = 0; k < sect.childNodes.length; k++) {
          var n = sect.childNodes[k];
          if (n.nodeType !== 1) continue;
          if (SECTPR_ORDER.indexOf('w:' + O.localName(n)) > SECTPR_ORDER.indexOf('w:pgMar')) { ref = n; break; }
        }
        if (ref) sect.insertBefore(pgMar, ref); else sect.appendChild(pgMar);
      }
      O.attr(pgMar, 'w:top', String(twipsCm(params.page.top)));
      O.attr(pgMar, 'w:bottom', String(twipsCm(params.page.bottom)));
      O.attr(pgMar, 'w:left', String(twipsCm(params.page.left)));
      O.attr(pgMar, 'w:right', String(twipsCm(params.page.right)));
      report.sections++;
    }
  }

  /* ======================= 表格专项格式化 ======================= */
  /** 计算正文可用宽度（缇），用于判断表格是否超出页宽 */
  function textWidthTwips(xmlDoc, params) {
    var sect = xmlDoc.getElementsByTagNameNS(W, 'sectPr')[0];
    var pw = 11906, ph = 16838;   // A4 默认
    if (sect) {
      var pgSz = O.child(sect, 'pgSz');
      if (pgSz) {
        var wv = parseFloat(pgSz.getAttributeNS(W, 'w') || pgSz.getAttribute('w:w'));
        var hv = parseFloat(pgSz.getAttributeNS(W, 'h') || pgSz.getAttribute('w:h'));
        if (wv) pw = wv;
        if (hv) ph = hv;
        var orient = pgSz.getAttributeNS(W, 'orient') || pgSz.getAttribute('w:orient');
        if (orient === 'landscape' && pw < ph) { var t = pw; pw = ph; ph = t; }
      }
    }
    var left = params.page.enabled ? twipsCm(params.page.left) : 1797;
    var right = params.page.enabled ? twipsCm(params.page.right) : 1797;
    return Math.max(1000, pw - left - right);
  }

  function setBorderEdge(parent, qname, val, size, color) {
    var e = O.ensureChild(parent, qname, BORDERS_ORDER);
    O.attr(e, 'w:val', val);
    O.attr(e, 'w:sz', String(Math.max(0, size)));
    O.attr(e, 'w:space', '0');
    O.attr(e, 'w:color', color);
    return e;
  }

  /** 一键统一表格边框线型 */
  function applyTableBorders(tbl, tblPr, rows, t) {
    var sz = Math.max(2, Math.min(48, parseInt(t.borderSize, 10) || 6));
    var col = hexColor(t.borderColor);
    var style = t.borderStyle || 'single';

    // 先清掉单元格自身边框，避免覆盖表格级统一设置（不动 gridSpan / vMerge）
    rows.forEach(function (tr) {
      O.children(tr, 'tc').forEach(function (tc) {
        var tcPr = O.child(tc, 'tcPr');
        if (tcPr) O.removeChildren(tcPr, 'tcBorders');
      });
    });

    var b = O.ensureChild(tblPr, 'w:tblBorders', TBLPR_ORDER);
    while (b.firstChild) b.removeChild(b.firstChild);

    var edges = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'];
    if (style === 'none') {
      edges.forEach(function (n) { setBorderEdge(b, 'w:' + n, 'none', 0, 'auto'); });
      return;
    }
    if (style === 'threeLine') {
      setBorderEdge(b, 'w:top', 'single', sz, col);
      setBorderEdge(b, 'w:bottom', 'single', sz, col);
      setBorderEdge(b, 'w:left', 'none', 0, 'auto');
      setBorderEdge(b, 'w:right', 'none', 0, 'auto');
      setBorderEdge(b, 'w:insideH', 'none', 0, 'auto');
      setBorderEdge(b, 'w:insideV', 'none', 0, 'auto');
      // 表头行下方细线（三线表的中线）
      if (rows[0] && t.headerDetect !== 'none') {
        O.children(rows[0], 'tc').forEach(function (tc) {
          var tb = O.ensureChild(ensureTcPr(tc), 'w:tcBorders', TCPR_ORDER);
          setBorderEdge(tb, 'w:bottom', 'single', Math.max(2, Math.round(sz / 2)), col);
        });
      }
      return;
    }
    var val = (style === 'double') ? 'double' : 'single';
    edges.forEach(function (n) { setBorderEdge(b, 'w:' + n, val, sz, col); });
  }

  /** 表头底色 / 表格整体底色（只改格式，不动数据）
   *  注意：底色必须先勾选"启用"才会写入，避免把空白默认值当成黑色刷满全表。 */
  function applyTableShading(rows, t) {
    var headerFill = (t.headerFillOn && t.headerFill) ? hexColor(t.headerFill) : '';
    var bodyFill = (t.bodyFillOn && t.bodyFill) ? hexColor(t.bodyFill) : '';
    if (!headerFill && !bodyFill) return;
    rows.forEach(function (tr, ri) {
      var isHeader = ri === 0 && t.headerDetect !== 'none';
      var fill = isHeader ? headerFill : bodyFill;
      if (!fill) return;
      O.children(tr, 'tc').forEach(function (tc) {
        var shd = O.ensureChild(ensureTcPr(tc), 'w:shd', TCPR_ORDER);
        O.attr(shd, 'w:val', 'clear');
        O.attr(shd, 'w:color', 'auto');
        O.attr(shd, 'w:fill', fill);
      });
    });
  }

  /** 统一行高 */
  function applyRowHeights(rows, t) {
    var rule = t.rowHeightRule || 'atLeast';
    var h = Math.round((parseFloat(t.rowHeight) || 0.8) * 567);
    rows.forEach(function (tr) {
      var trPr = ensureTrPr(tr);
      var exist = O.child(trPr, 'w:trHeight');
      if (rule === 'auto') { if (exist) trPr.removeChild(exist); return; }
      var e = O.ensureChild(trPr, 'w:trHeight', TRPR_ORDER);
      O.attr(e, 'w:val', String(h));
      O.attr(e, 'w:hRule', rule === 'exact' ? 'exact' : 'atLeast');
    });
  }

  /** 表格宽度适配页宽：**只在确实超出页宽时才动**，避免把所有表格都撑成满宽 */
  function fitTableToPage(tbl, tblPr, textWidth) {
    var grid = O.child(tbl, 'tblGrid');
    if (!grid || !textWidth) return false;
    var cols = O.children(grid, 'gridCol');
    if (!cols.length) return false;
    var widths = cols.map(function (c) {
      return parseFloat(c.getAttributeNS(W, 'w') || c.getAttribute('w:w') || 0) || 0;
    });
    var total = widths.reduce(function (a, b) { return a + b; }, 0);
    if (total <= 0 || total <= textWidth) return false;   // 没超出页宽 → 完全不动

    var scale = textWidth / total;
    cols.forEach(function (c, i) { O.attr(c, 'w:w', String(Math.round(widths[i] * scale))); });
    // 同步单元格宽度（按 gridSpan 合并计算，不改变合并结构）
    O.children(tbl, 'tr').forEach(function (tr) {
      var idx = 0;
      O.children(tr, 'tc').forEach(function (tc) {
        var tcPr = O.child(tc, 'tcPr');
        var span = 1;
        if (tcPr) {
          var gs = O.child(tcPr, 'gridSpan');
          if (gs) span = parseInt(O.wval(gs), 10) || 1;
        }
        var sum = 0;
        for (var k = 0; k < span; k++) sum += (widths[idx + k] || 0);
        idx += span;
        if (!tcPr) return;
        var tcw = O.child(tcPr, 'w:tcW');
        var type = tcw ? (tcw.getAttributeNS(W, 'type') || tcw.getAttribute('w:type') || 'dxa') : '';
        if (tcw && (type === '' || type === 'dxa')) O.attr(tcw, 'w:w', String(Math.round(sum * scale)));
      });
    });
    var w = O.ensureChild(tblPr, 'w:tblW', TBLPR_ORDER);
    O.attr(w, 'w:w', String(textWidth));
    O.attr(w, 'w:type', 'dxa');
    var layout = O.ensureChild(tblPr, 'w:tblLayout', TBLPR_ORDER);
    O.attr(layout, 'w:type', 'fixed');
    return true;
  }

  /** 数字对齐：居中 / 右对齐 / 小数点对齐（十进制制表位） */
  var NUMERIC_CELL_RE = /^[-+±]?[0-9][0-9,，.]*\s*(%|％|‰|元|万元|亿元|个|人|年|月|日|次|项|分|秒|公斤|吨|千米|米|厘米|毫米|kg|g|t|km|cm|mm|㎡|m2|m3|℃|度)?$/;

  function isNumericCellText(txt) {
    var s = String(txt || '').trim();
    if (!s || s.length > 24) return false;
    return NUMERIC_CELL_RE.test(s);
  }

  function applyDecimalTab(tc, ps) {
    var width = 0;
    var tcPr = O.child(tc, 'tcPr');
    if (tcPr) {
      var tcw = O.child(tcPr, 'w:tcW');
      if (tcw) width = parseFloat(tcw.getAttributeNS(W, 'w') || tcw.getAttribute('w:w') || 0) || 0;
    }
    var pos = Math.max(300, Math.round((width || 2000) - 113));   // 右侧留约 0.2cm
    ps.forEach(function (p) {
      var pPr = O.ensurePPr(p);
      var tabs = O.ensureChild(pPr, 'w:tabs', O.PPR_ORDER);
      while (tabs.firstChild) tabs.removeChild(tabs.firstChild);
      var tab = O.el(p.ownerDocument, 'w:tab');
      O.attr(tab, 'w:val', 'decimal');
      O.attr(tab, 'w:pos', String(pos));
      tabs.appendChild(tab);
      var firstRun = O.children(p, 'r')[0];
      if (!firstRun) return;
      if (firstRun.firstElementChild && O.localName(firstRun.firstElementChild) === 'tab') return;
      var run = O.el(p.ownerDocument, 'w:r');
      run.appendChild(O.el(p.ownerDocument, 'w:tab'));
      p.insertBefore(run, firstRun);
    });
  }

  function applyNumberAlign(tbl, t) {
    var mode = t.numberAlign;
    if (!mode || mode === 'none') return 0;
    var count = 0;
    O.children(tbl, 'tr').forEach(function (tr) {
      O.children(tr, 'tc').forEach(function (tc) {
        var ps = O.children(tc, 'p');
        if (!ps.length) return;
        var txt = ps.map(function (p) { return O.paraText(p, false); }).join('').trim();
        if (!isNumericCellText(txt)) return;
        count++;
        if (mode === 'decimal') { applyDecimalTab(tc, ps); return; }
        ps.forEach(function (p) { setAlign(O.ensurePPr(p), mode); });
      });
    });
    return count;
  }

  function applyRepeatHeader(tr) {
    if (!tr) return;
    var trPr = ensureTrPr(tr);
    var e = O.ensureChild(trPr, 'w:tblHeader', TRPR_ORDER);
    e.removeAttributeNS(W, 'val');
  }

  /** 表格专项整改主入口：只改格式，不动数据、合并单元格与行列结构 */
  function applyTableFormat(tbl, params, textWidth, report) {
    var t = params.table;
    if (!t || !t.enabled) return;
    var rows = O.children(tbl, 'tr');
    if (!rows.length) return;
    var tblPr = ensureTblPr(tbl);

    if (t.tableAlign) {
      var jc = O.ensureChild(tblPr, 'w:jc', TBLPR_ORDER);
      O.attr(jc, 'w:val', t.tableAlign);
    }
    if (t.fitPage && fitTableToPage(tbl, tblPr, textWidth)) report.tablesScaled++;
    if (t.borderEnabled) { applyTableBorders(tbl, tblPr, rows, t); report.tablesStyled++; }
    applyTableShading(rows, t);
    if (t.rowHeightEnabled) applyRowHeights(rows, t);
    if (t.repeatHeader && t.headerDetect !== 'none') applyRepeatHeader(rows[0]);
    report.cellsAligned += applyNumberAlign(tbl, t);
  }

  /* =================== 角标（上标 / 下标）智能识别 =================== */
  function runPlainText(run) {
    var out = '';
    for (var i = 0; i < run.childNodes.length; i++) {
      var n = run.childNodes[i];
      if (n.nodeType === 1 && O.localName(n) === 't') out += n.textContent;
    }
    return out;
  }

  function parseManualTokens(str) {
    if (!str) return [];
    return String(str).split(/[;\n\r]+/).map(function (s) { return s.trim(); }).filter(Boolean)
      .map(function (s) {
        if (s.length > 2 && s.charAt(0) === '/' && s.charAt(s.length - 1) === '/') {
          try { return new RegExp(s.slice(1, -1)); } catch (e) { return s; }
        }
        return s;
      });
  }

  function manualHit(txt, tokens) {
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (t instanceof RegExp) { if (t.test(txt)) return true; }
      else if (txt === t) return true;
    }
    return false;
  }

  /**
   * 识别段落内的角标 run。
   * 1) 带 w:vertAlign 的真角标（准确率 100%）；
   * 2) 手动指定的内容（精确匹配或 /正则/）；
   * 3) 智能识别"小字号未标记"的假角标（如 cm3、m2、10 3 被排成小字）。
   * @returns {Map} run → 'sup' | 'sub'
   */
  function collectScriptRuns(p, params) {
    var map = new Map();
    var s = params.script;
    if (!s || !s.enabled) return map;
    var runs = collectRuns(p);
    if (!runs.length) return map;

    var sizes = [];
    runs.forEach(function (r) {
      var rPr = O.getRPr(r); if (!rPr) return;
      var sz = O.child(rPr, 'sz');
      if (sz) { var v = parseFloat(O.wval(sz)); if (v > 0) sizes.push(v); }
    });
    sizes.sort(function (a, b) { return a - b; });
    var base = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
    var tokens = parseManualTokens(s.manual);

    runs.forEach(function (r) {
      if (r.getElementsByTagNameNS(W, 'drawing').length) return;
      if (runHasField(r)) return;
      var rPr = O.getRPr(r);
      var va = rPr ? O.child(rPr, 'vertAlign') : null;
      var v = va ? O.wval(va) : '';
      if (s.detectMarked && (v === 'superscript' || v === 'subscript')) {
        map.set(r, v === 'subscript' ? 'sub' : 'sup');
        return;
      }
      var txt = runPlainText(r);
      if (!txt) return;
      if (tokens.length && manualHit(txt.trim(), tokens)) { map.set(r, 'sup'); return; }
      if (!s.detectSmall || !base) return;
      if (txt.length > 4 || !/[0-9]/.test(txt) || /[\u4E00-\u9FFF]/.test(txt)) return;
      var sz2 = rPr ? O.child(rPr, 'sz') : null;
      var szv = sz2 ? parseFloat(O.wval(sz2)) : 0;
      if (!szv || szv >= base * 0.85) return;    // 只认"明显偏小"的
      map.set(r, 'sup');
    });
    return map;
  }

  /** 角标专属格式：统一字号比例、修正基线，不改变数字/符号内容 */
  function applyScriptFormat(run, type, baseSizePt, params) {
    var s = params.script;
    var rPr = O.ensureRPr(run);
    if (s.mode === 'normalize') {
      var va = O.ensureChild(rPr, 'w:vertAlign');
      if (!O.wval(va)) O.attr(va, 'w:val', type === 'sub' ? 'subscript' : 'superscript');
    }
    var size = null;
    if (s.sizeMode === 'follow') size = baseSizePt;
    else if (s.sizeMode === 'scale') size = baseSizePt * (parseFloat(s.scale) || 100) / 100;
    else if (s.sizeMode === 'fixed') size = parseFloat(s.size) || 9;
    if (size) {
      O.attr(O.ensureChild(rPr, 'w:sz'), 'w:val', String(halfPt(size)));
      O.attr(O.ensureChild(rPr, 'w:szCs'), 'w:val', String(halfPt(size)));
    }
    if (s.font) {
      var rf = O.ensureChild(rPr, 'w:rFonts');
      O.attr(rf, 'w:eastAsia', s.font);
      O.attr(rf, 'w:ascii', s.font);
      O.attr(rf, 'w:hAnsi', s.font);
    }
    if (s.colorOn && s.color) O.attr(O.ensureChild(rPr, 'w:color'), 'w:val', hexColor(s.color));
    if (s.bold) {
      O.ensureChild(rPr, 'w:b').removeAttributeNS(W, 'val');
      O.ensureChild(rPr, 'w:bCs').removeAttributeNS(W, 'val');
    } else if (!s.keepBold) {
      O.attr(O.ensureChild(rPr, 'w:b'), 'w:val', '0');
      O.attr(O.ensureChild(rPr, 'w:bCs'), 'w:val', '0');
    }
  }

  /* ================== 整改范围（选择性保护 / 防止误改） ================== */
  function mergeParams(base, patch) {
    var out = JSON.parse(JSON.stringify(base));
    (function merge(dst, src) {
      Object.keys(src || {}).forEach(function (k) {
        var sv = src[k];
        if (sv && typeof sv === 'object' && !Array.isArray(sv)) {
          if (!dst[k] || typeof dst[k] !== 'object') dst[k] = {};
          merge(dst[k], sv);
        } else if (sv !== undefined) dst[k] = sv;
      });
    })(out, patch || {});
    return out;
  }

  function parseNumSpec(spec, max) {
    var set = new Set();
    String(spec || '').split(/[,，;；\s]+/).forEach(function (part) {
      if (!part) return;
      var m = part.match(/^(\d+)\s*[-~—]\s*(\d+)?$/);
      if (m) {
        var a = parseInt(m[1], 10);
        var b = m[2] ? parseInt(m[2], 10) : max;
        for (var i = a; i <= b; i++) set.add(i);
        return;
      }
      var n = parseInt(part, 10);
      if (n > 0) set.add(n);
    });
    return set;
  }

  function isTocLike(p, doc) {
    var pPr = O.getPPr(p);
    if (pPr) {
      var st = O.child(pPr, 'pStyle');
      var id = st ? O.wval(st) : '';
      if (id && /^TOC[1-9]$/i.test(id)) return true;
      var rec = doc && doc.styles && doc.styles[id];
      if (rec && /^TOC|目录|目錄|contents/i.test(rec.name || '')) return true;
    }
    var flds = p.getElementsByTagNameNS(W, 'instrText');
    for (var i = 0; i < flds.length; i++) if (/TOC\b/i.test(flds[i].textContent)) return true;
    var simple = p.getElementsByTagNameNS(W, 'fldSimple');
    for (var j = 0; j < simple.length; j++) {
      var instr = simple[j].getAttributeNS(W, 'instr') || simple[j].getAttribute('w:instr') || '';
      if (/TOC\b/i.test(instr)) return true;
    }
    var txt = O.paraText(p, false);
    if (/\.{3,}\s*\d+\s*$/.test(txt)) return true;
    if (/\t\s*\d+\s*$/.test(txt) && txt.length < 120) return true;
    return false;
  }

  var REF_HEAD_RE = /^\s*(参考文献|參考文獻|references|bibliography)\s*$/i;
  var APPX_HEAD_RE = /^\s*(附录|附錄|appendix|致\s*谢|致\s*謝|acknowledg)/i;

  /**
   * 生成整改范围计划：哪些段落要被跳过、每个段落属于第几节/第几页。
   * 「页」按文档中的分页符与 Word 记录的分页位置划分（浏览器无法重新排版）。
   */
  function buildRangePlan(xmlDoc, params, doc) {
    var r = params.range || {};
    if (r.enabled === false) r = { enabled: false, mode: 'all', sectionRules: {} };
    var all = xmlDoc.getElementsByTagNameNS(W, 'p');
    var list = [], idxOf = new Map();
    for (var i = 0; i < all.length; i++) { list.push(all[i]); idxOf.set(all[i], i); }
    var n = list.length;
    var sectionOf = new Array(n), pageOf = new Array(n);
    var section = 1, page = 1;
    for (var j = 0; j < n; j++) {
      sectionOf[j] = section; pageOf[j] = page;
      var p = list[j];
      var brs = p.getElementsByTagNameNS(W, 'br');
      for (var b = 0; b < brs.length; b++) {
        var ty = O.wval(brs[b]) || brs[b].getAttribute('w:type');
        if (ty === 'page') page++;
      }
      if (p.getElementsByTagNameNS(W, 'lastRenderedPageBreak').length) page++;
      var pPr = O.getPPr(p);
      if (pPr && O.child(pPr, 'sectPr')) section++;
    }
    var plan = {
      sections: section, pages: page, sectionOf: sectionOf, pageOf: pageOf,
      skip: new Set(), reasons: {}, reasonOf: new Map(), list: list, idxOf: idxOf, _tplCache: {}
    };
    function mark(p, reason) {
      plan.skip.add(p);
      if (!plan.reasonOf.has(p)) plan.reasonOf.set(p, reason);
      plan.reasons[reason] = (plan.reasons[reason] || 0) + 1;
    }

    /* 封面页：第一页且内容不多（或含封面类关键词）→ 豁免 */
    if (r.protectCover && page > 1) {
      var first = [], txtLen = 0, coverWord = false;
      for (var k = 0; k < n; k++) {
        if (pageOf[k] !== 1) continue;
        first.push(list[k]);
        var tx = O.paraText(list[k], false);
        txtLen += tx.trim().length;
        if (/封面|题目|标题|作者|姓名|学号|专业|指导教师|指导老师|日期|单位|学院|大学|学院/.test(tx)) coverWord = true;
      }
      if (first.length <= 25 && (txtLen < 350 || coverWord)) {
        first.forEach(function (p) { mark(p, 'cover'); });
      }
    }
    /* 目录 */
    if (r.protectToc) {
      for (var m2 = 0; m2 < n; m2++) if (isTocLike(list[m2], doc)) mark(list[m2], 'toc');
    }
    /* 参考文献 / 附录：从标题到文末 */
    var cutFrom = -1;
    for (var q = 0; q < n; q++) {
      var t = O.paraText(list[q], false).trim();
      if (!t) continue;
      if ((r.protectRefs && REF_HEAD_RE.test(t)) || (r.protectAppendix && APPX_HEAD_RE.test(t))) { cutFrom = q; break; }
    }
    if (cutFrom >= 0) for (var q2 = cutFrom; q2 < n; q2++) mark(list[q2], 'tail');

    /* 指定页 / 指定分节 */
    if (r.mode === 'pages') {
      var pset = parseNumSpec(r.pages, page);
      for (var a1 = 0; a1 < n; a1++) if (!pset.has(pageOf[a1])) mark(list[a1], 'outOfPages');
    } else if (r.mode === 'sections') {
      var sset = parseNumSpec(r.sections, section);
      for (var a2 = 0; a2 < n; a2++) if (!sset.has(sectionOf[a2])) mark(list[a2], 'outOfSections');
    }
    /* 分节规则：整节不整改 */
    var rules = r.sectionRules || {};
    Object.keys(rules).forEach(function (key) {
      var rule = rules[key] || {};
      var sec = parseInt(key, 10);
      if (rule.enabled === false) {
        for (var a3 = 0; a3 < n; a3++) if (sectionOf[a3] === sec) mark(list[a3], 'sectionRule');
      }
    });
    /* 手动标记：勾选的页面 / 段落一律不整改（优先级最高，不受其他设置影响） */
    var manPages = r.manualPages || [];
    if (manPages.length) {
      var mset = new Set(manPages.map(Number));
      for (var m3 = 0; m3 < n; m3++) if (mset.has(pageOf[m3])) mark(list[m3], 'manualPage');
    }
    var manParas = r.manualParas || [];
    if (manParas.length) {
      var pset2 = new Set(manParas.map(Number));
      for (var m4 = 0; m4 < n; m4++) if (pset2.has(m4)) mark(list[m4], 'manualPara');
    }

    /* 哪些分节被整节排除（用于决定是否还改它的页边距） */
    plan.sectionsExcluded = new Set();
    var secCount = {}, secSkipped = {};
    for (var s1 = 0; s1 < n; s1++) {
      var sec1 = sectionOf[s1];
      secCount[sec1] = (secCount[sec1] || 0) + 1;
      if (plan.skip.has(list[s1])) secSkipped[sec1] = (secSkipped[sec1] || 0) + 1;
    }
    Object.keys(secCount).forEach(function (k) {
      if ((secSkipped[k] || 0) === secCount[k]) plan.sectionsExcluded.add(parseInt(k, 10));
    });

    /* 分节套用不同模板 */
    plan.paramsFor = function (index) {
      var sec = sectionOf[index];
      var rule = rules[sec];
      if (rule && rule.templateId) {
        if (!plan._tplCache[sec]) {
          var tpls = (global.DFT && global.DFT.TEMPLATES) || [];
          var tpl = tpls.filter(function (t2) { return t2.id === rule.templateId; })[0];
          if (!tpl && global.Store && global.Store.loadUserTemplates) {
            tpl = global.Store.loadUserTemplates().filter(function (t2) { return t2.id === rule.templateId; })[0];
          }
          plan._tplCache[sec] = tpl ? mergeParams(params, tpl.params) : params;
        }
        return plan._tplCache[sec];
      }
      return params;
    };
    return plan;
  }

  /**
   * 列出文档中的"页"（按分页符 / Word 记录的分页位置划分），并给出每页摘要，
   * 供界面做"手动勾选哪些页不整改"。
   * @returns {Array} [{ page, count, chars, summary, blank }]
   */
  function pageSummary(xmlDoc) {
    var all = xmlDoc.getElementsByTagNameNS(W, 'p');
    var pages = [], cur = [], page = 1;
    var buckets = [{ page: 1, paras: [] }];
    for (var i = 0; i < all.length; i++) {
      var p = all[i];
      buckets[buckets.length - 1].paras.push(p);
      var brk = 0;
      var brs = p.getElementsByTagNameNS(W, 'br');
      for (var b = 0; b < brs.length; b++) {
        var ty = O.wval(brs[b]) || brs[b].getAttribute('w:type');
        if (ty === 'page') brk++;
      }
      if (p.getElementsByTagNameNS(W, 'lastRenderedPageBreak').length) brk++;
      for (var k = 0; k < brk; k++) {
        page++;
        buckets.push({ page: page, paras: [] });
      }
    }
    return buckets.map(function (bk) {
      var txt = bk.paras.map(function (p) { return O.paraText(p, false).replace(/\s+/g, ' ').trim(); })
        .filter(Boolean).join(' ');
      return {
        page: bk.page,
        count: bk.paras.length,
        chars: txt.length,
        blank: txt.length === 0,
        summary: txt.slice(0, 70)
      };
    });
  }

  /* ============================ 主处理流程 ============================ */
  /**
   * 处理一个部件（document.xml / header*.xml / comments.xml ...）
   * @param {XMLDocument} xmlDoc
   * @param {Object} params
   * @param {Object} opts { partKind, report }
   */
  function transformPart(xmlDoc, params, opts) {
    var report = opts.report;
    var partKind = opts.partKind || 'document';
    var scope = params.scope || {};

    // 页眉页脚/批注：只做字体、标点、空格（不改版式）
    var layout = (partKind === 'document');

    // 0. 整改范围计划（选择性保护：封面 / 目录 / 参考文献 / 指定页 / 指定分节）
    var plan = buildRangePlan(xmlDoc, params, opts.doc);
    report.sectionsCount = Math.max(report.sectionsCount || 0, plan.sections);
    report.pagesCount = Math.max(report.pagesCount || 0, plan.pages);
    Object.keys(plan.reasons).forEach(function (k) {
      report.skipReasons[k] = (report.skipReasons[k] || 0) + plan.reasons[k];
    });

    // 1. 段落快照
    var all = xmlDoc.getElementsByTagNameNS(W, 'p');
    var list = [];
    for (var i = 0; i < all.length; i++) {
      var p = all[i];
      if (!nodeInScope(p, scope)) continue;
      // 页眉页脚总开关
      if (partKind === 'header' && !scope.headers) continue;
      if (partKind === 'footer' && !scope.footers) continue;
      if ((partKind === 'comments') && !scope.comments) continue;
      if ((partKind === 'notes') && !scope.footnotes) continue;
      list.push(p);
    }

    // 2. 清理空行（含空白页）—— 保护区域内的空行不动
    cleanEmptyParagraphs(list, params, report, plan);

    // 3. 逐段处理
    var prevHadDrawing = false;
    for (var idx = 0; idx < list.length; idx++) {
      var para = list[idx];
      if (!para.parentNode) continue;

      // 3.0 范围保护：被排除的区域完全不改动（字体、标点、空格、版式全不动）
      if (plan.skip.has(para)) {
        report.skippedParas++;
        prevHadDrawing = O.paraHasDrawing(para);
        continue;
      }
      var pidx = plan.idxOf.get(para);
      var ep = (pidx === undefined) ? params : plan.paramsFor(pidx);   // 分节可套用不同模板

      var text = O.paraText(para, false);
      var trimmed = text.trim();
      if (!trimmed) { prevHadDrawing = O.paraHasDrawing(para); continue; }

      var styleEl = null, pPr0 = O.getPPr(para);
      if (pPr0) styleEl = O.child(pPr0, 'pStyle');
      var styleId = styleEl ? O.wval(styleEl) : null;
      var styleLevel = O.headingLevelFromStyle(styleId, opts.styleMap);

      // 分类（表格内段落可独立设置字体）
      var level = (layout && ep.headings.enabled) ? detectHeadingLevel(para, trimmed, styleLevel, ep) : styleLevel;
      var tinfo = tableContext(para);
      var ctx;
      var isCaption = false;
      if (tinfo && ep.table && ep.table.enabled) {
        var hd = ep.table.headerDetect || 'firstRow';
        var isHdr = hd !== 'none' && (tinfo.isHeader || (hd === 'firstRowCol' && tinfo.isHeaderCol));
        ctx = { kind: 'table', header: isHdr, headerRow: tinfo.isHeader, headerCol: tinfo.isHeaderCol };
        report.tableParas++;
      } else if (level >= 1) {
        ctx = { kind: 'heading', level: level, h: ep.headings['h' + Math.min(level, 3)] || ep.headings.h3 };
        report.headings++;
      } else if (isCaptionText(trimmed, ep) ||
                 (ep.caption.enabled && ep.caption.afterImage && prevHadDrawing &&
                  trimmed.length <= 150 && !/[。；;]$/.test(trimmed))) {
        isCaption = true;
        ctx = { kind: 'caption' };
        report.captions++;
      } else {
        ctx = { kind: 'body' };
        report.bodyParas++;
      }

      // 3.1 角标智能识别（先识别，后续所有文本处理都跳过它们，保证角标不变形）
      var scriptMap = collectScriptRuns(para, ep);

      // 3.2 空格清理
      cleanSpaces(para, ep, report, scriptMap);
      // 3.3 标点整改
      fixPunctuation(para, ep, report, scriptMap);
      // 3.4 字体/字号/颜色（中文-数字-西文分离）
      var applyFont = (ctx.kind === 'heading') ? ep.headings.enabled
                    : (ctx.kind === 'caption') ? ep.caption.enabled
                    : (ctx.kind === 'table') ? ep.table.enabled
                    : ep.body.enabled;
      if (applyFont) processRuns(para, ctx, ep, report, scriptMap);
      else if (scriptMap.size && ep.script.enabled && ep.script.mode !== 'preserve') {
        // 即使不整改正文字体，角标也要按角标规则统一
        var bs = contextFonts(ctx, ep).size;
        scriptMap.forEach(function (type, run) {
          applyScriptFormat(run, type, bs, ep);
          report.scripts++;
        });
      }
      // 3.5 题注前后缀
      if (isCaption) applyCaptionAffix(para, ep);
      // 3.6 段落版式
      if (layout) applyParagraphProps(para, ctx, ep, trimmed);

      prevHadDrawing = O.paraHasDrawing(para);
    }

    // 4. 表格专项格式化（边框 / 三线表 / 底色 / 行高 / 适配页宽 / 重复表头 / 数字对齐）
    if (layout && params.table.enabled) {
      var tw = textWidthTwips(xmlDoc, params);
      var tbls = xmlDoc.getElementsByTagNameNS(W, 'tbl');
      for (var t2 = 0; t2 < tbls.length; t2++) {
        var tb = tbls[t2];
        var fp = tb.getElementsByTagNameNS(W, 'p')[0];
        if (fp && plan.skip.has(fp)) continue;      // 保护区域内的表格保持原样
        var pidx2 = fp ? plan.idxOf.get(fp) : undefined;
        applyTableFormat(tb, (pidx2 === undefined) ? params : plan.paramsFor(pidx2), tw, report);
      }
    }

    // 5. 页边距（仅正文部件；整节被排除时不动）
    if (layout) applyPageSetup(xmlDoc, params, report, plan);
  }

  /**
   * 完整整改：返回新的 docx Blob
   * @param {Object} doc 文档模型
   * @param {Object} params
   * @param {Function} onProgress (pct, message)
   * @returns {Promise<{blob:Blob, report:Object, xml:string}>}
   */
  async function process(doc, params, onProgress) {
    function tick(p, msg) { if (onProgress) onProgress(p, msg); }
    var report = { headings: 0, captions: 0, bodyParas: 0, tableParas: 0, punctFixed: 0, spacesFixed: 0,
                   emptyRemoved: 0, runsSplit: 0, sections: 0, parts: [],
                   scripts: 0, skippedParas: 0, tablesStyled: 0, tablesScaled: 0, cellsAligned: 0,
                   sectionsCount: 0, pagesCount: 0, skipReasons: {} };

    // 每次都从原始 zip 重新解析 main XML —— 保证可反复调整参数而不会叠加
    tick(5, '读取文档结构');
    var mainText = await doc.zip.file(doc.mainPath).async('string');
    var xmlDoc = O.parseXml(mainText);

    tick(20, '清理空行与空格');
    transformPart(xmlDoc, params, { partKind: 'document', report: report, styleMap: doc.styles, doc: doc });
    var mainXml = O.serialize(xmlDoc);
    var replacements = {};
    replacements[doc.mainPath] = mainXml;
    report.parts.push(doc.mainPath);

    // 附加部件（页眉/页脚/批注/脚注）
    var extra = doc.extraParts || [];
    for (var i = 0; i < extra.length; i++) {
      var part = extra[i];
      var need = false;
      if (part.kind === 'header') need = params.scope.headers;
      else if (part.kind === 'footer') need = params.scope.footers;
      else if (part.kind === 'comments') need = params.scope.comments;
      else need = params.scope.footnotes;
      if (!need) continue;
      tick(20 + Math.round(60 * (i + 1) / (extra.length + 1)), '处理 ' + part.path);
      try {
        var txt = await doc.zip.file(part.path).async('string');
        var pd = O.parseXml(txt);
        transformPart(pd, params, { partKind: part.kind, report: report, styleMap: doc.styles, doc: doc });
        replacements[part.path] = O.serialize(pd);
        report.parts.push(part.path);
      } catch (e) {
        console.warn('[engine] 部件处理失败', part.path, e);
        doc.warnings.push('部件处理失败：' + part.path);
      }
    }

    tick(85, '重新打包 .docx');
    var blob = await O.save(doc, replacements);
    tick(100, '完成');
    report.chars = (doc.stats && doc.stats.characters) || 0;
    return { blob: blob, report: report, xml: mainXml };
  }

  /* ============================ 问题检测 ============================ */
  function samplePush(arr, s, max) {
    s = String(s || '').trim();
    if (!s) return;
    if (arr.indexOf(s) >= 0) return;
    if (arr.length < (max || 5)) arr.push(s.length > 40 ? s.slice(0, 40) + '…' : s);
  }

  /**
   * 只读扫描，生成排版问题清单
   * @returns {{findings:Array, stats:Object}}
   */
  function analyze(doc, params) {
    var xmlDoc = doc.xml;
    var scope = params.scope || {};
    var all = xmlDoc.getElementsByTagNameNS(W, 'p');
    var list = [];
    for (var i = 0; i < all.length; i++) {
      if (nodeInScope(all[i], scope)) list.push(all[i]);
    }

    var stats = {
      paragraphs: list.length, headings: 0, headingNoStyle: 0, images: 0, captions: 0,
      captionMissing: 0, emptyParas: 0, maxEmptyRun: 0, spaceIssues: 0,
      punctHalfInCn: 0, punctFullInEn: 0, garbage: 0, repeatedPunct: 0,
      fonts: {}, sizes: {}, lines: {}, indents: {}, aligns: {}, margins: null, chars: 0,
      tables: 0, tableParas: 0, tableFonts: {}
    };
    stats.tables = scope.tables === false ? 0 : xmlDoc.getElementsByTagNameNS(W, 'tbl').length;
    var samples = { halfInCn: [], fullInEn: [], sizeMix: [], fontMix: [] };
    var prevHadDrawing = false;
    var emptyRun = 0;
    var bodyIndents = {};

    for (var j = 0; j < list.length; j++) {
      var p = list[j];
      var text = O.paraText(p, false);
      var trimmed = text.trim();
      var hasDrawing = O.paraHasDrawing(p);
      if (hasDrawing) stats.images++;
      var tinfo = tableContext(p);
      if (tinfo) stats.tableParas++;
      if (!trimmed) {
        stats.emptyParas++;
        emptyRun++;
        if (emptyRun > stats.maxEmptyRun) stats.maxEmptyRun = emptyRun;
        prevHadDrawing = hasDrawing;
        continue;
      }
      emptyRun = 0;
      stats.chars += trimmed.length;

      // 标题
      var pPr = O.getPPr(p);
      var styleId = null;
      if (pPr) { var st = O.child(pPr, 'pStyle'); if (st) styleId = O.wval(st); }
      var styleLevel = O.headingLevelFromStyle(styleId, doc.styles);
      var lv = detectHeadingLevel(p, trimmed, styleLevel, params);
      if (lv >= 1) {
        stats.headings++;
        if (!styleLevel) { stats.headingNoStyle++; samplePush(samples.fontMix, '未用标题样式：' + trimmed, 5); }
      }

      // 题注
      if (hasDrawing && !isCaptionText(trimmed, params)) {
        // 图片所在段与下一段都不像题注时，认为缺题注
        stats.captionMissing++;
      }
      if (isCaptionText(trimmed, params) || (params.caption.afterImage && prevHadDrawing && trimmed.length <= 150)) {
        stats.captions++;
      }

      // 空格问题
      if (/^\s|\s$/.test(text) || /[ ]{2,}/.test(text) || /\u3000/.test(text)) stats.spaceIssues++;

      // 标点问题
      var cn = 0, en = 0;
      for (var c = 0; c < text.length; c++) {
        if (isCjkChar(text[c])) cn++;
        else if (isLatinChar(text[c])) en++;
        if (global.DFT.GARBAGE_CHARS.indexOf(text[c]) >= 0) stats.garbage++;
      }
      if (cn >= en) {
        var mHalf = text.match(/[a-zA-Z\u4e00-\u9fff][,;:?!]/g);
        if (mHalf && mHalf.length) { stats.punctHalfInCn += mHalf.length; samplePush(samples.halfInCn, trimmed, 5); }
      } else {
        var mFull = text.match(/[\u4e00-\u9fff][，。；：？！]/g);
        if (mFull && mFull.length) { stats.punctFullInEn += mFull.length; samplePush(samples.fullInEn, trimmed, 5); }
      }
      if (/[，。；：？！]{2,}|\.{3,}/.test(text)) stats.repeatedPunct++;

      // 字体 / 字号 / 行距 / 缩进 / 对齐
      var runs = collectRuns(p);
      for (var r = 0; r < runs.length; r++) {
        var rPr = O.getRPr(runs[r]);
        if (!rPr) continue;
        var rf = O.child(rPr, 'rFonts');
        if (rf) {
          var fname = rf.getAttributeNS(W, 'eastAsia') || rf.getAttribute('w:eastAsia') ||
                      rf.getAttributeNS(W, 'ascii') || rf.getAttribute('w:ascii');
          if (fname) stats.fonts[fname] = (stats.fonts[fname] || 0) + 1;
        }
        var sz = O.child(rPr, 'sz');
        if (sz) { var v = O.wval(sz); stats.sizes[v] = (stats.sizes[v] || 0) + 1; }
      }
      var spacing = pPr ? O.child(pPr, 'spacing') : null;
      if (spacing) {
        var rule = spacing.getAttributeNS(W, 'lineRule') || 'auto';
        var line = spacing.getAttributeNS(W, 'line') || '';
        var key = rule + ':' + line;
        if (line) stats.lines[key] = (stats.lines[key] || 0) + 1;
      }
      var ind = pPr ? O.child(pPr, 'ind') : null;
      if (lv === 0) {
        var fl = ind ? (ind.getAttributeNS(W, 'firstLineChars') || ind.getAttributeNS(W, 'firstLine') || '0') : '0';
        bodyIndents[fl] = (bodyIndents[fl] || 0) + 1;
      }
      if (pPr) {
        var jc = O.child(pPr, 'jc');
        var jv = jc ? O.wval(jc) : 'default';
        stats.aligns[jv] = (stats.aligns[jv] || 0) + 1;
      }
      prevHadDrawing = hasDrawing;
    }

    // 页边距
    var sect = xmlDoc.getElementsByTagNameNS(W, 'sectPr')[0];
    if (sect) {
      var mar = O.child(sect, 'pgMar');
      if (mar) {
        stats.margins = {
          top: +(parseInt(mar.getAttributeNS(W, 'top'), 10) / 567).toFixed(2),
          bottom: +(parseInt(mar.getAttributeNS(W, 'bottom'), 10) / 567).toFixed(2),
          left: +(parseInt(mar.getAttributeNS(W, 'left'), 10) / 567).toFixed(2),
          right: +(parseInt(mar.getAttributeNS(W, 'right'), 10) / 567).toFixed(2)
        };
      }
    }

    stats.fontList = Object.keys(stats.fonts);
    stats.sizeList = Object.keys(stats.sizes);
    stats.lineList = Object.keys(stats.lines);
    stats.indentList = bodyIndents;
    stats.indentVariety = Object.keys(bodyIndents).length;

    /* ---------------- 生成问题清单 ---------------- */
    var findings = [];
    function add(o) { findings.push(o); }

    if (stats.punctHalfInCn > 0) {
      add({ id: 'punct_half_cn', category: '标点符号', level: 'high',
        title: '中文语境中混用半角标点', count: stats.punctHalfInCn,
        detail: '中文句子中出现了英文半角逗号、句号、冒号等，正式文档应统一为中文标点。',
        samples: samples.halfInCn, fix: { 'punctuation.enabled': true, 'punctuation.mode': 'smart' } });
    }
    if (stats.punctFullInEn > 0) {
      add({ id: 'punct_full_en', category: '标点符号', level: 'medium',
        title: '英文段落中出现中文全角标点', count: stats.punctFullInEn,
        detail: '英文句子使用全角标点会影响排版与检索，建议统一为半角。',
        samples: samples.fullInEn, fix: { 'punctuation.enabled': true, 'punctuation.mode': 'smart' } });
    }
    if (stats.repeatedPunct > 0) {
      add({ id: 'punct_repeat', category: '标点符号', level: 'low',
        title: '存在重复标点（如 ！！！、。。。）', count: stats.repeatedPunct,
        detail: '连续重复的标点不符合正式文档规范，建议合并。',
        samples: [], fix: { 'punctuation.enabled': true, 'punctuation.collapseRepeats': true } });
    }
    if (stats.garbage > 0) {
      add({ id: 'garbage', category: '标点符号', level: 'high',
        title: '发现乱码 / 不可见字符', count: stats.garbage,
        detail: '文档中存在替换符、零宽字符等异常符号，可能来自复制粘贴或编码错误。',
        samples: [], fix: { 'punctuation.enabled': true, 'punctuation.cleanGarbage': true } });
    }
    if (stats.fontList.length > 3) {
      add({ id: 'font_mix', category: '字体', level: 'high',
        title: '字体种类过多（' + stats.fontList.length + ' 种）', count: stats.fontList.length,
        detail: '字体：' + stats.fontList.slice(0, 8).join('、') + (stats.fontList.length > 8 ? ' 等' : ''),
        samples: stats.fontList.slice(0, 8), fix: { 'body.enabled': true, 'headings.enabled': true, 'caption.enabled': true } });
    }
    if (stats.sizeList.length > 4) {
      add({ id: 'size_mix', category: '字体', level: 'medium',
        title: '字号种类过多（' + stats.sizeList.length + ' 种）', count: stats.sizeList.length,
        detail: '正文与标题字号不统一，全文观感杂乱。',
        samples: [], fix: { 'body.enabled': true, 'headings.enabled': true, 'caption.enabled': true } });
    }
    if (stats.lineList.length > 2) {
      add({ id: 'line_mix', category: '段落', level: 'medium',
        title: '行距设置不统一（' + stats.lineList.length + ' 种）', count: stats.lineList.length,
        detail: '全文行距不一致会造成版面参差，建议统一行距。',
        samples: [], fix: { 'paragraph.enabled': true } });
    }
    if (stats.indentVariety > 2) {
      add({ id: 'indent_mix', category: '段落', level: 'medium',
        title: '首行缩进不统一（' + stats.indentVariety + ' 种）', count: stats.indentVariety,
        detail: '部分段落缩进 2 字符、部分无缩进或使用空格缩进。',
        samples: [], fix: { 'paragraph.enabled': true, 'paragraph.indentChars': 2 } });
    }
    if (stats.spaceIssues > 0) {
      add({ id: 'spaces', category: '空格', level: 'low',
        title: '存在多余空格 / 全角空格', count: stats.spaceIssues,
        detail: '段落首尾空格、连续空格或全角空格会造成对不齐。',
        samples: [], fix: { 'whitespace.enabled': true, 'whitespace.trimEnds': true, 'whitespace.collapseSpaces': true } });
    }
    if (stats.emptyParas > 0) {
      add({ id: 'empty', category: '空格', level: stats.maxEmptyRun >= 2 ? 'medium' : 'low',
        title: '存在空行 / 空白段落', count: stats.emptyParas,
        detail: '最多连续 ' + stats.maxEmptyRun + ' 个空段落；多余空行会打乱分页。',
        samples: [], fix: { 'whitespace.enabled': true, 'whitespace.removeEmpty': true, 'whitespace.maxEmpty': 0 } });
    }
    if (stats.headingNoStyle > 0) {
      add({ id: 'heading_style', category: '标题', level: 'high',
        title: '标题未使用样式（' + stats.headingNoStyle + ' 处）', count: stats.headingNoStyle,
        detail: '这些类似标题的段落是手工排版，无法生成目录，建议按标题层级标准化。',
        samples: samples.fontMix, fix: { 'headings.enabled': true, 'headings.heuristic': true } });
    }
    if (stats.captionMissing > 0) {
      add({ id: 'caption_missing', category: '图片注释', level: 'medium',
        title: '图片缺少规范题注', count: stats.captionMissing,
        detail: '部分图片所在的段落没有“图 1”之类的题注文字，或题注未与图片相邻。',
        samples: [], fix: { 'caption.enabled': true, 'caption.detectPattern': true, 'caption.afterImage': true } });
    } else if (stats.images > 0 && stats.captions > 0) {
      add({ id: 'caption_style', category: '图片注释', level: 'low',
        title: '图片题注可统一格式', count: stats.captions,
        detail: '共发现 ' + stats.captions + ' 条题注，建议统一字体、字号、居中与行距。',
        samples: [], fix: { 'caption.enabled': true } });
    }
    if (stats.margins) {
      var m = stats.margins;
      var delta = Math.abs(m.top - 2.54) + Math.abs(m.bottom - 2.54) + Math.abs(m.left - 3.17) + Math.abs(m.right - 3.17);
      if (delta > 0.6) {
        add({ id: 'margin', category: '页面', level: 'medium',
          title: '页边距不符合常规标准', count: 1,
          detail: '当前：上 ' + m.top + ' / 下 ' + m.bottom + ' / 左 ' + m.left + ' / 右 ' + m.right + ' 厘米。',
          samples: [], fix: { 'page.enabled': true, 'page.top': 2.54, 'page.bottom': 2.54, 'page.left': 3.17, 'page.right': 3.17 } });
      }
    }
    if (stats.tables > 0 && !params.table.enabled) {
      add({ id: 'table_font', category: '表格', level: 'low',
        title: '表格文字可单独统一格式', count: stats.tables,
        detail: '检测到 ' + stats.tables + ' 个表格（约 ' + stats.tableParas + ' 个单元格段落）。目前表格文字跟随正文设置；'
              + '你也可以为表格单独指定中英文字体、字号、颜色与表头加粗。',
        samples: [], fix: { 'table.enabled': true, 'scope.tables': true } });
    }
    if (stats.tables > 0 && params.table.enabled) {
      add({ id: 'table_font_on', category: '表格', level: 'info',
        title: '表格文字将按表格专属格式整改', count: stats.tableParas,
        detail: '中文 ' + params.table.cnFont + ' / 西文 ' + params.table.latinFont + ' / ' + params.table.size + ' 磅'
              + (params.table.headerBold ? ' · 表头行加粗' : '')
              + (params.table.applyParagraph ? ' · 同时统一行距与对齐' : ''),
        samples: [], fix: null });
    }
    if (stats.chars < 30 && stats.images > 0) {
      add({ id: 'image_only', category: '总览', level: 'high',
        title: '文档内容是图片（扫描件 / 截图），没有可编辑文字', count: stats.images,
        detail: '这份文档的文字是"画"在图片里的，不是真正的文字，任何排版工具都无法修改其中的文字内容。'
              + '请先用 OCR 把它转成可编辑文字（Word：「图片转文字」；WPS：「PDF/图片转文字」；'
              + '微信/QQ：长按图片「提取文字」；或 ABBYY 等工具），转出来的 Word 再拿来整改排版。',
        samples: [], fix: null });
    }
    if (!findings.length) {
      add({ id: 'ok', category: '总览', level: 'info', title: '未发现明显的排版问题', count: 0,
        detail: '文档排版已较为规范，仍可套用模板进行统一微调。', samples: [], fix: null });
    }

    return { findings: findings, stats: stats };
  }

  global.Engine = {
    process: process,
    analyze: analyze,
    transformPart: transformPart,
    _internals: {
      detectHeadingLevel: detectHeadingLevel, isCaptionText: isCaptionText,
      isEnglishParagraph: isEnglishParagraph, charClass: charClass,
      transformChars: transformChars, paraIsEmpty: paraIsEmpty,
      tableContext: tableContext, collectScriptRuns: collectScriptRuns,
      buildRangePlan: buildRangePlan, parseNumSpec: parseNumSpec, isTocLike: isTocLike,
      isNumericCellText: isNumericCellText, textWidthTwips: textWidthTwips,
      pageSummary: pageSummary
    }
  };
})(typeof window !== 'undefined' ? window : this);
