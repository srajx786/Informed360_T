import express from "express";
import cors from "cors";
import Parser from "rss-parser";
import vader from "vader-sentiment";
import yahooFinance from "yahoo-finance2";
import fs from "fs";
import path from "path";

/*
 * Informed360 server
 *
 * This script implements a simple Express API that fetches live RSS feeds,
 * calculates sentiment using the VADER sentiment analyzer, aggregates
 * trending topics, and exposes endpoints that the front-end uses to
 * populate the site. It also queries the Yahoo Finance API for a live
 * market ticker (Sensex, Nifty and NYSE Composite). No values are
 * hard-coded beyond the feed list; everything refreshes on a timer.
 */

const app = express();
app.use(cors());
app.use(express.json());

// Serve static assets from ./public
const __dirname = path.resolve();
app.use(express.static(path.join(__dirname, "public")));

// Load feed configuration
const FEEDS = JSON.parse(
  fs.readFileSync(path.join(__dirname, "rss-feeds.json"), "utf-8")
);
const REFRESH_MS = Math.max(2, FEEDS.refreshMinutes || 7) * 60 * 1000;

const parser = new Parser({
  timeout: 15000,
  headers: { "user-agent": "Informed360/1.0 (+https://informed360.news)" }
});

// Cache for articles, trending search topics and grouped topics; refreshed periodically
let CACHE = {
  fetchedAt: 0,
  articles: [],
  /**
   * trending holds an array of objects derived from Google Trends.
   * Each item looks like: { topic: string, count: number, sentiment: { pos, neg, neu } }.
   */
  trending: [],
  /**
   * topics holds aggregated topics computed from the fetched RSS articles themselves.
   * Each entry looks like: { topic: string, count: number, sentiment: { pos, neg, neu } }.
   * This is used for the Top News (by volume) section on the client.
   */
  topics: [],
  byUrl: new Map()
};

// Extract domain name from URL for fallback logos
const domainFromUrl = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/*
 * Fetch trending search queries from Google Trends.
 * Uses the daily trending RSS feed for India (since the user is based in Bengaluru).
 * Returns an array of search query strings, or an empty array if fetch fails.
 */
async function fetchTrendingFeed() {
  const url = "https://trends.google.com/trends/trendingsearches/daily/rss?geo=IN";
  try {
    const feed = await parser.parseURL(url);
    const items = feed.items || [];
    // Extract up to 10 trending search queries
    return items.slice(0, 10).map((i) => i.title || "").filter(Boolean);
  } catch (err) {
    console.warn("Trending feed error", err.message);
    return [];
  }
}

/*
 * Given a list of search queries from Google Trends and the fetched articles,
 * compute a sentiment summary for each query. Each result contains the topic,
 * the number of articles whose title includes the query, and average sentiment.
 */
function computeTrendingFeedSentiment(queries, articles) {
  return queries.map((q) => {
    const qLower = q.toLowerCase();
    let count = 0;
    let pos = 0;
    let neg = 0;
    let neu = 0;
    articles.forEach((a) => {
      if ((a.title || "").toLowerCase().includes(qLower)) {
        count += 1;
        pos += a.sentiment.posP;
        neg += a.sentiment.negP;
        neu += a.sentiment.neuP;
      }
    });
    const denom = Math.max(1, count);
    return {
      topic: q,
      count,
      sentiment: {
        pos: Math.round(pos / denom),
        neg: Math.round(neg / denom),
        neu: Math.round(neu / denom)
      }
    };
  });
}

// Calculate sentiment using VADER. Returns object with percentage values
// for positive, neutral and negative sentiment and the most negative words.
// This implementation guards against undefined lexicon references in ESM modules.
const scoreSentiment = (text) => {
  const safeText = typeof text === "string" ? text : "";
  const s =
    vader.SentimentIntensityAnalyzer.polarity_scores(safeText || "") || {
      pos: 0,
      neg: 0,
      neu: 1,
      compound: 0
    };
  // Resolve the lexicon from different module shapes safely
  const lexicon =
    (vader && (vader.lexicon || vader.default?.lexicon)) || {};
  const tokens = safeText
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const negHits = {};
  tokens.forEach((w) => {
    const v = typeof lexicon[w] === "number" ? lexicon[w] : undefined;
    if (typeof v === "number" && v < 0) {
      negHits[w] = (negHits[w] || 0) + Math.abs(v);
    }
  });
  const reasons = Object.entries(negHits)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([w]) => w);
  const posP = Math.round((s.pos || 0) * 100);
  const negP = Math.round((s.neg || 0) * 100);
  const neuP = Math.max(0, 100 - posP - negP);
  const label =
    (s.compound ?? 0) >= 0.05
      ? "positive"
      : (s.compound ?? 0) <= -0.05
      ? "negative"
      : "neutral";
  return { ...s, label, posP, negP, neuP, reasons };
};

