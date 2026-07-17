/**
 * Pokeca Life URL Reader API
 * Cloudflare Workers (module syntax)
 *
 * POST /  { "url": "https://livepocket.jp/e/..." }
 * GET  /health
 */

const ALLOWED_HOSTS = new Set([
  'livepocket.jp',
  'www.livepocket.jp',
  't.livepocket.jp',
  'imageflux.livepocket.jp',
]);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Pokeca-Admin-Key',
  'Access-Control-Max-Age': '86400',
};

const PREFECTURES = [
  '北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県',
  '新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県',
  '奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県',
  '熊本県','大分県','宮崎県','鹿児島県','沖縄県',
];

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function normalizeTarget(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('URLがありません');
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('HTTPSのURLだけ対応しています');
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) throw new Error('LivePocketのURLではありません');
  if (!/^\/e\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) throw new Error('LivePocketの応募ページURLではありません');
  url.hash = '';
  return url.toString();
}

function decodeHtmlEntities(input) {
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    yen: '¥', copy: '©', reg: '®', hellip: '…', middot: '・',
  };
  return String(input || '')
    .replace(/&#(x?[0-9a-f]+);?/gi, (_, code) => {
      const base = code[0].toLowerCase() === 'x' ? 16 : 10;
      const value = parseInt(base === 16 ? code.slice(1) : code, base);
      return Number.isFinite(value) ? String.fromCodePoint(value) : _;
    })
    .replace(/&([a-z]+);/gi, (all, key) => named[key.toLowerCase()] ?? all);
}

function decodeEscapes(input) {
  return String(input || '')
    .replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\r\\n|\\n|\\r/g, '\n')
    .replace(/\\\//g, '/')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'");
}

function stripTags(html) {
  return decodeHtmlEntities(
    String(html || '')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/section|\/article|\/h[1-6]|\/tr|\/dt|\/dd)>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '・')
      .replace(/<[^>]+>/g, ' '),
  );
}

function cleanLine(value) {
  return decodeHtmlEntities(decodeEscapes(value))
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .trim();
}

