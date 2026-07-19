import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCollectorHealthReport } from "../collector/lib/status-report.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const statusPath = process.env.POKECA_STATUS_PATH || path.join(ROOT, "collector-status.json");

function workflowEscape(value = "") {
  return String(value)
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
}

const status = JSON.parse(await fs.readFile(statusPath, "utf8"));
const report = buildCollectorHealthReport(status);

if (process.env.GITHUB_STEP_SUMMARY) {
  await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, report.markdown, "utf8");
} else {
  console.log(report.markdown);
}

for (const annotation of report.annotations) {
  const command = annotation.level === "error" ? "error" : "warning";
  console.log(`::${command} title=${workflowEscape(annotation.title)}::${workflowEscape(annotation.message)}`);
}

process.exitCode = report.exitCode;
