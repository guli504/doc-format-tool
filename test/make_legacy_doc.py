# -*- coding: utf-8 -*-
"""构造一个最小的 Word 97 二进制文档 (.doc, OLE 复合文档) 用于测试旧格式解析。

结构：CFB 头 + FAT 扇区 + WordDocument 流 + 1Table 流(分片表) + 目录流。
正文以 UTF-16LE 存放，分片表(Clx/Pcdt)按 Word 97 规范描述文本位置。
"""
import os
import struct

HERE = os.path.dirname(os.path.abspath(__file__))
SECTOR = 512
FREESECT = 0xFFFFFFFF
ENDOFCHAIN = 0xFFFFFFFE
FATSECT = 0xFFFFFFFD

# 正文：包含段落符 \r、单元格符 \x07、图片占位符 \x01、域标记 \x13..\x15
TEXT = ('第一章 测试文档\r'
        '这是正文,包含数字 3.14 与百分号 68%。\r'
        '一、研究现状\r'
        '\x07表内文本\x07\r'
        '\x01图1示意图\r'
        '域内容\x13 HYPERLINK "http://x" \x14显示文本\x15结束。\r')


def build_cfb(streams):
    """streams: [(name, data, start_sector)]；返回完整 CFB 字节"""
    # 扇区规划
    fat_sector = 0
    next_free = 1
    layout = []
    for name, data, _ in streams:
        n = (len(data) + SECTOR - 1) // SECTOR
        layout.append((name, data, next_free, n))
        next_free += n
    dir_sector = next_free
    next_free += 1
    total_sectors = next_free

    # FAT
    fat = [FREESECT] * max(128, total_sectors)
    fat[fat_sector] = FATSECT
    for name, data, start, n in layout:
        for i in range(n):
            s = start + i
            fat[s] = ENDOFCHAIN if i == n - 1 else s + 1
    fat[dir_sector] = ENDOFCHAIN

    # 头部
    header = bytearray(SECTOR)
    header[0:8] = bytes([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])
    struct.pack_into('<H', header, 0x18, 0x003E)     # minor version
    struct.pack_into('<H', header, 0x1A, 0x0003)     # major version (v3, 512B 扇区)
    struct.pack_into('<H', header, 0x1C, 0xFFFE)     # byte order
    struct.pack_into('<H', header, 0x1E, 9)          # sector shift = 512
    struct.pack_into('<H', header, 0x20, 6)          # mini sector shift = 64
    struct.pack_into('<I', header, 0x2C, 1)          # FAT 扇区数
    struct.pack_into('<I', header, 0x30, dir_sector)  # 目录起始扇区
    struct.pack_into('<I', header, 0x38, 4096)       # mini stream cutoff
    struct.pack_into('<I', header, 0x3C, ENDOFCHAIN)  # 第一个 miniFAT 扇区
    struct.pack_into('<I', header, 0x40, 0)          # miniFAT 扇区数
    struct.pack_into('<I', header, 0x44, ENDOFCHAIN)  # 第一个 DIFAT 扇区
    struct.pack_into('<I', header, 0x48, 0)          # DIFAT 扇区数
    struct.pack_into('<I', header, 0x4C, fat_sector)  # DIFAT[0]
    for i in range(1, 109):
        struct.pack_into('<I', header, 0x4C + i * 4, FREESECT)

    # 目录流
    directory = bytearray(SECTOR)
    entries = [('Root Entry', 5, ENDOFCHAIN, 0)]
    for name, data, start, n in layout:
        entries.append((name, 2, start, len(data)))
    for idx, (name, etype, start, size) in enumerate(entries):
        off = idx * 128
        raw = name.encode('utf-16-le') + b'\x00\x00'
        directory[off:off + len(raw)] = raw
        struct.pack_into('<H', directory, off + 0x40, len(raw))
        directory[off + 0x42] = etype
        directory[off + 0x43] = 1                       # color flag
        struct.pack_into('<I', directory, off + 0x44, FREESECT)  # left
        struct.pack_into('<I', directory, off + 0x48, FREESECT)  # right
        if etype == 5:
            struct.pack_into('<I', directory, off + 0x4C, FREESECT)  # child
            struct.pack_into('<I', directory, off + 0x74, ENDOFCHAIN)
            struct.pack_into('<I', directory, off + 0x78, 0)
            struct.pack_into('<I', directory, off + 0x7C, 0)
        else:
            struct.pack_into('<I', directory, off + 0x4C, FREESECT)
            struct.pack_into('<I', directory, off + 0x74, start)
            struct.pack_into('<I', directory, off + 0x78, size)
            struct.pack_into('<I', directory, off + 0x7C, 0)

    # 组装
    out = bytearray(header)
    fat_bytes = bytearray(SECTOR)
    for i in range(128):
        struct.pack_into('<I', fat_bytes, i * 4, fat[i] if i < len(fat) else FREESECT)
    out += fat_bytes                                   # 扇区 0 = FAT
    for name, data, start, n in layout:
        pad = bytearray(n * SECTOR)
        pad[0:len(data)] = data
        out += pad
    out += directory                                   # 目录扇区
    return bytes(out), layout


def main():
    fc_min = 0x800
    text_bytes = TEXT.encode('utf-16-le')
    ccp_text = len(TEXT)

    # WordDocument 流（4KB，正文放在 0x800）
    wd = bytearray(4096)
    struct.pack_into('<H', wd, 0, 0xA5EC)      # wIdent
    struct.pack_into('<H', wd, 2, 0x00C1)      # nFib = Word 97
    struct.pack_into('<H', wd, 10, 0x0200)     # fWhichTblStm = 1（使用 1Table）
    struct.pack_into('<I', wd, 0x4C, ccp_text)  # ccpText
    wd[fc_min:fc_min + len(text_bytes)] = text_bytes

    # 1Table 流：Clx = Pcdt（1 个分片，UTF-16 非压缩）
    n = 1
    lcb = 4 * (n + 1) + 8 * n
    clx = bytearray()
    clx += b'\x02'
    clx += struct.pack('<I', lcb)
    clx += struct.pack('<I', 0)             # CP[0]
    clx += struct.pack('<I', ccp_text)      # CP[1]
    clx += struct.pack('<H', 0)             # PCD.flags
    clx += struct.pack('<I', fc_min)        # PCD.fc（无 0x40000000 → UTF-16LE）
    clx += struct.pack('<H', 0)             # PCD.prm
    struct.pack_into('<I', wd, 0x01A2, 0)             # fcClx
    struct.pack_into('<I', wd, 0x01A6, len(clx))      # lcbClx

    table = bytearray(512)
    table[0:len(clx)] = clx

    data, layout = build_cfb([
        ('WordDocument', bytes(wd), 1),
        ('1Table', bytes(table), 1),
    ])
    out = os.path.join(HERE, 'sample-legacy.doc')
    with open(out, 'wb') as fp:
        fp.write(data)
    print('已生成：%s (%d 字节)' % (out, len(data)))


if __name__ == '__main__':
    main()
