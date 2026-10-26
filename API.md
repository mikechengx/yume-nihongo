# Yume 愚昧酱日语 · 模块对接 API（`window.Yume`）

写功能模块（`js/speech.js` `js/easy.js` `js/test.js` `js/ai.js` `js/media.js`）只需要读这一份文档。
界面全中文，面向中国大陆用户：谷歌字体/谷歌服务/YouTube 可能打不开，所有功能都要能优雅降级（不报错、给中文提示）。

---

## 0. 文件与加载顺序

```
（仓库根目录）
  page.html            artifact 片段（无 doctype/html/head/body），按下面顺序 <script src> 加载
  css/app.css          全部样式（:root 主题 token + 暗色模式）
  js/core.js           window.Yume 核心（本文档描述的 API）
  content/b1.js…b6.js  课程数据：Yume.addBook({...})       ← tools/assemble.py 生成，别手改
  content/easy.js      会话课数据：Yume.addEasy([...])
  content/tests.js     等级自测题：Yume.addTests({...})
  content/quotes.js    首页「一言」短句：Yume.addQuotes([...])（手写，不由 assemble.py 生成）
  js/kana.js           五十音（标签 kana）
  js/course.js         课程 + 单词本 + 单词/练习会话（标签 course）
  js/home.js           今日（标签 home）
  js/me.js             我的（标签 me）
  js/speech.js         ← 语音跟读模块
  js/ai.js             ← AI 模块
  js/easy.js           ← 简明会话（标签 easy）
  js/test.js           ← 等级自测与学习分析
  js/media.js          ← 视听（标签 media）
  js/pwa.js            离线缓存、长期保存、添加到桌面、App 内打开提醒
  js/boot.js           最后加载，调用 Yume.boot()
  content/parts/*.json 原始内容数据（不发布）
  tools/assemble.py    parts → content/*.js，并校验
  tools/smoke.js       node 冒烟测试；tools/datasafe.test.js 防丢数据测试；tools/tts.test.js 发音测试
  tools/make_icons.py  生成 icons/（需要 Pillow 和 Noto Sans CJK 字体）
  pwa/                 sw.template.js（离线缓存程序模板）、manifest.webmanifest、_headers（只用于独立网站）
  build.py             生成 dist/yume-site（独立网站）和 dist/artifact；dist/ 不进 git
```

**模块写法**：每个模块是一个立即执行函数，只在加载时做「注册」（registerTab / registerAction / registerCard / registerState / registerBadge），不要在加载时碰 DOM——DOM 在 `Yume.boot()` 之后才可用（boot 时会渲染一次）。模块文件为空时页面也必须能正常工作（core 自带占位）。

```js
(function(){
"use strict";
const Y=window.Yume;
const {esc,IC,ruby,plain,speak}=Y;           // 函数可以解构
Y.registerState("easy",{done:{}});             // 新的进度字段
Y.registerTab({id:"easy",label:"会话",icon:"chat",order:30,render:()=>`<div class="stack">…</div>`});
Y.registerAction("easyplay",(d,el,e)=>{ … });
})();
```

**最重要的约定**
- 进度对象永远用 `Yume.S` 现取，**不要** `const S=Yume.S` 缓存到模块顶层（恢复存档/云同步会整体替换 S）。
- 改了 S 之后调用 `Yume.save()`，再按需 `Yume.render()`。
- S 会同步到 claude.ai 的 db（单文档 256KB 上限，core 超过 240KB 就暂停推送）。**字幕、视频库、AI key、缓存等大数据不要放进 S**，用 `Yume.store`。
- 所有插入 HTML 的文本都要 `esc()`；带振假名的日文用 `ruby()`（它内部已转义）。
- 动作名、`id`、`store` 键名请加模块前缀，避免冲突（如 `easy-`、`test-`、`media-`）。

---

## 1. 状态 S 与存储

