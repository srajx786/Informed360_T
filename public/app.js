/* helpers */
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const fmtPct = (n) => `${Math.max(0, Math.min(100, Math.round(n)))}%`;
async function fetchJSON(u){ const r = await fetch(u); if(!r.ok) throw new Error(await r.text()); return r.json(); }
const domainFromUrl = (u="") => { try { return new URL(u).hostname.replace(/^www\./,""); } catch { return ""; } };
const logoFor = (link="", source="") => {
  const d = domainFromUrl(link) || domainFromUrl(source) || "";
  return d ? `https://logo.clearbit.com/${d}` : "";
};
const PLACEHOLDER = "data:image/svg+xml;base64," + btoa(`<svg xmlns='http://www.w3.org/2000/svg' width='400' height='260'><rect width='100%' height='100%' fill='#e5edf7'/><text x='50%' y='52%' text-anchor='middle' font-family='sans-serif' font-weight='700' fill='#8aa3c4' font-size='18'>Image</text></svg>`);

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
  lastLeaderboardAt: 0
};
function loadProfile(){ try { return JSON.parse(localStorage.getItem("i360_profile") || "{}"); } catch { return {}; } }
function saveProfile(p){ localStorage.setItem("i360_profile", JSON.stringify(p || {})); state.profile = p || {}; }
function applyTheme(){ document.documentElement.setAttribute("data-theme", state.theme); }

/* date + weather */
const todayStr = ()=> new Date().toLocaleDateString(undefined,{weekday:"long", day:"numeric", month:"long"});
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
    const icon = code>=0 && code<3 ? "🌙" : (code<50 ? "⛅" : "🌧️");
    $("#weatherCard").innerHTML = `<div class="wx-icon">${icon}</div><div><div class="wx-city">${city}</div><div class="wx-temp">${t}°C</div></div>`;
  }catch{ $("#weatherCard").textContent = "Weather unavailable"; }
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

/* loads */
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

  if (state.category === "local" && state.profile?.city) {
    const c = state.profile.city.toLowerCase();
    state.articles = state.articles.filter(a => (a.title||"").toLowerCase().includes(c) || (a.link||"").toLowerCase().includes(c));
  } else if (state.category === "foryou" && Array.isArray(state.profile?.interests) && state.profile.interests.length) {
    const wanted = new Set(state.profile.interests);
    state.articles = state.articles.filter(a => wanted.has(a.category));
  }

  renderAll();
}

/* renderers */
function safeImgTag(src, link, source, cls){
  const fallback = logoFor(link, source) || PLACEHOLDER;
  const s = src || fallback || PLACEHOLDER;
  return `<img class="${cls}" src="${s}" onerror="this.onerror=null;this.src='${fallback || PLACEHOLDER}'" alt="">`;
}

function card(a){
  return `
    <a class="news-item" href="${a.link}" target="_blank" rel="noopener">
      ${safeImgTag(a.image, a.link, a.source, "thumb")}
      <div>
        <div class="title">${a.title}</div>
        <div class="meta"><span class="source">${a.source}</span> · <span>${new Date(a.publishedAt).toLocaleString()}</span></div>
        ${renderSentiment(a.sentiment)}
      </div>
    </a>`;
}

/* Pinned */
function renderPinned(){
  $("#pinned").innerHTML = state.pins.map(a => `
    <div class="row">
      <a class="row-title" href="${a.link}" target="_blank" rel="noopener">${a.title}</a>
      <div class="row-meta"><span class="source">${a.source}</span> · <span>${new Date(a.publishedAt).toLocaleString()}</span></div>
      ${renderSentiment(a.sentiment, true)}
    </div>`).join("");
}

/* News + Daily */
function renderNews(){ $("#newsList").innerHTML = state.articles.slice(4, 12).map(card).join(""); }
function renderDaily(){ $("#daily").innerHTML = state.articles.slice(12, 20).map(card).join(""); }

