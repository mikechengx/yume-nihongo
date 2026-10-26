/* Yume 愚昧酱日语 · 核心（js/core.js）
 * 全局命名空间 window.Yume。功能模块只通过这里导出的 API 对接，完整说明见 API.md。
 * 加载顺序：core.js → content/*.js → 各功能模块 → boot.js（调用 Yume.boot()）。
 * 本文件在 boot() 之前不碰 DOM，可以在 node 的 vm 里加载做测试。
 */
(function(){
"use strict";
const W=typeof window!=="undefined"?window:globalThis;
const Y=W.Yume=W.Yume||{};
/* 老安卓浏览器（Chrome 69 以前的内核）没有 flat/flatMap：补上，避免模块运行到一半报错 */
if(!Array.prototype.flat)Object.defineProperty(Array.prototype,"flat",{configurable:true,writable:true,value:function(d){d=d===undefined?1:d;return d>0?this.reduce((a,x)=>a.concat(Array.isArray(x)?x.flat(d-1):[x]),[]):this.slice()}});
if(!Array.prototype.flatMap)Object.defineProperty(Array.prototype,"flatMap",{configurable:true,writable:true,value:function(f,t){return this.map(f,t).flat(1)}});
Y.version="2.1.0";/* 2.1：安卓发音（在线发音兜底）、离线缓存秒开、防丢数据（多页面合并、自动备份、撤销） */

/* ============ 小工具 ============ */
const DAY=864e5;
const IV=[0,DAY,2*DAY,4*DAY,7*DAY,15*DAY,30*DAY];
const $=s=>W.document.querySelector(s);
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad=n=>String(n).padStart(2,"0");
const dkey=d=>d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const today=()=>dkey(new Date());
const shuffle=a=>{a=Array.from(a||[]);for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a};
const safeUrl=u=>/^https?:\/\//i.test(String(u||"").trim())?String(u).trim():null;
const isObj=o=>!!o&&typeof o==="object"&&!Array.isArray(o);
const clone=o=>o===undefined?undefined:JSON.parse(JSON.stringify(o));

/* ============ 振假名：「漢字[かな]」 ============ */
const KANJI="\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF々〆〇ヵヶ";
const KANA="ぁ-ゖゝゞァ-ヺー・";
/* 读音只认假名：中文讲解里出现的 [口语] 之类不会被当成注音 */
const RUBY_RE=new RegExp("(["+KANJI+"]+)\\[(["+KANA+"]+)\\]","g");
const BR_RE=new RegExp("\\[["+KANA+"]*\\]","g");
/* 去掉括号读音：私[わたし]は → 私は */
function plain(t){return String(t==null?"":t).replace(BR_RE,"")}
/* 换成读音：私[わたし]は → わたしは（只替换标了读音的汉字） */
function reading(t){return String(t==null?"":t).replace(RUBY_RE,"$2").replace(BR_RE,"")}
/* 转成 <ruby> HTML（已转义）。force=true/false 强制开/关，省略时跟随 S.settings.furi */
function ruby(t,force){
  t=String(t==null?"":t);
  const on=force===undefined?furiOn():!!force;
  let out="",last=0,m;RUBY_RE.lastIndex=0;
  while((m=RUBY_RE.exec(t))){
    out+=esc(t.slice(last,m.index).replace(BR_RE,""));
    out+=on?`<ruby>${esc(m[1])}<rt>${esc(m[2])}</rt></ruby>`:esc(m[1]);
    last=RUBY_RE.lastIndex;
  }
  return out+esc(t.slice(last).replace(BR_RE,""));
}
const furiOn=()=>!S||!S.settings||S.settings.furi!==false;

/* ============ 独立存储（不进云同步的大数据用这个） ============ */
const store={
  key:k=>"yume-"+k,
  get(k,def){let r=null;try{r=W.localStorage.getItem("yume-"+k);return r==null?def:JSON.parse(r)}catch(e){
    /* 读出来是坏的：留一份原文（之后写入不会覆盖它），再按空的处理 */
    if(r!=null)try{if(W.localStorage.getItem("yume-"+k+":broken")==null)W.localStorage.setItem("yume-"+k+":broken",r)}catch(e2){}
    return def}},
  set(k,v){try{W.localStorage.setItem("yume-"+k,JSON.stringify(v));return true}catch(e){return false}},
  del(k){try{W.localStorage.removeItem("yume-"+k)}catch(e){}},
  /* 以 prefix 开头的独立存储键（不含 yume- 前缀） */
  keys(prefix){const out=[];try{const L=W.localStorage;for(let i=0;i<L.length;i++){const k=L.key(i);if(k&&k.startsWith("yume-"+(prefix||"")))out.push(k.slice(5))}}catch(e){}return out},
  /* 某个键当前占用的字符数（不存在为 0） */
  len(k){try{const r=W.localStorage.getItem("yume-"+k);return r==null?0:r.length}catch(e){return 0}}
};

/* ============ 状态 S（localStorage 键 hibi-n5-v1，结构与旧版完全兼容） ============ */
const KEY="hibi-n5-v1";
const DEF=()=>({v:1,xp:0,days:{},words:{},grammar:{},quiz:{},videos:{},custom:[],
  settings:{newPerDay:10,goal:50,autoSpeak:true,track:"b1",furi:true,voice:"auto",speed:1},
  badges:{},titles:{},kana:{lv:{},m:{}},maxCombo:0,nd:{d:"",n:0},lastBackup:"",epoch:"",updated:0});
const EXTRA={},EXTRA_SET={};
const DATE_RE=/^\d{4}-\d\d-\d\d$/;
const nn=v=>{v=+v;return isFinite(v)&&v>0?Math.round(v):0};
/* 存档可能来自「恢复存档 / 粘贴存档文字 / 云端」，里面的值会被拼进页面：数字字段一律转成数字，非法条目删掉 */
function cleanNums(o){if(!isObj(o))return{};const r={};for(const k in o){const v=nn(o[k]);if(v)r[k]=v}return r}
function merge(o){
  const d=DEF();o=isObj(o)?o:{};
  for(const k in d){if(o[k]===undefined)o[k]=d[k]}
  for(const k of ["days","words","grammar","quiz","videos","badges","titles"])if(!isObj(o[k]))o[k]={};
  if(!Array.isArray(o.custom))o.custom=[];
  o.xp=nn(o.xp);
  o.days=cleanNums(o.days);for(const k in o.days)if(!DATE_RE.test(k))delete o.days[k];
  o.quiz=cleanNums(o.quiz);
  for(const k in o.words){const w=o.words[k];
    if(!isObj(w)){delete o.words[k];continue}
    const due=+w.due;o.words[k]={lv:Math.min(6,nn(w.lv)),due:isFinite(due)?due:0,r:nn(w.r),x:nn(w.x)}}
  for(const k in o.videos)if(!Array.isArray(o.videos[k]))delete o.videos[k];
  o.maxCombo=nn(o.maxCombo);
  o.nd=isObj(o.nd)&&DATE_RE.test(String(o.nd.d))?{d:o.nd.d,n:nn(o.nd.n)}:{d:"",n:0};
  if(typeof o.lastBackup!=="string"||!DATE_RE.test(o.lastBackup))o.lastBackup="";
  o.updated=isFinite(+o.updated)?+o.updated:0;
  if(typeof o.epoch!=="string"||o.epoch.length>40)o.epoch="";
  o.settings=Object.assign(d.settings,clone(EXTRA_SET),isObj(o.settings)?o.settings:{});
  const st=o.settings,d0=DEF().settings;
  st.goal=Math.min(1000,nn(st.goal)||d0.goal);st.newPerDay=Math.min(100,nn(st.newPerDay)||d0.newPerDay);
  st.autoSpeak=st.autoSpeak!==false;st.furi=st.furi!==false;if(typeof st.track!=="string")st.track="b1";
  if(!["auto","system","online"].includes(st.voice))st.voice="auto";{const sp=+st.speed;st.speed=isFinite(sp)&&sp>=.6&&sp<=1.5?Math.round(sp*100)/100:1}
  o.kana=Object.assign({lv:{},m:{}},isObj(o.kana)?o.kana:{});
  o.kana.lv=cleanNums(o.kana.lv);o.kana.m=cleanNums(o.kana.m);
  for(const k in EXTRA){const dv=clone(EXTRA[k]);if(o[k]===undefined)o[k]=dv;else if(isObj(dv)&&isObj(o[k])){for(const j in dv)if(o[k][j]===undefined)o[k][j]=dv[j]}}
  return o;
}
/* 读档。读不出来（浏览器禁止存储）或内容损坏时：不会拿空白进度覆盖原存档——损坏的原文另存到 KEY+":broken"，
 * 启动后再从自动备份（IndexedDB 快照）里找最近一份恢复，见 recoverOnBoot()。 */
const LOAD={ok:true,why:""};
let S=(()=>{
  let r=null;
  try{r=W.localStorage.getItem(KEY)}catch(e){LOAD.ok=false;LOAD.why="read";return merge(DEF())}
  if(r==null||r==="")return merge(DEF());
  try{LOAD.len=r.length;return merge(JSON.parse(r))}
  catch(e){LOAD.ok=false;LOAD.why="parse";LOAD.raw=r;try{W.localStorage.setItem(KEY+":broken",r);LOAD.kept=true}catch(e2){}return merge(DEF())}
})();
function registerState(key,def){
  EXTRA[key]=clone(def);
  if(S[key]===undefined)S[key]=clone(def);
  else if(isObj(def)&&isObj(S[key])){for(const j in def)if(S[key][j]===undefined)S[key][j]=clone(def[j])}
  return S[key];
}
function registerSetting(key,def){EXTRA_SET[key]=clone(def);if(S.settings[key]===undefined)S.settings[key]=clone(def)}
/* 模块生词本（会话生词 / 视听生词）：放在 S.custom 里、固定 id 的一课，和单词练习/复习完全兼容。
 * 它们不算「导入的课程」：课程页单独显示，「我的 → 清除已导入」不会删掉它们（否则这些词的进度会一起失效）。 */
const WLISTS={};
function registerWordList(id,meta){if(id==null)return;WLISTS[String(id)]=Object.assign({title:"生词本",sub:""},isObj(meta)?meta:{})}
const isWordList=c=>!!c&&(c.sys===true||Object.prototype.hasOwnProperty.call(WLISTS,String(c.id)));
/* 取（create=true 时没有就新建）S.custom 里的生词本条目 */
function wordList(id,create){
  id=String(id);if(!Array.isArray(S.custom))S.custom=[];
  let c=S.custom.find(x=>x&&String(x.id)===id);
  if(!c&&create){const m=WLISTS[id]||{};c={id,title:m.title||"生词本",sub:m.sub||"",words:[],grammar:[],quiz:[],sys:true};S.custom.push(c)}
  if(c&&!Array.isArray(c.words))c.words=[];
  return c||null;
}
const importedCustom=()=>(Array.isArray(S.custom)?S.custom:[]).filter(c=>!isWordList(c));

let sync="local";
/* ============ 保存（防丢失） ============
 * 1. 多个页面同时开着（旧标签页、桌面图标 + 浏览器、两个窗口）：每次保存前先看看本机存档是不是被别的页面更新过
 *    （读一个很小的「版本号」键 KEY+":rev"），是的话先把两边的进度合并（mergeProgress）再写，旧页面不会再覆盖新进度。
 *    别的页面保存时（storage 事件）、切回这个页面时，也会把新进度合并进来。
 * 2. 每天在 IndexedDB 里存一份快照（保留最近 7 天；恢复、清空、导入之前也存一份），见下面的 SNAP。
 * 3. 页面被切到后台 / 关闭时，补存当天快照（安卓会直接杀掉后台页面）。 */
const TAB=Math.random().toString(36).slice(2,10);
let baseRev=+S.updated||0;/* 这个页面最后一次读到/写入的存档时间（S.updated） */
/* 上次同步时的 XP、每天 XP、语法：合并时用它算出「本页面新拿了多少 XP」，两边的 XP 相加而不是取较大的 */
/* BASE 为 null 表示「不知道」：刚整体替换过进度（恢复、清空、撤销），S 里的 XP 不全是本页面新拿的。
 * 这时合并只取两边较大的值，不做「相加」，免得把恢复回来的 XP 算两遍；下一次成功写入后重新记下。 */
let BASE=null;
function setBase(){BASE={xp:+S.xp||0,days:Object.assign({},S.days),grammar:Object.assign({},S.grammar),epoch:S.epoch||""}}
setBase();
/* 打开时读不出存档（不是坏了，是读取出错）：还没见过本机原来的进度。第一次合并时两边都保留（不看纪元），之后恢复正常 */
let blind=LOAD.why==="read";
function readRev(){try{const r=W.localStorage.getItem(KEY+":rev");if(!r)return null;const o=JSON.parse(r);return isObj(o)?o:null}catch(e){return null}}
function readStored(){try{const r=W.localStorage.getItem(KEY);return r?merge(JSON.parse(r)):null}catch(e){return null}}
/* 本机保存失败（存储空间满 / 浏览器禁止保存）：常驻提示，直到下一次保存成功 */
let localFull=false,fullWarned=false;
let lastLen=LOAD.len||0;
function writeLocal(){
  const txt=JSON.stringify(S);W.localStorage.setItem(KEY,txt);lastLen=txt.length;
  try{W.localStorage.setItem(KEY+":rev",JSON.stringify({u:S.updated||0,tab:TAB}))}catch(e){}
  baseRev=S.updated||0;setBase();blind=false;
}
/* 别的页面在我们上次读写之后保存过吗？新版页面看 :rev；还开着的旧版页面（不写 :rev）看主存档长度变没变 */
function otherWrote(){
  const rv=readRev();if(rv&&rv.tab!==TAB&&(+rv.u||0)>baseRev)return true;
  try{const r=W.localStorage.getItem(KEY);if(r!=null&&r.length!==lastLen)return true}catch(e){}
  return false;
}
/* 存档读不出来、原文又没能另存：先别覆盖（等用户在提示里处理） */
const holdWrites=()=>LOAD.why==="parse"&&!LOAD.kept&&!LOAD.keptIDB&&!LOAD.ack;
function persistLocal(){
  if(holdWrites())return false;
  /* 别的页面在我们上次读写之后保存过：先合并，再写 */
  if(otherWrote()){const o=readStored();if(o&&(+o.updated||0)>baseRev)absorb(o,false);else if(o){baseRev=Math.max(baseRev,+o.updated||0)}}
  try{writeLocal();if(localFull){localFull=false;if(booted)render()}return true}
  catch(e0){
    /* 存储满了：删掉不影响进度的记录（奖励去重表）再试一次。损坏存档的原文不删 */
    try{W.localStorage.removeItem("yume-xp-once");writeLocal();if(localFull){localFull=false;if(booted)render()}return true}catch(e){}
    const was=localFull;localFull=true;
    if(!fullWarned){fullWarned=true;toast("进度没能保存到本机：存储空间满了（或浏览器禁止保存）。请到「视听」删掉不用的字幕，或先在「我的」保存存档文件。",9000)}
    if(!was&&booted)setTimeout(render,0);
    return false;
  }
}
function save(){S.updated=Math.max(Date.now(),(S.updated||0)+1);const ok=persistLocal();schedulePush();snapSoon();return ok}

/* 纪元：清空/覆盖恢复之后换新的（时间戳 36 进制 + 4 位随机），可以比较新旧；"" 最旧 */
const epochT=e=>{const n=parseInt(String(e||"").slice(0,-4),36);return isFinite(n)?n:0};
const newerEpoch=(x,y)=>epochT(x)>=epochT(y)?(x||""):(y||"");
/* 模块状态的合并规则（两份都是对象/数组时）。od 是较旧的一份，nw 是较新的一份 */
const sumDays=d=>{let n=0;for(const k in d||{})n+=+d[k]||0;return n};
function mergeModule(k,od,nw){
  if(k==="easy"&&isObj(od)&&isObj(nw)){
    const r=Object.assign({},od,nw);
    r.done=Object.assign({},od.done||{});for(const id in nw.done||{})r.done[id]=Math.max(+r.done[id]||0,+nw.done[id]||0);
    r.pr=Object.assign({},od.pr||{});for(const id in nw.pr||{})r.pr[id]=(r.pr[id]|0)|(nw.pr[id]|0);
    r.last=[od.last||"",nw.last||""].sort().pop();
    if(od.xd&&od.xd===nw.xd&&Array.isArray(od.xk)&&Array.isArray(nw.xk))r.xk=[...new Set(nw.xk.concat(od.xk))];
    return r;
  }
  if(k==="speech"&&isObj(od)&&isObj(nw)){
    const r=Object.assign({},od,nw);
    r.n=Math.max(+od.n||0,+nw.n||0);r.g=Math.max(+od.g||0,+nw.g||0);
    if(od.d===nw.d&&Array.isArray(od.h)&&Array.isArray(nw.h))r.h=[...new Set(nw.h.concat(od.h))].slice(0,200);
    else if((od.d||"")>(nw.d||"")){r.d=od.d;r.h=od.h}
    return r;
  }
  if(k==="tests"&&Array.isArray(od)&&Array.isArray(nw)){
    const seen=new Set();const out=[];
    for(const x of nw.concat(od)){const key=JSON.stringify(x);if(!seen.has(key)){seen.add(key);out.push(x)}}
    out.sort((x,y)=>String((x&&x.date)||"").localeCompare(String((y&&y.date)||"")));
    return out.slice(-30);
  }
  if(k==="plan"&&isObj(od)&&isObj(nw)){
    /* 同一份计划（制定日期一样）：其他以较新的为准，打卡日期取并集；不是同一份：用较新的 */
    if(od.created&&od.created===nw.created)return Object.assign({},nw,{hit:Object.assign({},od.hit||{},nw.hit||{})});
    return nw;
  }
  if(isObj(od)&&isObj(nw))return Object.assign({},od,nw);
  return nw;
}
/* 两份进度合并：两边学过的都保留。a、b 都是 merge() 过的完整状态。
 * 规则：单词取作答次数多的那份（一样多取到期晚的）；语法、徽章、称号取并集；练习、五十音取较高的；
 * 每天的 XP 取较大的；XP 总数取较大的；设置和模块状态以较新的一份为准（对象按键合并）。
 * 如果其中一份是「清空进度 / 恢复存档」之后的新纪元（epoch 不同），直接用较新的一份，不合并旧进度。 */
function mergeProgress(a,b,force){
  const ua=+a.updated||0,ub=+b.updated||0;const nw=ub>=ua?b:a,od=nw===b?a:b;
  if(!force&&(a.epoch||"")!==(b.epoch||"")){
    /* 纪元不同：以纪元较新的一份为准（清空/恢复之后，旧页面的进度不会再被并回来） */
    const et=e=>{const n=parseInt(String(e||"").slice(0,-4),36);return isFinite(n)?n:0};
    const w=et(a.epoch)>=et(b.epoch)?a:b;const r=clone(w);r.updated=Math.max(ua,ub);return merge(r);
  }
  const o=clone(nw);
  o.epoch=newerEpoch(a.epoch,b.epoch);/* 纪元只往前走：合并不会把数据换回旧的「纪元」 */
  const maxMap=(x,y)=>{const r=Object.assign({},x||{});for(const k in y||{})r[k]=Math.max(+r[k]||0,+y[k]||0);return r};
  o.days=maxMap(od.days,nw.days);o.quiz=maxMap(od.quiz,nw.quiz);
  o.kana={lv:maxMap((od.kana||{}).lv,(nw.kana||{}).lv),m:maxMap((od.kana||{}).m,(nw.kana||{}).m)};
  o.xp=Math.max(+a.xp||0,+b.xp||0);o.maxCombo=Math.max(+a.maxCombo||0,+b.maxCombo||0);
  /* 主动合并两份存档（比如微信里和浏览器里的）：XP = 较大的一份 + 合并后每天 XP 比两边都多出来的部分 */
  if(force)o.xp+=Math.max(0,sumDays(o.days)-Math.max(sumDays(a.days),sumDays(b.days)));
  o.words=Object.assign({},od.words);
  for(const k in nw.words){const x=nw.words[k],y=od.words[k];
    if(!y){o.words[k]=x;continue}
    const nx=(x.r||0)+(x.x||0),ny=(y.r||0)+(y.x||0);
    o.words[k]=nx>ny||(nx===ny&&(+x.due||0)>=(+y.due||0))?x:y}
  for(const k of ["grammar","badges","titles"])o[k]=Object.assign({},od[k]||{},nw[k]||{});
  if(od.nd&&nw.nd&&od.nd.d===nw.nd.d)o.nd={d:nw.nd.d,n:Math.max(+od.nd.n||0,+nw.nd.n||0)};
  o.lastBackup=[od.lastBackup||"",nw.lastBackup||""].sort().pop();
  /* 自制课程 / 生词本：按 id 合并，生词本的单词取并集 */
  const cm=new Map();for(const c of od.custom||[])if(c&&c.id!=null)cm.set(String(c.id),c);
  for(const c of nw.custom||[]){if(!c||c.id==null)continue;const id=String(c.id),p=cm.get(id);
    if(p&&isWordList(c)&&Array.isArray(p.words)&&Array.isArray(c.words)){const seen=new Set(c.words.map(String));cm.set(id,Object.assign({},c,{words:c.words.concat(p.words.filter(w=>!seen.has(String(w))))}))}
    else cm.set(id,c)}
  o.custom=[...cm.values()];
  o.videos=Object.assign({},od.videos||{});
  for(const k in nw.videos||{}){const seen=new Set((nw.videos[k]||[]).map(v=>v&&v.u));o.videos[k]=(nw.videos[k]||[]).concat((od.videos[k]||[]).filter(v=>v&&!seen.has(v.u)))}
  /* 模块状态（会话、自测、计划、跟读……）：按各自的规则合并（mergeModule），两边的记录都保留 */
  for(const k in EXTRA){const x=od[k],y=nw[k];if(x!=null&&y!=null)o[k]=clone(mergeModule(k,x,y));else if(y==null&&x!=null&&k!=="plan")o[k]=clone(x)}
  o.updated=Math.max(ua,ub);
  return merge(o);
}
/* 把另一份进度并进当前 S（原地改，不换对象）。rerender=true 时重算课程并刷新页面 */
function absorb(other,rerender){
  const m=mergeProgress(S,other,blind);
  if(BASE&&!blind&&(BASE.epoch||"")===(S.epoch||"")&&(S.epoch||"")===(other.epoch||"")){
    /* 别的页面的 XP + 本页面自上次同步后新拿的 XP（只算增加的部分） */
    /* 结果不低于「取较大值」：还开着的旧版页面不合并就直接写，可能盖掉过本页面的 XP，这时也不倒退 */
    m.xp=Math.max(+m.xp||0,(+other.xp||0)+Math.max(0,(+S.xp||0)-(+BASE.xp||0)));
    const ds=new Set([...Object.keys(other.days||{}),...Object.keys(S.days||{})]);
    for(const d of ds){const v=(+(other.days||{})[d]||0)+Math.max(0,(+S.days[d]||0)-(+BASE.days[d]||0));if(v>(+m.days[d]||0))m.days[d]=v}
    /* 本页面撤销掉的「我学会了」：别的页面没动过的话，合并后也不要再出现 */
    for(const k in BASE.grammar)if(!(k in S.grammar)&&(other.grammar||{})[k]===BASE.grammar[k])delete m.grammar[k];
  }
  for(const k of Object.keys(S))if(!(k in m))delete S[k];
  Object.assign(S,m);
  baseRev=Math.max(baseRev,+other.updated||0);setBase();blind=false;
  if(rerender&&booted){rebuild();if(!OV.open)render()}
}
/* 别的页面保存了：合并进来（不立刻写回，下次保存时一起写） */
function onStorage(e){
  if(e.key!==KEY||!e.newValue)return;
  if(W.document&&W.document.hidden)return;/* 后台页面：切回来时 onShow() 会检查 */
  try{const o=merge(JSON.parse(e.newValue));if((+o.updated||0)>baseRev)absorb(o,true)}catch(err){}
}
/* 切回这个页面时：有的浏览器（尤其 App 内置浏览器）不发 storage 事件，自己查一次 */
function onShow(){
  if(otherWrote()){const o=readStored();if(o&&(+o.updated||0)>baseRev)absorb(o,true)}
}

/* ============ 自动备份：IndexedDB 快照 ============
 * 库 yume-backup：meta 表 {id, kind:"day"|"before", t, xp, words, note}（列表只读这个，很小）；data 表 {id, text}（恢复时才读）。
 * 只存学习进度（单词进度压缩），不存视听字幕（字幕很大，而且「保存存档文件」里有）。
 * 每天一份（id "day-日期"，当天学过之后会更新），保留最近 7 天；清空/恢复/清除导入之前各存一份 "before-时间"，保留最近 5 份。
 * 只有进度有变化（save() 过）才存；在空闲时做，不卡页面。
 * 和 localStorage 是两套存储：localStorage 出问题（写满、被单独清掉、读出来是坏的）时，还能从这里找回。 */
const SNAP={db:null,timer:null,dirty:false};
const SNAP_DAY="snap-day";/* store 键：最近一次写每日快照的日期（换页面、重开也记得） */
function snapDB(){
  if(SNAP.db)return Promise.resolve(SNAP.db);
  return new Promise((res,rej)=>{
    let r;try{r=W.indexedDB&&W.indexedDB.open("yume-backup",1)}catch(e){rej(e);return}
    if(!r){rej(new Error("no indexedDB"));return}
    r.onupgradeneeded=()=>{const db=r.result;for(const n of ["meta","data"])if(!db.objectStoreNames.contains(n))db.createObjectStore(n,{keyPath:"id"})};
    r.onsuccess=()=>{SNAP.db=r.result;try{SNAP.db.onversionchange=()=>{try{SNAP.db.close()}catch(e){}SNAP.db=null}}catch(e){}res(SNAP.db)};
    r.onerror=()=>rej(r.error);r.onblocked=()=>rej(new Error("blocked"));
  });
}
function snapTx(stores,mode,fn){return snapDB().then(db=>new Promise((res,rej)=>{
  const tx=db.transaction(stores,mode);let out;try{out=fn(tx)}catch(e){rej(e);return}
  tx.oncomplete=()=>res(out&&out.result!==undefined?out.result:out);tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error)}))}
function snapList(){return snapTx(["meta"],"readonly",tx=>tx.objectStore("meta").getAll()).then(a=>(Array.isArray(a)?a:[]).sort((x,y)=>y.t-x.t)).catch(()=>[])}
function snapGet(id){return snapTx(["meta","data"],"readonly",tx=>{const r={};const a=tx.objectStore("meta").get(id),b=tx.objectStore("data").get(id);a.onsuccess=()=>{r.meta=a.result};b.onsuccess=()=>{r.data=b.result};return{get result(){return r.meta&&r.data?Object.assign({},r.meta,{data:r.data.text}):null}}}).catch(()=>null)}
const hasProgress=o=>!!o&&((+o.xp||0)>0||Object.keys(o.words||{}).length>0);
function snapPut(kind,note){
  if(!hasProgress(S))return Promise.resolve(false);
  const id=kind==="day"?"day-"+today():"before-"+Date.now();
  let text;try{text=JSON.stringify(packCloud(S,true))}catch(e){return Promise.resolve(false)}
  const meta={id,kind,t:Date.now(),xp:S.xp,words:Object.keys(S.words).length,note:note||""};
  const wasDirty=SNAP.dirty;if(kind==="day")SNAP.dirty=false;
  return snapTx(["meta","data"],"readwrite",tx=>{tx.objectStore("meta").put(meta);tx.objectStore("data").put({id,text})})
    .then(()=>{if(kind==="day")store.set(SNAP_DAY,today());return snapPrune()}).then(()=>true)
    .catch(()=>{if(kind==="day"&&wasDirty)SNAP.dirty=true;return false});
}
function snapPrune(){return snapList().then(list=>{
  const days=list.filter(x=>x.kind==="day"),bef=list.filter(x=>x.kind==="before"),bad=list.filter(x=>x.kind==="broken");
  const del=days.slice(7).concat(bef.slice(5),bad.slice(2));
  if(!del.length)return;
  return snapTx(["meta","data"],"readwrite",tx=>{for(const x of del){tx.objectStore("meta").delete(x.id);tx.objectStore("data").delete(x.id)}});
}).catch(()=>{})}
const idle=fn=>{try{if(typeof W.requestIdleCallback==="function"){W.requestIdleCallback(()=>fn(),{timeout:5000});return}}catch(e){}setTimeout(fn,200)};
/* save() 之后：进度有变化才排一次每日快照（今天还没存过就 5 秒后，存过了就最多 10 分钟一次），在空闲时做 */
let snapAt=0;
function snapSoon(){
  if(!booted||!W.indexedDB)return;
  SNAP.dirty=true;
  const doneToday=store.get(SNAP_DAY,"")===today();
  if(doneToday&&Date.now()-snapAt<600000)return;
  clearTimeout(SNAP.timer);SNAP.timer=setTimeout(()=>{snapAt=Date.now();idle(()=>snapPut("day"))},doneToday?20000:5000);
}
/* 切到后台 / 关闭：有没存进快照的变化才存 */
function snapNow(){if(!booted||!W.indexedDB||!SNAP.dirty||!hasProgress(S))return;clearTimeout(SNAP.timer);snapAt=Date.now();snapPut("day")}
/* 恢复到某份快照：先给当前进度存一份 "before"，再恢复 */
function snapRestore(id){
  return snapGet(id).then(rec=>{
    if(!rec||!rec.data)return{ok:false,msg:"找不到这份备份"};
    return snapPut("before","恢复到 "+new Date(rec.t).toLocaleString("zh-CN")+" 之前").then(()=>{const r=restore(rec.data,{noSnap:true});if(r.ok&&booted)render();return r});
  });
}
/* 启动时：本机存档是空的（被清掉了）或者坏了，而自动备份里有进度 → 自动恢复最近一份（用合并方式，纪元不倒退） */
function recoverOnBoot(){
  /* 刚才读不出来：可能只是一时的，先再读一次 */
  if(LOAD.why==="read"){
    try{const r=W.localStorage.getItem(KEY);if(r){const o=merge(JSON.parse(r));for(const k of Object.keys(S))delete S[k];Object.assign(S,o);LOAD.ok=true;LOAD.why="";lastLen=r.length;baseRev=+S.updated||0;setBase();blind=false;rebuild();render();return}}catch(e){}
  }
  /* 损坏的原文另存一份到 IndexedDB（localStorage 那份可能因为空间不够没存下） */
  if(LOAD.why==="parse"&&LOAD.raw&&W.indexedDB){
    snapTx(["meta","data"],"readwrite",tx=>{const id="broken-"+Date.now();tx.objectStore("meta").put({id,kind:"broken",t:Date.now(),xp:0,words:0,note:"读不出来的原始存档"});tx.objectStore("data").put({id,text:LOAD.raw})})
      .then(()=>{LOAD.keptIDB=true;if(booted)render()}).catch(()=>{});
  }
  if(!W.indexedDB)return;
  const fresh=!S.updated&&!hasProgress(S);
  if(!fresh&&LOAD.ok)return;
  snapList().then(list=>{
    const best=list.find(x=>x.kind!=="broken"&&((+x.xp||0)>0||(+x.words||0)>0));
    return best?snapGet(best.id):null;
  }).then(best=>{
    if(!best||!best.data)return;
    if(!(!S.updated&&!hasProgress(S))&&LOAD.ok)return;/* 等待期间用户已经开始学了：不动 */
    if(LOAD.why==="parse")LOAD.ack=true;/* 已经从备份找回：可以正常保存了 */
    const r=restore(best.data,{mode:"merge",noSnap:true,noUndo:true});
    if(r.ok){if(booted)render();toast("这台设备上的进度好像被清掉了（或读不出来），已经从 "+new Date(best.t).toLocaleDateString("zh-CN")+" 的自动备份恢复："+esc(r.msg.replace(/^✓\s*(已合并：)?/,"")),9000)}
  });
}
const sizeOf=o=>{const t=JSON.stringify(o);try{return new Blob([t]).size}catch(e){return t.length*2}};
/* 存档大小（字符数，约等于字节数）：用最近一次写入时的长度，没写过才现算 */
function stateSize(){return lastLen||JSON.stringify(S).length}

/* claude.ai 云同步（db 能力，单文档上限 256KB；超过 240KB 暂停推送）
 * 存档较大（>200KB）时在云端边界压缩：单词进度写成 wz:{键:[lv,到期分钟,对,错]}，本机结构不变 */
const PACK_AT=200000;
function packCloud(o,force){
  const c=JSON.parse(JSON.stringify(o));
  if(!force&&sizeOf(c)<=PACK_AT)return c;
  const wz={};
  for(const k in c.words){const w=c.words[k]||{};const a=[nn(w.lv),Math.round((+w.due||0)/6e4),nn(w.r),nn(w.x)];while(a.length>1&&!a[a.length-1])a.pop();wz[k]=a}
  delete c.words;c.wz=wz;c.pk=1;
  for(const k in c.days)if(!c.days[k])delete c.days[k];
  return c;
}
function unpackCloud(r){
  if(r&&r.pk===1&&isObj(r.wz)){const w={};for(const k in r.wz){const a=r.wz[k];if(Array.isArray(a))w[k]={lv:+a[0]||0,due:(+a[1]||0)*6e4,r:+a[2]||0,x:+a[3]||0}}r.words=w;delete r.wz;delete r.pk}
  return r;
}
let ref=null,writing=false,pending=false,pushT=null;
function schedulePush(){if(!ref)return;clearTimeout(pushT);pushT=setTimeout(push,1500)}
async function push(){if(!ref)return;if(writing){pending=true;return}
  const data=packCloud(S);
  if(sizeOf(data)>240000){sync="big";return}
  writing=true;
  try{await ref.set(data);sync="cloud"}catch(e){if(e&&e.code==="invalid_argument"){ref=null}sync="local"}
  writing=false;if(pending){pending=false;push()}}
async function initCloud(n){
  if(!W.claude||!W.claude.use){if(n<15)setTimeout(()=>initCloud(n+1),400);return}
  try{
    const [db,user]=await Promise.all([W.claude.use("db"),W.claude.use("user")]);
    if(!db||!user)return;const id=await user.id();if(!id)return;
    ref=db.doc("data/users/"+id+"/state");
    const snap=await ref.get();
    if(snap.exists){const r=unpackCloud(snap.data()||{});if((r.updated||0)>(S.updated||0)){S=merge(JSON.parse(JSON.stringify(r)));persistLocal();rebuild();migrateOrphans()}else if(S.updated){await push()}}
    else if(S.updated){await push()}
    sync=sync==="big"?"big":"cloud";render();
  }catch(e){ref=null;sync="local"}
}
/* 存档附带的模块数据（不在 S 里，比如视听库和字幕）：registerBackup(key,{get(opts)→数据, put(数据)→说明文字}) */
const BK={};
function registerBackup(key,o){if(key&&o&&typeof o.get==="function"&&typeof o.put==="function")BK[key]=o}
/* 存档文字：S + _x（各模块附带的数据）。opts.lite=true 时各模块尽量精简（复制到剪贴板用） */
function backupText(opts){
  opts=opts||{};
  /* 复制到剪贴板的精简版：单词进度压缩成数组（约省一半字数），粘贴进微信时不容易被截断 */
  const o=opts.lite?packCloud(S,true):clone(S);const x={};
  for(const k in BK){try{const v=BK[k].get(opts);if(v!=null)x[k]=v}catch(e){console.error("[yume] 备份出错",k,e)}}
  if(Object.keys(x).length)o._x=x;
  o._n=Object.keys(S.words).length;/* 单词条数：恢复时核对，存档被截断时能看出来 */
  return JSON.stringify(o);
}
/* 存档文字 → 对象（兼容压缩格式）。截断/损坏时给出明确提示 */
function parseBackup(text){
  let j;
  if(typeof text==="string"){const t=text.trim();if(!t)throw new Error("没有内容");
    try{j=JSON.parse(t)}catch(e){throw new Error(t[0]==="{"&&t[t.length-1]!=="}"?"存档文字不完整，可能复制或粘贴时被截断了，请重新复制完整内容":"这不是 yume 的存档（格式不对）")}}
  else j=clone(text);
  if(!isObj(j))throw new Error("这不是 yume 的存档");
  unpackCloud(j);
  if(typeof j.xp!=="number"||!isObj(j.words))throw new Error("这不是 yume 的存档");
  if(typeof j._n==="number"&&Object.keys(j.words).length<j._n)throw new Error("存档不完整：单词进度少了一部分，请重新复制");
  delete j._n;
  return j;
}
/* 预览一份存档（恢复前给用户确认用）：{xp, words, days, updated} */
function backupInfo(text){const j=parseBackup(text);return{xp:+j.xp||0,words:Object.keys(j.words).length,days:Object.keys(j.days||{}).length,updated:+j.updated||0}}
/* 清空/恢复之前留一份，可以马上「撤销」 */
/* 清空/恢复之前留一份，可以马上「撤销」。返回凭证（撤销时核对，旧的撤销副本不会被误用）；存不下时返回 ""，这时不提供撤销 */
let undoTok="";
function keepUndo(){
  undoTok="";
  try{W.localStorage.removeItem(KEY+":undo")}catch(e){}
  const t=Date.now().toString(36)+Math.random().toString(36).slice(2,6);
  try{W.localStorage.setItem(KEY+":undo",JSON.stringify({t,s:S}));undoTok=t}catch(e){}
  return undoTok;
}
function undoLast(t){
  let r=null;try{r=W.localStorage.getItem(KEY+":undo")}catch(e){}
  if(!r)return{ok:false,msg:"没有可以撤销的操作"};
  let o=null;try{o=JSON.parse(r)}catch(e){}
  if(!o||!isObj(o.s)||(t&&o.t!==t))return{ok:false,msg:"这次操作已经不能撤销了"};
  const res=restore(o.s,{noSnap:true,noUndo:true});
  if(res.ok){try{W.localStorage.removeItem(KEY+":undo")}catch(e){}undoTok=""}
  return res;
}
/* 用一个对象整体替换进度（恢复存档用）。返回 {ok,msg} */
const newEpoch=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,6);
/* restore(text,{mode:"merge"|"replace", noSnap, noUndo})：
 *  replace（默认）：整份替换当前进度；merge：和当前进度合并（两边学过的都保留，比如把微信里和浏览器里的进度合到一起） */