// Normalize text by stripping punctuation and lowercasing
const normalize = (t = "") =>
  t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

// Generate a topic key from a title by extracting bigrams
const topicKey = (title) => {
  const w = normalize(title).split(" ").filter(Boolean);
  const bigrams = [];
  for (let i = 0; i < w.length - 1; i++) {
    if (w[i].length >= 3 && w[i + 1].length >= 3) {
      bigrams.push(`${w[i]} ${w[i + 1]}`);
    }
  }
  return bigrams.slice(0, 3).join(" | ") || w.slice(0, 3).join(" ");
};

// Compute trending topics by grouping articles by topic key
const computeTrending = (articles) => {
  const map = new Map();
  for (const a of articles) {
    const key = topicKey(a.title);
    if (!key) continue;
    if (!map.has(key)) map.set(key, { key, count: 0, pos: 0, neg: 0, neu: 0 });
    const t = map.get(key);
    t.count += 1;
    t.pos += a.sentiment.posP;
    t.neg += a.sentiment.negP;
    t.neu += a.sentiment.neuP;
  }
  return [...map.values()]
    .map((t) => {
      const n = Math.max(1, t.count);
      return {
        topic: t.key,
        count: t.count,
        sentiment: {
          pos: Math.round(t.pos / n),
          neg: Math.round(t.neg / n),
          neu: Math.round(t.neu / n)
        }
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
};

// Fetch all configured RSS feeds and populate the cache
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
          const image = (item.enclosure && item.enclosure.url) ||
            (item["media:content"]?.url) ||
            (item["media:thumbnail"]?.url) ||
            (domainFromUrl(item.link || "") ? `https://logo.clearbit.com/${domainFromUrl(item.link || "")}` : "");
          const sentiment = scoreSentiment(`${title}. ${description}`);
          const tooltip =
            sentiment.negP > 50
              ? `Most negative terms: ${sentiment.reasons.join(", ")}`
              : "";
          const rec = {
            title,
            link,
            source,
            description,
            image,
            publishedAt,
            sentiment,
            tooltip
          };
          byUrl.set(link, rec);
          articles.push(rec);
        });
      } catch (e) {
        console.warn("RSS error", url, e.message);
      }
    })
  );
  articles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  // Compute grouped topics from the fetched articles
  const topics = computeTrending(articles);
  // Fetch trending search queries and calculate their sentiment across articles
  const trendingQueries = await fetchTrendingFeed();
  const trendingFeed = computeTrendingFeedSentiment(trendingQueries, articles);
  CACHE = {
    fetchedAt: Date.now(),
    articles,
    trending: trendingFeed,
    topics,
    byUrl
  };
};

// Start initial fetch and schedule periodic refresh
await fetchAll();
setInterval(fetchAll, REFRESH_MS);

/*
 * API Endpoints
 *
 * /api/news?limit=n - Get latest n articles
 * /api/trending - Get trending topics (from Google Trends)
 * /api/pinned - Get pinned articles defined in rss-feeds.json
 * /api/ticker - Get market quotes for Sensex, Nifty and NYSE
 */
app.get("/api/news", (req, res) => {
  const limit = Number(req.query.limit || 200);
  res.json({ fetchedAt: CACHE.fetchedAt, articles: CACHE.articles.slice(0, limit) });
});

app.get("/api/trending", (_req, res) => {
  res.json({ fetchedAt: CACHE.fetchedAt, topics: CACHE.trending });
});

app.get("/api/pinned", (_req, res) => {
  const pins = (FEEDS.pinned || [])
    .map((u) => CACHE.byUrl.get(u))
    .filter(Boolean)
    .slice(0, 3);
  res.json({ articles: pins });
});

app.get("/api/ticker", async (_req, res) => {
  try {
    // BSE Sensex, NSE Nifty and NYSE Composite
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

app.get("/health", (_req, res) => res.json({ ok: true, at: Date.now() }));

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Informed360 running on :${PORT}`);
});
