import fs from "node:fs/promises";
import { parseXPost } from "./x-parser.mjs";
import { buildStoreIndex } from "./location.mjs";
import { isLivePocketUrl, parseLivePocketPage } from "./livepocket-parser.mjs";

const API_BASE = "https://api.x.com/2/tweets/search/recent";

async function readJson(path, fallback) {
  try {
    return JSON.parse(await fs.readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

function normalizedAccounts(accounts = []) {
  const map = new Map();
  for (const raw of accounts) {
    const account = typeof raw === "string" ? { username: raw } : raw || {};
    const username = String(account.username || "").replace(/^@/, "").trim();
    if (!username) continue;
    map.set(username.toLowerCase(), { ...account, username });
  }
  return [...map.values()];
}

function accountQueries(accounts = []) {
  const batches = [];
  for (let i = 0; i < accounts.length; i += 6) {
    const group = accounts.slice(i, i + 6);
    const fromClause = group.map((account) => `from:${account.username}`).join(" OR ");
    batches.push(
      `(${fromClause}) (ポケカ OR ポケモンカード OR 拡張パック OR ハイクラスパック OR スタートデッキ OR MEGA OR LivePocket OR ライブポケット) (抽選 OR 招待リクエスト OR 応募 OR 予約 OR 受付 OR 申込 OR エントリー) -is:retweet lang:ja`
    );
  }
  return batches;
}

async function searchRecentPosts(query, bearerToken) {
  const params = new URLSearchParams({
    query,
    max_results: "100",
    "tweet.fields": "created_at,entities,author_id",
    expansions: "author_id",
    "user.fields": "username,name",
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${API_BASE}?${params}`, {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`X API HTTP ${response.status}: ${body.slice(0, 200)}`);
    }
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchDestinationHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PokecaLifeCollector/1.15; +https://github.com/)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "ja,en;q=0.5",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { html: await response.text(), finalUrl: response.url || url };
  } finally {
    clearTimeout(timer);
  }
}

function prefer(value, fallback) {
  return value == null || value === "" ? fallback : value;
}

function mergeDestinationDetails(item, page) {
  if (!page?.ok) return item;
  const genericShop = /LivePocket掲載店舗|X情報/.test(page.shop || "");
  return {
    ...item,
    shop: genericShop ? item.shop : prefer(page.shop, item.shop),
    product: prefer(page.product, item.product),
    type: prefer(page.type, item.type),
    area: prefer(page.area, item.area),
    url: prefer(page.url, item.url),
    applyStartDate: prefer(page.applyStartDate, item.applyStartDate),
    applyStartTime: prefer(page.applyStartTime, item.applyStartTime),
    applyEndDate: prefer(page.applyEndDate, item.applyEndDate),
    applyEndTime: prefer(page.applyEndTime, item.applyEndTime),
    resultStartDate: prefer(page.resultStartDate, item.resultStartDate),
    resultStartTime: prefer(page.resultStartTime, item.resultStartTime),
    resultEndDate: prefer(page.resultEndDate, item.resultEndDate),
    resultEndTime: prefer(page.resultEndTime, item.resultEndTime),
    purchaseStartDate: prefer(page.purchaseStartDate, item.purchaseStartDate),
    purchaseStartTime: prefer(page.purchaseStartTime, item.purchaseStartTime),
    purchaseEndDate: prefer(page.purchaseEndDate, item.purchaseEndDate),
    purchaseEndTime: prefer(page.purchaseEndTime, item.purchaseEndTime),
    rawApplyText: prefer(page.rawApplyText, item.rawApplyText),
    rawResultText: prefer(page.rawResultText, item.rawResultText),
    confidence: Number(Math.min(0.99, Number(item.confidence || 0) + 0.12).toFixed(2)),
    verified: true,
  };
}

export async function collectXLotteryCandidates({
  configPath,
  bearerToken,
  privateAccountsJson = "",
  storeMasterPath = "",
  maxDestinationPages = 50,
}) {
  const config = await readJson(configPath, { queries: [], accounts: [] });
  const storeMaster = storeMasterPath ? await readJson(storeMasterPath, { stores: [] }) : { stores: [] };
  const storeIndex = buildStoreIndex(storeMaster);

  let privateAccounts = [];
  try {
    const parsed = JSON.parse(privateAccountsJson || "[]");
    if (Array.isArray(parsed)) privateAccounts = parsed;
  } catch {
    // Invalid optional secret: continue with the private config bundle.
  }

  const accounts = normalizedAccounts([...(config.accounts || []), ...privateAccounts]);
  const knownAccounts = new Set(accounts.map((account) => account.username.toLowerCase()));

  if (!bearerToken) {
    return {
      items: [],
      meta: {
        status: "not_configured",
        accountCount: knownAccounts.size,
        queryCount: 0,
        postCount: 0,
        itemCount: 0,
        destinationPageCount: 0,
      },
    };
  }

  const queries = [...new Set([...(config.queries || []), ...accountQueries(accounts)].map((value) => String(value || "").trim()).filter(Boolean))];
  const posts = new Map();
  const users = new Map();
  let failedQueries = 0;

  for (const query of queries) {
    try {
      const payload = await searchRecentPosts(query, bearerToken);
      for (const user of payload?.includes?.users || []) users.set(String(user.id), user);
      for (const post of payload?.data || []) posts.set(String(post.id), post);
    } catch (error) {
      failedQueries += 1;
      console.error("X query failed", error);
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
  }

  const baseItems = [];
  for (const post of posts.values()) {
    const user = users.get(String(post.author_id)) || {};
    const item = parseXPost(post, user, knownAccounts, { storeIndex });
    if (item) baseItems.push(item);
  }

  const destinationCache = new Map();
  let destinationPageCount = 0;
  let destinationSuccessCount = 0;
  const items = [];

  for (const item of baseItems) {
    if (!isLivePocketUrl(item.url) || destinationPageCount >= maxDestinationPages) {
      items.push(item);
      continue;
    }

    destinationPageCount += 1;
    try {
      let payload = destinationCache.get(item.url);
      if (!payload) {
        payload = await fetchDestinationHtml(item.url);
        destinationCache.set(item.url, payload);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      const page = parseLivePocketPage({
        html: payload.html,
        url: payload.finalUrl,
        fallbackShop: item.shop,
        collectedAt: item.collectedAt,
        storeIndex,
      });
      if (page.ok) destinationSuccessCount += 1;
      items.push(mergeDestinationDetails(item, page));
    } catch (error) {
      console.error(`LivePocket destination parse failed: ${item.url}`, error);
      items.push(item);
    }
  }

  return {
    items,
    meta: {
      status: failedQueries === queries.length && queries.length ? "error" : "ok",
      accountCount: knownAccounts.size,
      queryCount: queries.length,
      failedQueries,
      postCount: posts.size,
      itemCount: items.length,
      destinationPageCount,
      destinationSuccessCount,
    },
  };
}
