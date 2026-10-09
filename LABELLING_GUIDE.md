# Labelling guide

## New plan: the machine labels, a person spot-checks (about 25 minutes, not 3 hours)
1. **Sarvam transcribes and tags** a random sample of the calls automatically (`python -m canary autolabel ...`, about Rs 55 for 100 calls).
2. **A person spot-checks about 40 calls**: 30 chosen at random (shown *without* the machine's answer, so we get an honest accuracy) and 10 the machine was least sure about (shown *with* its suggestion: click "Machine is right" or fix it). Each takes about 30-40 seconds because you read the transcript instead of listening.
3. From that we report the real BuyLead rate, the machine's accuracy, and correct for its mistakes.

The detailed rules below are for the spot-check, and for anyone who wants to label from scratch.

# Detailed rules (for the people who will label calls)

**What the calls are.** VANI (IndiaMART's voice assistant) phones a **buyer** when the seller is unavailable. It confirms the buyer still wants the product and captures four details so a BuyLead can be created and the seller does not lose it: **Quantity, Specification, Delivery location, Timeline.**

**Why we need your labels.** Nobody has said what happened on our 713 recordings. Your answers become the ground truth for (1) the real BuyLead conversion rate, (2) scoring the automatic outcome tagger, (3) real data-capture and bot-mistake rates. Please do not guess: "Other" is better than a wrong answer.

**Time:** about 90 minutes for 60 calls (the first 60 calls add up to 85 minutes of audio). Take a break halfway.

## Before you start (10 minutes, one person)
Listen to 5 calls and tell the tech person if anything differs from the description above (for example: some calls are to sellers, or the bot asks different details). We will adjust the answers *before* anyone labels.

## For each call
1. Open **Label calls**, type your name, press **Start**. The call plays.
2. **Optional:** tick the details VANI captured from the buyer (Quantity / Specification / Delivery location / Timeline), and tick **Bot made a mistake** if it looped, misheard badly, made something up or wrote down wrong details.
3. **Click the outcome** (or press 1-6). The next call appears.

| Outcome | Choose it when | Do NOT choose it when |
|---|---|---|
| **BuyLead created** | the buyer still wants it AND gave the requirement: quantity and what exactly they need, plus location or timeline | they only said "yes" or gave one detail |
| **Partial details** | they talked and gave something, but key details are still missing | they gave nearly everything (BuyLead created) or nothing |
| **Callback requested** | they are busy and asked to be called later | they refused |
| **Not interested** | they no longer need it, refused, or asked not to be called | they only asked a question |
| **No conversation** | voicemail, silence, wrong number, line cut at once | any real conversation happened |
| **Other / unclear** | they talked but none of the above fits, or you cannot tell | - |

**If unsure, choose Other.** Never guess BuyLead created. (If the organisers have an official rule for what counts as a verified BuyLead, use that instead and tell us.)

## Rules that make the labels trustworthy
- **Two people label the same calls**, separately, without discussing answers until both finish. The page shows how often you agree (we want 80% or more).
- Judge each call on its own. Use the note box for anything odd.
- Recordings are customer data: keep them on this laptop / the office network. No sharing, no recording the screen on a phone.

## Where the answers go
`canary/data/labels.jsonl` (one line per answer). Back it up when you finish. The **Labels** tab shows progress, the real BuyLead conversion rate, bot-mistake rate and your agreement score.
