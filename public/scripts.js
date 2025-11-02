// ====== COMMON ======
const $ = (id) => document.getElementById(id);
const toast = (t) => {
  console.log(t);
};

// Theme + session + chat wiring (unchanged basics)
(() => {
  const theme = $("theme");
  const session = $("session");
  const newBtn = $("new");
  const chat = $("chat");
  const msg = $("msg");
  const send = $("send");
  const mic = $("mic");

  if (theme) {
    theme.onclick = () => {
      const next =
        document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      localStorage.setItem("nb-theme", next);
    };
    document.documentElement.dataset.theme =
      localStorage.getItem("nb-theme") || "light";
  }

  if (newBtn && session) {
    newBtn.onclick = () => {
      session.value = crypto.randomUUID();
      if (chat) chat.innerHTML = "";
      toast("New session created.");
    };
    if (!session.value) newBtn.click();
  }

  function addBubble(role, text) {
    if (!chat) return;
    const wrap = document.createElement("div");
    wrap.className =
      "nb-bubble " + (role === "user" ? "nb-bubble--user" : "nb-bubble--ai");
    wrap.innerText = text;
    chat.appendChild(wrap);
    chat.scrollTop = chat.scrollHeight;
  }

  if (send && msg && session) {
    send.onclick = async () => {
      const s = session.value.trim();
      const m = msg.value.trim();
      if (!s || !m) return toast("Type a message first.");
      addBubble("user", m);
      msg.value = "";
      send.disabled = true;
      try {
        const r = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: s, message: m }),
        });
        const data = await r.json();
        addBubble("ai", data.reply ?? "[no reply]");
      } catch (e) {
        console.error(e);
        addBubble("ai", "⚠️ Error contacting server.");
      } finally {
        send.disabled = false;
      }
    };
    msg.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") send.click();
    });
  }

  if (mic && window.webkitSpeechRecognition) {
    let rec;
    mic.onclick = () => {
      const R = window.webkitSpeechRecognition;
      if (!rec) {
        rec = new R();
        rec.lang = "en-US";
        rec.interimResults = false;
        rec.onresult = (e) => {
          const text = Array.from(e.results)
            .map((r) => r[0].transcript)
            .join(" ");
          msg.value = (msg.value ? msg.value + " " : "") + text;
        };
      }
      rec.start();
    };
  }
})();

// ====== TELEMETRY ======
const fileIn = $("file"); // keep original IDs
const analyzeBtn = $("analyze");
const telemetryOut = $("telemetryOut");
let lastCsvText = "";

function parseLocalCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const parts = line.split(",").map((x) => x.trim());
    const obj = {};
    headers.forEach((h, i) => {
      const v = parts[i] ?? "";
      const n = Number(v);
      obj[h] =
        v !== "" && !Number.isNaN(n) && /^-?\d+(\.\d+)?$/.test(v) ? n : v;
    });
    return obj;
  });
  return { headers, rows };
}

function fmt(n, d = 2) {
  if (typeof n !== "number" || !isFinite(n)) return String(n);
  return n.toLocaleString(undefined, {
    maximumFractionDigits: d,
    minimumFractionDigits: d,
  });
}

function unitFor(key) {
  if (/temp/i.test(key)) return "°C";
  if (/volt/i.test(key)) return "V";
  if (/speed/i.test(key)) return "km/h";
  if (/rpm/i.test(key)) return "rpm";
  return "";
}

