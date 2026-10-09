"use strict";
/* Canary - the simple front door. Plain words, one question per screen, big pictures.
   Everything technical lives under "Advanced". Uses the same engine data as the advanced views. */

const V = { key: null, rec: null, meta: null, k: 1, timer: null, playing: false,
            plan: { lpd: 600, b: 0.45, m: 0.07, days: 14, s: 0.10 } };

const PICK = {
  fix_ships:      { title: "The fix works, so it ships", blurb: "The edit really helps. Canary proves it and rolls it out.", tone: "good", ic: "check" },
  fix_harms:      { title: "The fix backfires, so it is stopped", blurb: "The edit makes things worse. Canary pulls it early.", tone: "bad", ic: "x" },
  fix_flat:       { title: "The fix does almost nothing", blurb: "Too small to prove, so nothing changes.", tone: "neutral", ic: "approx" },
  b_wins:         { title: "The new prompt is better", blurb: "More buyers give their requirement.", tone: "good", ic: "check" },
  b_harmful:      { title: "The new prompt is worse", blurb: "Fewer buyers give their requirement.", tone: "bad", ic: "x" },
  inconclusive:   { title: "The change is too small to tell", blurb: "Hardly any real difference.", tone: "neutral", ic: "approx" },
  peeking_trap:   { title: "It only looks like a winner", blurb: "A lucky streak that is not real.", tone: "warn", ic: "alert" },
  srm_broken:     { title: "Something went wrong in the test", blurb: "The numbers cannot be trusted.", tone: "warn", ic: "link" },
  guardrail_veto: { title: "More leads, but calls run too long", blurb: "A win with a catch.", tone: "bad", ic: "clock" }
};

const stopV = () => { V.playing = false; clearInterval(V.timer); V.timer = null; };
const goalName = k => { const d = (D.dispositions || []).find(x => x.key === k); return d ? d.name : k.replace(/_/g, " "); };
const rate1 = x => (x * 100).toFixed(1) + "%";

/* ------------------------------------------------------------------ the fix journey (front door) */
const cards = list => list.map(s => { const p = PICK[s.meta.key] || { title: s.meta.title, blurb: "", tone: "neutral", ic: "approx" };
  return `<button class="s-card" data-key="${s.meta.key}"><span class="s-ic ${p.tone}">${icon(p.ic, 26)}</span><span class="s-ct">${esc(p.title)}</span><span class="s-cb">${esc(p.blurb)}</span><span class="s-go">Watch it ${icon("fwd", 14)}</span></button>`; }).join("");
const wire = () => $$(".s-card").forEach(b => b.onclick = () => startRun(b.dataset.key));
const pc0 = x => Math.round(x * 100) + "%";

function fixStep(n, title, body) { return `<section class="fx-step"><div class="fx-n">${n}</div><div class="fx-b"><h2 class="fx-t">${title}</h2>${body}</div></section>`; }