/* HERO */
function renderHero(){
  const slides = state.articles.slice(0,4);
  const track = $("#heroTrack"); const dots = $("#heroDots");
  if (!slides.length){ track.innerHTML=""; dots.innerHTML=""; return; }
  track.innerHTML = slides.map(a => `
    <article class="hero-slide">
      <div class="hero-img">${safeImgTag(a.image, a.link, a.source, "")}</div>
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
function startHeroAuto(){ stopHeroAuto(); state.hero.timer = setInterval(()=>{ if(!state.hero.pause) updateHero(state.hero.index+1); }, 6000); }
function stopHeroAuto(){ if(state.hero.timer) clearInterval(state.hero.timer); state.hero.timer=null; }

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

/* ===== 4-hour mood microchart (SVG lines) ===== */
function renderMood4h(){
  const now = Date.now();
  const fourHrs = 4*60*60*1000;
  const recent = state.articles.filter(a => now - new Date(a.publishedAt).getTime() <= fourHrs);
  const buckets = [0,1,2,3].map(h=>({pos:0,neg:0,neu:0,count:0}));
  recent.forEach(a=>{
    const dt = now - new Date(a.publishedAt).getTime();
    const i = Math.min(3, Math.floor(dt/(60*60*1000)));
    buckets[3-i].pos += a.sentiment.posP; // older->left
    buckets[3-i].neg += a.sentiment.negP;
    buckets[3-i].neu += a.sentiment.neuP;
    buckets[3-i].count++;
  });
  const pts = buckets.map(b=>{
    const n = Math.max(1,b.count);
    return { pos:Math.round(b.pos/n), neg:Math.round(b.neg/n), neu:Math.round(b.neu/n) };
  });
  const svg = $("#moodSpark");
  const W = 280, H = 70, pad=6;
  const x = (i)=> pad + i*( (W-2*pad)/3 );
  const y = (p)=> H - pad - (p/100)*(H-2*pad);

  const mkPath = (key)=> pts.map((p,i)=> `${i===0?"M":"L"} ${x(i)} ${y(p[key])}`).join(" ");
  svg.innerHTML = `
    <defs>
      <linearGradient id="gpos" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="#22c55e" stop-opacity=".9"/>
        <stop offset="1" stop-color="#22c55e" stop-opacity=".2"/>
      </linearGradient>
      <linearGradient id="gneg" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="#ef4444" stop-opacity=".9"/>
        <stop offset="1" stop-color="#ef4444" stop-opacity=".2"/>
      </linearGradient>
    </defs>
    <path d="${mkPath("pos")}" fill="none" stroke="url(#gpos)" stroke-width="2.2" />
    <path d="${mkPath("neg")}" fill="none" stroke="url(#gneg)" stroke-width="2.2" />
  `;

  const avg = pts.reduce((a,p)=>({pos:a.pos+p.pos, neu:a.neu+p.neu, neg:a.neg+p.neg}),{pos:0,neu:0,neg:0});
  const n=pts.length||1;
  $("#moodSummary").textContent = `Positive ${fmtPct(avg.pos/n)} · Neutral ${fmtPct(avg.neu/n)} · Negative ${fmtPct(avg.neg/n)}`;
}

/* ===== Sentiment Leaderboard (per-source bias) ===== */
function computeLeaderboard(){
  const bySource = new Map();
  state.articles.forEach(a=>{
    const s = bySource.get(a.source) || {n:0,pos:0,neg:0,neu:0,compound:0,link:a.link};
    s.n++; s.pos+=a.sentiment.posP; s.neg+=a.sentiment.negP; s.neu+=a.sentiment.neuP;
    // approximate compound from buckets
    s.compound += (a.sentiment.posP - a.sentiment.negP);
    s.link = a.link || s.link;
    bySource.set(a.source, s);
  });

  const arr = [...bySource.entries()].map(([src,v])=>{
    const n = Math.max(1,v.n);
    const pos = v.pos/n, neg = v.neg/n, neu = v.neu/n;
    const bias = (pos - neg); // >0 positive, <0 negative
    return { source:src, pos, neg, neu, bias, logo:logoFor(v.link, src) };
  }).filter(x=>x.source && isFinite(x.bias) && (x.pos+x.neg+x.neu)>0.1);

  const topPos = arr.filter(x=>x.bias>5).sort((a,b)=>b.bias-a.bias).slice(0,2);
  const topNeu = arr.sort((a,b)=>(Math.abs(a.bias)-Math.abs(b.bias))).slice(0,2);
  const topNeg = arr.filter(x=>x.bias<-5).sort((a,b)=>a.bias-b.bias).slice(0,2);

  return { pos:topPos, neu:topNeu, neg:topNeg };
}

function renderLeaderboard(){
  const grid = $("#leaderboard");
  grid.innerHTML = `
    <div class="leader-col" id="col-pos"></div>
    <div class="leader-col" id="col-neu"></div>
    <div class="leader-col" id="col-neg"></div>
  `;

  const place = (colId, list) => {
    const col = $(colId);
    if (!col) return;
    const levels = [0.25, 0.55, 0.80]; // y positions candidates
    list.forEach((s, idx)=>{
      const y = 100 - Math.min(95, Math.max(5, ( (idx===0?0.75:0.45) * 100 )));
      const x = 50 + (idx===0 ? 0 : 22) * (idx%2===0? -1 : 1);
      const top = (220*(1-levels[idx%levels.length]));
      const left = (col.getBoundingClientRect?.().width||100) * (idx===0?0.5:(idx%2?0.7:0.3));
      const badge = document.createElement("div");
      badge.className = "badge";
      badge.style.top = `${top}px`;
      badge.style.left = `${left}px`;
      badge.innerHTML = s.logo
        ? `<img src="${s.logo}" alt="${s.source}" onerror="this.onerror=null;this.src='${PLACEHOLDER}'">`
        : `<span style="font-weight:800;font-size:.8rem">${s.source}</span>`;
      col.appendChild(badge);
    });
  };

  const {pos, neu, neg} = computeLeaderboard();
  place("#col-pos", pos);
  place("#col-neu", neu);
  place("#col-neg", neg);

  state.lastLeaderboardAt = Date.now();
}

/* glue */
function renderAll(){
  $("#briefingDate").textContent = todayStr();
  renderHero(); renderPinned(); renderNews(); renderDaily(); renderTopics();
  renderMood4h(); renderLeaderboard();
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
startHeroAuto();

/* refreshes */
setInterval(loadAll, 1000*60*5);       // content every 5 min
setInterval(loadMarkets, 1000*60*5);   // markets every 5 min
setInterval(()=>{                      // leaderboard at least hourly as requested
  if (Date.now() - state.lastLeaderboardAt > 1000*60*60) renderLeaderboard();
}, 15*1000);
