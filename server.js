// server.js (ESM)
// Informed360 — real 4-hour sentiment buckets + leaderboard

import express from "express";
import Parser from "rss-parser";
import winkSentiment from "wink-sentiment";
import googleTrends from "google-trends-api";

const app = express();
const parser = new Parser({
  timeout: 15000,
  headers: { "User-Agent": "Informed360Bot/2.1 (+https://www.informed360.news)" }
});

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const CACHE_MS = 10 * 60 * 1000; // 10 minutes

// Primary sources via Google News mirrors (more reliable than direct RSS)
const FEEDS = [
  "https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en",
  "https://news.google.com/rss/search?q=site:thehindu.com&hl=en-IN&gl=IN&ceid=IN:en",
  "https://news.google.com/rss/search?q=site:indiatoday.in&hl=en-IN&gl=IN&ceid=IN:en",
  "https://news.google.com/rss/search?q=site:ndtv.com&hl=en-IN&gl=IN&ceid=IN:en",
  "https://news.google.com/rss/search?q=site:hindustantimes.com&hl=en-IN&gl=IN&ceid=IN:en",
  "https://news.google.com/rss/search?q=site:timesofindia.indiatimes.com&hl=en-IN&gl=IN&ceid=IN:en",
  "https://news.google.com/rss/search?q=site:livemint.com&hl=en-IN&gl=IN&ceid=IN:en",
  "https://news.google.com/rss/search?q=site:news18.com&hl=en-IN&gl=IN&ceid=IN:en",
  "https://news.google.com/rss/search?q=site:deccanherald.com&hl=en-IN&gl=IN&ceid=IN:en"
];

const SOURCE_CANON = [
  ["The Hindu", /thehindu/i],
  ["India Today", /indiatoday/i],
  ["NDTV", /ndtv/i],
  ["Hindustan Times", /(hindustantimes|hindustan\s+times)/i],
  ["Times of India", /(indiatimes|times\s+of\s+india)/i],
  ["Mint", /(livemint|mint)/i],
  ["News18", /news18/i],
  ["Deccan Herald", /deccanherald/i]
];

// --------- in-memory cache ----------
const cache = new Map();
const setCache = (k, data) => cache.set(k, { at: Date.now(), data });
const getCache = (k) => {
  const v = cache.get(k);
  if (!v) return null;
  if (Date.now() - v.at > CACHE_MS) return null;
  return v.data;
};

// --------- helpers ----------
const stripHtml = (s = "") => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const detectSource = (item) => {
  const link = (item.link || "").toLowerCase();
  const a = (item.author || item.creator || item.source || "").toString().toLowerCase();
  for (const [name, rx] of SOURCE_CANON) {
    if (rx.test(link) || rx.test(a)) return name;
  }
  // Try title suffix " - {source}"
  const t = item.title || "";
  if (t.includes(" - ")) {
    const candidate = t.split(" - ").pop().trim();
    if (candidate.length && candidate.length < 50) return candidate;
  }
  return "Other";
};

const normalize = (raw) => {
  const publishedAt = raw.isoDate || raw.pubDate || new Date().toISOString();
  const title = stripHtml(raw.title || "");
  const desc = stripHtml(raw.contentSnippet || raw.summary || raw.content || "");
  const s = winkSentiment(`${title}. ${desc}`);
  let label = "neutral";
  if (s.score > 0.5) label = "positive";
  else if (s.score < -0.5) label = "negative";
  return {
    id: (raw.guid || raw.link || title).slice(0, 300),
    title,
    description: desc,
    link: raw.link,
    source: detectSource(raw),
    publishedAt,
    sentiment: { score: s.score, label }
  };
};

const dedupe = (arr) => {
  const seen = new Set();
  return arr.filter((x) => {
    if (seen.has(x.id)) return false;
    seen.add(x.id);
    return true;
  });
};

// --------- news fetch ----------
async function fetchNews() {
  const cached = getCache("news");
  if (cached) return cached;

  const all = await Promise.all(
    FEEDS.map(async (u) => {
      try {
        const feed = await parser.parseURL(u);
        return (feed.items || []).map(normalize);
      } catch {
        return [];
      }
    })
  );

  let items = dedupe(all.flat());
  items.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  items = items.slice(0, 180);
  const data = { items };
  setCache("news", data);
  return data;
}

