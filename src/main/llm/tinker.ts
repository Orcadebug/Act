import { request } from 'undici';
import pino from 'pino';
import { IntentProvider, IntentInput, IntentResult } from './types';

const logger = pino({ name: 'TinkerIntentProvider' });

export class TinkerIntentProvider implements IntentProvider {
  private apiKey: string;
  private model: string;
  private endpoint: string;

  constructor(apiKey: string, model: string, endpoint: string) {
    this.apiKey = apiKey;
    this.model = model;
    this.endpoint = endpoint;
  }

  public isConfigured(): boolean {
    return !!this.apiKey && !!this.endpoint;
  }

  public async classifyIntent(input: IntentInput): Promise<IntentResult | null> {
    if (!this.isConfigured()) return null;

    const systemPrompt = `You are an intent classifier. Given the user's context, return a JSON object with the following keys exactly:
- "goal": a string <= 140 chars describing the user's current goal.
- "task_type": a string categorizing the task.
- "confidence": a number between 0 and 1 indicating how confident you are in this classification.
- "suggested_tier": a string which must be one of "hint", "detail", or "deep_dive" (clear-but-small -> hint, uncertain-but-solvable -> detail, large/ambiguous -> deep_dive).
Return only the JSON object.`;

    const userPrompt = `App: ${input.app}
Window Title: ${input.windowTitle}
Screen Text: ${input.screenText}
Clipboard: ${input.clipboardText}
Signals: ${input.signalSummary}
Recent Context: ${input.recentContext}`;

    try {
      const response = await request(this.endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ]
        }),
        bodyTimeout: 5000,
        headersTimeout: 5000,
      });

      if (response.statusCode !== 200) {
        logger.debug(`Tinker API error: ${response.statusCode}`);
        return null;
      }

      const bodyData = await response.body.text();
      const parsed = JSON.parse(bodyData);
      const content = parsed.choices?.[0]?.message?.content;
      
      if (!content) {
        logger.debug('Tinker returned empty content');
        return null;
      }

      const result = JSON.parse(content);
      
      if (
        typeof result.goal !== 'string' ||
        typeof result.task_type !== 'string' ||
        typeof result.confidence !== 'number' ||
        !['hint', 'detail', 'deep_dive'].includes(result.suggested_tier)
      ) {
        logger.debug('Tinker returned invalid fields', result);
        return null;
      }
      
      // Clamp confidence to 0-1
      result.confidence = Math.max(0, Math.min(1, result.confidence));

      return {
        goal: result.goal.substring(0, 140),
        task_type: result.task_type,
        confidence: result.confidence,
        suggested_tier: result.suggested_tier
      };
    } catch (e) {
      console.error('Tinker error:', e);
      logger.debug('Error calling Tinker:', e);
      return null;
    }
  }
}
