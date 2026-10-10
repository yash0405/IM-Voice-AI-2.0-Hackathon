# Vendored: Sarvam Voice Agents browser SDK

`sarvam-conv-ai-sdk.browser.js` is `sarvam-conv-ai-sdk@0.0.42` (npm, MIT licence, see `LICENSE-sarvam-conv-ai-sdk.txt`), bundled for the
browser with esbuild 0.25 and exposed as `window.SarvamConv`. Nothing in it was modified. To rebuild:

```bash
npm pack sarvam-conv-ai-sdk@0.0.42 && tar xzf sarvam-conv-ai-sdk-0.0.42.tgz
cat > entry.js <<'JS'
export { ConversationAgent, BrowserAudioInterface, AgentState, InteractionType } from "./package/dist/browser.js";
export { Role } from "./package/dist/types/types.js";
JS
npx esbuild@0.25 entry.js --bundle --format=iife --global-name=SarvamConv --minify --target=es2020 --outfile=sarvam-conv-ai-sdk.browser.js
```

The page uses the SDK's documented `baseUrl` proxy option, so the browser never holds a Sarvam API key (see `canary/liveserver.py`).
