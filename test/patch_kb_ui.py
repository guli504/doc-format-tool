# -*- coding: utf-8 -*-
"""接入：⑰ 数字与单位规范 面板 + 📚 规范知识库弹层 + 分类胶囊"""
import io
import os

ROOT = r'D:\deepseek harness\doc-format-tool'
P = os.path.join(ROOT, 'index.html')
s = io.open(P, encoding='utf-8', newline='').read()

# ---------- 1. 左侧新增 ⑰ 数字与单位规范 ----------
if 'data-cat="unit"' not in s:
    sec = '''
      <!-- 17. 数字与单位规范（知识库驱动） -->
      <details class="sec" data-cat="unit">
        <summary>⑰ 数字与单位规范 <span class="sec-tag">知识库驱动</span>
          <label class="sw" title="启用数字与单位规范化"><input type="checkbox" data-param="unit.enabled" data-type="bool"><span></span></label>
        </summary>
        <div class="sec-body">
          <div class="note">依据《实验论文数字 &amp; 单位格式规范》校订版（内置 119 个单位、164 种常见错误写法）：
            <button class="link-btn" id="btnKbOpen">查看规范知识库</button>。默认关闭，理工科论文 / 申报书建议开启。</div>
          <label class="inline"><input type="checkbox" data-param="unit.fixSpelling" data-type="bool"> 单位拼写与大小写：ul→μL、KD→kDa、ml→mL、sec→s</label>
          <label class="inline"><input type="checkbox" data-param="unit.spaceNumber" data-type="bool"> 数字与单位之间加空格：10μL → 10 μL</label>
          <label class="inline"><input type="checkbox" data-param="unit.tightPercent" data-type="bool"> % ‰ ° ′ ″ 与数字紧贴：95 % → 95%</label>
          <label class="inline"><input type="checkbox" data-param="unit.mathSpace" data-type="bool"> 数学符号前后加空格：P&lt;0.05 → P &lt; 0.05</label>
          <label class="inline"><input type="checkbox" data-param="unit.timesSign" data-type="bool"> 乘号规范化：3 x 10 → 3 × 10</label>
          <label class="inline"><input type="checkbox" data-param="unit.slashTight" data-type="bool"> 斜杠两侧不留空格：5 ng / μL → 5 ng/μL</label>
          <label class="inline"><input type="checkbox" data-param="unit.halfWidth" data-type="bool"> 全角数字 / 字母 / 空格 → 半角</label>
          <label class="inline"><input type="checkbox" data-param="unit.abbrSpace" data-type="bool"> 缩写与数字之间加空格：pH7.4 → pH 7.4</label>
          <label class="inline"><input type="checkbox" data-param="unit.superDigit" data-type="bool"> 幂次转上标：10^10 → 10¹⁰（改动较大）</label>
          <div class="grid2">
            <label class="field"><span>温度写法统一</span>
              <select class="input" data-param="unit.celsius" data-type="text">
                <option value="degree">°C（推荐，兼容性好）</option>
                <option value="char">℃（单字符）</option>
                <option value="keep">保持原样</option>
              </select>
            </label>
            <label class="inline mid"><input type="checkbox" data-param="unit.celsiusSpace" data-type="bool"> °C 前加空格（37 °C）</label>
          </div>
        </div>
      </details>
'''
    anchor = '</div>\n      </details>\n\n      <!-- 14. 字体库 -->'
    if anchor in s:
        s = s.replace(anchor, '</div>\n      </details>\n' + sec + '\n      <!-- 14. 字体库 -->', 1)
        print('已插入 ⑰ 数字与单位规范')
    else:
        i = s.rfind('</details>', 0, s.find('</div>\n    </div>\n\n    <div class="filebar"'))
        s = s[:i + len('</details>')] + '\n' + sec + s[i + len('</details>'):]
        print('已插入 ⑰（备用锚点）')
else:
    print('⑰ 已存在')

# ---------- 2. 分类胶囊加"单位" ----------
if 'data-cat="unit">单位' not in s:
    s = s.replace('<button class="cat-chip" data-cat="digit">数字</button>',
                  '<button class="cat-chip" data-cat="digit">数字</button>\n        '
                  '<button class="cat-chip" data-cat="unit">单位</button>', 1)
    print('已加"单位"分类胶囊')

# ---------- 3. 工具栏加"📚 规范库"按钮 ----------
if 'id="btnKb"' not in s:
    s = s.replace('<button class="btn" id="btnDetect" disabled>🔍 格式检测</button>',
                  '<button class="btn" id="btnDetect" disabled>🔍 格式检测</button>\n'
                  '      <button class="btn" id="btnKb" title="查看内置的《实验论文数字 &amp; 单位格式规范》知识库">📚 规范库</button>', 1)
    print('已加工具栏"规范库"按钮')

# ---------- 4. 规范知识库弹层 ----------
if 'id="kbModal"' not in s:
    modal = '''
<!-- ============================ 规范知识库 ============================ -->
<div class="modal" id="kbModal" hidden>
  <div class="modal-card kb-card">
    <div class="modal-head">
      <strong>📚 规范知识库 · 实验论文数字 &amp; 单位格式规范</strong>
      <span class="kb-stat" id="kbStat"></span>
      <button class="btn btn-mini" id="btnCloseKb">关闭</button>
    </div>
    <div class="modal-body">
      <div class="kb-tools">
        <input class="input" id="kbSearch" placeholder="搜索规范条目：空格 / μL / kDa / 温度 / 上标 / 引用 …">
        <button class="btn btn-mini" id="btnKbEnable">一键启用数字与单位规范</button>
      </div>
      <div id="kbBody"></div>
    </div>
  </div>
</div>
'''
    s = s.replace('<div class="modal" id="helpModal" hidden>', modal + '\n<div class="modal" id="helpModal" hidden>', 1)
    print('已插入规范知识库弹层')

io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('index.html 写入完成')