function fixFind(F) {
  const m = F.mine, I = k => m.issues.find(r => r.key === k) || {};
  const rows = m.issues.filter(r => r.eligible).sort((a, b) => b.calls - a.calls).slice(0, 3);
  const maxp = Math.max(...rows.map(r => r.pct_of_connected));
  const verdict = r => r.key === m.target ? ["bad", "Costs the most leads"]
    : r.gap_pp < -5 ? ["neutral", "Common, but these calls do better"] : ["neutral", "No clear effect on leads"];
  const pm = I(m.pm_pick), tg = I(m.target);
  return fixStep(1, "Find what is really losing leads", `
    <p class="s-lead" style="margin-bottom:14px">We had Sarvam listen to <b>${nf(m.n_calls)} real VANI calls</b> and note what went wrong. About <b>${rate1(m.baseline.rate)}</b> of calls end with a usable requirement (quantity and specification), somewhere between ${pc0(m.baseline.ci[0])} and ${pc0(m.baseline.ci[1])}. So where do the other leads go?</p>
    <div class="fx-rows">${rows.map(r => { const v = verdict(r); return `<div class="fx-row ${r.key === m.target ? "hit" : ""}">
      <div class="fx-name"><b>${esc(r.name)}</b><span>${esc(r.meaning)}</span></div>
      <div class="fx-bar" title="${nf(r.calls)} of ${nf(m.n_connected)} answered calls"><i style="width:${(r.pct_of_connected / maxp * 100).toFixed(0)}%"></i><em>${pc0(r.pct_of_connected)} of calls</em></div>
      <div class="fx-conv"><span><b>${pc0(r.converted_with)}</b> become BuyLeads with this</span><span><b>${pc0(r.converted_without)}</b> without it</span></div>
      <span class="chip ${v[0] === "bad" ? "bad" : ""}">${v[1]}</span></div>`; }).join("")}</div>
    <div class="s-usual"><div class="s-ut">Why we do not just fix the most common problem</div>
      <p>A tool that counts failures would pick <b>&ldquo;${esc(pm.name || "")}&rdquo;</b>, the biggest group among calls that did not convert (${nf(pm.failed_calls || 0)} calls). But calls with it convert <b>better</b>, ${pc0(pm.converted_with || 0)} against ${pc0(pm.converted_without || 0)}, so fixing it would recover nothing. Canary compares the calls that convert with the ones that do not, and picks <b>&ldquo;${esc(tg.name || "")}&rdquo;</b>: ${pc0(tg.converted_with || 0)} against ${pc0(tg.converted_without || 0)}. Removing it completely could add up to about <b>${tg.ceiling_pp} more BuyLeads per 100 calls</b>.</p></div>
    <p class="s-sm" style="margin-top:10px">These tags are written by Sarvam's AI and have not all been checked by a person yet. They show where to look. The live test in step 4 is what proves cause.</p>`);
}

function fixDraft(F) {
  const P = F.proposal;
  if (!P) return fixStep(2, "Let Sarvam draft the fix", `<div class="s-honest">No fix has been drafted yet. Run <code>python -m canary fix propose --yes</code> (about Rs 0.05).</div>`);
  const line = l => { const c = l[0] === "+" ? "add" : l[0] === "-" ? "del" : "ctx"; return `<div class="fx-l ${c}"><i>${c === "add" ? "+" : c === "del" ? "&minus;" : ""}</i><span>${esc(l.slice(1).replace(/^\s?/, ""))}</span></div>`; };
  const body = (P.diff || []).filter(l => !/^(---|\+\+\+|@@)/.test(l));
  return fixStep(2, "Sarvam drafts one small fix", `
    <p class="s-lead" style="margin-bottom:14px">Sarvam's language model read the ${nf(P.evidence.calls_with_issue)} calls with this problem, the measured pattern, and VANI's current instructions. It drafted <b>one line</b>:</p>
    <div class="fx-diff" role="group" aria-label="The change to VANI's instructions">${body.map(line).join("")}</div>
    <div class="fx-meta"><div><span class="s-ut">What it is meant to do</span><p>${esc(P.why)}</p></div><div><span class="s-ut">The risk Sarvam flagged</span><p>${esc(P.risk)}</p></div></div>
    <p class="s-sm">Drafted by ${esc(P.model)}. It costs about Rs 0.05 and goes into the test record with the evidence behind it. A person can edit or reject it before the test starts.</p>`);
}

