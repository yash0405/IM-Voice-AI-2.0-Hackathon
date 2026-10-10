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
  if (!item.g) return `<div class="card kpi" title="${tipText}"><div class="k">${esc(item.name)} (guardrail)</div><div class="v" style="font-size:26px">-</div><div>${pill(st.label, st.cls)}</div></div>`;
  return `<div class="card kpi" title="${tipText}"><div class="k">${esc(item.name)} (guardrail) ${info(`${item.name === "Call duration" ? "B's calls against A's" : "B against A"}; ${item.conf}% range ${st.range}; limit ${st.lim}`)}</div><div class="v" style="font-size:26px">${st.value}</div><div class="d">limit ${st.lim}</div><div>${pill(st.label, st.cls)}</div></div>`;
}


/** A against B on each balance factor of the catalog: the balance table. */
function balanceHtml(cur) {
  const mix = cur && cur.mix; if (!mix) return `<div class="note">The lead mix was not recorded for this run.</div>`;
  const strat = CAT().strata, blocks = CAT().balance.filter(name => mix[name]).map(name => {
    const vv = catVar(name), vals = vv.values.filter(x => mix[name][x][0] + mix[name][x][1] > 0), ta = vals.reduce((a, x) => a + mix[name][x][0], 0), tb = vals.reduce((a, x) => a + mix[name][x][1], 0), p = (cur.mix_p || {})[name], by = strat.includes(name);
    if (vals.length < 2 && p == null) return `<tr><td colspan="5"><b>${esc(vv.label)}</b> <span class="muted">${esc(vals[0] || "")}: every counted lead is the same, so there is nothing to balance.</span></td></tr>`;
    return `<tr class="grp"><td colspan="5"><b>${esc(vv.label)}</b> ${by ? pill("balanced by design", "pos") : pill("left to chance", "plain")} <span class="note">same-mix check p = ${p == null ? "-" : p < 0.001 ? p.toExponential(1) : p.toFixed(2)}</span></td></tr>` +
      vals.map(x => { const a = mix[name][x][0], b = mix[name][x][1], sa = ta ? a / ta : 0, sb = tb ? b / tb : 0, gap = (sb - sa) * 100; return `<tr><td>${esc(x)}</td><td class="num">${nf(a)} <span class="muted">(${pct(sa, 1)})</span></td><td class="num">${nf(b)} <span class="muted">(${pct(sb, 1)})</span></td><td class="num">${sgn(gap, 1)} pp</td><td></td></tr>`; }).join("");
  }).join("");
  return `<div class="tbl-wrap"><table><thead><tr><th>Value</th><th class="num">A leads (share)</th><th class="num">B leads (share)</th><th class="num">B minus A</th><th></th></tr></thead><tbody>${blocks}</tbody></table></div>
    <p class="note" style="margin-top:8px">${esc(CAT().strata.map(n => catVar(n).label).join(" × "))} is dealt in blocks, so those two match almost exactly. ${esc(CAT().balance.filter(n => !CAT().strata.includes(n)).map(n => catVar(n).label).join(" and "))} ${CAT().balance.filter(n => !CAT().strata.includes(n)).length === 1 ? "is" : "are"} not blocked: ${CAT().balance.filter(n => !CAT().strata.includes(n)).length === 1 ? "its" : "their"} gaps are the luck of the draw, shrinking as leads grow. The lead mix is synthetic.</p>`;
}

