/* helpers */
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const fmtPct = (n) => `${Math.max(0, Math.min(100, Math.round(n)))}%`;
async function fetchJSON(u){ const r = await fetch(u); if(!r.ok) throw new Error(await r.text()); return r.json(); }

/* sentiment meter */
function renderSentiment(s, slim=false){
  const pos = Math.max(0, Number(s.posP ?? s.pos ?? 0));
  const neu = Math.max(0, Number(s.neuP ?? s.neu ?? 0));
  const neg = Math.max(0, Number(s.negP ?? s.neg ?? 0));
  return `
    <div class="sentiment ${slim?'slim':''}">
      <div class="bar">
        <span class="segment pos" style="width:${pos}%"></span>
        <span class="segment neu" style="width:${neu}%"></span>
        <span class="segment neg" style="width:${neg}%"></span>
      </div>
      ${slim ? '' : `
      <div class="scores">
        <span>Positive ${fmtPct(pos)}</span>
        <span>Neutral ${fmtPct(neu)}</span>
        <span>Negative ${fmtPct(neg)}</span>
      </div>`}
    </div>`;
}

/* state */
const state = {
  category: "home",
  filter: "all",
  experimental: false,
  query: "",
  articles: [],
  topics: [],
  pins: [],
  profile: loadProfile(),
  theme: localStorage.getItem("theme") || "light",
  hero: { index:0, timer:null, pause:false },
  mood4h: null
};

function loadProfile(){ try { return JSON.parse(localStorage.getItem("i360_profile") || "{}"); } catch { return {}; } }
function saveProfile(p){ localStorage.setItem("i360_profile", JSON.stringify(p || {})); state.profile = p || {}; }
function applyTheme(){ document.documentElement.setAttribute("data-theme", state.theme); }

/* date */
const todayStr = ()=> new Date().toLocaleDateString(undefined,{weekday:"long", day:"numeric", month:"long"});

/* weather (mini) */
async function getWeather(){
  try{
    const coords = await new Promise((res)=>{
      if(!navigator.geolocation) return res({latitude:19.0760, longitude:72.8777});
      navigator.geolocation.getCurrentPosition(
        p=>res({latitude:p.coords.latitude, longitude:p.coords.longitude}),
        ()=>res({latitude:19.0760, longitude:72.8777})
      );
    });
    const wx = await fetchJSON(`https://api.open-meteo.com/v1/forecast?latitude=${coords.latitude}&longitude=${coords.longitude}&current=temperature_2m,weather_code&timezone=auto`);
    let city = state.profile?.city || "Your area";
    if (!state.profile?.city) {
      try {
        const rev = await fetchJSON(`https://geocoding-api.open-meteo.com/v1/reverse?latitude=${coords.latitude}&longitude=${coords.longitude}&language=en`);
        city = rev?.results?.[0]?.name || city;
      } catch{}
    }
    const t = Math.round(wx?.current?.temperature_2m ?? 0);
    const code = wx?.current?.weather_code ?? 0;
    const icon = code>=0 && code<3 ? "☀️" : (code<50 ? "⛅" : "🌧️");
    $("#weatherMini").innerHTML = `<div class="wx-icon">${icon}</div><div><div class="wx-city">${city}</div><div class="wx-temp">${t}°C</div></div>`;
  }catch{ $("#weatherMini").textContent = "Weather —"; }
}

/* markets */
async function loadMarkets(){
  try{
    const data = await fetchJSON("/api/markets");
    const el = $("#marketTicker");
    const items = (data.quotes || []).map(q=>{
      const price = (q.price ?? "—");
      const pct = Number(q.changePercent ?? 0);
      const cls = pct >= 0 ? "up" : "down";
      const sign = pct >= 0 ? "▲" : "▼";
      const pctTxt = isFinite(pct) ? `${sign} ${Math.abs(pct).toFixed(2)}%` : "—";
      const pTxt = typeof price === "number" ? price.toLocaleString(undefined,{maximumFractionDigits:2}) : price;
      return `<div class="qpill"><span class="sym">${q.pretty || q.symbol}</span><span class="price">${pTxt}</span><span class="chg ${cls}">${pctTxt}</span></div>`;
    }).join("");
    el.innerHTML = items || "";
  }catch{ $("#marketTicker").innerHTML = ""; }
}

