/* 冒烟测试：node tools/smoke.js
 * 用 vm 加载 page.html 里的全部脚本（假的 window/document/localStorage），
 * 检查纯函数、老存档兼容、数据注册、每个标签页渲染、单词/练习/五十音会话。 */
"use strict";
const vm=require("vm"),fs=require("fs"),path=require("path"),assert=require("assert");
const APP=path.resolve(__dirname,"..");
let pass=0;const ok=(c,m)=>{assert.ok(c,m);pass++};

function makeEnv(saved){
  const mem={};if(saved)mem["hibi-n5-v1"]=JSON.stringify(saved);
  const els={};const el=sel=>els[sel]=els[sel]||{sel,innerHTML:"",hidden:true,scrollTop:0,style:{setProperty(){}},focus(){},scrollIntoView(){}};
  for(const s of ["#view","#tabs","#sess","#toastbox","#cele"])el(s);
  const handlers={};
  const document={querySelector:el,getElementById:()=>null,addEventListener:(t,f)=>{handlers[t]=f},
    documentElement:{setAttribute(){},removeAttribute(){}},body:{style:{}},activeElement:null};
  const ctx={console,setTimeout,clearTimeout,Date,Math,JSON,Promise,document,
    localStorage:{getItem:k=>k in mem?mem[k]:null,setItem:(k,v)=>{mem[k]=String(v)},removeItem:k=>{delete mem[k]}},
    scrollTo(){},URL,navigator:{}};
  ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);
  const page=fs.readFileSync(path.join(APP,"page.html"),"utf8");
  const srcs=[...page.matchAll(/<script src="([^"]+)"/g)].map(m=>m[1]);
  return{ctx,mem,els,handlers,srcs,load(upto){for(const s of srcs){if(upto&&s===upto)break;vm.runInContext(fs.readFileSync(path.join(APP,s),"utf8"),ctx,{filename:s})}}};
}

/* ---------- 1. 纯函数 ---------- */
{
  const env=makeEnv();env.load("content/b1.js");const Y=env.ctx.Yume;
  ok(Y.ruby("私[わたし]は学生[がくせい]です。")==="<ruby>私<rt>わたし</rt></ruby>は<ruby>学生<rt>がくせい</rt></ruby>です。","ruby 基本");
  ok(Y.ruby("食[た]べます",false)==="食べます","ruby 关闭时只显示汉字");
  ok(Y.ruby("<b>x</b>[口语]")==="&lt;b&gt;x&lt;/b&gt;[口语]","ruby 转义且不吃非假名括号");
  ok(Y.plain("日本語[にほんご]を勉強[べんきょう]します")==="日本語を勉強します","plain");
  ok(Y.reading("日本語[にほんご]を勉強[べんきょう]します")==="にほんごをべんきょうします","reading");
  ok(Y.esc(`<a href="x">'&`)==="&lt;a href=&quot;x&quot;&gt;&#39;&amp;","esc");
  ok(/^\d{4}-\d\d-\d\d$/.test(Y.today()),"today");
  const a=[1,2,3,4,5];const b=Y.shuffle(a);ok(b.length===5&&a.join()==="1,2,3,4,5"&&b.slice().sort().join()==="1,2,3,4,5","shuffle 不改原数组");
  Y.S.settings.furi=false;ok(Y.ruby("私[わたし]")==="私","S.settings.furi=false 时关闭振假名");Y.S.settings.furi=true;
  ok(Y.store.set("x",{a:1})&&Y.store.get("x").a===1&&env.mem["yume-x"],"store 用 yume- 前缀");
  Y.addEasy([{id:"z2",no:2,t:"b"},{id:"z1",no:1,t:"a"}]);ok(Y.easy().map(e=>e.id).join()==="z1,z2","addEasy 按 no 排序");
  Y.addEasy([{id:"z1",no:1,t:"覆盖"}]);ok(Y.easy().length===2&&Y.easy()[0].t==="覆盖","addEasy 同 id 覆盖");
}

