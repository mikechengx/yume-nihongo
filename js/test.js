/* Yume · 等级自测 + 学习分析 + 学习计划（js/test.js）
 * 入口：「我的」页大卡片（registerCard me）、首页小卡片（registerCard home：没测过时邀请自测，有计划时显示今天的计划）。
 * 自测：分级递进 N5→N1，每级抽 12 题（词汇/语法各 3–4、阅读 2–3、听力 2–3），正确率 ≥70% 才进入下一级。
 *       结果只存分数：S.tests=[{date,level,start,scores:{N5:{v:[对,题],g,r,l},…}}]（最多 30 条）。
 * 分析：自测四项雷达图、各级通过柱状图、历次对比；学习数据（近 30 天 XP、各册单词、各级语法与练习、五十音）+ 优势/短板结论。
 * 计划：目标等级 +（可选）考试日期 → 每天新词/语法、每周课、侧重比例；存 S.plan，首页按当天真实数据打勾。
 * 图表全部是纯 SVG / CSS，按覆盖层实际宽度出图（文字是真实像素，不缩放）；颜色只用 :root token；样式在本模块内注入。
 */
(function(){
"use strict";
const W=typeof window!=="undefined"?window:globalThis;
const Y=W.Yume;if(!Y)return;
const {esc,IC,ruby,plain,shuffle,today,dkey,lvClass}=Y;
const LV=Y.LEVELS;
const DAY=Y.DAY||864e5;
const SEC=[
  {k:"vocab",s:"v",n:"文字词汇",sh:"词汇",c:"--tc1"},
  {k:"grammar",s:"g",n:"语法",sh:"语法",c:"--tc2"},
  {k:"reading",s:"r",n:"阅读",sh:"阅读",c:"--tc3"},
  {k:"listening",s:"l",n:"听力",sh:"听力",c:"--tc4"}];
const SECK={};for(const x of SEC)SECK[x.k]=x;
const SECS={};for(const x of SEC)SECS[x.s]=x;
const FOCUS_N={v:"单词",g:"文法",r:"阅读",l:"听力"};
const PASS=.7,PER=12,MIN_POOL=4,HIST_MAX=30,NPD=[5,10,15,20,30];

/* ============ 状态 ============ */
Y.registerState("tests",[]);
Y.registerState("plan",null);
/* 记录和计划可能来自「恢复存档 / 粘贴存档文字」，字段会拼进页面：只认白名单里的等级、日期格式和数字 */
const DATE_RE=/^\d{4}-\d\d-\d\d$/;
const isObj=o=>!!o&&typeof o==="object"&&!Array.isArray(o);
const validRec=r=>isObj(r)&&isObj(r.scores)&&LV.includes(r.start)&&(!r.level||LV.includes(r.level))&&DATE_RE.test(String(r.date||""));
const int0=x=>{x=Math.round(+x);return isFinite(x)&&x>0?x:0};
function normRec(r){
  const scores={};
  for(const lv of LV){const sc=r.scores[lv];if(!isObj(sc))continue;const o={};
    for(const k of ["v","g","r","l"]){const a=sc[k];if(Array.isArray(a)){const n=int0(a[1]);o[k]=[Math.min(n,int0(a[0])),n]}}
    scores[lv]=o}
  return{date:r.date,level:r.level||"",start:r.start,scores};
}
function hist(){const S=Y.S;if(!Array.isArray(S.tests))S.tests=[];return S.tests}
const recs=()=>hist().filter(validRec).map(normRec);
const latest=()=>{const h=recs();return h.length?h[h.length-1]:null};
function getPlan(){
  const p=Y.S.plan;
  if(!isObj(p)||!LV.includes(p.target)||!Array.isArray(p.books))return null;
  const n=(x,a,b)=>Math.max(a,Math.min(b,Math.round(+x)||a));
  p.npd=n(p.npd,1,100);p.gpd=n(p.gpd,1,20);p.lpw=n(p.lpw,1,60);p.mins=n(p.mins,5,600);p.days=n(p.days,1,3650);
  const f=isObj(p.focus)?p.focus:{};p.focus={v:n(f.v,0,100),g:n(f.g,0,100),r:n(f.r,0,100),l:n(f.l,0,100)};
  if(!DATE_RE.test(String(p.created||"")))p.created=today();
  if(p.exam&&!DATE_RE.test(String(p.exam)))p.exam="";
  p.books=p.books.filter(id=>typeof id==="string"&&!!Y.book(id));
  if(!Y.book(p.book))p.book=p.books[0]||"b1";
  p.startId=typeof p.startId==="string"?p.startId:"";
  p.from=LV.includes(p.from)?p.from:"";
  if(!isObj(p.hit))p.hit={};else for(const k of Object.keys(p.hit))if(!DATE_RE.test(k))delete p.hit[k];
  if(typeof p.ext!=="string"||(p.ext&&!DATE_RE.test(p.ext)))p.ext="";
  return p;
}

/* ============ 小工具 ============ */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const pct=x=>Math.round((x||0)*100);
const parseD=s=>{const m=/^(\d{4})-(\d\d)-(\d\d)$/.exec(String(s||""));return m?new Date(+m[1],+m[2]-1,+m[3],12):null};
const daysBetween=(a,b)=>{const x=parseD(a),y=parseD(b);return x&&y?Math.round((y-x)/DAY):0};
const md=s=>{const d=parseD(s);return d?(d.getMonth()+1)+"/"+d.getDate():""};
const cnDate=(s,noYear)=>{const d=parseD(s);return d?(noYear?"":d.getFullYear()+"年")+(d.getMonth()+1)+"月"+d.getDate()+"日":""};
const addDays=(s,n)=>{const d=parseD(s);d.setDate(d.getDate()+n);return dkey(d)};
const WD="日一二三四五六";
const lvVar=lv=>`var(--${lvClass(lv)})`;
const tw=(s,fs)=>{let w=0;for(const ch of String(s))w+=ch.charCodeAt(0)>255?fs*1.1:fs*.62;return w};
const fmtN=n=>n>=1e4?(n/1e3).toFixed(0)+"k":n>=1e3?(n/1e3).toFixed(1).replace(/\.0$/,"")+"k":String(Math.round(n));
function niceMax(v){if(!(v>0))return 10;const p=Math.pow(10,Math.floor(Math.log10(v)));for(const m of [1,1.2,1.5,2,2.5,3,4,5,6,8,10])if(m*p>=v-1e-9)return m*p;return 10*p}
const isTyping=e=>{const t=e.target;return !!t&&/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName||"")};

/* 分数：sc = {v:[对,题],g,r,l} */
function cn(sc){let c=0,n=0;for(const x of SEC){const a=sc&&sc[x.s];if(Array.isArray(a)){c+=+a[0]||0;n+=+a[1]||0}}return [c,n]}
const lvAcc=sc=>{const [c,n]=cn(sc);return n?c/n:0};
/* 能力值（0–5，单位“等级”）：起点以下的等级按通过计 1，之后每一级加上该部分的正确率。s 省略时用整体正确率 */
function recEq(rec,s){
  if(!rec)return 0;let e=Math.max(0,LV.indexOf(rec.start));
  for(const lv of LV){const sc=rec.scores[lv];if(!sc)continue;
    if(s){const a=sc[s];e+=Array.isArray(a)&&a[1]>0?a[0]/a[1]:lvAcc(sc)}else e+=lvAcc(sc)}
  return Math.min(5,e);
}
/* 能力值 → 等级说法：某一级里答对 ≥70% 就算到了这一级 */
function eqLabel(e){const k=Math.floor(e+.3+1e-9);return k<=0?"入门":LV[Math.min(5,k)-1]}
const eqText=e=>{const l=eqLabel(e);return l==="入门"?"入门":"约 "+l};
/* 结果对应的等级：通过的最高一级；起点那一级就没过时按起点下面一级算（和 curIdx 一致）；从 N5 开始没过才是入门 */
function recLv(r){if(!r)return "";if(r.level)return r.level;const si=LV.indexOf(r.start);return si>0?LV[si-1]:""}
function recLevelText(r){if(!r)return "";if(r.level)return "约 "+r.level+" 水平";const lv=recLv(r);return lv?`约 ${lv} 水平（${r.start} 未通过）`:"入门阶段"}
/* 等级大方块：约 N2 / 阶段 入门 */
function lvTile(r,style){const lv=recLv(r);return `<span class="tt-lvbig ${lv?lvClass(lv):""}"${style?` style="${style}"`:""}>${style?"":`<small>${lv?"约":"阶段"}</small>`}${lv||"入门"}</span>`}
/* 当前等级序号（-1 表示还没到 N5） */
function estIdx(){const ls=Y.levelStats();let k=-1;for(let i=0;i<LV.length;i++){const o=ls[LV[i]];if(o&&o.lessons&&o.prog>=.8)k=i;else break}return k}
function curIdx(){const t=latest();if(t)return t.level?LV.indexOf(t.level):LV.indexOf(t.start)-1;return estIdx()}

/* ============ 题库 ============ */
const validItem=x=>!!x&&!!SECK[x.sec]&&Array.isArray(x.opts)&&x.opts.length>=2&&new Set(x.opts.map(String)).size===x.opts.length&&!!(x.q||x.audio);
const pool=lv=>(Y.tests(lv)||[]).filter(validItem);
const avail=lv=>pool(lv).length>=MIN_POOL;
const anyAvail=()=>LV.some(avail);
function buildLevel(lv){
  const P=pool(lv);const by={};for(const x of SEC)by[x.k]=[];for(const x of P)by[x.sec].push(x);
  /* 阅读：同一段材料的题放在一起，抽一段（2–3 题） */
  const groups=new Map();for(const x of by.reading){const k=String(x.passage||"");if(!groups.has(k))groups.set(k,[]);groups.get(k).push(x)}
  const gs=shuffle([...groups.values()]);
  let R=gs.length?gs[0].slice(0,3):[];
  if(R.length<2&&gs.length>1)R=R.concat(gs[1]).slice(0,3);
  const Lis=shuffle(by.listening).slice(0,R.length>=3?2:3);
  const rest=PER-R.length-Lis.length;
  const vv=shuffle(by.vocab),gg=shuffle(by.grammar);
  let nv=Math.min(vv.length,Math.random()<.5?Math.ceil(rest/2):Math.floor(rest/2));
  const ng=Math.min(gg.length,rest-nv);nv=Math.min(vv.length,rest-ng);
  let items=[...vv.slice(0,nv),...gg.slice(0,ng),...R,...Lis];
  if(items.length<PER){const used=new Set(items);for(const x of shuffle(P)){if(items.length>=PER)break;if(!used.has(x)){used.add(x);items.push(x)}}
    const ord=x=>SEC.findIndex(s=>s.k===x.sec);items=items.map((x,i)=>[x,i]).sort((a,b)=>ord(a[0])-ord(b[0])||a[1]-b[1]).map(a=>a[0])}
  return items.map(x=>{const right=String(x.opts[0]);const opts=shuffle(x.opts.map(String));
    return{sec:x.sec,q:String(x.q||""),passage:String(x.passage||""),audio:String(x.audio||""),opts,ans:opts.indexOf(right),right,zh:String(x.zh||"")}});
}

/* ============ 覆盖层页面状态 ============ */
const V={page:"hub",tab:"test",slv:"N5",fresh:null,pd:null,delArm:false,quitAt:0};
let T=null;          /* 正在进行的测试 */
let mine=false;      /* 覆盖层是不是本模块打开的 */

/* ============ 样式（注入一次） ============ */
const CSS=`
:root{--tc1:#2A4A9A;--tc2:#E07B1F;--tc3:#1BAF7A;--tc4:#7A4BC4}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--tc1:#4F74E0;--tc2:#D96A1E;--tc3:#199E70;--tc4:#9A78E6}}
:root[data-theme="dark"]{--tc1:#4F74E0;--tc2:#D96A1E;--tc3:#199E70;--tc4:#9A78E6}
.s-v{--c:var(--tc1)}.s-g{--c:var(--tc2)}.s-r{--c:var(--tc3)}.s-l{--c:var(--tc4)}
.tt-sec{display:inline-flex;align-items:center;gap:6px;font-weight:700;color:var(--ink);white-space:nowrap}
.tt-sec::before{content:"";width:10px;height:10px;border-radius:3px;background:var(--c,var(--ai));flex:none}
.tt-head{align-items:flex-start}
.tt-ico{width:44px;height:44px;border-radius:14px;background:var(--ai-soft);color:var(--ai);display:inline-flex;align-items:center;justify-content:center;flex:none}
.tt-ico .icon{width:24px;height:24px}
.tt-chips{display:flex;flex-wrap:wrap;gap:8px}
.tt-chip{padding:7px 14px;border-radius:999px;background:var(--sunk);font-size:14px;font-weight:700;white-space:nowrap;color:var(--ink)}
.tt-chip.on{background:var(--ai);color:var(--on-ai)}
.tt-chip[disabled]{opacity:.45;cursor:default;font-weight:500}
.tt-chip small{font-weight:500;opacity:.8}
.tt-warn{padding:8px 12px;border-radius:10px;background:var(--gold-soft);color:var(--ink);line-height:1.6}
.tt-ul{margin:0;padding-left:1.2em;color:var(--muted);line-height:1.8}
.tt-meta{justify-content:space-between;gap:8px;flex-wrap:wrap}
.tt-q{font-family:var(--f-jp);font-size:clamp(18px,5.2vw,22px);font-weight:700;line-height:2.05;overflow-wrap:anywhere}
.tt-q .blank{min-width:2.4em;text-align:center}
.tt-passage{font-family:var(--f-jp);font-size:16px;line-height:2.05;white-space:pre-wrap;overflow-wrap:anywhere}
.tt-listen{display:flex;align-items:center;gap:16px}
.tt-listen .listen{width:72px;height:72px;flex:none}
.tt-listen .listen .icon{width:32px;height:32px}
.tt-listen .listen.on{box-shadow:0 0 0 6px var(--ai-soft)}
.opts.tt-1col{grid-template-columns:1fr}
.opts.tt-1col .opt{justify-content:flex-start;text-align:left;padding:12px 14px 12px 32px;min-height:54px;font-size:16px;line-height:1.9}
.opts.tt-1col .opt .n{top:50%;transform:translateY(-50%);left:12px}
.tt-script{font-family:var(--f-jp);line-height:1.9;padding:10px 12px;border-radius:12px;background:var(--sunk);overflow-wrap:anywhere;white-space:pre-wrap}
.tt-lvbig{width:72px;height:72px;border-radius:20px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-weight:900;font-size:24px;line-height:1;flex:none;background:var(--sunk);color:var(--muted);font-family:var(--f-ui)}
.tt-lvbig small{font-size:11px;font-weight:500;margin-bottom:4px}
.tt-lvbig.n5{background:var(--n5-soft);color:var(--n5)}.tt-lvbig.n4{background:var(--n4-soft);color:var(--n4)}.tt-lvbig.n3{background:var(--n3-soft);color:var(--n3)}.tt-lvbig.n2{background:var(--n2-soft);color:var(--n2)}.tt-lvbig.n1{background:var(--n1-soft);color:var(--n1)}
.tt-hero{display:flex;gap:16px;align-items:center}
.tt-hero h2{font-size:24px}
.tt-fresh{background:var(--gold-soft)}
.tc{display:block;max-width:100%;height:auto;overflow:visible;margin-inline:auto;-webkit-user-select:none;user-select:none}
.tc text{font-family:var(--f-ui);font-size:11px;fill:var(--muted)}
.tc .t-ink{fill:var(--ink);font-weight:700;font-size:12px}
.tc .t-sm{font-size:10px}
.tc .t-faint{fill:var(--faint)}
.tc .halo{paint-order:stroke;stroke:var(--surface);stroke-width:3px;stroke-linejoin:round}
.tc .gl{stroke:var(--line);stroke-width:1;fill:none}
.tc .gl2{stroke:var(--muted);stroke-width:1;fill:none}
.tc .goal{stroke:var(--gold);stroke-width:1.5;fill:none}
.tc .trk{fill:var(--sunk)}
.tc .hit{fill:transparent;cursor:pointer;outline:none}
.tc [data-tt]{outline:none}
.tc g[data-tt]:hover .bar,.tc g[data-tt]:focus .bar{opacity:.75}
.tc [data-tt]:focus-visible .hit{stroke:var(--ai);stroke-width:2}
.tc .r-cur{fill:var(--ai);fill-opacity:.13;stroke:var(--ai);stroke-width:2;stroke-linejoin:round}
.tc .r-prev{fill:none;stroke:var(--faint);stroke-width:1.5;stroke-linejoin:round}
.tc .d-cur{fill:var(--ai);stroke:var(--surface);stroke-width:2}
.tc .d-prev{fill:var(--faint);stroke:var(--surface);stroke-width:2}
.tc .ln{fill:none;stroke:var(--ai);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.tt-legend{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12px;color:var(--muted)}
.tt-legend>span{display:inline-flex;align-items:center;gap:6px}
.tt-key{width:16px;height:3px;border-radius:2px;background:var(--c,var(--ai));flex:none}
.tt-sw{width:12px;height:12px;border-radius:3px;background:var(--c,var(--ai));flex:none}
.ttip{position:fixed;z-index:60;background:var(--ink);color:var(--bg);font-size:12px;line-height:1.5;padding:6px 10px;border-radius:8px;pointer-events:none;max-width:240px;box-shadow:var(--shadow)}
.tt-table{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
.tt-table th{font-size:12px;color:var(--muted);font-weight:500}
.tt-table th,.tt-table td{padding:7px 4px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}
.tt-table th:first-child,.tt-table td:first-child{text-align:left}
.tt-table tr:last-child td{border-bottom:0}
.tt-table .pass{color:var(--good);font-weight:700}
.tt-table .fail{color:var(--muted)}
.tt-scroll{overflow-x:auto}
.tt-meter{height:8px;border-radius:99px;background:var(--sunk);overflow:hidden}
.tt-meter>i{display:block;height:100%;border-radius:99px;background:var(--c,var(--ai));min-width:0}
.tt-mx{display:grid;grid-template-columns:40px repeat(3,minmax(0,1fr));gap:12px 12px;align-items:center}
.tt-mx .h{font-size:12px;color:var(--muted)}
.tt-mx .v{font-size:12px;color:var(--muted);margin-top:4px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tt-mx .v b{color:var(--ink)}
.tt-mx .off{grid-column:2/-1;font-size:12px;color:var(--faint)}
.tt-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
@media (min-width:520px){.tt-tiles{grid-template-columns:repeat(4,minmax(0,1fr))}}
.tt-tiles .stat b{font-family:var(--f-ui);font-weight:700}
.tt-sec-rows{display:flex;flex-direction:column;gap:10px;width:100%}
.tt-sec-row{display:grid;grid-template-columns:76px 1fr 44px;gap:10px;align-items:center;font-size:13px;text-align:left}
.tt-sec-row .num{text-align:right;color:var(--muted)}
.tt-concl{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}
.tt-concl li{display:flex;gap:10px;align-items:flex-start;line-height:1.65;font-size:14px}
.tt-concl .mk{width:22px;height:22px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;flex:none;font-size:12px;font-weight:900;margin-top:1px}
.tt-concl.good .mk{background:var(--good-soft);color:var(--good)}
.tt-concl.bad .mk{background:var(--bad-soft);color:var(--bad)}
.tt-stack{display:flex;gap:2px;height:14px;border-radius:99px;overflow:hidden;background:var(--surface)}
.tt-stack>i{display:block;height:100%;background:var(--c);min-width:2px}
.tt-frow{display:grid;grid-template-columns:auto 1fr auto;gap:4px 10px;align-items:start;padding:8px 0;border-bottom:1px solid var(--line);font-size:13px}
.tt-frow:last-child{border-bottom:0}
.tt-frow .tt-sw{margin-top:4px}
.tt-frow b{font-size:14px}
.tt-frow .num{font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
.tt-frow .d{grid-column:2/-1;color:var(--muted);line-height:1.6}
.tt-ptiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
@media (min-width:520px){.tt-ptiles{grid-template-columns:repeat(4,minmax(0,1fr))}}
.tt-ptiles>div{background:var(--sunk);border-radius:12px;padding:10px 12px}
.tt-ptiles b{display:block;font-size:22px;line-height:1.2}
.tt-ptiles span{font-size:12px;color:var(--muted)}
.tt-week{border-radius:12px;background:var(--sunk);padding:10px 12px;display:flex;flex-direction:column;gap:6px}
.tt-week.now{background:var(--ai-soft)}
.tt-week .wh{display:flex;justify-content:space-between;gap:8px;font-size:13px;font-weight:700;flex-wrap:wrap}
.tt-week .wh span{font-weight:500;color:var(--muted)}
.tt-lrow{display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:6px 8px;border-radius:9px;background:var(--surface);font-size:13px;min-height:36px}
.tt-lrow[disabled]{opacity:.6;cursor:default}
.tt-lrow .grow{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tt-lrow .icon{width:16px;height:16px}
.tt-lrow .ok{color:var(--good)}
.tt-check{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}
.tt-check li{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--line);font-size:14px}
.tt-check li:last-child{border-bottom:0}
.tt-check .ck{width:24px;height:24px;border-radius:50%;border:2px solid var(--line);display:inline-flex;align-items:center;justify-content:center;flex:none;color:transparent}
.tt-check .ck .icon{width:14px;height:14px}
.tt-check li.on .ck{background:var(--good);border-color:var(--good);color:var(--surface)}
.tt-check li.on .t{color:var(--muted);text-decoration:line-through;text-decoration-color:var(--faint)}
.tt-check .c{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.tt-check .btn.sm{padding:5px 10px;font-size:12px}
.tt-acts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.tt-acts .btn{padding:10px 6px;flex-direction:column;gap:4px;font-size:13px}
.tt-acts .btn .icon{width:20px;height:20px}
input.tt-date{font:inherit;color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:9px 12px;width:100%;min-height:42px;color-scheme:inherit}
.tt-why{font-size:12px;color:var(--muted);line-height:1.7}
`;
let cssOn=false;
function ensureCss(){
  if(cssOn)return;let d=null;try{d=W.document}catch(e){}
  if(!d||!d.head||!d.createElement||!d.body)return;   /* node 冒烟测试的假 DOM 里没有 head：不注入、不挂监听 */
  cssOn=true;
  try{const st=d.createElement("style");st.id="test-css";st.textContent=CSS;d.head.appendChild(st)}catch(e){}
  initTip(d);
}

/* ============ 图表提示（悬停 / 点按 / 键盘焦点） ============ */
let tipEl=null,tipCur=null,tipT=null,lastW=0,rzT=null;
function hideTip(){tipCur=null;if(tipEl)tipEl.hidden=true}
function showTip(el){
  const t=el.getAttribute("data-tt");if(!t||!tipEl)return;tipCur=el;tipEl.textContent=t;tipEl.hidden=false;
  const r=el.getBoundingClientRect(),d=W.document;const vw=d.documentElement.clientWidth||W.innerWidth||375;
  const w=tipEl.offsetWidth,h=tipEl.offsetHeight;let x=r.left+r.width/2-w/2;x=clamp(x,8,Math.max(8,vw-w-8));
  let y=r.top-h-8;if(y<8)y=r.bottom+8;tipEl.style.left=x+"px";tipEl.style.top=y+"px";
}
function initTip(d){
  try{
    tipEl=d.createElement("div");tipEl.className="ttip";tipEl.hidden=true;tipEl.setAttribute("aria-hidden","true");d.body.appendChild(tipEl);
    const find=e=>e.target&&e.target.closest?e.target.closest("[data-tt]"):null;
    d.addEventListener("pointerover",e=>{if(e.pointerType==="touch")return;const el=find(e);if(el)showTip(el)});
    d.addEventListener("pointerout",e=>{const el=find(e);if(el&&el===tipCur&&!(e.relatedTarget&&el.contains(e.relatedTarget)))hideTip()});
    d.addEventListener("pointerdown",e=>{const el=find(e);clearTimeout(tipT);if(el){showTip(el);tipT=setTimeout(hideTip,2800)}else hideTip()});
    d.addEventListener("focusin",e=>{const el=find(e);if(el)showTip(el)});
    d.addEventListener("focusout",()=>hideTip());
    W.addEventListener("scroll",()=>{if(tipCur)hideTip()},{capture:true,passive:true});
    W.addEventListener("resize",()=>{clearTimeout(rzT);rzT=setTimeout(()=>{hideTip();if(ours()&&contentW()!==lastW)draw(false)},180)});
  }catch(e){console.warn("[yume] 图表提示初始化失败",e)}
}

/* ============ 尺寸：按覆盖层实际宽度出图 ============ */
function contentW(){
  let w=0;try{const el=Y.overlayEl();w=(el&&el.clientWidth)||0;if(!w)w=W.document.documentElement.clientWidth||W.innerWidth||0}catch(e){}
  if(!w)w=375;return Math.min(560,w)-32;
}
const cardW=()=>Math.max(240,contentW()-36);
const svgOpen=(w,h,label)=>`<svg class="tc" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">`;
/* 圆角只在数据端：柱子朝上，条形朝右；基线一端是直角 */
function vbar(x,base,w,h){if(h<=0)return "";const r=Math.min(4,w/2,h);return `M${x} ${base}V${base-h+r}A${r} ${r} 0 0 1 ${x+r} ${base-h}H${x+w-r}A${r} ${r} 0 0 1 ${x+w} ${base-h+r}V${base}Z`}
function hbar(x,y,w,h){if(w<=0)return "";const r=Math.min(4,h/2,w);return `M${x} ${y}H${x+w-r}A${r} ${r} 0 0 1 ${x+w} ${y+r}V${y+h-r}A${r} ${r} 0 0 1 ${x+w-r} ${y+h}H${x}Z`}
const f1=n=>Math.round(n*10)/10;

/* ---------- 图 1：四项能力雷达图 ---------- */
/* 外圈 = 最高到哪一级：比两次结果的最大值多一级（至少到 N3，最多 N1），每一圈是一个等级 */
const radarMax=vals=>clamp(Math.ceil(Math.max(0,...vals)+.3)+1,3,5);
function radarSVG(cur,prev,w){
  const labW=58,R=clamp((w-2*labW)/2-6,60,96),top=48,H=Math.round(R*2+top*2),cx=f1(w/2),cy=H/2;
  const M=radarMax(cur.concat(prev||[]));
  const ang=[-90,0,90,180].map(a=>a*Math.PI/180);
  const pt=(i,v)=>[f1(cx+Math.cos(ang[i])*R*v/M),f1(cy+Math.sin(ang[i])*R*v/M)];
  const poly=vals=>vals.map((v,i)=>pt(i,clamp(v,0,M)).join(",")).join(" ");
  let s=svgOpen(w,H,"四项能力雷达图");
  for(let k=1;k<=M;k++)s+=`<polygon class="gl" points="${poly([k,k,k,k])}"/>`;
  for(let i=0;i<4;i++){const [x,y]=pt(i,M);s+=`<line class="gl" x1="${cx}" y1="${cy}" x2="${x}" y2="${y}"/>`}
  if(prev){s+=`<polygon class="r-prev" points="${poly(prev)}"/>`;prev.forEach((v,i)=>{const [x,y]=pt(i,clamp(v,0,M));s+=`<circle class="d-prev" cx="${x}" cy="${y}" r="3.5"/>`})}
  s+=`<polygon class="r-cur" points="${poly(cur)}"/>`;
  /* 同心环标尺：写在上方轴线左侧，第 k 圈 = 达到第 k 级（带底色描边，压在线上也看得清） */
  for(let k=1;k<=M;k++)s+=`<text class="t-sm t-faint halo" x="${f1(cx-6)}" y="${f1(cy-R*k/M+3.5)}" text-anchor="end">${LV[k-1]}</text>`;
  cur.forEach((v,i)=>{const [x,y]=pt(i,clamp(v,0,M));const tip=`${SEC[i].n}：${eqText(v)}（能力值 ${v.toFixed(1)} / 5）${prev?` · 上次 ${eqText(prev[i])}`:""}`;
    s+=`<g data-tt="${esc(tip)}" tabindex="0" role="img" aria-label="${esc(tip)}"><circle class="hit" cx="${x}" cy="${y}" r="16"/><circle class="d-cur" cx="${x}" cy="${y}" r="4.5"/></g>`});
  /* 轴标签：名称 + 估计等级（文字只用文本色） */
  const lab=(i,x,y,anchor)=>`<text class="t-ink" x="${x}" y="${y}" text-anchor="${anchor}">${esc(SEC[i].n)}</text><text x="${x}" y="${y+15}" text-anchor="${anchor}">${esc(eqText(cur[i]))}</text>`;
  s+=lab(0,cx,cy-R-31,"middle")+lab(2,cx,cy+R+18,"middle")+lab(1,f1(cx+R+8),cy-4,"start")+lab(3,f1(cx-R-8),cy-4,"end");
  return s+`</svg>`;
}
function miniRadar(rec,size){
  const cur=SEC.map(x=>recEq(rec,x.s));const R=size/2-16,c=size/2,M=radarMax(cur);
  const ang=[-90,0,90,180].map(a=>a*Math.PI/180);
  const pt=(i,v)=>[f1(c+Math.cos(ang[i])*R*v/M),f1(c+Math.sin(ang[i])*R*v/M)];
  const poly=vals=>vals.map((v,i)=>pt(i,clamp(v,0,M)).join(",")).join(" ");
  let s=`<svg class="tc" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="四项能力：${esc(SEC.map((x,i)=>x.sh+eqText(cur[i])).join("，"))}" style="margin:0">`;
  for(let k=1;k<=M;k++)s+=`<polygon class="gl" points="${poly([k,k,k,k])}"/>`;
  s+=`<polygon class="r-cur" points="${poly(cur)}"/>`;
  const L=["词","法","读","听"],P=[[c,12],[size-2,c+4],[c,size-4],[2,c+4]],A=["middle","end","middle","start"];
  L.forEach((t,i)=>{s+=`<text class="t-sm" x="${P[i][0]}" y="${P[i][1]}" text-anchor="${A[i]}">${t}</text>`});
  return s+`</svg>`;
}

/* ---------- 图 2：各级通过情况（柱 = 该级正确率，横线 = 70% 通过线） ---------- */
function levelSVG(rec,w){
  const axW=36,top=22,ph=128,bot=42,H=top+ph+bot,pw=w-axW-4,band=pw/5,bw=Math.min(24,band*.5);
  const y=v=>f1(top+ph*(1-v)),st=LV.indexOf(rec.start);
  let s=svgOpen(w,H,"各级通过情况");
  for(const [v,cls,lab] of [[0,"gl","0%"],[PASS,"gl2","70%"],[1,"gl","100%"]]){s+=`<line class="${cls}" x1="${axW}" x2="${w}" y1="${y(v)}" y2="${y(v)}"/><text class="${v===PASS?"t-ink t-sm":"t-sm t-faint"}" x="${axW-6}" y="${y(v)+3.5}" text-anchor="end">${lab}</text>`}
  LV.forEach((lv,i)=>{
    const cx=f1(axW+band*i+band/2),sc=rec.scores[lv];let tip,status,bar="";
    if(i<st){status="免测";tip=`${lv}：起点以下，按通过计算`}
    else if(sc){const [c,n]=cn(sc),a=n?c/n:0,ok=a>=PASS;status=ok?"通过":"未通过";tip=`${lv}：答对 ${c}/${n}（${pct(a)}%）· ${status}`;
      bar=`<path class="bar" d="${vbar(f1(cx-bw/2),y(0),bw,f1(ph*a))}" style="fill:${ok?lvVar(lv):"var(--faint)"}"/><text class="t-ink" x="${cx}" y="${f1(y(a)-6)}" text-anchor="middle">${pct(a)}%</text>`}
    else{status="未测";tip=`${lv}：没有测到这一级`}
    s+=`<g data-tt="${esc(tip)}" tabindex="0" role="img" aria-label="${esc(tip)}"><rect class="hit" x="${f1(axW+band*i+1)}" y="${top-14}" width="${f1(band-2)}" height="${ph+14+bot-4}" rx="8"/>${bar}</g>`;
    s+=`<text class="t-ink" x="${cx}" y="${top+ph+17}" text-anchor="middle">${lv}</text><text class="t-sm" x="${cx}" y="${top+ph+32}" text-anchor="middle">${status}</text>`;
  });
  return s+`</svg>`;
}

/* ---------- 图 3：历次自测（整体能力值） ---------- */
function histSVG(list,w){
  const axW=34,top=20,ph=110,bot=26,H=top+ph+bot,n=list.length,x0=axW+14,x1=w-18;
  const xs=list.map((_,i)=>f1(n===1?(x0+x1)/2:x0+(x1-x0)*i/(n-1))),y=v=>f1(top+ph*(1-v/5));
  let s=svgOpen(w,H,"历次自测对比");
  for(let k=0;k<=5;k++)s+=`<line class="gl" x1="${axW}" x2="${w}" y1="${y(k)}" y2="${y(k)}"/>${k?`<text class="t-sm t-faint" x="${axW-6}" y="${y(k)+3.5}" text-anchor="end">${LV[k-1]}</text>`:""}`;
  const vals=list.map(r=>recEq(r));
  if(n>1)s+=`<polyline class="ln" points="${vals.map((v,i)=>xs[i]+","+y(v)).join(" ")}"/>`;
  const gap=n>1?(x1-x0)/(n-1):999;
  list.forEach((r,i)=>{const tip=`${cnDate(r.date,true)}：${recLevelText(r)}（能力值 ${vals[i].toFixed(1)}）`;
    s+=`<g data-tt="${esc(tip)}"><rect class="hit" x="${f1(xs[i]-Math.min(gap,40)/2)}" y="${top-10}" width="${f1(Math.min(gap,40))}" height="${ph+20}"/><circle class="d-cur" cx="${xs[i]}" cy="${y(vals[i])}" r="4.5"/></g>`;
    if(gap>=44||i===0||i===n-1)s+=`<text class="t-sm" x="${xs[i]}" y="${top+ph+18}" text-anchor="middle">${md(r.date)}</text>`});
  const li=n-1;s+=`<text class="t-ink" x="${xs[li]}" y="${f1(y(vals[li])-10)}" text-anchor="${n>1?"end":"middle"}">${esc(eqText(vals[li]))}</text>`;
  return s+`</svg>`;
}

/* ---------- 图 4：近 30 天 XP ---------- */
function last30(){const S=Y.S;const out=[];const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()-29);
  for(let i=0;i<30;i++){const k=dkey(d);out.push({k,v:Math.max(0,+S.days[k]||0),wd:d.getDay()});d.setDate(d.getDate()+1)}return out}
