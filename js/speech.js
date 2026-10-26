/* Yume · 语音跟读（js/speech.js）
 * 课程单词行、语法例句、单词练习揭晓卡、会话课台词上的麦克风按钮（data-act="speakcheck"）都打开这里的跟读面板。
 * 三种模式，自动降级：
 *   sr   浏览器语音识别（Web Speech API）→ 和目标比对打分 0–100，逐字标出对错
 *   rec  录音回放对比（MediaRecorder）：识别不可用/连不上谷歌服务时 → 录音、回放、听标准读音、自评
 *   none 连麦克风也用不了（claude.ai 预览、微信、没有权限）→ 中文说明 + 听标准读音 + 跟读自评
 * 导出 Yume.speech = {available, support, open, close, recognize, stop, score, rating, isOpen}
 * 本文件加载时不碰 DOM；样式在第一次打开面板时注入 <style id="yume-speech-css">。
 */
(function(){
"use strict";
const W=typeof window!=="undefined"?window:globalThis;
const Y=W.Yume;if(!Y)return;
const {esc,IC}=Y;
const NAV=W.navigator||{};
const UA=String(NAV.userAgent||"");
const ENV={
  wechat:/MicroMessenger/i.test(UA),
  ios:/iPhone|iPad|iPod/i.test(UA)||(/Macintosh/.test(UA)&&(NAV.maxTouchPoints||0)>1),
  android:/Android/i.test(UA)
};

/* ============ 进度：S.speech 只存很小的字段 ============
 * d 今天日期；h 今天已经奖励过 XP 的目标（短哈希，最多 200 个，第二天清空）；n 打分次数；g 过关次数（70 分以上或自评「会了」） */
Y.registerState("speech",{d:"",h:[],n:0,g:0});
Y.registerBadge({id:"speak10",k:"声",t:"开口说日语",d:"跟读过关 10 次",ok:()=>((Y.S.speech||{}).g||0)>=10});

/* ============ 能力检测 ============ */
const SRClass=()=>W.SpeechRecognition||W.webkitSpeechRecognition||null;
/* 权限策略禁止麦克风（比如嵌在 claude.ai 预览的 iframe 里）时返回 false */
function micPolicy(){
  try{const D=W.document;const fp=D&&(D.permissionsPolicy||D.featurePolicy);if(fp&&typeof fp.allowsFeature==="function")return !!fp.allowsFeature("microphone")}catch(e){}
  return true;
}
function support(){
  const secure=W.isSecureContext!==false;
  const gum=!!(NAV.mediaDevices&&typeof NAV.mediaDevices.getUserMedia==="function");
  const policy=micPolicy();
  const mic=secure&&gum&&policy;
  const rec=mic&&typeof W.MediaRecorder==="function";
  const sr=!!SRClass()&&secure&&policy;
  const tts=Y.tts||{};
  return{sr,rec,mic,secure,policy,gum,tts:!!tts.ok,voice:typeof tts.ja==="function"?!!tts.ja():!!tts.voice,wechat:ENV.wechat,ios:ENV.ios,android:ENV.android};
}
/* 识别连不上（国内安卓 Chrome 常见）后 6 小时内直接用录音模式，面板里可以手动再试 */
const SRFAIL="speech-srfail";
function srFailedRecently(){const f=Y.store.get(SRFAIL,null);return !!(f&&f.t&&Date.now()-f.t<6*36e5)}
function markSRFail(code){Y.store.set(SRFAIL,{t:Date.now(),e:String(code||"")})}
function clearSRFail(){Y.store.del(SRFAIL)}

/* ============ 文字规范化 ============ */
const KJ="\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF々〆〇ヵヶ";
const KJ_RE=new RegExp("["+KJ+"]");
const hasKj=s=>KJ_RE.test(String(s||""));
const KEEP_RE=new RegExp("[\\u3041-\\u3096\\u309D\\u309Eーa-z0-9"+KJ+"]");
const SRC_RE=new RegExp("(["+KJ+"]+)\\[([ぁ-ゖゝゞァ-ヺー・]+)\\]","g");
const KDIG={"〇":"0","零":"0","一":"1","二":"2","三":"3","四":"4","五":"5","六":"6","七":"7","八":"8","九":"9"};
/* NFKC（半角片假名、全角字母数字）→ 片假名转平假名 → 小写 */
function hira(s){
  s=String(s==null?"":s);try{s=s.normalize("NFKC")}catch(e){}
  return s.replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60)).toLowerCase();
}
/* 只留下参与比较的字符（假名、长音、汉字、字母数字），去掉标点空格和「〜」 */
const keep=s=>Array.from(hira(s)).filter(c=>KEEP_RE.test(c)).join("");
const reEsc=s=>s.replace(/[\\^$.*+?()[\]{}|\/]/g,"\\$&");

/* 读音等价：ぢ/じ、づ/ず、を/お 发音相同；长音「ー」和元音、お/う、え/い 只算很小的差别 */
const EQ={"ぢ":"じ","づ":"ず","を":"お"};
const VOWELS="あいうえお";
function subCost(h,t){
  if(h===t)return 0;
  const a=EQ[h]||h,b=EQ[t]||t;if(a===b)return 0;
  if((a==="ー"&&VOWELS.includes(b))||(b==="ー"&&VOWELS.includes(a)))return .2;
  if((a==="う"&&b==="お")||(a==="お"&&b==="う")||(a==="い"&&b==="え")||(a==="え"&&b==="い"))return .4;
  return 1;
}
const OK_COST=.45;
const baseKana=c=>{try{return c.normalize("NFD")[0]}catch(e){return c}};

/* 数字读法（识别结果常把「さん」写成 3）：0–99999999 */
const D1=["","いち","に","さん","よん","ご","ろく","なな","はち","きゅう"];
function under1e4(n){
  let s="";const th=Math.floor(n/1000),hu=Math.floor(n/100)%10,te=Math.floor(n/10)%10,on=n%10;
  if(th)s+=th===1?"せん":th===3?"さんぜん":th===8?"はっせん":D1[th]+"せん";
  if(hu)s+=hu===1?"ひゃく":hu===3?"さんびゃく":hu===6?"ろっぴゃく":hu===8?"はっぴゃく":D1[hu]+"ひゃく";
  if(te)s+=te===1?"じゅう":D1[te]+"じゅう";
  if(on)s+=D1[on];
  return s;
}
function numKana(s){return s.replace(/\d{1,8}/g,m=>{const n=+m;if(!n)return "ぜろ";const man=Math.floor(n/1e4);return (man?under1e4(man)+"まん":"")+under1e4(n%1e4)})}

/* ============ 目标拆成「单位」 ============
 * kana  一个假名/字母（n：比较用的字符）
 * kanji 一串汉字（k：写法，r：读音，可能没有）——比较时既可以按写法对，也可以按读音对
 * punct 标点空格，只显示不比较 */
function toUnits(text){
  const us=[];let run="";
  const flush=()=>{if(run){us.push({k:run,r:null,kind:"kanji"});run=""}};
  for(const c of Array.from(String(text||""))){
    if(KJ_RE.test(c)){run+=c;continue}
    flush();const n=keep(c);
    us.push(n?{k:c,n,kind:"kana"}:{k:c,kind:"punct"});
  }
  flush();return us;
}
/* 「私[わたし]は学生[がくせい]です。」→ 单位 */
function parseSrc(src){
  const us=[];let last=0,m;SRC_RE.lastIndex=0;
  while((m=SRC_RE.exec(src))){us.push(...toUnits(Y.plain(src.slice(last,m.index))));us.push({k:m[1],r:keep(m[2]),kind:"kanji"});last=SRC_RE.lastIndex}
  us.push(...toUnits(Y.plain(src.slice(last))));
  return us;
}
/* 写法 + 假名读音 → 对齐出每串汉字的读音（食べます / たべます → 食=た） */
function alignUnits(ja,kana){
  const us=toUnits(ja);const runs=us.filter(u=>u.kind==="kanji");
  if(!runs.length||!kana)return{units:us,ok:!runs.length};
  const re="^"+us.map(u=>u.kind==="kanji"?"(.+?)":u.kind==="kana"?reEsc(u.n):"").join("")+"$";
  let m=null;try{m=new RegExp(re,"u").exec(keep(kana))}catch(e){}
  if(!m)return{units:us,ok:false};
  runs.forEach((u,i)=>{const g=m[i+1];if(g&&!hasKj(g))u.r=g});
  return{units:us,ok:true};
}