function restore(text,opts){
  opts=opts||{};
  try{const j=parseBackup(text);
    const x=isObj(j._x)?j._x:null;delete j._x;
    if(!opts.noSnap)snapPut("before",opts.mode==="merge"?"合并存档之前":"恢复存档之前");
    const ut=opts.noUndo?"":keepUndo();
    if(opts.mode==="merge"){const m=mergeProgress(S,merge(j),true);for(const k of Object.keys(S))if(!(k in m))delete S[k];Object.assign(S,m)}
    else{S=merge(j);S.epoch=newEpoch()}
    BASE=null;/* 进度整体换过了：保存前如果要和别的页面合并，只取较大值 */
    S.lastBackup=S.lastBackup||today();rebuild();migrateOrphans();save();
    let more="";
    if(x)for(const k in BK)if(x[k]!=null){try{const m=BK[k].put(x[k]);if(m)more+="，"+m}catch(e){console.error("[yume] 恢复出错",k,e)}}
    return{ok:true,undo:ut,msg:(opts.mode==="merge"?"✓ 已合并：":"✓ 已恢复：")+"XP "+S.xp+"，单词 "+Object.keys(S.words).length+" 个"+more};
  }catch(e){return{ok:false,msg:"恢复失败："+(e.message||"格式不对")}}
}
function resetProgress(){snapPut("before","清空进度之前");const ut=keepUndo();const keep={custom:S.custom,videos:S.videos,settings:S.settings};S=merge(Object.assign(DEF(),keep));S.epoch=newEpoch();BASE=null;rebuild();save();return ut}

