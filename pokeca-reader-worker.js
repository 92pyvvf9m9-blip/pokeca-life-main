/**
 * Pokeca Life URL Reader API
 * Cloudflare Workers (module syntax)
 *
 * POST /  { "url": "https://livepocket.jp/e/..." }
 * GET  /health
 */

const LIVEPOCKET_HOSTS = new Set([
  'livepocket.jp',
  'www.livepocket.jp',
  't.livepocket.jp',
  'imageflux.livepocket.jp',
]);

const GOOGLE_FORM_HOSTS = new Set([
  'docs.google.com',
  'forms.google.com',
  'forms.gle',
]);

const ALLOWED_HOSTS = new Set([...LIVEPOCKET_HOSTS, ...GOOGLE_FORM_HOSTS]);

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

function isLivePocketHost(value = '') {
  try { return LIVEPOCKET_HOSTS.has(new URL(String(value || '')).hostname.toLowerCase()); } catch { return false; }
}

function isGoogleFormHost(value = '') {
  try { return GOOGLE_FORM_HOSTS.has(new URL(String(value || '')).hostname.toLowerCase()); } catch { return false; }
}

function googleFormIdFromUrl(value = '') {
  try {
    const url = new URL(String(value || ''));
    const host = url.hostname.toLowerCase();
    if (!['docs.google.com', 'forms.google.com'].includes(host)) return '';
    return url.pathname.match(/^\/forms\/d\/(?:e\/)?([^/]+)\/(?:viewform|formResponse)\/?$/i)?.[1] || '';
  } catch { return ''; }
}

export function canonicalGoogleFormUrl(value = '') {
  try {
    const url = new URL(String(value || '').trim());
    const host = url.hostname.toLowerCase();
    if (host === 'forms.gle') {
      url.hash = '';
      url.search = '';
      url.pathname = url.pathname.replace(/\/+$/, '');
      return url.pathname && url.pathname !== '/' ? `https://forms.gle${url.pathname}` : '';
    }
    const id = googleFormIdFromUrl(url.toString());
    return id ? `https://docs.google.com/forms/d/e/${id}/viewform` : '';
  } catch { return ''; }
}

function targetKind(value = '') {
  if (canonicalLivePocketEventUrl(value)) return 'livepocket';
  if (canonicalGoogleFormUrl(value) || isGoogleFormHost(value)) return 'google-form';
  return '';
}

function normalizeTarget(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('URLがありません');
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('HTTPSのURLだけ対応しています');
  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) throw new Error('対応していないURLです');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_|^(ref|source|from|fbclid|gclid|usp|edit_requested)$/i.test(key)) url.searchParams.delete(key);
  }
  url.pathname = url.pathname.replace(/\/+$/, '');

  if (LIVEPOCKET_HOSTS.has(host)) {
    if (!/^\/e\/[A-Za-z0-9_-]+$/.test(url.pathname)) throw new Error('LivePocketの応募ページURLではありません');
    return canonicalLivePocketEventUrl(url.toString()) || url.toString();
  }

  if (host === 'forms.gle') {
    if (!url.pathname || url.pathname === '/') throw new Error('Googleフォームの短縮URLではありません');
    return `https://forms.gle${url.pathname}`;
  }

  const canonical = canonicalGoogleFormUrl(url.toString());
  if (!canonical) throw new Error('Googleフォームの回答ページURLではありません');
  return canonical;
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

function splitSemanticLines(value) {
  const decoded = decodeHtmlEntities(decodeEscapes(String(value || '')))
    .replace(/\r/g, '\n')
    // Event descriptions are often stored as one very long JSON string. Insert
    // safe boundaries before the labels that carry lottery dates instead of
    // discarding the entire string merely because it exceeds 1,000 characters.
    .replace(/(?=【(?:抽選応募受付期間|抽選申込受付期間|抽選応募期間|応募受付期間|応募期間|受付期間|受付日時|抽選結果発表予定日|結果発表予定日|抽選結果発表|当選発表|結果発表|店頭購入期間|ご購入期間|購入期間|購入期限|受取期間|引取期間|注意事項)】)/g, '\n')
    .replace(/(?=\[(?:抽選応募受付期間|抽選申込受付期間|抽選応募期間|応募受付期間|応募期間|受付期間|受付日時|抽選結果発表予定日|結果発表予定日|抽選結果発表|当選発表|結果発表|店頭購入期間|ご購入期間|購入期間|購入期限|受取期間|引取期間|注意事項)\])/g, '\n')
    .replace(/(?=(?:抽選応募受付期間|抽選申込受付期間|抽選応募期間|応募受付期間|応募期間|受付期間|受付日時|抽選結果発表予定日|結果発表予定日|抽選結果発表|当選発表|結果発表|店頭購入期間|ご購入期間|購入期間|購入期限|受取期間|引取期間)\s*[:：])/g, '\n')
    .replace(/([。！？])\s*/g, '$1\n');

  const lines = [];
  for (const rawLine of decoded.split(/\n+/)) {
    const line = cleanLine(rawLine);
    if (!line) continue;
    if (line.length <= 1400) {
      lines.push(line);
      continue;
    }

    // Keep long content in overlapping chunks. The overlap prevents a label at
    // the end of one chunk and its date at the beginning of the next from being
    // separated. This is intentionally generic so future sites with minified
    // JSON/React payloads are handled by the same path.
    const chunkSize = 1200;
    const overlap = 220;
    for (let start = 0; start < line.length; start += chunkSize - overlap) {
      const chunk = cleanLine(line.slice(start, start + chunkSize));
      if (chunk) lines.push(chunk);
      if (start + chunkSize >= line.length) break;
    }
  }
  return lines;
}

function normalizeTextPreserveDuplicates(value) {
  return splitSemanticLines(value).join('\n');
}

function normalizeText(value) {
  const seen = new Set();
  const lines = normalizeTextPreserveDuplicates(value)
    .split('\n')
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

function tagTextCandidates(html, tagName) {
  const values = [];
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  for (const match of String(html || '').matchAll(pattern)) {
    const value = cleanLine(stripTags(match[1]));
    if (value && value.length <= 500 && !values.includes(value)) values.push(value);
  }
  return values;
}

function eventSlugFromUrl(value = '') {
  try {
    return new URL(String(value || '')).pathname.match(/^\/e\/([A-Za-z0-9_-]+)/)?.[1] || '';
  } catch {
    return '';
  }
}

function canonicalLivePocketEventUrl(value = '') {
  try {
    const url = new URL(String(value || ''));
    const host = url.hostname.toLowerCase();
    const slug = eventSlugFromUrl(url.toString());
    if (!slug || !/(^|\.)livepocket\.jp$/.test(host)) return '';
    return `https://livepocket.jp/e/${slug}`;
  } catch {
    return '';
  }
}

function normalizeComparableUrl(value = '') {
  const livePocket = canonicalLivePocketEventUrl(value);
  if (livePocket) return livePocket;
  const googleForm = canonicalGoogleFormUrl(value);
  if (googleForm) return googleForm;
  try {
    const url = new URL(String(value || ''));
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, '');
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_|^(ref|source|from|fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return '';
  }
}

function isUsefulEventTitle(value) {
  const cleaned = cleanLine(value);
  if (!cleaned || cleaned.length < 6 || cleaned.length > 500) return false;
  if (/イベント検索|検索結果|おすすめ|関連イベント|Language|注意事項|お問い合わせ/i.test(cleaned)) return false;
  return /ポケモンカード|拡張パック|デッキ|スターターセット|BOX/i.test(cleaned);
}

function targetJsonTitleCandidates(html, targetUrl = '') {
  const target = normalizeComparableUrl(targetUrl);
  const targetPath = (() => { try { return new URL(target).pathname.replace(/\/+$/, ''); } catch { return ''; } })();
  const slug = eventSlugFromUrl(target);
  if (!target && !slug) return [];

  const roots = [];
  const pushJson = raw => {
    try { roots.push(JSON.parse(decodeHtmlEntities(raw))); } catch {}
  };
  for (const match of String(html || '').matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) pushJson(match[1]);
  const nextData = String(html || '').match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (nextData) pushJson(nextData);

  const titleKeys = /^(?:name|title|headline|eventName|event_name|eventTitle|event_title|pageTitle|page_title|ogTitle|og_title|ticketName|ticket_name)$/i;
  const urlKeys = /(?:url|href|path|slug|code|eventId|event_id|eventCode|event_code)/i;
  const candidates = [];
  const seen = new Set();

  const walk = (node, depth = 0) => {
    if (!node || depth > 14) return;
    if (Array.isArray(node)) {
      node.forEach(value => walk(value, depth + 1));
      return;
    }
    if (typeof node !== 'object') return;

    let matchScore = 0;
    for (const [key, raw] of Object.entries(node)) {
      if (typeof raw !== 'string') continue;
      const value = decodeEscapes(decodeHtmlEntities(raw));
      const comparable = normalizeComparableUrl(value);
      if (target && comparable && comparable === target) matchScore = Math.max(matchScore, 1400);
      if (targetPath && value.includes(targetPath)) matchScore = Math.max(matchScore, 1200);
      if (slug && urlKeys.test(key) && (value === slug || value.endsWith(`/${slug}`) || value.includes(`/e/${slug}`))) matchScore = Math.max(matchScore, 1100);
    }

    if (matchScore) {
      for (const [key, raw] of Object.entries(node)) {
        if (typeof raw !== 'string' || !titleKeys.test(key)) continue;
        const value = cleanLine(decodeEscapes(decodeHtmlEntities(raw)));
        if (!isUsefulEventTitle(value)) continue;
        const unique = `${value}\u0000${matchScore}`;
        if (!seen.has(unique)) {
          seen.add(unique);
          candidates.push({ value, score: matchScore });
        }
      }
    }

    Object.values(node).forEach(value => walk(value, depth + 1));
  };
  roots.forEach(root => walk(root));

  // Ordinary script proximity matching is intentionally disabled. A nearby related-event title must never be treated as the target event.

  return candidates.sort((a, b) => b.score - a.score || b.value.length - a.value.length);
}

function normalizeTitleConsensus(value) {
  return extractProductCore(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　「」『』【】［］\[\]()（）・･\-‐‑‒–—―_]/g, '')
    .trim();
}