function fixPrecheck(F) {
  const S = F.prescreen;
  if (!S) return fixStep(3, "Pre-check it on simulated buyers", `<div class="s-honest">Not run yet. Run <code>python -m canary fix prescreen --yes</code> (about Rs 10).</div>`);
  const ok = S.passed, A = S.A, B = S.B, n = S.n_pairs;
  const chk = (good, txt) => `<li class="${good ? "ok" : "no"}">${icon(good ? "check" : "x", 16)}<span>${txt}</span></li>`;
  return fixStep(3, "Pre-check it on simulated buyers", `
    <p class="s-lead" style="margin-bottom:14px">Before any real buyer hears it, ${n} simulated buyers (different moods, products and languages, played by Sarvam's model) talk to VANI twice: once with today's prompt, once with the fix. Sarvam's tagger scores every call.</p>
    <div class="s-two">
      <div class="s-tile a"><div class="s-k"><span class="dot" style="background:var(--a)"></span>Today's prompt</div><div class="s-big">${A.converted}<small> of ${n}</small></div><div class="s-sm">simulated buyers gave a usable requirement</div></div>
      <div class="s-tile b"><div class="s-k"><span class="dot" style="background:var(--b)"></span>With the fix</div><div class="s-big">${B.converted}<small> of ${n}</small></div><div class="s-sm">simulated buyers gave a usable requirement</div></div>
    </div>
    <ul class="fx-checks">
      ${chk(S.checks.conversion, `Usable requirements are not lower (${A.converted} vs ${B.converted})`)}
      ${chk(S.checks.fatal, `No more failed calls (${A.fatal} vs ${B.fatal})`)}
      ${chk(S.checks.turns, `Calls are not longer (${A.bot_turns} vs ${B.bot_turns} bot turns on average)`)}
    </ul>
    <p class="s-sm" style="margin:0 0 10px">Abrupt endings seen: <b>${A.target_issue}</b> with today's prompt, <b>${B.target_issue}</b> with the fix (${n} calls each).${A.target_issue === 0 && B.target_issue === 0 ? " The simulated VANI never ended a call abruptly under either prompt, and the two prompts converted almost the same number of buyers, so this step cannot tell them apart. It checks the fix does no harm; it does not show a gain." : ""}</p>
    <p><span class="chip ${ok ? "good" : "bad"}">${ok ? "Passed: no sign of harm, so it goes to a live test" : "Held back: it looks worse, so it does not reach real buyers"}</span> <button class="s-link" id="hearlink">Listen to the calls</button></p>
    <p class="s-sm">Be clear: ${n} simulated buyers cannot prove an improvement. This step only keeps a clearly worse edit away from real buyers. The pass rule was fixed in the code before the run.</p>`);
}

function fixProve(F) {
  const P = F.plan, fx = D.scenarios.filter(s => s.meta.key.startsWith("fix_")), rest = D.scenarios.filter(s => !s.meta.key.startsWith("fix_"));
  return fixStep(4, "Prove it on live traffic, then roll it out", `
    ${P ? `<p class="s-lead" style="margin-bottom:14px">To be sure of a lift of ${(P.mde * 100).toFixed(0)} points (${rate1(P.baseline)} to ${rate1(P.baseline + P.mde)}), Canary needs about <b>${nf(P.n_max)} calls</b>. At ${nf(P.leads_per_day)} calls a day with half of them on the fix, that is about <b>${Math.ceil(P.days_needed)} days</b>. Canary checks after every batch and acts the moment the evidence is strong, so it can finish sooner.</p>` : ""}
    <p class="s-sm" style="margin:0 0 14px">Pick what the fix really does and watch Canary find out. These are simulations with a known answer, so you can see it get each one right.</p>
    <div class="s-cards">${cards(fx)}</div>
    <details class="s-how"><summary>More situations Canary handles</summary><div class="s-cards" style="margin-top:14px">${cards(rest)}</div></details>`);
}

