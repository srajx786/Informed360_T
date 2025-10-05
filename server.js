/**
 * server.js
 * Minimal Express server that serves static files from /public
 * and provides /api/leaderboard which aggregates sentiment by publisher.
 *
 * NOTE:
 * - If your package.json has `"type": "module"`, switch `require(...)` to `import ... from`.
 * - The endpoint expects a global cache `global.articlesCache` with:
 *   { title, sourceName, publishedAt, sentiment: { compound: number } }
 *   If you call it something else, replace below.
 */

const express = require("express");
const cors = require("cors");
const path = require("path");

// ---- Setup
const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// ---- Static: serve frontend from /public
app.use(express.static(path.join(__dirname, "public")));

// ---- OPTIONAL: Seed mock data if you don't have a real pipeline yet
// Each item needs sourceName + sentiment.compound + publishedAt
if (!global.articlesCache) {
  const now = Date.now();
  const add = (name, compounds) =>
    compounds.map((c, i) => ({
      title: `Mock article ${i + 1} - ${name}`,
      sourceName: name,
      publishedAt: new Date(now - i * 3600_000).toISOString(),
      sentiment: { compound: c }
    }));

  global.articlesCache = [
    ...add("The Hindu", [0.42, 0.12, -0.05, 0.25, 0.35, 0.55, -0.10, 0.08, 0.26, 0.33]),
    ...add("NDTV", [0.15, 0.05, -0.04, 0.22, 0.18, -0.07, 0.11, 0.09, 0.31, -0.02]),
    ...add("India Today", [0.21, 0.02, -0.12, 0.29, 0.14, 0.06, 0.07, -0.22, -0.06, 0.19]),
    ...add("News18", [0.05, -0.01, -0.02, 0.03, 0.02, -0.04, 0.06, 0.01, 0.03, -0.03]),
    ...add("Mint", [0.35, 0.22, 0.19, 0.27, -0.04, 0.18, 0.31, 0.24, 0.28, -0.06]),
    ...add("HT", [0.07, -0.12, 0.03, 0.11, 0.05, 0.01, 0.02, -0.04, 0.06, -0.03]),
    ...add("TOI", [0.13, 0.09, -0.01, 0.16, 0.05, 0.04, 0.07, -0.05, 0.08, 0.02]),
    ...add("IE", [0.10, 0.08, -0.02, 0.11, 0.07, -0.09, 0.03, 0.06, 0.02, 0.01])
  ];
}

// ---- Helpers
function bucket(compound) {
  if (compound > 0.05) return "pos";
  if (compound < -0.05) return "neg";
  return "neu";
}

// ---- API: /api/leaderboard
// ?days=1 (default) – choose window to aggregate over
app.get("/api/leaderboard", (req, res) => {
  try {
    const days = Number(req.query.days || 1);
    const since = Date.now() - days * 24 * 60 * 60 * 1000;

    const all = (global.articlesCache || []).filter(a => {
      const t = new Date(a.publishedAt || a.isoDate || a.date || Date.now()).getTime();
      return (
        t >= since &&
        a.sourceName &&
        a.sentiment &&
        typeof a.sentiment.compound === "number"
      );
    });

    const byPub = new Map();
    for (const a of all) {
      const key = a.sourceName.trim();
      if (!byPub.has(key)) byPub.set(key, { name: key, pos: 0, neu: 0, neg: 0, total: 0 });
      const row = byPub.get(key);
      row[bucket(a.sentiment.compound)] += 1;
      row.total += 1;
    }

    let items = Array.from(byPub.values())
      .filter(r => r.total > 0)
      .map(r => ({
        name: r.name,
        count: r.total,
        positive: Math.round((r.pos / r.total) * 100),
        neutral: Math.round((r.neu / r.total) * 100),
        negative: Math.round((r.neg / r.total) * 100)
      }));

    // Sort by volume; keep top 8
    items.sort((a, b) => b.count - a.count);
    items = items.slice(0, 8);

    res.json({ items });
  } catch (e) {
    console.error("Leaderboard error:", e);
    res.status(500).json({ error: "leaderboard_failed" });
  }
});

// ---- Start
app.listen(PORT, () => {
  console.log(`✅ Informed360 server running on port ${PORT}`);
});
