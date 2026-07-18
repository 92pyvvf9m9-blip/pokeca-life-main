import fs from "node:fs/promises";
import { parseXPost } from "./x-parser.mjs";

const API_BASE = "https://api.x.com/2/tweets/search/recent";

async function readJson(path, fallback) {
  try {
    return JSON.parse(await fs.readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

function accountQueries(accounts = []) {
  const batches = [];
  for (let i = 0; i < accounts.length; i += 6) {
    const group = accounts.slice(i, i + 6);
    const fromClause = group.map((account) => `from:${account.username}`).join(" OR ");
    batches.push(`(${fromClause}) (ポケカ OR ポケモンカード) (抽選 OR 招待リクエスト OR 応募 OR 予約) -is:retweet lang:ja`);
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

export async function collectXLotteryCandidates({ configPath, bearerToken, privateAccountsJson = "" }) {
  const config = await readJson(configPath, { queries: [], accounts: [], officialAccounts: [] });
  let privateAccounts = [];
  try { const parsed = JSON.parse(privateAccountsJson || "[]"); if (Array.isArray(parsed)) privateAccounts = parsed; } catch {}
  const officialAccounts = (config.officialAccounts || []).map((account) =>
    typeof account === "string" ? { username: account, official: true } : { ...account, official: true }
  );
  const accounts = [...(config.accounts || []), ...officialAccounts, ...privateAccounts];
  const knownAccounts = new Set(accounts.map((account) => String(account.username || account || "").toLowerCase()));
  const accountMetadata = new Map();
  for (const account of accounts) {
    const normalized = typeof account === "string" ? { username: account } : account;
    const username = String(normalized.username || "").toLowerCase();
    if (!username) continue;
    accountMetadata.set(username, {
      ...normalized,
      official: Boolean(normalized.official || officialAccounts.some((item) => String(item.username || "").toLowerCase() === username)),
    });
  }

  if (!bearerToken) {
    return {
      items: [],
      meta: {
        status: "not_configured",
        accountCount: knownAccounts.size,
        officialAccountCount: officialAccounts.length,
        queryCount: 0,
        postCount: 0,
        itemCount: 0,
      },
    };
  }

  const queries = [
    ...(config.queries || []),
    ...accountQueries(accounts.map((account) => typeof account === "string" ? { username: account } : account)),
  ];

  const posts = new Map();
  const users = new Map();
  let failedQueries = 0;

  for (const query of queries) {
    try {
      const payload = await searchRecentPosts(query, bearerToken);
      for (const user of payload?.includes?.users || []) {
        users.set(String(user.id), user);
      }
      for (const post of payload?.data || []) {
        posts.set(String(post.id), post);
      }
    } catch (error) {
      failedQueries += 1;
      console.error("X query failed", error);
    }

    await new Promise((resolve) => setTimeout(resolve, 600));
  }

  const items = [];
  for (const post of posts.values()) {
    const user = users.get(String(post.author_id)) || {};
    const item = parseXPost(post, user, knownAccounts, accountMetadata);
    if (!item) continue;
    const products = Array.isArray(item.productCandidates) && item.productCandidates.length
      ? item.productCandidates
      : [item.product];
    for (const product of [...new Set(products)].slice(0, 12)) {
      items.push({
        ...item,
        externalId: `${item.externalId}-${Buffer.from(String(product)).toString("base64url").slice(0, 16)}`,
        product,
      });
    }
  }

  return {
    items,
    meta: {
      status: failedQueries === queries.length && queries.length ? "error" : "ok",
      accountCount: knownAccounts.size,
      officialAccountCount: officialAccounts.length,
      queryCount: queries.length,
      failedQueries,
      postCount: posts.size,
      itemCount: items.length,
    },
  };
}