function xpSVG(days,goal,w){
  const axW=32,top=12,ph=112,bot=22,H=top+ph+bot,pw=w-axW-2,band=pw/days.length,bw=Math.max(2,Math.min(24,band-2));
  const max=niceMax(Math.max(goal,...days.map(d=>d.v))),y=v=>f1(top+ph*(1-v/max));
  let s=svgOpen(w,H,"近 30 天每日 XP");
  const gy=y(goal);
  for(const v of [0,max/2,max]){s+=`<line class="gl" x1="${axW}" x2="${w}" y1="${y(v)}" y2="${y(v)}"/>`;if(v===0||Math.abs(y(v)-gy)>=13)s+=`<text class="t-sm t-faint" x="${axW-5}" y="${y(v)+3.5}" text-anchor="end">${fmtN(v)}</text>`}
  days.forEach((d,i)=>{const x=axW+band*i,isT=i===days.length-1;const tip=`${md(d.k)} 周${WD[d.wd]}：${d.v} XP${d.v>=goal?" · 达标":""}`;
    s+=`<g data-tt="${esc(tip)}"><rect class="hit" x="${f1(x)}" y="${top}" width="${f1(band)}" height="${ph}"/><path class="bar" d="${vbar(f1(x+(band-bw)/2),y(0),f1(bw),f1(ph*d.v/max))}" style="fill:${isT?"var(--gold)":"var(--ai)"}"/></g>`});
  s+=`<line class="goal" x1="${axW}" x2="${w}" y1="${gy}" y2="${gy}"/>`;
  if(Math.abs(y(0)-gy)>=13)s+=`<text class="t-sm t-ink" x="${axW-5}" y="${gy+3.5}" text-anchor="end">${fmtN(goal)}</text>`;
  for(const i of [0,7,14,21,days.length-1]){const lab=i===days.length-1?"今天":md(days[i].k);const lw=tw(lab,10);let x=axW+band*i+band/2;x=clamp(x,axW+lw/2,w-lw/2-1);
    s+=`<text class="t-sm" x="${f1(x)}" y="${top+ph+15}" text-anchor="middle">${lab}</text>`}
  return s+`</svg>`;
}

