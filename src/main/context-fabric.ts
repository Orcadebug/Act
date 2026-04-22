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
  SignalSnapshot,
} from '../shared/types';

const logger = pino({ name: 'ContextFabric' });

/**
 * ContextFabric — Graph-based contextual memory.
 *
 * Instead of a 3-tier hierarchical memory (profile / working / long-term),
 * this maintains a single fluid entity-relationship graph where importance
 * emerges naturally from connection strength and recency.
 *
 * Nodes represent entities (apps, topics, workflows, time blocks).
 * Edges represent relationships with weights that decay over time.
 * The graph self-prunes as edges weaken below threshold.
 */
export class ContextFabric {
  private db: Database.Database | null = null;
  private decayRate: number;
  private pruneThreshold: number;
  private decayTimer: NodeJS.Timeout | null = null;

  constructor(decayRate = 0.995, pruneThreshold = 0.01) {
    this.decayRate = decayRate;
    this.pruneThreshold = pruneThreshold;
    this.init();
  }

  private init() {
    try {
      const userDataPath = app.getPath('userData');
      const dbDir = path.join(userDataPath, 'Pulse');
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }
      const dbPath = path.join(dbDir, 'context.db');

      this.db = new Database(dbPath);
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

        CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
        CREATE INDEX IF NOT EXISTS idx_nodes_label ON nodes(label);
        CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
        CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
        CREATE INDEX IF NOT EXISTS idx_nudges_ts ON nudges(ts);
      `);

      // Start decay timer — runs every 10 minutes
      this.decayTimer = setInterval(() => this.decayAll(), 600_000);

      logger.info(`ContextFabric initialized at ${dbPath}`);
    } catch (e) {
      logger.error('Failed to initialize ContextFabric:', e);
    }
  }

  // ── Node Operations ──

  /**
   * Create or update a node. If it exists, increment access_count and update last_seen.
   */
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
          id: existing.id,
          type: existing.type as NodeType,
          label: existing.label,
          firstSeen: existing.first_seen,
          lastSeen: now,
          accessCount: existing.access_count + 1,
        };
      }

      this.db.prepare(
        `INSERT INTO nodes (id, type, label, first_seen, last_seen, access_count)
         VALUES (?, ?, ?, ?, ?, 1)`
      ).run(id, type, label, now, now);

      return { id, type, label, firstSeen: now, lastSeen: now, accessCount: 1 };
    } catch (e) {
      logger.error('Failed to touch node:', e);
      return null;
    }
  }

  /**
   * Create or strengthen an edge between two nodes.
   */
  public touchEdge(sourceId: string, targetId: string, relation: EdgeRelation): ContextEdge | null {
    if (!this.db) return null;

    const now = Date.now();
    const id = crypto.randomUUID();

    try {
      const existing = this.db.prepare(
        `SELECT * FROM edges WHERE source_id = ? AND target_id = ? AND relation = ?`
      ).get(sourceId, targetId, relation) as any;

      if (existing) {
        // Strengthen: add 0.2 weight, capped at 10.0
        const newWeight = Math.min(10.0, existing.weight + 0.2);
        this.db.prepare(
          `UPDATE edges SET weight = ?, last_seen = ? WHERE id = ?`
        ).run(newWeight, now, existing.id);
        return {
          id: existing.id,
          sourceId,
          targetId,
          relation,
          weight: newWeight,
          lastSeen: now,
        };
      }

      this.db.prepare(
        `INSERT INTO edges (id, source_id, target_id, relation, weight, last_seen)
         VALUES (?, ?, ?, ?, 1.0, ?)`
      ).run(id, sourceId, targetId, relation, now);

      return { id, sourceId, targetId, relation, weight: 1.0, lastSeen: now };
    } catch (e) {
      logger.error('Failed to touch edge:', e);
      return null;
    }
  }

  // ── Decay & Pruning ──

  /**
   * Apply temporal decay to all edge weights and prune weak edges.
   * This creates natural forgetting — unused connections fade away.
   */
  public decayAll() {
    if (!this.db) return;

    try {
      // Decay all weights
      this.db.prepare(
        `UPDATE edges SET weight = weight * ?`
      ).run(this.decayRate);

      // Prune edges below threshold
      const pruned = this.db.prepare(
        `DELETE FROM edges WHERE weight < ?`
      ).run(this.pruneThreshold);

      // Prune orphaned nodes (no edges and not seen in 7 days)
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      this.db.prepare(`
        DELETE FROM nodes WHERE id NOT IN (
          SELECT source_id FROM edges UNION SELECT target_id FROM edges
        ) AND last_seen < ?
      `).run(sevenDaysAgo);

      if ((pruned as any).changes > 0) {
        logger.info(`Decayed and pruned ${(pruned as any).changes} weak edges`);
      }
    } catch (e) {
      logger.error('Failed to run decay:', e);
    }
  }

  // ── Context Retrieval ──

  /**
   * Get the subgraph surrounding a specific app — its related topics,
   * common workflows, and frequently co-occurring apps.
   */
  public getContext(appName: string): ContextSummary {
    const empty: ContextSummary = {
      currentApp: appName,
      currentTopic: '',
      relatedTopics: [],
      recentWorkflow: [],
      userPatterns: '',
      rawText: '',
    };

    if (!this.db) return empty;

    try {
      // Find the app node
      const appNode = this.db.prepare(
        `SELECT * FROM nodes WHERE type = 'app' AND label = ?`
      ).get(appName) as any;

      if (!appNode) return { ...empty };

      // Get related topics (via edges, sorted by weight)
      const relatedTopics = this.db.prepare(`
        SELECT n.label, e.weight FROM edges e
        JOIN nodes n ON (
          (e.target_id = n.id AND e.source_id = ?) OR
          (e.source_id = n.id AND e.target_id = ?)
        )
        WHERE n.type = 'topic'
        ORDER BY e.weight DESC
        LIMIT 10
      `).all(appNode.id, appNode.id) as any[];

      // Get recent workflow (apps used in sequence, via 'follows' edges)
      const workflow = this.db.prepare(`
        SELECT n.label FROM edges e
        JOIN nodes n ON e.target_id = n.id
        WHERE e.source_id = ? AND e.relation = 'follows' AND n.type = 'app'
        ORDER BY e.last_seen DESC
        LIMIT 5
      `).all(appNode.id) as any[];

      // Get co-occurring apps
      const coApps = this.db.prepare(`
        SELECT n.label, e.weight FROM edges e
        JOIN nodes n ON (
          (e.target_id = n.id AND e.source_id = ?) OR
          (e.source_id = n.id AND e.target_id = ?)
        )
        WHERE n.type = 'app' AND n.label != ?
        ORDER BY e.weight DESC
        LIMIT 5
      `).all(appNode.id, appNode.id, appName) as any[];

      // Build user patterns description
      const patterns: string[] = [];
      if (appNode.access_count > 20) {
        patterns.push(`frequently uses ${appName}`);
      }
      if (coApps.length > 0) {
        patterns.push(`often uses ${appName} alongside ${coApps.map((a: any) => a.label).join(', ')}`);
      }

      return {
        currentApp: appName,
        currentTopic: relatedTopics[0]?.label || '',
        relatedTopics: relatedTopics.map((t: any) => t.label),
        recentWorkflow: workflow.map((w: any) => w.label),
        userPatterns: patterns.join('. '),
        rawText: '',
      };
    } catch (e) {
      logger.error('Failed to get context:', e);
      return empty;
    }
  }

  /**
   * Build a compact text summary of context for LLM injection.
   */
  public buildContextPrompt(context: ContextSummary): string {
    const parts: string[] = [];

    if (context.currentApp) {
      parts.push(`App: ${context.currentApp}`);
    }
    if (context.currentTopic) {
      parts.push(`Current topic: ${context.currentTopic}`);
    }
    if (context.relatedTopics.length > 0) {
      parts.push(`Related topics: ${context.relatedTopics.join(', ')}`);
    }
    if (context.recentWorkflow.length > 0) {
      parts.push(`Recent workflow: ${context.recentWorkflow.join(' → ')}`);
    }
    if (context.userPatterns) {
      parts.push(`User patterns: ${context.userPatterns}`);
    }

    return parts.join('\n');
  }

  // ── Topic Extraction ──

  /**
   * Lightweight keyword extraction from OCR text.
   * Extracts significant phrases based on frequency and length.
   * No ML required — simple TF-IDF-inspired approach.
   */
  public extractTopics(text: string): string[] {
    if (!text || text.length < 10) return [];

    // Common stop words to filter out
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

    // Tokenize and count
    const words = text.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.has(w));

    const freq = new Map<string, number>();
    for (const word of words) {
      freq.set(word, (freq.get(word) || 0) + 1);
    }

    // Return top keywords by frequency (min 2 occurrences)
    return Array.from(freq.entries())
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);
  }

  /**
   * Process a signal snapshot: touch app node, extract topics, create edges.
   */
  public ingestSnapshot(snapshot: SignalSnapshot, ocrText?: string) {
    if (!this.db) return;

    // Touch the app node
    const appNode = this.touchNode('app', snapshot.activeApp);
    if (!appNode) return;

    // Track app sequence (create 'follows' edges between consecutive apps)
    const recentApps = this.db.prepare(`
      SELECT DISTINCT n.id, n.label FROM nodes n
      WHERE n.type = 'app' AND n.last_seen > ? AND n.label != ?
      ORDER BY n.last_seen DESC LIMIT 1
    `).get(Date.now() - 60_000, snapshot.activeApp) as any;

    if (recentApps) {
      this.touchEdge(recentApps.id, appNode.id, 'follows');
    }

    // Extract and link topics if OCR text is available
    if (ocrText) {
      const topics = this.extractTopics(ocrText);
      for (const topicLabel of topics) {
        const topicNode = this.touchNode('topic', topicLabel);
        if (topicNode) {
          this.touchEdge(appNode.id, topicNode.id, 'related_to');
        }
      }
    }

    // Save compressed snapshot for replay
    try {
      this.db.prepare(
        `INSERT INTO snapshots (id, ts, data) VALUES (?, ?, ?)`
      ).run(crypto.randomUUID(), snapshot.ts, JSON.stringify(snapshot));
    } catch (e) {
      // Non-critical — just log
      logger.warn('Failed to save snapshot:', e);
    }

    // Prune old snapshots (keep last 24 hours)
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    try {
      this.db.prepare(`DELETE FROM snapshots WHERE ts < ?`).run(oneDayAgo);
    } catch {}
  }

  // ── Nudge Storage ──

  public saveNudge(nudge: Omit<Nudge, 'id'>): Nudge {
    const id = crypto.randomUUID();
    if (!this.db) return { id, ...nudge };

    try {
      this.db.prepare(`
        INSERT INTO nudges (id, ts, tier, friction_score, trust_at_delivery, prompt, response, citations, context_summary, feedback)
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
    } catch (e) {
      logger.error('Failed to update nudge feedback:', e);
    }
  }

  public getRecentNudges(limit = 10): Nudge[] {
    if (!this.db) return [];
    try {
      const rows = this.db.prepare(
        `SELECT * FROM nudges ORDER BY ts DESC LIMIT ?`
      ).all(limit) as any[];

      return rows.map(r => ({
        id: r.id,
        ts: r.ts,
        tier: r.tier,
        frictionScore: r.friction_score,
        trustAtDelivery: r.trust_at_delivery,
        prompt: r.prompt,
        response: r.response,
        citations: JSON.parse(r.citations || '[]'),
        contextSummaryUsed: r.context_summary,
        feedback: r.feedback,
      }));
    } catch (e) {
      logger.error('Failed to get recent nudges:', e);
      return [];
    }
  }

  // ── Graph Stats ──

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
    if (this.decayTimer) {
      clearInterval(this.decayTimer);
      this.decayTimer = null;
    }
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