/* 词典：用课程里所有单词做「汉字 → 读音」表，给识别结果里的汉字注音、给没标读音的老例句补读音 */
let DICT=null,DICTN=-1,DMAX=1;
function dict(){
  const ws=typeof Y.allWords==="function"?Y.allWords():[];
  if(DICT&&DICTN===ws.length)return DICT;
  DICT=new Map();DICTN=ws.length;DMAX=1;
  const add=(k,r)=>{if(!k||!r||!hasKj(k)||hasKj(r)||DICT.has(k))return;DICT.set(k,r);DMAX=Math.max(DMAX,Array.from(k).length)};
  for(const w of ws)add(keep(Y.plain(w.ja)),keep(w.kana));
  for(const w of ws){if(!w.kana||!hasKj(w.ja))continue;for(const u of alignUnits(Y.plain(w.ja),w.kana).units)if(u.kind==="kanji"&&u.r&&Array.from(u.k).length>=2)add(keep(u.k),u.r)}
  return DICT;
}
/* 把识别结果里认识的汉字词换成读音（最长匹配）。over：当前目标自己的读音，优先 */
function kanaize(h,over){
  if(!hasKj(h))return h;
  const D=dict();const A=Array.from(h);let out="";
  let max=DMAX;if(over)for(const k of over.keys())max=Math.max(max,Array.from(k).length);
  for(let i=0;i<A.length;){
    let hit=null,L=0;
    for(let l=Math.min(max,A.length-i);l>=1;l--){const s=A.slice(i,i+l).join("");if(!hasKj(s))continue;const r=(over&&over.get(s))||D.get(s);if(r){hit=r;L=l;break}}
    if(hit){out+=hit;i+=L}else{out+=A[i];i++}
  }
  return out;
}
/* 单个汉字的常见读音（从课程单词、例句、练习题、会话台词的注音里统计）。
 * 识别结果里词典没收的汉字（多半是同音字：来ます→着ます、切手→切って），按这些读音展开成假名再比较 */
let KREAD=null,KREADN=-1;
function kread(){
  const ws=typeof Y.allWords==="function"?Y.allWords():[];
  if(KREAD&&KREADN===ws.length)return KREAD;
  const cnt=new Map();
  const add=(k,r)=>{if(!k||!r||Array.from(k).length!==1||!hasKj(k)||hasKj(r))return;let m=cnt.get(k);if(!m)cnt.set(k,m=new Map());m.set(r,(m.get(r)||0)+1)};
  for(const w of ws){if(!w.kana||!hasKj(w.ja))continue;for(const u of alignUnits(Y.plain(w.ja),w.kana).units)if(u.kind==="kanji"&&u.r)add(u.k,u.r)}
  const scan=t=>{if(typeof t!=="string"||t.indexOf("[")<0)return;const re=new RegExp(SRC_RE.source,"g");let m;while((m=re.exec(t)))add(m[1],keep(m[2]))};
  try{for(const l of Y.allLessons()){for(const g of l.grammar)for(const e of g.ex)scan(e[0]);for(const q of l.quiz)scan(q[0])}}catch(e){}
  try{for(const e of Y.easy())for(const ln of (e&&e.lines)||[])if(Array.isArray(ln))scan(ln[1])}catch(e){}
  KREAD=new Map();for(const [k,m] of cnt)KREAD.set(k,[...m.entries()].sort((a,b)=>b[1]-a[1]).map(x=>x[0]).slice(0,4));
  KREADN=ws.length;return KREAD;
}
/* 把剩下的汉字按常见读音展开（目标句里这个字的读音优先），最多 16 种组合 */
function expandKj(s,over){
  let outs=[""];
  for(const c of Array.from(s)){
    if(!hasKj(c)){outs=outs.map(o=>o+c);continue}
    const rs=[];const ov=over&&over.get(c);if(ov)rs.push(ov);
    for(const r of kread().get(c)||[])if(!rs.includes(r))rs.push(r);
    if(!rs.length){outs=outs.map(o=>o+c);continue}
    const nx=[];for(const o of outs)for(const r of rs.slice(0,3)){if(nx.length<16)nx.push(o+r)}
    outs=nx;
  }
  return outs;
}
function variants(raw,t){
  const a=keep(raw);if(!a)return[];
  const b=kanaize(a,t&&t.over);
  const vs=[a,b];if(hasKj(b))vs.push(...expandKj(b,t&&t.over));
  return [...new Set(vs.flatMap(x=>[x,numKana(x)]))].filter(Boolean);
}

/* ============ 打分：目标是一张小图（汉字串有「写法」「读音」两条路），对识别结果做编辑距离 ============ */
function buildDag(units){
  const out=[[]];let cur=0,total=0;const uw={};
  const nn=()=>(out.push([]),out.length-1);
  const chain=(a,paths)=>{
    const mids=paths.map(pa=>pa.cs.slice(1).map(()=>nn()));const b=nn();
    paths.forEach((pa,pi)=>{const ns=[a].concat(mids[pi],[b]);pa.cs.forEach((c,ci)=>out[ns[ci]].push({to:ns[ci+1],c,w:pa.w,ui:pa.ui,p:pa.p,ci}))});
    return b;
  };
  units.forEach((u,ui)=>{
    if(u.kind==="punct")return;
    if(u.kind==="kana"){const cs=Array.from(u.n);if(!cs.length)return;cur=chain(cur,[{cs,w:1,p:"k",ui}]);total+=cs.length;uw[ui]=cs.length;return}
    const K=Array.from(u.k).map(c=>KDIG[c]||hira(c));
    const R=u.r?Array.from(u.r):null;
    const wt=R&&R.length?R.length:K.length;total+=wt;uw[ui]=wt;
    const paths=[{cs:K,w:wt/K.length,p:"j",ui}];
    if(R&&R.length)paths.unshift({cs:R,w:1,p:"r",ui});
    cur=chain(cur,paths);
  });
  return{out,end:cur,total,uw};
}
const INS=1;
function alignDag(g,h){
  const N=g.out.length,M=h.length,C=M+1,INF=1e9;
  const dp=new Float64Array(N*C).fill(INF),bt=new Int8Array(N*C).fill(-1),bu=new Int32Array(N*C),be=new Int32Array(N*C);
  dp[0]=0;
  for(let u=0;u<N;u++){
    const es=g.out[u];
    for(let j=0;j<=M;j++){
      const i=u*C+j;
      if(j>0&&dp[i-1]+INS<dp[i]){dp[i]=dp[i-1]+INS;bt[i]=0;bu[i]=u}
      const d=dp[i];if(d>=INF)continue;
      for(let k=0;k<es.length;k++){const e=es[k];
        if(j<M){const c=d+subCost(h[j],e.c)*e.w,t=e.to*C+j+1;if(c<dp[t]){dp[t]=c;bt[t]=1;bu[t]=u;be[t]=k}}
        const c2=d+e.w,t2=e.to*C+j;if(c2<dp[t2]){dp[t2]=c2;bt[t2]=2;bu[t2]=u;be[t2]=k}
      }
    }
  }
  const ops=[];let v=g.end,j=M,ins=0,guard=N*C+5;
  while((v!==0||j!==0)&&guard-->0){
    const i=v*C+j,t=bt[i];
    if(t===0){ins++;j--;continue}
    if(t<0)break;
    const e=g.out[bu[i]][be[i]];
    if(t===1){ops.push({e,c:subCost(h[j-1],e.c),h:h[j-1]});j--}
    else ops.push({e,c:1,h:null});
    v=bu[i];
  }
  ops.reverse();
  return{dist:dp[g.end*C+M],ops,ins};
}
/* 「词」：两拍以上的汉字词、一拍汉字 + 后面的送假名（借り / 買い）、两个以上片假名连写（パン）。
 * 一个词读错一大半，多半是说成了别的词（学生→先生、おばあさん→おばさん），不能靠其余部分拿高分 */