function miniSparkSVG(values) {
  if (!values.length) return "";
  const w = 240,
    h = 48,
    p = 4;
  const min = Math.min(...values),
    max = Math.max(...values);
  const span = Math.max(1e-9, max - min);
  const stepX = (w - 2 * p) / Math.max(1, values.length - 1);
  const pts = values
    .map((v, i) => {
      const x = p + i * stepX;
      const y = p + (h - 2 * p) * (1 - (v - min) / span);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  // keep stroke thin; do not stretch
  return `
    <svg viewBox="0 0 ${w} ${h}" class="nb-spark" preserveAspectRatio="xMidYMid meet">
      <polyline points="${pts}" vector-effect="non-scaling-stroke" fill="none" stroke="currentColor" stroke-width="2"/>
    </svg>
  `;
}

function arrow(trend) {
  const t = typeof trend === "number" && isFinite(trend) ? trend : 0;
  if (t > 0.2) return `<span class="nb-arrow up">▲</span>`;
  if (t < -0.2) return `<span class="nb-arrow down">▼</span>`;
  return `<span class="nb-arrow flat">—</span>`;
}

function val(v, digits = 2) {
  return typeof v === "number" ? Number(v).toFixed(digits) : String(v);
}

function renderTelemetry(result, localCsv) {
  // helpers local to this renderer
  const IGNORE_RE = /^(lap|time|timestamp|ts)$/i;
  const fmt = (n, d = 2) =>
    typeof n === "number" && isFinite(n)
      ? n.toLocaleString(undefined, {
          maximumFractionDigits: d,
          minimumFractionDigits: d,
        })
      : String(n);

  function trend(n) {
    return typeof n === "number" && isFinite(n) ? n.toFixed(2) : "0.00";
  }

  const unitFor = (key) => {
    if (/temp/i.test(key)) return "°C";
    if (/volt/i.test(key)) return "V";
    if (/speed/i.test(key)) return "km/h";
    if (/rpm/i.test(key)) return "rpm";
    return "";
  };

  if (!telemetryOut) return;
  telemetryOut.innerHTML = "";

  // Local parse so we can draw sparklines
  const parsed = parseLocalCSV(localCsv || "");

  // Head
  const head = document.createElement("div");
  head.className = "nb-telemetry-head";
  const headers = (result.summary?.headers || []).filter(
    (h) => !IGNORE_RE.test(h)
  );
  head.innerHTML = `
    <div class="nb-title-sm">Summary</div>
    <div class="nb-muted">${
      result.summary?.rowCount ?? 0
    } rows • ${headers.join(", ")}</div>
  `;
  telemetryOut.appendChild(head);

  // Build time-series arrays for sparklines (numbers only)
  const series = {};
  for (const key of headers) {
    const vals = parsed.rows
      .map((r) => r[key])
      .filter((x) => typeof x === "number");
    if (vals.length) series[key] = vals;
  }

  // Tiles
  const tiles = document.createElement("div");
  tiles.className = "nb-tiles";
  const stats = result.summary?.stats || {};

  Object.keys(stats).forEach((key) => {
    if (IGNORE_RE.test(key)) return; // belt & suspenders
    const s = stats[key];
    if (!s) return;

    // basic risk tinting
    let risk = "";
    if (/temp|temperature/i.test(key) && s.trend > 0.5) risk = " risk";
    if (/volt/i.test(key) && s.trend < -0.5) risk = " risk";
    if (s.outlierCount > 0) risk = " risk";

    const spark = series[key] ? miniSparkSVG(series[key]) : "";
    const u = unitFor(key);

    const tile = document.createElement("div");
    tile.className = "nb-tile" + risk;
    tile.innerHTML = `
  <div class="nb-tile-head">
    <div class="nb-tile-key">${key}</div>
    <div class="nb-tile-trend">
      ${arrow(s.trend)}
      <span class="nb-trend-num">${
        typeof s.trend === "number" ? s.trend.toFixed(2) : "0.00"
      } ${u}</span>
    </div>
  </div>

  <div class="nb-metrics">
    <div class="k">min</div><div class="v">${fmt(s.min)} ${u}</div>
    <div class="k">max</div><div class="v">${fmt(s.max)} ${u}</div>
    <div class="k">mean</div><div class="v">${fmt(s.mean)} ${u}</div>
    <div class="k">std</div><div class="v">${fmt(s.std)} ${u}</div>
    <div class="k">n</div><div class="v">${fmt(s.n, 0)}</div>
    <div class="k">outliers</div><div class="v">${fmt(s.outlierCount, 0)}</div>
  </div>

  <div class="nb-spark-wrap">${spark}</div>
`;
    tiles.appendChild(tile);
  });

  telemetryOut.appendChild(tiles);

  // AI analysis — bullets if present, fallback to paragraph
  const analysisWrap = document.createElement("div");
  analysisWrap.className = "nb-analysis";
  const title = document.createElement("div");
  title.className = "nb-title-sm";
  title.textContent = "AI Analysis";
  analysisWrap.appendChild(title);

  const raw = String(result.analysis ?? "").trim();
  const bulletLines = raw
    .split(/\r?\n/)
    .filter((line) => /^\s*([-*]|•)/.test(line));

  if (bulletLines.length) {
    const ul = document.createElement("ul");
    ul.className = "nb-list";
    bulletLines.forEach((line) => {
      const li = document.createElement("li");
      li.textContent = line.replace(/^\s*([-*]|•)\s?/, "").trim();
      ul.appendChild(li);
    });
    analysisWrap.appendChild(ul);
  } else {
    const p = document.createElement("div");
    p.style.whiteSpace = "pre-wrap";
    p.textContent = raw || "No analysis text returned.";
    analysisWrap.appendChild(p);
  }

  telemetryOut.appendChild(analysisWrap);
}

if (analyzeBtn && fileIn) {
  analyzeBtn.onclick = async () => {
    const file = fileIn.files?.[0];
    if (!file) {
      alert("Choose a CSV first.");
      return;
    }
    const text = await file.text();
    lastCsvText = text;
    if (telemetryOut) telemetryOut.textContent = "Analyzing…";
    try {
      const r = await fetch("/api/telemetry/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          csv: text,
          sessionId: ($("session")?.value || "").trim(),
        }),
      });

      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      renderTelemetry(data, lastCsvText);
    } catch (e) {
      console.error(e);
      if (telemetryOut) telemetryOut.textContent = "Error analyzing CSV.";
    }
  };
}