| API | 说明 |
|---|---|
| `Yume.S` | 当前进度对象（getter）。localStorage 键 **`hibi-n5-v1`**，结构与旧版完全兼容。 |
| `Yume.save()` | 写 localStorage + 1.5 秒后推送云端。会更新 `S.updated`。**写之前先检查别的页面（同一浏览器的其他标签页/窗口）有没有更新过存档（小键 `hibi-n5-v1:rev`），有就先合并再写**，旧页面不会覆盖新进度；别的页面保存时（storage 事件）、切回页面时也会合并进来。合并时的 XP 和每天 XP：以上次同步时的值为基准，两边各自新拿的相加，结果不低于两边较大的值。恢复、清空之后，到下一次写入成功之前，只取较大的值。打开时读档出错的页面，第一次合并时两边都保留。返回本机是否写成功（写不进去时 `syncState()` 为 `"full"`，页面顶部常驻提示）。**不要在渲染过程中调用**（刚打开页面时会刷新 `updated`，可能盖掉还没拉下来的云端进度）。 |
| `Yume.registerState(key, default)` | 给 S 增加顶层字段并补默认值（老存档、恢复存档、云端拉取后都会补）。default 是对象时会逐个补缺失的子键。返回当前值。 |
| `Yume.registerSetting(key, default)` | 给 `S.settings` 增加设置项并补默认值。 |
| `Yume.restore(textOrObj, {mode, noSnap, noUndo})` | 恢复存档，返回 `{ok, msg}`。`mode:"replace"`（默认）整份替换并开启新「纪元」；`mode:"merge"` 和当前进度合并（两边学过的都保留）。恢复前自动存一份 IndexedDB 快照（`noSnap` 跳过）和一份可撤销副本（`noUndo` 跳过）。兼容压缩格式（`wz`）。所有数字字段会被清洗。存档里的 `_x` 交给各模块的 `registerBackup` 恢复。 |
| `Yume.parseBackup(text)` / `Yume.backupInfo(text)` | 解析存档文字（兼容压缩格式，截断时抛出「存档文字不完整」）/ 预览 `{xp, words, days, updated}`。 |
| `Yume.undoLast()` | 撤销最近一次清空 / 恢复（读 `hibi-n5-v1:undo`）。 |
| `Yume.mergeProgress(a, b, force)` | 合并两份完整状态：单词取作答次数多的，语法/徽章/称号并集，练习/五十音/每天 XP 取大，设置和模块状态以较新的为准；纪元不同时以纪元新的为准（`force` 忽略纪元）。 |
| `Yume.snapList()` / `Yume.snapRestore(id)` / `Yume.snapPut(kind, note)` | IndexedDB 自动备份（库 `yume-safe`）：每天一份 `day-日期`（保留 7 天），清空/恢复/清除导入前各一份 `before-时间`（保留 5 份）。启动时如果本机存档是空的或坏了，会自动从最近一份恢复。 |
| `Yume.loadInfo()` | 读档结果 `{ok, why}`：`why` 为 `"read"`（读不出来）或 `"parse"`（内容损坏，原文另存在 `hibi-n5-v1:broken`）。 |
| `Yume.registerBackup(key, {get(opts), put(data)})` | 不在 S 里的模块数据（如视听库、字幕）跟着存档走。`get({lite})` 返回要存的数据（`lite` 为复制到剪贴板的精简版）；`put(data)` 恢复并返回一句说明（如「视听库 3 条」）。 |
| `Yume.backupText(opts)` | 存档文字 = S + `_x`（各模块数据）。「保存存档文件」用 `backupText()`，「复制存档文字」用 `backupText({lite:true})`。 |
| `Yume.resetProgress()` | 清空进度（保留自制课程、链接、设置）。 |
| `Yume.stateSize()` | S 序列化后的字节数。 |
| `Yume.syncState()` | `"local"` / `"cloud"` / `"big"`（太大已暂停云同步）/ `"full"`（本机存储写不进去）。云端：存档超过 200KB 时单词进度压缩成 `wz:{键:[lv,到期分钟,对,错]}`（`packCloud` / `unpackCloud`），本机结构不变。 |
| `Yume.store.get(key, def)` / `.set(key, v)` / `.del(key)` / `.keys(prefix)` / `.len(key)` | 独立 localStorage（实际键名 `"yume-"+key`，JSON 序列化，带 try/catch，失败时 get 返回 def、set 返回 false）。**不进存档、不进云同步、只在本机**。 |

S 现有结构（勿改语义）：
```js
{v:1, xp, days:{"2026-10-22":xp}, words:{"<课id>:<日文>":{lv:0-6,due:ms,r,x}},
 grammar:{"<课id>-<序号>":"日期"}, quiz:{"<课id>":最佳答对数}, videos:{"<课id>":[{t,u}]},
 custom:[自制课程], settings:{newPerDay,goal,autoSpeak,track:"b1",furi:true, …},
 badges:{id:"日期"}, titles:{天数:"日期"}, kana:{lv:{h0:星},m:{あ:熟练度}},
 maxCombo, nd:{d,n}, lastBackup:"日期", updated:ms}
```
- `settings.track`：每日新词来自哪一册（`b1`…`b6`）；`settings.furi`：振假名开关。