const PARTICLE="はがをにでともへのやかよねな";
function wordGroups(units,uw){
  const gs=[];
  for(let i=0;i<units.length;i++){
    const u=units[i];
    if(u.kind==="kanji"){
      if((uw[i]||0)>=2)gs.push([i]);
      else{const nx=units[i+1];if(nx&&nx.kind==="kana"&&/^[ぁ-ゖ]$/.test(nx.k)&&!PARTICLE.includes(nx.k))gs.push([i,i+1])}
      continue;
    }
    if(u.kind==="kana"&&/^[ァ-ヺー]$/.test(u.k)){let j=i;while(j<units.length&&units[j].kind==="kana"&&/^[ァ-ヺー]$/.test(units[j].k))j++;if(j-i>=2)gs.push(Array.from({length:j-i},(_,k)=>i+k));i=j-1}
  }
  return gs;
}
const WRONG_CAP=65,WORD_CAP=69;
function evalUnits(units,h,isWord){
  const g=buildDag(units);if(!g.total)return null;
  const r=alignDag(g,h);let okW=0,errs=0;const cred={};
  for(const o of r.ops){const c=o.h!=null?o.e.w*(1-Math.min(1,o.c)):0;okW+=c;cred[o.e.ui]=(cred[o.e.ui]||0)+c;if(o.h==null||o.c>OK_COST)errs++}
  /* 读错的词整词不给分，并且总分封顶 65（「再练练」） */
  let wrong=0;
  for(const gr of wordGroups(units,g.uw)){let c=0,w=0;for(const ui of gr){c+=cred[ui]||0;w+=g.uw[ui]||0}if(w&&c/w<.75){okW-=c;wrong++}}
  let sc=Math.max(0,Math.min(100,Math.round(100*okW/(g.total+.6*r.ins))));
  if(wrong)sc=Math.min(sc,WRONG_CAP);
  /* 单词练习：三拍以上的词只要有一个音读错 / 漏读，就不算过关（おばさん≠おばあさん） */
  else if(isWord&&errs&&g.total>=3)sc=Math.min(sc,WORD_CAP);
  return{score:sc,ops:r.ops,ins:r.ins,units,total:g.total,dist:r.dist,wrong};
}

/* 目标对象：{ja,kana,zh,key,src?} → 拆好单位、显示用的带读音文本 */
function mkTarget(d){
  if(d&&d.units&&d.over)return d;
  d=d||{};
  let ja=String(d.ja||"").trim(),kana=String(d.kana||"").trim(),src=String(d.src||"").trim();
  const w=d.key&&typeof Y.word==="function"?Y.word(d.key):null;
  if(!src&&/\[[ぁ-ゖゝゞァ-ヺー・]+\]/.test(ja))src=ja;
  if(src){ja=Y.plain(src);if(!kana)kana=Y.reading(src)}
  if(w){if(!ja)ja=Y.plain(w.ja);if(!kana)kana=w.kana||""}
  if(!ja)ja=kana;
  let units,ok=true;
  if(src)units=parseSrc(src);else({units,ok}=alignUnits(ja,kana));
  let D=null;try{D=dict()}catch(e){}
  if(D)for(const u of units)if(u.kind==="kanji"&&!u.r){const r=D.get(keep(u.k));if(r)u.r=r}
  const kk=keep(kana),kj=keep(ja);
  const kanaUnits=kana&&!ok&&kk&&kk!==kj?toUnits(kana):null;
  const over=new Map();for(const u of units)if(u.kind==="kanji"&&u.r)over.set(keep(u.k),u.r);
  /* 课程单词（有 key）算单词；其他短于 7 个字且没有标点的也算单词，其余按句子处理 */
  const isWord=!!w||(!/[、。，,.！!？?\s　]/.test(ja)&&Array.from(ja).length<=6);
  const disp=src||units.map(u=>u.kind==="kanji"&&u.r&&/^[ぁ-ゖゝゞー]+$/.test(u.r)?u.k+"["+u.r+"]":u.k).join("");
  const showKana=!!kana&&!hasKj(kana)&&kk!==kj;
  return{ja,kana,zh:String(d.zh||""),key:String(d.key||""),pos:w?w.pos:String(d.pos||""),units,kanaUnits,over,isWord,disp,showKana,
    id:d.key?String(d.key):"s"+(kj||kk)};
}

/* score(target, heard) → {score 0–100, heard 采用的识别结果, alts, marks 逐字状态, ins 多读的音数, tips, rating}
 * target：带读音的字符串「食[た]べます」或 {ja,kana} ；heard：字符串或候选数组（全部比较，取最高分） */
function score(target,heard){
  const t=mkTarget(typeof target==="string"?{ja:target}:target);
  const alts=(Array.isArray(heard)?heard:[heard]).map(x=>String(x==null?"":x)).filter(x=>x.trim()).slice(0,12);
  const tgts=[t.units];if(t.kanaUnits)tgts.push(t.kanaUnits);
  let best=null;
  alts.forEach((raw,ai)=>{
    for(const v of variants(raw,t)){
      const h=Array.from(v).map(c=>KDIG[c]||c);
      for(const us of tgts){const r=evalUnits(us,h,t.isWord);if(r&&(!best||r.score>best.score||(r.score===best.score&&r.dist<best.dist))){best=r;best.heard=raw;best.alt=ai}}
    }
  });
  if(!best){const r=evalUnits(t.units,[],t.isWord)||{score:0,ops:[],ins:0,units:t.units,total:0};best=Object.assign(r,{heard:"",alt:-1})}
  return{score:best.score,heard:best.heard,alt:best.alt,alts,ins:best.ins,marks:marksOf(best),tips:tipsOf(best),rating:rating(best.score,best.wrong),wrong:best.wrong||0,target:t};
}
function marksOf(res){
  const m=res.units.map(u=>({u,p:null,st:[],s:""}));
  for(const o of res.ops){const x=m[o.e.ui];if(!x)continue;x.p=o.e.p;x.st[o.e.ci]=o.h==null?"miss":o.c<=OK_COST?"ok":"bad"}
  for(const x of m){
    if(x.u.kind==="punct")continue;
    const a=x.st.filter(Boolean);if(!a.length)continue;
    const ok=a.filter(s=>s==="ok").length;
    x.s=ok===a.length?"ok":a.every(s=>s==="miss")?"miss":ok/a.length>=.5?"part":"bad";
  }
  return m;
}
const TIPS={
  word:"有的词读成了别的词（标红的地方），意思就变了。先听标准读音，再一个词一个词读准。",
  sokuon:"促音「っ」要停顿一拍：「きって」是「き・っ・て」三拍。",
  long:"长音要拉够两拍：「ー」「おう」「えい」「いい」都不能读短。",
  n:"拨音「ん」自己也占一拍，别吞掉。",
  yoon:"拗音「きゃ・しゅ・ちょ」只占一拍，两个假名要连起来读。",
  daku:"注意清音和浊音：「か/が」「た/だ」「は/ば/ぱ」读音不一样。",
  extra:"多读了一些音，读完目标就停下来。",
  gen:"标红的音没读准，先点「听标准读音」，再慢慢跟读。"
};
function tipsOf(res){
  const T=[];const add=k=>{if(!T.includes(k))T.push(k)};
  if(res.wrong)add("word");
  res.ops.forEach((o,i)=>{
    if(o.h!=null&&o.c<=OK_COST)return;
    const c=o.e.c,prev=i>0&&res.ops[i-1].e.p===o.e.p?res.ops[i-1].e.c:"";
    if(c==="っ")add("sokuon");
    else if(c==="ん")add("n");
    else if(c==="ー"||(c==="う"&&/[おこそとのほもよろごぞどぼぽょうくすつぬふむゆるぐずづぶぷゅ]/.test(prev))||(c==="い"&&/[えけせてねへめれげぜでべぺい]/.test(prev)))add("long");
    else if("ゃゅょ".includes(c))add("yoon");
    if(o.h&&o.h!==c&&KJ_RE.test(c)===false&&baseKana(o.h)===baseKana(c))add("daku");
  });
  if(res.ins>=3)add("extra");
  if(!T.length&&res.score<70&&res.ops.length)add("gen");
  return T.slice(0,2).map(k=>TIPS[k]);
}
const ENC={
  perfect:["发音很标准，继续保持！","和标准读音几乎一样！","完美！日本人一听就懂。"],
  good:["很接近了，注意标红的音。","不错！再读一遍争取满分。","整体很好，个别音再练练。"],
  fair:["先听一遍标准读音，再慢慢读。","放慢速度，一个音一个音读清楚。","别急，多读几遍就顺了。"],
  low:["没听清，离手机近一点、大声读一次。","可以先点「慢速」听一遍再跟读。","周围太吵也会影响识别，换个安静的地方试试。"],
  word:["别急，听一遍标准读音再读。","慢一点，一个词一个词读准。"]
};
function rating(s,wrong){
  s=+s||0;
  if(wrong&&s<70){const r={k:"word",t:"读错词了",cls:"gold",color:"var(--gold)"};const l=ENC.word;r.msg=l[Math.floor(Math.random()*l.length)];return r}
  const r=s>=90?{k:"perfect",t:"完美",cls:"ok",color:"var(--good)"}:s>=70?{k:"good",t:"不错",cls:"ai",color:"var(--ai)"}:s>=50?{k:"fair",t:"再练练",cls:"gold",color:"var(--gold)"}:{k:"low",t:"没听清",cls:"bad",color:"var(--bad)"};
  const l=ENC[r.k];r.msg=l[Math.floor(Math.random()*l.length)];return r;
}

