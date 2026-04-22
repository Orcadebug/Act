import { NudgeTier, IntentResult } from '../../shared/types';

export type { NudgeTier, IntentResult };

export interface IntentInput {
  app: string;
  windowTitle: string;
  screenText: string;
  clipboardText: string;
  signalSummary: string;
  recentContext: string;
}

export interface StreamChunk {
  text: string;
  citations: string[];
  done: boolean;
  error?: string;
}

export interface IntentProvider {
  isConfigured(): boolean;
  classifyIntent(input: IntentInput): Promise<IntentResult | null>;
}

export interface ActionProvider {
  isConfigured(): boolean;
  answer(userPrompt: string, tier: NudgeTier, contextSummary: string, intent: IntentResult, onChunk: (chunk: StreamChunk) => void): Promise<string>;
}
