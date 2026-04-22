# ACT — Friction-Aware Desktop Intelligence

> **Early-stage demo. Expect rough edges and broken behavior.** The core signal collection, friction scoring, and two-stage LLM pipeline are implemented but not well-tuned. Nudges may fire at wrong times, the Tinker endpoint is assumed to be OpenAI-compatible (confirm your actual endpoint with Thinking Machines), and the overall system has seen limited real-world testing.

ACT is a Windows desktop app that watches your behavior in real time, detects when you seem stuck, runs your screen context through a fine-tuned intent model, and delivers a proactive AI-powered suggestion in a floating translucent overlay — without you having to ask.

---

## Versions

### Version 1 — Predictive Desktop Layer + VL-JEPA (`PredictiveDesktopLayer/` + `vljepafolder/`)

The original version of ACT was a **vision-based desktop automation system**. It worked by continuously capturing screen frames and sending them to a VL-JEPA (Vision-Language Joint-Embedding Predictive Architecture) model hosted on Google Cloud Run (NVIDIA L4 GPU). The model predicted what action the user was about to take or should take next, returning structured output like:

```json
{
  "confidence": 0.92,
  "description": "Click the Save button",
  "actions": [{ "type": "click", "target": "Save button", "region": { "x": 450, "y": 320, "width": 80, "height": 30 } }]
}
```

A separate C# / .NET 8 Windows layer (`PredictiveDesktopLayer`) consumed these predictions and executed them — handling clicks, drags, typing, scrolls, and key presses via a state machine (`PulseStateMachine`) and action executor.

**Stack:** C# .NET 8 (WPF overlay, action execution) + Python FastAPI on Cloud Run GPU (VL-JEPA inference)

**Status:** Build is currently broken (`PredictiveDesktopLayer.Host` has a missing namespace error). The VL-JEPA server scaffold is in `vljepafolder/` — model loading is stubbed out. Not production-ready. The Cloud Run deployment scripts are functional if you bring your own model weights.

**Why it was shelved:** Vision-only prediction without understanding user *intent* produced noisy, poorly-timed interventions. Executing actions automatically without explicit user confirmation is also a high-risk UX pattern.

---

### Version 2 — Tinker + Perplexity + Electron (current, `src/`)

The current version takes a different approach: instead of watching pixels and predicting actions, it watches **behavioral signals** (typing hesitation, app switching, dwell time, scroll patterns, clipboard cycling) to detect friction, uses a fine-tuned **Tinker** intent model to decide *whether* and *what kind of* help is needed, then generates a streamed natural-language response via **Perplexity**.

The result surfaces in a translucent always-on-top overlay — the user reads it, acts on it, and closes it. No automated action execution.

**Stack:** Electron 29 + React 18 + TypeScript + Tailwind CSS + Tinker API (intent) + Perplexity API (response)

**Status:** Active development. See current architecture below.

---

## How It Works (v2)

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

## Architecture (v2)

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

### Weave Layer — 3-Tier Memory

**`ContextFabric`** (`src/main/context-fabric.ts`) manages memory across three distinct tiers, all backed by SQLite:

#### Tier 1 — Session Memory (in-memory + DB, resets after 20min idle)
Tracks the current working context: which apps were active, what topics appeared in screen text, the last Tinker-classified goal, and how many nudges fired this session. A new session starts on app launch or after 20 minutes of no signal activity. Session state is persisted to a `sessions` table on rotation so history isn't lost.

#### Tier 2 — Long-Term Graph (persists indefinitely, edge-weighted)
An entity-relationship graph of apps, topics, and workflows as nodes with weighted edges (`co_occurs`, `follows`, `related_to`). Edges strengthen on repeated co-occurrence and decay every 10 minutes. **Anchor nodes** (apps or topics accessed ≥ 30 times) are protected from decay and pruning — they represent stable, domain-defining patterns. `buildContextPrompt()` surfaces core anchored apps, stable workflows, and domain topics for LLM injection.

#### Tier 3 — User Profile (persists indefinitely, updated from feedback)
Inferred behavioral profile updated every 5th nudge feedback event: preferred response depth (hint / detail / deep_dive based on which tier gets the highest engagement), active hours, domain keywords, and nudge acceptance rate. Read by `buildContextPrompt()` to personalize the context block sent to Tinker and Perplexity.

### Intent Layer

**`TinkerIntentProvider`** (`src/main/llm/tinker.ts`) calls a fine-tuned intent classification model via the Tinker platform. Returns:

