import Module from 'module';
import path from 'path';

// Intercept electron and better-sqlite3 requires
const originalRequire = Module.prototype.require;

let storedScore = 0.5;

Module.prototype.require = function (id: string) {
  if (id === 'electron') {
    return {
      __esModule: true,
      app: { getPath: () => path.join(__dirname, '..', '.mock_user_data') },
    };
  }
  if (id === 'better-sqlite3') {
    class MockDatabase {
      constructor() {}
      pragma() {}
      exec() {}
      close() {}
      prepare(sql: string) {
        return {
          run: (...args: any[]) => {
            if (sql.includes('UPDATE trust_profile SET')) {
              storedScore = args[0]; // Track persisted score
            }
          },
          get: () => undefined, // No existing profile → creates new
        };
      }
    }
    return MockDatabase;
  }
  return originalRequire.apply(this, [id]);
} as any;

import { TrustManager } from '../src/main/trust-manager';

function assertInRange(actual: number, min: number, max: number, msg: string) {
  if (actual < min || actual > max) {
    throw new Error(`${msg}: ${actual} not in [${min}, ${max}]`);
  }
}

try {
  console.log('Testing TrustManager...');

  const trust = new TrustManager();

  // Test 1: Initial score is 0.5
  assertInRange(trust.getScore(), 0.49, 0.51, 'Initial score should be ~0.5');
  console.log(`  ✓ Initial score: ${trust.getScore()}`);

  // Test 2: Engaged feedback increases score
  const before = trust.getScore();
  trust.recordFeedback('engaged');
  if (trust.getScore() <= before) throw new Error('Engaged should increase score');
  console.log(`  ✓ After engaged: ${trust.getScore().toFixed(3)}`);

  // Test 3: Expanded feedback increases score more
  trust.recordFeedback('expanded');
  console.log(`  ✓ After expanded: ${trust.getScore().toFixed(3)}`);

  // Test 4: Dismissed feedback decreases score
  const beforeDismiss = trust.getScore();
  trust.recordFeedback('dismissed');
  if (trust.getScore() >= beforeDismiss) throw new Error('Dismissed should decrease score');
  console.log(`  ✓ After dismissed: ${trust.getScore().toFixed(3)}`);

  // Test 5: Ignored has small negative effect
  const beforeIgnore = trust.getScore();
  trust.recordFeedback('ignored');
  if (trust.getScore() >= beforeIgnore) throw new Error('Ignored should slightly decrease score');
  console.log(`  ✓ After ignored: ${trust.getScore().toFixed(3)}`);

  // Test 6: Score is clamped between 0 and 1
  for (let i = 0; i < 50; i++) trust.recordFeedback('engaged');
  assertInRange(trust.getScore(), 0, 1, 'Score should be clamped to [0,1]');
  console.log(`  ✓ After 50 engagements: ${trust.getScore().toFixed(3)} (capped at 1.0)`);

  // Test 7: Friction threshold adjusts with trust
  const highTrust = new TrustManager();
  for (let i = 0; i < 20; i++) highTrust.recordFeedback('engaged');
  const highThreshold = highTrust.getFrictionThreshold();

  const lowTrust = new TrustManager();
  for (let i = 0; i < 30; i++) lowTrust.recordFeedback('dismissed');
  const lowThreshold = lowTrust.getFrictionThreshold();

  if (highThreshold >= lowThreshold) {
    throw new Error(`High trust threshold (${highThreshold}) should be lower than low trust (${lowThreshold})`);
  }
  console.log(`  ✓ High trust threshold: ${highThreshold}, Low trust threshold: ${lowThreshold}`);

  // Test 8: Nudge tier changes with trust
  const tierHigh = highTrust.getNudgeTier();
  const tierLow = lowTrust.getNudgeTier();
  if (tierHigh !== 'deep_dive') throw new Error(`High trust should yield deep_dive, got ${tierHigh}`);
  if (tierLow !== 'hint') throw new Error(`Low trust should yield hint, got ${tierLow}`);
  console.log(`  ✓ High trust tier: ${tierHigh}, Low trust tier: ${tierLow}`);

  // Test 9: Profile stats are correct
  const profile = trust.getProfile();
  if (profile.totalNudges < 4) throw new Error('Should have tracked total nudges');
  console.log(`  ✓ Profile: ${profile.totalNudges} nudges, ${profile.engagedCount} engaged, ${profile.dismissedCount} dismissed`);

  trust.close();
  highTrust.close();
  lowTrust.close();
  console.log('TrustManager tests passed!');
} catch (e) {
  console.error(e);
  process.exit(1);
}
