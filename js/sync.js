/* Yume · 多设备同步（同步码）（js/sync.js）
 * 不用注册：开启后服务器给一串 12 位的同步码，在另一台设备上输入它，两边的进度合并到一起，之后自动保持同步。
 * - 只同步学习进度 S（单词、语法、XP、连胜、各模块记录、设置）。AI Key、字幕、视听库这些本机数据不同步。
 * - 合并规则和多个页面之间的合并相同（Yume.mergeWithBase）：两边学的都保留，XP 相加、不重复计算。
 *   base = 本设备上一次和云端对上时的进度（存在本机），用来算出「本设备新拿了多少 XP」。
 * - 什么时候同步：打开网站时、保存后 5 秒（连续答题只同步一次）、切回页面时（距上次 20 秒以上）、切到后台时、重新联网时。
 * - 服务器：POST /api/sync（netlify/functions/sync.mjs，协议见 netlify/sync-core.mjs）。
 *   网址不支持时（claude.ai 预览、直接拖文件夹部署的网站），卡片里会说明。
 * 本机记录（Yume.store "sync"）：{code, rev:云端版本, base, last:上次成功同步的时间, pushed:上次上传时的 S.updated, err} */
(function(){
"use strict";
const Y=window.Yume,W=window;
const {esc,IC}=Y;
const API="/api/sync";
const SK="sync";
const ALPHABET="23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const DEF=()=>({code:"",rev:0,base:null,last:0,pushed:0,err:""});
const st=()=>{const o=Y.store.get(SK,null);return Object.assign(DEF(),o&&typeof o==="object"&&!Array.isArray(o)?o:{})};
const setSt=p=>{const o=Object.assign(st(),p);Y.store.set(SK,o);return o};
/* 界面状态（不保存） */
const U={avail:null,busy:false,join:false,stopArm:0,delArm:0,msg:""};

/* ============ 工具 ============ */
function normCode(s){
  const c=String(s==null?"":s).toUpperCase().replace(/[\s\-_.]/g,"");
  if(c.length!==12)return "";
  for(const ch of c)if(ALPHABET.indexOf(ch)<0)return "";
  return c;
}
const fmtCode=c=>c?c.slice(0,4)+"-"+c.slice(4,8)+"-"+c.slice(8):"";
/* 比较两份进度是否相同：键排序后序列化，忽略 updated */
function stable(x){
  if(Array.isArray(x))return "["+x.map(stable).join(",")+"]";
  if(x&&typeof x==="object")return "{"+Object.keys(x).sort().map(k=>JSON.stringify(k)+":"+stable(x[k])).join(",")+"}";
  return JSON.stringify(x===undefined?null:x);
}
const sig=o=>stable(Object.assign({},Y.packCloud(o,true),{updated:0}));
const pack=o=>Y.packCloud(o,true);
const unpack=d=>Y.merge(Y.unpackCloud(JSON.parse(JSON.stringify(d||{}))));
function ago(t){
  if(!t)return "";
  const s=Math.round((Date.now()-t)/1000);
  if(s<60)return "刚刚";if(s<3600)return Math.floor(s/60)+" 分钟前";if(s<86400)return Math.floor(s/3600)+" 小时前";
  return new Date(t).toLocaleDateString("zh-CN");
}
async function call(op,body){
  if(typeof W.fetch!=="function")throw new Error("nofetch");
  const ctl=typeof W.AbortController==="function"?new W.AbortController():null;
  const timer=setTimeout(()=>{try{if(ctl)ctl.abort()}catch(e){}},15000);
  try{
    const r=await W.fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.assign({op},body||{})),
      cache:"no-store",credentials:"same-origin",signal:ctl?ctl.signal:undefined});
    let j=null;try{j=await r.json()}catch(e){}
    return {status:r.status,j:j||{}};
  }finally{clearTimeout(timer)}
}
/* 网址支不支持同步：服务器返回 404/405/501 说明这里没有同步后台；连不上网就先当作「不确定」 */
async function ping(){
  try{const r=await call("ping");U.avail=r.status===200&&!!r.j.ok}
  catch(e){U.avail=null}
  return U.avail;
}

/* 同一台设备开着好几个页面时，一次只让一个页面同步（别的页面通过本机存档的合并拿到结果） */
const TABID=Math.random().toString(36).slice(2,10);
const LK="yume-sync-lock";
function lock(){
  try{const now=Date.now();const v=W.localStorage.getItem(LK);
    if(v){const o=JSON.parse(v);if(o&&o.tab!==TABID&&now-(+o.t||0)<20000)return false}
    W.localStorage.setItem(LK,JSON.stringify({tab:TABID,t:now}));return true}catch(e){return true}
}
function unlock(){try{const v=W.localStorage.getItem(LK);if(v&&JSON.parse(v).tab===TABID)W.localStorage.removeItem(LK)}catch(e){}}