```json
{ "goal": "...", "task_type": "...", "confidence": 0.0–1.0, "suggested_tier": "hint|detail|deep_dive" }
```

**Hard gate** — if the Tinker key is missing, unreachable, confidence < 0.5, or response can't be parsed, the nudge is suppressed. No Perplexity call is made.

The endpoint is assumed OpenAI-compatible (`/v1/chat/completions` with JSON mode). Confirm the actual URL and schema with Thinking Machines.

### Nudge Layer

**`TrustManager`** persists an adaptive trust score (0.0–1.0, starts 0.5) that sets the friction threshold for the pipeline gate. The response tier comes from Tinker's `suggested_tier`, not trust.

**`PerplexityActionProvider`** (`src/main/llm/perplexity.ts`) calls the Perplexity streaming API with a tier-matched system prompt and the classified goal injected. 30s timeout with `AbortController`. HTTP errors and timeouts surface in the overlay rather than silently hanging.

### UI

- **Overlay** (`#/toast`) — translucent frosted-glass card, always-on-top, bottom-right. Streaming response + citation hostnames + close button. Auto-hides after 30s.
- **Settings** (`#/settings`) — Tinker key/model/endpoint, Perplexity key/model, overlay opacity, theme, advanced options.

---

## Tech Stack (v2)

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
ACT requires a Tinker API key and hosted fine-tuned model endpoint from [Thinking Machines](https://thinkingmachin.es/). Without it, zero nudges fire. Configure in Settings after launch.

> **Note:** The default endpoint (`https://api.tinker.thinkingmachines.ai/v1/chat/completions`) is an assumption. Confirm the real endpoint before expecting this to work.

### Perplexity API (response generation — required)
ACT uses the [Perplexity API](https://www.perplexity.ai/) for streamed responses. API key with `sonar` model family access required.

```bash
set PERPLEXITY_API_KEY=your_key_here
```

---

## Setup (v2)

```bash
npm install
npm run rebuild        # rebuild native modules for current Electron ABI
```

```bash
set PERPLEXITY_API_KEY=your_key_here
npm run dev
```

App runs as a tray icon. Double-click tray or right-click → Open Settings to configure API keys. `Ctrl+Shift+P` pauses/resumes.

---

## Known Limitations & Rough Edges

- **Tinker endpoint is unverified.** Assumed URL and request format may differ from what Thinking Machines provides. Check endpoint and auth header if classification always returns null.
- **No nudges without both keys.** No degraded fallback — if either key is missing/invalid the system is silent.
- **Signal tuning is rough.** Friction threshold, signal weights, and 0.5 confidence cutoff are first guesses. Expect noisy timing until calibrated.
- **Windows only.** `uiohook-napi` and `screenshot-desktop` are built for Windows. Mac/Linux untested.
- **OCR quality varies.** Tesseract is inconsistent on low-contrast or small text, which weakens intent classification.
- **Native modules must be rebuilt.** Run `npm run rebuild` after any Node/Electron version change. Failure emits a `degraded` warning and stops signal collection.
- **v1 PredictiveDesktopLayer build is broken.** The `Host` project has an unresolved namespace error. VL-JEPA model loading is stubbed. Not functional.

---

## Project Structure

```
PredictiveDesktopLayer/     # v1 — C#/.NET 8 action execution layer (broken build)
vljepafolder/               # v1 — Python FastAPI VL-JEPA inference server (Cloud Run GPU)

src/                        # v2 — current Electron app
  main/
    index.ts                # App entry, window management, IPC, tray
    pulse-engine.ts         # Sense → Weave → Intent → Nudge orchestrator
    signal-collector.ts
    friction-scorer.ts
    capturer.ts
    ocr.ts
    redact.ts
    context-fabric.ts
    trust-manager.ts
    llm/
      types.ts              # IntentProvider, ActionProvider interfaces
      tinker.ts             # TinkerIntentProvider
      perplexity.ts         # PerplexityActionProvider
      factory.ts            # buildProviders(settings)
  renderer/
    main.tsx                # NudgeOverlay + SettingsWindow (Tailwind)
    tailwind.css
  shared/
    types.ts                # All shared interfaces and IPC message types

tests/
  friction-scorer.test.ts
  trust-manager.test.ts
  context-fabric.test.ts
  redact.test.ts
  tinker-intent.test.ts
  pipeline-two-stage.test.ts
```

---

## IPC Reference (v2)

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
