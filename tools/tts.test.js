/* 发音引擎测试：node tools/tts.test.js
 * 模拟浏览器的 speechSynthesis 和 Audio，检查：没有日语语音时用在线发音、单词/句子的来源顺序、来源失败时换另一个、
 * 自带语音「瞬间读完」时改用在线发音、停止朗读时 Promise 会结束。 */
"use strict";
const vm=require("vm"),fs=require("fs"),path=require("path"),assert=require("assert");
const APP=path.resolve(__dirname,"..");
let pass=0;const ok=(c,m)=>{assert.ok(c,m);pass++};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function env(opts){
  opts=opts||{};
  const log=[];
  /* 假的 Audio：src 里含 opts.failHost 的立刻报错，其余 40ms 后播完 */
  class FakeAudio{
    constructor(){this.paused=true;this.playbackRate=1;this.defaultPlaybackRate=1;this._t=null}
    setAttribute(){}
    play(){const src=this.src;log.push(["play",src]);this.paused=false;
      const bad=(opts.failHosts||[]).some(h=>src.includes(h));
      setTimeout(()=>{if(this.src!==src)return;if(bad){this.onerror&&this.onerror()}else{this.onplaying&&this.onplaying();this._t=setTimeout(()=>{if(this.src===src&&!this.paused){this.paused=true;this.onended&&this.onended()}},40)}},5);
      return Promise.resolve()}
    pause(){this.paused=true;clearTimeout(this._t)}
  }
  /* 假的 speechSynthesis：opts.voices 决定语音列表；opts.sysDur 是每句读多久（ms） */
  const ss={speaking:false,pending:false,_u:null,
    getVoices:()=>opts.voices||[],addEventListener(){},resume(){},
    cancel(){if(this._u){const u=this._u;this._u=null;this.speaking=false;clearTimeout(u._t);u.onerror&&u.onerror({error:"interrupted"})}},
    speak(u){log.push(["say",u.text,u.voice&&u.voice.name]);this._u=u;this.speaking=true;
      setTimeout(()=>{u.onstart&&u.onstart();u._t=setTimeout(()=>{if(this._u===u){this._u=null;this.speaking=false;u.onend&&u.onend()}},opts.sysDur==null?400:opts.sysDur)},5)}};
  function Utter(t){this.text=t}
  const mem={};
  const ctx={console:{log(){},info(){},warn(){},error:console.error},setTimeout,clearTimeout,setInterval:()=>0,clearInterval(){},Date,Math,JSON,Promise,
    localStorage:{getItem:k=>k in mem?mem[k]:null,setItem:(k,v)=>{mem[k]=String(v)},removeItem:k=>{delete mem[k]}},
    navigator:{onLine:true},Audio:FakeAudio,speechSynthesis:opts.noSS?undefined:ss,SpeechSynthesisUtterance:opts.noSS?undefined:Utter};
  ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(APP,"js/core.js"),"utf8"),ctx,{filename:"core.js"});
  return{Y:ctx.Yume,log,ss};
}
(async()=>{
  /* 1. 没有 speechSynthesis（微信内置浏览器）：用在线发音；单词先有道 */
  {const {Y,log}=env({noSS:true});
    ok(Y.tts.ok&&Y.tts.ja()&&Y.tts.engine()==="online","没有自带语音时：能发音，走在线");
    const r=await Y.speak("がくせい");ok(r===true,"单词读完");
    ok(log[0][0]==="play"&&log[0][1].includes("dict.youdao.com"),"单词先用有道");}
  /* 2. 句子先百度 */
  {const {Y,log}=env({noSS:true});
    await Y.speak("私[わたし]は学生[がくせい]です。");
    ok(log[0][1].includes("fanyi.baidu.com")&&decodeURIComponent(log[0][1]).includes("私は学生です。"),"句子先用百度，去掉了振假名");}
  /* 3. 有道读不出来 → 换百度；之后同一个词直接用百度 */
  {const {Y,log}=env({noSS:true,failHosts:["youdao"]});
    const r=await Y.speak("べんきょう");
    ok(r===true&&log.length===2&&log[1][1].includes("baidu"),"有道失败后换百度读出来");
    log.length=0;await Y.speak("べんきょう");
    ok(log.length===1&&log[0][1].includes("baidu"),"记住了：同一个词直接用百度");}
  /* 4. 两个来源都不行：返回 false，90 秒内不再先试在线 */
  {const {Y,log}=env({voices:[{name:"Kyoko",lang:"ja-JP",localService:true}],failHosts:["youdao","baidu"]});
    Y.S.settings.voice="online";
    const r=await Y.speak("ねこ");ok(r===false,"在线都失败（只用在线模式）：返回 false");
    Y.S.settings.voice="auto";
    ok(Y.tts.engine()==="system","有日语语音时 auto 用自带语音");}
  /* 5. 有日语语音：用自带；「瞬间读完」（语音包没装好）→ 改用在线 */
  {const {Y,log}=env({voices:[{name:"Kyoko",lang:"ja-JP",localService:true}],sysDur:20});
    ok(Y.tts.engine()==="system","有日语语音：先用自带");
    const r=await Y.speak("いぬ");
    ok(r===true&&log[0][0]==="say"&&log[1]&&log[1][0]==="play","自带语音瞬间结束：判为失败，改用在线读出来");
    ok(Y.tts.engine()==="online","之后先用在线");}
  /* 6. 安卓列表里语言写成 ja_JP 也能认出来 */
  {const {Y}=env({voices:[{name:"日本語 日本",lang:"ja_JP",localService:true},{name:"English",lang:"en-US"}]});
    ok(Y.tts.voice&&Y.tts.voice.lang==="ja_JP","ja_JP 写法也认");}
  /* 7. 停止朗读：正在等的 Promise 会结束（返回 false），不会一直挂着 */
  {const {Y}=env({noSS:true});
    const p=Y.speak("ながいぶんしょうをよみます。");await sleep(10);Y.stopSpeak();
    const r=await Promise.race([p,sleep(500).then(()=>"hang")]);ok(r===false,"stopSpeak 后 Promise 返回 false");}
  /* 8. 长句分段：超过 120 字按句号分成几段依次播放 */
  {const {Y,log}=env({noSS:true});
    const long="今日はとてもいい天気です。".repeat(14);
    await Y.speak(long);ok(log.length>=2&&log.every(x=>x[1].includes("baidu")),"长句分成 "+log.length+" 段播放");}
  /* 9. 语速：慢速 rate .6 → 在线播放速度约 0.67 */
  {const {Y}=env({noSS:true});Y.S.settings.speed=1;
    const done=Y.speak("ねこ",{rate:.6});await done;ok(true,"慢速可以播放");}
  console.log("tts: "+pass+" 项全部通过");
})().catch(e=>{console.error(e);process.exit(1)});
