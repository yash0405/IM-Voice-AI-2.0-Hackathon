"use strict";
/* Picky dashboard. Plain JS, no libraries, no network needed. Every number shown comes from the
   bundle produced by the Python engine (dist/picky_demo.html embeds it; live mode fetches it). */

let D = window.PICKY_DATA || null;
const LIVE = !!window.PICKY_LIVE;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const goalLabel = k => { const d = ((D && D.dispositions) || []).find(x => x.key === k); return d ? d.name : String(k || "").replace(/_/g, " "); };
const nf = n => (n == null || isNaN(n)) ? "-" : Math.round(n).toLocaleString("en-US");
const pct = (x, d = 1) => (x == null || isNaN(x)) ? "-" : (x * 100).toFixed(d) + "%";
const pp = (x, d = 1) => (x == null || isNaN(x)) ? "-" : (x >= 0 ? "+" : "") + (x * 100).toFixed(d) + " pp";
const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
                set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

const ICON = {
  check: '<path d="M4 9.5l3.2 3.2L14 5.5" />', x: '<path d="M5 5l8 8M13 5l-8 8" />', approx: '<path d="M4 7c2-2 3.5 2 5.5 0S13 5 14 7M4 12c2-2 3.5 2 5.5 0S13 10 14 12" />',
  alert: '<path d="M9 3.5l6.5 11h-13zM9 8v3M9 13v.2" />', link: '<path d="M7.5 10.5l3-3M6 8L4.6 9.4a2.5 2.5 0 003.5 3.5L9.5 11.5M12 10l1.4-1.4a2.5 2.5 0 00-3.5-3.5L8.5 6.5" />',
  clock: '<circle cx="9" cy="9" r="6" /><path d="M9 5.5V9l2.5 1.5" />', play: '<path d="M6 4l8 5-8 5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M6 4v10M12 4v10" />', back: '<path d="M5 4v10M14 4L7 9l7 5z" />', fwd: '<path d="M13 4v10M4 4l7 5-7 5z" />', stop: '<rect x="4" y="4" width="10" height="10" rx="2"/>',
  up: '<path d="M9 14V4M5 8l4-4 4 4" />', plus: '<path d="M9 4v10M4 9h10" />'
};
const icon = (n, s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;

/* ------------------------------------------------------------------ sha256 (pure JS, works on file://) */
function sha256(str) {
  const K = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
  const bytes = new TextEncoder().encode(str);
  const l = bytes.length, total = ((l + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(total); buf.set(bytes); buf[l] = 0x80;
  const dv = new DataView(buf.buffer); dv.setUint32(total - 4, (l * 8) >>> 0); dv.setUint32(total - 8, Math.floor(l / 0x20000000));
  const H = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  const w = new Uint32Array(64);
  const rr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) { const s0 = rr(w[i-15],7) ^ rr(w[i-15],18) ^ (w[i-15] >>> 3), s1 = rr(w[i-2],17) ^ rr(w[i-2],19) ^ (w[i-2] >>> 10); w[i] = (w[i-16] + s0 + w[i-7] + s1) >>> 0; }
    let [a, b, c, d, e, f, g, hh] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rr(e,6) ^ rr(e,11) ^ rr(e,25), ch = (e & f) ^ (~e & g), t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rr(a,2) ^ rr(a,13) ^ rr(a,22), mj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + mj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += hh;
  }
  return [...H].map(x => x.toString(16).padStart(8, "0")).join("");
}

/* ------------------------------------------------------------------ state */
const S = { tab: "exp", key: (D && D.scenarios && D.scenarios[0] ? D.scenarios[0].meta.key : "b_wins"), rec: null, meta: null, replay: null, k: 1, playing: false, speed: 4, timer: null,
            ledgerAll: false, tamper: null, verify: null, tail: null, showDiff: false, plan: { b: 0.45, m: 0.07, s: 0.10, lpd: 600, days: 14 },
            lab: { name: store.get("lab_name", ""), call: null, summary: null, start: 0 } };

const KIND = {
  PROMOTE: { cls: "good", pill: "Promoted", icon: "check", verdict: "B wins and ships to 100% of traffic" },
  STOP_HARM: { cls: "bad", pill: "Stopped early", icon: "x", verdict: "B is clearly worse: stopped, traffic back to A" },
  STOP_GUARDRAIL: { cls: "bad", pill: "Stopped: guardrail", icon: "clock", verdict: "B wins on BuyLeads but breaks the guardrail: stopped" },
  HALT_SRM: { cls: "warn", pill: "Halted: broken test", icon: "link", verdict: "Test is broken (split mismatch): nothing ships" },
  INCONCLUSIVE: { cls: "neutral", pill: "Inconclusive", icon: "approx", verdict: "No evidence either way: nothing ships" },
  HOLD_FOR_APPROVAL: { cls: "warn", pill: "Held for approval", icon: "alert", verdict: "B wins, but a guardrail is not proven: a person decides" },
  CONTINUE: { cls: "run", pill: "Running", icon: "play", verdict: "Collecting evidence" }
};
const SCN_ICON = { fix_ships: ["good", "check"], fix_harms: ["bad", "x"], fix_flat: ["neutral", "approx"], b_wins: ["good", "check"], b_harmful: ["bad", "x"], inconclusive: ["neutral", "approx"], peeking_trap: ["warn", "alert"], guardrail_hold: ["warn", "alert"], srm_broken: ["warn", "link"], guardrail_veto: ["bad", "clock"] };

/* ------------------------------------------------------------------ chart core */
const tip = $("#tip");
function showTip(html, ev) {
  tip.innerHTML = html; tip.hidden = false;
  const r = tip.getBoundingClientRect(); let x = ev.clientX + 14, y = ev.clientY + 14;
  if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - 14;
  tip.style.left = x + "px"; tip.style.top = y + "px";
}
const hideTip = () => { tip.hidden = true; };

/** Draw a time-series chart. spec: {xd, yd, xt, yt, xf, yf, layers(fn(sx,sy,w,h)->svg string), h, ml, ...}. */
function drawChart(el, spec, rows) {
  const w = Math.max(280, el.clientWidth || 600), h = spec.h || 260;
  const ml = spec.ml ?? 46, mr = spec.mr ?? 16, mt = spec.mt ?? 10, mb = spec.mb ?? 28;
  const [x0, x1] = spec.xd, [y0, y1] = spec.yd;
  const sx = v => ml + (v - x0) / (x1 - x0) * (w - ml - mr);
  const sy = v => mt + (1 - (Math.min(Math.max(v, y0), y1) - y0) / (y1 - y0)) * (h - mt - mb);
  let g = "";
  for (const t of spec.yt) g += `<g class="grid"><line x1="${ml}" x2="${w - mr}" y1="${sy(t)}" y2="${sy(t)}"/></g><text x="${ml - 8}" y="${sy(t) + 4}" text-anchor="end">${spec.yf(t)}</text>`;
  for (const t of spec.xt) g += `<text x="${sx(t)}" y="${h - 8}" text-anchor="middle">${spec.xf(t)}</text><g class="axis"><line x1="${sx(t)}" x2="${sx(t)}" y1="${h - mb}" y2="${h - mb + 4}"/></g>`;
  g += `<g class="axis"><line x1="${ml}" x2="${w - mr}" y1="${h - mb}" y2="${h - mb}"/></g>`;
  g += spec.layers(sx, sy, w, h, { ml, mr, mt, mb });
  g += `<line class="cursor" x1="0" x2="0" y1="${mt}" y2="${h - mb}" stroke="var(--ink)" stroke-width="1" opacity="0" />`;
  g += `<rect class="hit" x="${ml}" y="${mt}" width="${w - ml - mr}" height="${h - mt - mb}" fill="transparent"/>`;
  el.innerHTML = `<svg class="chart" viewBox="0 0 ${w} ${h}" height="${h}" role="img" aria-label="${esc(spec.label || "chart")}">${g}</svg>`;
  el.__sx = sx; el.__rows = rows; el.__tip = spec.tip; el.__xs = rows.map(r => sx(r.n));
  const hit = $(".hit", el);
  hit.addEventListener("mousemove", ev => {
    const b = hit.getBoundingClientRect(), px = ev.clientX - b.left + ml;
    let bi = 0, bd = 1e9; el.__xs.forEach((x, i) => { const d = Math.abs(x - px); if (d < bd) { bd = d; bi = i; } });
    setCursor(bi); showTip(spec.tip(rows[bi], bi), ev);
  });
  hit.addEventListener("mouseleave", () => { setCursor(null); hideTip(); });
}
function setCursor(i) {
  $$(".cv").forEach(el => {
    const c = $(".cursor", el); if (!c || !el.__xs) return;
    if (i == null || !el.__xs[i]) { c.setAttribute("opacity", 0); return; }
    c.setAttribute("x1", el.__xs[i]); c.setAttribute("x2", el.__xs[i]); c.setAttribute("opacity", .35);
  });
}
const niceTicks = (lo, hi, n = 5) => { const st = (hi - lo) / n; const mag = 10 ** Math.floor(Math.log10(st)); const f = st / mag; const s = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag; const out = []; for (let v = Math.ceil(lo / s) * s; v <= hi + 1e-9; v += s) out.push(+v.toFixed(10)); return out; };
const path = (pts, sx, sy) => pts.map((p, i) => `${i ? "L" : "M"}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join("");
const band = (hi, lo, sx, sy) => { const a = hi.map(p => `${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`), b = lo.slice().reverse().map(p => `${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`); return `M${a.join("L")}L${b.join("L")}Z`; };
const dotSvg = (x, y, c) => `<circle cx="${x}" cy="${y}" r="6" fill="var(--surface)"/><circle cx="${x}" cy="${y}" r="4" fill="${c}"/>`;
const xfmtCalls = v => v >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + "k" : v;

/* ------------------------------------------------------------------ experiment tab */
function loadScenario(key, auto = true) {
  const sc = D.scenarios.find(s => s.meta.key === key) || D.scenarios[0];
  S.key = sc.meta.key; S.rec = sc.record; S.meta = sc.meta; S.replay = sc.replay;
  S.tamper = null; S.verify = null; S.showDiff = false; S.tail = null;
  stop(); S.k = auto ? 1 : S.rec.looks.length;
  renderExperiment();
  if (auto) play();
}
function stop() { S.playing = false; clearInterval(S.timer); S.timer = null; }
function play() {
  const L = S.rec.looks.length;
  if (S.k >= L) S.k = 1;
  S.playing = true; clearInterval(S.timer);
  S.timer = setInterval(() => { if (S.k >= L) { stop(); updatePlayer(); return; } S.k++; renderDynamic(); }, Math.max(18, 520 / S.speed));
  updatePlayer();
}
function updatePlayer() {
  const b = $("#pp"); if (!b || !S.rec) return;
  b.innerHTML = S.playing ? icon("pause") : icon("play");
  const sc = $("#scrub"); if (sc) sc.value = S.k;
  const lk = $("#lk"); if (lk) lk.textContent = `look ${S.k}/${S.rec.looks.length}`;
  $$("#spd button").forEach(x => x.setAttribute("aria-pressed", +x.dataset.v === S.speed));
}

function renderExperiment() {
  const app = $("#app"); const rec = S.rec, m = S.meta, c = rec.config, d = rec.design;
  const chips = D.scenarios.map(s => { const [cl, ic] = SCN_ICON[s.meta.key] || ["neutral", "approx"];
    return `<button data-key="${s.meta.key}" aria-pressed="${s.meta.key === S.key}"><span class="ic ${cl}">${icon(ic)}</span><span><div class="t">${esc(s.meta.title)}</div><div class="s">expect: ${(KIND[s.meta.expect] || { pill: s.meta.expect }).pill}</div></span></button>`; }).join("");
  const custom = `<button data-custom="1" aria-pressed="${S.key === "custom"}" ${LIVE ? "" : 'disabled title="Needs the live engine: python -m picky serve"'}><span class="ic neutral">${icon("plus")}</span><span><div class="t">Custom experiment</div><div class="s">${LIVE ? "your own numbers" : "live mode only"}</div></span></button>`;
  const hasTruth = m.true_a != null;
  const dk = m.dur_mult_b && m.dur_mult_b !== 1 ? ` · B calls ${((m.dur_mult_b - 1) * 100).toFixed(0)}% longer` : "";
  const dr = m.log_drop_b ? ` · B loses ${(m.log_drop_b * 100).toFixed(0)}% of its non-converting calls from the log` : "";
  app.innerHTML = `
  <div class="scn" id="scn">${chips}${custom}</div>
  <div class="story"><span><b>${esc(m.title)}.</b> ${esc(m.story)}</span>
    ${hasTruth ? `<span class="chip" title="We inject a known difference so we can check the engine finds it. Outcomes are simulated; call durations are resampled from the 713 real recordings.">Known truth (simulated): A ${pct(m.true_a)} · B ${pct(m.true_b)}${dk}${dr}</span>` : `<span class="chip good" title="These are results supplied in files. There is no hidden truth to compare with: the decision is the point.">From results files &middot; ${esc((rec.source && rec.source.files || []).join(", "))}</span>`}</div>
  <div class="grid">
    <div class="stack">
      <section class="card" id="hero"><div id="hero-d"></div>
        <div class="player">
          <button class="btn" id="bk" title="Back one look">${icon("back")}</button>
          <button class="btn primary" id="pp" title="Play / pause (space)"></button>
          <button class="btn" id="fw" title="Skip to the end">${icon("fwd")}</button>
          <button class="btn2" id="nd" title="Show the results up to the end of the next day (the spec's 'Advance 1 day')">+1 day</button>
          <input type="range" id="scrub" min="1" max="${rec.looks.length}" value="${S.k}" aria-label="Look">
          <span class="muted mono" id="lk"></span>
          <span class="seg" id="spd">${[1, 4, 16].map(v => `<button data-v="${v}" aria-pressed="${S.speed === v}">${v}&times;</button>`).join("")}</span>
        </div></section>
      <section class="card"><div class="card-head"><div><h3>Evidence so far</h3><div class="sub">z-statistic of B vs A. Cross the green line to promote, the red line to stop. The lines already pay for peeking, so check as often as you like.</div></div></div>
        <div class="legend" id="lg-z"></div><div class="cv" id="c-z"></div><div id="typical"></div></section>
      <div class="two">
        <section class="card"><h3>Lift of B over A</h3><div class="sub">${esc(goalLabel(c.primary_goal))} rate, with the always-valid interval</div><div class="legend" id="lg-l"></div><div class="cv" id="c-l"></div></section>
        <section class="card" id="guard-card"><h3>Guardrail: ${esc(c.secondary_metric)}</h3><div class="sub">Relative change of the mean, B vs A. B may not worsen by more than ${(c.guardrail_margin * 100).toFixed(0)}%.</div><div class="legend" id="lg-g"></div><div class="cv" id="c-g"></div></section>
      </div>
      <section class="card"><h3>Split accuracy and test health</h3><div class="sub">Share of analysed calls that went to B, against the configured ${pct(c.share_b, 0)}. Leaving the shaded band means the test itself is broken (sample-ratio mismatch).</div><div class="legend" id="lg-s"></div><div class="cv" id="c-s"></div><div id="splitnote"></div></section>
    </div>
    <div class="stack">
      <section class="card" id="setup"></section>
      <section class="card" id="ledger">
        <div class="card-head"><div><h3>Decision ledger</h3><div class="sub">Append-only and hash-chained. Every look, decision and routing change, with time and evidence.</div></div></div>
        <div class="toolbar"><button class="btn2" id="lv">${icon("check", 13)} Verify chain</button><button class="btn2" id="lt">Tamper with one entry</button><button class="btn2" id="la"></button></div>
        <div class="verify" id="vf"></div><div class="ledger" id="lg" role="list"></div></section>
    </div>
  </div>`;
  $$("#scn button[data-key]").forEach(b => b.onclick = () => loadScenario(b.dataset.key));
  const cb = $("#scn button[data-custom]"); if (cb && LIVE) cb.onclick = openCustom;
  renderSetup(); wireStatic(); renderDynamic(true);
}

function wireStatic() {
  const L = S.rec.looks.length;
  $("#bk").onclick = () => { stop(); S.k = Math.max(1, S.k - 1); renderDynamic(); };
  $("#fw").onclick = () => { stop(); S.k = L; renderDynamic(); };
  $("#nd").onclick = () => {
    stop(); const c0 = S.rec.config, day = r => Math.floor((new Date(r.time) - new Date(c0.start)) / 86400000), target = day(S.rec.looks[S.k - 1]) + 1;
    let k = S.k; S.rec.looks.forEach((r, i) => { if (day(r) <= target) k = Math.max(k, i + 1); }); S.k = Math.min(L, Math.max(k, S.k + 1)); renderDynamic();
  };
  $("#pp").onclick = () => { S.playing ? stop() : play(); updatePlayer(); };
  $("#scrub").oninput = e => { stop(); S.k = +e.target.value; renderDynamic(); };
  $$("#spd button").forEach(b => b.onclick = () => { S.speed = +b.dataset.v; if (S.playing) play(); updatePlayer(); });
  $("#lv").onclick = () => { S.verify = true; renderLedger(); };
  $("#lt").onclick = () => { const vis = visibleLedger(), cand = vis.filter(x => x.body.type === "look"); const pick = cand.length ? cand[Math.floor(cand.length / 2)] : vis[0]; S.tamper = pick.i; S.verify = true; S.ledgerAll = true; renderLedger(); };
  $("#la").onclick = () => { S.ledgerAll = !S.ledgerAll; renderLedger(); };
}

function renderDynamic(first) {
  renderHero(); renderCharts(); renderLedger(); updatePlayer();
}

const seen = () => S.rec.looks.slice(0, S.k);
function truthBetter() { const m = S.meta; if (m.true_a == null) return false; return m.true_b > m.true_a && (m.dur_mult_b || 1) <= 1.15 && !m.log_drop_b; }

function naiveWrongText(wins) {
  const a = D.proof && D.proof.scenarios.aa.methods.naive_peek.outcomes, k = wins ? "PROMOTE" : "STOP_HARM", r = a && a[k] ? a[k].rate : 0;
  return r ? `about 1 time in ${Math.round(1 / r)}` : "often";
}


/* ------------------------------------------------------------------ decisions that need a person, rollback, "how many more leads" (shared by both views) */
const tailSays = t => ({ approve: "A person approved it: B now serves all traffic.", reject: "A person rejected it: all traffic is back on A.", rollback: "Rolled back: all traffic is back on the previous prompt." }[t] || "");
function actionBar(rec, tail) {
  const res = rec.result, t = rec.tails || {};
  const btn = (act, label, cls = "") => `<button class="btn2 ${cls}" data-act="${act}">${label}</button>`;
  if (res.kind === "HOLD_FOR_APPROVAL" && t.approve) {
    return tail ? `<div class="act done">Logged in the record. ${btn("undo", "Undo the demo click")}</div>`
      : `<div class="act"><span><b>A person decides.</b> The click is logged in the tamper-evident record. Meanwhile callers are unaffected.</span><span class="actbtns">${btn("approve", "Approve: ship B", "okb")}${btn("reject", "Reject: keep A")}</span></div>`;
  }
  if (res.kind === "PROMOTE" && t.rollback && !(rec.source && rec.source.type === "files")) {      // for results files Picky does not route traffic, so there is nothing to roll back here
    return tail ? `<div class="act done">Logged in the record. ${btn("undo", "Undo the demo click")}</div>`
      : `<div class="act"><span>Changed your mind? Rolling back is one click and is logged.</span><span class="actbtns">${btn("rollback", "Roll back")}</span></div>`;
  }
  return "";
}
function moreLeadsHtml(res) {
  const m = res.more_leads; if (!m || !m.options || !m.options.length) return "";
  const li = m.options.map(o => o.enough_already
    ? `<li>Already enough data to detect <b>${o.lift_pp} points</b> (${esc(o.label)}). Nothing showed, so any real lift is smaller than that.</li>`
    : `<li><b>${nf(o.more_leads)} more leads</b> (about ${o.more_days} days) to detect <b>${o.lift_pp} points</b> (${esc(o.label)}).${o.impractical ? " That is over a year of traffic: not practical." : ""}</li>`).join("");
  return `<div class="more"><b>What would settle it</b><ul>${li}</ul></div>`;
}
function dataNotesHtml(rec) {
  const src = rec.source; if (!src || !src.warnings || !src.warnings.length) return "";
  return `<details class="notes"><summary>${src.warnings.length} data note${src.warnings.length > 1 ? "s" : ""} (what Picky found in the files)</summary><ul>${src.warnings.map(w => `<li>${esc(w)}</li>`).join("")}</ul></details>`;
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const act = b.dataset.act, simple = S.tab === "try" || S.tab === "files";
  const st = simple ? V : S; st.tail = act === "undo" ? null : act;
  if (simple) { const r = $("#result"); if (r) r.innerHTML = resultCard(); } else { renderHero(); renderLedger(); }
});

function renderHero() {
  const rec = S.rec, L = rec.looks.length, row = rec.looks[S.k - 1], final = S.k >= L, res = rec.result, c = rec.config;
  const kind = final ? res.kind : "CONTINUE", K = KIND[kind] || KIND.CONTINUE;
  const lift = row.diff, ci = row.rci, wide = Math.abs(ci[1] - ci[0]) > 0.6;
  const prod = final && kind === "PROMOTE" && !(rec.source && rec.source.type === "files") ? `Production prompt <span class="mono">${res.production_before.slice(0, 7)}</span> &rarr; <span class="mono">${res.production_after.slice(0, 7)}</span> (auto-approved). ` : "";
  const done = final && S.tail ? ` <b>${esc(tailSays(S.tail))}</b>` : "";
  const reason = final ? prod + esc(res.reason) + done + moreLeadsHtml(res) + actionBar(rec, S.tail) : `Look ${S.k} of up to ${L}: z = ${row.z.toFixed(2)}, needs &ge; ${row.eff > 50 ? "&gt;50" : row.eff.toFixed(2)} to promote or &le; &minus;${row.harm.toFixed(2)} to stop. No decision yet.`;
  const exposed = row.exposedB, total = row.n;
  const day = Math.floor((new Date(row.time) - new Date(c.start)) / 86400000) + 1;
  const sh = S.rec.result.split;
  $("#hero-d").innerHTML = `
    <div class="hero"><div>
      <span class="pill ${K.cls}">${kind === "CONTINUE" ? '<span class="pulse"></span>' : icon(K.icon, 14)}${K.pill}</span>
      <div class="verdict">${esc(K.verdict)}</div><p class="reason">${reason}</p>${final ? dataNotesHtml(rec) : ""}</div>
      <div class="figure"><div class="num">${wide ? "&plusmn;?" : pp(lift, 0)}</div>
        <div class="lbl">B vs A on ${esc(c.primary_goal.replace(/_/g, " "))}<br>${wide ? "interval still very wide" : `always-valid 95% interval ${pp(ci[0], 0)} to ${pp(ci[1], 0)}`}</div></div></div>
    <div class="tiles">
      <div class="tile"><div class="k">Calls analysed</div><div class="v">${nf(row.n)}</div><div class="d">of ${nf(rec.design.n_max)} planned</div><div class="bar"><i style="width:${Math.min(100, row.n / rec.design.n_max * 100)}%"></i></div></div>
      <div class="tile"><div class="k"><span class="dot" style="display:inline-block;background:var(--a)"></span> A (production)</div><div class="v">${pct(row.rateA, 0)}</div><div class="d">${nf(row.xA)} of ${nf(row.nA)} calls</div></div>
      <div class="tile"><div class="k"><span class="dot" style="display:inline-block;background:var(--b)"></span> B (candidate)</div><div class="v">${pct(row.rateB, 0)}</div><div class="d">${nf(row.xB)} of ${nf(row.nB)} calls</div></div>
      <div class="tile"><div class="k">Calls served to B</div><div class="v">${nf(exposed)}</div><div class="d">${pct(row.assignedB, 1)} of traffic</div></div>
      <div class="tile"><div class="k">Elapsed</div><div class="v">Day ${day}</div><div class="d">${esc(row.time.replace("T", " ").slice(0, 16))}</div></div>
    </div>`;
}

function renderSetup() {
  const rec = S.rec, c = rec.config, d = rec.design, v = rec.variants;
  const isHdr = l => l.startsWith("+++ B (candidate)") || l.startsWith("--- A (production)") || l.startsWith("@@");
  const diff = v.B.diff.map(l => isHdr(l) ? `<span class="hdr">${esc(l)}</span>` : l.startsWith("+") ? `<span class="add">${esc(l)}</span>` : l.startsWith("-") ? `<span class="del">${esc(l)}</span>` : esc(l)).join("\n");
  $("#setup").innerHTML = `
    <div class="card-head"><div><h3>Experiment setup</h3><div class="sub">Locked before launch: version ${c.version || 1}, config <span class="mono">${rec.config_hash}</span>${c.parent_hash ? `, changed from <span class="mono">${esc(c.parent_hash)}</span>` : ""}. Any change is a new version.</div></div>${S.replay && S.replay.same_ledger_head ? `<span class="chip good" title="Re-running from the stored config and seed gave the identical decision and identical ledger.">${icon("check", 13)} Reproducible</span>` : ""}</div>
    <div class="var"><div class="row"><span class="dot" style="background:var(--a)"></span><b>A: control</b><span class="chip">${(1 - c.share_b) * 100}% of traffic</span><span class="muted mono" style="margin-left:auto">${v.A.hash.slice(0, 7)}</span></div><div class="muted" style="margin-top:2px">${esc(v.A.name)}</div></div>
    <div class="var"><div class="row"><span class="dot" style="background:var(--b)"></span><b>B: ${esc(v.B.name)}</b><span class="chip ${v.B.origin === "human" ? "" : "accent"}">${esc(v.B.origin)}</span><span class="muted mono" style="margin-left:auto">${v.B.hash.slice(0, 7)}</span></div>
      <div style="margin-top:4px"><button class="linkbtn" id="dtoggle">${S.showDiff ? "Hide" : "Show"} prompt diff (${v.B.diff.filter(l => !isHdr(l) && /^[+-]/.test(l)).length} lines changed)</button></div>${S.showDiff ? `<div class="diff">${diff}</div>` : ""}</div>
    <div class="rules">
      <div><span class="k">Primary goal</span><span><b>${esc(c.primary_goal.replace(/_/g, " "))}</b> rate, ${c.primary_direction} is better. Plan: detect ${pp(c.mde, 0)} from ${pct(c.baseline, 0)}.</span></div>
      <div><span class="k">Guardrail</span><span>${esc(c.secondary_metric)} may not get worse by more than <b>${(c.guardrail_margin * 100).toFixed(0)}%</b>. Primary decides; the guardrail can only veto.</span></div>
      <div><span class="k">Traffic</span><span><b>${pct(c.share_b, 0)}</b> to B for up to ${c.window_days} days, sticky per lead (${c.assignment} assignment).</span></div>
      <div><span class="k">Sample plan</span><span>${nf(d.n_max)} calls for ${pct(0.8, 0)} power (${nf(d.n_fixed)} for a single-look test), ${d.look_n.length} looks.</span></div>
      ${c.rule_set === "final_look"
        ? `<div><span class="k">Promote when</span><span><b>One winner call at the end of the window</b>: z &ge; ${(d.eff[d.eff.length - 1] || 0).toFixed(2)} (95% two-sided) <i>and</i> the guardrail is proven. Never earlier.</span></div>
      <div><span class="k">Stop when</span><span>At any daily check, z &le; &minus;${(d.harm[0] || 0).toFixed(2)} (a ${((1 - c.alpha_harm_daily) * 100).toFixed(1)}% bar) or the guardrail is breached.</span></div>`
        : `<div><span class="k">Promote when</span><span>z crosses the O'Brien-Fleming-type boundary (${pct(c.alpha)} one-sided error budget) <i>and</i> the guardrail is proven.</span></div>
      <div><span class="k">Stop when</span><span>z crosses the harm boundary (Pocock-type, ${pct(c.alpha_harm)}) or the guardrail is breached.</span></div>`}
      ${c.guard_rate ? `<div><span class="k">Second guardrail</span><span><b>${esc(c.guard_rate.replace(/_/g, " "))}</b> may not get worse by more than ${(c.guard_rate_margin * 100).toFixed(0)} points.</span></div>` : ""}
      <div><span class="k">Hold for a person</span><span>If B wins but a guardrail is not proven, nothing ships and nothing is thrown away: a person approves or rejects, and the click is logged.</span></div>
      <div><span class="k">Test broken when</span><span>logged split differs from ${pct(c.share_b, 0)} at p &lt; ${c.srm_alpha}.</span></div>
      <div><span class="k">Otherwise</span><span>Inconclusive at the window end. Nothing ships, and the result says how many more leads would settle it.</span></div>
    </div>`;
  const t = $("#dtoggle"); if (t) t.onclick = () => { S.showDiff = !S.showDiff; renderSetup(); };
}

function renderCharts() {
  const rows = seen(), rec = S.rec, d = rec.design, c = rec.config, nmax = d.n_max, L = rec.looks.length;
  const xd = [0, nmax], xt = niceTicks(0, nmax, 5), last = rows[rows.length - 1];
  const A = "var(--a)", B = "var(--b)";
  const final = S.k >= L, kind = rec.result.kind;
  // --- evidence
  const eff = rec.looks.map(r => [r.n, r.eff]), harm = rec.looks.map(r => [r.n, -r.harm]);
  const YC = 6;
  const naiveHit = rows.find(r => r.naive_cross && r.z > 0), naiveHurt = rows.find(r => r.naive_cross && r.z < 0);
  const zspec = {
    xd, yd: [-YC, YC], xt, yt: [-6, -4, -2, 0, 2, 4, 6], xf: xfmtCalls, yf: v => v, h: 300, label: "z-statistic against promote and stop boundaries",
    layers: (sx, sy, w) => {
      const eE = eff.map(p => [p[0], Math.min(p[1], YC)]), hE = harm.map(p => [p[0], Math.max(p[1], -YC)]);
      let s = `<path d="${band(eE, eE.map(p => [p[0], YC]), sx, sy)}" fill="var(--good-wash)"/><path d="${band(hE, hE.map(p => [p[0], -YC]), sx, sy)}" fill="var(--bad-wash)"/>`;
      s += `<path d="${path(eE, sx, sy)}" fill="none" stroke="var(--good)" stroke-width="1.6"/><path d="${path(hE, sx, sy)}" fill="none" stroke="var(--bad)" stroke-width="1.6"/>`;
      s += [1.96, -1.96].map(v => `<line x1="${sx(0)}" x2="${sx(nmax)}" y1="${sy(v)}" y2="${sy(v)}" stroke="var(--ink-3)" stroke-width="1" opacity=".55"/>`).join("");
      s += `<text x="${sx(nmax) - 4}" y="${sy(1.96) + 13}" text-anchor="end">naive "p&lt;0.05" line (&plusmn;1.96)</text>`;
      s += `<text x="${sx(nmax) - 4}" y="${sy(YC) + 14}" text-anchor="end" class="lbl" style="fill:var(--good-ink)">PROMOTE zone</text><text x="${sx(nmax) - 4}" y="${sy(-YC) - 6}" text-anchor="end" class="lbl" style="fill:var(--bad-ink)">STOP zone</text>`;
      s += `<line x1="${sx(0)}" x2="${sx(nmax)}" y1="${sy(0)}" y2="${sy(0)}" stroke="var(--axis)"/>`;
      s += `<path d="${path(rows.map(r => [r.n, r.z]), sx, sy)}" fill="none" stroke="${B}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
      const fl = naiveHit || naiveHurt;
      if (fl) { const x = sx(fl.n), y = sy(fl.z); s += `<path d="M${x},${y - 11}l7,12h-14z" fill="var(--warn)" stroke="var(--surface)" stroke-width="2"/>`; }
      s += dotSvg(sx(last.n).toFixed(1), sy(last.z).toFixed(1), B);
      return s;
    },
    tip: (r, i) => `<b>Look ${i + 1} &middot; ${nf(r.n)} calls</b><div class="r"><span>z</span><span>${r.z.toFixed(2)}</span></div><div class="r"><span>promote at</span><span>&ge; ${r.eff > 50 ? "&gt;50" : r.eff.toFixed(2)}</span></div><div class="r"><span>stop at</span><span>&le; &minus;${r.harm.toFixed(2)}</span></div><div class="r"><span>naive rule fires</span><span>${r.naive_cross ? "yes" : "no"}</span></div>`
  };
  drawChart($("#c-z"), zspec, rows);
  $("#lg-z").innerHTML = `<span><i style="border-color:var(--b)"></i>z of B vs A</span><span><i style="border-color:var(--good)"></i>promote boundary</span><span><i style="border-color:var(--bad)"></i>stop boundary</span><span><i style="border-color:var(--ink-3)"></i>naive &plusmn;1.96</span><span><svg width="14" height="12"><path d="M7 1l6 10H1z" fill="var(--warn)"/></svg>naive rule would fire here</span>`;
  // typical-tool strip
  const tp = $("#typical"); const fl = naiveHit || naiveHurt;
  if (fl && S.meta.true_a != null) {
    const wins = fl.z > 0, wrong = wins ? !truthBetter() : S.meta.true_b >= S.meta.true_a;
    tp.innerHTML = `<div class="note ${wrong ? "" : "info"}" style="margin-top:10px"><b>${wrong ? "A typical tool would have gotten this wrong." : "A typical tool would have agreed here."}</b> A plain "p &lt; 0.05 at every check" rule fires at look ${fl.k + 1} (${nf(fl.n)} calls) and ${wins ? "crowns B the winner" : "kills B"}. ${wrong ? `The known truth is that ${wins ? "B is not better" : "B is not worse"}.` : `It happens to be right in this run, but it is wrong ${naiveWrongText(wins)} when nothing changed (see Proof Lab).`}</div>`;
  } else tp.innerHTML = "";

  // --- lift
  const mid = rec.looks.map(r => [r.n, r.diff * 100]);
  const ok = rows.filter(r => Math.abs(r.rci[0]) < 0.4 && Math.abs(r.rci[1]) < 0.4);
  const hasT = S.meta.true_a != null, truth = hasT ? (S.meta.true_b - S.meta.true_a) * 100 : 0;
  const ymax = Math.max(12, Math.ceil(Math.max((hasT ? Math.abs(truth) : 0) + 4, ...ok.map(r => Math.max(Math.abs(r.rci[0]), Math.abs(r.rci[1])) * 100)) / 4) * 4);
  drawChart($("#c-l"), {
    xd, yd: [-ymax, ymax], xt, yt: niceTicks(-ymax, ymax, 4), xf: xfmtCalls, yf: v => (v > 0 ? "+" : "") + v, h: 250, label: "lift with always-valid interval",
    layers: (sx, sy) => {
      const vis = rows.filter(r => r.rci[0] > -400); const hi = vis.map(r => [r.n, r.rci[1] * 100]), lo = vis.map(r => [r.n, r.rci[0] * 100]);
      let s = `<line x1="${sx(0)}" x2="${sx(nmax)}" y1="${sy(0)}" y2="${sy(0)}" stroke="var(--axis)"/>`;
      if (hasT) s += `<line x1="${sx(0)}" x2="${sx(nmax)}" y1="${sy(truth)}" y2="${sy(truth)}" stroke="var(--ink)" stroke-width="1" opacity=".5"/><text x="${sx(nmax) - 4}" y="${sy(truth) - 5}" text-anchor="end">known truth ${truth >= 0 ? "+" : ""}${truth.toFixed(0)} pp</text>`;
      if (vis.length > 1) s += `<path d="${band(hi, lo, sx, sy)}" fill="var(--b)" opacity=".13"/>`;
      s += `<path d="${path(rows.map(r => [r.n, Math.max(-ymax, Math.min(ymax, r.diff * 100))]), sx, sy)}" fill="none" stroke="var(--b)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
      s += dotSvg(sx(last.n).toFixed(1), sy(last.diff * 100).toFixed(1), "var(--b)");
      return s;
    },
    tip: r => `<b>${nf(r.n)} calls</b><div class="r"><span>lift</span><span>${pp(r.diff)}</span></div><div class="r"><span>always-valid 95%</span><span>${Math.abs(r.rci[0]) > 0.5 ? "very wide" : pp(r.rci[0]) + " to " + pp(r.rci[1])}</span></div><div class="r"><span>A / B rate</span><span>${pct(r.rateA)} / ${pct(r.rateB)}</span></div>`
  }, rows);
  $("#lg-l").innerHTML = `<span><i style="border-color:var(--b)"></i>lift of B (pp)</span><span><i class="sw" style="background:var(--b);opacity:.25"></i>always-valid 95% interval</span>${hasT ? `<span><i style="border-color:var(--ink);opacity:.5"></i>known truth</span>` : ""}`;

  // --- guardrail
  const gcard = $("#guard-card");
  if (c.secondary_role !== "guardrail") { gcard.hidden = true; }
  else {
    gcard.hidden = false; const gr = rows.filter(r => r.guardrail);
    const lim = c.guardrail_margin * 100; const gm = Math.max(lim * 2.2, 30);
    const sgn = c.secondary_worse_when === "higher" ? 1 : -1;
    drawChart($("#c-g"), {
      xd, yd: [-gm * 0.5, gm], xt, yt: niceTicks(-gm * 0.5, gm, 4), xf: xfmtCalls, yf: v => (v > 0 ? "+" : "") + v + "%", h: 250, label: "guardrail: relative change in duration",
      layers: (sx, sy) => {
        let s = `<rect x="${sx(0)}" y="${sy(gm)}" width="${sx(nmax) - sx(0)}" height="${sy(lim) - sy(gm)}" fill="var(--bad-wash)"/>`;
        s += `<line x1="${sx(0)}" x2="${sx(nmax)}" y1="${sy(lim)}" y2="${sy(lim)}" stroke="var(--bad)" stroke-width="1.5"/><text x="${sx(nmax) - 4}" y="${sy(lim) - 5}" text-anchor="end" style="fill:var(--bad-ink)">limit +${lim.toFixed(0)}%</text>`;
        s += `<line x1="${sx(0)}" x2="${sx(nmax)}" y1="${sy(0)}" y2="${sy(0)}" stroke="var(--axis)"/>`;
        const vis = gr.filter(r => Math.abs(r.guardrail.worse) < 1 && r.guardrail.upper < 3);
        if (vis.length > 1) s += `<path d="${band(vis.map(r => [r.n, r.guardrail.upper * 100 * sgn]), vis.map(r => [r.n, r.guardrail.lower * 100 * sgn]), sx, sy)}" fill="var(--b)" opacity=".13"/>`;
        s += `<path d="${path(gr.map(r => [r.n, r.guardrail.rel_change * 100]), sx, sy)}" fill="none" stroke="var(--b)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
        if (gr.length) { const l = gr[gr.length - 1]; s += dotSvg(sx(l.n).toFixed(1), sy(l.guardrail.rel_change * 100).toFixed(1), "var(--b)"); }
        return s;
      },
      tip: r => r.guardrail ? `<b>${nf(r.n)} calls</b><div class="r"><span>mean duration A</span><span>${r.guardrail.mean_a.toFixed(0)} s</span></div><div class="r"><span>mean duration B</span><span>${r.guardrail.mean_b.toFixed(0)} s</span></div><div class="r"><span>change</span><span>${(r.guardrail.rel_change * 100).toFixed(1)}%</span></div>` : "-"
    }, rows);
    $("#lg-g").innerHTML = `<span><i style="border-color:var(--b)"></i>B vs A, mean duration</span><span><i class="sw" style="background:var(--b);opacity:.25"></i>always-valid interval</span><span><i style="border-color:var(--bad)"></i>tolerated limit</span>`;
  }

  // --- split
  const sh = c.share_b, n_ = r => r.n;
  const band95 = r => 1.96 * Math.sqrt(sh * (1 - sh) / r.n), bandS = r => 3.29 * Math.sqrt(sh * (1 - sh) / r.n);
  const all = rec.looks, sm = Math.max(0.06, sh * 0.8);
  drawChart($("#c-s"), {
    xd, yd: [Math.max(0, sh - sm), sh + sm], xt, yt: niceTicks(Math.max(0, sh - sm), sh + sm, 4), xf: xfmtCalls, yf: v => (v * 100).toFixed(0) + "%", h: 220, label: "share of analysed calls that went to B",
    layers: (sx, sy) => {
      const a = all.filter(r => r.n >= 100);
      let s = `<path d="${band(a.map(r => [r.n, sh + bandS(r)]), a.map(r => [r.n, sh - bandS(r)]), sx, sy)}" fill="var(--ink-3)" opacity=".10"/>`;
      s += `<path d="${band(a.map(r => [r.n, sh + band95(r)]), a.map(r => [r.n, sh - band95(r)]), sx, sy)}" fill="var(--ink-3)" opacity=".14"/>`;
      s += `<line x1="${sx(0)}" x2="${sx(nmax)}" y1="${sy(sh)}" y2="${sy(sh)}" stroke="var(--ink-3)"/><text x="${sx(nmax) - 4}" y="${sy(sh) - 5}" text-anchor="end">configured ${pct(sh, 0)}</text>`;
      s += `<path d="${path(rows.map(r => [r.n, r.loggedB]), sx, sy)}" fill="none" stroke="var(--b)" stroke-width="2.2" stroke-linejoin="round"/>`;
      s += dotSvg(sx(last.n).toFixed(1), sy(last.loggedB).toFixed(1), "var(--b)");
      return s;
    },
    tip: r => `<b>${nf(r.n)} calls</b><div class="r"><span>assigned to B</span><span>${pct(r.assignedB, 2)}</span></div><div class="r"><span>logged B share</span><span>${pct(r.loggedB, 2)}</span></div><div class="r"><span>sample-ratio p</span><span>${r.p_srm < 0.001 ? r.p_srm.toExponential(1) : r.p_srm.toFixed(3)}</span></div>`
  }, rows);
  $("#lg-s").innerHTML = `<span><i style="border-color:var(--b)"></i>logged B share</span><span><i style="border-color:var(--ink-3)"></i>configured</span><span><i class="sw" style="background:var(--ink-3);opacity:.3"></i>95% chance band</span><span><i class="sw" style="background:var(--ink-3);opacity:.15"></i>alarm band (p &lt; 0.001)</span>`;
  const sp = rec.result.split, st = rec.result.stickiness, lr = rows[rows.length - 1];
  const srmBad = lr.p_srm < c.srm_alpha && lr.n >= c.srm_min_n;
  $("#splitnote").innerHTML = `<div class="tiles" style="grid-template-columns:repeat(3,1fr);margin-top:10px">
    <div class="tile"><div class="k">Assigned B share</div><div class="v">${pct(lr.assignedB, 2)}</div><div class="d">configured ${pct(c.share_b, 1)} &middot; ${esc(sp.mode)} assignment</div></div>
    <div class="tile"><div class="k">Stickiness</div><div class="v">${st.arm_changes === 0 ? icon("check", 18) + " 0 flips" : st.arm_changes + " flips"}</div><div class="d">${nf(st.leads_checked)} leads re-checked</div></div>
    <div class="tile"><div class="k">Sample-ratio check</div><div class="v" style="color:${srmBad ? "var(--bad-ink)" : "var(--good-ink)"}">${srmBad ? "MISMATCH" : "Healthy"}</div><div class="d">p = ${lr.p_srm < 0.001 ? lr.p_srm.toExponential(1) : lr.p_srm.toFixed(3)}</div></div></div>`;
  $$(".cv").forEach(el => { if (el.__tip) { /* keep cursor sync */ } });
}

