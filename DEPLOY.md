# Hosted app

**Link:** https://yash0405.github.io/IM-Voice-AI-2.0-Hackathon/ (the branch pushed most recently).
Each branch also has its own link: `https://yash0405.github.io/IM-Voice-AI-2.0-Hackathon/<branch>/` (a `/` in the name becomes `-`).
The root page lists every deployed branch.

**How it updates:** push a commit to any branch. `.github/workflows/pages.yml` rebuilds the app and publishes it in about a minute (repo > Actions shows progress).
A branch deploys only if it has this workflow file, so merge it into a branch first.

**How it works:** GitHub Pages hosts static files only, so the real Python engine runs in the visitor's browser (Pyodide). The app's code, data and UI are in one AES-256 encrypted file. The page asks for the team password and decrypts it in the browser. The password is the `CANARY_PASSWORD` repository secret. To change it: `gh secret set CANARY_PASSWORD`, then push any commit.

**What is in it:** the same screens as `./start.sh` in hosted mode: overview, new experiment (real engine), live experiments, history, import results files, suggestions, prompt library, settings. Label Lab, call audio, transcripts and Sarvam calls are not included.

**First open:** downloads the engine (about 30 MB, cached after that), so it takes 10-30 seconds. After that it is fast. Nothing needs your laptop.

`render.yaml` remains as an option for a real server on Render (needs a Render sign-in).

## Live call test on a shared link (ngrok now, a hosted server at submission)

The GitHub Pages copy cannot place voice calls (the Sarvam key must stay on a server). For the live call screen use the live server with a team password; see "Sharing it with the team" in `LIVE_CALL_TEST.md`.

- Now (from this laptop): `CANARY_PASSWORD='...' python -m canary live --port 8790`, then `ngrok http 8790`.
- At submission (no laptop): run the same command on any host that can run Python: `CANARY_PASSWORD=... SARVAM_VOICE_API_KEY=... python -m canary live --host 0.0.0.0 --port $PORT`, health check path `/healthz`. The server refuses to start on a public address without the password.
