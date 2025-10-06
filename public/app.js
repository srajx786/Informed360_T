/* public/app.js
   Informed360 — page bootstrap for Home.
   Keeps theme/structure; adds split-bar under tickers and moves weather pill target.
*/

// ===== Utilities =====
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

function fmtDateLong(d=new Date()){
  return d.toLocaleDateString(undefined, { weekday:'long', month:'long', day:'numeric' });
}
function el(tag, cls, html){
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

// ===== Page header date
$("#briefingDate").textContent = fmtDateLong();

// ===== Mood ticker pill content (you already compute this server-side; we fetch and fill)
async function renderMoodTicker(){
  try{
    const res = await fetch("/api/mood-today"); // your existing endpoint that powers the pill
    if(!res.ok) throw new Error("mood-today failed");
    const { positive=0, neutral=0, negative=0 } = await res.json();
    $("#moodTickerPill").innerHTML =
      `Nation’s Mood — <span class="pos">Positive ${positive}%</span> · ` +
      `<span class="neu">Neutral ${neutral}%</span> · ` +
      `<span class="neg">Negative ${negative}%</span>`;
  }catch(e){
    // Fallback text if API missing; still render structure
    $("#moodTickerPill").innerHTML =
      `Nation’s Mood — <span class="pos">Positive 0%</span> · ` +
      `<span class="neu">Neutral 0%</span> · ` +
      `<span class="neg">Negative 0%</span>`;
  }
}

// ===== Weather pill (moved up) — reuses your existing weather call/logic
async function renderWeather(){
  try{
    const r = await fetch("/api/weather"); // your existing endpoint
    if(!r.ok) throw new Error("weather fail");
    const w = await r.json();
    const emoji = w.icon || "🌤️";
    $("#weatherPill").innerHTML = `<span class="w-emoji">${emoji}</span> <span>Your area</span> <strong>${w.tempC ?? "--"}°C</strong>`;
  }catch{
    $("#weatherPill").innerHTML = `<span class="w-emoji">🌤️</span> <span>Your area</span> <strong>—</strong>`;
  }
}

// ===== Markets row (unchanged: fill into #marketsRow as today)
async function renderMarkets(){
  try{
    const r = await fetch("/api/markets"); // your existing endpoint
    const list = await r.json(); // expect array of { label, value, deltaPct, up }
    const host = $("#marketsRow");
    host.innerHTML = "";
    (list || []).forEach(m => {
      const pill = el("div","pill");
      const arrow = m.up ? "▲" : "▼";
      const color = m.up ? "style='color:#16a34a'" : "style='color:#e11d48'";
      pill.innerHTML = `<strong>${m.label}</strong> ${m.value} <span ${color}>${arrow} ${m.deltaPct}%</span>`;
      host.appendChild(pill);
    });
  }catch{
    $("#marketsRow").innerHTML = "";
  }
}

// ===== Initial render for the top stripe
renderMoodTicker();
renderWeather();
renderMarkets();

// ======================================================
// NEW: Nation’s Mood split-bar (4-hour buckets, last 3 days)
// Uses /api/mood-trend, which the server computes from cached articles
// ======================================================
(function mountMoodSplitBar(){
  const elCanvas = document.getElementById("moodSplitBar");
  if (!elCanvas || typeof Chart === "undefined") return;

  const POS = "#16a34a";  // green
  const NEG = "#e11d48";  // red
  const BAND = "#f1f5f9"; // center band

  fetch("/api/mood-trend?days=3&stepHours=4")
    .then(r => r.json())
    .then(({ points }) => {
      if (!points || !points.length) return;

      const labels = points.map(p =>
        new Date(p.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      );
      const pos = points.map(p => p.pos || 0);
      const neg = points.map(p => -(p.neg || 0)); // draw below baseline

      const maxMag = Math.max(Math.max(...pos), Math.max(...neg.map(v => Math.abs(v))));
      const yMax = Math.ceil((maxMag + 5) / 5) * 5;

      const centerBand = {
        id:"centerBand",
        beforeDatasetsDraw(chart){
          const { ctx, chartArea, scales } = chart;
          const y0 = scales.y.getPixelForValue(0);
          const h = 14;
          ctx.save();
          ctx.fillStyle = BAND;
          ctx.fillRect(chartArea.left, y0 - h/2, chartArea.right - chartArea.left, h);
          ctx.strokeStyle = "#e2e8f0";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(chartArea.left, y0 - h/2);
          ctx.lineTo(chartArea.right, y0 - h/2);
          ctx.movePath = ctx.moveTo;
          ctx.moveTo(chartArea.left, y0 + h/2);
          ctx.lineTo(chartArea.right, y0 + h/2);
          ctx.stroke();
          ctx.restore();
        }
      };

      new Chart(elCanvas.getContext("2d"), {
        type: "bar",
        plugins: [centerBand],
        data: {
          labels,
          datasets: [
            {
              label:"Positive",
              data:pos,
              backgroundColor:POS,
              borderColor:POS,
              borderWidth:0,
              borderRadius:3,
              barPercentage:0.7,
              categoryPercentage:0.9,
              stack:"mood"
            },
            {
              label:"Negative",
              data:neg,
              backgroundColor:NEG,
              borderColor:NEG,
              borderWidth:0,
              borderRadius:3,
              barPercentage:0.7,
              categoryPercentage:0.9,
              stack:"mood"
            }
          ]
        },
        options:{
          responsive:true,
          maintainAspectRatio:false,
          interaction:{ mode:"index", intersect:false },
          scales:{
            x:{
              stacked:true,
              grid:{ display:false },
              ticks:{ color:"#334155", maxRotation:0, autoSkip:true }
            },
            y:{
              stacked:true,
              min:-yMax,
              max:yMax,
              grid:{ drawBorder:false, color:"#eef2f7" },
              ticks:{ callback:v=>`${Math.abs(v)}%`, color:"#64748b" }
            }
          },
          plugins:{
            legend:{ display:false },
            tooltip:{
              callbacks:{
                title:ctx => labels[ctx[0].dataIndex],
                afterBody:ctx => {
                  const i = ctx[0].dataIndex;
                  const p = points[i];
                  return [
                    `Positive: ${p.pos || 0}%`,
                    `Neutral:  ${p.neu || 0}%`,
                    `Negative: ${p.neg || 0}%`,
                    `Articles: ${p.count || 0}`
                  ];
                }
              }
            }
          }
        }
      });
    })
    .catch(err => console.warn("mood splitbar failed", err));
})();