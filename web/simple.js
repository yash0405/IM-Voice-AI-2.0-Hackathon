"use strict";
/* Picky - the simple front door. Plain words, one question per screen, big pictures.
   Everything technical lives under "Advanced". Uses the same engine data as the advanced views. */

const V = { key: null, rec: null, meta: null, k: 1, timer: null, playing: false, tail: null, back: null,
            plan: { lpd: 600, b: 0.45, m: 0.07, days: 14, s: 0.10 } };

const PICK = {
  fix_ships:      { title: "The fix works, so it ships", blurb: "The edit really helps. Picky proves it and rolls it out.", tone: "good", ic: "check" },
  fix_harms:      { title: "The fix backfires, so it is stopped", blurb: "The edit makes things worse. Picky pulls it early.", tone: "bad", ic: "x" },
  fix_flat:       { title: "The fix does almost nothing", blurb: "Too small to prove, so nothing changes.", tone: "neutral", ic: "approx" },
  b_wins:         { title: "The new prompt is better", blurb: "More buyers give their requirement.", tone: "good", ic: "check" },
  b_harmful:      { title: "The new prompt is worse", blurb: "Fewer buyers give their requirement.", tone: "bad", ic: "x" },
  inconclusive:   { title: "The change is too small to tell", blurb: "Hardly any real difference.", tone: "neutral", ic: "approx" },
  peeking_trap:   { title: "It only looks like a winner", blurb: "A lucky streak that is not real.", tone: "warn", ic: "alert" },
  srm_broken:     { title: "Something went wrong in the test", blurb: "The numbers cannot be trusted.", tone: "warn", ic: "link" },
  guardrail_veto: { title: "More leads, but calls run too long", blurb: "A win with a catch.", tone: "bad", ic: "clock" },
  guardrail_hold: { title: "More leads, calls a lot longer: a person decides", blurb: "A clear win with a catch. Nothing is thrown away.", tone: "warn", ic: "alert" },
  file_b_wins:        { title: "B wins", blurb: "Results file: the new prompt is better.", tone: "good", ic: "check" },
  file_b_harmful:     { title: "B is worse", blurb: "Results file: the new prompt hurts.", tone: "bad", ic: "x" },
  file_b_flat:        { title: "No real difference", blurb: "Results file: nothing to find. It says how much more data would settle it.", tone: "neutral", ic: "approx" },
  file_guardrail_hold:{ title: "B wins, but calls run longer", blurb: "Results file: held for a person to approve or reject.", tone: "warn", ic: "alert" },
  file_early_hangup:  { title: "B wins, but more early hang-ups", blurb: "Results file: stopped by a second guardrail.", tone: "bad", ic: "clock" },
  file_messy:         { title: "A messy export", blurb: "Results file: duplicates, other names, leads served both prompts. Picky lists what it found.", tone: "warn", ic: "link" }
};

const stopV = () => { V.playing = false; clearInterval(V.timer); V.timer = null; };
const goalName = k => { const d = (D.dispositions || []).find(x => x.key === k); return d ? d.name : k.replace(/_/g, " "); };
const rate1 = x => Math.round(x * 100) + "%";            // whole percentages: a few thousand leads cannot support a decimal point
const pts0 = x => { const v = Math.round(x); return v === 0 ? "0" : (v > 0 ? "+" : "") + v; };

/* ------------------------------------------------------------------ the fix journey (front door) */
const cards = list => list.map(s => { const p = PICK[s.meta.key] || { title: s.meta.title, blurb: "", tone: "neutral", ic: "approx" };
  return `<button class="s-card" data-key="${s.meta.key}"><span class="s-ic ${p.tone}">${icon(p.ic, 26)}</span><span class="s-ct">${esc(p.title)}</span><span class="s-cb">${esc(p.blurb)}</span><span class="s-go">Watch it ${icon("fwd", 14)}</span></button>`; }).join("");
const wire = () => $$(".s-card").forEach(b => b.onclick = () => startRun(b.dataset.key));
const pc0 = x => Math.round(x * 100) + "%";

function fixStep(n, title, body) { return `<section class="fx-step"><div class="fx-n">${n}</div><div class="fx-b"><h2 class="fx-t">${title}</h2>${body}</div></section>`; }
const inr = x => "Rs " + (x >= 10 ? Math.round(x) : x.toFixed(1));
const FIELD = { name: "Buyer name", product: "Product confirmation", "any slot": "Any single detail (enrichment flow)", quantity: "Quantity", "city / state": "City and state" };

/* highlight the words that differ between two lines (longest common subsequence of words) */
function wordDiff(a, b) {
  const x = a.split(" "), y = b.split(" "), L = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  let i = 0, j = 0; const A = [], B = [];
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) { A.push(esc(x[i])); B.push(esc(y[j])); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) A.push(`<mark>${esc(x[i++])}</mark>`); else B.push(`<mark>${esc(y[j++])}</mark>`);
  }
  while (i < x.length) A.push(`<mark>${esc(x[i++])}</mark>`); while (j < y.length) B.push(`<mark>${esc(y[j++])}</mark>`);
  return [A.join(" "), B.join(" ")];
}