function renderTry() {
  stopV();
  if (V.key) return renderRun();
  const F = D.fix;
  if (!F || !F.mine || !F.mine.issues.length) {                         // no labels yet: the plain scenario picker
    $("#app").innerHTML = `<div class="s-wrap"><h1 class="s-h1">Test a prompt change safely</h1><p class="s-lead">Canary tries a new prompt on a few buyers and tells you, in plain words, whether to roll it out. Pick a situation to watch it work.</p><div class="s-cards">${cards(D.scenarios)}</div></div>`;
    return wire();
  }
  $("#app").innerHTML = `<div class="s-wrap">
    <h1 class="s-h1">The bot finds its own weak spot, fixes it, and proves the fix</h1>
    <p class="s-lead">Four steps, using VANI's real calls. Nothing reaches a buyer until the evidence says it is safe.</p>
    <div class="fx">${fixFind(F)}${fixDraft(F)}${fixPrecheck(F)}${fixProve(F)}</div>
    <p class="s-foot">Every step, including the evidence behind the fix, is saved in a tamper-proof record. <button class="s-link" id="totrust">Why you can trust the result</button></p></div>`;
  wire();
  const h = $("#hearlink"); if (h) h.onclick = () => go("hear");
  $("#totrust").onclick = () => go("trust");
}

function startRun(key) {
  const sc = D.scenarios.find(s => s.meta.key === key); if (!sc) return;
  V.key = key; V.rec = sc.record; V.meta = sc.meta; V.k = 1;
  renderRun(); playV();
}

/* ------------------------------------------------------------------ the run screen */
function renderRun() {
  const rec = V.rec, c = rec.config, B = rec.variants.B, p = PICK[V.key] || { title: V.meta.title };
  $("#app").innerHTML = `<div class="s-wrap">
    <button class="s-back" id="sb">${icon("back", 14)} Pick another situation</button>
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
    <details class="s-how" id="how"><summary>How did Canary decide?</summary><div id="howbody"></div></details>
  </div>`;
  $("#sb").onclick = () => { V.key = null; renderTry(); };
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
  $("#na").textContent = `${nf(row.xA)} of ${nf(row.nA)} calls became a BuyLead`;
  $("#nb").textContent = `${nf(row.xB)} of ${nf(row.nB)} calls became a BuyLead`;
  $("#gauge").innerHTML = gauge(row);
  const pr = Math.min(1, row.n / rec.design.n_max);
  $("#pbar").style.width = (pr * 100) + "%";
  $("#plabel").textContent = `${nf(row.n)} of ${nf(rec.design.n_max)} planned calls`;
  let st;
  if (final) st = "Canary has made its decision.";
  else if (row.z > 1.2) st = "Leaning towards the new prompt, but not sure yet. Keep collecting calls.";
  else if (row.z < -1.2) st = "Leaning against the new prompt, but not sure yet. Keep collecting calls.";
  else st = "No clear difference yet. Too early to say, so Canary keeps collecting calls.";
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
    if (k === "fix_ships") return `A test that runs for a fixed length would wait for all <b>${nf(d.n_max)}</b> calls before deciding. Canary was sure after <b>${nf(r.calls_analysed)}</b>, so the fix reached everyone about <b>${Math.round((1 - r.calls_analysed / d.n_max) * 100)}%</b> sooner, without raising the chance of a false win.`;
    if (k === "fix_harms") return `A fixed-length test would have kept about <b>${nf(planB)}</b> buyers on the worse prompt until the end. Canary stopped after <b>${nf(r.exposed_b_calls)}</b>.`;
    return `With an effect this small, a tool that peeks every day would still announce a winner <b>${pc(o("aa", "naive_peek", "PROMOTE"))}</b> of the time even when nothing changed (in our tests). Saying &ldquo;we cannot tell&rdquo; is the honest answer, and the next edit gets its turn.`;
  }
  if (k === "peeking_trap") return `A usual tool that checks the numbers every day would have announced a winner after ${naive ? nf(naive.n) : "about 1,400"} calls and rolled it out. That would have been a mistake: there is no real difference. In our tests, usual tools make this mistake <b>${pc(o("aa", "naive_peek", "PROMOTE"))}</b> of the time. Canary: <b>${pc(o("aa", "canary", "PROMOTE"))}</b>.`;
  if (k === "srm_broken") return `A usual tool would have rolled this out, because the new prompt looked ${((V.rec.looks[V.rec.looks.length - 1].diff) * 100).toFixed(1)} points better. In our tests it does so <b>${pc(o("srm_bug", "naive_peek", "PROMOTE"))}</b> of the time. Canary caught the problem and stopped: it rolls out a broken test only <b>${pc(o("srm_bug", "canary", "PROMOTE"))}</b> of the time.`;
  if (k === "guardrail_veto") return `A tool that only watches BuyLead conversion would have rolled this out (<b>${pc(o("guardrail", "naive_peek", "PROMOTE"))}</b> of the time in our tests). Canary also checks average handling time, so it did not.`;
  if (k === "b_harmful") return `A test that runs for a fixed length keeps sending buyers to a worse prompt until the end: about <b>${nf(S.harm.methods.fixed_horizon.mean_exposure_b)}</b> buyers on average, against <b>${nf(S.harm.methods.canary.mean_exposure_b)}</b> with Canary.`;
  if (k === "b_wins") return `A fixed-length test needs about <b>${nf(S.win.methods.fixed_horizon.median_n_when_promoted)}</b> calls before it can decide. Canary typically decides after <b>${nf(S.win.methods.canary.median_n_when_promoted)}</b>.`;
  if (k === "inconclusive") return `With an effect this small, some tools would still announce a winner (<b>${pc(o("small", "naive_peek", "PROMOTE"))}</b> of the time in our tests). Saying &ldquo;we cannot tell&rdquo; is the honest answer.`;
  return "";
}

