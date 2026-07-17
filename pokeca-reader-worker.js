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
  'Access-Control-Allow-Headers': 'Content-Type',
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

function findProduct(text, title = '') {
  const candidates = [title, ...lineCandidates(text)].map(compact).filter(Boolean);
  const bad = /注意事項|応募期間|受付期間|当選発表|結果発表|購入制限|購入期間|お問い合わせ|Each person|apply for one BOX|Language|イベント検索/i;
  const strong = /ポケモンカードゲーム|ポケモンカード|拡張パック|強化拡張パック|スタートデッキ|スターターセット|プレミアムトレーナーボックス|スペシャルセット|BOX/i;
  const hit = candidates.find(line => strong.test(line) && !bad.test(line) && line.length >= 4 && line.length <= 180);
  if (!hit) return '';
  const quoted = hit.match(/[「『]([^」』]{3,160})[」』]/)?.[1];
  const product = compact(quoted || hit)
    .replace(/^.*?(?=ポケモンカードゲーム|ポケモンカード|拡張パック|強化拡張パック|スタートデッキ|スターターセット|プレミアムトレーナーボックス|スペシャルセット)/, '')
    .trim();
  return product.slice(0, 160);
}

function findShop(text, title = '') {
  const combined = normalizeText(`${title}\n${text}`);
  const lines = lineCandidates(combined);
  const chainNames = '古本市場|ふるいち|フタバ図書|TSUTAYA|蔦屋書店|BOOKOFF|ブックオフ|カードラボ|ホビーステーション|ホビステ|レプトン|駿河屋|ゲオ|GEO|イオン|ヤマダデンキ|ジョーシン|エディオン|ビックカメラ|トイザらス|カードボックス|晴れる屋2|ドラゴンスター|ポケモンセンター';
  const chainPattern = new RegExp(`(${chainNames})[^\n「」]{0,50}店`, 'i');
  const standaloneChain = new RegExp(`^(?:${chainNames})(?:[（(][^）)]{1,30}[）)])?$`, 'i');

  const standalone = lines.find(line => line.length <= 60 && standaloneChain.test(line) && !/ポケモンカード|拡張パック|抽選/.test(line));
  if (standalone) return compact(standalone);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const inline = line.match(/(?:販売元|主催者|主催|開催店舗|販売店舗|受取店舗|対象店舗)\s*[:：]?\s*(.{2,80})/i)?.[1];
    if (inline) {
      const value = compact(inline).split(/(?:注意事項|応募期間|当選発表|購入期間)/)[0].trim();
      if (value && value.length <= 80 && !/LivePocket|ポケモンカードゲーム/.test(value)) return value;
    }
    if (/^(?:販売元|主催者|主催|開催店舗|販売店舗|受取店舗|対象店舗)\s*[:：]?$/.test(line)) {
      const next = compact(lines[i + 1] || '');
      if (next && next.length <= 80 && !/LivePocket|ポケモンカードゲーム/.test(next)) return next;
    }
    const chain = line.match(chainPattern)?.[0];
    if (chain) return compact(chain);
  }
  return '';
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

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

    const incoming = new URL(request.url);
    if (request.method === 'GET' && (incoming.pathname === '/health' || incoming.pathname === '/')) {
      return jsonResponse({ ok: true, service: 'pokeca-life-reader', version: '1.0.0' });
    }

    if (request.method !== 'POST') return jsonResponse({ ok: false, error: 'POSTで送信してください' }, 405);

    try {
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
    } catch (error) {
      return jsonResponse({ ok: false, error: error?.message || '取得に失敗しました' }, 400);
    }
  },
};
