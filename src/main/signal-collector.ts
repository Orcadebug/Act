import { uIOhook } from 'uiohook-napi';
import { EventEmitter } from 'events';
import { clipboard } from 'electron';
import pino from 'pino';
import { SignalSnapshot } from '../shared/types';

const logger = pino({ name: 'SignalCollector' });

// Keywords that suggest an error or warning dialog
const ERROR_KEYWORDS = [
  'error', 'warning', 'failed', 'exception', 'crash',
  'not responding', 'permission denied', 'access denied',
  'fatal', 'critical', 'unable to', 'cannot', 'could not'
];

/**
 * SignalCollector — Multi-signal behavioral monitor.
 * 
 * Instead of watching for a single "idle" event, this continuously
 * collects behavioral signals and emits rich SignalSnapshot objects.
 * Signals include typing cadence, app-switching, dwell time, scroll
 * velocity, clipboard cycles, and error dialog detection.
 */
export class SignalCollector extends EventEmitter {
  private intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private isPaused = false;

  // ── Keystroke tracking ──
  private keystrokeTimestamps: number[] = [];
  private readonly KEYSTROKE_WINDOW_MS = 10_000; // 10s rolling window

  // ── App-switch tracking ──
  private lastActiveApp = '';
  private lastActiveTitle = '';
  private appSwitchTimestamps: number[] = [];
  private readonly APP_SWITCH_WINDOW_MS = 30_000; // 30s window

  // ── Dwell tracking ──
  private lastMeaningfulInputTs = Date.now();

  // ── Scroll tracking ──
  private scrollTimestamps: number[] = [];
  private readonly SCROLL_WINDOW_MS = 10_000;

  // ── Clipboard tracking ──
  private clipboardHistory: string[] = [];
  private clipboardCycleTimestamps: number[] = [];
  private lastClipboardContent = '';
  private readonly CLIPBOARD_WINDOW_MS = 60_000;

  constructor(intervalMs = 2000) {
    super();
    this.intervalMs = intervalMs;
    this.setupHooks();
  }

  private setupHooks() {
    uIOhook.on('keydown', () => this.onKeystroke());
    uIOhook.on('mousemove', () => this.onMouseActivity());
    uIOhook.on('mousedown', () => this.onMeaningfulInput());
    uIOhook.on('wheel', () => this.onScroll());
  }

  private onKeystroke() {
    if (this.isPaused) return;
    const now = Date.now();
    this.keystrokeTimestamps.push(now);
    this.lastMeaningfulInputTs = now;
  }

  private onMouseActivity() {
    // Mouse movement counts as activity but not "meaningful input"
    // (user could be aimlessly moving mouse while stuck)
  }

  private onMeaningfulInput() {
    if (this.isPaused) return;
    this.lastMeaningfulInputTs = Date.now();
  }

  private onScroll() {
    if (this.isPaused) return;
    this.scrollTimestamps.push(Date.now());
  }

  public start() {
    try {
      uIOhook.start();
      logger.info('uIOhook input hooks started');
    } catch (e) {
      logger.error('Failed to start uIOhook (native module might not be built):', e);
    }

    this.timer = setInterval(() => this.collectSnapshot(), this.intervalMs);
    logger.info(`SignalCollector started (interval: ${this.intervalMs}ms)`);
  }

  public stop() {
    try { uIOhook.stop(); } catch {}
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('SignalCollector stopped');
  }

  public pause() { this.isPaused = true; }
  public resume() {
    this.isPaused = false;
    this.lastMeaningfulInputTs = Date.now();
  }

  /**
   * Called by PulseEngine with updated window info each cycle.
   * This lets us track app-switching without importing active-win here.
   */
  public updateActiveWindow(app: string, title: string) {
    if (app && app !== this.lastActiveApp) {
      this.appSwitchTimestamps.push(Date.now());
      this.lastActiveApp = app;
    }
    this.lastActiveTitle = title;
  }

