/* Yume · 视听（js/media.js）——用视频、播客学日语
 * 视听页：一个链接输入框（B 站 / YouTube / niconico / 音频直链 / 其他网页）→ 我的视听库 → 学习页（全屏覆盖层）
 * 学习页：播放器（YouTube/B 站/niconico 嵌入，音视频直链用 <audio>/<video>，也可选本机文件）+ 字幕导入 + 字幕阅读器
 * 字幕阅读器：逐句显示，振假名 / 中文翻译 / 词性颜色开关；点句子朗读，点时间跳转；点词看读音、原形、词性、中文，可加入单词本
 * AI 精读（Yume.ai）：字幕每批约 15 句，返回逐词 {s,r,b,pos,zh} + 整句中文；没有 AI 时按字符类型着色的简易模式
 * 存储：视听库、字幕、AI 结果都在 Yume.store（只在本机，不进 S）；加入单词本的词放进 S.custom 里 id 为 media-words 的一课，
 *       与核心间隔复习完全兼容（单词本「自制课程」、今日复习都会出现）。
 */
(function(){
"use strict";
const Y=window.Yume;
const {esc,IC}=Y;
const W=window;
const $=id=>W.document.getElementById(id);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const str=x=>x==null?"":String(x);

/* ============ 词性（字幕用 13 类，每类一个颜色） ============ */
const MPOS=[["n","名词"],["pr","代词"],["nu","数词"],["v","动词"],["aux","助动词"],["a","形容词"],["na","形容动词"],["adv","副词"],["p","助词"],["rt","连体词"],["cj","接续词"],["it","感叹词"],["sy","记号"]];
const POSNAME={};for(const [c,n] of MPOS)POSNAME[c]=n;
const POS_ALIAS={"名词":"n","名詞":"n","代词":"pr","代名詞":"pr","代名词":"pr","数词":"nu","数詞":"nu","數詞":"nu","动词":"v","動詞":"v","助动词":"aux","助動詞":"aux",
  "形容词":"a","形容詞":"a","形容动词":"na","形容動詞":"na","な形容词":"na","副词":"adv","副詞":"adv","助词":"p","助詞":"p","连体词":"rt","連体詞":"rt",
  "接续词":"cj","接続詞":"cj","接續詞":"cj","感叹词":"it","感動詞":"it","感嘆詞":"it","叹词":"it","记号":"sy","記号":"sy","補助記号":"sy","符号":"sy","标点":"sy","空白":"sy",
  "接头词":"n","接頭辞":"n","接頭詞":"n","接尾词":"n","接尾辞":"n","noun":"n","pronoun":"pr","numeral":"nu","number":"nu","verb":"v","auxiliary":"aux","adjective":"a",
  "adverb":"adv","particle":"p","conjunction":"cj","interjection":"it","symbol":"sy","punctuation":"sy"};
for(const [c] of MPOS)POS_ALIAS[c]=c;
function posCode(x){
  x=str(x).trim();if(!x)return "sy";
  if(POS_ALIAS[x])return POS_ALIAS[x];
  const l=x.toLowerCase();if(POS_ALIAS[l])return POS_ALIAS[l];
  if(/助[动動]/.test(x))return "aux";if(/形容[动動]/.test(x))return "na";if(/代/.test(x))return "pr";if(/数|數/.test(x))return "nu";
  if(/[动動]/.test(x))return "v";if(/形/.test(x))return "a";if(/副/.test(x))return "adv";if(/助/.test(x))return "p";
  if(/[连連]体/.test(x))return "rt";if(/[接][续続續]/.test(x))return "cj";if(/感|叹|嘆/.test(x))return "it";if(/名|接[头頭尾]/.test(x))return "n";
  return "sy";
}
/* 字幕词性 → 课程单词的词性写法（core POS） */
const TO_COURSE={n:"名",pr:"代",nu:"数",v:"动",aux:"助动",a:"い形",na:"な形",adv:"副",p:"助",rt:"连体",cj:"接续",it:"感",sy:""};
/* 课程单词词性 → 字幕颜色（简易模式里认出的课程单词用） */
const FROM_COURSE={"名":"n","代":"pr","数":"nu","助数":"nu","动1":"v","动2":"v","动3":"v","动":"v","い形":"a","な形":"na","副":"adv","助":"p","助动":"aux","连体":"rt","接续":"cj","感":"it","惯用":"n","接头":"n","接尾":"n"};

/* ============ 文字工具 ============ */
const KJ="\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF々〆〇ヶヵ";
const KANJI_RE=new RegExp("["+KJ+"]");
const SEG_RE=new RegExp("["+KJ+"]+|[^"+KJ+"]+","g");
const hasJa=s=>/[぀-ヿ㐀-䶿一-鿿々]/.test(str(s));
const KANA_ONLY=/^[぀-ヿー・]+$/;
const toHira=s=>str(s).replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60));
const kanaClean=s=>toHira(s).replace(/[^ぁ-ゖゝゞー]/g,"");
const escRe=s=>s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
const escNl=s=>esc(s).replace(/\n/g,"<br>");
function chType(ch){if(KANJI_RE.test(ch))return "k";if(/[ぁ-ゟ]/.test(ch))return "h";if(/[゠-ヿー]/.test(ch))return "t";return "o"}
/* 把读音分配给汉字段：飲み/のみ → [飲:の][み] */
function alignSegs(s,r){
  const segs=s.match(SEG_RE)||[s];const hr=toHira(r);
  const src="^"+segs.map(g=>KANJI_RE.test(g[0])?"(.+?)":"("+escRe(toHira(g))+")").join("")+"$";
  let m=null;try{m=hr.match(new RegExp(src))}catch(e){}
  return m?{segs,m}:null;
}
function rubyTok(s,r,on){
  s=str(s);if(!on||!r||!KANJI_RE.test(s))return esc(s);
  const hr=toHira(r);const a=alignSegs(s,hr);
  if(!a)return `<ruby>${esc(s)}<rt>${esc(hr)}</rt></ruby>`;
  return a.segs.map((g,i)=>KANJI_RE.test(g[0])?`<ruby>${esc(g)}<rt>${esc(a.m[i+1])}</rt></ruby>`:esc(g)).join("");
}
/* 原形读音：AI 给了 br 就用；否则用表层读音推（飲み/のみ + 飲む → のむ） */
function baseReading(s,r,b,br){
  if(br)return kanaClean(br);
  if(!b||b===s)return kanaClean(r||s);
  if(!KANJI_RE.test(b))return kanaClean(b);
  const a=r?alignSegs(s,r):null;if(!a)return kanaClean(r);
  let out="",pos=0;
  for(let k=0;k<a.segs.length;k++){const g=a.segs[k];if(b.startsWith(g,pos)){out+=KANJI_RE.test(g[0])?a.m[k+1]:toHira(g);pos+=g.length}else break}
  const rest=b.slice(pos);
  if(!pos||KANJI_RE.test(rest))return kanaClean(r);
  return kanaClean(out+rest);
}
const fmtT=t=>{if(t==null||!isFinite(t))return "";t=Math.max(0,Math.floor(t));const h=Math.floor(t/3600),m=Math.floor(t%3600/60),s=t%60;return (h?h+":"+String(m).padStart(2,"0"):m)+":"+String(s).padStart(2,"0")};

/* ============ AI 词元：[s, r, b, pos, zh, br]（存储时去掉末尾空串） ============ */
function normTok(t){
  let s,r,b,pos,zh,br;
  if(Array.isArray(t))[s,r,b,pos,zh,br]=t;
  else if(t&&typeof t==="object"){s=t.s!=null?t.s:(t.surface!=null?t.surface:t.w);r=t.r!=null?t.r:t.reading;b=t.b!=null?t.b:(t.base!=null?t.base:t.lemma);pos=t.pos!=null?t.pos:t.p;zh=t.zh!=null?t.zh:t.meaning;br=t.br}
  else return null;
  s=str(s);if(!s)return null;
  pos=posCode(pos);
  r=pos==="sy"?"":kanaClean(r);if(!r&&KANA_ONLY.test(s)&&pos!=="sy")r=toHira(s);
  b=str(b).trim()||s;br=pos==="sy"?"":kanaClean(br);
  const o=[s.slice(0,60),r.slice(0,80),b===s?"":b.slice(0,60),pos,str(zh).trim().slice(0,40),br&&br!==r?br.slice(0,80):""];
  while(o.length>1&&o[o.length-1]==="")o.pop();
  return o;
}
const tk=(t,i)=>str(t[i]);
const tkBase=t=>tk(t,2)||tk(t,0);
/* 让词元严格拼回原句：找不到的词元丢掉，漏掉的原文作为「原样片段」补回去 */
function alignTokens(ja,toks){
  const out=[];let pos=0;
  for(const t of toks){if(!t)continue;const s=t[0];const k=ja.indexOf(s,pos);if(k<0)continue;if(k>pos)out.push([ja.slice(pos,k)]);out.push(t);pos=k+s.length}
  if(pos<ja.length)out.push([ja.slice(pos)]);
  return out;
}

/* ============ 视图偏好（本机） ============ */
const V=Object.assign({furi:true,zh:true,pos:true,follow:true},(()=>{const v=Y.store.get("media-view",null);return v&&typeof v==="object"?v:{}})());
const saveV=()=>Y.store.set("media-view",{furi:!!V.furi,zh:!!V.zh,pos:!!V.pos,follow:!!V.follow});

/* ============ 视听库（Yume.store：media-lib 索引，media-sub-<id> 字幕+AI 结果） ============ */
const PLAT={
  yt:{n:"YouTube",ic:"play"},bili:{n:"B站",txt:"B"},nico:{n:"niconico",txt:"ニコ"},
  audio:{n:"音频",ic:"spk"},video:{n:"视频文件",ic:"tv"},web:{n:"网页",ic:"link"},demo:{n:"示例",ic:"spark"}
};
const VID_OK={yt:/^[A-Za-z0-9_-]{11}$/,bili:/^(BV[0-9A-Za-z]{10}|av\d{1,12})$/,nico:/^(sm|so|nm)\d{1,12}$/};
let LIB=null;
function lib(){
  if(LIB)return LIB;
  const r=Y.store.get("media-lib",null);
  const items=(r&&Array.isArray(r.items)?r.items:[]).filter(x=>x&&typeof x.id==="string"&&PLAT[x.plat]&&(!VID_OK[x.plat]||VID_OK[x.plat].test(str(x.vid))));
  LIB={v:1,items};return LIB;
}
/* 多个页面同时开着时不互相覆盖：保存前把本机存档里有、而这里没有的条目并进来（这里删掉的除外） */
const DELETED=new Set();
function saveLib(){
  const cur=lib();const r=Y.store.get("media-lib",null);
  if(r&&Array.isArray(r.items)){const have=new Set(cur.items.map(x=>x.id));
    for(const x of r.items)if(x&&typeof x.id==="string"&&!have.has(x.id)&&!DELETED.has(x.id)&&PLAT[x.plat]&&(!VID_OK[x.plat]||VID_OK[x.plat].test(str(x.vid))))cur.items.push(x)}
  if(!Y.store.set("media-lib",cur))Y.toast("本机存储空间不够了，视听库没能保存");
}
try{document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&!st)LIB=null});
  window.addEventListener("storage",e=>{if(e.key===Y.store.key("media-lib")&&!st){LIB=null;if(Y.booted&&Y.ui.tab==="media")Y.render()}})}catch(e){}
const itemById=id=>lib().items.find(x=>x.id===id)||null;
const SUBS={};
/* 从本机读一条字幕（不放进缓存） */
function readSub(id){const r=Y.store.get("media-sub-"+id,null);return{lines:(r&&Array.isArray(r.lines)?r.lines:[]).filter(l=>l&&typeof l.ja==="string")}}
/* 取字幕并缓存（学习页、AI 精读用）；不用了要 releaseSub */
function sub(id){if(!SUBS[id])SUBS[id]=readSub(id);return SUBS[id]}
/* 字幕可能很大：学习页没开着、也没有 AI 任务在用它时，从内存里放掉 */
function releaseSub(id){if(!id||(st&&st.id===id)||(JOBS[id]&&JOBS[id].run))return;delete SUBS[id]}
/* 字幕和 AI 精读结果和学习进度共用浏览器的本机存储（一般约 5MB）。给视听数据设上限，免得把空间占满、导致进度保存不了：
 * 所有字幕合计 ≤ 150 万字符，单条 ≤ 40 万字符。返回 "ok" | "one" | "total" | "quota" */
const SUB_TOTAL=1500000,SUB_ONE=400000;
const SUB_MSG={one:"这条字幕（连同 AI 精读结果）太大了，超过了单条上限（约 40 万字）。可以把字幕拆成几段，分成几个条目导入。",
  total:"视听字幕占用的本机空间已经到上限（约 150 万字）。请先删掉一些不用的视听条目再试，这样也能给学习进度留出空间。",
  quota:"本机存储空间不够了，字幕没能保存。请删掉一些不用的视听条目再试。"};
