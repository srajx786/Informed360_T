async function loadNews() {
  const res = await fetch("/api/news");
  const { articles } = await res.json();

  const heroDiv = document.getElementById("hero");
  const pinnedDiv = document.getElementById("pinned");
  const trendingDiv = document.getElementById("trending");

  heroDiv.innerHTML = "";
  pinnedDiv.innerHTML = "";
  trendingDiv.innerHTML = "";

  // Pinned = top 2
  articles.slice(0, 2).forEach((a) => {
    pinnedDiv.innerHTML += `
      <div class="card pinned-card">
        <h4>${a.title}</h4>
        <p>${a.source}</p>
        <div class="sentiment-bar ${a.sentiment}">${a.sentiment}</div>
      </div>`;
  });

  // Hero = top 4
  articles.slice(0, 4).forEach((a) => {
    heroDiv.innerHTML += `
      <div class="card hero-card">
        <h4>${a.title}</h4>
        <p>${a.source}</p>
        <a href="${a.link}" target="_blank" class="read">Read Analysis</a>
        <div class="sentiment-bar ${a.sentiment}">${a.sentiment}</div>
      </div>`;
  });

  // Trending = 3 random
  articles
    .sort(() => 0.5 - Math.random())
    .slice(0, 3)
    .forEach((a) => {
      trendingDiv.innerHTML += `
      <div class="card trend-card">
        <h4>${a.title}</h4>
        <p>${a.source}</p>
        <div class="sentiment-bar ${a.sentiment}">${a.sentiment}</div>
      </div>`;
    });
}

async function loadMood() {
  const res = await fetch("/api/mood");
  const data = await res.json();
  const el = document.getElementById("mood-ticker");
  el.innerHTML = `
  Nation’s Mood — 
  <span class="pos">Positive ${data.positive}%</span> • 
  <span class="neu">Neutral ${data.neutral}%</span> • 
  <span class="neg">Negative ${data.negative}%</span>
  `;
  updateMoodChart(data);
}

function updateMoodChart(data) {
  const ctx = document.getElementById("moodChart").getContext("2d");
  new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["00:00", "04:00", "08:00", "12:00", "16:00", "20:00", "24:00"],
      datasets: [
        {
          label: "Positive",
          data: [10, 9, 11, 9, 10, 11, 11],
          backgroundColor: "#1DB954",
        },
        {
          label: "Negative",
          data: [-10, -9, -10, -8, -9, -10, -9],
          backgroundColor: "#E63946",
        },
      ],
    },
    options: {
      plugins: {
        legend: { position: "top" },
      },
      scales: {
        y: {
          min: -20,
          max: 20,
          ticks: {
            callback: function (value) {
              return Math.abs(value) + "%";
            },
          },
        },
      },
    },
  });
}

loadNews();
loadMood();
setInterval(loadMood, 1000 * 60 * 10); // refresh every 10 minutes
