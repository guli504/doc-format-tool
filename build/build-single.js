/* =============================================================================
 * 打包脚本：把 index.html + CSS + 全部 JS（含 JSZip）内联成「一个 HTML 文件」
 * 用法： node build/build-single.js
 * 产物： 发布/文档格式整改工具.html （可直接发给任何人，双击即用，无需联网）
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, '发布');
const OUT_FILE = path.join(OUT_DIR, '文档格式整改工具.html');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/** 内联 <script> 时禁止出现 </script>，否则会提前结束脚本块 */
function assertInlineSafe(code, name) {
  if (/<\/script/i.test(code)) {
    throw new Error('文件 ' + name + ' 中含有 </script，无法安全内联');
  }
  return code;
}

let html = read('index.html');

/* 1. 内联 CSS（忽略 ?v= 之类的缓存参数） */
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, function (m, href) {
  const css = read(href.split('?')[0]);
  console.log('  内联样式 ' + href + ' (' + css.length + ' 字节)');
  return '<style>\n' + css + '\n</style>';
});

/* 2. 内联 JS（保持原有加载顺序） */
html = html.replace(/<script src="([^"]+)"><\/script>/g, function (m, src) {
  const clean = src.split('?')[0];
  const js = assertInlineSafe(read(clean), clean);
  console.log('  内联脚本 ' + src + ' (' + js.length + ' 字节)');
  return '<script>\n' + js + '\n</script>';
});

/* 3. 加一段说明注释 + 单文件标记 */
html = html.replace('<!DOCTYPE html>',
  '<!DOCTYPE html>\n<!--\n' +
  '  文档格式批量整改工具（单文件离线版）\n' +
  '  本文件已把全部样式、脚本、依赖库内联在一起：\n' +
  '  · 双击即可用浏览器打开使用，无需安装、无需联网、无需服务器；\n' +
  '  · 可直接通过微信 / 邮件 / U 盘发给别人，对方双击就能用；\n' +
  '  · 所有文档只在浏览器内存中处理，不上传、不落地。\n' +
  '  生成时间：' + new Date().toLocaleString('zh-CN') + '\n' +
  '-->');

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, html, 'utf8');

const kb = (fs.statSync(OUT_FILE).size / 1024).toFixed(1);
console.log('生成完成：' + OUT_FILE + ' （' + kb + ' KB）');
if (/<script src=|<link rel="stylesheet"/.test(html)) {
  console.warn('警告：仍存在外部引用，请检查 index.html');
  process.exitCode = 1;
}