/* ============ 图标 ============ */
const IC={
flame:'<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c1 3.5 5 5.6 5 10.2A5 5 0 0 1 12 17a5 5 0 0 1-5-4.8c0-2 1-3.4 2.2-4.4.2 1.6 1 2.6 2 3 0-3.2.4-6.1.8-8.8zM12 22a7 7 0 0 1-7-7c0-.6.1-1.2.2-1.7A7 7 0 0 0 12 19a7 7 0 0 0 6.8-5.7c.1.5.2 1.1.2 1.7a7 7 0 0 1-7 7z"/></svg>',
spk:'<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
back:'<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
close:'<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
go:'<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
check:'<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17l9-10"/></svg>',
home:'<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 10.5 12 4l8 6.5V20h-5v-6H9v6H4z"/></svg>',
book:'<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 5.5C6.5 4 9.5 4 12 6c2.5-2 5.5-2 8-.5V19c-2.5-1.5-5.5-1.5-8 .5-2.5-2-5.5-2-8-.5z"/><path d="M12 6v13.5"/></svg>',
cards:'<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="7" width="13" height="14" rx="2"/><path d="M8 3h11a2 2 0 0 1 2 2v12"/></svg>',
me:'<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" stroke-linecap="round"/></svg>',
play:'<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
pause:'<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
trash:'<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
kana:'<svg class="icon" viewBox="0 0 24 24"><rect x="2.5" y="2.5" width="19" height="19" rx="6" fill="none" stroke="currentColor" stroke-width="2"/><text x="12" y="16.6" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor" font-family="sans-serif">あ</text></svg>',
heart:'<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.5-4.6-9.6-9.3C1 8.4 3 5 6.5 5c2 0 3.6 1.1 4.5 2.6h2C13.9 6.1 15.5 5 17.5 5 21 5 23 8.4 21.6 11.7 19.5 16.4 12 21 12 21z"/></svg>',
star:'<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.9 6 6.6.8-4.9 4.6 1.3 6.5L12 17.2l-5.9 3.2 1.3-6.5L2.5 9.3l6.6-.8z"/></svg>',
lock:'<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
ext:'<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
chat:'<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5" stroke-linecap="round"/></svg>',
tv:'<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="3"/><path d="M8 2.5 12 6l4-3.5" stroke-linecap="round"/><path d="M10.5 10v5l4-2.5z" fill="currentColor" stroke="none"/></svg>',
mic:'<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',
down:'<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
chart:'<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
target:'<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>',
spark:'<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1.5c.7 5.2 2.3 6.8 9.5 10.5-7.2 3.7-8.8 5.3-9.5 10.5-.7-5.2-2.3-6.8-9.5-10.5C9.7 8.3 11.3 6.7 12 1.5z"/></svg>',
link:'<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/></svg>',
refresh:'<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>',
edit:'<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
list:'<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/></svg>'
};
const icon=k=>!k?"":String(k).trim().startsWith("<")?String(k):(IC[k]||"");

