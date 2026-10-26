/* 防丢数据测试：node tools/datasafe.test.js
 * 用两个 vm 上下文共享同一个 localStorage，模拟同一台手机上开着两个页面（旧标签页 + 新打开的页面）。 */
"use strict";
const vm=require("vm"),fs=require("fs"),path=require("path"),assert=require("assert");
const APP=path.resolve(__dirname,"..");
let pass=0;const ok=(c,m)=>{assert.ok(c,m);pass++};
const page=fs.readFileSync(path.join(APP,"page.html"),"utf8");
const srcs=[...page.matchAll(/<script src="([^"]+)"/g)].map(m=>m[1]);
const CODE=srcs.map(s=>[s,fs.readFileSync(path.join(APP,s),"utf8")]);

function tab(mem){
  const els={};const el=sel=>els[sel]=els[sel]||{sel,innerHTML:"",hidden:true,scrollTop:0,style:{setProperty(){}},focus(){},scrollIntoView(){}};
  for(const s of ["#view","#tabs","#sess","#toastbox","#cele"])el(s);
  const wh={},dh={};
  const document={querySelector:el,getElementById:()=>null,addEventListener:(t,f)=>{dh[t]=f},visibilityState:"visible",
    documentElement:{setAttribute(){},removeAttribute(){}},body:{style:{}},activeElement:null};
  const ctx={console:{log(){},info(){},warn(){},error:console.error},setTimeout,clearTimeout,setInterval:()=>0,clearInterval(){},Date,Math,JSON,Promise,document,
    localStorage:{getItem:k=>k in mem?mem[k]:null,setItem:(k,v)=>{mem[k]=String(v)},removeItem:k=>{delete mem[k]},get length(){return Object.keys(mem).length},key:i=>Object.keys(mem)[i]},
    scrollTo(){},URL,navigator:{},addEventListener:(t,f)=>{wh[t]=f}};
  ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);
  for(const [s,c] of CODE)vm.runInContext(c,ctx,{filename:s});
  ctx.Yume.boot();
  return{Y:ctx.Yume,wh,dh,document};
}
/* 和 tab() 一样，但 shouldFail() 为真时 getItem 抛错（模拟偶发的读取失败） */
function tabFlaky(mem,shouldFail){/* shouldFail(key) */
  const els={};const el=sel=>els[sel]=els[sel]||{sel,innerHTML:"",hidden:true,scrollTop:0,style:{setProperty(){}},focus(){},scrollIntoView(){}};
  for(const s of ["#view","#tabs","#sess","#toastbox","#cele"])el(s);
  const wh={},dh={};
  const document={querySelector:el,getElementById:()=>null,addEventListener:(t,f)=>{dh[t]=f},visibilityState:"visible",
    documentElement:{setAttribute(){},removeAttribute(){}},body:{style:{}},activeElement:null};
  const ctx={console:{log(){},info(){},warn(){},error:console.error},setTimeout,clearTimeout,setInterval:()=>0,clearInterval(){},Date,Math,JSON,Promise,document,
    localStorage:{getItem:k=>{if(shouldFail(k))throw new Error("read failed");return k in mem?mem[k]:null},setItem:(k,v)=>{mem[k]=String(v)},removeItem:k=>{delete mem[k]},get length(){return Object.keys(mem).length},key:i=>Object.keys(mem)[i]},
    scrollTo(){},URL,navigator:{},addEventListener:(t,f)=>{wh[t]=f}};
  ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);
  for(const [s,c] of CODE)vm.runInContext(c,ctx,{filename:s});
  ctx.Yume.boot();
  return{Y:ctx.Yume,wh,dh,document};
}
const KEY="hibi-n5-v1";
const OLD={v:1,xp:100,days:{"2026-10-20":100},words:{"1:私":{lv:2,due:0,r:2,x:0}},grammar:{"1-0":"2026-10-20"},quiz:{"1":3},videos:{},custom:[],
  settings:{newPerDay:10,goal:50,autoSpeak:true},badges:{first:"2026-10-20"},titles:{},kana:{lv:{h0:3},m:{}},maxCombo:4,nd:{d:"",n:0},lastBackup:"",updated:1000};

