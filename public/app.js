// Utility selectors
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];

// Format a number as a percentage string
const fmtPct = (n) => `${Math.max(0, Math.min(100, Math.round(n)))}%`;

// Render a sentiment bar given a sentiment object {posP, neuP, negP}
// Optionally accepts a tooltip string that appears when negative > 50%
const renderSentiment = (s, tip = "") => {
  const pos = Math.max(0, s.posP);
  const neu = Math.max(0, s.neuP);
  const neg = Math.max(0, s.negP);
  const negTip = neg > 50 ? tip || "This article skews negative." : "";
  return `
    <div class="sentiment tooltip" ${negTip ? `data-tip="${negTip}"` : ""}>
      <div class="bar">
        <span class="segment pos" style="width:${pos}%"></span>
        <span class="segment neu" style="width:${neu}%"></span>
        <span class="segment neg" style="width:${neg}%"></span>
      </div>
      <div class="scores">
        <span>Positive ${fmtPct(pos)}</span>
        <span>Negative ${fmtPct(neg)}</span>
      </div>
    </div>
  `;
};

// Application state
const state = {
  articles: [],
  topics: [],     // aggregated news clusters (for Trending News)
  trending: [],   // Google trending topics with article and source counts
  pins: [],
  slideIndex: 0,
  theme: localStorage.getItem("theme") || "dark"
};

// Apply the current theme by setting a data attribute and toggling the icon
function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.theme);
  const btn = document.getElementById("themeToggle");
  if (btn) {
    btn.textContent = state.theme === "light" ? "🌙" : "☀️";
  }
}

// Toggle between dark and light themes
function toggleTheme() {
  state.theme = state.theme === "light" ? "dark" : "light";
  localStorage.setItem("theme", state.theme);
  applyTheme();
}

// Fetch JSON from an endpoint
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Load all data and render the page
async function loadAll() {
  const [news, clusters, trends, pins, ticker] = await Promise.all([
    fetchJSON("/api/news"),
    fetchJSON("/api/topics"),
    fetchJSON("/api/trending"),
    fetchJSON("/api/pinned"),
    fetchJSON("/api/ticker").catch(() => ({ quotes: [] }))
  ]);
  state.articles = news.articles;
  state.topics   = (clusters && clusters.topics) || [];
  state.trending = trends.topics;
  state.pins     = pins.articles || [];
  renderTicker(ticker.quotes || []);
  renderMainHero();
  renderTopics();
  renderPinned();
  renderTrending();
  renderDaily();
  $("#year").textContent = new Date().getFullYear();
  applyTheme();
}

// Render the live market ticker
function renderTicker(quotes) {
  const indices = [
    { symbol: "^BSESN", name: "BSE Sensex" },
    { symbol: "^NSEI", name: "Nifty 50" },
    { symbol: "^NYA",  name: "NYSE Composite" }
  ];
  const line = indices.map((info, idx) => {
    const q = (quotes && quotes[idx]) || {};
    const change = typeof q.change === "number" ? q.change : 0;
    const price  = typeof q.price === "number" ? q.price : null;
    const changePct = typeof q.changePercent === "number" ? (q.changePercent * 100).toFixed(2) : null;
    const cls    = change >= 0 ? "up" : "down";
    const priceStr = price != null ? price.toFixed(2) : "--";
    const pctStr   = changePct != null ? `${changePct}%` : "--";
    return `<span>${info.name}: <span class="${cls}">${priceStr} (${pctStr})</span></span>`;
  }).join(" · ");
  $("#ticker").innerHTML = line;
}

// Helper to take the first n items of an array
function pickTop(arr, n) { return arr.slice(0, n); }

