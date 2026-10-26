/* Yume · 我的（js/me.js）——等级、统计、日历、模块卡片插槽、徽章、称号、设置、存档备份、高级导入 */
(function(){
"use strict";
const Y=window.Yume;
const {esc,IC,dkey,today}=Y;
const ui={importMsg:"",restoreMsg:"",resetArm:false,resetAt:0,vtest:"",saveMsg:"",pending:null,snaps:null,snapBusy:false,snapArm:"",clearArm:false};
const fmtT=t=>{try{const d=new Date(t);return (d.getMonth()+1)+"月"+d.getDate()+"日 "+String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0")}catch(e){return ""}};
/* 「撤销」按钮带凭证：只能撤销刚刚这一次（存不下撤销副本时不显示按钮） */
const undoBtn=t=>t?` <button class="btn sm" data-act="undo-last" data-t="${esc(t)}" style="margin-left:8px">撤销</button>`:"";

/* ============ 存档与备份 ============ */
function loadSnaps(force){
  if(ui.snapBusy||(ui.snaps&&!force))return;
  ui.snapBusy=true;
  /* 读完只更新列表这一块，不重画整个「我的」页 */
  const show=()=>{if(Y.ui.tab!=="me")return;const el=document.getElementById("snapbox");if(el)el.innerHTML=snapsInner();else Y.render()};
  Y.snapList().then(l=>{ui.snaps=l;ui.snapBusy=false;show()}).catch(()=>{ui.snaps=[];ui.snapBusy=false;show()});
}
function pendingBox(S){
  const p=ui.pending;if(!p)return "";const i=p.info,c={xp:S.xp,words:Object.keys(S.words).length,days:Object.keys(S.days).length};
  const row=(t,o,extra)=>`<div class="row" style="justify-content:space-between;gap:8px"><span class="small muted">${t}</span><span class="small num"><b>XP ${o.xp}</b> · 单词 ${o.words} · 学过 ${o.days} 天${extra||""}</span></div>`;
  return `<div class="card stack" style="gap:8px;background:var(--ai-soft);box-shadow:none" id="pendbox">
    <b>要用这份存档吗？</b>
    ${row("存档里",i,i.updated?" · "+esc(fmtT(i.updated))+" 保存":"")}
    ${row("这台设备上现在",c)}
    <div class="small muted">「合并」：两边学过的都保留（比如把微信里和浏览器里的进度合到一起，推荐）。「覆盖」：完全换成存档里的进度。两种都可以马上撤销。</div>
    <div class="row" style="flex-wrap:wrap;gap:8px"><button class="btn primary sm grow" data-act="pend-merge">合并到现在的进度</button><button class="btn sm grow" data-act="pend-replace">用存档覆盖</button><button class="btn ghost sm" data-act="pend-cancel">取消</button></div>
  </div>`;
}
function snapsBox(){return `<div id="snapbox">${snapsInner()}</div>`}
function snapsInner(){
  if(!window.indexedDB)return `<div class="small muted">这个浏览器不支持自动备份，请定期保存存档文件。</div>`;
  loadSnaps(false);
  const l=ui.snaps&&ui.snaps.filter(x=>x.kind!=="broken");
  if(!l)return `<div class="small muted">正在读取……</div>`;
  if(!l.length)return `<div class="small muted">还没有自动备份：学习之后会每天自动存一份，保留最近 7 天。</div>`;
  return `<div class="snaps">${l.slice(0,12).map(x=>`<div class="setrow"><span>${esc(fmtT(x.t))}<div class="small muted">XP ${+x.xp||0} · 单词 ${+x.words||0}${x.note?" · "+esc(x.note):x.kind==="day"?" · 每日自动备份":""}</div></span>
    <button class="btn sm" data-act="snap-arm" data-id="${esc(x.id)}" style="${ui.snapArm===x.id?"background:var(--bad);color:#fff":""}">${ui.snapArm===x.id?"再点一次确认":"恢复到这里"}</button></div>`).join("")}</div>`;
}
function backupCard(S){
  const inapp=Y.pwa&&Y.pwa.inapp;
  return `<div class="card stack" style="gap:12px" id="backup"><div class="row" style="justify-content:space-between"><div class="eyebrow">存档与备份</div><span class="small ${Y.backupDue()?"":"muted"}" style="${Y.backupDue()?"color:var(--bad)":""}">${S.lastBackup?`上次备份：${Y.backupAgo()}`:"还没备份过"}</span></div>
    <div class="small muted">进度只存在这个浏览器里${inapp?`（现在是在「${esc(inapp)}」里打开的，和手机浏览器里的进度不互通）`:""}。隔几天存一次档，换手机、清了缓存都能找回来。存档里包括学习进度、视听库和字幕；AI 设置里的 API Key 不会存进去。</div>
    ${ui.saveMsg?`<div class="small" style="color:var(--bad)">${esc(ui.saveMsg)}</div>`:""}
    <div class="row" style="flex-wrap:wrap;gap:8px"><button class="btn primary sm grow" data-act="savefile">${inapp?"复制存档文字":"保存存档文件"}</button><label class="btn sm grow" for="rfile" style="cursor:pointer">从存档文件恢复</label><input type="file" id="rfile" data-change="rfile" accept=".json,application/json,text/plain" hidden></div>
    <div class="small muted">${inapp?`在${esc(inapp)}里没法下载文件，会改成复制存档文字：复制后粘贴到微信「文件传输助手」保存。`:"安卓 Chrome 会弹出分享，可以直接发到微信「文件传输助手」；别的浏览器会下载到「下载」文件夹。"}</div>
    <div class="row" style="flex-wrap:wrap;gap:8px;align-items:center"><button class="btn sm" data-act="copybk">复制存档文字</button><span class="small muted grow">复制的是学习进度（不含视听字幕），可以粘贴到微信里保存</span></div>
    <label class="field" for="rst">粘贴存档文字来恢复<textarea id="rst" placeholder='{"v":1,"xp":...}' style="min-height:72px"></textarea></label>
    <div class="row" style="flex-wrap:wrap;gap:8px"><button class="btn sm" data-act="restore">检查这份存档</button><span class="small" style="color:${msgColor(ui.restoreMsg)}">${esc(ui.restoreMsg)}</span></div>
    ${pendingBox(S)}
    <div class="eyebrow" style="margin-top:4px">自动备份 · 存在这台设备上，保留最近 7 天</div>
    ${snapsBox()}
    <div class="row" style="flex-wrap:wrap;gap:8px;margin-top:4px"><button class="btn sm" data-act="reset" style="${ui.resetArm?"background:var(--bad);color:#fff":""}">${ui.resetArm?"再点一次确认清空（可以撤销）":"清空学习进度"}</button></div></div>`;
}
const msgColor=m=>m.startsWith("✓")?"var(--good)":"var(--bad)";

function vMe(){
  const S=Y.S;const L=Y.level(),c=Y.counts();
  const cells=[];const end=new Date();
  const s0=new Date(end);s0.setDate(end.getDate()-((end.getDay()+6)%7)-7*15);
  for(let d=new Date(s0);d<=end;d.setDate(d.getDate()+1)){const x=S.days[dkey(d)]||0;const lv=x===0?0:x<20?1:x<50?2:x<100?3:4;cells.push(`<i class="l${lv}" title="${dkey(d)}：${x} XP"></i>`)}
  const sample=`{"lessons":[{
  "id":"my1","title":"我的课程","sub":"〜てください",
  "words":["窓|まど|窗户|名","開けます|あけます|打开|动2"],
  "grammar":[{"p":"〜てください","m":"请（别人）做……",
    "d":"用来礼貌地请求对方做某事。",
    "ex":[["窓[まど]を開[あ]けてください。","请打开窗户。"]]}],
  "quiz":[["窓[まど]を開[あ]け（　）ください。",["て","た","で","に"],"请打开窗户。","动词て形＋ください"]],
  "videos":[{"t":"讲解视频","u":"https://..."}]
}]}`;
  const best=Y.bestStreak(),cur=Y.streak();
  const sync=Y.syncState();const size=Y.stateSize(),big=size>200000;
  const theme=Y.store.get("theme","auto");
  const books=Y.BOOKS;
  return `<div class="stack">
  <div class="card lvcard"><div class="lvbig"><small>Lv</small><b class="num">${L.k}</b></div><div class="grow stack" style="gap:8px"><div class="row" style="justify-content:space-between"><b>距离 Lv ${L.k+1}</b><span class="small muted num">${S.xp-L.from} / ${L.to-L.from} XP</span></div><div class="bar gold"><i style="width:${(S.xp-L.from)/(L.to-L.from)*100}%"></i></div></div></div>
  <div class="stats">
    <div class="stat"><b class="num">${cur}</b><span>当前连续天数</span></div>
    <div class="stat"><b class="num">${best}</b><span>最长连续</span></div>
    <div class="stat"><b class="num">${Object.keys(S.days).filter(k=>S.days[k]>0).length}</b><span>累计学习天数</span></div>
    <div class="stat"><b class="num">${c.learned}</b><span>已学单词</span></div>
    <div class="stat"><b class="num">${c.mastered}</b><span>已熟记</span></div>
    <div class="stat"><b class="num">${Object.keys(S.grammar).length}</b><span>已掌握语法</span></div>
  </div>
  <div class="slot stack">${Y.cards("me")}</div>
  <div class="card stack" style="gap:10px"><div class="row" style="justify-content:space-between"><div class="eyebrow">学习日历 · 近 16 周</div><span class="small muted">颜色越深 XP 越多</span></div><div class="heat">${cells.join("")}</div></div>
  <div class="card stack" style="gap:12px"><div class="row" style="justify-content:space-between"><div class="eyebrow">徽章</div><span class="small muted num">${Y.BADGES.filter(b=>S.badges[b.id]).length}/${Y.BADGES.length}</span></div>
    <div class="badges">${Y.BADGES.map(b=>`<div class="badge ${S.badges[b.id]?"on":""}"><span class="k" lang="ja">${esc(b.k)}</span><b>${esc(b.t)}</b><span>${esc(b.d)}</span></div>`).join("")}</div></div>
  <div class="card stack" style="gap:6px"><div class="row" style="justify-content:space-between"><div class="eyebrow">连胜称号</div><span class="small muted">按最长连续天数解锁</span></div>
    <div class="titles">${Y.TITLES.map(t=>{const on=!!S.titles[t.d]||best>=t.d;const left=Math.max(0,t.d-cur);return `<div class="trow ${on?"":"off"}"><span class="seal" lang="ja">${t.k}</span><div class="grow"><b>${esc(t.t)}</b><div class="small muted">连续 ${t.d} 天 · ${esc(t.tip)}</div></div><span class="small ${on?"":"muted"} num" style="${on?"color:var(--good)":""}">${on?"已获得":"还差 "+left+" 天"}</span></div>`}).join("")}</div></div>
  <div class="card"><div class="eyebrow" style="margin-bottom:4px">学习设置</div>
    <div class="setrow"><label for="strack">每日新词来自</label><select id="strack" data-change="strack">${books.map(b=>`<option value="${b.id}" ${Y.trackBook().id===b.id?"selected":""} ${Y.bookLessons(b.id).length?"":"disabled"}>${b.lv} ${esc(b.t)}${Y.bookLessons(b.id).length?"":"（准备中）"}</option>`).join("")}</select></div>
    <div class="setrow"><label for="snew">每天新词数</label><select id="snew" data-change="snew">${[5,10,15,20,30].map(n=>`<option ${S.settings.newPerDay===n?"selected":""}>${n}</option>`).join("")}</select></div>
    <div class="setrow"><label for="sgoal">每日目标 XP</label><select id="sgoal" data-change="sgoal">${[30,50,100,150].map(n=>`<option ${S.settings.goal===n?"selected":""}>${n}</option>`).join("")}</select></div>
    <div class="setrow" id="voiceset"><label for="svoice">发音来源<div class="small muted">${esc(Y.voiceStatus())}</div></label><select id="svoice" data-change="svoice">${[["auto","自动（推荐）"],["online","在线发音"],["system","手机自带语音"]].map(([k,t])=>`<option value="${k}" ${(S.settings.voice||"auto")===k?"selected":""}>${t}</option>`).join("")}</select></div>
    <div class="setrow"><label for="sspeed">语速</label><select id="sspeed" data-change="sspeed">${[[.8,"慢"],[1,"正常"],[1.15,"快"]].map(([k,t])=>`<option value="${k}" ${Math.abs((+S.settings.speed||1)-k)<.01?"selected":""}>${t}</option>`).join("")}</select></div>
    <div class="setrow"><span>试听发音<div class="small muted">${esc(ui.vtest||"读一句日语，确认有没有声音")}</div></span><button class="btn sm" data-act="vtest">${IC.spk}试听</button></div>
    <div class="setrow"><span>出题时自动发音</span><button class="switch" role="switch" aria-checked="${S.settings.autoSpeak}" aria-label="自动发音" data-act="autosp"></button></div>
    ${Y.tts.ja()?"":Y.voiceHelp(true)}
    <div class="setrow"><span>振假名<div class="small muted">在例句和题目的汉字上方显示读音</div></span><button class="switch" role="switch" aria-checked="${Y.furiOn()}" aria-label="振假名" data-act="furi"></button></div>
    <div class="setrow"><label for="stheme">外观<div class="small muted">只对这台设备生效</div></label><select id="stheme" data-change="stheme">${[["auto","跟随系统"],["light","浅色"],["dark","深色"]].map(([k,t])=>`<option value="${k}" ${theme===k?"selected":""}>${t}</option>`).join("")}</select></div>
    <div class="setrow"><span>进度保存${big?`<div class="small muted">存档已有 ${Math.round(size/1024)} KB，比较大了</div>`:""}</span><span class="small ${sync==="full"||sync==="big"?"":"muted"}" style="${sync==="full"||sync==="big"?"color:var(--bad);text-align:right":""}">${sync==="full"?"本机存储已满，进度没能保存！请删掉不用的视听字幕，或先保存存档文件":sync==="cloud"?"已同步到你的账号":sync==="big"?"存档太大，云同步已暂停":"保存在这个浏览器"}</span></div></div>
  ${backupCard(S)}
  <details class="adv" ${ui.importMsg?"open":""}><summary><div class="grow"><b>高级：导入自制课程</b><div class="small muted">把自己整理的单词、语法、练习题按格式粘贴进来</div></div></summary><div class="in">
    <div class="small muted"><code>id</code> 写已有课的编号（如 <code>3</code>、<code>b2-25</code>）会并入那一课，写别的会新建一课。单词格式：日文|假名|中文|词性；例句里「漢字[かな]」会显示成振假名。</div>
    <pre>${esc(sample)}</pre>
    <label class="field" for="imp">粘贴 JSON<textarea id="imp" placeholder='{"lessons":[...]}'></textarea></label>
    <div class="row" style="flex-wrap:wrap"><button class="btn primary sm" data-act="import">导入</button>${Y.importedCustom().length?`<button class="btn sm" data-act="clearimp">清除已导入的 ${Y.importedCustom().length} 项</button>`:""}<span class="small" style="color:${msgColor(ui.importMsg)}">${esc(ui.importMsg)}</span></div></div></details>
  <div class="small muted" style="text-align:center">yume 愚昧酱日语 v${esc(Y.version)} · 单词、例句、讲解均为原创，按新版标准日本语的难度与语法顺序编写</div></div>`;
}

function restoreFrom(text,src){
  try{const info=Y.backupInfo(text);ui.pending={text,info,src};ui.restoreMsg=""}
  catch(e){ui.pending=null;ui.restoreMsg="恢复失败："+(e.message||"格式不对")}
  Y.render();setTimeout(()=>{const b=document.getElementById("pendbox");if(b)b.scrollIntoView({block:"center"})},30);
}
function applyPending(mode){
  const p=ui.pending;if(!p)return;ui.pending=null;
  const r=Y.restore(p.text,{mode});ui.restoreMsg=r.msg;
  if(r.ok){const t=document.getElementById("rst");if(t)t.value="";ui.snaps=null;Y.toast(esc(r.msg.replace(/^✓\s*/,""))+undoBtn(r.undo),9000)}
  Y.render();
}

Y.registerTab({id:"me",label:"我的",icon:"me",order:50,render:vMe});
let lastTab="";Y.onRender(t=>{
  if(t==="me"&&lastTab!=="me")loadSnaps(true);
  lastTab=t});
const A=Y.registerAction;
A("autosp",()=>{Y.S.settings.autoSpeak=!Y.S.settings.autoSpeak;Y.save();Y.render()});
A("svoice",(d,el)=>{if(!["auto","online","system"].includes(el.value))return;Y.S.settings.voice=el.value;ui.vtest="";Y.save();Y.render()});
A("sspeed",(d,el)=>{const v=+el.value;if(!(v>=.6&&v<=1.5))return;Y.S.settings.speed=v;Y.save();Y.render();Y.speak("ゆっくり、はっきり。")});
A("vtest",()=>{ui.vtest="正在播放……";Y.render();Y.tts.test().then(r=>{
  const src=r.engine==="online"?"在线发音":"手机自带语音";
  ui.vtest=r.ok?`✓ 用${src}播放成功（${(r.ms/1000).toFixed(1)} 秒）。没听到声音的话，检查手机音量和静音键。`:
    r.err==="blocked"?"浏览器拦住了自动播放，请再点一次「试听」。":
    r.err&&r.err.indexOf("online")===0?"在线发音失败：网络连不上有道，请检查网络，或改用「手机自带语音」。":
    "手机自带语音没有读出来，请改用「在线发音」，或按下面的说明安装日语语音。";
  Y.render()})});
A("snew",(d,el)=>{Y.S.settings.newPerDay=+el.value;Y.save();Y.render()});
A("sgoal",(d,el)=>{Y.S.settings.goal=+el.value;Y.save();Y.render()});
A("strack",(d,el)=>{if(Y.book(el.value)){Y.S.settings.track=el.value;Y.save();Y.render();Y.toast("每日新词改为从「"+esc(Y.book(el.value).t)+"」出")}});
A("stheme",(d,el)=>{Y.setTheme(el.value);Y.render()});
A("rfile",(d,el)=>{const f=el.files&&el.files[0];if(!f)return;const r=new FileReader();r.onload=()=>restoreFrom(String(r.result||""),"file");r.onerror=()=>{ui.restoreMsg="恢复失败：读不出这个文件";Y.render()};r.readAsText(f);el.value=""});
A("pend-merge",()=>applyPending("merge"));
A("pend-replace",()=>applyPending("replace"));
A("pend-cancel",()=>{ui.pending=null;Y.render()});
A("undo-last",d=>{const r=Y.undoLast(d.t||"");ui.snaps=null;Y.toast(r.ok?"已撤销，恢复到操作之前的进度":esc(r.msg));Y.render()});
A("snap-arm",d=>{
  if(ui.snapArm!==d.id){ui.snapArm=d.id;Y.render();setTimeout(()=>{if(ui.snapArm===d.id){ui.snapArm="";Y.render()}},5000);return}
  ui.snapArm="";Y.snapRestore(d.id).then(r=>{ui.snaps=null;ui.restoreMsg=r.msg;if(r.ok)Y.toast(esc(r.msg.replace(/^✓\s*/,""))+undoBtn(r.undo),9000);Y.render()});
});
A("gobackup",()=>{Y.go("me");const b=document.getElementById("backup");if(b)b.scrollIntoView({block:"start"})});
A("import",()=>{
  const S=Y.S;const ta=document.getElementById("imp");
  try{const j=JSON.parse(ta?ta.value:"");const ls=Array.isArray(j)?j:j.lessons;if(!Array.isArray(ls)||!ls.length)throw new Error("没找到 lessons 数组");
    let nw=0,nv=0;
    for(const c of ls){if(!c||c.id==null)throw new Error("每一课都需要 id");const id=String(c.id).slice(0,40);
      const clean={id,title:String(c.title||"").slice(0,60),sub:String(c.sub||"").slice(0,60),words:(Array.isArray(c.words)?c.words:[]).map(String).slice(0,500),grammar:(Array.isArray(c.grammar)?c.grammar:[]).slice(0,50),quiz:(Array.isArray(c.quiz)?c.quiz:[]).slice(0,100)};
      nw+=clean.words.length;S.custom.push(clean);
      for(const v of Array.isArray(c.videos)?c.videos:[]){const u=Y.safeUrl(v&&v.u);if(u){(S.videos[id]=S.videos[id]||[]).push({t:String(v.t||"").slice(0,80),u});nv++}}}
    Y.rebuild();Y.checkBadges();Y.save();ui.importMsg=`✓ 导入了 ${ls.length} 课、${nw} 个单词、${nv} 个链接`;
  }catch(e){ui.importMsg="导入失败："+(e.message||"JSON 格式不对")}
  Y.render();
});
A("clearimp",()=>{
  if(!ui.clearArm){ui.clearArm=true;ui.importMsg="再点一次「清除」确认（导入课程里的单词进度会看不到）";Y.render();setTimeout(()=>{if(ui.clearArm){ui.clearArm=false;ui.importMsg="";Y.render()}},5000);return}
  ui.clearArm=false;Y.snapPut("before","清除导入课程之前");Y.S.custom=(Y.S.custom||[]).filter(Y.isWordList);Y.rebuild();Y.save();ui.importMsg="✓ 已清除导入的内容（会话生词、视听生词保留）";Y.render()});
function markBackup(){Y.S.lastBackup=today();ui.saveMsg="";Y.save();Y.render()}
A("savefile",()=>{
  const inapp=Y.pwa&&Y.pwa.inapp;
  /* 微信等 App 里：下载会「成功」但其实没存下任何东西，所以直接改成复制存档文字，也不记为已备份 */
  if(inapp){ui.saveMsg="在「"+inapp+"」里没法下载文件，已改为复制存档文字：粘贴到微信「文件传输助手」里保存。";copyBackup();Y.render();return}
  const data=Y.backupText();const name="yume存档-"+today()+".json";
  const download=()=>{
    try{const url=URL.createObjectURL(new Blob([data],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000);
      markBackup();Y.toast("已保存存档文件："+esc(name)+"（在「下载」文件夹里）")}
    catch(e){Y.toast("这里没法下载，改为复制存档文字");copyBackup()}
  };
  /* 安卓 Chrome 等支持分享文件：弹出系统分享，可以直接发到微信「文件传输助手」 */
  let file=null;try{file=new File([data],name,{type:"application/json"})}catch(e){}
  let can=false;try{can=!!(file&&navigator.canShare&&navigator.share&&navigator.canShare({files:[file]}))}catch(e){}
  if(can){navigator.share({files:[file],title:name}).then(()=>{markBackup();Y.toast("存档已发出，记得在对方那边确认收到了")},err=>{if(err&&err.name==="AbortError")Y.toast("已取消");else download()});return}
  download();
});
A("restore",()=>{const t=document.getElementById("rst");restoreFrom(t?t.value:"","paste")});
/* 复制存档文字：直接写进剪贴板。不在页面里放一个几十万字的文本框（慢手机上光排版就要一两秒，而且每次刷新页面都要再来一遍）。
 * 复制的只有学习进度（单词进度压缩过），不含视听字幕；字幕在「保存存档文件」里。
 * 剪贴板用不了（有的 App 内置浏览器）：弹出单独的一页，让用户长按全选复制。 */
function copyBackup(){
  const text=Y.backupText({lite:true,noSubs:true});
  const ok=()=>{markBackup();Y.toast(`已复制存档（${text.length} 字）。请粘贴到微信「文件传输助手」保存，确认最后一个字是「}」。`,9000)};
  try{navigator.clipboard.writeText(text).then(ok,()=>showCopyBox(text))}catch(e){showCopyBox(text)}
}
function showCopyBox(text){
  Y.openOverlay(`<div class="sin stack" style="gap:12px">
    <div class="row"><b class="grow" style="font-size:18px">复制存档文字</b><button class="iconbtn" data-act="copybox-close" aria-label="关闭">${IC.close}</button></div>
    <div class="small muted">这个浏览器不能自动复制。请长按下面的文本框 →「全选」→「复制」，然后粘贴到微信「文件传输助手」保存。共 ${text.length} 字，粘贴后确认最后一个字是「}」。</div>
    <textarea id="copybox" readonly wrap="off" spellcheck="false" style="min-height:42vh;font-size:12px"></textarea>
    <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn sm grow" data-act="copybox-sel">全选</button><button class="btn sm grow" data-act="copybox-try">再试自动复制</button><button class="btn primary sm grow" data-act="copybox-done">我已经复制好了</button></div></div>`);
  const ta=document.getElementById("copybox");if(ta)ta.value=text;
}
A("copybk",()=>copyBackup());
A("copybox-close",()=>Y.closeOverlay());
A("copybox-sel",()=>{const ta=document.getElementById("copybox");if(!ta)return;try{ta.focus();ta.select();ta.setSelectionRange(0,ta.value.length)}catch(e){}});
A("copybox-try",()=>{const ta=document.getElementById("copybox");if(!ta)return;try{navigator.clipboard.writeText(ta.value).then(()=>{Y.closeOverlay();markBackup();Y.toast("已复制，记得粘贴保存")},()=>Y.toast("还是不能自动复制，请长按文本框全选后复制"))}catch(e){Y.toast("请长按文本框全选后复制")}});
A("copybox-done",()=>{Y.closeOverlay();markBackup();Y.toast("好的。记得确认粘贴进去的内容是完整的（最后一个字是「}」）",6000)});
A("reset",()=>{
  if(!ui.resetArm){ui.resetArm=true;ui.resetAt=Date.now();Y.render();setTimeout(()=>{if(ui.resetArm){ui.resetArm=false;Y.render()}},5000);return}
  if(Date.now()-ui.resetAt<700)return;/* 连点两下（误触）不算确认 */
  ui.resetArm=false;const ut=Y.resetProgress();ui.snaps=null;Y.render();Y.toast("进度已清空。"+undoBtn(ut),10000)});
})();
