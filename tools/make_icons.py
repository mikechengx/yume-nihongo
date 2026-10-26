#!/usr/bin/env python3
"""生成桌面图标（PWA / 添加到主屏幕用）：蓝色圆角方块 + 白色「夢」+ 金色小星。只需在改图标时运行一次。
输出 app/icons/：icon-192.png icon-512.png maskable-512.png apple-touch-icon.png favicon-32.png"""
import os
from PIL import Image, ImageDraw, ImageFont

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(APP, 'icons')
FONT = '/usr/share/fonts/opentype/noto/NotoSansCJK-Black.ttc'   # 索引 0 是日文字形
AI, GOLD, PAPER = (42, 74, 154), (229, 162, 31), (243, 245, 250)


def star(d, cx, cy, r):
    # 四角星：和网页里 logo 的星一样的造型（用多边形近似）
    import math
    # 四个尖 + 向内弯的边：每两个尖之间用一段向中心凹的曲线（取多个点近似）
    pts = []
    for k in range(4):
        a0 = math.pi / 2 + k * math.pi / 2
        for j in range(12):
            t = j / 12
            a = a0 + t * math.pi / 2
            # t=0、1 处在尖上（半径 r），中间凹到 0.30r
            rr = r * (0.30 + 0.70 * (abs(1 - 2 * t) ** 2.2))
            pts.append((cx + rr * math.cos(a), cy - rr * math.sin(a)))
    d.polygon(pts, fill=GOLD)


def draw(size, *, rounded=True, glyph_scale=0.62, bg_full=False, star_on=True):
    S = size * 4  # 先画大图再缩小，边缘更平滑
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if bg_full:
        d.rectangle([0, 0, S, S], fill=AI)
    elif rounded:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=AI)
    font = ImageFont.truetype(FONT, int(S * glyph_scale), index=0)
    box = d.textbbox((0, 0), '夢', font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    d.text(((S - w) / 2 - box[0], (S - h) / 2 - box[1] + S * 0.01), '夢', font=font, fill=PAPER)
    if star_on:
        k = glyph_scale / 0.62
        star(d, S * (0.5 + 0.33 * k), S * (0.5 - 0.33 * k), S * 0.095 * k)
    return im.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    draw(512).save(os.path.join(OUT, 'icon-512.png'))
    draw(192).save(os.path.join(OUT, 'icon-192.png'))
    # 可裁切图标：安卓会把它裁成圆形/圆角，内容要在中间 80% 以内
    draw(512, bg_full=True, glyph_scale=0.46).save(os.path.join(OUT, 'maskable-512.png'))
    # iPhone 桌面图标：不能透明，系统自己加圆角
    draw(180, bg_full=True, glyph_scale=0.56).convert('RGB').save(os.path.join(OUT, 'apple-touch-icon.png'))
    draw(32, star_on=False, glyph_scale=0.7).save(os.path.join(OUT, 'favicon-32.png'))
    print('icons ->', OUT, sorted(os.listdir(OUT)))


if __name__ == '__main__':
    main()
