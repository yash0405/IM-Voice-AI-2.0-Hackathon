# Start here (5 minutes, no technical knowledge needed)

**What Canary does.** You changed something about a bot (a new prompt, a new flow) and ran it next to the old one. Canary reads the results and tells you in plain words whether to **ship it**, **stop it**, **let a person decide**, or **keep what you have**. It always says how sure it is, and says so when it cannot tell.

## Open it
- **Double-click `dist/canary_demo.html`** (works offline), or run **`./start.sh`** for the live version (it can also run new experiments and read your own files).
- You land on **Overview**. The left menu has the eight screens: Overview, New Experiment, Live Experiments, History, Suggest A/B Tests, Prompt Library, Decision Log, Settings.

## Watch the demo (2 minutes)
Five experiments are already running, each paused on day 2 (simulated, with a known answer):
1. On **Overview**, press **Advance all running tests 1 day (demo)** a few times. Or open **Live Experiments** and press **Advance 1 day (demo)**.
2. *Ask for any single detail at most twice* (B wins) is promoted on day 7. *Make the ask limits agree* (B worse) is **stopped early** by the daily harm check. *Warmer opening line* (flat) ends **inconclusive** and says how many more leads would settle it.
3. *Offer the seller details on WhatsApp earlier* wins but its calls run longer than the limit, so it is **held for approval**: press **Approve** or **Reject**. Both are saved in the **Decision Log**, and an approved win becomes a new version in the **Prompt Library**, where **Rollback** is one click.
4. *Proprietors: ask for any detail at most twice* tests only one group of leads: its **Split health** panel shows that A and B got the same mix, and after the win a 5% **holdback** stays on the old prompt for a week.
5. **History** keeps every finished test with its frozen report (press a row). **Suggest A/B Tests** has ideas for the next test, each with a one-click start.

## Use your own results
1. `./start.sh`, then **Import results files** (button on Overview).
2. Choose the file, tick which outcomes count as success, fill in the plan: expected success rate today, share of traffic sent to the new prompt, test length. **Write these down before the test starts**: they fix the decision lines, and numbers picked after seeing results would bend the answer.
3. Press **Decide**. You get a final report with the numbers, a range, the safety checks and a plain-words summary.

## Start a new test
**New Experiment** walks six steps (hypothesis, prompt B, audience, goals, duration, review). **Prompt B** is the full prompt, pre-filled with today's live prompt; a side-by-side diff and a template-variable check update as you type. **Audience** is a builder: pick a factor (HL Type, Legal Status, Vertical...) and its values; the rule is shown in plain words with the leads a day and today's rate. **Goals** has one primary goal, guardrails and secondary metrics, including custom ones built from the data's columns. **Duration** is recommended for you from the last 30 days; **At a glance** on the right shows the same numbers. **Save Test** keeps an editable draft; **Launch Test** locks the setup with a version ID once the six-item checklist passes.

## What to keep in mind
- The demo results are **simulated** with a known injected effect, so we can check the decision is right. They say nothing about how a real prompt performs.
- "No clear difference" is an honest answer. It does not mean the change is useless; it says how many more leads would settle it.
- Canary advises. It does not change your live traffic.
- Technical extras (proof tables, label calls, hear it) are under **Settings** > Tools.

More: `USER_JOURNEY.md` (a guided tour), `QA_REPORT.md` (the evidence), `skill/ab-test-decision/SKILL.md` (the same method as a reusable skill for AI assistants).
