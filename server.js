import express from "express";
import cors from "cors";
import Parser from "rss-parser";
import vader from "vader-sentiment";
import yahooFinance from "yahoo-finance2";
import fs from "fs";
import path from "path";

/*
 * Informed 360 server — Indian edition
 *
 * This Express server aggregates RSS feeds from Indian news sources,
 * computes sentiment using VADER and exposes REST endpoints:
 *   GET /api/news   → latest articles
 *   GET /api/topics → clusters of similar headlines with sentiment
 *   GET /api/pinned → optional pinned articles from rss-feeds.json
 *   GET /api/ticker → Sensex, Nifty and NYSE index data
 *   GET /health    → health check
 */

const app = express();
app.use(cors());
app.use(express.json());

// serve static files from the "public" directory
const __dirname = path.resolve();
app.use(express.static(path.join(__dirname, "public")));

// load feed configuration
const FEEDS = JSON.parse(fs.readFileSync(path.join(__dirname, "rss-feeds.json"), "utf-8"));
// default refresh every 10 minutes unless overridden in the JSON
const REFRESH_MS = Math.max(2, FEEDS.refreshMinutes || 10) * 60 * 1000;

// initialise RSS parser
const parser = new Parser({
  timeout: 15000,
  headers: { "user-agent": "Informed360/1.0 (+https://informed360.news)" }
});

// in‑memory cache
let CACHE = { fetchedAt: 0, articles: [], byUrl: new Map() };

// extract domain for fallback images
const domainFromUrl = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

// attempt to extract an image from the RSS item
const extractImage = (item) => {
  if (item.enclosure?.url) return item.enclosure.url;
  if (item["media:content"]?.url) return item["media:content"].url;
  if (item["media:thumbnail"]?.url) return item["media:thumbnail"].url;
  const d = domainFromUrl(item.link || "");
  return d ? `https://logo.clearbit.com/${d}` : "";
};

// compute VADER sentiment
const scoreSentiment = (text) => {
  const s = vader.SentimentIntensityAnalyzer.polarity_scores(text || "") || { pos: 0, neg: 0, neu: 1, compound: 0 };
  const posP = Math.round((s.pos || 0) * 100);
  const negP = Math.round((s.neg || 0) * 100);
  const neuP = Math.max(0, 100 - posP - negP);
  const label = (s.compound ?? 0) >= 0.05 ? "positive" : (s.compound ?? 0) <= -0.05 ? "negative" : "neutral";
  return { ...s, label, posP, negP, neuP, reasons: [] };
};

// normalise text for clustering
const normalize = (t = "") => t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

// derive a topic key by taking the first three bigrams
const topicKey = (title) => {
  const w = normalize(title).split(" ").filter(Boolean);
  const bigrams = [];
  for (let i = 0; i < w.length - 1; i++) {
    if (w[i].length >= 3 && w[i + 1].length >= 3) bigrams.push(`${w[i]} ${w[i + 1]}`);
  }
  return bigrams.slice(0, 3).join(" | ") || w.slice(0, 3).join(" ");
};

// group articles into clusters and compute average sentiment
const computeClusters = (articles) => {
  const map = new Map();
  for (const a of articles) {
    const key = topicKey(a.title);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, { key, count: 0, pos: 0, neg: 0, neu: 0, sources: new Set() });
    }
    const c = map.get(key);
    c.count += 1;
    c.pos += a.sentiment.posP;
    c.neg += a.sentiment.negP;
    c.neu += a.sentiment.neuP;
    if (a.source) c.sources.add(a.source);
  }
  return [...map.values()]
    .map((c) => {
      const n = Math.max(1, c.count);
      return {
        title: c.key,
        count: c.count,
        sources: c.sources.size,
        sentiment: {
          pos: Math.round(c.pos / n),
          neg: Math.round(c.neg / n),
          neu: Math.round(c.neu / n)
        }
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
};

// fetch all feeds and update the cache
const fetchAll = async () => {
  const articles = [];
  const byUrl = new Map();
  await Promise.all(
    (FEEDS.feeds || []).map(async (url) => {
      try {
        const feed = await parser.parseURL(url);
        (feed.items || []).slice(0, 30).forEach((item) => {
          const link = item.link || item.guid || "";
          if (!link || byUrl.has(link)) return;
          const title = item.title || "";
          const source = feed.title || domainFromUrl(link);
          const description = item.contentSnippet || item.summary || "";
          const publishedAt = item.isoDate || item.pubDate || new Date().toISOString();
          const image = extractImage(item);
          const sentiment = scoreSentiment(`${title}. ${description}`);
          const rec = { title, link, source, description, image, publishedAt, sentiment };
          byUrl.set(link, rec);
          articles.push(rec);
        });
      } catch (e) {
        console.warn("RSS error", url, e.message);
      }
    })
  );
  articles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  CACHE = { fetchedAt: Date.now(), articles, byUrl };
};

// initial fetch and periodic refresh
await fetchAll();
setInterval(fetchAll, REFRESH_MS);

// REST endpoints
app.get("/api/news", (req, res) => {
  const limit = Number(req.query.limit || 200);
  res.json({ fetchedAt: CACHE.fetchedAt, articles: CACHE.articles.slice(0, limit) });
});
app.get("/api/topics", (req, res) => {
  res.json({ fetchedAt: CACHE.fetchedAt, topics: computeClusters(CACHE.articles) });
});
app.get("/api/pinned", (req, res) => {
  const pins = (FEEDS.pinned || []).map((u) => CACHE.byUrl.get(u)).filter(Boolean).slice(0, 3);
  res.json({ articles: pins });
});
app.get("/api/ticker", async (req, res) => {
  try {
    const symbols = ["^BSESN", "^NSEI", "^NYA"];
    const quotes = await yahooFinance.quote(symbols);
    const out = quotes.map((q) => ({
      symbol: q.symbol,
      shortName: q.shortName,
      price: q.regularMarketPrice,
      change: q.regularMarketChange,
      changePercent: q.regularMarketChangePercent
    }));
    res.json({ updatedAt: Date.now(), quotes: out });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.get("/health", (req, res) => res.json({ ok: true, at: Date.now() }));

// start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Informed360 running on :${PORT}`));
