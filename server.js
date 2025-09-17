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
 * trending topics, and exposes endpoints that the front‑end uses to
 * populate the site. It also queries the Yahoo Finance API for a live
 * market ticker (Sensex, Nifty and NYSE Composite). No values are
 * hard‑coded beyond the feed list; everything refreshes on a timer.
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
// Initialize the in‑memory cache.  Articles, trending queries and aggregated clusters
// are refreshed on a timer.  See fetchAll() for the logic that populates this cache.
let CACHE = {
  fetchedAt: 0,
  /**
   * articles holds the raw list of news stories scraped from the RSS feeds.  Each
   * article has title, link, source, description, image, publishedAt, sentiment
   * and tooltip fields.
   */
  articles: [],
  /**
   * trending holds the sentiment summary for the top search queries from Google
   * Trends.  Each entry looks like: { topic: string, count: number,
   *   sentiment: { pos, neg, neu }, sources: number }.  The `count`
   * property is the number of matching articles in our feed, and `sources`
   * is the number of unique news sources that mention the query.
   */
  trending: [],
  /**
   * topics holds aggregated news clusters computed from the fetched RSS
   * articles.  Each entry looks like: { title: string, count: number,
   *   sentiment: { pos, neg, neu }, image: string, sources: number }.
   * This list powers the Trending News panel on the client.
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
  // For each search query, count how many articles mention the query,
  // accumulate sentiment scores and track the number of unique news sources.
  return queries.map((q) => {
    const qLower = q.toLowerCase();
    let count = 0;
    let pos = 0;
    let neg = 0;
    let neu = 0;
    const srcSet = new Set();
    articles.forEach((a) => {
      const title = (a.title || '').toLowerCase();
      if (title.includes(qLower)) {
        count += 1;
        pos += a.sentiment.posP;
        neg += a.sentiment.negP;
        neu += a.sentiment.neuP;
        if (a.source) srcSet.add(a.source);
      }
    });
    const denom = Math.max(1, count);
    return {
      topic: q,
      count,
      sources: srcSet.size,
      sentiment: {
        pos: Math.round(pos / denom),
        neg: Math.round(neg / denom),
        neu: Math.round(neu / denom)
      }
    };
  });
}

// Extract an image from a feed item, falling back to Clearbit domain logos
const extractImage = (item) => {
  if (item.enclosure && item.enclosure.url) return item.enclosure.url;
  if (item["media:content"]?.url) return item["media:content"].url;
  if (item["media:thumbnail"]?.url) return item["media:thumbnail"].url;
  const d = domainFromUrl(item.link || "");
  return d ? `https://logo.clearbit.com/${d}` : "";
};

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

// Compute aggregated clusters of articles based on their topic key (bigrams).  Each
// cluster summarises multiple news stories that share a common phrase.  We
// accumulate sentiment values, record the first image and count unique
// sources.  The returned array is sorted by descending article count and
// trimmed to the top 12 clusters.
const computeClusters = (articles) => {
  const map = new Map();
  for (const a of articles) {
    const key = topicKey(a.title);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        key,
        count: 0,
        pos: 0,
        neg: 0,
        neu: 0,
        image: a.image,
        sources: new Set(),
      });
    }
    const cluster = map.get(key);
    cluster.count += 1;
    cluster.pos += a.sentiment.posP;
    cluster.neg += a.sentiment.negP;
    cluster.neu += a.sentiment.neuP;
    // Preserve the first non‑empty image encountered
    if (!cluster.image && a.image) cluster.image = a.image;
    cluster.sources.add(a.source);
  }
  return [...map.values()]
    .map((c) => {
      const n = Math.max(1, c.count);
      return {
        title: c.key,
        count: c.count,
        sentiment: {
          pos: Math.round(c.pos / n),
          neg: Math.round(c.neg / n),
          neu: Math.round(c.neu / n),
        },
        image: c.image || "",
        sources: c.sources.size,
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
          const image = extractImage(item);
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
  // Compute aggregated clusters from the fetched articles.  These clusters
  // summarise multiple stories into a single topic and include an image and
  // overall sentiment.  This array is used for the Trending News carousel.
  const clusters = computeClusters(articles);

  // Fetch trending search queries from Google and compute sentiment across
  // our articles.  Each item in `trendingFeed` contains a topic (the search
  // query), the number of matching articles and average sentiment.  We also
  // record the number of unique sources per query.
  const trendingQueries = await fetchTrendingFeed();
  const trendingFeed = computeTrendingFeedSentiment(trendingQueries, articles).map((item) => {
    const qLower = item.topic.toLowerCase();
    const sources = new Set();
    articles.forEach((a) => {
      if ((a.title || "").toLowerCase().includes(qLower)) sources.add(a.source);
    });
    return { ...item, sources: sources.size };
  });

  CACHE = {
    fetchedAt: Date.now(),
    articles,
    trending: trendingFeed,
    topics: clusters,
    byUrl,
  };
};

// Start initial fetch and schedule periodic refresh
await fetchAll();
setInterval(fetchAll, REFRESH_MS);

/*
 * API Endpoints
 *
 * /api/news?limit=n - Get latest n articles
 * /api/trending - Get trending topics
 * /api/topics   - Get aggregated clusters for Trending News
 * /api/pinned   - Get pinned articles defined in rss-feeds.json
 * /api/ticker   - Get market quotes for Sensex, Nifty and NYSE
 */
app.get("/api/news", (req, res) => {
  const limit = Number(req.query.limit || 200);
  res.json({ fetchedAt: CACHE.fetchedAt, articles: CACHE.articles.slice(0, limit) });
});

app.get("/api/trending", (req, res) => {
  res.json({ fetchedAt: CACHE.fetchedAt, topics: CACHE.trending });
});

// Return the aggregated news clusters.  These topics represent groups of
// articles that share a common phrase in their titles.  Each cluster
// includes an image (from the first article), an overall sentiment and the
// number of unique sources contributing to the cluster.  Clients use this
// endpoint to populate the Trending News panel.
app.get("/api/topics", (req, res) => {
  res.json({ fetchedAt: CACHE.fetchedAt, topics: CACHE.topics });
});

app.get("/api/pinned", (req, res) => {
  const pins = (FEEDS.pinned || [])
    .map((u) => CACHE.byUrl.get(u))
    .filter(Boolean)
    .slice(0, 3);
  res.json({ articles: pins });
});

app.get("/api/ticker", async (req, res) => {
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

app.get("/health", (req, res) => res.json({ ok: true, at: Date.now() }));

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Informed360 running on :${PORT}`);
});