/* ---------- 图 5：各册单词（浅 = 已学，深 = 熟记，底槽 = 全部） ---------- */
function bookWords(){return Y.BOOKS.map(b=>{let total=0,learned=0,mastered=0;const ls=Y.bookLessons(b.id);
  for(const l of ls)for(const w of Y.newWords(l)){total++;const s=Y.wordState(w);if(s){learned++;if(s.lv>=5)mastered++}}
  return{b,total,learned,mastered,n:ls.length}})}
function bookSVG(rows,w){
  const rowH=46,H=rows.length*rowH,bh=10;let s=svgOpen(w,H,"各册单词学习量与熟记量");
  rows.forEach((r,i)=>{const y0=i*rowH,by=y0+22;const lab=`${r.b.lv} ${r.b.t}`;
    const right=r.total?`已学 ${r.learned} · 熟记 ${r.mastered} / ${r.total}`:"内容准备中";
    s+=`<circle cx="5" cy="${y0+10}" r="4" style="fill:${lvVar(r.b.lv)}"/><text class="t-ink" x="14" y="${y0+14}">${esc(lab)}</text><text class="t-sm" x="${w}" y="${y0+14}" text-anchor="end">${esc(right)}</text>`;
    s+=`<rect class="trk" x="0" y="${by}" width="${w}" height="${bh}" rx="${bh/2}"/>`;
    if(r.total){const lw=f1(w*r.learned/r.total),mw=f1(w*r.mastered/r.total);
      s+=`<g data-tt="${esc(`${lab}：共 ${r.total} 词，已学 ${r.learned}（${pct(r.learned/r.total)}%），熟记 ${r.mastered}（${pct(r.mastered/r.total)}%）`)}"><rect class="hit" x="0" y="${y0}" width="${w}" height="${rowH}"/>`+
        (lw>0?`<path d="${hbar(0,by,lw,bh)}" style="fill:var(--ai);opacity:.32"/>`:"")+(mw>0?`<path d="${hbar(0,by,mw,bh)}" style="fill:var(--ai)"/>`:"")+`</g>`}
  });
  return s+`</svg>`;
}