// ===== Strategy helpers =====

// Reproduce the same per-lap behavior client-side so we can draw charts.
function simulateClientSeries(params) {
  const laps = Number(params.laps);
  const base = Number(params.baseLapTime ?? 90);
  const fuelPerLap = Number(params.fuelPerLap ?? 0.12);
  const tank = Number(params.tankSize ?? 8);
  const pitLoss = Number(params.pitLoss ?? 22);
  const tireDeg = Number(params.tireDegradationPerLap ?? 0.08);
  const stints =
    Array.isArray(params.stintPlan) && params.stintPlan.length
      ? params.stintPlan.map((x) => Number(x))
      : [laps];
  const safetyCarLap =
    params.safetyCarLap !== undefined && params.safetyCarLap !== null
      ? Number(params.safetyCarLap)
      : null;
  const safetyCarDelta = Number(params.safetyCarDelta ?? -7);

  const lapTimes = [];
  const fuelLevel = [];
  const pitLaps = [];

  let feasible = true;
  let lapCounter = 0;
  let fuel = tank;

  for (let stintIdx = 0; stintIdx < stints.length; stintIdx++) {
    const stintLaps = stints[stintIdx];

    // check feasibility for the stint
    if (stintLaps * fuelPerLap > tank) feasible = false;

    // (optional) refuel at pit start
    if (stintIdx > 0) {
      pitLaps.push(lapCounter); // pit occurs between previous & next lap
      fuel = tank; // simple refuel-to-full model
    }

    for (let i = 0; i < stintLaps; i++) {
      lapCounter++;
      // tire degradation is per lap within a stint
      let lapTime = base + tireDeg * i;
      if (safetyCarLap && lapCounter === safetyCarLap)
        lapTime -= safetyCarDelta;

      lapTimes.push(lapTime);

      // fuel burn
      fuel -= fuelPerLap;
      fuelLevel.push(Math.max(0, fuel));
    }
  }

  // total with pit losses
  const totalTime =
    lapTimes.reduce((a, b) => a + b, 0) + pitLaps.length * pitLoss;
  if (lapCounter !== laps) feasible = false;

  return { lapTimes, fuelLevel, pitLaps, feasible, totalTime };
}

