# -*- coding: utf-8 -*-
"""给各页面补上 knowledge.js 引用，并补 abbrSpace 参数"""
import io
import os
import re

ROOT = r'D:\deepseek harness\doc-format-tool'

# 1) index.html：knowledge.js 放在 constants.js 之后
p = os.path.join(ROOT, 'index.html')
s = io.open(p, encoding='utf-8', newline='').read()
if 'js/knowledge.js' not in s:
    s = s.replace('<script src="js/constants.js?v=110"></script>',
                  '<script src="js/constants.js?v=110"></script>\n'
                  '<script src="js/knowledge.js?v=110"></script>')
    io.open(p, 'w', encoding='utf-8', newline='').write(s)
    print('index.html: ok')
else:
    print('index.html: 已有')

# 2) 测试页补引用
for tf in ['test/engine-test.html', 'test/table-export.html', 'test/export-test.html', 'test/userdoc-test.html']:
    fp = os.path.join(ROOT, tf.replace('/', os.sep))
    if not os.path.exists(fp):
        print(tf, '不存在')
        continue
    t = io.open(fp, encoding='utf-8', newline='').read()
    if 'knowledge.js' in t:
        print(tf, '已有')
        continue
    m = re.search(r'<script src="([^"]*constants\.js[^"]*)"></script>', t)
    if not m:
        print(tf, '未找到 constants 引用')
        continue
    tag = '<script src="%s"></script>' % m.group(1).replace('constants.js', 'knowledge.js')
    t = t[:m.end()] + '\n' + tag + t[m.end():]
    io.open(fp, 'w', encoding='utf-8', newline='').write(t)
    print(tf, 'ok')

# 3) 参数补 abbrSpace
fp = os.path.join(ROOT, 'js', 'constants.js')
t = io.open(fp, encoding='utf-8', newline='').read()
anchor = "      superDigit: false        // 10^10 → 10¹⁰（改动较大，默认关闭）"
if 'abbrSpace' in t:
    print('constants.js 已有')
elif anchor in t:
    t = t.replace(anchor, anchor + ",\n      abbrSpace: true          // 缩写与数字之间加空格：pH7.4 → pH 7.4")
    io.open(fp, 'w', encoding='utf-8', newline='').write(t)
    print('constants.js ok')
else:
    print('constants.js 未匹配')
