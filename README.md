<div align="center">

# toolrelay

### One key. Every tool your agent needs.

**The open-source tool gateway for AI agents.** Name the task, see what it costs, run it.<br>
Provider keys stay on your server. You pay for answers. Runs on Cloudflare's free plan in one command.

[**Live demo**](https://toolrelay.azet.io) · [llms.txt](https://toolrelay.azet.io/llms.txt) · [MCP](#mcp) · [Add a provider](#add-a-provider-in-one-json-file) · [한국어](README.ko.md)

![license](https://img.shields.io/badge/license-MIT-black) ![runtime](https://img.shields.io/badge/runtime-Cloudflare%20Workers-f38020) ![mcp](https://img.shields.io/badge/MCP-ready-6b4cff) ![servers](https://img.shields.io/badge/servers-zero-2ea44f)

</div>

---

Your agent wants to look up one person. Today that means a Hunter account, an Apollo seat, a scraping
subscription, three API keys pasted into three `.env` files, and a prompt that hopes the agent picks the
right one.

**toolrelay replaces all of it with one URL.**

```bash
curl -X POST https://toolrelay.azet.io/v1/call/people.profile.from_email \
  -d '{"email":"beau@dentedreality.com.au"}'
```
```json
{ "output": { "display_name": "Beau Lebens", "profile_url": "https://gravatar.com/beau", "...": "..." },
  "cost_usd": 0, "served_by": "gravatar.profile.from_email",
  "tried": [ { "id": "gravatar.profile.from_email", "outcome": "hit" } ] }
```

## Why toolrelay

| | |
|---|---|
| **Name the task, skip the vendor hunt** | Call `web.scrape`, `people.email.find`, `serp.google`. toolrelay walks every provider you hold a key for, cheapest first. |
| **Pay for answers** | A per-result provider that finds nothing costs `$0`, and the next one is tried. |
| **Keys never leave the server** | Credentials are injected at the edge. Agents hold one revocable toolrelay key with a prepaid balance. |
| **Zero servers** | One Worker + one D1 database. Deploys in under a minute, answers from 300+ cities, fits the free plan. |
| **Agent-native** | MCP endpoint, `llms.txt`, plain HTTP. Point Claude Code, Codex or Cursor at one URL. |
| **A catalog you can read** | Every provider is one JSON file: URL, params, price, what counts as a hit. No SDK per vendor. |
| **Actually open** | MIT. Run it for yourself, your team, or your customers. No hosted-service clause. |

## Sixty seconds to your own

```bash
git clone https://github.com/neulketing/toolrelay && cd toolrelay
npm i
npm run setup                          # creates the D1 database + tables
npx wrangler secret put ADMIN_TOKEN    # 32+ characters
npm run deploy                         # https://toolrelay.<you>.workers.dev

# a key for your agent, with $5 of balance
curl -X POST "$TOOLRELAY/admin/keys" -H "Authorization: Bearer <admin token>" -d '{"name":"my-agent","credit_usd":5}'
```

Every provider key you add lights up more tools:

```bash
npx wrangler secret put FIRECRAWL_API_KEY
npx wrangler secret put EXA_API_KEY
npx wrangler secret put HUNTER_API_KEY
```

## The API

| | |
|---|---|
| `GET /v1/catalog?q=scrape a page` | Search tools by the job. Each row says its price and whether it is `ready` (key present). |
| `GET /v1/catalog/<id>` | Params, price and an example. A capability id lists every provider behind it. |
| `POST /v1/call/<id>` | Call a tool id, or a **capability id** to route. Body = JSON params. Header `X-Max-Cost: 0.05` caps one call. |
| `GET /v1/balance` | The key's remaining balance. |
| `POST /mcp` | MCP over streamable HTTP. |
| `GET /llms.txt` | Instructions an agent reads once to use the whole catalog. |

Every call answers `{ output, cost_usd, served_by, tried }`. `output` is the provider's response, verbatim:
toolrelay passes the provider's response through untouched, so nothing breaks when a provider changes its schema.

### Routing rules

1. Providers for the capability, cheapest first, skipping any without a key on this deployment.
2. `2xx` with a hit: billed (`price × (1 + MARKUP)`), done.
3. `2xx` without a hit, or `404`: **miss**, next provider. A miss is **$0** at providers that bill per result;
   providers that bill every call are marked `"bill": "call"` in the catalog and pass that cost through, so nobody runs at a loss.
4. `429`, `5xx`, timeout: $0, next provider.
5. Any other `4xx`: your request is wrong; stop, $0.
6. Metered tools (like Jev) settle on the usage the provider reports, not the list price.

Balances are micro-USD and debited with a conditional update, so two racing calls can never overdraw a key.

## MCP

```json
{ "mcpServers": { "toolrelay": { "type": "http", "url": "https://toolrelay.azet.io/mcp",
  "headers": { "Authorization": "Bearer tr_..." } } } }
```

Three tools: `search_tools`, `get_tool`, `call_tool`. That is the whole surface; the catalog does the rest.

## Catalog

| Capability | Providers | Per hit |
|---|---|---|
| `people.profile.from_email` | Gravatar | free |
| `people.email.find` / `people.email.verify` | Hunter † | $0.034 / $0.017 |
| `people.search.developers` | GitHub | free |
| `social.profile.github` / `social.profile.bluesky` | GitHub, Bluesky | free |
| `web.scrape` | Jina Reader, Firecrawl | free / $0.00083 |
| `web.search` | Exa † | $0.005 |
| `serp.google` / `keywords.volume` | DataForSEO † | $0.002 / $0.075 |
| `ai.judge` | TypeSafe Jev | metered (~$0.00002) |
| `news.search` | Hacker News | free |
| `knowledge.summary` | Wikipedia | free |
| `company.domain.registration` | RDAP | free |
| `weather.current` | Open-Meteo | free |
| `crypto.price` | CoinGecko | free |

Prices are estimates from each provider's pricing at the time of writing; check before relying on them, and set `MARKUP` to resell. Rows marked † have not been called against the live provider yet.

## Add a provider in one JSON file

```json
{
  "provider": "acme",
  "name": "Acme",
  "docs": "https://acme.dev/docs",
  "auth": { "type": "header", "name": "Authorization", "template": "Bearer {key}", "secret": "ACME_API_KEY" },
  "endpoints": [{
    "id": "acme.email.find",
    "capability": "people.email.find",
    "summary": "Work email from name + domain",
    "method": "GET",
    "url": "https://api.acme.dev/v1/find",
    "params": { "domain": { "required": true, "in": "query" }, "name": { "required": true, "in": "query" } },
    "price_usd": 0.01,
    "hit": "data.email"
  }]
}
```

Save it as `catalog/acme.json`, run `npm test`, open a PR. The new provider joins the `people.email.find`
route automatically, ordered by price. `auth.type` is `header`, `query` or `basic`; `hit` is a dot path that
must be non-empty for the call to bill.

## Security

- Provider keys live only in Worker secrets; responses never echo them.
- Caller keys are stored as SHA-256 hashes and shown once.
- Admin routes need a 32+ character token, compared in constant time.
- Anonymous mode (`OPEN_FREE=1`) reaches free tools only. Its per-IP limit uses the Cloudflare rate-limiting binding, which is per location and eventually consistent: it slows sustained abuse but lets short bursts through.

## License

MIT © [AZET](https://azet.io). Built for agents that do real work.
