import express from "express";
import cors from "cors";
import Parser from "rss-parser";
import vader from "vader-sentiment";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.static("public"));

const parser = new Parser();

// --- RSS sources ---
const feeds = [
  "https://timesofindia.indiatimes.com/rssfeedstopstories.cms",
  "https://feeds.feedburner.com/NDTV-LatestNews",
  "https://indianexpress.com/feed/",
  "https://www.hindustantimes.com/feeds/rss/india-news/rssfeed.xml",
  "https://www.thehindu.com/news/national/feeder/default.rss",
];

// --- Helper: analyze sentiment ---
function analyzeSentiment(text) {
  const result = vader.SentimentIntensityAnalyzer.polarity_scores(text);
  if (result.compound >= 0.05) return "positive";
  if (result.compound <= -0.05) return "negative";
  return "neutral";
}

// --- Fetch all news ---
app.get("/api/news", async (req, res) => {
  try {
    let articles = [];
    for (const url of feeds) {
      try {
        const feed = await parser.parseURL(url);
        feed.items.slice(0, 5).forEach((item) => {
          const sentiment = analyzeSentiment(item.title + " " + (item.contentSnippet || ""));
          articles.push({
            title: item.title,
            link: item.link,
            source: feed.title || "News",
            sentiment,
            date: item.pubDate || new Date().toISOString(),
          });
        });
      } catch (err) {
        console.error("Feed error:", url, err.message);
      }
    }
    res.json({ articles });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load news" });
  }
});

// --- Nation’s mood aggregate ---
app.get("/api/mood", async (req, res) => {
  try {
    const resp = await fetch("http://localhost:3000/api/news");
    const { articles } = await resp.json();

    const total = articles.length || 1;
    const pos = articles.filter((a) => a.sentiment === "positive").length;
    const neg = articles.filter((a) => a.sentiment === "negative").length;
    const neu = total - pos - neg;

    res.json({
      positive: Math.round((pos / total) * 100),
      neutral: Math.round((neu / total) * 100),
      negative: Math.round((neg / total) * 100),
    });
  } catch (err) {
    console.error(err);
    res.json({ positive: 0, neutral: 0, negative: 0 });
  }
});

// --- serve frontend ---
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
