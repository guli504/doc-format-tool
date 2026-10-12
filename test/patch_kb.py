# -*- coding: utf-8 -*-
"""清理知识库中有专业歧义的"错误写法"（按行精确处理）。"""
import io
import re

P = r'D:\deepseek harness\doc-format-tool\js\knowledge.js'
s = io.open(P, encoding='utf-8', newline='').read()

# canon -> 要移除的 alts（这些写法在专业语境里可能是别的正确含义）
REMOVE = {
    'h': ['H'], 'min': ['Min'], 's': ['S'],
    'mA': ['MA'], 'mW': ['MW'], 'pI': ['PI'],
    'nt': ['NT'], 'aa': ['AA'], 'bp': ['BP'], 'eV': ['EV'],
    'dB': ['DB', 'db'], 'cal': ['Cal'],
    'mmol/L': ['mM'], 'μmol/L': ['uM', 'μM', 'µM'], 'nmol/L': ['nM'], 'pmol/L': ['pM'],
}

lines = s.split('\n')
out = []
removed = 0
for line in lines:
    # 删掉库仑单条（"37C" 会被误判成需要加空格）
    if re.search(r"canon: 'C',\s*alts: \[\]", line):
        removed += 1
        continue
    m = re.search(r"canon: '([^']+)'", line)
    if m and m.group(1) in REMOVE:
        am = re.search(r"alts: \[([^\]]*)\]", line)
        if am:
            items = [x.strip() for x in am.group(1).split(',') if x.strip()]
            keep = [x for x in items if x.strip("'") not in REMOVE[m.group(1)]]
            if len(keep) != len(items):
                removed += len(items) - len(keep)
                line = line[:am.start()] + ('alts: [' + ', '.join(keep) + ']') + line[am.end():]
    out.append(line)

io.open(P, 'w', encoding='utf-8', newline='').write('\n'.join(out))
io.open(r'D:\deepseek harness\doc-format-tool\test\out\kb-patch.log', 'w', encoding='utf-8').write(
    'removed=%d\n' % removed)
print('removed=%d' % removed)
