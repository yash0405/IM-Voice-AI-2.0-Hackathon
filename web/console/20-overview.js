/* Overview (BRD): top tiles, business impact, the live prompt, what needs attention, running tests, the traffic map, recent decisions, the scorecard, the top suggestion. */

const isDemoWorld = e => !isPast(e);
function totals() {
  const t = { run: 0, win: 0, stop: 0, inc: 0, held: 0, halted: 0, running: 0, alerts: 0, month: 0 };
  EXPS().forEach(e => { const v = view(e);
    if (v.scheduled) { t.running++; return; }
    if (v.running || v.d.paused && !v.ended) { t.running++; return; }
    if (v.kind === "HOLD_FOR_APPROVAL") { t.held++; return; }
    if (!v.ended) return;
    t.run++;
    if (isDemoWorld(e) && ["STOP_HARM", "STOP_GUARDRAIL", "HALT_SRM"].includes(v.kind)) t.alerts++;
    if (isDemoWorld(e) && v.res.time && v.res.time.startsWith("2026-10")) t.month++;
    if (v.kind === "PROMOTE" || v.kind === "ROLLED_BACK") t.win++;
    else if (v.kind === "STOP_HARM" || v.kind === "LOSS" || v.kind === "STOP_GUARDRAIL" || v.kind === "STOPPED_MANUAL") t.stop++;
    else if (v.kind === "INCONCLUSIVE" || v.kind === "REJECTED") t.inc++;
    else if (v.kind === "HALT_SRM") t.halted++;
  });
  return t;
}
function liftParts(v) {
  if (!v.cur) return ["-", "No results yet"];
  const r = liftRange(v.cur, v.config);
  if (v.config.metrics) return [fmtD(v.cur.diff, v.config, primaryDef(v.config).type === "average" ? 1 : 0), `${confOf(v.config)}% range ${rangeD(r.lo, r.hi, v.config, primaryDef(v.config).type === "average" ? 1 : 0)}${r.interim ? " (interim)" : ""}`];
  return [pts(v.cur.diff, 0), `${confOf(v.config)}% range ${sgn(r.lo * 100, 0)} to ${sgn(r.hi * 100, 0)} pp${r.interim ? " (interim)" : ""}`];
}
function advance(e, n = 1) {
  const v = view(e); if (v.scheduled) { toast("This test is scheduled and has not started."); return false; } if (v.ended && !(v.d.paused)) return false;
  const d = dyn(e); if (d.paused) { toast("This test is paused. Resume it first."); return false; }
  const before = view(e); d.day = Math.min(before.ld, d.day + n); saveDyn();
  const after = view(e); if (!before.decided && after.decided) toast(`${e.record.config.name}: ${KIND_LABEL[after.kind] || after.kind}`);
  return true;
}

/** What the live prompt gained in the test that promoted it, against the base prompt that test compared it with. Lifts of different tests do not add (each B was
    compared with the base prompt, not with the previous live one), so only the latest all-traffic promotion is shown; winners' lifts run high, so the low end is shown too. */
function businessImpact() {
  const P = productionState(), live = P.live; if (!live.expView || !live.expId) return null;
  const e = byId(live.expId), c = e.record.config, r = dayRows(e.record).pop().row, lr = liftRange(r, c), sign = c.primary_direction === "lower" ? -1 : 1, rel = sign * (r.rateB / r.rateA - 1), low = sign > 0 ? lr.lo / r.rateA : -lr.hi / r.rateA;
  return { rel, low, goal: (C.metrics.find(m => m.key === c.primary_goal) || {}).name || "the goal", since: live.time, name: live.from, id: e.id, lower: sign < 0 };
}
/** Leads the plan needs. A test from the New Experiment page reads the same durationPlan as its Step 5 (B's leads / B's share, connected leads turned into attempted leads). */
function needLeads(e) {
  const c = e.record.config;
  if (c.metrics && c.rule_set === "final_look") { const d = primaryDef(c), P = durationPlan({ type: d.type, p: c.baseline, sd: c.primary_sd, lpd: 1000, share: c.share_b, d: c.mde, conf: 1 - 2 * c.alpha }); return Math.ceil(P.nB / c.share_b / Math.max(1e-9, connectShare())); }
  return c.rule_set === "final_look" ? e.record.design.n_fixed : e.record.design.n_max;
}

