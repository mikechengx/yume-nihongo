/* yume 愚昧酱日语 · 离线缓存（Service Worker）
 * 由 app/build.py 生成：缓存名和预缓存文件列表在构建时填入。
 * - 打开网站：直接用手机里缓存的页面（秒开，网络差、断网也能打开），同时在后台取新页面，下次打开生效。
 * - css / js / 课程数据：地址里带 ?v=内容哈希，内容一变地址就变，所以放心长期缓存。
 * - 别的网站的请求（有道发音、B 站、AI 接口等）一律不管。 */
const CACHE="__CACHE__";
const ASSETS=__ASSETS__;
const KEEP=2;/* 保留最近两个版本的缓存：新版本下载好时，还开着的旧页面仍能取到旧文件 */

self.addEventListener("install",e=>{
  e.waitUntil(caches.open(CACHE)
    .then(c=>c.addAll(ASSETS.map(u=>new Request(u,{cache:"reload"}))))
    .then(()=>self.skipWaiting()));
});
self.addEventListener("activate",e=>{
  e.waitUntil(caches.keys()
    .then(ks=>{const mine=ks.filter(k=>k.startsWith("yume-")).sort().reverse();
      return Promise.all(mine.slice(KEEP).filter(k=>k!==CACHE).map(k=>caches.delete(k)))})
    .then(()=>self.clients.claim()));
});
self.addEventListener("fetch",e=>{
  const r=e.request;
  if(r.method!=="GET")return;
  let u;try{u=new URL(r.url)}catch(err){return}
  if(u.origin!==self.location.origin)return;
  if(r.mode==="navigate"){
    e.respondWith(caches.open(CACHE).then(async c=>{
      const hit=await c.match("./");
      /* 注意：导航请求不能带第二个参数再 fetch（会报错），所以用地址重新发一个请求 */
      const net=fetch(r.url,{cache:"no-store",credentials:"same-origin"}).then(res=>{if(res&&res.ok&&res.type==="basic")return c.put("./",res.clone()).then(()=>res);return res}).catch(()=>null);
      if(hit){e.waitUntil(net);return hit}
      const res=await net;
      return res||new Response("<meta charset=utf-8><p style=font:16px/1.6 sans-serif;padding:24px>现在连不上网络，第一次打开需要联网。请检查网络后再试。</p>",{status:503,headers:{"Content-Type":"text/html;charset=utf-8"}});
    }));
    return;
  }
  if(u.pathname.endsWith("/sw.js"))return;
  e.respondWith(caches.match(r).then(hit=>hit||fetch(r).then(res=>{
    if(res&&res.ok&&res.type==="basic"&&/[?&]v=/.test(u.search)){const cp=res.clone();caches.open(CACHE).then(c=>c.put(r,cp)).catch(()=>{})}
    return res;
  })));
});
self.addEventListener("message",e=>{if(e.data==="skipWaiting")self.skipWaiting()});
