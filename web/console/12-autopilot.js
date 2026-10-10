/* The autopilot and the demo clock, plus two small UI helpers every screen uses (a collapsed section, an info tooltip).
   The autopilot only takes actions the engine pre-chained in the record (tails.auto_reject, tails.auto_rollback), so its actions verify in the
   decision record exactly like a person's click. In real use the days pass on their own; in the demo one "Next day" moves every test together. */

/** A section that stays folded until clicked: details that matter, but not at first glance. */
const fold = (title, body, hint = "", open = false, id = "") => `<details class="fold" ${id ? `id="${id}"` : ""} ${open ? "open" : ""}><summary><span>${title}</span>${hint ? `<span class="note">${hint}</span>` : ""}</summary><div class="fold-body">${body}</div></details>`;
/** An ⓘ that explains a term on hover instead of a paragraph on the page. */
const info = text => `<span class="info" tabindex="0" title="${esc(text)}" aria-label="${esc(text)}">i</span>`;

const AUTOPILOT_BY = "Picky autopilot";                                         // the engine's AUTOPILOT: the "by" of its ledger entries
const heldDays = () => (C.autopilot || {}).held_timeout_days || 2;
const AP = () => ({ rollback: true, held: true, ...((DYN.settings || {}).autopilot || {}) });
/** May the autopilot act on this test? Only when its switch is on and the engine pre-chained the entry (a test saved before this has none). */
const canAutoKeepA = e => AP().held && !!((e.record.tails || {}).auto_reject);
const canAutoRollback = e => AP().rollback && !!((e.record.tails || {}).auto_rollback);

/** One day of a promoted test's holdback week. On an alert the autopilot rolls B back when its policy allows and the record carries the chained entry;
    otherwise the alert asks a person. Returns {played, msg}. */
function holdStep(e) {
  const v = view(e), d = dyn(e); if (!v.holdback || v.holdback.done) return { played: false, msg: "" };
  const H = v.holdback.all; d.hold = (d.hold || 0) + 1; const r = H.rows[d.hold - 1], name = e.record.config.name;
  const auto = r.alert && d.hold === H.alert_day && canAutoRollback(e);
  logAction(e, r.alert ? "Harm alert" : "Holdback", r.alert ? `Holdback day ${d.hold}: B is clearly below the held-back A (z=${r.z.toFixed(2)}, alert line −${r.bar.toFixed(2)}). ${auto ? "The autopilot rolls B back." : "Consider a rollback."}`
    : `Holdback day ${d.hold} of ${H.days}: B ${pct(r.rateB, 1)} against A ${pct(r.rateA, 1)} (${pts(r.diff, 1)}); no sign of loss.`);
  if (auto) { d.rolledBack = true; d.autoRoll = true; return { played: true, msg: `${name}: B slipped after rollout, so the autopilot rolled it back` }; }
  if (d.hold >= H.days) logAction(e, "Holdback", H.alert_day ? `Holdback finished with an alert on day ${H.alert_day}.` : `Holdback finished: no sign of loss. The slice is small: it would have caught a drop of about ${H.detectable_drop_pp} points or more (80% chance), it does not re-prove the gain.`);
  return { played: true, msg: r.alert ? `${name}: holdback alert, a person should roll back` : "" };
}
/** One demo day for every test: running tests play their next day, a promoted test's holdback week moves on, and a held win's answer window
    shrinks (when it closes with no answer, the autopilot keeps A). Returns plain lines of what changed. */
function nextDay() {
  const out = [];
  EXPS().filter(e => !isPast(e)).forEach(e => {
    const v = view(e), d = dyn(e), name = e.record.config.name;
    if (v.scheduled || d.paused || d.manualStop) return;
    if (v.running) { d.day = Math.min(v.ld, d.day + 1); const a = view(e); if (a.decided) out.push(`${name}: ${KIND_LABEL[a.kind] || a.kind}`); return; }
    if (v.kind === "HOLD_FOR_APPROVAL" && !d.approval) {
      if (!canAutoKeepA(e)) return;                                            // the answer window runs only while the autopilot may close it
      d.waited = (d.waited || 0) + 1;
      if (d.waited >= heldDays()) { d.approval = "rejected"; d.auto = true; out.push(`${name}: nobody answered in ${heldDays()} days, so the autopilot kept A`); }
      return;
    }
    if (v.holdback && !v.holdback.done) { const r = holdStep(e); if (r.msg) out.push(r.msg); }
  });
  saveDyn(); return out;
}
/** Is there anything left for the clock to move? */
const pending = () => EXPS().filter(e => !isPast(e)).some(e => { const v = view(e), d = v.d; return (v.running && !d.paused) || (v.kind === "HOLD_FOR_APPROVAL" && !d.approval && canAutoKeepA(e)) || (v.holdback && !v.holdback.done); });
let PLAYER = null;
/** Redraw the current screen without jumping to the top. */
function refresh() { const y = scrollY; render(); scrollTo(0, y); }
function tick() {
  const notes = nextDay();
  if (notes.length) toast(notes.join(" · "), 4500);
  if (!pending()) { clearInterval(PLAYER); PLAYER = null; toast("Every test has settled.", 3500); }
  refresh();
}
function togglePlay() { if (PLAYER) { clearInterval(PLAYER); PLAYER = null; refresh(); return; } if (!pending()) { toast("Nothing left to play: every test has settled."); return; } PLAYER = setInterval(tick, 1200); tick(); }
/** The demo clock's two buttons (they appear in the page header of Overview and Live Experiments). */
const clockButtons = () => `<button class="btn" id="clk-next" ${pending() ? "" : "disabled"} title="Every running test plays its next day; held wins and holdback weeks move on too (demo)">Next day</button><button class="btn" id="clk-play" ${pending() || PLAYER ? "" : "disabled"} title="Play day after day until every test has settled (demo)">${PLAYER ? "❚❚ Pause" : "▶ Play"}</button>`;
function bindClock(el) {
  const n = $("#clk-next", el); if (n) n.onclick = () => { if (PLAYER) { clearInterval(PLAYER); PLAYER = null; } tick(); };
  const p = $("#clk-play", el); if (p) p.onclick = togglePlay;
}
/** One line that says what the autopilot does, with its two switches one click away (Settings). */
const autopilotStrip = () => { const ap = AP(); return `<div class="ap-strip"><span class="pill pos">Autopilot on</span><span>Stops a worse B the same day</span><span>Ships a winner, keeps ${pct(SET().holdback || 0.05, 0)} on A for a week</span><span>${ap.rollback ? "Rolls back if B slips" : "Asks you if B slips"}</span><span>${ap.held ? `Keeps A if a held win gets no answer in ${heldDays()} days` : "Waits for you on a held win"}</span><a href="#/settings" class="note">Change</a></div>`; };
