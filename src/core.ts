// toolrelay core: catalog lookup, request building, hit detection, routed waterfall, pricing.
// Pure functions + an injected fetch, so the whole call path is testable without a Worker.

export type Auth =
  | null
  | { type: "header"; name: string; template: string; secret: string; optional?: boolean }
  | { type: "query"; name: string; secret: string; optional?: boolean }
  | { type: "basic"; user_secret: string; pass_secret: string; optional?: boolean };

export type Param = { required?: boolean; in?: "path" | "query" | "body"; to?: string; default?: unknown; transform?: "sha256_email"; raw?: boolean; type?: "number" | "list" };

export type Endpoint = {
  id: string; capability: string; summary: string; method: string; url: string;
  params: Record<string, Param>; body_template?: unknown; price_usd: number;
  cost?: { path: string; usd_per_unit: number }; hit: string; bill?: "hit" | "call"; example?: Record<string, unknown>;
  provider: string; provider_name: string; docs: string; auth: Auth; headers?: Record<string, string>;
};

export type Provider = { provider: string; name: string; docs: string; auth: Auth; headers?: Record<string, string>; endpoints: Omit<Endpoint, "provider" | "provider_name" | "docs" | "auth" | "headers">[] };

export type Catalog = { endpoints: Map<string, Endpoint>; capabilities: Map<string, Endpoint[]> };

export function loadCatalog(providers: Provider[]): Catalog {
  const endpoints = new Map<string, Endpoint>();
  const capabilities = new Map<string, Endpoint[]>();
  for (const p of providers) {
    for (const e of p.endpoints) {
      if (endpoints.has(e.id)) throw new Error(`duplicate endpoint id ${e.id}`);
      if (!e.id.startsWith(p.provider + ".")) throw new Error(`${e.id} must start with ${p.provider}.`);
      const ep: Endpoint = { ...e, provider: p.provider, provider_name: p.name, docs: p.docs, auth: p.auth, headers: p.headers };
      endpoints.set(e.id, ep);
      capabilities.set(e.capability, [...(capabilities.get(e.capability) ?? []), ep]);
    }
  }
  return { endpoints, capabilities };
}

export type Env = Record<string, string | undefined>;

/** Is this endpoint callable with the secrets this deployment holds? */
export function credentialed(ep: Endpoint, env: Env): boolean {
  const a = ep.auth;
  if (!a || a.optional) return true;
  return a.type === "basic" ? !!(env[a.user_secret] && env[a.pass_secret]) : !!env[a.secret];
}

export const priceMicro = (usd: number, markup: number) => Math.ceil(usd * 1e6 * (1 + markup));

/** Upper bound of what one call may cost, used to refuse before spending. */
export const maxPriceUsd = (eps: Endpoint[]) => Math.max(0, ...eps.map((e) => e.price_usd));

export function search(cat: Catalog, q: string, env: Env, limit = 20) {
  const words = q.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  const rows = [...cat.endpoints.values()].map((e) => {
    const hay = `${e.id} ${e.capability} ${e.summary} ${e.provider_name}`.toLowerCase();
    const score = words.length ? words.reduce((s, w) => s + (hay.includes(w) ? (e.capability.includes(w) ? 3 : 1) : 0), 0) : 1;
    return { score, e };
  }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score || a.e.price_usd - b.e.price_usd);
  return rows.slice(0, limit).map(({ e }) => describe(e, env, true));
}

export function describe(e: Endpoint, env: Env, brief = false) {
  const base = { id: e.id, capability: e.capability, summary: e.summary, price_usd: e.price_usd, billed: e.bill === "call" ? "every call" : "hits only", ready: credentialed(e, env) };
  if (brief) return base;
  return { ...base, provider: e.provider_name, method: e.method, params: e.params, docs: e.docs, example: e.example, routed_as: e.capability };
}

export function getPath(obj: unknown, path: string): unknown {
  let cur: any = obj;
  for (const k of path.split(".")) {
    if (cur == null) return undefined;
    cur = cur[k];
  }
  return cur;
}