let SUBLEN=null;/* 各条字幕在本机占的字符数（第一次用时统计一次，之后保存/删除时更新） */
function subLens(){if(!SUBLEN){SUBLEN={};for(const k of Y.store.keys("media-sub-"))SUBLEN[k]=Y.store.len(k)}return SUBLEN}
function subUsed(except){let n=0;const m=subLens();for(const k in m)if(k!=="media-sub-"+except)n+=m[k];return n}
function saveSub(id,quiet){
  const data=sub(id);let txt="";try{txt=JSON.stringify(data)}catch(e){}
  const len=txt.length;
  let why=len>SUB_ONE?"one":subUsed(id)+len>SUB_TOTAL?"total":"";
  if(!why){try{localStorage.setItem(Y.store.key("media-sub-"+id),txt);subLens()["media-sub-"+id]=len;why="ok"}catch(e){why="quota"}}
  if(why!=="ok"&&!quiet)Y.toast(esc(SUB_MSG[why]),6000);
  return why;
}
const saved=r=>r==="ok";
const lineDone=l=>!!l.tk||!hasJa(l.ja);
function updStats(it){const L=sub(it.id).lines;it.n=L.length;it.ai=L.filter(lineDone).length;it.tk=L.some(l=>l.tk)?1:0}
function newId(){return "m"+Date.now().toString(36)+Math.random().toString(36).slice(2,6)}
function pageUrl(it,t){
  t=t>0?Math.floor(t):0;
  if(it.plat==="yt")return "https://www.youtube.com/watch?v="+it.vid+(t?"&t="+t+"s":"");
  if(it.plat==="bili")return "https://www.bilibili.com/video/"+it.vid+((it.p||1)>1?"?p="+it.p:"")+(t?((it.p||1)>1?"&":"?")+"t="+t:"");
  if(it.plat==="nico")return "https://www.nicovideo.jp/watch/"+it.vid+(t?"?from="+t:"");
  return Y.safeUrl(it.url);
}
function platBadge(it){const P=PLAT[it.plat]||PLAT.web;return `<span class="mplat mplat-${esc(it.plat)}" aria-hidden="true">${P.txt?`<b lang="ja">${esc(P.txt)}</b>`:IC[P.ic]||""}</span>`}

/* ============ 链接识别 ============ */
const SITE_NAMES={"xiaoyuzhoufm.com":"小宇宙","podcasts.apple.com":"Apple 播客","open.spotify.com":"Spotify","nhk.or.jp":"NHK","www3.nhk.or.jp":"NHK",
  "music.163.com":"网易云音乐","ximalaya.com":"喜马拉雅","douyin.com":"抖音","weibo.com":"微博","xiaohongshu.com":"小红书","tiktok.com":"TikTok","tver.jp":"TVer","abema.tv":"ABEMA","netflix.com":"Netflix","iqiyi.com":"爱奇艺","v.qq.com":"腾讯视频","youku.com":"优酷"};