/** The BRD's Split health: configured against achieved share by lead, call and day; the mismatch check; leads that saw both; the balance table; the segment check. */
function splitHealth(e, v) {
  const rec = e.record, c = v.config, cur = v.cur, shareCfg = c.share_b, seg = rec.result.segment_check, mix = cur.mix;
  const chi = (() => { const n = cur.nA + cur.nB, e1 = shareCfg * n, e0 = (1 - shareCfg) * n, x2 = (cur.nB - e1) ** 2 / e1 + (cur.nA - e0) ** 2 / e0; return erfc(Math.sqrt(x2 / 2)); })();
  const byCall = cur.calls ? { n: cur.calls, b: cur.exposedB / cur.calls } : null, both = rec.result.stickiness && rec.result.stickiness.checkable !== false ? rec.result.stickiness.arm_changes : null;
  const dayRowsHtml = v.rows.slice(-14).map(({ day, row }) => { const sh = row.nB / row.n; return `<tr><td>Day ${day}</td><td class="num">${nf(row.nA)}</td><td class="num">${nf(row.nB)}</td><td class="num">${pct(sh, 2)}</td><td class="num">${sgn((sh - shareCfg) * 100, 2)} pp</td></tr>`; }).join("");
  const bal = balanceHtml(cur);
  const sc = mix ? Object.values(mix)[0] : null, counted = sc ? Object.values(sc).reduce((a, ab) => a + ab[0] + ab[1], 0) : cur.n;
  const segHtml = seg ? `<div class="check ${seg.matching === seg.counted_leads ? "ok" : "bad"}"><span class="ico">${seg.matching === seg.counted_leads ? "✓" : "✕"}</span><span><b>Segment check:</b> ${esc(segMatchLine(rec))}. ${esc(seg.rule)}</span></div>
      <div class="check ok"><span class="ico">✓</span><span><b>Out of segment:</b> ${nf(cur.oos == null ? seg.out_of_segment_leads : cur.oos)} leads so far kept today's prompt and were not counted.</span></div>` : `<div class="check ok"><span class="ico">✓</span><span><b>Segment check:</b> a neutral test: every lead is eligible and counted.</span></div>`;
  const mergedNote = (rec.result.split || {}).merged && rec.result.split.merged.length ? `<div class="note" style="margin-top:8px">Small groups merged into "Other" before splitting: ${esc(rec.result.split.merged.join(", "))}.</div>` : "";
  const blk = (rec.result.split || {}).block ? `<dt>Router</dt><dd>stratified blocks of ${rec.result.split.block} (${rec.result.split.b_slots} B per block); any group is at most ${(rec.result.split.max_stratum_off_slots || 0).toFixed(1)} leads off its share</dd>` : "";
  const ok = chi >= 0.001 && !(both > 0) && (!seg || seg.matching === seg.counted_leads);
  return `<div class="card" id="split-health" style="margin-bottom:16px"><div class="sec-row"><h2>Split health</h2>${ok ? pill("✓ Fair split", "pos") : pill("✕ Check the split", "neg")}</div>
    <div class="grid g2" style="margin-top:8px;align-items:start"><div>${shareBars("B share by lead", shareCfg, cur.nB / cur.n, cur.n)}</div>
      <div class="checks"><div class="check ${chi < 0.001 ? "bad" : "ok"}"><span class="ico">${chi < 0.001 ? "✕" : "✓"}</span><span>Split matches the plan ${info(`Split-mismatch check: chi-square p = ${chi < 0.001 ? chi.toExponential(1) : chi.toFixed(2)}; below 0.001 the test is halted as broken.`)}</span></div>
        <div class="check ${both > 0 ? "bad" : "ok"}"><span class="ico">${both > 0 ? "✕" : "✓"}</span><span>${both == null ? "Repeat callers: not checkable here" : `${nf(both)} leads saw both prompts`}</span></div>
        <div class="check ${seg && seg.matching !== seg.counted_leads ? "bad" : "ok"}"><span class="ico">${seg && seg.matching !== seg.counted_leads ? "✕" : "✓"}</span><span>${seg ? "Only leads in the audience were counted" : "All leads eligible (neutral test)"}</span></div></div></div>
    ${fold("Split details", `${byCall ? shareBars("B share by call (repeat calls included)", shareCfg, byCall.b, byCall.n) : `<div class="note" style="margin:8px 0">By call: not available for this source.</div>`}
        <dl class="kv" style="margin-top:8px"><dt>Split-mismatch check</dt><dd>chi-square p = <b>${chi < 0.001 ? chi.toExponential(1) : chi.toFixed(2)}</b> ${chi < 0.001 ? pill("✕ Mismatch: test is broken", "neg") : pill("✓ Healthy", "pos")}</dd>
        <dt>Leads that saw both prompts</dt><dd><b>${both == null ? "not checkable here" : nf(both)}</b> ${both === 0 ? pill("✓ Must be 0", "pos") : both > 0 ? pill("✕ Sticky split broke", "neg") : ""}</dd>${blk}</dl>${mergedNote}
        <div style="display:grid;gap:8px;margin-top:12px">${segHtml}</div>
        <h3 style="margin:16px 0 8px">By day</h3><div class="tbl-wrap"><table><thead><tr><th>Day</th><th class="num">A leads</th><th class="num">B leads</th><th class="num">B share</th><th class="num">vs configured</th></tr></thead><tbody>${dayRowsHtml}</tbody></table></div>
        <h3 style="margin:16px 0 8px">Balance: A against B by ${esc(CAT().balance.map(n => catVar(n).label).join(", "))}</h3>${bal}`, "by day, by lead type, segment check")}</div>`;
}

