# -*- coding: utf-8 -*-
"""UI 升级补丁（幂等）：分类筛选条 / 面板折叠 / 可拖动分割线 / 空状态插画 / 步骤进度"""
import io
import re

P = r'D:\deepseek harness\doc-format-tool\index.html'
s = io.open(P, encoding='utf-8', newline='').read()
orig = s

# ---------- 1. 每个 sec 打上分类标记 ----------
CATS = {
    '1. 文档导入': 'doc',
    '2. 排版模板': 'doc',
    '3. 页面设置': 'page',
    '4. 文字格式': 'font',
    '5. 数字格式': 'digit',
    '6. 表格格式标准化': 'table',
    '7. 标题层级': 'font',
    '8. 段落排版': 'para',
    '9. 标点符号': 'punct',
    '10. 空格空行': 'para',
    '11. 图片注释': 'caption',
    '12. 公式保护': 'protect',
    '13. 角标': 'script',
    '14. 整改范围': 'protect',
    '15. 处理范围': 'protect',
    '14. 字体库': 'font',
}
count = 0
for key, cat in CATS.items():
    m = re.search(r'<!--\s*' + re.escape(key) + r'[^>]*-->', s)
    if not m:
        print('未找到标记:', key)
        continue
    d = s.find('<details class="sec"', m.end())
    if d < 0:
        print('未找到 sec:', key)
        continue
    if 'data-cat=' in s[d:d + 60]:
        continue
    s = s[:d] + s[d:].replace('<details class="sec"', '<details class="sec" data-cat="%s"' % cat, 1)
    count += 1
print('已标记分类的卡片: %d' % count)

# ---------- 2. 分类快捷筛选条 ----------
if 'id="catBar"' not in s:
    chips = [('all', '全部'), ('font', '文字'), ('digit', '数字'), ('para', '段落'), ('punct', '标点'),
             ('caption', '图片注释'), ('script', '角标'), ('table', '表格'), ('page', '页面'),
             ('protect', '保护与范围')]
    bar = ('      <!-- 分类快捷筛选 -->\n      <div class="cat-bar" id="catBar">\n' +
           ''.join('        <button class="cat-chip%s" data-cat="%s">%s</button>\n'
                   % (' active' if c == 'all' else '', c, n) for c, n in chips) +
           '      </div>\n\n')
    s = s.replace('<div class="side-scroll">\n', '<div class="side-scroll">\n' + bar, 1)
    print('已插入分类筛选条')

# ---------- 3. 工具栏：面板开关 + 缩放范围 50%-200% ----------
if 'id="btnSideToggle"' not in s:
    s = s.replace('<div class="toolbar">\n      <button class="btn btn-primary" id="btnUpload">',
                  '<div class="toolbar">\n      <button class="btn btn-ghost side-toggle" id="btnSideToggle" '
                  'title="显示 / 隐藏左侧设置面板（窄屏时为抽屉）">☰ 设置</button>\n'
                  '      <span class="tb-sep"></span>\n'
                  '      <button class="btn btn-primary" id="btnUpload">', 1)
    print('已插入面板开关')
old_zoom = re.search(r'<select id="zoomSel">.*?</select>', s, re.S)
if old_zoom and '200%' not in old_zoom.group(0):
    new_zoom = ('<select id="zoomSel">\n'
                '          <option value="0.5">50%</option>\n'
                '          <option value="0.6">60%</option>\n'
                '          <option value="0.75">75%</option>\n'
                '          <option value="0.9">90%</option>\n'
                '          <option value="1" selected>100%</option>\n'
                '          <option value="1.25">125%</option>\n'
                '          <option value="1.5">150%</option>\n'
                '          <option value="1.75">175%</option>\n'
                '          <option value="2">200%</option>\n'
                '        </select>')
    s = s[:old_zoom.start()] + new_zoom + s[old_zoom.end():]
    print('已扩展缩放范围 50%-200%')

# ---------- 4. 预览区：可拖动分割线 ----------
if 'id="splitter"' not in s:
    s = s.replace('      <div class="pane" id="paneFixed">',
                  '      <div class="splitter" id="splitter" title="拖动调整左右比例"></div>\n'
                  '      <div class="pane" id="paneFixed">', 1)
    print('已插入分割线')

