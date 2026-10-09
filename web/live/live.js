"use strict";
/* Canary live call test: one page, three states. SETUP (pick the patch, connect the agents, set the threshold, lock) ->
   RUN (call, give a signal, repeat; results stay locked) -> RESULT (released only when every prompt has the planned number of calls).
   All statistics and rules live on the server (canary/livecall.py, canary/livestats.py); this page only shows them. */

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = x => x == null ? "-" : Math.round(x * 100) + "%";
const pts = x => (x >= 0 ? "+" : "-") + Math.abs(Math.round(x * 100)) + " points";
const mmss = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
const when = iso => { try { return new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); } catch (e) { return iso; } };

let S = null;                       // server state: connection, candidates, ...
let T = null;                       // the test being shown (public view: no peeking before release)
const UI = { sel: { candidate: "", n: 10, conf: "90", blind: true, goal: "Good call", name: "Live call test" }, pair: null, plan: null, mode: "sdk",
             rt: null, sig: { good: null, fatal: false, note: "" }, check: null, busy: false, rec: {} };

async function api(path, body) {
  const opt = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const r = await fetch(path, opt);
  const j = await r.json().catch(() => ({ error: "unreadable answer from the server" }));
  if (!r.ok) throw new Error(j.error || ("error " + r.status));
  return j;
}
function toast(msg, err) {
  const el = document.createElement("div"); el.className = "toast" + (err ? " err" : ""); el.setAttribute("role", "status"); el.textContent = msg;
  document.body.appendChild(el); setTimeout(() => el.remove(), err ? 7000 : 3500);
}
const guard = fn => async (...a) => { if (UI.busy) return; UI.busy = true; try { await fn(...a); } catch (e) { toast(e.message || String(e), true); } finally { UI.busy = false; } };

// ---------------------------------------------------------------------------------------------- load + chrome
async function load(openId) {
  S = await api("/api/live/state");
  if (!UI.sel.candidate) UI.sel.candidate = S.default_candidate;
  if (openId) T = await api("/api/live/test/" + openId); else T = S.active || (T && T.state !== "running" ? T : null);
  if (T && T.state === "running" && !S.active) T = null;
  const c = S.connection;
  const chip = $("#conn");
  chip.className = "pill " + (c.ready ? "pos" : "warn");
  chip.textContent = c.ready ? "Sarvam voice agents: ready" : c.key_set ? "Sarvam: agent ids missing" : "Sarvam key not set: calls can be logged by hand";
  if (!UI.modeChosen && !UI.rt) UI.mode = c.ready ? "sdk" : "manual";          // follow the connection until the user picks a way to call
  if (!c.ready && UI.mode === "sdk" && !UI.rt) UI.mode = "manual";
  render();
}
function render() {
  const app = $("#app");
  if (!T) { app.innerHTML = setupHtml(); afterSetup(); }
  else if (T.state === "running") { app.innerHTML = runHtml(); afterRun(); }
  else { app.innerHTML = resultHtml(); }
}

