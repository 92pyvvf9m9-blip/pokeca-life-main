import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { collectXLotteryCandidates } from "../lib/x-collector.mjs";

test("X collector includes officialAccounts in queries and marks official store notices", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pokeca-x-"));
  const configPath = path.join(dir, "x.json");
  await fs.writeFile(configPath, JSON.stringify({
    queries: [],
    accounts: [],
    officialAccounts: [{
      username: "bic_test",
      label: "ビックカメラテスト店",
      area: "広島県",
    }],
  }));

  const originalFetch = globalThis.fetch;
  let requestedQuery = "";
  globalThis.fetch = async (url) => {
    requestedQuery = new URL(url).searchParams.get("query") || "";
    return new Response(JSON.stringify({
      data: [{
        id: "123",
        author_id: "42",
        created_at: "2026-03-01T00:00:00.000Z",
        text: "ポケモンカード 拡張パック『ニンジャスピナー』抽選受付 店頭にて受付 締切3月5日まで",
        entities: { urls: [] },
      }],
      includes: { users: [{ id: "42", username: "bic_test", name: "ビックカメラテスト店" }] },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const result = await collectXLotteryCandidates({ configPath, bearerToken: "test" });
    assert.match(requestedQuery, /from:bic_test/);
    assert.equal(result.meta.accountCount, 1);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].officialAccount, true);
    assert.equal(result.items[0].noticeOnly, true);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
