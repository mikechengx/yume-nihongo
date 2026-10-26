#!/usr/bin/env python3
"""把 content/parts/*.json 组装成 content/b1.js … b6.js、easy.js、tests.js，并做严格校验。

用法：
  python3 tools/assemble.py            校验并写出 content/*.js（有错误也会写出，但退出码为 1）
  python3 tools/assemble.py --check    只校验，不写文件
  python3 tools/assemble.py --quiet    只打印错误和汇总，不打印警告明细
  （测试用）--parts DIR 指定 parts 目录，--out DIR 指定输出目录

parts 目录里的文件：
  easy-<n>.json   会话课 {"episodes":[...]}
  test-<lv>.json  等级自测 {"level":"N5","items":[...]}
  其他 *.json     课程分块 {"book":"b2","lessons":[...]}

初级上（b1）第 1–12 课如果 parts 里没有，会用 tools/legacy_b1.json（旧版课程）补上；
旧版 1–12 课里的单词如果在新的 b1 里找不到同样写法，会自动追加回原来那一课，保证老用户的单词进度不丢。
"""
import json, os, re, sys, glob
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
PARTS = os.path.join(APP, 'content', 'parts')
OUT = os.path.join(APP, 'content')
LEGACY = os.path.join(HERE, 'legacy_b1.json')

BOOKS = {
    'b1': dict(lv='N5', lo=1, hi=24, fmt='{n}'),
    'b2': dict(lv='N4', lo=25, hi=48, fmt='b2-{n}'),
    'b3': dict(lv='N3', lo=1, hi=16, fmt='b3-{n}'),
    'b4': dict(lv='N2', lo=17, hi=32, fmt='b4-{n}'),
    'b5': dict(lv='N1', lo=1, hi=12, fmt='b5-{n}'),
    'b6': dict(lv='N1', lo=13, hi=24, fmt='b6-{n}'),
}
LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1']
POS = set('名 代 动1 动2 动3 い形 な形 副 连体 接续 感 数 助数 惯用 接头 接尾'.split())
SPEAKERS = set('L K S O T E'.split())
TEST_SECS = {'vocab': 7, 'grammar': 7, 'reading': 5, 'listening': 5}
BLANK = '（　）'
CAST_CODE_RE = re.compile('[（(][LKSOTE][）)]')

KANJI = '㐀-䶿一-鿿豈-﫿々〆〇ヵヶ'
KANJI_RE = re.compile('[' + KANJI + ']')
KANJI_RUN = re.compile('[' + KANJI + ']+')
HIRA_RE = re.compile('[ぁ-ゖゝゞー]+')
KANA_RE = re.compile('[ぁ-ゖゝゞァ-ヺー・]+')
RUBY_RE = re.compile('([' + KANJI + ']+)\\[([ぁ-ゖゝゞァ-ヺー・]+)\\]')
BR_RE = re.compile('\\[[ぁ-ゖゝゞァ-ヺー・]*\\]')


def plain(t):
    return BR_RE.sub('', str(t))


class Report:
    def __init__(self):
        self.errors = []
        self.warns = []

    def err(self, where, msg):
        self.errors.append(f'{where}: {msg}')

    def warn(self, where, msg):
        self.warns.append(f'{where}: {msg}')


R = Report()
DICT = {}  # 全汉字单词 → 读音（用于检查注音和词表是否一致）


def rel(p):
    p = os.path.abspath(p)
    return os.path.relpath(p, APP) if p.startswith(APP + os.sep) else os.path.basename(p)


def ctx(text, i, w=8):
    return text[max(0, i - w):i + w]