/* ============ 学习数据汇总 ============ */
function quizAcc(lv){let c=0,n=0,k=0;const S=Y.S;for(const l of Y.allLessons()){if(l.custom||l.lv!==lv||!l.quiz.length||S.quiz[l.id]==null)continue;k++;n+=l.quiz.length;c+=Math.min(l.quiz.length,+S.quiz[l.id]||0)}return{c,n,k,a:n?c/n:0}}
function kanaInfo(){const K=Y.kana;if(!K||!K.KL)return null;try{return{h:K.done("h"),k:K.done("k"),n:K.KL.length,stars:K.totalStars(),m:K.mastered()}}catch(e){return null}}
function gramToday(){const t=today();return Object.values(Y.S.grammar).filter(v=>v===t).length}
/* 会话课模块学完一集（任一模式完成、做完小测或「我学完了」）时写 S.easy.last = 今天 */
function easyToday(){const e=Y.S.easy;return !!e&&typeof e==="object"&&e.last===today()}
const easyOn=()=>{const t=Y.tabs().easy;return !!t&&!t.placeholder&&Y.easy().length>0};

/* 优势 / 短板（规则 + 打分，各取最多 3 条） */
function conclusions(){
  const S=Y.S,good=[],bad=[],t=latest(),c=Y.counts(),ls=Y.levelStats(),d30=last30();
  const act=d30.filter(d=>d.v>0).length,due=Y.dueWords().length,stk=Y.streak(),kana=kanaInfo();
  if(t){const eq=SEC.map(x=>recEq(t,x.s));const mx=Math.max(...eq),mn=Math.min(...eq);
    if(mx-mn>=.3){const bi=eq.indexOf(mx),wi=eq.indexOf(mn);
      good.push([9,`「${SEC[bi].n}」是你最强的一项，${eqText(mx)} 水平。`]);
      bad.push([9,`「${SEC[wi].n}」相对薄弱（${eqText(mn)}），学习计划里会加大它的比重。`])}
    else good.push([5,`四项能力比较均衡，整体${recLevelText(t)}。`]);
  }else bad.push([6,"还没做过等级自测，不清楚词汇、语法、阅读、听力哪一项弱，建议先测一次（约 5 分钟一级）。"]);
  if(stk>=3)good.push([7,`已经连续学习 ${stk} 天，节奏很好。`]);
  if(act>=15)good.push([6,`近 30 天学了 ${act} 天，坚持得不错。`]);
  else if(act>0&&act<8)bad.push([5,`近 30 天只学了 ${act} 天，试着每天固定 10 分钟。`]);
  if(c.mastered>=30&&c.learned&&c.mastered/c.learned>=.35)good.push([6,`已熟记 ${c.mastered} 个单词，复习做得扎实。`]);
  if(due>=20)bad.push([8,`有 ${due} 个单词到期还没复习，先清复习再学新词，记得更牢。`]);
  /* 当前在学等级：单词与语法进度差 */
  const lvNow=LV.find(lv=>ls[lv].lessons&&ls[lv].prog<.999)||null;
  if(lvNow){const o=ls[lvNow];const wc=o.words?o.learned/o.words:0,gc=o.grammar?o.gDone/o.grammar:0;
    if(o.learned>=10&&wc-gc>=.15)bad.push([7,`${lvNow} 单词学了 ${pct(wc)}%，语法只掌握 ${pct(gc)}%，语法跟不上单词进度。`]);
    else if(o.gDone>=5&&gc-wc>=.15)bad.push([6,`${lvNow} 语法掌握了 ${pct(gc)}%，单词只学了 ${pct(wc)}%，多背单词才能读懂句子。`]);
    else if(o.learned>=10&&o.gDone>=3)good.push([4,`${lvNow} 的单词和语法进度齐头并进。`])}
  let qc=0,qn=0,qk=0;for(const lv of LV){const q=quizAcc(lv);qc+=q.c;qn+=q.n;qk+=q.k}
  if(qk>=2&&qn){const a=qc/qn;if(a>=.8)good.push([6,`课后练习正确率 ${pct(a)}%，基础牢固。`]);else if(a<.6)bad.push([7,`课后练习正确率只有 ${pct(a)}%，建议回看语法讲解再做一遍。`])}
  if(kana){if(kana.h>=kana.n&&kana.k>=kana.n)good.push([5,"五十音平假名、片假名全部通关。"]);
    else if(kana.h<kana.n&&c.learned<200)bad.push([6,`平假名还有 ${kana.n-kana.h} 关没过，先把五十音打牢，背单词会快很多。`]);
    else if(kana.h>=kana.n&&kana.k<kana.n)bad.push([4,`片假名还有 ${kana.n-kana.k} 关没过，外来语单词会常遇到。`])}
  const pick=a=>a.sort((x,y)=>y[0]-x[0]).slice(0,3).map(x=>x[1]);
  return{good:pick(good),bad:pick(bad)};
}

/* ============ 学习计划 ============ */
function bookSeq(b){
  const map={};for(const l of Y.bookLessons(b.id))if(l.no!=null)map[l.no]=l;
  const out=[];for(let n=b.from;n<=b.to;n++){const id=b.id==="b1"?String(n):b.id+"-"+n;
    out.push(map[n]||{id,no:n,book:b.id,lv:b.lv,t:"",pending:true,words:[],grammar:[],quiz:[]})}
  return out;
}
const rangeBooks=(from,to)=>Y.BOOKS.filter(b=>{const i=LV.indexOf(b.lv);return i>=from&&i<=to});
const lDone=l=>!l.pending&&Y.lessonProg(l)>=.999;
function planSeq(bookIds){return [].concat(...Y.BOOKS.filter(b=>bookIds.includes(b.id)).map(bookSeq))}
function jlptDates(){const out=[],t=today();const y0=+t.slice(0,4);
  for(let y=y0;y<=y0+1;y++)for(const m of [6,11]){const d=new Date(y,m,1,12);d.setDate(1+((7-d.getDay())%7));const k=dkey(d);if(daysBetween(t,k)>=14)out.push(k)}
  return out.slice(0,2)}
function focusOf(target,bookIds){
  const w={v:35,g:30,r:20,l:15},why=[];
  if(LV.indexOf(target)>=2){w.r*=1.2;why.push(`N3 及以上的考试阅读题量大，目标 ${target}，阅读比重略加`)}
  const t=latest();
  if(t){const eq=SEC.map(x=>recEq(t,x.s));const m=eq.reduce((a,b)=>a+b,0)/4;
    SEC.forEach((x,i)=>{w[x.s]*=clamp(1+.6*(m-eq[i]),.6,1.7)});
    const wi=eq.indexOf(Math.min(...eq));if(Math.max(...eq)-eq[wi]>=.3)why.push(`自测「${SEC[wi].n}」最弱，加大比重`)}
  let tw2=0,lw=0,tg=0,dg=0;
  for(const id of bookIds)for(const l of Y.bookLessons(id)){const nw=Y.newWords(l);tw2+=nw.length;lw+=nw.filter(x=>Y.wordState(x)).length;tg+=l.grammar.length;dg+=l.grammar.filter((_,i)=>Y.S.grammar[l.id+"-"+i]).length}
  if(tw2&&tg){const wc=lw/tw2,gc=dg/tg;if(wc-gc>.15){w.g*=1.25;why.push("语法进度落后于单词，文法比重加大")}else if(gc-wc>.15){w.v*=1.25;why.push("单词进度落后于语法，单词比重加大")}}
  /* 按 5% 取整，总和 100 */
  const ks=["v","g","r","l"],sum=ks.reduce((a,k)=>a+w[k],0),raw=ks.map(k=>w[k]/sum*20),fl=raw.map(Math.floor);
  let left=20-fl.reduce((a,b)=>a+b,0);const ord=raw.map((r,i)=>[r-fl[i],i]).sort((a,b)=>b[0]-a[0]);for(let j=0;j<left;j++)fl[ord[j][1]]++;
  for(let i=0;i<4;i++)if(fl[i]<1){const mx=fl.indexOf(Math.max(...fl));fl[mx]--;fl[i]++}
  const o={};ks.forEach((k,i)=>o[k]=fl[i]*5);return{f:o,why};
}
function computePlan(target,exam){
  const ti=LV.indexOf(target),ci=curIdx(),review=ti<=ci,from=review?ti:ci+1;
  const books=rangeBooks(from,ti),ids=books.map(b=>b.id),seq=planSeq(ids),left=seq.filter(l=>!lDone(l));
  const real=Y.allLessons().filter(l=>!l.custom);
  const avgW=real.length?Math.max(12,Math.round(real.reduce((a,l)=>a+Y.newWords(l).length,0)/real.length)):25;
  const avgG=real.length?Math.max(4,Math.round(real.reduce((a,l)=>a+l.grammar.length,0)/real.length)):6;
  let words=0,gram=0,pend=0;
  for(const l of left){if(l.pending){pend++;words+=avgW;gram+=avgG}else{words+=Y.newWords(l).filter(w=>!Y.wordState(w)).length;gram+=l.grammar.filter((_,i)=>!Y.S.grammar[l.id+"-"+i]).length}}
  const t0=today();let examDays=exam?daysBetween(t0,exam):0;if(examDays<=0){exam="";examDays=0}
  const buf=exam?Math.min(21,Math.round(examDays*.15)):0;
  const days=exam?Math.max(7,examDays-buf):clamp(Math.max(Math.ceil(words/12),Math.ceil(gram/3)),28,720);  /* 不定日期：按每天约 12 个新词、3 个语法点的标准节奏 */
  const npdNeed=Math.ceil(words/days),npd=NPD.find(n=>n>=npdNeed)||30;
  const gpdNeed=gram/days,gpd=clamp(Math.ceil(gpdNeed),1,5);
  const weeks=Math.max(1,Math.ceil(days/7)),lpw=Math.max(1,Math.ceil(left.length/weeks));
  const fo=focusOf(target,ids),mins=Math.round((npd*2.5+gpd*8+10)/5)*5;
  const first=left[0]||seq[0]||null;
  const warn=[];
  if(review)warn.push(`你已经达到 ${target}，这份计划以复习巩固为主；想继续进步可以把目标调高一级。`);
  if(exam&&examDays<30)warn.push(`离考试只有 ${examDays} 天：以复习到期单词、错题和模拟题为主，新内容少学。`);
  else if(exam&&(npdNeed>30||gpdNeed>4)){const nx=jlptDates().find(d=>d>exam);warn.push(`时间比较紧：每天需要约 ${npdNeed} 个新词、${Math.ceil(gpdNeed)} 个语法点。建议${nx?`改考 ${cnDate(nx)} 那一次，或`:""}把目标调低一级。`)}
  if(pend)warn.push(`其中 ${pend} 课内容还在编写中，单词和语法数是按平均值估计的。`);
  return{target,from:ci>=0?LV[ci]:"",exam,examDays,buf,created:t0,days,weeks,words,gram,lessons:left.length,total:seq.length,
    npd,npdNeed,gpd,lpw,mins,focus:fo.f,why:fo.why,book:first?first.book:(books[0]||Y.BOOKS[0]).id,startId:first?first.id:"",books:ids,review,warn};
}
/* 计划里实际要用的数字：保存的计划用保存值，草稿用新算的 */
function planView(){
  const saved=getPlan(),pd=V.pd||{target:saved?saved.target:LV[clamp(curIdx()+1,0,4)],exam:saved?saved.exam||"":""};V.pd=pd;
  const dirty=!saved||saved.target!==pd.target||(saved.exam||"")!==(pd.exam||"");
  const live=computePlan(pd.target,pd.exam);
  if(dirty)return{p:live,live,saved:null,dirty};
  const p=Object.assign({},live,{created:saved.created,npd:saved.npd,gpd:saved.gpd,lpw:saved.lpw,mins:saved.mins,focus:saved.focus,book:saved.book,startId:saved.startId,books:saved.books,days:saved.days});
  return{p,live,saved,dirty};
}
function weeksOf(p,count){
  const seq=planSeq(p.books||[]);let s0=seq.findIndex(l=>l.id===p.startId);if(s0<0)s0=0;
  const wi=Math.max(0,Math.floor(daysBetween(p.created,today())/7));const out=[];
  for(let k=wi;k<wi+count;k++){const a=s0+k*p.lpw;if(a>=seq.length&&k>wi)break;
    out.push({k,now:k===wi,from:addDays(p.created,k*7),to:addDays(p.created,k*7+6),ls:seq.slice(a,a+p.lpw)})}
  const planned=Math.min(seq.length-s0,wi*p.lpw);let doneN=0;for(let i=s0;i<s0+planned;i++)if(lDone(seq[i]))doneN++;
  return{weeks:out,wi,planned,doneN,seq,s0};
}
function lessonName(l){const b=Y.book(l.book);return `${b?b.t+" ":""}第${l.no}课${l.t?" "+l.t:""}`}
/* 今天的计划：完成情况全部来自当天真实学习数据 */
function todayItems(p){
  const S=Y.S,t=today(),nt=Y.newToday(),fresh=Y.freshPool().length,due=Y.dueWords().length,gT=gramToday(),xp=+S.days[t]||0,goal=+S.settings.goal||50;
  const needNew=Math.min(p.npd,nt+fresh);
  const items=[
    {k:"new",t:needNew?`学 ${p.npd} 个新词`:"新词已全部学完",c:Math.min(nt,needNew),n:needNew,act:"test-words",go:"背单词"},
    {k:"rev",t:"清空到期复习",c:due?0:1,n:1,sub:due?`还有 ${due} 个`:"",act:"test-words",go:"复习"},
    {k:"gram",t:`学 ${p.gpd} 个语法点`,c:Math.min(gT,p.gpd),n:p.gpd,act:"test-gram",go:"学语法"}];
  const ex=(p.focus&&p.focus.l>=p.focus.r)?"l":"r";
  if(easyOn())items.push({k:"easy",t:ex==="l"?"听一集会话课，跟读一遍":"读一集会话课原文",c:easyToday()?1:0,n:1,act:"test-easy",go:"去会话"});
  else items.push({k:"ext",t:ex==="l"?"听力：例句朗读跟读 10 分钟":"阅读：读一课的例句和讲解",c:p.ext===t?1:0,n:1,act:"test-tick",go:"打勾",manual:true});
  items.push({k:"xp",t:`拿到 ${goal} XP`,c:Math.min(xp,goal),n:goal});
  for(const x of items)x.ok=x.c>=x.n;
  return items;
}
function markHit(p,items){
  const t=today();if(!items.every(x=>x.ok)||(p.hit&&p.hit[t]))return;
  if(!p.hit||typeof p.hit!=="object")p.hit={};p.hit[t]=1;
  const ks=Object.keys(p.hit).sort();while(ks.length>60)delete p.hit[ks.shift()];
  /* 在渲染过程中被调用（首页卡片）：保存放到渲染之后 */
  setTimeout(()=>{Y.checkBadges();Y.save()},0);
}