/** The week after a promotion: 5% of leads stay on A so a regression would show. */
function holdbackCard(e, v) {
  const h = v.holdback, all = h.all, shown = h.rows;
  const dots = Array.from({ length: all.days }, (_, i) => { const r = shown[i]; return `<span class="ds ${!r ? "fut" : r.alert ? "neg" : "pos"}" title="${r ? `Day ${r.day}: B ${pct(r.rateB, 1)} against A ${pct(r.rateA, 1)}` : `Day ${i + 1}: to come`}">${i + 1}</span>`; }).join("");
  const verdict = !h.done ? "" : all.alert_day ? `<div class="banner neg" style="margin:12px 0 0"><div><b>Holdback alert on day ${all.alert_day}.</b> B fell clearly below the held-back A. Consider rolling back.</div></div>` : `<div class="banner pos" style="margin:12px 0 0"><div><b>Holdback finished: no sign of loss.</b> ${all.verdict === "ahead" ? "B is still ahead of A." : "B is not below A."}</div></div>`;
  return `<div class="card" style="margin-bottom:16px"><div class="sec-row"><div><h2>After the win: holdback</h2><div class="sub">${pct(all.share, 0)} of leads stay on A for ${all.days} days to catch a B that turns clearly worse. Day ${h.day} of ${all.days}. ${info(`A slice this small only catches a drop of about ${all.detectable_drop_pp} points or more (80% chance); it cannot re-prove the gain. ${canAutoRollback(e) ? "With the autopilot on, an alert rolls B back automatically." : (e.record.tails || {}).auto_rollback ? "The autopilot's rollback is off: a person rolls back." : "A person rolls back on an alert (this win was approved by a person, or the record predates the autopilot)."}`)}</div></div>
    <div class="actions">${h.done ? "" : `<button class="btn" id="a-hold">Play holdback day ${h.day + 1}</button><button class="btn" id="a-hold-all">Play all</button>`}</div></div>
    <div class="dstrip" style="margin-top:12px">${dots}</div>${verdict}
    ${shown.length ? fold("Holdback by day", `<div class="tbl-wrap"><table><thead><tr><th>Day</th><th class="num">A (held back)</th><th class="num">B (production)</th><th class="num">B minus A</th><th class="num">z / alert line</th><th>Status</th></tr></thead><tbody>${shown.map(r => `<tr><td>Day ${r.day}</td><td class="num">${nf(r.nA)} · ${pct(r.rateA, 1)}</td><td class="num">${nf(r.nB)} · ${pct(r.rateB, 1)}</td><td class="num">${pts(r.diff, 1)}</td><td class="num">${r.z.toFixed(2)} / −${r.bar.toFixed(2)}</td><td>${r.alert ? pill("✕ B clearly worse", "neg") : pill("✓ No sign of loss", "pos")}</td></tr>`).join("")}</tbody></table></div>`) : ""}</div>`;
}

