# Contributing

The fastest way to help is a new provider. It is one JSON file and usually takes under 30 minutes.

1. Pick a provider from the [good first issues](https://github.com/neulketing/toolrelay/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22), or one you already use.
2. Copy `catalog/gravatar.json` (no auth) or `catalog/hunter.json` (API key) to `catalog/<provider>.json`.
3. Fill in the URL, params, `price_usd` from the provider's public pricing, and `hit`: the dot path that is non-empty when the call found something.
4. If the provider charges for every call, found or not, add `"bill": "call"` to the endpoint.
5. Run `npm test`, then `npm run dev` and call your tool once against the real API:
   `curl -X POST localhost:8787/v1/call/<your.tool.id> -H "Authorization: Bearer <key>" -d '<example>'`
6. Open a PR with the command you ran and the `tried` line from the reply.

Capability names are `area.thing.action`, for example `people.email.find`. Reuse an existing capability when
your provider does the same job, so it joins that route.

Bugs and ideas: open an issue. Security problems: report them privately from the repo's Security tab instead of opening an issue.
