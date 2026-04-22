import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import fs from 'fs';
import pino from 'pino';
import { TrustProfile, NudgeFeedbackType, NudgeTier } from '../shared/types';

const logger = pino({ name: 'TrustManager' });

/**
 * TrustManager — Adaptive trust scoring.
 *
 * Manages a rolling trust score (0.0–1.0) that gates nudge behavior.
 * Higher trust = more proactive (lower friction threshold to show nudges).
 * Lower trust = more conservative (only show when obviously stuck).
 *
 * The trust score adjusts based on user feedback on nudges:
 * - Engaged (+0.05)  → user found it useful
 * - Expanded (+0.08) → user wanted more detail
 * - Dismissed (-0.03) → user didn't want it
 * - Ignored (-0.01)  → mild penalty (they might not have seen it)
 *
 * Natural regression toward 0.5 prevents runaway scores.
 * Persisted across sessions via SQLite.
 */
export class TrustManager {
  private db: Database.Database | null = null;
  private profile: TrustProfile;

  // ── Feedback deltas ──
  private readonly DELTAS: Record<NudgeFeedbackType, number> = {
    engaged: 0.05,
    expanded: 0.08,
    dismissed: -0.03,
    ignored: -0.01,
  };

  // ── Regression rate toward 0.5 per hour ──
  private readonly REGRESSION_RATE = 0.005;
  private regressionTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.profile = {
      score: 0.5,
      totalNudges: 0,
      engagedCount: 0,
      expandedCount: 0,
      dismissedCount: 0,
      ignoredCount: 0,
      lastUpdated: Date.now(),
    };
    this.init();
  }

  private init() {
    try {
      const userDataPath = app.getPath('userData');
      const dbDir = path.join(userDataPath, 'Pulse');
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }
      const dbPath = path.join(dbDir, 'trust.db');

      this.db = new Database(dbPath);
      this.db.pragma('journal_mode = WAL');

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS trust_profile (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          score REAL DEFAULT 0.5,
          total_nudges INTEGER DEFAULT 0,
          engaged_count INTEGER DEFAULT 0,
          expanded_count INTEGER DEFAULT 0,
          dismissed_count INTEGER DEFAULT 0,
          ignored_count INTEGER DEFAULT 0,
          last_updated INTEGER
        );
      `);

      // Load or create
      const existing = this.db.prepare(`SELECT * FROM trust_profile WHERE id = 1`).get() as any;
      if (existing) {
        this.profile = {
          score: existing.score,
          totalNudges: existing.total_nudges,
          engagedCount: existing.engaged_count,
          expandedCount: existing.expanded_count,
          dismissedCount: existing.dismissed_count,
          ignoredCount: existing.ignored_count,
          lastUpdated: existing.last_updated,
        };
        logger.info(`Loaded trust profile: score=${this.profile.score.toFixed(3)}`);
      } else {
        this.db.prepare(`
          INSERT INTO trust_profile (id, score, total_nudges, engaged_count, expanded_count, dismissed_count, ignored_count, last_updated)
          VALUES (1, 0.5, 0, 0, 0, 0, 0, ?)
        `).run(Date.now());
        logger.info('Created new trust profile (score=0.500)');
      }

      // Start regression timer — regress toward 0.5 every hour
      this.regressionTimer = setInterval(() => this.regress(), 3_600_000);

    } catch (e) {
      logger.error('Failed to initialize TrustManager:', e);
    }
  }

  /**
   * Record user feedback on a nudge and adjust trust score.
   */
  public recordFeedback(feedback: NudgeFeedbackType) {
    const delta = this.DELTAS[feedback];
    this.profile.score = Math.max(0, Math.min(1, this.profile.score + delta));
    this.profile.totalNudges++;
    this.profile.lastUpdated = Date.now();

    switch (feedback) {
      case 'engaged':  this.profile.engagedCount++; break;
      case 'expanded': this.profile.expandedCount++; break;
      case 'dismissed': this.profile.dismissedCount++; break;
      case 'ignored':  this.profile.ignoredCount++; break;
    }

    this.persist();
    logger.info(`Trust updated: ${feedback} → score=${this.profile.score.toFixed(3)}`);
  }

  /**
   * Get the current trust score.
   */
  public getScore(): number {
    return this.profile.score;
  }

  /**
   * Get the full trust profile.
   */
  public getProfile(): TrustProfile {
    return { ...this.profile };
  }

  /**
   * Determine the friction threshold needed to trigger a nudge
   * based on current trust level.
   */
  public getFrictionThreshold(): number {
    const s = this.profile.score;
    if (s >= 0.8) return 0.40;  // High trust → very proactive
    if (s >= 0.6) return 0.50;  // Good trust → moderately proactive
    if (s >= 0.3) return 0.65;  // Neutral → normal threshold
    return 0.85;                // Low trust → only obvious friction
  }

  /**
   * Determine the response tier based on trust level.
   */
  public getNudgeTier(): NudgeTier {
    const s = this.profile.score;
    if (s >= 0.65) return 'deep_dive';
    if (s >= 0.35) return 'detail';
    return 'hint';
  }

  /**
   * Check if a given friction score should trigger a nudge,
   * considering the trust-adjusted threshold.
   */
  public shouldNudge(frictionScore: number): boolean {
    return frictionScore >= this.getFrictionThreshold();
  }

  /**
   * Natural regression toward 0.5 over time.
   * Prevents runaway high or low scores.
   */
  private regress() {
    const target = 0.5;
    const diff = target - this.profile.score;
    if (Math.abs(diff) < 0.001) return;

    this.profile.score += diff * this.REGRESSION_RATE;
    this.profile.lastUpdated = Date.now();
    this.persist();
  }

  private persist() {
    if (!this.db) return;
    try {
      this.db.prepare(`
        UPDATE trust_profile SET
          score = ?, total_nudges = ?, engaged_count = ?,
          expanded_count = ?, dismissed_count = ?, ignored_count = ?,
          last_updated = ?
        WHERE id = 1
      `).run(
        this.profile.score, this.profile.totalNudges,
        this.profile.engagedCount, this.profile.expandedCount,
        this.profile.dismissedCount, this.profile.ignoredCount,
        this.profile.lastUpdated
      );
    } catch (e) {
      logger.error('Failed to persist trust profile:', e);
    }
  }

  public close() {
    if (this.regressionTimer) {
      clearInterval(this.regressionTimer);
      this.regressionTimer = null;
    }
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
