# -*- coding: utf-8 -*-
"""生成一份“排版混乱”的测试用 Word 文档，用于验证整改工具各项功能。

覆盖场景：封面页 / 目录页 / 手工排版的标题 / 半角标点混用 / 全角数字 /
乱码字符 / 重复标点 / 图片与题注 / 表格 / 列表 / 上下标（真角标与假角标）/
参考文献（应被范围保护）。
"""
import os
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml.ns import qn
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))


def set_font(run, cn='宋体', en='Times New Roman', size=None, bold=None, color=None):
    run.font.name = en
    rpr = run._element.get_or_add_rPr()
    rf = rpr.find(qn('w:rFonts'))
    if rf is None:
        rf = rpr.makeelement(qn('w:rFonts'), {})
        rpr.insert(0, rf)
    rf.set(qn('w:eastAsia'), cn)
    rf.set(qn('w:ascii'), en)
    rf.set(qn('w:hAnsi'), en)
    if size:
        run.font.size = Pt(size)
    if bold is not None:
        run.font.bold = bold
    if color:
        run.font.color.rgb = RGBColor.from_string(color)


def main():
    doc = Document()
    sec = doc.sections[0]
    sec.top_margin, sec.bottom_margin = Cm(2.0), Cm(2.0)
    sec.left_margin, sec.right_margin = Cm(2.0), Cm(2.0)

    def center(text, cn='宋体', size=12, bold=False):
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        set_font(p.add_run(text), cn=cn, size=size, bold=bold)
        return p

    # ===== 第 1 页：封面（应被范围保护，不得被改动）=====
    center('本科毕业论文', cn='黑体', size=22, bold=True)
    center('题目：企业数字化转型研究', cn='黑体', size=16)
    center('作者：张三    学号：2021001', size=12)
    center('指导教师：李四    日期：2024年6月', size=12)
    pb = doc.add_paragraph()
    pb.add_run().add_break(WD_BREAK.PAGE)

    # ===== 第 2 页：目录（应被范围保护）=====
    center('目  录', cn='黑体', size=16)
    toc = doc.add_paragraph()
    set_font(toc.add_run('第一章 项目背景'), cn='宋体', size=12)
    toc.add_run('\t1')
    toc2 = doc.add_paragraph()
    set_font(toc2.add_run('第二章 技术路线'), cn='宋体', size=12)
    toc2.add_run('\t5')
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

    # ===== 正文 =====

    # 1. 手工排版的大标题（没有使用标题样式）
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    set_font(p.add_run('企业数字化转型研究报告'), cn='微软雅黑', size=15, bold=False)

    # 2. 正文：半角标点混用、数字、单位、连续空格、首尾空格
    p = doc.add_paragraph()
    set_font(p.add_run('  本文研究,内容包括(三个方面):数据治理、流程再造与组织变革。'))
    set_font(p.add_run('2023年营业收入为 3.14 亿元,同比增长 1,000 万元;效率提升 68% 。'), cn='楷体', size=10.5)

    # 3. 全角空格缩进 + 全角数字
    p = doc.add_paragraph()
    set_font(p.add_run('\u3000\u3000第二章将介绍技术路线，编号为１２３４５，温度 ≤ 25℃ 时误差 ±0.5%。'))

    # 4. 重复标点、乱码、零宽字符
    p = doc.add_paragraph()
    set_font(p.add_run('结果非常好！！！\uFFFD测试\u200B文本。。。后续补充。'))

    # 5. 英文段落里使用中文标点
    p = doc.add_paragraph()
    set_font(p.add_run('This is an English paragraph，which uses Chinese comma。And 12:30 time.'), cn='宋体', size=11)

    # 5.1 真角标：下标 2、上标 2、上标 [1]，字号故意与正文不一致（用于验证统一）
    p = doc.add_paragraph()
    set_font(p.add_run('水的化学式是 H'), cn='宋体', size=12)
    r_sub = p.add_run('2'); set_font(r_sub, cn='宋体', size=10.5); r_sub.font.subscript = True
    set_font(p.add_run('O，面积单位是 cm'), cn='宋体', size=12)
    r_sup = p.add_run('2'); set_font(r_sup, cn='宋体', size=10.5); r_sup.font.superscript = True
    set_font(p.add_run('，体积 10'), cn='宋体', size=12)
    r_sup2 = p.add_run('3'); set_font(r_sup2, cn='宋体', size=10.5); r_sup2.font.superscript = True
    set_font(p.add_run(' m³，引用文献'), cn='宋体', size=12)
    r_sup3 = p.add_run('[1]'); set_font(r_sup3, cn='宋体', size=10.5); r_sup3.font.superscript = True
    set_font(p.add_run('。'), cn='宋体', size=12)

    # 5.2 假角标：小字号但没有上标标记（粘贴后丢失格式的典型情况）
    p = doc.add_paragraph()
    set_font(p.add_run('未标记的幂次 x'), cn='宋体', size=12)
    set_font(p.add_run('2'), cn='宋体', size=8)
    set_font(p.add_run(' 会被智能修正为上标。'), cn='宋体', size=12)

    # 5.3 手动指定角标：单独成 run 的 [2]
    p = doc.add_paragraph()
    set_font(p.add_run('手动修正测试：引用标记'), cn='宋体', size=12)
    set_font(p.add_run('[2]'), cn='宋体', size=12)
    set_font(p.add_run('需要手动指定为角标。'), cn='宋体', size=12)

    # 6. 使用 Heading 1 的标题
    doc.add_heading('第一章 项目背景', level=1)
    doc.add_paragraph('这是使用标题样式的段落，正文内容应当保持首行缩进两字符。')

    # 7. 未使用样式的二级标题（启发式识别）
    p = doc.add_paragraph()
    set_font(p.add_run('一、研究现状'), cn='黑体', size=13, bold=True)

    p = doc.add_paragraph()
    set_font(p.add_run('（一）国内研究'), cn='黑体', size=12)

    # 8. 空行
    doc.add_paragraph('')
    doc.add_paragraph('')
    doc.add_paragraph('')

    # 9. 图片 + 题注（无空格）
    img_path = os.path.join(HERE, 'pic.png')
    Image.new('RGB', (320, 180), (90, 140, 210)).save(img_path)
    doc.add_picture(img_path, width=Cm(8))
    cap = doc.add_paragraph()
    set_font(cap.add_run('图1数字化转型架构示意图'), cn='宋体', size=12)

    # 10. 图片（没有题注）
    doc.add_picture(img_path, width=Cm(6))
    body = doc.add_paragraph()
    set_font(body.add_run('上图展示了整体架构,该架构分为三层。'), cn='仿宋', size=12)

    # 11. 表格（含合并单元格 + 表头里的上标）
    table = doc.add_table(rows=3, cols=3)
    table.style = 'Table Grid'
    data = [['指标', '2022年', '2023年'], ['营收(亿元)', '2.85', '3.14'], ['增长率', '12.5%', '10.2%']]
    for r, row in enumerate(data):
        for c, val in enumerate(row):
            cell = table.cell(r, c)
            cell.text = ''
            if r == 0 and c == 1:
                # 表头里放一个真上标，验证"表格内角标也能识别"
                run = cell.paragraphs[0].add_run('2022年')
                set_font(run, cn='宋体', size=10.5)
                sup = cell.paragraphs[0].add_run('*')
                set_font(sup, cn='宋体', size=9)
                sup.font.superscript = True
            else:
                run = cell.paragraphs[0].add_run(val)
                set_font(run, cn='宋体', size=10.5)
    # 合并单元格：第 3 行后两列合并（验证整改不破坏合并结构）
    table.cell(2, 1).merge(table.cell(2, 2))

    # 12. 列表
    doc.add_paragraph('第一条要求', style='List Number')
    doc.add_paragraph('第二条要求', style='List Number')

    # 13. 参考文献（开启"豁免参考文献"后应完全不动）
    h = doc.add_paragraph()
    set_font(h.add_run('参考文献'), cn='黑体', size=14, bold=True)
    ref = doc.add_paragraph()
    set_font(ref.add_run('[1] 张三.数字化转型研究,2023:15-20.'), cn='宋体', size=10.5)

    out = os.path.join(HERE, 'sample.docx')
    doc.save(out)
    print('已生成：' + out)

    # 生成两种真实风格的 RTF（GBK 转义 / 原始 UTF-8），用于测试旧格式解析
    text = '这是一个测试文件'
    text2 = '第二段内容'

    def gbk_esc(t):
        return ''.join("\\'%02x" % b for b in t.encode('gbk'))

    rtf_gbk = ('{\\rtf1\\ansi\\ansicpg936\\deff0{\\fonttbl{\\f0\\fnil\\fcharset134 SimSun;}}'
               '\\viewkind4\\uc1\\pard\\f0\\fs24 ' + gbk_esc(text) + '\\par ' + gbk_esc(text2) + '\\par}')
    with open(os.path.join(HERE, 'sample-rtf-gbk.rtf'), 'w', encoding='ascii') as fp:
        fp.write(rtf_gbk)
    rtf_utf8 = ('{\\rtf1\\ansi\\ansicpg936\\deff0{\\fonttbl{\\f0\\fnil\\fcharset134 SimSun;}}'
                '{\\*\\generator TestGen;}\\viewkind4\\uc1\\pard\\f0\\fs24 ' + text + '\\par 第二段内容\\par}')
    with open(os.path.join(HERE, 'sample-rtf-utf8.rtf'), 'w', encoding='utf-8') as fp:
        fp.write(rtf_utf8)
    print('已生成 RTF 测试文件')


if __name__ == '__main__':
    main()