/* ============ 语音识别 ============ */
const SR_ERR={
  "no-speech":"没听到声音。点麦克风后请马上开口读，离手机近一点。",
  "audio-capture":"没找到麦克风，或者麦克风正被别的程序占用。",
  "not-allowed":"麦克风权限被拒绝了。",
  "service-not-allowed":"语音识别服务没有开启。",
  "network":"语音识别要连接的服务器连不上（安卓 / 电脑版 Chrome 的识别用的是谷歌服务，在国内通常需要 VPN）。",
  "language-not-supported":"这个浏览器的语音识别不支持日语。",
  "unsupported":"这个浏览器不支持语音识别。",
  "timeout":"语音识别一直没有响应。",
  "start":"语音识别启动失败，请再点一次。",
  "aborted":"已停止。"
};
let REC=null;
/* recognize({maxMs,onInterim(text),onStart}) → Promise<{ok,alts:[候选],text} | {ok:false,error,msg}>
 * 必须在点击事件里同步调用（Safari 要求）。同一时间只有一个识别。 */
function recognize(o){
  o=o||{};
  return new Promise(resolve=>{
    const C=SRClass();
    if(!C){resolve({ok:false,error:"unsupported",msg:SR_ERR.unsupported});return}
    stopRecognize(true);
    let rec;try{rec=new C()}catch(e){resolve({ok:false,error:"unsupported",msg:SR_ERR.unsupported});return}
    try{rec.lang="ja-JP";rec.interimResults=true;rec.maxAlternatives=5;rec.continuous=false}catch(e){}
    const st={rec,segs:[],err:null,done:false,t1:null,t2:null};REC=st;
    const maxMs=Math.max(2000,o.maxMs||8000);
    const finish=r=>{if(st.done)return;st.done=true;clearTimeout(st.t1);clearTimeout(st.t2);if(REC===st)REC=null;
      try{rec.onresult=rec.onerror=rec.onend=rec.onstart=null}catch(e){}resolve(r)};
    const outcome=()=>{const alts=combine(st.segs);
      if(alts.length)return{ok:true,alts,text:alts[0]};
      const code=st.err||"no-speech";return{ok:false,error:code,msg:SR_ERR[code]||("语音识别出错（"+code+"）")}};
    rec.onstart=()=>{if(o.onStart)try{o.onStart()}catch(e){}};
    rec.onresult=e=>{
      const segs=[];const rs=e.results||[];
      for(let i=0;i<rs.length;i++){const r=rs[i];const alts=[];for(let k=0;k<r.length;k++){const tr=r[k]&&r[k].transcript;if(tr)alts.push(String(tr))}if(alts.length)segs.push(alts)}
      st.segs=segs;
      if(o.onInterim)try{o.onInterim(segs.map(s=>s[0]).join(""))}catch(err){}
    };
    rec.onerror=e=>{st.err=(e&&e.error)||"unknown"};
    rec.onend=()=>finish(outcome());
    try{rec.start()}catch(e){finish({ok:false,error:"start",msg:SR_ERR.start});return}
    st.t1=setTimeout(()=>{try{rec.stop()}catch(e){}},maxMs);
    st.t2=setTimeout(()=>{try{rec.abort()}catch(e){}if(!st.segs.length&&!st.err)st.err="timeout";finish(outcome())},maxMs+6000);
  });
}
/* 候选：每段的第一候选拼起来；再把某一段换成它的其他候选 */
function combine(segs){
  if(!segs.length)return[];
  const main=segs.map(s=>s[0]);const out=[main.join("")];
  segs.forEach((s,i)=>{for(let k=1;k<s.length;k++){const x=main.slice();x[i]=s[k];out.push(x.join(""))}});
  return [...new Set(out.map(x=>x.trim()).filter(Boolean))].slice(0,12);
}
/* abort=true 时直接放弃；否则停止收音并等待最终结果 */
function stopRecognize(abort){if(REC){try{abort?REC.rec.abort():REC.rec.stop()}catch(e){}}}

/* ============ 面板状态 ============ */
let P=null;           // 当前面板
let seq=0;
let layerEl=null;     // 叠加层（已经有学习会话覆盖层时用）
let keyBound=false;
const STOP='<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>';
const $=id=>W.document.getElementById(id);

function maxListen(t){return t.isWord?6000:Math.min(15000,4000+Array.from(t.ja).length*350)}
function maxRecord(t){return t.isWord?5000:Math.min(15000,3500+Array.from(t.ja).length*350)}
function initialMode(sp){
  if(sp.sr&&!srFailedRecently())return{mode:"sr"};
  if(sp.rec)return{mode:"rec",note:sp.sr?{t:"上次语音识别连不上，先用录音对比",d:"你的网络连不上这个浏览器的识别服务，所以先用「录音回放对比」。网络换好了（比如开了 VPN）可以点下面再试。",acts:[["sp-trysr","再试语音识别"]]}:null};
  return{mode:"none",reason:noneReason(sp)};
}
function noneReason(sp){
  if(sp.wechat)return "wechat";
  if(!sp.policy)return "policy";
  if(!sp.secure)return "insecure";
  if(!sp.gum)return "nogum";
  if(!sp.rec)return "norec";
  return "nosr";
}
const NONE={
  wechat:["微信里用不了麦克风","微信内置浏览器不支持语音识别和网页录音。请点右上角「···」，选「在浏览器打开」，再用跟读功能。"],
  policy:["这个窗口不允许使用麦克风","网页被嵌在别的页面里（比如 claude.ai 的预览窗口），麦克风被禁用了。请把网站在浏览器里单独打开再试。"],
  insecure:["需要 https 网址","浏览器只允许 https 网址使用麦克风，请用 https 开头的网址打开本站。"],
  nogum:["这个浏览器不能录音","这个浏览器不支持网页录音和语音识别。建议换用 iPhone 的 Safari，或者电脑 / 安卓上的 Chrome、Edge。"],
  norec:["这个浏览器不能录音","这个浏览器不支持网页录音（MediaRecorder），语音识别也用不了。建议换用 iPhone 的 Safari，或者较新的 Chrome、Edge。"],
  nosr:["语音识别和录音都用不了","可以先听标准读音，跟着大声读几遍，然后自己评一下。"],
  denied:["麦克风权限被拒绝了","请允许本网站使用麦克风：电脑点地址栏左边的锁形图标 → 麦克风 → 允许；iPhone 到「设置 → Safari → 麦克风」；安卓在浏览器的「网站设置」里打开。改好后点「重试」。"],
  nomic:["没找到麦克风","请检查麦克风或耳机有没有接好、有没有被别的程序占用，然后点「重试」。"]
};

