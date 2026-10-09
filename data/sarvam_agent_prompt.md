# Ready-to-paste text for the Sarvam voice agents (submission item: Agent ID / live link)

Where: **indus.sarvam.ai -> Build -> Agents -> Create from Scratch**. There is no documented API to create an agent.

1. Create TWO agents: **VANI - prompt A (today)** and **VANI - prompt B (candidate)**.
2. Paste `data/sarvam_agent_A.md` into agent A's Instructions and `data/sarvam_agent_B.md` into agent B's. These are the REAL VANI inbound-redirect prompt, rendered for a demo call (a live seller available, product 'stainless steel pipes'); B differs by the lines shown in the dashboard diff.
3. Greeting (an assumption: the real `initial_message` is filled in by IndiaMART's system): *Namaste, kya aap stainless steel pipes ke liye call kar rahe hain?*
4. Settings: language Hindi (Hinglish), a Bulbul voice. Talk to each agent in the test panel, then note the **Agent ID / link**.

Candidate B: **Make the ask limits agree with each other** (origin: lint-derived).
