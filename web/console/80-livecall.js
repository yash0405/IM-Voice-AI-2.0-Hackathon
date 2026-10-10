/* Live call test: a screen of the console (menu entry "Live call test"). Hear prompt A and prompt B on Sarvam voice agents, give a signal after
   each call, and the result is released only when every prompt has the number of finished calls fixed before the test.
   It exists only on the server started with `python -m canary live` (port 8790), which sets window.CANARY_LIVECALL; everywhere else (offline
   file, hosted app, the normal server) this file does nothing and the menu is unchanged. All rules and statistics are on the server
   (canary/livecall.py, canary/livestats.py); this screen only shows them. The Sarvam browser SDK is loaded the first time a call starts. */
(() => {
  if (!window.CANARY_LIVECALL) return;
  NAV.splice(3, 0, ["livecall", "Live call test"]);                       // right after Live Experiments

  const mmss = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  const lcPts = x => (x >= 0 ? "+" : "−") + Math.abs(Math.round(x * 100)) + " points";
  const nowIn = () => CUR.name === "livecall";
  const S0 = { sel: { candidate: "", n: 10, conf: "90", blind: true, goal: "Good call", name: "Live call test" } };
  let S = null, T = null;                                                   // server state; the test being shown (no peeking before release)
  const UI = { ...S0, pair: null, plan: null, mode: "sdk", modeChosen: false, rt: null, sig: { good: null, fatal: false, note: "" }, check: null, busy: false, t0: null, lastTranscript: null };
  let tickId = null, planTimer = null, sdkP = null;

  async function api(path, body) {
    const opt = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
    const r = await fetch(path, opt);
    const j = await r.json().catch(() => ({ error: "unreadable answer from the server" }));
    if (!r.ok) throw new Error(j.error || ("error " + r.status));
    return j;
  }
  const say = (msg, err) => toast(err ? "Problem: " + msg : msg, err ? 7000 : 3200);
  const guard = fn => async (...a) => { if (UI.busy) return; UI.busy = true; try { await fn(...a); } catch (e) { say(e.message || String(e), true); } finally { UI.busy = false; } };
  const ensureCss = () => { if (!document.getElementById("lc-css")) { const l = document.createElement("link"); l.id = "lc-css"; l.rel = "stylesheet"; l.href = "livecall.css"; document.head.appendChild(l); } };
  const ensureSdk = () => window.SarvamConv ? Promise.resolve() : (sdkP = sdkP || new Promise((ok, bad) => {
    const s = document.createElement("script"); s.src = "vendor/sarvam-conv-ai-sdk.browser.js"; s.onload = ok; s.onerror = () => { sdkP = null; bad(new Error("Could not load the Sarvam voice SDK.")); }; document.head.appendChild(s);
  }));
  const segs = a => a.map(([t, m]) => m ? `<mark>${esc(t)}</mark>` : esc(t)).join("");
  const banner = (html, cls = "") => `<div class="banner ${cls}"><div>${html}</div></div>`;

  // ------------------------------------------------------------------------------------------ load and paint
  async function load(openId) {
    S = await api("/api/live/state");
    if (!UI.sel.candidate) UI.sel.candidate = S.default_candidate;
    if (openId) T = await api("/api/live/test/" + openId); else T = S.active || (T && T.state !== "running" ? T : null);
    if (!UI.modeChosen && !UI.rt) UI.mode = S.connection.ready ? "sdk" : "manual";    // follow the connection until the user picks a way to call
    redraw();
  }
  function connPill() {
    const c = S.connection;
    return c.ready ? pill("Sarvam voice agents: ready", "pos") : c.key_set ? pill("Sarvam: agent ids missing", "warn") : pill("Sarvam key not set: calls can be logged by hand", "warn");
  }
  function redraw() {
    if (!nowIn()) return;
    const el = $("#page");
    if (!S) { el.innerHTML = head("Live call test", "") + `<p class="muted">Loading...</p>`; return; }
    if (!T) { el.innerHTML = setupHtml(); afterSetup(); }
    else if (T.state === "running") { el.innerHTML = runHtml(); tick(); }
    else el.innerHTML = resultHtml();
  }

  // ------------------------------------------------------------------------------------------ setup
  function setupHtml() {
    const c = S.connection, sel = UI.sel, past = S.tests.filter(t => t.state !== "running");
    return head("Live call test", "Hear today's prompt (A) and the patched prompt (B) on real Sarvam voice agents. After every call you give one signal. The result is released only when every prompt has the number of finished calls you fix now, so nobody can stop early on a lucky streak.", connPill()) + `<div class="lc-stack">
    <div class="card"><h2><span class="lc-num">1</span>The patch to test</h2>
      <div class="field" style="margin-top:12px"><label for="lc-cand">Prompt B is today's prompt plus this patch</label>
        <select id="lc-cand">${S.candidates.map(x => `<option value="${esc(x.key)}" ${x.key === sel.candidate ? "selected" : ""}>${esc(x.name)} (${esc(x.origin)})</option>`).join("")}</select></div>
      <div id="lc-pair" style="margin-top:12px">${pairHtml()}</div>
      <details style="margin-top:12px"><summary style="cursor:pointer;font-weight:500">Put the two prompts on Sarvam (about 5 minutes)</summary>
        <ol class="sub" style="margin:8px 0 0;padding-left:20px;display:grid;gap:4px">
          <li>Open <a href="https://indus.sarvam.ai/samvaad" target="_blank" rel="noopener">indus.sarvam.ai</a> → Build → Agents → Create from Scratch.</li>
          <li>Make <b>one agent with two committed versions</b> (version 1 = prompt A, version 2 = prompt B), or two agents. Paste the text from the download buttons above into <i>Instructions</i>, and commit each version (a draft cannot be called).</li>
          <li>Same greeting, language (Hindi) and voice on both, so only the prompt differs.</li>
          <li>Settings → API Key: create a key and put it in <span class="mono">.env</span> as <span class="mono">SARVAM_VOICE_API_KEY=...</span>. Copy the organisation id, workspace id and agent id from the dashboard address.</li>
          <li>Or let Claude do steps 1 to 3 through Sarvam's MCP server: <span class="mono">claude mcp add --transport http sarvam-voice-agents https://mcp.sarvam.ai/voice-agents</span></li></ol></details></div>

    <div class="card"><h2><span class="lc-num">2</span>Connect the two Sarvam agents ${c.ready ? pill("ready", "pos") : pill("not complete", "warn")}</h2>
      <p class="sub">The key stays on this computer (read from <span class="mono">.env</span>, never sent to the browser). Not set up yet? You can still run the whole test: talk to the agents anywhere (Sarvam's test page, a phone number) and log each call here.</p>
      <div class="grid g2" style="margin-top:12px">
        <div class="field"><label for="lc-org">Organisation id</label><input type="text" id="lc-org" value="${esc(c.org_id)}" autocomplete="off"></div>
        <div class="field"><label for="lc-ws">Workspace id</label><input type="text" id="lc-ws" value="${esc(c.workspace_id)}" autocomplete="off"></div>
        <div class="field"><label for="lc-appA">Prompt A: agent id</label><input type="text" id="lc-appA" value="${esc(c.arms.A.app_id)}" autocomplete="off"></div>
        <div class="field"><label for="lc-verA">Prompt A: committed version <span class="hint">(blank = latest)</span></label><input type="text" id="lc-verA" value="${esc(c.arms.A.version)}" autocomplete="off"></div>
        <div class="field"><label for="lc-appB">Prompt B: agent id</label><input type="text" id="lc-appB" value="${esc(c.arms.B.app_id)}" autocomplete="off"></div>
        <div class="field"><label for="lc-verB">Prompt B: committed version <span class="hint">(blank = latest)</span></label><input type="text" id="lc-verB" value="${esc(c.arms.B.version)}" autocomplete="off"></div></div>
      <div class="lc-row" style="margin-top:12px"><button class="btn" data-lc="save-conn">Save</button><button class="btn" data-lc="check-conn">Check connection (places no call)</button>
        ${c.key_set ? pill("API key found", "pos") : pill("no API key", "warn")}</div>
      <div id="lc-checkres" style="margin-top:12px">${checkHtml()}</div></div>

    <div class="card"><h2><span class="lc-num">3</span>Set the threshold before any call</h2>
      <div class="grid g3" style="margin-top:12px">
        <div class="field"><label for="lc-n">Finished calls needed per prompt</label><input type="number" id="lc-n" min="${S.limits.min_calls}" max="${S.limits.max_calls}" value="${sel.n}"></div>
        <div class="field"><label for="lc-conf">Confidence</label><select id="lc-conf">${Object.entries(S.confidence).map(([k, v]) => `<option value="${k}" ${k === sel.conf ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></div>
        <div class="field"><label for="lc-goal">Your signal after each call</label><input type="text" id="lc-goal" maxlength="40" value="${esc(sel.goal)}"><span class="hint note">"Was that a ...?" e.g. Good call, BuyLead-worthy call</span></div></div>
      <div class="lc-row" style="margin-top:12px">${[5, 10, 15, 20, 30].map(k => `<button class="btn sm" data-lc="preset" data-n="${k}">${k} per prompt</button>`).join("")}</div>
      <div id="lc-plan" class="banner" style="margin:12px 0">${planHtml()}</div>
      <label class="check" style="margin-bottom:12px"><input type="checkbox" id="lc-blind" ${sel.blind ? "checked" : ""}><span><b>Blind test.</b> You hear "Line 1" and "Line 2" and only learn which is the patched prompt when the result is released. Fairer, because nobody hopes for a winner while scoring.</span></label>
      <div class="field"><label for="lc-tname">Name of this test</label><input type="text" id="lc-tname" maxlength="80" value="${esc(sel.name)}"></div></div>

    <div class="card"><h2><span class="lc-num">4</span>Lock it and start</h2>
      <p class="sub">Locking records the threshold, the confidence, the guardrails and a fingerprint of the secret call order in the tamper-evident log. None of it can be changed afterwards. The result appears on its own after the last call.</p>
      <div style="margin-top:12px"><button class="btn primary" data-lc="lock">Lock the test and start calling</button></div></div>
    ${past.length ? `<div class="card"><h2>Earlier live call tests</h2><div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>Name</th><th>Status</th><th>Started</th><th></th></tr></thead><tbody>${past.map(t => `<tr><td>${esc(t.name)}</td><td>${esc(t.state)}</td><td>${esc(fdt(t.created))}</td><td><button class="link" data-lc="open" data-id="${esc(t.id)}">open</button></td></tr>`).join("")}</tbody></table></div></div>` : ""}</div>`;
  }
  function pairHtml() {
    const p = UI.pair;
    if (!p) return '<p class="muted">Loading the patch...</p>';
    const ch = p.changes.length ? p.changes.map(c => `<div class="lc-change"><div class="old"><span class="tag">TODAY (A)</span> ${segs(c.before)}</div><div class="new"><span class="tag">PATCHED (B)</span> ${segs(c.after)}</div></div>`).join("") : '<p class="muted">No visible difference.</p>';
    return `<div class="grid g2"><div><b>${esc(p.A.name)}</b><div class="mono muted">fingerprint ${esc(p.A.hash)}</div></div><div><b>${esc(p.B.name)}</b><div class="mono muted">fingerprint ${esc(p.B.hash)}</div></div></div>
      ${p.why ? `<p class="sub"><b>Why:</b> ${esc(p.why)}</p>` : ""}${p.risk ? `<p class="sub"><b>Risk:</b> ${esc(p.risk)}</p>` : ""}
      <div style="display:grid;gap:8px;margin-top:12px"><b>What the patch changes</b>${ch}</div>
      <div class="lc-row" style="margin-top:12px"><a class="btn sm" href="/api/live/prompt/A?candidate=${encodeURIComponent(UI.sel.candidate)}">Download prompt A</a><a class="btn sm" href="/api/live/prompt/B?candidate=${encodeURIComponent(UI.sel.candidate)}">Download prompt B</a>
      <span class="sub">Ready to paste into Sarvam (the real inbound prompt, filled in for a demo call about stainless steel pipes).</span></div>`;
  }
  const checkHtml = () => !UI.check ? "" : Object.entries(UI.check.checks).map(([k, r]) => banner(`<b>Prompt ${k}:</b> ${esc(r.detail)}`, r.ok ? "pos" : "warn")).join("");
  function planHtml() {
    const p = UI.plan;
    if (!p) return "<div>Working out what this threshold can show...</div>";
    const g = p.detectable_gap, lo = g != null ? Math.round((0.5 - g / 2) * 100) : null, hi = g != null ? Math.round((0.5 + g / 2) * 100) : null;
    return `<div><b>${p.calls_per_arm} finished calls per prompt (${p.total} in total).</b><br>
      ${g == null ? "Even a 90-point gap would not be caught reliably: use more calls." : `If B is truly better, a real gap of about <b>${Math.round(g * 100)} points</b> or more (for example ${lo}% vs ${hi}% good calls) is caught 8 times in 10. A smaller gap will usually end as "no clear winner".`}<br>
      If the two prompts are really identical, a false winner appears in about <b>${(p.false_win * 100).toFixed(1)}%</b> of tests (computed exactly, worst case over common rates).<br>
      The result stays locked until all ${p.total} calls are done and signalled.</div>`;
  }
  function afterSetup() { if (!UI.pair) loadPair(); if (!UI.plan) loadPlan(); }
  async function loadPair() {
    try { UI.pair = await api("/api/live/pair?candidate=" + encodeURIComponent(UI.sel.candidate)); } catch (e) { UI.pair = { A: { name: "-", hash: "" }, B: { name: "-", hash: "" }, changes: [], why: null, risk: null }; say(e.message, true); }
    const el = $("#lc-pair"); if (el) el.innerHTML = pairHtml();
  }
  function loadPlan() {
    clearTimeout(planTimer);
    planTimer = setTimeout(async () => {
      try { UI.plan = await api(`/api/live/plan?n=${UI.sel.n}&conf=${UI.sel.conf}`); } catch (e) { UI.plan = null; const el = $("#lc-plan"); if (el) el.textContent = e.message; return; }
      const el = $("#lc-plan"); if (el) el.innerHTML = planHtml();
    }, 250);
  }
  function readSetup() {
    const v = id => ($("#" + id) || {}).value;
    UI.sel.n = parseInt(v("lc-n"), 10) || UI.sel.n; UI.sel.conf = v("lc-conf") || UI.sel.conf; UI.sel.goal = (v("lc-goal") || "").trim() || "Good call";
    UI.sel.name = (v("lc-tname") || "").trim() || "Live call test"; UI.sel.blind = !!($("#lc-blind") || {}).checked;
  }
  const readConn = () => { const v = id => ($("#" + id).value || "").trim(); return { org_id: v("lc-org"), workspace_id: v("lc-ws"), arms: { A: { app_id: v("lc-appA"), version: v("lc-verA") }, B: { app_id: v("lc-appB"), version: v("lc-verB") } } }; };

  // ------------------------------------------------------------------------------------------ run
  function runHtml() {
    const c = T.config;
    const prog = T.progress.map(p => `<div class="card"><div class="muted">${esc(p.label)}</div><div class="lc-big">${p.done} of ${p.of} calls</div><div class="lc-bar" aria-hidden="true"><i style="width:${Math.min(100, p.done / p.of * 100)}%"></i></div></div>`).join("");
    return head(T.name, `${esc(c.prompt_names.A)} versus ${esc(c.prompt_names.B)}. ${c.blind ? "Blind: the two lines are not labelled A or B. " : ""}Locked ${esc(fdt(T.created))}; confidence ${Math.round(c.confidence * 100)}%; ${c.calls_per_arm} finished calls per prompt; log fingerprint <span class="mono">${esc(T.ledger.head.slice(0, 12))}</span>.`, connPill()) + `<div class="lc-stack">
      <div class="grid g3">${prog}
        <div class="card lc-locked"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#667085" stroke-width="2" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg><b>Result locked</b><span class="muted">Opens after ${T.total_planned} finished calls (${T.total_done} done)</span></div></div>
      <div class="card lc-callcard" id="lc-callcard">${callCardHtml()}</div>
      ${callsTableHtml()}
      <div><button class="link" data-lc="abandon">Abandon this test (no result is shown; the reason is kept in the log)</button></div></div>`;
  }
  const nextRole = () => S.roles[Math.floor(T.calls.length / 2) % S.roles.length];
  const cueHtml = role => `<div class="lc-cue"><b>${esc(role.title)}.</b> You play the buyer, same story for both prompts of this pair:<br>${esc(role.say)}</div>`;
  function callCardHtml() {
    const oc = T.open_call, rt = UI.rt, total = T.total_planned;
    if (!oc) {
      const c = S.connection;
      return `<div class="muted">Call ${T.calls.length + 1} of ${total}</div>${cueHtml(nextRole())}
        <div class="lc-row" role="group" aria-label="How to call">
          <label class="check"><input type="radio" name="lc-mode" value="sdk" ${UI.mode === "sdk" ? "checked" : ""} ${c.ready ? "" : "disabled"}><span>Talk here, in this page (Sarvam voice)</span></label>
          <label class="check"><input type="radio" name="lc-mode" value="manual" ${UI.mode === "manual" ? "checked" : ""}><span>Talk somewhere else, log it here</span></label></div>
        <button class="btn primary lc-bigbtn" data-lc="next-call">${UI.mode === "sdk" ? "Start next call" : "Get the next call"}</button>
        ${c.ready ? "" : '<p class="sub">Sarvam is not fully connected, so calls are logged by hand. Fill in step 2 on the setup screen of a new test to talk here.</p>'}`;
    }
    const top = `<div class="muted">Call ${oc.n} of ${total}</div><div class="lc-line">${esc(oc.label)}</div>`;
    const voidBtn = `<button class="link" data-lc="void">This call did not work (void it)</button>`;
    if (oc.status === "assigned") {
      return top + cueHtml(oc.role) + (oc.source === "manual"
        ? `<p>Open <b>${esc(oc.label)}</b> in Sarvam (the agent you set up for it), then press start and talk.</p><button class="btn primary lc-bigbtn" data-lc="manual-start">I am starting the call now</button>`
        : `<button class="btn primary lc-bigbtn" data-lc="sdk-start">Start the call</button><p class="sub">Your browser will ask for the microphone. Speak in Hindi or Hinglish.</p>`) + voidBtn;
    }
    if (oc.status === "in_call") {
      if (oc.source === "manual") {
        return top + `<div class="lc-timer" id="lc-timer">0:00</div>${cueHtml(oc.role)}<p>Talk to <b>${esc(oc.label)}</b>. When you hang up:</p>
          <div class="field" style="min-width:220px"><label for="lc-secs">Call length in seconds <span class="hint">(filled in from the timer)</span></label><input type="number" id="lc-secs" min="0" max="3600"></div>
          <button class="btn primary lc-bigbtn" data-lc="manual-end">The call is finished</button>` + voidBtn;
      }
      if (!rt) return top + banner("This call was cut off (the page was reloaded while it was running). It cannot be resumed.", "warn") + voidBtn;
      const tr = rt.transcript.map(m => `<div class="lc-bub ${m.role}"><small>${m.role === "bot" ? "Agent" : "You"}</small>${esc(m.content)}</div>`).join("");
      return top + `<div>${pill(rt.state, "run").replace('class="pill run"', 'class="pill run" id="lc-state"')}</div><div class="lc-timer" id="lc-timer">0:00</div><div class="lc-level" aria-hidden="true"><i id="lc-level"></i></div>
        <div class="lc-row"><button class="btn" data-lc="mute">${rt.muted ? "Unmute" : "Mute"}</button><button class="btn danger lc-bigbtn" data-lc="sdk-end">End call</button></div>
        <div class="lc-transcript" id="lc-transcript" aria-live="polite">${tr || '<span class="muted">The conversation appears here as you talk.</span>'}</div>${cueHtml(oc.role)}`;
    }
    const g = T.config.goal_name, s = UI.sig;                               // awaiting the listener's signal
    const tr = (UI.lastTranscript || []).map(m => `<div class="lc-bub ${m.role}"><small>${m.role === "bot" ? "Agent" : "You"}</small>${esc(m.content)}</div>`).join("");
    return top + `<p>The call lasted <b>${mmss(oc.duration_s)}</b>. Your signal:</p>
      <div class="lc-sig" role="group" aria-label="Signal"><button class="btn lc-yes ${s.good === true ? "on" : ""}" data-lc="sig" data-v="1">Yes: ${esc(g)}</button><button class="btn lc-no ${s.good === false ? "on" : ""}" data-lc="sig" data-v="0">No: not a ${esc(g.toLowerCase())}</button></div>
      <label class="check"><input type="checkbox" id="lc-fatal" ${s.fatal ? "checked" : ""}><span>There was a <b>fatal problem</b> (wrong behaviour, looped, rude, hung up, ignored the buyer)</span></label>
      <div class="field" style="width:100%;max-width:640px;text-align:left"><label for="lc-note">Note (optional)</label><textarea id="lc-note" maxlength="300">${esc(s.note)}</textarea></div>
      <button class="btn primary lc-bigbtn" data-lc="save-sig" ${s.good === null ? "disabled" : ""}>Save signal</button>
      ${tr ? `<details style="width:100%;max-width:640px;text-align:left"><summary style="cursor:pointer;font-weight:500">What was said</summary><div class="lc-transcript">${tr}</div></details>` : ""}` + voidBtn;
  }
  function callsTableHtml() {
    if (!T.calls.length) return "";
    const st = { done: "saved", awaiting_signal: "waiting for your signal", in_call: "in the call", assigned: "not started" };
    return `<div class="card"><h2>Calls so far</h2><p class="sub">Signals and totals are hidden until the result is released.</p><div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>#</th><th>Line</th><th>Buyer</th><th class="n">Length</th><th>Signal</th></tr></thead><tbody>
      ${T.calls.map(c => `<tr><td>${c.n}</td><td>${esc(c.label)}</td><td>${esc(c.role.title)}</td><td class="n">${c.duration_s != null ? mmss(c.duration_s) : "-"}</td><td>${st[c.status] || ""}</td></tr>`).join("")}</tbody></table></div></div>`;
  }
  function tick() {
    clearInterval(tickId);
    const oc = T && T.open_call;
    if (!oc || oc.status !== "in_call") return;
    const t0 = UI.t0 || Date.now(); UI.t0 = t0;
    const upd = () => { const el = $("#lc-timer"); if (el) { const s = (Date.now() - t0) / 1000; el.textContent = mmss(s); const f = $("#lc-secs"); if (f && !f.dataset.touched) f.value = Math.round(s); } };
    upd(); tickId = setInterval(upd, 500);
  }

  // ------------------------------------------------------------------------------------------ result
  const VERDICT = {
    PROMOTE: ["pos", "Prompt B wins", "B is the better prompt on these calls, by more than luck explains, and no guardrail was breached."],
    HOLD_FOR_APPROVAL: ["warn", "B wins, but check before rolling out", "B had clearly more good calls, but a guardrail was breached. A person should approve it."],
    STOP_HARM: ["neg", "Prompt A is better: keep today's prompt", "The patched prompt did clearly worse. Do not roll it out."],
    INCONCLUSIVE: ["plain", "No clear winner", "The calls do not show a gap bigger than luck could produce."]
  };
  function resultHtml() {
    const r = T.result, c = T.config, lab = T.reveal.labels, nm = k => c.prompt_names[k], a = r.a, b = r.b;
    const [cls, hd, base] = VERDICT[r.verdict] || ["plain", r.verdict, ""];
    let why = base;
    if (r.verdict === "INCONCLUSIVE") {
      const lean = Math.abs(r.diff) >= 0.2 ? `On these calls Prompt ${r.diff > 0 ? "B" : "A"} looked better (A ${pct(r.rate_a)}, B ${pct(r.rate_b)}), but ` : "";
      if (lean) why = lean + `${c.calls_per_arm} calls per prompt is too few to be sure it is not luck.`;
      if (r.call === "borderline") why += " The two tests we require did not agree, so it is called borderline, not a win.";
      why += ` This is not proof the prompts are the same: ${c.calls_per_arm} calls per prompt can only catch big gaps.`;
      why += r.more_calls_per_prompt == null ? " The gap seen is under 5 points, too small to matter."
        : r.more_calls_per_prompt > 150 ? " The gap seen is small: confirming it would take well over 100 calls per prompt, probably not worth chasing."
        : ` If the gap you saw is real, about ${r.more_calls_per_prompt} calls per prompt in a NEW test would confirm it (do not add calls to this one: that would break the fairness).`;
    }
    const guard = r.guards.map(g => `<tr><td>${esc(g.name)}</td><td>${esc(g.limit)}</td><td>${esc(g.value)}</td><td>${g.breach ? pill("breached", "neg") : pill("ok", "pos")}</td></tr>`).join("");
    const row = (k, s) => `<tr><td><b>${esc(nm(k))}</b><div class="muted">${esc(lab[k])}</div></td><td class="n">${s.n}</td><td class="n">${s.good} of ${s.n} (${pct(s.n ? s.good / s.n : null)})</td><td class="n">${s.fatal}</td><td class="n">${s.median_s != null ? mmss(s.median_s) : "-"}</td></tr>`;
    const calls = T.calls.filter(x => x.status === "done");
    const trBub = m => `<div class="lc-bub ${m.role}"><small>${m.role === "bot" ? "Agent" : "Buyer"}</small>${esc(m.content)}</div>`;
    return head("Live call test: result", `${esc(T.name)}. Released ${esc(fdt(r.released_at))} after ${c.calls_per_arm} finished calls per prompt.`, `<button class="btn primary" data-lc="new">Start a new test</button>`) + `<div class="lc-stack">
      <div class="card lc-verdict ${cls}"><div>${pill(r.verdict.replace(/_/g, " "), cls)}</div><h2 style="font-size:24px">${esc(hd)}</h2><p>${esc(why)}</p>
        ${c.blind ? banner(`<b>Reveal:</b> ${esc(lab.A)} was ${esc(nm("A"))}; ${esc(lab.B)} was ${esc(nm("B"))}.`) : ""}</div>

      <div class="card"><h2>Your signals: "${esc(r.goal_name)}"</h2><div class="tbl-wrap" style="margin:12px 0"><table><thead><tr><th>Prompt</th><th class="n">Calls</th><th class="n">${esc(r.goal_name)}</th><th class="n">Fatal problems</th><th class="n">Typical length</th></tr></thead><tbody>${row("A", a)}${row("B", b)}</tbody></table></div>
        <div class="grid g3"><div><div class="lc-big">${lcPts(r.diff)}</div><div class="muted">B minus A (${pct(r.rate_b)} vs ${pct(r.rate_a)})</div></div>
          <div><div class="lc-big">${lcPts(r.lo)} to ${lcPts(r.hi)}</div><div class="muted">plausible range at ${Math.round(c.confidence * 100)}% confidence (approximate for small samples)</div></div>
          <div><div class="lc-big">${(r.p_value * 100).toFixed(1)}%</div><div class="muted">chance of a gap this big by luck alone if the prompts were really equal (exact test; a win needs this under ${Math.round(r.alpha * 100)}%)</div></div></div></div>

      <div class="card"><h2>Guardrails</h2><div class="tbl-wrap" style="margin:12px 0"><table><thead><tr><th>Check</th><th>Rule fixed before the test</th><th>Result</th><th></th></tr></thead><tbody>${guard}</tbody></table></div>
        <p class="sub">These are plain comparisons of what happened in this small test. They can send a win to a person for approval; they never create a win.</p></div>

      <div class="card"><h2>Hear them again</h2><div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>#</th><th>Prompt</th><th class="n">Length</th><th>Signal</th><th>Fatal</th><th></th></tr></thead><tbody>
        ${calls.map(x => `<tr><td>${x.n}</td><td>${esc(c.prompt_names[x.arm])} <span class="muted">(${esc(x.label)})</span></td><td class="n">${mmss(x.duration_s)}</td><td>${x.good ? pill("yes", "pos") : pill("no", "neg")}</td><td>${x.fatal ? pill("fatal", "neg") : ""}</td>
          <td><button class="link" data-lc="tr" data-id="${esc(x.id)}">transcript</button>${x.interaction_id ? ` · <button class="link" data-lc="rec" data-id="${esc(x.id)}">listen</button>` : ""}</td></tr>
          <tr hidden id="lc-tr-${esc(x.id)}"><td colspan="6">${x.note ? `<p><b>Note:</b> ${esc(x.note)}</p>` : ""}${x.interaction_id ? `<p class="mono muted">Sarvam interaction ${esc(x.interaction_id)}</p>` : ""}<div class="lc-transcript" style="max-width:none">${(x.transcript || []).map(trBub).join("") || '<span class="muted">No transcript was captured (logged by hand).</span>'}</div><div id="lc-rec-${esc(x.id)}"></div></td></tr>`).join("")}</tbody></table></div></div>

      <div class="card"><h2>Proof this was fair</h2>
        <p class="sub">Before call 1 the log recorded the threshold, the confidence, the guardrails and a fingerprint of the secret call order. The order is revealed now: anyone can re-hash it.</p>
        <div class="grid g2" style="margin:12px 0"><div><div class="muted">Call order (A = today, B = patched)</div><div class="mono">${esc(T.reveal.sequence.join(" "))}</div></div>
          <div><div class="muted">Log fingerprint (${T.ledger.entries} entries, ${T.ledger.ok ? "chain verified" : "CHAIN BROKEN"})</div><div class="mono">${esc(T.ledger.head)}</div></div></div>
        <div class="lc-row"><a class="btn" href="/api/live/test/${esc(T.id)}/csv">Download the results as CSV</a></div>
        <p class="sub" style="margin-top:12px">This is a listening test: it tells you which prompt your team judged better on ${T.total_planned} calls. Production traffic is judged by Live Experiments and History.</p></div></div>`;
  }

  // ------------------------------------------------------------------------------------------ the voice call (Sarvam browser SDK)
  const setLevel = l => { const el = $("#lc-level"); if (el && l) el.style.width = Math.min(100, Math.max(0, (l.rms || 0) * 400)) + "%"; };
  function friendly(e) {
    const m = (e && (e.message || e.name)) || String(e);
    if (e && e.name === "NotAllowedError") return "The browser blocked the microphone. Allow it in the address bar and try again.";
    if (e && e.name === "NotFoundError") return "No microphone was found.";
    if (e && e.name === "NotReadableError") return "The microphone is in use by another program.";
    if (/Authentication|401/.test(m)) return "Sarvam rejected the API key. Check SARVAM_VOICE_API_KEY (Settings > API Key in indus.sarvam.ai).";
    if (/not found|404/i.test(m)) return "Sarvam did not find that agent or committed version. Check the ids and that the version is committed.";
    return m;
  }
  const card = () => { const el = $("#lc-callcard"); if (el) el.innerHTML = callCardHtml(); };
  async function sdkStart() {
    await ensureSdk();
    const oc = T.open_call, con = S.connection, SDK = window.SarvamConv;
    UI.sig = { good: null, fatal: false, note: "" }; UI.lastTranscript = null;
    const rt = UI.rt = { transcript: [], state: "CONNECTING", muted: false, ended: false, finishing: false, callId: oc.id };
    const audio = new SDK.BrowserAudioInterface(16000, { outputLevelCallback: setLevel });
    const cfg = { org_id: con.org_id, workspace_id: con.workspace_id, app_id: oc.app_id, user_identifier: `canary-${T.id}-${oc.id}`, user_identifier_type: "custom",
                  interaction_type: SDK.InteractionType.CALL, input_sample_rate: 16000, output_sample_rate: 16000 };
    if (oc.version) cfg.version = /^\d+$/.test(oc.version) ? Number(oc.version) : oc.version;
    const agent = rt.agent = new SDK.ConversationAgent({
      apiKey: "", baseUrl: location.origin + "/sarvam/", config: cfg, audioInterface: audio,
      stateCallback: s => { rt.state = s; const el = $("#lc-state"); if (el) el.lastChild.textContent = s; },
      transcriptCallback: async m => { rt.transcript.push({ role: m.role === "user" ? "user" : "bot", content: m.content }); paintTranscript(); },
      endCallback: async () => { if (!rt.ended) sdkFinish(); }
    });
    T.open_call.status = "in_call"; UI.t0 = null; card();
    try {
      await agent.start();
      if (!(await agent.waitForConnect(15))) throw new Error("The call did not connect within 15 seconds.");
      await api(`/api/live/test/${T.id}/call/${oc.id}/start`, {});
    } catch (e) {
      rt.ended = true; UI.rt = null; try { await agent.stop(); } catch (x) { /* already closed */ }
      T.open_call.status = "assigned"; card();
      throw new Error(friendly(e));
    }
    UI.t0 = Date.now();
    T = await api("/api/live/test/" + T.id); redraw();                     // the table now shows this call as "in the call"
  }
  function paintTranscript() {
    const el = $("#lc-transcript"), rt = UI.rt; if (!el || !rt) return;
    el.innerHTML = rt.transcript.map(m => `<div class="lc-bub ${m.role}"><small>${m.role === "bot" ? "Agent" : "You"}</small>${esc(m.content)}</div>`).join("");
    el.scrollTop = el.scrollHeight;
  }
  async function sdkFinish() {
    const rt = UI.rt; if (!rt || rt.finishing) return;
    rt.ended = true; rt.finishing = true; clearInterval(tickId);
    let iid = ""; try { iid = rt.agent.getInteractionId() || ""; } catch (e) { /* not connected */ }
    try { await rt.agent.stop(); } catch (e) { /* already closed */ }
    UI.lastTranscript = rt.transcript;
    try { await api(`/api/live/test/${T.id}/call/${rt.callId}/end`, { interaction_id: iid, transcript: rt.transcript }); } catch (e) { say(e.message, true); }
    UI.rt = null; UI.t0 = null;
    T = await api("/api/live/test/" + T.id); redraw();
  }

  // ------------------------------------------------------------------------------------------ actions (one set of listeners for the whole console)
  document.addEventListener("click", ev => {
    const b = ev.target.closest("[data-lc]"); if (!b || !nowIn()) return;
    const act = b.dataset.lc, cur = () => T.open_call;
    const H = {
      "preset": () => { UI.sel.n = +b.dataset.n; $("#lc-n").value = UI.sel.n; loadPlan(); },
      "save-conn": guard(async () => { await api("/api/live/connection", readConn()); await load(); say("Saved"); }),
      "check-conn": guard(async () => { await api("/api/live/connection", readConn()); UI.check = await api("/api/live/check", {}); await load(); }),
      "lock": guard(async () => {
        readSetup(); await api("/api/live/connection", readConn()).catch(() => 0);
        T = await api("/api/live/test", { name: UI.sel.name, candidate: UI.sel.candidate, calls_per_arm: UI.sel.n, confidence: UI.sel.conf, blind: UI.sel.blind, goal_name: UI.sel.goal });
        await load(); }),
      "open": guard(async () => { T = await api("/api/live/test/" + b.dataset.id); redraw(); }),
      "new": () => { T = null; UI.pair = null; UI.plan = null; load(); },
      "next-call": guard(async () => { const r = await api(`/api/live/test/${T.id}/call`, { source: UI.mode }); T = r.test; redraw(); if (UI.mode === "sdk") await sdkStart(); }),
      "sdk-start": guard(async () => { await sdkStart(); }),
      "sdk-end": guard(async () => { await sdkFinish(); }),
      "mute": () => { const rt = UI.rt; if (!rt) return; rt.muted ? rt.agent.unmute() : rt.agent.mute(); rt.muted = !rt.muted; b.textContent = rt.muted ? "Unmute" : "Mute"; },
      "manual-start": guard(async () => { await api(`/api/live/test/${T.id}/call/${cur().id}/start`, {}); UI.t0 = Date.now(); T = await api("/api/live/test/" + T.id); redraw(); }),
      "manual-end": guard(async () => { const secs = $("#lc-secs").value; await api(`/api/live/test/${T.id}/call/${cur().id}/end`, { duration_s: secs === "" ? null : Number(secs) }); UI.t0 = null; UI.lastTranscript = null; T = await api("/api/live/test/" + T.id); redraw(); }),
      "sig": () => { UI.sig.good = b.dataset.v === "1"; UI.sig.fatal = !!($("#lc-fatal") || {}).checked; UI.sig.note = ($("#lc-note") || {}).value || ""; card(); },
      "save-sig": guard(async () => {
        const r = await api(`/api/live/test/${T.id}/call/${cur().id}/signal`, { good: UI.sig.good, fatal: !!$("#lc-fatal").checked, note: $("#lc-note").value });
        UI.sig = { good: null, fatal: false, note: "" }; UI.lastTranscript = null; T = r.test; await load(r.released ? T.id : undefined);
        say(r.released ? "Threshold reached: the result is released" : "Signal saved"); }),
      "void": guard(async () => {
        const reason = prompt("Why did this call not work? (kept in the log)", "no sound / dropped / wrong agent"); if (!reason) return;
        if (UI.rt) { UI.rt.ended = true; try { await UI.rt.agent.stop(); } catch (e) { /* closed */ } UI.rt = null; }
        const r = await api(`/api/live/test/${T.id}/call/${cur().id}/void`, { reason }); T = r.test; UI.t0 = null; redraw(); say("Voided: the same prompt will be called again"); }),
      "abandon": guard(async () => {
        const reason = prompt("Why are you abandoning this test? No result will be shown.", ""); if (!reason) return;
        await api(`/api/live/test/${T.id}/abandon`, { reason }); T = null; await load(); }),
      "tr": () => { const el = document.getElementById("lc-tr-" + b.dataset.id); if (el) el.hidden = !el.hidden; },
      "rec": () => {
        const box = document.getElementById("lc-rec-" + b.dataset.id), tr = document.getElementById("lc-tr-" + b.dataset.id); if (tr) tr.hidden = false;
        box.innerHTML = `<audio controls autoplay src="/api/live/recording/${T.id}/${b.dataset.id}" style="width:100%"></audio>`;
        box.firstChild.addEventListener("error", () => { box.innerHTML = banner("Sarvam did not return a playable recording here. Open this call in Sarvam → Monitor → Call Logs with the interaction id shown above.", "warn"); });
      }
    };
    if (H[act]) H[act]();
  });
  document.addEventListener("input", ev => {
    if (!nowIn()) return;
    const t = ev.target;
    if (t.id === "lc-n" || t.id === "lc-conf") { readSetup(); loadPlan(); }
    if (t.id === "lc-fatal") UI.sig.fatal = t.checked;
    if (t.id === "lc-note") UI.sig.note = t.value;
    if (t.id === "lc-secs") t.dataset.touched = "1";
  });
  document.addEventListener("change", ev => {
    if (!nowIn()) return;
    const t = ev.target;
    if (t.id === "lc-cand") { UI.sel.candidate = t.value; UI.pair = null; $("#lc-pair").innerHTML = pairHtml(); loadPair(); }
    if (t.name === "lc-mode") { UI.mode = t.value; UI.modeChosen = true; if (T && !T.open_call) card(); }
  });
  window.addEventListener("beforeunload", e => { if (UI.rt && !UI.rt.ended) { e.preventDefault(); e.returnValue = ""; } });

  ROUTES.livecall = () => { ensureCss(); $("#page").innerHTML = head("Live call test", "") + `<p class="muted">Loading...</p>`; load().catch(e => { if (nowIn()) $("#page").innerHTML = head("Live call test", "") + banner("Could not load the live call test: " + esc(e.message), "neg"); }); };
})();