/* ============ 覆盖层：打开 / 重画 ============ */
const ours=()=>{try{return mine&&Y.overlayOpen()&&!!Y.overlayEl().querySelector(".tt-root")}catch(e){return false}};
function openHub(tab){
  ensureCss();V.page="hub";V.tab=tab||V.tab||"test";V.delArm=false;if(V.tab!=="plan")V.pd=null;
  if(!ours()){Y.openOverlay(`<div class="sin tt-root"></div>`,{onKey,onClose:()=>{mine=false;T=null;V.fresh=null;V.pd=null;hideTip()},rerender:()=>draw(false)});mine=true}
  draw(true);
}
function draw(top,again){
  if(!mine)return;hideTip();lastW=contentW();
  let h;try{h=V.page==="q"?vQ():V.page==="lvdone"?vLvDone():vHub()}
  catch(e){console.error("[yume] 自测页面出错",e);h=`<div class="sin tt-root"><div class="card"><b class="err">页面出错了</b><div class="small muted">${esc(e&&e.message)}</div><button class="btn sm" data-act="test-close">关闭</button></div></div>`}
  Y.updateOverlay(h,{top:!!top});
  /* 内容变长后出现滚动条（桌面浏览器）会让可用宽度变窄：按新宽度再画一次，图表文字保持真实像素 */
  if(!again&&V.page==="hub"&&contentW()!==lastW)draw(false,true);
}
function onKey(e){
  if(!mine)return false;
  if(V.page==="q"&&T){
    if(e.key==="Escape"){quitAsk();return true}
    if(isTyping(e))return false;
    const it=T.items[T.i];
    if(T.ans==null){if(/^[1-4]$/.test(e.key)){const i=+e.key-1;if(i<it.opts.length)pick(i);return true}if(e.key==="0"){pick(-1);return true}}
    else if(e.key==="Enter"||e.key===" "){e.preventDefault();next();return true}
    if((e.key==="r"||e.key==="R")&&it.sec==="listening"){play(false);return true}
    return false;
  }
  if(V.page==="lvdone"&&T){if(e.key==="Enter"){e.preventDefault();const nx=nextAvail(T.li);if(lvPassed(T.li)&&nx>=0)contLevel();else finishTest();return true}if(e.key==="Escape"){finishTest();return true}return false}
  return false;
}

/* ============ 自测流程 ============ */
function startTest(lv){
  const si=LV.indexOf(lv);if(si<0||!avail(lv)){Y.toast("这一级的题库还在准备中");return}
  T={si,li:si,items:buildLevel(lv),i:0,ans:null,res:{},cur:{v:[0,0],g:[0,0],r:[0,0],l:[0,0]},plays:0,speaking:false};
  V.page="q";V.fresh=null;V.quitAt=0;
  if(!ours())openHub("test");
  V.page="q";draw(true);autoPlay();
}
function curItem(){return T&&T.items[T.i]}
function pick(i){
  if(!T||T.ans!=null)return;const it=curItem();if(!it)return;
  T.ans=i;const s=SECK[it.sec].s;T.cur[s][1]++;if(i===it.ans)T.cur[s][0]++;
  draw(false);
}
function next(){
  if(!T||T.ans==null)return;playTok++;Y.stopSpeak();T.i++;T.ans=null;T.plays=0;T.speaking=false;
  if(T.i>=T.items.length){const lv=LV[T.li];const sc={};for(const x of SEC)if(T.cur[x.s][1])sc[x.s]=T.cur[x.s].slice();T.res[lv]=sc;V.page="lvdone";draw(true);return}
  draw(true);autoPlay();
}
const lvPassed=li=>{const sc=T&&T.res[LV[li]];return !!sc&&lvAcc(sc)>=PASS};
const nextAvail=li=>li+1<LV.length&&avail(LV[li+1])?li+1:-1;
function contLevel(){const nx=nextAvail(T.li);if(nx<0){finishTest();return}T.li=nx;T.items=buildLevel(LV[nx]);T.i=0;T.ans=null;T.cur={v:[0,0],g:[0,0],r:[0,0],l:[0,0]};T.plays=0;V.page="q";draw(true);autoPlay()}
function finishTest(){
  if(!T)return;const done=Object.keys(T.res);
  if(!done.length){T=null;V.page="hub";draw(true);return}
  let level="";for(let i=T.si;i<LV.length;i++){const sc=T.res[LV[i]];if(sc&&lvAcc(sc)>=PASS)level=LV[i];else break}
  const scores={};for(const lv of LV)if(T.res[lv])scores[lv]=T.res[lv];
  const rec={date:today(),level,start:LV[T.si],scores};
  const firstToday=!recs().some(r=>r.date===rec.date);
  const h=hist();h.push(rec);while(h.length>HIST_MAX)h.shift();
  let correct=0;for(const lv of done)correct+=cn(T.res[lv])[0];
  const gain=correct+(firstToday?10:0);Y.addXP(gain);Y.checkBadges();Y.save();
  T=null;V.page="hub";V.tab="test";V.fresh={xp:gain,date:rec.date};draw(true);
}
function quitAsk(){
  if(!T)return;const now=Date.now();
  if(now-V.quitAt<3500){V.quitAt=0;Y.stopSpeak();if(Object.keys(T.res).length)finishTest();else{T=null;Y.closeOverlay()}return}
  V.quitAt=now;Y.toast(Object.keys(T.res).length?"再点一次结束：保存已完成等级的成绩，这一级不计":"再点一次退出，本次测试不保存",3200);
}
/* 听力原文按行拆开：「男：」「女：」「男の人：」这类说话人标签不读出来，男女分别用男声 / 女声（没有男声时压低音调） */
const SPK_RE=/^(男|女)(?:の(?:人|子|学生|先生))?\s*[：:]\s*/;
function audioSegs(a){
  return String(a||"").split(/\n+/).map(x=>x.trim()).filter(Boolean).map(x=>{
    const m=x.match(SPK_RE);return m?{t:x.slice(m[0].length),v:m[1]==="男"?"male":"female"}:{t:x,v:""};
  }).filter(x=>x.t);
}
const hasMale=()=>{try{return Y.tts.voices.some(v=>/otoya|ichiro|keita|hattori|daichi|naoki|\bmale\b|男性/i.test(v.name))}catch(e){return false}};
let playTok=0;
function play(slow){
  const it=curItem();if(!it||it.sec!=="listening"||!it.audio)return;
  if(!Y.tts.ok){Y.toast("这个浏览器不能朗读，请点开原文作答");return}
  T.plays++;T.speaking=true;draw(false);const my=T,tok=++playTok;
  const rate=slow?.7:.9,male=hasMale();
  (async()=>{
    for(const sg of audioSegs(it.audio)){
      if(T!==my||tok!==playTok||!T.speaking)return;
      const o={rate};if(sg.v){o.voiceHint=sg.v;o.pitch=sg.v==="male"?(male?.95:.78):1.1}
      await Y.speak(sg.t,o);
      if(T!==my||tok!==playTok)return;
      await new Promise(r=>setTimeout(r,280));
    }
    if(T===my&&tok===playTok&&T.speaking){T.speaking=false;if(V.page==="q")draw(false)}
  })();
}
function autoPlay(){const it=curItem();if(it&&it.sec==="listening"&&Y.tts.ok)setTimeout(()=>{const x=curItem();if(x===it&&T.ans==null&&T.plays===0&&ours())play(false)},450)}

/* ============ 页面：答题 ============ */
function vQ(){
  const it=curItem(),a=T.ans,n=T.items.length,lv=LV[T.li],sx=SECK[it.sec];
  const prog=(T.i+(a!=null?1:0))/n*100;
  let ctx="";
  if(it.sec==="reading"&&it.passage)ctx=`<div class="card stack" style="gap:8px"><div class="eyebrow">阅读下面的短文，回答问题</div><div class="tt-passage jr" lang="ja">${ruby(it.passage)}</div></div>`;
  if(it.sec==="listening"){
    const noVoice=!Y.tts.ja();
    ctx=`<div class="card stack" style="gap:12px"><div class="tt-listen"><button class="listen ${T.speaking?"on":""}" data-act="test-play" aria-label="播放录音">${IC.spk}</button>
      <div class="grow stack" style="gap:6px"><b>听录音，回答问题</b><div class="small muted">${T.plays?`已播放 ${T.plays} 次 · 可以重复听`:Y.tts.ok?"点左边按钮播放（键盘 R）":"这个浏览器不能朗读"}</div>
      ${Y.tts.ok?`<div><button class="chip btnchip" data-act="test-play" data-slow="1">慢速再听</button></div>`:""}</div></div>
      ${a==null&&noVoice?`<details class="fold"><summary>${Y.tts.ok?"没有日语语音、听不清？":"听不到声音？"}点开看原文（也可以到「我的 → 发音」改用在线发音）</summary><div class="jr" lang="ja" style="white-space:pre-wrap">${esc(it.audio)}</div></details>`:""}</div>`;
  }
  const qh=ruby(it.q),bi=qh.lastIndexOf("（　）");  // 题干开头的「（　）に入れるのに…」是说明，填最后一个空
  const q=bi<0?qh:qh.slice(0,bi)+`<span class="blank">${a!=null?ruby(it.right):"　"}</span>`+qh.slice(bi+3);
  const long=it.sec==="reading"||it.sec==="listening"||it.opts.some(o=>plain(o).length>7);
  const opts=it.opts.map((o,i)=>{let c="";if(a!=null){if(i===it.ans)c="ok";else if(i===a)c="no"}
    return `<button class="opt ja ${c}" lang="ja" data-act="test-pick" data-i="${i}" ${a!=null?"disabled":""}><span class="n">${i+1}</span><span class="jr">${ruby(o)}</span></button>`}).join("");
  let reveal="";
  if(a!=null){const ok=a===it.ans;
    reveal=`<div class="card reveal"><div class="res ${ok?"ok":"no"}">${ok?"答对了":(a<0?"已跳过 · ":"")+"正确答案："+`<span lang="ja">${ruby(it.right)}</span>`}</div>
    ${it.sec==="listening"?`<div class="glabel">录音原文</div><div class="row" style="align-items:flex-start"><div class="tt-script grow" lang="ja">${esc(it.audio)}</div><button class="iconbtn" data-act="test-play" aria-label="再听一遍">${IC.spk}</button></div>`:""}
    ${it.zh?`<div class="why jr"><b>解析</b>　${ruby(it.zh)}</div>`:""}
    <button class="btn primary block" data-act="test-next">${T.i+1>=n?"查看本级成绩":"下一题"} <span class="small" style="opacity:.7">Enter</span></button></div>`}
  return `<div class="sin tt-root">
    <div class="shead"><button class="iconbtn" data-act="test-quit" aria-label="结束测试">${IC.close}</button><div class="bar grow" role="progressbar" aria-valuenow="${Math.round(prog)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${prog}%"></i></div><span class="lvb ${lvClass(lv)}">${lv}</span></div>
    <div class="row small muted tt-meta"><span class="tt-sec s-${sx.s}">${sx.n}</span><span class="row" style="gap:8px"><span class="num">第 ${T.i+1} / ${n} 题</span><button class="chip btnchip ${Y.furiOn()?"on":""}" data-act="furi" aria-pressed="${Y.furiOn()}" title="振假名（汉字上方的读音）"><span lang="ja">ふりがな</span></button></span></div>
    ${ctx}
    ${it.q?`<div class="tt-q jr" lang="ja">${q}</div>`:""}
    <div class="opts ${long?"tt-1col":""}">${opts}</div>
    ${a==null?`<button class="btn ghost" data-act="test-pick" data-i="-1">不会，跳过</button>`:""}
    ${reveal}</div>`;
}

