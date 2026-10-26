/* Yume · 五十音闯关（js/kana.js）——从旧版原样迁移，功能不变。
 * 进度存在 S.kana = {lv:{"h0":3,...}, m:{"あ":2,...}}，与旧版一致。
 */
(function(){
"use strict";
const Y=window.Yume;
const {esc,shuffle,IC,speak,ring}=Y;
const K=()=>Y.S.kana;

/* ============ 数据 ============ */
const KR=[
{id:"a",sec:0,n:"あ行",k:"あ い う え お",r:"a i u e o"},
{id:"k",sec:0,n:"か行",k:"か き く け こ",r:"ka ki ku ke ko"},
{id:"s",sec:0,n:"さ行",k:"さ し す せ そ",r:"sa shi su se so"},
{id:"t",sec:0,n:"た行",k:"た ち つ て と",r:"ta chi tsu te to"},
{id:"n",sec:0,n:"な行",k:"な に ぬ ね の",r:"na ni nu ne no"},
{id:"h",sec:0,n:"は行",k:"は ひ ふ へ ほ",r:"ha hi fu he ho"},
{id:"m",sec:0,n:"ま行",k:"ま み む め も",r:"ma mi mu me mo"},
{id:"y",sec:0,n:"や行",k:"や ゆ よ",r:"ya yu yo",slots:[0,null,1,null,2]},
{id:"r",sec:0,n:"ら行",k:"ら り る れ ろ",r:"ra ri ru re ro"},
{id:"w",sec:0,n:"わ行",k:"わ を ん",r:"wa wo n",slots:[0,null,null,null,1,2]},
{id:"g",sec:1,n:"が行",k:"が ぎ ぐ げ ご",r:"ga gi gu ge go"},
{id:"z",sec:1,n:"ざ行",k:"ざ じ ず ぜ ぞ",r:"za ji zu ze zo"},
{id:"d",sec:1,n:"だ行",k:"だ ぢ づ で ど",r:"da di du de do"},
{id:"b",sec:1,n:"ば行",k:"ば び ぶ べ ぼ",r:"ba bi bu be bo"},
{id:"p",sec:1,n:"ぱ行",k:"ぱ ぴ ぷ ぺ ぽ",r:"pa pi pu pe po"},
{id:"ky",sec:2,n:"きゃ",k:"きゃ きゅ きょ",r:"kya kyu kyo"},
{id:"sh",sec:2,n:"しゃ",k:"しゃ しゅ しょ",r:"sha shu sho"},
{id:"ch",sec:2,n:"ちゃ",k:"ちゃ ちゅ ちょ",r:"cha chu cho"},
{id:"ny",sec:2,n:"にゃ",k:"にゃ にゅ にょ",r:"nya nyu nyo"},
{id:"hy",sec:2,n:"ひゃ",k:"ひゃ ひゅ ひょ",r:"hya hyu hyo"},
{id:"my",sec:2,n:"みゃ",k:"みゃ みゅ みょ",r:"mya myu myo"},
{id:"ry",sec:2,n:"りゃ",k:"りゃ りゅ りょ",r:"rya ryu ryo"},
{id:"gy",sec:2,n:"ぎゃ",k:"ぎゃ ぎゅ ぎょ",r:"gya gyu gyo"},
{id:"j",sec:2,n:"じゃ",k:"じゃ じゅ じょ",r:"ja ju jo"},
{id:"by",sec:2,n:"びゃ",k:"びゃ びゅ びょ",r:"bya byu byo"},
{id:"py",sec:2,n:"ぴゃ",k:"ぴゃ ぴゅ ぴょ",r:"pya pyu pyo"}
];
const KSEC=["清音","浊音 · 半浊音","拗音"];
const toKata=s=>String(s).replace(/[ぁ-ゖ]/g,c=>String.fromCharCode(c.charCodeAt(0)+0x60));
const ROW=id=>KR.find(r=>r.id===id);
function rowKana(id,sc){const r=ROW(id);const ks=r.k.split(" "),rs=r.r.split(" ");return ks.map((k,i)=>({k:sc==="k"?toKata(k):k,r:rs[i]}))}
/* 输入罗马音时也接受的写法 */
const ALT={shi:["si"],chi:["ti"],tsu:["tu"],fu:["hu"],ji:["zi"],wo:["o"],n:["nn"],di:["ji"],du:["zu","dzu"],sha:["sya"],shu:["syu"],sho:["syo"],cha:["tya","cya"],chu:["tyu","cyu"],cho:["tyo","cyo"],ja:["zya","jya"],ju:["zyu","jyu"],jo:["zyo","jyo"]};
const ALL_SEION=["a","k","s","t","n","h","m","y","r","w"];
const ALL_ROWS=KR.map(r=>r.id);
const KL=[
{t:"あ行",rows:["a"]},{t:"か行",rows:["k"]},{t:"さ行",rows:["s"]},{t:"た行",rows:["t"]},{t:"な行",rows:["n"]},
{t:"关卡挑战 Ⅰ",boss:["a","k","s","t","n"]},
{t:"は行",rows:["h"]},{t:"ま行",rows:["m"]},{t:"や行・わ行",rows:["y","w"]},{t:"ら行",rows:["r"]},
{t:"清音大挑战",boss:ALL_SEION},
{t:"浊音 が・ざ",rows:["g","z"]},{t:"浊音 だ・ば",rows:["d","b"]},{t:"半浊音 ぱ",rows:["p"]},
{t:"拗音 Ⅰ",rows:["ky","sh","ch","ny","hy"]},{t:"拗音 Ⅱ",rows:["my","ry","gy","j","by","py"]},
{t:"终极挑战",boss:ALL_ROWS,final:true}
];
const KSECT_AT={0:"清音",11:"浊音 · 半浊音",14:"拗音"};
const KATA_WORDS=[["コーヒー","咖啡"],["テレビ","电视"],["カメラ","相机"],["ノート","笔记本"],["パン","面包"],["バス","公交车"],["トイレ","厕所"],["デパート","百货商店"],["ケーキ","蛋糕"],["ホテル","酒店"],["タクシー","出租车"],["メモ","便条"],["ペン","笔"],["ゲーム","游戏"],["アニメ","动画"],["ピアノ","钢琴"],["ラーメン","拉面"],["スキー","滑雪"],["メニュー","菜单"],["ベッド","床"],["スポーツ","运动"],["ニュース","新闻"]];

/* 罗马音转换（读单词题用） */
const RMAP=(()=>{const m={};for(const r of KR){const ks=r.k.split(" "),rs=r.r.split(" ");ks.forEach((k,i)=>{m[k]=rs[i];m[toKata(k)]=rs[i]})}m["を"]="o";m["ヲ"]="o";return m})();
function toRomaji(s){let out="",dbl=false;const a=[...s];
  for(let i=0;i<a.length;i++){let c=a[i];
    if(c==="っ"||c==="ッ"){dbl=true;continue}
    if(c==="ー"){const v=out.match(/[aiueo]$/);if(!v)return null;out+=v[0];continue}
    let r=null;if(i+1<a.length&&/[ゃゅょャュョ]/.test(a[i+1])&&RMAP[c+a[i+1]]){r=RMAP[c+a[i+1]];i++}else r=RMAP[c];
    if(!r)return null;if(dbl){out+=r.startsWith("ch")?"t":r[0];dbl=false}out+=r}
  return dbl?null:out}

/* ============ 进度 ============ */
const kid=(sc,i)=>sc+i;
const kStars=(sc,i)=>(K().lv[kid(sc,i)]||0);
function kUnlocked(sc,i){if(i===0)return sc==="h"||kStars("h",5)>0;return kStars(sc,i-1)>0}
function kNext(sc){for(let i=0;i<KL.length;i++)if(!kStars(sc,i))return kUnlocked(sc,i)?i:-1;return KL.length}
function kDone(sc){return KL.filter((_,i)=>kStars(sc,i)>0).length}
function kTotalStars(){let n=0;const lv=K().lv;for(const k in lv)n+=lv[k];return n}
function kLearnedRows(sc,upto){const set=new Set();for(let i=0;i<upto;i++){const L=KL[i];for(const r of(L.rows||L.boss))set.add(r)}return [...set]}
function kMastered(){return Object.values(K().m).filter(v=>v>=3).length}

/* ============ 页面 ============ */
const ui={ktab:"h",kchart:"h"};
function vKana(){
  const tab=ui.ktab;const hd=kDone("h"),kd=kDone("k");
  const head=`<div><div class="eyebrow">五十音 · 平假名与片假名</div><h1 style="font-size:24px">假名闯关</h1></div>
  <div class="stats"><div class="stat"><b class="num">${hd+kd}<small class="muted" style="font-size:13px">/${KL.length*2}</small></b><span>已过关卡</span></div><div class="stat"><b class="num" style="color:var(--gold)">${kTotalStars()}</b><span>获得星星</span></div><div class="stat"><b class="num">${kMastered()}</b><span>熟悉的假名</span></div></div>
  <div class="tabs" role="tablist">${[["h","平假名"],["k","片假名"],["chart","五十音图"]].map(([k,n])=>`<button role="tab" class="${tab===k?"on":""}" data-act="ktab" data-k="${k}">${n}</button>`).join("")}</div>`;
  if(tab==="chart")return `<div class="stack">${head}${vChart()}</div>`;
  const sc=tab,nx=kNext(sc);
  const OFF=[0,44,66,44,0,-44,-66,-44];
  let path="";
  KL.forEach((L,i)=>{
    if(KSECT_AT[i]!==undefined)path+=`<div class="ksec">${KSECT_AT[i]}</div>`;
    const st=kStars(sc,i),un=kUnlocked(sc,i),cur=i===nx;
    const glyph=L.boss?"関":(sc==="k"?toKata(ROW(L.rows[0]).k.split(" ")[0]):ROW(L.rows[0]).k.split(" ")[0]);
    const cls=st?"done":cur?"cur":un?"open":"lock";
    path+=`<div class="kwrap" style="transform:translateX(${OFF[i%8]}px)">
      ${cur?`<span class="kbubble">${st?"再练":"开始"}</span>`:""}
      <button class="knode ${cls} ${L.boss?"boss":""}" data-act="klevel" data-sc="${sc}" data-i="${i}" ${un?"":"disabled"} aria-label="第${i+1}关 ${esc(L.t)}" lang="ja">${un?glyph:IC.lock}</button>
      <div class="kstars">${[1,2,3].map(n=>`<span class="${st>=n?"on":""}">${IC.star}</span>`).join("")}</div>
      <div class="klabel">${esc(L.t)}</div></div>`;
  });
  const lockNote=sc==="k"&&!kUnlocked("k",0)?`<div class="card small muted" style="text-align:center">先通过平假名的「关卡挑战 Ⅰ」，就能解锁片假名。</div>`:"";
  return `<div class="stack">${head}${lockNote}<div class="kpath">${path}<div class="kend" lang="ja">${kDone(sc)===KL.length?"全部通关":"ゴール"}</div></div></div>`;
}
function vChart(){
  const sc=ui.kchart;
  const cell=x=>{if(!x)return `<span class="kcell empty"></span>`;const m=K().m[x.k]||0;return `<button class="kcell ${m>=3?"m2":m>=1?"m1":""}" data-act="say" data-t="${esc(x.k)}" lang="ja">${esc(x.k)}<small>${esc(x.r)}</small></button>`};
  let html=`<div class="row" style="justify-content:space-between;flex-wrap:wrap"><div class="filters">${[["h","平假名"],["k","片假名"]].map(([k,n])=>`<button class="${sc===k?"on":""}" data-act="kchart" data-k="${k}">${n}</button>`).join("")}</div><span class="small muted">点一下听发音 · 蓝=学过 绿=熟悉</span></div>`;
  KSEC.forEach((name,si)=>{
    const rows=KR.filter(r=>r.sec===si);
    html+=`<div class="card stack" style="gap:10px"><div class="eyebrow">${name}</div><div class="kgrid ${si===2?"y3":""}">`;
    for(const r of rows){const xs=rowKana(r.id,sc);
      if(r.slots){const s=r.slots.slice(0,5).map(j=>j==null?null:xs[j]);html+=s.map(cell).join("");if(r.slots.length>5)html+=cell(xs[r.slots[5]])+`<span class="kcell empty"></span>`.repeat(4)}
      else html+=xs.map(cell).join("")}
    html+=`</div></div>`;
  });
  return html+`<div class="small muted">ぢ、づ 读音和 じ、ず 相同，这里按输入法的写法记作 di、du。を 读 o，只用作助词。</div>`;
}
/* 首页上的五十音卡片（home.js 调用） */
function homeCard(){
  const hn=kNext("h"),kn=kNext("k");const sc=hn<KL.length?"h":"k";const n=sc==="h"?hn:kn;const all=kDone("h")+kDone("k");
  if(n===KL.length&&sc==="k")return "";const L2=KL[Math.max(0,n)];
  return `<button class="card lesson" data-act="kgoto" data-sc="${sc}">
    <div class="lnum">${ring(all/(KL.length*2),52,5,"var(--gold)")}<span lang="ja">${sc==="h"?"あ":"ア"}</span></div>
    <div class="grow"><div class="eyebrow">五十音闯关 · ${sc==="h"?"平假名":"片假名"}</div><div class="lt">${n<0?"继续闯关":"第 "+(n+1)+" 关 · "+esc(L2.t)}</div><div class="ls">已获得 <b class="num" style="color:var(--gold)">${kTotalStars()}</b> 颗星</div></div>
    ${IC.go}</button>`;
}

/* ============ 闯关会话 ============ */
let ks=null;
const pickN=(a,n)=>shuffle(a).slice(0,n);
const hom=r=>({di:"ji",du:"zu",wo:"o"}[r]||r);
const jaVoice=()=>Y.tts.ja();
function kOpts(item,pool,field){const seen=new Set([item[field]]),out=[item[field]];for(const x of shuffle(pool)){if(out.length>=4)break;if(hom(x.r)===hom(item.r))continue;if(!seen.has(x[field])){seen.add(x[field]);out.push(x[field])}}const o=shuffle(out);return{opts:o,ans:o.indexOf(item[field])}}
function kQ(type,item,pool){
  if(type==="listen"&&!jaVoice())type="r2k";
  if(type==="type")return{t:"type",x:item};
  const field=type==="k2r"?"r":"k";return Object.assign({t:type,x:item},kOpts(item,pool,field));
}
function kWordQs(sc,allowed,n){
  let list;
  if(sc==="k")list=KATA_WORDS.map(([w,zh])=>({w,zh}));
  else list=Y.allWords().filter(w=>/^[ぁ-ゖ]+$/.test(w.kana)).map(w=>({w:w.kana,zh:w.zh}));
  list=list.map(o=>Object.assign(o,{ro:toRomaji(o.w)})).filter(o=>o.ro&&[...o.w].every(c=>allowed.has(c)));
  const uniq=[];const seen=new Set();for(const o of shuffle(list)){if(!seen.has(o.ro)){seen.add(o.ro);uniq.push(o)}}
  const pick=uniq.slice(0,n);
  return pick.map(o=>{const opts=shuffle([o.ro,...shuffle(uniq.filter(x=>x.ro!==o.ro)).slice(0,3).map(x=>x.ro)]);return{t:"word",x:o,opts,ans:opts.indexOf(o.ro)}});
}
function buildLevel(sc,i){
  const L=KL[i];const prev=kLearnedRows(sc,i).flatMap(r=>rowKana(r,sc));
  const qs=[];
  if(L.boss){
    const pool=L.boss.flatMap(r=>rowKana(r,sc));
    const allowed=new Set(pool.map(x=>x.k).join("").split(""));
    if(sc==="k")allowed.add("ー");if(L.final){allowed.add(sc==="k"?"ッ":"っ")}
    const types=["k2r","r2k","listen","k2r","r2k","type","k2r","listen","r2k","type"];
    pickN(pool,10).forEach((x,j)=>qs.push(kQ(types[j%types.length],x,pool)));
    qs.splice(4,0,{t:"match",pairs:pickN(pool,5)});
    const wq=kWordQs(sc,allowed,4);qs.push(...wq);
    return shuffle(qs.slice(0,4)).concat(qs.slice(4));
  }
  const fresh=L.rows.flatMap(r=>rowKana(r,sc));const pool=prev.concat(fresh);
  if(fresh.length<=6){
    fresh.forEach((x,j)=>{qs.push({t:"intro",xs:[x]});qs.push(kQ(j%2?"r2k":"k2r",x,pool));if(j>=1)qs.push(kQ("listen",fresh[Math.floor(Math.random()*j)],pool))});
  }else{
    L.rows.forEach(r=>{const xs=rowKana(r,sc);qs.push({t:"intro",xs});(L.rows.length>2?pickN(xs,2):xs).forEach((x,j)=>qs.push(kQ(j%2?"r2k":"k2r",x,pool)))});
  }
  qs.push({t:"match",pairs:pickN(fresh,Math.min(5,fresh.length)).concat(fresh.length<5?pickN(prev,5-fresh.length):[])});
  const mix=shuffle(fresh.concat(pickN(prev,3)));
  ["type","k2r","listen","type","r2k"].forEach((t,j)=>{const x=mix[j%mix.length];qs.push(kQ(t,x,pool))});
  return qs;
}
function startLevel(sc,i){
  if(!kUnlocked(sc,i))return;
  ks={sc,i,q:buildLevel(sc,i),p:0,hearts:3,miss:0,score:0,combo:0,maxCombo:0,fb:null,total:0,right:0,sel:null,gone:[],typed:"",pop:0};
  ks.q.forEach(q=>{if(q.t==="match"){q.left=shuffle(q.pairs.map((_,j)=>j));q.right=shuffle(q.pairs.map((_,j)=>j))}});
  Y.openOverlay(htmlKS(),{onKey:kKey,onClose:()=>{ks=null},rerender:renderKS});
  afterKS();kSpeakCur();
}
function kClose(){Y.closeOverlay()}
function kSpeakCur(){if(!ks||ks.p>=ks.q.length)return;const q=ks.q[ks.p];if(q.t==="intro"&&q.xs.length===1)speak(q.xs[0].k);else if(q.t==="listen")speak(q.x.k)}
const heartsHTML=n=>`<span class="hearts" aria-label="剩余 ${n} 颗心">${[0,1,2].map(j=>`<span class="${j<n?"":"off"}">${IC.heart}</span>`).join("")}</span>`;
function renderKS(top){if(!ks)return;Y.updateOverlay(htmlKS(),{top});afterKS()}
function afterKS(){ks&&(ks.pop=0);const inp=document.getElementById("kin");if(inp&&ks&&!ks.fb)inp.focus()}
function htmlKS(){
  if(ks.hearts<=0&&!ks.fb)return kFail();
  if(ks.p>=ks.q.length)return kWin();
  const q=ks.q[ks.p],fb=ks.fb;
  let body="";
  if(q.t==="intro"){
    body=q.xs.length===1?`<div class="prompt"><div class="eyebrow">新假名</div><button class="kintro" data-act="say" data-t="${esc(q.xs[0].k)}" lang="ja">${esc(q.xs[0].k)}</button><div class="kro">${esc(q.xs[0].r)}</div><div class="small muted">点假名可以再听一遍</div></div>`
      :`<div class="prompt"><div class="eyebrow">新的一行</div><div class="introrow">${q.xs.map(x=>`<button class="kcell" data-act="say" data-t="${esc(x.k)}" lang="ja">${esc(x.k)}<small>${esc(x.r)}</small></button>`).join("")}</div><div class="small muted">逐个点一下听发音，记住它们</div></div>`;
    body+=`<button class="btn primary block" data-act="kgo">记住了，继续</button>`;
  }else if(q.t==="match"){
    const cellL=j=>{const g=ks.gone.includes(j);return `<button class="opt ja ${g?"gone":""} ${ks.sel===j?"sel":""}" lang="ja" data-act="kml" data-j="${j}" ${g?"disabled":""}>${esc(q.pairs[j].k)}</button>`};
    const cellR=j=>{const g=ks.gone.includes(j);return `<button class="opt ${g?"gone":""} ${ks.bad===j?"no":""}" data-act="kmr" data-j="${j}" ${g?"disabled":""}>${esc(q.pairs[j].r)}</button>`};
    body=`<div class="prompt"><div class="eyebrow">配对</div><div class="q">把假名和读音连起来</div></div><div class="match"><div class="col">${q.left.map(cellL).join("")}</div><div class="col">${q.right.map(cellR).join("")}</div></div>`;
  }else if(q.t==="type"){
    body=`<div class="prompt"><div class="eyebrow">写出读音</div><div class="big" lang="ja">${esc(q.x.k)}</div></div>
      <form id="kform" class="stack" style="gap:10px" data-submit="ktype"><input type="text" id="kin" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="输入罗马音，例如 ka" value="${esc(ks.typed)}" ${fb?"disabled":""} class="kinput">${fb?"":`<button class="btn primary block" type="submit">检查</button>`}</form>`;
  }else{
    let prompt;
    if(q.t==="k2r")prompt=`<div class="eyebrow">选出读音</div><div class="big" lang="ja">${esc(q.x.k)}</div>`;
    else if(q.t==="r2k")prompt=`<div class="eyebrow">选出对应的假名</div><div class="big">${esc(q.x.r)}</div>`;
    else if(q.t==="listen")prompt=`<div class="eyebrow">听发音，选假名</div><button class="listen" data-act="say" data-t="${esc(q.x.k)}" aria-label="再听一遍">${IC.spk}</button>`;
    else prompt=`<div class="eyebrow">读单词 · ${esc(q.x.zh)}</div><div class="big" lang="ja" style="font-size:clamp(34px,10vw,52px)">${esc(q.x.w)}</div>`;
    const jaOpt=q.t==="r2k"||q.t==="listen";
    body=`<div class="prompt">${prompt}</div><div class="opts">${q.opts.map((o,j)=>{let c="";if(fb){if(j===q.ans)c="ok";else if(j===fb.pick)c="no"}return `<button class="opt ${jaOpt?"ja":""} ${c}" ${jaOpt?'lang="ja"':""} data-act="kpick" data-j="${j}" ${fb?"disabled":""}><span class="n">${j+1}</span>${esc(o)}</button>`}).join("")}</div>`;
  }
  const right=q.t==="word"?q.x.ro:q.x?q.x.r:"";
  const fbBar=fb?`<div class="fb ${fb.ok?"ok":"no"}" role="status"><div class="grow"><b>${fb.ok?(ks.combo>=3?`太棒了！${ks.combo} 连击`:"答对了！"):"正确答案"}</b>${fb.ok?"":`<div><span lang="ja" class="jp" style="font-size:18px">${esc(q.x.k||q.x.w)}</span> = ${esc(right)}</div>`}</div><button class="btn ${fb.ok?"primary":""}" data-act="kgo" style="${fb.ok?"":"background:var(--bad);color:#fff"}">继续</button></div>`:"";
  return `<div class="sin">
    <div class="shead"><button class="iconbtn" data-act="kquit" aria-label="退出">${IC.close}</button><div class="bar grow"><i style="width:${ks.p/ks.q.length*100}%"></i></div>${heartsHTML(ks.hearts)}<span class="kscore num ${ks.pop?"pop":""}" title="本关积分">${ks.score}</span></div>
    ${body}${fbBar}</div>`;
}
function kMark(k,ok){const m=K().m[k]||0;K().m[k]=ok?Math.min(5,m+1):Math.max(0,m-1)}
function kResult(ok,keys,pick){
  ks.total++;if(ok){ks.right++;ks.combo++;ks.maxCombo=Math.max(ks.maxCombo,ks.combo);ks.score+=2+(ks.combo>=6?2:ks.combo>=3?1:0);ks.pop=1}
  else{ks.combo=0;ks.miss++;ks.hearts--;const q=ks.q[ks.p];if(ks.hearts>0){const again=Object.assign({},q);if(again.opts){const o=shuffle(again.opts);again.ans=o.indexOf(again.opts[again.ans]);again.opts=o}ks.q.push(again)}}
  Y.S.maxCombo=Math.max(Y.S.maxCombo||0,ks.combo);
  for(const k of keys)kMark(k,ok);
  Y.save();
  ks.fb={ok,pick};renderKS();
}
function kAnswerPick(j){if(!ks||ks.fb)return;const q=ks.q[ks.p];if(!q.opts)return;const ok=j===q.ans;
  if(q.t==="word"){if(ok)speak(q.x.w);kResult(ok,[],j)}else{if(ok&&q.t!=="listen")speak(q.x.k);kResult(ok,[q.x.k],j)}}
function kAnswerType(){if(!ks||ks.fb)return;const q=ks.q[ks.p];const inp=document.getElementById("kin");const v=((inp&&inp.value)||"").trim().toLowerCase();if(!v)return;ks.typed=v;const ok=v===q.x.r||(ALT[q.x.r]||[]).includes(v);if(ok)speak(q.x.k);kResult(ok,[q.x.k],null)}
function kGo(){if(!ks)return;const q=ks.q[ks.p];if(q&&q.t!=="intro"&&q.t!=="match"&&!ks.fb)return;
  if(ks.hearts<=0){ks.fb=null;renderKS(true);return}
  ks.p++;ks.fb=null;ks.sel=null;ks.gone=[];ks.bad=null;ks.typed="";
  if(ks.p>=ks.q.length)kFinish();
  renderKS(true);kSpeakCur()}
function kMatchL(j){if(!ks)return;ks.sel=j;ks.bad=null;const q=ks.q[ks.p];speak(q.pairs[j].k);renderKS()}
function kMatchR(j){if(!ks)return;const q=ks.q[ks.p];if(ks.sel==null){ks.bad=null;renderKS();return}
  if(ks.sel===j){ks.gone.push(j);kMark(q.pairs[j].k,true);ks.combo++;ks.maxCombo=Math.max(ks.maxCombo,ks.combo);ks.score+=1;ks.pop=1;ks.sel=null;ks.bad=null;
    if(ks.gone.length===q.pairs.length){ks.total++;ks.right++;ks.p++;ks.gone=[];if(ks.p>=ks.q.length)kFinish();renderKS(true);kSpeakCur();return}}
  else{ks.bad=j;ks.miss++;ks.combo=0;kMark(q.pairs[ks.sel].k,false)}
  renderKS()}
function kFinish(){
  const stars=ks.miss===0?3:ks.miss<=2?2:1;ks.stars=stars;
  const id=kid(ks.sc,ks.i);const lv=K().lv;const firstClear=!lv[id];
  const bonus=10+stars*5+(KL[ks.i].boss?10:0);ks.bonus=bonus;
  lv[id]=Math.max(lv[id]||0,stars);ks.firstClear=firstClear;
  Y.addXP(ks.score+bonus);Y.checkBadges();Y.save();
}
function kWin(){
  const S=Y.S;const L=KL[ks.i],acc=ks.total?Math.round(ks.right/ks.total*100):100;
  const nextI=ks.i+1,hasNext=nextI<KL.length&&kUnlocked(ks.sc,nextI);
  return `<div class="sin"><div class="done">
    <div class="bigstars">${[1,2,3].map(n=>`<span class="${ks.stars>=n?"on":""}" style="animation-delay:${n*.15}s">${IC.star}</span>`).join("")}</div>
    <h2 style="font-size:24px">${ks.stars===3?"完美通关！":"过关了！"}</h2>
    <div class="muted">${ks.sc==="h"?"平假名":"片假名"} · ${esc(L.t)}</div>
    <div class="dstats">
      <div class="stat"><b class="num" style="color:var(--gold)">+${ks.score+ks.bonus}</b><span>积分 XP</span></div>
      <div class="stat"><b class="num">${acc}%</b><span>正确率</span></div>
      <div class="stat"><b class="num">${ks.maxCombo}</b><span>最高连击</span></div>
    </div>
    <div class="card" style="width:100%"><div class="row" style="justify-content:space-between;margin-bottom:8px"><span class="small muted">今日进度</span><span class="small num">${S.days[Y.today()]||0} / ${S.settings.goal} XP</span></div><div class="bar gold"><i style="width:${Math.min(100,(S.days[Y.today()]||0)/S.settings.goal*100)}%"></i></div></div>
    ${hasNext?`<button class="btn primary block" data-act="knext">下一关：${esc(KL[nextI].t)}</button>`:""}
    <button class="btn block" data-act="kquit">返回地图</button>
  </div></div>`;
}
function kFail(){return `<div class="sin"><div class="done">
  <div class="hearts big">${[0,1,2].map(()=>`<span class="off">${IC.heart}</span>`).join("")}</div>
  <h2 style="font-size:24px">心用完了</h2><div class="muted">这一关答错了 3 次。错过的假名多看两眼，再来一次就能过。</div>
  <div class="dstats"><div class="stat"><b class="num">${ks.right}</b><span>答对</span></div><div class="stat"><b class="num">${ks.p}/${ks.q.length}</b><span>进度</span></div><div class="stat"><b class="num">${ks.maxCombo}</b><span>最高连击</span></div></div>
  <button class="btn primary block" data-act="kretry">再试一次</button><button class="btn block" data-act="kquit">返回地图</button></div></div>`}

/* 覆盖层按键：返回 true 表示已处理 */
function kKey(e){
  if(!ks)return false;
  if(e.key==="Escape"){kClose();return true}
  if(ks.hearts<=0||ks.p>=ks.q.length)return true;
  const q=ks.q[ks.p];
  if(!ks.fb&&q.opts&&/^[1-4]$/.test(e.key)&&e.target.tagName!=="INPUT"){const j=+e.key-1;if(j<q.opts.length)kAnswerPick(j);return true}
  if(e.key==="Enter"&&(ks.fb||q.t==="intro")&&e.target.tagName!=="INPUT"){e.preventDefault();kGo()}
  return true;
}

/* ============ 注册 ============ */
Y.registerTab({id:"kana",label:"五十音",icon:"kana",order:10,render:vKana});
Y.registerAction("ktab",d=>{ui.ktab=d.k;Y.render()});
Y.registerAction("kchart",d=>{ui.kchart=d.k;Y.render()});
Y.registerAction("kgoto",d=>{ui.ktab=d.sc==="k"?"k":"h";Y.go("kana")});
Y.registerAction("klevel",d=>startLevel(d.sc,+d.i));
Y.registerAction("kgo",()=>kGo());
Y.registerAction("kpick",d=>kAnswerPick(+d.j));
Y.registerAction("kml",d=>kMatchL(+d.j));
Y.registerAction("kmr",d=>kMatchR(+d.j));
Y.registerAction("ktype",()=>kAnswerType());
Y.registerAction("kquit",()=>kClose());
Y.registerAction("kretry",()=>{if(ks)startLevel(ks.sc,ks.i)});
Y.registerAction("knext",()=>{if(ks)startLevel(ks.sc,ks.i+1)});
Y.registerBadge({id:"hira",k:"平",t:"平假名毕业",d:"通过平假名全部关卡",ok:()=>kDone("h")>=KL.length});
Y.registerBadge({id:"kata",k:"片",t:"片假名毕业",d:"通过片假名全部关卡",ok:()=>kDone("k")>=KL.length});
Y.registerBadge({id:"star3",k:"星",t:"满星达人",d:"10 个关卡拿到 3 星",ok:()=>Object.values(K().lv).filter(v=>v>=3).length>=10});
Y.kana={homeCard,KL,KR,toKata,toRomaji,done:kDone,next:kNext,stars:kStars,totalStars:kTotalStars,mastered:kMastered,startLevel};
})();