function fixFind(F) {
  const m = F.mine, E = F.evidence || {}, lp = E.loops, cf = E.conflicts || [], ret = (m.retired || [])[0];
  const lintCard = `<div class="fx-card"><div class="fx-ct">1 &middot; The prompt disagrees with itself</div>
    <p class="fx-cs">We read VANI's real prompt (${nf((E.prompt || {}).words || 0)} words) with code and compared every limit on how many times it may ask for the same thing.</p>
    <ul class="fx-list">${cf.map(c => `<li><b>${esc(FIELD[c.field] || c.field)}</b>: ${c.limits.map(x => `<span class="fx-num">${x}</span>`).join(" or ")} asks<span class="fx-src">line${c.evidence.length > 1 ? "s" : ""} ${[...new Set(c.evidence.map(e => e.line + 1))].join(", ")}</span></li>`).join("") || "<li>No contradictions found.</li>"}</ul>
    <p class="fx-cs"><b>Why it matters:</b> IndiaMART's own quality matrix grades asking for the same thing more than 1+2 times as a <b>fatal</b> &ldquo;looping&rdquo; failure. Where two limits disagree, the bot can follow the wrong one.</p></div>`;
  const loopCard = lp ? `<div class="fx-card"><div class="fx-ct">2 &middot; Real calls rarely loop</div>
    <div class="fx-big">${(lp.bot_repeat3.rate * 100).toFixed(1)}%</div><p class="fx-cs">of ${nf(lp.calls_with_speech)} real calls with speech had VANI say the same thing 3 or more times (${nf(lp.bot_repeat3.n)} calls; ${nf(lp.bot_loop.n)} reached 4 or more).</p>
    <p class="fx-cs">This is a lower bound: VANI is told to vary its wording, and this check only sees near-identical repeats. So expect a <b>safety</b> gain from this fix, not a big jump in conversion.</p>
    <p class="fx-cs fx-note">Measured on the recordings by code, no AI involved.</p></div>` : "";
  const labelCard = `<div class="fx-card"><div class="fx-ct">3 &middot; What the ${nf(m.n_calls)} real calls show</div>
    <div class="fx-big">${rate1(m.baseline.rate)}</div><p class="fx-cs">captured quantity and specification${m.provisional ? " (a proxy; the labels were made before the real prompt arrived)" : ""}. Somewhere between ${pc0(m.baseline.ci[0])} and ${pc0(m.baseline.ci[1])}.</p>
    ${ret ? `<p class="fx-cs"><b>We caught our own mistake.</b> Our first tagger flagged &ldquo;${esc(ret.name.toLowerCase())}&rdquo; on ${nf(ret.calls)} calls. VANI's real prompt <i>forbids</i> reading values back, so that was never a failure. It is removed from the ranking.</p>` : ""}
    ${m.provisional ? `<p class="fx-cs fx-note">To rank real failures with IndiaMART's quality matrix, re-tag the calls (about ${inr(((F.costs || {}).retag || {}).est_inr || 23)}). Not run yet.</p>` : ""}</div>`;
  return fixStep(1, "Find what could be losing leads", `
    <p class="s-lead" style="margin-bottom:14px">Three independent checks, none of which needed a paid call.</p>
    <div class="fx-evgrid">${lintCard}${loopCard}${labelCard}</div>`);
}

function fixDraft(F) {
  const P = F.proposal, E = F.evidence || {}, ck = E.edit_check;
  if (!P) return fixStep(2, "A small fix", `<div class="s-honest">No fix candidate yet. Run <code>python -m canary fix candidate</code> (free).</div>`);
  const raw = (P.diff || []).filter(l => !/^(---|\+\+\+|@@)/.test(l)), rows = []; let rem = [], add = [];
  const flush = () => { const n = Math.max(rem.length, add.length); for (let i = 0; i < n; i++) { const r = rem[i], a = add[i];
    if (r !== undefined && a !== undefined) { const [ra, aa] = wordDiff(r, a); rows.push(["del", ra], ["add", aa]); } else if (r !== undefined) rows.push(["del", esc(r)]); else rows.push(["add", esc(a)]); } rem = []; add = []; };
  raw.forEach(l => { const c = l[0], t = l.slice(1); if (c === "-") rem.push(t); else if (c === "+") add.push(t); else { flush(); } });
  flush();
  const origin = P.origin === "ai-mined" ? ["good", "Drafted by Sarvam from the evidence"] : ["accent", "Derived from the prompt itself (free, no AI)"];
  return fixStep(2, "A small fix: make the prompt agree with itself", `
    <p class="s-lead" style="margin-bottom:10px"><span class="chip ${origin[0]}">${origin[1]}</span> One edit, ${rows.filter(r => r[0] === "add").length} lines changed in a ${nf(((E.prompt || {}).lines) || 0)}-line prompt. Highlighted words are what changes.</p>
    <div class="fx-diff" role="group" aria-label="The change to VANI's real prompt">${rows.map(([c, t]) => `<div class="fx-l ${c}"><i>${c === "add" ? "+" : "&minus;"}</i><span>${t}</span></div>`).join("")}</div>
    ${ck ? `<p class="fx-check">${icon(ck.ok ? "check" : "x", 16)} <b>Prompt lint:</b> contradictions ${ck.before} &rarr; <b>${ck.after}</b>, ${ck.introduced && ck.introduced.length ? ck.introduced.length : "none"} added. An edit that creates a new contradiction is rejected automatically.</p>` : ""}
    <div class="fx-meta"><div><span class="s-ut">What it is meant to do</span><p>${esc(P.why)}</p></div><div><span class="s-ut">The risk</span><p>${esc(P.risk)}</p></div></div>
    <p class="s-sm">${P.origin === "ai-mined" ? `Drafted by ${esc(P.model)}.` : `A Sarvam-written alternative from the same evidence would cost about ${inr(((F.costs || {}).draft || {}).est_inr || 1)}. Not run yet.`} A person can edit or reject any candidate before the test starts.</p>`);
}

function fixPrecheck(F) {
  const S = F.prescreen, C = F.costs || {}, pre = C.prescreen || {}, ar = C.arena || {};
  if (S && !S.stale) {
    const ok = S.passed, A = S.A, B = S.B, n = S.n_pairs;
    const chk = (good, txt) => `<li class="${good ? "ok" : "no"}">${icon(good ? "check" : "x", 16)}<span>${txt}</span></li>`;
    return fixStep(3, "Pre-check it on simulated buyers", `
      <p class="s-lead" style="margin-bottom:14px">${n} simulated buyers talk to VANI twice, with today's real prompt and with the fix. Sarvam's tagger scores every call.</p>
      <div class="s-two"><div class="s-tile a"><div class="s-k"><span class="dot" style="background:var(--a)"></span>Today's prompt</div><div class="s-big">${A.converted}<small> of ${n}</small></div><div class="s-sm">gave a usable requirement</div></div>
      <div class="s-tile b"><div class="s-k"><span class="dot" style="background:var(--b)"></span>With the fix</div><div class="s-big">${B.converted}<small> of ${n}</small></div><div class="s-sm">gave a usable requirement</div></div></div>
      <ul class="fx-checks">${chk(S.checks.conversion, `Usable requirements are not lower (${A.converted} vs ${B.converted})`)}${chk(S.checks.fatal, `No more failed calls (${A.fatal} vs ${B.fatal})`)}${chk(S.checks.turns, `Calls are not longer (${A.bot_turns} vs ${B.bot_turns} bot turns)`)}</ul>
      <p><span class="chip ${ok ? "good" : "bad"}">${ok ? "Passed: no sign of harm" : "Held back: it looks worse"}</span> <button class="s-link" id="hearlink">Listen to the calls</button></p>
      <p class="s-sm">Simulated buyers cannot prove an improvement; this only keeps a clearly worse edit away from real buyers.</p>`);
  }
  return fixStep(3, "Pre-check it on simulated buyers (not run yet)", `
    <div class="s-honest"><b>Not run on the real prompt yet, on purpose.</b> VANI's real prompt is about ${nf(pre.prompt_tokens_per_vani_turn || 22000)} tokens and is sent on every turn, so ${pre.simulated_calls || 24} simulated calls would cost about <b>${inr(pre.est_inr || 116)}</b> of Sarvam credits.
    ${S ? "An earlier run used our stand-in prompt, which turned out to be wrong about VANI, so its results are not shown." : ""} It is optional: step 4 stops a harmful edit anyway, and the lint check above already rejects an edit that contradicts the prompt.</div>
    <table class="t fx-cost"><thead><tr><th>Paid step (all optional)</th><th>Cost</th><th>Command</th></tr></thead><tbody>
      <tr><td>Re-tag the ${nf((C.retag || {}).to_retag || 298)} real calls with IndiaMART's quality matrix</td><td>${inr((C.retag || {}).est_inr || 23)}</td><td><code>autolabel retag --yes --budget N</code></td></tr>
      <tr><td>Sarvam drafts an edit from the evidence</td><td>${inr((C.draft || {}).est_inr || 1)}</td><td><code>fix propose --yes</code></td></tr>
      <tr><td>Pre-check: ${pre.personas || 12} simulated buyers, A and B</td><td>${inr(pre.est_inr || 116)}</td><td><code>fix prescreen --yes</code></td></tr>
      <tr><td>Voice arena: 3 buyers, A and B, with Sarvam voices</td><td>${inr(ar.total_inr || 53)}</td><td><code>arena run --yes --force</code></td></tr></tbody></table>`);
}

function fixProve(F) {
  const P = F.plan, fx = D.scenarios.filter(s => s.meta.key.startsWith("fix_")), rest = D.scenarios.filter(s => !s.meta.key.startsWith("fix_"));
  const tbl = P && P.table ? `<table class="t fx-cost"><thead><tr><th>A lift of</th><th>needs about</th><th>which is</th></tr></thead><tbody>${P.table.map(r => `<tr class="${r.mde === P.mde ? "hit" : ""}"><td>${(r.mde * 100).toFixed(0)} point${r.mde > 0.015 ? "s" : ""}</td><td>${nf(r.n_max)} calls</td><td>${r.days >= 60 ? "about " + Math.round(r.days) + " days" : Math.ceil(r.days) + " days"}</td></tr>`).join("")}</tbody></table>` : "";
  return fixStep(4, "Prove it on live traffic, then roll it out", `
    ${P ? `<p class="s-lead" style="margin-bottom:14px">At ${nf(P.leads_per_day)} calls a day with half on the fix, being sure of a <b>${(P.mde * 100).toFixed(0)}-point</b> lift (${rate1(P.baseline)} to ${rate1(P.baseline + P.mde)}) takes about <b>${nf(P.n_max)} calls, roughly ${Math.ceil(P.days_needed)} days</b>. Picky checks after every batch and acts the moment the evidence is strong, so it can finish sooner.</p>
    ${tbl}<p class="s-sm" style="margin:8px 0 14px">Small lifts are expensive to prove. Verbatim loops are rare in the real calls, so a consistency fix like this one is unlikely to move conversion by more than a point or so. That is why it is judged mainly on safety (no harm, no longer calls) and not on a conversion win.</p>` : ""}
    <p class="s-sm" style="margin:0 0 14px">Pick what the fix really does and watch Picky find out. These are simulations with a known answer, so you can see it get each one right.</p>
    <div class="s-cards">${cards(fx)}</div>
    <details class="s-how"><summary>More situations Picky handles</summary><div class="s-cards" style="margin-top:14px">${cards(rest)}</div></details>`);
}

function renderTry() {
  stopV();
  if (V.key) return renderRun();
  const F = D.fix;
  if (!F || !F.mine || !F.mine.issues.length) {                         // no labels yet: the plain scenario picker
    $("#app").innerHTML = `<div class="s-wrap"><h1 class="s-h1">Test a prompt change safely</h1><p class="s-lead">Picky tries a new prompt on a few buyers and tells you, in plain words, whether to roll it out. Pick a situation to watch it work.</p><div class="s-cards">${cards(D.scenarios)}</div></div>`;
    return wire();
  }
  $("#app").innerHTML = `<div class="s-wrap">
    <h1 class="s-h1">The bot finds its own weak spot, fixes it, and proves the fix</h1>
    <p class="s-lead">Four steps on VANI's <b>real prompt</b> and real calls. Nothing reaches a buyer until the evidence says it is safe, and every claim says how sure we are.</p>
    <div class="fx">${fixFind(F)}${fixDraft(F)}${fixPrecheck(F)}${fixProve(F)}</div>
    <p class="s-foot">Every step, including the evidence behind the fix, is saved in a tamper-evident record. <button class="s-link" id="totrust">Why you can trust the result</button></p></div>`;
  wire();
  const h = $("#hearlink"); if (h) h.onclick = () => go("hear");
  $("#totrust").onclick = () => go("trust");
}

function startRun(key) {
  const sc = D.scenarios.find(s => s.meta.key === key); if (!sc) return;
  V.key = key; V.rec = sc.record; V.meta = sc.meta; V.k = 1; V.tail = null; V.back = null;
  renderRun(); playV();
}
function startFiles(key, rec, meta) {
  V.key = key; V.rec = rec; V.meta = meta; V.k = 1; V.tail = null; V.back = "files";
  renderRun(); playV();
}

/* ------------------------------------------------------------------ the run screen */
function renderRun() {
  const rec = V.rec, c = rec.config, B = rec.variants.B, p = PICK[V.key] || { title: V.meta.title };
  $("#app").innerHTML = `<div class="s-wrap">
    <button class="s-back" id="sb">${icon("back", 14)} ${V.back === "files" ? "Back to results files" : "Pick another situation"}</button>
    <h1 class="s-h1">${esc(p.title)}</h1>
    <p class="s-lead">We are trying a new prompt, <b>&ldquo;${esc(B.name)}&rdquo;</b>, on ${pct(c.share_b, 0)} of buyers. Everyone else keeps today's prompt. The goal: more calls that end with a <b>${esc(goalName(c.primary_goal))}</b>, meaning the buyer's requirement is captured and the seller does not lose the lead.</p>
    <div class="s-two">
      <div class="s-tile a"><div class="s-k"><span class="dot" style="background:var(--a)"></span>Today's prompt</div><div class="s-big" id="ra">-</div><div class="s-sm" id="na">-</div></div>
      <div class="s-tile b"><div class="s-k"><span class="dot" style="background:var(--b)"></span>New prompt</div><div class="s-big" id="rb">-</div><div class="s-sm" id="nb">-</div></div>
    </div>
    <div class="s-panel">
      <h2 class="s-h2">Is the new prompt better?</h2>
      <div id="gauge"></div>
      <p class="s-status" id="status"></p>
      <div class="s-prog"><div class="s-progbar"><i id="pbar"></i></div><span id="plabel" class="s-sm"></span></div>
    </div>
    <div id="result"></div>
    <div class="s-actions"><button class="s-btn" id="sp"></button><button class="s-link" id="ss">Skip to the result</button></div>
    <details class="s-how" id="how"><summary>How did Picky decide?</summary><div id="howbody"></div></details>
  </div>`;
  $("#sb").onclick = () => { V.key = null; if (V.back === "files") { stopV(); go("files"); } else renderTry(); };
  $("#sp").onclick = () => { if (V.k >= V.rec.looks.length) { V.k = 1; playV(); } else if (V.playing) { stopV(); updateRun(); } else playV(); };
  $("#ss").onclick = () => { stopV(); V.k = V.rec.looks.length; updateRun(); };
  renderHow(); updateRun();
}

function playV() {
  const L = V.rec.looks.length; V.playing = true; clearInterval(V.timer);
  V.timer = setInterval(() => { if (V.k >= L) { stopV(); updateRun(); return; } V.k++; updateRun(); }, 150);
  updateRun();
}

function gauge(row) {
  const narrow = innerWidth < 640, W = narrow ? 540 : 900, F = narrow ? 1.5 : 1, x0 = 30, x1 = W - 30, R = 4, sx = z => x0 + (Math.max(-R, Math.min(R, z)) + R) / (2 * R) * (x1 - x0);
  const eff = row.eff, harm = row.harm, ex = sx(eff), hx = sx(-harm), nx = sx(row.z);
  const green = eff < R ? `<rect x="${ex}" y="62" width="${x1 - ex}" height="30" fill="var(--good)" opacity=".85"/>` : "";
  const red = harm < R ? `<rect x="${x0}" y="62" width="${hx - x0}" height="30" fill="var(--bad)" opacity=".85"/>` : "";
  const midL = (harm < R ? hx : x0), midR = (eff < R ? ex : x1);
  return `<svg viewBox="0 0 ${W} ${narrow ? 170 : 150}" width="100%" role="img" aria-label="Gauge: stop, keep testing, or ship it">
    <rect x="${x0}" y="62" width="${x1 - x0}" height="30" rx="15" fill="var(--grid)"/>
    <clipPath id="gc"><rect x="${x0}" y="62" width="${x1 - x0}" height="30" rx="15"/></clipPath><g clip-path="url(#gc)">${red}${green}</g>
    <text x="${(midL + midR) / 2}" y="82" text-anchor="middle" font-size="${15*F}" font-weight="600" fill="var(--ink-2)">Keep testing</text>
    ${harm < R ? `<text x="${(x0 + hx) / 2}" y="82" text-anchor="middle" font-size="${14*F}" font-weight="700" fill="#fff">${hx - x0 > 70 ? "Stop" : ""}</text>` : ""}
    ${eff < R ? `<text x="${(ex + x1) / 2}" y="82" text-anchor="middle" font-size="${14*F}" font-weight="700" fill="#fff">${x1 - ex > 80 ? "Ship it" : ""}</text>` : ""}
    <path d="M${nx - 11},38 L${nx + 11},38 L${nx},58 Z" fill="var(--ink)"/>
    <text x="${nx}" y="30" text-anchor="middle" font-size="${14*F}" font-weight="700" fill="var(--ink)">Now</text>
    <text x="${x0}" y="${narrow ? 158 : 132}" font-size="${13*F}" fill="var(--ink-3)">Clearly worse</text>
    <text x="${x1}" y="${narrow ? 158 : 132}" font-size="${13*F}" fill="var(--ink-3)" text-anchor="end">Clearly better</text>
    ${eff >= R ? `<text x="${x1}" y="52" font-size="${12*F}" fill="var(--ink-3)" text-anchor="end">Ship-it line is far away for now &rarr;</text>` : ""}
  </svg>`;
}
const seenRows = () => V.rec.looks.slice(0, V.k);

function updateRun() {
  if (!$("#gauge")) return;
  const rec = V.rec, L = rec.looks.length, row = rec.looks[V.k - 1], final = V.k >= L, res = rec.result;
  $("#ra").textContent = rate1(row.rateA); $("#rb").textContent = rate1(row.rateB);
  const gl = V.back === "files" ? `reached the goal (${goalName(rec.config.primary_goal)})` : "became a BuyLead";
  $("#na").textContent = `${nf(row.xA)} of ${nf(row.nA)} ${V.back === "files" ? "leads" : "calls"} ${gl}`;
  $("#nb").textContent = `${nf(row.xB)} of ${nf(row.nB)} ${V.back === "files" ? "leads" : "calls"} ${gl}`;
  $("#gauge").innerHTML = gauge(row);
  const pr = Math.min(1, row.n / rec.design.n_max);
  $("#pbar").style.width = (pr * 100) + "%";
  $("#plabel").textContent = `${nf(row.n)} of ${nf(rec.design.n_max)} planned ${V.back === "files" ? "leads" : "calls"}`;
  let st;
  if (final && res.status === "running") st = `Results so far cover ${res.days_seen} of ${res.window_days} days. No decision yet: the evidence has not crossed a line.`;
  else if (final) st = "Picky has made its decision.";
  else if (row.z > 1.2) st = "Leaning towards the new prompt, but not sure yet. Keep collecting calls.";
  else if (row.z < -1.2) st = "Leaning against the new prompt, but not sure yet. Keep collecting calls.";
  else st = "No clear difference yet. Too early to say, so Picky keeps collecting calls.";
  $("#status").textContent = st;
  const sp = $("#sp"); sp.innerHTML = final ? `${icon("play", 14)} Watch again` : (V.playing ? `${icon("pause", 14)} Pause` : `${icon("play", 14)} Continue`);
  $("#ss").hidden = final;
  $("#result").innerHTML = final ? resultCard() : "";
}

function usualTool() {
  const P = D.proof; if (!P) return "";
  const S = P.scenarios, o = (k, m, x) => (S[k].methods[m].outcomes[x] || { rate: 0 }).rate, k = V.key;
  const pc = x => Math.round(x * 100) + "%";
  const naive = V.rec.looks.find(r => r.naive_cross && r.z > 0);
  if (k.startsWith("fix_")) {
    const rec = V.rec, d = rec.design, r = rec.result, planB = Math.round(d.n_max * rec.config.share_b);
    if (k === "fix_ships") return `A test that runs for a fixed length would wait for all <b>${nf(d.n_max)}</b> calls before deciding. Picky was sure after <b>${nf(r.calls_analysed)}</b>, so the fix reached everyone about <b>${Math.round((1 - r.calls_analysed / d.n_max) * 100)}%</b> sooner, without raising the chance of a false win.`;
    if (k === "fix_harms") return `A fixed-length test would have kept about <b>${nf(planB)}</b> buyers on the worse prompt until the end. Picky stopped after <b>${nf(r.exposed_b_calls)}</b>.`;
    return `With an effect this small, a tool that peeks every day would still announce a winner <b>${pc(o("aa", "naive_peek", "PROMOTE"))}</b> of the time even when nothing changed (in our tests). Saying &ldquo;we cannot tell&rdquo; is the honest answer, and the next edit gets its turn.`;
  }
  if (k === "guardrail_hold") return `A tool that only watches the goal would have rolled this out; one that only watches handling time would have thrown it away. Picky does neither: it holds the win for a person and logs the decision either way.`;
  if (k.startsWith("file_") && P.files) return `We tested the file path on <b>${nf(P.files.aa.runs)}</b> synthetic files where A and B were identical: it crowned a winner <b>${pc(P.files.aa.outcomes.PROMOTE.rate)}</b> of the time (budget 2.5%). A plain "p &lt; 0.05 every day" rule crowns a false winner about 1 time in ${Math.round(1 / (P.rulesets ? P.rulesets.aa.final_look.naive_peek.outcomes.PROMOTE.rate : 0.11))}.`;
  if (k === "peeking_trap") return `A usual tool that checks the numbers every day would have announced a winner after ${naive ? nf(naive.n) : "about 1,400"} calls and rolled it out. That would have been a mistake: there is no real difference. In our tests, usual tools make this mistake <b>${pc(o("aa", "naive_peek", "PROMOTE"))}</b> of the time. Picky: <b>${pc(o("aa", "canary", "PROMOTE"))}</b>.`;
  if (k === "srm_broken") return `A usual tool would have rolled this out, because the new prompt looked ${((V.rec.looks[V.rec.looks.length - 1].diff) * 100).toFixed(1)} points better. In our tests it does so <b>${pc(o("srm_bug", "naive_peek", "PROMOTE"))}</b> of the time. Picky caught the problem and stopped: it rolls out a broken test only <b>${pc(o("srm_bug", "canary", "PROMOTE"))}</b> of the time.`;
  if (k === "guardrail_veto") return `A tool that only watches BuyLead conversion would have rolled this out (<b>${pc(o("guardrail", "naive_peek", "PROMOTE"))}</b> of the time in our tests). Picky also checks average handling time, so it did not.`;
  if (k === "b_harmful") return `A test that runs for a fixed length keeps sending buyers to a worse prompt until the end: about <b>${nf(S.harm.methods.fixed_horizon.mean_exposure_b)}</b> buyers on average, against <b>${nf(S.harm.methods.canary.mean_exposure_b)}</b> with Picky.`;
  if (k === "b_wins") return `A fixed-length test needs about <b>${nf(S.win.methods.fixed_horizon.median_n_when_promoted)}</b> calls before it can decide. Picky typically decides after <b>${nf(S.win.methods.canary.median_n_when_promoted)}</b>.`;
  if (k === "inconclusive") return `With an effect this small, some tools would still announce a winner (<b>${pc(o("small", "naive_peek", "PROMOTE"))}</b> of the time in our tests). Saying &ldquo;we cannot tell&rdquo; is the honest answer.`;
  return "";
}

function B_origin() {
  const b = V.rec.variants.B, f = (D.fix || {}).proposal;
  if (b.origin !== "ai-mined" && b.origin !== "lint-derived") return "";
  const e = f ? f.evidence : null;
  const how = b.origin === "lint-derived"
    ? `It was derived from the prompt's own contradictions (${e ? e.conflicts_before : "some"} found, ${e ? e.conflicts_after : "none"} left).`
    : `Sarvam drafted it from the evidence${e && e.calls_with_issue ? ` (${nf(e.calls_with_issue)} real calls)` : ""}.`;
  return `<p class="s-next" style="margin-bottom:8px"><b>Where the fix came from:</b> ${how} That evidence is the first entry in the record.</p>`;
}