def check_furi(text, where, need=True):
    """检查「漢字[かな]」标注。need=True 时汉字后面必须有读音。"""
    if not isinstance(text, str):
        R.err(where, '应该是字符串')
        return
    if '［' in text or '］' in text:
        R.err(where, f'用了全角方括号［］，必须用半角 [ ]：{text}')
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c == '[':
            j = text.find(']', i + 1)
            k = text.find('[', i + 1)
            if j < 0 or (0 <= k < j):
                R.err(where, f'方括号没有配对：…{ctx(text, i)}…')
                i += 1
                continue
            rd = text[i + 1:j]
            if not rd:
                R.err(where, f'空的读音 []：…{ctx(text, i)}…')
            elif not HIRA_RE.fullmatch(rd):
                R.err(where, f'读音「{rd}」不是纯平假名')
            if i == 0 or not KANJI_RE.match(text[i - 1]):
                R.err(where, f'读音「{rd}」前面不是汉字（送假名要放在括号外面）：…{ctx(text, i)}…')
            i = j + 1
            continue
        if c == ']':
            R.err(where, f'多出一个 ]：…{ctx(text, i)}…')
        i += 1
    if need:
        for m in KANJI_RUN.finditer(text):
            e = m.end()
            if e >= n or text[e] != '[':
                R.err(where, f'汉字「{m.group()}」后面缺少读音 [かな]')
    for m in RUBY_RE.finditer(text):
        base, rd = m.group(1), m.group(2)
        if len(base) >= 2 and base in DICT and DICT[base] != rd:
            R.warn(where, f'「{base}[{rd}]」和词表读音「{DICT[base]}」不一致，请确认')


def nonempty(v):
    return isinstance(v, str) and v.strip() != ''


def check_word(line, where, need_pos=True):
    if not isinstance(line, str):
        R.err(where, '单词必须是 "日文|假名|中文|词性" 字符串')
        return None
    p = line.split('|')
    if len(p) != 4:
        R.err(where, f'单词要 4 段（日文|假名|中文|词性），现在是 {len(p)} 段：{line}')
        p = (p + ['', '', '', ''])[:4]
    ja, kana, zh, pos = [x.strip() for x in p]
    if not ja:
        R.err(where, f'缺日文写法：{line}')
    if '[' in ja or ']' in ja:
        R.err(where, f'单词的日文写法里不要带 [读音]：{line}')
    if not kana or not KANA_RE.fullmatch(kana):
        R.err(where, f'假名读音必须是纯假名：{line}')
    if not zh:
        R.err(where, f'缺中文释义：{line}')
    if need_pos and len(p) == 4 and pos not in POS:
        R.err(where, f'词性「{pos}」不在允许列表里（{" ".join(sorted(POS))}）：{line}')
    return ja, kana, zh, pos


def check_quiz(q, where, lv_where=''):
    if not isinstance(q, list) or len(q) < 4:
        R.err(where, '题目格式应为 [题目, [4个选项], 中文提示, 解析]')
        return
    text, opts, zh, why = q[0], q[1], q[2], q[3]
    if not nonempty(text):
        R.err(where, '题目为空')
        return
    cnt = text.count(BLANK)
    if cnt != 1:
        R.err(where, f'题目里要正好 1 个全角空格「（　）」，现在有 {cnt} 个：{text}')
    if '()' in text or '（）' in text or '( )' in text:
        R.err(where, f'空格写法不对，要用「（　）」（全角括号中间一个全角空格）：{text}')
    check_furi(text, where + ' 题目', need=True)
    if not isinstance(opts, list) or len(opts) != 4 or not all(nonempty(o) for o in opts):
        R.err(where, f'要 4 个非空选项：{opts}')
    else:
        ps = [plain(o).strip() for o in opts]
        if len(set(ps)) != 4:
            R.err(where, f'选项有重复：{opts}')
        for k, o in enumerate(opts):
            check_furi(o, where + f' 选项{k + 1}', need=False)
    if not nonempty(zh):
        R.warn(where, '缺中文提示')
    if not nonempty(why):
        R.err(where, '缺解析（第 4 项）')