# ---------- 5. 空状态插画 ----------
ILLUS_ORIG = ('<svg class="illus" width="120" height="88" viewBox="0 0 120 88" fill="none" aria-hidden="true">'
              '<rect x="30" y="6" width="60" height="76" rx="6" fill="#FFFFFF" stroke="#DBE3EE" stroke-width="1.6"/>'
              '<rect x="40" y="18" width="40" height="4" rx="2" fill="#C7D2E0"/>'
              '<rect x="40" y="30" width="40" height="3" rx="1.5" fill="#E4E9F0"/>'
              '<rect x="40" y="39" width="40" height="3" rx="1.5" fill="#E4E9F0"/>'
              '<rect x="40" y="48" width="26" height="3" rx="1.5" fill="#E4E9F0"/>'
              '<rect x="40" y="60" width="20" height="3" rx="1.5" fill="#EFF3F8"/>'
              '<path d="M20 68l7 7 12-14" stroke="#2563EB" stroke-width="2.4" stroke-linecap="round" '
              'stroke-linejoin="round" opacity=".85"/>'
              '<path d="M96 22l6 6 12-14" stroke="#93B4F6" stroke-width="2.2" stroke-linecap="round" '
              'stroke-linejoin="round"/>'
              '</svg>')
ILLUS_FIX = ('<svg class="illus" width="120" height="88" viewBox="0 0 120 88" fill="none" aria-hidden="true">'
             '<rect x="30" y="6" width="60" height="76" rx="6" fill="#FFFFFF" stroke="#C7EEDC" stroke-width="1.6"/>'
             '<rect x="40" y="18" width="40" height="4" rx="2" fill="#8FD8B8"/>'
             '<rect x="40" y="30" width="40" height="3" rx="1.5" fill="#DCF3E8"/>'
             '<rect x="40" y="39" width="40" height="3" rx="1.5" fill="#DCF3E8"/>'
             '<rect x="40" y="48" width="26" height="3" rx="1.5" fill="#DCF3E8"/>'
             '<circle cx="90" cy="66" r="15" fill="#059669"/>'
             '<path d="M83 66l5 5 10-11" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'
             '</svg>')
for host, illus, title, sub in [
    ('hostOriginal', ILLUS_ORIG, '拖入或点击上传 Word 文档',
     '支持 .docx / .doc / .rtf，可批量处理<br>全部在本机浏览器内完成，文件不会上传'),
    ('hostFixed', ILLUS_FIX, '点击「一键整改」查看结果',
     '参数改动会实时联动刷新，所见即所得'),
]:
    m = re.search(r'(<div class="page-host" id="' + host + r'">)<div class="empty-state">.*?</div>(</div>)', s, re.S)
    if m:
        s = s[:m.start()] + ('%s<div class="empty-state">%s<b>%s</b>%s</div>%s'
                             % (m.group(1), illus, title, sub, m.group(2))) + s[m.end():]
        print('已替换空状态插画:', host)

# ---------- 6. 步骤进度 ----------
if 'id="runSteps"' not in s:
    steps = ('          <div class="steps" id="runSteps">\n'
             '            <span class="step" data-step="parse"><i>✓</i>解析文档</span>\n'
             '            <span class="step" data-step="fix"><i>✓</i>整改排版</span>\n'
             '            <span class="step" data-step="render"><i>✓</i>渲染预览</span>\n'
             '          </div>\n')
    s = s.replace('            <div class="progress-text" id="progressText">准备中…</div>\n',
                  '            <div class="progress-text" id="progressText">准备中…</div>\n' + steps, 1)
    print('已插入步骤进度')

# ---------- 7. 抽屉遮罩 ----------
if 'id="drawerMask"' not in s:
    s = s.replace('</main>', '</main>\n<div class="drawer-mask" id="drawerMask"></div>', 1)
    print('已插入抽屉遮罩')

# ---------- 8. 拖拽图标换成 SVG ----------
s = s.replace('<div class="dz-icon">📄</div>',
              '<div class="dz-icon"><svg width="34" height="34" viewBox="0 0 34 34" fill="none">'
              '<path d="M8 3h12l6 6v22a2 2 0 01-2 2H8a2 2 0 01-2-2V5a2 2 0 012-2z" fill="#EFF6FF" stroke="#2563EB" stroke-width="1.6"/>'
              '<path d="M20 3v6h6" stroke="#2563EB" stroke-width="1.6" stroke-linejoin="round"/>'
              '<path d="M17 17v8m0-8l-3.2 3.2M17 17l3.2 3.2" stroke="#2563EB" stroke-width="1.8" '
              'stroke-linecap="round" stroke-linejoin="round"/></svg></div>')

io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('写入完成，长度 %d -> %d' % (len(orig), len(s)))