/** Each running test's slice of today's traffic: outside the test, A inside it, B. */
function trafficRow(e) { const c = e.record.config, s = segShare(c.segment); return { name: c.name, out: 1 - s, a: s * (1 - c.share_b), b: s * c.share_b, seg: c.segment, e }; }
function trafficMap(list) {
  if (!list.length) return `<div class="empty">No test is running, so all traffic hears today's prompt.</div>`;
  const bar = r => { const seg = (cls, w, label) => `<span class="tm ${cls}" style="flex:${Math.max(w, 0.0001)}" title="${esc(label)}: ${pct(w, 1)}">${w >= 0.11 ? `${esc(label)} ${pct(w, 0)}` : ""}</span>`;
    return `<div class="tmrow"><div class="tmname"><a href="#/live/${encodeURIComponent(r.e.id)}">${esc(r.name)}</a> ${segChips(r.seg)}</div><div class="tmap" role="img" aria-label="${esc(r.name)}: ${pct(r.out, 0)} outside the test, ${pct(r.a, 0)} A, ${pct(r.b, 0)} B">${seg("out", r.out, "outside")}${seg("a", r.a, "A")}${seg("b", r.b, "B")}</div></div>`; };
  const main = list.filter(r => r.e.world === "main"), clash = main.flatMap((x, i) => main.slice(i + 1).filter(y => segsOverlap(x.seg || {}, y.seg || {})).map(y => [x, y]));
  return `<div class="legend" style="margin-bottom:8px"><span><i class="sw out"></i>outside the test (today's prompt)</span><span><i class="sw a"></i>A inside the test</span><span><i class="sw b"></i>B inside the test</span></div>${list.map(bar).join("")}
    ${clash.length ? `<div class="banner neg" style="margin-top:12px"><div><b>Overlap.</b> ${clash.map(([x, y]) => `${esc(x.name)} and ${esc(y.name)}`).join("; ")} include some of the same leads, so their results interfere. Finish one first.</div></div>` : `<p class="note" style="margin-top:8px">Each test replays the same history on its own, so each bar shows how that test splits its own traffic. Launches from New Experiment are checked for overlap: two tests may not include the same leads at once.</p>`}`;
}

/** A and B as two small bars. Grey until the engine decides: early numbers swing, and acting on them is the peeking trap the engine prevents. */
function abBars(v) {
  if (!v.cur) return `<div class="note">No results yet</div>`;
  const c = v.config, avg = primaryDef(c).type === "average", top = Math.max(v.cur.rateA, v.cur.rateB, 1e-9), w = x => Math.max(2, (avg ? x / top : x) * 100);
  const bar = arm => `<div class="abrow"><span class="ab-k">${arm}</span><span class="ab-bar"><i class="${v.decided ? arm.toLowerCase() : "grey"}" style="width:${w(v.cur["rate" + arm])}%"></i></span><span class="ab-v">${fmtP(v.cur["rate" + arm], c)}</span></div>`;
  return `<div class="ab" title="${v.decided ? `${goalName(c)}: the engine's final numbers` : `${goalName(c)} so far. Grey until the engine decides: do not act on early numbers.`}">${bar("A")}${bar("B")}</div>`;
}
function runningCard(e) {
  const v = view(e), c = v.config, link = `#/live/${encodeURIComponent(e.id)}`, held = v.kind === "HOLD_FOR_APPROVAL" && !v.d.approval;
  return `<div class="card rcard"><div class="rc-top"><a href="${link}">${esc(c.name)}</a>${statusPill(v)}</div>
    ${segRules(c.segment).length ? `<div>${segChips(c.segment)}</div>` : ""}
    <div><div class="rc-day"><span>Day <b>${v.day}</b> of ${v.win}</span><span class="note">${v.scheduled ? "scheduled" : held ? "waiting for a yes" : `final call on day ${v.win}`}</span></div><div class="bar"><i style="width:${Math.min(100, v.day / v.win * 100)}%"></i></div></div>
    ${abBars(v)}
    <div class="actions">${held ? `<a class="btn sm primary" href="${link}">Decide</a>` : `<a class="btn sm" href="${link}">Open</a>`}${v.running ? `<button class="btn sm" data-adv="${esc(e.id)}">Advance 1 day</button>` : ""}${v.scheduled ? `<a class="btn sm primary" href="${link}">Scheduled</a>` : ""}</div></div>`;
}