// --------- mood ----------
function share(count, total) {
  return total ? Math.round((count / total) * 100) : 0;
}

function computeMood(items) {
  const total = items.length;
  const pos = items.filter((x) => x.sentiment.label === "positive").length;
  const neg = items.filter((x) => x.sentiment.label === "negative").length;
  const neu = total - pos - neg;
  return { positive: share(pos, total), neutral: share(neu, total), negative: share(neg, total), count: total };
}

// real 4-hour windows from now back to 24h
function computeMoodTrend(items) {
  const now = Date.now();
  const buckets = [];
  for (let i = 24; i > 0; i -= 4) {
    const from = now - i * 3600_000;
    const to = from + 4 * 3600_000;
    const slice = items.filter((x) => {
      const t = new Date(x.publishedAt).getTime();
      return t >= from && t < to;
    });
    const m = computeMood(slice);
    buckets.push({
      from,
      to,
      label: new Date(from).toLocaleTimeString("en-IN", { hour: "2-digit" }),
      positive: m.positive,
      neutral: m.neutral,
      negative: m.negative,
      count: m.count
    });
  }
  return buckets;
}

// --------- leaderboard ----------
function computeLeaderboard(items) {
  const by = {};
  for (const it of items) {
    const s = it.source;
    if (!by[s]) by[s] = { pos: 0, neu: 0, neg: 0, count: 0 };
    by[s].count++;
    if (it.sentiment.label === "positive") by[s].pos++;
    else if (it.sentiment.label === "negative") by[s].neg++;
    else by[s].neu++;
  }
  const rows = Object.entries(by)
    .filter(([, v]) => v.count >= 3)
    .map(([source, v]) => {
      const t = v.count;
      return {
        source,
        count: t,
        positive: share(v.pos, t),
        neutral: share(v.neu, t),
        negative: share(v.neg, t)
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  return rows;
}

// --------- trending ----------
async function fetchTrendingTopics() {
  const cached = getCache("trending");
  if (cached) return cached;
  try {
    const res = await googleTrends.dailyTrends({ trendDate: new Date(), geo: "IN" });
    const json = JSON.parse(res);
    const list = json.default?.trendingSearchesDays?.[0]?.trendingSearches || [];
    const topics = list.map((x) => x.title?.query).filter(Boolean).slice(0, 6);
    const data = { topics };
    setCache("trending", data);
    return data;
  } catch {
    // token fallback from titles
    const { items } = await fetchNews();
    const freq = {};
    for (const it of items.slice(0, 100)) {
      it.title
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .forEach((w) => (freq[w] = (freq[w] || 0) + 1));
    }
    const topics = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([w]) => w);
    const data = { topics };
    setCache("trending", data);
    return data;
  }
}

// --------- API ----------
app.get("/api/news", async (_req, res) => {
  const data = await fetchNews();
  res.json(data);
});

app.get("/api/mood", async (_req, res) => {
  const { items } = await fetchNews();
  res.json(computeMood(items));
});

app.get("/api/mood-trend", async (_req, res) => {
  const { items } = await fetchNews();
  res.json({ buckets: computeMoodTrend(items) });
});

app.get("/api/leaderboard", async (_req, res) => {
  const { items } = await fetchNews();
  res.json({ rows: computeLeaderboard(items) });
});

app.get("/api/trending", async (_req, res) => {
  const topics = await fetchTrendingTopics();
  const { items } = await fetchNews();
  // attach per-topic sentiments from real articles
  const rows = (topics.topics || []).map((q) => {
    const hits = items.filter((i) => i.title.toLowerCase().includes(q.toLowerCase()));
    const m = computeMood(hits);
    return { topic: q, articles: hits.length, sources: new Set(hits.map((h) => h.source)).size, ...m };
  });
  res.json({ rows });
});

app.get("/healthz", (_req, res) => res.json({ ok: true, at: new Date().toISOString() }));

app.listen(PORT, () => console.log(`Informed360 listening on :${PORT}`));