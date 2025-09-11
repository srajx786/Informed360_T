const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const fmtPct = (n) => `${Math.max(0, Math.min(100, Math.round(n)))}%`;

const renderSentiment = (s, tip="") => {
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

const state = { articles: [], trending: [], pins: [], slideIndex: 0 };

async function fetchJSON(url){
  const res = await fetch(url);
  if(!res.ok) throw new Error(await res.text());
  return res.json();
}

async function loadAll(){
  const [news, trends, pins, ticker] = await Promise.all([
    fetchJSON("/api/news"),
    fetchJSON("/api/trending"),
    fetchJSON("/api/pinned"),
    fetchJSON("/api/ticker").catch(() => ({ quotes: [] }))
  ]);
  state.articles = news.articles;
  state.trending = trends.topics;
  state.pins = pins.articles || [];
  renderTicker(ticker.quotes || []);
  renderCarousel();
  renderPinned();
  renderTrending();
  renderTopNews();
  renderDaily();
  $("#year").textContent = new Date().getFullYear();
}

function renderTicker(quotes){
  const line = quotes.map(q => {
    const cls = q.change >= 0 ? "up" : "down";
    const label = (q.shortName || q.symbol).replace("Index","").trim();
    const pct = (q.changePercent * 100).toFixed(2);
    return `<span>${label}: <span class="${cls}">${q.price?.toFixed?.(2) ?? "-"} (${pct}%)</span></span>`;
  }).join(" · ");
  $("#ticker").innerHTML = line;
}

function pickTop(arr, n){ return arr.slice(0, n); }

function renderCarousel(){
  const top4 = pickTop(state.articles, 4);
  $("#slides").innerHTML = top4.map(a => `
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

function renderTrending(){
  $("#trending").innerHTML = state.trending.map(t => `
    <div class="trend">
      <div><strong>${t.topic}</strong></div>
      ${renderSentiment({ posP: t.sentiment.pos, neuP: t.sentiment.neu, negP: t.sentiment.neg })}
      <div class="meta">${t.count} articles</div>
    </div>
  `).join("");
}

function groupByTopic(arts){
  const map = new Map();
  arts.forEach(a => {
    const key = a.title.split(":")[0].split("—")[0].slice(0, 70);
    if(!map.has(key)) map.set(key, []);
    map.get(key).push(a);
  });
  return [...map.entries()]
    .map(([k, arr]) => {
      const pos = Math.round(arr.reduce((s, x) => s + x.sentiment.posP, 0) / arr.length);
      const neg = Math.round(arr.reduce((s, x) => s + x.sentiment.negP, 0) / arr.length);
      const neu = Math.max(0, 100 - pos - neg);
      return { title: k, count: arr.length, sentiment: { posP: pos, negP: neg, neuP: neu } };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
}

function renderTopNews(){
  $("#topNews").innerHTML = groupByTopic(state.articles).map(t => `
    <div class="tile">
      <strong>${t.title}</strong>
      ${renderSentiment(t.sentiment)}
      <div class="meta">${t.count} articles</div>
    </div>
  `).join("");
}

function renderDaily(){
  const daily = pickTop(state.articles.slice(4), 8);
  $("#daily").innerHTML = daily.map(a => `
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

loadAll();
setInterval(loadAll, 1000 * 60 * 5);