export function isHit(data: unknown, hit: string): boolean {
  if (hit === "$nonempty") return data != null && (typeof data !== "object" || Object.keys(data as object).length > 0);
  const v = getPath(data, hit);
  if (v == null || v === "" || v === false) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function coerce(v: unknown, p: Param) {
  if (p.type === "number" && typeof v === "string") return Number(v);
  if (p.type === "list" && typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return v;
}

function fill(tpl: unknown, vals: Record<string, unknown>): unknown {
  if (typeof tpl === "string") {
    const m = tpl.match(/^\{(\w+)\}$/);
    if (m) return vals[m[1]];
    return tpl.replace(/\{(\w+)\}/g, (_, k) => String(vals[k] ?? ""));
  }
  if (Array.isArray(tpl)) return tpl.map((t) => fill(t, vals));
  if (tpl && typeof tpl === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(tpl)) { const f = fill(v, vals); if (f !== undefined) out[k] = f; }
    return out;
  }
  return tpl;
}

export class InputError extends Error {}

export async function buildRequest(ep: Endpoint, input: Record<string, unknown>, env: Env): Promise<{ url: string; init: RequestInit }> {
  const vals: Record<string, unknown> = {};
  for (const [name, p] of Object.entries(ep.params)) {
    let v = input[name] ?? p.default;
    if (v === undefined || v === "") { if (p.required) throw new InputError(`missing parameter: ${name}`); continue; }
    v = coerce(v, p);
    if (p.transform === "sha256_email") v = await sha256Hex(String(v).trim().toLowerCase());
    vals[p.to ?? name] = v;
  }
  const query = new URLSearchParams();
  const body: Record<string, unknown> = {};
  let url = ep.url;
  for (const [name, p] of Object.entries(ep.params)) {
    const key = p.to ?? name;
    if (!(key in vals)) continue;
    const where = p.in ?? (ep.body_template ? "template" : "query");
    if (where === "path") url = url.replace(`{${key}}`, p.raw ? String(vals[key]) : encodeURIComponent(String(vals[key])));
    else if (where === "query") query.set(key, Array.isArray(vals[key]) ? (vals[key] as unknown[]).join(",") : String(vals[key]));
    else if (where === "body") body[key] = vals[key];
  }
  if (/\{\w+\}/.test(url)) throw new InputError(`missing path parameter in ${ep.url}`);
  const headers: Record<string, string> = { "User-Agent": "toolrelay/0.1 (+https://github.com/neulketing/toolrelay)", ...(ep.headers ?? {}) };
  const a = ep.auth;
  if (a) {
    if (a.type === "basic") {
      if (env[a.user_secret] && env[a.pass_secret]) headers.Authorization = "Basic " + btoa(`${env[a.user_secret]}:${env[a.pass_secret]}`);
    } else if (env[a.secret]) {
      if (a.type === "header") headers[a.name] = a.template.replace("{key}", env[a.secret]!);
      else query.set(a.name, env[a.secret]!);
    }
  }
  const qs = query.toString();
  if (qs) url += (url.includes("?") ? "&" : "?") + qs;
  const init: RequestInit = { method: ep.method, headers };
  if (ep.method !== "GET") {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(ep.body_template ? fill(ep.body_template, vals) : body);
  }
  return { url, init };
}

export type Attempt = { id: string; outcome: "hit" | "miss" | "error" | "skipped"; status?: number; cost_usd: number; detail?: string };
export type CallResult = { status: number; output: unknown; served_by: string | null; cost_micro: number; tried: Attempt[]; error?: string };

/** Upstream cost of a hit in USD: metered from the reply when the catalog says how, else the list price. */
export function hitCostUsd(ep: Endpoint, data: unknown): number {
  if (ep.cost) {
    const n = Number(getPath(data, ep.cost.path));
    if (Number.isFinite(n) && n >= 0) return n * ep.cost.usd_per_unit;
  }
  return ep.price_usd;
}

/**
 * Call one endpoint, or a capability routed over every credentialed provider, cheapest first.
 * Misses cost nothing unless the provider bills every call (bill: "call"); upstream failures cost nothing; a 4xx other than 429 is the caller's request and stops the route.
 */
export async function call(cat: Catalog, target: string, input: Record<string, unknown>, env: Env, opts: { markup: number; maxCostUsd?: number; fetcher?: typeof fetch; timeoutMs?: number }): Promise<CallResult> {
  if (opts.maxCostUsd != null && !(opts.maxCostUsd >= 0)) throw new Error("maxCostUsd must be a number >= 0");
  const fetcher = opts.fetcher ?? fetch;
  const direct = cat.endpoints.get(target);
  const route = direct ? [direct] : [...(cat.capabilities.get(target) ?? [])].sort((a, b) => a.price_usd - b.price_usd);
  if (!route.length) return { status: 404, output: null, served_by: null, cost_micro: 0, tried: [], error: `unknown tool or capability: ${target}` };
  const tried: Attempt[] = [];
  let lastStatus = 502;
  let missMicro = 0;
  for (const ep of route) {
    if (!credentialed(ep, env)) { tried.push({ id: ep.id, outcome: "skipped", cost_usd: 0, detail: "no credential on this deployment" }); continue; }
    if (opts.maxCostUsd != null && ep.price_usd + missMicro / 1e6 / (1 + opts.markup) > opts.maxCostUsd) { tried.push({ id: ep.id, outcome: "skipped", cost_usd: 0, detail: "over max cost" }); continue; }
    let req;
    try { req = await buildRequest(ep, input, env); }
    catch (e) {
      if (e instanceof InputError) { tried.push({ id: ep.id, outcome: "skipped", cost_usd: 0, detail: e.message }); if (direct) return { status: 400, output: null, served_by: null, cost_micro: 0, tried, error: e.message }; continue; }
      throw e;
    }
    let res: Response;
    try { res = await fetcher(req.url, { ...req.init, signal: AbortSignal.timeout(opts.timeoutMs ?? 25000) }); }
    catch (e) { tried.push({ id: ep.id, outcome: "error", cost_usd: 0, detail: String(e).slice(0, 120) }); continue; }
    const text = await res.text();
    let data: unknown = text;
    try { data = JSON.parse(text); } catch { /* non-JSON stays text */ }
    lastStatus = res.status;
    if (res.status === 429 || res.status >= 500) { tried.push({ id: ep.id, outcome: "error", status: res.status, cost_usd: 0 }); continue; }
    // 404 on a lookup is "nobody there", a miss; any other 4xx is a bad request and ends the route
    if (res.status >= 400 && res.status !== 404) {
      tried.push({ id: ep.id, outcome: "error", status: res.status, cost_usd: 0 });
      return { status: res.status, output: data, served_by: ep.id, cost_micro: 0, tried, error: "upstream rejected the request" };
    }
    const hit = res.status < 400 && (typeof data === "string" ? data.trim().length > 0 : isHit(data, ep.hit));
    if (!hit) {
      // providers that bill every call (bill: "call") charge us for a miss too, so the caller pays it; the rest miss for free
      const missCost = ep.bill === "call" && res.status < 400 ? priceMicro(hitCostUsd(ep, data), opts.markup) : 0;
      tried.push({ id: ep.id, outcome: "miss", status: res.status, cost_usd: missCost / 1e6 });
      missMicro += missCost;
      continue;
    }
    const cost = priceMicro(hitCostUsd(ep, data), opts.markup);
    tried.push({ id: ep.id, outcome: "hit", status: res.status, cost_usd: cost / 1e6 });
    return { status: 200, output: data, served_by: ep.id, cost_micro: cost + missMicro, tried };
  }
  const allMiss = tried.length > 0 && tried.every((t) => t.outcome === "miss" || t.outcome === "skipped");
  const anyRan = tried.some((t) => t.outcome !== "skipped");
  if (!anyRan) return { status: 424, output: null, served_by: null, cost_micro: 0, tried, error: "no provider for this capability is usable on this deployment (add its key, or check parameters)" };
  return { status: allMiss ? 200 : lastStatus, output: null, served_by: null, cost_micro: missMicro, tried, error: allMiss ? undefined : "every provider failed" };
}
