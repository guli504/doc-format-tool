/* =============================================================================
 * 文档格式批量整改工具 —— OOXML 底层工具 (ooxml.js)
 * 说明：
 *   1) 提供 WordprocessingML 命名空间下的 DOM 读写助手（含按架构顺序插入子元素）；
 *   2) 负责打开 .docx（本质是 zip + XML），读取正文、样式、编号、图片等部件；
 *   3) 负责把整改后的 XML 重新打包为新的 .docx（除被修改的部件外，其余字节原样保留），
 *      从而保证图片、公式、批注、域、表格等对象不丢失；
 *   4) 负责把纯文本段落合成为一份新的 .docx（供旧版 .doc 导入后使用）。
 * 依赖：constants.js、JSZip
 * ========================================================================== */
(function (global) {
  'use strict';

  /* ------------------------------ 命名空间 ------------------------------ */
  var NS = {
    w:  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    r:  'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    m:  'http://schemas.openxmlformats.org/officeDocument/2006/math',
    wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
    a:  'http://schemas.openxmlformats.org/drawingml/2006/main',
    pic:'http://schemas.openxmlformats.org/drawingml/2006/picture',
    v:  'urn:schemas-microsoft-com:vml',
    mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
    ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
    pr: 'http://schemas.openxmlformats.org/package/2006/relationships'
  };

  /* ------------------------- w:rPr 子元素架构顺序 ------------------------- */
  var RPR_ORDER = ['w:rStyle', 'w:rFonts', 'w:b', 'w:bCs', 'w:i', 'w:iCs', 'w:caps', 'w:smallCaps',
    'w:strike', 'w:dstrike', 'w:outline', 'w:shadow', 'w:emboss', 'w:imprint', 'w:noProof',
    'w:snapToGrid', 'w:vanish', 'w:webHidden', 'w:color', 'w:spacing', 'w:w', 'w:kern',
    'w:position', 'w:sz', 'w:szCs', 'w:highlight', 'w:u', 'w:effect', 'w:bdr', 'w:shd',
    'w:fitText', 'w:vertAlign', 'w:rtl', 'w:cs', 'w:em', 'w:lang', 'w:eastAsianLayout',
    'w:specVanish', 'w:oMath'];

  /* ------------------------- w:pPr 子元素架构顺序 ------------------------- */
  var PPR_ORDER = ['w:pStyle', 'w:keepNext', 'w:keepLines', 'w:pageBreakBefore', 'w:framePr',
    'w:widowControl', 'w:numPr', 'w:suppressLineNumbers', 'w:pBdr', 'w:shd', 'w:tabs',
    'w:suppressAutoHyphens', 'w:kinsoku', 'w:wordWrap', 'w:overflowPunct', 'w:topLinePunct',
    'w:autoSpaceDE', 'w:autoSpaceDN', 'w:bidi', 'w:adjustRightInd', 'w:snapToGrid', 'w:spacing',
    'w:ind', 'w:contextualSpacing', 'w:mirrorIndents', 'w:suppressOverlap', 'w:jc',
    'w:textDirection', 'w:textAlignment', 'w:textboxTightWrap', 'w:outlineLvl', 'w:divId',
    'w:cnfStyle', 'w:rPr', 'w:sectPr', 'w:pPrChange'];

  /* ------------------------------ XML 解析 ------------------------------ */
  function parseXml(text) {
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    var err = doc.getElementsByTagName('parsererror');
    if (err && err.length) {
      throw new Error('XML 解析失败：' + (err[0].textContent || '').slice(0, 200));
    }
    return doc;
  }

  function serialize(xmlDoc) {
    var s = new XMLSerializer().serializeToString(xmlDoc);
    // 保证 XML 声明存在（Word 更兼容）
    if (!/^\s*<\?xml/.test(s)) s = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + s;
    return s;
  }

  /* ------------------------------ 元素助手 ------------------------------ */
  function el(doc, qname) {
    var i = qname.indexOf(':');
    var prefix = i > 0 ? qname.slice(0, i) : '';
    var ns = NS[prefix] || NS.w;
    return doc.createElementNS(ns, qname);
  }

  function attr(e, qname, value) {
    var i = qname.indexOf(':');
    var prefix = i > 0 ? qname.slice(0, i) : '';
    var ns = NS[prefix];
    if (ns) e.setAttributeNS(ns, qname, value);
    else e.setAttribute(qname, value);
    return e;
  }

  function localName(e) {
    return e.localName || (e.nodeName.indexOf(':') >= 0 ? e.nodeName.split(':')[1] : e.nodeName);
  }

  /** 判断元素是否为 w:xxx（文档主命名空间） */
  function isW(e, name) {
    if (e.nodeType !== 1) return false;
    var ln = localName(e);
    if (name && ln !== name) return false;
    return e.namespaceURI === NS.w || (e.prefix === 'w');
  }

  /** 读取 w:val 属性（兼容无命名空间的写法） */
  function wval(e) {
    if (!e) return null;
    var v = e.getAttributeNS(NS.w, 'val');
    if (v === null || v === '') v = e.getAttribute('w:val');
    return v === '' ? '' : v;
  }

  /** 取第一个 w:name 子元素 */
  function child(parent, name) {
    if (!parent) return null;
    var list = parent.childNodes;
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      if (n.nodeType === 1 && isW(n, name)) return n;
    }
    return null;
  }

  function children(parent, name) {
    var out = [];
    if (!parent) return out;
    var list = parent.childNodes;
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      if (n.nodeType === 1 && isW(n, name)) out.push(n);
    }
    return out;
  }

  /** 按架构顺序获取/创建子元素 */
  function ensureChild(parent, qname, orderList) {
    var name = qname.split(':')[1];
    var found = child(parent, name);
    if (found) return found;
    var e = el(parent.ownerDocument, qname);
    var order = orderList || RPR_ORDER;
    var idx = order.indexOf(qname);
    if (idx < 0) { parent.appendChild(e); return e; }
    // 找到插入位置：第一个架构顺序大于自己的兄弟节点之前
    var ref = null;
    for (var i = 0; i < parent.childNodes.length; i++) {
      var n = parent.childNodes[i];
      if (n.nodeType !== 1) continue;
      var q = 'w:' + localName(n);
      var j = order.indexOf(q);
      if (j > idx) { ref = n; break; }
    }
    if (ref) parent.insertBefore(e, ref); else parent.appendChild(e);
    return e;
  }

  /** 删除所有指定子元素 */
  function removeChildren(parent, name) {
    var list = children(parent, name);
    list.forEach(function (n) { parent.removeChild(n); });
    return list.length;
  }

  function getPPr(p) { return child(p, 'pPr'); }

  /** 获取/创建 w:pPr —— 按 OOXML 规范必须位于段落的第一个子元素 */
  function ensurePPr(p) {
    var found = child(p, 'pPr');
    if (found) return found;
    var e = el(p.ownerDocument, 'w:pPr');
    p.insertBefore(e, p.firstChild);
    return e;
  }

  function getRPr(r) { return child(r, 'rPr'); }

  /** 获取/创建 w:rPr —— 按 OOXML 规范必须位于 run 的第一个子元素 */
  function ensureRPr(r) {
    var found = child(r, 'rPr');
    if (found) return found;
    var e = el(r.ownerDocument, 'w:rPr');
    r.insertBefore(e, r.firstChild);
    return e;
  }

  /** 取段落有效属性（含 pPr/rPr 的直接格式） */
  function paraHasDrawing(p) {
    return !!p.getElementsByTagNameNS(NS.w, 'drawing').length ||
           !!p.getElementsByTagNameNS(NS.w, 'pict').length ||
           !!p.getElementsByTagNameNS(NS.w, 'object').length;
  }

  /** 段落纯文本（w:t 内容拼接；制表符/换行/图片以占位符表示） */
  function paraText(p, withPlaceholder) {
    var out = '';
    walk(p);
    function walk(node) {
      for (var i = 0; i < node.childNodes.length; i++) {
        var n = node.childNodes[i];
        if (n.nodeType !== 1) continue;
        var ln = localName(n);
        var ns = n.namespaceURI;
        if (ns === NS.w) {
          if (ln === 't') out += n.textContent;
          else if (ln === 'tab') out += '\t';
          else if (ln === 'br') out += '\n';
          else if (ln === 'cr') out += '\n';
          else if (ln === 'noBreakHyphen') out += '-';
          else if (ln === 'drawing' || ln === 'pict' || ln === 'object') { if (withPlaceholder) out += '\uFFFC'; }
          else if (ln === 'delText') { /* 删除的修订文本不计入 */ }
          else walk(n);
        } else if (ns === NS.m) {
          if (ln === 'oMath' || ln === 'oMathPara') { if (withPlaceholder) out += '\u25A1'; }
          else walk(n);
        }
      }
    }
    return out;
  }

  /* ------------------------------ 样式解析 ------------------------------ */
  function parseStyles(xmlText) {
    var map = {};
    if (!xmlText) return map;
    var doc;
    try { doc = parseXml(xmlText); } catch (e) { return map; }
    var styles = doc.getElementsByTagNameNS(NS.w, 'style');
    for (var i = 0; i < styles.length; i++) {
      var s = styles[i];
      var id = s.getAttributeNS(NS.w, 'styleId') || s.getAttribute('w:styleId');
      if (!id) continue;
      var nameEl = child(s, 'name');
      var name = nameEl ? (wval(nameEl) || '') : '';
      var outline = null;
      var pPr = child(s, 'pPr');
      if (pPr) {
        var ol = child(pPr, 'outlineLvl');
        if (ol) outline = parseInt(wval(ol), 10);
      }
      var type = s.getAttributeNS(NS.w, 'type') || s.getAttribute('w:type') || 'paragraph';
      map[id] = { id: id, name: name, outlineLvl: isNaN(outline) ? null : outline, type: type };
    }
    return map;
  }

  /**
   * 根据样式 Id 推断标题层级（1-9），非标题返回 0。
   * 依据：样式名 / 样式 Id / outlineLvl
   */
  function headingLevelFromStyle(styleId, styleMap) {
    if (!styleId) return 0;
    var rec = styleMap && styleMap[styleId];
    var name = (rec && rec.name) || '';
    var candidates = [styleId, name];
    for (var i = 0; i < candidates.length; i++) {
      var s = String(candidates[i] || '').trim();
      if (!s) continue;
      var m = s.match(/^(?:heading|Heading|标\s*题|標題)\s*([1-9])$/);
      if (m) return parseInt(m[1], 10);
      m = s.match(/^(?:heading|Heading)([1-9])$/);
      if (m) return parseInt(m[1], 10);
      m = s.match(/^(?:标题|標題)\s*([一二三四五六七八九])$/);
      if (m) return '一二三四五六七八九'.indexOf(m[1]) + 1;
    }
    if (rec && rec.outlineLvl !== null && rec.outlineLvl !== undefined && rec.outlineLvl >= 0 && rec.outlineLvl <= 8) {
      // 仅当样式名为“标题/Heading”类，或样式名以 TOC 开头时才使用 outlineLvl
      if (!/^TOC|^toc|目录|目錄/.test(name)) return rec.outlineLvl + 1;
    }
    return 0;
  }

  /* ------------------------------ 编号解析 ------------------------------ */
  function parseNumbering(xmlText) {
    var numMap = {}, absMap = {};
    if (!xmlText) return { numMap: numMap, absMap: absMap };
    var doc;
    try { doc = parseXml(xmlText); } catch (e) { return { numMap: numMap, absMap: absMap }; }
    var absList = doc.getElementsByTagNameNS(NS.w, 'abstractNum');
    for (var i = 0; i < absList.length; i++) {
      var a = absList[i];
      var aid = a.getAttributeNS(NS.w, 'abstractNumId') || a.getAttribute('w:abstractNumId');
      var levels = {};
      var lvls = a.getElementsByTagNameNS(NS.w, 'lvl');
      for (var j = 0; j < lvls.length; j++) {
        var lv = lvls[j];
        var ilvl = parseInt(lv.getAttributeNS(NS.w, 'ilvl') || lv.getAttribute('w:ilvl') || '0', 10);
        var fmt = child(lv, 'numFmt');
        var txt = child(lv, 'lvlText');
        var start = child(lv, 'start');
        levels[ilvl] = {
          numFmt: fmt ? wval(fmt) : 'decimal',
          lvlText: txt ? wval(txt) : '',
          start: start ? parseInt(wval(start), 10) || 1 : 1
        };
      }
      absMap[aid] = levels;
    }
    var numList = doc.getElementsByTagNameNS(NS.w, 'num');
    for (var k = 0; k < numList.length; k++) {
      var n = numList[k];
      var nid = n.getAttributeNS(NS.w, 'numId') || n.getAttribute('w:numId');
      var ab = child(n, 'abstractNumId');
      numMap[nid] = ab ? wval(ab) : null;
    }
    return { numMap: numMap, absMap: absMap };
  }

  /* --------------------------- 关系（rels）解析 --------------------------- */
  function parseRels(xmlText) {
    var map = {};
    if (!xmlText) return map;
    var doc;
    try { doc = parseXml(xmlText); } catch (e) { return map; }
    var list = doc.getElementsByTagName('Relationship');
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      var id = r.getAttribute('Id');
      if (!id) continue;
      map[id] = {
        target: r.getAttribute('Target') || '',
        type: r.getAttribute('Type') || '',
        mode: r.getAttribute('TargetMode') || ''
      };
    }
    return map;
  }

  /** 相对部件路径解析：base 为所在部件目录（如 'word'） */
  function resolvePart(base, target) {
    if (!target) return '';
    if (/^[a-zA-Z]+:/.test(target)) return target; // 外部链接
    if (target.charAt(0) === '/') return target.slice(1);
    var stack = base ? base.split('/') : [];
    target.split('/').forEach(function (seg) {
      if (seg === '.' || seg === '') return;
      if (seg === '..') stack.pop();
      else stack.push(seg);
    });
    return stack.join('/');
  }

  function base64ToDataUrl(b64, ext) {
    var mime = 'image/png';
    switch (String(ext || '').toLowerCase()) {
      case 'jpg': case 'jpeg': mime = 'image/jpeg'; break;
      case 'gif': mime = 'image/gif'; break;
      case 'bmp': mime = 'image/bmp'; break;
      case 'svg': mime = 'image/svg+xml'; break;
      case 'emf': mime = 'image/emf'; break;
      case 'wmf': mime = 'image/wmf'; break;
      case 'tif': case 'tiff': mime = 'image/tiff'; break;
      case 'webp': mime = 'image/webp'; break;
      default: mime = 'image/png';
    }
    return 'data:' + mime + ';base64,' + b64;
  }

  /* ============================== 打开 .docx ============================== */
  /**
   * 打开 .docx 文档。
   * @param {ArrayBuffer} buffer
   * @param {string} name 文件名
   * @returns {Promise<Object>} doc 模型
   */
  async function open(buffer, name) {
    if (typeof JSZip === 'undefined') throw new Error('JSZip 未加载，无法解析 .docx');
    // 归一化输入：跨 window/iframe 传来的 ArrayBuffer 在本窗口内 instanceof 判定会失败，
    // 统一转成本窗口的 Uint8Array 再交给 JSZip，保证任何来源都能正确解析。
    if (!(buffer instanceof Uint8Array)) buffer = new Uint8Array(buffer);
    var zip;
    try {
      zip = await JSZip.loadAsync(buffer);
    } catch (e) {
      throw new Error('文件不是有效的 .docx（zip 结构损坏）');
    }
    var mainFile = zip.file('word/document.xml');
    if (!mainFile) throw new Error('缺少 word/document.xml，可能不是 Word 文档');

    var doc = {
      name: name || 'document.docx',
      kind: 'docx',
      buffer: buffer,
      zip: zip,
      mainPath: 'word/document.xml',
      warnings: []
    };

    var mainText = await mainFile.async('string');
    doc.xml = parseXml(mainText);

    // 关系、样式、编号
    var relsFile = zip.file('word/_rels/document.xml.rels');
    doc.rels = parseRels(relsFile ? await relsFile.async('string') : '');
    var stylesFile = zip.file('word/styles.xml');
    doc.stylesRaw = stylesFile ? await stylesFile.async('string') : '';
    doc.styles = parseStyles(doc.stylesRaw);
    var numberingFile = zip.file('word/numbering.xml');
    doc.numbering = parseNumbering(numberingFile ? await numberingFile.async('string') : '');

    // 图片（转为 dataURL 供预览使用）
    doc.images = {};
    var jobs = [];
    Object.keys(doc.rels).forEach(function (rid) {
      var rel = doc.rels[rid];
      if (rel.mode === 'External' || !/image/i.test(rel.type)) return;
      var path = resolvePart('word', rel.target);
      var f = zip.file(path);
      if (!f) return;
      var ext = (path.split('.').pop() || '').toLowerCase();
      jobs.push(f.async('base64').then(function (b64) {
        doc.images[rid] = base64ToDataUrl(b64, ext);
      }).catch(function () {}));
    });
    await Promise.all(jobs);

    // 附加部件（页眉/页脚/批注/脚注）—— 延迟解析，处理时再读取
    doc.extraParts = [];
    zip.forEach(function (p, f) {
      if (f.dir) return;
      if (/^word\/(header|footer)\d*\.xml$/.test(p) ||
          /^word\/comments\.xml$/.test(p) ||
          /^word\/footnotes\.xml$/.test(p) ||
          /^word\/endnotes\.xml$/.test(p)) {
        doc.extraParts.push({ path: p, kind: p.indexOf('header') >= 0 ? 'header'
          : p.indexOf('footer') >= 0 ? 'footer'
          : p.indexOf('comments') >= 0 ? 'comments' : 'notes' });
      }
    });

    // 统计基本信息（含"是不是图片版文档"的判断依据）
    var body = doc.xml.getElementsByTagNameNS(NS.w, 'body')[0] || doc.xml.documentElement;
    var bodyParas = body.getElementsByTagNameNS(NS.w, 'p');
    var chars = 0;
    for (var i = 0; i < bodyParas.length; i++) {
      chars += paraText(bodyParas[i], false).replace(/[\s\u3000]/g, '').length;
    }
    doc.stats = {
      paragraphs: bodyParas.length,
      tables: body.getElementsByTagNameNS(NS.w, 'tbl').length,
      images: Object.keys(doc.images).length,
      drawings: body.getElementsByTagNameNS(NS.w, 'drawing').length +
                body.getElementsByTagNameNS(NS.w, 'pict').length,
      characters: chars
    };
    doc.stats.imageOnly = (chars < 30 && doc.stats.drawings > 0);
    return doc;
  }

  /* ======================= 由纯文本段落合成新 .docx ======================= */
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="' + NS.ct + '">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    '</Types>';

  var ROOT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="' + NS.pr + '">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
    '</Relationships>';

  var DOC_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="' + NS.pr + '">' +
    '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';

  function headingStyleXml(id, name, outline, size, bold, align) {
    return '<w:style w:type="paragraph" w:styleId="' + id + '">' +
      '<w:name w:val="' + name + '"/><w:basedOn w:val="Normal"/><w:qFormat/>' +
      '<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/>' +
      '<w:jc w:val="' + align + '"/><w:outlineLvl w:val="' + outline + '"/></w:pPr>' +
      '<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="黑体"/>' +
      (bold ? '<w:b/>' : '') + '<w:sz w:val="' + size + '"/><w:szCs w:val="' + size + '"/></w:rPr>' +
      '</w:style>';
  }

  var STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="' + NS.w + '">' +
    '<w:docDefaults><w:rPrDefault><w:rPr>' +
    '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman"/>' +
    '<w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    headingStyleXml('Heading1', 'heading 1', 0, 32, true, 'center') +
    headingStyleXml('Heading2', 'heading 2', 1, 28, true, 'left') +
    headingStyleXml('Heading3', 'heading 3', 2, 24, true, 'left') +
    '</w:styles>';

  /**
   * 由段落数组合成 .docx
   * @param {Array<{text:string, level?:number, type?:string}>} paragraphs
   * @param {Object} meta {title, author}
   * @returns {JSZip}
   */
  function buildZipFromParagraphs(paragraphs, meta) {
    meta = meta || {};
    var body = '';
    paragraphs.forEach(function (p) {
      var text = String(p.text == null ? '' : p.text);
      var level = p.level || 0;
      var style = level >= 1 ? 'Heading' + Math.min(level, 3) : '';
      var pPr = style ? '<w:pPr><w:pStyle w:val="' + style + '"/></w:pPr>' : '';
      // 保留原段内的显式换行
      var segs = text.split('\n');
      var runs = segs.map(function (s, i) {
        return (i > 0 ? '<w:r><w:br/></w:r>' : '') +
          '<w:r><w:t xml:space="preserve">' + esc(s) + '</w:t></w:r>';
      }).join('');
      body += '<w:p>' + pPr + runs + '</w:p>';
    });
    // 页面设置：A4 + 默认页边距
    body += '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1440" w:right="1797" w:bottom="1440" w:left="1797" w:header="851" w:footer="992" w:gutter="0"/>' +
      '<w:cols w:space="425"/><w:docGrid w:type="lines" w:linePitch="312"/></w:sectPr>';

    var documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="' + NS.w + '" xmlns:r="' + NS.r + '" xmlns:m="' + NS.m + '" ' +
      'xmlns:wp="' + NS.wp + '" xmlns:a="' + NS.a + '" xmlns:pic="' + NS.pic + '" xmlns:v="' + NS.v + '">' +
      '<w:body>' + body + '</w:body></w:document>';

    var now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    var core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + esc(meta.title || '') + '</dc:title><dc:creator>' + esc(meta.author || '本地整改工具') + '</dc:creator>' +
      '<cp:lastModifiedBy>' + esc(meta.author || '本地整改工具') + '</cp:lastModifiedBy>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created>' +
      '<dcterms:modified xsi:type="dcterms:W3CDTF">' + now + '</dcterms:modified></cp:coreProperties>';

    var app = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
      'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
      '<Application>DocFormatTool</Application></Properties>';

    var zip = new JSZip();
    zip.file('[Content_Types].xml', CONTENT_TYPES);
    zip.file('_rels/.rels', ROOT_RELS);
    zip.file('word/document.xml', documentXml);
    zip.file('word/_rels/document.xml.rels', DOC_RELS);
    zip.file('word/styles.xml', STYLES_XML);
    zip.file('docProps/core.xml', core);
    zip.file('docProps/app.xml', app);
    return zip;
  }

  /** 生成新的 doc 模型（用于旧 .doc 导入或纯文本导入） */
  async function fromParagraphs(paragraphs, meta) {
    var zip = buildZipFromParagraphs(paragraphs, meta);
    var buf = await zip.generateAsync({ type: 'arraybuffer' });
    return open(buf, meta && meta.fileName);
  }

  /* ============================== 保存 .docx ============================== */
  /**
   * 用替换后的部件重新打包
   * @param {Object} doc 文档模型
   * @param {Object} replacements { 'word/document.xml': xmlString, ... }
   * @returns {Promise<Blob>}
   */
  async function save(doc, replacements) {
    var zip = new JSZip();
    // 逐部件复制，被替换的写新内容，其余按原字节写入（保证不丢失/不损坏）
    var names = Object.keys(replacements || {});
    var jobs = [];
    doc.zip.forEach(function (path, file) {
      if (file.dir) { zip.folder(path); return; }
      if (names.indexOf(path) >= 0) {
        zip.file(path, replacements[path]);
      } else {
        jobs.push(file.async('uint8array').then(function (data) { zip.file(path, data); }));
      }
    });
    await Promise.all(jobs);
    // 若替换的部件原本不存在（罕见），补写
    names.forEach(function (p) { if (!doc.zip.file(p)) zip.file(p, replacements[p]); });
    return zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });
  }

  global.Ooxml = {
    NS: NS, RPR_ORDER: RPR_ORDER, PPR_ORDER: PPR_ORDER,
    parseXml: parseXml, serialize: serialize,
    el: el, attr: attr, localName: localName, isW: isW, wval: wval,
    child: child, children: children, ensureChild: ensureChild, removeChildren: removeChildren,
    getPPr: getPPr, ensurePPr: ensurePPr, getRPr: getRPr, ensureRPr: ensureRPr,
    paraHasDrawing: paraHasDrawing, paraText: paraText,
    parseStyles: parseStyles, headingLevelFromStyle: headingLevelFromStyle,
    parseNumbering: parseNumbering, parseRels: parseRels, resolvePart: resolvePart,
    open: open, save: save, fromParagraphs: fromParagraphs, buildZipFromParagraphs: buildZipFromParagraphs,
    esc: esc
  };
})(typeof window !== 'undefined' ? window : this);
