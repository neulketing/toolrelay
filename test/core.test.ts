import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCatalog, call, buildRequest, isHit, search, type Provider } from "../src/core.ts";
import real from "../src/catalog.gen.json" with { type: "json" };

const providers: Provider[] = [
  { provider: "cheap", name: "Cheap", docs: "", auth: { type: "header", name: "x-key", template: "{key}", secret: "CHEAP_KEY" }, endpoints: [
    { id: "cheap.find", capability: "people.email.find", summary: "s", method: "GET", url: "https://cheap.test/find", params: { name: { required: true, in: "query" } }, price_usd: 0.01, hit: "email" }] },
  { provider: "dear", name: "Dear", docs: "", auth: { type: "query", name: "api_key", secret: "DEAR_KEY" }, endpoints: [
    { id: "dear.find", capability: "people.email.find", summary: "s", method: "GET", url: "https://dear.test/find", params: { name: { required: true, in: "query" } }, price_usd: 0.03, hit: "data.email" }] },
  { provider: "nokey", name: "NoKey", docs: "", auth: { type: "header", name: "x", template: "{key}", secret: "ABSENT" }, endpoints: [
    { id: "nokey.find", capability: "people.email.find", summary: "s", method: "GET", url: "https://nokey.test/find", params: {}, price_usd: 0.001, hit: "email" }] },
  { provider: "meter", name: "Meter", docs: "", auth: null, endpoints: [
    { id: "meter.judge", capability: "ai.judge", summary: "s", method: "POST", url: "https://meter.test/j", params: { state: { required: true, in: "body" } }, price_usd: 0.0005, cost: { path: "usage.input_tokens", usd_per_unit: 0.000000042 }, hit: "answers" }] },
];
const cat = loadCatalog(providers);
const env = { CHEAP_KEY: "c", DEAR_KEY: "d" };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function fake(routes: Record<string, () => Response>) {
  const seen: string[] = [];
  const f = (async (url: string, init: RequestInit) => { seen.push(url + " " + JSON.stringify(init.headers)); const host = new URL(url).host; return routes[host] ? routes[host]() : reply(500, {}); }) as unknown as typeof fetch;
  return { f, seen };
}

test("routed call: a miss is free and the next provider's hit is billed with markup", async () => {
  const { f, seen } = fake({ "cheap.test": () => reply(200, { email: null }), "dear.test": () => reply(200, { data: { email: "a@b.co" } }) });
  const r = await call(cat, "people.email.find", { name: "Ann" }, env, { markup: 0.05, fetcher: f });
  assert.equal(r.served_by, "dear.find");
  assert.equal(r.cost_micro, Math.ceil(0.03 * 1e6 * 1.05));
  assert.deepEqual(r.tried.map((t) => [t.id, t.outcome, t.cost_usd]), [["nokey.find", "skipped", 0], ["cheap.find", "miss", 0], ["dear.find", "hit", 0.0315]]);
  assert.match(seen[0], /"x-key":"c"/);           // header credential injected
  assert.match(seen[1], /api_key=d/);               // query credential injected
});

test("all providers miss: 200, nothing billed", async () => {
  const { f } = fake({ "cheap.test": () => reply(404, {}), "dear.test": () => reply(200, { data: {} }) });
  const r = await call(cat, "people.email.find", { name: "Ann" }, env, { markup: 0, fetcher: f });
  assert.equal(r.status, 200); assert.equal(r.cost_micro, 0); assert.equal(r.served_by, null);
});

test("429/5xx falls through, a 400 stops the route unbilled", async () => {
  let { f } = fake({ "cheap.test": () => reply(429, {}), "dear.test": () => reply(200, { data: { email: "x@y.z" } }) });
  assert.equal((await call(cat, "people.email.find", { name: "A" }, env, { markup: 0, fetcher: f })).served_by, "dear.find");
  ({ f } = fake({ "cheap.test": () => reply(400, { error: "bad" }), "dear.test": () => reply(200, { data: { email: "x@y.z" } }) }));
  const r = await call(cat, "people.email.find", { name: "A" }, env, { markup: 0, fetcher: f });
  assert.equal(r.status, 400); assert.equal(r.cost_micro, 0);
});

