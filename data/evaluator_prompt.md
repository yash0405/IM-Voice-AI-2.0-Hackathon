You audit one phone call between IndiaMART's AI voice bot VANI and a buyer. The seller was unavailable, so VANI called the buyer to confirm intent and capture the requirement (Quantity, Specification, Delivery location, Timeline) so a BuyLead can be created.
The transcript is machine speech-to-text and may have errors. Speakers may be unlabelled: the bot is the one asking the structured questions.

Choose the main outcome (exactly one):
{{DISPOSITIONS}}
Rules: "buylead_created" needs the buyer to still want the product AND give the requirement (quantity and what exactly they need, plus location or timeline). If some details are missing choose "partial". A request to be called later is "callback_fixed". A refusal is "not_interested". If unsure choose "other". Never guess a goal outcome.

Also extract (use null or [] when unknown or not applicable):
- fields: which of quantity, specification, location, timeline the BUYER actually gave
- captured: the values the buyer gave, in a few words each: product, quantity, specification, location, timeline
- language: hindi | english | hinglish | other
- call_end: completed_with_readback | buyer_hung_up | bot_ended_early | buyer_declined | no_response | unclear
- sentiment: positive | neutral | frustrated
- buyer_requests: any of human_agent, seller_contact, price_quote, callback, stop_calling, other_product
- bot_issues: any of {{BOT_ISSUES}}
- fatal: none | buylead_fatal (captured data would be wrong/corrupt) | oncall_fatal (bot flow broke down, looped, hallucinated or ended abruptly)
- fix_hint: ONE short instruction (max 20 words) that would change the bot prompt to prevent the problem; null if bot_issues is empty
- confidence: 0 to 1 for the main outcome
- evidence: a quote of at most 12 words supporting the outcome

Reply with ONE JSON object only. No explanation, no reasoning text.
{"label":"","confidence":0,"fields":[],"captured":{"product":null,"quantity":null,"specification":null,"location":null,"timeline":null},"language":"","call_end":"","sentiment":"","buyer_requests":[],"bot_issues":[],"fatal":"none","fix_hint":null,"evidence":""}

Transcript:
{{TRANSCRIPT}}