/* ============ 同步 ============ */
let adopting=false;
/* 换进合并结果；如果另一台设备清空或覆盖了进度（纪元变了、XP 变少），先在本机自动备份里留一份 */
function adoptMerged(m,why){
  const S=Y.S;
  if((m.epoch||"")!==(S.epoch||"")||(+m.xp||0)<(+S.xp||0)){try{Y.snapPut("before",why||"同步前")}catch(e){}}
  adopting=true;try{Y.adopt(m)}finally{adopting=false}
}
let running=null,again=false,retryT=null,retryN=0;
function syncNow(reason){
  if(!st().code)return Promise.resolve({ok:false,err:"off"});
  if(running){again=true;return running}
  running=doSync(reason).catch(e=>{console.error("[yume] 同步出错",e);return {ok:false,err:"bug"}}).then(r=>{
    running=null;
    if(again){again=false;setTimeout(()=>syncNow("again"),300)}
    return r;
  });
  return running;
}
async function doSync(){
  let s=st();if(!s.code)return {ok:false,err:"off"};
  if(!lock()){retry(8000);return {ok:false,err:"locked"}}
  U.busy=true;paint();
  try{
    for(let i=0;i<4;i++){
      const g=await call("get",{code:s.code});
      if(g.status===404){setSt({err:"notfound"});return {ok:false,err:"notfound"}}
      if(g.status!==200||!g.j.ok)throw new Error("http "+g.status);
      const remote=unpack(g.j.data),rrev=+g.j.rev||0;
      if(rrev!==s.rev){
        /* 云端有别的设备的新进度：合并进来。合并后两边共同的部分就是云端这一份 */
        const m=Y.mergeWithBase(Y.S,remote,s.base,false);
        if(sig(m)!==sig(Y.S))adoptMerged(m,"同步前（另一台设备清空或覆盖了进度）");
        s=setSt({rev:rrev,base:Y.baseOf(remote)});
      }
      const cur=Y.S;
      if(sig(cur)!==sig(remote)){
        const p=await call("put",{code:s.code,rev:rrev,data:pack(cur)});
        if(p.status===409)continue;/* 刚好别的设备也在写：重新读、合并、再写 */
        if(p.status===404){setSt({err:"notfound"});return {ok:false,err:"notfound"}}
        if(p.status===413){setSt({err:"toolarge"});return {ok:false,err:"toolarge"}}
        if(p.status!==200||!p.j.ok)throw new Error("http "+p.status);
        s=setSt({rev:+p.j.rev,base:Y.baseOf(cur),last:Date.now(),pushed:cur.updated||0,err:""});
      }else{
        s=setSt({base:Y.baseOf(cur),last:Date.now(),pushed:cur.updated||0,err:""});
      }
      retryN=0;
      return {ok:true};
    }
    setSt({err:"busy"});retry();
    return {ok:false,err:"busy"};
  }catch(e){
    setSt({err:"net"});retry();
    return {ok:false,err:"net"};
  }finally{U.busy=false;unlock();paint()}
}
/* 失败后自动重试：30 秒、2 分钟、5 分钟、之后每 10 分钟 */
function retry(ms){
  clearTimeout(retryT);
  const d=ms||[30e3,120e3,300e3,600e3][Math.min(retryN++,3)];
  retryT=setTimeout(()=>{if(st().code&&(!W.document||W.document.visibilityState!=="hidden"))syncNow("retry")},d);
}