/* ========= Nation's Mood calculations ========= */

/** Aggregate nation mood from the day’s articles */
function calcNationMoodFromArticles(list){
  let pos = 0, neu = 0, neg = 0, t = 0;
  for(const a of list){
    const s = a?.sentiment || {};
    const pp = +s.posP || +s.pos || 0;
    const np = +s.neuP || +s.neu || 0;
    const gp = +s.negP || +s.neg || 0;
    if(pp+np+gp > 0){ pos += pp; neu += np; neg += gp; t += 100; }
  }
  if(t===0) return {posP:0, neuP:100, negP:0};
  return {posP:(pos/t)*100, neuP:(neu/t)*100, negP:(neg/t)*100};
}

/** Build 4-hour bins for today: 00,04,08,12,16,20,24 */
function build4hBins(list){
  const now = new Date();
  const start = new Date(now); start.setHours(0,0,0,0);
  const bins = [0,4,8,12,16,20,24].map(h=>({h, pos:0, neg:0, cnt:0}));

  for(const a of list){
    const ts = new Date(a.publishedAt || a.pubDate || Date.now());
    if (ts < start) continue;
    const hr = ts.getHours();
    const idx = hr<4?0 : hr<8?1 : hr<12?2 : hr<16?3 : hr<20?4 : hr<24?5 : 6;
    const s = a.sentiment || {};
    const p = +s.posP || +s.pos || 0;
    const n = +s.negP || +s.neg || 0;
    if (p+n>0){ bins[idx].pos += p; bins[idx].neg += n; bins[idx].cnt++; }
  }

  return bins.map(b=>{
    const posP = b.cnt ? (b.pos/(b.cnt*100))*100 : 0;
    const negP = b.cnt ? (b.neg/(b.cnt*100))*100 : 0;
    return { hour:b.h, posP, negP };
  });
}

/* Render mood ticker text (daily aggregate above markets) */
function renderMoodTicker(agg){
  const txt = `
    Nation’s Mood — 
    <span style="color:var(--pos);font-weight:800">Positive ${fmtPct(agg.posP)}</span> ·
    <span style="color:var(--neu);font-weight:800">Neutral ${fmtPct(agg.neuP)}</span> ·
    <span style="color:var(--neg);font-weight:800">Negative ${fmtPct(agg.negP)}</span>
  `;
  $("#moodTicker").innerHTML = txt;
}

/* Render compact 4-hour mini chart (SVG) — labels only up to current slot */
function renderMood4hMini(bins){
  const now = new Date();
  const upTo = Math.min(6, Math.floor(now.getHours()/4)); // 0..6 index for current 4h slot
  const used = bins.slice(0, upTo + 1); // values to plot/label

  const W = 220, H = 78, PAD = 6;
  const plotW = W - PAD*2, plotH = H - PAD*2;

  // map % to y (0 top). Positive: higher when value increases.
  const yPos = v => PAD + (plotH/2 - 8) * (1 - Math.min(1, Math.max(0, v/100)));
  // Negative line goes up when negativity improves => plot (100 - neg%)
  const yNeg = v => PAD + plotH - (plotH/2 - 8) * (1 - Math.min(1, Math.max(0, (100 - v)/100)));

  const slotX = i => PAD + (plotW/6) * i; // 7 slots across (0..6)

  const posPts = used.map((d,i)=>`${slotX(i)},${yPos(d.posP)}`).join(' ');
  const negPts = used.map((d,i)=>`${slotX(i)},${yNeg(d.negP)}`).join(' ');

  const hours = ["00:00","04:00","08:00","12:00","16:00","20:00","24:00"];

  const svg = `
  <svg class="mini-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Nation’s Mood 4-hour trend">
    <!-- mid grey band -->
    <rect x="${PAD}" y="${H/2-10}" width="${plotW}" height="20" class="mini-baseline" />
    <!-- vertical hour guides (always visible) -->
    ${[0,1,2,3,4,5,6].map(i => `<line x1="${slotX(i)}" y1="${PAD}" x2="${slotX(i)}" y2="${H-PAD}" class="mini-axis"/>`).join('')}
    <!-- green positive and red inverse-negative lines (only to current slot) -->
    ${used.length>1 ? `<polyline class="mini-pos" points="${posPts}"/>` : ''}
    ${used.length>1 ? `<polyline class="mini-neg" points="${negPts}"/>` : ''}

    <!-- hour labels ONLY up to the current slot -->
    ${[...Array(upTo+1).keys()].map(i => `
      <text class="mini-label" x="${slotX(i)-12}" y="${H/2+15}">${hours[i].slice(0,5)}</text>
    `).join('')}

    <!-- % labels ONLY for rendered points -->
    ${used.map((d,i)=> `<text class="mini-pct-pos" x="${slotX(i)-8}" y="${yPos(d.posP)-4}">${Math.round(d.posP)}%</text>`).join('')}
    ${used.map((d,i)=> `<text class="mini-pct-neg" x="${slotX(i)-8}" y="${yNeg(d.negP)+12}">${Math.round(d.negP)}%</text>`).join('')}
  </svg>`;

  $("#mood4hMini").innerHTML = svg;
}

