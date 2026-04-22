# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Pulse** is an Electron desktop app that monitors behavioral signals to detect user friction (confusion, being stuck) and delivers proactive AI-powered nudges via a floating toast overlay. It uses the Perplexity API for response generation.

## Commands

```bash
# Install dependencies
npm install

# Rebuild native modules (required after install or Node/Electron version changes)
npm run rebuild

# Start in dev mode (Vite dev server + Electron)
npm run dev

# Build distributable
npm run build

# Run a single test file (tests use tsx directly, no test runner)
npx tsx tests/friction-scorer.test.ts
npx tsx tests/trust-manager.test.ts
npx tsx tests/context-fabric.test.ts
npx tsx tests/redact.test.ts
```

## Architecture: Sense → Weave → Intent → Nudge

The entire system is orchestrated by `PulseEngine` (`src/main/pulse-engine.ts`), which wires together three layers:

### Sense Layer
- **`SignalCollector`** (`src/main/signal-collector.ts`) — hooks into global keyboard/mouse/scroll events via `uiohook-napi` and polls clipboard every 2s. Emits `SignalSnapshot` objects containing: typing cadence, app-switch count, dwell time, scroll velocity, clipboard cycles, and error dialog detection.
- **`FrictionScorer`** (`src/main/friction-scorer.ts`) — takes a `SignalSnapshot` and produces a `FrictionReading` (0.0–1.0). Uses weighted signal fusion with EMA smoothing and an adaptive 85th-percentile threshold that auto-calibrates to each user's baseline.

### Weave Layer
- **`ContextFabric`** (`src/main/context-fabric.ts`) — SQLite-backed entity-relationship graph. Nodes are apps, topics, workflows, and time blocks. Edges have weights that strengthen on repeated co-occurrence and decay every 10 minutes. Stores nudge history. Provides `getContext(appName)` and `buildContextPrompt()` for LLM injection.
- **`Capturer`** (`src/main/capturer.ts`) — takes a screenshot + reads clipboard + gets active window when a nudge is triggered.
- **`OcrService`** (`src/main/ocr.ts`) — runs Tesseract.js on the screenshot to extract screen text.
- **`redactPII`** (`src/main/redact.ts`) — strips emails, credit cards, and long numeric strings before sending to the API.

### Intent Layer (NEW)
- **`TinkerIntentProvider`** (`src/main/llm/tinker.ts`) — calls the Tinker (Thinking Machines) fine-tuned model to classify user intent. Returns `{ goal, task_type, confidence, suggested_tier }`. Hard gate: if missing/failing, nudge is suppressed entirely.
- **`src/main/llm/factory.ts`** — `buildProviders(settings)` wires both providers from settings. Called in constructor and on `applySettings`.

### Nudge Layer
- **`TrustManager`** (`src/main/trust-manager.ts`) — SQLite-backed adaptive trust score (0.0–1.0, starts at 0.5). Still used for the friction gate threshold; `suggested_tier` now comes from Tinker intent, not trust.
- **`PerplexityActionProvider`** (`src/main/llm/perplexity.ts`) — calls the Perplexity streaming API (30s timeout, AbortController). Streams chunks back to the UI via IPC. Propagates HTTP errors as `error` events.

### Renderer (React)
Single Vite/React entrypoint (`src/renderer/main.tsx`) with Tailwind CSS. Hash-based routing:

- **`NudgeOverlay`** (`#/toast`) — Cluely-style translucent frosted-glass card, always-on-top, bottom-right. Shows ONLY the streaming Perplexity response + optional citation hostnames. Single close button. Auto-hides after 30s.
- **`SettingsWindow`** (`#/settings` or `#/`) — Tailwind-styled settings form: Tinker key/model/endpoint, Perplexity key/model, overlay opacity slider, theme toggle, advanced collapsible.

### IPC Contract
Main process sends: `nudge-update` (`{ type, nudgeId, text, done, citations?, error? }`), `settings-data`
Renderer sends: `nudge-feedback`, `request-settings`
Renderer invokes (handle): `save-settings` → returns `{ ok: true }`

All shared types (including IPC message shapes) live in `src/shared/types.ts`.

## Key Configuration

- **`tinkerApiKey`** / **`tinkerEndpoint`** — required; no nudges fire without a valid Tinker key.
- **`perplexityApiKey`** / **`PERPLEXITY_API_KEY`** env var — required for response generation.
- **`captureAllowlist`** — app name substrings allowed to trigger capture. Empty = allow all.
- **`nudgeCooldownMs`** — minimum gap between nudges (default 30s).
- **`overlayOpacity`** — overlay background opacity 0.5–1.0 (default 0.92).
- **`INGEST_EVERY`** constant in `PulseEngine` — context graph updated every 5 snapshots.

## Native Modules

`uiohook-napi`, `better-sqlite3`, `screenshot-desktop`, and `keytar` are native Node modules that must be rebuilt for the current Electron ABI after `npm install`. Run `npm run rebuild` if you see "was compiled against a different Node.js version" errors.

## Python Sidecar

`python-sidecar/main.py` is an optional stdin/stdout service for NLP-enhanced topic extraction. It requires no dependencies (stdlib only). The TypeScript `ContextFabric.extractTopics()` method serves as the built-in fallback and is currently the one in use — the sidecar is not yet wired up to `PulseEngine`.

## Test Structure

Tests in `tests/` mock `electron` and `better-sqlite3` via `Module.prototype.require` intercept at the top of each file. They run directly with `tsx` — no test framework. Each file prints `✓` lines and exits with code 1 on failure.