export function resolveEventHeading(html, targetUrl = '') {
  const candidates = [];
  const push = (value, sourceScore, source, exactTarget = false) => {
    const cleaned = cleanLine(value);
    if (!isUsefulEventTitle(cleaned)) return;
    let score = sourceScore;
    if (/ポケモンカードゲーム|ポケモンカード/.test(cleaned)) score += 120;
    if (/拡張パック|強化拡張パック|ハイクラスパック|スタートデッキ|スターターセット|プレミアムトレーナーボックス|スペシャルセット|デッキビルドBOX/i.test(cleaned)) score += 90;
    if (/抽選|予約販売|販売/.test(cleaned)) score += 20;
    if (/【[^】]*店】|\[[^\]]*店\]/.test(cleaned)) score += 15;
    if (/\.\.\.|…/.test(cleaned)) score -= 90;
    candidates.push({ value: cleaned, score, source, exactTarget, product: extractProductCore(cleaned), order: candidates.length });
  };

  targetJsonTitleCandidates(html, targetUrl).forEach(item => push(item.value, item.score, 'target-json', true));

  const main = String(html || '').match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] || '';
  tagTextCandidates(main, 'h1').forEach(value => push(value, 760, 'main-h1'));
  tagTextCandidates(html, 'h1').forEach(value => push(value, 620, 'h1'));
  push(metaContent(html, 'og:title'), 610, 'og:title');
  push(metaContent(html, 'twitter:title', 'name'), 590, 'twitter:title');
  push(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '', 540, 'title');

  const sourcePriority = { 'target-json': 0, 'main-h1': 1, 'og:title': 2, 'twitter:title': 3, h1: 4, title: 5 };
  const sorted = candidates.sort((a, b) => {
    if (a.exactTarget !== b.exactTarget) return a.exactTarget ? -1 : 1;
    const sourceDiff = (sourcePriority[a.source] ?? 9) - (sourcePriority[b.source] ?? 9);
    if (sourceDiff) return sourceDiff;
    if (a.exactTarget && a.score !== b.score) return b.score - a.score;
    // Within the same page region, the first heading is the current event;
    // lower headings are commonly related or recommended events.
    return a.order - b.order;
  });
  const exact = sorted.filter(item => item.exactTarget);
  const authoritative = exact.length ? exact : sorted.filter(item => ['main-h1', 'h1', 'og:title', 'twitter:title', 'title'].includes(item.source));
  const distinct = new Map();
  for (const item of authoritative) {
    const key = normalizeTitleConsensus(item.product || item.value);
    if (key && !distinct.has(key)) distinct.set(key, item);
  }

  const winner = (exact[0] || sorted[0]);
  // LivePocket may repeat related products in metadata or lower sections of the same page.
  // A difference between those strings is not grounds to reject the page: the requested URL
  // remains the record identity, and the highest-priority page heading is the event title.
  const hasAlternatives = !exact.length && distinct.size > 1;
  const confidence = winner ? (winner.exactTarget ? 1 : winner.source === 'main-h1' ? 0.98 : winner.source === 'h1' ? 0.96 : 0.9) : 0;
  return {
    title: winner?.value || htmlTitle(html),
    source: winner?.source || 'fallback',
    confidence: hasAlternatives ? Math.min(confidence, 0.9) : confidence,
    ambiguous: false,
    hasAlternatives,
    candidates: [...distinct.values()].slice(0, 8).map(item => ({ title: item.value, product: item.product, source: item.source })),
  };
}

function currentEventHeading(html, targetUrl = '') {
  return resolveEventHeading(html, targetUrl).title;
}

function contextWindows(value, pattern, radius = 1800, maxWindows = 24) {
  const source = String(value || '');
  if (!source) return [];
  const windows = [];
  const seen = new Set();
  const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  let match;
  while ((match = regex.exec(source)) && windows.length < maxWindows) {
    const from = Math.max(0, match.index - radius);
    const to = Math.min(source.length, match.index + match[0].length + radius);
    const window = source.slice(from, to);
    const key = window.slice(0, 240);
    if (!seen.has(key)) {
      seen.add(key);
      windows.push(window);
    }
    if (match[0].length === 0) regex.lastIndex += 1;
  }
  return windows;
}

const LOTTERY_TEXT_HINT = /応募期間|応募受付|申込期間|受付期間|受付日時|応募締切|申込締切|当選発表|結果発表|結果発表予定日|抽選結果|当落発表|当選通知|購入制限|購入期間|購入期限|受取期間|受取期限|引取期間|引取期限|営業時間終了|ポケモンカード|販売元|主催者|開催店舗/gi;

