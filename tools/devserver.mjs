/* 本地开发服务器（含「多设备同步」后台）：node tools/devserver.mjs [端口，默认 8790]
 * - 网页：dist/yume-site（先运行 python3 build.py）
 * - POST /api/sync：和线上同一套逻辑（netlify/sync-core.mjs），数据只存在内存里，关掉就没了
 * 想模拟两台设备：用 http://localhost:端口 和 http://127.0.0.1:端口 分别打开，两边的本机存储是分开的。 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handle, memoryStore } from "../netlify/sync-core.mjs";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.join(APP, "dist", "yume-site");
const PORT = +(process.argv[2] || process.env.PORT || 8790);
const store = memoryStore();
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };

if (!fs.existsSync(path.join(ROOT, "index.html"))) {
  console.error("找不到 dist/yume-site/index.html：先运行 python3 build.py");
  process.exit(1);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/sync") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const r = await handle(new Request("http://localhost" + req.url, { method: req.method, body: req.method === "POST" ? Buffer.concat(chunks) : undefined }),
      store, { ip: req.socket.remoteAddress });
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(await r.text());
    return;
  }
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(ROOT, path.normalize(p).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("Not Found"); return; }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`yume 开发服务器：http://localhost:${PORT}/ （同步数据只存在内存里）`));
