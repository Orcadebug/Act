import { request } from 'undici';
import pino from 'pino';
import { NudgeTier, IntentResult } from '../../shared/types';
import { ActionProvider, StreamChunk } from './types';

const logger = pino({ name: 'PerplexityActionProvider' });

const TIER_PROMPTS: Record<NudgeTier, string> = {
  hint:
    `You help a desktop user. Give ONE concise sentence — a quick hint or nudge pointing them in the right direction. Do not explain further unless asked.`,
  detail:
    `You help a desktop user. Give 2-3 sentences with one clear, actionable step they can take right now. Be specific to their context.`,
  deep_dive:
    `You help a desktop user. Give a thorough answer with step-by-step guidance and relevant resources. Be specific to their context and reference their patterns when helpful.`,
};

export class PerplexityActionProvider implements ActionProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = 'sonar') {
    this.apiKey = apiKey;
    this.model = model;
  }

  public isConfigured(): boolean {
    return !!this.apiKey;
  }

  public async answer(
    userContext: string,
    tier: NudgeTier,
    contextSummary: string,
    intent: IntentResult,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<string> {
    if (!this.apiKey) {
      logger.error('Perplexity API key missing');
      onChunk({ text: '', citations: [], done: true, error: 'Perplexity API key not configured.' });
      return '';
    }

    let systemPrompt = TIER_PROMPTS[tier];
    if (intent && intent.goal) {
      systemPrompt += `\n\nUser Goal: ${intent.goal}`;
    }
    if (contextSummary) {
      systemPrompt += `\n\nUser context from their activity history:\n${contextSummary}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

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
        signal: controller.signal,
      });

      if (response.statusCode !== 200) {
        const errBody = await response.body.text().catch(() => '');
        const msg = `Perplexity error ${response.statusCode}${errBody ? ': ' + errBody.slice(0, 120) : ''}`;
        logger.error(msg);
        onChunk({ text: '', citations: [], done: true, error: msg });
        return '';
      }

      let fullText = '';
      let citations: string[] = [];

      for await (const chunk of response.body) {
        const lines = chunk.toString().split('\n').filter((line: string) => line.trim() !== '');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
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
              // Ignore parse errors on incomplete SSE chunks
            }
          }
        }
      }

      return fullText;
    } catch (e: any) {
      const msg = e?.name === 'AbortError' ? 'Request timed out after 30s.' : `Perplexity error: ${e?.message ?? e}`;
      logger.error(msg);
      onChunk({ text: '', citations: [], done: true, error: msg });
      return '';
    } finally {
      clearTimeout(timeout);
    }
  }
}