function resultCard() {
  const ext = V.back === "files";            // results from files: Picky advises, it does not control the live traffic
  const rec = V.rec, res = rec.result, last = rec.looks[rec.looks.length - 1], c = rec.config, g = last.guardrail;
  const pts = ((last.rateB - last.rateA) * 100), exp = res.exposed_b_calls, days = Math.max(1, Math.ceil((new Date(last.time) - new Date(c.start)) / 86400000));
  const T = {
    PROMOTE: ["good", "check", ext ? "The new prompt is better: the evidence supports shipping it." : "The new prompt is better. It is now rolled out to everyone.",
      `It turns ${rate1(last.rateB)} of calls into BuyLeads against ${rate1(last.rateA)} today (${pts0(pts)} points)${g ? ", and average handling time stayed within the safe limit" : ""}. The evidence was strong enough to be sure it is not luck.`, ext ? "Picky does not control your live traffic: switch everyone to the new prompt yourself and keep a rollback path." : "All buyers now get the new prompt."],
    STOP_HARM: ["bad", "x", ext ? "The new prompt is worse: the evidence says stop it." : "The new prompt is worse, so Picky stopped it early.",
      `It turned only ${rate1(last.rateB)} of calls into BuyLeads against ${rate1(last.rateA)} today. Only ${nf(exp)} buyers ever heard it.`, ext ? "Send everyone back to today's prompt." : "Everyone is back on today's prompt."],
    INCONCLUSIVE: ["neutral", "approx", "No real difference was found, so nothing changes.",
      `After the full test the two prompts look the same (${rate1(last.rateB)} vs ${rate1(last.rateA)}). Picky will not roll out a change it cannot prove.`, "Today's prompt stays."],
    HALT_SRM: ["warn", "link", "The test itself broke, so nothing was rolled out.",
      `The new prompt looked about ${Math.abs(Math.round(pts))} points better, but calls from one group were going missing from the records, so the numbers cannot be trusted. Fix the tracking, then run the test again.`, "Everyone is on today's prompt."],
    STOP_GUARDRAIL: (c.guard_rate && res.reason.indexOf(c.guard_rate) >= 0)
      ? ["bad", "clock", `More of the goal, but ${c.guard_rate.replace(/_/g, " ")} got worse, so it was stopped.`,
         `The new prompt does better on the goal (${rate1(last.rateB)} vs ${rate1(last.rateA)}) but breaks a safety limit. ${res.reason}.`, "Everyone is back on today's prompt."]
      : ["bad", "clock", "More BuyLeads, but calls run too long, so it was stopped.",
         `The new prompt makes more BuyLeads (${rate1(last.rateB)} vs ${rate1(last.rateA)}) but average handling time is ${g ? (g.worse * 100).toFixed(0) : "much"}% longer. The limit is ${(c.guardrail_margin * 100).toFixed(0)}%.`, "Everyone is back on today's prompt."],
    HOLD_FOR_APPROVAL: ["warn", "alert", "The new prompt wins, but a safety check is not proven, so a person decides.",
      res.hold_cause === "manual_approval" ? `The new prompt beat today's (${rate1(last.rateB)} vs ${rate1(last.rateA)}) and approval mode is manual.` :
      `The new prompt makes more of the goal (${rate1(last.rateB)} vs ${rate1(last.rateA)}), but a guardrail could not be proven within its limit${g ? `: handling time is ${(g.worse * 100).toFixed(0)}% longer, the limit is ${(c.guardrail_margin * 100).toFixed(0)}%` : ""}. A clear win is not thrown away, and it is not shipped on its own.`,
      "Nothing changes for callers until a person approves or rejects. Either click is saved in the record."],
    CONTINUE: ["run", "play", "Still running: no decision yet.", `The results so far cover ${res.days_seen} of ${res.window_days} days. The evidence has not crossed a line in either direction.`, "Add the next day's results and Picky looks again."]
  }[res.kind] || ["neutral", "approx", res.kind, res.reason, ""];
  const ut = usualTool();
  const lenTxt = g ? `${g.worse >= 0 ? "+" : ""}${(g.worse * 100).toFixed(0)}% (limit +${(c.guardrail_margin * 100).toFixed(0)}%)` : "";
  return `<div class="s-result ${T[0]}"><div class="s-ric">${icon(T[1], 34)}</div><div>
    <div class="s-rt">${esc(T[2])}</div><p class="s-rd">${esc(T[3])}</p>${rangeSentence(last)}
    <div class="s-facts"><span><b>${nf(last.n)}</b> calls tested</span><span><b>${nf(exp)}</b> buyers heard the new prompt</span><span><b>${days}</b> day${days > 1 ? "s" : ""}</span>${g ? `<span>Handling time <b>${esc(lenTxt)}</b></span>` : ""}</div>
    ${B_origin()}
    <p class="s-next"><b>What happens next:</b> ${esc(T[4])} Every step is saved in a tamper-evident record.</p>
    ${V.tail ? `<p class="s-next"><b>${esc(tailSays(V.tail))}</b></p>` : ""}${moreLeadsHtml(res)}${actionBar(rec, V.tail)}${dataNotesHtml(rec)}${verifyLine(rec, V.tail)}</div></div>
    ${ut ? `<div class="s-usual"><div class="s-ut">Why this matters</div><p>${ut}</p></div>` : ""}`;
}

