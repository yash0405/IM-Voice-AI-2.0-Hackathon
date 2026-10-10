# Leaders' questions: "Does this already exist? Why build it? What did you reuse?"

Facts were checked on vendors' official docs on **2026-10-10**; the source is next to each one. Where something could not be confirmed on an official page, it says "not confirmed". Products change fast: re-check before quoting a competitor.

## The 30-second answer

> "Splitting voice-bot traffic between two versions is now common. Vapi, Retell, ElevenLabs, PolyAI, Bland, Sierra, Decagon and Google all offer it. What they leave to a person is the hard part: **deciding safely who won, and acting on it**. General experiment tools like LaunchDarkly and GrowthBook do decide and auto-roll back, but they don't understand phone calls and don't run on Sarvam. **Sarvam itself has agent versions but no traffic split, no per-version analytics and no statistics.** Canary is the missing layer on top of Sarvam. It splits callers fairly, grades every call with Sarvam's own models, decides with peeking-safe statistics, and ships or rolls back by itself. The data stays in India. We didn't reinvent the maths: we used textbook methods and checked them against statsmodels and GrowthBook's open-source engine, and they agree."

## 1. Who already does part of this

| Product | What it is | Splits live voice traffic? | Decides the winner safely? | Ships or rolls back by itself? | Understands calls? | India / Indic | Source |
|---|---|---|---|---|---|---|---|
| **Sarvam Voice Agents** (our platform) | Voice agent platform | **No.** A deployment and a campaign each take one `app_version`. | No | Manual deploy and rollback | Yes (Goals, output variables, transcripts) | Indic-first; "all data… stays within India" | docs.sarvam.ai/conversations/build/agent/versioning, …/api/deployments/create |
| Vapi | Voice platform | Yes, "Traffic splitting" (beta) | No: the beta has no per-version metrics or comparison | Manual | Scorecards | US and EU regions | docs.vapi.ai/assistants/versioning/traffic-splitting |
| Retell AI | Voice platform | Yes, % split per phone number | No method documented | Manual | Success rate, duration | Hindi yes; India data not confirmed | docs.retellai.com/deploy/ab-testing |
| ElevenLabs Agents | Voice platform | Yes, "Experiments" (Feb 2026) | No: "allow enough conversations to accumulate" | Manual | CSAT, conversion | India data residency (Enterprise) | elevenlabs.io/docs/eleven-agents/operate/experiments |
| PolyAI | Enterprise voice | Yes, 1–99% | **Says no:** it "doesn't tell you whether a difference… is big enough to trust" | Manual merge | Dashboards | Not confirmed | docs.poly.ai/testing/ab-testing |
| Bland AI | Voice platform | Yes, Experiments API | No method documented | Ends on a time or quota limit; promotion manual | Simulation analytics | Not confirmed | docs.bland.ai/api-v2/post/agents-id-experiments |
| Sierra, Decagon | Support agents | Yes (voice not stated) | Shows "significant" or uses a fixed p-value; method not named | Gradual ramp; manual | Resolution, CSAT | Not confirmed | sierra.ai/blog/let-your-customers-shape-your-agents, decagon.ai/product/experiments |
| Google CX Agent Studio | Agent platform | Yes, `trafficAllocations` | No: analyse it yourself in BigQuery | Manual | Through logs | Not confirmed | cloud.google.com/…/cx-agent-studio/deploy/traffic-split |
| **AWS Bedrock AgentCore** (preview, Apr 2026) | General agent platform | Yes, sticky by session | p-values; claims safe to check any time (method not named) | `promote` is a manual command; no guardrail auto-rollback documented | LLM judges on text, not audio | Mumbai and Hyderabad regions | docs.aws.amazon.com/bedrock-agentcore/latest/devguide/ab-testing.html |
| **LaunchDarkly** AI Configs + Guarded rollouts | Feature flags for prompts | Prompt A/B, not voice-specific | **Yes**, sequential | **Yes**, auto-rollback (Enterprise + Guardian add-on) | No: you send an event per call | SaaS | launchdarkly.com/docs/home/releases/guarded-rollouts |
| **GrowthBook** | Open-source experimentation | Generic events | **Yes**, sequential (Pro plan) | **Yes**, Safe Rollouts with SRM check (Pro) | No | Self-host free | docs.growthbook.io/statistics/sequential |
| Statsig, Optimizely, Eppo, Amplitude, PostHog, Harness (Split) | Experimentation | Generic events | Yes, sequential | Mostly alerts, or code you write yourself | No | SaaS | vendor docs (see the research notes) |
| Cekura, Coval, Hamming, Roark, Bluejay | Voice QA and testing | **No.** Cekura: "it does not route live production callers between variants". | No | No | **Yes** (LLM judges on calls) | Mixed | cekura.ai/discover/how-to-ab-test-voice-agents |