/* ============ 打开 / 关闭 ============ */
function open(d,trigger){
  if(!Y.booted||!W.document)return;
  const own=!!P&&P.layer==="overlay";
  if(P)cleanup();
  injectCSS();
  const t=mkTarget(d);
  if(!t.ja&&!t.kana){Y.toast("没有可以跟读的内容");return}
  const sp=support();const im=initialMode(sp);
  P={id:++seq,t,sp,mode:im.mode,reason:im.reason||"",note:im.note||null,phase:"idle",interim:"",res:null,best:0,tries:0,
     self:null,xp:0,rec:null,playing:null,layer:!own&&Y.overlayOpen()?"stack":"overlay",trigger:trigger||null};
  if(P.layer==="overlay"){
    Y.openOverlay(`<div class="sin sp-in" role="dialog" aria-modal="true" aria-label="跟读练习">${hPanel()}</div>`,{onKey:keyHandler,onClose:cleanup,rerender:paint});
  }else{
    layerEl=W.document.createElement("div");layerEl.className="sp-layer";
    layerEl.innerHTML=`<div class="sp-backdrop" data-act="sp-close"></div><div class="sp-sheet" role="dialog" aria-modal="true" aria-label="跟读练习">${hPanel()}</div>`;
    W.document.body.appendChild(layerEl);
    const se=Y.overlayEl&&Y.overlayEl();if(se){try{se.inert=true}catch(e){}se.setAttribute("aria-hidden","true")}
    if(!keyBound){W.addEventListener("keydown",capKey,true);keyBound=true}
  }
  focusMain();
  if(Y.S.settings.autoSpeak!==false&&sp.voice)setTimeout(()=>{if(P&&P.phase==="idle")speakStd(false)},250);
}
function close(){
  if(!P)return;
  if(P.layer==="overlay"&&Y.overlayOpen())Y.closeOverlay();   // 会调用 onClose → cleanup
  else cleanup();
}
function cleanup(){
  const p=P;if(!p)return;P=null;
  stopRecognize(true);stopRecording(p,true);stopAudio();Y.stopSpeak();
  if(p.rec&&p.rec.url)try{URL.revokeObjectURL(p.rec.url)}catch(e){}
  if(p.layer==="stack"){
    if(layerEl&&layerEl.parentNode)layerEl.parentNode.removeChild(layerEl);layerEl=null;
    const se=Y.overlayEl&&Y.overlayEl();if(se){try{se.inert=false}catch(e){}se.removeAttribute("aria-hidden")}
    if(p.trigger&&p.trigger.isConnected)try{p.trigger.focus({preventScroll:true})}catch(e){}
  }
}
/* 重画面板（保留滚动位置与焦点） */
function paint(){
  if(!P||!W.document)return;
  const ae=W.document.activeElement;
  const fsel=ae&&ae.dataset&&ae.dataset.act?`[data-act="${ae.dataset.act}"]${ae.dataset.ok!=null?`[data-ok="${ae.dataset.ok}"]`:""}${ae.dataset.slow!=null?`[data-slow="${ae.dataset.slow}"]`:""}`:null;
  let box=null;
  if(P.layer==="overlay"){if(!Y.overlayOpen())return;const el=Y.overlayEl();box=el&&el.querySelector(".sp-in");if(!box){Y.updateOverlay(`<div class="sin sp-in" role="dialog" aria-modal="true" aria-label="跟读练习">${hPanel()}</div>`);return}}
  else box=layerEl&&layerEl.querySelector(".sp-sheet");
  if(!box)return;
  box.innerHTML=hPanel();
  if(fsel){const f=box.querySelector(fsel);if(f)try{f.focus({preventScroll:true})}catch(e){}}
}
function focusMain(){const r=P&&(P.layer==="overlay"?Y.overlayEl():layerEl);const b=r&&(r.querySelector(".sp-mic")||r.querySelector("[data-act=sp-std]"));if(b)try{b.focus({preventScroll:true})}catch(e){}}

/* 按键：Esc 关闭；空格/回车（焦点不在按钮上时）= 麦克风；L = 听标准读音 */
function keyHandler(e){
  if(!P)return false;
  if(e.key==="Escape"){if(e.preventDefault)e.preventDefault();close();return true}
  const tg=e.target&&e.target.tagName||"";
  if(/^(BUTTON|A|INPUT|TEXTAREA|SELECT|SUMMARY)$/.test(tg))return false;
  if(e.key===" "||e.key==="Enter"){if(e.preventDefault)e.preventDefault();mainAction();return true}
  if(e.key==="l"||e.key==="L"){speakStd(false);return true}
  return false;
}
/* 叠加在学习会话上时：抢在 core 之前处理按键，不让底下的会话收到 */
function capKey(e){
  if(!P||P.layer!=="stack")return;
  const c=$("cele");if(c&&!c.hidden)return;
  keyHandler(e);e.stopPropagation();
}
function mainAction(){if(!P)return;if(P.mode==="sr")micSR();else if(P.mode==="rec")recToggle();else speakStd(false)}

/* ============ 标准读音 / 回放 ============ */
function speakStd(slow){
  if(!P)return Promise.resolve(false);
  stopAudio();
  const t=P.t;const txt=t.isWord&&t.kana&&!hasKj(t.kana)?t.kana:(t.disp||t.ja);
  if(!Y.tts||!Y.tts.ok){Y.toast("这个浏览器不能朗读");return Promise.resolve(false)}
  return Y.speak(txt,{rate:slow?.6:.9});
}
let AUD=null,playTok=0;
function stopAudio(){playTok++;if(AUD){try{AUD.pause()}catch(e){}AUD=null}}
function playMine(){
  return new Promise(res=>{
    if(!P||!P.rec||!P.rec.url){res(false);return}
    if(AUD){try{AUD.pause()}catch(e){}}
    let a;try{a=new W.Audio(P.rec.url)}catch(e){res(false);return}
    AUD=a;let done=false;const fin=v=>{if(done)return;done=true;res(v)};
    a.onended=()=>fin(true);a.onerror=()=>fin(false);
    const p=a.play();if(p&&p.catch)p.catch(()=>fin(false));
    setTimeout(()=>fin(true),(P&&P.rec&&P.rec.dur||8000)+2500);
  });
}
async function compare(){
  if(!P||!P.rec||!P.rec.url)return;
  Y.stopSpeak();const tok=++playTok;const my=P;
  setPlaying("mine");const ok=await playMine();
  if(P!==my||tok!==playTok)return;
  if(!ok){setPlaying(null);P.recMsg="自动播放被浏览器拦住了，请点「我的录音」手动播放。";paint();return}
  await new Promise(r=>setTimeout(r,350));if(P!==my||tok!==playTok)return;
  setPlaying("std");await speakStd(false);
  if(P===my&&tok===playTok)setPlaying(null);
}
function setPlaying(k){if(!P)return;P.playing=k;paint()}

/* ============ 识别模式 ============ */
function micSR(){
  if(!P)return;
  if(P.phase==="listening"){stopRecognize(false);P.phase="processing";paint();return}
  if(P.phase==="processing")return;
  Y.stopSpeak();stopAudio();
  const my=P;P.phase="listening";P.interim="";P.note=null;P.err=null;paint();
  recognize({maxMs:maxListen(P.t),
    onInterim:txt=>{if(P!==my)return;P.interim=txt;const el=$("sp-interim");if(el)el.textContent=txt}
  }).then(r=>{
    if(P!==my)return;
    if(r.ok){
      const res=score(P.t,r.alts);P.res=res;P.tries++;P.best=Math.max(P.best,res.score);P.phase="result";P.interim="";
      P.xp=award(res.score,res.score>=70);clearSRFail();paint();
      return;
    }
    srError(r);
  });
}
function srError(r){
  const code=r.error;P.interim="";
  if(code==="aborted"){P.phase="idle";paint();return}
  if(code==="no-speech"){P.phase="error";P.err={t:"没听到声音",d:"点麦克风后请马上开口读，离手机近一点；周围太吵也会听不清。"};paint();return}
  if(code==="audio-capture"){P.phase="error";P.err={t:"没找到麦克风",d:SR_ERR["audio-capture"]};paint();return}
  if(code==="not-allowed"){P.mode="none";P.reason=P.sp.policy?"denied":"policy";P.phase="idle";paint();return}
  /* network / service-not-allowed / language-not-supported / timeout / start / 其他：自动改用录音对比 */
  markSRFail(code);
  const why=code==="service-not-allowed"&&ENV.ios?"iPhone 的语音识别需要打开听写：设置 → 通用 → 键盘 → 启用听写。":(SR_ERR[code]||r.msg||"语音识别出错了。");
  if(P.sp.rec){P.mode="rec";P.phase="idle";P.note={t:"语音识别用不了，已改用录音对比",d:why+"现在可以录下自己的发音，和标准读音对比着听。",acts:[["sp-trysr","再试语音识别"]]}}
  else{P.mode="none";P.reason="nosr";P.phase="idle";P.note={t:"语音识别用不了",d:why,acts:[]}}
  paint();focusMain();
}

