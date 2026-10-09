# Hosting the live app (free, redeploys on every push)

The live app is `python -m canary serve`. On the internet it runs in **hosted mode** (`--hosted`):
- It asks for a password (`CANARY_PASSWORD`, 8+ characters) and refuses to start without one.
- Only the console screens and the engine are served: New experiment, Live experiments, results-file import, samples.
- Label Lab, call audio, transcripts, the Sarvam spend ledger and the proof lab are switched off (they return 404). No `.env`, no Sarvam calls.
- At most two heavy runs at once (a third gets "busy, try again"), requests over 4 MB are refused.
- `/healthz` (no password) shows which branch and commit is running; the same shows in the bottom-right corner of the page.

The page still contains the real VANI prompt (Prompt Library, Overview), because that is what the repo carries today. The password is what keeps it from the open web. If the prompt is taken out of the repo, the hosted copy stops showing it.

## Fastest: host it from this machine (no account, public https link)
```bash
./deploy/host_here.sh start      # prints the link and the password; ./deploy/host_here.sh status / stop
```
It starts hosted mode from an export of the tracked files of your current branch (so `.env`, transcripts, labels and recordings are not on disk where it runs) and opens a Cloudflare quick tunnel. Every 20 seconds it checks the branches: a commit or a push to any branch that has hosted mode redeploys that branch, and the corner label shows which. The link changes when you stop and start it, and it works only while this computer is on. A branch without hosted mode is skipped, never served.

## Permanent hosting on Render: one-time setup (about 5 minutes, free, no card)
1. **Render**: sign in at render.com with GitHub. New > Blueprint > pick this repo, branch `main`. Render reads `render.yaml`, asks for `CANARY_PASSWORD`, and builds. The link looks like `https://canary-xxxx.onrender.com`.
2. **Any-branch updates**: in Render open Account Settings > API Keys and create a key. Open the service; its id is in the URL (`srv-...`). Then run, in this repo:
   ```bash
   gh secret set RENDER_API_KEY        # paste the key
   gh secret set RENDER_SERVICE_ID     # paste srv-...
   ```
3. Push. `.github/workflows/deploy-render.yml` points the service at the branch you pushed and deploys it. Watch it under the repo's Actions tab.

Share the link and the password with the team (not in the repo).

## What to expect
- The last push wins: if two people push different branches, the host shows the later one. The corner label says which.
- Free plan: the app sleeps after 15 minutes without visits and takes about a minute to wake. 512 MB memory. Demo state (days played, approvals) lives in each person's browser, as locally.
- Without the two secrets only `main` redeploys (Render's own auto-deploy); other branches do not.
- Run it locally the same way: `CANARY_HOSTED=1 CANARY_PASSWORD=choose-one python -m canary serve --hosted --port 8800`.

