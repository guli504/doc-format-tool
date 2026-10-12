# -*- coding: utf-8 -*-
"""生成一份"扫描件风格"的 Word 文档：页面内容全部是图片（没有可编辑文字）。

用途：验证工具在遇到"图片版文档"时的行为，并让界面能准确提示用户。
"""
import os
from docx import Document
from docx.shared import Cm
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))


def cn_font(size):
    for name in ['simsun.ttc', 'msyh.ttc', 'simhei.ttf', 'SimSun.ttf']:
        p = os.path.join(os.environ.get('WINDIR', r'C:\Windows'), 'Fonts', name)
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()


def main():
    W, H = 1200, 1600
    img = Image.new('RGB', (W, H), 'white')
    d = ImageDraw.Draw(img)
    f_big = cn_font(46)
    f = cn_font(30)

    lines = [
        '企业数字化转型研究报告',
        '',
        '本文研究,内容包括(三个方面):数据治理、流程再造与组织变革。',
        '2023年营业收入为 3.14 亿元,同比增长 1,000 万元;效率提升 68% 。',
        '',
        '一、研究现状',
        '（一）国内研究',
        '国内关于数字化转型的研究起步较晚，但发展迅速。',
        '',
        '图1 数字化转型架构示意图',
    ]
    y = 120
    for i, line in enumerate(lines):
        if not line.strip():
            y += 34
            continue
        font = f_big if i == 0 else f
        d.text((120, y), line, fill=(20, 20, 20), font=font)
        y += 62

    img_path = os.path.join(HERE, 'scan-page.png')
    img.save(img_path)

    doc = Document()
    sec = doc.sections[0]
    sec.top_margin = sec.bottom_margin = Cm(1.5)
    sec.left_margin = sec.right_margin = Cm(1.5)
    # 整页就是一张图片（模拟扫描件 / 截图拼成的文档）
    doc.add_picture(img_path, width=Cm(17))

    out = os.path.join(HERE, 'sample-scanned.docx')
    doc.save(out)
    print('已生成：%s' % out)


if __name__ == '__main__':
    main()