// === Interactive SVG chart with hover (lap/time), X+Y grids, pit markers ===
function drawInteractiveLineChart(
  targetEl,
  data,
  pits = [],
  { yUnit = "s", title = "" } = {}
) {
  const svgNS = "http://www.w3.org/2000/svg";

  // Size based on container (responsive-ish)
  const w = Math.max(400, targetEl.clientWidth || 600);
  const h = 220; // compact height
  const padL = 42; // left padding for Y labels
  const padR = 20;
  const padT = 20;
  const padB = 26;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = Math.max(1e-9, max - min);

  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const stepX = innerW / (data.length - 1);

  const xAt = (i) => padL + i * stepX;
  const yAt = (v) => padT + innerH - ((v - min) / span) * innerH;

  // Prep points
  const points = data.map((v, i) => ({ x: xAt(i), y: yAt(v), v, lap: i + 1 }));

  // SVG
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("class", "nb-line");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.style.width = "100%";
  svg.style.height = "220px";

  // Grid: horizontal (Y ticks) with labels
  const yTicks = 4; // 4 horizontal bands
  for (let i = 0; i <= yTicks; i++) {
    const ty = padT + (i / yTicks) * innerH;
    const val = max - (i / yTicks) * span;
    const gl = document.createElementNS(svgNS, "line");
    gl.setAttribute("x1", padL);
    gl.setAttribute("x2", w - padR);
    gl.setAttribute("y1", ty);
    gl.setAttribute("y2", ty);
    gl.setAttribute("class", "grid");
    svg.appendChild(gl);

    const lab = document.createElementNS(svgNS, "text");
    lab.setAttribute("x", padL - 6);
    lab.setAttribute("y", ty + 3);
    lab.setAttribute("font-size", "10");
    lab.setAttribute("text-anchor", "end");
    lab.setAttribute("fill", "currentColor");
    lab.textContent = `${val.toFixed(2)}${
      yUnit === "s" ? " s" : yUnit === "L" ? " L" : ""
    }`;
    svg.appendChild(lab);
  }

  // Grid: vertical (lap ticks) + lap labels
  const labelStep = data.length > 14 ? 2 : 1;
  for (let i = 0; i < data.length; i += labelStep) {
    const x = xAt(i);
    const gl = document.createElementNS(svgNS, "line");
    gl.setAttribute("x1", x);
    gl.setAttribute("x2", x);
    gl.setAttribute("y1", padT);
    gl.setAttribute("y2", h - padB);
    gl.setAttribute("class", "grid");
    svg.appendChild(gl);

    const tx = document.createElementNS(svgNS, "text");
    tx.setAttribute("x", x);
    tx.setAttribute("y", h - 6);
    tx.setAttribute("font-size", "10");
    tx.setAttribute("text-anchor", "middle");
    tx.setAttribute("fill", "currentColor");
    tx.textContent = String(i + 1);
    svg.appendChild(tx);
  }

  // Pit lines
  pits.forEach((i) => {
    const x = xAt(i);
    const pl = document.createElementNS(svgNS, "line");
    pl.setAttribute("x1", x);
    pl.setAttribute("x2", x);
    pl.setAttribute("y1", padT);
    pl.setAttribute("y2", h - padB);
    pl.setAttribute("class", "pits");
    svg.appendChild(pl);
  });

  // Polyline
  const poly = document.createElementNS(svgNS, "polyline");
  poly.setAttribute("fill", "none");
  poly.setAttribute("stroke", "currentColor");
  poly.setAttribute("stroke-width", "2");
  poly.setAttribute("vector-effect", "non-scaling-stroke");
  poly.setAttribute("points", points.map((p) => `${p.x},${p.y}`).join(" "));
  svg.appendChild(poly);

  // Hover elements
  const guide = document.createElementNS(svgNS, "line");
  guide.setAttribute("stroke", "currentColor");
  guide.setAttribute("stroke-width", "1");
  guide.setAttribute("stroke-dasharray", "4");
  guide.style.opacity = 0;
  svg.appendChild(guide);

  const marker = document.createElementNS(svgNS, "circle");
  marker.setAttribute("r", 5);
  marker.setAttribute("fill", "var(--nb-accent-2)");
  marker.setAttribute("stroke", "currentColor");
  marker.style.opacity = 0;
  svg.appendChild(marker);

  const tooltip = document.createElementNS(svgNS, "text");
  tooltip.setAttribute("font-size", "13");
  tooltip.setAttribute("fill", "currentColor");
  tooltip.style.opacity = 0;
  svg.appendChild(tooltip);

  // Hit-rect for pointer events
  const hit = document.createElementNS(svgNS, "rect");
  hit.setAttribute("x", padL);
  hit.setAttribute("y", padT);
  hit.setAttribute("width", innerW);
  hit.setAttribute("height", innerH);
  hit.setAttribute("fill", "transparent");
  svg.appendChild(hit);

  const onMove = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const x = clientX - rect.left;
    let idx = Math.round((x - padL) / stepX);
    idx = Math.max(0, Math.min(points.length - 1, idx));
    const p = points[idx];

    guide.setAttribute("x1", p.x);
    guide.setAttribute("x2", p.x);
    guide.setAttribute("y1", padT);
    guide.setAttribute("y2", h - padB);
    guide.style.opacity = 1;

    marker.setAttribute("cx", p.x);
    marker.setAttribute("cy", p.y);
    marker.style.opacity = 1;

    tooltip.textContent =
      yUnit === "L"
        ? `Lap ${p.lap} — ${p.v.toFixed(2)} L`
        : `Lap ${p.lap} — ${p.v.toFixed(2)} s`;
    tooltip.setAttribute("x", Math.min(w - padR - 10, p.x + 10));
    tooltip.setAttribute("y", Math.max(padT + 12, p.y - 10));
    tooltip.style.opacity = 1;
  };

  svg.addEventListener("mousemove", (e) => onMove(e.clientX));
  svg.addEventListener("mouseleave", () => {
    guide.style.opacity = 0;
    marker.style.opacity = 0;
    tooltip.style.opacity = 0;
  });

  // Title (optional)
  if (title) {
    const t = document.createElementNS(svgNS, "text");
    t.setAttribute("x", padL);
    t.setAttribute("y", 14);
    t.setAttribute("font-size", "12");
    t.setAttribute("fill", "currentColor");
    t.textContent = title;
    svg.appendChild(t);
  }

  targetEl.appendChild(svg);
}