/* 开启：生成同步码，上传当前进度 */
async function create(){
  if(U.busy)return;
  U.busy=true;U.msg="";paint();
  try{
    const S=Y.S;
    const r=await call("create",{data:pack(S)});
    if(r.status===200&&r.j.ok&&normCode(r.j.code)){
      setSt({code:r.j.code,rev:+r.j.rev||1,base:Y.baseOf(S),last:Date.now(),pushed:S.updated||0,err:""});
      U.msg="";Y.toast("已开启同步。在另一台设备上输入同步码就能同步进度");
    }else if(r.status===429)U.msg="今天生成同步码的次数太多了，明天再试。";
    else if(r.status===404||r.status===405||r.status===501){U.avail=false;U.msg=""}
    else U.msg="没能开启同步（服务器出错），请稍后再试。";
  }catch(e){U.msg="连不上服务器，请检查网络后再试。"}
  finally{U.busy=false;paint()}
}
/* 加入：输入别的设备上的同步码，两边进度合并（第一次合并时两边都保留，见 mergeProgress 的 force） */
async function join(input){
  const code=normCode(input);
  if(!code){U.msg="同步码是 12 位，只有数字 2–9 和字母（没有 0、1、I、L、O），请检查一下。";paint();return}
  if(U.busy)return;
  U.busy=true;U.msg="";paint();
  try{
    const g=await call("get",{code});
    if(g.status===404){U.msg=g.j&&g.j.err==="code"?"同步码格式不对，请检查一下。":"找不到这个同步码：可能输错了，或者已经在别的设备上删除了。";return}
    if(g.status===405||g.status===501){U.avail=false;return}
    if(g.status!==200||!g.j.ok){U.msg="服务器出错，请稍后再试。";return}
    const remote=unpack(g.j.data);
    try{Y.snapPut("before","加入同步之前")}catch(e){}
    const m=Y.mergeWithBase(Y.S,remote,null,true);
    adoptMerged(m);
    setSt({code,rev:+g.j.rev||0,base:Y.baseOf(remote),last:0,pushed:0,err:""});
    U.join=false;
  }catch(e){U.msg="连不上服务器，请检查网络后再试。";return}
  finally{U.busy=false;paint()}
  const r=await syncNow("join");
  Y.toast(r.ok?"已同步：两台设备的进度合并好了":"已加入同步，但这次上传没成功，稍后会自动重试");
}
function stopHere(){clearTimeout(retryT);clearTimeout(pushT);Y.store.set(SK,DEF());U.msg="";paint()}
async function deleteCloud(){
  const s=st();if(!s.code)return;
  U.busy=true;paint();
  try{
    const r=await call("delete",{code:s.code});
    if(r.status===200&&r.j.ok){stopHere();Y.toast("云端数据已删除，这台设备上的进度不受影响")}
    else U.msg="没能删除，请稍后再试。";
  }catch(e){U.msg="连不上服务器，请检查网络后再试。"}
  finally{U.busy=false;paint()}
}

/* ============ 自动同步 ============ */
let pushT=null;
Y.onSaved(()=>{
  if(adopting||!st().code)return;
  clearTimeout(pushT);pushT=setTimeout(()=>syncNow("save"),5000);
});
const on=(t,ev,fn)=>{try{if(t&&typeof t.addEventListener==="function")t.addEventListener(ev,fn)}catch(e){}};
on(W.document,"visibilitychange",()=>{
  const s=st();if(!s.code)return;
  if(W.document.visibilityState==="visible"){if(Date.now()-s.last>20000)syncNow("show")}
  else if((Y.S.updated||0)!==s.pushed){clearTimeout(pushT);syncNow("hide")}
});
on(W,"online",()=>{if(st().code)syncNow("online")});
/* 打开网站时同步一次（等启动和自动恢复完成） */
setTimeout(()=>{if(st().code)syncNow("boot")},1500);
/* 开着同步、最近 3 天同步成功过：不再提醒「该存档了」 */
Y.setBackupOK(()=>{const s=st();return !!s.code&&!s.err&&Date.now()-s.last<3*864e5});

