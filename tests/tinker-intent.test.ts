import { MockAgent, setGlobalDispatcher } from 'undici';
import { TinkerIntentProvider } from '../src/main/llm/tinker';

(async () => {
  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);

  const mockPool = mockAgent.get('http://test');

  try {
    console.log('Testing TinkerIntentProvider...');
    const provider = new TinkerIntentProvider('key', 'model', 'http://test/');
    
    // Test 1: Valid JSON
    mockPool.intercept({ path: '/', method: 'POST' }).reply(200, {
      choices: [{
        message: {
          content: JSON.stringify({
            goal: 'test goal',
            task_type: 'coding',
            confidence: 0.8,
            suggested_tier: 'detail'
          })
        }
      }]
    });
    
    let res = await provider.classifyIntent({} as any);
    if (!res || res.goal !== 'test goal' || res.suggested_tier !== 'detail') {
      throw new Error(`Failed to parse valid JSON. Result: ${JSON.stringify(res)}`);
    }
    console.log('  ✓ Valid JSON parsed correctly');
    
    // Test 2: Missing fields -> null
    mockPool.intercept({ path: '/', method: 'POST' }).reply(200, {
      choices: [{
        message: {
          content: JSON.stringify({ goal: 'test' })
        }
      }]
    });
    res = await provider.classifyIntent({} as any);
    if (res !== null) throw new Error('Should return null for missing fields');
    console.log('  ✓ Missing fields returns null');
    
    // Test 3: Confidence clamping
    mockPool.intercept({ path: '/', method: 'POST' }).reply(200, {
      choices: [{
        message: {
          content: JSON.stringify({
            goal: 'test goal',
            task_type: 'coding',
            confidence: 1.5,
            suggested_tier: 'hint'
          })
        }
      }]
    });
    res = await provider.classifyIntent({} as any);
    if (!res || res.confidence !== 1.0) throw new Error('Failed to clamp confidence: ' + res?.confidence);
    console.log('  ✓ Confidence clamped to 1.0');

    // Test 4: 500 error -> null
    mockPool.intercept({ path: '/', method: 'POST' }).reply(500, 'Internal Server Error');
    res = await provider.classifyIntent({} as any);
    if (res !== null) throw new Error('Should return null on 500');
    console.log('  ✓ 500 error returns null');
    
    console.log('TinkerIntentProvider tests passed!');
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