def check_lesson(l, book, where):
    b = BOOKS[book]
    lid = str(l.get('id', ''))
    no = l.get('no')
    w = f'{where} › {lid or "?"}'
    if not isinstance(no, int) or not (b['lo'] <= no <= b['hi']):
        R.err(w, f'no 应为 {b["lo"]}–{b["hi"]} 的整数，现在是 {no!r}')
    elif lid != b['fmt'].format(n=no):
        R.err(w, f'id 应为 "{b["fmt"].format(n=no)}"（和 no 对应），现在是 "{lid}"')
    t = l.get('t', '')
    if not nonempty(t):
        R.err(w, '缺课名 t')
    elif not (3 <= len(t) <= 12):
        R.warn(w, f'课名「{t}」建议 4–10 个字')
    if not nonempty(l.get('s', '')):
        R.err(w, '缺本课核心句型 s')
    else:
        check_furi(l['s'], w + ' s', need=False)
    words = l.get('words', [])
    if not isinstance(words, list) or not words:
        R.err(w, '缺单词 words')
        words = []
    elif len(words) < 10:
        R.warn(w, f'单词只有 {len(words)} 个')
    seen = Counter()
    for i, x in enumerate(words):
        r = check_word(x, f'{w} › words[{i}]')
        if r:
            seen[r[0]] += 1
    for ja, c in seen.items():
        if c > 1:
            R.err(w, f'单词「{ja}」在本课重复了 {c} 次（同一课里日文写法必须唯一）')
    gs = l.get('grammar', [])
    if not isinstance(gs, list):
        gs = []
    if len(gs) < 6:
        R.err(w, f'语法点只有 {len(gs)} 个，至少要 6 个')
    for i, g in enumerate(gs):
        gw = f'{w} › grammar[{i}]'
        if not isinstance(g, dict):
            R.err(gw, '语法点必须是对象')
            continue
        for k, name in (('p', '句型'), ('c', '接续'), ('m', '意思'), ('d', '讲解')):
            if not nonempty(g.get(k)):
                R.err(gw, f'缺 {k}（{name}）')
        if nonempty(g.get('p')):
            check_furi(g['p'], gw + ' p', need=False)
        for k in ('c', 'd', 'note', 'cmp'):
            if nonempty(g.get(k)):
                check_furi(g[k], gw + ' ' + k, need=False)
        if g.get('lv') not in LEVELS:
            R.err(gw, f'lv 应为 N5–N1，现在是 {g.get("lv")!r}')
        ex = g.get('ex', [])
        if not isinstance(ex, list) or len(ex) < 3:
            R.err(gw, f'例句至少 3 句，现在 {len(ex) if isinstance(ex, list) else 0} 句')
            ex = ex if isinstance(ex, list) else []
        for j, e in enumerate(ex):
            if not isinstance(e, list) or len(e) < 2 or not nonempty(e[0]) or not nonempty(e[1]):
                R.err(f'{gw}.ex[{j}]', '例句格式应为 ["日文","中文"]')
                continue
            check_furi(e[0], f'{gw}.ex[{j}]', need=True)
        if not nonempty(g.get('note')):
            R.warn(gw, '没有 note（注意点），建议补上')
    qs = l.get('quiz', [])
    if not isinstance(qs, list):
        qs = []
    if len(qs) < 8:
        R.err(w, f'练习题只有 {len(qs)} 道，至少要 8 道')
    qseen = Counter(plain(q[0]) for q in qs if isinstance(q, list) and q and isinstance(q[0], str))
    for t2, c in qseen.items():
        if c > 1:
            R.warn(w, f'练习题重复：{t2}')
    for i, q in enumerate(qs):
        check_quiz(q, f'{w} › quiz[{i}]')