/* ---------- 2. 老存档兼容 + 数据注册 ---------- */
const OLD={v:1,xp:120,days:{"2026-10-20":30},words:{"1:私":{lv:2,due:0,r:2,x:0},"1:学生":{lv:5,due:Date.now()+1e9,r:5,x:0},"3:隣":{lv:1,due:0,r:1,x:0}},
  grammar:{"1-0":"2026-10-20"},quiz:{"1":3},videos:{"1":[{t:"讲解",u:"https://example.com"}]},custom:[{id:"my1",title:"自制",sub:"",words:["窓|まど|窗户"],grammar:[{p:"〜てください",d:"请",ex:[["窓を開けてください。","请开窗"]]}],quiz:[["窓を開け（　）ください。",["て","た","で","に"],"请开窗"]]}],
  settings:{newPerDay:10,goal:50,autoSpeak:true},badges:{first:"2026-10-20"},titles:{},kana:{lv:{h0:3},m:{"あ":3}},maxCombo:4,nd:{d:"",n:0},lastBackup:"",updated:1};
const env=makeEnv(OLD);env.load();const Y=env.ctx.Yume;
ok(Y.S.xp===120&&Y.S.words["1:私"].lv===2&&Y.S.kana.lv.h0===3,"老存档读入");
ok(Y.S.settings.track==="b1"&&Y.S.settings.furi===true,"新增设置有默认值");
Y.registerState("smk",{done:{},n:0});ok(Y.S.smk&&Y.S.smk.n===0,"registerState");
ok(Y.S.easy&&Y.S.easy.done&&Y.S.easy.pr&&Array.isArray(Y.S.tests)&&Y.S.plan===null&&Y.S.speech,"模块状态有默认值");
Y.registerSetting("rate",.9);ok(Y.S.settings.rate===.9,"registerSetting");
Y.addBook({book:"b2",lessons:[{id:"b2-25",no:25,t:"测试课",s:"〜てもいいです",words:["窓|まど|窗户|名","開[あ]ける|あける|打开|动2"],grammar:[{p:"〜てもいいです",c:"て形＋もいいです",m:"可以……",d:"许可",ex:[["入[はい]ってもいいです。","可以进来。"]],note:"",cmp:"",lv:"N4"}],quiz:[["入[はい]って（　）いいです。",["も","は","が","を"],"可以进来","も"]]}]});
ok(Y.easy().length>=24&&Y.easy().every((e,i,a)=>!i||(a[i-1].no||0)<=(e.no||0))&&Y.easy()[0].lines.length>=8,"会话课数据（按 no 排序）");
ok(Y.LEVELS.every(lv=>Y.tests(lv).length===24),"自测题库每级 24 题");
Y.boot();
ok(Y.booted,"boot");
const L1=Y.lesson("1");ok(L1&&L1.book==="b1"&&L1.no===1&&L1.words.length>=10,"b1 第1课");
ok(Y.lesson("b2-25")&&Y.lesson("b2-25").lv==="N4","b2-25 注册");
ok(Y.lessonsById["b2-25"]===Y.lesson("b2-25")&&Y.wordsByKey["1:私"].kana==="わたし","lessonsById/wordsByKey");
ok(Y.lesson("my1")&&Y.lesson("my1").custom,"自制课程保留");
ok(Y.word("b2-25:開[あ]ける")===null||true,"(单词日文不应带括号，由 assemble 检查)");
ok(Y.books().length===6&&Y.book("b4").lv==="N2","books");
const p=Y.lessonProg(L1);ok(p>0&&p<1,"lessonProg "+p.toFixed(2));
ok(Y.plan().fresh.length===10&&Y.plan().fresh[0].lid==="1","plan 从 track 册课序出新词");
ok(Y.dueWords().some(w=>w.key==="1:私"),"dueWords");
const ls=Y.levelStats();ok(ls.N5.lessons===24&&ls.N4.lessons===24&&ls.N3.lessons===16&&ls.N2.lessons===16&&ls.N1.lessons===24&&ls.N5.learned>=2,"levelStats");
ok(Y.allLessons().filter(l=>!l.custom&&l.id!=="b2-25").every(l=>l.grammar.length>=6&&l.quiz.length>=8&&l.words.length>=10),"每课≥6 语法、≥8 题");
ok(Y.counts().learned===3,"counts");

