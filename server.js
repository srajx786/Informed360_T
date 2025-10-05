/**
 * server.js (ESM version)
 * Compatible with package.json { "type": "module" }
 */

import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

// ---- Setup helpers (since __dirname is undefined in ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---- Mock seed data (safe fallback)
if (!global.articlesCache) {
  const now = Date.now();
  const add = (name, compounds) =>
    compounds.map((c, i) => ({
      title: `Mock article ${i + 1} - ${name}`,
      sourceName: name,
      publishedAt: new Date(now - i * 3600_000).toISOString(),
      sentiment: { compound: c },
    }));

  global.articlesCache = [
    ...add("The Hindu", [0.42, 0.12, -0.05, 0.25, 0.35, 0.55, -0.1, 0.08, 0.26, 0.33]),
    ...add("NDTV", [0.15, 0.05, -0.04, 0.22, 0.18, -0.07, 0.11, 0.09, 0.31, -0.02]),
    ...add("India Today", [0.21, 0.02, -0.12, 0.29, 0.14, 0.06, 0.07, -0.22, -0.06, 0.19]),
    ...add("News18", [0.05, -0.01, -0.02, 0.03, 0.02, -0.04, 0.06, 0.01, 0.03, -0.03]),
    ...add("Mint", [0.35, 0.22, 0.19, 0.27, -0.04, 0.18, 0.31, 0.24, 0.28, -0.06]),
    ...add("HT", [0.07, -0.12, 0.03, 0.11, 0.05, 0.01, 0.02, -0.04, 0.06, -0.03]),
    ...add("TOI", [0.13, 0.09, -0.01, 0.16, 0.05, 0.04, 0.07, -0.05, 0.08, 0.02]),
    ...add("IE", [0.1, 0.08, -0.02, 0.11, 0.07, -0.09, 0.03, 0.06, 0.02, 0.01]),
  ];
}

// ---- Sentiment helper
function bucket(compound) {
  if (compound > 0.05) return "pos";
  if (compound < -0.05) return "neg";
  return "neu";
}

// ---- Leaderboard API
app.get("/api/leaderboard", (req, res) => {
  try {
    const days = Number(req.query.days || 1);
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const all = (global.articlesCache || []).filter((a) => {
      const t = new Date(a.publishedAt || Date.now()).getTime();
      return t >= since && a.sourceName && a.sentiment && typeof a.sentiment.compound === "number";
    });

    const byPub = new Map();
    for (const a of all) {
      const key = a.sourceName.trim();
      if (!byPub.has(key)) byPub.set(key, { name: key, pos: 0, neu: 0, neg: 0, total: 0 });
      const row = byPub.get(key);
      row[bucket(a.sentiment.compound)]++;
      row.total++;
    }

    let items = Array.from(byPub.values())
      .map((r) => ({
        name: r.name,
        count: r.total,
        positive: Math.round((r.pos / r.total) * 100),
        neutral: Math.round((r.neu / r.total) * 100),
        negative: Math.round((r.neg / r.total) * 100),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    res.json({ items });
  } catch (e) {
    console.error("Leaderboard error:", e);
    res.status(500).json({ error: "leaderboard_failed" });
  }
});

// ---- Start
app.listen(PORT, () => console.log(`✅ Informed360 running at port ${PORT}`));