function B_origin() {
  const b = V.rec.variants.B;
  if (b.origin !== "ai-mined") return "";
  const f = (D.fix || {}).proposal, e = f ? f.evidence : null;
  return `<p class="s-next" style="margin-bottom:8px"><b>Where the fix came from:</b> Sarvam drafted it from ${e ? nf(e.calls_with_issue) : "the"} real calls with &ldquo;${esc(e ? e.issue_name.toLowerCase() : "this problem")}&rdquo;. That evidence is the first entry in the record.</p>`;
}

function resultCard() {
  const rec = V.rec, res = rec.result, last = rec.looks[rec.looks.length - 1], c = rec.config, g = last.guardrail;
  const pts = ((last.rateB - last.rateA) * 100), exp = res.exposed_b_calls, days = Math.max(1, Math.ceil((new Date(last.time) - new Date(c.start)) / 86400000));
  const T = {
    PROMOTE: ["good", "check", "The new prompt is better. It is now rolled out to everyone.",
      `It turns ${rate1(last.rateB)} of calls into BuyLeads against ${rate1(last.rateA)} today (${pts >= 0 ? "+" : ""}${pts.toFixed(1)} points)${g ? ", and average handling time stayed within the safe limit" : ""}. The evidence was strong enough to be sure it is not luck.`, "All buyers now get the new prompt."],
    STOP_HARM: ["bad", "x", "The new prompt is worse, so Canary stopped it early.",
      `It turned only ${rate1(last.rateB)} of calls into BuyLeads against ${rate1(last.rateA)} today. Only ${nf(exp)} buyers ever heard it.`, "Everyone is back on today's prompt."],
    INCONCLUSIVE: ["neutral", "approx", "No real difference was found, so nothing changes.",
      `After the full test the two prompts look the same (${rate1(last.rateB)} vs ${rate1(last.rateA)}). Canary will not roll out a change it cannot prove.`, "Today's prompt stays."],
    HALT_SRM: ["warn", "link", "The test itself broke, so nothing was rolled out.",
      `The new prompt looked ${pts.toFixed(1)} points better, but calls from one group were going missing from the records, so the numbers cannot be trusted. Fix the tracking, then run the test again.`, "Everyone is on today's prompt."],
    STOP_GUARDRAIL: ["bad", "clock", "More BuyLeads, but calls run too long, so it was stopped.",
      `The new prompt makes more BuyLeads (${rate1(last.rateB)} vs ${rate1(last.rateA)}) but average handling time is ${g ? (g.worse * 100).toFixed(0) : "much"}% longer. The limit is ${(c.guardrail_margin * 100).toFixed(0)}%.`, "Everyone is back on today's prompt."],
    NO_PROMOTE_GUARDRAIL: ["warn", "alert", "More BuyLeads, but not proven safe, so it was not rolled out.", "Handling time could not be shown to stay within the limit.", "Today's prompt stays."]
  }[res.kind] || ["neutral", "approx", res.kind, res.reason, ""];
  const ut = usualTool();
  const lenTxt = g ? `${g.worse >= 0 ? "+" : ""}${(g.worse * 100).toFixed(0)}% (limit +${(c.guardrail_margin * 100).toFixed(0)}%)` : "";
  return `<div class="s-result ${T[0]}"><div class="s-ric">${icon(T[1], 34)}</div><div>
    <div class="s-rt">${esc(T[2])}</div><p class="s-rd">${esc(T[3])}</p>
    <div class="s-facts"><span><b>${nf(last.n)}</b> calls tested</span><span><b>${nf(exp)}</b> buyers heard the new prompt</span><span><b>${days}</b> day${days > 1 ? "s" : ""}</span>${g ? `<span>Handling time <b>${esc(lenTxt)}</b></span>` : ""}</div>
    ${B_origin()}
    <p class="s-next"><b>What happens next:</b> ${esc(T[4])} Every step is saved in a tamper-proof record.</p></div></div>
    ${ut ? `<div class="s-usual"><div class="s-ut">Why this matters</div><p>${ut}</p></div>` : ""}`;
}

