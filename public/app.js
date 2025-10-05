/* ---------- helpers ---------- */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const fmtPct = n => `${Math.max(0, Math.min(100, Math.round(n || 0)))}%`;
const todayStr = ()=> new Date().toLocaleDateString(undefined,{weekday:"long", day:"numeric", month:"long"});
function domainFrom(url){ try{ return new URL(url).hostname.replace(/^www\./,''); }catch{ return ""; } }

/* ---------- state ---------- */
function prefersDark(){ return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches; }
const state = {
  category: "home", filter: "all", experimental: false,
  articles: [], pins: [], topics: [],
  theme: localStorage.getItem("theme") || (prefersDark() ? "dark" : "light"),
  hero: { index:0, timer:null, pause:false }
};

/* ---------- theme ---------- */
function applyTheme(){
  document.documentElement.setAttribute("data-theme", state.theme);
  const t = $("#themeToggle"); if (t) t.textContent = state.theme === "dark" ? "🌞" : "🌙";
}
$("#themeToggle")?.addEventListener("click", ()=>{
  state.theme = state.theme === "dark" ? "light" : "dark";
  localStorage.setItem("theme", state.theme);
  applyTheme();
});

/* ---------- sentiment UI ---------- */
function renderSentiment(s, withNumbers=true){
  const pos = s.posP ?? s.pos ?? 0;
  const neu = s.neuP ?? s.neu ?? 0;
  const neg = s.negP ?? s.neg ?? 0;
  return `
    <div class="sentiment">
      <div class="bar">
        <span class="segment pos" style="width:${fmtPct(pos)}"></span>
        <span class="segment neu" style="width:${fmtPct(neu)}"></span>
        <span class="segment neg" style="width:${fmtPct(neg)}"></span>
      </div>
      ${withNumbers ? `
      <div class="scores">
        <span>Positive ${fmtPct(pos)}</span>
        <span>Neutral ${fmtPct(neu)}</span>
        <span>Negative ${fmtPct(neg)}</span>
      </div>` : ``}
    </div>`;
}

/* ---------- PINS (localStorage) ---------- */
const PIN_KEY = "informed360.pinned";
function loadPins(){
  try{ state.pins = JSON.parse(localStorage.getItem(PIN_KEY)||"[]"); }catch{ state.pins = []; }
}
function savePins(){ localStorage.setItem(PIN_KEY, JSON.stringify(state.pins.slice(0,50))); }
function isPinned(id){ return state.pins.some(p => p.id === id); }
function togglePin(article){
  const id = article.id || article.link;
  if (isPinned(id)){
    state.pins = state.pins.filter(p => p.id !== id);
  } else {
    state.pins.unshift({
      id, title: article.title, link: article.link, image: article.image,
      source: article.source, sourceIcon: article.sourceIcon, publishedAt: article.publishedAt,
      sentiment: article.sentiment
    });
  }
  savePins();
  renderPinned(); // refresh left column immediately
}

/* ---------- data load ---------- */
async function fetchJSON(u){ const r = await fetch(u); if(!r.ok) throw new Error(await r.text()); return r.json(); }

async function loadAll(){
  // Build /api/news params
  const qs = new URLSearchParams();
  if (state.filter !== "all") qs.set("sentiment", state.filter);
  if (state.experimental) qs.set("experimental", "1");
  if (state.category && !["home","foryou","local"].includes(state.category)) qs.set("category", state.category);

  let news = { articles: [] }, topicsPayload = { topics: [] };
  try { news = await fetchJSON(`/api/news${qs.toString() ? ("?"+qs.toString()) : ""}`); } catch(e){ console.warn("news err", e); }
  try { topicsPayload = await fetchJSON(`/api/topics`); } catch(e){ console.warn("topics err", e); }

  state.articles = news.articles || [];

  // 1) Mood ticker from *current* articles
  renderMoodTicker(state.articles);

  // 2) Hero + Compact news
  renderHeroAndLists();

  // 3) Trending topics (limit 3)
  state.topics = (topicsPayload.topics || []).slice(0,3);
  renderTopics();

  // 4) Leaderboard from *current* articles
  renderLeaderboard(state.articles);

  // housekeeping
  $("#briefingDate").textContent = todayStr();
  $("#year").textContent = new Date().getFullYear();
}

