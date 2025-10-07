// Client – real 4-hour chart + leaderboard + cards
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s,r)];
const jget = (u, f={}) => fetch(u).then(r=>r.json()).catch(()=>f);

const moodPos=$("#moodPos"), moodNeu=$("#moodNeu"), moodNeg=$("#moodNeg");
const moodTrendCanvas=$("#moodTrend");
const pinnedStack=$("#pinnedStack"), trendingList=$("#trendingList");
const heroCarousel=$("#heroCarousel"), heroDots=$("#heroDots");
const newsList=$("#newsList"), leaderboard=$("#leaderboard");

const toPct = (n)=>`${Math.round(n)}%`;
const bar = (p,n,e)=>`
  <div class="bar">
    <span class="pos" style="width:${p}%"></span>
    <span class="neu" style="width:${n}%"></span>
    <span class="neg" style="width:${e}%"></span>
  </div>`;

function drawSplit(buckets){
  const ctx = moodTrendCanvas.getContext("2d");
  const W = moodTrendCanvas.width = moodTrendCanvas.clientWidth;
  const H = moodTrendCanvas.height = 90;
  ctx.clearRect(0,0,W,H);
  if(!buckets.length) return;
  const step = W / buckets.length;
  buckets.forEach((b,i)=>{
    const x = i*step + step*0.25;
    const w = step*0.5;
    // top green
    const gh = (b.positive/100)*36;
    ctx.fillStyle = "#15b36d";
    ctx.fillRect(x, 10 + (36-gh), w, gh);
    // bottom red
    const rh = (b.negative/100)*36;
    ctx.fillStyle = "#e64c3c";
    ctx.fillRect(x, 54, w, rh);
  });
}

function smallCard(it){
  const p = it.sentiment.label==="positive"?100:0;
  const n = it.sentiment.label==="neutral"?100:0;
  const e = it.sentiment.label==="negative"?100:0;
  return `
    <article class="story-card">
      <div class="story-title">${it.title}</div>
      <div class="story-meta">${it.source} · ${new Date(it.publishedAt).toLocaleString()}</div>
      ${bar(p,n,e)}
      <div class="story-meta"><a href="${it.link}" target="_blank" rel="noopener">Read</a></div>
    </article>`;
}

function heroCard(it){
  const p = it.sentiment.label==="positive"?100:0;
  const n = it.sentiment.label==="neutral"?100:0;
  const e = it.sentiment.label==="negative"?100:0;
  return `
    <div class="media"></div>
    <h4 class="story-title">${it.title}</h4>
    ${bar(p,n,e)}
    <div class="story-meta">${it.source} · ${new Date(it.publishedAt).toLocaleString()}</div>
    <a class="cta" href="${it.link}" target="_blank" rel="noopener">Read Analysis</a>
  `;
}

let heroIdx=0, heroItems=[];
function paintHero(){
  if(!heroItems.length){ heroCarousel.innerHTML = `<div style="height:390px"></div>`; return;}
  heroIdx = (heroIdx+heroItems.length)%heroItems.length;
  heroCarousel.innerHTML = heroCard(heroItems[heroIdx]);
  heroDots.innerHTML = heroItems.map((_,i)=>`<span class="dot-pt ${i===heroIdx?'active':''}"></span>`).join("");
}

function paintTrending(rows){
  trendingList.innerHTML = rows.map(r=>`
    <article class="story-card">
      <div class="story-title">${r.topic}</div>
      ${bar(r.positive, r.neutral, r.negative)}
      <div class="story-meta">${r.articles} articles · ${r.sources} sources</div>
    </article>`).join("");
}

function paintNews(items){
  const tpl = it => {
    const p = it.sentiment.label==="positive"?100:0;
    const n = it.sentiment.label==="neutral"?100:0;
    const e = it.sentiment.label==="negative"?100:0;
    return `
      <article class="story-card">
        <div class="story-title">${it.title}</div>
        <div class="story-meta">${it.source} · ${new Date(it.publishedAt).toLocaleString()}</div>
        ${bar(p,n,e)}
        <div class="story-meta"><a href="${it.link}" target="_blank" rel="noopener">Open</a></div>
      </article>`;
  };
  newsList.innerHTML = items.slice(0,12).map(tpl).join("");
}

function paintPinned(items){
  pinnedStack.innerHTML = items.slice(0,2).map(smallCard).join("");
}

function paintLeaderboard(rows){
  const chunks=[]; for(let i=0;i<rows.length;i+=4) chunks.push(rows.slice(i,i+4));
  leaderboard.innerHTML = chunks.map(c=>`
    <div class="lb-row">
      ${c.map(r=>`
        <div class="lb-cell">
          <div class="lb-stack">
            <div class="lb-pos" style="height:${r.positive}%"></div>
            <div class="lb-neu" style="height:${r.neutral}%; bottom:${r.positive}%"></div>
            <div class="lb-neg" style="height:${r.negative}%"></div>
          </div>
          <div class="lb-pct">${r.positive}% / ${r.neutral}% / ${r.negative}%</div>
          <div class="lb-count">${r.source} · ${r.count}</div>
        </div>`).join("")}
    </div>`).join("");
}

async function hydrate(){
  // mood & 4-hour trend
  const mood = await jget("/api/mood",{positive:0,neutral:0,negative:0,count:0});
  moodPos.textContent = `Positive ${toPct(mood.positive)}`;
  moodNeu.textContent = `Neutral ${toPct(mood.neutral)}`;
  moodNeg.textContent = `Negative ${toPct(mood.negative)}`;

  const trend = await jget("/api/mood-trend",{buckets:[]});
  drawSplit(trend.buckets||[]);

  // news, trending, leaderboard
  const [{items},{rows:trendRows},{rows:lbRows}] = await Promise.all([
    jget("/api/news",{items:[]}),
    jget("/api/trending",{rows:[]}),
    jget("/api/leaderboard",{rows:[]})
  ]);

  const list = items;
  heroItems = list.slice(0,4); paintHero(); setInterval(()=>{heroIdx++;paintHero();},6000);
  paintPinned(list);
  paintTrending(trendRows||[]);
  paintNews(list);
  paintLeaderboard(lbRows||[]);

  // filters
  $$(".chip[data-filter]").forEach(btn=>{
    btn.onclick = ()=>{
      $$(".chip[data-filter]").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      const f = btn.dataset.filter;
      const out = f==="all" ? list : list.filter(x=>x.sentiment.label===f);
      paintNews(out);
    };
  });
}

hydrate();