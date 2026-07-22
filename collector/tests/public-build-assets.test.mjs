import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();

test("public build includes every local script referenced by index.html", async () => {
  const run = spawnSync(process.execPath, ["scripts/build-public.mjs"], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const html = await fs.readFile(path.join(root, "dist", "index.html"), "utf8");
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']\.\/([^"']+)["']/gi)]
    .map(match => match[1].split(/[?#]/, 1)[0]);
  assert.ok(scripts.includes("remote-feed-core.js"));
  for (const script of scripts) {
    await fs.access(path.join(root, "dist", script));
  }
});