function attention() {
  const items = [], L = (e, txt) => `<a href="#/live/${encodeURIComponent(e.id)}">${esc(e.record.config.name)}</a> ${txt}`;
  EXPS().filter(isDemoWorld).forEach(e => { const v = view(e);
    if (v.kind === "HOLD_FOR_APPROVAL" && !v.d.approval) items.push(["Approval pending", "warn", L(e, `won on the goal but needs a yes.${AP().held ? ` If nobody answers within ${heldDays()} days, the autopilot keeps A.` : ""}`)]);
    else if (["STOP_HARM", "STOP_GUARDRAIL"].includes(v.kind)) items.push(["Harm alert", "neg", L(e, "was stopped: " + (v.kind === "STOP_HARM" ? "B was clearly worse." : "a guardrail was broken.") + " Its leads are back on A.")]);
    else if (v.kind === "HALT_SRM") items.push(["Split alert", "neg", L(e, "was halted: the split or the log is broken, so nothing can be trusted.")]);
    else if (v.running && v.day >= v.win - 1 && v.day < v.win) items.push(["Ending soon", "run", L(e, `reaches its final call on day ${v.win}.`)]);
    else if (v.running && v.cur && v.cur.z <= -1.96) items.push(["Watch", "warn", L(e, "looks worse so far. It stops only if it crosses the strict daily harm bar.")]);
    if (v.holdback && v.holdback.rows.some(r => r.alert)) items.push(["Holdback alert", "neg", L(e, "fell clearly below the held-back A after the promotion. Roll it back from Live Experiments (the autopilot's rollback is off).")]);
    else if (v.holdback && !v.holdback.done) items.push(["Holdback", "run", L(e, `is promoted; ${pct(v.holdback.all.share, 0)} of leads stay on A: day ${v.holdback.day} of ${v.holdback.all.days}.`)]);
  });
  DYN.drafts.forEach(d => items.push(["Draft", "plain", `<a href="#/new" data-open-draft="${esc(d.id)}">${esc(d.name)}</a> was saved but not launched.`]));
  return items;
}
/** Finished tests as one stacked bar: won, stopped, no clear winner. */
function scoreBar(t) {
  const other = t.inc + t.halted + t.held, seg = (k, cls, label) => k ? `<i class="${cls}" style="flex:${k}" title="${label}: ${k}"></i>` : "";
  return `<div class="stack" role="img" aria-label="${t.win} won, ${t.stop} stopped, ${other} with no clear winner">${seg(t.win, "pos", "Won")}${seg(t.stop, "neg", "Stopped")}${seg(other, "plain", "No clear winner or held")}</div>
    <div class="stack-legend"><span><i class="pos"></i>Won <b>${t.win}</b></span><span><i class="neg"></i>Stopped <b>${t.stop}</b></span><span><i class="plain"></i>No clear winner <b>${other}</b></span></div>`;
}
const tile = (k, v, d, cls = "") => `<div class="card kpi tile ${cls}"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d}</div></div>`;

