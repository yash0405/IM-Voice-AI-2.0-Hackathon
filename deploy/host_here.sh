#!/usr/bin/env bash
# Host the live Canary app on a public https URL straight from this machine (Cloudflare quick tunnel, no account needed)
# and redeploy it whenever a branch changes (a local commit or a push). Only hosted mode is ever served, and only from an
# export of the TRACKED files of that branch, so .env, transcripts, labels and recordings are not on disk where it runs.
#   ./deploy/host_here.sh start    runs in the background, prints the URL and the password
#   ./deploy/host_here.sh status   the URL, the password and what is deployed
#   ./deploy/host_here.sh stop
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE="${CANARY_HOST_STATE:-$HOME/.cache/canary-host}"
PORT="${CANARY_HOST_PORT:-8800}"
mkdir -p "$STATE"
log() { echo "$(date +%H:%M:%S) $*"; }
alive() { [ -s "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

hosted_capable() { git -C "$ROOT" show "$1:canary/server.py" 2>/dev/null | grep -q 'CANARY_HOSTED'; }

stop_app() { alive "$STATE/app.pid" && kill "$(cat "$STATE/app.pid")" 2>/dev/null; sleep 1; rm -f "$STATE/app.pid"; }

deploy() {   # $1 = branch ref (name or origin/name)
  local ref="$1" sha dir
  hosted_capable "$ref" || { log "skip $ref: that branch has no hosted mode (it would be unsafe to serve)"; return 1; }
  sha="$(git -C "$ROOT" rev-parse --short "$ref")"
  [ "$(cat "$STATE/current" 2>/dev/null)" = "$ref $sha" ] && return 0
  dir="$STATE/app-$sha"
  if [ ! -d "$dir" ]; then mkdir -p "$dir.tmp" && git -C "$ROOT" archive "$ref" | tar -x -C "$dir.tmp" && mv "$dir.tmp" "$dir"; fi
  "$STATE/venv/bin/pip" install -q -r "$dir/requirements.txt" || { log "pip failed for $ref"; return 1; }
  stop_app
  ( cd "$dir" && CANARY_HOSTED=1 CANARY_PASSWORD="$(cat "$STATE/password")" RENDER_GIT_BRANCH="$ref" RENDER_GIT_COMMIT="$sha" \
      setsid nohup "$STATE/venv/bin/python" -m canary serve --hosted --host 127.0.0.1 --port "$PORT" > "$STATE/app.log" 2>&1 & echo $! > "$STATE/app.pid" )
  for _ in $(seq 1 40); do curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && break; sleep 0.5; done
  if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then echo "$ref $sha" > "$STATE/current"; log "deployed $ref ($sha)"
  else log "app did not start for $ref, see $STATE/app.log"; return 1; fi
  ls -dt "$STATE"/app-* 2>/dev/null | tail -n +4 | xargs -r rm -rf          # keep the last three exports
}

snap() { git -C "$ROOT" for-each-ref --format='%(refname:short) %(objectname)' refs/heads refs/remotes/origin | grep -v -E '^origin(/HEAD)? '; }

run() {
  trap 'stop_app; [ -s "$STATE/tunnel.pid" ] && kill "$(cat "$STATE/tunnel.pid")" 2>/dev/null; exit 0' TERM INT EXIT
  [ -s "$STATE/password" ] || { python3 -c 'import secrets; print(secrets.token_urlsafe(9))' > "$STATE/password"; chmod 600 "$STATE/password"; }
  [ -x "$STATE/venv/bin/python" ] || python3 -m venv "$STATE/venv"
  if [ ! -x "$STATE/cloudflared" ]; then
    case "$(uname -m)" in aarch64|arm64) arch=arm64 ;; *) arch=amd64 ;; esac
    curl -fsSL -o "$STATE/cloudflared" "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$arch" && chmod +x "$STATE/cloudflared" || { log "could not download cloudflared"; exit 1; }
  fi
  local first; first="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)"
  deploy "$first" || log "current branch '$first' is not deployable; waiting for a branch that is"
  ( while true; do
      "$STATE/cloudflared" tunnel --no-autoupdate --protocol http2 --url "http://127.0.0.1:$PORT" > "$STATE/tunnel.log" 2>&1 &
      echo $! > "$STATE/tunnel.pid"; wait $!; log "tunnel ended, restarting"; sleep 5
    done ) &
  ( while true; do grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$STATE/tunnel.log" 2>/dev/null | tail -1 > "$STATE/url.txt"; sleep 3; done ) &
  local prev cur line name best bestt t
  prev="$(snap)"
  while true; do
    sleep 20
    git -C "$ROOT" fetch -q origin 2>/dev/null
    cur="$(snap)"
    if [ "$cur" != "$prev" ]; then
      best=""; bestt=0
      while read -r line; do
        name="${line% *}"; t="$(git -C "$ROOT" log -1 --format=%ct "$name" 2>/dev/null || echo 0)"
        [ "$t" -ge "$bestt" ] && { best="$name"; bestt="$t"; }
      done < <(comm -13 <(echo "$prev" | sort) <(echo "$cur" | sort))
      [ -n "$best" ] && deploy "$best"
      prev="$cur"
    fi
  done
}

case "${1:-status}" in
  run) run ;;
  start)
    if alive "$STATE/host.pid"; then echo "already running"; else
      setsid nohup "$0" run > "$STATE/host.log" 2>&1 & echo $! > "$STATE/host.pid"
      for _ in $(seq 1 300); do [ -s "$STATE/url.txt" ] && curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && break; sleep 1; done
    fi
    "$0" status ;;
  stop)
    alive "$STATE/host.pid" && kill "$(cat "$STATE/host.pid")" 2>/dev/null
    sleep 1; alive "$STATE/app.pid" && kill "$(cat "$STATE/app.pid")" 2>/dev/null
    [ -s "$STATE/tunnel.pid" ] && kill "$(cat "$STATE/tunnel.pid")" 2>/dev/null
    rm -f "$STATE/host.pid" "$STATE/app.pid" "$STATE/tunnel.pid" "$STATE/url.txt"; echo stopped ;;
  status)
    if alive "$STATE/host.pid"; then
      echo "URL:      $(cat "$STATE/url.txt" 2>/dev/null)"; echo "Password: $(cat "$STATE/password" 2>/dev/null)   (any user name)"
      echo "Running:  $(cat "$STATE/current" 2>/dev/null)"; else echo "not running (./deploy/host_here.sh start)"; fi ;;
  *) echo "usage: $0 start|stop|status"; exit 2 ;;
esac