function collectMetaStrings(html) {
  const values = [];
  const pairs = [
    ['description', 'name'],
    ['og:description', 'property'],
    ['twitter:description', 'name'],
    ['event:description', 'property'],
  ];
  for (const [key, attr] of pairs) {
    const value = metaContent(html, key, attr);
    if (value) values.push(value);
  }

  // Some SPA pages put the complete event description in a data/aria attribute.
  // Restrict this to attributes containing lottery vocabulary to avoid collecting
  // unrelated framework state.
  for (const match of String(html || '').matchAll(/\b(?:data-[\w:-]+|aria-label|value)\s*=\s*["']([\s\S]*?)["']/gi)) {
    const decoded = decodeEscapes(decodeHtmlEntities(match[1]));
    if (LOTTERY_TEXT_HINT.test(decoded)) values.push(decoded);
    LOTTERY_TEXT_HINT.lastIndex = 0;
  }
  return values.join('\n');
}

function collectStructuredStrings(html) {
  const values = [];
  const seen = new Set();
  let visitedNodes = 0;

  const pushString = value => {
    const decoded = decodeEscapes(decodeHtmlEntities(String(value || '')));
    if (!decoded.trim()) return;

    const pieces = decoded.length <= 4800
      ? [decoded]
      : contextWindows(decoded, LOTTERY_TEXT_HINT, 2200, 30);

    // If a long string has no known label, retain the beginning and end. This
    // captures descriptions where the site uses a new label not yet in our map.
    if (!pieces.length && decoded.length > 4800) {
      pieces.push(decoded.slice(0, 3000), decoded.slice(-3000));
    }

    for (const piece of pieces) {
      const cleaned = cleanLine(piece);
      if (!cleaned) continue;
      const key = cleaned.slice(0, 500);
      if (seen.has(key)) continue;
      seen.add(key);
      values.push(cleaned);
    }
  };

  const pushValue = (value, depth = 0) => {
    if (visitedNodes++ > 30000 || depth > 20) return;
    if (typeof value === 'string') {
      pushString(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(item => pushValue(item, depth + 1));
      return;
    }
    if (value && typeof value === 'object') {
      Object.entries(value).forEach(([key, item]) => {
        // Keep semantic keys next to primitive values. APIs often return
        // { label: "応募期間", value: "7/18〜7/26" }.
        if (typeof item === 'string' || typeof item === 'number') pushString(`${key}: ${item}`);
        pushValue(item, depth + 1);
      });
    }
  };

  for (const match of String(html || '').matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { pushValue(JSON.parse(decodeHtmlEntities(match[1]))); } catch { pushString(match[1]); }
  }

  const nextData = String(html || '').match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (nextData) {
    try { pushValue(JSON.parse(decodeHtmlEntities(nextData))); } catch { pushString(nextData); }
  }

  // React Server Components / Next app-router payloads, Nuxt state and other
  // minified JavaScript can contain the event description as an escaped string.
  // Keep only context windows around lottery terms rather than slicing the first
  // 150 kB and hoping the useful section appears early.
  for (const match of String(html || '').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const decoded = decodeEscapes(decodeHtmlEntities(match[1]));
    const windows = contextWindows(decoded, LOTTERY_TEXT_HINT, 2600, 40);
    for (const window of windows) {
      const readable = window
        .replace(/[{}[\],]/g, '\n')
        .replace(/(?:\\?"|')([\w$.-]+)(?:\\?"|')\s*:/g, '$1: ')
        .replace(/\\?"/g, '')
        .replace(/\\n/g, '\n');
      pushString(readable);
    }
  }

  return values.join('\n');
}

function buildReadableText(html) {
  const source = String(html || '');
  const withoutScripts = source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');
  const visible = stripTags(withoutScripts);
  const meta = collectMetaStrings(source);
  const structured = collectStructuredStrings(source);
  // Ticket pages can contain repeated labels such as multiple 「受付日時」 blocks.
  // Keep their order here; product/shop parsing still uses a deduplicated copy later.
  return normalizeTextPreserveDuplicates(`${meta}\n${structured}\n${visible}`);
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
    .replace(/\s*(?:抽選会のお知らせ|抽選販売のお知らせ|抽選受付のお知らせ|予約受付のお知らせ|抽選予約販売|抽選販売|抽選受付|抽選会)\s*$/g, '')
    .replace(/\s*[|｜]\s*.*$/g, '')
    .trim();
  return product.slice(0, 220);
}

function normalizeProductConsensus(value) {
  return extractProductCore(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　「」『』【】［］\[\]()（）・･\-‐‑‒–—―_]/g, '')
    .trim();
}

export function findProductResult(text, title = '') {
  const preferred = extractProductCore(title);
  if (
    preferred &&
    /ポケモンカード|拡張パック|デッキ|スターターセット|BOX/i.test(preferred) &&
    !/\.\.\.|…/.test(preferred) &&
    !/注意事項|応募期間|当選発表|結果発表|購入期間|Each person/i.test(preferred)
  ) return { product: preferred, confidence: 0.98, ambiguous: false, candidates: [preferred], source: 'event-title' };

  const ranked = lineCandidates(text)
    .map((raw, index) => ({ raw, product: extractProductCore(raw), score: candidateQuality(raw), index }))
    .filter(item => item.product && /ポケモンカード|拡張パック|デッキ|BOX/i.test(item.product))
    .filter(item => !/\.\.\.|…/.test(item.product))
    .sort((a, b) => b.score - a.score || b.product.length - a.product.length || a.index - b.index);

  const distinct = [];
  const seen = new Set();
  for (const item of ranked) {
    const key = normalizeProductConsensus(item.product);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    distinct.push(item);
    if (distinct.length >= 8) break;
  }
  if (!distinct.length) return { product: '', confidence: 0, ambiguous: false, candidates: [], source: 'none' };

  const top = distinct[0];
  const second = distinct[1];
  const hasAlternatives = Boolean(second && second.score >= top.score - 18);
  return {
    // The form is shown to the administrator before saving, so use the strongest candidate
    // instead of discarding all fields merely because related product names also occur.
    product: top.product,
    confidence: hasAlternatives ? 0.68 : Math.max(0.55, Math.min(0.86, top.score / 220)),
    ambiguous: false,
    hasAlternatives,
    candidates: distinct.map(item => item.product),
    source: 'body-fallback',
  };
}

function findProduct(text, title = '') {
  return findProductResult(text, title).product;
}

function normalizeShopCandidate(value) {
  return compact(value)
    .replace(/^name\s*[:：]\s*/i, '')
    .replace(/^店舗名\s*[:：]\s*/i, '')
    .replace(/^(?:販売元|主催者|主催|開催店舗|販売店舗|受取店舗|対象店舗)\s*[:：]?\s*/i, '')
    .replace(/\s*(?:ポケモンカードゲーム|ポケモンカード|抽選会のお知らせ|抽選販売のお知らせ).*$/i, '')
    .replace(/\s*[（(](?:北海道|(?:京都|大阪)府|東京都|.{2,3}県)[）)]\s*.*$/i, '')
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

const APPLY_DATE_LABELS = [
  '抽選応募受付期間', '抽選申込受付期間', '抽選申込期間', '抽選応募期間', '抽選受付期間',
  '抽選販売受付期間', '応募受付期間', '申込受付期間', 'お申し込み期間', 'エントリー受付期間',
  '応募申込期間', '応募期間', '申込期間', '受付期間', '申込受付日時', '受付日時', '応募受付',
  '応募締め切り', '応募締切日時', '応募締切日', '応募締切', '申込締切日時', '申込締切日', '申込締切',
];
const RESULT_DATE_LABELS = [
  '抽選結果発表予定日', '結果発表予定日', '抽選結果発表日時', '抽選結果発表日',
  '抽選結果発表', '当選者発表', '当選発表日時', '当選発表日', '当選発表', '結果発表',
  '抽選結果', '当落発表', '当落結果', '当選通知予定', '当選通知日', '当選通知',
  '当選者への連絡', '当選連絡', '抽選発表',
];
const PURCHASE_DATE_LABELS = [
  '当選商品購入期間', '当選品購入期間', '店頭購入期間', 'ご購入期間', '商品購入期間', '購入可能期間',
  '購入受付期間', '購入・受取期間', '購入期間', '購入期限日時', '購入期限日', '購入期限',
  '受取可能期間', '受け取り可能期間', '受取期間', '受け取り期間', '引取期間', '引き取り期間',
  '受取期限日時', '受取期限', '引取期限日時', '引取期限', '支払期限', '決済期限', '購入制限',
];
const DATE_SECTION_LABELS = [...new Set([
  ...APPLY_DATE_LABELS,
  ...RESULT_DATE_LABELS,
  ...PURCHASE_DATE_LABELS,
  '注意事項', 'お問い合わせ', 'チケット販売情報', '入場方法', '料金', '料 金', '購入枚数',
])].sort((a, b) => b.length - a.length);

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeDateText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[：﹕]/g, ':')
    .replace(/[〜～~]/g, '〜')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/ /g, ' ');
}

function dateLikeCount(value) {
  return [...normalizeDateText(value).matchAll(/(?:(?:20\d{2})\s*[年\/.\-]\s*)?\d{1,2}\s*(?:月|[\/.\-])\s*\d{1,2}\s*日?/g)].length;
}

function labeledDateSection(text, labels, mode = 'range') {
  const lines = normalizeTextPreserveDuplicates(text).split('\n').map(cleanLine).filter(Boolean);
  const sortedLabels = [...labels].sort((a, b) => b.length - a.length);
  const labelPattern = sortedLabels.map(escapeRegExp).join('|');
  const allLabelPattern = DATE_SECTION_LABELS.map(escapeRegExp).join('|');
  const labelRegex = new RegExp(`(?:^|[【\\[〔\\s])(${labelPattern})(?:】|\\]|〕)?\\s*[:：]?\\s*`, 'i');
  const boundaryRegex = new RegExp(`^(?:【|\\[|〔)?(?:${allLabelPattern})(?:】|\\]|〕)?\\s*[:：]?`, 'i');
  const hardStopRegex = /^(?:受付終了|販売終了|予定販売数終了|チケット分配不可|入場方法|お問い合わせ|CONTACT|料\s*金|購入枚数|会員登録が必要)/i;
  const candidates = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(labelRegex);
    if (!match) continue;

    const parts = [];
    const sameLine = cleanLine(line.slice((match.index || 0) + match[0].length));
    if (sameLine) parts.push(sameLine);

    for (let nextIndex = index + 1; nextIndex < Math.min(lines.length, index + 7); nextIndex += 1) {
      const nextLine = lines[nextIndex];
      if (boundaryRegex.test(nextLine) || hardStopRegex.test(nextLine)) break;
      parts.push(nextLine);
      const count = dateLikeCount(parts.join(' '));
      if ((mode === 'point' && count >= 1) || (mode === 'range' && count >= 2)) break;
    }

    const value = cleanLine(parts.join(' '));
    const count = dateLikeCount(value);
    if (!count) continue;

    const contextLines = lines.slice(Math.max(0, index - 5), index);
    const nearestSalesHeading = [...contextLines].reverse().find(value => /抽選販売受付|抽選受付|抽選申込|先着販売受付/.test(value)) || '';
    let score = count * 100 + match[1].length;
    if (mode === 'range' && count >= 2) score += 50;
    if (/抽選販売受付|抽選受付|抽選申込/.test(nearestSalesHeading)) score += 60;
    if (/先着販売受付/.test(nearestSalesHeading)) score -= 120;
    if (/受付日時/.test(match[1]) && mode === 'range') score += 25;
    if (/結果発表予定日/.test(match[1]) && mode === 'point') score += 25;
    candidates.push({ value, score, index, label: match[1] });
  }

  return candidates.sort((a, b) => b.score - a.score || a.index - b.index)[0]?.value || '';
}


function semanticDateSection(text, labels, mode = 'range') {
  const source = normalizeDateText(normalizeTextPreserveDuplicates(text));
  const sortedLabels = [...labels].sort((a, b) => b.length - a.length);
  const allLabels = DATE_SECTION_LABELS.map(escapeRegExp).join('|');
  const candidates = [];

  for (const label of sortedLabels) {
    const labelRegex = new RegExp(escapeRegExp(label), 'gi');
    let match;
    while ((match = labelRegex.exec(source))) {
      const afterStart = match.index + match[0].length;
      let window = source.slice(afterStart, afterStart + 700);
      const boundary = window.match(new RegExp(`(?:\\n|\\s{2,})(?:【|\\[|〔)?(?:${allLabels})(?:】|\\]|〕)?\\s*[:：]?`, 'i'));
      if (boundary && boundary.index !== undefined && boundary.index > 0) window = window.slice(0, boundary.index);
      const count = dateLikeCount(window);
      if (!count) continue;

      let score = label.length * 4 + count * 100;
      if (mode === 'range' && count >= 2) score += 80;
      if (mode === 'point' && count === 1) score += 45;
      if (/締切|期限/.test(label) && mode === 'range') score += 10;
      if (/予定/.test(window)) score += 5;
      candidates.push({ value: cleanLine(window), score, index: match.index, label });
      if (match[0].length === 0) labelRegex.lastIndex += 1;
    }
  }

  return candidates.sort((a, b) => b.score - a.score || a.index - b.index)[0]?.value || '';
}

const STRUCTURED_DATE_KEYS = {
  applyStart: [
    'applicationStartAt','applicationStartDate','entryStartAt','entryStartDate','receptionStartAt','receptionStartDate',
    'application_start_at','application_start_date','entry_start_at','entry_start_date','reception_start_at',
    '応募開始日時','応募開始日','受付開始日時','受付開始日','申込開始日時','申込開始日',
  ],
  applyEnd: [
    'applicationEndAt','applicationEndDate','entryEndAt','entryEndDate','receptionEndAt','receptionEndDate','deadlineAt',
    'application_end_at','application_end_date','entry_end_at','entry_end_date','reception_end_at','deadline_at',
    '応募終了日時','応募終了日','応募締切日時','応募締切日','受付終了日時','受付終了日','申込終了日時','申込終了日',
  ],
  result: [
    'lotteryResultAt','lotteryResultDate','resultAnnouncementAt','winnerAnnouncementAt','announceAt','announcementAt',
    'lottery_result_at','result_announcement_at','winner_announcement_at','announce_at','announcement_at',
    '抽選結果発表日時','抽選結果発表日','当選発表日時','当選発表日','結果発表日時','結果発表日',
  ],
  purchaseStart: [
    'purchaseStartAt','purchaseStartDate','pickupStartAt','pickupStartDate','redemptionStartAt','redemptionStartDate',
    'purchase_start_at','purchase_start_date','pickup_start_at','pickup_start_date','redemption_start_at',
    '購入開始日時','購入開始日','受取開始日時','受取開始日','引取開始日時','引取開始日',
  ],
  purchaseEnd: [
    'purchaseEndAt','purchaseEndDate','pickupEndAt','pickupEndDate','redemptionEndAt','redemptionEndDate','paymentDeadlineAt',
    'purchase_end_at','purchase_end_date','pickup_end_at','pickup_end_date','redemption_end_at','payment_deadline_at',
    '購入終了日時','購入終了日','購入期限日時','購入期限日','受取終了日時','受取終了日','受取期限日時','受取期限日',
  ],
  eventStart: ['eventStartAt','eventStartDate','startDate','start_at','start_date','開催開始日時','開催開始日'],
  eventEnd: ['eventEndAt','eventEndDate','endDate','end_at','end_date','開催終了日時','開催終了日'],
};

function structuredDateValue(text, keys, base = new Date()) {
  const source = normalizeDateText(normalizeTextPreserveDuplicates(text));
  const candidates = [];
  for (const key of keys) {
    const regex = new RegExp(`(?:^|\\n|[,{\\s])${escapeRegExp(key)}\\s*[:=：]\\s*["']?([^\\n,}]{4,120})`, 'gi');
    let match;
    while ((match = regex.exec(source))) {
      const token = dateTokens(match[1], base)[0];
      if (token) candidates.push({ token, index: match.index, key });
      if (match[0].length === 0) regex.lastIndex += 1;
    }
  }
  return candidates.sort((a, b) => a.index - b.index)[0]?.token || null;
}

function structuredDateFacts(text, base = new Date()) {
  const applyStart = structuredDateValue(text, STRUCTURED_DATE_KEYS.applyStart, base);
  const applyEnd = structuredDateValue(text, STRUCTURED_DATE_KEYS.applyEnd, applyStart?.date || base);
  const result = structuredDateValue(text, STRUCTURED_DATE_KEYS.result, applyEnd?.date || applyStart?.date || base);
  const purchaseStart = structuredDateValue(text, STRUCTURED_DATE_KEYS.purchaseStart, result?.date || applyEnd?.date || base);
  const purchaseEnd = structuredDateValue(text, STRUCTURED_DATE_KEYS.purchaseEnd, purchaseStart?.date || result?.date || base);
  const eventStart = structuredDateValue(text, STRUCTURED_DATE_KEYS.eventStart, base);
  const eventEnd = structuredDateValue(text, STRUCTURED_DATE_KEYS.eventEnd, eventStart?.date || base);
  return { applyStart, applyEnd, result, purchaseStart, purchaseEnd, eventStart, eventEnd };
}

function explicitReferenceDate(text) {
  const source = normalizeDateText(text);
  const match = source.match(/(20\d{2})\s*[年\/.\-]\s*(\d{1,2})\s*(?:月|[\/.\-])\s*(\d{1,2})\s*日?/);
  if (!match) return new Date();
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return validCalendarDate(year, month, day)
    ? new Date(Date.UTC(year, month - 1, day, 12))
    : new Date();
}

function pad2(value) { return String(value).padStart(2, '0'); }

function referenceDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  const iso = String(value || '').match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12));
  const parsed = new Date(value || Date.now());
  return Number.isFinite(parsed.getTime()) ? parsed : new Date();
}

function validCalendarDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function inferYearForMonthDay(month, day, base, previous) {
  if (previous) {
    let year = previous.year;
    if (month < previous.month - 6) year += 1;
    else if (month > previous.month + 6) year -= 1;
    return year;
  }

  const baseDate = referenceDate(base);
  const baseYear = baseDate.getUTCFullYear();
  const candidates = [baseYear - 1, baseYear, baseYear + 1]
    .filter(year => validCalendarDate(year, month, day))
    .map(year => ({
      year,
      distance: Math.abs(Date.UTC(year, month - 1, day, 12) - baseDate.getTime()),
    }))
    .sort((a, b) => a.distance - b.distance);
  return candidates[0]?.year || baseYear;
}

function dateTokens(value, base = new Date()) {
  const source = normalizeDateText(value);
  const result = [];
  const pattern = /(?:(20\d{2})\s*[年\/.\-]\s*)?(\d{1,2})\s*(?:月|[\/.\-])\s*(\d{1,2})\s*日?(?:\s*[（(][^）)]*[）)])?(?:\s*T?\s*(?:(\d{1,2})\s*:\s*(\d{2})(?::\d{2}(?:\.\d+)?)?|(\d{1,2})\s*時\s*(?:(\d{1,2})\s*分)?))?/g;
  let match;
  let previous = null;

  while ((match = pattern.exec(source))) {
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;

    const explicitYear = match[1] ? Number(match[1]) : 0;
    const year = explicitYear || inferYearForMonthDay(month, day, base, previous);
    if (!validCalendarDate(year, month, day)) continue;

    const rawHour = match[4] ?? match[6];
    const rawMinute = match[5] ?? match[7];
    const hour = rawHour === undefined ? '' : Number(rawHour);
    const minute = rawHour === undefined ? '' : Number(rawMinute ?? 0);
    if (hour !== '' && (hour < 0 || hour > 23 || minute < 0 || minute > 59)) continue;

    const token = {
      date: `${year}-${pad2(month)}-${pad2(day)}`,
      time: hour === '' ? '' : `${pad2(hour)}:${pad2(minute)}`,
      year,
      month,
      day,
    };
    result.push(token);
    previous = token;
  }
  return result;
}