def check_episode(e, where):
    eid = e.get('id', '?')
    w = f'{where} › {eid}'
    if not re.fullmatch(r'e\d+', str(eid)):
        R.err(w, 'id 应为 "e<编号>"')
    if not isinstance(e.get('no'), int):
        R.err(w, 'no 应为整数')
    elif str(eid) != f'e{e["no"]}':
        R.err(w, f'id 和 no 不对应（应为 e{e["no"]}）')
    for k in ('t', 'scene', 'tip'):
        if not nonempty(e.get(k)):
            R.err(w, f'缺 {k}')
        elif CAST_CODE_RE.search(e[k]):
            R.err(w, f'{k} 里出现了内部角色代号「{CAST_CODE_RE.search(e[k]).group()}」，用户会看到，请删掉：{e[k]}')
    roles = e.get('roles')
    if roles is not None:
        if not isinstance(roles, dict):
            R.err(w, 'roles 应为 {"E":{"name":"日文名","zh":"中文名","av":"头像字","v":"female|male"}}')
            roles = {}
        for code, r in roles.items():
            if code not in SPEAKERS:
                R.err(w, f'roles 里的代号「{code}」不在 {"/".join(sorted(SPEAKERS))} 里')
            if not isinstance(r, dict) or not nonempty(r.get('name')) or not nonempty(r.get('zh')):
                R.err(w, f'roles.{code} 需要 name 和 zh')
                continue
            if 'av' in r and (not nonempty(r['av']) or len(r['av']) > 2):
                R.err(w, f'roles.{code}.av 头像字应为 1–2 个字')
            if 'v' in r and r['v'] not in ('female', 'male'):
                R.err(w, f'roles.{code}.v 只能是 female 或 male')
    if e.get('lv') not in LEVELS:
        R.err(w, f'lv 应为 N5–N1，现在是 {e.get("lv")!r}')
    lines = e.get('lines', [])
    if not isinstance(lines, list) or not (8 <= len(lines) <= 12):
        R.err(w, f'台词要 8–12 句，现在 {len(lines) if isinstance(lines, list) else 0} 句')
        lines = lines if isinstance(lines, list) else []
    for i, ln in enumerate(lines):
        lw = f'{w} › lines[{i}]'
        if not isinstance(ln, list) or not (3 <= len(ln) <= 4):
            R.err(lw, '台词格式应为 ["说话人代号","日文","中文"]（可选第 4 项："日文名|中文名"，这一句的说话人显示名）')
            continue
        if len(ln) == 4 and (not isinstance(ln[3], str) or len(ln[3].split('|')) != 2 or not all(x.strip() for x in ln[3].split('|'))):
            R.err(lw, f'第 4 项应为 "日文名|中文名"：{ln[3]!r}')
        if ln[0] not in SPEAKERS:
            R.err(lw, f'说话人代号「{ln[0]}」不在 {"/".join(sorted(SPEAKERS))} 里')
        if not nonempty(ln[1]) or not nonempty(ln[2]):
            R.err(lw, '日文或中文为空')
            continue
        check_furi(ln[1], lw, need=True)
    key = e.get('key')
    if not isinstance(key, dict) or not all(nonempty(key.get(k)) for k in ('ja', 'zh', 'd')):
        R.err(w, 'key 需要 ja / zh / d 三项')
    else:
        check_furi(key['ja'], w + ' › key.ja', need=True)
    notes = e.get('notes', [])
    if not isinstance(notes, list) or not (2 <= len(notes) <= 3):
        R.err(w, f'notes 要 2–3 个，现在 {len(notes) if isinstance(notes, list) else 0} 个')
    else:
        for i, nt in enumerate(notes):
            if not isinstance(nt, dict) or not nonempty(nt.get('p')) or not nonempty(nt.get('d')):
                R.err(f'{w} › notes[{i}]', '需要 p 和 d')
    words = e.get('words', [])
    if not isinstance(words, list) or not (5 <= len(words) <= 8):
        R.err(w, f'words 要 5–8 个，现在 {len(words) if isinstance(words, list) else 0} 个')
        words = words if isinstance(words, list) else []
    for i, x in enumerate(words):
        check_word(x, f'{w} › words[{i}]')
    qs = e.get('quiz', [])
    if not isinstance(qs, list) or len(qs) != 3:
        R.err(w, f'quiz 要 3 题，现在 {len(qs) if isinstance(qs, list) else 0} 题')
        qs = qs if isinstance(qs, list) else []
    for i, q in enumerate(qs):
        check_quiz(q, f'{w} › quiz[{i}]')


