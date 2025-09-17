import express from "express";
import cors from "cors";
import Parser from "rss-parser";
import vader from "vader-sentiment";
import yahooFinance from "yahoo-finance2";
import fs from "fs";
import path from "path";

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

// Cache for articles, trending topics, clusters and lookup map
let CACHE = {
  fetchedAt: 0,
  articles: [],
  trending: [],
  topics: [],
  byUrl: new Map()
};

const domainFromUrl = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/*
 * Given a list of search queries from Google Trends and the fetched articles,
 * compute a sentiment summary for each query. Each result contains the topic,
 * the number of articles whose title includes the query, the number of unique sources,
 * and average sentiment percentages.
 */
function computeTrendingFeedSentiment(queries, articles) {
  return queries.map((q) => {
    const qLower = q.toLowerCase();
    let count = 0;
    let pos = 0;
    let neg = 0;
    let neu = 0;
    const srcSet = new Set();
    articles.forEach((a) => {
      const title = (a.title || "").toLowerCase();
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

// You may already have computeTrending/clusters here; leave them unchanged.

// Periodically fetch all feeds and refresh cache
const fetchAll = async () => {
  const articles = [];
  const byUrl = new Map();
  await Promise.all((FEEDS.feeds || []).map(async (url) => {
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
        const tooltip = sentiment.negP > 50 ? `Most negative terms: ${sentiment.reasons.join(", ")}` : "";
        const rec = { title, link, source, description, image, publishedAt, sentiment, tooltip };
        byUrl.set(link, rec);
        articles.push(rec);
      });
    } catch (e) {
      console.warn("RSS error", url, e.message);
    }
  }));
  articles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  // Assuming you compute cluster topics here (CACHE.topics)...
  // Compute trending queries from Google Trends and then call the new aggregator:
  const trendingQueries = await fetchTrendingFeed(); // unchanged
  const trendingFeed = computeTrendingFeedSentiment(trendingQueries, articles);
  CACHE = {
    fetchedAt: Date.now(),
    articles,
    trending: trendingFeed,
    topics: CACHE.topics, // leave unchanged if you compute clusters
    byUrl
  };
};

// API endpoints unchanged...
