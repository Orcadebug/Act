export function redactPII(text: string): string {
  if (!text) return text;

  // Redact emails
  let redacted = text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]');

  // Redact credit cards (simple 13-16 digit numbers with optional dashes/spaces)
  redacted = redacted.replace(/\b(?:\d[ -]*?){13,16}\b/g, '[CARD]');

  // Redact long digits (likely phone numbers, accounts, SSN, etc. - > 7 digits)
  redacted = redacted.replace(/\b\d{8,}\b/g, '[NUMBER]');

  return redacted;
}
