# -*- coding: utf-8 -*-
"""补丁：给表格字号加"跟随正文"开关（幂等）"""
import io

P = r'D:\deepseek harness\doc-format-tool\index.html'
s = io.open(P, encoding='utf-8', newline='').read()

if 'table.sizeFollow' in s:
    print('已存在，跳过')
else:
    anchor = '<label class="field"><span>字号(磅)</span><input class="input" type="number" step="0.5" min="5" max="72" list="sizeList" data-param="table.size" data-type="number"></label>'
    idx = s.find(anchor)
    if idx < 0:
        print('未找到表格字号输入框')
    else:
        # 往前找到该 grid3 的开头，在它前面插入开关
        g = s.rfind('<div class="grid3">', 0, idx)
        ins = ('<label class="inline"><input type="checkbox" data-param="table.sizeFollow" data-type="bool"> '
               '表格字号跟随正文（推荐；不勾选才使用下面单独设置的字号）</label>\n            ')
        s = s[:g] + ins + s[g:]
        print('已插入 table.sizeFollow')

io.open(P, 'w', encoding='utf-8', newline='').write(s)
