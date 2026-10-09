/* New Experiment: six steps on one page with a sticky calculator on the right (BRD): Hypothesis, Prompt B, Audience, Goals, Traffic and duration, Review.
   Everything is decided before launch; Save Test keeps an editable draft, Launch Test locks the setup and gives it a version ID. */

const WSTEPS = ["Hypothesis", "Prompt B", "Audience", "Goals", "Traffic and duration", "Review and launch"];
let WZ = null;
DYN.drafts = DYN.drafts || [];
const wzDefaults = () => { const s = SET(); return { step: 1, name: "", change: "", why: "", effect: "", mode: "patch", variant: "cap_two_asks", fullText: "",
  segMode: "all", segText: "", segRules: [], segMsg: "", share: s.share_b, lpd: s.leads_per_day, assignment: s.assignment || "stratified",
  metric: "buylead_created", direction: "higher", durOn: true, durMargin: Math.round(s.duration_margin * 100), hangOn: false, hangMargin: s.rate_margin_pp, goalsTouched: false,
  baseline: s.baseline, liftRel: Math.round((s.lift_rel || 0.10) * 100), days: s.window_days, daysAuto: true, confidence: s.confidence, rule: s.rule_set, harm: s.harm_bar, minLeads: s.min_leads_per_arm, approval: s.approval,
  startDate: TODAY, source: "sim", preset: "win", effectRel: 15, seed: 7, draftId: null }; };
function startWizard(prefill) {
  const p = { ...(prefill || {}) };
  if (p.mde != null && p.liftRel == null) { const b = p.baseline != null ? p.baseline : SET().baseline; p.liftRel = Math.max(1, Math.round(p.mde / b * 100)); delete p.mde; }
  if (p.days != null) p.daysAuto = false;
  WZ = { ...wzDefaults(), ...p }; go("new");
}
const wzSeg = w => ({ rules: w.segMode === "segment" ? w.segRules.filter(r => preCall().some(v => v.name === r.var)) : [], text: w.segText });      // a variable switched off in Settings no longer counts
const wzMde = w => Math.max(0.005, w.baseline * w.liftRel / 100);