/* ============ 发音（TTS） ============
 * 两种发音来源，由 S.settings.voice 决定：auto（默认）| system | online
 *  - system：浏览器的 speechSynthesis，用手机/电脑自带的日语语音（快、可离线）。
 *  - online：在线日语发音（mp3），用 <audio> 播放。很多安卓手机没装日语语音，
 *    微信内置浏览器根本没有 speechSynthesis，这时只能靠它。需要联网。
 *    两个来源：有道词典（单词音质好，但大部分句子读不出来）、百度翻译（句子都能读，音质一般）。
 *    单词先试有道、句子先试百度，失败了自动换另一个，并记住这句话哪个来源读不了。
 *    百度有防盗链（请求带着别的网站地址就不给声音），所以页面头部有 <meta name="referrer" content="no-referrer">。
 * auto：检测到日语语音就用自带的，否则用在线发音；任一种失败（自带语音卡住不出声、在线发音断网）就自动换另一种。
 * 对外保持旧接口：tts.ok（能不能发音）、tts.voice（自带的日语语音或 null）、tts.voices。新增 tts.ja()、tts.engine()、tts.mode()。 */
const SS=W.speechSynthesis&&W.SpeechSynthesisUtterance?W.speechSynthesis:null;
const tts={sys:!!SS,voice:null,voices:[],sysBad:0,sysFails:0,onlineBad:0,err:"",used:""};
/* 自带语音失败一次：90 秒内先用在线发音；同一次打开里失败两次：这次就一直用在线发音（不再每次多等几秒去试） */
function sysFail(){tts.sysBad=Date.now();tts.sysFails++}
const voiceMode=()=>{const v=S&&S.settings&&S.settings.voice;return v==="system"||v==="online"?v:"auto"};
const onlineOK=()=>voiceMode()!=="system"&&typeof W.Audio==="function"&&!(W.navigator&&W.navigator.onLine===false);
const RECENT=90000;/* 某种来源刚失败过：90 秒内 auto 模式先用另一种 */
function engine(){
  const m=voiceMode(),now=Date.now();
  if(m==="online")return onlineOK()?"online":(tts.sys?"system":"none");
  if(m==="system")return tts.sys?"system":"none";
  const sysGood=tts.sys&&!!tts.voice&&tts.sysFails<2&&now-tts.sysBad>RECENT;
  if(sysGood)return "system";
  if(onlineOK()&&now-tts.onlineBad>RECENT)return "online";
  if(tts.sys&&tts.voice)return "system";
  if(onlineOK())return "online";
  return tts.sys?"system":"none";
}
Object.defineProperty(tts,"ok",{get:()=>tts.sys||onlineOK(),enumerable:true});
/* 现在能不能发出像样的日语：有自带日语语音，或可以用在线发音 */
tts.ja=()=>{const e=engine();return e==="online"||(e==="system"&&!!tts.voice)};
tts.engine=engine;tts.mode=voiceMode;
const FEMALE=/kyoko|haruka|nanami|ayumi|sayaka|mizuki|o-ren|aoi|shiori|mayu|female|女性|google 日本語/i;
const MALE=/otoya|ichiro|keita|hattori|daichi|naoki|\bmale\b|男性/i;
const JA_VOICE=v=>/^ja([-_]|$)/i.test(v.lang||"")||/japan|日本|日語|日语/i.test(v.name||"");
function loadVoices(){if(!SS)return;try{const vs=SS.getVoices()||[];tts.voices=vs.filter(JA_VOICE);
  /* 优先本地语音：在国内 Google 在线语音常常放不出声 */
  tts.voice=tts.voices.find(v=>v.localService)||tts.voices[0]||null}catch(e){}}
if(SS){loadVoices();try{SS.addEventListener("voiceschanged",loadVoices)}catch(e){try{SS.onvoiceschanged=loadVoices}catch(e2){}}
  /* 安卓 Chrome 的语音列表常常要过一会儿才出来，有的机型还不触发 voiceschanged：开头 6 秒内每 300ms 再查一次 */
  if(!tts.voice&&typeof setInterval==="function"){let n=0;const iv=setInterval(()=>{loadVoices();if(tts.voice||++n>=20)clearInterval(iv)},300)}}
