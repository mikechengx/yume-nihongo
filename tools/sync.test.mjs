/* 多设备同步测试：node tools/sync.test.mjs
 * 服务器用 netlify/sync-core.mjs 的真实逻辑 + 内存存储；每台「设备」是一个 vm 上下文（自己的 localStorage），
 * 同一台设备的多个页面共享 localStorage。fetch 直接调用服务器逻辑，可以模拟断网、写入时被别的设备抢先。 */
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
import { handle, memoryStore, keyOf, normCode, CREATE_PER_DAY } from "../netlify/sync-core.mjs";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };
const page = fs.readFileSync(path.join(APP, "page.html"), "utf8");
const CODE = [...page.matchAll(/<script src="([^"]+)"/g)].map(m => [m[1], fs.readFileSync(path.join(APP, m[1]), "utf8")]);
const KEY = "hibi-n5-v1";

/* ---- 服务器 ---- */
let server = memoryStore();
const net = { down: false, beforePut: null, calls: 0 };
async function fakeFetch(url, init) {
  if (net.down) throw new TypeError("Failed to fetch");
  net.calls++;
  const b = JSON.parse(init.body);
  if (b.op === "put" && net.beforePut) { const h = net.beforePut; net.beforePut = null; await h(); }
  return handle(new Request("http://localhost" + url, { method: init.method, body: init.body, headers: init.headers }), server, { ip: "10.0.0.1" });
}
async function serverGet(code) {
  const r = await handle(new Request("http://x/api/sync", { method: "POST", body: JSON.stringify({ op: "get", code }) }), server);
  return { status: r.status, j: await r.json() };
}

/* ---- 设备 ---- */
function page_(mem, fetchFn) {
  const els = {}; const el = sel => els[sel] = els[sel] || { sel, innerHTML: "", hidden: true, scrollTop: 0, style: { setProperty() {} }, focus() {}, scrollIntoView() {} };
  for (const s of ["#view", "#tabs", "#sess", "#toastbox", "#cele"]) el(s);
  const wh = {}, dh = {};
  const document = { querySelector: el, getElementById: () => null, addEventListener: (t, f) => { dh[t] = f }, visibilityState: "visible",
    documentElement: { setAttribute() {}, removeAttribute() {} }, body: { style: {} }, activeElement: null };
  /* 1 秒以上的定时器（防抖、重试）不自动执行：测试里手动调用 syncNow，结果可重复 */
  const st = (f, ms) => (ms >= 1000 ? 0 : setTimeout(f, ms));
  const ctx = { console: { log() {}, info() {}, warn() {}, error: console.error }, setTimeout: st, clearTimeout, setInterval: () => 0, clearInterval() {},
    Date, Math, JSON, Promise, document, URL, navigator: {}, scrollTo() {}, addEventListener: (t, f) => { wh[t] = f },
    localStorage: { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v) }, removeItem: k => { delete mem[k] },
      get length() { return Object.keys(mem).length }, key: i => Object.keys(mem)[i] },
    fetch: fetchFn || fakeFetch, AbortController };
  ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
  for (const [s, c] of CODE) vm.runInContext(c, ctx, { filename: s });
  ctx.Yume.boot();
  return { Y: ctx.Yume, wh, dh, document, mem };
}
const device = (init, fetchFn) => { const mem = {}; if (init) mem[KEY] = JSON.stringify(init); return page_(mem, fetchFn); };
const stored = d => JSON.parse(d.mem[KEY]);
const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };

const OLD = { v: 1, xp: 100, days: { "2026-10-20": 100 }, words: { "1:私": { lv: 2, due: 0, r: 2, x: 0 } }, grammar: { "1-0": "2026-10-20" }, quiz: { "1": 3 }, videos: {}, custom: [],
  settings: { newPerDay: 10, goal: 50, autoSpeak: true }, badges: { first: "2026-10-20" }, titles: {}, kana: { lv: { h0: 3 }, m: {} }, maxCombo: 4, nd: { d: "", n: 0 }, lastBackup: "", updated: 1000 };
