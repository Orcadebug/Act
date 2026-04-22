import { FrictionScorer } from '../src/main/friction-scorer';
import { SignalSnapshot } from '../src/shared/types';

function assertEqual(actual: any, expected: any, msg: string) {
  if (actual !== expected) {
    throw new Error(`Assertion failed: ${msg}. Expected '${expected}', got '${actual}'`);
  }
}

function assertInRange(actual: number, min: number, max: number, msg: string) {
  if (actual < min || actual > max) {
    throw new Error(`Assertion failed: ${msg}. Expected ${actual} to be in [${min}, ${max}]`);
  }
}

function makeSnapshot(overrides: Partial<SignalSnapshot> = {}): SignalSnapshot {
  return {
    ts: Date.now(),
    typingCadenceMs: 0,
    appSwitchCount: 0,
    dwellTimeSec: 0,
    scrollVelocity: 0,
    clipboardCycles: 0,
    errorDialogDetected: false,
    activeApp: 'TestApp',
    activeWindowTitle: 'Test Window',
    ...overrides,
  };
}

try {
  console.log('Testing FrictionScorer...');

  const scorer = new FrictionScorer();

  // Test 1: All-calm signals → low friction
  const calmReading = scorer.score(makeSnapshot());
  assertInRange(calmReading.score, 0, 0.15, 'Calm signals should produce low friction');
  console.log(`  ✓ Calm snapshot → friction=${calmReading.score.toFixed(3)}`);

  // Test 2: High typing hesitation → moderate friction
  const scorer2 = new FrictionScorer();
  const hesitantReading = scorer2.score(makeSnapshot({ typingCadenceMs: 1500 }));
  assertInRange(hesitantReading.score, 0.1, 0.5, 'Hesitant typing should produce moderate friction');
  console.log(`  ✓ Hesitant typing → friction=${hesitantReading.score.toFixed(3)}`);

  // Test 3: Multiple distress signals → high friction
  const scorer3 = new FrictionScorer();
  const distressReading = scorer3.score(makeSnapshot({
    typingCadenceMs: 1800,
    appSwitchCount: 7,
    dwellTimeSec: 25,
    scrollVelocity: 4,
    clipboardCycles: 3,
    errorDialogDetected: true,
  }));
  assertInRange(distressReading.score, 0.6, 1.0, 'Distress signals should produce high friction');
  console.log(`  ✓ Distress signals → friction=${distressReading.score.toFixed(3)}`);

  // Test 4: Contributors are sorted by contribution
  assertEqual(distressReading.contributors.length > 0, true, 'Should have contributors');
  const contribs = distressReading.contributors.map(c => c.contribution);
  for (let i = 1; i < contribs.length; i++) {
    assertEqual(contribs[i - 1] >= contribs[i], true, 'Contributors should be sorted descending');
  }
  console.log(`  ✓ Contributors sorted: ${distressReading.contributors.map(c => c.signal).join(', ')}`);

  // Test 5: EMA smoothing makes smoothed score lag behind raw
  const scorer4 = new FrictionScorer();
  scorer4.score(makeSnapshot()); // low
  scorer4.score(makeSnapshot()); // low
  const spike = scorer4.score(makeSnapshot({
    typingCadenceMs: 2000,
    appSwitchCount: 8,
    dwellTimeSec: 30,
  }));
  assertEqual(spike.smoothedScore < spike.score, true, 'Smoothed score should lag behind spike');
  console.log(`  ✓ EMA smoothing: raw=${spike.score.toFixed(3)}, smoothed=${spike.smoothedScore.toFixed(3)}`);

  // Test 6: Error dialog alone produces some friction
  const scorer5 = new FrictionScorer();
  const errorReading = scorer5.score(makeSnapshot({ errorDialogDetected: true }));
  assertInRange(errorReading.score, 0.05, 0.2, 'Error dialog alone should add some friction');
  console.log(`  ✓ Error dialog → friction=${errorReading.score.toFixed(3)}`);

  console.log('FrictionScorer tests passed!');
} catch (e) {
  console.error(e);
  process.exit(1);
}