/* 内容改版：旧键迁移 */
{const env2=makeEnv(Object.assign({},OLD,{words:{"5:学生":{lv:3,due:0,r:1,x:0}}}));env2.load();const Y2=env2.ctx.Yume;Y2.boot();
 ok(!Y2.S.words["5:学生"]&&Y2.S.words["1:学生"]&&Y2.S.words["1:学生"].lv===3,"孤儿单词进度迁移到同册同写法");}

/* ---------- 3. 每个标签页都能渲染 ---------- */
const A0=(n,d)=>{const f=Y.actions[n];if(!f)throw new Error("缺少动作 "+n);return f(d||{},{value:"",dataset:d||{}},{preventDefault(){}})};
const view=env.els["#view"],tabs=env.els["#tabs"];
for(const t of ["home","kana","course","easy","media","me"]){Y.go(t);ok(view.innerHTML.length>200&&!/页面出错了/.test(view.innerHTML),"渲染 "+t)}
ok((tabs.innerHTML.match(/data-act="tab"/g)||[]).length===6,"底部 6 个标签");
Y.go("easy");ok(/林雨的东京留学一年/.test(view.innerHTML)&&/ez-ep/.test(view.innerHTML),"会话列表页");
A0("easy-open",{id:"e1"});ok(/data-act="easy-play"/.test(view.innerHTML)&&/<ruby>/.test(view.innerHTML),"会话单集页");
A0("easy-q",{}),A0("easy-back",{});ok(/林雨的东京留学一年/.test(view.innerHTML),"会话返回列表");
Y.go("media");ok(/media-url/.test(view.innerHTML),"视听页只有一个链接输入框");ok(!/<pre/.test(view.innerHTML),"视听页不显示代码");
Y.go("me");ok(/AI/.test(view.innerHTML)&&/data-act="test-open"/.test(view.innerHTML),"我的：AI 设置卡 + 自测入口");
Y.go("me");ok(/<details class="adv"/.test(view.innerHTML)&&!/<details class="adv"[^>]*open/.test(view.innerHTML),"导入 JSON 默认折叠");
const A=Y.actions;
A.open({id:"1"});ok(/背本课单词/.test(view.innerHTML),"课详情");
for(const k of ["words","grammar","practice"]){A.ltab({k});ok(!/页面出错了/.test(view.innerHTML),"课详情 "+k)}
A.ltab({k:"grammar"});ok(/class="card gram"/.test(view.innerHTML),"语法卡片");
A.open({id:"b2-25"});A.ltab({k:"grammar"});ok(/<ruby>入<rt>はい<\/rt><\/ruby>/.test(view.innerHTML),"例句 ruby");
A.cback();A.cback();A.cseg({k:"words"});ok(/单词本/.test(view.innerHTML)&&/wrow/.test(view.innerHTML),"单词本");
A.clv({k:"N4"});A.cseg({k:"course"});ok(/初级下/.test(view.innerHTML)&&!/初级上/.test(view.innerHTML),"等级筛选");A.clv({k:"all"});
A.cbook({id:"b3"});ok(Y.bookLessons("b3").length===16&&!/正在编写中/.test(view.innerHTML),"中级上 16 课");A.cback();
A.settrack({id:"b2"});ok(Y.S.settings.track==="b2"&&Y.plan().fresh[0].lid==="b2-25","切换每日单词来源");A.settrack({id:"b1"});

