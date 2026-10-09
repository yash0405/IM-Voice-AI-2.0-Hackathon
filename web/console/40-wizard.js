/* New Experiment: the spec's six steps. Everything is decided before launch; launching locks the setup and saves it with a version ID. */

const WSTEPS = ["Hypothesis", "Prompt B", "Audience and traffic", "Goals", "Duration and rules", "Review and launch"];
let WZ = null;
const wzDefaults = () => { const s = SET(); return { step: 1, name: "", change: "", why: "", effect: "", mode: "patch", variant: "cap_two_asks", fullText: "", share: s.share_b, segment: "all", lpd: s.leads_per_day, assignment: "balanced", metric: "buylead_created", direction: "higher",
  durOn: true, durMargin: Math.round(s.duration_margin * 100), hangOn: false, hangMargin: s.rate_margin_pp, days: s.window_days, confidence: s.confidence, rule: s.rule_set, harm: s.harm_bar, minLeads: s.min_leads_per_arm, approval: s.approval, baseline: s.baseline, mde: s.mde,
  source: "sim", preset: "win", effectRel: 15, seed: 7 }; };
function startWizard(prefill) { WZ = { ...wzDefaults(), ...(prefill || {}) }; go("new"); }

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
  if ((w.durExtra || 0) >= 8 && eff > 0.05) id = "demo_hold"; return C.demo.find(d => d.id === id);
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
function calc(w) {
  const alpha = (1 - w.confidence) / 2, seq = w.rule === "sequential", lpd = +w.lpd || 1, days = +w.days || 1, nAll = lpd * days, nB = nAll * w.share, need = leadsNeeded(w.baseline, w.mde, w.share, alpha, 0.8, seq);
  const det = detectableLift(nAll, w.baseline, w.share, alpha, 0.8, seq), cv = (C.plans || {}).duration_cv || 0.55;
  const se = cv * Math.sqrt(1 / Math.max(2, nB) + 1 / Math.max(2, nAll - nB)), gp = normCdf((w.durMargin / 100) / se - normPpf(1 - alpha));
  const half = w.mde > 0.01 ? Math.max(0.005, w.mde / 2) : w.mde, needHalf = leadsNeeded(w.baseline, half, w.share, alpha, 0.8, seq);
  return { nAll, nB, need, daysNeeded: need / lpd, det, gp, half, daysHalf: needHalf / lpd, fits: nAll >= need };
}
function wzValid(w, step) {
  if (step === 1 && !w.name.trim()) return "Give the test a name.";
  if (step === 2) { if (w.mode === "patch" && w.variant === "__own") { if (!w.ownText) return "Press Preview patch to check your edit first."; const vc = varCheck(w.ownText); if (!vc.ok) return `Prompt B no longer uses: ${vc.missing.join(", ")}.`; } else if (w.mode === "full") { if (w.fullText.trim().length < 200) return "Paste the full prompt, or start from the base prompt."; const vc = varCheck(w.fullText); if (!vc.ok) return `Prompt B no longer uses: ${vc.missing.join(", ")}.`; } else { const cand = C.library.candidates.find(c => c.key === w.variant); if (cand && !cand.variables.ok) return `This patch drops variables: ${cand.variables.dropped.join(", ")}.`; } }
  if (step === 3) { if (!(w.share >= 0.05 && w.share <= 0.5)) return "The share for B must be between 5% and 50%."; if (!(w.lpd >= 10)) return "Expected leads per day must be at least 10."; }
  if (step === 5) { if (!(w.days >= 1 && w.days <= 60)) return "Test length must be 1 to 60 days."; if (w.days * w.lpd > 60000) return "Days x leads per day is capped at 60,000 for the live demo."; if (w.baseline + w.mde >= 0.99) return "Baseline plus the smallest lift must stay below 99%."; }
  return "";
}
const F = (label, inner, hint) => `<div class="field"><label>${label}${hint ? ` <span class="hint">${hint}</span>` : ""}</label>${inner}</div>`;

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
        ${w.ownText ? `<h3 style="margin:16px 0 8px">Side-by-side diff of your patch</h3>${diffSides(lineDiff(C.library.base_text, w.ownText))}<div style="margin-top:8px">${(() => { const vc = varCheck(w.ownText); return vc.ok ? `<div class="check ok"><span class="ico">\u2713</span>All ${vc.n} template variables are still used.</div>` : `<div class="check bad"><span class="ico">\u2715</span>No longer used: ${esc(vc.missing.join(", "))}.</div>`; })()}</div>` : ""}` : `<h3 style="margin:16px 0 8px">Side-by-side diff</h3>${diffSides((cands.find(c => c.key === w.variant) || {}).diff)}`}`;
    const vc = varCheck(w.fullText || ""), full = `<div style="margin-top:16px"><div class="actions" style="margin-bottom:8px"><button class="btn sm" id="w-load">Start from the base prompt</button><span class="note">${C.library.base_lines ? nf(C.library.base_lines) + " lines" : ""}</span></div><textarea id="w-full" style="min-height:200px;font-family:var(--mono);font-size:12px">${esc(w.fullText)}</textarea>
      <div style="margin-top:8px" id="w-vc"></div>${w.fullText ? `<h3 style="margin:16px 0 8px">Side-by-side diff</h3><div id="w-diff"></div>` : ""}</div>`;
    return `<h2>2. Prompt B</h2><p class="sub">A patch on the base prompt, or a full prompt. The base prompt is shown read-only. Template variables such as <span class="mono">{{ buyer_name }}</span> must still be there.</p>
      <div class="seg" style="margin-top:12px" role="group" aria-label="Kind of change"><button data-mode="patch" aria-pressed="${w.mode === "patch"}">Patch on the base prompt</button><button data-mode="full" aria-pressed="${w.mode === "full"}">Full prompt</button></div>${w.mode === "patch" ? patch : full}
      <details id="w-basebox" style="margin-top:16px"><summary style="cursor:pointer;font-weight:500">Show the base prompt (read-only)</summary><div id="w-baseview" class="note" style="margin-top:8px">Loading...</div></details>
      <div class="card" style="margin-top:16px;background:var(--bg-2)"><h3>Try it</h3><p class="sub">An optional chat box to talk to prompt B. It uses Sarvam credits, so it is switched off. The simulator does not need it.</p><textarea disabled placeholder="Chat with prompt B (off)" style="min-height:48px;margin-top:8px"></textarea></div>`;
  }
  if (s === 3) { const c = calc(w); return `<h2>3. Audience and traffic</h2><p class="sub">Who is in the test, and how much of it goes to B. Assignment is sticky by lead ID: the same lead always sees the same prompt.</p><div class="form-grid" style="margin-top:16px">
    ${F("Share of traffic to B", `<input type="range" id="w-share-r" min="5" max="50" step="5" value="${Math.round(w.share * 100)}"><input type="number" id="w-share" min="5" max="50" step="1" value="${Math.round(w.share * 100)}" style="margin-top:8px">`, "5 to 50%")}
    ${F("Expected leads per day", `<input type="number" id="w-lpd" min="10" step="100" value="${w.lpd}">`, "an assumption: replace it with yours")}
    ${F("Audience segment (optional)", `<select id="w-seg"><option value="all" selected>All leads</option><option disabled>A category (MCAT): needs a category on every call</option><option disabled>A city: needs a city on every call</option><option disabled>A lead type: needs a lead type on every call</option></select>`, "no segment data in the recordings")}
    ${F("Assignment", `<select id="w-assign"><option value="balanced" ${w.assignment === "balanced" ? "selected" : ""}>Balanced blocks (closest to the configured share)</option><option value="hash" ${w.assignment === "hash" ? "selected" : ""}>Pure hash (works with no stored state)</option></select>`)}</div>
    <div class="banner" style="margin-top:16px"><div><b>Expected leads.</b> In ${w.days} days B will get about <b>${nf(c.nB)}</b> of <b>${nf(c.nAll)}</b> leads. The leads per day come from your setting, not from historical data (none was provided).</div></div>`; }
  if (s === 4) { const goals = C.metrics.filter(m => m.role === "goal"); return `<h2>4. Goals</h2><p class="sub">One primary goal decides. Guardrails can only veto: they stop or hold B even if the goal improves.</p><div class="form-grid" style="margin-top:16px">
    ${F("Primary goal", `<select id="w-metric">${goals.map(m => `<option value="${esc(m.key)}" ${w.metric === m.key ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select>`, "any disposition can be a goal")}${F("Which direction is better", `<select id="w-dir"><option value="higher" ${w.direction === "higher" ? "selected" : ""}>Higher is better</option><option value="lower" ${w.direction === "lower" ? "selected" : ""}>Lower is better</option></select>`)}</div>
    <h3 style="margin:24px 0 8px">Guardrails</h3><div style="display:grid;gap:8px">
      <label class="radio" style="cursor:default"><input type="checkbox" id="w-dur" ${w.durOn ? "checked" : ""}><div><b>Call duration</b><span>B must not be longer than A by more than <input type="number" id="w-durm" min="1" max="100" value="${w.durMargin}" style="width:72px;display:inline-block;min-height:28px;padding:2px 8px"> %. Compared as a ratio of averages, with a range.</span></div></label>
      <label class="radio" style="cursor:default"><input type="checkbox" id="w-hang" ${w.hangOn ? "checked" : ""}><div><b>Early hang-ups</b><span>Calls under 15 seconds must not rise by more than <input type="number" id="w-hangm" min="1" max="20" value="${w.hangMargin}" style="width:72px;display:inline-block;min-height:28px;padding:2px 8px"> points. (The 15-second cut-off is our assumption.)</span></div></label>
      <label class="radio" style="cursor:not-allowed;opacity:.6"><input type="checkbox" disabled><div><b>Fatal calls (quality matrix)</b><span>Needs a fatal-call flag on every call: available from result files that carry it.</span></div></label></div>
    <p class="note" style="margin-top:12px">Conflict rule: the primary goal decides; a guardrail can only veto or hold. If B wins but a guardrail is not proven, the decision is held for approval.</p>`; }
  if (s === 5) { const c = calc(w); return `<h2>5. Duration and rules</h2><p class="sub">The rules are fixed before launch so results cannot be bent to fit.</p><div class="form-grid" style="margin-top:16px">
    ${F("Test length (days)", `<input type="number" id="w-days" min="1" max="60" value="${w.days}">`)}${F("Confidence", `<select id="w-conf">${[0.9, 0.95, 0.99].map(x => `<option value="${x}" ${w.confidence === x ? "selected" : ""}>${x * 100}%</option>`).join("")}</select>`)}
    ${F("Expected rate under A (baseline)", `<input type="number" id="w-base" min="1" max="98" step="1" value="${Math.round(w.baseline * 100)}">`, "% - needed to size the test")}${F("Smallest lift worth detecting", `<input type="number" id="w-mde" min="1" max="50" step="1" value="${Math.round(w.mde * 100)}">`, "points")}
    ${F("Minimum leads in each arm before any decision", `<input type="number" id="w-min" min="20" value="${w.minLeads}">`)}${F("Approval mode", `<select id="w-appr"><option value="auto" ${w.approval === "auto" ? "selected" : ""}>Automatic: a win is promoted</option><option value="manual" ${w.approval === "manual" ? "selected" : ""}>Manual: a person approves every win</option></select>`, "both paths are logged")}</div>
    <h3 style="margin:24px 0 8px">Decision rule</h3><div style="display:grid;gap:8px"><label class="radio"><input type="radio" name="w-rule" value="final_look" ${w.rule === "final_look" ? "checked" : ""}><div><b>One winner call at the end, plus a strict daily harm check</b><span>The spec's rule: a two-proportion test at ${pct(w.confidence, 0)} once, on the last day (no correction for repeated looks is needed). Every day a ${pct(w.harm, 1)} bar catches a clearly worse B.</span></div></label>
      <label class="radio"><input type="radio" name="w-rule" value="sequential" ${w.rule === "sequential" ? "checked" : ""}><div><b>Early promote and early stop (sequential)</b><span>May promote or stop on any day using boundaries built for repeated looks. Measured on identical simulated traffic: it promotes about 15% sooner and stops a clearly worse B in 98% of runs, against 89% for the one-look rule. Needs about 6% more data.</span></div></label></div>
    <div class="form-grid" style="margin-top:16px">${F("Daily harm bar", `<select id="w-harm">${[0.99, 0.995, 0.999].map(x => `<option value="${x}" ${w.harm === x ? "selected" : ""}>${(x * 100).toFixed(1)}%</option>`).join("")}</select>`, "one-look rule only")}</div>
    <div class="card" style="margin-top:24px;background:var(--bg-2)"><h3>Live calculator</h3><p style="margin-top:8px">B will get about <b>${nf(c.nB)}</b> leads in ${w.days} days (${nf(c.nAll)} in all at ${nf(w.lpd)} a day). It can detect a lift of <b>${(c.det * 100).toFixed(1)} points</b> or more with ${pct(0.8, 0)} chance. To detect <b>${(w.mde * 100).toFixed(0)} points</b> you need about <b>${nf(c.need)}</b> leads, which is <b>${c.daysNeeded.toFixed(1)} days</b>${c.half !== w.mde ? `; to detect ${(c.half * 100).toFixed(1)} points you would need ${c.daysHalf.toFixed(0)} days` : ""}.</p>
      <div class="banner ${c.fits ? "pos" : "warn"}" style="margin:12px 0 0"><div>${c.fits ? `<b>This test can finish.</b> The window holds enough leads for a ${(w.mde * 100).toFixed(0)}-point lift.` : `<b>Too short to detect a ${(w.mde * 100).toFixed(0)}-point lift.</b> Run about ${Math.ceil(c.daysNeeded)} days, send B more traffic (up to 50%), or aim for a bigger lift.`}</div></div>
      <p class="note" style="margin-top:8px">${w.durOn ? `Chance that a B which changes nothing is proven within the ${w.durMargin}% call-length limit: <b>${pct(c.gp, 0)}</b>${c.gp < 0.7 ? " (low: the guardrail may be held for approval even for a real win)" : ""}.` : ""} ${w.rule === "sequential" ? "Includes the 6% a repeatedly checked test needs." : ""}</p></div>`; }
  const c = calc(w), gname = (C.metrics.find(m => m.key === w.metric) || {}).name || w.metric, cand = C.library.candidates.find(x => x.key === w.variant);
  return `<h2>6. Review and launch</h2><p class="sub">Launching locks the setup and saves it with a version ID. Any later change creates a new version.</p>
    <dl class="kv" style="margin-top:16px"><dt>Name</dt><dd><b>${esc(w.name || "-")}</b></dd><dt>Prompt B</dt><dd>${w.mode === "full" ? "A full prompt you pasted" : w.variant === "__own" ? "Your own patch on the base prompt" : esc(cand ? cand.name : w.variant)}</dd><dt>Traffic</dt><dd>${pct(w.share, 0)} to B, sticky by lead, ${esc(w.assignment)} assignment; about ${nf(w.lpd)} leads a day</dd>
      <dt>Primary goal</dt><dd>${esc(gname)} (${w.direction} is better); plan: detect ${(w.mde * 100).toFixed(0)} points from ${pct(w.baseline, 0)}</dd><dt>Guardrails</dt><dd>${[w.durOn ? `call duration ≤ +${w.durMargin}%` : "", w.hangOn ? `early hang-ups ≤ +${w.hangMargin} points` : ""].filter(Boolean).join("; ") || "none"}</dd>
      <dt>Rules</dt><dd>${w.days} days, ${pct(w.confidence, 0)} confidence, ${w.rule === "final_look" ? `one winner call at the end + daily ${pct(w.harm, 1)} harm check` : "early promote and early stop"}, min ${w.minLeads} leads per arm, approval ${w.approval}</dd><dt>Can it finish?</dt><dd>${c.fits ? pill("✓ Yes", "pos") : pill("Too short for the planned lift", "warn")}</dd></dl>
    <h3 style="margin:24px 0 8px">Where do the results come from?</h3><div style="display:grid;gap:8px"><label class="radio"><input type="radio" name="w-src" value="sim" ${w.source === "sim" ? "checked" : ""}><div><b>Simulator (demo only)</b><span>The call outcomes are simulated with a known effect you set, so you can check the engine decides correctly. Call lengths are resampled from the 713 real recordings.</span></div></label>
      <label class="radio"><input type="radio" name="w-src" value="files" ${w.source === "files" ? "checked" : ""}><div><b>Results files from the voice platform</b><span>The test runs elsewhere; you give Canary the A and B results and it decides with the plan above.</span></div></label></div>
    ${w.source === "sim" ? `<div class="form-grid" style="margin-top:16px"><div class="field wide"><label>Simulation settings (demo only)</label><div class="seg" role="group" aria-label="Preset">${[["win", "B wins (+15%)"], ["worse", "B worse (−15%)"], ["flat", "Flat (0%)"], ["custom", "Custom"]].map(([k, n]) => `<button data-preset="${k}" aria-pressed="${w.preset === k}">${n}</button>`).join("")}</div></div>
      ${F("B's true effect (relative)", `<input type="number" id="w-eff" step="1" value="${w.effectRel}" ${w.preset === "custom" ? "" : "disabled"}>`, "% of A's rate")}${F("Random seed", `<input type="number" id="w-seed" value="${w.seed}">`, "same seed, same run")}${F("B's calls are longer by (%)", `<input type="number" id="w-dx" step="1" value="${w.durExtra || 0}">`, "to test the call-length guardrail")}</div>`
      : `<div class="banner" style="margin-top:16px"><div>Your plan above is used when the files are read. Next: choose the files on the import screen.</div></div>`}
    ${!LIVE && w.source === "sim" ? `<div class="banner warn" style="margin-top:16px"><div><b>Offline.</b> Launching here replays the closest pre-computed run (B wins, B worse, flat, or a win with longer calls) under your name; your plan fields are not applied. Run <span class="mono">./start.sh</span> to run your own settings through the engine.</div></div>` : ""}
    <div id="w-err" class="note" style="color:#b23b3b;margin-top:12px"></div>`;
}

ROUTES.new = (el) => {
  if (!WZ) WZ = { ...wzDefaults(), ...(DYN.ui.wizard || {}) };
  const w = WZ; w.step = Math.min(6, Math.max(1, w.step));
  const c = calc(w);
  el.innerHTML = head("New Experiment", "Six steps. Everything is decided before launch; once launched, the setup is locked and saved with a version ID, so results cannot be bent to fit.") +
    `<div class="g-main grid"><div class="card" style="min-height:420px">${wzBody(w)}<div class="actions" style="margin-top:24px;justify-content:space-between"><div>${w.step > 1 ? `<button class="btn" id="w-back">Back</button>` : ""}</div><div class="actions">${w.step < 6 ? `<button class="btn primary" id="w-next">Next</button>` : `<button class="btn primary" id="w-launch">${w.source === "files" ? "Continue to import" : "Launch experiment"}</button>`}</div></div></div>
      <div class="grid"><div class="card"><div class="stepper" role="list">${WSTEPS.map((n, i) => `<button class="step ${i + 1 < w.step ? "done" : ""}" role="listitem" data-step="${i + 1}" ${i + 1 === w.step ? 'aria-current="step"' : ""}><span class="n">${i + 1 < w.step ? "✓" : i + 1}</span>${esc(n)}</button>`).join("")}</div></div>
      <div class="card"><h3>At a glance</h3><dl class="kv" style="margin-top:8px;grid-template-columns:110px 1fr"><dt>B gets</dt><dd>${pct(w.share, 0)} of leads</dd><dt>Window</dt><dd>${w.days} days</dd><dt>Leads</dt><dd>${nf(c.nAll)} (B ${nf(c.nB)})</dd><dt>Detects</dt><dd>${(c.det * 100).toFixed(1)} pp or more</dd><dt>Can finish</dt><dd>${c.fits ? "✓ yes" : "no: too short"}</dd></dl></div></div></div>`;
  bindWizard(el, w);
};
function bindWizard(el, w) {
  const $1 = s => $(s, el), val = (id, f = x => x) => { const e = $1(id); return e ? f(e.value) : undefined; };
  const sync = () => {
    if (w.step === 1) { w.name = val("#w-name", x => x); w.effect = val("#w-effect", x => x); w.change = val("#w-change", x => x); w.why = val("#w-why", x => x); }
    if (w.step === 2) { const r = $("input[name=w-var]:checked", el); if (r) w.variant = r.value; if ($1("#w-full")) w.fullText = $1("#w-full").value;
      if ($1("#w-anchor")) { w.ownOp = $1("#w-op").value; w.ownAnchor = $1("#w-anchor").value; w.ownFind = $1("#w-find") ? $1("#w-find").value : ""; w.ownNew = $1("#w-new") ? $1("#w-new").value : ""; } }
    if (w.step === 3) { w.share = Math.min(0.5, Math.max(0.05, val("#w-share", Number) / 100)); w.lpd = val("#w-lpd", Number); w.assignment = val("#w-assign", x => x); }
    if (w.step === 4) { w.metric = val("#w-metric", x => x); w.direction = val("#w-dir", x => x); w.durOn = $1("#w-dur").checked; w.durMargin = val("#w-durm", Number); w.hangOn = $1("#w-hang").checked; w.hangMargin = val("#w-hangm", Number); }
    if (w.step === 5) { w.days = val("#w-days", Number); w.confidence = val("#w-conf", Number); w.baseline = val("#w-base", Number) / 100; w.mde = val("#w-mde", Number) / 100; w.minLeads = val("#w-min", Number); w.approval = val("#w-appr", x => x); const r = $("input[name=w-rule]:checked", el); if (r) w.rule = r.value; w.harm = val("#w-harm", Number); }
    if (w.step === 6) { const r = $("input[name=w-src]:checked", el); if (r) w.source = r.value; if ($1("#w-eff")) w.effectRel = +$1("#w-eff").value; if ($1("#w-seed")) w.seed = +$1("#w-seed").value; if ($1("#w-dx")) w.durExtra = +$1("#w-dx").value; }
    DYN.ui.wizard = w; saveDyn();
  };
  const rerender = () => { sync(); route(); };
  $$("[data-step]", el).forEach(b => b.onclick = () => { sync(); const t = +b.dataset.step; for (let s = w.step; s < t; s++) { const m = wzValid(w, s); if (m) { toast(m); return; } } w.step = t; route(); });
  const nx = $1("#w-next"); if (nx) nx.onclick = () => { sync(); const m = wzValid(w, w.step); if (m) { toast(m); return; } w.step++; route(); };
  const bk = $1("#w-back"); if (bk) bk.onclick = () => { sync(); w.step--; route(); };
  $$("[data-mode]", el).forEach(b => b.onclick = () => { sync(); w.mode = b.dataset.mode; route(); });
  $$("[data-preset]", el).forEach(b => b.onclick = () => { sync(); w.preset = b.dataset.preset; if (w.preset !== "custom") w.effectRel = { win: 15, worse: -15, flat: 0 }[w.preset]; route(); });
  $$("input[name=w-var],input[name=w-rule],input[name=w-src]", el).forEach(r => r.onchange = rerender);
  ["#w-share", "#w-lpd", "#w-days", "#w-conf", "#w-base", "#w-mde", "#w-durm", "#w-dur", "#w-harm"].forEach(id => { const e = $1(id); if (e) e.onchange = rerender; });
  const sr = $1("#w-share-r"); if (sr) { sr.oninput = () => { $1("#w-share").value = sr.value; }; sr.onchange = () => { $1("#w-share").value = sr.value; rerender(); }; }
  const op = $1("#w-op"); if (op) op.onchange = () => { sync(); w.ownText = ""; route(); };
  const ap = $1("#w-apply"); if (ap) ap.onclick = () => { sync(); try { w.ownText = applyOwn(C.library.base_text, w.ownOp || "replace", w.ownAnchor, w.ownFind, w.ownNew); DYN.ui.wizard = w; saveDyn(); route(); } catch (err) { $1("#w-own-msg").style.color = "#b23b3b"; $1("#w-own-msg").textContent = err.message; } };
  const bb = $1("#w-basebox"); if (bb) bb.ontoggle = () => { if (bb.open) $1("#w-baseview").innerHTML = `<textarea readonly style="min-height:260px;font-family:var(--mono);font-size:12px">${esc(C.library.base_text || "")}</textarea>`; };
  const load = $1("#w-load"); if (load) load.onclick = () => { $1("#w-full").value = C.library.base_text || ""; sync(); route(); };
  const full = $1("#w-full"); if (full) { const upd = () => { const t = full.value, vc = varCheck(t); $1("#w-vc").innerHTML = t ? (vc.ok ? `<div class="check ok"><span class="ico">✓</span>All ${vc.n} template variables are still used.</div>` : `<div class="check bad"><span class="ico">✕</span>No longer used: ${esc(vc.missing.join(", "))}. A prompt that drops a variable would never receive that value.</div>`) : ""; const dd = $1("#w-diff"); if (dd && C.library.base_text) dd.innerHTML = diffSides(lineDiff(C.library.base_text, t)); }; full.oninput = upd; upd(); }
  const L = $1("#w-launch"); if (L) L.onclick = async () => {
    sync(); for (let s = 1; s <= 5; s++) { const m = wzValid(w, s); if (m) { w.step = s; toast(m); route(); return; } }
    if (w.source === "files") { DYN.ui.importPlan = { baseline: w.baseline, share_b: w.share, mde: w.mde, window_days: w.days, rule_set: w.rule, name: w.name }; saveDyn(); go("import"); return; }
    if (!LIVE) {
      const src = replayFor(w), rec = JSON.parse(JSON.stringify(src.record)); rec.config.name = w.name;
      const id = "replay-" + Date.now(), exp = { id, kind: "simulated", preset: src.preset, replay_of: src.id, hypothesis: [w.change, w.why, w.effect && "Expected: " + w.effect].filter(Boolean).join(" "), truth: src.truth, start_day: 1, record: rec };
      DYN.launched.unshift(exp); DYN.dyn[id] = { day: 1, paused: false, approval: null, rolledBack: false, manualStop: false, learning: "" }; WZ = null; DYN.ui.wizard = null; saveDyn();
      toast("Launched offline: replaying the closest pre-computed run.", 4200); go("live", id); return;
    }
    L.disabled = true; L.innerHTML = `<span class="spin"></span> Running the engine...`;
    try {
      const body = { name: w.name, hypothesis: [w.change, w.why, w.effect && "Expected: " + w.effect].filter(Boolean).join(" "), variant_b: w.variant, share_b: w.share, baseline: w.baseline, mde: w.mde, window_days: w.days, leads_per_day: w.lpd,
        rule_set: w.rule, confidence: w.confidence, harm_bar: w.harm, duration_margin: w.durMargin / 100, duration_on: w.durOn, approval: w.approval, min_leads_per_arm: w.minLeads, early_hangup: w.hangOn, rate_margin_pp: w.hangMargin,
        effect_rel: w.effectRel / 100, dur_mult: 1 + (w.durExtra || 0) / 100, seed: w.seed, preset: { win: "B wins", worse: "B worse", flat: "Flat", custom: "Custom" }[w.preset], start: new Date(2026, 9, 9, 9).toISOString().slice(0, 19), full_prompt: wzPrompt(w) };
      const r = await fetch("/api/wizard", { method: "POST", body: JSON.stringify(body) }), j = await r.json(); if (j.error) throw new Error(j.error);
      j.start_day = 1; DYN.launched.unshift(j); DYN.dyn[j.id] = { day: 1, paused: false, approval: null, rolledBack: false, manualStop: false, learning: "" }; WZ = null; DYN.ui.wizard = null; saveDyn();
      toast(`Launched and locked: config version ${j.record.config.version || 1} (${j.record.config_hash}).`, 4200); go("live", j.id);
    } catch (err) { L.disabled = false; L.textContent = "Launch experiment"; $1("#w-err").textContent = String(err.message || err); }
  };
}