function datesFromSection(value, mode = 'range', base = new Date()) {
  const tokens = dateTokens(value, base);
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

function pageDateRangeCandidate(text, base = new Date()) {
  const candidates = [];
  const lines = normalizeTextPreserveDuplicates(text).split('\n').map(cleanLine).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    const line = normalizeDateText(lines[index]);
    if (line.length > 360) continue;
    if (/応募|申込|受付|当選|結果|抽選|購入|受取|引取|締切|期限/.test(line)) continue;
    const tokens = dateTokens(line, base);
    if (tokens.length < 2) continue;
    let score = 0;
    if (/20\d{2}/.test(line)) score += 80;
    if (/日程|開催|概要|イベント/.test(lines.slice(Math.max(0, index - 3), index + 1).join(' '))) score += 30;
    if (tokens[0].date !== tokens[tokens.length - 1].date) score += 25;
    candidates.push({
      start: tokens[0],
      end: tokens[tokens.length - 1],
      score,
      index,
      text: line,
    });
  }
  return candidates.sort((a, b) => b.score - a.score || a.index - b.index)[0] || null;
}

export function parseLivePocketFromText(text, url = '', title = '', context = {}) {
  const normalized = normalizeText(text);
  const productResult = findProductResult(normalized, title);
  const product = productResult.product;
  const shop = findShop(normalized, title);
  const pageBase = explicitReferenceDate(normalized);

  const applyText = labeledDateSection(text, APPLY_DATE_LABELS, 'range')
    || semanticDateSection(text, APPLY_DATE_LABELS, 'range')
    || section(
      normalized,
      APPLY_DATE_LABELS.join('|'),
      [...RESULT_DATE_LABELS, ...PURCHASE_DATE_LABELS, '注意事項', 'お問い合わせ'].join('|'),
    );
  const resultText = labeledDateSection(text, RESULT_DATE_LABELS, 'point')
    || semanticDateSection(text, RESULT_DATE_LABELS, 'point')
    || section(
      normalized,
      RESULT_DATE_LABELS.join('|'),
      [...PURCHASE_DATE_LABELS, '注意事項', 'お問い合わせ'].join('|'),
    );
  const purchaseText = labeledDateSection(text, PURCHASE_DATE_LABELS, 'range')
    || semanticDateSection(text, PURCHASE_DATE_LABELS, 'range')
    || section(
      normalized,
      PURCHASE_DATE_LABELS.join('|'),
      '注意事項|お問い合わせ',
    );

  const structured = structuredDateFacts(text, pageBase);
  const applyParsed = datesFromSection(applyText, 'range', pageBase);
  const applyStartDate = structured.applyStart?.date || applyParsed.startDate;
  const applyStartTime = structured.applyStart?.time || applyParsed.startTime;
  const applyEndDate = structured.applyEnd?.date || applyParsed.endDate || applyParsed.startDate;
  const applyEndTime = structured.applyEnd?.time || applyParsed.endTime || applyParsed.startTime;

  const resultBase = applyEndDate || applyStartDate || pageBase;
  const resultParsed = datesFromSection(resultText, 'point', resultBase);
  const resultStartDate = structured.result?.date || resultParsed.startDate;
  const resultStartTime = structured.result?.time || resultParsed.startTime;

  const purchaseBase = resultStartDate || applyEndDate || applyStartDate || pageBase;
  const purchaseDeadlineOnly = Boolean(
    purchaseText
    && dateLikeCount(purchaseText) === 1
    && !/[〜～~]|(?:から|より)[^。\n]{0,80}(?:まで|迄)/.test(normalizeDateText(purchaseText))
    && /購入期限|受取期限|受け取り期限|引取期限|引き取り期限|支払期限|決済期限/.test(normalized)
  );
  const purchaseParsed = datesFromSection(purchaseText, purchaseDeadlineOnly ? 'point' : 'range', purchaseBase);
  let purchaseStartDate = structured.purchaseStart?.date || (purchaseDeadlineOnly ? '' : purchaseParsed.startDate);
  let purchaseStartTime = structured.purchaseStart?.time || (purchaseDeadlineOnly ? '' : purchaseParsed.startTime);
  let purchaseEndDate = structured.purchaseEnd?.date || (purchaseDeadlineOnly
    ? purchaseParsed.startDate
    : (purchaseParsed.endDate || purchaseParsed.startDate));
  let purchaseEndTime = structured.purchaseEnd?.time || (purchaseDeadlineOnly
    ? purchaseParsed.startTime
    : (purchaseParsed.endTime || purchaseParsed.startTime));

  // The overview dates on LivePocket describe the event window and are not a
  // reliable purchase-start source. A single "購入期限" date must remain an
  // end date. The browser app supplements the start from its verified product
  // release catalog, or from the result date for clearly identified resales.
  const pageRange = pageDateRangeCandidate(text, pageBase);
  const eventStart = structured.eventStart || pageRange?.start || null;
  const eventEnd = structured.eventEnd || pageRange?.end || null;
  const purchaseRangeSupplemented = false;

  const locationSource = `${shop}\n${title}\n${normalized}`;
  const area = PREFECTURES.find(prefecture => locationSource.includes(prefecture)) || '全国';

  const data = {
    shop,
    product,
    url,
    applyStartDate,
    applyStartTime,
    applyEndDate: applyEndDate || applyStartDate,
    applyEndTime: applyEndTime || applyStartTime,
    resultStartDate,
    resultStartTime,
    resultEndDate: '',
    resultEndTime: '',
    resultNote: /予定/.test(resultText) ? '予定' : '',
    purchaseStartDate,
    purchaseStartTime,
    purchaseEndDate: purchaseEndDate || (purchaseDeadlineOnly ? '' : purchaseStartDate),
    purchaseEndTime: purchaseEndTime || (purchaseDeadlineOnly ? '' : purchaseStartTime),
    type: '店舗',
    area,
    memo: `URL本文・構造化データから自動取得${/営業時間終了まで/.test(purchaseText) ? '\n購入期限時刻：営業時間終了まで' : ''}`, 
  };

  const missing = [];
  if (!data.shop) missing.push('店舗名');
  if (!data.product) missing.push('商品名');
  if (!data.applyEndDate) missing.push('応募締切');
  if (!data.resultStartDate) missing.push('結果発表');

  const warnings = [];
  if (productResult.hasAlternatives) warnings.push('関連商品名も検出しましたが、ページ上部のイベント名を優先して反映しました');
  if (context?.heading?.hasAlternatives) warnings.push('ページ内に別の商品名もありますが、対象URLのイベント見出しを優先しました');
  if (purchaseDeadlineOnly) warnings.push('購入期限のみ取得しました。購入開始日は商品カタログまたは再販判定で補完します');

  const identityConfidence = Math.min(
    context?.heading?.confidence ?? 0.9,
    productResult.confidence || 0,
    shop ? 0.95 : 0.5,
  );
  const fieldCoverage = [
    Boolean(data.shop),
    Boolean(data.product),
    Boolean(data.applyStartDate),
    Boolean(data.applyEndDate),
    Boolean(data.resultStartDate),
    Boolean(data.purchaseEndDate),
  ].filter(Boolean).length / 6;
  let confidence = Math.min(identityConfidence, 0.45 + fieldCoverage * 0.55);
  if (missing.length) confidence = Math.min(confidence, 0.74);
  confidence = Math.max(0, Math.min(1, confidence));

  const dateSources = {
    apply: structured.applyStart || structured.applyEnd ? 'structured-fields' : (applyText ? 'labeled-text' : 'none'),
    result: structured.result ? 'structured-fields' : (resultText ? 'labeled-text' : 'none'),
    purchase: structured.purchaseStart || structured.purchaseEnd
      ? 'structured-fields'
      : (purchaseDeadlineOnly ? 'deadline-text' : (purchaseText ? 'labeled-text' : 'none')), 
  };

  return {
    data,
    missing,
    warnings,
    confidence,
    reviewRequired: missing.length > 0,
    evidence: {
      eventSlug: eventSlugFromUrl(url),
      titleSource: context?.heading?.source || '',
      titleCandidates: context?.heading?.candidates || [],
      productSource: productResult.source,
      productCandidates: productResult.candidates,
      purchaseDeadlineOnly,
      dateSources,
      eventRange: eventStart && eventEnd ? { startDate: eventStart.date, endDate: eventEnd.date } : null,
    },
    sections: { applyText, resultText, purchaseText },
  };
}