function rangeSentence(last) {
  const lo = last.rci && last.rci[0] * 100, hi = last.rci && last.rci[1] * 100;
  if (lo == null || hi == null || !isFinite(lo) || !isFinite(hi) || Math.abs(hi - lo) > 60) return `<p class="s-sm">Too early for a range: not enough results yet.</p>`;
  const d = (last.rateB - last.rateA) * 100, r = x => (Math.round(x) >= 0 ? "+" : "") + Math.round(x);
  return `<p class="s-sm"><b>How sure?</b> Best estimate: B is about ${pts0(d)} points ${d >= 0 ? "ahead of" : "behind"} A. The true difference is probably between <b>${r(lo)}</b> and <b>${r(hi)}</b> points. A range that includes 0 means "not proven".</p>`;
}

function verifyLine(rec, tail) {
  const all = rec.ledger.concat(tail && rec.tails && rec.tails[tail] ? rec.tails[tail] : []).map((e, i) => ({ e, i })), v = chain(all, null);
  return `<p class="s-sm" style="margin-top:8px;color:${v.ok ? "var(--good-ink)" : "var(--bad-ink)"}">${v.ok ? `Record checked in your browser just now: ${v.n} entries, chain intact.` : "Record BROKEN: an entry was changed."}</p>`;
}