function renderHow() {
  const c = V.rec.config;
  $("#howbody").innerHTML = `<ol class="s-steps">
    <li><b>Fair split.</b> ${pct(c.share_b, 0)} of buyers hear the new prompt. A buyer always gets the same prompt, every time they phone, so the test is not muddied.</li>
    <li><b>Check as we go.</b> After every batch of calls, Canary asks: is the new prompt clearly better, clearly worse, or still unclear? The coloured zones on the gauge are those answers.</li>
    <li><b>Be sure before acting.</b> Canary only acts when luck is very unlikely to explain the result. Because it plans for repeated checking, it cannot be fooled by a lucky streak.</li>
    <li><b>Safety checks.</b> It also watches average handling time and whether call tracking is healthy. Any problem stops the rollout.</li></ol>
    <button class="s-link" id="tech">See the technical view of this test</button>`;
  $("#tech").onclick = () => { S.key = V.key; S.rec = null; go("exp"); };
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
  if (f >= 1) { tone = "good"; head = "Yes, this test can give you a clear answer."; body = `You need about ${nf(c.n_max)} calls, which is roughly ${days} day${days > 1 ? "s" : ""} of your traffic. If the new prompt really is ${(p.m * 100).toFixed(0)} points better, there is about a ${Math.round(power * 100)}% chance Canary will spot it.`; }
  else if (power >= 0.65) { tone = "warn"; head = "Maybe. It could work, but it is tight."; body = `You need about ${nf(c.n_max)} calls (${days} days). In ${p.days} days you would have ${Math.round(f * 100)}% of that, so the chance of spotting a real improvement drops to about ${Math.round(power * 100)}%.`; }
  else { tone = "bad"; head = "Not as set. This test would probably end with no answer."; body = `You need about ${nf(c.n_max)} calls (${days} days at your traffic), but ${p.days} days only gives ${Math.round(f * 100)}% of that. The chance of spotting a real improvement would be just ${Math.round(power * 100)}%.`; }
  let tip = "";
  if (f < 1) {
    const alt = G.shares.map(s => cell(p.b, p.m, s)).filter(Boolean).find(cc => { const ff = Math.min(1, cap / cc.n_max), k = fkey(ff); return ff >= 1 || (k && cc.power_at[k] >= 0.8); });
    tip = alt ? `Tip: send ${Math.round(alt.share * 100)}% of buyers to the new prompt and this test fits in ${p.days} days.` : `Tip: run the test for about ${days} days, or try a bigger improvement.`;
  }
  const pills = (arr, key, fmt) => `<span class="s-pills">${arr.map(x => `<button data-k="${key}" data-v="${x}" aria-pressed="${x === p[key]}">${fmt(x)}</button>`).join("")}</span>`;
  $("#app").innerHTML = `<div class="s-wrap"><h1 class="s-h1">Can this test give a clear answer?</h1>
    <p class="s-lead">Fill in the sentence. Canary tells you before you start whether the test can work.</p>
    <div class="s-sentence">We handle <input type="number" id="lpd" value="${p.lpd}" min="10" step="50"> calls a day. Today, <span class="s-pills">${G.baselines.map(x => `<button data-k="b" data-v="${x}" aria-pressed="${x === p.b}">${Math.round(x * 100)}%</button>`).join("")}</span> of calls become a BuyLead. We care about an improvement of ${pills(G.mdes, "m", x => "+" + Math.round(x * 100) + (Math.round(x * 100) === 1 ? " point" : " points"))}. We can test for <input type="number" id="days" value="${p.days}" min="1" max="120"> days.</div>
    <div class="s-result ${tone}" style="margin-top:20px"><div><div class="s-rt">${head}</div><p class="s-rd">${body}</p>${tip ? `<p class="s-next"><b>${esc(tip)}</b></p>` : ""}</div></div>
    <details class="s-how"><summary>More options</summary><div style="padding-top:8px">Share of buyers who try the new prompt: ${pills(G.shares, "s", x => Math.round(x * 100) + "%")}</div></details></div>`;
  $$("#app .s-pills button").forEach(b => b.onclick = () => { V.plan[b.dataset.k] = +b.dataset.v; renderPlan(); });
  $("#lpd").onchange = e => { V.plan.lpd = Math.max(10, +e.target.value || 600); renderPlan(); };
  $("#days").onchange = e => { V.plan.days = Math.max(1, +e.target.value || 14); renderPlan(); };
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
    <p class="s-lead">We tried Canary and the usual approaches on thousands of simulated tests where we know the right answer. Here is how often each gets it wrong.</p>
    <div class="s-trustgrid">
      ${card("It does not fall for lucky streaks", pc1(o("aa", "canary", "PROMOTE")), "Canary", pc(o("aa", "naive_peek", "PROMOTE")), "usual tools", "When nothing really changed, how often a fake winner is announced.")}
      ${card("It notices when the test is broken", pc(o("srm_bug", "canary", "PROMOTE")), "Canary", pc(o("srm_bug", "naive_peek", "PROMOTE")), "usual tools", "How often a prompt is rolled out even though call tracking was losing calls.")}
      ${card("It protects buyers from a bad prompt", nf(S.harm.methods.canary.mean_exposure_b), "buyers", nf(S.harm.methods.fixed_horizon.mean_exposure_b), "fixed-length test", `Buyers who hear a worse prompt before it is stopped: ${pc(expo)} fewer.`)}
      ${card("A buyer always gets the same prompt", "0", "Canary", pc(st.naive_random.flip_rate), "random per call", "Buyers who heard a different prompt on a repeat call.")}
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
  return `<div class="s-trust" style="margin-top:20px"><h3>Machine labelling so far</h3><div class="s-vs"><div class="ours"><b>${nf(st.tagged_valid || 0)}</b><span>calls tagged by Sarvam</span></div><div class="usual"><b>${rate ? Math.round(rate.rate * 100) + "%" : "-"}</b><span>captured quantity and specification${rate ? ` (range ${Math.round(rate.ci[0] * 100)}-${Math.round(rate.ci[1] * 100)}%)` : ""}</span></div></div><p>Credits used so far: about Rs ${(st.estimated_spend_inr || 0).toFixed(0)}. ${acc ? `Checked by a person on ${acc.n} random calls: the machine was right ${Math.round(acc.accuracy * 100)}% of the time.` : q.blind ? `Waiting for a person to check ${q.blind + (q.hard || 0)} calls.` : "Next: pick the calls a person should check."}</p>${r.rich ? `<p style="color:var(--ink-2);font-size:14.5px">Also found: <b>${Math.round(r.rich.bot_issue_rate * 100)}%</b> of calls have at least one bot issue; ${Object.keys(r.rich.bot_issue_counts || {}).length ? "most common: <b>" + String(Object.keys(r.rich.bot_issue_counts)[0]).replace(/_/g, " ") + "</b>." : "none so far."}</p>` : ""}</div>`;
}

