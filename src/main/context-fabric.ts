import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import fs from 'fs';
import pino from 'pino';
import crypto from 'crypto';
import {
  ContextNode,
  ContextEdge,
  ContextSummary,
  NodeType,
  EdgeRelation,
  Nudge,
  NudgeFeedbackType,
  NudgeTier,
  SignalSnapshot,
  SessionMemory,
  UserProfile,
} from '../shared/types';

const logger = pino({ name: 'ContextFabric' });

/**
 * ContextFabric — Three-tier hierarchical memory.
 *
 * Tier 1  SESSION     Active window (~20min). Resets on idle or restart.
 *                     Fast writes, not persisted across restarts.
 *
 * Tier 2  LONG-TERM   Edge-weighted graph of apps, topics, workflows.
 *                     Slow decay. High-access nodes (anchor nodes) are
 *                     protected from pruning. Persists across sessions.
 *
 * Tier 3  USER PROFILE Inferred preferences: preferred response depth,
 *                     active hours, domain keywords, acceptance rate.
 *                     Updated from nudge feedback history. Single row,
 *                     persists indefinitely.
 */
export class ContextFabric {
  private db: Database.Database | null = null;
  private decayRate: number;
  private pruneThreshold: number;
  private decayTimer: NodeJS.Timeout | null = null;

  // Tier 1 — in-memory session state
  private currentSessionId: string | null = null;
  private sessionApps: string[] = [];
  private sessionTopics: string[] = [];
  private sessionLastGoal = '';
  private sessionNudgeCount = 0;
  private lastSnapshotTs = 0;
  private readonly SESSION_IDLE_MS = 20 * 60 * 1000; // 20min idle = new session

  // Anchor threshold — nodes accessed this many times are protected from pruning
  private readonly ANCHOR_THRESHOLD = 30;

  constructor(decayRate = 0.995, pruneThreshold = 0.01) {
    this.decayRate = decayRate;
    this.pruneThreshold = pruneThreshold;
    this.init();
  }

