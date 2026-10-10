# Labelling guide (updated for VANI's real prompt)

## The plan: the machine labels, a person spot-checks (about 25 minutes, not 3 hours)
1. **Sarvam transcribes and tags** the calls (`python -m canary autolabel ...`). The 299 labels we have were made **before the real VANI prompt arrived**, so they use an older vocabulary. Re-tagging the saved transcripts with the real-prompt schema costs about Rs 23 (`python -m canary autolabel retag --yes --budget N`; not run yet because credits are limited).
2. **A person spot-checks about 40 calls**: 30 chosen at random (shown *without* the machine's answer, so we get an honest accuracy) and 10 the machine was least sure about. **Best done after the re-tag**, so your answers are compared with labels made under the real prompt. If you start now, the 30 blind calls are still valid; the "uncertain" 10 are rebuilt by the re-tag.
3. From that we report the real BuyLead rate, the machine's accuracy, and correct for its mistakes.

# Detailed rules (for the people who will label calls)

**What the calls are (corrected).** The buyer **called a seller** from the IndiaMART app, the seller was unavailable, and the call was **redirected to the IndiaMART Help Desk, where VANI answers**. VANI did not phone the buyer (only the "redial" calls are outbound). VANI should:
1. confirm the buyer really needs a product (and which),
2. collect **quantity**, each **specification**, the buyer's **name** and **city and state**,
3. when a **live seller is available**, offer to connect the buyer (this is the top priority; quantity and specification must never block it), otherwise promise seller details on WhatsApp,
4. **not** read captured values back and **not** ask "anything else?",
5. ask for any one detail **at most 2-3 times** (more than 3 is "looping").

There is **no timeline** and **no delivery location** in the real flow.

Ending the call early is **correct** when the buyer has no product requirement, only wants the original seller, refuses to talk to an AI, or is a job seeker, a seller, a complaint or a status enquiry.

**Why we need your labels.** Nobody has said what happened on our recordings. Your answers become the ground truth for (1) the real BuyLead conversion rate, (2) the accuracy of the automatic tagger, (3) real data-capture and bot-mistake rates. Please do not guess: "Other" is better than a wrong answer.

## For each call
1. Open **Label calls**, type your name, press **Start**. Read the transcript (and listen if the audio helps).
2. **Optional:** tick the details VANI captured from the buyer (Quantity / Specification / Buyer name / City and state), and tick **Bot made a mistake** if it looped, misheard badly, made something up, read a value back or wrote down wrong details.
3. **Click the outcome** (or press 1-6). The next call appears.

| Outcome | Choose it when | Do NOT choose it when |
|---|---|---|
| **BuyLead created** | the buyer confirmed a genuine product requirement and VANI took it forward: details captured, the buyer connected to a live seller, or seller details promised on WhatsApp | the buyer never clearly confirmed a product |
| **Requirement not confirmed** | someone spoke but never clearly confirmed a product requirement: dropped early, ambiguous, language barrier | they confirmed a product (BuyLead created) or there was no conversation |
| **Wanted the original seller only** | the buyer only wanted the seller they called, or refused to talk to an AI, and VANI closed the call | they also described a requirement |
| **No product requirement** | status enquiry, job seeker, someone selling or listing, complaint, banned product or off-topic | they have any product requirement |
| **Nobody spoke** | voicemail, silence, ringing, line cut at once | any real conversation happened |
| **Other / unclear** | none of the above fits, or you cannot tell | - |

**If unsure, choose Other.** Never guess BuyLead created. (If the organisers have an official rule for what counts as a BuyLead, use it and tell us.)

## Rules that make the labels trustworthy
- **Two people label the same calls**, separately, without discussing answers until both finish. The page shows how often you agree (we want 80% or more).
- Judge each call on its own. Use the note box for anything odd.
- Recordings and transcripts are customer data: keep them on this laptop / the office network. No sharing, no recording the screen on a phone.

## Where the answers go
`canary/data/labels.jsonl` (one line per answer). Back it up when you finish. The **Labels** tab shows progress, the real BuyLead conversion rate, bot-mistake rate and your agreement score.