/* ============ 页面：一级结束 ============ */
function secRows(sc){return `<div class="tt-sec-rows">${SEC.filter(x=>sc[x.s]).map(x=>{const [c,n]=sc[x.s];return `<div class="tt-sec-row"><span class="tt-sec s-${x.s}">${x.n}</span><div class="tt-meter s-${x.s}"><i style="width:${n?c/n*100:0}%"></i></div><span class="num">${c}/${n}</span></div>`}).join("")}</div>`}
function vLvDone(){
  const lv=LV[T.li],sc=T.res[lv],[c,n]=cn(sc),a=n?c/n:0,ok=a>=PASS,nx=nextAvail(T.li);
  const more=ok&&nx>=0;
  return `<div class="sin tt-root"><div class="done">
    <span class="seal" lang="ja">${ok?"合":"惜"}</span>
    <h2 style="font-size:24px">${lv} ${ok?"通过":"未通过"}</h2>
    <div class="muted">答对 <b class="num" style="color:var(--ink)">${c}</b> / ${n} · ${pct(a)}%（通过线 70%）</div>
    <div class="card" style="width:100%">${secRows(sc)}</div>
    ${ok&&nx<0&&T.li<LV.length-1?`<div class="small muted">${LV[T.li+1]} 的题库还在准备中，这次就测到这里。</div>`:""}
    ${ok&&T.li===LV.length-1?`<div class="small muted">N1 也通过了，太厉害了！</div>`:""}
    ${!ok?`<div class="small muted">没关系，测试会按你通过的最高等级给出结果和学习建议。</div>`:""}
    ${more?`<button class="btn primary block" data-act="test-cont">继续挑战 ${LV[nx]} <span class="small" style="opacity:.7">Enter</span></button><button class="btn ghost block" data-act="test-end">到此结束，看结果</button>`:`<button class="btn primary block" data-act="test-end">查看结果 <span class="small" style="opacity:.7">Enter</span></button>`}
  </div></div>`;
}

/* ============ 页面：总览（自测 | 分析 | 计划） ============ */
function vHub(){
  const tabs=[["test",recs().length?"自测结果":"等级自测"],["ana","学习分析"],["plan","学习计划"]];
  const body=V.tab==="ana"?vAna():V.tab==="plan"?vPlan():vTest();
  return `<div class="sin tt-root">
    <div class="row tt-head"><div class="grow"><div class="eyebrow">等级自测 · 学习分析 · 学习计划</div><h1 style="font-size:22px">${V.tab==="ana"?"学习分析":V.tab==="plan"?"学习计划":"等级自测"}</h1></div><button class="iconbtn" data-act="test-close" aria-label="关闭">${IC.close}</button></div>
    <div class="tabs" role="tablist">${tabs.map(([k,t])=>`<button role="tab" aria-selected="${V.tab===k}" class="${V.tab===k?"on":""}" data-act="test-tab" data-k="${k}">${t}</button>`).join("")}</div>
    ${body}</div>`;
}
function startCard(again){
  const avs=LV.filter(avail);
  if(!avs.length)return `<div class="card soon"><span class="seal" lang="ja">待</span><b>题库准备中</b><div class="small muted">等级自测题还在编写，先去学课程吧。</div></div>`;
  if(!avail(V.slv))V.slv=avs[0];
  const vn=Y.tts.ja()?"":Y.tts.ok?"没检测到日语语音，听力题可能读不准：可以到「我的 → 发音」改用在线发音，答题时也能点开原文。":"这个浏览器不能朗读，听力题会改为显示原文。";
  const below=LV.slice(0,LV.indexOf(V.slv));
  return `<div class="card stack" style="gap:12px">
    <div class="row"><span class="tt-ico">${IC.target}</span><div class="grow"><b style="font-size:17px">${again?"再测一次":"测测我的日语等级"}</b><div class="small muted">从起点等级开始，每级 ${PER} 题，正确率 ≥ 70% 自动进入下一级</div></div></div>
    <ul class="tt-ul small"><li>四个部分：<span class="tt-sec s-v" style="font-weight:500;color:inherit">文字词汇</span>、<span class="tt-sec s-g" style="font-weight:500;color:inherit">语法</span>、<span class="tt-sec s-r" style="font-weight:500;color:inherit">阅读</span>、<span class="tt-sec s-l" style="font-weight:500;color:inherit">听力</span></li><li>不会的题点「不会，跳过」，每题答完都有解析</li><li>每级约 4–6 分钟，中途可以随时结束</li></ul>
    <div class="eyebrow">从哪一级开始</div>
    <div class="tt-chips">${LV.map(lv=>`<button class="tt-chip ${V.slv===lv?"on":""}" data-act="test-slv" data-k="${lv}" ${avail(lv)?"":"disabled"} aria-pressed="${V.slv===lv}">${lv}${avail(lv)?"":" <small>准备中</small>"}</button>`).join("")}</div>
    ${below.length?`<div class="small muted">从 ${V.slv} 开始时，${below.join("、")} 按已通过计算。</div>`:""}
    ${vn?`<div class="small tt-warn">${esc(vn)}</div>`:`<div class="row small muted" style="gap:10px">${Y.sayBtn("日本語のテストを始めます。","试听")}<span>先试听一下，确认能听到日语</span></div>`}
    <button class="btn primary block" data-act="test-begin">${IC.play}开始测试</button></div>`;
}
function resultTable(rec){
  const st=LV.indexOf(rec.start);const rows=LV.filter(lv=>rec.scores[lv]);
  return `<div class="tt-scroll"><table class="tt-table"><thead><tr><th>等级</th>${SEC.map(x=>`<th>${x.sh}</th>`).join("")}<th>合计</th></tr></thead><tbody>
    ${st>0?`<tr><td colspan="6" class="small muted">${LV.slice(0,st).join("、")}：起点以下，按通过计算</td></tr>`:""}
    ${rows.map(lv=>{const sc=rec.scores[lv],[c,n]=cn(sc),ok=n&&c/n>=PASS;return `<tr><td><span class="lvb ${lvClass(lv)}">${lv}</span></td>${SEC.map(x=>{const a=sc[x.s];return `<td>${a&&a[1]?`${a[0]}/${a[1]}`:"—"}</td>`}).join("")}<td class="${ok?"pass":"fail"}">${pct(n?c/n:0)}%${ok?" ✓":""}</td></tr>`}).join("")}
  </tbody></table></div>`;
}
function radarCard(rec,prev,w){
  return `<div class="card stack" style="gap:10px"><div class="row" style="justify-content:space-between;flex-wrap:wrap"><div class="eyebrow">四项能力</div><span class="small muted">越往外越强，每一圈是一个等级</span></div>
    ${radarSVG(SEC.map(x=>recEq(rec,x.s)),prev?SEC.map(x=>recEq(prev,x.s)):null,w)}
    ${prev?`<div class="tt-legend" style="justify-content:center"><span><i class="tt-key" style="--c:var(--ai)"></i>本次 ${md(rec.date)}</span><span><i class="tt-key" style="--c:var(--faint)"></i>上次 ${md(prev.date)}</span></div>`:""}
    <div class="tt-why">能力值按「起点以下各级算满分 + 每一级该部分的正确率」累计，某级答对 ≥70% 记为达到该级。</div></div>`;
}
function vTest(){
  const rs=recs(),r=rs[rs.length-1]||null,prev=rs.length>1?rs[rs.length-2]:null,w=cardW();
  if(!r)return startCard(false)+`<div class="card stack" style="gap:8px"><div class="eyebrow">测完会看到</div><ul class="tt-ul small"><li>你大约在 N5–N1 的哪一档，以及各级各部分的正确率</li><li>文字词汇 / 语法 / 阅读 / 听力 四项能力雷达图</li><li>按目标等级和考试日期生成的学习计划</li></ul></div>`;
  const [c,n]=LV.reduce((a,lv)=>{if(!r.scores[lv])return a;const x=cn(r.scores[lv]);return [a[0]+x[0],a[1]+x[1]]},[0,0]);
  const fresh=V.fresh&&V.fresh.date===r.date;
  const nxt=r.level?LV[LV.indexOf(r.level)+1]:r.start;
  const last8=rs.slice(-8);
  return `${fresh?`<div class="card row tt-fresh" style="gap:12px"><span class="seal" lang="ja">済</span><div class="grow"><b>测试完成</b><div class="small muted">获得 <b style="color:var(--ink)">+${V.fresh.xp}</b> XP · 结果已保存</div></div></div>`:""}
  <div class="card stack" style="gap:14px">
    <div class="tt-hero">${lvTile(r)}
      <div class="grow"><div class="eyebrow">${fresh?"本次结果":"最近一次 · "+cnDate(r.date)}</div><h2>${esc(recLevelText(r))}</h2>
      <div class="small muted">从 ${r.start} 开始 · 共答 ${n} 题，答对 ${c} 题（${pct(n?c/n:0)}%）</div></div></div>
    <div class="small">${r.level?(nxt?`下一步：把 ${nxt} 的单词和语法学扎实，再来挑战 ${nxt}。`:"已经通过 N1 自测，可以多读多听原版材料。"):`${r.start==="N5"?`建议从「${esc(Y.BOOKS[0].t)}」学起，学完一册再来测。`:`${r.start} 还差一点。可以从 ${LV[LV.indexOf(r.start)-1]} 重新测一次，确认基础。`}`}</div>
    <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn primary sm grow" data-act="test-tab" data-k="plan">${IC.target}制定学习计划</button><button class="btn sm grow" data-act="test-tab" data-k="ana">${IC.chart}查看学习分析</button></div>
  </div>
  ${radarCard(r,prev,w)}
  <div class="card stack" style="gap:10px"><div class="row" style="justify-content:space-between;flex-wrap:wrap"><div class="eyebrow">各级通过情况</div><span class="small muted">柱 = 该级正确率</span></div>
    ${levelSVG(r,w)}
    <div class="tt-legend"><span><i class="tt-key" style="--c:var(--muted);height:1px"></i>通过线 70%</span><span><i class="tt-sw" style="--c:var(--n5)"></i>通过（等级色）</span><span><i class="tt-sw" style="--c:var(--faint)"></i>未通过</span></div>
    <div class="glabel">各级各部分正确率</div>${resultTable(r)}</div>
  ${rs.length>1?`<div class="card stack" style="gap:10px"><div class="row" style="justify-content:space-between;flex-wrap:wrap"><div class="eyebrow">历次对比</div><span class="small muted">共 ${rs.length} 次</span></div>
    ${histSVG(last8,w)}
    <div class="tt-scroll"><table class="tt-table"><thead><tr><th>日期</th><th>起点</th><th>结果</th>${SEC.map(x=>`<th>${x.sh}</th>`).join("")}</tr></thead><tbody>
    ${rs.slice(-8).reverse().map(x=>{const xl=recLv(x);return `<tr><td>${md(x.date)}</td><td>${x.start}</td><td>${xl?`<span class="lvb ${lvClass(xl)}">${x.level?"":"约 "}${xl}</span>`:"入门"}</td>${SEC.map(s=>`<td>${eqLabel(recEq(x,s.s))}</td>`).join("")}</tr>`}).join("")}</tbody></table></div></div>`:""}
  ${startCard(true)}`;
}

