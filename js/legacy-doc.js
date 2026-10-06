/* =============================================================================
 * 文档格式批量整改工具 —— 旧版 .doc 兼容模块 (legacy-doc.js)
 * 说明：
 *   旧版 .doc 是 OLE 复合二进制格式（不是 zip/XML），浏览器无法直接改写格式，
 *   因此本模块负责把 .doc 解析为纯文本 + 段落结构，再合成为标准 .docx，
 *   之后即可使用与 .docx 完全相同的整改流程与导出能力。
 *   同时兼容：伪 .doc（实为 .docx）、RTF 文档、HTML 文档、纯文本。
 * 依赖：ooxml.js
 * ========================================================================== */
(function (global) {
  'use strict';

  var OLE_SIG = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
  var ENDOFCHAIN = 0xFFFFFFFE, FREESECT = 0xFFFFFFFF;

  function u16(dv, o) { return dv.getUint16(o, true); }
  function u32(dv, o) { return dv.getUint32(o, true); }
  function u64(dv, o) { return u32(dv, o) + u32(dv, o + 4) * 4294967296; }

  /* ------------------------------ 格式探测 ------------------------------ */
  function detect(buffer) {
    var b = new Uint8Array(buffer);
    if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4B) return 'docx';       // PK zip
    if (b.length >= 8) {
      var ok = true;
      for (var i = 0; i < 8; i++) if (b[i] !== OLE_SIG[i]) { ok = false; break; }
      if (ok) return 'ole';                                                  // 旧版 .doc
    }
    var head = '';
    for (var j = 0; j < Math.min(b.length, 200); j++) head += String.fromCharCode(b[j]);
    if (/^\s*\{\\rtf/.test(head)) return 'rtf';
    if (/<html|<\?xml|<!DOCTYPE|<w:document/i.test(head)) return 'html';
    return 'text';
  }

  /* ============================ OLE 复合文档 ============================ */
  function CFB(buffer) {
    this.dv = new DataView(buffer);
    this.bytes = new Uint8Array(buffer);
    if (this.dv.byteLength < 512) throw new Error('文件过小，不是有效的 Word 文档');
    for (var i = 0; i < 8; i++) if (this.dv.getUint8(i) !== OLE_SIG[i]) throw new Error('不是 OLE 复合文档结构');
    this.sectorShift = u16(this.dv, 0x1E);
    this.miniSectorShift = u16(this.dv, 0x20);
    this.sectorSize = Math.pow(2, this.sectorShift);
    this.miniSectorSize = Math.pow(2, this.miniSectorShift);
    this.firstDirSector = u32(this.dv, 0x30);
    this.miniCutoff = u32(this.dv, 0x38);
    this.firstMiniFat = u32(this.dv, 0x3C);
    this.numMiniFat = u32(this.dv, 0x40);
    this.firstDifat = u32(this.dv, 0x44);
    this.numDifat = u32(this.dv, 0x48);
    this._buildFat();
    this._readDir();
  }

  CFB.prototype.sectorOffset = function (s) { return 512 + s * this.sectorSize; };

  CFB.prototype._buildFat = function () {
    var dv = this.dv;
    var difat = [];
    for (var i = 0; i < 109; i++) {
      var v = u32(dv, 0x4C + i * 4);
      if (v === FREESECT || v === ENDOFCHAIN) continue;
      difat.push(v);
    }
    var next = this.firstDifat, guard = 0;
    while (next !== ENDOFCHAIN && next !== FREESECT && guard++ < 100000) {
      var off = this.sectorOffset(next);
      var perSector = this.sectorSize / 4;
      for (var k = 0; k < perSector - 1; k++) {
        var s = u32(dv, off + k * 4);
        if (s === FREESECT || s === ENDOFCHAIN) continue;
        difat.push(s);
      }
      next = u32(dv, off + (perSector - 1) * 4);
    }
    var fat = [];
    for (var d = 0; d < difat.length; d++) {
      var so = this.sectorOffset(difat[d]);
      for (var j = 0; j < this.sectorSize / 4; j++) fat.push(u32(dv, so + j * 4));
    }
    this.fat = fat;
  };

  CFB.prototype._chain = function (start) {
    var out = [], s = start, guard = 0;
    while (s !== ENDOFCHAIN && s !== FREESECT && s < this.fat.length && guard++ < 200000) {
      out.push(s);
      s = this.fat[s];
    }
    return out;
  };

  CFB.prototype._readSectors = function (start, size) {
    var chain = this._chain(start);
    var out = new Uint8Array(Math.max(size, chain.length * this.sectorSize));
    var pos = 0;
    for (var i = 0; i < chain.length; i++) {
      var off = this.sectorOffset(chain[i]);
      var len = Math.min(this.sectorSize, this.bytes.length - off);
      out.set(this.bytes.subarray(off, off + len), pos);
      pos += len;
    }
    return size ? out.subarray(0, size) : out;
  };

  CFB.prototype._readMini = function (start, size) {
    // 迷你流需要先取根目录项的流作为容器
    var rootStream = this._readSectors(this.rootEntry.startSector, this.rootEntry.size);
    var chain = [], s = start, guard = 0;
    var miniFat = this.miniFat || [];
    while (s !== ENDOFCHAIN && s !== FREESECT && s < miniFat.length && guard++ < 500000) {
      chain.push(s); s = miniFat[s];
    }
    var out = new Uint8Array(size);
    var pos = 0;
    for (var i = 0; i < chain.length && pos < size; i++) {
      var off = chain[i] * this.miniSectorSize;
      var len = Math.min(this.miniSectorSize, size - pos);
      out.set(rootStream.subarray(off, off + len), pos);
      pos += len;
    }
    return out;
  };

  CFB.prototype._readDir = function () {
    var dirBytes = this._readSectors(this.firstDirSector, 0);
    this.entries = {};
    this.rootEntry = null;
    for (var off = 0; off + 128 <= dirBytes.length; off += 128) {
      var nameLen = dirBytes[off + 0x40] | (dirBytes[off + 0x41] << 8);
      if (!nameLen || nameLen > 64) continue;
      var name = '';
      for (var i = 0; i < nameLen - 2; i += 2) name += String.fromCharCode(dirBytes[off + i] | (dirBytes[off + i + 1] << 8));
      var type = dirBytes[off + 0x42];
      var startSector = dirBytes[off + 0x74] | (dirBytes[off + 0x75] << 8) | (dirBytes[off + 0x76] << 16) | (dirBytes[off + 0x77] << 24);
      var size = (dirBytes[off + 0x78] | (dirBytes[off + 0x79] << 8) | (dirBytes[off + 0x7A] << 16) | (dirBytes[off + 0x7B] << 24)) >>> 0;
      var entry = { name: name, type: type, startSector: startSector, size: size };
      if (type === 5) this.rootEntry = entry;         // 根条目 = 迷你流容器
      if (type === 2) this.entries[name] = entry;     // 普通流
    }
    // 迷你 FAT
    if (this.numMiniFat > 0 && this.firstMiniFat !== ENDOFCHAIN) {
      var mfBytes = this._readSectors(this.firstMiniFat, 0);
      var miniFat = [];
      for (var m = 0; m + 4 <= mfBytes.length; m += 4) {
        miniFat.push(mfBytes[m] | (mfBytes[m + 1] << 8) | (mfBytes[m + 2] << 16) | (mfBytes[m + 3] << 24));
      }
      this.miniFat = miniFat;
    } else {
      this.miniFat = [];
    }
  };

  CFB.prototype.getStream = function (name) {
    var e = this.entries[name];
    if (!e) return null;
    if (e.size < this.miniCutoff && this.rootEntry) return this._readMini(e.startSector, e.size);
    return this._readSectors(e.startSector, e.size);
  };

  /* ---------------------- Word 二进制文本（分片表） ---------------------- */
  var CP1252 = (function () {
    var high = '\u20AC\u0081\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152' +
               '\u008D\u017D\u008F\u0090\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153' +
               '\u009D\u017E\u0178';
    return function (b) {
      if (b < 0x80) return String.fromCharCode(b);
      if (b < 0xA0) return high.charAt(b - 0x80);
      return String.fromCharCode(b);
    };
  })();

  function extractWordText(wordStream, tableStream) {
    if (!wordStream) throw new Error('缺少 WordDocument 数据流');
    var dv = new DataView(wordStream.buffer, wordStream.byteOffset, wordStream.byteLength);
    var wIdent = u16(dv, 0);
    if (wIdent !== 0xA5EC) throw new Error('Word 文档标识异常（0x' + wIdent.toString(16) + '）');
    var nFib = u16(dv, 2);
    var flags = u16(dv, 10);
    // Word 97(0x00C1=193) 及以后没有 fcMin/fcMac 字段，正文位置由分片表决定；
    // 仅 Word 6/95 使用 FibBase 中的 fcMin/fcMac。
    var fcMin = nFib < 105 ? u32(dv, 0x18) : 0x800;
    var fcMac = nFib < 105 ? u32(dv, 0x1C) : wordStream.length;
    var ccpText = u32(dv, 0x4C);
    var fcClx = u32(dv, 0x01A2), lcbClx = u32(dv, 0x01A6);
    var text = '';

    if (lcbClx > 0 && tableStream && fcClx + lcbClx <= tableStream.byteLength) {
      try { text = pieceTableText(wordStream, tableStream, fcClx, lcbClx); } catch (e) { text = ''; }
    }
    if (!text) {
      // 简单（非复合）文档：正文从 fcMin 开始
      var ccp = ccpText || Math.floor((fcMac - fcMin) / 2);
      var span = fcMac - fcMin;
      var sixteen = span >= ccp * 2;
      var s = '';
      for (var i = 0; i < ccp; i++) {
        if (sixteen) {
          var idx = fcMin + i * 2;
          if (idx + 1 >= wordStream.length) break;
          s += String.fromCharCode(wordStream[idx] | (wordStream[idx + 1] << 8));
        } else {
          var idx2 = fcMin + i;
          if (idx2 >= wordStream.length) break;
          s += CP1252(wordStream[idx2]);
        }
      }
      text = s;
    }
    if (ccpText > 0 && text.length > ccpText) text = text.slice(0, ccpText);
    return text;
  }

  function pieceTableText(wordStream, tableStream, fcClx, lcbClx) {
    var ts = new DataView(tableStream.buffer, tableStream.byteOffset, tableStream.byteLength);
    var pos = fcClx, end = fcClx + lcbClx;
    var out = '';
    while (pos < end) {
      var clxt = ts.getUint8(pos); pos++;
      if (clxt === 1) {                                  // Prc
        var cb = ts.getUint16(pos, true); pos += 2 + cb;
      } else if (clxt === 2) {                           // Pcdt
        var lcb = u32(ts, pos); pos += 4;
        var n = Math.floor((lcb - 4) / 12);
        if (n <= 0) break;
        var cpArr = pos, pcdArr = pos + 4 * (n + 1);
        for (var i = 0; i < n; i++) {
          var cpS = u32(ts, cpArr + 4 * i);
          var cpE = u32(ts, cpArr + 4 * (i + 1));
          var fc = u32(ts, pcdArr + 8 * i + 2);
          var compressed = (fc & 0x40000000) !== 0;
          var realFc = compressed ? ((fc & 0x3FFFFFFF) >>> 1) : fc;
          var len = cpE - cpS;
          if (len <= 0 || len > 50000000) continue;
          var chunk = '';
          if (compressed) {
            for (var k = 0; k < len; k++) {
              var b = wordStream[realFc + k];
              if (b === undefined) break;
              chunk += CP1252(b);
            }
          } else {
            for (var k2 = 0; k2 < len; k2++) {
              var o = realFc + k2 * 2;
              if (o + 1 >= wordStream.length) break;
              chunk += String.fromCharCode(wordStream[o] | (wordStream[o + 1] << 8));
            }
          }
          out += chunk;
        }
        break;
      } else {
        break;
      }
    }
    return out;
  }

  /* ---------------------- Word 控制字符 → 段落结构 ---------------------- */
  function wordTextToParagraphs(text) {
    var out = [];
    var buf = '', inFieldInstr = false;
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i), ch = text[i];
      if (c === 0x13) { inFieldInstr = true; continue; }      // 域开始
      if (c === 0x14) { inFieldInstr = false; continue; }     // 域分隔符
      if (c === 0x15) { continue; }                           // 域结束
      if (inFieldInstr) continue;                             // 域指令不输出
      if (c === 0x0D || c === 0x0B || c === 0x0C || c === 0x0E) {
        out.push(buf); buf = ''; continue;
      }
      if (c === 0x07) { buf += '\t'; continue; }              // 单元格/行结束
      if (c === 0x01) { buf += '[图片]'; continue; }          // 内嵌图片
      if (c === 0x02) { continue; }                           // 脚注引用
      if (c < 0x20 && c !== 0x09) continue;                   // 其它控制符
      buf += ch;
    }
    if (buf.trim()) out.push(buf);
    return out.filter(function (s) { return s.trim() !== ''; })
      .map(function (s) { return { text: s.replace(/\s+$/, '') }; });
  }

  /* ============================== RTF 解析 ============================== */
  /** 按代码页解码字节序列：优先按 UTF-8，失败则按 RTF 声明的代码页 */
  function decodeBytes(byteArr, codepage) {
    var arr = new Uint8Array(byteArr);
    var hasHigh = false;
    for (var i = 0; i < arr.length; i++) if (arr[i] >= 0x80) { hasHigh = true; break; }
    if (!hasHigh) {
      var s = '';
      for (var j = 0; j < arr.length; j++) s += String.fromCharCode(arr[j]);
      return s;
    }
    try {
      var t = new TextDecoder('utf-8', { fatal: true }).decode(arr);
      if (t.indexOf('\uFFFD') < 0) return t;
    } catch (e) { /* 不是合法 UTF-8，继续按代码页 */ }
    var enc = 'gbk';
    if (codepage === 950) enc = 'big5';
    else if (!codepage || codepage === 1252 || codepage === 437 || codepage === 850) enc = 'windows-1252';
    else if (codepage === 54936) enc = 'gb18030';
    else if (codepage === 0 || codepage === 1) enc = 'gbk';
    try { return new TextDecoder(enc, { fatal: false }).decode(arr); }
    catch (e2) { return new TextDecoder('windows-1252').decode(arr); }
  }

  function extractRtfText(buffer) {
    var bytes = new Uint8Array(buffer);
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    var out = '';
    var i2 = 0;
    var skipStack = [];
    var codepage = 1252;
    var destSkip = { fonttbl: 1, colortbl: 1, stylesheet: 1, info: 1, pict: 1, header: 1, footer: 1,
                     footnote: 1, filetbl: 1, listtable: 1, rsidtbl: 1, generator: 1, xmlnstbl: 1,
                     fldinst: 1, datafield: 1, object: 1 };
    var pendingHex = [];
    function flushHex() {
      if (!pendingHex.length) return;
      out += decodeBytes(pendingHex, codepage);
      pendingHex = [];
    }
    while (i2 < s.length) {
      var ch = s[i2];
      if (ch === '\\') {
        var nxt = s[i2 + 1];
        if (nxt === '\\' || nxt === '{' || nxt === '}') { flushHex(); out += nxt; i2 += 2; continue; }
        if (nxt === "'") {
          var hex = s.substr(i2 + 2, 2);
          pendingHex.push(parseInt(hex, 16) || 0);
          i2 += 4; continue;
        }
        if (nxt === '*') { if (skipStack.length) skipStack[skipStack.length - 1] = true; i2 += 2; continue; }
        var m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(s.slice(i2));
        if (m) {
          var word = m[1];
          var num = m[2] ? parseInt(m[2], 10) : null;
          i2 += m[0].length;
          flushHex();
          var skipping = skipStack.indexOf(true) >= 0;
          if (skipping) { continue; }
          if (destSkip[word]) { if (skipStack.length) skipStack[skipStack.length - 1] = true; }
          else if (word === 'ansicpg' && num) { codepage = num; }
          else if (word === 'par' || word === 'line' || word === 'sect') out += '\n';
          else if (word === 'tab') out += '\t';
          else if (word === 'u' && num !== null) {
            out += String.fromCharCode(num < 0 ? num + 65536 : num);
            i2 += 1;   // 跳过 \ucN 指定的替代字符
          }
          continue;
        }
        i2 += 2; continue;
      }
      if (ch === '{') { skipStack.push(false); i2++; continue; }
      if (ch === '}') { skipStack.pop(); i2++; continue; }
      if (skipStack.indexOf(true) >= 0) { i2++; continue; }
      if (ch === '\r' || ch === '\n') { i2++; continue; }
      var cc = s.charCodeAt(i2);
      if (cc >= 0x80) { pendingHex.push(cc); i2++; continue; }   // 原始高位字节
      flushHex();
      out += ch; i2++;
    }
    flushHex();
    return out;
  }

  /* ============================== HTML 解析 ============================== */
  function extractHtmlText(buffer) {
    var s = new TextDecoder('utf-8').decode(new Uint8Array(buffer));
    if (/charset\s*=\s*(gb2312|gbk|gb18030)/i.test(s.slice(0, 2000))) {
      try { s = new TextDecoder('gbk').decode(new Uint8Array(buffer)); } catch (e) {}
    }
    var body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(s);
    s = body ? body[1] : s;
    s = s.replace(/<script[\s\S]*?<\/script>/gi, '')
         .replace(/<style[\s\S]*?<\/style>/gi, '')
         .replace(/<!--[\s\S]*?-->/g, '')
         .replace(/<\/(p|div|h[1-6]|li|tr|table|section)>/gi, '\n')
         .replace(/<br\s*\/?>/gi, '\n')
         .replace(/<[^>]+>/g, '');
    s = s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
         .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
         .replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(parseInt(d, 10)); });
    return s;
  }

  function textToParagraphs(text) {
    return text.split(/\r\n|\r|\n/)
      .map(function (s) { return s.replace(/\t/g, '    ').trim(); })
      .filter(function (s) { return s !== ''; })
      .map(function (s) { return { text: s }; });
  }

  /* ============================== 对外接口 ============================== */
  /**
   * 把非 .docx 的文档转换成 docx 模型
   * @param {ArrayBuffer} buffer
   * @param {string} name 文件名
   * @returns {Promise<Object>} doc 模型（与 Ooxml.open 返回一致）
   */
  async function convert(buffer, name) {
    var kind = detect(buffer);
    var paragraphs, note;
    if (kind === 'ole') {
      var cfb = new CFB(buffer);
      var word = cfb.getStream('WordDocument');
      if (!word) throw new Error('未找到 WordDocument 数据流，文件可能已损坏');
      var flags = u16(new DataView(word.buffer, word.byteOffset, word.byteLength), 10);
      var tblName = (flags & 0x0200) ? '1Table' : '0Table';
      var table = cfb.getStream(tblName) || cfb.getStream('1Table') || cfb.getStream('0Table');
      var text = extractWordText(word, table);
      paragraphs = wordTextToParagraphs(text);
      note = '旧版 .doc：已提取文字内容（图片、公式等二进制对象无法读取），导出为 .docx';
    } else if (kind === 'rtf') {
      paragraphs = textToParagraphs(extractRtfText(buffer));
      note = 'RTF 文档：已提取文字内容并转换为 .docx';
    } else if (kind === 'html') {
      paragraphs = textToParagraphs(extractHtmlText(buffer));
      note = 'HTML 文档：已提取文字内容并转换为 .docx';
    } else {
      var raw = new TextDecoder('utf-8').decode(new Uint8Array(buffer));
      if (/\uFFFD{5,}/.test(raw.slice(0, 500))) {
        try { raw = new TextDecoder('gbk').decode(new Uint8Array(buffer)); } catch (e) {}
      }
      paragraphs = textToParagraphs(raw);
      note = '纯文本文件：已转换为 .docx';
    }
    if (!paragraphs.length) throw new Error('未能从该文件中提取到文本内容');
    var doc = await global.Ooxml.fromParagraphs(paragraphs, { title: name, fileName: name });
    doc.name = name;
    doc.convertedFrom = kind;
    doc.convertNote = note;
    doc.warnings.push(note);
    return doc;
  }

  global.LegacyDoc = { detect: detect, convert: convert, extractWordText: extractWordText };
})(typeof window !== 'undefined' ? window : this);