function normalizeText(value) {
  const seen = new Set();
  const lines = String(value || '')
    .replace(/\r/g, '\n')
    .split(/\n+/)
    .map(cleanLine)
    .filter(line => line && line.length <= 1000)
    .filter(line => {
      const key = line.replace(/\s+/g, ' ');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return lines.join('\n');
}

function metaContent(html, key, attr = 'property') {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+${attr}=["']${escaped}["'][^>]+content=["']([\\s\\S]*?)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([\\s\\S]*?)["'][^>]+${attr}=["']${escaped}["'][^>]*>`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return cleanLine(match[1]);
  }
  return '';
}

function htmlTitle(html) {
  return cleanLine(metaContent(html, 'og:title') || metaContent(html, 'twitter:title', 'name') || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
}

function collectStructuredStrings(html) {
  const values = [];
  const pushValue = value => {
    if (typeof value === 'string') {
      const cleaned = cleanLine(value);
      if (cleaned && cleaned.length < 5000) values.push(cleaned);
      return;
    }
    if (Array.isArray(value)) return value.forEach(pushValue);
    if (value && typeof value === 'object') Object.values(value).forEach(pushValue);
  };

  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { pushValue(JSON.parse(decodeHtmlEntities(match[1]))); } catch {}
  }

  const nextData = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (nextData) {
    try { pushValue(JSON.parse(decodeHtmlEntities(nextData))); } catch {}
  }

  // New LivePocket embeds event data in JavaScript. Keep only scripts that contain useful Japanese labels.
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const decoded = decodeEscapes(decodeHtmlEntities(match[1]));
    if (!/応募期間|応募受付|当選発表|結果発表|購入制限|購入期間|ポケモンカード|販売元|主催者/.test(decoded)) continue;
    const readable = decoded
      .replace(/[{}[\],]/g, '\n')
      .replace(/(?:"|')([\w$.-]+)(?:"|')\s*:/g, '$1: ')
      .replace(/["']/g, '')
      .slice(0, 150000);
    values.push(readable);
  }

  return values.join('\n');
}

function buildReadableText(html) {
  const withoutScripts = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');
  const visible = stripTags(withoutScripts);
  const structured = collectStructuredStrings(html);
  return normalizeText(`${structured}\n${visible}`);
}

function compact(value) {
  return cleanLine(value)
    .replace(/^Title\s*:\s*/i, '')
    .replace(/\s*[|｜]\s*LivePocket.*$/i, '')
    .replace(/のチケット情報.*$/i, '')
    .replace(/抽選会のお知らせ|抽選販売のお知らせ|抽選受付のお知らせ|予約受付のお知らせ/g, '')
    .replace(/^[「『]|[」』]$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function lineCandidates(text) {
  return normalizeText(text).split('\n').map(cleanLine).filter(Boolean);
}

function candidateQuality(line) {
  const value = compact(line);
  if (!value) return -9999;
  let score = 0;
  if (/ポケモンカードゲーム/.test(value)) score += 80;
  else if (/ポケモンカード/.test(value)) score += 55;
  if (/MEGA|スカーレット|バイオレット|ソード|シールド|サン|ムーン/i.test(value)) score += 12;
  if (/拡張パック|強化拡張パック|ハイクラスパック|スタートデッキ|スターターセット|プレミアムトレーナーボックス|スペシャルセット|デッキビルドBOX|BOX/i.test(value)) score += 55;
  if (/抽選会のお知らせ|抽選販売のお知らせ|抽選受付のお知らせ|予約受付のお知らせ/.test(line)) score += 4;
  if (/注意事項|応募期間|受付期間|当選発表|結果発表|購入制限|購入期間|お問い合わせ|Each person|apply for one BOX|Language|イベント検索/i.test(value)) score -= 180;
  if (/\.\.\.|…/.test(value)) score -= 100;
  if (value.length < 10) score -= 30;
  if (value.length > 220) score -= 40;
  score += Math.min(value.length, 120) / 8;
  return score;
}

function extractProductCore(value) {
  let product = compact(value);
  const quoted = product.match(/[「『]([^」』]{3,220})[」』]/)?.[1];
  if (quoted && /ポケモンカード|拡張パック|デッキ|BOX/i.test(quoted)) product = quoted;
  product = product
    .replace(/^.*?(?=ポケモンカードゲーム|ポケモンカード|拡張パック|強化拡張パック|ハイクラスパック|スタートデッキ|スターターセット|プレミアムトレーナーボックス|スペシャルセット|デッキビルドBOX)/, '')
    .replace(/\s*(?:抽選会のお知らせ|抽選販売のお知らせ|抽選受付のお知らせ|予約受付のお知らせ).*$/g, '')
    .replace(/\s*[|｜]\s*.*$/g, '')
    .trim();
  return product.slice(0, 220);
}

function findProduct(text, title = '') {
  const rawCandidates = [
    ...lineCandidates(text),
    title,
  ].map(cleanLine).filter(Boolean);

  // A truncated meta title must never beat a complete title found in the page body.
  const ranked = rawCandidates
    .map((raw, index) => ({ raw, product: extractProductCore(raw), score: candidateQuality(raw), index }))
    .filter(item => item.product && /ポケモンカード|拡張パック|デッキ|BOX/i.test(item.product))
    .sort((a, b) => b.score - a.score || b.product.length - a.product.length || a.index - b.index);

  const complete = ranked.find(item => !/\.\.\.|…/.test(item.product));
  return (complete || ranked[0])?.product || '';
}

function normalizeShopCandidate(value) {
  return compact(value)
    .replace(/^(?:販売元|主催者|主催|開催店舗|販売店舗|受取店舗|対象店舗)\s*[:：]?\s*/i, '')
    .replace(/\s*(?:ポケモンカードゲーム|ポケモンカード|抽選会のお知らせ|抽選販売のお知らせ).*$/i, '')
    .replace(/[|｜].*$/g, '')
    .trim();
}

function shopQuality(value) {
  const line = normalizeShopCandidate(value);
  if (!line || line.length > 120) return -9999;
  let score = 0;
  const chain = /古本市場|ふるいち|フタバ図書|TSUTAYA|蔦屋書店|BOOKOFF|ブックオフ|カードラボ|ホビーステーション|ホビステ|レプトン|駿河屋|ゲオ|GEO|イオン|ヤマダデンキ|ジョーシン|エディオン|ビックカメラ|トイザらス|カードボックス|晴れる屋2|ドラゴンスター|ポケモンセンター/i;
  if (chain.test(line)) score += 60;
  if (/店|店舗|センター|本店|支店/.test(line)) score += 35;
  if (/販売元|主催者|開催店舗|販売店舗|受取店舗|対象店舗/.test(value)) score += 50;
  if (/ポケモンカード|拡張パック|抽選|応募期間|当選発表|注意事項/i.test(line)) score -= 120;
  if (/\.\.\.|…/.test(line)) score -= 100;
  score += Math.min(line.length, 80) / 3;
  return score;
}

function findShop(text, title = '') {
  const lines = lineCandidates(normalizeText(`${text}\n${title}`));
  const candidates = [];
  const push = value => {
    const normalized = normalizeShopCandidate(value);
    if (normalized && !candidates.includes(normalized)) candidates.push(normalized);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const inline = line.match(/(?:販売元|主催者|主催|開催店舗|販売店舗|受取店舗|対象店舗)\s*[:：]?\s*(.{2,120})/i)?.[1];
    if (inline) push(inline);
    if (/^(?:販売元|主催者|主催|開催店舗|販売店舗|受取店舗|対象店舗)\s*[:：]?$/.test(line)) push(lines[i + 1] || '');

    // Keep the entire line, not only the first chain-name fragment.
    if (/古本市場|ふるいち|フタバ図書|TSUTAYA|蔦屋書店|BOOKOFF|ブックオフ|カードラボ|ホビーステーション|ホビステ|レプトン|駿河屋|ゲオ|GEO|イオン|ヤマダデンキ|ジョーシン|エディオン|ビックカメラ|トイザらス|カードボックス|晴れる屋2|ドラゴンスター|ポケモンセンター/i.test(line)) {
      push(line);
    }
  }

  return candidates
    .map(value => ({ value, score: shopQuality(value) }))
    .sort((a, b) => b.score - a.score || b.value.length - a.value.length)[0]?.value || '';
}

function section(text, labels, nextLabels) {
  const flat = normalizeText(text).replace(/\n+/g, ' ');
  const start = `(?:【|\\[|〔)?(?:${labels})(?:】|\\]|〕)?\\s*[:：]?\\s*`;
  const end = nextLabels ? `(?=(?:【|\\[|〔)?(?:${nextLabels})(?:】|\\]|〕)?\\s*[:：]?|$)` : '$';
  const match = flat.match(new RegExp(`${start}([\\s\\S]*?)${end}`, 'i'));
  return cleanLine(match?.[1] || '');
}

function pad2(value) { return String(value).padStart(2, '0'); }

function dateTokens(value) {
  const source = String(value || '').replace(/[：﹕]/g, ':').replace(/[〜～]/g, '〜');
  const result = [];
  const pattern = /(?:(20\d{2})\s*[年\/.\-]\s*)?(\d{1,2})\s*[月\/.\-]\s*(\d{1,2})\s*日?(?:\s*[（(][^）)]*[）)])?\s*(?:(\d{1,2})\s*:\s*(\d{2}))?/g;
  let match;
  let inheritedYear = '';
  while ((match = pattern.exec(source))) {
    if (match[1]) inheritedYear = match[1];
    const year = match[1] || inheritedYear;
    if (!year) continue;
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = match[4] === undefined ? '' : Number(match[4]);
    const minute = match[5] === undefined ? '' : Number(match[5]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    result.push({
      date: `${year}-${pad2(month)}-${pad2(day)}`,
      time: hour === '' ? '' : `${pad2(hour)}:${pad2(minute)}`,
    });
  }
  return result;
}

function datesFromSection(value, mode = 'range') {
  const tokens = dateTokens(value);
  if (!tokens.length) return { startDate: '', startTime: '', endDate: '', endTime: '' };
  if (mode === 'point') {
    return { startDate: tokens[0].date, startTime: tokens[0].time, endDate: '', endTime: '' };
  }
  return {
    startDate: tokens[0].date,
    startTime: tokens[0].time,
    endDate: tokens[tokens.length - 1].date,
    endTime: tokens[tokens.length - 1].time,
  };
}

export function parseLivePocketFromText(text, url = '', title = '') {
  const normalized = normalizeText(text);
  const product = findProduct(normalized, title);
  const shop = findShop(normalized, title);

  const applyText = section(
    normalized,
    '応募期間|応募受付期間|応募受付|受付期間|申込期間|お申し込み期間',
    '当選発表|結果発表|抽選結果|購入制限|購入期間|購入期限|注意事項|お問い合わせ',
  );
  const resultText = section(
    normalized,
    '当選発表|結果発表|抽選結果|当落発表|当選通知',
    '購入制限|購入期間|購入期限|受取期間|注意事項|お問い合わせ',
  );
  const purchaseText = section(
    normalized,
    '購入制限|購入期間|購入期限|受取期間|受け取り期間|引取期間',
    '注意事項|お問い合わせ',
  );

  const apply = datesFromSection(applyText, 'range');
  const result = datesFromSection(resultText, 'point');
  const purchase = datesFromSection(purchaseText, 'range');
  const locationSource = `${shop}\n${title}\n${normalized}`;
  const area = PREFECTURES.find(prefecture => locationSource.includes(prefecture)) || '全国';

  const data = {
    shop,
    product,
    url,
    applyStartDate: apply.startDate,
    applyStartTime: apply.startTime,
    applyEndDate: apply.endDate || apply.startDate,
    applyEndTime: apply.endTime || apply.startTime,
    resultStartDate: result.startDate,
    resultStartTime: result.startTime,
    resultEndDate: '',
    resultEndTime: '',
    resultNote: /予定/.test(resultText) ? '予定' : '',
    purchaseStartDate: purchase.startDate,
    purchaseStartTime: purchase.startTime,
    purchaseEndDate: purchase.endDate || purchase.startDate,
    purchaseEndTime: purchase.endTime || purchase.startTime,
    type: '店舗',
    area,
    memo: 'LivePocket専用APIから自動取得',
  };

  const missing = [];
  if (!data.shop) missing.push('店舗名');
  if (!data.product) missing.push('商品名');
  if (!data.applyEndDate) missing.push('応募締切');
  if (!data.resultStartDate) missing.push('結果発表');

  return { data, missing, sections: { applyText, resultText, purchaseText } };
}

async function fetchLivePocket(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.6,en;q=0.4',
      'Cache-Control': 'no-cache',
    },
    cf: { cacheTtl: 60, cacheEverything: false },
  });
  if (!response.ok) throw new Error(`LivePocket取得失敗（HTTP ${response.status}）`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) throw new Error('HTMLページを取得できませんでした');
  const html = await response.text();
  if (html.length < 200) throw new Error('ページ本文が空です');
  if (html.length > 4_000_000) throw new Error('ページが大きすぎます');
  return { html, finalUrl: response.url || url };
}


function normalizeHttpsUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function utf8ToBase64(value) {
  const bytes = new TextEncoder().encode(String(value));
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function base64ToUtf8(value) {
  const binary = atob(String(value || '').replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function cleanShort(value, max = 300) {
  return cleanLine(value).slice(0, max);
}

function normalizeManualLottery(input) {
  const now = new Date().toISOString();
  const item = input && typeof input === 'object' ? input : {};
  const normalized = {
    externalId: cleanShort(item.externalId || item.remoteId || '', 160),
    shop: cleanShort(item.shop, 120),
    product: cleanShort(item.product, 180),
    type: item.type === '通販' ? '通販' : '店舗',
    area: cleanShort(item.area || '全国', 20) || '全国',
    status: 'open',
    url: normalizeHttpsUrl(item.url),
    applyStartDate: cleanShort(item.applyStartDate, 10),
    applyStartTime: cleanShort(item.applyStartTime, 5),
    applyEndDate: cleanShort(item.applyEndDate || item.deadline, 10),
    applyEndTime: cleanShort(item.applyEndTime, 5),
    resultStartDate: cleanShort(item.resultStartDate || item.resultDate, 10),
    resultStartTime: cleanShort(item.resultStartTime, 5),
    resultEndDate: cleanShort(item.resultEndDate, 10),
    resultEndTime: cleanShort(item.resultEndTime, 5),
    resultNote: cleanShort(item.resultNote, 100),
    purchaseStartDate: cleanShort(item.purchaseStartDate, 10),
    purchaseStartTime: cleanShort(item.purchaseStartTime, 5),
    purchaseEndDate: cleanShort(item.purchaseEndDate || item.purchaseDeadline, 10),
    purchaseEndTime: cleanShort(item.purchaseEndTime, 5),
    destinationType: cleanShort(item.destinationType || 'direct', 30),
    appName: cleanShort(item.appName, 100),
    appUrl: normalizeHttpsUrl(item.appUrl),
    fallbackUrl: normalizeHttpsUrl(item.fallbackUrl),
    instructions: cleanShort(item.instructions, 2000),
    memo: cleanShort(item.memo, 2000),
    manualEntry: true,
    adminPublished: true,
    verified: true,
    confidence: 0.99,
    collectedAt: item.collectedAt || item.createdAt || now,
    createdAt: item.createdAt || now,
    updatedAt: now,
  };

  if (!normalized.externalId) {
    normalized.externalId = normalized.url || `${normalized.shop}|${normalized.product}|${normalized.applyEndDate}`;
  }
  if (!normalized.shop) throw new Error('店舗名がありません');
  if (!normalized.product) throw new Error('商品名がありません');
  if (!normalized.applyEndDate) throw new Error('応募締切日がありません');
  if (!normalized.resultStartDate) throw new Error('結果発表日がありません');
  if (!normalized.url) throw new Error('応募URLが正しくありません');
  return normalized;
}

function manualIdentity(item) {
  return String(
    item?.externalId ||
    normalizeHttpsUrl(item?.url || '') ||
    `${item?.shop || ''}|${item?.product || ''}|${item?.applyEndDate || item?.deadline || ''}`
  );
}

function githubSettings(env) {
  const owner = cleanShort(env.GITHUB_OWNER || '', 100);
  const repo = cleanShort(env.GITHUB_REPO || '', 100);
  const branch = cleanShort(env.GITHUB_BRANCH || 'main', 100) || 'main';
  const token = String(env.POKECA_GITHUB_TOKEN || '').trim();
  if (!owner || !repo || !token) throw new Error('Cloudflare側のGitHub保存設定が未完了です');
  return { owner, repo, branch, token };
}

function githubFileUrl(settings) {
  return `https://api.github.com/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repo)}/contents/manual-lotteries.json`;
}

async function githubRequest(settings, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${settings.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'Pokeca-Life-Worker',
      ...(options.headers || {}),
    },
  });
  if (response.status === 404 && options.allowNotFound) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = response.status === 401
      ? 'Cloudflareに登録したGitHubトークンが無効です'
      : response.status === 403
        ? 'GitHubトークンにContents書き込み権限がありません'
        : response.status === 409
          ? '別の更新と競合しました。もう一度保存してください'
          : response.status === 404
            ? 'GitHubリポジトリまたはmanual-lotteries.jsonを確認してください'
            : (payload?.message || `GitHub API ${response.status}`);
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function readManualPayload(env) {
  const settings = githubSettings(env);
  const url = `${githubFileUrl(settings)}?ref=${encodeURIComponent(settings.branch)}`;
  const file = await githubRequest(settings, url, { allowNotFound: true });
  if (!file) {
    return {
      settings,
      sha: '',
      payload: { version: 3, updatedAt: new Date().toISOString(), lotteries: [], deleted: [] },
    };
  }
  let payload;
  try {
    payload = JSON.parse(base64ToUtf8(file.content || ''));
  } catch {
    throw new Error('manual-lotteries.jsonを読み込めませんでした');
  }
  if (Array.isArray(payload)) payload = { version: 3, lotteries: payload, deleted: [] };
  if (!Array.isArray(payload.lotteries)) payload.lotteries = [];
  if (!Array.isArray(payload.deleted)) payload.deleted = [];
  return { settings, sha: file.sha || '', payload };
}

async function writeManualPayload(settings, payload, sha, message) {
  const body = {
    message,
    branch: settings.branch,
    content: utf8ToBase64(`${JSON.stringify(payload, null, 2)}\n`),
  };
  if (sha) body.sha = sha;
  return githubRequest(settings, githubFileUrl(settings), {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

function safeEqual(left, right) {
  const a = new TextEncoder().encode(String(left || ''));
  const b = new TextEncoder().encode(String(right || ''));
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function requireAdmin(request, env) {
  const configured = String(env.POKECA_ADMIN_KEY || '').trim();
  const supplied = String(request.headers.get('X-Pokeca-Admin-Key') || '').trim();
  if (!configured) {
    const error = new Error('Cloudflare側の公開用管理キーが未設定です');
    error.status = 503;
    throw error;
  }
  if (!safeEqual(configured, supplied)) {
    const error = new Error('公開用管理キーが違います');
    error.status = 401;
    throw error;
  }
}

async function handleManualRead(env) {
  const current = await readManualPayload(env);
  return jsonResponse({
    ok: true,
    version: current.payload.version || 3,
    updatedAt: current.payload.updatedAt || '',
    lotteries: current.payload.lotteries,
    deleted: current.payload.deleted,
  });
}

async function handlePublish(request, env) {
  requireAdmin(request, env);
  const body = await request.json();
  const remove = body?.remove === true;
  const target = normalizeManualLottery(body?.item);
  const key = manualIdentity(target);
  const current = await readManualPayload(env);
  let lotteries = current.payload.lotteries.filter((entry) => manualIdentity(entry) !== key);
  let deleted = current.payload.deleted.filter((entry) => String(entry?.key || entry || '') !== key);

  if (remove) {
    deleted.unshift({ key, deletedAt: new Date().toISOString() });
    deleted = deleted.slice(0, 500);
  } else {
    lotteries.unshift(target);
  }

  const payload = {
    version: 3,
    updatedAt: new Date().toISOString(),
    lotteries,
    deleted,
  };
  await writeManualPayload(
    current.settings,
    payload,
    current.sha,
    remove ? `admin: remove lottery ${target.shop || target.product}` : `admin: publish lottery ${target.shop || target.product}`,
  );
  return jsonResponse({ ok: true, removed: remove, count: lotteries.length, updatedAt: payload.updatedAt });
}

async function handleAdminCheck(request, env) {
  requireAdmin(request, env);
  const current = await readManualPayload(env);
  return jsonResponse({ ok: true, count: current.payload.lotteries.length, updatedAt: current.payload.updatedAt || '' });
}

async function handleReader(request) {
  const body = await request.json();
  const target = normalizeTarget(body?.url);
  const { html, finalUrl } = await fetchLivePocket(target);
  const title = htmlTitle(html);
  const text = buildReadableText(html);
  const parsed = parseLivePocketFromText(text, finalUrl, title);

  if (!parsed.data.product && !parsed.data.applyEndDate && !parsed.data.resultStartDate) {
    return jsonResponse({
      ok: false,
      error: 'LivePocket本文は取得できましたが、抽選情報を判定できませんでした',
      debug: { title, textPreview: text.slice(0, 1500) },
    }, 422);
  }

  return jsonResponse({
    ok: true,
    source: 'livepocket-server',
    title,
    data: parsed.data,
    missing: parsed.missing,
    sections: parsed.sections,
    text: text.slice(0, 50000),
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

    const incoming = new URL(request.url);
    const path = incoming.pathname.replace(/\/+$/, '') || '/';

    try {
      if (request.method === 'GET' && (path === '/health' || path === '/')) {
        return jsonResponse({
          ok: true,
          service: 'pokeca-life-reader',
          version: '1.1.1',
          publishConfigured: Boolean(env.POKECA_GITHUB_TOKEN && env.POKECA_ADMIN_KEY && env.GITHUB_OWNER && env.GITHUB_REPO),
        });
      }
      if (request.method === 'GET' && path === '/manual') return await handleManualRead(env);
      if (request.method === 'POST' && path === '/admin-check') return await handleAdminCheck(request, env);
      if (request.method === 'POST' && path === '/publish') return await handlePublish(request, env);
      if (request.method === 'POST' && (path === '/read' || path === '/')) return await handleReader(request);
      return jsonResponse({ ok: false, error: '対応していない操作です' }, 405);
    } catch (error) {
      const status = Number(error?.status || 0) || (/未完了|未設定/.test(error?.message || '') ? 503 : 400);
      return jsonResponse({ ok: false, error: error?.message || '処理に失敗しました' }, status);
    }
  },
};