function renderLabelPage() {
  stopV();
  $("#app").innerHTML = `<div class="s-wrap"><h1 class="s-h1">Help us check the system</h1>
    <p class="s-lead">Sarvam has already labelled most of our 713 recordings of VANI phoning buyers, but a machine can be wrong. Listen to a short call and pick the outcome: did VANI get a usable requirement, so a BuyLead can be created? Sarvam labels most calls automatically; you only spot-check about 40 of them (read the transcript, click the outcome), roughly 25 minutes.</p>
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
  const listen = A.b_variant === "ai_fix" && fx
    ? `The fix adds one line to VANI's instructions: <b>&ldquo;${esc(fx.added[0].replace(/^-\s*/, ""))}&rdquo;</b> Listen for what VANI does when the buyer gives short answers or seems in a hurry. With the fix VANI captured at least as many details in <b>${atLeast} of ${A.cases.length}</b> calls.`
    : `The new prompt asks for quantity and delivery location in one question. It finished the same buyer in fewer turns in <b>${fewer} of ${A.cases.length}</b> cases.`;
  const col = (c, arm) => { const x = c[arm], t = x.tag || {}; return `<div class="hear-col ${arm.toLowerCase()}">
      <div class="s-k"><span class="dot" style="background:var(--${arm === "A" ? "a" : "b"})"></span>${arm === "A" ? "Today's prompt" : "New prompt"}</div>
      <audio controls preload="none" src="${x.audio}"></audio>
      <div class="hear-facts"><span><b>${x.lines.length}</b> turns</span><span>Outcome: <b>${esc(goal(t.label))}</b></span><span>Details: <b>${esc(fieldsTxt(t))}</b></span>${t.bot_issues && t.bot_issues.length ? `<span class="warnchip">Issue: ${esc(t.bot_issues.map(nice).join(", "))}</span>` : ""}</div>
      <details class="s-how"><summary>Read the call</summary><div class="hear-tx">${x.lines.map(l => `<p><b>${l.speaker === "bot" ? "VANI" : "Buyer"}:</b> ${esc(l.text)}</p>`).join("")}</div></details></div>`; };
  $("#app").innerHTML = `<div class="s-wrap"><h1 class="s-h1">Hear the two prompts on the same buyer</h1>
    <p class="s-lead">Press play. VANI and the buyer are voiced by Sarvam's Bulbul, and the buyer is played by Sarvam's language model. Each call is then scored by the same tagger that labelled the real recordings.</p>
    <div class="s-usual" style="margin-bottom:18px"><div class="s-ut">What to listen for</div><p>${listen}</p></div>
    ${A.cases.map(c => `<section class="card" style="margin-bottom:16px"><h3>${esc(c.title)}</h3><div class="sub">${esc(c.brief)}</div><div class="hear-grid">${col(c, "A")}${col(c, "B")}</div></section>`).join("")}
    <div class="s-honest"><b>Be clear about what this is.</b> ${esc(A.note || "")} The statistical proof is in the A/B engine, not here.</div></div>`;
}
