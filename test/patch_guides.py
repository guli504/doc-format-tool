# -*- coding: utf-8 -*-
"""同步指南到"项目根目录=Git仓库"的新结构：每份指南顶部加更新说明。"""
import io
import os

ROOT = r'D:\deepseek harness\doc-format-tool'
NOTICE = """> **【2026-10 重要更新】项目结构已变更**
> 项目根目录 `doc-format-tool\\` **本身就是 Git 仓库**（和线上同一个仓库）。
> 也就是说：你在 VS Code 里打开项目根目录 → 改代码 → 提交 → 推送，**线上自动更新**，
> 不再需要手动同步「网站版」文件夹（该文件夹已废弃，也已在仓库里忽略）。
> 仓库里现在**包含全部内容**：源码（js/ css/ index.html）+ 开发工具（build/ test/ .vscode/）+ 发布（发布/ 含打包脚本与指南）+ 单文件成品。

"""

files = [
    '发布/开发与修改指南.md',
    '发布/功能开发指南.md',
    '发布/协作者开发指南.md',
    '发布/VS Code 使用教程.md',
]
for rel in files:
    p = os.path.join(ROOT, rel.replace('/', os.sep))
    if not os.path.exists(p):
        print('不存在', rel)
        continue
    s = io.open(p, encoding='utf-8', newline='').read()
    if '重要更新' in s:
        print('已有更新说明', rel)
        continue
    # 插到文件开头的标题之后（第一行 # 标题之后）
    lines = s.split('\n', 1)
    s = lines[0] + '\n\n' + NOTICE + ('\n' + lines[1] if len(lines) > 1 else '')
    io.open(p, 'w', encoding='utf-8', newline='').write(s)
    print('已更新', rel)

# 修掉协作者指南里过时的一句
p = os.path.join(ROOT, '发布', '协作者开发指南.md')
s = io.open(p, encoding='utf-8', newline='').read()
old = '注意：仓库里**没有** `build\\`、`test\\`、`发布\\`（打包脚本、测试、单文件成品在项目所有者本地）。'
new = '注意：**仓库里现在什么都有**（源码 + build/test/.vscode + 发布/ + 打包脚本 + 指南），clone 下来就是完整项目，可以自测、自己打包。'
if old in s:
    s = s.replace(old, new)
    io.open(p, 'w', encoding='utf-8', newline='').write(s)
    print('已修正协作者指南过时句')

# 修掉 开发与修改指南 里"成品"那句（仍然对：成品在 发布/，但仓库也含它）
print('完成')
