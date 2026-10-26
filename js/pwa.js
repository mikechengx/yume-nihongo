/* Yume · 离线缓存、长期保存、安装到桌面（js/pwa.js）
 * - 注册离线缓存（sw.js 由 build.py 生成，只在独立网站上有；claude.ai 预览里注册会失败，直接跳过）：
 *   第二次打开起页面和课程数据都从手机本地读，不用每次连 netlify（国内网络下这一步最慢）。
 * - 申请「长期保存」（navigator.storage.persist）：没有它，手机空间不足时浏览器可能清掉网站数据，进度就没了。
 * - 安卓 Chrome「安装到桌面」；在微信、QQ 等 App 里打开时，提醒进度可能被清理、和浏览器里的不互通。
 * 「我的」页的卡片：离线与安装。首页卡片：App 内打开的提醒。 */
(function(){
"use strict";
const Y=window.Yume,W=window,N=W.navigator||{};
const {esc,IC,today}=Y;
const UA=String(N.userAgent||"");
const LOC=W.location||{hostname:"",protocol:"",origin:"",pathname:"",reload(){}};
const on=(t,ev,fn)=>{try{if(t&&typeof t.addEventListener==="function")t.addEventListener(ev,fn)}catch(e){}};
const APP_NAME=/MicroMessenger/i.test(UA)?"微信":/\bQQ\/\d/i.test(UA)?"QQ":/AlipayClient/i.test(UA)?"支付宝":/DingTalk/i.test(UA)?"钉钉":/Weibo/i.test(UA)?"微博":/aweme|BytedanceWebview|ByteLocale/i.test(UA)?"抖音":/xhsdiscover/i.test(UA)?"小红书":"";
const P={sw:"",reg:null,updated:false,persist:null,est:null,install:null,standalone:false,inapp:APP_NAME};
try{P.standalone=W.matchMedia("(display-mode: standalone)").matches||N.standalone===true}catch(e){}
let framed=false;try{framed=W.top!==W.self}catch(e){framed=true}
const swOK=()=>"serviceWorker" in N&&!framed&&(LOC.protocol==="https:"||/^(localhost|127\.0\.0\.1)$/.test(LOC.hostname));

/* ============ 离线缓存 ============ */
function registerSW(){
  if(!swOK()){P.sw=framed?"framed":"unsupported";return}
  const had=!!N.serviceWorker.controller;
  P.sw="loading";
  N.serviceWorker.register("sw.js").then(reg=>{
    P.reg=reg;P.sw="on";
    reg.addEventListener("updatefound",()=>{
      const nw=reg.installing;if(!nw)return;
      nw.addEventListener("statechange",()=>{
        if(nw.state==="activated"&&had&&!P.updated){
          P.updated=true;
          Y.toast(`新版本已经下载好，下次打开就是新版。<button class="btn sm" data-act="pwa-reload" style="margin-left:8px">现在刷新</button>`,9000);
        }
      });
    });
  }).catch(()=>{P.sw="failed"});
  /* 回到页面时（每小时最多一次）检查有没有新版本 */
  let last=Date.now();
  on(W.document,"visibilitychange",()=>{
    if(W.document.visibilityState!=="visible"||!P.reg||Date.now()-last<3600e3)return;
    last=Date.now();try{P.reg.update()}catch(e){}
  });
}
/* 清掉离线缓存并重新加载（不动学习进度） */
async function repair(){
  try{if(N.serviceWorker){const rs=await N.serviceWorker.getRegistrations();await Promise.all(rs.map(r=>r.unregister()))}}catch(e){}
  try{if(W.caches){const ks=await W.caches.keys();await Promise.all(ks.filter(k=>k.startsWith("yume-")).map(k=>W.caches.delete(k)))}}catch(e){}
  LOC.reload();
}

/* ============ 长期保存 ============ */
function checkPersist(ask){
  const st=N.storage;if(!st||!st.persisted){P.persist=null;return Promise.resolve(null)}
  return st.persisted().then(p=>{
    if(p||!ask||!st.persist)return p;
    return st.persist();
  }).then(p=>{P.persist=!!p;return P.persist}).catch(()=>null);
}
function estimate(){
  const st=N.storage;if(!st||!st.estimate)return Promise.resolve(null);
  return st.estimate().then(e=>{P.est=e;return e}).catch(()=>null);
}
const mb=n=>(n/1048576).toFixed(n<10485760?1:0)+" MB";

/* ============ 安装到桌面 ============ */
on(W,"beforeinstallprompt",e=>{e.preventDefault();P.install=e;if(Y.booted&&Y.ui.tab==="me")Y.render()});
on(W,"appinstalled",()=>{P.install=null;Y.toast("已添加到桌面，以后从桌面图标打开就行");checkPersist(true).then(()=>{if(Y.ui.tab==="me")Y.render()})});

/* ============ 「我的」页卡片 ============ */
function meCard(){
  const sw=P.sw==="on"?"已开启：第二次打开起从手机本地加载，网络不好也能打开":
    P.sw==="loading"?"正在准备……":P.sw==="framed"?"在预览窗口里用不了，用浏览器打开网站就会开启":
    P.sw==="failed"?"没能开启（可以点下面的「修复」再试）":"这个浏览器不支持离线缓存";
  const ps=P.persist===true?"已开启：手机空间不足时，浏览器也不会清掉你的进度":
    P.persist===false?"还没开启：手机空间不足时，浏览器可能清掉网站数据（包括进度）。把网站添加到桌面后，浏览器一般会自动同意":
    "这个浏览器不支持（记得定期保存存档文件）";
  const used=P.est&&P.est.usage!=null?`已用 ${mb(P.est.usage)}`+(P.est.quota?` / 可用约 ${mb(P.est.quota)}`:""):"";
  const inst=P.standalone?`<span class="small" style="color:var(--good);white-space:nowrap">已从桌面打开</span>`:
    P.install?`<button class="btn primary sm" data-act="pwa-install">${IC.down}安装到桌面</button>`:"";
  const howto=P.standalone||P.install?"":(P.inapp?"先点右上角「···」→「在浏览器打开」，再在浏览器菜单里选「添加到主屏幕」":"在浏览器菜单里选「添加到主屏幕」或「添加到桌面」");
  return `<div class="card stack" style="gap:6px" id="pwacard"><div class="eyebrow">离线与安装</div>
    <div class="setrow"><span>添加到桌面<div class="small muted">像 App 一样从桌面打开，进度也更不容易被清掉${howto?"。"+esc(howto):""}</div></span>${inst}</div>
    <div class="setrow"><span>离线缓存<div class="small muted">${esc(sw)}</div></span></div>
    <div class="setrow"><span>长期保存进度<div class="small muted">${esc(ps)}${used?"<br>"+esc(used):""}</div></span>${P.persist===false?`<button class="btn sm" data-act="pwa-persist">申请</button>`:""}</div>
    <div class="setrow"><span>页面出问题了？<div class="small muted">清掉离线缓存并重新加载，学习进度不受影响</div></span><button class="btn sm" data-act="pwa-repair">${IC.refresh}修复</button></div>
  </div>`;
}

/* ============ 首页：在 App 里打开的提醒 ============ */
const INAPP_KEY="inapp-ok";
const HOME_HOST="yume-nihongo.netlify.app";
function hostCard(){
  const h=LOC.hostname||"";
  if(!/netlify\.app$/.test(h)||h===HOME_HOST)return "";
  return `<div class="card stack" style="gap:8px;background:var(--bad-soft);box-shadow:none"><b>这是临时预览网址</b>
    <div class="small">这里的学习进度和正式网址 <b>${HOME_HOST}</b> 不互通。请收藏并只用正式网址学习。</div>
    <a class="btn sm" href="https://${HOME_HOST}/" style="align-self:flex-start">去正式网址</a></div>`;
}
function homeCard(){
  const hc=hostCard();if(hc)return hc;
  if(!P.inapp)return "";
  const ok=Y.store.get(INAPP_KEY,"");
  /* 已经有进度、又很久没存档：一直提醒（关不掉），直到存一次档 */
  const urgent=Y.S&&Y.S.xp>0&&Y.backupDue();
  if(!urgent&&ok&&(Date.parse(today())-Date.parse(ok))/864e5<3)return "";
  return `<div class="card stack" style="gap:10px;background:var(--bad-soft);box-shadow:none">
    <div class="row" style="gap:12px;align-items:flex-start"><span class="seal" lang="ja" style="border-color:var(--bad);color:var(--bad)">注</span>
      <div class="grow"><b>你正在「${esc(P.inapp)}」里使用 yume</b>
      <div class="small" style="margin-top:4px">${esc(P.inapp)}清理缓存时，会把这里的学习进度一起删掉；而且这里的进度和手机浏览器里的<b>不互通</b>。建议点右上角「···」→「在浏览器打开」，以后都从浏览器（或添加到桌面的图标）进来学。</div></div></div>
    ${urgent?`<div class="small" style="color:var(--bad)">你在这里已经学了一段时间，还没存过档：先到「我的 → 存档与备份」复制一份存档文字，发到「文件传输助手」。</div>`:""}
    <div class="row" style="gap:8px"><button class="btn sm grow" data-act="pwa-copyurl">${IC.link}复制网址</button>${urgent?`<button class="btn primary sm grow" data-act="gobackup">去存档</button>`:`<button class="btn sm grow" data-act="pwa-inapp-ok">知道了</button>`}</div>
  </div>`;
}

Y.registerCard("me",meCard,{order:30});
Y.registerCard("home",homeCard,{order:-20});
const A=Y.registerAction;
A("pwa-reload",()=>LOC.reload());
A("pwa-repair",()=>{Y.toast("正在清除缓存并重新加载……");setTimeout(repair,300)});
A("pwa-persist",()=>{checkPersist(true).then(p=>{Y.toast(p?"已开启长期保存":"浏览器暂时没同意：把网站添加到桌面、多用几天后再试");Y.render()})});
A("pwa-install",()=>{const e=P.install;if(!e)return;P.install=null;try{e.prompt();e.userChoice.then(()=>Y.render())}catch(err){Y.render()}});
A("pwa-inapp-ok",()=>{Y.store.set(INAPP_KEY,today());Y.render()});
A("pwa-copyurl",()=>{const u=LOC.origin+LOC.pathname;const done=()=>Y.toast("网址已复制，到浏览器里粘贴打开");
  try{N.clipboard.writeText(u).then(done,()=>Y.toast("请长按复制："+esc(u),6000))}catch(e){Y.toast("请长按复制："+esc(u),6000)}});

/* ============ 启动 ============ */
on(W,"load",()=>{
  registerSW();
  /* 有了学习进度才申请长期保存（火狐会弹窗问，没进度时没必要打扰） */
  checkPersist(Y.S&&Y.S.xp>0).then(()=>estimate()).then(()=>{if(Y.booted&&Y.ui.tab==="me")Y.render()});
});
Y.pwa={state:P,repair,checkPersist,estimate,inapp:APP_NAME};
})();