  private init() {
    try {
      const userDataPath = app.getPath('userData');
      const dbDir = path.join(userDataPath, 'Pulse');
      if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

      this.db = new Database(path.join(dbDir, 'context.db'));
      this.db.pragma('journal_mode = WAL');

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS nodes (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          label TEXT NOT NULL,
          first_seen INTEGER NOT NULL,
          last_seen INTEGER NOT NULL,
          access_count INTEGER DEFAULT 1,
          UNIQUE(type, label)
        );

        CREATE TABLE IF NOT EXISTS edges (
          id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          relation TEXT NOT NULL,
          weight REAL DEFAULT 1.0,
          last_seen INTEGER NOT NULL,
          FOREIGN KEY(source_id) REFERENCES nodes(id),
          FOREIGN KEY(target_id) REFERENCES nodes(id),
          UNIQUE(source_id, target_id, relation)
        );

        CREATE TABLE IF NOT EXISTS snapshots (
          id TEXT PRIMARY KEY,
          ts INTEGER NOT NULL,
          data TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS nudges (
          id TEXT PRIMARY KEY,
          ts INTEGER NOT NULL,
          tier TEXT NOT NULL,
          friction_score REAL,
          trust_at_delivery REAL,
          prompt TEXT,
          response TEXT,
          citations TEXT,
          context_summary TEXT,
          feedback TEXT DEFAULT 'ignored'
        );

        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          start_ts INTEGER NOT NULL,
          end_ts INTEGER,
          apps TEXT NOT NULL DEFAULT '[]',
          topics TEXT NOT NULL DEFAULT '[]',
          last_goal TEXT NOT NULL DEFAULT '',
          nudge_count INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS user_profile (
          id INTEGER PRIMARY KEY DEFAULT 1,
          preferred_tier TEXT NOT NULL DEFAULT 'detail',
          active_hours TEXT NOT NULL DEFAULT '[]',
          domain_keywords TEXT NOT NULL DEFAULT '[]',
          nudge_acceptance_rate REAL DEFAULT 0.5,
          feedback_ratios TEXT NOT NULL DEFAULT '{"engaged":0,"expanded":0,"dismissed":0,"ignored":0}',
          last_updated INTEGER NOT NULL DEFAULT 0
        );

        INSERT OR IGNORE INTO user_profile (id) VALUES (1);

        CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
        CREATE INDEX IF NOT EXISTS idx_nodes_label ON nodes(label);
        CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
        CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
        CREATE INDEX IF NOT EXISTS idx_nudges_ts ON nudges(ts);
        CREATE INDEX IF NOT EXISTS idx_sessions_ts ON sessions(start_ts);
      `);

      this.decayTimer = setInterval(() => this.decayAll(), 600_000);
    } catch (e) {
      logger.error('Failed to initialize ContextFabric:', e);
    }
  }

  // ── Tier 1: Session Management ──────────────────────────────────────────

  public startSession() {
    this.currentSessionId = crypto.randomUUID();
    this.sessionApps = [];
    this.sessionTopics = [];
    this.sessionLastGoal = '';
    this.sessionNudgeCount = 0;
    this.lastSnapshotTs = Date.now();

    if (!this.db) return;
    try {
      this.db.prepare(
        `INSERT INTO sessions (id, start_ts, apps, topics, last_goal, nudge_count)
         VALUES (?, ?, '[]', '[]', '', 0)`
      ).run(this.currentSessionId, this.lastSnapshotTs);
      logger.info(`Session started: ${this.currentSessionId}`);
    } catch (e) {
      logger.error('Failed to persist session start:', e);
    }
  }

  public endSession() {
    if (!this.currentSessionId || !this.db) return;
    try {
      this.db.prepare(
        `UPDATE sessions SET end_ts = ?, apps = ?, topics = ?, last_goal = ?, nudge_count = ?
         WHERE id = ?`
      ).run(
        Date.now(),
        JSON.stringify(this.sessionApps),
        JSON.stringify(this.sessionTopics),
        this.sessionLastGoal,
        this.sessionNudgeCount,
        this.currentSessionId
      );
    } catch (e) {
      logger.error('Failed to persist session end:', e);
    }
    this.currentSessionId = null;
  }

  private maybeRotateSession() {
    const now = Date.now();
    if (this.lastSnapshotTs && (now - this.lastSnapshotTs) > this.SESSION_IDLE_MS) {
      logger.info('Session idle timeout — rotating session');
      this.endSession();
      this.startSession();
    }
    this.lastSnapshotTs = now;
  }

  private addToSession(app: string, topics: string[]) {
    if (!this.sessionApps.includes(app)) {
      this.sessionApps.push(app);
      if (this.sessionApps.length > 20) this.sessionApps = this.sessionApps.slice(-20);
    }
    for (const t of topics) {
      if (!this.sessionTopics.includes(t)) {
        this.sessionTopics.push(t);
        if (this.sessionTopics.length > 30) this.sessionTopics = this.sessionTopics.slice(-30);
      }
    }
  }

  public setSessionGoal(goal: string) {
    this.sessionLastGoal = goal;
  }

  public incrementSessionNudgeCount() {
    this.sessionNudgeCount++;
  }

  public getSessionMemory(): SessionMemory {
    return {
      id: this.currentSessionId ?? '',
      startTs: this.lastSnapshotTs,
      endTs: null,
      apps: [...this.sessionApps],
      topics: [...this.sessionTopics],
      lastGoal: this.sessionLastGoal,
      nudgeCount: this.sessionNudgeCount,
    };
  }

  // ── Tier 2: Long-term Graph ──────────────────────────────────────────────

  public touchNode(type: NodeType, label: string): ContextNode | null {
    if (!this.db || !label.trim()) return null;

    const now = Date.now();
    const id = crypto.randomUUID();

    try {
      const existing = this.db.prepare(
        `SELECT * FROM nodes WHERE type = ? AND label = ?`
      ).get(type, label) as any;

      if (existing) {
        this.db.prepare(
          `UPDATE nodes SET last_seen = ?, access_count = access_count + 1 WHERE id = ?`
        ).run(now, existing.id);
        return {
          id: existing.id, type: existing.type as NodeType, label: existing.label,
          firstSeen: existing.first_seen, lastSeen: now, accessCount: existing.access_count + 1,
        };
      }

      this.db.prepare(
        `INSERT INTO nodes (id, type, label, first_seen, last_seen, access_count) VALUES (?, ?, ?, ?, ?, 1)`
      ).run(id, type, label, now, now);
      return { id, type, label, firstSeen: now, lastSeen: now, accessCount: 1 };
    } catch (e) {
      logger.error('Failed to touch node:', e);
      return null;
    }
  }

  public touchEdge(sourceId: string, targetId: string, relation: EdgeRelation): ContextEdge | null {
    if (!this.db) return null;

    const now = Date.now();
    const id = crypto.randomUUID();

    try {
      const existing = this.db.prepare(
        `SELECT * FROM edges WHERE source_id = ? AND target_id = ? AND relation = ?`
      ).get(sourceId, targetId, relation) as any;

      if (existing) {
        const newWeight = Math.min(10.0, existing.weight + 0.2);
        this.db.prepare(`UPDATE edges SET weight = ?, last_seen = ? WHERE id = ?`).run(newWeight, now, existing.id);
        return { id: existing.id, sourceId, targetId, relation, weight: newWeight, lastSeen: now };
      }

      this.db.prepare(
        `INSERT INTO edges (id, source_id, target_id, relation, weight, last_seen) VALUES (?, ?, ?, ?, 1.0, ?)`
      ).run(id, sourceId, targetId, relation, now);
      return { id, sourceId, targetId, relation, weight: 1.0, lastSeen: now };
    } catch (e) {
      logger.error('Failed to touch edge:', e);
      return null;
    }
  }

  private decayAll() {
    if (!this.db) return;
    try {
      // Decay only edges where neither endpoint is an anchor node
      this.db.prepare(`
        UPDATE edges SET weight = weight * ?
        WHERE source_id NOT IN (SELECT id FROM nodes WHERE access_count >= ?)
          AND target_id NOT IN (SELECT id FROM nodes WHERE access_count >= ?)
      `).run(this.decayRate, this.ANCHOR_THRESHOLD, this.ANCHOR_THRESHOLD);

      // Prune weak edges (anchor-connected edges are never pruned above)
      const pruned = this.db.prepare(
        `DELETE FROM edges WHERE weight < ?`
      ).run(this.pruneThreshold);

      // Prune orphaned non-anchor nodes older than 7 days
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      this.db.prepare(`
        DELETE FROM nodes WHERE id NOT IN (
          SELECT source_id FROM edges UNION SELECT target_id FROM edges
        ) AND last_seen < ? AND access_count < ?
      `).run(sevenDaysAgo, this.ANCHOR_THRESHOLD);

      if ((pruned as any).changes > 0) {
        logger.info(`Decayed and pruned ${(pruned as any).changes} weak edges`);
      }
    } catch (e) {
      logger.error('Failed to run decay:', e);
    }
  }

  private getLongTermSummary(appName: string): {
    coreApps: string[];
    stableWorkflow: string[];
    domainTopics: string[];
  } {
    if (!this.db) return { coreApps: [], stableWorkflow: [], domainTopics: [] };

    try {
      // Core apps = anchor nodes (frequently accessed apps)
      const coreApps = (this.db.prepare(
        `SELECT label FROM nodes WHERE type = 'app' AND access_count >= ? ORDER BY access_count DESC LIMIT 8`
      ).all(this.ANCHOR_THRESHOLD) as any[]).map(r => r.label);

      // Stable workflow = edges with high weight between app nodes
      const workflowEdges = this.db.prepare(`
        SELECT n1.label as from_app, n2.label as to_app, e.weight
        FROM edges e
        JOIN nodes n1 ON e.source_id = n1.id
        JOIN nodes n2 ON e.target_id = n2.id
        WHERE n1.type = 'app' AND n2.type = 'app' AND e.relation = 'follows' AND e.weight > 2.0
        ORDER BY e.weight DESC LIMIT 5
      `).all() as any[];
      const stableWorkflow = workflowEdges.map(r => `${r.from_app} → ${r.to_app}`);

      // Domain topics = highest-access topic nodes
      const domainTopics = (this.db.prepare(
        `SELECT label FROM nodes WHERE type = 'topic' ORDER BY access_count DESC LIMIT 10`
      ).all() as any[]).map(r => r.label);

      return { coreApps, stableWorkflow, domainTopics };
    } catch (e) {
      logger.error('Failed to get long-term summary:', e);
      return { coreApps: [], stableWorkflow: [], domainTopics: [] };
    }
  }

  // ── Tier 3: User Profile ─────────────────────────────────────────────────

  public getUserProfile(): UserProfile {
    const defaults: UserProfile = {
      preferredTier: 'detail',
      activeHours: [],
      domainKeywords: [],
      nudgeAcceptanceRate: 0.5,
      feedbackRatios: { engaged: 0, expanded: 0, dismissed: 0, ignored: 0 },
      lastUpdated: 0,
    };

    if (!this.db) return defaults;

    try {
      const row = this.db.prepare(`SELECT * FROM user_profile WHERE id = 1`).get() as any;
      if (!row) return defaults;
      return {
        preferredTier: (row.preferred_tier as NudgeTier) ?? 'detail',
        activeHours: JSON.parse(row.active_hours || '[]'),
        domainKeywords: JSON.parse(row.domain_keywords || '[]'),
        nudgeAcceptanceRate: row.nudge_acceptance_rate ?? 0.5,
        feedbackRatios: JSON.parse(row.feedback_ratios || '{}'),
        lastUpdated: row.last_updated ?? 0,
      };
    } catch (e) {
      logger.error('Failed to get user profile:', e);
      return defaults;
    }
  }

  public refreshUserProfile() {
    if (!this.db) return;
    try {
      const nudges = this.db.prepare(
        `SELECT tier, feedback, ts FROM nudges ORDER BY ts DESC LIMIT 200`
      ).all() as any[];

      if (nudges.length === 0) return;

      const counts = { engaged: 0, expanded: 0, dismissed: 0, ignored: 0 };
      const tierAcceptance: Record<string, number> = { hint: 0, detail: 0, deep_dive: 0 };
      const tierTotal: Record<string, number> = { hint: 0, detail: 0, deep_dive: 0 };
      const hourCounts: Record<number, number> = {};

      for (const n of nudges) {
        const fb = n.feedback as NudgeFeedbackType;
        if (fb in counts) counts[fb as keyof typeof counts]++;

        const tier = n.tier as NudgeTier;
        if (tier in tierTotal) {
          tierTotal[tier]++;
          if (fb === 'engaged' || fb === 'expanded') tierAcceptance[tier]++;
        }

        if (fb === 'engaged' || fb === 'expanded') {
          const hour = new Date(n.ts).getHours();
          hourCounts[hour] = (hourCounts[hour] || 0) + 1;
        }
      }

      const total = nudges.length;
      const accepted = counts.engaged + counts.expanded;
      const acceptanceRate = total > 0 ? accepted / total : 0.5;

      // Preferred tier = the tier with the highest acceptance rate (min 3 samples)
      let bestTier: NudgeTier = 'detail';
      let bestRate = -1;
      for (const [tier, tot] of Object.entries(tierTotal)) {
        if (tot >= 3) {
          const rate = tierAcceptance[tier] / tot;
          if (rate > bestRate) { bestRate = rate; bestTier = tier as NudgeTier; }
        }
      }

      // Active hours = top 6 hours by accepted nudge count
      const activeHours = Object.entries(hourCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([h]) => parseInt(h));

      // Domain keywords from long-term graph
      const { domainTopics } = this.getLongTermSummary('');

      const ratios = {
        engaged: total > 0 ? counts.engaged / total : 0,
        expanded: total > 0 ? counts.expanded / total : 0,
        dismissed: total > 0 ? counts.dismissed / total : 0,
        ignored: total > 0 ? counts.ignored / total : 0,
      };

      this.db.prepare(`
        UPDATE user_profile SET
          preferred_tier = ?,
          active_hours = ?,
          domain_keywords = ?,
          nudge_acceptance_rate = ?,
          feedback_ratios = ?,
          last_updated = ?
        WHERE id = 1
      `).run(
        bestTier,
        JSON.stringify(activeHours),
        JSON.stringify(domainTopics.slice(0, 10)),
        acceptanceRate,
        JSON.stringify(ratios),
        Date.now()
      );

      logger.info(`User profile refreshed — preferred tier: ${bestTier}, acceptance: ${(acceptanceRate * 100).toFixed(0)}%`);
    } catch (e) {
      logger.error('Failed to refresh user profile:', e);
    }
  }

  // ── Context Building ─────────────────────────────────────────────────────

  public getContext(appName: string): ContextSummary {
    const empty: ContextSummary = {
      currentApp: appName, currentTopic: '', relatedTopics: [],
      recentWorkflow: [], userPatterns: '', rawText: '',
    };

    if (!this.db) return empty;

    try {
      const appNode = this.db.prepare(
        `SELECT * FROM nodes WHERE type = 'app' AND label = ?`
      ).get(appName) as any;

      if (!appNode) return { ...empty };

      const relatedTopics = (this.db.prepare(`
        SELECT n.label, e.weight FROM edges e
        JOIN nodes n ON (
          (e.target_id = n.id AND e.source_id = ?) OR
          (e.source_id = n.id AND e.target_id = ?)
        )
        WHERE n.type = 'topic' ORDER BY e.weight DESC LIMIT 10
      `).all(appNode.id, appNode.id) as any[]).map(r => r.label);

      const workflow = (this.db.prepare(`
        SELECT n.label FROM edges e
        JOIN nodes n ON e.target_id = n.id
        WHERE e.source_id = ? AND e.relation = 'follows' AND n.type = 'app'
        ORDER BY e.last_seen DESC LIMIT 5
      `).all(appNode.id) as any[]).map(r => r.label);

      const coApps = (this.db.prepare(`
        SELECT n.label, e.weight FROM edges e
        JOIN nodes n ON (
          (e.target_id = n.id AND e.source_id = ?) OR
          (e.source_id = n.id AND e.target_id = ?)
        )
        WHERE n.type = 'app' AND n.label != ? ORDER BY e.weight DESC LIMIT 5
      `).all(appNode.id, appNode.id, appName) as any[]).map(r => r.label);

      const patterns: string[] = [];
      if (appNode.access_count >= this.ANCHOR_THRESHOLD) patterns.push(`frequently uses ${appName}`);
      if (coApps.length > 0) patterns.push(`often uses ${appName} alongside ${coApps.join(', ')}`);

      return {
        currentApp: appName,
        currentTopic: relatedTopics[0] ?? '',
        relatedTopics,
        recentWorkflow: workflow,
        userPatterns: patterns.join('. '),
        rawText: '',
      };
    } catch (e) {
      logger.error('Failed to get context:', e);
      return empty;
    }
  }

  /**
   * Builds a structured 3-tier context prompt for LLM injection.
   * Tier 1 (session) is most immediate; Tier 3 (profile) gives background.
   */
  public buildContextPrompt(context: ContextSummary): string {
    const session = this.getSessionMemory();
    const { coreApps, stableWorkflow, domainTopics } = this.getLongTermSummary(context.currentApp);
    const profile = this.getUserProfile();

    const sections: string[] = [];

    // Tier 1 — Session
    const sessionLines: string[] = [`[SESSION — current window]`];
    sessionLines.push(`Current app: ${context.currentApp}`);
    if (session.apps.length > 1) {
      sessionLines.push(`Apps this session: ${session.apps.join(' → ')}`);
    }
    if (session.topics.length > 0) {
      sessionLines.push(`Topics this session: ${session.topics.slice(0, 8).join(', ')}`);
    }
    if (session.lastGoal) {
      sessionLines.push(`Last classified goal: ${session.lastGoal}`);
    }
    if (session.nudgeCount > 0) {
      sessionLines.push(`Nudges this session: ${session.nudgeCount}`);
    }
    sections.push(sessionLines.join('\n'));

    // Tier 2 — Long-term patterns
    const ltLines: string[] = [`[LONG-TERM PATTERNS]`];
    if (context.relatedTopics.length > 0) {
      ltLines.push(`Related topics: ${context.relatedTopics.join(', ')}`);
    }
    if (context.recentWorkflow.length > 0) {
      ltLines.push(`Recent workflow: ${context.recentWorkflow.join(' → ')}`);
    }
    if (coreApps.length > 0) {
      ltLines.push(`Core apps: ${coreApps.join(', ')}`);
    }
    if (stableWorkflow.length > 0) {
      ltLines.push(`Stable workflows: ${stableWorkflow.join(' | ')}`);
    }
    if (domainTopics.length > 0) {
      ltLines.push(`Domain: ${domainTopics.slice(0, 6).join(', ')}`);
    }
    if (ltLines.length > 1) sections.push(ltLines.join('\n'));

    // Tier 3 — User profile
    const profileLines: string[] = [`[USER PROFILE]`];
    profileLines.push(`Preferred depth: ${profile.preferredTier.replace('_', ' ')}`);
    profileLines.push(`Acceptance rate: ${(profile.nudgeAcceptanceRate * 100).toFixed(0)}%`);
    if (profile.activeHours.length > 0) {
      const hourStr = profile.activeHours.map(h => `${h}:00`).join(', ');
      profileLines.push(`Most active: ${hourStr}`);
    }
    if (profile.domainKeywords.length > 0) {
      profileLines.push(`Domain focus: ${profile.domainKeywords.slice(0, 5).join(', ')}`);
    }
    sections.push(profileLines.join('\n'));

    return sections.join('\n\n');
  }

  // ── Snapshot Ingestion ───────────────────────────────────────────────────

  public extractTopics(text: string): string[] {
    if (!text || text.length < 10) return [];

    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
      'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
      'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
      'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
      'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
      'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
      'same', 'so', 'than', 'too', 'very', 'just', 'but', 'and', 'or',
      'if', 'this', 'that', 'these', 'those', 'it', 'its', 'my', 'your',
      'file', 'new', 'open', 'close', 'save', 'edit', 'view', 'help',
      'menu', 'click', 'button', 'window', 'tab', 'page',
    ]);

    const words = text.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.has(w));

    const freq = new Map<string, number>();
    for (const word of words) freq.set(word, (freq.get(word) || 0) + 1);

    return Array.from(freq.entries())
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);
  }

  public ingestSnapshot(snapshot: SignalSnapshot, ocrText?: string) {
    if (!this.db) return;

    // Rotate session if idle too long
    this.maybeRotateSession();

    const appNode = this.touchNode('app', snapshot.activeApp);
    if (!appNode) return;

    // Track app sequence in long-term graph
    const recentApp = this.db.prepare(`
      SELECT DISTINCT n.id, n.label FROM nodes n
      WHERE n.type = 'app' AND n.last_seen > ? AND n.label != ?
      ORDER BY n.last_seen DESC LIMIT 1
    `).get(Date.now() - 60_000, snapshot.activeApp) as any;
    if (recentApp) this.touchEdge(recentApp.id, appNode.id, 'follows');

    // Extract topics and link in long-term graph + session
    const topics: string[] = [];
    if (ocrText) {
      topics.push(...this.extractTopics(ocrText));
      for (const topicLabel of topics) {
        const topicNode = this.touchNode('topic', topicLabel);
        if (topicNode) this.touchEdge(appNode.id, topicNode.id, 'related_to');
      }
    }

    // Update session tier 1
    this.addToSession(snapshot.activeApp, topics);

    // Save compressed snapshot (last 24h only)
    try {
      this.db.prepare(
        `INSERT INTO snapshots (id, ts, data) VALUES (?, ?, ?)`
      ).run(crypto.randomUUID(), snapshot.ts, JSON.stringify(snapshot));
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      this.db.prepare(`DELETE FROM snapshots WHERE ts < ?`).run(oneDayAgo);
    } catch (e) {
      logger.warn('Failed to save snapshot:', e);
    }
  }

  // ── Nudge Storage ────────────────────────────────────────────────────────

  public saveNudge(nudge: Omit<Nudge, 'id'>): Nudge {
    const id = crypto.randomUUID();
    if (!this.db) return { id, ...nudge };

    try {
      this.db.prepare(`
        INSERT OR IGNORE INTO nudges
          (id, ts, tier, friction_score, trust_at_delivery, prompt, response, citations, context_summary, feedback)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, nudge.ts, nudge.tier, nudge.frictionScore, nudge.trustAtDelivery,
        nudge.prompt, nudge.response, JSON.stringify(nudge.citations),
        nudge.contextSummaryUsed, nudge.feedback
      );
    } catch (e) {
      logger.error('Failed to save nudge:', e);
    }

    return { id, ...nudge };
  }

