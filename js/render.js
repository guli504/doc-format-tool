/* =============================================================================
 * 文档格式批量整改工具 —— 预览渲染器 (render.js)
 * 说明：把 WordprocessingML 直接渲染为 HTML+CSS，忠实还原字体、字号、颜色、
 *       行距、缩进、对齐、页边距、表格、图片、公式占位等，从而让“整改后预览”
 *       与导出的 .docx 完全一致（不使用任何转换库，无信息损失）。
 * 依赖：ooxml.js
 * ========================================================================== */
(function (global) {
  'use strict';

  var O = global.Ooxml;
  var W = O.NS.w, M = O.NS.m, A = O.NS.a, WP = O.NS.wp, V = O.NS.v, R = O.NS.r;

  /* ------------------------------ 基础工具 ------------------------------ */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function emu2px(emu) { return Math.round((parseFloat(emu) || 0) / 9525); }
  function tw2pt(tw) { return (parseFloat(tw) || 0) / 20; }
  function isNum(v) { return v !== null && v !== undefined && v !== '' && !isNaN(parseFloat(v)); }

  /* 常见中文字体的英文名回退，保证浏览器能命中 */
  var FONT_FALLBACK = {
    '宋体': 'SimSun', '新宋体': 'NSimSun', '黑体': 'SimHei', '楷体': 'KaiTi', '楷体_GB2312': 'KaiTi_GB2312',
    '仿宋': 'FangSong', '仿宋_GB2312': 'FangSong_GB2312', '微软雅黑': 'Microsoft YaHei',
    '等线': 'DengXian', '华文中宋': 'STZhongsong', '华文仿宋': 'STFangsong', '华文楷体': 'STKaiti',
    '幼圆': 'YouYuan', '隶书': 'LiSu', '方正书宋': 'FZShuSong', '思源黑体': 'Source Han Sans SC',
    '思源宋体': 'Source Han Serif SC'
  };

  function cssFont(name, fallbackGeneric) {
    if (!name) return fallbackGeneric || 'serif';
    var out = ['"' + String(name).replace(/"/g, '') + '"'];
    var fb = FONT_FALLBACK[name];
    if (fb && fb !== name) out.push('"' + fb + '"');
    out.push(fallbackGeneric || 'serif');
    return out.join(',');
  }

  /* ============================ 样式表解析 ============================ */
  function readRunProps(rPr) {
    var p = {};
    if (!rPr) return p;
    var rf = O.child(rPr, 'rFonts');
    if (rf) {
      p.ascii = rf.getAttributeNS(W, 'ascii') || rf.getAttribute('w:ascii') || undefined;
      p.eastAsia = rf.getAttributeNS(W, 'eastAsia') || rf.getAttribute('w:eastAsia') || undefined;
      p.hAnsi = rf.getAttributeNS(W, 'hAnsi') || rf.getAttribute('w:hAnsi') || undefined;
    }
    function flag(name) {
      var e = O.child(rPr, name);
      if (!e) return undefined;
      var v = O.wval(e);
      return !(v === '0' || v === 'false');
    }
    if (O.child(rPr, 'b') !== null) p.bold = flag('b');
    if (O.child(rPr, 'i') !== null) p.italic = flag('i');
    if (O.child(rPr, 'strike') !== null) p.strike = flag('strike');
    var u = O.child(rPr, 'u');
    if (u) p.underline = O.wval(u) !== 'none';
    var sz = O.child(rPr, 'sz');
    if (sz && isNum(O.wval(sz))) p.size = parseInt(O.wval(sz), 10) / 2;
    var col = O.child(rPr, 'color');
    if (col) {
      var cv = (O.wval(col) || '').replace('#', '');
      if (cv && cv.toLowerCase() !== 'auto') p.color = '#' + cv;
    }
    var hl = O.child(rPr, 'highlight');
    if (hl) p.highlight = O.wval(hl);
    var va = O.child(rPr, 'vertAlign');
    if (va) p.vertAlign = O.wval(va);
    var sp = O.child(rPr, 'spacing');
    if (sp && isNum(O.wval(sp))) p.letterSpacing = parseInt(O.wval(sp), 10) / 20;
    var caps = O.child(rPr, 'caps');
    if (caps) p.caps = true;
    return p;
  }

  function readParaProps(pPr) {
    var p = {};
    if (!pPr) return p;
    var jc = O.child(pPr, 'jc');
    if (jc) p.align = O.wval(jc);
    var ind = O.child(pPr, 'ind');
    if (ind) {
      p.indent = {};
      ['firstLineChars', 'firstLine', 'hangingChars', 'hanging', 'left', 'start', 'right', 'end', 'leftChars', 'rightChars']
        .forEach(function (k) {
          var v = ind.getAttributeNS(W, k) || ind.getAttribute('w:' + k);
          if (v !== null && v !== undefined && v !== '') p.indent[k] = parseFloat(v);
        });
    }
    var sp = O.child(pPr, 'spacing');
    if (sp) {
      p.spacing = {
        before: parseFloat(sp.getAttributeNS(W, 'before') || sp.getAttribute('w:before') || 'NaN'),
        after: parseFloat(sp.getAttributeNS(W, 'after') || sp.getAttribute('w:after') || 'NaN'),
        line: parseFloat(sp.getAttributeNS(W, 'line') || sp.getAttribute('w:line') || 'NaN'),
        lineRule: sp.getAttributeNS(W, 'lineRule') || sp.getAttribute('w:lineRule') || 'auto'
      };
    }
    var numPr = O.child(pPr, 'numPr');
    if (numPr) {
      var ilvl = O.child(numPr, 'ilvl'), numId = O.child(numPr, 'numId');
      p.numPr = { ilvl: ilvl ? parseInt(O.wval(ilvl), 10) || 0 : 0, numId: numId ? O.wval(numId) : null };
    }
    var shd = O.child(pPr, 'shd');
    if (shd && (shd.getAttributeNS(W, 'fill') || shd.getAttribute('w:fill'))) {
      p.fill = shd.getAttributeNS(W, 'fill') || shd.getAttribute('w:fill');
    }
    return p;
  }

  /** 解析 styles.xml（含 basedOn 继承链） */
  function buildStyleMap(xmlText) {
    var map = { defaults: { rPr: {}, pPr: {} } };
    if (!xmlText) return map;
    var doc;
    try { doc = O.parseXml(xmlText); } catch (e) { return map; }
    var dd = doc.getElementsByTagNameNS(W, 'docDefaults')[0];
    if (dd) {
      var rd = dd.getElementsByTagNameNS(W, 'rPrDefault')[0];
      if (rd) map.defaults.rPr = readRunProps(O.child(rd, 'rPr'));
      var pd = dd.getElementsByTagNameNS(W, 'pPrDefault')[0];
      if (pd) map.defaults.pPr = readParaProps(O.child(pd, 'pPr'));
    }
    var list = doc.getElementsByTagNameNS(W, 'style');
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      var id = s.getAttributeNS(W, 'styleId') || s.getAttribute('w:styleId');
      if (!id) continue;
      var nameEl = O.child(s, 'name');
      var basedOn = O.child(s, 'basedOn');
      map[id] = {
        id: id,
        name: nameEl ? O.wval(nameEl) : '',
        basedOn: basedOn ? O.wval(basedOn) : null,
        type: s.getAttributeNS(W, 'type') || s.getAttribute('w:type') || 'paragraph',
        rPr: readRunProps(O.child(s, 'rPr')),
        pPr: readParaProps(O.child(s, 'pPr'))
      };
    }
    return map;
  }

  function resolveStyle(map, styleId, depth) {
    var out = { rPr: {}, pPr: {} };
    if (!styleId || !map[styleId] || (depth || 0) > 10) return out;
    var rec = map[styleId];
    if (rec.basedOn && map[rec.basedOn]) {
      var base = resolveStyle(map, rec.basedOn, (depth || 0) + 1);
      out.rPr = Object.assign({}, base.rPr);
      out.pPr = Object.assign({}, base.pPr);
    }
    out.rPr = Object.assign(out.rPr, rec.rPr);
    out.pPr = Object.assign(out.pPr, rec.pPr);
    return out;
  }

  /* ============================ 列表编号 ============================ */
  function makeListCounter(doc, styleMap) {
    var counters = {};
    return function (p, ctx) {
      var numPr = p.numPr;
      if (!numPr || !numPr.numId) return '';
      var absId = doc.numbering && doc.numbering.numMap ? doc.numbering.numMap[numPr.numId] : null;
      var levels = (absId && doc.numbering.absMap[absId]) || {};
      var lvl = levels[numPr.ilvl] || {};
      var fmt = lvl.numFmt || 'decimal';
      if (fmt === 'bullet' || fmt === 'none') return '';
      var id = numPr.numId;
      counters[id] = counters[id] || {};
      counters[id][numPr.ilvl] = (counters[id][numPr.ilvl] || 0) + 1;
      Object.keys(counters[id]).forEach(function (k) { if (parseInt(k, 10) > numPr.ilvl) delete counters[id][k]; });
      var tpl = lvl.lvlText || ('%' + (numPr.ilvl + 1) + '.');
      return tpl.replace(/%(\d)/g, function (m, d) {
        var idx = parseInt(d, 10) - 1;
        return String(counters[id][idx] || lvl.start || 1);
      });
    };
  }

  /* ============================ 行内渲染 ============================ */
  function runCss(props) {
    var css = [];
    var font = props.eastAsia || props.ascii || props.hAnsi;
    css.push('font-family:' + cssFont(font, 'serif'));
    if (props.size) css.push('font-size:' + props.size + 'pt');
    if (props.bold) css.push('font-weight:700');
    if (props.italic) css.push('font-style:italic');
    if (props.underline) css.push('text-decoration:underline');
    if (props.strike) css.push('text-decoration:line-through');
    if (props.color) css.push('color:' + props.color);
    if (props.highlight && props.highlight !== 'none') css.push('background-color:' + props.highlight);
    if (props.letterSpacing) css.push('letter-spacing:' + props.letterSpacing + 'pt');
    if (props.vertAlign === 'superscript') css.push('vertical-align:super;font-size:0.7em');
    if (props.vertAlign === 'subscript') css.push('vertical-align:sub;font-size:0.7em');
    if (props.caps) css.push('text-transform:uppercase');
    return css.join(';');
  }

  function drawingToHtml(node, doc) {
    // a:blip r:embed / v:imagedata r:id
    var rid = null, w = 0, h = 0;
    var blips = node.getElementsByTagNameNS(A, 'blip');
    if (blips.length) rid = blips[0].getAttributeNS(R, 'embed') || blips[0].getAttribute('r:embed');
    if (!rid) {
      var imgs = node.getElementsByTagNameNS(V, 'imagedata');
      if (imgs.length) rid = imgs[0].getAttributeNS(R, 'id') || imgs[0].getAttribute('r:id');
    }
    var ext = node.getElementsByTagNameNS(WP, 'extent');
    if (ext.length) {
      w = emu2px(ext[0].getAttribute('cx'));
      h = emu2px(ext[0].getAttribute('cy'));
    }
    if (!w || !h) {
      var shp = node.getElementsByTagNameNS(V, 'shape');
      if (shp.length) {
        var st = shp[0].getAttribute('style') || '';
        var mw = /width:([\d.]+)pt/.exec(st), mh = /height:([\d.]+)pt/.exec(st);
        if (mw) w = Math.round(parseFloat(mw[1]) * 96 / 72);
        if (mh) h = Math.round(parseFloat(mh[1]) * 96 / 72);
      }
    }
    var src = (rid && doc.images && doc.images[rid]) ? doc.images[rid] : null;
    var style = (w ? 'width:' + w + 'px;' : '') + (h ? 'height:' + h + 'px;' : 'max-width:100%;');
    if (!src) {
      return '<span class="dft-pic" style="' + (w ? 'width:' + w + 'px;height:' + (h || 40) + 'px' : 'width:120px;height:40px') +
        '">图片</span>';
    }
    return '<img class="dft-img" src="' + src + '" style="' + style + '" alt="[图片]"/>';
  }

  function mathToHtml(node) {
    var txt = '';
    (function walk(n) {
      for (var i = 0; i < n.childNodes.length; i++) {
        var c = n.childNodes[i];
        if (c.nodeType !== 1) continue;
        var ln = O.localName(c);
        if (ln === 't') txt += c.textContent;
        else if (ln === 'f') { /* 分式 */ walk(c); }
        else if (ln === 'r') walk(c);
        else walk(c);
      }
    })(node);
    if (!txt) txt = '公式';
    return '<span class="dft-math" title="公式已保护，不参与排版整改">' + esc(txt) + '</span>';
  }

  function runToHtml(run, baseProps, doc) {
    var props = Object.assign({}, baseProps, readRunProps(O.getRPr(run)));
    var css = runCss(props);
    var inner = '', plain = '';
    function flush() {
      if (!plain) return;
      inner += esc(plain);
      plain = '';
    }
    for (var i = 0; i < run.childNodes.length; i++) {
      var c = run.childNodes[i];
      if (c.nodeType !== 1) continue;
      var ln = O.localName(c), ns = c.namespaceURI;
      if (ns === M) { flush(); inner += mathToHtml(c); continue; }
      if (ns !== W && ns !== V && ns !== WP && ns !== A) continue;
      if (ln === 'rPr' || ln === 'fldChar' || ln === 'instrText' || ln === 'delText' || ln === 'lastRenderedPageBreak') continue;
      if (ln === 't') { plain += c.textContent; }
      else if (ln === 'tab') { flush(); inner += '<span class="dft-tab"></span>'; }
      else if (ln === 'br') {
        flush();
        var type = O.wval(c) || c.getAttribute('w:type');
        inner += (type === 'page') ? '<span class="dft-pbreak"></span>' : '<br/>';
      }
      else if (ln === 'cr') { flush(); inner += '<br/>'; }
      else if (ln === 'noBreakHyphen') { plain += '-'; }
      else if (ln === 'softHyphen') { /* 忽略 */ }
      else if (ln === 'sym') {
        var ch = c.getAttributeNS(W, 'char') || c.getAttribute('w:char') || '';
        if (ch) plain += String.fromCharCode(parseInt(ch, 16));
      }
      else if (ln === 'drawing' || ln === 'pict' || ln === 'object') { flush(); inner += drawingToHtml(c, doc); }
      else if (ln === 'footnoteReference' || ln === 'endnoteReference') {
        var id = c.getAttributeNS(W, 'id') || c.getAttribute('w:id') || '';
        plain += '[' + id + ']';
      }
      else if (ln === 'commentReference') { flush(); inner += '<span class="dft-comment" title="批注">◆</span>'; }
      else if (ln === 'tbl' || ln === 'p' || ln === 'txbxContent') { /* 由外层处理 */ walkInline(c); }
      else walkInline(c);
    }
    function walkInline(n) {
      for (var k = 0; k < n.childNodes.length; k++) {
        var cc = n.childNodes[k];
        if (cc.nodeType !== 1) continue;
        var l2 = O.localName(cc), ns2 = cc.namespaceURI;
        if (ns2 === W && l2 === 't') plain += cc.textContent;
        else if (ns2 === M) { flush(); inner += mathToHtml(cc); }
        else if (l2 === 'drawing' || l2 === 'pict') { flush(); inner += drawingToHtml(cc, doc); }
        else walkInline(cc);
      }
    }
    flush();
    if (!inner) return '';
    var preserve = /^\s|\s{2,}| $/.test(inner) ? 'white-space:pre-wrap;' : '';
    return '<span style="' + css + ';' + preserve + '">' + inner + '</span>';
  }

  /* ============================ 段落渲染 ============================ */
  function indentCss(ind, baseSizePt) {
    if (!ind) return '';
    var css = [];
    var left = ind.left != null ? ind.left : (ind.start != null ? ind.start : null);
    var right = ind.right != null ? ind.right : (ind.end != null ? ind.end : null);
    if (left) css.push('margin-left:' + tw2pt(left) + 'pt');
    if (right) css.push('margin-right:' + tw2pt(right) + 'pt');
    if (ind.firstLineChars != null) {
      if (ind.firstLineChars > 0) css.push('text-indent:' + (ind.firstLineChars / 100) + 'em');
      else if (ind.firstLine != null && ind.firstLine > 0) css.push('text-indent:' + tw2pt(ind.firstLine) + 'pt');
    } else if (ind.firstLine != null) {
      if (ind.firstLine > 0) css.push('text-indent:' + tw2pt(ind.firstLine) + 'pt');
      else if (ind.firstLine < 0) css.push('text-indent:0');
    }
    if (ind.hangingChars != null && ind.hangingChars > 0) css.push('text-indent:-' + (ind.hangingChars / 100) + 'em');
    else if (ind.hanging != null && ind.hanging > 0) css.push('text-indent:-' + tw2pt(ind.hanging) + 'pt');
    return css.join(';');
  }

  function spacingCss(sp) {
    if (!sp) return '';
    var css = [];
    if (isNum(sp.before)) css.push('margin-top:' + tw2pt(sp.before) + 'pt');
    if (isNum(sp.after)) css.push('margin-bottom:' + tw2pt(sp.after) + 'pt');
    if (isNum(sp.line)) {
      if (sp.lineRule === 'exact' || sp.lineRule === 'atLeast') css.push('line-height:' + tw2pt(sp.line) + 'pt');
      else css.push('line-height:' + (sp.line / 240).toFixed(3));
    }
    return css.join(';');
  }

  function paraCss(props) {
    var css = [];
    var align = props.align;
    if (align === 'both') css.push('text-align:justify');
    else if (align && align !== 'default') css.push('text-align:' + align);
    var indCss = indentCss(props.indent, props.size || 12);
    var spCss = spacingCss(props.spacing);
    if (indCss) css.push(indCss);
    if (spCss) css.push(spCss);
    if (props.fill && props.fill !== 'auto' && props.fill !== 'FFFFFF') css.push('background-color:#' + props.fill);
    return css.join(';');
  }

  function paraToHtml(p, ctx) {
    var map = ctx.styleMap, doc = ctx.doc;
    var pPr = O.getPPr(p);
    var styleId = null;
    if (pPr) { var st = O.child(pPr, 'pStyle'); if (st) styleId = O.wval(st); }
    var resolved = resolveStyle(map, styleId, 0);
    var paraProps = Object.assign({}, map.defaults.pPr, resolved.pPr, readParaProps(pPr));
    var baseRun = Object.assign({}, map.defaults.rPr, resolved.rPr);

    // 编号前缀
    var numPrefix = '';
    if (paraProps.numPr) {
      var label = ctx.listCounter(p, ctx);
      if (label) numPrefix = '<span style="' + runCss(baseRun) + '">' + esc(label) + ' </span>';
      else numPrefix = '<span class="dft-bullet" style="' + runCss(baseRun) + '">• </span>';
    }

    var inner = '';
    for (var i = 0; i < p.childNodes.length; i++) {
      var c = p.childNodes[i];
      if (c.nodeType !== 1) continue;
      var ln = O.localName(c), ns = c.namespaceURI;
      if (ns === W && ln === 'r') inner += runToHtml(c, baseRun, doc);
      else if (ns === W && ln === 'hyperlink') {
        for (var k = 0; k < c.childNodes.length; k++) {
          var cc = c.childNodes[k];
          if (cc.nodeType === 1 && O.localName(cc) === 'r') inner += runToHtml(cc, baseRun, doc);
        }
      }
      else if (ns === W && (ln === 'ins' || ln === 'smartTag' || ln === 'sdt' || ln === 'sdtContent' || ln === 'bdo' || ln === 'dir' || ln === 'moveTo')) {
        inner += appendNested(c);
      }
      else if (ns === W && (ln === 'fldSimple')) {
        for (var f = 0; f < c.childNodes.length; f++) {
          var fc = c.childNodes[f];
          if (fc.nodeType === 1 && O.localName(fc) === 'r') inner += runToHtml(fc, baseRun, doc);
        }
      }
      else if (ns === M) inner += mathToHtml(c);
      else if (ns === W && ln === 'bookmarkStart') inner += '<a id="bm' + (c.getAttributeNS(W, 'id') || '') + '"></a>';
    }
    function appendNested(node) {
      var acc = '';
      for (var i2 = 0; i2 < node.childNodes.length; i2++) {
        var c2 = node.childNodes[i2];
        if (c2.nodeType !== 1) continue;
        var l2 = O.localName(c2), ns2 = c2.namespaceURI;
        if (ns2 === W && l2 === 'r') acc += runToHtml(c2, baseRun, doc);
        else if (ns2 === W && l2 === 'hyperlink') {
          for (var k2 = 0; k2 < c2.childNodes.length; k2++) {
            var c3 = c2.childNodes[k2];
            if (c3.nodeType === 1 && O.localName(c3) === 'r') acc += runToHtml(c3, baseRun, doc);
          }
        }
        else if (l2 === 'p' && ns2 === W) { acc += paraToHtml(c2, ctx); }
        else if (ns2 === W && l2 === 'txbxContent') {
          for (var t2 = 0; t2 < c2.childNodes.length; t2++) {
            if (O.localName(c2.childNodes[t2]) === 'p') acc += paraToHtml(c2.childNodes[t2], ctx);
          }
        }
        else if (ns2 === W && (l2 === 'ins' || l2 === 'smartTag' || l2 === 'sdt' || l2 === 'sdtContent' || l2 === 'bdo' || l2 === 'dir')) {
          acc += appendNested(c2);
        }
      }
      return acc;
    }

    var tag = 'p';
    var isHeading = /^Heading[1-9]$|^heading [1-9]$/i.test(styleId || '') || /^(标题|標題)\s*[1-9]$/.test(resolved.name || '');
    var extraClass = isHeading ? ' class="dft-h"' : '';
    var cssStr = paraCss(paraProps);
    if (!inner) inner = '';
    return '<' + tag + extraClass + ' style="' + cssStr + '">' + numPrefix + inner + '</' + tag + '>';
  }

  /* ============================ 表格渲染 ============================ */
  function tableToHtml(tbl, ctx) {
    var tblPr = O.child(tbl, 'tblPr');
    var css = ['border-collapse:collapse', 'width:100%', 'table-layout:fixed'];
    var jc = tblPr ? O.child(tblPr, 'jc') : null;
    if (jc) {
      var a = O.wval(jc);
      if (a === 'center') css.push('margin-left:auto;margin-right:auto');
      else if (a === 'right') css.push('margin-left:auto');
    }
    var tblW = tblPr ? O.child(tblPr, 'tblW') : null;
    if (tblW && (O.wval(tblW) === 'auto')) css.push('width:auto');

    var grid = O.child(tbl, 'tblGrid');
    var cols = grid ? O.children(grid, 'gridCol') : [];
    var colWidths = cols.map(function (c) {
      var wv = c.getAttributeNS(W, 'w') || c.getAttribute('w:w');
      return tw2pt(wv);
    });
    var totalW = colWidths.reduce(function (a2, b) { return a2 + b; }, 0) || 1;

    var html = '<table style="' + css.join(';') + '">';
    if (colWidths.length) {
      html += '<colgroup>';
      colWidths.forEach(function (wv) { html += '<col style="width:' + (wv / totalW * 100).toFixed(2) + '%"/>'; });
      html += '</colgroup>';
    }
    var rows = O.children(tbl, 'tr');
    rows.forEach(function (tr) {
      html += '<tr>';
      O.children(tr, 'tc').forEach(function (tc) {
        var tcPr = O.child(tc, 'tcPr');
        var span = 1, vMerge = null, tcss = [];
        if (tcPr) {
          var gs = O.child(tcPr, 'gridSpan');
          if (gs) span = parseInt(O.wval(gs), 10) || 1;
          var vm = O.child(tcPr, 'vMerge');
          if (vm) vMerge = O.wval(vm) || 'continue';
          var shd = O.child(tcPr, 'shd');
          if (shd) {
            var fill = shd.getAttributeNS(W, 'fill') || shd.getAttribute('w:fill');
            if (fill && fill !== 'auto') tcss.push('background-color:#' + fill);
          }
          var va = O.child(tcPr, 'vAlign');
          if (va) tcss.push('vertical-align:' + (O.wval(va) === 'center' ? 'middle' : O.wval(va)));
        }
        tcss.push('border:1px solid #999', 'padding:3pt 5pt', 'word-break:break-word');
        html += '<td' + (span > 1 ? ' colspan="' + span + '"' : '') + ' style="' + tcss.join(';') + '">';
        var blocks = [];
        for (var i = 0; i < tc.childNodes.length; i++) {
          var c = tc.childNodes[i];
          if (c.nodeType !== 1) continue;
          if (O.localName(c) === 'p') blocks.push(paraToHtml(c, ctx));
          else if (O.localName(c) === 'tbl') blocks.push(tableToHtml(c, ctx));
        }
        html += blocks.join('') + '</td>';
      });
      html += '</tr>';
    });
    html += '</table>';
    return html;
  }

  /* ============================ 主渲染入口 ============================ */
  /**
   * 渲染文档主体为 HTML
   * @param {Object} doc 文档模型
   * @param {XMLDocument} xmlDoc 要渲染的 document.xml（原文档或整改后的）
   * @param {Object} opts { stylesText }
   */
  function render(doc, xmlDoc, opts) {
    opts = opts || {};
    var styleMap = opts.styleMap || buildStyleMap(opts.stylesText);
    var body = xmlDoc.getElementsByTagNameNS(W, 'body')[0] || xmlDoc.documentElement;

    // 页面设置
    var sects = xmlDoc.getElementsByTagNameNS(W, 'sectPr');
    var sect = sects.length ? sects[sects.length - 1] : null;
    var page = { w: 21, h: 29.7, top: 2.54, bottom: 2.54, left: 3.17, right: 3.17 };
    if (sect) {
      var pgSz = O.child(sect, 'pgSz');
      if (pgSz) {
        var pw = parseFloat(pgSz.getAttributeNS(W, 'w') || pgSz.getAttribute('w:w'));
        var ph = parseFloat(pgSz.getAttributeNS(W, 'h') || pgSz.getAttribute('w:h'));
        if (pw) page.w = +(pw / 567).toFixed(2);
        if (ph) page.h = +(ph / 567).toFixed(2);
        var orient = pgSz.getAttributeNS(W, 'orient') || pgSz.getAttribute('w:orient');
        if (orient === 'landscape' && page.w < page.h) { var t = page.w; page.w = page.h; page.h = t; }
      }
      var pgMar = O.child(sect, 'pgMar');
      if (pgMar) {
        ['top', 'bottom', 'left', 'right'].forEach(function (k) {
          var v = parseFloat(pgMar.getAttributeNS(W, k) || pgMar.getAttribute('w:' + k));
          if (!isNaN(v)) page[k] = +(v / 567).toFixed(2);
        });
      }
    }

    var ctx = { doc: doc, styleMap: styleMap, listCounter: makeListCounter(doc, styleMap) };
    var html = '';
    for (var i = 0; i < body.childNodes.length; i++) {
      var n = body.childNodes[i];
      if (n.nodeType !== 1) continue;
      var ln = O.localName(n);
      if (ln === 'p') html += paraToHtml(n, ctx);
      else if (ln === 'tbl') html += tableToHtml(n, ctx);
      else if (ln === 'sdt') {
        var content = n.getElementsByTagNameNS(W, 'sdtContent')[0];
        if (content) {
          for (var k = 0; k < content.childNodes.length; k++) {
            var c2 = content.childNodes[k];
            if (c2.nodeType !== 1) continue;
            if (O.localName(c2) === 'p') html += paraToHtml(c2, ctx);
            else if (O.localName(c2) === 'tbl') html += tableToHtml(c2, ctx);
          }
        }
      }
    }
    return {
      html: html,
      page: page,
      pageStyle: 'width:' + page.w + 'cm;min-height:' + page.h + 'cm;' +
                 'padding:' + page.top + 'cm ' + page.right + 'cm ' + page.bottom + 'cm ' + page.left + 'cm;'
    };
  }

  global.Render = {
    render: render,
    buildStyleMap: buildStyleMap,
    cssFont: cssFont,
    escapeHtml: esc
  };
})(typeof window !== 'undefined' ? window : this);