const OTHER = { v: 1, xp: 40, days: { "2026-10-18": 40 }, words: { "2:辞書": { lv: 1, due: 0, r: 1, x: 0 } }, grammar: { "2-1": "2026-10-18" }, quiz: {}, videos: {}, custom: [],
  settings: { newPerDay: 10, goal: 50, autoSpeak: true }, badges: {}, titles: {}, kana: { lv: { k0: 2 }, m: {} }, maxCombo: 2, nd: { d: "", n: 0 }, lastBackup: "", updated: 900 };

/* ===== 服务器本身 ===== */
{
  const call = async (b, ip) => { const r = await handle(new Request("http://x/", { method: "POST", body: JSON.stringify(b) }), server, { ip }); return [r.status, await r.json()]; };
  const [s1, c] = await call({ op: "create", data: { xp: 1, words: {} } });
  ok(s1 === 200 && normCode(c.code) === c.code, "服务器：生成同步码");
  ok((await call({ op: "put", code: c.code, rev: 1, data: { xp: 2, words: {} } }))[0] === 200, "服务器：版本对时可以写");
  const [s3, cf] = await call({ op: "put", code: c.code, rev: 1, data: { xp: 3, words: {} } });
  ok(s3 === 409 && cf.rev === 2 && cf.data.xp === 2, "服务器：版本不对时返回最新的一份（409）");
  ok((await call({ op: "get", code: "0000-1111-IIII" }))[0] === 400, "服务器：同步码格式不对");
  ok((await call({ op: "put", code: c.code, rev: 2, data: "x" }))[0] === 400, "服务器：拒绝不像进度的数据");
  ok(!JSON.stringify([...server._map.keys()]).includes(c.code), "服务器：存储里看不到同步码本身（只存哈希）");
  let blocked = 0; for (let i = 0; i < CREATE_PER_DAY + 2; i++) if ((await call({ op: "create", data: { xp: 1, words: {} } }, "9.9.9.9"))[0] === 429) blocked++;
  ok(blocked === 2, "服务器：同一个 IP 每天生成次数有上限");
  server = memoryStore();
}

/* ===== 1. 开启同步 ===== */
const A = device(OLD);
await A.Y.sync.create();
const code = A.Y.sync.state().code;
ok(normCode(code) === code && A.Y.sync.state().rev === 1, "A 开启同步，拿到同步码");
ok((await serverGet(code)).j.data.xp === 100, "A 的进度传到了云端");

/* ===== 2. B 加入：两边的进度合并，都保留 ===== */
const B = device(OTHER);
await B.Y.sync.join(code.slice(0, 4).toLowerCase() + " " + code.slice(4, 8) + "-" + code.slice(8));
ok(B.Y.sync.state().code === code, "B 用同步码加入（大小写、空格、横线都能认）");
ok(B.Y.S.words["1:私"] && B.Y.S.words["2:辞書"] && B.Y.S.grammar["1-0"] && B.Y.S.grammar["2-1"], "B：两边的单词、语法都在");
ok(B.Y.S.xp === 140, "B：XP = 两边加起来（不同日子学的）：" + B.Y.S.xp);
ok(stored(B).xp === 140, "B：合并结果存进了本机");
await A.Y.sync.syncNow("test");
ok(A.Y.S.words["2:辞書"] && A.Y.S.xp === 140 && A.Y.S.kana.lv.k0 === 2, "A 同步后拿到 B 的进度");

