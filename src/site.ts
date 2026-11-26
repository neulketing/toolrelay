import { credentialed, type Catalog, type Env } from "./core.ts";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const REPO = "https://github.com/neulketing/toolrelay";

export function llms(cat: Catalog, env: Env, origin: string) {
  const caps = [...cat.capabilities.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([c, eps]) => `- ${c}: ${eps.map((e) => `${e.id} ($${e.price_usd}${credentialed(e, env) ? "" : ", needs key"})`).join(", ")}`).join("\n");
  return `# toolrelay

> One key, every tool your agent needs. Open-source tool gateway on Cloudflare Workers: search a catalog
> by the task, see the price, run it. Provider keys stay on the server; per-result providers charge nothing for a miss.

Base URL: ${origin}

## Use it
- Search: GET ${origin}/v1/catalog?q=<the job, e.g. "email to profile">
- Inspect: GET ${origin}/v1/catalog/<tool id or capability id>
- Call:   POST ${origin}/v1/call/<tool id or capability id>  body = JSON params, header Authorization: Bearer <key>
  A capability id (e.g. web.scrape) routes over every ready provider, cheapest first; on a miss the next
  provider is tried (free at per-result providers, passed through where "billed" says every call). The reply is {output, cost_usd, served_by, tried}. Report cost_usd to your human.
  Header X-Max-Cost: <usd> caps one call.
- MCP: ${origin}/mcp (streamable HTTP) with tools search_tools, get_tool, call_tool.
${env.OPEN_FREE === "1" ? "- No key? Free tools can be called anonymously here (best-effort rate limit).\n" : ""}
## Capabilities on this deployment
${caps}

## Self-host
Fork ${REPO}, \`npm run deploy\`, add provider keys with \`wrangler secret put\`. MIT.
`;
}

