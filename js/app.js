/* =============================================================================
 * 文档格式批量整改工具 —— 界面控制器 (app.js)
 * 说明：
 *   · 参数与界面双向绑定（所有控件使用 data-param 声明参数路径，便于扩展）；
 *   · 负责文件导入（拖拽 / 选择）、调用引擎整改、预览渲染、导出、问题清单、
 *     撤销重做、模板与字体库管理；
 *   · 全程在浏览器本地完成，不发起任何网络请求。
 * 依赖：constants.js / store.js / ooxml.js / engine.js / render.js / legacy-doc.js
 * ========================================================================== */
(function () {
  'use strict';

  var DFT = window.DFT, Store = window.Store, O = window.Ooxml,
      Engine = window.Engine, Render = window.Render, Legacy = window.LegacyDoc;

  /* ============================== 状态 ============================== */
  var state = {
    params: Store.loadParams(),
    files: [],
    activeId: null,
    history: [],
    hIndex: -1,
    busy: false,
    view: 'split',
    zoom: 1,
    markMode: false,
    autoTimer: null,
    lastRunAt: 0
  };

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  /* ============================== 小工具 ============================== */
  function toast(msg, type, ms) {
    var el = $('#toast');
    el.textContent = msg;
    el.className = 'toast' + (type ? ' ' + type : '');
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.hidden = true; }, ms || 2600);
  }

  function setProgress(pct, text) {
    var wrap = $('#progressWrap');
    if (pct === null) { wrap.hidden = true; return; }
    wrap.hidden = false;
    $('#progressBar').style.width = Math.max(0, Math.min(100, pct)) + '%';
    if (text) $('#progressText').textContent = text;
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 2000);
  }

  function setPath(obj, path, val) {
    var parts = path.split('.'), cur = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = val;
  }
  function getPath(obj, path) {
    var parts = path.split('.'), cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }
  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }
  function basename(name) { return String(name).replace(/\.[^.]+$/, ''); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ============================== 参数绑定 ============================== */
  function collectParams() {
    var p = Store.clone(DFT.DEFAULT_PARAMS);
    $$('[data-param]').forEach(function (el) {
      var path = el.dataset.param, type = el.dataset.type || 'text';
      var val;
      if (type === 'bool') val = !!el.checked;
      else if (type === 'number') {
        val = parseFloat(el.value);
        if (isNaN(val)) return;
      } else val = el.value;
      setPath(p, path, val);
    });
    // 非表单状态（分节规则等）从当前参数中保留，避免被覆盖
    if (state.params && state.params.range && state.params.range.sectionRules) {
      p.range.sectionRules = state.params.range.sectionRules;
    }
    return p;
  }

  function applyParams(p) {
    $$('[data-param]').forEach(function (el) {
      var v = getPath(p, el.dataset.param);
      if (v === undefined || v === null) return;
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v;
    });
  }

  /* 参数变化 → 保存 + 记录历史 + 自动重跑 */
  function onParamChange() {
    state.params = collectParams();
    Store.saveParams(state.params);
    markStale();
    scheduleAutoRun();
  }

  function markStale() {
    state.files.forEach(function (f) { if (f.blob) f.stale = true; });
    var hint = $('#fixedHint');
    if (state.files.some(function (f) { return f.blob; })) hint.textContent = '（参数已修改，正在重新生成…）';
  }

  function scheduleAutoRun() {
    if (!state.files.length) return;
    clearTimeout(state.autoTimer);
    state.autoTimer = setTimeout(function () { runProcess(true); }, 650);
  }

  /* ============================== 历史记录 ============================== */
  function pushHistory(snapshot) {
    var json = JSON.stringify(snapshot || state.params);
    if (state.history[state.hIndex] === json) return;
    state.history = state.history.slice(0, state.hIndex + 1);
    state.history.push(json);
    if (state.history.length > 60) state.history.shift();
    state.hIndex = state.history.length - 1;
    updateHistoryButtons();
  }
  function undo() {
    if (state.hIndex <= 0) return toast('没有可撤销的操作');
    state.hIndex--;
    state.params = JSON.parse(state.history[state.hIndex]);
    applyParams(state.params); Store.saveParams(state.params); updateHistoryButtons();
    runProcess(true);
  }
  function redo() {
    if (state.hIndex >= state.history.length - 1) return toast('没有可重做的操作');
    state.hIndex++;
    state.params = JSON.parse(state.history[state.hIndex]);
    applyParams(state.params); Store.saveParams(state.params); updateHistoryButtons();
    runProcess(true);
  }
  function updateHistoryButtons() {
    $('#btnUndo').disabled = state.hIndex <= 0;
    $('#btnRedo').disabled = state.hIndex >= state.history.length - 1;
  }

  /* ============================== 字体库 / 下拉框 ============================== */
  function fontOptions(type, selected) {
    var list = Store.loadFontLibrary();
    var favs = list.filter(function (f) { return f.fav; });
    var rest = list.filter(function (f) { return !f.fav; });
    var html = '';
    function group(title, arr) {
      var filtered = arr.filter(function (f) { return type === 'any' || f.type === type; });
      if (!filtered.length) return '';
      html += '<optgroup label="' + title + '">';
      filtered.forEach(function (f) {
        html += '<option value="' + Render.escapeHtml(f.name) + '"' +
          (f.name === selected ? ' selected' : '') + '>' + Render.escapeHtml(f.name) + '</option>';
      });
      html += '</optgroup>';
    }
    group('★ 收藏', favs);
    group(type === 'en' ? '西文字体' : (type === 'cn' ? '中文字体' : '全部字体'), rest);
    // 当前值不在库中时补一个选项，避免被重置
    if (selected && !list.some(function (f) { return f.name === selected; })) {
      html = '<option value="' + Render.escapeHtml(selected) + '" selected>' + Render.escapeHtml(selected) + '</option>' + html;
    }
    return html;
  }

  function refreshFontSelects() {
    $$('[data-font-select]').forEach(function (sel) {
      var cur = getPath(state.params, sel.dataset.param) || sel.value;
      sel.innerHTML = fontOptions(sel.dataset.fontSelect, cur);
    });
  }

  function renderFontLibrary() {
    var list = Store.loadFontLibrary();
    $('#tagFontCount').textContent = list.length + ' 款';
    var sorted = list.slice().sort(function (a, b) {
      return (b.fav ? 1 : 0) - (a.fav ? 1 : 0);
    });
    $('#fontList').innerHTML = sorted.map(function (f) {
      return '<div class="font-row">' +
        '<span class="fav' + (f.fav ? ' on' : '') + '" data-fav="' + Render.escapeHtml(f.name) + '" title="收藏/取消收藏">★</span>' +
        '<span class="fn" style="font-family:\'' + Render.escapeHtml(f.name) + '\',sans-serif">' + Render.escapeHtml(f.name) + '</span>' +
        '<span class="ft">' + (f.type === 'en' ? '西文' : '中文') + '</span>' +
        '<span class="del" data-del="' + Render.escapeHtml(f.name) + '" title="从本机列表删除">✕</span>' +
        '</div>';
    }).join('');
  }

  /* ============================== 模板 ============================== */
  function renderTemplates() {
    $('#tplGrid').innerHTML = DFT.TEMPLATES.map(function (t) {
      return '<button class="tpl" data-tpl="' + t.id + '"><b>' + t.name + '</b><small>' + t.desc + '</small></button>';
    }).join('');
    var users = Store.loadUserTemplates();
    $('#tplUserList').innerHTML = users.length
      ? users.map(function (t) {
          return '<span class="chip" data-usertpl="' + t.id + '">' + Render.escapeHtml(t.name) +
            ' <i data-deltpl="' + t.id + '" style="font-style:normal;color:#8b98a9">✕</i></span>';
        }).join('')
      : '<span class="note">暂无自定义模板。调好参数后可在上方输入名称保存。</span>';
  }

  function applyTemplate(paramsPatch, label) {
    state.params = Store.merge(state.params, paramsPatch);
    Store.saveParams(state.params);
    applyParams(state.params);
    pushHistory(state.params);
    toast('已套用模板：' + label, 'ok');
    runProcess(true);
  }

  /* ============================== 文件导入 ============================== */
  function addFileList(list) {
    var files = Array.prototype.slice.call(list || []);
    if (!files.length) return;
    importFiles(files);
  }

  async function importFiles(files) {
    if (state.busy) return toast('正在处理中，请稍候…');
    state.busy = true;
    setProgress(0, '准备导入…');
    var total = files.length;
    for (var i = 0; i < total; i++) {
      var f = files[i];
      var pct = Math.round((i / total) * 100);
      setProgress(pct, '正在读取：' + f.name + '（' + (i + 1) + '/' + total + '）');
      try {
        var buf = await f.arrayBuffer();
        var kind = Legacy.detect(buf);
        var doc;
        if (kind === 'docx') doc = await O.open(buf, f.name);
        else doc = await Legacy.convert(buf, f.name);
        doc.size = f.size;
        var st = doc.stats || {};
        var fobj = {
          id: 'f' + Date.now() + '_' + i,
          name: f.name,
          size: f.size,
          doc: doc,
          status: '已导入',
          blob: null,
          report: null,
          findings: null,
          kind: kind,
          imageOnly: !!st.imageOnly,
          manualPages: [],     // 手动勾选"不整改"的页
          manualParas: [],     // 手动点选"不整改"的段落
          pages: null          // 扫描出的页面清单
        };
        if (st.imageOnly) fobj.status = '⚠ 内容是图片';
        state.files.push(fobj);
        if (doc.convertNote) toast(doc.convertNote, null, 3600);
      } catch (e) {
        console.error(e);
        toast('导入失败：' + f.name + ' — ' + e.message, 'err', 4200);
      }
      await sleep(10);
    }
    setProgress(null);
    state.busy = false;
    if (!state.activeId && state.files.length) state.activeId = state.files[0].id;
    renderFileUI();
    updateButtons();
    if (state.files.length) {
      refreshSectionRules();
      scanPages(true);
      renderOriginalPreview();
      toast('已导入 ' + state.files.length + ' 个文件，点击“一键整改”开始', 'ok');
    }
    updateImageOnlyHint();
  }

  /** 图片版文档提示：内容全是图片时，如实告知，避免"整改完发现没用" */
  function updateImageOnlyHint() {
    var hint = $('#importHint');
    if (!hint) return;
    var bad = state.files.filter(function (f) { return f.imageOnly; });
    var partial = state.files.filter(function (f) {
      return !f.imageOnly && f.doc && f.doc.stats && f.doc.stats.characters > 0 &&
             f.doc.stats.drawings > 0 && f.doc.stats.characters < 200;
    });
    if (!bad.length && !partial.length) { hint.innerHTML = ''; return; }
    var html = '';
    if (bad.length) {
      html += '⚠ <b>检测到 ' + bad.length + ' 个文件的内容是图片（扫描件 / 截图），里面没有可编辑文字</b>：' +
        '这类文档的文字是"画"在图上的，任何排版工具都改不了其中的文字 —— 导出的文件当然还是图片。<br>' +
        '请先做 OCR 转成可编辑文字再整改：Word「图片转文字」/ WPS「PDF、图片转文字」/ 微信长按图片「提取文字」/ ABBYY 等。<br>' +
        '受影响：' + bad.map(function (f) { return Render.escapeHtml(f.name); }).join('、');
    }
    if (partial.length) {
      if (html) html += '<br>';
      html += 'ℹ 这些文件文字很少但图片较多（可能是图文混排或部分扫描页）：' +
        partial.map(function (f) { return Render.escapeHtml(f.name); }).join('、');
    }
    hint.innerHTML = html;
  }

  function renderFileUI() {
    // 左侧列表
    $('#fileList').innerHTML = state.files.map(function (f) {
      return '<div class="file-item' + (f.id === state.activeId ? ' active' : '') + '" data-fid="' + f.id + '">' +
        '<span class="file-name" title="' + Render.escapeHtml(f.name) + '">' + Render.escapeHtml(f.name) + '</span>' +
        '<span class="file-meta">' + fmtSize(f.size) + ' · ' + f.status + '</span>' +
        '<button class="file-x" data-remove="' + f.id + '" title="移除">✕</button></div>';
    }).join('');
    $('#tagImport').textContent = state.files.length ? state.files.length + ' 个文件' : '未选择';
    // 预览区顶部标签
    $('#fileBar').innerHTML = state.files.map(function (f) {
      var cls = f.id === state.activeId ? 'active' : '';
      if (f.status === '整改完成') cls += ' done';
      if (f.status === '失败') cls += ' err';
      return '<button class="ftab ' + cls + '" data-fid="' + f.id + '"><i class="dot"></i>' +
        Render.escapeHtml(f.name) + '</button>';
    }).join('');
  }

  function activeFile() {
    return state.files.filter(function (f) { return f.id === state.activeId; })[0] || null;
  }

  /** 切换当前文件后：刷新文件区、页面清单、预览 */
  function afterActiveChange() {
    var f = activeFile();
    if (f && !f.pages) scanPages(true); else renderPageList();
    refreshSectionRules();
    renderFileUI();
    reRenderAll();
    updateManualCount();
  }

  function updateButtons() {
    var has = state.files.length > 0;
    ['#btnRun', '#btnDetect', '#btnAutoFix'].forEach(function (s) { $(s).disabled = !has; });
    var done = state.files.some(function (f) { return !!f.blob; });
    $('#btnExportDocx').disabled = !done;
    $('#btnExportPdf').disabled = !done;
  }

  /* ========================= 表格模板 / 分节规则 / 范围高亮 ========================= */
  function renderTableTemplates() {
    var host = document.getElementById('tblTplGrid');
    if (!host) return;
    host.innerHTML = DFT.TABLE_TEMPLATES.map(function (t) {
      return '<button class="tpl" data-tbltpl="' + t.id + '"><b>' + t.name + '</b><small>' + t.desc + '</small></button>';
    }).join('');
  }

  /** 扫描文档分节，生成"分节差异化整改"的规则表 */
  function refreshSectionRules() {
    var host = document.getElementById('sectionRules');
    if (!host) return;
    var f = activeFile();
    var btn = document.getElementById('btnScanSections');
    if (btn) btn.disabled = !f;
    if (!f) {
      document.getElementById('secCount').textContent = '-';
      host.innerHTML = '<span class="note">导入文档后可扫描分节。</span>';
      return;
    }
    var plan = Engine._internals.buildRangePlan(f.doc.xml, state.params, f.doc);
    document.getElementById('secCount').textContent = plan.sections;
    var rules = (state.params.range && state.params.range.sectionRules) || {};
    var html = '';
    for (var i = 1; i <= plan.sections; i++) {
      var cur = rules[i] || {};
      var val = (cur.enabled === false) ? '__off' : (cur.templateId || '');
      html += '<div class="row"><span class="sec-tag" style="min-width:58px">第 ' + i + ' 节</span>' +
        '<select class="input" data-secrule="' + i + '">' +
        '<option value="">跟随全局参数</option>' +
        '<option value="__off"' + (val === '__off' ? ' selected' : '') + '>整节不整改</option>' +
        DFT.TEMPLATES.map(function (t) {
          return '<option value="' + t.id + '"' + (val === t.id ? ' selected' : '') + '>套用：' + t.name + '</option>';
        }).join('') +
        '</select></div>';
    }
    host.innerHTML = html || '<span class="note">未检测到分节信息。</span>';
  }

  /** 计算"不会被整改"的段落集合，供预览高亮 */
  function rangeHighlight(f, params) {
    if (!f) return null;
    var p = params || paramsForFile(f);
    if (!p.range || p.range.highlight === false) return null;
    try {
      var plan = Engine._internals.buildRangePlan(f.doc.xml, p, f.doc);
      if (!plan.skip.size) return null;
      return { set: plan.skip, reason: function (x) { return plan.reasonOf.get(x) || ''; }, count: plan.skip.size };
    } catch (e) { return null; }
  }

  /** 每个文件独立的参数（注入该文件自己的手动标记：页面 / 段落） */
  function paramsForFile(f) {
    var p = Store.clone(state.params);
    if (!p.range) p.range = Store.clone(DFT.DEFAULT_PARAMS.range);
    p.range.manualPages = (f && f.manualPages) ? f.manualPages.slice() : [];
    p.range.manualParas = (f && f.manualParas) ? f.manualParas.slice() : [];
    return p;
  }

  /** 段落序号表（与引擎的文档顺序一致），供预览点选标记使用 */
  function paraIndexMapOf(doc) {
    if (!doc._paraIndexMap) {
      var m = new Map();
      var all = doc.xml.getElementsByTagNameNS(O.NS.w, 'p');
      for (var i = 0; i < all.length; i++) m.set(all[i], i);
      doc._paraIndexMap = m;
    }
    return doc._paraIndexMap;
  }

  /* ---------- 手动标记：页面清单 ---------- */
  function scanPages(silent) {
    var f = activeFile();
    if (!f) { if (!silent) toast('请先导入文档', 'err'); return; }
    f.pages = Engine._internals.pageSummary(f.doc.xml);
    renderPageList();
    if (!silent) toast('共 ' + f.pages.length + ' 页，勾选不需要整改的页即可', 'ok');
  }

  function renderPageList() {
    var host = document.getElementById('pageList');
    if (!host) return;
    var f = activeFile();
    if (!f) {
      host.innerHTML = '<span class="note">导入文档后点「扫描页面」列出全部页面。</span>';
      updateManualCount();
      return;
    }
    if (!f.pages) {
      host.innerHTML = '<span class="note">点「扫描页面」列出全部页面，再勾选不需要整改的页。</span>';
      updateManualCount();
      return;
    }
    var marks = f.manualPages || [];
    host.innerHTML = f.pages.map(function (pg) {
      var on = marks.indexOf(pg.page) >= 0;
      return '<label class="page-row' + (on ? ' protected' : '') + '" data-page="' + pg.page + '">' +
        '<input type="checkbox"' + (on ? ' checked' : '') + '>' +
        '<span class="pg-no">第 ' + pg.page + ' 页</span>' +
        '<span class="pg-sum">' + Render.escapeHtml(pg.summary || '（空白页）') + '</span>' +
        '<span class="pg-tag">' + (pg.blank ? '空白' : pg.count + ' 段') + '</span>' +
        '</label>';
    }).join('');
    updateManualCount();
  }

  function updateManualCount() {
    var f = activeFile();
    var n = f ? (f.manualPages || []).length : 0;
    var m = f ? (f.manualParas || []).length : 0;
    var el = document.getElementById('manualCount');
    if (el) el.textContent = (n || m) ? ('已标记 ' + n + ' 页 / ' + m + ' 段') : '未标记';
    var hint = document.getElementById('markHint');
    if (hint) hint.textContent = state.markMode ? ('点选中：已标记 ' + m + ' 段') : '';
  }

  /* ============================== 预览渲染 ============================== */
  function pageStyleCss(page, zoom) {
    return 'width:' + page.w + 'cm;min-height:' + page.h + 'cm;' +
      'padding:' + page.top + 'cm ' + page.right + 'cm ' + page.bottom + 'cm ' + page.left + 'cm;' +
      (zoom && zoom !== 1 ? 'zoom:' + zoom + ';' : '');
  }

  function renderOriginalPreview() {
    var f = activeFile();
    var host = $('#hostOriginal');
    if (!f) { host.innerHTML = '<div class="empty-state">导入文档后在此显示原文档</div>'; return; }
    try {
      var styleMap = Render.buildStyleMap(f.doc.stylesRaw);
      f.doc.styleMap = styleMap;
      var pp = paramsForFile(f);
      var hl = rangeHighlight(f, pp);
      var legend = $('#skipLegend');
      if (legend) {
        legend.hidden = !hl;
        if (hl) legend.innerHTML = '<i></i>黄色斜纹区域（' + hl.count + ' 段）本次不会被整改';
      }
      var res = Render.render(f.doc, f.doc.xml, {
        styleMap: styleMap,
        skipSet: hl ? hl.set : null,
        skipReason: hl ? hl.reason : null,
        paraIndexMap: paraIndexMapOf(f.doc)
      });
      host.innerHTML = '<div class="page" style="' + pageStyleCss(res.page, state.zoom) + '">' + res.html + '</div>';
    } catch (e) {
      console.error(e);
      host.innerHTML = '<div class="empty-state">原文档预览失败：' + Render.escapeHtml(e.message) + '</div>';
    }
  }

  function renderFixedPreview() {
    var f = activeFile();
    var host = $('#hostFixed');
    if (!f || !f.resultXml) {
      host.innerHTML = '<div class="empty-state">点击“一键整改”后在此显示整改结果</div>';
      return;
    }
    try {
      var doc = O.parseXml(f.resultXml);
      var res = Render.render(f.doc, doc, { styleMap: f.doc.styleMap || Render.buildStyleMap(f.doc.stylesRaw) });
      host.innerHTML = '<div class="page" style="' + pageStyleCss(res.page, state.zoom) + '">' + res.html + '</div>';
      var r = f.report || {};
      $('#fixedHint').textContent = '标题 ' + (r.headings || 0) + ' · 题注 ' + (r.captions || 0) +
        ' · 标点 ' + (r.punctFixed || 0) + ' · 空格 ' + (r.spacesFixed || 0) +
        ' · 删空行 ' + (r.emptyRemoved || 0) + ' · 拆分数字 ' + (r.runsSplit || 0) +
        (r.scripts ? ' · 角标 ' + r.scripts : '') +
        (r.tableParas ? ' · 表格段 ' + r.tableParas : '') +
        (r.skippedParas ? ' · 保护跳过 ' + r.skippedParas : '');
    } catch (e) {
      console.error(e);
      host.innerHTML = '<div class="empty-state">预览失败：' + Render.escapeHtml(e.message) + '</div>';
    }
  }

  function reRenderAll() {
    renderOriginalPreview();
    renderFixedPreview();
  }

  /* ============================== 一键整改 ============================== */
  async function runProcess(silent) {
    if (state.busy || !state.files.length) return;
    state.busy = true;
    var params = state.params = collectParams();
    Store.saveParams(params);
    var t0 = Date.now();
    setProgress(0, '开始整改…');
    try {
      for (var i = 0; i < state.files.length; i++) {
        var f = state.files[i];
        f.status = '整改中';
        renderFileUI();
        var base = Math.round((i / state.files.length) * 100);
        var res = await Engine.process(f.doc, paramsForFile(f), function (pct, msg) {
          setProgress(base + Math.round(pct / state.files.length), '[' + f.name + '] ' + msg);
          $('#progressText').textContent = '[' + f.name + '] ' + msg;
        });
        f.blob = res.blob;
        f.resultXml = res.xml;
        f.report = res.report;
        f.status = '整改完成';
        f.stale = false;
        await sleep(5);
      }
      setProgress(null);
      reRenderAll();
      if (!silent) {
        var total = state.files.reduce(function (a, f) { return a + (f.report.punctFixed + f.report.spacesFixed + f.report.emptyRemoved); }, 0);
        toast('整改完成，共处理 ' + total + ' 处，用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + ' 秒', 'ok', 3200);
      }
    } catch (e) {
      console.error(e);
      setProgress(null);
      toast('整改失败：' + e.message, 'err', 5000);
    } finally {
      state.busy = false;
      renderFileUI();
      updateButtons();
    }
  }

  /* ============================== 问题检测 ============================== */
  function detectIssues() {
    var f = activeFile();
    if (!f) return;
    var res = Engine.analyze(f.doc, state.params);
    f.findings = res.findings;
    f.stats = res.stats;
    renderIssues(res.findings, res.stats);
    var n = res.findings.filter(function (x) { return x.id !== 'ok'; }).length;
    toast(n ? '检测到 ' + n + ' 类排版问题' : '未发现明显问题', n ? null : 'ok');
  }

  function renderIssues(findings, stats) {
    var s = stats || {};
    $('#issuesSum').textContent = findings.filter(function (x) { return x.id !== 'ok'; }).length + ' 类问题 · ' +
      '段落 ' + (s.paragraphs || 0) + ' · 标题 ' + (s.headings || 0) + ' · 图片 ' + (s.images || 0) +
      ' · 题注 ' + (s.captions || 0) + ' · 字体 ' + ((s.fontList || []).length) + ' 种';
    $('#issuesBody').innerHTML = findings.map(function (x) {
      return '<div class="issue ' + (x.level || 'info') + '">' +
        '<div class="issue-head">' +
        '<span class="issue-title">' + Render.escapeHtml(x.title) + '</span>' +
        (x.count ? '<span class="issue-count">' + x.count + '</span>' : '') +
        '<span class="issue-cat">' + Render.escapeHtml(x.category) + '</span>' +
        (x.fix ? '<button class="btn btn-mini issue-more" data-fix="' + x.id + '">修复此项</button>' : '') +
        '</div>' +
        '<div class="issue-detail">' + Render.escapeHtml(x.detail) + '</div>' +
        (x.samples && x.samples.length ? '<div class="issue-samples">示例：' + x.samples.map(Render.escapeHtml).join(' ｜ ') + '</div>' : '') +
        '</div>';
    }).join('');
    $('#issuesPanel').classList.remove('collapsed');
  }

  function applyFixes(findingIds) {
    var f = activeFile();
    if (!f || !f.findings) return detectIssues();
    var touched = 0;
    f.findings.forEach(function (x) {
      if (!x.fix) return;
      if (findingIds && findingIds.indexOf(x.id) < 0) return;
      Object.keys(x.fix).forEach(function (path) {
        setPath(state.params, path, x.fix[path]);
        touched++;
      });
    });
    Store.saveParams(state.params);
    applyParams(state.params);
    pushHistory(state.params);
    return touched;
  }

  /* ============================== 导出 ============================== */
  function exportDocx() {
    var done = state.files.filter(function (f) { return f.blob; });
    if (!done.length) return toast('请先执行“一键整改”', 'err');
    if (done.length === 1) {
      download(done[0].blob, basename(done[0].name) + '_已整改.docx');
      toast('已导出：' + basename(done[0].name) + '_已整改.docx', 'ok');
      return;
    }
    toast('正在打包 ' + done.length + ' 个文件…');
    var zip = new JSZip();
    var jobs = done.map(function (f) {
      return f.blob.arrayBuffer().then(function (b) {
        zip.file(basename(f.name) + '_已整改.docx', b);
      });
    });
    Promise.all(jobs).then(function () {
      return zip.generateAsync({ type: 'blob', compression: 'STORE' });
    }).then(function (blob) {
      download(blob, '已整改文档_' + done.length + '个.zip');
      toast('已导出压缩包', 'ok');
    }).catch(function (e) { toast('打包失败：' + e.message, 'err'); });
  }

  function exportPdf() {
    var f = activeFile();
    if (!f || !f.blob) return toast('请先执行“一键整改”', 'err');
    var doc = O.parseXml(f.resultXml);
    var res = Render.render(f.doc, doc, { styleMap: f.doc.styleMap || Render.buildStyleMap(f.doc.stylesRaw) });
    var w = window.open('', '_blank');
    if (!w) return toast('浏览器拦截了新窗口，请允许弹出窗口后重试', 'err', 4200);
    var title = basename(f.name) + '_已整改';
    w.document.write(
      '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>' + Render.escapeHtml(title) + '</title>' +
      '<style>' +
      '@page{size:' + res.page.w + 'cm ' + res.page.h + 'cm;margin:0}' +
      'html,body{margin:0;padding:0;background:#fff}' +
      '.page{width:' + res.page.w + 'cm;min-height:' + res.page.h + 'cm;' +
      'padding:' + res.page.top + 'cm ' + res.page.right + 'cm ' + res.page.bottom + 'cm ' + res.page.left + 'cm;' +
      'box-sizing:border-box;color:#000;font-family:"Microsoft YaHei","宋体",serif}' +
      '.page p{margin:0}.page img{max-width:100%}.page table{border-collapse:collapse;width:100%}' +
      '.dft-pic{display:inline-flex;align-items:center;justify-content:center;width:120px;height:40px;background:#f0f2f6;border:1px dashed #b9c2d0;color:#96a0af;font-size:11px}' +
      '.dft-tab{display:inline-block;width:2em}.dft-math{font-family:"Cambria Math",serif;font-style:italic}' +
      'tr,td{-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
      '</style></head><body><div class="page">' + res.html + '</div>' +
      '<script>window.onload=function(){setTimeout(function(){window.print();},350);};<\/script>' +
      '</body></html>');
    w.document.close();
    toast('已打开打印窗口，请在目标打印机中选择“另存为 PDF”', null, 4500);
  }

  /* ============================== 事件绑定 ============================== */

  /* 拖拽与选择文件 */
  function initDropzone() {
    var dz = $('#dropzone'), input = $('#fileInput');
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('over'); });
    });
    dz.addEventListener('drop', function (e) {
      var dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length) addFileList(dt.files);
    });
    dz.addEventListener('click', function () { input.click(); });
    $('#btnPick').addEventListener('click', function (e) { e.stopPropagation(); input.click(); });
    $('#btnUpload').addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () { addFileList(input.files); input.value = ''; });
    // 选择整个文件夹（自动过滤出 Word / RTF / 文本文件）
    var dirInput = $('#dirInput');
    $('#btnPickDir').addEventListener('click', function (e) { e.stopPropagation(); dirInput.click(); });
    dirInput.addEventListener('change', function () {
      var list = Array.prototype.slice.call(this.files).filter(function (f) {
        return /\.(docx?|rtf|txt|html?|htm)$/i.test(f.name) && f.name.indexOf('~$') !== 0;
      });
      if (!list.length) toast('该文件夹中没有可处理的 Word 文档', 'err');
      else addFileList(list);
      this.value = '';
    });
    // 整页拖拽也可用
    document.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.addEventListener('drop', function (e) {
      if (e.target.closest && e.target.closest('#dropzone')) return;
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) addFileList(e.dataTransfer.files);
    });
  }

  /* 所有参数控件 */
  function initParamBindings() {
    var timer = null;
    document.addEventListener('input', function (e) {
      var el = e.target;
      if (!el.dataset || el.dataset.param === undefined) return;
      clearTimeout(timer);
      timer = setTimeout(onParamChange, 320);
    });
    document.addEventListener('change', function (e) {
      var el = e.target;
      if (!el.dataset || el.dataset.param === undefined) return;
      onParamChange();
      pushHistory(state.params);
    });
    // 点击折叠标题上的开关不应触发折叠
    $$('.sec > summary .sw').forEach(function (sw) {
      sw.addEventListener('click', function (e) { e.stopPropagation(); });
    });
  }

  /* 标题层级设置区块（h1/h2/h3 动态生成，便于统一维护） */
  function initHeadingBoxes() {
    var meta = [
      { k: 'h1', name: '一级标题' },
      { k: 'h2', name: '二级标题' },
      { k: 'h3', name: '三级标题（含四级以上）' }
    ];
    var html = meta.map(function (m) {
      var p = 'headings.' + m.k + '.';
      return '<div class="subsec"><div class="sub-title">' + m.name + '</div>' +
        '<label class="field"><span>字体</span><select class="input" data-param="' + p + 'font" data-type="text" data-font-select="cn"></select></label>' +
        '<div class="grid3">' +
        '<label class="field"><span>字号(磅)</span><input class="input" type="number" step="0.5" list="sizeList" data-param="' + p + 'size" data-type="number"></label>' +
        '<label class="field"><span>对齐</span><select class="input" data-param="' + p + 'align" data-type="text">' +
        '<option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label>' +
        '<label class="inline mid"><input type="checkbox" data-param="' + p + 'bold" data-type="bool"> 加粗</label>' +
        '</div>' +
        '<div class="grid3">' +
        '<label class="field"><span>行距方式</span><select class="input" data-param="' + p + 'lineMode" data-type="text">' +
        '<option value="multiple">多倍</option><option value="fixed">固定值</option><option value="atLeast">最小值</option></select></label>' +
        '<label class="field"><span>行距值</span><input class="input" type="number" step="0.05" data-param="' + p + 'lineValue" data-type="number"></label>' +
        '<label class="field"><span>缩进(字符)</span><input class="input" type="number" min="0" max="4" data-param="' + p + 'indentChars" data-type="number"></label>' +
        '</div>' +
        '<div class="grid3">' +
        '<label class="field"><span>段前(磅)</span><input class="input" type="number" min="0" data-param="' + p + 'before" data-type="number"></label>' +
        '<label class="field"><span>段后(磅)</span><input class="input" type="number" min="0" data-param="' + p + 'after" data-type="number"></label>' +
        '<label class="field"><span>颜色</span><input class="input color" type="color" data-param="' + p + 'color" data-type="text"></label>' +
        '</div></div>';
    }).join('');
    $('#headingBoxes').innerHTML = html;
    $('#sizeList').innerHTML = DFT.FONT_SIZES.map(function (s) {
      return '<option value="' + s.value + '">' + s.label + '</option>';
    }).join('');
  }

  function initButtons() {
    $('#btnRun').addEventListener('click', function () { runProcess(false); });
    $('#btnDetect').addEventListener('click', detectIssues);
    $('#btnAutoFix').addEventListener('click', function () {
      var f = activeFile();
      if (!f || !f.findings) { detectIssues(); return; }
      var n = applyFixes(null);
      toast('已按问题清单自动修正 ' + n + ' 项参数并重新整改', 'ok');
      runProcess(true);
    });
    $('#btnExportDocx').addEventListener('click', exportDocx);
    $('#btnExportPdf').addEventListener('click', exportPdf);
    $('#btnUndo').addEventListener('click', undo);
    $('#btnRedo').addEventListener('click', redo);
    $('#btnReset').addEventListener('click', function () {
      if (!confirm('确定要把所有参数恢复为默认设置吗？（自定义模板与字体库会保留）')) return;
      state.params = Store.resetParams();
      applyParams(state.params);
      pushHistory(state.params);
      runProcess(true);
      toast('已重置为默认参数', 'ok');
    });

    /* 模板 */
    $('#tplGrid').addEventListener('click', function (e) {
      var b = e.target.closest('[data-tpl]');
      if (!b) return;
      var t = DFT.TEMPLATES.filter(function (x) { return x.id === b.dataset.tpl; })[0];
      if (t) applyTemplate(t.params, t.name);
    });
    /* 表格模板（只覆盖表格相关参数） */
    var tblGrid = document.getElementById('tblTplGrid');
    if (tblGrid) {
      tblGrid.addEventListener('click', function (e) {
        var b = e.target.closest('[data-tbltpl]');
        if (!b) return;
        var t = DFT.TABLE_TEMPLATES.filter(function (x) { return x.id === b.dataset.tbltpl; })[0];
        if (t) applyTemplate(t.params, '表格模板 · ' + t.name);
      });
    }

    /* 分节差异化整改 */
    var secRules = document.getElementById('sectionRules');
    if (secRules) {
      secRules.addEventListener('change', function (e) {
        var sel = e.target.closest('[data-secrule]');
        if (!sel) return;
        var sec = sel.dataset.secrule;
        var rules = (state.params.range && state.params.range.sectionRules) || {};
        if (sel.value === '__off') rules[sec] = { enabled: false };
        else if (sel.value) rules[sec] = { templateId: sel.value };
        else delete rules[sec];
        if (!state.params.range) state.params.range = Store.clone(DFT.DEFAULT_PARAMS.range);
        state.params.range.sectionRules = rules;
        Store.saveParams(state.params);
        pushHistory(state.params);
        toast('第 ' + sec + ' 节：' + (sel.value === '__off' ? '整节不整改' :
          (sel.value ? '套用模板 ' + sel.options[sel.selectedIndex].text : '跟随全局参数')), 'ok');
        runProcess(true);
      });
    }
    var scanBtn = document.getElementById('btnScanSections');
    if (scanBtn) {
      scanBtn.addEventListener('click', function () {
        refreshSectionRules();
        toast('已重新扫描文档分节', 'ok');
      });
    }

    /* 手动标记：页面清单 + 预览点选 */
    var pageList = document.getElementById('pageList');
    if (pageList) {
      pageList.addEventListener('change', function (e) {
        var row = e.target.closest('[data-page]');
        if (!row || e.target.tagName !== 'INPUT') return;
        var f = activeFile(); if (!f) return;
        var pg = parseInt(row.dataset.page, 10);
        var arr = f.manualPages || [];
        var idx = arr.indexOf(pg);
        if (e.target.checked && idx < 0) arr.push(pg);
        if (!e.target.checked && idx >= 0) arr.splice(idx, 1);
        f.manualPages = arr;
        row.classList.toggle('protected', e.target.checked);
        updateManualCount();
        renderOriginalPreview();
        scheduleAutoRun();
      });
    }
    var btnScan = document.getElementById('btnScanPages');
    if (btnScan) btnScan.addEventListener('click', function () { scanPages(false); });
    var btnAll = document.getElementById('btnAllPages');
    if (btnAll) btnAll.addEventListener('click', function () {
      var f = activeFile(); if (!f) return toast('请先导入文档', 'err');
      if (!f.pages) scanPages(true);
      f.manualPages = (f.pages || []).map(function (p) { return p.page; });
      renderPageList(); renderOriginalPreview(); scheduleAutoRun();
      toast('已把全部 ' + f.manualPages.length + ' 页标记为不整改', 'ok');
    });
    var btnNo = document.getElementById('btnNoPages');
    if (btnNo) btnNo.addEventListener('click', function () {
      var f = activeFile(); if (!f) return;
      f.manualPages = [];
      renderPageList(); renderOriginalPreview(); scheduleAutoRun();
      toast('已取消全部页面标记');
    });
    var btnClear = document.getElementById('btnClearMark');
    if (btnClear) btnClear.addEventListener('click', function () {
      var f = activeFile(); if (!f) return;
      f.manualPages = []; f.manualParas = [];
      renderPageList(); renderOriginalPreview(); scheduleAutoRun();
      toast('已清空全部手动标记', 'ok');
    });
    var markBtn = document.getElementById('btnMarkMode');
    if (markBtn) markBtn.addEventListener('click', function () {
      state.markMode = !state.markMode;
      document.body.classList.toggle('mark-mode', state.markMode);
      markBtn.classList.toggle('on', state.markMode);
      updateManualCount();
      toast(state.markMode
        ? '点选标记已开启：在左侧「原文档预览」里点击段落即可标记 / 取消标记'
        : '已退出点选标记', null, 3200);
    });
    var hostOrig = document.getElementById('hostOriginal');
    if (hostOrig) {
      hostOrig.addEventListener('click', function (e) {
        if (!state.markMode) return;
        var el = e.target.closest('[data-pi]');
        if (!el) return;
        var f = activeFile(); if (!f) return;
        var pi = parseInt(el.dataset.pi, 10);
        if (isNaN(pi)) return;
        var arr = f.manualParas || [];
        var idx = arr.indexOf(pi);
        if (idx >= 0) { arr.splice(idx, 1); toast('已取消该段落的保护标记'); }
        else { arr.push(pi); toast('已标记该段落：本次整改不会改动它', 'ok'); }
        f.manualParas = arr;
        updateManualCount();
        renderOriginalPreview();
        scheduleAutoRun();
        e.preventDefault();
      });
    }

    $('#btnSaveTpl').addEventListener('click', function () {      var name = $('#tplName').value.trim();
      if (!name) return toast('请先输入模板名称', 'err');
      Store.upsertUserTemplate(name, '自定义模板', state.params);
      $('#tplName').value = '';
      renderTemplates();
      toast('模板已保存：' + name, 'ok');
    });
    $('#tplUserList').addEventListener('click', function (e) {
      var del = e.target.closest('[data-deltpl]');
      if (del) {
        if (!confirm('确定删除该自定义模板？')) return;
        Store.removeUserTemplate(del.dataset.deltpl);
        renderTemplates();
        toast('已删除模板');
        return;
      }
      var chip = e.target.closest('[data-usertpl]');
      if (!chip) return;
      var t = Store.loadUserTemplates().filter(function (x) { return x.id === chip.dataset.usertpl; })[0];
      if (t) applyTemplate(t.params, t.name);
    });

    /* 字体库 */
    $('#btnAddFont').addEventListener('click', function () {
      var n = $('#fontName').value.trim();
      if (!n) return toast('请输入字体名称', 'err');
      Store.addFont(n, $('#fontType').value);
      $('#fontName').value = '';
      renderFontLibrary(); refreshFontSelects();
      toast('已添加字体：' + n, 'ok');
    });
    $('#fontList').addEventListener('click', function (e) {
      var fav = e.target.closest('[data-fav]'), del = e.target.closest('[data-del]');
      if (fav) {
        Store.toggleFavFont(fav.dataset.fav);
        renderFontLibrary(); refreshFontSelects();
      } else if (del) {
        if (!confirm('确定从本机字体列表删除“' + del.dataset.del + '”？')) return;
        Store.removeFont(del.dataset.del);
        renderFontLibrary(); refreshFontSelects();
      }
    });
    $('#btnLoadLocalFont').addEventListener('click', function () { $('#localFontFile').click(); });
    $('#localFontFile').addEventListener('change', function () {
      var f = this.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var face = new FontFace(basename(f.name), reader.result);
          face.load().then(function (loaded) {
            document.fonts.add(loaded);
            Store.addFont(basename(f.name), 'cn');
            renderFontLibrary(); refreshFontSelects();
            toast('已加载本地字体用于预览：' + basename(f.name), 'ok');
          }).catch(function (e) { toast('字体加载失败：' + e.message, 'err'); });
        } catch (e) { toast('该浏览器不支持本地字体预览', 'err'); }
      };
      reader.readAsArrayBuffer(f);
      this.value = '';
    });

    /* 文件列表交互 */
    $('#fileList').addEventListener('click', function (e) {
      var rm = e.target.closest('[data-remove]');
      if (rm) {
        state.files = state.files.filter(function (f) { return f.id !== rm.dataset.remove; });
        if (!state.files.some(function (f) { return f.id === state.activeId; })) {
          state.activeId = state.files[0] ? state.files[0].id : null;
        }
        renderFileUI(); updateButtons(); reRenderAll(); afterActiveChange();
        return;
      }
      var item = e.target.closest('[data-fid]');
      if (item) { state.activeId = item.dataset.fid; afterActiveChange(); }
    });
    $('#fileBar').addEventListener('click', function (e) {
      var tab = e.target.closest('[data-fid]');
      if (tab) { state.activeId = tab.dataset.fid; afterActiveChange(); }
    });

    /* 问题清单 */
    $('#issuesBody').addEventListener('click', function (e) {
      var b = e.target.closest('[data-fix]');
      if (!b) return;
      var n = applyFixes([b.dataset.fix]);
      toast('已应用该修复项（' + n + ' 项参数）', 'ok');
      runProcess(true);
    });
    $('#btnToggleIssues').addEventListener('click', function () {
      $('#issuesPanel').classList.toggle('collapsed');
    });
    $('#issuesHead').addEventListener('click', function (e) {
      if (e.target.closest('button')) return;
      $('#issuesPanel').classList.toggle('collapsed');
    });

    /* 视图与缩放 */
    $('#viewSwitch').addEventListener('click', function (e) {
      var b = e.target.closest('[data-view]');
      if (!b) return;
      setView(b.dataset.view);
    });
    $('#zoomSel').addEventListener('change', function () {
      state.zoom = parseFloat(this.value) || 1;
      var ui = Store.loadUI(); ui.zoom = state.zoom; Store.saveUI(ui);
      reRenderAll();
    });

    /* 页边距快捷按钮 */
    document.querySelector('.chips').addEventListener('click', function (e) {
      var c = e.target.closest('[data-margin]');
      if (!c) return;
      var v = c.dataset.margin.split(',').map(parseFloat);
      setPath(state.params, 'page.top', v[0]);
      setPath(state.params, 'page.bottom', v[1]);
      setPath(state.params, 'page.left', v[2]);
      setPath(state.params, 'page.right', v[3]);
      setPath(state.params, 'page.enabled', true);
      applyParams(state.params); Store.saveParams(state.params);
      pushHistory(state.params);
      runProcess(true);
    });

    /* 说明书 / 配置备份 */
    $('#btnHelp').addEventListener('click', function () { $('#helpModal').hidden = false; });
    $('#btnCloseHelp').addEventListener('click', function () { $('#helpModal').hidden = true; });
    $('#helpModal').addEventListener('click', function (e) { if (e.target === this) this.hidden = true; });
    $('#btnExportCfg').addEventListener('click', function () {
      var blob = new Blob([Store.exportAll()], { type: 'application/json' });
      download(blob, '文档整改工具_配置备份.json');
      toast('配置已导出', 'ok');
    });
    $('#btnImportCfg').addEventListener('click', function () { $('#cfgFile').click(); });
    $('#cfgFile').addEventListener('change', function () {
      var f = this.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          Store.importAll(reader.result);
          state.params = Store.loadParams();
          applyParams(state.params);
          renderTemplates(); renderFontLibrary(); refreshFontSelects();
          pushHistory(state.params);
          runProcess(true);
          toast('配置已导入', 'ok');
        } catch (e) { toast('导入失败：' + e.message, 'err'); }
      };
      reader.readAsText(f);
      this.value = '';
    });

    /* 快捷键 */
    document.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      var typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' && !e.shiftKey) { if (!typing) { e.preventDefault(); undo(); } }
        else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { if (!typing) { e.preventDefault(); redo(); } }
        else if (e.key === 'Enter') { e.preventDefault(); runProcess(false); }
      }
    });
  }

  function setView(v) {
    state.view = v;
    document.body.dataset.view = v;
    $$('#viewSwitch .vs-item').forEach(function (b) { b.classList.toggle('active', b.dataset.view === v); });
    var ui = Store.loadUI(); ui.view = v; Store.saveUI(ui);
  }

  /* ============================== 启动 ============================== */
  function boot() {
    initHeadingBoxes();
    renderTemplates();
    renderTableTemplates();
    renderFontLibrary();
    var ui = Store.loadUI();
    state.view = ui.view || 'split';
    state.zoom = ui.zoom || 1;
    $('#zoomSel').value = String(state.zoom);
    // 参数：界面默认展示上次保存的参数
    state.params = Store.loadParams();
    applyParams(state.params);
    refreshFontSelects();
    applyParams(state.params);
    pushHistory(state.params);
    initDropzone();
    initParamBindings();
    initButtons();
    setView(state.view);
    document.body.dataset.view = state.view;
    refreshSectionRules();
    renderPageList();
    updateButtons();
    renderFileUI();
    console.log('%c文档格式批量整改工具 v' + DFT.VERSION + ' 已就绪（纯本地运行）', 'color:#2f6fed;font-weight:bold');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.__DFT_APP__ = {
    state: state, runProcess: runProcess, collectParams: collectParams,
    importFiles: importFiles, detectIssues: detectIssues, applyParams: applyParams,
    renderIssues: renderIssues, activeFile: activeFile
  };
})();
