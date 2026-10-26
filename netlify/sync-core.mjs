/* yume 同步码 · 服务器端逻辑（不依赖 Netlify，测试和本地开发服务器直接用）
 *
 * 所有请求都是 POST /api/sync，内容是 JSON：{op, code?, rev?, data?}
 *   ping                      → {ok, v}
 *   create  {data}            → {ok, code, rev:1, t}           生成新的同步码，存第一份进度
 *   get     {code}            → {ok, rev, t, data} | 404        读进度
 *   put     {code, rev, data} → {ok, rev, t} | 409 {rev,t,data} 写进度；rev 必须等于服务器上的版本，否则返回最新的一份让客户端合并后再写
 *   delete  {code}            → {ok}                            删除云端数据
 *
 * 同步码：12 位，只用 2–9 和去掉 I、L、O 的大写字母（31 个字符，约 7.9×10^17 种），不会被猜到。
 * 存储时只用同步码的 SHA-256 做键，存储里看不到同步码本身。
 * store 需要实现 Netlify Blobs 的三个方法：getWithMetadata(key,{type:"json"}) / setJSON(key,value,{onlyIfNew,onlyIfMatch}) / delete(key)。 */

import { webcrypto } from "node:crypto";
const CRYPTO = globalThis.crypto || webcrypto;   /* Node 18 没有全局 crypto */

export const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_LEN = 12;
export const MAX_BODY = 1_000_000;        /* 一份进度最多约 1 MB（正常用户压缩后不到 200 KB） */
export const CREATE_PER_DAY = 30;         /* 同一个 IP 每天最多生成多少个同步码（防止被人拿来乱存东西） */

const JSON_HEAD = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: JSON_HEAD });
const fail = (status, err, extra) => reply(status, Object.assign({ ok: false, err }, extra || {}));
const isObj = x => !!x && typeof x === "object" && !Array.isArray(x);

/* 用户输入的同步码：去掉空格和横线、转大写；格式不对返回 "" */
export function normCode(s) {
  const c = String(s == null ? "" : s).toUpperCase().replace(/[\s\-_.]/g, "");
  if (c.length !== CODE_LEN) return "";
  for (const ch of c) if (!ALPHABET.includes(ch)) return "";
  return c;
}
export function newCode(rand) {
  const out = [];
  while (out.length < CODE_LEN) {
    const buf = new Uint8Array(CODE_LEN * 2);
    (rand || (b => CRYPTO.getRandomValues(b)))(buf);
    for (const b of buf) {
      if (b >= 248) continue;               /* 248 = 31×8：丢掉多出来的部分，每个字符的概率完全一样 */
      out.push(ALPHABET[b % 31]);
      if (out.length === CODE_LEN) break;
    }
  }
  return out.join("");
}
async function sha256hex(s) {
  const d = await CRYPTO.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}
export const keyOf = code => sha256hex("yume-sync:" + code).then(h => "p/" + h);

/* 进度的大致形状（真正的清洗在网页端 merge() 里做）：对象，有数字 xp，有 words 或压缩后的 wz */
function looksLikeProgress(d) {
  if (!isObj(d)) return false;
  if (!isFinite(+d.xp)) return false;
  return isObj(d.words) || isObj(d.wz);
}

/* ip：用来限制每天生成同步码的次数（只存哈希）；now：测试时可以传固定时间 */
export async function handle(req, store, opts) {
  opts = opts || {};
  const now = opts.now ? opts.now() : Date.now();
  if (req.method !== "POST") return fail(405, "method");
  let text;
  try { text = await req.text(); } catch (e) { return fail(400, "body"); }
  if (text.length > MAX_BODY) return fail(413, "toolarge");
  let b;
  try { b = JSON.parse(text); } catch (e) { return fail(400, "json"); }
  if (!isObj(b)) return fail(400, "json");
  const op = String(b.op || "");

  if (op === "ping") return reply(200, { ok: true, v: 1 });

  if (op === "create") {
    if (!looksLikeProgress(b.data)) return fail(400, "data");
    if (opts.ip) {
      const day = new Date(now).toISOString().slice(0, 10);
      const rk = "rl/" + day + "/" + (await sha256hex("yume-rl:" + opts.ip)).slice(0, 32);
      const r = await store.getWithMetadata(rk, { type: "json" });
      const n = r && r.data ? (+r.data.n || 0) : 0;
      if (n >= CREATE_PER_DAY) return fail(429, "toomany");
      await store.setJSON(rk, { n: n + 1 });
    }
    for (let i = 0; i < 3; i++) {
      const code = newCode(opts.rand);
      const rec = { v: 1, rev: 1, t: now, data: b.data };
      const r = await store.setJSON(await keyOf(code), rec, { onlyIfNew: true });
      if (r && r.modified) return reply(200, { ok: true, code, rev: 1, t: now });
    }
    return fail(500, "busy");
  }

  const code = normCode(b.code);
  if (!code) return fail(400, "code");
  const key = await keyOf(code);

  if (op === "get") {
    const r = await store.getWithMetadata(key, { type: "json" });
    if (!r || !isObj(r.data)) return fail(404, "notfound");
    return reply(200, { ok: true, rev: r.data.rev, t: r.data.t, data: r.data.data });
  }

  if (op === "put") {
    if (!looksLikeProgress(b.data)) return fail(400, "data");
    const base = Math.floor(+b.rev);
    if (!(base >= 1)) return fail(400, "rev");
    for (let i = 0; i < 2; i++) {
      const r = await store.getWithMetadata(key, { type: "json" });
      if (!r || !isObj(r.data)) return fail(404, "notfound");
      const cur = r.data;
      if (cur.rev !== base) return fail(409, "conflict", { rev: cur.rev, t: cur.t, data: cur.data });
      const rec = { v: 1, rev: base + 1, t: now, data: b.data };
      const w = await store.setJSON(key, rec, { onlyIfMatch: r.etag });
      if (w && w.modified) return reply(200, { ok: true, rev: rec.rev, t: now });
      /* 读和写之间被别人抢先写了：再读一次，按冲突返回 */
    }
    const r = await store.getWithMetadata(key, { type: "json" });
    if (!r || !isObj(r.data)) return fail(404, "notfound");
    return fail(409, "conflict", { rev: r.data.rev, t: r.data.t, data: r.data.data });
  }

  if (op === "delete") {
    await store.delete(key);
    return reply(200, { ok: true });
  }

  return fail(400, "op");
}

/* 内存里的存储（测试、本地开发服务器用），行为和 Netlify Blobs 一致：etag、onlyIfNew、onlyIfMatch */
export function memoryStore() {
  const m = new Map();
  let n = 0;
  return {
    _map: m,
    async getWithMetadata(k) {
      if (!m.has(k)) return null;
      const e = m.get(k);
      return { data: JSON.parse(e.v), etag: e.etag, metadata: {} };
    },
    async setJSON(k, v, o) {
      o = o || {};
      if (o.onlyIfNew && m.has(k)) return { modified: false };
      if (o.onlyIfMatch && (!m.has(k) || m.get(k).etag !== o.onlyIfMatch)) return { modified: false };
      const etag = '"' + (++n) + '"';
      m.set(k, { v: JSON.stringify(v), etag });
      return { modified: true, etag };
    },
    async delete(k) { m.delete(k); },
  };
}
