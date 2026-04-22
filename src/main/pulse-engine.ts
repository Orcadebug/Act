import { SignalCollector } from './signal-collector';
import { FrictionScorer } from './friction-scorer';
import { Capturer } from './capturer';
import { OcrService } from './ocr';
import { redactPII } from './redact';
import { ContextFabric } from './context-fabric';
import { TrustManager } from './trust-manager';
import { NudgeResponder } from './perplexity';
import {
  PulseSettings,
  SignalSnapshot,
  FrictionReading,
  NudgeUpdateMessage,
  NudgeFeedbackType,
  NudgeTier,
} from '../shared/types';
import pino from 'pino';
import crypto from 'crypto';

const logger = pino({ name: 'PulseEngine' });

/**
 * PulseEngine — SWN Orchestrator.
 *
 * Runs the Sense → Weave → Nudge loop:
 *
 *   SignalCollector (every 2s) → SignalSnapshot
 *       ↓
 *   FrictionScorer → FrictionReading (0.0–1.0)
 *       ↓
 *   TrustManager gate: is friction above trust-adjusted threshold?
 *       ↓ (yes)
 *   Capturer → screenshot + clipboard + active window
 *       ↓
 *   OCR → screen text
 *       ↓
 *   Redact PII
 *       ↓
 *   ContextFabric → touch nodes/edges, build context summary
 *       ↓
 *   NudgeResponder → generate response (tiered by trust)
 *       ↓
 *   Toast UI → show nudge
 *       ↓
 *   User feedback → update trust + context graph
 */
export class PulseEngine {
  private collector: SignalCollector;
  private scorer: FrictionScorer;
  private capturer: Capturer;
  private ocr: OcrService;
  private fabric: ContextFabric;
  private trust: TrustManager;
  private responder: NudgeResponder;
  private settings: PulseSettings;
  private onNudgeUpdate: (data: NudgeUpdateMessage) => void;

  // ── Rate limiting ──
  private lastNudgeTs = 0;
  private isProcessing = false;

  // ── Snapshot counter for periodic context ingestion ──
  private snapshotCount = 0;
  private readonly INGEST_EVERY = 5; // Ingest context graph every N snapshots

  constructor(
    settings: PulseSettings,
    onNudgeUpdate: (data: NudgeUpdateMessage) => void
  ) {
    this.settings = settings;
    this.onNudgeUpdate = onNudgeUpdate;

    this.collector = new SignalCollector(settings.signalIntervalMs);
    this.scorer = new FrictionScorer(settings.signalWeights);
    this.capturer = new Capturer();
    this.ocr = new OcrService();
    this.fabric = new ContextFabric(settings.edgeDecayRate, settings.edgePruneThreshold);
    this.trust = new TrustManager();
    this.responder = new NudgeResponder(settings.perplexityApiKey, settings.perplexityModel);
  }

  public async start() {
    await this.ocr.init();

    // Wire up signal collection → friction scoring → nudge pipeline
    this.collector.on('snapshot', (snapshot: SignalSnapshot) => {
      this.handleSnapshot(snapshot);
    });

    this.collector.start();
    logger.info('PulseEngine started');
  }

  public stop() {
    this.collector.stop();
    this.ocr.terminate();
    this.fabric.close();
    this.trust.close();
    logger.info('PulseEngine stopped');
  }

  public pause() {
    this.collector.pause();
    logger.info('PulseEngine paused');
  }

  public resume() {
    this.collector.resume();
    logger.info('PulseEngine resumed');
  }

  /**
   * Handle each signal snapshot from the collector.
   */
  private async handleSnapshot(snapshot: SignalSnapshot) {
    // Update collector with active window info
    try {
      const activeWin = await import('active-win');
      const win = await activeWin.default();
      if (win) {
        const appName = win.owner?.name || 'UnknownApp';
        const title = win.title || '';
        this.collector.updateActiveWindow(appName, title);
        snapshot.activeApp = appName;
        snapshot.activeWindowTitle = title;
      }
    } catch {
      // active-win might not be available
    }

    // Score friction
    const reading = this.scorer.score(snapshot);

    // Periodic context ingestion (not every snapshot — too expensive)
    this.snapshotCount++;
    if (this.snapshotCount % this.INGEST_EVERY === 0) {
      this.fabric.ingestSnapshot(snapshot);
    }

    // Check if we should nudge
    const now = Date.now();
    const cooldownOk = (now - this.lastNudgeTs) >= this.settings.nudgeCooldownMs;
    const frictionHigh = this.trust.shouldNudge(reading.smoothedScore);

    if (frictionHigh && cooldownOk && !this.isProcessing) {
      logger.info(
        `Friction ${reading.smoothedScore.toFixed(3)} exceeds threshold ` +
        `${this.trust.getFrictionThreshold().toFixed(3)} — triggering nudge`
      );
      this.triggerNudge(snapshot, reading);
    }
  }