test("max cost skips providers above the cap", async () => {
  const { f } = fake({ "cheap.test": () => reply(200, { email: null }), "dear.test": () => reply(200, { data: { email: "x@y.z" } }) });
  const r = await call(cat, "people.email.find", { name: "A" }, env, { markup: 0, maxCostUsd: 0.02, fetcher: f });
  assert.equal(r.served_by, null); assert.equal(r.tried.at(-1)!.detail, "over max cost");
});

test("metered cost settles on the reply's usage", async () => {
  const { f } = fake({ "meter.test": () => reply(200, { answers: { q: { noul: 0.9 } }, usage: { input_tokens: 1000 } }) });
  const r = await call(cat, "meter.judge", { state: "x" }, env, { markup: 0, fetcher: f });
  assert.equal(r.cost_micro, Math.ceil(1000 * 0.042));
});

test("direct call with a missing parameter is a 400", async () => {
  const r = await call(cat, "cheap.find", {}, env, { markup: 0, fetcher: fake({}).f });
  assert.equal(r.status, 400);
});

test("a bill:call provider's miss is charged, then the next hit adds on", async () => {
  const pc: Provider[] = [
    { provider: "percall", name: "P", docs: "", auth: null, endpoints: [{ id: "percall.s", capability: "web.search", summary: "s", method: "GET", url: "https://pc.test/", params: {}, price_usd: 0.005, hit: "results.0", bill: "call" }] },
    { provider: "later", name: "L", docs: "", auth: null, endpoints: [{ id: "later.s", capability: "web.search", summary: "s", method: "GET", url: "https://l.test/", params: {}, price_usd: 0.01, hit: "results.0" }] }];
  const { f } = fake({ "pc.test": () => reply(200, { results: [] }), "l.test": () => reply(200, { results: [1] }) });
  const r = await call(loadCatalog(pc), "web.search", {}, {}, { markup: 0, fetcher: f });
  assert.equal(r.cost_micro, 5000 + 10000);
  assert.deepEqual(r.tried.map((t) => t.cost_usd), [0.005, 0.01]);
});

test("isHit", () => {
  assert.equal(isHit({ a: [] }, "a"), false);
  assert.equal(isHit({ a: [1] }, "a.0"), true);
  assert.equal(isHit({}, "$nonempty"), false);
  assert.equal(isHit({ bitcoin: { usd: 1 } }, "$nonempty"), true);
});

test("real catalog loads and builds requests", async () => {
  const rc = loadCatalog(real as Provider[]);
  const g = await buildRequest(rc.endpoints.get("gravatar.profile.from_email")!, { email: " Beau@DentedReality.com.au " }, {});
  assert.match(g.url, /^https:\/\/api\.gravatar\.com\/v3\/profiles\/[0-9a-f]{64}$/);
  const j = await buildRequest(rc.endpoints.get("jina.read")!, { url: "https://example.com/a?b=1" }, {});
  assert.equal(j.url, "https://r.jina.ai/https://example.com/a?b=1");
  const d = await buildRequest(rc.endpoints.get("dataforseo.keywords.volume")!, { keywords: "a, b" }, { DATAFORSEO_LOGIN: "u", DATAFORSEO_PASSWORD: "p" });
  assert.deepEqual(JSON.parse(String(d.init.body)), [{ keywords: ["a", "b"], location_code: 2840, language_code: "en" }]);
  assert.equal((d.init.headers as Record<string, string>).Authorization, "Basic " + btoa("u:p"));
  assert.ok(search(rc, "email profile", {}).some((r) => r.id === "gravatar.profile.from_email"));
});