/** Every day of the test as one square: green no harm, red B clearly worse (stopped), grey still to come; the last square is the final call. */
function dayStrip(v) {
  const c = v.config, byDay = new Map(v.rows.map(r => [r.day, r.row]));
  const cells = Array.from({ length: v.win }, (_, i) => { const d = i + 1, r = byDay.get(d), cls = !r ? "fut" : r.decision === "STOP_HARM" ? "neg" : r.z <= -1.96 ? "warn" : "pos";
    return `<span class="ds ${cls}${d === v.win ? " final" : ""}" title="${esc(!r ? `Day ${d}: to come` : `Day ${d}: B ${fmtD(r.diff, c)} against A; ${r.decision === "STOP_HARM" ? "clearly worse, stopped" : r.z <= -1.96 ? "looks worse, under the stop bar" : "no harm"}`)}">${d}</span>`; }).join("");
  return `<div class="dstrip" role="img" aria-label="Day ${v.day} of ${v.win}; the daily harm check for each day played">${cells}</div>
    <div class="dstrip-legend"><span><i class="pos"></i>no harm</span><span><i class="warn"></i>looks worse</span><span><i class="neg"></i>clearly worse: stopped</span><span><i class="fut"></i>to come</span><span>⚑ ${c.rule_set === "final_look" ? "final call" : "last day"} on day ${v.win}</span></div>`;
}