/* ===== loads ===== */
async function loadAll(){
  const qs = new URLSearchParams();
  if (state.filter !== "all") qs.set("sentiment", state.filter);
  if (state.experimental) qs.set("experimental", "1");
  if (state.category && !["home","foryou","local"].includes(state.category)) qs.set("category", state.category);

  const [news, topics] = await Promise.all([
    fetchJSON(`/api/news${qs.toString() ? ("?" + qs.toString()) : ""}`),
    fetchJSON(`/api/topics${state.experimental ? "?experimental=1" : ""}`)
  ]);

  state.articles = news.articles || [];
  state.topics = (topics.topics || []).slice(0, 8);
  state.pins = state.articles.slice(0,3);

  // Mood computations
  try {
    const m4 = await fetchJSON("/api/mood4h");     // if backend provides bins, prefer them
    state.mood4h = m4?.bins || build4hBins(state.articles);
  } catch {
    state.mood4h = build4hBins(state.articles);   // client-side fallback
  }
  const dailyAgg = calcNationMoodFromArticles(state.articles);
  renderMoodTicker(dailyAgg);
  renderMood4hMini(state.mood4h);

  renderAll();
}

/* renderers (news UI kept intact) */
function card(a){
  return `
    <a class="news-item" href="${a.link}" target="_blank" rel="noopener">
      <img class="thumb" src="${a.image}" alt="">
      <div>
        <div class="title">${a.title}</div>
        <div class="meta"><span class="source">${a.source}</span> · <span>${new Date(a.publishedAt).toLocaleString()}</span></div>
        ${renderSentiment(a.sentiment)}
      </div>
    </a>`;
}
function renderPinned(){
  $("#pinned").innerHTML = state.pins.map(a => `
    <div class="row">
      <a class="row-title" href="${a.link}" target="_blank" rel="noopener">${a.title}</a>
      <div class="row-meta"><span class="source">${a.source}</span> · <span>${new Date(a.publishedAt).toLocaleString()}</span></div>
      ${renderSentiment(a.sentiment, true)}
    </div>`).join("");
}
function renderNews(){ $("#newsList").innerHTML = state.articles.slice(4, 12).map(card).join(""); }
function renderDaily(){ $("#daily").innerHTML = state.articles.slice(12, 20).map(card).join(""); }

function renderHero(){
  const slides = state.articles.slice(0,4);
  const track = $("#heroTrack"); const dots = $("#heroDots");
  if (!slides.length){ track.innerHTML=""; dots.innerHTML=""; return; }
  track.innerHTML = slides.map(a => `
    <article class="hero-slide">
      <div class="hero-img"><img src="${a.image}" alt=""></div>
      <div class="hero-content">
        <h3>${a.title}</h3>
        <a href="${a.link}" target="_blank" class="analysis-link" rel="noopener">Read Analysis</a>
        ${renderSentiment(a.sentiment)}
        <div class="meta"><span class="source">${a.source}</span> · <span>${new Date(a.publishedAt).toLocaleString()}</span></div>
      </div>
    </article>`).join("");
  dots.innerHTML = slides.map((_,i)=>`<button data-i="${i}" aria-label="Go to slide ${i+1}"></button>`).join("");
  updateHero(0);
}
function updateHero(i){
  const n = $$("#heroTrack .hero-slide").length;
  state.hero.index = (i+n)%n;
  $("#heroTrack").style.transform = `translateX(-${state.hero.index*100}%)`;
  $$("#heroDots button").forEach((b,bi)=> b.classList.toggle("active", bi===state.hero.index));
}

