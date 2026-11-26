// Bundles catalog/*.json into src/catalog.gen.json (Workers cannot read a folder at runtime) and checks each file.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
const dir = new URL("../catalog/", import.meta.url);
const ids = new Set();
const out = readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => {
  const p = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
  if (p.provider + ".json" !== f) throw new Error(`${f}: provider must be "${f.slice(0, -5)}"`);
  for (const e of p.endpoints) {
    for (const k of ["id", "capability", "summary", "method", "url", "params", "price_usd", "hit"]) if (e[k] === undefined) throw new Error(`${f} ${e.id}: missing ${k}`);
    if (ids.has(e.id)) throw new Error(`duplicate id ${e.id}`);
    ids.add(e.id);
  }
  return p;
});
writeFileSync(new URL("../src/catalog.gen.json", import.meta.url), JSON.stringify(out));
console.log(`catalog: ${out.length} providers, ${ids.size} tools`);