function pickVoice(hint){
  if(!hint)return tts.voice;const vs=tts.voices;let v=null;
  if(hint==="female")v=vs.find(x=>FEMALE.test(x.name)&&x.localService)||vs.find(x=>FEMALE.test(x.name));
  else if(hint==="male")v=vs.find(x=>MALE.test(x.name)&&x.localService)||vs.find(x=>MALE.test(x.name));
  else{const h=String(hint).toLowerCase();v=vs.find(x=>x.name.toLowerCase().includes(h))}
  return v||tts.voice;
}
/* 用户设置的语速倍数（0.7–1.3，默认 1），乘在各处传进来的 rate 上；rate .9 是“正常” */
const userSpeed=()=>{const v=+(S&&S.settings&&S.settings.speed);return isFinite(v)&&v>=.6&&v<=1.5?v:1};
let curU=null,curFin=null,audioEl=null,speakTok=0,lastCancel=0;
/* 自带语音 */
function speakSystem(txt,o,rate,tok){
  return new Promise(res=>{
    if(!SS){res(false);return}
    let done=false,started=false,tm=null,st=null,u=null;
    const fin=ok=>{if(done)return;done=true;clearTimeout(tm);clearTimeout(st);if(curU===u)curU=null;if(curFin===fin)curFin=null;res(ok)};
    curFin=fin;
    const go=()=>{
      if(done||tok!==speakTok){fin(false);return}
      try{
        u=new W.SpeechSynthesisUtterance(txt);u.lang="ja-JP";
        const v=pickVoice(o.voiceHint);if(v)u.voice=v;
        u.rate=rate;u.pitch=o.pitch||1;
        const t0=Date.now();
        u.onstart=()=>{started=true;clearTimeout(st)};
        /* 安卓上日语语音包「列出来了但没装好」时，会一下子就「读完」却没有声音：不到 0.15 秒就结束的算失败，换在线发音 */
        u.onend=()=>{if(Date.now()-t0<150){tts.err="too-fast";sysFail();fin(false)}else fin(true)};
        u.onerror=ev=>{const er=(ev&&ev.error)||"error";if(er!=="interrupted"&&er!=="canceled"){tts.err=er;sysFail()}fin(false)};
        curU=u;/* 留住引用：Chrome 有时会回收正在读的句子，onend 就永远不来 */
        tm=setTimeout(()=>fin(true),Math.min(30000,2000+txt.length*300/rate));
        /* 安卓上偶尔一直不开始读：2.5 秒还没开始，就算这次失败，换在线发音 */
        st=setTimeout(()=>{if(!started&&!SS.speaking){tts.err="no-start";sysFail();try{SS.cancel()}catch(e){}fin(false)}},2500);
        try{SS.resume()}catch(e){}
        SS.speak(u);
      }catch(e){fin(false)}
    };
    /* 安卓 Chrome：cancel() 之后立刻 speak() 常常没声音，离上次 cancel 不到 120ms 就等一等再读 */
    let busy=false;try{busy=SS.speaking||SS.pending}catch(e){}
    if(busy){try{SS.cancel()}catch(e){}lastCancel=Date.now()}
    const wait=120-(Date.now()-lastCancel);
    if(wait>0)setTimeout(go,wait);else go();
  });
}
/* 在线发音：长句按句号分段，逐段播放；每段按顺序试几个来源 */
const PROV={
  youdao:s=>"https://dict.youdao.com/dictvoice?le=jap&audio="+encodeURIComponent(s),
  baidu:s=>"https://fanyi.baidu.com/gettts?lan=jp&spd=5&source=web&text="+encodeURIComponent(s)
};
const provBad=new Map();/* "来源|文字" → 这一来源读不了这段（本次打开网站内有效，最多记 500 条） */
function provOrder(s){const word=s.length<=10&&!/[。、！？!?，,\s]/.test(s);return word?["youdao","baidu"]:["baidu","youdao"]}
function onlineParts(t){
  if(t.length<=120)return [t];
  const out=[];let cur="";
  for(const p of t.replace(/([。！？!?\n])/g,"$1\u0000").split("\u0000")){
    if((cur+p).length<=120){cur+=p;continue}
    if(cur)out.push(cur);
    cur=p;while(cur.length>120){const i=Math.max(cur.lastIndexOf("、",120),60);out.push(cur.slice(0,i+1));cur=cur.slice(i+1)}
  }
  if(cur)out.push(cur);return out.filter(x=>x.trim());
}
function playUrl(url,rate,tok){
  return new Promise(res=>{
    let done=false,stall=null,cap=null;
    if(!audioEl){try{audioEl=new W.Audio();audioEl.preload="auto";audioEl.setAttribute("playsinline","")}catch(e){res(false);return}}
    const a=audioEl;
    const fin=ok=>{if(done)return;done=true;clearTimeout(stall);clearTimeout(cap);a.onended=a.onerror=a.onplaying=null;if(curFin===fin)curFin=null;res(ok)};
    curFin=fin;
    if(tok!==speakTok){fin(false);return}
    a.onplaying=()=>{clearTimeout(stall);cap=setTimeout(()=>fin(true),45000)};
    a.onended=()=>fin(true);
    a.onerror=()=>{tts.err="online-error";fin(false)};
    /* 网太慢、8 秒还没开始播放：算失败 */
    stall=setTimeout(()=>{tts.err="online-timeout";try{a.pause()}catch(e){}fin(false)},8000);
    try{
      const pr=Math.max(.5,Math.min(2,rate/.9));
      a.src=url;try{a.defaultPlaybackRate=pr}catch(e){}a.playbackRate=pr;
      const p=a.play();
      if(p&&typeof p.catch==="function")p.catch(err=>{if(err&&err.name==="NotAllowedError"){tts.err="blocked";fin(false)}else if(err&&err.name==="AbortError"){fin(false)}else{tts.err="online-error";fin(false)}});
    }catch(e){fin(false)}
  });
}
async function speakOnline(txt,rate,tok){
  for(const part of onlineParts(txt)){
    let ok=false;
    for(const p of provOrder(part)){
      if(tok!==speakTok)return false;
      const k=p+"|"+part;if(provBad.has(k))continue;
      tts.err="";
      ok=await playUrl(PROV[p](part),rate,tok);
      if(ok||tok!==speakTok||tts.err==="blocked")break;
      if(provBad.size>500)provBad.clear();
      provBad.set(k,1);
    }
    if(!ok)return false;
  }
  return true;
}
/* speak(text,{rate,pitch,voiceHint,kana}) → Promise<boolean>（读完 true；失败或被打断 false） */
function speak(t,o){
  o=o||{};
  if(t==null||t==="")return Promise.resolve(false);
  const txt=(o.kana?reading(t):plain(t)).replace(/（　）|（\s*）|\(\s*\)/g,"").replace(/[〜～]/g,"").trim();
  if(!txt)return Promise.resolve(false);
  stopSpeak();const tok=++speakTok;
  const rate=Math.max(.5,Math.min(1.6,(o.rate||.9)*userSpeed()));
  const first=engine();if(first==="none")return Promise.resolve(false);
  const run=e=>{tts.used=e;return e==="online"?speakOnline(txt,rate,tok).then(ok=>{if(!ok&&tok===speakTok&&tts.err!=="blocked")tts.onlineBad=Date.now();return ok}):speakSystem(txt,o,rate,tok)};
  return run(first).then(ok=>{
    if(ok||tok!==speakTok||voiceMode()!=="auto")return ok;
    /* 这一种失败了（不是被打断）：换另一种再试一次 */
    const other=first==="online"?(tts.sys?"system":""):(onlineOK()?"online":"");
    if(!other||tts.err==="blocked")return false;
    return run(other);
  });
}
function stopSpeak(){
  speakTok++;
  const f=curFin;curFin=null;
  if(audioEl)try{audioEl.pause()}catch(e){}
  if(SS)try{if(SS.speaking||SS.pending){SS.cancel();lastCancel=Date.now()}}catch(e){}
  if(f)f(false);
}
/* 设置页「试听」用：读一句，返回 {ok, engine, err} */
function testVoice(){const t0=Date.now();return speak("こんにちは。日本語の勉強、がんばりましょう。").then(ok=>({ok,engine:tts.used,err:ok?"":tts.err,ms:Date.now()-t0}))}
tts.test=testVoice;
/* 一句话说明现在用哪种发音（设置页、提示里用） */
function voiceStatus(){
  const e=engine();
  if(e==="system")return tts.voice?"正在用这台设备自带的日语语音（"+tts.voice.name+"）":"正在用这台设备自带的语音，但没检测到日语语音，可能读不准";
  if(e==="online")return "正在用在线发音（有道词典），需要联网"+(tts.sys&&!tts.voice?"；这台设备没检测到日语语音":"");
  return "这个浏览器不能发音";
}
/* 「听不到日语发音？」折叠说明 */
function voiceHelp(open){
  return `<details class="fold note vhelp"${open?" open":""}><summary><span class="tagk">!</span>听不到日语发音？</summary><div>
    <b>最省事：</b>到「我的 → 发音」把「发音来源」选「在线发音」（要联网）。<br>
    <b>想用手机自带语音（不联网也能读）：</b><br>
    · 安卓：在设置里搜「文字转语音」→「首选引擎」选「Google 文字转语音」→ 点齿轮 →「安装语音数据」→ 日语。手机里没有 Google 引擎的，可以在应用商店搜「Google 文字转语音」安装。<br>
    · iPhone：设置 → 辅助功能 → 朗读内容 → 声音 → 日语，下载一个语音。<br>
    · 在微信里打开的：点右上角「···」→「在浏览器打开」，声音更稳定。<br>
    <button class="btn sm" data-act="govoice" style="margin-top:8px">去发音设置</button></div></details>`;
}

/* ============ 内容注册 ============ */
const BOOKS=[
  {id:"b1",t:"初级上",lv:"N5",from:1,to:24,sub:"第 1–24 课"},
  {id:"b2",t:"初级下",lv:"N4",from:25,to:48,sub:"第 25–48 课"},
  {id:"b3",t:"中级上",lv:"N3",from:1,to:16,sub:"第 1–16 课"},
  {id:"b4",t:"中级下",lv:"N2",from:17,to:32,sub:"第 17–32 课"},
  {id:"b5",t:"高级上",lv:"N1",from:1,to:12,sub:"第 1–12 课"},
  {id:"b6",t:"高级下",lv:"N1",from:13,to:24,sub:"第 13–24 课"}
];
BOOKS.forEach(b=>{b.n=b.to-b.from+1});
const LEVELS=["N5","N4","N3","N2","N1"];
const RAWB={};
let LESSONS=[],WORDS=[],LMAP={},WMAP={},EASY=[],TESTS={};
let booted=false;

