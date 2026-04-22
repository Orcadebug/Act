import { request } from 'undici';
import pino from 'pino';
import { NudgeTier, ContextSummary } from '../shared/types';

const logger = pino({ name: 'NudgeResponder' });

export interface StreamChunk {
  text: string;
  citations: string[];
  done: boolean;
}

/**
 * System prompts tiered by trust level.
 * Lower trust = more concise; higher trust = more detailed.
 */
const TIER_PROMPTS: Record<NudgeTier, string> = {
  hint:
    `You help a desktop user. Give ONE concise sentence — a quick hint or nudge pointing them in the right direction. Do not explain further unless asked.`,
  detail:
    `You help a desktop user. Give 2-3 sentences with one clear, actionable step they can take right now. Be specific to their context.`,
  deep_dive:
    `You help a desktop user. Give a thorough answer with step-by-step guidance and relevant resources. Be specific to their context and reference their patterns when helpful.`,
};

/**
 * NudgeResponder — Trust-tiered response generation.
 *
 * Unlike a fixed-output responder, this adapts response depth
 * based on the user's trust level and injects context graph
 * information into the system prompt for personalization.
 */
export class NudgeResponder {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = 'sonar') {
    this.apiKey = apiKey;
    this.model = model;
  }

  /**
   * Generate a nudge response with context injection and trust-tiered depth.
   */
  public async ask(
    userContext: string,
    tier: NudgeTier,
    contextSummary: string,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<string> {
    if (!this.apiKey) {
      logger.error('Perplexity API key missing');
      return '';
    }

    // Build system prompt from tier + context
    let systemPrompt = TIER_PROMPTS[tier];
    if (contextSummary) {
      systemPrompt += `\n\nUser context from their activity history:\n${contextSummary}`;
    }

    try {
      const response = await request('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
          model: this.model,
          stream: true,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContext },
          ],
        }),
      });

      if (response.statusCode !== 200) {
        logger.error(`Perplexity API error: ${response.statusCode}`);
        return '';
      }

      let fullText = '';
      let citations: string[] = [];

      for await (const chunk of response.body) {
        const lines = chunk.toString().split('\n').filter((line: string) => line.trim() !== '');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.replace('data: ', '');
            if (dataStr === '[DONE]') {
              onChunk({ text: fullText, citations, done: true });
              break;
            }
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.choices?.[0]?.delta?.content) {
                fullText += parsed.choices[0].delta.content;
              }
              if (parsed.citations) {
                citations = parsed.citations;
              }
              onChunk({ text: fullText, citations, done: false });
            } catch {
              // Ignore parse errors on incomplete chunks
            }
          }
        }
      }

      return fullText;
    } catch (e) {
      logger.error('Error calling Perplexity:', e);
      return '';
    }
  }
}