**模块生词本**（会话生词 `easy-words`、视听生词 `media-words`）：存在 `S.custom` 里、固定 id 的一课，单词 key 为 `"<id>:<日文>"`，和单词练习/今日复习完全兼容。它们不算「导入的课程」——课程页显示在「我的生词本」，「我的 → 清除已导入」不会删掉它们。

| API | 说明 |
|---|---|
| `Yume.registerWordList(id, {title, sub})` | 模块加载时登记一个生词本 id（之后该 id 的 `S.custom` 条目都按生词本处理）。 |
| `Yume.wordList(id, create?)` | 取 `S.custom` 里的生词本条目；`create` 为 true 时没有就新建（带 `sys:true`）。加完词后 `rebuild()` + `save()`。 |
| `Yume.isWordList(c)` / `Yume.importedCustom()` | 是否生词本 / 用户自己导入的自制课程（不含生词本）。 |
| 课对象 `l.sys` | 自制课程里属于生词本的为 `true`。 |
- 单词 key = `课id + ":" + 日文写法`（如 `"1:私"`、`"b2-25:窓"`）；语法 key = `课id + "-" + 语法序号`。

---

## 2. 标签页、渲染、导航

| API | 说明 |
|---|---|
| `Yume.registerTab({id,label,icon,order,render,onShow?,mount?})` | 注册/覆盖一个底部标签。`render()` 返回整页 HTML 字符串（建议外层 `<div class="stack">`）。`icon` 可以是 `IC` 的键名或 SVG 字符串。`onShow(opts)` 在 `go()` 切到该标签时调用，`opts.from` 是来源标签。`mount(viewEl)` 在每次渲染后调用（尽量不用，优先用事件委托）。 |
| 固定 6 个标签 | `home 今日(0)` `kana 五十音(10)` `course 课程(20)` `easy 会话(30)` `media 视听(40)` `me 我的(50)`。`easy`、`media` 没注册时显示「即将上线」占位。底栏按 6 格设计，别再加第 7 个。 |
| `Yume.render()` | 重画当前标签（整页 innerHTML；会保留带 id 的输入框焦点和光标）。 |
| `Yume.refresh()` | `render()` + 让当前覆盖层重画（调用其 `rerender`）。全局设置变化（如振假名）时用。 |
| `Yume.go(tabId, opts?)` | 切换标签（记住到 `hibi-n5-v1:tab`），滚动到顶部（`opts.keepScroll` 不滚）。 |
| `Yume.ui.tab` | 当前标签 id（只读用）。 |
| `Yume.onRender(fn)` | 每次页面渲染后回调 `fn(tabId)`。 |
| `Yume.tabs()` | 已注册标签表。 |

课程页导航（course.js 提供）：`Yume.openLesson(id, tab?)`（tab: `"words"|"grammar"|"practice"`）、`Yume.openBook(bookId)`、`Yume.course.showWordbook()`。

---

## 3. 事件：动作委托

全局只有一套事件委托，模块用 `Yume.registerAction(name, fn)` 注册处理函数，签名 **`fn(dataset, el, event)`**：

| 写在 HTML 上 | 触发 |
|---|---|
| `<button data-act="name" data-x="1">` | click（非 `<a>` 会 preventDefault；`disabled` 的不触发）。`dataset.x === "1"` |
| `<form data-submit="name">` | submit（已 preventDefault）；`el` 是 form |
| `<input data-input="name">` | input 事件；`el.value` 取值 |
| `<select data-change="name">` / `<input type=file data-change>` | change 事件 |

core 内置动作：`tab`（data-k=标签）、`say`（data-t=要读的日文，自动去括号读音；data-kana="1" 改读假名）、`furi`（切换振假名）、`celeok`。
已被占用的名字（别重名）：`open cbook cback cseg clv ltab gjump gram lwords lquiz settrack addvid delvid wf wq wbook wmore review pick next quit daily free k*（五十音） autosp snew sgoal strack stheme rfile gobackup import clearimp savefile restore export copyexp reset`。
**跟读按钮的动作 `speakcheck` 留给 speech.js 实现。**

---

## 4. 卡片插槽

`Yume.registerCard(slot, fn, {order}?)`：`fn(ctx)` 返回 HTML 字符串（返回 `""` 表示不显示），出错会被吞掉并打印。