function addBook(data){
  if(!data)return;const bid=String(data.book||data.id||"");
  if(!BOOKS.some(b=>b.id===bid)){console.warn("[yume] 未知的册 id：",bid);return}
  const m=RAWB[bid]=RAWB[bid]||new Map();
  for(const l of Array.isArray(data.lessons)?data.lessons:[])if(l&&l.id!=null)m.set(String(l.id),l);
  BOOKCACHE=null;
  if(booted){rebuild();render()}
}
function addEasy(list){
  const arr=Array.isArray(list)?list:list&&Array.isArray(list.episodes)?list.episodes:[];
  const m=new Map(EASY.map(e=>[e.id,e]));
  for(const e of arr)if(e&&e.id!=null)m.set(String(e.id),Object.assign({},e,{id:String(e.id)}));
  EASY=[...m.values()].sort((a,b)=>(a.no||0)-(b.no||0));
  if(booted)render();
}
/* 首页「一言」短句：[日文(振假名), 中文, 类别 poem|work|easy, 出处] */
let QUOTES=[];
function addQuotes(list){
  if(!Array.isArray(list))return;
  QUOTES=QUOTES.concat(list.filter(q=>Array.isArray(q)&&typeof q[0]==="string"&&q[0]&&typeof q[1]==="string").map(q=>[q[0],q[1],["poem","work","easy"].includes(q[2])?q[2]:"easy",typeof q[3]==="string"?q[3]:""]));
  if(booted&&ui.tab==="home")render();
}
function addTests(obj){
  if(!obj)return;
  const put=(lv,items)=>{if(LEVELS.includes(lv)&&Array.isArray(items))TESTS[lv]=items};
  if(Array.isArray(obj)){for(const t of obj)if(t)put(t.level,t.items)}
  else if(obj.level&&obj.items)put(obj.level,obj.items);
  else for(const k in obj){const v=obj[k];put(k,Array.isArray(v)?v:v&&v.items)}
  if(booted)render();
}

function parseWord(lid,line){
  if(Array.isArray(line))line=line.join("|");
  const [ja,kana,zh,pos]=String(line==null?"":line).split("|").map(x=>(x||"").trim());
  return ja&&zh?{key:lid+":"+ja,ja,kana:kana||"",zh,pos:pos||"",lid}:null;
}
const str=x=>x==null?"":String(x);
function normGrammar(g){
  if(!g||!g.p)return null;
  return{p:str(g.p),c:str(g.c),m:str(g.m),d:str(g.d),
    ex:(Array.isArray(g.ex)?g.ex:[]).filter(e=>Array.isArray(e)&&e[0]).map(e=>[str(e[0]),str(e[1])]),
    note:str(g.note),cmp:str(g.cmp),lv:LEVELS.includes(str(g.lv))?str(g.lv):""};
}
function normQuiz(q){
  if(!Array.isArray(q)||!q[0]||!Array.isArray(q[1])||q[1].length<2)return null;
  return [str(q[0]),q[1].map(str),str(q[2]),str(q[3])];
}
function normLesson(l,b){
  const id=String(l.id);
  const no=Number.isFinite(+l.no)&&l.no!==""&&l.no!=null?+l.no:(/^\d+$/.test(id)?+id:null);
  return{id,no,book:b?b.id:"custom",lv:b?b.lv:"",t:str(l.t||l.title),s:str(l.s||l.sub),custom:!b,
    words:(Array.isArray(l.words)?l.words:[]).map(x=>parseWord(id,x)).filter(Boolean),
    grammar:(Array.isArray(l.grammar)?l.grammar:[]).map(normGrammar).filter(Boolean),
    quiz:(Array.isArray(l.quiz)?l.quiz:[]).map(normQuiz).filter(Boolean)};
}
let BOOKCACHE=null;/* 整理好的课本课程（addBook 时作废） */
function rebuild(){
  if(!BOOKCACHE){BOOKCACHE=[];for(const b of BOOKS){const m=RAWB[b.id];if(!m)continue;
    BOOKCACHE.push(...[...m.values()].map(l=>normLesson(l,b)).sort((x,y)=>(x.no||0)-(y.no||0)))}}
  /* 浅拷贝：自制课程并入已有课时只改拷贝，缓存保持原样 */
  const out=BOOKCACHE.map(l=>Object.assign({},l,{words:l.words.slice(),grammar:l.grammar.slice(),quiz:l.quiz.slice()}));
  for(const c of S.custom||[]){
    if(!c||c.id==null)continue;
    const id=String(c.id);const hit=out.find(l=>l.id===id);
    const nl=normLesson({id,title:c.title||"我的课程",sub:c.sub||"",words:c.words,grammar:c.grammar,quiz:c.quiz},null);
    if(hit){const have=new Set(hit.words.map(w=>w.key));hit.words.push(...nl.words.filter(w=>!have.has(w.key)));hit.grammar.push(...nl.grammar);hit.quiz.push(...nl.quiz)}
    else{nl.no=null;nl.t=nl.t||"我的课程";nl.sys=isWordList(c);out.push(nl)}
  }
  LESSONS=out;LMAP={};WMAP={};WORDS=[];
  /* 跨课重复的单词（同写法同读音）：只有第一次出现的那一课算新词；后面的课里按「复习词」显示（w.rep=首次出现的课 id），
   * 和第一次共用同一个进度键，不重复计数、每日新词里也不会再教一遍。自制课程、生词本不参与。 */
  const first={};
  for(const l of LESSONS){LMAP[l.id]=l;for(let wi=0;wi<l.words.length;wi++){const w=l.words[wi];
    if(!l.custom){const ck=w.ja+"|"+w.kana;const f=first[ck];
      /* 复习词：换成一份拷贝（l.words 是本次 rebuild 的拷贝数组），不改课本缓存里的词对象 */
      if(f&&f.lid!==l.id){l.words[wi]=Object.assign({},w,{key:f.key,rep:f.lid});continue}
      if(!f)first[ck]=w}
    if(!WMAP[w.key]){WMAP[w.key]=w;WORDS.push(w)}}}
}
/* 内容改版后，把旧单词进度挪到同一册里同写法的新位置（只挪没有进度的目标） */
function migrateOrphans(){
  const byJa={};for(const w of WORDS){const l=LMAP[w.lid];const k=(l?l.book:"")+"|"+w.ja;(byJa[k]=byJa[k]||[]).push(w)}
  let n=0;
  for(const k of Object.keys(S.words)){
    if(WMAP[k])continue;const i=k.indexOf(":");if(i<0)continue;
    const lid=k.slice(0,i),ja=k.slice(i+1);
    const book=/^\d+$/.test(lid)?"b1":((lid.match(/^(b\d)-\d+$/)||[])[1]);
    if(!book||!LESSONS.some(l=>l.book===book))continue;
    const cand=(byJa[book+"|"+ja]||[]).filter(w=>!S.words[w.key]).sort((a,b)=>(a.lid===lid?-1:0)-(b.lid===lid?-1:0));
    if(cand.length){S.words[cand[0].key]=S.words[k];delete S.words[k];n++}
  }
  if(n){console.info("[yume] 迁移了",n,"个单词进度");persistLocal()}
  return n;
}

/* ============ 查询 ============ */
const book=id=>BOOKS.find(b=>b.id===id)||null;
const lesson=id=>LMAP[String(id)]||null;
const word=key=>WMAP[key]||null;
const bookLessons=id=>LESSONS.filter(l=>l.book===id);
const lvClass=lv=>{const s=String(lv||"").toLowerCase();return /^n[1-5]$/.test(s)?s:""};
/* 一课里第一次出现的单词（不含复习词） */
const newWords=l=>l?l.words.filter(w=>!w.rep):[];

/* ============ 进度 ============ */
const wordState=w=>S.words[typeof w==="string"?w:w.key];
const isMastered=w=>((wordState(w)||{}).lv||0)>=5;
/* 单词 50%、语法 30%、练习 20%；缺的部分不算（只有单词的生词本按单词算） */
function lessonProg(l){
  if(!l)return 0;let sum=0,wt=0;
  if(l.words.length){sum+=.5*l.words.filter(w=>{const s=wordState(w);return s&&s.lv>=1}).length/l.words.length;wt+=.5}
  if(l.grammar.length){sum+=.3*l.grammar.filter((_,i)=>S.grammar[l.id+"-"+i]).length/l.grammar.length;wt+=.3}
  if(l.quiz.length){sum+=.2*Math.min(1,(S.quiz[l.id]||0)/l.quiz.length);wt+=.2}
  return wt?Math.min(1,sum/wt):0;
}
function bookProg(id){const ls=bookLessons(id);if(!ls.length)return{p:0,done:0,n:0,words:0};
  let sum=0,done=0,words=0;for(const l of ls){const p=lessonProg(l);sum+=p;if(p>=.999)done++;words+=newWords(l).length}
  return{p:sum/ls.length,done,n:ls.length,words}}
function streak(){let n=0;const d=new Date();if(!S.days[dkey(d)])d.setDate(d.getDate()-1);while(S.days[dkey(d)]){n++;d.setDate(d.getDate()-1)}return n}
function bestStreak(){const ks=Object.keys(S.days).filter(k=>S.days[k]>0).sort();let best=0,cur=0,prev=null;for(const k of ks){const t=new Date(k+"T00:00:00").getTime();cur=prev!==null&&Math.round((t-prev)/DAY)===1?cur+1:1;best=Math.max(best,cur);prev=t}return best}
function backupDays(){return S.lastBackup?Math.max(0,Math.round((Date.parse(today())-Date.parse(S.lastBackup))/DAY)):null}
function backupAgo(){const d=backupDays()||0;return d<=0?"今天":d+" 天前"}
function backupDue(){if(S.xp<30)return false;if(!S.lastBackup)return true;return (Date.parse(today())-Date.parse(S.lastBackup))/DAY>=7}
const lvNeed=k=>25*(k-1)*(k-1);
function level(){let k=1;while(S.xp>=lvNeed(k+1))k++;return{k,from:lvNeed(k),to:lvNeed(k+1)}}
function addXP(n){n=Math.round(+n||0);if(n<=0)return;S.xp+=n;const d=today();S.days[d]=(S.days[d]||0)+n}
/* 扣回 XP（撤销当天刚拿的奖励时用），不低于 0 */
function takeXP(n){n=Math.round(+n||0);if(n<=0)return;S.xp=Math.max(0,S.xp-n);const d=today();if(S.days[d])S.days[d]=Math.max(0,S.days[d]-n)}
/* 同一件事只奖励一次（id 自定，比如 "g:3-0"）。记录在本机独立存储里。返回实际加的 XP */
const XO="xp-once";
/* 记录表只从本机读一次，之后用内存里的（以前每次都整张读出来再写回）；最多留最近 5000 条 */
let XOM=null;
const xoMap=()=>{if(!XOM){const o=store.get(XO,{});XOM=isObj(o)?o:{}}return XOM};
function xpOnce(id,n){
  const m=xoMap();id=String(id);if(m[id])return 0;
  m[id]=today();const ks=Object.keys(m);if(ks.length>5000)for(const k of ks.slice(0,ks.length-5000))delete m[k];
  store.set(XO,m);addXP(n);return Math.round(+n||0);
}
/* 撤销：如果这份奖励是今天拿的，就扣回 n 并删掉记录（之后可以再拿一次）；更早拿的不扣、记录保留。返回扣掉的 XP */
function xpRevoke(id,n){const o=xoMap();id=String(id);if(o[id]!==today())return 0;delete o[id];store.set(XO,o);takeXP(n);return Math.round(+n||0)}
function newToday(){return S.nd.d===today()?S.nd.n:0}
function counts(){let learned=0,mastered=0;for(const w of WORDS){const s=wordState(w);if(s){learned++;if(s.lv>=5)mastered++}}return{learned,mastered}}
function dueWords(){const now=Date.now();return WORDS.filter(w=>{const s=wordState(w);return s&&s.due<=now}).sort((a,b)=>wordState(a).due-wordState(b).due)}
function trackBook(){return book(S.settings.track)||BOOKS[0]}
/* 新词来源：当前学习的册（课序）→ 之后的册 → 之前的册 → 自制课程 */
function freshPool(){
  const i=BOOKS.indexOf(trackBook());const order=BOOKS.slice(i).concat(BOOKS.slice(0,i)).map(b=>b.id).concat(["custom"]);
  const by={};for(const w of WORDS){const l=LMAP[w.lid];const b=l?l.book:"custom";(by[b]=by[b]||[]).push(w)}
  return order.flatMap(b=>(by[b]||[]).filter(w=>!wordState(w)));
}
let planMemo=null;
function plan(){
  const k=[S.updated,Math.floor(Date.now()/60000),S.settings.track,S.settings.newPerDay,WORDS.length,newToday()].join("|");
  if(planMemo&&planMemo.k===k)return{due:planMemo.due.slice(),fresh:planMemo.fresh.slice()};
  const due=dueWords().slice(0,30);const left=Math.max(0,S.settings.newPerDay-newToday());const fresh=left?freshPool().slice(0,left):[];
  planMemo={k,due,fresh};return{due:due.slice(),fresh:fresh.slice()};
}
/* 记录一次单词作答（与单词练习同一套间隔复习规则，不加 XP）。返回该词状态 */
function markWord(w,ok){
  w=typeof w==="string"?WMAP[w]:w;if(!w)return null;const now=Date.now();let s=S.words[w.key];
  if(!s){s=S.words[w.key]={lv:0,due:now,r:0,x:0};S.nd=S.nd.d===today()?{d:S.nd.d,n:S.nd.n+1}:{d:today(),n:1}}
  if(ok){s.lv=Math.min(6,s.lv+1);s.due=now+IV[s.lv];s.r++}else{s.lv=Math.max(0,s.lv-2);s.due=now;s.x++}
  return s;
}
/* 各等级统计：等级自测/学习分析用 */
function levelStats(){
  const out={};for(const lv of LEVELS)out[lv]={lv,lessons:0,lDone:0,words:0,learned:0,mastered:0,grammar:0,gDone:0,quiz:0,quizBest:0,prog:0};
  for(const l of LESSONS){const o=out[l.lv];if(!o)continue;o.lessons++;const p=lessonProg(l);o.prog+=p;if(p>=.999)o.lDone++;
    for(const w of newWords(l)){o.words++;const s=wordState(w);if(s){o.learned++;if(s.lv>=5)o.mastered++}}
    l.grammar.forEach((_,i)=>{o.grammar++;if(S.grammar[l.id+"-"+i])o.gDone++});
    o.quiz+=l.quiz.length;o.quizBest+=Math.min(l.quiz.length,S.quiz[l.id]||0)}
  for(const lv of LEVELS){const o=out[lv];o.prog=o.lessons?o.prog/o.lessons:0}
  return out;
}