// Helper to create a chart card and draw chart inside
function renderLineChartElement(
  values,
  pits = [],
  { title = "", yUnit = "s" } = {}
) {
  const wrap = document.createElement("div");
  wrap.className = "nb-chart";
  if (title) {
    const h4 = document.createElement("h4");
    h4.textContent = title;
    wrap.appendChild(h4);
  }
  const slot = document.createElement("div");
  slot.style.width = "100%";
  wrap.appendChild(slot);

  // Draw after append (so clientWidth is correct)
  queueMicrotask(() =>
    drawInteractiveLineChart(slot, values, pits, { yUnit, title })
  );
  return wrap;
}

// Render full strategy dashboard
function renderStrategyDashboard(data, params) {
  const container = document.createElement("div");
  container.className = "nb-strat";

  // 1) Compute per-lap series on client for charts (matches server assumptions)
  const series = simulateClientSeries(params);

  // 2) Summary tiles
  const feasible = data.result?.feasible ?? series.feasible;
  const total = data.result?.totalTime ?? series.totalTime;
  const pitsCount = data.result?.pits ?? series.pitLaps.length;

  const tiles = `
    <div class="nb-strat-tiles">
      <div class="nb-strat-tile">
        <div class="k">Feasible</div>
        <div class="v">${feasible ? "Yes" : "No"}</div>
      </div>
      <div class="nb-strat-tile">
        <div class="k">Total Time</div>
        <div class="v">${total.toFixed(1)} s</div>
      </div>
      <div class="nb-strat-tile">
        <div class="k">Pit Stops</div>
        <div class="v">${pitsCount}</div>
      </div>
      <div class="nb-strat-tile">
        <div class="k">Base Lap</div>
        <div class="v">${(params.baseLapTime ?? 90).toFixed(2)} s</div>
      </div>
      <div class="nb-strat-tile">
        <div class="k">Tire Deg / lap</div>
        <div class="v">${(params.tireDegradationPerLap ?? 0.08).toFixed(
          2
        )} s</div>
      </div>
      <div class="nb-strat-tile">
        <div class="k">Fuel / lap</div>
        <div class="v">${(params.fuelPerLap ?? 0.12).toFixed(2)} L</div>
      </div>
    </div>
  `;

  // 3) Pit plan table
  const stints =
    Array.isArray(params.stintPlan) && params.stintPlan.length
      ? params.stintPlan.map((n) => Number(n))
      : [Number(params.laps)];
  const rows = [];
  let start = 1;
  for (let i = 0; i < stints.length; i++) {
    const L = stints[i];
    const end = start + L - 1;
    rows.push(`<tr>
      <td>${i + 1}</td>
      <td>${start} – ${end}</td>
      <td>${i < stints.length - 1 ? end : "-"}</td>
    </tr>`);
    start = end + 1;
  }
  const pitTable = `
    <div class="nb-chart">
      <h4>Pit Plan</h4>
      <table class="nb-pit-table">
        <thead><tr><th>Stint</th><th>Laps</th><th>Pit after lap</th></tr></thead>
        <tbody>${rows.join("")}</tbody>
      </table>
    </div>
  `;

  // 4) Charts (as elements so we can attach interactivity)
  const chartsWrap = document.createElement("div");
  chartsWrap.className = "nb-charts";

  const lapChartEl = renderLineChartElement(
    series.lapTimes,
    series.pitLaps.map((x) => x - 1),
    { title: "Lap Time (s)", yUnit: "s" }
  );
  const fuelChartEl = renderLineChartElement(
    series.fuelLevel,
    series.pitLaps.map((x) => x - 1),
    { title: "Fuel Level (L)", yUnit: "L" }
  );

  chartsWrap.appendChild(lapChartEl);
  chartsWrap.appendChild(fuelChartEl);

  // 5) AI commentary (from server)
  const aiBox = document.createElement("div");
  aiBox.className = "nb-chart";
  const aiH = document.createElement("h4");
  aiH.textContent = "AI Commentary";
  const aiBody = document.createElement("div");
  aiBody.className = "nb-pre";
  aiBody.innerHTML = (data.commentary || "").replace(/\n/g, "<br>");
  aiBox.appendChild(aiH);
  aiBox.appendChild(aiBody);

  container.innerHTML = tiles;
  container.appendChild(chartsWrap);
  container.insertAdjacentHTML("beforeend", pitTable);
  container.appendChild(aiBox);
  return container;
}

