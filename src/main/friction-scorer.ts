import pino from 'pino';
import {
  SignalSnapshot,
  FrictionReading,
  SignalWeights,
} from '../shared/types';

const logger = pino({ name: 'FrictionScorer' });

/**
 * Default signal weights — tunable per-user or via settings.
 * These determine how much each behavioral signal contributes
 * to the overall friction score.
 */
const DEFAULT_WEIGHTS: SignalWeights = {
  typingHesitation: 0.25,
  appSwitching: 0.25,
  dwellTime: 0.20,
  scrollVelocity: 0.10,
  clipboardCycling: 0.10,
  errorDialog: 0.10,
};

/**
 * FrictionScorer — Weighted signal fusion algorithm.
 *
 * Takes raw SignalSnapshot and produces a continuous friction score
 * (0.0 = total flow, 1.0 = completely stuck). Uses exponential moving
 * average for smoothing and maintains an adaptive threshold that
 * learns each user's baseline behavior.
 *
 * This is fundamentally different from a trained intent classifier —
 * it's a signal-processing approach with no ML training needed.
 */
export class FrictionScorer {
  private weights: SignalWeights;

  // ── EMA smoothing ──
  private emaScore = 0;
  private readonly EMA_ALPHA = 0.3; // Higher = more responsive to new readings

  // ── Adaptive threshold ──
  private recentScores: number[] = [];
  private readonly THRESHOLD_WINDOW = 150; // ~5 minutes at 2s intervals
  private adaptiveThreshold = 0.65; // Starting threshold

  // ── Normalization baselines ──
  // These define what "maximum friction" looks like for each signal.
  // Signals are normalized to 0.0–1.0 relative to these ceilings.
  private readonly TYPING_HESITATION_CEIL_MS = 2000;  // 2s between keystrokes = max hesitation
  private readonly APP_SWITCH_CEIL = 8;               // 8 switches in 30s = max thrashing
  private readonly DWELL_CEIL_SEC = 30;               // 30s without input = max dwell
  private readonly SCROLL_VELOCITY_CEIL = 5;          // 5 scroll/sec = max frantic scrolling
  private readonly CLIPBOARD_CYCLE_CEIL = 4;          // 4 cycles in 60s = max cycling

  constructor(weights?: SignalWeights) {
    this.weights = weights || { ...DEFAULT_WEIGHTS };
  }

  public updateWeights(weights: SignalWeights) {
    this.weights = { ...weights };
  }

  /**
   * Score a signal snapshot and return a friction reading.
   */
  public score(snapshot: SignalSnapshot): FrictionReading {
    const components = this.computeComponents(snapshot);

    // Weighted sum
    let rawScore = 0;
    const contributors: { signal: keyof SignalSnapshot; contribution: number }[] = [];

    for (const comp of components) {
      const weighted = comp.normalized * comp.weight;
      rawScore += weighted;
      contributors.push({
        signal: comp.signalKey,
        contribution: weighted,
      });
    }

    // Clamp to 0–1
    rawScore = Math.max(0, Math.min(1, rawScore));

    // Apply EMA smoothing
    this.emaScore = this.EMA_ALPHA * rawScore + (1 - this.EMA_ALPHA) * this.emaScore;

    // Update adaptive threshold
    this.recentScores.push(rawScore);
    if (this.recentScores.length > this.THRESHOLD_WINDOW) {
      this.recentScores = this.recentScores.slice(-this.THRESHOLD_WINDOW);
    }
    this.adaptiveThreshold = this.computeAdaptiveThreshold();

    // Sort contributors by contribution descending
    contributors.sort((a, b) => b.contribution - a.contribution);

    const reading: FrictionReading = {
      ts: snapshot.ts,
      score: rawScore,
      smoothedScore: this.emaScore,
      contributors,
      threshold: this.adaptiveThreshold,
    };

    return reading;
  }

  /**
   * Check if the current smoothed friction exceeds the adaptive threshold.
   */
  public isAboveThreshold(): boolean {
    return this.emaScore >= this.adaptiveThreshold;
  }

  /**
   * Get the current smoothed score without processing a new snapshot.
   */
  public getCurrentSmoothedScore(): number {
    return this.emaScore;
  }

  /**
   * Compute the adaptive threshold using the 85th percentile of recent scores.
   * This means the threshold auto-adjusts to each user's normal behavior.
   * A user who is always somewhat frantic will have a higher baseline,
   * so only truly unusual friction triggers nudges.
   */
  private computeAdaptiveThreshold(): number {
    if (this.recentScores.length < 10) {
      return 0.65; // Not enough data yet, use default
    }

    const sorted = [...this.recentScores].sort((a, b) => a - b);
    const p85Index = Math.floor(sorted.length * 0.85);
    const p85 = sorted[p85Index];

    // Clamp threshold between reasonable bounds
    return Math.max(0.4, Math.min(0.9, p85));
  }

  /**
   * Normalize each signal to 0.0–1.0 and pair with its weight.
   */
  private computeComponents(snapshot: SignalSnapshot): {
    signalKey: keyof SignalSnapshot;
    normalized: number;
    weight: number;
  }[] {
    return [
      {
        signalKey: 'typingCadenceMs' as keyof SignalSnapshot,
        normalized: this.normalizeTypingHesitation(snapshot.typingCadenceMs),
        weight: this.weights.typingHesitation,
      },
      {
        signalKey: 'appSwitchCount' as keyof SignalSnapshot,
        normalized: this.normalizeLinear(snapshot.appSwitchCount, this.APP_SWITCH_CEIL),
        weight: this.weights.appSwitching,
      },
      {
        signalKey: 'dwellTimeSec' as keyof SignalSnapshot,
        normalized: this.normalizeLinear(snapshot.dwellTimeSec, this.DWELL_CEIL_SEC),
        weight: this.weights.dwellTime,
      },
      {
        signalKey: 'scrollVelocity' as keyof SignalSnapshot,
        normalized: this.normalizeLinear(snapshot.scrollVelocity, this.SCROLL_VELOCITY_CEIL),
        weight: this.weights.scrollVelocity,
      },
      {
        signalKey: 'clipboardCycles' as keyof SignalSnapshot,
        normalized: this.normalizeLinear(snapshot.clipboardCycles, this.CLIPBOARD_CYCLE_CEIL),
        weight: this.weights.clipboardCycling,
      },
      {
        signalKey: 'errorDialogDetected' as keyof SignalSnapshot,
        normalized: snapshot.errorDialogDetected ? 1.0 : 0.0,
        weight: this.weights.errorDialog,
      },
    ];
  }

  /**
   * Typing hesitation uses a non-linear curve:
   * - 0–150ms cadence = 0.0 (fast, fluid typing)
   * - 150–500ms = gradual ramp (some hesitation)
   * - 500–2000ms = steep ramp (significant hesitation)
   * - 0ms (no typing) = 0.0 (absence of data ≠ friction)
   */
  private normalizeTypingHesitation(cadenceMs: number): number {
    if (cadenceMs <= 0) return 0; // No typing detected
    if (cadenceMs <= 150) return 0;
    if (cadenceMs >= this.TYPING_HESITATION_CEIL_MS) return 1.0;

    // Sigmoid-ish curve between 150 and ceiling
    const range = this.TYPING_HESITATION_CEIL_MS - 150;
    const position = (cadenceMs - 150) / range;
    return position * position; // Quadratic for steeper ramp at high values
  }

  /**
   * Simple linear normalization clamped to 0–1.
   */
  private normalizeLinear(value: number, ceiling: number): number {
    if (value <= 0) return 0;
    return Math.min(1.0, value / ceiling);
  }
}