| slot | 位置 | ctx |
|---|---|---|
| `home` | 今日页，「今日任务」卡片正下方 | 无 |
| `me` | 我的页，统计数字下方、学习日历上方 | 无 |
| `course` | 课程首页，等级筛选下方、册卡片上方（适合「测测我的等级」入口） | `{lv}` 当前筛选 |
| `lesson` | 课详情页最底部 | 课对象 |

---

## 5. 全屏覆盖层（会话、测试、跟读共用）

同一时间只有一个覆盖层（`#sess`，盖住底栏）。

| API | 说明 |
|---|---|
| `Yume.openOverlay(html, {onKey, onClose, rerender}?)` | 打开覆盖层并放入 html，滚动到顶部。**开始一个新会话时一定要传 opts**（会替换上一个的处理函数，但不会调用上一个的 onClose）。已打开时不传 opts 则只换内容、保留处理函数。返回元素。 |
| `Yume.updateOverlay(html, {top}?)` | 只换内容（保持滚动位置；`top:true` 回到顶部）。 |
| `Yume.closeOverlay({silent}?)` | 关闭：停止朗读 → 调 onClose → `render()`（silent 时不重画）。 |
| `Yume.onOverlayKey(fn)` | 设置按键处理 `fn(keydownEvent)`，**返回 true 表示已处理**；没处理时 Esc 默认关闭覆盖层。 |
| `Yume.overlayOpen()` / `Yume.overlayEl()` | 是否打开 / 元素。 |

覆盖层内的推荐结构（复用现有样式）：
```html
<div class="sin">
  <div class="shead"><button class="iconbtn" data-act="xxxquit" aria-label="结束">${IC.close}</button>
    <div class="bar grow"><i style="width:40%"></i></div></div>
  <div class="prompt">…</div>
  <div class="opts"><button class="opt ja" data-act="…">…</button>…</div>
  <div class="card reveal">…</div>
</div>
```
结束页可用 `.done` + `.seal` + `.dstats`（参考单词练习结束页）。
「我的 → 存档」等普通页面不要用覆盖层。

内置会话（course.js）：`Yume.startWords(words, title)` 用一组单词对象开一轮间隔复习练习；`Yume.startQuiz(lesson)` 开该课练习题。

---

## 6. 发音（TTS）

| API | 说明 |
|---|---|
| `Yume.speak(text, {rate=.9, pitch=1, voiceHint, kana=false, queue=false})` | 朗读日文，**返回 Promise<boolean>**（读完/失败/超时后 resolve，可 `await` 逐句播放）。自动去掉「[读音]」、「（　）」、「〜」。`kana:true` 改读注音假名（多音字更准）。`voiceHint`：`"female"`/`"male"`/语音名片段（如 `"Kyoko"`），找不到就用默认日语语音。`queue:true` 不打断正在读的。 |
| `Yume.stopSpeak()` | 停止朗读。 |
| `Yume.tts` | `{ok, voice, voices, ja(), engine(), mode(), test(), used, err}`。`ok`：能不能发音（自带语音或在线发音）。`voice`：自带的日语语音（没有为 null）。**判断「能不能发出像样的日语」用 `tts.ja()`**（有自带日语语音，或可用在线发音）。`engine()`：下一次用 `"system"` / `"online"` / `"none"`。`mode()`：用户设置 `S.settings.voice`（`auto`/`system`/`online`）。 |
| 发音来源 | `auto`：有自带日语语音就用，否则在线发音；一种失败（自带语音 2.5 秒不出声、在线 8 秒没开始）自动换另一种。在线发音：单词先试有道、句子先试百度（有道大部分句子读不出来），失败互相兜底；百度有防盗链，所以页面头部有 `<meta name="referrer" content="no-referrer">`，嵌入视频的 iframe 自己带 `referrerpolicy`。用户语速 `S.settings.speed`（0.8/1/1.15）乘在 rate 上。 |
| `Yume.voiceStatus()` / `Yume.voiceHelp(open)` | 一句话说明当前发音来源 / 「听不到日语发音？」折叠说明（含安卓安装日语语音的步骤和「去发音设置」按钮）。 |

会话角色建议：L 林（female, pitch 1.1）、K 健（male, pitch .9）、S 佐藤老师（female, rate .85）、O 房东（male, pitch .8）、T/E 其他。没有男声时用 pitch 区分。

---

## 7. 振假名

内容统一写成「漢字[かな]」：`私[わたし]は学生[がくせい]です。`（读音只认假名，中文里的 `[口语]` 不会被当成注音）。