function parseT(x){
  x=str(x).trim();if(!x)return 0;if(/^\d+$/.test(x))return +x;
  const m=x.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/i);return m?(+m[1]||0)*3600+(+m[2]||0)*60+(+m[3]||0):0;
}
function parseLink(raw){
  const s=str(raw).trim();
  if(!s)return {err:"先把链接粘贴到上面的框里"};
  let title="";const tm=s.match(/【([^】]{1,100})】/);
  if(tm)title=tm[1].replace(/\s*[-_—|]\s*(哔哩哔哩|bilibili).*$/i,"").replace(/_bilibili$/i,"").trim();
  const bvOnly=s.match(/^(BV[0-9A-Za-z]{10})$/);if(bvOnly)return {plat:"bili",vid:bvOnly[1],p:1,url:"https://www.bilibili.com/video/"+bvOnly[1],t:title};
  const um=s.match(/https?:\/\/[^\s<>"'「」【】，。、）)]+/i);
  let u=um?um[0]:(/^(www\.|m\.)?(youtube\.com|youtu\.be|bilibili\.com|b23\.tv|nicovideo\.jp)\//i.test(s)?"https://"+s.split(/\s/)[0]:null);
  if(!u)return {err:"没找到链接：请粘贴以 http:// 或 https:// 开头的网址，或者 B 站的 BV 号。"};
  let U;try{U=new URL(u)}catch(e){return {err:"这个链接的格式不对，请检查一下。"}}
  if(!/^https?:$/.test(U.protocol))return {err:"只支持 http:// 或 https:// 开头的链接。"};
  const host=U.hostname.toLowerCase().replace(/^(www|m|music|mobile)\./,"");
  const url=U.href;
  /* YouTube */
  if(host==="youtu.be"||host==="youtube.com"||host==="youtube-nocookie.com"||host.endsWith(".youtube.com")){
    const id=host==="youtu.be"?U.pathname.slice(1).split("/")[0]:(U.searchParams.get("v")||(U.pathname.match(/^\/(?:embed|shorts|live|v|e)\/([A-Za-z0-9_-]{11})/)||[])[1]);
    if(!id||!VID_OK.yt.test(id))return {err:"这是 YouTube 链接，但没找到视频编号。请打开具体的视频，再复制地址。"};
    return {plat:"yt",vid:id,start:parseT(U.searchParams.get("t")||U.searchParams.get("start")),url:"https://www.youtube.com/watch?v="+id,t:title};
  }
  /* B 站短链：网页无法跨域展开 */
  if(host==="b23.tv"||host==="bili2233.cn"||host==="b22.top")return {err:"b23.tv 是 B 站的短链接，网页没法自动展开。请先在浏览器里打开它，跳到视频页后，复制地址栏里带「BV」的完整链接再粘贴（或者只粘贴 BV 号）。"};
  if(host==="bilibili.com"||host.endsWith(".bilibili.com")){
    const bv=(U.pathname+U.search).match(/BV[0-9A-Za-z]{10}/);
    const av=U.pathname.match(/\/video\/av(\d{1,12})/i)||U.search.match(/[?&]aid=(\d{1,12})/);
    const p=Math.max(1,Math.min(999,parseInt(U.searchParams.get("p")||U.searchParams.get("page")||"1",10)||1));
    const vid=bv?bv[0]:av?"av"+av[1]:null;
    if(vid)return {plat:"bili",vid,p,start:parseT(U.searchParams.get("t")),url:"https://www.bilibili.com/video/"+vid+(p>1?"?p="+p:""),t:title};
    return {plat:"web",url,t:title||"B 站页面",note:"这个 B 站页面不是普通视频（比如番剧、直播），只能在新窗口打开。"};
  }
  if(host==="nicovideo.jp"||host.endsWith(".nicovideo.jp")||host==="nico.ms"){
    const id=(U.pathname.match(/(sm|so|nm)\d{1,12}/)||[])[0];
    if(id)return {plat:"nico",vid:id,url:"https://www.nicovideo.jp/watch/"+id,t:title};
  }
  const path=U.pathname.toLowerCase();
  /* 文件名做标题；不合法的百分号编码（%zz、半个 UTF-8）decodeURIComponent 会抛错，这时用原样 */
  const fname=()=>{const seg=U.pathname.split("/").pop()||"";try{return decodeURIComponent(seg)}catch(e){return seg}};
  if(/\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)$/.test(path))return {plat:"audio",url,t:title||fname().slice(0,60)};
  if(/\.(mp4|webm|m4v|mov)$/.test(path))return {plat:"video",url,t:title||fname().slice(0,60)};
  const site=SITE_NAMES[U.hostname.toLowerCase()]||SITE_NAMES[host]||host;
  return {plat:"web",url,t:title||site+" 链接"};
}

/* ============ 字幕解析 ============ */
function parseTime(s){
  s=str(s).trim().replace(",",".");const p=s.split(":");if(!s||p.length>3)return null;
  let t=0;for(const x of p){if(!/^\d+(\.\d+)?$/.test(x))return null;t=t*60+parseFloat(x)}
  return t;
}
function cleanText(s){
  return str(s).replace(/\{\\[^}]*\}/g,"").replace(/\\[Nn]/g," ").replace(/<[^>]*>/g,"").replace(/&nbsp;/g," ").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&").replace(/[ \t\u00A0]+/g," ").trim();
}
const KANA_CH=/[぀-ヿ]/;
/* 没有假名的行算不算翻译：含中文简体字/虚词，或用中文逗号、句号结尾的整句，或者是英文 */
const ZH_MARK=/[的了吗呢吧们这那个你他她很没说还把被给让啊么什怎为对过里后欢谢请样现时间东买卖车话语习电视问见长开关机发书应该经实际题哪呀嘛每喝吃总图带广张热气读写课谁认识边远连选运爱观觉讲头页风飞马鱼鸟乐从众传条极标汉济环种级线组统继续报换据无术华单历听员响团场处备复够妈宁导层岁帮态戏战户护担择挂损断旧显晓杀杂权检楼毕汇汤满灯独猫疗盘确礼离称简类紧红约纪纸练细终结络绝绿编网职联胜脑艺节药获营虽装规计训议记许论设访证评诉词译试详误调谈负责财败货质购费资赛转轮软轻较辆达违迟递遗邮钟钢钱铁银错键门闻阅队阳阴陆险难预颜饭饮饱馆验鸡齐龄龙]/;
const isTrans=x=>!KANA_CH.test(x)&&(ZH_MARK.test(x)||/，/.test(x)||(x.length>=6&&/[。！？]$/.test(x))||(/[A-Za-z]{3,}/.test(x)&&!/[\u4E00-\u9FFF]/.test(x)));
/* 一个字幕块 → 一行；双语块（有假名的行 + 没有假名的中文/英文行）自动拆成 日文 + 翻译；滚动字幕去重 */
function pushCue(textLines,s,e,out){
  let ls=textLines.map(cleanText).filter(Boolean);if(!ls.length)return;
  let ja=ls,zh=[];
  if(ls.length>=2&&ls.some(isTrans)&&ls.some(x=>!isTrans(x))){ja=ls.filter(x=>!isTrans(x));zh=ls.filter(isTrans)}
  const prev=out[out.length-1];
  if(prev&&!zh.length){while(ja.length&&(prev.ja===ja[0]||prev.ja.endsWith(ja[0])))ja=ja.slice(1);if(!ja.length){if(e!=null)prev.e=e;return}}
  const jt=ja.join(" ").trim();if(!jt)return;
  const o={s,e,ja:jt.slice(0,400)};if(zh.length)o.zh=zh.join(" ").slice(0,400);
  out.push(o);
}
function parseCues(t){
  const out=[];
  for(const b of t.split(/\n[ \t]*\n/)){
    const ls=b.split("\n");const k=ls.findIndex(x=>x.includes("-->"));if(k<0)continue;
    const m=ls[k].match(/([\d:.,]+)\s*-->\s*([\d:.,]+)/);if(!m)continue;
    const s=parseTime(m[1]);if(s==null)continue;pushCue(ls.slice(k+1),s,parseTime(m[2]),out);
  }
  return out;
}
function parseASS(t){
  const rows=[];
  for(const ln of t.split("\n")){
    const m=ln.match(/^Dialogue:\s*([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),(.*)$/);
    if(!m)continue;const s=parseTime(m[2]);if(s==null)continue;rows.push({s,e:parseTime(m[3]),txt:m[10]});
  }
  rows.sort((a,b)=>a.s-b.s);const out=[];
  for(const r of rows)pushCue(r.txt.split(/\\N/i),r.s,r.e,out);
  return out;
}
function parseLRC(t){
  const out=[];
  for(const ln of t.split("\n")){
    const m=ln.match(/^((?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+)(.*)$/);if(!m)continue;
    const txt=cleanText(m[2]);if(!txt)continue;
    for(const x of m[1].match(/\[[^\]]+\]/g)){const q=x.slice(1,-1).replace(/^(\d+:\d+):(\d+)$/,"$1.$2");const s=parseTime(q);if(s!=null)out.push({s,e:null,ja:txt.slice(0,400)})}
  }
  return out.sort((a,b)=>a.s-b.s);
}
const TS_ONLY=/^((?:\d{1,2}:)?\d{1,2}:\d{2})$/;
const TS_INLINE=/^((?:\d{1,2}:)?\d{1,2}:\d{2})\s+(.+)$/;
const DUR_LABEL=/^(\d+\s*(小时|時間|hours?|分钟|分|minutes?|秒|seconds?)[,，、\s]*)+$/i;
function parseTranscript(t){
  const ls=t.split("\n").map(x=>x.trim()).filter(x=>x&&!DUR_LABEL.test(x));
  const out=[];
  if(ls.filter(x=>TS_ONLY.test(x)).length>=2){
    let cur=null;
    for(const x of ls){if(TS_ONLY.test(x)){cur={s:parseTime(x),e:null,parts:[]};out.push(cur)}else if(cur)cur.parts.push(x)}
    return out.map(o=>({s:o.s,e:null,ja:cleanText(o.parts.join(" ")).slice(0,400)})).filter(o=>o.ja);
  }
  if(ls.filter(x=>TS_INLINE.test(x)).length>=2){
    for(const x of ls){const m=x.match(TS_INLINE);if(m)out.push({s:parseTime(m[1]),e:null,ja:cleanText(m[2]).slice(0,400)});else if(out.length)out[out.length-1].ja=(out[out.length-1].ja+" "+cleanText(x)).slice(0,400)}
  }
  return out;
}
function parseJSONSubs(t){
  let j;try{j=JSON.parse(t)}catch(e){return null}
  let arr=Array.isArray(j)?j:j&&(j.body||j.events||j.subtitles||j.lines||(j.data&&(j.data.body||j.data.subtitles)));
  if(!Array.isArray(arr))return null;
  const out=[];
  for(const o of arr){
    if(!o||typeof o!=="object")continue;
    let s=null,e=null,txt="",zh="";
    if(o.content!=null){s=+o.from;e=+o.to;txt=o.content}                                     /* B 站字幕 JSON */
    else if(Array.isArray(o.segs)){s=(+o.tStartMs||0)/1000;e=o.dDurationMs!=null?s+o.dDurationMs/1000:null;txt=o.segs.map(x=>x&&x.utf8||"").join("")}   /* YouTube json3 */
    else{s=o.start!=null?+o.start:o.startTime!=null?+o.startTime:o.s!=null?+o.s:null;e=o.end!=null?+o.end:o.endTime!=null?+o.endTime:o.e!=null?+o.e:null;txt=o.text!=null?o.text:o.ja!=null?o.ja:"";zh=o.zh||""}
    if(s!=null&&!isFinite(s))s=null;if(e!=null&&!isFinite(e))e=null;
    pushCue(str(txt).split("\n"),s,e,out);if(zh&&out.length&&!out[out.length-1].zh)out[out.length-1].zh=str(zh).slice(0,400);
  }
  return out;
}
function parsePlain(t){
  const out=[];
  for(const raw of t.split("\n")){
    const ln=cleanText(raw);if(!ln)continue;
    const parts=ln.length>30?(ln.match(/[^。！？!?]+[。！？!?」』）)]*|[。！？!?]+/g)||[ln]):[ln];
    for(const p of parts){const x=p.trim();if(x)out.push({s:null,e:null,ja:x.slice(0,400)})}
  }
  return out;
}
function parseSubs(text,name){
  const t=str(text).replace(/^\uFEFF/,"").replace(/\r\n?/g,"\n").trim();
  const nm=str(name).toLowerCase();let out=[],fmt="text";
  if(!t)return {lines:[],fmt,timed:false};
  if(/\.json$/.test(nm)||/^[\[{]/.test(t)){const r=parseJSONSubs(t);if(r&&r.length){out=r;fmt="json"}}
  if(!out.length&&(/^\[Script Info\]/im.test(t)||/^Dialogue:/m.test(t))){out=parseASS(t);fmt="ass"}
  if(!out.length&&/-->/.test(t)){out=parseCues(t);fmt=/^WEBVTT/.test(t)?"vtt":"srt"}
  if(!out.length){const r=parseLRC(t);if(r.length>=2){out=r;fmt="lrc"}}
  if(!out.length){const r=parseTranscript(t);if(r.length>=2){out=r;fmt="transcript"}}
  if(!out.length){out=parsePlain(t);fmt="text"}
  out=out.filter(l=>l.ja&&l.ja.trim());
  const timed=out.length>0&&out.every(l=>l.s!=null&&isFinite(l.s));
  if(timed){out.sort((a,b)=>a.s-b.s);out.forEach((l,i)=>{const n=out[i+1];if(l.e==null||!(l.e>l.s))l.e=n?n.s:l.s+4;l.s=Math.round(l.s*100)/100;l.e=Math.round(l.e*100)/100})}
  else out.forEach(l=>{l.s=null;l.e=null});
  return {lines:out.slice(0,3000).map(l=>{const o={s:l.s,e:l.e,ja:l.ja};if(l.zh)o.zh=l.zh;return o}),fmt,timed,cut:out.length>3000};
}
const FMT_NAME={srt:"SRT",vtt:"VTT",ass:"ASS",lrc:"LRC",json:"JSON 字幕",transcript:"带时间的文字记录",text:"纯文本"};

/* ============ 课程词库（简易模式：认出课程里学过的词） ============ */
let DICT=null,DICTN=-1;
const MW_ID="media-words";
if(Y.registerWordList)Y.registerWordList(MW_ID,{title:"视听生词",sub:"从视频、播客字幕里收集的单词"});
function dict(){
  const ws=Y.allWords();if(DICT&&DICTN===ws.length)return DICT;
  const m=new Map();let max=1;
  const add=(k,w,kana)=>{if(!k||m.has(k))return;if(!/[㐀-鿿々゠-ヿ]/.test(k)&&k.length<3)return;m.set(k,{w,kana:kana||""});if(k.length>max)max=k.length};
  for(const w of ws){if(w.lid===MW_ID)continue;const k=Y.plain(w.ja).replace(/[〜～]/g,"").trim();add(k,w,w.kana);
    if(/ます$/.test(k)&&k.length>=4)add(k.slice(0,-2),w,str(w.kana).replace(/ます$/,""))}
  DICT={m,max:Math.min(max,12)};DICTN=ws.length;return DICT;
}
function dictAt(ja,k){const d=dict();for(let L=Math.min(d.max,ja.length-k);L>=1;L--){const e=d.m.get(ja.substr(k,L));if(e)return [L,e]}return null}
function courseHit(...cands){const d=dict();for(const c of cands){if(!c)continue;const e=d.m.get(c);if(e)return e.w}return null}

/* ============ 视听生词：S.custom 里的 media-words 课（与核心 SRS 兼容） ============ */
function mwEntry(create){
  const S=Y.S;if(!Array.isArray(S.custom))S.custom=[];
  let c=S.custom.find(x=>x&&String(x.id)===MW_ID);
  if(!c&&create){c={id:MW_ID,title:"视听生词",sub:"从视频、播客字幕里收集的单词",words:[],grammar:[],quiz:[],sys:true};S.custom.push(c)}
  if(c&&!Array.isArray(c.words))c.words=[];
  return c||null;
}
const mwJa=x=>str(x).split("|")[0];
function mwHas(ja){const c=mwEntry(false);return !!c&&c.words.some(x=>mwJa(x)===ja)}
/* 视听生词放在 S.custom 里（会进存档和云同步），所以限制数量、释义截短，控制存档大小 */
const MW_MAX=200;
function mwAdd(o){
  const clean=(x,n)=>str(x).replace(/[|\n\r]/g," ").trim().slice(0,n||40);
  const ja=clean(o.ja);if(!ja)return {r:"bad"};
  if(mwHas(ja))return {r:"dup"};
  const c=mwEntry(true);if(c.words.length>=MW_MAX)return {r:"full"};
  c.words.push([ja,clean(o.kana),clean(o.zh,24)||"（无释义）",clean(o.pos,4)].join("|"));
  Y.rebuild();
  const S=Y.S,key=MW_ID+":"+ja;if(!S.words[key])S.words[key]={lv:0,due:Date.now(),r:0,x:0};
  /* 每个词只奖励一次：删掉再加不会重复加 XP */
  const xp=Y.xpOnce("m:"+ja,2);Y.checkBadges();Y.save();return {r:"ok",xp};
}
function mwDel(ja){
  const c=mwEntry(false);if(!c)return;const S=Y.S;
  c.words=c.words.filter(x=>mwJa(x)!==ja);delete S.words[MW_ID+":"+ja];
  if(!c.words.length)S.custom=S.custom.filter(x=>x!==c);
  Y.rebuild();Y.save();
}
const mwWords=()=>{const l=Y.lesson(MW_ID);return l?l.words:[]};

/* ============ 内置示例（原创短播客，带预先做好的精读结果） ============ */
const DEMO_LINES=[
 [0,"みなさん///pr/大家 、///sy こんにちは///it/你好 。///sy","大家好。"],
 [3,"「///sy ゆめ///n/梦 ラジオ///n/广播电台 」///sy の///p/的 リン///n/小林（人名） です///aux/是（礼貌） 。///sy","我是“梦想电台”的小林。"],
 [6,"今日/きょう//n/今天 は/わ//p/表示主题 雨/あめ//n/雨 です///aux/是（礼貌） ね///p/呢（语气） 。///sy","今天下雨呢。"],
 [9,"わたし///pr/我 は/わ//p/表示主题 朝/あさ//n/早上 、///sy 駅/えき//n/车站 の///p/的 近く/ちかく//n/附近 の///p/的 喫茶店/きっさてん//n/咖啡馆 で///p/在（地点） コーヒー///n/咖啡 を/お//p/宾语 飲み/のみ/飲む/v/喝/のむ まし//ます/aux/礼貌/ます た///aux/过去 。///sy","我早上在车站附近的咖啡馆喝了咖啡。"],
 [15,"とても///adv/非常 静か/しずか//na/安静 で//だ/aux/中顿（并且）/だ 、///sy きれい///na/漂亮 な//だ/aux/修饰名词/だ 店/みせ//n/店 でし//です/aux/是（礼貌）/です た///aux/过去 。///sy","那是一家非常安静、漂亮的店。"],
 [20,"この///rt/这个 店/みせ//n/店 の///p/的 コーヒー///n/咖啡 は/わ//p/表示主题 、///sy 一杯/いっぱい//nu/一杯 三百/さんびゃく//nu/三百 円/えん//n/日元 です///aux/是（礼貌） 。///sy","这家店的咖啡一杯三百日元。"],
 [25,"店員/てんいん//n/店员 さん///n/（敬称） が///p/主语 、///sy やさしく//やさしい/a/温柔地/やさしい 話し/はなし/話す/v/说话/はなす て///p/（连接） くれ//くれる/v/（为我）/くれる まし//ます/aux/礼貌/ます た///aux/过去 。///sy","店员很亲切地跟我聊天。"],
 [30,"来週/らいしゅう//n/下周 、///sy 友だち/ともだち//n/朋友 と///p/和 いっしょに///adv/一起 また///adv/再 行き/いき/行く/v/去/いく たい///aux/想（愿望） です///aux/礼貌 。///sy","下周想和朋友一起再去一次。"],
 [35,"みなさん///pr/大家 の///p/的 おすすめ///n/推荐 の///p/的 店/みせ//n/店 も///p/也 、///sy ぜひ///adv/务必 教え/おしえ/教える/v/告诉/おしえる て///p/（连接） ください//くださる/v/请（做）/くださる 。///sy","也请一定告诉我大家推荐的店。"],
 [41,"それでは///cj/那么 、///sy また///adv/再 来週/らいしゅう//n/下周 。///sy","那么，我们下周见。"],
 [44,"さようなら///it/再见 ！///sy","再见！"]
];
function demoLines(){
  return DEMO_LINES.map(([s,src,zh],i,a)=>{
    const tks=src.split(" ").map(x=>{const [ts,r,b,pos,z,br]=x.split("/");return normTok({s:ts,r:r||(KANA_ONLY.test(ts)?toHira(ts):""),b:b||ts,pos,zh:z,br})}).filter(Boolean);
    return {s,e:i+1<a.length?a[i+1][0]:s+3,ja:tks.map(t=>t[0]).join(""),zh,zhai:1,tk:tks};
  });
}

/* ============ 页面状态 ============ */
const ui={draft:"",msg:"",ok:false,delArm:null,ren:null,wAll:false};
let st=null;               /* 学习页（覆盖层）状态 */
const JOBS={};             /* AI 精读任务：id → {run,ctls,err,done,total} */
const aiOK=()=>!!(Y.ai&&Y.ai.available&&Y.ai.available());
const aiName=()=>Y.ai&&Y.ai.providerName?Y.ai.providerName():"";

/* ============ 样式（模块内注入，只用 :root token；亮/暗两套） ============ */
const LIGHT="--mp-n:#2F5FC4;--mp-pr:#0D78AD;--mp-nu:#7B4F2C;--mp-v:#C8423A;--mp-aux:#B83F78;--mp-a:#23804F;--mp-na:#0B7A7C;--mp-adv:#7A4BC4;--mp-p:#9E6A00;--mp-rt:#5F7410;--mp-cj:#C2501A;--mp-it:#8C3A3A;--mp-sy:#646C88;--mch-k:#2F5FC4;--mch-t:#23804F;--m-yt:#D93A2B;--m-bili:#D9487A;--m-nico:#3C3C3C;--m-cur:#FCEFD0";
const DARK="--mp-n:#8FB0FF;--mp-pr:#5FC8F0;--mp-nu:#D9B99B;--mp-v:#FF8C80;--mp-aux:#FF8FC2;--mp-a:#5FD39A;--mp-na:#4FD1CF;--mp-adv:#C3A4FF;--mp-p:#F2BC4E;--mp-rt:#C4D45A;--mp-cj:#FF9F5E;--mp-it:#FFB3B3;--mp-sy:#A3ACC6;--mch-k:#8FB0FF;--mch-t:#5FD39A;--m-yt:#FF7A6E;--m-bili:#FF8FB1;--m-nico:#D0D0D0;--m-cur:#3A3020";
const CSS=`:root{${LIGHT}}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${DARK}}}
:root[data-theme="dark"]{${DARK}}
${MPOS.map(([c])=>`.mp-${c}{--c:var(--mp-${c})}`).join("")}
.mch-k{color:var(--mch-k)}.mch-t{color:var(--mch-t)}.mch-o{color:var(--muted)}
.mform .row{align-items:stretch}
.mform input{min-width:0}
.mplat{width:44px;height:44px;border-radius:13px;display:inline-flex;align-items:center;justify-content:center;flex:none;background:var(--sunk);color:var(--muted);font-weight:900;font-size:18px;font-family:var(--f-ui)}
.mplat b[lang="ja"]{font-size:15px}
.mplat-yt{color:var(--m-yt)}.mplat-bili{color:var(--m-bili)}.mplat-nico{color:var(--m-nico)}.mplat-audio,.mplat-video{color:var(--ai)}.mplat-demo{color:var(--gold)}
.mitem{display:flex;flex-direction:column;gap:12px}
.mitem .mt{font-weight:700;overflow-wrap:anywhere;line-height:1.4}
.mitem .bar{height:6px;margin-top:6px}
.mbtns{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.mbtns .btn{text-decoration:none}
.mconfirm{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 12px;border-radius:12px;background:var(--bad-soft);font-size:14px}
.mconfirm .grow{min-width:160px}
.btn.mdanger{background:var(--bad);color:#fff}
.mren{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.mren input{flex:1;min-width:140px}
.mempty{text-align:center;display:flex;flex-direction:column;align-items:center;gap:10px;padding:28px 18px}
.mhow{display:flex;flex-direction:column;gap:6px}
.msteps{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px;font-size:14px;line-height:1.7;color:var(--muted)}
.msteps b{color:var(--ink)}
.mhow b{color:var(--ink)}
.mstudy{gap:12px}
.mhtitle{font-weight:700;line-height:1.35;overflow-wrap:anywhere}
.mplayer{position:sticky;top:0;z-index:3;background:var(--bg);margin-inline:-16px;padding:2px 16px 6px}
.mplayer:empty{display:none}
.mframe{position:relative;width:100%;aspect-ratio:16/9;max-height:36vh;border-radius:14px;overflow:hidden;background:#000}
.mframe iframe,.mframe video{position:absolute;inset:0;width:100%;height:100%;border:0;background:#000}
.mplayer audio{width:100%;display:block}
.mhelp{display:flex;flex-direction:column;gap:8px;font-size:13px;color:var(--muted)}
.mhelp .row{gap:8px;flex-wrap:wrap}
.mhelp a.chip{text-decoration:none;color:var(--ai);background:var(--ai-soft)}
.mwarn{padding:8px 12px;border-radius:12px;background:var(--gold-soft);color:var(--ink);font-size:13px}
.mopen{display:flex;flex-direction:column;gap:10px;align-items:flex-start}
.mai{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border-radius:14px;background:var(--surface);box-shadow:var(--shadow)}
.mai.okk{flex-direction:row;align-items:center;color:var(--good)}
.mai .bar{height:6px}
.mtg{align-items:center}
.mtg .chip{flex:none}
.mlegend{display:flex;flex-wrap:wrap;gap:4px 6px;font-size:12px}
.mlg{padding:1px 7px;border-radius:7px;background:var(--surface);box-shadow:var(--shadow);color:var(--c,var(--ink));font-weight:700}
.mlegend .mnote{color:var(--muted);font-weight:400;width:100%}
.mreader{display:flex;flex-direction:column;gap:8px}
.mline{padding:8px 12px 10px;border-radius:14px;background:var(--surface);box-shadow:var(--shadow);cursor:pointer;scroll-margin-top:42vh;scroll-margin-bottom:24px;transition:background .2s}
.mline:focus-visible{outline:2px solid var(--ai);outline-offset:2px}
.mline.cur{background:var(--m-cur)}
.mline.act{box-shadow:var(--shadow),inset 3px 0 0 var(--ai)}
.mlh{display:flex;gap:10px;align-items:flex-start}
.mtime{flex:none;margin-top:8px;padding:1px 7px;border-radius:8px;font-size:12px;color:var(--ai);background:var(--ai-soft);font-variant-numeric:tabular-nums}
.mno{flex:none;margin-top:8px;min-width:22px;text-align:right;font-size:12px;color:var(--faint);font-variant-numeric:tabular-nums}
.mja{flex:1;min-width:0;font-family:var(--f-jp);font-size:19px;line-height:2.15;overflow-wrap:anywhere}
.mzh{font-size:14px;color:var(--muted);line-height:1.6;margin-top:2px}
.mlh+.mzh,.mlh+.mtools{padding-left:4px}
.mtk{border-radius:5px;padding:0 1px;margin:0 .5px}
.mlines.mcolor .mtk{color:var(--c,inherit)}
.mlines.mcolor .mtk[data-act]{border-bottom:2px solid color-mix(in srgb,var(--c,var(--line)) 32%,transparent)}
.mtk[data-act]:hover,.mdict:hover{background:var(--sunk)}
.mtk.on{background:var(--ai-soft)}
.mdict{border-bottom:1.5px dashed var(--faint);border-radius:4px}
.mlines.mcolor .mdict{color:var(--c,inherit);border-bottom-color:color-mix(in srgb,var(--c,var(--faint)) 60%,transparent)}
.mlines:not(.mcolor) .mch-k,.mlines:not(.mcolor) .mch-t,.mlines:not(.mcolor) .mch-o{color:inherit}
.mtools{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.mtools .chip{cursor:pointer}
.mex{margin-top:8px;white-space:normal}
.mpop{position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);width:min(528px,calc(100% - 32px));z-index:30;display:flex;flex-direction:column;gap:10px;border:1px solid var(--line);animation:up .2s ease}
.mpw{font-family:var(--f-jp);font-size:24px;font-weight:700;line-height:1.3;overflow-wrap:anywhere}
.mptag{display:inline-flex;align-items:center;padding:1px 8px;border-radius:8px;font-size:12px;font-weight:700;color:var(--c,var(--muted));border:1.5px solid currentColor;white-space:nowrap}
.mkv{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font-size:14px;align-items:baseline}
.mkv dt{color:var(--muted);font-size:12px;white-space:nowrap}
.mkv dd{margin:0;overflow-wrap:anywhere}
.msubs textarea{min-height:110px}
.msubs .stack{gap:10px}
.mwrow .wja{font-size:17px}
@media (max-width:380px){.mja{font-size:18px}.mplat{width:40px;height:40px}}`;
function ensureCss(){
  const D=W.document;if(!D||!D.head||!D.createElement||D.getElementById("yume-media-css"))return;
  const s=D.createElement("style");s.id="yume-media-css";s.textContent=CSS;D.head.appendChild(s);
}

/* ============ 视听页（标签页） ============ */
function itemCard(it){
  const P=PLAT[it.plat]||PLAT.web;const job=JOBS[it.id];
  const url=it.plat==="demo"?null:pageUrl(it);
  const ren=ui.ren===it.id;
  const info=[P.n,it.n?it.n+" 行字幕":"还没有字幕"];
  if(it.n){const left=it.n-(it.ai||0);info.push(job&&job.run?`AI 精读中 ${it.ai}/${it.n}`:it.tk&&!left?"AI 精读完成":it.tk?`AI 精读 ${it.ai}/${it.n}`:aiOK()?"未精读":"简易模式")}
  return `<div class="card mitem"><div class="row" style="align-items:flex-start">${platBadge(it)}<div class="grow">
    ${ren?renameForm(it,"list"):`<div class="mt">${esc(it.t)}</div>`}
    <div class="small muted">${info.map(esc).join(" · ")}</div>
    ${it.n&&(it.tk||job)?`<div class="bar"><i style="width:${Math.round((it.ai||0)/it.n*100)}%"></i></div>`:""}</div></div>
    <div class="mbtns"><button class="btn primary sm" data-act="media-open" data-id="${esc(it.id)}">${IC.play}${it.n?"学习":"打开"}</button>
      ${url?`<a class="btn sm" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${IC.ext}原网页</a>`:""}
      <span class="grow"></span>
      <button class="iconbtn" data-act="media-ren" data-id="${esc(it.id)}" data-w="list" aria-label="改标题">${IC.edit}</button>
      <button class="iconbtn" data-act="media-del" data-id="${esc(it.id)}" aria-label="删除">${IC.trash}</button></div>
    ${ui.delArm===it.id?`<div class="mconfirm" role="alert"><span class="grow">删除「${esc(it.t)}」？字幕和 AI 精读结果会一起删掉。</span><button class="btn sm" data-act="media-delno">取消</button><button class="btn sm mdanger" data-act="media-delyes" data-id="${esc(it.id)}">删除</button></div>`:""}
  </div>`;
}
function renameForm(it,where){
  return `<form class="mren" data-submit="media-rensave" data-id="${esc(it.id)}" data-w="${where}"><input type="text" id="media-ren-${where}" value="${esc(it.t)}" maxlength="80" aria-label="标题"><button class="btn primary sm" type="submit">保存</button><button class="btn ghost sm" type="button" data-act="media-rencancel" data-w="${where}">取消</button></form>`;
}
function howtoHTML(open){
  return `<details class="fold note" ${open?"open":""}><summary><span class="tagk">?</span>字幕从哪里来？</summary><div class="mhow">
  <div>网页没办法从视频链接里直接抓取声音做语音识别，所以要先拿到字幕文字，再导入到学习页。常用的办法：</div>
  <div>· <b>B 站</b>：很多视频右下角「字幕」里有 UP 主上传的字幕或 AI 字幕。可以用能导出 B 站字幕的浏览器扩展导出 SRT / JSON，或者一句一句复制粘贴进来。</div>
  <div>· <b>YouTube</b>：视频简介里点「…更多」→「显示文字记录」，全选复制后粘贴进来，时间轴会自动识别。</div>
  <div>· <b>剪映</b>（电脑版）：导入视频或音频 →「文本」→「智能字幕」，识别语言选日语 → 导出 SRT 字幕文件。</div>
  <div>· <b>飞书妙记</b>：上传音视频，自动转写成日语文字，导出文字记录后粘贴进来。</div>
  <div>· <b>播客</b>：有的节目在简介或官网附有文稿，复制下来，一行一句即可。</div>
  <div>导入以后点「AI 精读」，就能得到逐词读音、词性颜色和中日双语翻译。</div></div></details>`;
}
/* 三步上手：说清楚这个页面能做什么、不能做什么（网页不能直接从视频链接生成字幕） */
function stepsHTML(open){
  const body=`<ol class="msteps"><li><b>贴链接</b>：B 站 / YouTube 视频或播客链接，加入视听库，在这里播放（打不开的可以在新窗口看）。</li>
    <li><b>导入字幕</b>：网页没办法从链接里直接识别语音生成字幕，需要先拿到字幕文字——SRT 等字幕文件，或从 YouTube「文字记录」、剪映智能字幕等复制的文字（见下面「字幕从哪里来」）。</li>
    <li><b>AI 精读</b>：在「我的 → AI 设置」填 DeepSeek 或通义千问的 API Key（按量付费，一般几毛钱一个视频；在 claude.ai 里打开会直接用 Claude），就能得到逐词词性颜色、读音和逐句中文翻译。没设置 AI 时只按汉字 / 假名上色，字幕自带中文的那几句才有翻译。</li></ol>`;
  return open?`<div class="card stack" style="gap:8px"><div class="eyebrow">三步上手</div>${body}</div>`
    :`<details class="fold"><summary>三步上手：链接 → 字幕 → AI 精读</summary>${body}</details>`;
}
function wordsCard(){
  const ws=mwWords();if(!ws.length)return "";
  const list=ws.slice().reverse();const shown=ui.wAll?list:list.slice(0,12);
  return `<div class="card stack" style="gap:8px"><div class="row" style="justify-content:space-between;flex-wrap:wrap"><div class="eyebrow">视听生词 · ${ws.length} 个</div>
    <div class="row" style="gap:8px"><button class="btn sm" data-act="media-wbook">在单词本里看</button><button class="btn primary sm" data-act="media-wrev">练习这些词</button></div></div>
    <div class="wlist">${shown.map(w=>`<div class="wrow mwrow"><div class="grow"><div class="wline"><span class="wja" lang="ja">${esc(w.ja)}</span>${w.kana&&w.kana!==w.ja?`<span class="wkana" lang="ja">${esc(w.kana)}</span>`:""}${Y.posTag(w.pos)}</div><div class="wzh">${esc(w.zh)}</div></div>${Y.lvDots(w)}<div class="acts" style="display:flex;gap:6px">${Y.sayBtn(w.kana||w.ja)}<button class="iconbtn" data-act="media-wdel" data-ja="${esc(w.ja)}" aria-label="从视听生词删除">${IC.trash}</button></div></div>`).join("")}</div>
    ${list.length>shown.length?`<button class="btn ghost sm" data-act="media-wall">显示全部 ${list.length} 个</button>`:""}
    <div class="small muted">这些词也会出现在「单词本 → 自制课程」和每日复习里。</div></div>`;
}
function vMedia(){
  ensureCss();
  const items=lib().items.slice().sort((a,b)=>(b.last||b.added||0)-(a.last||a.added||0));
  const on=aiOK();
  return `<div class="stack">
  <div><div class="eyebrow">视听 · 看视频、听播客学日语</div><h1 style="font-size:24px">视听</h1></div>
  <form class="card stack mform" style="gap:10px" data-submit="media-add" autocomplete="off">
    <label class="eyebrow" for="media-url">粘贴视频或播客链接</label>
    <div class="row" style="gap:8px"><input type="text" id="media-url" class="grow" inputmode="url" spellcheck="false" placeholder="B 站 / YouTube 链接、BV 号、音频直链…" value="${esc(ui.draft)}" data-input="media-draft"><button class="btn primary" type="submit">添加</button></div>
    ${ui.msg?`<div class="small" role="status" style="color:${ui.ok?"var(--good)":"var(--bad)"}">${esc(ui.msg)}</div>`
      :`<div class="small muted">支持 bilibili.com/video/BV…、YouTube（含 youtu.be、Shorts）、niconico、mp3 / m4a 音频直链；小宇宙、Apple 播客等其他网站会给你「在新窗口打开」。</div>`}
  </form>
  ${on?`<div class="row small muted" style="gap:6px">${IC.spark}<span>AI 精读已开启：${esc(aiName())}</span></div>`
     :`<div class="card row" style="gap:12px;align-items:flex-start"><span class="seal" lang="ja" style="border-color:var(--ai);color:var(--ai)">訳</span><div class="grow"><b>AI 精读还没开启</b><div class="small muted">现在可以导入字幕、朗读、按字符类型看颜色。想要逐词词性颜色、读音和中文翻译，去「我的 → AI 设置」填一个 DeepSeek 或通义千问的 Key。</div></div><button class="btn sm" data-act="media-aiset">去设置</button></div>`}
  ${stepsHTML(!items.some(x=>x.plat!=="demo"))}
  <div class="sechead"><div class="eyebrow">我的视听库 · ${items.length}</div>${!items.length||items.some(x=>x.plat==="demo")?"":`<button class="btn ghost sm" data-act="media-demo">${IC.spark}看示例</button>`}</div>
  ${items.length?items.map(itemCard).join(""):`<div class="card mempty"><span class="seal" lang="ja">視</span><b>还没有添加视频</b><div class="small muted">粘贴一个 B 站或 YouTube 链接，再导入字幕，就能一句一句精读。也可以先看看内置的原创示例。</div><button class="btn primary sm" data-act="media-demo">${IC.spark}打开示例</button></div>`}
  ${wordsCard()}
  ${howtoHTML(false)}
  </div>`;
}

/* ============ 学习页（全屏覆盖层） ============ */
const cur=()=>st&&itemById(st.id);
const lines=()=>st?sub(st.id).lines:[];
const seekable=it=>!!it&&(!!st.local||["yt","bili","audio","video"].includes(it.plat));
const inClaude=()=>!!(W.claude&&typeof W.claude.use==="function");
function headHTML(){
  const it=cur();const P=PLAT[it.plat]||PLAT.web;
  return `<button class="iconbtn" data-act="media-close" aria-label="返回视听库">${IC.back}</button>
  <div class="grow" style="min-width:0">${st.ren?renameForm(it,"ov"):`<div class="eyebrow">${esc(P.n)}${it.n?` · ${it.n} 行字幕`:""}</div><div class="mhtitle">${esc(it.t)}</div>`}</div>
  ${st.ren?"":`<button class="iconbtn" data-act="media-ren" data-id="${esc(it.id)}" data-w="ov" aria-label="改标题">${IC.edit}</button>`}`;
}
const IFR_ATTR=`allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin"`;
function originParam(){try{const o=W.location.origin;return /^https?:\/\//.test(o)?o:""}catch(e){return ""}}
function ytEmbed(it,start,auto){let q="enablejsapi=1&playsinline=1&rel=0&modestbranding=1";const o=originParam();if(o)q+="&origin="+encodeURIComponent(o);if(start>0)q+="&start="+Math.floor(start);if(auto)q+="&autoplay=1";return "https://www.youtube-nocookie.com/embed/"+it.vid+"?"+q}
function biliEmbed(it,t,auto){const id=/^av/.test(it.vid)?"aid="+it.vid.slice(2):"bvid="+it.vid;const p=it.p||1;return "https://player.bilibili.com/player.html?"+id+"&p="+p+"&page="+p+"&high_quality=1&danmaku=0&autoplay="+(auto?1:0)+(t>0?"&t="+Math.floor(t):"")}
function playerHTML(){
  const it=cur();
  if(st.local){const L=st.local;return `<div class="${L.kind==="video"?"mframe":""}">${L.kind==="video"?`<video id="m-media" controls playsinline preload="metadata" src="${esc(L.url)}"></video>`:`<audio id="m-media" controls preload="metadata" src="${esc(L.url)}"></audio>`}</div>`}
  if(it.plat==="yt"&&VID_OK.yt.test(it.vid))return `<div class="mframe"><iframe id="m-ifr" src="${esc(ytEmbed(it,it.start||0))}" title="YouTube 播放器" ${IFR_ATTR}></iframe></div>`;
  if(it.plat==="bili"&&VID_OK.bili.test(it.vid))return `<div class="mframe"><iframe id="m-ifr" src="${esc(biliEmbed(it,it.start||0,false))}" title="B 站播放器" ${IFR_ATTR}></iframe></div>`;
  if(it.plat==="nico"&&VID_OK.nico.test(it.vid))return `<div class="mframe"><iframe id="m-ifr" src="https://embed.nicovideo.jp/watch/${esc(it.vid)}" title="niconico 播放器" ${IFR_ATTR}></iframe></div>`;
  const u=Y.safeUrl(it.url);
  if(it.plat==="audio"&&u)return `<audio id="m-media" controls preload="metadata" src="${esc(u)}"></audio>`;
  if(it.plat==="video"&&u)return `<div class="mframe"><video id="m-media" controls playsinline preload="metadata" src="${esc(u)}"></video></div>`;
  return "";
}
function helpHTML(){
  const it=cur();const u=it.plat==="demo"?null:pageUrl(it);
  const open=u?`<a class="chip" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${IC.ext}在新窗口打开</a>`:"";
  const local=`<label class="chip btnchip" for="m-local" style="cursor:pointer">${IC.spk}${st.local?"换一个本机文件":"用本机音频/视频播放"}</label><input type="file" id="m-local" accept="audio/*,video/*" data-change="media-local" hidden>${st.local?`<button class="chip btnchip" data-act="media-unlocal">换回原链接</button>`:""}`;
  let tip="";
  if(st.local)tip=`正在播放本机文件「${esc(st.local.name)}」（只在这台设备上，不会上传）。点句子左边的时间可以跳到那一句。`;
  else if(it.plat==="yt")tip="YouTube 在中国大陆一般需要 VPN 才能打开。播放器一直空白的话，点「在新窗口打开」，字幕照样可以在这里学。";
  else if(it.plat==="bili")tip="B 站外链播放器画质较低，看不清可以点「在新窗口打开」。点句子左边的时间会让播放器从那一句开始播放（会重新加载）。";
  else if(it.plat==="nico")tip="niconico 需要能访问日本网站；打不开就点「在新窗口打开」。";
  else if(it.plat==="audio"||it.plat==="video")tip="点句子左边的时间可以跳到那一句。如果播放不了，可能是对方网站不允许外链，点「在新窗口打开」。";
  else if(it.plat==="demo")tip="这是内置的原创示例，没有视频：点句子听朗读，点单词看解释，也可以用「连续朗读」。";
  else tip="这个网站不能嵌入播放：点「在新窗口打开」，一边听一边看下面的字幕。";
  const box=it.plat==="web"?`<div class="card mopen"><b>在新窗口里播放</b>${tip?`<div class="small muted">${tip}</div>`:""}${u?`<a class="btn primary sm" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${IC.ext}打开原网页</a>`:""}</div>`:"";
  const claudeTip=inClaude()&&["yt","bili","nico"].includes(it.plat)&&!st.local?`<div class="mwarn">在 claude.ai 预览里，外部视频播放器可能会被拦截。看不到画面就点「在新窗口打开」，或使用独立网站版。</div>`:"";
  return `${box}<div class="mhelp">${claudeTip}<div id="m-warn" class="mwarn" ${st.warn?"":"hidden"}>${esc(st.warn||"")}</div>${it.plat==="web"?"":`<div id="m-tip" ${st.warn?"hidden":""}>${tip}</div>`}<div class="row">${it.plat==="web"?"":open}${local}</div></div>`;
}
function panelHTML(){
  const it=cur();const L=lines();if(!L.length)return "";
  const job=JOBS[it.id];const total=L.length;const done=L.filter(lineDone).length;const left=total-done;const hasTk=L.some(l=>l.tk);
  let ai;
  if(job&&job.run)ai=`<div class="mai"><div class="row"><span class="grow small"><b>AI 精读中…</b> ${done}/${total} 句</span><button class="btn sm" data-act="media-aistop">停止</button></div><div class="bar"><i style="width:${done/total*100}%"></i></div><div class="small muted">每批约 15 句，一批要十几秒到一分钟。已完成的句子会马上显示出来。</div></div>`;
  else if(!left&&hasTk)ai=`<div class="mai okk">${IC.check}<span class="grow small">AI 精读完成${job&&job.by?" · "+esc(job.by):""}</span>${aiOK()?`<button class="chip btnchip" data-act="media-aire">${st.reArm?"再点一次确认":"重新精读"}</button>`:""}</div>`;
  else if(aiOK())ai=`<div class="mai"><div class="row" style="align-items:flex-start"><div class="grow"><b>AI 精读</b><div class="small muted">逐词读音、原形、词性颜色、中文意思，加整句中文翻译${done&&hasTk?` · 已完成 ${done}/${total}`:""}</div></div><button class="btn primary sm" data-act="media-aigo">${IC.spark}${done&&hasTk?"继续":"开始"}</button></div>
      ${job&&job.err?`<div class="small err" role="alert">${esc(job.err)}</div>`:""}<div class="small muted">使用 ${esc(aiName())}${left>45?`，共 ${left} 句，大约要 ${Math.max(1,Math.round(left/15*0.5))} 分钟以上`:""}。</div></div>`;
  else ai=`<div class="mai"><div class="small"><b>简易模式</b>：没有设置 AI，所以按字符类型上色；虚线标出的是课程里学过的词，可以点开看意思。想要逐词词性、读音和中文翻译，到「我的 → AI 设置」填一个 DeepSeek 或通义千问的 Key（在 claude.ai 里打开会直接用 Claude）。</div><button class="btn sm" data-act="media-aiset" style="align-self:flex-start">去设置 AI</button></div>`;
  const tg=(k,label)=>`<button class="chip btnchip ${V[k]?"on":""}" data-act="media-vt" data-k="${k}" aria-pressed="${!!V[k]}">${label}</button>`;
  const legend=!V.pos?"":hasTk?`<div class="mlegend" aria-label="词性颜色">${MPOS.map(([c,n])=>`<span class="mlg mp-${c}">${n}</span>`).join("")}</div>`
    :`<div class="mlegend"><span class="mlg mch-k">汉字</span><span class="mlg">平假名</span><span class="mlg mch-t">片假名</span><span class="mlg" style="text-decoration:underline dashed;text-underline-offset:3px">课程学过的词（按词性上色）</span></div>`;
  return `${ai}<div class="hscroll mtg">${tg("furi",'<span lang="ja">ふりがな</span>')}${tg("zh","中文翻译")}${tg("pos","词性颜色")}${seekable(it)?tg("follow","跟随播放"):""}<button class="chip btnchip ${st.reading?"on":""}" data-act="media-readall">${IC.spk}${st.reading?"停止朗读":"连续朗读"}</button></div>${legend}`;
}
function tokHTML(i,j,t){
  const s=tk(t,0),pos=tk(t,3);
  if(!pos)return esc(s);
  if(pos==="sy")return `<span class="mtk mp-sy">${esc(s)}</span>`;
  const on=st.pop&&st.pop.type==="tok"&&st.pop.i===i&&st.pop.j===j;
  return `<span class="mtk mp-${pos}${on?" on":""}" data-act="media-tok" data-i="${i}" data-j="${j}">${rubyTok(s,tk(t,1),V.furi)}</span>`;
}
function simpleHTML(i,ja){
  let out="",buf="",ty=null,k=0;
  const flush=()=>{if(buf){out+=ty==="h"?esc(buf):`<span class="mch-${ty}">${esc(buf)}</span>`;buf=""}};
  while(k<ja.length){
    const hit=dictAt(ja,k);
    if(hit){flush();ty=null;const [len,e]=hit;const seg=ja.substr(k,len);const c=FROM_COURSE[e.w.pos]||"n";
      out+=`<span class="mdict mp-${c}" data-act="media-dict" data-i="${i}" data-k="${esc(e.w.key)}">${rubyTok(seg,e.kana,V.furi)}</span>`;k+=len;continue}
    const t=chType(ja[k]);if(t!==ty){flush();ty=t}buf+=ja[k];k++;
  }
  flush();return out;
}
function lineHTML(i){
  const l=lines()[i];if(!l)return "";const it=cur();
  const act=st.active===i,isCur=st.cur===i;
  const body=l.tk?l.tk.map((t,j)=>tokHTML(i,j,t)).join(""):simpleHTML(i,l.ja);
  const tm=l.s!=null?`<button class="mtime" data-act="media-seek" data-i="${i}" aria-label="跳到 ${fmtT(l.s)}">${fmtT(l.s)}</button>`:`<span class="mno">${i+1}</span>`;
  let tools="";
  if(act){
    tools=`<div class="mtools"><button class="chip btnchip" data-act="media-say" data-i="${i}" data-r="slow">${IC.spk}慢速朗读</button>${seekable(it)&&l.s!=null?`<button class="chip btnchip" data-act="media-seek" data-i="${i}">${IC.play}播放原声</button>`:""}${aiOK()?`<button class="chip btnchip" data-act="media-explain" data-i="${i}" ${st.exBusy===i?"disabled":""}>${IC.spark}${st.exBusy===i?"讲解中…":l.ex?"重新讲解":"AI 讲解这句"}</button>`:""}<button class="chip btnchip" data-act="media-copy" data-i="${i}">复制</button></div>`;
  }
  const ex=l.ex&&(act||st.showEx===i)?`<div class="why mex small">${escNl(l.ex)}</div>`:"";
  const exErr=act&&st.exErr&&st.exErrI===i?`<div class="small err">${esc(st.exErr)}</div>`:"";
  return `<div class="mline${isCur?" cur":""}${act?" act":""}" id="ml-${i}" data-act="media-line" data-i="${i}" tabindex="0"><div class="mlh">${tm}<div class="mja jr" lang="ja">${body}</div></div>${V.zh&&l.zh?`<div class="mzh">${esc(l.zh)}</div>`:""}${tools}${ex}${exErr}</div>`;
}
function readerHTML(){
  const L=lines();
  if(!L.length)return `<div class="card mempty"><span class="seal" lang="ja">字</span><b>还没有字幕</b><div class="small muted">在下面「导入字幕」里粘贴字幕，或者选择字幕文件（SRT、VTT、LRC、TXT…），就可以一句一句学了。</div></div>`;
  const n=Math.min(L.length,st.lim);let h="";for(let i=0;i<n;i++)h+=lineHTML(i);
  return `<div class="mreader mlines ${V.pos?"mcolor":""}">${h}</div>${L.length>n?`<button class="btn block" data-act="media-more">再显示 ${Math.min(300,L.length-n)} 句（还有 ${L.length-n} 句）</button>`:""}`;
}
function subsHTML(){
  const L=lines();const has=L.length>0;const it=cur();
  return `<details class="fold msubs" ${has?"":"open"}><summary>${IC.list}${has?"替换或追加字幕":"导入字幕"}</summary><div class="stack">
    <form class="stack" data-submit="media-paste" style="gap:8px">
      <label class="small muted" for="m-paste">把字幕粘贴到这里</label>
      <textarea id="m-paste" spellcheck="false" lang="ja" placeholder="例如 SRT：&#10;1&#10;00:00:01,000 --> 00:00:03,000&#10;こんにちは。&#10;&#10;或者一行一句的纯文本"></textarea>
      <div class="row" style="flex-wrap:wrap;gap:8px"><button class="btn primary sm" type="submit">导入粘贴的字幕</button><label class="btn sm" for="m-file" style="cursor:pointer">选择字幕文件</label><input type="file" id="m-file" accept=".srt,.vtt,.lrc,.ass,.ssa,.txt,.json,text/plain,application/json" data-change="media-file" hidden></div>
      ${has?`<label class="row small" style="gap:8px;cursor:pointer"><input type="checkbox" id="m-append"${st.append?" checked":""} data-change="media-append"> 追加到现有字幕后面（不勾选就替换）</label>`:""}
      <div id="m-submsg" class="small" role="status">${subMsgHTML()}</div>
    </form>
    <div class="small muted">支持 SRT、VTT、ASS、LRC、B 站字幕 JSON、YouTube「文字记录」复制的文本（带时间）、纯文本（一行一句）。中日双语字幕会自动把中文那一行当作翻译。字幕只保存在这台设备上。${it.src?`<br>当前字幕来源：${esc(it.src)}`:""}</div>
  </div></details>${howtoHTML(!has)}`;
}
function subMsgHTML(){
  if(st.pending){const p=st.pending;return `<div class="mconfirm"><span class="grow">识别到 ${p.res.lines.length} 句（${esc(FMT_NAME[p.res.fmt]||"")}）。替换会清除现有字幕和 AI 精读结果。</span><button class="btn sm" data-act="media-pendno">取消</button><button class="btn sm" data-act="media-pendapp">改为追加</button><button class="btn sm mdanger" data-act="media-pendyes">替换</button></div>`}
  return st.subMsg?`<span style="color:${st.subOk?"var(--good)":"var(--bad)"}">${esc(st.subMsg)}</span>`:"";
}
function popHTML(){
  const p=st&&st.pop;if(!p)return "";
  if(p.type==="tok"){
    const l=lines()[p.i];const t=l&&l.tk&&l.tk[p.j];if(!t)return "";
    const s=tk(t,0),r=tk(t,1),b=tkBase(t),pos=tk(t,3),zh=tk(t,4);
    const br=baseReading(s,r,b,tk(t,5));
    const hit=courseHit(b,s);
    const ja=b||s;const inBook=mwHas(ja);const showR=r&&r!==toHira(s);
    return `<div class="card mpop" role="dialog" aria-label="单词"><div class="row" style="align-items:flex-start"><div class="grow"><div class="mpw" lang="ja">${esc(s)}</div>${showR?`<div class="small muted" lang="ja">${KANJI_RE.test(s)?"":"读作 "}${esc(r)}</div>`:""}</div><span class="mptag mp-${pos}">${esc(POSNAME[pos]||"")}</span><button class="iconbtn" data-act="media-popx" aria-label="关闭">${IC.close}</button></div>
      <dl class="mkv">${zh?`<dt>中文</dt><dd>${esc(zh)}</dd>`:""}${b&&b!==s?`<dt>原形</dt><dd lang="ja"><b>${esc(b)}</b>${br&&br!==b?`（${esc(br)}）`:""}</dd>`:""}${hit?`<dt>课程</dt><dd>${esc(lessonLabel(hit))}：${esc(Y.plain(hit.ja))} · ${esc(hit.zh)}</dd>`:""}</dl>
      <div class="row" style="flex-wrap:wrap;gap:8px"><button class="btn sm" data-act="say" data-t="${esc(br||r||s)}">${IC.spk}朗读</button>
        ${hit?`<button class="btn sm" data-act="media-golesson" data-k="${esc(hit.key)}">去课程看看</button>`:""}
        <button class="btn primary sm" data-act="media-addw" ${inBook?"disabled":""}>${inBook?IC.check+"已在单词本":"加入单词本"}</button></div></div>`;
  }
  if(p.type==="dict"){
    const w=Y.word(p.k);if(!w)return "";const s=Y.wordState(w);
    return `<div class="card mpop" role="dialog" aria-label="单词"><div class="row" style="align-items:flex-start"><div class="grow"><div class="mpw" lang="ja">${esc(Y.plain(w.ja))}</div>${w.kana&&w.kana!==w.ja?`<div class="small muted" lang="ja">${esc(w.kana)}</div>`:""}</div>${Y.posTag(w.pos)}<button class="iconbtn" data-act="media-popx" aria-label="关闭">${IC.close}</button></div>
      <dl class="mkv"><dt>中文</dt><dd>${esc(w.zh)}</dd><dt>课程</dt><dd>${esc(lessonLabel(w))}</dd></dl>
      <div class="small muted">简易模式按课程词库匹配，可能不准；开启 AI 精读可以得到准确的分词。</div>
      <div class="row" style="flex-wrap:wrap;gap:8px"><button class="btn sm" data-act="say" data-t="${esc(w.kana||Y.plain(w.ja))}">${IC.spk}朗读</button><button class="btn sm" data-act="media-golesson" data-k="${esc(w.key)}">去课程看看</button>
        <button class="btn primary sm" data-act="media-review" data-k="${esc(w.key)}" ${s?"disabled":""}>${s?IC.check+"已在学习中":"加入复习"}</button></div></div>`;
  }
  return "";
}
function lessonLabel(w){const l=Y.lesson(w.lid);if(!l)return "课程";const b=Y.book(l.book);return (b?b.t+" ":"")+(l.no?`第${l.no}课`:l.t)}
function studyHTML(){
  return `<div class="sin mstudy"><div class="shead" id="m-head">${headHTML()}</div><div class="mplayer" id="m-player">${playerHTML()}</div><div id="m-help">${helpHTML()}</div><div id="m-panel" class="stack" style="gap:10px">${panelHTML()}</div><div id="m-reader">${readerHTML()}</div><div id="m-subs" class="stack" style="gap:10px">${subsHTML()}</div><div id="m-pop">${popHTML()}</div></div>`;
}
const PARTS={head:headHTML,player:playerHTML,help:helpHTML,panel:panelHTML,reader:readerHTML,subs:subsHTML,pop:popHTML};
function paint(...parts){if(!st||!Y.overlayOpen())return;for(const p of parts){const el=$("m-"+p);if(el)el.innerHTML=PARTS[p]()}if(parts.includes("player"))mountPlayer();if(parts.includes("reader"))markCur()}
function paintLine(i){if(!st)return;const el=$("ml-"+i);if(el)el.outerHTML=lineHTML(i)}
/* 多显示一些字幕：只在末尾追加新的行（不把已经显示的几百行全部重画） */
function growReader(to){
  if(!st)return;const L=lines();const from=Math.min(L.length,st.lim);st.lim=to;const n=Math.min(L.length,to);
  const box=document.querySelector("#m-reader .mreader");
  if(!box||n<=from){paint("reader");return}
  let h="";for(let i=from;i<n;i++)h+=lineHTML(i);
  box.insertAdjacentHTML("beforeend",h);
  const more=document.querySelector('#m-reader [data-act="media-more"]');
  if(more){if(L.length>n)more.textContent=`再显示 ${Math.min(300,L.length-n)} 句（还有 ${L.length-n} 句）`;else more.remove()}
  markCur();
}
function setMsg(msg,ok){if(!st)return;st.subMsg=msg;st.subOk=!!ok;const el=$("m-submsg");if(el)el.innerHTML=subMsgHTML()}

function openStudy(id){
  const it=itemById(id);if(!it)return;
  ensureCss();
  it.last=Date.now();saveLib();
  st={id,active:-1,cur:-1,pop:null,lim:300,local:null,warn:"",subMsg:"",subOk:false,pending:null,append:false,ren:false,reading:false,exBusy:-1,timers:[],loaded:false,reArm:false};
  Y.openOverlay(studyHTML(),{onKey:studyKey,onClose:closeStudy,rerender:()=>paint("panel","reader","pop")});
  W.addEventListener("message",onMsg);
  mountPlayer();
}
function closeStudy(){
  if(!st)return;readTok++;
  for(const t of st.timers)clearTimeout(t);
  W.removeEventListener("message",onMsg);
  if(st.local)try{URL.revokeObjectURL(st.local.url)}catch(e){}
  const id=st.id,busy=st.exBusy>=0;
  st=null;
  if(!busy)releaseSub(id);/* 字幕可能很大：不用了就从内存里放掉（AI 讲解还没回来的，等它回来再放） */
}
function later(fn,ms){if(!st)return;st.timers.push(setTimeout(fn,ms))}
function showWarn(msg){if(!st)return;st.warn=msg;const el=$("m-warn");if(el){el.textContent=msg;el.hidden=!msg}const tp=$("m-tip");if(tp)tp.hidden=!!msg}
/* 播放器挂载后：监听加载、超时提示、YouTube 连通性探测、时间同步 */
function mountPlayer(){
  if(!st)return;const it=cur();st.loaded=false;
  const f=$("m-ifr"),m=$("m-media");
  if(f){
    f.addEventListener("load",()=>{if(!st)return;st.loaded=true;if(it.plat==="yt")ytListen(0)});
    later(()=>{if(st&&!st.loaded)showWarn(it.plat==="yt"?"播放器 10 秒还没加载出来：YouTube 在中国大陆一般需要 VPN。可以点「在新窗口打开」，或者只用下面的字幕学习。":"播放器加载很慢或被拦截了，可以点「在新窗口打开」。")},10000);
    if(it.plat==="yt"&&!st.local){
      /* 用缩略图探测 YouTube 能不能连上（国内常被墙） */
      try{const img=new Image();let done=false;const fin=ok=>{if(done)return;done=true;if(!ok&&st&&st.id===it.id)showWarn("YouTube 好像连不上（在中国大陆一般需要 VPN）。可以点「在新窗口打开」，字幕照样可以在这里学。")};
        img.onload=()=>fin(true);img.onerror=()=>fin(false);later(()=>fin(false),9000);img.src="https://i.ytimg.com/vi/"+it.vid+"/default.jpg"}catch(e){}
    }
  }
  if(m){
    m.addEventListener("timeupdate",()=>onTime(m.currentTime));
    m.addEventListener("error",()=>{if(st)showWarn(st.local?"这个文件浏览器播放不了，换个格式试试（mp3 / m4a / mp4）。":"这个链接播放不了（可能对方网站不允许外链播放）。可以点「在新窗口打开」。")});
  }
}
/* YouTube iframe API（postMessage）：listening 后会收到 infoDelivery.currentTime */
function ytPost(o){const f=$("m-ifr");if(!f||!f.contentWindow)return false;try{f.contentWindow.postMessage(JSON.stringify(Object.assign({id:"yume",channel:"widget"},o)),"*");return true}catch(e){return false}}
function ytListen(n){if(!st||st.ytOk||n>6)return;ytPost({event:"listening"});later(()=>ytListen(n+1),1000)}
function onMsg(e){
  if(!st)return;const f=$("m-ifr");if(!f||e.source!==f.contentWindow)return;
  let d=e.data;if(typeof d==="string"){try{d=JSON.parse(d)}catch(x){return}}if(!d||typeof d!=="object")return;
  st.ytOk=true;
  if(d.info&&typeof d.info==="object"&&typeof d.info.currentTime==="number")onTime(d.info.currentTime);
}
function lineAt(t){
  const L=lines();let lo=0,hi=L.length-1,ans=-1;
  while(lo<=hi){const mid=(lo+hi)>>1;const s=L[mid].s;if(s==null)return -1;if(s<=t+.15){ans=mid;lo=mid+1}else hi=mid-1}
  if(ans>=0){const l=L[ans],n=L[ans+1];if(l.e!=null&&t>l.e+1.5&&(!n||t<n.s))return -1}
  return ans;
}
function onTime(t){if(!st)return;st.t=t;const i=lineAt(t);if(i!==st.cur)setCur(i,V.follow)}
function setCur(i,scroll){
  if(!st)return;const old=st.cur;st.cur=i;
  if(old>=0){const o=$("ml-"+old);if(o)o.classList.remove("cur")}
  if(i<0)return;
  if(i>=st.lim)growReader(i+100);/* 追加到这一句为止，然后照常高亮、滚动 */
  const el=$("ml-"+i);if(!el)return;el.classList.add("cur");
  if(scroll){const r=el.getBoundingClientRect(),h=W.innerHeight||800;if(r.top<h*.4||r.bottom>h-20)try{el.scrollIntoView({block:"center",behavior:"smooth"})}catch(e){el.scrollIntoView()}}
}
function markCur(){if(st&&st.cur>=0){const el=$("ml-"+st.cur);if(el)el.classList.add("cur")}}
function setActive(i){if(!st)return;const old=st.active;st.active=i;if(old>=0&&old!==i)paintLine(old);paintLine(i)}
function speakLine(i,rate){const l=lines()[i];if(!l)return Promise.resolve(false);return Y.speak(l.ja,{rate:rate||.9})}
function seekTo(i){
  const it=cur();const l=lines()[i];if(!l)return;
  if(l.s==null){speakLine(i);return}
  stopReading();Y.stopSpeak();
  const m=$("m-media");
  if(m){try{m.currentTime=l.s;const p=m.play();if(p&&p.catch)p.catch(()=>{})}catch(e){}}
  else if(it.plat==="yt"){if(!ytPost({event:"command",func:"seekTo",args:[l.s,true]})||!st.loaded){Y.toast("播放器还没加载好")}else ytPost({event:"command",func:"playVideo",args:[]})}
  else if(it.plat==="bili"){const f=$("m-ifr");if(f){st.loaded=false;f.src=biliEmbed(it,l.s,true)}}
  else{Y.toast("这个平台不能跳转，请在原网页里拖到 "+fmtT(l.s));return}
  setCur(i,false);
}
let readTok=0;
function stopReading(){if(st&&st.reading){readTok++;st.reading=false;Y.stopSpeak();paint("panel")}}
async function readAll(){
  if(!st)return;if(st.reading){stopReading();return}
  if(!Y.tts||!Y.tts.ok){Y.toast("这个浏览器不支持朗读，换 Chrome、Edge 或 Safari 试试");return}
  if(!Y.tts.ja())Y.toast("没找到日语语音，读音可能不准：可以到「我的 → 发音」改用在线发音",3000);
  const my=++readTok;st.reading=true;paint("panel");
  const L=lines();const from=st.active>=0?st.active:(st.cur>=0?st.cur:0);
  for(let i=from;i<L.length;i++){
    if(readTok!==my||!st)return;
    setCur(i,true);
    await speakLine(i);
    if(readTok!==my||!st)return;
    await sleep(350);
  }
  if(readTok===my&&st){st.reading=false;paint("panel")}
}
function studyKey(e){
  if(!st)return false;
  const tg=e.target||{};const typing=/^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName||"");
  if(e.key==="Escape"){
    if(st.pop){closePop();return true}
    if(st.ren){st.ren=false;paint("head");return true}
    if(st.pending){st.pending=null;setMsg("",true);return true}
    /* 在输入框里按 Esc：只让输入框失去焦点，不关掉学习页（粘贴到一半的字幕不会丢） */
    if(typing){try{tg.blur()}catch(err){}return true}
    return false;
  }
  if(typing)return false;
  if(e.key==="Enter"&&tg.classList&&tg.classList.contains("mline")){if(e.preventDefault)e.preventDefault();lineClick(+tg.dataset.i);return true}
  return false;
}
function closePop(){if(!st||!st.pop)return;const p=st.pop;st.pop=null;paint("pop");if(p.type==="tok")paintLine(p.i)}
function lineClick(i){
  if(!st)return;stopReading();
  if(st.pop)closePop();
  if(st.active!==i)setActive(i);
  speakLine(i);
}

/* ============ 字幕导入 ============ */
async function readFileText(f){
  if(f.size>5e6)throw new Error("文件太大了（超过 5MB），字幕文件一般只有几十 KB。");
  const buf=f.arrayBuffer?await f.arrayBuffer():await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(new Error("读取文件失败"));r.readAsArrayBuffer(f)});
  const dec=enc=>{try{return new TextDecoder(enc).decode(buf)}catch(e){return null}};
  const bad=t=>(t.match(/\uFFFD/g)||[]).length;
  let t=dec("utf-8");if(t==null)throw new Error("这个浏览器读不了文件，请改用粘贴。");
  if(bad(t)>2){
    let best=t,score=bad(t);
    for(const enc of ["shift_jis","gb18030","utf-16le","euc-jp"]){const x=dec(enc);if(x!=null&&bad(x)<score){best=x;score=bad(x)}}
    t=best;
  }
  return t;
}
function importParsed(res,src,mode){
  if(!st)return;const it=cur();const S=sub(it.id);
  if(!res.lines.length){setMsg("没识别出字幕内容，请检查格式。",false);return}
  if(!res.lines.some(l=>hasJa(l.ja))){setMsg("这些字幕里好像没有日语。请导入日语字幕（中日双语也可以）。",false);return}
  const append=mode==="append"||(mode!=="replace"&&st.append&&S.lines.length>0);
  if(!append&&mode!=="replace"&&S.lines.some(l=>l.tk||l.ex)){st.pending={res,src};setMsg("",true);return}
  stopJob(it.id);stopReading();
  /* 先换上新字幕试着保存；保存失败就换回原来的，界面和本机存的保持一致 */
  const old=S.lines;
  S.lines=append?S.lines.concat(res.lines).slice(0,3000):res.lines;
  const why=saveSub(it.id,true);
  if(!saved(why)){S.lines=old;setMsg(SUB_MSG[why],false);return}
  it.src=(append&&it.src?it.src+" + ":"")+src;it.src=it.src.slice(0,120);
  updStats(it);saveLib();
  st.pending=null;st.active=-1;st.cur=-1;st.pop=null;st.lim=300;
  const n=res.lines.length,zh=res.lines.filter(l=>l.zh).length;
  st.subMsg=`✓ ${append?"追加":"导入"}了 ${n} 句（${FMT_NAME[res.fmt]||res.fmt}${res.timed?"，带时间轴":"，没有时间轴"}${zh?`，其中 ${zh} 句自带中文翻译`:""}）${res.cut?"。超过 3000 句的部分没有导入":""}`;st.subOk=true;
  paint("head","panel","reader","subs","pop");
  const ta=$("m-paste");if(ta)ta.value="";
  Y.toast(esc(st.subMsg.replace(/^✓ /,"")),4200);
}

/* ============ AI 精读 ============ */
const BATCH=15;
const SYS="你是一名严谨的日语老师，同时是精确的日语形态素分析器（切分粒度类似 MeCab / UniDic）。你会收到若干行日语字幕，请逐行分析，只输出 JSON。";
function batchPrompt(payload){
  return `请逐行处理下面的日语字幕（JSON 数组，n 是行号，ja 是原文）：
${JSON.stringify(payload)}

对每一行：
1. 切分成词（tokens）。按顺序把所有 token 的 s 连起来，必须和原文完全一样（标点、空格、符号都要保留，不要改字，不要漏字）。动词、形容词要把词干、活用词尾和助动词分开，例如「飲みました」→「飲み」「まし」「た」，「食べたくない」→「食べ」「たく」「ない」，「静かでした」→「静か」「でし」「た」。
2. 每个 token 写：
   s：原文里的写法
   r：这个词在本句中的读音（平假名；片假名词也写成平假名；助词「は」「へ」「を」写实际发音「わ」「え」「お」；标点写 ""）
   b：原形（辞书形），例如「飲み」→「飲む」，「まし」→「ます」，「でし」→「です」。和 s 相同时可以省略
   br：原形的读音（平假名）。和 r 相同时可以省略
   pos：词性，只能是这 13 个之一：名词 动词 形容词 形容动词 副词 助词 助动词 连体词 接续词 感叹词 代词 数词 记号
       （形容动词＝「静か」「きれい」这类な形容词的词干；人称、指示代词如「私」「これ」「そこ」用代词；数字和「一つ」「三人」用数词；标点、符号用记号）
   zh：这个词在本句里的中文意思，2～6 个字；助词、助动词写它的作用，如「主题」「宾语」「地点」「过去」「礼貌」「否定」
3. zh：整行的简体中文翻译，自然、口语。
不是日语的行（比如 [音乐]、英文），tokens 给 []，zh 照译或留空。每一行都要返回。

只输出一个 JSON 对象，不要 Markdown，不要解释。格式示例：
{"lines":[{"n":1,"zh":"我喝了咖啡。","tokens":[{"s":"コーヒー","r":"こーひー","pos":"名词","zh":"咖啡"},{"s":"を","r":"お","pos":"助词","zh":"宾语"},{"s":"飲み","r":"のみ","b":"飲む","br":"のむ","pos":"动词","zh":"喝"},{"s":"まし","b":"ます","pos":"助动词","zh":"礼貌"},{"s":"た","pos":"助动词","zh":"过去"},{"s":"。","r":"","pos":"记号","zh":""}]}]}`;
}
function applyBatch(id,idx,res){
  const L=sub(id).lines;
  const arr=Array.isArray(res)?res:res&&typeof res==="object"?(res.lines||res.results||res.data||res.items):null;
  if(!Array.isArray(arr)){const e=new Error("AI 返回的格式不对，请重试。");e.code="invalid_json";throw e}
  let got=0;
  arr.forEach((o,k)=>{
    if(!o||typeof o!=="object")return;
    const n=parseInt(o.n!=null?o.n:o.i!=null?+o.i+1:k+1,10);const li=idx[n-1];if(li==null)return;
    const line=L[li];if(!line)return;
    const raw=Array.isArray(o.tokens)?o.tokens:Array.isArray(o.t)?o.t:Array.isArray(o.words)?o.words:[];
    const toks=alignTokens(line.ja,raw.map(normTok).filter(Boolean));
    const real=toks.filter(t=>t.length>3).length;
    if(hasJa(line.ja)&&!real)return;
    line.tk=toks;
    const zh=str(o.zh||o.translation).trim();
    if(zh&&(!line.zh||line.zhai)){line.zh=zh.slice(0,400);line.zhai=1}
    got++;
  });
  if(!got){const e=new Error("AI 没有返回可用的结果，请重试。");e.code="invalid_json";throw e}
  return got;
}
async function runBatch(id,idx,job,depth){
  if(!job.run)return;
  const L=sub(id).lines;
  const payload=idx.map((li,k)=>({n:k+1,ja:L[li].ja}));
  let res;
  for(let attempt=0;;attempt++){
    const ctl=new AbortController();job.ctls.add(ctl);
    try{res=await Y.ai.chat([{role:"system",content:SYS},{role:"user",content:batchPrompt(payload)}],{json:true,signal:ctl.signal,maxTokens:8000,temperature:.1});break}
    catch(e){
      if(!job.run||(e&&e.code==="cancelled"))return;
      if(e&&(e.code==="truncated"||e.code==="invalid_json")&&idx.length>3&&depth<2){
        const h=Math.ceil(idx.length/2);await runBatch(id,idx.slice(0,h),job,depth+1);await runBatch(id,idx.slice(h),job,depth+1);return;
      }
      if(e&&e.retry&&attempt<1){await sleep(2000);if(!job.run)return;continue}
      throw e;
    }finally{job.ctls.delete(ctl)}
  }
  if(!job.run)return;
  const L0=sub(id).lines;const snap=idx.map(i=>{const l=L0[i];return l?{tk:l.tk,zh:l.zh,zhai:l.zhai}:null});
  try{applyBatch(id,idx,res)}
  catch(e){if(idx.length>3&&depth<2){const h=Math.ceil(idx.length/2);await runBatch(id,idx.slice(0,h),job,depth+1);await runBatch(id,idx.slice(h),job,depth+1);return}throw e}
  const why=saveSub(id,true);
  if(!saved(why)){
    /* 存不下：这一批的结果撤回（已完成的批次已经保存），任务停下并说明原因 */
    idx.forEach((i,k)=>{const l=L0[i],o=snap[k];if(!l||!o)return;for(const f of ["tk","zh","zhai"]){if(o[f]===undefined)delete l[f];else l[f]=o[f]}});
    const e=new Error(SUB_MSG[why]+"（已经精读的部分都保存好了）");e.code="storage";throw e;
  }
  const it=itemById(id);if(it){updStats(it);saveLib()}
  progress(id,idx);
}
function progress(id,idx){
  if(st&&st.id===id&&Y.overlayOpen()){paint("panel");if(idx)for(const i of idx)if(i<st.lim)paintLine(i);markCur()}
  else if(Y.ui.tab==="media"&&!Y.overlayOpen())Y.render();
}
async function startJob(id){
  if(JOBS[id]&&JOBS[id].run)return;
  if(!aiOK()){Y.toast("还没有设置 AI");return}
  const L=sub(id).lines;const todo=[];L.forEach((l,i)=>{if(!l.tk&&hasJa(l.ja))todo.push(i)});
  if(!todo.length){Y.toast("这些字幕都已经精读过了");return}
  const job=JOBS[id]={run:true,ctls:new Set(),err:"",by:aiName()};
  progress(id);
  const st0=Y.ai.status?Y.ai.status():{};
  const conc=st0.claude?1:2;   /* Claude 一次一批；外部接口两批并行 */
  const queue=[];for(let k=0;k<todo.length;k+=BATCH)queue.push(todo.slice(k,k+BATCH));
  let qi=0;
  const worker=async()=>{while(job.run&&qi<queue.length){const b=queue[qi++];try{await runBatch(id,b,job,0)}catch(e){if(job.run){job.err=(e&&e.message)||"AI 出错了，请稍后重试。";job.run=false;for(const c of job.ctls)try{c.abort()}catch(x){}}}}};
  await Promise.all(Array.from({length:Math.min(conc,queue.length)},worker));
  const wasStopped=job.stopped;job.run=false;
  const it=itemById(id);if(it){updStats(it);saveLib()}
  const left=sub(id).lines.filter(l=>!lineDone(l)).length;
  if(!job.err&&!wasStopped)Y.toast(left?`AI 精读结束，还有 ${left} 句没成功，可以点「继续」再试`:"AI 精读完成");
  else if(job.err&&!(st&&st.id===id))Y.toast("AI 精读中断："+esc(job.err));
  progress(id);
  releaseSub(id);
}
function stopJob(id){const j=JOBS[id];if(!j||!j.run)return;j.run=false;j.stopped=true;for(const c of j.ctls)try{c.abort()}catch(e){}}
async function explainLine(i){
  if(!st||st.exBusy>=0)return;const id=st.id;const l=lines()[i];if(!l)return;
  st.exBusy=i;st.exErr="";paintLine(i);
  const prompt=`你是耐心的日语老师。请用简体中文给中国的日语初学者讲解下面这句日语（来自视频字幕）：
「${l.ja}」
${l.zh?`参考翻译：${l.zh}\n`:""}要求：
1. 先给出自然的中文翻译；
2. 列出 2～5 个重点词，格式「日文（读音）— 中文意思」；
3. 讲 1～3 个语法点或活用变化，说明在句中的作用；
4. 总共不超过 250 字。纯文本，每条单独一行，不要用 #、*、** 等 Markdown 符号。`;
  try{
    const txt=await Y.ai.chat(prompt,{tier:"quick",maxTokens:800,temperature:.3});
    const clean=str(txt).replace(/\*\*|__|^#+\s*/gm,"").replace(/\n{3,}/g,"\n\n").trim().slice(0,1500);
    const L=sub(id).lines;const t=L[i]===l?l:(L[i]&&L[i].ja===l.ja?L[i]:null);
    if(t){const old=t.ex;t.ex=clean;const why=saveSub(id,true);if(!saved(why)){if(old===undefined)delete t.ex;else t.ex=old;throw new Error(SUB_MSG[why])}}
  }catch(e){if(st&&st.id===id){st.exErr=(e&&e.message)||"AI 讲解失败";st.exErrI=i}}
  if(st&&st.id===id){st.exBusy=-1;paintLine(i)}else releaseSub(id);
}

/* ============ 动作 ============ */
const A=Y.registerAction;
A("media-draft",(d,el)=>{ui.draft=el.value;if(ui.msg){ui.msg=""}});
A("media-add",()=>{
  const inp=$("media-url");const raw=inp?inp.value:ui.draft;ui.draft=raw;
  const r=parseLink(raw);
  if(r.err){ui.msg=r.err;ui.ok=false;Y.render();return}
  const L=lib();
  const dup=L.items.find(x=>r.vid?(x.plat===r.plat&&x.vid===r.vid&&(x.p||1)===(r.p||1)):x.url===r.url);
  ui.draft="";ui.msg="";
  if(dup){Y.render();Y.toast("已经在视听库里了");openStudy(dup.id);return}
  if(L.items.length>=100){ui.msg="视听库最多 100 条，先删掉一些不用的吧。";ui.ok=false;Y.render();return}
  const it={id:newId(),plat:r.plat,vid:r.vid||"",p:r.p||1,url:r.url,t:str(r.t||(PLAT[r.plat].n+(r.vid?" "+r.vid:" 链接"))).slice(0,80),added:Date.now(),last:Date.now(),start:r.start||0,n:0,ai:0,tk:0,src:""};
  L.items.unshift(it);saveLib();Y.render();
  if(r.note)Y.toast(esc(r.note),4000);else Y.toast("已加入视听库，接下来导入字幕");
  openStudy(it.id);
});
A("media-open",d=>openStudy(d.id));
A("media-demo",()=>{
  const L=lib();let it=L.items.find(x=>x.plat==="demo");
  if(!it){it={id:"demo",plat:"demo",vid:"",p:1,url:"",t:"示例：ゆめラジオ 第 1 回（原创短播客）",added:Date.now(),last:Date.now(),n:0,ai:0,tk:0,src:"内置示例"};
    SUBS.demo={lines:demoLines()};saveSub("demo");updStats(it);L.items.unshift(it);saveLib()}
  Y.render();openStudy(it.id);
});
A("media-del",d=>{ui.delArm=d.id;Y.render()});
A("media-delno",()=>{ui.delArm=null;Y.render()});
A("media-delyes",d=>{
  const L=lib();const it=itemById(d.id);if(!it)return;
  stopJob(it.id);DELETED.add(it.id);L.items=L.items.filter(x=>x!==it);Y.store.del("media-sub-"+it.id);if(SUBLEN)delete SUBLEN["media-sub-"+it.id];delete SUBS[it.id];delete JOBS[it.id];
  ui.delArm=null;saveLib();Y.render();Y.toast("已删除「"+esc(it.t.slice(0,20))+"」");
});
A("media-ren",d=>{
  if(d.w==="ov"){if(!st)return;st.ren=true;paint("head")}else{ui.ren=d.id;Y.render()}
  setTimeout(()=>{const el=$("media-ren-"+(d.w==="ov"?"ov":"list"));if(el){el.focus();try{el.select()}catch(e){}}},20);
});
A("media-rencancel",d=>{if(d.w==="ov"){if(st){st.ren=false;paint("head")}}else{ui.ren=null;Y.render()}});
A("media-rensave",(d,form)=>{
  const it=itemById(d.id);const inp=form.querySelector("input");
  const t=str(inp&&inp.value).replace(/\s+/g," ").trim().slice(0,80);
  if(it&&t){it.t=t;saveLib()}
  if(d.w==="ov"){if(st){st.ren=false;paint("head")}}else{ui.ren=null;Y.render()}
});
A("media-close",()=>Y.closeOverlay());
A("media-aiset",()=>{if(Y.overlayOpen())Y.closeOverlay({silent:true});if(Y.ai&&Y.ai.openSettings)Y.ai.openSettings();else Y.go("me")});
A("media-vt",d=>{if(!(d.k in V))return;V[d.k]=!V[d.k];saveV();paint("panel","reader")});
A("media-more",()=>{if(!st)return;growReader(st.lim+300)});
A("media-line",d=>lineClick(+d.i));
A("media-seek",d=>seekTo(+d.i));
A("media-say",d=>{stopReading();speakLine(+d.i,d.r==="slow"?.6:.9)});
A("media-readall",()=>readAll());
A("media-copy",d=>{const l=lines()[+d.i];if(!l)return;const txt=l.ja+(l.zh?"\n"+l.zh:"");try{navigator.clipboard.writeText(txt).then(()=>Y.toast("已复制"),()=>Y.toast("复制失败，请长按文字手动复制"))}catch(e){Y.toast("复制失败，请长按文字手动复制")}});
A("media-explain",d=>explainLine(+d.i));
A("media-tok",d=>{
  if(!st)return;const i=+d.i,j=+d.j;const l=lines()[i];const t=l&&l.tk&&l.tk[j];if(!t)return;
  stopReading();
  const old=st.pop;st.pop={type:"tok",i,j};paint("pop");
  if(old&&old.type==="tok"&&old.i!==i)paintLine(old.i);
  if(st.active!==i){const oa=st.active;st.active=i;if(oa>=0&&!(old&&old.i===oa))paintLine(oa)}
  paintLine(i);
  Y.speak(tk(t,1)||tk(t,0),{rate:.85});
});
A("media-dict",d=>{if(!st)return;stopReading();const w=Y.word(d.k);if(!w)return;st.pop={type:"dict",k:d.k};paint("pop");Y.speak(w.kana||Y.plain(w.ja),{rate:.85})});
A("media-popx",()=>closePop());
A("media-addw",()=>{
  if(!st||!st.pop||st.pop.type!=="tok")return;const l=lines()[st.pop.i];const t=l&&l.tk&&l.tk[st.pop.j];if(!t)return;
  const s=tk(t,0),b=tkBase(t);const ja=b||s;
  const r=mwAdd({ja,kana:baseReading(s,tk(t,1),b,tk(t,5)),zh:tk(t,4),pos:TO_COURSE[tk(t,3)]||""});
  if(r.r==="ok")Y.toast(`「${esc(ja)}」已加入单词本${r.xp?` +${r.xp} XP`:""}`);else if(r.r==="dup")Y.toast("已经在单词本里了");else if(r.r==="full")Y.toast(`视听生词最多 ${MW_MAX} 个，先删掉一些吧`);
  paint("pop");
});
A("media-review",d=>{const w=Y.word(d.k);if(!w)return;const S=Y.S;if(!S.words[w.key]){S.words[w.key]={lv:0,due:Date.now(),r:0,x:0};Y.save();Y.toast("已加入复习，今天的复习里就会出现")}paint("pop")});
A("media-golesson",d=>{const w=Y.word(d.k);if(!w||!Y.openLesson)return;Y.closeOverlay({silent:true});Y.openLesson(w.lid,"words")});
A("media-aigo",()=>{if(st){const id=st.id;startJob(id)}});
A("media-aistop",()=>{if(st)stopJob(st.id);paint("panel")});
A("media-aire",()=>{
  if(!st)return;
  if(!st.reArm){st.reArm=true;paint("panel");later(()=>{if(st){st.reArm=false;paint("panel")}},5000);return}
  st.reArm=false;const id=st.id;for(const l of sub(id).lines){delete l.tk;if(l.zhai){delete l.zh;delete l.zhai}}
  saveSub(id,true);const it=cur();updStats(it);saveLib();paint("panel","reader");startJob(id);
});
A("media-paste",()=>{if(!st)return;const ta=$("m-paste");const txt=ta?ta.value:"";if(!txt.trim()){setMsg("先把字幕粘贴到框里。",false);return}importParsed(parseSubs(txt,""),"粘贴的字幕")});
A("media-file",async(d,el)=>{
  const f=el.files&&el.files[0];el.value="";if(!f||!st)return;
  try{const txt=await readFileText(f);importParsed(parseSubs(txt,f.name),f.name.slice(0,60))}
  catch(e){setMsg((e&&e.message)||"读取文件失败",false)}
});
A("media-append",(d,el)=>{if(st)st.append=!!el.checked});
A("media-pendyes",()=>{if(st&&st.pending){const p=st.pending;st.pending=null;importParsed(p.res,p.src,"replace")}});
A("media-pendapp",()=>{if(st&&st.pending){const p=st.pending;st.pending=null;importParsed(p.res,p.src,"append")}});
A("media-pendno",()=>{if(st){st.pending=null;setMsg("已取消导入",true)}});
A("media-local",(d,el)=>{
  const f=el.files&&el.files[0];el.value="";if(!f||!st)return;
  if(st.local)try{URL.revokeObjectURL(st.local.url)}catch(e){}
  const kind=/^video\//.test(f.type)||/\.(mp4|webm|m4v|mov)$/i.test(f.name)?"video":"audio";
  st.local={url:URL.createObjectURL(f),kind,name:f.name.slice(0,60)};st.warn="";
  paint("player","help","panel");
});
A("media-unlocal",()=>{if(!st||!st.local)return;try{URL.revokeObjectURL(st.local.url)}catch(e){}st.local=null;st.warn="";paint("player","help","panel")});
A("media-wdel",d=>{mwDel(d.ja);Y.render();Y.toast("已从视听生词删除")});
A("media-wall",()=>{ui.wAll=!ui.wAll;Y.render()});
A("media-wrev",()=>{const ws=mwWords();if(!ws.length)return;const due=ws.filter(w=>{const s=Y.wordState(w);return !s||s.due<=Date.now()});Y.startWords(Y.shuffle(due.length?due:ws).slice(0,20),"视听生词")});
A("media-wbook",()=>{if(Y.course&&Y.course.showWordbook){Y.course.showWordbook();if(Y.course.state)Y.course.state.wbook="custom"}Y.go("course")});

/* ============ 存档：视听库和字幕跟着「保存存档文件 / 复制存档文字」一起走 ============
 * 存档文件里是完整数据（含 AI 精读）；复制的存档文字（lite）去掉逐词精读和 AI 讲解，只留字幕原文和翻译，避免太长。
 * 恢复时只「补上」本机没有的条目，不覆盖本机已有的。 */
const ID_RE=/^[A-Za-z0-9_-]{1,40}$/;
const num=x=>{x=+x;return isFinite(x)?x:null};
function cleanTk(tk){
  if(!Array.isArray(tk))return null;const out=[];
  for(const t of tk){if(!Array.isArray(t)||!t.length)return null;if(t.length===1){out.push([str(t[0]).slice(0,400)]);continue}const n=normTok(t);if(!n)return null;out.push(n)}
  return out;
}
function cleanLine(l,lite){
  const o={s:num(l.s),e:num(l.e),ja:str(l.ja).slice(0,400)};
  if(l.zh)o.zh=str(l.zh).slice(0,400);if(l.zhai&&o.zh)o.zhai=1;
  if(!lite){const tk=cleanTk(l.tk);if(tk&&tk.length)o.tk=tk;if(l.ex)o.ex=str(l.ex).slice(0,1500)}
  return o;
}
Y.registerBackup("media",{
  get(o){
    const items=lib().items.filter(x=>x.plat!=="demo");if(!items.length)return null;
    const subs={};
    if(!o.noSubs)for(const it of items){const L=(SUBS[it.id]||readSub(it.id)).lines;if(L.length)subs[it.id]={lines:L.map(l=>cleanLine(l,!!o.lite))}}
    return{v:1,items:items.map(x=>Object.assign({},x)),subs};
  },
  put(x){
    if(!x||typeof x!=="object"||!Array.isArray(x.items))return "";
    const L=lib();let add=0,fail=0;
    for(const r of x.items){
      if(!r||typeof r!=="object"||!ID_RE.test(str(r.id))||!PLAT[r.plat]||r.plat==="demo")continue;
      if(VID_OK[r.plat]&&!VID_OK[r.plat].test(str(r.vid)))continue;
      if(L.items.some(y=>y.id===r.id))continue;
      if(L.items.length>=100)break;
      const it={id:r.id,plat:r.plat,vid:str(r.vid).slice(0,20),p:Math.max(1,Math.min(999,Math.round(+r.p)||1)),url:Y.safeUrl(r.url)||"",
        t:str(r.t).replace(/\s+/g," ").trim().slice(0,80)||PLAT[r.plat].n,added:num(r.added)||Date.now(),last:num(r.last)||Date.now(),
        start:Math.max(0,num(r.start)||0),n:0,ai:0,tk:0,src:str(r.src).slice(0,120)};
      const sb=x.subs&&typeof x.subs==="object"?x.subs[r.id]:null;
      if(sb&&Array.isArray(sb.lines)){
        SUBS[it.id]={lines:sb.lines.filter(l=>l&&typeof l.ja==="string").slice(0,3000).map(l=>cleanLine(l,false))};
        if(!saved(saveSub(it.id,true))){delete SUBS[it.id];fail++}
      }
      updStats(it);L.items.push(it);add++;
    }
    if(add){saveLib();if(Y.booted&&Y.ui.tab==="media")Y.render()}
    return add?`视听库 ${add} 条${fail?`（其中 ${fail} 条的字幕因为本机空间不够没能恢复）`:""}`:"";
  }
});

/* ============ 注册 ============ */
Y.registerTab({id:"media",label:"视听",icon:"tv",order:40,render:vMedia,onShow:()=>{ui.delArm=null;ui.ren=null}});
Y.media={parseLink,parseSubs,openStudy,lib,sub,saveSub,mwAdd,mwDel,startJob,stopJob,alignTokens,normTok,rubyTok,baseReading,posCode,MPOS};
})();