function googleFormTitle(html = '') {
  const source = String(html || '');
  const itemprop = source.match(/<meta[^>]+itemprop=["']name["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i)?.[1]
    || source.match(/<meta[^>]+content=["']([\s\S]*?)["'][^>]+itemprop=["']name["'][^>]*>/i)?.[1]
    || '';
  return cleanLine(
    metaContent(source, 'og:title')
    || metaContent(source, 'twitter:title', 'name')
    || itemprop
    || source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    || '',
  )
    .replace(/\s*[-–—|｜]\s*Google\s*Forms?\s*$/i, '')
    .replace(/\s*[-–—|｜]\s*Google\s*フォーム\s*$/i, '')
    .trim();
}

function googleFormProductCandidate(value = '') {
  return cleanLine(value)
    .replace(/^(?:対象商品|商品名|抽選対象商品|販売商品|応募商品|ご希望の商品)\s*[:：]?\s*/i, '')
    .replace(/^(?:ポケモンカードゲーム\s*)?(?:抽選販売|抽選受付|応募受付|予約抽選)\s*[:：]?\s*/i, '')
    .replace(/\s*(?:抽選販売|抽選受付|応募フォーム|エントリーフォーム|抽選応募フォーム|抽選販売のお知らせ|応募受付).*$/i, '')
    .replace(/[「『](.*)[」』]/, '$1')
    .replace(/^[・･\-—–\s]+/, '')
    .replace(/[|｜].*$/, '')
    .trim()
    .slice(0, 180);
}

function googleFormProductQuality(value = '', source = '') {
  const candidate = googleFormProductCandidate(value);
  if (!candidate || candidate.length < 3 || candidate.length > 180) return -9999;
  if (/氏名|名前|メール|電話|住所|生年月日|会員番号|カード番号|店舗名|注意事項|応募期間|当選発表|受取期間|利用規約|プライバシー|必須の質問/i.test(candidate)) return -9999;
  if (/^抽選販売(?:のお知らせ)?$|^応募フォーム$|^エントリーフォーム$|^ポケモンカード(?:ゲーム)?$/i.test(candidate)) return -9999;
  if (/^(?:\d+\s*)?(?:BOX|ボックス|パック)\s*[¥￥]?\s*[\d,]+\s*円?$/i.test(candidate)) return -9999;
  let score = 0;
  if (/ポケモンカード|ポケカ/.test(candidate)) score += 80;
  if (/拡張パック|強化拡張パック|ハイクラスパック|スタートデッキ|スターターセット|スペシャルセット|BOX|ボックス|デッキ|セット|パック/i.test(candidate)) score += 65;
  if (/^[ァ-ヶーA-Za-z0-9＆・\s]{4,80}$/.test(candidate)) score += 42;
  if (/対象商品|商品名|抽選対象商品|販売商品|応募商品/.test(source)) score += 75;
  if (/1\s*BOX|\d[,.]?\d{2,5}\s*円/.test(source)) score += 25;
  if (/抽選|販売|応募/.test(source)) score += 10;
  if (/\d{1,2}[\/月]\d{1,2}/.test(candidate)) score -= 80;
  score += Math.min(candidate.length, 80) / 5;
  return score;
}

function findGoogleFormProductResult(text = '', title = '') {
  const generic = findProductResult(text, title);
  if (generic.product && googleFormProductQuality(generic.product, generic.product) > 0) return generic;

  const lines = normalizeTextPreserveDuplicates(`${title}\n${text}`).split('\n').map(cleanLine).filter(Boolean);
  const candidates = [];
  const push = (value, source, index) => {
    const product = googleFormProductCandidate(value);
    const score = googleFormProductQuality(value, source);
    if (score <= -9000 || !product) return;
    candidates.push({ product, score, source, index });
  };

  push(title, 'form-title', -1);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const inline = line.match(/(?:対象商品|商品名|抽選対象商品|販売商品|応募商品|ご希望の商品)\s*[:：]?\s*(.{2,180})/i)?.[1];
    if (inline) push(inline, line, index);
    if (/^(?:対象商品|商品名|抽選対象商品|販売商品|応募商品|ご希望の商品)\s*[:：]?$/.test(line)) push(lines[index + 1] || '', line, index + 1);
    if (/1\s*BOX|\d[,.]?\d{2,5}\s*円/.test(line)) {
      push(lines[index - 1] || '', line, index - 1);
      push(line, line, index);
    }
    if (/ポケモンカード|ポケカ|拡張パック|ハイクラスパック|スターターセット|スタートデッキ|BOX|ボックス/i.test(line)) push(line, line, index);
  }

  const distinct = new Map();
  for (const candidate of candidates.sort((a, b) => b.score - a.score || a.index - b.index)) {
    const key = normalizeProductConsensus(candidate.product);
    if (key && !distinct.has(key)) distinct.set(key, candidate);
  }
  const ranked = [...distinct.values()];
  const top = ranked[0];
  return top
    ? {
        product: top.product,
        confidence: Math.max(0.58, Math.min(0.92, top.score / 210)),
        ambiguous: false,
        hasAlternatives: Boolean(ranked[1] && ranked[1].score >= top.score - 18),
        candidates: ranked.slice(0, 8).map(item => item.product),
        source: top.source === 'form-title' ? 'google-form-title' : 'google-form-body',
      }
    : { product: '', confidence: 0, ambiguous: false, candidates: [], source: 'none' };
}

function googleFormShopCandidate(value = '') {
  return normalizeShopCandidate(value)
    .replace(/\s*(?:抽選販売|抽選受付|応募フォーム|エントリーフォーム).*$/i, '')
    .trim();
}

function findGoogleFormShop(text = '', title = '') {
  const generic = findShop(text, title);
  if (generic) return generic;
  const lines = normalizeTextPreserveDuplicates(`${title}\n${text}`).split('\n').map(cleanLine).filter(Boolean);
  const candidates = [];
  const push = (value, score = 0) => {
    const shop = googleFormShopCandidate(value);
    if (!shop || shop.length < 2 || shop.length > 120) return;
    if (/応募期間|当選発表|受取期間|対象商品|商品名|氏名|メール|電話|住所|注意事項/i.test(shop)) return;
    candidates.push({ shop, score: score + shopQuality(shop) });
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const inline = line.match(/(?:店舗名|販売店|販売元|主催者|開催店舗|受取店舗)\s*[:：]?\s*(.{2,120})/i)?.[1];
    if (inline) push(inline, 100);
    if (/^(?:店舗名|販売店|販売元|主催者|開催店舗|受取店舗)\s*[:：]?$/.test(line)) push(lines[index + 1] || '', 100);
    if (/カードショップ|トレカショップ|トレカ|BOOK\s*OFF|ブックオフ|古本市場|ふるいち|ホビーステーション|ホビステ|カードラボ|フタバ図書|TSUTAYA|店$|本店$|支店$/i.test(line)) push(line, 35);
    const owner = line.match(/(?:このフォームは|This form was created inside of)\s*(.{2,100}?)(?:内で作成|\.|$)/i)?.[1];
    if (owner) push(owner, 20);
  }
  push(title, 15);
  return candidates.sort((a, b) => b.score - a.score || b.shop.length - a.shop.length)[0]?.shop || '';
}

function googleFormAccessState(text = '') {
  const source = normalizeTextPreserveDuplicates(text);
  if (/回答の受け付けを終了|回答を受け付けていません|no longer accepting responses|not accepting responses/i.test(source)) return 'closed';
  if (/権限が必要|アクセス権が必要|組織内のユーザーのみ|You need permission|only be viewed by users in/i.test(source)) return 'restricted';
  return 'open';
}

function googleFormType(text = '', shop = '') {
  const context = `${text}\n${shop}`;
  if (/発送|配送|通販|オンラインショップ|送料|お届け先/.test(context) && !/店頭受取|店舗受取|受取店舗/.test(context)) return '通販';
  if (/店頭|店舗受取|店頭受取|受取店舗|来店|レジ|営業時間/.test(context) || /店$|本店$|支店$/.test(shop)) return '店舗';
  return '店舗';
}

export function parseGoogleFormFromText(text, url = '', title = '', context = {}) {
  const heading = cleanLine(title || '');
  const base = parseLivePocketFromText(text, url, heading, context);
  const normalized = normalizeText(text);
  const productResult = findGoogleFormProductResult(normalized, heading);
  const shop = findGoogleFormShop(normalized, heading);
  const accessState = googleFormAccessState(normalized);
  const areaSource = `${shop}\n${heading}\n${normalized}`;
  const area = PREFECTURES.find(prefecture => areaSource.includes(prefecture))
    || PREFECTURES.find(prefecture => {
      const short = prefecture.replace(/[都道府県]$/, '');
      return short.length >= 2 && areaSource.includes(short);
    })
    || '全国';

  const data = {
    ...base.data,
    shop: shop || base.data.shop,
    product: productResult.product || base.data.product,
    url,
    type: googleFormType(normalized, shop || base.data.shop),
    area,
    destinationType: 'direct',
    status: accessState === 'closed' ? 'closed' : 'open',
    memo: `Googleフォームから自動取得${base.data.memo?.includes('営業時間終了まで') ? '\n購入期限時刻：営業時間終了まで' : ''}`,
  };

  const missing = [];
  if (!data.shop) missing.push('店舗名');
  if (!data.product) missing.push('商品名');
  if (!data.applyEndDate) missing.push('応募締切');
  if (!data.resultStartDate) missing.push('結果発表');

  const warnings = [...(base.warnings || [])];
  if (accessState === 'closed') warnings.push('このGoogleフォームは回答受付を終了しています');
  if (accessState === 'restricted') warnings.push('Googleアカウントまたは組織内アカウントが必要なフォームです');
  if (productResult.hasAlternatives) warnings.push('複数の商品候補を検出したため、最も可能性が高い商品名を反映しました');
  const coverage = [data.shop, data.product, data.applyEndDate, data.resultStartDate, data.purchaseEndDate].filter(Boolean).length / 5;
  let confidence = Math.min(
    productResult.confidence || base.confidence || 0.5,
    data.shop ? 0.96 : 0.65,
    0.48 + coverage * 0.52,
  );
  if (missing.length) confidence = Math.min(confidence, 0.74);
  if (accessState !== 'open') confidence = Math.min(confidence, 0.68);

  return {
    ...base,
    data,
    missing,
    warnings: [...new Set(warnings)],
    confidence: Math.max(0, Math.min(1, confidence)),
    reviewRequired: missing.length > 0 || accessState !== 'open',
    evidence: {
      ...(base.evidence || {}),
      formId: googleFormIdFromUrl(url),
      formAccessState: accessState,
      productSource: productResult.source,
      productCandidates: productResult.candidates,
      titleSource: context?.heading?.source || 'google-form-title',
    },
  };
}

async function fetchGoogleForm(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.6,en;q=0.4',
      'Cache-Control': 'no-cache',
    },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Googleフォーム取得失敗（HTTP ${response.status}）`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) throw new Error('GoogleフォームのHTMLを取得できませんでした');
  const html = await response.text();
  if (html.length < 200) throw new Error('Googleフォーム本文が空です');
  if (html.length > 4_000_000) throw new Error('Googleフォームが大きすぎます');
  const finalUrl = response.url || url;
  const canonicalUrl = canonicalGoogleFormUrl(finalUrl);
  if (!canonicalUrl || !googleFormIdFromUrl(canonicalUrl)) throw new Error('Googleフォーム以外へ転送されました');
  return { html, finalUrl, canonicalUrl };
}

async function readAndParseGoogleForm(target) {
  const page = await fetchGoogleForm(target);
  const title = googleFormTitle(page.html);
  const heading = { title, source: 'google-form-title', confidence: title ? 0.96 : 0.7, candidates: title ? [{ title, source: 'google-form-title' }] : [] };
  const text = buildReadableText(page.html);
  const parsed = parseGoogleFormFromText(text, page.canonicalUrl, title, { heading });
  parsed.evidence = { ...(parsed.evidence || {}), representations: [{ url: target, finalUrl: page.finalUrl, kind: 'google-form' }] };
  return { parsed, heading, text, finalUrl: page.finalUrl, canonicalUrl: page.canonicalUrl, representations: parsed.evidence.representations };
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
    // Cloudflare Workersでは `cache: 'no-store'` と `cf.cacheTtl` を
    // 同時指定すると実行時エラーになるため、標準のno-storeだけを使う。
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`LivePocket取得失敗（HTTP ${response.status}）`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) throw new Error('HTMLページを取得できませんでした');
  const html = await response.text();
  if (html.length < 200) throw new Error('ページ本文が空です');
  if (html.length > 4_000_000) throw new Error('ページが大きすぎます');
  return { html, finalUrl: response.url || url };
}


function parsedCompleteness(parsed) {
  const data = parsed?.data || {};
  return [
    data.shop,
    data.product,
    data.applyStartDate,
    data.applyEndDate,
    data.resultStartDate,
    data.purchaseEndDate,
  ].filter(Boolean).length;
}

async function readAndParseLivePocket(target) {
  const primary = await fetchLivePocket(target);
  let heading = resolveEventHeading(primary.html, target);
  let text = buildReadableText(primary.html);
  let parsed = parseLivePocketFromText(text, target, heading.title, { heading });
  const representations = [{ url: target, finalUrl: primary.finalUrl, kind: 'primary' }];

  // The new LivePocket SPA and the legacy server-rendered representation do not
  // always expose the same fields in their initial HTML. If mandatory dates are
  // absent, read the official legacy host as a second representation and merge
  // both texts before parsing. This remains first-party data and avoids relying
  // on third-party scraping services.
  if (!parsed.data.applyEndDate || !parsed.data.resultStartDate) {
    const slug = eventSlugFromUrl(target);
    const alternatives = slug ? [`https://t.livepocket.jp/e/${slug}`] : [];
    for (const alternativeUrl of alternatives) {
      try {
        const alternative = await fetchLivePocket(alternativeUrl);
        const alternativeText = buildReadableText(alternative.html);
        if (!alternativeText || alternativeText === text) continue;
        const alternativeHeading = resolveEventHeading(alternative.html, target);
        const combinedText = normalizeTextPreserveDuplicates(`${text}\n${alternativeText}`);
        const combinedHeading = heading.title ? heading : alternativeHeading;
        const candidate = parseLivePocketFromText(combinedText, target, combinedHeading.title, { heading: combinedHeading });
        representations.push({ url: alternativeUrl, finalUrl: alternative.finalUrl, kind: 'official-legacy' });
        if (parsedCompleteness(candidate) >= parsedCompleteness(parsed)) {
          parsed = candidate;
          text = combinedText;
          heading = combinedHeading;
        }
        if (parsed.data.applyEndDate && parsed.data.resultStartDate) break;
      } catch {
        // The legacy representation is a fallback only. A failure here must not
        // turn a usable primary-page result into a total error.
      }
    }
  }

  parsed.evidence = { ...(parsed.evidence || {}), representations };
  return { parsed, heading, text, finalUrl: primary.finalUrl, representations };
}


