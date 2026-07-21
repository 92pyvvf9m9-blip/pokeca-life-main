import crypto from "node:crypto";
import { htmlToText } from "./html.mjs";

function hash(value = "") {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function timestamp(value) {
  const parsed = new Date(value || 0);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function semanticText(html = "") {
  return htmlToText(String(html || ""))
    .normalize("NFKC")
    .replace(/\b(?:csrf|nonce|token)[-_:=\s"']+[a-z0-9_-]{12,}\b/gi, " ")
    .replace(/\b[a-f0-9]{32,64}\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500_000);
}

export function documentFingerprint(html = "") {
  return hash(semanticText(html));
}

export function opaqueSourceKey(source = {}) {
  return hash(`${source.id || ""}\n${source.url || ""}`).slice(0, 24);
}

export function opaqueCandidateKey(url = "") {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(?:utm_|fbclid$|gclid$|yclid$|ref$|source$)/i.test(key)) parsed.searchParams.delete(key);
    }
    return hash(parsed.href).slice(0, 24);
  } catch {
    return hash(url).slice(0, 24);
  }
}

export class DiscoveryStateTracker {
  constructor(previous = {}, now = new Date()) {
    this.now = now instanceof Date ? now : new Date(now);
    this.nowIso = this.now.toISOString();
    this.state = {
      version: 1,
      updatedAt: this.nowIso,
      sources: previous?.sources && typeof previous.sources === "object" ? structuredClone(previous.sources) : {},
    };
    this.seenSourceKeys = new Set();
    this.metrics = {
      observedSourceCount: 0,
      rootFirstSeenCount: 0,
      rootChangedCount: 0,
      newCandidateCount: 0,
      changedCandidateCount: 0,
      knownCandidateCount: 0,
    };
  }

  ensureSource(source) {
    const key = opaqueSourceKey(source);
    const previous = this.state.sources[key] || {};
    if (!this.seenSourceKeys.has(key)) this.metrics.observedSourceCount += 1;
    this.seenSourceKeys.add(key);
    this.state.sources[key] = {
      firstSeenAt: previous.firstSeenAt || this.nowIso,
      lastCheckedAt: this.nowIso,
      lastChangedAt: previous.lastChangedAt || "",
      rootFingerprint: previous.rootFingerprint || "",
      candidates: previous.candidates && typeof previous.candidates === "object" ? previous.candidates : {},
    };
    return { key, entry: this.state.sources[key] };
  }

  observeRoot(source, html) {
    const { entry } = this.ensureSource(source);
    const fingerprint = documentFingerprint(html);
    const firstSeen = !entry.rootFingerprint;
    const changed = Boolean(entry.rootFingerprint && entry.rootFingerprint !== fingerprint);
    if (firstSeen) this.metrics.rootFirstSeenCount += 1;
    if (changed) this.metrics.rootChangedCount += 1;
    if (firstSeen || changed) entry.lastChangedAt = this.nowIso;
    entry.rootFingerprint = fingerprint;
    return { firstSeen, changed };
  }

  observeCandidate(source, url, html) {
    const { entry } = this.ensureSource(source);
    const key = opaqueCandidateKey(url);
    const fingerprint = documentFingerprint(html);
    const previous = entry.candidates[key];
    const firstSeen = !previous;
    const changed = Boolean(previous && previous.fingerprint !== fingerprint);

    if (firstSeen) this.metrics.newCandidateCount += 1;
    else this.metrics.knownCandidateCount += 1;
    if (changed) this.metrics.changedCandidateCount += 1;

    entry.candidates[key] = {
      firstSeenAt: previous?.firstSeenAt || this.nowIso,
      lastSeenAt: this.nowIso,
      lastChangedAt: firstSeen || changed ? this.nowIso : (previous?.lastChangedAt || ""),
      fingerprint,
    };
    return { firstSeen, changed };
  }

  lastCheckedAt(source) {
    return timestamp(this.state.sources[opaqueSourceKey(source)]?.lastCheckedAt);
  }

  finalize({ sourceRetentionDays = 365, candidateRetentionDays = 180, maxCandidatesPerSource = 1000 } = {}) {
    const sourceCutoff = this.now.getTime() - sourceRetentionDays * 86_400_000;
    const candidateCutoff = this.now.getTime() - candidateRetentionDays * 86_400_000;

    for (const [sourceKey, source] of Object.entries(this.state.sources)) {
      const lastChecked = new Date(source.lastCheckedAt || 0).getTime();
      if (Number.isFinite(lastChecked) && lastChecked < sourceCutoff) {
        delete this.state.sources[sourceKey];
        continue;
      }

      const candidates = Object.entries(source.candidates || {})
        .filter(([, item]) => {
          const lastSeen = new Date(item.lastSeenAt || 0).getTime();
          return !Number.isFinite(lastSeen) || lastSeen >= candidateCutoff;
        })
        .sort((a, b) => String(b[1].lastSeenAt || "").localeCompare(String(a[1].lastSeenAt || "")))
        .slice(0, maxCandidatesPerSource);
      source.candidates = Object.fromEntries(candidates);
    }

    return {
      state: this.state,
      metrics: {
        ...this.metrics,
        trackedSourceCount: Object.keys(this.state.sources).length,
        trackedCandidateCount: Object.values(this.state.sources).reduce(
          (sum, source) => sum + Object.keys(source.candidates || {}).length,
          0,
        ),
      },
    };
  }
}
