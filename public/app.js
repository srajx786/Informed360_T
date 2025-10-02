// ---------- Helpers ----------
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const fmtPct = (n) => `${Math.max(0, Math.min(100, Math.round(n)))}%`;

// Reusable sentiment renderer (expects {posP, neuP, negP})
const renderSentiment = (s, tip = "") => {
  const pos = Math.max(0, Number(s.posP) || 0);
  const neu = Math.max(0, Number(s.neuP) || 0);
  const neg = Math.max(0, Number(s.negP) || 0);
  const negTip = neg > 50 ? tip || "This article set skews negative." : "";
  return `
    <div class="sentiment" ${negTip ? `data-tip="${negTip}"` : ""}>
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

// ---------- State ----------
const state = {
  articles: [],
  clusters: [],
  pins: [],
  theme: localStorage.getItem("theme") || "dark"
};

// ---------- Theme ----------
function applyTheme(){
  document.documentElement.setAttribute("data-theme", state.theme);
  const t = $("#themeToggle");
  if (t) t.textContent = state.theme === "light" ? "🌙" : "☀️";
}
function toggleTheme(){
  state.theme = state.theme === "light" ? "dark" : "light";
  localStorage.setItem("theme", state.theme);
  applyTheme();
}

// ---------- Data ----------
async function fetchJSON(url){
  const res = await fetch(url);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function loadAll(){
  const [news, topics, pins, ticker] = await Promise.all([
    fetchJSON("/api/news"),
    fetchJSON("/api/topics"),
    fetchJSON("/api/pinned"),
    fetchJSON("/api/ticker").catch(() => ({ quotes: [] }))
  ]);

  state.articles = news.articles || [];
  state.clusters  = (topics && topics.topics) || [];
  state.pins      = pins.articles || [];

  renderTicker(ticker.quotes || []);
  renderMainHero();
  renderPinned();
  renderClusterNews(); // <— aggregated center list
  renderDaily();

  $("#year").textContent = new Date().getFullYear();
  applyTheme();
}

// ---------- UI: top ticker ----------
function renderTicker(quotes){
  const indices = [
    { symbol: "^BSESN", name: "BSE Sensex" },
    { symbol: "^NSEI",  name: "Nifty 50" },
    { symbol: "^NYA",   name: "NYSE Composite" }
  ];
  const line = indices.map((info, i) => {
    const q = quotes?.[i] || {};
    const change = typeof q.change === "number" ? q.change : 0;
    const price = typeof q.price === "number" ? q.price : null;
    const pct   = typeof q.changePercent === "number" ? (q.changePercent * 100).toFixed(2) : null;
    const cls   = change >= 0 ? "up" : "down";
    return `<span>${info.name}: <span class="${cls}">${price != null ? price.toFixed(2) : "--"} (${pct != null ? pct + "%" : "--"})</span></span>`;
  }).join(" · ");
  $("#ticker").innerHTML = line;
}

// ---------- UI: left pinned ----------
function pickTop(arr, n){ return arr.slice(0, n); }
function renderPinned(){
  const pins = state.pins.length ? state.pins : pickTop(state.articles, 3);
  $("#pinned").innerHTML = pins.map(a => `
    <div class="card">
      <a href="${a.link}" target="_blank"><strong>${a.title}</strong></a>
      <div class="meta"><span class="source">${a.source}</span></div>
      ${renderSentiment(a.sentiment)}
    </div>
  `).join("");
}

// ---------- UI: center aggregated clusters ----------
function renderClusterNews(){
  const list = state.clusters.slice(0, 12);
  $("#newsList").innerHTML = list.map(t => {
    const s = { posP: t.sentiment.pos, neuP: t.sentiment.neu, negP: t.sentiment.neg };
    const sources = typeof t.sources === "number" ? t.sources : t.count; // fallback
    return `
      <div class="cluster">
        <div class="title">${t.title}</div>
        ${renderSentiment(s)}
        <div class="meta">${t.count} articles · ${sources} sources</div>
      </div>
    `;
  }).join("");
}

// ---------- UI: right daily ----------
function renderDaily(){
  const daily = pickTop(state.articles.slice(6), 8);
  $("#daily").innerHTML = daily.map(a => `
    <a class="daily-item" href="${a.link}" target="_blank" rel="noopener">
      <img src="${a.image}" alt="">
      <div>
        <div><strong>${a.title}</strong></div>
        <div class="meta"><span class="source">${a.source}</span></div>
        ${renderSentiment(a.sentiment)}
      </div>
    </a>
  `).join("");
}

// ---------- UI: hero ----------
function renderMainHero(){
  const hero = state.articles?.[0];
  const el = $("#mainHero");
  if (!el) return;
  if (!hero){
    el.innerHTML = "";
    return;
  }
  el.innerHTML = `
    <div class="hero-img"><img src="${hero.image}" alt=""></div>
    <div class="hero-content">
      <h3>${hero.title}</h3>
      <a href="${hero.link}" target="_blank" class="analysis-link">Read Analysis</a>
      ${renderSentiment(hero.sentiment)}
      <div class="meta"><span class="source">${hero.source}</span> · <span>${new Date(hero.publishedAt).toLocaleString()}</span></div>
    </div>
  `;
}

// ---------- Init ----------
loadAll();
setInterval(loadAll, 1000 * 60 * 5);
applyTheme();
$("#themeToggle")?.addEventListener("click", toggleTheme);