// ---------------------------------------------------------------------------------------------- SETUP
function setupHtml() {
  const c = S.connection, sel = UI.sel;
  const past = S.tests.filter(t => t.state !== "running");
  return `
  <section class="hero"><h1>Hear the difference, then let your signals decide</h1>
    <p>Call today's prompt (A) and the patched prompt (B) on real Sarvam voice agents. After every call you give one signal. The result is released only when every prompt has the number of finished calls you fix now, so nobody can stop early on a lucky streak.</p></section>

  <section class="card"><h2><span class="num">1</span>The patch to test</h2>
    <label class="f">Prompt B is today's prompt plus this patch
      <select id="cand">${S.candidates.map(x => `<option value="${esc(x.key)}" ${x.key === sel.candidate ? "selected" : ""}>${esc(x.name)}  (${esc(x.origin)})</option>`).join("")}</select></label>
    <div id="pair">${pairHtml()}</div>
    <details><summary>Put the two prompts on Sarvam (about 5 minutes)</summary>
      <ol class="sub" style="margin:0;padding-left:20px;display:grid;gap:4px">
        <li>Open <a href="https://indus.sarvam.ai/samvaad" target="_blank" rel="noopener">indus.sarvam.ai</a> &rarr; Build &rarr; Agents &rarr; Create from Scratch.</li>
        <li>Make <b>one agent with two committed versions</b> (version 1 = prompt A, version 2 = prompt B), or two agents. Paste the text from the buttons above into <i>Instructions</i>.</li>
        <li>Same greeting, language (Hindi) and voice on both, so only the prompt differs. Commit each version (a draft cannot be called).</li>
        <li>Settings &rarr; API Key: create a key and put it in <span class="mono">.env</span> as <span class="mono">SARVAM_VOICE_API_KEY=...</span>. Copy the organisation id, workspace id and agent id from the dashboard address.</li>
        <li>Or let Claude do steps 1 to 3 through Sarvam's MCP server: <span class="mono">claude mcp add --transport http sarvam-voice-agents https://mcp.sarvam.ai/voice-agents</span></li>
      </ol></details></section>

  <section class="card"><h2><span class="num">2</span>Connect the two Sarvam agents ${c.ready ? '<span class="pill pos">ready</span>' : '<span class="pill warn">not complete</span>'}</h2>
    <p class="sub">The key stays on this computer (it is read from <span class="mono">.env</span> and never sent to the browser). Not set up yet? You can still run the whole test: talk to the agents anywhere (Sarvam's test page, a phone number) and log each call here.</p>
    <div class="grid2">
      <label class="f">Organisation id<input type="text" id="org" value="${esc(c.org_id)}" autocomplete="off"></label>
      <label class="f">Workspace id<input type="text" id="ws" value="${esc(c.workspace_id)}" autocomplete="off"></label>
      <label class="f">Prompt A: agent id<input type="text" id="appA" value="${esc(c.arms.A.app_id)}" autocomplete="off"></label>
      <label class="f">Prompt A: committed version <small>blank = latest</small><input type="text" id="verA" value="${esc(c.arms.A.version)}" autocomplete="off"></label>
      <label class="f">Prompt B: agent id<input type="text" id="appB" value="${esc(c.arms.B.app_id)}" autocomplete="off"></label>
      <label class="f">Prompt B: committed version <small>blank = latest</small><input type="text" id="verB" value="${esc(c.arms.B.version)}" autocomplete="off"></label>
    </div>
    <div class="row"><button class="btn" data-act="save-conn">Save</button><button class="btn" data-act="check-conn">Check connection (places no call)</button>
      <span class="pill ${c.key_set ? "pos" : "warn"}">${c.key_set ? "API key found" : "no API key"}</span></div>
    <div id="checkres">${checkHtml()}</div></section>

  <section class="card"><h2><span class="num">3</span>Set the threshold before any call</h2>
    <div class="grid3">
      <label class="f">Finished calls needed per prompt<input type="number" id="n" min="${S.limits.min_calls}" max="${S.limits.max_calls}" value="${sel.n}"></label>
      <label class="f">Confidence<select id="conf">${Object.entries(S.confidence).map(([k, v]) => `<option value="${k}" ${k === sel.conf ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>
      <label class="f">Your signal after each call<input type="text" id="goal" maxlength="40" value="${esc(sel.goal)}"><small>"Was that a ...?" e.g. Good call, BuyLead-worthy call</small></label>
    </div>
    <div class="row">${[5, 10, 15, 20, 30].map(k => `<button class="btn sm" data-act="preset" data-n="${k}">${k} per prompt</button>`).join("")}</div>
    <div id="plan" class="note">${planHtml()}</div>
    <label class="check"><input type="checkbox" id="blind" ${sel.blind ? "checked" : ""}><span><b>Blind test.</b> You hear "Line 1" and "Line 2" and only learn which is the patched prompt when the result is released. Fairer, because nobody hopes for a winner while scoring.</span></label>
    <label class="f">Name of this test<input type="text" id="tname" maxlength="80" value="${esc(sel.name)}"></label></section>

  <section class="card"><h2><span class="num">4</span>Lock it and start</h2>
    <p class="sub">Locking records the threshold, the confidence, the guardrails and a fingerprint of the secret call order in a tamper-evident log. None of it can be changed afterwards. The result appears on its own after the last call.</p>
    <div class="row"><button class="btn primary big" data-act="lock">Lock the test and start calling</button></div></section>
  ${past.length ? `<section class="card"><h2>Earlier tests</h2><div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Status</th><th>Started</th><th></th></tr></thead><tbody>${past.map(t => `<tr><td>${esc(t.name)}</td><td>${esc(t.state)}</td><td>${esc(when(t.created))}</td><td><button class="link" data-act="open" data-id="${esc(t.id)}">open</button></td></tr>`).join("")}</tbody></table></div></section>` : ""}`;
}
function pairHtml() {
  const p = UI.pair;
  if (!p) return '<p class="muted">Loading the patch...</p>';
  const ch = p.changes.length ? p.changes.map(c => `<div class="change"><div class="old"><span class="tag">TODAY (A)</span>${segs(c.before)}</div><div class="new"><span class="tag">PATCHED (B)</span>${segs(c.after)}</div></div>`).join("") : '<p class="muted">No visible difference.</p>';
  return `<div class="grid2"><div><b>${esc(p.A.name)}</b><div class="mono muted">fingerprint ${esc(p.A.hash)}</div></div><div><b>${esc(p.B.name)}</b><div class="mono muted">fingerprint ${esc(p.B.hash)}</div></div></div>
    ${p.why ? `<p class="sub"><b>Why:</b> ${esc(p.why)}</p>` : ""}${p.risk ? `<p class="sub"><b>Risk:</b> ${esc(p.risk)}</p>` : ""}
    <div style="display:grid;gap:8px"><b>What the patch changes</b>${ch}</div>
    <div class="row"><a class="btn sm" href="/api/live/prompt/A?candidate=${encodeURIComponent(UI.sel.candidate)}">Download prompt A</a><a class="btn sm" href="/api/live/prompt/B?candidate=${encodeURIComponent(UI.sel.candidate)}">Download prompt B</a>
    <span class="sub">Ready to paste into Sarvam (the real inbound prompt, filled in for a demo call about stainless steel pipes).</span></div>`;
}
const segs = a => a.map(([t, m]) => m ? `<mark>${esc(t)}</mark>` : esc(t)).join("");
function checkHtml() {
  if (!UI.check) return "";
  return Object.entries(UI.check.checks).map(([k, r]) => `<div class="note ${r.ok ? "pos" : "warn"}"><b>Prompt ${k}:</b> ${esc(r.detail)}</div>`).join("");
}
function planHtml() {
  const p = UI.plan;
  if (!p) return "Working out what this threshold can show...";
  const g = p.detectable_gap;
  const lo = g != null ? Math.round((0.5 - g / 2) * 100) : null, hi = g != null ? Math.round((0.5 + g / 2) * 100) : null;
  return `<b>${p.calls_per_arm} finished calls per prompt (${p.total} in total).</b><br>
    ${g == null ? "Even a 90-point gap would not be caught reliably: use more calls." : `If B is truly better, a real gap of about <b>${Math.round(g * 100)} points</b> or more (for example ${lo}% vs ${hi}% good calls) is caught 8 times in 10. A smaller gap will usually end as "no clear winner".`}<br>
    If the two prompts are really identical, a false winner appears in about <b>${(p.false_win * 100).toFixed(1)}%</b> of tests (computed exactly, worst case over common rates).<br>
    The result stays locked until all ${p.total} calls are done and signalled.`;
}
let planTimer = null;
function afterSetup() {
  if (!UI.pair) loadPair();
  if (!UI.plan) loadPlan();
}
async function loadPair() {
  try { UI.pair = await api("/api/live/pair?candidate=" + encodeURIComponent(UI.sel.candidate)); } catch (e) { UI.pair = { A: { name: "-", hash: "" }, B: { name: "-", hash: "" }, changes: [], why: null, risk: null }; toast(e.message, true); }
  const el = $("#pair"); if (el) el.innerHTML = pairHtml();
}
function loadPlan() {
  clearTimeout(planTimer);
  planTimer = setTimeout(async () => {
    try { UI.plan = await api(`/api/live/plan?n=${UI.sel.n}&conf=${UI.sel.conf}`); } catch (e) { UI.plan = null; const el = $("#plan"); if (el) el.textContent = e.message; return; }
    const el = $("#plan"); if (el) el.innerHTML = planHtml();
  }, 250);
}
function readSetup() {
  const v = id => ($("#" + id) || {}).value;
  UI.sel.n = parseInt(v("n"), 10) || UI.sel.n; UI.sel.conf = v("conf") || UI.sel.conf; UI.sel.goal = (v("goal") || "").trim() || "Good call";
  UI.sel.name = (v("tname") || "").trim() || "Live call test"; UI.sel.blind = !!($("#blind") || {}).checked;
}
function readConn() {
  const v = id => ($("#" + id).value || "").trim();
  return { org_id: v("org"), workspace_id: v("ws"), arms: { A: { app_id: v("appA"), version: v("verA") }, B: { app_id: v("appB"), version: v("verB") } } };
}

// ---------------------------------------------------------------------------------------------- RUN
function progHtml() {
  const lbl = T.progress;
  return `<div class="grid3">${lbl.map(p => `<div class="card prog"><span class="muted">${esc(p.label)}</span><b>${p.done} of ${p.of} calls</b><div class="bar" aria-hidden="true"><i style="width:${Math.min(100, p.done / p.of * 100)}%"></i></div></div>`).join("")}
    <div class="card locked"><svg class="lockico" viewBox="0 0 24 24" fill="none" stroke="#667085" stroke-width="2"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
      <b>Result locked</b><span class="muted">Opens after ${T.total_planned} finished calls (${T.total_done} done)</span></div></div>`;
}
function runHtml() {
  const c = T.config;
  return `
  <section class="hero"><h1>${esc(T.name)}</h1>
    <p>${esc(c.prompt_names.A)} versus ${esc(c.prompt_names.B)}. ${c.blind ? "Blind: the two lines are not labelled A or B." : ""} Locked ${esc(when(T.created))}; confidence ${Math.round(c.confidence * 100)}%; ${c.calls_per_arm} finished calls per prompt; log fingerprint <span class="mono">${esc(T.ledger.head.slice(0, 12))}</span>.</p></section>
  ${progHtml()}
  <section class="card callcard" id="callcard">${callCardHtml()}</section>
  ${callsTableHtml()}
  <div class="row"><button class="link" data-act="abandon">Abandon this test (no result is shown; the reason is kept in the log)</button></div>`;
}
function nextRole() {
  const slot = T.calls.length, roles = S.roles;
  return roles[Math.floor(slot / 2) % roles.length];
}
function cueHtml(role) {
  return `<div class="cue"><b>${esc(role.title)}.</b> You play the buyer, same story for both prompts of this pair:<br>${esc(role.say)}</div>`;
}
function callCardHtml() {
  const oc = T.open_call, rt = UI.rt;
  const done = T.total_done, total = T.total_planned;
  if (!oc) {
    const role = nextRole(), c = S.connection;
    return `<div class="muted">Call ${T.calls.length + 1} of ${total}</div>
      ${cueHtml(role)}
      <div class="row" role="group" aria-label="How to call">
        <label class="check"><input type="radio" name="mode" value="sdk" ${UI.mode === "sdk" ? "checked" : ""} ${c.ready ? "" : "disabled"}><span>Talk here, in this page (Sarvam voice)</span></label>
        <label class="check"><input type="radio" name="mode" value="manual" ${UI.mode === "manual" ? "checked" : ""}><span>Talk somewhere else, log it here</span></label></div>
      <button class="btn primary big" data-act="next-call">${UI.mode === "sdk" ? "Start next call" : "Get the next call"}</button>
      ${c.ready ? "" : '<p class="sub">Sarvam is not fully connected, so calls are logged by hand. Fill in step 2 on the setup page of a new test to talk here.</p>'}`;
  }
  const head = `<div class="muted">Call ${oc.n} of ${total}</div><div class="line">${esc(oc.label)}</div>`;
  const voidBtn = `<button class="link" data-act="void">This call did not work (void it)</button>`;
  if (oc.status === "assigned") {
    return head + cueHtml(oc.role) + (oc.source === "manual"
      ? `<p>Open <b>${esc(oc.label)}</b> in Sarvam (the agent you set up for it), then press start and talk.</p><button class="btn primary big" data-act="manual-start">I am starting the call now</button>`
      : `<button class="btn primary big" data-act="sdk-start">Start the call</button><p class="sub">Your browser will ask for the microphone. Speak in Hindi or Hinglish.</p>`) + voidBtn;
  }
  if (oc.status === "in_call") {
    if (oc.source === "manual") {
      return head + `<div class="timer" id="timer">0:00</div>${cueHtml(oc.role)}<p>Talk to <b>${esc(oc.label)}</b>. When you hang up:</p>
        <div class="row"><label class="f" style="min-width:200px">Call length in seconds <small>filled in from the timer</small><input type="number" id="secs" min="0" max="3600"></label></div>
        <button class="btn primary big" data-act="manual-end">The call is finished</button>` + voidBtn;
    }
    if (!rt) return head + `<div class="note warn">This call was cut off (the page was reloaded while it was running). It cannot be resumed.</div>` + voidBtn;
    const tr = rt.transcript.map(m => `<div class="bub ${m.role}"><small>${m.role === "bot" ? "Agent" : "You"}</small>${esc(m.content)}</div>`).join("");
    return head + `<div class="row"><span class="pill blue" id="state">${esc(rt.state)}</span></div><div class="timer" id="timer">0:00</div>
      <div class="level" aria-hidden="true"><i id="level"></i></div>
      <div class="row"><button class="btn" data-act="mute">${rt.muted ? "Unmute" : "Mute"}</button><button class="btn danger big" data-act="sdk-end">End call</button></div>
      <div class="transcript" id="transcript" aria-live="polite">${tr || '<span class="muted">The conversation appears here as you talk.</span>'}</div>${cueHtml(oc.role)}`;
  }
  // awaiting signal
  const g = T.config.goal_name, s = UI.sig;
  const tr = (UI.lastTranscript || []).map(m => `<div class="bub ${m.role}"><small>${m.role === "bot" ? "Agent" : "You"}</small>${esc(m.content)}</div>`).join("");
  return head + `<p>The call lasted <b>${mmss(oc.duration_s)}</b>. Your signal:</p>
    <div class="sig" role="group" aria-label="Signal"><button class="btn yes ${s.good === true ? "on" : ""}" data-act="sig" data-v="1">Yes: ${esc(g)}</button><button class="btn no ${s.good === false ? "on" : ""}" data-act="sig" data-v="0">No: not a ${esc(g.toLowerCase())}</button></div>
    <label class="check"><input type="checkbox" id="fatal" ${s.fatal ? "checked" : ""}><span>There was a <b>fatal problem</b> (wrong behaviour, looped, rude, hung up, ignored the buyer)</span></label>
    <label class="f" style="width:100%;max-width:640px">Note (optional)<textarea id="note" maxlength="300">${esc(s.note)}</textarea></label>
    <button class="btn primary big" data-act="save-sig" ${s.good === null ? "disabled" : ""}>Save signal</button>
    ${tr ? `<details style="width:100%;max-width:640px;text-align:left"><summary>What was said</summary><div class="transcript">${tr}</div></details>` : ""}` + voidBtn;
}
function callsTableHtml() {
  if (!T.calls.length) return "";
  return `<section class="card"><h2>Calls so far</h2><p class="sub">Signals and totals are hidden until the result is released.</p><div class="tbl-wrap"><table><thead><tr><th>#</th><th>Line</th><th>Buyer</th><th class="n">Length</th><th>Signal</th></tr></thead><tbody>
    ${T.calls.map(c => `<tr><td>${c.n}</td><td>${esc(c.label)}</td><td>${esc(c.role.title)}</td><td class="n">${c.duration_s != null ? mmss(c.duration_s) : "-"}</td><td>${c.status === "done" ? "saved" : c.status === "awaiting_signal" ? "waiting for your signal" : c.status === "in_call" ? "in the call" : "not started"}</td></tr>`).join("")}</tbody></table></div></section>`;
}
function afterRun() { tick(); }
let tickId = null;
function tick() {
  clearInterval(tickId);
  const oc = T && T.open_call;
  if (!oc || oc.status !== "in_call") return;
  const t0 = UI.t0 || Date.now(); UI.t0 = t0;
  const upd = () => { const el = $("#timer"); if (el) { const s = (Date.now() - t0) / 1000; el.textContent = mmss(s); const f = $("#secs"); if (f && !f.dataset.touched) f.value = Math.round(s); } };
  upd(); tickId = setInterval(upd, 500);
}

// ---------------------------------------------------------------------------------------------- RESULT
const VERDICT = {
  PROMOTE: ["pos", "Prompt B wins", "B is the better prompt on these calls, by more than luck explains, and no guardrail was breached."],
  HOLD_FOR_APPROVAL: ["warn", "B wins, but check before rolling out", "B had clearly more good calls, but a guardrail was breached. A person should approve it."],
  STOP_HARM: ["neg", "Prompt A is better: keep today's prompt", "The patched prompt did clearly worse. Do not roll it out."],
  INCONCLUSIVE: ["", "No clear winner", "The calls do not show a gap bigger than luck could produce."]
};
function resultHtml() {
  const r = T.result, c = T.config, lab = T.reveal.labels;
  const [cls, head] = VERDICT[r.verdict] || ["", r.verdict];
  const nm = k => c.prompt_names[k];
  const a = r.a, b = r.b;
  let why = VERDICT[r.verdict] ? VERDICT[r.verdict][2] : "";
  if (r.verdict === "INCONCLUSIVE") {
    const lean = Math.abs(r.diff) >= 0.2 ? `On these calls Prompt ${r.diff > 0 ? "B" : "A"} looked better (A ${pct(r.rate_a)}, B ${pct(r.rate_b)}), but ` : "";
    why = lean ? lean + `${c.calls_per_arm} calls per prompt is too few to be sure it is not luck.` : why;
    why += r.call === "borderline" ? " The two tests we require did not agree, so it is called borderline, not a win." : "";
    why += " This is not proof the prompts are the same: " + c.calls_per_arm + " calls per prompt can only catch big gaps.";
    why += r.more_calls_per_prompt == null ? " The gap seen is under 5 points, too small to matter."
      : r.more_calls_per_prompt > 150 ? " The gap seen is small: confirming it would take well over 100 calls per prompt, probably not worth chasing."
      : ` If the gap you saw is real, about ${r.more_calls_per_prompt} calls per prompt in a NEW test would confirm it (do not add calls to this one: that would break the fairness).`;
  }
  const guard = r.guards.map(g => `<tr><td>${esc(g.name)}</td><td>${esc(g.limit)}</td><td>${esc(g.value)}</td><td>${g.breach ? '<span class="pill neg">breached</span>' : '<span class="pill pos">ok</span>'}</td></tr>`).join("");
  const row = (k, s) => `<tr><td><b>${esc(nm(k))}</b><div class="muted">${esc(lab[k])}</div></td><td class="n">${s.n}</td><td class="n">${s.good} of ${s.n} (${pct(s.n ? s.good / s.n : null)})</td><td class="n">${s.fatal}</td><td class="n">${s.median_s != null ? mmss(s.median_s) : "-"}</td></tr>`;
  const calls = T.calls.filter(x => x.status === "done");
  return `
  <section class="card verdict ${cls}"><div class="row"><span class="pill ${cls || "blue"}">${esc(r.verdict.replace(/_/g, " "))}</span><span class="muted">Released ${esc(when(r.released_at))} after ${c.calls_per_arm} finished calls per prompt</span></div>
    <h2>${esc(head)}</h2><p>${esc(why)}</p>
    ${c.blind ? `<div class="note"><b>Reveal:</b> ${esc(lab.A)} was ${esc(nm("A"))}; ${esc(lab.B)} was ${esc(nm("B"))}.</div>` : ""}</section>

  <section class="card"><h2>Your signals, "${esc(r.goal_name)}"</h2><div class="tbl-wrap"><table><thead><tr><th>Prompt</th><th class="n">Calls</th><th class="n">${esc(r.goal_name)}</th><th class="n">Fatal problems</th><th class="n">Typical length</th></tr></thead><tbody>${row("A", a)}${row("B", b)}</tbody></table></div>
    <div class="grid3"><div><div class="big-num">${pts(r.diff)}</div><div class="muted">B minus A (${pct(r.rate_b)} vs ${pct(r.rate_a)})</div></div>
      <div><div class="big-num">${pts(r.lo)} to ${pts(r.hi)}</div><div class="muted">plausible range at ${Math.round(c.confidence * 100)}% confidence (approximate for small samples)</div></div>
      <div><div class="big-num">${(r.p_value * 100).toFixed(1)}%</div><div class="muted">chance of a gap this big by luck alone if the prompts were really equal (exact test; a win needs this under ${Math.round(r.alpha * 100)}%)</div></div></div></section>

  <section class="card"><h2>Guardrails</h2><div class="tbl-wrap"><table><thead><tr><th>Check</th><th>Rule fixed before the test</th><th>Result</th><th></th></tr></thead><tbody>${guard}</tbody></table></div>
    <p class="sub">These are plain comparisons of what happened in this small test. They can send a win to a person for approval; they never create a win.</p></section>

  <section class="card"><h2>Hear them again</h2><div class="tbl-wrap"><table><thead><tr><th>#</th><th>Prompt</th><th class="n">Length</th><th>Signal</th><th>Fatal</th><th></th></tr></thead><tbody>
    ${calls.map(x => `<tr><td>${x.n}</td><td>${esc(c.prompt_names[x.arm])} <span class="muted">(${esc(x.label)})</span></td><td class="n">${mmss(x.duration_s)}</td><td>${x.good ? '<span class="pill pos">yes</span>' : '<span class="pill neg">no</span>'}</td><td>${x.fatal ? '<span class="pill neg">fatal</span>' : ""}</td>
      <td><button class="link" data-act="tr" data-id="${esc(x.id)}">transcript</button>${x.interaction_id ? ` &middot; <button class="link" data-act="rec" data-id="${esc(x.id)}">listen</button>` : ""}</td></tr>
      <tr hidden id="tr-${esc(x.id)}"><td colspan="6">${x.note ? `<p><b>Note:</b> ${esc(x.note)}</p>` : ""}${x.interaction_id ? `<p class="mono muted">Sarvam interaction ${esc(x.interaction_id)}</p>` : ""}<div class="transcript" style="max-width:none">${(x.transcript || []).map(m => `<div class="bub ${m.role}"><small>${m.role === "bot" ? "Agent" : "Buyer"}</small>${esc(m.content)}</div>`).join("") || '<span class="muted">No transcript was captured (logged by hand).</span>'}</div><div id="rec-${esc(x.id)}"></div></td></tr>`).join("")}</tbody></table></div></section>

  <section class="card"><h2>Proof this was fair</h2>
    <p class="sub">Before call 1 the log recorded the threshold, the confidence, the guardrails and a fingerprint of the secret call order. The order is revealed now: anyone can re-hash it.</p>
    <div class="grid2"><div><div class="muted">Call order (A = today, B = patched)</div><div class="mono">${esc(T.reveal.sequence.join(" "))}</div></div><div><div class="muted">Log fingerprint (${T.ledger.entries} entries, ${T.ledger.ok ? "chain verified" : "CHAIN BROKEN"})</div><div class="mono">${esc(T.ledger.head)}</div></div></div>
    <div class="row"><a class="btn" href="/api/live/test/${esc(T.id)}/csv">Download the results as CSV</a><button class="btn primary" data-act="new">Start a new test</button></div>
    <p class="sub">This is a listening test: it tells you which prompt your team judged better on ${T.total_planned} calls. Production traffic is judged by the main Canary console.</p></section>`;
}

// ---------------------------------------------------------------------------------------------- SDK call
function setLevel(l) { const el = $("#level"); if (el && l) el.style.width = Math.min(100, Math.max(0, (l.rms || 0) * 400)) + "%"; }
function friendly(e) {
  const m = (e && (e.message || e.name)) || String(e);
  if (e && e.name === "NotAllowedError") return "The browser blocked the microphone. Allow it in the address bar and try again.";
  if (e && e.name === "NotFoundError") return "No microphone was found.";
  if (e && e.name === "NotReadableError") return "The microphone is in use by another program.";
  if (/Authentication|401/.test(m)) return "Sarvam rejected the API key. Check SARVAM_VOICE_API_KEY (Settings > API Key in indus.sarvam.ai).";
  if (/not found|404/i.test(m)) return "Sarvam did not find that agent or committed version. Check the ids and that the version is committed.";
  return m;
}
async function sdkStart() {
  const oc = T.open_call, con = S.connection;
  UI.sig = { good: null, fatal: false, note: "" }; UI.lastTranscript = null;
  const rt = UI.rt = { transcript: [], state: "CONNECTING", muted: false, ended: false, callId: oc.id };
  const audio = new SarvamConv.BrowserAudioInterface(16000, { outputLevelCallback: setLevel });
  const cfg = { org_id: con.org_id, workspace_id: con.workspace_id, app_id: oc.app_id, user_identifier: `canary-${T.id}-${oc.id}`, user_identifier_type: "custom",
                interaction_type: SarvamConv.InteractionType.CALL, input_sample_rate: 16000, output_sample_rate: 16000 };
  if (oc.version) cfg.version = /^\d+$/.test(oc.version) ? Number(oc.version) : oc.version;
  const agent = rt.agent = new SarvamConv.ConversationAgent({
    apiKey: "", baseUrl: location.origin + "/sarvam/", config: cfg, audioInterface: audio,
    stateCallback: s => { rt.state = s; const el = $("#state"); if (el) el.textContent = s; },
    transcriptCallback: async m => { rt.transcript.push({ role: m.role === "user" ? "user" : "bot", content: m.content }); paintTranscript(); },
    endCallback: async () => { if (!rt.ended) sdkFinish(); }
  });
  T.open_call.status = "in_call"; UI.t0 = null; $("#callcard").innerHTML = callCardHtml();
  try {
    await agent.start();
    if (!(await agent.waitForConnect(15))) throw new Error("The call did not connect within 15 seconds.");
    await api(`/api/live/test/${T.id}/call/${oc.id}/start`, {});
  } catch (e) {
    rt.ended = true; UI.rt = null; try { await agent.stop(); } catch (x) { /* already closed */ }
    T.open_call.status = "assigned"; $("#callcard").innerHTML = callCardHtml();
    throw new Error(friendly(e));
  }
  UI.t0 = Date.now(); $("#callcard").innerHTML = callCardHtml(); tick();
}
function paintTranscript() {
  const el = $("#transcript"), rt = UI.rt; if (!el || !rt) return;
  el.innerHTML = rt.transcript.map(m => `<div class="bub ${m.role}"><small>${m.role === "bot" ? "Agent" : "You"}</small>${esc(m.content)}</div>`).join("");
  el.scrollTop = el.scrollHeight;
}
async function sdkFinish() {
  const rt = UI.rt; if (!rt || rt.ended && rt.finishing) return;
  rt.ended = true; rt.finishing = true; clearInterval(tickId);
  let iid = ""; try { iid = rt.agent.getInteractionId() || ""; } catch (e) { /* not connected */ }
  try { await rt.agent.stop(); } catch (e) { /* already closed */ }
  UI.lastTranscript = rt.transcript;
  try { await api(`/api/live/test/${T.id}/call/${rt.callId}/end`, { interaction_id: iid, transcript: rt.transcript }); }
  catch (e) { toast(e.message, true); }
  UI.rt = null; UI.t0 = null;
  T = await api("/api/live/test/" + T.id); render();
}

// ---------------------------------------------------------------------------------------------- actions
document.addEventListener("click", ev => {
  const b = ev.target.closest("[data-act]"); if (!b) return;
  const act = b.dataset.act;
  const H = {
    "preset": () => { UI.sel.n = +b.dataset.n; $("#n").value = UI.sel.n; loadPlan(); },
    "save-conn": guard(async () => { await api("/api/live/connection", readConn()); await load(); toast("Saved"); }),
    "check-conn": guard(async () => { await api("/api/live/connection", readConn()); UI.check = await api("/api/live/check", {}); await load(); }),
    "lock": guard(async () => {
      readSetup(); await api("/api/live/connection", readConn()).catch(() => 0);
      T = await api("/api/live/test", { name: UI.sel.name, candidate: UI.sel.candidate, calls_per_arm: UI.sel.n, confidence: UI.sel.conf, blind: UI.sel.blind, goal_name: UI.sel.goal });
      await load(); }),
    "open": guard(async () => { T = await api("/api/live/test/" + b.dataset.id); render(); }),
    "new": () => { T = null; UI.pair = null; UI.plan = null; load(); },
    "next-call": guard(async () => {
      const r = await api(`/api/live/test/${T.id}/call`, { source: UI.mode }); T = r.test; render();
      if (UI.mode === "sdk") await sdkStart(); }),
    "sdk-start": guard(async () => { await sdkStart(); }),
    "sdk-end": guard(async () => { await sdkFinish(); }),
    "mute": () => { const rt = UI.rt; if (!rt) return; rt.muted ? rt.agent.unmute() : rt.agent.mute(); rt.muted = !rt.muted; b.textContent = rt.muted ? "Unmute" : "Mute"; },
    "manual-start": guard(async () => { await api(`/api/live/test/${T.id}/call/${T.open_call.id}/start`, {}); UI.t0 = Date.now(); T = await api("/api/live/test/" + T.id); render(); }),
    "manual-end": guard(async () => { const secs = $("#secs").value; await api(`/api/live/test/${T.id}/call/${T.open_call.id}/end`, { duration_s: secs === "" ? null : Number(secs) }); UI.t0 = null; UI.lastTranscript = null; T = await api("/api/live/test/" + T.id); render(); }),
    "sig": () => { UI.sig.good = b.dataset.v === "1"; UI.sig.fatal = !!($("#fatal") || {}).checked; UI.sig.note = ($("#note") || {}).value || ""; $("#callcard").innerHTML = callCardHtml(); },
    "save-sig": guard(async () => {
      const r = await api(`/api/live/test/${T.id}/call/${T.open_call.id}/signal`, { good: UI.sig.good, fatal: !!$("#fatal").checked, note: $("#note").value });
      UI.sig = { good: null, fatal: false, note: "" }; UI.lastTranscript = null; T = r.test; await load(r.released ? T.id : undefined);
      toast(r.released ? "Threshold reached: the result is released" : "Signal saved"); }),
    "void": guard(async () => {
      const reason = prompt("Why did this call not work? (kept in the log)", "no sound / dropped / wrong agent"); if (!reason) return;
      if (UI.rt) { UI.rt.ended = true; try { await UI.rt.agent.stop(); } catch (e) { /* closed */ } UI.rt = null; }
      const r = await api(`/api/live/test/${T.id}/call/${T.open_call.id}/void`, { reason }); T = r.test; UI.t0 = null; render(); toast("Voided: the same prompt will be called again"); }),
    "abandon": guard(async () => {
      const reason = prompt("Why are you abandoning this test? No result will be shown.", ""); if (!reason) return;
      await api(`/api/live/test/${T.id}/abandon`, { reason }); T = null; await load(); }),
    "tr": () => { const el = document.getElementById("tr-" + b.dataset.id); if (el) el.hidden = !el.hidden; },
    "rec": () => {
      const box = document.getElementById("rec-" + b.dataset.id), tr = document.getElementById("tr-" + b.dataset.id); if (tr) tr.hidden = false;
      box.innerHTML = `<audio controls autoplay src="/api/live/recording/${T.id}/${b.dataset.id}" style="width:100%"></audio>`;
      box.firstChild.addEventListener("error", () => { box.innerHTML = '<div class="note warn">Sarvam did not return a playable recording here. Open this call in Sarvam &rarr; Monitor &rarr; Call Logs with the interaction id shown above.</div>'; });
    }
  };
  if (H[act]) H[act]();
});
document.addEventListener("input", ev => {
  const t = ev.target;
  if (t.id === "n" || t.id === "conf") { readSetup(); loadPlan(); }
  if (t.id === "fatal") UI.sig.fatal = t.checked;
  if (t.id === "note") UI.sig.note = t.value;
  if (t.id === "secs") t.dataset.touched = "1";
});
document.addEventListener("change", ev => {
  const t = ev.target;
  if (t.id === "cand") { UI.sel.candidate = t.value; UI.pair = null; $("#pair").innerHTML = pairHtml(); loadPair(); }
  if (t.name === "mode") { UI.mode = t.value; UI.modeChosen = true; const c = $("#callcard"); if (c && T && !T.open_call) c.innerHTML = callCardHtml(); }
});
window.addEventListener("beforeunload", e => { if (UI.rt && !UI.rt.ended) { e.preventDefault(); e.returnValue = ""; } });
load().catch(e => { $("#app").innerHTML = `<div class="note neg">Could not load the live call test: ${esc(e.message)}</div>`; });
