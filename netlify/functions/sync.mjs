/* yume 同步码 · Netlify 后台程序：POST /api/sync（协议见 ../sync-core.mjs）
 * 数据存在 Netlify Blobs。正式网站用 "yume-sync"；预览部署用 "yume-sync-preview"，测试数据不会混进正式数据。 */
import { getStore } from "@netlify/blobs";
import { handle } from "../sync-core.mjs";

export default async (req, context) => {
  const live = !!(context && context.deploy && context.deploy.published);
  const store = getStore({ name: live ? "yume-sync" : "yume-sync-preview", consistency: "strong" });
  try {
    return await handle(req, store, { ip: context && context.ip });
  } catch (e) {
    console.error("[sync]", e);
    return new Response(JSON.stringify({ ok: false, err: "server" }), {
      status: 500, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
};

export const config = { path: "/api/sync", method: ["POST"] };
