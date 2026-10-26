/* Yume · 课程（js/course.js）
 * 课程页：等级筛选 → 册 → 课列表 → 课详情（单词 | 语法 | 练习）；顶部分段切换到单词本。
 * 也负责单词练习（间隔复习）与每课选择题练习两种全屏会话，导出 Yume.startWords / Yume.startQuiz。
 */
(function(){
"use strict";
const Y=window.Yume;
const {esc,IC,ruby,plain,shuffle,today,speak,ring,lvDots,posTag,speakCheckBtn,sayBtn,lvClass}=Y;

/* ============ 界面状态 ============ */
const cv={seg:"course",lv:Y.store.get("course-lv","all"),book:null,lesson:null,ltab:"words",wfilter:"all",wbook:"all",q:"",limit:150};

/* ============ 小部件 ============ */
function lessonTitle(l){return (l.no?`第${l.no}课 `:"")+l.t}
function lessonItem(l){
  const p=Y.lessonProg(l);
  return `<button class="card lesson" data-act="open" data-id="${esc(l.id)}">
    <div class="lnum">${ring(p,52,5,p>=.999?"var(--good)":"var(--ai)")}<span>${l.no||"＋"}</span></div>
    <div class="grow"><div class="lt">${esc(lessonTitle(l))}</div><div class="ls" lang="ja">${esc(plain(l.s))}</div>
    <div class="small muted num">${l.words.length} 词 · ${l.grammar.length} 语法 · ${l.quiz.length} 题 · ${Math.round(p*100)}%</div></div>
    ${p>=.999?`<span class="seal" lang="ja" title="已完成">済</span>`:IC.go}</button>`;
}
function wordRow(w,extra){
  return `<div class="wrow"><div class="grow"><div class="wline"><span class="wja" lang="ja">${esc(plain(w.ja))}</span>${w.kana&&w.kana!==w.ja?`<span class="wkana" lang="ja">${esc(w.kana)}</span>`:""}${posTag(w.pos)}</div><div class="wzh">${esc(w.zh)}${extra||""}</div></div>${lvDots(w)}<div class="acts">${speakCheckBtn(w)}${sayBtn(w.kana||plain(w.ja))}</div></div>`;
}
function exRow(e){
  return `<div class="ex"><span class="ja jr" lang="ja">${ruby(e[0])}</span><span class="zh">${esc(e[1]||"")}</span><div class="acts">${speakCheckBtn({ja:e[0],zh:e[1]||""})}${sayBtn(e[0],"朗读例句")}</div></div>`;
}
const furiBtn=()=>{const on=Y.furiOn();return `<button class="chip btnchip ${on?"on":""}" data-act="furi" aria-pressed="${on}" title="振假名（汉字上方的读音）"><span lang="ja">ふりがな</span> ${on?"开":"关"}</button>`};

/* ============ 课程首页：册 ============ */
function vBooks(){
  const lvs=["all"].concat(Y.LEVELS);
  const books=Y.BOOKS.filter(b=>cv.lv==="all"||b.lv===cv.lv);
  const track=Y.trackBook().id;
  const bookCard=b=>{const bp=Y.bookProg(b.id);const has=bp.n>0;const on=track===b.id;
    return `<button class="card bookc ${on?"track":""} ${has?"":"empty"}" data-act="cbook" data-id="${b.id}">
      <div class="row"><span class="bookbig ${lvClass(b.lv)}">${b.lv}</span><div class="grow"><div class="bt">${esc(b.t)}</div><div class="small muted">${esc(b.sub)}${has?` · ${bp.n} 课 · ${bp.words} 词`:" · 内容准备中"}</div></div>${IC.go}</div>
      <div class="bar"><i style="width:${bp.p*100}%"></i></div>
      <div class="row small muted" style="justify-content:space-between"><span>已完成 <b class="num">${bp.done}</b> / ${has?bp.n:b.n} 课 · ${Math.round(bp.p*100)}%</span>${on?`<span class="chip ai" style="font-size:12px">每日单词来源</span>`:""}</div></button>`};
  const mine=Y.allLessons().filter(l=>l.custom&&!l.sys),lists=Y.allLessons().filter(l=>l.custom&&l.sys&&l.words.length);
  return `<div class="filters" role="tablist" aria-label="按等级筛选">${lvs.map(lv=>`<button class="${cv.lv===lv?"on":""}" data-act="clv" data-k="${lv}">${lv==="all"?"全部":lv}</button>`).join("")}</div>
  <div class="slot stack">${Y.cards("course",{lv:cv.lv})}</div>
  ${books.length?`<div class="books">${books.map(bookCard).join("")}</div>`:""}
  ${lists.length&&cv.lv==="all"?`<div class="eyebrow" style="margin-top:8px">我的生词本</div><div class="path">${lists.map(lessonItem).join("")}</div>`:""}
  ${mine.length&&cv.lv==="all"?`<div class="eyebrow" style="margin-top:8px">我导入的课程</div><div class="path">${mine.map(lessonItem).join("")}</div>`:""}
  <div class="small muted">课程按新版标准日本语的难度和语法顺序原创编写。想加自己的单词或课程？到「我的 → 高级：导入自制课程」。</div>`;
}
function vBook(){
  const b=Y.book(cv.book);const ls=Y.bookLessons(b.id);const bp=Y.bookProg(b.id);const on=Y.trackBook().id===b.id;
  return `<div class="stack">
  <div class="row"><button class="iconbtn" data-act="cback" aria-label="返回">${IC.back}</button><div class="grow"><div class="eyebrow">${esc(b.lv)} · ${esc(b.sub)}</div><h1 style="font-size:22px">${esc(b.t)}</h1></div><span class="bookbig ${lvClass(b.lv)}" style="width:44px;height:44px;font-size:15px;border-radius:13px">${b.lv}</span></div>
  <div class="card stack" style="gap:12px">
    <div class="row"><span class="grow small muted">已完成 <b class="num" style="color:var(--ink)">${bp.done}</b> / ${ls.length||b.n} 课 · ${bp.words} 个单词</span><b class="num">${Math.round(bp.p*100)}%</b></div>
    <div class="bar"><i style="width:${bp.p*100}%"></i></div>
    ${on?`<div class="row small" style="color:var(--ai)">${IC.check}每日单词的新词正从这一册出</div>`:`<button class="btn sm" data-act="settrack" data-id="${b.id}" ${ls.length?"":"disabled"}>设为每日单词来源</button>`}
  </div>
  ${ls.length?`<div class="path">${ls.map(lessonItem).join("")}</div>`:`<div class="card soon"><span class="seal" lang="ja">待</span><b>这一册正在编写中</b><div class="small muted">先从${esc(Y.BOOKS[0].t)}学起吧。</div></div>`}
  ${ls.length&&ls.length<b.n?`<div class="card small muted" style="text-align:center">其余 ${b.n-ls.length} 课正在编写中</div>`:""}
  </div>`;
}

/* ============ 课详情 ============ */
function vLesson(){
  const S=Y.S;const l=Y.lesson(cv.lesson);const b=Y.book(l.book);const p=Y.lessonProg(l);
  const tabs=[["words","单词 "+l.words.length],["grammar","语法 "+l.grammar.length],["practice","练习 "+l.quiz.length]];
  let body="";
  if(cv.ltab==="grammar")body=vGrammar(l);
  else if(cv.ltab==="practice")body=vPractice(l);
  else body=vLessonWords(l);
  return `<div class="stack">
  <div class="row"><button class="iconbtn" data-act="cback" aria-label="返回">${IC.back}</button><div class="grow"><div class="eyebrow">${b?`${esc(b.t)} · ${l.no?`第${l.no}课`:""}`:"我的课程"}${l.lv?` <span class="lvb ${lvClass(l.lv)}">${l.lv}</span>`:""}</div><h1 style="font-size:22px">${esc(l.t)}</h1></div>${p>=.999?`<span class="seal" lang="ja">済</span>`:""}${furiBtn()}</div>
  <div class="card stack" style="gap:12px"><div class="row"><span class="ls grow jr" lang="ja" style="font-size:16px;color:var(--ink)">${ruby(l.s)}</span><b class="num">${Math.round(p*100)}%</b></div><div class="bar"><i style="width:${p*100}%"></i></div>
    <div class="row" style="flex-wrap:wrap;gap:8px"><button class="btn primary grow" data-act="lwords" ${l.words.length?"":"disabled"}>背本课单词</button><button class="btn gold grow" data-act="lquiz" ${l.quiz.length?"":"disabled"}>本课练习${S.quiz[l.id]!=null?` · 最佳 ${S.quiz[l.id]}/${l.quiz.length}`:""}</button></div></div>
  <div class="tabs" role="tablist">${tabs.map(([k,n])=>`<button role="tab" aria-selected="${cv.ltab===k}" class="${cv.ltab===k?"on":""}" data-act="ltab" data-k="${k}">${n}</button>`).join("")}</div>
  ${body}
  <div class="slot stack">${Y.cards("lesson",l)}</div></div>`;
}
/* 复习词：前面的课里已经学过的词（和那一课共用进度） */
function repLabel(w,l){const f=Y.lesson(w.rep);if(!f)return "";const fb=Y.book(f.book);return (fb&&f.book!==l.book?fb.t+" ":"")+(f.no?`第${f.no}课`:f.t)}
function vLessonWords(l){
  if(!l.words.length)return `<div class="card muted">这一课还没有单词。</div>`;
  const used=[...new Set(l.words.map(w=>w.pos).filter(Boolean))];
  const nrep=l.words.filter(w=>w.rep).length;
  return `${nrep?`<div class="small muted">本课 ${l.words.length} 个单词，其中 ${nrep} 个是前面课里学过的<b>复习词</b>（和那一课共用进度）。</div>`:""}
  <div class="card wlist">${l.words.map(w=>wordRow(w,w.rep?` · <span class="small">复习 · ${esc(repLabel(w,l))}学过</span>`:"")).join("")}</div>
  ${used.length?`<div class="poslegend small muted">${used.map(p=>`<span>${posTag(p)} ${esc((Y.POS[p]||{}).n||p)}</span>`).join("")}</div>`:""}`;
}
function vGrammar(l){
  const S=Y.S;if(!l.grammar.length)return `<div class="card muted">这一课还没有语法点。</div>`;
  const done=l.grammar.filter((_,i)=>S.grammar[l.id+"-"+i]).length;
  const nav=`<div class="row small muted" style="justify-content:space-between"><span>本课 ${l.grammar.length} 个语法点 · 已掌握 <b class="num" style="color:var(--good)">${done}</b></span></div>
  <nav class="gnav" aria-label="语法点目录">${l.grammar.map((g,i)=>`<button class="${S.grammar[l.id+"-"+i]?"on":""}" data-act="gjump" data-i="${i}" lang="ja">${i+1}. ${esc(plain(g.p))}</button>`).join("")}</nav>`;
  return nav+l.grammar.map((g,i)=>grammarCard(l,g,i)).join("");
}
function grammarCard(l,g,i){
  const k=l.id+"-"+i,on=!!Y.S.grammar[k];
  return `<article class="card gram" id="g-${i}">
    <div class="ghead"><span class="gno num">${i+1}</span><div class="grow"><div class="gp jr" lang="ja">${ruby(g.p)}</div>${g.m?`<div class="gmean">${esc(g.m)}</div>`:""}</div>${g.lv?`<span class="lvb ${lvClass(g.lv)}">${esc(g.lv)}</span>`:""}${on?`<span class="seal" lang="ja" style="width:30px;height:30px;font-size:13px">済</span>`:""}</div>
    ${g.c?`<dl class="gkv"><dt>接续</dt><dd class="jr">${ruby(g.c)}</dd></dl>`:""}
    ${g.d?`<div class="gdesc">${ruby(g.d)}</div>`:""}
    ${g.ex.length?`<div class="glabel">例句</div><div class="exs">${g.ex.map(exRow).join("")}</div>`:""}
    ${g.note?`<details class="fold note" open><summary><span class="tagk">!</span>注意</summary><div class="jr">${ruby(g.note)}</div></details>`:""}
    ${g.cmp?`<details class="fold cmp"><summary><span class="tagk">≈</span>易混淆对比</summary><div class="jr">${ruby(g.cmp)}</div></details>`:""}
    <button class="btn ${on?"ghost":"gold"} sm" data-act="gram" data-k="${esc(k)}" style="align-self:flex-start">${on?"已掌握 · 点击撤销":"我学会了 +10 XP"}</button></article>`;
}
function vPractice(l){
  const S=Y.S;const best=S.quiz[l.id];const vids=S.videos[l.id]||[];
  const kw=encodeURIComponent((l.no&&Y.book(l.book)?`标准日本语 ${Y.book(l.book).t} 第${l.no}课 `:"")+plain(l.s||l.t));
  return `<div class="card stack" style="gap:12px">
    <div class="row" style="align-items:flex-start"><div class="grow"><div class="eyebrow">本课练习</div><h2 style="font-size:20px">${l.quiz.length} 道选择题</h2><div class="small muted">选出填入（　）的正确答案，每题答完都有解析。全部答对额外 +10 XP。</div></div>
    ${best!=null?`<div class="stat" style="text-align:center;min-width:76px"><b class="num">${best}/${l.quiz.length}</b><span>最佳成绩</span></div>`:""}</div>
    <button class="btn gold block" data-act="lquiz" ${l.quiz.length?"":"disabled"}>${IC.play}${best!=null?"再练一次":"开始练习"}</button></div>
  <div class="card stack" style="gap:10px"><div class="eyebrow">延伸学习 · 搜索本课讲解</div>
    <a class="vlink" href="https://search.bilibili.com/all?keyword=${kw}" target="_blank" rel="noopener"><span class="grow">在 B 站搜索本课</span>${IC.ext}</a>
    <a class="vlink" href="https://www.youtube.com/results?search_query=${kw}" target="_blank" rel="noopener"><span class="grow">在 YouTube 搜索本课 <span class="small muted">（需要能访问 YouTube）</span></span>${IC.ext}</a></div>
  <div class="card stack" style="gap:10px"><div class="eyebrow">我收藏的本课链接</div>
    ${vids.length?vids.map((v,i)=>{const u=Y.safeUrl(v.u);return `<div class="row"><a class="vlink grow" href="${esc(u||"#")}" target="_blank" rel="noopener">${IC.play}<span class="grow">${esc(v.t||u)}</span>${IC.ext}</a><button class="iconbtn" data-act="delvid" data-i="${i}" aria-label="删除">${IC.trash}</button></div>`}).join(""):`<div class="small muted">把常看的讲解视频或播客链接贴在这里，下次一点就开。</div>`}
    <form class="stack" style="gap:8px" data-submit="addvid"><input type="text" id="vt" placeholder="标题，比如：${esc(lessonTitle(l))} 讲解" maxlength="80"><input type="url" id="vu" placeholder="https://..." required><button class="btn primary sm" type="submit">添加链接</button></form></div>`;
}

/* ============ 单词本 ============ */
function vWords(){
  const S=Y.S;const f=cv.wfilter,q=cv.q.trim().toLowerCase();
  const all=Y.allWords();
  const bookOf=w=>{const l=Y.lesson(w.lid);return l?l.book:"custom"};
  const inBook=w=>cv.wbook==="all"||bookOf(w)===cv.wbook;
  const cat=w=>{const s=Y.wordState(w);return !s?"new":s.lv>=5?"done":"learn"};
  const n={all:0,new:0,learn:0,done:0};for(const w of all){if(!inBook(w))continue;n.all++;n[cat(w)]++}
  /* 搜索用的文字每个词只算一次（挂在词对象上，课程数据变了词对象会换新） */
  const sk=w=>w._sk||(w._sk=(w.ja+w.kana+w.zh).toLowerCase());
  const list=all.filter(w=>inBook(w)&&(f==="all"||cat(w)===f)&&(!q||sk(w).includes(q)));
  const due=Y.dueWords().length;
  const books=Y.BOOKS.filter(b=>Y.bookLessons(b.id).length);const hasCustom=Y.allLessons().some(l=>l.custom);
  const shown=list.slice(0,cv.limit);
  return `<div class="row" style="justify-content:space-between;flex-wrap:wrap"><span class="small muted">共 <b class="num">${n.all}</b> 个单词</span>${due?`<button class="btn primary sm" data-act="review">复习到期 ${due} 个</button>`:""}</div>
  <div class="row" style="gap:8px"><input type="search" id="wq" class="grow" placeholder="搜索日文、假名或中文" value="${esc(cv.q)}" data-input="wq" style="flex:1"><select id="wbook" data-change="wbook" style="width:auto" aria-label="按册筛选"><option value="all">全部册</option>${books.map(b=>`<option value="${b.id}" ${cv.wbook===b.id?"selected":""}>${b.lv} ${esc(b.t)}</option>`).join("")}${hasCustom?`<option value="custom" ${cv.wbook==="custom"?"selected":""}>生词本·自制</option>`:""}</select></div>
  <div class="filters">${[["all","全部"],["new","未学"],["learn","学习中"],["done","已熟记"]].map(([k,t])=>`<button class="${f===k?"on":""}" data-act="wf" data-k="${k}">${t} <span class="num">${n[k]}</span></button>`).join("")}</div>
  <div class="card wlist" style="padding-block:4px">${shown.length?shown.map(w=>{const l=Y.lesson(w.lid);const b=l&&Y.book(l.book);return wordRow(w,` · <span class="small">${l&&l.no?`${b?esc(b.t)+" ":""}第${l.no}课`:esc(l?l.t:"")}</span>`)}).join(""):`<div class="muted" style="padding:16px 0">没有符合条件的单词。</div>`}</div>
  ${list.length>shown.length?`<button class="btn block" data-act="wmore">再显示 ${Math.min(150,list.length-shown.length)} 个（还有 ${list.length-shown.length} 个）</button>`:""}`;
}

/* ============ 页面入口 ============ */
function vCourse(){
  if(cv.lesson&&Y.lesson(cv.lesson))return vLesson();
  cv.lesson=null;
  if(cv.book&&Y.book(cv.book))return vBook();
  cv.book=null;
  const words=cv.seg==="words";
  return `<div class="stack">
  <div><div class="eyebrow">${words?"单词本 · 所有课程的单词":"课程 · N5 到 N1"}</div><h1 style="font-size:24px">${words?"单词本":"课程"}</h1></div>
  <div class="tabs" role="tablist">${[["course","课程"],["words","单词本"]].map(([k,t])=>`<button role="tab" aria-selected="${cv.seg===k}" class="${cv.seg===k?"on":""}" data-act="cseg" data-k="${k}">${t}</button>`).join("")}</div>
  ${words?vWords():vBooks()}</div>`;
}

/* ============ 学习会话：单词 & 练习题 ============ */
let sess=null;
/* 干扰项：先找同一课的词，再找同一册同词性的词，最后全部词里随机挑。
 * 按课、按「册+词性」的索引在课程数据变化时才重建；从大列表里随机抽样，不再每题把两千多个词打乱几遍。 */
let DIDX=null;
function didx(){
  const all=Y.allWords();if(DIDX&&DIDX.all===all)return DIDX;
  const byL=new Map(),byBP=new Map();
  for(const x of all){const l=Y.lesson(x.lid);const bp=(l?l.book:"")+"|"+(x.pos||"");
    if(!byL.has(x.lid))byL.set(x.lid,[]);byL.get(x.lid).push(x);
    if(!byBP.has(bp))byBP.set(bp,[]);byBP.get(bp).push(x)}
  DIDX={all,byL,byBP};return DIDX;
}
function sample(arr,n,skip){const out=[];const len=arr.length;if(!len)return out;const used=new Set();
  for(let t=0;t<n*8+10&&out.length<n;t++){const x=arr[Math.floor(Math.random()*len)];if(used.has(x))continue;used.add(x);if(!skip(x))out.push(x)}
  return out}
function distractors(w,field){
  const I=didx();const l=Y.lesson(w.lid);const bk=l?l.book:"";
  const out=[],seen=new Set([w[field]]);
  const take=list=>{for(const x of list){if(out.length>=3)return;if(x.key===w.key)continue;if(!seen.has(x[field])){seen.add(x[field]);out.push(x[field])}}};
  take(shuffle(I.byL.get(w.lid)||[]));
  if(out.length<3&&w.pos)take(sample(I.byBP.get(bk+"|"+w.pos)||[],12,x=>x.lid===w.lid));
  if(out.length<3)take(sample(I.all,24,x=>x.lid===w.lid));
  if(out.length<3)take(shuffle(I.all.filter(x=>x.lid!==w.lid)));/* 词很少时兜底 */
  return out;
}
function mkWordItem(w,retry){
  const s=Y.wordState(w),lv=s?s.lv:0;let mode="ja2zh";const r=Math.random();
  if(!retry&&lv>=2&&r<.3)mode="zh2ja";else if(!retry&&lv>=1&&Y.tts.ja()&&r>.75)mode="listen";
  const field=mode==="zh2ja"?"ja":"zh";const opts=shuffle([w[field],...distractors(w,field)]);
  return{kind:"w",w,mode,opts,ans:opts.indexOf(w[field]),retry:!!retry,isNew:!s};
}
function openSess(){Y.openOverlay(htmlSess(),{onKey:sessKey,onClose:()=>{sess=null},rerender:()=>renderSess()});speakCur()}
function startWords(list,title){
  list=(list||[]).filter(Boolean);
  if(!list.length){Y.toast("没有需要学习的单词");return}
  sess={type:"w",title:title||"单词练习",items:list.map(w=>mkWordItem(w)),i:0,answered:null,correct:0,total:0,xp:0,combo:0,maxCombo:0,fresh:0};openSess();
}
function startQuiz(l){
  if(!l||!l.quiz.length){Y.toast("这一课还没有练习题");return}
  const items=shuffle(l.quiz).map(([q,o,zh,why])=>{const opts=shuffle(o);return{kind:"q",q,opts,ans:opts.indexOf(o[0]),zh,why,right:o[0]}});
  sess={type:"q",lid:l.id,title:(l.no?`第${l.no}课 `:"")+"练习",items,i:0,answered:null,correct:0,total:0,xp:0,combo:0,maxCombo:0,fresh:0};openSess();
}
function closeSess(){Y.closeOverlay()}
function speakCur(){if(!sess||sess.i>=sess.items.length)return;const it=sess.items[sess.i];if(it.kind==="w"&&(it.mode==="listen"||(it.mode==="ja2zh"&&Y.S.settings.autoSpeak)))speak(it.w.kana||plain(it.w.ja))}
function renderSess(top){if(!sess)return;Y.updateOverlay(htmlSess(),{top})}
function htmlSess(){
  const S=Y.S;
  if(sess.i>=sess.items.length)return htmlDone();
  const it=sess.items[sess.i],a=sess.answered,n=sess.items.length;
  const W=it.w;let prompt="";
  if(it.kind==="q"){const qh=ruby(it.q).replace("（　）",`<span class="blank">${a!=null?ruby(it.right):"　"}</span>`);prompt=`<div class="eyebrow">选择填入空格的答案</div><div class="q jr" lang="ja">${qh}</div>${it.zh?`<div class="muted">${esc(it.zh)}</div>`:""}`}
  else if(it.mode==="zh2ja")prompt=`<div class="eyebrow">选出对应的日语</div><div class="zhbig">${esc(W.zh)}</div>${W.pos?`<div>${posTag(W.pos)}</div>`:""}`;
  else if(it.mode==="listen")prompt=`<div class="eyebrow">听发音，选意思</div><button class="listen" data-act="say" data-t="${esc(W.kana||plain(W.ja))}" aria-label="再听一遍">${IC.spk}</button>${a!=null?`<div class="big" lang="ja">${esc(plain(W.ja))}</div>`:""}`;
  else prompt=`<div class="eyebrow">${it.isNew?"新词":"复习"}${it.retry?" · 再来一次":""}</div><div class="big" lang="ja">${esc(plain(W.ja))}</div>${W.kana&&W.kana!==W.ja?`<div class="kana" lang="ja">${esc(W.kana)}</div>`:""}${W.pos?`<div>${posTag(W.pos)}</div>`:""}${sayBtn(W.kana||plain(W.ja))}`;
  const jaOpts=it.kind==="q"||it.mode==="zh2ja";
  const opts=it.opts.map((o,i)=>{let c="";if(a!=null){if(i===it.ans)c="ok";else if(i===a)c="no"}return `<button class="opt ${jaOpts?"ja":""} ${c}" ${jaOpts?'lang="ja"':""} data-act="pick" data-i="${i}" ${a!=null?"disabled":""}><span class="n">${i+1}</span>${it.kind==="q"?ruby(o):esc(jaOpts?plain(o):o)}</button>`}).join("");
  let reveal="";
  if(a!=null){const ok=a===it.ans;
    if(it.kind==="w")reveal=`<div class="card reveal"><div class="res ${ok?"ok":"no"}">${ok?"答对了"+(sess.combo>=3?` · ${sess.combo} 连击`:""):"记住它，稍后再考一次"}</div><div class="row"><div class="grow"><div class="wline"><span class="wja" lang="ja" style="font-size:24px">${esc(plain(W.ja))}</span>${W.kana&&W.kana!==W.ja?`<span class="wkana" lang="ja">${esc(W.kana)}</span>`:""}${posTag(W.pos)}</div><div>${esc(W.zh)}</div></div>${lvDots(W)}<div class="acts" style="display:flex;gap:6px">${speakCheckBtn(W)}${sayBtn(W.kana||plain(W.ja))}</div></div><button class="btn primary block" data-act="next">继续 <span class="small" style="opacity:.7">Enter</span></button></div>`;
    else{const full=it.q.replace("（　）",it.right);
      reveal=`<div class="card reveal"><div class="res ${ok?"ok":"no"}">${ok?"答对了"+(sess.combo>=3?` · ${sess.combo} 连击`:""):"正确答案是「"+ruby(it.right)+"」"}</div><div class="row"><span class="grow jr" lang="ja" style="font-family:var(--f-jp);font-size:17px">${ruby(full)}</span>${sayBtn(full,"朗读")}</div>${it.why?`<div class="why"><b>解析</b>　${ruby(it.why)}</div>`:""}<button class="btn primary block" data-act="next">继续 <span class="small" style="opacity:.7">Enter</span></button></div>`}
  }
  return `<div class="sin">
    <div class="shead"><button class="iconbtn" data-act="quit" aria-label="结束">${IC.close}</button><div class="bar grow"><i style="width:${sess.i/n*100}%"></i></div><span class="combo num">${sess.combo>=2?"×"+sess.combo:""}</span></div>
    <div class="prompt">${prompt}</div>
    <div class="opts">${opts}</div>
    ${a==null&&it.kind==="w"?`<button class="btn ghost" data-act="pick" data-i="-1">不认识</button>`:""}
    ${reveal}</div>`;
}
function htmlDone(){
  const S=Y.S;const acc=sess.total?Math.round(sess.correct/sess.total*100):0;
  const isQ=sess.type==="q";const perfect=isQ&&sess.correct===sess.total;
  return `<div class="sin"><div class="done">
    <span class="seal" lang="ja">${perfect?"満":acc>=80?"優":"済"}</span>
    <h2 style="font-size:24px">${isQ?(perfect?"全部答对":"练习完成"):"本轮完成"}</h2>
    <div class="muted">${esc(sess.title)}</div>
    <div class="dstats">
      <div class="stat"><b class="num">${isQ?sess.correct+"/"+sess.total:acc+"%"}</b><span>${isQ?"得分":"正确率"}</span></div>
      <div class="stat"><b class="num" style="color:var(--gold)">+${sess.xp}</b><span>XP</span></div>
      <div class="stat"><b class="num">${isQ?sess.maxCombo:sess.fresh}</b><span>${isQ?"最高连击":"新学单词"}</span></div>
    </div>
    <div class="card" style="width:100%"><div class="row" style="justify-content:space-between;margin-bottom:8px"><span class="small muted">今日进度</span><span class="small num">${S.days[today()]||0} / ${S.settings.goal} XP</span></div><div class="bar gold"><i style="width:${Math.min(100,(S.days[today()]||0)/S.settings.goal*100)}%"></i></div></div>
    <button class="btn primary block" data-act="quit">完成</button>
  </div></div>`;
}
function pick(i){
  const S=Y.S;
  if(!sess||sess.answered!=null||sess.i>=sess.items.length)return;const it=sess.items[sess.i];const ok=i===it.ans;sess.answered=i;
  if(!it.retry){sess.total++;if(ok)sess.correct++}
  sess.combo=ok?sess.combo+1:0;sess.maxCombo=Math.max(sess.maxCombo,sess.combo);S.maxCombo=Math.max(S.maxCombo||0,sess.combo);
  let gain=0;
  if(it.kind==="w"){
    const now=Date.now();let s=S.words[it.w.key];
    if(!s){s=S.words[it.w.key]={lv:0,due:now,r:0,x:0};sess.fresh++;S.nd=S.nd.d===today()?{d:S.nd.d,n:S.nd.n+1}:{d:today(),n:1};gain+=2}
    if(it.retry){if(ok){s.due=now+Y.DAY/2}}
    else if(ok){s.lv=Math.min(6,s.lv+1);s.due=now+Y.IV[s.lv];s.r++;gain+=3+(sess.combo>=5?2:0)}
    else{s.lv=Math.max(0,s.lv-2);s.due=now;s.x++;const at=Math.min(sess.i+4,sess.items.length);sess.items.splice(at,0,mkWordItem(it.w,true))}
    if(ok&&it.mode!=="ja2zh")speak(it.w.kana||plain(it.w.ja));
  }else{if(ok)gain+=5}
  sess.xp+=gain;Y.addXP(gain);
  if(sess.type==="q"&&sess.i===sess.items.length-1)finishQuiz();
  try{Y.checkBadges()}catch(e){console.error(e)}Y.save();
  renderSess();
}
function finishQuiz(){const S=Y.S;const l=Y.lesson(sess.lid);const prev=S.quiz[sess.lid]||0;if(sess.correct>prev)S.quiz[sess.lid]=sess.correct;if(sess.correct===sess.total&&l){sess.xp+=10;Y.addXP(10)}}
function next(){if(!sess||sess.answered==null)return;sess.i++;sess.answered=null;renderSess(true);speakCur()}
function sessKey(e){
  if(!sess)return false;
  if(e.key==="Escape"){closeSess();return true}
  if(sess.i>=sess.items.length){if(e.key==="Enter"){e.preventDefault();closeSess()}return true}
  if(sess.answered==null&&/^[1-4]$/.test(e.key)){const i=+e.key-1;if(i<sess.items[sess.i].opts.length)pick(i);return true}
  if(sess.answered!=null&&(e.key==="Enter"||e.key===" ")){e.preventDefault();next();return true}
  return false;
}

/* ============ 导航 ============ */
function openLesson(id,tab){const l=Y.lesson(id);if(!l)return;cv.lesson=l.id;cv.book=l.custom?null:l.book;cv.ltab=tab||"words";cv.seg="course";Y.go("course",{keep:true})}
function openBook(id){if(!Y.book(id))return;cv.book=id;cv.lesson=null;cv.seg="course";Y.go("course",{keep:true})}
function showWordbook(){cv.seg="words";cv.lesson=null;cv.book=null}

/* ============ 注册 ============ */
Y.registerTab({id:"course",label:"课程",icon:"book",order:20,render:vCourse,onShow:o=>{if(!o.keep&&o.from!=="course")cv.lesson=null}});
const A=Y.registerAction;
A("open",d=>openLesson(d.id,d.tab));
A("cbook",d=>openBook(d.id));
A("cback",()=>{if(cv.lesson){const l=Y.lesson(cv.lesson);cv.lesson=null;if(!l||l.custom)cv.book=null}else cv.book=null;Y.render();scrollTo(0,0)});
A("cseg",d=>{cv.seg=d.k==="words"?"words":"course";Y.render()});
A("clv",d=>{cv.lv=d.k;Y.store.set("course-lv",d.k);Y.render()});
A("ltab",d=>{cv.ltab=d.k;Y.render()});
A("gjump",d=>{const el=document.getElementById("g-"+d.i);if(el)el.scrollIntoView({behavior:"smooth",block:"start"})});
/* 「我学会了」每个语法点只奖励一次 XP；当天撤销会扣回，之后再点可以重新拿（防止反复点刷 XP） */
A("gram",d=>{const S=Y.S,k=d.k;
  if(S.grammar[k]){delete S.grammar[k];const back=Y.xpRevoke("g:"+k,10);if(back)Y.toast("已撤销 · −"+back+" XP")}
  else{S.grammar[k]=today();const got=Y.xpOnce("g:"+k,10);Y.toast(got?"+"+got+" XP":"已标记为掌握（这个语法点以前拿过 XP）")}
  Y.checkBadges();Y.save();Y.render()});
/* 没学过的词排最前（-1），其余按熟练度从低到高 */
const lvOrNeg=w=>{const st=Y.wordState(w);return st&&st.lv!=null?st.lv:-1};
A("lwords",()=>{const l=Y.lesson(cv.lesson);if(!l)return;const order=l.words.slice().sort((a,b)=>lvOrNeg(a)-lvOrNeg(b));startWords(order.slice(0,15),(l.no?`第${l.no}课 `:"")+"单词")});
A("lquiz",()=>startQuiz(Y.lesson(cv.lesson)));
A("settrack",d=>{if(!Y.book(d.id))return;Y.S.settings.track=d.id;Y.save();Y.render();Y.toast("每日新词改为从「"+esc(Y.book(d.id).t)+"」出")});
A("addvid",(d,form)=>{const S=Y.S;const vu=form.querySelector("#vu"),vt=form.querySelector("#vt");const u=Y.safeUrl(vu&&vu.value);if(!u){Y.toast("链接要以 http:// 或 https:// 开头");return}const l=cv.lesson;(S.videos[l]=S.videos[l]||[]).push({t:((vt&&vt.value)||"").trim().slice(0,80),u});Y.save();Y.render();Y.toast("已添加链接")});
A("delvid",d=>{const S=Y.S;const l=cv.lesson;(S.videos[l]||[]).splice(+d.i,1);Y.save();Y.render()});
A("wf",d=>{cv.wfilter=d.k;cv.limit=150;Y.render()});
/* 搜索：停止输入 0.2 秒后再刷新（每个字都整页重算在慢手机上会卡） */
let wqT=null;
A("wq",(d,el)=>{cv.q=el.value;clearTimeout(wqT);wqT=setTimeout(()=>{cv.limit=150;Y.render()},200)});
A("wbook",(d,el)=>{cv.wbook=el.value;cv.limit=150;Y.render()});
A("wmore",()=>{cv.limit+=150;Y.render()});
A("review",()=>startWords(Y.dueWords().slice(0,30),"复习"));
A("pick",d=>pick(+d.i));
A("next",()=>next());
A("quit",()=>closeSess());

Y.startWords=startWords;Y.startQuiz=startQuiz;Y.openLesson=openLesson;Y.openBook=openBook;
Y.course={open:openLesson,openBook,showWordbook,startWords,startQuiz,state:cv};
})();
