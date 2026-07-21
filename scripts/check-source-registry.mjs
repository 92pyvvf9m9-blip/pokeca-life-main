import fs from "node:fs/promises";
import path from "node:path";
import { normalizeSourceRegistry, summarizeSourceRegistry } from "../collector/lib/source-registry.mjs";

const root = process.cwd();
const sourcePath = process.env.POKECA_SOURCES_PATH || path.join(root, ".private", "sources.json");

let payload;
try {
  payload = JSON.parse(await fs.readFile(sourcePath, "utf8"));
} catch (error) {
  console.error(`Source registry could not be read: ${error.message}`);
  process.exit(1);
}

const registry = normalizeSourceRegistry(payload);
const summary = summarizeSourceRegistry(registry);
console.log(JSON.stringify(summary, null, 2));
for (const warning of registry.warnings) console.warn(`WARNING: ${warning}`);
for (const error of registry.errors) console.error(`ERROR: ${error}`);

if (!summary.enabledCount) {
  console.error("ERROR: enabled source is zero");
  process.exitCode = 1;
} else if (registry.errors.length) {
  process.exitCode = 1;
}
