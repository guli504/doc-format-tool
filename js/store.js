/* =============================================================================
 * 文档格式批量整改工具 —— 本地存储 (store.js)
 * 说明：所有配置（参数、模板、字体库、界面偏好）仅保存在浏览器 localStorage，
 *       不上传任何服务器。
 * 依赖：constants.js
 * ========================================================================== */
(function (global) {
  'use strict';

  var KEY = 'dft.v1.';

  /* ---------------------------- 深拷贝 / 深合并 ---------------------------- */
  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /** 将 src 合并到 dst（只覆盖 src 中真实存在的字段），返回新对象 */
  function merge(dst, src) {
    var out = clone(dst);
    Object.keys(src || {}).forEach(function (k) {
      var sv = src[k];
      if (sv && typeof sv === 'object' && !Array.isArray(sv)) {
        out[k] = merge(out[k] && typeof out[k] === 'object' ? out[k] : {}, sv);
      } else if (sv !== undefined) {
        out[k] = sv;
      }
    });
    return out;
  }

  /* ------------------------------- 基础读写 ------------------------------- */
  function read(k, def) {
    try {
      var raw = global.localStorage.getItem(KEY + k);
      if (raw === null || raw === undefined) return def;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('[store] 读取失败', k, e);
      return def;
    }
  }

  function write(k, v) {
    try {
      global.localStorage.setItem(KEY + k, JSON.stringify(v));
      return true;
    } catch (e) {
      console.warn('[store] 写入失败（可能已超出配额）', k, e);
      return false;
    }
  }

  function remove(k) {
    try { global.localStorage.removeItem(KEY + k); } catch (e) {}
  }

  /* ------------------------------- 参数存取 ------------------------------- */
  /* 参数结构版本：升级时做一次性迁移。
     v2 迁移的原因：早期版本把"空颜色"经 <input type="color"> 回写成了 #000000，
     导致只要打开表格格式开关就会把单元格刷成黑色。这里把这类残留值清理掉。 */
  var PARAMS_VERSION = 2;

  function loadParams() {
    var saved = read('params', {}) || {};
    var ver = read('paramsVersion', 1);
    if (!(ver >= PARAMS_VERSION)) {
      var def = global.DFT.DEFAULT_PARAMS;
      if (saved.table) {
        saved.table.headerFill = def.table.headerFill;
        saved.table.bodyFill = def.table.bodyFill;
        saved.table.headerFillOn = false;
        saved.table.bodyFillOn = false;
      }
      if (saved.script) {
        saved.script.color = def.script.color;
        saved.script.colorOn = false;
      }
      write('params', saved);
      write('paramsVersion', PARAMS_VERSION);
      console.info('[文档整改工具] 已清理旧版本残留的颜色设置（避免表格黑底）');
    }
    return merge(global.DFT.DEFAULT_PARAMS, saved);
  }

  function saveParams(params) {
    return write('params', params);
  }

  function resetParams() {
    remove('params');
    return clone(global.DFT.DEFAULT_PARAMS);
  }

  /* ------------------------------- 模板存取 ------------------------------- */
  function loadUserTemplates() {
    var list = read('templates', []);
    return Array.isArray(list) ? list : [];
  }

  function saveUserTemplates(list) {
    return write('templates', list);
  }

  /* 新增或覆盖同名自定义模板 */
  function upsertUserTemplate(name, desc, params) {
    var list = loadUserTemplates();
    var idx = -1;
    for (var i = 0; i < list.length; i++) { if (list[i].name === name) { idx = i; break; } }
    var item = { id: 'user_' + Date.now(), name: name, desc: desc || '自定义模板', params: clone(params), custom: true };
    if (idx >= 0) { item.id = list[idx].id; list[idx] = item; } else { list.push(item); }
    saveUserTemplates(list);
    return list;
  }

  function removeUserTemplate(id) {
    var list = loadUserTemplates().filter(function (t) { return t.id !== id; });
    saveUserTemplates(list);
    return list;
  }

  /* ------------------------------ 字体库存取 ------------------------------ */
  function loadFontLibrary() {
    var saved = read('fonts', null);
    if (!saved || !Array.isArray(saved) || !saved.length) {
      // 首次使用：写入内置字体
      var init = global.DFT.BUILTIN_FONTS.map(function (f) {
        return { name: f.name, type: f.type, builtin: true, fav: false };
      });
      write('fonts', init);
      return init;
    }
    // 合并新增的内置字体（版本升级后不会丢失用户设置）
    var names = {};
    saved.forEach(function (f) { names[f.name] = true; });
    var added = false;
    global.DFT.BUILTIN_FONTS.forEach(function (f) {
      if (!names[f.name]) { saved.push({ name: f.name, type: f.type, builtin: true, fav: false }); added = true; }
    });
    if (added) write('fonts', saved);
    return saved;
  }

  function saveFontLibrary(list) { return write('fonts', list); }

  function addFont(name, type) {
    var list = loadFontLibrary();
    name = String(name || '').trim();
    if (!name) return list;
    if (!list.some(function (f) { return f.name === name; })) {
      list.push({ name: name, type: type || 'cn', builtin: false, fav: false });
      saveFontLibrary(list);
    }
    return list;
  }

  function removeFont(name) {
    var list = loadFontLibrary().filter(function (f) { return f.name !== name; });
    saveFontLibrary(list);
    return list;
  }

  function toggleFavFont(name) {
    var list = loadFontLibrary();
    list.forEach(function (f) { if (f.name === name) f.fav = !f.fav; });
    saveFontLibrary(list);
    return list;
  }

  /* ------------------------------ 其他持久化 ------------------------------ */
  function loadUI()        { return read('ui', {}); }
  function saveUI(v)       { return write('ui', v); }
  function loadHistoryLog(){ return read('log', []); }
  function saveHistoryLog(v){ return write('log', v.slice(-30)); }

  /* 导出所有配置为 JSON 文本（便于备份/迁移） */
  function exportAll() {
    return JSON.stringify({
      version: global.DFT.VERSION,
      params: loadParams(),
      templates: loadUserTemplates(),
      fonts: loadFontLibrary(),
      exportedAt: new Date().toISOString()
    }, null, 2);
  }

  /* 从 JSON 文本导入配置 */
  function importAll(text) {
    var data = JSON.parse(text);
    if (data.params) saveParams(merge(global.DFT.DEFAULT_PARAMS, data.params));
    if (data.templates) saveUserTemplates(data.templates);
    if (data.fonts && data.fonts.length) saveFontLibrary(data.fonts);
    return true;
  }

  global.Store = {
    clone: clone, merge: merge,
    read: read, write: write, remove: remove,
    loadParams: loadParams, saveParams: saveParams, resetParams: resetParams,
    loadUserTemplates: loadUserTemplates, saveUserTemplates: saveUserTemplates,
    upsertUserTemplate: upsertUserTemplate, removeUserTemplate: removeUserTemplate,
    loadFontLibrary: loadFontLibrary, saveFontLibrary: saveFontLibrary,
    addFont: addFont, removeFont: removeFont, toggleFavFont: toggleFavFont,
    loadUI: loadUI, saveUI: saveUI,
    loadHistoryLog: loadHistoryLog, saveHistoryLog: saveHistoryLog,
    exportAll: exportAll, importAll: importAll
  };
})(typeof window !== 'undefined' ? window : this);
