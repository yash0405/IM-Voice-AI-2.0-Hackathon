/* Suggest A/B Tests, Import results files, and start-up. */

const SF = DYN.ui.sug || { source: "all" };
function priority(c) {
  const score = (c.expected_pp || 0) * (c.ease || 0);
  return { score, label: c.disabled ? ["Unavailable", "plain"] : !c.expected_pp ? ["Follow-up", "run"] : score >= 6 ? ["High", "pos"] : score >= 3 ? ["Medium", "warn"] : ["Low", "plain"] };
}
const v_ok = e => !!e.record && e.record.config.variant_b !== "external";
function historyIdeas() {
  const out = [];
  EXPS().filter(e => ["past_fix_flat", "past_inconclusive"].includes(e.id) || !e.id.startsWith("past_") && !e.id.startsWith("files_")).forEach(e => { const v = view(e); if (v.ended && v.kind === "INCONCLUSIVE" && v.res.more_leads && e.kind !== "files") { const opt = (v.res.more_leads.options || []).find(o => !o.enough_already && !o.impractical); if (opt) out.push({ id: "past_" + e.id, source: "Past tests", title: `Re-run "${e.record.config.name}" for longer`, hypothesis: `It ended inconclusive on day ${v.ld}. Detecting ${opt.lift_pp} points would take about ${nf(opt.more_leads)} more leads (about ${opt.more_days} days). Worth it only if a lift that small matters.`, patch: e.record.variants.B.name, patch_name: e.record.variants.B.name, patch_note: "The same edit as the original test.", metric: e.record.config.primary_goal, expected: `settles whether ${opt.lift_pp} points is real`, expected_pp: 0, days: Math.round(v.ld + opt.more_days), ease: 3, caveat: "", variant: e.record.config.variant_b, e }); } });
  EXPS().forEach(e => { const l = dyn(e).learning; if (l && v_ok(e)) out.push({ id: "learn_" + e.id, source: "Past tests", title: `Follow up on "${l}"`, hypothesis: `You tagged "${e.record.config.name}" with: "${l}". Try a follow-up edit on the same idea.`, patch: e.record.variants.B.name, patch_name: e.record.variants.B.name, patch_note: "The same edit as the original test.", metric: e.record.config.primary_goal, expected: "a follow-up to what you learned", expected_pp: 0, days: null, ease: 2, caveat: "", variant: e.record.config.variant_b }); });
  return out.slice(0, 6);
}
function createFrom(c) { startWizard({ name: c.title, change: c.hypothesis, variant: c.variant || "cap_two_asks", why: c.caveat || "", effect: c.expected, mde: c.expected_pp ? Math.max(0.01, c.expected_pp / 100) : SET().mde }); }
ROUTES.suggest = (el) => {
  const base = C.suggestions.filter(c => !c.from_history), hi = historyIdeas(), all = [...base, ...hi], sources = [...new Set(all.map(c => c.source))];
  const list = all.filter(c => SF.source === "all" || c.source === SF.source), learn = EXPS().map(e => dyn(e).learning && { n: e.record.config.name, t: dyn(e).learning }).filter(Boolean);
  el.innerHTML = head("Suggest A/B Tests", "Ideas for the next tests, each with its evidence and a one-click start. Nothing is invented: where a source has no data, the card says so.") +
    `<div class="filters"><div class="field"><label for="g-src">Idea source</label><select id="g-src"><option value="all">All sources</option>${sources.map(s => `<option ${SF.source === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></div><div class="field grow"><label>&nbsp;</label><span class="note">Priority = expected impact × ease. Expected effects are planning figures, not measurements.</span></div></div>
    <div class="grid g2">${list.map(c => { const p = priority(c), cand = C.library.candidates.find(x => x.key === c.variant); return `<div class="card" style="display:grid;gap:12px;${c.disabled ? "opacity:.7" : ""}"><div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div><span class="tag">${esc(c.source)}</span><h3 style="margin-top:8px;font-size:16px">${esc(c.title)}</h3></div>${pill(p.label[0] + (c.expected_pp ? " priority" : ""), p.label[1])}</div>
      <p style="font-size:13px">${esc(c.hypothesis)}</p><dl class="kv" style="grid-template-columns:130px 1fr"><dt>Proposed patch</dt><dd>${c.patch ? esc(c.patch_name || (cand ? cand.name : c.patch)) : `<span class="muted">${esc(c.patch_note)}</span>`}${c.patch ? `<div class="note">${esc(c.patch_note)}</div>` : ""}</dd><dt>Target metric</dt><dd>${c.metric ? esc((C.metrics.find(m => m.key === c.metric) || {}).name || c.metric) : "-"}</dd><dt>Expected effect</dt><dd>${esc(c.expected)}</dd>
        <dt>Days needed</dt><dd>${c.days ? `about <b>${c.days >= 100 ? nf(c.days) : c.days}</b> days at ${nf(SET().leads_per_day)} leads a day, ${pct(SET().share_b, 0)} to B` : "-"}</dd><dt>Priority</dt><dd>${c.expected_pp ? `impact ${c.expected_pp} pp × ease ${c.ease} = ${p.score.toFixed(1)}` : "-"}</dd></dl>
      ${c.caveat ? `<p class="note">${esc(c.caveat)}</p>` : ""}<div class="actions"><button class="btn primary" data-create="${esc(c.id)}" ${c.disabled ? "disabled" : ""}>Create experiment</button></div></div>`; }).join("")}</div>
    ${learn.length ? `<div class="card" style="margin-top:16px"><h2>Learnings from History</h2><div class="sub">One line saved on each finished test. They shape the next ideas.</div><ul style="margin:8px 0 0;padding-left:20px;font-size:13px">${learn.map(l => `<li><b>${esc(l.t)}</b> <span class="muted">(${esc(l.n)})</span></li>`).join("")}</ul></div>` : ""}`;
  $("#g-src").onchange = ev => { SF.source = ev.target.value; DYN.ui.sug = SF; saveDyn(); route(); };
  $$("[data-create]", el).forEach(b => b.onclick = () => createFrom(all.find(x => x.id === b.dataset.create)));
};

/* ------------------------------------------------------------------ Import results files: the voice test ran elsewhere; we judge its results */
let IM = { files: [], info: null, err: "" };
ROUTES.import = (el) => {
  const plan = { baseline: 0.45, share_b: 0.30, mde: 0.05, window_days: 14, rule_set: "sequential", ...(DYN.ui.importPlan || {}) };
  el.innerHTML = head("Import results files", "The voice test ran somewhere else. Give Canary the results (one row per call: lead, which prompt, what happened, call length, when) and it decides with the plan you fix here. It advises: it does not change live traffic.", `<a class="btn" href="#/new">Back to New Experiment</a>`) +
    (!LIVE ? `<div class="banner warn"><div><b>Reading your own files needs the live version.</b> Run <span class="mono">./start.sh</span>. Meanwhile, History already holds six decisions made from sample result files.</div></div>` : "") +
    `<div class="g-main grid"><div class="card"><h2>1. Choose the files</h2><div class="sub">One file with a variant column, or two files (A's results, then B's). CSV, tab-separated or JSON; column names are matched flexibly.</div>
      <div class="form-grid" style="margin-top:16px"><div class="field wide"><label for="i-files">Results file(s)</label><input type="file" id="i-files" multiple accept=".csv,.tsv,.txt,.json,.jsonl" ${LIVE ? "" : "disabled"}></div>
        <div class="field"><label for="i-two">If two files</label><select id="i-two"><option value="">One file with a variant column</option><option value="first">First file is A, second is B</option></select></div>${LIVE ? `<div class="field"><label for="i-sample">Or try a synthetic sample</label><select id="i-sample"><option value="">Choose...</option><option value="b_wins">B wins</option><option value="b_harmful">B is worse</option><option value="b_flat">No real difference</option><option value="guardrail_hold">B wins, calls longer</option><option value="early_hangup">B wins, more early hang-ups</option><option value="messy">A messy export</option></select></div>` : ""}</div>
      <div id="i-info" style="margin-top:16px"></div>
      <h2 style="margin-top:24px">2. Fix the plan</h2><div class="sub">The plan sets the decision lines. Write it down before the test starts: numbers picked after seeing results would bend the answer.</div>
      <div class="form-grid" style="margin-top:16px"><div class="field"><label for="i-name">Name</label><input type="text" id="i-name" value="${esc(plan.name || "Results from files")}"></div><div class="field"><label for="i-goal">Which outcomes count as success</label><input type="text" id="i-goal" placeholder="buylead_created"></div>
        <div class="field"><label for="i-base">Expected rate under A (%) <span class="hint">required</span></label><input type="number" id="i-base" value="${Math.round(plan.baseline * 100)}"></div><div class="field"><label for="i-share">Share of traffic sent to B (%) <span class="hint">required</span></label><input type="number" id="i-share" value="${Math.round(plan.share_b * 100)}"></div>
        <div class="field"><label for="i-days">Test length (days) <span class="hint">required</span></label><input type="number" id="i-days" value="${plan.window_days}"></div><div class="field"><label for="i-mde">Smallest lift worth detecting (points)</label><input type="number" id="i-mde" value="${Math.round(plan.mde * 100)}"></div>
        <div class="field"><label for="i-rule">Decision rule</label><select id="i-rule"><option value="sequential" ${plan.rule_set === "sequential" ? "selected" : ""}>Early promote and early stop</option><option value="final_look" ${plan.rule_set === "final_look" ? "selected" : ""}>One winner call at the end + daily harm check</option></select></div><div class="field"><label for="i-hang">Early hang-up guardrail <span class="hint">calls shorter than (seconds)</span></label><input type="number" id="i-hang" placeholder="off"></div></div>
      <div class="actions" style="margin-top:16px"><button class="btn primary" id="i-go" ${LIVE ? "" : "disabled"}>Decide</button><span id="i-err" class="note" style="color:#b23b3b"></span></div></div>
      <div class="card"><h3>What the files should look like</h3><div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th>Column</th><th>Why</th></tr></thead><tbody><tr><td class="mono">lead_id</td><td>count each lead once</td></tr><tr><td class="mono">variant</td><td>A or B (also control / test)</td></tr><tr><td class="mono">disposition</td><td>what happened</td></tr><tr><td class="mono">timestamp</td><td>read day by day</td></tr><tr><td class="mono">duration_s</td><td>the call-length guardrail</td></tr></tbody></table></div><p class="note" style="margin-top:8px">A daily summary also works: date, variant, leads, goal_count (plus mean and sd duration). It cannot show whether a lead saw both prompts.</p></div></div>`;
  const info = $("#i-info");
  const inspect = async () => {
    const f = IM.files[0]; if (!f) { info.innerHTML = ""; return; }
    info.innerHTML = `<span class="spin"></span> Looking at ${esc(f.name)}...`;
    try {
      const r = await fetch("/api/inspect", { method: "POST", body: JSON.stringify({ name: f.name, text: f.text }) }), j = await r.json(); if (j.error) throw new Error(j.error);
      IM.info = j; const outs = (j.outcomes || []).map(([k, n]) => `<label class="chk" style="border:1px solid var(--line);border-radius:999px;padding:2px 12px;background:var(--bg)"><input type="checkbox" data-out="${esc(k)}" ${/buylead|lead_created|converted|success|meeting|enrich/i.test(k) ? "checked" : ""}> ${esc(k)} <span class="muted">${nf(n)}</span></label>`).join(" ");
      info.innerHTML = `<div class="banner"><div><b>${nf(j.rows)} rows${j.leads ? `, ${nf(j.leads)} leads` : ""}${j.days ? `, ${j.days} days` : ""}.</b> Prompts found: ${Object.entries(j.variants || {}).map(([k, n]) => `${esc(k)} (${nf(n)})`).join(", ") || "none: use two files"}.${outs ? `<div style="margin-top:8px"><b>Tick the outcomes that count as success</b></div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">${outs}</div>` : ""}${j.lead_column ? "" : `<div class="note" style="margin-top:8px">No lead id column: every call will count as its own lead.</div>`}</div></div>`;
      const sync = () => { $("#i-goal").value = $$("#i-info [data-out]").filter(c => c.checked).map(c => c.dataset.out).join(","); }; $$("#i-info [data-out]").forEach(c => c.onchange = sync); sync();
    } catch (e) { info.innerHTML = `<div class="banner neg"><div>${esc(String(e.message || e))}</div></div>`; }
  };
  const fi = $("#i-files"); fi.onchange = async () => { IM.files = await Promise.all([...fi.files].map(async f => ({ name: f.name, text: await f.text() }))); inspect(); };
  const smp = $("#i-sample"); if (smp) smp.onchange = async () => { if (!smp.value) return; const r = await fetch("/api/sample/" + smp.value), j = await r.json(); IM.files = [{ name: j.name, text: j.text }]; if (smp.value === "early_hangup") $("#i-hang").value = 15; $("#i-mde").value = 7; inspect(); };
  $("#i-go").onclick = async () => {
    const err = $("#i-err"); err.textContent = ""; if (!IM.files.length) { err.textContent = "Choose a file first."; return; }
    const two = $("#i-two").value === "first" && IM.files.length === 2, files = IM.files.map((f, i) => ({ ...f, arm: two ? (i === 0 ? "A" : "B") : null }));
    const opts = { goal: $("#i-goal").value.trim(), baseline: +$("#i-base").value / 100 || null, share_b: +$("#i-share").value / 100 || null, window_days: +$("#i-days").value || null, mde: (+$("#i-mde").value || 5) / 100, rule_set: $("#i-rule").value, guard_name: $("#i-hang").value ? "early_hangup" : "", guard_below_s: $("#i-hang").value ? +$("#i-hang").value : null, name: $("#i-name").value, exp_id: "exp-files" };
    $("#i-go").disabled = true; $("#i-go").innerHTML = `<span class="spin"></span> Deciding...`;
    try {
      const r = await fetch("/api/decide", { method: "POST", body: JSON.stringify({ files, opts }) }), j = await r.json(); if (j.error) throw new Error(j.error);
      const id = "files-" + Date.now(); const exp = { id, kind: "files", preset: "Results files", hypothesis: `Results supplied as ${IM.files.map(f => f.name).join(", ")}.`, truth: null, record: j.record, start_day: 9999 };
      DYN.launched.unshift(exp); DYN.dyn[id] = { day: 9999, paused: false, approval: null, rolledBack: false, manualStop: false, learning: "" }; saveDyn(); toast(`Decision: ${KIND_LABEL[j.record.result.kind] || j.record.result.kind}`); go("report", id);
    } catch (e) { err.textContent = String(e.message || e); $("#i-go").disabled = false; $("#i-go").textContent = "Decide"; }
  };
};

/* ------------------------------------------------------------------ start */
async function init() {
  if (LIVE) { try { C = await (await fetch("/api/console")).json(); } catch (e) { $("#page").innerHTML = `<div class="empty">Could not reach the engine.</div>`; return; } }
  $("#mode").textContent = LIVE ? "Live engine" : "Offline demo"; $("#mode").className = "pill " + (LIVE ? "pos" : "plain");
  $("#reset-link").onclick = () => go("settings");
  window.addEventListener("hashchange", route); route();
}
init();