// ====== STRATEGY ======
const simulateBtn = $("simulate");
const strategyOut = $("strategyOut");

if (simulateBtn && strategyOut) {
  const laps = $("laps"),
    base = $("base"),
    fuel = $("fuel"),
    tank = $("tank");
  const pit = $("pit"),
    deg = $("deg"),
    stints = $("stints"),
    sc = $("sc");

  simulateBtn.onclick = async () => {
    const payload = {
      laps: Number(laps.value),
      baseLapTime: Number(base.value),
      fuelPerLap: Number(fuel.value),
      tankSize: Number(tank.value),
      pitLoss: Number(pit.value),
      tireDegradationPerLap: Number(deg.value),
      stintPlan: stints.value
        .split(",")
        .map((x) => Number(x.trim()))
        .filter((x) => !Number.isNaN(x)),
      safetyCarLap: sc.value ? Number(sc.value) : undefined,
      sessionId: ($("session")?.value || "").trim(), // <= NEW
    };

    strategyOut.textContent = "Simulating…";
    try {
      const r = await fetch("/api/strategy/sim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      strategyOut.innerHTML = ""; // clear
      strategyOut.classList.remove("nb-multi-pit");
      strategyOut.appendChild(renderStrategyDashboard(data, payload));

      // optional highlight if many pits:
      if ((data.result?.pits ?? 0) > 1)
        strategyOut.classList.add("nb-multi-pit");
    } catch (e) {
      console.error(e);
      strategyOut.textContent = "Error running simulation.";
    }
  };
}