def check_test(t, where):
    lv = t.get('level')
    if lv not in LEVELS:
        R.err(where, f'level 应为 N5–N1，现在是 {lv!r}')
    items = t.get('items', [])
    if not isinstance(items, list):
        R.err(where, 'items 必须是数组')
        return
    if len(items) != 24:
        R.err(where, f'应有 24 题，现在 {len(items)} 题')
    secs = Counter(it.get('sec') for it in items if isinstance(it, dict))
    for s, n in TEST_SECS.items():
        if secs.get(s, 0) != n:
            R.err(where, f'{s} 应有 {n} 题，现在 {secs.get(s, 0)} 题')
    for s in secs:
        if s not in TEST_SECS:
            R.err(where, f'未知的题型 sec="{s}"')
    passages = set()
    for i, it in enumerate(items):
        w = f'{where} › items[{i}]'
        if not isinstance(it, dict):
            R.err(w, '题目必须是对象')
            continue
        sec = it.get('sec')
        if not nonempty(it.get('q')):
            R.err(w, '缺题干 q')
        else:
            check_furi(it['q'], w + ' q', need=False)
        opts = it.get('opts')
        if not isinstance(opts, list) or len(opts) != 4 or not all(nonempty(o) for o in opts):
            R.err(w, f'要 4 个非空选项：{opts}')
        else:
            if len(set(plain(o).strip() for o in opts)) != 4:
                R.err(w, f'选项有重复：{opts}')
            for k, o in enumerate(opts):
                check_furi(o, w + f' 选项{k + 1}', need=False)
        if not nonempty(it.get('zh')):
            R.err(w, '缺解析 zh')
        if sec == 'reading':
            if not nonempty(it.get('passage')):
                R.err(w, '阅读题缺 passage')
            else:
                passages.add(it['passage'])
                check_furi(it['passage'], w + ' passage', need=True)
        if sec == 'listening':
            a = it.get('audio')
            if not nonempty(a):
                R.err(w, '听力题缺 audio')
            elif '[' in a or ']' in a or BLANK in a or '（' in a or '(' in a:
                R.err(w, f'听力原文 audio 不能带振假名或括号：{a}')
    if secs.get('reading') and len(passages) != 2:
        R.warn(where, f'阅读材料应有 2 段，现在 {len(passages)} 段')


def load_json(path):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        R.err(rel(path), f'JSON 读取失败：{e}')
        return None


