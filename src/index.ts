// toolrelay Worker: one key, every tool. Catalog search, metered calls with a routed waterfall, an MCP endpoint and llms.txt.
import providers from "./catalog.gen.json";
import { loadCatalog, search, describe, call, type Provider, type Env as CoreEnv } from "./core.ts";
import { landing, llms } from "./site.ts";

type Env = CoreEnv & {
  DB?: D1Database;
  RL?: { limit(o: { key: string }): Promise<{ success: boolean }> };
  MARKUP?: string; OPEN_FREE?: string; ADMIN_TOKEN?: string;
};

const cat = loadCatalog(providers as Provider[]);
const VERSION = "0.1.0";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", ...headers } });
const fail = (status: number, message: string) => json({ error: message }, status);

async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

type Key = { id: string; name: string; balance_micro: number };

async function keyFrom(req: Request, env: Env): Promise<Key | null> {
  const tok = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!tok || !env.DB) return null;
  return await env.DB.prepare("SELECT id, name, balance_micro FROM keys WHERE hash = ? AND disabled = 0").bind(await sha256(tok)).first<Key>();
}

/** Runs a call for a caller: a key pays from its balance; without a key only free tools, rate-limited, when OPEN_FREE=1. */
async function metered(req: Request, env: Env, target: string, input: Record<string, unknown>, maxCostHeader?: string | null) {
  const markup = Number(env.MARKUP ?? "0");
  const key = await keyFrom(req, env);
  const hasAuth = !!req.headers.get("authorization");
  if (!key) {
    if (hasAuth) return { status: 401, body: { error: "invalid key" } };
    if (env.OPEN_FREE !== "1") return { status: 401, body: { error: "a key is required: Authorization: Bearer <key>" } };
    const ip = req.headers.get("cf-connecting-ip") ?? "anon";
    if (env.RL && !(await env.RL.limit({ key: ip })).success) return { status: 429, body: { error: "anonymous rate limit: 30 calls a minute. Self-host for unlimited." } };
  }
  const budgetUsd = key ? key.balance_micro / 1e6 / (1 + markup) : 0;
  const cap = maxCostHeader != null && maxCostHeader !== "" ? Math.min(Number(maxCostHeader), budgetUsd) : budgetUsd;
  const route = cat.endpoints.get(target) ? [cat.endpoints.get(target)!] : cat.capabilities.get(target) ?? [];
  if (key && cap <= 0 && route.length && route.every((e) => e.price_usd > 0)) return { status: 402, body: { error: "insufficient balance" } };
  if (!key && route.length && route.every((e) => e.price_usd > 0)) return { status: 401, body: { error: "this tool is paid: send Authorization: Bearer <key>" } };
  const r = await call(cat, target, input, env, { markup, maxCostUsd: cap });
  if (key && r.cost_micro > 0 && env.DB) {
    // conditional debit: a race between two calls can never push the balance under zero
    const upd = await env.DB.prepare("UPDATE keys SET balance_micro = balance_micro - ?1 WHERE id = ?2 AND balance_micro >= ?1").bind(r.cost_micro, key.id).run();
    if (!upd.meta.changes) return { status: 402, body: { error: "insufficient balance" } };
  }
  if (env.DB) {
    await env.DB.prepare("INSERT INTO calls (key_id, target, served_by, outcome, status, cost_micro, ts) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(key?.id ?? null, target, r.served_by, r.served_by ? "hit" : r.error ? "error" : "miss", r.status, r.cost_micro, Date.now()).run();
  }
  return { status: r.status, body: { output: r.output, cost_usd: r.cost_micro / 1e6, served_by: r.served_by, tried: r.tried, ...(r.error ? { error: r.error } : {}) } };
}

async function readInput(req: Request, url: URL): Promise<Record<string, unknown>> {
  const input: Record<string, unknown> = Object.fromEntries(url.searchParams);
  if (req.method === "POST") {
    const t = await req.text();
    if (t) { const b = JSON.parse(t); if (b && typeof b === "object" && !Array.isArray(b)) Object.assign(input, b); }
  }
  return input;
}

function catalogGet(id: string, env: Env) {
  const ep = cat.endpoints.get(id);
  if (ep) return describe(ep, env);
  const caps = cat.capabilities.get(id);
  if (caps) return { capability: id, routed: true, note: "call this id and toolrelay tries each ready provider, cheapest first; misses are free", providers: [...caps].sort((a, b) => a.price_usd - b.price_usd).map((e) => describe(e, env)) };
  return null;
}

// --- MCP (streamable HTTP, JSON responses) ---
const MCP_TOOLS = [
  { name: "search_tools", description: "Find tools by the job you need done (e.g. 'email to profile', 'google serp', 'scrape url'). Returns ids, prices and whether each is ready.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "get_tool", description: "Parameters, price and an example for a tool id, or every provider behind a capability id.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "call_tool", description: "Call a tool id, or a capability id to route over providers (misses cost nothing). Report cost_usd to the user.", inputSchema: { type: "object", properties: { id: { type: "string" }, params: { type: "object" }, max_cost_usd: { type: "number" } }, required: ["id"] } },
];

async function mcp(req: Request, env: Env) {
  let msg: any;
  try { msg = await req.json(); } catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400); }
  if (Array.isArray(msg)) return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "batches are not supported" } }, 400);
  const reply = (result: unknown) => json({ jsonrpc: "2.0", id: msg.id, result });
  const text = (v: unknown, isError = false) => reply({ content: [{ type: "text", text: JSON.stringify(v, null, 2) }], isError });
  if (msg.id === undefined) return new Response(null, { status: 202 }); // notifications
  switch (msg.method) {
    case "initialize": return reply({ protocolVersion: msg.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "toolrelay", version: VERSION } });
    case "ping": return reply({});
    case "tools/list": return reply({ tools: MCP_TOOLS });
    case "tools/call": {
      const a = msg.params?.arguments ?? {};
      if (msg.params?.name === "search_tools") return text(search(cat, String(a.query ?? ""), env));
      if (msg.params?.name === "get_tool") { const g = catalogGet(String(a.id ?? ""), env); return g ? text(g) : text({ error: "unknown id" }, true); }
      if (msg.params?.name === "call_tool") {
        const r = await metered(req, env, String(a.id ?? ""), a.params ?? {}, a.max_cost_usd != null ? String(a.max_cost_usd) : null);
        return text(r.body, r.status >= 400);
      }
      return json({ jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: "unknown tool" } });
    }
    default: return json({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } });
  }
}

