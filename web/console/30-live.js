/* Live Experiments: results up to yesterday, day by day, then the engine's call. Follows the spec's "Live Experiment page" table. */

const DECISION_ROWS = [
  { k: ["PROMOTE"], goal: "B significantly better", guard: "OK", dec: "Promote B to 100%" },
  { k: ["HOLD_FOR_APPROVAL"], goal: "B significantly better", guard: "Broken or not proven", dec: "Hold for approval" },
  { k: ["INCONCLUSIVE", "REJECTED"], goal: "No significant difference", guard: "Any", dec: "Inconclusive, keep A" },
  { k: ["STOP_HARM"], goal: "B clearly worse (any day, 99.9%)", guard: "Any", dec: "Stop B early, move its leads back to A" },
  { k: ["LOSS"], goal: "B significantly worse (end of test, 95%)", guard: "Any", dec: "Keep A, logged as a loss" },
  { k: ["STOP_GUARDRAIL"], goal: "Any", guard: "Clearly broken", dec: "Stop B" },
  { k: ["HALT_SRM"], goal: "Test itself is broken", guard: "-", dec: "Halt: fix the split or the log, rerun" }];

function logAction(e, type, text) { const d = dyn(e); d.console = d.console || []; d.console.push({ ts: nowTs(e), type, text }); }

function guardTile(item) {
  const st = item.st, tipText = "A guardrail is a metric B must not make worse. It can stop B or hold it for a person even if the goal improves.";
  if (!item.g) return `<div class="card kpi" title="${tipText}"><div class="k">${esc(item.name)} (guardrail)</div><div class="v" style="font-size:26px">-</div><div class="d">Not enough data yet</div><div>${pill(st.label, st.cls)}</div></div>`;
  return `<div class="card kpi" title="${tipText}"><div class="k">${esc(item.name)} (guardrail)</div><div class="v" style="font-size:26px">${st.value}</div><div class="d">${item.name === "Call duration" ? "B's calls vs A's" : "B vs A"}; ${item.conf}% range ${st.range}; limit ${st.lim}</div><div>${pill(st.label, st.cls)}</div></div>`;
}


/** A against B by lead type, firm type and city: the balance table. */
function balanceHtml(cur) {
  const mix = cur && cur.mix; if (!mix) return `<div class="note">The lead mix was not recorded for this run.</div>`;
  const strat = CAT().strata, blocks = CAT().balance.map(name => {
    const vv = catVar(name), vals = vv.values.filter(x => mix[name][x][0] + mix[name][x][1] > 0), ta = vals.reduce((a, x) => a + mix[name][x][0], 0), tb = vals.reduce((a, x) => a + mix[name][x][1], 0), p = (cur.mix_p || {})[name], by = strat.includes(name);
    if (vals.length < 2 && p == null) return `<tr><td colspan="5"><b>${esc(vv.label)}</b> <span class="muted">${esc(vals[0] || "")}: every counted lead is the same, so there is nothing to balance.</span></td></tr>`;
    return `<tr class="grp"><td colspan="5"><b>${esc(vv.label)}</b> ${by ? pill("balanced by design", "pos") : pill("left to chance", "plain")} <span class="note">same-mix check p = ${p == null ? "-" : p < 0.001 ? p.toExponential(1) : p.toFixed(2)}</span></td></tr>` +
      vals.map(x => { const a = mix[name][x][0], b = mix[name][x][1], sa = ta ? a / ta : 0, sb = tb ? b / tb : 0, gap = (sb - sa) * 100; return `<tr><td>${esc(x)}</td><td class="num">${nf(a)} <span class="muted">(${pct(sa, 1)})</span></td><td class="num">${nf(b)} <span class="muted">(${pct(sb, 1)})</span></td><td class="num">${sgn(gap, 1)} pp</td><td></td></tr>`; }).join("");
  }).join("");
  return `<div class="tbl-wrap"><table><thead><tr><th>Value</th><th class="num">A leads (share)</th><th class="num">B leads (share)</th><th class="num">B minus A</th><th></th></tr></thead><tbody>${blocks}</tbody></table></div>
    <p class="note" style="margin-top:8px">${esc(CAT().strata.map(n => catVar(n).label).join(" × "))} is dealt in blocks, so those two match almost exactly. City is not blocked: its gaps are the luck of the draw, shrinking as leads grow. The lead mix is synthetic.</p>`;
}