/* ===== 3. 两边各自学：XP 相加，不重复 ===== */
A.Y.addXP(10); A.Y.markWord("2:新聞", true); A.Y.save();
B.Y.addXP(5); B.Y.save();
await A.Y.sync.syncNow("test"); await B.Y.sync.syncNow("test"); await A.Y.sync.syncNow("test");
ok(A.Y.S.xp === 155 && B.Y.S.xp === 155, "两边都是 155 XP：" + A.Y.S.xp + " / " + B.Y.S.xp);
ok(A.Y.S.days[today()] === 15 && B.Y.S.days[today()] === 15, "今天的 XP 也相加：" + A.Y.S.days[today()]);
ok(B.Y.S.words["2:新聞"], "B 拿到 A 新学的单词");

/* ===== 4. 没有变化时再同步：不重复加，不乱写 ===== */
const rev0 = (await serverGet(code)).j.rev;
await A.Y.sync.syncNow("test"); await B.Y.sync.syncNow("test"); await A.Y.sync.syncNow("test");
ok(A.Y.S.xp === 155 && B.Y.S.xp === 155 && (await serverGet(code)).j.rev === rev0, "反复同步：XP 不变，云端版本也不变");

/* ===== 5. 写入时刚好被另一台设备抢先（409）：重新合并后再写 ===== */
A.Y.addXP(7); A.Y.save();
B.Y.addXP(3); B.Y.save();
net.beforePut = () => B.Y.sync.syncNow("test");      /* A 读完、还没写的时候，B 先写了 */
await A.Y.sync.syncNow("test");
await B.Y.sync.syncNow("test");
ok(A.Y.S.xp === 165 && B.Y.S.xp === 165 && (await serverGet(code)).j.data.xp === 165, "抢先写入也不丢、不重复：" + A.Y.S.xp + " / " + B.Y.S.xp);

/* ===== 6. 断网：本机进度不受影响，联网后补传 ===== */
net.down = true;
A.Y.addXP(4); A.Y.save();
const r6 = await A.Y.sync.syncNow("test");
ok(!r6.ok && A.Y.sync.state().err === "net" && A.Y.S.xp === 169, "断网：同步失败，本机进度还在");
net.down = false;
ok((await A.Y.sync.syncNow("test")).ok && (await serverGet(code)).j.data.xp === 169 && A.Y.sync.state().err === "", "联网后补传成功");
await B.Y.sync.syncNow("test");
ok(B.Y.S.xp === 169, "B 也拿到了");

/* ===== 7. 同一台设备开两个页面 + 云端：不会把别的设备的 XP 算两遍 ===== */
const A2 = page_(A.mem);                              /* A 设备上又开了一个页面 */
B.Y.addXP(6); B.Y.save(); await B.Y.sync.syncNow("test");
await A.Y.sync.syncNow("test");                       /* A1 拉到 B 的 +6 */
A2.wh.storage({ key: KEY, newValue: A.mem[KEY] });    /* A2 通过本机存档合并到 A1 的结果 */
A2.Y.addXP(2); A2.Y.save();
await A2.Y.sync.syncNow("test");
await B.Y.sync.syncNow("test");
ok(A2.Y.S.xp === 177 && B.Y.S.xp === 177, "两个页面 + 云端：XP 正确（177）：" + A2.Y.S.xp + " / " + B.Y.S.xp);

/* ===== 8. 云端数据被改坏：不崩溃，本机进度不被破坏 ===== */
{
  const k = await keyOf(code);
  const cur = JSON.parse(server._map.get(k).v);
  await server.setJSON(k, { v: 1, rev: cur.rev + 1, t: Date.now(), data: { xp: "abc", words: { "x": { lv: "zz", due: "?" } }, days: "bad", grammar: 5 } });
  const r8 = await B.Y.sync.syncNow("test");
  ok(r8.ok && B.Y.S.xp >= 177 && B.Y.S.words["1:私"] && B.Y.S.grammar["1-0"], "云端数据异常：照常合并，本机进度不丢");
  await A.Y.sync.syncNow("test");
  ok(A.Y.S.xp >= 177 && (await serverGet(code)).j.data.xp >= 177, "下一次同步把正常进度写回云端");
}

