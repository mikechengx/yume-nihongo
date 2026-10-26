#!/usr/bin/env python3
"""从 page.html + css/ js/ content/ 生成两个产物（都在 dist/ 下，不进 git）：

(a) dist/yume-site/        独立网站：index.html + css/ js/ content/ + 离线缓存 sw.js、manifest、图标、_headers。
    去掉了 Google Fonts（国内打不开）。这个文件夹直接放到任何静态托管上就能用，并打包成 dist/yume-site.zip。
(b) dist/artifact/         claude.ai artifact 多文件发布用：page.html 原样 + css/ js/ content/

用法：
  python3 build.py           构建
  python3 build.py --draft   另外复制一份到 ~/Downloads/yume-site-draft/（先删旧的），方便拖到 Netlify 预览；
                             不会碰 ~/Downloads/yume-site/。

content/parts/ 是原始数据，不会被复制。改了 parts 之后先运行 python3 tools/assemble.py 重新生成 content/*.js。
"""
import hashlib, json, os, re, shutil, sys

APP = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(APP, 'dist')
SITE = os.path.join(DIST, 'yume-site')
ART = os.path.join(DIST, 'artifact')
DRAFT = os.path.expanduser('~/Downloads/yume-site-draft')
LIVE = os.path.realpath(os.path.expanduser('~/Downloads/yume-site'))
ASSET_DIRS = ['css', 'js', 'content']

HEAD = ('<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
        '<meta name="theme-color" content="#2A4A9A">\n'
        '<meta name="description" content="yume 愚昧酱日语：五十音闯关、标日全套课程、简明会话、跟读与等级自测。">\n'
        '<link rel="manifest" href="manifest.webmanifest">\n'
        '<link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png">\n'
        '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">\n'
        '<meta name="mobile-web-app-capable" content="yes">\n'
        '<meta name="apple-mobile-web-app-capable" content="yes">\n'
        '<meta name="apple-mobile-web-app-title" content="愚昧酱日语">\n')
PWA = os.path.join(APP, 'pwa')


def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


def ignore_parts(d, names):
    """不发布：content/parts（原始数据）和任何 *-dev.js（开发用样例数据，页面不加载）。"""
    skip = [n for n in names if n.endswith('-dev.js')]
    if os.path.basename(d) == 'content' and 'parts' in names:
        skip.append('parts')
    return skip


def copy_assets(dst):
    for d in ASSET_DIRS:
        src = os.path.join(APP, d)
        shutil.copytree(src, os.path.join(dst, d), ignore=ignore_parts)


def fresh(d):
    d = os.path.realpath(d)
    assert d != LIVE, '拒绝覆盖线上版本 ~/Downloads/yume-site'
    if os.path.exists(d):
        shutil.rmtree(d)
    os.makedirs(d)


def short_hash(path):
    with open(path, 'rb') as f:
        return hashlib.md5(f.read()).hexdigest()[:8]


def write_pwa(index):
    """独立网站专用：图标、安装配置、Netlify 缓存规则、离线缓存程序 sw.js（预缓存首页引用的全部文件）。"""
    shutil.copytree(os.path.join(APP, 'icons'), os.path.join(SITE, 'icons'))
    for name in ('manifest.webmanifest', '_headers'):
        shutil.copy(os.path.join(PWA, name), os.path.join(SITE, name))
    refs = re.findall(r'(?:src|href)="((?:css|js|content)/[^"]+)"', index)
    icons = ['icons/' + n for n in sorted(os.listdir(os.path.join(APP, 'icons')))]
    assets = ['./'] + refs + ['manifest.webmanifest'] + icons
    tpl = read(os.path.join(PWA, 'sw.template.js'))
    ver = hashlib.md5((index + tpl).encode('utf-8')).hexdigest()[:10]
    stamp = __import__('time').strftime('%Y%m%d%H%M%S')
    sw = tpl.replace('"__CACHE__"', json.dumps('yume-' + stamp + '-' + ver)).replace('__ASSETS__', json.dumps(assets, ensure_ascii=False))
    assert '__CACHE__' not in sw and '__ASSETS__' not in sw
    with open(os.path.join(SITE, 'sw.js'), 'w', encoding='utf-8') as f:
        f.write(sw)


def main():
    page = read(os.path.join(APP, 'page.html'))
    # 头部块：开头连续的 <title>/<link>/<meta>/空行
    lines = page.split('\n')
    i = 0
    while i < len(lines) and (lines[i].strip() == '' or re.match(r'\s*<(title|link|meta)\b', lines[i])):
        i += 1
    head_lines, body = lines[:i], '\n'.join(lines[i:])
    assert head_lines and '<title>' in head_lines[0], 'page.html 必须以 <title> 开头'
    head_cn = [l for l in head_lines if l.strip() and 'googleapis' not in l and 'gstatic' not in l]

    # 检查引用的本地文件都存在
    refs = re.findall(r'(?:src|href)="((?:css|js|content)/[^"?#]+)"', page)
    missing = [r for r in refs if not os.path.exists(os.path.join(APP, r))]
    dev = [r for r in refs if r.endswith('-dev.js')]
    if dev:
        print('page.html 不能加载开发用样例文件：', ', '.join(dev))
        sys.exit(1)
    if missing:
        print('缺少文件：', ', '.join(missing))
        sys.exit(1)

    # 本地 css/js 加 ?v=内容哈希，避免手机浏览器（尤其微信）用旧缓存
    def bust(text):
        return re.sub(r'((?:src|href)=")((?:css|js|content)/[^"?#]+)(")',
                      lambda m: m.group(1) + m.group(2) + '?v=' + short_hash(os.path.join(APP, m.group(2))) + m.group(3), text)

    index = HEAD + bust('\n'.join(head_cn)) + '\n</head>\n<body>\n' + bust(body).strip('\n') + '\n</body>\n</html>\n'
    assert 'googleapis' not in index and 'gstatic' not in index

    # (a) 独立网站
    fresh(SITE)
    with open(os.path.join(SITE, 'index.html'), 'w', encoding='utf-8') as f:
        f.write(index)
    copy_assets(SITE)
    write_pwa(index)
    zip_base = os.path.join(DIST, 'yume-site')
    if os.path.exists(zip_base + '.zip'):
        os.remove(zip_base + '.zip')
    shutil.make_archive(zip_base, 'zip', SITE)

    # (b) artifact 多文件
    fresh(ART)
    shutil.copy(os.path.join(APP, 'page.html'), os.path.join(ART, 'page.html'))
    copy_assets(ART)

    # 草稿副本（拖到 Netlify 预览用）
    draft = '--draft' in sys.argv[1:]
    if draft:
        fresh(DRAFT)
        shutil.rmtree(DRAFT)
        shutil.copytree(SITE, DRAFT)

    n = sum(len(fs) for _, _, fs in os.walk(SITE))
    size = sum(os.path.getsize(os.path.join(r, x)) for r, _, fs in os.walk(SITE) for x in fs)
    print(f'built: {SITE} ({n} 个文件, {size / 1024:.0f} KB)')
    print(f'       {zip_base}.zip')
    print(f'       {ART}')
    if draft:
        print(f'       {DRAFT}')


if __name__ == '__main__':
    main()
