# ACT — Friction-Aware Desktop Intelligence

> **Early-stage demo. Expect rough edges and broken behavior.** The core signal collection, friction scoring, and two-stage LLM pipeline are implemented but not well-tuned. Nudges may fire at wrong times, the Tinker endpoint is assumed to be OpenAI-compatible (you'll need to confirm your actual endpoint), and the overall system has seen limited real-world testing.

ACT is a Windows desktop app that watches your behavior in real time, detects when you seem stuck, runs your screen context through a fine-tuned intent model, and delivers a proactive AI-powered suggestion in a floating translucent overlay — without you having to ask.

---

## How It Works

```
SignalCollector (every 2s)
        │  behavioral signals (keyboard, mouse, scroll, clipboard, window)
        ▼
  FrictionScorer ──► FrictionReading (0.0 – 1.0)
        │
        ▼ friction above trust-adjusted threshold?
  TrustManager ──► gates whether to proceed
        │
        ▼
    Capturer ──► screenshot + clipboard + active window
        │
        ▼
   OcrService ──► screen text (Tesseract.js, 5s timeout)
        │
        ▼
   redactPII ──► strips emails, cards, long numbers
        │
        ▼
  ContextFabric ──► entity-relationship graph (SQLite)
        │              apps, topics, workflows, edges
        ▼
  TinkerIntentProvider ──► classifies intent via fine-tuned model
        │  { goal, task_type, confidence, suggested_tier }
        │
        ├─ null / confidence < 0.5 → suppress (no nudge)
        ▼
  PerplexityActionProvider ──► streaming response (30s timeout)
        │
        ▼
   Translucent overlay ──► user sees streamed response, clicks ✕
        │
        ▼
  TrustManager ◄──── feedback updates trust score
  ContextFabric ◄─── nudge saved to history
```

---

## Architecture

### Sense Layer

**`SignalCollector`** hooks into global keyboard, mouse, and scroll events via `uiohook-napi`. Every 2 seconds it emits a `SignalSnapshot`:

| Signal | What it measures |
|---|---|
| `typingCadenceMs` | Average inter-keystroke interval (higher = more hesitation) |
| `appSwitchCount` | App/window switches in the last 30s |
| `dwellTimeSec` | Seconds on current window without meaningful input |
| `scrollVelocity` | Scroll events per second in the last 10s |
| `clipboardCycles` | Repeated clipboard copy-paste cycles in 60s |
| `errorDialogDetected` | Window title contains error/warning keywords |

If `uiohook-napi` fails to load (common if native modules aren't rebuilt), the collector emits a `degraded` event and stops rather than emitting misleading zero-signal snapshots.

**`FrictionScorer`** fuses signals into a score (0.0 = flow, 1.0 = stuck) using configurable per-signal weights, EMA smoothing (α = 0.3), and an adaptive 85th-percentile threshold.

### Weave Layer

**`ContextFabric`** maintains a SQLite graph of the user's activity — apps, topics, workflows, and time blocks as nodes; co-occurrence, sequence, and topic-relation as weighted edges. Edges decay every 10 minutes and are pruned below a minimum weight. Provides `buildContextPrompt()` for LLM injection and stores nudge history.

### Intent Layer

**`TinkerIntentProvider`** (`src/main/llm/tinker.ts`) calls a fine-tuned intent classification model hosted via the Tinker platform. Given the current app, screen text, clipboard, and behavioral signals, it returns:

```json
{ "goal": "...", "task_type": "...", "confidence": 0.0–1.0, "suggested_tier": "hint|detail|deep_dive" }
```

**This is a hard gate.** If the Tinker key is missing, the endpoint is unreachable, confidence is below 0.5, or the response can't be parsed — the nudge is suppressed entirely. No Perplexity call is made.

The endpoint is assumed to be OpenAI-compatible (`/v1/chat/completions` with JSON mode). You'll need to confirm the real endpoint URL and request schema with Thinking Machines.

### Nudge Layer

**`TrustManager`** persists an adaptive trust score (0.0–1.0, starts 0.5). Trust sets the friction threshold required to gate into the pipeline; the response tier now comes from Tinker's `suggested_tier`, not trust.

**`PerplexityActionProvider`** (`src/main/llm/perplexity.ts`) calls the Perplexity streaming API with a tier-matched system prompt and the classified goal injected. 30s timeout with `AbortController`. HTTP errors and timeouts surface as an error state in the overlay rather than silently hanging.

### UI

Two windows share a single Vite/React/Tailwind build:

- **Overlay** (`#/toast`) — translucent frosted-glass card, always-on-top, bottom-right corner. Shows only the streaming Perplexity response and optional citation hostnames. Single close button. Auto-hides after 30s if ignored.
- **Settings** (`#/settings`) — configure Tinker key/model/endpoint, Perplexity key/model, overlay opacity, and theme. Advanced section for signal interval, nudge cooldown, and app allowlist.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron 29 |
| Frontend | React 18, TypeScript, Tailwind CSS |
| Build | Vite + vite-plugin-electron |
| Input hooks | uiohook-napi |
| OCR | Tesseract.js (5s timeout) |
| Persistence | better-sqlite3 (WAL mode) |
| Intent model | Tinker (Thinking Machines) — fine-tuned, hosted |
| Response model | Perplexity API (sonar, streaming, 30s timeout) |
| Logging | pino |
| Active window | active-win |
| Screenshots | screenshot-desktop |

---

## Requirements

### Tinker API (intent classification — required)
ACT requires a Tinker API key and a hosted fine-tuned model endpoint from [Thinking Machines](https://thinkingmachin.es/). Without it, zero nudges will fire. Configure the key, model name, and endpoint in Settings after launch.

> **Note:** The default endpoint (`https://api.tinker.thinkingmachines.ai/v1/chat/completions`) is an assumption. Confirm the real endpoint with Thinking Machines before expecting this to work.

### Perplexity API (response generation — required)
ACT uses the [Perplexity API](https://www.perplexity.ai/) for streamed responses. You need an API key with access to the `sonar` model family. Set it in Settings or via the env var:

```bash
set PERPLEXITY_API_KEY=your_key_here
```

---

## Setup

```bash
npm install
npm run rebuild        # rebuild native modules for current Electron ABI
```

```bash
set PERPLEXITY_API_KEY=your_key_here
npm run dev
```

The app runs as a system tray icon. Double-click the tray icon or right-click → Open Settings to configure your API keys. `Ctrl+Shift+P` pauses/resumes monitoring.

---

## Known Limitations & Rough Edges

- **Tinker endpoint is unverified.** The assumed endpoint URL and request format may not match what Thinking Machines actually provides. If classification always returns null, check the endpoint and auth header first.
- **No nudges without both keys.** If either key is missing or invalid, the system is silent — there's no degraded fallback mode.
- **Signal tuning is rough.** The friction threshold, per-signal weights, and the 0.5 confidence cutoff are first guesses. Expect noisy or poorly-timed suggestions until these are calibrated to your usage pattern.
- **Windows only.** Native modules (`uiohook-napi`, `screenshot-desktop`) are built for Windows. Mac/Linux are untested.
- **OCR quality varies.** Tesseract performs inconsistently on low-contrast or small text. A poor OCR read means a weaker Tinker classification.
- **uiohook-napi requires rebuilt native modules.** Run `npm run rebuild` after any Node/Electron version change. If hooks fail to start, the app logs a `degraded` warning and no signals are collected.

---

## Project Structure

```
src/
  main/              # Electron main process
    index.ts         # App entry, window management, IPC handlers, tray
    pulse-engine.ts  # Sense → Weave → Intent → Nudge orchestrator
    signal-collector.ts
    friction-scorer.ts
    capturer.ts
    ocr.ts
    redact.ts
    context-fabric.ts
    trust-manager.ts
    llm/
      types.ts       # IntentProvider, ActionProvider, StreamChunk interfaces
      tinker.ts      # TinkerIntentProvider (intent classification)
      perplexity.ts  # PerplexityActionProvider (streaming response)
      factory.ts     # buildProviders(settings)
  renderer/          # React + Tailwind UI
    main.tsx         # NudgeOverlay (toast) + SettingsWindow
    tailwind.css     # Tailwind entry
  shared/
    types.ts         # All shared interfaces and IPC message types

tests/               # tsx-based tests (no framework)
  friction-scorer.test.ts
  trust-manager.test.ts
  context-fabric.test.ts
  redact.test.ts
  tinker-intent.test.ts
  pipeline-two-stage.test.ts
```

---

## IPC Reference

| Direction | Channel | Payload |
|---|---|---|
| main → renderer | `nudge-update` | `{ type, nudgeId, text, done, citations?, error? }` |
| main → renderer | `settings-data` | `PulseSettings` |
| renderer → main | `nudge-feedback` | `{ nudgeId, feedback }` |
| renderer → main | `request-settings` | — |
| renderer → main (invoke) | `save-settings` | `PulseSettings` → `{ ok: true }` |

---

## Running Tests

```bash
npx tsx tests/friction-scorer.test.ts
npx tsx tests/trust-manager.test.ts
npx tsx tests/context-fabric.test.ts
npx tsx tests/redact.test.ts
npx tsx tests/tinker-intent.test.ts
npx tsx tests/pipeline-two-stage.test.ts
```