/* ---------- Mood ---------- */
function renderMoodTicker(articles){
  if (!articles.length){ $("#moodTicker").textContent = "Nation’s Mood — Pos 0% · Neu 100% · Neg 0%"; return; }
  const acc = {pos:0, neu:0, neg:0};
  for (const a of articles){
    acc.pos += a.sentiment?.pos || 0;
    acc.neu += a.sentiment?.neu || 0;
    acc.neg += a.sentiment?.neg || 0;
  }
  const n = articles.length;
  const pos = Math.round(acc.pos/n), neu = Math.round(acc.neu/n), neg = Math.round(acc.neg/n);
  $("#moodTicker").textContent = `Nation’s Mood — Positive ${pos}% · Neutral ${neu}% · Negative ${neg}%`;
}

/* ---------- Pinned (max 2) ---------- */
function renderPinned(){
  loadPins();
  const host = $("#pinned");
  const items = state.pins.slice(0,2);
  if (!items.length){ host.innerHTML = `<div class="row"><div class="row-title">No pinned items yet. Use “Pin” on any story to track it here.</div></div>`; return; }
  host.innerHTML = items.map(p => `
    <div class="row">
      <a class="row-title" href="${p.link}" target="_blank" rel="noopener">${p.title}</a>
      <div class="row-meta">
        <span class="source-chip"><img class="favicon" src="${p.sourceIcon || `https://logo.clearbit.com/${domainFrom(p.link)}`}"> ${p.source||domainFrom(p.link)}</span>
        <span>·</span>
        <span>${new Date(p.publishedAt).toLocaleString()}</span>
      </div>
      ${renderSentiment(p.sentiment, true)}
      <div><button class="pin-btn" aria-pressed="true" data-unpin="${p.id}">Unpin</button></div>
    </div>
  `).join("");

  // unpin handlers
  $$('[data-unpin]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      state.pins = state.pins.filter(x=> x.id !== btn.dataset.unpin);
      savePins(); renderPinned();
    });
  });
}
$("#managePinsBtn")?.addEventListener("click", ()=> alert("Pins are saved on this device. Use 'Pin' on any story to add it here, 'Unpin' to remove."));

/* ---------- Hero + Compact News ---------- */
function heroSlide(a){
  const id = a.id || a.link;
  return `
    <article class="hero-slide">
      <div class="hero-img"><img src="${a.image}" alt=""></div>
      <div class="hero-content">
        <h3>${a.title}</h3>
        <a href="${a.link}" target="_blank" class="analysis-link" rel="noopener">Read Analysis</a>
        ${renderSentiment(a.sentiment, true)}
        <div class="row-meta">
          <span class="source-chip"><img class="favicon" src="${a.sourceIcon || `https://logo.clearbit.com/${domainFrom(a.link)}`}"> ${a.source}</span>
          <span>·</span>
          <span>${new Date(a.publishedAt).toLocaleString()}</span>
        </div>
        <div><button class="pin-btn" aria-pressed="${isPinned(id)}" data-pin="${id}">${isPinned(id)?"Pinned":"Pin"}</button></div>
      </div>
    </article>`;
}
function cardCompact(a){
  const id = a.id || a.link;
  return `
    <a class="news-card" href="${a.link}" target="_blank" rel="noopener">
      <img class="thumb" src="${a.image}" alt="">
      <div>
        <div class="title">${a.title}</div>
        <div class="row-meta">
          <span class="source-chip"><img class="favicon" src="${a.sourceIcon || `https://logo.clearbit.com/${domainFrom(a.link)}`}"> ${a.source}</span>
          <span>·</span>
          <span>${new Date(a.publishedAt).toLocaleString()}</span>
        </div>
        ${renderSentiment(a.sentiment, true)}
      </div>
    </a>`;
}
function renderHeroAndLists(){
  // HERO — first 4
  const slides = state.articles.slice(0,4);
  const track = $("#heroTrack");
  const dots  = $("#heroDots");
  if (!slides.length){ $("#hero").style.display="none"; } else {
    $("#hero").style.display="";
    track.innerHTML = slides.map(heroSlide).join("");
    dots.innerHTML = slides.map((_,i)=>`<button data-i="${i}" aria-label="Go to slide ${i+1}"></button>`).join("");
    updateHero(0);
  }

  // Pinned (left) refresh now
  renderPinned();

  // Compact News — next 4
  $("#newsFour").innerHTML = state.articles.slice(4, 8).map(cardCompact).join("");

  // bind pin buttons inside hero
  $$('[data-pin]').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.preventDefault(); e.stopPropagation();
      const id = btn.dataset.pin;
      const art = state.articles.find(x => (x.id||x.link) === id);
      if (art){ togglePin(art); btn.setAttribute('aria-pressed', isPinned(id)); btn.textContent = isPinned(id) ? "Pinned" : "Pin"; }
    });
  });
}

/* ---------- Hero controls ---------- */
function updateHero(i){
  const n = $$("#heroTrack .hero-slide").length;
  if (!n) return;
  state.hero.index = (i+n)%n;
  $("#heroTrack").style.transform = `translateX(-${state.hero.index*100}%)`;
  $$("#heroDots button").forEach((b,bi)=> b.classList.toggle("active", bi===state.hero.index));
}
$("#heroPrev")?.addEventListener("click", ()=> updateHero(state.hero.index-1));
$("#heroNext")?.addEventListener("click", ()=> updateHero(state.hero.index+1));
$("#hero")?.addEventListener("mouseenter", ()=> state.hero.pause = true);
$("#hero")?.addEventListener("mouseleave", ()=> state.hero.pause = false);
function startHeroAuto(){ stopHeroAuto(); state.hero.timer = setInterval(()=>{ if(!state.hero.pause && window.matchMedia("(min-width:768px)").matches) updateHero(state.hero.index+1); }, 6000); }
function stopHeroAuto(){ if(state.hero.timer){ clearInterval(state.hero.timer); state.hero.timer=null; } }

/* ---------- Trending (limit 3 already sliced in loadAll) ---------- */
function renderTopics(){
  const el = $("#topicsList");
  if (!state.topics || !state.topics.length){
    el.innerHTML = `<div class="row"><div class="row-title">No trending topics yet</div></div>`;
    return;
  }
  el.innerHTML = state.topics.map(t=>{
    const icons = (t.icons||[]).slice(0,4).map(ic=>`<img class="favicon" src="${ic}" alt="">`).join("");
    return `
      <div class="row">
        <div class="row-title">${t.title}</div>
        <div class="row-meta">
          <span>${t.count||0} articles</span> · <span>${t.sources||0} sources</span> <span class="row-icons">${icons}</span>
        </div>
        ${renderSentiment({ pos:t.sentiment?.pos||0, neu:t.sentiment?.neu||0, neg:t.sentiment?.neg||0 }, true)}
      </div>
    `;
  }).join("");
}

/* ---------- Leaderboard (from current articles) ---------- */
function renderLeaderboard(articles){
  // group by domain (or provided source)
  const groups = new Map();
  for (const a of articles){
    const key = (a.source && a.source.toLowerCase()) || domainFrom(a.link) || "source";
    const g = groups.get(key) || { domain:key, icon: a.sourceIcon || `https://logo.clearbit.com/${domainFrom(a.link)}`, pos:0, neu:0, neg:0, n:0 };
    g.pos += a.sentiment?.pos || 0;
    g.neu += a.sentiment?.neu || 0;
    g.neg += a.sentiment?.neg || 0;
    g.n += 1;
    groups.set(key, g);
  }
  const rows = [...groups.values()]
    .filter(g=> g.n >= 2)                   // at least 2 articles
    .map(g => ({ ...g, pos:Math.round(g.pos/g.n), neu:Math.round(g.neu/g.n), neg:Math.round(g.neg/g.n)}))
    .sort((a,b) => b.n - a.n)               // most coverage first
    .slice(0,6);

  if (!rows.length){ $("#leaderboard").innerHTML = `<div class="lb-row">Insufficient data</div>`; return; }

  $("#leaderboard").innerHTML = rows.map(r => `
    <div class="lb-row">
      <div class="lb-brand"><img class="favicon" src="${r.icon}" alt=""> ${r.domain}</div>
      <div class="lb-bar">
        <span class="lb-pos" style="width:${fmtPct(r.pos)}"></span>
        <span class="lb-neu" style="width:${fmtPct(r.neu)}"></span>
        <span class="lb-neg" style="width:${fmtPct(r.neg)}"></span>
      </div>
    </div>
  `).join("");
}

/* ---------- controls ---------- */
$$(".chip[data-sent]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    $$(".chip[data-sent]").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    state.filter = btn.dataset.sent; loadAll();
  });
});
$("#expChip")?.addEventListener("click", ()=>{
  state.experimental = !state.experimental;
  $("#expChip").classList.toggle("active", state.experimental);
  loadAll();
});
$$(".gn-tabs .tab[data-cat]").forEach(tab=>{
  tab.addEventListener("click", ()=>{
    $$(".gn-tabs .tab").forEach(t=>t.classList.remove("active"));
    tab.classList.add("active");
    state.category = tab.dataset.cat; loadAll();
  });
});

/* ---------- boot ---------- */
applyTheme();
loadPins();
$("#briefingDate").textContent = todayStr();
loadAll();
startHeroAuto();