/** The BRD's Split health: configured against achieved share by lead, call and day; the mismatch check; leads that saw both; the balance table; the segment check. */
function splitHealth(e, v) {
  const rec = e.record, c = v.config, cur = v.cur, shareCfg = c.share_b, seg = rec.result.segment_check, mix = cur.mix;
  const chi = (() => { const n = cur.nA + cur.nB, e1 = shareCfg * n, e0 = (1 - shareCfg) * n, x2 = (cur.nB - e1) ** 2 / e1 + (cur.nA - e0) ** 2 / e0; return erfc(Math.sqrt(x2 / 2)); })();
  const byCall = cur.calls ? { n: cur.calls, b: cur.exposedB / cur.calls } : null, both = rec.result.stickiness && rec.result.stickiness.checkable !== false ? rec.result.stickiness.arm_changes : null;
  const dayRowsHtml = v.rows.slice(-14).map(({ day, row }) => { const sh = row.nB / row.n; return `<tr><td>Day ${day}</td><td class="num">${nf(row.nA)}</td><td class="num">${nf(row.nB)}</td><td class="num">${pct(sh, 2)}</td><td class="num">${sgn((sh - shareCfg) * 100, 2)} pp</td></tr>`; }).join("");
  const bal = balanceHtml(cur);
  const sc = mix ? Object.values(mix)[0] : null, counted = sc ? Object.values(sc).reduce((a, ab) => a + ab[0] + ab[1], 0) : cur.n;
  const segHtml = seg ? `<div class="check ${seg.matching === seg.counted_leads ? "ok" : "bad"}"><span class="ico">${seg.matching === seg.counted_leads ? "✓" : "✕"}</span><span><b>Segment check:</b> ${pct(seg.matching / Math.max(1, seg.counted_leads), 0)} of counted leads match the rule (${nf(seg.matching)} of ${nf(seg.counted_leads)}, re-read from the whole record). <span class="mono">${esc(seg.rule)}</span></span></div>
      <div class="check ok"><span class="ico">✓</span><span><b>Out of segment:</b> ${nf(cur.oos == null ? seg.out_of_segment_leads : cur.oos)} leads so far kept today's prompt and were not counted.</span></div>` : `<div class="check ok"><span class="ico">✓</span><span><b>Segment check:</b> a neutral test: every lead is eligible and counted.</span></div>`;
  const mergedNote = (rec.result.split || {}).merged && rec.result.split.merged.length ? `<div class="note" style="margin-top:8px">Small groups merged into "Other" before splitting: ${esc(rec.result.split.merged.join(", "))}.</div>` : "";
  const blk = (rec.result.split || {}).block ? `<dt>Router</dt><dd>stratified blocks of ${rec.result.split.block} (${rec.result.split.b_slots} B per block); any group is at most ${(rec.result.split.max_stratum_off_slots || 0).toFixed(1)} leads off its share</dd>` : "";
  return `<div class="card" id="split-health" style="margin-bottom:16px"><h2>Split health</h2><div class="sub">Is the traffic split fair? Configured against achieved share, whether anyone saw both prompts, whether A and B have the same mix of leads, and whether only leads inside the segment were counted.</div>
    <div class="grid g2" style="margin-top:16px;align-items:start"><div>${shareBars("B share by lead", shareCfg, cur.nB / cur.n, cur.n)}${byCall ? shareBars("B share by call (repeat calls included)", shareCfg, byCall.b, byCall.n) : `<div class="note" style="margin:8px 0">By call: not available for this source.</div>`}
        <dl class="kv" style="margin-top:8px"><dt>Split-mismatch check</dt><dd>chi-square p = <b>${chi < 0.001 ? chi.toExponential(1) : chi.toFixed(2)}</b> ${chi < 0.001 ? pill("✕ Mismatch: test is broken", "neg") : pill("✓ Healthy", "pos")}</dd>
        <dt>Leads that saw both prompts</dt><dd><b>${both == null ? "not checkable here" : nf(both)}</b> ${both === 0 ? pill("✓ Must be 0", "pos") : both > 0 ? pill("✕ Sticky split broke", "neg") : ""}</dd>${blk}</dl>${mergedNote}
        <h3 style="margin:16px 0 8px">By day</h3><div class="tbl-wrap"><table><thead><tr><th>Day</th><th class="num">A leads</th><th class="num">B leads</th><th class="num">B share</th><th class="num">vs configured</th></tr></thead><tbody>${dayRowsHtml}</tbody></table></div>
        <div style="display:grid;gap:8px;margin-top:12px">${segHtml}</div></div>
      <div><h3 style="margin-bottom:8px">Balance: A against B by lead type, firm type and city</h3>${bal}</div></div></div>`;
}