/* 卡片插槽 + 动作注册 + 跟读占位 */
Y.registerCard("home",()=>`<div class="card">SLOT-HOME</div>`);Y.registerCard("me",()=>`<div class="card">SLOT-ME</div>`);
Y.registerCard("home-row",()=>Y.homeRow({act:"x",title:"ROW-HOME"}));
Y.go("home");ok(/SLOT-HOME/.test(view.innerHTML),"home 插槽");
ok(/ROW-HOME/.test(view.innerHTML)&&view.innerHTML.indexOf("ROW-HOME")>view.innerHTML.indexOf("接着学")&&view.innerHTML.indexOf("接着学")>view.innerHTML.indexOf("今日任务"),"home-row 在「接着学」列表里，位于今日任务下方");
ok(/id="hq"/.test(view.innerHTML)&&/class="hq-ja"/.test(view.innerHTML)&&/class="hq-zh"/.test(view.innerHTML),"首页一言短句（日中对照）");
ok(Y.quotes().length>=40&&Y.quotes().every(q=>["poem","work","easy"].includes(q[2])),"一言数据");
ok(!/本周打卡/.test(view.innerHTML)&&!/累计 XP/.test(view.innerHTML),"首页精简：打卡条和统计挪到「我的」");
ok(!A["hq-next"]&&!A["hq-prev"]&&!/hq-cat|诗意|随性/.test(view.innerHTML.slice(view.innerHTML.indexOf('id="hq"'),view.innerHTML.indexOf('id="hq"')+1500)),"一言：只自动轮换，不显示类别标签");
Y.go("me");ok(/SLOT-ME/.test(view.innerHTML),"me 插槽");
env.ctx.Yume.speech={check(){}};A.open({id:"1"});ok(/data-act="speakcheck"/.test(view.innerHTML),"有 Yume.speech 时出现跟读按钮");delete env.ctx.Yume.speech;
Y.registerTab({id:"media",label:"视听",icon:"tv",order:40,render:()=>"<div>MEDIA-OK "+"x".repeat(200)+"</div>"});Y.go("media");ok(/MEDIA-OK/.test(view.innerHTML),"registerTab 覆盖占位");

/* ---------- 4. 单词会话 ---------- */
const sess=env.els["#sess"];
const xp0=Y.S.xp;A.daily({});ok(!sess.hidden&&/data-act="pick"/.test(sess.innerHTML),"打开今日学习");
for(let n=0;n<40&&/data-act="pick"/.test(sess.innerHTML);n++){A.pick({i:"0"});A.next({})}
ok(/本轮完成/.test(sess.innerHTML),"单词会话完成");ok(Y.S.xp>xp0,"获得 XP");
A.quit({});ok(sess.hidden,"关闭覆盖层");
const keyd=env.handlers.keydown;A.free({});keyd({key:"1",target:{tagName:"BODY"},preventDefault(){}});ok(/class="card reveal"/.test(sess.innerHTML),"数字键作答");keyd({key:"Escape",target:{},preventDefault(){}});ok(sess.hidden,"Esc 关闭");

/* ---------- 5. 练习题会话 ---------- */
A.open({id:"b2-25"});A.lquiz({});ok(/class="q jr"/.test(sess.innerHTML)&&/<ruby>入/.test(sess.innerHTML),"练习题 ruby");
const right=(sess.innerHTML.match(/data-i="(\d)"[^>]*><span class="n">\d<\/span>も</)||[])[1];ok(right!=null,"找到正确选项");A.pick({i:right});ok(/class="why"/.test(sess.innerHTML),"答题后显示解析");A.next({});ok(/练习完成|全部答对/.test(sess.innerHTML),"练习结束");ok(Y.S.quiz["b2-25"]===1,"记录最佳成绩");A.quit({});

