// Utility selectors
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];

// Format a number as a percentage string
const fmtPct = (n) => `${Math.max(0, Math.min(100, Math.round(n)))}%`;

// Render a sentiment bar given a sentiment object {posP, neuP, negP}
const renderSentiment = (s, tip = "") => {
  const pos = Math.max(0, Number(s.posP) || 0);
  const neu = Math.max(0, Number(s.neuP) || 0);
  const neg = Math.max(0, Number(s.negP) || 0);
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
  pins: [],
  theme: localStorage.getItem("theme") || "dark"
};

// Theme
function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.theme);
  const btn = document.getElementById("themeToggle");
  if (btn) btn.textContent = state.theme === "light" ? "🌙" : "☀️";
}
function toggleTheme() {
  state.theme = state.theme === "light" ? "dark" : "light";
  localStorage.setItem("theme", state.theme);
  applyTheme();
}

// Fetch JSON helper
async function fetchJSON(url){
  const res = await fetch(url);
  if(!res.ok) throw new Error(await res.text());
  return res.json();
}

// Load and render
async function loadAll(){
  const [news, pins, ticker] = await Promise.all([
    fetchJSON("/api/news"),
    fetchJSON("/api/pinned"),
    fetchJSON("/api/ticker").catch(() => ({ quotes: [] }))
  ]);

  state.articles = news.articles || [];
  state.pins = pins.articles || [];

  renderTicker(ticker.quotes || []);
  renderMainHero();
  renderPinned();
  renderNewsList();
  renderDaily();

  $("#year").textContent = new Date().getFullYear();
  applyTheme();
}

// Market ticker
function renderTicker(quotes){
  const indices = [
    { symbol: "^BSESN", name: "BSE Sensex" },
    { symbol: "^NSEI", name: "Nifty 50" },
    { symbol: "^NYA",  name: "NYSE Composite" }
  ];
  const line = indices.map((info, idx) => {
    const q = (quotes && quotes[idx]) || {};
    const change = typeof q.change === "number" ? q.change : 0;
    const price = typeof q.price === "number" ? q.price : null;
    const changePct = typeof q.changePercent === "number" ? (q.changePercent * 100).toFixed(2) : null;
    const cls = change >= 0 ? "up" : "down";
    const priceStr = price != null ? price.toFixed(2) : "--";
    const pctStr = changePct != null ? `${changePct}%` : "--";
    return `<span>${info.name}: <span class="${cls}">${priceStr} (${pctStr})</span></span>`;
  }).join(" · ");
  $("#ticker").innerHTML = line;
}

// Helpers
function pickTop(arr, n){ return arr.slice(0, n); }

// Pinned (left)
function renderPinned(){
  const pins = state.pins.length ? state.pins : pickTop(state.articles, 3);
  $("#pinned").innerHTML = pins.map(a => `
    <div class="card">
      <a href="${a.link}" target="_blank"><strong>${a.title}</strong></a>
      <div class="meta"><span class="source">${a.source}</span></div>
      ${renderSentiment(a.sentiment, a.tooltip)}
    </div>
  `).join("");
}

// News list (center)
function renderNewsList(){
  const list = state.articles.slice(1, 10); // first goes to hero
  $("#newsList").innerHTML = list.map(a => `
    <a class="news-item" href="${a.link}" target="_blank" rel="noopener">
      <img class="thumb" src="${a.image}" alt="">
      <div>
        <div class="title">${a.title}</div>
        <div class="meta"><span class="source">${a.source}</span> · <span>${new Date(a.publishedAt).toLocaleString()}</span></div>
        ${renderSentiment(a.sentiment, a.tooltip)}
      </div>
    </a>
  `).join("");
}

// Daily (right)
function renderDaily(){
  const daily = pickTop(state.articles.slice(10), 8);
  $("#daily").innerHTML = daily.map(a => `
    <a class="daily-item" href="${a.link}" target="_blank" rel="noopener">
      <img src="${a.image}" alt="">
      <div>
        <div><strong>${a.title}</strong></div>
        <div class="meta"><span class="source">${a.source}</span></div>
        ${renderSentiment(a.sentiment, a.tooltip)}
      </div>
    </a>
  `).join("");
}

// Hero (first article)
function renderMainHero() {
  const hero = state.articles.length ? state.articles[0] : null;
  const container = document.getElementById("mainHero");
  if (!container) return;
  if (!hero) { container.innerHTML = ""; return; }
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

// Init
loadAll();
setInterval(loadAll, 1000 * 60 * 5);

applyTheme();
const themeBtn = document.getElementById("themeToggle");
if (themeBtn) themeBtn.addEventListener("click", toggleTheme);
