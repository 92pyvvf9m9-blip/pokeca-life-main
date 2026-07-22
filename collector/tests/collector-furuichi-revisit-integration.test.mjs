import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
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
    child.on("close", code => resolve({ code, stdout, stderr }));
  });
}

test("collector revisits a vanished Furuichi article and replaces the grouped previous feed", { timeout: 20_000 }, async () => {
  const ocr = await fs.readFile(new URL("../fixtures/furuichi-20260714-ocr.txt", import.meta.url), "utf8");
  const server = http.createServer((request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    if (request.url === "/news/news_information/pk20260713") {
      response.end(`<html><body><pre data-pokeca-ocr="true">${ocr}</pre></body></html>`);
      return;
    }
    response.end(`<html><body><a href="/news/unrelated">一般のお知らせ</a></body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "pokeca-furuichi-"));
  const files = {
    sources: path.join(temp, "sources.json"),
    feed: path.join(temp, "lottery-feed.json"),
    status: path.join(temp, "collector-status.json"),
    review: path.join(temp, "review.json"),
    quality: path.join(temp, "quality.json"),
    manual: path.join(temp, "manual.json"),
    state: path.join(temp, "discovery-state.json"),
    x: path.join(temp, "x.json"),
  };
  await fs.writeFile(files.sources, JSON.stringify({ sources: [{
    id: "furuichi",
    name: "古本市場（ふるいち）",
    url: `${origin}/news/`,
    parser: "furuichi-news",
    type: "通販",
    area: "全国",
    officialDomains: ["127.0.0.1"],
    discovery: { enabled: true, includePatterns: ["stale-never-match"], requiredPathPatterns: ["/obsolete/"] },
  }] }));
  await fs.writeFile(files.feed, JSON.stringify({ version: 1, lotteries: [
    { verified: true, qualityVersion: 2, shop: "古本市場（ふるいち）", product: "スターターセットex 3種", applyEndDate: "2026-07-18", resultStartDate: "2026-07-22", purchaseEndDate: "2026-08-02", url: `${origin}/news/news_information/pk20260713`, collectedAt: "2026-07-18T00:00:00.000Z" },
    { verified: true, qualityVersion: 2, shop: "古本市場（ふるいち）", product: "スターターセットex 3種", applyEndDate: "2026-07-19", resultStartDate: "2026-07-22", purchaseEndDate: "2026-08-02", url: `${origin}/news/news_information/pk20260713`, collectedAt: "2026-07-19T00:00:00.000Z" },
  ] }));
  await fs.writeFile(files.manual, JSON.stringify({ lotteries: [] }));
  await fs.writeFile(files.state, JSON.stringify({ version: 1, sources: {} }));
  await fs.writeFile(files.x, JSON.stringify({ accounts: [] }));

  try {
    const result = await runNode(["collector/collector.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
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
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const feed = JSON.parse(await fs.readFile(files.feed, "utf8"));
    const products = feed.lotteries.map(item => item.product).sort();
    assert.deepEqual(products, [
      "スターターセットex イーブイex",
      "スターターセットex ゾロア＆ゾロアークex",
      "スターターセットex ニャオハ＆マスカーニャex",
      "拡張パック ストームエメラルダ",
    ].sort());
    assert.ok(feed.lotteries.every(item => item.applyEndDate === "2026-07-19"));
    const status = JSON.parse(await fs.readFile(files.status, "utf8"));
    assert.equal(status.sourceDiagnostics[0].officialRevisitItemCount, 4);
    assert.equal(status.quality.replacedPreviousCount, 2);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(temp, { recursive: true, force: true });
  }
});
