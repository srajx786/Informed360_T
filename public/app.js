// public/app.js
// Renders a 0–100% stacked bar chart (Positive/Neutral/Negative) with
// article counts above each bar – colors match your site.

(async function mountLeaderboard() {
  const canvas = document.getElementById("leaderboardChart");
  if (!canvas) return;

  // 1) Fetch leaderboard data
  let rows = [];
  try {
    const r = await fetch("/api/leaderboard?days=1");
    const j = await r.json();
    rows = j.items || [];
  } catch (e) {
    console.warn("Leaderboard API failed, using fallback.", e);
    rows = [
      { name: "The Hindu", count: 32, positive: 46, neutral: 39, negative: 15 },
      { name: "NDTV", count: 28, positive: 38, neutral: 45, negative: 17 },
      { name: "India Today", count: 24, positive: 34, neutral: 48, negative: 18 },
      { name: "News18", count: 20, positive: 22, neutral: 60, negative: 18 },
      { name: "Mint", count: 18, positive: 41, neutral: 42, negative: 17 },
      { name: "HT", count: 22, positive: 29, neutral: 53, negative: 18 },
      { name: "TOI", count: 26, positive: 33, neutral: 51, negative: 16 },
      { name: "IE", count: 19, positive: 28, neutral: 55, negative: 17 }
    ];
  }

  const labels = rows.map(r => r.name);
  const counts = rows.map(r => r.count);
  const positive = rows.map(r => r.positive);
  const neutral  = rows.map(r => r.neutral);
  const negative = rows.map(r => r.negative);

  // 2) Colors (keep exactly as your sentiment bars)
  const colorPos = "#2ecc71"; // green
  const colorNeu = "#bdc3c7"; // gray
  const colorNeg = "#e74c3c"; // red

  // 3) Plugin to draw "N articles" above each bar
  const CountPlugin = {
    id: "count-plugin",
    afterDatasetsDraw(chart) {
      const { ctx, chartArea: { top }, scales: { x, y } } = chart;
      ctx.save();
      ctx.font = "10px Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
      ctx.fillStyle = "#445";
      ctx.textAlign = "center";
      labels.forEach((_, i) => {
        const xPos = x.getPixelForValue(i);
        // draw slightly above 100% – cap to top area for small charts
        const yPos = y.getPixelForValue(105);
        ctx.fillText(`${counts[i]} articles`, xPos, Math.max(top + 10, yPos));
      });
      ctx.restore();
    }
  };

  // 4) Chart.js stacked bar
  new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Positive", data: positive, backgroundColor: colorPos, stack: "sent" },
        { label: "Neutral",  data: neutral,  backgroundColor: colorNeu, stack: "sent" },
        { label: "Negative", data: negative, backgroundColor: colorNeg, stack: "sent" }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          stacked: true,
          ticks: {
            // slightly rotate for readability (like your reference image)
            maxRotation: 35,
            minRotation: 35
          },
          grid: { display: false }
        },
        y: {
          stacked: true,
          min: 0,
          max: 110, // extra headroom for count labels
          ticks: {
            callback: (v) => (v <= 100 ? `${v}%` : "")
          },
          grid: { drawBorder: false }
        }
      },
      plugins: {
        legend: { position: "top", labels: { usePointStyle: true } },
        tooltip: {
          callbacks: {
            title: items => labels[items[0].dataIndex],
            afterTitle: items => `${counts[items[0].dataIndex]} articles`
          }
        }
      },
      animation: false
    },
    plugins: [CountPlugin]
  });
})();
