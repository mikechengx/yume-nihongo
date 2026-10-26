/* Yume · 今日（js/home.js）——首页：品牌与连胜、问候与称号、一言短句轮播、存档提醒、今日任务、「接着学」列表（课程、五十音 + 模块的 home-row） */
(function(){
"use strict";
const Y=window.Yume;
const {esc,IC,ring,dkey,today,shuffle,plain}=Y;

function nextLesson(){
  const all=Y.allLessons();if(!all.length)return null;
  const tb=Y.trackBook().id;
  return Y.bookLessons(tb).find(l=>Y.lessonProg(l)<.999)||all.find(l=>!l.custom&&Y.lessonProg(l)<.999)||all.find(l=>Y.lessonProg(l)<.999)||all[0];
}
/* ============ 首页「接着学」列表的一行（模块通过 registerCard("home-row") 提供） ============ */
function homeRow(o){
  o=o||{};const data=o.data||{};
  const attrs=Object.keys(data).map(k=>` data-${k}="${esc(data[k])}"`).join("");
  return `<button class="hrow" data-act="${esc(o.act||"")}"${attrs}>
    <span class="hico ${o.tone||""}"${o.ja?' lang="ja"':""}>${o.icon||""}</span>
    <span class="grow"><span class="eyebrow">${esc(o.eyebrow||"")}</span><b>${esc(o.title||"")}</b>${o.sub?`<span class="small muted">${esc(o.sub)}</span>`:""}</span>
    ${IC.go}</button>`;
}
Y.homeRow=homeRow;
const ringIcon=(p,txt,color)=>`<span class="hring">${ring(p,40,4,color)}<span>${esc(txt)}</span></span>`;

/* ============ 一言：日语短句，自动轮换（不提供手动切换） ============ */
const Q_MS=15000;
const QT={order:[],i:0,timer:null,acc:0};
const reduced=()=>{try{return window.matchMedia("(prefers-reduced-motion: reduce)").matches}catch(e){return false}};
function qList(){return Y.quotes?Y.quotes():[]}
function qEnsure(){const n=qList().length;if(QT.order.length!==n){QT.order=shuffle([...Array(n).keys()]);QT.i=0}}
function qCur(){qEnsure();const l=qList();return l.length?l[QT.order[QT.i%l.length]]:null}
function quoteInner(){
  const q=qCur();if(!q)return "";
  return `<div class="hq-ja" lang="ja">${Y.ruby(q[0]).replace(/([、。！？])/g,"$1<wbr>").replace(/　/g,"　<wbr>")}</div>
    <div class="hq-zh">${esc(q[1])}</div>
    <div class="hq-foot">${q[3]&&q[3]!=="yume"?`<span class="small muted">${esc(q[3])}</span>`:""}<span class="grow"></span><button class="iconbtn" data-act="hq-say" aria-label="朗读这句">${IC.spk}</button></div>
    ${reduced()?"":`<span class="hq-bar" aria-hidden="true"></span>`}`;
}
function quoteCard(){const q=qCur();if(!q)return "";return `<section class="hq ${q[2]}" id="hq" aria-label="日语短句" aria-live="off">${quoteInner()}</section>`}
function qShow(){
  const n=qList().length;if(!n)return;QT.i=(QT.i+1)%n;QT.acc=0;
  const el=document.getElementById("hq");if(!el)return;
  const q=qCur();const swap=()=>{el.className="hq "+q[2];el.innerHTML=quoteInner()};
  if(reduced()){swap();return}
  el.classList.add("out");setTimeout(()=>{swap();el.classList.remove("out")},220);
}
function qTick(){
  if(document.hidden||Y.ui.tab!=="home")return;
  const el=document.getElementById("hq");if(!el)return;
  if(el.matches(":hover")||el.contains(document.activeElement))return;  /* 鼠标停在上面或正在点朗读时先不换 */
  QT.acc+=1000;if(QT.acc>=Q_MS)qShow();
}
function qBind(){
  const el=document.getElementById("hq");if(!el||el.dataset.bound)return;el.dataset.bound="1";QT.acc=0;
  if(!QT.timer)QT.timer=setInterval(qTick,1000);
}
Y.registerAction("hq-say",()=>{const q=qCur();if(q)Y.speak(plain(q[0]).replace(/[　\s]+/g," "))});

/* ============ 首页 ============ */
function vHome(){
  const S=Y.S;
  const h=new Date().getHours();
  const greet=h<11?"おはよう":h<18?"こんにちは":"こんばんは";
  const sub=h<11?"早上好":h<18?"下午好":"晚上好";
  const p=Y.plan(),txp=S.days[today()]||0,goal=S.settings.goal,s=Y.streak(),L=Y.level();
  const total=p.due.length+p.fresh.length;
  const tb=Y.trackBook();const freshFrom=p.fresh.length?Y.lesson(p.fresh[0].lid):null;
  const offTrack=freshFrom&&freshFrom.book!==tb.id;
  const ct=Y.curTitle(),nt=Y.nextTitle();
  /* 接着学：课程、五十音，加上各模块提供的行（会话、计划/自测） */
  const rows=[];
  const next=nextLesson();
  if(next){const nb=Y.book(next.book);rows.push(homeRow({act:"open",data:{id:next.id},icon:ringIcon(Y.lessonProg(next),String(next.no||"＋"),"var(--ai)"),eyebrow:"课程"+(nb?` · ${nb.lv} ${nb.t}`:""),title:(next.no?`第${next.no}课 `:"")+next.t,sub:plain(next.s||"")}))}
  const K=Y.kana;
  if(K&&K.KL){const hn=K.next("h"),kn=K.next("k");const sc=hn<K.KL.length?"h":"k";const n=sc==="h"?hn:kn;
    if(!(n===K.KL.length&&sc==="k")){const L2=K.KL[Math.max(0,n)];const all=K.done("h")+K.done("k");
      rows.push(homeRow({act:"kgoto",data:{sc},icon:ringIcon(all/(K.KL.length*2),sc==="h"?"あ":"ア","var(--gold)"),ja:true,eyebrow:"五十音 · "+(sc==="h"?"平假名":"片假名"),title:n<0?"继续闯关":`第 ${n+1} 关 · ${L2.t}`,sub:`已获得 ${K.totalStars()} 颗星`}))}}
  const more=Y.cards("home-row");
  return `<div class="stack home">
  <header class="hhead">
    <div class="brand"><span class="logo" lang="ja" aria-hidden="true">夢<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1.5c.7 5.2 2.3 6.8 9.5 10.5-7.2 3.7-8.8 5.3-9.5 10.5-.7-5.2-2.3-6.8-9.5-10.5C9.7 8.3 11.3 6.7 12 1.5z"/></svg></span><div class="wm"><b><span>yume</span> 愚昧酱日语</b><small>从愚昧到梦想</small></div></div>
    <div class="row" style="gap:6px"><span class="chip gold" title="连续学习天数">${IC.flame}<b class="num">${s}</b></span><span class="chip ai">Lv <b class="num">${L.k}</b></span></div>
  </header>
  <div class="hgreet"><span class="greet" lang="ja">${greet}</span><span class="small muted">${sub} · <span class="htitle">${ct?"「"+esc(ct.t)+"」":"见习生"}</span>${nt?` · 再连续 <b class="num">${nt.d-s}</b> 天解锁「${esc(nt.t)}」`:""}</span></div>
  ${quoteCard()}
  ${Y.backupDue()?`<button class="hnote" data-act="gobackup"><span class="seal" lang="ja">存</span><span class="grow">${S.lastBackup?`已经 ${Y.backupDays()} 天没存档了`:"给学习进度存个档吧"}</span>${IC.go}</button>`:""}
  <div class="slot stack">${Y.cards("home")}</div>
  <div class="card goal">
    <div class="ring">${ring(txp/goal,104,10,"var(--gold)")}<div class="c"><b class="num">${txp}</b><span class="small muted num">/ ${goal} XP</span></div></div>
    <div class="stack" style="gap:12px">
      <div><div class="eyebrow">今日任务 · 每日单词</div>
      <div class="plan"><span><b class="num">${p.due.length}</b>个复习</span><span><b class="num">${p.fresh.length}</b>个新词</span></div>
      <div class="small muted" style="margin-top:2px">新词来自「${esc(tb.lv+" "+tb.t)}」${offTrack?`（本册已学完，先学「${esc((Y.book(freshFrom.book)||{t:"自制课程"}).t)}」）`:""}</div></div>
      ${total?`<button class="btn primary block" data-act="daily">${IC.play}开始今日学习</button>`:`<div class="row small" style="color:var(--good)">${IC.check}今天的单词任务完成了</div><button class="btn block" data-act="free">再练 15 个</button>`}
    </div>
  </div>
  ${rows.length||more?`<div class="card hlist"><div class="eyebrow hl-h">接着学</div>${rows.join("")}${more}</div>`:""}
  </div>`;
}
Y.onRender(()=>{if(Y.ui.tab==="home")qBind()});

/* ============ 课程升级提示（老用户只看一次） ============
 * 新版每课的单词、语法、练习都变多了，旧版学完的第 1–12 课会显示没满 100%。进度本身都还在，这里说明一下。
 * S.notice.v2：""=还没判断；"show"=要显示；日期=已经看过 / 新用户不需要 */
Y.registerState("notice",{});
const oldLesson=lid=>/^\d+$/.test(lid)&&+lid>=1&&+lid<=12;
function hadOldProgress(){
  const S=Y.S;
  return Object.keys(S.words).some(k=>oldLesson(k.split(":")[0]))||Object.keys(S.grammar).some(k=>oldLesson(k.split("-")[0]))||Object.keys(S.quiz).some(oldLesson);
}
function checkUpgrade(){
  const S=Y.S;if(!S.notice||typeof S.notice!=="object")S.notice={};
  if(S.notice.v2)return;
  /* 只改内存，不在这里 save()：刚打开页面时保存会刷新 S.updated，可能让还没拉下来的云端进度被本机空进度覆盖。
   * 标记会随下一次正常保存写入；「知道了」时立即保存。 */
  S.notice.v2=hadOldProgress()?"show":today();
  if(S.notice.v2==="show")setTimeout(()=>{if(Y.ui.tab==="home")Y.render()},0);
}
function upgradeCard(){
  const S=Y.S;if(!S.notice||S.notice.v2!=="show")return "";
  const ls=Y.bookLessons("b1").filter(l=>oldLesson(l.id));
  const todo=ls.filter(l=>{const p=Y.lessonProg(l);return p>0&&p<.999});
  const first=todo[0]||ls[0];
  return `<div class="card stack" style="gap:10px;background:var(--ai-soft);box-shadow:none">
    <div class="row" style="gap:12px;align-items:flex-start"><span class="seal" lang="ja" style="border-color:var(--ai);color:var(--ai)">新</span>
      <div class="grow"><b>课程升级了：每课的单词、语法和练习都变多了</b>
      <div class="small" style="margin-top:4px">所以之前学完的课现在会显示没满 100%、练习的「最佳成绩」分母也变大了。<b>你的单词、语法和练习进度都还在</b>，把每课新增的部分学一学，就能重新拿到「済」。${todo.length?`<br>初级上第 1–12 课里有 <b class="num">${todo.length}</b> 课需要补新内容。`:""}</div></div></div>
    <div class="row" style="gap:8px">${first?`<button class="btn primary sm grow" data-act="home-upgo" data-id="${esc(first.id)}">去看第 ${first.no} 课</button>`:""}<button class="btn sm grow" data-act="home-upok">知道了</button></div>
  </div>`;
}
Y.registerCard("home",upgradeCard,{order:-10});
Y.onRender(()=>{try{checkUpgrade()}catch(e){console.error(e)}});
Y.registerAction("home-upok",()=>{Y.S.notice.v2=today();Y.save();Y.render()});
Y.registerAction("home-upgo",d=>{Y.S.notice.v2=today();Y.save();if(Y.openLesson)Y.openLesson(d.id);else Y.render()});

Y.registerTab({id:"home",label:"今日",icon:"home",order:0,render:vHome});
Y.registerAction("daily",()=>{const p=Y.plan();Y.startWords(shuffle(p.due).concat(p.fresh),"今日学习")});
Y.registerAction("free",()=>{const pool=Y.allWords().filter(w=>Y.wordState(w));Y.startWords(shuffle(pool.length?pool:Y.allWords()).slice(0,15),"自由练习")});
})();
