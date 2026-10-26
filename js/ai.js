/* Yume · AI 能力（js/ai.js）
 * window.Yume.ai = {available(), chat(messages,{json}), ask(prompt), settingsCardHTML(), openSettings(), status(), onChange(fn)}
 * 提供方优先级：
 *   (1) 在 claude.ai artifact 里运行：claude.use("sample") 拿到的 Claude（消耗看网页的人自己的 Claude 用量，首次调用会请求授权）
 *   (2) 用户在「我的 → AI 设置」里填的 OpenAI 兼容接口：DeepSeek / 通义千问 / 自定义
 * API Key 只存在本机独立的 localStorage 键「yume-ai」（Yume.store），不进 S、不进存档、不同步。
 * 代码里没有任何真实 key。
 */
(function(){
"use strict";
const Y=window.Yume;
const {esc,IC}=Y;
const W=window;

/* ============ 配置 ============ */
const PRESETS={
  deepseek:{name:"DeepSeek",url:"https://api.deepseek.com/chat/completions",model:"deepseek-chat",
    how:"打开 DeepSeek 开放平台 platform.deepseek.com → 注册登录 → 左侧「API keys」→「创建 API key」，复制 sk- 开头的一串。按用量计费，需要先充值少量余额。"},
  qwen:{name:"通义千问",url:"https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",model:"qwen-plus",
    how:"打开阿里云百炼 bailian.console.aliyun.com → 开通「模型服务」→「API-KEY」页面创建并复制。新用户通常有免费额度，用完后按量计费。"},
  custom:{name:"自定义接口",url:"",model:"",
    how:"任何兼容 OpenAI 格式（/chat/completions）、并且允许浏览器直接访问（CORS）的接口都可以。地址可以只填到 /v1，会自动补上 /chat/completions。"}
};
const PROVS=["deepseek","qwen","custom","off"];
const STORE_KEY="ai";   /* localStorage 实际键名 yume-ai */

function cfg(){
  const c=Y.store.get(STORE_KEY,null);
  const o=c&&typeof c==="object"?c:{};
  const s=x=>typeof x==="string"?x:"";
  const obj=x=>x&&typeof x==="object"&&!Array.isArray(x)?x:{};
  const keys=obj(o.keys),models=obj(o.models);
  return{
    prov:PROVS.includes(o.prov)?o.prov:"deepseek",
    keys:{deepseek:s(keys.deepseek),qwen:s(keys.qwen),custom:s(keys.custom)},
    models:{deepseek:s(models.deepseek),qwen:s(models.qwen),custom:s(models.custom)},
    url:s(o.url),
    tier:o.tier==="default"?"default":"quick"
  };
}
function saveCfg(c){return Y.store.set(STORE_KEY,c)}
function endpoint(c){
  if(c.prov==="custom"){
    const u=Y.safeUrl(c.url);if(!u)return "";
    const t=u.replace(/\/+$/,"");
    return /\/chat\/completions$/.test(t)?t:t+"/chat/completions";
  }
  return (PRESETS[c.prov]||{}).url||"";
}
const modelOf=c=>c.models[c.prov]||(PRESETS[c.prov]||{}).model||"";
const keyOf=c=>c.keys[c.prov]||"";
function extReady(c){c=c||cfg();return c.prov!=="off"&&!!keyOf(c)&&!!endpoint(c)&&!!modelOf(c)}
const extName=c=>{c=c||cfg();return (PRESETS[c.prov]||{}).name+" · "+modelOf(c)};

/* ============ claude.ai 里的 Claude（sample 能力） ============ */
const CL={fn:null,state:"none"};   /* state: none（不在 claude.ai）| probing | ok | off（没授权/不可用） */
const inClaudeHost=()=>!!(W.claude&&typeof W.claude.use==="function");
function probeClaude(){
  if(!inClaudeHost()||CL.state!=="none")return;
  /* 失败后允许再试，但最多 3 次、间隔至少 3 秒（available() 每次渲染都会调用） */
  const now=Date.now();if((CL.tries||0)>=3||now-(CL.last||0)<3000)return;
  CL.tries=(CL.tries||0)+1;CL.last=now;
  CL.state="probing";
  let p;try{p=Promise.resolve(W.claude.use("sample"))}catch(e){CL.state="none";return}
  p.then(fn=>{if(typeof fn==="function"){CL.fn=fn;CL.state="ok"}else CL.state="none";changed()},
         ()=>{CL.state="none";changed()});
}
const claudeOK=()=>CL.state==="ok"&&!!CL.fn;
/* window.claude 可能比本脚本晚注入（core 的 initCloud 也是这样等的）：用到 AI 时没探测过就补探一次 */
const reprobe=()=>{if(CL.state==="none")probeClaude()};
function watchClaude(n){if(CL.state!=="none")return;if(inClaudeHost()){probeClaude();return}if(n<15)setTimeout(()=>watchClaude(n+1),400)}

/* ============ 状态变化通知 ============ */
const LISTEN=[];
function onChange(fn){if(typeof fn==="function")LISTEN.push(fn)}
function changed(){
  for(const f of LISTEN)try{f()}catch(e){console.error(e)}
  if(Y.booted&&(Y.ui.tab==="me"||Y.ui.tab==="media"))Y.render();
}

/* ============ 错误 ============ */
function aiErr(message,code,retry){const e=new Error(message);e.code=code||"error";e.retry=!!retry;return e}
const CLAUDE_MSG={
  cancelled:"已停止",
  not_granted:"你没有允许这个网页使用 Claude。可以在 claude.ai 里这个页面的权限设置中重新允许。",
  sampling_disabled:"当前账号或组织不能在网页里使用 Claude。",
  not_declared:"这个网页没有开启 Claude 能力。",
  capability_disabled:"当前环境不能使用 Claude。",
  capability_removed:"当前 claude.ai 版本不支持这个功能。",
  rate_limited:"Claude 调用太频繁，或已经达到用量上限，请过一会儿再试。",
  session_expired:"claude.ai 登录已过期，请重新登录后再试。",
  prompt_too_large:"一次发送的内容太长了，请减少每次处理的行数。",
  invalid_json:"AI 返回的不是完整的 JSON（可能内容太长被截断），请重试。",
  refused:"Claude 拒绝处理这段内容。",
  empty_completion:"AI 没有返回内容，请重试。",
  upstream_error:"Claude 服务暂时出错，请稍后重试。"
};
const CLAUDE_DEAD=["not_granted","sampling_disabled","not_declared","capability_disabled","capability_removed"];
function mapClaudeErr(e){
  const code=e&&e.code||"upstream_error";
  if(CLAUDE_DEAD.includes(code)){CL.state="off";setTimeout(changed,0)}
  const er=aiErr(CLAUDE_MSG[code]||CLAUDE_MSG.upstream_error,code==="invalid_json"?"invalid_json":code,false);
  er.raw=e&&e.text;return er;
}
function httpErr(status,detail,name){
  const d=detail?`（${String(detail).slice(0,120)}）`:"";
  if(status===401||status===403)return aiErr(`${name} 拒绝了请求：API Key 不对或没有权限，请检查 Key 是否复制完整${d}`,"auth");
  if(status===402)return aiErr(`${name} 账户余额不足，请到服务商后台充值后再试${d}`,"balance");
  if(status===404)return aiErr(`接口地址或模型名不对，请检查设置${d}`,"notfound");
  if(status===429)return aiErr(`请求太频繁或额度已用完，请稍后再试${d}`,"rate",true);
  if(status===400||status===422)return aiErr(`请求被拒绝，可能是模型名不对或内容太长${d}`,"bad");
  if(status>=500)return aiErr(`${name} 服务器暂时出错（${status}），请稍后再试`,"server",true);
  return aiErr(`请求失败（${status}）${d}`,"http");
}

/* ============ JSON 解析（容忍 ```json 代码块、前后多一句话） ============ */
function parseJSON(text){
  let t=String(text==null?"":text).trim();
  const fence=t.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  const tries=[t];if(fence)tries.push(fence[1].trim());
  const a=t.search(/[\[{]/),b=Math.max(t.lastIndexOf("}"),t.lastIndexOf("]"));
  if(a>=0&&b>a)tries.push(t.slice(a,b+1));
  for(const s of tries){try{return JSON.parse(s)}catch(e){}}
  throw aiErr("AI 返回的内容不是有效的 JSON，请重试。","invalid_json");
}

/* ============ 调用 ============ */
function toMessages(input){
  if(typeof input==="string")return [{role:"user",content:input}];
  if(!Array.isArray(input))throw aiErr("调用参数不对","bad");
  return input.filter(m=>m&&m.content!=null&&String(m.content).trim()).map(m=>({role:["system","assistant"].includes(m.role)?m.role:"user",content:String(m.content)}));
}
async function viaClaude(msgs,o){
  /* sample 没有 system 角色：把 system 并进第一条 user；轮次必须以 user 开始和结束 */
  const sys=msgs.filter(m=>m.role==="system").map(m=>m.content).join("\n\n");
  const turns=msgs.filter(m=>m.role!=="system").map(m=>({role:m.role==="assistant"?"assistant":"user",content:m.content}));
  if(sys){if(turns.length&&turns[0].role==="user")turns[0]={role:"user",content:sys+"\n\n"+turns[0].content};else turns.unshift({role:"user",content:sys})}
  while(turns.length&&turns[turns.length-1].role!=="user")turns.pop();
  if(!turns.length)throw aiErr("没有要发送的内容","bad");
  const input=turns.length===1?turns[0].content:turns;
  const opts={modelTier:o.tier||cfg().tier||"quick"};
  if(o.signal)opts.signal=o.signal;
  if(o.cache===false)opts.cache=false;
  if(typeof o.onText==="function")opts.onText=o.onText;
  const fn=CL.fn;
  try{
    if(o.json){
      if(typeof fn.json==="function")return await fn.json(input,opts);
      const r=await fn(input,opts);return parseJSON(r&&r.text);
    }
    const r=await fn(input,opts);return String(r&&r.text||"");
  }catch(e){
    if(e instanceof Error&&e.code==="invalid_json")throw e;
    throw mapClaudeErr(e);
  }
}
async function viaExt(msgs,o,c){
  const url=endpoint(c),model=modelOf(c),key=keyOf(c),name=(PRESETS[c.prov]||{}).name||"AI";
  const body={model,messages:msgs,temperature:o.temperature!=null?o.temperature:0.2,stream:false};
  if(o.maxTokens)body.max_tokens=o.maxTokens;
  let useFmt=!!o.json;
  for(let attempt=0;attempt<2;attempt++){
    if(useFmt)body.response_format={type:"json_object"};else delete body.response_format;
    const ctl=new AbortController();let timedOut=false;
    const tm=setTimeout(()=>{timedOut=true;ctl.abort()},o.timeout||120000);
    const onAbort=()=>ctl.abort();
    if(o.signal){if(o.signal.aborted){clearTimeout(tm);throw aiErr("已停止","cancelled")}o.signal.addEventListener("abort",onAbort)}
    let res;
    try{
      res=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},body:JSON.stringify(body),signal:ctl.signal});
    }catch(e){
      if(o.signal&&o.signal.aborted)throw aiErr("已停止","cancelled");
      if(timedOut)throw aiErr(`${name} 太久没有回应（超过 ${Math.round((o.timeout||120000)/1000)} 秒），请稍后再试，或减少每次处理的内容。`,"timeout",true);
      if(inClaudeHost())throw aiErr("在 claude.ai 里，网页不能直接连接外部 AI 接口。请用独立网站版，或使用 Claude。","network");
      if(typeof navigator!=="undefined"&&navigator.onLine===false)throw aiErr("网络断开了，请联网后再试。","network",true);
      throw aiErr(c.prov==="custom"?"连不上这个接口：请检查地址是否正确，以及它是否允许浏览器直接访问（CORS）。":`连不上 ${name}：请检查网络后重试。`,"network",true);
    }finally{clearTimeout(tm);if(o.signal)o.signal.removeEventListener("abort",onAbort)}
    if(!res.ok){
      let detail="";try{const j=await res.json();detail=(j&&j.error&&(j.error.message||j.error.code))||(j&&j.message)||""}catch(e){}
      /* 有的兼容接口不支持 response_format：去掉再试一次 */
      if(useFmt&&res.status===400&&attempt===0&&/response_format|json/i.test(String(detail))){useFmt=false;continue}
      throw httpErr(res.status,detail,name);
    }
    let j;try{j=await res.json()}catch(e){throw aiErr("AI 返回的数据看不懂，请重试。","bad",true)}
    const ch=j&&Array.isArray(j.choices)&&j.choices[0];
    const text=ch&&ch.message&&typeof ch.message.content==="string"?ch.message.content:"";
    if(ch&&ch.finish_reason==="length"&&o.json)throw aiErr("AI 输出太长被截断了，请减少每次处理的内容。","truncated");
    if(!text.trim())throw aiErr("AI 没有返回内容，请重试。","empty",true);
    return o.json?parseJSON(text):text;
  }
  throw aiErr("请求失败","http");
}
/* chat(messages, {json, signal, tier, maxTokens, temperature, timeout, cache, onText, only:"claude"|"ext"})
 * messages：字符串，或 [{role:"system"|"user"|"assistant", content}]
 * 返回：json 时为解析后的对象，否则为文本。失败时抛出 Error（message 是给用户看的中文，code 见上）。 */
async function chat(input,o){
  reprobe();
  o=o||{};
  const msgs=toMessages(input);if(!msgs.length)throw aiErr("没有要发送的内容","bad");
  const c=cfg();let lastErr=null;
  if(o.only!=="ext"&&claudeOK()){
    try{const r=await viaClaude(msgs,o);api.lastUsed="Claude";return r}
    catch(e){if(e.code==="cancelled"||o.only==="claude"||!extReady(c))throw e;lastErr=e}
  }
  if(o.only!=="claude"&&extReady(c)){const r=await viaExt(msgs,o,c);api.lastUsed=extName(c);return r}
  throw lastErr||aiErr("还没有设置 AI：请到「我的 → AI 设置」选择 DeepSeek 或通义千问，填入 API Key。","nocfg");
}
const ask=(prompt,o)=>chat(prompt,Object.assign({},o,{json:false}));
const available=()=>{reprobe();return claudeOK()||extReady()};
function status(){
  reprobe();
  const c=cfg();
  return{claude:claudeOK(),claudeState:CL.state,inClaude:inClaudeHost(),ext:extReady(c),prov:c.prov,provider:extReady(c)?{id:c.prov,name:(PRESETS[c.prov]||{}).name,model:modelOf(c)}:null,ready:available()};
}
function providerName(){const c=cfg();return claudeOK()?"Claude":extReady(c)?extName(c):""}

/* ============ 设置卡片（「我的」页） ============ */
const ui={open:false,draft:null,msg:"",ok:false,busy:false};
function draft(){
  if(!ui.draft){const c=cfg();ui.draft={prov:c.prov,key:"",url:c.url,model:c.models[c.prov]||"",tier:c.tier}}
  return ui.draft;
}
const mask=k=>k?(k.length>10?k.slice(0,3)+"…"+k.slice(-4):"已保存"):"";
function ensureCss(){
  const D=W.document;if(!D||!D.head||!D.createElement||D.getElementById("yume-ai-css"))return;
  const st=D.createElement("style");st.id="yume-ai-css";
  st.textContent=`.aicard .aiico{width:36px;height:36px;border-radius:12px;background:var(--ai-soft);color:var(--ai);display:inline-flex;align-items:center;justify-content:center;flex:none}
.aicard .aiico .icon{width:18px;height:18px}
.aicard .chip.okc{background:var(--good-soft);color:var(--good)}
.aicard .aibox{padding:10px 12px;border-radius:12px;background:var(--sunk);font-size:13px;line-height:1.7}
.aicard .aibox.good{background:var(--good-soft)}
.aicard .aibox b{color:var(--ink)}
.aicard .ailock{display:flex;gap:8px;align-items:flex-start;font-size:13px;color:var(--muted)}
.aicard .ailock .icon{width:16px;height:16px;margin-top:2px;color:var(--good)}
.aicard input[type=password]{font:inherit;color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:10px 12px;width:100%}
.aicard .aimsg{font-size:13px;overflow-wrap:anywhere}
.aicard .aimsg.ok{color:var(--good)}.aicard .aimsg.no{color:var(--bad)}`;
  D.head.appendChild(st);
}
function settingsCardHTML(){
  reprobe();
  ensureCss();
  const c=cfg(),d=draft(),p=PRESETS[d.prov];
  const st=status();
  const chip=st.claude?`<span class="chip okc">Claude</span>`:st.ext?`<span class="chip okc">${esc((PRESETS[c.prov]||{}).name)}</span>`:`<span class="chip">未设置</span>`;
  const saved=d.prov!=="off"?c.keys[d.prov]:"";
  const claudeBox=st.inClaude?(st.claude
      ?`<div class="aibox good"><b>已连接 Claude</b>：在 claude.ai 里打开时，AI 精读会直接用 Claude，不用填 Key。会消耗你自己的 Claude 用量，第一次使用时 claude.ai 会问你是否允许。
        <div class="row" style="margin-top:6px;gap:8px"><label for="ai-tier" class="small">精读模式</label><select id="ai-tier" data-change="ai-tier" style="width:auto"><option value="quick" ${c.tier==="quick"?"selected":""}>快速（推荐）</option><option value="default" ${c.tier==="default"?"selected":""}>更准（较慢）</option></select></div></div>`
      :CL.state==="probing"?`<div class="aibox">正在检测 claude.ai 里的 Claude…</div>`
      :`<div class="aibox">在 claude.ai 里打开，但 Claude 现在不可用（可能没有授权）。另外，claude.ai 里的网页不能直接连外部接口，下面的 DeepSeek / 通义千问设置请在独立网站版里使用。</div>`):"";
  return `<details class="adv aicard" id="ai-card" ${ui.open?"open":""}><summary><span class="aiico">${IC.spark}</span><div class="grow"><b>AI 设置</b><div class="small muted">视听字幕的 AI 精读：分词、读音、词性颜色、中文翻译</div></div>${chip}</summary><div class="in">
  ${claudeBox}
  <form class="stack" style="gap:10px" data-submit="ai-save" autocomplete="off">
    <div class="setrow" style="padding-top:0"><label for="ai-prov">AI 服务</label><select id="ai-prov" data-change="ai-prov" style="width:auto">${PROVS.map(k=>`<option value="${k}" ${d.prov===k?"selected":""}>${k==="off"?"不使用":esc(PRESETS[k].name)}</option>`).join("")}</select></div>
    ${d.prov==="off"?`<div class="small muted">不使用外部 AI。${st.claude?"在 claude.ai 里仍会使用 Claude。":"视听页会用简易模式（按字符类型着色，不做翻译）。"}</div>`:`
    <div class="small muted">${esc(p.how)}</div>
    ${d.prov==="custom"?`<label class="field" for="ai-url">接口地址<input type="text" inputmode="url" id="ai-url" data-input="ai-draft" data-f="url" value="${esc(d.url)}" placeholder="https://…/v1/chat/completions" spellcheck="false"></label>`:""}
    <label class="field" for="ai-model">模型名${d.prov==="custom"?"":`（不填就用 ${esc(p.model)}）`}<input type="text" id="ai-model" data-input="ai-draft" data-f="model" value="${esc(d.model)}" placeholder="${esc(p.model||"例如 gpt-4o-mini")}" spellcheck="false"></label>
    <label class="field" for="ai-key">API Key${saved?`<span class="small">已保存：<span class="num">${esc(mask(saved))}</span>（不改就留空）</span>`:""}<input type="password" id="ai-key" data-input="ai-draft" data-f="key" value="${esc(d.key)}" placeholder="${saved?"留空表示不修改":"粘贴你的 API Key"}" autocomplete="off" spellcheck="false"></label>
    <div class="ailock">${IC.lock}<span>Key 只保存在你这台设备的浏览器里：不会进存档、不会同步到云端，也不会发给除你选的 AI 服务以外的任何地方。公用电脑上用完记得点「清除 Key」。</span></div>`}
    <div class="row" style="flex-wrap:wrap;gap:8px"><button class="btn primary sm" type="submit">保存</button><button class="btn sm" type="button" data-act="ai-test" ${ui.busy?"disabled":""}>${ui.busy?"测试中…":"测试连接"}</button>${saved?`<button class="btn ghost sm" type="button" data-act="ai-clear">清除 Key</button>`:""}</div>
    ${ui.msg?`<div class="aimsg ${ui.ok?"ok":"no"}" role="status">${esc(ui.msg)}</div>`:""}
  </form></div></details>`;
}
function rerenderCard(){if(Y.booted&&Y.ui.tab==="me")Y.render()}
function commitDraft(){
  const c=cfg(),d=draft();
  /* 以输入框里的实际内容为准（浏览器自动填充时可能没有 input 事件） */
  for(const [f,id] of [["key","ai-key"],["model","ai-model"],["url","ai-url"]]){const el=W.document&&W.document.getElementById&&W.document.getElementById(id);if(el)d[f]=el.value}
  c.prov=d.prov;
  if(d.prov!=="off"){
    const k=String(d.key||"").trim().replace(/^Bearer\s+/i,"");
    if(k){if(/[\s\u0080-\uFFFF]/.test(k))return "Key 里有空格或中文字符，请重新复制。";c.keys[d.prov]=k.slice(0,300)}
    c.models[d.prov]=String(d.model||"").trim().slice(0,100);
    if(d.prov==="custom"){const u=String(d.url||"").trim();if(u&&!Y.safeUrl(u))return "接口地址要以 https:// 或 http:// 开头。";c.url=u.slice(0,300)}
  }
  if(!saveCfg(c))return "保存失败：浏览器不允许存储（可能是无痕模式）。";
  d.key="";
  return "";
}
function openSettings(){ui.open=true;Y.go("me");setTimeout(()=>{const el=W.document.getElementById("ai-card");if(el){el.open=true;try{el.scrollIntoView({block:"start",behavior:"smooth"})}catch(e){el.scrollIntoView()}}},30)}

const A=Y.registerAction;
A("ai-prov",(dd,el)=>{const d=draft();d.prov=PROVS.includes(el.value)?el.value:"deepseek";const c=cfg();d.model=c.models[d.prov]||"";d.key="";d.url=c.url;ui.open=true;ui.msg="";Y.render()});
A("ai-draft",(dd,el)=>{const d=draft();if(["key","model","url"].includes(dd.f))d[dd.f]=el.value});
A("ai-tier",(dd,el)=>{const c=cfg();c.tier=el.value==="default"?"default":"quick";saveCfg(c);ui.open=true;Y.toast("已切换精读模式")});
A("ai-save",()=>{ui.open=true;const err=commitDraft();ui.ok=!err;ui.msg=err||(cfg().prov==="off"?"✓ 已保存：不使用外部 AI":extReady()?"✓ 已保存，可以点「测试连接」试试":"✓ 已保存（还缺 Key，AI 还不能用）");changed()});
A("ai-clear",()=>{const c=cfg();if(c.prov!=="off"){c.keys[c.prov]="";saveCfg(c)}ui.open=true;ui.ok=true;ui.msg="✓ 已清除这台设备上保存的 Key";changed()});
A("ai-test",async()=>{
  if(ui.busy)return;ui.open=true;
  const err=commitDraft();if(err){ui.ok=false;ui.msg=err;rerenderCard();return}
  const c=cfg();const only=extReady(c)?"ext":claudeOK()?"claude":null;
  if(!only){ui.ok=false;ui.msg=c.prov==="off"?"现在没有可用的 AI：请先选择一个 AI 服务。":"请先填入 API Key 再测试。";rerenderCard();return}
  ui.busy=true;ui.msg="正在连接 "+(only==="ext"?extName(c):"Claude")+"…";ui.ok=true;rerenderCard();
  const t0=Date.now();
  try{
    const r=await chat([{role:"user",content:'这是连接测试。请只输出这个 JSON，不要别的文字：{"ok":true,"ja":"こんにちは","zh":"你好"}'}],{json:true,only,tier:"quick",maxTokens:60,cache:false,timeout:30000,temperature:0});
    ui.ok=!!(r&&(r.ok===true||r.ok==="true"));
    ui.msg=ui.ok?`✓ 连接成功：${api.lastUsed}，用时 ${((Date.now()-t0)/1000).toFixed(1)} 秒`:"已经连上，但返回的内容不对：请检查模型名是否填对。";
  }catch(e){ui.ok=false;ui.msg="✗ "+(e&&e.message||"连接失败")}
  ui.busy=false;changed();
});

const api={available,chat,ask,parseJSON,status,providerName,onChange,openSettings,settingsCardHTML,PRESETS,lastUsed:""};
Y.ai=api;
Y.registerCard("me",()=>settingsCardHTML(),{order:20});
watchClaude(0);
})();
