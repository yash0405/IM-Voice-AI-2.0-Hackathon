# Start here (5 minutes, no technical knowledge needed)

**What Canary does.** You changed something about a bot (a new prompt, a new flow) and ran it next to the old one. Canary reads the results and tells you in plain words whether to **ship it**, **stop it**, **let a person decide**, or **keep what you have**. It always says how sure it is, and it says so when it cannot tell.

## Open it
1. Double-click `dist/canary_demo.html` (works offline), **or** run `./start.sh` (opens the live version, which can also read your own files).
2. Click **Judge a test** and then any example, for instance **B wins, but calls run longer**. Press **Skip to the result**.

## What you will see
- A verdict in one sentence, the numbers for both prompts, and a **range** ("the true difference is probably between +1 and +12 points").
- Safety checks: was the split fair, did calls get longer, was the data clean. Anything odd is listed under "data notes".
- For a win with a catch, buttons for a person to **approve or reject**; the choice is added to a record that cannot be changed without being noticed.

## Use your own results
1. `./start.sh`, then **Judge a test** > **Use your own files**.
2. Choose the results file (one row per call: lead id, which prompt, what happened, call length, when).
3. Tick which outcomes count as success. Fill in the plan: expected success rate today, share of traffic sent to the new prompt, test length. **Write these down before the test starts**: they fix the decision lines, and numbers picked after seeing results would bend the answer.
4. Press **Decide**.

## Before you start a test
Click **Plan a test**. It tells you whether your traffic is enough to get a clear answer, and how many days you need.

## What to keep in mind
- The demos are **simulated** results with a known answer, so we can check the decision is right. They say nothing about how a real prompt performs.
- "No clear difference" is an honest answer. It does not mean the change is useless; it says how many more leads would settle it.
- Canary advises. It does not change your live traffic.

More detail: `USER_JOURNEY.md` (a guided tour), `QA_REPORT.md` (the evidence), `skill/ab-test-decision/SKILL.md` (the same method as a reusable skill for AI assistants).
