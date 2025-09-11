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

// Cache
let CACHE = {
  fetchedAt: 0,
  articles: [],
  trending: [],
  byUrl: new Map()
};

const domainFromUrl = (u) => {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
};

const extractImage = (item) => {
  if (item.enclosure?.url) return item.enclosure.url;
  if (item["media:content"]?.url) return item["media:content"].url;
  if (item["media:thumbnail"]?.url) return item["media:thumbnail"].url;
  const d = domainFromUrl(item.link || "");
  return d ? `https://logo.clearbit.com/${d}` : "";
};

const scoreSentiment = (text) => {
  const s = vader.SentimentIntensityAnalyzer.polarity_scores(text || "");
  const tokens = (text || "")
    .toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/);
  const negHits = {};
  tokens.forEach((w) => { const v = vader.lexicon[w]; if (v && v < 0) negHits[w] = (negHits[w] || 0) + Math.abs(v); });
  const reasons = Object.entries(negHits).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([w])=>w);
  const posP = Math.round(s.pos * 100);
  const negP = Math.round(s.neg * 100);
  const neuP = Math.max(0, 100 - posP - negP);
  const label = s.compound >= 0.05 ? "positive" : s.compound <= -0.05 ? "negative" : "neutral";
  return { ...s, label, posP, negP, neuP, reasons };
};

const normalize = (t="") => t.toLowerCase().replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim();

const topicKey = (title) => {
  const w = normalize(title).split(" ").filter(Boolean);
  const bigrams = [];
  for (let i=0;i<w.length-1;i++) if (w[i].length>=3 && w[i+1].length>=3) bigrams.push(`${w[i]} ${w[i+1]}`);
  return bigrams.slice(0,3).join(" | ") || w.slice(0,3).join(" ");
};

const computeTrending = (articles) => {
  const map = new Map();
  for (const a of articles) {
    const key = topicKey(a.title);
    if (!key) continue;
    if (!map.has(key)) map.set(key,{ key, count:0, pos:0, neg:0, neu:0 });
    const t = map.get(key);
    t.count += 1; t.pos += a.sentiment.posP; t.neg += a.sentiment.negP; t.neu += a.sentiment.neuP;
  }
  return [...map.values()].map(t=>{
    const n = Math.max(1,t.count);
    return { topic:t.key, count:t.count,
      sentiment:{ pos:Math.round(t.pos/n), neg:Math.round(t.neg/n), neu:Math.round(t.neu/n) } };
  }).sort((a,b)=>b.count-a.count).slice(0,12);
};

const fetchAll = async () => {
  const articles = [];
  const byUrl = new Map();
  await Promise.all((FEEDS.feeds || []).map(async (url)=>{
    try{
      const feed = await parser.parseURL(url);
      (feed.items || []).slice(0,30).forEach((item)=>{
        const link = item.link || item.guid || "";
        if (!link || byUrl.has(link)) return;
        const title = item.title || "";
        const source = feed.title || domainFromUrl(link);
        const description = item.contentSnippet || item.summary || "";
        const publishedAt = item.isoDate || item.pubDate || new Date().toISOString();
        const image = extractImage(item);
        const sentiment = scoreSentiment(`${title}. ${description}`);
        const tooltip = sentiment.negP > 50 ? `Most negative terms: ${sentiment.reasons.join(", ")}` : "";
        const rec = { title, link, source, description, image, publishedAt, sentiment, tooltip };
        byUrl.set(link, rec); articles.push(rec);
      });
    }catch(e){ console.warn("RSS error", url, e.message); }
  }));
  articles.sort((a,b)=>new Date(b.publishedAt) - new Date(a.publishedAt));
  CACHE = { fetchedAt: Date.now(), articles, trending: computeTrending(articles), byUrl };
};

await fetchAll();
setInterval(fetchAll, REFRESH_MS);

// API
app.get("/api/news", (req,res)=> {
  const limit = Number(req.query.limit || 200);
  res.json({ fetchedAt: CACHE.fetchedAt, articles: CACHE.articles.slice(0,limit) });
});
app.get("/api/trending", (req,res)=> res.json({ fetchedAt: CACHE.fetchedAt, topics: CACHE.trending }));
app.get("/api/pinned", (req,res)=> {
  const pins = (FEEDS.pinned || []).map(u => CACHE.byUrl.get(u)).filter(Boolean).slice(0,3);
  res.json({ articles: pins });
});
app.get("/api/ticker", async (req,res)=>{
  try{
    const symbols = ["^BSESN", "^NSEI", "^NYA"];
    const quotes = await yahooFinance.quote(symbols);
    const out = quotes.map(q=>({
      symbol:q.symbol, shortName:q.shortName,
      price:q.regularMarketPrice,
      change:q.regularMarketChange,
      changePercent:q.regularMarketChangePercent
    }));
    res.json({ updatedAt: Date.now(), quotes: out });
  }catch(e){ res.status(500).json({ error: e.message }); }
});
app.get("/health", (req,res)=> res.json({ ok:true, at: Date.now() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log(`Informed360 running on :${PORT}`));