function renderHow() {
  const c = V.rec.config;
  $("#howbody").innerHTML = `<ol class="s-steps">
    <li><b>Fair split.</b> ${pct(c.share_b, 0)} of buyers hear the new prompt. A buyer always gets the same prompt, every time they phone, so the test is not muddied.</li>
    <li><b>Check as we go.</b> After every batch of calls, Picky asks: is the new prompt clearly better, clearly worse, or still unclear? The coloured zones on the gauge are those answers.</li>
    <li><b>Be sure before acting.</b> Picky only acts when luck is very unlikely to explain the result. Because it plans for repeated checking, it cannot be fooled by a lucky streak.</li>
    <li><b>Safety checks.</b> It also watches average handling time and whether call tracking is healthy. Any problem stops the rollout.</li></ol>
    <button class="s-link" id="tech">See the technical view of this test</button>`;
  $("#tech").onclick = () => {
    if (V.back === "files") { S.key = V.key; S.rec = V.rec; S.meta = V.meta; S.replay = { same_ledger_head: true }; S.k = V.rec.looks.length; S.tail = V.tail; S.tamper = null; S.verify = null; go("exp"); }
    else { S.key = V.key; S.rec = null; go("exp"); }
  };
}

/* ------------------------------------------------------------------ plan a test */
function renderPlan() {
  stopV();
  const G = D.plans, p = V.plan, cell = (b, m, s) => G.cells.find(c => c.baseline === b && c.mde === m && c.share === s);
  const PK = x => Number.isInteger(x) ? x.toFixed(1) : String(x);
  const fkey = f => { const ok = G.fractions.filter(x => x <= f + 1e-9); return ok.length ? PK(ok[ok.length - 1]) : null; };
  const c = cell(p.b, p.m, p.s);
  if (!c) { $("#app").innerHTML = `<div class="s-wrap"><p class="s-lead">Please pick a smaller improvement: today's rate plus the improvement must stay below 95%.</p></div>`; return; }
  const cap = p.lpd * p.days, f = Math.min(1, cap / c.n_max), fk = fkey(f), power = fk ? c.power_at[fk] : 0, days = Math.ceil(c.n_max / p.lpd);
  let tone, head, body;
  if (f >= 1) { tone = "good"; head = "Yes, this test can give you a clear answer."; body = `You need about ${nf(c.n_max)} calls, which is roughly ${days} day${days > 1 ? "s" : ""} of your traffic. If the new prompt really is ${(p.m * 100).toFixed(0)} points better, there is about a ${Math.round(power * 100)}% chance Picky will spot it.`; }
  else if (power >= 0.65) { tone = "warn"; head = "Maybe. It could work, but it is tight."; body = `You need about ${nf(c.n_max)} calls (${days} days). In ${p.days} days you would have ${Math.round(f * 100)}% of that, so the chance of spotting a real improvement drops to about ${Math.round(power * 100)}%.`; }
  else { tone = "bad"; head = "Not as set. This test would probably end with no answer."; body = `You need about ${nf(c.n_max)} calls (${days} days at your traffic), but ${p.days} days only gives ${Math.round(f * 100)}% of that. The chance of spotting a real improvement would be just ${Math.round(power * 100)}%.`; }
  let tip = "";
  if (f < 1) {
    const alt = G.shares.map(s => cell(p.b, p.m, s)).filter(Boolean).find(cc => { const ff = Math.min(1, cap / cc.n_max), k = fkey(ff); return ff >= 1 || (k && cc.power_at[k] >= 0.8); });
    tip = alt ? `Tip: send ${Math.round(alt.share * 100)}% of buyers to the new prompt and this test fits in ${p.days} days.` : `Tip: run the test for about ${days} days, or try a bigger improvement.`;
  }
  const pills = (arr, key, fmt) => `<span class="s-pills">${arr.map(x => `<button data-k="${key}" data-v="${x}" aria-pressed="${x === p[key]}">${fmt(x)}</button>`).join("")}</span>`;
  $("#app").innerHTML = `<div class="s-wrap"><h1 class="s-h1">Can this test give a clear answer?</h1>
    <p class="s-lead">Fill in the sentence. Picky tells you before you start whether the test can work.</p>
    <div class="s-sentence">We handle <input type="number" id="lpd" value="${p.lpd}" min="10" step="50"> calls a day. Today, <span class="s-pills">${G.baselines.map(x => `<button data-k="b" data-v="${x}" aria-pressed="${x === p.b}">${Math.round(x * 100)}%</button>`).join("")}</span> of calls become a BuyLead. We care about an improvement of ${pills(G.mdes, "m", x => "+" + Math.round(x * 100) + (Math.round(x * 100) === 1 ? " point" : " points"))}. We can test for <input type="number" id="days" value="${p.days}" min="1" max="120"> days.</div>
    <div class="s-result ${tone}" style="margin-top:20px"><div><div class="s-rt">${head}</div><p class="s-rd">${body}</p>${tip ? `<p class="s-next"><b>${esc(tip)}</b></p>` : ""}</div></div>
    <details class="s-how"><summary>More options</summary><div style="padding-top:8px">Share of buyers who try the new prompt: ${pills(G.shares, "s", x => Math.round(x * 100) + "%")}</div></details></div>`;
  $$("#app .s-pills button").forEach(b => b.onclick = () => { V.plan[b.dataset.k] = +b.dataset.v; renderPlan(); });
  $("#lpd").onchange = e => { V.plan.lpd = Math.max(10, +e.target.value || 600); renderPlan(); };
  $("#days").onchange = e => { V.plan.days = Math.max(1, +e.target.value || 14); renderPlan(); };
}