/* ------------------------------------------------------------------ ledger */
function ledgerEntries() { const tail = S.tail && S.rec.tails && S.rec.tails[S.tail] ? S.rec.tails[S.tail] : []; return S.rec.ledger.concat(tail).map((e, i) => ({ i, e, body: JSON.parse(e.body) })); }
function visibleLedger() {
  const L = S.rec.looks.length, all = ledgerEntries(), out = [];
  for (const x of all) {
    const t = x.body.type;
    if (t === "look") { if (x.body.payload.k < S.k) out.push(x); }
    else if (["experiment_created"].includes(t) || (t === "routing_changed" && x.body.seq <= 1)) out.push(x);
    else if (S.k >= L) out.push(x);
  }
  return out;
}
function entryText(b) {
  const p = b.payload;
  switch (b.type) {
    case "experiment_created": return `Registered <span class="mono">${p.exp_id}</span> &middot; config <span class="mono">${p.config_hash}</span> &middot; A <span class="mono">${p.variant_A.slice(0, 7)}</span> vs B <span class="mono">${p.variant_B.slice(0, 7)}</span> (${esc(p.variant_B_origin)}) &middot; ${p.design.looks} looks, n&le;${nf(p.design.n_max)}`;
    case "routing_changed": return `Routing &rarr; A ${(p.A * 100).toFixed(0)}% / B ${(p.B * 100).toFixed(0)}%: ${esc(p.reason)}`;
    case "look": return `Look ${p.k + 1}: n=${nf(p.n)}, z=${p.z.toFixed(2)} (promote &ge;${p.bound_eff > 50 ? "&gt;50" : p.bound_eff.toFixed(2)}, stop &le;&minus;${p.bound_harm.toFixed(2)})`;
    case "decision": return `<b>${esc((KIND[p.kind] || { pill: p.kind }).pill || p.kind)}</b>: ${esc(p.reason)}`;
    case "approval": return `<b>${esc(p.action)}</b> by ${esc(p.by)}${p.simulated ? " (a demo click, not a real person)" : ""}`;
    case "approval_requested": return `A person is asked to approve <span class="mono">${esc(String(p.candidate).slice(0, 7))}</span>: ${esc((p.cause || "").replace(/_/g, " "))}. Callers are unaffected meanwhile.`;
    case "rollback": return `<b>Rolled back</b> <span class="mono">${esc(String(p.from).slice(0, 7))}</span> &rarr; <span class="mono">${esc(String(p.to).slice(0, 7))}</span> by ${esc(p.by)}${p.simulated ? " (a demo click)" : ""}`;
    case "promotion": return `Production prompt <span class="mono">${p.production_before.slice(0, 7)}</span> &rarr; <span class="mono">${p.production_after.slice(0, 7)}</span> &middot; approval: ${esc(p.approval)}`;
    default: return esc(JSON.stringify(p));
  }
}
function chain(entries, tamperIdx) {
  let prev = "0".repeat(64);
  for (const x of entries) {
    let body = x.e.body;
    if (tamperIdx === x.i) body = body.replace(/("z":)(-?[0-9.]+)/, (m, a, b) => a + (parseFloat(b) + 1.7)).replace(/("reason":")/, "$1[edited] ");
    if (x.e.prev !== prev || sha256(prev + body) !== x.e.hash) return { ok: false, bad: x.i };
    prev = x.e.hash;
  }
  return { ok: true, n: entries.length, head: prev };
}
function renderLedger() {
  const vis = visibleLedger(), rows = (S.ledgerAll ? vis : vis.filter(x => x.body.type !== "look"));
  const v = S.verify ? chain(vis, S.tamper) : null;
  $("#la").textContent = S.ledgerAll ? "Key events only" : `Show all ${vis.length} entries`;
  $("#vf").style.color = v ? (v.ok ? "var(--good-ink)" : "var(--bad-ink)") : "";
  $("#vf").innerHTML = v ? (v.ok ? `${icon("check", 14)} Chain intact: ${v.n} entries, head ${v.head.slice(0, 12)}` : `${icon("x", 14)} Chain BROKEN at entry #${v.bad}: the edit is detected`) : "";
  $("#lg").innerHTML = rows.map(x => { const b = x.body, k = b.type === "decision" ? (b.payload.kind) : null, cls = k && (KIND[k] || {}).cls;
      return `<div class="entry ${v && !v.ok && x.i === v.bad ? "bad" : ""}" role="listitem"><span class="seq">#${b.seq}</span><div><div class="hd"><span class="chip ${cls === "run" ? "" : cls || ""}">${esc(b.type.replace(/_/g, " "))}</span><span class="muted">${esc(b.ts.replace("T", " "))}</span><span class="hash" title="${x.e.hash}">${x.e.hash.slice(0, 10)}</span></div><div style="margin-top:3px">${entryText(b)}</div></div></div>`; }).join("");
  if (S.k >= S.rec.looks.length) $("#lg").scrollTop = $("#lg").scrollHeight;
}

/* ------------------------------------------------------------------ custom experiment (live mode) */
function openCustom() {
  stop();
  const c = S.rec.config, m = S.meta;
  const v = { true_a: m.true_a, true_b: m.true_b, share_b: c.share_b, dur_mult_b: m.dur_mult_b || 1, log_drop_b: m.log_drop_b || 0, seed: 7, guardrail_margin: c.guardrail_margin, variant_b: c.variant_b };
  const cands = { reconcile_limits: "Make the ask limits agree with each other", cap_two_asks: "Ask for any single detail at most twice" };
  $("#app").innerHTML = `<div class="card" style="max-width:720px;margin:0 auto"><h3>Custom experiment</h3><div class="sub">Set the hidden truth and the rules. The real engine runs it end to end.</div>
  <div class="form" style="margin-top:14px;grid-template-columns:1fr 1fr">
    <div class="field"><label>True rate of A <span class="hint">hidden truth</span></label><input type="number" step="0.01" id="f_true_a" value="${v.true_a}"></div>
    <div class="field"><label>True rate of B <span class="hint">hidden truth</span></label><input type="number" step="0.01" id="f_true_b" value="${v.true_b}"></div>
    <div class="field"><label>Traffic share to B</label><input type="number" step="0.05" id="f_share_b" value="${v.share_b}"></div>
    <div class="field"><label>B call-duration multiplier</label><input type="number" step="0.05" id="f_dur_mult_b" value="${v.dur_mult_b}"></div>
    <div class="field"><label>Logging bug: B loses this share of non-converting calls</label><input type="number" step="0.05" id="f_log_drop_b" value="${v.log_drop_b}"></div>
    <div class="field"><label>Guardrail margin (duration)</label><input type="number" step="0.05" id="f_guardrail_margin" value="${v.guardrail_margin}"></div>
    <div class="field"><label>Random seed</label><input type="number" id="f_seed" value="${v.seed}"></div>
    <div class="field"><label>Variant B</label><select id="f_variant_b">${Object.entries(cands).map(([k, n]) => `<option value="${k}" ${k === v.variant_b ? "selected" : ""}>${n}</option>`).join("")}</select></div>
  </div><div style="margin-top:16px;display:flex;gap:10px"><button class="btn primary" style="border:0;background:var(--ink);color:var(--bg);padding:9px 18px;border-radius:9px;font-weight:650" id="runc">Run experiment</button><button class="btn2" id="cancelc">Cancel</button><span id="cerr" style="color:var(--bad-ink)"></span></div></div>`;
  $("#cancelc").onclick = () => { renderExperiment(); };
  $("#runc").onclick = async () => {
    const body = {}; for (const k of Object.keys(v)) { const el = $("#f_" + k); body[k] = el.tagName === "SELECT" ? el.value : parseFloat(el.value); }
    $("#runc").textContent = "Running..."; $("#cerr").textContent = "";
    try {
      const r = await fetch("/api/run", { method: "POST", body: JSON.stringify(body) }); const j = await r.json();
      if (j.error) throw new Error(j.error);
      S.key = "custom"; S.rec = j.record; S.meta = j.meta; S.replay = j.replay; S.k = 1; S.tamper = null; S.verify = null;
      renderExperiment(); play();
    } catch (e) { $("#cerr").textContent = String(e.message || e); $("#runc").textContent = "Run experiment"; }
  };
}

/* ------------------------------------------------------------------ proof lab */
const MNAME = { picky: "Picky (ours)", naive_peek: "Naive peeking (p<0.05 at every look)", fixed_horizon: "Fixed-horizon z-test", higher_rate: "Higher rate wins" };
const outc = (m, k) => (m.outcomes[k] ? m.outcomes[k].rate : 0);
/* proof sections 6 and 7: the spec's single-look rule vs ours, and decisions from results files */
function renderProofExtra(P) {
  if (!P.rulesets || !P.files) return "";
  const pc1 = x => (x * 100).toFixed(1) + "%", oc = (m, k) => (m.outcomes[k] ? m.outcomes[k].rate : 0);
  const rs = Object.entries(P.rulesets).map(([k, v]) => {
    const row = (name, m, cls) => `<tr class="${cls}"><td>${name}</td><td class="num">${pc1(oc(m, "PROMOTE"))}</td><td class="num">${pc1(oc(m, "STOP_HARM") + oc(m, "STOP_GUARDRAIL"))}</td><td class="num">${m.median_n_when_promoted ? nf(m.median_n_when_promoted) : "-"}</td><td class="num">${nf(m.mean_exposure_b)}</td></tr>`;
    return `<tr class="grp"><td colspan="5"><b>${esc(v.label)}</b></td></tr>${row("Sequential: early promote and early stop (ours, default)", v.sequential.picky, "ours")}${row("Single look at the end + strict daily harm check (the spec)", v.final_look.picky, "")}${row("Plain p&lt;0.05 every day (no correction)", v.final_look.naive_peek, "")}`;
  }).join("");
  const fl = Object.values(P.files).map(v => `<tr><td>${esc(v.label)}</td><td class="num">${nf(v.runs)}</td><td class="num">${pc1(oc(v, "PROMOTE"))}</td><td class="num">${pc1(oc(v, "STOP_HARM") + oc(v, "STOP_GUARDRAIL"))}</td><td class="num">${pc1(oc(v, "INCONCLUSIVE") + oc(v, "HOLD_FOR_APPROVAL"))}</td><td class="num">${v.ledger_ok} of ${v.runs}</td></tr>`).join("");
  return `
  <div class="sec"><h2>6. The dashboard spec's rule, against ours</h2><p>The spec proposes one winner call at the end plus a very strict daily harm check. The BRD proposes daily checks on stricter-early boundaries. They are different rules, so Picky runs either one (a setting) and we measured both on identical simulated traffic: ${nf(P.rulesets.aa.sequential.picky.runs)} tests per case, 14 days, 300 leads a day, 30% to B.</p>
    <div class="card"><table class="t"><thead><tr><th>Rule</th><th class="num">Ships B</th><th class="num">Stops B</th><th class="num">Calls to promote</th><th class="num">B calls served</th></tr></thead><tbody>${rs}</tbody></table>
    <p class="sub" style="margin-top:8px">Both valid rules keep false wins near the 2.5% budget when nothing changed. The spec's single look is simpler to explain; it can never promote early and catches a clearly worse B less often (its daily bar is stricter). Ours promotes sooner and protects better, at the price of a slightly higher false-stop rate. Neither is free: that is the trade, shown with numbers.</p></div></div>
  <div class="sec"><h2>7. Decisions made from results files</h2><p>The voice test runs elsewhere; the files come to us. This is the whole file path (write a file, read it, check it, decide), repeated on synthetic files with a known answer. The planned power is 80% for a +7 point lift.</p>
    <div class="card"><table class="t"><thead><tr><th>Truth in the file</th><th class="num">Files</th><th class="num">Ship B</th><th class="num">Stop B</th><th class="num">No decision / held</th><th class="num">Record intact</th></tr></thead><tbody>${fl}</tbody></table>
    <p class="sub" style="margin-top:8px">When A and B are identical, a winner is wrongly declared ${pc1(oc(P.files.aa, "PROMOTE"))} of the time (95% interval ${pc1(P.files.aa.outcomes.PROMOTE.ci[0])} to ${pc1(P.files.aa.outcomes.PROMOTE.ci[1])}; budget 2.5%). The record's hash chain was intact in every file.</p></div></div>`;
}

function renderProof() {
  const P = D.proof, app = $("#app");
  if (!P) { app.innerHTML = `<div class="card"><h3>Proof Lab</h3><p class="muted">No proof run found. Run <code>python -m picky proof</code> then rebuild.</p></div>`; return; }
  const sc = P.scenarios, aa = sc.aa.methods, srm = sc.srm_bug.methods, hm = sc.harm.methods;
  const exposure = 1 - hm.picky.mean_exposure_b / hm.fixed_horizon.mean_exposure_b;
  const tile = (title, big, vs, sub) => `<div class="card"><h3>${title}</h3><div class="big"><span class="n">${big}</span><span class="vs">${vs}</span></div><div class="sub" style="margin-top:8px">${sub}</div></div>`;
  const matrix = Object.entries(sc).map(([key, s]) => {
    const rows = Object.keys(MNAME).map(mk => {
      const m = s.methods[mk], ships = outc(m, "PROMOTE"), stops = outc(m, "STOP_HARM") + outc(m, "STOP_GUARDRAIL") + outc(m, "HALT_SRM");
      const cls = s.truth === "better" ? "good" : s.truth === "tiny" ? "neutral" : "bad";
      const verdict = s.truth === "better" ? "right" : s.truth === "tiny" ? "" : "wrong";
      return `<tr class="${mk === "picky" ? "ours" : ""}"><td>${MNAME[mk]}</td><td style="width:34%"><div style="display:flex;align-items:center;gap:8px"><div class="pbar" style="flex:1"><i class="${cls}" style="width:${Math.max(0.6, ships * 100)}%"></i></div><span style="min-width:48px;text-align:right">${pct(ships)}</span></div></td><td class="num">${mk === "fixed_horizon" || mk === "higher_rate" ? "-" : pct(stops, 0)}</td><td class="num">${m.median_n_when_promoted ? nf(m.median_n_when_promoted) : "-"}</td><td class="num">${nf(m.mean_exposure_b)}</td></tr>`;
    }).join("");
    const lead = s.truth === "better" ? "Shipping B is <b>right</b>." : s.truth === "tiny" ? "B is only +1pp better; either call is defensible." : "Shipping B is <b>wrong</b>.";
    return `<section class="card"><h3>${esc(s.label)}</h3><div class="sub">${lead} ${nf(s.methods.picky.runs)} simulated tests.</div>
      <table class="t" style="margin-top:8px"><thead><tr><th>Method</th><th>Ships B</th><th class="num">Stops / halts</th><th class="num">Calls to promote</th><th class="num">B calls served</th></tr></thead><tbody>${rows}</tbody></table></section>`;
  }).join("");
  // looks sweep chart data
  const ks = Object.keys(P.looks_sweep).map(Number).sort((a, b) => a - b), rowsK = ks.map((k, i) => ({ n: i, k, c: P.looks_sweep[k].picky, nv: P.looks_sweep[k].naive_peek }));
  const gridRows = [...new Set(P.grid.map(x => x.baseline))].sort((a, b) => a - b), gridCols = [...new Set(P.grid.map(x => x.share))].sort((a, b) => a - b);   // read from the data, never hard-coded
  const gcell = (b, s) => P.grid.find(x => x.baseline === b && x.share === s);
  const sp = P.split_accuracy;
  const spRows = sp.map(x => `<tr><td>${pct(x.share, 0)}</td><td class="num">${nf(x.n)}</td><td class="num">${x.hash.mean_abs_err_pp.toFixed(2)}</td><td class="num"><b>${x.balanced.mean_abs_err_pp.toFixed(2)}</b></td><td class="num">${x.naive_random.mean_abs_err_pp.toFixed(2)}</td><td class="num">${pct(x.hash.inside_95_band, 0)}</td><td class="num">${x.balanced.worst_prefix_pp ? x.balanced.worst_prefix_pp.toFixed(2) : "-"}</td></tr>`).join("");
  const st = P.stickiness;
  app.innerHTML = `
  <div class="note info"><b>Everything on this page is computed, not claimed.</b> Re-run it with <code>python -m picky proof</code> (seed ${P.seed}, ${nf(P.runs)} tests per case, ${nf(P.aa_runs)} for no-difference cases, ${P.seconds}s). Picky's decisions come from the same function the live engine uses; the typical approaches see exactly the same simulated calls.</div>
  <div class="proof-hero sec">
    ${tile("False win when nothing changed", pct(outc(aa.picky, "PROMOTE")), `vs <b>${pct(outc(aa.naive_peek, "PROMOTE"))}</b> naive peeking`, `A = B in truth. Fraction of ${nf(sc.aa.methods.picky.runs)} tests that crowned B anyway. Our error budget is 2.5%.`)}
    ${tile("Broken test: bad B shipped", pct(outc(srm.picky, "PROMOTE")), `vs <b>${pct(outc(srm.naive_peek, "PROMOTE"))}</b> naive peeking`, `B silently loses 35% of its non-converting calls from the log. Picky halts the test (${pct(outc(srm.picky, "HALT_SRM"), 0)} of runs); typical tools ship.`)}
    ${tile("Less traffic wasted on a bad B", "-" + (exposure * 100).toFixed(0) + "%", `B calls served, vs a fixed-horizon test`, `${esc(sc.harm.label)}. Picky stops it in ${pct(outc(hm.picky, "STOP_HARM"), 0)} of runs, serving ${nf(hm.picky.mean_exposure_b)} instead of ${nf(hm.fixed_horizon.mean_exposure_b)} calls to B on average.`)}
  </div>
  <div class="sec"><h2>1. Why repeated checks need a correction</h2><p>Checking a p-value at every look and stopping the first time it dips below 0.05 declares false winners far more often than 5%. The more you look, the worse it gets. Picky spends its error budget across looks, so it stays near 2.5% (one-sided) however often you peek.</p>
    <div class="card"><div class="legend"><span><i style="border-color:var(--ink)"></i>Naive peeking</span><span><i style="border-color:var(--accent)"></i>Picky</span><span><i style="border-color:var(--ink-3)"></i>2.5% error budget</span></div><div class="cv" id="c-sweep"></div><div class="sub">False-win rate when A = B, by number of looks. ${nf(P.aa_runs / 2)} simulated tests per point.</div></div></div>
  <div class="sec"><h2>2. Six truths, four methods</h2><p>Same simulated calls for every method. "Ships B" is red when shipping would be a mistake, green when it is right. Calls to promote is the median over runs that promoted.</p><div class="mx">${matrix}</div></div>
  <div class="sec"><h2>3. Does it hold at other base rates and traffic shares?</h2><p>False-win rate of Picky when A = B, for rare, typical and common outcomes and small to large test slices. Naive peeking in small print.</p>
    <div class="card"><table class="t heat"><thead><tr><th>Baseline rate</th>${gridCols.map(s => `<th style="text-align:center">${pct(s, 0)} to B</th>`).join("")}</tr></thead><tbody>${gridRows.map(b => `<tr><td><b>${pct(b, 0)}</b></td>${gridCols.map(s => { const g = gcell(b, s); const v = g.picky_false_promote; return `<td class="cell" style="background:${v > 0.032 ? "var(--warn-wash)" : "var(--good-wash)"}" title="MDE ${pp(g.mde, 0)}, n_max ${nf(g.n_max)}, ${nf(g.runs)} runs"><b>${pct(v)}</b><div class="muted" style="font-size:11px">naive ${pct(g.naive_false_promote)}</div></td>`; }).join("")}</tr>`).join("")}</tbody></table>
    <div class="sub" style="margin-top:8px">${nf(P.runs)} tests per cell. Anything above ~3.2% is shaded: the normal approximation is slightly liberal when the test slice is tiny and the outcome is rare. We report it instead of hiding it.</div></div></div>
  <div class="sec"><h2>4. Traffic split accuracy and stickiness</h2><p>Mean absolute error between configured and achieved B share, in percentage points, over repeated assignments. "Balanced" uses permuted blocks, so it stays tight to the target at every moment, not just at round numbers; "hash" is stateless and binomial; "coin flip" is the typical per-call random.</p>
    <div class="two"><section class="card"><table class="t"><thead><tr><th>Share</th><th class="num">Leads</th><th class="num">Hash</th><th class="num">Balanced</th><th class="num">Coin flip</th><th class="num">Hash in 95% band</th><th class="num" title="Largest gap at any moment once 500 leads are in">Balanced worst (after 500)</th></tr></thead><tbody>${spRows}</tbody></table></section>
    <section class="card"><h3>Stickiness</h3><div class="sub">${nf(st.calls)} calls, ${nf(st.distinct_leads)} leads, ${nf(st.repeat_calls)} repeat calls (30% repeat rate).</div>
      <table class="t" style="margin-top:8px"><thead><tr><th>Router</th><th class="num">Repeat calls that changed arm</th></tr></thead><tbody>
      <tr><td>Coin flip per call (typical)</td><td class="num">${nf(st.naive_random.arm_flips)} (${pct(st.naive_random.flip_rate, 1)})</td></tr>
      <tr class="ours"><td>Hash (Picky)</td><td class="num">${st.hash.arm_flips}</td></tr><tr class="ours"><td>Balanced (Picky)</td><td class="num">${st.balanced.arm_flips}</td></tr></tbody></table>
      <p class="sub" style="margin-top:8px">A second, independent hash router with no shared state disagreed on ${st.hash.independent_server_disagreements} of ${nf(st.distinct_leads)} leads, so two servers can route the same lead without talking to each other. Balanced mode remembers each lead in a ledger.</p></section></div></div>
  <div class="sec"><h2>5. When the auto-tagger is imperfect</h2><p>Outcomes are tagged by an evaluator, and evaluators make mistakes. This table is a model: it shows what a tagger of a given quality does to a test planned for a ${pp(P.config.mde, 0)} lift from ${pct(P.config.baseline, 0)}. Plug in the measured sensitivity and specificity once real labels exist.</p>
    <div class="card"><table class="t"><thead><tr><th>Tagger</th><th class="num">Sensitivity</th><th class="num">Specificity</th><th class="num">Observed lift</th><th class="num">Power</th><th class="num">Calls for 80% power</th></tr></thead><tbody>${P.evaluator_error.map(e => `<tr><td>${esc(e.tagger)}</td><td class="num">${pct(e.sensitivity, 0)}</td><td class="num">${pct(e.specificity, 0)}</td><td class="num">${e.observed_lift_pp.toFixed(1)} pp</td><td class="num">${pct(e.power, 0)}</td><td class="num">${nf(e.calls_needed_for_80pct_power)} (&times;${e.extra_calls_factor.toFixed(2)})</td></tr>`).join("")}</tbody></table></div></div>
  ${renderProofExtra(P)}`;
  const nmax = ks.length - 1;
  drawChart($("#c-sweep"), {
    xd: [-0.3, nmax + 0.3], yd: [0, 0.16], xt: rowsK.map(r => r.n), yt: [0, 0.025, 0.05, 0.1, 0.15], xf: i => ks[i] + (ks[i] === 1 ? " look" : " looks"), yf: v => (v * 100).toFixed(1).replace(/\.0$/, "") + "%", h: 260, label: "false-win rate by number of looks",
    layers: (sx, sy) => `<line x1="${sx(-0.3)}" x2="${sx(nmax + 0.3)}" y1="${sy(0.025)}" y2="${sy(0.025)}" stroke="var(--ink-3)"/>
      <path d="${path(rowsK.map(r => [r.n, r.nv.false_promote]), sx, sy)}" fill="none" stroke="var(--ink)" stroke-width="2.2" stroke-linejoin="round"/>
      <path d="${path(rowsK.map(r => [r.n, r.c.false_promote]), sx, sy)}" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linejoin="round"/>
      ${rowsK.map(r => dotSvg(sx(r.n).toFixed(1), sy(r.nv.false_promote).toFixed(1), "var(--ink)") + dotSvg(sx(r.n).toFixed(1), sy(r.c.false_promote).toFixed(1), "var(--accent)")).join("")}
      <text x="${sx(nmax) - 2}" y="${sy(rowsK[nmax].nv.false_promote) - 12}" text-anchor="end" class="lbl">${pct(rowsK[nmax].nv.false_promote)}</text><text x="${sx(nmax) - 2}" y="${sy(rowsK[nmax].c.false_promote) + 22}" text-anchor="end" class="lbl">${pct(rowsK[nmax].c.false_promote)}</text>`,
    tip: r => `<b>${ks[r.n]} look${ks[r.n] === 1 ? "" : "s"}</b><div class="r"><span>naive peeking</span><span>${pct(r.nv.false_promote)}</span></div><div class="r"><span>Picky</span><span>${pct(r.c.false_promote)}</span></div>`
  }, rowsK);
}

/* ------------------------------------------------------------------ planner */
function renderPlanner() {
  const G = D.plans, p = S.plan, app = $("#app");
  const cell = (b, m, s) => G.cells.find(c => c.baseline === b && c.mde === m && c.share === s);
  const pick = (arr, v) => arr.reduce((a, x) => Math.abs(x - v) < Math.abs(a - v) ? x : a, arr[0]);
  const cellFor = (s) => cell(p.b, p.m, s);
  const frac = (c) => Math.min(1, p.lpd * p.days / c.n_max);
  const PK = x => Number.isInteger(x) ? x.toFixed(1) : String(x);
  const fkey = (f) => { const ok = G.fractions.filter(x => x <= f + 1e-9); return ok.length ? PK(ok[ok.length - 1]) : null; };
  const c = cellFor(p.s) || cell(p.b, p.m, G.shares[1]);
  if (!c) { app.innerHTML = `<div class="card">That combination is outside the planner grid (baseline + lift must stay below 95%).</div>`; return; }
  const f = frac(c), fk = fkey(f), power = fk ? c.power_at[fk] : null, gp = fk ? c.guardrail_proof_at[fk] : null;
  const days = c.n_max / p.lpd;
  const v = f >= 1 ? ["good", "Run it", `This test can finish inside your window and has about ${pct(power, 0)} chance of detecting a real +${(p.m * 100).toFixed(0)} pp lift.`]
    : power != null && power >= 0.65 ? ["warn", "Borderline", `The window ends at ${pct(f, 0)} of the planned sample. Chance of detecting a real lift drops to ${pct(power, 0)}. Extend the window to ${Math.ceil(days)} days or raise the share.`]
    : ["bad", "Do not launch as set", `Only ${pct(f, 0)} of the needed calls fit in the window, so a real lift would be seen only ${power != null ? pct(power, 0) : "rarely"} of the time. Most likely outcome: inconclusive. Needs ${Math.ceil(days)} days at this traffic.`];
  const seg = (arr, key, fmt) => `<div class="pills">${arr.map(x => `<button data-k="${key}" data-v="${x}" aria-pressed="${x === p[key]}">${fmt(x)}</button>`).join("")}</div>`;
  const compare = G.shares.map(s => { const cc = cellFor(s); if (!cc) return ""; const ff = frac(cc), kk = fkey(ff); return `<tr class="${s === p.s ? "ours" : ""}"><td>${pct(s, 0)}</td><td class="num">${nf(cc.n_max)}</td><td class="num">${nf(cc.n_b_at_max)}</td><td class="num">${(cc.n_max / p.lpd).toFixed(1)} d</td><td class="num">${kk ? pct(cc.power_at[kk], 0) : "-"}</td></tr>`; }).join("");
  app.innerHTML = `<div class="grid plan"><section class="card"><h3>Test planner</h3><div class="sub">Before you launch: can this test conclude, and how long will it take?</div>
    <div class="form" style="margin-top:14px">
      <div class="field"><label>Current rate of the goal <span class="hint">baseline</span></label>${seg(G.baselines, "b", x => pct(x, 0))}</div>
      <div class="field"><label>Smallest lift worth detecting</label>${seg(G.mdes, "m", x => "+" + (x * 100).toFixed(0) + " pp")}</div>
      <div class="field"><label>Share of traffic to B</label>${seg(G.shares, "s", x => pct(x, 0))}</div>
      <div class="field"><label>Leads per day</label><input type="number" id="p_lpd" value="${p.lpd}" min="10" step="50"></div>
      <div class="field"><label>Window (days)</label><input type="number" id="p_days" value="${p.days}" min="1" max="120"></div>
    </div><p class="sub" style="margin-top:12px">Power 80%, one-sided error 2.5%, 40 looks, guardrail tolerance +${(G.guardrail_margin * 100).toFixed(0)}% on call duration. Rates and traffic are yours to set; the maths is the engine's.</p></section>
    <div class="stack"><section class="card"><div class="verdictbox ${v[0]}"><div class="pill ${v[0] === "good" ? "good" : v[0] === "warn" ? "warn" : "bad"}">${v[1]}</div><p style="margin-top:8px;font-size:15px">${v[2]}</p></div>
      <div class="tiles" style="grid-template-columns:repeat(4,1fr)">
        <div class="tile"><div class="k">Calls needed</div><div class="v">${nf(c.n_max)}</div><div class="d">${nf(c.n_fixed)} for a single-look test (+${((c.inflation - 1) * 100).toFixed(1)}%)</div></div>
        <div class="tile"><div class="k">Calls B receives</div><div class="v">${nf(c.n_b_at_max)}</div><div class="d">${pct(p.s, 0)} of the test</div></div>
        <div class="tile"><div class="k">Days at ${nf(p.lpd)}/day</div><div class="v">${days.toFixed(1)}</div><div class="d">window ${p.days} days</div></div>
        <div class="tile"><div class="k">Guardrail provable</div><div class="v">${gp != null ? pct(gp, 0) : "-"}</div><div class="d">chance duration is proven within the limit</div></div></div></section>
      <div class="two"><section class="card"><h3>Chance of detecting a real lift</h3><div class="sub">By share of the planned sample actually collected</div><div class="cv" id="c-pw"></div></section>
        <section class="card"><h3>Other traffic shares</h3><div class="sub">Same baseline and lift</div><table class="t" style="margin-top:8px"><thead><tr><th>B share</th><th class="num">Calls</th><th class="num">B calls</th><th class="num">Days</th><th class="num">Power in window</th></tr></thead><tbody>${compare}</tbody></table></section></div></div></div>`;
  $$(".pills button").forEach(b => b.onclick = () => { S.plan[b.dataset.k] = +b.dataset.v; renderPlanner(); });
  $("#p_lpd").onchange = e => { S.plan.lpd = Math.max(10, +e.target.value || 600); renderPlanner(); };
  $("#p_days").onchange = e => { S.plan.days = Math.max(1, +e.target.value || 14); renderPlanner(); };
  const pts = G.fractions.map(x => ({ n: x, pw: c.power_at[PK(x)] }));
  drawChart($("#c-pw"), {
    xd: [0.15, 1.05], yd: [0, 1], xt: [0.2, 0.4, 0.6, 0.8, 1], yt: [0, 0.25, 0.5, 0.8, 1], xf: x => (x * 100).toFixed(0) + "%", yf: v => (v * 100).toFixed(0) + "%", h: 230, mb: 28, label: "power by fraction of planned sample",
    layers: (sx, sy) => `<line x1="${sx(0.15)}" x2="${sx(1.05)}" y1="${sy(0.8)}" y2="${sy(0.8)}" stroke="var(--ink-3)"/><text x="${sx(0.2)}" y="${sy(0.8) - 5}">80% target</text>
      <path d="${path(pts.map(q => [q.n, q.pw]), sx, sy)}" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linejoin="round"/>
      ${fk ? `<line x1="${sx(+fk)}" x2="${sx(+fk)}" y1="${sy(0)}" y2="${sy(1)}" stroke="var(--ink)" opacity=".4"/>${dotSvg(sx(+fk).toFixed(1), sy(power).toFixed(1), "var(--accent)")}<text x="${sx(+fk) + (+fk > 0.8 ? -10 : 8)}" y="${sy(power) + 18}" text-anchor="${+fk > 0.8 ? "end" : "start"}" class="lbl">your window</text>` : ""}`,
    tip: q => `<b>${(q.n * 100).toFixed(0)}% of planned calls</b><div class="r"><span>power</span><span>${pct(q.pw, 0)}</span></div>`
  }, pts);
}

/* ------------------------------------------------------------------ labels */
function confusion(m) {
  const labs = Object.keys(m.confusion);
  const max = Math.max(1, ...labs.flatMap(a => labs.map(b => m.confusion[a][b])));
  return `<table class="conf" style="border-collapse:collapse;margin-top:8px"><thead><tr><th>truth \\ tagged</th>${labs.map(l => `<th>${esc(l.replace(/_/g, " "))}</th>`).join("")}</tr></thead><tbody>${labs.map(a => `<tr><th style="text-align:right">${esc(a.replace(/_/g, " "))}</th>${labs.map(b => { const v = m.confusion[a][b]; return `<td style="background:${a === b ? `color-mix(in srgb, var(--good) ${Math.round(v / max * 45)}%, transparent)` : v ? `color-mix(in srgb, var(--bad) ${Math.round(v / max * 60) + 10}%, transparent)` : "transparent"}">${v || ""}</td>`; }).join("")}</tr>`).join("")}</tbody></table>`;
}
function machineCard() {
  const a = D.auto || {}, r = a.report || {}, rich = r.rich; if (!rich) return "";
  const nice = k => String(k).replace(/_/g, " ") + (k === "did_not_confirm_details" ? " (retired: the real prompt forbids reading values back)" : "");
  const bars = (obj, total) => Object.entries(obj || {}).sort((x, y) => y[1] - x[1]).map(([k, v]) => `<tr><td>${esc(nice(k))}</td><td style="width:45%"><div class="pbar"><i class="neutral" style="width:${Math.max(2, v / total * 100)}%"></i></div></td><td class="num">${v}</td></tr>`).join("") || `<tr><td class="muted">none</td></tr>`;
  const n = r.machine_labelled, rate = r.buylead_rate_machine, acc = r.tagger_vs_human_blind;
  return `<div class="sec"><h2>What the machine found in ${n} real calls <span class="chip warn">machine labels, not yet human-verified</span></h2>
    <p>Sarvam transcribed each call (with speaker separation) and tagged it. These counts are the raw material for a later fix loop: every bot issue links back to the calls it appeared in (<code>data/fix_backlog.json</code>).</p>
    <div class="two"><section class="card"><h3>Outcomes</h3><div class="sub">${r.buylead_rate_loose ? `<b>${pct(r.buylead_rate_loose.rate, 0)}</b> of calls captured quantity and specification (95% range ${pct(r.buylead_rate_loose.ci[0], 0)} to ${pct(r.buylead_rate_loose.ci[1], 0)}), inside the stated 35-60% BuyLead-conversion benchmark. ` : ""}${r.provisional ? `These labels were made before the real VANI prompt arrived, so the label names below (partial, not interested, and so on) are the earlier vocabulary. The real BuyLead disposition is known only after the re-tag.` : (rate ? `Under the real definition, BuyLead created is ${pct(rate.rate, 0)}.` : "")}</div><table class="t" style="margin-top:8px"><tbody>${bars(r.distribution, n)}</tbody></table>
      <h3 style="margin-top:14px">How the calls ended</h3><table class="t" style="margin-top:8px"><tbody>${bars(rich.call_end, n)}</tbody></table></section>
    <section class="card"><h3>Where the bot went wrong${r.provisional ? " (provisional)" : ""}</h3><div class="sub">${pct(rich.bot_issue_rate, 0)} of calls have at least one issue. Fatal calls: ${esc(JSON.stringify(rich.fatal).replace(/[{}"]/g, "").replace(/,/g, ", "))}</div><table class="t" style="margin-top:8px"><tbody>${bars(rich.bot_issue_counts, n)}</tbody></table>
      <h3 style="margin-top:14px">Buyer mood and language</h3><table class="t" style="margin-top:8px"><tbody>${bars(rich.sentiment, n)}${bars(rich.language, n)}</tbody></table></section></div>
    <p class="sub">${acc ? `Checked by a person on ${acc.n} random calls: the machine's outcome was right ${pct(acc.accuracy, 0)} of the time.` : "Not yet checked by a person: use the spot-check list in Label calls."} Credits used: about Rs ${((a.status || {}).estimated_spend_inr || 0).toFixed(0)}.</p></div>`;
}

function renderLabels() {
  const L = D.labels, B = D.evalbench, app = $("#app"), o = B.overall;
  const real = L.consensus_calls || 0, goal = L.goal_rate;
  const step = (n, t, d, st) => `<div class="card"><div class="chip ${st === "done" ? "good" : st === "now" ? "accent" : ""}">${n}</div><h3 style="margin-top:8px">${t}</h3><p class="sub" style="margin-top:4px">${d}</p></div>`;
  app.innerHTML = `
  <div class="note"><b>Honest status.</b> We were given 713 recordings and no labels. ${((D.auto || {}).report || {}).machine_labelled ? `Sarvam has transcribed and tagged <b>${D.auto.report.machine_labelled}</b> of them (machine labels, <b>not yet checked by a person</b>). How accurate the tagger is on real calls is measured once someone spot-checks the 40-call list in <b>Label calls</b>. The confusion matrix below is on synthetic scripts and is only an optimistic bound.` : `So the real accuracy of the auto-tagger on real calls is <b>not measured yet</b>: ${real ? real + " calls have consensus labels so far." : "0 calls are labelled so far."} The numbers below the line are on <b>synthetic</b> scripts and are only an optimistic bound.`}</div>
  <div class="sec"><h2>How we get from no labels to a measured tagger</h2>
    <div class="three">
      ${step("1 &middot; Machine labels", "Sarvam labels, a person spot-checks", "Sarvam transcribes (speaker-separated) and tags a random sample. A person checks about 40 of them in Label calls (30 blind, 10 uncertain), about 25 minutes.", real >= 30 ? "done" : "now")}
      ${step("2 &middot; Baseline", "A real baseline rate", "From the labels we get the real conversion rate with an honest interval. The scenarios use it instead of an assumption.", ((D.auto || {}).report || {}).buylead_rate_loose ? "done" : "")}
      ${step("3 &middot; Score", "Score any tagger", "Once transcripts exist (Sarvam speech-to-text) the same labels score the LLM tagger: accuracy, kappa, confusion matrix. <code>python -m picky eval --transcripts DIR</code>", "")}
    </div></div>
  <div class="two sec" style="margin-top:22px">
    <section class="card"><h3>Real labels</h3><div class="sub">${LIVE ? "Live" : "Snapshot from the last build"}</div>
      <div class="tiles" style="grid-template-columns:repeat(3,1fr)"><div class="tile"><div class="k">Calls labelled</div><div class="v">${L.labelled_calls}</div><div class="d">of ${L.total_calls}</div><div class="bar"><i style="width:${Math.min(100, L.labelled_calls / L.target * 100)}%"></i></div></div>
        <div class="tile"><div class="k">Real ${esc(goalLabel(L.goal || "buylead_created"))} rate</div><div class="v">${goal ? pct(goal.rate) : "-"}</div><div class="d">${goal ? `95% ${pct(goal.ci[0])} to ${pct(goal.ci[1])}, n=${goal.n}` : "needs labels"}</div></div>
        <div class="tile"><div class="k">Labeller agreement</div><div class="v">${L.agreement ? "kappa " + L.agreement.kappa.toFixed(2) : "-"}</div><div class="d">${L.agreement ? `${L.agreement.shared} shared calls` : "needs two labellers"}</div></div></div>
      ${Object.keys(L.distribution || {}).length ? `<table class="t" style="margin-top:10px"><tbody>${Object.entries(L.distribution).map(([k, v]) => `<tr><td>${esc(k.replace(/_/g, " "))}</td><td class="num">${v}</td></tr>`).join("")}</tbody></table>` : ""}
      ${LIVE ? "" : `<p class="sub" style="margin-top:10px">Label Lab needs the live engine: <code>python -m picky serve</code>, then open this tab.</p>`}</section>
    <section class="card"><h3>Rule tagger on synthetic scripts</h3><div class="sub">${esc(B.note)}</div>
      <div class="tiles" style="grid-template-columns:repeat(3,1fr)"><div class="tile"><div class="k">Accuracy, all ${B.n}</div><div class="v">${pct(o.accuracy, 0)}</div><div class="d">95% ${pct(o.accuracy_ci[0], 0)} to ${pct(o.accuracy_ci[1], 0)}</div></div>
        <div class="tile"><div class="k">Easy / hard phrasings</div><div class="v">${pct(B.easy.accuracy, 0)} / ${pct(B.hard.accuracy, 0)}</div><div class="d">hard = wording the rules do not list</div></div>
        <div class="tile"><div class="k">${esc(goalLabel(B.overall.goal))}</div><div class="v">${pct(o.sensitivity, 0)} / ${pct(o.specificity, 0)}</div><div class="d">sensitivity / specificity</div></div></div>
      <div style="overflow:auto">${confusion(o)}</div>
      <p class="sub" style="margin-top:8px">The weak spot is plain: paraphrases. That is exactly what the LLM tagger (same interface, Sarvam model) and real labels are for. Section 5 of the Proof Lab shows what an imperfect tagger costs a test.</p></section></div>
  ${machineCard()}
  ${LIVE ? `<div class="sec"><h2>Label Lab</h2><div class="card lab" id="lab"></div></div>` : ""}`;
  if (LIVE) renderLab();
}

async function labNext() {
  const j = await (await fetch("/api/labels/next?labeler=" + encodeURIComponent(S.lab.name))).json();
  S.lab.call = j.call; S.lab.summary = j.summary; S.lab.disp = j.dispositions; S.lab.schema = j.schema; S.lab.start = Date.now();
  const m = j.call && j.call.machine;
  S.lab.fields = new Set(m ? m.fields : []); S.lab.bot = !!(m && m.bot_error); renderLab();
}
function renderLab() {
  const el = $("#lab"); if (!el) return; const lab = S.lab;
  if (!lab.name || !lab.started) {
    el.innerHTML = `<div><h3>Start labelling</h3><p class="sub">Enter your name. Two people should label the same calls so we can check we agree.</p><div class="field" style="max-width:320px;margin-top:12px"><label>Your name</label><input type="text" id="lname" value="${esc(lab.name)}" placeholder="e.g. Asha"></div><button class="btn2" id="lgo" style="margin-top:12px">Start</button></div><div class="note info"><b>How to label.</b> Each call is VANI phoning a buyer to capture their requirement because the seller was unavailable. Listen, then pick the one outcome that fits. Optional: tick the details VANI captured and whether the bot made a mistake. If unsure, pick Other. Number keys pick the outcome.</div>`;
    $("#lgo").onclick = () => { const n = $("#lname").value.trim(); if (!n) return; lab.name = n; lab.started = true; store.set("lab_name", n); labNext(); };
    return;
  }
  const c = lab.call, sm = lab.summary || {}; const mine = (sm.labellers || {})[lab.name] || 0;
  if (!c) { el.innerHTML = `<div><h3>All calls labelled</h3><p class="sub">Nothing left for ${esc(lab.name)}. Thank you.</p></div>`; return; }
  const sch = lab.schema || { fields: [], flags: [] };
  el.innerHTML = `<div><div class="toolbar"><h3>Call #${c.idx}</h3><span class="chip">${c.duration_s.toFixed(0)} s</span>${c.duration_s < 15 ? '<span class="chip warn">very short: probably no conversation</span>' : ""}<span class="muted" style="margin-left:auto">${esc(lab.name)} &middot; ${mine} labelled</span></div>
    ${c.review ? `<div class="note info" style="margin-top:10px"><b>Spot-check.</b> Read the transcript (Sarvam speech-to-text), listen if unsure, then pick the outcome. ${c.queue_left} left in your check list.</div><div class="tx" id="tx">Loading transcript...</div>` : ""}
    ${c.machine ? `<div class="machine"><div><b>Machine suggests:</b> ${esc(((lab.disp || []).find(d => d.key === c.machine.label) || {}).name || c.machine.label)}${c.machine.fields.length ? " &middot; details: " + esc(c.machine.fields.join(", ")) : ""}${c.machine.bot_error ? " &middot; bot mistake" : ""} &middot; confidence ${Math.round(c.machine.confidence * 100)}%</div><button class="btn2" id="accept">Machine is right</button></div>` : ""}
    <audio id="aud" controls ${c.review ? "" : "autoplay"} src="/audio/${c.idx}"></audio>
    <div class="lq">Optional: which details did VANI capture from the buyer?</div>
    <div class="chips" id="fchips">${sch.fields.map(f => `<button class="cchip" data-f="${f.key}" aria-pressed="${lab.fields.has(f.key)}">${esc(f.name)}</button>`).join("")}<button class="cchip bad" id="botflag" aria-pressed="${lab.bot}" title="${esc((sch.flags[0] || {}).hint || "")}">Bot made a mistake</button></div>
    <div class="lq">What was the outcome of the call?</div>
    <div class="lbtns">${(lab.disp || []).map((d, i) => `<button data-l="${d.key}"><span class="kbd">${i + 1}</span> ${esc(d.name)}<small>${esc(d.hint)}</small></button>`).join("")}</div>
    <div class="field" style="margin-top:10px"><input type="text" id="lnote" placeholder="optional note"></div></div>
    <div><h3>Progress</h3><div class="tiles" style="grid-template-columns:1fr 1fr"><div class="tile"><div class="k">You</div><div class="v">${mine}</div><div class="d">target ${sm.target || 60}</div></div><div class="tile"><div class="k">All labellers</div><div class="v">${sm.labelled_calls || 0}</div><div class="d">calls with a label</div></div></div>
    <div class="bar"><i style="width:${Math.min(100, mine / (sm.target || 60) * 100)}%"></i></div>${sm.goal_rate ? `<p class="sub" style="margin-top:10px">Share of calls that became a BuyLead so far: <b>${pct(sm.goal_rate.rate)}</b> (${pct(sm.goal_rate.ci[0], 0)}&ndash;${pct(sm.goal_rate.ci[1], 0)}, n=${sm.goal_rate.n})</p>` : ""}${sm.agreement ? `<p class="sub">${esc(sm.agreement.labellers.join(" and "))} agree on ${Math.round(sm.agreement.raw * 100)}% of the ${sm.agreement.shared} calls they both did.</p>` : ""}</div>`;
  $$("#fchips .cchip[data-f]").forEach(b => b.onclick = () => { const k = b.dataset.f; lab.fields.has(k) ? lab.fields.delete(k) : lab.fields.add(k); b.setAttribute("aria-pressed", lab.fields.has(k)); });
  $("#botflag").onclick = e => { lab.bot = !lab.bot; e.currentTarget.setAttribute("aria-pressed", lab.bot); };
  const submit = async l => { await fetch("/api/labels", { method: "POST", body: JSON.stringify({ idx: c.idx, labeler: lab.name, label: l, note: ($("#lnote") || {}).value || "", fields: [...lab.fields], flags: lab.bot ? ["bot_error"] : [] }) }); labNext(); };
  $$(".lbtns button").forEach(b => b.onclick = () => submit(b.dataset.l));
  if (c.review) fetch("/api/transcript/" + c.idx).then(r => r.json()).then(t => { const el2 = $("#tx"); if (el2) el2.textContent = t.text || "(no transcript yet for this call: listen to the audio)"; });
  if (c.machine) $("#accept").onclick = () => submit(c.machine.label);
  lab.keys = e => { if ((S.tab !== "labels" && S.tab !== "label") || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return; const i = +e.key - 1; if (lab.disp && lab.disp[i]) submit(lab.disp[i].key); };
}

/* ------------------------------------------------------------------ shell */
const OLD = [["exp", "Experiment"], ["proof", "Proof Lab"], ["planner", "Planner"], ["labels", "Labels"]];
const TABS = [["home", "Start"], ["files", "Judge a test"], ["plan", "Plan a test"], ["try", "Suggest a change"], ["trust", "Why trust it"], ["more", "More"]];
const MORE = ["hear", "label", "exp", "proof", "planner", "labels"];
function subnav(tab) {
  const el = document.createElement("div"); el.className = "subnav";
  el.innerHTML = `<span>For the technical team:</span>` + OLD.map(([k, n]) => `<button data-t="${k}" aria-pressed="${k === tab}">${n}</button>`).join("");
  $("#app").prepend(el); $$("button", el).forEach(b => b.onclick = () => go(b.dataset.t));
}
function renderMore() {
  stopV();
  const c = (k, t, b) => `<button class="s-card" data-go="${k}"><span class="s-ct">${t}</span><span class="s-cb">${b}</span><span class="s-go">Open ${icon("fwd", 14)}</span></button>`;
  $("#app").innerHTML = `<div class="s-wrap"><h1 class="s-h1">More</h1><p class="s-lead">Extra tools. You do not need them to judge a test.</p>
    <div class="f-grid">${c("hear", "Hear it", "Listen to the two prompts on the same simulated buyer (recorded earlier with a stand-in prompt).")}${c("label", "Label calls", "Check a sample of the machine's call labels. This measures how accurate they are.")}${c("exp", "Technical view", "Charts, the decision record, proof tables and split accuracy for engineers.")}</div></div>`;
  $$("#app [data-go]").forEach(b => b.onclick = () => go(b.dataset.go));
}
function go(tab) {
  stop(); stopV(); if (tab === "adv") tab = "exp"; S.tab = tab;
  const top = MORE.includes(tab) ? "more" : tab;
  $$("#tabs .tab").forEach(b => b.setAttribute("aria-selected", b.dataset.t === top));
  if (tab === "home") renderHome(); else if (tab === "more") renderMore(); else if (tab === "try") renderTry(); else if (tab === "files") renderFiles(); else if (tab === "hear") renderHear(); else if (tab === "plan") renderPlan(); else if (tab === "trust") renderTrust(); else if (tab === "label") renderLabelPage();
  else {
    if (tab === "exp") { if (!S.rec) loadScenario(S.key, false); else renderExperiment(); }
    else if (tab === "proof") renderProof(); else if (tab === "planner") renderPlanner(); else renderLabels();
    subnav(tab);
  }
  try { history.replaceState(null, "", "#" + tab + (tab === "exp" ? ":" + S.key : tab === "try" && V.key ? ":" + V.key : "")); } catch {}
  scrollTo(0, 0);
}
document.addEventListener("keydown", e => {
  if (/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName)) return;
  if (S.lab.keys) S.lab.keys(e);
  if (S.tab !== "exp" || !S.rec) return;
  if (e.code === "Space") { e.preventDefault(); S.playing ? stop() : play(); updatePlayer(); }
  if (e.key === "ArrowRight") { stop(); S.k = Math.min(S.rec.looks.length, S.k + 1); renderDynamic(); }
  if (e.key === "ArrowLeft") { stop(); S.k = Math.max(1, S.k - 1); renderDynamic(); }
});
window.addEventListener("resize", () => { if (S.tab === "exp" && S.rec) renderCharts(); });

async function init() {
  if (LIVE) { try { D = await (await fetch("/api/bundle")).json(); } catch (e) { $("#app").innerHTML = "<div class='card'>Could not reach the engine.</div>"; return; } }
  if (D.scenarios[0] && S.key === "b_wins") S.key = D.scenarios[0].meta.key;      // open the Advanced view on the fix experiment
  $("#mode").className = "chip " + (LIVE ? "good" : "");
  $("#mode").textContent = LIVE ? "Live engine" : "Offline demo";
  $("#tabs").innerHTML = TABS.map(([k, n]) => `<button class="tab" role="tab" data-t="${k}" aria-selected="false">${n}</button>`).join("");
  $$("#tabs .tab").forEach(b => b.onclick = () => go(b.dataset.t));
  const themes = [null, "light", "dark"]; let ti = Math.max(0, themes.indexOf(store.get("theme", null)));
  const applyTheme = () => { const t = themes[ti]; t ? document.documentElement.setAttribute("data-theme", t) : document.documentElement.removeAttribute("data-theme"); $("#theme").textContent = t ? (t === "dark" ? "Dark" : "Light") : "Auto"; store.set("theme", t); };
  $("#theme").onclick = () => { ti = (ti + 1) % 3; applyTheme(); if (S.tab === "exp" && S.rec) renderCharts(); };
  applyTheme();
  const h = (location.hash || "#home").slice(1).split(":"); const tab = TABS.concat(OLD).concat(MORE.map(k => [k])).some(t => t[0] === h[0]) ? h[0] : "home";
  if (h[1] && D.scenarios.some(s => s.meta.key === h[1])) { S.key = h[1]; if (tab === "try") V.key = h[1]; }
  if (tab === "try" && V.key) { const sc = D.scenarios.find(x => x.meta.key === V.key); V.rec = sc.record; V.meta = sc.meta; V.k = sc.record.looks.length; }
  go(tab);
}
init();