/* ============ 录音模式 ============ */
function pickMime(){
  const MR=W.MediaRecorder;if(!MR||typeof MR.isTypeSupported!=="function")return "";
  for(const m of ["audio/webm;codecs=opus","audio/webm","audio/mp4","audio/ogg;codecs=opus","audio/aac"])try{if(MR.isTypeSupported(m))return m}catch(e){}
  return "";
}
function recToggle(){
  if(!P)return;
  if(P.phase==="recording"){stopRecording(P,false);return}
  if(P.phase==="starting")return;
  startRec();
}
async function startRec(){
  const my=P;Y.stopSpeak();stopAudio();
  if(my.rec&&my.rec.url){try{URL.revokeObjectURL(my.rec.url)}catch(e){}}
  my.rec={url:null,dur:0,max:0,ac:null,stream:null,mr:null,t0:0,timer:null,raf:0};my.phase="starting";my.self=null;my.recMsg="";my.note=null;my.err=null;paint();
  /* AudioContext 要在点击里创建（iOS），之后接上音量表 */
  const AC=W.AudioContext||W.webkitAudioContext;if(AC)try{my.rec.ac=new AC()}catch(e){}
  let stream;
  try{stream=await NAV.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}})}
  catch(e){
    closeAC(my.rec);if(P!==my||my.mode!=="rec"||my.phase!=="starting")return;
    const n=e&&e.name||"";
    P.mode="none";P.phase="idle";
    P.reason=n==="NotAllowedError"||n==="PermissionDeniedError"?(P.sp.policy?"denied":"policy"):n==="NotFoundError"||n==="DevicesNotFoundError"||n==="NotReadableError"?"nomic":n==="SecurityError"?"policy":"nogum";
    paint();return;
  }
  /* 等授权期间用户可能关了面板、或改成了语音识别：这时不再开始录音 */
  if(P!==my||my.mode!=="rec"||my.phase!=="starting"){stream.getTracks().forEach(t=>t.stop());closeAC(my.rec);return}
  const mime=pickMime();let mr;
  try{mr=mime?new W.MediaRecorder(stream,{mimeType:mime}):new W.MediaRecorder(stream)}
  catch(e){try{mr=new W.MediaRecorder(stream)}catch(e2){stream.getTracks().forEach(t=>t.stop());closeAC(my.rec);P.mode="none";P.reason="norec";P.phase="idle";paint();return}}
  const R=my.rec;R.stream=stream;R.mr=mr;const chunks=[];
  mr.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data)};
  mr.onstop=()=>{
    R.dur=Date.now()-R.t0;stopStream(R);
    if(P!==my)return;
    const blob=new Blob(chunks,{type:mr.mimeType||mime||"audio/webm"});
    if(!blob.size){P.phase="idle";P.err={t:"没录到声音",d:"录音是空的，请检查麦克风后再试一次。"};paint();return}
    R.url=URL.createObjectURL(blob);P.phase="recorded";P.tries++;
    P.recMsg=R.max<.02?"好像几乎没有声音，检查一下麦克风有没有被静音。":"";
    paint();compare();
  };
  mr.onerror=()=>{stopStream(R);if(P!==my)return;P.phase="idle";P.err={t:"录音出错了",d:"请再试一次；如果一直不行，换个浏览器试试。"};paint()};
  try{mr.start()}catch(e){stopStream(R);P.phase="idle";P.err={t:"录音启动失败",d:"请再点一次麦克风。"};paint();return}
  R.t0=Date.now();my.phase="recording";paint();
  meter(R);
  const lim=maxRecord(my.t);
  R.timer=setInterval(()=>{
    if(P!==my){clearInterval(R.timer);return}
    const el=Date.now()-R.t0;const pr=$("sp-recprog");if(pr)pr.style.width=Math.min(100,el/lim*100)+"%";
    const tx=$("sp-rectime");if(tx)tx.textContent=(el/1000).toFixed(1)+" 秒";
    if(el>=lim)stopRecording(my,false);
  },100);
}
function meter(R){
  const ac=R.ac;if(!ac||!R.stream)return;
  try{
    if(ac.state==="suspended"&&ac.resume)ac.resume().catch(()=>{});
    const src=ac.createMediaStreamSource(R.stream);const an=ac.createAnalyser();an.fftSize=512;src.connect(an);
    const buf=new Uint8Array(an.fftSize);
    const tick=()=>{
      if(!R.mr||R.mr.state==="inactive")return;
      an.getByteTimeDomainData(buf);let s=0;for(let i=0;i<buf.length;i++){const v=(buf[i]-128)/128;s+=v*v}
      const rms=Math.sqrt(s/buf.length);R.max=Math.max(R.max,rms);
      const b=W.document.querySelector(".sp-mic.on");if(b)b.style.setProperty("--lvl",(1+Math.min(1,rms*5)*.45).toFixed(3));
      R.raf=W.requestAnimationFrame(tick);
    };
    tick();
  }catch(e){R.max=1}
}
function stopRecording(p,silent){
  const R=p&&p.rec;if(!R)return;
  clearInterval(R.timer);if(R.raf)try{W.cancelAnimationFrame(R.raf)}catch(e){}
  if(R.mr&&R.mr.state!=="inactive"){if(silent){R.mr.ondataavailable=null;R.mr.onstop=()=>stopStream(R)}try{R.mr.stop()}catch(e){stopStream(R)}}
  else stopStream(R);
}
function stopStream(R){if(R.stream){R.stream.getTracks().forEach(t=>{try{t.stop()}catch(e){}});R.stream=null}closeAC(R)}
function closeAC(R){if(R&&R.ac){try{R.ac.close()}catch(e){}R.ac=null}}

/* ============ 自评与奖励 ============ */
const hid=s=>{let h=2166136261;for(const c of String(s)){h^=c.codePointAt(0);h=Math.imul(h,16777619)>>>0}return h.toString(36)};
/* 70 分以上 +2、90 分以上 +3、自评「会了」+1；同一个词/句子每天只奖励一次 */
function award(sc,pass,self){
  const S=Y.S;if(!S.speech||typeof S.speech!=="object")S.speech={d:"",h:[],n:0,g:0};
  const sp=S.speech;const td=Y.today();
  if(sp.d!==td||!Array.isArray(sp.h)){sp.d=td;sp.h=[]}
  if(!self)sp.n=(sp.n||0)+1;
  if(pass)sp.g=(sp.g||0)+1;
  const gain=self?(pass?1:0):sc>=90?3:sc>=70?2:0;
  let xp=0;const id=hid(P?P.t.id:"");
  if(gain&&!sp.h.includes(id)&&sp.h.length<200){sp.h.push(id);xp=gain;Y.addXP(gain)}
  Y.checkBadges();Y.save();
  return xp;
}
function awardedToday(){const sp=Y.S.speech;return !!(P&&sp&&sp.d===Y.today()&&Array.isArray(sp.h)&&sp.h.includes(hid(P.t.id)))}
function selfAssess(ok){
  if(!P)return;
  P.self=ok?"ok":"no";
  P.xp=ok?award(0,true,true):0;
  paint();
  if(!ok)setTimeout(()=>{if(P&&P.self==="no")speakStd(true)},200);
}