| API | 例子 |
|---|---|
| `Yume.ruby(text, force?)` → HTML | `<ruby>私<rt>わたし</rt></ruby>は…`。已转义。跟随 `S.settings.furi`；`force` 传 true/false 强制。 |
| `Yume.plain(text)` | `私は学生です。`（朗读、比较、搜索用） |
| `Yume.reading(text)` | `わたしはがくせいです。`（语音识别比对用） |
| `Yume.furiOn()` | 当前是否显示振假名。 |

带 ruby 的文字容器加 `class="jr"`（加大行高）。振假名开关按钮：`<button class="chip btnchip" data-act="furi">`。

---

## 8. 内容数据与查询

数据格式见 content/parts 规范（课 `{id,no,t,s,words,grammar,quiz}`，会话 `{episodes:[…]}`，自测 `{level,items}`）。注册函数可重复调用，后注册的同 id 覆盖前面的；boot 之后再注册会自动重建并重画。

| API | 说明 |
|---|---|
| `Yume.addBook({book:"b2", lessons:[…]})` / `Yume.addEasy([…])` / `Yume.addTests({N5:{level,items},…})` | 数据注册（content/*.js 调用）。 |
| `Yume.BOOKS` / `Yume.books()` | `[{id:"b1",t:"初级上",lv:"N5",from:1,to:24,n:24,sub:"第 1–24 课"},…]` 共 6 册：b1 初级上 N5、b2 初级下 N4、b3 中级上 N3、b4 中级下 N2、b5 高级上 N1、b6 高级下 N1。 |
| `Yume.LEVELS` | `["N5","N4","N3","N2","N1"]` |
| `Yume.book(id)` / `Yume.bookLessons(id)` | 册对象 / 该册已有的课（按课号排序）。 |
| `Yume.lesson(id)` / `Yume.lessonsById` | 课对象 / `{id: 课}` 映射。 |
| `Yume.word(key)` / `Yume.wordsByKey` | 单词对象 / `{key: 单词}` 映射。 |
| `Yume.allLessons()` / `Yume.allWords()` | 所有课（含自制课程，`custom:true`，`book:"custom"`）/ 所有单词（去重）。 |
| `Yume.easy()` | 会话课数组（按 no 排序），元素就是 parts 里的原样对象。 |
| `Yume.tests(level)` | 该等级的题目数组（没有则 `[]`）；不传 level 返回 `{N5:[…],…}`。 |

规范化后的对象：
```js
课 = {id:"b2-25", no:25, book:"b2", lv:"N4", t:"课名", s:"核心句型", custom:false,
      words:[单词], grammar:[{p,c,m,d,ex:[[日文,中文],…],note,cmp,lv}],
      quiz:[[题目,[正确,干扰…],中文提示,解析]]}     // quiz 选项第 1 个是正确答案
单词 = {key:"b2-25:窓", ja:"窓", kana:"まど", zh:"窗户", pos:"名", lid:"b2-25"}
复习词 = {key:"4:窓", ja:"窓", …, lid:"b2-31", rep:"4"}   // 前面的课学过的同写法同读音单词：共用第一次出现那课的 key
```
- **跨课重复的单词**：同写法同读音的词只有第一次出现的那一课算新词；后面的课里 `w.rep` = 第一次出现的课 id、`w.key` 指向那一课的键（共用进度）。`allWords()` 不含复习词；统计单词数用 `Yume.newWords(l)`（去掉复习词）。自制课程、生词本不参与。
- 语法点 `lv` 只能是 N5–N1（其他值清空）；`Yume.lvClass(lv)` 只会返回 `n1`…`n5` 或空串。
- 会话课：每集可选 `roles:{"E":{name:"入国審査官",zh:"入境审查官",av:"審",v:"female|male"}}` 覆盖某个代号在这一集的显示名 / 头像字 / 声音；单句台词可选第 4 项 `"日文名|中文名"` 再单独覆盖（如站台广播）。

---

## 9. 进度、XP、徽章

| API | 说明 |
|---|---|
| `Yume.addXP(n)` | 加 XP 并计入今天（连胜靠这个）。之后记得 `checkBadges()` + `save()`。 |
| `Yume.xpOnce(id, n)` / `Yume.xpRevoke(id, n)` / `Yume.takeXP(n)` | 同一件事只奖励一次（记录在本机 `yume-xp-once`），返回实际加的 XP；撤销时如果是今天拿的就扣回并允许再拿。用于可以反复点的按钮（「我学会了」、加入视听生词）。 |
| `Yume.checkBadges()` | 检查徽章和连胜称号（会弹提示/庆祝框）。 |
| `Yume.registerBadge({id,k,t,d,ok})` | 增加徽章：`k` 一个汉字印章，`t` 名称，`d` 条件说明，`ok()` 返回是否达成。 |
| `Yume.wordState(w或key)` | 单词的复习状态 `{lv,due,r,x}` 或 undefined（未学）。 |
| `Yume.markWord(w或key, ok)` | 按单词练习同一套间隔复习规则记一次答题（不加 XP），返回状态。语音跟读、会话课生词练习可用。 |
| `Yume.plan()` | 今日任务 `{due:[到期复习词], fresh:[新词]}`。 |
| `Yume.dueWords()` / `Yume.freshPool()` | 所有到期词 / 所有待学新词（按每日来源册课序）。 |
| `Yume.trackBook()` | 每日新词来源册对象。 |
| `Yume.lessonProg(l)` | 课进度 0–1（单词 50% + 语法 30% + 练习 20%；缺的部分不计，只有单词的生词本按单词算）。 |
| `Yume.bookProg(id)` | `{p, done, n, words}`。 |
| `Yume.levelStats()` | 按等级汇总：`{N5:{lv,lessons,lDone,prog,words,learned,mastered,grammar,gDone,quiz,quizBest},…}`。**学习分析图直接用它**（单词=learned/words，熟记=mastered/words，语法=gDone/grammar，练习=quizBest/quiz）。 |
| `Yume.counts()` | `{learned, mastered}` 全部单词。 |
| `Yume.streak()` / `bestStreak()` / `level()` | 连续天数 / 最长连续 / `{k,from,to}` 等级。 |
| `Yume.today()` / `dkey(date)` | `"YYYY-MM-DD"`。 |

---

## 10. 界面小部件与样式

| API | 说明 |
|---|---|
| `Yume.esc(s)` | HTML 转义。 |
| `Yume.shuffle(arr)` | 返回打乱的新数组。 |
| `Yume.toast(html, ms?)` | 底部提示（html 自己转义）。 |
| `Yume.IC` / `Yume.icon(k)` | 图标 SVG：`flame spk back close go check home book cards me play pause trash kana heart star lock ext chat tv mic down chart target spark link refresh edit list`。 |
| `Yume.ring(p,size,stroke,color)` | 环形进度 SVG。 |
| `Yume.lvDots(w)` | 单词熟练度 5 个点。 |
| `Yume.POS` / `Yume.posCls(pos)` / `Yume.posTag(pos)` | 词性表 `{名:{n:"名词",c:"noun"},…}`（含字幕用的 `助` 助词、`助动` 助动词、`动` 动词）/ 颜色类名 `pc-noun` 等 / 彩色小标签 HTML。 |
| `Yume.speakCheckBtn(w, cls?)` | 跟读按钮 HTML：**只有 `Yume.speech` 存在时才输出**，`<button class="iconbtn mic" data-act="speakcheck" data-ja data-kana data-zh data-key?>`。w 可以是单词或 `{ja:"带[读音]的句子", zh}`。 |
| `Yume.sayBtn(text, label?, {kana,cls}?)` | 朗读按钮 HTML（`data-act="say"`）。 |
| `Yume.lvClass("N4")` | `"n4"`，配合 `.lvb` / `.bookbig`。 |
| `Yume.setTheme("auto"|"light"|"dark")` | 外观（只存本机）。 |

常用 CSS 类：`.stack`（竖排 16px 间距）`.row` `.grow` `.card` `.btn(.primary .gold .ghost .sm .block)` `.chip(.ai .gold .on .btnchip)` `.tabs`（分段切换，按钮加 `.on`）`.filters`（胶囊筛选）`.bar>i`（进度条）`.iconbtn` `.eyebrow` `.muted` `.small` `.stats>.stat` `.wlist>.wrow` `.ex`（例句行）`.fold`（`<details class="fold note|cmp">` 可折叠块）`details.adv`（大折叠卡）`.soon`（占位卡）`.seal`（朱印章）`.lvb.n5`（等级小标）`.pos.pc-verb`（词性标签）`.ptxt.pc-verb`（只给文字上色，适合字幕逐词着色）`.why`（解析框）`.jr`（ruby 行高）。

颜色只用 token（暗色模式自动切换）：`--bg --surface --sunk --line --ink --muted --faint --ai --ai-soft --on-ai --gold --gold-soft --shu --good --good-soft --bad --bad-soft`；等级色 `--n5…--n1` 与 `--n5-soft…`；词性色 `--pos-noun --pos-verb --pos-adj --pos-na --pos-adv --pos-part --pos-aux --pos-other`（各有 `-bg`）。字体：`var(--f-jp)` 日文、`var(--f-ui)` 中文。日文元素加 `lang="ja"`。手机优先，最窄 375px 不能横向滚动。

---

## 11. 各功能模块对接要点

**speech.js（语音跟读）**
- 设置 `window.Yume.speech = {available, check(...)…}`（存在即表示开启跟读按钮），并 `registerAction("speakcheck",(d)=>…)`：`d.ja`（无读音的写法）、`d.kana`（标准读音）、`d.zh`、`d.key`（单词时有）。
- 按钮已经出现在：课详情单词行、语法例句行、单词练习的揭晓卡片。会话课/视听可以用 `Yume.speakCheckBtn()` 复用。
- `SpeechRecognition` 在国内常不可用（Chrome 依赖谷歌服务）、微信里没有：检测不到或出错时给中文提示，并降级为「听原音 → 录音回放对比」或「自评」。识别结果和 `d.kana` / `Yume.reading()` 比对（转平假名后比较）。
- 跟读界面用覆盖层，`onClose` 里停掉麦克风。成绩可存 `registerState("speech",{…})`，录音不要进 S。

**easy.js（简明会话）**
- `registerTab({id:"easy",label:"会话",icon:"chat",order:30,render})`；数据 `Yume.easy()`；进度 `registerState("easy",{done:{}})`。
- 台词 `[代号, 带读音日文, 中文]`，显示用 `ruby()`，朗读用 `await Yume.speak(text,{voiceHint})` 逐句播放；中文翻译可开关。播放/跟读界面用覆盖层。
- 生词可以 `markWord` 或开 `Yume.startWords()`；完成一集 `addXP` + `checkBadges` + `save`。

**test.js（等级自测与学习分析）**
- 题目 `Yume.tests("N5")`，每题 `{sec,q,passage?,audio?,opts,zh}`（opts 第 1 个正确，展示前打乱）；听力用 `Yume.speak(audio)`，没有语音时把原文折叠显示作为降级。
- 入口卡片：`registerCard("course", …)` 和/或 `registerCard("home"|"me", …)`；测试用覆盖层；结果存 `registerState("test",{…})`（只存分数，不存整卷）。
- 分析图用 `Yume.levelStats()` + 自测分项得分（vocab/grammar/reading/listening），纯 SVG 绘制、颜色用 token；学习计划可用 `Yume.S.settings.track` 和 `Yume.openBook()` 跳转。

**ai.js（AI 能力）**
- 导出 `window.Yume.ai = {available(), ask(prompt,…)…}` 给 media.js 用；API key、接口地址存 `Yume.store`（不进 S、不进存档）。claude.ai 内运行时可尝试 `window.claude`，独立站点需用户自填国内可访问的接口；都不可用时功能隐藏或提示。
- 设置界面可放 `registerCard("me", …)`（折叠的 `<details class="adv">`，不要直接展示代码/JSON）。

**media.js（视听）**
- `registerTab({id:"media",label:"视听",icon:"tv",order:40,render})`；只需一个链接输入框（B 站 / YouTube 等），YouTube 打不开时给提示。字幕库、视频列表存 `Yume.store`（不进 S）。
- 逐词着色字幕用 `<span class="ptxt ${Yume.posCls(pos)}">`，词性表 `Yume.POS`（含 `助`/`助动`）；中日双语。

---

## 11.5 多设备同步（同步码）

**网页端 `js/sync.js`**（在「我的」页注册卡片 `#synccard`，order 5）
- 本机记录 `Yume.store("sync")` = `{code, rev, base, last, pushed, err}`：`rev` 是上次对上的云端版本，`base` 是那时的进度摘要 `{xp,days,grammar,epoch}`（用来算「本设备新拿了多少 XP」），`pushed` 是上次上传时的 `S.updated`。
- 同步一次（`Yume.sync.syncNow()`）：读云端 → 云端版本变了就 `mergeWithBase(S, 云端, base)` 合并并 `adopt()` → 把共同基准更新为云端这一份 → 本机和云端不一样就上传（带版本号；409 时重新读、合并、再写，最多 4 次）。
- 加入（`Yume.sync.join(code)`）：第一次合并用 `force`（纪元不同也两边都保留），之前先存一份「before」快照。
- 触发：打开网站 1.5 秒后、`onSaved` 后 5 秒（防抖）、切回页面（距上次 20 秒以上）、切到后台、`online` 事件；失败后 30 秒 / 2 分钟 / 5 分钟 / 10 分钟重试。同一设备多个页面用 `yume-sync-lock` 互斥，一次只有一个页面同步。
- 只同步 S；`Yume.store` 里的数据（AI Key、字幕、视听库）不同步。云端数据一律经过 `merge()` 清洗。
- 别的设备清空或覆盖了进度（纪元变了或 XP 变少）时，换进来之前先存一份「before」快照。
- `Yume.sync = {state, syncNow, create, join, stop, deleteCloud, ping, normCode, fmtCode}`。
- 开着同步、3 天内同步成功过时，`backupDue()` 返回 false（不再催存档），见 `Yume.setBackupOK(fn)`。

**core 提供的接口**
| 接口 | 说明 |
|---|---|
| `Yume.mergeWithBase(a, b, base, force)` | 纯函数：合并两份进度。`base` 是共同基准（可为 null）；多页面合并（absorb）和云端同步共用。 |
| `Yume.baseOf(o)` | 取进度摘要 `{xp,days,grammar,epoch}`，当作下一次的 base。 |
| `Yume.adopt(m)` | 把合并好的进度原地换进 S，重算课程、保存、刷新页面。 |
| `Yume.onSaved(fn)` | 每次 `save()` 之后调用 `fn(本机是否写成功)`。 |
| `Yume.setBackupOK(fn)` | `fn()` 为真时 `backupDue()` 返回 false。 |

**服务器 `netlify/functions/sync.mjs` + `netlify/sync-core.mjs`**
- `POST /api/sync`，JSON：`ping` / `create {data}` / `get {code}` / `put {code, rev, data}`（版本不对返回 409 和最新一份）/ `delete {code}`。
- 同步码 12 位，字符集 `23456789ABCDEFGHJKMNPQRSTUVWXYZ`；存储键是 `p/` + SHA-256(`yume-sync:` + 同步码)。写入用 Blobs 的 `onlyIfMatch`（ETag）防止并发覆盖。
- 限制：请求体最大 1 MB；同一 IP 每天最多生成 30 个同步码（计数存在 `rl/日期/IP 哈希`）。
- Blobs 存储：正式部署（`context.deploy.published`）用 `yume-sync`，预览部署用 `yume-sync-preview`。
- 本地：`node tools/devserver.mjs`（内存存储）。测试：`node tools/sync.test.mjs`。

## 12. 构建与测试

- `node tools/smoke.js`：冒烟测试；`node tools/datasafe.test.js`：防丢数据测试（两个页面共享 localStorage、存档损坏、合并、撤销、精简存档）。
- 独立网站额外有：`sw.js`（离线缓存，由 `pwa/sw.template.js` 生成，预缓存首页引用的全部文件；打开网站时先用缓存秒开，后台取新版，下次打开生效）、`manifest.webmanifest` + `icons/`（添加到桌面，`python3 tools/make_icons.py` 生成）、`_headers`（Netlify：带 `?v=` 的 css/js/content 长期缓存，首页和 sw.js 不缓存）。`js/pwa.js`：注册离线缓存、申请长期保存、安装到桌面、App 内打开提醒。


```bash
python3 tools/assemble.py          # parts → content/*.js，打印错误/警告（有错误退出码 1）
python3 tools/assemble.py --check  # 只校验
node tools/smoke.js                # 冒烟测试（fake DOM 跑一遍所有标签和会话）
node tools/datasafe.test.js        # 防丢数据
node tools/tts.test.js             # 发音（设备语音 / 在线发音切换）
for f in js/*.js content/*.js; do node --check $f; done
python3 build.py                   # → dist/yume-site（+ .zip）和 dist/artifact；加 --draft 另外复制到 ~/Downloads/yume-site-draft
```
本地预览：`python3 -m http.server 8080 -d dist/yume-site`，打开 `http://localhost:8080/`。离线缓存会先用旧版秒开、后台取新版：改完代码要刷新两次，或者在「我的 → 离线与安装」点「修复」。
新增模块文件时不用改 page.html（文件名已固定）；如果确实要加新文件，记得在 page.html 里按顺序加 `<script src>`（必须在 boot.js 之前）。
开发用样例数据请命名为 `*-dev.js`：page.html 不能引用它们（build.py 会拒绝），build.py 也不会把它们复制进 dist。
自测题干里如果同时有说明文字的「（　）」和句中的空格，答题后填入的是**最后一个**「（　）」。