/* Trending topics */
function renderTopics(){
  $("#topicsList").innerHTML = state.topics.map(t=>{
    const total = (t.sentiment.pos||0)+(t.sentiment.neu||0)+(t.sentiment.neg||0);
    const sent = { posP: total? (t.sentiment.pos/total)*100:0, neuP: total? (t.sentiment.neu/total)*100:0, negP: total? (t.sentiment.neg/total)*100:0 };
    return `
      <div class="row">
        <div class="row-title">${t.title.split("|")[0]}</div>
        <div class="row-meta"><span>${t.count} articles</span> · <span>${t.sources} sources</span></div>
        ${renderSentiment(sent, true)}
      </div>`;
  }).join("");
}

/* glue */
function renderAll(){
  $("#briefingDate").textContent = todayStr();
  renderHero(); renderPinned(); renderNews(); renderDaily(); renderTopics();
  $("#year").textContent = new Date().getFullYear();
}

/* interactions */
$$(".chip[data-sent]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    $$(".chip[data-sent]").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    state.filter = btn.dataset.sent; loadAll();
  });
});
$("#expChip")?.addEventListener("click", ()=>{ state.experimental = !state.experimental; $("#expChip").classList.toggle("active", state.experimental); loadAll(); });
$("#searchForm")?.addEventListener("submit", (e)=>{ e.preventDefault(); state.query = $("#searchInput").value.trim(); renderAll(); });
$("#searchInput")?.addEventListener("input", (e)=>{ state.query = e.target.value.trim(); renderAll(); });

$$(".gn-tabs .tab[data-cat]").forEach(tab=>{
  tab.addEventListener("click", ()=>{
    $$(".gn-tabs .tab").forEach(t=>t.classList.remove("active"));
    tab.classList.add("active");
    state.category = tab.dataset.cat; loadAll();
  });
});
$("#heroPrev")?.addEventListener("click", ()=> updateHero(state.hero.index-1));
$("#heroNext")?.addEventListener("click", ()=> updateHero(state.hero.index+1));
$("#hero")?.addEventListener("mouseenter", ()=> state.hero.pause = true);
$("#hero")?.addEventListener("mouseleave", ()=> state.hero.pause = false);

/* Sign-in */
const modal = $("#signinModal");
$("#avatarBtn")?.addEventListener("click", ()=>{
  $("#prefName").value = state.profile?.name || "";
  $("#prefCity").value = state.profile?.city || "";
  const interests = new Set(state.profile?.interests || ["india"]);
  modal.querySelectorAll('input[type="checkbox"]').forEach(cb=> cb.checked = interests.has(cb.value));
  modal.showModal();
});
$("#savePrefs")?.addEventListener("click", (e)=>{
  e.preventDefault();
  const name = $("#prefName").value.trim();
  const city = $("#prefCity").value.trim();
  const interests = [...modal.querySelectorAll('input[type="checkbox"]:checked')].map(cb=>cb.value);
  saveProfile({ name, city, interests });
  modal.close();
  const forYouTab = $('.gn-tabs .tab[data-cat="foryou"]'); if (forYouTab) forYouTab.click();
});

/* boot */
document.getElementById("year").textContent = new Date().getFullYear();
applyTheme();
$("#briefingDate").textContent = todayStr();
getWeather();
loadMarkets();
loadAll();
setInterval(loadAll, 1000*60*5);     // refresh news/mood every 5 min
setInterval(loadMarkets, 1000*60*5); // refresh markets
setInterval(getWeather, 1000*60*10); // weather