/* ---------- 学习分析 ---------- */
function vAna(){
  const S=Y.S,w=cardW(),d30=last30(),goal=+S.settings.goal||50,sum=d30.reduce((a,d)=>a+d.v,0),act=d30.filter(d=>d.v>0).length,hit=d30.filter(d=>d.v>=goal).length;
  const c=Y.counts(),ls=Y.levelStats(),bw=bookWords(),k=kanaInfo(),cc=conclusions(),rs=recs(),r=rs[rs.length-1]||null,prev=rs.length>1?rs[rs.length-2]:null;
  const gAll=Object.keys(S.grammar).length;
  const mx=LV.map(lv=>{const o=ls[lv],q=quizAcc(lv);
    if(!o.lessons)return `<span class="lvb ${lvClass(lv)}">${lv}</span><div class="off">内容准备中</div>`;
    const cell=(a,b,txt)=>`<div style="--c:${lvVar(lv)}"><div class="tt-meter"><i style="width:${b?a/b*100:0}%"></i></div><div class="v">${txt}</div></div>`;
    return `<span class="lvb ${lvClass(lv)}">${lv}</span>${cell(o.learned,o.words,`<b>${o.learned}</b>/${o.words}`)}${cell(o.gDone,o.grammar,`<b>${o.gDone}</b>/${o.grammar}`)}${q.k?cell(q.c,q.n,`<b>${pct(q.a)}%</b> · ${q.k}课`):`<div><div class="tt-meter"></div><div class="v">还没练</div></div>`}`}).join("");
  const kanaHtml=k?`<div class="card stack" style="gap:12px"><div class="row" style="justify-content:space-between"><div class="eyebrow">五十音完成度</div><span class="small muted">${k.stars} 颗星 · 熟悉 ${k.m} 个假名</span></div>
    ${[["平假名",k.h],["片假名",k.k]].map(([t,v])=>`<div class="tt-sec-row" style="grid-template-columns:56px 1fr 64px"><b style="font-size:13px">${t}</b><div class="tt-meter"><i style="width:${v/k.n*100}%;background:var(--gold)"></i></div><span class="num small muted" style="text-align:right">${v}/${k.n} 关</span></div>`).join("")}</div>`:"";
  return `<div class="tt-tiles">
    <div class="stat"><b>${fmtN(sum)}</b><span>近 30 天 XP</span></div>
    <div class="stat"><b>${act}<small class="muted" style="font-size:13px"> / 30</small></b><span>学习天数</span></div>
    <div class="stat"><b>${c.learned}</b><span>已学单词 · 熟记 ${c.mastered}</span></div>
    <div class="stat"><b>${gAll}</b><span>已掌握语法</span></div></div>
  <div class="card stack" style="gap:10px"><div class="eyebrow">结论</div>
    <div class="glabel">优势</div>${cc.good.length?`<ul class="tt-concl good">${cc.good.map(x=>`<li><span class="mk">✓</span><span>${esc(x)}</span></li>`).join("")}</ul>`:`<div class="small muted">数据还不多，学几天再来看。</div>`}
    <div class="glabel">短板</div>${cc.bad.length?`<ul class="tt-concl bad">${cc.bad.map(x=>`<li><span class="mk">!</span><span>${esc(x)}</span></li>`).join("")}</ul>`:`<div class="small muted">暂时没发现明显短板，保持节奏。</div>`}
    <button class="btn primary sm" data-act="test-tab" data-k="plan" style="align-self:flex-start">${IC.target}按短板生成学习计划</button></div>
  ${r?radarCard(r,prev,w):`<button class="card row" data-act="test-tab" data-k="test" style="text-align:left;width:100%;gap:12px"><span class="tt-ico">${IC.target}</span><div class="grow"><b>还没有四项能力数据</b><div class="small muted">做一次等级自测，就能看到词汇、语法、阅读、听力的雷达图</div></div>${IC.go}</button>`}
  <div class="card stack" style="gap:10px"><div class="row" style="justify-content:space-between;flex-wrap:wrap"><div class="eyebrow">近 30 天每日 XP</div><span class="small muted">日均 ${Math.round(sum/30)} · 达标 ${hit} 天</span></div>
    ${xpSVG(d30,goal,w)}
    <div class="tt-legend"><span><i class="tt-sw" style="--c:var(--ai)"></i>每日 XP</span><span><i class="tt-sw" style="--c:var(--gold)"></i>今天</span><span><i class="tt-key" style="--c:var(--gold);height:2px"></i>每日目标 ${goal} XP</span></div>
    <details class="fold"><summary>查看数据表</summary><div class="tt-scroll"><table class="tt-table"><thead><tr><th>日期</th><th>XP</th><th>日期</th><th>XP</th></tr></thead><tbody>${d30.slice(0,15).map((d,i)=>{const e=d30[i+15];return `<tr><td>${md(d.k)} 周${WD[d.wd]}</td><td>${d.v}</td><td>${md(e.k)} 周${WD[e.wd]}</td><td>${e.v}</td></tr>`}).join("")}</tbody></table></div></details></div>
  <div class="card stack" style="gap:10px"><div class="eyebrow">各册单词 · 学习量与熟记量</div>
    ${bookSVG(bw,w)}
    <div class="tt-legend"><span><i class="tt-sw" style="--c:var(--ai);opacity:.32"></i>已学（含熟记）</span><span><i class="tt-sw" style="--c:var(--ai)"></i>熟记（熟练度 5 级）</span><span><i class="tt-sw" style="--c:var(--sunk);box-shadow:inset 0 0 0 1px var(--line)"></i>本册全部</span></div></div>
  <div class="card stack" style="gap:12px"><div class="row" style="justify-content:space-between;flex-wrap:wrap"><div class="eyebrow">各等级 · 单词 / 语法 / 练习</div><span class="small muted">练习 = 已练课的最佳正确率</span></div>
    <div class="tt-mx"><span></span><span class="h">单词</span><span class="h">语法掌握</span><span class="h">练习正确率</span>${mx}</div></div>
  ${kanaHtml}`;
}

