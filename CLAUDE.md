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

## Architecture: Sense → Weave → Nudge (SWN)

The entire system is orchestrated by `PulseEngine` (`src/main/pulse-engine.ts`), which wires together three layers:

### Sense Layer
- **`SignalCollector`** (`src/main/signal-collector.ts`) — hooks into global keyboard/mouse/scroll events via `uiohook-napi` and polls clipboard every 2s. Emits `SignalSnapshot` objects containing: typing cadence, app-switch count, dwell time, scroll velocity, clipboard cycles, and error dialog detection.
- **`FrictionScorer`** (`src/main/friction-scorer.ts`) — takes a `SignalSnapshot` and produces a `FrictionReading` (0.0–1.0). Uses weighted signal fusion with EMA smoothing and an adaptive 85th-percentile threshold that auto-calibrates to each user's baseline.

### Weave Layer
- **`ContextFabric`** (`src/main/context-fabric.ts`) — SQLite-backed entity-relationship graph. Nodes are apps, topics, workflows, and time blocks. Edges have weights that strengthen on repeated co-occurrence and decay every 10 minutes. Stores nudge history. Provides `getContext(appName)` and `buildContextPrompt()` for LLM injection.
- **`Capturer`** (`src/main/capturer.ts`) — takes a screenshot + reads clipboard + gets active window when a nudge is triggered.
- **`OcrService`** (`src/main/ocr.ts`) — runs Tesseract.js on the screenshot to extract screen text.
- **`redactPII`** (`src/main/redact.ts`) — strips emails, credit cards, and long numeric strings before sending to the API.

### Nudge Layer
- **`TrustManager`** (`src/main/trust-manager.ts`) — SQLite-backed adaptive trust score (0.0–1.0, starts at 0.5). User feedback adjusts the score: engaged +0.05, expanded +0.08, dismissed −0.03, ignored −0.01. Trust determines two things: (1) the friction threshold required to trigger a nudge, and (2) the response tier (hint / detail / deep_dive).
- **`NudgeResponder`** (`src/main/perplexity.ts`) — calls the Perplexity streaming API with a tier-appropriate system prompt and injected context. Streams chunks back to the UI via IPC.

### Renderer (React)
All renderer views share a single Vite/React entrypoint (`src/renderer/main.tsx`) using hash-based routing (`#/`, `#/settings`).

- **`NudgeCard`** (`src/renderer/toast.tsx`) — frameless, always-on-top overlay (bottom-right corner). Receives `nudge-update` IPC messages and streams text. 4 feedback buttons map to the 4 `NudgeFeedbackType` values.
- **`Dashboard`** (`src/renderer/dashboard.tsx`) — shows trust profile, current friction, graph stats, recent nudges.
- **`Settings`** (`src/renderer/settings.tsx`) — form for all `PulseSettings` fields, saved via `save-settings` IPC.

### IPC Contract
Main process sends: `nudge-update`, `dashboard-data`, `settings-data`
Renderer sends: `nudge-feedback`, `request-dashboard-data`, `request-settings`

All shared types (including IPC message shapes) live in `src/shared/types.ts`.

## Key Configuration

- **`captureAllowlist`** in `defaultSettings` (`src/main/index.ts`) — array of app name substrings that are allowed to trigger nudge capture. Empty = allow all.
- **`PERPLEXITY_API_KEY`** env var or `perplexityApiKey` in settings — required for nudge generation.
- **`nudgeCooldownMs`** — minimum gap between nudges (default 30s).
- **`INGEST_EVERY`** constant in `PulseEngine` — context graph is updated every 5 snapshots (every 10s) rather than every 2s cycle.

## Native Modules

`uiohook-napi`, `better-sqlite3`, `screenshot-desktop`, and `keytar` are native Node modules that must be rebuilt for the current Electron ABI after `npm install`. Run `npm run rebuild` if you see "was compiled against a different Node.js version" errors.

## Python Sidecar

`python-sidecar/main.py` is an optional stdin/stdout service for NLP-enhanced topic extraction. It requires no dependencies (stdlib only). The TypeScript `ContextFabric.extractTopics()` method serves as the built-in fallback and is currently the one in use — the sidecar is not yet wired up to `PulseEngine`.

## Test Structure

Tests in `tests/` mock `electron` and `better-sqlite3` via `Module.prototype.require` intercept at the top of each file. They run directly with `tsx` — no test framework. Each file prints `✓` lines and exits with code 1 on failure.