  /**
   * Polls clipboard for changes and tracks cycling behavior.
   */
  private checkClipboard() {
    try {
      const current = clipboard.readText().substring(0, 200);
      if (current && current !== this.lastClipboardContent) {
        // Check if this content was seen recently (cycling)
        if (this.clipboardHistory.includes(current)) {
          this.clipboardCycleTimestamps.push(Date.now());
        }
        this.clipboardHistory.push(current);
        // Keep history bounded
        if (this.clipboardHistory.length > 20) {
          this.clipboardHistory = this.clipboardHistory.slice(-10);
        }
        this.lastClipboardContent = current;
      }
    } catch {
      // Clipboard access can fail
    }
  }

  /**
   * Prune timestamps older than the given window from an array.
   */
  private pruneOlderThan(arr: number[], windowMs: number): number[] {
    const cutoff = Date.now() - windowMs;
    return arr.filter(ts => ts > cutoff);
  }

  /**
   * Compute average inter-keystroke interval from recent keystrokes.
   * Higher values = more hesitation.
   */
  private computeTypingCadence(): number {
    this.keystrokeTimestamps = this.pruneOlderThan(
      this.keystrokeTimestamps,
      this.KEYSTROKE_WINDOW_MS
    );

    if (this.keystrokeTimestamps.length < 2) {
      return 0; // Not enough data — no typing detected
    }

    let totalInterval = 0;
    for (let i = 1; i < this.keystrokeTimestamps.length; i++) {
      totalInterval += this.keystrokeTimestamps[i] - this.keystrokeTimestamps[i - 1];
    }
    return totalInterval / (this.keystrokeTimestamps.length - 1);
  }

  /**
   * Count app switches within the tracking window.
   */
  private computeAppSwitchCount(): number {
    this.appSwitchTimestamps = this.pruneOlderThan(
      this.appSwitchTimestamps,
      this.APP_SWITCH_WINDOW_MS
    );
    return this.appSwitchTimestamps.length;
  }

  /**
   * Seconds since last meaningful input.
   */
  private computeDwellTime(): number {
    return (Date.now() - this.lastMeaningfulInputTs) / 1000;
  }

  /**
   * Scroll events per second over the tracking window.
   */
  private computeScrollVelocity(): number {
    this.scrollTimestamps = this.pruneOlderThan(
      this.scrollTimestamps,
      this.SCROLL_WINDOW_MS
    );
    return this.scrollTimestamps.length / (this.SCROLL_WINDOW_MS / 1000);
  }

  /**
   * Clipboard copy-paste cycles detected in the tracking window.
   */
  private computeClipboardCycles(): number {
    this.clipboardCycleTimestamps = this.pruneOlderThan(
      this.clipboardCycleTimestamps,
      this.CLIPBOARD_WINDOW_MS
    );
    return this.clipboardCycleTimestamps.length;
  }

  /**
   * Check if window title suggests an error dialog.
   */
  private detectErrorDialog(): boolean {
    const titleLower = this.lastActiveTitle.toLowerCase();
    return ERROR_KEYWORDS.some(kw => titleLower.includes(kw));
  }

  /**
   * Collect all signals into a snapshot and emit.
   */
  private collectSnapshot() {
    if (this.isPaused) return;

    this.checkClipboard();

    const snapshot: SignalSnapshot = {
      ts: Date.now(),
      typingCadenceMs: this.computeTypingCadence(),
      appSwitchCount: this.computeAppSwitchCount(),
      dwellTimeSec: this.computeDwellTime(),
      scrollVelocity: this.computeScrollVelocity(),
      clipboardCycles: this.computeClipboardCycles(),
      errorDialogDetected: this.detectErrorDialog(),
      activeApp: this.lastActiveApp,
      activeWindowTitle: this.lastActiveTitle,
    };

    this.emit('snapshot', snapshot);
  }
}