/* ===== 9. 一台设备清空进度：其他设备同步后也清空（会先在本机留备份） ===== */
A.Y.resetProgress(); await A.Y.sync.syncNow("test");
await B.Y.sync.syncNow("test");
ok(B.Y.S.xp === 0 && !B.Y.S.words["1:私"] && B.Y.S.epoch === A.Y.S.epoch, "A 清空进度后，B 同步也清空（纪元一致）");
B.Y.addXP(3); B.Y.save(); await B.Y.sync.syncNow("test"); await A.Y.sync.syncNow("test");
ok(A.Y.S.xp === 3, "清空之后继续正常同步");

/* ===== 10. 加入时输错同步码 ===== */
const C = device(OTHER);
await C.Y.sync.join("ABCD");
ok(!C.Y.sync.state().code && C.Y.S.xp === 40 && C.Y.sync._ui.msg.includes("12 位"), "格式不对：提示，进度不动");
await C.Y.sync.join("2222-3333-4444");
ok(!C.Y.sync.state().code && C.Y.S.xp === 40 && C.Y.sync._ui.msg.includes("找不到"), "同步码不存在：提示，进度不动");

/* ===== 11. 这台设备停止同步；删除云端数据 ===== */
B.Y.sync.stop();
ok(!B.Y.sync.state().code && (await serverGet(code)).status === 200, "B 停止同步：本机不再同步，云端数据还在");
await A.Y.sync.deleteCloud();
ok(!A.Y.sync.state().code && (await serverGet(code)).status === 404 && A.Y.S.xp === 3, "A 删除云端数据：云端没了，本机进度还在");

/* ===== 12. 同步正常时不再催「该存档了」 ===== */
const D = device(OLD);
ok(D.Y.backupDue() === true, "没开同步、很久没存档：提醒");
await D.Y.sync.create();
ok(D.Y.backupDue() === false, "开了同步、刚同步过：不提醒");

/* ===== 13. 网址不支持同步（比如拖文件夹部署的网站、claude.ai 预览）：识别出来，不会误报成网络问题 ===== */
{
  const E = device(OLD, async () => new Response("Not Found", { status: 404 }));
  ok((await E.Y.sync.ping()) === false, "没有同步后台：ping 结果为不可用");
  await E.Y.sync.create();
  ok(!E.Y.sync.state().code && E.Y.sync._ui.avail === false && E.Y.S.xp === 100, "这时点开启同步：不会开启，进度不动");
  const F = device(OLD, async () => { throw new TypeError("Failed to fetch"); });
  ok((await F.Y.sync.ping()) === null, "断网时：先当作「不确定」，不说不支持");
}

/* ===== 14. 先合并了别的设备的进度、上传时又被抢先（合并 + 409 连在一起）：不会把第一次合并的部分算两遍 ===== */
{
  const G = device(OLD); await G.Y.sync.create(); const c2 = G.Y.sync.state().code;
  const H = device(OLD); await H.Y.sync.join(c2); await G.Y.sync.syncNow("test");
  const x0 = G.Y.S.xp;
  ok(H.Y.S.xp === x0, "准备：两台设备进度一致（" + x0 + "）");
  G.Y.addXP(2); G.Y.save();
  H.Y.addXP(1); H.Y.save(); await H.Y.sync.syncNow("test");     /* 云端先有 H 的 +1 */
  H.Y.addXP(4); H.Y.save();
  net.beforePut = () => H.Y.sync.syncNow("test");              /* G 合并完 +1、正要上传时，H 又传了 +4 */
  await G.Y.sync.syncNow("test");
  await H.Y.sync.syncNow("test");
  ok(G.Y.S.xp === x0 + 7 && H.Y.S.xp === x0 + 7, "合并 + 抢先写入：两边都是 +7：" + (G.Y.S.xp - x0) + " / " + (H.Y.S.xp - x0));
}

console.log("sync: " + pass + " 项全部通过");