/* ------------------------------------------------------------------ start here */
function renderHome() {
  stopV();
  const card = (key, ic, tone, t, b, go) => `<button class="s-card" data-go="${go}"><span class="s-ic ${tone}">${icon(ic, 26)}</span><span class="s-ct">${t}</span><span class="s-cb">${b}</span><span class="s-go">Open ${icon("fwd", 14)}</span></button>`;
  $("#app").innerHTML = `<div class="s-wrap">
    <h1 class="s-h1">Did your test really win?</h1>
    <p class="s-lead">Picky judges an A/B test of two prompts (or any change) and answers in plain words: <b>ship it</b>, <b>stop it</b>, <b>let a person decide</b>, or <b>keep what you have</b>. It always says how sure it is, and it says so when it cannot tell.</p>
    <div class="f-grid" style="grid-template-columns:repeat(auto-fit,minmax(380px,1fr))">
      ${card("files", "check", "good", "Judge a test's results", "You have results from the voice platform. Picky checks the data and decides.", "files")}
      ${card("plan", "clock", "neutral", "Can my test finish?", "Before you start: how many leads and how many days you really need.", "plan")}
      ${card("try", "up", "warn", "Suggest a change worth testing", "Find a weak spot in the prompt, draft one small edit, and prove it.", "try")}
      ${card("trust", "link", "neutral", "Why trust it?", "What we measured against the usual shortcuts, and what is only simulated.", "trust")}
    </div>
    <div class="s-honest"><b>What is real, what is not.</b> The demos use <b>simulated</b> results with a known answer, so we can check the decision is right; call lengths come from 713 real recordings. The decision rules were tested on thousands of simulated tests. Machine labels of the real calls are provisional until a person checks a sample. Picky never claims that a real prompt is better without real results.</div>
    <p class="s-foot">More: <button class="s-link" data-go="hear">Hear it</button> &middot; <button class="s-link" data-go="label">Label calls</button> &middot; <button class="s-link" data-go="exp">Technical view</button></p>
  </div>`;
  $$("#app [data-go]").forEach(b => b.onclick = () => go(b.dataset.go));
}

/* ------------------------------------------------------------------ results files: the voice test ran elsewhere, we judge it */
const FCOLS = [["lead_id", "who was called (a buyer id, phone or GLID)", "needed to count each lead once"], ["variant", "A or B (also control / test)", "needed, or send A and B as two files"],
  ["disposition", "what happened (e.g. buylead_created)", "needed, or a 0/1 goal column"], ["timestamp", "when the call started", "to read results day by day"],
  ["duration_s", "call length in seconds", "for the handling-time guardrail"], ["call_id, connected", "optional", "removes repeats; counts connected leads only"]];