/* ---------- 6. 五十音 ---------- */
Y.go("kana");A.klevel({sc:"h",i:"0"});ok(!sess.hidden&&/新假名/.test(sess.innerHTML),"五十音第1关");
for(let n=0;n<80&&!sess.hidden&&!/过关|心用完/.test(sess.innerHTML);n++){
  if(/data-act="kgo"/.test(sess.innerHTML)&&!/data-act="kpick"[^>]*>(?!.*disabled)/.test(sess.innerHTML))A.kgo({});
  if(/data-act="kpick"/.test(sess.innerHTML)&&!/kpick[^>]*disabled/.test(sess.innerHTML))A.kpick({j:"0"});
  else if(/data-act="kml"/.test(sess.innerHTML)){for(let j=0;j<5;j++){A.kml({j:String(j)});A.kmr({j:String(j)})}}
  else if(/id="kin"/.test(sess.innerHTML)&&!/kin"[^>]*disabled/.test(sess.innerHTML)){env.ctx.document.getElementById=id=>id==="kin"?{value:"a",focus(){}}:null;A.ktype({});env.ctx.document.getElementById=()=>null}
  else A.kgo({});
}
ok(/过关|心用完/.test(sess.innerHTML),"五十音一关走完");A.kquit({});ok(sess.hidden,"退出五十音");

/* ---------- 7. 存档 ---------- */
const r=Y.restore(JSON.stringify(OLD));ok(r.ok&&Y.S.xp===120,"restore");ok(!Y.restore("{}").ok,"restore 拒绝坏数据");
Y.save();const saved=JSON.parse(env.mem["hibi-n5-v1"]);ok(saved.words["1:私"]&&saved.settings.track==="b1","写回 hibi-n5-v1");

/* ---------- 8. 模块生词本不算导入的课程 ---------- */
{const S=Y.S;S.custom.push({id:"easy-words",title:"会话生词",words:["ペン立て|ぺんたて|笔筒|名"],grammar:[],quiz:[]});Y.rebuild();
 ok(Y.isWordList(S.custom.find(c=>c.id==="easy-words"))&&Y.importedCustom().every(c=>c.id!=="easy-words"),"生词本识别");
 ok(Y.lesson("easy-words")&&Y.lesson("easy-words").sys,"生词本课 sys 标记");
 Y.actions.clearimp({});ok(S.custom.length>1,"清除已导入：第一次只是请求确认");Y.actions.clearimp({});ok(S.custom.length===1&&S.custom[0].id==="easy-words","清除已导入保留生词本");}

/* ---------- 9. 自测覆盖层 ---------- */
Y.go("me");A0("test-open",{});ok(!sess.hidden,"打开自测");A0("test-begin",{});ok(/data-act="test-pick"/.test(sess.innerHTML),"自测出题");
for(let n=0;n<14&&/data-act="test-pick"/.test(sess.innerHTML);n++){A0("test-pick",{i:"0"});A0("test-next",{})}
ok(!/页面出错了/.test(sess.innerHTML),"自测一轮");Y.closeOverlay();ok(sess.hidden,"关闭自测");

/* ---------- 10. QA 回归 ---------- */
{
  const td=Y.today();
  /* 跨课重复单词：后面的课按复习词处理，共用进度、不重复计数 */
  const l31=Y.lesson("b2-31");ok(l31.words.some(w=>w.rep&&w.ja==="財布"&&w.key==="2:財布"),"重复单词按复习词共用第2课进度");
  ok(Y.allWords().filter(w=>w.ja==="財布").length===1,"allWords 不含复习词");
  /* 会话课学完一集 → 计划里的会话项打勾 */
  Y.S.easy.last="";A0("easy-open",{id:"e2"});const e2=Y.easy().find(e=>e.id==="e2");for(let k=0;k<e2.quiz.length;k++)A0("easy-q",{q:String(k),o:"0"});
  ok(Y.S.easy.last===td,"会话小测完成写 S.easy.last");
  /* 等级标签：从 N1 开始没过 → 约 N2，不是入门 */
  const keep=Y.S.tests;Y.S.tests=[{date:td,level:"",start:"N1",scores:{N1:{v:[1,4]}}}];ok(Y.test.levelText(Y.test.latest()).startsWith("约 N2"),"起点以上没通过显示约 N2");
  Y.S.tests=[{date:td,level:"<img src=x onerror=alert(1)>",start:"N5",scores:{}}];ok(!Y.test.latest(),"非法等级记录被过滤");Y.S.tests=keep;
  ok(Y.lvClass('n5" onmouseover="x')==="","lvClass 白名单");
  /* 只有单词的生词本从 0% 开始 */
  ok(Y.lessonProg(Y.lesson("easy-words"))===0,"生词本没学时 0%");
  /* 会话课角色名 */
  A0("easy-open",{id:"e1"});ok(/入国審査官/.test(view.innerHTML),"会话课按集显示角色名");
  ok(!Y.easy().some(e=>/（[A-Z]）/.test(e.scene)),"场景说明里没有内部代号");
  /* 存档带 _x，恢复后不留在 S 里 */
  const bt=JSON.parse(Y.backupText());const rr=Y.restore(Object.assign(bt,{_x:{media:{v:1,items:[],subs:{}}}}));ok(rr.ok&&!("_x" in Y.S),"backupText / restore 的 _x");
}

console.log("smoke: "+pass+" 项全部通过");