export function normalizeHttpsUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const livePocket = canonicalLivePocketEventUrl(raw);
  if (livePocket) return livePocket;
  const googleForm = canonicalGoogleFormUrl(raw);
  if (googleForm) return googleForm;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_|^(ref|source|from|fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, '');
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

function cleanManualShop(value) {
  return cleanShort(value, 120)
    .replace(/^name\s*[:：]\s*/i, '')
    .replace(/^店舗名\s*[:：]\s*/i, '')
    .trim();
}

function cleanManualProduct(value) {
  return cleanShort(value, 180)
    .replace(/^商品名\s*[:：]\s*/i, '')
    .replace(/^[・･\-—–\s]+/, '')
    .trim();
}

function normalizeManualLottery(input) {
  const now = new Date().toISOString();
  const item = input && typeof input === 'object' ? input : {};
  const normalized = {
    externalId: cleanShort(item.externalId || item.remoteId || '', 160),
    sourceKey: cleanShort(item.sourceKey || '', 220),
    sourceEventSlug: cleanShort(item.sourceEventSlug || '', 64),
    sourceTitle: cleanShort(item.sourceTitle || '', 500),
    parseConfidence: Number.isFinite(Number(item.parseConfidence)) ? Number(item.parseConfidence) : null,
    reviewRequired: Boolean(item.reviewRequired),
    parseWarning: cleanShort(item.parseWarning || '', 500),
    shop: cleanManualShop(item.shop),
    product: cleanManualProduct(item.product),
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

  // URL付き抽選はURLを唯一の公開キーにする。商品名や店舗名が変わっても別抽選を上書きしない。
  if (normalized.url) {
    normalized.externalId = normalized.url;
    normalized.sourceEventSlug = eventSlugFromUrl(normalized.url);
    normalized.sourceKey = `url:${normalized.url}`;
  }
  if (!normalized.shop) throw new Error('店舗名がありません');
  if (!normalized.product) throw new Error('商品名がありません');
  if (!normalized.applyEndDate) throw new Error('応募締切日がありません');
  if (!normalized.resultStartDate) throw new Error('結果発表日がありません');
  if (!normalized.url) throw new Error('応募URLが正しくありません');
  return normalized;
}

export function manualIdentity(item) {
  const url = normalizeHttpsUrl(item?.url || '');
  return url ? `url:${url}` : '';
}

function normalizeStoredIdentity(value) {
  const raw = String(value?.key || value || '').trim();
  if (!raw) return '';
  const candidate = raw.startsWith('url:') ? raw.slice(4) : raw;
  const normalized = normalizeHttpsUrl(candidate);
  return normalized ? `url:${normalized}` : raw;
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
    deleted: [...new Map(current.payload.deleted.map(entry => [normalizeStoredIdentity(entry), entry]).filter(([key]) => key)).values()],
  });
}

