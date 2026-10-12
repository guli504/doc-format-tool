# -*- coding: utf-8 -*-
"""修复被"黑底 bug"损坏的文档：
   以原始文件为基准，把表格相关的属性（tblPr / trPr / tcPr）还原成原样，
   文字排版（字体、字号、行距、缩进、对齐）保持已整改后的效果。
"""
import os
import shutil
import zipfile
from copy import deepcopy
from lxml import etree

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'


def q(tag):
    return '{%s}%s' % (W, tag)


ORIG = r'D:\桌面图标\申报参考\符康-国创申请-一种基于丝素蛋白的可注射水凝胶用于银屑病治疗的研究.docx'
BAD = r'D:\浏览器下载\符康-国创申请-一种基于丝素蛋白的可注射水凝胶用于银屑病治疗的研究_已整改 (1).docx'
OUT = r'D:\浏览器下载\符康-国创申请-一种基于丝素蛋白的可注射水凝胶用于银屑病治疗的研究_已整改_修复版.docx'


def main():
    zo = zipfile.ZipFile(ORIG)
    zb = zipfile.ZipFile(BAD)
    o = etree.fromstring(zo.read('word/document.xml'))
    b = etree.fromstring(zb.read('word/document.xml'))

    o_tbls = list(o.iter(q('tbl')))
    b_tbls = list(b.iter(q('tbl')))
    print('表格数: 原 %d / 坏 %d' % (len(o_tbls), len(b_tbls)))

    fixed_pr = fixed_tr = fixed_tc = 0
    for o_tbl, b_tbl in zip(o_tbls, b_tbls):
        # 1) 表格属性还原（tblPr 必须是 tbl 的第一个子元素）
        b_pr = b_tbl.find(q('tblPr'))
        o_pr = o_tbl.find(q('tblPr'))
        if b_pr is not None:
            b_tbl.remove(b_pr)
            if o_pr is not None:
                b_tbl.insert(0, deepcopy(o_pr))
            fixed_pr += 1

        o_trs = o_tbl.findall(q('tr'))
        b_trs = b_tbl.findall(q('tr'))
        for o_tr, b_tr in zip(o_trs, b_trs):
            # 2) 行属性还原（去掉工具加的"重复表头""行高"）
            b_trp = b_tr.find(q('trPr'))
            o_trp = o_tr.find(q('trPr'))
            if b_trp is not None:
                b_tr.remove(b_trp)
                if o_trp is not None:
                    b_tr.insert(0, deepcopy(o_trp))
                fixed_tr += 1
            # 3) 单元格属性还原（去掉黑色底纹、还原列宽与边框）
            for o_tc, b_tc in zip(o_tr.findall(q('tc')), b_tr.findall(q('tc'))):
                b_tcp = b_tc.find(q('tcPr'))
                o_tcp = o_tc.find(q('tcPr'))
                if b_tcp is not None:
                    b_tc.remove(b_tcp)
                    if o_tcp is not None:
                        b_tc.insert(0, deepcopy(o_tcp))
                    fixed_tc += 1

    print('已还原: tblPr %d 个 / trPr %d 个 / tcPr %d 个' % (fixed_pr, fixed_tr, fixed_tc))

    new_xml = etree.tostring(b, xml_declaration=True, encoding='UTF-8', standalone=True)

    # 用原始文件重新打包，只替换 document.xml
    with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item in zo.infolist():
            data = zo.read(item.filename)
            if item.filename == 'word/document.xml':
                data = new_xml
            zout.writestr(item, data)

    # 校验
    zf = zipfile.ZipFile(OUT)
    x = zf.read('word/document.xml').decode('utf-8', 'ignore')
    import re
    shd = re.findall(r'<w:shd[^/]*/>', x)
    print('修复后 shd:', dict((v, shd.count(v)) for v in set(shd)) or '无')
    print('修复后 tblW:', dict((v, x.count(v)) for v in set(re.findall(r'<w:tblW[^/]*/>', x))))
    print('输出: %s (%.1f MB)' % (OUT, os.path.getsize(OUT) / 1048576))


if __name__ == '__main__':
    main()