function renderFiles() {
  stopV(); V.back = "files";
  const demo = D.files_demo || [];
  const cardsF = demo.map(x => { const k = "file_" + x.key, p = PICK[k] || { title: x.title, blurb: x.note, tone: "neutral", ic: "approx" };
    return `<button class="s-card" data-fkey="${x.key}"><span class="s-ic ${p.tone}">${icon(p.ic, 26)}</span><span class="s-ct">${esc(p.title)}</span><span class="s-cb">${esc(p.blurb)}</span><span class="s-go">Decide from this file ${icon("fwd", 14)}</span></button>`; }).join("");
  $("#app").innerHTML = `<div class="s-wrap">
    <h1 class="s-h1">Judge a test that ran somewhere else</h1>
    <p class="s-lead">The voice calls themselves are made by the voice platform, not by Picky. Give Picky the <b>results</b>: one row per call, saying which prompt served it and what happened. Picky checks the files, then decides with the rules we proved: <b>ship B, stop B, hold for a person, or keep A</b>.</p>
    <div class="s-honest" style="margin-top:0"><b>These example files are synthetic.</b> They were generated from a known truth, with real call lengths, so we can check that the decision is right. They say nothing about how a real prompt performs.</div>
    <div class="f-grid">${cardsF}</div>
    <div class="s-panel" style="margin-top:22px"><h2 class="s-h2">Use your own files</h2>
      ${LIVE ? `<p class="s-sm">Pick one file with a variant column, or two files (A's results and B's). CSV, tab-separated or JSON; column names are matched flexibly.</p>
      <div class="f-form">
        <div class="field"><label>Results file(s)</label><input type="file" id="ff" multiple accept=".csv,.tsv,.txt,.json,.jsonl"></div>
        <div class="field" id="finfo" style="grid-column:1/-1" hidden></div>
        <div class="field"><label>If you chose two files <span class="hint">which one is A?</span></label><select id="fa"><option value="">One file with a variant column</option><option value="first">First file = A, second = B</option></select></div>
        <div class="field"><label>Which outcomes count as the goal? <span class="hint">comma separated</span></label><input type="text" id="fg" placeholder="buylead_created"></div>
        <div class="field"><label>Share of traffic sent to B <span class="hint">required</span></label><input type="number" step="0.05" id="fs" value="0.30"></div>
        <div class="field"><label>Expected rate under A <span class="hint">required: it fixes the plan</span></label><input type="number" step="0.01" id="fb" value="0.45"></div>
        <div class="field"><label>Smallest lift worth detecting</label><input type="number" step="0.01" id="fm" value="0.05"></div>
        <div class="field"><label>Test length (days) <span class="hint">required</span></label><input type="number" id="fw" value="14"></div>
        <div class="field"><label>Decision rule</label><select id="fr"><option value="sequential">Sequential: early promote, early stop (default)</option><option value="final_look">One winner call at the end + strict daily harm check</option></select></div>
        <div class="field"><label>Early hang-up guardrail <span class="hint">calls shorter than (seconds), limit +2 points</span></label><input type="number" id="fh" placeholder="off"></div>
      </div>
      <div style="margin-top:14px"><button class="s-btn" id="fgo">Decide</button><span class="f-err" id="ferr"></span></div>`
      : `<p class="s-sm">Uploading your own files needs the live engine: run <code>python -m canary serve</code>. The examples above work offline.</p>`}
    </div>
    <details class="s-how"><summary>What should the files look like?</summary><table class="f-cols"><thead><tr><th>Column</th><th>What it is</th><th>Why</th></tr></thead><tbody>${FCOLS.map(r => `<tr><td><code>${r[0]}</code></td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join("")}</tbody></table>
      <p class="s-sm" style="margin-top:8px">A daily summary also works: <code>date, variant, leads, goal_count</code> (plus <code>mean_duration, sd_duration</code> for the handling-time guardrail). It cannot show whether a lead saw both prompts.</p></details>
  </div>`;
  $$(".f-grid .s-card").forEach(b => b.onclick = () => { const x = demo.find(d => d.key === b.dataset.fkey); startFiles("file_" + x.key, x.record, x.meta); });
  const ff = $("#ff");
  if (ff) ff.onchange = async () => {                      // look inside the first file so the person can tick what counts as success
    const f = ff.files[0], box = $("#finfo"); if (!f) { box.hidden = true; return; }
    box.hidden = false; box.innerHTML = `<span class="s-sm">Looking at ${esc(f.name)}...</span>`;
    try {
      const r = await fetch("/api/inspect", { method: "POST", body: JSON.stringify({ name: f.name, text: await f.text() }) }); const j = await r.json();
      if (j.error) throw new Error(j.error);
      const vs = Object.entries(j.variants || {}).map(([k, n]) => `${esc(k)} (${nf(n)})`).join(", ");
      const outs = (j.outcomes || []).map(([k, n], i) => `<label class="cchip"><input type="checkbox" data-out="${esc(k)}" ${/buylead|lead_created|converted|success|meeting|enrich/i.test(k) ? "checked" : ""}> ${esc(k)} <span class="muted">${nf(n)}</span></label>`).join(" ");
      box.innerHTML = `<div class="more"><b>${nf(j.rows)} rows${j.leads ? `, ${nf(j.leads)} leads` : ""}${j.days ? `, ${j.days} days` : ""}.</b> Prompts found: ${vs || "none (use two files)"}.
        ${outs ? `<div style="margin-top:8px"><b>Which outcomes count as success?</b> Tick all that apply.</div><div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap">${outs}</div>` : `<div class="s-sm" style="margin-top:6px">No outcome column found: the file needs a 0/1 goal column.</div>`}
        ${j.lead_column ? "" : `<div class="s-sm" style="margin-top:6px;color:var(--warn-ink)">No lead id column: every call will count as its own lead, which makes results look surer than they are.</div>`}</div>`;
      const sync = () => { $("#fg").value = $$("#finfo [data-out]").filter(c => c.checked).map(c => c.dataset.out).join(","); };
      $$("#finfo [data-out]").forEach(c => c.onchange = sync); sync();
    } catch (e) { box.innerHTML = `<span class="f-err">${esc(String(e.message || e))}</span>`; }
  };
  const go1 = $("#fgo");
  if (go1) go1.onclick = async () => {
    const fl = [...$("#ff").files]; $("#ferr").textContent = "";
    if (!fl.length) { $("#ferr").textContent = "Choose a file first."; return; }
    if (!$("#fg").value.trim() && !/goal|convert|success/.test("")) { /* a 0/1 goal column is allowed; the engine will say if the goal is unclear */ }
    go1.textContent = "Deciding...";
    try {
      const two = $("#fa").value === "first" && fl.length === 2;
      const files = await Promise.all(fl.map(async (f, i) => ({ name: f.name, text: await f.text(), arm: two ? (i === 0 ? "A" : "B") : null })));
      const opts = { goal: $("#fg").value.trim(), share_b: +$("#fs").value || null, baseline: +$("#fb").value || null, mde: +$("#fm").value || 0.05, window_days: +$("#fw").value || null,
                     rule_set: $("#fr").value, guard_name: $("#fh").value ? "early_hangup" : "", guard_below_s: $("#fh").value ? +$("#fh").value : null, exp_id: "exp-files", name: "Results from " + fl.map(f => f.name).join(", ") };
      const r = await fetch("/api/decide", { method: "POST", body: JSON.stringify({ files, opts }) }); const j = await r.json();
      if (j.error) throw new Error(j.error);
      startFiles("file_upload", j.record, j.meta);
    } catch (e) { $("#ferr").textContent = String(e.message || e); go1.textContent = "Decide"; }
  };
}

/* ------------------------------------------------------------------ why trust it */
function renderTrust() {
  stopV(); const P = D.proof;
  if (!P) { $("#app").innerHTML = `<div class="s-wrap"><p class="s-lead">Run <code>python -m canary proof</code> to create the evidence, then rebuild.</p></div>`; return; }
  const S = P.scenarios, o = (k, m, x) => (S[k].methods[m].outcomes[x] || { rate: 0 }).rate;
  const pc = x => Math.round(x * 100) + "%", pc1 = x => (x * 100).toFixed(1) + "%";
  const expo = 1 - S.harm.methods.canary.mean_exposure_b / S.harm.methods.fixed_horizon.mean_exposure_b;
  const sp = P.split_accuracy.filter(x => x.n === 1037), st = P.stickiness;
  const card = (title, a, aLbl, b, bLbl, text) => `<div class="s-trust"><h3>${title}</h3><div class="s-vs"><div class="ours"><b>${a}</b><span>${aLbl}</span></div><div class="usual"><b>${b}</b><span>${bLbl}</span></div></div><p>${text}</p></div>`;
  $("#app").innerHTML = `<div class="s-wrap"><h1 class="s-h1">Why you can trust it</h1>
    <p class="s-lead">We tried Picky and the usual approaches on thousands of simulated tests where we know the right answer. Here is how often each gets it wrong.</p>
    <div class="s-trustgrid">
      ${card("It does not fall for lucky streaks", pc1(o("aa", "canary", "PROMOTE")), "Picky", pc(o("aa", "naive_peek", "PROMOTE")), "usual tools", "When nothing really changed, how often a fake winner is announced.")}
      ${card("It notices when the test is broken", pc(o("srm_bug", "canary", "PROMOTE")), "Picky", pc(o("srm_bug", "naive_peek", "PROMOTE")), "usual tools", "How often a prompt is rolled out even though call tracking was losing calls.")}
      ${card("It protects buyers from a bad prompt", nf(S.harm.methods.canary.mean_exposure_b), "buyers", nf(S.harm.methods.fixed_horizon.mean_exposure_b), "fixed-length test", `Buyers who hear a worse prompt before it is stopped: ${pc(expo)} fewer.`)}
      ${card("A buyer always gets the same prompt", "0", "Picky", pc(st.naive_random.flip_rate), "random per call", "Buyers who heard a different prompt on a repeat call.")}
    </div>
    <div class="s-honest"><b>Be clear about what is simulated.</b> These tests use simulated call outcomes with a known answer. Call lengths come from your 713 real recordings. The real-call numbers on the first tab come from Sarvam's tagging of ${nf((D.fix && D.fix.mine && D.fix.mine.n_calls) || 0)} recordings; those labels have not all been checked by a person yet, so how accurate they are is measured only once the 40-call spot-check is done.</div>
    <p class="s-foot">Every number comes from code you can re-run with one command. <button class="s-link" id="adv">Technical details</button></p></div>`;
  $("#adv").onclick = () => go("proof");
}

/* ------------------------------------------------------------------ label calls */
function autoPanel() {
  const a = D.auto || {}, st = a.status || {}, q = a.queue || {}, r = a.report || {};
  if (!st.transcripts && !st.tagged_valid) return `<div class="s-honest"><b>Machine labelling has not started yet.</b> Sarvam will transcribe a random sample of the calls and tag each one, then you only spot-check about 40. ${a.key_present ? "A Sarvam key is set." : "It needs the Sarvam key in <code>canary/.env</code> first."}</div>`;
  const rate = r.buylead_rate_loose || r.buylead_rate_machine, acc = r.tagger_vs_human_blind;
  const prov = r.provisional ? `<div class="s-honest" style="margin-top:14px"><b>These labels were made before the real VANI prompt arrived.</b> They use an older vocabulary (for example a timeline field and a read-back check that the real prompt does not have). Re-tagging the saved transcripts with IndiaMART's quality matrix costs about ${inr((((D.fix || {}).costs || {}).retag || {}).est_inr || 23)} and takes about 20 minutes: <code>python -m canary autolabel retag --yes --budget N</code>. Not run yet.</div>` : "";
  return prov + `<div class="s-trust" style="margin-top:20px"><h3>Machine labelling so far</h3><div class="s-vs"><div class="ours"><b>${nf(st.tagged_valid || 0)}</b><span>calls tagged by Sarvam</span></div><div class="usual"><b>${rate ? Math.round(rate.rate * 100) + "%" : "-"}</b><span>captured quantity and specification${rate ? ` (range ${Math.round(rate.ci[0] * 100)}-${Math.round(rate.ci[1] * 100)}%)` : ""}</span></div></div><p>Credits used so far: about Rs ${(st.estimated_spend_inr || 0).toFixed(0)}. ${acc ? `Checked by a person on ${acc.n} random calls: the machine was right ${Math.round(acc.accuracy * 100)}% of the time.` : q.blind ? `Waiting for a person to check ${q.blind + (q.hard || 0)} calls.` : "Next: pick the calls a person should check."}</p>${r.rich ? `<p style="color:var(--ink-2);font-size:14.5px">Also found: <b>${Math.round(r.rich.bot_issue_rate * 100)}%</b> of calls have at least one bot issue; ${Object.keys(r.rich.bot_issue_counts || {}).length ? "most common: <b>" + String(Object.keys(r.rich.bot_issue_counts)[0]).replace(/_/g, " ") + "</b>." : "none so far."}</p>` : ""}</div>`;
}