def main():
    global PARTS, OUT
    argv = sys.argv[1:]
    args = set(argv)
    check_only = '--check' in args
    quiet = '--quiet' in args
    if '--parts' in argv:  # 测试用：换一个 parts 目录
        PARTS = os.path.abspath(argv[argv.index('--parts') + 1])
    if '--out' in argv:  # 测试用：换一个输出目录
        OUT = os.path.abspath(argv[argv.index('--out') + 1])
    files = sorted(glob.glob(os.path.join(PARTS, '*.json')))
    books = {b: {} for b in BOOKS}
    src = {}
    easy = {}
    tests = {}
    lesson_files, easy_files, test_files = [], [], []
    for p in files:
        name = os.path.basename(p)
        if name.startswith('easy-'):
            easy_files.append(p)
        elif name.startswith('test-'):
            test_files.append(p)
        else:
            lesson_files.append(p)

    # 先收集所有单词，建立「全汉字词 → 读音」词表
    datas = {}
    for p in lesson_files:
        d = load_json(p)
        datas[p] = d
        if isinstance(d, dict):
            for l in d.get('lessons', []) or []:
                for x in (l.get('words') or []) if isinstance(l, dict) else []:
                    if isinstance(x, str):
                        q = x.split('|')
                        if len(q) >= 2 and KANJI_RUN.fullmatch(q[0].strip() or 'x') and HIRA_RE.fullmatch(q[1].strip() or 'x'):
                            DICT.setdefault(q[0].strip(), q[1].strip())

    for p in lesson_files:
        rp = rel(p)
        d = datas[p]
        if d is None:
            continue
        if not isinstance(d, dict) or d.get('book') not in BOOKS or not isinstance(d.get('lessons'), list):
            R.err(rp, '格式应为 {"book":"b1".."b6","lessons":[...]}')
            continue
        bk = d['book']
        for l in d['lessons']:
            if not isinstance(l, dict):
                R.err(rp, '课必须是对象')
                continue
            check_lesson(l, bk, rp)
            lid = str(l.get('id'))
            if lid in books[bk]:
                R.err(rp, f'课 {lid} 和 {src[lid]} 重复了（后面的覆盖前面的）')
            books[bk][lid] = l
            src[lid] = rp

    # 初级上：旧版 1–12 课兜底 + 保住老单词
    legacy_used, appended = [], []
    if os.path.exists(LEGACY):
        leg = load_json(LEGACY) or {}
        b1 = books['b1']
        for l in leg.get('lessons', []):
            if l['id'] not in b1:
                b1[l['id']] = l
                legacy_used.append(l['id'])
        # 老用户进度键是「课号:日文写法」，所以旧词必须留在原来那一课、读音也不能变
        for l in leg.get('lessons', []):
            tgt = b1.get(l['id'])
            if tgt is None or l['id'] in legacy_used:
                continue
            have = {}
            for x in tgt.get('words', []) or []:
                if isinstance(x, str):
                    q = x.split('|')
                    have.setdefault(q[0].strip(), q[1].strip() if len(q) > 1 else '')
            # 老用户的语法进度键是「课id-语法序号」：旧版语法点必须保持原来的顺序和位置
            old_g = [plain(g.get('p', '')) for g in l.get('grammar', []) or [] if isinstance(g, dict)]
            new_g = [plain(g.get('p', '')) if isinstance(g, dict) else '' for g in tgt.get('grammar', []) or []]
            for gi, op in enumerate(old_g):
                if gi >= len(new_g) or new_g[gi] != op:
                    R.err(f'b1 第{l["id"]}课', f'语法第{gi + 1}条必须保持旧版「{op}」（老用户进度按序号保存），现在是「{new_g[gi] if gi < len(new_g) else "（缺）"}」')
            for x in l['words']:
                q = x.split('|')
                ja, kana = q[0].strip(), q[1].strip()
                if ja not in have:
                    tgt.setdefault('words', []).append(x)
                    have[ja] = kana
                    appended.append(f'{l["id"]}:{ja}')
                elif have[ja] != kana:
                    R.err(f'b1 第{l["id"]}课', f'旧版单词「{ja}」读音是「{kana}」，新版写成了「{have[ja]}」（老用户进度键要求写法和读音不变）')

    for p in easy_files:
        rp = rel(p)
        d = load_json(p)
        if d is None:
            continue
        eps = d.get('episodes') if isinstance(d, dict) else None
        if not isinstance(eps, list):
            R.err(rp, '格式应为 {"episodes":[...]}')
            continue
        for e in eps:
            if not isinstance(e, dict):
                R.err(rp, '每集必须是对象')
                continue
            check_episode(e, rp)
            eid = str(e.get('id'))
            if eid in easy:
                R.err(rp, f'会话 {eid} 重复了')
            easy[eid] = e

    for p in test_files:
        rp = rel(p)
        d = load_json(p)
        if d is None:
            continue
        if not isinstance(d, dict):
            R.err(rp, '格式应为 {"level":"N5","items":[...]}')
            continue
        check_test(d, rp)
        lv = d.get('level')
        if lv in LEVELS:
            if lv in tests:
                R.err(rp, f'{lv} 的自测题重复了')
            tests[lv] = {'level': lv, 'items': d.get('items', [])}

    # 每册缺课提示
    for bk, b in BOOKS.items():
        want = [b['fmt'].format(n=n) for n in range(b['lo'], b['hi'] + 1)]
        miss = [x for x in want if x not in books[bk]]
        if miss and len(miss) < len(want):
            R.warn(bk, f'缺 {len(miss)} 课：{", ".join(miss)}')
        elif miss:
            R.warn(bk, '这一册还没有内容')
    if easy:
        nos = sorted(e.get('no', 0) for e in easy.values() if isinstance(e.get('no'), int))
        gaps = [n for n in range(1, (nos[-1] if nos else 0) + 1) if n not in nos]
        if gaps:
            R.warn('easy', f'会话编号有缺口：{gaps}')
    for lv in LEVELS:
        if lv not in tests:
            R.warn('tests', f'{lv} 还没有自测题')

    # 跨课重复的单词（同写法同读音）：App 里后出现的那一课按「复习」显示、和第一次出现的课共用一份进度，
    # 不会重复计数、也不会在每日新词里再教一遍（见 js/core.js rebuild）。这里只统计提示。
    first, reps, rep_in_book = {}, 0, 0
    for bk, b in BOOKS.items():
        def _num(l):
            n = l.get('no')
            return n if isinstance(n, int) else 0
        for l in sorted(books[bk].values(), key=_num):
            for x in l.get('words', []) or []:
                if not isinstance(x, str):
                    continue
                q = [y.strip() for y in x.split('|')]
                k = (q[0], q[1] if len(q) > 1 else '')
                if k in first:
                    reps += 1
                    if first[k] == bk:
                        rep_in_book += 1
                else:
                    first[k] = bk
    if reps:
        R.warn('单词', f'有 {reps} 个单词在前面的课里出现过（其中 {rep_in_book} 个在同一册），App 会把它们当「复习词」，和第一次出现的课共用进度、不重复计数')

    # 汇总
    print('== 汇总 ==')
    for bk, b in BOOKS.items():
        ls = books[bk].values()
        nw = sum(len(l.get('words', []) or []) for l in ls)
        ng = sum(len(l.get('grammar', []) or []) for l in ls)
        nq = sum(len(l.get('quiz', []) or []) for l in ls)
        nu = sum(1 for k, v in first.items() if v == bk)
        print(f'  {bk} {b["lv"]}: {len(books[bk])}/{b["hi"] - b["lo"] + 1} 课, {nw} 词（新词 {nu}）, {ng} 语法, {nq} 题')
    print(f'  会话课: {len(easy)} 集；自测: {", ".join(f"{k}={len(v["items"])}" for k, v in sorted(tests.items())) or "无"}')
    if legacy_used:
        print(f'  初级上用旧版课程兜底：第 {", ".join(legacy_used)} 课')
    if appended:
        print(f'  为保住老用户进度，追加回旧版单词 {len(appended)} 个：{", ".join(appended[:40])}{" …" if len(appended) > 40 else ""}')
    if R.warns and not quiet:
        print(f'\n== 警告 {len(R.warns)} 条 ==')
        for x in R.warns:
            print('  - ' + x)
    if R.errors:
        print(f'\n== 错误 {len(R.errors)} 条 ==')
        for x in R.errors:
            print('  ✗ ' + x)
    else:
        print('\n没有错误。')

    if not check_only:
        head = '/* 自动生成：python3 tools/assemble.py（数据来自 content/parts/*.json），请不要手改 */\n'

        def num(l):
            n = l.get('no')
            return n if isinstance(n, int) else 0

        for bk in BOOKS:
            ls = sorted(books[bk].values(), key=num)
            body = ',\n'.join(json.dumps(l, ensure_ascii=False, separators=(',', ':')) for l in ls)
            with open(os.path.join(OUT, f'{bk}.js'), 'w', encoding='utf-8') as f:
                f.write(head + f'Yume.addBook({{"book":"{bk}","lessons":[\n{body}\n]}});\n')
        eps = sorted(easy.values(), key=lambda e: e.get('no', 0) if isinstance(e.get('no'), int) else 0)
        with open(os.path.join(OUT, 'easy.js'), 'w', encoding='utf-8') as f:
            f.write(head + 'Yume.addEasy([\n' + ',\n'.join(json.dumps(e, ensure_ascii=False, separators=(',', ':')) for e in eps) + '\n]);\n')
        with open(os.path.join(OUT, 'tests.js'), 'w', encoding='utf-8') as f:
            f.write(head + 'Yume.addTests(' + json.dumps({k: tests[k] for k in LEVELS if k in tests}, ensure_ascii=False, separators=(',', ':')) + ');\n')
        print('\n已写出 content/b1.js … b6.js、easy.js、tests.js')
    sys.exit(1 if R.errors else 0)


if __name__ == '__main__':
    main()
