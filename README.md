# Pulse — Friction-Aware Desktop Intelligence

Pulse is a Windows desktop app that watches your behavior in real time, detects when you're stuck, and delivers a proactive AI-powered suggestion in a floating overlay — without you having to ask.

It monitors signals like typing hesitation, app-switching, dwell time, scroll velocity, clipboard cycling, and error dialogs. When those signals cross a threshold, it takes a screenshot, reads the screen with OCR, redacts PII, and asks the Perplexity API for the most useful next step given your context.

---

## How It Works

```
SignalCollector (every 2s)
        │  behavioral signals
        ▼
  FrictionScorer ──► FrictionReading (0.0 – 1.0)
        │
        ▼ friction above trust-adjusted threshold?
  TrustManager ──► gates nudge + picks response depth
        │
        ▼
    Capturer ──► screenshot + clipboard + active window
        │
        ▼
   OcrService ──► screen text (Tesseract.js)
        │
        ▼
   redactPII ──► strips emails, cards, long numbers
        │
        ▼
  ContextFabric ──► entity-relationship graph (SQLite)
        │              apps, topics, workflows, edges
        ▼
  NudgeResponder ──► Perplexity API (streaming, tiered depth)
        │
        ▼
   Toast overlay ──► user sees nudge, clicks feedback
        │
        ▼
  TrustManager ◄──── feedback updates trust score
  ContextFabric ◄─── nudge saved to history
```

---

## Architecture

### Sense Layer

**`SignalCollector`** hooks into global keyboard, mouse, and scroll events via `uiohook-napi`. Every 2 seconds it emits a `SignalSnapshot` containing:

| Signal | What it measures |
|---|---|
| `typingCadenceMs` | Average inter-keystroke interval (higher = more hesitation) |
| `appSwitchCount` | App/window switches in the last 30s |
| `dwellTimeSec` | Seconds on current window without meaningful input |
| `scrollVelocity` | Scroll events per second in the last 10s |
| `clipboardCycles` | Repeated clipboard copy-paste cycles in 60s |
| `errorDialogDetected` | Window title contains error/warning keywords |

**`FrictionScorer`** fuses those signals into a single score (0.0 = total flow, 1.0 = completely stuck) using:
- Configurable per-signal weights
- Exponential moving average (α = 0.3) for smoothing
- An adaptive 85th-percentile threshold that auto-calibrates to each user's normal behavior — a naturally frantic user gets a higher baseline so only truly unusual friction triggers nudges

### Weave Layer

**`ContextFabric`** maintains a SQLite graph of the user's activity:
- **Nodes**: apps, extracted topics, workflows, time blocks
- **Edges**: `co_occurs`, `follows`, `related_to` — weighted by frequency
- Edges strengthen (+0.2, capped at 10) on repeated co-occurrence and decay multiplicatively every 10 minutes. Edges below the prune threshold are deleted; orphaned nodes older than 7 days are garbage collected.
- Provides `getContext(appName)` → context summary injected into the LLM prompt
- Stores all nudges and their feedback for history and the dashboard

Topic extraction from OCR text uses a lightweight frequency-based keyword extractor (no ML needed). An optional Python sidecar (`python-sidecar/main.py`) implements a more sophisticated TF-IDF approach via stdin/stdout JSON lines — not yet wired into the main pipeline.

### Nudge Layer

**`TrustManager`** persists a trust score (0.0–1.0, starts at 0.5) across sessions via SQLite. It controls both the friction threshold required to trigger a nudge and the depth of the response:

| Trust | Friction threshold | Response depth |
|---|---|---|
| ≥ 0.8 | 0.40 (very proactive) | `deep_dive` |
| ≥ 0.6 | 0.50 | `deep_dive` |
| ≥ 0.3 | 0.65 | `detail` |
| < 0.3 | 0.85 (only obvious friction) | `hint` |

Feedback deltas: engaged +0.05 · expanded +0.08 · dismissed −0.03 · ignored −0.01. Score regresses toward 0.5 at 0.5%/hour to prevent runaway states.

**`NudgeResponder`** calls the Perplexity streaming API with a tier-matched system prompt and the user's context graph summary injected. Streams tokens back to the toast UI in real time.

### UI (Electron + React)

Two windows share a single Vite/React build with hash-based routing:

- **Toast overlay** (`#/toast`) — 380×420px, frameless, always-on-top, bottom-right corner. Shows the streaming nudge with a friction bar, tier label, and 4 feedback buttons (Helpful, More, Not now, ✕). Auto-hides after 30s if ignored.
- **Dashboard** (`#/`) — trust profile, live friction score, graph stats (nodes/edges/nudges), recent nudge history.
- **Settings** (`#/settings`) — all `PulseSettings` fields: signal interval, nudge cooldown, app allowlist, Perplexity API key + model, per-signal weights, edge decay parameters.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron 29 |
| Frontend | React 18, TypeScript |
| Build | Vite + vite-plugin-electron |
| Input hooks | uiohook-napi |
| OCR | Tesseract.js |
| Persistence | better-sqlite3 (WAL mode) |
| AI | Perplexity API (sonar model, streaming) |
| Logging | pino |
| Active window | active-win |
| Screenshots | screenshot-desktop |

---

## Setup

```bash
npm install
npm run rebuild        # rebuild native modules for current Electron ABI
```

Set your Perplexity API key either as an environment variable or in the Settings window after launch:

```bash
set PERPLEXITY_API_KEY=your_key_here
npm run dev
```

The app runs as a system tray icon. Double-click the tray icon to open the dashboard. `Ctrl+Shift+P` pauses/resumes monitoring.

---

## Project Structure

```
src/
  main/              # Electron main process
    index.ts         # App entry, window management, IPC handlers
    pulse-engine.ts  # SWN orchestrator
    signal-collector.ts
    friction-scorer.ts
    capturer.ts
    ocr.ts
    redact.ts
    context-fabric.ts
    trust-manager.ts
    perplexity.ts
  renderer/          # React UI (toast, dashboard, settings)
    main.tsx         # Entry + hash router
    toast.tsx        # NudgeCard overlay
    dashboard.tsx
    settings.tsx
  shared/
    types.ts         # All shared interfaces and IPC message types

python-sidecar/
  main.py            # Optional NLP topic extractor (stdin/stdout JSON lines, stdlib only)

tests/               # tsx-based tests (no framework, mocks electron via require intercept)
```

---

## IPC Reference

| Direction | Channel | Payload |
|---|---|---|
| main → renderer | `nudge-update` | `NudgeUpdateMessage` (streamed chunks) |
| main → renderer | `dashboard-data` | `{ trust, friction, graph }` |
| main → renderer | `settings-data` | `PulseSettings` |
| renderer → main | `nudge-feedback` | `NudgeFeedbackMessage` |
| renderer → main | `request-dashboard-data` | — |
| renderer → main | `request-settings` | — |

---

## Running Tests

```bash
npx tsx tests/friction-scorer.test.ts
npx tsx tests/trust-manager.test.ts
npx tsx tests/context-fabric.test.ts
npx tsx tests/redact.test.ts
```
