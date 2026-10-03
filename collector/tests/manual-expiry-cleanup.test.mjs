import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

function runNode(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, options);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", chunk => { stdout += chunk; });
    child.stderr?.on("data", chunk => { stderr += chunk; });
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

test("collector prunes expired and deleted manual lotteries but keeps valid listings without result dates", { timeout: 20_000 }, async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "pokeca-manual-expiry-"));
  const files = Object.fromEntries([
    "sources", "feed", "status", "review", "quality", "manual", "state", "x",
  ].map(name => [name, path.join(temp, `${name}.json`)]));
  const now = "2026-10-03T00:00:00.000Z";

  await fs.writeFile(files.sources, JSON.stringify({ sources: [] }));
  const deletedUrl = "https://select-type.com/e/?id=6x-Pc1sW6QM";
  await fs.writeFile(files.feed, JSON.stringify({ version: 1, lotteries: [{
    externalId: deletedUrl,
    shop: "遠方店舗",
    product: "30th CELEBRATION カードセット（9種セット）",
    status: "open",
    url: deletedUrl,
    applyEndDate: "2026-10-04",
    purchaseEndDate: "2026-10-18",
    verified: true,
    qualityVersion: 2,
    manualEntry: true,
  }] }));
  await fs.writeFile(files.review, JSON.stringify({ items: [] }));
  await fs.writeFile(files.state, JSON.stringify({ version: 1, sources: {} }));
  await fs.writeFile(files.x, JSON.stringify({ accounts: [] }));
  await fs.writeFile(files.manual, JSON.stringify({
    version: 5,
    updatedAt: "2026-07-20T00:00:00.000Z",
    lotteries: [
      { id: "expired", shop: "古い店舗", product: "30th CELEBRATION カードセット", applyEndDate: "2026-07-01", resultStartDate: "2026-07-03", purchaseEndDate: "2026-07-06" },
      { id: "current", shop: "ホビーステーション広島店", product: "拡張パック 30th CELEBRATION", applyEndDate: "2026-10-04", purchaseEndDate: "2026-10-18", url: "https://livepocket.jp/e/7r2ey" },
      { id: "announced", shop: "ポケモンセンターオンライン", product: "拡張パック 30th CELEBRATION BOX", announcedUpcoming: true, announcementOnly: true, announcementUrl: "https://www.pokemoncenter-online.com/news/?id=20260929" },
      { id: "history", shop: "ポケモンセンターオンライン", product: "30th CELEBRATION カードセット（9種セット・第3回）", historyOnly: true, applyEndDate: "2026-09-16", purchaseEndDate: "2026-10-06" },
    ],
    deleted: [`url:${deletedUrl}`],
  }));

  try {
    const result = await runNode(["collector/collector.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        POKECA_NOW: now,
        POKECA_SOURCES_PATH: files.sources,
        POKECA_FEED_PATH: files.feed,
        POKECA_STATUS_PATH: files.status,
        POKECA_REVIEW_PATH: files.review,
        POKECA_QUALITY_STATUS_PATH: files.quality,
        POKECA_MANUAL_LOTTERIES_PATH: files.manual,
        POKECA_DISCOVERY_STATE_PATH: files.state,
        POKECA_X_SOURCES_PATH: files.x,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    assert.equal(result.code, 0, result.stderr || result.stdout || result.signal);
    const manual = JSON.parse(await fs.readFile(files.manual, "utf8"));
    assert.deepEqual(manual.lotteries.map(item => item.id), ["current", "announced", "history"]);
    assert.equal(manual.updatedAt, now);
    const status = JSON.parse(await fs.readFile(files.status, "utf8"));
    assert.equal(status.expiredManualPrunedCount, 1);
    const feed = JSON.parse(await fs.readFile(files.feed, "utf8"));
    assert.ok(feed.lotteries.some(item => item.id === "current"), "a direct application listing does not require a result date");
    assert.ok(feed.lotteries.some(item => item.id === "announced"), "an official schedule notice remains visible without dates");
    assert.ok(feed.lotteries.some(item => item.id === "history"), "recent closed history remains available");
    assert.ok(!feed.lotteries.some(item => item.externalId === deletedUrl), "a deleted manual item is not resurrected from the previous feed");
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
