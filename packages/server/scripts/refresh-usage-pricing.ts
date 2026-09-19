/**
 * Regenerates the built-in price snapshot from LiteLLM. Run it before a release
 * (see `docs/release.md`); it is not part of CI and nothing commits for you.
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  LITELLM_LICENSE_URL,
  LITELLM_PRICING_URL,
  slimPricingTable,
} from "../src/server/usage/pricing/table.js";

const SNAPSHOT_PATH = fileURLToPath(
  new URL("../src/server/usage/pricing/snapshot.json", import.meta.url),
);
const LICENSE_PATH = fileURLToPath(new URL("../src/server/usage/pricing/LICENSE", import.meta.url));

const response = await fetch(LITELLM_PRICING_URL);
if (!response.ok) {
  throw new Error(`Price table request failed with ${response.status}`);
}
const table = slimPricingTable(await response.json(), {
  source: LITELLM_PRICING_URL,
  fetchedAt: new Date().toISOString(),
  etag: response.headers.get("etag"),
});

const license = await fetch(LITELLM_LICENSE_URL);
if (!license.ok) {
  throw new Error(`License request failed with ${license.status}`);
}

await writeFile(SNAPSHOT_PATH, `${JSON.stringify(table)}\n`, "utf8");
await writeFile(LICENSE_PATH, await license.text(), "utf8");
console.log(
  `Wrote ${Object.keys(table.models).length} models to ${SNAPSHOT_PATH} (etag ${table._meta.etag ?? "none"})`,
);
