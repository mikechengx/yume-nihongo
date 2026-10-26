/* Yume · 简明会话（js/easy.js）——标签 easy
 * 主线「林雨的东京留学一年」：每集一个原创情景短剧（数据 Yume.easy()，由 tools/assemble.py 生成 content/easy.js）。
 * 列表页：主线介绍、人物卡、按等级分组的集数路径（完成状态、星级、下一集高亮）。
 * 单集页：场景 → 对话气泡（振假名、中文开关、逐句朗读/跟读）→ 全部播放 / 跟读模式 / 角色扮演
 *         → 关键表达、要点讲解、本集单词（加入间隔复习）、文化小知识、3 道小测（星级 + XP）。
 * 进度：S.easy = {done:{e1:星级1-3}, pr:{e1:位标记 1听 2跟读 4扮演}, last:最近一次学完的日期, xd/xk:当天已拿过 XP 的「集:模式」}。
 * 角色名：每集可以用 roles 覆盖某个代号的显示名（如 E→入国審査官），单句台词的第 4 项 "日文名|中文名" 可以再单独覆盖。
 * 播放在页面内进行（不用覆盖层），这样 speech.js 的跟读覆盖层可以随时盖在上面。
 */
(function(){
"use strict";
const Y=window.Yume;if(!Y)return;
const W=window;
const {esc,IC,ruby,plain,reading,shuffle}=Y;

/* ============ 人物 ============ */
const CAST={
  L:{name:"リン",zh:"林雨",av:"リ",tag:"主角",d:"20 岁，从上海来东京读日语学校的女生。认真努力，偶尔有点迷糊。",v:"female",p:1.12,r:.92},
  K:{name:"ケン",zh:"山田健",av:"ケ",tag:"同学",d:"大学生，林的同学兼好朋友。热心肠，爱开玩笑。",v:"male",p:.92,r:.96},
  S:{name:"佐藤先生",zh:"佐藤老师",av:"佐",tag:"老师",d:"日语学校的老师。温柔但要求严格，说话清楚标准。",v:"female",p:1.0,r:.84},
  O:{name:"大家さん",zh:"房东",av:"大",tag:"房东",d:"公寓的房东老爷爷。爱操心，说话慢悠悠。",v:"male",p:.74,r:.8},
  T:{name:"店員",zh:"店员",av:"店",tag:"店员",d:"便利店、餐厅、商店里的各种店员。",v:"female",p:1.22,r:1.0},
  E:{name:"駅員など",zh:"站员·路人等",av:"人",tag:"其他",d:"车站工作人员、路人、医生等其他角色。",v:"male",p:1.02,r:.94}
};
const ORDER=["L","K","S","O","T","E"];
const LVNAME={N5:"生活起步",N4:"融入日常",N3:"校园与打工",N2:"社会与职场",N1:"自如表达"};
const STEP={play:1,shadow:2,role:4};
const MODE_NAME={play:"全部播放",shadow:"跟读模式",role:"角色扮演"};
const CUSTOM_ID="easy-words";
if(Y.registerWordList)Y.registerWordList(CUSTOM_ID,{title:"会话生词",sub:"从简明会话加入复习的单词"});
const MALE_RE=/otoya|ichiro|keita|hattori|daichi|naoki|\bmale\b|男性/i;

Y.registerState("easy",{done:{},pr:{},last:""});
function st(){const S=Y.S;let e=S.easy;if(!e||typeof e!=="object"||Array.isArray(e))e=S.easy={done:{},pr:{},last:""};if(!e.done||typeof e.done!=="object")e.done={};if(!e.pr||typeof e.pr!=="object")e.pr={};if(typeof e.last!=="string")e.last="";return e}
/* 记一笔「今天学过会话课」：计划里的「听一集会话课」按这个打勾 */
function markToday(){st().last=Y.today()}
/* 每集每种模式每天只给一次 XP */
function xpOncePerDay(id,mode){const s=st(),t=Y.today();if(s.xd!==t||!Array.isArray(s.xk)){s.xd=t;s.xk=[]}const k=id+":"+mode;if(s.xk.includes(k))return false;s.xk.push(k);return true}

/* ============ 界面状态（不进存档） ============ */
const sget=(k,d)=>{const v=Y.store.get(k,d);return typeof v===typeof d?v:d};
const ev={ep:null,lv:sget("easy-lv","all"),zh:sget("easy-zh",true),slow:sget("easy-slow",false),score:sget("easy-score",true),hide:sget("easy-hide",true),
  role:null,picking:false,zh1:{},reveal:{},scores:{},solo:null,quiz:null};
/* 播放器：mode play|shadow|role；tk 是“代数”，暂停/停止时加一让旧的循环自己退出 */
const pl={mode:null,i:0,paused:false,tk:0,phase:"",cd:0,runScores:[],wake:null,act:null,abortL:null,rec:null,skip:false,lastScroll:-1,skipped:new Set()};

/* ============ 数据 ============ */
const NC=new WeakMap();
const ROLE_V=["female","male"];
function normRoles(r){
  const out={};if(!r||typeof r!=="object")return out;
  for(const k of ORDER){const x=r[k];if(!x||typeof x!=="object"||!x.name)continue;
    out[k]={name:String(x.name).slice(0,20),zh:String(x.zh||"").slice(0,20)};
    if(x.av)out[k].av=String(x.av).slice(0,2);if(ROLE_V.includes(x.v))out[k].v=x.v}
  return out;
}
/* 这一集（这一句）里某个代号实际显示的人物：通用角色 + 本集 roles + 单句覆盖 */
function roleOf(e,sp,ln){
  const c=CAST[sp]||CAST.E;let o=c;
  const r=e&&e.roles&&e.roles[sp];if(r)o=Object.assign({},c,r);
  if(ln&&ln[3]){const [n,z]=String(ln[3]).split("|");if(n)o=Object.assign({},o,{name:n.slice(0,20),zh:(z||o.zh).slice(0,20)})}
  if(o.v!==c.v)o=Object.assign({},o,{p:o.v==="female"?1.12:.92});
  return o;
}
function parseW(x){
  if(Array.isArray(x))x=x.join("|");
  const [ja,kana,zh,pos]=String(x==null?"":x).split("|").map(s=>(s||"").trim());
  return ja&&zh?{ja,kana:kana||"",zh,pos:pos||""}:null;
}
function norm(e,idx){
  let n=NC.get(e);if(n)return n;
  const lines=(Array.isArray(e.lines)?e.lines:[]).filter(l=>Array.isArray(l)&&l[1]).map(l=>{const a=[CAST[l[0]]?String(l[0]):"E",String(l[1]),l[2]==null?"":String(l[2])];if(l[3]&&String(l[3]).includes("|"))a.push(String(l[3]));return a});
  const k=e.key&&typeof e.key==="object"&&e.key.ja?{ja:String(e.key.ja),zh:String(e.key.zh||""),d:String(e.key.d||"")}:null;
  n={id:String(e.id),no:Number.isFinite(+e.no)&&+e.no>0?+e.no:idx+1,t:String(e.t||""),scene:String(e.scene||""),
    lv:Y.LEVELS.includes(e.lv)?e.lv:"N5",lines,key:k,roles:normRoles(e.roles),
    notes:(Array.isArray(e.notes)?e.notes:[]).filter(x=>x&&x.p).map(x=>({p:String(x.p),d:String(x.d||"")})),
    words:(Array.isArray(e.words)?e.words:[]).map(parseW).filter(Boolean),
    tip:String(e.tip||""),
    quiz:(Array.isArray(e.quiz)?e.quiz:[]).filter(q=>Array.isArray(q)&&q[0]&&Array.isArray(q[1])&&q[1].length>=2).map(q=>[String(q[0]),q[1].map(String),String(q[2]||""),String(q[3]||"")])};
  NC.set(e,n);return n;
}
/* 没有台词的集不显示（数据不完整） */
function eps(){return Y.easy().filter(e=>e&&typeof e==="object").map(norm).filter(e=>e.lines.length)}
const epById=id=>eps().find(e=>e.id===String(id))||null;
const curEp=()=>ev.ep?epById(ev.ep):null;
const starsOf=id=>Math.max(0,Math.min(3,+st().done[id]||0));
const isDone=id=>starsOf(id)>0;
const prOf=id=>+st().pr[id]||0;
function nextEp(list){list=list||eps();return list.find(e=>!isDone(e.id))||null}
const speakers=e=>ORDER.filter(sp=>e.lines.some(l=>l[0]===sp));

/* ============ 发音 ============ */
function hasMaleVoice(){try{return Y.tts.voices.some(v=>MALE_RE.test(v.name))}catch(e){return false}}
function vo(sp,ln){
  const c=roleOf(curEp(),sp,ln);let p=c.p;
  /* 没有男声时把男性角色的音调再压低一些，好区分 */
  if(c.v==="male"&&!hasMaleVoice())p=Math.max(.5,p-.2);
  return{voiceHint:c.v,pitch:p,rate:+(c.r*(ev.slow?.78:1)).toFixed(2)};
}
const estMs=t=>(900+plain(t).length*230)*(ev.slow?1.3:1);
function shadowMs(t){return Math.round((1600+plain(t).length*260)*(ev.slow?1.3:1))}

/* ============ 语音识别（评分） ============
 * 优先用 speech.js：Yume.speech.recognize({maxMs}) → {ok,alts,text}|{ok:false,error,msg}，再用 Yume.speech.score(带读音原句, alts) 打分；
 * （若将来 speech.js 提供 listen(target) → {score,heard} 也会直接用）
 * 都没有时退回浏览器自带的 SpeechRecognition。识别出错（国内 Chrome 常连不上谷歌服务）后，本次打开页面期间改为“自己跟读”。 */
const SRC=()=>W.SpeechRecognition||W.webkitSpeechRecognition||null;
let srBroken=false;
const SRMSG={"not-allowed":"麦克风没有授权，改为自己跟读（可在地址栏里允许麦克风）","service-not-allowed":"这个浏览器的语音识别没有开启，改为自己跟读",
  "network":"语音识别连不上（国内网络常见），改为自己跟读","audio-capture":"没有找到麦克风，改为自己跟读","language-not-supported":"这个浏览器不支持日语识别，改为自己跟读",
  "unsupported":"这个浏览器不支持语音识别，改为自己跟读","timeout":"语音识别没有响应，改为自己跟读","start":"语音识别启动失败，改为自己跟读"};
const SOFT_ERR=["no-speech","aborted"];
function srFail(code){srBroken=true;Y.toast(esc(SRMSG[code]||"语音识别用不了，改为自己跟读"),3600)}
const spListen=()=>{const sp=Y.speech;return sp&&typeof sp.listen==="function"?sp:null};
const spRec=()=>{const sp=Y.speech;return sp&&typeof sp.recognize==="function"?sp:null};
/* speech.js 记录的“识别最近失败过”（6 小时内它自己也会直接改用录音模式），这里只读 */
function srFailedRecently(){const f=Y.store.get("speech-srfail",null);return !!(f&&f.t&&Date.now()-f.t<6*36e5)}
function hasRecog(){
  if(srBroken)return false;
  let sp=spListen();
  if(sp){try{return typeof sp.available==="function"?!!sp.available():sp.available!==false}catch(e){return false}}
  sp=spRec();
  if(sp){try{const s=typeof sp.support==="function"?sp.support():null;if(s&&!s.sr)return false}catch(e){return false}return !srFailedRecently()}
  return !!SRC();
}
const canListen=()=>ev.score&&hasRecog();
const toHira=s=>String(s||"").replace(/[\u30a1-\u30f6]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60));
const normJa=s=>toHira(s).replace(/[\s、。，．,.!?！？「」『』（）()…・〜～ー―\-"'“”]/g,"").toLowerCase();
function lev(a,b){
  if(a===b)return 0;if(!a.length)return b.length;if(!b.length)return a.length;
  let prev=Array.from({length:b.length+1},(_,j)=>j);
  for(let i=1;i<=a.length;i++){const cur=[i];for(let j=1;j<=b.length;j++)cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=cur}
  return prev[b.length];
}
/* 简易打分（没有 speech.js 时用）：和原文、读音分别比较编辑距离，取高的 */
function scoreOf(alts,target){
  const ts=[normJa(target.ja),normJa(target.kana)].filter(Boolean);let best=0;
  for(const a of alts){const h=normJa(a);if(!h)continue;for(const t of ts)best=Math.max(best,1-lev(h,t)/Math.max(h.length,t.length))}
  return Math.round(best*100);
}
function normRes(r,target){
  if(r==null||r===false)return null;
  if(typeof r==="number")return isFinite(r)?{score:Math.round(Math.max(0,Math.min(100,r>0&&r<=1?r*100:r))),heard:""}:null;
  if(typeof r==="string")return{score:scoreOf([r],target),heard:r};
  if(typeof r==="object"){
    const heard=String(r.heard||r.text||r.transcript||"");
    let s=r.score!=null?+r.score:(heard?scoreOf([heard],target):NaN);
    if(!isFinite(s))return null;if(s>0&&s<=1)s*=100;
    return{score:Math.round(Math.max(0,Math.min(100,s))),heard};
  }
  return null;
}
function moduleRecognize(sp,ln,target){
  return Promise.resolve().then(()=>sp.recognize({maxMs:Math.min(15000,4000+target.ja.length*300)})).then(r=>{
    if(r&&r.ok&&Array.isArray(r.alts)&&r.alts.length){
      if(typeof sp.score==="function"){try{const x=sp.score(ln[1],r.alts);if(x&&isFinite(+x.score))return{score:Math.round(+x.score),heard:String(x.heard||r.text||r.alts[0]||"")}}catch(e){}}
      return{score:scoreOf(r.alts,target),heard:String(r.alts[0])};
    }
    const code=r&&r.error;if(code&&!SOFT_ERR.includes(code))srFail(code);
    return null;
  });
}
function nativeListen(target){
  return new Promise(res=>{
    const SR=SRC();if(!SR){res(null);return}
    let rec;try{rec=new SR()}catch(e){srBroken=true;res(null);return}
    let done=false,tm=null;
    const fin=r=>{if(done)return;done=true;clearTimeout(tm);if(pl.rec===rec)pl.rec=null;try{rec.abort()}catch(e){}res(r)};
    rec.lang="ja-JP";rec.interimResults=false;rec.continuous=false;rec.maxAlternatives=3;
    rec.onresult=x=>{try{const r=x.results[0];const alts=[];for(let k=0;k<r.length;k++)alts.push(r[k].transcript);fin({score:scoreOf(alts,target),heard:alts[0]||""})}catch(e){fin(null)}};
    rec.onerror=x=>{const er=x&&x.error;if(er&&!SOFT_ERR.includes(er))srFail(er);fin(null)};
    rec.onend=()=>fin(null);
    tm=setTimeout(()=>fin(null),6000+target.ja.length*350);
    pl.rec=rec;
    try{rec.start()}catch(e){srBroken=true;fin(null)}
  });
}
function listen(ln){
  const target={ja:plain(ln[1]),kana:reading(ln[1]),zh:ln[2],text:ln[1]};
  const abortP=new Promise(r=>{pl.abortL=()=>r(null)});
  let sp,p;
  if((sp=spListen()))p=Promise.resolve().then(()=>sp.listen(target)).then(r=>normRes(r,target));
  else if((sp=spRec()))p=moduleRecognize(sp,ln,target);
  else p=nativeListen(target);
  return Promise.race([p.catch(()=>null),abortP]).then(r=>{pl.abortL=null;return r});
}
function abortRec(){
  if(pl.rec){try{pl.rec.abort()}catch(e){}pl.rec=null}
  if(pl.abortL){
    const sp=Y.speech;
    if(sp&&typeof sp.abort==="function")try{sp.abort()}catch(e){}
    else if(spRec()&&typeof sp.stop==="function")try{sp.stop(true)}catch(e){}
    const f=pl.abortL;pl.abortL=null;f();
  }
}
function scoreCls(s){return s>=85?"g":s>=60?"m":"b"}
function scoreWord(s){return s>=90?"完美":s>=75?"很好":s>=55?"还不错":"再试一次"}

/* ============ 播放器 ============ */
const alive=tk=>pl.tk===tk&&!!pl.mode&&!pl.paused;
function wait(ms,tk){
  return new Promise(r=>{
    if(tk!=null&&!alive(tk)){r();return}
    let t=null;const done=()=>{clearTimeout(t);if(pl.wake===done)pl.wake=null;r()};
    if(ms!=null)t=setTimeout(done,ms);pl.wake=done;
  });
}
const waitAct=()=>new Promise(r=>{pl.act=a=>{pl.act=null;r(a)}});
function wakeAll(){
  if(pl.wake){const f=pl.wake;pl.wake=null;f()}
  if(pl.act)pl.act("stop");
}
async function sayLine(ln,tk){
  const t0=Date.now();const ok=await Y.speak(ln[1],vo(ln[0],ln));
  /* 没有语音（或朗读失败）时按估计时长停一下，至少能跟着高亮读 */
  if(!ok&&alive(tk)&&!pl.skip){const left=estMs(ln[1])-(Date.now()-t0);if(left>0)await wait(left,tk)}
}
function startMode(mode,role){
  const e=curEp();if(!e||!e.lines.length)return;
  stopPlayer(true);
  if(Y.overlayOpen&&Y.overlayOpen())return;
  pl.mode=mode;pl.i=0;pl.paused=false;pl.phase="";pl.runScores=[];pl.lastScroll=-1;pl.skipped=new Set();
  ev.picking=false;ev.solo=null;
  if(mode==="role"){ev.role=role;ev.reveal={}}
  if(mode!=="play")ev.scores={};
  if(!Y.tts.ok&&mode!=="role")Y.toast("这个浏览器不能朗读，会按正常语速逐句高亮");
  Y.render();
  runLoop(++pl.tk);
}
function stopPlayer(silent){
  const was=!!pl.mode||ev.solo!=null;
  pl.mode=null;pl.paused=false;pl.phase="";pl.tk++;ev.solo=null;
  if(was)Y.stopSpeak();abortRec();wakeAll();
  if(!silent)Y.render();
}
function pause(){if(!pl.mode||pl.paused)return;pl.paused=true;pl.tk++;pl.phase="";Y.stopSpeak();abortRec();wakeAll();paint()}
function resume(){if(!pl.mode||!pl.paused)return;pl.paused=false;runLoop(++pl.tk)}
function skip(){
  if(!pl.mode)return;
  if(pl.paused){pl.skipped.add(pl.i);pl.i=Math.min(pl.i+1,(curEp()||{lines:[]}).lines.length-1);pl.lastScroll=-1;paint(true);return}
  if(pl.act){pl.act("next");return}
  pl.skip=true;pl.skipped.add(pl.i);
  if(pl.abortL){abortRec();return}
  if(pl.wake){const f=pl.wake;pl.wake=null;f();return}
  Y.stopSpeak();
}
async function runLoop(tk){
  const e=curEp();if(!e)return;
  const L=e.lines;
  while(alive(tk)&&pl.i<L.length){
    if(Y.overlayOpen&&Y.overlayOpen()){pause();return}
    const i=pl.i,ln=L[i];pl.skip=false;
    const mine=pl.mode==="role"&&ln[0]===ev.role;
    if(mine){await userTurn(i,ln,tk)}
    else{pl.phase="speak";paint(true);await sayLine(ln,tk)}
    if(!alive(tk))return;
    if(pl.mode==="shadow"&&!pl.skip){await shadowTurn(i,ln,tk);if(!alive(tk))return}
    pl.skip=false;
    await wait(pl.mode==="play"?280:380,tk);if(!alive(tk))return;
    pl.i++;
  }
  if(alive(tk))finishRun();
}
async function shadowTurn(i,ln,tk){
  if(canListen()){
    pl.phase="listen";paint();
    await wait(150,tk);if(!alive(tk))return;
    const r=await listen(ln);if(!alive(tk))return;
    if(r){ev.scores[i]=r;pl.runScores.push(r.score);pl.phase="scored";paint();await wait(1300,tk);return}
    if(pl.skip)return;
    if(!hasRecog()){pl.cd=shadowMs(ln[1]);pl.phase="shadow";paint();await wait(pl.cd,tk);return}
    pl.phase="miss";paint();await wait(1100,tk);return;
  }
  pl.cd=shadowMs(ln[1]);pl.phase="shadow";paint();await wait(pl.cd,tk);
}
async function userTurn(i,ln,tk){
  let auto=canListen();
  pl.phase="turn";paint(true);
  if(auto){await wait(450,tk);if(!alive(tk))return}
  while(alive(tk)){
    if(auto&&canListen()){
      auto=false;pl.phase="listen";paint();
      const r=await listen(ln);if(!alive(tk))return;
      if(r){ev.scores[i]=r;pl.runScores.push(r.score);ev.reveal[i]=true;pl.phase="scored";paint();await wait(1500,tk);return}
      if(pl.skip){ev.reveal[i]=true;return}
    }
    pl.phase="turn";paint();
    const a=await waitAct();
    if(!alive(tk))return;
    if(a==="next"){ev.reveal[i]=true;return}
    if(a==="listen"){auto=true;continue}
    if(a==="hint"){pl.phase="hint";paint();await sayLine(ln,tk);if(!alive(tk))return}
  }
}
function finishRun(){
  const mode=pl.mode,e=curEp(),sc=pl.runScores.slice(),skipped=pl.skipped.size;
  pl.mode=null;pl.paused=false;pl.phase="";pl.tk++;
  if(!e||!mode){Y.render();return}
  const avg=sc.length?Math.round(sc.reduce((a,b)=>a+b,0)/sc.length):null;
  /* 一半以上的句子是点「下一句」跳过的：不算完成、不给 XP */
  if(skipped*2>e.lines.length){Y.toast(`${esc(MODE_NAME[mode])}结束 · 跳过了 ${skipped} 句，这次不算完成`,3200);Y.render();return}
  const s=st();s.pr[e.id]=(s.pr[e.id]|0)|STEP[mode];markToday();
  const xp=xpOncePerDay(e.id,mode)?(mode==="play"?2:5):0;
  if(xp)Y.addXP(xp);Y.checkBadges();Y.save();
  Y.toast(`${esc(MODE_NAME[mode])}完成${avg!=null?` · 平均 <b>${avg}</b> 分`:""}${xp?` · +${xp} XP`:" · 今天这一集的这个模式已经拿过 XP"}`,3200);
  Y.render();
}
async function sayOne(i){
  const e=curEp(),ln=e&&e.lines[i];if(!ln)return;
  if(pl.mode&&!pl.paused)pause();
  ev.solo=i;paint();
  await Y.speak(ln[1],vo(ln[0],ln));
  if(ev.solo===i){ev.solo=null;paint()}
}

/* 只更新会变的部分（高亮、播放条、分数），不整页重画，滚动位置不跳 */
function paint(scroll){
  const D=W.document;if(!D||!D.getElementById)return;
  const dlg=D.getElementById("ez-dlg");
  if(dlg){
    dlg.classList.toggle("ez-playing",!!pl.mode&&!pl.paused);
    for(const el of dlg.querySelectorAll(".ez-line")){
      const i=+el.dataset.i;el.className=lineCls(i,el.dataset.sp);
      const sc=el.querySelector(".ez-scw");if(sc)sc.innerHTML=scoreHTML(i);
    }
  }
  const bar=D.getElementById("ez-player");
  if(bar){bar.innerHTML=playerInner();bar.hidden=!pl.mode}
  syncPlayerClass();
  if(scroll&&pl.mode&&pl.lastScroll!==pl.i){
    pl.lastScroll=pl.i;const el=D.getElementById("ez-l-"+pl.i);
    if(el)try{el.scrollIntoView({behavior:"smooth",block:"center"})}catch(e){}
  }
}

/* 播放条显示时，给 body 加 class 并记下播放条高度，让提示条（toast）显示在播放条上面、不挡按钮 */
function syncPlayerClass(){
  try{const D=W.document;if(!D||!D.body||!D.body.classList)return;
    const bar=D.getElementById("ez-player");const on=!!bar&&!bar.hidden&&!!pl.mode;
    D.body.classList.toggle("ez-pl-on",on);
    if(on)D.body.style.setProperty("--ez-pl-h",(bar.offsetHeight||110)+"px");
  }catch(e){}
}

/* ============ 小部件 ============ */
let styled=false;
function ensureStyle(){
  if(styled)return;
  try{const D=W.document;if(!D||!D.createElement||!D.head)return;
    if(!D.getElementById("easy-style")){const s=D.createElement("style");s.id="easy-style";s.textContent=CSS;D.head.appendChild(s)}
    /* 播放中点了本页的跟读麦克风（speech.js 的覆盖层）：先立即暂停，避免两边同时出声。捕获阶段，先于 core 的委托执行 */
    D.addEventListener("click",e=>{const t=e.target&&e.target.closest&&e.target.closest('[data-act="speakcheck"]');if(t&&pl.mode&&!pl.paused&&t.closest(".ez-page"))pause()},true);
    styled=true}catch(e){}
}
const av=(sp,cls,c)=>{c=c||CAST[sp]||CAST.E;return `<span class="ez-av ez-c-${esc(sp)} ${cls||""}" aria-hidden="true" lang="ja">${esc(c.av)}</span>`};
const starRow=(n,cls)=>`<span class="kstars ${cls||""}" aria-label="${n} 星">${[1,2,3].map(k=>`<span class="${n>=k?"on":""}">${IC.star}</span>`).join("")}</span>`;
const lvTag=lv=>`<span class="lvb ${Y.lvClass(lv)}">${esc(lv)}</span>`;
const sayT=(t,label,kana)=>`<button class="iconbtn" data-act="easy-sayt" data-t="${esc(t)}"${kana?' data-kana="1"':""} aria-label="${esc(label||"朗读")}">${IC.spk}</button>`;
function chip(act,on,label,title){return `<button class="chip btnchip ${on?"on":""}" data-act="${act}" aria-pressed="${on}"${title?` title="${esc(title)}"`:""}>${label}</button>`}
function furiChip(){const on=Y.furiOn();return `<button class="chip btnchip ${on?"on":""}" data-act="furi" aria-pressed="${on}" title="振假名（汉字上方的读音）"><span lang="ja">ふりがな</span> ${on?"开":"关"}</button>`}
function scoreHTML(i){
  const r=ev.scores[i];if(!r)return "";
  return `<span class="ez-score ${scoreCls(r.score)}">${r.score} 分 · ${esc(scoreWord(r.score))}</span>${r.heard?`<span class="ez-heard" lang="ja">听到「${esc(r.heard)}」</span>`:""}`;
}
function lineCls(i,sp){
  const me=ev.role||"L";const c=["ez-line","ez-c-"+sp];
  if(sp===me)c.push("ez-r");
  if(ev.solo===i||(pl.mode&&pl.i===i))c.push("ez-on");
  if(pl.mode==="role"&&pl.i===i&&!pl.paused&&(pl.phase==="turn"||pl.phase==="listen"))c.push("ez-turn");
  if(pl.mode==="role"&&sp===ev.role&&ev.hide&&!ev.reveal[i])c.push("ez-hid");
  if(ev.zh1[i])c.push("ez-zh1");
  return c.join(" ");
}

/* ============ 列表页 ============ */
function castHTML(){
  return `<div class="sechead"><div class="eyebrow">登场人物</div><span class="small muted">左右滑动</span></div>
  <div class="ez-cast" role="list">${ORDER.map(sp=>{const c=CAST[sp];return `<div class="ez-person" role="listitem">${av(sp,"lg")}<div class="ez-pname"><b lang="ja">${esc(c.name)}</b><span>${esc(c.zh)}</span></div><span class="ez-tag ez-c-${sp}">${esc(c.tag)}</span><div class="small muted">${esc(c.d)}</div></div>`}).join("")}</div>`;
}
function heroHTML(list){
  const n=list.length,done=list.filter(e=>isDone(e.id)).length,stars=list.reduce((a,e)=>a+starsOf(e.id),0);
  const nx=nextEp(list);const p=n?done/n:0;
  const btn=!n?"":nx?`<button class="btn primary block" data-act="easy-open" data-id="${esc(nx.id)}">${IC.play}${done?"继续":"开始"}第 ${nx.no} 集「${esc(nx.t)}」</button>`
    :`<button class="btn gold block" data-act="easy-open" data-id="${esc(list[0].id)}">${IC.refresh}全部完成！从第 1 集再复习</button>`;
  return `<div class="card ez-hero">
    <div class="ez-herotop">${av("L","lg")}<div class="grow"><div class="eyebrow">主线故事</div><h2>林雨的东京留学一年</h2></div></div>
    <p class="ez-story">20 岁的林雨从上海来到东京，在日语学校读书。这一年里她租房、上课、打工、交朋友，也会迷路、生病、闹笑话。每集一个真实生活场景：<b>先听</b>整段对话，<b>再跟读</b>，最后<b>扮演角色</b>开口说。</p>
    ${n?`<div class="ez-prog"><div class="ez-ring">${Y.ring(p,58,6,"var(--gold)")}<span class="num">${Math.round(p*100)}%</span></div>
      <div class="grow"><div>已完成 <b class="num">${done}</b> / ${n} 集</div><div class="small muted row" style="gap:6px">${IC.star.replace('class="icon"','class="icon" style="width:14px;height:14px;color:var(--gold)"')}共获得 <b class="num">${stars}</b> 颗星</div></div></div>`:""}
    ${btn}</div>`;
}
function epItem(e,nx){
  const s=starsOf(e.id),done=s>0,isNext=nx&&nx.id===e.id;
  return `<button class="card ez-ep ez-lv-${Y.lvClass(e.lv)} ${done?"ez-isdone":""} ${isNext?"ez-isnext":""}" data-act="easy-open" data-id="${esc(e.id)}">
    <span class="ez-no num">${e.no}</span>
    <div class="grow"><div class="ez-ept">第 ${e.no} 集 · ${esc(e.t)}</div><div class="ez-eps">${esc(e.scene)}</div>
      <div class="ez-meta">${lvTag(e.lv)}${starRow(s)}<span class="small muted">${speakers(e).map(sp=>esc(roleOf(e,sp).zh)).join(" · ")}</span></div></div>
    ${done?`<span class="seal" lang="ja" title="已完成">済</span>`:isNext?`<span class="ez-nextchip">下一集</span>`:IC.go}
  </button>`;
}
function vList(){
  const list=eps();
  if(!list.length)return `<div class="stack easy">
    <div><div class="eyebrow">简明会话 · 情景短剧</div><h1 style="font-size:24px">会话</h1></div>
    <div class="card soon"><span class="seal" lang="ja">話</span><b>会话课即将上线</b><div class="small muted">林雨的东京留学故事正在编写中。先认识一下登场人物，再去学单词和课程吧。</div><button class="btn primary sm" data-act="tab" data-k="course">去课程</button></div>
    ${castHTML()}</div>`;
  const lvs=Y.LEVELS.filter(lv=>list.some(e=>e.lv===lv));
  if(ev.lv!=="all"&&!lvs.includes(ev.lv))ev.lv="all";
  const shown=list.filter(e=>ev.lv==="all"||e.lv===ev.lv);
  const nx=nextEp(list);
  const groups=lvs.filter(lv=>shown.some(e=>e.lv===lv)).map(lv=>{const g=shown.filter(e=>e.lv===lv);const d=g.filter(e=>isDone(e.id)).length;
    return `<div class="ksec"><span class="lvb ${Y.lvClass(lv)}">${lv}</span> ${esc(LVNAME[lv]||"")} · ${d}/${g.length} 集</div><div class="ez-path">${g.map(e=>epItem(e,nx)).join("")}</div>`}).join("");
  return `<div class="stack easy">
    <div><div class="eyebrow">简明会话 · 情景短剧跟读</div><h1 style="font-size:24px">会话</h1></div>
    ${heroHTML(list)}
    ${castHTML()}
    ${lvs.length>1?`<div class="filters" role="tablist" aria-label="按等级筛选">${["all"].concat(lvs).map(lv=>`<button class="${ev.lv===lv?"on":""}" data-act="easy-lv" data-k="${lv}">${lv==="all"?"全部":lv}</button>`).join("")}</div>`:""}
    ${groups}
    <div class="card ez-how"><div class="eyebrow">怎么学最有效</div>
      <ol><li><b>听全文</b>：先只听，再打开中文对照意思。</li><li><b>跟读</b>：每句播放后留出时间，模仿语音语调。</li><li><b>角色扮演</b>：选一个角色，轮到他时你来说。</li><li><b>小测</b>：3 道题拿星星，生词一键加入复习。</li></ol></div>
  </div>`;
}

/* ============ 单集页 ============ */
function stepBtn(mode,icon,label,doneBit,sub){
  const on=pl.mode===mode||(mode==="role"&&ev.picking);const ok=doneBit;
  return `<button class="ez-step ${on?"ez-act":""} ${ok?"ez-ok":""}" data-act="easy-${mode}" aria-pressed="${on}"><span class="ez-si">${on&&pl.mode===mode?IC.close:ok?IC.check:icon}</span><b>${label}</b><small>${on&&pl.mode===mode?"点击停止":ok?"已完成":sub}</small></button>`;
}
function toolsHTML(e){
  const pr=prOf(e.id),s=starsOf(e.id);
  const sps=speakers(e);
  const picker=ev.picking?`<div class="ez-picker"><div class="small"><b>你想扮演谁？</b><span class="muted"> 轮到这个角色时不播放，由你来说</span></div>
    <div class="ez-pick">${sps.map(sp=>{const c=roleOf(e,sp);return `<button class="ez-pickb" data-act="easy-pick" data-sp="${sp}">${av(sp,"",c)}<span><b lang="ja">${esc(c.name)}</b><small>${esc(c.zh)} · ${e.lines.filter(l=>l[0]===sp).length} 句</small></span></button>`}).join("")}</div></div>`:"";
  return `<div class="card stack ez-tools">
    <div class="ez-steps">
      ${stepBtn("play",IC.play,"听全文",pr&1,"逐句播放")}
      ${stepBtn("shadow",IC.mic,"跟读",pr&2,canListen()?"每句评分":"留时间跟说")}
      ${stepBtn("role",IC.chat,"角色扮演",pr&4,"你来说一角")}
      <button class="ez-step ${s?"ez-ok":""}" data-act="easy-goquiz"><span class="ez-si">${s?IC.check:IC.target}</span><b>小测</b><small>${s?`${"★".repeat(s)}${"☆".repeat(3-s)}`:"3 道题"}</small></button>
    </div>
    ${picker}
    <div class="ez-chips">${furiChip()}${chip("easy-zh",ev.zh,"中文 "+(ev.zh?"开":"关"),"显示中文翻译")}${chip("easy-slow",ev.slow,"慢速 "+(ev.slow?"开":"关"),"放慢朗读速度")}${hasRecog()?chip("easy-score",ev.score,"评分 "+(ev.score?"开":"关"),"跟读、角色扮演时用麦克风打分"):""}${ev.role&&pl.mode==="role"?chip("easy-hide",ev.hide,"藏起我的台词","角色扮演时先不显示你的台词"):""}</div>
  </div>`;
}
function lineHTML(e,ln,i){
  const [sp,ja,zh]=ln;const c=roleOf(e,sp,ln);
  return `<div class="${lineCls(i,sp)}" id="ez-l-${i}" data-i="${i}" data-sp="${esc(sp)}">
    ${av(sp,"",c)}
    <div class="ez-bw">
      <div class="ez-name"><b lang="ja">${esc(c.name)}</b> ${esc(c.zh)}</div>
      <div class="ez-bub"><div class="ez-ja jr" lang="ja">${ruby(ja)}</div><button class="ez-ph" data-act="easy-reveal" data-i="${i}">轮到你说 · 点这里偷看台词</button>${zh?`<div class="ez-zh">${esc(zh)}</div>`:""}</div>
      <div class="ez-acts"><span class="ez-scw">${scoreHTML(i)}</span><button class="iconbtn" data-act="easy-say" data-i="${i}" aria-label="朗读这句">${IC.spk}</button>${Y.speakCheckBtn({ja,zh})}${!ev.zh&&zh?`<button class="iconbtn ez-tr" data-act="easy-zh1" data-i="${i}" aria-label="显示中文">译</button>`:""}</div>
    </div></div>`;
}
function playerInner(){
  if(!pl.mode)return "";
  const e=curEp();if(!e)return "";
  const n=e.lines.length,i=Math.min(pl.i,n-1),ln=e.lines[i],c=roleOf(e,ln[0],ln);
  let msg="",sub="",extra="",main="";
  const r=ev.scores[i];
  if(pl.paused){msg="已暂停";sub=`停在第 ${i+1} 句，点 ▶ 从这句继续`}
  else switch(pl.phase){
    case "speak":msg=`<span lang="ja">${esc(c.name)}</span> 在说…`;sub=esc(c.zh);break;
    case "shadow":msg="跟着说一遍";sub="模仿刚才的语音语调";extra=`<div class="ez-cdbar"><i style="animation-duration:${pl.cd}ms"></i></div>`;break;
    case "listen":msg=`${IC.mic.replace('class="icon"','class="icon ez-rec"')}正在听你说…`;sub="说完停一下就会打分";break;
    case "scored":msg=r?`${r.score} 分 · ${esc(scoreWord(r.score))}`:"好的";sub=r&&r.heard?`听到「${esc(r.heard)}」`:"";break;
    case "miss":msg="没听清";sub="继续下一句";break;
    case "turn":msg="轮到你了";sub=`你是 <span lang="ja">${esc(roleOf(e,ev.role).name)}</span>，说出这句台词`;
      main=`<div class="ez-prow">${hasRecog()&&ev.score?`<button class="btn sm" data-act="easy-relisten">${IC.mic}再说一次</button>`:""}<button class="btn sm" data-act="easy-hint">${IC.spk}听原句</button><button class="btn primary sm grow" data-act="easy-next">说完了 · 下一句</button></div>`;break;
    case "hint":msg="原句示范";sub="听完再说一遍";break;
    default:msg=esc(MODE_NAME[pl.mode]);
  }
  const canSkip=pl.phase!=="turn";
  return `<div class="ez-pin" role="region" aria-label="播放控制">
    <div class="bar"><i style="width:${(i+1)/n*100}%"></i></div>
    <div class="ez-prow"><span class="ez-pmode">${esc(MODE_NAME[pl.mode])} <span class="num">${i+1}/${n}</span></span>
      <div class="ez-pmsg" aria-live="polite"><b>${msg}</b>${sub?`<span>${sub}</span>`:""}</div>
      <button class="iconbtn" data-act="easy-pause" aria-label="${pl.paused?"继续":"暂停"}">${pl.paused?IC.play:IC.pause}</button>
      ${canSkip?`<button class="iconbtn" data-act="easy-next" aria-label="下一句">${IC.go}</button>`:""}
      <button class="iconbtn" data-act="easy-stop" aria-label="停止">${IC.close}</button></div>
    ${extra}${main}</div>`;
}
function ttsHint(){
  if(Y.tts.ja())return "";
  return Y.voiceHelp(false);
}
/* 单词：先找课程里同写法的词（共用进度），没有就放进自制课程「会话生词」 */
function wordTargets(e){
  const by=new Map();for(const w of Y.allWords()){if(!by.has(w.ja))by.set(w.ja,[]);by.get(w.ja).push(w)}
  return e.words.map(w=>{
    const cands=(by.get(w.ja)||[]).filter(x=>x.lid!==CUSTOM_ID&&(!w.kana||!x.kana||x.kana===w.kana));
    const hit=cands.find(x=>{const l=Y.lesson(x.lid);return l&&!l.custom})||cands[0]||null;
    return{w,key:hit?hit.key:CUSTOM_ID+":"+w.ja,lesson:!!hit};
  });
}
function ensureWords(e){
  const S=Y.S;if(!Array.isArray(S.custom))S.custom=[];
  const tg=wordTargets(e);let cl=null,added=false;
  for(const t of tg){
    if(t.lesson)continue;
    if(!cl)cl=S.custom.find(c=>c&&String(c.id)===CUSTOM_ID);
    if(!cl){cl={id:CUSTOM_ID,title:"会话生词",sub:"从简明会话加入复习的单词",words:[],grammar:[],quiz:[],sys:true};S.custom.push(cl)}
    if(!Array.isArray(cl.words))cl.words=[];
    if(!cl.words.some(x=>String(x).split("|")[0]===t.w.ja)){cl.words.push([t.w.ja,t.w.kana,t.w.zh,t.w.pos].join("|"));added=true}
  }
  if(added)Y.rebuild();
  return tg;
}
/* 课程内容更新后，「会话生词」里已出现在课程中的词：进度挪到课程单词上，并从自制课程里删掉（每次打开页面做一次） */
let migrated=false;
function migrateCustom(){
  if(migrated)return;migrated=true;
  try{
    const S=Y.S;const cl=(Array.isArray(S.custom)?S.custom:[]).find(c=>c&&String(c.id)===CUSTOM_ID);if(!cl||!Array.isArray(cl.words))return;
    /* 和 wordTargets 同样的条件：同写法，并且读音一致（任一方没写读音时只看写法）。多音词（紅葉 もみじ/こうよう）不会挪错 */
    const by=new Map();for(const w of Y.allWords()){const l=Y.lesson(w.lid);if(l&&!l.custom){if(!by.has(w.ja))by.set(w.ja,[]);by.get(w.ja).push(w)}}
    let ch=false;
    cl.words=cl.words.filter(x=>{const [ja,kana]=String(x).split("|");const hit=(by.get(ja)||[]).find(w=>!kana||!w.kana||w.kana===kana);if(!hit)return true;
      const ck=CUSTOM_ID+":"+ja;if(S.words[ck]){const a=S.words[ck],b=S.words[hit.key];if(!b||((a.r||0)+(a.x||0))>((b.r||0)+(b.x||0)))S.words[hit.key]=a;delete S.words[ck]}ch=true;return false});
    if(!cl.words.length)S.custom=S.custom.filter(c=>c!==cl);
    if(ch){Y.rebuild();Y.save()}
  }catch(e){console.error("[yume] easy migrate",e)}
}
function addWords(e){
  if(!e||!e.words.length)return;
  const S=Y.S;const tg=ensureWords(e);const now=Date.now();let n=0;
  for(const t of tg){if(S.words[t.key]||!Y.word(t.key))continue;S.words[t.key]={lv:0,due:now,r:0,x:0};n++}
  Y.checkBadges();Y.save();Y.render();
  Y.toast(n?`已把 ${n} 个生词加入复习，去「今日」就能练`:"这些词都已经在复习里了");
}
function practice(e){
  if(!e||!e.words.length||!Y.startWords)return;
  const tg=ensureWords(e);Y.save();
  const list=tg.map(t=>Y.word(t.key)).filter(Boolean);
  Y.startWords(list,`第 ${e.no} 集 生词`);
}
function wordsHTML(e){
  if(!e.words.length)return "";
  const S=Y.S;const tg=wordTargets(e);const pending=tg.filter(t=>!S.words[t.key]).length;
  const used=[...new Set(e.words.map(w=>w.pos).filter(Boolean))];
  return `<section class="card stack ez-words" style="gap:10px">
    <div class="sechead"><div><div class="eyebrow">本集单词</div><h2 style="font-size:18px">${e.words.length} 个生词</h2></div><span class="small muted">${pending?`${pending} 个还没学`:"都在复习中"}</span></div>
    <div class="wlist">${tg.map(t=>{const w=t.w;return `<div class="wrow"><div class="grow"><div class="wline"><span class="wja" lang="ja">${esc(w.ja)}</span>${w.kana&&w.kana!==w.ja?`<span class="wkana" lang="ja">${esc(w.kana)}</span>`:""}${Y.posTag(w.pos)}</div><div class="wzh">${esc(w.zh)}</div></div>${S.words[t.key]?Y.lvDots({key:t.key}):`<span class="small muted">未学</span>`}<div class="acts">${Y.speakCheckBtn({ja:w.ja,kana:w.kana,zh:w.zh})}${sayT(w.kana||w.ja,"朗读单词")}</div></div>`}).join("")}</div>
    ${used.length?`<div class="poslegend small muted">${used.map(p=>`<span>${Y.posTag(p)} ${esc((Y.POS[p]||{}).n||p)}</span>`).join("")}</div>`:""}
    <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn primary grow" data-act="easy-add" ${pending?"":"disabled"}>${pending?`一键加入复习（${pending}）`:"已全部加入复习"}</button><button class="btn gold grow" data-act="easy-practice">${IC.cards}马上练一练</button></div>
    <div class="small muted">加入后会出现在「今日 → 复习」里，和课程单词用同一套间隔复习。</div>
  </section>`;
}
function quizState(e){
  if(!ev.quiz||ev.quiz.id!==e.id)ev.quiz={id:e.id,items:e.quiz.map(q=>{const o=shuffle(q[1]);return{q:q[0],opts:o,ans:o.indexOf(q[1][0]),zh:q[2],why:q[3],right:q[1][0]}}),picks:[],fin:null};
  return ev.quiz;
}
function quizHTML(e){
  const best=starsOf(e.id);
  if(!e.quiz.length)return `<section class="card stack ez-quiz" id="ez-quiz"><div class="eyebrow">完成本集</div><div class="small muted">这一集没有小测，学完对话就可以打卡。</div><button class="btn gold block" data-act="easy-mark" ${best?"disabled":""}>${best?"已完成":"我学完了"}</button></section>`;
  const qz=quizState(e);
  const items=qz.items.map((it,k)=>{
    const a=qz.picks[k],ans=a!=null,ok=a===it.ans;
    const qh=ruby(it.q).replace("（　）",`<span class="blank">${ans?ruby(it.right):"　"}</span>`);
    const opts=it.opts.map((o,j)=>{let c="";if(ans){if(j===it.ans)c="ok";else if(j===a)c="no"}return `<button class="opt ja ${c}" lang="ja" data-act="easy-q" data-q="${k}" data-o="${j}" ${ans?"disabled":""}>${ruby(o)}</button>`}).join("");
    const full=it.q.replace("（　）",it.right);
    return `<div class="ez-q"><div class="ez-qq"><span class="gno num">${k+1}</span><div class="grow"><div class="q jr" lang="ja">${qh}</div>${it.zh?`<div class="small muted">${esc(it.zh)}</div>`:""}</div></div>
      <div class="opts">${opts}</div>
      ${ans?`<div class="why"><b style="color:${ok?"var(--good)":"var(--bad)"}">${ok?"答对了":"正确答案："+ruby(it.right)}</b>　${it.why?ruby(it.why):""}<div class="row" style="margin-top:6px;gap:8px"><span class="grow jr" lang="ja">${ruby(full)}</span>${sayT(full,"朗读整句")}</div></div>`:""}</div>`;
  }).join("");
  const f=qz.fin;
  const res=f?`<div class="ez-res"><div class="bigstars">${[1,2,3].map(n=>`<span class="${f.stars>=n?"on":""}" style="animation-delay:${n*.15}s">${IC.star}</span>`).join("")}</div>
    <b style="font-size:18px">${f.correct===f.n?"全部答对！":f.correct?`答对 ${f.correct} / ${f.n} 题`:"再接再厉"}</b>
    <div class="small muted">+${f.xp} XP${f.first?"（含首次完成 +10）":""} · 本集最好成绩 ${f.best} 星</div>
    <div class="row" style="gap:8px;width:100%"><button class="btn grow" data-act="easy-qagain">${IC.refresh}再做一次</button>${(()=>{const l=eps();const k=l.findIndex(x=>x.id===e.id);const nx=l[k+1];return nx?`<button class="btn primary grow" data-act="easy-open" data-id="${esc(nx.id)}">下一集 ${IC.go}</button>`:""})()}</div></div>`:"";
  return `<section class="card stack ez-quiz" id="ez-quiz">
    <div class="sechead"><div><div class="eyebrow">小测 · ${qz.items.length} 题</div><h2 style="font-size:18px">选出填入空格的答案</h2></div>${best?starRow(best):""}</div>
    ${items}${res}</section>`;
}
function vEp(e){
  const list=eps();const k=list.findIndex(x=>x.id===e.id);const prev=list[k-1],next=list[k+1];
  const s=starsOf(e.id);
  return `<div class="stack easy ez-page">
    <div class="row"><button class="iconbtn" data-act="easy-back" aria-label="返回">${IC.back}</button>
      <div class="grow"><div class="eyebrow">简明会话 · 第 ${e.no} 集 ${lvTag(e.lv)}</div><h1 style="font-size:22px">${esc(e.t)}</h1></div>
      ${s?`<span class="seal" lang="ja" title="已完成">済</span>`:""}</div>
    <div class="card ez-scene"><div class="eyebrow">场景</div><div>${esc(e.scene)}</div>
      <div class="ez-who">${speakers(e).map(sp=>{const c=roleOf(e,sp);return `<span class="ez-whoc">${av(sp,"sm",c)}<span lang="ja">${esc(c.name)}</span></span>`}).join("")}</div></div>
    ${toolsHTML(e)}
    ${ttsHint()}
    <div class="ez-dlg ${ev.zh?"ez-zhall":""} ${pl.mode&&!pl.paused?"ez-playing":""}" id="ez-dlg">${e.lines.map((ln,i)=>lineHTML(e,ln,i)).join("")}</div>
    ${e.key?`<section class="card ez-key"><div class="eyebrow">本集关键表达</div>
      <div class="row" style="align-items:flex-start;gap:10px"><div class="grow"><div class="ez-keyja jr" lang="ja">${ruby(e.key.ja)}</div><div class="ez-keyzh">${esc(e.key.zh)}</div></div><div class="acts" style="display:flex;gap:6px">${Y.speakCheckBtn({ja:e.key.ja,zh:e.key.zh})}${sayT(e.key.ja,"朗读关键表达")}</div></div>
      ${e.key.d?`<div class="ez-keyd jr">${ruby(e.key.d)}</div>`:""}</section>`:""}
    ${e.notes.length?`<section class="card stack" style="gap:12px"><div class="eyebrow">要点讲解</div>${e.notes.map((nt,j)=>`<div class="ez-note"><span class="gno num">${j+1}</span><div class="grow"><div class="ez-notep jr" lang="ja">${ruby(nt.p)}</div><div class="ez-noted jr">${ruby(nt.d)}</div></div></div>`).join("")}</section>`:""}
    ${wordsHTML(e)}
    ${e.tip?`<section class="card ez-tip"><span class="seal" lang="ja">知</span><div class="grow"><div class="eyebrow">日本生活小知识</div><div class="jr">${ruby(e.tip)}</div></div></section>`:""}
    ${quizHTML(e)}
    <div class="row" style="gap:8px">${prev?`<button class="btn grow" data-act="easy-open" data-id="${esc(prev.id)}">${IC.back}上一集</button>`:""}${next?`<button class="btn grow" data-act="easy-open" data-id="${esc(next.id)}">下一集${IC.go}</button>`:`<button class="btn grow" data-act="easy-back">${IC.list}回到目录</button>`}</div>
    <div class="ez-spacer ${pl.mode?"on":""}" aria-hidden="true"></div>
    <div class="ez-player" id="ez-player" ${pl.mode?"":"hidden"}>${playerInner()}</div>
  </div>`;
}
function vEasy(){
  ensureStyle();migrateCustom();
  const e=curEp();
  if(ev.ep&&!e){ev.ep=null;stopPlayer(true)}
  return e?vEp(e):vList();
}

/* ============ 首页卡片 ============ */
function homeCard(){
  const list=eps();if(!list.length)return "";
  ensureStyle();migrateCustom();
  const nx=nextEp(list),done=list.filter(e=>isDone(e.id)).length;
  const e=nx||list[0];
  return `<button class="card ez-home" data-act="easy-open" data-id="${esc(e.id)}">
    ${av(speakers(e).includes("L")?"L":speakers(e)[0]||"L","lg")}
    <div class="grow"><div class="eyebrow">简明会话 · 林雨的东京留学</div>
      <div class="lt">${nx?`${done?"继续":"开始"}第 ${nx.no} 集「${esc(nx.t)}」`:"会话全部完成，再复习一遍"}</div>
      <div class="small muted">已完成 <b class="num">${done}</b> / ${list.length} 集 · ${lvTag(e.lv)}</div></div>
    ${IC.go}</button>`;
}

/* ============ 导航与动作 ============ */
function openEp(id){
  const e=epById(id);if(!e)return;
  stopPlayer(true);
  if(ev.ep!==e.id){ev.zh1={};ev.reveal={};ev.scores={};ev.role=null}
  ev.ep=e.id;ev.picking=false;ev.solo=null;
  if(ev.quiz&&ev.quiz.id!==e.id)ev.quiz=null;
  if(Y.ui.tab!=="easy")Y.go("easy",{keep:true});
  else{Y.render();try{W.scrollTo(0,0)}catch(err){}}
}
function scrollToId(id){try{const el=W.document.getElementById(id);if(el)el.scrollIntoView({behavior:"smooth",block:"start"})}catch(e){}}
function qpick(qi,oi){
  const e=curEp();if(!e)return;const qz=quizState(e);if(qz.fin||qz.picks[qi]!=null||!qz.items[qi])return;
  qz.picks[qi]=oi;
  if(qz.items.every((_,k)=>qz.picks[k]!=null)){
    const n=qz.items.length,correct=qz.items.filter((it,k)=>qz.picks[k]===it.ans).length;
    const stars=correct===n?3:correct>=Math.ceil(n*2/3)?2:1;
    const s=st(),first=!s.done[e.id];s.done[e.id]=Math.max(+s.done[e.id]||0,stars);markToday();
    const xp=correct*5+(first?10:0);Y.addXP(xp);
    qz.fin={correct,n,stars,xp,first,best:s.done[e.id]};
    Y.checkBadges();Y.save();Y.toast(`小测完成 · ${"★".repeat(stars)} · +${xp} XP`);
  }
  Y.render();
}

Y.registerTab({id:"easy",label:"会话",icon:"chat",order:30,render:vEasy,
  onShow:o=>{if(!o.keep&&o.from!=="easy"){stopPlayer(true);ev.ep=null}}});
/* 首页「接着学」里的一行 */
function homeRowEasy(){
  const list=eps();if(!list.length||!Y.homeRow)return "";
  ensureStyle();migrateCustom();
  const nx=nextEp(list),done=list.filter(e=>isDone(e.id)).length;
  const e=nx||list[0];
  return Y.homeRow({act:"easy-open",data:{id:e.id},icon:av(speakers(e).includes("L")?"L":speakers(e)[0]||"L"),tone:"bare",eyebrow:"会话 · 林雨的东京留学",
    title:nx?`${done?"继续":"开始"}第 ${nx.no} 集「${nx.t}」`:"会话全部完成，再复习一遍",sub:`已完成 ${done} / ${list.length} 集`});
}
Y.registerCard("home-row",homeRowEasy,{order:20});
Y.onRender(tab=>{if(tab!=="easy"&&(pl.mode||ev.solo!=null))stopPlayer(true);syncPlayerClass()});
const doneCount=()=>Object.keys(st().done).filter(k=>+st().done[k]>0).length;
Y.registerBadge({id:"easy1",k:"話",t:"开口第一句",d:"完成 1 集简明会话",ok:()=>doneCount()>=1});
Y.registerBadge({id:"easy10",k:"談",t:"会话达人",d:"完成 10 集简明会话",ok:()=>doneCount()>=10});

const A=Y.registerAction;
A("easy-open",d=>openEp(d.id));
A("easy-back",()=>{stopPlayer(true);ev.ep=null;Y.render();try{W.scrollTo(0,0)}catch(e){}});
A("easy-lv",d=>{ev.lv=d.k||"all";Y.store.set("easy-lv",ev.lv);Y.render()});
A("easy-play",()=>{if(pl.mode==="play")stopPlayer();else startMode("play")});
A("easy-shadow",()=>{if(pl.mode==="shadow")stopPlayer();else startMode("shadow")});
A("easy-role",()=>{if(pl.mode==="role"){stopPlayer();return}if(pl.mode)stopPlayer(true);ev.picking=!ev.picking;Y.render()});
A("easy-pick",d=>{if(CAST[d.sp])startMode("role",d.sp)});
A("easy-pause",()=>{if(pl.paused)resume();else pause()});
A("easy-stop",()=>stopPlayer());
A("easy-next",()=>skip());
A("easy-hint",()=>{if(pl.act)pl.act("hint")});
A("easy-relisten",()=>{if(pl.act)pl.act("listen")});
A("easy-say",d=>{sayOne(+d.i)});
A("easy-sayt",d=>{if(pl.mode&&!pl.paused)pause();Y.speak(d.t,{kana:d.kana==="1",rate:ev.slow?.7:.9})});
A("easy-zh",()=>{ev.zh=!ev.zh;Y.store.set("easy-zh",ev.zh);ev.zh1={};Y.render()});
A("easy-zh1",d=>{ev.zh1[d.i]=!ev.zh1[d.i];paint()});
A("easy-slow",()=>{ev.slow=!ev.slow;Y.store.set("easy-slow",ev.slow);Y.render();Y.toast(ev.slow?"慢速朗读：开":"慢速朗读：关")});
A("easy-score",()=>{ev.score=!ev.score;Y.store.set("easy-score",ev.score);if(!ev.score)abortRec();Y.render()});
A("easy-hide",()=>{ev.hide=!ev.hide;Y.store.set("easy-hide",ev.hide);Y.render()});
A("easy-reveal",d=>{ev.reveal[d.i]=true;paint()});
A("easy-add",()=>addWords(curEp()));
A("easy-practice",()=>{if(pl.mode)stopPlayer(true);practice(curEp())});
A("easy-goquiz",()=>scrollToId("ez-quiz"));
A("easy-q",d=>qpick(+d.q,+d.o));
A("easy-qagain",()=>{ev.quiz=null;Y.render();scrollToId("ez-quiz")});
A("easy-mark",()=>{const e=curEp();if(!e)return;const s=st();markToday();if(!s.done[e.id]){s.done[e.id]=1;Y.addXP(10);Y.checkBadges();Y.toast("本集完成 · +10 XP")}Y.save();Y.render()});

Y.easyUI={open:openEp,stop:()=>stopPlayer(true),state:ev,player:pl,cast:CAST,episodes:eps,roleOf};

/* ============ 样式（只用 :root token，暗色模式自动切换） ============ */
const CSS=`
.ez-c-L{--c:var(--pos-aux);--cb:var(--pos-aux-bg)}
.ez-c-K{--c:var(--ai);--cb:var(--ai-soft)}
.ez-c-S{--c:var(--good);--cb:var(--good-soft)}
.ez-c-O{--c:var(--n3);--cb:var(--n3-soft)}
.ez-c-T{--c:var(--pos-na);--cb:var(--pos-na-bg)}
.ez-c-E{--c:var(--pos-adv);--cb:var(--pos-adv-bg)}
.ez-av{width:36px;height:36px;border-radius:50%;flex:none;display:inline-flex;align-items:center;justify-content:center;font-family:var(--f-jp);font-weight:900;font-size:16px;line-height:1;color:var(--c,var(--muted));background:var(--cb,var(--sunk));box-shadow:inset 0 0 0 2px var(--c,var(--line))}
.ez-av.sm{width:26px;height:26px;font-size:12px}
.ez-av.lg{width:52px;height:52px;font-size:23px}
.ez-hero{display:flex;flex-direction:column;gap:12px;position:relative;overflow:hidden}
.ez-hero::before{content:"東京";position:absolute;right:-8px;top:-18px;font-family:var(--f-jp);font-weight:900;font-size:76px;line-height:1;color:var(--ai-soft);opacity:.75;pointer-events:none}
.ez-hero>*{position:relative}
.ez-herotop{display:flex;align-items:center;gap:12px}
.ez-hero h2{font-family:var(--f-jp);font-weight:900;font-size:21px}
.ez-story{margin:0;font-size:14px;line-height:1.75;color:var(--muted)}
.ez-story b{color:var(--ink)}
.ez-prog{display:flex;align-items:center;gap:14px;padding:10px 12px;border-radius:14px;border:1px solid var(--line)}
.ez-ring{position:relative;width:58px;height:58px;flex:none}
.ez-ring svg{transform:rotate(-90deg)}
.ez-ring span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px}
.ez-cast{display:flex;gap:10px;overflow-x:auto;padding:2px 2px 8px;margin:-6px -2px 0;scroll-snap-type:x proximity;scrollbar-width:none}
.ez-cast::-webkit-scrollbar{display:none}
.ez-person{flex:none;width:150px;scroll-snap-align:start;background:var(--surface);border-radius:14px;box-shadow:var(--shadow);padding:12px;display:flex;flex-direction:column;align-items:flex-start;gap:6px}
.ez-person .small{line-height:1.5}
.ez-pname{display:flex;flex-direction:column;line-height:1.3}
.ez-pname b{white-space:nowrap;font-size:16px}
.ez-pname span{font-size:12px;color:var(--muted)}
.ez-tag{font-size:11px;font-weight:700;padding:1px 8px;border-radius:99px;color:var(--c);background:var(--cb)}
.ez-path{display:flex;flex-direction:column;gap:10px;position:relative}
.ez-path::before{content:"";position:absolute;left:35px;top:20px;bottom:20px;width:2px;background:var(--line)}
.ez-ep{position:relative;display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;width:100%;text-align:left;padding:14px}
.ez-lv-n5{--lc:var(--n5);--ls:var(--n5-soft)}.ez-lv-n4{--lc:var(--n4);--ls:var(--n4-soft)}.ez-lv-n3{--lc:var(--n3);--ls:var(--n3-soft)}.ez-lv-n2{--lc:var(--n2);--ls:var(--n2-soft)}.ez-lv-n1{--lc:var(--n1);--ls:var(--n1-soft)}
.ez-no{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:var(--f-jp);font-weight:900;font-size:17px;background:var(--ls,var(--sunk));color:var(--lc,var(--ink));box-shadow:0 0 0 4px var(--surface)}
.ez-isdone .ez-no{background:var(--lc,var(--ai));color:var(--surface)}
.ez-isnext{box-shadow:var(--shadow),inset 0 0 0 2px var(--gold)}
.ez-isnext .ez-no{background:var(--gold);color:#2A1D00}
.ez-ept{font-weight:700;line-height:1.35}
.ez-eps{font-size:13px;color:var(--muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.5;margin-top:2px}
.ez-meta{display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap}
.ez-meta .kstars .icon{width:13px;height:13px}
.ez-nextchip{font-size:12px;font-weight:700;padding:3px 10px;border-radius:99px;background:var(--gold);color:#2A1D00;white-space:nowrap;animation:bob 1.6s ease-in-out infinite}
.ez-how ol{margin:6px 0 0;padding-left:20px;display:flex;flex-direction:column;gap:4px;font-size:14px;color:var(--muted)}
.ez-how b{color:var(--ink)}
.ez-home{display:flex;align-items:center;gap:12px;width:100%;text-align:left}
.ez-scene{display:flex;flex-direction:column;gap:6px;background:var(--sunk);box-shadow:none}
.ez-who{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}
.ez-whoc{display:inline-flex;align-items:center;gap:6px;font-size:13px;padding:2px 10px 2px 2px;border-radius:99px;background:var(--surface)}
.ez-tools{gap:12px;padding:14px}
.ez-steps{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.ez-step{display:flex;flex-direction:column;align-items:center;gap:3px;padding:10px 2px 8px;border-radius:14px;background:var(--sunk);text-align:center;min-width:0}
.ez-step b{font-size:13px;line-height:1.3;white-space:nowrap}
.ez-step small{font-size:11px;color:var(--muted);line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.ez-si{width:36px;height:36px;border-radius:50%;background:var(--surface);color:var(--ai);display:flex;align-items:center;justify-content:center;margin-bottom:2px}
.ez-step.ez-ok .ez-si{background:var(--good-soft);color:var(--good)}
.ez-step.ez-act{background:var(--ai);color:var(--on-ai)}
.ez-step.ez-act small{color:var(--on-ai);opacity:.85}
.ez-step.ez-act .ez-si{background:var(--on-ai);color:var(--ai)}
.ez-chips{display:flex;flex-wrap:wrap;gap:8px}
.ez-picker{display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:14px;background:var(--ai-soft);animation:up .2s ease}
.ez-pick{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px}
.ez-pickb{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:12px;background:var(--surface);box-shadow:var(--shadow);text-align:left;min-width:0}
.ez-pickb span{display:flex;flex-direction:column;line-height:1.3;min-width:0}
.ez-pickb small{font-size:11px;color:var(--muted)}
.ez-dlg{display:flex;flex-direction:column;gap:14px;padding:4px 0}
.ez-line{display:flex;align-items:flex-start;gap:8px;scroll-margin:96px 0 170px;transition:opacity .25s}
.ez-line.ez-r{flex-direction:row-reverse}
.ez-dlg.ez-playing .ez-line:not(.ez-on){opacity:.5}
.ez-bw{display:flex;flex-direction:column;align-items:flex-start;gap:4px;min-width:0;max-width:calc(100% - 50px)}
.ez-r .ez-bw{align-items:flex-end}
.ez-name{font-size:12px;color:var(--muted);padding-inline:4px}
.ez-name b{color:var(--c);font-weight:700;margin-right:2px}
.ez-bub{background:var(--surface);box-shadow:var(--shadow);border-radius:4px 16px 16px 16px;padding:8px 14px 10px;min-width:0;max-width:100%;transition:box-shadow .2s}
.ez-r .ez-bub{background:var(--cb);border-radius:16px 4px 16px 16px;box-shadow:none}
.ez-ja{font-family:var(--f-jp);font-size:17px;line-height:1.95;overflow-wrap:anywhere}
.ez-zh{display:none;font-size:13px;color:var(--muted);line-height:1.55;margin-top:2px;padding-top:4px;border-top:1px dashed var(--line)}
.ez-dlg.ez-zhall .ez-zh,.ez-line.ez-zh1 .ez-zh,.ez-line.ez-hid .ez-zh{display:block}
.ez-line.ez-hid .ez-zh{border-top:0;padding-top:0;color:var(--ink);font-size:14px}
.ez-ph{display:none}
.ez-line.ez-hid .ez-ja{display:none}
.ez-line.ez-hid .ez-ph{display:block;margin:4px 0 6px;padding:6px 10px;border:1.5px dashed var(--c);border-radius:10px;color:var(--c);font-size:13px;font-weight:700;width:100%;text-align:left}
.ez-line.ez-on .ez-bub{box-shadow:0 0 0 2.5px var(--gold),var(--shadow)}
.ez-line.ez-turn .ez-bub{box-shadow:0 0 0 2.5px var(--ai);animation:ezpulse 1.4s ease-in-out infinite}
@keyframes ezpulse{50%{box-shadow:0 0 0 6px var(--ai-soft)}}
.ez-acts{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding-inline:2px}
.ez-r .ez-acts{justify-content:flex-end}
.ez-acts .iconbtn{width:32px;height:32px;border-radius:10px}
.ez-acts .iconbtn .icon{width:17px;height:17px}
.ez-tr{font-size:13px;font-weight:700;color:var(--muted)}
.ez-scw{display:contents}
.ez-score{font-size:12px;font-weight:700;padding:2px 9px;border-radius:99px;white-space:nowrap}
.ez-score.g{background:var(--good-soft);color:var(--good)}
.ez-score.m{background:var(--gold-soft);color:var(--ink)}
.ez-score.b{background:var(--bad-soft);color:var(--bad)}
.ez-heard{font-size:12px;color:var(--muted);overflow-wrap:anywhere}
.ez-key{display:flex;flex-direction:column;gap:8px;background:var(--gold-soft);box-shadow:none}
.ez-keyja{font-family:var(--f-jp);font-size:22px;font-weight:700;line-height:1.8;overflow-wrap:anywhere}
.ez-keyzh{font-weight:700}
.ez-keyd{font-size:14px;line-height:1.75;color:var(--ink);padding-top:8px;border-top:1px dashed var(--line)}
.ez-note{display:flex;gap:10px;align-items:flex-start}
.ez-notep{font-family:var(--f-jp);font-weight:700;color:var(--ai);font-size:16px;overflow-wrap:anywhere}
.ez-noted{font-size:14px;line-height:1.75}
.ez-tip{display:flex;gap:12px;align-items:flex-start;font-size:14px;line-height:1.75}
.ez-tip .seal{border-color:var(--gold);color:var(--gold)}
.ez-q{display:flex;flex-direction:column;gap:10px;padding-top:14px;border-top:1px solid var(--line)}
.ez-qq{display:flex;gap:10px;align-items:flex-start}
.ez-q .q{font-family:var(--f-jp);font-size:18px;font-weight:700;line-height:2.1;overflow-wrap:anywhere}
.ez-q .opts{gap:8px}
.ez-q .opt{min-height:50px;padding:10px 8px;font-size:17px;box-shadow:none;background:var(--sunk)}
.ez-q .opt.ok{background:var(--good-soft)}.ez-q .opt.no{background:var(--bad-soft)}
.ez-q .why .row{font-family:var(--f-jp)}
.ez-q .why .iconbtn{width:32px;height:32px;background:var(--surface)}
.ez-res{display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;padding-top:14px;border-top:1px solid var(--line)}
.ez-res .bigstars .icon{width:44px;height:44px}
.ez-spacer{height:0}
.ez-spacer.on{height:150px}
.ez-player{position:fixed;left:0;right:0;bottom:calc(66px + env(safe-area-inset-bottom,0px));z-index:9;padding:0 10px 8px;pointer-events:none}
.ez-pin{pointer-events:auto;max-width:540px;margin:0 auto;background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:0 10px 30px rgba(10,14,26,.22);padding:10px 12px 12px;display:flex;flex-direction:column;gap:10px;animation:up .2s ease}
.ez-pin>.bar{height:4px}
.ez-prow{display:flex;align-items:center;gap:8px}
.ez-pmode{font-size:11px;font-weight:700;color:var(--ai);background:var(--ai-soft);border-radius:8px;padding:4px 7px;line-height:1.3;text-align:center;flex:none;max-width:64px}
.ez-pmsg{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.35}
.ez-pmsg b{display:flex;align-items:center;gap:4px;font-size:15px}
.ez-pmsg span{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ez-pin .iconbtn{width:38px;height:38px}
.ez-pin .ez-prow .btn.sm{padding:9px 10px}
.ez-rec{color:var(--bad);animation:ezblink 1s ease-in-out infinite}
@keyframes ezblink{50%{opacity:.35}}
.ez-cdbar{height:6px;border-radius:99px;background:var(--sunk);overflow:hidden}
.ez-cdbar>i{display:block;height:100%;width:0;background:var(--gold);border-radius:99px;animation-name:ezcd;animation-timing-function:linear;animation-fill-mode:forwards}
@keyframes ezcd{to{width:100%}}
@media (max-width:380px){.ez-step small{display:none}.ez-ja{font-size:16px}.ez-person{width:138px}}
`;
})();