/* ---------- 学习计划 ---------- */
function vPlan(){
  const {p,live,saved,dirty}=planView(),pd=V.pd,ci=curIdx(),t=latest(),w=cardW();
  const jd=jlptDates();
  const lvNow=ci>=0?LV[ci]:"";
  const cur=t?`<b>${esc(recLevelText(t))}</b><div class="small muted">来自 ${cnDate(t.date,true)} 的等级自测</div>`:
    `<b>${lvNow?"约 "+lvNow:"入门（N5 学习中）"}</b><div class="small muted">根据学习记录估计 · <button class="chip btnchip ai" data-act="test-tab" data-k="test" style="font-size:12px">做一次自测更准</button></div>`;
  const inputs=`<div class="stack" style="gap:10px">
    <div class="eyebrow">目标等级</div>
    <div class="tt-chips">${LV.map(lv=>`<button class="tt-chip ${pd.target===lv?"on":""}" data-act="test-ptarget" data-k="${lv}" aria-pressed="${pd.target===lv}">${lv}${LV.indexOf(lv)<=ci?" <small>已达到</small>":""}</button>`).join("")}</div>
    <div class="eyebrow" style="margin-top:4px">考试日期（可选）</div>
    <div class="tt-chips"><button class="tt-chip ${!pd.exam?"on":""}" data-act="test-pdate" data-d="">不定日期</button>${jd.map(d=>`<button class="tt-chip ${pd.exam===d?"on":""}" data-act="test-pdate" data-d="${d}">${cnDate(d)} <small>JLPT</small></button>`).join("")}</div>
    <label class="field" for="test-exam">或者自己选日期<input class="tt-date" type="date" id="test-exam" data-change="test-exam" min="${addDays(today(),1)}" value="${esc(pd.exam||"")}"></label>
    <div class="tt-why">JLPT 在中国大陆每年 7 月和 12 月的第一个周日举行，报名一般提前 3 个月左右，以官网通知为准。</div></div>`;
  const fo=p.focus,ord=["v","g","r","l"],cols={v:"--tc1",g:"--tc2",r:"--tc3",l:"--tc4"};
  const adv={v:`每天 ${p.npd} 个新词，到期复习当天清空`,g:`每天 ${p.gpd} 个语法点：看讲解 → 读例句 → 做本课练习`,r:"读课文例句和会话课原文，先不看翻译抓大意",l:"听会话课和例句朗读，跟读模仿语调"};
  const span=p.exam?`距考试 <b>${p.examDays}</b> 天（最后 ${p.buf} 天留给复习）`:`按标准节奏约 <b>${p.weeks}</b> 周学完（到 ${cnDate(addDays(p.created,p.days),true)}）`;
  const wk=weeksOf(p,4);
  const lrow=l=>{const d=lDone(l);return l.pending?`<button class="tt-lrow" disabled><span class="grow">${esc(lessonName(l))}</span><span class="small muted">准备中</span></button>`:
    `<button class="tt-lrow" data-act="test-lesson" data-id="${esc(l.id)}">${d?`<span class="ok">${IC.check}</span>`:`<span class="lvb ${lvClass(l.lv)}" style="min-width:0;padding:0 5px">${l.lv}</span>`}<span class="grow">${esc(lessonName(l))}</span><span class="small muted num">${Math.round(Y.lessonProg(l)*100)}%</span></button>`};
  const weeksHtml=wk.weeks.length?wk.weeks.map(x=>`<div class="tt-week ${x.now?"now":""}"><div class="wh">第 ${x.k+1} 周${x.now?" · 本周":""}<span>${md(x.from)}–${md(x.to)}</span></div>${x.ls.length?x.ls.map(lrow).join(""):`<div class="small muted">课都学完了：复习错题、做自测和模拟题</div>`}</div>`).join(""):`<div class="small muted">这个范围里没有要学的课。</div>`;
  const behind=!dirty&&wk.wi>0?(wk.doneN>=wk.planned?`<div class="small" style="color:var(--good)">${IC.check.replace('class="icon"','class="icon" style="width:14px;height:14px;vertical-align:-2px"')} 按计划进行中：前 ${wk.wi} 周应完成 ${wk.planned} 课，已完成 ${wk.doneN} 课</div>`:`<div class="small tt-warn">前 ${wk.wi} 周计划完成 ${wk.planned} 课，目前完成 ${wk.doneN} 课，落后 ${wk.planned-wk.doneN} 课。这周多学一点，或者重新制定计划。</div>`):"";
  const tb=Y.book(p.book);const applied=Y.S.settings.track===p.book&&Y.S.settings.newPerDay===p.npd;
  const details=`<div class="card stack" style="gap:14px">
    <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px"><div class="eyebrow">${dirty?"计划预览（还没保存）":"我的计划 · "+cnDate(saved.created,true)+" 制定"}</div><span class="lvb ${lvClass(p.target)}">目标 ${p.target}</span></div>
    <div class="small">${span}；还要学 <b>${live.lessons}</b> 课，约 <b>${live.words}</b> 个新词、<b>${live.gram}</b> 个语法点。</div>
    ${(live.warn||[]).length?live.warn.map(x=>`<div class="small tt-warn">${esc(x)}</div>`).join(""):""}
    <div class="tt-ptiles"><div><b class="num">${esc(p.npd)}</b><span>每天新词</span></div><div><b class="num">${esc(p.gpd)}</b><span>每天语法点</span></div><div><b class="num">${esc(p.lpw)}</b><span>每周课数</span></div><div><b class="num">${esc(p.mins)}</b><span>每天约分钟</span></div></div>
    <div class="glabel">侧重比例</div>
    <div class="tt-stack" role="img" aria-label="${esc(ord.map(k=>FOCUS_N[k]+fo[k]+"%").join("，"))}">${ord.map(k=>`<i style="--c:var(${cols[k]});flex:${+fo[k]||0} 1 0" data-tt="${esc(FOCUS_N[k]+" "+fo[k]+"%")}"></i>`).join("")}</div>
    <div>${ord.map(k=>`<div class="tt-frow"><i class="tt-sw" style="--c:var(${cols[k]})"></i><b>${FOCUS_N[k]}</b><span class="num">${esc(fo[k])}% · 约 ${Math.max(5,Math.round((+p.mins||0)*(+fo[k]||0)/100/5)*5)} 分钟</span><div class="d">${esc(adv[k])}</div></div>`).join("")}</div>
    ${(live.why||[]).length?`<div class="tt-why">比例依据：${esc(live.why.join("；"))}。</div>`:""}
    <div class="glabel">每周要学的课 · 每周 ${p.lpw} 课</div>
    ${behind}
    <div class="stack" style="gap:8px">${weeksHtml}</div>
    <div class="glabel">每日学习设置</div>
    <div class="small muted">计划推荐：每日新词来自「${esc(tb?tb.lv+" "+tb.t:"")}」，每天 ${p.npd} 个。当前设置：「${esc(Y.trackBook().lv+" "+Y.trackBook().t)}」，每天 ${Y.S.settings.newPerDay} 个。</div>
    <div class="row" style="gap:8px;flex-wrap:wrap">
      ${dirty?`<button class="btn primary grow" data-act="test-psave">${IC.check}保存计划</button>`:""}
      <button class="btn ${dirty?"":"primary"} grow" data-act="test-papply" ${applied?"disabled":""}>${applied?"已应用到每日学习":"一键应用到每日学习"}</button>
      ${saved&&!dirty?`<button class="btn ghost sm" data-act="test-pdel" style="${V.delArm?"background:var(--bad);color:#fff":""}">${V.delArm?"再点一次删除":"删除计划"}</button>`:""}
      ${saved&&dirty?`<button class="btn ghost sm" data-act="test-preset">放弃修改</button>`:""}
    </div></div>`;
  let todayCard="";
  if(saved&&!dirty){const items=todayItems(saved);markHit(saved,items);todayCard=todayHtml(saved,items,true)}
  return `<div class="card row" style="gap:14px"><span class="tt-lvbig ${lvNow?lvClass(lvNow):""}" style="width:56px;height:56px;font-size:18px;border-radius:16px"><small>现在</small>${lvNow||"入门"}</span><div class="grow">${cur}</div></div>
  ${todayCard}
  ${saved&&!dirty?`<details class="adv"><summary><div class="grow"><b>调整目标或考试日期</b><div class="small muted">目标 ${p.target}${p.exam?" · "+cnDate(p.exam)+" 考试":" · 不定日期"}</div></div></summary><div class="in">${inputs}</div></details>`:`<div class="card">${inputs}</div>`}
  ${details}`;
}
function todayHtml(p,items,inOverlay){
  const done=items.filter(x=>x.ok).length,all=items.length;
  const firstTodo=items.find(x=>!x.ok&&x.act);
  return `<div class="card stack" style="gap:10px">
    <div class="row"><div class="grow"><div class="eyebrow">今天的计划 · 目标 ${p.target}${p.exam?" · 距考试 "+Math.max(0,daysBetween(today(),p.exam))+" 天":""}</div><b>${done===all?"今天的计划全部完成了":"已完成 "+done+" / "+all}</b>${p.hit&&Object.keys(p.hit).length?`<div class="small muted">已按计划完成 ${Object.keys(p.hit).length} 天</div>`:""}</div>
      <div style="position:relative;width:48px;height:48px;flex:none">${Y.ring(done/all,48,5,done===all?"var(--good)":"var(--ai)").replace("<svg ",'<svg style="transform:rotate(-90deg)" ')}<span class="num small" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:700">${done}/${all}</span></div></div>
    <ul class="tt-check">${items.map(x=>`<li class="${x.ok?"on":""}"><span class="ck">${IC.check}</span><span class="grow"><span class="t">${esc(x.t)}</span>${x.sub?` <span class="small muted">${esc(x.sub)}</span>`:""}</span>${x.n>1?`<span class="c">${fmtN(x.c)}/${fmtN(x.n)}</span>`:""}${!x.ok&&x.act?`<button class="btn sm" data-act="${x.act}">${esc(x.go)}</button>`:""}</li>`).join("")}</ul>
    ${!inOverlay?`<div class="row" style="gap:8px">${firstTodo?`<button class="btn primary sm grow" data-act="${firstTodo.act}">${IC.play}继续：${esc(firstTodo.go)}</button>`:""}<button class="btn sm ${firstTodo?"":"grow"}" data-act="test-open" data-p="plan">查看计划</button></div>`:""}
  </div>`;
}

/* ============ 首页 / 我的 卡片 ============ */
function homeCard(){
  ensureCss();
  const p=getPlan(),r=latest();
  if(p){const items=todayItems(p);markHit(p,items);return todayHtml(p,items,false)}
  if(r)return `<button class="card row" data-act="test-open" data-p="plan" style="text-align:left;width:100%;gap:12px">${lvTile(r,"width:48px;height:48px;font-size:16px;border-radius:14px")}<div class="grow"><div class="eyebrow">等级自测 · ${cnDate(r.date,true)}</div><b>${esc(recLevelText(r))}</b><div class="small muted">按目标等级和考试日期，制定每天的学习计划</div></div>${IC.go}</button>`;
  if(anyAvail())return `<button class="card row" data-act="test-open" data-p="test" style="text-align:left;width:100%;gap:12px"><span class="tt-ico">${IC.target}</span><div class="grow"><b>测测我的日语等级</b><div class="small muted">N5→N1 逐级测 · 每级 ${PER} 题</div></div>${IC.go}</button>`;
  return `<button class="card row" data-act="test-open" data-p="plan" style="text-align:left;width:100%;gap:12px"><span class="tt-ico">${IC.target}</span><div class="grow"><b>制定学习计划</b><div class="small muted">选目标等级和考试日期，算出每天学多少</div></div>${IC.go}</button>`;
}
function meCard(){
  ensureCss();
  const r=latest(),p=getPlan(),n=recs().length;
  return `<div class="card stack" style="gap:14px">
    <div class="row" style="gap:14px;align-items:center">
      ${r?miniRadar(r,96):`<span class="tt-ico" style="width:56px;height:56px">${IC.chart}</span>`}
      <div class="grow"><div class="eyebrow">等级自测与学习分析</div>
        ${r?`<b style="font-size:18px">${esc(recLevelText(r))}</b><div class="small muted">${cnDate(r.date,true)} 测 · 共 ${n} 次</div><div class="small muted">${SEC.map(x=>x.sh+" "+eqLabel(recEq(r,x.s))).join(" · ")}</div>`:
          `<b style="font-size:17px">看看自己在哪一档</b><div class="small muted">N5–N1 分级自测、学习数据分析图、个人学习计划</div>`}</div></div>
    ${p?`<div class="small" style="padding:8px 12px;border-radius:10px;background:var(--sunk)">计划：目标 <b>${p.target}</b>${p.exam?" · "+cnDate(p.exam,true)+" 考试":""} · 每天 ${p.npd} 词 / ${p.gpd} 语法 · 每周 ${p.lpw} 课</div>`:""}
    <div class="tt-acts">
      <button class="btn ${r?"":"primary"}" data-act="test-open" data-p="test">${IC.target}${r?"自测结果":"开始自测"}</button>
      <button class="btn" data-act="test-open" data-p="ana">${IC.chart}学习分析</button>
      <button class="btn ${r&&!p?"primary":""}" data-act="test-open" data-p="plan">${IC.list}学习计划</button></div></div>`;
}

/* ============ 计划的“去做”动作 ============ */
function leaveOverlay(){if(ours())Y.closeOverlay({silent:true})}
function planWords(){
  const p=getPlan();const due=Y.dueWords().slice(0,30);
  const need=Math.max(0,(p?p.npd:Y.S.settings.newPerDay)-Y.newToday());
  let fresh=[];if(need){const pool=Y.freshPool();const bk=p?p.book:null;const lb=w=>{const l=Y.lesson(w.lid);return l?l.book:""};
    fresh=pool.filter(w=>lb(w)===bk).concat(pool.filter(w=>lb(w)!==bk)).slice(0,need)}
  const list=shuffle(due).concat(fresh);
  if(!list.length){Y.toast("今天没有要背的单词了");return}
  leaveOverlay();Y.startWords(list,"计划 · 今日单词");
}
function planGrammar(){
  const p=getPlan();const seq=planSeq(p?p.books:[Y.trackBook().id]);
  const l=seq.find(x=>!x.pending&&x.grammar.some((_,i)=>!Y.S.grammar[x.id+"-"+i]));
  if(!l){Y.toast("计划范围里的语法都学过了");return}
  leaveOverlay();Y.openLesson(l.id,"grammar");
}

/* ============ 注册 ============ */
/* 首页「接着学」里的一行：有计划时显示今天的进度，没有时邀请自测/制定计划 */
function homeRowTest(){
  if(!Y.homeRow)return "";
  ensureCss();
  const p=getPlan(),r=latest();
  if(p){const items=todayItems(p);markHit(p,items);const done=items.filter(x=>x.ok).length,all=items.length;const ft=items.find(x=>!x.ok);
    return Y.homeRow({act:"test-open",data:{p:"plan"},icon:`<span class="hring">${Y.ring(done/all,40,4,done===all?"var(--good)":"var(--ai)")}<span class="num">${done}/${all}</span></span>`,tone:"bare",
      eyebrow:`今天的计划 · 目标 ${p.target}`,title:done===all?"今天的计划全部完成了":(ft?`下一步：${ft.t}`:`已完成 ${done} / ${all}`),sub:p.exam?`距考试 ${Math.max(0,daysBetween(today(),p.exam))} 天`:""})}
  if(r)return Y.homeRow({act:"test-open",data:{p:"plan"},icon:lvTile(r,"width:40px;height:40px;font-size:14px;border-radius:12px"),tone:"bare",eyebrow:"等级自测",title:recLevelText(r),sub:"按目标制定每天的学习计划"});
  if(anyAvail())return Y.homeRow({act:"test-open",data:{p:"test"},icon:IC.target,tone:"ai",eyebrow:"等级自测",title:"测测我的日语等级",sub:`N5→N1 逐级测 · 每级 ${PER} 题`});
  return Y.homeRow({act:"test-open",data:{p:"plan"},icon:IC.target,tone:"ai",eyebrow:"学习计划",title:"制定学习计划",sub:"选目标等级和考试日期"});
}
Y.registerCard("home-row",homeRowTest,{order:10});
Y.registerCard("me",meCard,{order:10});
Y.registerBadge({id:"test1",k:"測",t:"知己知彼",d:"完成一次等级自测",ok:()=>recs().length>0});
Y.registerBadge({id:"plan7",k:"計",t:"按计划行事",d:"7 天完成当天的学习计划",ok:()=>{const p=getPlan();return !!p&&!!p.hit&&Object.keys(p.hit).length>=7}});
const A=Y.registerAction;
A("test-open",d=>openHub(d.p||"test"));
A("test-tab",d=>{V.tab=d.k==="ana"||d.k==="plan"?d.k:"test";V.delArm=false;if(V.tab!=="plan")V.pd=null;if(V.tab!=="test")V.fresh=null;V.page="hub";draw(true)});
A("test-close",()=>Y.closeOverlay());
A("test-slv",d=>{if(LV.includes(d.k)){V.slv=d.k;draw(false)}});
A("test-begin",()=>startTest(V.slv));
A("test-pick",d=>pick(+d.i));
A("test-next",()=>next());
A("test-play",d=>play(d.slow==="1"));
A("test-quit",()=>quitAsk());
A("test-cont",()=>contLevel());
A("test-end",()=>finishTest());
A("test-ptarget",d=>{if(!LV.includes(d.k))return;planView();V.pd=Object.assign({},V.pd,{target:d.k});draw(false)});
A("test-pdate",d=>{planView();V.pd=Object.assign({},V.pd,{exam:/^\d{4}-\d\d-\d\d$/.test(d.d||"")?d.d:""});draw(false)});
A("test-exam",(d,el)=>{const v=String(el.value||"");planView();
  if(v&&daysBetween(today(),v)<=0){Y.toast("考试日期要在今天之后");el.value=V.pd.exam||"";return}
  V.pd=Object.assign({},V.pd,{exam:/^\d{4}-\d\d-\d\d$/.test(v)?v:""});draw(false)});
A("test-preset",()=>{V.pd=null;draw(false)});
A("test-psave",()=>{
  const pd=V.pd;if(!pd)return;const p=computePlan(pd.target,pd.exam);const old=getPlan();
  Y.S.plan={v:1,target:p.target,from:p.from,exam:p.exam,created:p.created,days:p.days,npd:p.npd,gpd:p.gpd,lpw:p.lpw,mins:p.mins,focus:p.focus,book:p.book,startId:p.startId,books:p.books,hit:old&&old.hit?old.hit:{},ext:""};
  V.pd={target:p.target,exam:p.exam};Y.save();draw(false);Y.toast("计划已保存，首页会显示今天的计划");
});
A("test-papply",()=>{
  const {p}=planView();const S=Y.S;let bk=p.book;
  if(!Y.bookLessons(bk).length){const alt=(p.books||[]).find(id=>Y.bookLessons(id).length&&Y.bookProg(id).p<.999);if(alt)bk=alt;else bk=S.settings.track}
  S.settings.track=bk;S.settings.newPerDay=p.npd;Y.save();draw(false);
  const b=Y.book(bk);Y.toast(`每日新词：「${esc(b?b.t:"")}」· 每天 ${p.npd} 个${bk!==p.book?"（推荐的那册还在编写中）":""}`);
});
A("test-pdel",()=>{if(!V.delArm){V.delArm=true;draw(false);setTimeout(()=>{if(V.delArm){V.delArm=false;if(ours()&&V.tab==="plan")draw(false)}},4000);return}
  V.delArm=false;Y.S.plan=null;V.pd=null;Y.save();draw(false);Y.toast("计划已删除")});
A("test-lesson",d=>{if(!Y.lesson(d.id))return;leaveOverlay();Y.openLesson(d.id)});
A("test-words",()=>planWords());
A("test-gram",()=>planGrammar());
A("test-easy",()=>{leaveOverlay();Y.go("easy")});
A("test-tick",()=>{const p=getPlan();if(!p)return;const t=today();p.ext=p.ext===t?"":t;Y.save();if(ours())draw(false);else Y.render()});

/* 给其他模块用 */
Y.test={open:openHub,start:startTest,latest,history:recs,plan:getPlan,todayItems:()=>{const p=getPlan();return p?todayItems(p):[]},eq:recEq,eqLabel,levelText:recLevelText,computePlan};
})();