ROUTES.overview = (el) => {
  const t = totals(), prod = productionState(), ev = allEvents().filter(x => x.type !== "Started" && x.id && byId(x.id) && !isPast(byId(x.id)) && !/^Production prompt /.test(x.text)).slice(0, 5), pr = C.proof, impact = businessImpact(), att = attention(), nPast = EXPS().filter(isPast).length;
  const live = EXPS().filter(e => { const v = view(e); return v.running || v.scheduled || v.d.paused && !v.ended || (v.kind === "HOLD_FOR_APPROVAL" && !v.d.approval); });
  const mapList = EXPS().filter(e => { const v = view(e); return !isPast(e) && (v.running || v.d.paused && !v.ended) && !v.scheduled; }).map(trafficRow);
  const sugg = (C.suggestions || []).filter(c => !c.disabled && !c.from_history && c.expected_pp).sort((a, b) => (!!b.variant - !!a.variant) || priority(b).score - priority(a).score)[0];   // an idea with a ready prompt edit starts in one click
  const scoreN = t.win + t.stop + t.inc + t.halted + t.held;
  el.innerHTML = head("Overview", "What is running, what needs you, and what Picky decided.", `${clockButtons()}<a class="btn" href="#/import">Import results</a><a class="btn primary" href="#/new">New experiment</a>`) + autopilotStrip() +
    `<div class="grid g4 tiles">${tile("Running tests", t.running, "live now")}${tile("Waiting for approval", t.held, t.held ? "needs a yes" : "nothing waiting", t.held ? "warn" : "")}${tile("Harm alerts", t.alerts, "stopped or halted", t.alerts ? "neg" : "")}${tile("Completed this month", t.month, "in this demo")}</div>
    ${att.length ? `<div class="card attn"><h2>Needs attention</h2><div class="attn-list">${att.map(([k, c, txt]) => `<div class="attn-row"><span>${pill(k, c)}</span><span>${txt}</span></div>`).join("")}</div></div>` : ""}
    <h2 class="sec-title">Running tests</h2>
    ${live.length ? `<div class="grid g3">${live.map(runningCard).join("")}</div>` : `<div class="empty">No tests are running. <a href="#/new">Start a new experiment</a> or pick an idea from <a href="#/suggest">Suggest A/B Tests</a>.</div>`}
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><div class="card-k">Live prompt</div><div class="lp"><span class="ver">${esc(prod.live.id)}</span><div><b>${esc(prod.live.name)}</b><div class="note">${prod.live.time ? "since " + esc(fdate(prod.live.time)) : "as received"}${prod.live.expId ? ` · from <a href="#/report/${encodeURIComponent(prod.live.expId)}">${esc(prod.live.from)}</a>` : ""} ${info("Fingerprint " + prod.live.hash)}</div></div></div>
        ${impact ? `<div class="impact"><span class="impact-v" style="color:${impact.rel > 0 ? "#167a70" : "var(--navy)"}">${sgn(impact.rel * 100, 1)}%</span><span>${esc(impact.goal)}${impact.lower ? " (lower is better)" : ""}<br><span class="note">at least ${sgn(impact.low * 100, 0)}% at the low end of the range ${info("Simulated, with a known injected effect; winners' lifts tend to run high. Gains of different tests are not added: each test compared its B with the base prompt.")}</span></span></div>` : `<p class="note" style="margin-top:12px">Business impact appears here once a winner is promoted.</p>`}
        <div class="actions" style="margin-top:12px"><a class="btn sm" href="#/library">Prompt Library</a></div></div>
      <div class="card"><div class="card-k">Scorecard <span class="note">${scoreN} decided tests (${nPast} are history samples)</span></div>${scoreBar(t)}<p class="note" style="margin-top:8px">Only tests played in this demo change the live prompt.</p></div></div>
    ${pr ? `<div class="card" style="margin-top:16px"><div class="sec-row"><div><h2>Why the verdicts can be trusted</h2><div class="sub">False winners when B is secretly identical to A (${nf(pr.runs)} simulated tests)</div></div><button class="btn" id="aa-run">Run 1,000 A vs A tests now</button></div>
      <div id="aa-chart" style="margin-top:8px"></div><div id="aa-out"></div>
      ${fold("The numbers", `<dl class="kv"><dt>Promoted although A = B</dt><dd><b>${pct(pr.final_look, 1)}</b>, range ${pct(pr.final_look_ci[0], 1)} to ${pct(pr.final_look_ci[1], 1)}; the target is 2.5% (one side of a 95% test)</dd><dt>Looks different either way</dt><dd><b>${pr.either != null ? pct(pr.either, 1) : "-"}</b>: promoted or logged as a loss (the BRD's "about 5%"); a loss ships nothing</dd><dt>A plain p &lt; 0.05 every day</dt><dd><b>${pct(pr.naive, 1)}</b> false winners; ${pct(pr.naive_wrong, 0)} counting false stops too</dd></dl><p class="note">Simulated, with a known answer. The engine's own study: <span class="mono">python -m canary proof</span>. The button runs the same rules in this browser, without the call-length guardrail.</p>`)}</div>` : ""}
    <div class="grid g2" style="margin-top:16px">
      <div>${fold("Traffic split today", trafficMap(mapList), `${mapList.length} running`)}${fold("Recent decisions", ev.length ? `<div class="ledger">${ev.map(x => `<div class="e"><span class="note">${esc(fdt(x.ts))}</span><span><b>${esc(x.type)}</b> · ${esc(x.exp)}<br><span class="muted">${esc(x.text.length > 140 ? x.text.slice(0, 137) + "..." : x.text)}</span></span></div>`).join("")}</div><div class="actions" style="margin-top:8px"><a class="btn sm" href="#/log">Open Decision Log</a></div>` : `<p class="note">No decisions yet in this demo. Press Next day or Play.</p>`, ev.length ? `${ev.length} latest` : "")}</div>
      ${sugg ? `<div class="card sugg1"><div class="card-k">Top suggestion</div><p><b>${esc(sugg.title)}</b></p><p class="note">${esc(sugg.hypothesis.length > 150 ? sugg.hypothesis.slice(0, 147) + "..." : sugg.hypothesis)}</p><div class="actions" style="margin-top:8px"><button class="btn primary sm" id="top-create">Create experiment</button><a class="btn sm" href="#/suggest">All ideas</a></div></div>` : ""}</div>`;
  bindClock(el);
  $$("[data-adv]", el).forEach(b => b.onclick = () => { const e = byId(b.dataset.adv); if (advance(e)) refresh(); });
  $$("[data-open-draft]", el).forEach(a => a.onclick = () => { const d = DYN.drafts.find(x => x.id === a.dataset.openDraft); if (d) WZ = { ...wzDefaults(), ...JSON.parse(JSON.stringify(d.w)) }; });
  const tc = $("#top-create"); if (tc) tc.onclick = () => createFrom(sugg);
  if (pr) aaChart($("#aa-chart"), pr.final_look, pr.naive);
  const ar = $("#aa-run"); if (ar) ar.onclick = () => { ar.disabled = true; ar.textContent = "Running..."; setTimeout(() => { const o = runAA(1000, Date.now() % 100000); aaChart($("#aa-chart"), o.promote / o.runs, o.naive / o.runs, `This run: ${nf(o.runs)} tests in this browser, seed ${o.seed}`); $("#aa-out").innerHTML = fold("This run, in detail", aaResult(o), "", false); ar.disabled = false; ar.textContent = "Run 1,000 A vs A tests again"; }, 30); };
};

/* ---- A vs A in the browser: the one-look rule on identical prompts, a thousand times. */
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function runAA(runs, seed) {
  const s = SET(), rnd = mulberry32(seed), p = s.baseline, days = s.window_days, per = s.leads_per_day, nb = Math.round(per * s.share_b), na = per - nb, minArm = s.min_leads_per_arm, alpha = (1 - s.confidence) / 2, z95 = normPpf(1 - alpha), zh = normPpf(1 - (1 - s.harm_bar));
  const out = { runs, promote: 0, loss: 0, early: 0, naive: 0, days, per, share: s.share_b, seed };
  const z = (xa, na_, xb, nb_) => { const q = (xa + xb) / (na_ + nb_), v = q * (1 - q) * (1 / na_ + 1 / nb_); return v > 0 ? (xb / nb_ - xa / na_) / Math.sqrt(v) : 0; };
  for (let r = 0; r < runs; r++) {
    let NA = 0, XA = 0, NB = 0, XB = 0, naiveHit = false;
    for (let d = 1; d <= days; d++) {
      for (let i = 0; i < na; i++) if (rnd() < p) XA++;
      for (let i = 0; i < nb; i++) if (rnd() < p) XB++;
      NA += na; NB += nb;
      const zz = z(XA, NA, XB, NB); if (NA >= 50 && NB >= 50 && zz >= 1.96) naiveHit = true;
      if (d < days) { if (NA >= minArm && NB >= minArm && zz <= -zh) { out.early++; break; } }
      else if (zz >= z95) out.promote++; else if (zz <= -z95) out.loss++;
    }
    if (naiveHit) out.naive++;
  }
  return out;
}
function aaResult(o) {
  const row = (label, k, note) => { const ci = wilson(k, o.runs); return `<tr><td>${label}</td><td class="num"><b>${pct(k / o.runs, 1)}</b></td><td class="num">${k} of ${nf(o.runs)}</td><td class="num">${pct(ci[0], 1)} to ${pct(ci[1], 1)}</td><td class="muted">${note}</td></tr>`; };
  return `<div class="tbl-wrap"><table><thead><tr><th>Outcome when A = B (${o.days} days, ${nf(o.per)} leads a day, ${pct(o.share, 0)} to B)</th><th class="num">Rate</th><th class="num">Runs</th><th class="num">95% range</th><th>Expected</th></tr></thead><tbody>
    ${row("Wrongly promoted (a false winner)", o.promote, "about 2.5%")}${row("Logged as a loss (nothing ships)", o.loss, "about 2.5%")}${row("Looks different either way", o.promote + o.loss, "about 5%: the BRD's figure")}${row("Stopped early by the daily harm check", o.early, `at most ${((o.days - 1) * 0.1).toFixed(1)}% over ${o.days - 1} daily checks (0.1% each)`)}${row("A plain p < 0.05 check every day would crown a winner", o.naive, "the peeking trap we avoid")}</tbody></table></div><p class="note" style="margin-top:4px">Seed ${o.seed}. Different seeds give slightly different numbers: that is chance, and the 95% ranges show how much.</p>`;
}
