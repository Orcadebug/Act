// ─── Pulse: Friction-Aware Desktop Intelligence ─── //

// ── Sense Layer ──

/** Raw behavioral signals collected every cycle */
export interface SignalSnapshot {
  ts: number;
  /** Average inter-keystroke interval in ms (higher = more hesitation) */
  typingCadenceMs: number;
  /** Number of app/window switches in the last 30s */
  appSwitchCount: number;
  /** Seconds spent on current window without meaningful input */
  dwellTimeSec: number;
  /** Scroll events per second in the last 10s */
  scrollVelocity: number;
  /** Number of clipboard read/write cycles in the last 60s */
  clipboardCycles: number;
  /** True if active window title contains error/warning keywords */
  errorDialogDetected: boolean;
  /** Name of the currently focused application */
  activeApp: string;
  /** Title of the currently focused window */
  activeWindowTitle: string;
}

/** Computed friction score from signal fusion */
export interface FrictionReading {
  ts: number;
  /** Overall friction 0.0 (total flow) → 1.0 (completely stuck) */
  score: number;
  /** Exponential moving average of recent scores */
  smoothedScore: number;
  /** Which signals contributed most, sorted by weight */
  contributors: { signal: keyof SignalSnapshot; contribution: number }[];
  /** Current adaptive threshold for this user */
  threshold: number;
}

// ── Weave Layer ──

export type NodeType = 'app' | 'topic' | 'workflow' | 'time_block';

export type EdgeRelation = 'co_occurs' | 'follows' | 'related_to';

/** Entity in the context graph */
export interface ContextNode {
  id: string;
  type: NodeType;
  label: string;
  firstSeen: number;
  lastSeen: number;
  accessCount: number;
}

/** Relationship between two context nodes */
export interface ContextEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relation: EdgeRelation;
  weight: number;
  lastSeen: number;
}

/** Compact context summary for LLM injection */
export interface ContextSummary {
  currentApp: string;
  currentTopic: string;
  relatedTopics: string[];
  recentWorkflow: string[];
  userPatterns: string;
  rawText: string;
}

// ── Nudge Layer ──

export type NudgeTier = 'hint' | 'detail' | 'deep_dive';

export type NudgeFeedbackType = 'engaged' | 'expanded' | 'dismissed' | 'ignored';

/** Assistance delivered to the user */
export interface Nudge {
  id: string;
  ts: number;
  tier: NudgeTier;
  frictionScore: number;
  trustAtDelivery: number;
  prompt: string;
  response: string;
  citations: string[];
  contextSummaryUsed: string;
  feedback: NudgeFeedbackType;
}

/** Trust profile — persisted across sessions */
export interface TrustProfile {
  score: number;
  totalNudges: number;
  engagedCount: number;
  expandedCount: number;
  dismissedCount: number;
  ignoredCount: number;
  lastUpdated: number;
}

export interface IntentResult {
  goal: string;
  task_type: string;
  confidence: number;
  suggested_tier: NudgeTier;
}

// ── Config ──

export interface PulseSettings {
  /** How often to collect signal snapshots (ms) */
  signalIntervalMs: number;
  /** Cooldown between nudges (ms) */
  nudgeCooldownMs: number;
  /** App allowlist for capture (empty = all) */
  captureAllowlist: string[];
  /** Tinker API key */
  tinkerApiKey: string;
  /** Tinker model name */
  tinkerModel: string;
  /** Tinker API endpoint */
  tinkerEndpoint: string;
  /** UI Theme for the settings window */
  theme: 'system' | 'light' | 'dark';
  /** Overlay background opacity (0.5–1.0) */
  overlayOpacity: number;
  /** Perplexity API key */
  perplexityApiKey: string;
  /** Perplexity model name */
  perplexityModel: string;
  /** Whether to retain screenshot files */
  screenshotRetention: boolean;
  /** Signal weights for friction scoring */
  signalWeights: SignalWeights;
  /** Context graph edge decay factor per hour (0.0–1.0) */
  edgeDecayRate: number;
  /** Minimum edge weight before pruning */
  edgePruneThreshold: number;
}

export interface SignalWeights {
  typingHesitation: number;
  appSwitching: number;
  dwellTime: number;
  scrollVelocity: number;
  clipboardCycling: number;
  errorDialog: number;
}

// ── IPC Messages ──

export interface NudgeUpdateMessage {
  type: 'stream' | 'complete' | 'error';
  nudgeId: string;
  text: string;
  done: boolean;
  citations?: string[];
  error?: string;
}

export interface NudgeFeedbackMessage {
  nudgeId: string;
  feedback: NudgeFeedbackType;
}