async function handlePublish(request, env) {
  requireAdmin(request, env);
  const body = await request.json();
  const remove = body?.remove === true;
  const target = normalizeManualLottery(body?.item);
  const key = manualIdentity(target);
  if (!key) throw new Error('応募URLを抽選キーとして確定できません');

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await readManualPayload(env);
    let lotteries = current.payload.lotteries.filter((entry) => manualIdentity(entry) !== key);
    let deleted = current.payload.deleted.filter((entry) => normalizeStoredIdentity(entry) !== key);

    if (remove) {
      deleted.unshift({ key, deletedAt: new Date().toISOString() });
      deleted = deleted.slice(0, 500);
    } else {
      lotteries.unshift(target);
    }

    const payload = {
      version: 5,
      updatedAt: new Date().toISOString(),
      lotteries,
      deleted,
    };
    try {
      await writeManualPayload(
        current.settings,
        payload,
        current.sha,
        remove ? `admin: remove lottery ${target.shop || target.product}` : `admin: publish lottery ${target.shop || target.product}`,
      );
      return jsonResponse({ ok: true, removed: remove, count: lotteries.length, updatedAt: payload.updatedAt });
    } catch (error) {
      if (error?.status !== 409 || attempt === 2) throw error;
    }
  }
  throw new Error('公開データの更新競合を解消できませんでした');
}

async function refreshManualLotteryFromUrl(item) {
  const base = normalizeManualLottery(item);
  if (!/^(?:https:\/\/)?(?:www\.)?livepocket\.jp\/e\//i.test(base.url)) return base;
  try {
    const { parsed: parsedResult, heading } = await readAndParseLivePocket(base.url);
    if (parsedResult.reviewRequired || parsedResult.confidence < 0.75 || !parsedResult.data.product) {
      return normalizeManualLottery({
        ...base,
        url: base.url,
        externalId: base.url,
        sourceTitle: heading.title,
        parseConfidence: parsedResult.confidence,
        reviewRequired: true,
        parseWarning: parsedResult.warnings.join('／') || '自動修復の確度が低いため、既存データを保持しました',
        createdAt: base.createdAt,
        collectedAt: base.collectedAt,
      });
    }
    const parsed = parsedResult.data;
    return normalizeManualLottery({
      ...base,
      ...Object.fromEntries(Object.entries(parsed).filter(([, value]) => value !== '' && value !== null && value !== undefined)),
      url: base.url,
      externalId: base.url,
      sourceTitle: heading.title,
      parseConfidence: parsedResult.confidence,
      reviewRequired: false,
      parseWarning: '',
      createdAt: base.createdAt,
      collectedAt: base.collectedAt,
      memo: base.memo || parsed.memo,
    });
  } catch (error) {
    return base;
  }
}

function dedupeManualByUrl(items) {
  const map = new Map();
  for (const raw of items) {
    let item;
    try { item = normalizeManualLottery(raw); } catch { continue; }
    const key = manualIdentity(item);
    if (!key) continue;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, item);
      continue;
    }
    const currentTime = Date.parse(item.updatedAt || item.collectedAt || item.createdAt || '') || 0;
    const existingTime = Date.parse(existing.updatedAt || existing.collectedAt || existing.createdAt || '') || 0;
    const preferred = currentTime >= existingTime ? item : existing;
    const other = preferred === item ? existing : item;
    map.set(key, {
      ...other,
      ...preferred,
      externalId: normalizeHttpsUrl(preferred.url || other.url),
      sourceKey: key,
      url: normalizeHttpsUrl(preferred.url || other.url),
      createdAt: existing.createdAt || item.createdAt,
      updatedAt: preferred.updatedAt || new Date().toISOString(),
    });
  }
  return [...map.values()];
}

async function handleRepair(request, env) {
  requireAdmin(request, env);
  const current = await readManualPayload(env);
  const before = current.payload.lotteries.length;
  const firstPass = dedupeManualByUrl(current.payload.lotteries);
  const refreshed = [];
  let repaired = 0;
  for (const item of firstPass) {
    const next = await refreshManualLotteryFromUrl(item);
    if (next.shop !== item.shop || next.product !== item.product || next.url !== item.url) repaired += 1;
    refreshed.push(next);
  }
  const lotteries = dedupeManualByUrl(refreshed);
  const reviewRequired = lotteries.filter(item => item.reviewRequired).length;
  const validKeys = new Set(lotteries.map(manualIdentity));
  const deleted = current.payload.deleted.filter(entry => !validKeys.has(normalizeStoredIdentity(entry))).slice(0, 500);
  const payload = {
    version: 5,
    updatedAt: new Date().toISOString(),
    lotteries,
    deleted,
  };
  await writeManualPayload(current.settings, payload, current.sha, 'admin: repair manual lotteries');
  return jsonResponse({ ok: true, before, after: lotteries.length, repaired, reviewRequired, updatedAt: payload.updatedAt });
}

async function handleAdminCheck(request, env) {
  requireAdmin(request, env);
  const current = await readManualPayload(env);
  return jsonResponse({ ok: true, count: current.payload.lotteries.length, updatedAt: current.payload.updatedAt || '' });
}

async function handleReader(request) {
  const body = await request.json();
  const target = normalizeTarget(body?.url);
  const kind = targetKind(target);
  if (!kind) throw new Error('対応していないURLです');

  const result = kind === 'livepocket'
    ? await readAndParseLivePocket(target)
    : await readAndParseGoogleForm(target);
  const canonicalUrl = kind === 'livepocket'
    ? canonicalLivePocketEventUrl(target)
    : result.canonicalUrl;
  const { parsed, heading, text, finalUrl, representations } = result;
  parsed.data.url = canonicalUrl;

  if (!parsed.data.product && !parsed.data.shop && !parsed.data.applyEndDate && !parsed.data.resultStartDate) {
    return jsonResponse({
      ok: false,
      error: kind === 'livepocket'
        ? 'LivePocket本文は取得できましたが、抽選情報を判定できませんでした'
        : 'Googleフォーム本文は取得できましたが、ポケカ抽選情報を判定できませんでした',
      debug: { title: heading.title, requestedUrl: target, finalUrl, textPreview: text.slice(0, 1500) },
    }, 422);
  }

  const source = kind === 'livepocket' ? 'livepocket-server' : 'google-form-server';
  const recordKey = `url:${canonicalUrl}`;
  return jsonResponse({
    ok: true,
    source,
    title: heading.title,
    requestedUrl: target,
    canonicalUrl,
    finalUrl,
    representations,
    readerVersion: '1.5.0',
    identity: {
      recordKey,
      eventSlug: kind === 'livepocket' ? eventSlugFromUrl(canonicalUrl) : '',
      formId: kind === 'google-form' ? googleFormIdFromUrl(canonicalUrl) : '',
      requestedUrl: target,
      canonicalUrl,
      sourceKind: kind,
    },
    confidence: parsed.confidence,
    warnings: parsed.warnings,
    evidence: parsed.evidence,
    data: {
      ...parsed.data,
      sourceKey: recordKey,
      sourceEventSlug: kind === 'livepocket' ? eventSlugFromUrl(canonicalUrl) : '',
      sourceFormId: kind === 'google-form' ? googleFormIdFromUrl(canonicalUrl) : '',
      sourceTitle: heading.title,
      parseConfidence: parsed.confidence,
      reviewRequired: parsed.reviewRequired,
      parseWarning: parsed.missing.length ? `未取得：${parsed.missing.join('・')}` : '',
    },
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
          version: '1.5.0',
          supportedReaders: ['LivePocket', 'Google Forms'],
          publishConfigured: Boolean(env.POKECA_GITHUB_TOKEN && env.POKECA_ADMIN_KEY && env.GITHUB_OWNER && env.GITHUB_REPO),
        });
      }
      if (request.method === 'GET' && path === '/manual') return await handleManualRead(env);
      if (request.method === 'POST' && path === '/admin-check') return await handleAdminCheck(request, env);
      if (request.method === 'POST' && path === '/repair') return await handleRepair(request, env);
      if (request.method === 'POST' && path === '/publish') return await handlePublish(request, env);
      if (request.method === 'POST' && (path === '/read' || path === '/')) return await handleReader(request);
      return jsonResponse({ ok: false, error: '対応していない操作です' }, 405);
    } catch (error) {
      const status = Number(error?.status || 0) || (/未完了|未設定/.test(error?.message || '') ? 503 : 400);
      return jsonResponse({ ok: false, error: error?.message || '処理に失敗しました' }, status);
    }
  },
};