function renderLabelPage() {
  stopV();
  $("#app").innerHTML = `<div class="s-wrap"><h1 class="s-h1">Help us check the system</h1>
    <p class="s-lead">Sarvam has labelled our recordings of VANI answering buyers whose seller was unavailable, but a machine can be wrong. Read a call and pick the outcome: did the buyer confirm a product requirement and did VANI take it forward (details captured, a live seller offered, or seller details promised)? You only spot-check about 40 calls, roughly 25 minutes. <b>Best done after the re-tag</b>, so your answers are compared with labels made under the real prompt.</p>
    ${autoPanel()}
    ${LIVE ? `<div class="card lab" id="lab" style="margin-top:20px"></div>` : `<div class="s-honest">Labelling needs the live version. In a terminal run <code>python -m canary serve</code> and open this page again.</div>`}</div>`;
  if (LIVE) renderLab();
}


/* ------------------------------------------------------------------ hear it (voice arena) */
function renderHear() {
  stopV(); const A = D.arena;
  if (!A || !(A.cases || []).length) { $("#app").innerHTML = `<div class="s-wrap"><h1 class="s-h1">Hear it</h1><p class="s-lead">The voice arena has not been generated yet. Run <code>python -m canary arena run --yes</code> (about Rs 16).</p></div>`; return; }
  const goal = k => goalName(k), nice = k => String(k || "").replace(/_/g, " ");
  const fieldsTxt = t => (t.fields || []).length ? t.fields.map(nice).join(", ") : "none";
  const fewer = A.cases.filter(c => c.B.lines.length < c.A.lines.length).length;
  const atLeast = A.cases.filter(c => ((c.B.tag || {}).fields || []).length >= ((c.A.tag || {}).fields || []).length).length;
  const fx = D.fix && D.fix.proposal;
  const listen = `${fx ? esc(fx.name) + ". " : ""}With the candidate VANI captured at least as many details in <b>${atLeast} of ${A.cases.length}</b> calls, and finished in fewer turns in <b>${fewer}</b>. Listen to how VANI handles a short or hurried buyer.`;
  const stale = A.stale ? `<div class="s-honest" style="margin-bottom:18px"><b>These calls used our earlier stand-in prompt, which turned out to be wrong about VANI</b> (it phoned the buyer; the real call is an inbound redirect: the buyer called a seller who was unavailable). They show Sarvam's voices, not VANI's real behaviour. To record them again with the real prompt: <code>python -m canary arena run --yes --force</code> (about ${inr(((D.fix || {}).costs || {}).arena ? D.fix.costs.arena.total_inr : 53)}).</div>` : "";
  const col = (c, arm) => { const x = c[arm], t = x.tag || {}; return `<div class="hear-col ${arm.toLowerCase()}">
      <div class="s-k"><span class="dot" style="background:var(--${arm === "A" ? "a" : "b"})"></span>${arm === "A" ? "Today's prompt" : "New prompt"}</div>
      <audio controls preload="none" src="${x.audio}"></audio>
      <div class="hear-facts"><span><b>${x.lines.length}</b> turns</span><span>Outcome: <b>${esc(goal(t.label))}</b></span><span>Details: <b>${esc(fieldsTxt(t))}</b></span>${t.bot_issues && t.bot_issues.length ? `<span class="warnchip">Issue: ${esc(t.bot_issues.map(nice).join(", "))}</span>` : ""}</div>
      <details class="s-how"><summary>Read the call</summary><div class="hear-tx">${x.lines.map(l => `<p><b>${l.speaker === "bot" ? "VANI" : "Buyer"}:</b> ${esc(l.text)}</p>`).join("")}</div></details></div>`; };
  $("#app").innerHTML = `<div class="s-wrap"><h1 class="s-h1">Hear the two prompts on the same buyer</h1>
    <p class="s-lead">Press play. VANI and the buyer are voiced by Sarvam's Bulbul, and the buyer is played by Sarvam's language model. Each call is then scored by the same tagger that labelled the real recordings.</p>
    ${stale}${A.stale ? "" : `<div class="s-usual" style="margin-bottom:18px"><div class="s-ut">What to listen for</div><p>${listen}</p></div>`}
    ${A.cases.map(c => `<section class="card" style="margin-bottom:16px"><h3>${esc(c.title)}</h3><div class="sub">${esc(c.brief)}</div><div class="hear-grid">${col(c, "A")}${col(c, "B")}</div></section>`).join("")}
    <div class="s-honest"><b>Be clear about what this is.</b> ${esc(A.note || "")} The statistical proof is in the A/B engine, not here.</div></div>`;
}
