import { redactPII } from '../src/main/redact';

function assertEqual(actual: any, expected: any, msg: string) {
  if (actual !== expected) {
    throw new Error(`Assertion failed: ${msg}. Expected '${expected}', got '${actual}'`);
  }
}

try {
  console.log('Testing redactPII...');

  const textWithEmail = 'Hello, contact me at user.name@domain.com for more info.';
  assertEqual(redactPII(textWithEmail), 'Hello, contact me at [EMAIL] for more info.', 'Redact Email');

  const textWithCard = 'My credit card is 1234-5678-9012-3456 and it expires soon.';
  assertEqual(redactPII(textWithCard), 'My credit card is [CARD] and it expires soon.', 'Redact Credit Card');

  const textWithLongDigit = 'My account number is 123456789.';
  assertEqual(redactPII(textWithLongDigit), 'My account number is [NUMBER].', 'Redact Long Digits');

  const safeText = 'This is a normal text with some 1234 numbers and no PII.';
  assertEqual(redactPII(safeText), safeText, 'Leave safe text unchanged');

  console.log('Redact tests passed!');
} catch (e) {
  console.error(e);
  process.exit(1);
}