/** The week after a promotion: 5% of leads stay on A so a regression would show. */
function holdbackCard(e, v) {
  const h = v.holdback, all = h.all, shown = h.rows, last = shown[shown.length - 1];
  const verdict = !h.done ? "" : all.alert_day ? `<div class="banner neg"><div><b>Holdback alert on day ${all.alert_day}.</b> B fell clearly below the held-back A. Consider rolling back.</div></div>` : `<div class="banner pos"><div><b>Holdback finished: no sign of loss.</b> ${all.verdict === "ahead" ? "B is still ahead of A." : "B is not below A."} The held-back slice is small: it would have caught a drop of about ${all.detectable_drop_pp} points or more (80% chance); it does not re-prove the gain.</div></div>`;
  return `<div class="card" style="margin-bottom:16px"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:flex-start"><div><h2>After the win: holdback</h2><div class="sub">B is now the production prompt. ${pct(all.share, 0)} of leads stay on A for ${all.days} days to confirm the gain holds. Day ${h.day} of ${all.days}. A slice this small can only catch a B that has turned clearly worse (a drop of about <b>${all.detectable_drop_pp} points or more</b>, caught with 80% chance); it cannot re-prove the gain.</div></div>
    <div class="actions">${h.done ? "" : `<button class="btn" id="a-hold">Play holdback day ${h.day + 1}</button><button class="btn" id="a-hold-all">Play all</button>`}</div></div>${verdict}
    ${shown.length ? `<div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>Day</th><th class="num">A (held back)</th><th class="num">B (production)</th><th class="num">B minus A</th><th class="num">z / alert line</th><th>Status</th></tr></thead><tbody>${shown.map(r => `<tr><td>Day ${r.day}</td><td class="num">${nf(r.nA)} · ${pct(r.rateA, 1)}</td><td class="num">${nf(r.nB)} · ${pct(r.rateB, 1)}</td><td class="num">${pts(r.diff, 1)}</td><td class="num">${r.z.toFixed(2)} / −${r.bar.toFixed(2)}</td><td>${r.alert ? pill("✕ B clearly worse", "neg") : pill("✓ No sign of loss", "pos")}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty" style="margin-top:12px">No holdback days played yet. Press the button to play the first day.</div>`}</div>`;
}

ROUTES.live = (el, arg) => {
  const exps = EXPS(), vs = exps.map(e => [e, view(e)]);
  const order = [...vs.filter(([e, v]) => v.running || v.scheduled), ...vs.filter(([e, v]) => v.d.paused && !v.ended), ...vs.filter(([e, v]) => v.kind === "HOLD_FOR_APPROVAL" && !v.d.approval), ...vs.filter(([e, v]) => v.ended)];
  const uniq = [...new Map(order.map(x => [x[0].id, x])).values()];
  const pick = arg ? byId(arg) : (uniq[0] || [])[0];
  if (!pick) { el.innerHTML = head("Live Experiments", "Progressive results up to yesterday, and the day-by-day decision.") + `<div class="empty">Nothing here yet. <a href="#/new">Start a new experiment</a>.</div>`; return; }
  const v = view(pick), c = v.config, rec = pick.record, cur = v.cur, d = v.d;
  const groups = [["Running", uniq.filter(([e, x]) => x.running || x.scheduled || x.d.paused && !x.ended)], ["Waiting for a person", uniq.filter(([e, x]) => x.kind === "HOLD_FOR_APPROVAL" && !x.d.approval)], ["Finished", uniq.filter(([e, x]) => x.ended && !(x.kind === "HOLD_FOR_APPROVAL" && !x.d.approval))]];
  const sel = `<select id="live-pick" aria-label="Choose an experiment">${groups.map(([g, list]) => list.length ? `<optgroup label="${g}">${list.map(([e, x]) => `<option value="${esc(e.id)}" ${e.id === pick.id ? "selected" : ""}>${esc(e.record.config.name)} — ${esc(x.status[0])}</option>`).join("")}</optgroup>` : "").join("")}</select>`;
  const canApprove = v.kind === "HOLD_FOR_APPROVAL" && !d.approval, canRoll = v.kind === "PROMOTE" && !d.rolledBack && v.decided;
  const stat = v.scheduled ? `Scheduled for ${fdate(pick.sched_date || c.start)}` : v.ended ? `${KIND_LABEL[v.kind] || v.kind} on day ${v.ld} of ${v.win}` : d.paused ? `Paused, day ${v.day} of ${v.win}` : `Running, day ${v.day} of ${v.win}`;
  const segHead = `<p class="note" style="margin-top:4px"><b>Audience:</b> ${segChips(c.segment)} <span class="mono">${esc(segDescribe(c.segment))}</span>${rec.result.segment_check ? ` · ${pct(rec.result.segment_check.share_of_traffic, 0)} of traffic, about ${nf(rec.result.segment_check.eligible_per_day)} leads a day` : ""}</p>`;
  const sub = `Config <b>v${c.version || 1}</b> <span class="mono">${esc(rec.config_hash)}</span> (locked) · started ${fdate(c.start)} · ${esc(c.rule_set === "final_look" ? "one winner call at the end, strict daily harm check" : "early promote and early stop")}`;
  const replayNote = pick.replay_of ? `<div class="banner warn"><div><b>Offline replay.</b> A new test normally runs the engine, which needs the live version (<span class="mono">./start.sh</span>). Here the pre-computed ${esc(pick.preset)} run is replayed under your name; your plan fields (days, share, rules) were not applied.</div></div>` : "";
  const hdr = `<div class="exp-head"><div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><h2 style="font-size:20px;font-weight:600;color:var(--navy)">${esc(c.name)}</h2>${statusPill(v)}</div><p class="sub" style="color:var(--ink-2)">${esc(stat)} \u00b7 ${sub}</p>${pick.hypothesis ? `<p class="note" style="margin-top:4px">${esc(pick.hypothesis)}</p>` : ""}${segHead}
    <div class="actions" style="margin:12px 0 16px">${v.scheduled ? `<button class="btn primary" id="a-start">Start now (demo)</button>` : ""}${v.running || d.paused && !v.ended ? `<button class="btn" id="a-pause">${d.paused ? "Resume" : "Pause"}</button>` : ""}${!v.ended && !v.scheduled ? `<button class="btn danger" id="a-stop">Stop</button>` : ""}
      <button class="btn primary" id="a-approve" ${canApprove ? "" : "disabled"} title="Needs a test that is held for approval">Approve</button>${canApprove ? `<button class="btn" id="a-reject">Reject</button>` : ""}<button class="btn danger" id="a-roll" ${canRoll ? "" : "disabled"} title="Needs a promoted test">Rollback</button></div></div>`;
  let banner;
  if (v.ended || v.kind === "HOLD_FOR_APPROVAL") {
    const cls = { PROMOTE: "pos", STOP_HARM: "neg", LOSS: "neg", STOP_GUARDRAIL: "neg", HOLD_FOR_APPROVAL: "warn", HALT_SRM: "warn", INCONCLUSIVE: "", REJECTED: "", ROLLED_BACK: "warn", STOPPED_MANUAL: "neg" }[v.kind] || "";
    banner = `<div class="banner ${cls}" role="status"><div><b>${esc(KIND_LABEL[v.kind] || v.kind)}.</b> ${esc(v.kind === "STOPPED_MANUAL" ? "A person stopped the test." : v.res.reason)}${v.kind === "PROMOTE" && !d.rolledBack ? (segRules(c.segment).length ? ` Production prompt now points at B for ${esc(segDescribe(c.segment))} only; every other lead keeps today's prompt.` : ` Production prompt now points at B.`) : ""}</div></div>`;
  } else banner = `<div class="banner" role="status"><div><b>Results up to yesterday.</b> ${c.rule_set === "final_look" ? `Final winner call on day ${v.win}. A clearly worse B can still be stopped on any day.` : `The engine may decide on any day the evidence crosses a line; the window ends on day ${v.win}.`} Do not act on early numbers.</div></div>`;
  if (!cur) { el.innerHTML = head("Live Experiments", "Progressive results up to yesterday, then the engine's decision.", v.running ? `<button class="btn primary" id="a-adv">Advance 1 day (demo)</button>` : "") + `<div class="filters"><div class="field grow"><label for="live-pick">Experiment</label>${sel}</div></div>` + replayNote + hdr + (v.scheduled ? `<div class="banner"><div><b>Scheduled.</b> The setup is locked (version ${c.version || 1}, <span class="mono">${esc(rec.config_hash)}</span>). Nothing runs until ${esc(fdate(pick.sched_date || c.start))}. In this demo press Start now to play it.</div></div>` : banner) + `<div class="empty">${v.scheduled ? "No results yet: the test has not started." : 'No results yet. Press "Advance 1 day (demo)".'}</div>`; wireLive(el, pick); return; }
  const ciA = wilson(cur.xA, cur.nA), ciB = wilson(cur.xB, cur.nB), goal = (C.metrics.find(m => m.key === c.primary_goal) || {}).name || c.primary_goal.replace(/_/g, " ");
  const lr = liftRange(cur, c), gl = guardList(v);
  const tiles = `<div class="grid g4" style="margin-bottom:16px">
    <div class="card kpi" title="Leads in each prompt. Each lead is counted once, even if it called several times."><div class="k">Leads</div><div class="v">${nf(cur.n)}</div><div class="d"><span class="dot a"></span>A ${nf(cur.nA)} \u00b7 <span class="dot b"></span>B ${nf(cur.nB)}</div></div>
    <div class="card kpi" title="Share of leads that reached the goal under today's prompt, with its 95% range."><div class="k"><span class="dot a"></span>A: ${esc(goal)}</div><div class="v">${pct(cur.rateA, 1)}</div><div class="d">95% range ${pct(ciA[0], 1)} to ${pct(ciA[1], 1)}</div></div>
    <div class="card kpi" title="Share of leads that reached the goal under the new prompt, with its 95% range."><div class="k"><span class="dot b"></span>B: ${esc(goal)}</div><div class="v">${pct(cur.rateB, 1)}</div><div class="d">95% range ${pct(ciB[0], 1)} to ${pct(ciB[1], 1)}</div></div>
    <div class="card kpi" title="B's rate minus A's rate, in percentage points, with its ${confOf(c)}% range. A range that includes 0 means not proven. Green means better for this goal (${c.primary_direction === "lower" ? "lower is better" : "higher is better"})."><div class="k">Lift of B over A${c.primary_direction === "lower" ? " (lower is better)" : ""}</div><div class="v" style="color:${+(cur.diff * 100).toFixed(1) === 0 ? "var(--navy)" : isBetter(cur.diff, c) ? "#167a70" : "#b23b3b"}">${cur.diff >= 0 ? "\u25B2 " : "\u25BC "}${pts(cur.diff, 1)}</div><div class="d">${confOf(c)}% range ${pts(lr.lo, 1)} to ${pts(lr.hi, 1)}<br><span class="muted">${lr.interim ? "interim range, not corrected for repeated looks" : c.rule_set === "final_look" ? "end-of-test range" : "always-valid range: safe to read at any look"}</span></div></div></div>
    ${gl.length ? `<div class="grid g2" style="margin-bottom:16px">${gl.map(guardTile).join("")}</div>` : ""}`;
  const dr = v.rows;
  const harmBound = cur.harm;
  const harmRows = dr.map(({ day, row }) => { const worse = row.decision === "STOP_HARM", waiting = !worse && row.z <= -row.harm; return `<tr><td style="white-space:nowrap">Day ${day}</td><td class="num" style="white-space:nowrap">${pts(row.diff, 1)}</td><td style="white-space:nowrap">${worse ? pill("\u2715 Yes: clearly worse", "neg") : waiting ? pill("Past the bar; the check starts at " + nf(c.min_per_arm) + " leads per prompt", "warn") : pill("\u2713 No", "pos")}</td><td class="num" style="white-space:nowrap">${row.z.toFixed(2)} / \u2212${row.harm.toFixed(2)}</td></tr>`; }).join("");
  const needN = needLeads(pick), needed = Math.max(0, needN - cur.n);
  const decBody = `<div class="sub" style="margin-top:4px">${v.ended ? "The row that applied is highlighted." : `Pending: ${c.rule_set === "final_look" ? "final winner call on day " + v.win : "a decision when a line is crossed, or on day " + v.win}.`}</div>
    <div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>Primary goal</th><th>Guardrail</th><th>Decision</th></tr></thead><tbody>${DECISION_ROWS.map(r => { const hit = v.ended && r.k.includes(v.kind === "ROLLED_BACK" ? "PROMOTE" : v.kind === "STOPPED_MANUAL" ? "" : v.kind); return `<tr ${hit ? 'style="background:var(--blue-wash)"' : ""}><td>${esc(r.goal)}</td><td>${esc(r.guard)}</td><td>${hit ? "<b>" + esc(r.dec) + "</b> ← applied" : esc(r.dec)}</td></tr>`; }).join("")}</tbody></table></div>`;
  const evs = eventsFor(pick).sort((a, b) => a.ts < b.ts ? -1 : 1);
  const ledger = `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h2>Decision record</h2><button class="btn sm" id="a-verify">Verify record in this browser</button></div><div class="sub">Every event with its time, reason and numbers. Hash-chained: an edited entry is detected.</div><div id="verify-out" class="note" style="margin-top:8px"></div>
    <div class="ledger" style="margin-top:8px">${evs.map(x => `<div class="e"><span class="note">${esc(fdt(x.ts))}</span><span><b>${esc(x.type)}</b>${x.hash ? ` <span class="mono muted">${esc(x.hash)}</span>` : ""}<br><span class="muted">${esc(x.text)}</span></span></div>`).join("")}</div></div>`;
  el.innerHTML = head("Live Experiments", "Progressive results up to yesterday, then the engine's decision.", v.running ? `<button class="btn primary" id="a-adv">Advance 1 day (demo)</button><button class="btn" id="a-end">Skip to the end</button>` : v.ended ? `<a class="btn primary" href="#/report/${encodeURIComponent(pick.id)}">View final report</a>` : "") +
    `<div class="filters"><div class="field grow"><label for="live-pick">Experiment</label>${sel}</div></div>` + replayNote + hdr + banner + tiles +
    `<div class="g-main grid" style="margin-bottom:16px"><div class="card"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><div><h2 title="Cumulative goal rate for A and B by day. Shaded bands are 95% ranges.">Daily trend</h2><div class="sub">Cumulative ${esc(goal)} rate for A and B by day, with shaded 95% ranges.</div></div><button class="btn sm" id="a-csv">Export CSV</button></div>
        <div class="legend"><span><i style="border-color:var(--a)"></i>A (today's prompt)</span><span><i style="border-color:var(--b)"></i>B (new prompt)</span><span><i class="band" style="background:var(--ink-2)"></i>95% range</span></div><div id="trend"></div></div>
      <div class="card"><h2>Progress</h2><div class="sub">How much evidence the plan needs.</div><div style="margin-top:16px"><div class="kpi"><div class="k">Leads still needed for the planned lift</div><div class="v">${nf(needed)}</div><div class="d">of ${nf(needN)} needed (the ${v.win}-day window holds ${nf(rec.design.n_max)}); ${nf(cur.n)} so far</div></div><div class="bar" style="margin-top:8px"><i style="width:${Math.min(100, cur.n / needN * 100)}%"></i></div></div>
        <div class="note" style="margin-top:12px">Day ${v.day} of ${v.win}. Planned to detect a ${+(c.mde * 100).toFixed(1)}-point lift from ${pct(c.baseline, 0)} with at least ${pct(c.power, 0)} chance.</div></div></div>
    <div class="grid g2" style="margin-bottom:16px"><div class="card"><h2>Harm monitor</h2><div class="sub">Every day: is B clearly worse, and by how much? The bar is very strict (${pct(1 - (c.alpha_harm_daily || 0.001), 1)} for the one-look rule) so one bad day does not trigger it.</div>
        <div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>Day</th><th class="num">B vs A (how much)</th><th>Is B clearly worse?</th><th class="num">z / stop line</th></tr></thead><tbody>${harmRows}</tbody></table></div></div><div class="card"><h2>Decision rule</h2><div class="sub">What the engine does at each outcome.</div>${decBody}</div></div>
    ${splitHealth(pick, v)}${v.holdback ? holdbackCard(pick, v) : ""}
    <div class="grid g2" style="margin-bottom:16px">${ledger}</div>`;
  const fd = c.rule_set === "final_look" ? v.win : null;
  const draw = () => trendChart($("#trend"), dr, v.win, { finalDay: fd });
  draw(); window.__redraw = draw;
  wireLive(el, pick);
};
window.addEventListener("resize", () => { if (CUR.name === "live" && window.__redraw) window.__redraw(); });

function wireLive(el, e) {
  const v = view(e), d = dyn(e), $1 = s => $(s, el);
  const pickEl = $1("#live-pick"); if (pickEl) pickEl.onchange = () => go("live", pickEl.value);
  const a = (id, fn) => { const b = $1(id); if (b) b.onclick = fn; };
  a("#a-start", () => { d.started = true; logAction(e, "Started", `Started on the scheduled date (a console action: in this demo a person pressed Start now).`); saveDyn(); route(); });
  const playHold = (all) => { const vv = view(e); if (!vv.holdback) return; const H = vv.holdback.all; do { if (d.hold >= H.days) break; d.hold = (d.hold || 0) + 1; const r = H.rows[d.hold - 1];
      logAction(e, r.alert ? "Harm alert" : "Holdback", r.alert ? `Holdback day ${d.hold}: B is clearly below the held-back A (z=${r.z.toFixed(2)}, alert line −${r.bar.toFixed(2)}). Consider a rollback.` : `Holdback day ${d.hold} of ${H.days}: B ${pct(r.rateB, 1)} against A ${pct(r.rateA, 1)} (${pts(r.diff, 1)}); no sign of loss.`);
    } while (all && !H.rows[d.hold - 1].alert); if (d.hold >= H.days) logAction(e, "Holdback", H.alert_day ? `Holdback finished with an alert on day ${H.alert_day}.` : `Holdback finished: no sign of loss. The slice is small: it would have caught a drop of about ${H.detectable_drop_pp} points or more (80% chance), it does not re-prove the gain.`); saveDyn(); route(); };
  a("#a-hold", () => playHold(false)); a("#a-hold-all", () => playHold(true));
  a("#a-adv", () => { advance(e); route(); });
  a("#a-end", () => { d.day = view(e).ld; saveDyn(); toast(`${e.record.config.name}: ${KIND_LABEL[view(e).kind] || view(e).kind}`); route(); });
  a("#a-pause", () => { d.paused = !d.paused; logAction(e, d.paused ? "Paused" : "Resumed", `${d.paused ? "Paused" : "Resumed"} by a person on day ${v.day} (a console action; the engine is not involved).`); saveDyn(); route(); });
  a("#a-stop", () => { if (!confirm("Stop this test now? B's leads go back to A and the test ends.")) return; d.manualStop = true; logAction(e, "Stopped", `Stopped by a person on day ${v.day}. B's leads go back to A (a console action).`); saveDyn(); route(); });
  a("#a-approve", () => { d.approval = "approved"; saveDyn(); toast("Approved. The click is added to the record."); route(); });
  a("#a-reject", () => { d.approval = "rejected"; saveDyn(); toast("Rejected. A stays live."); route(); });
  a("#a-roll", () => { d.rolledBack = true; saveDyn(); toast("Rolled back. The click is added to the record."); route(); });
  a("#a-csv", () => download(`${e.id}_daily.csv`, toCsv(["day", "leads_A", "goal_A", "leads_B", "goal_B", "rate_A", "rate_B", "lift_pp", "z", "stop_line"], v.rows.map(({ day, row }) => [day, row.nA, row.xA, row.nB, row.xB, row.rateA.toFixed(4), row.rateB.toFixed(4), (row.diff * 100).toFixed(2), row.z.toFixed(3), (-row.harm).toFixed(3)]))));
  a("#a-verify", () => { const tailK = d.approval === "approved" ? "approve" : d.approval === "rejected" ? "reject" : d.rolledBack ? "rollback" : null, ents = e.record.ledger.concat(tailK && e.record.tails ? e.record.tails[tailK] || [] : []); const ok = chainOk(ents); $1("#verify-out").innerHTML = ok ? `<span style="color:#167a70;font-weight:600">✓ Chain intact</span>: ${ents.length} entries re-hashed just now, head <span class="mono">${esc(ents[ents.length - 1].hash.slice(0, 12))}</span>.` : `<span style="color:#b23b3b;font-weight:600">✕ Record BROKEN</span>: an entry was changed.`; });
}
