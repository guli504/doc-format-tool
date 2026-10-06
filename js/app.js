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
    el.innerHTML = msg;                       // 允许 <b>、<br> 做要点排版
    el.className = 'toast' + (type ? ' ' + type : '');
    el.hidden = false;
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(function () {
      el.classList.remove('show');
      el._t2 = setTimeout(function () { el.hidden = true; }, 260);
    }, ms || 2600);
  }

  /** 一键整改的三步进度：解析 → 整改 → 渲染 */
  var RUN_STEPS = ['parse', 'fix', 'render'];
  function setStep(name) {
    var idx = RUN_STEPS.indexOf(name);
    $$('#runSteps .step').forEach(function (el) {
      var i = RUN_STEPS.indexOf(el.dataset.step);
      el.classList.toggle('done', i < idx);
      el.classList.toggle('active', i === idx);
    });
  }
  function finishSteps() {
    $$('#runSteps .step').forEach(function (el) { el.classList.add('done'); el.classList.remove('active'); });
  }
  function clearSteps() {
    $$('#runSteps .step').forEach(function (el) { el.classList.remove('done', 'active'); });
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
      // 颜色控件无法表示"空值"（浏览器会回写成 #000000），所以不能用空值覆盖它
      else if (el.type === 'color' && v === '') return;
      else el.value = v;
    });
  }

  /* 参数变化 → 保存 + 记录历史 + 自动重跑 */
  function onParamChange() {
    state.params = collectParams();
    Store.saveParams(state.params);
    updateSizeNames();
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

  /* -------------------- 字号中文名对照（实时显示） -------------------- */
  function sizeNameText(pt) {
    if (!pt || isNaN(pt)) return '';
    var exact = DFT.FONT_SIZES.filter(function (s) { return Math.abs(s.value - pt) < 0.01; })[0];
    if (exact) return exact.label.split(' ')[0] + '（' + exact.value + ' 磅）';
    var near = null, best = 999;
    DFT.FONT_SIZES.forEach(function (s) {
      var d = Math.abs(s.value - pt);
      if (d < best) { best = d; near = s; }
    });
    if (near && best <= 0.75) return '≈ ' + near.label.split(' ')[0] + '（' + near.value + ' 磅）';
    return '自定义字号';
  }

  function initSizeNames() {
    $$('input[data-param]').forEach(function (el) {
      var path = el.dataset.param || '';
      if (!/(^|\.)size$/.test(path)) return;       // 只给"字号"输入框加
      if (el.dataset.sizeNameBound) return;
      el.dataset.sizeNameBound = '1';
      var tag = document.createElement('span');
      tag.className = 'size-name';
      tag.setAttribute('data-size-name', path);
      if (el.parentNode) el.parentNode.appendChild(tag);
      var update = function () { updateSizeNames(); };
      el.addEventListener('input', update);
      el.addEventListener('change', update);
    });
    updateSizeNames();
  }

  function updateSizeNames() {
    var followEl = document.querySelector('[data-param="table.sizeFollow"]');
    var bodyEl = document.querySelector('[data-param="body.size"]');
    $$('[data-size-name]').forEach(function (tag) {
      var path = tag.getAttribute('data-size-name');
      var el = document.querySelector('[data-param="' + path + '"]');
      if (!el) { tag.textContent = ''; return; }
      // 表格字号勾了"跟随正文"时，直接告诉用户实际会按哪个字号执行
      if (path === 'table.size' && followEl && followEl.checked && bodyEl) {
        tag.textContent = '实际按正文执行：' + sizeNameText(parseFloat(bodyEl.value));
        return;
      }
      if (path === 'digit.table.size') {
        var dFollow = document.querySelector('[data-param="digit.table.independent"]');
        if (dFollow && !dFollow.checked && followEl && followEl.checked && bodyEl) {
          tag.textContent = '实际跟随表格字号：' + sizeNameText(parseFloat(bodyEl.value));
          return;
        }
      }
      if (path.indexOf('digit.') === 0) {
        var ind = document.querySelector('[data-param="' + path.replace(/\.size$/, '.independent') + '"]');
        if (ind && !ind.checked) {
          tag.textContent = '不勾选"独立设置"时按所在正文执行';
          return;
        }
      }
      tag.textContent = sizeNameText(parseFloat(el.value));
    });
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

  /* ============================== 规范知识库 ============================== */
  function renderKnowledge(kw) {
    var K = DFT.KNOWLEDGE, host = $('#kbBody');
    if (!K || !host) return;
    var q = String(kw || '').trim().toLowerCase();
    var totalItems = 0, shown = 0;
    var html = K.categories.map(function (c) {
      var items = c.items.filter(function (it) {
        totalItems++;
        if (!q) return true;
        var hay = (it.text + ' ' + c.name + ' ' + (it.ok || []).join(' ') + ' ' + (it.bad || []).join(' '))
          .replace(/<[^>]+>/g, ' ').toLowerCase();
        if (hay.indexOf(q) >= 0) return true;
        // 允许用"错误写法"里的词反查，例如搜 ul / KD
        return (it.bad || []).some(function (b) { return b.toLowerCase().indexOf(q) >= 0; });
      });
      if (!items.length) return '';
      shown += items.length;
      return '<section class="kb-cat"><h4>' + c.name + '</h4>' +
        '<p class="kb-desc">' + c.desc + '</p>' +
        items.map(function (it) {
          return '<div class="kb-item lv-' + (it.level || 'low') + '">' +
            '<div class="kb-text">' + it.text + '</div>' +
            ((it.ok || []).length ? '<div class="kb-eg ok"><b>正确</b>' +
              it.ok.map(function (x) { return '<code>' + x + '</code>'; }).join('') + '</div>' : '') +
            ((it.bad || []).length ? '<div class="kb-eg bad"><b>错误</b>' +
              it.bad.map(function (x) { return '<code>' + x + '</code>'; }).join('') + '</div>' : '') +
            (it.params ? '<button class="btn btn-mini" data-kb-apply="' +
              encodeURIComponent(JSON.stringify(it.params)) + '">按此规范设置</button>' : '') +
            '</div>';
        }).join('') + '</section>';
    }).join('');
    host.innerHTML = html || '<div class="kb-empty">没有匹配的规范条目，换个关键词试试（如 空格 / 单位 / 温度 / 引用）</div>';
    var st = K.stats();
    $('#kbStat').textContent = q
      ? ('匹配 ' + shown + ' / ' + st.items + ' 条')
      : (st.categories + ' 大类 · ' + st.items + ' 条规范 · ' + st.units + ' 个单位 · ' + st.wrongForms + ' 种错误写法');
  }

  function openKb() {
    var m = $('#kbModal');
    if (!m) return;
    renderKnowledge($('#kbSearch') ? $('#kbSearch').value : '');
    m.hidden = false;
  }

  /** 把知识库里某条规范推荐的参数写进设置 */
  function applyKbParams(json) {
    var obj;
    try { obj = JSON.parse(decodeURIComponent(json)); } catch (e) { return 0; }
    var n = 0;
    Object.keys(obj).forEach(function (path) {
      setPath(state.params, path, obj[path]);
      n++;
    });
    applyParams(state.params);
    Store.saveParams(state.params);
    pushHistory(state.params);
    updateSizeNames();
    runProcess(true);
    return n;
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
    clearSteps();
    setStep('parse');
    try {
      for (var i = 0; i < state.files.length; i++) {
        var f = state.files[i];
        f.status = '整改中';
        renderFileUI();
        var base = Math.round((i / state.files.length) * 100);
        var res = await Engine.process(f.doc, paramsForFile(f), function (pct, msg) {
          if (/解析|读取|解压/.test(msg)) setStep('parse');
          else if (/打包|写入|输出|生成|压缩/.test(msg)) setStep('render');
          else setStep('fix');
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
      finishSteps();
      setProgress(null);
      reRenderAll();
      if (!silent) {
        // 汇总"本次修改了 N 处"，让结果可核对
        var acc = state.files.reduce(function (a, f) {
          var q = f.report || {};
          a.punct += q.punctFixed || 0;
          a.spaces += q.spacesFixed || 0;
          a.empty += q.emptyRemoved || 0;
          a.runs += q.runsSplit || 0;
          a.head += q.headings || 0;
          a.tbl += q.tablesStyled || 0;
          a.script += q.scripts || 0;
          return a;
        }, { punct: 0, spaces: 0, empty: 0, runs: 0, head: 0, tbl: 0, script: 0 });
        var total = acc.punct + acc.spaces + acc.empty + acc.runs;
        toast('<b>✓ 整改完成 · 本次修改了 ' + total + ' 处</b><br>' +
          '标点 ' + acc.punct + ' · 空格 ' + acc.spaces + ' · 空行 ' + acc.empty + ' · 文字块调整 ' + acc.runs +
          '<br>标题 ' + acc.head + ' · 表格 ' + acc.tbl + ' · 角标 ' + acc.script +
          ' · 用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + ' 秒', 'ok', 5600);
      }
    } catch (e) {
      console.error(e);
      clearSteps();
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
      var first = (x.samples && x.samples.length) ? String(x.samples[0]) : '';
      return '<div class="issue ' + (x.level || 'info') + '"' +
        (first ? ' data-locate="' + encodeURIComponent(first) + '" title="点击可在预览中定位"' : '') + '>' +
        '<div class="issue-head">' +
        '<span class="issue-title">' + Render.escapeHtml(x.title) + '</span>' +
        (x.count ? '<span class="issue-count">' + x.count + '</span>' : '') +
        '<span class="issue-cat">' + Render.escapeHtml(x.category) + '</span>' +
        (x.fix ? '<button class="btn btn-mini issue-more" data-fix="' + x.id + '">修复此项</button>' : '') +
        '</div>' +
        '<div class="issue-detail">' + Render.escapeHtml(x.detail) + '</div>' +
        (x.samples && x.samples.length ? '<div class="issue-samples">示例：' + x.samples.map(Render.escapeHtml).join(' ｜ ') +
          (first ? ' <span style="color:var(--brand)">（点击定位）</span>' : '') + '</div>' : '') +
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
      return '<option value="' + s.value + '">' + s.label.replace(' ', ' = ') + ' 磅</option>';
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
      if (b) {
        var n = applyFixes([b.dataset.fix]);
        toast('已应用该修复项（' + n + ' 项参数）', 'ok');
        runProcess(true);
        return;
      }
      // 点击问题条目 → 在预览里定位到对应内容
      var item = e.target.closest('[data-locate]');
      if (!item) return;
      var ok = locateInPreview(decodeURIComponent(item.dataset.locate || ''));
      if (!ok) toast('预览里没找到这段内容（可能被其他设置改写了）', null, 2600);
    });
    $('#btnToggleIssues').addEventListener('click', function () {
      $('#issuesPanel').classList.toggle('collapsed');
    });

    /* 规范知识库 */
    var openers = [$('#btnKb'), $('#btnKbOpen')];
    openers.forEach(function (b) { if (b) b.addEventListener('click', openKb); });
    var closeKb = $('#btnCloseKb');
    if (closeKb) closeKb.addEventListener('click', function () { $('#kbModal').hidden = true; });
    var kbModal = $('#kbModal');
    if (kbModal) {
      kbModal.addEventListener('click', function (e) {
        if (e.target === kbModal) kbModal.hidden = true;    // 点遮罩关闭
      });
    }
    var kbSearch = $('#kbSearch');
    if (kbSearch) {
      var kbTimer = null;
      kbSearch.addEventListener('input', function () {
        clearTimeout(kbTimer);
        var v = this.value;
        kbTimer = setTimeout(function () { renderKnowledge(v); }, 120);
      });
    }
    var kbBody = $('#kbBody');
    if (kbBody) {
      kbBody.addEventListener('click', function (e) {
        var b = e.target.closest('[data-kb-apply]');
        if (!b) return;
        var n = applyKbParams(b.dataset.kbApply);
        toast('已按该规范设置 ' + n + ' 项参数', 'ok');
      });
    }
    var kbEnable = $('#btnKbEnable');
    if (kbEnable) {
      kbEnable.addEventListener('click', function () {
        setPath(state.params, 'unit.enabled', true);
        ['fixSpelling', 'spaceNumber', 'tightPercent', 'mathSpace', 'timesSign',
         'slashTight', 'halfWidth', 'abbrSpace'].forEach(function (k) {
          setPath(state.params, 'unit.' + k, true);
        });
        applyParams(state.params);
        Store.saveParams(state.params);
        pushHistory(state.params);
        runProcess(state.files.length > 0);
        toast('已启用「数字与单位规范」，导入文档后点一键整改即可', 'ok', 3200);
      });
    }    $('#issuesHead').addEventListener('click', function (e) {
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
  /* ====================== 界面外壳：面板 / 分类 / 分割线 ====================== */
  function isNarrow() { return window.innerWidth <= 1180; }

  /** 面板显隐：宽屏是"收起左栏"，窄屏是"抽屉开关" */
  function setSideVisible(on, save) {
    if (isNarrow()) {
      document.body.classList.toggle('side-open', !!on);
      document.body.classList.remove('side-collapsed');
    } else {
      document.body.classList.toggle('side-collapsed', !on);
      document.body.classList.remove('side-open');
    }
    if (save !== false) {
      var ui = Store.loadUI(); ui.sideOpen = !!on; Store.saveUI(ui);
    }
  }

  /** 点击问题清单时，在预览里滚动并高亮对应段落。
   *  问题样本可能是被截断并加了省略号的，所以依次用"全文 → 逐步缩短的前缀"去匹配。 */
  function locateInPreview(text) {
    var raw = String(text || '').replace(/[…]+$/, '').replace(/[.．]{3}$/, '').trim();
    var base = raw.replace(/\s+/g, '');
    if (base.length < 2) return false;
    var tries = [base];
    [0.75, 0.55, 0.35, 0.2].forEach(function (r) {
      var n = Math.max(4, Math.floor(base.length * r));
      var s = base.slice(0, n);
      if (tries.indexOf(s) < 0) tries.push(s);
    });
    var hosts = [$('#hostOriginal'), $('#hostFixed')];
    for (var t = 0; t < tries.length; t++) {
      for (var i = 0; i < hosts.length; i++) {
        var host = hosts[i];
        if (!host || host.offsetParent === null) continue;   // 隐藏的窗格跳过
        var nodes = host.querySelectorAll('p, td, th, li');
        for (var j = 0; j < nodes.length; j++) {
          var el = nodes[j];
          if (el.textContent.replace(/\s+/g, '').indexOf(tries[t]) < 0) continue;
          try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
          catch (err) { el.scrollIntoView(); }
          el.classList.remove('locate-flash');
          void el.offsetWidth;
          el.classList.add('locate-flash');
          (function (node) {
            setTimeout(function () { node.classList.remove('locate-flash'); }, 2500);
          })(el);
          return true;
        }
      }
    }
    return false;
  }

  function initChrome() {
    var ui = Store.loadUI();

    // ① 左侧面板显隐（窄屏自动变抽屉）
    setSideVisible(isNarrow() ? false : (ui.sideOpen !== false), false);
    var tg = $('#btnSideToggle');
    if (tg) {
      tg.addEventListener('click', function () {
        var open = isNarrow() ? document.body.classList.contains('side-open')
                              : !document.body.classList.contains('side-collapsed');
        setSideVisible(!open);
      });
    }
    var mask = $('#drawerMask');
    if (mask) mask.addEventListener('click', function () { setSideVisible(false); });

    // ② 分类快捷筛选
    var side = document.querySelector('.side');
    var bar = $('#catBar');
    if (bar && side) {
      var applyCat = function (cat) {
        side.dataset.filter = cat || 'all';
        $$('#catBar .cat-chip').forEach(function (c) {
          c.classList.toggle('active', c.dataset.cat === side.dataset.filter);
        });
        var u = Store.loadUI(); u.cat = side.dataset.filter; Store.saveUI(u);
      };
      bar.addEventListener('click', function (e) {
        var c = e.target.closest('.cat-chip');
        if (!c) return;
        applyCat(c.dataset.cat);
        // 切到某分类时，把它下面的卡片展开，省一次点击
        if (c.dataset.cat !== 'all') {
          $$('.sec[data-cat="' + c.dataset.cat + '"]').forEach(function (d) { d.open = true; });
        }
        $('.side-scroll').scrollTop = 0;
      });
      applyCat(ui.cat || 'all');
    }

    // ③ 左右分割线拖动（分屏对比时）
    var sp = $('#splitter'), pv = $('#previewBody');
    if (sp && pv) {
      var ratio = (typeof ui.split === 'number' && ui.split > 0) ? ui.split : 50;
      var setRatio = function (v, save) {
        ratio = Math.max(18, Math.min(82, v));
        pv.style.setProperty('--split', ratio + '%');
        if (save) { var u = Store.loadUI(); u.split = Math.round(ratio); Store.saveUI(u); }
      };
      setRatio(ratio, false);
      var dragging = false;
      var onMove = function (e) {
        if (!dragging) return;
        var rect = pv.getBoundingClientRect();
        var x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
        setRatio((x / rect.width) * 100, false);
      };
      var onUp = function () {
        if (!dragging) return;
        dragging = false;
        sp.classList.remove('dragging');
        document.body.style.userSelect = '';
        setRatio(ratio, true);
      };
      sp.addEventListener('mousedown', function (e) {
        if (state.view !== 'split') return;
        dragging = true; sp.classList.add('dragging');
        document.body.style.userSelect = 'none';
        e.preventDefault();
      });
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      sp.addEventListener('touchstart', function () { dragging = true; sp.classList.add('dragging'); }, { passive: true });
      document.addEventListener('touchmove', onMove, { passive: true });
      document.addEventListener('touchend', onUp);
      sp.addEventListener('dblclick', function () { setRatio(50, true); });
    }

    // ④ 窗口尺寸变化：宽屏恢复固定侧栏，窄屏收起抽屉
    var rt = null;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () {
        if (!isNarrow()) document.body.classList.remove('side-open');
      }, 150);
    });
  }

  function boot() {
    initHeadingBoxes();
    renderTemplates();
    renderTableTemplates();
    renderFontLibrary();
    var vb = document.getElementById('verBadge');
    if (vb) { vb.textContent = 'v' + DFT.VERSION; }
    var ui = Store.loadUI();
    state.view = ui.view || 'split';
    state.zoom = ui.zoom || 1;
    $('#zoomSel').value = String(state.zoom);
    // 参数：界面默认展示上次保存的参数
    state.params = Store.loadParams();
    applyParams(state.params);
    refreshFontSelects();
    applyParams(state.params);
    initSizeNames();
    pushHistory(state.params);
    initDropzone();
    initParamBindings();
    initButtons();
    setView(state.view);
    document.body.dataset.view = state.view;
    initChrome();
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