/* ============ 界面 HTML ============ */
function hPanel(){
  const t=P.t;
  const modeChip=P.mode==="sr"?"语音打分":P.mode==="rec"?"录音对比":"听读自评";
  return `<div class="sp-head"><button class="iconbtn" data-act="sp-close" aria-label="关闭（Esc）">${IC.close}</button><div class="sp-title">跟读练习</div><span class="chip ai">${IC.mic.replace('class="icon"','class="icon" style="width:14px;height:14px"')}${modeChip}</span></div>
  ${hTarget(t)}
  ${P.note?hNote(P.note,""):""}
  ${P.mode==="sr"?hSR():P.mode==="rec"?hRec():hNone()}
  ${hHelp()}`;
}
function hTarget(t){
  const res=P.res&&P.mode==="sr"&&P.phase==="result"?P.res:null;
  const main=res?hMarks(res.marks):Y.ruby(t.disp);
  const voice=P.sp.voice;
  return `<div class="card sp-tgt">
    <div class="eyebrow">${res?"逐字对照":"读出下面的"+(t.isWord?"单词":"句子")}</div>
    <div class="sp-ja ${t.isWord?"w":"s"} jr" lang="ja">${main}</div>
    ${res?`<div class="sp-legend"><span><i class="sp-dot ok"></i>读对</span><span><i class="sp-dot bad"></i>读错</span><span><i class="sp-dot miss"></i>漏读</span>${res.ins?`<span>多读了 <b class="num">${res.ins}</b> 个音</span>`:""}</div>`:""}
    ${t.showKana?`<div class="sp-kana" lang="ja"><span class="small muted">读音</span> ${esc(t.kana)}</div>`:""}
    ${t.zh||t.pos?`<div class="sp-zh">${t.pos?Y.posTag(t.pos)+" ":""}${esc(t.zh)}</div>`:""}
    <div class="sp-listen">
      <button class="btn sm ${P.playing==="std"?"primary":""}" data-act="sp-std">${IC.spk}听标准读音</button>
      <button class="btn sm" data-act="sp-std" data-slow="1">慢速</button>
    </div>
    ${voice?"":`<div class="small muted">${P.sp.tts?"这台设备没有装日语语音，可能听不到标准读音。iPhone：设置 → 辅助功能 → 朗读内容 → 声音 → 日语；安卓：设置里搜索「文字转语音」并下载日语。":"这个浏览器不支持朗读。"}</div>`}
  </div>`;
}
function hMarks(m){
  return m.map(x=>{
    const u=x.u;
    if(u.kind==="punct")return `<span class="sp-c">${esc(u.k)}</span>`;
    if(u.kind==="kana")return `<span class="sp-c ${x.s}">${esc(u.k)}</span>`;
    if(!u.r)return `<span class="sp-c ${x.s}">${esc(u.k)}</span>`;
    const rt=Array.from(u.r).map((c,i)=>`<span class="sp-c ${x.p==="r"?(x.st[i]||""):x.s}">${esc(c)}</span>`).join("");
    return `<ruby class="sp-c ${x.s}">${esc(u.k)}<rt>${rt}</rt></ruby>`;
  }).join("");
}
function hNote(n,cls){
  return `<div class="sp-note ${cls||n.cls||""}" role="status"><b>${esc(n.t)}</b><div>${esc(n.d)}</div>${n.acts&&n.acts.length?`<div class="sp-acts">${n.acts.map(([a,l])=>`<button class="btn sm" data-act="${a}">${esc(l)}</button>`).join("")}</div>`:""}</div>`;
}
function hSR(){
  const ph=P.phase,on=ph==="listening";
  const status=on?"正在听… 读完会自动停止，也可以再点一下":ph==="processing"?"正在识别…":P.res?"点麦克风再读一次":"点麦克风，然后读出上面的"+(P.t.isWord?"单词":"句子");
  return `<div class="sp-micwrap">
    <button class="sp-mic ${on?"on":""}" data-act="sp-mic" aria-label="${on?"停止":"开始跟读"}" ${ph==="processing"?"disabled":""}>${on?STOP:IC.mic}</button>
    <div class="sp-status" role="status" aria-live="polite">${esc(status)}</div>
    <div class="sp-interim" id="sp-interim" lang="ja">${esc(P.interim)}</div>
  </div>
  ${P.err?hNote({t:P.err.t,d:P.err.d,acts:[["sp-mic","重试"]].concat(P.sp.rec?[["sp-torec","改用录音对比"]]:[])},"bad"):""}
  ${P.res&&ph==="result"?hResult(P.res):""}
  ${P.sp.rec&&!on?`<button class="btn ghost sm sp-switch" data-act="sp-torec">识别不准或用不了？改用录音对比</button>`:""}`;
}
function hResult(r){
  const rt=r.rating;
  const others=r.alts.filter((_,i)=>i!==r.alt);
  return `<div class="card sp-res" role="status">
    <div class="row">
      <div class="sp-score">${Y.ring(r.score/100,92,9,rt.color)}<b class="num" style="color:${rt.color}">${r.score}</b></div>
      <div class="grow">
        <div class="sp-rate ${rt.cls}">${rt.t}</div>
        <div class="small muted">${esc(rt.msg)}</div>
        <div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">${P.xp?`<span class="chip gold">+${P.xp} XP</span>`:r.score>=70&&awardedToday()?`<span class="small muted">今天这条已经拿过 XP</span>`:""}${P.tries>1?`<span class="small muted">本次最高 <b class="num">${P.best}</b> 分</span>`:""}</div>
      </div>
    </div>
    <div class="sp-heard"><span class="small muted">识别到</span><span lang="ja">「${esc(r.heard)||"……"}」</span></div>
    ${others.length?`<details class="fold"><summary>其他候选（${others.length}）</summary><div lang="ja">${others.map(a=>"「"+esc(a)+"」").join("<br>")}</div></details>`:""}
    ${r.tips.length?`<ul class="sp-tips">${r.tips.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:""}
  </div>`;
}
function hRec(){
  const ph=P.phase,on=ph==="recording",R=P.rec||{};
  const status=on?"录音中… 读完点一下停止":ph==="starting"?"正在打开麦克风…（第一次会询问权限，请点允许）":R.url?"点麦克风重新录":"点麦克风，录下你读的"+(P.t.isWord?"单词":"句子");
  return `<div class="sp-micwrap">
    <button class="sp-mic ${on?"on":""}" data-act="sp-rec" aria-label="${on?"停止录音":"开始录音"}" ${ph==="starting"?"disabled":""}>${on?STOP:IC.mic}</button>
    <div class="sp-status" role="status" aria-live="polite">${esc(status)}</div>
    ${on?`<div class="sp-recrow"><div class="bar sp-recbar"><i id="sp-recprog" style="width:0%"></i></div><span class="small muted num" id="sp-rectime">0.0 秒</span></div>`:""}
  </div>
  ${P.err?hNote({t:P.err.t,d:P.err.d,acts:[["sp-rec","重试"]]},"bad"):""}
  ${R.url&&!on?`<div class="card sp-cmp">
    <div class="glabel">对比听听</div>
    <div class="sp-cmpbtns">
      <button class="btn sm ${P.playing==="mine"?"primary":""}" data-act="sp-mine">${IC.play}我的录音</button>
      <button class="btn sm ${P.playing==="std"?"primary":""}" data-act="sp-std">${IC.spk}标准读音</button>
      <button class="btn sm" data-act="sp-cmp">${IC.refresh}连续对比</button>
    </div>
    ${P.recMsg?`<div class="small err">${esc(P.recMsg)}</div>`:""}
    <div class="small muted">仔细听哪里不一样：长音、促音「っ」、清浊音最容易读错。</div>
    ${hSelf()}
  </div>`:""}
  ${P.sp.sr&&!on&&ph!=="starting"&&!P.note?`<button class="btn ghost sm sp-switch" data-act="sp-trysr">试试语音识别打分</button>`:""}`;
}
function hSelf(noLabel){
  if(P.self==="ok")return `<div class="sp-note good" role="status"><b>很好！</b><div>${P.xp?`+${P.xp} XP。`:""}明天复习时再读一遍，记得更牢。</div></div>`;
  if(P.self==="no")return `<div class="sp-note" role="status"><b>没关系，慢慢来</b><div>先听慢速读音，跟着一个音一个音地读，再录一次。</div></div>`;
  return `${noLabel?"":`<div class="glabel">自己评一下</div>`}<div class="sp-self"><button class="btn" data-act="sp-self" data-ok="0">还不熟</button><button class="btn primary" data-act="sp-self" data-ok="1">${IC.check}会了</button></div>`;
}
function hNone(){
  const [t,d]=NONE[P.reason]||NONE.nosr;
  const retry=P.reason==="denied"||P.reason==="nomic";
  return `${P.note&&P.reason==="nosr"?"":hNote({t,d,acts:retry?[["sp-retry","重试"]]:[]},"bad")}
  <div class="card sp-cmp">
    <div class="glabel">跟读自评</div>
    <div class="small muted">点「听标准读音」，跟着大声读 3 遍（可以先用慢速），然后自己评一下。</div>
    ${hSelf(true)}
  </div>`;
}
function hHelp(){
  const sp=P.sp;
  const li=[
    ["iPhone / iPad","用 Safari 打开就能语音打分（要在「设置 → 通用 → 键盘」里打开「启用听写」）。",sp.ios],
    ["安卓手机","Chrome 的语音识别要用谷歌服务，在国内一般要开 VPN；连不上时会自动改成「录音回放对比」。很多手机自带浏览器只能录音对比。",sp.android],
    ["电脑","Chrome、Edge 都支持语音识别；Chrome 在国内同样需要能访问谷歌。",!sp.ios&&!sp.android],
    ["微信里","不支持语音识别和录音，请点右上角「···」→「在浏览器打开」。",sp.wechat],
    ["麦克风权限","第一次使用会询问是否允许麦克风，请点「允许」。点错了要到浏览器的网站设置里改回来。",false],
    ["预览窗口","嵌在别的页面里（比如 claude.ai 的预览）时麦克风被禁用，请在浏览器里单独打开网站。",!sp.policy]
  ];
  return `<details class="fold sp-help"${P.mode==="none"?" open":""}><summary>哪些浏览器能用语音跟读？</summary><div><ul>${li.map(([a,b,hl])=>`<li${hl?' class="hl"':""}><b>${esc(a)}</b>：${esc(b)}</li>`).join("")}</ul>
    <div class="small muted">当前：${esc([sp.sr?"支持语音识别":"不支持语音识别",sp.rec?"可以录音":"不能录音",sp.voice?"有日语朗读":"没有日语朗读"].join(" · "))}</div></div></details>`;
}

/* ============ 动作 ============ */
const A=Y.registerAction;
A("speakcheck",(d,el)=>open({ja:d.ja,kana:d.kana,zh:d.zh,key:d.key,src:d.src},el));
A("sp-close",()=>close());
A("sp-std",d=>{if(!P)return;stopAudio();const my=P;P.playing="std";paint();speakStd(d.slow==="1").then(()=>{if(P===my&&P.playing==="std"){P.playing=null;paint()}})});
A("sp-mic",()=>{if(!P)return;if(P.mode!=="sr"){P.mode="sr";P.err=null}micSR()});
A("sp-rec",()=>{if(!P)return;if(P.mode!=="rec"){P.mode="rec";P.err=null}recToggle()});
A("sp-torec",()=>{if(!P)return;stopRecognize(true);P.mode="rec";P.phase="idle";P.err=null;P.note=null;P.res=null;paint();focusMain()});
A("sp-trysr",()=>{if(!P||P.phase==="starting")return;stopRecording(P,true);clearSRFail();P.mode="sr";P.phase="idle";P.note=null;P.err=null;micSR()});
A("sp-retry",()=>{if(!P)return;P.sp=support();const im=initialMode(P.sp);P.mode=im.mode;P.reason=im.reason||"";P.note=null;P.err=null;P.phase="idle";if(P.mode==="sr")micSR();else if(P.mode==="rec")startRec();else paint()});
A("sp-mine",()=>{if(!P)return;Y.stopSpeak();stopAudio();const tok=playTok;const my=P;setPlaying("mine");playMine().then(ok=>{if(P!==my||tok!==playTok)return;P.playing=null;if(!ok)P.recMsg="播放失败，请再试一次。";paint()})});
A("sp-cmp",()=>compare());
A("sp-self",d=>selfAssess(d.ok==="1"));

/* ============ 样式（只用 app.css 的颜色 token） ============ */
const CSS=`
.sp-layer{position:fixed;inset:0;z-index:30;display:flex;align-items:flex-end;justify-content:center}
.sp-backdrop{position:absolute;inset:0;background:rgba(10,14,26,.55);animation:spfade .2s ease}
.sp-sheet{position:relative;width:100%;max-width:560px;max-height:94vh;max-height:94dvh;overflow-y:auto;overscroll-behavior:contain;background:var(--bg);border-radius:22px 22px 0 0;padding:14px 16px calc(24px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;gap:16px;animation:spup .25s ease;box-shadow:0 -8px 32px rgba(0,0,0,.25)}
@media (min-width:600px){.sp-layer{align-items:center;padding:16px}.sp-sheet{border-radius:22px;max-height:90vh}}
.sp-in{gap:16px}
.sp-head{display:flex;align-items:center;gap:12px}
.sp-title{flex:1;font-weight:700;font-size:17px}
.sp-head .chip{flex:none}
.sp-tgt{display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;padding:20px 16px}
.sp-ja{font-family:var(--f-jp);font-weight:900;line-height:1.9;overflow-wrap:anywhere;max-width:100%}
.sp-ja.w{font-size:clamp(32px,10vw,46px);line-height:1.6}
.sp-ja.s{font-size:clamp(20px,5.8vw,26px);font-weight:700}
.sp-ja rt{font-size:.42em}
.sp-kana{font-family:var(--f-jp);font-size:16px;color:var(--ink);overflow-wrap:anywhere}
.sp-kana .small{font-family:var(--f-ui);margin-right:4px}
.sp-zh{font-size:15px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:center}
.sp-listen{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:4px}
.sp-listen .btn,.sp-cmpbtns .btn{gap:6px}
.sp-listen .icon,.sp-cmpbtns .icon{width:18px;height:18px}
.sp-micwrap{display:flex;flex-direction:column;align-items:center;gap:10px;padding:4px 0}
.sp-mic{--lvl:1;position:relative;width:92px;height:92px;border-radius:50%;background:var(--ai);color:var(--on-ai);display:flex;align-items:center;justify-content:center;box-shadow:0 6px 0 var(--ai-soft);transition:transform .1s,background .2s}
.sp-mic .icon{width:40px;height:40px}
.sp-mic:not([disabled]):active{transform:translateY(3px)}
.sp-mic[disabled]{opacity:.55;cursor:default}
.sp-mic.on{background:var(--shu);box-shadow:0 6px 0 var(--bad-soft)}
.sp-mic.on::before,.sp-mic.on::after{content:"";position:absolute;inset:-8px;border-radius:50%;border:3px solid var(--shu);pointer-events:none}
.sp-mic.on::before{opacity:.45;transform:scale(var(--lvl));transition:transform .08s linear}
.sp-mic.on::after{animation:sppulse 1.4s ease-out infinite}
.sp-status{font-size:14px;color:var(--muted);text-align:center;min-height:1.6em}
.sp-interim{font-family:var(--f-jp);font-size:18px;text-align:center;min-height:1.5em;color:var(--ink);overflow-wrap:anywhere}
.sp-interim:empty{display:none}
.sp-recrow{display:flex;align-items:center;gap:10px}
.sp-recbar{width:160px}
.sp-recbar>i{background:var(--shu);transition:width .1s linear}
.sp-res{display:flex;flex-direction:column;gap:12px;animation:up .25s ease}
.sp-score{position:relative;width:92px;height:92px;flex:none}
.sp-score svg{transform:rotate(-90deg)}
.sp-score b{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:var(--f-jp);font-size:30px;font-weight:900}
.sp-rate{font-size:22px;font-weight:900;font-family:var(--f-jp)}
.sp-rate.ok{color:var(--good)}.sp-rate.ai{color:var(--ai)}.sp-rate.gold{color:var(--gold)}.sp-rate.bad{color:var(--bad)}
.sp-heard{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;padding:10px 12px;border-radius:12px;background:var(--sunk);font-family:var(--f-jp);font-size:16px;overflow-wrap:anywhere}
.sp-heard .small{font-family:var(--f-ui)}
.sp-tips{margin:0;padding-left:1.2em;font-size:14px;line-height:1.7}
.sp-c.ok{color:var(--good)}
.sp-c.part{color:var(--gold)}
.sp-c.bad{color:var(--bad);background:var(--bad-soft);border-radius:4px;text-decoration:underline wavy var(--bad);text-decoration-thickness:1.5px;text-underline-offset:4px}
.sp-c.miss{color:var(--faint);text-decoration:line-through;text-decoration-color:var(--bad);text-decoration-thickness:2px}
ruby.sp-c rt .sp-c.bad{background:none;text-underline-offset:2px}
.sp-ja.w ruby.sp-c rt{font-size:.46em}
.sp-legend{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;font-size:12px;color:var(--muted)}
.sp-legend span{display:inline-flex;align-items:center;gap:4px}
.sp-dot{display:inline-block;width:10px;height:10px;border-radius:3px}
.sp-dot.ok{background:var(--good)}.sp-dot.bad{background:var(--bad)}.sp-dot.miss{background:var(--faint)}
.sp-note{padding:12px 14px;border-radius:12px;font-size:14px;line-height:1.7;background:var(--gold-soft);color:var(--ink);display:flex;flex-direction:column;gap:4px}
.sp-note.bad{background:var(--bad-soft)}
.sp-note.bad>b{color:var(--bad)}
.sp-note.good{background:var(--good-soft)}
.sp-note.good>b{color:var(--good)}
.sp-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
.sp-acts .btn{background:var(--surface)}
.sp-cmp{display:flex;flex-direction:column;gap:12px}
.sp-cmpbtns{display:flex;gap:8px;flex-wrap:wrap}
.sp-cmpbtns .btn{flex:1 1 auto}
.sp-self{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.sp-switch{align-self:center}
.sp-help>div ul{margin:0 0 8px;padding-left:1.2em}
.sp-help li{margin-bottom:4px}
.sp-help li.hl{color:var(--ai)}
.sp-help li.hl b{color:var(--ai)}
@keyframes sppulse{from{transform:scale(1);opacity:.6}to{transform:scale(1.35);opacity:0}}
@keyframes spup{from{transform:translateY(24px);opacity:.5}to{transform:none;opacity:1}}
@keyframes spfade{from{opacity:0}to{opacity:1}}
`;
function injectCSS(){
  const D=W.document;if(!D||D.getElementById("yume-speech-css"))return;
  const s=D.createElement("style");s.id="yume-speech-css";s.textContent=CSS;(D.head||D.documentElement).appendChild(s);
}

/* ============ 导出 ============ */
Y.speech={
  get available(){const s=support();return s.sr||s.rec},
  support,open,close,recognize,stop:stopRecognize,score,rating,
  isOpen:()=>!!P,
  _test:{keep,hira,alignUnits,parseSrc,mkTarget,numKana,kanaize}   // 测试用
};
})();