// Render the hero carousel with the top four articles
function renderCarousel() {
  const top4 = pickTop(state.articles, 4);
  $("#slides").innerHTML = top4.map((a) => `
    <article class="slide">
      <img src="${a.image}" alt="">
      <a href="${a.link}" target="_blank"><strong>${a.title}</strong></a>
      <div class="meta"><span class="source">${a.source}</span> <span>•</span> <span>${new Date(a.publishedAt).toLocaleString()}</span></div>
      ${renderSentiment(a.sentiment, a.tooltip)}
    </article>
  `).join("");
  $("#prev").onclick = () => $("#slides").scrollBy({ left: -400, behavior: "smooth" });
  $("#next").onclick = () => $("#slides").scrollBy({ left: 400, behavior: "smooth" });
}

// Render pinned news cards
function renderPinned() {
  const pins = state.pins.length ? state.pins : pickTop(state.articles, 3);
  $("#pinned").innerHTML = pins.map((a) => `
    <div class="card">
      <a href="${a.link}" target="_blank"><strong>${a.title}</strong></a>
      <div class="meta"><span class="source">${a.source}</span></div>
      ${renderSentiment(a.sentiment, a.tooltip)}
    </div>
  `).join("");
}

// Render the list of trending topics with aggregated sentiment
function renderTrending() {
  $("#trending").innerHTML = state.trending.map((t) => {
    const metaParts = [];
    metaParts.push(`${t.count} articles`);
    if (typeof t.sources === "number") metaParts.push(`${t.sources} sources`);
    return `
      <div class="trend">
        <div><strong>${t.topic}</strong></div>
        ${renderSentiment({ posP: t.sentiment.pos, neuP: t.sentiment.neu, negP: t.sentiment.neg })}
        <div class="meta">${metaParts.join(" · ")}</div>
      </div>
    `;
  }).join("");
}

// Render aggregated news clusters into the Trending News carousel
function renderTopics() {
  const slides = document.getElementById("topicSlides");
  if (!slides) return;
  const topics = state.topics || [];
  slides.innerHTML = topics.map((t) => `
    <article class="topic-card">
      <div class="text">
        <div class="title">${t.title}</div>
        <div class="count">${t.count} articles</div>
        ${renderSentiment(t.sentiment)}
      </div>
      <img src="${t.image}" alt="">
    </article>
  `).join("");
  const container = slides;
  const prevBtn = document.getElementById("topicPrev");
  const nextBtn = document.getElementById("topicNext");
  if (prevBtn) prevBtn.onclick = () => container.scrollBy({ left: -400, behavior: "smooth" });
  if (nextBtn) nextBtn.onclick = () => container.scrollBy({ left: 400, behavior: "smooth" });
}

// Render the daily news list
function renderDaily() {
  const daily = pickTop(state.articles.slice(4), 8);
  $("#daily").innerHTML = daily.map((a) => `
    <a class="daily-item" href="${a.link}" target="_blank">
      <img src="${a.image}" alt="">
      <div>
        <div><strong>${a.title}</strong></div>
        <div class="meta"><span class="source">${a.source}</span></div>
        ${renderSentiment(a.sentiment, a.tooltip)}
      </div>
    </a>
  `).join("");
}

// Render the main hero story
function renderMainHero() {
  const hero = state.articles.length ? state.articles[0] : null;
  const container = document.getElementById("mainHero");
  if (!container) return;
  if (!hero) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = `
    <div class="hero-img"><img src="${hero.image}" alt=""></div>
    <div class="hero-content">
      <h3>${hero.title}</h3>
      <a href="${hero.link}" target="_blank" class="analysis-link">Read Analysis</a>
      ${renderSentiment(hero.sentiment, hero.tooltip)}
      <div class="meta"><span class="source">${hero.source}</span> · <span>${new Date(hero.publishedAt).toLocaleString()}</span></div>
    </div>
  `;
}

// Kick off the initial load and periodic refresh
loadAll();
setInterval(loadAll, 1000 * 60 * 5);

// Set up the theme toggle once the DOM is ready
applyTheme();
const themeBtn = document.getElementById("themeToggle");
if (themeBtn) {
  themeBtn.addEventListener("click", toggleTheme);
}