**Gaps no single product covers:**
1. Voice platforms split traffic but **leave "who won?" to a person**, and PolyAI says so outright.
2. Tools that decide and auto-roll back (LaunchDarkly, GrowthBook) **don't understand calls**: someone must turn each call into an outcome event, and auto-rollback is a paid tier.
3. Tools that understand calls (Cekura, Coval, Hamming) **don't run live experiments**.
4. **Sarvam has no version split and no per-version analytics**, so nothing on our required platform does this today.
5. We found no product that documents all four: a locked pre-registered setup, a tamper-evident decision record, a holdback after shipping, and a split check that halts the test. That means "not found", not "proven absent".

## 2. "Why didn't you just use X?"

| If they say… | Answer |
|---|---|
| "Use Vapi, Retell or ElevenLabs experiments" | The hackathon and VANI run on **Sarvam** (Indic voices; data stays in India). Those platforms split traffic and leave the decision to a person. Daily eyeballing of results picks a wrong winner about **8% of the time with A = B** in our simulation (2.5% with Canary's rule); see *Why trust it* in the app. |
| "Use LaunchDarkly or GrowthBook" | They are good at statistics, but they need a per-call outcome event that nobody produces for a phone call. That is our Sarvam STT + judge step. Auto-rollback is Enterprise or Pro, and SaaS means call data leaves the premises (GrowthBook self-host is the exception). Ownership is also unstable in this market: Statsig went to OpenAI (Sep 2025) and its product to Amplitude (May 2026), Eppo went to Datadog (May 2025), and Humanloop shut down. |
| "AWS AgentCore does this" | It is the closest general product (in preview). But it is not built for telephony or voice, does not use Sarvam, its promotion is manual, and a guardrail auto-rollback, holdback and split check are not documented. |
| "Why build from scratch?" | We didn't build the maths from scratch. We used standard methods (score test, Wilson ranges, Lan-DeMets alpha spending, chi-square split check) on numpy and scipy, **and we checked them against statsmodels and GrowthBook's own engine** (next section). What we built is the glue nobody sells: Sarvam-native, call-aware, peeking-safe, acting by itself, and running on-premises. The hackathon rules also disqualify pre-built solutions. |
| "Won't Sarvam add this?" | Possibly. They shipped Tests and an MCP server on 2026-09-17. If they add a version traffic split, Canary uses it and still adds the decision, guardrails, holdback and rollback. Our router becomes optional, not obsolete. |

**Being honest:** "Nobody does A/B for voice bots" is **false**, so don't say it. The claim we can defend is narrower: no one offers **all of it together, on Sarvam**: a fair sticky split, outcomes graded from the call, peeking-safe decisions, guardrail stop and hold, auto-ship with holdback and auto-rollback, a tamper-evident record, and data kept in India. Leaping AI (YC W25) says it auto-promotes prompt variants from a traffic slice, so "suggested from real failures" is not unique on its own.

## 3. Independent check of our statistics

`tests/test_crosscheck.py` recomputes the engine's numbers with two outside libraries. It needs `pip install statsmodels pandas && pip install --no-deps gbstats` and skips otherwise. Run on 2026-10-10 with statsmodels 0.15.0 and gbstats 0.8.0.

| What | Reference | Result |
|---|---|---|
| The decision statistic (pooled two-proportion z) | statsmodels `proportions_ztest` | **Identical** (to 9 decimals) on 20 cases, 100 to 40,000 leads |
| Each prompt's rate range | statsmodels `proportion_confint(method="wilson")` | **Identical** |
| The split check | **GrowthBook `check_srm`** | **Identical p-values** |
| The range shown for B minus A | statsmodels score interval (Miettinen-Nurminen) | **Same call in every case** (whether the range excludes 0). The ends differ by at most 0.08 points from 1,000 leads up (0.9 points at 100 leads), because ours inverts the engine's own test. |
| The planned test size | statsmodels `power_proportions_2indep`, confirmed by 200,000 simulated tests | **79.4 to 80.5% power** over VANI's range (35–60% BuyLead rate, 3–5 point lift, 30–50% on B): the planned 80%. **Found gap:** far outside that range (10% on B, 10-point lift) power drifts to 77–85%. The fix is known (pooled variance in the planner); it was not changed in this branch. |

## 4. Ready-made tools: what we use, and what we replaced

**Replaced our own code with a standard tool (this branch; same behaviour, every test still passes):**

| Was hand-written | Now | Why it is better |
|---|---|---|
| SVG charts (our own drawing code) | **Chart.js 4.4.4** (MIT), bundled into the page | A charting library used across the industry: hover tooltips, scaling and accessibility come built in. It also draws the new visuals (the A vs A proof chart). |
| Line diff of prompt A against B (our own Myers algorithm) | **jsdiff 5.2.0** (npm `diff`, BSD-3) | The diff library most JavaScript projects use, so there are no edge-case bugs of our own. |
| SHA-256 for the tamper check (our own implementation) | The browser's built-in **Web Crypto** (`crypto.subtle`) | A standard, audited implementation; a tampered entry is still caught (tested). |

Kept on purpose: the engine's statistics are SciPy plus the Python standard library (`statistics.NormalDist`). They are already standard tools, and the simulator calls them millions of times, which a heavier library would slow down. The group-sequential boundaries (Lan-DeMets) have no maintained Python library; the closest are R packages. They are checked instead: the 12,000-run A vs A study, plus the statsmodels and GrowthBook cross-check above.

**Also used (verified in the code):**

| Tool | Used for |
|---|---|
| **Sarvam Saaras v4** (speech-to-text) | Transcribing real VANI calls |
| **Sarvam-105B** (chat) | Grading each call's outcome: the 299 real calls, and now each live test call |
| **Sarvam Bulbul v3** (text-to-speech) | Hearing simulated A and B conversations |
| **Sarvam Voice Agents** + `sarvam-conv-ai-sdk` 0.0.42 | The live call test: talk to prompt A and prompt B, with each call pinned to its committed version |
| NumPy, SciPy, Jinja2, SQLite | The engine, the simulator, rendering the real prompt, the history database |
| Pyodide, GitHub Actions and Pages | The hosted copy runs the Python engine in the browser and redeploys on every push |
| statsmodels, GrowthBook `gbstats` | An independent referee for our statistics (tests) |
| Puppeteer + Chrome | Browser end-to-end tests |

**Could add next (in order of value):**

| Tool | What it removes or adds | Needs |
|---|---|---|
| **Sarvam deployments API** (`app_version`) | Real automatic rollout and rollback of the live line | A Voice Agents key and a deployment id |
| **Sarvam webhooks + transcripts API** | Results arrive by themselves, with no file upload | A Voice Agents key |
| **Sarvam Tests** (simulated buyer + AI judge, per version) | The deck's "test bed of simulated buyers built with Sarvam voice agents", run on A and B before launch | A Voice Agents key; uses credits |
| Sarvam-105B draft of prompt B from one sentence | No hand-written prompt edits | About ₹1 per draft (the CLI exists) |
| Slack incoming webhook | "Needs attention" reaches a person without opening the app | A webhook URL |