function applyOwn(base, op, anchor, find, nw) {
  const lines = base.split("\n"); if (!anchor.trim()) throw new Error("Type a phrase that identifies the line in the base prompt.");
  const hits = lines.map((l, i) => l.includes(anchor) ? i : -1).filter(i => i >= 0);
  if (hits.length !== 1) throw new Error(`That phrase matches ${hits.length} line${hits.length === 1 ? "" : "s"} in the base prompt; it must match exactly one. Make it longer or more specific.`);
  const i = hits[0];
  if (op === "replace") { if (!find || !lines[i].includes(find)) throw new Error(`"${find}" is not in that line.`); lines[i] = lines[i].replace(find, nw); }
  else if (op === "add") { if (!nw.trim()) throw new Error("Type the new line."); lines.splice(i + 1, 0, nw); }
  else lines.splice(i, 1);
  return lines.join("\n");
}
function replayFor(w) {                                  // offline: the closest pre-computed run of the spec's presets
  const eff = (w.effectRel || 0) / 100; let id = eff > 0.05 ? "demo_win" : eff < -0.05 ? "demo_worse" : "demo_flat";
  if ((w.durExtra || 0) >= 8 && eff > 0.05) id = "demo_hold"; else if (eff > 0.05 && w.segMode === "segment" && w.segRules.length) id = "demo_segment"; return C.demo.find(d => d.id === id);
}
const wzPrompt = w => w.mode === "full" ? w.fullText : w.variant === "__own" ? (w.ownText || "") : "";
function baseVars() { return (C.library.variables || []); }
function varCheck(text) {
  const tags = (text.match(/{[{%][\s\S]*?[}%]}/g) || []).join(" "), missing = baseVars().filter(v => !new RegExp("\\b" + v + "\\b").test(tags));
  return { ok: missing.length === 0, missing, n: baseVars().length };
}
function diffSides(lines) {
  const L = [], R = [];
  for (const l of lines || []) {
    if (l.startsWith("---") || l.startsWith("+++")) continue;
    if (l.startsWith("@@")) { L.push(["hdr", l]); R.push(["hdr", l]); }
    else if (l.startsWith("-")) { L.push(["del", l.slice(1)]); R.push(["", ""]); }
    else if (l.startsWith("+")) { L.push(["", ""]); R.push(["add", l.slice(1)]); }
    else { L.push(["", l.slice(1)]); R.push(["", l.slice(1)]); }
  }
  const col = X => `<div class="diff">${X.map(([c, t]) => `<div class="${c}">${esc(t) || "&nbsp;"}</div>`).join("")}</div>`;
  return `<div class="diff2"><div><div class="note" style="padding:4px 8px">A: production prompt (read-only)</div>${col(L)}</div><div><div class="note" style="padding:4px 8px">B: candidate</div>${col(R)}</div></div>`;
}
function lineDiff(a, b) {                                   // client-side diff of a pasted prompt: trim the common ends, compare the middle
  const A = a.split("\n"), B = b.split("\n"); let s = 0; while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let ea = A.length, eb = B.length; while (ea > s && eb > s && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
  const out = ["@@ changed region @@"]; if (ea - s > 400 || eb - s > 400) return [...out, "-(" + (ea - s) + " lines replaced)", "+(" + (eb - s) + " lines new)"];
  for (let i = Math.max(0, s - 1); i < s; i++) out.push(" " + A[i]); for (let i = s; i < ea; i++) out.push("-" + A[i]); for (let i = s; i < eb; i++) out.push("+" + B[i]); for (let i = ea; i < Math.min(A.length, ea + 1); i++) out.push(" " + A[i]); return out;
}

/* ---- the calculator: how many leads, how many days, what can be detected, and a green / amber / red light */
const clampDays = d => Math.min(28, Math.max(7, Math.ceil(d / 7 - 1e-9) * 7));
function calc(w) {
  const seg = wzSeg(w), share = segShare(seg), lpd = +w.lpd || 1, elig = lpd * share, alpha = (1 - w.confidence) / 2, seq = w.rule === "sequential", mde = wzMde(w);
  const need = leadsNeeded(w.baseline, mde, w.share, alpha, 0.8, seq), rawDays = need / elig, rec = clampDays(rawDays);
  if (w.daysAuto) w.days = rec;
  const days = +w.days || 7, nAll = elig * days, nB = nAll * w.share, det = detectableLift(nAll, w.baseline, w.share, alpha, 0.8, seq), cv = (C.plans || {}).duration_cv || 0.55;
  const se = cv * Math.sqrt(1 / Math.max(2, nB) + 1 / Math.max(2, nAll - nB)), gp = normCdf((w.durMargin / 100) / se - normPpf(1 - alpha));
  const harmStart = Math.ceil(Math.max(w.minLeads / (elig * w.share), w.minLeads / (elig * (1 - w.share))));       // the day both arms have the minimum leads
  const fits = nAll >= need, tooBig = rawDays > 28;
  const light = tooBig ? "red" : (!fits || harmStart > days) ? "amber" : "green";
  const msg = tooBig ? "Segment too small. Widen the segment or raise the B share." : !fits ? `The chosen ${days} days are too short for a ${(mde * 100).toFixed(1)}-point lift: use ${rec} days.` : harmStart > days ? `The daily harm check would not start inside ${days} days (each prompt needs ${nf(w.minLeads)} leads first). Lower the minimum or raise B's share.` : "This test can finish: the window holds enough leads.";
  return { share, elig, nAll, nB, need, rawDays, rec, days, det, gp, fits, tooBig, light, msg, mde, harmStart, strata: planStrata(nAll, seg) };
}
function calcPanel(w) {
  const c = calc(w), lightLbl = { green: "Ready", amber: "Check this", red: "Will not finish" }[c.light];
  return `<div class="card calc" aria-live="polite"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><h3>Calculator</h3><span class="light ${c.light}"><i></i>${lightLbl}</span></div>
    <dl class="kv" style="margin-top:8px;grid-template-columns:1fr auto"><dt>Eligible leads a day</dt><dd class="num">${nf(c.elig)}</dd><dt>Leads in ${c.days} days</dt><dd class="num">${nf(c.nAll)}</dd><dt>of which on B</dt><dd class="num">${nf(c.nB)}</dd><dt>Baseline rate (A)</dt><dd class="num">${pct(w.baseline, 0)}</dd>
      <dt>Smallest lift it can detect</dt><dd class="num">${(c.det * 100).toFixed(1)} pts</dd><dt>Lift you want to detect</dt><dd class="num">${(c.mde * 100).toFixed(1)} pts</dd><dt>Days needed</dt><dd class="num"><b>${c.rawDays > 99 ? "99+" : c.rawDays.toFixed(1)}</b> → ${c.tooBig ? "over 28" : c.rec + " (whole weeks)"}</dd><dt>Harm check starts</dt><dd class="num">day ${c.harmStart > 60 ? "60+" : c.harmStart}</dd></dl>
    <div class="banner ${c.light === "green" ? "pos" : c.light === "amber" ? "warn" : "neg"}" style="margin:12px 0 0;padding:8px 12px"><div style="font-size:13px">${esc(c.msg)}</div></div></div>`;
}

/* ---- agent-style suggestions, done with plain rules (no language model): the share, and the goal cards */
function suggestShare(w) {
  const base = C.library.base_text || "", cand = C.library.candidates.find(x => x.key === w.variant);
  const lines = w.mode === "full" ? lineDiff(base, w.fullText || base) : w.variant === "__own" ? lineDiff(base, w.ownText || base) : ((cand || {}).diff || []);
  const n = lines.filter(l => (l.startsWith("+") || l.startsWith("-")) && !l.startsWith("+++") && !l.startsWith("---")).length;
  return n <= 12 ? { share: 0.30, why: `a small wording change (${n} changed lines): 30 to 50% is enough` } : { share: 0.10, why: `a bigger change (${n} changed lines): start with 10% to limit the risk` };
}
function suggestGoals(w) {
  const t = [w.name, w.change, w.why, w.effect].join(" ").toLowerCase(), m = /call.?back/.test(t) ? "callback_fixed" : /meeting/.test(t) ? "meeting_fixed" : /enrich/.test(t) ? "bl_enriched" : "buylead_created", hang = /hang|drop|abandon|early|greeting|opening|intro|first line/.test(t);
  return { metric: m, hangOn: hang, why: `Suggested from your hypothesis: primary goal ${(C.metrics.find(x => x.key === m) || {}).name}, call length as a guardrail${hang ? ", plus early hang-ups because the change touches how the call opens" : ""}.` };
}

/* ---- overlap and the pre-launch checklist */
const segsOverlap = (a, b) => CAT().variables.filter(v => v.pre_call).every(v => { const x = segAllowed(a, v.name), y = segAllowed(b, v.name); return x.some(t => y.includes(t)); });
function runningMain() { return DYN.launched.filter(e => e.world === "main").filter(e => { const v = view(e); return v.running || v.scheduled || (v.d.paused && !v.ended); }); }
function checklist(w) {
  const c = calc(w), seg = wzSeg(w), vcOk = w.mode === "full" ? varCheck(w.fullText || "") : w.variant === "__own" ? varCheck(w.ownText || "") : { ok: ((C.library.candidates.find(x => x.key === w.variant) || { variables: { ok: true } }).variables.ok), missing: [] };
  const clash = runningMain().filter(e => segsOverlap(seg, segOf(e) || {}));
  return [
    { ok: true, label: "Exactly one primary goal", why: "The primary goal decides; guardrails can only veto.", step: 4 },
    { ok: vcOk.ok, label: "Prompt variables such as {seller_name} are intact in B", why: vcOk.ok ? `All ${baseVars().length} template variables are still used.` : `B no longer uses: ${(vcOk.missing || []).join(", ") || "a variable"}.`, step: 2 },
    { ok: c.fits && !c.tooBig, label: "The segment has enough leads for the duration", why: c.fits && !c.tooBig ? `${nf(c.nAll)} leads in ${c.days} days against ${nf(c.need)} needed.` : c.msg, step: 3 },
    { ok: c.days >= 7 && c.days <= 28 && c.days % 7 === 0, label: "Duration is 7 to 28 days, in whole weeks", why: `${c.days} days (a full week of patterns, no endless tests).`, step: 5 },
    { ok: clash.length === 0, label: "No running test overlaps the same leads", why: clash.length ? `${clash.map(e => e.record.config.name).join("; ")} already runs on these leads. Finish it first, or pick a different segment.` : "Nothing else is running on these leads.", step: 3 }];
}

function wzValid(w, step) {
  if (step === 1 && !w.name.trim()) return "Give the test a name.";
  if (step === 2) { if (w.mode === "patch" && w.variant === "__own") { if (!w.ownText) return "Press Preview patch to check your edit first."; const vc = varCheck(w.ownText); if (!vc.ok) return `Prompt B no longer uses: ${vc.missing.join(", ")}.`; } else if (w.mode === "full") { if (w.fullText.trim().length < 200) return "Paste the full prompt, or start from the base prompt."; const vc = varCheck(w.fullText); if (!vc.ok) return `Prompt B no longer uses: ${vc.missing.join(", ")}.`; } else { const cand = C.library.candidates.find(c => c.key === w.variant); if (cand && !cand.variables.ok) return `This patch drops variables: ${cand.variables.dropped.join(", ")}.`; } }
  if (step === 3) { if (w.segMode === "segment") { if (!w.segRules.length) return "Pick at least one condition, or choose All leads."; if (segShare(wzSeg(w)) < CAT().min_share) return `This segment is under ${pct(CAT().min_share, 0)} of traffic. Widen it.`; } }
  if (step === 5) { if (!(w.share >= 0.05 && w.share <= 0.5)) return "The share for B must be between 5% and 50%."; if (!(w.lpd >= 10)) return "Leads per day must be at least 10."; if (!(w.liftRel >= 1 && w.liftRel <= 100)) return "The expected lift must be between 1% and 100%."; if (w.baseline + wzMde(w) >= 0.99) return "Baseline plus the smallest lift must stay below 99%."; if (w.days * w.lpd > 60000) return "Days x leads per day is capped at 60,000 for the live demo."; }
  return "";
}
const F = (label, inner, hint) => `<div class="field"><label>${label}${hint ? ` <span class="hint">${hint}</span>` : ""}</label>${inner}</div>`;
const arrow = d => d === "lower" ? "↓" : "↑";

function goalCards(w) {
  const metrics = C.metrics, prim = metrics.find(m => m.key === w.metric) || metrics[0], segName = segRules(wzSeg(w)).length ? "this segment" : "all leads";
  const used = [w.durOn && "duration_s", w.hangOn && "early_hangup"].filter(Boolean), cardG = (key, name, def, extra) => `<div class="goal-card"><span class="role g">Guardrail</span><button class="x" data-del="${key}" aria-label="Remove ${esc(name)}" title="Remove">×</button><b>${esc(name)}</b><div class="def">${esc(def)}</div><div class="meta"><span class="arrow" title="lower is better">↓</span> ${extra}</div></div>`;
  const addG = ["duration_s", "early_hangup"].filter(k => !used.includes(k)), addGoals = metrics.filter(m => m.role === "goal" && m.key !== w.metric);
  return `<div class="goal-row"><div class="goal-card primary"><span class="role">Primary</span><b>${esc(prim.name)}</b><div class="def">${esc(prim.dispositions.length ? "Leads with at least one: " + prim.dispositions.join(", ") : prim.note)}; out of ${esc(prim.denominator)}</div>
      <div class="meta"><span class="arrow">${arrow(w.direction)}</span> <select id="w-dir" aria-label="Direction" style="width:auto;min-height:28px;padding:2px 8px"><option value="higher" ${w.direction === "higher" ? "selected" : ""}>higher is better</option><option value="lower" ${w.direction === "lower" ? "selected" : ""}>lower is better</option></select> · baseline ${pct(w.baseline, 0)} for ${segName} (assumed)</div>
      <div class="meta" style="margin-top:8px"><label for="w-swap" class="note">Swap the primary goal (it cannot be removed)</label><select id="w-swap" style="min-height:28px;padding:2px 8px">${metrics.filter(m => m.role === "goal").map(m => `<option value="${esc(m.key)}" ${w.metric === m.key ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select></div></div>
    ${w.durOn ? cardG("duration_s", "Call duration", "Average talk time per lead, compared on a ratio with a range", `must not rise more than <input type="number" id="w-durm" min="1" max="100" value="${w.durMargin}" style="width:64px;display:inline-block;min-height:28px;padding:2px 8px"> %`) : ""}
    ${w.hangOn ? cardG("early_hangup", "Early hang-ups", "Calls cut in the first 15 seconds (our assumed cut-off) out of all leads", `must not rise more than <input type="number" id="w-hangm" min="1" max="20" value="${w.hangMargin}" style="width:64px;display:inline-block;min-height:28px;padding:2px 8px"> points`) : ""}
    <div class="goal-card add"><label for="w-add" class="note">Add a metric</label><select id="w-add" ${used.length >= 3 ? "disabled" : ""}><option value="">+ Add metric…</option>${addG.length && used.length < 3 ? `<optgroup label="As a guardrail">${addG.map(k => `<option value="g:${k}">${k === "duration_s" ? "Call duration" : "Early hang-ups"}</option>`).join("")}<option value="" disabled>Fatal calls (needs a flag in result files)</option></optgroup>` : ""}<optgroup label="As the primary goal (replaces the current one)">${addGoals.map(m => `<option value="p:${esc(m.key)}">${esc(m.name)}</option>`).join("")}</optgroup></select>
      <div class="note" style="margin-top:8px">One primary and up to 3 guardrails. This build computes two guardrails on simulated traffic (call duration, early hang-ups); a fatal-call guardrail works on result files that carry the flag.</div></div></div>`;
}

function segPicker(w) {
  const sel = (name, val) => w.segRules.some(r => r.var === name && r.values.includes(val));
  return preCall().map(v => `<div class="field wide"><label>${esc(v.label)} <span class="hint">${esc(v.meaning)}${w.segRules.some(r => r.var === v.name) ? "" : " · no limit"}</span></label><div class="chips">${v.values.map(val => `<label class="chip"><input type="checkbox" data-sv="${esc(v.name)}" value="${esc(val)}" ${sel(v.name, val) ? "checked" : ""}> ${esc(val)}</label>`).join("")}</div></div>`).join("");
}

function wzBody(w) {
  const s = w.step;
  if (s === 1) return `<h2>1. Hypothesis</h2><p class="sub">What are you testing, and why do you expect it to help? Saved with the test.</p><div class="form-grid" style="margin-top:16px">
    ${F("Name", `<input type="text" id="w-name" value="${esc(w.name)}" placeholder="Offer two time slots instead of asking open-ended">`)}${F("Expected effect", `<input type="text" id="w-effect" value="${esc(w.effect)}" placeholder="+10% BuyLeads">`)}
    <div class="field wide"><label>What changes</label><textarea id="w-change">${esc(w.change)}</textarea></div><div class="field wide"><label>Why</label><textarea id="w-why">${esc(w.why)}</textarea></div></div>`;
  if (s === 2) {
    const cands = C.library.candidates;
    const patch = `<div style="display:grid;gap:8px;margin-top:16px">${cands.map(c => `<label class="radio"><input type="radio" name="w-var" value="${esc(c.key)}" ${w.variant === c.key ? "checked" : ""}><div><b>${esc(c.name)}</b> <span class="tag">${esc(c.origin)}</span><span>${c.variables.ok ? "✓ every template variable is kept" : "✕ drops " + esc(c.variables.dropped.join(", "))}${c.lint_before != null ? ` · contradictions in the prompt ${c.lint_before} → ${c.lint_after}` : ""}</span></div></label>`).join("")}</div>
      <label class="radio" style="margin-top:8px"><input type="radio" name="w-var" value="__own" ${w.variant === "__own" ? "checked" : ""}><div><b>Write my own patch</b><span>Add a line, replace words, or remove a line in the base prompt.</span></div></label>
      ${w.variant === "__own" ? `<div class="card" style="background:var(--bg-2);margin-top:8px"><div class="form-grid">
        ${F("Kind of change", `<select id="w-op"><option value="replace" ${w.ownOp === "replace" || !w.ownOp ? "selected" : ""}>Replace words in a line</option><option value="add" ${w.ownOp === "add" ? "selected" : ""}>Add a line after a line</option><option value="remove" ${w.ownOp === "remove" ? "selected" : ""}>Remove a line</option></select>`)}
        ${F("A phrase from exactly one line of the base prompt", `<input type="text" id="w-anchor" value="${esc(w.ownAnchor || "")}" placeholder="for example: the assure the buyer that at the end of the call">`)}
        ${(w.ownOp || "replace") === "replace" ? F("Words to find in that line", `<input type="text" id="w-find" value="${esc(w.ownFind || "")}">`) : ""}${(w.ownOp || "replace") !== "remove" ? F((w.ownOp || "replace") === "add" ? "The new line" : "Replace them with", `<input type="text" id="w-new" value="${esc(w.ownNew || "")}">`) : ""}</div>
        <div class="actions" style="margin-top:12px"><button class="btn" id="w-apply">Preview patch</button><span id="w-own-msg" class="note"></span></div></div>
        ${w.ownText ? `<h3 style="margin:16px 0 8px">Side-by-side diff of your patch</h3>${diffSides(lineDiff(C.library.base_text, w.ownText))}<div style="margin-top:8px">${(() => { const vc = varCheck(w.ownText); return vc.ok ? `<div class="check ok"><span class="ico">✓</span>All ${vc.n} template variables are still used.</div>` : `<div class="check bad"><span class="ico">✕</span>No longer used: ${esc(vc.missing.join(", "))}.</div>`; })()}</div>` : ""}` : `<h3 style="margin:16px 0 8px">Side-by-side diff</h3>${diffSides((cands.find(c => c.key === w.variant) || {}).diff)}`}`;
    const full = `<div style="margin-top:16px"><div class="actions" style="margin-bottom:8px"><button class="btn sm" id="w-load">Start from the base prompt</button><span class="note">${C.library.base_lines ? nf(C.library.base_lines) + " lines" : ""}</span></div><textarea id="w-full" style="min-height:200px;font-family:var(--mono);font-size:12px">${esc(w.fullText)}</textarea>
      <div style="margin-top:8px" id="w-vc"></div>${w.fullText ? `<h3 style="margin:16px 0 8px">Side-by-side diff</h3><div id="w-diff"></div>` : ""}</div>`;
    return `<h2>2. Prompt B</h2><p class="sub">A patch on the base prompt, or a full prompt. The base prompt is shown read-only. Template variables such as <span class="mono">{{ buyer_name }}</span> must still be there.</p>
      <div class="seg" style="margin-top:12px" role="group" aria-label="Kind of change"><button data-mode="patch" aria-pressed="${w.mode === "patch"}">Patch on the base prompt</button><button data-mode="full" aria-pressed="${w.mode === "full"}">Full prompt</button></div>${w.mode === "patch" ? patch : full}
      <details id="w-basebox" style="margin-top:16px"><summary style="cursor:pointer;font-weight:500">Show the base prompt (read-only)</summary><div id="w-baseview" class="note" style="margin-top:8px">Loading...</div></details>
      <div class="card" style="margin-top:16px;background:var(--bg-2)"><h3>Try it</h3><p class="sub">An optional chat box to talk to prompt B. It uses Sarvam credits, so it is switched off. The simulator does not need it.</p><textarea disabled placeholder="Chat with prompt B (off)" style="min-height:48px;margin-top:8px"></textarea></div>`;
  }
  if (s === 3) {
    const c = calc(w), seg = wzSeg(w), pc = CAT().variables.filter(v => !v.pre_call), [bs, bk] = blockFor(w.share), sp = c.strata, shown = sp.strata.slice(0, 16);
    return `<h2>3. Audience</h2><p class="sub">Who is in the test. Leads outside it keep today's prompt and are not counted. Only things known <b>before</b> the call can pick leads: anything decided during the call would bias the result.</p>
      <div style="display:grid;gap:8px;margin-top:16px"><label class="radio"><input type="radio" name="w-segmode" value="all" ${w.segMode === "all" ? "checked" : ""}><div><b>All leads (a neutral test)</b><span>Every lead is eligible and the same stratified split applies. Per-group results are shown for insight only, never for the decision.</span></div></label>
        <label class="radio"><input type="radio" name="w-segmode" value="segment" ${w.segMode === "segment" ? "checked" : ""}><div><b>A segment</b><span>Pick conditions from the lists, or describe it in plain English. The exact rule is always shown before you save.</span></div></label></div>
      ${w.segMode === "segment" ? `<div class="card" style="background:var(--bg-2);margin-top:12px"><div class="form-grid"><div class="field wide"><label for="w-segtext">Describe it in plain English <span class="hint">read by rules, not by a language model</span></label><div style="display:flex;gap:8px"><input type="text" id="w-segtext" value="${esc(w.segText)}" placeholder="Mumbai proprietors on UA and PNS leads"><button class="btn" id="w-segread">Read it</button></div><div id="w-segmsg" class="note" style="margin-top:4px;${w.segMsgBad ? "color:#b23b3b" : ""}">${esc(w.segMsg || "")}</div></div>${segPicker(w)}</div>
        <div class="note" style="margin-top:8px">Not available: ${pc.map(v => esc(v.label)).join(", ")} (known only during the call).${preCall().length === 0 ? " <b>Every variable is switched off in Settings, so no segment can be built: switch one on there.</b>" : preCall().length < CAT().variables.filter(v => v.pre_call).length ? " Switched off in Settings: " + CAT().variables.filter(v => v.pre_call && !preCall().some(p => p.name === v.name)).map(v => esc(v.label)).join(", ") + "." : ""}</div></div>` : ""}
      <div class="banner" style="margin-top:16px"><div><b>The exact rule.</b> <span class="mono">${esc(segDescribe(seg))}</span><br>${w.segMode === "segment" ? `That is <b>${pct(c.share, 1)}</b> of traffic, about <b>${nf(c.elig)}</b> eligible leads a day (of ${nf(w.lpd)} in all). ` : `All ${nf(w.lpd)} leads a day are eligible. `}<span class="muted">The lead mix is synthetic: ${esc(CAT().note)}</span></div></div>
      <div class="card" style="margin-top:16px"><h3>How the split is dealt</h3><p class="sub">Leads are dealt inside each group (${CAT().strata.map(n => esc(catVar(n).label)).join(" × ")}) from shuffled blocks of ${bs}: with ${pct(w.share, 0)} to B each block holds ${bk} B and ${bs - bk} A in random order. Every group therefore carries exactly the configured share, so A and B get the same mix. Groups expected to hold fewer than ${CAT().min_stratum} leads are merged into "Other".</p>
        <div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th>Group</th><th class="num">Leads expected in ${c.days} days</th><th>Split</th></tr></thead><tbody>${shown.map(r => `<tr><td>${esc(r.label)}</td><td class="num">${nf(r.expected)}</td><td>${r.merged ? pill("merged into Other", "warn") : pill("own blocks", "pos")}</td></tr>`).join("")}</tbody></table></div>${sp.strata.length > shown.length ? `<div class="note">… and ${sp.strata.length - shown.length} more groups.</div>` : ""}</div>`;
  }
  if (s === 4) { const sg = suggestGoals(w); return `<h2>4. Goals</h2><p class="sub">One primary goal decides. Guardrails can only veto: they stop or hold B even if the goal improves. Each card shows what counts, which way is better, and the baseline.</p>
    <div class="banner" style="margin-top:12px"><div>${esc(sg.why)} <button class="btn sm" id="w-sugg">Use the suggestion</button></div></div>${goalCards(w)}
    <p class="note" style="margin-top:12px">In the simulator every primary goal is generated the same way (a known effect on the rate you choose), so the goal changes the labels, not the outcome; real dispositions come from results files. Conflict rule: the primary goal decides; a guardrail can only veto or hold. If B wins but a guardrail is not proven, the decision is held for approval.</p>`; }
  if (s === 5) { const c = calc(w), sug = suggestShare(w); return `<h2>5. Traffic and duration</h2><p class="sub">How much goes to B, the lift worth detecting, and how long to run. The days are calculated, in whole weeks (7 to 28), so a full week of patterns is covered. The calculator on the right updates as you change anything.</p><div class="form-grid" style="margin-top:16px">
    ${F("Share of traffic to B", `<input type="range" id="w-share-r" min="5" max="50" step="5" value="${Math.round(w.share * 100)}"><input type="number" id="w-share" min="5" max="50" step="1" value="${Math.round(w.share * 100)}" style="margin-top:8px">`, "whole percent, 5 to 50%")}
    ${F("Expected lift (relative)", `<input type="number" id="w-lift" min="1" max="100" step="1" value="${w.liftRel}">`, `% of A's rate = ${(c.mde * 100).toFixed(1)} points. Default +10% when no similar past test exists`)}
    ${F("Expected rate under A (baseline)", `<input type="number" id="w-base" min="1" max="98" step="1" value="${Math.round(w.baseline * 100)}">`, "% - an assumption: no per-segment history was provided")}
    ${F("Leads a day, all traffic", `<input type="number" id="w-lpd" min="10" step="100" value="${w.lpd}">`, "an assumption: replace it with yours")}
    ${F("Test length", `<select id="w-days">${[7, 14, 21, 28].map(d => `<option value="${d}" ${c.days === d ? "selected" : ""}>${d} days${d === c.rec && !c.tooBig ? " (recommended)" : ""}</option>`).join("")}</select>`, w.daysAuto ? "calculated for you" : "chosen by you")}</div>
    <div class="note" style="margin-top:8px">Suggestion: ${esc(sug.why)}. <button class="btn sm" id="w-useshare">Use ${pct(sug.share, 0)}</button> You can also work it the other way: with ${c.days} days the smallest lift this test can detect is <b>${(c.det * 100).toFixed(1)} points</b>.</div>
    <details style="margin-top:16px" ${w.rulesOpen ? "open" : ""} id="w-rules"><summary style="cursor:pointer;font-weight:500">Rules (company defaults from Settings: change them for this test only)</summary><div class="form-grid" style="margin-top:12px">
      ${F("Confidence", `<select id="w-conf">${[0.9, 0.95, 0.99].map(x => `<option value="${x}" ${w.confidence === x ? "selected" : ""}>${x * 100}%</option>`).join("")}</select>`, "power is fixed at 80%")}${F("Daily harm bar", `<select id="w-harm">${[0.99, 0.995, 0.999].map(x => `<option value="${x}" ${w.harm === x ? "selected" : ""}>${(x * 100).toFixed(1)}%</option>`).join("")}</select>`, "one-look rule")}
      ${F("Minimum leads per prompt before the daily harm check", `<input type="number" id="w-min" min="20" value="${w.minLeads}">`)}${F("Approval mode", `<select id="w-appr"><option value="auto" ${w.approval === "auto" ? "selected" : ""}>Automatic: a win is promoted</option><option value="manual" ${w.approval === "manual" ? "selected" : ""}>Manual: a person approves every win</option></select>`, "both paths are logged")}
      ${F("How leads are dealt", `<select id="w-assign"><option value="stratified" ${w.assignment === "stratified" ? "selected" : ""}>Stratified blocks (the BRD's router)</option><option value="balanced" ${w.assignment === "balanced" ? "selected" : ""}>Balanced blocks, no groups</option><option value="hash" ${w.assignment === "hash" ? "selected" : ""}>Pure hash (no stored state)</option></select>`, w.segMode === "segment" ? "a segment needs stratified" : "")}</div>
      <div style="display:grid;gap:8px;margin-top:12px"><label class="radio"><input type="radio" name="w-rule" value="final_look" ${w.rule === "final_look" ? "checked" : ""}><div><b>One winner call at the end, plus a strict daily harm check</b><span>The BRD's rule: a two-proportion test at ${pct(w.confidence, 0)} once, on the last day (no correction for repeated looks is needed). Every day a ${pct(w.harm, 1)} bar catches a clearly worse B.</span></div></label>
        <label class="radio"><input type="radio" name="w-rule" value="sequential" ${w.rule === "sequential" ? "checked" : ""}><div><b>Early promote and early stop (sequential)</b><span>May promote or stop on any day using boundaries built for repeated looks. ${RULE_FACTS()} Needs about 6% more data.</span></div></label></div></details>`; }
  const c = calc(w), gname = (C.metrics.find(m => m.key === w.metric) || {}).name || w.metric, cand = C.library.candidates.find(x => x.key === w.variant), chk = checklist(w), allOk = chk.every(x => x.ok), seg = wzSeg(w);
  return `<h2>6. Review and launch</h2><p class="sub">Save Test keeps an editable draft. Launch Test locks the setup and gives it a version ID: any later change creates a new version. Launch stays disabled until every check passes.</p>
    <dl class="kv" style="margin-top:16px"><dt>Name</dt><dd><b>${esc(w.name || "-")}</b></dd><dt>Prompt B</dt><dd>${w.mode === "full" ? "A full prompt you pasted" : w.variant === "__own" ? "Your own patch on the base prompt" : esc(cand ? cand.name : w.variant)}</dd><dt>Audience</dt><dd><span class="mono">${esc(segDescribe(seg))}</span> · about ${nf(c.elig)} leads a day</dd>
      <dt>Traffic</dt><dd>${pct(w.share, 0)} to B, sticky by lead, ${esc(w.assignment)} split</dd><dt>Primary goal</dt><dd>${esc(gname)} (${w.direction} is better); plan: detect +${w.liftRel}% (${(c.mde * 100).toFixed(1)} points) from ${pct(w.baseline, 0)}</dd>
      <dt>Guardrails</dt><dd>${[w.durOn ? `call duration ≤ +${w.durMargin}%` : "", w.hangOn ? `early hang-ups ≤ +${w.hangMargin} points` : ""].filter(Boolean).join("; ") || "none"}</dd>
      <dt>Rules</dt><dd>${c.days} days, ${pct(w.confidence, 0)} confidence, ${w.rule === "final_look" ? `one winner call at the end + daily ${pct(w.harm, 1)} harm check` : "early promote and early stop"}, harm check from ${nf(w.minLeads)} leads per prompt, approval ${w.approval}</dd></dl>
    <h3 style="margin:24px 0 8px">Pre-launch checklist</h3><div style="display:grid;gap:8px" id="w-checks">${chk.map(x => `<div class="check ${x.ok ? "ok" : "bad"}"><span class="ico">${x.ok ? "✓" : "✕"}</span><span><b>${esc(x.label)}</b>: ${esc(x.why)}${x.ok ? "" : ` <button class="link" data-goto="${x.step}">Fix in step ${x.step}</button>`}</span></div>`).join("")}</div>
    <div class="form-grid" style="margin-top:16px">${F("Start date", `<input type="date" id="w-start" value="${esc(w.startDate)}" min="${TODAY}">`, w.startDate > TODAY ? "a later date makes it Scheduled" : "optional; today starts it now")}</div>
    <h3 style="margin:24px 0 8px">Where do the results come from?</h3><div style="display:grid;gap:8px"><label class="radio"><input type="radio" name="w-src" value="sim" ${w.source === "sim" ? "checked" : ""}><div><b>Simulator (demo only)</b><span>The call outcomes are simulated with a known effect you set, so you can check the engine decides correctly. The effect is put into B's input, never into the result. Call lengths are resampled from the 713 real recordings.</span></div></label>
      <label class="radio"><input type="radio" name="w-src" value="files" ${w.source === "files" ? "checked" : ""}><div><b>Results files from the voice platform</b><span>The test runs elsewhere; you give Canary the A and B results and it decides with the plan above.</span></div></label></div>
    ${w.source === "sim" ? `<div class="form-grid" style="margin-top:16px"><div class="field wide"><label>Simulation settings (demo only)</label><div class="seg" role="group" aria-label="Preset">${(w.direction === "lower" ? [["win", "B wins (rate −15%)"], ["worse", "B worse (rate +15%)"], ["flat", "Flat (0%)"], ["custom", "Custom"]] : [["win", "B wins (+15%)"], ["worse", "B worse (−15%)"], ["flat", "Flat (0%)"], ["custom", "Custom"]]).map(([k, n]) => `<button data-preset="${k}" aria-pressed="${w.preset === k}">${n}</button>`).join("")}</div></div>
      ${F("B's true effect (relative)", `<input type="number" id="w-eff" step="1" value="${w.effectRel}" ${w.preset === "custom" ? "" : "disabled"}>`, "% of A's rate")}${F("Random seed", `<input type="number" id="w-seed" value="${w.seed}">`, "same seed, same run")}${F("B's calls are longer by (%)", `<input type="number" id="w-dx" step="1" value="${w.durExtra || 0}">`, "to test the call-length guardrail")}${w.hangOn ? F("B's early hang-ups are higher by (points)", `<input type="number" id="w-hx" step="0.5" min="0" value="${w.hangExtra || 0}">`, `A's rate is ${pct(C.defaults.early_hangup_share || 0.14, 0)}, measured on the real recordings (calls under 15 s)`) : ""}</div>`
      : `<div class="banner" style="margin-top:16px"><div>Your plan above is used when the files are read. Next: choose the files on the import screen.</div></div>`}
    ${!LIVE && w.source === "sim" ? `<div class="banner warn" style="margin-top:16px"><div><b>Offline.</b> Launching here replays the closest pre-computed run (B wins, B worse, flat, a win with longer calls, or a win in one segment) under your name; your plan fields are not applied. Run <span class="mono">./start.sh</span> to run your own settings through the engine.</div></div>` : ""}
    <div id="w-err" class="note" style="color:#b23b3b;margin-top:12px"></div>`;
}
const RULE_FACTS = () => { const r = C.proof && C.proof.rules; return r ? `Measured on identical simulated traffic: both rules keep out a B that is 7 points worse in about ${pct(Math.min(r.harm_sequential, r.harm_final), 0)} of runs, but this one sends about ${pct(Math.max(0, r.exposure_saved), 0)} fewer calls to that B and promotes a real winner about ${r.sooner}% sooner.` : "It reacts sooner than the one-look rule."; };

function saveDraft(w) {
  const copy = JSON.parse(JSON.stringify(w)); copy.draftId = w.draftId || "draft-" + Date.now(); w.draftId = copy.draftId;
  const i = DYN.drafts.findIndex(d => d.id === copy.draftId), rec = { id: copy.draftId, name: w.name || "Untitled test", saved: new Date().toISOString().slice(0, 19), w: copy };
  if (i >= 0) DYN.drafts[i] = rec; else DYN.drafts.unshift(rec);
  DYN.libLog.push({ ts: rec.saved, type: "Saved", text: `Draft saved: "${rec.name}". It is editable and has not launched; nothing runs until Launch Test.`, exp: rec.name }); saveDyn();
}

ROUTES.new = (el) => {
  if (!WZ) WZ = { ...wzDefaults(), ...(DYN.ui.wizard || {}) };
  const w = WZ; w.step = Math.min(6, Math.max(1, w.step));
  const drafts = DYN.drafts.length ? `<div class="card" style="margin-bottom:16px"><h3>Saved drafts</h3><div style="display:grid;gap:4px;margin-top:8px">${DYN.drafts.map(d => `<div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><span><b>${esc(d.name)}</b> <span class="note">saved ${esc(fdt(d.saved))}</span></span><span class="actions"><button class="btn sm" data-draft="${esc(d.id)}">Open</button><button class="btn sm" data-draft-del="${esc(d.id)}">Delete</button></span></div>`).join("")}</div></div>` : "";
  const chk = w.step === 6 ? checklist(w) : [], allOk = chk.every(x => x.ok), last = w.step === 6;
  el.innerHTML = head("New Experiment", "Six steps. Everything is decided before launch; once launched, the setup is locked and saved with a version ID, so results cannot be bent to fit.") + drafts +
    `<div class="g-main grid"><div class="card" style="min-height:420px">${wzBody(w)}<div class="actions" style="margin-top:24px;justify-content:space-between"><div>${w.step > 1 ? `<button class="btn" id="w-back">Back</button>` : ""}</div><div class="actions">${last ? `<button class="btn" id="w-save">Save Test</button><button class="btn primary" id="w-launch" ${allOk || w.source === "files" ? "" : "disabled"} title="${allOk ? "" : "Every check above must pass"}">${w.source === "files" ? "Continue to import" : w.startDate > TODAY ? "Launch Test (scheduled)" : "Launch Test"}</button>` : `<button class="btn" id="w-save">Save Test</button><button class="btn primary" id="w-next">Next</button>`}</div></div></div>
      <div class="grid wz-side"><div class="card"><div class="stepper" role="list">${WSTEPS.map((n, i) => `<button class="step ${i + 1 < w.step ? "done" : ""}" role="listitem" data-step="${i + 1}" ${i + 1 === w.step ? 'aria-current="step"' : ""}><span class="n">${i + 1 < w.step ? "✓" : i + 1}</span>${esc(n)}</button>`).join("")}</div></div>${calcPanel(w)}</div></div>`;
  bindWizard(el, w);
};
function bindWizard(el, w) {
  const $1 = s => $(s, el), val = (id, f = x => x) => { const e = $1(id); return e ? f(e.value) : undefined; };
  const sync = () => {
    if (w.step === 1) { w.name = val("#w-name", x => x); w.effect = val("#w-effect", x => x); w.change = val("#w-change", x => x); w.why = val("#w-why", x => x); }
    if (w.step === 2) { const r = $("input[name=w-var]:checked", el); if (r) w.variant = r.value; if ($1("#w-full")) w.fullText = $1("#w-full").value;
      if ($1("#w-anchor")) { w.ownOp = $1("#w-op").value; w.ownAnchor = $1("#w-anchor").value; w.ownFind = $1("#w-find") ? $1("#w-find").value : ""; w.ownNew = $1("#w-new") ? $1("#w-new").value : ""; } }
    if (w.step === 3) { const m = $("input[name=w-segmode]:checked", el); if (m) w.segMode = m.value; if ($1("#w-segtext")) w.segText = $1("#w-segtext").value;
      if ($$("[data-sv]", el).length) { const by = {}; $$("[data-sv]", el).forEach(c => { if (c.checked) (by[c.dataset.sv] = by[c.dataset.sv] || []).push(c.value); }); w.segRules = preCall().filter(v => by[v.name] && by[v.name].length && by[v.name].length < v.values.length).map(v => ({ var: v.name, values: v.values.filter(x => by[v.name].includes(x)) })); }
      if (w.segMode === "segment" && w.assignment !== "stratified") w.assignment = "stratified"; }
    if (w.step === 4) { if ($1("#w-swap")) w.metric = val("#w-swap", x => x); if ($1("#w-dir")) w.direction = val("#w-dir", x => x); if ($1("#w-durm")) w.durMargin = val("#w-durm", Number); if ($1("#w-hangm")) w.hangMargin = val("#w-hangm", Number); }
    if (w.step === 5) { w.share = Math.min(0.5, Math.max(0.05, Math.round(val("#w-share", Number)) / 100));      // whole percents: blocks cannot hold a fraction of a lead w.liftRel = val("#w-lift", Number); w.baseline = val("#w-base", Number) / 100; w.lpd = val("#w-lpd", Number); const dd = val("#w-days", Number); if (dd && dd !== w.days) { w.days = dd; w.daysAuto = false; }
      w.confidence = val("#w-conf", Number); w.harm = val("#w-harm", Number); w.minLeads = val("#w-min", Number); w.approval = val("#w-appr", x => x); w.assignment = val("#w-assign", x => x); const r = $("input[name=w-rule]:checked", el); if (r) w.rule = r.value; const rd = $1("#w-rules"); if (rd) w.rulesOpen = rd.open; }
    if (w.step === 6) { const r = $("input[name=w-src]:checked", el); if (r) w.source = r.value; if ($1("#w-eff")) w.effectRel = +$1("#w-eff").value; if ($1("#w-seed")) w.seed = +$1("#w-seed").value; if ($1("#w-dx")) w.durExtra = +$1("#w-dx").value; if ($1("#w-hx")) w.hangExtra = +$1("#w-hx").value; if ($1("#w-start") && $1("#w-start").value) w.startDate = $1("#w-start").value; }
    DYN.ui.wizard = w; saveDyn();
  };
  const rerender = () => { sync(); route(); };
  $$("[data-step]", el).forEach(b => b.onclick = () => { sync(); const t = +b.dataset.step; for (let s = w.step; s < t; s++) { const m = wzValid(w, s); if (m) { toast(m); return; } } w.step = t; route(); });
  $$("[data-goto]", el).forEach(b => b.onclick = () => { sync(); w.step = +b.dataset.goto; route(); });
  const nx = $1("#w-next"); if (nx) nx.onclick = () => { sync(); const m = wzValid(w, w.step); if (m) { toast(m); return; } if (w.step === 3 && !w.goalsTouched) { const g = suggestGoals(w); w.metric = g.metric; w.hangOn = g.hangOn; } if (w.step === 4) w.goalsTouched = true; if (w.step === 4 && w.daysAuto) { const sg = suggestShare(w); if (!w.shareTouched) w.share = sg.share; } w.step++; route(); };
  const bk = $1("#w-back"); if (bk) bk.onclick = () => { sync(); w.step--; route(); };
  const sv = $1("#w-save"); if (sv) sv.onclick = () => { sync(); if (!w.name.trim()) { toast("Give the test a name first."); w.step = 1; route(); return; } saveDraft(w); toast("Saved as a draft. You can edit it and launch it later."); route(); };
  $$("[data-draft]", el).forEach(b => b.onclick = () => { const d = DYN.drafts.find(x => x.id === b.dataset.draft); if (d) { WZ = { ...wzDefaults(), ...JSON.parse(JSON.stringify(d.w)) }; route(); } });
  $$("[data-draft-del]", el).forEach(b => b.onclick = () => { DYN.drafts = DYN.drafts.filter(x => x.id !== b.dataset.draftDel); saveDyn(); route(); });
  $$("[data-mode]", el).forEach(b => b.onclick = () => { sync(); w.mode = b.dataset.mode; route(); });
  $$("[data-preset]", el).forEach(b => b.onclick = () => { sync(); w.preset = b.dataset.preset; if (w.preset !== "custom") w.effectRel = { win: 15, worse: -15, flat: 0 }[w.preset]; route(); });
  $$("input[name=w-var],input[name=w-rule],input[name=w-src],input[name=w-segmode],[data-sv]", el).forEach(r => r.onchange = () => { if (r.dataset && r.dataset.sv) w.segMsg = ""; rerender(); });
  ["#w-share", "#w-lift", "#w-base", "#w-lpd", "#w-days", "#w-conf", "#w-harm", "#w-min", "#w-assign", "#w-appr", "#w-swap", "#w-dir", "#w-durm", "#w-hangm", "#w-start"].forEach(id => { const e = $1(id); if (e) e.onchange = () => { if (id === "#w-share") w.shareTouched = true; rerender(); }; });
  const rd = $1("#w-rules"); if (rd) rd.ontoggle = () => { w.rulesOpen = rd.open; DYN.ui.wizard = w; saveDyn(); };
  const sr = $1("#w-share-r"); if (sr) { sr.oninput = () => { $1("#w-share").value = sr.value; }; sr.onchange = () => { $1("#w-share").value = sr.value; w.shareTouched = true; rerender(); }; }
  const us = $1("#w-useshare"); if (us) us.onclick = () => { sync(); w.share = suggestShare(w).share; w.shareTouched = true; route(); };
  const sg = $1("#w-sugg"); if (sg) sg.onclick = () => { const g = suggestGoals(w); w.metric = g.metric; w.hangOn = g.hangOn; w.durOn = true; w.goalsTouched = true; route(); };
  $$("[data-del]", el).forEach(b => b.onclick = () => { sync(); if (b.dataset.del === "duration_s") w.durOn = false; else w.hangOn = false; w.goalsTouched = true; route(); });
  const add = $1("#w-add"); if (add) add.onchange = () => { sync(); const v = add.value; if (!v) return; if (v.startsWith("g:")) { if (v === "g:duration_s") w.durOn = true; else w.hangOn = true; } else w.metric = v.slice(2); w.goalsTouched = true; route(); };
  const rdb = $1("#w-segread"); if (rdb) rdb.onclick = () => { sync(); const r = parseSegment(w.segText); if (r.errors.length) { w.segMsg = r.errors[0]; w.segMsgBad = true; } else if (!r.rules.length) { w.segRules = []; w.segMsg = "Understood as: all leads. Pick conditions from the lists below if you meant a segment."; w.segMsgBad = false; } else { w.segRules = r.rules; w.segMsg = "Understood as: " + segDescribe({ rules: r.rules }) + "." + (r.warnings.length ? " I did not use these words: " + r.warnings.join(", ") + "." : "") + " Check it in the exact rule below and fix it with the lists if it is wrong."; w.segMsgBad = r.warnings.length > 0; } route(); };
  const stx = $1("#w-segtext"); if (stx) stx.onkeydown = ev => { if (ev.key === "Enter") { ev.preventDefault(); rdb.click(); } };
  const op = $1("#w-op"); if (op) op.onchange = () => { sync(); w.ownText = ""; route(); };
  const ap = $1("#w-apply"); if (ap) ap.onclick = () => { sync(); try { w.ownText = applyOwn(C.library.base_text, w.ownOp || "replace", w.ownAnchor, w.ownFind, w.ownNew); DYN.ui.wizard = w; saveDyn(); route(); } catch (err) { $1("#w-own-msg").style.color = "#b23b3b"; $1("#w-own-msg").textContent = err.message; } };
  const bb = $1("#w-basebox"); if (bb) bb.ontoggle = () => { if (bb.open) $1("#w-baseview").innerHTML = `<textarea readonly style="min-height:260px;font-family:var(--mono);font-size:12px">${esc(C.library.base_text || "")}</textarea>`; };
  const load = $1("#w-load"); if (load) load.onclick = () => { $1("#w-full").value = C.library.base_text || ""; sync(); route(); };
  const full = $1("#w-full"); if (full) { const upd = () => { const t = full.value, vc = varCheck(t); $1("#w-vc").innerHTML = t ? (vc.ok ? `<div class="check ok"><span class="ico">✓</span>All ${vc.n} template variables are still used.</div>` : `<div class="check bad"><span class="ico">✕</span>No longer used: ${esc(vc.missing.join(", "))}. A prompt that drops a variable would never receive that value.</div>`) : ""; const dd = $1("#w-diff"); if (dd && C.library.base_text) dd.innerHTML = diffSides(lineDiff(C.library.base_text, t)); }; full.oninput = upd; upd(); }
  const L = $1("#w-launch"); if (L) L.onclick = async () => {
    sync(); for (let s = 1; s <= 5; s++) { const m = wzValid(w, s); if (m) { w.step = s; toast(m); route(); return; } }
    if (w.source === "files") { DYN.ui.importPlan = { baseline: w.baseline, share_b: w.share, mde: wzMde(w), window_days: w.days, rule_set: w.rule, name: w.name }; saveDyn(); go("import"); return; }
    const c = calc(w), seg = wzSeg(w), scheduled = w.startDate > TODAY, startIso = w.startDate + "T09:00:00";
    const finish = (exp) => { exp.world = "main"; exp.audience = seg.rules.length ? { rules: seg.rules, text: seg.text } : null; exp.scheduled = scheduled; exp.sched_date = scheduled ? startIso : null; exp.segment_text = segDescribe(seg); DYN.launched.unshift(exp); DYN.dyn[exp.id] = { day: 1, paused: false, approval: null, rolledBack: false, manualStop: false, learning: "", started: !scheduled, hold: 0 };
      if (w.draftId) DYN.drafts = DYN.drafts.filter(d => d.id !== w.draftId); WZ = null; DYN.ui.wizard = null; saveDyn(); };
    if (!LIVE) {
      const src = replayFor(w), rec = JSON.parse(JSON.stringify(src.record)); rec.config.name = w.name;
      const id = "replay-" + Date.now(), exp = { id, kind: "simulated", preset: src.preset, replay_of: src.id, hypothesis: [w.change, w.why, w.effect && "Expected: " + w.effect].filter(Boolean).join(" "), truth: src.truth, start_day: 1, record: rec };
      finish(exp); toast(scheduled ? `Scheduled for ${fdate(startIso)}. Press Start now to play it in this demo.` : "Launched offline: replaying the closest pre-computed run.", 4200); go("live", id); return;
    }
    L.disabled = true; L.innerHTML = `<span class="spin"></span> Running the engine...`;
    try {
      const body = { name: w.name, hypothesis: [w.change, w.why, w.effect && "Expected: " + w.effect].filter(Boolean).join(" "), variant_b: w.variant, share_b: w.share, baseline: w.baseline, mde: wzMde(w), window_days: c.days, leads_per_day: w.lpd,
        rule_set: w.rule, confidence: w.confidence, harm_bar: w.harm, duration_margin: w.durMargin / 100, duration_on: w.durOn, approval: w.approval, min_leads_per_arm: w.minLeads, early_hangup: w.hangOn, rate_margin_pp: w.hangMargin, assignment: w.assignment,
        segment: seg.rules.length ? seg : null, primary_goal: w.metric, primary_direction: w.direction,
        effect_rel: (w.preset !== "custom" && w.direction === "lower" ? -w.effectRel : w.effectRel) / 100, dur_mult: 1 + (w.durExtra || 0) / 100, hang_extra_pp: w.hangOn ? (w.hangExtra || 0) : 0, seed: w.seed, preset: { win: "B wins", worse: "B worse", flat: "Flat", custom: "Custom" }[w.preset], start: startIso, full_prompt: wzPrompt(w) };
      const r = await fetch("/api/wizard", { method: "POST", body: JSON.stringify(body) }), j = await r.json(); if (j.error) throw new Error(j.error);
      j.start_day = 1; finish(j);
      toast(scheduled ? `Scheduled for ${fdate(startIso)}; config version ${j.record.config.version || 1} (${j.record.config_hash}) is locked.` : `Launched and locked: config version ${j.record.config.version || 1} (${j.record.config_hash}).`, 4200); go("live", j.id);
    } catch (err) { L.disabled = false; L.textContent = "Launch Test"; $1("#w-err").textContent = String(err.message || err); }
  };
}