  public updateNudgeFeedback(nudgeId: string, feedback: NudgeFeedbackType) {
    if (!this.db) return;
    try {
      this.db.prepare(`UPDATE nudges SET feedback = ? WHERE id = ?`).run(feedback, nudgeId);
      // Refresh user profile after every 5th feedback
      const count = (this.db.prepare(`SELECT COUNT(*) as c FROM nudges WHERE feedback != 'ignored'`).get() as any).c;
      if (count % 5 === 0) this.refreshUserProfile();
    } catch (e) {
      logger.error('Failed to update nudge feedback:', e);
    }
  }

  public getRecentNudges(limit = 10): Nudge[] {
    if (!this.db) return [];
    try {
      return (this.db.prepare(
        `SELECT * FROM nudges ORDER BY ts DESC LIMIT ?`
      ).all(limit) as any[]).map(r => ({
        id: r.id, ts: r.ts, tier: r.tier,
        frictionScore: r.friction_score, trustAtDelivery: r.trust_at_delivery,
        prompt: r.prompt, response: r.response,
        citations: JSON.parse(r.citations || '[]'),
        contextSummaryUsed: r.context_summary, feedback: r.feedback,
      }));
    } catch (e) {
      logger.error('Failed to get recent nudges:', e);
      return [];
    }
  }

  // ── Stats ────────────────────────────────────────────────────────────────

  public getStats() {
    if (!this.db) return { nodes: 0, edges: 0, nudges: 0 };
    try {
      const nodes = (this.db.prepare(`SELECT COUNT(*) as c FROM nodes`).get() as any).c;
      const edges = (this.db.prepare(`SELECT COUNT(*) as c FROM edges`).get() as any).c;
      const nudges = (this.db.prepare(`SELECT COUNT(*) as c FROM nudges`).get() as any).c;
      return { nodes, edges, nudges };
    } catch {
      return { nodes: 0, edges: 0, nudges: 0 };
    }
  }

  public close() {
    this.endSession();
    if (this.decayTimer) { clearInterval(this.decayTimer); this.decayTimer = null; }
    if (this.db) { this.db.close(); this.db = null; }
  }
}