/* 1. 旧页面不会覆盖新页面的进度（没有 storage 事件，靠保存前的版本检查） */
{
  const mem={[KEY]:JSON.stringify(OLD)};
  const A=tab(mem),B=tab(mem);
  A.Y.markWord("1:学生",true);A.Y.addXP(10);A.Y.save();
  B.Y.markWord("1:先生",true);B.Y.addXP(5);B.Y.save();         /* B 是旧页面：它不知道 A 学了「学生」 */
  const st=JSON.parse(mem[KEY]);
  ok(st.words["1:学生"]&&st.words["1:先生"]&&st.words["1:私"],"两边学的单词都在");
  ok(st.xp>=110,"XP 不倒退（取较大的一边）");
  ok(st.grammar["1-0"]&&st.quiz["1"]===3&&st.kana.lv.h0===3,"旧进度都在");
}
/* 2. storage 事件：别的页面一保存，这边立刻合并进来 */
{
  const mem={[KEY]:JSON.stringify(OLD)};
  const A=tab(mem),B=tab(mem);
  A.Y.markWord("1:学生",true);A.Y.S.grammar["1-1"]="2026-10-26";A.Y.save();
  ok(typeof B.wh.storage==="function","注册了 storage 事件");
  B.wh.storage({key:KEY,newValue:mem[KEY]});
  ok(B.Y.S.words["1:学生"]&&B.Y.S.grammar["1-1"],"B 收到 A 的进度");
  B.Y.markWord("1:先生",true);B.Y.save();
  const st=JSON.parse(mem[KEY]);ok(st.words["1:学生"]&&st.words["1:先生"]&&st.grammar["1-1"],"合并后再保存，两边都在");
}
/* 3. 切回页面时检查（App 内置浏览器常常没有 storage 事件） */
{
  const mem={[KEY]:JSON.stringify(OLD)};
  const A=tab(mem),B=tab(mem);
  A.Y.markWord("2:これ",true);A.Y.save();
  B.document.visibilityState="visible";B.dh.visibilitychange();
  ok(B.Y.S.words["2:これ"],"切回页面时合并进来");
}
/* 4. 同一个词两边都练过：取作答次数多的那份 */
{
  const Y=tab({}).Y;
  const a=Y.merge(JSON.parse(JSON.stringify(OLD))),b=Y.merge(JSON.parse(JSON.stringify(OLD)));
  a.words["1:私"]={lv:4,due:5,r:6,x:1};b.words["1:私"]={lv:1,due:9,r:1,x:0};b.updated=2000;
  const m=Y.mergeProgress(a,b);
  ok(m.words["1:私"].r===6&&m.words["1:私"].lv===4,"单词取练得多的一份（即使另一份更新）");
  ok(m.updated===2000,"updated 取较新的");
  a.quiz={"1":2,"2":5};b.quiz={"1":4};ok(Y.mergeProgress(a,b).quiz["1"]===4&&Y.mergeProgress(a,b).quiz["2"]===5,"练习成绩取较高的");
  a.custom=[{id:"easy-words",title:"会话生词",words:["猫|ねこ|猫|名"],grammar:[],quiz:[],sys:true}];
  b.custom=[{id:"easy-words",title:"会话生词",words:["犬|いぬ|狗|名"],grammar:[],quiz:[],sys:true}];
  const c=Y.mergeProgress(a,b).custom.find(x=>x.id==="easy-words");ok(c&&c.words.length===2,"生词本单词取并集");
}
/* 5. 清空进度之后，旧页面不会把旧进度带回来 */
{
  const mem={[KEY]:JSON.stringify(OLD)};
  const A=tab(mem),B=tab(mem);
  A.Y.resetProgress();
  ok(JSON.parse(mem[KEY]).xp===0,"A 清空了");
  B.Y.markWord("1:先生",true);B.Y.save();                       /* B 是清空之前打开的旧页面 */
  const st=JSON.parse(mem[KEY]);
  ok(!st.words["1:私"]&&st.xp===0,"旧页面保存后，清空的进度没有被带回来");
}
/* 6. 存档损坏：不拿空白覆盖，原文另存 */
{
  const bad='{"v":1,"xp":321,"words":{"1:私":{"lv":2';
  const mem={[KEY]:bad};
  const A=tab(mem);
  ok(A.Y.loadInfo().ok===false&&A.Y.loadInfo().why==="parse","识别出存档损坏");
  ok(mem[KEY+":broken"]===bad,"损坏的原文另存了一份");
  A.Y.markWord("1:学生",true);A.Y.save();
  ok(mem[KEY+":broken"]===bad,"之后保存也不会动那份原文");
}
/* 7. 旧格式（没有 epoch、没有 :rev）的老用户：读入、保存都正常 */
{
  const mem={[KEY]:JSON.stringify(OLD)};
  const A=tab(mem);
  ok(A.Y.S.xp===100&&A.Y.S.epoch==="","老存档读入");
  A.Y.save();ok(JSON.parse(mem[KEY]).xp===100&&mem[KEY+":rev"],"保存后写了版本号");
}
/* 8. 两个页面各自拿了 XP：合并后相加，而不是取较大的 */
{
  const mem={[KEY]:JSON.stringify(OLD)};
  const A=tab(mem),B=tab(mem);
  A.Y.addXP(10);A.Y.save();
  B.Y.addXP(5);B.Y.save();
  ok(JSON.parse(mem[KEY]).xp===115,"XP 准确相加：100 + 10 + 5");
}
/* 9. 本页面撤销的「我学会了」，合并后不会又冒出来 */
{
  const mem={[KEY]:JSON.stringify(OLD)};
  const A=tab(mem),B=tab(mem);
  B.Y.markWord("1:先生",true);B.Y.save();
  delete A.Y.S.grammar["1-0"];A.Y.save();
  ok(!JSON.parse(mem[KEY]).grammar["1-0"]&&JSON.parse(mem[KEY]).words["1:先生"],"撤销保留，别的页面的进度也在");
}
/* 10. 复制用的精简存档：压缩格式能完整恢复；被截断能认出来 */
{
  const mem={[KEY]:JSON.stringify(OLD)};
  const A=tab(mem);
  for(const k of Object.keys(A.Y.wordsByKey).slice(0,300))A.Y.markWord(k,true);A.Y.save();
  const full=A.Y.backupText(),lite=A.Y.backupText({lite:true});
  ok(lite.length<full.length*0.8,"精简存档更短（"+lite.length+" / "+full.length+" 字）");
  const info=A.Y.backupInfo(lite);ok(info.words===Object.keys(A.Y.S.words).length,"精简存档能读出全部单词");
  let msg="";try{A.Y.backupInfo(lite.slice(0,Math.floor(lite.length*0.7)))}catch(e){msg=e.message}
  ok(/截断|不完整/.test(msg),"截断的存档给出明确提示："+msg);
  const fresh=tab({}).Y;const r=fresh.restore(lite);
  ok(r.ok&&Object.keys(fresh.S.words).length===info.words&&fresh.S.words["1:私"].r===A.Y.S.words["1:私"].r,"用精简存档恢复，单词进度一致");
}
/* 11. 合并存档：两边学过的都保留 */
{
  const B=tab({[KEY]:JSON.stringify(OLD)});B.Y.markWord("1:先生",true);B.Y.save();
  const other=B.Y.backupText({lite:true});
  const A=tab({[KEY]:JSON.stringify(OLD)});A.Y.markWord("1:学生",true);A.Y.save();
  const r=A.Y.restore(other,{mode:"merge"});
  ok(r.ok&&A.Y.S.words["1:先生"]&&A.Y.S.words["1:学生"]&&A.Y.S.words["1:私"],"合并后两边的单词都在");
}
/* 12. 清空进度可以撤销 */
{
  const mem={[KEY]:JSON.stringify(OLD)};
  const A=tab(mem);A.Y.resetProgress();ok(A.Y.S.xp===0,"清空了");
  const r=A.Y.undoLast();ok(r.ok&&A.Y.S.xp===100&&A.Y.S.words["1:私"],"撤销后进度回来了");
}
/* 13. 导入的课程并入已有课时，重复单词不会出现两次（多次 rebuild 也一样） */
{
  const A=tab({[KEY]:JSON.stringify(OLD)});const Y=A.Y;
  const l=Y.allLessons().find(x=>!x.custom&&x.words.some(w=>w.rep));
  const rw=l.words.find(w=>w.rep);
  const n0=l.words.length;
  Y.S.custom.push({id:l.id,title:"",sub:"",words:[rw.ja+"|"+rw.kana+"|"+rw.zh+"|"+(rw.pos||"")],grammar:[],quiz:[]});
  Y.rebuild();Y.rebuild();Y.rebuild();
  const l2=Y.lesson(l.id);
  ok(l2.words.length===n0&&l2.words.filter(w=>w.ja===rw.ja).length===1,"复习词「"+rw.ja+"」在第 "+l.id+" 课只出现一次（"+l2.words.length+"/"+n0+"）");
  ok(Y.allLessons().find(x=>x.id===l.id).words.find(w=>w.ja===rw.ja).rep===rw.rep,"复习词仍然指向第一次出现的那课");
}
/* 14. 「合并」恢复之后纪元不倒退：另一个页面再保存，合并结果不会被丢掉 */
{
  const mem={[KEY]:JSON.stringify(OLD)};
  const A=tab(mem),B=tab(mem);
  A.Y.resetProgress();A.Y.markWord("1:先生",true);A.Y.save();          /* A 有了新纪元 */
  B.document.visibilityState="visible";B.dh.visibilitychange();          /* B 跟上 A */
  ok(B.Y.S.epoch===A.Y.S.epoch&&B.Y.S.epoch!=="","B 跟上了 A 的新纪元");
  const wechat=tab({[KEY]:JSON.stringify(Object.assign({},OLD,{updated:Date.now()+60000}))});  /* 一份「更新」但纪元为空的存档（比如微信里的） */
  wechat.Y.markWord("1:学生",true);wechat.Y.save();
  const r=B.Y.restore(wechat.Y.backupText({lite:true}),{mode:"merge"});
  ok(r.ok&&B.Y.S.epoch===A.Y.S.epoch,"合并后纪元没有倒退");
  ok(A.Y.wordsByKey["2:これ"],"测试用的词存在");
  A.Y.markWord("2:これ",true);A.Y.save();                                 /* 另一个页面接着保存 */
  const st=JSON.parse(mem[KEY]);
  ok(st.words["1:学生"]&&st.words["1:先生"]&&st.words["2:これ"],"合并来的单词、两个页面的单词都在");
}
/* 15. 模块记录（会话课、自测、计划打卡、跟读）两个页面各自的都保留 */
{
  const base=Object.assign({},OLD,{easy:{done:{e1:2},pr:{e1:1},last:"2026-10-20"},tests:[{date:"2026-10-20",level:"N5",start:"N5",scores:{}}],
    plan:{v:1,target:"N4",created:"2026-10-01",npd:10,gpd:2,lpw:2,hit:{"2026-10-20":1}},speech:{d:"2026-10-26",h:["a"],n:3,g:2}});
  const mem={[KEY]:JSON.stringify(base)};
  const A=tab(mem),B=tab(mem);
  A.Y.S.easy.done.e3=3;A.Y.S.easy.pr.e1|=2;A.Y.S.tests.push({date:"2026-10-25",level:"N4",start:"N5",scores:{}});A.Y.S.plan.hit["2026-10-25"]=1;A.Y.S.speech.h.push("b");A.Y.S.speech.g=4;A.Y.save();
  B.Y.S.easy.done.e2=1;B.Y.S.easy.pr.e1|=4;B.Y.S.plan.hit["2026-10-26"]=1;B.Y.S.speech.h.push("c");B.Y.save();   /* B 是旧页面 */
  const st=JSON.parse(mem[KEY]);
  ok(st.easy.done.e3===3&&st.easy.done.e2===1&&st.easy.done.e1===2,"会话课：两边完成的集都在");
  ok(st.easy.pr.e1===7,"会话课：练习步骤取并集（1|2|4）");
  ok(st.tests.length===2,"自测记录两条都在");
  ok(st.plan.hit["2026-10-25"]&&st.plan.hit["2026-10-26"]&&st.plan.hit["2026-10-20"],"计划打卡日期取并集");
  ok(st.speech.h.includes("b")&&st.speech.h.includes("c")&&st.speech.g===4,"跟读：同一天的记录合并、过关次数取大");
}
/* 16. 主动合并两份存档：XP = 较大的一份 + 合并后多出来的每天 XP */
{
  const Y=tab({}).Y;
  const a=Y.merge({xp:1534,days:{"2026-10-01":1000,"2026-10-02":534},words:{}}),b=Y.merge({xp:1734,days:{"2026-10-01":1000,"2026-10-03":734},words:{},updated:5});
  ok(Y.mergeProgress(a,b,true).xp===1534+734,"合并 XP："+Y.mergeProgress(a,b,true).xp);
}
/* 17. 还开着的旧版页面（不写版本号）写过存档：新版页面保存前能发现并合并 */
{
  const mem={[KEY]:JSON.stringify(OLD)};
  const A=tab(mem);
  const old=JSON.parse(mem[KEY]);old.words["9:旧版"]={lv:1,due:0,r:1,x:0};old.xp+=7;old.updated=Date.now()+1000;mem[KEY]=JSON.stringify(old);   /* 旧版页面直接写主存档 */
  A.Y.markWord("1:学生",true);A.Y.save();
  const st=JSON.parse(mem[KEY]);ok(st.words["9:旧版"]&&st.words["1:学生"],"旧版页面写的单词保留下来了");
}
/* 18. 撤销凭证：旧的撤销副本不能被误用 */
{
  const mem={[KEY]:JSON.stringify(OLD)};
  const A=tab(mem);const t1=A.Y.resetProgress();
  ok(typeof t1==="string"&&t1.length>4,"清空返回撤销凭证");
  A.Y.markWord("1:学生",true);A.Y.save();
  const r=A.Y.undoLast("wrong");ok(!r.ok&&A.Y.S.words["1:学生"],"凭证不对时拒绝撤销，当前进度不动");
  ok(A.Y.undoLast(t1).ok&&A.Y.S.xp===100,"凭证对时可以撤销");
}
/* 19. 读档两次都失败 → 从备份恢复（合并）时恰好另一个页面也写过：XP 不会被算两遍 */
{
  const mem={[KEY]:JSON.stringify(OLD)};
  const B=tab(mem);
  let fails=2;/* 打开时读一次、启动后重试一次，都失败；之后恢复正常 */
  const A=tabFlaky(mem,k=>k===KEY&&fails-->0);
  ok(A.Y.loadInfo().why==="read"&&A.Y.S.xp===0,"A 读档失败，暂时是空白");
  B.Y.addXP(5);B.Y.save();                                   /* 另一个页面写了：xp 105 */
  A.Y.restore(JSON.stringify(OLD),{mode:"merge",noSnap:true,noUndo:true});  /* 自动备份里的进度：xp 100 */
  let st=JSON.parse(mem[KEY]);
  ok(st.xp===105,"XP 没有被算两遍（"+st.xp+"）");
  /* 之后两边各自再学：恢复正常的「相加」 */
  A.Y.addXP(3);A.Y.save();B.Y.addXP(2);B.Y.save();
  st=JSON.parse(mem[KEY]);
  ok(st.xp===110,"之后两边新拿的 XP 都算上（"+st.xp+"）");
}
/* 20. 读档失败、也没有自动备份：第一次保存前先读一下，不会拿空白盖掉原来的进度 */
{
  const mem={[KEY]:JSON.stringify(OLD)};
  let fails=2;
  const A=tabFlaky(mem,k=>k===KEY&&fails-->0);
  ok(A.Y.loadInfo().why==="read","A 读档失败");
  A.Y.markWord("1:学生",true);A.Y.addXP(2);A.Y.save();
  const st=JSON.parse(mem[KEY]);
  ok(st.xp===102&&st.words["1:私"]&&st.words["1:学生"]&&st.grammar["1-0"],"原来的进度还在，新学的也在（"+st.xp+"）");
}
/* 21. 旧版页面拿着旧进度盖掉了本页面刚存的 XP：本页面再保存时 XP 不倒退，旧版页面写的也保留 */
{
  const mem={[KEY]:JSON.stringify(OLD)};
  const A=tab(mem);
  A.Y.addXP(10);A.Y.save();                                   /* 存档 xp 110 */
  const old=JSON.parse(JSON.stringify(OLD));old.xp=105;old.words["9:旧版"]={lv:1,due:0,r:1,x:0};old.updated=Date.now()+1000;
  mem[KEY]=JSON.stringify(old);                               /* 旧版页面：在 100 的基础上拿了 5，直接写 */
  A.Y.addXP(2);A.Y.save();
  const st=JSON.parse(mem[KEY]);
  ok(st.xp>=112&&st.words["9:旧版"],"XP 不倒退（"+st.xp+"），旧版页面写的单词也在");
}
console.log("datasafe: "+pass+" 项全部通过");
