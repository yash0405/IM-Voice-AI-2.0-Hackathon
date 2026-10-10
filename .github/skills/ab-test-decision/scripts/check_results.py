#!/usr/bin/env python3
"""Look at a results file before trusting it, and give a single-look comparison of A and B.

Standard library only. Reads CSV / TSV / JSON lines / JSON. One row per call; each lead is counted ONCE, in the prompt that served its
first call, so a caller who phoned three times does not make the result look three times surer.

What it reports
  * the columns it found and how many leads, calls and repeat calls there are
  * split check: did the arms get the share of leads that was configured? (a mismatch means the test itself is broken)
  * leads served BOTH prompts, repeated call ids, rows it could not use
  * goal rate per arm with a 95% interval, the lift with an interval, and (if there is a duration column) the handling-time change
  * (if timestamps are readable) whether the lift holds up: first half of the period against the second half. A lift that shrinks a lot is a
    warning of a novelty effect; it is exploratory, not a test

IMPORTANT: the comparison is a SINGLE LOOK. It is valid only when the test is over and the sample size was fixed in advance. Never use it
to decide while a test is still running; looking early and stopping on a good day gives false winners. For running tests, and for the
ship / stop / hold decision itself, use decide.py.

Examples
  python check_results.py results.csv --goal buylead_created --share-b 0.3
  python check_results.py a.csv b.csv --goal-column converted          # A's results then B's results
"""
import argparse
import csv
import io
import json
import math
import re
import sys
from collections import Counter
from datetime import datetime
from statistics import NormalDist

ND = NormalDist()
ALIASES = {
    "lead": ["lead_id", "lead", "glid", "buyer_id", "customer_id", "user_id", "phone", "mobile"],
    "call": ["call_id", "call", "recording_id", "session_id", "id"],
    "arm": ["variant", "arm", "group", "bucket", "prompt_version", "prompt", "experiment_variant"],
    "disp": ["disposition", "call_outcome", "buyer_disposition", "outcome", "result", "label", "status"],
    "goal": ["goal_hit", "converted", "goal", "success", "is_converted", "conversion"],
    "dur": ["duration_s", "duration_sec", "duration_seconds", "duration", "handling_time", "aht", "call_duration"],
    "time": ["timestamp", "call_time", "start_time", "started_at", "created_at", "called_at", "datetime", "time", "date"],
}
ARM_A = {"a", "control", "baseline", "base", "current", "production", "prod", "0", "v1"}
ARM_B = {"b", "test", "treatment", "variant", "candidate", "challenger", "1", "v2"}
PLACEHOLDER = {"", "null", "none", "nan", "n/a", "na", "-", "unknown"}


def norm(s):
    return re.sub(r"[^a-z0-9]+", "_", str(s).strip().lower()).strip("_")


def read_rows(text):
    t = text.lstrip("﻿").strip()
    if not t:
        sys.exit("the file is empty")
    if t[0] in "[{":
        try:
            obj = json.loads(t)
            rows = obj if isinstance(obj, list) else next((obj[k] for k in ("rows", "calls", "data") if isinstance(obj.get(k), list)), [])
        except json.JSONDecodeError:
            rows = [json.loads(l) for l in t.splitlines() if l.strip()]
    else:
        delim = max(",\t;|", key=t.splitlines()[0].count)
        rows = list(csv.DictReader(io.StringIO(t), delimiter=delim))
    return [{norm(k): v for k, v in r.items() if k is not None} for r in rows if isinstance(r, dict)]


def pick(cols, key, override=None):
    if override:
        return norm(override) if norm(override) in cols else None
    return next((a for a in ALIASES[key] if a in cols), None)


def wilson(x, n, z=1.96):
    if n == 0:
        return (0.0, 1.0)
    p = x / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def newcombe(xa, na, xb, nb):
    """95% interval for rate_B - rate_A from the two Wilson intervals (Newcombe method 10)."""
    pa, pb = xa / na, xb / nb
    la, ua = wilson(xa, na)
    lb, ub = wilson(xb, nb)
    d = pb - pa
    return (d - math.sqrt((pb - lb) ** 2 + (ua - pa) ** 2), d + math.sqrt((ub - pb) ** 2 + (pa - la) ** 2))


