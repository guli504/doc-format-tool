# -*- coding: utf-8 -*-
"""给 index.html 的四个"数字"子块补上"独立设置字号与加粗"开关（幂等，可重复执行）"""
import io

P = r'D:\deepseek harness\doc-format-tool\index.html'
NAMES = [
    ('digit.body', '正文'),
    ('digit.heading', '标题'),
    ('digit.caption', '注释'),
    ('digit.table', '表格'),
]

s = io.open(P, encoding='utf-8', newline='').read()
changed = 0
for key, cn in NAMES:
    if ('data-param="%s.independent"' % key) in s:
        print('已存在，跳过:', key)
        continue
    anchor = '<label class="inline mid"><input type="checkbox" data-param="%s.bold" data-type="bool"> 加粗</label>' % key
    idx = s.find(anchor)
    if idx < 0:
        print('未找到锚点:', key)
        continue
    e = s.find('</div>\n          </div>', idx)
    if e < 0:
        print('未找到子块结尾:', key)
        continue
    ins = ('\n            <label class="inline"><input type="checkbox" data-param="%s.independent" '
           'data-type="bool"> 独立设置数字字号与加粗（不勾选则只换字体，字号跟随%s）</label>' % (key, cn))
    s = s[:e] + ins + s[e:]
    changed += 1
    print('已插入:', key)

io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('共插入 %d 处' % changed)
