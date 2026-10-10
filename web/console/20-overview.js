/* Overview: top tiles, what needs attention, running tests. (The live prompt, scorecard, A vs A proof, traffic split, recent decisions and top suggestion were taken off this page.) */

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

/** Leads the plan needs. A test from the New Experiment page reads the same durationPlan as its Step 5 (B's leads / B's share, connected leads turned into attempted leads). */
function needLeads(e) {
  const c = e.record.config;
  if (c.metrics && c.rule_set === "final_look") { const d = primaryDef(c), P = durationPlan({ type: d.type, p: c.baseline, sd: c.primary_sd, lpd: 1000, share: c.share_b, d: c.mde, conf: 1 - 2 * c.alpha }); return Math.ceil(P.nB / c.share_b / Math.max(1e-9, connectShare())); }
  return c.rule_set === "final_look" ? e.record.design.n_fixed : e.record.design.n_max;
}

/** A and B as two small bars. Grey until the engine decides: early numbers swing, and acting on them is the peeking trap the engine prevents. */
function abBars(v) {
  if (!v.cur) return `<div class="note">No results yet</div>`;
  const c = v.config, avg = primaryDef(c).type === "average", top = Math.max(v.cur.rateA, v.cur.rateB, 1e-9), w = x => Math.max(2, (avg ? x / top : x) * 100);
  const bar = arm => `<div class="abrow"><span class="ab-k">${arm}</span><span class="ab-bar"><i class="${v.decided ? arm.toLowerCase() : "grey"}" style="width:${w(v.cur["rate" + arm])}%"></i></span><span class="ab-v">${fmtP(v.cur["rate" + arm], c)}</span></div>`;
  return `<div class="ab" title="${v.decided ? `${goalName(c)}: the engine's final numbers` : `${goalName(c)} so far. Grey until the engine decides: do not act on early numbers.`}">${bar("A")}${bar("B")}</div>`;
}
function runningCard(e) {
  const v = view(e), c = v.config, link = `#/experiments/${encodeURIComponent(e.id)}`, held = v.kind === "HOLD_FOR_APPROVAL" && !v.d.approval;
  return `<div class="card rcard"><div class="rc-top"><a href="${link}">${esc(c.name)}</a>${statusPill(v)}</div>
    ${segRules(c.segment).length ? `<div>${segChips(c.segment)}</div>` : ""}
    <div><div class="rc-day"><span>Day <b>${v.day}</b> of ${v.win}</span><span class="note">${v.scheduled ? "scheduled" : held ? "waiting for a yes" : `final call on day ${v.win}`}</span></div><div class="bar"><i style="width:${Math.min(100, v.day / v.win * 100)}%"></i></div></div>
    ${abBars(v)}
    <div class="actions">${held ? `<a class="btn sm primary" href="${link}">Decide</a>` : `<a class="btn sm" href="${link}">Open</a>`}${v.scheduled ? `<a class="btn sm primary" href="${link}">Scheduled</a>` : ""}</div></div>`;
}

function attention() {
  const items = [], L = (e, txt) => `<a href="#/experiments/${encodeURIComponent(e.id)}">${esc(e.record.config.name)}</a> ${txt}`;
  EXPS().filter(isDemoWorld).forEach(e => { const v = view(e);
    if (v.kind === "HOLD_FOR_APPROVAL" && !v.d.approval) items.push(["Approval pending", "warn", L(e, `won on the goal but needs a yes.${canAutoKeepA(e) ? ` If nobody answers within ${heldDays()} days, the autopilot keeps A.` : ""}`)]);
    else if (["STOP_HARM", "STOP_GUARDRAIL"].includes(v.kind)) items.push(["Harm alert", "neg", L(e, "was stopped: " + (v.kind === "STOP_HARM" ? "B was clearly worse." : "a guardrail was broken.") + " Its leads are back on A.")]);
    else if (v.kind === "HALT_SRM") items.push(["Split alert", "neg", L(e, "was halted: the split or the log is broken, so nothing can be trusted.")]);
    else if (v.running && v.day >= v.win - 1 && v.day < v.win) items.push(["Ending soon", "run", L(e, `reaches its final call on day ${v.win}.`)]);
    else if (v.running && v.cur && v.cur.z <= -1.96) items.push(["Watch", "warn", L(e, "looks worse so far. It stops only if it crosses the strict daily harm bar.")]);
    if (v.holdback && v.holdback.rows.some(r => r.alert)) items.push(["Holdback alert", "neg", L(e, `fell clearly below the held-back A after the promotion. Roll it back from its page (${(e.record.tails || {}).auto_rollback ? "the autopilot's rollback is off" : "a person approved this win, so a person rolls it back"}).`)]);
    else if (v.holdback && !v.holdback.done) items.push(["Holdback", "run", L(e, `is promoted; ${pct(v.holdback.all.share, 0)} of leads stay on A: day ${v.holdback.day} of ${v.holdback.all.days}.`)]);
  });
  DYN.drafts.forEach(d => items.push(["Draft", "plain", `<a href="#/new" data-open-draft="${esc(d.id)}">${esc(d.name)}</a> was saved but not launched.`]));
  return items;
}
const tile = (k, v, d, cls = "") => `<div class="card kpi tile ${cls}"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d}</div></div>`;

ROUTES.overview = (el) => {
  const t = totals(), att = attention();
  const live = EXPS().filter(e => { const v = view(e); return v.running || v.scheduled || v.d.paused && !v.ended || (v.kind === "HOLD_FOR_APPROVAL" && !v.d.approval); });
  el.innerHTML = head("Overview", "What is running, what needs you, and what Picky decided.", `${clockButtons()}<a class="btn" href="#/import">Import results</a><a class="btn primary" href="#/new">New experiment</a>`) + autopilotStrip() +
    `<div class="grid g3 tiles">${tile("Running tests", t.running, "live now")}${tile("Harm alerts", t.alerts, "stopped or halted", t.alerts ? "neg" : "")}${tile("Completed this month", t.month, "in this demo")}</div>
    ${att.length ? `<div class="card attn"><h2>Needs attention</h2><div class="attn-list">${att.map(([k, c, txt]) => `<div class="attn-row"><span>${pill(k, c)}</span><span>${txt}</span></div>`).join("")}</div></div>` : ""}
    <h2 class="sec-title">Running tests</h2>
    ${live.length ? `<div class="grid g3">${live.map(runningCard).join("")}</div>` : `<div class="empty">No tests are running. <a href="#/new">Start a new experiment</a> or pick an idea from <a href="#/suggest">Suggest A/B Tests</a>.</div>`}`;
  bindClock(el);
  $$("[data-open-draft]", el).forEach(a => a.onclick = () => { const d = DYN.drafts.find(x => x.id === a.dataset.openDraft); if (d) WZ = { ...wzDefaults(), ...JSON.parse(JSON.stringify(d.w)) }; });
};