/* ============ 「我的」页卡片 ============ */
function paint(){
  const d=W.document;const el=d&&d.getElementById&&d.getElementById("synccard");
  if(!el)return;
  /* 重画时保留输入框里已经填的同步码 */
  const i=d.getElementById("sync-code"),v=i?i.value:"",f=i&&d.activeElement===i;
  el.outerHTML=card();
  const j=d.getElementById("sync-code");if(j&&v){j.value=v;if(f)try{j.focus()}catch(e){}}
}
function card(){
  const s=st();
  const head=`<div class="row" style="justify-content:space-between"><div class="eyebrow">多设备同步</div>${s.code?`<span class="small" style="color:var(--good)">已开启</span>`:""}</div>`;
  const msg=U.msg?`<div class="small" style="color:var(--bad)">${esc(U.msg)}</div>`:"";
  if(U.avail===false&&!s.code)return `<div class="card stack" id="synccard" style="gap:8px">${head}
    <div class="small muted">这个网址用不了同步。请用正式网址 <b>yume-nihongo.netlify.app</b> 打开。</div></div>`;
  if(!s.code){
    return `<div class="card stack" id="synccard" style="gap:10px">${head}
      <div>手机、电脑之间同步学习进度，不用注册。开启后会得到一串<b>同步码</b>，在另一台设备上输入它就行。</div>
      <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn primary sm grow" data-act="sync-create" ${U.busy?"disabled":""}>${IC.refresh||""}开启同步</button><button class="btn sm grow" data-act="sync-join-open" ${U.busy?"disabled":""}>我有同步码</button></div>
      ${U.join?`<div class="row" style="gap:8px"><input id="sync-code" class="grow" inputmode="text" autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="20" placeholder="XXXX-XXXX-XXXX" aria-label="同步码" style="font:inherit;font-size:17px;letter-spacing:.06em;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink);min-width:0">
        <button class="btn primary sm" data-act="sync-join" ${U.busy?"disabled":""}>${U.busy?"同步中…":"同步"}</button></div>
        <div class="small muted">输入后，这台设备和那台设备上学过的内容会合并在一起，都保留。</div>`:""}
      ${msg}
      <div class="small muted">开启后，学习进度（不含 AI Key、字幕和视听库）会保存在本网站的服务器上，只有知道同步码的人能读取。</div></div>`;
  }
  const status=U.busy?"正在同步……":
    s.err==="net"?"上次同步没成功（网络问题），稍后会自动重试":
    s.err==="notfound"?"云端找不到这份进度了：可能已经在别的设备上删除。":
    s.err==="toolarge"?"进度太大，上传不了":
    s.err==="busy"?"刚才有好几台设备同时在写，稍后会自动重试":
    s.last?"上次同步："+ago(s.last):"还没同步过";
  const now=Date.now();
  return `<div class="card stack" id="synccard" style="gap:10px">${head}
    <div class="row" style="gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap">
      <div><div class="small muted">同步码</div><b class="num" style="font-size:20px;letter-spacing:.08em;user-select:all">${esc(fmtCode(s.code))}</b></div>
      <button class="btn sm" data-act="sync-copy">${IC.link||""}复制</button></div>
    <div class="row" style="gap:8px;justify-content:space-between;align-items:center;flex-wrap:wrap">
      <span class="small ${s.err?"":"muted"}" ${s.err?'style="color:var(--bad)"':""}>${esc(status)}</span>
      ${s.err==="notfound"?`<button class="btn primary sm" data-act="sync-recreate" ${U.busy?"disabled":""}>用这台设备的进度重新开启</button>`:`<button class="btn sm" data-act="sync-now" ${U.busy?"disabled":""}>${IC.refresh||""}立即同步</button>`}</div>
    ${msg}
    <div class="small muted">在另一台设备上：打开 yume →「我的」→「多设备同步」→「我有同步码」，输入上面这串。</div>
    <div class="small muted">请把同步码发到微信「文件传输助手」或记在备忘录里：清了缓存、换了手机，都靠它找回进度。同步码就像钥匙，别发给不认识的人。</div>
    <div class="row" style="gap:8px;flex-wrap:wrap">
      <button class="btn sm grow" data-act="sync-stop">${now-U.stopArm<5000?"再点一次：这台设备停止同步":"这台设备停止同步"}</button>
      <button class="btn sm grow" data-act="sync-del" style="color:var(--bad)" ${U.busy?"disabled":""}>${now-U.delArm<5000?"再点一次：删除云端数据":"删除云端数据"}</button></div>
  </div>`;
}
Y.registerCard("me",card,{order:5});

let pinged=false;
Y.onRender(()=>{if(Y.ui.tab==="me"&&!pinged&&!st().code){pinged=true;ping().then(v=>{if(v===false)paint()})}});

const A=Y.registerAction;
A("sync-create",()=>create());
A("sync-recreate",()=>{stopHere();create()});
A("sync-join-open",()=>{U.join=!U.join;U.msg="";paint();setTimeout(()=>{const i=W.document.getElementById("sync-code");if(i)i.focus()},30)});
A("sync-join",()=>{const i=W.document.getElementById("sync-code");join(i?i.value:"")});
A("sync-now",()=>{syncNow("manual").then(r=>{if(r&&r.ok)Y.toast("已同步")})});
A("sync-copy",()=>{
  const c=fmtCode(st().code);const done=()=>Y.toast("同步码已复制");
  try{W.navigator.clipboard.writeText(c).then(done,()=>Y.toast("请长按同步码复制",5000))}catch(e){Y.toast("请长按同步码复制",5000)}
});
A("sync-stop",()=>{
  if(Date.now()-U.stopArm<5000){U.stopArm=0;stopHere();Y.toast("这台设备已停止同步；云端数据还在，其他设备不受影响");return}
  U.stopArm=Date.now();paint();setTimeout(paint,5100);
});
A("sync-del",()=>{
  if(Date.now()-U.delArm<5000){U.delArm=0;deleteCloud();return}
  U.delArm=Date.now();paint();setTimeout(paint,5100);
});

Y.sync={state:st,syncNow,create,join,stop:stopHere,deleteCloud,ping,normCode,fmtCode,_ui:U};
})();