export function landing(cat: Catalog, env: Env, origin: string) {
  const rows = [...cat.endpoints.values()].sort((a, b) => a.capability.localeCompare(b.capability) || a.price_usd - b.price_usd)
    .map((e) => `<tr><td><code>${esc(e.capability)}</code></td><td>${esc(e.provider_name)}</td><td>${esc(e.summary)}</td><td class="num">${e.price_usd === 0 ? "free" : "$" + e.price_usd}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>toolrelay — one key, every tool your agent needs</title>
<meta name="description" content="Open-source tool gateway for AI agents. Name the task, see what it costs, run it. Runs on your own Cloudflare in one command. MIT.">
<style>
:root{--bg:#0b0b0c;--fg:#f2f2f0;--mut:#9a9a96;--line:#26262a;--acc:#ff6b2c;--card:#131316}
@media (prefers-color-scheme: light){:root:not([data-theme="dark"]){--bg:#fafaf8;--fg:#141414;--mut:#5f5f5a;--line:#e3e3de;--card:#fff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:980px;margin:0 auto;padding:56px 16px 80px}
.kick{color:var(--acc);font:600 13px ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase}
h1{font-size:clamp(34px,6vw,60px);line-height:1.04;letter-spacing:-.03em;margin:14px 0 18px}
.lead{font-size:clamp(17px,2.2vw,20px);color:var(--mut);max-width:720px}
.cta{display:flex;gap:12px;flex-wrap:wrap;margin:28px 0 8px}
.btn{display:inline-block;padding:12px 18px;border-radius:10px;border:1px solid var(--line);color:var(--fg);text-decoration:none;font-weight:600}
.btn.p{background:var(--acc);border-color:var(--acc);color:#111}
pre,code{font-family:ui-monospace,Menlo,monospace;font-size:13.5px}
pre{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;overflow:auto}
section{margin-top:56px}h2{font-size:24px;letter-spacing:-.01em;margin:0 0 14px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px}.card b{display:block;margin-bottom:6px}.card p{margin:0;color:var(--mut);font-size:14.5px}
.demo{display:flex;gap:8px;flex-wrap:wrap}.demo input{flex:1;min-width:220px;padding:12px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--fg);font:inherit}
.demo button{padding:12px 18px;border-radius:10px;border:0;background:var(--acc);color:#111;font-weight:700;cursor:pointer}
#out{margin-top:12px;max-height:360px}
.tbl{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px}td,th{border-bottom:1px solid var(--line);padding:9px 8px;text-align:left;vertical-align:top}th{color:var(--mut);font-weight:600}.num{text-align:right;white-space:nowrap}
footer{margin-top:64px;color:var(--mut);font-size:14px}a{color:var(--fg)}
</style></head><body><main>
<div class="kick">open source · MIT · runs on Cloudflare Workers</div>
<h1>One key.<br>Every tool your agent needs.</h1>
<p class="lead">Your agent should not need fourteen signups to look up one person. toolrelay puts every API behind one endpoint: name the task, see what it costs, run it. Provider keys never leave your server. When a provider comes back empty, the next one is tried, and per-result providers charge nothing for the miss.</p>
<div class="cta"><a class="btn p" href="${REPO}">Star on GitHub</a><a class="btn" href="${REPO}#sixty-seconds-to-your-own">Self-host in 60s</a><a class="btn" href="/llms.txt">llms.txt</a></div>

<section><h2>Try it — who is behind this email?</h2>
<div class="demo"><input id="em" value="beau@dentedreality.com.au" aria-label="email"><button id="go">Look up</button></div>
<pre id="out">POST /v1/call/people.profile.from_email</pre></section>

<section><h2>Why toolrelay</h2><div class="grid">
<div class="card"><b>Zero servers</b><p>One Worker, one D1 table. Deploys in a minute on Cloudflare's free plan, answers from 300+ cities.</p></div>
<div class="card"><b>Pay for answers</b><p>Call a capability, not a vendor. toolrelay walks providers cheapest-first; per-result providers cost nothing when they miss.</p></div>
<div class="card"><b>Keys stay home</b><p>Provider credentials are injected server-side. Your agents hold one toolrelay key, revocable in one line.</p></div>
<div class="card"><b>Agent-native</b><p>MCP endpoint, llms.txt and plain HTTP. Claude Code, Codex, Cursor: point them at one URL.</p></div>
<div class="card"><b>A catalog you can read</b><p>Every tool is one JSON file: URL, params, price, what counts as a hit. Add a provider with a pull request.</p></div>
<div class="card"><b>Truly open</b><p>MIT. Host it for yourself, your team or your customers. No hosted-service clause.</p></div>
</div></section>

<section><h2>Sixty seconds</h2>
<pre>git clone ${REPO} && cd toolrelay
npm i && npm run setup      # creates the D1 database and tables
npm run deploy              # your own https://toolrelay.&lt;you&gt;.workers.dev
npx wrangler secret put FIRECRAWL_API_KEY   # each key you add lights up more tools

curl -X POST $URL/v1/call/web.scrape -H "Authorization: Bearer $KEY" -d '{"url":"https://example.com"}'</pre></section>

<section><h2>Catalog (${cat.endpoints.size} tools, ${cat.capabilities.size} capabilities)</h2>
<div class="tbl"><table><thead><tr><th>Capability</th><th>Provider</th><th>What it does</th><th class="num">Per hit</th></tr></thead><tbody>${rows}</tbody></table></div></section>

<footer>Built by <a href="https://azet.io">AZET</a>. <a href="${REPO}">Source</a> · <a href="/v1/catalog">JSON catalog</a> · <a href="/llms.txt">llms.txt</a> · MCP at <code>${esc(origin)}/mcp</code></footer>
</main>
<script>
const go=document.getElementById('go'),out=document.getElementById('out');
go.onclick=async()=>{out.textContent='calling…';try{const r=await fetch('/v1/call/people.profile.from_email',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:document.getElementById('em').value})});out.textContent=JSON.stringify(await r.json(),null,2)}catch(e){out.textContent=String(e)}};
</script></body></html>`;
}