/* ============ 徽章与称号 ============ */
const BADGES=[
{id:"first",k:"歩",t:"第一步",d:"学会第 1 个单词",ok:()=>counts().learned>=1},
{id:"w50",k:"積",t:"积少成多",d:"学过 50 个单词",ok:()=>counts().learned>=50},
{id:"w100",k:"百",t:"百词在手",d:"学过 100 个单词",ok:()=>counts().learned>=100},
{id:"m20",k:"記",t:"牢牢记住",d:"20 个单词达到熟记",ok:()=>counts().mastered>=20},
{id:"s3",k:"坊",t:"不做三日坊主",d:"连续学习 3 天",ok:()=>bestStreak()>=3},
{id:"s7",k:"週",t:"一周不断",d:"连续学习 7 天",ok:()=>bestStreak()>=7},
{id:"s30",k:"月",t:"月月坚持",d:"连续学习 30 天",ok:()=>bestStreak()>=30},
{id:"g10",k:"文",t:"语法入门",d:"掌握 10 个语法点",ok:()=>Object.keys(S.grammar).length>=10},
{id:"perfect",k:"満",t:"满分答卷",d:"任意一课练习全对",ok:()=>LESSONS.some(l=>l.quiz.length&&(S.quiz[l.id]||0)>=l.quiz.length)},
{id:"c20",k:"連",t:"二十连击",d:"一轮中连续答对 20 题",ok:()=>S.maxCombo>=20},
{id:"l1",k:"卒",t:"第一课毕业",d:"完成任意一课",ok:()=>LESSONS.some(l=>lessonProg(l)>=.999)},
{id:"half",k:"半",t:"初级上半程",d:"完成初级上 12 课",ok:()=>bookLessons("b1").filter(l=>lessonProg(l)>=.999).length>=12},
{id:"xp1k",k:"千",t:"千里之行",d:"累计 1000 XP",ok:()=>S.xp>=1000},
{id:"w300",k:"博",t:"词汇三百",d:"学过 300 个单词",ok:()=>counts().learned>=300},
{id:"g50",k:"法",t:"语法达人",d:"掌握 50 个语法点",ok:()=>Object.keys(S.grammar).length>=50},
{id:"b1done",k:"初",t:"初级上毕业",d:"完成初级上全部 24 课",ok:()=>{const ls=bookLessons("b1");return ls.length>=24&&ls.every(l=>lessonProg(l)>=.999)}}
];
function registerBadge(b){if(!b||!b.id||typeof b.ok!=="function")return;const i=BADGES.findIndex(x=>x.id===b.id);if(i>=0)BADGES[i]=b;else BADGES.push(b)}
const TITLES=[
{d:3,k:"三",t:"三日坊主克星",tip:"打破三分钟热度"},
{d:5,k:"五",t:"五日之星",tip:"连续 5 天"},
{d:7,k:"七",t:"一周勇者",tip:"整整一周没断"},
{d:14,k:"半",t:"半月达人",tip:"坚持两周"},
{d:30,k:"月",t:"月之守护者",tip:"一个月风雨无阻"},
{d:60,k:"花",t:"花见之约",tip:"连续 60 天"},
{d:100,k:"百",t:"百日修行者",tip:"连续 100 天"},
{d:365,k:"夢",t:"梦想成真",tip:"连续一整年"}
];
function curTitle(){const b=bestStreak();let t=null;for(const x of TITLES)if(b>=x.d)t=x;return t}
function nextTitle(){const s=streak();return TITLES.find(x=>x.d>s)||null}
function checkTitles(){let got=null;const b=bestStreak();for(const x of TITLES){if(!S.titles[x.d]&&b>=x.d){S.titles[x.d]=today();got=x}}if(got)celebrate(got)}
function celebrate(t){if(!booted)return;const box=$("#cele");box.innerHTML=`<div class="celebox" role="dialog" aria-modal="true" aria-label="获得称号"><div class="cflame">${IC.flame}</div><div class="cday num">${t.d}</div><div class="muted">天连续学习</div><span class="seal big" lang="ja">${t.k}</span><div>获得称号</div><h2 style="font-size:24px">「${esc(t.t)}」</h2><div class="small muted">${esc(t.tip)}</div><button class="btn gold block" data-act="celeok">太棒了</button></div>`;box.hidden=false}
function checkBadges(){for(const b of BADGES){let ok=false;try{ok=!S.badges[b.id]&&b.ok()}catch(e){}if(ok){S.badges[b.id]=today();toast(`<span class="seal">${esc(b.k)}</span>获得徽章「${esc(b.t)}」`)}}checkTitles()}

/* ============ 提示 ============ */
let toastT=null;
function toast(html,ms){if(!booted)return;const box=$("#toastbox");box.innerHTML=`<div class="toast" role="status">${html}</div>`;clearTimeout(toastT);toastT=setTimeout(()=>box.innerHTML="",ms||2600)}

/* ============ 小部件 HTML ============ */
function ring(p,size,stroke,color){const r=(size-stroke)/2,c=2*Math.PI*r;return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--sunk)" stroke-width="${stroke}"/><circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c*(1-Math.min(1,Math.max(0,p||0)))}"/></svg>`}
function lvDots(w){const lv=(wordState(w)||{}).lv||0;return `<span class="lv ${lv>=5?"m":""}" title="熟练度 ${Math.min(lv,5)}/5">${[1,2,3,4,5].map(i=>`<i class="${lv>=i?"on":""}"></i>`).join("")}</span>`}
/* 词性：课程词表用的 16 种 + 字幕分词可能用到的 助/助动 */
const POS={
  "名":{n:"名词",c:"noun"},"代":{n:"代词",c:"noun"},"数":{n:"数词",c:"noun"},"助数":{n:"量词",c:"noun"},
  "动1":{n:"一类动词",c:"verb"},"动2":{n:"二类动词",c:"verb"},"动3":{n:"三类动词",c:"verb"},"动":{n:"动词",c:"verb"},
  "い形":{n:"い形容词",c:"adj"},"な形":{n:"な形容词",c:"na"},"副":{n:"副词",c:"adv"},
  "助":{n:"助词",c:"part"},"助动":{n:"助动词",c:"aux"},
  "连体":{n:"连体词",c:"other"},"接续":{n:"接续词",c:"other"},"感":{n:"感叹词",c:"other"},
  "惯用":{n:"惯用语",c:"other"},"接头":{n:"接头词",c:"other"},"接尾":{n:"接尾词",c:"other"}
};
const posCls=p=>"pc-"+((POS[p]||{}).c||"other");
function posTag(p){if(!p)return "";const x=POS[p];return `<span class="pos ${posCls(p)}" title="${esc(x?x.n:p)}">${esc(p)}</span>`}
/* 跟读按钮占位：只有 speech.js 设置了 Yume.speech 才渲染 */
function speakCheckBtn(w,cls){if(!Y.speech||!w)return "";return `<button class="iconbtn mic ${cls||""}" data-act="speakcheck" data-ja="${esc(plain(w.ja))}" data-kana="${esc(w.kana||reading(w.ja))}" data-zh="${esc(w.zh||"")}"${w.key?` data-key="${esc(w.key)}"`:""} aria-label="跟读">${IC.mic}</button>`}
function sayBtn(text,label,o){o=o||{};return `<button class="iconbtn ${o.cls||""}" data-act="say" data-t="${esc(text)}"${o.kana?' data-kana="1"':""} aria-label="${esc(label||"发音")}">${IC.spk}</button>`}

/* ============ 标签页、动作、卡片插槽 ============ */
const TABS={};
const FIXED=[["home","今日","home",0],["kana","五十音","kana",10],["course","课程","book",20],["easy","会话","chat",30],["media","视听","tv",40],["me","我的","me",50]];
for(const [id,label,ic,order] of FIXED)TABS[id]={id,label,icon:ic,order,placeholder:true,render:()=>soon(label)};
function soon(label){return `<div class="stack"><div><div class="eyebrow">${esc(label)}</div><h1 style="font-size:24px">${esc(label)}</h1></div><div class="card soon"><span class="seal" lang="ja">待</span><b>即将上线</b><div class="small muted">这个板块正在制作中，先去学单词和课程吧。</div><button class="btn primary sm" data-act="tab" data-k="course">去课程</button></div></div>`}
function registerTab(t){if(!t||!t.id||typeof t.render!=="function")return;const old=TABS[t.id]||{};TABS[t.id]=Object.assign({},old,t,{placeholder:false,order:t.order!=null?t.order:(old.order!=null?old.order:100)});if(booted)render()}
const A={};
function registerAction(name,fn){if(name&&typeof fn==="function")A[name]=fn}
const CARDS={};
function registerCard(slot,fn,opts){if(typeof fn!=="function")return;(CARDS[slot]=CARDS[slot]||[]).push({fn,order:(opts&&opts.order)||0});CARDS[slot].sort((a,b)=>a.order-b.order)}
function cards(slot,ctx){return (CARDS[slot]||[]).map(c=>{try{return c.fn(ctx)||""}catch(e){console.error("[yume] 卡片出错",slot,e);return ""}}).join("")}

/* ============ 界面状态与渲染 ============ */
const ui={tab:"home"};
const AFTER=[];
function onRender(fn){if(typeof fn==="function")AFTER.push(fn)}
function render(){
  if(!booted)return;
  const tab=TABS[ui.tab]||TABS.home;
  let html;try{html=tab.render()}catch(e){console.error("[yume] 渲染出错",ui.tab,e);html=`<div class="card"><b class="err">这个页面出错了</b><div class="small muted">${esc(e&&e.message)}</div></div>`}
  if(LOAD.why==="parse"&&!LOAD.ack)html=`<div class="card stack" style="gap:10px;margin-bottom:12px;background:var(--bad-soft);box-shadow:none"><div class="row" style="gap:12px;align-items:flex-start"><span class="seal" lang="ja" style="border-color:var(--bad);color:var(--bad)">損</span><div class="grow"><b style="color:var(--bad)">原来的学习存档读不出来（可能损坏了）</b><div class="small" style="margin-top:4px">${LOAD.kept||LOAD.keptIDB?"原始数据已经另外保存了一份，不会被覆盖。":"原始数据还没能另存，在你确认之前，这里不会写入新的进度。"}可以先复制原始数据发给开发者帮忙修复；也可以从「我的 → 存档与备份」恢复以前保存的存档。</div></div></div>
    <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn sm grow" data-act="broken-copy">复制原始数据</button><button class="btn sm grow" data-act="broken-ack">知道了，从现在开始重新记录</button></div></div>`+html;
  if(localFull)html=`<button class="card row storefull" data-act="gobackup" style="text-align:left;width:100%;gap:12px;margin-bottom:12px;background:var(--bad-soft)"><span class="seal" lang="ja" style="border-color:var(--bad);color:var(--bad)">満</span><div class="grow"><b style="color:var(--bad)">进度没能保存到本机</b><div class="small muted">本机存储空间满了（或浏览器禁止保存）。请到「视听」删掉不用的字幕，或先在「我的」保存存档文件。</div></div></button>`+html;
  const ae=W.document.activeElement;const focusId=ae&&ae.id&&/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)?ae.id:null;let sel=null;try{sel=ae&&ae.selectionStart}catch(e){}
  $("#view").innerHTML=html;
  const list=Object.values(TABS).sort((a,b)=>a.order-b.order);
  const nav=$("#tabs");nav.style.setProperty("--tabs",list.length);
  nav.innerHTML=list.map(t=>`<button class="${ui.tab===t.id?"on":""}" data-act="tab" data-k="${esc(t.id)}" aria-current="${ui.tab===t.id?"page":"false"}">${icon(t.icon)}${esc(t.label)}</button>`).join("");
  if(focusId){const el=W.document.getElementById(focusId);if(el){el.focus();try{if(sel!=null)el.setSelectionRange(sel,sel)}catch(e){}}}
  if(tab.mount)try{tab.mount($("#view"))}catch(e){console.error(e)}
  for(const f of AFTER)try{f(ui.tab)}catch(e){console.error(e)}
}
function go(tab,opts){
  if(!TABS[tab])tab="home";
  const t=TABS[tab],from=ui.tab;ui.tab=tab;try{W.localStorage.setItem(KEY+":tab",tab)}catch(e){}
  if(t.onShow)try{t.onShow(Object.assign({from},opts||{}))}catch(e){console.error(e)}
  render();if(!(opts&&opts.keepScroll))try{W.scrollTo(0,0)}catch(e){}
}

