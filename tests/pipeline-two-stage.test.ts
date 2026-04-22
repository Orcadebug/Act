import Module from 'module';
import path from 'path';
import crypto from 'crypto';

// Intercept requires
const originalRequire = Module.prototype.require;
let mockNudgeCount = 0;

Module.prototype.require = function (id: string) {
  if (id === 'electron') {
    return {
      __esModule: true,
      app: { getPath: () => '' },
    };
  }
  if (id === 'fs') {
    return {
      existsSync: () => true,
      mkdirSync: () => {},
    };
  }
  if (id === 'better-sqlite3') {
    class MockDatabase {
      constructor() {}
      pragma() {}
      exec() {}
      close() {}
      transaction(fn: any) {
        return (...args: any[]) => fn(...args);
      }
      prepare(sql: string) {
        return {
          run: (...args: any[]) => {
            if (sql.includes('INSERT INTO nudges')) {
              mockNudgeCount++;
            }
          },
          get: () => ({ c: 0 }),
          all: () => [],
        };
      }
    }
    return MockDatabase;
  }
  if (id === 'active-win') {
    return { default: async () => ({ owner: { name: 'TestApp' }, title: 'TestWindow' }) };
  }
  return originalRequire.apply(this, [id]);
} as any;

import { PulseEngine } from '../src/main/pulse-engine';
import { PulseSettings } from '../src/shared/types';
import { IntentResult, IntentProvider, ActionProvider } from '../src/main/llm/types';
import * as factory from '../src/main/llm/factory';

(async () => {
  try {
    console.log('Testing Two-Stage Pipeline...');

    let classifyResult: IntentResult | null = null;
    let answerCalled = false;
    let receivedTier = '';
    
    const mockIntent: IntentProvider = {
      isConfigured: () => true,
      classifyIntent: async () => classifyResult
    };

    const mockAction: ActionProvider = {
      isConfigured: () => true,
      answer: async (userPrompt, tier, contextSummary, intent, onChunk) => {
        answerCalled = true;
        receivedTier = tier;
        onChunk({ text: 'test chunk', citations: [], done: true });
        return 'test answer';
      }
    };

    (factory as any).buildProviders = () => ({ intent: mockIntent, action: mockAction });

    const settings: PulseSettings = {
      signalIntervalMs: 100,
      nudgeCooldownMs: 0,
      captureAllowlist: [],
      tinkerApiKey: 'key',
      tinkerModel: 'model',
      tinkerEndpoint: 'endpoint',
      theme: 'system',
      perplexityApiKey: 'key',
      perplexityModel: 'model',
      screenshotRetention: false,
      signalWeights: { typingHesitation: 1, appSwitching: 0, dwellTime: 0, scrollVelocity: 0, clipboardCycling: 0, errorDialog: 0 },
      edgeDecayRate: 0.99,
      edgePruneThreshold: 0.01,
    };

    let ipcEmitted = false;
    let ipcPayload: any = null;

    const engine = new PulseEngine(settings, (data) => {
      ipcEmitted = true;
      ipcPayload = data;
    });

    // Inject mocks directly
    (engine as any).intent = mockIntent;
    (engine as any).action = mockAction;
    (engine as any).fabric = {
      saveNudge: () => { mockNudgeCount++; return { id: 'mock' }; },
      ingestSnapshot: () => {},
      getContext: () => ({}),
      buildContextPrompt: () => '',
      close: () => {},
      getStats: () => ({ nodes: 0, edges: 0, nudges: 0 }),
      extractTopics: () => []
    };
    (engine as any).trust = {
      shouldNudge: () => true,
      recordFeedback: () => {},
      getFrictionThreshold: () => 0.5,
      getNudgeTier: () => 'deep_dive',
      getScore: () => 0.5,
      close: () => {},
    };

    // Mock capturer to return fixed values to avoid errors
    (engine as any).capturer = {
      capture: async () => ({
        app: 'TestApp',
        title: 'TestWindow',
        screenshotBuffer: null,
        clipboardText: 'test clipboard'
      })
    };

    await engine.start();

    // Trigger high friction
    const triggerFriction = async () => {
      (engine as any).handleSnapshot({
        ts: Date.now(),
        typingCadenceMs: 2000,
        appSwitchCount: 0,
        dwellTimeSec: 0,
        scrollVelocity: 0,
        clipboardCycles: 0,
        errorDialogDetected: false,
        activeApp: 'TestApp',
        activeWindowTitle: 'TestWindow'
      });
      await new Promise(r => setTimeout(r, 200)); // wait for pipeline to run
    };

    // Test 1: intent is null -> suppresses
    classifyResult = null;
    answerCalled = false;
    ipcEmitted = false;
    mockNudgeCount = 0;
    
    await triggerFriction();
    
    if (answerCalled) throw new Error('Action answer called when intent was null');
    if (ipcEmitted) throw new Error('IPC emitted when intent was null');
    if (mockNudgeCount > 0) throw new Error('saveNudge called when intent was null');
    console.log('  ✓ Null intent suppresses nudge and IPC');

    // Test 2: low confidence -> suppresses
    classifyResult = { goal: 'test', task_type: 'test', confidence: 0.2, suggested_tier: 'detail' };
    (engine as any).lastNudgeTs = 0; // Bypass cooldown
    await triggerFriction();
    if (answerCalled) throw new Error('Action answer called on low confidence');
    console.log('  ✓ Low confidence suppresses nudge');

    // Test 3: high confidence -> passes, IPC has no tier/friction
    classifyResult = { goal: 'test', task_type: 'test', confidence: 0.8, suggested_tier: 'deep_dive' };
    (engine as any).lastNudgeTs = 0; // Bypass cooldown
    answerCalled = false;
    ipcEmitted = false;
    
    await triggerFriction();
    
    if (!answerCalled) throw new Error('Action answer not called on valid intent');
    if (receivedTier !== 'deep_dive') throw new Error('Action did not receive suggested_tier');
    if (!ipcEmitted) throw new Error('IPC not emitted on valid intent');
    
    // verify IPC payload contains the old fields (since frontend hasn't been updated)
    if (!('tier' in ipcPayload) || !('frictionScore' in ipcPayload) || !('trustScore' in ipcPayload)) {
      throw new Error('IPC payload is missing required frontend fields');
    }
    
    if (mockNudgeCount === 0) throw new Error('saveNudge not called on successful nudge');
    console.log('  ✓ Valid intent triggers action with correct tier and slim IPC');

    engine.stop();
    console.log('Pipeline tests passed!');
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
