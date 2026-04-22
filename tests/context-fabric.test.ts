import Module from 'module';
import path from 'path';

// Intercept electron and better-sqlite3 requires
const originalRequire = Module.prototype.require;

const mockStmts = new Map<string, any[]>();
let lastInsertedRow: any = null;

Module.prototype.require = function (id: string) {
  if (id === 'electron') {
    return {
      __esModule: true,
      app: { getPath: () => path.join(__dirname, '..', '.mock_user_data') },
      clipboard: { readText: () => 'mock clipboard' }
    };
  }
  if (id === 'better-sqlite3') {
    class MockDatabase {
      private tables: Record<string, any[]> = {};
      constructor(dbPath: string) { console.log(`  Mock DB at ${dbPath}`); }
      pragma() {}
      exec() {}
      close() {}
      prepare(sql: string) {
        const self = this;
        return {
          run: (...args: any[]) => {
            // Track inserts
            if (sql.includes('INSERT INTO nodes')) {
              lastInsertedRow = { id: args[0], type: args[1], label: args[2] };
            }
            return { changes: 0 };
          },
          get: (...args: any[]) => {
            // Simulate "not found" for fresh context graph
            return undefined;
          },
          all: (...args: any[]) => {
            return [];
          }
        };
      }
    }
    return MockDatabase;
  }
  return originalRequire.apply(this, [id]);
} as any;

import { ContextFabric } from '../src/main/context-fabric';

try {
  console.log('Testing ContextFabric...');

  const fabric = new ContextFabric(0.995, 0.01);

  // Test 1: Touch a new node
  const appNode = fabric.touchNode('app', 'VS Code');
  if (!appNode || !appNode.id) throw new Error('touchNode should return a node with id');
  console.log(`  ✓ Created app node: ${appNode.label} (${appNode.id.substring(0, 8)}...)`);

  // Test 2: Touch a topic node
  const topicNode = fabric.touchNode('topic', 'typescript');
  if (!topicNode) throw new Error('touchNode for topic failed');
  console.log(`  ✓ Created topic node: ${topicNode.label}`);

  // Test 3: Create an edge
  const edge = fabric.touchEdge(appNode.id, topicNode.id, 'related_to');
  if (!edge || edge.weight !== 1.0) throw new Error('touchEdge should return edge with weight 1.0');
  console.log(`  ✓ Created edge: ${appNode.label} → ${topicNode.label} (weight=${edge.weight})`);

  // Test 4: Topic extraction
  const topics = fabric.extractTopics(
    'async function handleError error handling typescript react component state management async await promise'
  );
  if (topics.length === 0) throw new Error('extractTopics should return some topics');
  console.log(`  ✓ Extracted topics: ${topics.join(', ')}`);

  // Test 5: Empty text → no topics
  const emptyTopics = fabric.extractTopics('');
  if (emptyTopics.length !== 0) throw new Error('Empty text should return no topics');
  console.log(`  ✓ Empty text → no topics`);

  // Test 6: Get context for unknown app returns empty
  const ctx = fabric.getContext('UnknownApp');
  if (ctx.currentApp !== 'UnknownApp') throw new Error('getContext should set currentApp');
  console.log(`  ✓ Context for unknown app: relatedTopics=${ctx.relatedTopics.length}`);

  // Test 7: Build context prompt
  const prompt = fabric.buildContextPrompt({
    currentApp: 'VS Code',
    currentTopic: 'typescript',
    relatedTopics: ['react', 'testing'],
    recentWorkflow: ['Chrome', 'VS Code'],
    userPatterns: 'frequently uses VS Code',
    rawText: '',
  });
  if (!prompt.includes('VS Code')) throw new Error('Context prompt should mention the app');
  if (!prompt.includes('typescript')) throw new Error('Context prompt should mention the topic');
  console.log(`  ✓ Context prompt: ${prompt.split('\n').length} lines`);

  // Test 8: Save and update nudge
  const nudge = fabric.saveNudge({
    ts: Date.now(),
    tier: 'detail',
    frictionScore: 0.72,
    trustAtDelivery: 0.55,
    prompt: 'test prompt',
    response: 'test response',
    citations: ['https://example.com'],
    contextSummaryUsed: 'test context',
    feedback: 'ignored',
  });
  if (!nudge.id) throw new Error('saveNudge should return nudge with id');
  fabric.updateNudgeFeedback(nudge.id, 'engaged');
  console.log(`  ✓ Saved nudge ${nudge.id.substring(0, 8)}... and updated feedback`);

  fabric.close();
  console.log('ContextFabric tests passed!');
} catch (e) {
  console.error(e);
  process.exit(1);
}