ROUTES.live = (el, arg) => {
  const exps = EXPS(), vs = exps.map(e => [e, view(e)]);
  const order = [...vs.filter(([e, v]) => v.running || v.scheduled), ...vs.filter(([e, v]) => v.d.paused && !v.ended), ...vs.filter(([e, v]) => v.kind === "HOLD_FOR_APPROVAL" && !v.d.approval), ...vs.filter(([e, v]) => v.ended)];
  const uniq = [...new Map(order.map(x => [x[0].id, x])).values()];
  const pick = arg ? byId(arg) : (uniq[0] || [])[0];
  if (!pick) { el.innerHTML = head("Live Experiments", "Results up to yesterday, and the day-by-day decision.") + `<div class="empty">Nothing here yet. <a href="#/new">Start a new experiment</a>.</div>`; return; }
  const v = view(pick), c = v.config, rec = pick.record, cur = v.cur, d = v.d;
  const groups = [["Running", uniq.filter(([e, x]) => x.running || x.scheduled || x.d.paused && !x.ended)], ["Waiting for a person", uniq.filter(([e, x]) => x.kind === "HOLD_FOR_APPROVAL" && !x.d.approval)], ["Finished", uniq.filter(([e, x]) => x.ended && !(x.kind === "HOLD_FOR_APPROVAL" && !x.d.approval))]];
  const sel = `<select id="live-pick" aria-label="Choose an experiment">${groups.map(([g, list]) => list.length ? `<optgroup label="${g}">${list.map(([e, x]) => `<option value="${esc(e.id)}" ${e.id === pick.id ? "selected" : ""}>${esc(e.record.config.name)} — ${esc(x.status[0])}</option>`).join("")}</optgroup>` : "").join("")}</select>`;
  const canApprove = v.kind === "HOLD_FOR_APPROVAL" && !d.approval, canRoll = v.kind === "PROMOTE" && !d.rolledBack && v.decided;
  const segBits = rec.result.segment_check ? ` · ${pct(rec.result.segment_check.share_of_traffic, 0)} of traffic ${info(segMatchLine(rec))}` : "";
  const meta = `${v.scheduled ? `Scheduled for ${fdate(pick.sched_date || c.start)}` : v.ended ? `${KIND_LABEL[v.kind] || v.kind} on day ${v.ld}` : d.paused ? `Paused on day ${v.day}` : `Day ${v.day} of ${v.win}`} · ${pct(c.share_b, 0)} to B · ${esc(segRules(c.segment).length ? segDescribe(c.segment) : "all leads")}${segBits} · config v${c.version || 1} ${info(`Locked config ${rec.config_hash}; started ${fdate(c.start)}; ${c.rule_set === "final_look" ? "one winner call at the end, strict daily harm check" : "early promote and early stop"}`)}`;
  const replayNote = pick.replay_of ? `<div class="banner warn"><div><b>Offline replay.</b> The pre-computed ${esc(pick.preset)} run is replayed under your name; run <span class="mono">./start.sh</span> to run the engine on your exact setup. ${info("A new test normally runs the engine, which needs the live version. Your plan fields (days, share, rules), audience, prompt B and metrics were not applied here: the header and numbers below are that run's.")}</div></div>` : "";
  const hdr = `<div class="exp-head"><div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><h2 style="font-size:20px;font-weight:600;color:var(--navy)">${esc(c.name)}</h2>${statusPill(v)}</div><p class="sub" style="color:var(--ink-2)">${meta}</p>${pick.hypothesis ? `<p class="note" style="margin-top:4px">${esc(pick.hypothesis)}</p>` : ""}
    <div class="actions" style="margin:12px 0 16px">${v.scheduled ? `<button class="btn primary" id="a-start">Start now (demo)</button>` : ""}${v.running || d.paused && !v.ended ? `<button class="btn" id="a-pause">${d.paused ? "Resume" : "Pause"}</button>` : ""}${!v.ended && !v.scheduled ? `<button class="btn danger" id="a-stop">Stop</button>` : ""}
      ${canApprove ? `<button class="btn primary" id="a-approve">Approve</button><button class="btn" id="a-reject">Reject</button>` : ""}${canRoll ? `<button class="btn danger" id="a-roll">Rollback</button>` : ""}</div></div>`;
  let banner;
  if (v.ended || v.kind === "HOLD_FOR_APPROVAL") {
    const cls = { PROMOTE: "pos", STOP_HARM: "neg", LOSS: "neg", STOP_GUARDRAIL: "neg", HOLD_FOR_APPROVAL: "warn", HALT_SRM: "warn", INCONCLUSIVE: "", REJECTED: "", ROLLED_BACK: "warn", STOPPED_MANUAL: "neg" }[v.kind] || "";
    const extra = v.kind === "PROMOTE" && !d.rolledBack ? (segRules(c.segment).length ? ` Production prompt now points at B for ${esc(segDescribe(c.segment))} only; every other lead keeps today's prompt.` : " Production prompt now points at B.")
      : v.kind === "ROLLED_BACK" && d.autoRoll ? " The holdback week raised an alert, so the autopilot rolled B back without waiting for a person."
      : v.kind === "REJECTED" && d.auto ? ` Nobody answered within ${heldDays()} days, so the autopilot kept A.`
      : v.kind === "HOLD_FOR_APPROVAL" && canAutoKeepA(pick) ? ` If nobody answers within ${heldDays()} days (${Math.max(0, heldDays() - (d.waited || 0))} left), the autopilot keeps A.` : "";
    banner = `<div class="banner ${cls}" role="status"><div><b>${esc(KIND_LABEL[v.kind] || v.kind)}.</b> ${esc(v.kind === "STOPPED_MANUAL" ? "A person stopped the test." : v.res.reason)}${extra}</div></div>`;
  } else banner = `<div class="banner" role="status"><div><b>Too early to call.</b> ${c.rule_set === "final_look" ? `Winner call on day ${v.win}; a clearly worse B is stopped on any day.` : `The engine decides on the day the evidence crosses a line, by day ${v.win}.`} Do not act on early numbers.</div></div>`;
  const pageActs = `${clockButtons()}${v.running ? `<button class="btn" id="a-adv">Advance this test 1 day</button><button class="btn" id="a-end">Skip to the end</button>` : v.ended ? `<a class="btn primary" href="#/report/${encodeURIComponent(pick.id)}">View final report</a>` : ""}`;
  if (!cur) { el.innerHTML = head("Live Experiments", "Results up to yesterday, and the day-by-day decision.", pageActs) + `<div class="filters"><div class="field grow"><label for="live-pick">Experiment</label>${sel}</div></div>` + replayNote + hdr + (v.scheduled ? `<div class="banner"><div><b>Scheduled.</b> The setup is locked (version ${c.version || 1}). Nothing runs until ${esc(fdate(pick.sched_date || c.start))}. In this demo press Start now to play it.</div></div>` : banner) + `<div class="empty">${v.scheduled ? "No results yet: the test has not started." : 'No results yet. Press "Next day".'}</div>`; bindClock(el); wireLive(el, pick); return; }
  const ciA = armCI(cur, "A", c), ciB = armCI(cur, "B", c), goal = goalName(c), sec = secondaryList(v), lr = liftRange(cur, c), gl = guardList(v);
  const liftCol = !v.decided || fmtD(cur.diff, c) === fmtD(0, c) ? "var(--off)" : isBetter(cur.diff, c) ? "#167a70" : "#b23b3b";
  const tiles = `<div class="grid g4" style="margin-bottom:16px">
    <div class="card kpi"><div class="k"><span class="dot a"></span>A: ${esc(goal)}</div><div class="v">${fmtP(cur.rateA, c)}</div><div class="d">today's prompt · ${nf(cur.nA)} leads ${info(`95% range ${fmtP(ciA[0], c)} to ${fmtP(ciA[1], c)}`)}</div></div>
    <div class="card kpi"><div class="k"><span class="dot b"></span>B: ${esc(goal)}</div><div class="v">${fmtP(cur.rateB, c)}</div><div class="d">new prompt · ${nf(cur.nB)} leads ${info(`95% range ${fmtP(ciB[0], c)} to ${fmtP(ciB[1], c)}`)}</div></div>
    <div class="card kpi" title="B minus A. A range that includes 0 means not proven.${c.primary_direction === "lower" ? " Lower is better for this goal." : ""}"><div class="k">Lift of B over A</div><div class="v" style="color:${liftCol}">${cur.diff >= 0 ? "▲ " : "▼ "}${fmtD(cur.diff, c)}</div><div class="d">${v.decided ? "final" : "so far, grey until decided"} ${info(`${confOf(c)}% range ${rangeD(lr.lo, lr.hi, c)}; ${lr.interim ? "interim range, not corrected for repeated looks" : c.rule_set === "final_look" ? "end-of-test range" : "always-valid range: safe to read at any look"}`)}</div></div>
    ${gl.length ? guardTile(gl[0]) : `<div class="card kpi"><div class="k">Guardrails</div><div class="v" style="font-size:26px">-</div><div class="d">none set</div></div>`}</div>
    ${gl.length > 1 ? `<div class="grid g4" style="margin-bottom:16px">${gl.slice(1).map(guardTile).join("")}</div>` : ""}`;
  const harmRows = v.rows.map(({ day, row }) => { const worse = row.decision === "STOP_HARM", waiting = !worse && row.z <= -row.harm; return `<tr><td style="white-space:nowrap">Day ${day}</td><td class="num" style="white-space:nowrap">${fmtD(row.diff, c)}</td><td style="white-space:nowrap">${worse ? pill("✕ Yes: clearly worse", "neg") : waiting ? pill("Past the bar; the check starts at " + nf(c.min_per_arm) + " leads per prompt", "warn") : pill("✓ No", "pos")}</td><td class="num" style="white-space:nowrap">${row.z.toFixed(2)} / −${row.harm.toFixed(2)}</td></tr>`; }).join("");
  const needN = needLeads(pick), needed = Math.max(0, needN - cur.n);
  const decBody = `<div class="sub" style="margin-top:4px">${v.ended ? "The row that applied is highlighted." : `Pending: ${c.rule_set === "final_look" ? "final winner call on day " + v.win : "a decision when a line is crossed, or on day " + v.win}.`}</div>
    <div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>Primary goal</th><th>Guardrail</th><th>Decision</th></tr></thead><tbody>${DECISION_ROWS.map(r => { const hit = v.ended && r.k.includes(v.kind === "ROLLED_BACK" ? "PROMOTE" : v.kind === "STOPPED_MANUAL" ? "" : v.kind); return `<tr ${hit ? 'style="background:var(--blue-wash)"' : ""}><td>${esc(r.goal)}</td><td>${esc(r.guard)}</td><td>${hit ? "<b>" + esc(r.dec) + "</b> ← applied" : esc(r.dec)}</td></tr>`; }).join("")}</tbody></table></div>`;
  const evs = eventsFor(pick).sort((a, b) => a.ts < b.ts ? -1 : 1);
  const ledger = `<div class="card" id="record"><div class="sec-row"><div><h2>Decision record</h2><div class="sub">${evs.length} events with time, reason and numbers; hash-chained, so an edited entry is detected.</div></div><button class="btn sm" id="a-verify">Verify record in this browser</button></div><div id="verify-out" class="note" style="margin-top:8px"></div>
    ${fold("Show the events", `<div class="ledger">${evs.map(x => `<div class="e"><span class="note">${esc(fdt(x.ts))}</span><span><b>${esc(x.type)}</b>${x.hash ? ` <span class="mono muted">${esc(x.hash)}</span>` : ""}<br><span class="muted">${esc(x.text)}</span></span></div>`).join("")}</div>`)}</div>`;
  el.innerHTML = head("Live Experiments", "Results up to yesterday, and the day-by-day decision.", pageActs) +
    `<div class="filters"><div class="field grow"><label for="live-pick">Experiment</label>${sel}</div></div>` + replayNote + hdr + banner +
    `<div class="card" style="margin-bottom:16px"><div class="sec-row"><h2>Day by day</h2><span class="note">${v.ended ? `decided on day ${v.ld}` : `${nf(needed)} more leads needed for the planned lift`} ${info(`Leads needed: ${nf(needN)} (the ${v.win}-day window holds ${nf(rec.design.n_max)}); ${nf(cur.n)} so far. Planned to detect ${c.metrics ? `${fmtD(c.primary_direction === "lower" ? -c.mde : c.mde, c)} from ${fmtP(c.baseline, c)}` : `a ${+(c.mde * 100).toFixed(1)}-point lift from ${pct(c.baseline, 0)}`} with at least ${pct(c.power, 0)} chance.`)}</span></div>${dayStrip(v)}</div>` + tiles +
    `<div class="card" style="margin-bottom:16px"><div class="sec-row"><div><h2 title="Cumulative goal rate for A and B by day. Shaded bands are 95% ranges.">Daily trend</h2><div class="sub">${esc(goal)}${c.metrics ? "" : " rate"}, A against B, with shaded 95% ranges</div></div><button class="btn sm" id="a-csv">Export CSV</button></div>
      <div class="legend"><span><i style="border-color:var(--a)"></i>A (today's prompt)</span><span><i style="border-color:var(--b)"></i>B (new prompt)</span><span><i class="band" style="background:var(--ink-2)"></i>95% range</span></div><div id="trend"></div></div>
    ${sec.length ? `<div class="card" style="margin-bottom:16px" id="secondary"><h2>Secondary (for insight only, not used for the decision)</h2><div style="margin-top:12px">${secondaryHtml(v)}</div></div>` : ""}
    ${v.holdback ? holdbackCard(pick, v) : ""}${splitHealth(pick, v)}
    <div class="grid g2" style="margin-bottom:16px;align-items:start"><div>${fold("Harm monitor", `<div class="sub">Every day: is B clearly worse, and by how much? The bar is very strict (${pct(1 - (c.alpha_harm_daily || 0.001), 1)} for the one-look rule) so one bad day does not trigger it.</div><div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>Day</th><th class="num">B vs A (how much)</th><th>Is B clearly worse?</th><th class="num">z / stop line</th></tr></thead><tbody>${harmRows}</tbody></table></div>`, "the daily stop check", false, "harm-monitor")}</div>
      <div>${fold("Decision rule", decBody, "what the engine does at each outcome", false, "decision-rule")}</div></div>
    ${ledger}`;
  const fd = c.rule_set === "final_look" ? v.win : null;
  const draw = () => trendChart($("#trend"), v.rows, v.win, { finalDay: fd, c });
  draw(); window.__redraw = draw;
  bindClock(el); wireLive(el, pick);
};
window.addEventListener("resize", () => { if (CUR.name === "live" && window.__redraw) window.__redraw(); });