/* ============ 全屏覆盖层（学习会话、会话课、测试、跟读共用 #sess） ============ */
let OV={open:false,onKey:null,onClose:null,rerender:null};
function openOverlay(html,opts){
  const el=$("#sess");el.innerHTML=html;
  if(!OV.open){el.hidden=false;W.document.body.style.overflow="hidden";OV.open=true;OV.onKey=null;OV.onClose=null;OV.rerender=null}
  if(opts){OV.onKey=opts.onKey||null;OV.onClose=opts.onClose||null;OV.rerender=opts.rerender||null}
  el.scrollTop=0;return el;
}
function updateOverlay(html,opts){if(!OV.open)return openOverlay(html);const el=$("#sess");const top=el.scrollTop;el.innerHTML=html;el.scrollTop=opts&&opts.top?0:top;return el}
function closeOverlay(opts){
  if(!OV.open)return;const f=OV.onClose;OV={open:false,onKey:null,onClose:null,rerender:null};
  const el=$("#sess");el.hidden=true;el.innerHTML="";W.document.body.style.overflow="";stopSpeak();
  if(f)try{f()}catch(e){console.error(e)}
  if(!(opts&&opts.silent))render();
}
function onOverlayKey(fn){OV.onKey=typeof fn==="function"?fn:null}
const overlayOpen=()=>OV.open;
/* 页面 + 当前覆盖层一起重画（全局设置变化时用） */
function refresh(){render();if(OV.open&&OV.rerender)try{OV.rerender()}catch(e){console.error(e)}}
const overlayEl=()=>$("#sess");

/* ============ 主题（每台设备各自记住，不进存档） ============ */
function applyTheme(){if(!W.document)return;const t=store.get("theme","auto");const r=W.document.documentElement;if(t==="light"||t==="dark")r.setAttribute("data-theme",t);else r.removeAttribute("data-theme")}
function setTheme(t){store.set("theme",t);applyTheme()}

/* ============ 内置动作 ============ */
registerAction("tab",d=>{closeOverlay({silent:true});go(d.k)});
registerAction("say",d=>{speak(d.t,{kana:d.kana==="1"})});
registerAction("govoice",()=>{closeOverlay({silent:true});go("me");setTimeout(()=>{const el=W.document.getElementById("voiceset");if(el)el.scrollIntoView({block:"center"})},30)});
registerAction("furi",()=>{S.settings.furi=!furiOn();save();refresh();toast(S.settings.furi?"振假名：开":"振假名：关")});
registerAction("celeok",()=>{const c=$("#cele");c.hidden=true;c.innerHTML=""});
/* 存档损坏的提示：复制原始数据（剪贴板用不了就弹出文本框）/ 确认后开始重新记录 */
registerAction("broken-copy",()=>{
  const t=LOAD.raw||"";if(!t){toast("没有原始数据");return}
  const box=()=>{openOverlay(`<div class="sin stack" style="gap:12px"><div class="row"><b class="grow" style="font-size:18px">原始存档数据</b><button class="iconbtn" data-act="broken-close" aria-label="关闭">${IC.close}</button></div><div class="small muted">长按文本框 →「全选」→「复制」，发给开发者帮忙修复。共 ${t.length} 字。</div><textarea id="brokenbox" readonly wrap="off" style="min-height:42vh;font-size:12px"></textarea></div>`);const ta=W.document.getElementById("brokenbox");if(ta)ta.value=t};
  try{W.navigator.clipboard.writeText(t).then(()=>toast("原始数据已复制（"+t.length+" 字）"),box)}catch(e){box()}
});
registerAction("broken-close",()=>closeOverlay());
registerAction("broken-ack",()=>{LOAD.ack=true;save();render();toast("好的，从现在开始重新记录进度")});

/* ============ 启动 ============ */
function boot(){
  if(booted)return;booted=true;
  const D=W.document;
  applyTheme();rebuild();migrateOrphans();
  const call=(name,d,el,e)=>{const f=A[name];if(!f)return false;try{f(d,el,e)}catch(err){console.error("[yume] 动作出错",name,err)}return true};
  D.addEventListener("click",e=>{const el=e.target.closest&&e.target.closest("[data-act]");if(!el||el.disabled)return;if(!A[el.dataset.act])return;if(el.tagName!=="A")e.preventDefault();call(el.dataset.act,el.dataset,el,e)});
  D.addEventListener("submit",e=>{const f=e.target.closest&&e.target.closest("form[data-submit]");if(!f)return;e.preventDefault();call(f.dataset.submit,f.dataset,f,e)});
  /* 输入法（拼音 / 日文）组字过程中不触发：否则整页重画会打断组字；组字结束后再派发一次 */
  D.addEventListener("input",e=>{if(e.isComposing)return;const el=e.target.closest&&e.target.closest("[data-input]");if(el)call(el.dataset.input,el.dataset,el,e)});
  D.addEventListener("compositionend",e=>{const el=e.target.closest&&e.target.closest("[data-input]");if(el)call(el.dataset.input,el.dataset,el,e)});
  D.addEventListener("change",e=>{const el=e.target.closest&&e.target.closest("[data-change]");if(el)call(el.dataset.change,el.dataset,el,e)});
  D.addEventListener("keydown",e=>{
    const c=$("#cele");if(c&&!c.hidden){if(e.key==="Enter"||e.key==="Escape"){e.preventDefault();A.celeok()}return}
    if(!OV.open)return;
    if(OV.onKey){let h=false;try{h=OV.onKey(e)===true}catch(err){console.error(err)}if(h)return}
    if(e.key==="Escape"){
      /* 焦点在输入框里时，Esc 只让输入框失去焦点，不关掉整个页面（避免粘贴到一半的内容丢失） */
      const t=e.target;if(t&&/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName||"")){try{t.blur()}catch(err){}return}
      closeOverlay();
    }
  });
  let t=null;try{t=W.localStorage.getItem(KEY+":tab")}catch(e){}
  if(t==="words"){ui.tab="course";if(Y.course&&Y.course.showWordbook)Y.course.showWordbook()}
  else if(t&&TABS[t])ui.tab=t;
  render();
  initCloud(0);
  /* 防丢失：别的页面保存了 → 合并；切回来 → 检查；切到后台/关闭 → 补存当天快照 */
  const on=(t,ev,fn)=>{try{if(t&&typeof t.addEventListener==="function")t.addEventListener(ev,fn)}catch(e){}};
  on(W,"storage",onStorage);
  on(D,"visibilitychange",()=>{if(D.visibilityState==="visible")onShow();else snapNow()});
  on(W,"pagehide",snapNow);
  on(W,"pageshow",e=>{if(e&&e.persisted)onShow()});
  recoverOnBoot();
}

/* ============ 导出 ============ */
Object.assign(Y,{
  /* 工具 */ esc,today,dkey,shuffle,safeUrl,clone,DAY,IV,
  /* 振假名 */ ruby,plain,reading,furiOn,
  /* 存储 */ KEY,store,save,merge,mergeProgress,snapList,snapRestore,snapPut,loadInfo:()=>LOAD,parseBackup,backupInfo,undoLast,registerState,registerSetting,restore,resetProgress,stateSize,registerBackup,backupText,packCloud,unpackCloud,
  registerWordList,wordList,isWordList,importedCustom,
  syncState:()=>localFull?"full":sync,
  /* 发音 */ speak,stopSpeak,tts,pickVoice,voiceStatus,voiceHelp,
  /* 内容 */ BOOKS,LEVELS,addBook,addEasy,addTests,addQuotes,quotes:()=>QUOTES,rebuild,migrateOrphans,book,lesson,word,bookLessons,
  allLessons:()=>LESSONS,allWords:()=>WORDS,books:()=>BOOKS,easy:()=>EASY,tests:lv=>lv?(TESTS[lv]||[]):TESTS,
  /* 进度 */ wordState,isMastered,lessonProg,bookProg,levelStats,counts,dueWords,plan,freshPool,trackBook,newToday,markWord,
  streak,bestStreak,level,addXP,takeXP,xpOnce,xpRevoke,backupAgo,backupDue,newWords,backupDays,
  /* 徽章称号 */ BADGES,TITLES,registerBadge,checkBadges,checkTitles,curTitle,nextTitle,celebrate,
  /* 界面 */ IC,icon,toast,ring,lvDots,POS,posCls,posTag,speakCheckBtn,sayBtn,lvClass,
  ui,render,go,onRender,registerTab,registerAction,registerCard,cards,tabs:()=>TABS,actions:A,
  openOverlay,updateOverlay,closeOverlay,onOverlayKey,overlayOpen,overlayEl,refresh,
  setTheme,applyTheme,boot
});
Object.defineProperty(Y,"S",{get:()=>S,enumerable:true,configurable:true});
Object.defineProperty(Y,"lessonsById",{get:()=>LMAP,enumerable:true,configurable:true});
Object.defineProperty(Y,"wordsByKey",{get:()=>WMAP,enumerable:true,configurable:true});
Object.defineProperty(Y,"booted",{get:()=>booted,enumerable:true,configurable:true});
})();