def p_two_prop(xa, na, xb, nb):
    p = (xa + xb) / (na + nb)
    se = math.sqrt(p * (1 - p) * (1 / na + 1 / nb))
    z = (xb / nb - xa / na) / se if se > 0 else 0.0
    return z, 2 * (1 - ND.cdf(abs(z)))


def when(v):
    try:
        return datetime.fromisoformat(str(v).strip().replace("Z", "+00:00").replace("T", " ")).replace(tzinfo=None)
    except ValueError:
        return None


def halves(units):
    """Lift in the first and second half of the period (leads split by the date of their first call). Exploratory."""
    timed = [u for u in units if u[3] is not None]
    if len(timed) < 0.9 * len(units) or len(timed) < 400:
        return None
    ts = sorted(u[3] for u in timed)
    cut = ts[len(ts) // 2]
    out = []
    for name, part in (("first half", [u for u in timed if u[3] < cut]), ("second half", [u for u in timed if u[3] >= cut])):
        a = [u for u in part if u[0] == "A"]; b = [u for u in part if u[0] == "B"]
        if len(a) < 100 or len(b) < 100:
            return None
        xa, xb = sum(u[1] for u in a), sum(u[1] for u in b)
        d = xb / len(b) - xa / len(a)
        lo, hi = newcombe(xa, len(a), xb, len(b))
        out.append({"period": name, "from": min(u[3] for u in part).date().isoformat(), "to": max(u[3] for u in part).date().isoformat(),
                    "leads_a": len(a), "leads_b": len(b), "lift_points": d * 100, "ci95_points": [lo * 100, hi * 100]})
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.replace("%", "%%"), formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+", help="one file with a variant column, or two files: A's results then B's results")
    ap.add_argument("--goal", help="disposition value(s) that count as success, comma separated (when there is no 0/1 goal column)")
    ap.add_argument("--goal-column", help="name of a 0/1 goal column")
    ap.add_argument("--share-b", type=float, help="configured share of leads for B; switches the split check on")
    ap.add_argument("--window-days", type=int, help="planned test length; reports calls that fall after it (the engine leaves them out)")
    ap.add_argument("--lead-col"); ap.add_argument("--variant-col"); ap.add_argument("--duration-col"); ap.add_argument("--disposition-col")
    ap.add_argument("--json", action="store_true", help="print JSON only")
    a = ap.parse_args()
    if len(a.files) > 2:
        sys.exit("give one file with a variant column, or two files (A then B)")

    calls, notes = [], []
    for fi, path in enumerate(a.files):
        rows = read_rows(open(path, encoding="utf-8-sig").read())
        if not rows:
            sys.exit(f"{path}: no rows")
        cols = list(rows[0].keys())
        lead_c, call_c = pick(cols, "lead", a.lead_col), pick(cols, "call")
        arm_c, dur_c = pick(cols, "arm", a.variant_col), pick(cols, "dur", a.duration_col)
        time_c = pick(cols, "time")
        disp_c = pick(cols, "disp", a.disposition_col)
        goal_c = pick(cols, "goal", a.goal_column)
        want = {norm(x) for x in (a.goal or "").split(",") if x.strip()}
        if len(a.files) == 1 and not arm_c:
            sys.exit(f"{path}: no column says which prompt served the call (looked for: {', '.join(ALIASES['arm'])}). Columns: {', '.join(cols)}")
        if not want and not goal_c:
            top = Counter(norm(r.get(disp_c, "")) for r in rows).most_common(10) if disp_c else []
            sys.exit(f"{path}: which outcome counts as success? Pass --goal <disposition> or --goal-column <0/1 column>. "
                     + (f"Dispositions seen: {', '.join(f'{k} ({v})' for k, v in top)}" if top else f"Columns: {', '.join(cols)}"))
        if want and not disp_c:
            sys.exit(f"{path}: --goal needs a disposition column; columns are: {', '.join(cols)}")
        if want:
            seen = {norm(r.get(disp_c, "")) for r in rows}
            if not (want & seen):
                sys.exit(f"{path}: none of {sorted(want)} appear in the disposition column. Seen: {sorted(seen)[:15]}")
        skipped = Counter()
        for r in rows:
            arm = ("A", "B")[fi] if len(a.files) == 2 else ("A" if norm(r.get(arm_c)) in ARM_A else "B" if norm(r.get(arm_c)) in ARM_B else None)
            if arm is None:
                skipped["unknown variant value"] += 1
                continue
            if want:
                raw = str(r.get(disp_c, "")).strip()
                hit = None if raw == "" else norm(raw) in want
            else:
                v = norm(r.get(goal_c))
                hit = True if v in {"1", "true", "yes", "y", "t"} else False if v in {"0", "false", "no", "n", "f"} else None
            if hit is None:
                skipped["no readable outcome"] += 1
                continue
            lead = str(r.get(lead_c, "")).strip() if lead_c else ""
            lead = None if lead.lower() in PLACEHOLDER else lead
            try:
                dur = float(r.get(dur_c)) if dur_c and str(r.get(dur_c)).strip() != "" else None
                dur = dur if dur is not None and 0 <= dur <= 86400 and math.isfinite(dur) else None
            except ValueError:
                dur = None
            calls.append({"lead": lead or f"#{len(calls)}", "arm": arm, "hit": hit, "dur": dur, "cid": (r.get(call_c) if call_c else None), "file": fi,
                          "t": when(r.get(time_c)) if time_c else None})
        for k, v in skipped.items():
            notes.append(f"{path}: {v} rows skipped ({k})")
        if not lead_c:
            notes.append(f"{path}: no lead id column, so every call counts as its own lead (repeat callers are over-counted)")

    seen_ids, dedup = set(), []
    for c in calls:
        if c["cid"] not in (None, ""):
            k = (c["file"], str(c["cid"]))
            if k in seen_ids:
                continue
            seen_ids.add(k)
        dedup.append(c)
    dups = len(calls) - len(dedup)
    if dups:
        notes.append(f"{dups} repeated call ids ignored")
    by = {}
    for c in dedup:
        by.setdefault(c["lead"], []).append(c)
    both = 0
    units = []
    for lead, cs in by.items():
        arm = cs[0]["arm"]
        own = [c for c in cs if c["arm"] == arm]
        both += len(own) != len(cs)
        durs = [c["dur"] for c in own if c["dur"] is not None]
        first = min((c["t"] for c in cs if c["t"] is not None), default=None)
        units.append((arm, any(c["hit"] for c in own), sum(durs) / len(durs) if durs and len(durs) == len(own) else None, first))
    if both:
        notes.append(f"{both} leads appear under BOTH prompts: sticky assignment broke, or rows were duplicated with the other prompt's label (look for call ids that repeat with a suffix); each lead counted once, in its first prompt")
    nA = sum(1 for u in units if u[0] == "A"); nB = len(units) - nA
    if nA == 0 or nB == 0:
        sys.exit(f"need both prompts: found {nA} leads in A and {nB} in B")
    xA = sum(1 for u in units if u[0] == "A" and u[1]); xB = sum(1 for u in units if u[0] == "B" and u[1])
    out = {"leads": len(units), "calls": len(dedup), "repeat_call_share": round(1 - len(units) / len(dedup), 3), "leads_in_both_arms": both,
           "A": {"leads": nA, "goal": xA, "rate": xA / nA, "ci95": wilson(xA, nA)}, "B": {"leads": nB, "goal": xB, "rate": xB / nB, "ci95": wilson(xB, nB)}}
    problems = []
    if a.share_b is not None:
        n = nA + nB
        chi = (nB - a.share_b * n) ** 2 / (a.share_b * n) + (nA - (1 - a.share_b) * n) ** 2 / ((1 - a.share_b) * n)
        p_srm = math.erfc(math.sqrt(chi / 2))
        out["split_check"] = {"configured_b": a.share_b, "observed_b": round(nB / n, 4), "p_value": p_srm}
        if p_srm < 0.001:
            problems.append(f"SPLIT MISMATCH: B got {nB / n:.1%} of leads, configured {a.share_b:.0%} (p={p_srm:.1e}). The test is broken; do not trust any comparison below")
    else:
        notes.append("no --share-b given, so the split check was not run")
    if both:
        problems.append(f"{both} leads saw both prompts")
    d, lo, hi = xB / nB - xA / nA, *newcombe(xA, nA, xB, nB)
    z, p = p_two_prop(xA, nA, xB, nB)
    out["lift"] = {"points": d * 100, "ci95_points": [lo * 100, hi * 100], "z": z, "p_two_sided": p, "note": "single look: valid only at the planned end of the test"}
    dA = [u[2] for u in units if u[0] == "A" and u[2] is not None]; dB = [u[2] for u in units if u[0] == "B" and u[2] is not None]
    if len(dA) == nA and len(dB) == nB and dA and dB and sum(dA) > 0:
        out["handling_time"] = {"mean_A_s": sum(dA) / nA, "mean_B_s": sum(dB) / nB, "relative_change": (sum(dB) / nB) / (sum(dA) / nA) - 1}
    elif dA or dB:
        notes.append("some leads have no usable duration, so no handling-time comparison was made")
    stamps = [c["t"] for c in dedup if c["t"] is not None]
    if stamps:
        d0, d1 = min(stamps).date(), max(stamps).date()
        out["dates"] = {"first": d0.isoformat(), "last": d1.isoformat(), "days": (d1 - d0).days + 1}
        if d1 > datetime.now().date():
            notes.append(f"dates run to {d1.isoformat()}, later than today's date on this machine: confirm the file is real data and not a test export")
        if a.window_days:
            late = sum(1 for c in dedup if c["t"] is not None and (c["t"].date() - d0).days + 1 > a.window_days)
            if late:
                notes.append(f"{late} calls fall after day {a.window_days} of the planned window; decide.py leaves them out")
    hv = halves(units)
    if hv:
        out["holds_up_over_time"] = hv
    out["problems"], out["notes"] = problems, notes
    if a.json:
        print(json.dumps(out, indent=1, default=lambda x: list(x) if isinstance(x, tuple) else str(x)))
        return
    print(f"{out['leads']:,} leads from {out['calls']:,} calls ({out['repeat_call_share']:.0%} are repeat calls, counted once)"
          + (f"; dates {out['dates']['first']} to {out['dates']['last']} ({out['dates']['days']} days)" if "dates" in out else ""))
    print(f"  A: {xA:,} of {nA:,} = {xA / nA:.1%}   95% interval {out['A']['ci95'][0]:.1%} to {out['A']['ci95'][1]:.1%}")
    print(f"  B: {xB:,} of {nB:,} = {xB / nB:.1%}   95% interval {out['B']['ci95'][0]:.1%} to {out['B']['ci95'][1]:.1%}")
    print(f"  B minus A = {d * 100:+.1f} points (95% interval {lo * 100:+.1f} to {hi * 100:+.1f}); single-look p = {p:.3f}")
    if "handling_time" in out:
        h = out["handling_time"]
        print(f"  handling time: A {h['mean_A_s']:.0f} s, B {h['mean_B_s']:.0f} s ({h['relative_change']:+.0%})")
    if hv:
        for h in hv:
            print(f"  {h['period']} ({h['from']} to {h['to']}): lift {h['lift_points']:+.1f} points (range {h['ci95_points'][0]:+.1f} to {h['ci95_points'][1]:+.1f})")
        if hv[0]["lift_points"] > 0 and hv[1]["lift_points"] < 0.5 * hv[0]["lift_points"]:
            print("  WARNING: the lift shrank by more than half between the two halves (possible novelty effect). Ship with monitoring and say so.")
    if "split_check" in out:
        s = out["split_check"]
        print(f"  split: B got {s['observed_b']:.1%} of leads (configured {s['configured_b']:.0%}, p = {s['p_value']:.2f})")
    for n in notes:
        print("  note:", n)
    print("PROBLEMS: " + "; ".join(problems) if problems else "No data-quality problems found.")
    print("This is a single-look comparison. For a ship / stop / hold decision use decide.py.")


if __name__ == "__main__":
    main()
