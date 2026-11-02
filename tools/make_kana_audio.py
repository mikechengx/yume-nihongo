#!/usr/bin/env python3
"""生成五十音录音：python3 tools/make_kana_audio.py
需要 edge-tts（pip install edge-tts，联网）。每个假名读成「假名＋ー」，语速放慢；
片假名和平假名读音相同，共用同一个文件。文件名是假名的 Unicode 码点（小写十六进制，多字用 - 连接），如 う → 3046.mp3。"""
import asyncio, os, re, sys
import edge_tts

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(APP, 'audio', 'kana')
VOICE = 'ja-JP-NanamiNeural'
RATE = '-15%'

def kana_list():
    src = open(os.path.join(APP, 'js', 'kana.js'), encoding='utf-8').read()
    out = []
    for m in re.finditer(r'k:"([^"]+)"', src):
        for k in m.group(1).split():
            if re.fullmatch(r'[ぁ-ゖ]{1,2}', k) and k not in out:
                out.append(k)
    return out

def fname(k):
    return '-'.join('%04x' % ord(c) for c in k) + '.mp3'

async def one(sem, k):
    p = os.path.join(OUT, fname(k))
    if os.path.exists(p) and os.path.getsize(p) > 1000:
        return
    async with sem:
        for _ in range(3):
            try:
                await edge_tts.Communicate(k + 'ー', VOICE, rate=RATE).save(p)
                if os.path.getsize(p) > 1000:
                    return
            except Exception as e:
                print('重试', k, e)
        print('失败', k); sys.exit(1)

async def main():
    os.makedirs(OUT, exist_ok=True)
    ks = kana_list()
    sem = asyncio.Semaphore(4)
    await asyncio.gather(*(one(sem, k) for k in ks))
    print(len(ks), '个假名，', sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT)) // 1024, 'KB')

asyncio.run(main())