function wireLive(el, e) {
  const v = view(e), d = dyn(e), $1 = s => $(s, el);
  const pickEl = $1("#live-pick"); if (pickEl) pickEl.onchange = () => go("live", pickEl.value);
  const a = (id, fn) => { const b = $1(id); if (b) b.onclick = fn; };
  a("#a-start", () => { d.started = true; logAction(e, "Started", `Started on the scheduled date (a console action: in this demo a person pressed Start now).`); saveDyn(); route(); });
  const playHold = (all) => { const H = (view(e).holdback || {}).all; if (!H) return; do { const r = holdStep(e); if (!r.played) break; if (r.msg) toast(r.msg); } while (all && !dyn(e).rolledBack && (d.hold || 0) < H.days && !H.rows[d.hold - 1].alert); saveDyn(); refresh(); };
  a("#a-hold", () => playHold(false)); a("#a-hold-all", () => playHold(true));
  a("#a-adv", () => { advance(e); route(); });
  a("#a-end", () => { d.day = view(e).ld; saveDyn(); toast(`${e.record.config.name}: ${KIND_LABEL[view(e).kind] || view(e).kind}`); route(); });
  a("#a-pause", () => { d.paused = !d.paused; logAction(e, d.paused ? "Paused" : "Resumed", `${d.paused ? "Paused" : "Resumed"} by a person on day ${v.day} (a console action; the engine is not involved).`); saveDyn(); route(); });
  a("#a-stop", () => { if (!confirm("Stop this test now? B's leads go back to A and the test ends.")) return; d.manualStop = true; logAction(e, "Stopped", `Stopped by a person on day ${v.day}. B's leads go back to A (a console action).`); saveDyn(); route(); });
  a("#a-approve", () => { d.approval = "approved"; d.auto = false; saveDyn(); toast("Approved. The click is added to the record."); route(); });
  a("#a-reject", () => { d.approval = "rejected"; d.auto = false; saveDyn(); toast("Rejected. A stays live."); route(); });
  a("#a-roll", () => { d.rolledBack = true; d.autoRoll = false; saveDyn(); toast("Rolled back. The click is added to the record."); route(); });
  a("#a-csv", () => download(`${e.id}_daily.csv`, primaryDef(v.config).type === "average" ? toCsv(["day", "leads_A", "counted_A", "leads_B", "counted_B", "mean_A", "mean_B", "lift_" + (metricUnit(primaryDef(v.config)) || "units"), "z", "stop_line"], v.rows.map(({ day, row }) => [day, row.nA, row.dA, row.nB, row.dB, row.rateA.toFixed(3), row.rateB.toFixed(3), row.diff.toFixed(3), row.z.toFixed(3), (-row.harm).toFixed(3)]))
    : toCsv(["day", "leads_A", "goal_A", "leads_B", "goal_B", "rate_A", "rate_B", "lift_pp", "z", "stop_line"], v.rows.map(({ day, row }) => [day, row.nA, row.xA, row.nB, row.xB, row.rateA.toFixed(4), row.rateB.toFixed(4), (row.diff * 100).toFixed(2), row.z.toFixed(3), (-row.harm).toFixed(3)]))));
  a("#a-verify", async () => { const ents = e.record.ledger.concat(tailOf(e.record, d)); let ok; try { ok = await chainOk(ents); } catch (err) { $1("#verify-out").textContent = String(err.message || err); return; } $1("#verify-out").innerHTML = ok ? `<span style="color:#167a70;font-weight:600">✓ Chain intact</span>: ${ents.length} entries re-hashed just now, head <span class="mono">${esc(ents[ents.length - 1].hash.slice(0, 12))}</span>.` : `<span style="color:#b23b3b;font-weight:600">✕ Record BROKEN</span>: an entry was changed.`; });
}