  /**
   * Full nudge pipeline: capture → OCR → redact → context → respond → show.
   */
  private async triggerNudge(snapshot: SignalSnapshot, reading: FrictionReading) {
    this.isProcessing = true;
    this.lastNudgeTs = Date.now();

    try {
      // 1. Capture
      const captureResult = await this.capturer.capture();
      if (!captureResult) {
        this.isProcessing = false;
        return;
      }

      // Check allowlist
      if (this.settings.captureAllowlist.length > 0) {
        const allowed = this.settings.captureAllowlist.some(app =>
          captureResult.app.toLowerCase().includes(app.toLowerCase())
        );
        if (!allowed) {
          logger.info(`App ${captureResult.app} not in allowlist`);
          this.isProcessing = false;
          return;
        }
      }

      // 2. OCR
      let screenText = '';
      if (captureResult.screenshotBuffer) {
        screenText = await this.ocr.recognize(captureResult.screenshotBuffer);
      }

      // 3. Redact PII
      const redactedScreen = redactPII(screenText);
      const redactedClipboard = redactPII(captureResult.clipboardText);

      // 4. Ingest into context graph (with OCR text for topic extraction)
      this.fabric.ingestSnapshot(snapshot, redactedScreen);

      // 5. Build context summary
      const context = this.fabric.getContext(captureResult.app);
      context.rawText = redactedScreen.substring(0, 1500);
      const contextPrompt = this.fabric.buildContextPrompt(context);

      // 6. Determine nudge tier based on trust
      const tier = this.trust.getNudgeTier();
      const trustScore = this.trust.getScore();

      // 7. Build user question
      const topContributors = reading.contributors
        .slice(0, 3)
        .map(c => c.signal)
        .join(', ');

      const userQuestion = [
        `I'm using ${captureResult.app} (${captureResult.title}).`,
        redactedScreen ? `Screen content:\n---\n${redactedScreen.substring(0, 1500)}\n---` : '',
        redactedClipboard ? `Clipboard: ${redactedClipboard}` : '',
        `I seem to be experiencing friction (signals: ${topContributors}).`,
        `What's the most useful next step for me right now?`,
      ].filter(Boolean).join('\n');

      // 8. Generate response
      const nudgeId = crypto.randomUUID();

      const responseText = await this.responder.ask(
        userQuestion,
        tier,
        contextPrompt,
        (chunk) => {
          this.onNudgeUpdate({
            type: chunk.done ? 'complete' : 'stream',
            nudgeId,
            text: chunk.text,
            citations: chunk.citations,
            done: chunk.done,
            tier,
            frictionScore: reading.smoothedScore,
            trustScore,
          });
        }
      );

      // 9. Save nudge to context fabric
      this.fabric.saveNudge({
        ts: Date.now(),
        tier,
        frictionScore: reading.smoothedScore,
        trustAtDelivery: trustScore,
        prompt: userQuestion,
        response: responseText,
        citations: [],
        contextSummaryUsed: contextPrompt,
        feedback: 'ignored', // Default until user acts
      });

    } catch (e) {
      logger.error('Error during nudge pipeline:', e);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Handle user feedback on a nudge.
   */
  public handleNudgeFeedback(nudgeId: string, feedback: NudgeFeedbackType) {
    logger.info(`Nudge ${nudgeId}: feedback=${feedback}`);

    // Update trust score
    this.trust.recordFeedback(feedback);

    // Update nudge record
    this.fabric.updateNudgeFeedback(nudgeId, feedback);
  }

  // ── Accessors for UI ──

  public getTrustScore(): number {
    return this.trust.getScore();
  }

  public getTrustProfile() {
    return this.trust.getProfile();
  }

  public getGraphStats() {
    return this.fabric.getStats();
  }

  public getCurrentFriction(): number {
    return this.scorer.getCurrentSmoothedScore();
  }
}