async function admin(req: Request, env: Env, path: string) {
  const tok = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 32 || !safeEqual(tok, env.ADMIN_TOKEN)) return fail(403, "forbidden");
  if (!env.DB) return fail(501, "no database bound");
  const b: any = await req.json().catch(() => ({}));
  if (path === "/admin/keys" && req.method === "POST") {
    const raw = "tr_" + [...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, "0")).join("");
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO keys (id, name, hash, balance_micro, disabled, created) VALUES (?, ?, ?, ?, 0, ?)")
      .bind(id, String(b.name ?? "key"), await sha256(raw), Math.round(Number(b.credit_usd ?? 0) * 1e6), Date.now()).run();
    return json({ id, key: raw, note: "shown once" });
  }
  if (path === "/admin/credit" && req.method === "POST") {
    await env.DB.prepare("UPDATE keys SET balance_micro = balance_micro + ? WHERE id = ?").bind(Math.round(Number(b.credit_usd) * 1e6), String(b.id)).run();
    return json({ ok: true });
  }
  return fail(404, "not found");
}

const SEC = {
  "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY",
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (req.method === "OPTIONS") return new Response(null, { headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, x-max-cost", "access-control-allow-methods": "GET, POST" } });
      if (p === "/") return new Response(landing(cat, env, url.origin), { headers: { "content-type": "text/html; charset=utf-8", ...SEC } });
      if (p === "/llms.txt") return new Response(llms(cat, env, url.origin), { headers: { "content-type": "text/plain; charset=utf-8" } });
      if (p === "/health") return json({ ok: true, version: VERSION, tools: cat.endpoints.size, capabilities: cat.capabilities.size });
      if (p === "/v1/catalog") return json(url.searchParams.get("q") ? search(cat, url.searchParams.get("q")!, env, Number(url.searchParams.get("limit") ?? 20)) : [...cat.capabilities.keys()].sort().map((c) => ({ capability: c, providers: cat.capabilities.get(c)!.length })));
      if (p.startsWith("/v1/catalog/")) { const g = catalogGet(decodeURIComponent(p.slice(12)), env); return g ? json(g) : fail(404, "unknown id"); }
      if (p.startsWith("/v1/call/") && (req.method === "GET" || req.method === "POST")) {
        let input;
        try { input = await readInput(req, url); } catch { return fail(400, "body must be a JSON object"); }
        const r = await metered(req, env, decodeURIComponent(p.slice(9)), input, req.headers.get("x-max-cost"));
        return json(r.body, r.status, { "x-cost-usd": String((r.body as any).cost_usd ?? 0) });
      }
      if (p === "/v1/balance") { const k = await keyFrom(req, env); return k ? json({ name: k.name, balance_usd: k.balance_micro / 1e6 }) : fail(401, "invalid key"); }
      if (p === "/mcp" && req.method === "POST") return mcp(req, env);
      if (p.startsWith("/admin/")) return admin(req, env, p);
      return fail(404, "not found");
    } catch (e) {
      console.log("toolrelay error", String(e).slice(0, 300));
      return fail(500, "internal error");
    }
  },
};
