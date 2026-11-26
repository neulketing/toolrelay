// Creates the D1 database, writes its id into wrangler.jsonc and applies schema.sql. Safe to run again.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const sh = (c) => execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const cfg = readFileSync("wrangler.jsonc", "utf8");
if (cfg.includes("REPLACE_WITH_SETUP")) {
  let id;
  try { id = sh("npx wrangler d1 create toolrelay").match(/"database_id":\s*"([^"]+)"|database_id\s*=\s*"([^"]+)"/).slice(1).find(Boolean); }
  catch { id = JSON.parse(sh("npx wrangler d1 list --json")).find((d) => d.name === "toolrelay").uuid; }
  writeFileSync("wrangler.jsonc", cfg.replace("REPLACE_WITH_SETUP", id));
  console.log("D1 database:", id);
}
sh("npx wrangler d1 execute toolrelay --remote --file schema.sql");
console.log("tables ready. Next: npm run deploy, then create a key:");
console.log('  curl -X POST $URL/admin/keys -H "Authorization: Bearer $ADMIN_TOKEN" -d \'{"name":"me","credit_usd":5}\'');
